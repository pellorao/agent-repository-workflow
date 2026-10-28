import assert from 'node:assert/strict';
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {sha256} from '../../lib/common/json.mjs';
import {pool} from '../../lib/reviewer-capability/operations.mjs';
import {candidateFingerprint, itemFingerprint} from '../../lib/reviewer-capability/pool.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {control, item} from '../helpers/reviewer-capability-items.mjs';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'reviewer-capability');
const golden = JSON.parse(await readFile(join(FIXTURES, 'qwen-golden.json'), 'utf8'));
/** @param {...string} path */
const read = async (...path) => JSON.parse(await readFile(join(...path), 'utf8'));

const candidate = (/** @type {string} */ name, /** @type {any} */ extra = {}) => ({...item(`e ${name}`), candidateId: `c-${name}`, ...extra});

/** Builds pools through `pool build` over a scenario with these anchors (a copy of a real answer key, a brief, no files). */
const build = async (/** @type {import('node:test').TestContext} */ t, /** @type {any} */ {anchors = [control('a1', 'matched'), control('a2', 'not-matched')], candidates = [], role = 'requirements-reviewer', ...input}) => {
    const root = await createTemporaryDirectory(t, 'arw-pool-');
    const scenario = join(root, role, role === 'requirements-reviewer' ? 'code-spec' : 'runtime-migration');
    await mkdir(scenario, {recursive: true});
    await copyFile(join(FIXTURES, role, role === 'requirements-reviewer' ? 'code-spec' : 'runtime-migration', 'expected.json'), join(scenario, 'expected.json'));
    if (role === 'spec-readiness-reviewer') {
        // The answer keys of a Spec Readiness role balance only together.
        await mkdir(join(root, role, 'artifact-promotion'));
        await copyFile(join(FIXTURES, role, 'artifact-promotion', 'expected.json'), join(root, role, 'artifact-promotion', 'expected.json'));
        await copyFile(join(FIXTURES, role, 'repeats.json'), join(root, role, 'repeats.json'));
    }
    await writeFile(join(scenario, 'anchors.json'), JSON.stringify({anchors, synthetic: [{...control('s1', 'matched'), type: 'real'}]}));
    await writeFile(join(scenario, 'brief.md'), 'b');
    await writeFile(join(root, 'candidates.json'), JSON.stringify(candidates));
    return {result: await pool({action: 'build', candidates: [join(root, 'candidates.json')], name: 'p', root: join(root, 'pools'), scenario, ...input}), root: join(root, 'pools'), scenario};
};

test('pool build matches the pools qwen_strata builds for the same candidates', async t => {
    const root = await createTemporaryDirectory(t, 'arw-pool-');
    await writeFile(join(root, 'candidates.json'), JSON.stringify(golden.pools.candidates));
    const built = await pool({action: 'build', candidates: [join(root, 'candidates.json')], limit: golden.pools.limit, name: 'g', root, scenario: join(FIXTURES, 'requirements-reviewer', 'code-spec')});
    assert.equal(built.status, 'succeeded');
    assert.deepEqual(built.pools.map((/** @type {any} */ entry) => entry.pool.split('/').at(-1)), golden.pools.pools.map((/** @type {any} */ expected) => `pool-${expected.pool}.json`));
    for (const expected of golden.pools.pools) {
        const entries = await read(root, expected.pool, 'adj', `pool-${expected.pool}.json`);
        const {items} = await read(root, expected.pool, 'key.json');
        assert.deepEqual(entries.map((/** @type {any} */ entry) => [entry.id, entry.group, itemFingerprint(entry), items[entry.id].source, items[entry.id].stableId ?? items[entry.id].control]),
            expected.items.map((/** @type {any} */ entry) => [entry.id, entry.group, entry.fingerprint, entry.source, entry.ref]));
    }
});

test('pool build blocks what cannot be adjudicated fairly and writes nothing', async t => {
    const message = async (/** @type {any} */ input) => {
        const {result, root} = await build(t, input);
        assert.equal(result.status, 'blocked');
        await assert.rejects(readFile(join(root, 'p', 'key.json')), {code: 'ENOENT'});
        return result.diagnostics[0];
    };
    const same = Array.from({length: 8}, (_, index) => candidate(String(index), {expectation: 'same'}));
    assert.match(await message({limit: 3}), /Controls alone fill a pool/u);
    assert.match(await message({limit: 0}), /positive integer/u);
    assert.match(await message({candidates: [candidate('1'), candidate('1')]}), /repeated/u);
    assert.match(await message({anchors: [control('a1', 'matched')]}), /no not-matched control/u);
    assert.match(await message({anchors: [control('a1', 'matched', {family: 'other'}), control('a2', 'not-matched')]}), /family/u);
    assert.match(await message({anchors: [control('a1', 'matched', {expected: 'unsupported'}), control('a2', 'not-matched')]}), /expected/u);
    assert.match(await message({anchors: [control('a1', 'matched', {origin: {candidateId: 'c-1'}}), control('a2', 'not-matched')], candidates: [candidate('1')]}), /registered anchor/u);
    assert.match(await message({candidates: same, limit: 7}), /more than a pool/u);
    assert.match(await message({candidates: [candidate('1', {scenario: 'other'})], role: 'spec-readiness-reviewer'}), /sub-scenario/u);
});

test('pool build splits by expectation group into pools and skips decided candidates', async t => {
    const candidates = [candidate('1', {expectation: 'g1'}), candidate('2', {expectation: 'g1'}), candidate('3', {expectation: 'g2'}), candidate('4', {expectation: 'g3'})];
    const root = await createTemporaryDirectory(t, 'arw-pool-');
    const store = (/** @type {string} */ brief, /** @type {any} */ source) => ({decisions: {[source.candidateId]: {brief_sha256: brief, fingerprint: candidateFingerprint(source)}}});
    await writeFile(join(root, 'decided.json'), JSON.stringify({decisions: {...store(sha256('b'), candidates[3]).decisions, ...store('old', candidates[2]).decisions}}));
    const {result, root: pools} = await build(t, {candidates, decisions: [join(root, 'decided.json')], limit: 5});
    assert.deepEqual([result.pools.map((/** @type {any} */ entry) => entry.real), result.alreadyDecidedSkipped], [[2, 1], 1]);
    assert.equal((await read(pools, 'p-2', 'adj', 'pool-p-2.json')).filter((/** @type {any} */ entry) => entry.expectation === 'g2').length, 1);
    assert.equal((await build(t, {candidates, decisions: [join(root, 'nowhere.json')]})).result.status, 'blocked');
});
