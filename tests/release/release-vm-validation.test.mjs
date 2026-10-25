import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFile, cp, lstat as lstatImplementation, mkdir, readFile as readFileImplementation, readdir, rename, rm, symlink, writeFile as writeFileImplementation} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, resolve, win32} from 'node:path';
import test from 'node:test';

import {runExitedProcess, runSuccessfulProcess} from '../helpers/process.mjs';
import {runGit} from '../helpers/git.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {createValidationSourcesFixture, snapshotGitObservation} from '../helpers/release-fixture.mjs';
import {createRepository} from '../helpers/repository-fixture.mjs';
import {
    RELEASE_ESM_LIFECYCLE_ENTRIES,
    RELEASE_MACHINE_KEYS,
    listPreTagArchiveKinds as listPreTagArchiveKindsImplementation,
    listReleaseValidationScenarios as listReleaseValidationScenariosImplementation,
    resolveReleaseValidationRuntimeRole as resolveReleaseValidationRuntimeRoleImplementation,
    resolveReleaseValidationStep as resolveReleaseValidationStepImplementation,
} from '../../lib/release/release-validation-registry.mjs';
import {loadReleaseValidationConfiguration} from '../../lib/release/release-validation-config.mjs';
import {resolveReleaseGuestTagAction} from '../../lib/release/release-guest-validation.mjs';
import {
    captureReleaseGuestStep as captureReleaseGuestStepImplementation,
    compareReleaseGuestArchive as compareReleaseGuestArchiveImplementation,
    completeReleaseMechanicalEvaluation as completeReleaseMechanicalEvaluationImplementation,
    createReleasePostInitChoiceHandoff as createReleasePostInitChoiceHandoffImplementation,
    createReleasePostInitScenarioPlan as createReleasePostInitScenarioPlanImplementation,
    createReleaseInitializationIssueActionRequest as createReleaseInitializationIssueActionRequestImplementation,
    createReleaseHostProcessAdapter as createReleaseHostProcessAdapterImplementation,
    createReleaseSessionWorkspaceBoundary as createReleaseSessionWorkspaceBoundaryImplementation,
    createReleaseValidationScenarioPlan as createReleaseValidationScenarioPlanImplementation,
    createReleaseVmwareGuestAdapter as createReleaseVmwareGuestAdapterImplementation,
    createReleaseVmwareMachineLifecycleAdapter as createReleaseVmwareMachineLifecycleAdapterImplementation,
    evaluateReleaseMechanicalContract as evaluateReleaseMechanicalContractImplementation,
    finalizeReleaseGuestStep as finalizeReleaseGuestStepImplementation,
    finalizeReleaseVmGuestStep as finalizeReleaseVmGuestStepImplementation,
    inspectReleaseValidationBundles as inspectReleaseValidationBundlesImplementation,
    loadReleaseVmConfiguration as loadReleaseVmConfigurationImplementation,
    matchesReleaseSoftPowerOffExpectation as matchesReleaseSoftPowerOffExpectationImplementation,
    prepareReleaseStep as prepareReleaseStepImplementation,
    prepareReleaseValidationBundles as prepareReleaseValidationBundlesImplementation,
    releaseGuestFailureSummary as releaseGuestFailureSummaryImplementation,
    resolveReleasePostInitChoice as resolveReleasePostInitChoiceImplementation,
    resumeReleaseValidationRun as resumeReleaseValidationRunImplementation,
    runReleaseVmGuestStep as runReleaseVmGuestStepImplementation,
    startReleaseValidationRun as startReleaseValidationRunImplementation,
    validateGuestNodeVersion as validateGuestNodeVersionImplementation,
} from '../../lib/release/release-vm-validation.mjs';
import {parseReleaseGitStatus} from '../../lib/release/release-step-review-material.mjs';
import {ARW_VERSION} from '../../lib/arw-common/identity.mjs';
import {runRepositoryWorkflow} from '../../lib/repository-workflow/workflow.mjs';
import {
    parseWorkflowLock as parseWorkflowLockImplementation,
    serializeWorkflowLock as serializeWorkflowLockImplementation,
} from '../../lib/repository-workflow/workflow-lock.mjs';
import {
    buildExpectedInstallationEntries as buildExpectedInstallationEntriesImplementation,
    buildReleaseWorkflowExpectedState as buildReleaseWorkflowExpectedStateImplementation,
    captureSelectedReleaseInstallation as captureSelectedReleaseInstallationImplementation,
    captureReleaseMechanicalSnapshot as captureReleaseMechanicalSnapshotImplementation,
    checkLifecycleEntries as checkLifecycleEntriesImplementation,
    cloneBundle as cloneBundleImplementation,
    createReleaseWorkflowPlanCapture as createReleaseWorkflowPlanCaptureImplementation,
    executeReleaseFiniteOperation as executeReleaseFiniteOperationImplementation,
    initializeGitBaseline as initializeGitBaselineImplementation,
    loadExpectedInstallationRelease as loadExpectedInstallationReleaseImplementation,
    prepareReleaseWorkflowPlan as prepareReleaseWorkflowPlanImplementation,
    requireCompletedInitializationIssue as requireCompletedInitializationIssueImplementation,
    resolveReleaseScenarioTarget as resolveReleaseScenarioTargetImplementation,
    validateReleasePreparedScenario as validateReleasePreparedScenarioImplementation,
} from '../../scripts/release-guest-step.mjs';
import {runReleaseVmValidationCli as runReleaseVmValidationCliImplementation} from '../../scripts/release-vm-validation.mjs';

const invokeTestBoundary = (/** @type {unknown} */ implementation, /** @type {unknown[]} */ args) => {
    if (typeof implementation !== 'function') throw new Error('Expected callable test boundary implementation.');
    return Reflect.apply(implementation, undefined, args);
};

const lstat = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(lstatImplementation, args);
const readFile = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(readFileImplementation, args);
const writeFile = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(writeFileImplementation, args);
const parseWorkflowLock = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(parseWorkflowLockImplementation, args);
const serializeWorkflowLock = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(serializeWorkflowLockImplementation, args);
const listPreTagArchiveKinds = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(listPreTagArchiveKindsImplementation, args);
const listReleaseValidationScenarios = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(listReleaseValidationScenariosImplementation, args);
const resolveReleaseValidationRuntimeRole = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(resolveReleaseValidationRuntimeRoleImplementation, args);
const resolveReleaseValidationStep = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(resolveReleaseValidationStepImplementation, args);

const captureReleaseGuestStep = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(captureReleaseGuestStepImplementation, args);
const compareReleaseGuestArchive = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(compareReleaseGuestArchiveImplementation, args);
const completeReleaseMechanicalEvaluation = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(completeReleaseMechanicalEvaluationImplementation, args);
const createReleaseInitializationIssueActionRequest = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(createReleaseInitializationIssueActionRequestImplementation, args);
const createReleaseHostProcessAdapter = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(createReleaseHostProcessAdapterImplementation, args);
const createReleaseSessionWorkspaceBoundary = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(createReleaseSessionWorkspaceBoundaryImplementation, args);
const createReleaseValidationScenarioPlan = (/** @type {unknown[]} */ ...args) => {
    const input = args[0];
    if (input !== null && typeof input === 'object' && !Array.isArray(input) && !Object.hasOwn(input, 'releaseConfiguration')) {
        args[0] = {...input, releaseConfiguration: RELEASE_CONFIGURATION};
    }
    return invokeTestBoundary(createReleaseValidationScenarioPlanImplementation, args);
};
const createReleaseVmwareGuestAdapter = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(createReleaseVmwareGuestAdapterImplementation, args);
const createReleaseVmwareMachineLifecycleAdapter = (/** @type {unknown[]} */ ...args) => {
    const input = args[0];
    if (input === undefined) {
        args[0] = {releaseConfiguration: RELEASE_CONFIGURATION};
    } else if (input !== null && typeof input === 'object' && !Array.isArray(input) && !Object.hasOwn(input, 'releaseConfiguration')) {
        args[0] = {...input, releaseConfiguration: RELEASE_CONFIGURATION};
    }
    return invokeTestBoundary(createReleaseVmwareMachineLifecycleAdapterImplementation, args);
};
const evaluateReleaseMechanicalContract = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(evaluateReleaseMechanicalContractImplementation, args);
const finalizeReleaseGuestStep = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(finalizeReleaseGuestStepImplementation, args);
const finalizeReleaseVmGuestStep = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(finalizeReleaseVmGuestStepImplementation, args);
const inspectReleaseValidationBundles = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(inspectReleaseValidationBundlesImplementation, args);
const loadReleaseVmConfiguration = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(loadReleaseVmConfigurationImplementation, args);
const matchesReleaseSoftPowerOffExpectation = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(matchesReleaseSoftPowerOffExpectationImplementation, args);
const prepareReleaseStep = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(prepareReleaseStepImplementation, args);
const prepareReleaseValidationBundles = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(prepareReleaseValidationBundlesImplementation, args);
const releaseGuestFailureSummary = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(releaseGuestFailureSummaryImplementation, args);
const resumeReleaseValidationRun = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(resumeReleaseValidationRunImplementation, args);
const runReleaseVmGuestStep = (/** @type {unknown[]} */ ...args) => {
    const request = args[0];
    if (request !== null && typeof request === 'object' && !Array.isArray(request) && 'configuration' in request) {
        const configuration = request.configuration;
        if (configuration !== null && typeof configuration === 'object' && !Array.isArray(configuration) && 'machines' in configuration) {
            const machines = configuration.machines;
            if (machines !== null && typeof machines === 'object' && !Array.isArray(machines)) {
                const fallback = Object.values(machines)[0] ?? {};
                args[0] = {
                    ...request,
                    configuration: {
                        ...configuration,
                        machines: Object.fromEntries(['Alpine', 'Ubuntu', 'Windows 11'].map(key => [key, Object.hasOwn(machines, key) ? Reflect.get(machines, key) : fallback])),
                    },
                };
            }
        }
    }
    const options = args[1];
    if (options === undefined) {
        args[1] = {releaseConfiguration: RELEASE_CONFIGURATION};
    } else if (options !== null && typeof options === 'object' && !Array.isArray(options) && !Object.hasOwn(options, 'releaseConfiguration')) {
        args[1] = {...options, releaseConfiguration: RELEASE_CONFIGURATION};
    }
    return invokeTestBoundary(runReleaseVmGuestStepImplementation, args);
};
const startReleaseValidationRun = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(startReleaseValidationRunImplementation, args);
const validateGuestNodeVersion = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(validateGuestNodeVersionImplementation, args);
const buildExpectedInstallationEntries = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(buildExpectedInstallationEntriesImplementation, args);
const buildReleaseWorkflowExpectedState = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(buildReleaseWorkflowExpectedStateImplementation, args);
const captureSelectedReleaseInstallation = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(captureSelectedReleaseInstallationImplementation, args);
const captureReleaseMechanicalSnapshot = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(captureReleaseMechanicalSnapshotImplementation, args);
const checkLifecycleEntries = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(checkLifecycleEntriesImplementation, args);
const cloneBundle = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(cloneBundleImplementation, args);
const createReleaseWorkflowPlanCapture = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(createReleaseWorkflowPlanCaptureImplementation, args);
const executeReleaseFiniteOperation = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(executeReleaseFiniteOperationImplementation, args);
const initializeGitBaseline = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(initializeGitBaselineImplementation, args);
const loadExpectedInstallationRelease = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(loadExpectedInstallationReleaseImplementation, args);
const prepareReleaseWorkflowPlan = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(prepareReleaseWorkflowPlanImplementation, args);
const requireCompletedInitializationIssue = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(requireCompletedInitializationIssueImplementation, args);
const validateReleasePreparedScenario = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(validateReleasePreparedScenarioImplementation, args);
const resolveReleaseScenarioTarget = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(resolveReleaseScenarioTargetImplementation, args);
const runReleaseVmValidationCli = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(runReleaseVmValidationCliImplementation, args);

const loadedReleaseConfiguration = await loadReleaseValidationConfiguration();
if (loadedReleaseConfiguration.status !== 'succeeded' || !('value' in loadedReleaseConfiguration)) {
    throw new Error(`Release validation configuration is unavailable: ${JSON.stringify(loadedReleaseConfiguration)}.`);
}
const RELEASE_CONFIGURATION = loadedReleaseConfiguration.value;
const RELEASE_TARGETS = {
    ...RELEASE_CONFIGURATION.repositories,
    agentAssisted: {commit: '1'.repeat(40)},
    plain: {commit: '2'.repeat(40)},
};

const createCurrentReleaseSource = async (/** @type {string} */ sourceDirectory) => {
    const repositoryRoot = process.cwd();
    const runtimeFiles = [
        'arw.mjs',
        'lib/arw-common/codex-configuration.mjs',
        'lib/arw-common/platform-adapter.mjs',
        'lib/arw-common/platform-environment.mjs',
        'lib/arw-common/product-identity.mjs',
        'lib/arw-common/skill-identity.mjs',
        'lib/common/canonical-contract.mjs',
        'lib/common/filesystem.mjs',
        'lib/common/json.mjs',
        'lib/common/text-policy.mjs',
        'lib/installation/installation-payload.mjs',
        'lib/installation/release.mjs',
        'lib/workflow-distribution/workflow-distribution.mjs',
    ];
    const files = [
        'arw',
        'config.install.json',
        'package.json',
        'distribution/config.json',
        'distribution/projections/config.json',
        'distribution/projections/codex/config.toml',
        'distribution/baseline/.arwignore',
        'distribution/baseline/docs/agents/roles/code-spec-reviewer.md',
        ...runtimeFiles,
    ];
    await Promise.all([...new Set(files.map(path => dirname(join(sourceDirectory, path))))]
        .map(path => mkdir(path, {recursive: true})));
    await Promise.all([
        mkdir(join(sourceDirectory, 'distribution', 'skills'), {recursive: true}),
        writeFile(join(sourceDirectory, 'release-manifest.json'), `${JSON.stringify({
            configSeed: 'config.install.json',
            distributionRoot: 'distribution',
            launchers: {darwin: ['arw'], linux: ['arw'], win32: ['arw']},
            runtimeFiles,
        }, null, 2)}\n`, 'utf8'),
        ...files.map(path => copyFile(
            join(repositoryRoot, path), join(sourceDirectory, path),
        )),
    ]);
    await runGit(sourceDirectory, ['init', '--quiet']);
    await runGit(sourceDirectory, ['add', '-A']);
    await runGit(sourceDirectory, ['-c', 'user.name=ARW Test', '-c', 'user.email=arw@example.invalid', 'commit', '--quiet', '-m', 'current release candidate']);
};

const createCurrentReleaseBundle = async (/** @type {{bundlePath: string, sourceDirectory: string}} */ {bundlePath, sourceDirectory}) => {
    const repositoryRoot = process.cwd();
    const manifest = JSON.parse(await readFile(join(repositoryRoot, 'release-manifest.json'), 'utf8'));
    await mkdir(sourceDirectory, {recursive: true});
    await cp(join(repositoryRoot, 'lib'), join(sourceDirectory, 'lib'), {recursive: true});
    await cp(join(repositoryRoot, manifest.distributionRoot), join(sourceDirectory, manifest.distributionRoot), {recursive: true});
    const files = new Set([
        'config.install.json',
        'install.mjs',
        'package.json',
        'release-manifest.json',
        'scripts/prepare-release-version-fixtures.mjs',
        'scripts/release-guest-step.mjs',
        ...manifest.runtimeFiles.filter((/** @type {string} */ path) => !path.startsWith('lib/')),
        ...Object.values(manifest.launchers).flat(),
    ]);
    for (const path of files) {
        const target = join(sourceDirectory, ...path.split('/'));
        await mkdir(dirname(target), {recursive: true});
        await copyFile(join(repositoryRoot, ...path.split('/')), target);
    }
    await runGit(sourceDirectory, ['init', '--quiet']);
    await runGit(sourceDirectory, ['add', '-A']);
    await runGit(sourceDirectory, ['-c', 'user.name=ARW Test', '-c', 'user.email=arw@example.invalid', 'commit', '--quiet', '-m', 'current release candidate']);
    await runGit(sourceDirectory, ['branch', 'arw-validation', 'HEAD']);
    await runGit(sourceDirectory, ['bundle', 'create', bundlePath, 'refs/heads/arw-validation']);
};

test('release guest expected Installation combines verified Release identity with platform payload bytes', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-expected-installation-');
    const sourceDirectory = join(root, 'source');
    await createCurrentReleaseSource(sourceDirectory);
    const version = JSON.parse(await readFile(join(sourceDirectory, 'package.json'), 'utf8')).version;
    await runGit(sourceDirectory, ['tag', version]);

    const release = await loadExpectedInstallationRelease({
        expectedSource: sourceDirectory,
        expectedVersion: version,
        platform: 'linux',
    });

    assert.equal(release.status, 'succeeded');
    assert.ok(Array.isArray(release.managedFiles));
    assert.ok(release.managedFiles.includes('arw.mjs'));
    assert.ok(release.sourceFiles instanceof Map);
    assert.deepEqual(release.sourceFiles.get('arw.mjs'), await readFile(join(sourceDirectory, 'arw.mjs')));
    assert.deepEqual(release.configSeedBytes, await readFile(join(sourceDirectory, 'config.install.json')));
});

/** @typedef {{arguments: string[], cwd?: string, executable: string, hostPath?: unknown, input?: Buffer | string, machineKey: string, operation: string, remoteArguments: string[], timeoutMs?: number, [key: string]: unknown}} TestRequest */
/** @typedef {{hostPath?: unknown, hostPaths?: string[], remoteArguments?: string[]}} GuestRequest */
/** @typedef {{arguments?: string[], classification?: string, code?: string, configured?: boolean, handoffId?: string, kind?: string, machineKey?: string, matchesExpected?: boolean, operation?: string, outcome?: string, path?: string, remoteArguments?: string[], request?: GuestRequest, resultPath?: string, scenarioId?: string, status?: string, stepId?: string, steps?: TestRecord[], summary?: string | null, [key: string]: unknown}} TestRecord */
/** @typedef {TestRecord & {archiveKind: string, machineKey: string, steps: TestRecord[]}} TestScenario */
/** @typedef {{candidateCommit: string, scenarios: TestScenario[]}} TestPlan */
/** @typedef {{beforeApply: (request: {canonical: string}) => unknown, choices: Record<string, string | undefined>, distributionDirectory: string, environmentFacts: {codex: {resolverInputs: {userHome: string}}}, operation: string, repositoryRoot: string, runtimeEnvironment: Record<string, string>}} WorkflowRunnerOptions */

/** @returns {TestRecord[]} */
const testRecords = () => [];
/** @returns {TestRequest[]} */
const testRequests = () => [];
/** @returns {Array<{arguments: string[], executable: string}>} */
const testProcessCalls = () => [];
/** @returns {Array<{arguments: string[], cwd: string}>} */
const testBundleProcessCalls = () => [];
/** @returns {unknown[][]} */
const testArgumentLists = () => [];
/** @returns {string[]} */
const stringList = () => [];
const popString = (/** @type {string[]} */ values) => requireValue(values.pop(), 'Expected captured output.');

/**
 * @template T
 * @param {T | null | undefined} value
 * @param {string} message
 * @returns {T}
 */
const requireValue = (value, message) => {
    if (value === null || value === undefined) throw new Error(message);
    return value;
};
const requireString = (/** @type {unknown} */ value, /** @type {string} */ message) => {
    if (typeof value !== 'string') throw new Error(message);
    return value;
};
const requireError = (/** @type {unknown} */ value) => {
    if (!(value instanceof Error)) throw new Error('Expected Error instance.');
    return value;
};

const ordinaryFile = {isFile: () => true, isSymbolicLink: () => false};
const ordinaryDirectory = {isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false};
const symbolicLink = {isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true};

test('release host process Adapter terminates a child at its requested timeout', async () => {
    const adapter = createReleaseHostProcessAdapter();
    await assert.rejects(adapter.run({
        arguments: ['-e', 'setInterval(() => {}, 1000)'],
        cwd: process.cwd(),
        executable: process.execPath,
        timeoutMs: 100,
    }), error => error !== null && typeof error === 'object' && 'code' in error && error.code === 'ETIMEDOUT');
});

test('release host process Adapter rejects input-stream failure when a child exits before reading input', async () => {
    await assert.rejects(createReleaseHostProcessAdapter().run({
        arguments: ['-e', 'process.exit(7)'],
        cwd: process.cwd(),
        executable: process.execPath,
        input: 'x'.repeat(2 ** 20),
    }), error => error !== null && typeof error === 'object' && 'code' in error && ['EPIPE', 'EOF'].includes(String(error.code)));
});


const pathFor = (/** @type {string} */ name) => resolve('validation', ...name.split('\\'));
/** @typedef {{location: string, machineType: 'VMware', nodeExecutables: {recommended: string, minimum?: string}, snapshot: string, ssh: {hostKey: string, identityFile: string, port: number, user: string}, vmrun: string}} TestMachine */
/** @typedef {{maxParallelMachines: number, machines: Record<string, TestMachine>, schemaVersion: number}} TestConfiguration */
/** @returns {TestMachine} */
const machine = (/** @type {{minimum?: boolean}} */ {minimum = false} = {}) => ({
    location: pathFor('guest.vmx'),
    machineType: 'VMware',
    nodeExecutables: {
        ...(minimum ? {minimum: '/opt/node24/bin/node'} : {}),
        recommended: minimum ? '/usr/bin/node' : pathFor('node.exe'),
    },
    snapshot: 'baseline',
    ssh: {
        hostKey: 'ssh-ed25519 AAAA fixture-comment',
        identityFile: pathFor('identity'),
        port: 22,
        user: 'test',
    },
    vmrun: pathFor('vmrun.exe'),
});
/** @returns {TestConfiguration} */
const configurationImplementation = () => ({
    maxParallelMachines: 3,
    machines: {
        Alpine: machine(),
        Ubuntu: machine({minimum: true}),
        'Windows 11': machine(),
    },
    schemaVersion: 2,
});
const configuration = () => invokeTestBoundary(configurationImplementation, []);
const memoryFileSystem = (/** @type {TestConfiguration} */ value) => ({
    lstat: async () => ordinaryFile,
    readFile: async () => JSON.stringify(value),
});

test('Runner accepts only the exact Node.js major assigned to each runtime role', async () => {
    const selectedMachine = machine({minimum: true});
    const fixtures = [
        {accepted: true, runtime: 'minimum', version: 'v24.18.0'},
        {accepted: false, runtime: 'minimum', version: 'v21.7.0'},
        {accepted: false, runtime: 'minimum', version: 'v25.0.0'},
        {accepted: true, runtime: 'recommended', version: 'v24.18.0'},
        {accepted: false, runtime: 'recommended', version: 'v23.11.1'},
        {accepted: false, runtime: 'recommended', version: 'v25.0.0'},
    ];
    for (const fixture of fixtures) {
        const calls = testArgumentLists();
        const operation = validateGuestNodeVersion({
            machine: selectedMachine,
            machineKey: 'Ubuntu',
            processAdapter: {
                run: async (/** @type {{remoteArguments: string[]}} */ request) => {
                    calls.push(request.remoteArguments);
                    return {exitCode: 0, stderr: '', stdout: `${fixture.version}\n`};
                },
            },
            runtime: fixture.runtime,
            workspaceDirectory: pathFor('workspace'),
        });
        if (fixture.accepted) {
            assert.equal(await operation, fixture.version);
        } else {
            await assert.rejects(operation, /requires major/u);
        }
        const expectedExecutable = fixture.runtime === 'minimum'
            ? selectedMachine.nodeExecutables.minimum
            : selectedMachine.nodeExecutables.recommended;
        assert.deepEqual(calls, [[expectedExecutable, '--version']]);
    }
});

test('Runner rejects a prepared scenario with the wrong runtime major before another guest operation', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-prepared-runtime-');
    const runId = '17171717-1717-4171-8171-171717171717';
    const scenarioId = 'observations/ubuntu/floor';
    const guestWorkspace = `/tmp/arw-release-validation/${runId}/observations-ubuntu-floor`;
    const preparationPath = join(workspaceDirectory, 'runs', runId, 'scenario-ready', ...scenarioId.split('/'), 'scenario-ready.json');
    await mkdir(dirname(preparationPath), {recursive: true});
    await writeFile(preparationPath, `${JSON.stringify({
        auditedDirectory: `${guestWorkspace}/source`,
        homeDirectory: `${guestWorkspace}/home`,
        nodeVersion: 'v25.0.0',
        scenarioId,
        sourceDirectory: `${guestWorkspace}/source`,
        status: 'prepared',
        targetDirectory: null,
        workspaceDirectory: guestWorkspace,
    })}\n`);
    let guestOperations = 0;
    await assert.rejects(runReleaseVmGuestStep({
        configuration: configuration(),
        machineKey: 'Ubuntu',
        scenarioId,
        stepId: '001-check-esm-syntax',
        workspaceDirectory,
    }, {
        guestAdapter: {
            run: async () => {
                guestOperations += 1;
                return {exitCode: 0, stderr: '', stdout: ''};
            },
        },
        runId,
        scenarioPrepared: true,
        workspaceBoundary: () => {},
    }), /requires major 24/u);
    assert.equal(guestOperations, 0);
});

test('Registry scenario preparation drives Node.js 24 minimum and recommended runtimes without development tools', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-runtime-flow-');
    const candidateCommit = 'a'.repeat(40);
    const releaseConfiguration = RELEASE_CONFIGURATION;
    const plan = createReleaseValidationScenarioPlan({
        bundleFacts: {
            agentAssisted: {commit: RELEASE_TARGETS.agentAssisted.commit, kind: 'agent-assisted'},
            candidate: {commit: candidateCommit, kind: 'candidate', priorRelease: {commit: 'd'.repeat(40), tag: '0.2.1'}},
            plain: {commit: RELEASE_TARGETS.plain.commit, kind: 'plain'},
            status: 'inspected',
        },
        candidateCommit,
        releaseConfiguration,
    });
    await writeFile(join(workspaceDirectory, 'bundles.json'), `${JSON.stringify({
        bundles: {
            agentAssisted: join(workspaceDirectory, 'agentAssisted.bundle'),
            candidate: join(workspaceDirectory, 'candidate.bundle'),
            plain: join(workspaceDirectory, 'plain.bundle'),
        },
        candidateCommit,
        priorRelease: {commit: 'd'.repeat(40), tag: '0.2.1'},
        targetCommits: {agentAssisted: RELEASE_TARGETS.agentAssisted.commit, plain: RELEASE_TARGETS.plain.commit},
        status: 'prepared',
    })}\n`);
    await Promise.all(['agentAssisted', 'candidate', 'plain']
        .map(name => writeFile(join(workspaceDirectory, `${name}.bundle`), name)));
    /** @type {string[][]} */
    const guestCommands = [];
    /** @type {Array<{machineKey: string, hostPaths: string[], commits: string[]}>} */
    const bundleTransfers = [];
    const guestAdapter = {
        copyToGuest: async (/** @type {{machineKey: string, hostPaths: string[]}} */ request) => {
            const commits = [];
            for (const path of request.hostPaths) {
                const heads = await processAdapter.run({arguments: ['bundle', 'list-heads', path, 'refs/heads/arw-validation']});
                commits.push(heads.stdout.split(' ')[0]);
            }
            bundleTransfers.push({machineKey: request.machineKey, hostPaths: [...request.hostPaths], commits});
        },
        run: async (/** @type {{machineKey: string, remoteArguments: string[]}} */ request) => {
            guestCommands.push(request.remoteArguments);
            if (request.remoteArguments.at(-1) === '--version') {
                return {
                    exitCode: 0,
                    stderr: '',
                    stdout: request.remoteArguments[0] === '/opt/node24/bin/node' ? 'v24.0.0\n' : 'v24.18.0\n',
                };
            }
            if (request.remoteArguments.some((/** @type {string} */ argument) => argument.endsWith('release-guest-step.mjs'))) {
                const scenarioId = request.remoteArguments[request.remoteArguments.indexOf('--scenario') + 1];
                const guestWorkspace = request.remoteArguments[request.remoteArguments.indexOf('--workspace') + 1];
                const separator = request.machineKey === 'Windows 11' ? '\\' : '/';
                const selectedScenario = plan.scenarios.find((/** @type {TestScenario} */ scenario) => scenario.archiveKind === scenarioId);
                const firstStep = requireValue(selectedScenario, 'Expected planned scenario.').steps[0];
                const homeDirectory = `${guestWorkspace}${separator}home`;
                const sourceDirectory = `${guestWorkspace}${separator}source`;
                const targetDirectory = scenarioId.startsWith('scenarios/') ? `${guestWorkspace}${separator}target` : null;
                const auditedDirectory = firstStep.auditedLocation === 'repository'
                    ? targetDirectory
                    : firstStep.auditedLocation === 'source-checkout'
                        ? sourceDirectory
                        : homeDirectory;
                return {exitCode: 0, stderr: '', stdout: `${JSON.stringify({
                    auditedDirectory,
                    homeDirectory,
                    scenarioId,
                    sourceDirectory,
                    status: 'prepared',
                    targetDirectory,
                    workspaceDirectory: guestWorkspace,
                })}\n`};
            }
            return {exitCode: 0, stderr: '', stdout: ''};
        },
    };
    const processAdapter = bundleProcessAdapter(candidateCommit);
    const prepared = [];
    for (const scenario of plan.scenarios) {
        const result = await runReleaseVmGuestStep({
            configuration: configuration(),
            machineKey: scenario.machineKey,
            scenarioId: scenario.archiveKind,
            stepId: scenario.steps[0].stepId,
            workspaceDirectory,
        }, {
            guestAdapter,
            plannedChoices: scenario.steps[0].choices,
            prepareOnly: true,
            processAdapter,
            releaseConfiguration,
            runId: '18181818-1818-4181-8181-181818181818',
            workspaceBoundary: () => {},
        });
        prepared.push(JSON.parse(await readFile(result.resultPath, 'utf8')));
    }

    assert.equal(prepared.length, 10);
    assert.equal(bundleTransfers.length, plan.scenarios.length);
    assert.deepEqual(new Set(bundleTransfers.map(transfer => transfer.machineKey)), new Set(RELEASE_MACHINE_KEYS));
    for (const transfer of bundleTransfers) {
        assert.deepEqual(transfer.hostPaths, ['candidate', 'plain', 'agentAssisted'].map(key => join(workspaceDirectory, `${key}.bundle`)));
        assert.deepEqual(transfer.commits, [candidateCommit, RELEASE_TARGETS.plain.commit, RELEASE_TARGETS.agentAssisted.commit]);
    }
    assert.deepEqual(prepared.map(result => [result.scenarioId, result.nodeVersion]), plan.scenarios.map((/** @type {TestScenario} */ scenario) => [
        scenario.archiveKind,
        scenario.archiveKind === 'observations/ubuntu/floor' ? 'v24.0.0' : 'v24.18.0',
    ]));
    const candidateCloneCommands = guestCommands.filter(command => command[0] === 'git' && command.includes('clone'));
    assert.equal(candidateCloneCommands.length, plan.scenarios.length);
    for (const command of candidateCloneCommands) {
        assert.deepEqual(command.slice(0, 9), [
            'git', 'clone', '--quiet',
            '-c', 'core.longpaths=true', '-c', 'core.autocrlf=false',
            '--branch', 'arw-validation',
        ]);
    }
    assert.equal(guestCommands.some(command => command[0] === 'pnpm'
        || command.includes('typecheck')
        || command.includes('test')
        || command.includes('--frozen-lockfile')), false);
});

const bundleProcessAdapter = (
    /** @type {string} */ candidateCommit = 'a'.repeat(40),
    /** @type {(value: string, key: string) => string} */ mutate = value => value,
    /** @type {{candidateTag?: string, candidateTagObject?: string, candidateVersion?: string, extraCandidateRef?: string, priorCommit?: string, priorVersion?: string}} */ options = {},
) => ({
    run: async (/** @type {{arguments: string[]}} */ request) => {
        const arguments_ = request.arguments[0] === '-c' && request.arguments[1]?.startsWith('safe.directory=')
            ? request.arguments.slice(2)
            : request.arguments;
        const candidateTag = options.candidateTag ?? '0.2.1';
        const priorCommit = options.priorCommit ?? 'd'.repeat(40);
        if (arguments_[0] === 'bundle' && arguments_[1] === 'list-heads') {
            const path = arguments_[2];
            const key = path.endsWith('candidate.bundle')
                ? 'candidate'
                : path.endsWith('plain.bundle')
                    ? 'plain'
                    : 'agentAssisted';
            const commit = key === 'candidate' ? candidateCommit : RELEASE_TARGETS[key].commit;
            return {exitCode: 0, stderr: '', stdout: key === 'candidate'
                ? `${mutate(commit, key)} refs/heads/arw-validation\n${options.candidateTagObject ?? 'e'.repeat(40)} refs/tags/${candidateTag}\n${options.extraCandidateRef ?? ''}`
                : `${mutate(commit, key)} refs/heads/arw-validation\n`};
        }
        if (arguments_[0] === 'rev-parse') {
            return {exitCode: 0, stderr: '', stdout: `${arguments_.at(-1)?.startsWith('refs/tags/') ? priorCommit : candidateCommit}\n`};
        }
        if (arguments_[0] === 'show') {
            return {exitCode: 0, stderr: '', stdout: `${JSON.stringify({version: arguments_[1]?.startsWith('refs/tags/') ? options.priorVersion ?? candidateTag : options.candidateVersion ?? '0.3.0'})}\n`};
        }
        return {exitCode: 0, stderr: '', stdout: ''};
    },
});

const inspectedBundlesImplementation = (/** @type {string} */ candidateCommit) => ({
    agentAssisted: {commit: RELEASE_TARGETS.agentAssisted.commit, kind: 'agent-assisted'},
    candidate: {commit: candidateCommit, kind: 'candidate', priorRelease: {commit: 'd'.repeat(40), tag: '0.2.1'}},
    plain: {commit: RELEASE_TARGETS.plain.commit, kind: 'plain'},
    status: 'inspected',
});
const inspectedBundles = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(inspectedBundlesImplementation, args);
const createFreshPostInitPlan = (/** @type {string} */ candidateCommit) => {
    const pending = createReleasePostInitChoiceHandoffImplementation({
        candidateCommit,
        preTagResult: {
            archives: listPreTagArchiveKinds().map((/** @type {string} */ archiveKind) => ({archiveKind, status: 'created'})),
            candidateCommit,
            status: 'completed',
        },
    });
    return createReleasePostInitScenarioPlanImplementation({
        bundleFacts: inspectedBundles(candidateCommit),
        candidateCommit,
        releaseConfiguration: RELEASE_CONFIGURATION,
        state: resolveReleasePostInitChoiceImplementation({choice: 'run', state: pending}),
    });
};

const factEntry = (/** @type {string} */ path, /** @type {string} */ text) => ({
    bytesBase64: Buffer.from(text).toString('base64'),
    path,
    type: 'ordinary-file',
});

/** @typedef {{bytesBase64: string, path: string, type: string}} SnapshotEntry */
const capturedFactsImplementation = (/** @type {SnapshotEntry[]} */ before, /** @type {SnapshotEntry[]} */ after) => ({after, before});
const capturedFacts = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(capturedFactsImplementation, args);
const workflowExpectedStateImplementation = (
    /** @type {SnapshotEntry[]} */ expectedEntries,
    /** @type {string[]} */ expectedMissingPaths = [],
) => ({
    expectedEntries,
    expectedMissingPaths,
});
const workflowExpectedState = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(workflowExpectedStateImplementation, args);

test('finite mechanical contracts separate operation evidence from observable state', () => {
    const configPath = '.agent-repository-workflow/config.json';
    const beforeConfig = {editor: {command: 'code'}, retained: true};
    const afterConfig = {editor: {command: 'release-validation-editor'}, retained: true};
    const full = evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts(
            [factEntry(configPath, `${JSON.stringify(beforeConfig, null, 2)}\n`)],
            [factEntry(configPath, `${JSON.stringify(afterConfig, null, 2)}\n`)],
        ),
        currentObservation: {config: afterConfig, path: configPath},
        evaluation: 'full',
        mechanicalContract: 'preserved-configuration-prepared',
        mechanicalParameters: {},
        operationActual: {
            actual: {afterConfig, beforeConfig, path: configPath},
            operationContract: 'prepare-preserved-configuration',
            status: 'completed',
        },
    });
    assert.deepEqual(full, {
        evaluation: 'full',
        files: [{
            changeType: 'modified',
            matchesExpected: true,
            path: configPath,
            summary: 'The registered configuration change matches the expected state.',
        }],
        matchesExpected: true,
        mechanicalContract: 'preserved-configuration-prepared',
        observableState: {matchesExpected: true, summary: 'The observable state matches the registered expectation.'},
        operationEvidence: {matchesExpected: true, summary: 'The operation evidence matches the registered contract.'},
        status: 'evaluated',
        summary: 'The operation evidence and observable state match the registered expectation.',
    });

    const compensated = evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts(
            [factEntry(configPath, `${JSON.stringify(beforeConfig, null, 2)}\n`)],
            [factEntry(configPath, `${JSON.stringify(afterConfig, null, 2)}\n`)],
        ),
        currentObservation: {config: afterConfig, path: configPath},
        evaluation: 'observable-state',
        mechanicalContract: 'preserved-configuration-prepared',
        mechanicalParameters: {},
        operationActual: null,
    });
    assert.equal(compensated.matchesExpected, true);
    assert.deepEqual(compensated.operationEvidence, {matchesExpected: null, summary: null});

    const withExtraChange = evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts(
            [factEntry(configPath, `${JSON.stringify(beforeConfig, null, 2)}\n`)],
            [
                factEntry(configPath, `${JSON.stringify(afterConfig, null, 2)}\n`),
                factEntry('unexpected.txt', 'unexpected\n'),
            ],
        ),
        currentObservation: {config: afterConfig, path: configPath},
        evaluation: 'observable-state',
        mechanicalContract: 'preserved-configuration-prepared',
        mechanicalParameters: {},
        operationActual: null,
    });
    assert.equal(withExtraChange.matchesExpected, false);
    assert.deepEqual(withExtraChange.files.map((/** @type {{matchesExpected: boolean, path: string}} */ file) => ({matchesExpected: file.matchesExpected, path: file.path})), [
        {matchesExpected: true, path: configPath},
        {matchesExpected: false, path: 'unexpected.txt'},
    ]);

    const failedOperation = evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts([], []),
        currentObservation: null,
        evaluation: 'full',
        mechanicalContract: 'preserved-configuration-prepared',
        mechanicalParameters: {},
        operationActual: {
            code: 'config-missing',
            evidence: {path: configPath},
            message: 'The preserved configuration file is missing.',
            operationContract: 'prepare-preserved-configuration',
            status: 'failed',
        },
    });
    assert.equal(failedOperation.matchesExpected, false);
    assert.equal(failedOperation.observableState.matchesExpected, false);
    assert.equal(failedOperation.operationEvidence.matchesExpected, false);
    assert.throws(() => evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts([], []),
        currentObservation: null,
        evaluation: 'full',
        mechanicalContract: 'preserved-configuration-prepared',
        mechanicalParameters: {},
        operationActual: {
            code: 'unregistered-failure',
            evidence: {path: configPath},
            message: 'This failure is not registered.',
            operationContract: 'prepare-preserved-configuration',
            status: 'failed',
        },
    }), /Release finite operation result is invalid\./);
    assert.throws(() => evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts(
            [factEntry(configPath, `${JSON.stringify(beforeConfig, null, 2)}\n`)],
            [factEntry(configPath, `${JSON.stringify(afterConfig, null, 2)}\n`)],
        ),
        currentObservation: {path: configPath},
        evaluation: 'full',
        mechanicalContract: 'preserved-configuration-prepared',
        mechanicalParameters: {},
        operationActual: {
            actual: {afterConfig, beforeConfig, path: configPath},
            operationContract: 'prepare-preserved-configuration',
            status: 'completed',
        },
    }), /Release finite current observation is invalid\./);
});

test('finite content operations require exact bytes and exact complete deltas', () => {
    const path = '.agent-repository-workflow/release-validation-unknown.txt';
    const bytes = 'release validation unknown content\n';
    const added = evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts([], [factEntry(path, bytes)]),
        currentObservation: {bytesBase64: Buffer.from(bytes).toString('base64'), entryType: 'ordinary-file', path},
        evaluation: 'full',
        mechanicalContract: 'unknown-content-added',
        mechanicalParameters: {},
        operationActual: {
            actual: {bytesBase64: Buffer.from(bytes).toString('base64'), path},
            operationContract: 'add-unknown-content',
            status: 'completed',
        },
    });
    assert.equal(added.matchesExpected, true);

    const removed = evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts([factEntry(path, bytes)], []),
        currentObservation: {exists: false, path},
        evaluation: 'full',
        mechanicalContract: 'test-residue-removed',
        mechanicalParameters: {},
        operationActual: {
            actual: {existsAfter: false, path, removedBytesBase64: Buffer.from(bytes).toString('base64')},
            operationContract: 'remove-test-residue',
            status: 'completed',
        },
    });
    assert.equal(removed.matchesExpected, true);

    const wrongBytes = evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts([], [factEntry(path, 'changed\n')]),
        currentObservation: {bytesBase64: Buffer.from('changed\n').toString('base64'), entryType: 'ordinary-file', path},
        evaluation: 'observable-state',
        mechanicalContract: 'unknown-content-added',
        mechanicalParameters: {},
        operationActual: null,
    });
    assert.equal(wrongBytes.matchesExpected, false);

    const validOperationMismatch = evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts([], [factEntry(path, bytes)]),
        currentObservation: {bytesBase64: Buffer.from(bytes).toString('base64'), entryType: 'ordinary-file', path},
        evaluation: 'full',
        mechanicalContract: 'unknown-content-added',
        mechanicalParameters: {},
        operationActual: {
            actual: {bytesBase64: Buffer.from('different\n').toString('base64'), path},
            operationContract: 'add-unknown-content',
            status: 'completed',
        },
    });
    assert.equal(validOperationMismatch.observableState.matchesExpected, true);
    assert.equal(validOperationMismatch.operationEvidence.matchesExpected, false);
    assert.equal(validOperationMismatch.matchesExpected, false);

    assert.throws(() => evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts([], [factEntry(path, bytes)]),
        currentObservation: {bytesBase64: Buffer.from(bytes).toString('base64'), entryType: 'ordinary-file', path},
        evaluation: 'full',
        mechanicalContract: 'unknown-content-added',
        mechanicalParameters: {},
        operationActual: {
            actual: {bytesBase64: 7, path},
            operationContract: 'add-unknown-content',
            status: 'completed',
        },
    }), /Release finite operation result is invalid\./);
});

test('finite guest operations preserve exact actual objects and reject unsafe replacement', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-finite-operations-');
    const installation = join(root, '.agent-repository-workflow');
    await mkdir(installation);
    const configPath = join(installation, 'config.json');
    await writeFile(configPath, `${JSON.stringify({editor: {command: 'code'}, retained: true}, null, 2)}\n`);

    const prepared = await executeReleaseFiniteOperation({
        auditedDirectory: root,
        operationContract: 'prepare-preserved-configuration',
        operationParameters: {editorCommand: 'release-validation-editor'},
        sourceRecord: null,
    });
    assert.deepEqual(prepared, {
        actual: {
            afterConfig: {editor: {command: 'release-validation-editor'}, retained: true},
            beforeConfig: {editor: {command: 'code'}, retained: true},
            path: '.agent-repository-workflow/config.json',
        },
        operationContract: 'prepare-preserved-configuration',
        status: 'completed',
    });

    const added = await executeReleaseFiniteOperation({
        auditedDirectory: root,
        operationContract: 'add-unknown-content',
        operationParameters: {},
        sourceRecord: null,
    });
    assert.deepEqual(added, {
        actual: {
            bytesBase64: Buffer.from('release validation unknown content\n').toString('base64'),
            path: '.agent-repository-workflow/release-validation-unknown.txt',
        },
        operationContract: 'add-unknown-content',
        status: 'completed',
    });

    await writeFile(join(installation, 'release-validation-unknown.txt'), 'changed by somebody else\n');
    const refused = await executeReleaseFiniteOperation({
        auditedDirectory: root,
        operationContract: 'remove-test-residue',
        operationParameters: {},
        sourceRecord: added,
    });
    assert.deepEqual(refused, {
        code: 'content-changed',
        evidence: {path: '.agent-repository-workflow/release-validation-unknown.txt'},
        message: 'The registered test residue bytes changed before removal.',
        operationContract: 'remove-test-residue',
        status: 'failed',
    });
    assert.equal(await readFile(join(installation, 'release-validation-unknown.txt'), 'utf8'), 'changed by somebody else\n');

    await writeFile(join(installation, 'release-validation-unknown.txt'), 'release validation unknown content\n');
    const removed = await executeReleaseFiniteOperation({
        auditedDirectory: root,
        operationContract: 'remove-test-residue',
        operationParameters: {},
        sourceRecord: added,
    });
    assert.equal(removed.status, 'completed');
    assert.deepEqual(removed.actual, {
        existsAfter: false,
        path: '.agent-repository-workflow/release-validation-unknown.txt',
        removedBytesBase64: Buffer.from('release validation unknown content\n').toString('base64'),
    });
    await assert.rejects(readFile(join(installation, 'release-validation-unknown.txt')), error => (
        error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
    ));
    assert.deepEqual(await readdir(installation), ['config.json']);

    const emptyHome = join(root, 'empty-home');
    const emptyInstallation = join(emptyHome, '.agent-repository-workflow');
    await mkdir(emptyInstallation, {recursive: true});
    await writeFile(join(emptyInstallation, 'release-validation-unknown.txt'), 'release validation unknown content\n');
    const removedLastEntry = await executeReleaseFiniteOperation({
        auditedDirectory: emptyHome,
        operationContract: 'remove-test-residue',
        operationParameters: {},
        sourceRecord: added,
    });
    assert.equal(removedLastEntry.status, 'completed');
    await assert.rejects(lstat(emptyInstallation), error => (
        error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
    ));

    const failedHome = join(root, 'failed-home');
    const failedInstallation = join(failedHome, '.agent-repository-workflow');
    await mkdir(failedInstallation, {recursive: true});
    await writeFile(join(failedInstallation, 'release-validation-unknown.txt'), 'release validation unknown content\n');
    const cleanupFailed = await executeReleaseFiniteOperation({
        auditedDirectory: failedHome,
        operationContract: 'remove-test-residue',
        operationParameters: {},
        sourceRecord: added,
    }, {
        fileSystem: {
            lstat,
            readFile,
            readdir,
            rmdir: async () => {
                throw new Error('injected parent removal failure');
            },
            unlink: (/** @type {string} */ path) => rm(path),
        },
    });
    assert.deepEqual(cleanupFailed, {
        code: 'parent-cleanup-failed',
        evidence: {path: '.agent-repository-workflow'},
        message: 'The empty test residue parent directory could not be removed.',
        operationContract: 'remove-test-residue',
        status: 'failed',
    });
    assert.deepEqual(await readdir(failedInstallation), []);
});

test('finite guest mutations reject a linked parent before reading or changing a child', async () => {
    const operations = [
        {
            operationContract: 'prepare-preserved-configuration',
            operationParameters: {editorCommand: 'release-validation-editor'},
            sourceRecord: null,
        },
        {operationContract: 'add-unknown-content', operationParameters: {}, sourceRecord: null},
        {
            operationContract: 'remove-test-residue',
            operationParameters: {},
            sourceRecord: {
                actual: {
                    bytesBase64: Buffer.from('release validation unknown content\n').toString('base64'),
                    path: '.agent-repository-workflow/release-validation-unknown.txt',
                },
                operationContract: 'add-unknown-content',
                status: 'completed',
            },
        },
    ];
    for (const request of operations) {
        let lstatCalls = 0;
        const result = await executeReleaseFiniteOperation({
            auditedDirectory: pathFor('home'),
            ...request,
        }, {
            fileSystem: {
                lstat: async () => {
                    lstatCalls += 1;
                    return lstatCalls === 1 ? ordinaryDirectory : symbolicLink;
                },
                readFile: async () => assert.fail('A linked parent must stop child reads.'),
                readdir: async () => assert.fail('A linked parent must stop child enumeration.'),
                unlink: async () => assert.fail('A linked parent must stop child removal.'),
                writeFile: async () => assert.fail('A linked parent must stop child writes.'),
            },
        });
        assert.equal(result.status, 'failed');
        assert.equal(result.code, 'unsafe-parent');
        assert.equal(lstatCalls, 2);
    }
});

test('guest observations isolate the Codex home while preserving other environment and runtime path', async () => {
    const codexEntries = Object.entries(process.env).filter(([key]) => key.toUpperCase() === 'CODEX_HOME');
    const fixtureKey = 'ARW_RELEASE_ENV_FIXTURE';
    const fixtureBefore = process.env[fixtureKey];
    const sceneHome = pathFor('isolated-home');
    try {
        process.env.CODEX_HOME = pathFor('ambient-codex-home');
        process.env.CoDeX_HoMe = pathFor('mixed-case-ambient-home');
        const ambientHome = process.env.CODEX_HOME;
        process.env[fixtureKey] = 'preserved';
        let observations = 0;
        const result = await executeReleaseFiniteOperation({
            auditedDirectory: sceneHome, machineKey: 'Alpine',
            baseline: {configurationExists: false, installationDirectoryExists: false, managedFilesExist: false,
                profile: {bytesBase64: null, exists: false}, testResidueExists: false, windowsPath: null},
            operationContract: 'observe-installation-final-state', operationParameters: {}, sourceRecord: null,
        }, {
            fileSystem: {
                lstat: async () => {throw Object.assign(new Error('missing'), {code: 'ENOENT'});},
                readFile: async () => assert.fail('An absent installation must not be read.'),
                readdir: async () => assert.fail('An absent installation must not be enumerated.'),
            },
            runProcess: async (/** @type {string} */ _file, /** @type {string[]} */ _args, /** @type {{env: NodeJS.ProcessEnv}} */ options) => {
                observations += 1;
                assert.equal(Object.keys(options.env).some(key => key.toUpperCase() === 'CODEX_HOME'), false);
                assert.equal(options.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'], sceneHome);
                assert.equal(options.env[fixtureKey], 'preserved');
                const expectedPath = [dirname(process.execPath), process.env.Path ?? process.env.PATH ?? '']
                    .filter(Boolean).join(process.platform === 'win32' ? ';' : ':');
                assert.equal(options.env[process.platform === 'win32' ? 'Path' : 'PATH'], expectedPath);
                assert.equal(process.env.CODEX_HOME, ambientHome);
                return {exitCode: 1, stderr: '', stdout: ''};
            },
        });
        assert.equal(result.status, 'completed');
        assert.equal(observations, 1);
    } finally {
        for (const key of Object.keys(process.env)) if (key.toUpperCase() === 'CODEX_HOME') delete process.env[key];
        for (const [key, value] of codexEntries) process.env[key] = value;
        if (fixtureBefore === undefined) delete process.env[fixtureKey];
        else process.env[fixtureKey] = fixtureBefore;
    }
});

test('installation final-state observation accepts only an empty ordinary background state directory', async () => {
    const baseline = {
        configurationExists: false, installationDirectoryExists: false, managedFilesExist: false,
        profile: {bytesBase64: null, exists: false}, testResidueExists: false, windowsPath: null,
    };
    for (const kind of ['empty', 'nonempty', 'link', 'special', 'unknown-directory', 'unreadable']) {
        const result = await executeReleaseFiniteOperation({
            auditedDirectory: pathFor('home'), baseline, machineKey: 'Alpine',
            operationContract: 'observe-installation-final-state', operationParameters: {}, sourceRecord: null,
        }, {
            fileSystem: {
                lstat: async (/** @type {string} */ path) => {
                    if (path.endsWith('.agent-repository-workflow')) return ordinaryDirectory;
                    if (path.endsWith('background-agent-state')) {
                        if (kind === 'link') return symbolicLink;
                        if (kind === 'special') return {isDirectory: () => false, isSymbolicLink: () => false};
                        return ordinaryDirectory;
                    }
                    throw Object.assign(new Error('missing'), {code: 'ENOENT'});
                },
                readdir: async (/** @type {string} */ path) => {
                    if (path.endsWith('.agent-repository-workflow')) return [kind === 'unknown-directory' ? 'unknown' : 'background-agent-state'];
                    assert.equal(path.endsWith('background-agent-state'), true);
                    if (kind === 'unreadable') throw new Error('unreadable');
                    assert.notEqual(kind, 'link');
                    return kind === 'nonempty' ? ['messages.sqlite'] : [];
                },
                readFile: async () => assert.fail('No file contents should be read.'),
            },
            runProcess: async () => ({exitCode: 1, stdout: '', stderr: ''}),
        });
        if (kind === 'unreadable') {
            assert.equal(result.status, 'failed');
            continue;
        }
        assert.equal(result.status, 'completed');
        assert.equal(result.actual.final.installationDirectoryExists, true);
        assert.equal(result.actual.final.managedFilesExist, kind !== 'empty');
        const evaluation = evaluateReleaseMechanicalContract({
            capturedFacts: capturedFacts([], []), currentObservation: result.actual,
            evaluation: 'full', mechanicalContract: 'installation-final-state',
            mechanicalParameters: {configuration: 'absent'}, operationActual: result,
        });
        assert.equal(evaluation.matchesExpected, kind === 'empty');
        if (kind === 'empty') {
            for (const final of [
                {...result.actual.final, launcherResolved: true},
                {...result.actual.final, configurationExists: true, installationDirectoryExists: false},
            ]) {
                assert.equal(evaluateReleaseMechanicalContract({
                    capturedFacts: capturedFacts([], []), currentObservation: {...result.actual, final},
                    evaluation: 'observable-state', mechanicalContract: 'installation-final-state',
                    mechanicalParameters: {configuration: final.configurationExists ? 'preserved' : 'absent'}, operationActual: null,
                }).matchesExpected, false);
            }
        }
    }
});

test('installation final-state observation closes filesystem and process failure paths', async () => {
    const missing = () => Object.assign(new Error('missing'), {code: 'ENOENT'});
    const windowsBaseline = {
        configurationExists: false,
        installationDirectoryExists: false,
        managedFilesExist: false,
        profile: null,
        testResidueExists: false,
        windowsPath: {effectiveEntries: [], exists: false, kind: null, value: ''},
    };
    const linuxBaseline = {
        configurationExists: false,
        installationDirectoryExists: false,
        managedFilesExist: false,
        profile: {bytesBase64: null, exists: false},
        testResidueExists: false,
        windowsPath: null,
    };
    const observe = (/** @type {string} */ machineKey, /** @type {unknown} */ baseline, /** @type {unknown} */ dependencies) => executeReleaseFiniteOperation({
        auditedDirectory: pathFor('home'),
        baseline,
        machineKey,
        operationContract: 'observe-installation-final-state',
        operationParameters: {},
        sourceRecord: null,
    }, dependencies);

    const unreadableDirectory = await observe('Windows 11', windowsBaseline, {
        fileSystem: {
            lstat: async (/** @type {string} */ path) => path.endsWith('.agent-repository-workflow') ? ordinaryDirectory : ordinaryFile,
            readFile: async () => assert.fail('A failed directory enumeration must stop child reads.'),
            readdir: async () => {
                throw new Error('injected readdir failure');
            },
        },
        runProcess: async () => assert.fail('A failed installation observation must stop process checks.'),
    });
    assert.deepEqual(unreadableDirectory, {
        code: 'observation-failed',
        evidence: {observation: 'installation'},
        message: 'The installation final state could not be observed.',
        operationContract: 'observe-installation-final-state',
        status: 'failed',
    });

    let parentChildRead = false;
    const linkedParent = await observe('Windows 11', windowsBaseline, {
        fileSystem: {
            lstat: async (/** @type {string} */ path) => path.endsWith('.agent-repository-workflow') ? symbolicLink : ordinaryFile,
            readFile: async () => {
                parentChildRead = true;
                return Buffer.from('{}');
            },
            readdir: async () => assert.fail('A linked installation parent must not be enumerated.'),
        },
        runProcess: async () => assert.fail('A linked installation parent must stop process checks.'),
    });
    assert.equal(parentChildRead, false);
    assert.equal(linkedParent.code, 'observation-failed');
    assert.deepEqual(linkedParent.evidence, {observation: 'installation'});

    let linkedObservationRead = false;
    const linkedWindowsObservation = await observe('Windows 11', windowsBaseline, {
        fileSystem: {
            lstat: async (/** @type {string} */ path) => {
                if (path.endsWith('.agent-repository-workflow')) throw missing();
                return symbolicLink;
            },
            readFile: async () => {
                linkedObservationRead = true;
                return Buffer.from('{}');
            },
            readdir: async () => assert.fail('An absent installation directory must not be enumerated.'),
        },
        runProcess: async () => assert.fail('A linked Path observation must stop process checks.'),
    });
    assert.equal(linkedObservationRead, false);
    assert.equal(linkedWindowsObservation.code, 'observation-failed');
    assert.deepEqual(linkedWindowsObservation.evidence, {observation: 'windows-path'});

    /** @type {Array<[string, ...unknown[]]>} */
    const windowsProcessCalls = [];
    const failedWindowsLauncher = await observe('Windows 11', windowsBaseline, {
        fileSystem: {
            lstat: async (/** @type {string} */ path) => {
                if (path.endsWith('.agent-repository-workflow')) throw missing();
                return ordinaryFile;
            },
            readFile: async () => Buffer.from(JSON.stringify({
                effectiveEntries: [],
                exists: false,
                kind: null,
                value: '',
            })),
            readdir: async () => assert.fail('An absent installation directory must not be enumerated.'),
        },
        runProcess: async (/** @type {[string, ...unknown[]]} */ ...args) => {
            windowsProcessCalls.push(args);
            return {exitCode: 2, stderr: 'injected', stdout: ''};
        },
    });
    assert.equal(windowsProcessCalls.length, 1);
    assert.equal(windowsProcessCalls[0][0], 'powershell.exe');
    assert.equal(failedWindowsLauncher.code, 'shell-check-failed');
    assert.deepEqual(failedWindowsLauncher.evidence, {shell: 'powershell'});

    /** @type {Array<[string, ...unknown[]]>} */
    const linuxProcessCalls = [];
    const failedProfileSyntax = await observe('Ubuntu', linuxBaseline, {
        fileSystem: {
            lstat: async (/** @type {string} */ path) => {
                if (path.endsWith('.agent-repository-workflow')) throw missing();
                return ordinaryFile;
            },
            readFile: async () => Buffer.from('export PATH="$PATH:/opt/arw"\n'),
            readdir: async () => assert.fail('An absent installation directory must not be enumerated.'),
        },
        runProcess: async (/** @type {[string, ...unknown[]]} */ ...args) => {
            linuxProcessCalls.push(args);
            return {exitCode: 2, stderr: 'injected', stdout: ''};
        },
    });
    assert.equal(linuxProcessCalls.length, 1);
    assert.equal(linuxProcessCalls[0][0], '/bin/sh');
    assert.equal(failedProfileSyntax.code, 'shell-check-failed');
    assert.deepEqual(failedProfileSyntax.evidence, {shell: 'login-shell'});
});



test('command mechanical contracts use repeated observations and complete workflow final state', () => {
    const readOnly = evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts([factEntry('tracked.txt', 'same\n')], [factEntry('tracked.txt', 'same\n')]),
        currentObservation: {exitCode: 0, stderr: '', stdout: `${ARW_VERSION}\n`},
        evaluation: 'full',
        mechanicalContract: 'launcher-observation',
        mechanicalParameters: {shell: 'direct', sourceAvailable: true, version: ARW_VERSION},
        operationActual: {exitCode: 0, stderr: '', stdout: `${ARW_VERSION}\n`},
    });
    assert.equal(readOnly.matchesExpected, true);
    assert.deepEqual(readOnly.files, []);
    assert.throws(() => evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts([factEntry('tracked.txt', 'same\n')], [factEntry('tracked.txt', 'same\n')]),
        currentObservation: {exitCode: 0, stderr: '', stdout: '01.2.3\n'},
        evaluation: 'full',
        mechanicalContract: 'launcher-observation',
        mechanicalParameters: {shell: 'direct', sourceAvailable: true, version: '01.2.3'},
        operationActual: {exitCode: 0, stderr: '', stdout: '01.2.3\n'},
    }), /mechanical observation is invalid/u);
    for (const shell of ['powershell', 'cmd', 'git-bash', 'login-shell']) {
        const observation = {
            exitCode: 0,
            stderr: '',
            stdout: `resolved-launcher\n${ARW_VERSION}\nignored-after-version\n`,
        };
        assert.equal(evaluateReleaseMechanicalContract({
            capturedFacts: capturedFacts([factEntry('tracked.txt', 'same\n')], [factEntry('tracked.txt', 'same\n')]),
            currentObservation: observation,
            evaluation: 'full',
            mechanicalContract: 'launcher-observation',
            mechanicalParameters: {shell, sourceAvailable: true, version: ARW_VERSION},
            operationActual: observation,
        }).matchesExpected, true);
    }
    for (const stdout of [
        `resolved-launcher\n${ARW_VERSION}-wrong\n`,
        `resolved-launcher\n${ARW_VERSION}`,
    ]) {
        const observation = {exitCode: 0, stderr: '', stdout};
        assert.equal(evaluateReleaseMechanicalContract({
            capturedFacts: capturedFacts([factEntry('tracked.txt', 'same\n')], [factEntry('tracked.txt', 'same\n')]),
            currentObservation: observation,
            evaluation: 'full',
            mechanicalContract: 'launcher-observation',
            mechanicalParameters: {shell: 'login-shell', sourceAvailable: true, version: ARW_VERSION},
            operationActual: observation,
        }).matchesExpected, false);
    }
    for (const currentObservation of [
        {exitCode: 0, stderr: '', stdout: `${ARW_VERSION}-wrong\n`},
        {exitCode: 0, stderr: 'warning\n', stdout: `${ARW_VERSION}\n`},
        {exitCode: 1, stderr: '', stdout: `${ARW_VERSION}\n`},
    ]) {
        assert.equal(evaluateReleaseMechanicalContract({
            capturedFacts: capturedFacts([factEntry('tracked.txt', 'same\n')], [factEntry('tracked.txt', 'same\n')]),
            currentObservation,
            evaluation: 'full',
            mechanicalContract: 'launcher-observation',
            mechanicalParameters: {shell: 'direct', sourceAvailable: true, version: ARW_VERSION},
            operationActual: currentObservation,
        }).matchesExpected, false);
    }

    const esmOutcomes = RELEASE_ESM_LIFECYCLE_ENTRIES.map(path => ({exitCode: 0, path, stderr: '', stdout: ''}));
    const esmObservation = {exitCode: 0, stderr: '', stdout: `${JSON.stringify(esmOutcomes)}\n`};
    assert.equal(evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts([factEntry('tracked.txt', 'same\n')], [factEntry('tracked.txt', 'same\n')]),
        currentObservation: esmObservation,
        evaluation: 'full',
        mechanicalContract: 'esm-syntax-observation',
        mechanicalParameters: {entries: RELEASE_ESM_LIFECYCLE_ENTRIES, runtime: 'minimum'},
        operationActual: esmObservation,
    }).matchesExpected, true);
    for (const outcomes of [esmOutcomes.slice(0, -1), [...esmOutcomes, esmOutcomes[0]], [
        {...esmOutcomes[0], exitCode: 1, stderr: 'syntax error\n'},
        ...esmOutcomes.slice(1),
    ]]) {
        const currentObservation = {
            exitCode: outcomes.some(outcome => outcome.exitCode !== 0) ? 1 : 0,
            stderr: '',
            stdout: `${JSON.stringify(outcomes)}\n`,
        };
        assert.equal(evaluateReleaseMechanicalContract({
            capturedFacts: capturedFacts([factEntry('tracked.txt', 'same\n')], [factEntry('tracked.txt', 'same\n')]),
            currentObservation,
            evaluation: 'full',
            mechanicalContract: 'esm-syntax-observation',
            mechanicalParameters: {entries: RELEASE_ESM_LIFECYCLE_ENTRIES, runtime: 'minimum'},
            operationActual: currentObservation,
        }).matchesExpected, false);
    }

    const expectedFindings = [
        {code: 'ordinary-readme-at-code-map-path', path: 'src/README.md'},
        {code: 'ordinary-readme-at-code-map-path', path: 'src/config/README.md'},
    ];
    const findingStderr = expectedFindings.map(finding => (
        `[phase 3] ${finding.code} path=${finding.path}: Required Code Map path contains an ordinary README; Human choice is required.\n`
    )).join('');
    const codeMapFinding = {exitCode: 1, stderr: findingStderr, stdout: ''};
    const expectedCodeMapFindings = evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts([factEntry('tracked.txt', 'same\n')], [factEntry('tracked.txt', 'same\n')]),
        currentObservation: codeMapFinding,
        evaluation: 'full',
        mechanicalContract: 'repository-verification',
        mechanicalParameters: {expectedFindings, kind: 'code-map'},
        operationActual: codeMapFinding,
    });
    assert.equal(expectedCodeMapFindings.matchesExpected, true);
    const extraCodeMapFinding = evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts([factEntry('tracked.txt', 'same\n')], [factEntry('tracked.txt', 'same\n')]),
        currentObservation: {
            ...codeMapFinding,
            stderr: `${findingStderr}[phase 3] missing-code-map-readme path=src/extra/README.md: Required Code Map README is missing; audit complete configured coverage.\n`,
        },
        evaluation: 'full',
        mechanicalContract: 'repository-verification',
        mechanicalParameters: {expectedFindings, kind: 'code-map'},
        operationActual: codeMapFinding,
    });
    assert.equal(extraCodeMapFinding.matchesExpected, false);

});



test('release mechanical snapshot preserves only Git review scope and working-tree bytes', async t => {
    const repositoryRoot = await createRepository(t, {prefix: 'arw-release-mechanical-snapshot-'});
    const linkTarget = await createTemporaryDirectory(t, 'arw-release-mechanical-link-target-');
    const trackedBytes = Buffer.from([0, 255, 10]);
    const ignoredTrackedBytes = Buffer.from([1, 2, 3, 4]);
    const stagedBytes = Buffer.from('staged\r\n');
    const untrackedBytes = Buffer.from([10, 0, 255]);
    await writeFile(join(repositoryRoot, '.gitignore'), 'ignored-tracked.txt\nnode_modules/\n');
    await writeFile(join(repositoryRoot, 'deleted.txt'), 'delete after commit\n');
    await writeFile(join(repositoryRoot, 'ignored-tracked.txt'), ignoredTrackedBytes);
    await writeFile(join(repositoryRoot, 'tracked.txt'), 'committed bytes\n');
    await runGit(repositoryRoot, ['add', '.gitignore', 'deleted.txt', 'tracked.txt']);
    await runGit(repositoryRoot, ['add', '--force', 'ignored-tracked.txt']);
    await runGit(repositoryRoot, ['commit', '--quiet', '-m', 'snapshot baseline']);

    await writeFile(join(repositoryRoot, 'tracked.txt'), trackedBytes);
    await rm(join(repositoryRoot, 'deleted.txt'));
    await writeFile(join(repositoryRoot, 'staged-new.txt'), stagedBytes);
    await runGit(repositoryRoot, ['add', '-A']);
    await mkdir(join(repositoryRoot, 'nested'));
    await writeFile(join(repositoryRoot, 'nested', 'visible-untracked.bin'), untrackedBytes);
    await mkdir(join(repositoryRoot, 'node_modules', '.pnpm'), {recursive: true});
    await writeFile(join(repositoryRoot, 'node_modules', 'ignored-build.js'), 'ignored build output\n');
    await symlink(linkTarget, join(repositoryRoot, 'node_modules', '.pnpm', 'package'), process.platform === 'win32' ? 'junction' : 'dir');

    const snapshot = await captureReleaseMechanicalSnapshot(repositoryRoot);
    assert.deepEqual(snapshot, [
        factEntry('.gitignore', 'ignored-tracked.txt\nnode_modules/\n'),
        {bytesBase64: ignoredTrackedBytes.toString('base64'), path: 'ignored-tracked.txt', type: 'ordinary-file'},
        {bytesBase64: untrackedBytes.toString('base64'), path: 'nested/visible-untracked.bin', type: 'ordinary-file'},
        {bytesBase64: stagedBytes.toString('base64'), path: 'staged-new.txt', type: 'ordinary-file'},
        {bytesBase64: trackedBytes.toString('base64'), path: 'tracked.txt', type: 'ordinary-file'},
    ]);
    const plan = {
        diagnostics: [],
        operation: 'update',
        operations: [],
        profile: {
            codeMaps: {excludes: [], includes: [], roots: []},
            domainLayout: 'single-context',
            platforms: ['claude-code', 'codex'],
        },
    };
    assert.deepEqual(await buildReleaseWorkflowExpectedState({before: snapshot, plan, retainedPaths: []}), {
        expectedEntries: snapshot,
        expectedMissingPaths: [],
    });

    await symlink(linkTarget, join(repositoryRoot, 'visible-link'), process.platform === 'win32' ? 'junction' : 'dir');
    const unsafeSnapshot = await captureReleaseMechanicalSnapshot(repositoryRoot);
    assert.deepEqual(unsafeSnapshot.find((/** @type {{path: string}} */ entry) => entry.path === 'visible-link'), {
        bytesBase64: null,
        path: 'visible-link',
        type: 'symbolic-link',
    });
    await assert.rejects(
        buildReleaseWorkflowExpectedState({before: unsafeSnapshot, plan, retainedPaths: []}),
        /Release workflow snapshot is invalid/,
    );
});

test('release workflow validation compares init, update, and remove with complete deterministic plan facts', async () => {
    const plainProfile = {
        codeMaps: {excludes: [], includes: [], roots: []},
        domainLayout: 'single-context',
        platforms: ['claude-code', 'codex'],
    };
    const write = (/** @type {string} */ path, /** @type {string} */ text) => ({
        action: 'write',
        bytes: Buffer.from(text).toString('base64'),
        path,
    });
    const lockText = (/** @type {{codeMaps: {excludes: string[], includes: string[], roots: string[]}, domainLayout: string, platforms: string[]}} */ profile) => serializeWorkflowLock({
        lockSchemaVersion: 2,
        managedTargets: [],
        profile,
        repositoryOwnedSeeds: [],
    });
    const plan = {
        diagnostics: [],
        operation: 'init',
        operations: [
            write('.arwignore', 'scope\n'),
            write('arw-lock.json', lockText(plainProfile)),
            write('docs/agents/validation.md', 'validation\n'),
        ],
        profile: plainProfile,
    };
    const expectedState = await buildReleaseWorkflowExpectedState({
        before: [],
        plan,
        retainedPaths: [],
    });
    assert.ok(expectedState.expectedEntries.some((/** @type {TestRecord} */ entry) => entry.path === 'docs/agents/validation.md'));
    assert.ok(expectedState.expectedEntries.some((/** @type {TestRecord} */ entry) => entry.path === '.arwignore'));

    const currentObservation = {
        expectedState,
        plan,
        verificationOutcome: {exitCode: 0, stderr: '', stdout: 'Workflow verification passed.\n'},
    };
    const mechanicalInput = {
        currentObservation,
        evaluation: 'full',
        mechanicalContract: 'repository-workflow-transition',
        mechanicalParameters: {expectedVerificationFindings: [], operation: 'init', profile: 'plain', retainedPaths: []},
        operationActual: {exitCode: 0, stderr: '', stdout: 'Workflow init completed.\n'},
    };
    const evaluated = evaluateReleaseMechanicalContract({
        ...mechanicalInput,
        capturedFacts: capturedFacts([], expectedState.expectedEntries),
    });
    assert.equal(evaluated.matchesExpected, true, JSON.stringify(evaluated));
    const expectedVerificationFindings = [
        {code: 'ordinary-readme-at-code-map-path', path: 'src/config/README.md'},
        {code: 'ordinary-readme-at-code-map-path', path: 'src/README.md'},
    ];
    const expectedVerificationStderr = expectedVerificationFindings.map(finding => (
        `[phase 3] ${finding.code} path=${finding.path}: Required Code Map path contains an ordinary README; Human choice is required.\n`
    )).join('');
    const expectedFindingEvaluation = evaluateReleaseMechanicalContract({
        ...mechanicalInput,
        capturedFacts: capturedFacts([], expectedState.expectedEntries),
        currentObservation: {
            ...currentObservation,
            verificationOutcome: {exitCode: 1, stderr: expectedVerificationStderr, stdout: ''},
        },
        mechanicalParameters: {
            ...mechanicalInput.mechanicalParameters,
            expectedVerificationFindings,
        },
    });
    assert.equal(expectedFindingEvaluation.matchesExpected, true, JSON.stringify(expectedFindingEvaluation));
    assert.equal(evaluateReleaseMechanicalContract({
        ...mechanicalInput,
        capturedFacts: capturedFacts([], expectedState.expectedEntries),
        currentObservation: {
            ...currentObservation,
            verificationOutcome: {
                exitCode: 1,
                stderr: `${expectedVerificationStderr}[phase 3] missing-code-map-readme path=src/extra/README.md: Required Code Map README is missing; audit complete configured coverage.\n`,
                stdout: '',
            },
        },
        mechanicalParameters: {
            ...mechanicalInput.mechanicalParameters,
            expectedVerificationFindings,
        },
    }).matchesExpected, false);
    const managedPath = 'docs/agents/validation.md';
    const wrongFinalEntries = expectedState.expectedEntries.map((/** @type {SnapshotEntry} */ entry) => entry.path === managedPath
        ? factEntry(entry.path, 'wrong final bytes\n')
        : entry);
    const rejected = evaluateReleaseMechanicalContract({
        ...mechanicalInput,
        capturedFacts: capturedFacts([], wrongFinalEntries),
    });
    assert.equal(rejected.matchesExpected, false);

    const updatePlan = {...plan, operation: 'update'};
    const updateExpectedState = await buildReleaseWorkflowExpectedState({
        before: expectedState.expectedEntries,
        plan: updatePlan,
        retainedPaths: [],
    });
    assert.deepEqual(updateExpectedState, expectedState);

    const repositoryProfile = {
        codeMaps: {
            excludes: [],
            includes: ['src/**/*.css', 'src/**/*.html', 'src/**/*.js', 'src/**/*.ts'],
            roots: ['src'],
        },
        domainLayout: 'single-context',
        platforms: ['codex'],
    };
    const repositoryPlan = {
        diagnostics: [],
        operation: 'update',
        operations: [],
        profile: repositoryProfile,
    };
    const repositoryState = [factEntry('arw-lock.json', lockText(repositoryProfile))];
    const repositoryExpectedState = await buildReleaseWorkflowExpectedState({
        before: repositoryState,
        plan: repositoryPlan,
        retainedPaths: [],
    });
    const repositoryUpdate = evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts(repositoryState, repositoryExpectedState.expectedEntries),
        currentObservation: {
            expectedState: repositoryExpectedState,
            plan: repositoryPlan,
            verificationOutcome: {exitCode: 0, stderr: '', stdout: 'Workflow verification passed.\n'},
        },
        evaluation: 'full',
        mechanicalContract: 'repository-workflow-transition',
        mechanicalParameters: {
            expectedVerificationFindings: [],
            operation: 'update',
            profile: 'agent-assisted',
            retainedPaths: [],
        },
        operationActual: {exitCode: 0, stderr: '', stdout: 'Workflow update completed.\n'},
    });
    assert.equal(repositoryUpdate.matchesExpected, true, JSON.stringify(repositoryUpdate));
    assert.throws(() => evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts(repositoryState, repositoryExpectedState.expectedEntries),
        currentObservation: {
            expectedState: repositoryExpectedState,
            plan: {...repositoryPlan, profile: plainProfile},
            verificationOutcome: {exitCode: 0, stderr: '', stdout: 'Workflow verification passed.\n'},
        },
        evaluation: 'full',
        mechanicalContract: 'repository-workflow-transition',
        mechanicalParameters: {
            expectedVerificationFindings: [],
            operation: 'update',
            profile: 'agent-assisted',
            retainedPaths: [],
        },
        operationActual: {exitCode: 0, stderr: '', stdout: 'Workflow update completed.\n'},
    }), /Release workflow observation is invalid/u);
    const repositoryRemovePlan = {
        ...repositoryPlan,
        operation: 'remove',
        operations: [{action: 'delete', path: 'arw-lock.json'}],
    };
    const repositoryRemoveExpectedState = await buildReleaseWorkflowExpectedState({
        before: repositoryState,
        plan: repositoryRemovePlan,
        retainedPaths: [],
    });
    const repositoryRemove = evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts(repositoryState, repositoryRemoveExpectedState.expectedEntries),
        currentObservation: {
            expectedState: repositoryRemoveExpectedState,
            plan: repositoryRemovePlan,
            verificationOutcome: {exitCode: 1, stderr: 'Workflow is not initialized.\n', stdout: ''},
        },
        evaluation: 'full',
        mechanicalContract: 'repository-workflow-transition',
        mechanicalParameters: {
            expectedVerificationFindings: [],
            operation: 'remove',
            profile: 'agent-assisted',
            retainedPaths: [],
        },
        operationActual: {exitCode: 0, stderr: '', stdout: 'Workflow remove completed.\n'},
    });
    assert.equal(repositoryRemove.matchesExpected, true, JSON.stringify(repositoryRemove));

    const agentProfile = {
        codeMaps: {excludes: [], includes: ['src/**/*'], roots: ['src']},
        domainLayout: 'single-context',
        platforms: ['codex'],
    };
    const initializationPlan = {
        diagnostics: [],
        operation: 'init',
        operations: [
            write('.arwignore', 'scope\n'),
            write('arw-lock.json', lockText(agentProfile)),
            write('docs/agents/validation.md', 'validation\n'),
        ],
        profile: agentProfile,
    };
    const initialized = await buildReleaseWorkflowExpectedState({
        before: [],
        plan: initializationPlan,
        retainedPaths: [],
    });
    const before = [
        ...initialized.expectedEntries,
        factEntry('src/README.md', 'map\n'),
    ].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    const removalChoices = {
        arwignore: 'delete',
    };
    assert.deepEqual(removalChoices, {arwignore: 'delete'});
    const removePlan = {
        diagnostics: [],
        operation: 'remove',
        operations: initialized.expectedEntries.map((/** @type {SnapshotEntry} */ entry) => ({action: 'delete', path: entry.path})),
        profile: agentProfile,
    };
    const removeExpectedState = await buildReleaseWorkflowExpectedState({
        before,
        plan: removePlan,
        retainedPaths: ['src/README.md'],
    });
    assert.ok(removeExpectedState.expectedEntries.some((/** @type {SnapshotEntry} */ entry) => entry.path === 'src/README.md'));
    assert.ok(removeExpectedState.expectedMissingPaths.includes('arw-lock.json'));
    assert.ok(removeExpectedState.expectedMissingPaths.includes('docs/agents/validation.md'));

    const removeEvaluated = evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts(before, removeExpectedState.expectedEntries),
        currentObservation: {
            expectedState: removeExpectedState,
            plan: removePlan,
            verificationOutcome: {exitCode: 1, stderr: 'Workflow is not initialized.\n', stdout: ''},
        },
        evaluation: 'full',
        mechanicalContract: 'repository-workflow-transition',
        mechanicalParameters: {
            expectedVerificationFindings: [],
            operation: 'remove',
            profile: 'agent-assisted',
            retainedPaths: ['src/README.md'],
        },
        operationActual: {exitCode: 0, stderr: '', stdout: 'Workflow remove completed.\n'},
    });
    assert.equal(removeEvaluated.matchesExpected, true);

    for (const action of ['write-lock', 'delete-lock']) {
        await assert.rejects(buildReleaseWorkflowExpectedState({
            before: [],
            plan: {
                ...plan,
                operations: [{action, ...(action === 'write-lock' ? {bytes: 'bG9jaw=='} : {}), path: 'arw-lock.json'}],
            },
            retainedPaths: [],
        }), /action is unsupported/u);
    }
});

test('installation rejection requires the registered unchanged final state instead of an exit-code shortcut', () => {
    const rejection = evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts([factEntry('retained.txt', 'same\n')], [factEntry('retained.txt', 'same\n')]),
        currentObservation: {stateUnchanged: true},
        evaluation: 'full',
        mechanicalContract: 'installation-transition',
        mechanicalParameters: {
            action: 'reject-default-downgrade',
            expectedVersion: 'prior-release',
            explicitSelection: false,
            preserveConfiguration: true,
            removeConfiguration: null,
        },
        operationActual: {exitCode: 1, stderr: 'downgrade refused\n', stdout: ''},
    });
    assert.equal(rejection.matchesExpected, true);
});

test('prior Release installation is accepted only from its own successful Installer and installed command state', () => {
    const version = '0.2.1';
    const profile = factEntry(
        '.profile',
        '# >>> agent-repository-workflow PATH >>>\nexport PATH="$HOME/.agent-repository-workflow:$PATH"\n# <<< agent-repository-workflow PATH <<<\n',
    );
    const manifest = {
        arwVersion: version,
        managedFiles: ['arw.mjs'],
        manifestVersion: 2,
        pathOwnership: [{kind: 'linux-profile', profile: '/tmp/release/home/.profile'}],
        product: 'agent-repository-workflow',
    };
    const after = [
        factEntry('.agent-repository-workflow/arw.mjs', 'prior runtime\n'),
        factEntry('.agent-repository-workflow/config.json', '{"configVersion":1}\n'),
        factEntry('.agent-repository-workflow/manifest.json', `${JSON.stringify(manifest)}\n`),
        profile,
    ];
    const input = {
        capturedFacts: capturedFacts([], after),
        currentObservation: {
            expectedConfigurationEntry: factEntry('.agent-repository-workflow/config.json', '{"configVersion":1}\n'),
            expectedManagedEntries: [factEntry('.agent-repository-workflow/arw.mjs', 'prior runtime\n')],
            expectedPathOwnership: manifest.pathOwnership,
            expectedPlatformEntry: profile,
            expectedVersion: version,
            manifest,
            validationAuthority: 'selected-release-installer',
            versionOutcome: {exitCode: 0, stderr: '', stdout: `${version}\n`},
        },
        evaluation: 'full',
        mechanicalContract: 'installation-transition',
        mechanicalParameters: {
            action: 'install',
            expectedVersion: 'prior-release',
            explicitSelection: true,
            preserveConfiguration: false,
            removeConfiguration: null,
        },
        operationActual: {exitCode: 0, stderr: '', stdout: 'installed\n'},
    };

    assert.equal(evaluateReleaseMechanicalContract(input).matchesExpected, true);
    assert.equal(evaluateReleaseMechanicalContract({
        ...input,
        currentObservation: {
            ...input.currentObservation,
            versionOutcome: {exitCode: 0, stderr: '', stdout: '0.2.0\n'},
        },
    }).matchesExpected, false);
    assert.throws(() => evaluateReleaseMechanicalContract({
        ...input,
        currentObservation: {
            ...input.currentObservation,
            manifest: {...manifest, arwVersion: '01.2.3'},
        },
    }), /installation observation is invalid/u);
    assert.equal(evaluateReleaseMechanicalContract({
        ...input,
        capturedFacts: capturedFacts([], after.filter(entry => entry.path !== '.agent-repository-workflow/arw.mjs')),
    }).matchesExpected, false);
    assert.equal(evaluateReleaseMechanicalContract({
        ...input,
        capturedFacts: capturedFacts([], after.map(entry => entry.path === '.agent-repository-workflow/arw.mjs'
            ? factEntry(entry.path, 'arbitrary runtime\n')
            : entry)),
    }).matchesExpected, false);
    assert.equal(evaluateReleaseMechanicalContract({
        ...input,
        capturedFacts: capturedFacts([], after.map(entry => entry.path === '.agent-repository-workflow/config.json'
            ? factEntry(entry.path, '{"arbitrary":true}\n')
            : entry)),
    }).matchesExpected, false);

    const preservedConfiguration = factEntry('.agent-repository-workflow/config.json', '{"user":"preserved"}\n');
    const repairedState = after.map(entry => entry.path === preservedConfiguration.path ? preservedConfiguration : entry);
    assert.equal(evaluateReleaseMechanicalContract({
        ...input,
        capturedFacts: capturedFacts(repairedState, repairedState),
        mechanicalParameters: {...input.mechanicalParameters, action: 'repair', preserveConfiguration: true},
    }).matchesExpected, true);

    const candidateManifest = {
        ...manifest,
        arwVersion: '0.3.0',
        managedFiles: ['arw.mjs', 'new-helper.mjs'],
    };
    const candidateConfig = factEntry('.agent-repository-workflow/config.json', '{"configVersion":3}\n');
    const priorConfig = factEntry('.agent-repository-workflow/config.json', '{"configVersion":1}\n');
    const downgrade = evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts([
            factEntry('.agent-repository-workflow/arw.mjs', 'candidate runtime\n'),
            candidateConfig,
            factEntry('.agent-repository-workflow/manifest.json', `${JSON.stringify(candidateManifest)}\n`),
            factEntry('.agent-repository-workflow/new-helper.mjs', 'candidate helper\n'),
            profile,
        ], [
            factEntry('.agent-repository-workflow/arw.mjs', 'prior runtime\n'),
            priorConfig,
            factEntry('.agent-repository-workflow/manifest.json', `${JSON.stringify(manifest)}\n`),
            profile,
        ]),
        currentObservation: input.currentObservation,
        evaluation: 'full',
        mechanicalContract: 'installation-transition',
        mechanicalParameters: {
            action: 'downgrade',
            expectedVersion: 'prior-release',
            explicitSelection: true,
            preserveConfiguration: false,
            removeConfiguration: null,
        },
        operationActual: {exitCode: 0, stderr: '', stdout: 'installed\n'},
    });
    assert.equal(downgrade.matchesExpected, true);
    assert.equal(evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts([
            factEntry('.agent-repository-workflow/arw.mjs', 'candidate runtime\n'),
            candidateConfig,
            factEntry('.agent-repository-workflow/manifest.json', `${JSON.stringify(candidateManifest)}\n`),
            factEntry('.agent-repository-workflow/new-helper.mjs', 'candidate helper\n'),
            profile,
        ], [
            factEntry('.agent-repository-workflow/arw.mjs', 'prior runtime\n'),
            factEntry('.agent-repository-workflow/config.json', '{"arbitrary":true}\n'),
            factEntry('.agent-repository-workflow/manifest.json', `${JSON.stringify(manifest)}\n`),
            profile,
        ]),
        currentObservation: input.currentObservation,
        evaluation: 'full',
        mechanicalContract: 'installation-transition',
        mechanicalParameters: {
            action: 'downgrade',
            expectedVersion: 'prior-release',
            explicitSelection: true,
            preserveConfiguration: false,
            removeConfiguration: null,
        },
        operationActual: {exitCode: 0, stderr: '', stdout: 'installed\n'},
    }).matchesExpected, false);
});

test('prior Release observation compares installed manifest paths with raw bytes from its checkout', async t => {
    const homeDirectory = await createTemporaryDirectory(t, 'arw-release-prior-installed-state-');
    const installationDirectory = join(homeDirectory, '.agent-repository-workflow');
    const version = '0.2.1';
    const manifest = {
        arwVersion: version,
        managedFiles: ['arw.mjs'],
        manifestVersion: 2,
        pathOwnership: [{kind: 'linux-profile', profile: join(homeDirectory, '.profile')}],
        product: 'agent-repository-workflow',
    };
    await mkdir(installationDirectory, {recursive: true});
    const releaseDirectory = join(homeDirectory, 'prior-release');
    await mkdir(releaseDirectory);
    await writeFile(join(releaseDirectory, 'arw.mjs'), 'prior runtime\n');
    await writeFile(join(releaseDirectory, 'config.install.json'), '{"configVersion":1}\n');
    await writeFile(join(releaseDirectory, 'release-manifest.json'), '{"configSeed":"config.install.json"}\n');
    await writeFile(join(installationDirectory, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    /** @type {unknown[][]} */
    const calls = [];

    const observation = await captureSelectedReleaseInstallation({
        before: [],
        expectedSource: releaseDirectory,
        expectedVersion: version,
        machineKey: 'Ubuntu',
        state: {homeDirectory, scenarioRoot: homeDirectory},
    }, {
        runProcess: async (/** @type {unknown[]} */ ...args) => {
            calls.push(args);
            return {exitCode: 0, stderr: '', stdout: `${version}\n`};
        },
    });

    assert.equal(observation.validationAuthority, 'selected-release-installer');
    assert.deepEqual(observation.expectedConfigurationEntry, factEntry('.agent-repository-workflow/config.json', '{"configVersion":1}\n'));
    assert.deepEqual(observation.expectedManagedEntries, [factEntry('.agent-repository-workflow/arw.mjs', 'prior runtime\n')]);
    assert.deepEqual(observation.manifest, manifest);
    assert.deepEqual(observation.versionOutcome, {exitCode: 0, stderr: '', stdout: `${version}\n`});
    assert.deepEqual(calls[0].slice(0, 2), [
        process.execPath,
        [join(installationDirectory, 'arw.mjs'), '--version'],
    ]);
});

test('installation transition rejects an unchanged managed file removed from the new manifest', () => {
    const priorManifest = {
        arwVersion: '0.1.0',
        managedFiles: ['arw.mjs', 'old-helper.mjs'],
        manifestVersion: 2,
        pathOwnership: [],
        product: 'agent-repository-workflow',
    };
    const currentManifest = {
        arwVersion: '0.2.0',
        managedFiles: ['arw.mjs'],
        manifestVersion: 2,
        pathOwnership: [],
        product: 'agent-repository-workflow',
    };
    const before = [
        factEntry('.agent-repository-workflow/arw.mjs', 'old runtime\n'),
        factEntry('.agent-repository-workflow/manifest.json', `${JSON.stringify(priorManifest)}\n`),
        factEntry('.agent-repository-workflow/old-helper.mjs', 'stale helper\n'),
    ];
    const after = [
        factEntry('.agent-repository-workflow/arw.mjs', 'new runtime\n'),
        factEntry('.agent-repository-workflow/config.json', '{"configVersion":1}\n'),
        factEntry('.agent-repository-workflow/manifest.json', `${JSON.stringify(currentManifest)}\n`),
        factEntry('.agent-repository-workflow/old-helper.mjs', 'stale helper\n'),
    ];
    const result = evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts(before, after),
        currentObservation: {
            expectedEntries: [
                factEntry('.agent-repository-workflow/arw.mjs', 'new runtime\n'),
                factEntry('.agent-repository-workflow/config.json', '{"configVersion":1}\n'),
            ],
            expectedManagedFiles: ['arw.mjs'],
            expectedPathOwnership: [],
            expectedVersion: '0.2.0',
            manifest: currentManifest,
        },
        evaluation: 'full',
        mechanicalContract: 'installation-transition',
        mechanicalParameters: {
            action: 'upgrade',
            expectedVersion: 'candidate',
            explicitSelection: true,
            preserveConfiguration: true,
            removeConfiguration: null,
        },
        operationActual: {exitCode: 0, stderr: '', stdout: 'upgraded\n'},
    });

    assert.equal(result.matchesExpected, false);
    const cleaned = evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts(before, after.filter((/** @type {TestRecord} */ entry) => entry.path !== '.agent-repository-workflow/old-helper.mjs')),
        currentObservation: {
            expectedEntries: [
                factEntry('.agent-repository-workflow/arw.mjs', 'new runtime\n'),
                factEntry('.agent-repository-workflow/config.json', '{"configVersion":1}\n'),
            ],
            expectedManagedFiles: ['arw.mjs'],
            expectedPathOwnership: [],
            expectedVersion: '0.2.0',
            manifest: currentManifest,
        },
        evaluation: 'full',
        mechanicalContract: 'installation-transition',
        mechanicalParameters: {
            action: 'upgrade',
            expectedVersion: 'candidate',
            explicitSelection: true,
            preserveConfiguration: true,
            removeConfiguration: null,
        },
        operationActual: {exitCode: 0, stderr: '', stdout: 'upgraded\n'},
    });
    assert.equal(cleaned.matchesExpected, true);
});

test('uninstall transition preserves unknown content while applying the registered configuration choice', () => {
    const manifest = {
        arwVersion: '0.2.0',
        managedFiles: ['arw.mjs'],
        manifestVersion: 2,
        pathOwnership: [{kind: 'linux-profile', profile: '/tmp/arw-release-validation/home/.profile'}],
        product: 'agent-repository-workflow',
    };
    const configuration = factEntry('.agent-repository-workflow/config.json', '{"keep":true}\n');
    const residue = factEntry('.agent-repository-workflow/release-validation-unknown.txt', 'release validation unknown content\n');
    const before = [
        factEntry('.agent-repository-workflow/arw.mjs', 'runtime\n'),
        configuration,
        factEntry('.agent-repository-workflow/manifest.json', `${JSON.stringify(manifest)}\n`),
        residue,
        factEntry('.profile', '# >>> agent-repository-workflow PATH >>>\nexport PATH="$HOME/.agent-repository-workflow:$PATH"\n# <<< agent-repository-workflow PATH <<<\n'),
    ];
    const baseline = {
        configurationExists: false,
        installationDirectoryExists: false,
        managedFilesExist: false,
        profile: {bytesBase64: null, exists: false},
        testResidueExists: false,
        windowsPath: null,
    };
    for (const preserveConfiguration of [true, false]) {
        const after = preserveConfiguration ? [configuration, residue] : [residue];
        const result = evaluateReleaseMechanicalContract({
            capturedFacts: capturedFacts(before, after),
            currentObservation: {
                baseline,
                final: {
                    configurationExists: preserveConfiguration,
                    installationDirectoryExists: true,
                    launcherResolved: false,
                    managedFilesExist: false,
                    profile: {bytesBase64: null, exists: false},
                    testResidueExists: true,
                    windowsPath: null,
                },
            },
            evaluation: 'full',
            mechanicalContract: 'installation-transition',
            mechanicalParameters: {
                action: 'uninstall',
                expectedVersion: null,
                explicitSelection: null,
                preserveConfiguration,
                removeConfiguration: !preserveConfiguration,
            },
            operationActual: {exitCode: 0, stderr: '', stdout: 'uninstalled\n'},
        });
        assert.equal(result.matchesExpected, true);
        assert.equal(result.files.every((/** @type {{matchesExpected: boolean}} */ file) => file.matchesExpected), true);
    }

    const changedResidue = evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts(before, [configuration, factEntry(residue.path, 'changed\n')]),
        currentObservation: {
            baseline,
            final: {
                configurationExists: true,
                installationDirectoryExists: true,
                launcherResolved: false,
                managedFilesExist: false,
                profile: {bytesBase64: null, exists: false},
                testResidueExists: true,
                windowsPath: null,
            },
        },
        evaluation: 'full',
        mechanicalContract: 'installation-transition',
        mechanicalParameters: {
            action: 'uninstall',
            expectedVersion: null,
            explicitSelection: null,
            preserveConfiguration: true,
            removeConfiguration: false,
        },
        operationActual: {exitCode: 0, stderr: '', stdout: 'uninstalled\n'},
    });
    assert.equal(changedResidue.matchesExpected, false);
});

test('installation validation compares complete Linux and Windows final states with the Verified Release', () => {
    const release = {
        configSeedBytes: Buffer.from('{"configVersion":1}\n'),
        managedFiles: ['arw.mjs', 'distribution/manifest.json'],
        sourceFiles: new Map([
            ['arw.mjs', Buffer.from('runtime\n')],
            ['distribution/manifest.json', Buffer.from('{"distributionVersion":1}\n')],
        ]),
    };
    const linuxInstallationDirectory = '/tmp/arw-release-validation/home/.agent-repository-workflow';
    const created = buildExpectedInstallationEntries({before: [], installationDirectory: linuxInstallationDirectory, machineKey: 'Alpine', release});
    assert.deepEqual(created, [
        factEntry('.agent-repository-workflow/arw.mjs', 'runtime\n'),
        factEntry('.agent-repository-workflow/config.json', '{"configVersion":1}\n'),
        factEntry('.agent-repository-workflow/distribution/manifest.json', '{"distributionVersion":1}\n'),
        factEntry('.codex/models.custom.json', '{"models":[],"providers":{"openai":{"maxInstances":4}}}'),
        factEntry('.profile', '# >>> agent-repository-workflow PATH >>>\nexport PATH="$HOME/.agent-repository-workflow:$PATH"\n# <<< agent-repository-workflow PATH <<<\n'),
    ]);

    const preservedConfiguration = factEntry(
        '.agent-repository-workflow/config.json',
        '{\n  "configVersion": 1,\n  "agents": {},\n  "editor": {\n    "command": "code",\n    "args": ["{file}"]\n  }\n}\n',
    );
    const priorProfile = factEntry('.profile', 'export PATH="/custom:$PATH"\n');
    const preserved = buildExpectedInstallationEntries({
        before: [preservedConfiguration, priorProfile],
        installationDirectory: linuxInstallationDirectory,
        machineKey: 'Alpine',
        release,
    });
    assert.deepEqual(preserved.find((/** @type {TestRecord} */ entry) => entry.path === priorProfile.path), factEntry(
        '.profile',
        'export PATH="/custom:$PATH"\n# >>> agent-repository-workflow PATH >>>\nexport PATH="$HOME/.agent-repository-workflow:$PATH"\n# <<< agent-repository-workflow PATH <<<\n',
    ));
    const installationSubdirectoryProfile = factEntry(
        '.profile',
        'export PATH="$HOME/.agent-repository-workflow/bin:$PATH"\n',
    );
    const correctedSubdirectoryProfile = buildExpectedInstallationEntries({
        before: [installationSubdirectoryProfile],
        installationDirectory: linuxInstallationDirectory,
        machineKey: 'Alpine',
        release,
    });
    assert.deepEqual(correctedSubdirectoryProfile.find((/** @type {TestRecord} */ entry) => entry.path === '.profile'), factEntry(
        '.profile',
        'export PATH="$HOME/.agent-repository-workflow/bin:$PATH"\n# >>> agent-repository-workflow PATH >>>\nexport PATH="$HOME/.agent-repository-workflow:$PATH"\n# <<< agent-repository-workflow PATH <<<\n',
    ));
    const linuxManifest = {
        arwVersion: '0.2.0',
        managedFiles: release.managedFiles,
        manifestVersion: 2,
        pathOwnership: [{kind: 'linux-profile', profile: '/tmp/arw-release-validation/home/.profile'}],
        product: 'agent-repository-workflow',
    };
    const linuxInput = {
        currentObservation: {
            expectedEntries: preserved,
            expectedManagedFiles: release.managedFiles,
            expectedPathOwnership: linuxManifest.pathOwnership,
            expectedVersion: '0.2.0',
            manifest: linuxManifest,
        },
        evaluation: 'full',
        mechanicalContract: 'installation-transition',
        mechanicalParameters: {
            action: 'upgrade',
            expectedVersion: 'candidate',
            explicitSelection: true,
            preserveConfiguration: true,
            removeConfiguration: null,
        },
        operationActual: {exitCode: 0, stderr: '', stdout: 'upgraded\n'},
    };
    const linuxAfter = [
        ...preserved,
        factEntry('.agent-repository-workflow/manifest.json', `${JSON.stringify(linuxManifest)}\n`),
    ].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    assert.equal(evaluateReleaseMechanicalContract({
        ...linuxInput,
        capturedFacts: capturedFacts([preservedConfiguration, priorProfile], linuxAfter),
    }).matchesExpected, true);
    for (const [original, expected] of [
        ['{"models":[{"id":"custom"}],"providers":{"other":{"maxInstances":2}}}\n', '{"models":[{"id":"custom"}],"providers":{"other":{"maxInstances":2},"openai":{"maxInstances":4}}}\n'],
        ['{ "models": [], "providers": {"openai": {"maxInstances": 7, "extra": true}} }\n', '{ "models": [], "providers": {"openai": {"maxInstances": 7, "extra": true}} }\n'],
    ]) {
        const beforeModels = factEntry('.codex/models.custom.json', original);
        const expectedModels = buildExpectedInstallationEntries({before: [beforeModels], installationDirectory: linuxInstallationDirectory, machineKey: 'Alpine', release});
        assert.deepEqual(expectedModels.find((/** @type {TestRecord} */ entry) => entry.path === beforeModels.path), factEntry(beforeModels.path, expected));
    }
    for (const after of [
        linuxAfter.map(entry => entry.path === '.codex/models.custom.json' ? factEntry(entry.path, '{"models":[]}') : entry),
        [...linuxAfter, factEntry('.codex/unrelated.json', '{}')].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
    ]) {
        assert.equal(evaluateReleaseMechanicalContract({
            ...linuxInput,
            capturedFacts: capturedFacts([preservedConfiguration, priorProfile], after),
        }).matchesExpected, false);
    }
    assert.equal(evaluateReleaseMechanicalContract({
        ...linuxInput,
        capturedFacts: capturedFacts([preservedConfiguration, priorProfile], linuxAfter.map((/** @type {TestRecord} */ entry) => entry.path === '.agent-repository-workflow/arw.mjs'
            ? factEntry(entry.path, 'wrong runtime\n')
            : entry)),
    }).matchesExpected, false);
    const wrongLinuxOwnership = {
        ...linuxManifest,
        pathOwnership: [{kind: 'linux-profile', profile: '/tmp/arw-release-validation/other/.profile'}],
    };
    assert.equal(evaluateReleaseMechanicalContract({
        ...linuxInput,
        capturedFacts: capturedFacts(
            [preservedConfiguration, priorProfile],
            linuxAfter.map((/** @type {TestRecord} */ entry) => entry.path === '.agent-repository-workflow/manifest.json'
                ? factEntry(entry.path, `${JSON.stringify(wrongLinuxOwnership)}\n`)
                : entry),
        ),
        currentObservation: {...linuxInput.currentObservation, manifest: wrongLinuxOwnership},
    }).matchesExpected, false);
    assert.throws(() => evaluateReleaseMechanicalContract({
        ...linuxInput,
        capturedFacts: capturedFacts(
            [preservedConfiguration, priorProfile],
            linuxAfter.map((/** @type {TestRecord} */ entry) => entry.path === '.agent-repository-workflow/manifest.json'
                ? factEntry(entry.path, `${JSON.stringify({...linuxManifest, pathOwnership: [{}]})}\n`)
                : entry),
        ),
        currentObservation: {...linuxInput.currentObservation, manifest: {...linuxManifest, pathOwnership: [{}]}},
    }), /installation observation is invalid/);
    assert.equal(buildExpectedInstallationEntries({before: [], machineKey: 'Windows 11', release})
        .some((/** @type {{ path: string; }} */ entry) => entry.path === '.profile'), false);

    const installationDirectory = 'C:\\arw-release-validation\\run\\home\\.agent-repository-workflow';
    const priorWindowsPath = {
        effectiveEntries: ['C:\\Windows', 'C:\\Users\\test\\WindowsApps', ''],
        exists: true,
        kind: 'ExpandString',
        value: '%USERPROFILE%\\WindowsApps;',
    };
    const windowsManifest = {
        arwVersion: '0.1.0',
        managedFiles: release.managedFiles,
        manifestVersion: 2,
        pathOwnership: [{
            createdValue: false,
            entry: installationDirectory,
            kind: 'windows-user-path',
            valueKind: 'ExpandString',
        }],
        product: 'agent-repository-workflow',
    };
    const windows = buildExpectedInstallationEntries({
        before: [factEntry('windows-user-path.json', `${JSON.stringify(priorWindowsPath)}\n`)],
        installationDirectory,
        machineKey: 'Windows 11',
        manifest: windowsManifest,
        release,
    });
    assert.deepEqual(windows.find((/** @type {{ path: string; }} */ entry) => entry.path === 'windows-user-path.json'), factEntry(
        'windows-user-path.json',
        `${JSON.stringify({
            effectiveEntries: ['C:\\Windows', 'C:\\Users\\test\\WindowsApps', installationDirectory],
            exists: true,
            kind: 'ExpandString',
            value: `%USERPROFILE%\\WindowsApps;${installationDirectory}`,
        })}\n`,
    ));
    assert.equal(evaluateReleaseMechanicalContract({
        capturedFacts: capturedFacts(
            [factEntry('windows-user-path.json', `${JSON.stringify(priorWindowsPath)}\n`)],
            [...windows, factEntry('.agent-repository-workflow/manifest.json', `${JSON.stringify(windowsManifest)}\n`)]
                .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
        ),
        currentObservation: {
            expectedEntries: windows,
            expectedManagedFiles: release.managedFiles,
            expectedPathOwnership: windowsManifest.pathOwnership,
            expectedVersion: '0.1.0',
            manifest: windowsManifest,
        },
        evaluation: 'full',
        mechanicalContract: 'installation-transition',
        mechanicalParameters: {
            action: 'install',
            expectedVersion: 'prior-release',
            explicitSelection: true,
            preserveConfiguration: false,
            removeConfiguration: null,
        },
        operationActual: {exitCode: 0, stderr: '', stdout: 'installed\n'},
    }).matchesExpected, true);
    assert.throws(() => buildExpectedInstallationEntries({
        before: [factEntry('windows-user-path.json', `${JSON.stringify(priorWindowsPath)}\n`)],
        installationDirectory,
        machineKey: 'Windows 11',
        manifest: {...windowsManifest, pathOwnership: []},
        release,
    }), /Windows PATH ownership/);
});

test('automatic mechanical evaluation retains accepted index history with current path judgments', () => {
    const evaluation = {
        files: [{
            changeType: 'modified',
            matchesExpected: true,
            path: '.agent-repository-workflow/config.json',
            summary: 'The registered configuration change matches the expected state.',
        }],
        matchesExpected: true,
        summary: 'The current path judgments match.',
        status: 'evaluated',
    };
    const completed = completeReleaseMechanicalEvaluation({
        evaluation,
        templateChanges: [
            {changeType: 'added', path: '.agent-repository-workflow/arw.mjs'},
            {changeType: 'added', path: '.agent-repository-workflow/config.json'},
        ],
    });
    assert.deepEqual(completed.files, [
        {
            changeType: 'added',
            matchesExpected: true,
            path: '.agent-repository-workflow/arw.mjs',
            summary: 'The accepted Git index baseline is unchanged for this path.',
        },
        {
            changeType: 'added',
            matchesExpected: true,
            path: '.agent-repository-workflow/config.json',
            summary: 'The registered configuration change matches the expected state.',
        },
    ]);
    assert.equal(completed.matchesExpected, true);
    assert.throws(() => completeReleaseMechanicalEvaluation({
        evaluation,
        templateChanges: [{changeType: 'added', path: '.agent-repository-workflow/arw.mjs'}],
    }), /does not cover the complete captured path set/);
});

const pendingRunStateImplementation = (/** @type {{configurationPath: string, handoffs: TestRecord[], plan: TestPlan, runId: string}} */ {configurationPath, handoffs, plan, runId}) => ({
    archives: plan.scenarios.map(scenario => ({
        archiveKind: scenario.archiveKind,
        outputPath: null,
        reason: {code: 'ineligible-unresolved', message: 'Release validation steps are not terminal.'},
        sourceDirectory: null,
        status: 'not-eligible',
    })),
    candidateCommit: plan.candidateCommit,
    cleanup: plan.scenarios.map(scenario => ({
        machineKey: scenario.machineKey,
        outcome: 'pending',
        reason: null,
        resultPath: null,
        scenarioId: scenario.archiveKind,
        stage: 'not-started',
    })),
    configurationPath,
    handoffs,
    inFlight: [],
    maxParallelMachines: 3,
    plan,
    recovery: [],
    revision: 0,
    runId,
    schemaVersion: 1,
    status: 'paused',
    steps: plan.scenarios.flatMap(scenario => scenario.steps.map(step => ({
        classification: null,
        evidencePath: null,
        handoffId: handoffs.find((/** @type {TestRecord} */ handoff) => handoff.scenarioId === scenario.archiveKind && handoff.stepId === step.stepId)?.handoffId ?? null,
        outcome: null,
        reason: null,
        scenarioId: scenario.archiveKind,
        state: 'pending',
        stepId: step.stepId,
    }))),
});
const pendingRunState = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(pendingRunStateImplementation, args);

const scenarioReadinessResultImplementation = (/** @type {{matchesExpected: boolean, scenarioId: string, summary: string}} */ {matchesExpected, scenarioId, summary}) => ({
    evaluation: 'full',
    matchesExpected,
    observableState: {matchesExpected, summary},
    operationEvidence: {matchesExpected, summary},
    scenarioId,
    status: 'evaluated',
    summary,
});
const scenarioReadinessResult = (/** @type {unknown[]} */ ...args) => invokeTestBoundary(scenarioReadinessResultImplementation, args);

const prepareCompensationReadiness = async (/** @type {{configured: TestConfiguration, runDirectory?: string, scenarioId: string, workspaceDirectory?: string}} */ {configured, scenarioId}) => {
    const scenario = listReleaseValidationScenarios().find((/** @type {TestRecord} */ item) => item.archiveKind === scenarioId);
    return {
        run: async (/** @type {{ machineKey: string; operation: string; }} */ request) => {
            const selectedMachine = requireValue(configured.machines[request.machineKey], 'Expected configured machine.');
            if (request.operation === 'read-snapshots') {
                return {
                    observation: {currentSnapshot: selectedMachine.snapshot, snapshots: [selectedMachine.snapshot]},
                    operation: request.operation,
                    status: 'observed',
                };
            }
            if (request.operation === 'read-power-state') {
                return {observation: {powerState: 'powered-off'}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'hard-power-off') {
                return {observation: {powerState: 'powered-off'}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'start-background') {
                return {observation: {powerState: 'running'}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'wait-guest-address') {
                return {observation: {address: '192.0.2.10'}, operation: request.operation, status: 'observed'};
            }
            assert.fail(`Unexpected lifecycle operation: ${request.operation}`);
        },
    };
};



test('release validation registry closes planning, dependency, choice, operation, and judgment records', () => {
    const scenarios = listReleaseValidationScenarios();
    const freshCodeMapPaths = [
        'src/client/README.md',
        'src/client/confirm/README.md',
        'src/client/event/README.md',
        'src/client/flow/README.md',
        'src/client/logging/README.md',
        'src/client/message-collection/README.md',
        'src/client/message/README.md',
        'src/client/oasis-context/README.md',
        'src/client/pages/README.md',
        'src/client/query/README.md',
        'src/client/router/README.md',
        'src/client/script/README.md',
        'src/client/test/README.md',
        'src/client/test/common/README.md',
        'src/client/test/setup/README.md',
        'src/client/theme/README.md',
        'src/server/README.md',
        'src/server/locale/README.md',
        'src/server/logging/README.md',
        'src/server/logging/performance-logger/README.md',
        'src/server/query/README.md',
        'src/server/test/README.md',
        'src/server/test/common/README.md',
        'src/server/theme/README.md',
        'src/server/theme/component/README.md',
        'src/server/theme/library/README.md',
        'src/server/theme/page/README.md',
        'src/server/theme/theme/README.md',
        'src/server/theme/variable/README.md',
        'src/server/ui-component/README.md',
        'src/server/utils/README.md',
        'src/server/validation/README.md',
    ];
    assert.deepEqual(Object.keys(scenarios[0]), ['archiveKind', 'machineKey', 'phase', 'prerequisites', 'steps', 'targetKind']);
    assert.equal(scenarios[0].targetKind, null);
    assert.deepEqual(scenarios[0].prerequisites, [
        'candidate-bundle',
        'prior-release-fixture',
        'recommended-node',
        'shared-snapshot',
        'isolated-installation-home',
    ]);
    assert.equal(scenarios[0].phase, 'pre-tag');
    assert.equal(resolveReleaseValidationRuntimeRole(scenarios[0]), 'recommended');
    assert.equal(resolveReleaseValidationRuntimeRole(scenarios.find((/** @type {TestScenario} */ entry) => entry.archiveKind === 'observations/ubuntu/floor')), 'minimum');
    assert.throws(
        () => resolveReleaseValidationRuntimeRole({prerequisites: ['minimum-node', 'recommended-node']}),
        /exactly one Node\.js runtime prerequisite/,
    );
    assert.throws(
        () => resolveReleaseValidationRuntimeRole({prerequisites: ['candidate-bundle']}),
        /exactly one Node\.js runtime prerequisite/,
    );
    assert.deepEqual(scenarios[0].steps.slice(0, 7).map((/** @type {{mechanicalParameters: Record<string, unknown>, stepId: string}} */ step) => ({
        action: step.mechanicalParameters.action ?? null,
        expectedVersion: step.mechanicalParameters.expectedVersion ?? null,
        explicitSelection: step.mechanicalParameters.explicitSelection ?? null,
        preserveConfiguration: step.mechanicalParameters.preserveConfiguration ?? null,
        stepId: step.stepId,
    })), [
        {action: 'install', expectedVersion: 'prior-release', explicitSelection: true, preserveConfiguration: false, stepId: '001-install-prior-release'},
        {action: null, expectedVersion: null, explicitSelection: null, preserveConfiguration: null, stepId: '002-prepare-preserved-configuration'},
        {action: 'repair', expectedVersion: 'prior-release', explicitSelection: true, preserveConfiguration: true, stepId: '003-repair-prior-release'},
        {action: 'upgrade', expectedVersion: 'candidate', explicitSelection: true, preserveConfiguration: true, stepId: '004-upgrade-candidate'},
        {action: 'reject-default-downgrade', expectedVersion: 'prior-release', explicitSelection: false, preserveConfiguration: true, stepId: '005-reject-default-downgrade'},
        {action: 'downgrade', expectedVersion: 'prior-release', explicitSelection: true, preserveConfiguration: false, stepId: '006-explicit-downgrade'},
        {action: 'upgrade', expectedVersion: 'candidate', explicitSelection: true, preserveConfiguration: true, stepId: '007-restore-candidate'},
    ]);

    const plainInit = resolveReleaseValidationStep({
        machineKey: 'Windows 11',
        scenarioId: 'scenarios/windows/plain',
        stepId: '002-init',
    }).step;
    assert.deepEqual(Object.keys(plainInit), [
        'auditedLocation',
        'choiceContract',
        'choiceParameters',
        'command',
        'dependencies',
        'index',
        'judgment',
        'mechanicalContract',
        'mechanicalParameters',
        'operationContract',
        'operationParameters',
        'stepId',
    ]);
    assert.deepEqual(plainInit.dependencies, [{scenarioId: 'scenarios/windows/plain', stepId: '001-install'}]);
    assert.equal(plainInit.choiceContract, 'workflow-init-choices');
    assert.deepEqual(plainInit.choiceParameters, {
        orphanCodeMapReadmes: null,
        profile: 'plain',
        transformExistingAgentDocs: null,
    });
    assert.equal(plainInit.judgment, 'mechanical');
    assert.equal(plainInit.mechanicalContract, 'repository-workflow-transition');
    assert.deepEqual(plainInit.mechanicalParameters, {
        expectedVerificationFindings: [],
        operation: 'init',
        profile: 'plain',
        retainedPaths: [],
    });
    assert.equal(resolveReleaseValidationStep({
        machineKey: 'Windows 11',
        scenarioId: 'scenarios/windows/plain',
        stepId: '002-init',
    }).scenario.targetKind, 'plain');
    assert.equal(resolveReleaseValidationStep({
        machineKey: 'Ubuntu',
        scenarioId: 'scenarios/ubuntu/fresh-agent-assisted',
        stepId: '002-init',
    }).scenario.targetKind, 'agent-assisted');

    const ubuntuRemove = resolveReleaseValidationStep({
        machineKey: 'Ubuntu',
        scenarioId: 'scenarios/ubuntu/agent-assisted',
        stepId: '007-workflow-remove',
    }).step;
    assert.deepEqual(ubuntuRemove.mechanicalParameters, {
        expectedVerificationFindings: [],
        operation: 'remove',
        profile: 'agent-assisted',
        retainedPaths: [],
    });

    const windowsCodeMap = resolveReleaseValidationStep({
        machineKey: 'Windows 11',
        scenarioId: 'scenarios/windows/agent-assisted',
        stepId: '006-code-map-verify',
    }).step;
    assert.deepEqual(windowsCodeMap.mechanicalParameters, {
        expectedFindings: [],
        kind: 'code-map',
    });
    const freshAgentInit = resolveReleaseValidationStep({
        machineKey: 'Ubuntu',
        scenarioId: 'scenarios/ubuntu/fresh-agent-assisted',
        stepId: '002-init',
    }).step;
    assert.deepEqual(freshAgentInit.mechanicalParameters.expectedVerificationFindings,
        [...freshCodeMapPaths]
            .sort((left, right) => left.localeCompare(right, 'en'))
            .map(path => ({code: 'ordinary-readme-at-code-map-path', path})));
    const ubuntuAgentUpdate = resolveReleaseValidationStep({
        machineKey: 'Ubuntu',
        scenarioId: 'scenarios/ubuntu/fresh-agent-assisted',
        stepId: '004-workflow-update',
    }).step;
    assert.deepEqual(ubuntuAgentUpdate.mechanicalParameters.expectedVerificationFindings, []);
    const ubuntuCodeMap = resolveReleaseValidationStep({
        machineKey: 'Ubuntu',
        scenarioId: 'scenarios/ubuntu/agent-assisted',
        stepId: '006-code-map-verify',
    }).step;
    assert.deepEqual(ubuntuCodeMap.mechanicalParameters, {expectedFindings: [], kind: 'code-map'});
    for (const machineKey of RELEASE_MACHINE_KEYS) {
        const machine = machineKey.toLowerCase().replace(' 11', '').replace(' ', '-');
        const scenario = scenarios.find((/** @type {TestScenario} */ entry) => entry.archiveKind === `scenarios/${machine}/agent-assisted`);
        assert.ok(scenario.prerequisites.includes('prior-release-fixture'));
        assert.deepEqual(scenario.steps.slice(0, 4).map((/** @type {TestRecord} */ step) => ({
            auditedLocation: step.auditedLocation,
            stepId: step.stepId,
        })), [
            {auditedLocation: 'installation', stepId: '001-install-prior-release'},
            {auditedLocation: 'repository', stepId: '002-verify-prior-workflow'},
            {auditedLocation: 'installation', stepId: '003-upgrade-candidate'},
            {auditedLocation: 'repository', stepId: '004-workflow-update'},
        ]);
    }
    const freshRemove = resolveReleaseValidationStep({
        machineKey: 'Ubuntu',
        scenarioId: 'scenarios/ubuntu/fresh-agent-assisted',
        stepId: '007-workflow-remove',
    }).step;
    assert.deepEqual(freshRemove.mechanicalParameters.retainedPaths, freshCodeMapPaths);

    const finalState = resolveReleaseValidationStep({
        machineKey: 'Ubuntu',
        scenarioId: 'observations/ubuntu/floor',
        stepId: '005-verify-final-state',
    }).step;
    assert.equal(finalState.command, false);
    assert.equal(finalState.operationContract, 'observe-installation-final-state');
    assert.deepEqual(finalState.operationParameters, {});
    assert.equal(finalState.mechanicalContract, 'installation-final-state');
    assert.deepEqual(finalState.mechanicalParameters, {configuration: 'preserved'});

    const semantic = resolveReleaseValidationStep({
        machineKey: 'Ubuntu',
        scenarioId: 'scenarios/ubuntu/fresh-agent-assisted',
        stepId: '003-complete-initialization-issue',
    }).step;
    assert.equal(semantic.judgment, 'semantic');
    assert.equal(semantic.mechanicalContract, null);
    assert.equal(semantic.operationContract, null);
    assert.deepEqual(scenarios.at(-1), {
        archiveKind: 'post-tag',
        machineKey: null,
        phase: 'post-tag',
        prerequisites: ['candidate-tag-present', 'source-checkout'],
        steps: scenarios.at(-1).steps,
        targetKind: null,
    });
});

test('Scenario Plan binds exact bundles and resolves only applicable registered choices', () => {
    const candidateCommit = 'a'.repeat(40);
    const plan = createReleaseValidationScenarioPlan({
        bundleFacts: {
            agentAssisted: {commit: RELEASE_TARGETS.agentAssisted.commit, kind: 'agent-assisted'},
            candidate: {commit: candidateCommit, kind: 'candidate', priorRelease: {commit: 'd'.repeat(40), tag: '0.2.1'}},
            plain: {commit: RELEASE_TARGETS.plain.commit, kind: 'plain'},
            status: 'inspected',
        },
        candidateCommit,
    });
    assert.deepEqual(Object.keys(plan), ['candidateCommit', 'registryDigest', 'scenarios']);
    assert.match(plan.registryDigest, /^[0-9a-f]{64}$/);
    assert.equal(plan.scenarios.length, 10);
    assert.ok(plan.scenarios.every((/** @type {TestRecord} */ scenario) => scenario.phase === 'pre-tag'));
    const floor = plan.scenarios.find((/** @type {TestRecord} */ scenario) => scenario.archiveKind === 'observations/ubuntu/floor');
    assert.deepEqual(floor.steps.find((/** @type {{ stepId: string; }} */ step) => step.stepId === '001-check-esm-syntax').mechanicalParameters, {
        entries: RELEASE_ESM_LIFECYCLE_ENTRIES,
        runtime: 'minimum',
    });
    assert.deepEqual(floor.steps.find((/** @type {{ stepId: string; }} */ step) => step.stepId === '003-verify-launcher').mechanicalParameters, {
        shell: 'login-shell',
        sourceAvailable: true,
        version: ARW_VERSION,
    });
    const plain = plan.scenarios.find((/** @type {TestRecord} */ scenario) => scenario.archiveKind === 'scenarios/windows/plain');
    assert.equal(plain.targetKind, 'plain');
    assert.deepEqual(plain.steps.find((/** @type {{ stepId: string; }} */ step) => step.stepId === '002-init').choices, {profile: 'plain'});
    assert.deepEqual(plain.steps.find((/** @type {{ stepId: string; }} */ step) => step.stepId === '003-workflow-update').choices, {});
    assert.deepEqual(plain.steps.find((/** @type {{ stepId: string; }} */ step) => step.stepId === '005-workflow-remove').choices, {
        arwignore: 'delete',
    });
    const windowsAgentAssisted = plan.scenarios.find((/** @type {TestRecord} */ scenario) => scenario.archiveKind === 'scenarios/windows/agent-assisted');
    assert.deepEqual(windowsAgentAssisted.steps.find((/** @type {{ stepId: string; }} */ step) => step.stepId === '007-workflow-remove').choices, {
        arwignore: 'delete',
        codeMaps: 'retain',
        mixedAgentDocuments: 'delete',
    });
    const ubuntuAgentAssisted = plan.scenarios.find((/** @type {TestRecord} */ scenario) => scenario.archiveKind === 'scenarios/ubuntu/agent-assisted');
    assert.equal(ubuntuAgentAssisted.steps.some((/** @type {{ stepId: string; }} */ step) => step.stepId.endsWith('-init')), false);
    const alpineAgentAssisted = plan.scenarios.find((/** @type {TestRecord} */ scenario) => scenario.archiveKind === 'scenarios/alpine/agent-assisted');
    assert.deepEqual(alpineAgentAssisted.steps.find((/** @type {{ stepId: string; }} */ step) => step.stepId === '007-workflow-remove').choices, {
        arwignore: 'delete',
        codeMaps: 'retain',
        mixedAgentDocuments: 'delete',
    });
    assert.throws(() => createReleaseValidationScenarioPlan({
        bundleFacts: {
            agentAssisted: {commit: RELEASE_TARGETS.agentAssisted.commit, kind: 'agent-assisted'},
            candidate: {commit: 'b'.repeat(40), kind: 'candidate', priorRelease: {commit: 'd'.repeat(40), tag: '0.2.1'}},
            plain: {commit: RELEASE_TARGETS.plain.commit, kind: 'plain'},
            status: 'inspected',
        },
        candidateCommit,
    }), /bundle facts/i);
});

test('Resume completes an orphan state transition before rejecting the consumed response', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-run-');
    const runDirectory = join(workspaceDirectory, 'runs', '11111111-1111-4111-8111-111111111111');
    const runPath = join(runDirectory, 'run.json');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const responsePath = join(runDirectory, 'responses', '22222222-2222-4222-8222-222222222222.json');
    const candidateCommit = 'a'.repeat(40);
    const plan = createFreshPostInitPlan(candidateCommit);
    const semanticHandoff = {
        decision: null,
        factsDigest: null,
        handoffId: '22222222-2222-4222-8222-222222222222',
        kind: 'semantic-action',
        responsePath: null,
        resultPath: join(runDirectory, 'results', 'semantic-action.json'),
        scenarioId: 'scenarios/ubuntu/fresh-agent-assisted',
        state: 'pending',
        stepId: '003-complete-initialization-issue',
        summary: null,
    };
    const otherHandoff = {
        decision: null,
        factsDigest: null,
        handoffId: '33333333-3333-4333-8333-333333333333',
        kind: 'compensation',
        responsePath: null,
        resultPath: join(runDirectory, 'results', 'compensation.json'),
        scenarioId: 'scenarios/ubuntu/fresh-agent-assisted',
        state: 'pending',
        stepId: 'scenario-ready',
        summary: null,
    };
    const state = pendingRunState({
        configurationPath,
        handoffs: [semanticHandoff, otherHandoff],
        plan,
        runId: '11111111-1111-4111-8111-111111111111',
    });
    const response = {
        decision: 'declined',
        handoffId: semanticHandoff.handoffId,
        kind: semanticHandoff.kind,
        machineKey: 'Ubuntu',
        runId: state.runId,
        scenarioId: semanticHandoff.scenarioId,
        schemaVersion: 1,
        stepId: semanticHandoff.stepId,
        summary: 'The semantic action was not applied.',
    };
    const nextState = {
        ...state,
        handoffs: state.handoffs.map((/** @type {{ handoffId: string; }} */ handoff) => handoff.handoffId === semanticHandoff.handoffId
            ? {...handoff, decision: response.decision, responsePath, state: 'consumed', summary: response.summary}
            : handoff),
        revision: 1,
    };
    await mkdir(join(runDirectory, 'transitions'), {recursive: true});
    await writeFile(runPath, `${JSON.stringify(state)}\n`);
    await writeFile(configurationPath, `${JSON.stringify(configuration())}\n`);
    await mkdir(dirname(responsePath), {recursive: true});
    await writeFile(responsePath, `${JSON.stringify(response)}\n`);
    await writeFile(join(runDirectory, 'transitions', '1.json'), `${JSON.stringify({
        nextState,
        parentDigest: createHash('sha256').update(`${JSON.stringify(state)}\n`).digest('hex'),
        parentRevision: 0,
        revision: 1,
    })}\n`);

    await assert.rejects(resumeReleaseValidationRun({responsePath, runPath}, {
        loadConfiguration: async () => configuration(),
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    }), {
        code: 'response-invalid',
        message: 'The response does not match a pending handoff.',
        runPath,
        stage: 'response',
    });
    assert.deepEqual(JSON.parse(await readFile(runPath, 'utf8')), nextState);
});

test('Resume atomically consumes a declined semantic action and closes its dependency path', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-response-');
    const runId = '44444444-4444-4444-8444-444444444444';
    const runDirectory = join(workspaceDirectory, 'runs', runId);
    const runPath = join(runDirectory, 'run.json');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const responsePath = join(runDirectory, 'responses', '55555555-5555-4555-8555-555555555555.json');
    const candidateCommit = 'a'.repeat(40);
    const plan = createFreshPostInitPlan(candidateCommit);
    const semanticHandoff = {
        decision: null,
        factsDigest: null,
        handoffId: '55555555-5555-4555-8555-555555555555',
        kind: 'semantic-action',
        responsePath: null,
        resultPath: join(runDirectory, 'results', 'semantic-action.json'),
        scenarioId: 'scenarios/ubuntu/fresh-agent-assisted',
        state: 'pending',
        stepId: '003-complete-initialization-issue',
        summary: null,
    };
    const compensationHandoff = {
        decision: null,
        factsDigest: null,
        handoffId: '66666666-6666-4666-8666-666666666666',
        kind: 'compensation',
        responsePath: null,
        resultPath: join(runDirectory, 'results', 'compensation.json'),
        scenarioId: 'scenarios/ubuntu/fresh-agent-assisted',
        state: 'pending',
        stepId: 'scenario-ready',
        summary: null,
    };
    const state = pendingRunState({
        configurationPath,
        handoffs: [semanticHandoff, compensationHandoff],
        plan,
        runId,
    });
    state.steps = state.steps.map((/** @type {{ scenarioId: string; stepId: string; }} */ step) => {
        if (step.scenarioId === semanticHandoff.scenarioId
            && Number.parseInt(step.stepId, 10) >= 3) return step;
        if (step.scenarioId === compensationHandoff.scenarioId && step.stepId === compensationHandoff.stepId) {
            return {
                ...step,
                classification: 'formal',
                handoffId: compensationHandoff.handoffId,
                outcome: 'failed',
                reason: {code: 'expectation-mismatch', message: 'The final state did not match.', source: null},
                state: 'terminal',
            };
        }
        return {...step, classification: 'formal', outcome: 'passed', state: 'terminal'};
    });
    state.steps.find((/** @type {{ scenarioId: string; stepId: string; }} */ step) => step.scenarioId === semanticHandoff.scenarioId
        && step.stepId === semanticHandoff.stepId).handoffId = semanticHandoff.handoffId;
    const response = {
        decision: 'declined',
        handoffId: semanticHandoff.handoffId,
        kind: semanticHandoff.kind,
        machineKey: 'Ubuntu',
        runId,
        scenarioId: semanticHandoff.scenarioId,
        schemaVersion: 1,
        stepId: semanticHandoff.stepId,
        summary: 'The semantic action was not applied.',
    };
    await mkdir(join(runDirectory, 'responses'), {recursive: true});
    await writeFile(runPath, `${JSON.stringify(state)}\n`);
    await writeFile(configurationPath, `${JSON.stringify(configuration())}\n`);
    await mkdir(dirname(responsePath), {recursive: true});
    await writeFile(responsePath, `${JSON.stringify(response)}\n`);
    await writeFile(join(runDirectory, 'responses', `${compensationHandoff.handoffId}.json`), '{}\n');
    const machineLifecycleAdapter = {
        run: async (/** @type {{ machineKey: string; operation: string; }} */ request) => {
            const selectedMachine = configuration().machines[request.machineKey];
            if (request.operation === 'hard-power-off' || request.operation === 'read-power-state') {
                return {observation: {powerState: 'powered-off'}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'revert-snapshot') {
                return {observation: {snapshot: selectedMachine.snapshot}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'read-snapshots') {
                return {
                    observation: {currentSnapshot: selectedMachine.snapshot, snapshots: [selectedMachine.snapshot]},
                    operation: request.operation,
                    status: 'observed',
                };
            }
            assert.fail(`Unexpected lifecycle operation: ${request.operation}`);
        },
    };

    const result = await resumeReleaseValidationRun({responsePath, runPath}, {
        loadConfiguration: async () => configuration(),
        machineLifecycleAdapter,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    });
    assert.deepEqual(result, {
        counts: {diagnostic: 0, formal: 3, unresolved: 8},
        pendingPath: result.pendingPath,
        resultPath: null,
        runPath,
        status: 'paused',
    });
    const committed = JSON.parse(await readFile(runPath, 'utf8'));
    assert.ok(committed.revision > 1);
    assert.deepEqual(committed.handoffs[0], {
        ...semanticHandoff,
        decision: 'declined',
        responsePath,
        state: 'consumed',
        summary: response.summary,
    });
    assert.deepEqual(committed.steps.find((/** @type {{ handoffId: string; }} */ step) => step.handoffId === semanticHandoff.handoffId), {
        classification: 'formal',
        evidencePath: null,
        handoffId: semanticHandoff.handoffId,
        outcome: 'failed',
        reason: {code: 'semantic-declined', message: response.summary, source: null},
        scenarioId: semanticHandoff.scenarioId,
        state: 'terminal',
        stepId: semanticHandoff.stepId,
    });
    assert.equal(committed.steps.filter((/** @type {{ classification: string; }} */ step) => step.classification === 'unresolved').length, 8);
    assert.equal(committed.cleanup.find((/** @type {{ scenarioId: string; }} */ record) => record.scenarioId === semanticHandoff.scenarioId).stage, 'final');
});

test('Resume preserves the last committed state after transition collision or partial marker failure', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-collision-');
    const runId = '77777777-7777-4777-8777-777777777777';
    const runDirectory = join(workspaceDirectory, 'runs', runId);
    const runPath = join(runDirectory, 'run.json');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const responsePath = join(runDirectory, 'responses', '88888888-8888-4888-8888-888888888888.json');
    const candidateCommit = 'a'.repeat(40);
    const plan = createFreshPostInitPlan(candidateCommit);
    const handoff = {
        decision: null,
        factsDigest: null,
        handoffId: '88888888-8888-4888-8888-888888888888',
        kind: 'semantic-action',
        responsePath: null,
        resultPath: join(runDirectory, 'results', 'semantic-action.json'),
        scenarioId: 'scenarios/ubuntu/fresh-agent-assisted',
        state: 'pending',
        stepId: '003-complete-initialization-issue',
        summary: null,
    };
    const state = pendingRunState({configurationPath, handoffs: [handoff], plan, runId});
    state.steps = state.steps.map((/** @type {{ handoffId: string; }} */ step) => step.handoffId === handoff.handoffId
        ? step
        : {...step, classification: 'formal', outcome: 'passed', state: 'terminal'});
    const response = {
        decision: 'declined',
        handoffId: handoff.handoffId,
        kind: handoff.kind,
        machineKey: 'Ubuntu',
        runId,
        scenarioId: handoff.scenarioId,
        schemaVersion: 1,
        stepId: handoff.stepId,
        summary: 'The semantic action was not applied.',
    };
    await mkdir(runDirectory, {recursive: true});
    await writeFile(runPath, `${JSON.stringify(state)}\n`);
    await writeFile(configurationPath, `${JSON.stringify(configuration())}\n`);
    await mkdir(dirname(responsePath), {recursive: true});
    await writeFile(responsePath, `${JSON.stringify(response)}\n`);
    const fileSystem = {
        lstat,
        mkdir,
        readFile,
        rename,
        rm,
        writeFile: async (/** @type {string} */ path, /** @type {unknown} */ bytes, /** @type {unknown} */ options) => {
            if (path === join(runDirectory, 'transitions', '1.json')) {
                const error = new Error('exclusive create collision');
                Reflect.set(error, 'code', 'EEXIST');
                throw error;
            }
            return writeFile(path, bytes, options);
        },
    };

    await assert.rejects(resumeReleaseValidationRun({responsePath, runPath}, {
        fileSystem,
        loadConfiguration: async () => configuration(),
        machineLifecycleAdapter: {run: async () => assert.fail('A transition collision must fail before cleanup.')},
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    }), {
        code: 'concurrent-transition',
        message: 'Another run-state transition is already in progress.',
        runPath,
        stage: 'state-write',
    });
    assert.deepEqual(JSON.parse(await readFile(runPath, 'utf8')), state);

    const markerPath = join(runDirectory, 'transitions', '1.json');
    const partialFileSystem = {
        lstat,
        mkdir,
        readFile,
        rename,
        rm,
        writeFile: async (/** @type {string} */ path, /** @type {unknown} */ bytes, /** @type {unknown} */ options) => {
            if (path === markerPath) {
                await writeFile(path, 'partial transition\n', options);
                throw Object.assign(new Error('injected partial transition failure'), {code: 'EIO'});
            }
            return writeFile(path, bytes, options);
        },
    };
    await assert.rejects(resumeReleaseValidationRun({responsePath, runPath}, {
        fileSystem: partialFileSystem,
        loadConfiguration: async () => configuration(),
        machineLifecycleAdapter: {run: async () => assert.fail('A transition write failure must fail before cleanup.')},
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    }), {
        code: 'persistence-failed',
        message: 'The run state could not be committed.',
        runPath,
        stage: 'state-write',
    });
    await assert.rejects(lstat(markerPath), {code: 'ENOENT'});
    assert.deepEqual(JSON.parse(await readFile(runPath, 'utf8')), state);
});

test('Resume rejects a malformed child record before configuration or state mutation', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-state-invalid-');
    const runId = '13131313-1313-4313-8313-131313131313';
    const runDirectory = join(workspaceDirectory, 'runs', runId);
    const runPath = join(runDirectory, 'run.json');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const candidateCommit = 'a'.repeat(40);
    const plan = createReleaseValidationScenarioPlan({bundleFacts: inspectedBundles(candidateCommit), candidateCommit});
    const state = pendingRunState({configurationPath, handoffs: [], plan, runId});
    state.steps[0].unexpected = true;
    await mkdir(runDirectory, {recursive: true});
    await writeFile(runPath, `${JSON.stringify(state)}\n`);
    let configurationRead = false;

    await assert.rejects(resumeReleaseValidationRun({responsePath: null, runPath}, {
        loadConfiguration: async () => {
            configurationRead = true;
            return configuration();
        },
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    }), {
        code: 'state-invalid',
        message: 'The run state is invalid.',
        runPath,
        stage: 'state-read',
    });
    assert.equal(configurationRead, false);
    assert.deepEqual(JSON.parse(await readFile(runPath, 'utf8')), state);
});

test('Resume rejects drifted Scenario Plans and persisted paths outside the current run', async t => {
    const cases = [
        {
            name: 'registry digest drift',
            mutate: (/** @type {{ plan: { registryDigest: string; }; }} */ state) => { state.plan.registryDigest = 'b'.repeat(64); },
        },
        {
            name: 'frozen choice drift',
            mutate: (/** @type {ReturnType<typeof pendingRunStateImplementation>} */ state) => {
                const scenario = requireValue(
                    state.plan.scenarios.find(item => item.archiveKind === 'scenarios/ubuntu/plain'),
                    'Expected Ubuntu plain scenario.',
                );
                const step = requireValue(scenario.steps.find(candidate => candidate.stepId === '002-init'), 'Expected init step.');
                Reflect.set(step, 'choices', {profile: 'agent-assisted'});
            },
        },
        {
            name: 'cross-run step evidence',
            mutate: (/** @type {{ steps: { evidencePath: string; }[]; }} */ state, /** @type {string} */ runDirectory) => { state.steps[0].evidencePath = join(dirname(runDirectory), 'other-run', 'result.json'); },
        },
        {
            name: 'cross-run archive paths',
            mutate: (/** @type {ReturnType<typeof pendingRunStateImplementation>} */ state, /** @type {string} */ runDirectory) => {
                Reflect.set(
                    requireValue(state.archives[0], 'Expected archive state.'),
                    'outputPath',
                    join(dirname(runDirectory), 'other-run', 'archive.tar'),
                );
                Reflect.set(requireValue(state.archives[0], 'Expected archive state.'), 'reason', null);
                Reflect.set(requireValue(state.archives[0], 'Expected archive state.'), 'sourceDirectory', join(dirname(runDirectory), 'other-run', 'archive-source'));
                Reflect.set(requireValue(state.archives[0], 'Expected archive state.'), 'status', 'pending');
            },
        },
        {
            name: 'duplicate handoff identity',
            mutate: (/** @type {{ handoffs: { decision: null; factsDigest: null; handoffId: string; kind: string; responsePath: null; resultPath: string; scenarioId: string; state: string; stepId: string; summary: null; }[]; }} */ state, /** @type {string} */ runDirectory) => {
                state.handoffs = ['001-install-prior-release', '002-prepare-preserved-configuration'].map(stepId => ({
                    decision: null,
                    factsDigest: null,
                    handoffId: '52525252-5252-4525-8525-525252525252',
                    kind: 'compensation',
                    responsePath: null,
                    resultPath: join(runDirectory, 'results', `${stepId}.json`),
                    scenarioId: 'observations/windows/recommended',
                    state: 'pending',
                    stepId,
                    summary: null,
                }));
            },
        },
        {
            name: 'unknown handoff locator',
            mutate: (/** @type {{ handoffs: { decision: null; factsDigest: null; handoffId: string; kind: string; responsePath: null; resultPath: string; scenarioId: string; state: string; stepId: string; summary: null; }[]; }} */ state, /** @type {string} */ runDirectory) => {
                state.handoffs = [{
                    decision: null,
                    factsDigest: null,
                    handoffId: '53535353-5353-4535-8535-535353535353',
                    kind: 'compensation',
                    responsePath: null,
                    resultPath: join(runDirectory, 'results', 'unknown.json'),
                    scenarioId: 'observations/windows/recommended',
                    state: 'pending',
                    stepId: '999-unknown',
                    summary: null,
                }];
            },
        },
        {
            name: 'duplicate pending compensation locator',
            mutate: (/** @type {{ handoffs: { decision: null; factsDigest: null; handoffId: string; kind: string; responsePath: null; resultPath: string; scenarioId: string; state: string; stepId: string; summary: null; }[]; }} */ state, /** @type {string} */ runDirectory) => {
                state.handoffs = ['54545454-5454-4545-8545-545454545454', '55555555-5555-4555-8555-555555555555'].map(handoffId => ({
                    decision: null,
                    factsDigest: null,
                    handoffId,
                    kind: 'compensation',
                    responsePath: null,
                    resultPath: join(runDirectory, 'results', `${handoffId}.json`),
                    scenarioId: 'observations/windows/recommended',
                    state: 'pending',
                    stepId: '001-install-prior-release',
                    summary: null,
                }));
            },
        },
        {
            name: 'recovery overlaps in-flight machine',
            mutate: (/** @type {{ revision: number; inFlight: { machineKey: string; operation: string; scenarioId: string; startedRevision: number; stepId: string; }[]; recovery: { machineKey: string; nextOperation: string; outcome: string; scenarioId: string; sourceOperation: string; stepId: string; }[]; }} */ state) => {
                state.revision = 1;
                state.inFlight = [{
                    machineKey: 'Windows 11',
                    operation: 'run-guest',
                    scenarioId: 'observations/windows/recommended',
                    startedRevision: 1,
                    stepId: 'scenario-ready',
                }];
                state.recovery = [{
                    machineKey: 'Windows 11',
                    nextOperation: 'hard-power-off',
                    outcome: 'pending',
                    scenarioId: 'observations/windows/recommended',
                    sourceOperation: 'run-guest',
                    stepId: 'scenario-ready',
                }];
            },
        },
        {
            name: 'unknown recovery operation',
            mutate: (/** @type {{ recovery: { machineKey: string; nextOperation: string; outcome: string; scenarioId: string; sourceOperation: string; stepId: string; }[]; }} */ state) => {
                state.recovery = [{
                    machineKey: 'Windows 11',
                    nextOperation: 'hard-power-off',
                    outcome: 'pending',
                    scenarioId: 'observations/windows/recommended',
                    sourceOperation: 'not-registered',
                    stepId: 'scenario-ready',
                }];
            },
        },
    ];
    for (const [index, currentCase] of cases.entries()) {
        const workspaceDirectory = await createTemporaryDirectory(t, `arw-release-closed-state-${index}-`);
        const runId = `51515151-5151-4515-8515-5151515151${String(index).padStart(2, '0')}`;
        const runDirectory = join(workspaceDirectory, 'runs', runId);
        const runPath = join(runDirectory, 'run.json');
        const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
        const candidateCommit = 'a'.repeat(40);
        const plan = JSON.parse(JSON.stringify(createReleaseValidationScenarioPlan({
            bundleFacts: inspectedBundles(candidateCommit),
            candidateCommit,
        })));
        const state = pendingRunState({configurationPath, handoffs: [], plan, runId});
        currentCase.mutate(state, runDirectory);
        await mkdir(runDirectory, {recursive: true});
        await writeFile(runPath, `${JSON.stringify(state)}\n`);
        let configurationRead = false;
        await assert.rejects(resumeReleaseValidationRun({responsePath: null, runPath}, {
            loadConfiguration: async () => {
                configurationRead = true;
                return configuration();
            },
            workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
        }), error => error !== null && typeof error === 'object'
            && 'code' in error && error.code === 'state-invalid'
            && 'stage' in error && error.stage === 'state-read', currentCase.name);
        assert.equal(configurationRead, false, currentCase.name);
    }
});

test('Resume accepts a response only from the exact current handoff template path', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-response-path-');
    const runId = '52525252-5252-4525-8525-525252525252';
    const handoffId = '53535353-5353-4535-8535-535353535353';
    const runDirectory = join(workspaceDirectory, 'runs', runId);
    const runPath = join(runDirectory, 'run.json');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const candidateCommit = 'a'.repeat(40);
    const plan = createFreshPostInitPlan(candidateCommit);
    const handoff = {
        decision: null,
        factsDigest: null,
        handoffId,
        kind: 'semantic-action',
        responsePath: null,
        resultPath: join(runDirectory, 'results', 'semantic-action.json'),
        scenarioId: 'scenarios/ubuntu/fresh-agent-assisted',
        state: 'pending',
        stepId: '003-complete-initialization-issue',
        summary: null,
    };
    const state = pendingRunState({configurationPath, handoffs: [handoff], plan, runId});
    const response = {
        decision: 'declined',
        handoffId,
        kind: 'semantic-action',
        machineKey: 'Ubuntu',
        runId,
        scenarioId: handoff.scenarioId,
        schemaVersion: 1,
        stepId: handoff.stepId,
        summary: 'The action was not applied.',
    };
    const wrongPath = join(runDirectory, 'responses', 'copied-response.json');
    await mkdir(dirname(wrongPath), {recursive: true});
    await writeFile(runPath, `${JSON.stringify(state)}\n`);
    await writeFile(wrongPath, `${JSON.stringify(response)}\n`);
    await assert.rejects(resumeReleaseValidationRun({responsePath: wrongPath, runPath}, {
        loadConfiguration: async () => configuration(),
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    }), {
        code: 'response-invalid',
        message: 'The response does not match a pending handoff.',
        runPath,
        stage: 'response',
    });
    assert.deepEqual(JSON.parse(await readFile(runPath, 'utf8')), state);
});

test('run state atomic rename retries only bounded Windows EPERM failures', async t => {
    const runCase = async (/** @type {{expectedAttempts: number, injectedCodes: string[]}} */ {expectedAttempts, injectedCodes}) => {
        const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-state-rename-');
        const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
        const candidateCommit = 'a'.repeat(40);
        const configured = configuration();
        configured.maxParallelMachines = 1;
        await writeFile(configurationPath, `${JSON.stringify(configured)}\n`);
        const identities = [
            '71717171-7171-4717-8717-717171717171',
            '72727272-7272-4727-8727-727272727272',
            '73737373-7373-4737-8737-737373737373',
            '74747474-7474-4747-8747-747474747474',
            '75757575-7575-4757-8757-757575757575',
            '76767676-7676-4767-8767-767676767676',
            '77777777-7777-4777-8777-777777777777',
        ];
        let renameAttempts = 0;
        const fileSystem = {
            lstat,
            mkdir,
            readFile,
            rename: async (/** @type {import("fs").PathLike} */ source, /** @type {import("fs").PathLike} */ target) => {
                const code = injectedCodes[renameAttempts];
                renameAttempts += 1;
                if (code !== undefined) throw Object.assign(new Error(`Injected ${code} rename failure.`), {code});
                return rename(source, target);
            },
            rm,
            writeFile,
        };
        const initialReads = new Set();
        const machineLifecycleAdapter = {
        run: async (/** @type {TestRequest} */ request) => {
                if (request.operation === 'read-power-state' && !initialReads.has(request.machineKey)) {
                    initialReads.add(request.machineKey);
                    return {
                        code: 'observation-failed',
                        message: 'The initial power state could not be observed.',
                        operation: request.operation,
                        status: 'failed',
                    };
                }
                if (request.operation === 'hard-power-off' || request.operation === 'read-power-state') {
                    return {observation: {powerState: 'powered-off'}, operation: request.operation, status: 'observed'};
                }
                assert.fail(`Unexpected lifecycle operation: ${request.operation}`);
            },
        };
        const start = startReleaseValidationRun({candidateCommit, configurationPath, workspaceDirectory}, {
            fileSystem,
            idFactory: () => identities.shift(),
            inspectBundles: async () => inspectedBundles(candidateCommit),
            loadConfiguration: async () => configured,
            machineLifecycleAdapter,
            workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
        });
        const shouldSucceed = injectedCodes.length < 3 && injectedCodes.every((/** @type {string} */ code) => code === 'EPERM');
        if (shouldSucceed) {
            assert.equal((await start).status, 'paused');
        } else {
            await assert.rejects(start, {
                code: 'persistence-failed',
                message: 'The run state could not be committed.',
                stage: 'state-write',
            });
        }
        assert.equal(shouldSucceed ? renameAttempts >= expectedAttempts : renameAttempts === expectedAttempts, true);
    };

    await runCase({expectedAttempts: 3, injectedCodes: ['EPERM', 'EPERM']});
    await runCase({expectedAttempts: 1, injectedCodes: ['EACCES']});
    await runCase({expectedAttempts: 3, injectedCodes: ['EPERM', 'EPERM', 'EPERM']});
});

test('Start batches independent setup failures as original results and minimal compensation templates', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-start-');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const candidateCommit = 'a'.repeat(40);
    const runId = '99999999-9999-4999-8999-999999999999';
    const configured = configuration();
    configured.maxParallelMachines = 2;
    await writeFile(configurationPath, `${JSON.stringify(configured)}\n`);
    let active = 0;
    let maximumActive = 0;
    const initialReads = new Set();
    const calls = testRecords();
    const machineLifecycleAdapter = {
        run: async (/** @type {TestRequest} */ request) => {
            calls.push({machineKey: request.machineKey, operation: request.operation});
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await new Promise(resolvePromise => setImmediate(resolvePromise));
            active -= 1;
            if (request.operation === 'read-power-state' && !initialReads.has(request.machineKey)) {
                initialReads.add(request.machineKey);
                return {
                    code: 'observation-failed',
                    message: 'The initial power state could not be observed.',
                    operation: request.operation,
                    status: 'failed',
                };
            }
            if (request.operation === 'hard-power-off') {
                return {observation: {powerState: 'powered-off'}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'read-power-state') {
                return {observation: {powerState: 'powered-off'}, operation: request.operation, status: 'observed'};
            }
            return {
                observation: {disks: [{chain: [join(workspaceDirectory, `${request.machineKey}.vmdk`)], controllerKey: 'sata0:0'}]},
                operation: request.operation,
                status: 'observed',
            };
        },
    };

    const identities = [
        runId,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'abababab-abab-4bab-8bab-abababababab',
        'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc',
        'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
    ];
    const result = await startReleaseValidationRun({candidateCommit, configurationPath, workspaceDirectory}, {
        idFactory: () => identities.shift(),
        inspectBundles: async () => inspectedBundles(candidateCommit),
        loadConfiguration: async () => configured,
        machineLifecycleAdapter,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    });
    const runDirectory = join(workspaceDirectory, 'runs', runId);
    const state = JSON.parse(await readFile(join(runDirectory, 'run.json'), 'utf8'));
    assert.deepEqual(result, {
        counts: {diagnostic: 0, formal: 0, unresolved: 115},
        pendingPath: result.pendingPath,
        resultPath: null,
        runPath: join(runDirectory, 'run.json'),
        status: 'paused',
    });
    assert.equal(isAbsolute(result.pendingPath), true);
    const pending = JSON.parse(await readFile(result.pendingPath, 'utf8'));
    assert.deepEqual(pending, {
        items: pending.items,
        runId,
        schemaVersion: 1,
    });
    assert.deepEqual(pending.items.map((/** @type {TestRecord} */ item) => ({
        kind: item.kind,
        scenarioId: item.scenarioId,
        stepId: item.stepId,
    })), [
        {kind: 'compensation', scenarioId: 'observations/windows/recommended', stepId: 'scenario-ready'},
        {kind: 'compensation', scenarioId: 'observations/ubuntu/recommended', stepId: 'scenario-ready'},
        {kind: 'compensation', scenarioId: 'observations/alpine/recommended', stepId: 'scenario-ready'},
    ]);
    for (const item of pending.items) {
        assert.equal(isAbsolute(item.resultPath), true);
        assert.equal(isAbsolute(item.responseTemplatePath), true);
        assert.deepEqual(JSON.parse(await readFile(item.resultPath, 'utf8')), scenarioReadinessResult({
            matchesExpected: false,
            scenarioId: item.scenarioId,
            summary: 'The initial power state could not be observed.',
        }));
        const handoff = state.handoffs.find((/** @type {TestRecord} */ record) => record.scenarioId === item.scenarioId);
        assert.deepEqual(JSON.parse(await readFile(item.responseTemplatePath, 'utf8')), {
            decision: null,
            handoffId: handoff.handoffId,
            kind: 'compensation',
            runId,
            scenarioId: item.scenarioId,
            schemaVersion: 1,
            stepId: 'scenario-ready',
        });
    }
    assert.ok(maximumActive <= 2);
    assert.equal(new Set(calls.map(call => call.machineKey)).size, 3);
    assert.equal(state.status, 'paused');
    assert.equal(state.maxParallelMachines, 2);
    assert.equal(state.configurationPath, configurationPath);
    assert.equal(state.steps.every((/** @type {{ classification: string; outcome: string; }} */ step) => step.classification === 'unresolved' && step.outcome === 'not-run'), true);
    assert.deepEqual(state.handoffs.map((/** @type {TestRecord} */ handoff) => handoff.scenarioId), [
        'observations/windows/recommended',
        'observations/ubuntu/recommended',
        'observations/alpine/recommended',
    ]);
    assert.equal(state.inFlight.length, 0);
});

test('Start validates snapshot facts before binding a later setup failure', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-lifecycle-');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const candidateCommit = 'a'.repeat(40);
    const runId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const configured = configuration();
    await writeFile(configurationPath, `${JSON.stringify(configured)}\n`);
    const calls = testRecords();
    const readCounts = new Map();
    const snapshotCounts = new Map();
    const machineLifecycleAdapter = {
        run: async (/** @type {TestRequest} */ request) => {
            calls.push({machineKey: request.machineKey, operation: request.operation});
            if (request.operation === 'read-power-state') {
                const count = readCounts.get(request.machineKey) ?? 0;
                readCounts.set(request.machineKey, count + 1);
                return {
                    observation: {powerState: count === 0 ? 'running' : 'powered-off'},
                    operation: request.operation,
                    status: 'observed',
                };
            }
            if (request.operation === 'read-snapshots') {
                const count = snapshotCounts.get(request.machineKey) ?? 0;
                snapshotCounts.set(request.machineKey, count + 1);
                return {
                    observation: {currentSnapshot: count === 0 ? null : 'baseline', snapshots: ['baseline', 'other']},
                    operation: request.operation,
                    status: 'observed',
                };
            }
            if (request.operation === 'revert-snapshot') {
                return {observation: {snapshot: 'baseline'}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'start-background') {
                return {
                    code: 'process-failed',
                    message: 'The virtual machine did not start.',
                    operation: request.operation,
                    status: 'failed',
                };
            }
            return {observation: {powerState: 'powered-off'}, operation: request.operation, status: 'observed'};
        },
    };
    const identities = [
        runId,
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        '12121212-1212-4212-8212-121212121212',
        '13131313-1313-4313-8313-131313131313',
        '14141414-1414-4414-8414-141414141414',
        '15151515-1515-4515-8515-151515151515',
    ];

    const result = await startReleaseValidationRun({candidateCommit, configurationPath, workspaceDirectory}, {
        idFactory: () => identities.shift(),
        inspectBundles: async () => inspectedBundles(candidateCommit),
        loadConfiguration: async () => configured,
        machineLifecycleAdapter,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    });
    assert.deepEqual(result.counts, {diagnostic: 0, formal: 0, unresolved: 115});
    for (const machineKey of RELEASE_MACHINE_KEYS) {
        assert.deepEqual(calls.filter(call => call.machineKey === machineKey).map(call => call.operation), [
            'read-power-state',
            'hard-power-off',
            'read-snapshots',
            'revert-snapshot',
            'read-power-state',
            'read-snapshots',
            'start-background',
            'hard-power-off',
            'read-power-state',
        ]);
    }
});

test('Start preserves lifecycle cleanup failure and closes the affected machine paths', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-cleanup-failure-');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const candidateCommit = 'a'.repeat(40);
    const runId = '75757575-7575-4757-8757-757575757575';
    const configured = configuration();
    await writeFile(configurationPath, `${JSON.stringify(configured)}\n`);
    const machineLifecycleAdapter = {
        run: async (/** @type {{ operation: string; }} */ request) => ({
            code: request.operation === 'read-power-state' ? 'observation-failed' : 'process-failed',
            message: request.operation === 'read-power-state'
                ? 'The initial power state could not be observed.'
                : 'The failed machine could not be powered off.',
            operation: request.operation,
            status: 'failed',
        }),
    };
    const identities = [
        runId,
        '78787878-7878-4787-8787-787878787878',
        '79797979-7979-4797-8797-797979797979',
        '80808080-8080-4808-8808-808080808080',
        '81818181-8181-4818-8818-818181818181',
    ];

    const result = await startReleaseValidationRun({candidateCommit, configurationPath, workspaceDirectory}, {
        idFactory: () => identities.shift(),
        inspectBundles: async () => inspectedBundles(candidateCommit),
        loadConfiguration: async () => configured,
        machineLifecycleAdapter,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    });
    assert.deepEqual(result.counts, {diagnostic: 0, formal: 0, unresolved: 115});
    assert.equal(result.pendingPath, null);
    assert.equal(result.status, 'completed');
    const complete = JSON.parse(await readFile(result.resultPath, 'utf8'));
    assert.equal(complete.cleanup.every((/** @type {{ outcome: string; reason: { code: string; }; }} */ record) => record.outcome === 'failed'
        && record.reason.code === 'failure-hold-failed'), true);
    assert.equal(complete.scenarios.every((/** @type {{archive: null, archiveReason: {code: string}, steps: Array<{classification: string}>}} */ scenario) => scenario.archive === null
        && scenario.archiveReason.code === 'ineligible-cleanup'
        && scenario.steps.every(step => step.classification === 'unresolved')), true);
    const persistedFailures = await Promise.all((await readdir(join(workspaceDirectory, 'runs', runId, 'results')))
        .map(name => readFile(join(workspaceDirectory, 'runs', runId, 'results', name), 'utf8')));
    assert.equal(persistedFailures.length, 3);
    assert.equal(persistedFailures.every(bytes => JSON.parse(bytes).matchesExpected === false), true);
    assert.equal(complete.cleanup.filter((/** @type {{ resultPath: null; }} */ record) => record.resultPath !== null).length, 3);
    assert.equal(complete.cleanup.filter((/** @type {{ resultPath: null; }} */ record) => record.resultPath !== null)
        .every((/** @type {{ resultPath: string; }} */ record) => isAbsolute(record.resultPath)), true);
});

test('Start mechanically judges first steps and batches independent step failures', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-step-failures-');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const candidateCommit = 'a'.repeat(40);
    const configured = configuration();
    await writeFile(configurationPath, `${JSON.stringify(configured)}\n`);
    await writeFile(join(workspaceDirectory, 'bundles.json'), `${JSON.stringify({
        bundles: {
            agentAssisted: join(workspaceDirectory, 'agentAssisted.bundle'),
            candidate: join(workspaceDirectory, 'candidate.bundle'),
            plain: join(workspaceDirectory, 'plain.bundle'),
        },
        candidateCommit,
        priorRelease: {commit: 'd'.repeat(40), tag: '0.2.1'},
        targetCommits: {agentAssisted: RELEASE_TARGETS.agentAssisted.commit, plain: RELEASE_TARGETS.plain.commit},
        status: 'prepared',
    })}\n`);
    await Promise.all(['agentAssisted', 'candidate', 'plain'].map(name => writeFile(join(workspaceDirectory, `${name}.bundle`), name)));
    const machineLifecycleAdapter = {
        run: async (/** @type {{ operation: string; }} */ request) => {
            if (request.operation === 'read-power-state' || request.operation === 'hard-power-off') {
                return {observation: {powerState: 'powered-off'}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'read-snapshots') {
                return {observation: {currentSnapshot: 'baseline', snapshots: ['baseline']}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'revert-snapshot') {
                return {observation: {snapshot: 'baseline'}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'start-background') {
                return {observation: {powerState: 'running'}, operation: request.operation, status: 'observed'};
            }
            return {observation: {address: '192.0.2.10'}, operation: request.operation, status: 'observed'};
        },
    };
    let nodeVersionChecks = 0;
    const guestAdapter = {
        copyFromGuest: async (/** @type {{ hostPath: import("fs").PathLike | import("fs/promises").FileHandle; }} */ request) => writeFile(request.hostPath, `${JSON.stringify({
            capturedFacts: {after: [], before: []},
            currentObservation: {expectedEntries: [], expectedManagedFiles: [], expectedPathOwnership: [], expectedVersion: '0.1.0', manifest: null},
            operationActual: {exitCode: 0, stderr: '', stdout: 'installer returned without a usable state\n'},
        })}\n`, {flag: 'wx'}),
        copyToGuest: async () => {},
        run: async (/** @type {TestRequest} */ request) => {
            if (request.remoteArguments.at(-1) === '--version') {
                nodeVersionChecks += 1;
                return {exitCode: 0, stderr: '', stdout: 'v24.18.0\n'};
            }
            if (request.remoteArguments.some((/** @type {string} */ argument) => argument.endsWith('release-guest-step.mjs'))) {
                const scenarioId = request.remoteArguments[request.remoteArguments.indexOf('--scenario') + 1];
                const stepId = request.remoteArguments[request.remoteArguments.indexOf('--step') + 1];
                const machineKey = request.machineKey;
                const guestWorkspace = request.remoteArguments[request.remoteArguments.indexOf('--workspace') + 1];
                assert.equal(request.remoteArguments[request.remoteArguments.indexOf('--choices') + 1], '{}');
                const guestPath = (/** @type {string} */ child) => machineKey === 'Windows 11' ? `${guestWorkspace}\\${child}` : `${guestWorkspace}/${child}`;
                if (request.remoteArguments.includes('--prepare-only')) {
                    assert.equal(request.remoteArguments.includes('--scenario-prepared'), false);
                    return {exitCode: 0, stderr: '', stdout: `${JSON.stringify({
                        auditedDirectory: guestPath('home'),
                        homeDirectory: guestPath('home'),
                        scenarioId,
                        sourceDirectory: guestPath('source'),
                        status: 'prepared',
                        targetDirectory: null,
                        workspaceDirectory: guestWorkspace,
                    })}\n`};
                }
                assert.equal(request.remoteArguments[request.remoteArguments.indexOf('--scenario-prepared') + 1], 'true');
                const captured = {
                    auditedDirectory: guestPath('home'),
                    changes: [],
                    machineKey,
                    reviewMaterial: {
                        commandOutcome: {exitCode: 0, stderr: '', stdout: 'installer returned without a usable state\n'},
                        headToIndexDiff: '',
                        indexToWorkingTreeDiff: '',
                        nonRegularEntries: [],
                        status: '',
                        untrackedFiles: [],
                    },
                    scenarioId,
                    status: 'captured',
                    stepId,
                };
                return {exitCode: 0, stderr: '', stdout: `${JSON.stringify(captured)}\n`};
            }
            return {exitCode: 0, stderr: '', stdout: ''};
        },
    };
    const identities = [
        '21212121-2121-4121-8121-212121212121',
        '22222222-2222-4222-8222-222222222222',
        '23232323-2323-4323-8323-232323232323',
        '24242424-2424-4424-8424-242424242424',
    ];
    const result = await startReleaseValidationRun({candidateCommit, configurationPath, workspaceDirectory}, {
        guestAdapter,
        idFactory: () => identities.shift(),
        inspectBundles: async () => inspectedBundles(candidateCommit),
        loadConfiguration: async () => configured,
        machineLifecycleAdapter,
        processAdapter: bundleProcessAdapter(candidateCommit),
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    });
    const pending = JSON.parse(await readFile(result.pendingPath, 'utf8'));
    const pendingResults = await Promise.all(pending.items.map((/** @type {{ resultPath: import("fs").PathLike | import("fs/promises").FileHandle; }} */ item) => readFile(item.resultPath, 'utf8')));
    assert.deepEqual(pending.items.map((/** @type {TestRecord} */ item) => ({scenarioId: item.scenarioId, stepId: item.stepId})), [
        {scenarioId: 'observations/windows/recommended', stepId: '001-install-prior-release'},
        {scenarioId: 'observations/ubuntu/recommended', stepId: '001-install-prior-release'},
        {scenarioId: 'observations/alpine/recommended', stepId: '001-install-prior-release'},
    ], pendingResults.join('\n'));
    assert.deepEqual(result.counts, {diagnostic: 0, formal: 3, unresolved: 112});
    assert.equal(nodeVersionChecks, 3);
});

test('Start keeps bindable guest failures as results but rejects malformed Guest Adapter data without a partial transition', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-guest-failure-');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const candidateCommit = 'a'.repeat(40);
    const configured = configuration();
    configured.maxParallelMachines = 3;
    const transportSecrets = {
        identityFile: '/host-local/private-key',
        password: 'guest-secret',
        vmware: 'vm-secret',
    };
    for (const selectedMachine of Object.values(configured.machines)) {
        selectedMachine.guestPasswords = {test: transportSecrets.password};
        selectedMachine.ssh = {...selectedMachine.ssh, identityFile: transportSecrets.identityFile};
        selectedMachine.vmwareEncryptionPassword = transportSecrets.vmware;
    }
    await writeFile(configurationPath, `${JSON.stringify(configured)}\n`);
    const machineLifecycleAdapter = {
        run: async (/** @type {{ machineKey: string; operation: string; }} */ request) => {
            const machine = configured.machines[request.machineKey];
            if (request.operation === 'read-power-state' || request.operation === 'hard-power-off') {
                return {observation: {powerState: 'powered-off'}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'read-snapshots') {
                return {
                    observation: {currentSnapshot: machine.snapshot, snapshots: [machine.snapshot]},
                    operation: request.operation,
                    status: 'observed',
                };
            }
            if (request.operation === 'revert-snapshot') {
                return {observation: {snapshot: machine.snapshot}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'start-background') {
                return {observation: {powerState: 'running'}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'wait-guest-address') {
                return {observation: {address: '192.0.2.10'}, operation: request.operation, status: 'observed'};
            }
            assert.fail(`Unexpected lifecycle operation: ${request.operation}`);
        },
    };
    const identities = [
        '43434343-4343-4343-8343-434343434343',
        '44444444-4444-4444-8444-444444444444',
        '45454545-4545-4545-8545-454545454545',
        '46464646-4646-4646-8646-464646464646',
        '47474747-4747-4747-8747-474747474747',
        '48484848-4848-4848-8848-484848484848',
        '49494949-4949-4949-8949-494949494949',
    ];
    const result = await startReleaseValidationRun({candidateCommit, configurationPath, workspaceDirectory}, {
        guestAdapter: createReleaseVmwareGuestAdapter({
            createTemporaryDirectory: async () => '/host-local/scenario-preparation',
            fileSystem: {writeFile: async () => {}},
            processAdapter: {
                run: async (/** @type {{arguments: string[], executable: string}} */ request) => {
                    if (request.executable.endsWith('vmrun.exe')) return {exitCode: 0, stderr: '', stdout: '192.0.2.10\n'};
                    if (request.arguments.at(-1)?.includes('--version')) {
                        return {
                            exitCode: 0,
                            stderr: '',
                            stdout: request.arguments.at(-1)?.includes('/opt/node24/bin/node') ? 'v24.0.0\n' : 'v24.18.0\n',
                        };
                    }
                    return {
                        exitCode: 1,
                        stderr: `${transportSecrets.identityFile} ${transportSecrets.password} ${transportSecrets.vmware}`,
                        stdout: transportSecrets.password,
                    };
                },
            },
            removeTemporaryDirectory: async () => {},
        }),
        idFactory: () => identities.shift(),
        inspectBundles: async () => inspectedBundles(candidateCommit),
        loadConfiguration: async () => configured,
        machineLifecycleAdapter,
        processAdapter: bundleProcessAdapter(candidateCommit),
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    });
    const pending = JSON.parse(await readFile(result.pendingPath, 'utf8'));
    assert.equal(pending.items.length, 3);
    for (const item of pending.items) {
        assert.equal(item.stepId, 'scenario-ready');
        const failure = JSON.parse(await readFile(item.resultPath, 'utf8'));
        assert.equal(failure.matchesExpected, false);
        assert.match(failure.summary, /^(?:Release guest workspace preparation failed: \[redacted\](?: \[redacted\]){0,2}|Windows 11 Node.js executable could not be verified\.)$/u);
        for (const secret of Object.values(transportSecrets)) assert.equal(failure.summary.includes(secret), false);
    }
    const state = JSON.parse(await readFile(result.runPath, 'utf8'));
    const unresolved = state.steps.filter((/** @type {{ outcome: string; }} */ step) => step.outcome === 'not-run');
    assert.equal(unresolved.length, state.steps.length);
    assert.equal(unresolved.every((/** @type {{ classification: string; reason: { source: { stepId: string; }; }; }} */ step) => step.classification === 'unresolved'
        && step.reason.source.stepId === 'scenario-ready'), true);

    const malformedWorkspace = join(workspaceDirectory, 'malformed');
    const malformedConfigurationPath = join(malformedWorkspace, 'release-vm-validation.json');
    const malformedRunId = '50505050-5050-4050-8050-505050505050';
    const malformedConfigured = configuration();
    malformedConfigured.maxParallelMachines = 1;
    await mkdir(malformedWorkspace);
    await writeFile(malformedConfigurationPath, `${JSON.stringify(malformedConfigured)}\n`);
    await writeFile(join(malformedWorkspace, 'bundles.json'), `${JSON.stringify({
        bundles: {
            agentAssisted: join(malformedWorkspace, 'agentAssisted.bundle'),
            candidate: join(malformedWorkspace, 'candidate.bundle'),
            plain: join(malformedWorkspace, 'plain.bundle'),
        },
        candidateCommit,
        priorRelease: {commit: 'd'.repeat(40), tag: '0.2.1'},
        targetCommits: {agentAssisted: RELEASE_TARGETS.agentAssisted.commit, plain: RELEASE_TARGETS.plain.commit},
        status: 'prepared',
    })}\n`);
    await Promise.all(['agentAssisted', 'candidate', 'plain']
        .map(name => writeFile(join(malformedWorkspace, `${name}.bundle`), name)));
    const malformedGuestAdapter = {
        copyToGuest: async () => {},
        run: async (/** @type {{ remoteArguments: string[]; machineKey: string; }} */ request) => {
            if (request.remoteArguments.at(-1) === '--version') {
                return {exitCode: 0, stderr: '', stdout: 'v24.18.0\n'};
            }
            if (request.remoteArguments.some((/** @type {string} */ argument) => argument.endsWith('release-guest-step.mjs'))) {
                if (!request.remoteArguments.includes('--prepare-only')) return {stderr: '', stdout: ''};
                const scenarioId = request.remoteArguments[request.remoteArguments.indexOf('--scenario') + 1];
                const guestWorkspace = request.remoteArguments[request.remoteArguments.indexOf('--workspace') + 1];
                const guestPath = (/** @type {string} */ child) => request.machineKey === 'Windows 11'
                    ? `${guestWorkspace}\\${child}`
                    : `${guestWorkspace}/${child}`;
                return {exitCode: 0, stderr: '', stdout: `${JSON.stringify({
                    auditedDirectory: guestPath('home'),
                    homeDirectory: guestPath('home'),
                    scenarioId,
                    sourceDirectory: guestPath('source'),
                    status: 'prepared',
                    targetDirectory: null,
                    workspaceDirectory: guestWorkspace,
                })}\n`};
            }
            return {exitCode: 0, stderr: '', stdout: ''};
        },
    };
    await assert.rejects(startReleaseValidationRun({
        candidateCommit,
        configurationPath: malformedConfigurationPath,
        workspaceDirectory: malformedWorkspace,
    }, {
        guestAdapter: malformedGuestAdapter,
        idFactory: () => malformedRunId,
        inspectBundles: async () => inspectedBundles(candidateCommit),
        loadConfiguration: async () => malformedConfigured,
        machineLifecycleAdapter,
        processAdapter: bundleProcessAdapter(candidateCommit),
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(malformedWorkspace)),
    }), {
        code: 'adapter-result-invalid',
        message: 'The adapter returned an invalid result.',
        runPath: join(malformedWorkspace, 'runs', malformedRunId, 'run.json'),
        stage: 'adapter-result',
    });
    const malformedState = JSON.parse(await readFile(join(malformedWorkspace, 'runs', malformedRunId, 'run.json'), 'utf8'));
    assert.deepEqual(malformedState.inFlight, []);
    assert.deepEqual(malformedState.handoffs, []);
    assert.equal(malformedState.steps.every((/** @type {{ state: string; classification: null; evidencePath: null; outcome: null; reason: null; }} */ step) => step.state === 'pending'
        && step.classification === null
        && step.evidencePath === null
        && step.outcome === null
        && step.reason === null), true);

    const persistenceWorkspace = join(workspaceDirectory, 'persistence');
    const persistenceRunId = '51515151-5151-4151-8151-515151515151';
    await mkdir(persistenceWorkspace);
    await writeFile(join(persistenceWorkspace, 'bundles.json'), `${JSON.stringify({
        bundles: {
            agentAssisted: join(persistenceWorkspace, 'agentAssisted.bundle'),
            candidate: join(persistenceWorkspace, 'candidate.bundle'),
            plain: join(persistenceWorkspace, 'plain.bundle'),
        },
        candidateCommit,
        priorRelease: {commit: 'd'.repeat(40), tag: '0.2.1'},
        targetCommits: {agentAssisted: RELEASE_TARGETS.agentAssisted.commit, plain: RELEASE_TARGETS.plain.commit},
        status: 'prepared',
    })}\n`);
    await Promise.all(['agentAssisted', 'candidate', 'plain']
        .map(name => writeFile(join(persistenceWorkspace, `${name}.bundle`), name)));
    const persistenceResultPath = join(
        persistenceWorkspace,
        'runs',
        persistenceRunId,
        'scenario-ready',
        'observations',
        'ubuntu',
        'recommended',
        'scenario-ready.json',
    );
    const persistenceGuestAdapter = {
        copyToGuest: async () => {},
        run: async (/** @type {{ remoteArguments: string[]; }} */ request) => {
            if (request.remoteArguments.at(-1) === '--version') return {exitCode: 0, stderr: '', stdout: 'v24.18.0\n'};
            if (request.remoteArguments.some((/** @type {string} */ argument) => argument.endsWith('release-guest-step.mjs'))) {
                const scenarioId = request.remoteArguments[request.remoteArguments.indexOf('--scenario') + 1];
                const guestWorkspace = request.remoteArguments[request.remoteArguments.indexOf('--workspace') + 1];
                return {exitCode: 0, stderr: '', stdout: `${JSON.stringify({
                    auditedDirectory: `${guestWorkspace}/home`,
                    homeDirectory: `${guestWorkspace}/home`,
                    scenarioId,
                    sourceDirectory: `${guestWorkspace}/source`,
                    status: 'prepared',
                    targetDirectory: null,
                    workspaceDirectory: guestWorkspace,
                })}\n`};
            }
            return {exitCode: 0, stderr: '', stdout: ''};
        },
    };
    const persistenceFileSystem = {
        lstat,
        mkdir,
        readFile,
        rm,
        writeFile: async (/** @type {import("fs").PathLike | import("fs/promises").FileHandle} */ path, /** @type {string | NodeJS.ArrayBufferView<ArrayBufferLike> | Iterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>> | AsyncIterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>>} */ bytes, /** @type {string | (import("fs").ObjectEncodingOptions & { mode?: import("fs").Mode | undefined; flag?: import("fs").OpenMode | undefined; flush?: boolean | undefined; } & import("events").Abortable) | null | undefined} */ options) => {
            if (path !== persistenceResultPath) return writeFile(path, bytes, options);
            await writeFile(path, 'partial evidence\n', options);
            throw Object.assign(new Error('Injected evidence write failure.'), {code: 'EIO'});
        },
    };
    await assert.rejects(runReleaseVmGuestStep({
        configuration: {machines: {Ubuntu: configured.machines.Ubuntu}},
        machineKey: 'Ubuntu',
        scenarioId: 'observations/ubuntu/recommended',
        stepId: '001-install-prior-release',
        workspaceDirectory: persistenceWorkspace,
    }, {
        fileSystem: persistenceFileSystem,
        guestAdapter: persistenceGuestAdapter,
        plannedChoices: {},
        prepareOnly: true,
        processAdapter: bundleProcessAdapter(candidateCommit),
        runId: persistenceRunId,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(persistenceWorkspace)),
    }), {
        code: 'persistence-failed',
        message: 'The run state could not be committed.',
        runPath: join(persistenceWorkspace, 'runs', persistenceRunId, 'run.json'),
        stage: 'state-write',
    });
    await assert.rejects(lstat(persistenceResultPath), {code: 'ENOENT'});

    let missingRemovalWrite = false;
    await assert.rejects(runReleaseVmGuestStep({
        configuration: {machines: {Ubuntu: configured.machines.Ubuntu}},
        machineKey: 'Ubuntu',
        scenarioId: 'observations/ubuntu/recommended',
        stepId: '001-install-prior-release',
        workspaceDirectory: persistenceWorkspace,
    }, {
        fileSystem: {
            lstat,
            mkdir,
            readFile,
            writeFile: async (/** @type {string} */ path, /** @type {unknown} */ bytes, /** @type {unknown} */ options) => {
                if (path === persistenceResultPath) missingRemovalWrite = true;
                return writeFile(path, bytes, options);
            },
        },
        guestAdapter: persistenceGuestAdapter,
        plannedChoices: {},
        prepareOnly: true,
        processAdapter: bundleProcessAdapter(candidateCommit),
        runId: persistenceRunId,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(persistenceWorkspace)),
    }), {
        code: 'persistence-failed',
        message: 'The run state could not be committed.',
        runPath: join(persistenceWorkspace, 'runs', persistenceRunId, 'run.json'),
        stage: 'state-write',
    });
    assert.equal(missingRemovalWrite, false);

    const failedRemovalFileSystem = {
        lstat,
        mkdir,
        readFile,
        rm: async (/** @type {import("fs").PathLike} */ path) => {
            if (path === persistenceResultPath) {
                throw Object.assign(new Error('Injected evidence cleanup failure.'), {code: 'EACCES'});
            }
            return rm(path, {force: true});
        },
        writeFile: async (/** @type {import("fs").PathLike | import("fs/promises").FileHandle} */ path, /** @type {string | NodeJS.ArrayBufferView<ArrayBufferLike> | Iterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>> | AsyncIterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>>} */ bytes, /** @type {string | (import("fs").ObjectEncodingOptions & { mode?: import("fs").Mode | undefined; flag?: import("fs").OpenMode | undefined; flush?: boolean | undefined; } & import("events").Abortable) | null | undefined} */ options) => {
            if (path !== persistenceResultPath) return writeFile(path, bytes, options);
            await writeFile(path, 'partial evidence\n', options);
            throw Object.assign(new Error('Injected evidence write failure.'), {code: 'EIO'});
        },
    };
    await assert.rejects(runReleaseVmGuestStep({
        configuration: {machines: {Ubuntu: configured.machines.Ubuntu}},
        machineKey: 'Ubuntu',
        scenarioId: 'observations/ubuntu/recommended',
        stepId: '001-install-prior-release',
        workspaceDirectory: persistenceWorkspace,
    }, {
        fileSystem: failedRemovalFileSystem,
        guestAdapter: persistenceGuestAdapter,
        plannedChoices: {},
        prepareOnly: true,
        processAdapter: bundleProcessAdapter(candidateCommit),
        runId: persistenceRunId,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(persistenceWorkspace)),
    }), {
        code: 'persistence-failed',
        message: 'The run state could not be committed.',
        runPath: join(persistenceWorkspace, 'runs', persistenceRunId, 'run.json'),
        stage: 'state-write',
    });
    assert.equal(await readFile(persistenceResultPath, 'utf8'), 'partial evidence\n');
    await rm(persistenceResultPath, {force: true});

    const readinessWorkspace = join(workspaceDirectory, 'readiness-persistence');
    const readinessRunId = '52525252-5252-4252-8252-525252525252';
    const readinessConfigured = configuration();
    readinessConfigured.maxParallelMachines = 1;
    const readinessConfigurationPath = join(readinessWorkspace, 'release-vm-validation.json');
    await mkdir(readinessWorkspace);
    await writeFile(readinessConfigurationPath, `${JSON.stringify(readinessConfigured)}\n`);
    await writeFile(join(readinessWorkspace, 'bundles.json'), `${JSON.stringify({
        bundles: {
            agentAssisted: join(readinessWorkspace, 'agentAssisted.bundle'),
            candidate: join(readinessWorkspace, 'candidate.bundle'),
            plain: join(readinessWorkspace, 'plain.bundle'),
        },
        candidateCommit,
        priorRelease: {commit: 'd'.repeat(40), tag: '0.2.1'},
        targetCommits: {agentAssisted: RELEASE_TARGETS.agentAssisted.commit, plain: RELEASE_TARGETS.plain.commit},
        status: 'prepared',
    })}\n`);
    await Promise.all(['agentAssisted', 'candidate', 'plain']
        .map(name => writeFile(join(readinessWorkspace, `${name}.bundle`), name)));
    const readinessScenario = createReleaseValidationScenarioPlan({
        bundleFacts: inspectedBundles(candidateCommit),
        candidateCommit,
    }).scenarios[0];
    const readinessPath = join(
        readinessWorkspace,
        'runs',
        readinessRunId,
        'scenario-facts',
        ...readinessScenario.archiveKind.split('/'),
        'scenario-ready.json',
    );
    const readinessGuestAdapter = {
        copyToGuest: async () => {},
        run: async (/** @type {{ remoteArguments: string[]; machineKey: string; }} */ request) => {
            if (request.remoteArguments.at(-1) === '--version') return {exitCode: 0, stderr: '', stdout: 'v24.18.0\n'};
            if (request.remoteArguments.some((/** @type {string} */ argument) => argument.endsWith('release-guest-step.mjs'))) {
                const scenarioId = request.remoteArguments[request.remoteArguments.indexOf('--scenario') + 1];
                const guestWorkspace = request.remoteArguments[request.remoteArguments.indexOf('--workspace') + 1];
                const guestPath = (/** @type {string} */ child) => request.machineKey === 'Windows 11'
                    ? `${guestWorkspace}\\${child}`
                    : `${guestWorkspace}/${child}`;
                return {exitCode: 0, stderr: '', stdout: `${JSON.stringify({
                    auditedDirectory: guestPath('home'),
                    homeDirectory: guestPath('home'),
                    scenarioId,
                    sourceDirectory: guestPath('source'),
                    status: 'prepared',
                    targetDirectory: null,
                    workspaceDirectory: guestWorkspace,
                })}\n`};
            }
            return {exitCode: 0, stderr: '', stdout: ''};
        },
    };
    const readinessFileSystem = {
        lstat,
        mkdir,
        readFile,
        rename,
        rm,
        writeFile: async (/** @type {import("fs").PathLike | import("fs/promises").FileHandle} */ path, /** @type {string | NodeJS.ArrayBufferView<ArrayBufferLike> | Iterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>> | AsyncIterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>>} */ bytes, /** @type {string | (import("fs").ObjectEncodingOptions & { mode?: import("fs").Mode | undefined; flag?: import("fs").OpenMode | undefined; flush?: boolean | undefined; } & import("events").Abortable) | null | undefined} */ options) => {
            if (path !== readinessPath) return writeFile(path, bytes, options);
            await writeFile(path, 'partial readiness evidence\n', options);
            throw Object.assign(new Error('Injected readiness evidence failure.'), {code: 'EIO'});
        },
    };
    await assert.rejects(startReleaseValidationRun({
        candidateCommit,
        configurationPath: readinessConfigurationPath,
        workspaceDirectory: readinessWorkspace,
    }, {
        fileSystem: readinessFileSystem,
        guestAdapter: readinessGuestAdapter,
        idFactory: () => readinessRunId,
        inspectBundles: async () => inspectedBundles(candidateCommit),
        loadConfiguration: async () => readinessConfigured,
        machineLifecycleAdapter,
        processAdapter: bundleProcessAdapter(candidateCommit),
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(readinessWorkspace)),
    }), {
        code: 'persistence-failed',
        message: 'The run state could not be committed.',
        runPath: join(readinessWorkspace, 'runs', readinessRunId, 'run.json'),
        stage: 'state-write',
    });
    await assert.rejects(lstat(readinessPath), {code: 'ENOENT'});
    const readinessState = JSON.parse(await readFile(join(readinessWorkspace, 'runs', readinessRunId, 'run.json'), 'utf8'));
    assert.deepEqual(readinessState.inFlight.map((/** @type {TestRecord} */ record) => ({operation: record.operation, scenarioId: record.scenarioId})), [{
        operation: 'run-guest',
        scenarioId: readinessScenario.archiveKind,
    }]);
    assert.deepEqual(readinessState.handoffs, []);
});

test('Resume saves a failed scenario readiness compensation check and issues a fresh authorization', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-compensation-check-');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const candidateCommit = 'a'.repeat(40);
    const runId = '13131313-1313-4313-8313-131313131313';
    const initialHandoffId = '14141414-1414-4414-8414-141414141414';
    const retryHandoffId = '15151515-1515-4515-8515-151515151515';
    const retryResultId = '94949494-9494-4494-8494-949494949494';
    const configured = configuration();
    configured.maxParallelMachines = 1;
    await writeFile(configurationPath, `${JSON.stringify(configured)}\n`);
    const calls = testRecords();
    let poweredOff = false;
    const machineLifecycleAdapter = {
        run: async (/** @type {TestRequest} */ request) => {
            calls.push({machineKey: request.machineKey, operation: request.operation});
            if (request.operation === 'hard-power-off') {
                poweredOff = true;
                return {observation: {powerState: 'powered-off'}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'read-snapshots') {
                return {
                    observation: {
                        currentSnapshot: 'baseline',
                        snapshots: ['baseline'],
                    },
                    operation: request.operation,
                    status: 'observed',
                };
            }
            if (request.operation === 'read-power-state') {
                return {
                    observation: {powerState: poweredOff ? 'powered-off' : 'running'},
                    operation: request.operation,
                    status: 'observed',
                };
            }
            if (request.operation === 'wait-guest-address') {
                return {observation: {address: '192.0.2.10'}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'revert-snapshot') {
                return {observation: {snapshot: 'baseline'}, operation: request.operation, status: 'observed'};
            }
            assert.fail(`Unexpected lifecycle operation: ${request.operation}`);
        },
    };
    const guestCalls = testRecords();
    let returnMalformedGuestResult = true;
    const guestAdapter = {run: async (/** @type {TestRequest} */ request) => {
        guestCalls.push(request);
        if (returnMalformedGuestResult) return {stderr: '', stdout: ''};
        throw new Error('Guest transport unavailable.');
    }};
    const runDirectory = join(workspaceDirectory, 'runs', runId);
    const runPath = join(runDirectory, 'run.json');
    const plan = createReleaseValidationScenarioPlan({bundleFacts: inspectedBundles(candidateCommit), candidateCommit});
    const scenarioId = 'observations/windows/recommended';
    const initialResultPath = join(runDirectory, 'results', `${initialHandoffId}.json`);
    const handoff = {
        decision: null,
        factsDigest: null,
        handoffId: initialHandoffId,
        kind: 'compensation',
        responsePath: null,
        resultPath: initialResultPath,
        scenarioId,
        state: 'pending',
        stepId: 'scenario-ready',
        summary: null,
    };
    const state = pendingRunState({configurationPath, handoffs: [handoff], plan, runId});
    state.maxParallelMachines = 1;
    state.steps = state.steps.map((/** @type {{ scenarioId: string; }} */ step) => step.scenarioId.startsWith('observations/windows/')
        || step.scenarioId.startsWith('scenarios/windows/')
        ? {
            ...step,
            classification: 'unresolved',
            outcome: 'not-run',
            reason: {
                code: 'unavailable-machine',
                message: 'The release validation machine setup did not complete.',
                source: {scenarioId, stepId: 'scenario-ready'},
            },
            state: 'terminal',
        }
        : {...step, classification: 'formal', outcome: 'passed', state: 'terminal'});
    state.cleanup = state.cleanup.map((/** @type {{ scenarioId: string; }} */ record) => record.scenarioId === scenarioId
        ? {...record, outcome: 'passed', stage: 'failure-hold'}
        : {...record, outcome: 'passed', stage: 'final'});
    await mkdir(join(runDirectory, 'results'), {recursive: true});
    await writeFile(runPath, `${JSON.stringify(state)}\n`);
    await writeFile(initialResultPath, `${JSON.stringify({
        code: 'observation-failed',
        message: 'The initial power state could not be observed.',
        operation: 'read-power-state',
        status: 'failed',
    })}\n`);
    const response = {
        decision: 'applied',
        handoffId: initialHandoffId,
        kind: 'compensation',
        runId,
        scenarioId,
        schemaVersion: 1,
        stepId: 'scenario-ready',
    };
    const responsePath = join(runDirectory, 'responses', `${initialHandoffId}.json`);
    await mkdir(dirname(responsePath), {recursive: true});
    await writeFile(responsePath, `${JSON.stringify(response)}\n`);

    await assert.rejects(resumeReleaseValidationRun({responsePath, runPath}, {
        guestAdapter,
        idFactory: () => assert.fail('Malformed Adapter data must not create a compensation identity.'),
        loadConfiguration: async () => configured,
        machineLifecycleAdapter,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    }), {
        code: 'adapter-result-invalid',
        message: 'The adapter returned an invalid result.',
        runPath,
        stage: 'adapter-result',
    });
    assert.equal(JSON.parse(await readFile(runPath, 'utf8')).inFlight.length, 1);
    returnMalformedGuestResult = false;
    const identities = [retryResultId, retryHandoffId];
    const resumed = await resumeReleaseValidationRun({responsePath: null, runPath}, {
        guestAdapter,
        idFactory: () => identities.shift(),
        loadConfiguration: async () => configured,
        machineLifecycleAdapter,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    });
    assert.notEqual(resumed.pendingPath, null, JSON.stringify(resumed));
    const pending = JSON.parse(await readFile(resumed.pendingPath, 'utf8'));
    assert.equal(pending.items.length, 1);
    assert.deepEqual(pending.items[0], {
        kind: 'compensation',
        responseTemplatePath: pending.items[0].responseTemplatePath,
        resultPath: pending.items[0].resultPath,
        scenarioId: 'observations/windows/recommended',
        stepId: 'scenario-ready',
    });
    assert.deepEqual(JSON.parse(await readFile(pending.items[0].resultPath, 'utf8')), {
        evaluation: 'full',
        matchesExpected: false,
        observableState: {
            matchesExpected: false,
            summary: 'The guest release validation step could not be captured: Guest transport unavailable.',
        },
        operationEvidence: {
            matchesExpected: false,
            summary: 'The guest release validation step could not be captured: Guest transport unavailable.',
        },
        scenarioId: 'observations/windows/recommended',
        status: 'evaluated',
        summary: 'The guest release validation step could not be captured: Guest transport unavailable.',
    });
    assert.deepEqual(JSON.parse(await readFile(pending.items[0].responseTemplatePath, 'utf8')), {
        decision: null,
        handoffId: retryHandoffId,
        kind: 'compensation',
        runId,
        scenarioId: 'observations/windows/recommended',
        schemaVersion: 1,
        stepId: 'scenario-ready',
    });
    const committed = JSON.parse(await readFile(runPath, 'utf8'));
    assert.deepEqual(committed.handoffs.map((/** @type {TestRecord} */ handoff) => ({
        decision: handoff.decision,
        handoffId: handoff.handoffId,
        state: handoff.state,
    })), [
        {decision: 'applied', handoffId: initialHandoffId, state: 'consumed'},
        {decision: null, handoffId: retryHandoffId, state: 'pending'},
    ]);
    assert.deepEqual(committed.inFlight, []);
    assert.deepEqual(calls.filter(call => call.machineKey === 'Windows 11').slice(-5), [
        {machineKey: 'Windows 11', operation: 'read-snapshots'},
        {machineKey: 'Windows 11', operation: 'read-power-state'},
        {machineKey: 'Windows 11', operation: 'wait-guest-address'},
        {machineKey: 'Windows 11', operation: 'hard-power-off'},
        {machineKey: 'Windows 11', operation: 'read-power-state'},
    ]);
    assert.equal(guestCalls.length, 2);
    assert.equal(requireValue(guestCalls[0], 'Expected guest call.').remoteArguments?.[1], '-e');
    await assert.rejects(resumeReleaseValidationRun({responsePath, runPath}, {
        idFactory: () => assert.fail('A duplicate response must not create another identity.'),
        loadConfiguration: async () => configured,
        machineLifecycleAdapter,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    }), {
        code: 'response-invalid',
        message: 'The response does not match a pending handoff.',
        runPath,
        stage: 'response',
    });
    const retryResponsePath = join(runDirectory, 'responses', `${retryHandoffId}.json`);
    await writeFile(retryResponsePath, `${JSON.stringify({
        decision: 'declined',
        handoffId: retryHandoffId,
        kind: 'compensation',
        runId,
        scenarioId,
        schemaVersion: 1,
        stepId: 'scenario-ready',
    })}\n`);
    const declined = await resumeReleaseValidationRun({responsePath: retryResponsePath, runPath}, {
        loadConfiguration: async () => configured,
        machineLifecycleAdapter,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    });
    assert.equal(declined.pendingPath, null);
    const afterDecline = JSON.parse(await readFile(runPath, 'utf8'));
    assert.deepEqual(afterDecline.inFlight, []);
    assert.deepEqual(afterDecline.handoffs.map((/** @type {TestRecord} */ handoff) => handoff.decision), ['applied', 'declined']);
});

test('Resume consumes a declined scenario readiness compensation and performs final cleanup', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-compensation-declined-');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const candidateCommit = 'a'.repeat(40);
    const runId = '32323232-3232-4232-8232-323232323232';
    const handoffId = '33333333-3333-4333-8333-333333333333';
    const configured = configuration();
    configured.maxParallelMachines = 1;
    await writeFile(configurationPath, `${JSON.stringify(configured)}\n`);
    const runDirectory = join(workspaceDirectory, 'runs', runId);
    const runPath = join(runDirectory, 'run.json');
    const scenarioId = 'observations/windows/recommended';
    const plan = createReleaseValidationScenarioPlan({bundleFacts: inspectedBundles(candidateCommit), candidateCommit});
    const handoff = {
        decision: null,
        factsDigest: null,
        handoffId,
        kind: 'compensation',
        responsePath: null,
        resultPath: join(runDirectory, 'results', `${handoffId}.json`),
        scenarioId,
        state: 'pending',
        stepId: 'scenario-ready',
        summary: null,
    };
    const state = pendingRunState({configurationPath, handoffs: [handoff], plan, runId});
    state.maxParallelMachines = 1;
    state.steps = state.steps.map((/** @type {{ scenarioId: string; }} */ step) => step.scenarioId.startsWith('observations/windows/')
        || step.scenarioId.startsWith('scenarios/windows/')
        ? {
            ...step,
            classification: 'unresolved',
            outcome: 'not-run',
            reason: {
                code: 'unavailable-machine',
                message: 'The release validation machine setup did not complete.',
                source: {scenarioId, stepId: 'scenario-ready'},
            },
            state: 'terminal',
        }
        : {...step, classification: 'formal', outcome: 'passed', state: 'terminal'});
    state.cleanup = state.cleanup.map((/** @type {TestRecord} */ record) => ({...record, outcome: 'passed', stage: 'final'}));
    await mkdir(join(runDirectory, 'results'), {recursive: true});
    await writeFile(runPath, `${JSON.stringify(state)}\n`);
    await writeFile(handoff.resultPath, '{}\n');
    const responsePath = join(runDirectory, 'responses', `${handoffId}.json`);
    await mkdir(dirname(responsePath), {recursive: true});
    await writeFile(responsePath, `${JSON.stringify({
        decision: 'declined',
        handoffId,
        kind: 'compensation',
        runId,
        scenarioId,
        schemaVersion: 1,
        stepId: 'scenario-ready',
    })}\n`);

    const operations = stringList();
    const machineLifecycleAdapter = {
        run: async (/** @type {{ operation: string; machineKey: string; }} */ request) => {
            operations.push(request.operation);
            const selectedMachine = configured.machines[request.machineKey];
            if (request.operation === 'hard-power-off' || request.operation === 'read-power-state') {
                return {observation: {powerState: 'powered-off'}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'revert-snapshot') {
                return {observation: {snapshot: selectedMachine.snapshot}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'read-snapshots') {
                return {
                    observation: {currentSnapshot: selectedMachine.snapshot, snapshots: [selectedMachine.snapshot]},
                    operation: request.operation,
                    status: 'observed',
                };
            }
            assert.fail(`Unexpected lifecycle operation: ${request.operation}`);
        },
    };
    const resumed = await resumeReleaseValidationRun({responsePath, runPath}, {
        loadConfiguration: async () => configured,
        machineLifecycleAdapter,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    });
    assert.equal(resumed.pendingPath, null);
    const committed = JSON.parse(await readFile(runPath, 'utf8'));
    assert.deepEqual(committed.handoffs, [{
        ...handoff,
        decision: 'declined',
        responsePath,
        state: 'consumed',
    }]);
    assert.deepEqual(operations, [
        'hard-power-off',
        'revert-snapshot',
        'read-power-state',
        'read-snapshots',
    ]);
});

test('Resume writes the closed complete result after every record is terminal', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-complete-result-');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const candidateCommit = 'a'.repeat(40);
    const runId = '34343434-3434-4434-8434-343434343434';
    const configured = configuration();
    const plan = createReleaseValidationScenarioPlan({bundleFacts: inspectedBundles(candidateCommit), candidateCommit});
    const firstScenarioId = plan.scenarios[0].archiveKind;
    const state = pendingRunState({configurationPath, handoffs: [], plan, runId});
    state.steps = state.steps.map((/** @type {TestRecord} */ step) => ({
        ...step,
        classification: 'unresolved',
        outcome: 'not-run',
        reason: {
            code: 'unavailable-machine',
            message: 'The release validation machine setup did not complete.',
            source: {scenarioId: firstScenarioId, stepId: 'scenario-ready'},
        },
        state: 'terminal',
    }));
    state.cleanup = state.cleanup.map((/** @type {TestRecord} */ record) => ({...record, outcome: 'passed', stage: 'final'}));
    const runDirectory = join(workspaceDirectory, 'runs', runId);
    const runPath = join(runDirectory, 'run.json');
    await mkdir(runDirectory, {recursive: true});
    await writeFile(runPath, `${JSON.stringify(state)}\n`);
    await writeFile(configurationPath, `${JSON.stringify(configured)}\n`);

    const resultPath = join(runDirectory, 'result.json');
    const partialResultFileSystem = {
        lstat,
        mkdir,
        readFile,
        rename,
        rm,
        writeFile: async (/** @type {string} */ path, /** @type {unknown} */ bytes, /** @type {unknown} */ options) => {
            if (path === resultPath) {
                await writeFile(path, 'partial complete result\n', options);
                throw Object.assign(new Error('injected complete result write failure'), {code: 'EIO'});
            }
            return writeFile(path, bytes, options);
        },
    };
    await assert.rejects(resumeReleaseValidationRun({responsePath: null, runPath}, {
        fileSystem: partialResultFileSystem,
        loadConfiguration: async () => configured,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    }), {
        code: 'persistence-failed',
        message: 'The run state could not be committed.',
        runPath,
        stage: 'state-write',
    });
    await assert.rejects(lstat(resultPath), {code: 'ENOENT'});
    assert.equal(JSON.parse(await readFile(runPath, 'utf8')).status, 'completing');

    const resumed = await resumeReleaseValidationRun({responsePath: null, runPath}, {
        loadConfiguration: async () => configured,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    });
    assert.deepEqual(resumed.counts, {diagnostic: 0, formal: 0, unresolved: state.steps.length});
    assert.equal(resumed.pendingPath, null);
    assert.equal(resumed.resultPath, resultPath);
    assert.equal(resumed.status, 'completed');
    const complete = JSON.parse(await readFile(resumed.resultPath, 'utf8'));
    assert.deepEqual(Object.keys(complete), [
        'archives',
        'candidateCommit',
        'classifications',
        'cleanup',
        'registryDigest',
        'runId',
        'runPath',
        'scenarios',
        'schemaVersion',
        'status',
    ]);
    assert.equal(complete.status, 'completed');
    assert.equal(complete.scenarios.length, plan.scenarios.length);
    assert.deepEqual(complete.classifications.formal, []);
    assert.deepEqual(complete.classifications.diagnostic, []);
    assert.equal(complete.classifications.unresolved.length, state.steps.length);
    assert.ok(complete.scenarios.every((/** @type {{ archive: null; archiveReason: { code: string; }; }} */ scenario) => scenario.archive === null
        && scenario.archiveReason.code === 'ineligible-unresolved'));
});

test('Resume reconciles a pending archive before writing the complete result', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-archive-reconcile-');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const candidateCommit = 'a'.repeat(40);
    const runId = '35353535-3535-4535-8535-353535353535';
    const configured = configuration();
    const plan = createReleaseValidationScenarioPlan({bundleFacts: inspectedBundles(candidateCommit), candidateCommit});
    const runDirectory = join(workspaceDirectory, 'runs', runId);
    const eligibleScenarioId = plan.scenarios[0].archiveKind;
    const blockedScenarioId = plan.scenarios[1].archiveKind;
    const state = pendingRunState({configurationPath, handoffs: [], plan, runId});
    state.steps = state.steps.map((/** @type {TestRecord} */ step) => step.scenarioId === eligibleScenarioId
        ? {...step, classification: 'formal', outcome: 'passed', state: 'terminal'}
        : {
            ...step,
            classification: 'unresolved',
            outcome: 'not-run',
            reason: {
                code: 'dependency-failed',
                message: 'A required release validation dependency did not pass.',
                source: {scenarioId: blockedScenarioId, stepId: plan.scenarios[1].steps[0].stepId},
            },
            state: 'terminal',
        });
    state.cleanup = state.cleanup.map((/** @type {TestRecord} */ record) => ({...record, outcome: 'passed', stage: 'final'}));
    const archivePath = join(runDirectory, 'archives', 'invalid.tar');
    const sourceDirectory = join(runDirectory, 'archive-source', 'eligible');
    state.archives = state.archives.map((/** @type {TestRecord} */ record) => record.archiveKind === eligibleScenarioId
        ? {...record, outputPath: archivePath, reason: null, sourceDirectory, status: 'pending'}
        : record);
    const runPath = join(runDirectory, 'run.json');
    await mkdir(dirname(archivePath), {recursive: true});
    await mkdir(runDirectory, {recursive: true});
    await writeFile(archivePath, 'not a canonical archive');
    await writeFile(runPath, `${JSON.stringify(state)}\n`);
    await writeFile(configurationPath, `${JSON.stringify(configured)}\n`);

    const resumed = await resumeReleaseValidationRun({responsePath: null, runPath}, {
        loadConfiguration: async () => configured,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    });
    assert.equal(resumed.status, 'completed');
    const complete = JSON.parse(await readFile(resumed.resultPath, 'utf8'));
    assert.equal(complete.scenarios[0].archive, null);
    assert.deepEqual(complete.scenarios[0].archiveReason, {
        code: 'verify-failed',
        message: 'The pending release archive does not match its source.',
    });
    const committed = JSON.parse(await readFile(runPath, 'utf8'));
    assert.equal(committed.archives[0].status, 'failed');
});

test('mechanical compensation runs only observable-state capture and creates a fresh authorization on mismatch', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-mechanical-compensation-');
    const runId = '29292929-2929-4929-8929-292929292929';
    const initialId = '30303030-3030-4030-8030-303030303030';
    const retryId = '31313131-3131-4131-8131-313131313131';
    const runDirectory = join(workspaceDirectory, 'runs', runId);
    const runPath = join(runDirectory, 'run.json');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const candidateCommit = 'a'.repeat(40);
    const plan = createReleaseValidationScenarioPlan({bundleFacts: inspectedBundles(candidateCommit), candidateCommit});
    const scenarioId = 'observations/windows/recommended';
    const stepId = '001-install-prior-release';
    const handoff = {
        decision: null,
        factsDigest: null,
        handoffId: initialId,
        kind: 'compensation',
        responsePath: null,
        resultPath: join(runDirectory, 'results', 'original-mechanical-failure.json'),
        scenarioId,
        state: 'pending',
        stepId,
        summary: null,
    };
    const state = pendingRunState({configurationPath, handoffs: [handoff], plan, runId});
    state.steps = state.steps.map((/** @type {{ scenarioId: string; stepId: string; }} */ step) => {
        if (step.scenarioId !== scenarioId) return {...step, classification: 'formal', outcome: 'passed', state: 'terminal'};
        if (step.stepId === stepId) {
            return {
                ...step,
                classification: 'formal',
                outcome: 'failed',
                reason: {code: 'expectation-mismatch', message: 'The installation state did not match.', source: null},
                state: 'terminal',
            };
        }
        return {
            ...step,
            classification: 'unresolved',
            outcome: 'not-run',
            reason: {code: 'dependency-failed', message: 'A required release validation dependency did not pass.', source: {scenarioId, stepId}},
            state: 'terminal',
        };
    });
    await mkdir(join(runDirectory, 'results'), {recursive: true});
    await writeFile(runPath, `${JSON.stringify(state)}\n`);
    await writeFile(configurationPath, `${JSON.stringify(configuration())}\n`);
    await writeFile(handoff.resultPath, '{}\n');
    const responsePath = join(runDirectory, 'responses', `${initialId}.json`);
    await mkdir(dirname(responsePath), {recursive: true});
    await writeFile(responsePath, `${JSON.stringify({
        decision: 'applied',
        handoffId: initialId,
        kind: 'compensation',
        runId,
        scenarioId,
        schemaVersion: 1,
        stepId,
    })}\n`);
    const machineLifecycleAdapter = await prepareCompensationReadiness({
        configured: configuration(),
        runDirectory,
        scenarioId,
        workspaceDirectory,
    });
    let captures = 0;
    const result = await resumeReleaseValidationRun({responsePath, runPath}, {
        captureMechanicalFacts: async (/** @type {{ stepId: unknown; }} */ request) => {
            captures += 1;
            assert.equal(request.stepId, stepId);
            return {
                capturedFacts: {after: [], before: []},
                currentObservation: {expectedEntries: [], expectedManagedFiles: [], expectedPathOwnership: [], expectedVersion: '0.1.0', manifest: null},
                operationActual: null,
            };
        },
        guestAdapter: {run: async () => assert.fail('A failed observable-state check must not run a guest mutation or downstream step.')},
        idFactory: () => retryId,
        loadConfiguration: async () => configuration(),
        machineLifecycleAdapter,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    });
    assert.equal(captures, 1);
    const pending = JSON.parse(await readFile(result.pendingPath, 'utf8'));
    assert.equal(pending.items.length, 1);
    assert.equal(pending.items[0].stepId, stepId);
    assert.deepEqual(JSON.parse(await readFile(pending.items[0].resultPath, 'utf8')), {
        evaluation: 'observable-state',
        files: [],
        matchesExpected: false,
        mechanicalContract: 'installation-transition',
        observableState: {matchesExpected: false, summary: 'The observable state does not match the registered expectation.'},
        operationEvidence: {matchesExpected: null, summary: null},
        status: 'evaluated',
        summary: 'The release mechanical result does not match the registered expectation.',
    });
    const committed = JSON.parse(await readFile(runPath, 'utf8'));
    assert.equal(committed.inFlight.length, 0);
    assert.deepEqual(committed.handoffs.map((/** @type {TestRecord} */ record) => ({decision: record.decision, handoffId: record.handoffId, state: record.state})), [
        {decision: 'applied', handoffId: initialId, state: 'consumed'},
        {decision: null, handoffId: retryId, state: 'pending'},
    ]);
});

test('Resume with null records a bindable mechanical capture failure without replaying the operation', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-mechanical-capture-retry-');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const candidateCommit = 'a'.repeat(40);
    const runId = '39393939-3939-4939-8939-393939393939';
    const compensationId = '40404040-4040-4040-8040-404040404040';
    const failureResultId = '42424242-4242-4242-8242-424242424242';
    const captureId = '41414141-4141-4141-8141-414141414141';
    const configured = configuration();
    const plan = createReleaseValidationScenarioPlan({bundleFacts: inspectedBundles(candidateCommit), candidateCommit});
    const scenarioId = 'observations/windows/recommended';
    const stepId = '001-install-prior-release';
    const runDirectory = join(workspaceDirectory, 'runs', runId);
    const compensation = {
        decision: 'applied',
        factsDigest: null,
        handoffId: compensationId,
        kind: 'compensation',
        responsePath: join(runDirectory, 'responses', `${compensationId}.json`),
        resultPath: join(runDirectory, 'results', 'original-failure.json'),
        scenarioId,
        state: 'consumed',
        stepId,
        summary: null,
    };
    const state = pendingRunState({configurationPath, handoffs: [compensation], plan, runId});
    state.revision = 1;
    state.status = 'running';
    state.inFlight = [{
        machineKey: 'Windows 11',
        operation: 'capture',
        scenarioId,
        startedRevision: 1,
        stepId,
    }];
    state.steps = state.steps.map((/** @type {{ scenarioId: string; stepId: string; }} */ step) => {
        if (step.scenarioId !== scenarioId) return step;
        if (step.stepId === stepId) return {
            ...step,
            classification: 'formal',
            evidencePath: compensation.resultPath,
            handoffId: compensationId,
            outcome: 'failed',
            reason: {code: 'expectation-mismatch', message: 'The installation state did not match.', source: null},
            state: 'terminal',
        };
        return {
            ...step,
            classification: 'unresolved',
            outcome: 'not-run',
            reason: {code: 'dependency-failed', message: 'A required release validation dependency did not pass.', source: {scenarioId, stepId}},
            state: 'terminal',
        };
    });
    const runPath = join(runDirectory, 'run.json');
    await mkdir(runDirectory, {recursive: true});
    await writeFile(runPath, `${JSON.stringify(state)}\n`);
    await writeFile(configurationPath, `${JSON.stringify(configured)}\n`);
    const machineLifecycleAdapter = await prepareCompensationReadiness({
        configured,
        runDirectory,
        scenarioId,
        workspaceDirectory,
    });

    const identities = [failureResultId, captureId];
    const resumed = await resumeReleaseValidationRun({responsePath: null, runPath}, {
        captureMechanicalFacts: async () => { throw new Error('Guest transport unavailable.'); },
        guestAdapter: {run: async () => assert.fail('Capture retry must not replay the original operation.')},
        idFactory: () => identities.shift(),
        loadConfiguration: async () => configured,
        machineLifecycleAdapter,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    });
    const pending = JSON.parse(await readFile(resumed.pendingPath, 'utf8'));
    assert.equal(pending.items.length, 1);
    assert.equal(pending.items[0].stepId, stepId);
    assert.deepEqual(JSON.parse(await readFile(pending.items[0].resultPath, 'utf8')), {
        evaluation: 'full',
        files: [],
        matchesExpected: false,
        mechanicalContract: 'installation-transition',
        observableState: {
            matchesExpected: false,
            summary: 'The guest release validation step could not be captured: Guest transport unavailable.',
        },
        operationEvidence: {
            matchesExpected: false,
            summary: 'The guest release validation step could not be captured: Guest transport unavailable.',
        },
        status: 'evaluated',
        summary: 'The guest release validation step could not be captured: Guest transport unavailable.',
    });
    const committed = JSON.parse(await readFile(runPath, 'utf8'));
    assert.equal(committed.inFlight.length, 0);
    assert.equal(committed.handoffs[0].handoffId, compensationId);
    assert.equal(committed.handoffs[1].handoffId, captureId);
    assert.equal(committed.steps.find((/** @type {{ scenarioId: string; stepId: string; }} */ step) => step.scenarioId === scenarioId && step.stepId === stepId).evidencePath, compensation.resultPath);
});

test('Resume recovers an interrupted guest operation through final machine cleanup', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-interrupted-recovery-');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const candidateCommit = 'a'.repeat(40);
    const runId = '47474747-4747-4747-8747-474747474747';
    const resultId = '48484848-4848-4848-8848-484848484848';
    const configured = configuration();
    const plan = createReleaseValidationScenarioPlan({bundleFacts: inspectedBundles(candidateCommit), candidateCommit});
    const scenario = plan.scenarios.find((/** @type {TestRecord} */ item) => item.archiveKind === 'scenarios/alpine/agent-assisted');
    const stepId = scenario.steps[0].stepId;
    const state = pendingRunState({configurationPath, handoffs: [], plan, runId});
    state.revision = 1;
    state.status = 'running';
    state.inFlight = [{
        machineKey: scenario.machineKey,
        operation: 'capture',
        scenarioId: scenario.archiveKind,
        startedRevision: 1,
        stepId,
    }];
    state.inFlight[0].operation = 'run-guest';
    state.steps = state.steps.map((/** @type {TestRecord} */ step) => {
        if (step.scenarioId === scenario.archiveKind && step.stepId === stepId) return {...step, state: 'in-flight'};
        if (step.scenarioId === scenario.archiveKind) return step;
        return {
            ...step,
            classification: 'unresolved',
            outcome: 'not-run',
            reason: {code: 'dependency-failed', message: 'The test path is closed.', source: {scenarioId: scenario.archiveKind, stepId}},
            state: 'terminal',
        };
    });
    state.cleanup = state.cleanup.map((/** @type {TestRecord} */ record) => record.scenarioId === scenario.archiveKind
        ? record
        : {...record, outcome: 'passed', stage: 'final'});
    const runDirectory = join(workspaceDirectory, 'runs', runId);
    const runPath = join(runDirectory, 'run.json');
    await mkdir(runDirectory, {recursive: true});
    await writeFile(runPath, `${JSON.stringify(state)}\n`);
    await writeFile(configurationPath, `${JSON.stringify(configured)}\n`);
    const machineLifecycleAdapter = {
        run: async (/** @type {{ machineKey: string; operation: string; }} */ request) => {
            const selectedMachine = configured.machines[request.machineKey];
            if (request.operation === 'hard-power-off' || request.operation === 'read-power-state') {
                return {observation: {powerState: 'powered-off'}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'revert-snapshot') {
                return {observation: {snapshot: selectedMachine.snapshot}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'read-snapshots') {
                return {
                    observation: {currentSnapshot: selectedMachine.snapshot, snapshots: [selectedMachine.snapshot]},
                    operation: request.operation,
                    status: 'observed',
                };
            }
            assert.fail(`Unexpected recovery operation: ${request.operation}`);
        },
    };

    await resumeReleaseValidationRun({responsePath: null, runPath}, {
        idFactory: () => resultId,
        loadConfiguration: async () => configured,
        machineLifecycleAdapter,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    });
    const committed = JSON.parse(await readFile(runPath, 'utf8'));
    assert.deepEqual(committed.recovery, [{
        machineKey: scenario.machineKey,
        nextOperation: null,
        outcome: 'passed',
        scenarioId: scenario.archiveKind,
        sourceOperation: 'run-guest',
        stepId,
    }]);
    const interrupted = committed.steps.find((/** @type {TestRecord} */ step) => step.scenarioId === scenario.archiveKind && step.stepId === stepId);
    assert.equal(interrupted.classification, 'formal');
    assert.equal(interrupted.outcome, 'failed');
    assert.equal(interrupted.reason.code, 'interrupted');
    assert.equal(JSON.parse(await readFile(interrupted.evidencePath, 'utf8')).operation, 'run-guest');
    assert.equal(committed.cleanup.find((/** @type {TestRecord} */ record) => record.scenarioId === scenario.archiveKind).stage, 'final');
});

test('Resume turns interrupted scenario preparation into one recoverable compensation handoff', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-interrupted-preparation-');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const candidateCommit = 'a'.repeat(40);
    const runId = '56565656-5656-4565-8565-565656565656';
    const resultId = '57575757-5757-4575-8575-575757575757';
    const handoffId = '58585858-5858-4585-8585-585858585858';
    const configured = configuration();
    const plan = createReleaseValidationScenarioPlan({bundleFacts: inspectedBundles(candidateCommit), candidateCommit});
    const scenario = plan.scenarios.find((/** @type {TestRecord} */ item) => item.archiveKind === 'observations/windows/recommended');
    const state = pendingRunState({configurationPath, handoffs: [], plan, runId});
    state.revision = 1;
    state.status = 'running';
    state.inFlight = [{
        machineKey: scenario.machineKey,
        operation: 'run-guest',
        scenarioId: scenario.archiveKind,
        startedRevision: 1,
        stepId: 'scenario-ready',
    }];
    state.steps = state.steps.map((/** @type {TestRecord} */ step) => step.scenarioId === scenario.archiveKind
        ? step
        : {
            ...step,
            classification: 'unresolved',
            outcome: 'not-run',
            reason: {code: 'dependency-failed', message: 'The test path is closed.', source: {scenarioId: scenario.archiveKind, stepId: 'scenario-ready'}},
            state: 'terminal',
        });
    state.cleanup = state.cleanup.map((/** @type {TestRecord} */ record) => record.scenarioId === scenario.archiveKind
        ? record
        : {...record, outcome: 'passed', stage: 'final'});
    const runDirectory = join(workspaceDirectory, 'runs', runId);
    const runPath = join(runDirectory, 'run.json');
    await mkdir(runDirectory, {recursive: true});
    await writeFile(runPath, `${JSON.stringify(state)}\n`);
    await writeFile(configurationPath, `${JSON.stringify(configured)}\n`);
    const machineLifecycleAdapter = {
        run: async (/** @type {{ machineKey: string; operation: string; }} */ request) => {
            const selectedMachine = configured.machines[request.machineKey];
            if (request.operation === 'hard-power-off' || request.operation === 'read-power-state') {
                return {observation: {powerState: 'powered-off'}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'revert-snapshot') {
                return {observation: {snapshot: selectedMachine.snapshot}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'read-snapshots') {
                return {
                    observation: {currentSnapshot: selectedMachine.snapshot, snapshots: [selectedMachine.snapshot]},
                    operation: request.operation,
                    status: 'observed',
                };
            }
            assert.fail(`Unexpected recovery operation: ${request.operation}`);
        },
    };
    const ids = [resultId, handoffId];

    const resumed = await resumeReleaseValidationRun({responsePath: null, runPath}, {
        idFactory: () => ids.shift(),
        loadConfiguration: async () => configured,
        machineLifecycleAdapter,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    });
    const pending = JSON.parse(await readFile(resumed.pendingPath, 'utf8'));
    assert.deepEqual(pending.items.map((/** @type {TestRecord} */ item) => ({scenarioId: item.scenarioId, stepId: item.stepId})), [{
        scenarioId: scenario.archiveKind,
        stepId: 'scenario-ready',
    }]);
    const committed = JSON.parse(await readFile(runPath, 'utf8'));
    assert.equal(committed.inFlight.length, 0);
    assert.equal(committed.recovery[0].outcome, 'passed');
    assert.equal(committed.handoffs[0].handoffId, handoffId);
    assert.equal(committed.handoffs[0].resultPath, join(runDirectory, 'results', `${resultId}.json`));
    assert.equal(JSON.parse(await readFile(committed.handoffs[0].resultPath, 'utf8')).matchesExpected, false);
});

test('Resume recaptures complete semantic facts after an applied compensation', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-semantic-recapture-');
    const runId = '16161616-1616-4616-8616-161616161616';
    const compensationId = '17171717-1717-4717-8717-171717171717';
    const judgmentId = '18181818-1818-4818-8818-181818181818';
    const runDirectory = join(workspaceDirectory, 'runs', runId);
    const runPath = join(runDirectory, 'run.json');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const candidateCommit = 'a'.repeat(40);
    const plan = createFreshPostInitPlan(candidateCommit);
    const scenarioId = 'scenarios/ubuntu/fresh-agent-assisted';
    const stepId = '003-complete-initialization-issue';
    const compensation = {
        decision: null,
        factsDigest: null,
        handoffId: compensationId,
        kind: 'compensation',
        responsePath: null,
        resultPath: join(runDirectory, 'results', 'original-semantic-failure.json'),
        scenarioId,
        state: 'pending',
        stepId,
        summary: null,
    };
    const state = pendingRunState({configurationPath, handoffs: [compensation], plan, runId});
    state.steps = state.steps.map((/** @type {{ scenarioId: string; stepId: string; }} */ step) => {
        if (step.scenarioId !== scenarioId) return {...step, classification: 'formal', outcome: 'passed', state: 'terminal'};
        const index = Number.parseInt(step.stepId, 10);
        if (index < 3) return {...step, classification: 'formal', outcome: 'passed', state: 'terminal'};
        if (step.stepId === stepId) {
            return {
                ...step,
                classification: 'formal',
                outcome: 'failed',
                reason: {code: 'expectation-mismatch', message: 'The initialization issue did not meet expectations.', source: null},
                state: 'terminal',
            };
        }
        return {
            ...step,
            classification: 'unresolved',
            outcome: 'not-run',
            reason: {code: 'dependency-failed', message: 'A required release validation dependency did not pass.', source: {scenarioId, stepId}},
            state: 'terminal',
        };
    });
    const response = {
        decision: 'applied',
        handoffId: compensationId,
        kind: 'compensation',
        runId,
        scenarioId,
        schemaVersion: 1,
        stepId,
    };
    const responsePath = join(runDirectory, 'responses', `${compensationId}.json`);
    const captured = {
        auditedDirectory: '/tmp/arw-release-validation/scenarios-ubuntu-fresh-agent-assisted/target',
        changes: [],
        machineKey: 'Ubuntu',
        reviewMaterial: {
            headToIndexDiff: '',
            indexToWorkingTreeDiff: '',
            nonRegularEntries: [],
            status: '',
            untrackedFiles: [],
        },
        scenarioId,
        status: 'captured',
        stepId,
    };
    await mkdir(runDirectory, {recursive: true});
    await writeFile(runPath, `${JSON.stringify(state)}\n`);
    await writeFile(configurationPath, `${JSON.stringify(configuration())}\n`);
    await mkdir(dirname(responsePath), {recursive: true});
    await writeFile(responsePath, `${JSON.stringify(response)}\n`);
    const machineLifecycleAdapter = await prepareCompensationReadiness({
        configured: configuration(),
        runDirectory,
        scenarioId,
        workspaceDirectory,
    });

    const interruptedPendingFileSystem = {
        lstat,
        mkdir,
        readFile,
        rename,
        rm,
        writeFile: async (/** @type {string} */ path, /** @type {unknown} */ bytes, /** @type {unknown} */ options) => {
            if (dirname(path) === join(runDirectory, 'pending')) {
                await writeFile(path, 'partial pending manifest\n', options);
                throw Object.assign(new Error('simulated pending manifest write failure'), {code: 'EIO'});
            }
            return writeFile(path, bytes, options);
        },
    };
    await assert.rejects(resumeReleaseValidationRun({responsePath, runPath}, {
        captureSemanticFacts: async (/** @type {unknown} */ request) => {
            assert.deepEqual(request, {
                machine: configuration().machines.Ubuntu,
                machineKey: 'Ubuntu',
                runId,
                scenarioId,
                stepId,
                workspaceDirectory,
            });
            return captured;
        },
        fileSystem: interruptedPendingFileSystem,
        idFactory: () => judgmentId,
        loadConfiguration: async () => configuration(),
        machineLifecycleAdapter,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    }), {
        code: 'persistence-failed',
        message: 'The run state could not be committed.',
        runPath,
        stage: 'state-write',
    });
    const stateAfterPendingFailure = JSON.parse(await readFile(runPath, 'utf8'));
    const failedPendingPath = join(runDirectory, 'pending', `${stateAfterPendingFailure.revision}.json`);
    await assert.rejects(lstat(failedPendingPath), {code: 'ENOENT'});
    const pendingItem = stateAfterPendingFailure.handoffs.find((/** @type {{ state: string; }} */ handoff) => handoff.state === 'pending');
    assert.deepEqual(pendingItem, {
        factsDigest: pendingItem.factsDigest,
        handoffId: judgmentId,
        kind: 'semantic-judgment',
        responsePath: null,
        resultPath: pendingItem.resultPath,
        scenarioId,
        state: 'pending',
        stepId,
        summary: null,
    });
    const judgmentResponsePath = join(runDirectory, 'responses', `${judgmentId}.json`);
    assert.deepEqual(JSON.parse(await readFile(pendingItem.resultPath, 'utf8')), captured);
    const factsDigest = createHash('sha256').update(`${JSON.stringify(captured)}\n`).digest('hex');
    assert.deepEqual(JSON.parse(await readFile(judgmentResponsePath, 'utf8')), {
        factsDigest,
        handoffId: judgmentId,
        judgment: {files: null, matchesExpected: null, summary: null},
        kind: 'semantic-judgment',
        machineKey: 'Ubuntu',
        runId,
        scenarioId,
        schemaVersion: 1,
        stepId,
    });
    const committed = JSON.parse(await readFile(runPath, 'utf8'));
    assert.deepEqual(committed.handoffs[0], {
        ...compensation,
        decision: 'applied',
        responsePath,
        state: 'consumed',
    });
    assert.deepEqual(committed.handoffs[1], {
        factsDigest,
        handoffId: judgmentId,
        kind: 'semantic-judgment',
        responsePath: null,
        resultPath: pendingItem.resultPath,
        scenarioId,
        state: 'pending',
        stepId,
        summary: null,
    });

    const orphanCompensationId = '19191919-1919-4919-8919-191919191919';
    const retryCompensationId = '20202020-2020-4020-8020-202020202020';
    const judgmentResponse = {
        factsDigest,
        handoffId: judgmentId,
        judgment: {
            files: [],
            matchesExpected: false,
            summary: 'The compensated initialization state still does not meet expectations.',
        },
        kind: 'semantic-judgment',
        machineKey: 'Ubuntu',
        runId,
        scenarioId,
        schemaVersion: 1,
        stepId,
    };
    await writeFile(judgmentResponsePath, `${JSON.stringify(judgmentResponse)}\n`);
    const orphanResultPath = join(runDirectory, 'results', `${orphanCompensationId}.json`);
    const orphanTemplatePath = join(runDirectory, 'responses', `${orphanCompensationId}.json`);
    const interruptedFileSystem = {
        lstat,
        mkdir,
        readFile,
        rename,
        rm,
        writeFile: async (/** @type {import("fs").PathLike | import("fs/promises").FileHandle} */ path, /** @type {string | NodeJS.ArrayBufferView<ArrayBufferLike> | Iterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>> | AsyncIterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>>} */ bytes, /** @type {string | (import("fs").ObjectEncodingOptions & { mode?: import("fs").Mode | undefined; flag?: import("fs").OpenMode | undefined; flush?: boolean | undefined; } & import("events").Abortable) | null | undefined} */ options) => {
            if (path === join(runDirectory, 'transitions', `${committed.revision + 1}.json`)) {
                throw new Error('simulated interruption before transition marker creation');
            }
            return writeFile(path, bytes, options);
        },
    };
    await assert.rejects(resumeReleaseValidationRun({responsePath: judgmentResponsePath, runPath}, {
        fileSystem: interruptedFileSystem,
        idFactory: () => orphanCompensationId,
        loadConfiguration: async () => configuration(),
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    }), {
        code: 'persistence-failed',
        message: 'The run state could not be committed.',
        runPath,
        stage: 'state-write',
    });
    assert.deepEqual(JSON.parse(await readFile(runPath, 'utf8')), committed);
    assert.deepEqual(JSON.parse(await readFile(orphanResultPath, 'utf8')), judgmentResponse);
    assert.equal(JSON.parse(await readFile(orphanTemplatePath, 'utf8')).handoffId, orphanCompensationId);

    const retried = await resumeReleaseValidationRun({responsePath: judgmentResponsePath, runPath}, {
        idFactory: () => retryCompensationId,
        loadConfiguration: async () => configuration(),
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    });
    const retryPending = JSON.parse(await readFile(retried.pendingPath, 'utf8'));
    assert.equal(retryPending.items.length, 1);
    assert.deepEqual(retryPending.items[0], {
        kind: 'compensation',
        responseTemplatePath: retryPending.items[0].responseTemplatePath,
        resultPath: retryPending.items[0].resultPath,
        scenarioId,
        stepId,
    });
    assert.deepEqual(JSON.parse(await readFile(retryPending.items[0].resultPath, 'utf8')), judgmentResponse);
    assert.notEqual(retryPending.items[0].resultPath, orphanResultPath);
    assert.notEqual(retryPending.items[0].responseTemplatePath, orphanTemplatePath);
    assert.deepEqual(JSON.parse(await readFile(retryPending.items[0].responseTemplatePath, 'utf8')), {
        decision: null,
        handoffId: retryCompensationId,
        kind: 'compensation',
        runId,
        scenarioId,
        schemaVersion: 1,
        stepId,
    });
    const retryState = JSON.parse(await readFile(runPath, 'utf8'));
    assert.deepEqual(retryState.handoffs[1], {
        ...committed.handoffs[1],
        responsePath: judgmentResponsePath,
        state: 'consumed',
        summary: judgmentResponse.judgment.summary,
    });
    assert.deepEqual(retryState.handoffs[2], {
        decision: null,
        factsDigest: null,
        handoffId: retryCompensationId,
        kind: 'compensation',
        responsePath: null,
        resultPath: retryPending.items[0].resultPath,
        scenarioId,
        state: 'pending',
        stepId,
        summary: null,
    });
    await writeFile(judgmentResponsePath, `${JSON.stringify({
        ...judgmentResponse,
        judgment: {...judgmentResponse.judgment, summary: 'The original response was changed later.'},
    })}\n`);
    assert.deepEqual(JSON.parse(await readFile(retryPending.items[0].resultPath, 'utf8')), judgmentResponse);
    await assert.rejects(resumeReleaseValidationRun({responsePath: judgmentResponsePath, runPath}, {
        idFactory: () => assert.fail('A consumed semantic judgment must not create another identity.'),
        loadConfiguration: async () => configuration(),
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    }), {
        code: 'response-invalid',
        message: 'The response does not match a pending handoff.',
        runPath,
        stage: 'response',
    });
});

test('Resume with null retries a committed semantic capture using a fresh handoff identity', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-semantic-capture-retry-');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const candidateCommit = 'a'.repeat(40);
    const runId = '36363636-3636-4636-8636-363636363636';
    const actionId = '37373737-3737-4737-8737-373737373737';
    const judgmentId = '38383838-3838-4838-8838-383838383838';
    const failureResultId = '92929292-9292-4292-8292-929292929292';
    const compensationId = '93939393-9393-4393-8393-939393939393';
    const configured = configuration();
    const plan = createFreshPostInitPlan(candidateCommit);
    const scenarioId = 'scenarios/ubuntu/fresh-agent-assisted';
    const stepId = '003-complete-initialization-issue';
    const runDirectory = join(workspaceDirectory, 'runs', runId);
    const action = {
        decision: 'completed',
        factsDigest: null,
        handoffId: actionId,
        kind: 'semantic-action',
        responsePath: join(runDirectory, 'responses', `${actionId}.json`),
        resultPath: join(runDirectory, 'results', 'semantic-action.json'),
        scenarioId,
        state: 'consumed',
        stepId,
        summary: 'The initialization issue implementation completed.',
    };
    const state = pendingRunState({configurationPath, handoffs: [action], plan, runId});
    state.revision = 1;
    state.status = 'running';
    state.inFlight = [{
        machineKey: 'Ubuntu',
        operation: 'capture',
        scenarioId,
        startedRevision: 1,
        stepId,
    }];
    state.steps = state.steps.map((/** @type {{ scenarioId: string; stepId: string; }} */ step) => step.scenarioId === scenarioId && step.stepId === stepId
        ? {...step, handoffId: actionId}
        : step);
    const captured = {
        auditedDirectory: `/tmp/arw-release-validation/${runId}/scenarios-ubuntu-fresh-agent-assisted/target`,
        changes: [],
        machineKey: 'Ubuntu',
        reviewMaterial: {
            headToIndexDiff: '',
            indexToWorkingTreeDiff: '',
            nonRegularEntries: [],
            status: '',
            untrackedFiles: [],
        },
        scenarioId,
        status: 'captured',
        stepId,
    };
    const runPath = join(runDirectory, 'run.json');
    await mkdir(runDirectory, {recursive: true});
    await writeFile(runPath, `${JSON.stringify(state)}\n`);
    await writeFile(configurationPath, `${JSON.stringify(configured)}\n`);
    const machineLifecycleAdapter = await prepareCompensationReadiness({
        configured,
        runDirectory,
        scenarioId,
        workspaceDirectory,
    });

    const resumed = await resumeReleaseValidationRun({responsePath: null, runPath}, {
        captureSemanticFacts: async () => captured,
        idFactory: () => judgmentId,
        loadConfiguration: async () => configured,
        machineLifecycleAdapter,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    });
    const pending = JSON.parse(await readFile(resumed.pendingPath, 'utf8'));
    assert.equal(pending.items.length, 1);
    assert.equal(pending.items[0].kind, 'semantic-judgment');
    const committed = JSON.parse(await readFile(runPath, 'utf8'));
    assert.equal(committed.inFlight.length, 0);
    assert.equal(committed.handoffs[1].handoffId, judgmentId);
    assert.equal(Object.hasOwn(committed.handoffs[1], 'decision'), false);
    const responsePath = pending.items[0].responseTemplatePath;
    const response = {
        factsDigest: committed.handoffs[1].factsDigest,
        handoffId: judgmentId,
        judgment: {files: [], matchesExpected: true, summary: 'The initialization result matches the requirement.'},
        kind: 'semantic-judgment',
        machineKey: 'Ubuntu',
        runId,
        scenarioId,
        schemaVersion: 1,
        stepId,
    };
    await writeFile(responsePath, `${JSON.stringify(response)}\n`);
    const finalDirectory = join(runDirectory, 'archive-source', ...scenarioId.split('/'), 'steps', stepId);
    await assert.rejects(resumeReleaseValidationRun({responsePath, runPath}, {
        guestAdapter: {run: async () => ({exitCode: 0})},
        idFactory: () => assert.fail('A malformed baseline result must not create evidence or compensation.'),
        loadConfiguration: async () => configured,
        machineLifecycleAdapter,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    }), {
        code: 'adapter-result-invalid',
        message: 'The adapter returned an invalid result.',
        runPath,
        stage: 'adapter-result',
    });
    assert.deepEqual(JSON.parse(await readFile(runPath, 'utf8')), committed);
    await assert.rejects(lstat(finalDirectory), {code: 'ENOENT'});

    const identities = [failureResultId, compensationId];
    const failed = await resumeReleaseValidationRun({responsePath, runPath}, {
        guestAdapter: {
        run: async (/** @type {TestRequest} */ request) => {
                assert.deepEqual(request.remoteArguments, ['git', '-C', captured.auditedDirectory, 'add', '-A']);
                return {exitCode: 3, stderr: 'index update failed\n', stdout: ''};
            },
        },
        idFactory: () => identities.shift(),
        loadConfiguration: async () => configured,
        machineLifecycleAdapter,
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    });
    const failedPending = JSON.parse(await readFile(failed.pendingPath, 'utf8'));
    assert.deepEqual(failedPending.items.map((/** @type {TestRecord} */ item) => ({kind: item.kind, scenarioId: item.scenarioId, stepId: item.stepId})), [{
        kind: 'compensation',
        scenarioId,
        stepId,
    }]);
    const failedState = JSON.parse(await readFile(runPath, 'utf8'));
    assert.equal(failedState.handoffs.find((/** @type {{ handoffId: string; }} */ handoff) => handoff.handoffId === judgmentId).state, 'consumed');
    const failedStep = failedState.steps.find((/** @type {{ scenarioId: string; stepId: string; }} */ step) => step.scenarioId === scenarioId && step.stepId === stepId);
    assert.equal(failedStep.classification, 'formal');
    assert.equal(failedStep.outcome, 'failed');
    assert.equal(failedStep.reason.code, 'adapter-failed');
    assert.equal(JSON.parse(await readFile(failedStep.evidencePath, 'utf8')).matchesExpected, false);
    await assert.rejects(lstat(finalDirectory), {code: 'ENOENT'});
});

test('a true semantic re-judgment consumes no decision and resumes a diagnostic downstream step', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-semantic-true-');
    const runId = '25252525-2525-4525-8525-252525252525';
    const judgmentId = '26262626-2626-4626-8626-262626262626';
    const compensationId = '27272727-2727-4727-8727-272727272727';
    const runDirectory = join(workspaceDirectory, 'runs', runId);
    const runPath = join(runDirectory, 'run.json');
    const configurationPath = join(workspaceDirectory, 'release-vm-validation.json');
    const candidateCommit = 'a'.repeat(40);
    const configured = configuration();
    const plan = createFreshPostInitPlan(candidateCommit);
    const scenarioId = 'scenarios/ubuntu/fresh-agent-assisted';
    const stepId = '003-complete-initialization-issue';
    const captured = {
        auditedDirectory: '/tmp/arw-release-validation/scenarios-ubuntu-fresh-agent-assisted/target',
        changes: [],
        machineKey: 'Ubuntu',
        reviewMaterial: {
            headToIndexDiff: '',
            indexToWorkingTreeDiff: '',
            nonRegularEntries: [],
            status: '',
            untrackedFiles: [],
        },
        scenarioId,
        status: 'captured',
        stepId,
    };
    const factsDigest = createHash('sha256').update(`${JSON.stringify(captured)}\n`).digest('hex');
    const factsPath = join(runDirectory, 'results', `${judgmentId}.json`);
    const appliedCompensation = {
        decision: 'applied',
        factsDigest: null,
        handoffId: '28282828-2828-4828-8828-282828282828',
        kind: 'compensation',
        responsePath: join(runDirectory, 'responses', '28282828-2828-4828-8828-282828282828.json'),
        resultPath: join(runDirectory, 'results', 'original-semantic-failure.json'),
        scenarioId,
        state: 'consumed',
        stepId,
        summary: null,
    };
    const handoff = {
        factsDigest,
        handoffId: judgmentId,
        kind: 'semantic-judgment',
        responsePath: null,
        resultPath: factsPath,
        scenarioId,
        state: 'pending',
        stepId,
        summary: null,
    };
    const state = pendingRunState({configurationPath, handoffs: [appliedCompensation, handoff], plan, runId});
    state.steps = state.steps.map((/** @type {{ scenarioId: string; stepId: string; }} */ step) => {
        if (step.scenarioId !== scenarioId) return {...step, classification: 'formal', outcome: 'passed', state: 'terminal'};
        const index = Number.parseInt(step.stepId, 10);
        if (index < 3) return {...step, classification: 'formal', outcome: 'passed', state: 'terminal'};
        if (step.stepId === stepId) {
            return {
                ...step,
                classification: 'formal',
                outcome: 'failed',
                reason: {code: 'expectation-mismatch', message: 'The original semantic judgment failed.', source: null},
                state: 'terminal',
            };
        }
        return {
            ...step,
            classification: 'unresolved',
            outcome: 'not-run',
            reason: {code: 'dependency-failed', message: 'A required release validation dependency did not pass.', source: {scenarioId, stepId}},
            state: 'terminal',
        };
    });
    state.cleanup = state.cleanup.map((/** @type {{ scenarioId: string; }} */ record) => record.scenarioId === scenarioId
        ? {...record, outcome: 'passed', stage: 'failure-hold'}
        : {...record, outcome: 'passed', stage: 'final'});
    await mkdir(join(runDirectory, 'results'), {recursive: true});
    await writeFile(runPath, `${JSON.stringify(state)}\n`);
    await writeFile(configurationPath, `${JSON.stringify(configured)}\n`);
    await writeFile(factsPath, `${JSON.stringify(captured)}\n`);
    await writeFile(join(workspaceDirectory, 'bundles.json'), `${JSON.stringify({
        bundles: {
            agentAssisted: join(workspaceDirectory, 'agentAssisted.bundle'),
            candidate: join(workspaceDirectory, 'candidate.bundle'),
            plain: join(workspaceDirectory, 'plain.bundle'),
        },
        candidateCommit,
        priorRelease: {commit: 'd'.repeat(40), tag: '0.2.1'},
        targetCommits: {agentAssisted: RELEASE_TARGETS.agentAssisted.commit, plain: RELEASE_TARGETS.plain.commit},
        status: 'prepared',
    })}\n`);
    await Promise.all(['agentAssisted', 'candidate', 'plain'].map(name => writeFile(join(workspaceDirectory, `${name}.bundle`), name)));
    const guestWorkspace = `/tmp/arw-release-validation/${runId}/scenarios-ubuntu-fresh-agent-assisted`;
    const preparationPath = join(runDirectory, 'scenario-ready', ...scenarioId.split('/'), 'scenario-ready.json');
    await mkdir(dirname(preparationPath), {recursive: true});
    await writeFile(preparationPath, `${JSON.stringify({
        auditedDirectory: `${guestWorkspace}/target`,
        homeDirectory: `${guestWorkspace}/home`,
        nodeVersion: 'v24.18.0',
        scenarioId,
        sourceDirectory: `${guestWorkspace}/source`,
        status: 'prepared',
        targetDirectory: `${guestWorkspace}/target`,
        workspaceDirectory: guestWorkspace,
    })}\n`);
    const readinessPath = join(runDirectory, 'scenario-facts', ...scenarioId.split('/'), 'scenario-ready.json');
    await mkdir(dirname(readinessPath), {recursive: true});
    await writeFile(readinessPath, `${JSON.stringify(scenarioReadinessResult({
        matchesExpected: true,
        scenarioId,
        summary: 'The scenario setup operations and observable state match the registered expectation.',
    }))}\n`);
    const response = {
        factsDigest,
        handoffId: judgmentId,
        judgment: {files: [], matchesExpected: true, summary: 'The compensated semantic state now matches.'},
        kind: 'semantic-judgment',
        machineKey: 'Ubuntu',
        runId,
        scenarioId,
        schemaVersion: 1,
        stepId,
    };
    const responsePath = join(runDirectory, 'responses', `${judgmentId}.json`);
    await mkdir(dirname(responsePath), {recursive: true});
    await writeFile(responsePath, `${JSON.stringify(response)}\n`);
    let mechanicalInputTransfers = 0;
    const guestAdapter = {
        copyFromGuest: async (/** @type {{ hostPath: import("fs").PathLike | import("fs/promises").FileHandle; }} */ request) => {
            mechanicalInputTransfers += 1;
            const profile = {
                codeMaps: {excludes: [], includes: ['src/**/*'], roots: ['src']},
                domainLayout: 'single-context',
                platforms: ['codex'],
            };
            const lock = factEntry('arw-lock.json', serializeWorkflowLock({
                lockSchemaVersion: 2,
                managedTargets: [],
                profile,
                repositoryOwnedSeeds: [],
            }));
            await writeFile(request.hostPath, `${JSON.stringify({
                capturedFacts: {after: [lock], before: [lock]},
                currentObservation: {
                    expectedState: workflowExpectedState([lock]),
                    plan: {
                        diagnostics: [],
                        operation: 'update',
                        operations: [],
                        profile,
                    },
                    verificationOutcome: {exitCode: 1, stderr: 'verification failed\n', stdout: ''},
                },
                operationActual: mechanicalInputTransfers === 1
                    ? {exitCode: 0}
                    : {exitCode: 0, stderr: '', stdout: 'Workflow update completed.\n'},
            })}\n`, {flag: 'wx'});
        },
        run: async (/** @type {{ remoteArguments: string[]; }} */ request) => {
            if (request.remoteArguments.at(-1) === '--version') assert.fail('A prepared scenario must not recheck Node.js.');
            if (request.remoteArguments.some((/** @type {string} */ argument) => argument.endsWith('release-guest-step.mjs'))) {
                const guestWorkspace = request.remoteArguments[request.remoteArguments.indexOf('--workspace') + 1];
                return {exitCode: 0, stderr: '', stdout: `${JSON.stringify({
                    auditedDirectory: `${guestWorkspace}/target`,
                    changes: [],
                    machineKey: 'Ubuntu',
                    reviewMaterial: {
                        commandOutcome: {exitCode: 0, stderr: '', stdout: 'Workflow update completed.\n'},
                        headToIndexDiff: '',
                        indexToWorkingTreeDiff: '',
                        nonRegularEntries: [],
                        status: '',
                        untrackedFiles: [],
                    },
                    scenarioId,
                    status: 'captured',
                    stepId: '004-workflow-update',
                })}\n`};
            }
            return {exitCode: 0, stderr: '', stdout: ''};
        },
    };
    const machineLifecycleAdapter = {
        run: async (/** @type {TestRequest} */ request) => {
            const machine = configured.machines[request.machineKey];
            if (request.operation === 'read-snapshots') {
                return {
                    observation: {currentSnapshot: machine.snapshot, snapshots: [machine.snapshot]},
                    operation: request.operation,
                    status: 'observed',
                };
            }
            if (request.operation === 'revert-snapshot') {
                return {observation: {snapshot: machine.snapshot}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'start-background') {
                return {observation: {powerState: 'running'}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'wait-guest-address') {
                return {observation: {address: '127.0.0.1'}, operation: request.operation, status: 'observed'};
            }
            if (request.operation === 'soft-power-off') {
                return {
                    observation: {powerOffMode: 'soft', powerState: 'powered-off'},
                    operation: request.operation,
                    status: 'observed',
                };
            }
            return {observation: {powerState: 'powered-off'}, operation: request.operation, status: 'observed'};
        },
    };

    const resumeDependencies = {
        guestAdapter,
        idFactory: () => compensationId,
        loadConfiguration: async () => configured,
        machineLifecycleAdapter,
        processAdapter: bundleProcessAdapter(candidateCommit),
        workspaceBoundary: (/** @type {string} */ path) => assert.ok(path.startsWith(workspaceDirectory)),
    };
    await assert.rejects(resumeReleaseValidationRun({responsePath, runPath}, resumeDependencies), {
        code: 'adapter-result-invalid',
        message: 'The adapter returned an invalid result.',
        runPath,
        stage: 'adapter-result',
    });
    const retryStepDirectory = join(runDirectory, 'archive-source', ...scenarioId.split('/'), 'steps', '004-workflow-update');
    for (const name of ['judgment-template.json', 'mechanical-input.json', 'review-material.json']) {
        await assert.rejects(lstat(join(retryStepDirectory, name)), {code: 'ENOENT'});
    }
    const retryState = JSON.parse(await readFile(runPath, 'utf8'));
    assert.equal(retryState.handoffs[1].state, 'consumed');
    assert.equal(retryState.steps.find((/** @type {{ scenarioId: string; stepId: string; }} */ step) => step.scenarioId === scenarioId && step.stepId === '004-workflow-update').state, 'pending');

    const result = await resumeReleaseValidationRun({responsePath: null, runPath}, resumeDependencies);
    assert.equal(mechanicalInputTransfers, 2);
    const pending = JSON.parse(await readFile(result.pendingPath, 'utf8'));
    assert.deepEqual(pending.items.map((/** @type {TestRecord} */ item) => ({kind: item.kind, scenarioId: item.scenarioId, stepId: item.stepId})), [{
        kind: 'compensation',
        scenarioId,
        stepId: '004-workflow-update',
    }]);
    const committed = JSON.parse(await readFile(runPath, 'utf8'));
    assert.equal(Object.hasOwn(committed.handoffs[1], 'decision'), false);
    assert.equal(committed.handoffs[1].state, 'consumed');
    assert.equal(committed.handoffs[1].summary, response.judgment.summary);
    assert.deepEqual(committed.steps.find((/** @type {{ scenarioId: string; stepId: string; }} */ step) => step.scenarioId === scenarioId && step.stepId === stepId), state.steps.find((/** @type {{ scenarioId: string; stepId: string; }} */ step) => step.scenarioId === scenarioId && step.stepId === stepId));
    assert.deepEqual(committed.steps.find((/** @type {{ scenarioId: string; stepId: string; }} */ step) => step.scenarioId === scenarioId && step.stepId === '004-workflow-update'), {
        classification: 'diagnostic',
        evidencePath: committed.steps.find((/** @type {{ scenarioId: string; stepId: string; }} */ step) => step.scenarioId === scenarioId && step.stepId === '004-workflow-update').evidencePath,
        handoffId: compensationId,
        outcome: 'failed',
        reason: {
            code: 'expectation-mismatch',
            message: 'The release mechanical result does not match the registered expectation.',
            source: null,
        },
        scenarioId,
        state: 'terminal',
        stepId: '004-workflow-update',
    });
});

test('bundle inspection proves all three exact object identities before planning', async t => {
    const candidateCommit = 'a'.repeat(40);
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-bundle-inspection-');
    const bundlePaths = {
        agentAssistedBundlePath: join(workspaceDirectory, 'agentAssisted.bundle'),
        candidateBundlePath: join(workspaceDirectory, 'candidate.bundle'),
        plainBundlePath: join(workspaceDirectory, 'plain.bundle'),
    };
    const inspectionFileSystem = {
        lstat: async () => ordinaryFile,
        readFile: async () => JSON.stringify({
            bundles: {agentAssisted: bundlePaths.agentAssistedBundlePath, candidate: bundlePaths.candidateBundlePath, plain: bundlePaths.plainBundlePath},
            candidateCommit,
            priorRelease: {commit: 'd'.repeat(40), tag: '0.2.1'},
            status: 'prepared',
            targetCommits: {agentAssisted: RELEASE_TARGETS.agentAssisted.commit, plain: RELEASE_TARGETS.plain.commit},
        }),
    };
    /** @type {string[]} */
    const boundedPaths = [];
    /** @type {Array<{arguments: string[], cwd?: string}>} */
    const processRequests = [];
    const processAdapter = bundleProcessAdapter(candidateCommit);
    const result = await inspectReleaseValidationBundles({
        ...bundlePaths,
        candidateCommit,
    }, {
        fileSystem: inspectionFileSystem,
        processAdapter: {
            run: async (/** @type {{arguments: string[], cwd?: string}} */ request) => {
                processRequests.push(request);
                return processAdapter.run(request);
            },
        },
        workspaceBoundary: (/** @type {string} */ path) => {
            assert.ok(path === workspaceDirectory || path.startsWith(`${workspaceDirectory}/`));
            boundedPaths.push(path);
        },
    });
    assert.deepEqual(result, {
        agentAssisted: {commit: RELEASE_TARGETS.agentAssisted.commit, kind: 'agent-assisted'},
        candidate: {commit: candidateCommit, kind: 'candidate', priorRelease: {commit: 'd'.repeat(40), tag: '0.2.1'}},
        plain: {commit: RELEASE_TARGETS.plain.commit, kind: 'plain'},
        status: 'inspected',
    });
    assert.equal(boundedPaths.some(path => /\/\.arw-b-[0-9a-f]{8}$/u.test(path)), true);
    const mirrorRequests = processRequests.filter(request => request.cwd?.endsWith('/repository.git'));
    assert.equal(mirrorRequests.length, 5);
    assert.ok(mirrorRequests.every(request => request.arguments[0] === '-c'
        && request.arguments[1] === `safe.directory=${request.cwd}`));
    assert.deepEqual(await readdir(workspaceDirectory), []);
    await assert.rejects(inspectReleaseValidationBundles({
        ...bundlePaths,
        candidateCommit,
    }, {
        fileSystem: inspectionFileSystem,
        processAdapter: bundleProcessAdapter(candidateCommit, (commit, key) => key === 'plain' ? 'b'.repeat(40) : commit),
        workspaceBoundary: () => {},
    }), /plain bundle/i);

    await assert.rejects(inspectReleaseValidationBundles({
        ...bundlePaths,
        candidateCommit,
    }, {
        fileSystem: inspectionFileSystem,
        processAdapter: bundleProcessAdapter(candidateCommit, (commit, key) => key === 'candidate' ? 'b'.repeat(40) : commit),
        workspaceBoundary: () => {},
    }), /candidate bundle/i);

    await assert.rejects(inspectReleaseValidationBundles({
        ...bundlePaths,
        candidateCommit,
    }, {
        fileSystem: inspectionFileSystem,
        processAdapter: bundleProcessAdapter(candidateCommit, value => value, {
            extraCandidateRef: `${'f'.repeat(40)} refs/tags/0.1.0\n`,
        }),
        workspaceBoundary: () => {},
    }), /candidate bundle/i);

    await assert.rejects(inspectReleaseValidationBundles({
        ...bundlePaths,
        candidateCommit,
    }, {
        fileSystem: inspectionFileSystem,
        processAdapter: bundleProcessAdapter(candidateCommit, value => value, {priorVersion: '0.2.0'}),
        workspaceBoundary: () => {},
    }), /tag.*package version/i);

    await assert.rejects(inspectReleaseValidationBundles({
        ...bundlePaths,
        candidateCommit,
    }, {
        fileSystem: inspectionFileSystem,
        processAdapter: bundleProcessAdapter(candidateCommit, value => value, {candidateTag: '0.4.0'}),
        workspaceBoundary: () => {},
    }), /tag.*package version/i);

    await assert.rejects(inspectReleaseValidationBundles({
        ...bundlePaths,
        candidateCommit,
    }, {
        fileSystem: inspectionFileSystem,
        processAdapter: bundleProcessAdapter(candidateCommit, value => value, {candidateTag: '01.2.3'}),
        workspaceBoundary: () => {},
    }), /candidate bundle/i);
    let lifecycleCalls = 0;
    await assert.rejects(startReleaseValidationRun({
        candidateCommit,
        configurationPath: join(workspaceDirectory, 'vm.json'),
        workspaceDirectory,
    }, {
        inspectBundles: async () => { throw new Error('Injected invalid bundle.'); },
        loadConfiguration: async () => configuration(),
        machineLifecycleAdapter: {run: async () => { lifecycleCalls += 1; assert.fail('Invalid bundles must not change VM state.'); }},
        workspaceBoundary: () => {},
    }), {code: 'bundle-invalid'});
    assert.equal(lifecycleCalls, 0);
});

test('release guest tag contract rejects a preexisting first-step tag and stale later identity', () => {
    const candidateCommit = 'a'.repeat(40);
    assert.equal(resolveReleaseGuestTagAction({candidateCommit, existingTagCommit: null, stepIndex: 0}), 'create');
    assert.equal(resolveReleaseGuestTagAction({candidateCommit, existingTagCommit: candidateCommit, stepIndex: 1}), 'reuse');
    assert.throws(
        () => resolveReleaseGuestTagAction({candidateCommit, existingTagCommit: candidateCommit, stepIndex: 0}),
        /already exists/,
    );
    assert.throws(
        () => resolveReleaseGuestTagAction({candidateCommit, existingTagCommit: 'b'.repeat(40), stepIndex: 1}),
        /does not identify/,
    );
    assert.throws(
        () => resolveReleaseGuestTagAction({candidateCommit, existingTagCommit: null, stepIndex: 1}),
        /missing after scenario validation began/,
    );
});

test('release VM configuration accepts only schema version 2 with required bounded concurrency', async () => {
    const result = await loadReleaseVmConfiguration(pathFor('machines.json'), memoryFileSystem(configuration()));
    assert.deepEqual(Object.keys(result.machines), RELEASE_MACHINE_KEYS);
    assert.equal(result.machines.Ubuntu.nodeExecutables.minimum, '/opt/node24/bin/node');
    assert.equal(result.maxParallelMachines, 3);
    assert.equal(result.schemaVersion, 2);

    for (const change of [
(        /** @type {{ extra: boolean; }} */ value) => { value.extra = true; },
(        /** @type {{ schemaVersion: number; }} */ value) => { value.schemaVersion = 1; },
        (/** @type {TestConfiguration} */ value) => { Reflect.deleteProperty(value, 'maxParallelMachines'); },
(        /** @type {{ maxParallelMachines: number; }} */ value) => { value.maxParallelMachines = 0; },
(        /** @type {{ maxParallelMachines: number; }} */ value) => { value.maxParallelMachines = 4; },
(        /** @type {{ maxParallelMachines: number; }} */ value) => { value.maxParallelMachines = 1.5; },
        (/** @type {TestConfiguration} */ value) => { Reflect.deleteProperty(value.machines, 'Alpine'); },
(        /** @type {{ machines: { Ubuntu: { extra: boolean; }; }; }} */ value) => { value.machines.Ubuntu.extra = true; },
(        /** @type {{ machines: { Ubuntu: { machineType: string; }; }; }} */ value) => { value.machines.Ubuntu.machineType = 'Remote'; },
        (/** @type {TestConfiguration} */ value) => { Reflect.deleteProperty(value.machines.Ubuntu.nodeExecutables, 'minimum'); },
(        /** @type {{ machines: { Alpine: { nodeExecutables: { minimum: string; }; }; }; }} */ value) => { value.machines.Alpine.nodeExecutables.minimum = '/opt/node24/bin/node'; },
(        /** @type {{ machines: { [x: string]: { location: string; }; }; }} */ value) => { value.machines['Windows 11'].location = pathFor('guest.txt'); },
(        /** @type {{ machines: { Alpine: { ssh: { port: number; }; }; }; }} */ value) => { value.machines.Alpine.ssh.port = 0; },
    ]) {
        const value = configuration();
        change(value);
        await assert.rejects(
            loadReleaseVmConfiguration(pathFor('machines.json'), memoryFileSystem(value)),
        );
    }
    await assert.rejects(loadReleaseVmConfiguration('relative.json', memoryFileSystem(configuration())), /absolute path/);
});

test('release bundle preparation fetches only the candidate and builds offline target baselines', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-bundles-');
    const calls = testBundleProcessCalls();
    const candidateCommit = 'a'.repeat(40);
    const {configurationPath: sourcesConfigurationPath} = await createValidationSourcesFixture(t);
    const processAdapter = {
        run: async (/** @type {{arguments: string[], cwd: string}} */ request) => {
            calls.push(request);
            const snapshot = snapshotGitObservation(request);
            if (snapshot !== null) return snapshot;
            if (request.arguments[0] === 'rev-parse') {
                if (request.arguments[2]?.startsWith('refs/tags/')) return {exitCode: 0, stderr: '', stdout: `${'d'.repeat(40)}\n`};
                const fetchCall = requireValue(calls.findLast(call => call.arguments[0] === 'fetch'), 'Expected fetch call.');
                return {exitCode: 0, stderr: '', stdout: `${requireValue(fetchCall.arguments[3], 'Expected fetch refspec.').split(':')[0]}\n`};
            }
            if (request.arguments[0] === 'show') return {exitCode: 0, stderr: '', stdout: `${JSON.stringify({version: request.arguments[1].startsWith('refs/tags/') ? '0.99.0' : '1.0.0'})}\n`};
            if (request.arguments[0] === 'tag') return {exitCode: 0, stderr: '', stdout: '0.20.0\n0.99.0\n1.0.0\n'};
            return {exitCode: 0, stderr: '', stdout: ''};
        },
    };
    const result = await prepareReleaseValidationBundles({candidateCommit, sourcesConfigurationPath, workspaceDirectory}, processAdapter, () => {});
    assert.equal(result.status, 'prepared');
    assert.equal(calls.filter(call => call.arguments[0] === 'fetch').length, 2);
    assert.deepEqual(calls.filter(call => call.arguments[0] === 'fetch' && call.arguments[1] === '--no-tags').map(call => call.arguments[3]), [
        `${candidateCommit}:refs/heads/arw-validation`,
    ]);
    assert.deepEqual(result.priorRelease, {commit: 'd'.repeat(40), tag: '0.99.0'});
    assert.equal(calls.filter(call => call.arguments.includes('bundle')).length, 3);
    assert.deepEqual(result.targetCommits, {agentAssisted: RELEASE_TARGETS.agentAssisted.commit, plain: RELEASE_TARGETS.plain.commit});
    const fetches = calls.filter(call => call.arguments[0] === 'fetch' && call.arguments[1] === '--no-tags');
    assert.equal(new Set(fetches.map(call => call.cwd)).size, 1);
    assert.deepEqual(fetches.map(call => call.arguments[2]), [
        RELEASE_TARGETS.sourceCheckout.url,
    ]);
    assert.deepEqual(calls.find(call => call.arguments[0] === 'bundle' && call.cwd.endsWith('candidate'))?.arguments.slice(-2), [
        'refs/heads/arw-validation',
        'refs/tags/0.99.0',
    ]);
});

test('release bundle preparation rejects a prior Release tag whose package version does not match', async t => {
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-release-bundles-');
    const candidateCommit = 'a'.repeat(40);
    const {configurationPath: sourcesConfigurationPath} = await createValidationSourcesFixture(t);
    await assert.rejects(prepareReleaseValidationBundles({candidateCommit, sourcesConfigurationPath, workspaceDirectory}, {
        run: async (/** @type {{arguments: string[], cwd: string}} */ request) => {
            const snapshot = snapshotGitObservation(request);
            if (snapshot !== null) return snapshot;
            if (request.arguments[0] === 'rev-parse') {
                if (request.arguments.at(-1)?.startsWith('refs/tags/')) return {exitCode: 0, stderr: '', stdout: `${'d'.repeat(40)}\n`};
                return {exitCode: 0, stderr: '', stdout: `${candidateCommit}\n`};
            }
            if (request.arguments[0] === 'tag') return {exitCode: 0, stderr: '', stdout: '0.2.1\n'};
            if (request.arguments[0] === 'show') return {exitCode: 0, stderr: '', stdout: `${JSON.stringify({version: request.arguments[1].startsWith('refs/tags/') ? '0.2.0' : '0.3.0'})}\n`};
            return {exitCode: 0, stderr: '', stdout: ''};
        },
    }, () => {}), /tag.*package version/i);
});

test('release production workspace boundary uses only caller-provided Platform Adapter identity', () => {
    const boundary = createReleaseSessionWorkspaceBoundary({
        agentIdentity: {platform: 'codex', sessionId: 'release-session-01'},
        repositoryRoot: process.cwd(),
    });
    const sessionRoot = join(process.cwd(), '.tmp', 'codex', 'release-session-01');
    assert.doesNotThrow(() => boundary(join(sessionRoot, 'release')));
    assert.throws(() => boundary(join(tmpdir(), 'outside-release')), /current session workspace/);
});





test('release VM validation CLI copies one named host file to one named guest destination', async () => {
    const calls = testRecords();
    const output = stringList();
    const workspaceDirectory = pathFor('workspace');
    const hostPath = pathFor('workspace\\input.json');
    const guestPath = '/tmp/arw-release-validation/input.json';
    const configured = configuration();
    assert.equal(await runReleaseVmValidationCli([
        'copy-to-guest',
        '--config', pathFor('machines.json'),
        '--machine', 'Ubuntu',
        '--workspace', workspaceDirectory,
        '--host-path', hostPath,
        '--guest-path', guestPath,
    ], {
        assertOrdinaryHostFile: async () => {},
        errorOutput: {write: (/** @type {string | Error | undefined} */ value) => assert.fail(value)},
        guestAdapter: {copyToGuest: async (/** @type {TestRequest} */ request) => calls.push(request)},
        loadConfiguration: async () => configured,
        output: {write: (/** @type {string} */ value) => output.push(value)},
        validateWorkspacePath: () => {},
    }), 0);
    assert.deepEqual(calls, [{
        guestPath,
        hostPaths: [hostPath],
        machine: configured.machines.Ubuntu,
        machineKey: 'Ubuntu',
        workspaceDirectory,
    }]);
    assert.deepEqual(JSON.parse(popString(output)), {
        direction: 'to-guest',
        machineKey: 'Ubuntu',
        status: 'copied',
    });
});

test('release VM validation CLI copies one named guest file to one named host destination', async () => {
    const calls = testRecords();
    const output = stringList();
    const workspaceDirectory = pathFor('workspace');
    const hostPath = pathFor('workspace\\output.json');
    const guestPath = '/tmp/arw-release-validation/output.json';
    const configured = configuration();
    assert.equal(await runReleaseVmValidationCli([
        'copy-from-guest',
        '--config', pathFor('machines.json'),
        '--machine', 'Ubuntu',
        '--workspace', workspaceDirectory,
        '--guest-path', guestPath,
        '--host-path', hostPath,
    ], {
        errorOutput: {write: (/** @type {string | Error | undefined} */ value) => assert.fail(value)},
        guestAdapter: {copyFromGuest: async (/** @type {TestRequest} */ request) => calls.push(request)},
        loadConfiguration: async () => configured,
        output: {write: (/** @type {string} */ value) => output.push(value)},
        validateWorkspacePath: () => {},
    }), 0);
    assert.deepEqual(calls, [{
        guestPath,
        hostPath,
        machine: configured.machines.Ubuntu,
        machineKey: 'Ubuntu',
        workspaceDirectory,
    }]);
    assert.deepEqual(JSON.parse(popString(output)), {
        direction: 'from-guest',
        machineKey: 'Ubuntu',
        status: 'copied',
    });
});

test('release VM validation CLI serializes configuration and Adapter failures for both copy directions', async () => {
    const baseArguments = [
        '--config', pathFor('machines.json'),
        '--machine', 'Ubuntu',
        '--workspace', pathFor('workspace'),
        '--host-path', pathFor('workspace\\transfer.json'),
        '--guest-path', '/tmp/arw-release-validation/transfer.json',
    ];
    const cases = [
        {
            expected: {
                code: 'configuration-invalid',
                message: 'The release VM configuration is invalid.',
                runPath: null,
                stage: 'configuration',
            },
            failure: 'configuration',
        },
        {
            expected: {
                code: 'adapter-result-invalid',
                message: 'The adapter returned an invalid result.',
                runPath: null,
                stage: 'adapter-result',
            },
            failure: 'adapter',
        },
    ];
    for (const operation of ['copy-to-guest', 'copy-from-guest']) {
        for (const current of cases) {
            const errors = stringList();
            const output = stringList();
            const adapterFailure = new Error('Adapter failure containing sensitive material.');
            const dependencies = {
                assertOrdinaryHostFile: async () => {},
                errorOutput: {write: (/** @type {string} */ value) => errors.push(value)},
                guestAdapter: {
                    copyFromGuest: async () => { throw adapterFailure; },
                    copyToGuest: async () => { throw adapterFailure; },
                },
                loadConfiguration: async () => {
                    if (current.failure === 'configuration') throw new Error('Configuration failure containing sensitive material.');
                    return configuration();
                },
                output: {write: (/** @type {string} */ value) => output.push(value)},
                validateWorkspacePath: () => {},
            };
            assert.equal(await runReleaseVmValidationCli([
                operation, ...baseArguments,
            ], dependencies), 1);
            assert.deepEqual(output, []);
            assert.deepEqual(JSON.parse(popString(errors)), current.expected);
        }
    }
});

test('release VM validation CLI rejects unsafe or ambiguous guest copy requests before transfer', async () => {
    const errors = stringList();
    let transfers = 0;
    let ordinaryFileChecks = 0;
    const workspaceDirectory = pathFor('workspace');
    const hostPath = pathFor('workspace\\input.json');
    const baseArguments = [
        '--config', pathFor('machines.json'),
        '--machine', 'Ubuntu',
        '--workspace', workspaceDirectory,
        '--host-path', hostPath,
        '--guest-path', '/tmp/arw-release-validation/input.json',
    ];
    const dependencies = {
        assertOrdinaryHostFile: async () => { ordinaryFileChecks += 1; },
        errorOutput: {write: (/** @type {string} */ value) => errors.push(value)},
        guestAdapter: {
            copyFromGuest: async () => { transfers += 1; },
            copyToGuest: async () => { transfers += 1; },
        },
        loadConfiguration: async () => configuration(),
        output: {write: (/** @type {string | Error | undefined} */ value) => assert.fail(value)},
        validateWorkspacePath: (/** @type {string} */ path, /** @type {string} */ label) => {
            if (path === pathFor('outside.json')) throw new Error(`${label} is outside the current session workspace.`);
        },
    };

    assert.equal(await runReleaseVmValidationCli([
        'copy-to-guest', ...baseArguments.map((/** @type {string} */ value) => value === hostPath ? 'relative.json' : value),
    ], dependencies), 2);
    assert.match(popString(errors), /^Usage:/);
    assert.equal(await runReleaseVmValidationCli([
        'copy-from-guest', ...baseArguments.map((/** @type {string} */ value) => value === '/tmp/arw-release-validation/input.json' ? 'relative.json' : value),
    ], dependencies), 2);
    assert.match(popString(errors), /^Usage:/);
    assert.equal(await runReleaseVmValidationCli([
        'copy-to-guest', ...baseArguments, '--host-path', hostPath,
    ], dependencies), 2);
    assert.match(popString(errors), /^Usage:/);
    assert.equal(await runReleaseVmValidationCli([
        'copy-from-guest', ...baseArguments.filter((/** @type {string} */ value) => value !== '--guest-path' && value !== '/tmp/arw-release-validation/input.json'),
    ], dependencies), 2);
    assert.match(popString(errors), /^Usage:/);
    assert.equal(await runReleaseVmValidationCli([
        'copy-to-guest', ...baseArguments.map((/** @type {string} */ value) => value === 'Ubuntu' ? 'Unknown' : value),
    ], dependencies), 2);
    assert.match(popString(errors), /^Usage:/);
    assert.equal(await runReleaseVmValidationCli([
        'copy-from-guest', ...baseArguments.map((/** @type {string} */ value) => value === hostPath ? pathFor('outside.json') : value),
    ], dependencies), 1);
    assert.deepEqual(JSON.parse(popString(errors)), {
        code: 'workspace-invalid',
        message: 'The session workspace is invalid.',
        runPath: null,
        stage: 'workspace',
    });
    assert.equal(await runReleaseVmValidationCli([
        'copy-to-guest', ...baseArguments,
    ], {
        ...dependencies,
        assertOrdinaryHostFile: async () => { throw new Error('Release guest copy host path must be an ordinary file.'); },
    }), 1);
    assert.deepEqual(JSON.parse(popString(errors)), {
        code: 'input-invalid',
        message: 'The release validation input is invalid.',
        runPath: null,
        stage: 'planning',
    });
    assert.equal(transfers, 0);
    assert.equal(ordinaryFileChecks, 0);
});

test('release VM validation CLI rejects inherited object names as unknown machines before transfer', async () => {
    const errors = stringList();
    const output = stringList();
    let transfers = 0;
    const dependencies = {
        assertOrdinaryHostFile: async () => {},
        errorOutput: {write: (/** @type {string} */ value) => errors.push(value)},
        guestAdapter: {
            copyFromGuest: async () => { transfers += 1; },
            copyToGuest: async () => { transfers += 1; },
        },
        loadConfiguration: async () => configuration(),
        output: {write: (/** @type {string} */ value) => output.push(value)},
        validateWorkspacePath: () => {},
    };
    for (const operation of ['copy-to-guest', 'copy-from-guest']) {
        for (const machineKey of ['constructor', 'toString', '__proto__']) {
            assert.equal(await runReleaseVmValidationCli([
                operation,
                '--config', pathFor('machines.json'),
                '--machine', machineKey,
                '--workspace', pathFor('workspace'),
                '--host-path', pathFor('workspace\\transfer.json'),
                '--guest-path', '/tmp/arw-release-validation/transfer.json',
            ], dependencies), 2);
            assert.match(popString(errors), /^Usage:/);
            assert.deepEqual(output, []);
        }
    }
    assert.equal(transfers, 0);
});

test('release VM validation CLI direct execution enters its main path from a URL-sensitive path', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-vm-main-');
    const sourceRoot = join(root, 'source#copy');
    await mkdir(join(sourceRoot, 'scripts'), {recursive: true});
    await cp(join(process.cwd(), 'lib'), join(sourceRoot, 'lib'), {recursive: true});
    await copyFile(join(process.cwd(), 'package.json'), join(sourceRoot, 'package.json'));
    const scriptPath = join(sourceRoot, 'scripts', 'release-vm-validation.mjs');
    await copyFile(join(process.cwd(), 'scripts', 'release-vm-validation.mjs'), scriptPath);
    const result = await runExitedProcess(process.execPath, [scriptPath, '--invalid']);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /^Usage:/);
});

test('VMware guest Adapter pins the configured host key without exposing credentials in SSH arguments', async () => {
    const calls = testProcessCalls();
    const writes = testArgumentLists();
    const processAdapter = {
        run: async (/** @type {{arguments: string[], executable: string}} */ request) => {
            calls.push(request);
            if (request.executable.endsWith('vmrun.exe')) {
                return {exitCode: 0, stderr: '', stdout: '192.0.2.10\n'};
            }
            return {exitCode: 0, stderr: '', stdout: 'v24.18.0\n'};
        },
    };
    const selectedMachine = {
        ...machine(),
        guestPasswords: {test: 'guest-secret'},
        vmwareEncryptionPassword: 'vm-secret',
    };
    const adapter = createReleaseVmwareGuestAdapter({
        fileSystem: {
            mkdir: async () => {},
            writeFile: async (/** @type {unknown[]} */ ...args) => writes.push(args),
        },
        processAdapter,
    });
    const result = await adapter.run({
        machine: selectedMachine,
        machineKey: 'Windows 11',
        remoteArguments: [selectedMachine.nodeExecutables.recommended, '--version'],
        workspaceDirectory: pathFor('workspace'),
    });
    assert.equal(result.stdout, 'v24.18.0\n');
    assert.match(requireString(writes[0]?.[1], 'Expected known-host write.'), /^arw-release-windows-11 ssh-ed25519 AAAA\n$/);
    const vmrun = requireValue(calls[0], 'Expected vmrun call.');
    assert.ok(vmrun.arguments.includes('vm-secret'));
    const ssh = requireValue(calls[1], 'Expected ssh call.');
    assert.equal(ssh.executable, 'ssh');
    assert.ok(ssh.arguments.includes('StrictHostKeyChecking=yes'));
    assert.ok(ssh.arguments.includes('HostKeyAlias=arw-release-windows-11'));
    assert.ok(ssh.arguments.includes('IdentitiesOnly=yes'));
    assert.ok(ssh.arguments.includes(selectedMachine.ssh.identityFile));
    assert.equal(ssh.arguments.includes('guest-secret'), false);
    assert.equal(ssh.arguments.includes('vm-secret'), false);
});

test('VMware guest Adapter uses isolated host-local known-host files for strict SSH and SCP connections', async () => {
    const calls = testProcessCalls();
    const writes = testArgumentLists();
    const removals = stringList();
    let temporaryDirectory = 0;
    const hostLocalDirectory = (/** @type {number} */ index) => process.platform === 'win32'
        ? win32.join('C:\\host-local', `ssh-${index}`)
        : join('/host-local', `ssh-${index}`);
    const expectedKnownHostPaths = [0, 1].map(index => process.platform === 'win32'
        ? win32.join('C:\\host-local', `ssh-${index}`, 'known_hosts')
        : join('/host-local', `ssh-${index}`, 'known_hosts'));
    const knownHostArgumentPattern = new RegExp(`^UserKnownHostsFile=(?:${expectedKnownHostPaths
        .map(path => path.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
        .join('|')})$`);
    const adapter = createReleaseVmwareGuestAdapter({
        createTemporaryDirectory: async () => hostLocalDirectory(temporaryDirectory++),
        fileSystem: {writeFile: async (/** @type {unknown[]} */ ...args) => writes.push(args)},
        processAdapter: {
            run: async (/** @type {{arguments: string[], executable: string}} */ request) => {
                calls.push(request);
                return request.executable.endsWith('vmrun.exe')
                    ? {exitCode: 0, stderr: '', stdout: '192.0.2.10\n'}
                    : {exitCode: 0, stderr: '', stdout: ''};
            },
        },
        removeTemporaryDirectory: async (/** @type {string} */ directory) => removals.push(directory),
    });
    const selectedMachine = machine();
    const workspaceDirectory = '\\\\wsl.localhost\\Ubuntu\\workspace';
    await Promise.all([
        adapter.run({
            machine: selectedMachine,
            machineKey: 'Windows 11',
            remoteArguments: [selectedMachine.nodeExecutables.recommended, '--version'],
            workspaceDirectory,
        }),
        adapter.copyToGuest({
            guestPath: 'C:\\release\\input.json',
            hostPaths: [pathFor('workspace\\input.json')],
            machine: selectedMachine,
            machineKey: 'Windows 11',
            workspaceDirectory,
        }),
    ]);
    const knownHostPaths = writes.map(write => requireString(write[0], 'Expected known-host path.'));
    assert.deepEqual(knownHostPaths, expectedKnownHostPaths);
    assert.deepEqual(removals, [hostLocalDirectory(0), hostLocalDirectory(1)]);
    for (const request of calls.filter(call => call.executable === 'ssh' || call.executable === 'scp')) {
        assert.ok(request.arguments.includes('StrictHostKeyChecking=yes'));
        assert.ok(request.arguments.includes('HostKeyAlias=arw-release-windows-11'));
        assert.ok(request.arguments.includes('IdentitiesOnly=yes'));
        assert.equal(request.arguments.some(argument => argument.includes(workspaceDirectory)), false);
        assert.ok(request.arguments.some(argument => knownHostArgumentPattern.test(argument)));
    }
});

test('VMware guest Adapter cleans host-local state after host-key and OpenSSH failures without losing redacted primary diagnostics', async () => {
    const selectedMachine = {
        ...machine(),
        guestPasswords: {test: 'guest-secret'},
        vmwareEncryptionPassword: 'vm-secret',
    };
    const hostKeyRemovals = stringList();
    const hostKeyAdapter = createReleaseVmwareGuestAdapter({
        createTemporaryDirectory: async () => '/host-local/host-key-failure',
        fileSystem: {writeFile: async () => { throw new Error('host key write failed'); }},
        processAdapter: {run: async () => ({exitCode: 0, stderr: '', stdout: '192.0.2.10\n'})},
        removeTemporaryDirectory: async (/** @type {string} */ directory) => hostKeyRemovals.push(directory),
    });
    await assert.rejects(hostKeyAdapter.run({
        machine: selectedMachine,
        machineKey: 'Windows 11',
        remoteArguments: ['node', '--version'],
        workspaceDirectory: pathFor('workspace'),
    }), /host key write failed/u);
    assert.deepEqual(hostKeyRemovals, ['/host-local/host-key-failure']);

    const openSshRemovals = stringList();
    const openSshAdapter = createReleaseVmwareGuestAdapter({
        createTemporaryDirectory: async () => '/host-local/openssh-failure',
        fileSystem: {writeFile: async () => {}},
        processAdapter: {
            run: async (/** @type {{executable: string}} */ request) => request.executable.endsWith('vmrun.exe')
                ? {exitCode: 0, stderr: '', stdout: '192.0.2.10\n'}
                : {exitCode: 1, stderr: `${selectedMachine.ssh.identityFile} ${selectedMachine.guestPasswords.test}`, stdout: ''},
        },
        removeTemporaryDirectory: async (/** @type {string} */ directory) => {
            openSshRemovals.push(directory);
            throw new Error('cleanup failure');
        },
    });
    await assert.rejects(openSshAdapter.copyToGuest({
        guestPath: 'C:\\release\\input.json',
        hostPaths: [pathFor('workspace\\input.json')],
        machine: selectedMachine,
        machineKey: 'Windows 11',
        workspaceDirectory: pathFor('workspace'),
    }), error => {
        const failure = requireError(error);
        assert.match(failure.message, /^Guest input transfer failed:/);
        assert.match(failure.message, /\[redacted\]/u);
        assert.equal(failure.message.includes('cleanup failure'), false);
        assert.equal(failure.message.includes(selectedMachine.ssh.identityFile), false);
        assert.equal(failure.message.includes('guest-secret'), false);
        return true;
    });
    assert.deepEqual(openSshRemovals, ['/host-local/openssh-failure']);
});

test('VMware guest Adapter returns redacted nonzero SSH results across cleanup outcomes', async () => {
    const baseMachine = machine();
    const selectedMachine = {
        ...baseMachine,
        guestPasswords: {test: 'guest-secret'},
        ssh: {...baseMachine.ssh, identityFile: '/host-local/private-key'},
        vmwareEncryptionPassword: 'vm-secret',
    };
    for (const cleanupFails of [false, true]) {
        const removals = stringList();
        const adapter = createReleaseVmwareGuestAdapter({
            createTemporaryDirectory: async () => '/host-local/nonzero-ssh',
            fileSystem: {writeFile: async () => {}},
            processAdapter: {
                run: async (/** @type {{executable: string}} */ request) => request.executable.endsWith('vmrun.exe')
                    ? {exitCode: 0, stderr: '', stdout: '192.0.2.10\n'}
                    : {
                        exitCode: 1,
                        stderr: `${selectedMachine.ssh.identityFile} ${selectedMachine.guestPasswords.test} ${selectedMachine.vmwareEncryptionPassword}`,
                        stdout: selectedMachine.guestPasswords.test,
                    },
            },
            removeTemporaryDirectory: async (/** @type {string} */ directory) => {
                removals.push(directory);
                if (cleanupFails) throw new Error('cleanup failure');
            },
        });
        const result = await adapter.run({
            machine: selectedMachine,
            machineKey: 'Windows 11',
            remoteArguments: ['node', '--version'],
            workspaceDirectory: pathFor('workspace'),
        });
        assert.deepEqual(result, {exitCode: 1, stderr: '[redacted] [redacted] [redacted]', stdout: '[redacted]'});
        assert.deepEqual(removals, ['/host-local/nonzero-ssh']);
    }
});

test('VMware guest Adapter fails a successful operation when host-local state cleanup fails', async () => {
    const adapter = createReleaseVmwareGuestAdapter({
        createTemporaryDirectory: async () => '/host-local/cleanup-failure',
        fileSystem: {writeFile: async () => {}},
        processAdapter: {run: async (/** @type {{executable: string}} */ request) => request.executable.endsWith('vmrun.exe')
            ? {exitCode: 0, stderr: '', stdout: '192.0.2.10\n'}
            : {exitCode: 0, stderr: '', stdout: 'v24.18.0\n'}},
        removeTemporaryDirectory: async () => { throw new Error('cleanup failure'); },
    });
    await assert.rejects(adapter.run({
        machine: machine(),
        machineKey: 'Windows 11',
        remoteArguments: ['node', '--version'],
        workspaceDirectory: pathFor('workspace'),
    }), /cleanup failure/u);
});

test('VMware guest Adapter preserves copy direction and Windows or POSIX guest path spelling', async () => {
    for (const fixture of [
        {
            guestPath: 'C:\\release folder\\input.json',
            machineKey: 'Windows 11',
            scpPath: 'C:/release folder/input.json',
        },
        {
            guestPath: '/tmp/release folder/input.json',
            machineKey: 'Ubuntu',
            scpPath: '/tmp/release folder/input.json',
        },
    ]) {
        const calls = testRecords();
        const selectedMachine = machine({minimum: fixture.machineKey === 'Ubuntu'});
        const adapter = createReleaseVmwareGuestAdapter({
            fileSystem: {
                mkdir: async () => {},
                writeFile: async () => {},
            },
            processAdapter: {
        run: async (/** @type {TestRequest} */ request) => {
                    calls.push(request);
                    if (request.executable.endsWith('vmrun.exe')) {
                        return {exitCode: 0, stderr: '', stdout: '192.0.2.10\n'};
                    }
                    return {exitCode: 0, stderr: '', stdout: ''};
                },
            },
        });
        const hostPaths = [pathFor('workspace\\one.json'), pathFor('workspace\\two.json')];
        const hostPath = pathFor('workspace\\output.json');
        await adapter.copyToGuest({
            guestPath: fixture.guestPath,
            hostPaths,
            machine: selectedMachine,
            machineKey: fixture.machineKey,
            workspaceDirectory: pathFor('workspace'),
        });
        await adapter.copyFromGuest({
            guestPath: fixture.guestPath,
            hostPath,
            machine: selectedMachine,
            machineKey: fixture.machineKey,
            workspaceDirectory: pathFor('workspace'),
        });
        assert.deepEqual(requireValue(requireValue(calls[1], 'Expected first copy call.').arguments, 'Expected first copy arguments.').slice(-3), [
            ...hostPaths,
            `test@192.0.2.10:${fixture.scpPath}`,
        ]);
        assert.deepEqual(requireValue(requireValue(calls[3], 'Expected second copy call.').arguments, 'Expected second copy arguments.').slice(-2), [
            `test@192.0.2.10:${fixture.scpPath}`,
            hostPath,
        ]);
    }
});

test('VMware guest Adapter redacts credentials containing repeated whitespace before normalizing copy failures', async () => {
    const baseMachine = machine();
    const selectedMachine = {
        ...baseMachine,
        guestPasswords: {test: 'guest  secret'},
        ssh: {
            ...baseMachine.ssh,
            hostKey: 'ssh-ed25519  AAAA fixture-comment',
            identityFile: pathFor('identity  file'),
        },
        vmwareEncryptionPassword: 'vm  secret',
    };
    const adapter = createReleaseVmwareGuestAdapter({
        fileSystem: {
            mkdir: async () => {},
            writeFile: async () => {},
        },
        processAdapter: {
            run: async (/** @type {TestRequest} */ request) => request.executable?.endsWith('vmrun.exe')
                ? {exitCode: 0, stderr: '', stdout: '192.0.2.10\n'}
                : {
                    exitCode: 1,
                    stderr: [
                        selectedMachine.vmwareEncryptionPassword,
                        selectedMachine.guestPasswords.test,
                        selectedMachine.ssh.hostKey,
                        selectedMachine.ssh.identityFile,
                    ].join(' | '),
                    stdout: '',
                },
        },
    });
    await assert.rejects(adapter.copyToGuest({
        guestPath: 'C:\\release\\input.json',
        hostPaths: [pathFor('workspace\\input.json')],
        machine: selectedMachine,
        machineKey: 'Windows 11',
        workspaceDirectory: pathFor('workspace'),
    }), error => {
        const failure = requireError(error);
        for (const value of [
            'vm  secret',
            'vm secret',
            'guest  secret',
            'guest secret',
            'ssh-ed25519  AAAA fixture-comment',
            'ssh-ed25519 AAAA fixture-comment',
            pathFor('identity  file'),
            pathFor('identity file'),
        ]) assert.equal(failure.message.includes(value), false);
        assert.match(failure.message, /\[redacted\]/);
        return true;
    });
});

test('VMware guest Adapter preserves quoted JavaScript through the Windows remote shell', async () => {
    const calls = testProcessCalls();
    const selectedMachine = machine();
    const adapter = createReleaseVmwareGuestAdapter({
        fileSystem: {
            mkdir: async () => {},
            writeFile: async () => {},
        },
        processAdapter: {
        run: async (/** @type {TestRequest} */ request) => {
                calls.push(request);
                if (request.executable.endsWith('vmrun.exe')) {
                    return {exitCode: 0, stderr: '', stdout: '192.0.2.10\n'};
                }
                return {exitCode: 0, stderr: '', stdout: ''};
            },
        },
    });
    const script = 'await fs.mkdir("C:\\\\arw-release-validation\\\\run")';
    const remoteArguments = [selectedMachine.nodeExecutables.recommended, '-e', script];
    await adapter.run({
        machine: selectedMachine,
        machineKey: 'Windows 11',
        remoteArguments,
        workspaceDirectory: pathFor('workspace'),
    });
    const command = requireValue(requireValue(calls[1], 'Expected PowerShell call.').arguments.at(-1), 'Expected encoded command.');
    const match = requireValue(
        /^powershell\.exe -NoProfile -NonInteractive -EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(command),
        'Expected encoded PowerShell command.',
    );
    const decoded = Buffer.from(requireValue(match[1], 'Expected encoded payload.'), 'base64').toString('utf16le');
    const argumentPayload = Buffer.from(JSON.stringify(remoteArguments)).toString('base64');
    assert.match(decoded, /^& '[^']+' '-e' '.+' '[A-Za-z0-9+/=]+'$/);
    assert.equal(decoded.endsWith(` '${argumentPayload}'`), true);
    assert.deepEqual(JSON.parse(Buffer.from(argumentPayload, 'base64').toString('utf8')), remoteArguments);
});

test('VMware machine lifecycle Adapter returns closed power and snapshot observations', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-vmware-lifecycle-');
    const location = join(root, 'Release VM.vmx');
    await writeFile(location, 'config.version = "8"\n');
    await writeFile(join(root, 'Release VM.vmsd'), [
        'snapshot.current = "1"',
        'snapshot0.uid = "1"',
        'snapshot0.displayName = "baseline"',
        '',
    ].join('\n'));
    const requests = testRequests();
    const machine = {
        location,
        snapshot: 'baseline',
        vmrun: join(root, 'vmrun.exe'),
    };
    const adapter = createReleaseVmwareMachineLifecycleAdapter({
        processAdapter: {
        run: async (/** @type {TestRequest} */ request) => {
                requests.push(request);
                if (request.arguments.at(-1) === 'list') {
                    return {exitCode: 0, stderr: '', stdout: `Total running VMs: 1\n${location}\n`};
                }
                if (request.arguments.includes('listSnapshots')) {
                    return {exitCode: 0, stderr: '', stdout: 'Total snapshots: 1\nbaseline\n'};
                }
                assert.fail(`Unexpected VMware operation: ${request.arguments.join(' ')}`);
            },
        },
    });

    assert.deepEqual(await adapter.run({machine, operation: 'read-power-state'}), {
        observation: {powerState: 'running'},
        operation: 'read-power-state',
        status: 'observed',
    });
    assert.deepEqual(await adapter.run({machine, operation: 'read-snapshots'}), {
        observation: {currentSnapshot: 'baseline', snapshots: ['baseline']},
        operation: 'read-snapshots',
        status: 'observed',
    });
    assert.equal(requests.every(request => request.executable === machine.vmrun && request.cwd === root), true);
});

test('VMware Workstation 25.0.1 resumes and hard-stops a suspended machine after the exact known failure', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-vmware-hard-stop-');
    const location = join(root, 'Release VM.vmx');
    const statePath = join(root, 'Release VM.vmss');
    await writeFile(location, 'checkpoint.vmState = "Release VM.vmss"\n');
    await writeFile(statePath, 'suspended');
    const requests = testRequests();
    let stopCount = 0;
    const adapter = createReleaseVmwareMachineLifecycleAdapter({
        processAdapter: {
        run: async (/** @type {TestRequest} */ request) => {
                requests.push(request);
                if (request.arguments.at(-1) === 'list') {
                    return {exitCode: 0, stderr: '', stdout: 'Total running VMs: 0\n'};
                }
                if (request.arguments.includes('stop')) {
                    stopCount += 1;
                    if (stopCount === 1) {
                        return {exitCode: 4294967295, stderr: '', stdout: `Error: The virtual machine is not powered on: ${location}\r\n`};
                    }
                    await writeFile(location, 'checkpoint.vmState = ""\n');
                    return {exitCode: 0, stderr: '', stdout: ''};
                }
                if (request.arguments.length === 0) {
                    return {exitCode: 4294967295, stderr: '', stdout: '\r\nvmrun version 1.17.0.25219725\r\n\r\nUsage: vmrun\r\n'};
                }
                if (request.arguments.includes('start')) {
                    return {exitCode: 0, stderr: '', stdout: ''};
                }
                assert.fail(`Unexpected VMware operation: ${request.arguments.join(' ')}`);
            },
        },
    });

    assert.deepEqual(await adapter.run({
        machine: {location, snapshot: 'baseline', vmrun: join(root, 'vmrun.exe')},
        operation: 'hard-power-off',
    }), {
        observation: {powerState: 'powered-off'},
        operation: 'hard-power-off',
        status: 'observed',
    });
    assert.deepEqual(requests.map(request => request.arguments), [
        ['-T', 'ws', 'list'],
        ['-T', 'ws', 'stop', location, 'hard'],
        [],
        ['-T', 'ws', 'start', location, 'nogui'],
        ['-T', 'ws', 'stop', location, 'hard'],
        ['-T', 'ws', 'list'],
    ]);
});

test('VMware Workstation 25.0.1 workaround fails when resume and hard-stop do not produce powered-off state', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-vmware-hard-stop-');
    const location = join(root, 'Release VM.vmx');
    await writeFile(location, 'checkpoint.vmState = "Release VM.vmss"\n');
    await writeFile(join(root, 'Release VM.vmss'), 'suspended');
    const requests = testRequests();
    let stopCount = 0;
    const adapter = createReleaseVmwareMachineLifecycleAdapter({
        processAdapter: {
        run: async (/** @type {TestRequest} */ request) => {
                requests.push(request);
                if (request.arguments.at(-1) === 'list') {
                    return {exitCode: 0, stderr: '', stdout: 'Total running VMs: 0\n'};
                }
                if (request.arguments.includes('stop')) {
                    stopCount += 1;
                    return stopCount === 1
                        ? {exitCode: 4294967295, stderr: '', stdout: `Error: The virtual machine is not powered on: ${location}\r\n`}
                        : {exitCode: 0, stderr: '', stdout: ''};
                }
                if (request.arguments.length === 0) {
                    return {exitCode: 4294967295, stderr: '', stdout: '\r\nvmrun version 1.17.0.25219725\r\n\r\nUsage: vmrun\r\n'};
                }
                if (request.arguments.includes('start')) {
                    return {exitCode: 0, stderr: '', stdout: ''};
                }
                assert.fail(`Unexpected VMware operation: ${request.arguments.join(' ')}`);
            },
        },
    });

    assert.deepEqual(await adapter.run({
        machine: {location, snapshot: 'baseline', vmrun: join(root, 'vmrun.exe')},
        operation: 'hard-power-off',
    }), {
        code: 'observation-failed',
        message: 'The VMware Workstation 25.0.1 hard-stop workaround did not produce a powered-off machine.',
        operation: 'hard-power-off',
        status: 'failed',
    });
    assert.deepEqual(requests.map(request => request.arguments), [
        ['-T', 'ws', 'list'],
        ['-T', 'ws', 'stop', location, 'hard'],
        [],
        ['-T', 'ws', 'start', location, 'nogui'],
        ['-T', 'ws', 'stop', location, 'hard'],
        ['-T', 'ws', 'list'],
    ]);
});

test('VMware hard-stop failure does not use the Workstation 25.0.1 workaround for another vmrun build', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-vmware-hard-stop-');
    const location = join(root, 'Release VM.vmx');
    await writeFile(location, 'checkpoint.vmState = "Release VM.vmss"\n');
    await writeFile(join(root, 'Release VM.vmss'), 'suspended');
    const requests = testRequests();
    const adapter = createReleaseVmwareMachineLifecycleAdapter({
        processAdapter: {
        run: async (/** @type {TestRequest} */ request) => {
                requests.push(request);
                if (request.arguments.at(-1) === 'list') {
                    return {exitCode: 0, stderr: '', stdout: 'Total running VMs: 0\n'};
                }
                if (request.arguments.includes('stop')) {
                    return {exitCode: 4294967295, stderr: '', stdout: `Error: The virtual machine is not powered on: ${location}\r\n`};
                }
                if (request.arguments.length === 0) {
                    return {exitCode: 4294967295, stderr: '', stdout: '\r\nvmrun version 1.17.0.25219724\r\n\r\nUsage: vmrun\r\n'};
                }
                assert.fail(`Unexpected VMware operation: ${request.arguments.join(' ')}`);
            },
        },
    });

    assert.deepEqual(await adapter.run({
        machine: {location, snapshot: 'baseline', vmrun: join(root, 'vmrun.exe')},
        operation: 'hard-power-off',
    }), {
        code: 'process-failed',
        message: 'The VMware lifecycle process did not complete successfully.',
        operation: 'hard-power-off',
        status: 'failed',
    });
    assert.deepEqual(requests.map(request => request.arguments), [
        ['-T', 'ws', 'list'],
        ['-T', 'ws', 'stop', location, 'hard'],
        [],
    ]);
});

test('VMware Workstation 25.0.1 workaround rejects a different hard-stop error', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-vmware-hard-stop-');
    const location = join(root, 'Release VM.vmx');
    await writeFile(location, 'checkpoint.vmState = "Release VM.vmss"\n');
    await writeFile(join(root, 'Release VM.vmss'), 'suspended');
    const requests = testRequests();
    const adapter = createReleaseVmwareMachineLifecycleAdapter({
        processAdapter: {
        run: async (/** @type {TestRequest} */ request) => {
                requests.push(request);
                if (request.arguments.at(-1) === 'list') {
                    return {exitCode: 0, stderr: '', stdout: 'Total running VMs: 0\n'};
                }
                if (request.arguments.includes('stop')) {
                    return {exitCode: 4294967295, stderr: '', stdout: 'Error: Another VMware operation failed.\r\n'};
                }
                assert.fail(`Unexpected VMware operation: ${request.arguments.join(' ')}`);
            },
        },
    });

    assert.deepEqual(await adapter.run({
        machine: {location, snapshot: 'baseline', vmrun: join(root, 'vmrun.exe')},
        operation: 'hard-power-off',
    }), {
        code: 'process-failed',
        message: 'The VMware lifecycle process did not complete successfully.',
        operation: 'hard-power-off',
        status: 'failed',
    });
    assert.deepEqual(requests.map(request => request.arguments), [
        ['-T', 'ws', 'list'],
        ['-T', 'ws', 'stop', location, 'hard'],
    ]);
});

test('VMware soft power-off observes ordinary guest shutdown without using a workaround', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-vmware-soft-stop-');
    const location = join(root, 'Release VM.vmx');
    await writeFile(location, 'checkpoint.vmState = ""\n');
    let running = true;
    const requests = testRequests();
    const adapter = createReleaseVmwareMachineLifecycleAdapter({
        processAdapter: {
        run: async (/** @type {TestRequest} */ request) => {
                requests.push(request);
                if (request.arguments.at(-1) === 'list') {
                    return {exitCode: 0, stderr: '', stdout: running ? `Total running VMs: 1\n${location}\n` : 'Total running VMs: 0\n'};
                }
                if (request.arguments.at(-1) === 'soft') {
                    assert.equal(request.timeoutMs, 9_000);
                    running = false;
                    return {exitCode: 0, stderr: '', stdout: ''};
                }
                assert.fail(`Unexpected VMware operation: ${request.arguments.join(' ')}`);
            },
        },
    });

    assert.deepEqual(await adapter.run({
        machine: {location, snapshot: 'baseline', vmrun: join(root, 'vmrun.exe')},
        machineKey: 'Windows 11',
        operation: 'soft-power-off',
    }), {
        observation: {powerOffMode: 'soft', powerState: 'powered-off'},
        operation: 'soft-power-off',
        status: 'observed',
    });
    const observation = {powerOffMode: 'soft', powerState: 'powered-off'};
    assert.equal(matchesReleaseSoftPowerOffExpectation({machineKey: 'Windows 11', observation, requirement: 'powered-off'}), true);
    assert.equal(matchesReleaseSoftPowerOffExpectation({machineKey: 'Windows 11', observation, requirement: 'soft-shutdown'}), true);
    assert.deepEqual(requests.map(request => request.arguments), [
        ['-T', 'ws', 'list'],
        ['-T', 'ws', 'stop', location, 'soft'],
        ['-T', 'ws', 'list'],
    ]);
});

test('VMware hard-stops Alpine after a soft-stop timeout without checking either product version', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-vmware-alpine-soft-stop-');
    const location = join(root, 'Release VM.vmx');
    await writeFile(location, 'checkpoint.vmState = ""\n');
    let running = true;
    const requests = testRequests();
    const observedPowerStates = stringList();
    const adapter = createReleaseVmwareMachineLifecycleAdapter({
        processAdapter: {
        run: async (/** @type {TestRequest} */ request) => {
                requests.push(request);
                if (request.arguments.at(-1) === 'list') {
                    observedPowerStates.push(running ? 'running' : 'powered-off');
                    return {exitCode: 0, stderr: '', stdout: running ? `Total running VMs: 1\n${location}\n` : 'Total running VMs: 0\n'};
                }
                if (request.arguments.at(-1) === 'soft') {
                    assert.equal(request.timeoutMs, 6_000);
                    const error = new Error('fixture timeout');
                    Reflect.set(error, 'code', 'ETIMEDOUT');
                    throw error;
                }
                if (request.arguments.at(-1) === 'hard') {
                    running = false;
                    return {exitCode: 0, stderr: '', stdout: ''};
                }
                assert.fail(`Unexpected VMware operation: ${request.arguments.join(' ')}`);
            },
        },
    });

    assert.deepEqual(await adapter.run({
        machine: {location, snapshot: 'baseline', vmrun: join(root, 'vmrun.exe')},
        machineKey: 'Alpine',
        operation: 'soft-power-off',
    }), {
        observation: {powerOffMode: 'hard-after-timeout', powerState: 'powered-off'},
        operation: 'soft-power-off',
        status: 'observed',
    });
    assert.deepEqual(observedPowerStates, ['running', 'running', 'powered-off']);
    assert.deepEqual(requests.slice(-2).map(request => request.arguments), [
        ['-T', 'ws', 'stop', location, 'hard'],
        ['-T', 'ws', 'list'],
    ]);
    assert.equal(requests.some(request => request.arguments.length === 0), false);
    const observation = {powerOffMode: 'hard-after-timeout', powerState: 'powered-off'};
    assert.equal(matchesReleaseSoftPowerOffExpectation({machineKey: 'Alpine', observation, requirement: 'powered-off'}), true);
    assert.equal(matchesReleaseSoftPowerOffExpectation({machineKey: 'Alpine', observation, requirement: 'soft-shutdown'}), true);
});

test('VMware hard-stops a non-Alpine machine after soft timeout but preserves failed soft semantics', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-vmware-soft-stop-');
    const location = join(root, 'Release VM.vmx');
    await writeFile(location, 'checkpoint.vmState = ""\n');
    let running = true;
    const requests = testRequests();
    const adapter = createReleaseVmwareMachineLifecycleAdapter({
        processAdapter: {
        run: async (/** @type {TestRequest} */ request) => {
                requests.push(request);
                if (request.arguments.at(-1) === 'list') {
                    return {exitCode: 0, stderr: '', stdout: running ? `Total running VMs: 1\n${location}\n` : 'Total running VMs: 0\n'};
                }
                if (request.arguments.at(-1) === 'soft') {
                    assert.equal(request.timeoutMs, 6_000);
                    const error = new Error('fixture timeout');
                    Reflect.set(error, 'code', 'ETIMEDOUT');
                    throw error;
                }
                if (request.arguments.at(-1) === 'hard') {
                    running = false;
                    return {exitCode: 0, stderr: '', stdout: ''};
                }
                assert.fail(`Unexpected VMware operation: ${request.arguments.join(' ')}`);
            },
        },
    });

    assert.deepEqual(await adapter.run({
        machine: {location, snapshot: 'baseline', vmrun: join(root, 'vmrun.exe')},
        machineKey: 'Ubuntu',
        operation: 'soft-power-off',
    }), {
        observation: {powerOffMode: 'hard-after-timeout', powerState: 'powered-off'},
        operation: 'soft-power-off',
        status: 'observed',
    });
    assert.equal(requests.some(request => request.arguments.length === 0), false);
    const observation = {powerOffMode: 'hard-after-timeout', powerState: 'powered-off'};
    assert.equal(matchesReleaseSoftPowerOffExpectation({machineKey: 'Ubuntu', observation, requirement: 'powered-off'}), true);
    assert.equal(matchesReleaseSoftPowerOffExpectation({machineKey: 'Ubuntu', observation, requirement: 'soft-shutdown'}), false);
});

test('VMware does not use the timeout fallback when a successful soft process leaves the machine running', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-vmware-soft-stop-');
    const location = join(root, 'Release VM.vmx');
    await writeFile(location, 'checkpoint.vmState = ""\n');
    const requests = testRequests();
    const adapter = createReleaseVmwareMachineLifecycleAdapter({
        processAdapter: {
        run: async (/** @type {TestRequest} */ request) => {
                requests.push(request);
                if (request.arguments.at(-1) === 'list') {
                    return {exitCode: 0, stderr: '', stdout: `Total running VMs: 1\n${location}\n`};
                }
                if (request.arguments.at(-1) === 'soft') {
                    assert.equal(request.timeoutMs, 6_000);
                    return {exitCode: 0, stderr: '', stdout: ''};
                }
                assert.fail(`Unexpected VMware operation: ${request.arguments.join(' ')}`);
            },
        },
    });

    assert.deepEqual(await adapter.run({
        machine: {location, snapshot: 'baseline', vmrun: join(root, 'vmrun.exe')},
        machineKey: 'Ubuntu',
        operation: 'soft-power-off',
    }), {
        code: 'observation-failed',
        message: 'The VMware soft power-off process succeeded without producing a powered-off machine.',
        operation: 'soft-power-off',
        status: 'failed',
    });
    assert.equal(requests.some(request => request.arguments.at(-1) === 'hard'), false);
});

test('release run-step transfers exact inputs and writes a judgment-only template from guest facts', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-remote-step-');
    await writeFile(join(root, 'bundles.json'), `${JSON.stringify({
        bundles: {
            agentAssisted: join(root, 'agentAssisted.bundle'),
            candidate: join(root, 'candidate.bundle'),
            plain: join(root, 'plain.bundle'),
        },
        candidateCommit: 'a'.repeat(40),
        priorRelease: {commit: 'd'.repeat(40), tag: '0.2.1'},
        targetCommits: {agentAssisted: RELEASE_TARGETS.agentAssisted.commit, plain: RELEASE_TARGETS.plain.commit},
        status: 'prepared',
    })}\n`);
    await Promise.all(['agentAssisted', 'candidate', 'plain'].map(name => writeFile(join(root, `${name}.bundle`), name)));
    const selectedMachine = machine({minimum: true});
    const calls = testRecords();
    const captured = {
        auditedDirectory: '/tmp/arw-release-validation/scenarios-ubuntu-plain/home',
        changes: [{changeType: 'modified', path: 'README.md'}],
        machineKey: 'Ubuntu',
        reviewMaterial: {
            commandOutcome: {exitCode: 0, stderr: '', stdout: 'verified\n'},
            headToIndexDiff: '',
            indexToWorkingTreeDiff: '',
            nonRegularEntries: [],
            status: Buffer.from(' M README.md\0').toString('base64'),
            untrackedFiles: [],
        },
        scenarioId: 'scenarios/ubuntu/plain',
        status: 'captured',
        stepId: '001-install',
    };
    const guestAdapter = {
        copyToGuest: async (/** @type {TestRequest} */ request) => calls.push({kind: 'copy', request}),
        run: async (/** @type {{remoteArguments: string[]}} */ request) => {
            calls.push({kind: 'run', request});
            if (request.remoteArguments.at(-1) === '--version') {
                return {exitCode: 0, stderr: '', stdout: 'v24.18.0\n'};
            }
            if (request.remoteArguments.some((/** @type {string} */ argument) => argument.endsWith('release-guest-step.mjs'))) {
                return {exitCode: 0, stderr: '', stdout: `${JSON.stringify(captured)}\n`};
            }
            return {exitCode: 0, stderr: '', stdout: ''};
        },
    };
    const result = await runReleaseVmGuestStep({
        configuration: {machines: {Ubuntu: selectedMachine}},
        machineKey: 'Ubuntu',
        scenarioId: 'scenarios/ubuntu/plain',
        stepId: '001-install',
        workspaceDirectory: root,
    }, {guestAdapter, processAdapter: bundleProcessAdapter(), workspaceBoundary: () => {}});
    const template = JSON.parse(await readFile(result.templatePath, 'utf8'));
    assert.equal(template.mechanical.nodeVersion, 'v24.18.0');
    assert.deepEqual(template.judgment.files, [{
        changeType: 'modified',
        matchesExpected: null,
        path: 'README.md',
        summary: null,
    }]);
    assert.equal(calls.filter(call => call.kind === 'copy').length, 1);
    const copyCall = requireValue(calls.find(call => call.kind === 'copy'), 'Expected guest copy call.');
    assert.equal(requireValue(copyCall.request, 'Expected guest copy request.').hostPaths?.length, 3);
    const helperCall = requireValue(calls.find(call => call.kind === 'run'
        && call.request?.remoteArguments?.some((/** @type {string} */ argument) => argument.endsWith('release-guest-step.mjs'))), 'Expected guest helper call.');
    assert.deepEqual(requireValue(requireValue(helperCall.request, 'Expected guest helper request.').remoteArguments, 'Expected guest helper arguments.').slice(-10), [
        '--machine', 'Ubuntu',
        '--scenario', 'scenarios/ubuntu/plain',
        '--step', '001-install',
        '--workspace', '/tmp/arw-release-validation/scenarios-ubuntu-plain',
        '--choices', '{}',
    ]);
});

test('release run-step retrieves a finite mechanical input through the Guest Adapter', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-mechanical-input-');
    await writeFile(join(root, 'bundles.json'), `${JSON.stringify({
        bundles: {
            agentAssisted: join(root, 'agentAssisted.bundle'),
            candidate: join(root, 'candidate.bundle'),
            plain: join(root, 'plain.bundle'),
        },
        candidateCommit: 'a'.repeat(40),
        priorRelease: {commit: 'd'.repeat(40), tag: '0.2.1'},
        targetCommits: {agentAssisted: RELEASE_TARGETS.agentAssisted.commit, plain: RELEASE_TARGETS.plain.commit},
        status: 'prepared',
    })}\n`);
    await Promise.all(['agentAssisted', 'candidate', 'plain'].map(name => writeFile(join(root, `${name}.bundle`), name)));
    const priorDirectory = join(root, 'archive-source', 'observations', 'windows', 'recommended', 'steps', '001-install-prior-release');
    await mkdir(priorDirectory, {recursive: true});
    await writeFile(join(priorDirectory, 'validation.json'), `${JSON.stringify({
        exitCode: 0,
        files: [],
        matchesExpected: true,
        summary: 'Expected installation result.',
    })}\n`);
    const captured = {
        auditedDirectory: 'C:\\arw-release-validation\\observations-windows-recommended\\home',
        changes: [{changeType: 'modified', path: '.agent-repository-workflow/config.json'}],
        machineKey: 'Windows 11',
        reviewMaterial: {
            headToIndexDiff: '',
            indexToWorkingTreeDiff: '',
            nonRegularEntries: [],
            status: Buffer.from(' M .agent-repository-workflow/config.json\0').toString('base64'),
            untrackedFiles: [],
        },
        scenarioId: 'observations/windows/recommended',
        status: 'captured',
        stepId: '002-prepare-preserved-configuration',
    };
    const configPath = '.agent-repository-workflow/config.json';
    const beforeConfig = {editor: {command: 'code'}};
    const afterConfig = {editor: {command: 'release-validation-editor'}};
    const mechanicalInput = {
        capturedFacts: capturedFacts(
            [factEntry(configPath, `${JSON.stringify(beforeConfig, null, 2)}\n`)],
            [factEntry(configPath, `${JSON.stringify(afterConfig, null, 2)}\n`)],
        ),
        currentObservation: {config: afterConfig, path: configPath},
        operationActual: {
            actual: {afterConfig, beforeConfig, path: configPath},
            operationContract: 'prepare-preserved-configuration',
            status: 'completed',
        },
    };
    let mechanicalInputTransfers = 0;
    /** @type {string | undefined} */
    let failedMechanicalInputPath;
    const guestAdapter = {
        copyFromGuest: async (/** @type {{ hostPath: string; }} */ request) => {
            mechanicalInputTransfers += 1;
            if (mechanicalInputTransfers === 1) {
                failedMechanicalInputPath = request.hostPath;
                await writeFile(request.hostPath, '{"capturedFacts":', {flag: 'wx'});
                return;
            }
            await writeFile(request.hostPath, `${JSON.stringify(mechanicalInput)}\n`, {flag: 'wx'});
        },
        run: async (/** @type {{ remoteArguments: string[]; }} */ request) => request.remoteArguments.at(-1) === '--version'
            ? {exitCode: 0, stderr: '', stdout: 'v24.18.0\n'}
            : request.remoteArguments.some((/** @type {string} */ argument) => argument.endsWith('release-guest-step.mjs'))
                ? {exitCode: 0, stderr: '', stdout: `${JSON.stringify(captured)}\n`}
                : {exitCode: 0, stderr: '', stdout: ''},
    };
    const request = {
        configuration: {machines: {'Windows 11': machine()}},
        machineKey: 'Windows 11',
        scenarioId: 'observations/windows/recommended',
        stepId: '002-prepare-preserved-configuration',
        workspaceDirectory: root,
    };
    const dependencies = {
        guestAdapter,
        processAdapter: bundleProcessAdapter(),
        retrieveMechanicalInput: true,
        workspaceBoundary: () => {},
    };
    await assert.rejects(runReleaseVmGuestStep(request, dependencies), /Release guest mechanical input is invalid/);
    const failedPath = requireValue(failedMechanicalInputPath, 'Expected failed mechanical input path.');
    await assert.rejects(lstat(failedPath), {code: 'ENOENT'});
    await assert.rejects(lstat(join(dirname(failedPath), 'review-material.json')), {code: 'ENOENT'});
    await assert.rejects(lstat(join(dirname(failedPath), 'judgment-template.json')), {code: 'ENOENT'});
    const result = await runReleaseVmGuestStep({
        ...request,
    }, dependencies);
    assert.equal(mechanicalInputTransfers, 2);
    assert.deepEqual(JSON.parse(await readFile(result.mechanicalInputPath, 'utf8')), mechanicalInput);
});

test('release observe-only capture skips guest setup and original operation replay', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-observe-only-');
    const captureId = '32323232-3232-4232-8232-323232323232';
    const calls = testRecords();
    const configPath = '.agent-repository-workflow/config.json';
    const currentConfig = {editor: {command: 'release-validation-editor'}};
    const mechanicalInput = {
        capturedFacts: capturedFacts(
            [factEntry(configPath, `${JSON.stringify(currentConfig, null, 2)}\n`)],
            [factEntry(configPath, `${JSON.stringify(currentConfig, null, 2)}\n`)],
        ),
        currentObservation: {config: currentConfig, path: configPath},
        operationActual: null,
    };
    const guestAdapter = {
        copyFromGuest: async (/** @type {{ hostPath: import("fs").PathLike | import("fs/promises").FileHandle; }} */ request) => {
            calls.push({kind: 'copy-from', request});
            await writeFile(request.hostPath, `${JSON.stringify(mechanicalInput)}\n`, {flag: 'wx'});
        },
        copyToGuest: async () => assert.fail('Observe-only capture must not transfer setup bundles.'),
        run: async (/** @type {{ remoteArguments: string[]; }} */ request) => {
            calls.push({kind: 'run', request});
            if (request.remoteArguments.at(-1) === '--version') return {exitCode: 0, stderr: '', stdout: 'v24.18.0\n'};
            assert.equal(request.remoteArguments.includes('--observe-only'), true);
            assert.equal(request.remoteArguments.includes(captureId), true);
            return {exitCode: 0, stderr: '', stdout: `${JSON.stringify({
                auditedDirectory: '/tmp/arw-release-validation/observations-ubuntu-recommended/home',
                changes: [],
                machineKey: 'Ubuntu',
                reviewMaterial: {
                    headToIndexDiff: '',
                    indexToWorkingTreeDiff: '',
                    nonRegularEntries: [],
                    status: '',
                    untrackedFiles: [],
                },
                scenarioId: 'observations/ubuntu/recommended',
                status: 'captured',
                stepId: '002-prepare-preserved-configuration',
            })}\n`};
        },
    };
    const result = await runReleaseVmGuestStep({
        configuration: {machines: {Ubuntu: machine({minimum: true})}},
        machineKey: 'Ubuntu',
        scenarioId: 'observations/ubuntu/recommended',
        stepId: '002-prepare-preserved-configuration',
        workspaceDirectory: root,
    }, {
        captureId,
        enforceFinalizedPrerequisites: false,
        guestAdapter,
        observeOnly: true,
        retrieveMechanicalInput: true,
        workspaceBoundary: () => {},
    });
    assert.deepEqual(JSON.parse(await readFile(result.mechanicalInputPath, 'utf8')), mechanicalInput);
    assert.equal(calls.filter(call => call.kind === 'run').length, 2);
});

test('release Windows workspace preparation uses a run-bound exclusive Node directory creation', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-windows-workspace-');
    /** @type {string[][]} */
    const calls = [];
    const guestAdapter = {
        run: async (/** @type {{ remoteArguments: string[]; }} */ request) => {
            calls.push(request.remoteArguments);
            return request.remoteArguments.at(-1) === '--version'
                ? {exitCode: 0, stderr: '', stdout: 'v24.18.0\n'}
                : {exitCode: 0, stderr: '', stdout: ''};
        },
    };
    const runId = '54545454-5454-4545-8545-545454545454';
    await assert.rejects(runReleaseVmGuestStep({
        configuration: {machines: {'Windows 11': machine()}},
        machineKey: 'Windows 11',
        scenarioId: 'scenarios/windows/plain',
        stepId: '001-install',
        workspaceDirectory: root,
    }, {guestAdapter, runId, workspaceBoundary: () => {}}), /bundle record/);
    assert.deepEqual(calls[1], [
        pathFor('node.exe'),
        '-e',
        `import('node:fs/promises').then(async fs=>{await fs.mkdir("C:\\\\arw-release-validation\\\\${runId}",{recursive:true});await fs.mkdir("C:\\\\arw-release-validation\\\\${runId}\\\\scenarios-windows-plain")})`,
    ]);
});

test('release run-step blocks a dependent step after a finalized failed prerequisite', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-failed-prerequisite-');
    const priorDirectory = join(root, 'archive-source', 'scenarios', 'ubuntu', 'plain', 'steps', '001-install');
    await mkdir(priorDirectory, {recursive: true});
    await writeFile(join(priorDirectory, 'validation.json'), '{"matchesExpected":false}\n');
    await assert.rejects(runReleaseVmGuestStep({
        configuration: {machines: {Ubuntu: machine({minimum: true})}},
        machineKey: 'Ubuntu',
        scenarioId: 'scenarios/ubuntu/plain',
        stepId: '002-init',
        workspaceDirectory: root,
    }, {
        guestAdapter: {run: async () => assert.fail('Guest must not run after a failed prerequisite.')},
        workspaceBoundary: () => {},
    }), /depends on failed step 001-install/);
});

test('release run-step rejects a malformed successful prerequisite record', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-malformed-prerequisite-');
    const priorDirectory = join(root, 'archive-source', 'scenarios', 'ubuntu', 'plain', 'steps', '001-install');
    await mkdir(priorDirectory, {recursive: true});
    await writeFile(join(priorDirectory, 'validation.json'), '{"matchesExpected":true}\n');
    await assert.rejects(runReleaseVmGuestStep({
        configuration: {machines: {Ubuntu: machine({minimum: true})}},
        machineKey: 'Ubuntu',
        scenarioId: 'scenarios/ubuntu/plain',
        stepId: '002-init',
        workspaceDirectory: root,
    }, {
        guestAdapter: {run: async () => assert.fail('Guest must not run after a malformed prerequisite.')},
        workspaceBoundary: () => {},
    }), /invalid formal result/);
});

test('release run-step rejects open, redirected, or incomplete bundle records before transfer', async t => {
    /** @type {Array<(record: {bundles: {agentAssisted: string, candidate: string, plain: string}, candidateCommit: string, extra?: boolean, status: string}) => void>} */
    const cases = [
        record => { record.extra = true; },
        record => { record.bundles.candidate = join(tmpdir(), 'redirected.bundle'); },
        record => { record.status = 'partial'; },
        record => { Reflect.deleteProperty(record, 'targetCommits'); },
        record => { Reflect.set(record, 'targetCommits', {agentAssisted: '1'.repeat(40), plain: 'invalid'}); },
    ];
    for (const [index, mutate] of cases.entries()) {
        const root = await createTemporaryDirectory(t, `arw-release-invalid-bundles-${index}-`);
        const record = {
            bundles: {
                agentAssisted: join(root, 'agentAssisted.bundle'),
                candidate: join(root, 'candidate.bundle'),
                plain: join(root, 'plain.bundle'),
            },
            candidateCommit: 'a'.repeat(40),
            priorRelease: {commit: 'd'.repeat(40), tag: '0.2.1'},
            targetCommits: {agentAssisted: RELEASE_TARGETS.agentAssisted.commit, plain: RELEASE_TARGETS.plain.commit},
            status: 'prepared',
        };
        mutate(record);
        await writeFile(join(root, 'bundles.json'), `${JSON.stringify(record)}\n`);
        await Promise.all(['agentAssisted', 'candidate', 'plain'].map(name => writeFile(join(root, `${name}.bundle`), name)));
        let transferred = false;
        const guestAdapter = {
            copyToGuest: async () => { transferred = true; },
            run: async (/** @type {{ remoteArguments: string[]; }} */ request) => request.remoteArguments.at(-1) === '--version'
                ? {exitCode: 0, stderr: '', stdout: 'v24.18.0\n'}
                : {exitCode: 0, stderr: '', stdout: ''},
        };
        await assert.rejects(runReleaseVmGuestStep({
            configuration: {machines: {Ubuntu: machine({minimum: true})}},
            machineKey: 'Ubuntu',
            scenarioId: 'scenarios/ubuntu/plain',
            stepId: '001-install',
            workspaceDirectory: root,
        }, {guestAdapter, workspaceBoundary: () => {}}), /bundle record/);
        assert.equal(transferred, false);
    }
});

test('release run-step verifies every bundle ref before transfer', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-bundle-identity-');
    const record = {
        bundles: {
            agentAssisted: join(root, 'agentAssisted.bundle'),
            candidate: join(root, 'candidate.bundle'),
            plain: join(root, 'plain.bundle'),
        },
        candidateCommit: 'a'.repeat(40),
        priorRelease: {commit: 'd'.repeat(40), tag: '0.2.1'},
        targetCommits: {agentAssisted: RELEASE_TARGETS.agentAssisted.commit, plain: RELEASE_TARGETS.plain.commit},
        status: 'prepared',
    };
    await writeFile(join(root, 'bundles.json'), `${JSON.stringify(record)}\n`);
    await Promise.all(['agentAssisted', 'candidate', 'plain'].map(name => writeFile(join(root, `${name}.bundle`), name)));
    let transferred = false;
    const guestAdapter = {
        copyToGuest: async () => { transferred = true; },
        run: async (/** @type {{ remoteArguments: string[]; }} */ request) => request.remoteArguments.at(-1) === '--version'
            ? {exitCode: 0, stderr: '', stdout: 'v24.18.0\n'}
            : {exitCode: 0, stderr: '', stdout: ''},
    };
    const request = {
        configuration: {machines: {Ubuntu: machine({minimum: true})}},
        machineKey: 'Ubuntu',
        scenarioId: 'scenarios/ubuntu/plain',
        stepId: '001-install',
        workspaceDirectory: root,
    };
    /** @param {ReturnType<typeof bundleProcessAdapter>} processAdapter */
    const prepareNextScenario = processAdapter => runReleaseVmGuestStep(request, {guestAdapter, processAdapter, workspaceBoundary: () => {}});
    await assert.rejects(prepareNextScenario(bundleProcessAdapter(record.candidateCommit, (commit, key) => key === 'plain' ? 'f'.repeat(40) : commit)), /plain bundle does not identify the expected commit/);
    assert.equal(transferred, false);
    const validAdapter = bundleProcessAdapter(record.candidateCommit);
    await assert.rejects(prepareNextScenario({
        run: async request => request.arguments[0] === 'bundle' && request.arguments[1] === 'verify' && request.arguments[2] === record.bundles.plain
            ? {exitCode: 1, stderr: 'Injected corrupt bundle.', stdout: ''}
            : validAdapter.run(request),
    }), /Verify plain bundle failed/u);
    assert.equal(transferred, false);
    await rm(record.bundles.plain);
    await assert.rejects(prepareNextScenario(validAdapter), /bundle .* does not exist/u);
    assert.equal(transferred, false);
    await assert.rejects(readFile(record.bundles.plain), {code: 'ENOENT'});
});

test('release run-step rejects malformed or inconsistent guest mechanical facts', async t => {
    const cases = [
(        /** @type {{ reviewMaterial: { status: string; }; }} */ captured) => { captured.reviewMaterial.status = '*'; },
(        /** @type {{ reviewMaterial: { headToIndexDiff: string; }; }} */ captured) => { captured.reviewMaterial.headToIndexDiff = '*'; },
(        /** @type {{ changes: { changeType: string; path: string; }[]; }} */ captured) => { captured.changes = [{changeType: 'modified', path: 'README.md'}]; },
(        /** @type {{ changes: { changeType: string; path: string; }[]; reviewMaterial: { status: string; untrackedFiles: { bytes: string; path: string; }[]; }; }} */ captured) => {
            captured.changes = [{changeType: 'added', path: 'fresh.txt'}];
            captured.reviewMaterial.status = Buffer.from('?? fresh.txt\0').toString('base64');
            captured.reviewMaterial.untrackedFiles = [{bytes: '*', path: 'fresh.txt'}];
        },
(        /** @type {{ changes: { changeType: string; path: string; }[]; reviewMaterial: { status: string; nonRegularEntries: { path: string; type: string; }[]; }; }} */ captured) => {
            captured.changes = [{changeType: 'added', path: 'link'}];
            captured.reviewMaterial.status = Buffer.from('?? link\0').toString('base64');
            captured.reviewMaterial.nonRegularEntries = [{path: '../link', type: 'symbolic-link'}];
        },
    ];
    for (const [index, mutate] of cases.entries()) {
        const root = await createTemporaryDirectory(t, `arw-release-invalid-facts-${index}-`);
        await writeFile(join(root, 'bundles.json'), `${JSON.stringify({
            bundles: {
                agentAssisted: join(root, 'agentAssisted.bundle'),
                candidate: join(root, 'candidate.bundle'),
                plain: join(root, 'plain.bundle'),
            },
            candidateCommit: 'a'.repeat(40),
            priorRelease: {commit: 'd'.repeat(40), tag: '0.2.1'},
            targetCommits: {agentAssisted: RELEASE_TARGETS.agentAssisted.commit, plain: RELEASE_TARGETS.plain.commit},
            status: 'prepared',
        })}\n`);
        await Promise.all(['agentAssisted', 'candidate', 'plain'].map(name => writeFile(join(root, `${name}.bundle`), name)));
        const captured = {
            auditedDirectory: '/tmp/arw-release-validation/scenarios-ubuntu-plain/home',
            changes: [],
            machineKey: 'Ubuntu',
            reviewMaterial: {
                commandOutcome: {exitCode: 0, stderr: '', stdout: ''},
                headToIndexDiff: '',
                indexToWorkingTreeDiff: '',
                nonRegularEntries: [],
                status: '',
                untrackedFiles: [],
            },
            scenarioId: 'scenarios/ubuntu/plain',
            status: 'captured',
            stepId: '001-install',
        };
        mutate(captured);
        const guestAdapter = {
            copyToGuest: async () => {},
            run: async (/** @type {{ remoteArguments: string[]; }} */ request) => request.remoteArguments.at(-1) === '--version'
                ? {exitCode: 0, stderr: '', stdout: 'v24.18.0\n'}
                : request.remoteArguments.some((/** @type {string} */ argument) => argument.endsWith('release-guest-step.mjs'))
                    ? {exitCode: 0, stderr: '', stdout: `${JSON.stringify(captured)}\n`}
                    : {exitCode: 0, stderr: '', stdout: ''},
        };
        await assert.rejects(runReleaseVmGuestStep({
            configuration: {machines: {Ubuntu: machine({minimum: true})}},
            machineKey: 'Ubuntu',
            scenarioId: 'scenarios/ubuntu/plain',
            stepId: '001-install',
            workspaceDirectory: root,
        }, {
            guestAdapter,
            processAdapter: bundleProcessAdapter(),
            workspaceBoundary: () => {},
        }), /Release guest helper returned invalid|incomplete untracked content/);
    }
});

const gitResult = (stdout = '') => ({code: 0, failure: null, stderr: '', stdout: Buffer.from(stdout)});



test('release Git status parsing preserves staged deletion with untracked recreation as one modified path', () => {
    assert.deepEqual(parseReleaseGitStatus(Buffer.from('D  docs/agents/example.md\0?? docs/agents/example.md\0')), {
        changes: [{changeType: 'modified', path: 'docs/agents/example.md'}],
        untrackedPaths: ['docs/agents/example.md'],
    });
});

test('release guest step capture preserves command outcome, dual diff, status, and untracked bytes', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-step-');
    const auditedDirectory = join(root, 'audited');
    const workspaceDirectory = join(root, 'workspace');
    await mkdir(auditedDirectory);
    await writeFile(join(auditedDirectory, 'fresh.txt'), Buffer.from([0, 1, 2, 3]));
    /** @type {string[][]} */
    const calls = [];
    const git = {
        run: async (/** @type {{ argv: string[]; }} */ request) => {
            calls.push(request.argv);
            if (request.argv[0] === 'status') return gitResult(' M tracked.txt\0?? fresh.txt\0');
            if (request.argv[1] === '--cached') return gitResult('head-to-index');
            return gitResult('index-to-worktree');
        },
    };
    const result = await captureReleaseGuestStep({
        action: async () => ({exitCode: 7, stderr: 'expected rejection\n', stdout: ''}),
        auditedDirectory,
        machineKey: 'Alpine',
        nodeVersion: 'v24.18.0',
        scenarioId: 'scenarios/alpine/plain',
        stepId: '001-install',
        workspaceDirectory,
    }, {git});
    const template = JSON.parse(await readFile(result.templatePath, 'utf8'));
    assert.deepEqual(result.changes, [
        {changeType: 'added', path: 'fresh.txt'},
        {changeType: 'modified', path: 'tracked.txt'},
    ]);
    assert.deepEqual(template.judgment.files, [
        {changeType: 'added', matchesExpected: null, path: 'fresh.txt', summary: null},
        {changeType: 'modified', matchesExpected: null, path: 'tracked.txt', summary: null},
    ]);
    assert.deepEqual(template.mechanical.reviewMaterial.commandOutcome, {
        exitCode: 7,
        stderr: 'expected rejection\n',
        stdout: '',
    });
    assert.equal(Buffer.from(template.mechanical.reviewMaterial.headToIndexDiff, 'base64').toString(), 'head-to-index');
    assert.equal(Buffer.from(template.mechanical.reviewMaterial.indexToWorkingTreeDiff, 'base64').toString(), 'index-to-worktree');
    assert.equal(Buffer.from(template.mechanical.reviewMaterial.untrackedFiles[0].bytes, 'base64').toString('hex'), '00010203');
    assert.equal(calls.length, 3);
});

test('release guest step capture reads only untracked bytes and records non-regular types', async () => {
    const reads = stringList();
    const fileSystem = {
        lstat: async (/** @type {string} */ path) => path.endsWith('link')
            ? {isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true}
            : {isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false},
        mkdir: async () => {},
        readFile: async (/** @type {string} */ path) => {
            reads.push(path);
            return Buffer.from('untracked');
        },
        writeFile: async () => {},
    };
    const git = {
        run: async (/** @type {{ argv: string[]; }} */ request) => request.argv[0] === 'status'
            ? gitResult('A  staged.txt\0?? fresh.txt\0?? link\0')
            : gitResult(''),
    };
    const result = await captureReleaseGuestStep({
        action: async () => ({exitCode: 0, stderr: '', stdout: ''}),
        auditedDirectory: pathFor('audited'),
        machineKey: 'Windows 11',
        nodeVersion: 'v24.18.0',
        scenarioId: 'scenarios/windows/plain',
        stepId: '001-install',
        workspaceDirectory: pathFor('workspace'),
    }, {fileSystem, git});
    assert.deepEqual(result.changes, [
        {changeType: 'added', path: 'fresh.txt'},
        {changeType: 'added', path: 'link'},
        {changeType: 'added', path: 'staged.txt'},
    ]);
    assert.equal(reads.length, 1);
    assert.ok(reads[0].endsWith('fresh.txt'));
});

test('release step finalization rejects fact edits and advances the Git baseline only after a complete judgment', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-finalize-');
    const auditedDirectory = join(root, 'audited');
    const workspaceDirectory = join(root, 'workspace');
    await mkdir(auditedDirectory);
    const git = {
        run: async (/** @type {{ argv: string[]; }} */ request) => request.argv[0] === 'status'
            ? gitResult('?? fresh.txt\0')
            : gitResult(''),
    };
    await writeFile(join(auditedDirectory, 'fresh.txt'), 'fresh\n');
    const captured = await captureReleaseGuestStep({
        action: async () => ({exitCode: 0, stderr: '', stdout: 'installed\n'}),
        auditedDirectory,
        machineKey: 'Alpine',
        nodeVersion: 'v24.18.0',
        scenarioId: 'scenarios/alpine/plain',
        stepId: '001-install',
        workspaceDirectory,
    }, {git});
    const template = JSON.parse(await readFile(captured.templatePath, 'utf8'));
    template.mechanical.auditedDirectory = '/tmp/arw-release-validation/scenarios-alpine-plain/home';
    template.judgment = {
        files: [{changeType: 'added', matchesExpected: true, path: 'fresh.txt', summary: 'Expected installed file.'}],
        matchesExpected: true,
        summary: 'Installation matched the expected result.',
    };
    const judgmentPath = join(workspaceDirectory, 'judgment.json');
    await writeFile(captured.templatePath, `${JSON.stringify({...template, judgment: {
        files: [{changeType: 'added', matchesExpected: null, path: 'fresh.txt', summary: null}],
        matchesExpected: null,
        summary: null,
    }})}\n`);
    await writeFile(judgmentPath, `${JSON.stringify(template)}\n`);
    let addCalls = 0;
    let renameAttempts = 0;
    const result = await finalizeReleaseGuestStep({judgmentPath, templatePath: captured.templatePath}, {
        fileSystem: {
            lstat,
            mkdir,
            readFile,
            rename: async (/** @type {string} */ source, /** @type {string} */ target) => {
                renameAttempts += 1;
                if (renameAttempts < 3) throw Object.assign(new Error('Injected EPERM rename failure.'), {code: 'EPERM'});
                return rename(source, target);
            },
            rm,
            writeFile,
        },
        gitFactory: () => ({run: async (/** @type {TestRequest} */ request) => {
            assert.deepEqual(request.argv, ['add', '-A']);
            addCalls += 1;
            return gitResult('');
        }}),
        workspaceBoundary: () => {},
    });
    assert.equal(addCalls, 1);
    assert.equal(renameAttempts, 3);
    assert.deepEqual(JSON.parse(await readFile(result.validationPath, 'utf8')), {
        exitCode: 0,
        files: template.judgment.files,
        matchesExpected: true,
        summary: 'Installation matched the expected result.',
    });

    const tamperedPath = join(workspaceDirectory, 'tampered.json');
    template.mechanical.changes[0].path = 'different.txt';
    await writeFile(tamperedPath, `${JSON.stringify(template)}\n`);
    await assert.rejects(
        finalizeReleaseGuestStep({judgmentPath: tamperedPath, templatePath: captured.templatePath}, {workspaceBoundary: () => {}}),
        /mechanical facts changed/,
    );
    assert.equal(addCalls, 1);
});

test('release step finalization revalidates template facts, audited location, and session workspace', async t => {
    const cases = [
(        /** @type {{ mechanical: { reviewMaterial: { status: string; }; }; }} */ template) => { template.mechanical.reviewMaterial.status = '*'; },
(        /** @type {{ mechanical: { auditedDirectory: string; }; }} */ template) => { template.mechanical.auditedDirectory = '/tmp/arbitrary-repository'; },
(        /** @type {{ mechanical: { workspaceDirectory: string; }; }} */ template) => { template.mechanical.workspaceDirectory = join(tmpdir(), 'redirected-workspace'); },
    ];
    for (const [index, mutate] of cases.entries()) {
        const root = await createTemporaryDirectory(t, `arw-release-template-trust-${index}-`);
        const workspaceDirectory = join(root, 'workspace');
        const auditedDirectory = join(root, 'audited');
        await mkdir(auditedDirectory);
        const captured = await captureReleaseGuestStep({
            action: async () => ({exitCode: 0, stderr: '', stdout: ''}),
            auditedDirectory,
            machineKey: 'Alpine',
            nodeVersion: 'v24.18.0',
            scenarioId: 'scenarios/alpine/plain',
            stepId: '001-install',
            workspaceDirectory,
        }, {git: {run: async () => gitResult('')}});
        const template = JSON.parse(await readFile(captured.templatePath, 'utf8'));
        template.mechanical.auditedDirectory = '/tmp/arw-release-validation/scenarios-alpine-plain/home';
        template.judgment = {files: [], matchesExpected: true, summary: 'Expected result.'};
        mutate(template);
        await writeFile(captured.templatePath, `${JSON.stringify({...template, judgment: {
            files: [], matchesExpected: null, summary: null,
        }})}\n`);
        const judgmentPath = join(workspaceDirectory, 'judgment.json');
        await writeFile(judgmentPath, `${JSON.stringify(template)}\n`);
        const sessionBoundary = (/** @type {string} */ value) => {
            const expectedRoot = `${join(root, 'workspace')}\\`;
            if (`${value}\\`.startsWith(expectedRoot) === false) throw new Error('outside current session workspace');
        };
        await assert.rejects(
            finalizeReleaseGuestStep({judgmentPath, templatePath: captured.templatePath}, {workspaceBoundary: sessionBoundary}),
            /invalid mechanical facts|invalid Git status bytes|unexpected audited directory|current session workspace/,
        );
    }
});

test('initialization issue completion requires strict ordinary issue parsing, completed criteria, and validation evidence', async t => {
    const root = await createRepository(t, {prefix: 'arw-release-init-issue-'});
    const issueDirectory = join(root, '.scratch', '0001-initialization', 'issues');
    await mkdir(issueDirectory, {recursive: true});
    const issuePath = join(issueDirectory, '01-complete-init.md');
    await assert.rejects(
        requireCompletedInitializationIssue({targetDirectory: root}),
        /create and complete exactly one/,
    );
    const complete = '# Complete init\n\nStatus: completed\n\n## Acceptance criteria\n\n- [x] Verify initialized files.\n\n## Blocked by\n\n- None\n\n## Validation\n\n- Full Repository diff matched the initialization expectation.\n';
    await writeFile(issuePath, complete.replace('Status: completed', 'Status: needs-info'));
    await assert.rejects(
        requireCompletedInitializationIssue({targetDirectory: root}),
        /has not been completed/,
    );
    await writeFile(issuePath, complete);
    await assert.doesNotReject(requireCompletedInitializationIssue({targetDirectory: root}));
    await writeFile(issuePath, complete.replace('## Validation', '## Completion evidence'));
    await assert.rejects(requireCompletedInitializationIssue({targetDirectory: root}), /exact ## Validation heading/);
    await writeFile(issuePath, complete);
    await runGit(root, ['add', '-A']);
    await runGit(root, ['-c', 'user.name=ARW Test', '-c', 'user.email=arw@example.invalid', 'commit', '--quiet', '-m', 'existing issue']);
    await writeFile(issuePath, complete.replace('Complete init', 'Modified init'));
    await assert.rejects(requireCompletedInitializationIssue({targetDirectory: root}), /create and complete exactly one/);
});

test('release guest helper direct execution enters its CLI main path from a URL-sensitive path', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-guest-main-');
    const sourceRoot = join(root, 'source#copy');
    await mkdir(join(sourceRoot, 'scripts'), {recursive: true});
    await cp(join(process.cwd(), 'lib'), join(sourceRoot, 'lib'), {recursive: true});
    await copyFile(join(process.cwd(), 'package.json'), join(sourceRoot, 'package.json'));
    const helperPath = join(sourceRoot, 'scripts', 'release-guest-step.mjs');
    await copyFile(join(process.cwd(), 'scripts', 'release-guest-step.mjs'), helperPath);
    const result = await runExitedProcess(process.execPath, [helperPath, '--invalid']);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /Release guest helper arguments are invalid\./);
});

test('release guest helper supplies deterministic empty tree input when the audit Repository has no HEAD', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-empty-tree-');
    const sourceDirectory = join(root, 'source');
    const homeDirectory = join(root, 'home');
    await Promise.all([mkdir(sourceDirectory), mkdir(homeDirectory)]);
    await runGit(homeDirectory, ['init', '--quiet']);
    await mkdir(join(root, 'runner-state'));
    await writeFile(join(root, 'runner-state', 'scenario-preparation.json'), `${JSON.stringify({
        commit: 'a'.repeat(40),
        fixturesDirectory: join(root, 'version-fixtures'),
        homeDirectory,
        installationAuditDirectory: homeDirectory,
        machineKey: 'Ubuntu',
        scenarioId: 'observations/ubuntu/floor',
        scenarioRoot: root,
        schemaVersion: 2,
        sourceDirectory,
        tag: ARW_VERSION,
        targetDirectory: join(root, 'target'),
        targetKind: null,
    })}\n`);
    const result = await runSuccessfulProcess(process.execPath, [
        join(process.cwd(), 'scripts', 'release-guest-step.mjs'),
        '--machine', 'Ubuntu',
        '--scenario', 'observations/ubuntu/floor',
        '--step', '001-check-esm-syntax',
        '--workspace', root,
        '--scenario-prepared', 'true',
        '--observe-only', 'true',
        '--capture-id', '00000000-0000-4000-8000-000000000001',
    ], {timeout: 10_000});
    const captured = JSON.parse(result.stdout);
    assert.equal(captured.status, 'captured');
    assert.deepEqual(captured.reviewMaterial, {
        headToIndexDiff: '',
        indexToWorkingTreeDiff: '',
        nonRegularEntries: [],
        status: '',
        untrackedFiles: [],
    });
});

test('release guest helper runs installed Windows cmd launchers through a supported process boundary', {
    skip: process.platform !== 'win32',
}, async t => {
    const parent = await createTemporaryDirectory(t, 'arw-release-windows-cmd-');
    const root = join(parent, 'workspace with space');
    await mkdir(root);
    const bundleSource = join(root, 'bundle-source');
    await createCurrentReleaseBundle({bundlePath: join(root, 'candidate.bundle'), sourceDirectory: bundleSource});
    const sourceDirectory = join(root, 'source');
    await runGit(root, ['clone', '--quiet', '--branch', 'arw-validation', join(root, 'candidate.bundle'), sourceDirectory]);
    const version = JSON.parse(await readFile(join(sourceDirectory, 'package.json'), 'utf8')).version;
    await runGit(sourceDirectory, ['tag', version, 'HEAD']);
    const homeDirectory = join(root, 'home');
    const installationDirectory = join(homeDirectory, '.agent-repository-workflow');
    await mkdir(installationDirectory, {recursive: true});
    await writeFile(join(installationDirectory, 'arw.cmd'), [
        '@echo off',
        'echo launcher-stderr 1>&2',
        'echo launcher-stdout',
        'exit /b 7',
        '',
    ].join('\r\n'));
    await runGit(homeDirectory, ['init', '--quiet']);
    await runGit(homeDirectory, ['add', '-A']);
    const runStep = async (/** @type {string} */ stepId) => runSuccessfulProcess(process.execPath, [
        join(process.cwd(), 'scripts', 'release-guest-step.mjs'),
        '--machine', 'Windows 11',
        '--scenario', 'observations/windows/recommended',
        '--step', stepId,
        '--workspace', root,
    ], {timeout: 10_000});
    for (const stepId of ['014-verify-installed-command', '015-verify-source-unavailable']) {
        const captured = JSON.parse((await runStep(stepId)).stdout);
        assert.deepEqual(captured.reviewMaterial.commandOutcome, {
            exitCode: 7,
            stderr: 'launcher-stderr \r\n',
            stdout: 'launcher-stdout\r\n',
        });
        await runGit(homeDirectory, ['add', '-A']);
    }
});

test('release PowerShell launcher check selects only the expected installed cmd launcher', async t => {
    if (process.platform !== 'win32') {
        t.skip('Windows PowerShell launcher behavior is Windows-only.');
        return;
    }
    const {buildWindowsPowerShellLauncherScript} = await import('../../scripts/release-guest-step.mjs');
    assert.equal(typeof buildWindowsPowerShellLauncherScript, 'function');
    const homeDirectory = await createTemporaryDirectory(t, 'arw-release-powershell-launcher-');
    const installationDirectory = join(homeDirectory, '.agent-repository-workflow');
    await mkdir(installationDirectory);
    await writeFile(join(installationDirectory, 'arw'), '#!/usr/bin/env sh\n');
    await writeFile(join(installationDirectory, 'arw.cmd'), '@echo off\r\necho powershell-launcher\r\n');
    const environment = Object.fromEntries(Object.entries(process.env)
        .filter(([key]) => key.toLowerCase() !== 'path'));
    environment.Path = `${installationDirectory};${process.env.Path ?? ''}`;
    environment.USERPROFILE = homeDirectory;
    const result = await runSuccessfulProcess('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        buildWindowsPowerShellLauncherScript(homeDirectory),
    ], {env: environment});
    assert.deepEqual(result.stdout.split(/\r?\n/u).filter(Boolean), [
        join(installationDirectory, 'arw.cmd'),
        'powershell-launcher',
    ]);
});



test('release workflow plan capture stops each operation before apply', async () => {
    /** @type {WorkflowRunnerOptions[]} */
    const calls = [];
    const profile = {
        codeMaps: {excludes: [], includes: [], roots: []},
        domainLayout: 'single-context',
        platforms: ['claude-code', 'codex'],
    };
    const workflowRunner = async (/** @type {WorkflowRunnerOptions} */ options) => {
        calls.push(options);
        if (options.operation === 'remove') assert.deepEqual(options.choices.removal, {arwignore: 'delete'});
        await options.beforeApply({canonical: JSON.stringify({
            ...(options.operation === 'remove' ? {
                categories: {
                    arwignore: {paths: ['.arwignore']},
                    'code-maps': {paths: []},
                    'mixed-agent-documents': {paths: []},
                    'platform-agent-configs': {paths: []},
                },
                choices: options.choices.removal,
            } : {}),
            diagnostics: [],
            operation: options.operation,
            operations: options.operation === 'remove'
                ? [{action: 'delete-lock', path: 'arw-lock.json'}]
                : [{action: 'write-lock', bytes: 'bG9jaw==', path: 'arw-lock.json'}],
            profile,
        })});
        assert.fail('The release workflow plan capture must stop before apply.');
    };
    const state = {
        homeDirectory: pathFor('home'),
        targetDirectory: pathFor('target'),
        targetKind: 'plain',
    };
    const capturePlan = createReleaseWorkflowPlanCapture({workflowRunner});
    const init = await capturePlan({
        choices: {profile: 'plain'},
        state,
        stepId: '002-init',
    });
    const remove = await capturePlan({
        choices: {
            arwignore: 'delete',
        },
        state,
        stepId: '005-workflow-remove',
    });
    assert.equal(init.operation, 'init');
    assert.deepEqual(init.operations, [{action: 'write', bytes: 'bG9jaw==', path: 'arw-lock.json'}]);
    assert.deepEqual(init.profile, profile);
    assert.equal(remove.operation, 'remove');
    assert.deepEqual(remove.operations, [{action: 'delete', path: 'arw-lock.json'}]);
    assert.deepEqual(remove.profile, profile);
    assert.deepEqual(calls.map(call => ({
        choices: call.choices,
        distributionDirectory: call.distributionDirectory,
        operation: call.operation,
        repositoryRoot: call.repositoryRoot,
    })), [
        {
            choices: {
                mode: 'non-interactive',
                platforms: ['codex', 'claude-code'],
                profile: {
                    codeMaps: {excludes: [], includes: [], roots: []},
                    domainLayout: 'single-context',
                    platforms: ['codex', 'claude-code'],
                },
            },
            distributionDirectory: join(pathFor('home'), '.agent-repository-workflow', 'distribution'),
            operation: 'init',
            repositoryRoot: pathFor('target'),
        },
        {
            choices: {
                mode: 'non-interactive',
                removal: {
                    arwignore: 'delete',
                },
            },
            distributionDirectory: join(pathFor('home'), '.agent-repository-workflow', 'distribution'),
            operation: 'remove',
            repositoryRoot: pathFor('target'),
        },
    ]);
});

test('release workflow plan capture admits native removal without role seeds before applying changes', async () => {
    const repositoryRoot = pathFor('target');
    const profile = {codeMaps: {excludes: [], includes: [], roots: []}, domainLayout: 'single-context', platforms: ['claude-code', 'codex']};
    const lock = {lockSchemaVersion: 2, managedTargets: [], profile, repositoryOwnedSeeds: [
        {kind: 'file', ownership: 'repository-owned-seed', path: '.arwignore', strategy: 'regular-file'},
    ]};
    const files = {
        '.arwignore': {bytes: Buffer.from('scope\n'), observed: {kind: 'file'}},
        'arw-lock.json': {bytes: Buffer.from(serializeWorkflowLock(lock)), observed: {kind: 'file'}},
    };
    const capturePlan = createReleaseWorkflowPlanCapture({
        workflowRunner: async (/** @type {WorkflowRunnerOptions} */ options) => invokeTestBoundary(runRepositoryWorkflow, [{
            ...options,
            repositoryStateInspector: {inspect: async () => ({
                files, git: {conflicts: [], excludedPaths: [], staged: [], tracked: [], untracked: [], unstaged: []},
                lock: {bytes: files['arw-lock.json'].bytes, lock}, policy: {kind: 'file'}, repositoryRoot, request: {paths: []},
            })},
        }]),
    });
    const plan = await capturePlan({choices: {arwignore: 'delete'},
        state: {homeDirectory: pathFor('home'), targetDirectory: repositoryRoot, targetKind: 'plain'}, stepId: '005-workflow-remove'});
    assert.equal(plan.operation, 'remove');
    assert.deepEqual(plan.operations, [{action: 'delete', path: '.arwignore'}, {action: 'delete', path: 'arw-lock.json'}]);
    assert.equal(files['.arwignore'].bytes.toString(), 'scope\n');
});

test('release workflow plan capture rejects invalid frozen inputs and invalid plan fields', async () => {
    const profile = {
        codeMaps: {excludes: [], includes: [], roots: []},
        domainLayout: 'single-context',
        platforms: ['claude-code', 'codex'],
    };
    const state = {
        homeDirectory: pathFor('home'),
        targetDirectory: pathFor('target'),
        targetKind: 'plain',
    };
    const rejectInput = createReleaseWorkflowPlanCapture({
        workflowRunner: async () => assert.fail('Invalid frozen input must not start the Workflow Runner.'),
    });
    for (const invalidInput of [
        {choices: null, state, stepId: '002-init'},
        {choices: {extra: true, profile: 'plain'}, state, stepId: '002-init'},
        {choices: {profile: 'agent-assisted'}, state, stepId: '002-init'},
        {choices: {profile: 'plain'}, state: {...state, targetKind: 'unknown'}, stepId: '002-init'},
    ]) {
        await assert.rejects(rejectInput(invalidInput), TypeError);
    }
    const plans = [
        {diagnostics: [], operation: 'init', operations: [], profile: null},
        {diagnostics: [], distribution: 'digest', operation: 'init', operations: [], profile},
        {diagnostics: [], operation: 'init', operations: [], profile: {...profile, domainLayout: 'unsupported'}},
        {diagnostics: [], operation: 'init', operations: [], profile: {...profile, platforms: ['codex', 'claude-code']}},
        {diagnostics: [], operation: 'init', operations: [], profile: {...profile, codeMaps: {...profile.codeMaps, roots: ['../outside']}}},
        {
            diagnostics: [],
            operation: 'init',
            operations: [{action: 'write-lock', bytes: 'bG9jaw==', digest: 'extra', path: 'arw-lock.json'}],
            profile,
        },
    ];
    for (const plan of plans) {
        const capturePlan = createReleaseWorkflowPlanCapture({
            workflowRunner: async (/** @type {WorkflowRunnerOptions} */ options) => {
                await options.beforeApply({canonical: JSON.stringify(plan)});
                assert.fail('The release workflow plan capture must stop before apply.');
            },
        });
        await assert.rejects(capturePlan({choices: {profile: 'plain'}, state, stepId: '002-init'}), Error);
    }
    const captureProfilelessRemove = createReleaseWorkflowPlanCapture({
        workflowRunner: async (/** @type {WorkflowRunnerOptions} */ options) => {
            await options.beforeApply({canonical: JSON.stringify({
                categories: {
                    arwignore: {paths: ['.arwignore']},
                    'code-maps': {paths: []},
                    'mixed-agent-documents': {paths: []},
                    'platform-agent-configs': {paths: []},
                },
                choices: options.choices.removal,
                diagnostics: [],
                operation: 'remove',
                operations: [{action: 'delete-lock', path: 'arw-lock.json'}],
            })});
            assert.fail('The release workflow plan capture must stop before apply.');
        },
    });
    await assert.rejects(captureProfilelessRemove({
        choices: {
            arwignore: 'delete',
            mixedAgentDocuments: 'delete',
        },
        state,
        stepId: '005-workflow-remove',
    }), /invalid/u);
    const captureUnregistered = createReleaseWorkflowPlanCapture({workflowRunner: async () => assert.fail('Unregistered steps must not start the Workflow Runner.')});
    await assert.rejects(
        captureUnregistered({choices: {profile: 'plain'}, state, stepId: '999-init'}),
        /not registered/u,
    );
});

test('release workflow plan capture reports only bounded preflight diagnostic codes', async () => {
    const state = {
        homeDirectory: pathFor('home'),
        targetDirectory: pathFor('target'),
        targetKind: 'agent-assisted',
    };
    const capturePlan = createReleaseWorkflowPlanCapture({
        workflowRunner: async () => ({
            applied: false,
            authorized: false,
            diagnostics: [
                {code: 'inapplicable-removal-choice', message: 'secret repository detail'},
                {code: 'inapplicable-removal-choice', message: 'duplicate secret'},
                {code: `invalid-${'x'.repeat(80)}`, message: 'oversized secret'},
            ],
        }),
    });
    await assert.rejects(
        capturePlan({
            choices: {
                arwignore: 'delete',
                codeMaps: 'retain',
                mixedAgentDocuments: 'delete',
            },
            state,
            stepId: '007-workflow-remove',
        }),
        error => {
            const capturedError = requireError(error);
            assert.equal(capturedError.message, 'Release workflow plan could not be captured before apply. Diagnostics: inapplicable-removal-choice.');
            assert.equal(capturedError.message.includes('secret'), false);
            return true;
        },
    );
});

test('release guest failure summary retains a bounded cause and redacts VM credentials', () => {
    const identityFile = pathFor('identity');
    const hostKey = 'ssh-ed25519 AAAA release-fixture';
    const vmwareEncryptionPassword = 'vmware-secret';
    const guestPasswords = {administrator: 'windows-secret', root: 'guest-secret'};
    const summary = releaseGuestFailureSummary(
        new Error(`Release workflow plan failed at init. ${identityFile} ${hostKey} ${vmwareEncryptionPassword} ${guestPasswords.administrator} ${guestPasswords.root} ${'x'.repeat(1000)}`),
        {guestPasswords, ssh: {hostKey, identityFile}, vmwareEncryptionPassword},
    );
    assert.match(summary, /^The guest release validation step could not be captured: Release workflow plan failed at init\./u);
    assert.equal(summary.includes(identityFile), false);
    assert.equal(summary.includes(hostKey), false);
    assert.equal(summary.includes(vmwareEncryptionPassword), false);
    assert.equal(summary.includes(guestPasswords.administrator), false);
    assert.equal(summary.includes(guestPasswords.root), false);
    assert.equal(summary.includes('[redacted]'), true);
    assert.ok(summary.length <= 576);
    assert.equal(
        releaseGuestFailureSummary('not-an-error', {guestPasswords, ssh: {hostKey, identityFile}, vmwareEncryptionPassword}),
        'The guest release validation step could not be captured.',
    );
});



test('release guest floor syntax validation uses separate processes because Node.js check accepts one entry path', async t => {
    const homeDirectory = await createTemporaryDirectory(t, 'arw-release-syntax-home-');
    const result = await checkLifecycleEntries({homeDirectory, sourceDirectory: process.cwd()});
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), RELEASE_ESM_LIFECYCLE_ENTRIES.map(path => ({
        exitCode: 0,
        path,
        stderr: '',
        stdout: '',
    })));
});

test('release guest floor syntax validation retains all five outcomes after an early failure', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-syntax-failure-');
    await mkdir(join(root, 'scripts'));
    await writeFile(join(root, 'install.mjs'), 'export {\n');
    for (const path of [
        'arw.mjs',
        'uninstall.mjs',
        'scripts/prepare-release-version-fixtures.mjs',
        'scripts/release-guest-step.mjs',
    ]) await writeFile(join(root, ...path.split('/')), 'export {};\n');
    const result = await checkLifecycleEntries({homeDirectory: root, sourceDirectory: root});
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stderr, '');
    const outcomes = JSON.parse(result.stdout);
    assert.deepEqual(outcomes.map((/** @type {{path: string}} */ outcome) => outcome.path), RELEASE_ESM_LIFECYCLE_ENTRIES);
    assert.notEqual(outcomes[0].exitCode, 0);
    assert.match(outcomes[0].stderr, /SyntaxError/u);
    assert.equal(outcomes.slice(1).every((/** @type {{ exitCode: number; stderr: string; stdout: string; }} */ outcome) => outcome.exitCode === 0
        && outcome.stderr === '' && outcome.stdout === ''), true);
});

test('release guest checkout reuse requires exact bundle identity and a clean candidate source', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-guest-checkout-');
    const source = join(root, 'source');
    const checkout = join(root, 'checkout');
    const firstBundle = join(root, 'first.bundle');
    const secondBundle = join(root, 'second.bundle');
    await mkdir(source);
    await runGit(source, ['init', '--quiet']);
    await writeFile(join(source, 'README.md'), 'first\n');
    await runGit(source, ['add', '-A']);
    await runGit(source, ['-c', 'user.name=ARW Test', '-c', 'user.email=arw@example.invalid', 'commit', '--quiet', '-m', 'first']);
    await runGit(source, ['branch', 'arw-validation', 'HEAD']);
    await runGit(source, ['bundle', 'create', firstBundle, 'refs/heads/arw-validation']);
    await assert.doesNotReject(cloneBundle(firstBundle, checkout, {requireClean: true}));
    assert.equal((await runGit(checkout, ['config', '--local', '--get', 'core.longpaths'])).stdout.trim(), 'true');
    assert.equal((await runGit(checkout, ['config', '--local', '--get', 'core.autocrlf'])).stdout.trim(), 'false');
    await writeFile(join(checkout, 'untracked.txt'), 'drift\n');
    await assert.rejects(cloneBundle(firstBundle, checkout, {requireClean: true}), /not clean/);
    await rm(join(checkout, 'untracked.txt'));
    await writeFile(join(source, 'README.md'), 'second\n');
    await runGit(source, ['add', '-A']);
    await runGit(source, ['-c', 'user.name=ARW Test', '-c', 'user.email=arw@example.invalid', 'commit', '--quiet', '-m', 'second']);
    await runGit(source, ['branch', '--force', 'arw-validation', 'HEAD']);
    await runGit(source, ['bundle', 'create', secondBundle, 'refs/heads/arw-validation']);
    await assert.rejects(cloneBundle(secondBundle, checkout), /does not identify the transferred bundle commit/);
});

test('release guest baseline stages all changes while preserving staged history relative to HEAD', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-guest-baseline-');
    await writeFile(join(root, 'first.txt'), 'first\n');
    assert.equal(await initializeGitBaseline(root), true);
    await writeFile(join(root, 'first.txt'), 'changed\n');
    await writeFile(join(root, 'second.txt'), 'second\n');
    await assert.rejects(initializeGitBaseline(root), /baseline verification|retains untracked/);
    await runGit(root, ['add', '-A']);
    assert.equal(await initializeGitBaseline(root), false);
    const status = await runGit(root, ['status', '--porcelain=v1', '--untracked-files=all']);
    assert.match(status.stdout, /^A  first\.txt\r?\nA  second\.txt\r?\n$/);
    await runGit(root, ['diff', '--quiet']);
    assert.equal((await runGit(root, ['ls-files', '--others', '--exclude-standard'])).stdout, '');
});

test('VM release step finalization advances the baseline in the bound guest only', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-vm-finalize-');
    const auditedDirectory = join(root, 'host-audited');
    const workspaceDirectory = join(root, 'workspace');
    await mkdir(auditedDirectory);
    const git = {run: async (/** @type {{ argv: string[]; }} */ request) => request.argv[0] === 'status' ? gitResult('') : gitResult('')};
    const captured = await captureReleaseGuestStep({
        action: async () => ({exitCode: 0, stderr: '', stdout: ''}),
        auditedDirectory,
        machineKey: 'Alpine',
        nodeVersion: 'v24.18.0',
        scenarioId: 'scenarios/alpine/plain',
        stepId: '001-install',
        workspaceDirectory,
    }, {git});
    const submitted = JSON.parse(await readFile(captured.templatePath, 'utf8'));
    submitted.mechanical.auditedDirectory = '/tmp/arw-release-validation/scenarios-alpine-plain/home';
    const originalTemplate = JSON.parse(await readFile(captured.templatePath, 'utf8'));
    originalTemplate.mechanical.auditedDirectory = '/tmp/arw-release-validation/scenarios-alpine-plain/home';
    await writeFile(captured.templatePath, `${JSON.stringify(originalTemplate)}\n`);
    submitted.judgment = {files: [], matchesExpected: true, summary: 'Guest step matched expectations.'};
    const judgmentPath = join(workspaceDirectory, 'judgment.json');
    await writeFile(judgmentPath, `${JSON.stringify(submitted)}\n`);
    const calls = testRecords();
    await assert.rejects(finalizeReleaseVmGuestStep({
        configuration: {machines: {Alpine: machine()}},
        judgmentPath,
        templatePath: captured.templatePath,
    }, {
        guestAdapter: {run: async () => ({stderr: '', stdout: ''})},
        workspaceBoundary: () => {},
    }), /invalid process result/);
    const result = await finalizeReleaseVmGuestStep({
        configuration: {machines: {Alpine: machine()}},
        judgmentPath,
        templatePath: captured.templatePath,
    }, {
        guestAdapter: {run: async (/** @type {TestRequest} */ request) => {
            calls.push(request);
            return {exitCode: 0, stderr: '', stdout: ''};
        }},
        workspaceBoundary: () => {},
    });
    assert.equal(result.status, 'finalized');
    assert.deepEqual(calls[0].remoteArguments, ['git', '-C', '/tmp/arw-release-validation/scenarios-alpine-plain/home', 'add', '-A']);
});

test('release step finalization preserves an existing archive after exclusive-create failure', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-existing-archive-');
    const workspaceDirectory = join(root, 'workspace');
    const auditedDirectory = join(root, 'audited');
    await mkdir(auditedDirectory);
    const scenarioId = 'observations/ubuntu/floor';
    const stepId = '005-verify-final-state';
    const scenario = requireValue(
        listReleaseValidationScenarios().find((/** @type {TestScenario} */ candidate) => candidate.archiveKind === scenarioId),
        'Expected Ubuntu floor scenario.',
    );
    const captured = await captureReleaseGuestStep({
        action: async () => undefined,
        auditedDirectory,
        machineKey: 'Ubuntu',
        nodeVersion: 'v24.18.0',
        scenarioId,
        stepId,
        workspaceDirectory,
    }, {git: {run: async () => gitResult('')}});
    const template = JSON.parse(await readFile(captured.templatePath, 'utf8'));
    template.mechanical.auditedDirectory = '/tmp/arw-release-validation/observations-ubuntu-floor/home';
    const original = {...template, judgment: {files: [], matchesExpected: null, summary: null}};
    await writeFile(captured.templatePath, `${JSON.stringify(original)}\n`);
    template.judgment = {files: [], matchesExpected: true, summary: 'Expected final-state result.'};
    const judgmentPath = join(workspaceDirectory, 'judgment.json');
    await writeFile(judgmentPath, `${JSON.stringify(template)}\n`);
    for (const step of scenario.steps.slice(0, -1)) {
        const validationPath = join(workspaceDirectory, 'archive-source', ...scenarioId.split('/'), 'steps', step.stepId, 'validation.json');
        await mkdir(dirname(validationPath), {recursive: true});
        await writeFile(validationPath, `${JSON.stringify({files: [], matchesExpected: true, summary: 'Expected prior result.'})}\n`);
    }
    const archivePath = join(workspaceDirectory, 'archives', ...scenarioId.split('/')) + '.tar';
    await mkdir(dirname(archivePath), {recursive: true});
    await writeFile(archivePath, 'existing archive\n');
    await assert.rejects(finalizeReleaseGuestStep({judgmentPath, templatePath: captured.templatePath}, {
        baselineUpdater: async () => {},
        createArchive: async () => { throw new Error('Archive output already exists.'); },
        workspaceBoundary: () => {},
    }), /already exists/);
    assert.equal(await readFile(archivePath, 'utf8'), 'existing archive\n');
});

test('release guest archive comparison accepts identical bytes and rejects a changed transfer', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-guest-archive-');
    const archivePath = join(root, 'archive.tar');
    const sourceDirectory = join(root, 'formal-source');
    await mkdir(sourceDirectory);
    await writeFile(archivePath, 'canonical archive bytes\n');
    const calls = testRecords();
    const guestAdapter = {
        copyDirectoryToGuest: async (/** @type {TestRequest} */ request) => calls.push({kind: 'directory', request}),
        copyFromGuest: async (/** @type {{ hostPath: import("fs").PathLike; }} */ request) => {
            calls.push({kind: 'archive', request});
            await copyFile(archivePath, request.hostPath);
        },
        run: async (/** @type {TestRequest} */ request) => {
            calls.push({kind: 'run', request});
            return {exitCode: 0, stderr: '', stdout: ''};
        },
    };
    const request = {
        archivePath,
        configuration: {machines: {Ubuntu: machine({minimum: true})}},
        guestAdapter,
        mechanical: {
            machineKey: 'Ubuntu',
            scenarioId: 'scenarios/ubuntu/plain',
            workspaceDirectory: root,
        },
        sourceDirectory,
    };
    await assert.doesNotReject(compareReleaseGuestArchive(request));
    await assert.rejects(readFile(`${archivePath}.guest-comparison`), error => (
        error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
    ));
    assert.equal(calls.filter(call => call.kind === 'directory').length, 1);
    const changedGuestAdapter = {
        ...guestAdapter,
        copyFromGuest: async (/** @type {{ hostPath: import("fs").PathLike | import("fs/promises").FileHandle; }} */ requestValue) => writeFile(requestValue.hostPath, 'changed archive bytes\n'),
    };
    await assert.rejects(compareReleaseGuestArchive({...request, guestAdapter: changedGuestAdapter}), /SHA-256 values differ/);
    await assert.rejects(readFile(`${archivePath}.guest-comparison`), error => (
        error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
    ));
});
