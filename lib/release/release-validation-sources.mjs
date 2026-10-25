import {chmod, copyFile, lstat, mkdir, readFile, readdir, realpath} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';

import {assertExactKeys} from '../common/canonical-contract.mjs';
import {isPortableFilename, resolveAbsolutePathWithinScope} from '../common/filesystem.mjs';
import {RELEASE_VALIDATION_REPOSITORY_ROOT} from './release-validation-config.mjs';

/** @typedef {{agentAssisted: {directory: string}, plain: {directory: string}}} ValidationSources */
/** @typedef {import('./release-vm-validation.mjs').HostProcessAdapter} HostProcessAdapter */
const TARGET_KEYS = ['agentAssisted', 'plain'];
const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** 只读取仓库外来源配置, 不返回或保存配置字节. @param {string} configurationPath @returns {Promise<ValidationSources>} */
export const loadReleaseValidationSources = async configurationPath => {
    try {
        if (!isAbsolute(configurationPath)) throw new Error('invalid path');
        const repositoryRoot = await realpath(RELEASE_VALIDATION_REPOSITORY_ROOT);
        if (!(await lstat(configurationPath)).isFile()
            || resolveAbsolutePathWithinScope({path: await realpath(configurationPath), scope: repositoryRoot}).status === 'succeeded') throw new Error('invalid path');
        const value = JSON.parse(await readFile(configurationPath, 'utf8'));
        assertExactKeys(value, TARGET_KEYS, 'Release validation sources');
        /** @type {Record<string, {directory: string}>} */
        const sources = {};
        for (const key of TARGET_KEYS) {
            const source = value[key];
            assertExactKeys(source, ['directory'], 'Release validation source');
            if (typeof source.directory !== 'string' || !isAbsolute(source.directory)) throw new Error('invalid directory');
            const status = await lstat(source.directory);
            const directory = await realpath(source.directory);
            if (!status.isDirectory() || status.isSymbolicLink()
                || resolveAbsolutePathWithinScope({path: directory, scope: repositoryRoot}).status === 'succeeded') throw new Error('invalid directory');
            sources[key] = {directory};
        }
        return {agentAssisted: sources.agentAssisted, plain: sources.plain};
    } catch {
        throw new Error('Release validation sources must be an external JSON file containing two readable external directories.');
    }
};

/**
 * 复制完整普通文件快照, 用批量 Git plumbing 保留字节和执行位, 不执行过滤器或提交 hooks.
 * @param {{directory: string, key: string, timeoutMs: number, workspaceDirectory: string}} input
 * @param {HostProcessAdapter} processAdapter
 */
export const prepareValidationSnapshotBundle = async ({directory, key, timeoutMs, workspaceDirectory}, processAdapter) => {
    const root = join(workspaceDirectory, '.bundle-input', key);
    const filesDirectory = join(root, 'files');
    const repositoryDirectory = join(root, 'repository.git');
    const hooksDirectory = join(root, 'empty-hooks');
    const gitConfiguration = ['-c', `core.hooksPath=${hooksDirectory}`, '-c', 'core.longpaths=true', '-c', 'core.protectNTFS=true'];
    await mkdir(filesDirectory, {recursive: true});
    await mkdir(hooksDirectory);
    /** @type {Array<{mode: string, path: string}>} */
    const entries = [];
    /** @param {string} [current] @returns {Promise<void>} */
    const copyDirectory = async (current = '') => {
        const foldedNames = new Set();
        for (const name of (await readdir(join(directory, current))).sort()) {
            if (name === '.git') continue;
            const folded = name.toLowerCase();
            if (!isPortableFilename(name) || folded === '.git' || foldedNames.has(folded)) throw new Error('unsupported snapshot filename');
            foldedNames.add(folded);
            const path = current === '' ? name : `${current}/${name}`;
            const sourcePath = join(directory, path);
            const status = await lstat(sourcePath);
            const targetPath = join(filesDirectory, path);
            if (status.isDirectory() && !status.isSymbolicLink()) {
                await mkdir(targetPath);
                await copyDirectory(path);
            } else if (status.isFile() && !status.isSymbolicLink()) {
                await copyFile(sourcePath, targetPath);
                await chmod(targetPath, status.mode & 0o777);
                entries.push({mode: status.mode & 0o111 ? '100755' : '100644', path});
            } else {
                throw new Error('unsupported snapshot item');
            }
        }
    };
    try {
        await copyDirectory();
    } catch {
        throw new Error(`Release validation ${key} source could not be copied as a complete ordinary-file snapshot.`);
    }
    const git = async (/** @type {string[]} */ arguments_, /** @type {string | undefined} */ input = undefined) => {
        const result = await processAdapter.run({
            arguments: [...gitConfiguration, ...arguments_],
            cwd: repositoryDirectory,
            executable: 'git',
            ...(input === undefined ? {} : {input}),
            timeoutMs,
        });
        if (result.exitCode !== 0) throw new Error(`Release validation ${key} snapshot Git operation failed.`);
        return result.stdout.trim();
    };
    // 初始化不需要现有 cwd, 其余操作保持在本次新建的裸仓库中.
    const initialized = await processAdapter.run({arguments: [...gitConfiguration, 'init', '--bare', repositoryDirectory], cwd: root, executable: 'git', timeoutMs});
    if (initialized.exitCode !== 0) throw new Error(`Release validation ${key} snapshot Git initialization failed.`);
    const objects = entries.length === 0 ? [] : (await git(
        ['hash-object', '-w', '--no-filters', '--stdin-paths'],
        entries.map(entry => JSON.stringify(join(filesDirectory, entry.path))).join('\n') + '\n',
    )).split('\n');
    if (objects.length !== entries.length || objects.some(id => !OBJECT_ID_PATTERN.test(id))) throw new Error('Release validation snapshot object identities are invalid.');
    await git(['update-index', '-z', '--index-info'], entries.map((entry, index) => `${entry.mode} ${objects[index]}\t${entry.path}\0`).join(''));
    const tree = await git(['write-tree']);
    if (!OBJECT_ID_PATTERN.test(tree)) throw new Error('Release validation snapshot tree identity is invalid.');
    const actualEntries = (await git(['ls-tree', '-r', '-z', tree])).split('\0').filter(Boolean).sort();
    const expectedEntries = entries.map((entry, index) => `${entry.mode} blob ${objects[index]}\t${entry.path}`).sort();
    if (actualEntries.length !== expectedEntries.length || actualEntries.some((entry, index) => entry !== expectedEntries[index])) {
        throw new Error('Release validation snapshot tree does not preserve the complete source.');
    }
    const commit = await git(['-c', 'user.name=ARW Validation', '-c', 'user.email=validation@example.invalid', '-c', 'commit.gpgSign=false', 'commit-tree', tree], 'ARW validation snapshot\n');
    if (!OBJECT_ID_PATTERN.test(commit)) throw new Error('Release validation snapshot commit identity is invalid.');
    await git(['update-ref', 'refs/heads/arw-validation', commit]);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/arw-validation']);
    const path = join(workspaceDirectory, `${key}.bundle`);
    await git(['bundle', 'create', path, 'refs/heads/arw-validation']);
    return {commit, path};
};
