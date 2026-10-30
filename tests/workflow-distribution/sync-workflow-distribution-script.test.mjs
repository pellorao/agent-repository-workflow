import assert from 'node:assert/strict';

import {join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {createScopedFilesystem} from '../../lib/common/filesystem.mjs';
import {
    renderWorkflowDistributionSyncPlan,
    runWorkflowDistributionSyncCli,
} from '../../scripts/sync-workflow-distribution.mjs';
import {reviewSkillReferences} from '../../lib/workflow-distribution/skill-reference-review.mjs';
import {
    applyWorkflowDistributionSync,
    prepareWorkflowDistributionSync,
} from '../../lib/workflow-distribution/workflow-distribution-sync.mjs';

/** @typedef {{additionalSkillReferencesHash: string, skillReferenceNormalizationsHash: string}} ReviewHashes */
/** @typedef {{column: number, context?: string, identity: string, line: number, path: string}} SkillNormalization */
/** @typedef {{additionalSkillReferences: unknown, complete?: boolean, confirmHashes?: ReviewHashes, skillReferenceNormalizations: unknown, workspaceDirectory: string}} TestReviewInput */

const identityAdapter = {
    getCurrentAgentIdentity: () => ({platform: 'codex', sessionId: 'sync-test'}),
};

/** @type {{additionalSkillReferences: string[], diagnostics: never[], skillReferenceNormalizations: never[], status: 'succeeded'}} */
const analysis = {
    additionalSkillReferences: ['external'],
    diagnostics: [],
    skillReferenceNormalizations: [],
    status: 'succeeded',
};

/** @type {{additionalSkillReferences: string[], additionalSkillReferencesHash: string, skillReferenceNormalizations: SkillNormalization[], skillReferenceNormalizationsHash: string, status: 'succeeded'}} */
const completedReview = {
    additionalSkillReferences: ['external'],
    additionalSkillReferencesHash: 'a'.repeat(64),
    skillReferenceNormalizations: [],
    skillReferenceNormalizationsHash: 'b'.repeat(64),
    status: 'succeeded',
};

/** @type {{diagnostics: never[], planDigest: string, status: 'succeeded'}} */
const plan = {
    diagnostics: [],
    planDigest: 'c'.repeat(64),
    status: 'succeeded',
};

/** @returns {{diagnostics: Array<{code: string, message: string}>, status: 'blocked'}} */
const blockedReview = (/** @type {string} */ code, /** @type {string} */ message) => ({
    diagnostics: [{code, message}],
    status: 'blocked',
});

const createHarness = async (/** @type {test.TestContext} */ t) => {
    const repositoryRoot = await createTemporaryDirectory(t, 'arw-sync-cli-');
    /** @type {string[]} */
    const stderr = [];
    /** @type {string[]} */
    const stdout = [];
    return {
        dependencies: {
            platformAdapter: identityAdapter,
            repositoryRoot,
            stderr: (/** @type {string} */ value) => stderr.push(value),
            stdout: (/** @type {string} */ value) => stdout.push(value),
        },
        repositoryRoot,
        stderr,
        stdout,
    };
};

test('sync CLI carries review completion through prepare and digest-bound apply', async t => {
    const harness = await createHarness(t);
    /** @type {TestReviewInput[]} */
    const reviewCalls = [];
    /** @type {(typeof completedReview)[]} */
    const preparedReviews = [];
    /** @type {{authorization: {approved: boolean, planDigest: string}, plan: typeof plan}[]} */
    const applied = [];
    const dependencies = {
        ...harness.dependencies,
        review: async (/** @type {TestReviewInput} */ input) => {
            reviewCalls.push(input);
            return input.complete === false ? {diagnostics: [], paths: ['/w/a.txt', '/w/n.jsonl'], status: /** @type {const} */ ('succeeded')} : completedReview;
        },
        syncApply: async (/** @type {Parameters<typeof applyWorkflowDistributionSync>[0]} */ {authorization, plan: authorizedPlan}) => {
            if (authorization === null || authorization.approved !== true
                || typeof authorization.planDigest !== 'string' || authorizedPlan === null) {
                assert.fail('Expected a complete authorized sync plan.');
            }
            applied.push({
                authorization: {approved: authorization.approved, planDigest: authorization.planDigest},
                plan: {diagnostics: [], planDigest: authorizedPlan.planDigest, status: 'succeeded'},
            });
            /** @type {Awaited<ReturnType<typeof applyWorkflowDistributionSync>>} */
            const result = {diagnostics: [], status: 'succeeded'};
            return result;
        },
        syncPrepare: async (/** @type {Parameters<typeof prepareWorkflowDistributionSync>[0]} */ {review}) => {
            preparedReviews.push(review);
            return plan;
        },
        syncReview: async () => analysis,
    };

    assert.equal(await runWorkflowDistributionSyncCli(['review'], dependencies), 0);
    assert.match(harness.stdout.join(''), /^\/w\/a\.txt\n\/w\/n\.jsonl\n/u);
    assert.equal(preparedReviews.length, 0);

    harness.stdout.length = 0;
    assert.equal(await runWorkflowDistributionSyncCli(['review', '--complete'], dependencies), 0);
    assert.match(harness.stdout.join(''), new RegExp(`^${completedReview.additionalSkillReferencesHash}\\n${completedReview.skillReferenceNormalizationsHash}\\n`, 'u'));

    harness.stdout.length = 0;
    assert.equal(await runWorkflowDistributionSyncCli(['prepare'], dependencies), 0);
    assert.equal(harness.stdout.join('').includes(renderWorkflowDistributionSyncPlan(plan)), true);
    assert.deepEqual(JSON.parse(renderWorkflowDistributionSyncPlan(plan)), {planDigest: plan.planDigest});
    assert.equal(applied.length, 0);

    assert.equal(await runWorkflowDistributionSyncCli(['apply', '--plan-digest', plan.planDigest], dependencies), 0);
    assert.deepEqual(applied, [{authorization: {approved: true, planDigest: plan.planDigest}, plan}]);
    assert.equal(preparedReviews.length, 2);
    assert.equal(preparedReviews.every(value => value === completedReview), true);
    assert.equal(reviewCalls.length, 4);
    assert.equal(new Set(reviewCalls.map(call => call.workspaceDirectory)).size, 1);
    assert.match(reviewCalls[0]?.workspaceDirectory ?? '', /[\\/]\.tmp[\\/]codex[\\/]sync-test[\\/]_workflow-distribution-sync$/u);
});

test('sync CLI reuses its fixed workspace through the production review files', async t => {
    const harness = await createHarness(t);
    /** @type {{additionalSkillReferences: string[], diagnostics: never[], skillReferenceNormalizations: SkillNormalization[], status: 'succeeded'}} */
    const emptyAnalysis = {
        additionalSkillReferences: [],
        diagnostics: [],
        skillReferenceNormalizations: [],
        status: 'succeeded',
    };
    let prepared = 0;
    const dependencies = {
        ...harness.dependencies,
        review: reviewSkillReferences,
        syncPrepare: async (/** @type {Parameters<typeof prepareWorkflowDistributionSync>[0]} */ {review}) => {
            assert.deepEqual(review.additionalSkillReferences, []);
            assert.deepEqual(review.skillReferenceNormalizations, []);
            prepared += 1;
            return plan;
        },
        syncReview: async () => emptyAnalysis,
    };

    for (let round = 0; round < 2; round += 1) {
        assert.equal(await runWorkflowDistributionSyncCli(['review'], dependencies), 0);
        assert.equal(await runWorkflowDistributionSyncCli(['review', '--complete'], dependencies), 0);
        assert.equal(await runWorkflowDistributionSyncCli(['prepare'], dependencies), 0);
    }
    assert.equal(prepared, 2);
});

test('sync CLI separates usage errors and missing or changed review handoffs from writes', async t => {
    const harness = await createHarness(t);
    let inspectedIdentity = false;
    assert.equal(await runWorkflowDistributionSyncCli(['review', '--confirm', 'a'.repeat(64), 'b'.repeat(64)], {
        ...harness.dependencies,
        platformAdapter: {
            getCurrentAgentIdentity() {
                inspectedIdentity = true;
                return identityAdapter.getCurrentAgentIdentity();
            },
        },
    }), 2);
    assert.equal(inspectedIdentity, false);
    assert.match(harness.stderr.join(''), /^Usage:/u);

    harness.stderr.length = 0;
    let prepared = false;
    const missingDependencies = {
        ...harness.dependencies,
        syncPrepare: async () => {
            prepared = true;
            return plan;
        },
    };
    assert.equal(await runWorkflowDistributionSyncCli(['prepare'], missingDependencies), 1);
    assert.equal(prepared, false);
    assert.match(harness.stderr.join(''), /sync-review-handoff-unavailable/u);

    harness.stderr.length = 0;
    const changedDependencies = {
        ...harness.dependencies,
        review: async (/** @type {TestReviewInput} */ input) => input.confirmHashes === undefined
            ? completedReview
            : blockedReview('review-input-changed', 'Reviewed bytes changed.'),
        syncPrepare: async () => {
            prepared = true;
            return plan;
        },
        syncReview: async () => analysis,
    };
    assert.equal(await runWorkflowDistributionSyncCli(['review', '--complete'], changedDependencies), 0);
    prepared = false;
    assert.equal(await runWorkflowDistributionSyncCli(['prepare'], changedDependencies), 1);
    assert.equal(prepared, false);
    assert.match(harness.stderr.join(''), /review-input-changed/u);
});

test('sync CLI fails without printing hashes when completed-review.json cannot be written', async t => {
    const harness = await createHarness(t);
    const dependencies = {
        ...harness.dependencies,
        createFilesystem: async (/** @type {Parameters<typeof createScopedFilesystem>[0]} */ input) => {
            const created = await createScopedFilesystem(input);
            if (created.status !== 'succeeded') return created;
            const {scopedFilesystem} = created;
            return {
                ...created,
                scopedFilesystem: {
                    ...scopedFilesystem,
                    write: async (/** @type {Parameters<typeof scopedFilesystem.write>[0]} */ write) => write.path === 'completed-review.json'
                        ? {diagnostics: [{code: 'disk-full', message: 'No space.'}], stage: 'write', status: /** @type {const} */ ('failed')}
                        : scopedFilesystem.write(write),
                },
            };
        },
        review: reviewSkillReferences,
        syncReview: async () => analysis,
    };
    assert.equal(await runWorkflowDistributionSyncCli(['review'], dependencies), 0);
    harness.stdout.length = 0;
    assert.equal(await runWorkflowDistributionSyncCli(['review', '--complete'], dependencies), 1);
    assert.match(harness.stderr.join(''), /disk-full/u);
    assert.equal(harness.stdout.join(''), '');
});
