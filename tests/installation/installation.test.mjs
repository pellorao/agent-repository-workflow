import assert from 'node:assert/strict';
import {chmod, cp, link, mkdir, readFile, readdir, readlink, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

import {runExitedProcess, runSuccessfulProcess} from '../helpers/process.mjs';
import {runGit} from '../helpers/git.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {createRepository as createGitRepository} from '../helpers/repository-fixture.mjs';
import {completeGlobalConfigurationBytes} from '../../lib/arw-common/config.mjs';
import {ARW_VERSION, parseArwVersion} from '../../lib/arw-common/identity.mjs';
import {createSharedModelCatalog} from '../../lib/background-agent/model-catalog.mjs';
import {loadInstallationPayload} from '../../lib/installation/installation-payload.mjs';
import {installRelease as productionInstallRelease, parseInstallArguments, runInstaller as productionRunInstaller} from '../../lib/installation/installation.mjs';
import {createReleaseLoader} from '../../lib/installation/release.mjs';
import {createScopedFilesystem} from '../../lib/common/filesystem.mjs';

const maintenanceReady = async () => ({
    status: /** @type {'acquired'} */ ('acquired'),
    stoppedAgents: [],
});
/** @type {typeof productionInstallRelease} */
const installRelease = (decisions, options = {}) => productionInstallRelease(decisions, {
    acquireMaintenance: maintenanceReady,
    ...options,
});
/** @type {typeof productionRunInstaller} */
const runInstaller = (args, options = {}) => productionRunInstaller(args, {
    acquireMaintenance: maintenanceReady,
    ...options,
});

/** @typedef {NonNullable<Parameters<typeof runInstaller>[1]>} InstallerOptions */
/** @typedef {NonNullable<InstallerOptions['release']>} ReleaseSource */
/** @typedef {Omit<InstallerOptions, 'release'> & {release?: ReleaseSource}} NonInteractiveOverrides */
/** @typedef {{channel: 'stderr' | 'stdout', message: string}} InstallerMessage */
/** @typedef {{registerPath?: boolean, reinitializeConfig?: boolean, selectionMode?: 'explicit' | 'latest'}} NonInteractiveDecisions */
/** @typedef {NonNullable<InstallerOptions['windowsPath']>} WindowsPathAdapter */
/** @typedef {Parameters<WindowsPathAdapter['write']>[0]} WindowsPathUpdate */

const SOURCE_DIRECTORY = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const TEST_PAYLOAD_FILES = ['arw', 'arw.mjs'];
const TEST_PACKAGE_BYTES = await readFile(join(SOURCE_DIRECTORY, 'package.json'));
const TEST_INSTALLATION_PAYLOAD = {
    configSeedBytes: await readFile(join(SOURCE_DIRECTORY, 'config.install.json')),
    diagnostics: [],
    payload: await Promise.all(TEST_PAYLOAD_FILES.map(async path => ({
        bytes: await readFile(join(SOURCE_DIRECTORY, path)),
        path,
    }))),
    status: /** @type {'succeeded'} */ ('succeeded'),
    verificationPaths: ['config.install.json', ...TEST_PAYLOAD_FILES],
};
// The seed has no providers; installation completes the written configuration with the defaults.
const TEST_CONFIGURATION_DEFAULTS = JSON.parse(TEST_INSTALLATION_PAYLOAD.configSeedBytes.toString('utf8'));
TEST_CONFIGURATION_DEFAULTS.backgroundAgent.providers = {openai: {maxInstances: 4}, anthropic: {maxInstances: 4}};
const TEST_RELEASE_SOURCE = {
    arwVersion: ARW_VERSION,
    diagnostics: [],
    sourceDirectory: SOURCE_DIRECTORY,
    status: /** @type {'succeeded'} */ ('succeeded'),
};
const loadTestInstallationPayload = async (/** @type {unknown} */ input) => {
    if (input === null || typeof input !== 'object') assert.fail('Expected Installation Payload input.');
    assert.equal(typeof Reflect.get(input, 'platform'), 'string');
    assert.equal(typeof Reflect.get(input, 'sourceDirectory'), 'string');
    return TEST_INSTALLATION_PAYLOAD;
};
const LOCAL_SOURCE_PATHS = [
    'LICENSE.txt',
    'arw',
    'arw.cmd',
    'arw.mjs',
    'config.install.json',
    'distribution',
    'install.mjs',
    'lib',
    'package.json',
    'release-manifest.json',
    'uninstall.mjs',
];
const RELEASE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const RELEASE_ARGUMENTS = [
    '--release-tag',
    ARW_VERSION,
    '--release-commit',
    RELEASE_COMMIT,
    '--selection-mode',
    'latest',
];
const createHome = async (/** @type {test.TestContext} */ t) => {
    const home = await createTemporaryDirectory(t, 'agent-repository-workflow-home-');
    return home;
};

const copyLocalCheckout = async (/** @type {Parameters<typeof createTemporaryDirectory>[0]} */ t) => {
    const checkout = await createTemporaryDirectory(t, 'agent-repository-workflow-local-checkout-');
    await Promise.all(LOCAL_SOURCE_PATHS.map(async path => {
        await cp(join(SOURCE_DIRECTORY, path), join(checkout, path), {recursive: true});
    }));
    return checkout;
};

const COMPLETE_RUNTIME_MARKER = '\n// local checkout byte marker\n';
const completeInstallationFixture = await (async () => {
    /** @type {Parameters<typeof createTemporaryDirectory>[0]} */
    const cleanup = {after: callback => test.after(callback)};
    const home = await createTemporaryDirectory(cleanup, 'agent-repository-workflow-home-');
    const checkout = await copyLocalCheckout(cleanup);
    const markedRuntimePath = join(checkout, 'lib', 'arw-common', 'text-policy.mjs');
    await writeFile(
        markedRuntimePath,
        `${await readFile(markedRuntimePath, 'utf8')}${COMPLETE_RUNTIME_MARKER}`,
        'utf8',
    );
    const [payload, installed] = await Promise.all([
        loadInstallationPayload({platform: 'linux', sourceDirectory: checkout}),
        runSuccessfulProcess('node', [
            join(checkout, 'install.mjs'),
            '--non-interactive',
            '--reinitialize-config',
            'false',
            '--register-path',
            'false',
        ], {env: {...process.env, CODEX_HOME: '', HOME: home, USERPROFILE: home}}),
    ]);
    if (payload.status !== 'succeeded') assert.fail('Expected valid Installation Payload.');
    const fixture = {
        installation: join(home, '.agent-repository-workflow'),
        payload,
        stderr: installed.stderr,
        stdout: installed.stdout,
    };
    await rm(checkout, {force: true, recursive: true});
    return fixture;
})();

/**
 * @param {(request: Parameters<import('../../lib/common/filesystem.mjs').ScopedFilesystem['remove']>[0], remove: () => ReturnType<import('../../lib/common/filesystem.mjs').ScopedFilesystem['remove']>) => ReturnType<import('../../lib/common/filesystem.mjs').ScopedFilesystem['remove']>} remove
 * @returns {typeof createScopedFilesystem}
 */
const createFilesystemWithRemove = remove => async input => {
    const created = await createScopedFilesystem(input);
    if (created.status !== 'succeeded') return created;
    return {
        ...created,
        scopedFilesystem: {
            ...created.scopedFilesystem,
            remove: (/** @type {Parameters<import('../../lib/common/filesystem.mjs').ScopedFilesystem['remove']>[0]} */ request) => (
                remove(request, () => created.scopedFilesystem.remove(request))
            ),
        },
    };
};

test('Installer arguments select local only when every Release identity option is absent', () => {
    const local = parseInstallArguments([
        '--non-interactive',
        '--reinitialize-config',
        'false',
        '--register-path',
        'false',
    ]);
    assert.deepEqual(local.sourceRequest, {kind: 'local'});

    const release = parseInstallArguments([
        ...RELEASE_ARGUMENTS,
        '--non-interactive',
        '--reinitialize-config',
        'false',
        '--register-path',
        'false',
    ]);
    assert.deepEqual(release.sourceRequest, {
        evidence: {commit: RELEASE_COMMIT, explicitVersion: false, tag: ARW_VERSION},
        kind: 'release',
    });

    for (const releaseOptions of [
        ['--release-tag', ARW_VERSION],
        ['--release-commit', RELEASE_COMMIT],
        ['--selection-mode', 'latest'],
        ['--release-tag', ARW_VERSION, '--release-commit', RELEASE_COMMIT],
        ['--release-tag', ARW_VERSION, '--selection-mode', 'latest'],
        ['--release-commit', RELEASE_COMMIT, '--selection-mode', 'latest'],
    ]) {
        assert.throws(
            () => parseInstallArguments([
                ...releaseOptions,
                '--non-interactive',
                '--register-path',
                'false',
            ]),
            /Versioned installation requires/,
        );
    }
});

test('root Installer rejects invalid arguments before runtime identity observation', async t => {
    const checkout = await copyLocalCheckout(t);
    await rm(join(checkout, 'package.json'));

    const result = await runExitedProcess('node', [join(checkout, 'install.mjs'), '--release-tag', ARW_VERSION]);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /Versioned installation requires/);
    assert.doesNotMatch(result.stderr, /Runtime identity authority/);
});

test('root Installer maps prompt EOF to one stable pre-write error', async t => {
    const home = await createHome(t);
    const result = await runExitedProcess('node', [join(SOURCE_DIRECTORY, 'install.mjs')], {
        env: {...process.env, CODEX_HOME: '', HOME: home, USERPROFILE: home},
        input: '',
        timeout: 10_000,
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, 'Interactive input ended before a decision was provided.\n');
    await assert.rejects(readdir(join(home, '.agent-repository-workflow')), {code: 'ENOENT'});
});

const runNonInteractive = async (/** @type {string} */ home, /** @type {NonInteractiveOverrides} */ overrides = {}, /** @type {NonInteractiveDecisions} */ decisions = {}) => {
    /** @type {InstallerMessage[]} */
    const messages = [];
    const release = overrides.release ?? TEST_RELEASE_SOURCE;
    const releaseCommit = RELEASE_COMMIT;
    const releaseTag = ARW_VERSION;
    const result = await runInstaller(
        [
            ...RELEASE_ARGUMENTS.slice(0, 1),
            releaseTag,
            ...RELEASE_ARGUMENTS.slice(2, 3),
            releaseCommit,
            ...RELEASE_ARGUMENTS.slice(4, 5),
            decisions.selectionMode ?? 'latest',
            '--non-interactive',
            '--reinitialize-config',
            String(decisions.reinitializeConfig ?? false),
            '--register-path',
            String(decisions.registerPath ?? false),
        ],
        {
            environment: {HOME: home, USERPROFILE: home},
            platform: 'linux',
            sourceDirectory: SOURCE_DIRECTORY,
            stderr: message => messages.push({channel: 'stderr', message}),
            stdout: message => messages.push({channel: 'stdout', message}),
            loadInstallationPayload: loadTestInstallationPayload,
            ...overrides,
            release,
        },
    );

    return {messages, result};
};

const runLocalNonInteractive = async (/** @type {string} */ home, /** @type {InstallerOptions} */ overrides = {}, /** @type {NonInteractiveDecisions} */ decisions = {}) => {
    /** @type {InstallerMessage[]} */
    const messages = [];
    const result = await runInstaller(
        [
            '--non-interactive',
            '--reinitialize-config',
            String(decisions.reinitializeConfig ?? false),
            '--register-path',
            String(decisions.registerPath ?? false),
        ],
        {
            environment: {HOME: home, USERPROFILE: home},
            platform: 'linux',
            sourceDirectory: SOURCE_DIRECTORY,
            stderr: message => messages.push({channel: 'stderr', message}),
            stdout: message => messages.push({channel: 'stdout', message}),
            loadInstallationPayload: loadTestInstallationPayload,
            ...overrides,
        },
    );

    return {messages, result};
};

test('local source validation failures leave the Installation untouched', async t => {
    const home = await createHome(t);
    const checkout = await createTemporaryDirectory(t, 'agent-repository-workflow-local-source-');
    const packagePath = join(checkout, 'package.json');
    const blockedPayload = (/** @type {string} */ name) => ({
        diagnostics: [{code: `test-${name}`, message: `simulated ${name}`, severity: 'error'}],
        status: /** @type {'blocked'} */ ('blocked'),
    });
    const failedPayload = (/** @type {string} */ name) => ({
        diagnostics: [{code: `test-${name}`, message: `simulated ${name}`, severity: 'error'}],
        stage: 'payload-read',
        status: /** @type {'failed'} */ ('failed'),
    });
    const payloadWithConfigSeed = (/** @type {Buffer} */ configSeedBytes) => ({
        ...TEST_INSTALLATION_PAYLOAD,
        configSeedBytes: Buffer.from(configSeedBytes),
    });
    const cases = [
        {name: 'unsupported-platform', packageBytes: TEST_PACKAGE_BYTES, payloadResult: null, platform: 'freebsd'},
        {name: 'missing-package', packageBytes: null, payloadResult: null, platform: 'linux'},
        {name: 'malformed-package', packageBytes: Buffer.from('{'), payloadResult: null, platform: 'linux'},
        {name: 'missing-release-manifest', packageBytes: TEST_PACKAGE_BYTES, payloadResult: blockedPayload('missing-release-manifest'), platform: 'linux'},
        {name: 'payload-read-failure', packageBytes: TEST_PACKAGE_BYTES, payloadResult: failedPayload('payload-read-failure'), platform: 'linux'},
        {name: 'invalid-config-seed', packageBytes: TEST_PACKAGE_BYTES, payloadResult: payloadWithConfigSeed(Buffer.from('{')), platform: 'linux'},
        {name: 'invalid-utf8-config-seed', packageBytes: TEST_PACKAGE_BYTES, payloadResult: payloadWithConfigSeed(Buffer.concat([
            Buffer.from('{"agents":{},"configVersion":3,"editor":{"args":["{file}"],"command":"'),
            Buffer.from([0xff]),
            Buffer.from('"},"jira":{"listLimit":50},"reviewEditor":{"args":["--wait","{file}"],"command":"code"}}\n'),
        ])), platform: 'linux'},
    ];

    for (const {name, packageBytes, payloadResult, platform} of cases) {
        await rm(packagePath, {force: true});
        if (packageBytes !== null) await writeFile(packagePath, packageBytes);

        const attempted = await runLocalNonInteractive(home, {
            loadInstallationPayload: async input => {
                assert.deepEqual(input, {platform, sourceDirectory: checkout});
                if (payloadResult === null) assert.fail(`${name} must stop before Installation Payload.`);
                return payloadResult;
            },
            platform,
            sourceDirectory: checkout,
        });

        assert.equal(attempted.result, 1, name);
        assert.deepEqual(await readdir(home), [], name);
        assert.ok(attempted.messages.some(event => event.channel === 'stderr'), name);
    }
});

test('Installation consumes a closed source failure without entering the common payload lifecycle', async t => {
    const home = await createHome(t);
    const result = await installRelease({
        nonInteractive: true,
        registerPath: false,
        reinitializeConfig: false,
        sourceRequest: {evidence: {commit: RELEASE_COMMIT, explicitVersion: false, tag: ARW_VERSION}, kind: 'release'},
    }, {
        environment: {HOME: home},
        loadReleaseSource: async () => ({
            diagnostics: [{code: 'release-source-observation-failed', message: 'simulated source failure', severity: 'error'}],
            stage: 'git-observation',
            status: 'failed',
        }),
        platform: 'linux',
        sourceDirectory: SOURCE_DIRECTORY,
    });

    assert.deepEqual(result, {
        diagnostics: [{code: 'release-source-observation-failed', message: 'simulated source failure', severity: 'error'}],
        notices: [],
        operation: 'install',
        stage: 'preflight',
        status: 'unchanged',
        summary: null,
    });
    assert.deepEqual(await readdir(home), []);
});

test('Installation Payload applies ordinary unsafe-source failure to LICENSE.txt before reading it', async t => {
    const checkout = await createTemporaryDirectory(t, 'arw-unsafe-license-payload-');
    const distributionEntries = completeInstallationFixture.payload.payload.filter(entry => entry.path.startsWith('distribution/'));
    await Promise.all([...new Set(distributionEntries.map(entry => dirname(join(checkout, entry.path))))]
        .map(directory => mkdir(directory, {recursive: true})));
    await Promise.all([
        ...distributionEntries.map(entry => writeFile(join(checkout, entry.path), entry.bytes)),
        mkdir(join(checkout, 'LICENSE.txt')),
        writeFile(join(checkout, 'arw'), 'launcher\n'),
        writeFile(join(checkout, 'config.install.json'), '{}\n'),
        writeFile(join(checkout, 'release-manifest.json'), `${JSON.stringify({
            configSeed: 'config.install.json',
            distributionRoot: 'distribution',
            launchers: {darwin: ['arw'], linux: ['arw'], win32: ['arw']},
            runtimeFiles: ['LICENSE.txt'],
        }, null, 2)}\n`),
    ]);

    const result = await loadInstallationPayload({platform: 'linux', sourceDirectory: checkout});

    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), ['installation-source-unsafe']);
    assert.deepEqual(Object.keys(result).sort(), ['diagnostics', 'status']);
});

test('local source selection never invokes Release Git operations', async t => {
    const home = await createHome(t);
    /** @type {string[]} */
    const calls = [];
    const rejectGitObservation = (/** @type {string} */ name) => async () => {
        calls.push(name);
        throw new Error(`unexpected Release Git observation: ${name}`);
    };
    const attempted = await runLocalNonInteractive(home, {
        loadReleaseSource: createReleaseLoader({
            createFilesystem: createScopedFilesystem,
            git: {
                assertFilesMatch: rejectGitObservation('assertFilesMatch'),
                readHead: rejectGitObservation('readHead'),
                resolveTagCommit: rejectGitObservation('resolveTagCommit'),
            },
            loadInstallationPayload: loadTestInstallationPayload,
        }),
    });

    assert.equal(attempted.result, 0);
    assert.deepEqual(calls, []);
});

test('installation refuses busy or unknown maintenance before changing installed files', async t => {
    for (const status of /** @type {const} */ (['busy', 'unknown'])) {
        const home = await createHome(t);
        const installation = join(home, '.agent-repository-workflow');
        const result = await installRelease({
            nonInteractive: true,
            registerPath: false,
            reinitializeConfig: false,
            sourceRequest: {kind: 'local'},
        }, {
            acquireMaintenance: async () => ({status, reason: `${status} background work`, stoppedAgents: []}),
            environment: {HOME: home},
            loadInstallationPayload: loadTestInstallationPayload,
            platform: 'linux',
            sourceDirectory: SOURCE_DIRECTORY,
        });
        assert.equal(result.status, 'unchanged');
        assert.equal(result.stage, 'preflight');
        assert.equal(result.diagnostics[0]?.severity, 'error');
        assert.match(result.diagnostics[0]?.message ?? '', new RegExp(status));
        await assert.rejects(readdir(installation), {code: 'ENOENT'});
        await assert.rejects(readFile(join(home, '.codex', 'models.custom.json')), {code: 'ENOENT'});
    }
});

test('managed update leaves installed bytes intact when maintenance is busy', async t => {
    const home = await createHome(t);
    assert.equal((await runNonInteractive(home)).result, 0);
    const installation = join(home, '.agent-repository-workflow');
    const before = await Promise.all(['arw.mjs', 'config.json', 'manifest.json']
        .map(path => readFile(join(installation, path))));
    const attempted = await runNonInteractive(home, {
        acquireMaintenance: async () => ({status: 'busy', reason: 'active background work', stoppedAgents: []}),
    });
    assert.equal(attempted.result, 1);
    const after = await Promise.all(['arw.mjs', 'config.json', 'manifest.json']
        .map(path => readFile(join(installation, path))));
    assert.deepEqual(after, before);
    assert.ok(attempted.messages.some(event => event.channel === 'stderr' && event.message.includes('active background work')));
});

test('installation migrates Codex-era provider settings once and never changes the Codex file', async t => {
    const home = await createHome(t);
    const codexHome = join(home, '.codex');
    const customPath = join(codexHome, 'models.custom.json');
    const existing = Buffer.from('{"models":[{"slug":"user-model"}], "providers":{"openai":{"maxInstances":7},"deepseek":{"maxInstances":2}}, "userField": true}\n');
    await mkdir(codexHome);
    await writeFile(customPath, existing);

    const first = await runNonInteractive(home);

    assert.equal(first.result, 0);
    assert.ok(first.messages.some(event => event.message.includes('Migrated provider settings') && event.message.includes('deepseek')));
    const configPath = join(home, '.agent-repository-workflow', 'config.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    assert.deepEqual(config.backgroundAgent.providers, {openai: {maxInstances: 7}, anthropic: {maxInstances: 4}, deepseek: {maxInstances: 2}});
    assert.deepEqual(await readFile(customPath), existing);

    config.backgroundAgent.providers = {openai: {maxInstances: 5}};
    await writeFile(configPath, `${JSON.stringify(config)}\n`);
    const second = await runNonInteractive(home);
    assert.equal(second.result, 0);
    assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')).backgroundAgent.providers, {openai: {maxInstances: 5}, anthropic: {maxInstances: 4}});

    const legacyConfig = {...config, backgroundAgent: {maxInstances: 16}};
    await writeFile(configPath, `${JSON.stringify(legacyConfig)}\n`);
    assert.equal((await runNonInteractive(home)).result, 0);
    assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')).backgroundAgent.providers, {openai: {maxInstances: 7}, anthropic: {maxInstances: 4}, deepseek: {maxInstances: 2}});
});

test('installation without a Codex directory creates none and installs the provider defaults', async t => {
    const home = await createHome(t);

    const {result} = await runNonInteractive(home);

    assert.equal(result, 0);
    assert.deepEqual(await readdir(home), ['.agent-repository-workflow']);
    assert.deepEqual(JSON.parse(await readFile(join(home, '.agent-repository-workflow', 'config.json'), 'utf8')).backgroundAgent.providers, {
        openai: {maxInstances: 4}, anthropic: {maxInstances: 4},
    });
});

test('invalid existing custom model catalog blocks installation before maintenance or writes', async t => {
    for (const content of ['{"models":[', '[]', '{"models":[],"providers":null}', '{"models":[],"providers":{"openai":null}}']) {
        const home = await createHome(t);
        const codexHome = join(home, '.codex');
        const customPath = join(codexHome, 'models.custom.json');
        await mkdir(codexHome);
        await writeFile(customPath, content);
        let maintenanceCalled = false;
        const attempted = await runNonInteractive(home, {
            acquireMaintenance: async () => {
                maintenanceCalled = true;
                return maintenanceReady();
            },
        });
        assert.equal(attempted.result, 1);
        assert.equal(maintenanceCalled, false);
        assert.equal(await readFile(customPath, 'utf8'), content);
        await assert.rejects(readFile(join(home, '.agent-repository-workflow', 'config.json')), {code: 'ENOENT'});
    }
});

test('installation warns about a provider limit above the effective global limit but runtime rejects it', async t => {
    const home = await createHome(t);
    const installation = join(home, '.agent-repository-workflow');
    await mkdir(installation);
    const seed = JSON.parse(await readFile(join(SOURCE_DIRECTORY, 'config.install.json'), 'utf8'));
    await writeFile(join(installation, 'config.json'), `${JSON.stringify({
        ...seed, backgroundAgent: {...seed.backgroundAgent, maxInstances: 2, providers: {other: {maxInstances: 3}}},
    })}\n`);

    const installed = await runNonInteractive(home);
    assert.equal(installed.result, 0);
    assert.ok(installed.messages.some(event => event.channel === 'stderr'
        && event.message.includes('openai') && event.message.includes('4') && event.message.includes('2')));
    assert.ok(installed.messages.some(event => event.channel === 'stderr'
        && event.message.includes('other') && event.message.includes('3') && event.message.includes('2')));
    const config = JSON.parse(await readFile(join(installation, 'config.json'), 'utf8')).backgroundAgent;
    assert.equal(config.maxInstances, 2);
    const catalog = createSharedModelCatalog({
        runtimeDirectory: join(installation, 'background-agent-state'),
        maxInstances: 2,
        providers: config.providers,
    });
    await assert.rejects(catalog.getProviders(), /global limit/u);
});

test('installation writes the captured launcher payload and the completed configuration', async t => {
    const home = await createHome(t);
    const launcher = Buffer.from('#!/bin/sh\nnode arw.mjs "$@"\n');
    const seed = Buffer.from('{"configVersion":3,"agents":{},"editor":{"args":["{file}"],"command":"code"},"reviewEditor":{"args":["--wait","{file}"],"command":"code"},"jira":{"listLimit":50}}\n');
    const result = await installRelease({
        nonInteractive: true,
        registerPath: false,
        reinitializeConfig: false,
        sourceRequest: {evidence: {commit: RELEASE_COMMIT, explicitVersion: false, tag: '0.2.0'}, kind: 'release'},
    }, {
        environment: {HOME: home},
        loadInstallationPayload: async () => ({
            configSeedBytes: seed,
            diagnostics: [],
            payload: [{bytes: launcher, path: 'arw'}],
            status: 'succeeded',
            verificationPaths: [],
        }),
        platform: 'linux',
        release: {
            arwVersion: '0.2.0',
            diagnostics: [],
            sourceDirectory: SOURCE_DIRECTORY,
            status: 'succeeded',
        },
        sourceDirectory: SOURCE_DIRECTORY,
    });

    assert.equal(result.status, 'installed');
    assert.equal(await readFile(join(home, '.agent-repository-workflow', 'arw'), 'utf8'), launcher.toString('utf8'));
    assert.deepEqual(await readFile(join(home, '.agent-repository-workflow', 'config.json')), completeGlobalConfigurationBytes(seed).bytes);
});

test('first installation copies the complete runtime and executes the installed command independently of the source checkout', async t => {
    const {installation, payload, stdout} = completeInstallationFixture;
    const files = (await readdir(installation)).sort();
    const libraryFiles = (await readdir(join(installation, 'lib'))).sort();
    const config = JSON.parse(await readFile(join(installation, 'config.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(join(installation, 'manifest.json'), 'utf8'));

    assert.deepEqual(config, TEST_CONFIGURATION_DEFAULTS);
    assert.deepEqual(files, [
        'LICENSE.txt',
        'arw',
        'arw.mjs',
        'background-agent-state',
        'config.json',
        'distribution',
        'lib',
        'manifest.json',
        'uninstall.mjs',
    ]);
    assert.deepEqual(libraryFiles, [...new Set(payload.payload
        .filter(entry => entry.path.startsWith('lib/'))
        .map(entry => entry.path.split('/')[1]))].sort());
    assert.deepEqual(manifest.managedFiles, payload.payload.map(entry => entry.path));
    assert.deepEqual(await readFile(join(installation, 'LICENSE.txt')), await readFile(join(SOURCE_DIRECTORY, 'LICENSE.txt')));
    assert.equal(
        await readFile(join(installation, 'distribution', 'config.json'), 'utf8'),
        await readFile(join(SOURCE_DIRECTORY, 'distribution', 'config.json'), 'utf8'),
    );
    assert.equal(manifest.product, 'agent-repository-workflow');
    assert.equal(manifest.arwVersion, `${ARW_VERSION}-pre`);
    assert.equal(manifest.manifestVersion, 2);
    assert.equal(Object.hasOwn(manifest, 'releaseCommit'), false);
    assert.equal(Object.hasOwn(manifest, 'releaseTag'), false);
    assert.deepEqual(manifest.pathOwnership, []);
    assert.match(stdout, /Installed agent-repository-workflow to /u);
    assert.ok(stdout.includes(installation));

    const repository = await createGitRepository(t, {prefix: 'agent-repository-workflow-installed-terms-'});
    await writeFile(join(repository, 'CONTEXT.md'), '# Context\n\n## Language\n', 'utf8');
    const runtime = join(installation, 'arw.mjs');
    const [immediate, strict] = await Promise.all([
        runSuccessfulProcess('node', [runtime, 'terms', 'check'], {cwd: repository}),
        runSuccessfulProcess('node', [runtime, 'terms', 'check', '--strict'], {cwd: repository}),
    ]);
    assert.match(immediate.stdout, /^Document terms check passed\./u);
    assert.equal(immediate.stderr, '');
    assert.match(strict.stdout, /^Document terms check passed\./u);
    assert.equal(strict.stderr, '');
});

test('a residual planned-target collision is not adopted even when its bytes match the source', async t => {
    const home = await createHome(t);
    const installation = join(home, '.agent-repository-workflow');
    await mkdir(installation);
    const matchingRuntime = await readFile(join(SOURCE_DIRECTORY, 'arw.mjs'));
    await writeFile(join(installation, 'arw.mjs'), matchingRuntime);
    await writeFile(join(installation, 'unknown.txt'), 'keep me\n', 'utf8');

    const {messages, result} = await runNonInteractive(home);

    assert.equal(result, 1);
    assert.deepEqual(await readFile(join(installation, 'arw.mjs')), matchingRuntime);
    assert.equal(await readFile(join(installation, 'unknown.txt'), 'utf8'), 'keep me\n');
    await assert.rejects(readFile(join(installation, 'manifest.json'), 'utf8'), {code: 'ENOENT'});
    assert.ok(messages.some(event => event.message.includes('arw.mjs')));
});

test('default latest rejects downgrade while explicit release selection authorizes it', async t => {
    const home = await createHome(t);
    assert.equal((await runNonInteractive(home)).result, 0);
    const manifestPath = join(home, '.agent-repository-workflow', 'manifest.json');
    const newer = JSON.parse(await readFile(manifestPath, 'utf8'));
    const newerVersion = `${parseArwVersion(ARW_VERSION).core[0] + 1n}.0.0`;
    newer.arwVersion = newerVersion;
    await writeFile(manifestPath, `${JSON.stringify(newer, null, 2)}\n`, 'utf8');

    const rejected = await runNonInteractive(home);
    assert.equal(rejected.result, 1);
    assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).arwVersion, newerVersion);
    assert.ok(rejected.messages.some(event => event.message.includes('downgrade')));

    const installed = await runNonInteractive(home, {}, {selectionMode: 'explicit'});
    assert.equal(installed.result, 0);
    const downgraded = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(downgraded.arwVersion, ARW_VERSION);
    assert.equal(Object.hasOwn(downgraded, 'releaseCommit'), false);
    assert.equal(Object.hasOwn(downgraded, 'releaseTag'), false);
});

test('installation orders stable and fixed pre versions without weakening default downgrade protection', async t => {
    /** @type {Array<[string, string, string, boolean]>} */
    const cases = [
        ['new-pre-over-older-stable', '0.2.0', '0.2.1-pre', true],
        ['same-pre-repair', '0.2.1-pre', '0.2.1-pre', true],
        ['stable-over-same-pre', '0.2.1-pre', '0.2.1', true],
        ['pre-over-same-stable', '0.2.1', '0.2.1-pre', false],
        ['pre-under-newer-stable', '0.3.0', '0.2.1-pre', false],
        ['higher-pre-over-older-stable', '0.2.1', '0.3.0-pre', true],
    ];
    for (const [name, existingVersion, incomingVersion, accepted] of cases) {
        const home = await createHome(t);
        const baseRelease = TEST_RELEASE_SOURCE;
        const initial = await runNonInteractive(home, {release: {...baseRelease, arwVersion: existingVersion}});
        assert.equal(initial.result, 0, `${name} initial`);
        const installation = join(home, '.agent-repository-workflow');
        const manifestPath = join(installation, 'manifest.json');
        const runtimePath = join(installation, 'arw.mjs');
        const beforeManifest = await readFile(manifestPath, 'utf8');
        const beforeRuntime = await readFile(runtimePath);

        const attempted = await runNonInteractive(home, {release: {...baseRelease, arwVersion: incomingVersion}});

        assert.equal(attempted.result, accepted ? 0 : 1, name);
        assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).arwVersion, accepted ? incomingVersion : existingVersion, name);
        if (!accepted) {
            assert.equal(await readFile(manifestPath, 'utf8'), beforeManifest, name);
            assert.deepEqual(await readFile(runtimePath), beforeRuntime, name);
            assert.ok(attempted.messages.some(event => event.message.includes('downgrade')), name);
        }
    }
});

test('replacement removes the current managed runtime before a failed fresh install', async t => {
    const home = await createHome(t);
    assert.equal((await runLocalNonInteractive(home)).result, 0);
    const installation = join(home, '.agent-repository-workflow');
    await writeFile(join(installation, 'unknown.txt'), 'keep me\n', 'utf8');
    const manifest = JSON.parse(await readFile(join(installation, 'manifest.json'), 'utf8'));
    let removals = 0;

    const attempted = await runLocalNonInteractive(home, {
        createFilesystem: createFilesystemWithRemove(async (request, remove) => {
            const result = await remove();
            removals += 1;
            if (removals === manifest.managedFiles.length) {
                await mkdir(join(installation, 'arw.mjs'));
            }
            return result;
        }),
    });

    assert.equal(attempted.result, 1);
    await assert.rejects(readFile(join(installation, 'arw.mjs'), 'utf8'));
    assert.equal(JSON.parse(await readFile(join(installation, 'manifest.json'), 'utf8')).arwVersion, `${ARW_VERSION}-pre`);
    assert.deepEqual(JSON.parse(await readFile(join(installation, 'config.json'), 'utf8')), {
        agents: {},
        backgroundAgent: TEST_CONFIGURATION_DEFAULTS.backgroundAgent,
        configVersion: 3,
        editor: {args: ['{file}'], command: 'code'},
        jira: {listLimit: 50},
        reviewEditor: {args: ['--new-window', '--wait', '{file}'], command: 'code'},
        reviewers: TEST_CONFIGURATION_DEFAULTS.reviewers,
    });
    assert.equal(await readFile(join(installation, 'unknown.txt'), 'utf8'), 'keep me\n');
    assert.ok(attempted.messages.some(event => event.message.includes('manifest was not written')));
});

test('managed removal failure preserves the old manifest proof and retries forward', async t => {
    const home = await createHome(t);
    assert.equal((await runLocalNonInteractive(home)).result, 0);
    const installation = join(home, '.agent-repository-workflow');
    let removals = 0;
    const result = await installRelease({
        nonInteractive: true,
        registerPath: false,
        reinitializeConfig: false,
        sourceRequest: {kind: 'local'},
    }, {
        environment: {HOME: home},
        loadInstallationPayload: loadTestInstallationPayload,
        platform: 'linux',
        sourceDirectory: SOURCE_DIRECTORY,
        createFilesystem: createFilesystemWithRemove(async (_request, remove) => {
            if (removals === 1) {
                return {
                    diagnostics: [{code: 'injected-remove-failure', message: 'simulated managed removal failure'}],
                    stage: 'remove',
                    status: 'failed',
                };
            }
            removals += 1;
            return remove();
        }),
    });

    assert.equal(result.status, 'partial');
    assert.equal(result.stage, 'remove');
    assert.ok(result.notices.every(notice => !notice.startsWith('Manual cleanup required before retry:')));
    assert.equal(JSON.parse(await readFile(join(installation, 'manifest.json'), 'utf8')).product, 'agent-repository-workflow');
    assert.equal((await runLocalNonInteractive(home)).result, 0);
});

test('installation rejects linked runtime directories before writing outside the installation', async t => {
    const home = await createHome(t);
    const installation = join(home, '.agent-repository-workflow');
    const outside = join(home, 'outside');
    await mkdir(installation);
    await mkdir(outside);
    await symlink(outside, join(installation, 'lib'), process.platform === 'win32' ? 'junction' : 'dir');

    const attempted = await runNonInteractive(home, {loadInstallationPayload});

    assert.equal(attempted.result, 1);
    assert.match(attempted.messages.map(event => event.message).join('\n'), /linked|symbolic|runtime directory/i);
    assert.deepEqual(await readdir(outside), []);
    assert.deepEqual(await readdir(installation), ['lib']);
});

test('installation revalidates runtime parents after managed removal before each write', async t => {
    const home = await createHome(t);
    const linkedParentPayload = async () => ({
        configSeedBytes: TEST_INSTALLATION_PAYLOAD.configSeedBytes,
        diagnostics: [],
        payload: [
            {bytes: Buffer.from('#!/bin/sh\nnode arw.mjs "$@"\n'), path: 'arw'},
            {bytes: Buffer.from('runtime\n'), path: 'lib/runtime.mjs'},
        ],
        status: 'succeeded',
        verificationPaths: [],
    });
    assert.equal((await runLocalNonInteractive(home, {loadInstallationPayload: linkedParentPayload})).result, 0);
    const installation = join(home, '.agent-repository-workflow');
    const outside = join(home, 'outside-after-preflight');
    await mkdir(outside);
    const manifest = JSON.parse(await readFile(join(installation, 'manifest.json'), 'utf8'));
    let removals = 0;

    const attempted = await runLocalNonInteractive(home, {
        createFilesystem: createFilesystemWithRemove(async (_request, remove) => {
            const result = await remove();
            removals += 1;
            if (removals === manifest.managedFiles.length) {
                await rm(join(installation, 'lib'), {recursive: true});
                await symlink(outside, join(installation, 'lib'), process.platform === 'win32' ? 'junction' : 'dir');
            }
            return result;
        }),
        loadInstallationPayload: linkedParentPayload,
    });

    assert.equal(attempted.result, 1);
    assert.match(attempted.messages.map(event => event.message).join('\n'), /symbolic|link/u);
    assert.deepEqual(await readdir(outside), []);
    assert.equal(JSON.parse(await readFile(join(installation, 'manifest.json'), 'utf8')).product, 'agent-repository-workflow');
});

test('damaged and mismatched manifests fail closed without residual cleanup', async t => {
    for (const [name, manifestText] of [
        ['damaged', '{not json}\n'],
        ['missing-arw-version', '{"manifestVersion":2,"product":"agent-repository-workflow","managedFiles":[],"pathOwnership":[]}\n'],
        ['wrong-product', '{"arwVersion":"0.2.0","manifestVersion":2,"product":"other","managedFiles":[],"pathOwnership":[]}\n'],
        ['wrong-version', '{"arwVersion":"0.2.0","manifestVersion":1,"product":"agent-repository-workflow","managedFiles":[],"pathOwnership":[]}\n'],
        ['config-owned', '{"arwVersion":"0.2.0","manifestVersion":2,"product":"agent-repository-workflow","managedFiles":["config.json"],"pathOwnership":[]}\n'],
        ['case-config-owned', '{"arwVersion":"0.2.0","manifestVersion":2,"product":"agent-repository-workflow","managedFiles":["CONFIG.JSON"],"pathOwnership":[]}\n'],
        ['case-manifest-owned', '{"arwVersion":"0.2.0","manifestVersion":2,"product":"agent-repository-workflow","managedFiles":["Manifest.json"],"pathOwnership":[]}\n'],
        ['duplicate-program', '{"arwVersion":"0.2.0","manifestVersion":2,"product":"agent-repository-workflow","managedFiles":["old.mjs","old.mjs"],"pathOwnership":[]}\n'],
        ['case-duplicate-program', '{"arwVersion":"0.2.0","manifestVersion":2,"product":"agent-repository-workflow","managedFiles":["lib/old.mjs","lib/OLD.mjs"],"pathOwnership":[]}\n'],
        ['traversal-program', '{"arwVersion":"0.2.0","manifestVersion":2,"product":"agent-repository-workflow","managedFiles":["../outside.mjs"],"pathOwnership":[]}\n'],
        ['dot-segment-program', '{"arwVersion":"0.2.0","manifestVersion":2,"product":"agent-repository-workflow","managedFiles":["lib/../outside.mjs"],"pathOwnership":[]}\n'],
        ['empty-segment-program', '{"arwVersion":"0.2.0","manifestVersion":2,"product":"agent-repository-workflow","managedFiles":["lib//outside.mjs"],"pathOwnership":[]}\n'],
        ['backslash-program', '{"arwVersion":"0.2.0","manifestVersion":2,"product":"agent-repository-workflow","managedFiles":["lib\\\\outside.mjs"],"pathOwnership":[]}\n'],
        ['absolute-program', '{"arwVersion":"0.2.0","manifestVersion":2,"product":"agent-repository-workflow","managedFiles":["/outside.mjs"],"pathOwnership":[]}\n'],
    ]) {
        const home = await createHome(t);
        const installation = join(home, '.agent-repository-workflow');
        await mkdir(installation);
        await writeFile(join(installation, 'manifest.json'), manifestText, 'utf8');
        await writeFile(join(installation, 'manifest.json.tmp'), `${name}\n`, 'utf8');
        await writeFile(join(installation, 'unknown.txt'), 'keep\n', 'utf8');
        if (name === 'config-owned') {
            await writeFile(
                join(installation, 'config.json'),
                '{"configVersion":1,"editor":{"command":"nano","args":["{file}"]}}\n',
                'utf8',
            );
        }

        const refused = await runNonInteractive(home);

        assert.equal(refused.result, 1);
        assert.equal(await readFile(join(installation, 'manifest.json'), 'utf8'), manifestText);
        assert.equal(await readFile(join(installation, 'manifest.json.tmp'), 'utf8'), `${name}\n`);
        assert.equal(await readFile(join(installation, 'unknown.txt'), 'utf8'), 'keep\n');
        if (name === 'config-owned') {
            assert.equal(JSON.parse(await readFile(join(installation, 'config.json'), 'utf8')).editor.command, 'nano');
        }
    }
});

test('a non-file manifest stops before installation writes', async t => {
    const home = await createHome(t);
    const installation = join(home, '.agent-repository-workflow');
    await mkdir(join(installation, 'manifest.json'), {recursive: true});

    const attempted = await runNonInteractive(home);

    assert.equal(attempted.result, 1);
    assert.deepEqual(await readdir(installation), ['manifest.json']);
    assert.match(attempted.messages.map(event => event.message).join('\n'), /manifest.*real regular file/i);
});

test('existing configuration is upgraded, rejected, or reinitialized according to its state and decision', async t => {
    const validHome = await createHome(t);
    const validInstallation = join(validHome, '.agent-repository-workflow');
    const validConfig = {
        agents: {impl: {command: 'codex', args: []}},
        configVersion: 1,
        editor: {command: 'nano', args: ['--', '{file}']},
        extension: {enabled: true},
    };
    await mkdir(validInstallation);
    await writeFile(join(validInstallation, 'config.json'), `${JSON.stringify(validConfig)}\n`, 'utf8');

    const preserved = await runNonInteractive(validHome);

    assert.equal(preserved.result, 0);
    assert.deepEqual(JSON.parse(await readFile(join(validInstallation, 'config.json'), 'utf8')), {
        agents: validConfig.agents,
        backgroundAgent: TEST_CONFIGURATION_DEFAULTS.backgroundAgent,
        configVersion: 3,
        editor: validConfig.editor,
        extension: validConfig.extension,
        jira: {listLimit: 50},
        reviewEditor: {args: ['--new-window', '--wait', '{file}'], command: 'code'},
        reviewers: TEST_CONFIGURATION_DEFAULTS.reviewers,
    });
    const configurationNotices = preserved.messages.filter(event => event.channel === 'stdout').map(event => event.message);
    assert.ok(configurationNotices.includes('Configuration added path: backgroundAgent.maxInstances.'));
    assert.ok(configurationNotices.includes('Configuration added path: reviewers.requirements-reviewer.model.'));
    assert.ok(configurationNotices.includes('Configuration updated path: configVersion.'));
    assert.ok(configurationNotices.includes('Preserved unknown configuration path: extension.'));

    const currentHome = await createHome(t);
    const currentInstallation = join(currentHome, '.agent-repository-workflow');
    const currentBytes = Buffer.from(`${JSON.stringify({
        ...TEST_CONFIGURATION_DEFAULTS,
        editor: {command: 'nano', args: ['{file}']},
        extension: true,
        reviewEditor: {command: 'code', args: ['--wait', '{file}']},
    }, null, 2).replaceAll('\n', '\r\n')}\r\n`);
    await mkdir(currentInstallation);
    await writeFile(join(currentInstallation, 'config.json'), currentBytes);

    const current = await runNonInteractive(currentHome);

    assert.equal(current.result, 0);
    assert.deepEqual(await readFile(join(currentInstallation, 'config.json')), currentBytes);
    assert.equal(current.messages[0].message, 'Preserved unknown configuration path: extension.');

    for (const [name, content] of [
        ['unsupported', '{"configVersion":2,"editor":{"command":"code","args":["{file}"]}}\n'],
        ['invalid', '{not json}\n'],
    ]) {
        const home = await createHome(t);
        const installation = join(home, '.agent-repository-workflow');
        await mkdir(installation);
        await writeFile(join(installation, 'config.json'), content, 'utf8');
        await writeFile(join(installation, 'unknown.txt'), name, 'utf8');

        const refused = await runNonInteractive(home);

        assert.equal(refused.result, 1);
        assert.deepEqual((await readdir(installation)).sort(), ['config.json', 'unknown.txt']);
        assert.match(refused.messages.map(event => event.message).join('\n'), /Unsupported configuration version|valid JSON/i);

        const reinitialized = await runNonInteractive(home, {}, {reinitializeConfig: true});

        assert.equal(reinitialized.result, 0);
        assert.equal(JSON.parse(await readFile(join(installation, 'config.json'), 'utf8')).configVersion, 3);
        assert.equal(await readFile(join(installation, 'unknown.txt'), 'utf8'), name);
    }
});

test('configuration seed must be the current complete version for creation and reinitialize', async t => {
    const outdatedSeedPayload = {
        ...TEST_INSTALLATION_PAYLOAD,
        configSeedBytes: Buffer.from(`${JSON.stringify({
            agents: {},
            configVersion: 1,
            editor: {args: ['{file}'], command: 'nano'},
        }, null, 2)}\n`),
    };
    const loadOutdatedSeedPayload = async () => outdatedSeedPayload;

    const newHome = await createHome(t);
    const created = await runNonInteractive(newHome, {loadInstallationPayload: loadOutdatedSeedPayload});
    assert.equal(created.result, 1);
    await assert.rejects(readdir(join(newHome, '.agent-repository-workflow')), {code: 'ENOENT'});

    const existingHome = await createHome(t);
    assert.equal((await runLocalNonInteractive(existingHome)).result, 0);
    const installation = join(existingHome, '.agent-repository-workflow');
    const before = await readFile(join(installation, 'config.json'));
    const reinitialized = await runNonInteractive(
        existingHome,
        {loadInstallationPayload: loadOutdatedSeedPayload},
        {reinitializeConfig: true},
    );

    assert.equal(reinitialized.result, 1);
    assert.deepEqual(await readFile(join(installation, 'config.json')), before);
    assert.equal(JSON.parse(await readFile(join(installation, 'manifest.json'), 'utf8')).product, 'agent-repository-workflow');
});

test('configuration change notices are withheld when maintenance blocks before configuration writes', async t => {
    const home = await createHome(t);
    const installation = join(home, '.agent-repository-workflow');
    const configurationPath = join(installation, 'config.json');
    const original = '{"configVersion":1,"editor":{"args":["{file}"],"command":"nano"},"extension":{"enabled":true}}\n';
    await mkdir(installation);
    await writeFile(configurationPath, original);

    const attempted = await runNonInteractive(home, {
        acquireMaintenance: async () => ({status: 'unknown', stoppedAgents: [], reason: 'Unverified background process.'}),
    });

    assert.equal(attempted.result, 1);
    assert.equal(await readFile(configurationPath, 'utf8'), original);
    assert.deepEqual(await readdir(installation), ['config.json']);
    assert.ok(!attempted.messages.some(event => /^Configuration (?:added|removed|updated) path:/.test(event.message)));
    assert.ok(attempted.messages.some(event => event.message === 'Preserved unknown configuration path: extension.'));
});

test('configuration change notices remain accurate when a later installation step fails', async t => {
    const home = await createHome(t);
    const installation = join(home, '.agent-repository-workflow');
    const configurationPath = join(installation, 'config.json');
    await mkdir(installation);
    await writeFile(configurationPath, '{"configVersion":1,"editor":{"args":["{file}"],"command":"nano"}}\n');

    const attempted = await runNonInteractive(home, {
        writeManifest: async () => {throw new Error('Manifest commit failed after configuration writes.');},
    });

    assert.equal(attempted.result, 1);
    assert.equal(JSON.parse(await readFile(configurationPath, 'utf8')).configVersion, 3);
    assert.ok(attempted.messages.some(event => event.message === 'Configuration updated path: configVersion.'));
    assert.ok(attempted.messages.some(event => event.message === 'Configuration added path: backgroundAgent.maxInstances.'));
});

test('configuration replacement revalidates the complete current bytes after runtime writes', async t => {
    const home = await createHome(t);
    const installation = join(home, '.agent-repository-workflow');
    const configurationPath = join(installation, 'config.json');
    const original = Buffer.from('{"agents":{},"configVersion":1,"editor":{"args":["{file}"],"command":"nano"}}\n');
    const concurrent = Buffer.from('{"agents":{},"configVersion":1,"editor":{"args":["{file}"],"command":"vim"}}\n');
    await mkdir(installation);
    await writeFile(configurationPath, original);
    /** @type {InstallerMessage[]} */
    const messages = [];
    const result = await runInstaller(
        [...RELEASE_ARGUMENTS, '--non-interactive', '--reinitialize-config', 'false', '--register-path', 'true'],
        {
            environment: {USERPROFILE: home},
            loadInstallationPayload: loadTestInstallationPayload,
            platform: 'win32',
            release: TEST_RELEASE_SOURCE,
            sourceDirectory: SOURCE_DIRECTORY,
            stderr: message => messages.push({channel: 'stderr', message}),
            stdout: message => messages.push({channel: 'stdout', message}),
            windowsPath: {
                read: async () => {
                    await writeFile(configurationPath, concurrent);
                    return {exists: false, kind: null, value: ''};
                },
                write: async () => assert.fail('PATH must not be written after configuration drift.'),
                notify: async () => true,
            },
        },
    );

    assert.equal(result, 1);
    assert.deepEqual(await readFile(configurationPath), concurrent);
    await assert.rejects(readFile(join(installation, 'manifest.json')), {code: 'ENOENT'});
    assert.match(messages.map(event => event.message).join('\n'), /file state changed after preflight/i);
    assert.ok(!messages.some(event => /remove unowned installation path config\.json/u.test(event.message)));
});

test('configuration reset rejects symbolic and hard linked targets before writes', async t => {
    for (const kind of ['symbolic', 'hard']) {
        const home = await createHome(t);
        const installation = join(home, '.agent-repository-workflow');
        const external = join(home, `${kind}-external.json`);
        const content = '{"configVersion":1,"editor":{"args":["{file}"],"command":"nano"}}\n';
        await mkdir(installation);
        await writeFile(external, content, 'utf8');
        if (kind === 'symbolic') {
            try {
                await symlink(external, join(installation, 'config.json'), 'file');
            } catch (error) {
                if (error instanceof Error && 'code' in error && error.code === 'EPERM') continue;
                throw error;
            }
        } else {
            await link(external, join(installation, 'config.json'));
        }

        const attempted = await runNonInteractive(home, {}, {reinitializeConfig: true});

        assert.equal(attempted.result, 1, kind);
        assert.equal(await readFile(external, 'utf8'), content);
        await assert.rejects(readFile(join(installation, 'arw.mjs'), 'utf8'), {code: 'ENOENT'});
        assert.match(attempted.messages.map(event => event.message).join('\n'), /configuration.*link|link.*configuration/i);
    }
});

test('managed reinstall updates owned files and preserves unknown files and path ownership', async t => {
    const home = await createHome(t);
    const installation = join(home, '.agent-repository-workflow');
    assert.equal((await runNonInteractive(home)).result, 0);

    const manifestPath = join(installation, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.managedFiles.push('obsolete.mjs', 'retired/deep/obsolete.mjs');
    manifest.managedFiles.sort();
    manifest.pathOwnership.push({kind: 'linux-profile', profile: join(home, '.profile')});
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
    await writeFile(join(installation, 'obsolete.mjs'), 'obsolete\n', 'utf8');
    await mkdir(join(installation, 'retired', 'deep'), {recursive: true});
    await writeFile(join(installation, 'retired', 'deep', 'obsolete.mjs'), 'obsolete\n', 'utf8');
    await writeFile(join(installation, 'retired', 'keep.txt'), 'keep\n', 'utf8');
    await writeFile(join(installation, 'unknown.txt'), 'keep\n', 'utf8');
    await writeFile(join(installation, 'arw.mjs'), 'stale\n', 'utf8');

    const repeated = await runNonInteractive(home);
    const updatedManifest = JSON.parse(await readFile(manifestPath, 'utf8'));

    assert.equal(repeated.result, 0);
    assert.equal(await readFile(join(installation, 'unknown.txt'), 'utf8'), 'keep\n');
    await assert.rejects(readFile(join(installation, 'obsolete.mjs'), 'utf8'), error => error instanceof Error && 'code' in error && error.code === 'ENOENT');
    assert.deepEqual(await readdir(join(installation, 'retired')), ['keep.txt']);
    assert.equal(await readFile(join(installation, 'retired', 'keep.txt'), 'utf8'), 'keep\n');
    assert.notEqual(await readFile(join(installation, 'arw.mjs'), 'utf8'), 'stale\n');
    assert.deepEqual(updatedManifest.pathOwnership, [{kind: 'linux-profile', profile: join(home, '.profile')}]);
    assert.ok(!updatedManifest.managedFiles.includes('obsolete.mjs'));
});

test('managed reinstall migrates a flat installation to the nested runtime layout', async t => {
    const home = await createHome(t);
    const installation = join(home, '.agent-repository-workflow');
    const flatManagedFiles = [
        'artifacts.mjs',
        'config.mjs',
        'installation-contract.mjs',
        'issues.mjs',
        'repository.mjs',
        'arw',
        'arw.cmd',
        'arw.mjs',
        'uninstall.mjs',
        'uninstallation.mjs',
        'updater.mjs',
    ].sort();
    await mkdir(installation);
    for (const file of flatManagedFiles) {
        await writeFile(join(installation, file), `${file}\n`, 'utf8');
    }
    await writeFile(join(installation, 'config.json'), '{"configVersion":1,"editor":{"command":"code","args":["{file}"]}}\n', 'utf8');
    await writeFile(join(installation, 'unknown.txt'), 'keep\n', 'utf8');
    await writeFile(join(installation, 'manifest.json'), `${JSON.stringify({
        arwVersion: '0.2.0',
        managedFiles: flatManagedFiles,
        manifestVersion: 2,
        pathOwnership: [],
        product: 'agent-repository-workflow',
    })}\n`, 'utf8');

    const nestedArwBytes = await readFile(join(SOURCE_DIRECTORY, 'lib', 'arw.mjs'));
    const nestedPayload = {
        ...TEST_INSTALLATION_PAYLOAD,
        payload: [
            ...TEST_INSTALLATION_PAYLOAD.payload,
            {bytes: nestedArwBytes, path: 'lib/arw.mjs'},
            {bytes: await readFile(join(SOURCE_DIRECTORY, 'uninstall.mjs')), path: 'uninstall.mjs'},
        ],
        verificationPaths: ['config.install.json', 'arw', 'arw.mjs', 'lib/arw.mjs', 'uninstall.mjs'],
    };
    const repeated = await runNonInteractive(home, {loadInstallationPayload: async () => nestedPayload});

    assert.equal(repeated.result, 0);
    assert.equal(await readFile(join(installation, 'unknown.txt'), 'utf8'), 'keep\n');
    for (const file of flatManagedFiles.filter(file => file.endsWith('.mjs') && !['arw.mjs', 'uninstall.mjs'].includes(file))) {
        await assert.rejects(readFile(join(installation, file), 'utf8'), error => error instanceof Error && 'code' in error && error.code === 'ENOENT');
    }
    assert.deepEqual(await readFile(join(installation, 'lib', 'arw.mjs')), nestedArwBytes);
    assert.ok(JSON.parse(await readFile(join(installation, 'manifest.json'), 'utf8')).managedFiles.includes('lib/arw.mjs'));
});

test('interactive installation refuses an unowned noncanonical Linux marker', async t => {
    const home = await createHome(t);
    const profile = join(home, '.profile');
    /** @type {Array<'registerPath'>} */
    const prompts = [];
    await writeFile(
        profile,
        '# >>> agent-repository-workflow PATH >>>\nexport PATH="$PATH"\n# <<< agent-repository-workflow PATH <<<\n',
        'utf8',
    );

    const original = '# >>> agent-repository-workflow PATH >>>\nexport PATH="$PATH"\n# <<< agent-repository-workflow PATH <<<\n';
    /** @type {string[]} */
    const messages = [];
    const result = await runInstaller([
        '--release-tag',
        ARW_VERSION,
        '--release-commit',
        RELEASE_COMMIT,
        '--selection-mode',
        'latest',
    ], {
        environment: {HOME: home},
        loadInstallationPayload: loadTestInstallationPayload,
        platform: 'linux',
        prompt: async decision => {
            prompts.push(decision);
            return true;
        },
        release: TEST_RELEASE_SOURCE,
        sourceDirectory: SOURCE_DIRECTORY,
        stderr: message => messages.push(message),
        stdout: () => {},
    });

    assert.equal(result, 1);
    assert.deepEqual(prompts, ['registerPath']);
    assert.equal(await readFile(profile, 'utf8'), original);
    await assert.rejects(readFile(join(home, '.agent-repository-workflow', 'manifest.json'), 'utf8'), {code: 'ENOENT'});
    assert.ok(messages.some(message => message.includes('without prior manifest ownership')));
});

test('Linux profile registration rejects a hard linked ownership target before writes', async t => {
    const home = await createHome(t);
    const external = join(home, 'external-profile');
    const content = '# user profile\n';
    await writeFile(external, content, 'utf8');
    await link(external, join(home, '.profile'));

    const attempted = await runNonInteractive(home, {}, {registerPath: true});

    assert.equal(attempted.result, 1);
    assert.equal(await readFile(external, 'utf8'), content);
    await assert.rejects(readFile(join(home, '.agent-repository-workflow', 'arw.mjs'), 'utf8'), {code: 'ENOENT'});
    assert.match(attempted.messages.map(event => event.message).join('\n'), /linked.*ownership target/i);
});

test('Linux profile registration owns only the marker it actually writes', async t => {
    const ownedHome = await createHome(t);
    const ownedProfile = join(ownedHome, '.profile');
    await writeFile(ownedProfile, '# user profile\n', 'utf8');

    const installed = await runNonInteractive(ownedHome, {}, {registerPath: true});
    const ownedManifest = JSON.parse(await readFile(join(ownedHome, '.agent-repository-workflow', 'manifest.json'), 'utf8'));
    const profile = await readFile(ownedProfile, 'utf8');

    assert.equal(installed.result, 0);
    assert.match(profile, /# >>> agent-repository-workflow PATH >>>\nexport PATH="\$HOME\/\.agent-repository-workflow:\$PATH"\n# <<< agent-repository-workflow PATH <<</);
    assert.deepEqual(ownedManifest.pathOwnership, [{kind: 'linux-profile', profile: ownedProfile}]);

    const repeated = await runNonInteractive(ownedHome, {}, {registerPath: true});
    const repeatedManifest = JSON.parse(await readFile(join(ownedHome, '.agent-repository-workflow', 'manifest.json'), 'utf8'));
    assert.equal(repeated.result, 0);
    assert.equal(await readFile(ownedProfile, 'utf8'), profile);
    assert.deepEqual(repeatedManifest.pathOwnership, [{kind: 'linux-profile', profile: ownedProfile}]);

    const canonicalHome = await createHome(t);
    const canonicalProfile = join(canonicalHome, '.profile');
    const canonical = '# >>> agent-repository-workflow PATH >>>\nexport PATH="$HOME/.agent-repository-workflow:$PATH"\n# <<< agent-repository-workflow PATH <<<\n';
    await writeFile(canonicalProfile, canonical, 'utf8');

    const unownedCanonical = await runNonInteractive(canonicalHome, {}, {registerPath: true});
    const canonicalManifest = JSON.parse(await readFile(join(canonicalHome, '.agent-repository-workflow', 'manifest.json'), 'utf8'));
    assert.equal(unownedCanonical.result, 0);
    assert.equal(await readFile(canonicalProfile, 'utf8'), canonical);
    assert.deepEqual(canonicalManifest.pathOwnership, []);

    const equivalentHome = await createHome(t);
    const equivalentProfile = join(equivalentHome, '.profile');
    const existing = 'export PATH="$HOME/.agent-repository-workflow:$PATH"\n';
    await writeFile(equivalentProfile, existing, 'utf8');

    const equivalent = await runNonInteractive(equivalentHome, {}, {registerPath: true});
    const equivalentManifest = JSON.parse(await readFile(join(equivalentHome, '.agent-repository-workflow', 'manifest.json'), 'utf8'));

    assert.equal(equivalent.result, 0);
    assert.equal(await readFile(equivalentProfile, 'utf8'), existing);
    assert.deepEqual(equivalentManifest.pathOwnership, []);

    for (const misleading of [
        'export PATH="$PATH" # $HOME/.agent-repository-workflow\n',
        'export PATH="\\$HOME/.agent-repository-workflow:$PATH"\n',
        'export PATH="${HOME}/.agent-repository-workflow:$PATH"\n',
        'export PATH="/prefix$HOME/.agent-repository-workflow:$PATH"\n',
        'export PATH="$HOME/.agent-repository-workflow/bin:$PATH"\n',
    ]) {
        const home = await createHome(t);
        await writeFile(join(home, '.profile'), misleading, 'utf8');

        const registered = await runNonInteractive(home, {}, {registerPath: true});
        const manifest = JSON.parse(await readFile(join(home, '.agent-repository-workflow', 'manifest.json'), 'utf8'));

        assert.equal(registered.result, 0);
        assert.match(await readFile(join(home, '.profile'), 'utf8'), /# >>> agent-repository-workflow PATH >>>/);
        assert.deepEqual(manifest.pathOwnership, [{kind: 'linux-profile', profile: join(home, '.profile')}]);
    }
});

test('Linux profile registration blocks invalid UTF-8 before installation writes', async t => {
    const home = await createHome(t);
    const profile = join(home, '.profile');
    const invalid = Buffer.from([0x66, 0x80]);
    await writeFile(profile, invalid);

    const attempted = await runNonInteractive(home, {}, {registerPath: true});

    assert.equal(attempted.result, 1);
    assert.deepEqual(await readFile(profile), invalid);
    await assert.rejects(
        readFile(join(home, '.agent-repository-workflow', 'manifest.json')),
        {code: 'ENOENT'},
    );
    assert.match(attempted.messages.map(event => event.message).join('\n'), /encoded data was not valid|decod/iu);
});

test('Linux profile registration repairs owned blocks and rejects malformed markers during preflight', async t => {
    const ownedHome = await createHome(t);
    assert.equal((await runNonInteractive(ownedHome, {}, {registerPath: true})).result, 0);
    const ownedProfile = join(ownedHome, '.profile');
    await writeFile(
        ownedProfile,
        '# >>> agent-repository-workflow PATH >>>\nexport PATH="$PATH"\n# <<< agent-repository-workflow PATH <<<\n',
        'utf8',
    );

    const repaired = await runNonInteractive(ownedHome, {}, {registerPath: true});

    assert.equal(repaired.result, 0);
    assert.equal(
        await readFile(ownedProfile, 'utf8'),
        '# >>> agent-repository-workflow PATH >>>\nexport PATH="$HOME/.agent-repository-workflow:$PATH"\n# <<< agent-repository-workflow PATH <<<\n',
    );

    for (const content of [
        'prefix # >>> agent-repository-workflow PATH >>>\nexport PATH="$HOME/.agent-repository-workflow:$PATH"\n# <<< agent-repository-workflow PATH <<<\n',
        '# >>> agent-repository-workflow PATH >>>\nexport PATH="$HOME/.agent-repository-workflow:$PATH"\n',
        '# <<< agent-repository-workflow PATH <<<\n',
        '# >>> agent-repository-workflow PATH >>>\n# >>> agent-repository-workflow PATH >>>\n# <<< agent-repository-workflow PATH <<<\n# <<< agent-repository-workflow PATH <<<\n',
        '# <<< agent-repository-workflow PATH <<<\nexport PATH="$HOME/.agent-repository-workflow:$PATH"\n# >>> agent-repository-workflow PATH >>>\n',
    ]) {
        const home = await createHome(t);
        const profile = join(home, '.profile');
        await writeFile(profile, content, 'utf8');

        const rejected = await runNonInteractive(home, {}, {registerPath: true});

        assert.equal(rejected.result, 1);
        assert.equal(await readFile(profile, 'utf8'), content);
        assert.deepEqual(await readdir(home), ['.profile']);
        assert.match(rejected.messages.map(event => event.message).join('\n'), /malformed agent-repository-workflow marker/i);
    }
});

test('PowerShell and Git Bash share one Windows installation and current-user PATH', async t => {
    const windowsHome = await createHome(t);
    const gitBashHome = await createHome(t);
    let userPath = 'C:\\Tools;;';
    /** @type {string[]} */
    const messages = [];
    /** @type {WindowsPathUpdate[]} */
    const windowsWrites = [];
    /** @type {WindowsPathAdapter} */
    const windowsPath = {
        read: async () => ({exists: true, kind: 'ExpandString', value: userPath}),
        write: async update => {
            windowsWrites.push(update);
            userPath = update.value;
        },
        notify: async () => true,
    };
    const gitBashResult = await runInstaller(
        [...RELEASE_ARGUMENTS, '--non-interactive', '--reinitialize-config', 'false', '--register-path', 'true'],
        {
            environment: {HOME: gitBashHome, MSYSTEM: 'MINGW64', USERPROFILE: windowsHome},
            loadInstallationPayload: loadTestInstallationPayload,
            platform: 'win32',
            release: TEST_RELEASE_SOURCE,
            sourceDirectory: SOURCE_DIRECTORY,
            stderr: message => assert.fail(message),
            stdout: message => messages.push(message),
            windowsPath,
        },
    );
    const installation = join(windowsHome, '.agent-repository-workflow');
    const gitBashManifest = JSON.parse(await readFile(join(installation, 'manifest.json'), 'utf8'));

    assert.equal(gitBashResult, 0);
    assert.deepEqual(windowsWrites, [{kind: 'ExpandString', value: `C:\\Tools;;${installation}`}]);
    assert.deepEqual(gitBashManifest.pathOwnership, [{createdValue: false, entry: installation, kind: 'windows-user-path', valueKind: 'ExpandString'}]);
    assert.deepEqual(await readdir(gitBashHome), []);
    assert.ok(messages.includes('Registered agent-repository-workflow in the current user PATH. Requested Windows environment refresh; the current shell still uses its previous environment.'));

    const repeated = await runInstaller(
        [...RELEASE_ARGUMENTS, '--non-interactive', '--reinitialize-config', 'false', '--register-path', 'true'],
        {
            environment: {USERPROFILE: windowsHome},
            loadInstallationPayload: loadTestInstallationPayload,
            platform: 'win32',
            release: TEST_RELEASE_SOURCE,
            sourceDirectory: SOURCE_DIRECTORY,
            stderr: message => assert.fail(message),
            stdout: message => messages.push(message),
            windowsPath,
        },
    );
    const repeatedManifest = JSON.parse(await readFile(join(installation, 'manifest.json'), 'utf8'));

    assert.equal(repeated, 0);
    assert.equal(windowsWrites.length, 1);
    assert.equal(messages.filter(message => message.startsWith('Registered agent-repository-workflow')).length, 1);
    assert.deepEqual(repeatedManifest.pathOwnership, [{createdValue: false, entry: installation, kind: 'windows-user-path', valueKind: 'ExpandString'}]);

    const equivalentHome = await createHome(t);
    /** @type {WindowsPathUpdate[]} */
    const equivalentWrites = [];
    const equivalentInstallation = join(equivalentHome, '.agent-repository-workflow');
    const equivalent = await runInstaller(
        [...RELEASE_ARGUMENTS, '--non-interactive', '--reinitialize-config', 'false', '--register-path', 'true'],
        {
            environment: {USERPROFILE: equivalentHome},
            loadInstallationPayload: loadTestInstallationPayload,
            platform: 'win32',
            release: TEST_RELEASE_SOURCE,
            sourceDirectory: SOURCE_DIRECTORY,
            stderr: message => assert.fail(message),
            stdout: () => {},
            windowsPath: {
                read: async () => ({exists: true, kind: 'String', value: `${equivalentInstallation.toUpperCase()}\\;C:\\Tools`}),
                write: async value => {
                    equivalentWrites.push(value);
                },
                notify: async () => true,
            },
        },
    );
    const equivalentManifest = JSON.parse(await readFile(join(equivalentInstallation, 'manifest.json'), 'utf8'));

    assert.equal(equivalent, 0);
    assert.deepEqual(equivalentWrites, []);
    assert.deepEqual(equivalentManifest.pathOwnership, []);

    const whitespaceHome = await createHome(t);
    const whitespaceInstallation = join(whitespaceHome, '.agent-repository-workflow');
    /** @type {WindowsPathUpdate[]} */
    const whitespaceWrites = [];
    const whitespace = await runInstaller(
        [...RELEASE_ARGUMENTS, '--non-interactive', '--reinitialize-config', 'false', '--register-path', 'true'],
        {
            environment: {USERPROFILE: whitespaceHome},
            loadInstallationPayload: loadTestInstallationPayload,
            platform: 'win32',
            release: TEST_RELEASE_SOURCE,
            sourceDirectory: SOURCE_DIRECTORY,
            stderr: message => assert.fail(message),
            stdout: () => {},
            windowsPath: {
                read: async () => ({exists: true, kind: 'String', value: ` ${whitespaceInstallation} `}),
                write: async value => {
                    whitespaceWrites.push(value);
                },
                notify: async () => true,
            },
        },
    );

    assert.equal(whitespace, 0);
    assert.deepEqual(whitespaceWrites, [{kind: 'String', value: ` ${whitespaceInstallation} ;${whitespaceInstallation}`}]);

    const quotedHome = await createHome(t);
    const quotedInstallation = join(quotedHome, '.agent-repository-workflow');
    /** @type {WindowsPathUpdate[]} */
    const quotedWrites = [];
    const oneSidedQuote = await runInstaller(
        [...RELEASE_ARGUMENTS, '--non-interactive', '--reinitialize-config', 'false', '--register-path', 'true'],
        {
            environment: {USERPROFILE: quotedHome},
            loadInstallationPayload: loadTestInstallationPayload,
            platform: 'win32',
            release: TEST_RELEASE_SOURCE,
            sourceDirectory: SOURCE_DIRECTORY,
            stderr: message => assert.fail(message),
            stdout: () => {},
            windowsPath: {
                read: async () => ({exists: true, kind: 'String', value: `"${quotedInstallation}`}),
                write: async value => {
                    quotedWrites.push(value);
                },
                notify: async () => true,
            },
        },
    );

    assert.equal(oneSidedQuote, 0);
    assert.deepEqual(quotedWrites, [{kind: 'String', value: `"${quotedInstallation};${quotedInstallation}`}]);
});

test('Windows manifest ownership normalization prevents a false unowned PATH cleanup notice', async t => {
    const home = await createHome(t);
    const installation = join(home, '.agent-repository-workflow');
    const windowsPath = {
        read: async () => ({exists: /** @type {false} */ (false), kind: /** @type {null} */ (null), value: /** @type {''} */ ('')}),
        write: async () => {},
        notify: async () => true,
    };
    const first = await installRelease({
        nonInteractive: true,
        registerPath: true,
        reinitializeConfig: false,
        sourceRequest: {kind: 'local'},
    }, {
        environment: {USERPROFILE: home},
        loadInstallationPayload: loadTestInstallationPayload,
        platform: 'win32',
        sourceDirectory: SOURCE_DIRECTORY,
        windowsPath,
    });
    assert.equal(first.status, 'installed');

    const manifestPath = join(installation, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.pathOwnership[0].entry = `${installation.toUpperCase()}\\`;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const failed = await installRelease({
        nonInteractive: true,
        registerPath: true,
        reinitializeConfig: false,
        sourceRequest: {kind: 'local'},
    }, {
        environment: {USERPROFILE: home},
        loadInstallationPayload: loadTestInstallationPayload,
        platform: 'win32',
        sourceDirectory: SOURCE_DIRECTORY,
        windowsPath,
        writeManifest: async () => { throw new Error('simulated manifest commit failure'); },
    });

    assert.equal(failed.status, 'partial');
    assert.equal(failed.stage, 'manifest');
    assert.ok(!failed.notices.some(notice => notice.includes('unowned windows-user-path registration')));
});

test('Installer reports a Windows environment refresh warning without changing installation success', async t => {
    const home = await createHome(t);
    /** @type {string[]} */
    const warnings = [];
    let userPath = '';
    const result = await runInstaller(
        [...RELEASE_ARGUMENTS, '--non-interactive', '--reinitialize-config', 'false', '--register-path', 'true'],
        {
            environment: {USERPROFILE: home},
            loadInstallationPayload: loadTestInstallationPayload,
            platform: 'win32',
            release: TEST_RELEASE_SOURCE,
            sourceDirectory: SOURCE_DIRECTORY,
            stderr: message => warnings.push(message),
            stdout: () => {},
            windowsPath: {
                read: async () => ({exists: false, kind: null, value: ''}),
                write: async (/** @type {{ value: string; }} */ update) => {
                    userPath = update.value;
                },
                notify: async () => false,
            },
        },
    );

    assert.equal(result, 0);
    assert.match(warnings.join('\n'), /persistent PATH was updated.*refresh failed/i);
    assert.equal(userPath, join(home, '.agent-repository-workflow'));
    await readFile(join(home, '.agent-repository-workflow', 'manifest.json'), 'utf8');
});

test('installation supports experimental macOS and rejects unsafe or unknown platform locations', async t => {
    /** @type {Array<[string, NodeJS.ProcessEnv]>} */
    const invalidLocations = [
        ['linux', {HOME: 'relative-home'}],
        ['win32', {USERPROFILE: 'relative-home'}],
    ];
    for (const [platform, environment] of invalidLocations) {
        /** @type {string[]} */
        const messages = [];
        const result = await runInstaller(
            [...RELEASE_ARGUMENTS, '--non-interactive', '--reinitialize-config', 'false', '--register-path', 'false'],
            {
                environment,
                platform,
                release: TEST_RELEASE_SOURCE,
                sourceDirectory: SOURCE_DIRECTORY,
                stderr: message => messages.push(message),
                stdout: () => {},
            },
        );

        assert.equal(result, 1);
        assert.match(messages.join('\n'), /absolute (HOME|USERPROFILE)|unsupported installation platform/i);
    }

    const macHome = await createHome(t);
    const mac = await runInstaller(
        [...RELEASE_ARGUMENTS, '--non-interactive', '--reinitialize-config', 'false', '--register-path', 'false'],
        {
            environment: {HOME: macHome},
            loadInstallationPayload: loadTestInstallationPayload,
            platform: 'darwin',
            release: TEST_RELEASE_SOURCE,
            sourceDirectory: SOURCE_DIRECTORY,
            stderr: message => assert.fail(message),
            stdout: () => {},
        },
    );
    const macFiles = await readdir(join(macHome, '.agent-repository-workflow'));
    assert.equal(mac, 0);
    assert.ok(macFiles.includes('arw'));
    assert.ok(!macFiles.includes('arw.cmd'));

    /** @type {string[]} */
    const precedenceMessages = [];
    const precedence = await runInstaller(
        [...RELEASE_ARGUMENTS, '--non-interactive', '--reinitialize-config', 'false', '--register-path', 'false'],
        {
            environment: {HOME: await createHome(t)},
            platform: 'freebsd',
            sourceDirectory: join(SOURCE_DIRECTORY, 'missing-source'),
            stderr: message => precedenceMessages.push(message),
            stdout: () => {},
        },
    );

    assert.equal(precedence, 1);
    assert.match(precedenceMessages.join('\n'), /unsupported installation platform/i);
});

test('Installation reports exact cleanup requirements and gives unknown PATH effects priority', async t => {
    for (const effect of ['none', 'changed', 'unknown']) {
        const home = await createHome(t);
        const installation = join(home, '.agent-repository-workflow');
        const pathFailure = new Error(`simulated ${effect} PATH write failure`);
        if (effect !== 'unknown') Object.assign(pathFailure, {effect});
        const result = await installRelease({
            nonInteractive: true,
            registerPath: true,
            reinitializeConfig: false,
            sourceRequest: {kind: 'local'},
        }, {
            environment: {USERPROFILE: home},
            loadInstallationPayload: loadTestInstallationPayload,
            platform: 'win32',
            sourceDirectory: SOURCE_DIRECTORY,
            windowsPath: {
                read: async () => ({exists: false, kind: null, value: ''}),
                write: async () => { throw pathFailure; },
                notify: async () => true,
            },
        });

        assert.equal(result.stage, 'path', effect);
        assert.equal(result.status, effect === 'unknown' ? 'unknown' : 'partial', effect);
        assert.ok(result.notices.includes('Manual cleanup required before retry: remove unowned installation path arw.'), effect);
        assert.ok(!result.notices.some(notice => /installation path config\.json\.$/u.test(notice)), effect);
        const registrationNotice = `Manual cleanup required before retry: remove unowned windows-user-path registration ${installation}.`;
        assert.equal(result.notices.includes(registrationNotice), effect !== 'none', effect);
        await assert.rejects(readFile(join(installation, 'manifest.json')), {code: 'ENOENT'});
    }
});

test('Installation reports a possibly partial failed create as an unowned cleanup target', async t => {
    const home = await createHome(t);
    const result = await installRelease({
        nonInteractive: true,
        registerPath: false,
        reinitializeConfig: false,
        sourceRequest: {kind: 'local'},
    }, {
        createFilesystem: async input => {
            const created = await createScopedFilesystem(input);
            if (created.status !== 'succeeded') return created;
            let failed = false;
            return {
                ...created,
                scopedFilesystem: {
                    ...created.scopedFilesystem,
                    async write(request) {
                        const written = await created.scopedFilesystem.write(request);
                        if (!failed && request.path.endsWith('/arw')) {
                            failed = true;
                            return {
                                diagnostics: [{code: 'injected-write-failure', message: 'Injected after a partial create.'}],
                                stage: 'file-create',
                                status: 'failed',
                            };
                        }
                        return written;
                    },
                },
            };
        },
        environment: {HOME: home},
        loadInstallationPayload: loadTestInstallationPayload,
        platform: 'linux',
        sourceDirectory: SOURCE_DIRECTORY,
    });

    assert.equal(result.status, 'partial');
    assert.equal(result.stage, 'install');
    assert.ok(result.notices.includes('Manual cleanup required before retry: remove unowned installation path arw.'));
});

test('manifest commit failure reports every newly unowned target and platform registration', async t => {
    const home = await createHome(t);
    const installation = join(home, '.agent-repository-workflow');
    const result = await installRelease({
        nonInteractive: true,
        registerPath: true,
        reinitializeConfig: false,
        sourceRequest: {kind: 'local'},
    }, {
        environment: {USERPROFILE: home},
        loadInstallationPayload: loadTestInstallationPayload,
        platform: 'win32',
        sourceDirectory: SOURCE_DIRECTORY,
        windowsPath: {
            read: async () => ({exists: false, kind: null, value: ''}),
            write: async () => {},
            notify: async () => true,
        },
        writeManifest: async () => { throw new Error('simulated manifest commit failure'); },
    });

    assert.equal(result.status, 'partial');
    assert.equal(result.stage, 'manifest');
    assert.ok(result.notices.includes('Manual cleanup required before retry: remove unowned installation path arw.'));
    assert.ok(result.notices.includes(`Manual cleanup required before retry: remove unowned windows-user-path registration ${installation}.`));
    assert.ok(!result.notices.some(notice => /installation path config\.json\.$/u.test(notice)));
    assert.deepEqual(result.summary?.pathOwnership, [{
        createdValue: true,
        entry: installation,
        kind: 'windows-user-path',
        valueKind: 'ExpandString',
    }]);
    await assert.rejects(readFile(join(installation, 'manifest.json')), {code: 'ENOENT'});
});

test('installer rejects unsupported and incomplete argument shapes before writing', async t => {
    const cases = [
        ['--non-interactive', '--take-over', 'true'],
        ['--release-tag', ARW_VERSION, '--non-interactive', '--reinitialize-config', 'false', '--register-path', 'false'],
        [...RELEASE_ARGUMENTS, '--release-tag', ARW_VERSION, '--non-interactive', '--reinitialize-config', 'false', '--register-path', 'false'],
        [
            '--release-tag',
            ARW_VERSION,
            '--release-commit',
            RELEASE_COMMIT,
            '--selection-mode',
            'automatic',
            '--non-interactive',
            '--reinitialize-config',
            'false',
            '--register-path',
            'false',
        ],
        [
            '--release-tag',
            `${ARW_VERSION}-pre`,
            '--release-commit',
            RELEASE_COMMIT,
            '--selection-mode',
            'latest',
            '--non-interactive',
            '--reinitialize-config',
            'false',
            '--register-path',
            'false',
        ],
        [
            '--release-tag',
            ARW_VERSION,
            '--release-commit',
            'abc',
            '--selection-mode',
            'latest',
            '--non-interactive',
            '--reinitialize-config',
            'false',
            '--register-path',
            'false',
        ],
    ];

    for (const args of cases) {
        const home = await createHome(t);
        const messages = [];
        const result = await runInstaller(args, {
            environment: {HOME: home, USERPROFILE: home},
            platform: 'linux',
            sourceDirectory: SOURCE_DIRECTORY,
            stderr: message => messages.push(message),
            stdout: () => {},
        });

        assert.equal(result, 2, args.join(' '));
        assert.deepEqual(await readdir(home), []);
        assert.ok(messages.length > 0);
    }
});

test('installed CLI combines Repository Application configuration with global JIRA display configuration', async t => {
    const {installation} = completeInstallationFixture;
    const repository = await createGitRepository(t, {prefix: 'agent-repository-workflow-installed-application-jira-'});
    let observedUrl = '';
    let observedAuthorization = '';
    const server = createServer((request, response) => {
        observedUrl = request.url ?? '';
        observedAuthorization = request.headers.authorization ?? '';
        response.writeHead(200, {'content-type': 'application/json'});
        response.end(JSON.stringify({issues: [{fields: {summary: 'Installed story'}, key: 'PAY-1'}], total: 1}));
    });
    t.after(() => server.close());
    await new Promise((/** @type {(value?: void) => void} */ resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === 'string') assert.fail('Local JIRA server address is unavailable.');
    await writeFile(join(repository, 'arw.config.json'), `${JSON.stringify({
        configVersion: 2,
        application: {
            jira: {
                acceptedStatus: 'In Progress',
                baseUrl: `http://127.0.0.1:${address.port}/`,
                candidateStatus: 'Backlog',
                completedStatus: 'Done',
                issueType: 'Story',
                projectKey: 'PAY',
            },
            modules: [],
            name: 'payments',
            submoduleDistributionBranch: 'dev',
            submoduleRemote: 'origin',
        },
    }, null, 2)}\n`, 'utf8');

    const command = await runSuccessfulProcess('node', [join(installation, 'arw.mjs'), 'jira', 'list'], {
        cwd: repository,
        env: {...process.env, JIRA_ACCESS_TOKEN: 'installed-test-token'},
    });

    assert.match(command.stdout, /Total matching issues: 1/u);
    assert.match(command.stdout, /PAY-1\s+Installed story/u);
    assert.equal(command.stderr, '');
    assert.equal(observedAuthorization, 'Bearer installed-test-token');
    assert.match(observedUrl, /(?:\?|&)maxResults=50(?:&|$)/u);
});

test('real Installer installs current Source Checkout bytes without Git evidence and installed CLI reads manifest version', async () => {
    const {installation, stderr, stdout} = completeInstallationFixture;
    const manifest = JSON.parse(await readFile(join(installation, 'manifest.json'), 'utf8'));
    const version = await runSuccessfulProcess('node', [join(installation, 'arw.mjs'), '--version']);

    assert.equal(stderr, '');
    assert.match(stdout, /Installed agent-repository-workflow to /);
    assert.equal(manifest.arwVersion, `${ARW_VERSION}-pre`);
    assert.equal(version.stdout, `${ARW_VERSION}-pre\n`);
    assert.equal(version.stderr, '');
    assert.match(await readFile(join(installation, 'lib', 'arw-common', 'text-policy.mjs'), 'utf8'), /local checkout byte marker/);
    await assert.rejects(readFile(join(installation, 'package.json')), {code: 'ENOENT'});
});
