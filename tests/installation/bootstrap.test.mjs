import assert from 'node:assert/strict';
import {access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test, {after} from 'node:test';

import {moduleSpecifiers, resolveSourceImport} from '../helpers/module-imports.mjs';
import {runExitedProcess, runSuccessfulProcess} from '../helpers/process.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {generateBootstrapArtifact} from '../../lib/installation/bootstrap-artifact.mjs';
import {BootstrapUsageError, runBootstrap} from '../../lib/installation/bootstrap.mjs';

const SOURCE_DIRECTORY = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

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

const RELEASE_CONFIGURATION = {
    status: 'succeeded',
    value: {repositories: {sourceCheckout: {url: 'https://github.com/example/arw.git'}}},
};
const ARCHIVE_DIRECTORY = await mkdtemp(join(tmpdir(), 'arw-bootstrap-archive-'));
const ARCHIVE = join(ARCHIVE_DIRECTORY, 'arw.tar.gz');
await runSuccessfulProcess(process.execPath, [join(SOURCE_DIRECTORY, 'scripts', 'pack-release.mjs'), ARCHIVE]);
after(() => rm(ARCHIVE_DIRECTORY, {force: true, recursive: true}));
const ASSET_URL = (/** @type {string} */ tag) => `https://github.com/example/arw/releases/download/${tag}/arw.tar.gz`;

test('bootstrap with --version downloads that release asset, hands off the tag and cleans up', async () => {
    /** @type {string[]} */
    const downloads = [];
    /** @type {string[]} */
    const cleanup = [];
    /** @type {unknown[]} */
    const installers = [];
    const result = await runBootstrap(['--non-interactive', '--version', '0.2.0', '--register-path', 'false'], {
        createTemporaryDirectory: async () => '/tmp/arw-release',
        download: async url => { downloads.push(url); return Buffer.from('archive'); },
        extractArchive: async (bytes, directory) => assert.deepEqual([bytes.toString(), directory], ['archive', '/tmp/arw-release']),
        launchInstaller: async input => { installers.push(input); return 7; },
        loadReleaseConfiguration: async () => RELEASE_CONFIGURATION,
        removeTemporaryDirectory: async directory => cleanup.push(directory),
        runtimeVersion: '24.0.0',
    });

    assert.equal(result, 7);
    assert.deepEqual(downloads, [ASSET_URL('0.2.0')]);
    assert.deepEqual(installers, [{
        arguments: ['--non-interactive', '--register-path', 'false'],
        directory: '/tmp/arw-release',
        tag: '0.2.0',
    }]);
    assert.deepEqual(cleanup, ['/tmp/arw-release']);
});

test('bootstrap without --version resolves the latest release tag from the GitHub API', async () => {
    /** @type {string[]} */
    const downloads = [];
    /** @type {string[]} */
    const tags = [];
    await runBootstrap([], {
        createTemporaryDirectory: async () => '/tmp/arw-release',
        download: async url => { downloads.push(url); return Buffer.from('{"tag_name":"1.4.0"}'); },
        extractArchive: async () => {},
        launchInstaller: async input => { tags.push(input.tag); return 0; },
        loadReleaseConfiguration: async () => RELEASE_CONFIGURATION,
        removeTemporaryDirectory: async () => {},
        runtimeVersion: '24.0.0',
    });

    assert.deepEqual(downloads, ['https://api.github.com/repos/example/arw/releases/latest', ASSET_URL('1.4.0')]);
    assert.deepEqual(tags, ['1.4.0']);
});

test('bootstrap rejects bad arguments and remotes before temporary or network work', async () => {
    const fail = async () => assert.fail('must not run');
    const dependencies = {createTemporaryDirectory: fail, download: fail, runtimeVersion: '24.0.0'};
    for (const args of [['--version', 'v1.0.0'], ['--version', '1.0.0', '--version', '1.0.1'], ['--version']]) {
        await assert.rejects(
            runBootstrap(args, {...dependencies, loadReleaseConfiguration: async () => RELEASE_CONFIGURATION}),
            error => error instanceof BootstrapUsageError,
        );
    }
    await assert.rejects(runBootstrap([], {
        ...dependencies,
        loadReleaseConfiguration: async () => ({status: 'succeeded', value: {repositories: {sourceCheckout: {url: 'https://example.invalid/team/arw.git'}}}}),
    }), /canonical GitHub HTTPS remote/);
});

test('bootstrap cleans up and fails when download or extraction fails', async () => {
    for (const failure of ['download', 'extract']) {
        /** @type {string[]} */
        const cleanup = [];
        await assert.rejects(runBootstrap(['--version', '0.2.0'], {
            createTemporaryDirectory: async () => '/tmp/arw-release',
            download: async () => { if (failure === 'download') throw new Error('HTTP 404'); return Buffer.alloc(0); },
            extractArchive: async () => { throw new Error('bad archive'); },
            launchInstaller: async () => assert.fail('must not launch'),
            loadReleaseConfiguration: async () => RELEASE_CONFIGURATION,
            removeTemporaryDirectory: async directory => cleanup.push(directory),
            runtimeVersion: '24.0.0',
        }), /HTTP 404|bad archive/);
        assert.deepEqual(cleanup, ['/tmp/arw-release']);
    }
});

test('bootstrap reports a corrupt archive as one line', async () => {
    await assert.rejects(runBootstrap(['--version', '0.2.0'], {
        download: async () => Buffer.from('not an archive'),
        launchInstaller: async () => assert.fail('must not launch'),
        loadReleaseConfiguration: async () => RELEASE_CONFIGURATION,
        runtimeVersion: '24.0.0',
    }), error => error instanceof Error && /^Archive extraction failed: [^\n]+$/u.test(error.message));
});

test('bootstrap extracts the real release archive without Git and the Installer import closure is complete', async () => {
    /** @type {string[]} */
    const directories = [];
    const closure = ['install.mjs'];

    const result = await runBootstrap(['--version', '0.2.0'], {
        download: async () => readFile(ARCHIVE),
        launchInstaller: async ({directory}) => {
            directories.push(directory);
            await Promise.all(['lib', 'distribution', 'package.json'].map(entry => access(join(directory, entry))));
            await assert.rejects(access(join(directory, 'tests')));
            for (const file of closure) {
                for (const specifier of moduleSpecifiers(await readFile(join(directory, file), 'utf8')).filter(name => name.startsWith('.'))) {
                    const imported = resolveSourceImport(file, specifier);
                    await access(join(directory, imported));
                    if (!closure.includes(imported)) closure.push(imported);
                }
            }
            return 0;
        },
        loadReleaseConfiguration: async () => RELEASE_CONFIGURATION,
        runtimeVersion: '24.0.0',
    });

    assert.equal(result, 0);
    await assert.rejects(access(directories[0]));
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
