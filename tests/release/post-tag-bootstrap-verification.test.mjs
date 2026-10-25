import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {runExitedProcess} from '../helpers/process.mjs';
import {
    PostTagBootstrapUsageError,
    acquireBootstrap,
    runPostTagBootstrapVerification,
    runPostTagBootstrapVerificationCli,
} from '../../lib/release/post-tag-bootstrap-verification.mjs';

/** @typedef {NonNullable<Parameters<typeof runPostTagBootstrapVerification>[1]>} PostTagAdapters */
/** @typedef {NonNullable<PostTagAdapters['acquireBootstrap']>} AcquireBootstrap */
/** @typedef {Parameters<AcquireBootstrap>[0]} AcquisitionRequest */
/** @typedef {NonNullable<PostTagAdapters['runProcess']>} RunProcess */
/** @typedef {{args: Parameters<RunProcess>[1], executable: Parameters<RunProcess>[0], options: Parameters<RunProcess>[2]}} ProcessCall */
/** @typedef {PostTagAdapters & Required<Pick<PostTagAdapters, 'acquireBootstrap' | 'createTemporaryDirectory' | 'materializeLauncher' | 'nodePath' | 'platform' | 'runProcess' | 'stderr' | 'stdout'>>} TestAdapters */

const sha256 = (/** @type {Buffer<ArrayBuffer> | import("crypto").BinaryLike} */ bytes) => createHash('sha256').update(bytes).digest('hex');
const version = '0.2.0';
const commit = '0123456789abcdef0123456789abcdef01234567';
const remote = 'https://github.com/pellorao/agent-repository-workflow.git';
const bootstrapPath = 'scripts/install-arw.mjs';
const candidateRepository = resolve('.tmp', 'candidate.git');

/** @returns {Array<Record<string, unknown>>} */
const childEvents = (/** @type {string} */ installerSha256) => [
    {event: 'release-selected', tag: version},
    {commit, event: 'tag-resolved', tag: version},
    {commit, event: 'checkout-verified'},
    {
        arguments: ['--release-tag', version, '--release-commit', commit, '--selection-mode', 'explicit'],
        event: 'installer-launched',
        path: 'install.mjs',
        sha256: installerSha256,
    },
];
/**
 * @param {{exitCode: number | null, signal?: NodeJS.Signals, stderr?: string, stdout?: string}} result
 * @returns {RunProcess}
 */
const processResult = ({exitCode, signal, stderr = '', stdout = ''}) => async (executable, args, options) => {
    options.onStdout(stdout);
    return {exitCode, signal: signal ?? null, stderr, stdout};
};

const createAdapters = async (/** @type {test.TestContext} */ t, /** @type {PostTagAdapters} */ overrides = {}) => {
    const temporaryDirectory = await createTemporaryDirectory(t, 'arw-post-tag-bootstrap-');
    const bootstrapBytes = Buffer.from('actual acquired Bootstrap bytes\n');
    const installerSha256 = 'b'.repeat(64);
    /** @type {string[]} */
    const stdout = [];
    /** @type {string[]} */
    const stderr = [];
    /** @type {{acquisitions: AcquisitionRequest[], processes: ProcessCall[]}} */
    const calls = {acquisitions: [], processes: []};
    /** @type {TestAdapters} */
    const adapters = {
        createTemporaryDirectory: async () => temporaryDirectory,
        acquireBootstrap: async request => {
            calls.acquisitions.push(request);
            return bootstrapBytes;
        },
        environment: {PATH: 'C:\\system'},
        materializeLauncher: async ({launcherPath}) => writeFile(launcherPath, 'fixture launcher', 'utf8'),
        nodePath: 'C:\\Program Files\\nodejs\\node.exe',
        platform: 'win32',
        runProcess: async (executable, args, options) => {
            calls.processes.push({args, executable, options});
            options.onStdout(`${childEvents(installerSha256).map(event => JSON.stringify(event)).join('\n')}\n`);
            return {
                exitCode: 0,
                signal: null,
                stderr: '',
                stdout: `${childEvents(installerSha256).map(event => JSON.stringify(event)).join('\n')}\n`,
            };
        },
        stderr: value => {
            stderr.push(String(value));
            return true;
        },
        stdout: value => {
            stdout.push(String(value));
            return true;
        },
        ...overrides,
    };
    return {
        adapters,
        bootstrapBytes,
        calls,
        installerSha256,
        stderr,
        stdout,
        temporaryDirectory,
    };
};

test('post-tag Bootstrap verification reports six actual events from one real child invocation', async t => {
    const fixture = await createAdapters(t);
    const result = await runPostTagBootstrapVerification({candidateRepository, version}, fixture.adapters);

    assert.deepEqual(result, {diagnostics: [], exitCode: 0, signal: null, status: 'completed'});
    assert.deepEqual(fixture.calls.acquisitions, [{candidateRepository, path: bootstrapPath, remote, tag: version}]);
    assert.equal(fixture.calls.processes.length, 1);
    const processCall = fixture.calls.processes[0];
    if (processCall === undefined) assert.fail('Expected one process call.');
    assert.equal(processCall.executable, fixture.adapters.nodePath);
    assert.deepEqual(processCall.args.slice(1), ['--version', version, '--verbose']);
    assert.equal(processCall.args[0], join(fixture.temporaryDirectory, 'install-arw.mjs'));
    assert.equal(processCall.options.cwd, fixture.temporaryDirectory);
    assert.match(processCall.options.env.PATH ?? '', new RegExp(`^${fixture.temporaryDirectory.replaceAll('\\', '\\\\')}`));
    assert.match(processCall.options.env.NODE_OPTIONS ?? '', /--import=/);
    assert.deepEqual(fixture.stdout.map(line => JSON.parse(line)), [
        {event: 'bootstrap-acquired', path: bootstrapPath, remote, sha256: sha256(fixture.bootstrapBytes), tag: version},
        {event: 'bootstrap-launched', path: 'install-arw.mjs', sha256: sha256(fixture.bootstrapBytes)},
        ...childEvents(fixture.installerSha256),
    ]);
    assert.deepEqual(fixture.stderr, []);
    await assert.rejects(readFile(join(fixture.temporaryDirectory, 'install-arw.mjs')), {code: 'ENOENT'});
});

test('production Bootstrap acquisition fetches the exact tag into the prepared candidate Repository and reads its file object', async () => {
    const bytes = Buffer.from('bootstrap bytes\n');
    /** @type {Array<{args: string[], cwd: string, encoding: BufferEncoding | null}>} */
    const calls = [];
    const result = await acquireBootstrap({candidateRepository, path: bootstrapPath, remote, tag: version}, {
        runGit: async request => {
            calls.push(request);
            if (request.args[0] === 'show') return bytes;
            if (request.args[0] === 'rev-parse' && request.args.includes('--is-bare-repository')) return 'true\n';
            if (request.args[0] === 'rev-parse') return `${commit}\n${commit}\n`;
            return '';
        },
    });

    assert.deepEqual(result, bytes);
    assert.deepEqual(calls, [
        {args: ['rev-parse', '--is-bare-repository'], cwd: candidateRepository, encoding: 'utf8'},
        {
            args: ['fetch', '--quiet', '--no-tags', remote, `refs/tags/${version}:refs/tags/${version}`],
            cwd: candidateRepository,
            encoding: 'utf8',
        },
        {
            args: [
                'rev-parse',
                'refs/heads/arw-validation^{commit}',
                `refs/tags/${version}^{commit}`,
            ],
            cwd: candidateRepository,
            encoding: 'utf8',
        },
        {
            args: ['show', `refs/tags/${version}:${bootstrapPath}`],
            cwd: candidateRepository,
            encoding: null,
        },
    ]);
});

test('production Bootstrap acquisition rejects a non-bare Repository, a tag mismatch, and non-byte Git show output', async () => {
    const cases = [
        {
            expected: /bare Repository/,
            runGit: async (/** @type {{ args: string | string[]; }} */ request) => request.args.includes('--is-bare-repository') ? 'false\n' : '',
        },
        {
            expected: /does not match/,
            runGit: async (/** @type {{ args: string | string[]; }} */ request) => {
                if (request.args.includes('--is-bare-repository')) return 'true\n';
                if (request.args[0] === 'rev-parse') return `${commit}\n${'9'.repeat(40)}\n`;
                return '';
            },
        },
        {
            expected: /did not return bytes/,
            runGit: async (/** @type {{ args: string | string[]; }} */ request) => {
                if (request.args.includes('--is-bare-repository')) return 'true\n';
                if (request.args[0] === 'rev-parse') return `${commit}\n${commit}\n`;
                return '';
            },
        },
    ];
    for (const item of cases) {
        await assert.rejects(
            acquireBootstrap({candidateRepository, path: bootstrapPath, remote, tag: version}, {runGit: item.runGit}),
            item.expected,
        );
    }
});

test('production Bootstrap acquisition propagates Git failures and rejects invalid reference output', async () => {
    const fetchFailure = new Error('fetch unavailable');
    await assert.rejects(
        acquireBootstrap({candidateRepository, path: bootstrapPath, remote, tag: version}, {
            runGit: async request => {
                if (request.args.includes('--is-bare-repository')) return 'true\n';
                if (request.args[0] === 'fetch') throw fetchFailure;
                return '';
            },
        }),
        error => error === fetchFailure,
    );

    const referenceCases = [
        {expected: /did not return text/, resolved: Buffer.from(`${commit}\n${commit}\n`)},
        {expected: /full object IDs/, resolved: `${commit}\nnot-an-object\n`},
    ];
    for (const item of referenceCases) {
        await assert.rejects(
            acquireBootstrap({candidateRepository, path: bootstrapPath, remote, tag: version}, {
                runGit: async request => {
                    if (request.args.includes('--is-bare-repository')) return 'true\n';
                    if (request.args[0] === 'rev-parse') return item.resolved;
                    return '';
                },
            }),
            item.expected,
        );
    }

    const showFailure = new Error('Bootstrap file is missing');
    await assert.rejects(
        acquireBootstrap({candidateRepository, path: bootstrapPath, remote, tag: version}, {
            runGit: async request => {
                if (request.args.includes('--is-bare-repository')) return 'true\n';
                if (request.args[0] === 'rev-parse') return `${commit}\n${commit}\n`;
                if (request.args[0] === 'show') throw showFailure;
                return '';
            },
        }),
        error => error === showFailure,
    );
});

test('production post-tag process adapter streams child events before close', async () => {
    const events = childEvents('b'.repeat(64));
    const source = [
        "import {writeSync} from 'node:fs';",
        `const events = ${JSON.stringify(events)};`,
        "writeSync(1, JSON.stringify(events[0]) + '\\n');",
        "setTimeout(() => writeSync(1, events.slice(1).map(JSON.stringify).join('\\n') + '\\n'), 100);",
    ].join('\n');
    /** @type {string[]} */
    const stdout = [];
    let completed = false;
    /** @type {() => void} */
    let observeFirstEvent = () => {};
    /** @type {Promise<void>} */
    const firstEvent = new Promise(resolveFirstEvent => {
        observeFirstEvent = resolveFirstEvent;
    });
    const run = runPostTagBootstrapVerification({candidateRepository, version}, {
        acquireBootstrap: async () => Buffer.from(source),
        stdout: value => {
            const text = String(value);
            stdout.push(text);
            if (JSON.parse(text).event === 'release-selected') observeFirstEvent();
            return true;
        },
    }).finally(() => {
        completed = true;
    });

    await firstEvent;
    assert.equal(completed, false);
    assert.equal((await run).status, 'completed');
    assert.deepEqual(stdout.slice(2).map(line => JSON.parse(line)), events);
});

test('post-tag Bootstrap verification rejects noncanonical versions before acquisition', async t => {
    const fixture = await createAdapters(t);
    await assert.rejects(
        runPostTagBootstrapVerification({candidateRepository, version: 'v0.2.0'}, fixture.adapters),
        error => error instanceof PostTagBootstrapUsageError,
    );
    assert.deepEqual(fixture.calls.acquisitions, []);
});

test('post-tag Bootstrap verification classifies acquisition, write, start, event, and cleanup failures', async t => {
    const cases = [
        {
            expectedExitCode: null,
            expectedSignal: null,
            expectedStages: ['acquisition'],
            overrides: {acquireBootstrap: async () => { throw new Error('acquisition unavailable'); }},
        },
        {
            expectedExitCode: null,
            expectedSignal: null,
            expectedStages: ['write'],
            overrides: {writeFile: async () => { throw new Error('write unavailable'); }},
        },
        {
            expectedExitCode: null,
            expectedSignal: null,
            expectedStages: ['bootstrap-start'],
            overrides: {runProcess: async () => { throw new Error('spawn unavailable'); }},
        },
        {
            expectedExitCode: 7,
            expectedSignal: null,
            expectedStages: ['bootstrap-exit'],
            overrides: {
                runProcess: processResult({
                    exitCode: 7,
                    stderr: 'Bootstrap failed.\n',
                    stdout: `${JSON.stringify(childEvents('b'.repeat(64))[0])}\n`,
                }),
            },
        },
        {
            expectedExitCode: null,
            expectedSignal: 'SIGTERM',
            expectedStages: ['bootstrap-exit'],
            overrides: {
                runProcess: processResult({exitCode: null, signal: 'SIGTERM'}),
            },
        },
        {
            expectedExitCode: 0,
            expectedSignal: null,
            expectedStages: ['event-forwarding'],
            overrides: {
                runProcess: processResult({exitCode: 0, stdout: '{not-json}\n'}),
            },
        },
        {
            expectedExitCode: null,
            expectedSignal: null,
            expectedStages: ['bootstrap-exit'],
            overrides: {
                runProcess: async () => ({exitCode: 0, stderr: ''}),
            },
        },
        {
            expectedExitCode: 7,
            expectedSignal: null,
            expectedStages: ['bootstrap-exit', 'cleanup'],
            overrides: {
                removeTemporaryDirectory: async () => { throw new Error('cleanup unavailable'); },
                runProcess: processResult({exitCode: 7}),
            },
        },
    ];
    for (const [index, item] of cases.entries()) {
        await t.test(String(index), async t => {
            const fixture = await createAdapters(t, item.overrides);
            const result = await runPostTagBootstrapVerification({candidateRepository, version}, fixture.adapters);
            assert.equal(result.status, 'failed');
            assert.equal(result.exitCode, item.expectedExitCode);
            assert.equal(result.signal, item.expectedSignal);
            assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.stage), item.expectedStages);
        });
    }
});

test('post-tag Bootstrap verification reports a missing launcher event separately from JSON forwarding', async t => {
    const fixture = await createAdapters(t, {
        runProcess: processResult({
            exitCode: 0,
            stderr: '',
            stdout: `${childEvents('b'.repeat(64)).slice(0, 3).map(event => JSON.stringify(event)).join('\n')}\n`,
        }),
    });
    const result = await runPostTagBootstrapVerification({candidateRepository, version}, fixture.adapters);
    assert.equal(result.status, 'failed');
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.stage), ['launcher']);
    assert.equal(fixture.stdout.length, 5);
});

test('post-tag Bootstrap verification classifies a nonzero child after checkout as a launcher failure', async t => {
    const fixture = await createAdapters(t, {
        runProcess: processResult({
            exitCode: 9,
            stderr: 'launcher failed\n',
            stdout: `${childEvents('b'.repeat(64)).slice(0, 3).map(event => JSON.stringify(event)).join('\n')}\n`,
        }),
    });
    const result = await runPostTagBootstrapVerification({candidateRepository, version}, fixture.adapters);
    assert.equal(result.exitCode, 9);
    assert.equal(result.signal, null);
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.stage), ['bootstrap-exit', 'launcher']);
});

test('post-tag Bootstrap verification preserves a valid prefix and child outcome before malformed output', async t => {
    /** @type {Array<{exitCode: number | null, signal: NodeJS.Signals | null}>} */
    const outcomes = [
        {exitCode: 9, signal: null},
        {exitCode: null, signal: 'SIGTERM'},
    ];
    for (const outcome of outcomes) {
        const prefix = childEvents('b'.repeat(64)).slice(0, 2);
        const fixture = await createAdapters(t, {
            runProcess: processResult({
                exitCode: outcome.exitCode,
                ...(outcome.signal === null ? {} : {signal: outcome.signal}),
                stderr: '',
                stdout: `${prefix.map(event => JSON.stringify(event)).join('\n')}\n{not-json}\n`,
            }),
        });
        const result = await runPostTagBootstrapVerification({candidateRepository, version}, fixture.adapters);

        assert.equal(result.exitCode, outcome.exitCode);
        assert.equal(result.signal, outcome.signal);
        assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.stage), ['bootstrap-exit', 'event-forwarding']);
        assert.deepEqual(fixture.stdout.slice(2).map(line => JSON.parse(line)), prefix);
    }
});

test('post-tag Bootstrap verification rejects malformed child event fields without comparing expected values', async t => {
    const cases = [
        {event: 'release-selected'},
        {event: 'release-selected', extra: true, tag: version},
        {event: 'release-selected', tag: 2},
        {tag: version, event: 'release-selected'},
    ];
    for (const [index, event] of cases.entries()) {
        await t.test(String(index), async t => {
            const events = childEvents('b'.repeat(64));
            events[0] = event;
            const fixture = await createAdapters(t, {
                runProcess: processResult({
                    exitCode: 0,
                    stderr: '',
                    stdout: `${events.map(item => JSON.stringify(item)).join('\n')}\n`,
                }),
            });
            const result = await runPostTagBootstrapVerification({candidateRepository, version}, fixture.adapters);
            assert.equal(result.status, 'failed');
            assert.equal(result.exitCode, 0);
            assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.stage), ['event-forwarding']);
            assert.equal(result.diagnostics[0]?.code, 'bootstrap-event-forwarding-failed');
        });
    }
});

test('post-tag Bootstrap verification CLI maps usage, execution failure, and completion to global exits', async () => {
    /** @type {Array<{candidateRepository: string, version: string}>} */
    const calls = [];
    /** @type {string[]} */
    const stdout = [];
    /** @type {string[]} */
    const stderr = [];
    /** @type {NonNullable<Parameters<typeof runPostTagBootstrapVerificationCli>[1]>} */
    const dependencies = {
        run: async (/** @type {{candidateRepository: string, version: string}} */ input) => {
            calls.push(input);
            return input.version === '0.2.0'
                ? {diagnostics: [], exitCode: 0, signal: null, status: 'completed'}
                : {diagnostics: [{code: 'failed', message: 'failed', stage: 'acquisition'}], exitCode: null, signal: null, status: 'failed'};
        },
        stderr: value => {
            stderr.push(String(value));
            return true;
        },
        stdout: value => {
            stdout.push(String(value));
            return true;
        },
    };
    assert.equal(await runPostTagBootstrapVerificationCli([
        '--version',
        '0.2.0',
        '--candidate-repository',
        candidateRepository,
    ], dependencies), 0);
    assert.deepEqual(calls[0], {candidateRepository, version: '0.2.0'});
    assert.equal(await runPostTagBootstrapVerificationCli([
        '--candidate-repository',
        candidateRepository,
        '--version',
        '0.3.0',
    ], dependencies), 1);
    assert.equal(await runPostTagBootstrapVerificationCli(['--unknown'], dependencies), 2);
    assert.equal(await runPostTagBootstrapVerificationCli([
        '--version',
        '0.2.0',
        '--candidate-repository',
        'relative-repository',
    ], dependencies), 2);
    assert.deepEqual(stdout, []);
    assert.match(stderr.join(''), /--candidate-repository <absolute-path>/);
});
