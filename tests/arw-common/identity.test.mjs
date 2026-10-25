import assert from 'node:assert/strict';
import {mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {runArw} from '../../arw.mjs';
import {loadIdentity, PRODUCT_NAME, parseArwVersion, parsePackageIdentity} from '../../lib/arw-common/identity.mjs';

const SOURCE_DIRECTORY = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('ARW version parser accepts only stable and fixed pre identities', () => {
    const stable = parseArwVersion('1.2.3');
    const pre = parseArwVersion('1.2.3-pre');

    assert.deepEqual(stable, {core: [1n, 2n, 3n], prerelease: null, value: '1.2.3'});
    assert.deepEqual(pre, {core: [1n, 2n, 3n], prerelease: 'pre', value: '1.2.3-pre'});
    assert.equal(Object.isFrozen(stable), true);
    assert.equal(Object.isFrozen(stable.core), true);
    assert.equal(Object.isFrozen(pre), true);
    assert.equal(Object.isFrozen(pre.core), true);

    for (const value of [null, 123, 'v1.2.3', '01.2.3', '1.2.3-alpha', '1.2.3-pre.1', '1.2.3+build']) {
        assert.throws(() => parseArwVersion(value), /stable MAJOR\.MINOR\.PATCH or fixed -pre/);
    }
});

test('package identity parser rejects invalid bytes, shape, name, and unstable versions', () => {
    /** @type {Array<[Buffer, RegExp]>} */
    const cases = [
        [Buffer.from([0xff]), /not valid UTF-8/],
        [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"name":"agent-repository-workflow","version":"1.2.3"}')]), /not valid JSON/],
        [Buffer.from('{'), /not valid JSON/],
        [Buffer.from('[]'), /JSON object/],
        [Buffer.from('{"name":"other","version":"1.2.3"}'), /name must be agent-repository-workflow/],
        [Buffer.from('{"name":"agent-repository-workflow"}'), /stable MAJOR\.MINOR\.PATCH/],
        [Buffer.from('{"name":"agent-repository-workflow","version":123}'), /stable MAJOR\.MINOR\.PATCH/],
        [Buffer.from('{"name":"agent-repository-workflow","version":"v1.2.3"}'), /stable MAJOR\.MINOR\.PATCH/],
        [Buffer.from('{"name":"agent-repository-workflow","version":"1.2.3-beta.1"}'), /stable MAJOR\.MINOR\.PATCH/],
        [Buffer.from('{"name":"agent-repository-workflow","version":"1.2.3+build"}'), /stable MAJOR\.MINOR\.PATCH/],
        [Buffer.from('{"name":"agent-repository-workflow","version":"01.2.3"}'), /stable MAJOR\.MINOR\.PATCH/],
    ];

    for (const [bytes, expected] of cases) {
        assert.throws(() => parsePackageIdentity(bytes, 'fixture package.json'), expected);
    }
});

test('runtime identity selects exactly one package or manifest authority without fallback', async t => {
    const root = await createTemporaryDirectory(t, 'agent-repository-workflow-identity-');
    const missing = await loadIdentity({directory: root});
    assert.equal(missing.status, 'blocked');
    assert.equal(missing.diagnostics[0].code, 'identity-authority-missing');

    await mkdir(join(root, 'package.json'));
    const directoryAuthority = await loadIdentity({directory: root});
    assert.equal(directoryAuthority.status, 'blocked');
    assert.equal(directoryAuthority.diagnostics[0].code, 'identity-authority-invalid');

    await rm(join(root, 'package.json'), {recursive: true});
    await writeFile(join(root, 'package.json'), '{"name":"agent-repository-workflow","version":"9.8.7"}\n', 'utf8');
    assert.deepEqual(await loadIdentity({directory: root}), {
        arwVersion: '9.8.7',
        diagnostics: [],
        product: PRODUCT_NAME,
        status: 'succeeded',
    });

    await rm(join(root, 'package.json'));
    await writeFile(join(root, 'manifest.json'), `${JSON.stringify({
        arwVersion: '9.8.7-pre',
        managedFiles: ['arw.mjs'],
        manifestVersion: 2,
        pathOwnership: [],
        product: 'agent-repository-workflow',
    })}\n`, 'utf8');
    assert.deepEqual(await loadIdentity({directory: root}), {
        arwVersion: '9.8.7-pre',
        diagnostics: [],
        product: PRODUCT_NAME,
        status: 'succeeded',
    });

    await writeFile(join(root, 'package.json'), '{"name":"agent-repository-workflow","version":"9.8.7"}\n', 'utf8');
    const inconsistent = await loadIdentity({directory: root});
    assert.equal(inconsistent.status, 'blocked');
    assert.equal(inconsistent.diagnostics[0].code, 'identity-layout-inconsistent');

    await rm(join(root, 'package.json'));
    await writeFile(join(root, 'manifest.json'), '{', 'utf8');
    const invalidManifest = await loadIdentity({directory: root});
    assert.equal(invalidManifest.status, 'blocked');
    assert.equal(invalidManifest.diagnostics[0].code, 'identity-invalid');
    assert.match(invalidManifest.diagnostics[0].message, /manifest is not valid JSON/);
    await assert.rejects(loadIdentity({directory: 'relative'}), TypeError);
});

test('runtime identity rejects a linked Installation manifest authority', async t => {
    const root = await createTemporaryDirectory(t, 'agent-repository-workflow-linked-identity-');
    const external = await createTemporaryDirectory(t, 'agent-repository-workflow-external-identity-');
    const externalManifest = join(external, 'manifest.json');
    await writeFile(externalManifest, `${JSON.stringify({
        arwVersion: '9.8.7',
        managedFiles: ['arw.mjs'],
        manifestVersion: 2,
        pathOwnership: [],
        product: 'agent-repository-workflow',
    })}\n`, 'utf8');
    try {
        await symlink(externalManifest, join(root, 'manifest.json'), 'file');
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EPERM') {
            t.skip('The current environment does not allow file links.');
            return;
        }
        throw error;
    }

    const result = await loadIdentity({directory: root});
    assert.equal(result.status, 'blocked');
    assert.equal(result.diagnostics[0].code, 'identity-authority-invalid');
});

test('release exposes only the package identity', async () => {
    const packageMetadata = JSON.parse(await readFile(join(SOURCE_DIRECTORY, 'package.json'), 'utf8'));
    /** @type {string[]} */
    const stdout = [];
    const result = await runArw(['--version'], {
        stdout: message => stdout.push(message),
        stderr: message => assert.fail(String(message)),
    });
    assert.equal(result, 0);
    assert.deepEqual(stdout, [packageMetadata.version]);
});
