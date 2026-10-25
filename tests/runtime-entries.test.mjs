import assert from 'node:assert/strict';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test from 'node:test';

import {createTemporaryDirectory} from './helpers/cleanup.mjs';
import {commitAll, runGit} from './helpers/git.mjs';
import {runProcess} from './helpers/process.mjs';
import {createRepository} from './helpers/repository-fixture.mjs';

const SOURCE_DIRECTORY = dirname(dirname(fileURLToPath(import.meta.url)));
const VERSION_PRELOAD = pathToFileURL(join(SOURCE_DIRECTORY, 'tests', 'fixtures', 'runtime-version-preload.mjs')).href;
const CANONICAL_REMOTE = JSON.parse(await readFile(join(SOURCE_DIRECTORY, 'release-validation.json'), 'utf8')).repositories.sourceCheckout.url;

test('the release manifest includes the background Agent entry and its runtime modules', async () => {
    const manifest = JSON.parse(await readFile(join(SOURCE_DIRECTORY, 'release-manifest.json'), 'utf8'));
    const included = new Set(/** @type {string[]} */ (manifest.runtimeFiles));
    for (const entry of ['arw.mjs', 'lib/arw.mjs', 'lib/arw-background-agent-host.mjs']) {
        assert.equal(included.has(entry), true, `Installed runtime omits ${entry}.`);
    }
    for (const directory of ['lib/background-agent', 'lib/reviewer-runtime']) {
        const modules = (await readdir(join(SOURCE_DIRECTORY, directory))).filter(name => name.endsWith('.mjs'));
        for (const name of modules) {
            const entry = `${directory}/${name}`;
            assert.equal(included.has(entry), true, `Installed runtime omits ${entry}.`);
        }
    }
});

/**
 * @param {string} relativeEntry
 * @param {string[]} args
 * @param {string} version
 * @param {NodeJS.ProcessEnv} [environment]
 */
const runEntry = async (relativeEntry, args, version, environment = {}) => {
    const result = await runProcess(process.execPath, [
        '--import',
        VERSION_PRELOAD,
        join(SOURCE_DIRECTORY, relativeEntry),
        ...args,
    ], {
        cwd: SOURCE_DIRECTORY,
        env: {...process.env, ...environment, ARW_TEST_NODE_VERSION: version},
    });
    assert.equal(result.status, 'exited');
    if (result.status !== 'exited') assert.fail(`Expected ${relativeEntry} to exit normally.`);
    return result;
};

/**
 * @param {import('node:test').TestContext} t
 */
const createBootstrapEnvironment = async t => {
    const remote = await createRepository(t);
    await mkdir(join(remote, 'lib', 'arw-common'), {recursive: true});
    await writeFile(join(remote, 'install.mjs'), await readFile(join(SOURCE_DIRECTORY, 'install.mjs')));
    await writeFile(
        join(remote, 'lib', 'arw-common', 'runtime-compatibility.mjs'),
        await readFile(join(SOURCE_DIRECTORY, 'lib', 'arw-common', 'runtime-compatibility.mjs')),
    );
    await mkdir(join(remote, 'lib', 'installation'), {recursive: true});
    await writeFile(
        join(remote, 'lib', 'installation', 'cli-prompt.mjs'),
        await readFile(join(SOURCE_DIRECTORY, 'lib', 'installation', 'cli-prompt.mjs')),
    );
    await writeFile(join(remote, 'lib', 'installation', 'installation.mjs'), 'export const runInstaller = async () => 0;\n');
    await writeFile(join(remote, 'lib', 'arw-common', 'product-identity.mjs'), "export const PRODUCT_NAME = 'ARW';\n");
    await commitAll(remote, 'fake release Installer');
    await runGit(remote, ['tag', '1.0.0']);

    const configurationDirectory = await createTemporaryDirectory(t, 'arw-runtime-entry-config-');
    const globalConfiguration = join(configurationDirectory, 'gitconfig');
    await writeFile(globalConfiguration, [
        `[url "${pathToFileURL(remote).href}"]`,
        `    insteadOf = ${CANONICAL_REMOTE}`,
        '',
    ].join('\n'));
    return {
        GIT_ALLOW_PROTOCOL: 'file',
        GIT_CONFIG_GLOBAL: globalConfiguration,
        NODE_OPTIONS: `--import=${VERSION_PRELOAD}`,
    };
};

test('Bootstrap and Installer reject Node.js below 24 before argument handling', async () => {
    for (const {args, entry, version} of [
        {args: ['--version', 'v1.0.0'], entry: 'scripts/install-arw.mjs', version: '22.20.0'},
        {args: ['--unknown'], entry: 'install.mjs', version: '23.11.1'},
    ]) {
        const result = await runEntry(entry, args, version);
        assert.equal(result.exitCode, 1);
        assert.equal(result.stdout, '');
        assert.equal(result.stderr, `ARW requires Node.js 24 or newer. Current runtime: ${version}.\n`);
    }
});

test('Bootstrap and Installer reject an unparseable Node.js version before argument handling', async () => {
    for (const {entry, args} of [
        {args: ['--version', 'v1.0.0'], entry: 'scripts/install-arw.mjs'},
        {args: ['--unknown'], entry: 'install.mjs'},
    ]) {
        const result = await runEntry(entry, args, 'unknown');
        assert.equal(result.exitCode, 1);
        assert.equal(result.stdout, '');
        assert.equal(result.stderr, 'ARW cannot determine the active Node.js major version: unknown.\n');
    }
});

test('Node.js 24 emits no recommendation for direct or complete installation entries', async t => {
    const [bootstrap, installer, environment] = await Promise.all([
        runEntry('scripts/install-arw.mjs', ['--version', 'v1.0.0'], '24.0.0'),
        runEntry('install.mjs', ['--unknown'], '24.0.0'),
        createBootstrapEnvironment(t),
    ]);
    assert.equal(bootstrap.exitCode, 2);
    assert.equal(bootstrap.stdout, '');
    assert.equal(bootstrap.stderr, '--version requires a stable MAJOR.MINOR.PATCH tag.\n');

    assert.equal(installer.exitCode, 2);
    assert.equal(installer.stdout, '');
    assert.equal(installer.stderr, 'Unknown or repeated option: --unknown.\n');

    const complete = await runEntry('scripts/install-arw.mjs', ['--version', '1.0.0'], '24.0.0', environment);
    assert.equal(complete.exitCode, 0);
    assert.equal(complete.stdout, '');
    assert.equal(complete.stderr, '');
});
