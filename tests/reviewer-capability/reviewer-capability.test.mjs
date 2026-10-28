import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {pool, score} from '../../lib/reviewer-capability/operations.mjs';
import {candidateFingerprint} from '../../lib/reviewer-capability/pool.mjs';
import {createRandom} from '../../lib/reviewer-capability/random.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';

const SPEC_READINESS = join(import.meta.dirname, '..', 'fixtures', 'reviewer-capability', 'spec-readiness-reviewer', 'runtime-migration');
const item = (/** @type {string} */ expectation) => ({allowedDecisions: ['matched', 'not-matched'], check: 'X', evidence: [], expectation, finding: 'f', kind: 'association', result: 'gap'});
const association = (/** @type {string} */ expectation) => ({...item(expectation), candidateId: `c-${expectation}`});

/** A one-file Code Standards scenario: one problem on line 3, one clean case on line 5, anchors and a brief for pools. */
const scenario = async (/** @type {import('node:test').TestContext} */ t, role = 'code-standards-reviewer') => {
    const directory = join(await createTemporaryDirectory(t, 'arw-capability-'), role, 'demo');
    await mkdir(join(directory, 'candidate', 'src'), {recursive: true});
    await writeFile(join(directory, 'candidate', 'src', 'a.mjs'), 'one\ntwo\nexport default function a() {}\nfour\nfive\nsix\n');
    await writeFile(join(directory, 'expected.json'), JSON.stringify({scopes: [{scope: 'CODE-STANDARDS-FINDINGS',
        problemCases: [{associationEvidence: [{filePath: 'src/a.mjs', line: 3}], evidence: [{filePath: 'src/a.mjs', line: 3}], expectation: 'a.mjs exports a function as default.',
            findingTerms: [['default']], result: 'gap'}],
        cleanCases: [{evidence: [{filePath: 'src/a.mjs', line: 5}], expectation: 'line five is fine.', findingTerms: [['five']]}, {noOtherSupportedFinding: true}]}]}));
    const control = (/** @type {string} */ id, /** @type {string} */ expected) => ({id, family: 'openai', model: 'm', expected, item: item(`control ${id}`)});
    await writeFile(join(directory, 'anchors.json'), JSON.stringify({anchors: [control('a1', 'matched'), control('a2', 'not-matched')], synthetic: [{...control('s1', 'matched'), type: 'real'}]}));
    await writeFile(join(directory, 'brief.md'), 'Pool <ADJ>/pool-<名>.json\n');
    return directory;
};
const report = async (/** @type {string} */ directory, /** @type {string} */ text, name = 'report.md') => {
    await writeFile(join(directory, name), text);
    return join(directory, name);
};

test('the shuffle matches Python random.Random(20261020)', () => {
    const values = Array.from({length: 30}, (_, index) => index);
    createRandom(20261020).shuffle(values);
    assert.deepEqual(values, [19, 7, 18, 12, 5, 0, 11, 9, 16, 13, 8, 28, 21, 3, 17, 29, 25, 22, 4, 2, 27, 26, 1, 15, 6, 10, 20, 23, 14, 24]);
});

test('scoring: no findings earns nothing, a matched association earns the problem, an unmatched finding costs a clean case', async t => {
    const directory = await scenario(t);
    const none = await score({report: await report(directory, 'No findings.\n'), scenario: directory});
    assert.deepEqual([none.status, none.candidates, none.scores.score], ['succeeded', [], 0]);

    const hit = await score({report: await report(directory, '- `src/a.mjs:3` default export.\n'), scenario: directory});
    assert.deepEqual(hit.candidates.map((/** @type {any} */ candidate) => candidate.kind), ['association']);
    const [candidate] = hit.candidates;
    const store = join(directory, 'decisions.json');
    await writeFile(store, JSON.stringify({decisions: {[candidate.candidateId]: {decision: 'matched', fingerprint: candidateFingerprint(candidate)}}}));
    const decided = await score({decisions: [store], report: join(directory, 'report.md'), scenario: directory});
    assert.deepEqual([decided.candidates, decided.scores.earnedProblemPoints > 0.9, decided.scores.score], [[], true, 1]);
    // A decision whose fingerprint no longer matches the candidate is not applied.
    await writeFile(store, JSON.stringify({decisions: {[candidate.candidateId]: {decision: 'matched', fingerprint: 'stale'}}}));
    assert.equal((await score({decisions: [store], report: join(directory, 'report.md'), scenario: directory})).candidates.length, 1);

    const clean = await score({report: await report(directory, '- `src/a.mjs:5` five is wrong.\n'), scenario: directory});
    assert.deepEqual([clean.candidates.map((/** @type {any} */ item) => item.kind), clean.scores.score < 0], [['finding'], true]);
});

test('scoring: inputs that cannot be scored are blocked', async t => {
    const directory = await scenario(t);
    assert.equal((await score({report: join(directory, 'missing.md'), scenario: directory})).status, 'blocked');
    assert.equal((await score({report: await report(directory, 'text without bullets\n'), scenario: directory})).status, 'blocked');
    assert.equal((await score({report: await report(directory, '{}\n', 'r.jsonl'), scenario: directory})).status, 'blocked');
    assert.equal((await score({report: join(directory, 'report.md'), scenario: join(directory, 'nowhere')})).status, 'blocked');
});

test('scoring: a short locator is completed and a Spec Readiness txt report scores like its JSONL form', async t => {
    const directory = await scenario(t);
    const short = await score({report: await report(directory, '- `a.mjs:3` default export.\n'), scenario: directory});
    assert.deepEqual(short.candidates[0].evidence, [{filePath: 'src/a.mjs', line: 3}]);

    const reports = await createTemporaryDirectory(t, 'arw-capability-report-');
    const subject = '.scratch/0001-reviewer-capability/issues/01-review-readiness.md';
    const text = await report(reports, `- SPEC-READINESS-INPUTS, gap: the subject selects an absent Input (${subject}:21).\n`, 'r.txt');
    const rows = await report(reports, `${JSON.stringify({check: 'SPEC-READINESS-INPUTS', evidence: [`${subject}:21`], finding: `the subject selects an absent Input (${subject}:21).`, result: 'gap'})}\n`, 'r.jsonl');
    const [fromText, fromRows] = await Promise.all([text, rows].map(path => score({report: path, scenario: SPEC_READINESS})));
    assert.equal(fromText.status, 'succeeded');
    assert.equal(fromText.candidates[0].scenario, 'runtime-migration');
    assert.deepEqual(fromText.candidates.map((/** @type {any} */ item) => item.evidence), fromRows.candidates.map((/** @type {any} */ item) => item.evidence));
    assert.equal(fromText.scores.score, fromRows.scores.score);
});

test('pools: build, prompt, split and override', async t => {
    const directory = await scenario(t);
    const root = await createTemporaryDirectory(t, 'arw-capability-pool-');
    const candidates = join(root, 'candidates.json');
    await writeFile(candidates, JSON.stringify([association('real one'), association('real two')]));
    const built = await pool({action: 'build', candidates: [candidates], name: 'p', root, scenario: directory});
    assert.deepEqual([built.status, built.real, built.controls], ['succeeded', 2, 3]);
    const items = JSON.parse(await readFile(join(root, 'p', 'adj', 'pool-p.json'), 'utf8'));
    assert.deepEqual(items.map((/** @type {any} */ item) => item.id), ['p-001', 'p-002', 'p-003', 'p-004', 'p-005']);
    assert.equal(items.every((/** @type {any} */ item) => !('candidateId' in item) && item.group.startsWith('E')), true);

    const prompt = await pool({action: 'prompt', name: 'p', root});
    assert.match(await readFile(prompt.prompt, 'utf8'), /^Pool adj\/pool-p\.json\n\n调用方附加说明/u);
    const key = JSON.parse(await readFile(join(root, 'p', 'key.json'), 'utf8')).items;
    const judge = (/** @type {boolean} */ right) => ({decisions: items.map((/** @type {any} */ item) => {
        const control = key[item.id].source !== 'instance';
        return {id: item.id, decision: control ? (right ? key[item.id].expected : 'not-matched') : 'matched', reason: 'r'};
    })});
    await writeFile(join(root, 'wrong.json'), JSON.stringify(judge(false)));
    const failed = await pool({action: 'split', decisions: join(root, 'wrong.json'), name: 'p', root});
    assert.deepEqual([failed.status, failed.written], ['blocked', 0]);
    await assert.rejects(readFile(join(root, 'p', 'decisions.json')), {code: 'ENOENT'});

    await writeFile(join(root, 'right.json'), JSON.stringify(judge(true)));
    assert.deepEqual((await pool({action: 'split', decisions: join(root, 'right.json'), name: 'p', root})).written, 2);
    const overridden = await pool({action: 'override', decision: 'not-matched', id: 'c-real one', name: 'p', reason: 'checked', root});
    assert.equal(overridden.status, 'succeeded');
    const store = JSON.parse(await readFile(join(root, 'p', 'decisions.json'), 'utf8'));
    assert.deepEqual([store.decisions['c-real one'].decision, store.history.length], ['not-matched', 1]);
    assert.equal((await pool({action: 'override', decision: 'unsupported', id: 'c-real one', name: 'p', reason: 'x', root})).status, 'blocked');
});

test('pools: more candidates than the limit are blocked and nothing is written', async t => {
    const directory = await scenario(t, 'requirements-reviewer');
    const root = await createTemporaryDirectory(t, 'arw-capability-pool-');
    await writeFile(join(root, 'candidates.json'), JSON.stringify(Array.from({length: 148}, (_, index) => association(`e${index}`))));
    const result = await pool({action: 'build', candidates: [join(root, 'candidates.json')], name: 'big', root, scenario: directory});
    assert.equal(result.status, 'blocked');
    await assert.rejects(readFile(join(root, 'big', 'key.json')), {code: 'ENOENT'});
});
