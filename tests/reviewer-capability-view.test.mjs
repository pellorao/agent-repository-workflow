import assert from 'node:assert/strict';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {sha256} from '../lib/common/json.mjs';
import {poolPrompt} from '../lib/reviewer-capability/pool.mjs';
import {buildPool, poolViews} from '../lib/reviewer-capability/pool.mjs';
import {poolView} from '../lib/reviewer-capability-view.mjs';
import {createTemporaryDirectory} from './helpers/cleanup.mjs';
import {control} from './helpers/reviewer-capability-items.mjs';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'reviewer-capability');

/** An empty pool of `role` with the views its scenario name needs. */
const emptyPool = async (/** @type {import('node:test').TestContext} */ t, /** @type {string} */ role, /** @type {string} */ name, views = poolViews(role, name)) => {
    const root = await createTemporaryDirectory(t, 'arw-view-');
    await buildPool({anchors: {anchors: [control('a1', 'matched'), control('a2', 'not-matched')], synthetic: []}, anchorsSha256: null, brief: 'Pool <ADJ> <名>\n', candidates: [], limit: 10,
        name: 'p', role, root, scenario: '/s', views});
    return root;
};
const files = async (/** @type {string} */ directory) => (await readdir(directory, {recursive: true, withFileTypes: true})).filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name).slice(directory.length + 1)).sort();

test('pool view stages the reviewed state, the diff and a binding the prompt checks', async t => {
    const root = await emptyPool(t, 'code-standards-reviewer', 'demo');
    const scenario = join(await createTemporaryDirectory(t, 'arw-view-scenario-'), 'code-standards-reviewer', 'demo');
    await mkdir(join(scenario, 'base'), {recursive: true});
    await mkdir(join(scenario, 'candidate'), {recursive: true});
    await writeFile(join(scenario, 'expected.json'), '{}');
    await writeFile(join(scenario, 'base', 'a.txt'), 'base\n');
    await writeFile(join(scenario, 'candidate', 'a.txt'), 'candidate\n');
    const result = await poolView({name: 'p', root, scenarios: [scenario]});
    assert.deepEqual([result.status, result.views, result.files], ['succeeded', ['view', 'change.diff'], 2]);
    const adj = join(root, 'p', 'adj');
    assert.equal(await readFile(join(adj, 'view', 'a.txt'), 'utf8'), 'candidate\n');
    assert.match(await readFile(join(adj, 'change.diff'), 'utf8'), /-base\n\+candidate\n/u);
    const binding = JSON.parse(await readFile(join(root, 'p', 'view-binding.json'), 'utf8'));
    assert.deepEqual([binding.role, binding.views, Object.keys(binding.files), binding.files['view/a.txt'], binding.expectedSha256], ['code-standards-reviewer', ['view', 'change.diff'], ['change.diff', 'view/a.txt'],
        sha256('candidate\n'), {demo: sha256('{}')}]);
    assert.equal((await poolPrompt({name: 'p', root})).promptSha256.length, 64);
    assert.equal((await poolView({name: 'p', root, scenarios: [scenario]})).status, 'blocked');

    await writeFile(join(adj, 'view', 'a.txt'), 'tampered\n');
    await assert.rejects(poolPrompt({name: 'p', root}), /a\.txt differs from view-binding/u);
    await writeFile(join(adj, 'view', 'a.txt'), 'candidate\n');
    await writeFile(join(adj, 'view', 'extra.txt'), 'x');
    await assert.rejects(poolPrompt({name: 'p', root}), /differ from view-binding/u);
});

test('pool view blocks a pool that was not built and scenarios that do not fit it', async t => {
    const root = await emptyPool(t, 'code-standards-reviewer', 'demo');
    const scenario = join(FIXTURES, 'code-standards-reviewer', 'code-standards');
    assert.equal((await poolView({name: 'missing', root, scenarios: [scenario]})).status, 'blocked');
    assert.equal((await poolView({name: 'p', root, scenarios: [join(FIXTURES, 'requirements-reviewer', 'code-spec')]})).status, 'blocked');
    assert.equal((await poolView({name: 'p', root, scenarios: [scenario, scenario]})).status, 'blocked');
    assert.deepEqual(await files(join(root, 'p', 'adj')), ['pool-p.json']);
});

test('pool view of Spec Readiness needs both views of the role and redacts the Request', async t => {
    const scenario = (/** @type {string} */ name) => join(FIXTURES, 'spec-readiness-reviewer', name);
    const both = await emptyPool(t, 'spec-readiness-reviewer', 'runtime-migration');
    assert.equal((await poolView({name: 'p', root: both, scenarios: [scenario('runtime-migration')]})).status, 'blocked');
    // One view keeps this test to one scenario repository; the views of a real Spec Readiness pool are the two sub-scenarios.
    const root = await emptyPool(t, 'spec-readiness-reviewer', 'runtime-migration', ['view-rm']);
    assert.equal((await poolView({name: 'p', root, scenarios: [scenario('runtime-migration')]})).status, 'succeeded');
    const adj = join(root, 'p', 'adj');
    assert.equal(JSON.parse(await readFile(join(adj, 'view-rm', 'REVIEWER-REQUEST.json'), 'utf8')).draftPath, '<redacted>');
    assert.equal((await files(adj)).includes('change.diff'), false);
});
