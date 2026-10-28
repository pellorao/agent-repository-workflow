import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test from 'node:test';

import {moduleSpecifiers, resolveSourceImport} from './helpers/module-imports.mjs';
import {runProcess} from './helpers/process.mjs';

const SOURCE_DIRECTORY = dirname(dirname(fileURLToPath(import.meta.url)));
const VERSION_PRELOAD = pathToFileURL(join(SOURCE_DIRECTORY, 'tests', 'fixtures', 'runtime-version-preload.mjs')).href;

test('the release manifest includes every module reachable from the installed entries', async () => {
    const manifest = JSON.parse(await readFile(join(SOURCE_DIRECTORY, 'release-manifest.json'), 'utf8'));
    const included = new Set(/** @type {string[]} */ (manifest.runtimeFiles));
    const pending = ['arw.mjs', 'uninstall.mjs', 'lib/arw.mjs', 'lib/arw-background-agent-host.mjs'];
    for (const file of pending) {
        assert.equal(included.has(file), true, `Installed runtime omits ${file}.`);
        const source = await readFile(join(SOURCE_DIRECTORY, file), 'utf8');
        for (const specifier of moduleSpecifiers(source).filter(name => name.startsWith('.'))) {
            const entry = resolveSourceImport(file, specifier);
            if (!pending.includes(entry)) pending.push(entry);
        }
    }
});

/**
 * @param {string} relativeEntry
 * @param {string[]} args
 * @param {string} version
 */
const runEntry = async (relativeEntry, args, version) => {
    const result = await runProcess(process.execPath, [
        '--import',
        VERSION_PRELOAD,
        join(SOURCE_DIRECTORY, relativeEntry),
        ...args,
    ], {
        cwd: SOURCE_DIRECTORY,
        env: {...process.env, ARW_TEST_NODE_VERSION: version},
    });
    assert.equal(result.status, 'exited');
    if (result.status !== 'exited') assert.fail(`Expected ${relativeEntry} to exit normally.`);
    return result;
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

test('Node.js 24 emits no recommendation for direct installation entries', async () => {
    const [bootstrap, installer] = await Promise.all([
        runEntry('scripts/install-arw.mjs', ['--version', 'v1.0.0'], '24.0.0'),
        runEntry('install.mjs', ['--unknown'], '24.0.0'),
    ]);
    assert.equal(bootstrap.exitCode, 2);
    assert.equal(bootstrap.stdout, '');
    assert.equal(bootstrap.stderr, '--version requires a stable MAJOR.MINOR.PATCH tag.\n');

    assert.equal(installer.exitCode, 2);
    assert.equal(installer.stdout, '');
    assert.equal(installer.stderr, 'Unknown or repeated option: --unknown.\n');
});
