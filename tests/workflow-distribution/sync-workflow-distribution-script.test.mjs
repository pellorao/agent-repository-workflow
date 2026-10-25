import assert from 'node:assert/strict';

import {join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
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
/** @typedef {{additionalSkillReferences: unknown, confirmHashes?: ReviewHashes, emitHash?: (hash: string) => unknown, reviewEditor?: {args: string[], command: string}, skillReferenceNormalizations: unknown, workspaceDirectory: string}} TestReviewInput */

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
            configurationLoader: async () => ({reviewEditor: {args: ['--wait', '{file}'], command: 'code'}}),
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

test('sync CLI carries an explicit review confirmation through prepare and digest-bound apply', async t => {
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
            if (input.confirmHashes === undefined) {
                if (input.emitHash === undefined) throw new Error('Expected review hash emitter.');
                input.emitHash(completedReview.additionalSkillReferencesHash);
                input.emitHash(completedReview.skillReferenceNormalizationsHash);
                return blockedReview('review-confirmation-required', 'Confirm unchanged files.');
            }
            return completedReview;
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

    assert.equal(await runWorkflowDistributionSyncCli(['review'], dependencies), 1);
    assert.match(harness.stdout.join(''), /additionalSkillReferencesHash/u);
    assert.match(harness.stdout.join(''), new RegExp(completedReview.additionalSkillReferencesHash, 'u'));
    assert.equal(preparedReviews.length, 0);

    harness.stderr.length = 0;
    harness.stdout.length = 0;
    assert.equal(await runWorkflowDistributionSyncCli([
        'review',
        '--confirm',
        completedReview.additionalSkillReferencesHash,
        completedReview.skillReferenceNormalizationsHash,
    ], dependencies), 0);
    assert.equal(reviewCalls[1]?.reviewEditor, undefined);
    assert.deepEqual(reviewCalls[1]?.confirmHashes, {
        additionalSkillReferencesHash: completedReview.additionalSkillReferencesHash,
        skillReferenceNormalizationsHash: completedReview.skillReferenceNormalizationsHash,
    });

    harness.stdout.length = 0;
    assert.equal(await runWorkflowDistributionSyncCli(['prepare'], dependencies), 0);
    assert.match(harness.stdout.join(''), new RegExp(plan.planDigest, 'u'));
    assert.equal(harness.stdout.join('').includes(renderWorkflowDistributionSyncPlan(plan)), true);
    assert.deepEqual(JSON.parse(renderWorkflowDistributionSyncPlan(plan)), {planDigest: plan.planDigest});
    assert.equal(applied.length, 0);

    harness.stdout.length = 0;
    assert.equal(await runWorkflowDistributionSyncCli([
        'apply',
        '--plan-digest',
        plan.planDigest,
    ], dependencies), 0);
    assert.deepEqual(applied, [{
        authorization: {approved: true, planDigest: plan.planDigest},
        plan,
    }]);
    assert.equal(preparedReviews.length, 2);
    assert.equal(preparedReviews.every(value => value === completedReview), true);
    assert.equal(reviewCalls.length, 4);
    assert.equal(new Set(reviewCalls.map(call => call.workspaceDirectory)).size, 1);
    assert.match(reviewCalls[0]?.workspaceDirectory ?? '', /[\\/]\.tmp[\\/]codex[\\/]sync-test[\\/]_workflow-distribution-sync$/u);
});

test('sync CLI saves a completed first review without requiring confirmation', async t => {
    const harness = await createHarness(t);
    let prepared = false;
    const dependencies = {
        ...harness.dependencies,
        review: async (/** @type {TestReviewInput} */ input) => {
            if (input.confirmHashes === undefined) {
                if (input.emitHash === undefined) throw new Error('Expected review hash emitter.');
                input.emitHash(completedReview.additionalSkillReferencesHash);
                input.emitHash(completedReview.skillReferenceNormalizationsHash);
            }
            return completedReview;
        },
        syncPrepare: async (/** @type {Parameters<typeof prepareWorkflowDistributionSync>[0]} */ {review}) => {
            assert.deepEqual(review, completedReview);
            prepared = true;
            return plan;
        },
        syncReview: async () => analysis,
    };

    assert.equal(await runWorkflowDistributionSyncCli(['review'], dependencies), 0);
    assert.equal(await runWorkflowDistributionSyncCli(['prepare'], dependencies), 0);
    assert.equal(prepared, true);
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
        review: (/** @type {Parameters<typeof reviewSkillReferences>[0]} */ input) => reviewSkillReferences({...input, launchEditor: async () => {}}),
        syncPrepare: async (/** @type {Parameters<typeof prepareWorkflowDistributionSync>[0]} */ {review}) => {
            assert.deepEqual(review.additionalSkillReferences, []);
            assert.deepEqual(review.skillReferenceNormalizations, []);
            prepared += 1;
            return plan;
        },
        syncReview: async () => emptyAnalysis,
    };

    assert.equal(await runWorkflowDistributionSyncCli(['review'], dependencies), 0);
    assert.equal(await runWorkflowDistributionSyncCli(['prepare'], dependencies), 0);
    assert.equal(await runWorkflowDistributionSyncCli(['review'], dependencies), 0);
    assert.equal(await runWorkflowDistributionSyncCli(['prepare'], dependencies), 0);
    assert.equal(prepared, 2);
});

test('sync CLI separates usage errors and missing or changed review handoffs from writes', async t => {
    const harness = await createHarness(t);
    let inspectedIdentity = false;
    assert.equal(await runWorkflowDistributionSyncCli(['review', '--confirm', 'invalid'], {
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
    assert.equal(await runWorkflowDistributionSyncCli(['review'], changedDependencies), 0);
    prepared = false;
    assert.equal(await runWorkflowDistributionSyncCli(['prepare'], changedDependencies), 1);
    assert.equal(prepared, false);
    assert.match(harness.stderr.join(''), /review-input-changed/u);
});

test('sync CLI stops before review when the natural Engine configuration has no reviewEditor', async t => {
    const harness = await createHarness(t);
    let reviewed = false;
    const result = await runWorkflowDistributionSyncCli(['review'], {
        ...harness.dependencies,
        configurationLoader: async () => ({editor: {args: ['{file}'], command: 'code'}}),
        review: async () => {
            reviewed = true;
            return completedReview;
        },
        syncReview: async () => analysis,
    });

    assert.equal(result, 1);
    assert.equal(reviewed, false);
    assert.match(harness.stderr.join(''), /review-editor-unavailable/u);
});
