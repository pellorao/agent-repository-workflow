import assert from 'node:assert/strict';
import test from 'node:test';

import {combineAvailableIndependentScores, combineIndependentScores,
    finalizeIndependentScores, scoreDivergence} from '../../lib/reviewer-benchmark/recheck-statistics.mjs';

const configuration = {model: 'gpt-example', reasoningEffort: 'low'};
const entry = (/** @type {string} */ reviewerId, /** @type {number[]} */ scores) => ({schemaVersion: 4, configuration,
    observations: [{reviewerId, repetition: 1, runtime: {durationMs: 10}}],
    roles: [{reviewerId, repetitions: scores.map((score, index) => ({repetition: index + 1,
        score, scoreSource: 'formal', diagnosticReason: /** @type {string|null} */ (null),
        mainAgentCorrectedScoringCopy: false, completedInstances: 1,
        expectedInstances: 1, deliveryErrors: []}))}]});













test('Main Agent replaces only disputed repetition scores', () => {
    const first = [entry('a', [0.4, 0.5, 0.6]), entry('b', [0.2, 0.8, 0.5])];
    const second = [entry('a', [0.42, 0.53, 0.63]), entry('b', [0.3, 0.7, 0.5])];
    const reviewed = [entry('b', [0.25, 0.75, 0.9])];
    const final = finalizeIndependentScores(first, second, reviewed);
    assert.deepEqual(final.map(item => item.roles[0].reviewerId), ['a', 'b']);
    assert.deepEqual(final[1].roles[0].repetitions.map(item => item.score), [0.25, 0.75, 0.5]);
    assert.throws(() => finalizeIndependentScores(first, second, []), /exactly the disputed roles/u);
    assert.throws(() => finalizeIndependentScores(first, second, [entry('a', [0, 0, 0])]),
        /exactly the disputed roles/u);
});

test('different collected facts cannot be averaged as if they were the same run', () => {
    const first = [entry('a', [0.4, 0.5, 0.6])];
    const second = [entry('a', [0.42, 0.52, 0.62])];
    second[0].observations[0].runtime.durationMs = 11;
    assert.throws(() => combineIndependentScores(first, second), /observations differ/u);
    second[0].observations[0].runtime.durationMs = 10;
    second[0].roles[0].repetitions[0].diagnosticReason = 'changed';
    assert.throws(() => combineIndependentScores(first, second), /repetition facts differ/u);
});
