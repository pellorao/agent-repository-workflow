import assert from 'node:assert/strict';
import {access, mkdir, readFile, writeFile} from 'node:fs/promises';
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
    assert.match(await readFile(join(target, 'AGENTS.md'), 'utf8'), /^# Agent Repository Workflow$/mu);
});

test('setup prepares the Spec Readiness Request', async t => {
    const target = join(await createTemporaryDirectory(t, 'arw-capability-setup-'), 'instance');
    const result = await setupScenario({scenario: join(FIXTURES, 'spec-readiness-reviewer', 'spec-readiness'), target});
    assert.equal(result.status, 'succeeded');
    assert.match(/** @type {any} */ (result).input.reportPath, /draft\.txt$/u);
});

test('setup blocks an existing target or a missing fixture', async t => {
    const root = await createTemporaryDirectory(t, 'arw-capability-setup-');
    const scenario = join(FIXTURES, 'spec-readiness-reviewer', 'spec-readiness');
    assert.equal((await setupScenario({scenario, target: root})).status, 'blocked');
    assert.equal((await setupScenario({scenario: join(FIXTURES, 'nowhere', 'none'), target: join(root, 'other')})).status, 'blocked');
});

test('the entry maps results to exit codes', async () => {
    const run = async (/** @type {string[]} */ ...args) => /** @type {any} */ (await runProcess(process.execPath, [ENTRY, ...args]));
    const [unknown, blocked] = await Promise.all([
        run('bogus'),
        run('score', join(FIXTURES, 'nowhere', 'none'), 'report.md', '--no-repair', '--agent', 'agent.json'),
    ]);
    assert.equal(unknown.exitCode, 2);
    assert.deepEqual([blocked.exitCode, JSON.parse(blocked.stdout).status], [1, 'blocked']);
});

test('the entry parses the repeatable options and the cell lists', async () => {
    const run = async (/** @type {string[]} */ ...args) => /** @type {any} */ (await runProcess(process.execPath, [ENTRY, ...args]));
    const [noCells, missingCell] = await Promise.all([run('summary', '--markdown'), run('summary', '--cell')]);
    assert.deepEqual([noCells.exitCode, JSON.parse(noCells.stdout).status], [1, 'blocked']);
    assert.equal(missingCell.exitCode, 2);
});


test('setup ignores signing and removes a failed scenario target', async t => {
    const root = await createTemporaryDirectory(t, 'arw-capability-settings-');
    const scenario = join(root, 'code-standards-reviewer', 'demo');
    await mkdir(join(scenario, 'base'), {recursive: true});
    await writeFile(join(scenario, 'expected.json'), '{}');
    const config = join(root, 'gitconfig');
    await writeFile(config, '[commit]\n    gpgsign = true\n[gpg]\n    program = missing-signing-program\n[core]\n    hooksPath = missing-hooks\n');
    const built = await runProcess(process.execPath, [ENTRY, 'setup', scenario, join(root, 'signed')], {env: {...process.env, GIT_CONFIG_GLOBAL: config}});
    assert.equal(built.status, 'exited');
    if (built.status !== 'exited') return;
    assert.equal(built.exitCode, 0, built.stderr);
    const target = join(root, 'failed');
    const failed = await runProcess(process.execPath, [ENTRY, 'setup', scenario, target], {env: {...process.env, GIT_AUTHOR_DATE: 'not-a-date'}});
    assert.equal(failed.status, 'exited');
    if (failed.status !== 'exited') return;
    assert.equal(JSON.parse(failed.stdout).stage, 'scenario-build');
    assert.match(failed.stderr, /invalid date/u);
    await assert.rejects(access(target), {code: 'ENOENT'});
});

test('pool build rejects non-positive, fractional and nonnumeric limits as usage errors', async () => {
    for (const limit of ['0', '-1', '1.5', 'abc']) {
        const result = await runProcess(process.execPath, [ENTRY, 'pool', 'build', 'scenario', 'root', 'pool', 'candidates', '--limit', limit]);
        assert.equal(result.status, 'exited');
        if (result.status !== 'exited') continue;
        assert.equal(result.exitCode, 2);
        assert.match(result.stderr, /--limit must be a positive integer/u);
    }
});
