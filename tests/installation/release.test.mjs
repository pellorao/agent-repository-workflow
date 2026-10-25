import assert from 'node:assert/strict';
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import test from 'node:test';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {runGit} from '../helpers/git.mjs';
import {createScopedFilesystem} from '../../lib/common/filesystem.mjs';
import {loadInstallationPayload} from '../../lib/installation/installation-payload.mjs';
import {createReleaseLoader, loadRelease} from '../../lib/installation/release.mjs';

/** @typedef {{arwVersion?: string, configSeed: string, distributionRoot: string, launchers: {darwin: string[], linux: string[], win32: string[]}, runtimeFiles: string[]}} ReleaseManifest */

const sourceDirectory = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const packageVersion = JSON.parse(await readFile(join(sourceDirectory, 'package.json'), 'utf8')).version;
const git = (/** @type {string} */ directory, /** @type {string[]} */ ...args) => runGit(directory, args);

const createMinimalReleaseCheckout = async (/** @type {test.TestContext} */ t, prefix = 'agent-repository-workflow-release-') => {
    const checkout = await createTemporaryDirectory(t, prefix);
    const distributionFiles = [
        'distribution/config.json',
        'distribution/projections/config.json',
        'distribution/projections/codex/config.toml',
        'distribution/baseline/.arwignore',
        'distribution/baseline/docs/agents/roles/code-spec-reviewer.md',
    ];
    await Promise.all(distributionFiles.map(async file => {
        await mkdir(dirname(join(checkout, file)), {recursive: true});
        await copyFile(join(sourceDirectory, file), join(checkout, file));
    }));
    await mkdir(join(checkout, 'distribution', 'skills'), {recursive: true});
    /** @type {ReleaseManifest} */
    const manifest = {
        configSeed: 'config.install.json',
        distributionRoot: 'distribution',
        launchers: {darwin: ['arw'], linux: ['arw'], win32: ['arw']},
        runtimeFiles: ['arw.mjs'],
    };
    await Promise.all([
        writeFile(join(checkout, 'arw'), 'launcher\n', 'utf8'),
        writeFile(join(checkout, 'arw.mjs'), 'export {};\n', 'utf8'),
        writeFile(join(checkout, manifest.configSeed), '{}\n', 'utf8'),
        writeFile(join(checkout, 'package.json'), `${JSON.stringify({
            description: 'selected commit',
            name: 'agent-repository-workflow',
            version: packageVersion,
        }, null, 2)}\n`, 'utf8'),
        writeFile(join(checkout, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    ]);
    return {checkout, manifest};
};

const commitReleaseCheckout = async (/** @type {string} */ checkout, /** @type {string} */ version) => {
    await git(checkout, 'init', '--quiet');
    await git(checkout, 'add', '-A');
    await git(checkout, '-c', 'user.email=release-test@example.invalid', '-c', 'user.name=Release Test', 'commit', '--quiet', '-m', `release ${version}`);
    await git(checkout, 'tag', version);
    return (await git(checkout, 'rev-parse', '--verify', 'HEAD')).stdout.trim();
};

test('Release Source Adapter validates the fixed checkout and returns only the common source result', async t => {
    const {checkout} = await createMinimalReleaseCheckout(t);
    const commit = await commitReleaseCheckout(checkout, packageVersion);
    const release = await loadRelease({
        evidence: {
            commit,
            explicitVersion: false,
            tag: packageVersion,
        },
        platform: 'win32',
        sourceDirectory: checkout,
    });

    assert.deepEqual(release, {
        arwVersion: packageVersion,
        diagnostics: [],
        sourceDirectory: checkout,
        status: 'succeeded',
    });
});

test('release loading derives identity from the selected checkout package', async () => {
    const commit = '1'.repeat(40);
    const checkout = sourceDirectory;
    const loader = createReleaseLoader({
        createFilesystem: async () => ({
            diagnostics: [],
            scopedFilesystem: {
                inspect: async () => ({
                    diagnostics: [],
                    entry: {kind: 'file', path: 'package.json'},
                    status: /** @type {'succeeded'} */ ('succeeded'),
                }),
                read: async () => ({
                    bytes: Buffer.from('{"name":"agent-repository-workflow","version":"1.2.3"}\n'),
                    diagnostics: [],
                    path: 'package.json',
                    status: /** @type {'succeeded'} */ ('succeeded'),
                }),
            },
            status: /** @type {'succeeded'} */ ('succeeded'),
        }),
        git: {
            assertFilesMatch: async () => ({status: /** @type {'succeeded'} */ ('succeeded')}),
            readHead: async () => ({commit, status: /** @type {'succeeded'} */ ('succeeded')}),
            resolveTagCommit: async () => ({commit, status: /** @type {'succeeded'} */ ('succeeded')}),
        },
        loadInstallationPayload: async () => ({
            configSeedBytes: Buffer.from('{}\n'),
            diagnostics: [],
            payload: [],
            status: /** @type {'succeeded'} */ ('succeeded'),
            verificationPaths: [],
        }),
    });
    const release = await loader({
        evidence: {commit, explicitVersion: true, tag: '1.2.3'},
        platform: 'linux',
        sourceDirectory: checkout,
    });

    assert.deepEqual(release, {
        arwVersion: '1.2.3',
        diagnostics: [],
        sourceDirectory: checkout,
        status: 'succeeded',
    });
});

test('Release Source Adapter closes package observation failures and identity blockers', async t => {
    const commit = '0123456789abcdef0123456789abcdef01234567';
    const payload = {
        configSeedBytes: Buffer.from('{}\n'),
        diagnostics: [],
        payload: [],
        status: /** @type {'succeeded'} */ ('succeeded'),
        verificationPaths: [],
    };
    /** @type {Array<[{bytes?: Buffer, kind: string}, 'blocked' | 'failed', RegExp]>} */
    const cases = [
        [{kind: 'missing'}, 'failed', /ENOENT/],
        [{bytes: Buffer.from([0xff]), kind: 'file'}, 'blocked', /not valid UTF-8/],
        [{bytes: Buffer.from('{'), kind: 'file'}, 'blocked', /not valid JSON/],
        [{bytes: Buffer.from('[]\n'), kind: 'file'}, 'blocked', /JSON object/],
        [{bytes: Buffer.from('{"name":"other","version":"1.2.3"}\n'), kind: 'file'}, 'blocked', /name must be/],
        [{bytes: Buffer.from('{"name":"agent-repository-workflow"}\n'), kind: 'file'}, 'blocked', /stable MAJOR\.MINOR\.PATCH/],
        [{bytes: Buffer.from('{"name":"agent-repository-workflow","version":123}\n'), kind: 'file'}, 'blocked', /stable MAJOR\.MINOR\.PATCH/],
        [{bytes: Buffer.from('{"name":"agent-repository-workflow","version":"v1.2.3"}\n'), kind: 'file'}, 'blocked', /stable MAJOR\.MINOR\.PATCH/],
        [{bytes: Buffer.from('{"name":"agent-repository-workflow","version":"1.2.3"}\n'), kind: 'file'}, 'blocked', /does not match package\.json version/],
    ];

    for (const [packageEntry, status, expected] of cases) {
        const loader = createReleaseLoader({
            createFilesystem: async () => ({
                diagnostics: [],
                scopedFilesystem: {
                    inspect: async () => ({
                        diagnostics: [],
                        entry: {kind: packageEntry.kind, path: 'package.json'},
                        status: /** @type {'succeeded'} */ ('succeeded'),
                    }),
                    read: async () => ({
                        bytes: packageEntry.bytes ?? Buffer.alloc(0),
                        diagnostics: [],
                        path: 'package.json',
                        status: /** @type {'succeeded'} */ ('succeeded'),
                    }),
                },
                status: /** @type {'succeeded'} */ ('succeeded'),
            }),
            git: {
                assertFilesMatch: async () => assert.fail('Package blocker must stop before Git.'),
                readHead: async () => assert.fail('Package blocker must stop before Git.'),
                resolveTagCommit: async () => assert.fail('Package blocker must stop before Git.'),
            },
            loadInstallationPayload: async () => payload,
        });
        const result = await loader({
            evidence: {commit, explicitVersion: false, tag: packageVersion},
            platform: 'linux',
            sourceDirectory,
        });
        assert.equal(result.status, status);
        assert.deepEqual(Object.keys(result).sort(), status === 'failed'
            ? ['diagnostics', 'stage', 'status']
            : ['diagnostics', 'status']);
        assert.match(result.diagnostics[0].message, expected);
    }
});

test('Release Source Adapter returns a closed blocker when checkout bytes differ from the selected Git tree', async t => {
    const {checkout} = await createMinimalReleaseCheckout(t, 'agent-repository-workflow-release-mismatch-');
    const commit = await commitReleaseCheckout(checkout, packageVersion);
    const packagePath = join(checkout, 'package.json');
    const packageMetadata = JSON.parse(await readFile(packagePath, 'utf8'));
    packageMetadata.description = 'changed after the selected commit';
    const changed = `${JSON.stringify(packageMetadata, null, 2)}\n`;
    await writeFile(packagePath, changed, 'utf8');

    const result = await loadRelease({
        evidence: {commit, explicitVersion: false, tag: packageVersion},
        platform: 'linux',
        sourceDirectory: checkout,
    });
    assert.equal(result.status, 'blocked');
    assert.deepEqual(Object.keys(result).sort(), ['diagnostics', 'status']);
    assert.match(result.diagnostics[0].message, /selected commit|Git tree|checkout/i);
    assert.equal(await readFile(packagePath, 'utf8'), changed);
});

test('Release Source Adapter closes Git observation failures without returning a partial source', async () => {
    const loader = createReleaseLoader({
        createFilesystem: createScopedFilesystem,
        git: {
            assertFilesMatch: async () => ({status: /** @type {'succeeded'} */ ('succeeded')}),
            readHead: async () => ({message: 'simulated Git failure', status: /** @type {'failed'} */ ('failed')}),
            resolveTagCommit: async () => ({commit: '0'.repeat(40), status: /** @type {'succeeded'} */ ('succeeded')}),
        },
        loadInstallationPayload,
    });
    const result = await loader({
        evidence: {commit: '0'.repeat(40), explicitVersion: false, tag: packageVersion},
        platform: 'linux',
        sourceDirectory,
    });

    assert.deepEqual(result, {
        diagnostics: [{
            code: 'release-source-observation-failed',
            message: 'simulated Git failure',
            severity: 'error',
        }],
        stage: 'git-observation',
        status: 'failed',
    });
});

test('release manifest rejects unknown fields, malformed inventories, and conflicting targets', async t => {
    const {checkout, manifest} = await createMinimalReleaseCheckout(t);
    /** @type {Array<(value: ReleaseManifest) => unknown>} */
    const cases = [
        value => { value.arwVersion = packageVersion; },
        value => { value.launchers.win32 = []; },
        value => { value.runtimeFiles = ['../outside.mjs']; },
        value => { value.runtimeFiles = ['arw.mjs', 'arw.mjs']; },
        value => { value.distributionRoot = '../distribution'; },
        value => { value.runtimeFiles.push('distribution/config.json'); value.runtimeFiles.sort(); },
        value => { value.runtimeFiles.push('CONFIG.JSON'); value.runtimeFiles.sort(); },
        value => { value.runtimeFiles.push('Manifest.json'); value.runtimeFiles.sort(); },
    ];
    for (const mutate of cases) {
        const candidate = structuredClone(manifest);
        mutate(candidate);
        const ordered = Object.fromEntries(Object.entries(candidate).sort(([left], [right]) => left.localeCompare(right)));
        await writeFile(join(checkout, 'release-manifest.json'), `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
        const result = await loadInstallationPayload({
            platform: 'win32',
            sourceDirectory: checkout,
        });
        assert.equal(result.status, 'blocked');
        assert.deepEqual(Object.keys(result).sort(), ['diagnostics', 'status']);
        assert.match(result.diagnostics[0].message, /Release manifest|non-empty path list|normalized Repository-relative path|remain inside the Installation source|sorted and unique|duplicate Installation targets|reserved target|source-only path/);
    }
});
