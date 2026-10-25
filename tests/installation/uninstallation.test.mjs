import assert from 'node:assert/strict';
import {copyFile, link, mkdir, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

import {runExitedProcess, runSuccessfulProcess} from '../helpers/process.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {createScopedFilesystem} from '../../lib/common/filesystem.mjs';
import {backgroundAgentRuntimeDirectory} from '../../lib/background-agent/client.mjs';
import {backgroundAgentMessageDatabasePaths} from '../../lib/background-agent/message-store.mjs';
import {parseUninstallArguments, runUninstaller as productionRunUninstaller, uninstallRelease as productionUninstallRelease} from '../../lib/installation/uninstallation.mjs';

const maintenanceReady = async () => ({
    status: /** @type {'acquired'} */ ('acquired'),
    stoppedAgents: [],
});
/** @type {typeof productionUninstallRelease} */
const uninstallRelease = (request, options = {}) => productionUninstallRelease(request, {
    acquireMaintenance: maintenanceReady,
    ...options,
});
/** @type {typeof productionRunUninstaller} */
const runUninstaller = (args, options = {}) => productionRunUninstaller(args, {
    acquireMaintenance: maintenanceReady,
    listBackgroundAgents: async () => [],
    ...options,
});

const SOURCE_DIRECTORY = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const createHome = async (/** @type {test.TestContext} */ t) => {
    const home = await createTemporaryDirectory(t, 'agent-repository-workflow-uninstall-home-');
    return home;
};

/** @typedef {{managedFiles?: string[], manifest?: Record<string, unknown>, pathOwnership?: unknown[]}} InstallationOverrides */
/** @typedef {{channel: string, message: string}} CapturedMessage */
/** @typedef {{kind?: string, value: string}} PathWrite */

const writeInstallation = async (/** @type {string} */ home, /** @type {InstallationOverrides} */ overrides = {}) => {
    const installationDirectory = join(home, '.agent-repository-workflow');
    const managedFiles = overrides.managedFiles ?? ['arw.mjs', 'installation-contract.mjs', 'uninstall.mjs', 'uninstallation.mjs'];
    const manifest = {
        arwVersion: '0.2.0',
        manifestVersion: 2,
        managedFiles,
        pathOwnership: overrides.pathOwnership ?? [],
        product: 'agent-repository-workflow',
        ...overrides.manifest,
    };

    await mkdir(installationDirectory, {recursive: true});
    for (const file of managedFiles) {
        const path = join(installationDirectory, file);
        await mkdir(dirname(path), {recursive: true});
        await writeFile(path, `${file}\n`, 'utf8');
    }
    await writeFile(join(installationDirectory, 'config.json'), '{"user":true}\n', 'utf8');
    await writeFile(join(installationDirectory, 'manifest.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
    return installationDirectory;
};

const writeMessageState = async (/** @type {string} */ installationDirectory) => {
    const runtimeDirectory = backgroundAgentRuntimeDirectory(installationDirectory);
    const paths = backgroundAgentMessageDatabasePaths(runtimeDirectory);
    await mkdir(runtimeDirectory, {recursive: true});
    for (const path of Object.values(paths)) await writeFile(path, 'message state\n', 'utf8');
    for (const name of ['credential', 'runs.json', 'unknown.txt']) {
        await writeFile(join(runtimeDirectory, name), `${name}\n`, 'utf8');
    }
    return {paths, runtimeDirectory};
};

const runNonInteractive = async (/** @type {string} */ home, /** @type {string[]} */ args = [], /** @type {object} */ overrides = {}) => {
    /** @type {CapturedMessage[]} */
    const messages = [];
    const result = await runUninstaller(['--non-interactive', ...args], {
        environment: {HOME: home, USERPROFILE: home},
        platform: 'linux',
        stderr: message => messages.push({channel: 'stderr', message}),
        stdout: message => messages.push({channel: 'stdout', message}),
        ...overrides,
    });
    return {messages, result};
};

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

test('uninstallation refuses busy or unknown maintenance before changing installation', async t => {
    for (const status of /** @type {const} */ (['busy', 'unknown'])) {
        const home = await createHome(t);
        const installation = await writeInstallation(home);
        const manifest = await readFile(join(installation, 'manifest.json'));
        const result = await uninstallRelease({removeInstallation: true, removeConfig: false, stopBackgroundAgents: false}, {
            acquireMaintenance: async () => ({status, reason: `${status} background work`, stoppedAgents: []}),
            environment: {HOME: home},
            platform: 'linux',
        });
        assert.equal(result.status, 'unchanged');
        assert.equal(result.stage, 'preflight');
        assert.equal(result.diagnostics[0]?.severity, 'error');
        assert.deepEqual(await readFile(join(installation, 'manifest.json')), manifest);
        assert.equal(await readFile(join(installation, 'arw.mjs'), 'utf8'), 'arw.mjs\n');
    }
});

test('uninstallation reports unknown when PATH mutation outcome cannot be proven', async t => {
    const home = await createHome(t);
    const installationDirectory = join(home, '.agent-repository-workflow');
    await writeInstallation(home, {
        pathOwnership: [{createdValue: false, entry: installationDirectory, kind: 'windows-user-path', valueKind: 'ExpandString'}],
    });

    const result = await uninstallRelease({removeInstallation: true, removeConfig: false, stopBackgroundAgents: false}, {
        environment: {USERPROFILE: home},
        platform: 'win32',
        windowsPath: {
            read: async () => ({exists: true, kind: 'ExpandString', value: installationDirectory}),
            write: async () => {
                throw new Error('simulated uncertain PATH failure');
            },
            notify: async () => true,
        },
    });

    assert.equal(result.status, 'unknown');
    assert.equal(result.stage, 'remove-path');
    assert.equal(result.diagnostics[0].code, 'uninstallation-state-unknown');
    assert.equal(result.summary?.residualPaths, null);
    assert.equal(JSON.parse(await readFile(join(installationDirectory, 'manifest.json'), 'utf8')).product, 'agent-repository-workflow');
});

test('uninstallation distinguishes proven PATH write effects without omitting residualPaths', async t => {
    for (const effect of ['none', 'changed']) {
        const home = await createHome(t);
        const installationDirectory = join(home, '.agent-repository-workflow');
        await writeInstallation(home, {
            pathOwnership: [{createdValue: false, entry: installationDirectory, kind: 'windows-user-path', valueKind: 'ExpandString'}],
        });
        const pathFailure = Object.assign(new Error(`simulated ${effect} PATH failure`), {effect});
        const result = await uninstallRelease({removeInstallation: true, removeConfig: false, stopBackgroundAgents: false}, {
            environment: {USERPROFILE: home},
            platform: 'win32',
            windowsPath: {
                read: async () => ({exists: true, kind: 'ExpandString', value: installationDirectory}),
                write: async () => { throw pathFailure; },
                notify: async () => true,
            },
        });

        assert.equal(result.status, effect === 'changed' ? 'partial' : 'unchanged', effect);
        assert.equal(result.stage, 'remove-path', effect);
        assert.equal(result.summary?.residualPaths, null, effect);
        assert.equal(JSON.parse(await readFile(join(installationDirectory, 'manifest.json'), 'utf8')).product, 'agent-repository-workflow');
    }
});

test('uninstallation cancellation returns before installation state observation', async () => {
    const result = await uninstallRelease({removeConfig: true, removeInstallation: false, stopBackgroundAgents: false}, {
        environment: {HOME: 7},
        platform: 'unsupported',
    });

    assert.deepEqual(result, {
        diagnostics: [],
        notices: ['Uninstallation cancelled.'],
        operation: 'uninstall',
        stage: 'preflight',
        status: 'unchanged',
        summary: null,
    });
    assert.throws(
        () => uninstallRelease({removeConfig: false}),
        /removeInstallation, removeConfig, and stopBackgroundAgents booleans/u,
    );
    assert.throws(
        () => uninstallRelease({removeConfig: false, removeInstallation: true}),
        /removeInstallation, removeConfig, and stopBackgroundAgents booleans/u,
    );
});

test('partial uninstallation preserves the manifest for a forward retry', async t => {
    const home = await createHome(t);
    const installationDirectory = await writeInstallation(home, {managedFiles: ['first.mjs', 'second.mjs']});
    const attempted = await runNonInteractive(home, [], {
        createFilesystem: createFilesystemWithRemove(async (request, remove) => {
            if (request.path.endsWith('second.mjs')) throw new Error('simulated removal failure');
            return remove();
        }),
    });

    assert.equal(attempted.result, 1);
    await assert.rejects(readFile(join(installationDirectory, 'first.mjs'), 'utf8'), {code: 'ENOENT'});
    assert.equal(await readFile(join(installationDirectory, 'second.mjs'), 'utf8'), 'second.mjs\n');
    assert.equal(JSON.parse(await readFile(join(installationDirectory, 'manifest.json'), 'utf8')).product, 'agent-repository-workflow');

    assert.equal((await runNonInteractive(home)).result, 0);
    assert.deepEqual(await readdir(installationDirectory), ['config.json']);
});

test('uninstallation completes residual enumeration before deleting the manifest', async t => {
    const home = await createHome(t);
    const installationDirectory = await writeInstallation(home, {managedFiles: ['arw.mjs']});
    const result = await uninstallRelease({removeConfig: false, removeInstallation: true, stopBackgroundAgents: false}, {
        createFilesystem: async input => {
            const created = await createScopedFilesystem(input);
            if (created.status !== 'succeeded') return created;
            return {
                ...created,
                scopedFilesystem: {
                    ...created.scopedFilesystem,
                    async list() {
                        return {
                            diagnostics: [{code: 'injected-enumeration-failure', message: 'Injected residual enumeration failure.'}],
                            stage: 'enumerate',
                            status: 'failed',
                        };
                    },
                },
            };
        },
        environment: {HOME: home},
        platform: 'linux',
    });

    assert.equal(result.status, 'partial');
    assert.equal(result.stage, 'manifest');
    assert.equal(JSON.parse(await readFile(join(installationDirectory, 'manifest.json'), 'utf8')).product, 'agent-repository-workflow');
});

test('partial uninstallation reports PATH ownership removed before a later file failure', async t => {
    const home = await createHome(t);
    const installationDirectory = join(home, '.agent-repository-workflow');
    await writeInstallation(home, {
        managedFiles: ['arw.mjs'],
        pathOwnership: [{
            createdValue: false,
            entry: installationDirectory,
            kind: 'windows-user-path',
            valueKind: 'String',
        }],
    });

    const result = await uninstallRelease({removeInstallation: true, removeConfig: false, stopBackgroundAgents: false}, {
        createFilesystem: createFilesystemWithRemove(async () => {
            throw new Error('simulated runtime removal failure');
        }),
        environment: {USERPROFILE: home},
        platform: 'win32',
        windowsPath: {
            read: async () => ({exists: true, kind: 'String', value: installationDirectory}),
            write: async () => {},
            notify: async () => true,
        },
    });

    assert.equal(result.status, 'partial');
    assert.equal(result.stage, 'remove-files');
    assert.deepEqual(result.summary?.pathOwnership, []);
    assert.equal(JSON.parse(await readFile(join(installationDirectory, 'manifest.json'), 'utf8')).product, 'agent-repository-workflow');
});

test('configuration removal is explicit and an empty installation directory is removed idempotently', async t => {
    const removeHome = await createHome(t);
    const installationDirectory = await writeInstallation(removeHome);

    assert.equal((await runNonInteractive(removeHome, ['--remove-config', 'true'])).result, 0);
    await assert.rejects(readdir(installationDirectory), error => error !== null && typeof error === 'object'
        && 'code' in error && error.code === 'ENOENT');

    const repeated = await runNonInteractive(removeHome, ['--remove-config', 'true']);
    assert.equal(repeated.result, 0);
    assert.match(repeated.messages.map(event => event.message).join('\n'), /already uninstalled/i);

    const preserveHome = await createHome(t);
    const preserved = await writeInstallation(preserveHome);
    const {paths, runtimeDirectory} = await writeMessageState(preserved);
    assert.equal((await runNonInteractive(preserveHome, ['--remove-config', 'false'])).result, 0);
    assert.deepEqual((await readdir(preserved)).sort(), ['background-agent-state', 'config.json']);
    for (const path of Object.values(paths)) assert.equal(await readFile(path, 'utf8'), 'message state\n');
    assert.ok((await readdir(runtimeDirectory)).includes('credential'));
});

test('one configuration choice removes only the ARW message database and its own files', async t => {
    const home = await createHome(t);
    const installationDirectory = await writeInstallation(home);
    const {paths, runtimeDirectory} = await writeMessageState(installationDirectory);
    /** @type {string[]} */
    const prompts = [];
    const result = await runUninstaller([], {
        environment: {HOME: home},
        platform: 'linux',
        prompt: async decision => {
            prompts.push(decision);
            return true;
        },
        stderr: message => assert.fail(message),
        stdout: () => {},
    });
    assert.equal(result, 0);
    assert.deepEqual(prompts, ['removeInstallation', 'removeConfig']);
    for (const path of Object.values(paths)) await assert.rejects(readFile(path), {code: 'ENOENT'});
    assert.deepEqual((await readdir(runtimeDirectory)).sort(), ['credential', 'runs.json', 'unknown.txt']);
    await assert.rejects(readFile(join(installationDirectory, 'config.json')), {code: 'ENOENT'});

    const retainedHome = await createHome(t);
    const retainedInstallation = await writeInstallation(retainedHome);
    const retainedState = await writeMessageState(retainedInstallation);
    /** @type {string[]} */
    const explicitPrompts = [];
    const explicit = await runUninstaller(['--remove-config', 'false'], {
        environment: {HOME: retainedHome},
        platform: 'linux',
        prompt: async decision => {
            explicitPrompts.push(decision);
            return true;
        },
        stderr: message => assert.fail(message),
        stdout: () => {},
    });
    assert.equal(explicit, 0);
    assert.deepEqual(explicitPrompts, ['removeInstallation']);
    assert.equal(await readFile(retainedState.paths.database, 'utf8'), 'message state\n');
    assert.equal(await readFile(join(retainedInstallation, 'config.json'), 'utf8'), '{"user":true}\n');

    const explicitRemoveHome = await createHome(t);
    const explicitRemoveInstallation = await writeInstallation(explicitRemoveHome);
    const explicitRemoveState = await writeMessageState(explicitRemoveInstallation);
    /** @type {string[]} */
    const removePrompts = [];
    const explicitlyRemoved = await runUninstaller(['--remove-config', 'true'], {
        environment: {HOME: explicitRemoveHome},
        platform: 'linux',
        prompt: async decision => {
            removePrompts.push(decision);
            return true;
        },
        stderr: message => assert.fail(message),
        stdout: () => {},
    });
    assert.equal(explicitlyRemoved, 0);
    assert.deepEqual(removePrompts, ['removeInstallation']);
    await assert.rejects(readFile(explicitRemoveState.paths.database), {code: 'ENOENT'});
});

test('unsafe message database sidecar blocks every uninstall deletion', async t => {
    const home = await createHome(t);
    const installationDirectory = await writeInstallation(home);
    const {paths} = await writeMessageState(installationDirectory);
    const outside = join(home, 'outside-message-state');
    await rm(paths.wal);
    await writeFile(outside, 'outside\n', 'utf8');
    await link(outside, paths.wal);
    const attempted = await runNonInteractive(home, ['--remove-config', 'true']);
    assert.equal(attempted.result, 1);
    assert.equal(await readFile(outside, 'utf8'), 'outside\n');
    assert.equal(await readFile(join(installationDirectory, 'arw.mjs'), 'utf8'), 'arw.mjs\n');
    assert.equal(await readFile(join(installationDirectory, 'config.json'), 'utf8'), '{"user":true}\n');
    assert.ok((await readdir(installationDirectory)).includes('manifest.json'));
});

test('configuration removal refuses a hard linked file before removing owned files', async t => {
    const home = await createHome(t);
    const installationDirectory = await writeInstallation(home);
    const outside = join(home, 'outside-config.json');
    await rm(join(installationDirectory, 'config.json'));
    await writeFile(outside, '{"user":true}\n', 'utf8');
    await link(outside, join(installationDirectory, 'config.json'));

    const attempted = await runNonInteractive(home, ['--remove-config', 'true']);

    assert.equal(attempted.result, 1);
    assert.equal(await readFile(outside, 'utf8'), '{"user":true}\n');
    assert.equal(await readFile(join(installationDirectory, 'arw.mjs'), 'utf8'), 'arw.mjs\n');
    assert.ok((await readdir(installationDirectory)).includes('manifest.json'));
});

test('nested uninstallation removes only empty managed directories and preserves unknown nested content', async t => {
    const preservedHome = await createHome(t);
    const preservedInstallation = await writeInstallation(preservedHome, {
        managedFiles: ['lib/deep/runtime.mjs', 'lib/uninstallation.mjs', 'uninstall.mjs'],
    });
    await writeFile(join(preservedInstallation, 'lib', 'unknown.txt'), 'keep\n', 'utf8');

    const preserved = await runNonInteractive(preservedHome, ['--remove-config', 'true']);

    assert.equal(preserved.result, 0);
    assert.deepEqual(await readdir(preservedInstallation), ['lib']);
    assert.deepEqual(await readdir(join(preservedInstallation, 'lib')), ['unknown.txt']);
    await assert.rejects(readdir(join(preservedInstallation, 'lib', 'deep')), error => error !== null
        && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');

    const removedHome = await createHome(t);
    const removedInstallation = await writeInstallation(removedHome, {
        managedFiles: ['lib/deep/runtime.mjs', 'lib/uninstallation.mjs', 'uninstall.mjs'],
    });

    assert.equal((await runNonInteractive(removedHome, ['--remove-config', 'true'])).result, 0);
    await assert.rejects(readdir(removedInstallation), error => error !== null && typeof error === 'object'
        && 'code' in error && error.code === 'ENOENT');
});

test('uninstallation rejects linked managed directories before deleting external files', async t => {
    const home = await createHome(t);
    const installationDirectory = join(home, '.agent-repository-workflow');
    const outside = join(home, 'outside');
    await mkdir(installationDirectory);
    await mkdir(outside);
    await writeFile(join(outside, 'runtime.mjs'), 'outside\n', 'utf8');
    await symlink(outside, join(installationDirectory, 'lib'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(join(installationDirectory, 'config.json'), '{"user":true}\n', 'utf8');
    await writeFile(join(installationDirectory, 'manifest.json'), `${JSON.stringify({
        arwVersion: '0.2.0',
        managedFiles: ['lib/runtime.mjs'],
        manifestVersion: 2,
        pathOwnership: [],
        product: 'agent-repository-workflow',
    })}\n`, 'utf8');

    const rejected = await runNonInteractive(home, ['--remove-config', 'true']);

    assert.equal(rejected.result, 1);
    assert.match(rejected.messages.map(event => event.message).join('\n'), /linked|symbolic|runtime directory/i);
    assert.equal(await readFile(join(outside, 'runtime.mjs'), 'utf8'), 'outside\n');
    assert.ok((await readdir(installationDirectory)).includes('manifest.json'));
});

test('Linux profile cleanup removes only the owned canonical marker and rejects changed ownership', async t => {
    const home = await createHome(t);
    const profile = join(home, '.profile');
    const installationDirectory = await writeInstallation(home, {
        pathOwnership: [{kind: 'linux-profile', profile}],
    });
    await writeFile(
        profile,
        '# user start\n# >>> agent-repository-workflow PATH >>>\nexport PATH="$HOME/.agent-repository-workflow:$PATH"\n# <<< agent-repository-workflow PATH <<<\nexport PATH="$HOME/.agent-repository-workflow:$PATH"\n',
        'utf8',
    );

    assert.equal((await runNonInteractive(home)).result, 0);
    assert.equal(await readFile(profile, 'utf8'), '# user start\nexport PATH="$HOME/.agent-repository-workflow:$PATH"\n');
    assert.deepEqual(await readdir(installationDirectory), ['config.json']);

    const missingHome = await createHome(t);
    const missingProfile = join(missingHome, '.profile');
    await writeInstallation(missingHome, {pathOwnership: [{kind: 'linux-profile', profile: missingProfile}]});
    assert.equal((await runNonInteractive(missingHome)).result, 0);

    const changedHome = await createHome(t);
    const changedProfile = join(changedHome, '.profile');
    const changedInstallation = await writeInstallation(changedHome, {
        pathOwnership: [{kind: 'linux-profile', profile: changedProfile}],
    });
    await writeFile(changedProfile, '# >>> agent-repository-workflow PATH >>>\nexport PATH="$PATH"\n# <<< agent-repository-workflow PATH <<<\n', 'utf8');

    const rejected = await runNonInteractive(changedHome);
    assert.equal(rejected.result, 1);
    assert.match(rejected.messages.map(event => event.message).join('\n'), /cannot prove|ownership/i);
    assert.ok((await readdir(changedInstallation)).includes('manifest.json'));
    assert.equal(await readFile(changedProfile, 'utf8'), '# >>> agent-repository-workflow PATH >>>\nexport PATH="$PATH"\n# <<< agent-repository-workflow PATH <<<\n');

    const embeddedHome = await createHome(t);
    const embeddedProfile = join(embeddedHome, '.profile');
    const embeddedInstallation = await writeInstallation(embeddedHome, {
        pathOwnership: [{kind: 'linux-profile', profile: embeddedProfile}],
    });
    const embedded = 'prefix # >>> agent-repository-workflow PATH >>>\nexport PATH="$HOME/.agent-repository-workflow:$PATH"\n# <<< agent-repository-workflow PATH <<<\n';
    await writeFile(embeddedProfile, embedded, 'utf8');

    assert.equal((await runNonInteractive(embeddedHome)).result, 1);
    assert.equal(await readFile(embeddedProfile, 'utf8'), embedded);
    assert.ok((await readdir(embeddedInstallation)).includes('manifest.json'));
});

test('Linux profile removal rejects a hard linked ownership target before deletes', async t => {
    const home = await createHome(t);
    const profile = join(home, '.profile');
    const external = join(home, 'external-profile');
    const content = '# >>> agent-repository-workflow PATH >>>\nexport PATH="$HOME/.agent-repository-workflow:$PATH"\n# <<< agent-repository-workflow PATH <<<\n';
    const installationDirectory = await writeInstallation(home, {
        pathOwnership: [{kind: 'linux-profile', profile}],
    });
    await writeFile(external, content, 'utf8');
    await link(external, profile);

    const attempted = await runNonInteractive(home);

    assert.equal(attempted.result, 1);
    assert.equal(await readFile(external, 'utf8'), content);
    assert.equal(await readFile(join(installationDirectory, 'arw.mjs'), 'utf8'), 'arw.mjs\n');
    assert.match(attempted.messages.map(event => event.message).join('\n'), /linked.*ownership target/i);
});

test('Windows PATH cleanup removes one owned entry and preserves equivalent unknown entries', async t => {
    const home = await createHome(t);
    const installationDirectory = await writeInstallation(home, {
        pathOwnership: [{createdValue: false, entry: join(home, '.agent-repository-workflow'), kind: 'windows-user-path', valueKind: 'ExpandString'}],
    });
    let userPath = `${installationDirectory};${installationDirectory.toUpperCase()}\\;C:\\Tools;;`;
    /** @type {PathWrite[]} */
    const writes = [];

    const result = await runUninstaller(['--non-interactive'], {
        environment: {USERPROFILE: home},
        platform: 'win32',
        stderr: message => assert.fail(message),
        stdout: () => {},
        windowsPath: {
            read: async () => ({exists: true, kind: 'ExpandString', value: userPath}),
            write: async (/** @type {{ value: string; }} */ update) => {
                writes.push(update);
                userPath = update.value;
            },
            notify: async () => true,
        },
    });

    assert.equal(result, 0);
    assert.deepEqual(writes, [{kind: 'ExpandString', value: `${installationDirectory.toUpperCase()}\\;C:\\Tools;;`}]);
    assert.deepEqual(await readdir(installationDirectory), ['config.json']);

    const fallbackHome = await createHome(t);
    const fallbackInstallation = await writeInstallation(fallbackHome, {
        pathOwnership: [{createdValue: false, entry: join(fallbackHome, '.agent-repository-workflow'), kind: 'windows-user-path', valueKind: 'String'}],
    });
    const fallbackEquivalent = fallbackInstallation.toUpperCase();
    const fallbackUnknown = `"${fallbackInstallation}"`;
    /** @type {PathWrite[]} */
    const fallbackWrites = [];
    const fallbackResult = await runUninstaller(['--non-interactive'], {
        environment: {USERPROFILE: fallbackHome},
        platform: 'win32',
        stderr: message => assert.fail(message),
        stdout: () => {},
        windowsPath: {
            read: async () => ({exists: true, kind: 'String', value: `${fallbackEquivalent}\\;${fallbackUnknown};C:\\Tools`}),
            write: async (/** @type {PathWrite} */ value) => {
                fallbackWrites.push(value);
            },
            notify: async () => true,
        },
    });
    assert.equal(fallbackResult, 0);
    assert.deepEqual(fallbackWrites, [{kind: 'String', value: `${fallbackUnknown};C:\\Tools`}]);

    const missingHome = await createHome(t);
    await writeInstallation(missingHome, {
        pathOwnership: [{createdValue: false, entry: join(missingHome, '.agent-repository-workflow'), kind: 'windows-user-path', valueKind: 'String'}],
    });
    /** @type {PathWrite[]} */
    const missingWrites = [];
    const missingResult = await runUninstaller(['--non-interactive'], {
        environment: {USERPROFILE: missingHome},
        platform: 'win32',
        stderr: message => assert.fail(message),
        stdout: () => {},
        windowsPath: {
            read: async () => ({exists: true, kind: 'String', value: 'C:\\Tools'}),
            write: async (/** @type {PathWrite} */ value) => {
                missingWrites.push(value);
            },
            notify: async () => true,
        },
    });
    assert.equal(missingResult, 0);
    assert.deepEqual(missingWrites, []);
});

test('Uninstaller notifies after rewriting or deleting Windows PATH and skips a no-op', async t => {
    /** @type {[string, boolean, string, string][]} */
    const cases = [
        ['rewrite', false, ';C:\\Tools', 'write'],
        ['delete', true, '', 'remove'],
    ];
    for (const [label, createdValue, initialSuffix, expectedMutation] of [
        ...cases,
    ]) {
        const home = await createHome(t);
        const installationDirectory = await writeInstallation(home, {
            pathOwnership: [{
                createdValue,
                entry: join(home, '.agent-repository-workflow'),
                kind: 'windows-user-path',
                valueKind: 'ExpandString',
            }],
        });
        /** @type {string | null} */
        let userPath = `${installationDirectory}${initialSuffix}`;
        /** @type {string[]} */
        const events = [];
        const result = await runUninstaller(['--non-interactive'], {
            environment: {USERPROFILE: home},
            platform: 'win32',
            stderr: message => assert.fail(message),
            stdout: () => {},
            windowsPath: {
                read: async () => userPath === null
                    ? {exists: false, kind: null, value: ''}
                    : {exists: true, kind: 'ExpandString', value: userPath},
                write: async (/** @type {{ value: string; }} */ update) => {
                    events.push('write');
                    userPath = update.value;
                },
                remove: async () => {
                    events.push('remove');
                    userPath = null;
                },
                notify: async () => {
                    events.push('notify');
                    return true;
                },
            },
        });
        assert.equal(result, 0, String(label));
        assert.deepEqual(events, [expectedMutation, 'notify'], String(label));
    }

    const noOpHome = await createHome(t);
    await writeInstallation(noOpHome, {
        pathOwnership: [{
            createdValue: false,
            entry: join(noOpHome, '.agent-repository-workflow'),
            kind: 'windows-user-path',
            valueKind: 'String',
        }],
    });
    /** @type {string[]} */
    const events = [];
    const noOp = await runUninstaller(['--non-interactive'], {
        environment: {USERPROFILE: noOpHome},
        platform: 'win32',
        stderr: message => assert.fail(message),
        stdout: () => {},
        windowsPath: {
            read: async () => ({exists: true, kind: 'String', value: 'C:\\Tools'}),
            write: async () => {
                events.push('write');
            },
            notify: async () => {
                events.push('notify');
                return true;
            },
        },
    });
    assert.equal(noOp, 0);
    assert.deepEqual(events, []);
});

test('Uninstaller reports a Windows environment refresh warning without changing removal success', async t => {
    const home = await createHome(t);
    const installationDirectory = await writeInstallation(home, {
        pathOwnership: [{
            createdValue: false,
            entry: join(home, '.agent-repository-workflow'),
            kind: 'windows-user-path',
            valueKind: 'String',
        }],
    });
    /** @type {string[]} */
    const warnings = [];
    let userPath = `${installationDirectory};C:\\Tools`;
    const result = await runUninstaller(['--non-interactive'], {
        environment: {USERPROFILE: home},
        platform: 'win32',
        stderr: message => warnings.push(message),
        stdout: () => {},
        windowsPath: {
            read: async () => ({exists: true, kind: 'String', value: userPath}),
            write: async (/** @type {{ value: string; }} */ update) => {
                userPath = update.value;
            },
            notify: async () => false,
        },
    });

    assert.equal(result, 0);
    assert.match(warnings.join('\n'), /persistent PATH was updated.*refresh failed/i);
    assert.equal(userPath, 'C:\\Tools');
    assert.deepEqual(await readdir(installationDirectory), ['config.json']);
});

test('invalid or missing manifests fail safely without deleting any installation content', async t => {
    /** @type {[string, string | null][]} */
    const cases = [
        ['missing', null],
        ['damaged', '{'],
        ['missing-arw-version', JSON.stringify({manifestVersion: 2, managedFiles: [], pathOwnership: [], product: 'agent-repository-workflow'})],
        ['wrong-product', JSON.stringify({arwVersion: '0.2.0', manifestVersion: 2, managedFiles: [], pathOwnership: [], product: 'other'})],
        ['wrong-version', JSON.stringify({arwVersion: '0.2.0', manifestVersion: 1, managedFiles: [], pathOwnership: [], product: 'agent-repository-workflow'})],
        ['unsafe-managed-path', JSON.stringify({
            arwVersion: '0.2.0',
            manifestVersion: 2,
            managedFiles: ['../outside.mjs'],
            pathOwnership: [],
            product: 'agent-repository-workflow',
        })],
        ['unowned-path', JSON.stringify({
            arwVersion: '0.2.0',
            manifestVersion: 2,
            managedFiles: ['arw.mjs'],
            pathOwnership: [{kind: 'linux-profile', profile: '/tmp/not-this-home-profile'}],
            product: 'agent-repository-workflow',
        })],
    ];

    for (const [name, manifestText] of cases) {
        const home = await createHome(t);
        const installationDirectory = await writeInstallation(home, {managedFiles: ['arw.mjs']});
        await writeFile(join(installationDirectory, 'unknown.txt'), `${name}\n`, 'utf8');
        if (manifestText === null) {
            await rm(join(installationDirectory, 'manifest.json'));
        } else {
            await writeFile(join(installationDirectory, 'manifest.json'), `${manifestText}\n`, 'utf8');
        }

        const rejected = await runNonInteractive(home);
        assert.equal(rejected.result, 1, name);
        assert.deepEqual((await readdir(installationDirectory)).sort(), [
            'arw.mjs',
            'config.json',
            ...(manifestText === null ? [] : ['manifest.json']),
            'unknown.txt',
        ]);
    }
});

test('a linked valid manifest cannot authorize any uninstallation mutation', async t => {
    const home = await createHome(t);
    const external = await createTemporaryDirectory(t, 'agent-repository-workflow-external-manifest-');
    const installationDirectory = await writeInstallation(home, {managedFiles: ['arw.mjs']});
    const manifestPath = join(installationDirectory, 'manifest.json');
    const externalManifest = join(external, 'manifest.json');
    await copyFile(manifestPath, externalManifest);
    await rm(manifestPath);
    try {
        await symlink(externalManifest, manifestPath, 'file');
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EPERM') {
            t.skip('The current environment does not allow file links.');
            return;
        }
        throw error;
    }

    const rejected = await runNonInteractive(home, ['--remove-config', 'true']);

    assert.equal(rejected.result, 1);
    assert.equal(await readFile(join(installationDirectory, 'arw.mjs'), 'utf8'), 'arw.mjs\n');
    assert.equal(await readFile(join(installationDirectory, 'config.json'), 'utf8'), '{"user":true}\n');
    assert.equal(JSON.parse(await readFile(externalManifest, 'utf8')).product, 'agent-repository-workflow');
});

test('interactive confirmation and uninstaller usage follow the explicit command contract', async t => {
    assert.deepEqual(parseUninstallArguments(['--non-interactive', '--stop-background-agents', 'true']), {
        nonInteractive: true,
        removeConfig: null,
        stopBackgroundAgents: true,
    });
    assert.equal(parseUninstallArguments(['--remove-config', 'false']).removeConfig, false);
    assert.equal(parseUninstallArguments(['--stop-background-agents', 'false']).stopBackgroundAgents, false);
    assert.equal(parseUninstallArguments([]).stopBackgroundAgents, null);
    const home = await createHome(t);
    const installationDirectory = await writeInstallation(home);
    /** @type {string[]} */
    const prompts = [];
    /** @type {string[]} */
    const messages = [];
    const cancelled = await runUninstaller([], {
        environment: {HOME: home},
        platform: 'linux',
        prompt: async decision => {
            prompts.push(decision);
            return false;
        },
        stderr: message => assert.fail(message),
        stdout: message => messages.push(message),
    });

    assert.equal(cancelled, 0);
    assert.deepEqual(prompts, ['removeInstallation']);
    assert.ok(messages.includes('Uninstallation cancelled.'));
    assert.ok((await readdir(installationDirectory)).includes('manifest.json'));

    for (const args of [
        ['--non-interactive', '--remove-installation', 'true'],
        ['--non-interactive', '--remove-config'],
        ['--non-interactive', '--remove-config', 'sometimes'],
        ['--non-interactive', '--remove-config', 'true', '--remove-config', 'false'],
        ['--non-interactive', '--stop-background-agents'],
        ['--non-interactive', '--stop-background-agents', 'sometimes'],
        ['--non-interactive', '--stop-background-agents', 'true', '--stop-background-agents', 'false'],
    ]) {
        const invalidHome = await createHome(t);
        const invalidInstallation = await writeInstallation(invalidHome);
        /** @type {string[]} */
        const errors = [];
        const invalid = await runUninstaller(args, {
            environment: {HOME: invalidHome},
            platform: 'linux',
            stderr: message => errors.push(message),
            stdout: () => {},
        });
        assert.equal(invalid, 2, args.join(' '));
        assert.match(errors.join('\n'), /Usage: node uninstall\.mjs/);
        assert.ok((await readdir(invalidInstallation)).includes('manifest.json'));
    }
});

test('background Agent closing requires its own choice and is rechecked before deletion', async t => {
    const activeAgents = [{role: 'requirements-reviewer', ownerId: 'main-1', ownerTitle: 'Review', state: 'running', taskElapsedMs: 1000}];
    const home = await createHome(t);
    const installation = await writeInstallation(home);
    /** @type {string[]} */
    const prompts = [];
    /** @type {unknown[]} */
    const idleEvictionChoices = [];
    const blocked = await runUninstaller([], {
        acquireMaintenance: async input => {
            assert.equal(input.stopBackgroundAgents, false);
            idleEvictionChoices.push(input.allowIdleEviction);
            return {status: /** @type {const} */ ('busy'), reason: 'active background Agent', stoppedAgents: []};
        },
        environment: {HOME: home},
        listBackgroundAgents: async () => activeAgents,
        platform: 'linux',
        prompt: async (decision, observed) => {
            prompts.push(decision);
            if (decision === 'stopBackgroundAgents') assert.deepEqual(observed, activeAgents);
            return decision === 'removeInstallation';
        },
        stderr: () => {},
        stdout: () => {},
    });
    assert.equal(blocked, 1);
    assert.deepEqual(prompts, ['removeInstallation', 'removeConfig', 'stopBackgroundAgents']);
    assert.ok((await readdir(installation)).includes('manifest.json'));

    const withoutPreview = await runUninstaller([], {
        acquireMaintenance: async input => {
            assert.equal(input.stopBackgroundAgents, false);
            idleEvictionChoices.push(input.allowIdleEviction);
            return {status: 'busy', reason: 'new background Agent', stoppedAgents: []};
        },
        environment: {HOME: home},
        listBackgroundAgents: async () => [],
        platform: 'linux',
        prompt: async decision => decision === 'removeInstallation',
        stderr: () => {},
        stdout: () => {},
    });
    assert.equal(withoutPreview, 1);
    assert.deepEqual(idleEvictionChoices, [false, false]);
    assert.ok((await readdir(installation)).includes('manifest.json'));

    const partlyStopped = await runNonInteractive(home, ['--stop-background-agents', 'true'], {
        acquireMaintenance: async () => ({
            status: 'unknown',
            reason: 'tool exit is unproven',
            stoppedAgents: ['run-1'],
        }),
    });
    assert.equal(partlyStopped.result, 1);
    assert.ok(partlyStopped.messages.some(event => event.message === 'Background Agent App Server exited: run-1.'));
    assert.ok(partlyStopped.messages.some(event => event.message.includes('tool exit is unproven')));
    assert.ok((await readdir(installation)).includes('manifest.json'));

    const stopped = await runNonInteractive(home, ['--stop-background-agents', 'true'], {
        acquireMaintenance: async (/** @type {{stopBackgroundAgents?: boolean}} */ input) => {
            assert.equal(input.stopBackgroundAgents, true);
            return {status: /** @type {const} */ ('acquired'), stoppedAgents: ['run-1']};
        },
    });
    assert.equal(stopped.result, 0);
    assert.ok(stopped.messages.some(event => event.message === 'Background Agent App Server exited: run-1.'));
    await assert.rejects(readFile(join(installation, 'manifest.json')), {code: 'ENOENT'});
});

test('root Uninstaller maps prompt EOF to one stable pre-write error', async t => {
    const home = await createHome(t);
    const installationDirectory = await writeInstallation(home);
    const result = await runExitedProcess('node', [join(SOURCE_DIRECTORY, 'uninstall.mjs')], {
        env: {...process.env, HOME: home, USERPROFILE: home},
        input: '',
        timeout: 10_000,
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, 'Interactive input ended before a decision was provided.\n');
    assert.ok((await readdir(installationDirectory)).includes('manifest.json'));
});

test('installed uninstall command executes through the real CLI entry point', async t => {
    const home = await createHome(t);
    const installationDirectory = await writeInstallation(home, {
        managedFiles: [
            'lib/arw-common/identity.mjs',
            'lib/arw-common/installation-manifest.mjs',
            'lib/arw-common/product-identity.mjs',
            'lib/background-agent/client.mjs',
            'lib/background-agent/manager-process.mjs',
            'lib/background-agent/message-store.mjs',
            'lib/background-agent/presentation.mjs',
            'lib/background-agent/private-state.mjs',
            'lib/background-agent/process-identity.mjs',
            'lib/background-agent/recovery-state.mjs',
            'lib/background-agent/state-store.mjs',
            'lib/common/filesystem.mjs',
            'lib/common/json.mjs',
            'lib/common/text-policy.mjs',
            'lib/common/text-table.mjs',
            'lib/common/windows-command-line.mjs',
            'lib/installation/cli-prompt.mjs',
            'lib/installation/installation-contract.mjs',
            'lib/installation/uninstallation.mjs',
            'uninstall.mjs',
        ],
    });
    await mkdir(join(installationDirectory, 'lib', 'arw-common'), {recursive: true});
    await copyFile(join(SOURCE_DIRECTORY, 'lib', 'arw-common', 'identity.mjs'), join(installationDirectory, 'lib', 'arw-common', 'identity.mjs'));
    await copyFile(join(SOURCE_DIRECTORY, 'lib', 'arw-common', 'installation-manifest.mjs'), join(installationDirectory, 'lib', 'arw-common', 'installation-manifest.mjs'));
    await copyFile(join(SOURCE_DIRECTORY, 'lib', 'arw-common', 'product-identity.mjs'), join(installationDirectory, 'lib', 'arw-common', 'product-identity.mjs'));
    await mkdir(join(installationDirectory, 'lib', 'background-agent'), {recursive: true});
    await copyFile(join(SOURCE_DIRECTORY, 'lib', 'background-agent', 'client.mjs'), join(installationDirectory, 'lib', 'background-agent', 'client.mjs'));
    await copyFile(join(SOURCE_DIRECTORY, 'lib', 'background-agent', 'manager-process.mjs'), join(installationDirectory, 'lib', 'background-agent', 'manager-process.mjs'));
    await copyFile(join(SOURCE_DIRECTORY, 'lib', 'background-agent', 'message-store.mjs'), join(installationDirectory, 'lib', 'background-agent', 'message-store.mjs'));
    await copyFile(join(SOURCE_DIRECTORY, 'lib', 'background-agent', 'presentation.mjs'), join(installationDirectory, 'lib', 'background-agent', 'presentation.mjs'));
    await copyFile(join(SOURCE_DIRECTORY, 'lib', 'background-agent', 'private-state.mjs'), join(installationDirectory, 'lib', 'background-agent', 'private-state.mjs'));
    await copyFile(join(SOURCE_DIRECTORY, 'lib', 'background-agent', 'process-identity.mjs'), join(installationDirectory, 'lib', 'background-agent', 'process-identity.mjs'));
    await copyFile(join(SOURCE_DIRECTORY, 'lib', 'background-agent', 'recovery-state.mjs'), join(installationDirectory, 'lib', 'background-agent', 'recovery-state.mjs'));
    await copyFile(join(SOURCE_DIRECTORY, 'lib', 'background-agent', 'state-store.mjs'), join(installationDirectory, 'lib', 'background-agent', 'state-store.mjs'));
    await mkdir(join(installationDirectory, 'lib', 'common'), {recursive: true});
    await copyFile(join(SOURCE_DIRECTORY, 'lib', 'common', 'filesystem.mjs'), join(installationDirectory, 'lib', 'common', 'filesystem.mjs'));
    await copyFile(join(SOURCE_DIRECTORY, 'lib', 'common', 'json.mjs'), join(installationDirectory, 'lib', 'common', 'json.mjs'));
    await copyFile(join(SOURCE_DIRECTORY, 'lib', 'common', 'text-policy.mjs'), join(installationDirectory, 'lib', 'common', 'text-policy.mjs'));
    await copyFile(join(SOURCE_DIRECTORY, 'lib', 'common', 'text-table.mjs'), join(installationDirectory, 'lib', 'common', 'text-table.mjs'));
    await copyFile(join(SOURCE_DIRECTORY, 'lib', 'common', 'windows-command-line.mjs'), join(installationDirectory, 'lib', 'common', 'windows-command-line.mjs'));
    await mkdir(join(installationDirectory, 'lib', 'installation'), {recursive: true});
    await copyFile(join(SOURCE_DIRECTORY, 'lib', 'installation', 'cli-prompt.mjs'), join(installationDirectory, 'lib', 'installation', 'cli-prompt.mjs'));
    await copyFile(join(SOURCE_DIRECTORY, 'lib', 'installation', 'installation-contract.mjs'), join(installationDirectory, 'lib', 'installation', 'installation-contract.mjs'));
    await copyFile(join(SOURCE_DIRECTORY, 'uninstall.mjs'), join(installationDirectory, 'uninstall.mjs'));
    await copyFile(join(SOURCE_DIRECTORY, 'lib', 'installation', 'uninstallation.mjs'), join(installationDirectory, 'lib', 'installation', 'uninstallation.mjs'));

    const {stderr, stdout} = await runSuccessfulProcess('node', [join(installationDirectory, 'uninstall.mjs'), '--non-interactive', '--remove-config', 'true'], {env: {...process.env, HOME: home, USERPROFILE: home}});

    assert.equal(stderr, '');
    assert.match(stdout, /Uninstalled agent-repository-workflow from /);
    assert.deepEqual(await readdir(installationDirectory), ['background-agent-state']);
});
