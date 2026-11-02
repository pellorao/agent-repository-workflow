import assert from 'node:assert/strict';
import {access, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import test from 'node:test';
import {join} from 'node:path';

import {createTemporaryDirectory, registerCleanup} from './cleanup.mjs';
import {createMockFilesystem} from './mock-filesystem.mjs';
import {createRealGitHandle} from './git.mjs';
import {createMockGitHandle, createMockGitRepository} from './mock-git.mjs';
import {createRepository} from './repository-fixture.mjs';
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

/** A real repository and a mock one that every step of a comparison test drives identically. */
const createGitComparison = async (/** @type {import('node:test').TestContext} */ t) => {
    const mockRoot = await createTemporaryDirectory(t, 'arw-mock-git-compare-');
    const realRoot = await createRepository(t, {prefix: 'arw-real-git-compare-'});
    const mock = await createMockGitHandle(mockRoot);
    const real = createRealGitHandle(realRoot);
    return {
        mock,
        real,
        /** Run the same command on both; the work tree is already identical. */
        both: async (/** @type {string[]} */ argv, /** @type {NodeJS.ProcessEnv} */ environment = {}) => {
            await Promise.all([real.git(argv, {environment}), mock.git(argv, {environment})]);
        },
        /** Commit and tree ids differ between the doubles; what they say about equality must not. */
        ids: async (/** @type {string[]} */ argv) => {
            const [expected, actual] = await Promise.all([real.git(argv), mock.git(argv)]);
            return {mock: actual.stdout, real: expected.stdout};
        },
        /** The same query to both; exit code and output must agree. */
        query: async (/** @type {string[]} */ argv, /** @type {string | undefined} */ input = undefined) => {
            const [expected, actual] = await Promise.all([real.runner.run({argv, input}), mock.runner.run({argv, input})]);
            assert.deepEqual([actual.code, actual.stdout.toString()], [expected.code, expected.stdout.toString()], argv.join(' '));
        },
        remove: (/** @type {string} */ path) => Promise.all([mockRoot, realRoot].map(root => rm(join(root, path)))),
        write: async (/** @type {string} */ path, /** @type {string} */ text) => {
            for (const root of [mockRoot, realRoot]) {
                await mkdir(join(root, path, '..'), {recursive: true});
                await writeFile(join(root, path), text);
            }
        },
    };
};

test('Git double stages, commits and answers status, ignore and write-tree like a real Git process', async t => {
    const {both, ids, query, remove, write} = await createGitComparison(t);
    const compare = () => Promise.all([
        query(['status', '--porcelain=v1', '-z', '--untracked-files=all']),
        query(['ls-files', '--cached', '--full-name', '-z']),
    ]);
    await write('kept.txt', 'kept\n');
    await write('src/a.js', 'a\n');
    await write('.codex/config.toml', 'x\n');
    await write('.gitignore', '.codex/\n');
    await write('.arwignore', '.tmp/\n');
    await compare();
    await both(['add', 'kept.txt']);
    await compare();
    await both(['add', '-A']);
    await compare();
    const staged = await ids(['write-tree']);
    await both(['commit', '-m', 'first']);
    await write('kept.txt', 'changed\n');
    await write('later.txt', 'new\n');
    await remove('src/a.js');
    await compare();
    const unchangedIndex = await ids(['write-tree']);
    assert.equal(unchangedIndex.real === staged.real, unchangedIndex.mock === staged.mock, 'a work tree change alone leaves the index tree unchanged');
    assert.equal(unchangedIndex.real === staged.real, true);
    await both(['commit', '-a', '-m', 'second']);
    await compare();
    await both(['add', 'later.txt']);
    await compare();
    const changedIndex = await ids(['write-tree']);
    assert.equal(changedIndex.real === staged.real, changedIndex.mock === staged.mock, 'a changed index gives a different tree');
    assert.equal(changedIndex.real === staged.real, false);
    await Promise.all([
        query(['check-ignore', '--no-index', '--stdin', '-z'], '.codex/config.toml\0kept.txt\0src\0'),
        query(['-c', 'core.excludesFile=.arwignore', 'check-ignore', '--no-index', '--stdin', '-z'], '.tmp/x\0kept.txt\0'),
    ]);
});

test('Git double answers path inventories and history like a real Git process', async t => {
    const {both, mock, query, real, remove, write} = await createGitComparison(t);
    const unborn = await Promise.all([real.runner.run({argv: ['rev-parse', '--verify', '--quiet', 'HEAD']}), mock.runner.run({argv: ['rev-parse', '--verify', '--quiet', 'HEAD']})]);
    assert.deepEqual(unborn.map(result => [result.code, result.stdout.toString()]), [[1, ''], [1, '']]);
    await write('kept.txt', 'kept\n');
    await write('src/a.js', 'a\n');
    await write('.gitignore', 'ignored.txt\n');
    await both(['add', '-A']);
    await both(['commit', '-m', 'first'], {GIT_COMMITTER_DATE: '2026-08-07T00:03:00Z'});
    await write('src/c.js', 'c\n');
    await remove('src/a.js');
    await both(['add', '-A']);
    await both(['commit', '-m', 'second'], {GIT_COMMITTER_DATE: '2026-08-07T00:01:00Z'});
    await write('src/b.js', 'b\n');
    await write('ignored.txt', 'ignored\n');
    await write('kept.txt', 'edited\n');

    const times = async (/** @type {typeof mock} */ handle, /** @type {string[]} */ spec) => {
        const listed = (await handle.git(['rev-list', '--reverse', '--topo-order', ...spec])).stdout.split('\n').filter(Boolean);
        return Promise.all(listed.map(async id => (await handle.git(['show', '-s', '--format=%ct', id])).stdout));
    };
    await Promise.all([
        query(['rev-parse', '--is-shallow-repository']),
        query(['ls-files', '--stage', '-z', '--', 'src']),
        query(['ls-files', '--others', '--exclude-standard', '-z', '--', 'src']),
        query(['ls-files', '--cached', '--others', '--exclude-standard', '--full-name', '-z']),
        query(['diff', '--quiet', '--', 'src']),
        query(['diff', '--quiet', '--', 'kept.txt']),
        query(['ls-tree', '-r', '-z', 'HEAD', '--', 'src']),
        query(['ls-tree', '-r', '-z', 'HEAD', '--', 'kept.txt', 'missing']),
        query(['ls-tree', '-z', 'HEAD', '--', 'kept.txt']),
        query(['ls-tree', '-z', 'HEAD', '--', 'missing']),
        query(['cat-file', '-e', 'HEAD:src']),
        query(['cat-file', '-e', 'HEAD:src/a.js']),
        ...[['HEAD'], ['HEAD', '--', 'src/a.js'], ['HEAD', '--', 'kept.txt']].map(async spec => {
            assert.deepEqual(await times(mock, spec), await times(real, spec), spec.join(' '));
        }),
    ]);
    const heads = await Promise.all([real.runner.run({argv: ['rev-parse', '--verify', 'HEAD^{commit}']}), mock.runner.run({argv: ['rev-parse', '--verify', 'HEAD^{commit}']})]);
    assert.deepEqual(heads.map(result => [result.code, /^[0-9a-f]{40}\n$/u.test(result.stdout.toString())]), [[0, true], [0, true]]);
});
