import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {cellStatistics, summaryMarkdown, tQuantile, tTwoSidedP} from '../../lib/reviewer-capability/statistics.mjs';
import {normalizedFinding, sequenceMatcherRatio, templateFindings} from '../../lib/reviewer-capability/templates.mjs';

// Golden values: the outputs of qwen_strata's pure functions (t_quantile, statistics, difflib, template_findings), saved once.
const golden = JSON.parse(await readFile(join(import.meta.dirname, '..', 'fixtures', 'reviewer-capability', 'qwen-golden.json'), 'utf8'));
const close = (/** @type {number | null} */ actual, /** @type {number | null} */ expected) => {
    if (expected === null) assert.equal(actual, null);
    else assert.ok(Math.abs(/** @type {number} */ (actual) - expected) <= 1e-9 * Math.abs(expected), `${actual} vs ${expected}`);
};

test('the t quantile and the two-sided p match the golden values', () => {
    for (const [df, expected] of golden.tQuantile) close(tQuantile(0.975, df), expected);
    for (const [t, df, expected] of golden.tTwoSidedP) close(tTwoSidedP(t, df), expected);
});

test('cell statistics match the golden values, one instance has no spread', () => {
    for (const {scores, ...expected} of golden.statistics) {
        const actual = cellStatistics(scores.map((/** @type {number} */ final) => ({f: 0, final, rawScore: 0, rRepairable: 0, scoreR83: 0})));
        for (const field of ['mean', 'sd', 'se', 'min', 'median']) close(actual[/** @type {'mean'} */ (field)], expected[field]);
        assert.equal(actual.nNegative, expected.nNegative);
        if (expected.ci95 === null) assert.equal(actual.ci95, null);
        else expected.ci95.forEach((/** @type {number} */ value, /** @type {number} */ index) => close(/** @type {number[]} */ (actual.ci95)[index], value));
    }
});

test('the markdown tables are flush left with 未知 for missing values', () => {
    const cell = {cell: 'a', n: 1, ...cellStatistics([{f: 0.1, final: 0.5, rawScore: 0.6, rRepairable: 2, scoreR83: 0.5}])};
    const markdown = summaryMarkdown([cell], [{cell: 'a', f: 0.1, final: 0.5, id: 'x.json', main: true, modelFailure: null, paused: false, rawScore: 0.6, rRepairable: 2, scoreR83: 0.5}]);
    assert.ok(markdown.split('\n').every(line => line === '' || line.startsWith('|')));
    assert.match(markdown, /\| a \| 1 \| 0\.500 ± 未知 \| 未知 \| 未知 \|/u);
});

test('SequenceMatcher ratios and normalized findings match the golden values', () => {
    for (const [left, right, expected] of golden.ratios) close(sequenceMatcherRatio(left, right), expected);
    assert.ok(golden.ratios.some((/** @type {any[]} */ [, right]) => right.length >= 200), 'the golden set covers the autojunk length');
    for (const [raw, expected] of golden.normalized) assert.equal(normalizedFinding(raw), expected);
});

test('template findings match the golden clusters', () => {
    const decisions = new Map(Object.values(golden.templates.decisions).map((/** @type {any} */ item) => [item.stable_id, {decision: item.decision, source: item.source}]));
    const expected = golden.templates.expected.map((/** @type {any} */ group) => ({...group, credited: group.credited.map((/** @type {any} */ {stable_id: candidateId, ...rest}) => ({candidateId, ...rest}))}));
    assert.deepEqual(templateFindings(golden.templates.candidates, decisions), expected);
});
