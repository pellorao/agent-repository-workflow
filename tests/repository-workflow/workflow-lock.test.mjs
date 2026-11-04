import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';

import {serializeCanonicalJson} from '../../lib/common/canonical-contract.mjs';
import {
    createWorkflowLock,
    parseWorkflowLock,
    serializeWorkflowLock,
    verifyManagedContent,
} from '../../lib/repository-workflow/workflow-lock.mjs';

const sha256 = (/** @type {Buffer<ArrayBuffer> | import("crypto").BinaryLike} */ value) => createHash('sha256').update(value).digest('hex');

const profile = {
    codeMaps: {
        excludes: ['vendor/**'],
        includes: ['lib/**'],
        roots: ['lib'],
    },
    domainLayout: 'single-context',
    platforms: ['codex'],
};

const createLock = () => createWorkflowLock({
    managedTargets: [],
    profile,
    repositoryOwnedSeeds: [{
        kind: 'file',
        ownership: 'repository-owned-seed',
        path: '.arwignore',
        strategy: 'regular-file',
    }],
});

test('creates canonical v2 locks without Distribution or projection contract metadata', () => {
    const lock = createLock();
    const serialized = serializeWorkflowLock(lock);

    assert.deepEqual(Object.keys(lock), ['lockSchemaVersion', 'managedTargets', 'profile', 'repositoryOwnedSeeds']);
    assert.ok(serialized.endsWith('\n'));
    assert.deepEqual(parseWorkflowLock(serialized), lock);
    assert.deepEqual(parseWorkflowLock(Buffer.from(serialized, 'utf8')), lock);
    assert.throws(() => parseWorkflowLock(JSON.stringify(lock)), /Workflow lock is not canonical JSON/);
});

test('migrates a canonical v1 lock by preserving only deterministic current state', () => {
    const legacy = {
        distribution: {
            digest: 'a'.repeat(64),
            distributionContractVersion: 1,
            minimumArwVersion: '0.2.0',
            provenance: {
                arwModification: 'agent-repository-workflow',
                commit: 'b'.repeat(40),
                license: 'MIT',
                repository: 'https://example.invalid/arw',
            },
            sourceArwVersion: '0.2.0',
        },
        lockSchemaVersion: 1,
        managedContent: [{
            canonicalObjectId: 'baseline:agents',
            documentOwnership: 'baseline-major',
            hash: 'c'.repeat(64),
            kind: 'region',
            path: 'AGENTS.md',
            projections: [{platform: 'codex', projectionContractVersion: 1}],
            regionId: 'arw:baseline:agents',
        }],
        policies: {arwignore: {path: '.arwignore', schemaVersion: 1}},
        profile,
        projections: [{platform: 'codex', projectionContractVersion: 1}],
    };

    const migrated = parseWorkflowLock(serializeCanonicalJson(legacy));
    assert.deepEqual(migrated, {
        lockSchemaVersion: 2,
        managedTargets: [{
            documentOwnership: 'baseline-major',
            hash: 'c'.repeat(64),
            kind: 'region',
            ownership: 'managed',
            path: 'AGENTS.md',
            platforms: ['codex'],
        }],
        profile,
        repositoryOwnedSeeds: [{
            kind: 'file',
            ownership: 'repository-owned-seed',
            path: '.arwignore',
            strategy: 'regular-file',
        }],
    });
});

test('rejects unknown schemas, unsafe targets, and ambiguous legacy paths', () => {
    assert.throws(() => parseWorkflowLock('{"lockSchemaVersion":0}\n'), /Unsupported old lockSchemaVersion: 0/);
    assert.throws(() => parseWorkflowLock('{"lockSchemaVersion":3}\n'), /Unsupported future lockSchemaVersion: 3/);

    const lock = createLock();
    lock.managedTargets = [{
        hash: 'd'.repeat(64),
        kind: 'file',
        ownership: 'managed',
        path: '../outside.md',
        platforms: ['codex'],
    }];
    assert.throws(() => serializeWorkflowLock(lock), /normalized Repository-relative path/);
});

test('verifies managed files and only the managed span of baseline-major documents', async () => {
    const managedFile = Buffer.from('managed file\n', 'utf8');
    const managedSpan = '<!-- arw:managed:start -->\nmanaged\n<!-- arw:managed:end -->';
    const document = `${managedSpan}\n<!-- arw:repository-owned:start -->\ncustom\n<!-- arw:repository-owned:end -->\n`;
    const repositoryState = {files: {
        'managed.md': {bytes: managedFile, observed: {kind: 'file'}},
        'docs/mixed.md': {bytes: Buffer.from(document), observed: {kind: 'file'}},
    }};

    const lock = createLock();
    lock.managedTargets = [
        {
            hash: sha256(managedFile),
            kind: 'file',
            ownership: 'managed',
            path: 'managed.md',
            platforms: ['codex'],
        },
        {
            documentOwnership: 'baseline-major',
            hash: sha256(managedSpan),
            kind: 'region',
            ownership: 'managed',
            path: 'docs/mixed.md',
            platforms: ['codex'],
        },
    ];

    assert.deepEqual(await verifyManagedContent({lock, repositoryState}), {diagnostics: [], satisfied: true});
    repositoryState.files['docs/mixed.md'].bytes = Buffer.from(document.replace('custom', 'changed by repository'));
    assert.deepEqual(await verifyManagedContent({lock, repositoryState}), {diagnostics: [], satisfied: true});

    repositoryState.files['managed.md'].bytes = Buffer.from('drift\n');
    const drifted = await verifyManagedContent({lock, repositoryState});
    assert.equal(drifted.satisfied, false);
    assert.deepEqual(drifted.diagnostics, [{code: 'managed-content-drift', path: 'managed.md'}]);
});
