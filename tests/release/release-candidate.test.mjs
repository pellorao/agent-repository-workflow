import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {runGit} from '../helpers/git.mjs';
import {createRepository} from '../helpers/repository-fixture.mjs';
import {createNodeGitRunner} from '../../lib/common/git-process.mjs';
import {ARW_VERSION, parseArwVersion} from '../../lib/arw-common/identity.mjs';
import {resolveReleaseCandidate} from '../../lib/release/release-candidate.mjs';
import {loadReleaseValidationConfiguration} from '../../lib/release/release-validation-config.mjs';

const releaseConfiguration = await loadReleaseValidationConfiguration();
if (releaseConfiguration.status !== 'succeeded' || !('value' in releaseConfiguration)) throw new Error('Test requires valid release-validation.json.');
const CANONICAL_REMOTE = releaseConfiguration.value.repositories.sourceCheckout.url;

const CANDIDATE_COMMIT = '1'.repeat(40);
const CANDIDATE_TREE = '2'.repeat(40);
const BASELINE_COMMIT = '3'.repeat(40);
const BASELINE_TREE = '4'.repeat(40);
const EMPTY_TREE = '5'.repeat(40);
const REMOTE = 'origin';
const REMOTE_INVENTORY_QUERY = 'remote';
const REMOTE_URL_QUERY = 'remote get-url --all origin';
const REMOTE_TAG_QUERY = `ls-remote --tags origin refs/tags/${ARW_VERSION} refs/tags/${ARW_VERSION}^{}`;
/** @typedef {{exitCode: number, stderr: string, stdout: string}} CommandResult */
/** @typedef {{args: string[], file: string, options: {cwd: string, input?: Buffer | string}}} CommandCall */
/** @typedef {Awaited<ReturnType<typeof resolveReleaseCandidate>>} ResolutionResult */

/** @param {ResolutionResult} result */
const requireResolved = result => {
    if (result.status !== 'resolved' || !('candidate' in result) || result.candidate === undefined) throw new Error('Expected resolved release candidate.');
    return result.candidate;
};

/** @param {ResolutionResult} result */
const failureCode = result => result.status === 'failed' && 'diagnostics' in result ? result.diagnostics?.[0]?.code : undefined;
const git = (/** @type {string} */ repositoryRoot, /** @type {string[]} */ ...args) => runGit(repositoryRoot, args);

/** @param {Map<string, string | CommandResult>} entries */
const scriptedGit = entries => {
    /** @type {CommandCall[]} */
    const calls = [];
    const runCommand = async (/** @type {string} */ file, /** @type {string[]} */ args, /** @type {{cwd: string, input?: Buffer | string}} */ options) => {
        calls.push({args, file, options});
        const key = args.join(' ');
        const entry = entries.get(key);
        if (entry === undefined && key === REMOTE_INVENTORY_QUERY) return {exitCode: 0, stderr: '', stdout: 'origin\n'};
        if (entry === undefined && key === REMOTE_URL_QUERY) return {exitCode: 0, stderr: '', stdout: `${CANONICAL_REMOTE}\n`};
        if (entry === undefined && key === REMOTE_TAG_QUERY) return {exitCode: 0, stderr: '', stdout: ''};
        if (entry === undefined) return {exitCode: 1, stderr: `Unexpected command: ${key}`, stdout: ''};
        return typeof entry === 'string'
            ? {exitCode: 0, stderr: '', stdout: entry}
            : entry;
    };
    return {calls, runCommand};
};

test('release candidate resolves committed HEAD against the highest reachable lower stable version', async () => {
    const git = scriptedGit(new Map([
        ['rev-parse --verify HEAD', `${CANDIDATE_COMMIT}\n`],
        ['rev-parse --verify HEAD^{tree}', `${CANDIDATE_TREE}\n`],
        ['status --porcelain=v1 --untracked-files=all', ''],
        [`tag --merged ${CANDIDATE_COMMIT} --list`, '0.1.0\n0.1.9\npreview\n'],
        [`tag --list ${ARW_VERSION}`, ''],
        ['rev-parse --verify refs/tags/0.1.9^{commit}', `${BASELINE_COMMIT}\n`],
        [`rev-parse --verify ${BASELINE_COMMIT}^{tree}`, `${BASELINE_TREE}\n`],
        [`diff --name-only -z ${BASELINE_TREE} ${CANDIDATE_TREE} --`, 'z.mjs\0a.mjs\0'],
    ]));

    const result = await resolveReleaseCandidate({
        phase: 'pre-tag',
        remote: REMOTE,
        repositoryRoot: 'C:/repository',
        runCommand: git.runCommand,
    });

    assert.deepEqual(result, {
        candidate: {
            baseline: {
                commit: BASELINE_COMMIT,
                kind: 'stable-tag',
                tag: '0.1.9',
                tree: BASELINE_TREE,
            },
            changedPaths: ['a.mjs', 'z.mjs'],
            commit: CANDIDATE_COMMIT,
            tree: CANDIDATE_TREE,
            version: ARW_VERSION,
        },
        status: 'resolved',
    });
});



test('first release resolves an empty-tree baseline through the production Git stdin adapter', async t => {
    const repositoryRoot = await createRepository(t, {prefix: 'arw-release-candidate-'});
    await writeFile(join(repositoryRoot, 'README.md'), '# Candidate\n', 'utf8');
    await git(repositoryRoot, 'add', 'README.md');
    await git(repositoryRoot, 'commit', '-m', 'candidate');
    await git(repositoryRoot, 'remote', 'add', 'origin', CANONICAL_REMOTE);
    const runner = createNodeGitRunner(repositoryRoot);

    const runCommand = async (/** @type {string} */ file, /** @type {string[]} */ args, /** @type {{cwd: string, input?: Buffer | string}} */ {cwd, input}) => {
        if (args[0] === 'ls-remote') return {exitCode: 0, stderr: '', stdout: ''};
        assert.equal(file, 'git');
        const result = await runner.run({argv: args, cwd, input});
        return {
            exitCode: result.code ?? 1,
            stderr: result.stderr || result.failure || '',
            stdout: result.stdout.toString('utf8'),
        };
    };

    const result = await resolveReleaseCandidate({phase: 'pre-tag', remote: 'origin', repositoryRoot, runCommand});

    assert.equal(result.status, 'resolved');
    const candidate = requireResolved(result);
    assert.equal(candidate.baseline.commit, null);
    assert.equal(candidate.baseline.kind, 'empty-tree');
    assert.equal(candidate.baseline.tag, null);
    assert.match(candidate.baseline.tree, /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
    assert.equal((await git(repositoryRoot, 'cat-file', '-t', candidate.baseline.tree)).stdout.trim(), 'tree');
    assert.equal((await git(repositoryRoot, 'ls-tree', candidate.baseline.tree)).stdout, '');
    assert.deepEqual(candidate.changedPaths, ['README.md']);
});

test('release candidate rejects staged, unstaged, and untracked changes without a partial candidate', async () => {
    const git = scriptedGit(new Map([
        ['rev-parse --verify HEAD', `${CANDIDATE_COMMIT}\n`],
        ['rev-parse --verify HEAD^{tree}', `${CANDIDATE_TREE}\n`],
        ['status --porcelain=v1 --untracked-files=all', 'M  staged.mjs\n M unstaged.mjs\n?? untracked.mjs\n'],
    ]));

    const result = await resolveReleaseCandidate({
        phase: 'pre-tag',
        remote: REMOTE,
        repositoryRoot: 'C:/repository',
        runCommand: git.runCommand,
    });

    assert.deepEqual(result, {
        diagnostics: [{
            code: 'dirty-candidate',
            message: 'Release candidate has staged, unstaged, or untracked changes.',
            stage: 'candidate',
        }],
        status: 'failed',
    });
    assert.equal(Object.hasOwn(result, 'candidate'), false);
});

test('post-tag accepts only local and remote tags at the candidate commit', async () => {
    const baseline = {commit: BASELINE_COMMIT, kind: 'stable-tag', tag: '0.1.9', tree: BASELINE_TREE};
    const expectedCandidate = {
        baseline,
        changedPaths: ['a.mjs'],
        commit: CANDIDATE_COMMIT,
        tree: CANDIDATE_TREE,
        version: ARW_VERSION,
    };
    const git = scriptedGit(new Map([
        ['rev-parse --verify HEAD', `${CANDIDATE_COMMIT}\n`],
        ['rev-parse --verify HEAD^{tree}', `${CANDIDATE_TREE}\n`],
        ['status --porcelain=v1 --untracked-files=all', ''],
        [`tag --merged ${CANDIDATE_COMMIT} --list`, `0.1.9\n${ARW_VERSION}\n`],
        [`tag --list ${ARW_VERSION}`, `${ARW_VERSION}\n`],
        [REMOTE_TAG_QUERY, `${CANDIDATE_COMMIT}\trefs/tags/${ARW_VERSION}\n`],
        [`rev-parse --verify refs/tags/${ARW_VERSION}^{commit}`, `${CANDIDATE_COMMIT}\n`],
        ['rev-parse --verify refs/tags/0.1.9^{commit}', `${BASELINE_COMMIT}\n`],
        [`rev-parse --verify ${BASELINE_COMMIT}^{tree}`, `${BASELINE_TREE}\n`],
        [`diff --name-only -z ${BASELINE_TREE} ${CANDIDATE_TREE} --`, 'a.mjs\0'],
    ]));

    const result = await resolveReleaseCandidate({
        phase: 'post-tag',
        remote: REMOTE,
        repositoryRoot: 'C:/repository',
        runCommand: git.runCommand,
    });

    assert.deepEqual(result, {candidate: expectedCandidate, status: 'resolved'});
});

test('release candidate blocks a reachable stable version that is not lower than the candidate version', async () => {
    const higherVersion = `${parseArwVersion(ARW_VERSION).core[0] + 1n}.0.0`;
    const git = scriptedGit(new Map([
        ['rev-parse --verify HEAD', `${CANDIDATE_COMMIT}\n`],
        ['rev-parse --verify HEAD^{tree}', `${CANDIDATE_TREE}\n`],
        ['status --porcelain=v1 --untracked-files=all', ''],
        [`tag --list ${ARW_VERSION}`, ''],
        [`tag --merged ${CANDIDATE_COMMIT} --list`, `0.1.9\n${higherVersion}\n`],
    ]));

    const result = await resolveReleaseCandidate({
        phase: 'pre-tag',
        remote: REMOTE,
        repositoryRoot: 'C:/repository',
        runCommand: git.runCommand,
    });

    assert.equal(result.status, 'failed');
    assert.equal(failureCode(result), 'version-not-advanced');
    assert.equal(Object.hasOwn(result, 'candidate'), false);
});

test('post-tag distinguishes a missing tag from a tag pointing to another commit', async () => {
    const candidate = {
        baseline: {commit: BASELINE_COMMIT, kind: 'stable-tag', tag: '0.1.9', tree: BASELINE_TREE},
        changedPaths: ['a.mjs'],
        commit: CANDIDATE_COMMIT,
        tree: CANDIDATE_TREE,
        version: ARW_VERSION,
    };
    /** @type {[string, string][]} */
    const common = [
        ['rev-parse --verify HEAD', `${CANDIDATE_COMMIT}\n`],
        ['rev-parse --verify HEAD^{tree}', `${CANDIDATE_TREE}\n`],
        ['status --porcelain=v1 --untracked-files=all', ''],
    ];
    const missing = scriptedGit(new Map([...common, [`tag --list ${ARW_VERSION}`, '']]));
    const mismatch = scriptedGit(new Map([
        ...common,
        [`tag --list ${ARW_VERSION}`, `${ARW_VERSION}\n`],
        [`rev-parse --verify refs/tags/${ARW_VERSION}^{commit}`, `${'9'.repeat(40)}\n`],
    ]));

    const missingResult = await resolveReleaseCandidate({
        phase: 'post-tag',
        remote: REMOTE,
        repositoryRoot: 'C:/repository',
        runCommand: missing.runCommand,
    });
    const mismatchResult = await resolveReleaseCandidate({
        phase: 'post-tag',
        remote: REMOTE,
        repositoryRoot: 'C:/repository',
        runCommand: mismatch.runCommand,
    });

    assert.equal(failureCode(missingResult), 'missing-tag');
    assert.equal(failureCode(mismatchResult), 'tag-mismatch');
});

test('release candidate rejects every remote except origin before reading Git state', async () => {
    for (const remote of ['', 'upstream', 'C:/repository']) {
        const git = scriptedGit(new Map());
        const result = await resolveReleaseCandidate({
            phase: 'post-tag',
            remote,
            repositoryRoot: 'C:/repository',
            runCommand: git.runCommand,
        });

        assert.equal(result.status, 'failed');
        assert.equal(failureCode(result), 'malformed-input');
        assert.deepEqual(git.calls, []);
    }
});

test('release candidate rejects missing, extra, or different origin fetch URLs before remote tag queries', async () => {
    const cases = [
        {
            entries: new Map([[REMOTE_INVENTORY_QUERY, 'upstream\n']]),
            name: 'missing origin',
        },
        {
            entries: new Map([[REMOTE_URL_QUERY, `${CANONICAL_REMOTE}\nssh://git@example.invalid/extra.git\n`]]),
            name: 'extra fetch URL',
        },
        {
            entries: new Map([[REMOTE_URL_QUERY, 'https://gitlab.tranzvision.com.cn/verzeta/agent-repository-workflow.git\n']]),
            name: 'different fetch URL',
        },
    ];
    for (const item of cases) {
        const git = scriptedGit(item.entries);
        const result = await resolveReleaseCandidate({
            phase: 'pre-tag',
            remote: REMOTE,
            repositoryRoot: 'C:/repository',
            runCommand: git.runCommand,
        });

        assert.deepEqual(result, {
            diagnostics: [{
                code: 'remote-url-mismatch',
                message: 'Release candidate origin does not match the canonical remote.',
                stage: 'candidate',
            }],
            status: 'failed',
        }, item.name);
        assert.equal(git.calls.some(call => call.args[0] === 'ls-remote'), false, item.name);
    }
});



test('release candidate rejects an unsafe changed path as a baseline failure', async () => {
    const git = scriptedGit(new Map([
        ['rev-parse --verify HEAD', `${CANDIDATE_COMMIT}\n`],
        ['rev-parse --verify HEAD^{tree}', `${CANDIDATE_TREE}\n`],
        ['status --porcelain=v1 --untracked-files=all', ''],
        [`tag --list ${ARW_VERSION}`, ''],
        [`tag --merged ${CANDIDATE_COMMIT} --list`, '0.1.9\n'],
        ['rev-parse --verify refs/tags/0.1.9^{commit}', `${BASELINE_COMMIT}\n`],
        [`rev-parse --verify ${BASELINE_COMMIT}^{tree}`, `${BASELINE_TREE}\n`],
        [`diff --name-only -z ${BASELINE_TREE} ${CANDIDATE_TREE} --`, '../escape.mjs\0'],
    ]));

    const result = await resolveReleaseCandidate({
        phase: 'pre-tag',
        remote: REMOTE,
        repositoryRoot: 'C:/repository',
        runCommand: git.runCommand,
    });

    assert.equal(result.status, 'failed');
    assert.equal(failureCode(result), 'baseline-failure');
});
