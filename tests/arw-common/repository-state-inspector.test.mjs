import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {runGit} from '../helpers/git.mjs';
import {createRepository} from '../helpers/repository-fixture.mjs';
import {createNodeGitRunner} from '../../lib/common/git-process.mjs';
import {
    createNodeRepositoryStateInspector,
    parsePorcelainStatus,
    readStagedCandidate,
} from '../../lib/arw-common/repository-state-inspector.mjs';
import {createNodeRepositoryFilesystem} from '../../lib/repository-workflow/workflow.mjs';

/** @typedef {{argv: string[], input?: Buffer | string}} GitInput */

/** @template T @param {T | undefined} value @returns {T} */
const required = value => {
    if (value === undefined) throw new Error('Expected value is missing.');
    return value;
};

/** @param {{code?: number, stdout?: string}} [input] */
const gitResult = ({code = 0, stdout = ''} = {}) => ({
    code,
    failure: null,
    stderr: '',
    stdout: Buffer.from(stdout, 'utf8'),
});

const filesystem = {
    inspectPath: async (/** @type {{path: string}} */ {path}) => ({
        kind: path === '.arwignore' ? 'file' : 'missing',
        path,
    }),
    readBytes: async () => Buffer.from('', 'utf8'),
};

test('Repository State Inspector 解析 porcelain rename 与状态列', () => {
    const entries = parsePorcelainStatus(Buffer.from(' M tracked.js\0R  new.js\0old.js\0?? fresh.js\0', 'utf8'));

    assert.deepEqual(entries, [
        {code: ' M', path: 'tracked.js'},
        {code: 'R ', path: 'new.js'},
        {code: 'R ', path: 'old.js'},
        {code: '??', path: 'fresh.js'},
    ]);
});

test('Repository State Inspector 批量收集 Git 事实且调用数量不随 path 数量线性增长', async () => {
    const inspect = async (/** @type {{ paths: string[]; roots: string[]; }} */ request) => {
        /** @type {GitInput[]} */
        const calls = [];
        const git = {
            async run(/** @type {GitInput} */ input) {
                calls.push(input);
                if (input.argv[0] === 'status') return gitResult({stdout: ' M tracked.js\0?? fresh.js\0'});
                if (input.argv[0] === 'ls-files') return gitResult({stdout: 'src/a.js\0src/generated/drop.js\0tracked.js\0'});
                const paths = (input.input ?? '').toString('utf8').split('\0').filter(Boolean);
                if (input.argv[0] === 'check-ignore') {
                    const ignored = paths.filter((/** @type {string} */ path) => ['docs', 'ignored.txt'].includes(path));
                    return gitResult({code: ignored.length > 0 ? 0 : 1, stdout: ignored.map((/** @type {string} */ path) => `${path}\0`).join('')});
                }
                if (input.argv[0] === '-c') {
                    const excluded = paths.filter((/** @type {string} */ path) => path === 'src/generated/drop.js');
                    return gitResult({code: excluded.length > 0 ? 0 : 1, stdout: excluded.map((/** @type {string} */ path) => `${path}\0`).join('')});
                }
                throw new Error(`Unexpected Git call: ${input.argv.join(' ')}`);
            },
        };
        const inspector = createNodeRepositoryStateInspector({filesystem, git, repositoryRoot: 'C:/repo'});
        const state = await inspector.inspect({repositoryLocation: 'C:/repo', request});
        return {calls, state};
    };

    const small = await inspect({paths: ['ignored.txt'], roots: ['src']});
    const large = await inspect({
        paths: ['.git/hooks/reviewer.toml', 'a.txt', 'b.txt', 'ignored.txt', 'z.txt'],
        roots: ['docs', 'packages', 'src'],
    });
    assert.equal(large.calls.length, small.calls.length);
    assert.deepEqual(large.state.git.trackedPaths, ['src/a.js', 'src/generated/drop.js', 'tracked.js']);
    assert.deepEqual(large.state.git.ignoredPaths, ['docs', 'ignored.txt']);
    assert.deepEqual(large.state.git.agentScopeExcludedPaths, ['src/generated/drop.js']);
    assert.deepEqual(large.state.git.excludedPaths, [
        '.git/hooks/reviewer.toml',
        'docs',
        'ignored.txt',
        'src/generated/drop.js',
    ]);
    assert.deepEqual(Object.keys(large.state.files), [
        '.arwignore',
        '.git/hooks/reviewer.toml',
        'a.txt',
        'arw-lock.json',
        'b.txt',
        'docs',
        'ignored.txt',
        'packages',
        'src',
        'z.txt',
    ]);
    assert.deepEqual(large.state.files['.arwignore'].bytes, Buffer.from('', 'utf8'));
    const ignoreInput = required(large.calls.find(call => call.argv[0] === 'check-ignore')).input?.toString('utf8').split('\0').filter(Boolean);
    assert.deepEqual(ignoreInput, ['.git/hooks/reviewer.toml', 'a.txt', 'b.txt', 'docs', 'ignored.txt', 'packages', 'src', 'z.txt']);
});

test('Repository State Inspector batches index and HEAD candidate blobs in one Git read', async () => {
    const shared = 'a'.repeat(40);
    const added = 'b'.repeat(40);
    /** @type {GitInput[]} */
    const calls = [];
    const git = {
        async run(/** @type {GitInput} */ input) {
            calls.push(input);
            if (input.argv.join(' ') === 'ls-files --stage -z') return gitResult({stdout: `100644 ${shared} 0\tshared.mjs${'\0'}100644 ${added} 0\tadded.mjs\0`});
            if (input.argv.join(' ') === 'rev-parse --verify HEAD^{commit}') return gitResult({stdout: `${'c'.repeat(40)}\n`});
            if (input.argv.join(' ') === 'ls-tree -r -z HEAD') return gitResult({stdout: `100644 blob ${shared}\tshared.mjs\0`});
            if (input.argv.join(' ') === 'cat-file --batch') {
                return gitResult({stdout: `${shared} blob 7\nshared\n\n${added} blob 6\nadded\n\n`});
            }
            throw new Error(`Unexpected Git call: ${input.argv.join(' ')}`);
        },
    };

    const candidate = await readStagedCandidate({git});
    const batchCalls = calls.filter(call => call.argv.join(' ') === 'cat-file --batch');
    assert.equal(batchCalls.length, 1);
    assert.equal(required(batchCalls[0]).input?.toString('utf8'), `${shared}\n${added}\n`);
    assert.deepEqual(candidate.changedPaths, ['added.mjs']);
    assert.equal(required(candidate.files.get('shared.mjs')).bytes?.toString('utf8'), 'shared\n');
    assert.equal(required(candidate.headFiles.get('shared.mjs')).bytes?.toString('utf8'), 'shared\n');
});

test('生产 Repository State Inspector 收集真实 Git 与 .arwignore 事实', async t => {
    const root = await createRepository(t, {initialBranch: 'master', prefix: 'arw-inspector-git-'});
    await mkdir(join(root, 'src', 'generated'), {recursive: true});
    await writeFile(join(root, '.gitignore'), 'ignored.txt\n', 'utf8');
    await writeFile(join(root, '.arwignore'), 'src/generated/**\n', 'utf8');
    await writeFile(join(root, 'conflict.txt'), 'base\n', 'utf8');
    await writeFile(join(root, 'old.txt'), 'rename me\n', 'utf8');
    await writeFile(join(root, 'src', 'a.js'), 'export const a = true;\n', 'utf8');
    await writeFile(join(root, 'src', 'generated', 'drop.js'), 'export const drop = true;\n', 'utf8');
    await runGit(root, ['add', '.']);
    await runGit(root, ['commit', '--quiet', '-m', 'base']);
    await runGit(root, ['checkout', '--quiet', '-b', 'other']);
    await writeFile(join(root, 'conflict.txt'), 'other\n', 'utf8');
    await runGit(root, ['commit', '--quiet', '-am', 'other']);
    await runGit(root, ['checkout', '--quiet', 'master']);
    await writeFile(join(root, 'conflict.txt'), 'master\n', 'utf8');
    await runGit(root, ['commit', '--quiet', '-am', 'master']);
    await assert.rejects(runGit(root, ['merge', '--quiet', 'other']));
    await runGit(root, ['mv', 'old.txt', 'new.txt']);
    await writeFile(join(root, 'fresh.txt'), 'fresh\n', 'utf8');
    await writeFile(join(root, 'ignored.txt'), 'ignored\n', 'utf8');

    const inspector = createNodeRepositoryStateInspector({
        filesystem: createNodeRepositoryFilesystem(root),
        git: createNodeGitRunner(root),
        repositoryRoot: root,
    });
    const state = await inspector.inspect({
        repositoryLocation: root,
        request: {paths: ['.git/hooks/reviewer.toml', 'ignored.txt', 'src/generated/drop.js'], roots: ['src']},
    });

    assert.ok(state.git.trackedPaths.includes('src/a.js'));
    assert.ok(state.git.untracked.includes('fresh.txt'));
    assert.deepEqual(state.git.ignoredPaths, ['ignored.txt']);
    assert.ok(state.git.conflicts.includes('conflict.txt'));
    assert.ok(state.git.entries.some(entry => entry.code === 'R ' && entry.path === 'new.txt'));
    assert.ok(state.git.agentScopeExcludedPaths.some(path => path === 'src/generated/drop.js'));
    assert.deepEqual(state.git.excludedPaths, [
        '.git/hooks/reviewer.toml',
        'ignored.txt',
        'src/generated/drop.js',
    ]);
    assert.equal(state.files['ignored.txt'].observed.kind, 'file');
    assert.deepEqual(state.files['ignored.txt'].bytes, Buffer.from('ignored\n', 'utf8'));
});
