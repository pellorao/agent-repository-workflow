import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {createValidationSourcesFixture, snapshotGitObservation} from '../helpers/release-fixture.mjs';
import {generateBootstrapArtifact} from '../../lib/installation/bootstrap-artifact.mjs';
import {
    createReleaseValidationScenarioPlan,
    createReleaseVmwareMachineLifecycleAdapter,
    loadReleaseValidationInputs,
    prepareReleaseValidationBundles,
} from '../../lib/release/release-vm-validation.mjs';

const configuration = () => ({
    initializationIssueScenario: 'scenarios/ubuntu/fresh-agent-assisted',
    prepareBundles: {hostCommandTimeoutMs: 123_456},
    repositories: {sourceCheckout: {url: 'https://example.invalid/team/arw.git'}},
    vmware: {
        hardPowerOffCompatibility: {
            exitCode: 7,
            stderr: '',
            stdoutTemplate: 'not powered on: {machineLocation}\n',
            vmrunVersion: 'vmrun test version',
        },
        softPowerOffTimeoutMs: {
            Alpine: 1_000,
            Ubuntu: 2_000,
            'Windows 11': 3_000,
        },
    },
});

/** @typedef {{arguments: string[], cwd: string, executable: string, input?: string | Uint8Array, timeoutMs?: number}} ProcessRequest */
/** @typedef {{location: string, machineType: 'VMware', nodeExecutables: Record<string, string>, snapshot: string, ssh: {hostKey: string, identityFile: string, port: number, user: string}, vmrun: string}} VmMachine */

/** @returns {VmMachine} */
const vmMachine = (/** @type {string} */ location) => ({
    location,
    machineType: 'VMware',
    nodeExecutables: {node: 'node'},
    snapshot: 'clean',
    ssh: {hostKey: 'test-host-key', identityFile: 'test-identity', port: 22, user: 'tester'},
    vmrun: 'C:\\VMware\\vmrun.exe',
});

/** @returns {{machines: Record<string, VmMachine>, maxParallelMachines: number, schemaVersion: 2}} */
const vmConfiguration = (/** @type {number} */ maxParallelMachines) => ({
    machines: {
        Alpine: vmMachine('C:\\VMs\\alpine.vmx'),
        Ubuntu: vmMachine('C:\\VMs\\ubuntu.vmx'),
        'Windows 11': vmMachine('C:\\VMs\\windows.vmx'),
    },
    maxParallelMachines,
    schemaVersion: 2,
});



test('Scenario Plan accepts inspected per-preparation target commits without a fixed source configuration', () => {
    const releaseConfiguration = configuration();
    const candidateCommit = 'c'.repeat(40);
    const bundleFacts = {
        agentAssisted: {commit: 'a'.repeat(40), kind: 'agent-assisted'},
        candidate: {commit: candidateCommit, kind: 'candidate', priorRelease: {commit: 'd'.repeat(40), tag: '0.2.1'}},
        plain: {commit: 'b'.repeat(40), kind: 'plain'},
        status: 'inspected',
    };

    const plan = createReleaseValidationScenarioPlan({bundleFacts, candidateCommit, releaseConfiguration});
    assert.equal(Object.isFrozen(plan), true);
    assert.equal(plan.scenarios.some(scenario => scenario.archiveKind === 'scenarios/ubuntu/fresh-agent-assisted'), false);
    assert.equal(plan.scenarios.some(scenario => scenario.steps.some(
        (/** @type {{ stepId: string; }} */ step) => step.stepId.endsWith('-complete-initialization-issue'),
    )), false);

    assert.throws(() => createReleaseValidationScenarioPlan({
        bundleFacts: {...bundleFacts, plain: {commit: '', kind: 'plain'}},
        candidateCommit,
        releaseConfiguration,
    }), /bundle facts are invalid/u);
});

test('VMware lifecycle Adapter uses the configured per-machine soft power-off timeout', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-machine-');
    const location = join(root, 'example.vmx');
    await writeFile(location, 'checkpoint.vmState = ""\n', 'utf8');
    /** @type {ProcessRequest[]} */
    const requests = [];
    let running = true;
    const machine = vmMachine(location);
    const adapter = createReleaseVmwareMachineLifecycleAdapter({
        processAdapter: {
            run: async (/** @type {ProcessRequest} */ request) => {
                requests.push(request);
                if (request.arguments.at(-1) === 'list') {
                    return {
                        exitCode: 0,
                        stderr: '',
                        stdout: running ? `Total running VMs: 1\n${machine.location}\n` : 'Total running VMs: 0\n',
                    };
                }
                if (request.arguments.at(-1) === 'soft') {
                    running = false;
                    return {exitCode: 0, stderr: '', stdout: ''};
                }
                assert.fail(`Unexpected VMware request: ${request.arguments.join(' ')}`);
            },
        },
        releaseConfiguration: configuration(),
    });

    const result = await adapter.run({machine, machineKey: 'Windows 11', operation: 'soft-power-off'});
    assert.equal(result.status, 'observed');
    const softRequest = requests.find(request => request.arguments.at(-1) === 'soft');
    if (softRequest === undefined) assert.fail('Expected VMware soft power-off request.');
    assert.equal(softRequest.timeoutMs, 3_000);
});

test('bundle preparation applies the configured timeout to every host Git command', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-bundles-');
    const releaseConfiguration = configuration();
    const candidateCommit = 'c'.repeat(40);
    /** @type {ProcessRequest[]} */
    const requests = [];
    const {configurationPath: sourcesConfigurationPath} = await createValidationSourcesFixture(t);
    const result = await prepareReleaseValidationBundles({
        candidateCommit,
        sourcesConfigurationPath,
        releaseConfiguration,
        workspaceDirectory,
    }, {
        async run(request) {
            requests.push(request);
            const snapshot = snapshotGitObservation(request);
            if (snapshot !== null) return snapshot;
            if (request.arguments[0] === 'show') {
                return {exitCode: 0, stderr: '', stdout: `${JSON.stringify({version: request.arguments[1].startsWith('refs/tags/') ? '0.2.1' : '0.3.0'})}\n`};
            }
            if (request.arguments[0] === 'tag') return {exitCode: 0, stderr: '', stdout: '0.2.1\n'};
            if (request.arguments[0] === 'rev-parse' && request.arguments.at(-1)?.startsWith('refs/tags/')) {
                return {exitCode: 0, stderr: '', stdout: `${'d'.repeat(40)}\n`};
            }
            const commit = request.cwd.endsWith('candidate')
                ? candidateCommit
                : request.cwd.endsWith('plain')
                    ? 'b'.repeat(40)
                    : 'a'.repeat(40);
            return {
                exitCode: 0,
                stderr: '',
                stdout: request.arguments[0] === 'rev-parse' ? `${commit}\n` : '',
            };
        },
    }, (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)));

    assert.equal(result.status, 'prepared');
    assert.equal(requests.filter(request => request.arguments[0] === 'fetch').length, 2);
    assert.equal(requests.filter(request => request.arguments.includes('hash-object')).length, 2);
    assert.equal(requests.every(request => request.timeoutMs === 123_456), true);
});
