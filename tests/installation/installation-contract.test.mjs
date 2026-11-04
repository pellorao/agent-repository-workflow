import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {installFakeCommand, runProcess} from '../helpers/process.mjs';
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

test('Windows PATH registration keeps non-ASCII user PATH entries', async t => {
    const root = await createTemporaryDirectory(t, 'installation-contract-powershell-');
    const installationDirectory = join(root, 'installation');
    const written = join(root, 'written');
    const userPath = 'C:\\\u6d4b\u8bd5\\bin';
    // Fake powershell.exe: read emits UTF-8 only when the script switches the console output encoding, every other call appends its environment (where a write receives the new value) and emits legacy-codepage bytes.
    await writeFile(join(root, 'utf8.json'), `{"exists":true,"kind":"ExpandString","value":${JSON.stringify(userPath)}}`);
    await writeFile(join(root, 'legacy.json'), Buffer.concat([Buffer.from('{"exists":true,"kind":"ExpandString","value":"C:\\\\'), Buffer.from([0xb2, 0xe2, 0xca, 0xd4]), Buffer.from('\\\\bin"}')]));
    await installFakeCommand(t, root, 'powershell.exe', [
        'case "$3" in',
        `*'[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false);'*) cat '${join(root, 'utf8.json')}' ;;`,
        `*) env >> '${written}'; cat '${join(root, 'legacy.json')}' ;;`,
        'esac',
        '',
    ].join('\n'));

    const planned = await planPathRegistration({
        installation: {directory: installationDirectory, exists: true, managed: false, manifest: null, pathKind: /** @type {'windows-user-path'} */ ('windows-user-path')},
        registerPath: true,
    });
    if (planned.status !== 'succeeded') assert.fail('PATH plan must succeed.');
    const applied = await applyPathOwnershipPlan(planned.preparedPathOwnership);

    assert.equal(applied.status, 'succeeded');
    assert.ok((await readFile(written, 'utf8')).includes(`=${userPath};${installationDirectory}\n`));
});

test('Windows PATH preflight reports PowerShell timeout before writing', async t => {
    const original = childProcess.execFile;
    let calls = 0;
    childProcess.execFile = /** @type {typeof childProcess.execFile} */ (/** @type {unknown} */ ((/** @type {string} */ file, /** @type {string[]} */ _args, /** @type {{timeout: number}} */ options, /** @type {(error: Error) => void} */ callback) => {
        calls += 1;
        assert.equal(file, 'powershell.exe');
        assert.equal(options.timeout, 60_000);
        callback(Object.assign(new Error('Command failed: powershell.exe -NoProfile -Command <script>'), {killed: true, signal: 'SIGTERM'}));
    }));
    syncBuiltinESMExports();
    t.after(() => { childProcess.execFile = original; syncBuiltinESMExports(); });
    const {planPathRegistration: plan} = await import(new URL('../../lib/installation/installation-contract.mjs?timeout', import.meta.url).href);
    const result = await plan({
        installation: {directory: 'C:\\arw', exists: true, managed: false, manifest: null, pathKind: 'windows-user-path'},
        registerPath: true,
    });
    assert.equal(result.status, 'failed');
    if (result.status !== 'failed') assert.fail('Timeout must fail preflight.');
    assert.equal(result.stage, 'path-observation');
    assert.equal(result.diagnostics[0].message, 'PowerShell did not finish within 60 seconds.');
    assert.equal(calls, 1);
});

test('Windows release guest check rejects missing Git before installation', async () => {
    const result = await runProcess(process.execPath, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import childProcess from 'node:child_process';
        import {syncBuiltinESMExports} from 'node:module';
        Object.defineProperty(process, 'platform', {value: 'win32'});
        childProcess.spawnSync = () => ({status: 1, stdout: '', stderr: 'Git not found'});
        syncBuiltinESMExports();
        await assert.rejects(import(${JSON.stringify(new URL('../../scripts/release-guest-check.mjs', import.meta.url).href)}), /Git for Windows is required/);
    `]);
    assert.equal(result.status, 'exited');
    if (result.status === 'exited') assert.equal(result.exitCode, 0, result.stderr);
});
