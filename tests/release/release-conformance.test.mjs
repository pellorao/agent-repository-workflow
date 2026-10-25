import {evaluateLanguageChecks} from '../../lib/arw-common/language-checks.mjs';
import assert from 'node:assert/strict';
import {chmod, mkdir, writeFile} from 'node:fs/promises';
import {delimiter, join, resolve} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {createRepository as createGitRepository} from '../helpers/repository-fixture.mjs';
import {createOrdinaryNodeProcessEnvironment, runExitedProcess} from '../helpers/process.mjs';
import {
    runReleaseConformanceCommand,
    runReleaseConformance,
    runReleaseConformanceCli,
} from '../../lib/release/release-conformance.mjs';
import {listPreTagArchiveKinds} from '../../lib/release/release-validation-registry.mjs';

const FIXTURE_EVIDENCE_DIRECTORY = resolve('release-conformance-evidence');
const FIXTURE_REPOSITORY_ROOT = resolve('release-conformance-repository');
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const BASELINE_COMMIT = '1123456789abcdef0123456789abcdef01234567';
const BASELINE_TREE = '2123456789abcdef0123456789abcdef01234567';
const preTagArchives = listPreTagArchiveKinds();
const createRepository = async (/** @type {test.TestContext} */ t) => {
    const repositoryRoot = await createGitRepository(t, {prefix: 'arw-release-conformance-'});
    return repositoryRoot;
};

const candidate = {
    baseline: {commit: BASELINE_COMMIT, kind: 'stable-tag', tag: '0.1.0', tree: BASELINE_TREE},
    changedPaths: ['lib/example.mjs'],
    commit: COMMIT,
    tree: COMMIT,
    version: '0.2.0',
};
const resolvedCandidate = async () => ({
    candidate: structuredClone(candidate),
    status: 'resolved',
});
const sourceCheckout = (/** @type {string} */ repositoryRoot) => ({candidate: structuredClone(candidate), repositoryRoot});

/** @param {Array<{chinese: number | null, english: number | null, other: number | null, path: string}>} rows */
const unconfiguredTerms = (rows = []) => ({contexts: [], diagnostics: [], languageComposition: rows,
    languageChecks: evaluateLanguageChecks({rules: [], rows}),
    source: {mode: 'release', source: {candidateTree: COMMIT, kind: 'candidate-tree'}}, status: 'passed'});

const passedDocumentTerms = async (/** @type {unknown} */ input) => {
    assert.deepEqual(/** @type {{request: unknown}} */ (input).request, {
        mode: 'release',
        source: {candidateTree: COMMIT, kind: 'candidate-tree'},
    });
    return {
        contexts: [{
            context: 'CONTEXT.md',
            diagnostics: [],
            status: /** @type {'passed'} */ ('passed'),
            summary: {diagnostics: 0, documents: 12, globalTerms: 8, localTerms: 3, uses: 24},
        }],
        diagnostics: [],
        languageComposition: [],
        languageChecks: {checks: [], status: 'unconfigured', uncovered: []},
        source: {mode: /** @type {'release'} */ ('release'), source: {candidateTree: COMMIT, kind: /** @type {'candidate-tree'} */ ('candidate-tree')}},
        status: /** @type {'passed'} */ ('passed'),
    };
};

const passedSourceCheckCommand = async (/** @type {string} */ file, /** @type {string[]} */ args) => ({
    exitCode: 0,
    stderr: '',
    stdout: file === 'pnpm' && args[0] === '--version' ? '11.4.0\n' : '',
});

const verifiedArchive = async (/** @type {{archiveKind: unknown, archivePath: unknown}} */ {archiveKind, archivePath}) => {
    if (typeof archiveKind !== 'string' || typeof archivePath !== 'string') throw new Error('Expected archive identity.');
    return {archiveKind, archivePath, entryCount: 1, status: 'verified'};
};

/** @typedef {Awaited<ReturnType<typeof runReleaseConformance>>} ConformanceResult */
/** @returns {Extract<ConformanceResult, {status: 'failed'}>} */
const requireFailed = (/** @type {ConformanceResult} */ result) => {
    assert.equal(result.status, 'failed');
    if (result.status !== 'failed') throw new Error('Expected failed Release Conformance result.');
    return result;
};
/** @returns {Extract<ConformanceResult, {status: 'passed'}>} */
const requirePassed = (/** @type {ConformanceResult} */ result) => {
    assert.equal(result.status, 'passed');
    if (result.status !== 'passed') throw new Error('Expected passed Release Conformance result.');
    return result;
};

/**
 * @param {import('node:test').TestContext} t
 * @param {(args: string[]) => Promise<{exitCode: number, stderr: string, stdout: string}>} runPnpm
 */
const runDevelopmentToolScenario = async (t, runPnpm) => {
    const repositoryRoot = await createRepository(t);
    /** @type {string[][]} */
    const commands = [];
    const result = await runReleaseConformance({
        checkDocumentTerms: passedDocumentTerms,
        evidenceDirectory: resolve(repositoryRoot, 'evidence'),
        phase: 'pre-tag',
        runCommand: async (/** @type {string} */ file, /** @type {string[]} */ args) => {
            commands.push([file, ...args]);
            if (file === 'git' && args[0] === 'ls-files') {
                return {exitCode: 0, stderr: '', stdout: ''};
            }
            if (file === 'pnpm') return runPnpm(args);
            return {exitCode: 0, stderr: '', stdout: ''};
        },
        sourceCheckout: sourceCheckout(repositoryRoot),
        verifyArchive: verifiedArchive,
    });
    return {commands, result};
};

test('release command adapter starts pnpm on the current platform', async t => {
    const commandDirectory = await createTemporaryDirectory(t, 'arw-release-command-');
    const windows = process.platform === 'win32';
    const commandPath = join(commandDirectory, windows ? 'pnpm.cmd' : 'pnpm');
    await writeFile(
        commandPath,
        windows
            ? '@echo off\r\nif "%~1"=="--version" (\r\n  echo 11.4.0\r\n  exit /b 0\r\n)\r\nexit /b 9\r\n'
            : '#!/bin/sh\nif [ "$1" = "--version" ]; then\n  printf "11.4.0\\n"\n  exit 0\nfi\nexit 9\n',
        'utf8',
    );
    if (!windows) await chmod(commandPath, 0o755);
    const env = createOrdinaryNodeProcessEnvironment();
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
    env[pathKey] = `${commandDirectory}${delimiter}${env[pathKey] ?? ''}`;
    const result = await runReleaseConformanceCommand('pnpm', ['--version'], {
        cwd: process.cwd(),
        env,
    });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout.trim(), /^11\.\d+\.\d+$/u);
    assert.equal(result.stderr, '');
});

test('release runner executes every pre-tag production check and allows a conforming candidate', async t => {
    const repositoryRoot = await createRepository(t);
    const evidenceDirectory = resolve(repositoryRoot, 'evidence');
    /** @type {Array<{archiveKind: unknown, archivePath: unknown, sourceDirectory?: string | null}>} */
    const archiveCalls = [];
    /** @type {string[][]} */
    const commands = [];
    const result = await runReleaseConformance({
        checkDocumentTerms: passedDocumentTerms,
        evidenceDirectory,
        phase: 'pre-tag',
        runCommand: async (/** @type {string} */ file, /** @type {string[]} */ args) => {
            commands.push([file, ...args]);
            if (file === 'git' && args[0] === 'ls-files') {
                return {exitCode: 0, stderr: '', stdout: 'z-last.mjs\0a-first.mjs\0'};
            }
            if (file === 'pnpm' && args[0] === '--version') {
                return {exitCode: 0, stderr: '', stdout: '11.4.0\n'};
            }
            return {exitCode: 0, stderr: '', stdout: ''};
        },
        verifyArchive: async options => {
            archiveCalls.push(options);
            return verifiedArchive(options);
        },
        sourceCheckout: sourceCheckout(repositoryRoot),
    });

    assert.deepEqual(result, {
        candidateVersion: '0.2.0',
        languageComposition: [],
        documentTerms: await passedDocumentTerms({request: {mode: 'release', source: {candidateTree: COMMIT, kind: 'candidate-tree'}}}),
        phase: 'pre-tag',
        status: 'passed',
        tagAllowed: true,
    });
    assert.deepEqual(archiveCalls.map(call => call.archiveKind), preTagArchives);
    assert.deepEqual(archiveCalls.map(call => call.archivePath), preTagArchives.map(kind => (
        join(evidenceDirectory, 'archives', ...kind.split('/')) + '.tar'
    )));
    assert.deepEqual(commands.filter(call => call[0] === 'node' && call[1] === '--check').map(call => call[2]), [
        'a-first.mjs',
        'z-last.mjs',
    ]);
    assert.deepEqual(commands.filter(call => call[0] === 'pnpm'), [
        ['pnpm', '--version'],
        ['pnpm', 'install', '--frozen-lockfile'],
        ['pnpm', 'typecheck'],
        ['pnpm', 'test'],
    ]);
    assert.ok(commands.some(call => call.join(' ') === 'node scripts/generate-install-arw.mjs --check'));
    assert.ok(commands.some(call => call.join(' ') === 'node scripts/check-workflow-distribution.mjs'));
    assert.ok(commands.some(call => call.join(' ') === 'node arw.mjs text check'));
    assert.ok(commands.some(call => call.join(' ') === 'git diff --check -- . :(exclude).idea/**'));
    assert.ok(commands.some(call => call.join(' ') === 'git diff --cached --check -- . :(exclude).idea/**'));
});

test('release runner rejects unavailable, failed, malformed, and unsupported pnpm versions without dependent commands', async t => {
    const cases = [
        {label: 'command failure', result: {exitCode: 3, stderr: 'pnpm failed', stdout: ''}},
        {label: 'malformed version', result: {exitCode: 0, stderr: '', stdout: 'not-semver\n'}},
        {label: 'prerelease version', result: {exitCode: 0, stderr: '', stdout: '11.0.0-rc.1\n'}},
        {label: 'below supported major', result: {exitCode: 0, stderr: '', stdout: '10.9.0\n'}},
        {label: 'above supported major', result: {exitCode: 0, stderr: '', stdout: '12.0.0\n'}},
    ];
    for (const item of cases) {
        await t.test(item.label, async t => {
            const {commands, result} = await runDevelopmentToolScenario(t, async () => item.result);
            assert.equal(result.status, 'failed');
            if (result.status !== 'failed') assert.fail('Expected Release Conformance to fail.');
            assert.deepEqual(result.diagnostics.map(({code, identity, path, stage}) => ({code, identity, path, stage})), [{
                code: 'pnpm-version-check-failed',
                identity: 'pnpm-version',
                path: 'package.json',
                stage: 'validation',
            }]);
            assert.deepEqual(commands.filter(call => call[0] === 'pnpm'), [['pnpm', '--version']]);
            assert.ok(commands.some(call => call.join(' ') === 'node scripts/generate-install-arw.mjs --check'));
        });
    }

    await t.test('spawn failure', async t => {
        const {commands, result} = await runDevelopmentToolScenario(t, async () => {
            throw Object.assign(new Error('spawn pnpm ENOENT'), {code: 'ENOENT'});
        });
        assert.equal(result.status, 'failed');
        if (result.status !== 'failed') assert.fail('Expected Release Conformance to fail.');
        assert.equal(result.diagnostics[0].code, 'pnpm-version-check-failed');
        assert.deepEqual(commands.filter(call => call[0] === 'pnpm'), [['pnpm', '--version']]);
    });
});

test('release runner skips typecheck and test after frozen install failure while continuing independent checks', async t => {
    const {commands, result} = await runDevelopmentToolScenario(t, async args => {
        if (args[0] === '--version') return {exitCode: 0, stderr: '', stdout: '11.4.0\n'};
        return {exitCode: 9, stderr: 'install failed', stdout: ''};
    });

    assert.equal(result.status, 'failed');
    if (result.status !== 'failed') assert.fail('Expected Release Conformance to fail.');
    assert.deepEqual(result.diagnostics.map(({code, identity, path, stage}) => ({code, identity, path, stage})), [{
        code: 'development-dependency-install-failed',
        identity: 'pnpm-frozen-install',
        path: 'pnpm-lock.yaml',
        stage: 'validation',
    }]);
    assert.deepEqual(commands.filter(call => call[0] === 'pnpm'), [
        ['pnpm', '--version'],
        ['pnpm', 'install', '--frozen-lockfile'],
    ]);
    assert.ok(commands.some(call => call.join(' ') === 'node arw.mjs text check'));
});

test('release runner aggregates independent typecheck and test failures after one frozen install', async t => {
    const {commands, result} = await runDevelopmentToolScenario(t, async args => {
        if (args[0] === '--version') return {exitCode: 0, stderr: '', stdout: '11.4.0\n'};
        if (args[0] === 'install') return {exitCode: 0, stderr: '', stdout: ''};
        return {exitCode: args[0] === 'typecheck' ? 4 : 5, stderr: `${args[0]} failed`, stdout: ''};
    });

    assert.equal(result.status, 'failed');
    if (result.status !== 'failed') assert.fail('Expected Release Conformance to fail.');
    assert.deepEqual(result.diagnostics.map(({code, identity, path, stage}) => ({code, identity, path, stage})), [
        {
            code: 'deterministic-test-suite-failed',
            identity: 'pnpm-test',
            path: 'package.json',
            stage: 'validation',
        },
        {
            code: 'javascript-typecheck-failed',
            identity: 'pnpm-typecheck',
            path: 'tsconfig.json',
            stage: 'validation',
        },
    ]);
    assert.deepEqual(commands.filter(call => call[0] === 'pnpm'), [
        ['pnpm', '--version'],
        ['pnpm', 'install', '--frozen-lockfile'],
        ['pnpm', 'typecheck'],
        ['pnpm', 'test'],
    ]);
});

test('release runner verifies only post-tag archive after exact local and remote tag resolution', async t => {
    const repositoryRoot = await createRepository(t);
    const evidenceDirectory = resolve(repositoryRoot, 'evidence');
    await mkdir(join(evidenceDirectory, 'archives', 'observations', 'windows'), {recursive: true});
    await writeFile(join(evidenceDirectory, 'archives', 'observations', 'windows', 'recommended.tar'), 'retained pre-tag evidence');
    /** @type {Array<{archiveKind: string, archivePath: string}>} */
    const archiveCalls = [];
    /** @type {string[][]} */
    const commands = [];
    const result = await runReleaseConformance({
        checkDocumentTerms: async () => assert.fail('post-tag must not rerun document terms'),
        evidenceDirectory,
        phase: 'post-tag',
        runCommand: async (file, args) => {
            commands.push([file, ...args]);
            return {exitCode: 0, stderr: '', stdout: ''};
        },
        verifyArchive: async options => {
            archiveCalls.push(options);
            return verifiedArchive(options);
        },
        sourceCheckout: sourceCheckout(repositoryRoot),
    });

    assert.deepEqual(result, {
        candidateVersion: '0.2.0',
        languageComposition: [],
        documentTerms: null,
        phase: 'post-tag',
        status: 'passed',
        tagAllowed: false,
    });
    assert.deepEqual(archiveCalls, [{
        archiveKind: 'post-tag',
        archivePath: join(evidenceDirectory, 'archives', 'post-tag.tar'),
    }]);
    assert.deepEqual(commands, []);
});

test('release runner rejects an unregistered publication archive', async t => {
    const repositoryRoot = await createRepository(t);
    const evidenceDirectory = resolve(repositoryRoot, 'evidence');
    await mkdir(join(evidenceDirectory, 'archives'), {recursive: true});
    await writeFile(join(evidenceDirectory, 'archives', 'failed.tar'), 'obsolete publication evidence');
    const result = await runReleaseConformance({
        checkDocumentTerms: async () => assert.fail('post-tag must not rerun document terms'),
        evidenceDirectory,
        phase: 'post-tag',
        runCommand: async () => assert.fail('post-tag must not run Source Checkout commands'),
        sourceCheckout: sourceCheckout(repositoryRoot),
        verifyArchive: async () => assert.fail('unexpected archive inventory must stop archive verification'),
    });

    assert.equal(result.status, 'failed');
    assert.deepEqual(result.diagnostics.map(({code, identity, path, stage}) => ({code, identity, path, stage})), [{
        code: 'unexpected-release-evidence-archive',
        identity: 'failed',
        path: 'archives/failed.tar',
        stage: 'archive',
    }]);
});

test('release runner maps phase archives and grants tag authorization only to passing pre-tag validation', async t => {
    const repositoryRoot = await createRepository(t);
    const evidenceDirectory = resolve(repositoryRoot, 'evidence');
    /** @type {string[]} */
    const calls = [];
    const common = {
        checkDocumentTerms: passedDocumentTerms,
        evidenceDirectory,
        runCommand: async (/** @type {string} */ file, /** @type {string[]} */ args) => {
            if (file === 'git' && args[0] === 'ls-files') return {exitCode: 0, stderr: '', stdout: ''};
            if (file === 'pnpm' && args[0] === '--version') return {exitCode: 0, stderr: '', stdout: '11.4.0\n'};
            return {exitCode: 0, stderr: '', stdout: ''};
        },
        verifyArchive: async (/** @type {{archiveKind: string, archivePath: string, sourceDirectory?: string | null}} */ options) => {
            calls.push(options.archiveKind);
            return verifiedArchive(options);
        },
        sourceCheckout: sourceCheckout(repositoryRoot),
    };
    const preTag = requirePassed(await runReleaseConformance({...common, phase: 'pre-tag'}));
    const postTag = requirePassed(await runReleaseConformance({...common, phase: 'post-tag'}));

    assert.deepEqual({
        phase: preTag.phase,
        status: preTag.status,
        tagAllowed: preTag.tagAllowed,
    }, {phase: 'pre-tag', status: 'passed', tagAllowed: true});
    assert.deepEqual({
        phase: postTag.phase,
        tagAllowed: postTag.tagAllowed,
    }, {phase: 'post-tag', tagAllowed: false});
    assert.deepEqual(calls, [...preTagArchives, 'post-tag']);
});

test('release diagnostics suppress dependent cascades and preserve trustworthy aggregation', async t => {
    const repositoryRoot = await createRepository(t);
    const evidenceDirectory = resolve(repositoryRoot, 'evidence');
    const result = await runReleaseConformance({
        checkDocumentTerms: passedDocumentTerms,
        evidenceDirectory,
        phase: 'pre-tag',
        runCommand: async () => assert.fail('archive failure must stop Source Checkout validation'),
        sourceCheckout: sourceCheckout(repositoryRoot),
        verifyArchive: async ({archiveKind}) => {
            if (archiveKind.endsWith('/plain')) throw new Error(`invalid archive ${archiveKind}`);
            return {status: 'verified'};
        },
    });

    assert.equal(result.status, 'failed');
    assert.deepEqual(result.diagnostics.map(({code, identity, path, stage}) => ({code, identity, path, stage})), [
        {
            code: 'invalid-release-evidence-archive',
            identity: 'scenarios/alpine/plain',
            path: 'archives/scenarios/alpine/plain.tar',
            stage: 'archive',
        },
        {
            code: 'invalid-release-evidence-archive',
            identity: 'scenarios/ubuntu/plain',
            path: 'archives/scenarios/ubuntu/plain.tar',
            stage: 'archive',
        },
        {
            code: 'invalid-release-evidence-archive',
            identity: 'scenarios/windows/plain',
            path: 'archives/scenarios/windows/plain.tar',
            stage: 'archive',
        },
    ]);
    assert.deepEqual(Object.keys(result), ['diagnostics', 'languageComposition', 'documentTerms', 'status']);
});

test('release CLI maps candidate failure before calling conformance', async () => {
    /** @type {string[]} */
    const stderr = [];
    /** @type {string[]} */
    const stdout = [];
    const exitCode = await runReleaseConformanceCli([
        '--evidence-directory',
        FIXTURE_EVIDENCE_DIRECTORY,
        '--phase',
        'pre-tag',
    ], {
        repositoryRoot: FIXTURE_REPOSITORY_ROOT,
        resolveCandidate: async () => ({
            diagnostics: [{
                code: 'dirty-candidate',
                message: 'Release candidate has staged, unstaged, or untracked changes.',
                stage: 'candidate',
            }],
            status: 'failed',
        }),
        run: async () => assert.fail('candidate failure must not call conformance'),
        stderr: value => stderr.push(value),
        stdout: value => stdout.push(value),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(stdout, []);
    assert.equal(stderr.join(''), 'release-conformance-finding: stage="repository" path="." code="candidate-dirty-candidate" identity="" message="Release candidate has staged, unstaged, or untracked changes."\n');
});

test('release runner aggregates structured syntax diagnostics for every tracked module', async t => {
    const repositoryRoot = await createRepository(t);
    /** @type {string[]} */
    const checked = [];
    const result = requireFailed(await runReleaseConformance({
        checkDocumentTerms: passedDocumentTerms,
        evidenceDirectory: resolve(repositoryRoot, 'evidence'),
        phase: 'pre-tag',
        runCommand: async (/** @type {string} */ file, /** @type {string[]} */ args) => {
            if (file === 'git' && args[0] === 'ls-files') {
                return {exitCode: 0, stderr: '', stdout: 'z-last.mjs\0a-first.mjs\0'};
            }
            if (file === 'node' && args[0] === '--check') {
                checked.push(args[1]);
                return {exitCode: 1, stderr: `invalid ${args[1]}`, stdout: ''};
            }
            if (file === 'pnpm' && args[0] === '--version') {
                return {exitCode: 0, stderr: '', stdout: '11.4.0\n'};
            }
            return {exitCode: 0, stderr: '', stdout: ''};
        },
        sourceCheckout: sourceCheckout(repositoryRoot),
        verifyArchive: async () => ({status: 'verified'}),
    }));

    assert.deepEqual(checked, ['a-first.mjs', 'z-last.mjs']);
    assert.deepEqual(result.diagnostics.map(({code, identity, path, stage}) => ({code, identity, path, stage})), [
        {code: 'syntax-check-failed', identity: 'a-first.mjs', path: 'a-first.mjs', stage: 'validation'},
        {code: 'syntax-check-failed', identity: 'z-last.mjs', path: 'z-last.mjs', stage: 'validation'},
    ]);
});

test('release runner converts every terms diagnostic and continues independent validation', async t => {
    const repositoryRoot = await createRepository(t);
    const result = requireFailed(await runReleaseConformance({
        checkDocumentTerms: async () => ({
            contexts: [{
                context: 'docs/CONTEXT.md',
                diagnostics: [{code: 'term-disallowed', column: 4, line: 12, name: 'Artifact', path: 'docs/example.md'}],
                status: 'failed',
                summary: {diagnostics: 1, documents: 12, globalTerms: 8, localTerms: 3, uses: 24},
            }],
            diagnostics: [],
            languageComposition: [{chinese: 80, english: 20, other: 0, path: 'docs/example.md'}],
            languageChecks: {checks: [], status: 'unconfigured', uncovered: ['docs/example.md']},
            source: {mode: 'release', source: {candidateTree: COMMIT, kind: 'candidate-tree'}},
            status: 'failed',
        }),
        evidenceDirectory: resolve(repositoryRoot, 'evidence'),
        phase: 'pre-tag',
        runCommand: passedSourceCheckCommand,
        sourceCheckout: sourceCheckout(repositoryRoot),
        verifyArchive: async () => ({status: 'verified'}),
    }));

    assert.equal(result.status, 'failed');
    assert.deepEqual(result.diagnostics, [{
        code: 'document-terms-term-disallowed',
        identity: '{"column":4,"line":12,"name":"Artifact"}',
        message: 'document-terms-finding: path="docs/example.md" line=12 column=4 code="term-disallowed" name="Artifact"',
        path: 'docs/example.md',
        stage: 'validation',
    }]);
    assert.deepEqual(result.languageComposition, [
        {chinese: 80, english: 20, other: 0, path: 'docs/example.md'},
    ]);

    const multiContext = requireFailed(await runReleaseConformance({
        checkDocumentTerms: async () => ({
            contexts: [
                {
                    context: 'docs/CONTEXT.md',
                    diagnostics: [{code: 'term-disallowed', column: 4, line: 12, name: 'Artifact', path: 'docs/example.md'}],
                    status: 'failed',
                    summary: {diagnostics: 1, documents: 12, globalTerms: 8, localTerms: 3, uses: 24},
                },
                {
                    context: 'packages/CONTEXT.md',
                    diagnostics: [],
                    status: 'passed',
                    summary: {diagnostics: 0, documents: 3, globalTerms: 2, localTerms: 0, uses: 5},
                },
            ],
            diagnostics: [],
            languageComposition: [],
            languageChecks: {checks: [], status: 'unconfigured', uncovered: []},
            source: {mode: 'release', source: {candidateTree: COMMIT, kind: 'candidate-tree'}},
            status: 'failed',
        }),
        evidenceDirectory: resolve(repositoryRoot, 'evidence'),
        phase: 'pre-tag',
        runCommand: passedSourceCheckCommand,
        sourceCheckout: sourceCheckout(repositoryRoot),
        verifyArchive: async () => ({status: 'verified'}),
    }));
    assert.deepEqual(multiContext.diagnostics.find(({code}) => code === 'document-terms-term-disallowed'), {
        code: 'document-terms-term-disallowed',
        identity: '{"column":4,"context":"docs/CONTEXT.md","line":12,"name":"Artifact"}',
        message: 'document-terms-finding: context="docs/CONTEXT.md" path="docs/example.md" line=12 column=4 code="term-disallowed" name="Artifact"',
        path: 'docs/example.md',
        stage: 'validation',
    });
});

test('release runner preserves empty and canonical Document Terms locator identities', async t => {
    const repositoryRoot = await createRepository(t);
    const result = requireFailed(await runReleaseConformance({
        checkDocumentTerms: async () => ({
            contexts: [],
            diagnostics: [
                {code: 'term-a', path: 'docs/a.md'},
                {
                    code: 'term-b',
                    column: 3,
                    line: 2,
                    name: 'A "B"',
                    path: 'docs/b.md',
                    related: [{path: 'a.md'}, {column: 2, line: 4, path: 'b.md'}],
                },
            ],
            languageComposition: [],
            languageChecks: {checks: [], status: 'unconfigured', uncovered: []},
            source: {mode: 'release', source: {candidateTree: COMMIT, kind: 'candidate-tree'}},
            status: 'failed',
        }),
        evidenceDirectory: resolve(repositoryRoot, 'evidence'),
        phase: 'pre-tag',
        runCommand: passedSourceCheckCommand,
        sourceCheckout: sourceCheckout(repositoryRoot),
        verifyArchive: async () => ({status: 'verified'}),
    }));

    assert.deepEqual(result.diagnostics, [
        {
            code: 'document-terms-term-a',
            identity: '',
            message: 'document-terms-finding: path="docs/a.md" code="term-a"',
            path: 'docs/a.md',
            stage: 'validation',
        },
        {
            code: 'document-terms-term-b',
            identity: '{"column":3,"line":2,"name":"A \\"B\\""}',
            message: 'document-terms-finding: path="docs/b.md" line=2 column=3 code="term-b" name="A \\"B\\"" related=[{"path":"a.md"},{"path":"b.md","line":4,"column":2}]',
            path: 'docs/b.md',
            stage: 'validation',
        },
    ]);
});

test('release runner rejects an invalid Document Terms success result', async t => {
    const repositoryRoot = await createRepository(t);
    const result = await runReleaseConformance({
        checkDocumentTerms: async () => ({diagnostics: [], status: 'passed'}),
        evidenceDirectory: resolve(repositoryRoot, 'evidence'),
        phase: 'pre-tag',
        runCommand: passedSourceCheckCommand,
        sourceCheckout: sourceCheckout(repositoryRoot),
        verifyArchive: async () => ({status: 'verified'}),
    });

    assert.equal(result.status, 'failed');
    assert.deepEqual(result.diagnostics.map(({path, stage}) => ({path, stage})), [{path: '.', stage: 'runtime'}]);
});

test('release conformance CLI forwards the absolute evidence directory and phase with global exits', async () => {
    /** @type {unknown[]} */
    const calls = [];
    /** @type {string[]} */
    const stdout = [];
    /** @type {string[]} */
    const stderr = [];
    /** @type {NonNullable<Parameters<typeof runReleaseConformanceCli>[1]>} */
    const dependencies = {
        repositoryRoot: FIXTURE_REPOSITORY_ROOT,
        resolveCandidate: async options => {
            calls.push({candidateOptions: options});
            return resolvedCandidate();
        },
        run: async options => {
            calls.push({conformanceOptions: options});
            return {
                candidateVersion: '0.2.0',
                languageComposition: [{chinese: 80, english: 20, other: 0, path: 'docs/example.md'}],
                documentTerms: unconfiguredTerms([{chinese: 80, english: 20, other: 0, path: 'docs/example.md'}]),
                phase: 'pre-tag',
                status: 'passed',
                tagAllowed: true,
            };
        },
        stderr: value => {
            stderr.push(value);
        },
        stdout: value => {
            stdout.push(value);
        },
    };

    assert.equal(await runReleaseConformanceCli([
        '--evidence-directory',
        FIXTURE_EVIDENCE_DIRECTORY,
        '--phase',
        'pre-tag',
    ], dependencies), 0);
    assert.deepEqual(calls, [{
        candidateOptions: {phase: 'pre-tag', remote: 'origin', repositoryRoot: FIXTURE_REPOSITORY_ROOT},
    }, {
        conformanceOptions: {
            evidenceDirectory: FIXTURE_EVIDENCE_DIRECTORY,
            phase: 'pre-tag',
            sourceCheckout: {candidate, repositoryRoot: FIXTURE_REPOSITORY_ROOT},
        },
    }]);
    assert.match(stdout.join(''), /candidate version 0.2.0 in pre-tag phase/);
    assert.match(stdout.join(''), /Uncovered documents: 1\.\ndocs\/example\.md/u);
    assert.equal(await runReleaseConformanceCli(['--phase', 'pre-tag'], dependencies), 2);
    assert.match(stderr.join(''), /--evidence-directory <absolute-directory> --phase <pre-tag\|post-tag>/);
});

test('release conformance CLI 在失败结果中仍显示可信语言表格', async () => {
    /** @type {string[]} */
    const stdout = [];
    /** @type {string[]} */
    const stderr = [];
    const exitCode = await runReleaseConformanceCli([
        '--evidence-directory', FIXTURE_EVIDENCE_DIRECTORY,
        '--phase', 'pre-tag',
    ], {
        repositoryRoot: FIXTURE_REPOSITORY_ROOT,
        resolveCandidate: resolvedCandidate,
        run: async () => ({
            diagnostics: [{
                code: 'example-failed',
                identity: '',
                message: 'Example failed.',
                path: '.',
                stage: 'validation',
            }],
            languageComposition: [{chinese: 100, english: 0, other: 0, path: 'docs/example.md'}],
            documentTerms: unconfiguredTerms([{chinese: 100, english: 0, other: 0, path: 'docs/example.md'}]),
            status: 'failed',
        }),
        stderr: value => stderr.push(value),
        stdout: value => stdout.push(value),
    });

    assert.equal(exitCode, 1);
    assert.match(stderr.join(''), /example-failed/u);
    assert.match(stdout.join(''), /Uncovered documents: 1\.\ndocs\/example\.md/u);
});

test('release conformance CLI serializes the actual pnpm validation sequence', async t => {
    const repositoryRoot = await createRepository(t);
    const evidenceDirectory = resolve(repositoryRoot, 'evidence');
    /** @type {string[][]} */
    const commands = [];
    /** @type {string[]} */
    const stdout = [];
    /** @type {string[]} */
    const stderr = [];

    const exitCode = await runReleaseConformanceCli([
        '--evidence-directory', evidenceDirectory,
        '--phase', 'pre-tag',
    ], {
        repositoryRoot,
        resolveCandidate: resolvedCandidate,
        run: options => runReleaseConformance({
            ...options,
            checkDocumentTerms: passedDocumentTerms,
            runCommand: async (/** @type {string} */ file, /** @type {string[]} */ args) => {
                commands.push([file, ...args]);
                if (file === 'git' && args[0] === 'ls-files') {
                    return {exitCode: 0, stderr: '', stdout: ''};
                }
                if (file === 'pnpm' && args[0] === '--version') {
                    return {exitCode: 0, stderr: '', stdout: '11.4.0\n'};
                }
                return {exitCode: 0, stderr: '', stdout: ''};
            },
            verifyArchive: verifiedArchive,
        }),
        stderr: value => stderr.push(value),
        stdout: value => stdout.push(value),
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(commands.filter(call => call[0] === 'pnpm'), [
        ['pnpm', '--version'],
        ['pnpm', 'install', '--frozen-lockfile'],
        ['pnpm', 'typecheck'],
        ['pnpm', 'test'],
    ]);
    assert.deepEqual(stderr, []);
    assert.equal(stdout.join(''), 'Release conformance passed for candidate version 0.2.0 in pre-tag phase.\n\nLanguage checks: unconfigured.\n');
});

test('scripts release conformance entry exposes the source-only CLI seam', async () => {
    const result = await runExitedProcess(process.execPath, [resolve('scripts/release-conformance.mjs'), '--unknown']);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /--evidence-directory <absolute-directory> --phase <pre-tag\|post-tag>/);
});

test('scripts release conformance entry rejects invalid arguments before Repository discovery', async t => {
    const cwd = await createTemporaryDirectory(t, 'arw-release-conformance-usage-');
    for (const args of [
        ['--evidence-directory', 'relative-evidence', '--phase', 'pre-tag'],
        ['--evidence-directory', resolve(cwd, 'evidence'), '--phase', 'unknown'],
    ]) {
        const result = await runExitedProcess(process.execPath, [resolve('scripts/release-conformance.mjs'), ...args], {cwd});
        assert.equal(result.exitCode, 2);
        assert.equal(result.stdout, '');
        assert.match(result.stderr, /--evidence-directory <absolute-directory> --phase <pre-tag\|post-tag>/);
    }
});

test('scripts release conformance entry serializes Repository discovery failure as one runtime finding', async t => {
    const cwd = await createTemporaryDirectory(t, 'arw-release-conformance-non-repository-');
    const result = await runExitedProcess(process.execPath, [
        resolve('scripts/release-conformance.mjs'),
        '--evidence-directory',
        resolve(cwd, 'evidence'),
        '--phase',
        'pre-tag',
    ], {cwd});
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, '');
    assert.equal(
        result.stderr,
        'release-conformance-finding: stage="runtime" path="." code="repository-discovery-failed" identity="" message="Unable to discover the nearest Git working-tree root."\n',
    );
});

test('release preserves complete configured judgments without turning language failures into tag blockers', async t => {
    const repositoryRoot = await createRepository(t);
    const terms = unconfiguredTerms([{path: 'docs/example.md', chinese: 0, english: 100, other: 0}]);
    terms.languageChecks = evaluateLanguageChecks({rules: [{name: 'docs', language: 'chinese', minPercentage: 80, include: ['docs/'], exclude: []}], rows: terms.languageComposition});
    const result = await runReleaseConformance({
        checkDocumentTerms: async () => terms,
        evidenceDirectory: resolve(repositoryRoot, 'evidence'), phase: 'pre-tag', sourceCheckout: sourceCheckout(repositoryRoot),
        verifyArchive: verifiedArchive,
        runCommand: async (file, args) => ({exitCode: 0, stderr: '', stdout: file === 'pnpm' && args[0] === '--version' ? '11.4.0\n' : ''}),
    });
    assert.equal(result.status, 'passed', JSON.stringify(result));
    if (result.status !== 'passed') assert.fail();
    assert.equal(result.tagAllowed, true);
    assert.deepEqual(result.documentTerms, terms);
});
