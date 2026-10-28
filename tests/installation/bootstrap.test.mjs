import assert from 'node:assert/strict';
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test from 'node:test';

import {runExitedProcess, runSuccessfulProcess} from '../helpers/process.mjs';
import {runGit} from '../helpers/git.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {generateBootstrapArtifact} from '../../lib/installation/bootstrap-artifact.mjs';
import {BootstrapUsageError, runBootstrap, selectStableRelease} from '../../lib/installation/bootstrap.mjs';
import {loadReleaseValidationConfiguration} from '../../lib/release/release-validation-config.mjs';

/** @typedef {{arguments: string[], checkoutDirectory: string, commit: string, tag: string}} InstallerLaunchInput */

const SOURCE_DIRECTORY = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const releaseConfiguration = await loadReleaseValidationConfiguration();
if (releaseConfiguration.status !== 'succeeded' || !('value' in releaseConfiguration)) throw new Error('Test requires valid release-validation.json.');
const CANONICAL_REMOTE = releaseConfiguration.value.repositories.sourceCheckout.url;

test('Bootstrap Artifact Module closes invalid input, mismatch, and write results', async t => {
    assert.deepEqual(await generateBootstrapArtifact({mode: 'check', sourceDirectory: 'relative'}), {
        diagnostics: [{
            code: 'bootstrap-artifact-input-invalid',
            message: 'Bootstrap Artifact requires sourceDirectory and write or check mode.',
        }],
        status: 'blocked',
    });

    const root = await createTemporaryDirectory(t, 'bootstrap-artifact-');
    for (const directory of ['lib/arw-common', 'lib/installation', 'scripts']) {
        await mkdir(join(root, directory), {recursive: true});
    }
    for (const path of [
        'lib/arw-common/runtime-compatibility.mjs',
        'lib/installation/bootstrap.mjs',
        'release-validation.json',
        'scripts/install-arw.mjs',
    ]) {
        await copyFile(join(SOURCE_DIRECTORY, path), join(root, path));
    }
    await writeFile(join(root, 'scripts', 'install-arw.mjs'), 'drift\n', 'utf8');

    const mismatch = await generateBootstrapArtifact({mode: 'check', sourceDirectory: root});
    assert.equal(mismatch.status, 'blocked');
    assert.equal(mismatch.diagnostics[0].code, 'bootstrap-artifact-mismatch');
    assert.deepEqual(await generateBootstrapArtifact({mode: 'write', sourceDirectory: root}), {
        changed: true,
        diagnostics: [],
        status: 'succeeded',
    });
    assert.deepEqual(await generateBootstrapArtifact({mode: 'check', sourceDirectory: root}), {
        changed: false,
        diagnostics: [],
        status: 'succeeded',
    });
});

test('scripts bootstrap artifact exposes the standalone CLI seam', async () => {
    const result = await runExitedProcess(process.execPath, [
        join(SOURCE_DIRECTORY, 'scripts', 'install-arw.mjs'),
        '--version',
        'v0.2.0',
    ]);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /stable MAJOR\.MINOR\.PATCH/);
});

test('default bootstrap selection chooses the highest stable SemVer tag', () => {
    assert.equal(selectStableRelease([
        'refs/tags/1.9.0',
        'refs/tags/2.0.0-rc.1',
        'refs/tags/v3.0.0',
        'refs/heads/master',
        'refs/tags/1.10.0',
    ]), '1.10.0');
    assert.throws(() => selectStableRelease(['refs/heads/main']), /no stable ARW release tags/i);
});

test('explicit bootstrap selection accepts only an existing exact stable tag', () => {
    const refs = ['refs/tags/1.2.3', 'refs/tags/2.0.0-rc.1', 'refs/tags/v3.0.0'];

    assert.equal(selectStableRelease(refs, '1.2.3'), '1.2.3');
    assert.throws(() => selectStableRelease(refs, '2.0.0-rc.1'), /stable MAJOR\.MINOR\.PATCH/);
    assert.throws(() => selectStableRelease(refs, '1.2.3+build.1'), /stable MAJOR\.MINOR\.PATCH/);
    assert.throws(() => selectStableRelease(refs, 'v3.0.0'), /stable MAJOR\.MINOR\.PATCH/);
    assert.throws(() => selectStableRelease(refs, '9.9.9'), /does not exist/);
});

test('invalid explicit bootstrap version fails before remote access', async () => {
    /** @type {string[]} */
    const stderr = [];
    let gitCalled = false;
    const failGit = async () => {
        gitCalled = true;
        throw new Error('Git must not run.');
    };
    await assert.rejects(runBootstrap(['--version', 'v1.0.0'], {
        git: {
            checkoutCommit: failGit,
            fetchRelease: failGit,
            initialize: failGit,
            listRemoteTags: failGit,
            readHead: failGit,
            resolveTagCommit: failGit,
        },
        runtimeVersion: '24.0.0',
        stderr: message => stderr.push(message),
    }), error => error instanceof BootstrapUsageError);
    assert.equal(gitCalled, false);
    assert.deepEqual(stderr, []);
});

test('bootstrap verbose mode consumes one flag in any position and emits three canonical actual events', async () => {
    /** @type {string[]} */
    const stderr = [];
    const commit = '0123456789abcdef0123456789abcdef01234567';
    for (const args of [
        ['--verbose', '--one', '1', '--version', '0.2.0', '--two', '2'],
        ['--one', '1', '--version', '0.2.0', '--verbose', '--two', '2'],
        ['--one', '1', '--version', '0.2.0', '--two', '2', '--verbose'],
    ]) {
        /** @type {string[]} */
        const stdout = [];
        /** @type {InstallerLaunchInput[]} */
        const installers = [];
        const result = await runBootstrap(args, {
            createTemporaryDirectory: async () => 'C:\\temporary\\arw-release',
            git: {
                checkoutCommit: async () => {},
                fetchRelease: async () => {},
                initialize: async () => {},
                listRemoteTags: async () => ['refs/tags/0.2.0'],
                readHead: async () => commit,
                resolveTagCommit: async () => commit,
            },
            launchInstaller: async input => {
                installers.push(input);
                return 0;
            },
            removeTemporaryDirectory: async () => {},
            runtimeVersion: '24.0.0',
            stderr: message => stderr.push(message),
            stdout: line => stdout.push(line),
        });

        assert.equal(result, 0);
        assert.deepEqual(installers[0].arguments, ['--one', '1', '--two', '2']);
        assert.deepEqual(stdout, [
            '{"event":"release-selected","tag":"0.2.0"}\n',
            `{"commit":"${commit}","event":"tag-resolved","tag":"0.2.0"}\n`,
            `{"commit":"${commit}","event":"checkout-verified"}\n`,
        ]);
    }
    assert.deepEqual(stderr, []);
});

test('bootstrap rejects duplicate verbose before temporary or remote work', async () => {
    /** @type {string[]} */
    const stderr = [];
    let temporaryCalled = false;
    await assert.rejects(
        runBootstrap(['--verbose', '--version', '0.2.0', '--verbose'], {
            createTemporaryDirectory: async () => {
                temporaryCalled = true;
                throw new Error('must not create');
            },
            runtimeVersion: '24.0.0',
            stderr: message => stderr.push(message),
        }),
        error => error instanceof BootstrapUsageError && /unrepeated --verbose/.test(error.message),
    );
    assert.equal(temporaryCalled, false);
    assert.deepEqual(stderr, []);
});

test('bootstrap non-verbose behavior emits no events and verbose failure preserves only the actual prefix', async () => {
    /** @type {string[]} */
    const stderr = [];
    /** @type {string[]} */
    const nonVerbose = [];
    await runBootstrap(['--version', '0.2.0'], {
        createTemporaryDirectory: async () => 'C:\\temporary\\arw-release',
        git: {
            checkoutCommit: async () => {},
            fetchRelease: async () => {},
            initialize: async () => {},
            listRemoteTags: async () => ['refs/tags/0.2.0'],
            readHead: async () => 'a'.repeat(40),
            resolveTagCommit: async () => 'a'.repeat(40),
        },
        launchInstaller: async () => 0,
        removeTemporaryDirectory: async () => {},
        runtimeVersion: '24.0.0',
        stderr: message => stderr.push(message),
        stdout: line => nonVerbose.push(line),
    });
    assert.deepEqual(nonVerbose, []);

    /** @type {string[]} */
    const verbose = [];
    await assert.rejects(runBootstrap(['--version', '0.2.0', '--verbose'], {
        createTemporaryDirectory: async () => 'C:\\temporary\\arw-release',
        git: {
            checkoutCommit: async () => {},
            fetchRelease: async () => {},
            initialize: async () => {},
            listRemoteTags: async () => ['refs/tags/0.2.0'],
            readHead: async () => assert.fail('must stop before checkout'),
            resolveTagCommit: async () => { throw new Error('resolve failed'); },
        },
        removeTemporaryDirectory: async () => {},
        runtimeVersion: '24.0.0',
        stderr: message => stderr.push(message),
        stdout: line => verbose.push(line),
    }), /resolve failed/);
    assert.deepEqual(verbose, ['{"event":"release-selected","tag":"0.2.0"}\n']);
    assert.deepEqual(stderr, []);
});

test('bootstrap ignores caller repository URL rewrites', async t => {
    const root = await createTemporaryDirectory(t, 'agent-repository-workflow-bootstrap-cwd-');
    const caller = join(root, 'caller');
    const remote = join(root, 'remote');

    await runGit(root, ['init', '--quiet', '--initial-branch=main', remote]);
    await runGit(remote, ['config', 'user.name', 'ARW Tests']);
    await runGit(remote, ['config', 'user.email', 'tests@example.invalid']);
    await runGit(remote, ['commit', '--quiet', '--allow-empty', '-m', 'local redirect target']);
    await runGit(remote, ['tag', '9.9.9']);
    await runGit(root, ['init', '--quiet', '--initial-branch=main', caller]);
    await runGit(caller, [
        'config',
        `url.${pathToFileURL(remote).href}.insteadOf`,
        CANONICAL_REMOTE,
    ]);

    const bootstrapUrl = pathToFileURL(join(SOURCE_DIRECTORY, 'lib', 'installation', 'bootstrap.mjs')).href;
    const program = `
        import {runBootstrap} from ${JSON.stringify(bootstrapUrl)};
        try {
            await runBootstrap(['--version', '1.2.3'], {runtimeVersion: '24.0.0'});
        } catch (error) {
            process.stdout.write(error instanceof Error ? error.message : String(error));
        }
    `;
    const {stdout} = await runSuccessfulProcess(process.execPath, ['--input-type=module', '--eval', program], {cwd: caller, env: {...process.env, GIT_ALLOW_PROTOCOL: 'file'}});

    assert.doesNotMatch(stdout, /requested ARW release tag does not exist/);
    assert.match(stdout, /transport 'https' not allowed/);
});

test('bootstrap acquires an exact release from the fixed remote and hands it to the versioned installer', async () => {
    /** @type {string[]} */
    const stderr = [];
    /** @type {{cleanup: string[], installer: InstallerLaunchInput[], remotes: string[]}} */
    const observed = {cleanup: [], installer: [], remotes: []};
    const commit = '0123456789abcdef0123456789abcdef01234567';
    const checkoutDirectory = 'C:\\temporary\\arw-release';
    const result = await runBootstrap(['--non-interactive', '--register-path', 'false'], {
        createTemporaryDirectory: async () => checkoutDirectory,
        git: {
            checkoutCommit: async () => {},
            fetchRelease: async () => {},
            initialize: async () => {},
            listRemoteTags: async (directory, remote) => {
                assert.equal(directory, checkoutDirectory);
                observed.remotes.push(remote);
                return ['refs/tags/0.2.0'];
            },
            readHead: async () => commit,
            resolveTagCommit: async () => commit,
        },
        launchInstaller: async input => {
            observed.installer.push(input);
            return 0;
        },
        removeTemporaryDirectory: async directory => observed.cleanup.push(directory),
        runtimeVersion: '24.0.0',
        stderr: message => stderr.push(message),
    });

    assert.deepEqual({
        cleanup: observed.cleanup,
        installer: observed.installer,
        remotes: observed.remotes,
        result,
    }, {
        cleanup: [checkoutDirectory],
        installer: [{
            arguments: ['--non-interactive', '--register-path', 'false'],
            checkoutDirectory,
            commit,
            tag: '0.2.0',
        }],
        remotes: [CANONICAL_REMOTE],
        result: 0,
    });
    assert.deepEqual(stderr, []);
});

test('Bootstrap artifact projects the canonical remote from Release configuration', async t => {
    const [bootstrapSource, runtimeCompatibilitySource] = await Promise.all([
        readFile(new URL('../../lib/installation/bootstrap.mjs', import.meta.url), 'utf8'),
        readFile(new URL('../../lib/arw-common/runtime-compatibility.mjs', import.meta.url), 'utf8'),
    ]);
    const baseConfiguration = JSON.parse(await readFile(new URL('../../release-validation.json', import.meta.url), 'utf8'));
    const render = async (/** @type {string} */ remote) => {
        const root = await createTemporaryDirectory(t, 'arw-bootstrap-configuration-');
        await Promise.all([
            mkdir(join(root, 'lib', 'arw-common'), {recursive: true}),
            mkdir(join(root, 'lib', 'installation'), {recursive: true}),
            mkdir(join(root, 'scripts'), {recursive: true}),
        ]);
        await Promise.all([
            writeFile(join(root, 'lib', 'arw-common', 'runtime-compatibility.mjs'), runtimeCompatibilitySource, 'utf8'),
            writeFile(join(root, 'lib', 'installation', 'bootstrap.mjs'), bootstrapSource, 'utf8'),
            writeFile(join(root, 'release-validation.json'), `${JSON.stringify({
                ...baseConfiguration,
                repositories: {
                    ...baseConfiguration.repositories,
                    sourceCheckout: {...baseConfiguration.repositories.sourceCheckout, url: remote},
                },
            }, null, 2)}\n`, 'utf8'),
            writeFile(join(root, 'scripts', 'install-arw.mjs'), '', 'utf8'),
        ]);
        assert.equal((await generateBootstrapArtifact({mode: 'write', sourceDirectory: root})).status, 'succeeded');
        return readFile(join(root, 'scripts', 'install-arw.mjs'), 'utf8');
    };
    const first = await render('https://example.invalid/team/arw.git');
    const second = await render('https://example.invalid/team/changed.git');

    assert.match(first, /https:\/\/example\.invalid\/team\/arw\.git/u);
    assert.doesNotMatch(first, /release-validation-config\.mjs/u);
    assert.notEqual(first, second);
});
