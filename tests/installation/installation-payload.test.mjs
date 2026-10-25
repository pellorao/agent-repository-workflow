import assert from 'node:assert/strict';
import {cp, mkdir, readFile, symlink, writeFile} from 'node:fs/promises';
import test from 'node:test';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {loadInstallationPayload} from '../../lib/installation/installation-payload.mjs';

const SOURCE_DIRECTORY = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('Installation Payload Interface returns the canonical platform payload without package metadata', async () => {
    const result = await loadInstallationPayload({
        platform: 'win32',
        sourceDirectory: SOURCE_DIRECTORY,
    });

    assert.deepEqual(Object.keys(result).sort(), [
        'configSeedBytes',
        'diagnostics',
        'payload',
        'status',
        'verificationPaths',
    ]);
    assert.equal(result.status, 'succeeded');
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.configSeedBytes, await readFile(new URL('../../config.install.json', import.meta.url)));
    const payloadByPath = new Map(result.payload.map(entry => [entry.path, entry.bytes]));
    assert.deepEqual(payloadByPath.get('LICENSE.txt'), await readFile(new URL('../../LICENSE.txt', import.meta.url)));
    assert.deepEqual(payloadByPath.get('arw.mjs'), await readFile(new URL('../../arw.mjs', import.meta.url)));
    assert.deepEqual(payloadByPath.get('arw'), await readFile(new URL('../../arw', import.meta.url)));
    assert.deepEqual(payloadByPath.get('arw.cmd'), await readFile(new URL('../../arw.cmd', import.meta.url)));
    assert.deepEqual(payloadByPath.get('distribution/config.json'), await readFile(new URL('../../distribution/config.json', import.meta.url)));
    assert.equal(payloadByPath.has('config.json'), false);
    assert.equal(payloadByPath.has('manifest.json'), false);
    assert.equal(payloadByPath.has('package.json'), false);
    assert.equal(result.verificationPaths.includes('package.json'), false);
    assert.deepEqual(result.payload.map(entry => entry.path), [...payloadByPath.keys()].sort());
    assert.deepEqual(result.verificationPaths, [
        'config.install.json',
        'release-manifest.json',
        ...payloadByPath.keys(),
    ].sort());
});

test('Installation Payload rejects invalid calls synchronously and closes non-success results', async () => {
    assert.throws(
        () => loadInstallationPayload({platform: 'linux'}),
        /Installation payload input/u,
    );
    const unsupported = await loadInstallationPayload({
        platform: 'freebsd',
        sourceDirectory: SOURCE_DIRECTORY,
    });
    assert.deepEqual(Object.keys(unsupported).sort(), ['diagnostics', 'status']);
    assert.equal(unsupported.status, 'blocked');
    assert.equal(unsupported.diagnostics[0].code, 'installation-platform-unsupported');
});

test('Installation Payload preserves manifest failure classifications without full checkout copies', async t => {
    const manifest = {
        configSeed: 'config.install.json',
        distributionRoot: 'distribution',
        launchers: {darwin: ['arw'], linux: ['arw'], win32: ['arw']},
        runtimeFiles: ['arw.mjs'],
    };
    const scenarios = [
        {bytes: null, code: 'installation-source-unsafe', name: 'missing manifest', status: 'blocked'},
        {bytes: '{', code: 'release-manifest-invalid', name: 'malformed manifest', status: 'blocked'},
        {bytes: JSON.stringify(manifest), code: 'release-manifest-invalid', name: 'noncanonical manifest', status: 'blocked'},
        {
            bytes: `${JSON.stringify({
                ...manifest,
                launchers: {...manifest.launchers, linux: ['arw', 'arw']},
            }, null, 2)}\n`,
            code: 'release-manifest-invalid',
            name: 'duplicate target declaration',
            status: 'blocked',
        },
    ];

    for (const scenario of scenarios) {
        await t.test(scenario.name, async t => {
            const source = await createTemporaryDirectory(t, 'installation-payload-manifest-failure-');
            if (scenario.bytes !== null) await writeFile(join(source, 'release-manifest.json'), scenario.bytes, 'utf8');

            const result = await loadInstallationPayload({platform: 'linux', sourceDirectory: source});

            assert.equal(result.status, scenario.status);
            assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), [scenario.code]);
        });
    }
});

test('Installation Payload normalizes a trailing Distribution separator through Filesystem join', async t => {
    const source = await createTemporaryDirectory(t, 'installation-payload-trailing-root-');
    await cp(join(SOURCE_DIRECTORY, 'distribution'), join(source, 'distribution'), {recursive: true});
    for (const file of ['arw', 'arw.mjs', 'config.install.json']) {
        await cp(join(SOURCE_DIRECTORY, file), join(source, file));
    }
    await writeFile(join(source, 'release-manifest.json'), `${JSON.stringify({
        configSeed: 'config.install.json',
        distributionRoot: 'distribution/',
        launchers: {darwin: ['arw'], linux: ['arw'], win32: ['arw']},
        runtimeFiles: ['arw.mjs'],
    }, null, 2)}\n`, 'utf8');

    const result = await loadInstallationPayload({platform: 'linux', sourceDirectory: source});

    assert.equal(result.status, 'succeeded');
    if (result.status !== 'succeeded') assert.fail('Trailing Distribution separator must be normalized.');
    assert.equal(result.payload.some(entry => entry.path.includes('//')), false);
    assert.equal(result.payload.some(entry => entry.path === 'distribution/config.json'), true);
});

test('Installation Payload rejects source-only and config seed payload declarations', async t => {
    for (const scenario of [
        {
            configSeed: 'config.install.json',
            name: 'source-only runtime file',
            runtimeFiles: ['package.json'],
        },
        {
            configSeed: 'arw.mjs',
            name: 'config seed overlap',
            runtimeFiles: ['arw.mjs'],
        },
    ]) {
        await t.test(scenario.name, async t => {
            const source = await createTemporaryDirectory(t, 'installation-payload-source-only-');
            await writeFile(join(source, 'release-manifest.json'), `${JSON.stringify({
                configSeed: scenario.configSeed,
                distributionRoot: 'distribution',
                launchers: {darwin: ['arw'], linux: ['arw'], win32: ['arw']},
                runtimeFiles: scenario.runtimeFiles,
            }, null, 2)}\n`, 'utf8');

            const result = await loadInstallationPayload({platform: 'linux', sourceDirectory: source});

            assert.equal(result.status, 'blocked');
            assert.deepEqual(Object.keys(result).sort(), ['diagnostics', 'status']);
            assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), ['release-manifest-invalid']);
        });
    }
});

test('Installation Payload rejects backslash and NUL in slash-form manifest paths', async t => {
    for (const runtimePath of ['lib\\runtime.mjs', 'lib/\0runtime.mjs']) {
        await t.test(JSON.stringify(runtimePath), async t => {
            const source = await createTemporaryDirectory(t, 'installation-payload-logical-path-');
            await writeFile(join(source, 'release-manifest.json'), `${JSON.stringify({
                configSeed: 'config.install.json',
                distributionRoot: 'distribution',
                launchers: {darwin: ['arw'], linux: ['arw'], win32: ['arw']},
                runtimeFiles: [runtimePath],
            }, null, 2)}\n`, 'utf8');

            const result = await loadInstallationPayload({platform: 'linux', sourceDirectory: source});

            assert.equal(result.status, 'blocked');
            assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), ['release-manifest-invalid']);
        });
    }
});

test('Installation Payload rejects an intermediate linked Distribution parent before reading it', async t => {
    const source = await createTemporaryDirectory(t, 'installation-payload-linked-source-');
    const external = await createTemporaryDirectory(t, 'installation-payload-linked-external-');
    await cp(join(SOURCE_DIRECTORY, 'distribution'), join(external, 'distribution'), {recursive: true});
    for (const file of ['arw', 'arw.mjs', 'config.install.json']) {
        await cp(join(SOURCE_DIRECTORY, file), join(source, file));
    }
    await writeFile(join(source, 'release-manifest.json'), `${JSON.stringify({
        configSeed: 'config.install.json',
        distributionRoot: 'linked/distribution',
        launchers: {darwin: ['arw'], linux: ['arw'], win32: ['arw']},
        runtimeFiles: ['arw.mjs'],
    }, null, 2)}\n`, 'utf8');
    try {
        await symlink(external, join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EPERM') {
            t.skip('The current environment does not allow directory links.');
            return;
        }
        throw error;
    }

    const result = await loadInstallationPayload({platform: 'linux', sourceDirectory: source});

    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), ['installation-source-unsafe']);
});
