import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {createScopedFilesystem} from '../../lib/common/filesystem.mjs';
import {
    applyPathOwnershipPlan,
    inspectInstallation,
    planPathRegistration,
    writeInstallationManifest,
} from '../../lib/installation/installation-contract.mjs';
import {validateInstallationManifestRecord} from '../../lib/arw-common/installation-manifest.mjs';

/** @param {string} installationDirectory @param {unknown[]} pathOwnership */
const writeManifest = async (installationDirectory, pathOwnership) => {
    await writeFile(join(installationDirectory, 'manifest.json'), `${JSON.stringify({
        arwVersion: '0.2.0',
        managedFiles: ['arw.mjs'],
        manifestVersion: 2,
        pathOwnership,
        product: 'agent-repository-workflow',
    }, null, 2)}\n`);
};

test('Installation inspection validates manifest ownership against the fixed platform kind', async t => {
    const root = await createTemporaryDirectory(t, 'installation-contract-owned-');
    const installationDirectory = join(root, 'installation');
    await mkdir(installationDirectory);
    await writeManifest(installationDirectory, [{kind: 'linux-profile', profile: join(dirname(installationDirectory), '.profile')}]);

    const accepted = await inspectInstallation({installationDirectory, platform: 'linux'});
    const rejected = await inspectInstallation({installationDirectory, platform: 'win32'});

    assert.equal(accepted.status, 'succeeded');
    if (accepted.status !== 'succeeded' || accepted.installation === null) assert.fail('Owned manifest must be available.');
    assert.equal(accepted.installation.pathKind, 'linux-profile');
    assert.equal(accepted.installation.manifest?.pathOwnership[0].kind, 'linux-profile');
    assert.equal(rejected.status, 'blocked');
    assert.deepEqual(Object.keys(rejected).sort(), ['diagnostics', 'status']);
    assert.equal(rejected.diagnostics[0].code, 'installation-manifest-unsupported');
});

test('Installation manifest requires canonical managed-file order and at most one PATH ownership record', async t => {
    const root = await createTemporaryDirectory(t, 'installation-manifest-canonical-');
    const installationDirectory = join(root, 'installation');
    await mkdir(installationDirectory);
    const manifest = {
        arwVersion: '0.2.0',
        managedFiles: ['z.mjs', 'a.mjs'],
        manifestVersion: 2,
        pathOwnership: [],
        product: 'agent-repository-workflow',
    };

    assert.throws(() => validateInstallationManifestRecord({
        expectedPathKind: undefined,
        installationDirectory,
        value: manifest,
    }), /unsupported/u);
    assert.throws(() => validateInstallationManifestRecord({
        expectedPathKind: undefined,
        installationDirectory,
        value: {
            ...manifest,
            managedFiles: ['a.mjs', 'z.mjs'],
            pathOwnership: [
                {createdValue: false, entry: installationDirectory, kind: 'windows-user-path', valueKind: 'String'},
                {kind: 'linux-profile', profile: join(dirname(installationDirectory), '.profile')},
            ],
        },
    }), /unsupported/u);

    assert.doesNotThrow(() => validateInstallationManifestRecord({
        expectedPathKind: undefined,
        installationDirectory,
        value: {...manifest, managedFiles: ['lib/file name.mjs']},
    }));
    assert.throws(() => validateInstallationManifestRecord({
        expectedPathKind: undefined,
        installationDirectory,
        value: {...manifest, managedFiles: ['..']},
    }), /unsupported/u);
    for (const path of ['lib\\file.mjs', 'lib/\0file.mjs']) {
        assert.throws(() => validateInstallationManifestRecord({
            expectedPathKind: undefined,
            installationDirectory,
            value: {...manifest, managedFiles: [path]},
        }), /unsupported/u);
    }

    const scoped = await createScopedFilesystem({root});
    assert.equal(scoped.status, 'succeeded');
    if (scoped.status !== 'succeeded') assert.fail('Expected the manifest test Filesystem to open.');
    await writeInstallationManifest(
        {directory: installationDirectory, manifest: null},
        ['z.mjs', 'a.mjs'],
        [],
        {arwVersion: '0.2.0'},
        {filesystem: scoped.scopedFilesystem, installationPath: 'installation'},
    );
    assert.equal(await readFile(join(installationDirectory, 'manifest.json'), 'utf8'), [
        '{',
        '  "arwVersion": "0.2.0",',
        '  "manifestVersion": 2,',
        '  "managedFiles": [',
        '    "a.mjs",',
        '    "z.mjs"',
        '  ],',
        '  "pathOwnership": [],',
        '  "product": "agent-repository-workflow"',
        '}',
        '',
    ].join('\n'));
});

test('PATH plans are opaque, revalidate state, and report write effect', async t => {
    const root = await createTemporaryDirectory(t, 'installation-path-plan-');
    const installationDirectory = join(root, 'installation');
    let currentPath = 'C:\\Tools';
    let writes = 0;
    const installation = {
        directory: installationDirectory,
        exists: true,
        managed: false,
        manifest: null,
        pathKind: /** @type {'windows-user-path'} */ ('windows-user-path'),
    };
    const adapter = {
        notify: async () => true,
        read: async () => ({exists: /** @type {true} */ (true), kind: /** @type {'ExpandString'} */ ('ExpandString'), value: currentPath}),
        write: async (/** @type {{value: string}} */ update) => {
            writes += 1;
            currentPath = update.value;
        },
    };
    const planned = await planPathRegistration({installation, registerPath: true, windowsPath: adapter});
    assert.equal(planned.status, 'succeeded');
    if (planned.status !== 'succeeded') assert.fail('PATH plan must succeed.');
    assert.deepEqual(Object.keys(planned).sort(), ['diagnostics', 'preparedPathOwnership', 'status']);
    assert.deepEqual(Object.keys(planned.preparedPathOwnership), []);

    currentPath = 'C:\\Changed';
    const drifted = await applyPathOwnershipPlan(planned.preparedPathOwnership);
    assert.equal(drifted.status, 'blocked');
    assert.deepEqual(Object.keys(drifted).sort(), ['diagnostics', 'status']);
    assert.equal(writes, 0);

    currentPath = 'C:\\Tools';
    const stablePlan = await planPathRegistration({installation, registerPath: true, windowsPath: adapter});
    if (stablePlan.status !== 'succeeded') assert.fail('Stable PATH plan must succeed.');
    const applied = await applyPathOwnershipPlan(stablePlan.preparedPathOwnership);
    assert.equal(applied.status, 'succeeded');
    assert.equal(applied.changed, true);
    assert.equal(writes, 1);

    const failedPlan = await planPathRegistration({
        installation,
        registerPath: true,
        windowsPath: {
            notify: async () => true,
            read: async () => ({exists: true, kind: /** @type {'ExpandString'} */ ('ExpandString'), value: 'C:\\Other'}),
            write: async () => {
                throw new Error('uncertain write');
            },
        },
    });
    if (failedPlan.status !== 'succeeded') assert.fail('Failure injection plan must succeed.');
    const failed = await applyPathOwnershipPlan(failedPlan.preparedPathOwnership);
    assert.deepEqual(failed, {
        diagnostics: [{code: 'path-write-failed', message: 'uncertain write'}],
        effect: 'unknown',
        pathOwnership: [],
        stage: 'path-write',
        status: 'failed',
    });
});
