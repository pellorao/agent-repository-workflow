import assert from 'node:assert/strict';
import {access, readFile, writeFile} from 'node:fs/promises';
import test from 'node:test';
import {join} from 'node:path';

import {createTemporaryDirectory, registerCleanup} from './cleanup.mjs';
import {createMockFilesystem} from './mock-filesystem.mjs';
import {createMockGitRepository} from './mock-git.mjs';
import {createScopedFilesystem} from '../../lib/common/filesystem.mjs';

test('temporary resource cleanup is registered immediately and propagates cleanup failure', async () => {
    /** @type {Array<() => void | Promise<void>>} */
    const callbacks = [];
    const context = {after: (/** @type {() => void | Promise<void>} */ callback) => callbacks.push(callback)};
    const directory = await createTemporaryDirectory(context, 'arw-helper-cleanup-');
    assert.equal(callbacks.length, 1);
    const cleanupDirectory = callbacks[0];
    if (cleanupDirectory === undefined) assert.fail('Expected directory cleanup registration.');
    await cleanupDirectory();
    await assert.rejects(access(directory), error => error instanceof Error && 'code' in error && error.code === 'ENOENT');

    const expected = new Error('cleanup failed');
    registerCleanup(context, async () => {
        throw expected;
    });
    const cleanupFailure = callbacks[1];
    if (cleanupFailure === undefined) assert.fail('Expected failing cleanup registration.');
    await assert.rejects(Promise.resolve(cleanupFailure()), (/** @type {unknown} */ error) => error === expected);
});

test('mock Git fixture prepares files and tracks deterministic staged content without a Git process', async t => {
    const {repositoryRoot, runCommand} = await createMockGitRepository(t, {
        files: {'base.txt': 'base\n'},
        prefix: 'arw-mock-git-',
    });
    const scenarioRoot = join(repositoryRoot, 'scenario');
    await writeFile(join(repositoryRoot, 'base.txt'), 'base\nchanged\n', 'utf8');
    await writeFile(join(repositoryRoot, 'candidate.txt'), 'candidate\n', 'utf8');
    await runCommand('git', ['init'], {cwd: repositoryRoot});
    await runCommand('git', ['add', '.'], {cwd: repositoryRoot});
    await runCommand('git', ['commit', '-m', 'base'], {cwd: repositoryRoot});
    await runCommand('git', ['add', 'base.txt', 'candidate.txt'], {cwd: repositoryRoot});

    assert.equal((await runCommand('git', ['rev-parse', '--show-toplevel'], {cwd: repositoryRoot})).stdout, `${repositoryRoot}\n`);
    assert.equal(
        (await runCommand('git', ['diff', '--cached', '--name-only'], {cwd: repositoryRoot})).stdout,
        'base.txt\ncandidate.txt\n',
    );
    const first = await runCommand('git', ['diff', '--cached'], {cwd: repositoryRoot});
    if (!Buffer.isBuffer(first.stdout)) assert.fail('Expected binary mock Git diff output.');
    assert.equal(first.stdout.toString('utf8').includes('candidate\n'), true);
    await writeFile(join(repositoryRoot, 'candidate.txt'), 'changed candidate\n', 'utf8');
    const second = await runCommand('git', ['diff', '--cached'], {cwd: repositoryRoot});
    assert.deepEqual(second.stdout, first.stdout);
    assert.equal((await runCommand('git', ['status'], {cwd: scenarioRoot})).exitCode, 1);
    assert.equal(await readFile(join(repositoryRoot, 'base.txt'), 'utf8'), 'base\nchanged\n');
});

const exerciseLimitedFilesystemContract = async (/** @type {ReturnType<typeof createMockFilesystem>} */ filesystem) => {
    const transcript = [];
    transcript.push(await filesystem.inspect({path: 'docs/missing.txt'}));
    transcript.push(await filesystem.createDirectory({path: 'docs'}));
    transcript.push(await filesystem.createDirectory({path: 'docs'}));
    transcript.push(await filesystem.write({bytes: Buffer.from('first\n'), mode: 'create', path: 'docs/file.txt'}));
    transcript.push(await filesystem.read({path: 'docs/file.txt'}));
    transcript.push(await filesystem.write({bytes: Buffer.from('second\n'), mode: 'replace', path: 'docs/file.txt'}));
    transcript.push(await filesystem.write({bytes: Buffer.from('nested\n'), mode: 'create', path: 'generated/nested.txt'}));
    transcript.push(await filesystem.list({path: '.', recursive: true}));
    transcript.push(await filesystem.remove({path: 'docs/file.txt'}));
    transcript.push(await filesystem.inspect({path: 'docs/file.txt'}));
    transcript.push(await filesystem.remove({path: 'generated'}));
    transcript.push(await filesystem.remove({path: 'generated', recursive: true}));
    transcript.push(await filesystem.list());
    return transcript;
};

test('limited filesystem test Adapter shares ordinary state-transition results with production', async t => {
    const root = await createTemporaryDirectory(t, 'arw-filesystem-contract-');
    const production = await createScopedFilesystem({root});
    if (production.status !== 'succeeded') assert.fail('Production filesystem creation must succeed.');
    const mock = createMockFilesystem();

    const [productionTranscript, mockTranscript] = await Promise.all([
        exerciseLimitedFilesystemContract(/** @type {ReturnType<typeof createMockFilesystem>} */ (production.scopedFilesystem)),
        exerciseLimitedFilesystemContract(mock),
    ]);
    const normalizeTranscript = (/** @type {unknown[]} */ transcript) => transcript.map(result => {
        if (result !== null && typeof result === 'object' && 'bytes' in result && Buffer.isBuffer(result.bytes)) {
            return {...result, bytes: result.bytes.toString('base64')};
        }
        return result;
    });
    assert.deepEqual(normalizeTranscript(mockTranscript), normalizeTranscript(productionTranscript));
});

test('limited filesystem test Adapter injects one exact failed operation without changing state', async () => {
    const filesystem = createMockFilesystem({
        entries: [{bytes: Buffer.from('before\n'), kind: 'file', path: 'docs/file.txt'}],
        failures: [{message: 'simulated read failure', operation: 'read', path: 'docs/file.txt', stage: 'read'}],
    });
    assert.deepEqual(await filesystem.read({path: 'docs/file.txt'}), {
        diagnostics: [{code: 'filesystem-io-failed', message: 'simulated read failure', path: 'docs/file.txt'}],
        stage: 'read',
        status: 'failed',
    });
    const observed = await filesystem.read({path: 'docs/file.txt'});
    if (observed.status !== 'succeeded') assert.fail('The injected failure must not mutate the file.');
    assert.equal(observed.bytes.toString('utf8'), 'before\n');
});
