import {createHash} from 'node:crypto';
import {cp, lstat, mkdir, readdir, readFile, readlink, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';

import {createTemporaryDirectory} from './cleanup.mjs';

const succeeded = (/** @type {string | Buffer} */ stdout = '') => ({exitCode: 0, stderr: '', stdout});

/**
 * Create a deterministic in-process Git command adapter for tests whose purpose
 * does not include proving Git process behavior.
 */
export const createMockGitRunCommand = () => {
    /** @type {Map<string, {stagedEntries: Map<string, Buffer>, index: Map<string, {bytes: Buffer, mode: string, oid: string}>, head: Map<string, {bytes: Buffer, mode: string, oid: string}>, objects: Map<string, Buffer>}>} */
    const repositories = new Map();

    return async (
        /** @type {string} */ file,
        /** @type {readonly string[]} */ args,
        /** @type {{cwd: string, input?: Buffer | string}} */ {cwd, input},
    ) => {
        if (file !== 'git') return {exitCode: 1, stderr: `Unexpected command: ${file}`, stdout: ''};

        const initializesRepository = args.at(-1) === 'init';
        if (initializesRepository) {
            repositories.set(cwd, {stagedEntries: new Map(), index: new Map(), head: new Map(), objects: new Map()});
            return succeeded();
        }

        const repository = repositories.get(cwd);
        if (repository === undefined) {
            return {exitCode: 1, stderr: `Mock Git Repository is not initialized: ${cwd}`, stdout: ''};
        }
        if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return succeeded(`${cwd}\n`);
        if (args[0] === 'config') return succeeded();
        if (args[0] === 'add') {
            const stage = async (/** @type {string} */ path, trackDiff = true) => {
                const absolute = join(cwd, path);
                const info = await lstat(absolute);
                if (info.isDirectory()) {
                    for (const entry of await readdir(absolute)) {
                        if (entry === '.git' || entry === '.tmp') continue;
                        await stage(path === '.' ? entry : `${path}/${entry}`, trackDiff);
                    }
                    return;
                }
                const bytes = info.isSymbolicLink() ? Buffer.from(await readlink(absolute)) : Buffer.from(await readFile(absolute));
                const mode = info.isSymbolicLink() ? '120000' : (info.mode & 0o111) === 0 ? '100644' : '100755';
                const oid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
                repository.index.set(path, {bytes, mode, oid});
                repository.objects.set(oid, bytes);
                if (trackDiff) repository.stagedEntries.set(path, bytes);
            };
            for (const path of args.slice(1)) await stage(path, path !== '.');
            return succeeded();
        }
        if (args[0] === 'commit') {
            repository.head = new Map(repository.index);
            repository.stagedEntries.clear();
            return succeeded();
        }
        if (args[0] === 'ls-files' && args.includes('--stage')) {
            const separator = args.includes('-z') ? '\0' : '\n';
            return succeeded([...repository.index].sort(([left], [right]) => left.localeCompare(right)).map(([path, entry]) => `${entry.mode} ${entry.oid} 0\t${path}${separator}`).join(''));
        }
        if (args[0] === 'cat-file' && args[1] === '--batch') {
            const specifications = Buffer.isBuffer(input) ? input.toString('utf8') : input ?? '';
            return succeeded(Buffer.concat(specifications.trimEnd().split('\n').map(specification => {
                const bytes = repository.objects.get(specification);
                return bytes === undefined ? Buffer.from(`${specification} missing\n`) : Buffer.concat([Buffer.from(`${specification} blob ${bytes.length}\n`), bytes, Buffer.from('\n')]);
            })));
        }
        if (args[0] === 'diff' && args[1] === '--cached' && args.includes('--name-only')) {
            const paths = [...repository.stagedEntries.keys()].sort();
            return succeeded(paths.length === 0 ? '' : `${paths.join('\n')}\n`);
        }
        if (args[0] === 'diff' && args[1] === '--cached') {
            const chunks = [];
            for (const path of [...repository.stagedEntries.keys()].sort()) {
                const bytes = repository.stagedEntries.get(path);
                if (bytes === undefined) throw new Error(`Mock Git staged entry is unavailable: ${path}`);
                chunks.push(Buffer.from(`${path}\0${bytes.length}\0`, 'utf8'), bytes);
            }
            return succeeded(Buffer.concat(chunks));
        }
        return {exitCode: 1, stderr: `Unexpected mock Git command: git ${args.join(' ')}`, stdout: ''};
    };
};

/**
 * Create a filesystem fixture without initializing a real Git Repository.
 *
 * @param {import('./cleanup.mjs').CleanupContext} t
 * @param {{copies?: Array<{source: string, target: string}>, files?: Record<string, string | Buffer>, prefix: string}} options
 */
export const createMockGitRepository = async (t, {copies = [], files = {}, prefix}) => {
    const repositoryRoot = await createTemporaryDirectory(t, prefix);
    for (const {source, target} of copies) {
        const destination = join(repositoryRoot, ...target.split('/'));
        await mkdir(dirname(destination), {recursive: true});
        await cp(source, destination, {recursive: true});
    }
    for (const [path, contents] of Object.entries(files)) {
        const destination = join(repositoryRoot, ...path.split('/'));
        await mkdir(dirname(destination), {recursive: true});
        await writeFile(destination, contents);
    }
    return {repositoryRoot, runCommand: createMockGitRunCommand()};
};
