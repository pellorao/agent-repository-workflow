import assert from 'node:assert/strict';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {loadScenario} from '../../lib/reviewer-capability/scenario.mjs';
import {sha256} from '../../lib/common/json.mjs';
import {combine, pool, repeatedId, score, summary} from '../../lib/reviewer-capability/operations.mjs';
import {candidateFingerprint} from '../../lib/reviewer-capability/pool.mjs';
import {createRandom} from '../../lib/reviewer-capability/random.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {item} from '../helpers/reviewer-capability-items.mjs';

const SPEC_READINESS = join(import.meta.dirname, '..', 'fixtures', 'reviewer-capability', 'spec-readiness-reviewer', 'runtime-migration');
const LISTING = {status: 'succeeded', result: {notifications: []}};
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
    // The registered format baseline of the demo scenario: one report of 20 locators with no format error, so pBase is 0.1.
    const sha = (await loadScenario(directory)).scenarioSha256;
    const runs = [{r: 0, rOverrun: 0, rRepairable: 0, rUnrepairable: 0, run: 'haiku-1', T: 20}];
    await writeFile(join(directory, '..', '..', 'registry.json'), JSON.stringify({demo: {scenarioSha256: {[`${role}/demo`]: sha}, pBase: 0.1, runs}}));
    await writeFile(join(directory, '..', '..', 'agent.json'), JSON.stringify(LISTING));
    return directory;
};
/** Scores with the registry and the agent listing `scenario` wrote next to the scenario; no repair is declared unless the input says so. */
const run = (/** @type {string} */ directory, /** @type {any} */ input) => score({agent: join(directory, '..', '..', 'agent.json'), noRepair: true, registry: join(directory, '..', '..', 'registry.json'), scenario: directory, ...input});
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
    const none = await run(directory, {report: await report(directory, 'No findings.\n')});
    assert.deepEqual([none.status, none.candidates, none.scores.score], ['succeeded', [], 0]);

    const hit = await run(directory, {report: await report(directory, '- `src/a.mjs:3` default export.\n')});
    assert.deepEqual(hit.candidates.map((/** @type {any} */ candidate) => candidate.kind), ['association']);
    const [candidate] = hit.candidates;
    const store = join(directory, 'decisions.json');
    await writeFile(store, JSON.stringify({decisions: {[candidate.candidateId]: {brief_sha256: sha256('Pool <ADJ>/pool-<名>.json\n'), decision: 'matched', fingerprint: candidateFingerprint(candidate)}}}));
    const decided = await run(directory, {decisions: [store], report: join(directory, 'report.md')});
    assert.deepEqual([decided.candidates, decided.scores.earnedProblemPoints > 0.9, decided.scores.score], [[], true, 1]);
    // A decision whose fingerprint no longer matches the candidate is not applied.
    await writeFile(store, JSON.stringify({decisions: {[candidate.candidateId]: {decision: 'matched', fingerprint: 'stale'}}}));
    assert.equal((await run(directory, {decisions: [store], report: join(directory, 'report.md')})).candidates.length, 1);

    const clean = await run(directory, {report: await report(directory, '- `src/a.mjs:5` five is wrong.\n')});
    assert.deepEqual([clean.candidates.map((/** @type {any} */ item) => item.kind), clean.scores.score < 0], [['finding'], true]);
});

test('scoring: inputs that cannot be scored are blocked', async t => {
    const directory = await scenario(t);
    assert.equal((await run(directory, {report: join(directory, 'missing.md')})).status, 'blocked');
    const noContent = await run(directory, {report: await report(directory, 'text without bullets\n')});
    assert.deepEqual([noContent.status, noContent.scores.score, noContent.scores.modelFailure !== undefined, noContent.scores.final], ['succeeded', 0, true, 0]);
    assert.equal((await run(directory, {report: await report(directory, '{}\n', 'r.jsonl')})).status, 'blocked');
    assert.equal((await run(directory, {report: join(directory, 'report.md'), scenario: join(directory, 'nowhere')})).status, 'blocked');
});

test('scoring: a short locator is completed and a Spec Readiness txt report scores like its JSONL form', async t => {
    const directory = await scenario(t);
    const short = await run(directory, {report: await report(directory, '- `a.mjs:3` default export.\n')});
    assert.deepEqual(short.candidates[0].evidence, [{filePath: 'src/a.mjs', line: 3}]);

    const reports = await createTemporaryDirectory(t, 'arw-capability-report-');
    const subject = '.scratch/0001-reviewer-capability/issues/01-review-readiness.md';
    await writeFile(join(reports, 'agent.json'), JSON.stringify(LISTING));
    const text = await report(reports, `- SPEC-READINESS-INPUTS, gap: the subject selects an absent Input (${subject}:21).\n`, 'r.txt');
    const rows = await report(reports, `${JSON.stringify({check: 'SPEC-READINESS-INPUTS', evidence: [`${subject}:21`], finding: `the subject selects an absent Input (${subject}:21).`, result: 'gap'})}\n`, 'r.jsonl');
    const [fromText, fromRows] = await Promise.all([text, rows].map(path => score({agent: join(reports, 'agent.json'), noRepair: true, report: path, scenario: SPEC_READINESS})));
    assert.equal(fromText.status, 'succeeded');
    assert.equal(fromText.candidates[0].scenario, 'runtime-migration');
    assert.deepEqual(fromText.candidates.map((/** @type {any} */ item) => item.evidence), fromRows.candidates.map((/** @type {any} */ item) => item.evidence));
    assert.equal(fromText.scores.score, fromRows.scores.score);
});

test('score: stale decisions stay pending, provisional bounds enclose the score, enumerate lists the candidates', async t => {
    const directory = await scenario(t);
    const path = await report(directory, '- `src/a.mjs:3` default export.\n');
    const [candidate] = (await run(directory, {report: path})).candidates;
    const store = join(directory, 'decisions.json');
    const entry = {brief_sha256: sha256('Pool <ADJ>/pool-<名>.json\n'), decision: 'matched', fingerprint: candidateFingerprint(candidate), source: 'pool x'};
    const stored = async (/** @type {any} */ change) => { await writeFile(store, JSON.stringify({decisions: {[candidate.candidateId]: {...entry, ...change}}})); return run(directory, {decisions: [store], report: path}); };

    const fresh = await stored({});
    assert.deepEqual([fresh.decisions, fresh.decisionSources, fresh.staleDecisions, fresh.provisional, fresh.candidates], [1, {'pool x': 1}, [], null, []]);
    for (const change of [{brief_sha256: 'old'}, {fingerprint: 'old'}, {decision: 'unsupported'}]) {
        const stale = await stored(change);
        assert.deepEqual([stale.staleDecisions, stale.candidates.length, stale.decisions], [[candidate.candidateId], 1, 0]);
    }
    const lower = await run(directory, {provisional: 'lower', report: path});
    const upper = await run(directory, {provisional: 'upper', report: path});
    assert.deepEqual([lower.candidates, upper.candidates, lower.provisional, upper.decisionSources], [[], [], 'lower', {provisional: 1}]);
    assert.ok(lower.scores.score <= fresh.scores.score && fresh.scores.score <= upper.scores.score && lower.scores.score < upper.scores.score);

    const enumerated = await run(directory, {enumerate: true, report: path, agent: undefined});
    assert.deepEqual([enumerated.status, enumerated.enumerated, 'scores' in enumerated], ['succeeded', enumerated.candidates.length, false]);
    for (const input of [{enumerate: true, provisional: 'lower'}, {enumerate: true, decisions: [store]}, {provisional: 'middle'}]) {
        assert.equal((await run(directory, {report: path, ...input})).status, 'blocked');
    }
});

test('a repeated candidate id is found', () => {
    assert.deepEqual([repeatedId([{candidateId: 'a'}, {candidateId: 'b'}]), repeatedId([{candidateId: 'a'}, {candidateId: 'b'}, {candidateId: 'a'}])], [undefined, 'a']);
});

test('combine rejects outputs that are not final or lack the decision statistics', async t => {
    const directory = await scenario(t);
    const first = await run(directory, {instance: 'a', provisional: 'lower', report: await report(directory, '- `src/a.mjs:3` default export.\n')});
    const second = {...first, scenario: 'other', scores: first.scores};
    const write = async (/** @type {string} */ name, /** @type {any} */ value) => { await writeFile(join(directory, name), JSON.stringify(value)); return join(directory, name); };
    const paths = [await write('one.json', first), await write('two.json', {...second, candidates: [], provisional: 'upper'})];
    assert.equal((await combine({scores: [paths[0], paths[1]]})).status, 'blocked');
    // Outputs that are not final cannot be combined, even with the same bound or without a candidates array.
    const {candidates, ...noCandidates} = second;
    assert.equal((await combine({scores: [paths[0], await write('none.json', noCandidates)]})).status, 'blocked');
    assert.equal((await combine({scores: [paths[0], await write('same.json', {...second, candidates: [], provisional: 'lower'})]})).status, 'blocked');
    const {provisional, ...incomplete} = second;
    assert.equal((await combine({scores: [paths[0], await write('three.json', incomplete)]})).status, 'blocked');
});

test('pools: prompt checks adj, split gives the review lists, override and anchor-add validate', async t => {
    const directory = await scenario(t);
    const root = await createTemporaryDirectory(t, 'arw-capability-pool-');
    const candidates = join(root, 'candidates.json');
    const finding = (/** @type {string} */ name, /** @type {any} */ extra = {}) => ({...item(name), candidateId: `c-${name}`, expectation: null, kind: 'finding', allowedDecisions: ['problem-1', 'unsupported'], ...extra});
    await writeFile(candidates, JSON.stringify([association('real one'), association('real two'), finding('maybe', {finding: 'x'}), finding('plain', {evidence: [{filePath: 'f', line: 3}]})]));
    const built = await pool({action: 'build', candidates: [candidates], name: 'p', root, scenario: directory});
    assert.deepEqual([built.status, built.alreadyDecidedSkipped, built.pools.map((/** @type {any} */ entry) => [entry.real, entry.controls])], ['succeeded', 0, [[4, 3]]]);
    const items = JSON.parse(await readFile(join(root, 'p', 'adj', 'pool-p.json'), 'utf8'));
    assert.equal(items.every((/** @type {any} */ entry) => !('candidateId' in entry) && /^[EF]\d\d$/u.test(entry.group)), true);

    // The judge's directory must hold the views the pool names, and nothing else.
    const adj = join(root, 'p', 'adj');
    assert.match((await pool({action: 'prompt', name: 'p', root})).diagnostics[0], /stage view, change\.diff/u);
    await mkdir(join(adj, 'view'));
    await writeFile(join(adj, 'view', 'a.txt'), 'a');
    await writeFile(join(adj, 'change.diff'), 'd');
    await writeFile(join(adj, 'notes.txt'), 'n');
    assert.match((await pool({action: 'prompt', name: 'p', root})).diagnostics[0], /more than the pool and its views: notes\.txt/u);
    await rm(join(adj, 'notes.txt'));
    const prompt = await pool({action: 'prompt', name: 'p', root});
    assert.match(await readFile(prompt.prompt, 'utf8'), /^Pool adj\/pool-p\.json\n\n调用方附加说明/u);
    assert.equal((await pool({action: 'split', decisions: join(root, 'none.json'), name: 'p', root})).status, 'blocked');

    const key = JSON.parse(await readFile(join(root, 'p', 'key.json'), 'utf8')).items;
    const stable = (/** @type {string} */ id) => key[id].stableId;
    const reasons = /** @type {Record<string, string>} */ ({'c-maybe': '可能不成立', 'c-plain': 'no support', 'c-real one': 'ok', 'c-real two': 'ok'});
    const judge = (/** @type {boolean} */ right) => ({decisions: items.map((/** @type {any} */ entry) => {
        const meta = key[entry.id];
        if (meta.source !== 'instance') return {id: entry.id, decision: right ? meta.expected : 'not-matched', reason: 'r'};
        return {id: entry.id, decision: meta.kind === 'association' ? 'matched' : 'unsupported', reason: reasons[stable(entry.id)]};
    })});
    await writeFile(join(root, 'wrong.json'), JSON.stringify(judge(false)));
    const failed = await pool({action: 'split', decisions: join(root, 'wrong.json'), name: 'p', root});
    assert.deepEqual([failed.status, failed.written, failed.passed], ['blocked', 0, false]);
    assert.equal(JSON.parse(await readFile(join(root, 'p', 'split-p.json'), 'utf8')).verdict.written, 0);
    await assert.rejects(readFile(join(root, 'p', 'decisions.json')), {code: 'ENOENT'});

    await writeFile(join(root, 'right.json'), JSON.stringify(judge(true)));
    // A pool file changed after the key was written is refused by prompt and split.
    const poolFile = join(adj, 'pool-p.json');
    const original = await readFile(poolFile, 'utf8');
    await writeFile(poolFile, original.replace('"f"', '"g"'));
    for (const action of /** @type {const} */ (['prompt', 'split'])) assert.match((await pool({action, decisions: join(root, 'right.json'), name: 'p', root})).diagnostics[0], /pool file differs/u);
    await writeFile(poolFile, original);
    const plainId = items.find((/** @type {any} */ entry) => key[entry.id].stableId === 'c-plain').id;
    const passed = await pool({action: 'split', decisions: join(root, 'right.json'), hard: [plainId, 'nope'], name: 'p', root});
    assert.deepEqual([passed.status, passed.written, passed.anchorAgreementByFamily.openai.n, passed.anchorAgreementByModel.m.rate, passed.syntheticByFamily.openai.n], ['succeeded', 4, 2, 1, 1]);
    const {review} = JSON.parse(await readFile(join(root, 'p', 'split-p.json'), 'utf8'));
    assert.deepEqual(review.supported, []);
    assert.deepEqual(review.disputedUnsupported.map((/** @type {any} */ entry) => [entry.stableId, entry.why]), [['c-maybe', ['hedged reason']], ['c-plain', ['among the hardest the adjudicator named']]]);

    // A brief that changed after the prompt makes the pool stale.
    await writeFile(join(directory, 'brief.md'), 'changed <ADJ> <名>\n');
    assert.match((await pool({action: 'split', decisions: join(root, 'right.json'), name: 'p', root})).diagnostics[0], /current brief/u);

    const override = (/** @type {any} */ input) => pool({action: 'override', id: 'c-real one', name: 'p', reason: 'checked', root, ...input});
    assert.equal((await override({decision: 'not-matched', by: 'me'})).entry.source, 'override (me)');
    for (const input of [{decision: 'unsupported'}, {decision: 'maybe'}, {decision: 'matched', reason: ' '}, {id: 'c-gone', decision: 'matched'}]) assert.equal((await override(input)).status, 'blocked');
    const store = JSON.parse(await readFile(join(root, 'p', 'decisions.json'), 'utf8'));
    assert.deepEqual([store.decisions['c-real one'].decision, store.history.length], ['not-matched', 1]);

    const candidate = join(root, 'candidate.json');
    await writeFile(candidate, JSON.stringify(association('new anchor')));
    const add = (/** @type {any} */ input) => pool({action: 'anchor-add', candidate, confirmedBy: 'me', expected: 'matched', family: 'strata', model: 'm2', scenario: directory, ...input});
    const added = await add({});
    assert.deepEqual([added.status, added.anchor.id, added.anchor.origin], ['succeeded', 'a03', {candidateId: 'c-new anchor'}]);
    assert.equal(JSON.parse(await readFile(join(directory, 'anchors.json'), 'utf8')).anchors.length, 3);
    assert.ok((await readFile(join(directory, 'anchors.json'), 'utf8')).endsWith('}\n'));
    for (const input of [{id: 'a1'}, {model: ' '}, {family: 'x'}, {expected: 'supported'}]) assert.equal((await add(input)).status, 'blocked');
    await writeFile(candidate, JSON.stringify(finding('f')));
    assert.equal((await add({id: 'a09'})).status, 'blocked');
    // The new anchor takes part in the next pool and clashes with its own candidate.
    await writeFile(candidates, JSON.stringify([association('new anchor')]));
    assert.match((await pool({action: 'build', candidates: [candidates], name: 'q', root, scenario: directory})).diagnostics[0], /registered anchor/u);
    await writeFile(candidates, JSON.stringify([association('another')]));
    assert.equal((await pool({action: 'build', candidates: [candidates], name: 'q', root, scenario: directory})).status, 'succeeded');
    const anchorMeta = Object.values((await readFile(join(root, 'q', 'key.json'), 'utf8').then(JSON.parse)).items).find((/** @type {any} */ meta) => meta.control === 'a03');
    assert.deepEqual([anchorMeta.source, anchorMeta.origin], ['anchor', {candidateId: 'c-new anchor'}]);
});

test('summary: the first five files count, unfinished and repeated inputs are blocked', async t => {
    const directory = await scenario(t);
    const write = async (/** @type {string} */ name, /** @type {any} */ scores, /** @type {any} */ extra = {}) => {
        await writeFile(join(directory, name), JSON.stringify({candidates: [], provisional: null, scores: {f: 0.1, final: 0.5, missingChecks: 0, overallDeduction: 0.1, rawScore: 0.6, rRepairable: 1, scoreBeforePenalty: 0.6, ...scores}, status: 'succeeded', ...extra}));
        return join(directory, name);
    };
    const files = await Promise.all([0.2, 0.4, 0.6, 0.8, 1, 0.9].map((final, index) => write(`s${index}.json`, {final})));
    const result = await summary({cells: [{files, label: 'cell'}], markdown: true});
    assert.deepEqual([result.status, result.cells[0].n, result.cells[0].nGiven, result.cells[0].extraIds, result.instances.map((/** @type {any} */ row) => row.main)], ['succeeded', 5, 6, [files[5]], [true, true, true, true, true, false]]);
    assert.ok(Math.abs(result.cells[0].mean - 0.6) < 1e-12 && Math.abs(result.cells[0].meanR83 - 0.54) < 1e-12);
    assert.equal(result.diagnostics.length, 1);
    assert.ok(result.markdown.split('\n').every((/** @type {string} */ line) => line === '' || line.startsWith('|')));
    const blocked = (/** @type {any} */ cells) => summary({cells}).then(output => output.status);
    assert.deepEqual(await Promise.all([blocked([]), blocked([{files: [], label: 'a'}]), blocked([{files: [files[0]], label: 'a'}, {files: [files[1]], label: 'a'}]), blocked([{files: [files[0]], label: 'a'}, {files: [files[0]], label: 'b'}]),
        blocked([{files: [await write('open.json', {}, {candidates: [{}]})], label: 'a'}]), blocked([{files: [await write('prov.json', {}, {provisional: 'lower'})], label: 'a'}]),
        blocked([{files: [await write('single.json', {final: undefined})], label: 'a'}]), blocked([{files: [join(directory, 'missing.json')], label: 'a'}])]), Array(8).fill('blocked'));
});
