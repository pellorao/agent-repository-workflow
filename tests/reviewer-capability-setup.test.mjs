import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {setupScenario} from '../lib/reviewer-capability-setup.mjs';
import {createTemporaryDirectory} from './helpers/cleanup.mjs';
import {runGit} from './helpers/git.mjs';
import {runProcess} from './helpers/process.mjs';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'reviewer-capability');
const ENTRY = join(import.meta.dirname, '..', 'scripts', 'reviewer-capability.mjs');

test('setup stages the candidate over the base commit and returns the reviewer input', async t => {
    const root = await createTemporaryDirectory(t, 'arw-capability-setup-');
    const scenario = join(root, 'code-standards-reviewer', 'demo');
    await mkdir(join(scenario, 'base'), {recursive: true});
    await mkdir(join(scenario, 'candidate'), {recursive: true});
    await writeFile(join(scenario, 'expected.json'), '{}');
    await writeFile(join(scenario, 'base', 'a.txt'), 'base\n');
    await writeFile(join(scenario, 'candidate', 'a.txt'), 'candidate\n');
    await writeFile(join(scenario, 'handoff.md'), 'Only the staged comparison.\n');
    const target = join(root, 'instance');
    const result = await setupScenario({scenario, target});
    assert.equal(result.status, 'succeeded');
    const input = /** @type {any} */ (result).input;
    assert.deepEqual([input.role, input.cwd, await readFile(input.reportPath, 'utf8')], ['code-standards-reviewer', target, '']);
    assert.match(input.handoff, /Only the staged comparison\.$/u);
    assert.equal((await runGit(target, ['diff', '--cached', '--name-only'])).stdout.trim(), 'a.txt');
    assert.equal((await runGit(target, ['log', '--format=%s'])).stdout.trim(), 'scenario base');
});

test('setup prepares the Spec Readiness Request', async t => {
    const target = join(await createTemporaryDirectory(t, 'arw-capability-setup-'), 'instance');
    const result = await setupScenario({scenario: join(FIXTURES, 'spec-readiness-reviewer', 'runtime-migration'), target});
    assert.equal(result.status, 'succeeded');
    assert.match(/** @type {any} */ (result).input.reportPath, /draft\.txt$/u);
});

test('setup blocks an existing target or a missing fixture', async t => {
    const root = await createTemporaryDirectory(t, 'arw-capability-setup-');
    const scenario = join(FIXTURES, 'spec-readiness-reviewer', 'runtime-migration');
    assert.equal((await setupScenario({scenario, target: root})).status, 'blocked');
    assert.equal((await setupScenario({scenario: join(FIXTURES, 'nowhere', 'none'), target: join(root, 'other')})).status, 'blocked');
});

test('the entry maps results to exit codes', async () => {
    const run = async (/** @type {string[]} */ ...args) => /** @type {any} */ (await runProcess(process.execPath, [ENTRY, ...args]));
    assert.equal((await run('bogus')).exitCode, 2);
    const blocked = await run('score', join(FIXTURES, 'nowhere', 'none'), 'report.md', '--no-repair', '--agent', 'agent.json');
    assert.deepEqual([blocked.exitCode, JSON.parse(blocked.stdout).status], [1, 'blocked']);
});
