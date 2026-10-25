import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {listPreTagArchiveKinds, RELEASE_POST_INIT_SCENARIO_ID, resolveReleaseValidationScenario} from '../../lib/release/release-validation-registry.mjs';
import {
    completeReleasePostInitChoice,
    createReleasePostInitChoiceHandoff,
    createReleasePostInitScenarioPlan,
    createReleaseValidationScenarioPlan,
    parseReleasePostInitChoiceState,
    releasePostInitAllowsLocalTag,
    resolveReleasePostInitChoice,
} from '../../lib/release/release-vm-validation.mjs';
import {runReleaseVmValidationCli} from '../../scripts/release-vm-validation.mjs';

const configuration = () => ({
    initializationIssueScenario: 'scenarios/ubuntu/fresh-agent-assisted',
    prepareBundles: {hostCommandTimeoutMs: 123_456},
    repositories: {sourceCheckout: {url: 'https://example.invalid/team/arw.git'}},
    vmware: {
        hardPowerOffCompatibility: {exitCode: 7, stderr: '', stdoutTemplate: 'off: {machineLocation}\n', vmrunVersion: 'vmrun test'},
        softPowerOffTimeoutMs: {Alpine: 1_000, Ubuntu: 2_000, 'Windows 11': 3_000},
    },
});

const candidateCommit = 'c'.repeat(40);
const bundleFacts = () => ({
    agentAssisted: {commit: 'a'.repeat(40), kind: 'agent-assisted'},
    candidate: {commit: candidateCommit, kind: 'candidate', priorRelease: {commit: 'e'.repeat(40), tag: '0.2.1'}},
    plain: {commit: 'b'.repeat(40), kind: 'plain'},
    status: 'inspected',
});
const preTagResult = (/** @type {string} */ commit) => ({
    archives: listPreTagArchiveKinds().map(archiveKind => ({archiveKind, status: 'created'})),
    candidateCommit: commit,
    status: 'completed',
});
const boundaryFor = (/** @type {string} */ root) => ({
    validateWorkspacePath: (/** @type {string} */ path) => assert.ok(path === root || path.startsWith(`${root}/`)),
});

test('post-init handoff requires this candidate complete core archives', () => {
    assert.throws(() => createReleasePostInitChoiceHandoff({
        candidateCommit,
        preTagResult: {...preTagResult(candidateCommit), archives: []},
    }), /pre-tag result/u);

    const handoff = createReleasePostInitChoiceHandoff({
        candidateCommit,
        preTagResult: preTagResult(candidateCommit),
    });
    assert.deepEqual(handoff, {
        candidateCommit,
        choices: ['run', 'skip'],
        decision: null,
        scenarioId: RELEASE_POST_INIT_SCENARIO_ID,
        status: 'pending',
    });
    assert.equal(Object.isFrozen(handoff), true);
    assert.throws(() => resolveReleasePostInitChoice({state: handoff}), /choice/u);
});



test('skip is explicit and never creates a post-init scenario plan', () => {
    const pending = createReleasePostInitChoiceHandoff({
        candidateCommit,
        preTagResult: preTagResult(candidateCommit),
    });
    const skipped = resolveReleasePostInitChoice({choice: 'skip', state: pending});

    assert.deepEqual(skipped, {...pending, decision: 'skip', status: 'skipped'});
    assert.equal(releasePostInitAllowsLocalTag(skipped), true);
    assert.throws(() => createReleasePostInitScenarioPlan({
        bundleFacts: bundleFacts(),
        candidateCommit,
        releaseConfiguration: configuration(),
        state: skipped,
    }), /run choice/u);
});

test('run binds the full fresh scenario to one candidate and failure cannot become skip', () => {
    const pending = createReleasePostInitChoiceHandoff({
        candidateCommit,
        preTagResult: preTagResult(candidateCommit),
    });
    const running = resolveReleasePostInitChoice({choice: 'run', state: pending});
    const plan = createReleasePostInitScenarioPlan({
        bundleFacts: bundleFacts(),
        candidateCommit,
        releaseConfiguration: configuration(),
        state: running,
    });

    assert.deepEqual(plan.scenarios.map(scenario => ({
        archiveKind: scenario.archiveKind,
        phase: scenario.phase,
        steps: scenario.steps.map(step => step.stepId),
    })), [{
        archiveKind: 'scenarios/ubuntu/fresh-agent-assisted',
        phase: 'post-init',
        steps: [
            '001-install',
            '002-init',
            '003-complete-initialization-issue',
            '004-workflow-update',
            '005-workflow-verify',
            '006-code-map-verify',
            '007-workflow-remove',
            '008-reinit',
            '009-final-workflow-verify',
            '010-final-code-map-verify',
            '011-uninstall',
        ],
    }]);
    assert.throws(() => createReleasePostInitScenarioPlan({
        bundleFacts: {...bundleFacts(), candidate: {commit: 'd'.repeat(40), kind: 'candidate', priorRelease: {commit: 'e'.repeat(40), tag: '0.2.1'}}},
        candidateCommit: 'd'.repeat(40),
        releaseConfiguration: configuration(),
        state: running,
    }), /candidate/u);

    const blocked = completeReleasePostInitChoice({outcome: 'failed', state: running});
    assert.deepEqual(blocked, {...running, status: 'blocked'});
    assert.equal(releasePostInitAllowsLocalTag(blocked), false);
    assert.throws(() => resolveReleasePostInitChoice({choice: 'skip', state: blocked}), /pending/u);
});

test('a repaired candidate requires a new choice and a successful run permits local tag', () => {
    const firstPending = createReleasePostInitChoiceHandoff({
        candidateCommit,
        preTagResult: preTagResult(candidateCommit),
    });
    const repairedCommit = 'd'.repeat(40);
    assert.throws(() => createReleasePostInitScenarioPlan({
        bundleFacts: bundleFacts(),
        candidateCommit: repairedCommit,
        releaseConfiguration: configuration(),
        state: resolveReleasePostInitChoice({choice: 'run', state: firstPending}),
    }), /candidate/u);

    const repairedPending = createReleasePostInitChoiceHandoff({
        candidateCommit: repairedCommit,
        preTagResult: preTagResult(repairedCommit),
    });
    assert.equal(repairedPending.status, 'pending');
    assert.equal(repairedPending.decision, null);
    const passed = completeReleasePostInitChoice({
        archive: {archiveKind: 'scenarios/ubuntu/fresh-agent-assisted', status: 'created'},
        outcome: 'passed',
        state: resolveReleasePostInitChoice({choice: 'run', state: repairedPending}),
    });
    assert.equal(passed.status, 'passed');
    assert.equal(releasePostInitAllowsLocalTag(passed), true);
});

test('post-init maintenance command persists skip without starting a VM and rejects reuse', async t => {
    const root = await createTemporaryDirectory(t, 'arw-post-init-skip-');
    const preTagResultPath = join(root, 'pre-tag-result.json');
    const statePath = join(root, 'post-init.json');
    await writeFile(preTagResultPath, `${JSON.stringify(preTagResult(candidateCommit))}\n`);
    const stdout = [];
    let starts = 0;
    const operations = {
        ...boundaryFor(root),
        errorOutput: {write: () => {}},
        output: {write: (/** @type {string} */ value) => stdout.push(value)},
        startRun: async () => {
            starts += 1;
            assert.fail('skip must not start a VM run');
        },
    };
    assert.equal(await runReleaseVmValidationCli([
        'post-init-choose', '--candidate', candidateCommit, '--choice', 'skip',
        '--pre-tag-result', preTagResultPath, '--state', statePath,
    ], operations), 0);
    assert.equal(starts, 0);
    assert.equal(JSON.parse(await readFile(statePath, 'utf8')).tagAllowed, true);
    assert.equal(await runReleaseVmValidationCli([
        'post-init-choose', '--candidate', candidateCommit, '--choice', 'run',
        '--pre-tag-result', preTagResultPath, '--state', statePath,
        '--config', join(root, 'vm.json'), '--workspace', root,
    ], operations), 1);
    assert.equal(starts, 0);
    assert.equal(stdout.length, 1);
});

test('post-init maintenance command binds run and resume terminal evidence to one candidate', async t => {
    const root = await createTemporaryDirectory(t, 'arw-post-init-run-');
    const preTagResultPath = join(root, 'pre-tag-result.json');
    const statePath = join(root, 'post-init.json');
    const runPath = join(root, 'runs', 'run.json');
    const resultPath = join(root, 'runs', 'result.json');
    await writeFile(preTagResultPath, `${JSON.stringify(preTagResult(candidateCommit))}\n`);
    const output = {write: () => {}};
    const errorOutput = {write: () => {}};
    assert.equal(await runReleaseVmValidationCli([
        'post-init-choose', '--candidate', candidateCommit, '--choice', 'run',
        '--pre-tag-result', preTagResultPath, '--state', statePath,
        '--config', join(root, 'vm.json'), '--workspace', root,
    ], {
        ...boundaryFor(root),
        errorOutput,
        output,
        startRun: async request => {
            assert.equal(/** @type {{decision: string}} */ (request.postInitChoiceState).decision, 'run');
            assert.equal(request.candidateCommit, candidateCommit);
            return {
                counts: {diagnostic: 0, formal: 0, unresolved: 1},
                pendingPath: join(root, 'pending.json'),
                resultPath: null,
                runPath,
                status: 'paused',
            };
        },
    }), 0);
    assert.equal(JSON.parse(await readFile(statePath, 'utf8')).tagAllowed, false);

    await mkdir(join(root, 'runs'), {recursive: true});
    const scenarioId = 'scenarios/ubuntu/fresh-agent-assisted';
    const archive = {archiveKind: scenarioId, status: 'created'};
    await writeFile(resultPath, `${JSON.stringify({
        archives: [archive],
        candidateCommit,
        cleanup: [{outcome: 'passed', scenarioId}],
        scenarios: [{
            archive,
            scenarioId,
            steps: resolveReleaseValidationScenario(scenarioId).steps.map(step => ({
                classification: 'formal',
                outcome: 'passed',
                stepId: step.stepId,
            })),
        }],
        status: 'completed',
    })}\n`);
    assert.equal(await runReleaseVmValidationCli([
        'post-init-resume', '--candidate', candidateCommit, '--state', statePath,
    ], {
        ...boundaryFor(root),
        errorOutput,
        output,
        resumeRun: async request => {
            assert.equal(request.runPath, runPath);
            return {
                counts: {diagnostic: 0, formal: 11, unresolved: 0},
                pendingPath: null,
                resultPath,
                runPath,
                status: 'completed',
            };
        },
    }), 0);
    assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), {
        candidateCommit,
        choiceState: {
            candidateCommit,
            choices: ['run', 'skip'],
            decision: 'run',
            scenarioId: 'scenarios/ubuntu/fresh-agent-assisted',
            status: 'passed',
        },
        resultPath,
        runPath,
        schemaVersion: 1,
        status: 'passed',
        tagAllowed: true,
    });
    assert.equal(await runReleaseVmValidationCli([
        'post-init-status', '--candidate', 'd'.repeat(40), '--state', statePath,
    ], {...boundaryFor(root), errorOutput, output}), 1);
    assert.equal(await runReleaseVmValidationCli([
        'post-init-resume', '--candidate', candidateCommit, '--state', statePath,
    ], {...boundaryFor(root), errorOutput, output, resumeRun: async () => assert.fail('terminal run must not resume')}), 1);
});

test('post-init run validates inputs before choice persistence and records start failure as blocked', async t => {
    const root = await createTemporaryDirectory(t, 'arw-post-init-failure-');
    const preTagResultPath = join(root, 'pre-tag-result.json');
    const statePath = join(root, 'post-init.json');
    await writeFile(preTagResultPath, `${JSON.stringify(preTagResult(candidateCommit))}\n`);
    const output = {write: () => {}};
    const errorOutput = {write: () => {}};

    assert.equal(await runReleaseVmValidationCli([
        'post-init-choose', '--candidate', candidateCommit, '--choice', 'run',
        '--pre-tag-result', preTagResultPath, '--state', statePath,
    ], {...boundaryFor(root), errorOutput, output}), 2);
    await assert.rejects(readFile(statePath), {code: 'ENOENT'});

    assert.equal(await runReleaseVmValidationCli([
        'post-init-choose', '--candidate', candidateCommit, '--choice', 'run',
        '--pre-tag-result', preTagResultPath, '--state', statePath,
        '--config', join(root, 'vm.json'), '--workspace', root,
    ], {
        ...boundaryFor(root),
        errorOutput,
        output,
        startRun: async () => {
            throw new Error('start failed');
        },
    }), 1);
    const blocked = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.tagAllowed, false);
    assert.equal(await runReleaseVmValidationCli([
        'post-init-choose', '--candidate', candidateCommit, '--choice', 'skip',
        '--pre-tag-result', preTagResultPath, '--state', statePath,
    ], {...boundaryFor(root), errorOutput, output}), 1);
});

test('post-init resume failure replaces running authorization with blocked state', async t => {
    const root = await createTemporaryDirectory(t, 'arw-post-init-resume-failure-');
    const preTagResultPath = join(root, 'pre-tag-result.json');
    const statePath = join(root, 'post-init.json');
    const runPath = join(root, 'run.json');
    await writeFile(preTagResultPath, `${JSON.stringify(preTagResult(candidateCommit))}\n`);
    const output = {write: () => {}};
    const errorOutput = {write: () => {}};
    assert.equal(await runReleaseVmValidationCli([
        'post-init-choose', '--candidate', candidateCommit, '--choice', 'run',
        '--pre-tag-result', preTagResultPath, '--state', statePath,
        '--config', join(root, 'vm.json'), '--workspace', root,
    ], {
        ...boundaryFor(root),
        errorOutput,
        output,
        startRun: async () => ({
            counts: {diagnostic: 0, formal: 0, unresolved: 1},
            pendingPath: join(root, 'pending.json'),
            resultPath: null,
            runPath,
            status: 'paused',
        }),
    }), 0);

    assert.equal(await runReleaseVmValidationCli([
        'post-init-resume', '--candidate', candidateCommit, '--state', statePath,
    ], {
        ...boundaryFor(root),
        errorOutput,
        output,
        resumeRun: async () => {
            throw new Error('resume failed');
        },
    }), 1);
    const blocked = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.choiceState.status, 'blocked');
    assert.equal(blocked.runPath, null);
    assert.equal(blocked.resultPath, null);
    assert.equal(blocked.tagAllowed, false);
});

test('post-init maintenance rejects a temporary path outside the current workspace before starting work', async t => {
    const root = await createTemporaryDirectory(t, 'arw-post-init-boundary-');
    const preTagResultPath = join(root, 'pre-tag-result.json');
    const outsideStatePath = join(root, '..', 'outside-post-init.json');
    await writeFile(preTagResultPath, `${JSON.stringify(preTagResult(candidateCommit))}\n`);
    let starts = 0;
    assert.equal(await runReleaseVmValidationCli([
        'post-init-choose', '--candidate', candidateCommit, '--choice', 'skip',
        '--pre-tag-result', preTagResultPath, '--state', outsideStatePath,
    ], {
        ...boundaryFor(root),
        errorOutput: {write: () => {}},
        output: {write: () => {}},
        startRun: async () => {
            starts += 1;
            return {counts: {diagnostic: 0, formal: 0, unresolved: 0}, pendingPath: null, resultPath: null, runPath: join(root, 'run.json'), status: 'paused'};
        },
    }), 1);
    assert.equal(starts, 0);

    const statePath = join(root, 'post-init.json');
    const running = resolveReleasePostInitChoice({
        choice: 'run',
        state: createReleasePostInitChoiceHandoff({candidateCommit, preTagResult: preTagResult(candidateCommit)}),
    });
    await writeFile(statePath, `${JSON.stringify({
        candidateCommit,
        choiceState: running,
        resultPath: null,
        runPath: join(root, 'run.json'),
        schemaVersion: 1,
        status: 'running',
        tagAllowed: false,
    })}\n`);
    let resumes = 0;
    assert.equal(await runReleaseVmValidationCli([
        'post-init-resume', '--candidate', candidateCommit, '--state', statePath,
        '--input', join(root, '..', 'outside-response.json'),
    ], {
        ...boundaryFor(root),
        errorOutput: {write: () => {}},
        output: {write: () => {}},
        resumeRun: async () => {
            resumes += 1;
            return {counts: {diagnostic: 0, formal: 0, unresolved: 0}, pendingPath: null, resultPath: null, runPath: join(root, 'run.json'), status: 'paused'};
        },
    }), 1);
    assert.equal(resumes, 0);
});
