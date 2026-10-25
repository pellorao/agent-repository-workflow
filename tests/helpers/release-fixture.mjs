import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';

import {parsePackageIdentity} from '../../lib/arw-common/identity.mjs';
import {createTemporaryDirectory} from './cleanup.mjs';

/** @typedef {{sourceDirectory: string, tag: string}} VerifiedReleaseFixtureInput */
/** @typedef {{arwVersion: string, diagnostics: readonly unknown[], sourceDirectory: string, status: 'succeeded'}} VerifiedReleaseFixture */

/**
 * 构造 Installation 测试消费的完整 Verified Release fixture.
 */
/** @param {VerifiedReleaseFixtureInput} input @returns {Promise<VerifiedReleaseFixture>} */
export const createVerifiedReleaseFixture = async ({sourceDirectory, tag}) => {
    const identity = parsePackageIdentity(await readFile(join(sourceDirectory, 'package.json')), 'package.json');

    if (tag !== identity.version) throw new Error('Verified Release fixture tag does not match package.json version.');
    return {
        arwVersion: identity.version,
        diagnostics: [],
        sourceDirectory,
        status: 'succeeded',
    };
};

/** @param {import('node:test').TestContext} t */
export const createValidationSourcesFixture = async t => {
    const root = await createTemporaryDirectory(t, 'arw-validation-sources-');
    const sources = {agentAssisted: {directory: join(root, 'assisted')}, plain: {directory: join(root, 'plain')}};
    for (const {directory} of Object.values(sources)) {
        await mkdir(directory);
        await writeFile(join(directory, 'source.txt'), 'source snapshot\n');
    }
    const configurationPath = join(root, 'sources.json');
    await writeFile(configurationPath, JSON.stringify(sources));
    return {configurationPath, root, sources};
};

/** 进程 Seam 的确定性快照结果, 真实 Git 字节验证由单独的组合案例承担. @param {{arguments: string[], cwd: string, input?: string | Uint8Array}} request */
export const snapshotGitObservation = request => {
    const command = request.arguments.find(argument => ['hash-object', 'write-tree', 'commit-tree', 'ls-tree'].includes(argument));
    if (command === undefined) return null;
    if (command === 'ls-tree') return {exitCode: 0, stderr: '', stdout: `100644 blob ${'e'.repeat(40)}\tsource.txt\0`};
    const stdout = command === 'hash-object'
        ? `${String(request.input).trimEnd().split('\n').map(() => 'e'.repeat(40)).join('\n')}\n`
        : `${command === 'commit-tree' ? basename(dirname(request.cwd)) === 'plain' ? '2'.repeat(40) : '1'.repeat(40) : 'f'.repeat(40)}\n`;
    return {exitCode: 0, stderr: '', stdout};
};
