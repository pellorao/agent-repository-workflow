import assert from 'node:assert/strict';
import {test} from 'node:test';

import {replaceReviewedRoles} from '../../lib/reviewer-benchmark/replace-reviewed-roles.mjs';

/** @type {Record<string,any>} */
const observation = {reviewerId: 'spec-readiness-reviewer', repetition: 1};
const role = (/** @type {number} */ score) => ({reviewerId: 'spec-readiness-reviewer', repetitions: [1, 2, 3].map(
    repetition => ({repetition, score, scoreSource: 'formal', diagnosticReason: /** @type {string|null} */ (null),
        mainAgentCorrectedScoringCopy: false, completedInstances: 1,
        expectedInstances: 1, deliveryErrors: []}))});
const entry = (/** @type {number} */ score) => ({schemaVersion: 4,
    configuration: {model: 'gpt-6-luna', reasoningEffort: 'low'},
    observations: [observation], roles: [role(score)]});

test('replaces only reviewed role score and preserves observations', () => {
    const current = [entry(0.2)];
    const output = replaceReviewedRoles(current, [entry(0.4)]);
    assert.deepEqual(output.statistics[0].roles[0].repetitions.map(item => item.score), [0.4, 0.4, 0.4]);
    assert.deepEqual(output.statistics[0].observations, current[0].observations);
    assert.equal(current[0].roles[0].repetitions[0].score, 0.2);
    assert.deepEqual(output.replaced, [{model: 'gpt-6-luna', reasoningEffort: 'low',
        reviewerId: 'spec-readiness-reviewer', before: [0.2, 0.2, 0.2], after: [0.4, 0.4, 0.4]}]);
});

test('rejects changed observations and duplicate role updates', () => {
    const changed = entry(0.4);
    changed.observations = [{...observation, repetition: 2}];
    assert.throws(() => replaceReviewedRoles([entry(0.2)], [changed]), /observations changed/u);
    assert.throws(() => replaceReviewedRoles([entry(0.2)], [entry(0.4), entry(0.5)]),
        /Duplicate or missing/u);
});

test('updates scoring provenance while retaining collected observations and repetition counts', () => {
    const current = [entry(0.2)];
    current[0].observations[0] = {...observation,
        runtime: {durationMs: 12}, delivery: {mode: 'qwen-final-reply', mainAgentCorrectedScoringCopy: true}};
    current[0].roles[0].repetitions[0].mainAgentCorrectedScoringCopy = true;
    const update = structuredClone(current[0]);
    update.observations[0].delivery.mainAgentCorrectedScoringCopy = false;
    update.roles[0].repetitions[0].mainAgentCorrectedScoringCopy = false;
    update.roles[0].repetitions[0].scoreSource = 'diagnostic';
    update.roles[0].repetitions[0].diagnosticReason = 'report-format-correction';
    update.roles[0].repetitions[0].score = 0.4;
    const result = replaceReviewedRoles(current, [update]);
    assert.deepEqual(result.statistics[0].observations, update.observations);
    assert.deepEqual(result.statistics[0].roles[0], update.roles[0]);
    assert.equal(current[0].observations[0].delivery.mainAgentCorrectedScoringCopy, true);
    const invalid = structuredClone(update);
    invalid.observations[0].runtime.durationMs = 13;
    assert.throws(() => replaceReviewedRoles(current, [invalid]), /observations changed/u);
});
