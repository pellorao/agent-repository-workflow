import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmod, mkdir, readFile, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {runGit} from '../helpers/git.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {createRepository} from '../helpers/repository-fixture.mjs';
import {
    createSourceCheckoutStateAdapter,
    createUpstreamGitAdapter,
    createUpstreamSyncModule,
} from '../../lib/upstream-sync/upstream-sync.mjs';
import {createNodeGitRunner} from '../../lib/common/git-process.mjs';
import {
    reviewSkillReferences,
    skillReferenceReviewHashes,
} from '../../lib/workflow-distribution/skill-reference-review.mjs';

/** @typedef {Parameters<ReturnType<typeof createSourceCheckoutStateAdapter>['saveWorkspace']>[0]} SyncWorkspace */
/** @typedef {SyncWorkspace['base'][number]} SnapshotEntry */
/** @typedef {NonNullable<Parameters<typeof createUpstreamGitAdapter>[0]>} UpstreamGitAdapterOptions */
/** @typedef {Parameters<NonNullable<UpstreamGitAdapterOptions['gitRunner']>['run']>[0]} GitInvocation */
/** @typedef {Awaited<ReturnType<NonNullable<UpstreamGitAdapterOptions['gitRunner']>['run']>>} GitProcessResult */
/** @typedef {ReturnType<typeof createSourceCheckoutStateAdapter>} SourceStateAdapter */
/** @typedef {ReturnType<typeof createUpstreamGitAdapter>} UpstreamGitAdapter */
/** @typedef {Parameters<UpstreamGitAdapter['acquire']>[0]} AcquisitionRequest */
/** @typedef {NonNullable<Awaited<ReturnType<SourceStateAdapter['loadConfiguration']>>['scope']>} SourceScope */
/** @typedef {Extract<Parameters<SourceStateAdapter['applyPromotion']>[0], {syncRecord: unknown}>} AppliedPromotion */
/** @typedef {{agentMergeNotesDigest?: string, approvalAttestationId?: string, candidateActualSkillDigest?: string, candidateSourceDigest?: string, cleanup?: {attempted: boolean, retryable: boolean, status: string}, completedOperations?: Array<{kind: string, path: string}>, diagnostics: Array<{code?: string, message?: string, path?: string, phase?: number}>, noSelectedSourceChanges?: boolean, pendingPromotion?: {recoveryPlanDigest?: string} | null, permittedOperations: string[], rawOutput?: string | Uint8Array, recoveryPlan?: {recoveryPlanDigest: string}, remainingPaths?: string[], reviewRevisionId?: string, rollback?: Array<{path: string, status: string}>, sourceRelationship?: string, stage?: string, state: string, status: 'blocked' | 'failed' | 'succeeded', syncRecordId?: string}} TestSyncResult */
/** @typedef {{git?: unknown, referenceReview?: unknown, sourceState?: unknown}} TestModuleOptions */

const projectionConfigFixture = {
    platforms: {
        'claude-code': {
            format: {excludedSkillPaths: [], skillReference: '/{name}'},
            supportedVersionRange: '*',
            targets: {skills: '.claude/skills/'},
        },
        codex: {
            format: {excludedSkillPaths: [], skillReference: '${name}'},
            supportedVersionRange: '*',
            targets: {configuration: '.codex/config.toml', skills: '.agents/skills/'},
        },
    },
    skills: {additionalSkillReferences: [], root: 'skills/', skillReferenceNormalizations: []},
    source: 'codex',
};

const createTestUpstreamSyncModule = (/** @type {TestModuleOptions} */ options) => {
    const sourceState = /** @type {Record<string, unknown>} */ (options.sourceState ?? {});
    const module = Reflect.apply(createUpstreamSyncModule, undefined, [{
        ...options,
        referenceReview: options.referenceReview ?? (async (/** @type {{additionalSkillReferences: string[], skillReferenceNormalizations: Array<{column: number, context: string, identity: string, line: number, path: string}>}} */ input) => ({
            additionalSkillReferences: input.additionalSkillReferences,
            additionalSkillReferencesHash: createHash('sha256').update('').digest('hex'),
            diagnostics: [],
            skillReferenceNormalizations: input.skillReferenceNormalizations,
            skillReferenceNormalizationsHash: createHash('sha256').update('').digest('hex'),
            status: 'succeeded',
        })),
        sourceState: {
            loadActualOurs: async () => ({entries: []}),
            loadProjectionConfiguration: async () => projectionConfigFixture,
            reviewWorkspaceDirectory: '/tmp/arw-upstream-test-review',
            ...sourceState,
        },
    }]);
    return {
        /** @returns {Promise<TestSyncResult>} */
        abort: async (/** @type {unknown[]} */ ...args) => Reflect.apply(module.abort, module, args),
        /** @returns {Promise<TestSyncResult>} */
        createReviewRevision: async (/** @type {unknown[]} */ ...args) => Reflect.apply(module.createReviewRevision, module, args),
        /** @returns {Promise<TestSyncResult>} */
        finalize: async (/** @type {unknown[]} */ ...args) => Reflect.apply(module.finalize, module, args),
        /** @returns {Promise<TestSyncResult>} */
        prepare: async (/** @type {unknown[]} */ ...args) => Reflect.apply(module.prepare, module, args),
        /** @returns {Promise<TestSyncResult>} */
        recordApproval: async (/** @type {unknown[]} */ ...args) => Reflect.apply(module.recordApproval, module, args),
        /** @returns {Promise<TestSyncResult>} */
        status: async () => Reflect.apply(module.status, module, []),
    };
};

const fullCommit = '0123456789abcdef0123456789abcdef01234567';
const validSourceConfiguration = () => ({
    url: 'https://example.invalid/upstream.git',
    commit: '1111111111111111111111111111111111111111',
    platform: /** @type {'codex'} */ ('codex'),
    scope: {include: ['**'], exclude: []},
    additionalSkillReferences: [],
    skillReferenceNormalizations: [],
});
const createMappedGitRunner = (/** @type {string} */ cwd, /** @type {Record<string, string>} */ remotePaths) => {
    const runner = createNodeGitRunner(cwd);
    return {
        async run(/** @type {GitInvocation} */ request) {
            return runner.run({
                ...request,
                argv: request.argv.map(argument => remotePaths[argument] ?? argument),
            });
        },
    };
};
/** @returns {unknown} */
const canonicalizeFixture = (/** @type {unknown} */ value) => {
    if (Array.isArray(value)) return value.map(canonicalizeFixture);
    if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
        return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right, 'en'))
            .map(([key, entry]) => [key, canonicalizeFixture(entry)]));
    }
    return value;
};
const projectionConfigurationDigestFixture = (/** @type {unknown} */ value = projectionConfigFixture) => createHash('sha256')
    .update(`${JSON.stringify(canonicalizeFixture(value), null, 2)}\n`)
    .digest('hex');
const sourceConfigurationDigestFixture = (/** @type {unknown} */ value) => createHash('sha256')
    .update(`${JSON.stringify(canonicalizeFixture(value), null, 2)}\n`)
    .digest('hex');
const serializeFixtureEntries = (/** @type {SnapshotEntry[] | undefined} */ entries) => [...(entries ?? [])]
    .sort((left, right) => left.path.localeCompare(right.path, 'en'))
    .map(entry => ({bytes: entry.bytes.toString('base64'), mode: entry.mode, path: entry.path}));
const snapshotDigestFixture = (/** @type {SnapshotEntry[] | undefined} */ entries) => createHash('sha256')
    .update(`${JSON.stringify(canonicalizeFixture(serializeFixtureEntries(entries)), null, 2)}\n`)
    .digest('hex');
const changedPathsFixture = (/** @type {SnapshotEntry[] | undefined} */ left, /** @type {SnapshotEntry[] | undefined} */ right) => {
    const maps = [left ?? [], right ?? []].map(entries => new Map(entries.map(entry => [entry.path, entry])));
    return [...new Set(maps.flatMap(map => [...map.keys()]))].filter(path => {
        const before = maps[0].get(path);
        const after = maps[1].get(path);
        return !before || !after || before.mode !== after.mode || !before.bytes.equals(after.bytes);
    }).sort();
};
const candidateSourceConfigurationFixture = (/** @type {Partial<SyncWorkspace>} */ workspace) => ({
    url: workspace.sourceConfiguration?.url,
    commit: workspace.targetCommit,
    platform: workspace.sourceConfiguration?.platform,
    scope: {
        include: [...(workspace.sourceConfiguration?.scope.include ?? [])],
        exclude: [...(workspace.sourceConfiguration?.scope.exclude ?? [])],
    },
    additionalSkillReferences: workspace.theirsSkillReferenceReview?.additionalSkillReferences ?? [],
    skillReferenceNormalizations: (workspace.theirsSkillReferenceReview?.skillReferenceNormalizations ?? []).map(record => ({
        path: record.path,
        line: record.line,
        column: record.column,
        identity: record.identity,
    })),
});
const candidateSourceDigestFixture = (/** @type {Partial<SyncWorkspace>} */ workspace) => createHash('sha256').update(`${JSON.stringify(canonicalizeFixture({
    base: serializeFixtureEntries(workspace.base),
    candidateSourceConfiguration: candidateSourceConfigurationFixture(workspace),
    configurationDigest: workspace.configurationDigest,
    previousCommit: workspace.previousCommit,
    sourceId: workspace.sourceId,
    sourceRelationship: workspace.sourceRelationship,
    targetCommit: workspace.targetCommit,
    theirs: serializeFixtureEntries(workspace.theirs),
    theirsSkillReferenceReview: workspace.theirsSkillReferenceReview,
}), null, 2)}\n`).digest('hex');
const reviewInputDigestFixture = (/** @type {Partial<SyncWorkspace>} */ workspace) => createHash('sha256').update(`${JSON.stringify(canonicalizeFixture({
    agentMergeNotes: workspace.agentMergeNotes,
    binaryConflicts: workspace.binaryConflicts ?? [],
    dualChangedPaths: workspace.dualChangedPaths ?? [],
    mergeBase: serializeFixtureEntries(workspace.mergeBase),
    mergeTheirs: serializeFixtureEntries(workspace.mergeTheirs),
    ours: serializeFixtureEntries(workspace.ours),
    preflightEvidence: workspace.preflightEvidence,
    projectionConfigurationDigest: workspace.projectionConfigurationDigest,
    requiredLegalPaths: workspace.requiredLegalPaths,
    textConflicts: workspace.textConflicts ?? [],
}), null, 2)}\n`).digest('hex');
const reviewRevisionBindingsFixture = (/** @type {SyncWorkspace} */ workspace) => {
    const agentMergeNotesDigest = createHash('sha256').update(workspace.agentMergeNotes).digest('hex');
    const candidateActualSkillDigest = snapshotDigestFixture(workspace.candidate);
    const candidateSourceDigest = candidateSourceDigestFixture(workspace);
    const reviewInputDigest = reviewInputDigestFixture(workspace);
    return {
        agentMergeNotesDigest,
        candidateActualSkillDigest,
        candidateSourceDigest,
        reviewInputDigest,
        reviewRevisionId: createHash('sha256')
            .update(`${agentMergeNotesDigest}\0${candidateSourceDigest}\0${candidateActualSkillDigest}\0${reviewInputDigest}`)
            .digest('hex'),
    };
};
const completedCanonicalPathsFixture = (/** @type {SyncWorkspace} */ workspace) => {
    const paths = [];
    const beforeByPath = new Map(workspace.ours.map(entry => [entry.path, entry]));
    const afterByPath = new Map(workspace.candidate.map(entry => [entry.path, entry]));
    for (const path of new Set([...beforeByPath.keys(), ...afterByPath.keys()])) {
        const before = beforeByPath.get(path);
        const after = afterByPath.get(path);
        if (!before || !after || before.mode !== after.mode || !before.bytes.equals(after.bytes)) {
            paths.push(path === 'LICENSE'
                ? `docs/licenses/arw/LICENSE.${workspace.sourceId}`
                : `.agents/skills/${path.slice('skills/'.length)}`);
        }
    }
    const preflightByPath = new Map((workspace.preflightEvidence ?? []).map(entry => [entry.path, entry]));
    const addChangedStatePath = (/** @type {string} */ path, /** @type {Buffer} */ bytes) => {
        const preflight = preflightByPath.get(path);
        if (!preflight?.exists
            || preflight.digest !== createHash('sha256').update(bytes).digest('hex')
            || preflight.mode !== '100644') paths.push(path);
    };
    addChangedStatePath(
        `upstream/sources/${workspace.sourceId}/source.json`,
        Buffer.from(`${JSON.stringify(candidateSourceConfigurationFixture(workspace), null, 2)}\n`),
    );
    return [...new Set(paths)].sort();
};
const syncRecordWithoutIdentityFixture = (/** @type {SyncWorkspace} */ workspace) => ({
    approvalAttestationId: workspace.approval?.approvalAttestationId,
    binaryConflicts: workspace.binaryConflicts ?? [],
    candidateActualSkillDigest: workspace.candidateActualSkillDigest,
    candidateSourceDigest: workspace.candidateSourceDigest,
    completedCanonicalPaths: completedCanonicalPathsFixture(workspace),
    conflicts: workspace.textConflicts ?? [],
    dualChangedPaths: workspace.dualChangedPaths ?? [],
    legalResult: 'satisfied',
    localDifferencePaths: changedPathsFixture(workspace.mergeBase, workspace.ours),
    newBaseDigest: snapshotDigestFixture(workspace.theirs),
    newOursDigest: snapshotDigestFixture(workspace.candidate),
    newSourceCommit: workspace.targetCommit,
    oldBaseDigest: snapshotDigestFixture(workspace.base),
    oldOursDigest: snapshotDigestFixture(workspace.ours),
    oldSourceCommit: workspace.previousCommit,
    reviewRevisionId: workspace.reviewRevisionId,
    sourceId: workspace.sourceId,
    sourceRelationship: workspace.sourceRelationship,
    syncRecordVersion: 1,
    toolContract: 'upstream-sync-v1',
});

const promotionPlanFixture = (
    /** @type {{sourceId: string, syncRecord: {syncRecordId: string, [key: string]: unknown}}} */ request,
    /** @type {Array<{index: null, path: string, post: {bytes: string, digest: string, exists: true, mode: string}, pre: {exists: false}}>} */ extraTargets = [],
) => {
    const recordBytes = Buffer.from(`${JSON.stringify(canonicalizeFixture(request.syncRecord), null, 2)}\n`);
    const recordPath = `upstream/sources/${request.sourceId}/sync-records/${request.syncRecord.syncRecordId}.json`;
    const targets = [...extraTargets, {
        index: null,
        path: recordPath,
        post: {
            bytes: recordBytes.toString('base64'),
            digest: createHash('sha256').update(recordBytes).digest('hex'),
            exists: /** @type {true} */ (true),
            mode: '100644',
        },
        pre: {exists: /** @type {false} */ (false)},
    }];
    const finalizedEvidence = targets.map(target => ({
        ...target.post,
        path: target.path,
        ...(target.path === recordPath ? {syncRecordId: request.syncRecord.syncRecordId} : {}),
    }));
    return {
        finalizedEvidence,
        recoveryPlanDigest: createHash('sha256')
            .update(`${JSON.stringify(canonicalizeFixture({targets, version: 1}), null, 2)}\n`)
            .digest('hex'),
        targets,
        version: 1,
    };
};

/** @returns {SyncWorkspace} */
const completeWorkspace = (/** @type {Partial<SyncWorkspace>} */ overrides = {}) => {
    const base = overrides.base ?? [];
    const theirs = overrides.theirs ?? [];
    const sourceConfiguration = overrides.sourceConfiguration ?? {...validSourceConfiguration(), commit: fullCommit};
    return {
        agentMergeNotes: '# Agent merge notes\n\nKept the intended local behavior while applying upstream changes.\n',
        base,
        candidate: [],
        configurationDigest: sourceConfigurationDigestFixture(sourceConfiguration),
        mergeBase: overrides.mergeBase ?? base,
        mergeTheirs: overrides.mergeTheirs ?? theirs,
        ours: [],
        previousCommit: fullCommit,
        projectionConfigurationDigest: projectionConfigurationDigestFixture(),
        sourceId: 'engineering-skills',
        requiredLegalPaths: [],
        sourceConfiguration,
        sourceRelationship: 'descendant',
        state: 'resolving',
        targetCommit: fullCommit,
        theirs,
        theirsSkillReferenceReview: {
            additionalSkillReferences: [],
            additionalSkillReferencesHash: createHash('sha256').update('').digest('hex'),
            skillReferenceNormalizations: [],
            skillReferenceNormalizationsHash: createHash('sha256').update('').digest('hex'),
        },
        ...overrides,
    };
};

/** @returns {SyncWorkspace} */
const requireWorkspace = (/** @type {SyncWorkspace | null} */ workspace) => {
    if (workspace === null) throw new Error('Expected upstream workspace fixture.');
    return workspace;
};

test('Git acquisition adapter reads exact commits and classifies a real history', async t => {
    const root = await createTemporaryDirectory(t, 'arw-upstream-history-');
    const repository = join(root, 'source');
    const temporaryDirectory = join(root, 'temporary');
    await runGit(root, ['init', repository]);
    await runGit(repository, ['config', 'user.email', 'arw@example.invalid']);
    await runGit(repository, ['config', 'user.name', 'ARW Test']);
    await writeFile(join(repository, 'file.txt'), 'base\n');
    await runGit(repository, ['add', 'file.txt']);
    await runGit(repository, ['commit', '-m', 'base']);
    const baseCommit = (await runGit(repository, ['rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(join(repository, 'file.txt'), 'target\n');
    await runGit(repository, ['add', 'file.txt']);
    await runGit(repository, ['update-index', '--chmod=+x', 'file.txt']);
    await runGit(repository, ['commit', '-m', 'target']);
    const targetCommit = (await runGit(repository, ['rev-parse', 'HEAD'])).stdout.trim();
    await mkdir(temporaryDirectory);
    const sourceUrl = 'https://example.invalid/source.git';
    const adapter = createUpstreamGitAdapter({
        gitRunner: createMappedGitRunner(repository, {[sourceUrl]: repository}),
        temporaryDirectory,
    });

    const base = await adapter.acquire({commit: baseCommit, url: sourceUrl});
    const target = await adapter.acquire({commit: targetCommit, url: sourceUrl});
    const relationship = await adapter.classifyRelationship(baseCommit, targetCommit);

    assert.equal(base.status, 'succeeded');
    assert.equal(target.status, 'succeeded');
    if (base.status !== 'succeeded' || target.status !== 'succeeded') assert.fail('Expected acquired source trees.');
    assert.equal(base.entries[0].bytes.toString('utf8'), 'base\n');
    assert.equal(base.entries[0].mode, '100644');
    assert.equal(target.entries[0].bytes.toString('utf8'), 'target\n');
    assert.equal(target.entries[0].mode, '100755');
    assert.equal(relationship, 'descendant');
});

test('Git acquisition adapter uses safe exact-commit argv and rejects transport failures', async t => {
    const root = await createTemporaryDirectory(t, 'arw-upstream-transport-');
    /** @type {GitProcessResult[]} */
    const failures = [
        {code: null, failure: 'timeout', stderr: '', stdout: Buffer.alloc(0)},
        {code: 128, failure: null, stderr: 'authentication failed', stdout: Buffer.alloc(0)},
        {code: 128, failure: null, stderr: 'missing commit', stdout: Buffer.alloc(0)},
    ];
    for (const failure of failures) {
        /** @type {GitInvocation[]} */
        const calls = [];
        const adapter = createUpstreamGitAdapter({
            gitRunner: {
                async run(request) {
                    calls.push(request);
                    if (request.argv[0] === 'init') return {code: 0, failure: null, stderr: '', stdout: Buffer.alloc(0)};
                    return failure;
                },
            },
            temporaryDirectory: root,
        });
        const acquired = await adapter.acquire({
            commit: fullCommit,
            url: 'ssh://example.invalid/source.git',
        });
        assert.deepEqual(acquired, {
            code: 'source-acquisition-failed',
            message: 'The requested exact source tree could not be acquired safely.',
            status: 'failed',
        });
        await adapter.dispose();
        assert.deepEqual(calls[1].argv.slice(-3), [
            '--',
            'ssh://example.invalid/source.git',
            `${fullCommit}:refs/arw/${fullCommit}`,
        ]);
        assert.equal(calls[1].timeoutMs, 60_000);
        assert.equal(calls[1].argv.includes('--filter=blob:none'), false);
    }
});

test('Git acquisition adapter retains its cleanup handle until removal succeeds', async t => {
    const root = await createTemporaryDirectory(t, 'arw-upstream-dispose-retry-');
    /** @type {string[]} */
    const removalPaths = [];
    const gitRunner = {
        async run(/** @type {GitInvocation} */ request) {
            if (request.argv[0] === 'init') return {code: 0, failure: null, stderr: '', stdout: Buffer.alloc(0)};
            return {code: 128, failure: null, stderr: 'missing commit', stdout: Buffer.alloc(0)};
        },
    };
    const removeDirectory = async (/** @type {Parameters<typeof rm>[0]} */ path, /** @type {Parameters<typeof rm>[1]} */ options) => {
        removalPaths.push(String(path));
        if (removalPaths.length === 1) throw new Error('simulated cleanup failure');
        await rm(path, options);
    };
    const adapter = createUpstreamGitAdapter({
        gitRunner,
        removeDirectory,
        temporaryDirectory: root,
    });

    assert.equal((await adapter.acquire({commit: fullCommit, url: 'https://example.invalid/source.git'})).status, 'failed');
    await assert.rejects(adapter.dispose(), /simulated cleanup failure/);
    const nextProcessAdapter = createUpstreamGitAdapter({
        gitRunner,
        removeDirectory,
        temporaryDirectory: root,
    });
    await nextProcessAdapter.dispose();

    assert.equal(removalPaths.length, 2);
    assert.equal(removalPaths[0], removalPaths[1]);
});

test('Git acquisition adapter refuses to clean an acquisition directory without its ownership record', async t => {
    const root = await createTemporaryDirectory(t, 'arw-upstream-dispose-ownership-');
    await mkdir(join(root, 'acquisition'));
    await writeFile(join(root, 'acquisition', 'unowned.txt'), 'do not remove\n');
    const adapter = createUpstreamGitAdapter({
        gitRunner: {
            async run() {
                return {code: 0, failure: null, stderr: '', stdout: Buffer.alloc(0)};
            },
        },
        async removeDirectory(path, options) {
            await rm(path, options);
        },
        temporaryDirectory: root,
    });

    await assert.rejects(adapter.dispose());
    assert.equal((await readFile(join(root, 'acquisition', 'unowned.txt'), 'utf8')), 'do not remove\n');
});

test('Git acquisition adapter rejects a symlinked workspace parent before recursive cleanup', async t => {
    const root = await createTemporaryDirectory(t, 'arw-upstream-dispose-parent-');
    const external = join(root, 'external');
    const scoped = join(root, 'scoped');
    await mkdir(join(external, 'acquisition', 'repository.git'), {recursive: true});
    await writeFile(
        join(external, 'acquisition', 'control.json'),
        '{"kind":"upstream-git-acquisition","version":1}\n',
    );
    await symlink(external, scoped, 'dir');
    let removals = 0;
    const adapter = createUpstreamGitAdapter({
        gitRunner: {
            async run() {
                return {code: 0, failure: null, stderr: '', stdout: Buffer.alloc(0)};
            },
        },
        async removeDirectory(path, options) {
            removals += 1;
            await rm(path, options);
        },
        temporaryDirectory: scoped,
    });

    await assert.rejects(adapter.dispose(), /parent chain/);

    assert.equal(removals, 0);
    assert.equal((await readFile(join(external, 'acquisition', 'control.json'), 'utf8')).length > 0, true);
});

test('Git acquisition adapter rejects unsafe URLs and mutable commit identities at its boundary', async t => {
    const root = await createTemporaryDirectory(t, 'arw-upstream-adapter-input-');
    let calls = 0;
    const adapter = createUpstreamGitAdapter({
        gitRunner: {
            async run() {
                calls += 1;
                return {code: 0, failure: null, stderr: '', stdout: Buffer.alloc(0)};
            },
        },
        temporaryDirectory: root,
    });

    assert.deepEqual(await adapter.acquire({commit: 'main', url: 'https://example.invalid/source.git'}), {
        code: 'invalid-acquisition-request',
        message: 'Git acquisition requires a safe URL and an exact commit identity.',
        status: 'failed',
    });
    assert.equal((await adapter.acquire({commit: fullCommit, url: '../source'})).status, 'failed');
    assert.equal(calls, 0);
});

test('Git acquisition rejects invalid UTF-8 path bytes before blob reads', async t => {
    const root = await createTemporaryDirectory(t, 'arw-upstream-invalid-path-');
    const objectId = 'a'.repeat(40);
    const tree = Buffer.concat([
        Buffer.from(`100644 blob ${objectId}\t`),
        Buffer.from([0xff, 0x00]),
    ]);
    /** @type {string[][]} */
    const calls = [];
    const adapter = createUpstreamGitAdapter({
        gitRunner: {
            async run(request) {
                calls.push(request.argv);
                if (request.argv[0] === 'init') return {code: 0, failure: null, stderr: '', stdout: Buffer.alloc(0)};
                if (request.argv.includes('fetch')) return {code: 0, failure: null, stderr: '', stdout: Buffer.alloc(0)};
                if (request.argv.includes('rev-parse')) return {code: 0, failure: null, stderr: '', stdout: Buffer.from(`${fullCommit}\n`)};
                if (request.argv.includes('ls-tree')) return {code: 0, failure: null, stderr: '', stdout: tree};
                return {code: 1, failure: null, stderr: 'unexpected', stdout: Buffer.alloc(0)};
            },
        },
        temporaryDirectory: root,
    });

    assert.equal((await adapter.acquire({commit: fullCommit, url: 'https://example.invalid/source.git'})).status, 'failed');
    await adapter.dispose();
    assert.equal(calls.some(argv => argv.includes('cat-file')), false);
});

test('Git acquisition reads blobs only for paths selected by Source Scope', async t => {
    const root = await createTemporaryDirectory(t, 'arw-upstream-scoped-blobs-');
    const selectedObjectId = 'a'.repeat(40);
    const excludedObjectId = 'b'.repeat(40);
    const selectedBytes = Buffer.from('selected\n');
    const tree = Buffer.from([
        `100644 blob ${excludedObjectId}\tprivate.bin\0`,
        `100644 blob ${selectedObjectId}\tskills/example/SKILL.md\0`,
    ].join(''));
    const adapter = createUpstreamGitAdapter({
        gitRunner: {
            async run(request) {
                if (request.argv[0] === 'init') return {code: 0, failure: null, stderr: '', stdout: Buffer.alloc(0)};
                if (request.argv.includes('fetch')) return {code: 0, failure: null, stderr: '', stdout: Buffer.alloc(0)};
                if (request.argv.includes('rev-parse')) return {code: 0, failure: null, stderr: '', stdout: Buffer.from(`${fullCommit}\n`)};
                if (request.argv.includes('ls-tree')) return {code: 0, failure: null, stderr: '', stdout: tree};
                if (request.argv.includes('cat-file')) {
                    assert.equal(request.input?.toString(), `${selectedObjectId}\n`);
                    return {
                        code: 0,
                        failure: null,
                        stderr: '',
                        stdout: Buffer.concat([
                            Buffer.from(`${selectedObjectId} blob ${selectedBytes.length}\n`),
                            selectedBytes,
                            Buffer.from('\n'),
                        ]),
                    };
                }
                return {code: 1, failure: null, stderr: 'unexpected', stdout: Buffer.alloc(0)};
            },
        },
        temporaryDirectory: root,
    });

    const acquired = await adapter.acquire({
        commit: fullCommit,
        scope: {include: ['skills/**'], exclude: []},
        url: 'https://example.invalid/source.git',
    });

    assert.equal(acquired.status, 'succeeded');
    if (acquired.status !== 'succeeded') assert.fail('Expected selected acquisition entries.');
    assert.deepEqual(acquired.entries.map(entry => entry.path), ['skills/example/SKILL.md']);
});

test('Git acquisition adapter classifies the complete commit graph relationship matrix', async t => {
    const root = await createTemporaryDirectory(t, 'arw-upstream-graphs-');
    const repository = join(root, 'source');
    const unrelatedRepository = join(root, 'unrelated');
    const temporaryDirectory = join(root, 'temporary');
    await runGit(root, ['init', repository]);
    await runGit(repository, ['config', 'user.email', 'arw@example.invalid']);
    await runGit(repository, ['config', 'user.name', 'ARW Test']);
    await writeFile(join(repository, 'file.txt'), 'base\n');
    await runGit(repository, ['add', 'file.txt']);
    await runGit(repository, ['commit', '-m', 'base']);
    const baseCommit = (await runGit(repository, ['rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(join(repository, 'file.txt'), 'descendant\n');
    await runGit(repository, ['commit', '-am', 'descendant']);
    const descendantCommit = (await runGit(repository, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(repository, ['checkout', '-b', 'side', baseCommit]);
    await writeFile(join(repository, 'side.txt'), 'side\n');
    await runGit(repository, ['add', 'side.txt']);
    await runGit(repository, ['commit', '-m', 'side']);
    const sideCommit = (await runGit(repository, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['init', unrelatedRepository]);
    await runGit(unrelatedRepository, ['config', 'user.email', 'arw@example.invalid']);
    await runGit(unrelatedRepository, ['config', 'user.name', 'ARW Test']);
    await writeFile(join(unrelatedRepository, 'other.txt'), 'other\n');
    await runGit(unrelatedRepository, ['add', 'other.txt']);
    await runGit(unrelatedRepository, ['commit', '-m', 'unrelated']);
    const unrelatedCommit = (await runGit(unrelatedRepository, ['rev-parse', 'HEAD'])).stdout.trim();
    await mkdir(temporaryDirectory);
    const sourceUrl = 'https://example.invalid/source.git';
    const unrelatedUrl = 'https://example.invalid/unrelated.git';
    const classify = async (/** @type {string} */ left, /** @type {string} */ right, /** @type {{ commit: string; url: string; }[]} */ acquisitions) => {
        const adapter = createUpstreamGitAdapter({
            gitRunner: createMappedGitRunner(repository, {
                [sourceUrl]: repository,
                [unrelatedUrl]: unrelatedRepository,
            }),
            temporaryDirectory,
        });
        for (const acquisition of acquisitions) await adapter.acquire(acquisition);
        return adapter.classifyRelationship(left, right);
    };

    assert.equal(await classify(baseCommit, baseCommit, [{commit: baseCommit, url: sourceUrl}]), 'same');
    assert.equal(await classify(descendantCommit, baseCommit, [
        {commit: descendantCommit, url: sourceUrl},
        {commit: baseCommit, url: sourceUrl},
    ]), 'ancestor');
    assert.equal(await classify(descendantCommit, sideCommit, [
        {commit: descendantCommit, url: sourceUrl},
        {commit: sideCommit, url: sourceUrl},
    ]), 'diverged');
    assert.equal(await classify(baseCommit, unrelatedCommit, [
        {commit: baseCommit, url: sourceUrl},
        {commit: unrelatedCommit, url: unrelatedUrl},
    ]), 'unrelated');
});

test('Git relationship classification rejects process and unexpected Git failures', async t => {
    const root = await createTemporaryDirectory(t, 'arw-upstream-relationship-failure-');
    const adapter = createUpstreamGitAdapter({
        gitRunner: {
            async run(request) {
                if (request.argv[0] === 'init') return {code: 0, failure: null, stderr: '', stdout: Buffer.alloc(0)};
                if (request.argv.includes('fetch')) return {code: 0, failure: null, stderr: '', stdout: Buffer.alloc(0)};
                if (request.argv.includes('rev-parse')) return {code: 0, failure: null, stderr: '', stdout: Buffer.from(`${fullCommit}\n`)};
                if (request.argv.includes('ls-tree')) return {code: 0, failure: null, stderr: '', stdout: Buffer.alloc(0)};
                if (request.argv.includes('merge-base')) return {code: null, failure: 'timeout', stderr: '', stdout: Buffer.alloc(0)};
                return {code: 1, failure: null, stderr: 'unexpected', stdout: Buffer.alloc(0)};
            },
        },
        temporaryDirectory: root,
    });
    await adapter.acquire({commit: fullCommit, url: 'https://example.invalid/source.git'});

    await assert.rejects(adapter.classifyRelationship('HEAD', fullCommit), TypeError);
    await assert.rejects(adapter.classifyRelationship(fullCommit, fullCommit.toUpperCase()), TypeError);
    await assert.rejects(adapter.classifyRelationship(fullCommit, '1'.repeat(40)));
});

test('source checkout state adapter persists an editable disposable workspace', async t => {
    const root = await createRepository(t, {prefix: 'arw-upstream-state-'});
    await mkdir(join(root, '.agents', 'skills', 'example'), {recursive: true});
    await mkdir(join(root, 'upstream', 'sources', 'example-source'), {recursive: true});
    await writeFile(join(root, '.agents', 'skills', 'example', 'SKILL.md'), 'ours\n');
    await writeFile(join(root, 'upstream', 'sources', 'example-source', 'source.json'), `${JSON.stringify(validSourceConfiguration(), null, 2)}\n`);
    await runGit(root, ['add', '.agents/skills/example/SKILL.md', 'upstream/sources/example-source']);
    const adapter = createSourceCheckoutStateAdapter({repositoryRoot: root});
    const canonicalPaths = ['skills/example/SKILL.md'];
    const ours = await adapter.loadActualOurs({canonicalPaths, sourceId: 'example-source'});
    const sourceConfiguration = {...validSourceConfiguration(), commit: fullCommit, scope: {include: ['skills/**'], exclude: []}};
    /** @type {SyncWorkspace} */
    const workspace = {
        agentMergeNotes: '# Merge notes\n\nInitial notes.\n',
        base: [{bytes: Buffer.from('base\n'), mode: '100644', path: 'skills/example/SKILL.md'}],
        candidate: ours.entries,
        configurationDigest: sourceConfigurationDigestFixture(sourceConfiguration),
        mergeBase: [{bytes: Buffer.from('base\n'), mode: '100644', path: 'skills/example/SKILL.md'}],
        mergeTheirs: [{bytes: Buffer.from('theirs\n'), mode: '100644', path: 'skills/example/SKILL.md'}],
        ours: ours.entries,
        sourceId: 'example-source',
        previousCommit: fullCommit,
        requiredLegalPaths: [],
        sourceConfiguration,
        sourceRelationship: 'descendant',
        state: 'resolving',
        targetCommit: fullCommit,
        theirs: [{bytes: Buffer.from('theirs\n'), mode: '100644', path: 'skills/example/SKILL.md'}],
    };
    workspace.preflightEvidence = (await adapter.inspectPreparePreflight('example-source', canonicalPaths)).evidence;
    await adapter.saveWorkspace(workspace);
    const candidateSkill = join(root, 'upstream', '.workspaces', 'active', 'candidate', 'skills', 'example', 'SKILL.md');
    await rm(candidateSkill);
    await writeFile(join(root, 'upstream', '.workspaces', 'active', 'candidate', 'skills', 'example', 'ADDED.md'), 'added\n');
    await writeFile(join(root, 'upstream', '.workspaces', 'active', 'agent-merge-notes.md'), '# Merge notes\n\nEdited notes.\n');

    const loaded = requireWorkspace(await adapter.loadWorkspace());

    assert.equal(ours.entries[0].path, 'skills/example/SKILL.md');
    assert.equal(ours.entries[0].mode, '100644');
    assert.deepEqual(loaded.candidate.map(entry => entry.path), ['skills/example/ADDED.md']);
    assert.equal(loaded.candidate[0].bytes.toString('utf8'), 'added\n');
    assert.equal(loaded.agentMergeNotes, '# Merge notes\n\nEdited notes.\n');
    assert.equal(loaded.state, 'resolving');
    const candidateRoot = join(root, 'upstream', '.workspaces', 'active', 'candidate');
    if (process.platform !== 'win32') {
        await writeFile(join(candidateRoot, 'COLLISION.md'), 'upper\n');
        await writeFile(join(candidateRoot, 'collision.md'), 'lower\n');
        assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
        await rm(join(candidateRoot, 'COLLISION.md'));
        await rm(join(candidateRoot, 'collision.md'));
    }
    const baseSkill = join(root, 'upstream', '.workspaces', 'active', 'base', 'skills', 'example', 'SKILL.md');
    await writeFile(baseSkill, 'tampered base\n');
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    await writeFile(baseSkill, 'base\n');
    if (process.platform !== 'win32') {
        await chmod(baseSkill, 0o755);
        assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
        await chmod(baseSkill, 0o644);
    }
    const controlPath = join(root, 'upstream', '.workspaces', 'active', 'control.json');
    const validControl = JSON.parse(await readFile(controlPath, 'utf8'));
    await writeFile(controlPath, `${JSON.stringify({...validControl, state: 'unknown-state'})}\n`);
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    await writeFile(controlPath, `${JSON.stringify({...validControl, base: [{...validControl.base[0], path: '../outside'}]})}\n`);
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    await writeFile(controlPath, `${JSON.stringify({...validControl, preflightEvidence: []})}\n`);
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    await writeFile(controlPath, `${JSON.stringify({
        ...validControl,
        sourceConfiguration: {...validControl.sourceConfiguration, unexpected: true},
    })}\n`);
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    await writeFile(controlPath, `${JSON.stringify({
        ...validControl,
        sourceConfiguration: {...validControl.sourceConfiguration, commit: '2'.repeat(40)},
    })}\n`);
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    await writeFile(controlPath, `${JSON.stringify({...validControl, targetCommit: 'not-a-commit'})}\n`);
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    await writeFile(controlPath, `${JSON.stringify({
        ...validControl,
        preflightEvidence: validControl.preflightEvidence.map((/** @type {{path: string}} */ entry) => entry.path.startsWith('.agents/skills/')
            ? {...entry, path: '.agents/skills/Bad/SKILL.md'}
            : entry),
    })}\n`);
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    await writeFile(controlPath, `${JSON.stringify({
        ...validControl,
        theirsSkillReferenceReview: {
            additionalSkillReferences: [],
            additionalSkillReferencesHash: 'a'.repeat(64),
            skillReferenceNormalizations: [{column: 'invalid'}],
            skillReferenceNormalizationsHash: 'b'.repeat(64),
        },
    })}\n`);
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    const tamperedAdditionalReview = {
        additionalSkillReferences: ['example'],
        ...skillReferenceReviewHashes({additionalSkillReferences: [], skillReferenceNormalizations: []}),
        skillReferenceNormalizations: [],
    };
    await writeFile(controlPath, `${JSON.stringify({
        ...validControl,
        theirsSkillReferenceReview: tamperedAdditionalReview,
    })}\n`);
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    const tamperedNormalizationReview = {
        additionalSkillReferences: [],
        ...skillReferenceReviewHashes({additionalSkillReferences: [], skillReferenceNormalizations: []}),
        skillReferenceNormalizations: [{
            column: 1,
            context: '$example',
            identity: 'example',
            line: 1,
            path: 'skills/example/SKILL.md',
        }],
    };
    await writeFile(controlPath, `${JSON.stringify({
        ...validControl,
        theirsSkillReferenceReview: tamperedNormalizationReview,
    })}\n`);
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    const invalidPathReviewInput = {
        additionalSkillReferences: [],
        skillReferenceNormalizations: [{
            column: 1,
            context: '$example',
            identity: 'example',
            line: 1,
            path: 'docs/example.md',
        }],
    };
    await writeFile(controlPath, `${JSON.stringify({
        ...validControl,
        theirsSkillReferenceReview: {
            ...invalidPathReviewInput,
            additionalSkillReferencesHash: createHash('sha256').update('').digest('hex'),
            skillReferenceNormalizationsHash: createHash('sha256').update([
                '{"path":"docs/example.md","line":1,"column":1,"identity":"example","context":"$example"}',
                '',
            ].join('\n')).digest('hex'),
        },
    })}\n`);
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    const mismatchedAttestation = {
        candidateActualSkillDigest: '1'.repeat(64),
        candidateSourceDigest: '2'.repeat(64),
        channel: 'external-review',
        externalEvidence: 'https://review.example.invalid/stale-control',
        agentMergeNotesDigest: '3'.repeat(64),
        reviewRevisionId: '4'.repeat(64),
        status: 'approved',
    };
    await writeFile(controlPath, `${JSON.stringify({
        ...validControl,
        approval: {
            ...mismatchedAttestation,
            approvalAttestationId: createHash('sha256')
                .update(`${JSON.stringify(canonicalizeFixture(mismatchedAttestation), null, 2)}\n`)
                .digest('hex'),
        },
        candidateActualSkillDigest: '5'.repeat(64),
        candidateSourceDigest: '6'.repeat(64),
        agentMergeNotesDigest: '7'.repeat(64),
        reviewRevisionId: '8'.repeat(64),
        state: 'approved',
    })}\n`);
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    await writeFile(controlPath, `${JSON.stringify({
        ...validControl,
        approval: {approvalAttestationId: 'a'.repeat(64)},
        state: 'approved',
    })}\n`);
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    await writeFile(controlPath, `${JSON.stringify({
        ...validControl,
        pendingPromotion: {finalizedEvidence: [], recoveryPlanDigest: 'a'.repeat(64), targets: [{path: '../outside'}], version: 1},
        state: 'recovering',
    })}\n`);
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    await writeFile(controlPath, `${JSON.stringify({
        ...validControl,
        finalizedEvidence: [],
        state: 'awaiting-commit',
        syncRecordId: 'a'.repeat(64),
    })}\n`);
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    await writeFile(controlPath, `${JSON.stringify({
        ...validControl,
        finalizedEvidence: [{
            bytes: Buffer.from('finalized\n').toString('base64'),
            digest: createHash('sha256').update('finalized\n').digest('hex'),
            exists: true,
            mode: '100644',
            path: '.agents/skills/example/SKILL.md',
        }],
        state: 'awaiting-commit',
    })}\n`);
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    const syncRecordId = 'a'.repeat(64);
    const syncRecordPath = `upstream/sources/example-source/sync-records/${syncRecordId}.json`;
    const finalizedState = {
        bytes: Buffer.from('finalized\n').toString('base64'),
        digest: createHash('sha256').update('finalized\n').digest('hex'),
        exists: true,
        mode: '100644',
    };
    await writeFile(controlPath, `${JSON.stringify({
        ...validControl,
        finalizedEvidence: [
            {...finalizedState, path: 'distribution/manifest.json'},
            {...finalizedState, path: syncRecordPath, syncRecordId},
        ],
        state: 'awaiting-commit',
        syncRecordId,
    })}\n`);
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    await writeFile(controlPath, `${JSON.stringify(validControl)}\n`);
    const partialAbort = await adapter.abortWorkspace(loaded);
    assert.ok(partialAbort.remainingPaths.includes('candidate/skills/example/ADDED.md'));
    await rm(join(root, 'upstream', '.workspaces', 'active', 'candidate', 'skills', 'example', 'ADDED.md'));
    const completedAbort = await adapter.abortWorkspace(loaded);
    assert.deepEqual(completedAbort.remainingPaths, []);
});

test('abort removes empty canonical snapshot roots', async t => {
    const root = await createRepository(t, {prefix: 'arw-upstream-empty-abort-'});
    await mkdir(join(root, 'upstream', 'sources', 'example-source'), {recursive: true});
    await writeFile(join(root, 'upstream', 'sources', 'example-source', 'source.json'), `${JSON.stringify(validSourceConfiguration(), null, 2)}\n`);
    await runGit(root, ['add', 'upstream/sources/example-source']);
    const adapter = createSourceCheckoutStateAdapter({repositoryRoot: root});
    const workspace = completeWorkspace({
        base: [],
        candidate: [],
        mergeBase: [],
        mergeTheirs: [],
        ours: [],
        sourceId: 'example-source',
        theirs: [],
    });
    workspace.preflightEvidence = (await adapter.inspectPreparePreflight('example-source', [])).evidence;
    await adapter.saveWorkspace(workspace);
    const savedWorkspace = requireWorkspace(await adapter.loadWorkspace());

    const cleanup = await adapter.abortWorkspace(savedWorkspace);

    assert.deepEqual(cleanup.remainingPaths, []);
});

test('abort does not follow symlinked owned path parents outside the workspace', async t => {
    const root = await createTemporaryDirectory(t, 'arw-upstream-abort-symlink-');
    const active = join(root, 'upstream', '.workspaces', 'active');
    const outside = join(root, 'outside');
    await mkdir(join(active, 'candidate'), {recursive: true});
    await mkdir(join(outside, 'example'), {recursive: true});
    const outsideFile = join(outside, 'example', 'SKILL.md');
    await writeFile(outsideFile, 'preserve\n');
    await symlink(outside, join(active, 'candidate', 'skills'), process.platform === 'win32' ? 'junction' : 'dir');
    const adapter = createSourceCheckoutStateAdapter({repositoryRoot: root});
    const workspace = completeWorkspace({
        ownedWorkspacePaths: ['candidate/skills/example/SKILL.md'],
    });

    const cleanup = await adapter.abortWorkspace(workspace);

    assert.equal(await readFile(outsideFile, 'utf8'), 'preserve\n');
    assert.ok(cleanup.remainingPaths.length > 0);
});

test('source checkout state adapter fails closed when actual Ours index evidence is unavailable', async t => {
    const root = await createTemporaryDirectory(t, 'arw-upstream-index-failure-');
    const skillDirectory = join(root, '.agents', 'skills', 'example');
    await mkdir(skillDirectory, {recursive: true});
    await writeFile(join(skillDirectory, 'SKILL.md'), 'ours\n');
    const adapter = createSourceCheckoutStateAdapter({
        gitRunner: {
            async run() {
                return {code: null, failure: 'process', stderr: '', stdout: Buffer.alloc(0)};
            },
        },
        repositoryRoot: root,
    });

    await assert.rejects(
        () => adapter.loadActualOurs({
            canonicalPaths: ['skills/example/SKILL.md'],
            sourceId: 'example-source',
        }),
        /Git index/,
    );
    await assert.rejects(
        () => adapter.loadActualOurs({
            canonicalPaths: ['../outside'],
            sourceId: 'example-source',
        }),
        /invalid/,
    );
});

test('source checkout state adapter rejects symlinked actual Ours parents', async t => {
    const root = await createTemporaryDirectory(t, 'arw-upstream-linked-ours-');
    const redirectedAgents = join(root, 'redirected-agents');
    await mkdir(join(redirectedAgents, 'skills', 'example'), {recursive: true});
    await writeFile(join(redirectedAgents, 'skills', 'example', 'SKILL.md'), 'outside\n');
    await symlink(redirectedAgents, join(root, '.agents'), process.platform === 'win32' ? 'junction' : 'dir');
    const adapter = createSourceCheckoutStateAdapter({repositoryRoot: root});

    await assert.rejects(() => adapter.loadActualOurs({
        canonicalPaths: ['skills/example/SKILL.md'],
        sourceId: 'example-source',
    }), /unsafe directory component/);
});

test('source checkout state adapter rejects symlinked configuration parents', async t => {
    const sourceRoot = await createTemporaryDirectory(t, 'arw-upstream-linked-source-config-');
    const redirectedUpstream = join(sourceRoot, 'redirected-upstream');
    await mkdir(join(redirectedUpstream, 'sources', 'example-source'), {recursive: true});
    await writeFile(join(redirectedUpstream, 'sources', 'example-source', 'source.json'), '{}\n');
    await symlink(redirectedUpstream, join(sourceRoot, 'upstream'), process.platform === 'win32' ? 'junction' : 'dir');
    const sourceAdapter = createSourceCheckoutStateAdapter({repositoryRoot: sourceRoot});

    await assert.rejects(() => sourceAdapter.loadConfiguration('example-source'), /unsafe directory component/);

    const projectionRoot = await createTemporaryDirectory(t, 'arw-upstream-linked-projection-config-');
    const redirectedDistribution = join(projectionRoot, 'redirected-distribution');
    await mkdir(join(redirectedDistribution, 'projections'), {recursive: true});
    await writeFile(join(redirectedDistribution, 'projections', 'config.json'), '{}\n');
    await symlink(redirectedDistribution, join(projectionRoot, 'distribution'), process.platform === 'win32' ? 'junction' : 'dir');
    const projectionAdapter = createSourceCheckoutStateAdapter({repositoryRoot: projectionRoot});

    await assert.rejects(() => projectionAdapter.loadProjectionConfiguration(), /unsafe directory component/);
});

test('source checkout state adapter rejects symlinked immutable snapshot parents', async t => {
    const root = await createRepository(t, {prefix: 'arw-upstream-linked-snapshot-'});
    await mkdir(join(root, 'upstream', 'sources', 'example-source'), {recursive: true});
    await writeFile(join(root, 'upstream', 'sources', 'example-source', 'source.json'), `${JSON.stringify(validSourceConfiguration(), null, 2)}\n`);
    await runGit(root, ['add', 'upstream/sources/example-source']);
    const adapter = createSourceCheckoutStateAdapter({repositoryRoot: root});
    const path = 'skills/example/SKILL.md';
    const workspace = completeWorkspace({
        base: [{bytes: Buffer.from('base\n'), mode: '100644', path}],
        sourceId: 'example-source',
    });
    workspace.preflightEvidence = (await adapter.inspectPreparePreflight('example-source', [path])).evidence;
    await adapter.saveWorkspace(workspace);
    const outside = join(root, 'outside-snapshot');
    await mkdir(join(outside, 'example'), {recursive: true});
    await writeFile(join(outside, 'example', 'SKILL.md'), 'base\n');
    const skills = join(root, 'upstream', '.workspaces', 'active', 'base', 'skills');
    await rm(skills, {recursive: true});
    await symlink(outside, skills, process.platform === 'win32' ? 'junction' : 'dir');

    const loaded = requireWorkspace(await adapter.loadWorkspace());

    assert.equal(loaded.recoveryKind, 'manual-workspace');
});

test('control-less active workspace requires manual recovery', async t => {
    const root = await createTemporaryDirectory(t, 'arw-upstream-orphan-');
    const active = join(root, 'upstream', '.workspaces', 'active');
    await mkdir(active, {recursive: true});
    await writeFile(join(active, 'orphan.txt'), 'preserve me\n');
    const sourceState = createSourceCheckoutStateAdapter({repositoryRoot: root});
    const module = createTestUpstreamSyncModule({git: {}, sourceState});

    const status = await module.status();
    const prepared = await module.prepare('engineering-skills', fullCommit);
    const aborted = await module.abort();

    for (const operation of [status, prepared, aborted]) {
        assert.equal(operation.state, 'recovering');
        assert.deepEqual(operation.permittedOperations, ['status']);
    }
    assert.deepEqual(status.remainingPaths, ['orphan.txt']);
    assert.equal(await readFile(join(active, 'orphan.txt'), 'utf8'), 'preserve me\n');
});

test('source checkout state adapter rejects a linked active workspace root', async t => {
    const root = await createTemporaryDirectory(t, 'arw-upstream-linked-workspace-');
    const redirected = join(root, 'redirected');
    const workspaceParent = join(root, 'upstream', '.workspaces');
    await mkdir(redirected, {recursive: true});
    await mkdir(workspaceParent, {recursive: true});
    await symlink(redirected, join(workspaceParent, 'active'), process.platform === 'win32' ? 'junction' : 'dir');
    const adapter = createSourceCheckoutStateAdapter({repositoryRoot: root});

    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    await assert.rejects(() => Reflect.apply(adapter.saveWorkspace, adapter, [{state: 'resolving'}]), /unsafe directory component/);
    await assert.rejects(() => readFile(join(redirected, 'control.json')), /ENOENT/);
});

test('source checkout state adapter reads actual Skills and the fixed license target', async t => {
    const root = await createRepository(t, {prefix: 'arw-upstream-actual-ours-'});
    const skillDirectory = join(root, '.agents', 'skills', 'example');
    const oursOnlySkillDirectory = join(root, '.agents', 'skills', 'ours-only');
    const licenseDirectory = join(root, 'docs', 'licenses', 'arw');
    const sourceDirectory = join(root, 'upstream', 'sources', 'example-source');
    await mkdir(skillDirectory, {recursive: true});
    await mkdir(oursOnlySkillDirectory, {recursive: true});
    await mkdir(licenseDirectory, {recursive: true});
    await mkdir(sourceDirectory, {recursive: true});
    await writeFile(join(skillDirectory, 'SKILL.md'), 'actual Skill\n');
    await writeFile(join(skillDirectory, 'asset.bin'), Buffer.from([0xff, 0x01]));
    await writeFile(join(oursOnlySkillDirectory, 'SKILL.md'), 'ours-only Skill\n');
    await writeFile(join(licenseDirectory, 'LICENSE.example-source'), 'actual license\n');
    await writeFile(join(sourceDirectory, 'source.json'), `${JSON.stringify(validSourceConfiguration(), null, 2)}\n`);
    await runGit(root, ['add', '.agents/skills/example', '.agents/skills/ours-only', 'docs/licenses/arw/LICENSE.example-source', 'upstream/sources/example-source']);

    const adapter = createSourceCheckoutStateAdapter({repositoryRoot: root});
    const ours = await adapter.loadActualOurs({
        canonicalPaths: ['LICENSE', 'skills/example/SKILL.md'],
        sourceId: 'example-source',
    });

    assert.deepEqual(ours.entries.map(entry => entry.path), [
        'LICENSE',
        'skills/example/SKILL.md',
        'skills/example/asset.bin',
        'skills/ours-only/SKILL.md',
    ]);
    assert.equal(ours.entries[0].bytes.toString('utf8'), 'actual license\n');
    assert.deepEqual([...ours.entries[2].bytes], [0xff, 0x01]);
    assert.equal(ours.entries[3].bytes.toString('utf8'), 'ours-only Skill\n');

    if (process.platform !== 'win32') {
        const upper = join(skillDirectory, 'README.md');
        const lower = join(skillDirectory, 'readme.md');
        await writeFile(upper, 'upper\n');
        await writeFile(lower, 'lower\n');
        await runGit(root, ['add', '.agents/skills/example/README.md', '.agents/skills/example/readme.md']);
        await assert.rejects(
            () => adapter.loadActualOurs({
                canonicalPaths: ['skills/example/SKILL.md'],
                sourceId: 'example-source',
            }),
            /portable path collision/,
        );
        await rm(upper);
        await rm(lower);
        await runGit(root, ['add', '-u', '--', '.agents/skills/example']);

        const reserved = join(skillDirectory, 'CON.md');
        await writeFile(reserved, 'reserved\n');
        await runGit(root, ['add', '.agents/skills/example/CON.md']);
        await assert.rejects(
            () => adapter.loadActualOurs({
                canonicalPaths: ['skills/example/SKILL.md'],
                sourceId: 'example-source',
            }),
            /content paths must be portable/,
        );
        await rm(reserved);
        await runGit(root, ['add', '-u', '--', '.agents/skills/example']);
    }
    await writeFile(join(skillDirectory, 'untracked.txt'), 'untracked\n');
    await assert.rejects(
        () => adapter.loadActualOurs({
            canonicalPaths: ['skills/example/SKILL.md'],
            sourceId: 'example-source',
        }),
        /portable stage-zero blob/,
    );
});

test('source checkout state recovery skips targets already at the selected image', async t => {
    const root = await createRepository(t, {prefix: 'arw-upstream-selective-recovery-'});
    const sourceId = 'example-source';
    const sourceDirectory = join(root, 'upstream', 'sources', sourceId);
    const skillPath = join(root, '.agents', 'skills', 'example', 'SKILL.md');
    const sourcePath = join(sourceDirectory, 'source.json');
    const oldCommit = '1'.repeat(40);
    const targetCommit = '2'.repeat(40);
    const sourceConfiguration = {...validSourceConfiguration(), commit: oldCommit};
    await mkdir(join(root, '.agents', 'skills', 'example'), {recursive: true});
    await mkdir(sourceDirectory, {recursive: true});
    await writeFile(skillPath, 'old Skill\n');
    await writeFile(sourcePath, `${JSON.stringify(sourceConfiguration, null, 2)}\n`);
    await runGit(root, ['add', '.agents/skills/example/SKILL.md', 'upstream/sources/example-source/source.json']);

    const adapter = createSourceCheckoutStateAdapter({repositoryRoot: root});
    const canonicalPaths = ['skills/example/SKILL.md'];
    const preflight = await adapter.inspectPreparePreflight(sourceId, canonicalPaths);
    assert.equal(preflight.matches, true);
    const ours = await adapter.loadActualOurs({canonicalPaths, sourceId});
    const candidate = ours.entries.map(entry => ({...entry, bytes: Buffer.from('new Skill\n')}));
    const workspace = completeWorkspace({
        base: ours.entries,
        candidate,
        ours: ours.entries,
        preflightEvidence: preflight.evidence,
        previousCommit: oldCommit,
        sourceConfiguration,
        sourceId,
        targetCommit,
        theirs: candidate,
    });
    const promotionWorkspace = {
        ...workspace,
        agentMergeNotesDigest: '6'.repeat(64),
        candidateActualSkillDigest: snapshotDigestFixture(candidate),
        reviewRevisionId: '7'.repeat(64),
        state: /** @type {'approved'} */ ('approved'),
    };
    promotionWorkspace.candidateSourceDigest = candidateSourceDigestFixture(promotionWorkspace);
    const recordWithoutIdentity = syncRecordWithoutIdentityFixture(promotionWorkspace);
    const syncRecordId = createHash('sha256')
        .update(`${JSON.stringify(canonicalizeFixture(recordWithoutIdentity), null, 2)}\n`)
        .digest('hex');
    const syncRecord = {...recordWithoutIdentity, syncRecordId};
    const pendingPromotion = await adapter.createPromotionPlan({
        candidate,
        sourceId,
        syncRecord,
        workspace: promotionWorkspace,
    });
    const skillTarget = pendingPromotion.targets.find(target => target.path === '.agents/skills/example/SKILL.md');
    if (!skillTarget?.post.bytes) assert.fail('Expected Skill post-image.');
    await writeFile(skillPath, Buffer.from(skillTarget.post.bytes, 'base64'));
    const sourceIdentityBefore = (await stat(sourcePath)).ino;
    const recoveringWorkspace = {
        ...promotionWorkspace,
        pendingPromotion,
        state: /** @type {'recovering'} */ ('recovering'),
        syncRecordId,
    };
    const inspection = await adapter.inspectRecovery(recoveringWorkspace);
    assert.equal(inspection.matches, true);
    if (!('recoveryPlan' in inspection) || !inspection.recoveryPlan) assert.fail('Expected recovery plan.');

    await adapter.applyRecovery(recoveringWorkspace, 'abort', inspection.recoveryPlan);

    assert.equal(await readFile(skillPath, 'utf8'), 'old Skill\n');
    assert.equal((await stat(sourcePath)).ino, sourceIdentityBefore);

    await writeFile(skillPath, Buffer.from(skillTarget.post.bytes, 'base64'));
    const skillIdentityBefore = (await stat(skillPath)).ino;
    const finalizeInspection = await adapter.inspectRecovery(recoveringWorkspace);
    assert.equal(finalizeInspection.matches, true);
    if (!('recoveryPlan' in finalizeInspection) || !finalizeInspection.recoveryPlan) {
        assert.fail('Expected finalize recovery plan.');
    }

    await adapter.applyRecovery(recoveringWorkspace, 'finalize', finalizeInspection.recoveryPlan);

    assert.equal(await readFile(skillPath, 'utf8'), 'new Skill\n');
    assert.equal((await stat(skillPath)).ino, skillIdentityBefore);
});

test('source checkout state adapter promotes actual targets and verifies the HEAD tree', async t => {
    const root = await createRepository(t, {prefix: 'arw-upstream-promotion-'});
    const sourceId = 'example-source';
    const sourceDirectory = join(root, 'upstream', 'sources', sourceId);
    const skillDirectory = join(root, '.agents', 'skills', 'example');
    const licenseDirectory = join(root, 'docs', 'licenses', 'arw');
    const oldCommit = '1'.repeat(40);
    const targetCommit = '2'.repeat(40);
    await mkdir(sourceDirectory, {recursive: true});
    await mkdir(skillDirectory, {recursive: true});
    await mkdir(licenseDirectory, {recursive: true});
    await writeFile(join(skillDirectory, 'SKILL.md'), 'old Skill\n');
    await writeFile(join(licenseDirectory, `LICENSE.${sourceId}`), 'old license\n');
    await writeFile(join(sourceDirectory, 'source.json'), `${JSON.stringify({
        ...validSourceConfiguration(),
        commit: oldCommit,
    }, null, 2)}\n`);
    await runGit(root, ['add', '.agents/skills/example', 'docs/licenses/arw', 'upstream/sources/example-source']);
    await runGit(root, [
        '-c', 'user.email=arw@example.invalid',
        '-c', 'user.name=ARW Test',
        'commit', '-m', 'base',
    ]);

    const adapter = createSourceCheckoutStateAdapter({repositoryRoot: root});
    const canonicalPaths = ['LICENSE', 'skills/example/SKILL.md'];
    const preflight = await adapter.inspectPreparePreflight(sourceId, canonicalPaths);
    assert.equal(preflight.matches, true);
    const ours = await adapter.loadActualOurs({canonicalPaths, sourceId: sourceId});
    const candidate = ours.entries.map(entry => ({
        ...entry,
        bytes: Buffer.from(entry.path === 'LICENSE' ? 'new license\n' : 'new Skill\n'),
    }));
    const workspace = completeWorkspace({
        base: ours.entries,
        candidate,
        ours: ours.entries,
        preflightEvidence: preflight.evidence,
        previousCommit: oldCommit,
        sourceId: sourceId,
        sourceConfiguration: {...validSourceConfiguration(), commit: oldCommit},
        targetCommit,
        theirs: candidate,
    });
    await adapter.saveWorkspace(workspace);
    const loaded = requireWorkspace(await adapter.loadWorkspace());
    assert.deepEqual(await adapter.preflightPromotion(loaded), {matches: true});

    await writeFile(join(skillDirectory, 'SKILL.md'), 'drift\n');
    assert.deepEqual(await adapter.preflightPromotion(loaded), {matches: false});
    await writeFile(join(skillDirectory, 'SKILL.md'), 'old Skill\n');

    const promotionWorkspace = {
        ...loaded,
        candidateActualSkillDigest: snapshotDigestFixture(candidate),
        agentMergeNotesDigest: '6'.repeat(64),
        reviewRevisionId: '7'.repeat(64),
        state: /** @type {'approved'} */ ('approved'),
    };
    const promotedNormalizations = [{
        path: 'skills/example/SKILL.md',
        line: 1,
        column: 1,
        identity: 'example',
        context: '$example',
    }];
    promotionWorkspace.theirsSkillReferenceReview = {
        additionalSkillReferences: [],
        ...skillReferenceReviewHashes({
            additionalSkillReferences: [],
            skillReferenceNormalizations: promotedNormalizations,
        }),
        skillReferenceNormalizations: promotedNormalizations,
    };
    promotionWorkspace.candidateSourceDigest = candidateSourceDigestFixture(promotionWorkspace);
    const approval = {
        candidateActualSkillDigest: promotionWorkspace.candidateActualSkillDigest,
        candidateSourceDigest: promotionWorkspace.candidateSourceDigest,
        channel: 'external-review',
        externalEvidence: 'https://review.example.invalid/promotion',
        agentMergeNotesDigest: promotionWorkspace.agentMergeNotesDigest,
        reviewRevisionId: promotionWorkspace.reviewRevisionId,
        status: 'approved',
    };
    promotionWorkspace.approval = {
        ...approval,
        approvalAttestationId: createHash('sha256')
            .update(`${JSON.stringify(canonicalizeFixture(approval), null, 2)}\n`)
            .digest('hex'),
    };
    const controlPath = join(root, 'upstream', '.workspaces', 'active', 'control.json');
    const writeControl = (/** @type {unknown} */ control) => writeFile(
        controlPath,
        `${JSON.stringify(canonicalizeFixture(control), null, 2)}\n`,
    );
    await adapter.saveWorkspace(promotionWorkspace);
    const approvedControl = JSON.parse(await readFile(controlPath, 'utf8'));
    const recordWithoutIdentity = syncRecordWithoutIdentityFixture(promotionWorkspace);
    const syncRecordId = createHash('sha256')
        .update(`${JSON.stringify(canonicalizeFixture(recordWithoutIdentity), null, 2)}\n`)
        .digest('hex');
    const syncRecord = {...recordWithoutIdentity, syncRecordId};
    const promotionRequest = {
        candidate,
        sourceId: sourceId,
        syncRecord,
        workspace: promotionWorkspace,
    };
    const redirectedRecords = join(root, 'redirected-records');
    const recordsLink = join(sourceDirectory, 'sync-records');
    await mkdir(redirectedRecords);
    await symlink(redirectedRecords, recordsLink, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(() => adapter.createPromotionPlan(promotionRequest), /unsafe parent component/);
    await rm(recordsLink);

    const pendingPromotion = await adapter.createPromotionPlan(promotionRequest);
    const interruptedWorkspace = {...promotionWorkspace, pendingPromotion, state: /** @type {'recovering'} */ ('recovering'), syncRecordId};
    await adapter.saveWorkspace(interruptedWorkspace);
    const recoveringControl = JSON.parse(await readFile(controlPath, 'utf8'));
    const recordPath = `upstream/sources/${sourceId}/sync-records/${syncRecord.syncRecordId}.json`;
    assert.deepEqual(syncRecord.completedCanonicalPaths, pendingPromotion.targets
        .map(target => target.path)
        .filter(path => path !== recordPath));
    const sourceTarget = pendingPromotion.targets.find(target => target.path === `upstream/sources/${sourceId}/source.json`);
    if (!sourceTarget?.post.bytes) assert.fail('Expected promoted Source Configuration bytes.');
    const promotedSource = JSON.parse(Buffer.from(sourceTarget.post.bytes, 'base64').toString('utf8'));
    assert.deepEqual(Object.keys(promotedSource), [
        'url',
        'commit',
        'platform',
        'scope',
        'additionalSkillReferences',
        'skillReferenceNormalizations',
    ]);
    assert.deepEqual(Object.keys(promotedSource.scope), ['include', 'exclude']);
    assert.deepEqual(Object.keys(promotedSource.skillReferenceNormalizations[0]), ['path', 'line', 'column', 'identity']);
    await assert.rejects(
        () => adapter.applyPromotion({...promotionRequest, ...pendingPromotion, sourceId: 'other-source'}),
        /workspace binding/,
    );
    const tamperedRecordBytes = Buffer.from(`${JSON.stringify(canonicalizeFixture({
        completedCanonicalPaths: [],
        newSourceCommit: targetCommit,
        sourceId,
        syncRecordId: syncRecord.syncRecordId,
    }), null, 2)}\n`);
    const tamperedRecordPost = {
        bytes: tamperedRecordBytes.toString('base64'),
        digest: createHash('sha256').update(tamperedRecordBytes).digest('hex'),
        exists: true,
        mode: '100644',
    };
    const tamperedTargets = pendingPromotion.targets.map(target => target.path === recordPath
        ? {...target, post: tamperedRecordPost}
        : target);
    const tamperedPromotion = {
        ...pendingPromotion,
        finalizedEvidence: pendingPromotion.finalizedEvidence.map(entry => entry.path === recordPath
            ? {...tamperedRecordPost, path: recordPath, syncRecordId: syncRecord.syncRecordId}
            : entry),
        recoveryPlanDigest: createHash('sha256').update(`${JSON.stringify(canonicalizeFixture({
            targets: tamperedTargets,
            version: 1,
        }), null, 2)}\n`).digest('hex'),
        targets: tamperedTargets,
    };
    await writeControl({...recoveringControl, pendingPromotion: tamperedPromotion});
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    const omittedPath = '.agents/skills/example/SKILL.md';
    const omittedTargets = pendingPromotion.targets.filter(target => target.path !== omittedPath);
    const omittedPromotion = {
        ...pendingPromotion,
        finalizedEvidence: pendingPromotion.finalizedEvidence.filter(entry => entry.path !== omittedPath),
        recoveryPlanDigest: createHash('sha256').update(`${JSON.stringify(canonicalizeFixture({
            targets: omittedTargets,
            version: 1,
        }), null, 2)}\n`).digest('hex'),
        targets: omittedTargets,
    };
    const omittedWorkspace = {
        ...promotionWorkspace,
        pendingPromotion: omittedPromotion,
        state: /** @type {'recovering'} */ ('recovering'),
        syncRecordId,
    };
    await writeControl({...recoveringControl, pendingPromotion: omittedPromotion});
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    assert.equal((await adapter.inspectRecovery(omittedWorkspace)).matches, false);
    await assert.rejects(() => adapter.applyRecovery(omittedWorkspace, 'finalize', {
        recoveryPlanDigest: omittedPromotion.recoveryPlanDigest,
    }));
    await writeControl(approvedControl);
    const malformedTargets = pendingPromotion.targets.map((target, index) => index === 0
        ? {...target, pre: {...target.pre, unexpected: true}}
        : target);
    const malformedPromotion = {
        ...pendingPromotion,
        recoveryPlanDigest: createHash('sha256').update(`${JSON.stringify(canonicalizeFixture({
            targets: malformedTargets,
            version: 1,
        }), null, 2)}\n`).digest('hex'),
        targets: malformedTargets,
    };
    const malformedWorkspace = {
        ...promotionWorkspace,
        pendingPromotion: malformedPromotion,
        state: /** @type {'recovering'} */ ('recovering'),
        syncRecordId,
    };
    assert.equal((await adapter.inspectRecovery(malformedWorkspace)).matches, false);
    await assert.rejects(() => adapter.applyRecovery(malformedWorkspace, 'finalize', {
        recoveryPlanDigest: malformedPromotion.recoveryPlanDigest,
    }));

    await assert.rejects(() => adapter.applyPromotion(/** @type {any} */ (pendingPromotion)), /bound request/);
    const racedTarget = pendingPromotion.targets.find(target => target.path === '.agents/skills/example/SKILL.md');
    if (racedTarget === undefined || racedTarget.pre.bytes === undefined) assert.fail('Expected Skill promotion pre-image.');
    await writeFile(join(root, ...racedTarget.path.split('/')), 'changed after plan\n');
    await assert.rejects(
        () => adapter.applyPromotion({...promotionRequest, ...pendingPromotion}),
        /pre-image (?:changed|no longer matches)/,
    );
    await writeFile(join(root, ...racedTarget.path.split('/')), Buffer.from(racedTarget.pre.bytes, 'base64'));

    if (racedTarget.post.bytes === undefined) assert.fail('Expected Skill promotion post-image.');
    await writeFile(join(root, ...racedTarget.path.split('/')), 'third state\n');
    assert.equal((await adapter.inspectRecovery(interruptedWorkspace)).matches, false);
    await writeFile(join(root, ...racedTarget.path.split('/')), Buffer.from(racedTarget.post.bytes, 'base64'));
    const inspection = await adapter.inspectRecovery(interruptedWorkspace);
    assert.equal(inspection.matches, true);
    if (!('recoveryPlan' in inspection) || !inspection.recoveryPlan) assert.fail('Expected recovery plan.');
    const promotion = await adapter.applyRecovery(interruptedWorkspace, 'finalize', inspection.recoveryPlan);

    const finalizedWorkspace = {
        ...promotionWorkspace,
        finalizedEvidence: promotion.finalizedEvidence,
        pendingPromotion: null,
        state: /** @type {'awaiting-commit'} */ ('awaiting-commit'),
        syncRecordId,
    };
    await adapter.saveWorkspace(finalizedWorkspace);
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).state, 'awaiting-commit');
    const finalizedControl = JSON.parse(await readFile(controlPath, 'utf8'));
    await writeControl({
        ...finalizedControl,
        finalizedEvidence: promotion.finalizedEvidence.filter(entry => entry.path !== omittedPath),
    });
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    const tamperedSkillBytes = Buffer.from('tampered finalized Skill\n');
    const tamperedSkillState = {
        bytes: tamperedSkillBytes.toString('base64'),
        digest: createHash('sha256').update(tamperedSkillBytes).digest('hex'),
        exists: true,
        mode: '100644',
    };
    await writeControl({
        ...finalizedControl,
        finalizedEvidence: promotion.finalizedEvidence.map(entry => entry.path === omittedPath
            ? {...tamperedSkillState, path: omittedPath}
            : entry),
    });
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    const tamperedFinalizedEvidence = promotion.finalizedEvidence.map(entry => entry.path === recordPath
        ? {...tamperedRecordPost, path: recordPath, syncRecordId}
        : entry);
    await writeControl({...finalizedControl, finalizedEvidence: tamperedFinalizedEvidence});
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');

    const tamperedDigestApprovalWithoutIdentity = {
        ...promotionWorkspace.approval,
        candidateActualSkillDigest: '8'.repeat(64),
        candidateSourceDigest: '9'.repeat(64),
    };
    delete tamperedDigestApprovalWithoutIdentity.approvalAttestationId;
    const tamperedDigestApproval = {
        ...tamperedDigestApprovalWithoutIdentity,
        approvalAttestationId: createHash('sha256')
            .update(`${JSON.stringify(canonicalizeFixture(tamperedDigestApprovalWithoutIdentity), null, 2)}\n`)
            .digest('hex'),
    };
    const tamperedDigestWorkspace = {
        ...finalizedWorkspace,
        approval: tamperedDigestApproval,
        candidateActualSkillDigest: tamperedDigestApproval.candidateActualSkillDigest,
        candidateSourceDigest: tamperedDigestApproval.candidateSourceDigest,
    };
    const tamperedDigestRecordWithoutIdentity = syncRecordWithoutIdentityFixture(tamperedDigestWorkspace);
    const tamperedDigestSyncRecordId = createHash('sha256')
        .update(`${JSON.stringify(canonicalizeFixture(tamperedDigestRecordWithoutIdentity), null, 2)}\n`)
        .digest('hex');
    const tamperedDigestRecord = {...tamperedDigestRecordWithoutIdentity, syncRecordId: tamperedDigestSyncRecordId};
    const tamperedDigestRecordBytes = Buffer.from(`${JSON.stringify(canonicalizeFixture(tamperedDigestRecord), null, 2)}\n`);
    const tamperedDigestRecordPath = `upstream/sources/${sourceId}/sync-records/${tamperedDigestSyncRecordId}.json`;
    const tamperedDigestRecordState = {
        bytes: tamperedDigestRecordBytes.toString('base64'),
        digest: createHash('sha256').update(tamperedDigestRecordBytes).digest('hex'),
        exists: true,
        mode: '100644',
    };
    await writeControl({
        ...finalizedControl,
        approval: tamperedDigestApproval,
        candidateActualSkillDigest: tamperedDigestApproval.candidateActualSkillDigest,
        candidateSourceDigest: tamperedDigestApproval.candidateSourceDigest,
        finalizedEvidence: promotion.finalizedEvidence.map(entry => entry.path === recordPath
            ? {...tamperedDigestRecordState, path: tamperedDigestRecordPath, syncRecordId: tamperedDigestSyncRecordId}
            : entry),
        syncRecordId: tamperedDigestSyncRecordId,
    });
    assert.equal(requireWorkspace(await adapter.loadWorkspace()).recoveryKind, 'manual-workspace');
    await writeControl(finalizedControl);

    assert.equal(await readFile(join(skillDirectory, 'SKILL.md'), 'utf8'), 'new Skill\n');
    assert.equal(await readFile(join(licenseDirectory, `LICENSE.${sourceId}`), 'utf8'), 'new license\n');
    const promotedConfiguration = JSON.parse(await readFile(join(sourceDirectory, 'source.json'), 'utf8'));
    assert.equal(promotedConfiguration.commit, targetCommit);
    assert.deepEqual(JSON.parse(await readFile(join(sourceDirectory, 'sync-records', `${syncRecord.syncRecordId}.json`), 'utf8')), syncRecord);
    assert.equal(await adapter.headMatches(promotion.finalizedEvidence), false);
    await runGit(root, ['add', '.agents/skills/example', 'docs/licenses/arw', 'upstream/sources/example-source']);
    await runGit(root, [
        '-c', 'user.email=arw@example.invalid',
        '-c', 'user.name=ARW Test',
        'commit', '-m', 'sync',
    ]);
    assert.equal(await adapter.headMatches(promotion.finalizedEvidence), true);
});

test('HEAD checkpoint batches complete blob input across finalized path counts', async () => {
    const inspectSize = async (/** @type {number} */ size) => {
        const records = Array.from({length: size}, (_, index) => ({
            bytes: Buffer.from(`bytes-${index}\n`),
            objectId: String(index + 1).padStart(40, '0'),
            path: `path-${index}.txt`,
        }));
        /** @type {string[]} */
        const batchInputs = [];
        const adapter = createSourceCheckoutStateAdapter({
            gitRunner: {
                async run(input) {
                    if (input.argv[0] === 'ls-tree') {
                        return {
                            code: 0,
                            failure: null,
                            stderr: '',
                            stdout: Buffer.from(records
                                .map(record => `100644 blob ${record.objectId}\t${record.path}\0`)
                                .join('')),
                        };
                    }
                    assert.deepEqual(input.argv, ['cat-file', '--batch']);
                    if (input.input === undefined) assert.fail('Expected batch input.');
                    batchInputs.push(input.input.toString('utf8'));
                    return {
                        code: 0,
                        failure: null,
                        stderr: '',
                        stdout: Buffer.concat(records.flatMap(record => [
                            Buffer.from(`${record.objectId} blob ${record.bytes.length}\n`),
                            record.bytes,
                            Buffer.from('\n'),
                        ])),
                    };
                },
            },
            repositoryRoot: process.cwd(),
        });
        const matched = await adapter.headMatches(records.map(record => ({
            bytes: record.bytes.toString('base64'),
            exists: true,
            mode: '100644',
            path: record.path,
        })));
        return {batchInputs, matched, records};
    };

    const small = await inspectSize(1);
    const large = await inspectSize(4);

    assert.equal(small.matched, true);
    assert.equal(large.matched, true);
    assert.equal(small.batchInputs.length, large.batchInputs.length);
    assert.equal(small.batchInputs.length, 1);
    assert.equal(small.batchInputs[0], `${small.records.map(record => record.objectId).join('\n')}\n`);
    assert.equal(large.batchInputs[0], `${large.records.map(record => record.objectId).join('\n')}\n`);
});

test('prepare rejects unsupported source URLs before acquisition', async () => {
    /** @type {AcquisitionRequest[]} */
    const calls = [];
    const module = createTestUpstreamSyncModule({
        git: {
            async acquire(/** @type {AcquisitionRequest} */ request) {
                calls.push(request);
                return {entries: [], status: 'succeeded'};
            },
        },
        sourceState: {
            async loadCanonicalSource() {
                return null;
            },
            async loadConfiguration() {
                return {
                    url: 'http://example.invalid/upstream.git',
                    commit: '1111111111111111111111111111111111111111',
                    platform: 'codex',
                    scope: {include: ['**'], exclude: []},
                    additionalSkillReferences: [],
                    skillReferenceNormalizations: [],
                };
            },
            async loadWorkspace() {
                return null;
            },
        },
    });

    const result = await module.prepare('engineering-skills', fullCommit);

    assert.equal(result.state, 'idle');
    assert.deepEqual(result.permittedOperations, ['prepare', 'status']);
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), ['invalid-source-url']);
    assert.deepEqual(calls, []);
});

test('prepare preserves acquisition diagnostics and retries cleanup in a new Module instance', async t => {
    const root = await createTemporaryDirectory(t, 'arw-upstream-module-cleanup-retry-');
    let acquisitionCalls = 0;
    let disposalCalls = 0;
    const gitRunner = {
        async run(/** @type {GitInvocation} */ request) {
            if (request.argv[0] === 'init') {
                return {code: 0, failure: null, stderr: '', stdout: Buffer.alloc(0)};
            }
            if (request.argv.includes('fetch')) {
                acquisitionCalls += 1;
                return {code: 128, failure: null, stderr: 'missing commit', stdout: Buffer.alloc(0)};
            }
            return {code: 1, failure: null, stderr: 'unexpected command', stdout: Buffer.alloc(0)};
        },
    };
    const removeDirectory = async (/** @type {Parameters<typeof rm>[0]} */ path, /** @type {Parameters<typeof rm>[1]} */ options) => {
        disposalCalls += 1;
        if (disposalCalls === 1) throw new Error('simulated cleanup failure');
        await rm(path, options);
    };
    const createModule = () => createTestUpstreamSyncModule({
        git: createUpstreamGitAdapter({gitRunner, removeDirectory, temporaryDirectory: root}),
        sourceState: {
            async loadConfiguration() {
                return validSourceConfiguration();
            },
            async loadWorkspace() {
                return null;
            },
        },
    });

    const cleanupFailure = await createModule().prepare('engineering-skills', fullCommit);
    const retried = await createModule().prepare('engineering-skills', fullCommit);

    assert.equal(cleanupFailure.status, 'failed');
    assert.equal(cleanupFailure.stage, 'acquisition-cleanup');
    assert.deepEqual(cleanupFailure.cleanup, {attempted: true, retryable: true, status: 'failed'});
    assert.deepEqual(cleanupFailure.diagnostics.map(item => item.code), [
        'acquisition-cleanup-failed',
        'base-acquisition-failed',
    ]);
    assert.equal(retried.status, 'failed');
    assert.equal(retried.stage, 'acquisition');
    assert.deepEqual(retried.cleanup, {attempted: true, retryable: false, status: 'succeeded'});
    assert.deepEqual(retried.diagnostics.map(item => item.code), ['base-acquisition-failed']);
    assert.equal(acquisitionCalls, 2);
    assert.equal(disposalCalls, 3);
});

test('candidate snapshot digests distinguish binary delimiter content from additional entries', async () => {
    const firstPath = 'skills/alpha/SKILL.md';
    const secondPath = 'skills/zeta/SKILL.md';
    const oneEntry = [{
        bytes: Buffer.concat([
            Buffer.from([0]),
            Buffer.from(secondPath),
            Buffer.from([0]),
            Buffer.from('100644'),
            Buffer.from([0]),
            Buffer.from('skill'),
        ]),
        mode: '100644',
        path: firstPath,
    }];
    const twoEntries = [
        {bytes: Buffer.alloc(0), mode: '100644', path: firstPath},
        {bytes: Buffer.from('skill'), mode: '100644', path: secondPath},
    ];
    const digestFor = async (/** @type {SnapshotEntry[]} */ candidate) => {
        const workspace = completeWorkspace({
            base: candidate,
            candidate,
            mergeBase: candidate,
            mergeTheirs: candidate,
            ours: candidate,
            theirs: candidate,
        });
        const module = createTestUpstreamSyncModule({
            git: {},
            sourceState: {
                async loadWorkspace() {
                    return workspace;
                },
                async preflightPromotion() {
                    return {matches: true};
                },
                async saveWorkspace() {},
            },
        });
        const result = await module.createReviewRevision();
        assert.equal(result.status, 'succeeded', JSON.stringify(result));
        return result.candidateActualSkillDigest;
    };

    assert.notEqual(await digestFor(oneEntry), await digestFor(twoEntries));
});

test('prepare rejects embedded credentials in HTTPS and SSH URLs before acquisition', async () => {
    for (const url of [
        'https://user:secret@example.invalid/upstream.git',
        'ssh://git:secret@example.invalid/upstream.git',
    ]) {
        /** @type {AcquisitionRequest[]} */
        const calls = [];
        const module = createTestUpstreamSyncModule({
            git: {
                async acquire(/** @type {AcquisitionRequest} */ request) {
                    calls.push(request);
                    return {entries: [], status: 'succeeded'};
                },
            },
            sourceState: {
                async loadConfiguration() {
                    return {...validSourceConfiguration(), url};
                },
                async loadWorkspace() {
                    return null;
                },
            },
        });

        const prepared = await module.prepare('engineering-skills', fullCommit);

        assert.equal(prepared.status, 'blocked');
        assert.deepEqual(prepared.diagnostics.map(diagnostic => diagnostic.code), ['invalid-source-url']);
        assert.deepEqual(calls, []);
    }
});

test('prepare rejects malformed closed source configurations before acquisition', async () => {
    const configurations = [
        {...validSourceConfiguration(), version: 1},
        {
            additionalSkillReferences: [],
            commit: '1111111111111111111111111111111111111111',
            platform: 'codex',
            scope: {include: ['**'], exclude: []},
            skillReferenceNormalizations: [],
            url: 'https://example.invalid/upstream.git',
        },
        {...validSourceConfiguration(), scope: {exclude: [], include: ['**']}},
        {...validSourceConfiguration(), additionalSkillReferences: ['zeta', 'alpha']},
        {
            ...validSourceConfiguration(),
            skillReferenceNormalizations: [
                {column: 1, identity: 'zeta', line: 1, path: 'skills/zeta/SKILL.md'},
                {column: 1, identity: 'alpha', line: 1, path: 'skills/alpha/SKILL.md'},
            ],
        },
        {
            ...validSourceConfiguration(),
            skillReferenceNormalizations: [
                {column: 1, identity: 'example', line: 1, path: 'skills/Bad/SKILL.md'},
            ],
        },
    ];
    for (const configuration of configurations) {
        /** @type {AcquisitionRequest[]} */
        const calls = [];
        const module = createTestUpstreamSyncModule({
            git: {
                async acquire(/** @type {AcquisitionRequest} */ request) {
                    calls.push(request);
                    return {entries: [], status: 'succeeded'};
                },
            },
            sourceState: {
                async loadConfiguration() {
                    return configuration;
                },
                async loadWorkspace() {
                    return null;
                },
            },
        });

        const result = await module.prepare('engineering-skills', fullCommit);

        assert.equal(result.state, 'idle');
        assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), ['invalid-source-configuration']);
        assert.deepEqual(calls, []);
    }
});

test('prepare returns structured diagnostics for unreadable canonical inputs', async () => {
    const cases = [
        ['configuration', 'source-configuration-read-failed'],
        ['projection', 'projection-configuration-read-failed'],
        ['ours', 'ours-snapshot-read-failed'],
        ['persistence', 'workspace-persistence-failed'],
    ];
    for (const [failure, expectedCode] of cases) {
        /** @type {SyncWorkspace | null} */
        let workspace = null;
        let workspaceWrites = 0;
        const module = createTestUpstreamSyncModule({
            git: {
                async acquire(/** @type {AcquisitionRequest} */ {commit}) {
                    return {
                        entries: [{
                            bytes: Buffer.from(commit === fullCommit ? 'new\n' : 'old\n'),
                            mode: '100644',
                            path: 'LICENSE',
                        }],
                        status: 'succeeded',
                    };
                },
                async classifyRelationship() {
                    return 'descendant';
                },
            },
            sourceState: {
                async loadConfiguration() {
                    if (failure === 'configuration') throw new Error('private configuration failure');
                    return {...validSourceConfiguration(), commit: '1'.repeat(40)};
                },
                async loadActualOurs() {
                    if (failure === 'ours') throw new Error('private Ours failure');
                    return {entries: []};
                },
                async loadProjectionConfiguration() {
                    if (failure === 'projection') throw new Error('private projection failure');
                    return projectionConfigFixture;
                },
                async loadWorkspace() {
                    return workspace;
                },
                async saveWorkspace(/** @type {SyncWorkspace} */ value) {
                    workspaceWrites += 1;
                    if (failure === 'persistence') throw new Error('private persistence failure');
                    workspace = value;
                },
            },
        });

        const prepared = await module.prepare('engineering-skills', fullCommit);
        const result = failure === 'projection' ? await module.createReviewRevision() : prepared;

        assert.equal(result.state, failure === 'persistence' ? 'recovering' : failure === 'projection' ? 'resolving' : 'idle');
        assert.equal(result.status, 'failed');
        assert.deepEqual(result.diagnostics.map(item => item.code), [expectedCode]);
        assert.equal(JSON.stringify(result.diagnostics).includes('private'), false);
        assert.equal(workspaceWrites, ['persistence', 'projection'].includes(failure) ? 1 : 0);
    }
});

test('prepare rejects non-portable selected tree entries and case collisions', async () => {
    let workspaceWrites = 0;
    const module = createTestUpstreamSyncModule({
        git: {
            async acquire(/** @type {AcquisitionRequest} */ {commit}) {
                return commit === '1'.repeat(40)
                    ? {entries: [{bytes: Buffer.from('base\n'), mode: '100644', path: 'A.txt'}], status: 'succeeded'}
                    : {entries: [
                        {bytes: Buffer.from('target\n'), mode: '100644', path: 'A.txt'},
                        {bytes: Buffer.from('collision\n'), mode: '100644', path: 'a.txt'},
                        {bytes: Buffer.from('A.txt'), mode: '120000', path: 'link.txt'},
                    ], status: 'succeeded'};
            },
            async classifyRelationship() {
                return 'descendant';
            },
        },
        sourceState: {
            async loadConfiguration() {
                return {...validSourceConfiguration(), commit: '1'.repeat(40)};
            },
            async loadWorkspace() {
                return null;
            },
            async saveWorkspace() {
                workspaceWrites += 1;
            },
        },
    });

    const prepared = await module.prepare('engineering-skills', fullCommit);

    assert.equal(prepared.state, 'idle');
    assert.deepEqual(prepared.diagnostics.map(item => item.code), [
        'portable-path-collision',
        'non-portable-source-entry',
    ]);
    assert.equal(workspaceWrites, 0);
});

test('prepare accepts an empty Source Scope and rejects embedded cross-segment globstars', async () => {
    const prepareWithScope = async (/** @type {SourceScope} */ scope) => {
        /** @type {AcquisitionRequest[]} */
        const calls = [];
        const module = createTestUpstreamSyncModule({
            git: {
                async acquire(/** @type {AcquisitionRequest} */ request) {
                    calls.push(request);
                    return {entries: [{bytes: Buffer.from('source\n'), mode: '100644', path: 'file.txt'}], status: 'succeeded'};
                },
                async classifyRelationship() {
                    return 'descendant';
                },
            },
            sourceState: {
                async loadConfiguration() {
                    return {...validSourceConfiguration(), commit: '1'.repeat(40), scope};
                },
                async loadWorkspace() {
                    return null;
                },
            },
        });
        return {calls, result: await module.prepare('engineering-skills', fullCommit)};
    };

    const empty = await prepareWithScope({include: [], exclude: []});
    const invalid = await prepareWithScope({include: ['skills/**name'], exclude: []});

    assert.equal(empty.result.state, 'idle');
    assert.equal(empty.result.noSelectedSourceChanges, true);
    assert.equal(empty.calls.length, 2);
    assert.deepEqual(invalid.result.diagnostics.map(item => item.code), ['invalid-source-scope']);
    assert.deepEqual(invalid.calls, []);
});

test('review keeps Base interpretation separate and confirms the independent Theirs Skill reference review', async () => {
    /** @type {SyncWorkspace | null} */
    let workspace = null;
    /** @type {unknown[]} */
    const confirmations = [];
    let projectionConfigurationReads = 0;
    const additionalSkillReferencesHash = 'a'.repeat(64);
    const skillReferenceNormalizationsHash = 'b'.repeat(64);
    const module = createTestUpstreamSyncModule({
        git: {
            async acquire(/** @type {AcquisitionRequest} */ {commit}) {
                return {
                    entries: [{
                        bytes: Buffer.from(commit === fullCommit ? 'Use /theirs-only .\n' : 'Use /base-only .\n'),
                        mode: '100644',
                        path: 'skills/engineering/example/SKILL.md',
                    }],
                    status: 'succeeded',
                };
            },
            async classifyRelationship() {
                return 'descendant';
            },
        },
        referenceReview: async (/** @type {Parameters<typeof reviewSkillReferences>[0]} */ input) => {
            confirmations.push(input.confirmHashes);
            assert.deepEqual(input.additionalSkillReferences, ['theirs-only']);
            if (input.confirmHashes === null) {
                input.emitHash?.(additionalSkillReferencesHash);
                input.emitHash?.(skillReferenceNormalizationsHash);
                return {
                    diagnostics: [{code: 'review-confirmation-required', message: 'Confirm unchanged candidates.'}],
                    status: 'blocked',
                };
            }
            return {
                additionalSkillReferences: ['theirs-only'],
                additionalSkillReferencesHash,
                diagnostics: [],
                skillReferenceNormalizations: [],
                skillReferenceNormalizationsHash,
                status: 'succeeded',
            };
        },
        sourceState: {
            async loadProjectionConfiguration() {
                projectionConfigurationReads += 1;
                return projectionConfigFixture;
            },
            async loadActualOurs() {
                return {
                    entries: [{bytes: Buffer.from('Use $base-only .\n'), mode: '100644', path: 'skills/example/SKILL.md'}],
                };
            },
            async loadConfiguration() {
                return {
                    ...validSourceConfiguration(),
                    additionalSkillReferences: ['base-only'],
                    platform: 'claude-code',
                    scope: {include: ['skills/**'], exclude: []},
                };
            },
            async loadWorkspace() {
                return workspace;
            },
            async saveWorkspace(/** @type {SyncWorkspace} */ value) {
                workspace = value;
            },
        },
    });

    const prepared = await module.prepare('engineering-skills', fullCommit);
    assert.equal(projectionConfigurationReads, 0);
    const initialReview = await module.createReviewRevision();
    requireWorkspace(workspace).agentMergeNotes = '# Merge notes\n\nApplied the reviewed reference decisions.\n';
    const reviewed = await module.createReviewRevision({
        additionalSkillReferencesHash,
        skillReferenceNormalizationsHash,
    });

    assert.equal(prepared.state, 'resolving');
    assert.deepEqual(initialReview.diagnostics.map(item => item.code), ['review-confirmation-required']);
    assert.match(Buffer.from(initialReview.rawOutput ?? '').toString('utf8'), new RegExp(additionalSkillReferencesHash));
    assert.equal(reviewed.state, 'reviewed');
    assert.deepEqual(confirmations, [null, {additionalSkillReferencesHash, skillReferenceNormalizationsHash}]);
    const reviewedWorkspace = requireWorkspace(workspace);
    assert.deepEqual(reviewedWorkspace.sourceConfiguration.additionalSkillReferences, ['base-only']);
    assert.deepEqual(reviewedWorkspace.theirsSkillReferenceReview?.additionalSkillReferences, ['theirs-only']);
    assert.equal(reviewedWorkspace.base[0].path, 'skills/engineering/example/SKILL.md');
    assert.equal(reviewedWorkspace.base[0].bytes.toString('utf8'), 'Use /base-only .\n');
    assert.equal(reviewedWorkspace.theirs[0].path, 'skills/engineering/example/SKILL.md');
    assert.equal(reviewedWorkspace.theirs[0].bytes.toString('utf8'), 'Use /theirs-only .\n');
    assert.equal(reviewedWorkspace.mergeBase[0].path, 'skills/example/SKILL.md');
    assert.equal(reviewedWorkspace.mergeBase[0].bytes.toString('utf8'), 'Use $base-only .\n');
    assert.equal(reviewedWorkspace.mergeTheirs[0].path, 'skills/example/SKILL.md');
    assert.equal(reviewedWorkspace.mergeTheirs[0].bytes.toString('utf8'), 'Use $theirs-only .\n');
});

test('review preserves a failed shared Skill reference review result', async () => {
    let workspace = completeWorkspace({theirsSkillReferenceReview: undefined});
    const module = createTestUpstreamSyncModule({
        git: {},
        referenceReview: async () => ({
            diagnostics: [{code: 'review-editor-failed', message: 'Editor failed.'}],
            stage: 'editor',
            status: 'failed',
        }),
        sourceState: {
            async loadWorkspace() {
                return workspace;
            },
            async saveWorkspace(/** @type {SyncWorkspace} */ value) {
                workspace = value;
            },
        },
    });

    const reviewed = await module.createReviewRevision();

    assert.equal(reviewed.state, 'resolving');
    assert.equal(reviewed.status, 'failed');
    assert.deepEqual(reviewed.diagnostics.map(item => item.code), ['review-editor-failed']);
});

test('three-way merge handles line edits and preserves binary conflict bytes', async () => {
    const prepareCase = async (/** @type {{baseBytes: Buffer | null, oursBytes: Buffer | null, theirsBytes: Buffer | null}} */ {
        baseBytes,
        oursBytes,
        theirsBytes,
    }) => {
        /** @type {SyncWorkspace | null} */
        let workspace = null;
        const module = createTestUpstreamSyncModule({
            git: {
                async acquire(/** @type {AcquisitionRequest} */ {commit}) {
                    const bytes = commit === fullCommit ? theirsBytes : baseBytes;
                    return {entries: bytes === null ? [] : [{bytes, mode: '100644', path: 'LICENSE'}], status: 'succeeded'};
                },
                async classifyRelationship() {
                    return 'descendant';
                },
            },
            sourceState: {
                async loadConfiguration() {
                    return {...validSourceConfiguration(), commit: '1'.repeat(40)};
                },
                async loadActualOurs() {
                    return {entries: oursBytes === null ? [] : [{bytes: oursBytes, mode: '100644', path: 'LICENSE'}]};
                },
                async loadWorkspace() {
                    return workspace;
                },
                async saveWorkspace(/** @type {SyncWorkspace} */ value) {
                    workspace = value;
                },
            },
        });
        const prepared = await module.prepare('engineering-skills', fullCommit);
        assert.equal(prepared.state, 'resolving');
        await module.createReviewRevision();
        return requireWorkspace(workspace);
    };

    const textWorkspace = await prepareCase({
        baseBytes: Buffer.from('alpha\nremove\nomega\n'),
        oursBytes: Buffer.from('ours\nalpha\nremove\nomega\n'),
        theirsBytes: Buffer.from('alpha\nomega\ntheirs\n'),
    });
    assert.equal(textWorkspace.candidate[0].bytes.toString('utf8'), 'ours\nalpha\nomega\ntheirs\n');
    assert.deepEqual(textWorkspace.textConflicts, []);

    const oursBinary = Buffer.from([0xff, 0x02]);
    const binaryWorkspace = await prepareCase({
        baseBytes: Buffer.from([0xff, 0x01]),
        oursBytes: oursBinary,
        theirsBytes: Buffer.from([0xff, 0x03]),
    });
    assert.equal(binaryWorkspace.candidate[0].bytes.equals(oursBinary), true);
    assert.deepEqual(binaryWorkspace.binaryConflicts, ['LICENSE']);
    assert.deepEqual(binaryWorkspace.textConflicts, []);

    const deletedBinaryWorkspace = await prepareCase({
        baseBytes: Buffer.from([0xff, 0x01]),
        oursBytes: null,
        theirsBytes: Buffer.from([0xff, 0x03]),
    });
    assert.deepEqual(deletedBinaryWorkspace.candidate, []);
    assert.deepEqual(deletedBinaryWorkspace.binaryConflicts, ['LICENSE']);
    assert.deepEqual(deletedBinaryWorkspace.textConflicts, []);

    const addedLicenseWorkspace = await prepareCase({
        baseBytes: null,
        oursBytes: null,
        theirsBytes: Buffer.from('new license\n'),
    });
    assert.deepEqual(addedLicenseWorkspace.requiredLegalPaths, ['LICENSE']);
});

test('review creates a stable revision bound directly to exact Agent merge notes', async () => {
    /** @type {SyncWorkspace | null} */
    let workspace = null;
    let canonicalMatches = true;
    const sourceState = {
        async loadActualOurs() {
            return {entries: [{bytes: Buffer.from('ours\nshared\n'), mode: '100644', path: 'skills/example/SKILL.md'}]};
        },
        async loadConfiguration() {
            return validSourceConfiguration();
        },
        async loadWorkspace() {
            return workspace;
        },
        async preflightPromotion() {
            return {matches: canonicalMatches};
        },
        async saveWorkspace(/** @type {SyncWorkspace} */ value) {
            workspace = value;
        },
    };
    const module = createTestUpstreamSyncModule({
        git: {
            async acquire(/** @type {AcquisitionRequest} */ {commit}) {
                return {
                    entries: [{
                        bytes: Buffer.from(commit === fullCommit ? 'base\ntheirs\n' : 'base\nshared\n'),
                        mode: '100644',
                        path: 'skills/engineering/example/SKILL.md',
                    }],
                    status: 'succeeded',
                };
            },
            async classifyRelationship() {
                return 'descendant';
            },
        },
        sourceState,
    });

    await module.prepare('engineering-skills', fullCommit);
    const unresolved = await module.createReviewRevision();
    assert.deepEqual(unresolved.diagnostics.map(item => item.code), ['agent-merge-notes-required']);
    const preparedWorkspace = requireWorkspace(workspace);
    preparedWorkspace.agentMergeNotes = '# Merge notes\n\nCombined the independent line changes.\n';
    const first = await module.createReviewRevision();
    const second = await module.createReviewRevision();

    assert.equal(first.state, 'reviewed');
    assert.equal(second.state, 'reviewed');
    assert.equal(second.reviewRevisionId, first.reviewRevisionId);
    assert.equal(second.agentMergeNotesDigest, first.agentMergeNotesDigest);
    if (first.candidateSourceDigest === undefined) assert.fail('Expected candidate source digest.');
    if (first.candidateActualSkillDigest === undefined) assert.fail('Expected candidate actual Skill digest.');
    if (first.agentMergeNotesDigest === undefined) assert.fail('Expected Agent merge notes digest.');
    assert.equal(first.candidateSourceDigest.length, 64);
    assert.equal(first.candidateActualSkillDigest.length, 64);
    assert.equal(first.agentMergeNotesDigest, createHash('sha256').update(preparedWorkspace.agentMergeNotes).digest('hex'));
    const approval = {
        agentMergeNotesDigest: first.agentMergeNotesDigest,
        candidateActualSkillDigest: first.candidateActualSkillDigest,
        candidateSourceDigest: first.candidateSourceDigest,
        channel: 'external-review',
        externalEvidence: 'https://review.example.invalid/stale',
        reviewRevisionId: first.reviewRevisionId,
        status: 'approved',
    };
    canonicalMatches = false;
    const canonicalStatus = await module.status();
    const canonicalApproval = await module.recordApproval(approval);
    assert.equal(canonicalStatus.state, 'resolving');
    assert.deepEqual(canonicalStatus.diagnostics.map(item => item.code), ['sync-owned-review-input-drift']);
    assert.equal(canonicalApproval.state, 'resolving');
    assert.deepEqual(canonicalApproval.diagnostics.map(item => item.code), ['sync-owned-review-input-drift']);
    canonicalMatches = true;
    const currentWorkspace = requireWorkspace(workspace);
    currentWorkspace.state = 'reviewed';
    currentWorkspace.candidate[0].bytes = Buffer.from('changed after review\n');
    const staleStatus = await module.status();
    const staleApproval = await module.recordApproval(approval);
    assert.equal(staleStatus.state, 'resolving');
    assert.deepEqual(staleStatus.diagnostics.map(item => item.code), ['candidate-actual-skills-stale']);
    assert.equal(staleApproval.state, 'resolving');
    assert.deepEqual(staleApproval.diagnostics.map(item => item.code), ['candidate-actual-skills-stale']);
});

test('review revalidates persisted Theirs Skill reference evidence against current candidates', async () => {
    const hashes = skillReferenceReviewHashes({
        additionalSkillReferences: ['injected'],
        skillReferenceNormalizations: [],
    });
    const workspace = completeWorkspace({
        theirsSkillReferenceReview: {
            additionalSkillReferences: ['injected'],
            additionalSkillReferencesHash: hashes.additionalSkillReferencesHash,
            skillReferenceNormalizations: [],
            skillReferenceNormalizationsHash: hashes.skillReferenceNormalizationsHash,
        },
    });
    const module = createTestUpstreamSyncModule({
        git: {},
        sourceState: {
            async loadWorkspace() {
                return workspace;
            },
            async preflightPromotion() {
                return {matches: true};
            },
        },
    });

    const reviewed = await module.createReviewRevision();

    assert.equal(reviewed.state, 'resolving');
    assert.equal(reviewed.status, 'blocked');
    assert.deepEqual(reviewed.diagnostics.map(item => item.code), ['skill-reference-review-evidence-changed']);
});

test('projection configuration drift invalidates approval and lets review replace the stale revision', async () => {
    let projectionConfiguration = /** @type {unknown} */ (projectionConfigFixture);
    let workspace = completeWorkspace({state: 'reviewed'});
    Object.assign(workspace, reviewRevisionBindingsFixture(workspace));
    const module = createTestUpstreamSyncModule({
        git: {},
        sourceState: {
            async loadProjectionConfiguration() {
                return projectionConfiguration;
            },
            async loadWorkspace() {
                return workspace;
            },
            async saveWorkspace(/** @type {SyncWorkspace} */ value) {
                workspace = value;
            },
        },
    });
    const approved = await module.recordApproval({
        candidateActualSkillDigest: workspace.candidateActualSkillDigest,
        candidateSourceDigest: workspace.candidateSourceDigest,
        channel: 'codex-conversation',
        humanConfirmation: 'Approve the exact reviewed revision.',
        agentMergeNotesDigest: workspace.agentMergeNotesDigest,
        reviewRevisionId: workspace.reviewRevisionId,
        status: 'approved',
    });
    assert.equal(approved.state, 'approved');
    const currentReview = await module.createReviewRevision();
    assert.equal(currentReview.state, 'approved');
    assert.equal(currentReview.status, 'blocked');
    assert.deepEqual(currentReview.diagnostics.map(item => item.code), ['review-not-permitted']);
    projectionConfiguration = {
        ...projectionConfigFixture,
        skills: {
            ...projectionConfigFixture.skills,
            additionalSkillReferences: ['changed'],
        },
    };

    const stale = await module.status();

    assert.equal(stale.state, 'resolving');
    assert.equal(stale.status, 'blocked');
    assert.deepEqual(stale.diagnostics.map(item => item.code), ['projection-configuration-drift']);
    assert.equal(workspace.state, 'approved');

    const replaced = await module.createReviewRevision();

    assert.equal(replaced.state, 'reviewed');
    assert.equal(replaced.status, 'succeeded');
    assert.notEqual(replaced.reviewRevisionId, approved.reviewRevisionId);
    assert.equal(workspace.approval, null);
    assert.equal(workspace.projectionConfigurationDigest, projectionConfigurationDigestFixture(projectionConfiguration));
});

test('review persists reviewed input drift as resolving before abort and reprepare', async () => {
    let workspace = completeWorkspace({state: 'reviewed'});
    workspace.candidateActualSkillDigest = snapshotDigestFixture(workspace.candidate);
    workspace.candidateSourceDigest = candidateSourceDigestFixture(workspace);
    workspace.reviewInputDigest = reviewInputDigestFixture(workspace);
    workspace.agentMergeNotesDigest = 'b'.repeat(64);
    workspace.reviewRevisionId = 'e'.repeat(64);
    const module = createTestUpstreamSyncModule({
        git: {},
        sourceState: {
            async loadWorkspace() {
                return workspace;
            },
            async preflightPromotion() {
                return {matches: false};
            },
            async saveWorkspace(/** @type {SyncWorkspace} */ value) {
                workspace = value;
            },
        },
    });

    const reviewed = await module.createReviewRevision();

    assert.equal(reviewed.state, 'resolving');
    assert.equal(reviewed.status, 'blocked');
    assert.deepEqual(reviewed.diagnostics.map(item => item.code), ['sync-owned-review-input-drift']);
    assert.equal(workspace.state, 'resolving');
    assert.equal(workspace.approval, null);
});

test('review rejects empty, unsafe, or invalid Unicode Agent merge notes', async () => {
    const cases = /** @type {unknown[]} */ (['', '   \n', '# Notes\n\0', '# Notes\n\ud800']);
    for (const value of cases) {
        let workspace = completeWorkspace({agentMergeNotes: /** @type {string} */ (value)});
        const module = createTestUpstreamSyncModule({
            git: {},
            sourceState: {
                async loadWorkspace() {
                    return workspace;
                },
                async saveWorkspace(/** @type {SyncWorkspace} */ updated) {
                    workspace = updated;
                },
            },
        });

        const reviewed = await module.createReviewRevision();

        assert.equal(reviewed.state, 'resolving');
        assert.equal(reviewed.status, 'blocked');
        assert.deepEqual(reviewed.diagnostics.map(item => item.code), ['agent-merge-notes-required']);
    }
});

test('review blocks editable candidate paths outside the fixed output layout', async () => {
    let workspace = completeWorkspace({
        candidate: [{bytes: Buffer.from('candidate note\n'), mode: '100644', path: 'notes.txt'}],
    });
    const module = createTestUpstreamSyncModule({
        git: {},
        sourceState: {
            async loadWorkspace() {
                return workspace;
            },
            async saveWorkspace(/** @type {SyncWorkspace} */ value) {
                workspace = value;
            },
        },
    });

    const reviewed = await module.createReviewRevision();

    assert.equal(reviewed.state, 'resolving');
    assert.equal(reviewed.status, 'blocked');
    assert.deepEqual(reviewed.diagnostics.map(item => item.code), ['candidate-path-unassigned']);
});

test('review blocks non-empty candidate Skill roots without SKILL.md', async () => {
    const path = 'skills/example/asset.bin';
    let workspace = completeWorkspace({
        candidate: [{bytes: Buffer.from([0xff, 0x01]), mode: '100644', path}],
    });
    const module = createTestUpstreamSyncModule({
        git: {},
        sourceState: {
            async loadWorkspace() {
                return workspace;
            },
            async saveWorkspace(/** @type {SyncWorkspace} */ value) {
                workspace = value;
            },
        },
    });

    const reviewed = await module.createReviewRevision();

    assert.equal(reviewed.state, 'resolving');
    assert.equal(reviewed.status, 'blocked');
    assert.deepEqual(reviewed.diagnostics.map(item => item.code), ['candidate-skill-entrypoint-missing']);
});

test('review revision changes when Agent merge notes change', async () => {
    const path = 'skills/example/SKILL.md';
    let workspace = completeWorkspace({
        base: [{bytes: Buffer.from('base\n'), mode: '100644', path}],
        candidate: [{bytes: Buffer.from('candidate\n'), mode: '100644', path}],
        ours: [{bytes: Buffer.from('ours\n'), mode: '100644', path}],
        state: 'resolving',
        theirs: [{bytes: Buffer.from('theirs\n'), mode: '100644', path}],
    });
    const module = createTestUpstreamSyncModule({
        git: {},
        sourceState: {
            async loadWorkspace() {
                return workspace;
            },
            async saveWorkspace(/** @type {SyncWorkspace} */ value) {
                workspace = value;
            },
        },
    });

    const first = await module.createReviewRevision();
    workspace.agentMergeNotes = '# Merge notes\n\nA different explanation.\n';
    workspace.state = 'resolving';
    const second = await module.createReviewRevision();

    assert.equal(first.state, 'reviewed');
    assert.equal(second.state, 'reviewed');
    assert.notEqual(second.reviewRevisionId, first.reviewRevisionId);
});

test('approval requires a complete attestation bound to the current candidate and Agent merge notes', async () => {
    let workspace = completeWorkspace({state: 'reviewed'});
    Object.assign(workspace, reviewRevisionBindingsFixture(workspace));
    const module = createTestUpstreamSyncModule({
        git: {},
        sourceState: {
            async loadWorkspace() {
                return workspace;
            },
            async saveWorkspace(/** @type {SyncWorkspace} */ value) {
                workspace = value;
            },
        },
    });
    const binding = {
        candidateActualSkillDigest: workspace.candidateActualSkillDigest,
        candidateSourceDigest: workspace.candidateSourceDigest,
        channel: 'codex-conversation',
        agentMergeNotesDigest: workspace.agentMergeNotesDigest,
        reviewRevisionId: workspace.reviewRevisionId,
        status: 'approved',
    };

    const incomplete = await module.recordApproval(binding);
    const malformedOptionalEvidence = await module.recordApproval({
        ...binding,
        externalEvidence: 42,
        humanConfirmation: 'Approved after reviewing the exact Candidate and Agent merge notes.',
    });
    const approved = await module.recordApproval({
        ...binding,
        humanConfirmation: 'Approved after reviewing the exact Candidate and Agent merge notes.',
    });

    assert.equal(incomplete.state, 'reviewed');
    assert.deepEqual(incomplete.diagnostics.map(diagnostic => diagnostic.code), ['invalid-approval-attestation']);
    assert.deepEqual(malformedOptionalEvidence.diagnostics.map(diagnostic => diagnostic.code), ['invalid-approval-attestation']);
    assert.equal(approved.state, 'approved');
    if (approved.approvalAttestationId === undefined) assert.fail('Expected approval attestation identifier.');
    assert.equal(approved.approvalAttestationId.length, 64);
    if (workspace.approval === undefined || workspace.approval === null) assert.fail('Expected persisted approval evidence.');
    assert.equal(workspace.approval.humanConfirmation, 'Approved after reviewing the exact Candidate and Agent merge notes.');
});

test('approval and finalize recompute persisted review revision bindings', async () => {
    let workspace = completeWorkspace();
    let promotionPlans = 0;
    const module = createTestUpstreamSyncModule({
        git: {},
        sourceState: {
            async createPromotionPlan() {
                promotionPlans += 1;
                return {recoveryPlanDigest: '9'.repeat(64), targets: []};
            },
            async loadWorkspace() {
                return workspace;
            },
            async preflightPromotion() {
                return {matches: true};
            },
            async saveWorkspace(/** @type {SyncWorkspace} */ value) {
                workspace = value;
            },
        },
    });
    const reviewed = await module.createReviewRevision();
    const tamperedBinding = {
        agentMergeNotesDigest: 'a'.repeat(64),
        candidateActualSkillDigest: reviewed.candidateActualSkillDigest,
        candidateSourceDigest: reviewed.candidateSourceDigest,
        channel: 'codex-conversation',
        humanConfirmation: 'Approve the exact reviewed revision.',
        reviewRevisionId: 'b'.repeat(64),
        status: 'approved',
    };
    workspace.agentMergeNotesDigest = tamperedBinding.agentMergeNotesDigest;
    workspace.reviewRevisionId = tamperedBinding.reviewRevisionId;

    const rejectedApproval = await module.recordApproval(tamperedBinding);

    assert.equal(rejectedApproval.state, 'resolving');
    assert.deepEqual(rejectedApproval.diagnostics.map(item => item.code), ['review-revision-stale']);

    const currentReview = await module.createReviewRevision();
    await module.recordApproval({
        ...tamperedBinding,
        agentMergeNotesDigest: currentReview.agentMergeNotesDigest,
        reviewRevisionId: currentReview.reviewRevisionId,
    });
    if (!workspace.approval) assert.fail('Expected persisted approval evidence.');
    const {approvalAttestationId: discardedApprovalAttestationId, ...approval} = workspace.approval;
    const tamperedApproval = {
        ...approval,
        agentMergeNotesDigest: tamperedBinding.agentMergeNotesDigest,
        reviewRevisionId: tamperedBinding.reviewRevisionId,
    };
    workspace.agentMergeNotesDigest = tamperedApproval.agentMergeNotesDigest;
    workspace.reviewRevisionId = tamperedApproval.reviewRevisionId;
    workspace.approval = {
        ...tamperedApproval,
        approvalAttestationId: createHash('sha256')
            .update(`${JSON.stringify(canonicalizeFixture(tamperedApproval), null, 2)}\n`)
            .digest('hex'),
    };

    const rejectedFinalize = await module.finalize();

    assert.equal(rejectedFinalize.state, 'resolving');
    assert.deepEqual(rejectedFinalize.diagnostics.map(item => item.code), ['review-revision-stale']);
    assert.equal(promotionPlans, 0);
});

test('finalize invalidates approval when candidate source inputs change', async () => {
    let workspace = completeWorkspace({
        base: [],
        candidate: [],
        configurationDigest: 'c'.repeat(64),
        ours: [],
        sourceId: 'engineering-skills',
        state: 'resolving',
        targetCommit: '2'.repeat(40),
        theirs: [],
    });
    let promotions = 0;
    const sourceState = {
        async applyPromotion() {
            promotions += 1;
        },
        async loadWorkspace() {
            return workspace;
        },
        async preflightPromotion() {
            return {matches: true};
        },
        async saveWorkspace(/** @type {SyncWorkspace} */ value) {
            workspace = value;
        },
    };
    const module = createTestUpstreamSyncModule({
        git: {},
        sourceState,
    });
    const approveCurrent = async () => {
        const reviewed = await module.createReviewRevision();
        await module.recordApproval({
            candidateActualSkillDigest: reviewed.candidateActualSkillDigest,
            candidateSourceDigest: reviewed.candidateSourceDigest,
            channel: 'external-review',
            externalEvidence: 'https://review.example.invalid/dual-digest',
            agentMergeNotesDigest: reviewed.agentMergeNotesDigest,
            reviewRevisionId: reviewed.reviewRevisionId,
            status: 'approved',
        });
    };

    await approveCurrent();
    workspace.agentMergeNotes = '# Merge notes\n\nReview explanation changed.\n';
    const sourceStale = await module.finalize();
    workspace.agentMergeNotes = '# Agent merge notes\n\nKept the intended local behavior while applying upstream changes.\n';
    await approveCurrent();
    workspace.sourceRelationship = 'diverged';
    const candidateStale = await module.finalize();

    assert.deepEqual(sourceStale.diagnostics.map(item => item.code), ['review-input-stale']);
    assert.deepEqual(candidateStale.diagnostics.map(item => item.code), ['candidate-source-stale']);
    assert.equal(sourceStale.state, 'resolving');
    assert.equal(candidateStale.state, 'resolving');
    assert.equal(promotions, 0);
});

test('finalize invalidates approval whose persisted digest bindings do not match the workspace', async () => {
    let workspace = completeWorkspace({state: 'approved'});
    workspace.candidateActualSkillDigest = snapshotDigestFixture(workspace.candidate);
    workspace.candidateSourceDigest = candidateSourceDigestFixture(workspace);
    workspace.reviewInputDigest = reviewInputDigestFixture(workspace);
    workspace.agentMergeNotesDigest = 'b'.repeat(64);
    workspace.reviewRevisionId = 'e'.repeat(64);
    workspace.approval = {
        approvalAttestationId: 'a'.repeat(64),
        candidateActualSkillDigest: '1'.repeat(64),
        candidateSourceDigest: workspace.candidateSourceDigest,
        channel: 'external-review',
        externalEvidence: 'https://review.example.invalid/stale-approval',
        agentMergeNotesDigest: workspace.agentMergeNotesDigest,
        reviewRevisionId: workspace.reviewRevisionId,
        status: 'approved',
    };
    let promotionPlans = 0;
    const module = createTestUpstreamSyncModule({
        git: {},
        sourceState: {
            async createPromotionPlan() {
                promotionPlans += 1;
                return {recoveryPlanDigest: '9'.repeat(64), targets: []};
            },
            async loadWorkspace() {
                return workspace;
            },
            async preflightPromotion() {
                return {matches: true};
            },
            async saveWorkspace(/** @type {SyncWorkspace} */ value) {
                workspace = value;
            },
        },
    });

    const finalized = await module.finalize();

    assert.equal(finalized.state, 'resolving');
    assert.equal(finalized.status, 'blocked');
    assert.deepEqual(finalized.diagnostics.map(item => item.code), ['invalid-approval-attestation']);
    assert.equal(workspace.approval, null);
    assert.equal(promotionPlans, 0);
});

test('finalize invalidates approval when the write-time preflight detects drift', async () => {
    let workspace = completeWorkspace();
    let finalizing = false;
    let finalizePreflightCalls = 0;
    let promotions = 0;
    const module = createTestUpstreamSyncModule({
        git: {},
        sourceState: {
            async applyPromotion() {
                promotions += 1;
            },
            async loadWorkspace() {
                return workspace;
            },
            async preflightPromotion() {
                if (!finalizing) return {matches: true};
                finalizePreflightCalls += 1;
                return {matches: finalizePreflightCalls === 1};
            },
            async saveWorkspace(/** @type {SyncWorkspace} */ value) {
                workspace = value;
            },
        },
    });
    const reviewed = await module.createReviewRevision();
    await module.recordApproval({
        candidateActualSkillDigest: reviewed.candidateActualSkillDigest,
        candidateSourceDigest: reviewed.candidateSourceDigest,
        channel: 'external-review',
        externalEvidence: 'https://review.example.invalid/write-time-drift',
        agentMergeNotesDigest: reviewed.agentMergeNotesDigest,
        reviewRevisionId: reviewed.reviewRevisionId,
        status: 'approved',
    });

    finalizing = true;
    const finalized = await module.finalize();

    assert.equal(finalized.state, 'resolving');
    assert.equal(finalized.status, 'blocked');
    assert.deepEqual(finalized.diagnostics.map(item => item.code), ['sync-owned-preflight-failed']);
    assert.equal(workspace.state, 'resolving');
    assert.equal(workspace.approval, null);
    assert.equal(finalizePreflightCalls, 2);
    assert.equal(promotions, 0);
});

test('finalize promotes the approved bytes and waits for the HEAD tree checkpoint', async () => {
    /** @type {SyncWorkspace | null} */
    let workspace = null;
    let headMatches = false;
    let workspaceSaves = 0;
    let malformedPlan = 0;
    /** @type {AppliedPromotion[]} */
    const promotions = [];
    const sourceState = {
        async applyPromotion(/** @type {AppliedPromotion} */ plan) {
            promotions.push(plan);
            return {finalizedEvidence: plan.finalizedEvidence};
        },
        async createPromotionPlan(/** @type {Parameters<typeof promotionPlanFixture>[0]} */ request) {
            if (malformedPlan === 0) {
                return {finalizedEvidence: [], recoveryPlanDigest: '6'.repeat(64), targets: [null], version: 1};
            }
            if (malformedPlan === 1) {
                const plan = promotionPlanFixture(request);
                /** @type {unknown[]} */
                const cyclicEvidence = [];
                cyclicEvidence.push(cyclicEvidence);
                return {...plan, finalizedEvidence: cyclicEvidence};
            }
            return promotionPlanFixture(request);
        },
        async headMatches() {
            return headMatches;
        },
        async loadActualOurs() {
            return {
                entries: [{bytes: Buffer.from('old\n'), mode: '100644', path: 'LICENSE'}],
                ownershipEvidence: {digest: '1'.repeat(64)},
            };
        },
        async loadConfiguration() {
            return validSourceConfiguration();
        },
        async loadWorkspace() {
            return workspace;
        },
        async preflightPromotion() {
            return {matches: true};
        },
        async saveWorkspace(/** @type {SyncWorkspace} */ value) {
            workspaceSaves += 1;
            workspace = value;
        },
    };
    const module = createTestUpstreamSyncModule({
        git: {
            async acquire(/** @type {AcquisitionRequest} */ {commit}) {
                return {
                    entries: [{
                        bytes: Buffer.from(commit === fullCommit ? 'new\n' : 'old\n'),
                        mode: '100644',
                        path: 'LICENSE',
                    }],
                    status: 'succeeded',
                };
            },
            async classifyRelationship() {
                return 'descendant';
            },
        },
        sourceState,
    });

    await module.prepare('engineering-skills', fullCommit);
    requireWorkspace(workspace).agentMergeNotes = '# Merge notes\n\nAccepted the updated license exactly.\n';
    const reviewed = await module.createReviewRevision();
    await module.recordApproval({
        candidateActualSkillDigest: reviewed.candidateActualSkillDigest,
        candidateSourceDigest: reviewed.candidateSourceDigest,
        channel: 'external-review',
        externalEvidence: 'https://review.example.invalid/42',
        agentMergeNotesDigest: reviewed.agentMergeNotesDigest,
        reviewRevisionId: reviewed.reviewRevisionId,
        status: 'approved',
    });
    const invalidPlan = await module.finalize();
    malformedPlan = 1;
    const cyclicPlan = await module.finalize();
    malformedPlan = 2;
    const finalized = await module.finalize();
    const savesAfterFinalize = workspaceSaves;
    const awaiting = await module.status();
    headMatches = true;
    const checkpoint = await module.status();

    assert.equal(invalidPlan.state, 'approved');
    assert.equal(invalidPlan.status, 'failed');
    assert.deepEqual(invalidPlan.diagnostics.map(item => item.code), ['invalid-promotion-plan']);
    assert.equal(cyclicPlan.state, 'approved');
    assert.equal(cyclicPlan.status, 'failed');
    assert.deepEqual(cyclicPlan.diagnostics.map(item => item.code), ['invalid-promotion-plan']);
    assert.equal(finalized.state, 'awaiting-commit');
    assert.equal(finalized.candidateActualSkillDigest, reviewed.candidateActualSkillDigest);
    assert.equal(finalized.candidateSourceDigest, reviewed.candidateSourceDigest);
    assert.equal(awaiting.state, 'awaiting-commit');
    assert.equal(checkpoint.state, 'checkpoint-satisfied');
    assert.equal(workspaceSaves, savesAfterFinalize);
    assert.equal(promotions.length, 1);
    const [promotion] = promotions;
    if (promotion === undefined) assert.fail('Expected one promotion request.');
    assert.equal(promotion.syncRecord.syncRecordId, finalized.syncRecordId);
    assert.deepEqual(promotion.syncRecord.completedCanonicalPaths, [
        'docs/licenses/arw/LICENSE.engineering-skills',
        'upstream/sources/engineering-skills/source.json',
    ]);
    assert.equal(JSON.stringify(promotion.syncRecord).includes('bmV3Cg=='), false);
    const candidates = promotion.candidate;
    if (candidates === undefined) assert.fail('Expected promoted candidate entries.');
    const [candidate] = candidates;
    if (candidate === undefined) assert.fail('Expected promoted candidate entry.');
    assert.equal(candidate.bytes.toString('utf8'), 'new\n');
    assert.equal(promotion.workspace.targetCommit, fullCommit);
    assert.equal('newBase' in promotion, false);
    assert.equal('newOurs' in promotion, false);
});

test('uninspectable recovery permits only status', async () => {
    const workspace = completeWorkspace({
        pendingPromotion: {finalizedEvidence: [], recoveryPlanDigest: '9'.repeat(64), targets: [], version: 1},
        state: 'recovering',
    });
    const module = createTestUpstreamSyncModule({
        git: {},
        sourceState: {
            async inspectRecovery() {
                return {matches: false};
            },
            async loadWorkspace() {
                return workspace;
            },
        },
    });

    const status = await module.status();
    const finalized = await module.finalize();
    const aborted = await module.abort();

    for (const result of [status, finalized, aborted]) {
        assert.equal(result.state, 'recovering');
        assert.equal(result.status, 'blocked');
        assert.deepEqual(result.permittedOperations, ['status']);
        assert.deepEqual(result.diagnostics.map(item => item.code), ['manual-recovery-required']);
    }
});

test('ordinary finalize and abort reject recovery authorization without business writes', async () => {
    const authorization = {
        channel: 'local-cli',
        humanConfirmation: 'Use the current recovery plan.',
        recoveryPlanDigest: '9'.repeat(64),
    };
    let promotionWrites = 0;
    const approvedWorkspace = completeWorkspace({state: 'approved'});
    const finalizeModule = createTestUpstreamSyncModule({
        git: {},
        sourceState: {
            async applyPromotion() {
                promotionWrites += 1;
                return {finalizedEvidence: []};
            },
            async loadWorkspace() {
                return approvedWorkspace;
            },
        },
    });
    let abortWrites = 0;
    const resolvingWorkspace = completeWorkspace({state: 'resolving'});
    const abortModule = createTestUpstreamSyncModule({
        git: {},
        sourceState: {
            async abortWorkspace() {
                abortWrites += 1;
                return {remainingPaths: []};
            },
            async loadWorkspace() {
                return resolvingWorkspace;
            },
        },
    });

    const finalized = await finalizeModule.finalize(authorization);
    const aborted = await abortModule.abort(authorization);

    for (const operation of [finalized, aborted]) {
        assert.equal(operation.status, 'blocked');
        assert.deepEqual(operation.diagnostics.map(item => item.code), ['recovery-authorization-not-permitted']);
    }
    assert.equal(finalized.state, 'approved');
    assert.equal(aborted.state, 'resolving');
    assert.equal(promotionWrites, 0);
    assert.equal(abortWrites, 0);
});

test('recovery requires a closed Human authorization bound to the current plan digest', async () => {
    let recoveryPlanDigest = '9'.repeat(64);
    let workspace = completeWorkspace({
        base: [],
        candidate: [],
        configurationDigest: 'c'.repeat(64),
        ours: [],
        previousCommit: '1'.repeat(40),
        sourceId: 'engineering-skills',
        agentMergeNotesDigest: 'b'.repeat(64),
        reviewRevisionId: 'e'.repeat(64),
        sourceRelationship: 'descendant',
        state: 'resolving',
        targetCommit: '2'.repeat(40),
        textConflicts: [],
        theirs: [],
    });
    let recoveryWrites = 0;
    let automaticRecoveryFails = true;
    /** @type {Array<{bytes?: string, digest?: string, exists: boolean, mode?: string, path: string, syncRecordId?: string}>} */
    let finalizedEvidence = [];
    const sourceState = {
        async applyPromotion() {
            throw new Error('simulated I/O failure');
        },
        async applyRecovery() {
            if (automaticRecoveryFails) {
                automaticRecoveryFails = false;
                throw new Error('simulated restore failure');
            }
            recoveryWrites += 1;
            return {finalizedEvidence};
        },
        async createPromotionPlan(/** @type {Parameters<typeof promotionPlanFixture>[0]} */ request) {
            const plan = promotionPlanFixture(request);
            finalizedEvidence = plan.finalizedEvidence;
            recoveryPlanDigest = plan.recoveryPlanDigest;
            return plan;
        },
        async inspectRecovery() {
            return {matches: true, recoveryPlan: {recoveryPlanDigest, targets: []}};
        },
        async loadWorkspace() {
            return workspace;
        },
        async preflightPromotion() {
            return {matches: true};
        },
        async saveWorkspace(/** @type {SyncWorkspace} */ value) {
            workspace = value;
        },
    };
    const module = createTestUpstreamSyncModule({
        git: {},
        sourceState,
    });

    const reviewed = await module.createReviewRevision();
    await module.recordApproval({
        candidateActualSkillDigest: reviewed.candidateActualSkillDigest,
        candidateSourceDigest: reviewed.candidateSourceDigest,
        channel: 'external-review',
        externalEvidence: 'https://review.example.invalid/recovery',
        agentMergeNotesDigest: reviewed.agentMergeNotesDigest,
        reviewRevisionId: reviewed.reviewRevisionId,
        status: 'approved',
    });
    const failed = await module.finalize();
    const recoveryStatus = await module.status();
    const missingEvidence = await module.finalize({
        channel: 'local-cli',
        recoveryPlanDigest,
    });
    const wrongDigest = await module.finalize({
        channel: 'local-cli',
        humanConfirmation: 'Continue the reviewed promotion.',
        recoveryPlanDigest: '7'.repeat(64),
    });
    const malformedOptionalEvidence = await module.finalize({
        channel: 'local-cli',
        externalEvidence: 42,
        humanConfirmation: 'Continue the reviewed promotion.',
        recoveryPlanDigest,
    });
    const recovered = await module.finalize({
        channel: 'local-cli',
        humanConfirmation: 'Continue the reviewed promotion.',
        recoveryPlanDigest,
    });

    assert.equal(failed.state, 'recovering');
    assert.equal(failed.status, 'failed');
    assert.equal(workspace.state, 'awaiting-commit');
    if (recoveryStatus.recoveryPlan === undefined) assert.fail('Expected recovery plan.');
    assert.equal(recoveryStatus.recoveryPlan.recoveryPlanDigest, recoveryPlanDigest);
    assert.equal(recoveryStatus.status, 'succeeded');
    assert.deepEqual(recoveryStatus.permittedOperations, ['abort', 'finalize', 'status']);
    assert.deepEqual(missingEvidence.diagnostics.map(item => item.code), ['invalid-recovery-authorization']);
    assert.equal(missingEvidence.status, 'blocked');
    assert.deepEqual(missingEvidence.permittedOperations, ['abort', 'finalize', 'status']);
    assert.deepEqual(wrongDigest.diagnostics.map(item => item.code), ['invalid-recovery-authorization']);
    assert.deepEqual(malformedOptionalEvidence.diagnostics.map(item => item.code), ['invalid-recovery-authorization']);
    assert.equal(recovered.state, 'awaiting-commit');
    assert.equal(recovered.candidateActualSkillDigest, reviewed.candidateActualSkillDigest);
    assert.equal(recovered.candidateSourceDigest, reviewed.candidateSourceDigest);
    assert.equal(recoveryWrites, 1);
});

test('live promotion failure before any target change skips recovery writes and returns to approved', async () => {
    let workspace = completeWorkspace({
        base: [],
        candidate: [],
        configurationDigest: 'c'.repeat(64),
        ours: [],
        previousCommit: '1'.repeat(40),
        sourceId: 'engineering-skills',
        sourceRelationship: 'descendant',
        state: 'resolving',
        targetCommit: '2'.repeat(40),
        textConflicts: [],
        theirs: [],
    });
    let recoveryPlanDigest = '9'.repeat(64);
    const target = {
        index: null,
        path: '.agents/skills/example/SKILL.md',
        post: {
            bytes: Buffer.from('post\n').toString('base64'),
            digest: createHash('sha256').update('post\n').digest('hex'),
            exists: /** @type {true} */ (true),
            mode: '100644',
        },
        pre: {exists: /** @type {false} */ (false)},
    };
    let recoveryWrites = 0;
    let promotionTargets = [target];
    const module = createTestUpstreamSyncModule({
        git: {},
        sourceState: {
            async applyPromotion() {
                throw new Error('simulated live failure before write');
            },
            async applyRecovery() {
                recoveryWrites += 1;
                return {finalizedEvidence: []};
            },
            async createPromotionPlan(/** @type {Parameters<typeof promotionPlanFixture>[0]} */ request) {
                const plan = promotionPlanFixture(request, [target]);
                recoveryPlanDigest = plan.recoveryPlanDigest;
                promotionTargets = plan.targets;
                return plan;
            },
            async inspectRecovery() {
                return {
                    matches: true,
                    recoveryPlan: {
                        recoveryPlanDigest,
                        states: promotionTargets.map(entry => ({path: entry.path, state: 'pre-image'})),
                        version: 1,
                    },
                };
            },
            async loadWorkspace() {
                return workspace;
            },
            async preflightPromotion() {
                return {matches: true};
            },
            async saveWorkspace(/** @type {SyncWorkspace} */ value) {
                workspace = value;
            },
        },
    });

    const reviewed = await module.createReviewRevision();
    await module.recordApproval({
        candidateActualSkillDigest: reviewed.candidateActualSkillDigest,
        candidateSourceDigest: reviewed.candidateSourceDigest,
        channel: 'external-review',
        externalEvidence: 'https://review.example.invalid/pre-write-failure',
        agentMergeNotesDigest: reviewed.agentMergeNotesDigest,
        reviewRevisionId: reviewed.reviewRevisionId,
        status: 'approved',
    });
    const approvalAttestationId = workspace.approval?.approvalAttestationId;
    const finalized = await module.finalize();

    assert.equal(finalized.state, 'approved');
    assert.equal(finalized.status, 'failed');
    assert.deepEqual(finalized.diagnostics.map(item => item.code), ['promotion-recovered']);
    assert.deepEqual(finalized.completedOperations, []);
    assert.deepEqual(finalized.rollback, []);
    assert.equal(finalized.stage, 'promotion-apply');
    assert.equal(recoveryWrites, 0);
    assert.equal(workspace.approval?.approvalAttestationId, approvalAttestationId);
    assert.equal(workspace.reviewRevisionId, reviewed.reviewRevisionId);
    assert.equal(workspace.pendingPromotion, null);
});

test('live promotion failure restores pre-images and returns to approved', async () => {
    let workspace = completeWorkspace({
        base: [],
        candidate: [],
        configurationDigest: 'c'.repeat(64),
        ours: [],
        previousCommit: '1'.repeat(40),
        sourceId: 'engineering-skills',
        sourceRelationship: 'descendant',
        state: 'resolving',
        targetCommit: '2'.repeat(40),
        textConflicts: [],
        theirs: [],
    });
    let recoveryPlanDigest = '9'.repeat(64);
    const target = {
        index: null,
        path: '.agents/skills/example/SKILL.md',
        post: {
            bytes: Buffer.from('post\n').toString('base64'),
            digest: createHash('sha256').update('post\n').digest('hex'),
            exists: /** @type {true} */ (true),
            mode: '100644',
        },
        pre: {exists: /** @type {false} */ (false)},
    };
    let restored = false;
    let restoredDirection;
    const module = createTestUpstreamSyncModule({
        git: {},
        sourceState: {
            async applyPromotion() {
                throw new Error('simulated live failure');
            },
            async applyRecovery(
                /** @type {SyncWorkspace} */ _workspace,
                /** @type {'abort' | 'finalize'} */ direction,
            ) {
                restoredDirection = direction;
                restored = true;
                return {finalizedEvidence: []};
            },
            async createPromotionPlan(/** @type {Parameters<typeof promotionPlanFixture>[0]} */ request) {
                const plan = promotionPlanFixture(request, [target]);
                recoveryPlanDigest = plan.recoveryPlanDigest;
                return plan;
            },
            async inspectRecovery() {
                return {
                    matches: true,
                    recoveryPlan: {
                        recoveryPlanDigest,
                        states: [{path: target.path, state: restored ? 'pre-image' : 'post-image'}],
                        version: 1,
                    },
                };
            },
            async loadWorkspace() {
                return workspace;
            },
            async preflightPromotion() {
                return {matches: true};
            },
            async saveWorkspace(/** @type {SyncWorkspace} */ value) {
                workspace = value;
            },
        },
    });

    const reviewed = await module.createReviewRevision();
    await module.recordApproval({
        candidateActualSkillDigest: reviewed.candidateActualSkillDigest,
        candidateSourceDigest: reviewed.candidateSourceDigest,
        channel: 'external-review',
        externalEvidence: 'https://review.example.invalid/live-failure',
        agentMergeNotesDigest: reviewed.agentMergeNotesDigest,
        reviewRevisionId: reviewed.reviewRevisionId,
        status: 'approved',
    });
    const finalized = await module.finalize();

    assert.equal(finalized.state, 'approved');
    assert.equal(finalized.status, 'failed');
    assert.deepEqual(finalized.diagnostics.map(item => item.code), ['promotion-recovered']);
    assert.deepEqual(finalized.completedOperations, [{kind: 'create', path: target.path}]);
    assert.deepEqual(finalized.rollback, [{path: target.path, status: 'restored'}]);
    assert.equal(finalized.stage, 'promotion-apply');
    assert.equal(restoredDirection, 'abort');
    assert.equal(workspace.pendingPromotion, null);
});

test('abort retries disposable cleanup forward and never clears approved or awaiting-commit evidence', async () => {
    /** @type {{state: string} | null} */
    let workspace = {state: 'resolving'};
    let attempts = 0;
    const sourceState = {
        async abortWorkspace() {
            attempts += 1;
            return attempts === 1 ? {remainingPaths: ['workspace/candidate']} : {remainingPaths: []};
        },
        async deleteWorkspace() {
            workspace = null;
        },
        async loadWorkspace() {
            return workspace;
        },
        /**
         * @param {{ state: string; }} value
         */
        async saveWorkspace(value) {
            workspace = value;
        },
    };
    const module = createTestUpstreamSyncModule({git: {}, sourceState});

    const partial = await module.abort();
    const partialStatus = await module.status();
    const completed = await module.abort();
    workspace = {state: 'approved'};
    const approvedBlocked = await module.abort();
    workspace = {state: 'awaiting-commit'};
    const blocked = await module.abort();

    assert.equal(partial.state, 'recovering');
    assert.equal(partial.status, 'failed');
    assert.deepEqual(partial.remainingPaths, ['workspace/candidate']);
    assert.deepEqual(partial.permittedOperations, ['abort', 'status']);
    assert.deepEqual(partialStatus.permittedOperations, ['abort', 'status']);
    assert.equal(completed.state, 'idle');
    assert.equal(approvedBlocked.state, 'approved');
    assert.deepEqual(approvedBlocked.diagnostics.map(diagnostic => diagnostic.code), ['abort-not-permitted']);
    assert.equal(blocked.state, 'awaiting-commit');
    assert.deepEqual(blocked.diagnostics.map(diagnostic => diagnostic.code), ['abort-not-permitted']);
    assert.equal(attempts, 2);
});

test('abort preserves structured recovery and cleanup evidence after I/O failures', async () => {
    const target = {
        index: null,
        path: '.agents/skills/example/SKILL.md',
        post: {
            bytes: Buffer.from('post\n').toString('base64'),
            digest: createHash('sha256').update('post\n').digest('hex'),
            exists: /** @type {true} */ (true),
            mode: '100644',
        },
        pre: {exists: /** @type {false} */ (false)},
    };
    const recoveryPlanDigest = '9'.repeat(64);
    const recovering = completeWorkspace({
        pendingPromotion: {finalizedEvidence: [], recoveryPlanDigest, targets: [target], version: 1},
        state: 'recovering',
    });
    const recoveryModule = createTestUpstreamSyncModule({
        git: {},
        sourceState: {
            async applyRecovery() {
                throw new Error('simulated recovery failure');
            },
            async inspectRecovery() {
                return {
                    matches: true,
                    recoveryPlan: {
                        recoveryPlanDigest,
                        states: [{path: target.path, state: 'post-image'}],
                        version: 1,
                    },
                };
            },
            async loadWorkspace() {
                return recovering;
            },
        },
    });
    const recoveryFailure = await recoveryModule.abort({
        channel: 'local-cli',
        humanConfirmation: 'Restore the reviewed promotion.',
        recoveryPlanDigest,
    });

    assert.equal(recoveryFailure.stage, 'recovery-abort');
    assert.deepEqual(recoveryFailure.completedOperations, [{kind: 'create', path: target.path}]);
    assert.deepEqual(recoveryFailure.rollback, [{path: target.path, status: 'failed'}]);
    assert.deepEqual(recoveryFailure.permittedOperations, ['abort', 'finalize', 'status']);

    const cleanupWorkspace = completeWorkspace({
        ownedWorkspacePaths: ['candidate/SKILL.md'],
        state: 'resolving',
    });
    const cleanupModule = createTestUpstreamSyncModule({
        git: {},
        sourceState: {
            async abortWorkspace() {
                throw new Error('simulated cleanup failure');
            },
            async loadWorkspace() {
                return cleanupWorkspace;
            },
        },
    });
    const cleanupFailure = await cleanupModule.abort();

    assert.equal(cleanupFailure.stage, 'abort-cleanup');
    assert.deepEqual(cleanupFailure.remainingPaths, ['candidate/SKILL.md']);
    assert.deepEqual(cleanupFailure.permittedOperations, ['abort', 'status']);
});
