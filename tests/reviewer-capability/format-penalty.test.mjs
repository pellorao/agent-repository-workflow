import assert from 'node:assert/strict';
import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {extname, join} from 'node:path';
import test from 'node:test';

import {sha256} from '../../lib/common/json.mjs';
import {loadScenario} from '../../lib/reviewer-capability/scenario.mjs';
import {baseline, combine, repair, score} from '../../lib/reviewer-capability/operations.mjs';
import {candidateFingerprint} from '../../lib/reviewer-capability/pool.mjs';
import {combineScenarios, kScore, withReportPolicy} from '../../lib/reviewer-capability/scoring.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'reviewer-capability');
const RUNTIME_MIGRATION = join(FIXTURES, 'spec-readiness-reviewer', 'runtime-migration');
const ARTIFACT_PROMOTION = join(FIXTURES, 'spec-readiness-reviewer', 'artifact-promotion');
const SUBJECT = '.scratch/0001-reviewer-capability/issues/01-review-readiness.md';
const pause = (/** @type {string} */ messageId) => ({messageId, sequence: 1, source: 'provider-program', text: 'The Reviewer runtime paused this same task after 600 seconds.', type: 'message'});

/** A Code Standards scenario `demo` (one problem on line 3, one clean case on line 5) with its registered baseline (pBase 0.1) and an agent listing. */
const demo = async (/** @type {import('node:test').TestContext} */ t, {notifications = [], key = {}} = /** @type {any} */ ({})) => {
    const root = await createTemporaryDirectory(t, 'arw-format-');
    const directory = join(root, 'code-standards-reviewer', 'demo');
    await mkdir(join(directory, 'candidate', 'src'), {recursive: true});
    await writeFile(join(directory, 'candidate', 'src', 'a.mjs'), 'one\ntwo\nexport default function a() {}\nfour\nfive\nsix\n');
    const expected = JSON.stringify({scopes: [{scope: 'CODE-STANDARDS-FINDINGS',
        problemCases: [{associationEvidence: [{filePath: 'src/a.mjs', line: 3}], evidence: [{filePath: 'src/a.mjs', line: 3}], expectation: 'default export.', findingTerms: [['default']], result: 'gap', ...key}],
        cleanCases: [{evidence: [{filePath: 'src/a.mjs', line: 5}], expectation: 'five is fine.', findingTerms: [['five']]}, {noOtherSupportedFinding: true}]}]});
    await writeFile(join(directory, 'expected.json'), expected);
    const sha = await loadScenario(directory).then(fixture => fixture.scenarioSha256, () => 'invalid key');
    await writeFile(join(root, 'registry.json'), JSON.stringify({demo: {scenarioSha256: {'code-standards-reviewer/demo': sha}, pBase: 0.1,
        runs: [{r: 0, rOverrun: 0, rRepairable: 0, rUnrepairable: 0, run: 'haiku-1', T: 20}]}}));
    await writeFile(join(root, 'agent.json'), JSON.stringify({status: 'succeeded', result: {notifications}}));
    const run = (/** @type {any} */ input) => score({agent: join(root, 'agent.json'), noRepair: true, registry: join(root, 'registry.json'), scenario: directory, ...input});
    return {directory, root, run};
};
const write = async (/** @type {string} */ path, /** @type {string} */ text) => { await writeFile(path, text); return path; };
/** The scored report that matches the problem case, with the decision that confirms it, so its score is 1. */
const matched = async (/** @type {{directory: string, root: string, run: Function}} */ {directory, root, run}, report = '- `src/a.mjs:3` default export.\n', extra = {}) => {
    const path = await write(join(root, 'report.md'), report);
    const [candidate] = (await run({instance: 'i', report: path})).candidates;
    const store = await write(join(root, 'decisions.json'), JSON.stringify({decisions: {[candidate.candidateId]: {brief_sha256: sha256(''), decision: 'matched', fingerprint: candidateFingerprint(candidate)}}}));
    return run({decisions: [store], instance: 'i', report: path, ...extra});
};

test('kScore needs problem cases, and clean cases once the score is negative', () => {
    assert.throws(() => kScore({kCleanWeight: 1, kEarnedProblemPoints: 0, kFailedCleanWeight: 0, kProblemWeight: 0}), /needs problem cases/u);
    assert.throws(() => kScore({kCleanWeight: 0, kEarnedProblemPoints: 0, kFailedCleanWeight: 1, kProblemWeight: 1}), /needs clean cases/u);
    assert.deepEqual(kScore({kCleanWeight: 2, kEarnedProblemPoints: 1, kFailedCleanWeight: 0, kProblemWeight: 2}), {rawScore: 0.5, score: 0.5});
});

test('combining scenario results rejects incomplete counts and unbalanced k tiers, and cut diagnostics take the residual cut', () => {
    const result = (/** @type {any} */ kTiers) => ({caseScores: {clean: [], problem: []}, kCleanWeight: 1, kEarnedProblemPoints: 1, kFailedCleanWeight: 0, kProblemWeight: 1, kTiers, scopes: []});
    assert.throws(() => combineScenarios([{...result({}), kProblemWeight: undefined}]), /incomplete k counts/u);
    assert.throws(() => combineScenarios([result({1: {clean: 1, problem: 2}})]), /unbalanced/u);
    assert.equal(combineScenarios([result({1: {clean: 1, problem: 1}}), result({})]).score, 1);
    assert.deepEqual(['review-row-invalid', 'surprise'].map(code => withReportPolicy({score: 1}, [{code}]).score), [1, 0.9]);
    assert.equal(withReportPolicy({score: 1}, [{code: 'review-json-invalid'}]).unrepairableFormatErrors, 1);
});

test('an answer key with k = 4 is blocked, a report without any bullet is a model failure scored 0', async t => {
    assert.equal((await (await demo(t, {key: {k: 4}})).run({report: '/nowhere'})).status, 'blocked');
    const {root, run} = await demo(t);
    const failure = await run({report: await write(join(root, 'text.md'), 'nothing to see\n')});
    assert.deepEqual([failure.status, failure.scores.score, failure.scores.final, failure.scores.modelFailure !== undefined], ['succeeded', 0, 0, true]);
    assert.deepEqual([failure.scores.cleanAcceptanceRate, failure.scores.passedCleanCases], [1, 2]);
});

test('the repair declaration and the agent listing are mandatory', async t => {
    const {root, run} = await demo(t);
    const path = await write(join(root, 'report.md'), 'No findings.\n');
    assert.equal((await run({noRepair: false, report: path})).status, 'blocked');
    assert.equal((await run({repair: join(root, 'x.changes.json'), report: path})).status, 'blocked');
    assert.equal((await run({agent: undefined, report: path})).status, 'blocked');
    assert.equal((await run({agent: join(root, 'missing.json'), report: path})).status, 'blocked');
    await writeFile(join(root, 'bad.json'), JSON.stringify({status: 'failed'}));
    assert.equal((await run({agent: join(root, 'bad.json'), report: path})).status, 'blocked');
});

test('an answer key that differs from its registered baseline is blocked', async t => {
    const {directory, root, run} = await demo(t);
    await writeFile(join(directory, 'expected.json'), `${await readFile(join(directory, 'expected.json'), 'utf8')} `);
    assert.equal((await run({report: await write(join(root, 'report.md'), 'No findings.\n')})).status, 'blocked');
    // Two units registering one scenario are ambiguous.
    const again = await demo(t);
    const registry = JSON.parse(await readFile(join(again.root, 'registry.json'), 'utf8'));
    assert.equal((await again.run({report: await write(join(again.root, 'report.md'), 'No findings.\n')})).status, 'succeeded');
    await writeFile(join(again.root, 'registry.json'), JSON.stringify({...registry, twin: registry.demo}));
    assert.equal((await again.run({report: join(again.root, 'report.md')})).status, 'blocked');
});

test('a pause notice cuts the final score once per message, and no format error leaves the score as it is', async t => {
    const context = await demo(t, {notifications: [pause('m1'), pause('m1'), {...pause('m2'), source: 'user'}, {...pause('m3'), type: 'changed'}]});
    const result = await matched(context);
    assert.deepEqual([result.scores.paused, result.scores.pauseCount, result.scores.score, result.scores.overallDeduction, result.scores.final], [true, 1, 1, 0.1, 0.9]);
    const clean = await matched(await demo(t));
    assert.deepEqual([clean.scores.paused, clean.scores.r, clean.scores.f, clean.scores.final, clean.scores.pBase], [false, 0, 0, 1, 0.1]);
});

test('repair fixes a short path and a preamble on a copy, and the format penalty follows from the repair record', async t => {
    const {directory, root, run} = await demo(t);
    const original = await write(join(root, 'original.md'), 'Findings:\n- `a.mjs:3` default export.\n');
    const repaired = await repair({out: join(root, 'repaired.md'), report: original, scenario: directory});
    assert.deepEqual([repaired.status, Object.keys(repaired.changes).sort()], ['succeeded', ['markdown-preamble', 'short-evidence-path']]);
    assert.equal(await readFile(join(root, 'repaired.md'), 'utf8'), '- `src/a.mjs:3` default export.\n');
    assert.equal((await repair({out: join(root, 'repaired.md'), report: original, scenario: directory})).status, 'blocked');
    const result = await matched({directory, root, run}, '- `src/a.mjs:3` default export.\n', {noRepair: false, repair: repaired.record, report: join(root, 'repaired.md')});
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual([result.scores.rRepairable, result.scores.r, result.scores.T], [2, 2, 1]);
    assert.deepEqual([result.scores.p, result.scores.f, result.scores.final], [2, 0.1, 0.9]);
    // The record belongs to the repaired copy only.
    assert.equal((await run({noRepair: false, repair: repaired.record, report: original})).status, 'blocked');
});

test('a report that continues past a requirement-scope problem fails a clean case, and the two Spec Readiness scenarios fuse', async t => {
    const root = await createTemporaryDirectory(t, 'arw-format-');
    const agent = await write(join(root, 'agent.json'), JSON.stringify({status: 'succeeded', result: {notifications: []}}));
    const row = (/** @type {string} */ check) => `${JSON.stringify({check, evidence: [`${SUBJECT}:21`], finding: 'The subject selects an absent Input.', result: 'gap'})}\n`;
    const stopped = await score({agent, noRepair: true, report: await write(join(root, 's.jsonl'), row('SPEC-READINESS-REQUIREMENTS')), scenario: RUNTIME_MIGRATION});
    const continued = await score({agent, noRepair: true, report: await write(join(root, 'c.jsonl'), row('SPEC-READINESS-REQUIREMENTS') + row('MODULE-DESIGN-APPLICABILITY')), scenario: RUNTIME_MIGRATION});
    assert.equal(continued.scores.reportDiagnostics.some((/** @type {any} */ item) => item.code === 'requirement-scope-continuation'), true);
    assert.equal(continued.scores.score < stopped.scores.score, true);
    // A row of invalid representation after the stop point is ignored with its check once the review continued, so it adds no format error.
    const untrimmed = JSON.stringify({check: 'MODULE-DESIGN-APPLICABILITY', evidence: [`${SUBJECT}:21`], finding: ' padded', result: 'gap'});
    const padded = await score({agent, noRepair: true, report: await write(join(root, 'p.jsonl'), `${row('SPEC-READINESS-REQUIREMENTS')}${untrimmed}\n`), scenario: RUNTIME_MIGRATION});
    assert.equal(padded.scores.unrepairableFormatErrors, continued.scores.unrepairableFormatErrors);
    // The same holds for a row of invalid judgment of a check after the stop point, once the review continued.
    const unjudged = JSON.stringify({check: 'MODULE-DESIGN-APPLICABILITY', evidence: [`${SUBJECT}:21`], finding: 'Fine.', result: 'satisfied'});
    const unjudgedReport = await score({agent, noRepair: true, report: await write(join(root, 'u.jsonl'), `${row('SPEC-READINESS-REQUIREMENTS')}${row('MODULE-DESIGN-APPLICABILITY')}${unjudged}\n`), scenario: RUNTIME_MIGRATION});
    assert.equal(unjudgedReport.scores.unrepairableFormatErrors, continued.scores.unrepairableFormatErrors);
    assert.equal('final' in stopped.scores, false);

    const none = await write(join(root, 'none.jsonl'), '{"status":"no-findings"}\n');
    const first = await score({agent, instance: 'a', noRepair: true, report: none, scenario: RUNTIME_MIGRATION});
    const second = await score({agent, instance: 'b', noRepair: true, report: none, scenario: ARTIFACT_PROMOTION});
    const outputs = await Promise.all([first, second].map((output, index) => write(join(root, `score-${index}.json`), JSON.stringify(output))));
    const fused = await combine({scores: [outputs[0], outputs[1]]});
    assert.deepEqual([fused.status, fused.scores.final, fused.scores.paused, fused.scores.T], ['succeeded', fused.scores.score, false, 0]);
    assert.equal(fused.scores.scopes.length, first.scores.scopes.length + second.scores.scopes.length);
    assert.equal((await combine({scores: [outputs[0], outputs[0]]})).status, 'blocked');
    assert.equal((await combine({scores: [outputs[0], join(root, 'missing.json')]})).status, 'blocked');
});

test('the registered baselines match their archives, bootstrap intervals and answer keys', async () => {
    const result = await baseline({unit: 'code-standards'});
    assert.deepEqual([result.status, result.filesChecked, Number(result.pBase.toFixed(7))], ['succeeded', 10, 0.0803571]);
    assert.equal((await baseline({unit: 'nothing'})).status, 'blocked');
    // The spill files of the code-spec repair records are archive files too (3 spills, 5 runs of report and repair record).
    assert.equal((await baseline({unit: 'code-spec'})).filesChecked, 5 * 2 + 3);
});

test('repairing the archived baseline reports gives the archived repair records', async t => {
    const root = await createTemporaryDirectory(t, 'arw-format-');
    const archive = join(FIXTURES, 'format-baseline', 'archive');
    for (const run of ['haiku-1', 'haiku-4']) {
        const report = join(archive, 'code-standards-v5.1', run, 'review-result.md');
        const result = await repair({out: join(root, `${run}.md`), report, scenario: join(FIXTURES, 'code-standards-reviewer', 'code-standards')});
        const archived = JSON.parse(await readFile(`${report}.changes.json`, 'utf8'));
        assert.deepEqual([result.status, result.changes], ['succeeded', archived.changes]);
        assert.deepEqual(JSON.parse(await readFile(result.record, 'utf8')).details, archived.details);
    }
});

// Guards the yardstick: scoring each archived baseline report again reproduces the registered r and T of its run (no model run needed).
const REGISTRY = JSON.parse(await readFile(join(FIXTURES, 'format-baseline', 'registry.json'), 'utf8'));
const SCENARIOS = {'code-spec': 'requirements-reviewer/code-spec', 'code-standards': 'code-standards-reviewer/code-standards', 'commit-audit': 'requirements-reviewer/commit-audit'};
for (const [unit, entry] of Object.entries(REGISTRY)) {
    for (const registered of entry.runs) {
        test(`the archived ${unit} ${registered.run} scores to its registered r and T`, async t => {
            const root = await createTemporaryDirectory(t, 'arw-format-');
            const agent = await write(join(root, 'agent.json'), JSON.stringify({status: 'succeeded', result: {notifications: []}}));
            const totals = {rOverrun: 0, rRepairable: 0, rUnrepairable: 0, T: 0};
            for (const [index, item] of registered.reports.entries()) {
                const archived = join(FIXTURES, 'format-baseline', 'archive', item.report);
                const scenario = join(FIXTURES, unit === 'spec-readiness' ? `spec-readiness-reviewer/${item.report.split('/').at(-1).split('.draft')[0]}` : SCENARIOS[/** @type {keyof typeof SCENARIOS} */ (unit)]);
                const spills = (await readdir(join(archived, '..'))).filter(name => name.endsWith('.txt')).map(name => join(archived, '..', name));
                const repaired = await repair({out: join(root, `r${index}${extname(archived)}`), report: archived, scenario, spills});
                const scored = await score({agent, instance: item.instanceId, noRepair: false, repair: repaired.record, report: repaired.normalized ?? archived, scenario});
                assert.equal(scored.status, 'succeeded');
                for (const key of /** @type {Array<keyof typeof totals>} */ (Object.keys(totals))) totals[key] += scored.scores[key];
            }
            assert.deepEqual(totals, {rOverrun: registered.rOverrun, rRepairable: registered.rRepairable, rUnrepairable: registered.rUnrepairable, T: registered.T});
        });
    }
}
