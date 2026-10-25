import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    rename,
    rm,
    writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, isAbsolute, join, resolve, win32} from 'node:path';

import {
    RELEASE_MACHINE_KEYS,
    RELEASE_ESM_LIFECYCLE_ENTRIES,
    RELEASE_POST_INIT_SCENARIO_ID,
    listPreTagArchiveKinds,
    listReleaseValidationScenarios,
    resolveReleaseValidationRegistry,
    resolveReleaseValidationRuntimeRole,
    resolveReleaseValidationScenario,
    resolveReleaseValidationStep,
} from './release-validation-registry.mjs';
import {
    loadReleaseValidationConfiguration,
    renderVmwareCompatibilityStdout,
    validateReleaseValidationConfiguration,
} from './release-validation-config.mjs';
import {createNodeGitRunner} from '../common/git-process.mjs';
import {loadReleaseValidationSources, prepareValidationSnapshotBundle} from './release-validation-sources.mjs';
import {
    joinRelativePath,
    resolveAbsolutePathWithinScope,
    resolveRelativePathWithinScope,
} from '../common/filesystem.mjs';
import {
    createReleaseEvidenceArchive,
    verifyReleaseEvidenceArchive,
} from './release-evidence-archive.mjs';
import {
    inspectReleaseUntrackedEntries,
    isSafeReleaseRelativePath,
    parseReleaseGitStatus,
} from './release-step-review-material.mjs';
import {ARW_VERSION, compareStableArwVersions, parseArwVersion} from '../arw-common/identity.mjs';
import {resolveTemporaryWorkspace} from '../arw-common/temporary-workspace.mjs';
import {parseWorkflowLock} from '../repository-workflow/workflow-lock.mjs';

/** @typedef {Record<string, unknown>} JsonObject */
/** @typedef {Pick<typeof import('node:fs/promises'), 'lstat' | 'mkdir' | 'readFile' | 'rename' | 'rm' | 'writeFile'>} FileSystem */
/** @typedef {{exitCode: number, stderr: string, stdout: string}} ProcessObservation */
/** @typedef {{arguments: string[], cwd: string, executable: string, input?: string | Uint8Array, timeoutMs?: number}} ProcessRequest */
/** @typedef {{run: (request: ProcessRequest) => Promise<ProcessObservation>}} HostProcessAdapter */
/** @typedef {(value: string, label?: string) => void} WorkspaceBoundary */
/** @typedef {{guestPasswords?: Readonly<Record<string, string>>, location: string, machineType: 'VMware', nodeExecutables: Readonly<Record<string, string>>, snapshot: string, ssh: Readonly<{hostKey: string, identityFile: string, port: number, user: string}>, vmrun: string, vmwareEncryptionPassword?: string}} VmMachine */
/** @typedef {{machines: Readonly<Record<string, Readonly<VmMachine>>>, maxParallelMachines: number, schemaVersion: 2}} VmConfiguration */
/** @typedef {{initializationIssueScenario: string, prepareBundles: {hostCommandTimeoutMs: number}, repositories: {sourceCheckout: {url: string}}, vmware: {hardPowerOffCompatibility: {exitCode: number, stderr: string, stdoutTemplate: string, vmrunVersion: string}, softPowerOffTimeoutMs: Record<string, number>}}} ReleaseConfiguration */
/** @typedef {{copyDirectoryToGuest: (input: {guestPath: string, hostPath: string, machine: VmMachine, machineKey: string, workspaceDirectory: string}) => Promise<void>, copyFromGuest: (input: {guestPath: string, hostPath: string, machine: VmMachine, machineKey: string, workspaceDirectory: string}) => Promise<void>, copyToGuest: (input: {guestPath: string, hostPaths: string[], machine: VmMachine, machineKey: string, workspaceDirectory: string}) => Promise<void>, run: (input: {machine: VmMachine, machineKey: string, remoteArguments: string[], workspaceDirectory: string}) => Promise<ProcessObservation>}} GuestAdapter */
/** @typedef {{run: (input: {machine: VmMachine, machineKey: string, operation: string, workspaceDirectory?: string}) => Promise<unknown>}} MachineLifecycleAdapter */
/** @typedef {ReturnType<typeof createTransitionStore>} TransitionStore */
/** @typedef {{code: string, message: string, operation: string, status: 'failed'}} MachineFailure */
/** @typedef {{failure: MachineFailure, result?: ProcessObservation} | {failure?: undefined, result: ProcessObservation}} VmwareProcessExecution */

const CONFIG_KEYS = ['maxParallelMachines', 'machines', 'schemaVersion'];
const MACHINE_REQUIRED_KEYS = ['location', 'machineType', 'nodeExecutables', 'snapshot', 'ssh', 'vmrun'];
const MACHINE_OPTIONAL_KEYS = ['guestPasswords', 'vmwareEncryptionPassword'];
const SSH_KEYS = ['hostKey', 'identityFile', 'port', 'user'];
const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const NODE_VERSION_PATTERN = /^v\d+\.\d+\.\d+$/;
const RELEASE_NODE_RUNTIME_MAJORS = Object.freeze({minimum: 24, recommended: 24});
const isStableReleaseTag = (/** @type {unknown} */ value) => {
    try {
        return parseArwVersion(value).prerelease === null;
    } catch {
        return false;
    }
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RUN_STATE_KEYS = [
    'archives',
    'candidateCommit',
    'cleanup',
    'configurationPath',
    'handoffs',
    'inFlight',
    'maxParallelMachines',
    'plan',
    'recovery',
    'revision',
    'runId',
    'schemaVersion',
    'status',
    'steps',
];
const HANDOFF_KEYS = [
    'factsDigest',
    'handoffId',
    'kind',
    'responsePath',
    'resultPath',
    'scenarioId',
    'state',
    'stepId',
    'summary',
];
const DECISION_HANDOFF_KEYS = ['decision', ...HANDOFF_KEYS];
const IN_FLIGHT_OPERATIONS = new Set([
    'add-unknown-content',
    'archive-create',
    'archive-verify',
    'capture',
    'copy-directory-to-guest',
    'copy-from-guest',
    'copy-to-guest',
    'hard-power-off',
    'observe-installation-final-state',
    'prepare-preserved-configuration',
    'read-power-state',
    'read-snapshots',
    'remove-test-residue',
    'result-write',
    'revert-snapshot',
    'run-guest',
    'soft-power-off',
    'start-background',
    'wait-guest-address',
]);
/** @type {Readonly<Record<string, Readonly<{message: string, stage: string}>>>} */
const OPERATION_ERRORS = Object.freeze({
    'adapter-result-invalid': Object.freeze({message: 'The adapter returned an invalid result.', stage: 'adapter-result'}),
    'bundle-invalid': Object.freeze({message: 'A required release bundle is invalid.', stage: 'planning'}),
    'concurrent-transition': Object.freeze({message: 'Another run-state transition is already in progress.', stage: 'state-write'}),
    'configuration-invalid': Object.freeze({message: 'The release VM configuration is invalid.', stage: 'configuration'}),
    'identity-invalid': Object.freeze({message: 'The current Platform Host identity does not match the run.', stage: 'identity'}),
    'input-invalid': Object.freeze({message: 'The release validation input is invalid.', stage: 'planning'}),
    'persistence-failed': Object.freeze({message: 'The run state could not be committed.', stage: 'state-write'}),
    'response-invalid': Object.freeze({message: 'The response does not match a pending handoff.', stage: 'response'}),
    'state-invalid': Object.freeze({message: 'The run state is invalid.', stage: 'state-read'}),
    'workspace-invalid': Object.freeze({message: 'The session workspace is invalid.', stage: 'workspace'}),
});

/** @returns {value is JsonObject} */
const exactKeys = (/** @type {unknown} */ value, /** @type {readonly string[]} */ required, /** @type {readonly string[]} */ optional = []) => {
    if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
    const keys = Object.keys(value).sort();
    const allowed = new Set([...required, ...optional]);
    return required.every((/** @type {string} */ key) => keys.includes(key)) && keys.every(key => allowed.has(key));
};
/** @returns {value is JsonObject} */
const isJsonObject = (/** @type {unknown} */ value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const errorCode = (/** @type {unknown} */ error) => error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
/** @returns {value is Record<string, string>} */
const isStringRecord = (/** @type {unknown} */ value) => value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.entries(value).every(([key, entry]) => key.length > 0 && typeof entry === 'string');
/** @returns {value is string} */
const isNonemptyString = (/** @type {unknown} */ value) => typeof value === 'string' && value.length > 0;

/** @returns {value is ProcessObservation} */
const validateProcessObservation = (/** @type {unknown} */ value) => exactKeys(value, ['exitCode', 'stderr', 'stdout'])
    && Number.isSafeInteger(value.exitCode)
    && typeof value.stderr === 'string'
    && typeof value.stdout === 'string';

const adapterResultInvalidErrors = new WeakSet();
const adapterResultInvalidError = (/** @type {string | undefined} */ message) => {
    const error = new Error(message);
    adapterResultInvalidErrors.add(error);
    return error;
};
const isAdapterResultInvalidError = (/** @type {unknown} */ error) => error instanceof Error && adapterResultInvalidErrors.has(error);
/** @returns {error is {code: string, message: string, runPath: string | null, stage: string}} */
const isReleaseValidationOperationError = (/** @type {unknown} */ error) => {
    if (!exactKeys(error, ['code', 'message', 'runPath', 'stage']) || typeof error.code !== 'string' || !Object.hasOwn(OPERATION_ERRORS, error.code)) return false;
    const definition = OPERATION_ERRORS[error.code];
    return error.message === definition.message
        && error.stage === definition.stage
        && (error.runPath === null || typeof error.runPath === 'string');
};
const bindReleaseValidationOperationError = (/** @type {unknown} */ error, /** @type {string | null | undefined} */ runPath) => isAdapterResultInvalidError(error)
    ? releaseValidationOperationError('adapter-result-invalid', runPath)
    : isReleaseValidationOperationError(error)
        ? {...error, runPath}
        : null;
/** @returns {ProcessObservation} */
const requireGuestProcessResult = (/** @type {unknown} */ result, /** @type {string | null} */ runPath = null) => {
    if (!validateProcessObservation(result)) {
        if (runPath !== null) throw releaseValidationOperationError('adapter-result-invalid', runPath);
        throw adapterResultInvalidError('Release Guest Adapter returned an invalid process result.');
    }
    return result;
};

/** @returns {asserts value is string} */
function assertNonemptyString(/** @type {unknown} */ value, /** @type {string} */ label) {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string.`);
}

const assertAbsolutePath = (/** @type {string} */ value, /** @type {string} */ label, windows = true) => {
    assertNonemptyString(value, label);
    if (!(windows ? win32.isAbsolute(value) || isAbsolute(value) : isAbsolute(value))) {
        throw new Error(`${label} must be an absolute path.`);
    }
};

/**
 * 使用调用者从 Platform Adapter 取得的身份建立 release path boundary.
 * 返回的 validator 只接受当前 Repository 和当前 Agent session 的 `.tmp` workspace 内路径.
 */
export const createReleaseSessionWorkspaceBoundary = (/** @type {{agentIdentity: unknown, repositoryRoot: string}} */ {agentIdentity, repositoryRoot}) => {
    const sessionRoot = resolveTemporaryWorkspace({agentIdentity, repositoryRoot});
    return (/** @type {string} */ value, label = 'Release validation path') => {
        assertAbsolutePath(value, label);
        if (resolveAbsolutePathWithinScope({path: value, scope: sessionRoot}).status !== 'succeeded') {
            throw new Error(`${label} must be inside the current session workspace.`);
        }
    };
};

/** @returns {WorkspaceBoundary} */
const requireWorkspaceBoundary = (/** @type {unknown} */ workspaceBoundary) => {
    if (typeof workspaceBoundary !== 'function') {
        throw new Error('Release validation requires a current-session workspace boundary.');
    }
    return (/** @type {string} */ value, /** @type {string | undefined} */ label) => workspaceBoundary(value, label);
};

const pathInside = (/** @type {string} */ root, /** @type {string} */ path) => {
    if (!isAbsolute(path)) return false;
    return resolveAbsolutePathWithinScope({path, scope: root}).status === 'succeeded';
};

const assertOrdinaryHostFile = async (/** @type {string} */ path, /** @type {string} */ label, /** @type {FileSystem} */ fileSystem) => {
    let stats;
    try {
        stats = await fileSystem.lstat(path);
    } catch {
        throw new Error(`${label} does not exist.`);
    }
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} must be an ordinary file.`);
};

const validateNodeExecutables = (/** @type {string} */ machineKey, /** @type {unknown} */ value) => {
    const keys = machineKey === 'Ubuntu' ? ['minimum', 'recommended'] : ['recommended'];
    if (!exactKeys(value, keys)) throw new Error(`${machineKey} nodeExecutables fields are invalid.`);
    /** @type {Record<string, string>} */
    const output = {};
    for (const key of keys) {
        const executable = value[key];
        if (typeof executable !== 'string') throw new Error(`${machineKey} nodeExecutables.${key} must be a string.`);
        assertAbsolutePath(executable, `${machineKey} nodeExecutables.${key}`, machineKey === 'Windows 11');
        output[key] = executable;
    }
    return output;
};

/** @returns {Promise<Readonly<VmMachine>>} */
const validateMachine = async (/** @type {string} */ machineKey, /** @type {unknown} */ machine, /** @type {FileSystem} */ fileSystem) => {
    if (!exactKeys(machine, MACHINE_REQUIRED_KEYS, MACHINE_OPTIONAL_KEYS)) {
        throw new Error(`${machineKey} machine fields are invalid.`);
    }
    if (machine.machineType !== 'VMware' || typeof machine.vmrun !== 'string' || typeof machine.location !== 'string' || typeof machine.snapshot !== 'string') throw new Error(`${machineKey} machine fields are invalid.`);
    assertAbsolutePath(machine.vmrun, `${machineKey} vmrun`);
    assertAbsolutePath(machine.location, `${machineKey} location`);
    if (machine.location.toLowerCase().endsWith('.vmx') === false) {
        throw new Error(`${machineKey} location must identify a .vmx file.`);
    }
    await assertOrdinaryHostFile(machine.vmrun, `${machineKey} vmrun`, fileSystem);
    await assertOrdinaryHostFile(machine.location, `${machineKey} location`, fileSystem);
    assertNonemptyString(machine.snapshot, `${machineKey} snapshot`);
    if (!exactKeys(machine.ssh, SSH_KEYS)) throw new Error(`${machineKey} ssh fields are invalid.`);
    if (typeof machine.ssh.user !== 'string' || typeof machine.ssh.identityFile !== 'string' || typeof machine.ssh.hostKey !== 'string') throw new Error(`${machineKey} ssh fields are invalid.`);
    assertNonemptyString(machine.ssh.user, `${machineKey} ssh.user`);
    if (typeof machine.ssh.port !== 'number' || !Number.isSafeInteger(machine.ssh.port) || machine.ssh.port < 1 || machine.ssh.port > 65_535) {
        throw new Error(`${machineKey} ssh.port must be an integer from 1 through 65535.`);
    }
    assertAbsolutePath(machine.ssh.identityFile, `${machineKey} ssh.identityFile`);
    await assertOrdinaryHostFile(machine.ssh.identityFile, `${machineKey} ssh.identityFile`, fileSystem);
    assertNonemptyString(machine.ssh.hostKey, `${machineKey} ssh.hostKey`);
    const nodeExecutables = validateNodeExecutables(machineKey, machine.nodeExecutables);
    if (Object.hasOwn(machine, 'vmwareEncryptionPassword')
        && typeof machine.vmwareEncryptionPassword !== 'string') {
        throw new Error(`${machineKey} vmwareEncryptionPassword must be a string.`);
    }
    /** @type {Record<string, string> | undefined} */
    let guestPasswords;
    if (Object.hasOwn(machine, 'guestPasswords')) {
        if (!isStringRecord(machine.guestPasswords)) {
            throw new Error(`${machineKey} guestPasswords must map non-empty usernames to strings.`);
        }
        guestPasswords = machine.guestPasswords;
    }
    return Object.freeze({
        location: machine.location,
        machineType: 'VMware',
        guestPasswords: guestPasswords === undefined ? undefined : Object.freeze({...guestPasswords}),
        nodeExecutables: Object.freeze({...nodeExecutables}),
        snapshot: machine.snapshot,
        ssh: Object.freeze({
            hostKey: machine.ssh.hostKey,
            identityFile: machine.ssh.identityFile,
            port: machine.ssh.port,
            user: machine.ssh.user,
        }),
        vmrun: machine.vmrun,
        vmwareEncryptionPassword: typeof machine.vmwareEncryptionPassword === 'string' ? machine.vmwareEncryptionPassword : undefined,
    });
};

const defaultFileSystem = {lstat, mkdir, readFile, rename, rm, writeFile};
const renameDirectoryWithRetry = async (/** @type {FileSystem} */ fileSystem, /** @type {string} */ source, /** @type {string} */ target) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            await fileSystem.rename(source, target);
            return;
        } catch (error) {
            if (errorCode(error) !== 'EPERM' || attempt === 2) throw error;
            await new Promise(resolveDelay => setTimeout(resolveDelay, 25 * (attempt + 1)));
        }
    }
};

/**
 * 从 absolute ordinary JSON file 读取本次 release 的闭合 3-machine VMware configuration.
 * Top-level shape 准确要求 `{maxParallelMachines, machines, schemaVersion: 2}`;
 * `maxParallelMachines` 必须是 `1` 到 machine inventory size 的 integer, 当前即 `1` 到 `3`.
 * 每个 machine 继续经过 path, credential shape, snapshot 和 node executable validation.
 * Success 返回冻结且规范化的 schema 2 configuration, 并保留 required concurrency value.
 * Path, schema, concurrency, credential shape 或 machine fact 无效时 reject, 不返回 partial inventory.
 */
/** @returns {Promise<Readonly<VmConfiguration>>} */
export const loadReleaseVmConfiguration = async (/** @type {string} */ configPath, /** @type {FileSystem} */ fileSystem = defaultFileSystem) => {
    assertAbsolutePath(configPath, 'Release VM configuration path');
    await assertOrdinaryHostFile(configPath, 'Release VM configuration path', fileSystem);
    let value;
    try {
        value = JSON.parse(await fileSystem.readFile(configPath, 'utf8'));
    } catch (error) {
        if (error instanceof SyntaxError) throw new Error('Release VM configuration is not valid JSON.');
        throw error;
    }
    if (!exactKeys(value, CONFIG_KEYS) || value.schemaVersion !== 2) {
        throw new Error('Release VM configuration top-level fields are invalid.');
    }
    if (typeof value.maxParallelMachines !== 'number'
        || !Number.isSafeInteger(value.maxParallelMachines)
        || value.maxParallelMachines < 1
        || value.maxParallelMachines > RELEASE_MACHINE_KEYS.length) {
        throw new Error('Release VM configuration maxParallelMachines must be an integer from 1 through 3.');
    }
    if (!exactKeys(value.machines, RELEASE_MACHINE_KEYS)) {
        throw new Error('Release VM configuration machine inventory is invalid.');
    }
    /** @type {Record<string, Readonly<VmMachine>>} */
    const machines = {};
    for (const machineKey of RELEASE_MACHINE_KEYS) {
        machines[machineKey] = await validateMachine(machineKey, value.machines[machineKey], fileSystem);
    }
    return Object.freeze({
        maxParallelMachines: value.maxParallelMachines,
        machines: Object.freeze(machines),
        schemaVersion: 2,
    });
};

/** @returns {Promise<ReleaseConfiguration>} */
const resolveRootReleaseConfiguration = async (/** @type {{loadReleaseConfiguration?: () => Promise<unknown>, releaseConfiguration?: unknown}} */ {
    loadReleaseConfiguration = loadReleaseValidationConfiguration,
    releaseConfiguration,
} = {}) => {
    const result = releaseConfiguration === undefined
        ? await loadReleaseConfiguration()
        : validateReleaseValidationConfiguration(releaseConfiguration);
    if (!exactKeys(result, ['diagnostics', 'status', 'value']) || result.status !== 'succeeded') throw new Error('Release validation configuration is invalid.');
    const validated = validateReleaseValidationConfiguration(result.value);
    if (validated.status !== 'succeeded') throw new Error('Release validation configuration is invalid.');
    return validated.value;
};

const matchingReleaseMachineKeys = (/** @type {ReleaseConfiguration} */ releaseConfiguration, /** @type {VmConfiguration} */ vmConfiguration) => {
    if (!exactKeys(releaseConfiguration.vmware.softPowerOffTimeoutMs, RELEASE_MACHINE_KEYS)
        || !exactKeys(vmConfiguration.machines, RELEASE_MACHINE_KEYS)) return false;
    const rootMachineKeys = Object.keys(releaseConfiguration.vmware.softPowerOffTimeoutMs).sort(compareText);
    const vmMachineKeys = Object.keys(vmConfiguration.machines).sort(compareText);
    return JSON.stringify(rootMachineKeys) === JSON.stringify(vmMachineKeys);
};

/**
 * 在任何网络或 VM mutation 前共同验证 tracked Release 配置和 Human 提供的 VM 配置.
 * 两者的 machine keys 必须准确相同; success 返回当前两份冻结配置, 不建立跨次比较.
 */
export const loadReleaseValidationInputs = async (/** @type {{configurationPath: string, releaseConfiguration?: unknown}} */ {configurationPath, releaseConfiguration}, /** @type {{fileSystem?: FileSystem, loadConfiguration?: (path: string, fileSystem: FileSystem) => Promise<Readonly<VmConfiguration>>, loadReleaseConfiguration?: () => Promise<unknown>}} */ {
    fileSystem = defaultFileSystem,
    loadConfiguration = loadReleaseVmConfiguration,
    loadReleaseConfiguration = loadReleaseValidationConfiguration,
} = {}) => {
    const [rootConfiguration, vmConfiguration] = await Promise.all([
        resolveRootReleaseConfiguration({loadReleaseConfiguration, releaseConfiguration}),
        loadConfiguration(configurationPath, fileSystem),
    ]);
    if (!matchingReleaseMachineKeys(rootConfiguration, vmConfiguration)) {
        throw new Error('Release validation configuration machine inventories do not match.');
    }
    return Object.freeze({
        releaseConfiguration: rootConfiguration,
        vmConfiguration,
    });
};

const requireBundleFact = (/** @type {unknown} */ value, /** @type {{commit: string, kind: string}} */ {commit, kind}) => value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && exactKeys(value, kind === 'candidate' ? ['commit', 'kind', 'priorRelease'] : ['commit', 'kind'])
    && OBJECT_ID_PATTERN.test(commit)
    && value.commit === commit
    && value.kind === kind
    && (kind !== 'candidate' || isJsonObject(value.priorRelease)
        && exactKeys(value.priorRelease, ['commit', 'tag'])
        && typeof value.priorRelease.commit === 'string'
        && OBJECT_ID_PATTERN.test(value.priorRelease.commit)
        && typeof value.priorRelease.tag === 'string'
        && isStableReleaseTag(value.priorRelease.tag));

const resolvedChoices = (/** @type {JsonObject | null | undefined} */ parameters) => Object.freeze(Object.fromEntries(
    Object.entries(parameters ?? {}).filter(([, value]) => value !== null),
));

const resolvePlanMechanicalParameters = (/** @type {Readonly<JsonObject> | null} */ parameters) => parameters?.version === 'candidate'
    ? Object.freeze({...parameters, version: ARW_VERSION})
    : parameters;

const createScenarioPlanFromRegistry = (/** @type {string} */ candidateCommit, /** @type {ReturnType<typeof listReleaseValidationScenarios>} */ registry = listReleaseValidationScenarios(), /** @type {'post-init' | 'pre-tag'} */ phase = 'pre-tag') => {
    const scenarios = registry
        .filter(scenario => scenario.phase === phase)
        .map(scenario => Object.freeze({
            archiveKind: scenario.archiveKind,
            machineKey: scenario.machineKey,
            phase: scenario.phase,
            prerequisites: scenario.prerequisites,
            steps: Object.freeze(scenario.steps.map(step => Object.freeze({
                ...step,
                choices: resolvedChoices(step.choiceParameters),
                mechanicalParameters: resolvePlanMechanicalParameters(step.mechanicalParameters),
            }))),
            targetKind: scenario.targetKind,
        }));
    return Object.freeze({
        candidateCommit,
        registryDigest: createHash('sha256').update(JSON.stringify(registry)).digest('hex'),
        scenarios: Object.freeze(scenarios),
    });
};

/** @typedef {ReturnType<typeof createScenarioPlanFromRegistry>} ScenarioPlan */
/** @typedef {ScenarioPlan['scenarios'][number]} PlannedScenario */
/** @typedef {PlannedScenario & {machineKey: string}} MachineScenario */
/** @typedef {PlannedScenario['steps'][number]} PlannedStep */
/** @typedef {ReturnType<typeof resolveReleaseValidationStep>['step']} RegistryStep */
/** @typedef {{changeType: string, path: string}} ReleaseChange */
/** @typedef {{exitCode: number, stderr: string, stdout: string}} CommandOutcome */
/** @typedef {{commandOutcome?: CommandOutcome, headToIndexDiff: string, indexToWorkingTreeDiff: string, nonRegularEntries: Array<{path: string, type: string}>, status: string, untrackedFiles: Array<{bytes: string, path: string}>}} GuestReviewMaterial */
/** @typedef {{auditedDirectory: string, changes: ReleaseChange[], machineKey: string, reviewMaterial: GuestReviewMaterial, scenarioId: string, status: 'captured', stepId: string}} CapturedGuestStep */
/** @typedef {{auditedDirectory: string, changes: ReleaseChange[], machineKey: string, nodeVersion: string, reviewMaterial: GuestReviewMaterial, scenarioId: string, stepId: string, workspaceDirectory: string}} MechanicalTemplate */
/** @typedef {{files: Array<{changeType: string, matchesExpected: boolean, path: string, summary: string}>, matchesExpected: boolean, summary: string}} ReleaseJudgment */
/** @typedef {{files: JsonObject[], matchesExpected: boolean, summary: string, [key: string]: unknown}} MechanicalEvaluation */
/** @typedef {{code: string, message: string, source: {scenarioId: string, stepId: string} | null}} StepReason */
/** @typedef {{classification: string | null, evidencePath: string | null, handoffId: string | null, outcome: string | null, reason: StepReason | null, scenarioId: string, state: string, stepId: string}} PersistentStep */
/** @typedef {{decision?: string | null, factsDigest: string | null, handoffId: string, kind: string, responsePath: string | null, resultPath: string, scenarioId: string, state: string, stepId: string, summary: string | null}} PersistentHandoff */
/** @typedef {{machineKey: string, outcome: string, reason: StepReason | null, resultPath: string | null, scenarioId: string, stage: string}} PersistentCleanup */
/** @typedef {{archiveKind: string, outputPath: string | null, reason: {code: string, message: string} | null, sourceDirectory: string | null, status: string}} PersistentArchive */
/** @typedef {{machineKey: string, operation: string, scenarioId: string | null, startedRevision: number, stepId: string | null}} PersistentInFlight */
/** @typedef {{machineKey: string, nextOperation: string | null, outcome: string, scenarioId: string, sourceOperation: string, stepId: string}} PersistentRecovery */
/** @typedef {{archives: PersistentArchive[], candidateCommit: string, cleanup: PersistentCleanup[], configurationPath: string, handoffs: PersistentHandoff[], inFlight: PersistentInFlight[], maxParallelMachines: number, plan: ScenarioPlan, recovery: PersistentRecovery[], revision: number, runId: string, schemaVersion: number, status: string, steps: PersistentStep[], [key: string]: unknown}} RunState */
/** @typedef {{address?: string, currentSnapshot?: string | null, powerOffMode?: string, powerState?: string, snapshot?: string, snapshots?: string[]}} LifecycleObservation */
/** @typedef {{code: string, message: string, operation: string, status: 'failed'} | {observation: LifecycleObservation, operation: string, status: 'observed'}} LifecycleResult */

/** @returns {scenario is MachineScenario} */
const hasMachineScenario = (/** @type {PlannedScenario | undefined} */ scenario) => scenario !== undefined && scenario.machineKey !== null;

/**
 * 验证 fixed bundle facts 并从完整 Registry 构造本次 run 的 immutable pre-tag Scenario Plan.
 * Plan 只解析已经登记的 choice applicability, 不读取 VM 或重新观察 guest premise.
 */
export const createReleaseValidationScenarioPlan = (/** @type {{bundleFacts: unknown, candidateCommit: string, releaseConfiguration: unknown}} */ {bundleFacts, candidateCommit, releaseConfiguration}) => {
    const configurationResult = validateReleaseValidationConfiguration(releaseConfiguration);
    const registry = configurationResult.status === 'succeeded' && 'value' in configurationResult
        ? resolveReleaseValidationRegistry(configurationResult.value.initializationIssueScenario)
        : configurationResult;
    if (registry.status !== 'succeeded'
        || !OBJECT_ID_PATTERN.test(candidateCommit)
        || bundleFacts === null
        || typeof bundleFacts !== 'object'
        || Array.isArray(bundleFacts)
        || !exactKeys(bundleFacts, ['agentAssisted', 'candidate', 'plain', 'status'])
        || bundleFacts.status !== 'inspected'
        || !requireBundleFact(bundleFacts.candidate, {commit: candidateCommit, kind: 'candidate'})
        || configurationResult.status !== 'succeeded'
        || !('value' in configurationResult)
        || !requireBundleFact(bundleFacts.plain, {
            commit: isJsonObject(bundleFacts.plain) && typeof bundleFacts.plain.commit === 'string' ? bundleFacts.plain.commit : '',
            kind: 'plain',
        })
        || !requireBundleFact(bundleFacts.agentAssisted, {
            commit: isJsonObject(bundleFacts.agentAssisted) && typeof bundleFacts.agentAssisted.commit === 'string' ? bundleFacts.agentAssisted.commit : '',
            kind: 'agent-assisted',
        })) {
        throw new Error('Release validation bundle facts are invalid.');
    }
    if (!('scenarios' in registry)) throw new Error('Release validation bundle facts are invalid.');
    return createScenarioPlanFromRegistry(candidateCommit, [...registry.scenarios]);
};

const POST_INIT_CHOICES = Object.freeze(['run', 'skip']);
/** @typedef {{candidateCommit: string, choices: readonly string[], decision: 'run' | 'skip' | null, scenarioId: string, status: 'blocked' | 'passed' | 'pending' | 'running' | 'skipped'}} ReleasePostInitChoiceState */

const validPreTagResult = (/** @type {unknown} */ value, /** @type {string} */ candidateCommit) => {
    if (!isJsonObject(value)) return false;
    const result = /** @type {JsonObject} */ (value);
    if (result.candidateCommit !== candidateCommit
        || result.status !== 'completed'
        || !Array.isArray(result.archives)) return false;
    const expected = listPreTagArchiveKinds();
    return result.archives.length === expected.length && result.archives.every((archive, index) => {
        if (!isJsonObject(archive)) return false;
        const record = /** @type {JsonObject} */ (archive);
        return record.archiveKind === expected[index] && record.status === 'created';
    });
};

/** 建立仅属于当前 candidate 的 explicit post-init choice handoff. */
export const createReleasePostInitChoiceHandoff = (/** @type {{candidateCommit: string, preTagResult: unknown}} */ {
    candidateCommit,
    preTagResult,
}) => {
    if (!OBJECT_ID_PATTERN.test(candidateCommit)) throw new Error('Release post-init candidate is invalid.');
    if (!validPreTagResult(preTagResult, candidateCommit)) throw new Error('Release post-init pre-tag result is invalid.');
    return Object.freeze({
        candidateCommit,
        choices: POST_INIT_CHOICES,
        decision: null,
        scenarioId: RELEASE_POST_INIT_SCENARIO_ID,
        status: 'pending',
    });
};

/** @returns {ReleasePostInitChoiceState} */
export const parseReleasePostInitChoiceState = (/** @type {unknown} */ state) => {
    if (state === null
        || typeof state !== 'object'
        || Array.isArray(state)
        || !exactKeys(state, ['candidateCommit', 'choices', 'decision', 'scenarioId', 'status'])
        || typeof state.candidateCommit !== 'string'
        || !OBJECT_ID_PATTERN.test(state.candidateCommit)
        || !Array.isArray(state.choices)
        || JSON.stringify(state.choices) !== JSON.stringify(POST_INIT_CHOICES)
        || state.scenarioId !== RELEASE_POST_INIT_SCENARIO_ID
        || !(['pending'].includes(String(state.status)) && state.decision === null
            || ['running', 'blocked', 'passed'].includes(String(state.status)) && state.decision === 'run'
            || state.status === 'skipped' && state.decision === 'skip')) {
        throw new Error('Release post-init choice state is invalid.');
    }
    return /** @type {ReleasePostInitChoiceState} */ (Object.freeze({
        candidateCommit: state.candidateCommit,
        choices: POST_INIT_CHOICES,
        decision: state.decision,
        scenarioId: state.scenarioId,
        status: state.status,
    }));
};

/** @returns {state is ReleasePostInitChoiceState} */
const validPostInitChoiceState = (/** @type {unknown} */ state) => {
    try {
        parseReleasePostInitChoiceState(state);
        return true;
    } catch {
        return false;
    }
};

/** 消费无默认值的 run 或 skip choice. */
export const resolveReleasePostInitChoice = (/** @type {{choice?: unknown, state: unknown}} */ {choice, state}) => {
    if (!validPostInitChoiceState(state) || state.status !== 'pending' || state.decision !== null) {
        throw new Error('Release post-init choice requires a pending handoff.');
    }
    if (typeof choice !== 'string' || !POST_INIT_CHOICES.includes(choice)) throw new Error('Release post-init choice must be run or skip.');
    return Object.freeze({...state, decision: choice, status: choice === 'run' ? 'running' : 'skipped'});
};

/** 构造仅包含 deferred fresh initialization lifecycle 的 immutable Plan. */
export const createReleasePostInitScenarioPlan = (/** @type {{bundleFacts: unknown, candidateCommit: string, releaseConfiguration: unknown, state: unknown}} */ {
    bundleFacts,
    candidateCommit,
    releaseConfiguration,
    state,
}) => {
    if (!validPostInitChoiceState(state) || state.status !== 'running' || state.decision !== 'run') {
        throw new Error('Release post-init scenario requires the run choice.');
    }
    if (state.candidateCommit !== candidateCommit) throw new Error('Release post-init candidate does not match the choice.');
    const corePlan = createReleaseValidationScenarioPlan({bundleFacts, candidateCommit, releaseConfiguration});
    const configurationResult = validateReleaseValidationConfiguration(releaseConfiguration);
    if (configurationResult.status !== 'succeeded' || !('value' in configurationResult)) {
        throw new Error('Release post-init configuration is invalid.');
    }
    const registry = resolveReleaseValidationRegistry(configurationResult.value.initializationIssueScenario);
    if (registry.status !== 'succeeded' || !('scenarios' in registry)) throw new Error('Release post-init Registry is invalid.');
    const plan = createScenarioPlanFromRegistry(corePlan.candidateCommit, [...registry.scenarios], 'post-init');
    if (plan.scenarios.length !== 1 || plan.scenarios[0].archiveKind !== state.scenarioId) {
        throw new Error('Release post-init scenario is invalid.');
    }
    return plan;
};

/** 将 run outcome 绑定到同一 handoff. failed 是 terminal blocker, 不能改成 skip. */
export const completeReleasePostInitChoice = (/** @type {{archive?: unknown, outcome: unknown, state: unknown}} */ {archive, outcome, state}) => {
    if (!validPostInitChoiceState(state) || state.status !== 'running' || state.decision !== 'run') {
        throw new Error('Release post-init completion requires a running choice.');
    }
    if (typeof outcome !== 'string' || !['failed', 'passed'].includes(outcome)) throw new Error('Release post-init outcome is invalid.');
    if (outcome === 'passed') {
        if (!isJsonObject(archive)) throw new Error('Release post-init archive is invalid.');
        const record = /** @type {JsonObject} */ (archive);
        if (record.archiveKind !== state.scenarioId || record.status !== 'created') {
            throw new Error('Release post-init archive is invalid.');
        }
    }
    return Object.freeze({...state, status: outcome === 'passed' ? 'passed' : 'blocked'});
};

/** local tag 只接受 explicit skip 或完整 post-init pass. */
export const releasePostInitAllowsLocalTag = (/** @type {unknown} */ state) => validPostInitChoiceState(state)
    && (state.status === 'skipped' && state.decision === 'skip' || state.status === 'passed' && state.decision === 'run');

export const releaseValidationOperationError = (/** @type {string} */ code, /** @type {string | null} */ runPath = null) => {
    const definition = OPERATION_ERRORS[code];
    return {
        code,
        message: definition.message,
        runPath,
        stage: definition.stage,
    };
};

const runStateBytes = (/** @type {unknown} */ state) => `${JSON.stringify(state)}\n`;
const runStateDigest = (/** @type {RunState} */ state) => createHash('sha256').update(runStateBytes(state)).digest('hex');

const validateStepReason = (/** @type {StepReason} */ reason) => exactKeys(reason, ['code', 'message', 'source'])
    && ['adapter-failed', 'cleanup-failed', 'compensation-declined', 'dependency-failed', 'expectation-mismatch', 'failure-hold-failed', 'interrupted', 'operation-failed', 'semantic-declined', 'unavailable-machine'].includes(reason.code)
    && typeof reason.message === 'string'
    && reason.message.length > 0
    && (reason.source === null || exactKeys(reason.source, ['scenarioId', 'stepId']));

const persistedRunPath = (/** @type {string} */ runPath, /** @type {string} */ value) => isAbsolute(value) && pathInside(dirname(runPath), value);

const validatePersistentSteps = (/** @type {RunState} */ state, /** @type {string} */ runPath) => {
    const locators = state.plan.scenarios.flatMap(scenario => scenario.steps.map(step => ({
        scenarioId: scenario.archiveKind,
        stepId: step.stepId,
    })));
    return state.steps.length === locators.length && state.steps.every((step, index) => {
        const locator = locators[index];
        if (!exactKeys(step, ['classification', 'evidencePath', 'handoffId', 'outcome', 'reason', 'scenarioId', 'state', 'stepId'])
            || step.scenarioId !== locator.scenarioId
            || step.stepId !== locator.stepId
            || !['pending', 'in-flight', 'terminal'].includes(step.state)
            || !(step.evidencePath === null || typeof step.evidencePath === 'string' && persistedRunPath(runPath, step.evidencePath))
            || !(step.handoffId === null || typeof step.handoffId === 'string' && UUID_PATTERN.test(step.handoffId))) return false;
        if (step.state !== 'terminal') {
            return step.classification === null && step.outcome === null && step.reason === null;
        }
        if (typeof step.classification !== 'string'
            || !['formal', 'diagnostic', 'unresolved'].includes(step.classification)
            || typeof step.outcome !== 'string'
            || !['passed', 'failed', 'not-run'].includes(step.outcome)) return false;
        if (step.outcome === 'passed') return step.reason === null && step.classification !== 'unresolved';
        return step.reason !== null && validateStepReason(step.reason);
    });
};

const plannedHandoffLocator = (/** @type {RunState} */ state, /** @type {PersistentHandoff} */ handoff) => {
    const scenario = state.plan.scenarios.find(item => item.archiveKind === handoff.scenarioId);
    if (scenario === undefined) return false;
    if (handoff.kind === 'compensation') {
        return handoff.stepId === 'scenario-ready' || scenario.steps.some(step => step.stepId === handoff.stepId);
    }
    return scenario.steps.some(step => step.stepId === handoff.stepId && step.judgment === 'semantic');
};

const validatePersistentHandoffs = (/** @type {RunState} */ state, /** @type {string} */ runPath) => {
    if (new Set(state.handoffs.map(handoff => handoff.handoffId)).size !== state.handoffs.length) return false;
    const pendingCompensations = state.handoffs
        .filter((/** @type {{ kind: string; state: string; }} */ handoff) => handoff.kind === 'compensation' && handoff.state === 'pending')
        .map(handoff => `${handoff.scenarioId}\u0000${handoff.stepId}`);
    if (new Set(pendingCompensations).size !== pendingCompensations.length) return false;
    return state.handoffs.every(handoff => {
        const expectedKeys = handoff.kind === 'semantic-judgment' ? HANDOFF_KEYS : DECISION_HANDOFF_KEYS;
        if (!exactKeys(handoff, expectedKeys)
            || !UUID_PATTERN.test(handoff.handoffId)
            || !['semantic-action', 'semantic-judgment', 'compensation'].includes(handoff.kind)
            || !['pending', 'consumed'].includes(handoff.state)
            || typeof handoff.scenarioId !== 'string'
            || typeof handoff.stepId !== 'string'
            || !(handoff.factsDigest === null || typeof handoff.factsDigest === 'string' && /^[0-9a-f]{64}$/.test(handoff.factsDigest))
            || !plannedHandoffLocator(state, handoff)) return false;
        if (handoff.kind !== 'semantic-judgment' && handoff.factsDigest !== null) return false;
        if (handoff.kind === 'semantic-judgment' && handoff.factsDigest === null) return false;
        if (!persistedRunPath(runPath, handoff.resultPath)) return false;
        if (handoff.state === 'pending') {
            return handoff.responsePath === null
                && handoff.summary === null
                && (handoff.kind === 'semantic-judgment' || handoff.decision === null);
        }
        if (typeof handoff.responsePath !== 'string' || !persistedRunPath(runPath, handoff.responsePath)) return false;
        if (handoff.kind === 'semantic-judgment') return typeof handoff.summary === 'string' && handoff.summary.length > 0;
        if (typeof handoff.decision !== 'string') return false;
        if (handoff.kind === 'compensation') return handoff.summary === null;
        return typeof handoff.summary === 'string' && handoff.summary.length > 0;
    });
};

const validatePersistentCleanup = (/** @type {RunState} */ state, /** @type {string} */ runPath) => state.cleanup.length === state.plan.scenarios.length
    && state.cleanup.every((record, index) => exactKeys(record, ['machineKey', 'outcome', 'reason', 'resultPath', 'scenarioId', 'stage'])
        && record.machineKey === state.plan.scenarios[index].machineKey
        && record.scenarioId === state.plan.scenarios[index].archiveKind
        && ['pending', 'passed', 'failed'].includes(record.outcome)
        && ['not-started', 'failure-hold', 'final'].includes(record.stage)
        && (record.resultPath === null || typeof record.resultPath === 'string' && persistedRunPath(runPath, record.resultPath))
        && (record.reason === null || validateStepReason(record.reason)));

const validatePersistentArchives = (/** @type {RunState} */ state, /** @type {string} */ runPath) => state.archives.length === state.plan.scenarios.length
    && state.archives.every((record, index) => exactKeys(record, ['archiveKind', 'outputPath', 'reason', 'sourceDirectory', 'status'])
        && record.archiveKind === state.plan.scenarios[index].archiveKind
        && ['not-eligible', 'pending', 'created', 'failed'].includes(record.status)
        && (record.outputPath === null || persistedRunPath(runPath, record.outputPath))
        && (record.sourceDirectory === null || persistedRunPath(runPath, record.sourceDirectory))
        && (record.reason === null || exactKeys(record.reason, ['code', 'message'])
            && typeof record.reason.code === 'string'
            && typeof record.reason.message === 'string'
            && record.reason.message.length > 0)
        && (record.status !== 'not-eligible' || record.outputPath === null && record.sourceDirectory === null && record.reason !== null)
        && (!['pending', 'created'].includes(record.status) || record.outputPath !== null && record.sourceDirectory !== null));

const validatePersistentInFlight = (/** @type {RunState} */ state) => state.inFlight.length <= state.maxParallelMachines
    && new Set(state.inFlight.map(record => record.machineKey)).size === state.inFlight.length
    && state.inFlight.every(record => exactKeys(record, ['machineKey', 'operation', 'scenarioId', 'startedRevision', 'stepId'])
        && RELEASE_MACHINE_KEYS.includes(record.machineKey)
        && IN_FLIGHT_OPERATIONS.has(record.operation)
        && (record.scenarioId === null || typeof record.scenarioId === 'string')
        && (record.stepId === null || typeof record.stepId === 'string')
        && (record.scenarioId === null || state.plan.scenarios.some(scenario => scenario.archiveKind === record.scenarioId
            && scenario.machineKey === record.machineKey
            && (record.stepId === 'scenario-ready' || scenario.steps.some(step => step.stepId === record.stepId))))
        && Number.isSafeInteger(record.startedRevision)
        && record.startedRevision > 0
        && record.startedRevision <= state.revision);

const validatePersistentRecovery = (/** @type {RunState} */ state) => new Set(state.recovery.map(record => record.machineKey)).size === state.recovery.length
    && state.recovery.every(record => !state.inFlight.some(inFlight => inFlight.machineKey === record.machineKey))
    && state.recovery.every(record => exactKeys(record, ['machineKey', 'nextOperation', 'outcome', 'scenarioId', 'sourceOperation', 'stepId'])
        && RELEASE_MACHINE_KEYS.includes(record.machineKey)
        && [null, 'hard-power-off', 'revert-snapshot', 'verify-powered-off', 'verify-snapshot'].includes(record.nextOperation)
        && ['pending', 'passed', 'failed'].includes(record.outcome)
        && IN_FLIGHT_OPERATIONS.has(record.sourceOperation)
        && state.plan.scenarios.some(scenario => scenario.archiveKind === record.scenarioId
            && scenario.machineKey === record.machineKey
            && (record.stepId === 'scenario-ready' || scenario.steps.some(step => step.stepId === record.stepId))));

const validatePersistentRunState = (/** @type {RunState} */ state, /** @type {string} */ runPath) => {
    const postInitPlan = exactKeys(state, RUN_STATE_KEYS)
        && Array.isArray(state.plan?.scenarios)
        && state.plan.scenarios.length === 1
        && state.plan.scenarios[0]?.phase === 'post-init';
    const expectedPlan = exactKeys(state, RUN_STATE_KEYS) && OBJECT_ID_PATTERN.test(state.candidateCommit)
        ? createScenarioPlanFromRegistry(state.candidateCommit, listReleaseValidationScenarios(), postInitPlan ? 'post-init' : 'pre-tag')
        : null;
    if (!exactKeys(state, RUN_STATE_KEYS)
        || state.schemaVersion !== 1
        || !Number.isSafeInteger(state.revision)
        || state.revision < 0
        || !UUID_PATTERN.test(state.runId)
        || !OBJECT_ID_PATTERN.test(state.candidateCommit)
        || !Number.isSafeInteger(state.maxParallelMachines)
        || state.maxParallelMachines < 1
        || state.maxParallelMachines > RELEASE_MACHINE_KEYS.length
        || !['running', 'paused', 'completing', 'completed'].includes(state.status)
        || !isAbsolute(state.configurationPath)
        || !Array.isArray(state.archives)
        || !Array.isArray(state.cleanup)
        || !Array.isArray(state.handoffs)
        || !Array.isArray(state.inFlight)
        || !Array.isArray(state.recovery)
        || !Array.isArray(state.steps)
        || JSON.stringify(state.plan) !== JSON.stringify(expectedPlan)
        || !validatePersistentSteps(state, runPath)
        || !validatePersistentHandoffs(state, runPath)
        || !validatePersistentCleanup(state, runPath)
        || !validatePersistentArchives(state, runPath)
        || !validatePersistentInFlight(state)
        || !validatePersistentRecovery(state)) {
        throw releaseValidationOperationError('state-invalid', runPath);
    }
    return state;
};

const readPersistentRunState = async (/** @type {string} */ runPath, /** @type {FileSystem} */ fileSystem) => {
    /** @type {RunState} */
    let state;
    try {
        await assertOrdinaryHostFile(runPath, 'Release validation run path', fileSystem);
        state = JSON.parse(await fileSystem.readFile(runPath, 'utf8'));
    } catch (error) {
        const code = errorCode(error);
        if (code !== undefined && OPERATION_ERRORS[code] !== undefined) throw error;
        throw releaseValidationOperationError('state-invalid', runPath);
    }
    return validatePersistentRunState(state, runPath);
};

const replaceRunState = async (/** @type {{fileSystem: FileSystem, runPath: string, state: RunState}} */ {fileSystem, runPath, state}) => {
    const temporaryPath = `${runPath}.${process.pid}.${state.revision}.tmp`;
    try {
        await fileSystem.writeFile(temporaryPath, runStateBytes(state), {encoding: 'utf8', flag: 'wx'});
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                await fileSystem.rename(temporaryPath, runPath);
                return;
            } catch (error) {
                if (errorCode(error) !== 'EPERM' || attempt === 2) throw error;
            }
        }
    } catch {
        await fileSystem.rm(temporaryPath, {force: true}).catch(() => {});
        throw releaseValidationOperationError('persistence-failed', runPath);
    }
};

const recoverOrphanRunTransition = async (/** @type {{fileSystem: FileSystem, runPath: string, state: RunState}} */ {fileSystem, runPath, state}) => {
    const markerPath = join(dirname(runPath), 'transitions', `${state.revision + 1}.json`);
    /** @type {{nextState: RunState, parentDigest: string, parentRevision: number, revision: number}} */
    let marker;
    try {
        marker = JSON.parse(await fileSystem.readFile(markerPath, 'utf8'));
    } catch (error) {
        if (errorCode(error) === 'ENOENT') return state;
        throw releaseValidationOperationError('state-invalid', runPath);
    }
    if (!exactKeys(marker, ['nextState', 'parentDigest', 'parentRevision', 'revision'])
        || marker.parentRevision !== state.revision
        || marker.revision !== state.revision + 1
        || marker.parentDigest !== runStateDigest(state)
        || marker.nextState?.revision !== marker.revision) {
        throw releaseValidationOperationError('state-invalid', runPath);
    }
    const nextState = validatePersistentRunState(marker.nextState, runPath);
    await replaceRunState({fileSystem, runPath, state: nextState});
    return nextState;
};

const commitRunTransition = async (/** @type {{fileSystem: FileSystem, nextState: RunState, runPath: string, state: RunState}} */ {fileSystem, nextState, runPath, state}) => {
    const committedState = validatePersistentRunState({
        ...nextState,
        revision: state.revision + 1,
    }, runPath);
    const transitionsDirectory = join(dirname(runPath), 'transitions');
    const markerPath = join(transitionsDirectory, `${committedState.revision}.json`);
    try {
        await fileSystem.mkdir(transitionsDirectory, {recursive: true});
        await fileSystem.writeFile(markerPath, runStateBytes({
            nextState: committedState,
            parentDigest: runStateDigest(state),
            parentRevision: state.revision,
            revision: committedState.revision,
        }), {encoding: 'utf8', flag: 'wx'});
    } catch (error) {
        if (errorCode(error) === 'EEXIST') throw releaseValidationOperationError('concurrent-transition', runPath);
        await fileSystem.rm(markerPath, {force: true}).catch(() => {});
        throw releaseValidationOperationError('persistence-failed', runPath);
    }
    await replaceRunState({fileSystem, runPath, state: committedState});
    return committedState;
};

const readResponse = async (/** @type {{fileSystem: FileSystem, responsePath: string, runPath: string}} */ {fileSystem, responsePath, runPath}) => {
    try {
        await assertOrdinaryHostFile(responsePath, 'Release validation response path', fileSystem);
        return JSON.parse(await fileSystem.readFile(responsePath, 'utf8'));
    } catch {
        throw releaseValidationOperationError('response-invalid', runPath);
    }
};

const validateSemanticActionResponse = (/** @type {{handoff: PersistentHandoff, plan: ScenarioPlan, response: unknown, runId: string}} */ {handoff, plan, response, runId}) => {
    const scenario = plan.scenarios.find(item => item.archiveKind === handoff.scenarioId);
    return exactKeys(response, [
        'decision',
        'handoffId',
        'kind',
        'machineKey',
        'runId',
        'scenarioId',
        'schemaVersion',
        'stepId',
        'summary',
    ])
        && typeof response.decision === 'string'
        && ['completed', 'declined'].includes(response.decision)
        && response.handoffId === handoff.handoffId
        && response.kind === 'semantic-action'
        && response.machineKey === scenario?.machineKey
        && response.runId === runId
        && response.scenarioId === handoff.scenarioId
        && response.schemaVersion === 1
        && response.stepId === handoff.stepId
        && typeof response.summary === 'string'
        && response.summary.length > 0;
};

const validateCompensationResponse = (/** @type {{handoff: PersistentHandoff, response: unknown, runId: string}} */ {handoff, response, runId}) => exactKeys(response, [
    'decision',
    'handoffId',
    'kind',
    'runId',
    'scenarioId',
    'schemaVersion',
    'stepId',
])
    && typeof response.decision === 'string'
    && ['applied', 'declined'].includes(response.decision)
    && response.handoffId === handoff.handoffId
    && response.kind === 'compensation'
    && response.runId === runId
    && response.scenarioId === handoff.scenarioId
    && response.schemaVersion === 1
    && response.stepId === handoff.stepId;

const validateSemanticJudgmentResponse = (/** @type {{captured: {changes: Array<{changeType: string, path: string}>}, handoff: PersistentHandoff, plan: ScenarioPlan, response: unknown, runId: string}} */ {captured, handoff, plan, response, runId}) => {
    const scenario = plan.scenarios.find(item => item.archiveKind === handoff.scenarioId);
    if (!exactKeys(response, [
        'factsDigest',
        'handoffId',
        'judgment',
        'kind',
        'machineKey',
        'runId',
        'scenarioId',
        'schemaVersion',
        'stepId',
    ])
        || response.factsDigest !== handoff.factsDigest
        || response.handoffId !== handoff.handoffId
        || response.kind !== 'semantic-judgment'
        || response.machineKey !== scenario?.machineKey
        || response.runId !== runId
        || response.scenarioId !== handoff.scenarioId
        || response.schemaVersion !== 1
        || response.stepId !== handoff.stepId
        || !exactKeys(response.judgment, ['files', 'matchesExpected', 'summary'])
        || !Array.isArray(response.judgment.files)
        || typeof response.judgment.matchesExpected !== 'boolean'
        || typeof response.judgment.summary !== 'string'
        || response.judgment.summary.length === 0
        || response.judgment.files.length !== captured.changes.length) return false;
    for (const [index, file] of response.judgment.files.entries()) {
        const change = captured.changes[index];
        if (!exactKeys(file, ['changeType', 'matchesExpected', 'path', 'summary'])
            || file.changeType !== change.changeType
            || file.path !== change.path
            || typeof file.matchesExpected !== 'boolean'
            || typeof file.summary !== 'string'
            || file.summary.length === 0) return false;
    }
    return response.judgment.matchesExpected === false
        || response.judgment.files.every(file => file.matchesExpected);
};

const closeFailedDependencies = (/** @type {{failedLocator: {plan: ScenarioPlan, scenarioId?: string, stepId?: string}, steps: PersistentStep[]}} */ {failedLocator, steps}) => {
    let changed = true;
    let output = steps;
    while (changed) {
        changed = false;
        const records = new Map(output.map(step => [`${step.scenarioId}\0${step.stepId}`, step]));
        output = output.map(record => {
            if (record.state !== 'pending') return record;
            const planStep = failedLocator.plan.scenarios
                .find(scenario => scenario.archiveKind === record.scenarioId)?.steps
                .find(step => step.stepId === record.stepId);
            const blockedBy = planStep?.dependencies
                .map(locator => ({locator, record: records.get(`${locator.scenarioId}\0${locator.stepId}`)}))
                .find(item => item.record?.state === 'terminal'
                    && (item.record.outcome === 'failed' || item.record.classification === 'unresolved'));
            if (blockedBy === undefined) return record;
            changed = true;
            return {
                ...record,
                classification: 'unresolved',
                outcome: 'not-run',
                reason: {
                    code: 'dependency-failed',
                    message: 'A required release validation dependency did not pass.',
                    source: blockedBy.locator,
                },
                state: 'terminal',
            };
        });
    }
    return output;
};

const writePendingManifest = async (/** @type {{fileSystem: FileSystem, runPath: string, state: RunState}} */ {fileSystem, runPath, state}) => {
    const pending = state.handoffs.filter((/** @type {{ state: string; }} */ handoff) => handoff.state === 'pending');
    if (pending.length === 0) return null;
    const pendingPath = join(dirname(runPath), 'pending', `${state.revision}.json`);
    try {
        await fileSystem.mkdir(dirname(pendingPath), {recursive: true});
    } catch {
        throw releaseValidationOperationError('persistence-failed', runPath);
    }
    await writeReleaseEvidenceFiles({
        fileSystem,
        runPath,
        writes: [{bytes: runStateBytes({
            items: pending.map(handoff => ({
                kind: handoff.kind,
                responseTemplatePath: join(dirname(runPath), 'responses', `${handoff.handoffId}.json`),
                resultPath: handoff.resultPath,
                scenarioId: handoff.scenarioId,
                stepId: handoff.stepId,
            })),
            runId: state.runId,
            schemaVersion: 1,
        }), path: pendingPath}],
    });
    return pendingPath;
};

const handoffSummary = (/** @type {{state: RunState, step: PersistentStep}} */ {state, step}) => {
    const handoff = state.handoffs.find(item => item.handoffId === step.handoffId)
        ?? [...state.handoffs].reverse().find(item => item.scenarioId === step.scenarioId && item.stepId === step.stepId);
    if (handoff === undefined) return null;
    const summary = {
        handoffId: handoff.handoffId,
        kind: handoff.kind,
        responsePath: handoff.responsePath,
        summary: handoff.summary,
    };
    return handoff.kind === 'semantic-judgment'
        ? summary
        : {decision: handoff.decision, ...summary};
};

const archiveIneligibility = (/** @type {{cleanup: PersistentCleanup, records: PersistentStep[], state: RunState, scenarioId: string}} */ {cleanup, records, state, scenarioId}) => {
    if (cleanup.outcome !== 'passed') {
        return {code: 'ineligible-cleanup', message: 'The scenario cleanup did not pass.'};
    }
    if (state.handoffs.some(handoff => handoff.scenarioId === scenarioId && handoff.state === 'pending')) {
        return {code: 'ineligible-pending-handoff', message: 'The scenario has a pending handoff.'};
    }
    if (records.some(record => record.classification === 'formal' && record.outcome === 'failed')) {
        return {code: 'ineligible-formal-failure', message: 'The scenario contains a formal failure.'};
    }
    if (records.some(record => record.classification === 'diagnostic')) {
        return {code: 'ineligible-diagnostic', message: 'The scenario contains diagnostic results.'};
    }
    if (records.some(record => record.classification === 'unresolved')) {
        return {code: 'ineligible-unresolved', message: 'The scenario contains unresolved steps.'};
    }
    return null;
};

const completeResultReady = (/** @type {RunState} */ state) => state.handoffs.every(handoff => handoff.state === 'consumed')
    && state.inFlight.length === 0
    && state.recovery.every((/** @type {{ outcome: string; }} */ record) => record.outcome !== 'pending')
    && state.steps.every((/** @type {{ state: string; }} */ step) => step.state === 'terminal')
    && state.cleanup.every((/** @type {{ outcome: string; }} */ record) => record.outcome !== 'pending')
    && state.plan.scenarios.every(scenario => {
        const records = state.steps.filter(step => step.scenarioId === scenario.archiveKind);
        const cleanup = state.cleanup.find(record => record.scenarioId === scenario.archiveKind);
        const archive = state.archives.find(record => record.archiveKind === scenario.archiveKind);
        if (cleanup === undefined || archive === undefined) return false;
        return archiveIneligibility({cleanup, records, scenarioId: scenario.archiveKind, state}) !== null
            || ['created', 'failed'].includes(archive.status);
    });

const buildCompleteResult = async (/** @type {{fileSystem: FileSystem, runPath: string, state: RunState}} */ {fileSystem, runPath, state}) => {
    /** @type {Record<string, Array<{scenarioId: string, stepId: string}>>} */
    const classifications = {diagnostic: [], formal: [], unresolved: []};
    for (const step of state.steps) {
        if (step.classification !== null) classifications[step.classification].push({scenarioId: step.scenarioId, stepId: step.stepId});
    }
    const successfulArchives = [];
    const scenarios = [];
    for (const scenario of state.plan.scenarios) {
        const records = state.steps.filter(step => step.scenarioId === scenario.archiveKind);
        const cleanup = state.cleanup.find(record => record.scenarioId === scenario.archiveKind);
        const archiveState = state.archives.find(record => record.archiveKind === scenario.archiveKind);
        if (cleanup === undefined || archiveState === undefined) throw releaseValidationOperationError('state-invalid', runPath);
        const ineligible = archiveIneligibility({cleanup, records, scenarioId: scenario.archiveKind, state});
        let archive = null;
        let archiveReason = ineligible;
        if (ineligible === null && archiveState.status === 'created') {
            const verified = await verifyReleaseEvidenceArchive({
                archiveKind: scenario.archiveKind,
                archivePath: archiveState.outputPath,
                sourceDirectory: archiveState.sourceDirectory,
            });
            archive = {
                archiveKind: scenario.archiveKind,
                entryCount: verified.entryCount,
                outputPath: archiveState.outputPath,
                status: 'created',
            };
            successfulArchives.push(archive);
        } else if (ineligible === null && archiveState.status === 'failed') {
            archiveReason = archiveState.reason;
        }
        scenarios.push({
            archive,
            archiveReason,
            machineKey: scenario.machineKey,
            scenarioId: scenario.archiveKind,
            steps: records.map(step => ({
                classification: step.classification,
                evidencePath: step.evidencePath,
                handoff: handoffSummary({state, step}),
                outcome: step.outcome,
                reason: step.reason,
                stepId: step.stepId,
            })),
        });
    }
    return {
        archives: successfulArchives,
        candidateCommit: state.candidateCommit,
        classifications,
        cleanup: state.cleanup.map(record => ({
            machineKey: record.machineKey,
            outcome: record.outcome,
            reason: record.reason,
            resultPath: record.resultPath,
            scenarioId: record.scenarioId,
            summary: record.outcome === 'passed' ? 'The scenario cleanup completed.' : record.reason?.message ?? 'The scenario cleanup failed.',
        })),
        registryDigest: state.plan.registryDigest,
        runId: state.runId,
        runPath,
        scenarios,
        schemaVersion: 1,
        status: 'completed',
    };
};

const completeRun = async (/** @type {{fileSystem: FileSystem, runPath: string, state: RunState}} */ {fileSystem, runPath, state}) => {
    if (!completeResultReady(state)) return state;
    let current = state;
    if (current.status !== 'completing' && current.status !== 'completed') {
        current = await commitRunTransition({
            fileSystem,
            nextState: {...current, status: 'completing'},
            runPath,
            state: current,
        });
    }
    const resultPath = join(dirname(runPath), 'result.json');
    let resultBytes;
    try {
        resultBytes = runStateBytes(await buildCompleteResult({fileSystem, runPath, state: current}));
    } catch {
        throw releaseValidationOperationError('state-invalid', runPath);
    }
    if (current.status !== 'completed') {
        try {
            await fileSystem.writeFile(resultPath, resultBytes, {encoding: 'utf8', flag: 'wx'});
        } catch (error) {
            if (errorCode(error) !== 'EEXIST') {
                await fileSystem.rm(resultPath, {force: true}).catch(() => {});
                throw releaseValidationOperationError('persistence-failed', runPath);
            }
            try {
                if (await fileSystem.readFile(resultPath, 'utf8') !== resultBytes) {
                    throw new Error('Existing complete result differs.');
                }
            } catch {
                throw releaseValidationOperationError('persistence-failed', runPath);
            }
        }
        current = await commitRunTransition({
            fileSystem,
            nextState: {...current, status: 'completed'},
            runPath,
            state: current,
        });
    }
    return current;
};

const reconcilePendingArchives = async (/** @type {{fileSystem: FileSystem, runPath: string, state: RunState}} */ {fileSystem, runPath, state}) => {
    const store = createTransitionStore({fileSystem, runPath, state});
    for (const pending of state.archives.filter((/** @type {{ status: string; }} */ record) => record.status === 'pending')) {
        if (pending.outputPath === null || pending.sourceDirectory === null) throw releaseValidationOperationError('state-invalid', runPath);
        let outputExists;
        try {
            const stats = await fileSystem.lstat(pending.outputPath);
            outputExists = stats.isFile() && !stats.isSymbolicLink();
            if (!outputExists) throw new Error('Pending archive output is not an ordinary file.');
        } catch (error) {
            if (errorCode(error) === 'ENOENT') outputExists = false;
            else {
                await store.update(current => ({
                    ...current,
                    archives: current.archives.map(record => record.archiveKind === pending.archiveKind
                        ? {...record, reason: {code: 'verify-failed', message: 'The pending release archive output is invalid.'}, status: 'failed'}
                        : record),
                }));
                continue;
            }
        }
        if (!outputExists) {
            try {
                await createReleaseEvidenceArchive({
                    archiveKind: pending.archiveKind,
                    outputPath: pending.outputPath,
                    sourceDirectory: pending.sourceDirectory,
                });
            } catch {
                await store.update(current => ({
                    ...current,
                    archives: current.archives.map(record => record.archiveKind === pending.archiveKind
                        ? {...record, reason: {code: 'create-failed', message: 'The pending release archive could not be created.'}, status: 'failed'}
                        : record),
                }));
                continue;
            }
        }
        try {
            await verifyReleaseEvidenceArchive({
                archiveKind: pending.archiveKind,
                archivePath: pending.outputPath,
                sourceDirectory: pending.sourceDirectory,
            });
            await store.update(current => ({
                ...current,
                archives: current.archives.map(record => record.archiveKind === pending.archiveKind
                    ? {...record, reason: null, status: 'created'}
                    : record),
            }));
        } catch {
            await store.update(current => ({
                ...current,
                archives: current.archives.map(record => record.archiveKind === pending.archiveKind
                    ? {...record, reason: {code: 'verify-failed', message: 'The pending release archive does not match its source.'}, status: 'failed'}
                    : record),
            }));
        }
    }
    return store.read();
};

const pausedRunResult = async (/** @type {{fileSystem: FileSystem, runPath: string, state: RunState}} */ {fileSystem, runPath, state}) => {
    const current = await completeRun({fileSystem, runPath, state});
    return {
    counts: {
        diagnostic: current.steps.filter(step => step.classification === 'diagnostic').length,
        formal: current.steps.filter(step => step.classification === 'formal').length,
        unresolved: current.steps.filter(step => step.classification === 'unresolved' || step.state !== 'terminal').length,
    },
    pendingPath: await writePendingManifest({fileSystem, runPath, state: current}),
    resultPath: current.status === 'completed' ? join(dirname(runPath), 'result.json') : null,
    runPath,
    status: current.status === 'completed' ? 'completed' : 'paused',
    };
};

/** @returns {RunState} */
const createInitialRunState = (/** @type {{configurationPath: string, maxParallelMachines: number, plan: ScenarioPlan, runId: string}} */ {configurationPath, maxParallelMachines, plan, runId}) => ({
    archives: plan.scenarios.map(scenario => ({
        archiveKind: scenario.archiveKind,
        outputPath: null,
        reason: {code: 'ineligible-unresolved', message: 'Release validation steps are not terminal.'},
        sourceDirectory: null,
        status: 'not-eligible',
    })),
    candidateCommit: plan.candidateCommit,
    cleanup: plan.scenarios.map(scenario => {
        if (scenario.machineKey === null) throw new Error('Release validation scenario requires a machine.');
        return {
            machineKey: scenario.machineKey,
            outcome: 'pending',
            reason: null,
            resultPath: null,
            scenarioId: scenario.archiveKind,
            stage: 'not-started',
        };
    }),
    configurationPath,
    handoffs: [],
    inFlight: [],
    maxParallelMachines,
    plan,
    recovery: [],
    revision: 0,
    runId,
    schemaVersion: 1,
    status: 'running',
    steps: plan.scenarios.flatMap(scenario => scenario.steps.map(step => ({
        classification: null,
        evidencePath: null,
        handoffId: null,
        outcome: null,
        reason: null,
        scenarioId: scenario.archiveKind,
        state: 'pending',
        stepId: step.stepId,
    }))),
});

const createTransitionStore = (/** @type {{fileSystem: FileSystem, runPath: string, state: RunState}} */ {fileSystem, runPath, state}) => {
    let current = state;
    let tail = Promise.resolve();
    return {
        read: async () => {
            await tail;
            return current;
        },
        update: (/** @type {(state: RunState) => RunState} */ transform) => {
            const operation = tail.then(async () => {
                const nextState = transform(current);
                current = await commitRunTransition({fileSystem, nextState, runPath, state: current});
                return current;
            });
            tail = operation.then(() => undefined, () => undefined);
            return operation;
        },
    };
};

/** @returns {LifecycleResult} */
const validateMachineLifecycleResult = (/** @type {{operation: string, result: unknown}} */ {operation, result}) => {
    if (exactKeys(result, ['code', 'message', 'operation', 'status'])
        && result.status === 'failed'
        && result.operation === operation
        && typeof result.operation === 'string'
        && typeof result.code === 'string'
        && ['observation-failed', 'process-failed', 'timeout'].includes(result.code)
        && typeof result.message === 'string'
        && result.message.length > 0) return {code: result.code, message: result.message, operation: result.operation, status: 'failed'};
    if (!exactKeys(result, ['observation', 'operation', 'status'])
        || result.status !== 'observed'
        || result.operation !== operation
        || result.observation === null
        || Array.isArray(result.observation)
        || typeof result.observation !== 'object') {
        throw releaseValidationOperationError('adapter-result-invalid');
    }
    const observation = result.observation;
    const valid = operation === 'read-power-state'
        ? exactKeys(observation, ['powerState']) && typeof observation.powerState === 'string' && ['powered-off', 'running', 'suspended'].includes(observation.powerState)
        : operation === 'hard-power-off'
            ? exactKeys(observation, ['powerState']) && observation.powerState === 'powered-off'
            : operation === 'soft-power-off'
                ? exactKeys(observation, ['powerOffMode', 'powerState'])
                    && observation.powerState === 'powered-off'
                    && typeof observation.powerOffMode === 'string'
                    && ['already-powered-off', 'hard-after-timeout', 'soft'].includes(observation.powerOffMode)
            : operation === 'read-snapshots'
                ? exactKeys(observation, ['currentSnapshot', 'snapshots'])
                    && Array.isArray(observation.snapshots)
                    && observation.snapshots.every(value => typeof value === 'string' && value.length > 0)
                    && JSON.stringify(observation.snapshots) === JSON.stringify([...new Set(observation.snapshots)].sort())
                    && (observation.currentSnapshot === null || typeof observation.currentSnapshot === 'string' && observation.snapshots.includes(observation.currentSnapshot))
                : operation === 'revert-snapshot'
                    ? exactKeys(observation, ['snapshot']) && typeof observation.snapshot === 'string' && observation.snapshot.length > 0
                    : operation === 'start-background'
                        ? exactKeys(observation, ['powerState']) && observation.powerState === 'running'
                        : operation === 'wait-guest-address'
                            ? exactKeys(observation, ['address']) && typeof observation.address === 'string' && observation.address.length > 0
                            : true;
    if (!valid) throw releaseValidationOperationError('adapter-result-invalid');
    return {observation, operation, status: 'observed'};
};

const inFlightOrder = (/** @type {{ machineKey: string; }} */ record) => RELEASE_MACHINE_KEYS.indexOf(record.machineKey);
const recoveryOperation = (/** @type {string} */ operation) => {
    /** @type {Record<string, string>} */
    const operations = {
    'hard-power-off': 'hard-power-off',
    'read-power-state': 'verify-powered-off',
    'read-snapshots': 'verify-snapshot',
    'revert-snapshot': 'revert-snapshot',
    };
    return operations[operation] ?? null;
};

const runLifecycleOperation = async (/** @type {{adapter: MachineLifecycleAdapter, machine: VmMachine, machineKey: string, operation: string, runPath: string, scenarioId: string, store: TransitionStore, workspaceDirectory: string}} */ {adapter, machine, machineKey, operation, runPath, scenarioId, store, workspaceDirectory}) => {
    let recoveryOwned = false;
    let captureOwned = false;
    await store.update(state => {
        recoveryOwned = state.recovery.some(record => record.machineKey === machineKey && record.outcome === 'pending');
        captureOwned = state.inFlight.some(record => record.machineKey === machineKey && record.operation === 'capture');
        if (recoveryOwned) {
            return {
                ...state,
                recovery: state.recovery.map(record => record.machineKey === machineKey
                    ? {...record, nextOperation: recoveryOperation(operation)}
                    : record),
            };
        }
        if (captureOwned) return state;
        return {
            ...state,
            inFlight: [...state.inFlight.filter(record => record.machineKey !== machineKey), {
                machineKey,
                operation,
                scenarioId,
                startedRevision: state.revision + 1,
                stepId: 'scenario-ready',
            }].sort((left, right) => inFlightOrder(left) - inFlightOrder(right)),
        };
    });
    let result;
    try {
        result = validateMachineLifecycleResult({
            operation,
            result: await adapter.run({machine, machineKey, operation, workspaceDirectory}),
        });
    } catch (error) {
        if (isReleaseValidationOperationError(error) && error.code === 'adapter-result-invalid') {
            throw {...error, runPath};
        }
        throw releaseValidationOperationError('adapter-result-invalid', runPath);
    }
    if (!recoveryOwned && !captureOwned) {
        await store.update(state => ({
            ...state,
            inFlight: state.inFlight.filter(record => record.machineKey !== machineKey),
        }));
    }
    return result;
};

const unresolvedMachineSteps = (/** @type {{machineKey: string, scenarioId: string, state: RunState}} */ {machineKey, scenarioId, state}) => ({
    ...state,
    steps: state.steps.map(step => state.plan.scenarios.find(scenario => scenario.archiveKind === step.scenarioId)?.machineKey === machineKey
        && step.state !== 'terminal'
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
        : step),
});

const lifecycleMismatch = (/** @type {string} */ operation, /** @type {string} */ message) => ({
    code: 'observation-failed',
    message,
    operation,
    status: 'failed',
});

const prepareReleaseScenario = async (/** @type {{configuration: VmConfiguration, fileSystem: FileSystem, guestAdapter: GuestAdapter, machine: {adapter: MachineLifecycleAdapter, value: VmMachine}, machineKey: string, processAdapter: HostProcessAdapter, runDirectory: string, runPath: string, scenario: MachineScenario, store: TransitionStore, workspaceBoundary: WorkspaceBoundary, workspaceDirectory: string}} */ {configuration, fileSystem, guestAdapter, machine, machineKey, processAdapter, runDirectory, runPath, scenario, store, workspaceBoundary, workspaceDirectory}) => {
    const snapshot = machine.value.snapshot;
    const firstStep = scenario.steps[0];
    if (typeof snapshot !== 'string' || firstStep === undefined) throw releaseValidationOperationError('adapter-result-invalid', runPath);
    const invoke = (/** @type {string} */ operation) => runLifecycleOperation({
        adapter: machine.adapter,
        machine: machine.value,
        machineKey,
        operation,
        runPath,
        scenarioId: scenario.archiveKind,
        store,
        workspaceDirectory,
    });
    let result = await invoke('read-power-state');
    if (result.status === 'failed') return result;
    if (result.observation.powerState !== 'powered-off') {
        result = await invoke('hard-power-off');
        if (result.status === 'failed') return result;
    }
    result = await invoke('read-snapshots');
    if (result.status === 'failed') return result;
    if (!Array.isArray(result.observation.snapshots) || !result.observation.snapshots.includes(snapshot)) {
        return lifecycleMismatch('read-snapshots', 'The configured release snapshot is unavailable.');
    }
    result = await invoke('revert-snapshot');
    if (result.status === 'failed') return result;
    if (result.observation.snapshot !== snapshot) {
        return lifecycleMismatch('revert-snapshot', 'The release snapshot revert returned the wrong identity.');
    }
    result = await invoke('read-power-state');
    if (result.status === 'failed') return result;
    if (result.observation.powerState !== 'powered-off') {
        return lifecycleMismatch('read-power-state', 'The release machine is not powered off after snapshot revert.');
    }
    result = await invoke('read-snapshots');
    if (result.status === 'failed') return result;
    if (result.observation.currentSnapshot !== snapshot) {
        return lifecycleMismatch('read-snapshots', 'The current release snapshot does not match the configured identity.');
    }
    result = await invoke('start-background');
    if (result.status === 'failed') return result;
    result = await invoke('wait-guest-address');
    if (result.status === 'failed') return result;
    if (typeof result.observation.address !== 'string') throw releaseValidationOperationError('adapter-result-invalid', runPath);
    await store.update(state => ({
        ...state,
        inFlight: [...state.inFlight.filter(record => record.machineKey !== machineKey), {
            machineKey,
            operation: 'run-guest',
            scenarioId: scenario.archiveKind,
            startedRevision: state.revision + 1,
            stepId: 'scenario-ready',
        }].sort((left, right) => inFlightOrder(left) - inFlightOrder(right)),
    }));
    try {
        const prepared = await runReleaseVmGuestStep({
            configuration,
            machineKey,
            scenarioId: scenario.archiveKind,
            stepId: firstStep.stepId,
            workspaceDirectory,
        }, {
            fileSystem,
            guestAdapter,
            plannedChoices: firstStep.choices,
            prepareOnly: true,
            processAdapter,
            runId: (await store.read()).runId,
            workspaceBoundary,
        });
        const readiness = scenarioReadinessFullResult({
            matchesExpected: true,
            scenarioId: scenario.archiveKind,
            summary: 'The scenario setup operations and observable state match the registered expectation.',
        });
        const readinessPath = join(runDirectory, 'scenario-facts', ...scenario.archiveKind.split('/'), 'scenario-ready.json');
        try {
            await fileSystem.mkdir(dirname(readinessPath), {recursive: true});
        } catch {
            throw releaseValidationOperationError('persistence-failed', runPath);
        }
        await writeReleaseEvidenceFiles({
            fileSystem,
            runPath,
            writes: [{bytes: runStateBytes(readiness), path: readinessPath}],
        });
        await store.update(state => ({
            ...state,
            inFlight: state.inFlight.filter(record => record.machineKey !== machineKey),
        }));
        return {address: result.observation.address, guestPreparationPath: prepared.resultPath, readinessPath, status: 'prepared'};
    } catch (error) {
        if (isReleaseValidationOperationError(error)) throw {...error, runPath};
        if (isAdapterResultInvalidError(error)) {
            await store.update(state => ({
                ...state,
                inFlight: state.inFlight.filter(record => record.machineKey !== machineKey),
            }));
            throw releaseValidationOperationError('adapter-result-invalid', runPath);
        }
        await store.update(state => ({
            ...state,
            inFlight: state.inFlight.filter(record => record.machineKey !== machineKey),
        }));
        return lifecycleMismatch('guest-scenario-prepare', error instanceof Error ? error.message : String(error));
    }
};

const processInitialMachineFailure = async (/** @type {{failure: {message: string}, fileSystem: FileSystem, idFactory: () => string, machine: {adapter: MachineLifecycleAdapter, value: VmMachine}, machineKey: string, runDirectory: string, scenarioId: string, store: TransitionStore, workspaceDirectory: string}} */ {failure, fileSystem, idFactory, machine, machineKey, runDirectory, scenarioId, store, workspaceDirectory}) => {
    const runPath = join(runDirectory, 'run.json');
    const result = scenarioReadinessFullResult({
        matchesExpected: false,
        scenarioId,
        summary: failure.message,
    });
    const resultPath = await persistRunResult({fileSystem, idFactory, result, runPath});
    await store.update(state => ({
        ...state,
        cleanup: state.cleanup.map(record => record.scenarioId === scenarioId
            ? {...record, resultPath, stage: 'failure-hold'}
            : record),
    }));
    for (const operation of ['hard-power-off', 'read-power-state']) {
        const result = await runLifecycleOperation({
            adapter: machine.adapter,
            machine: machine.value,
            machineKey,
            operation,
            runPath,
            scenarioId,
            store,
            workspaceDirectory,
        });
        if (result.status === 'failed') {
            await store.update(state => unresolvedMachineSteps({
                machineKey,
                scenarioId,
                state: {
                    ...state,
                    cleanup: state.cleanup.map((record, index) => index >= state.plan.scenarios
                        .findIndex(item => item.archiveKind === scenarioId)
                        && state.plan.scenarios[index].machineKey === machineKey
                            ? {
                                ...record,
                                outcome: 'failed',
                                reason: {code: 'failure-hold-failed', message: result.message, source: null},
                                stage: 'final',
                            }
                            : record),
                },
            }));
            return;
        }
    }
    await store.update(state => unresolvedMachineSteps({
        machineKey,
        scenarioId,
        state: {
            ...state,
            cleanup: state.cleanup.map(record => record.scenarioId === scenarioId
                ? {...record, outcome: 'passed', reason: null}
                : record),
        },
    }));
    await appendCompensationAuthorization({
        fileSystem,
        idFactory,
        result,
        resultPath,
        runPath,
        scenarioId,
        stepId: 'scenario-ready',
        store,
    });
};

const scenarioReadinessCheckResult = (/** @type {{matchesExpected: boolean, scenarioId: string, summary: string}} */ {matchesExpected, scenarioId, summary}) => ({
    evaluation: 'observable-state',
    matchesExpected,
    observableState: {matchesExpected, summary},
    operationEvidence: {matchesExpected: null, summary: null},
    scenarioId,
    status: 'evaluated',
    summary,
});

const scenarioReadinessFullResult = (/** @type {{matchesExpected: boolean, scenarioId: string, summary: string}} */ {matchesExpected, scenarioId, summary}) => ({
    evaluation: 'full',
    matchesExpected,
    observableState: {matchesExpected, summary},
    operationEvidence: {matchesExpected, summary},
    scenarioId,
    status: 'evaluated',
    summary,
});

const CONFIGURATION_RELATIVE_PATH = '.agent-repository-workflow/config.json';
const UNKNOWN_CONTENT_RELATIVE_PATH = '.agent-repository-workflow/release-validation-unknown.txt';
const UNKNOWN_CONTENT_BYTES = Buffer.from('release validation unknown content\n').toString('base64');
const PROFILE_MARKER_START = '# >>> agent-repository-workflow PATH >>>';
const PROFILE_MARKER_END = '# <<< agent-repository-workflow PATH <<<';

/** @typedef {{bytesBase64: string | null, path: string, type: string}} CapturedFactEntry */
/** @typedef {{after: CapturedFactEntry[], before: CapturedFactEntry[]}} CapturedFacts */
/** @typedef {{bytesBase64: string | null, exists: boolean}} ProfileObservation */
/** @typedef {{effectiveEntries: string[], exists: boolean, kind: string | null, value: string}} WindowsPathObservation */
/** @typedef {{configurationExists: boolean, installationDirectoryExists: boolean, launcherResolved?: boolean, managedFilesExist: boolean, profile: ProfileObservation | null, testResidueExists: boolean, windowsPath: WindowsPathObservation | null}} InstallationStateRecord */
/** @typedef {{baseline: InstallationStateRecord, final: InstallationStateRecord}} InstallationFinalObservation */

const canonicalBase64 = (/** @type {unknown} */ value) => typeof value === 'string' && Buffer.from(value, 'base64').toString('base64') === value;

/** @returns {CapturedFactEntry[]} */
const validateCapturedFactSnapshot = (/** @type {unknown} */ snapshot) => {
    if (!Array.isArray(snapshot)) throw new Error('Release mechanical captured facts are invalid.');
    let previous = null;
    for (const entry of snapshot) {
        if (!exactKeys(entry, ['bytesBase64', 'path', 'type'])
            || typeof entry.path !== 'string'
            || typeof entry.type !== 'string'
            || !isSafeReleaseRelativePath(entry.path)
            || !['ordinary-file', 'directory', 'symbolic-link', 'special'].includes(entry.type)
            || entry.type === 'ordinary-file' && !canonicalBase64(entry.bytesBase64)
            || entry.type !== 'ordinary-file' && entry.bytesBase64 !== null
            || previous !== null && compareText(previous, entry.path) >= 0) {
            throw new Error('Release mechanical captured facts are invalid.');
        }
        previous = entry.path;
    }
    return snapshot;
};

/** @returns {CapturedFacts} */
const canonicalCapturedFacts = (/** @type {unknown} */ capturedFacts) => {
    if (!exactKeys(capturedFacts, ['after', 'before'])) throw new Error('Release mechanical captured facts are invalid.');
    const before = validateCapturedFactSnapshot(capturedFacts.before);
    const after = validateCapturedFactSnapshot(capturedFacts.after);
    return {after, before};
};

const releaseFactDelta = (/** @type {unknown} */ capturedFacts) => {
    const {after, before} = canonicalCapturedFacts(capturedFacts);
    const beforeByPath = new Map(before.map(entry => [entry.path, entry]));
    const afterByPath = new Map(after.map(entry => [entry.path, entry]));
    return [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])].sort(compareText).flatMap(path => {
        const prior = beforeByPath.get(path);
        const current = afterByPath.get(path);
        if (prior === undefined) return [{changeType: 'added', path}];
        if (current === undefined) return [{changeType: 'deleted', path}];
        if (prior.type !== current.type) return [{changeType: 'type-changed', path}];
        return JSON.stringify(prior) === JSON.stringify(current) ? [] : [{changeType: 'modified', path}];
    });
};

/** @returns {JsonObject} */
const jsonClone = (/** @type {JsonObject} */ value) => JSON.parse(JSON.stringify(value));
/** @returns {value is JsonObject} */
const validPlainObject = (/** @type {unknown} */ value) => value !== null && !Array.isArray(value) && typeof value === 'object';

const expectedConfigAfter = (/** @type {unknown} */ beforeConfig) => {
    if (!validPlainObject(beforeConfig) || !validPlainObject(beforeConfig.editor)) return null;
    const expected = jsonClone(beforeConfig);
    if (!validPlainObject(expected.editor)) return null;
    expected.editor.command = 'release-validation-editor';
    return expected;
};

const FINITE_ENTRY_TYPES = Object.freeze(['directory', 'ordinary-file', 'special', 'symbolic-link']);

const validateFiniteFailureEvidence = (/** @type {{code: string, evidence: unknown, operationContract: string}} */ {code, evidence, operationContract}) => {
    const exactPath = (/** @type {string} */ path) => exactKeys(evidence, ['path']) && evidence.path === path;
    const exactEntry = (/** @type {string} */ path) => exactKeys(evidence, ['entryType', 'path'])
        && typeof evidence.entryType === 'string'
        && FINITE_ENTRY_TYPES.includes(evidence.entryType)
        && evidence.path === path;
    if (code === 'unsafe-parent'
        && ['add-unknown-content', 'prepare-preserved-configuration', 'remove-test-residue'].includes(operationContract)) {
        return (exactKeys(evidence, ['path']) || exactKeys(evidence, ['entryType', 'path'])
                && typeof evidence.entryType === 'string'
                && FINITE_ENTRY_TYPES.includes(evidence.entryType))
            && typeof evidence.path === 'string'
            && ['.', '.agent-repository-workflow'].includes(evidence.path);
    }
    if (operationContract === 'prepare-preserved-configuration') {
        if (code === 'config-not-ordinary') return exactEntry(CONFIGURATION_RELATIVE_PATH);
        return ['config-invalid-json', 'config-missing', 'editor-not-object', 'final-read-failed', 'write-failed'].includes(code)
            && exactPath(CONFIGURATION_RELATIVE_PATH);
    }
    if (operationContract === 'add-unknown-content') {
        if (code === 'target-exists') return exactEntry(UNKNOWN_CONTENT_RELATIVE_PATH);
        return ['exclusive-write-failed', 'final-read-failed'].includes(code)
            && exactPath(UNKNOWN_CONTENT_RELATIVE_PATH);
    }
    if (operationContract === 'remove-test-residue') {
        if (code === 'target-not-ordinary') return exactEntry(UNKNOWN_CONTENT_RELATIVE_PATH);
        if (code === 'parent-cleanup-failed') return exactPath('.agent-repository-workflow');
        return [
            'content-changed',
            'final-read-failed',
            'source-record-missing',
            'target-missing',
            'unlink-failed',
        ].includes(code) && exactPath(UNKNOWN_CONTENT_RELATIVE_PATH);
    }
    if (operationContract === 'observe-installation-final-state') {
        if (code === 'observation-failed') {
            return exactKeys(evidence, ['observation'])
                && typeof evidence.observation === 'string'
                && ['installation', 'profile', 'windows-path'].includes(evidence.observation);
        }
        if (code === 'profile-not-ordinary') return exactEntry('.profile');
        if (code === 'shell-check-failed') {
            return exactKeys(evidence, ['shell']) && typeof evidence.shell === 'string' && ['login-shell', 'powershell'].includes(evidence.shell);
        }
        return code === 'unsupported-path-kind'
            && exactKeys(evidence, ['kind'])
            && evidence.kind !== undefined;
    }
    return false;
};

const validateFiniteFailureResult = (/** @type {{operationActual: unknown, operationContract: string}} */ {operationActual, operationContract}) => exactKeys(operationActual, [
    'code',
    'evidence',
    'message',
    'operationContract',
    'status',
]) && operationActual.operationContract === operationContract
    && operationActual.status === 'failed'
    && typeof operationActual.code === 'string'
    && typeof operationActual.message === 'string'
    && operationActual.message.length > 0
    && validateFiniteFailureEvidence({
        code: operationActual.code,
        evidence: operationActual.evidence,
        operationContract,
    });

const validateFiniteOperationResultShape = (/** @type {{mechanicalContract: string, operationActual: unknown}} */ {mechanicalContract, operationActual}) => {
    /** @type {Record<string, string>} */
    const operationContracts = {
        'installation-final-state': 'observe-installation-final-state',
        'preserved-configuration-prepared': 'prepare-preserved-configuration',
        'test-residue-removed': 'remove-test-residue',
        'unknown-content-added': 'add-unknown-content',
    };
    const operationContract = operationContracts[mechanicalContract];
    if (operationContract === undefined) return null;
    if (isJsonObject(operationActual) && operationActual.status === 'failed') {
        return validateFiniteFailureResult({operationActual, operationContract}) ? 'failed' : false;
    }
    if (!exactKeys(operationActual, ['actual', 'operationContract', 'status'])
        || operationActual.operationContract !== operationContract
        || operationActual.status !== 'completed') return false;
    const actual = operationActual.actual;
    if (mechanicalContract === 'preserved-configuration-prepared') {
        return exactKeys(actual, ['afterConfig', 'beforeConfig', 'path'])
            && typeof actual.path === 'string'
            && validPlainObject(actual.beforeConfig)
            && validPlainObject(actual.beforeConfig.editor)
            && validPlainObject(actual.afterConfig)
            && validPlainObject(actual.afterConfig.editor);
    }
    if (mechanicalContract === 'unknown-content-added') {
        return exactKeys(actual, ['bytesBase64', 'path'])
            && canonicalBase64(actual.bytesBase64)
            && typeof actual.path === 'string';
    }
    if (mechanicalContract === 'test-residue-removed') {
        return exactKeys(actual, ['existsAfter', 'path', 'removedBytesBase64'])
            && typeof actual.existsAfter === 'boolean'
            && typeof actual.path === 'string'
            && canonicalBase64(actual.removedBytesBase64);
    }
    return validateInstallationFinalObservation(actual);
};

const validateCompletedOperation = (/** @type {{mechanicalContract: string, mechanicalParameters: unknown, operationActual: unknown}} */ {mechanicalContract, mechanicalParameters, operationActual}) => {
    if ([
        'esm-syntax-observation',
        'installation-transition',
        'launcher-observation',
        'repository-verification',
        'repository-workflow-transition',
    ].includes(mechanicalContract) && !validateProcessObservation(operationActual)) {
        throw new Error('Release command operation result is invalid.');
    }
    if (mechanicalContract === 'repository-verification') {
        return repositoryVerificationObservationMatches({mechanicalParameters, observation: operationActual});
    }
    if (mechanicalContract === 'launcher-observation') {
        return launcherObservationMatches({mechanicalParameters, observation: operationActual});
    }
    if (mechanicalContract === 'esm-syntax-observation') {
        return esmSyntaxObservationMatches({mechanicalParameters, observation: operationActual});
    }
    if (['installation-transition', 'repository-workflow-transition'].includes(mechanicalContract)) {
        return exactKeys(operationActual, ['exitCode', 'stderr', 'stdout'])
            && Number.isSafeInteger(operationActual.exitCode)
            && typeof operationActual.stderr === 'string'
            && typeof operationActual.stdout === 'string'
            && (mechanicalContract === 'installation-transition'
                && isJsonObject(mechanicalParameters) && mechanicalParameters.action === 'reject-default-downgrade'
                ? operationActual.exitCode !== 0
                : operationActual.exitCode === 0);
    }
    const validFiniteShape = validateFiniteOperationResultShape({mechanicalContract, operationActual});
    if (validFiniteShape === false) throw new Error('Release finite operation result is invalid.');
    if (validFiniteShape === 'failed') return false;
    if (!isJsonObject(operationActual)) throw new Error('Release finite operation result is invalid.');
    const actual = operationActual.actual;
    if (mechanicalContract === 'preserved-configuration-prepared') {
        return exactKeys(actual, ['afterConfig', 'beforeConfig', 'path'])
            && actual.path === CONFIGURATION_RELATIVE_PATH
            && JSON.stringify(actual.afterConfig) === JSON.stringify(expectedConfigAfter(actual.beforeConfig));
    }
    if (mechanicalContract === 'unknown-content-added') {
        return exactKeys(actual, ['bytesBase64', 'path'])
            && actual.path === UNKNOWN_CONTENT_RELATIVE_PATH
            && actual.bytesBase64 === UNKNOWN_CONTENT_BYTES;
    }
    if (mechanicalContract === 'test-residue-removed') {
        return exactKeys(actual, ['existsAfter', 'path', 'removedBytesBase64'])
            && actual.existsAfter === false
            && actual.path === UNKNOWN_CONTENT_RELATIVE_PATH
            && actual.removedBytesBase64 === UNKNOWN_CONTENT_BYTES;
    }
    return validateInstallationFinalObservation(actual);
};

/** @returns {value is ProfileObservation} */
const validateProfileObservation = (/** @type {unknown} */ value) => exactKeys(value, ['bytesBase64', 'exists'])
    && typeof value.exists === 'boolean'
    && (value.exists
        ? canonicalBase64(value.bytesBase64)
        : value.bytesBase64 === null);

/** @returns {value is WindowsPathObservation} */
const validateWindowsPathObservation = (/** @type {unknown} */ value) => exactKeys(value, ['effectiveEntries', 'exists', 'kind', 'value'])
    && typeof value.exists === 'boolean'
    && Array.isArray(value.effectiveEntries)
    && value.effectiveEntries.every(entry => typeof entry === 'string')
    && (value.exists
        ? typeof value.kind === 'string' && ['String', 'ExpandString'].includes(value.kind) && typeof value.value === 'string'
        : value.kind === null && value.value === '');

/** @returns {value is InstallationStateRecord} */
const validateFinalStateRecord = (/** @type {unknown} */ value, /** @type {boolean} */ final) => exactKeys(value, [
    'configurationExists',
    'installationDirectoryExists',
    ...(final ? ['launcherResolved'] : []),
    'managedFilesExist',
    'profile',
    'testResidueExists',
    'windowsPath',
]) && [
    value.configurationExists,
    value.installationDirectoryExists,
    value.managedFilesExist,
    value.testResidueExists,
    ...(final ? [value.launcherResolved] : []),
].every(item => typeof item === 'boolean')
    && (value.profile === null && validateWindowsPathObservation(value.windowsPath)
        || value.windowsPath === null && validateProfileObservation(value.profile));

/**
 * @param {unknown} value
 * @returns {value is InstallationFinalObservation}
 */
function validateInstallationFinalObservation(value) {
    return exactKeys(value, ['baseline', 'final'])
        && validateFinalStateRecord(value.baseline, false)
        && validateFinalStateRecord(value.final, true)
        && (value.baseline.profile === null) === (value.final.profile === null);
}

const validateFiniteCurrentObservationShape = (/** @type {{currentObservation: unknown, mechanicalContract: string}} */ {currentObservation, mechanicalContract}) => {
    if (mechanicalContract === 'preserved-configuration-prepared') {
        return exactKeys(currentObservation, ['config', 'path'])
            && validPlainObject(currentObservation.config)
            && typeof currentObservation.path === 'string';
    }
    if (mechanicalContract === 'unknown-content-added') {
        return exactKeys(currentObservation, ['bytesBase64', 'entryType', 'path'])
            && canonicalBase64(currentObservation.bytesBase64)
            && typeof currentObservation.entryType === 'string'
            && FINITE_ENTRY_TYPES.includes(currentObservation.entryType)
            && typeof currentObservation.path === 'string';
    }
    if (mechanicalContract === 'test-residue-removed') {
        return exactKeys(currentObservation, ['exists', 'path'])
            && typeof currentObservation.exists === 'boolean'
            && typeof currentObservation.path === 'string';
    }
    if (mechanicalContract === 'installation-final-state') {
        return validateInstallationFinalObservation(currentObservation);
    }
    return null;
};

const normalizeWindowsPathUnit = (/** @type {string} */ value) => {
    let output = value;
    if (output.length >= 2 && output.startsWith('"') && output.endsWith('"')) output = output.slice(1, -1);
    output = output.toLowerCase();
    while (output.length > 0 && /[\\/]$/.test(output)) output = output.slice(0, -1);
    return output;
};

const normalizeWindowsPathUnits = (/** @type {string[]} */ units) => {
    const output = [...units];
    while (output.at(-1) === '') output.pop();
    return output.map(normalizeWindowsPathUnit);
};

const logicalWindowsPathUnits = (/** @type {string} */ value) => normalizeWindowsPathUnits(value.split(';'));

const isArwPathUnit = (/** @type {string} */ value) => /(?:^|[\\/])\.agent-repository-workflow$/i.test(normalizeWindowsPathUnit(value));

const retainsRelativeOrder = (/** @type {string[]} */ before, /** @type {string[]} */ after) => {
    let index = 0;
    const normalizedAfter = normalizeWindowsPathUnits(after);
    for (const value of normalizeWindowsPathUnits(before)) {
        index = normalizedAfter.indexOf(value, index);
        if (index < 0) return false;
        index += 1;
    }
    return true;
};

const windowsFinalStateMatches = (/** @type {InstallationFinalObservation} */ {baseline, final}) => {
    const before = baseline.windowsPath;
    const after = final.windowsPath;
    if (before === null || after === null) return false;
    if (before.exists !== after.exists || before.kind !== after.kind) return false;
    const beforeUnits = logicalWindowsPathUnits(before.value);
    const afterUnits = logicalWindowsPathUnits(after.value);
    return beforeUnits.length === afterUnits.length
        && beforeUnits.every((value, index) => value === afterUnits[index])
        && !afterUnits.some(isArwPathUnit)
        && !after.effectiveEntries.some(isArwPathUnit)
        && retainsRelativeOrder(before.effectiveEntries, after.effectiveEntries);
};

const profileBytes = (/** @type {ProfileObservation} */ observation) => observation.exists && typeof observation.bytesBase64 === 'string' ? Buffer.from(observation.bytesBase64, 'base64') : Buffer.alloc(0);
const hasArwProfileBehavior = (/** @type {Buffer<ArrayBuffer>} */ bytes) => {
    const text = bytes.toString('utf8');
    return text.includes(PROFILE_MARKER_START)
        || text.includes(PROFILE_MARKER_END)
        || text.split(/\r?\n/).some((/** @type {string} */ line) => /^\s*export\s+PATH\s*=.*(?:\$HOME|\$\{HOME\})[\\/]\.agent-repository-workflow(?:[\\/]|:)/.test(line));
};

const linuxFinalStateMatches = (/** @type {InstallationFinalObservation} */ {baseline, final}) => {
    if (baseline.profile === null || final.profile === null) return false;
    const before = profileBytes(baseline.profile);
    const after = profileBytes(final.profile);
    if (hasArwProfileBehavior(after)) return false;
    if (before.length === 0) return after.length === 0;
    return before.equals(after);
};

const installationFinalObservationMatches = (/** @type {{configuration: unknown, currentObservation: unknown, testResidue: unknown}} */ {configuration, currentObservation, testResidue}) => {
    if (typeof configuration !== 'string'
        || !['absent', 'preserved'].includes(configuration)
        || typeof testResidue !== 'boolean'
        || !validateInstallationFinalObservation(currentObservation)) return false;
    const {baseline, final} = currentObservation;
    if (final.managedFilesExist || final.launcherResolved) return false;
    const configurationExists = configuration === 'preserved';
    if (final.configurationExists !== configurationExists
        || final.testResidueExists !== testResidue
        || (configurationExists || testResidue) && !final.installationDirectoryExists) return false;
    return baseline.profile === null
        ? windowsFinalStateMatches(currentObservation)
        : linuxFinalStateMatches(currentObservation);
};

const installationFinalStateMatches = (/** @type {{capturedFacts: unknown, currentObservation: unknown, mechanicalParameters: unknown}} */ {capturedFacts, currentObservation, mechanicalParameters}) => exactKeys(mechanicalParameters, ['configuration'])
    && releaseFactDelta(capturedFacts).length === 0
    && installationFinalObservationMatches({
        configuration: mechanicalParameters.configuration,
        currentObservation,
        testResidue: false,
    });

/** @returns {value is {shell: string, sourceAvailable: boolean, version: string}} */
const validateLauncherParameters = (/** @type {unknown} */ value) => exactKeys(value, ['shell', 'sourceAvailable', 'version'])
    && typeof value.shell === 'string'
    && ['powershell', 'cmd', 'git-bash', 'login-shell', 'direct'].includes(value.shell)
    && typeof value.sourceAvailable === 'boolean'
    && isStableReleaseTag(value.version);

const launcherStdoutMatches = (/** @type {{shell: string, stdout: string, version: string}} */ {shell, stdout, version}) => {
    if (shell === 'direct') return stdout === `${version}\n`;
    const firstLineEnd = stdout.indexOf('\n');
    if (firstLineEnd === -1) return false;
    const secondLineEnd = stdout.indexOf('\n', firstLineEnd + 1);
    return secondLineEnd !== -1
        && stdout.slice(firstLineEnd + 1, secondLineEnd + 1) === `${version}\n`;
};

const launcherObservationMatches = (/** @type {{mechanicalParameters: unknown, observation: unknown}} */ {mechanicalParameters, observation}) => validateLauncherParameters(mechanicalParameters)
    && validateProcessObservation(observation)
    && observation.exitCode === 0
    && observation.stderr === ''
    && launcherStdoutMatches({
        shell: mechanicalParameters.shell,
        stdout: observation.stdout,
        version: mechanicalParameters.version,
    });

/** @returns {value is {entries: string[], runtime: 'minimum'}} */
const validateEsmSyntaxParameters = (/** @type {unknown} */ value) => exactKeys(value, ['entries', 'runtime'])
    && value.runtime === 'minimum'
    && Array.isArray(value.entries)
    && value.entries.every(entry => typeof entry === 'string')
    && JSON.stringify(value.entries) === JSON.stringify(RELEASE_ESM_LIFECYCLE_ENTRIES);

const expectedEsmSyntaxStdout = (/** @type {readonly string[]} */ entries) => `${JSON.stringify(entries.map(path => ({
    exitCode: 0,
    path,
    stderr: '',
    stdout: '',
})))}\n`;

const esmSyntaxObservationMatches = (/** @type {{mechanicalParameters: unknown, observation: unknown}} */ {mechanicalParameters, observation}) => validateEsmSyntaxParameters(mechanicalParameters)
    && validateProcessObservation(observation)
    && observation.exitCode === 0
    && observation.stderr === ''
    && observation.stdout === expectedEsmSyntaxStdout(mechanicalParameters.entries);

/** @type {Readonly<Record<string, string>>} */
const CODE_MAP_FINDING_MESSAGES = Object.freeze({
    'missing-code-map-readme': 'Required Code Map README is missing; audit complete configured coverage.',
    'ordinary-readme-at-code-map-path': 'Required Code Map path contains an ordinary README; Human choice is required.',
});

/** @returns {findings is Array<{code: string, path: string}>} */
const validateExpectedFindings = (/** @type {unknown} */ findings) => {
    if (!Array.isArray(findings)) return false;
    /** @type {string[]} */
    const identities = [];
    for (const finding of findings) {
        if (!exactKeys(finding, ['code', 'path'])
            || typeof finding.code !== 'string'
            || !Object.hasOwn(CODE_MAP_FINDING_MESSAGES, finding.code)
            || typeof finding.path !== 'string'
            || !isSafeReleaseRelativePath(finding.path)) return false;
        identities.push(`${finding.path}\0${finding.code}`);
    }
    return new Set(identities).size === identities.length;
};

/** @returns {findings is Array<{code: string, path: string}>} */
const validateExpectedCodeMapFindings = (/** @type {unknown} */ findings) => validateExpectedFindings(findings)
    && findings.every((finding, index) => index === 0
        || `${findings[index - 1].path}\0${findings[index - 1].code}` < `${finding.path}\0${finding.code}`);

/** @returns {findings is Array<{code: string, path: string}>} */
const validateExpectedWorkflowFindings = (/** @type {unknown} */ findings) => validateExpectedFindings(findings)
    && findings.every((finding, index) => index === 0
        || `${findings[index - 1].path}\0${findings[index - 1].code}`.localeCompare(`${finding.path}\0${finding.code}`, 'en') < 0);

const renderExpectedCodeMapFindings = (/** @type {Array<{code: string, path: string}>} */ findings) => findings.map(finding => (
    `[phase 3] ${finding.code} path=${finding.path}: ${CODE_MAP_FINDING_MESSAGES[finding.code] ?? ''}\n`
)).join('');

/** @returns {mechanicalParameters is {expectedFindings: Array<{code: string, path: string}>, kind: 'code-map' | 'workflow'}} */
const validateRepositoryVerificationParameters = (/** @type {unknown} */ mechanicalParameters) => (
    exactKeys(mechanicalParameters, ['expectedFindings', 'kind'])
    && ((mechanicalParameters.kind === 'workflow'
        && validateExpectedWorkflowFindings(mechanicalParameters.expectedFindings))
        || (mechanicalParameters.kind === 'code-map'
            && validateExpectedCodeMapFindings(mechanicalParameters.expectedFindings)))
);

const expectedFindingsObservationMatches = (/** @type {{expectedFindings: Array<{code: string, path: string}>, observation: ProcessObservation}} */ {expectedFindings, observation}) => {
    if (expectedFindings.length === 0) return observation.exitCode === 0 && observation.stderr === '';
    return observation.exitCode === 1
        && observation.stdout === ''
        && observation.stderr === renderExpectedCodeMapFindings(expectedFindings);
};

const repositoryVerificationObservationMatches = (/** @type {{mechanicalParameters: unknown, observation: unknown}} */ {mechanicalParameters, observation}) => {
    if (!validateProcessObservation(observation)
        || !validateRepositoryVerificationParameters(mechanicalParameters)) return false;
    return expectedFindingsObservationMatches({expectedFindings: mechanicalParameters.expectedFindings, observation});
};

const evaluateReadOnlyCommandState = (/** @type {{capturedFacts: CapturedFacts, currentObservation: unknown, mechanicalContract: string, mechanicalParameters: unknown}} */ {capturedFacts, currentObservation, mechanicalContract, mechanicalParameters}) => {
    const parametersValid = mechanicalContract === 'launcher-observation'
        ? validateLauncherParameters(mechanicalParameters)
        : mechanicalContract === 'esm-syntax-observation'
            ? validateEsmSyntaxParameters(mechanicalParameters)
            : validateRepositoryVerificationParameters(mechanicalParameters);
    if (!parametersValid || !validateProcessObservation(currentObservation)) {
        throw new Error('Release command mechanical observation is invalid.');
    }
    const delta = releaseFactDelta(capturedFacts);
    return {
        delta,
        fileMatches: new Map(),
        matchesExpected: (mechanicalContract === 'repository-verification'
            ? repositoryVerificationObservationMatches({mechanicalParameters, observation: currentObservation})
            : mechanicalContract === 'launcher-observation'
                ? launcherObservationMatches({mechanicalParameters, observation: currentObservation})
                : esmSyntaxObservationMatches({mechanicalParameters, observation: currentObservation})) && delta.length === 0,
    };
};

const validateWorkflowPlan = (/** @type {{expectedProfile: unknown, mechanicalParameters: unknown, plan: unknown}} */ {expectedProfile, mechanicalParameters, plan}) => {
    if (!exactKeys(mechanicalParameters, ['expectedVerificationFindings', 'operation', 'profile', 'retainedPaths'])
        || !validateExpectedWorkflowFindings(mechanicalParameters.expectedVerificationFindings)
        || typeof mechanicalParameters.operation !== 'string'
        || typeof mechanicalParameters.profile !== 'string') throw new Error('Release workflow observation is invalid.');
    if (!isJsonObject(plan)) throw new Error('Release workflow observation is invalid.');
    const expectedOperation = mechanicalParameters.operation === 'reinit' ? 'init' : mechanicalParameters.operation;
    const planShapeValid = exactKeys(plan, ['diagnostics', 'operation', 'operations', 'profile']);
    if (!['init', 'update', 'remove', 'reinit'].includes(mechanicalParameters.operation)
        || !['plain', 'agent-assisted'].includes(mechanicalParameters.profile)
        || !Array.isArray(mechanicalParameters.retainedPaths)
        || mechanicalParameters.retainedPaths.some((/** @type {unknown} */ path) => !isSafeReleaseRelativePath(path))
        || JSON.stringify(mechanicalParameters.retainedPaths)
            !== JSON.stringify([...new Set(mechanicalParameters.retainedPaths)].sort(compareText))
        || mechanicalParameters.operation !== 'remove' && mechanicalParameters.retainedPaths.length !== 0
        || !planShapeValid
        || !Array.isArray(plan.diagnostics)
        || plan.diagnostics.length !== 0
        || !Array.isArray(plan.operations)
        || plan.operation !== expectedOperation
        || JSON.stringify(plan.profile) !== JSON.stringify(expectedProfile)) {
        throw new Error('Release workflow observation is invalid.');
    }
    const paths = new Set();
    for (const operation of plan.operations) {
        const required = operation.action === 'write' ? ['action', 'bytes', 'path'] : ['action', 'path'];
        if (!['write', 'delete'].includes(operation.action)
            || !exactKeys(operation, required)
            || typeof operation.path !== 'string'
            || !isSafeReleaseRelativePath(operation.path)
            || paths.has(operation.path)
            || operation.action === 'write' && !canonicalBase64(operation.bytes)) {
            throw new Error('Release workflow observation is invalid.');
        }
        paths.add(operation.path);
    }
    return plan;
};

const expectedReleaseWorkflowProfile = (/** @type {string} */ profile) => profile === 'plain'
    ? {
        codeMaps: {excludes: [], includes: [], roots: []},
        domainLayout: 'single-context',
        platforms: ['claude-code', 'codex'],
    }
    : {
        codeMaps: {excludes: [], includes: ['src/**/*'], roots: ['src']},
        domainLayout: 'single-context',
        platforms: ['codex'],
    };

const parseReleaseWorkflowLockFact = (/** @type {CapturedFactEntry | undefined} */ entry) => {
    if (entry?.type !== 'ordinary-file' || typeof entry.bytesBase64 !== 'string' || !canonicalBase64(entry.bytesBase64)) return null;
    try {
        return parseWorkflowLock(Buffer.from(entry.bytesBase64, 'base64').toString('utf8'));
    } catch {
        return null;
    }
};

const releaseMarkerOffsets = (/** @type {string} */ text, /** @type {string} */ marker) => {
    /** @type {number[]} */
    const offsets = [];
    let offset = text.indexOf(marker);
    while (offset !== -1) {
        offsets.push(offset);
        offset = text.indexOf(marker, offset + marker.length);
    }
    return offsets;
};

const releaseManagedSpan = (/** @type {{bytes: Buffer, documentOwnership: string}} */ {bytes, documentOwnership}) => {
    const text = bytes.toString('utf8');
    const managedStart = '<!-- arw:managed:start -->';
    const managedEnd = '<!-- arw:managed:end -->';
    const repositoryStart = '<!-- arw:repository-owned:start -->';
    const repositoryEnd = '<!-- arw:repository-owned:end -->';
    const starts = releaseMarkerOffsets(text, managedStart);
    const ends = releaseMarkerOffsets(text, managedEnd);
    const repositoryStarts = releaseMarkerOffsets(text, repositoryStart);
    const repositoryEnds = releaseMarkerOffsets(text, repositoryEnd);
    if (starts.length !== 1 || ends.length !== 1 || starts[0] >= ends[0]) return null;
    const end = ends[0] + managedEnd.length;
    if (documentOwnership === 'repository-major') {
        if (repositoryStarts.length !== 0 || repositoryEnds.length !== 0) return null;
    } else if (documentOwnership === 'baseline-major') {
        if (starts[0] !== 0
            || repositoryStarts.length !== 1
            || repositoryEnds.length !== 1
            || repositoryStarts[0] !== end + 1
            || text.slice(end, repositoryStarts[0]) !== '\n'
            || repositoryStarts[0] >= repositoryEnds[0]
            || repositoryEnds[0] + repositoryEnd.length !== text.length - 1
            || !text.endsWith('\n')) return null;
    } else {
        return null;
    }
    return text.slice(starts[0], end);
};

const releaseWorkflowManagedRecordMatches = (/** @type {{after: Map<string, CapturedFactEntry>, record: unknown}} */ {after, record}) => {
    const documentOwnership = isJsonObject(record) ? record.documentOwnership : undefined;
    if (!isJsonObject(record)
        || typeof record.path !== 'string'
        || typeof record.kind !== 'string'
        || typeof record.hash !== 'string'
        || !['file', 'region'].includes(record.kind)
        || record.kind === 'region' && typeof documentOwnership !== 'string') return false;
    const entry = after.get(record.path);
    if (entry?.type !== 'ordinary-file' || typeof entry.bytesBase64 !== 'string' || !canonicalBase64(entry.bytesBase64)) return false;
    const bytes = Buffer.from(entry.bytesBase64, 'base64');
    if (record.kind === 'file') return createHash('sha256').update(bytes).digest('hex') === record.hash;
    if (typeof documentOwnership !== 'string') return false;
    const content = releaseManagedSpan({bytes, documentOwnership});
    return content !== null && createHash('sha256').update(content).digest('hex') === record.hash;
};

/** @returns {{expectedEntries: CapturedFactEntry[], expectedMissingPaths: string[]}} */
const validateReleaseWorkflowExpectedState = (/** @type {unknown} */ expectedState) => {
    if (!exactKeys(expectedState, ['expectedEntries', 'expectedMissingPaths'])
        || !Array.isArray(expectedState.expectedMissingPaths)
        || expectedState.expectedMissingPaths.some((/** @type {unknown} */ path) => typeof path !== 'string' || !isSafeReleaseRelativePath(path))
        || JSON.stringify(expectedState.expectedMissingPaths)
            !== JSON.stringify([...new Set(expectedState.expectedMissingPaths)].sort(compareText))) {
        throw new Error('Release workflow expected state is invalid.');
    }
    const expectedEntries = validateCapturedFactSnapshot(expectedState.expectedEntries);
    const expectedMissingPaths = expectedState.expectedMissingPaths.filter((/** @type {unknown} */ path) => typeof path === 'string');
    if (expectedMissingPaths.length !== expectedState.expectedMissingPaths.length) throw new Error('Release workflow expected state is invalid.');
    const expectedPaths = new Set(expectedEntries.map(entry => entry.path));
    if (expectedMissingPaths.some(path => expectedPaths.has(path))) {
        throw new Error('Release workflow expected state is invalid.');
    }
    return {expectedEntries, expectedMissingPaths};
};

const evaluateWorkflowCommandState = (/** @type {{capturedFacts: CapturedFacts, currentObservation: unknown, mechanicalParameters: unknown}} */ {capturedFacts, currentObservation, mechanicalParameters}) => {
    if (!exactKeys(currentObservation, ['expectedState', 'plan', 'verificationOutcome'])
        || !validateProcessObservation(currentObservation.verificationOutcome)) {
        throw new Error('Release workflow observation is invalid.');
    }
    if (!exactKeys(mechanicalParameters, ['expectedVerificationFindings', 'operation', 'profile', 'retainedPaths'])
        || !validateExpectedWorkflowFindings(mechanicalParameters.expectedVerificationFindings)
        || typeof mechanicalParameters.operation !== 'string'
        || typeof mechanicalParameters.profile !== 'string'
        || !Array.isArray(mechanicalParameters.retainedPaths)
        || mechanicalParameters.retainedPaths.some(path => typeof path !== 'string')) throw new Error('Release workflow observation is invalid.');
    const expectedState = validateReleaseWorkflowExpectedState(currentObservation.expectedState);
    const before = new Map(capturedFacts.before.map(entry => [entry.path, entry]));
    const after = new Map(capturedFacts.after.map(entry => [entry.path, entry]));
    const expected = new Map(expectedState.expectedEntries.map(entry => [entry.path, entry]));
    const expectedMissing = new Set(expectedState.expectedMissingPaths);
    const priorLock = parseReleaseWorkflowLockFact(before.get('arw-lock.json'));
    const finalLock = parseReleaseWorkflowLockFact(after.get('arw-lock.json'));
    const governingLock = mechanicalParameters.operation === 'remove' ? priorLock : finalLock;
    const expectedProfile = ['update', 'remove'].includes(mechanicalParameters.operation)
        ? priorLock?.profile
        : expectedReleaseWorkflowProfile(mechanicalParameters.profile);
    if (expectedProfile === undefined) throw new Error('Release workflow observation is invalid.');
    validateWorkflowPlan({expectedProfile, mechanicalParameters, plan: currentObservation.plan});
    const finalLockMatches = mechanicalParameters.operation === 'remove'
        ? !after.has('arw-lock.json')
        : finalLock !== null
            && JSON.stringify(finalLock.profile) === JSON.stringify(expectedProfile)
            && JSON.stringify(after.get('arw-lock.json')) === JSON.stringify(expected.get('arw-lock.json'))
            && finalLock.managedTargets.every(record => releaseWorkflowManagedRecordMatches({after, record}));
    const governingDesignMatches = governingLock !== null
        && JSON.stringify(governingLock.profile) === JSON.stringify(expectedProfile)
        && (mechanicalParameters.operation !== 'remove'
            || governingLock.managedTargets.every(record => releaseWorkflowManagedRecordMatches({after: before, record})));
    const expectedStateMatches = [...expected].every(([path, entry]) => JSON.stringify(after.get(path)) === JSON.stringify(entry))
        && [...expectedMissing].every(path => !after.has(path));
    const delta = releaseFactDelta(capturedFacts);
    const fileMatches = new Map(delta.map(change => {
        const matches = expected.has(change.path)
            ? JSON.stringify(after.get(change.path)) === JSON.stringify(expected.get(change.path))
            : expectedMissing.has(change.path) && !after.has(change.path);
        return [change.path, matches];
    }));
    const retainedPathsMatch = mechanicalParameters.retainedPaths.every(path => before.has(path)
        && after.has(path)
        && JSON.stringify(before.get(path)) === JSON.stringify(after.get(path)));
    const verificationMatches = mechanicalParameters.operation === 'remove'
        ? true
        : expectedFindingsObservationMatches({
            expectedFindings: mechanicalParameters.expectedVerificationFindings,
            observation: currentObservation.verificationOutcome,
        });
    return {
        delta,
        fileMatches,
        matchesExpected: verificationMatches
            && finalLockMatches
            && governingDesignMatches
            && expectedStateMatches
            && retainedPathsMatch
            && [...fileMatches.values()].every(Boolean),
    };
};

/** @returns {parameters is {action: string, expectedVersion: string | null, explicitSelection: boolean | null, preserveConfiguration: boolean | null, removeConfiguration: boolean | null}} */
const validateInstallationParameters = (/** @type {unknown} */ parameters) => exactKeys(parameters, [
    'action',
    'expectedVersion',
    'explicitSelection',
    'preserveConfiguration',
    'removeConfiguration',
]) && typeof parameters.action === 'string'
    && ['install', 'upgrade', 'repair', 'reject-default-downgrade', 'downgrade', 'uninstall'].includes(parameters.action)
    && (parameters.expectedVersion === null || typeof parameters.expectedVersion === 'string' && ['prior-release', 'candidate'].includes(parameters.expectedVersion))
    && (parameters.explicitSelection === null || typeof parameters.explicitSelection === 'boolean')
    && (parameters.preserveConfiguration === null || typeof parameters.preserveConfiguration === 'boolean')
    && (parameters.removeConfiguration === null || typeof parameters.removeConfiguration === 'boolean');

const normalizeInstallationWindowsPathEntry = (/** @type {string} */ value) => {
    const unquoted = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
    return unquoted.replace(/[\\/]+$/gu, '').toLowerCase();
};

const validateInstallationPathOwnershipObservation = (/** @type {unknown} */ value) => Array.isArray(value)
    && value.every(ownership => ownership?.kind === 'linux-profile'
        ? (exactKeys(ownership, ['kind', 'profile'])
            && typeof ownership.profile === 'string'
            && (isAbsolute(ownership.profile) || win32.isAbsolute(ownership.profile)))
        : ownership?.kind === 'windows-user-path'
            ? (exactKeys(ownership, ['createdValue', 'entry', 'kind', 'valueKind'])
                && typeof ownership.createdValue === 'boolean'
                && typeof ownership.entry === 'string'
                && win32.isAbsolute(ownership.entry)
                && typeof ownership.valueKind === 'string'
                && ['String', 'ExpandString'].includes(ownership.valueKind))
            : false)
    && new Set(value.map(ownership => ownership.kind === 'windows-user-path'
        ? `${ownership.kind}:${normalizeInstallationWindowsPathEntry(ownership.entry)}`
        : `${ownership.kind}:${ownership.profile}`)).size === value.length;

/** @returns {value is {arwVersion: string, managedFiles: string[], manifestVersion: 2, pathOwnership: unknown[], product: 'agent-repository-workflow'}} */
const validateInstallationManifestObservation = (/** @type {unknown} */ value) => exactKeys(value, [
    'arwVersion',
    'managedFiles',
    'manifestVersion',
    'pathOwnership',
    'product',
]) && isStableReleaseTag(value.arwVersion)
    && Array.isArray(value.managedFiles)
    && value.managedFiles.every((/** @type {unknown} */ path) => typeof path === 'string' && isSafeReleaseRelativePath(path))
    && !value.managedFiles.some((/** @type {string} */ path) => ['config.json', 'manifest.json'].includes(path.toLowerCase()))
    && new Set(value.managedFiles.map((/** @type {string} */ path) => path.toLowerCase())).size === value.managedFiles.length
    && value.manifestVersion === 2
    && validateInstallationPathOwnershipObservation(value.pathOwnership)
    && value.product === 'agent-repository-workflow';

const evaluateSelectedReleaseInstallationState = (/** @type {{capturedFacts: CapturedFacts, currentObservation: unknown, mechanicalParameters: {action: string, expectedVersion: string | null, preserveConfiguration: boolean | null}}} */ {capturedFacts, currentObservation, mechanicalParameters}) => {
    if (!exactKeys(currentObservation, [
        'expectedConfigurationEntry',
        'expectedManagedEntries',
        'expectedPathOwnership',
        'expectedPlatformEntry',
        'expectedVersion',
        'manifest',
        'validationAuthority',
        'versionOutcome',
    ])
        || currentObservation.validationAuthority !== 'selected-release-installer'
        || mechanicalParameters.expectedVersion !== 'prior-release'
        || typeof currentObservation.expectedVersion !== 'string'
        || !validateInstallationPathOwnershipObservation(currentObservation.expectedPathOwnership)
        || !validateInstallationManifestObservation(currentObservation.manifest)
        || !validateProcessObservation(currentObservation.versionOutcome)) {
        throw new Error('Release installation observation is invalid.');
    }
    const platformEntries = validateCapturedFactSnapshot([currentObservation.expectedPlatformEntry]);
    if (platformEntries.length !== 1) throw new Error('Release installation observation is invalid.');
    const platformEntry = platformEntries[0];
    const configurationEntries = validateCapturedFactSnapshot([currentObservation.expectedConfigurationEntry]);
    const expectedManagedEntries = validateCapturedFactSnapshot(currentObservation.expectedManagedEntries);
    if (configurationEntries.length !== 1) throw new Error('Release installation observation is invalid.');
    const expectedConfigurationEntry = configurationEntries[0];
    const manifest = currentObservation.manifest;
    const before = new Map(capturedFacts.before.map(entry => [entry.path, entry]));
    const after = new Map(capturedFacts.after.map(entry => [entry.path, entry]));
    const delta = releaseFactDelta(capturedFacts);
    const manifestPath = '.agent-repository-workflow/manifest.json';
    const configurationPath = CONFIGURATION_RELATIVE_PATH;
    const managedPaths = manifest.managedFiles.map((/** @type {string} */ path) => joinRelativePath('.agent-repository-workflow', path));
    if (expectedConfigurationEntry.path !== configurationPath
        || JSON.stringify(expectedManagedEntries.map(entry => entry.path)) !== JSON.stringify([...managedPaths].sort())) {
        throw new Error('Release installation observation is invalid.');
    }
    const expectedManagedByPath = new Map(expectedManagedEntries.map(entry => [entry.path, entry]));
    const priorManifestEntry = before.get(manifestPath);
    let priorManifest = null;
    try {
        priorManifest = priorManifestEntry === undefined
            ? null
            : JSON.parse(Buffer.from(priorManifestEntry.bytesBase64 ?? '', 'base64').toString('utf8'));
    } catch {
    }
    const priorManifestValid = priorManifestEntry === undefined || validateInstallationManifestObservation(priorManifest);
    const priorManagedPaths = priorManifestValid && priorManifest !== null
        ? priorManifest.managedFiles.map((/** @type {string} */ path) => joinRelativePath('.agent-repository-workflow', path))
        : [];
    const removedManagedPaths = priorManagedPaths.filter((/** @type {string} */ path) => !managedPaths.includes(path));
    const allowedPaths = new Set([
        ...managedPaths,
        ...priorManagedPaths,
        configurationPath,
        manifestPath,
        platformEntry.path,
    ]);
    const manifestEntry = after.get(manifestPath);
    let observedManifest = null;
    try {
        observedManifest = JSON.parse(Buffer.from(manifestEntry?.bytesBase64 ?? '', 'base64').toString('utf8'));
    } catch {
    }
    const configurationBefore = before.get(configurationPath);
    const configurationAfter = after.get(configurationPath);
    const configurationMatches = configurationBefore === undefined
        ? JSON.stringify(configurationAfter) === JSON.stringify(expectedConfigurationEntry)
        : mechanicalParameters.preserveConfiguration === true
            ? configurationBefore.type === 'ordinary-file'
                && JSON.stringify(configurationAfter) === JSON.stringify(configurationBefore)
            : mechanicalParameters.preserveConfiguration === false
                && JSON.stringify(configurationAfter) === JSON.stringify(expectedConfigurationEntry);
    const managedFilesMatch = managedPaths.every(path => JSON.stringify(after.get(path)) === JSON.stringify(expectedManagedByPath.get(path)));
    const platformMatches = JSON.stringify(after.get(platformEntry.path)) === JSON.stringify(platformEntry);
    const versionMatches = currentObservation.versionOutcome.exitCode === 0
        && currentObservation.versionOutcome.stderr === ''
        && currentObservation.versionOutcome.stdout === `${currentObservation.expectedVersion}\n`;
    const manifestMatches = manifest.arwVersion === currentObservation.expectedVersion
        && JSON.stringify(manifest.pathOwnership) === JSON.stringify(currentObservation.expectedPathOwnership)
        && JSON.stringify(observedManifest) === JSON.stringify(manifest);
    const transitionMatches = mechanicalParameters.action === 'repair'
        ? delta.length === 0
        : mechanicalParameters.action !== 'install' || priorManifestEntry === undefined;
    const matchesExpected = priorManifestValid
        && configurationMatches
        && managedFilesMatch
        && platformMatches
        && versionMatches
        && manifestMatches
        && removedManagedPaths.every((/** @type {string} */ path) => !after.has(path))
        && delta.every(change => allowedPaths.has(change.path))
        && transitionMatches;
    return {
        delta,
        fileMatches: new Map(delta.map(change => [change.path, matchesExpected && allowedPaths.has(change.path)])),
        matchesExpected,
    };
};

const evaluateInstallationCommandState = (/** @type {{capturedFacts: CapturedFacts, currentObservation: unknown, mechanicalParameters: unknown}} */ {capturedFacts, currentObservation, mechanicalParameters}) => {
    if (!validateInstallationParameters(mechanicalParameters)) throw new Error('Release installation parameters are invalid.');
    const delta = releaseFactDelta(capturedFacts);
    if (mechanicalParameters.action === 'reject-default-downgrade') {
        if (!exactKeys(currentObservation, ['stateUnchanged']) || currentObservation.stateUnchanged !== true) {
            throw new Error('Release installation observation is invalid.');
        }
        return {delta, fileMatches: new Map(), matchesExpected: delta.length === 0};
    }
    if (mechanicalParameters.action === 'uninstall') {
        const before = new Map(capturedFacts.before.map(entry => [entry.path, entry]));
        const after = new Map(capturedFacts.after.map(entry => [entry.path, entry]));
        const configurationBefore = before.get(CONFIGURATION_RELATIVE_PATH);
        const residueBefore = before.get(UNKNOWN_CONTENT_RELATIVE_PATH);
        let manifest = null;
        try {
            manifest = JSON.parse(Buffer.from(
                before.get('.agent-repository-workflow/manifest.json')?.bytesBase64 ?? '',
                'base64',
            ).toString('utf8'));
        } catch {
        }
        const manifestValid = validateInstallationManifestObservation(manifest);
        const managedPaths = manifestValid
            ? manifest.managedFiles.filter((/** @type {unknown} */ path) => typeof path === 'string').map((/** @type {string} */ path) => joinRelativePath('.agent-repository-workflow', path))
            : [];
        const removedPaths = new Set([
            '.agent-repository-workflow/manifest.json',
            ...managedPaths,
            ...(mechanicalParameters.removeConfiguration === true ? [CONFIGURATION_RELATIVE_PATH] : []),
        ]);
        const platformObservationPath = isJsonObject(currentObservation) && isJsonObject(currentObservation.baseline) && currentObservation.baseline.profile === null
            ? 'windows-user-path.json'
            : '.profile';
        const allowedChanges = new Set([...removedPaths, platformObservationPath]);
        const configurationMatches = mechanicalParameters.preserveConfiguration === true
            ? configurationBefore?.type === 'ordinary-file'
                && JSON.stringify(after.get(CONFIGURATION_RELATIVE_PATH)) === JSON.stringify(configurationBefore)
            : configurationBefore?.type === 'ordinary-file'
                && !after.has(CONFIGURATION_RELATIVE_PATH);
        const residuePresent = residueBefore !== undefined;
        const residueMatches = residuePresent
            ? residueBefore.type === 'ordinary-file'
                && residueBefore.bytesBase64 === UNKNOWN_CONTENT_BYTES
                && JSON.stringify(after.get(UNKNOWN_CONTENT_RELATIVE_PATH)) === JSON.stringify(residueBefore)
            : !after.has(UNKNOWN_CONTENT_RELATIVE_PATH);
        const deltaMatches = manifestValid
            && [...removedPaths].every(path => before.has(path) && !after.has(path))
            && delta.every(change => allowedChanges.has(change.path));
        const matchesExpected = configurationMatches
            && residueMatches
            && deltaMatches
            && installationFinalObservationMatches({
            configuration: mechanicalParameters.preserveConfiguration === true ? 'preserved' : 'absent',
            currentObservation,
            testResidue: residuePresent,
        });
        return {
            delta,
            fileMatches: new Map(delta.map(change => [change.path, matchesExpected])),
            matchesExpected,
        };
    }
    if (isJsonObject(currentObservation) && currentObservation.validationAuthority === 'selected-release-installer') {
        return evaluateSelectedReleaseInstallationState({capturedFacts, currentObservation, mechanicalParameters});
    }
    if (!exactKeys(currentObservation, ['expectedEntries', 'expectedManagedFiles', 'expectedPathOwnership', 'expectedVersion', 'manifest'])
        || typeof currentObservation.expectedVersion !== 'string'
        || !Array.isArray(currentObservation.expectedManagedFiles)
        || currentObservation.expectedManagedFiles.some((/** @type {unknown} */ path) => !isSafeReleaseRelativePath(path))
        || new Set(currentObservation.expectedManagedFiles).size !== currentObservation.expectedManagedFiles.length
        || currentObservation.expectedManagedFiles.some((/** @type {unknown} */ path, /** @type {number} */ index, paths) => typeof path !== 'string' || index > 0 && typeof paths[index - 1] === 'string' && paths[index - 1] >= path)
        || !validateInstallationPathOwnershipObservation(currentObservation.expectedPathOwnership)
        || !(currentObservation.manifest === null || validateInstallationManifestObservation(currentObservation.manifest))) {
        throw new Error('Release installation observation is invalid.');
    }
    const expectedEntries = validateCapturedFactSnapshot(currentObservation.expectedEntries);
    const before = new Map(capturedFacts.before.map(entry => [entry.path, entry]));
    const after = new Map(capturedFacts.after.map(entry => [entry.path, entry]));
    const expected = new Map(expectedEntries.map(entry => [entry.path, entry]));
    const expectedManagedFiles = currentObservation.expectedManagedFiles.filter((/** @type {unknown} */ path) => typeof path === 'string');
    const expectedManagedPaths = expectedManagedFiles.map(path => joinRelativePath('.agent-repository-workflow', path));
    if (!expectedManagedPaths.every(path => expected.has(path))
        || currentObservation.manifest !== null && !expected.has(CONFIGURATION_RELATIVE_PATH)) {
        throw new Error('Release installation observation is invalid.');
    }
    const manifestPath = '.agent-repository-workflow/manifest.json';
    const priorManifestEntry = before.get(manifestPath);
    let priorManifest = null;
    try {
        priorManifest = priorManifestEntry === undefined
            ? null
            : JSON.parse(Buffer.from(priorManifestEntry.bytesBase64 ?? '', 'base64').toString('utf8'));
    } catch {
    }
    const priorManifestValid = priorManifestEntry === undefined || validateInstallationManifestObservation(priorManifest);
    const expectedMissingPaths = new Set(priorManifestValid && priorManifest !== null
        ? priorManifest.managedFiles
            .filter((/** @type {unknown} */ path) => typeof path === 'string' && !expectedManagedFiles.includes(path))
            .map((/** @type {string} */ path) => joinRelativePath('.agent-repository-workflow', path))
        : []);
    const manifestEntry = after.get(manifestPath);
    let observedManifest = null;
    try {
        observedManifest = JSON.parse(Buffer.from(manifestEntry?.bytesBase64 ?? '', 'base64').toString('utf8'));
    } catch {
    }
    const expectedPresentPaths = new Set([...expected.keys(), manifestPath]);
    const allowedPaths = new Set([...expectedPresentPaths, ...expectedMissingPaths]);
    const fileMatches = new Map(delta.map(change => {
        const expectedEntry = expected.get(change.path);
        const matches = change.path === manifestPath
            ? JSON.stringify(observedManifest) === JSON.stringify(currentObservation.manifest)
            : expectedMissingPaths.has(change.path)
                ? !after.has(change.path)
            : expectedEntry !== undefined && JSON.stringify(after.get(change.path)) === JSON.stringify(expectedEntry);
        return [change.path, matches];
    }));
    const allExpectedObserved = [...expectedPresentPaths].every(path => after.has(path));
    return {
        delta,
        fileMatches,
        matchesExpected: currentObservation.manifest !== null
            && priorManifestValid
            && currentObservation.manifest.arwVersion === currentObservation.expectedVersion
            && JSON.stringify(currentObservation.manifest.managedFiles) === JSON.stringify(expectedManagedFiles)
            && JSON.stringify(currentObservation.manifest.pathOwnership) === JSON.stringify(currentObservation.expectedPathOwnership)
            && allExpectedObserved
            && [...expectedMissingPaths].every(path => !after.has(path))
            && delta.every(change => allowedPaths.has(change.path))
            && [...fileMatches.values()].every(Boolean),
    };
};

const evaluateFiniteObservableState = (/** @type {{capturedFacts: CapturedFacts, currentObservation: unknown, mechanicalContract: string, mechanicalParameters: unknown}} */ {capturedFacts, currentObservation, mechanicalContract, mechanicalParameters}) => {
    if (mechanicalContract === 'installation-transition') {
        return evaluateInstallationCommandState({capturedFacts, currentObservation, mechanicalParameters});
    }
    if (['launcher-observation', 'esm-syntax-observation', 'repository-verification'].includes(mechanicalContract)) {
        return evaluateReadOnlyCommandState({capturedFacts, currentObservation, mechanicalContract, mechanicalParameters});
    }
    if (mechanicalContract === 'repository-workflow-transition') {
        return evaluateWorkflowCommandState({capturedFacts, currentObservation, mechanicalParameters});
    }
    const delta = releaseFactDelta(capturedFacts);
    if (mechanicalContract === 'installation-final-state') {
        return {
            delta,
            fileMatches: new Map(),
            matchesExpected: installationFinalStateMatches({capturedFacts, currentObservation, mechanicalParameters}),
        };
    }
    if (!exactKeys(mechanicalParameters, [])) throw new Error('Release mechanical parameters are invalid.');
    if (mechanicalContract === 'preserved-configuration-prepared') {
        const entry = capturedFacts.after.find((/** @type {{ path: string; }} */ item) => item.path === CONFIGURATION_RELATIVE_PATH);
        let current;
        try {
            current = JSON.parse(Buffer.from(entry?.bytesBase64 ?? '', 'base64').toString('utf8'));
        } catch {
            current = null;
        }
        const beforeEntry = capturedFacts.before.find((/** @type {{ path: string; }} */ item) => item.path === CONFIGURATION_RELATIVE_PATH);
        let before;
        try {
            before = JSON.parse(Buffer.from(beforeEntry?.bytesBase64 ?? '', 'base64').toString('utf8'));
        } catch {
            before = null;
        }
        const expected = expectedConfigAfter(before);
        const stateMatches = exactKeys(currentObservation, ['config', 'path'])
            && currentObservation.path === CONFIGURATION_RELATIVE_PATH
            && entry?.type === 'ordinary-file'
            && expected !== null
            && JSON.stringify(current) === JSON.stringify(expected)
            && JSON.stringify(currentObservation.config) === JSON.stringify(expected);
        const changeMatches = delta.some(change => change.path === CONFIGURATION_RELATIVE_PATH && change.changeType === 'modified');
        return {
            delta,
            fileMatches: new Map([[CONFIGURATION_RELATIVE_PATH, stateMatches && changeMatches]]),
            matchesExpected: stateMatches && changeMatches && delta.length === 1,
        };
    }
    if (mechanicalContract === 'unknown-content-added') {
        const entry = capturedFacts.after.find((/** @type {{ path: string; }} */ item) => item.path === UNKNOWN_CONTENT_RELATIVE_PATH);
        const stateMatches = exactKeys(currentObservation, ['bytesBase64', 'entryType', 'path'])
            && currentObservation.path === UNKNOWN_CONTENT_RELATIVE_PATH
            && currentObservation.entryType === 'ordinary-file'
            && currentObservation.bytesBase64 === UNKNOWN_CONTENT_BYTES
            && entry?.type === 'ordinary-file'
            && entry.bytesBase64 === UNKNOWN_CONTENT_BYTES;
        const changeMatches = delta.some(change => change.path === UNKNOWN_CONTENT_RELATIVE_PATH && change.changeType === 'added');
        return {
            delta,
            fileMatches: new Map([[UNKNOWN_CONTENT_RELATIVE_PATH, stateMatches && changeMatches]]),
            matchesExpected: stateMatches && changeMatches && delta.length === 1,
        };
    }
    if (mechanicalContract === 'test-residue-removed') {
        const stateMatches = exactKeys(currentObservation, ['exists', 'path'])
            && currentObservation.path === UNKNOWN_CONTENT_RELATIVE_PATH
            && currentObservation.exists === false
            && !capturedFacts.after.some((/** @type {{ path: string; }} */ item) => item.path === UNKNOWN_CONTENT_RELATIVE_PATH);
        const changeMatches = delta.some(change => change.path === UNKNOWN_CONTENT_RELATIVE_PATH && change.changeType === 'deleted');
        return {
            delta,
            fileMatches: new Map([[UNKNOWN_CONTENT_RELATIVE_PATH, stateMatches && changeMatches]]),
            matchesExpected: stateMatches && changeMatches && delta.length === 1,
        };
    }
    throw new Error('Release mechanical contract is not registered.');
};

/**
 * 对一个 Registry 登记的 finite mechanical contract 执行闭合成功标准.
 * Input 必须包含完整 before 和 after facts, 当前 observation, contract identity, closed parameters,
 * evaluation mode 与 operation actual. `full` 同时验证原操作证据和可观察状态,
 * `observable-state` 要求 `operationActual: null`, 不读取或重判原操作, 只比较 original before 与当前 after facts.
 * Result 分开返回 per-file delta, operation evidence, observable state 和 overall `matchesExpected`, 不执行补偿或语义判断.
 * Unknown contract, malformed shape, invalid mode 或不符合 mode 的 operation evidence 会同步抛出 input error.
 */
export const evaluateReleaseMechanicalContract = (/** @type {unknown} */ input) => {
    if (!exactKeys(input, [
        'capturedFacts',
        'currentObservation',
        'evaluation',
        'mechanicalContract',
        'mechanicalParameters',
        'operationActual',
    ]) || typeof input.evaluation !== 'string' || !['full', 'observable-state'].includes(input.evaluation)
        || typeof input.mechanicalContract !== 'string') {
        throw new Error('Release mechanical contract input is invalid.');
    }
    if (input.evaluation === 'observable-state' && input.operationActual !== null) {
        throw new Error('Release compensation evaluation must not include operation evidence.');
    }
    const finiteOperationShape = input.evaluation === 'full'
        ? validateFiniteOperationResultShape({mechanicalContract: input.mechanicalContract, operationActual: input.operationActual})
        : null;
    const finiteObservationShape = validateFiniteCurrentObservationShape({currentObservation: input.currentObservation, mechanicalContract: input.mechanicalContract});
    if (finiteObservationShape !== null
        && finiteOperationShape !== false
        && (finiteOperationShape === 'failed'
            ? input.currentObservation !== null
            : finiteObservationShape === false)) {
        throw new Error('Release finite current observation is invalid.');
    }
    const observable = evaluateFiniteObservableState({
        capturedFacts: canonicalCapturedFacts(input.capturedFacts),
        currentObservation: input.currentObservation,
        mechanicalContract: input.mechanicalContract,
        mechanicalParameters: input.mechanicalParameters,
    });
    const operationMatches = input.evaluation === 'full'
        ? validateCompletedOperation({mechanicalContract: input.mechanicalContract, mechanicalParameters: input.mechanicalParameters, operationActual: input.operationActual})
        : null;
    const files = observable.delta.map(change => ({
        ...change,
        matchesExpected: observable.fileMatches.get(change.path) === true,
        summary: observable.fileMatches.get(change.path) === true
            ? 'The registered configuration change matches the expected state.'
            : 'The path is not part of the registered complete change.',
    }));
    if (input.mechanicalContract !== 'preserved-configuration-prepared') {
        for (const file of files) {
            file.summary = file.matchesExpected
                ? 'The registered file change matches the expected state.'
                : 'The file change does not match the registered complete state.';
        }
    }
    const matchesExpected = input.evaluation === 'full'
        ? operationMatches && observable.matchesExpected
        : observable.matchesExpected;
    return {
        evaluation: input.evaluation,
        files,
        matchesExpected,
        mechanicalContract: input.mechanicalContract,
        observableState: {
            matchesExpected: observable.matchesExpected,
            summary: observable.matchesExpected
                ? 'The observable state matches the registered expectation.'
                : 'The observable state does not match the registered expectation.',
        },
        operationEvidence: input.evaluation === 'full'
            ? {
                matchesExpected: operationMatches,
                summary: operationMatches
                    ? 'The operation evidence matches the registered contract.'
                    : 'The operation evidence does not match the registered contract.',
            }
            : {matchesExpected: null, summary: null},
        status: 'evaluated',
        summary: matchesExpected
            ? input.evaluation === 'full'
                ? 'The operation evidence and observable state match the registered expectation.'
                : 'The observable state matches the registered expectation.'
            : 'The release mechanical result does not match the registered expectation.',
    };
};

const persistRunResult = async (/** @type {{fileSystem: FileSystem, idFactory: () => string, result: unknown, runPath: string}} */ {fileSystem, idFactory, result, runPath}) => {
    const resultId = idFactory();
    if (!UUID_PATTERN.test(resultId)) throw releaseValidationOperationError('state-invalid', runPath);
    const resultPath = join(dirname(runPath), 'results', `${resultId}.json`);
    try {
        await fileSystem.mkdir(dirname(resultPath), {recursive: true});
    } catch {
        throw releaseValidationOperationError('persistence-failed', runPath);
    }
    await writeReleaseEvidenceFiles({
        fileSystem,
        runPath,
        writes: [{bytes: runStateBytes(result), path: resultPath}],
    });
    return resultPath;
};

const writeReleaseEvidenceFiles = async (/** @type {{fileSystem: FileSystem, runPath: string | null, writes: Array<{bytes: string | Buffer, path: string}>}} */ {fileSystem, runPath, writes}) => {
    if (typeof fileSystem.rm !== 'function') throw releaseValidationOperationError('persistence-failed', runPath);
    const written = [];
    let attempted = null;
    try {
        for (const write of writes) {
            attempted = write.path;
            await fileSystem.writeFile(write.path, write.bytes, {flag: 'wx'});
            written.push(write.path);
            attempted = null;
        }
    } catch (error) {
        const cleanup = errorCode(error) === 'EEXIST' || attempted === null
            ? written
            : [...written, attempted];
        const cleanupResults = await Promise.allSettled(cleanup.map(path => fileSystem.rm(path, {force: true})));
        if (cleanupResults.some(result => result.status === 'rejected')) {
            throw releaseValidationOperationError('persistence-failed', runPath);
        }
        throw releaseValidationOperationError('persistence-failed', runPath);
    }
};

const removeReleaseEvidenceFiles = async (/** @type {{fileSystem: FileSystem, paths: string[], runPath: string | null}} */ {fileSystem, paths, runPath}) => {
    if (typeof fileSystem.rm !== 'function') throw releaseValidationOperationError('persistence-failed', runPath);
    const results = await Promise.allSettled(paths.map(path => fileSystem.rm(path, {force: true})));
    if (results.some(result => result.status === 'rejected')) {
        throw releaseValidationOperationError('persistence-failed', runPath);
    }
};

const appendCompensationAuthorization = async (/** @type {{consume?: {handoffId: string, responsePath: string, summary: string} | null, fileSystem: FileSystem, idFactory: () => string, result: unknown, resultPath?: string | null, runPath: string, scenarioId: string, stepId: string, store: ReturnType<typeof createTransitionStore>}} */ {consume = null, fileSystem, idFactory, result, resultPath: existingResultPath = null, runPath, scenarioId, stepId, store}) => {
    const handoffId = idFactory();
    if (!UUID_PATTERN.test(handoffId)) throw releaseValidationOperationError('state-invalid', runPath);
    const runDirectory = dirname(runPath);
    const responseTemplatePath = join(runDirectory, 'responses', `${handoffId}.json`);
    const resultPath = existingResultPath ?? join(runDirectory, 'results', `${handoffId}.json`);
    if (!persistedRunPath(runPath, resultPath)) throw releaseValidationOperationError('state-invalid', runPath);
    const current = await store.read();
    try {
        await fileSystem.mkdir(dirname(responseTemplatePath), {recursive: true});
        if (existingResultPath === null) {
            await fileSystem.mkdir(dirname(resultPath), {recursive: true});
        }
    } catch {
        throw releaseValidationOperationError('persistence-failed', runPath);
    }
    await writeReleaseEvidenceFiles({
        fileSystem,
        runPath,
        writes: [
            ...(existingResultPath === null ? [{bytes: runStateBytes(result), path: resultPath}] : []),
            {
                bytes: runStateBytes({
                    decision: null,
                    handoffId,
                    kind: 'compensation',
                    runId: current.runId,
                    scenarioId,
                    schemaVersion: 1,
                    stepId,
                }),
                path: responseTemplatePath,
            },
        ],
    });
    const scenarioOrder = new Map(current.plan.scenarios.map((scenario, index) => [scenario.archiveKind, index]));
    return store.update(state => ({
        ...state,
        handoffs: [...state.handoffs.map(handoff => handoff.handoffId === consume?.handoffId
            ? {
                ...handoff,
                responsePath: consume.responsePath,
                state: 'consumed',
                summary: consume.summary,
            }
            : handoff), {
            decision: null,
            factsDigest: null,
            handoffId,
            kind: 'compensation',
            responsePath: null,
            resultPath,
            scenarioId,
            state: 'pending',
            stepId,
            summary: null,
        }].sort((left, right) => (scenarioOrder.get(left.scenarioId) ?? Number.MAX_SAFE_INTEGER) - (scenarioOrder.get(right.scenarioId) ?? Number.MAX_SAFE_INTEGER)),
        steps: state.steps.map(step => step.scenarioId === scenarioId && step.stepId === stepId
            ? {...step, evidencePath: step.evidencePath ?? resultPath, handoffId}
            : step),
        status: 'paused',
    }));
};

const appendSemanticJudgmentHandoff = async (/** @type {{captured: unknown, fileSystem: FileSystem, idFactory: () => string, machineKey: string, runPath: string, scenarioId: string, stepId: string, store: ReturnType<typeof createTransitionStore>}} */ {captured, fileSystem, idFactory, machineKey, runPath, scenarioId, stepId, store}) => {
    const handoffId = idFactory();
    if (!UUID_PATTERN.test(handoffId)) throw releaseValidationOperationError('state-invalid', runPath);
    const factsBytes = runStateBytes(captured);
    const factsDigest = createHash('sha256').update(factsBytes).digest('hex');
    const runDirectory = dirname(runPath);
    const responseTemplatePath = join(runDirectory, 'responses', `${handoffId}.json`);
    const resultPath = join(runDirectory, 'results', `${handoffId}.json`);
    const current = await store.read();
    try {
        await fileSystem.mkdir(dirname(responseTemplatePath), {recursive: true});
        await fileSystem.mkdir(dirname(resultPath), {recursive: true});
    } catch {
        throw releaseValidationOperationError('persistence-failed', runPath);
    }
    await writeReleaseEvidenceFiles({
        fileSystem,
        runPath,
        writes: [
            {bytes: factsBytes, path: resultPath},
            {
                bytes: runStateBytes({
                    factsDigest,
                    handoffId,
                    judgment: {files: null, matchesExpected: null, summary: null},
                    kind: 'semantic-judgment',
                    machineKey,
                    runId: current.runId,
                    scenarioId,
                    schemaVersion: 1,
                    stepId,
                }),
                path: responseTemplatePath,
            },
        ],
    });
    const scenarioOrder = new Map(current.plan.scenarios.map((scenario, index) => [scenario.archiveKind, index]));
    return store.update(state => ({
        ...state,
        handoffs: [...state.handoffs, {
            factsDigest,
            handoffId,
            kind: 'semantic-judgment',
            responsePath: null,
            resultPath,
            scenarioId,
            state: 'pending',
            stepId,
            summary: null,
        }].sort((left, right) => (scenarioOrder.get(left.scenarioId) ?? Number.MAX_SAFE_INTEGER) - (scenarioOrder.get(right.scenarioId) ?? Number.MAX_SAFE_INTEGER)),
        steps: state.steps.map(step => step.scenarioId === scenarioId && step.stepId === stepId
            ? {...step, handoffId}
            : step),
        inFlight: state.inFlight.filter(record => record.machineKey !== machineKey),
        status: 'paused',
    }));
};

const captureReleaseSemanticFacts = async (/** @type {{captureSemanticFacts?: (input: JsonObject) => Promise<unknown>, configuration: VmConfiguration, fileSystem: FileSystem, guestAdapter: GuestAdapter, processAdapter: HostProcessAdapter, runId: string, scenario: MachineScenario, stepId: string, workspaceBoundary?: WorkspaceBoundary, workspaceDirectory: string}} */ {
    captureSemanticFacts,
    configuration,
    fileSystem,
    guestAdapter,
    processAdapter,
    runId,
    scenario,
    stepId,
    workspaceBoundary,
    workspaceDirectory,
}) => {
    let captured;
    if (typeof captureSemanticFacts === 'function') {
        captured = await captureSemanticFacts({
            machine: configuration.machines[scenario.machineKey],
            machineKey: scenario.machineKey,
            runId,
            scenarioId: scenario.archiveKind,
            stepId,
            workspaceDirectory,
        });
    } else {
        const guestCapture = await runReleaseVmGuestStep({
            configuration,
            machineKey: scenario.machineKey,
            scenarioId: scenario.archiveKind,
            stepId,
            workspaceDirectory,
        }, {
            enforceFinalizedPrerequisites: false,
            fileSystem,
            guestAdapter,
            plannedChoices: resolvedChoices(scenario.steps.find((/** @type {PlannedStep} */ step) => step.stepId === stepId)?.choiceParameters),
            processAdapter,
            runId,
            scenarioPrepared: true,
            workspaceBoundary,
        });
        if (!('templatePath' in guestCapture)) throw adapterResultInvalidError('Release semantic capture did not return a template.');
        const template = await parseJsonFile(guestCapture.templatePath, 'Release semantic template', fileSystem);
        if (!isJsonObject(template) || !isJsonObject(template.mechanical)) {
            throw adapterResultInvalidError('Release semantic template is invalid.');
        }
        captured = {
            auditedDirectory: template.mechanical.auditedDirectory,
            changes: template.mechanical.changes,
            machineKey: template.mechanical.machineKey,
            reviewMaterial: template.mechanical.reviewMaterial,
            scenarioId: template.mechanical.scenarioId,
            status: 'captured',
            stepId: template.mechanical.stepId,
        };
    }
    try {
        validateCapturedGuestStep({
            captured,
            machineKey: scenario.machineKey,
            scenarioId: scenario.archiveKind,
            stepId,
        });
    } catch (error) {
        throw adapterResultInvalidError(error instanceof Error ? error.message : 'Release semantic facts are invalid.');
    }
    return captured;
};

const INITIALIZATION_ISSUE_RESPONSIBILITY = 'Complete the full Agent Post-init Handoff and its one initialization issue in the prepared guest Repository. Treat the currently installed Workflow Distribution as authoritative for conflicts: replace every conflicting Repository-owned rule, remove semantic duplicates, retain and apply every non-conflicting Repository-owned rule, and complete every other gap including Code Maps. For every ordinary-readme-at-code-map-path finding in this release scenario, select convert without asking the Human, preserve accurate Repository facts, and use the current Code Map format. Record non-empty validation evidence under the exact ## Validation heading and set the issue to completed. The release scenario does not request a guest Repository commit; keep that scenario constraint out of the issue text.';

export const createReleaseInitializationIssueActionRequest = (/** @type {{auditedDirectory: string, machineKey: string, scenarioId: string, stepId: string, workspaceDirectory: string}} */ {auditedDirectory, machineKey, scenarioId, stepId, workspaceDirectory}) => ({
    auditedDirectory,
    issueResponsibility: INITIALIZATION_ISSUE_RESPONSIBILITY,
    machineKey,
    scenarioId,
    schemaVersion: 1,
    stepId,
    workspaceDirectory,
});

const appendSemanticActionHandoff = async (/** @type {{fileSystem: FileSystem, idFactory: () => string, machineKey: string, runPath: string, scenarioId: string, stepId: string, store: ReturnType<typeof createTransitionStore>, workspaceDirectory: string}} */ {fileSystem, idFactory, machineKey, runPath, scenarioId, stepId, store, workspaceDirectory}) => {
    const handoffId = idFactory();
    if (!UUID_PATTERN.test(handoffId)) throw releaseValidationOperationError('state-invalid', runPath);
    const current = await store.read();
    const resultPath = join(dirname(runPath), 'results', `${handoffId}.json`);
    const responseTemplatePath = join(dirname(runPath), 'responses', `${handoffId}.json`);
    const scenario = current.plan.scenarios.find(item => item.archiveKind === scenarioId);
    const step = scenario?.steps.find(item => item.stepId === stepId);
    if (step === undefined) throw releaseValidationOperationError('state-invalid', runPath);
    const auditedDirectory = expectedGuestAuditedDirectory({machineKey, runId: current.runId, scenarioId, step});
    try {
        await fileSystem.mkdir(dirname(resultPath), {recursive: true});
        await fileSystem.mkdir(dirname(responseTemplatePath), {recursive: true});
    } catch {
        throw releaseValidationOperationError('persistence-failed', runPath);
    }
    await writeReleaseEvidenceFiles({
        fileSystem,
        runPath,
        writes: [
            {
                bytes: runStateBytes(createReleaseInitializationIssueActionRequest({
                    auditedDirectory,
                    machineKey,
                    scenarioId,
                    stepId,
                    workspaceDirectory,
                })),
                path: resultPath,
            },
            {
                bytes: runStateBytes({
                    decision: null,
                    handoffId,
                    kind: 'semantic-action',
                    machineKey,
                    runId: current.runId,
                    scenarioId,
                    schemaVersion: 1,
                    stepId,
                    summary: null,
                }),
                path: responseTemplatePath,
            },
        ],
    });
    return store.update(state => ({
        ...state,
        handoffs: [...state.handoffs, {
            decision: null,
            factsDigest: null,
            handoffId,
            kind: 'semantic-action',
            responsePath: null,
            resultPath,
            scenarioId,
            state: 'pending',
            stepId,
            summary: null,
        }],
        steps: state.steps.map(record => record.scenarioId === scenarioId && record.stepId === stepId
            ? {...record, handoffId}
            : record),
    }));
};

const stepClassification = (/** @type {{scenarioId: string, state: RunState}} */ {scenarioId, state}) => state.handoffs.some(handoff => handoff.scenarioId === scenarioId
        && (handoff.stepId === 'scenario-ready' || state.steps.some(step => step.scenarioId === scenarioId
            && step.stepId === handoff.stepId
            && step.classification === 'formal'
            && step.outcome === 'failed'))
        && handoff.kind === 'compensation'
        && handoff.state === 'consumed'
        && handoff.decision === 'applied')
    ? 'diagnostic'
    : 'formal';

const reopenCompensatedPath = (/** @type {{scenarioId: string, state: RunState, stepId: string}} */ {scenarioId, state, stepId}) => {
    const scenario = state.plan.scenarios.find(item => item.archiveKind === scenarioId);
    if (scenario === undefined) return state;
    const failedIndex = stepId === 'scenario-ready'
        ? -1
        : scenario.steps.find(item => item.stepId === stepId)?.index;
    if (!Number.isInteger(failedIndex)) return state;
    const scenarioIndex = state.plan.scenarios.findIndex(item => item.archiveKind === scenarioId);
    const reopenScenarios = stepId === 'scenario-ready'
        ? new Set(state.plan.scenarios.slice(scenarioIndex)
            .filter(item => item.machineKey === scenario.machineKey)
            .map(item => item.archiveKind))
        : new Set([scenarioId]);
    return {
        ...state,
        steps: state.steps.map(record => {
            if (!reopenScenarios.has(record.scenarioId)
                || record.classification !== 'unresolved'
                || record.outcome !== 'not-run') return record;
            if (record.scenarioId === scenarioId) {
                const index = scenario.steps.find(item => item.stepId === record.stepId)?.index;
                if (typeof index !== 'number' || typeof failedIndex !== 'number' || index <= failedIndex) return record;
            }
            return {
                ...record,
                classification: null,
                evidencePath: null,
                handoffId: null,
                outcome: null,
                reason: null,
                state: 'pending',
            };
        }),
    };
};

const beginStep = (/** @type {{machineKey: string, scenario: MachineScenario, step: PlannedStep, state: RunState}} */ {machineKey, scenario, step, state}) => ({
    ...state,
    inFlight: [...state.inFlight, {
        machineKey,
        operation: step.operationContract ?? 'run-guest',
        scenarioId: scenario.archiveKind,
        startedRevision: state.revision + 1,
        stepId: step.stepId,
    }].sort((left, right) => inFlightOrder(left) - inFlightOrder(right)),
    steps: state.steps.map(record => record.scenarioId === scenario.archiveKind && record.stepId === step.stepId
        ? {...record, state: 'in-flight'}
        : record),
});

const finishStep = (/** @type {{classification: string, evidencePath: string, handoffId?: string | null, outcome: string, reason: StepReason | null, scenario: MachineScenario, state: RunState, step: PlannedStep}} */ {classification, evidencePath, handoffId = null, outcome, reason, scenario, state, step}) => ({
    ...state,
    inFlight: state.inFlight.filter(record => record.machineKey !== scenario.machineKey),
    steps: state.steps.map(record => record.scenarioId === scenario.archiveKind && record.stepId === step.stepId
        ? {
            ...record,
            classification,
            evidencePath,
            handoffId,
            outcome,
            reason,
            state: 'terminal',
        }
        : record),
});

const blockRemainingMachinePath = (/** @type {{code: string, message: string, scenario: MachineScenario, sourceStepId: string, state: RunState}} */ {code, message, scenario, sourceStepId, state}) => {
    const scenarioIndex = state.plan.scenarios.findIndex(item => item.archiveKind === scenario.archiveKind);
    const blockedScenarios = new Set(state.plan.scenarios.slice(scenarioIndex)
        .filter(item => item.machineKey === scenario.machineKey)
        .map(item => item.archiveKind));
    const source = {scenarioId: scenario.archiveKind, stepId: sourceStepId};
    return {
        ...state,
        cleanup: state.cleanup.map(record => blockedScenarios.has(record.scenarioId)
            ? {
                ...record,
                outcome: 'failed',
                reason: {
                    code: record.scenarioId === scenario.archiveKind ? code : 'cleanup-failed',
                    message,
                    source: record.scenarioId === scenario.archiveKind ? null : source,
                },
                stage: 'final',
            }
            : record),
        steps: state.steps.map(record => blockedScenarios.has(record.scenarioId) && record.state !== 'terminal'
            ? {
                ...record,
                classification: 'unresolved',
                outcome: 'not-run',
                reason: {code: 'cleanup-failed', message, source},
                state: 'terminal',
            }
            : record),
    };
};

const holdFailedScenario = async (/** @type {{configuration: VmConfiguration, fileSystem: FileSystem, idFactory: () => string, machineLifecycleAdapter: MachineLifecycleAdapter, result: unknown, resultPath: string, runPath: string, scenario: MachineScenario, step: PlannedStep, store: TransitionStore, workspaceDirectory: string}} */ {configuration, fileSystem, idFactory, machineLifecycleAdapter, result, resultPath, runPath, scenario, step, store, workspaceDirectory}) => {
    await store.update(state => ({
        ...state,
        cleanup: state.cleanup.map(record => record.scenarioId === scenario.archiveKind
            ? {...record, stage: 'failure-hold'}
            : record),
    }));
    const machine = configuration.machines[scenario.machineKey];
    for (const operation of ['hard-power-off', 'read-power-state']) {
        const observed = await runLifecycleOperation({
            adapter: machineLifecycleAdapter,
            machine,
            machineKey: scenario.machineKey,
            operation,
            runPath,
            scenarioId: scenario.archiveKind,
            store,
            workspaceDirectory,
        });
        if (observed.status === 'failed') {
            await store.update(state => blockRemainingMachinePath({
                code: 'failure-hold-failed',
                message: observed.message,
                scenario,
                sourceStepId: step.stepId,
                state,
            }));
            return;
        }
    }
    await store.update(state => ({
        ...state,
        cleanup: state.cleanup.map(record => record.scenarioId === scenario.archiveKind
            ? {...record, outcome: 'passed', reason: null}
            : record),
        steps: closeFailedDependencies({
            failedLocator: {plan: state.plan, scenarioId: scenario.archiveKind, stepId: step.stepId},
            steps: state.steps,
        }),
    }));
    await appendCompensationAuthorization({
        fileSystem,
        idFactory,
        result,
        resultPath,
        runPath,
        scenarioId: scenario.archiveKind,
        stepId: step.stepId,
        store,
    });
};

const cleanupReleaseScenario = async (/** @type {{configuration: VmConfiguration, fileSystem: FileSystem, guestAdapter: GuestAdapter, machineLifecycleAdapter: MachineLifecycleAdapter, runPath: string, scenario: MachineScenario, store: TransitionStore, workspaceDirectory: string}} */ {configuration, fileSystem, guestAdapter, machineLifecycleAdapter, runPath, scenario, store, workspaceDirectory}) => {
    const machine = configuration.machines[scenario.machineKey];
    const invoke = (/** @type {string} */ operation) => runLifecycleOperation({
        adapter: machineLifecycleAdapter,
        machine,
        machineKey: scenario.machineKey,
        operation,
        runPath,
        scenarioId: scenario.archiveKind,
        store,
        workspaceDirectory,
    });
    const operations = ['hard-power-off', 'revert-snapshot', 'read-power-state', 'read-snapshots'];
    let failure = null;
    for (const operation of operations) {
        const result = await invoke(operation);
        if (result.status === 'failed') {
            failure = result.message;
            break;
        }
        if (operation === 'revert-snapshot' && result.observation.snapshot !== machine.snapshot) failure = 'The cleanup snapshot identity does not match.';
        if (operation === 'read-power-state' && result.observation.powerState !== 'powered-off') failure = 'The release machine is not powered off after cleanup.';
        if (operation === 'read-snapshots' && result.observation.currentSnapshot !== machine.snapshot) failure = 'The cleanup current snapshot does not match.';
        if (failure !== null) break;
    }
    const reason = failure === null ? null : {code: 'cleanup-failed', message: failure, source: null};
    await store.update(state => ({
        ...state,
        cleanup: state.cleanup.map(record => record.scenarioId === scenario.archiveKind
            ? {...record, outcome: failure === null ? 'passed' : 'failed', reason, stage: 'final'}
            : record),
    }));
    if (failure !== null) {
        const finalStep = scenario.steps.at(-1);
        if (finalStep === undefined) throw releaseValidationOperationError('state-invalid', runPath);
        await store.update(state => blockRemainingMachinePath({
            code: 'cleanup-failed',
            message: failure,
            scenario,
            sourceStepId: finalStep.stepId,
            state,
        }));
        return false;
    }

    const current = await store.read();
    const records = current.steps.filter(record => record.scenarioId === scenario.archiveKind);
    if (!records.every(record => record.classification === 'formal' && record.outcome === 'passed')) return true;
    const sourceDirectory = join(dirname(runPath), 'archive-source', ...scenario.archiveKind.split('/'));
    const outputPath = join(dirname(runPath), 'archives', ...scenario.archiveKind.split('/')) + '.tar';
    try {
        await fileSystem.writeFile(join(sourceDirectory, 'summary.json'), canonicalJson({
            matchesExpected: true,
            steps: scenario.steps.map(item => item.stepId),
            summary: 'Every recorded step matches the release expectation.',
        }), {flag: 'wx'});
    } catch {
        await store.update(state => ({
            ...state,
            archives: state.archives.map(record => record.archiveKind === scenario.archiveKind
                ? {...record, reason: {code: 'create-failed', message: 'The archive summary could not be written.'}, status: 'failed'}
                : record),
        }));
        return true;
    }
    await store.update(state => ({
        ...state,
        archives: state.archives.map(record => record.archiveKind === scenario.archiveKind
            ? {archiveKind: record.archiveKind, outputPath, reason: null, sourceDirectory, status: 'pending'}
            : record),
    }));
    try {
        await createReleaseEvidenceArchive({archiveKind: scenario.archiveKind, outputPath, sourceDirectory});
    } catch {
        await store.update(state => ({
            ...state,
            archives: state.archives.map(record => record.archiveKind === scenario.archiveKind
                ? {...record, reason: {code: 'create-failed', message: 'The release evidence archive could not be created.'}, status: 'failed'}
                : record),
        }));
        return true;
    }
    try {
        await verifyReleaseEvidenceArchive({
            archiveKind: scenario.archiveKind,
            archivePath: outputPath,
            sourceDirectory,
        });
        await store.update(state => ({
            ...state,
            archives: state.archives.map(record => record.archiveKind === scenario.archiveKind
                ? {...record, status: 'created'}
                : record),
        }));
    } catch {
        await store.update(state => ({
            ...state,
            archives: state.archives.map(record => record.archiveKind === scenario.archiveKind
                ? {...record, reason: {code: 'verify-failed', message: 'The release evidence archive could not be verified against its source.'}, status: 'failed'}
                : record),
        }));
    }
    return true;
};

const cleanupUnpreparedScenario = async (/** @type {{configuration: VmConfiguration, machineLifecycleAdapter: MachineLifecycleAdapter, runPath: string, scenario: MachineScenario, store: TransitionStore, workspaceDirectory: string}} */ {configuration, machineLifecycleAdapter, runPath, scenario, store, workspaceDirectory}) => {
    const machine = configuration.machines[scenario.machineKey];
    const invoke = (/** @type {string} */ operation) => runLifecycleOperation({
        adapter: machineLifecycleAdapter,
        machine,
        machineKey: scenario.machineKey,
        operation,
        runPath,
        scenarioId: scenario.archiveKind,
        store,
        workspaceDirectory,
    });
    let failure = null;
    for (const operation of ['hard-power-off', 'revert-snapshot', 'read-power-state', 'read-snapshots']) {
        const result = await invoke(operation);
        if (result.status === 'failed') {
            failure = result.message;
            break;
        }
        if (operation === 'revert-snapshot' && result.observation.snapshot !== machine.snapshot) {
            failure = 'The cleanup snapshot identity does not match.';
        }
        if (operation === 'read-power-state' && result.observation.powerState !== 'powered-off') {
            failure = 'The release machine is not powered off after cleanup.';
        }
        if (operation === 'read-snapshots' && result.observation.currentSnapshot !== machine.snapshot) {
            failure = 'The cleanup current snapshot does not match.';
        }
        if (failure !== null) break;
    }
    await store.update(state => ({
        ...state,
        cleanup: state.cleanup.map(record => {
            const planned = state.plan.scenarios.find(item => item.archiveKind === record.scenarioId);
            const unavailable = planned?.machineKey === scenario.machineKey
                && state.steps.filter(step => step.scenarioId === record.scenarioId)
                    .every(step => step.classification === 'unresolved' && step.outcome === 'not-run');
            if (record.scenarioId !== scenario.archiveKind && !unavailable) return record;
            return {
                ...record,
                outcome: failure === null ? 'passed' : 'failed',
                reason: failure === null ? null : {code: 'cleanup-failed', message: failure, source: null},
                stage: 'final',
            };
        }),
    }));
};

const RELEASE_GUEST_FAILURE_PREFIX = 'The guest release validation step could not be captured.';
const RELEASE_GUEST_FAILURE_CAUSE_LIMIT = 512;

const redactReleaseMachineSensitiveText = (/** @type {string} */ text, /** @type {VmMachine} */ machine) => {
    let result = text;
    const guestPasswordValues = machine?.guestPasswords !== null
        && typeof machine?.guestPasswords === 'object'
        && !Array.isArray(machine.guestPasswords)
        ? Object.values(machine.guestPasswords)
        : [];
    const sensitiveValues = [
        machine?.ssh?.hostKey,
        machine?.ssh?.identityFile,
        machine?.vmwareEncryptionPassword,
        ...guestPasswordValues,
    ]
        .filter(isNonemptyString)
        .flatMap(value => [value, value.replaceAll('\\', '/'), value.replaceAll('/', '\\')])
        .sort((left, right) => right.length - left.length);
    for (const value of new Set(sensitiveValues)) result = result.replaceAll(value, '[redacted]');
    result = result.replaceAll(/\s+/gu, ' ').trim();
    if (result.length > RELEASE_GUEST_FAILURE_CAUSE_LIMIT) {
        result = `${result.slice(0, RELEASE_GUEST_FAILURE_CAUSE_LIMIT - 3)}...`;
    }
    return result;
};

export const releaseGuestFailureSummary = (/** @type {unknown} */ error, /** @type {VmMachine} */ machine) => {
    if (!(error instanceof Error) || typeof error.message !== 'string' || error.message.trim() === '') {
        return RELEASE_GUEST_FAILURE_PREFIX;
    }
    const cause = redactReleaseMachineSensitiveText(error.message, machine);
    return `${RELEASE_GUEST_FAILURE_PREFIX.slice(0, -1)}: ${cause}`;
};

const recordBindableGuestCaptureFailure = async (/** @type {{configuration: VmConfiguration, consume?: {handoffId: string, responsePath: string, summary: string} | null, error: unknown, fileSystem: FileSystem, idFactory: () => string, machineLifecycleAdapter: MachineLifecycleAdapter, runPath: string, scenario: MachineScenario, step: PlannedStep, store: TransitionStore, workspaceDirectory: string}} */ {
    configuration,
    consume = null,
    error,
    fileSystem,
    idFactory,
    machineLifecycleAdapter,
    runPath,
    scenario,
    step,
    store,
    workspaceDirectory,
}) => {
    const summary = releaseGuestFailureSummary(error, configuration.machines[scenario.machineKey]);
    const result = {
        evaluation: 'full',
        files: [],
        matchesExpected: false,
        mechanicalContract: step.mechanicalContract,
        observableState: {matchesExpected: false, summary},
        operationEvidence: {matchesExpected: false, summary},
        status: 'evaluated',
        summary,
    };
    const resultPath = await persistRunResult({fileSystem, idFactory, result, runPath});
    const current = await store.read();
    const existing = current.steps.find(record => record.scenarioId === scenario.archiveKind && record.stepId === step.stepId);
    if (existing === undefined) throw releaseValidationOperationError('state-invalid', runPath);
    await store.update(state => {
        const failed = existing.classification === 'formal' && existing.outcome === 'failed'
            ? {...state, inFlight: state.inFlight.filter(record => record.machineKey !== scenario.machineKey)}
            : finishStep({
                classification: 'formal',
                evidencePath: resultPath,
                outcome: 'failed',
                reason: {code: 'adapter-failed', message: summary, source: null},
                scenario,
                state,
                step,
            });
        return consume === null
            ? failed
            : {
                ...failed,
                handoffs: failed.handoffs.map(handoff => handoff.handoffId === consume.handoffId
                    ? {...handoff, responsePath: consume.responsePath, state: 'consumed', summary: consume.summary}
                    : handoff),
            };
    });
    await holdFailedScenario({
        configuration,
        fileSystem,
        idFactory,
        machineLifecycleAdapter,
        result,
        resultPath,
        runPath,
        scenario,
        step,
        store,
        workspaceDirectory,
    });
};

const runPreparedScenario = async (/** @type {{configuration: VmConfiguration, fileSystem: FileSystem, guestAdapter: GuestAdapter, idFactory: () => string, machineLifecycleAdapter: MachineLifecycleAdapter, processAdapter: HostProcessAdapter, runPath: string, scenario: MachineScenario, store: TransitionStore, workspaceBoundary?: WorkspaceBoundary, workspaceDirectory: string}} */ {configuration, fileSystem, guestAdapter, idFactory, machineLifecycleAdapter, processAdapter, runPath, scenario, store, workspaceBoundary, workspaceDirectory}) => {
    for (const step of scenario.steps) {
        const current = await store.read();
        const record = current.steps.find(item => item.scenarioId === scenario.archiveKind && item.stepId === step.stepId);
        if (record === undefined) throw releaseValidationOperationError('state-invalid', runPath);
        if (record.state === 'terminal') continue;
        if (step.judgment === 'semantic') {
            await appendSemanticActionHandoff({
                fileSystem,
                idFactory,
                machineKey: scenario.machineKey,
                runPath,
                scenarioId: scenario.archiveKind,
                stepId: step.stepId,
                store,
                workspaceDirectory,
            });
            return false;
        }
        await store.update(state => beginStep({machineKey: scenario.machineKey, scenario, state, step}));
        let executed;
        try {
            executed = await runAutomaticMechanicalStep({
                configuration,
                fileSystem,
                guestAdapter,
                machineKey: scenario.machineKey,
                processAdapter,
                runId: current.runId,
                scenario,
                step,
                workspaceBoundary,
                workspaceDirectory,
            });
        } catch (error) {
            if (isAdapterResultInvalidError(error) || isReleaseValidationOperationError(error)) {
                await store.update(state => ({
                    ...state,
                    inFlight: state.inFlight.filter(item => item.machineKey !== scenario.machineKey),
                    steps: state.steps.map(item => item.scenarioId === scenario.archiveKind && item.stepId === step.stepId
                        ? {
                            ...item,
                            classification: null,
                            evidencePath: null,
                            handoffId: null,
                            outcome: null,
                            reason: null,
                            state: 'pending',
                        }
                        : item),
                }));
                if (isAdapterResultInvalidError(error)) throw releaseValidationOperationError('adapter-result-invalid', runPath);
                if (isReleaseValidationOperationError(error)) throw {...error, runPath};
                throw releaseValidationOperationError('adapter-result-invalid', runPath);
            }
            const summary = releaseGuestFailureSummary(error, configuration.machines[scenario.machineKey]);
            const result = {
                evaluation: 'full',
                files: [],
                matchesExpected: false,
                mechanicalContract: step.mechanicalContract,
                observableState: {matchesExpected: false, summary},
                operationEvidence: {matchesExpected: false, summary},
                status: 'evaluated',
                summary,
            };
            const resultPath = await persistRunResult({fileSystem, idFactory, result, runPath});
            const classification = stepClassification({scenarioId: scenario.archiveKind, state: await store.read()});
            await store.update(state => finishStep({
                classification,
                evidencePath: resultPath,
                outcome: 'failed',
                reason: {code: 'adapter-failed', message: result.summary, source: null},
                scenario,
                state,
                step,
            }));
            await holdFailedScenario({
                configuration,
                fileSystem,
                idFactory,
                machineLifecycleAdapter,
                result,
                resultPath,
                runPath,
                scenario,
                step,
                store,
                workspaceDirectory,
            });
            return false;
        }
        const classification = stepClassification({scenarioId: scenario.archiveKind, state: await store.read()});
        await store.update(state => finishStep({
            classification,
            evidencePath: executed.finalization.validationPath,
            outcome: executed.evaluation.matchesExpected ? 'passed' : 'failed',
            reason: executed.evaluation.matchesExpected
                ? null
                : {code: 'expectation-mismatch', message: executed.evaluation.summary, source: null},
            scenario,
            state,
            step,
        }));
        if (!executed.evaluation.matchesExpected) {
            await holdFailedScenario({
                configuration,
                fileSystem,
                idFactory,
                machineLifecycleAdapter,
                result: executed.evaluation,
                resultPath: executed.evaluationPath,
                runPath,
                scenario,
                step,
                store,
                workspaceDirectory,
            });
            return false;
        }
    }
    return cleanupReleaseScenario({
        configuration,
        fileSystem,
        guestAdapter,
        machineLifecycleAdapter,
        runPath,
        scenario,
        store,
        workspaceDirectory,
    });
};

const continueMachineScenarios = async (/** @type {{configuration: VmConfiguration, fileSystem: FileSystem, guestAdapter: GuestAdapter, idFactory: () => string, machineLifecycleAdapter: MachineLifecycleAdapter, processAdapter: HostProcessAdapter, runPath: string, scenarioId: string, store: TransitionStore, workspaceBoundary?: WorkspaceBoundary, workspaceDirectory: string}} */ {configuration, fileSystem, guestAdapter, idFactory, machineLifecycleAdapter, processAdapter, runPath, scenarioId, store, workspaceBoundary, workspaceDirectory}) => {
    workspaceBoundary = requireWorkspaceBoundary(workspaceBoundary);
    const current = await store.read();
    const selected = current.plan.scenarios.find(item => item.archiveKind === scenarioId);
    if (!hasMachineScenario(selected)) throw releaseValidationOperationError('state-invalid', runPath);
    const scenarios = current.plan.scenarios.filter(item => item.machineKey === selected.machineKey);
    const start = scenarios.findIndex(item => item.archiveKind === scenarioId);
    for (let index = start; index < scenarios.length; index += 1) {
        const scenario = scenarios[index];
        if (!hasMachineScenario(scenario)) throw releaseValidationOperationError('state-invalid', runPath);
        if (index > start) {
            const prepared = await prepareReleaseScenario({
                configuration,
                fileSystem,
                guestAdapter,
                machine: {adapter: machineLifecycleAdapter, value: configuration.machines[scenario.machineKey]},
                machineKey: scenario.machineKey,
                processAdapter,
                runDirectory: dirname(runPath),
                runPath,
                scenario,
                store,
                workspaceBoundary,
                workspaceDirectory,
            });
            if (prepared.status === 'failed' && 'message' in prepared) {
                await processInitialMachineFailure({
                    failure: prepared,
                    fileSystem,
                    idFactory,
                    machine: {adapter: machineLifecycleAdapter, value: configuration.machines[scenario.machineKey]},
                    machineKey: scenario.machineKey,
                    runDirectory: dirname(runPath),
                    scenarioId: scenario.archiveKind,
                    store,
                    workspaceDirectory,
                });
                return;
            }
        }
        if (!await runPreparedScenario({
            configuration,
            fileSystem,
            guestAdapter,
            idFactory,
            machineLifecycleAdapter,
            processAdapter,
            runPath,
            scenario,
            store,
            workspaceBoundary,
            workspaceDirectory,
        })) return;
    }
};

const runWithConcurrency = async (/** @type {{items: readonly string[], limit: number, operation: (item: string) => Promise<void>}} */ {items, limit, operation}) => {
    let index = 0;
    const worker = async () => {
        while (index < items.length) {
            const item = items[index];
            index += 1;
            await operation(item);
        }
    };
    await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
};

const runScenarioReadinessCompensationCheck = async (/** @type {{configuration: VmConfiguration, guestAdapter: GuestAdapter, machineLifecycleAdapter: MachineLifecycleAdapter, runPath: string, scenario: MachineScenario, store: TransitionStore, workspaceDirectory: string}} */ {
    configuration,
    guestAdapter,
    machineLifecycleAdapter,
    runPath,
    scenario,
    store,
    workspaceDirectory,
}) => {
    const machine = configuration.machines[scenario.machineKey];
    const invoke = (/** @type {string} */ operation) => runLifecycleOperation({
        adapter: machineLifecycleAdapter,
        machine,
        machineKey: scenario.machineKey,
        operation,
        runPath,
        scenarioId: scenario.archiveKind,
        store,
        workspaceDirectory,
    });
    let observed = await invoke('read-snapshots');
    if (observed.status === 'failed'
        || !Array.isArray(observed.observation.snapshots)
        || !observed.observation.snapshots.includes(machine.snapshot)
        || observed.observation.currentSnapshot !== machine.snapshot) {
        const summary = observed.status === 'failed'
            ? observed.message
            : 'The current release snapshot does not match the configured identity.';
        return scenarioReadinessCheckResult({matchesExpected: false, scenarioId: scenario.archiveKind, summary});
    }
    observed = await invoke('read-power-state');
    if (observed.status === 'failed') {
        return scenarioReadinessCheckResult({matchesExpected: false, scenarioId: scenario.archiveKind, summary: observed.message});
    }
    if (observed.observation.powerState !== 'running') {
        return scenarioReadinessCheckResult({
            matchesExpected: false,
            scenarioId: scenario.archiveKind,
            summary: 'The release machine is not running after compensation.',
        });
    }
    observed = await invoke('wait-guest-address');
    if (observed.status === 'failed') {
        return scenarioReadinessCheckResult({matchesExpected: false, scenarioId: scenario.archiveKind, summary: observed.message});
    }
    const runId = (await store.read()).runId;
    const guestWorkspace = releaseGuestWorkspace(scenario.machineKey, scenario.archiveKind, runId);
    const homeDirectory = releaseGuestPath(scenario.machineKey, guestWorkspace, 'home');
    const sourceDirectory = releaseGuestPath(scenario.machineKey, guestWorkspace, 'source');
    const targetDirectory = scenario.targetKind !== null
        ? releaseGuestPath(scenario.machineKey, guestWorkspace, 'target')
        : null;
    const auditedDirectory = scenario.steps[0].auditedLocation === 'repository'
        ? targetDirectory
        : scenario.steps[0].auditedLocation === 'source-checkout'
            ? sourceDirectory
            : homeDirectory;
    const nodeExecutable = machine.nodeExecutables[resolveReleaseValidationRuntimeRole(scenario)];
    if (nodeExecutable === undefined || auditedDirectory === null) {
        return scenarioReadinessCheckResult({matchesExpected: false, scenarioId: scenario.archiveKind, summary: 'The scenario runtime or audited Repository binding is invalid.'});
    }
    const directories = [guestWorkspace, homeDirectory, sourceDirectory, targetDirectory].filter(isNonemptyString);
    const directoryCheck = requireGuestProcessResult(await guestAdapter.run({
        machine,
        machineKey: scenario.machineKey,
        remoteArguments: [nodeExecutable, '-e', `import('node:fs/promises').then(async fs=>{for(const path of ${JSON.stringify(directories)}){const value=await fs.lstat(path);if(!value.isDirectory()||value.isSymbolicLink())throw new Error('invalid directory')}})`],
        workspaceDirectory: dirname(runPath),
    }), runPath);
    if (directoryCheck.exitCode !== 0 || new Set(directories).size !== directories.length) {
        return scenarioReadinessCheckResult({
            matchesExpected: false,
            scenarioId: scenario.archiveKind,
            summary: 'The scenario work, home, source, or audited Repository binding is invalid.',
        });
    }
    for (const repositoryDirectory of [...new Set([sourceDirectory, auditedDirectory])]) {
        const repositoryCheck = requireGuestProcessResult(await guestAdapter.run({
            machine,
            machineKey: scenario.machineKey,
            remoteArguments: ['git', '-C', repositoryDirectory, 'diff', '--quiet'],
            workspaceDirectory: dirname(runPath),
        }), runPath);
        const untrackedCheck = requireGuestProcessResult(await guestAdapter.run({
            machine,
            machineKey: scenario.machineKey,
            remoteArguments: ['git', '-C', repositoryDirectory, 'ls-files', '--others', '--exclude-standard'],
            workspaceDirectory: dirname(runPath),
        }), runPath);
        if (repositoryCheck.exitCode !== 0 || untrackedCheck.exitCode !== 0 || untrackedCheck.stdout.length !== 0) {
            return scenarioReadinessCheckResult({
                matchesExpected: false,
                scenarioId: scenario.archiveKind,
                summary: 'The scenario audited Repository baseline is not ready.',
            });
        }
    }
    return scenarioReadinessCheckResult({
        matchesExpected: true,
        scenarioId: scenario.archiveKind,
        summary: 'The scenario readiness observable state matches the registered expectation.',
    });
};

const recaptureScenarioReadinessCompensation = async (/** @type {{configuration: VmConfiguration, fileSystem: FileSystem, guestAdapter: GuestAdapter, idFactory: () => string, machineLifecycleAdapter: MachineLifecycleAdapter, runPath: string, scenario: MachineScenario, store: TransitionStore, workspaceDirectory: string}} */ {
    configuration,
    fileSystem,
    guestAdapter,
    idFactory,
    machineLifecycleAdapter,
    runPath,
    scenario,
    store,
    workspaceDirectory,
}) => {
    try {
        return await runScenarioReadinessCompensationCheck({
            configuration,
            guestAdapter,
            machineLifecycleAdapter,
            runPath,
            scenario,
            store,
            workspaceDirectory,
        });
    } catch (error) {
        const operationError = bindReleaseValidationOperationError(error, runPath);
        if (operationError !== null) throw operationError;
        const machineValue = configuration.machines[scenario.machineKey];
        await store.update(state => ({
            ...state,
            inFlight: state.inFlight.filter(record => record.machineKey !== scenario.machineKey),
        }));
        await processInitialMachineFailure({
            failure: {message: releaseGuestFailureSummary(error, machineValue)},
            fileSystem,
            idFactory,
            machine: {adapter: machineLifecycleAdapter, value: machineValue},
            machineKey: scenario.machineKey,
            runDirectory: dirname(runPath),
            scenarioId: scenario.archiveKind,
            store,
            workspaceDirectory,
        });
        return null;
    }
};

/**
 * 从 closed candidate commit, absolute VM configuration path 和 current session workspace 启动一次 release validation run.
 * 它先验证 workspace boundary, configuration 与 3 个 bundle identity, 再创建 immutable Scenario Plan,
 * exclusive 写入 revision 0 `run.json`, 并按 `maxParallelMachines` 有界推进各 machine 的独立 scenario paths.
 * Dependencies 可以替换 filesystem, bundle inspection, configuration loading, identity generation, host process,
 * guest 和 machine lifecycle Adapter, 但返回 shape 仍必须满足相同边界.
 * Result 是 bounded `paused` 或 `completed` domain result, 只暴露 run path 和待处理文件路径等受限信息.
 * Step 或 lifecycle failure 会作为已绑定 domain evidence 保留并继续独立路径. Invalid input, Adapter result,
 * workspace identity, configuration, bundle 或 persistence 会抛出稳定 release operation error. 已创建的 run 不会伪装为成功.
 */
export const startReleaseValidationRun = async (/** @type {{candidateCommit: string, configurationPath: string, postInitChoiceState?: unknown, workspaceDirectory: string}} */ {candidateCommit, configurationPath, postInitChoiceState, workspaceDirectory}, /** @type {{fileSystem?: FileSystem, guestAdapter?: GuestAdapter, idFactory?: () => string, inspectBundles?: typeof inspectReleaseValidationBundles, loadConfiguration?: (path: string, fileSystem: FileSystem) => Promise<Readonly<VmConfiguration>>, loadReleaseConfiguration?: () => Promise<unknown>, machineLifecycleAdapter?: MachineLifecycleAdapter, processAdapter?: HostProcessAdapter, releaseConfiguration?: unknown, workspaceBoundary?: WorkspaceBoundary}} */ {
    fileSystem = defaultFileSystem,
    guestAdapter = createReleaseVmwareGuestAdapter(),
    idFactory = randomUUID,
    inspectBundles = inspectReleaseValidationBundles,
    loadConfiguration = loadReleaseVmConfiguration,
    loadReleaseConfiguration = loadReleaseValidationConfiguration,
    machineLifecycleAdapter,
    processAdapter = createReleaseHostProcessAdapter(),
    releaseConfiguration,
    workspaceBoundary,
} = {}) => {
    if (!OBJECT_ID_PATTERN.test(candidateCommit)
        || typeof configurationPath !== 'string'
        || !isAbsolute(configurationPath)
        || typeof workspaceDirectory !== 'string'
        || !isAbsolute(workspaceDirectory)) {
        throw releaseValidationOperationError('input-invalid');
    }
    try {
        workspaceBoundary = requireWorkspaceBoundary(workspaceBoundary);
        workspaceBoundary(workspaceDirectory, 'Release validation workspace');
    } catch {
        throw releaseValidationOperationError('workspace-invalid');
    }
    let configuration;
    let currentReleaseConfiguration;
    try {
        const inputs = await loadReleaseValidationInputs({configurationPath, releaseConfiguration}, {
            fileSystem,
            loadConfiguration,
            loadReleaseConfiguration,
        });
        configuration = inputs.vmConfiguration;
        currentReleaseConfiguration = inputs.releaseConfiguration;
    } catch {
        throw releaseValidationOperationError('configuration-invalid');
    }
    machineLifecycleAdapter ??= createReleaseVmwareMachineLifecycleAdapter({
        fileSystem,
        processAdapter,
        releaseConfiguration: currentReleaseConfiguration,
    });
    let bundleFacts;
    try {
        bundleFacts = await inspectBundles({
            agentAssistedBundlePath: join(workspaceDirectory, 'agentAssisted.bundle'),
            candidateBundlePath: join(workspaceDirectory, 'candidate.bundle'),
            candidateCommit,
            plainBundlePath: join(workspaceDirectory, 'plain.bundle'),
        }, {
            fileSystem,
            releaseConfiguration: currentReleaseConfiguration,
            workspaceBoundary,
        });
    } catch {
        throw releaseValidationOperationError('bundle-invalid');
    }
    let plan;
    try {
        plan = postInitChoiceState === undefined
            ? createReleaseValidationScenarioPlan({
                bundleFacts,
                candidateCommit,
                releaseConfiguration: currentReleaseConfiguration,
            })
            : createReleasePostInitScenarioPlan({
                bundleFacts,
                candidateCommit,
                releaseConfiguration: currentReleaseConfiguration,
                state: postInitChoiceState,
            });
    } catch {
        throw releaseValidationOperationError('input-invalid');
    }
    const runId = idFactory();
    if (!UUID_PATTERN.test(runId)) throw releaseValidationOperationError('input-invalid');
    const runDirectory = join(workspaceDirectory, 'runs', runId);
    const runPath = join(runDirectory, 'run.json');
    const state = createInitialRunState({
        configurationPath,
        maxParallelMachines: configuration.maxParallelMachines,
        plan,
        runId,
    });
    try {
        await fileSystem.mkdir(dirname(runDirectory), {recursive: true});
        await fileSystem.mkdir(runDirectory, {recursive: false});
        await fileSystem.writeFile(runPath, runStateBytes(state), {encoding: 'utf8', flag: 'wx'});
    } catch {
        throw releaseValidationOperationError('persistence-failed', runPath);
    }
    if (machineLifecycleAdapter === undefined || typeof machineLifecycleAdapter.run !== 'function') {
        throw releaseValidationOperationError('adapter-result-invalid', runPath);
    }
    const store = createTransitionStore({fileSystem, runPath, state});
    await runWithConcurrency({
        items: RELEASE_MACHINE_KEYS,
        limit: configuration.maxParallelMachines,
        operation: async (/** @type {string} */ machineKey) => {
            const machine = configuration.machines[machineKey];
            for (const scenario of plan.scenarios.filter(item => item.machineKey === machineKey)) {
                if (!hasMachineScenario(scenario)) throw releaseValidationOperationError('state-invalid', runPath);
                const result = await prepareReleaseScenario({
                    configuration,
                    fileSystem,
                    guestAdapter,
                    machine: {adapter: machineLifecycleAdapter, value: machine},
                    machineKey,
                    processAdapter,
                    runDirectory,
                    runPath,
                    scenario,
                    store,
                    workspaceBoundary,
                    workspaceDirectory,
                });
                if (result.status === 'failed' && 'message' in result) {
                    await processInitialMachineFailure({
                        failure: result,
                        fileSystem,
                        idFactory,
                        machine: {adapter: machineLifecycleAdapter, value: machine},
                        machineKey,
                        runDirectory,
                        scenarioId: scenario.archiveKind,
                        store,
                        workspaceDirectory,
                    });
                    break;
                }
                const continueMachine = await runPreparedScenario({
                    configuration,
                    fileSystem,
                    guestAdapter,
                    idFactory,
                    machineLifecycleAdapter,
                    processAdapter,
                    runPath,
                    scenario,
                    store,
                    workspaceBoundary,
                    workspaceDirectory,
                });
                if (!continueMachine) break;
            }
        },
    });
    const finalState = await store.update(current => ({...current, status: current.handoffs.length > 0 ? 'paused' : 'running'}));
    return pausedRunResult({fileSystem, runPath, state: finalState});
};

const recoverInterruptedRunOperations = async (/** @type {{configuration: VmConfiguration, fileSystem: FileSystem, guestAdapter: GuestAdapter, idFactory: () => string, machineLifecycleAdapter: MachineLifecycleAdapter, processAdapter: HostProcessAdapter, runPath: string, state: RunState, workspaceBoundary?: WorkspaceBoundary, workspaceDirectory: string}} */ {
    configuration,
    fileSystem,
    guestAdapter,
    idFactory,
    machineLifecycleAdapter,
    processAdapter,
    runPath,
    state,
    workspaceBoundary,
    workspaceDirectory,
}) => {
    const interrupted = state.inFlight.filter((/** @type {{ operation: string; }} */ record) => record.operation !== 'capture');
    if (interrupted.length === 0) return state;
    if (machineLifecycleAdapter === undefined || typeof machineLifecycleAdapter.run !== 'function') {
        throw releaseValidationOperationError('adapter-result-invalid', runPath);
    }
    const store = createTransitionStore({fileSystem, runPath, state});
    for (const record of interrupted) {
        const scenario = state.plan.scenarios.find(item => item.archiveKind === record.scenarioId);
        if (!hasMachineScenario(scenario)) throw releaseValidationOperationError('state-invalid', runPath);
        if (record.stepId === null) throw releaseValidationOperationError('state-invalid', runPath);
        const recordStepId = record.stepId;
        const plannedStep = scenario.steps.find(step => step.stepId === recordStepId);
        const interruptedResult = plannedStep === undefined
            ? scenarioReadinessFullResult({
                matchesExpected: false,
                scenarioId: scenario.archiveKind,
                summary: 'The scenario preparation was interrupted before its result was committed.',
            })
            : {
                    code: 'interrupted',
                    message: 'The release validation operation did not commit a result before interruption.',
                    operation: record.operation,
                    status: 'failed',
                };
        const evidencePath = await persistRunResult({fileSystem, idFactory, result: interruptedResult, runPath});
        state = await store.update(current => {
            let next = {
                ...current,
                inFlight: current.inFlight.filter(item => item.machineKey !== record.machineKey),
                recovery: [...current.recovery, {
                    machineKey: record.machineKey,
                    nextOperation: 'hard-power-off',
                    outcome: 'pending',
                    scenarioId: scenario.archiveKind,
                    sourceOperation: record.operation,
                    stepId: recordStepId,
                }].sort((left, right) => inFlightOrder(left) - inFlightOrder(right)),
            };
            if (plannedStep === undefined) return unresolvedMachineSteps({
                machineKey: record.machineKey,
                scenarioId: scenario.archiveKind,
                state: next,
            });
            next = {
                ...next,
                steps: next.steps.map(step => step.scenarioId === scenario.archiveKind && step.stepId === recordStepId
                    ? {
                        ...step,
                        classification: 'formal',
                        evidencePath,
                        outcome: 'failed',
                        reason: {
                            code: 'interrupted',
                            message: 'The release validation operation was interrupted before its result was committed.',
                            source: null,
                        },
                        state: 'terminal',
                    }
                    : step),
            };
            return {
                ...next,
                steps: closeFailedDependencies({
                    failedLocator: {plan: next.plan, scenarioId: scenario.archiveKind, stepId: recordStepId},
                    steps: next.steps,
                }),
            };
        });
        if (plannedStep === undefined) {
            await cleanupUnpreparedScenario({
                configuration,
                machineLifecycleAdapter,
                runPath,
                scenario,
                store,
                workspaceDirectory,
            });
        } else {
            await cleanupReleaseScenario({
                configuration,
                fileSystem,
                guestAdapter,
                machineLifecycleAdapter,
                runPath,
                scenario,
                store,
                workspaceDirectory,
            });
        }
        state = await store.update(current => {
            const cleanup = current.cleanup.find(item => item.scenarioId === scenario.archiveKind);
            if (cleanup === undefined) throw releaseValidationOperationError('state-invalid', runPath);
            return {
                ...current,
                recovery: current.recovery.map(item => item.machineKey === record.machineKey
                    ? {...item, nextOperation: null, outcome: cleanup.outcome === 'passed' ? 'passed' : 'failed'}
                    : item),
            };
        });
        const cleanup = state.cleanup.find(item => item.scenarioId === scenario.archiveKind);
        if (cleanup === undefined) throw releaseValidationOperationError('state-invalid', runPath);
        if (plannedStep === undefined && cleanup.outcome === 'passed') {
            state = await appendCompensationAuthorization({
                fileSystem,
                idFactory,
                result: interruptedResult,
                resultPath: evidencePath,
                runPath,
                scenarioId: scenario.archiveKind,
                stepId: 'scenario-ready',
                store,
            });
        } else if (plannedStep !== undefined && cleanup.outcome === 'passed') {
            const machineScenarios = state.plan.scenarios.filter(item => item.machineKey === scenario.machineKey);
            const nextScenario = machineScenarios[machineScenarios.findIndex(item => item.archiveKind === scenario.archiveKind) + 1];
            if (nextScenario !== undefined) {
                await continueMachineScenarios({
                    configuration,
                    fileSystem,
                    guestAdapter,
                    idFactory,
                    machineLifecycleAdapter,
                    processAdapter,
                    runPath,
                    scenarioId: nextScenario.archiveKind,
                    store,
                    workspaceBoundary,
                    workspaceDirectory,
                });
                state = await store.read();
            }
        }
    }
    return store.read();
};

/**
 * 在同一 Platform Host session 中从 absolute `runPath` 恢复一个已提交的 release validation run.
 * `responsePath` 为 null 时执行无 response 的恢复或继续推进. 非 null 时只消费与当前 pending handoff identity 匹配的 response.
 * 它先恢复已取得 revision ownership 的 orphan transition. 对中断的非 capture 操作记录 formal failure 并执行恢复.
 * 对 compensation response, Main Agent 已在 Runner 外修改 VM; 此 Interface 只重新采集并机械检查可观察的预期状态,
 * 或重新采集 semantic facts 并返回新的 judgment handoff. 它绝不重放原 mutating operation, 也不决定或执行补偿.
 * Dependencies 可以注入事实采集, filesystem, Adapter, configuration loading 和 identity generation, 供隔离验证使用.
 * Result 是 bounded `paused` 或 `completed` domain result. 新 handoff, 仍待处理的并行 failure 或未完成路径返回 `paused`.
 * Invalid path binding, state, response, Adapter result, configuration 或 persistence 会抛出稳定 release operation error.
 * 重试只从最后一次原子提交的 state 继续, 已消费 response 或与 orphan replacement 失配的 response 会被拒绝.
 */
export const resumeReleaseValidationRun = async (/** @type {{responsePath: string | null, runPath: string}} */ {responsePath, runPath}, /** @type {{captureMechanicalFacts?: (input: JsonObject) => Promise<unknown>, captureSemanticFacts?: (input: JsonObject) => Promise<unknown>, fileSystem?: FileSystem, guestAdapter?: GuestAdapter, idFactory?: () => string, loadConfiguration?: (path: string, fileSystem: FileSystem) => Promise<Readonly<VmConfiguration>>, loadReleaseConfiguration?: () => Promise<unknown>, machineLifecycleAdapter?: MachineLifecycleAdapter, processAdapter?: HostProcessAdapter, releaseConfiguration?: unknown, workspaceBoundary?: WorkspaceBoundary}} */ {
    captureMechanicalFacts,
    captureSemanticFacts,
    fileSystem = defaultFileSystem,
    guestAdapter = createReleaseVmwareGuestAdapter(),
    idFactory = randomUUID,
    loadConfiguration = loadReleaseVmConfiguration,
    loadReleaseConfiguration = loadReleaseValidationConfiguration,
    machineLifecycleAdapter,
    processAdapter = createReleaseHostProcessAdapter(),
    releaseConfiguration,
    workspaceBoundary,
} = {}) => {
    if (typeof runPath !== 'string' || !isAbsolute(runPath)
        || !(responsePath === null || typeof responsePath === 'string' && isAbsolute(responsePath))) {
        throw releaseValidationOperationError('input-invalid');
    }
    try {
        workspaceBoundary = requireWorkspaceBoundary(workspaceBoundary);
        workspaceBoundary(runPath, 'Release validation run path');
        if (responsePath !== null) workspaceBoundary(responsePath, 'Release validation response path');
    } catch {
        throw releaseValidationOperationError('identity-invalid', runPath);
    }
    let state = await readPersistentRunState(runPath, fileSystem);
    state = await recoverOrphanRunTransition({fileSystem, runPath, state});
    let configuration;
    let currentReleaseConfiguration;
    try {
        const inputs = await loadReleaseValidationInputs({
            configurationPath: state.configurationPath,
            releaseConfiguration,
        }, {
            fileSystem,
            loadConfiguration,
            loadReleaseConfiguration,
        });
        configuration = inputs.vmConfiguration;
        currentReleaseConfiguration = inputs.releaseConfiguration;
    } catch {
        throw releaseValidationOperationError('configuration-invalid', runPath);
    }
    machineLifecycleAdapter ??= createReleaseVmwareMachineLifecycleAdapter({
        fileSystem,
        processAdapter,
        releaseConfiguration: currentReleaseConfiguration,
    });
    if (responsePath === null && state.inFlight.some((/** @type {{ operation: string; }} */ record) => record.operation !== 'capture')) {
        state = await recoverInterruptedRunOperations({
            configuration,
            fileSystem,
            guestAdapter,
            idFactory,
            machineLifecycleAdapter,
            processAdapter,
            runPath,
            state,
            workspaceBoundary,
            workspaceDirectory: dirname(dirname(dirname(runPath))),
        });
        return pausedRunResult({fileSystem, runPath, state});
    }
    const pendingHandoffs = state.handoffs.filter((/** @type {{ state: string; }} */ handoff) => handoff.state === 'pending');
    if (responsePath !== null) {
        const responsePathIsCurrent = pendingHandoffs.some(handoff => responsePath === join(
            dirname(runPath),
            'responses',
            `${handoff.handoffId}.json`,
        ));
        if (!responsePathIsCurrent) throw releaseValidationOperationError('response-invalid', runPath);
        const response = await readResponse({fileSystem, responsePath, runPath});
        const pending = pendingHandoffs.find(handoff => handoff.handoffId === response?.handoffId);
        if (pending === undefined) throw releaseValidationOperationError('response-invalid', runPath);
        if (pending.kind === 'compensation') {
            const scenario = state.plan.scenarios.find(item => item.archiveKind === pending.scenarioId);
            if (!hasMachineScenario(scenario)) throw releaseValidationOperationError('state-invalid', runPath);
            const step = scenario.steps.find(item => item.stepId === pending.stepId);
            const semanticCompensation = step?.judgment === 'semantic';
            const mechanicalCompensation = step?.judgment === 'mechanical';
            if (!validateCompensationResponse({handoff: pending, response, runId: state.runId})
                || !(pending.stepId === 'scenario-ready' || semanticCompensation || mechanicalCompensation)
                || response.decision === 'applied'
                    && (machineLifecycleAdapter === undefined || typeof machineLifecycleAdapter.run !== 'function')
                || response.decision === 'declined' && pending.stepId === 'scenario-ready'
                    && (machineLifecycleAdapter === undefined || typeof machineLifecycleAdapter.run !== 'function')
                || response.decision === 'applied' && semanticCompensation
                    && typeof captureSemanticFacts !== 'function'
                    && (guestAdapter === undefined || typeof guestAdapter.run !== 'function')) {
                throw releaseValidationOperationError('response-invalid', runPath);
            }
            if (response.decision === 'declined') {
                state = await commitRunTransition({
                    fileSystem,
                    nextState: {
                        ...state,
                        handoffs: state.handoffs.map(handoff => handoff.handoffId === pending.handoffId
                            ? {
                                ...handoff,
                                decision: 'declined',
                                responsePath,
                                state: 'consumed',
                            }
                            : handoff),
                        status: 'running',
                    },
                    runPath,
                    state,
                });
                if (pending.stepId === 'scenario-ready') {
                    const store = createTransitionStore({fileSystem, runPath, state});
                    await cleanupUnpreparedScenario({
                        configuration,
                        machineLifecycleAdapter,
                        runPath,
                        scenario,
                        store,
                        workspaceDirectory: dirname(dirname(dirname(runPath))),
                    });
                    return pausedRunResult({fileSystem, runPath, state: await store.read()});
                }
                if (machineLifecycleAdapter === undefined || typeof machineLifecycleAdapter.run !== 'function') {
                    throw releaseValidationOperationError('adapter-result-invalid', runPath);
                }
                const store = createTransitionStore({fileSystem, runPath, state});
                await continueMachineScenarios({
                    configuration,
                    fileSystem,
                    guestAdapter,
                    idFactory,
                    machineLifecycleAdapter,
                    processAdapter,
                    runPath,
                    scenarioId: pending.scenarioId,
                    store,
                    workspaceBoundary,
                    workspaceDirectory: dirname(dirname(dirname(runPath))),
                });
                state = await store.read();
                if (state.handoffs.some((/** @type {{ state: string; }} */ handoff) => handoff.state === 'pending') && state.status !== 'paused') {
                    state = await store.update(current => ({...current, status: 'paused'}));
                }
                return pausedRunResult({fileSystem, runPath, state});
            }
            state = await commitRunTransition({
                fileSystem,
                nextState: {
                    ...state,
                    handoffs: state.handoffs.map(handoff => handoff.handoffId === pending.handoffId
                        ? {
                            ...handoff,
                            decision: 'applied',
                            responsePath,
                            state: 'consumed',
                        }
                        : handoff),
                    inFlight: [...state.inFlight, {
                        machineKey: scenario.machineKey,
                        operation: 'capture',
                        scenarioId: pending.scenarioId,
                        startedRevision: state.revision + 1,
                        stepId: pending.stepId,
                    }].sort((left, right) => inFlightOrder(left) - inFlightOrder(right)),
                    status: 'running',
                },
                runPath,
                state,
            });
            if (semanticCompensation) {
                const workspaceDirectory = dirname(dirname(dirname(runPath)));
                const store = createTransitionStore({fileSystem, runPath, state});
                let captured;
                try {
                    captured = await captureReleaseSemanticFacts({
                        captureSemanticFacts,
                        configuration,
                        fileSystem,
                        guestAdapter,
                        processAdapter,
                        runId: state.runId,
                        scenario,
                        stepId: pending.stepId,
                        workspaceBoundary,
                        workspaceDirectory,
                    });
                } catch (error) {
                    const operationError = bindReleaseValidationOperationError(error, runPath);
                    if (operationError !== null) throw operationError;
                    await recordBindableGuestCaptureFailure({
                        configuration,
                        error,
                        fileSystem,
                        idFactory,
                        machineLifecycleAdapter,
                        runPath,
                        scenario,
                        step,
                        store,
                        workspaceDirectory,
                    });
                    return pausedRunResult({fileSystem, runPath, state: await store.read()});
                }
                state = await appendSemanticJudgmentHandoff({
                    captured,
                    fileSystem,
                    idFactory,
                    machineKey: scenario.machineKey,
                    runPath,
                    scenarioId: pending.scenarioId,
                    stepId: pending.stepId,
                    store,
                });
                return pausedRunResult({fileSystem, runPath, state});
            }
            if (mechanicalCompensation) {
                const store = createTransitionStore({fileSystem, runPath, state});
                let mechanicalInput;
                try {
                    mechanicalInput = typeof captureMechanicalFacts === 'function'
                        ? await captureMechanicalFacts({
                            machine: configuration.machines[scenario.machineKey],
                            machineKey: scenario.machineKey,
                            scenarioId: pending.scenarioId,
                            stepId: pending.stepId,
                            workspaceDirectory: dirname(dirname(dirname(runPath))),
                        })
                        : await captureReleaseVmMechanicalObservation({
                            captureId: pending.handoffId,
                            configuration,
                            fileSystem,
                            guestAdapter,
                            machineKey: scenario.machineKey,
                            processAdapter,
                            runId: state.runId,
                            scenarioId: pending.scenarioId,
                            stepId: pending.stepId,
                            workspaceBoundary,
                            workspaceDirectory: dirname(dirname(dirname(runPath))),
                        });
                    if (!exactKeys(mechanicalInput, ['capturedFacts', 'currentObservation', 'operationActual'])
                        || mechanicalInput.operationActual !== null) {
                        throw adapterResultInvalidError('Mechanical compensation facts are invalid.');
                    }
                } catch (error) {
                    const operationError = bindReleaseValidationOperationError(error, runPath);
                    if (operationError !== null) throw operationError;
                    await recordBindableGuestCaptureFailure({
                        configuration,
                        error,
                        fileSystem,
                        idFactory,
                        machineLifecycleAdapter,
                        runPath,
                        scenario,
                        step,
                        store,
                        workspaceDirectory: dirname(dirname(dirname(runPath))),
                    });
                    return pausedRunResult({fileSystem, runPath, state: await store.read()});
                }
                let evaluation;
                try {
                    evaluation = evaluateReleaseMechanicalContract({
                        ...mechanicalInput,
                        evaluation: 'observable-state',
                        mechanicalContract: step.mechanicalContract,
                        mechanicalParameters: step.mechanicalParameters,
                    });
                } catch (error) {
                    const operationError = bindReleaseValidationOperationError(error, runPath);
                    if (operationError !== null) throw operationError;
                    throw releaseValidationOperationError('adapter-result-invalid', runPath);
                }
                if (!evaluation.matchesExpected) {
                    state = await store.update(current => ({
                        ...current,
                        inFlight: current.inFlight.filter(record => record.machineKey !== scenario.machineKey),
                    }));
                    state = await appendCompensationAuthorization({
                        fileSystem,
                        idFactory,
                        result: evaluation,
                        runPath,
                        scenarioId: pending.scenarioId,
                        stepId: pending.stepId,
                        store,
                    });
                    return pausedRunResult({fileSystem, runPath, state});
                }
                state = await store.update(current => ({
                    ...reopenCompensatedPath({
                        scenarioId: pending.scenarioId,
                        state: current,
                        stepId: pending.stepId,
                    }),
                    inFlight: current.inFlight.filter(record => record.machineKey !== scenario.machineKey),
                    status: 'running',
                }));
                await continueMachineScenarios({
                    configuration,
                    fileSystem,
                    guestAdapter,
                    idFactory,
                    machineLifecycleAdapter,
                    processAdapter,
                    runPath,
                    scenarioId: pending.scenarioId,
                    store,
                    workspaceBoundary,
                    workspaceDirectory: dirname(dirname(dirname(runPath))),
                });
                state = await store.read();
                if (state.handoffs.some((/** @type {{ state: string; }} */ handoff) => handoff.state === 'pending') && state.status !== 'paused') {
                    state = await store.update(current => ({...current, status: 'paused'}));
                }
                return pausedRunResult({fileSystem, runPath, state});
            }
            const store = createTransitionStore({fileSystem, runPath, state});
            const evaluation = await recaptureScenarioReadinessCompensation({
                configuration,
                fileSystem,
                guestAdapter,
                idFactory,
                machineLifecycleAdapter,
                runPath,
                scenario,
                store,
                workspaceDirectory: dirname(dirname(dirname(runPath))),
            });
            if (evaluation === null) return pausedRunResult({fileSystem, runPath, state: await store.read()});
            if (evaluation.matchesExpected) {
                state = await store.update(current => ({
                    ...reopenCompensatedPath({
                        scenarioId: pending.scenarioId,
                        state: current,
                        stepId: pending.stepId,
                    }),
                    status: 'running',
                }));
                await continueMachineScenarios({
                    configuration,
                    fileSystem,
                    guestAdapter,
                    idFactory,
                    machineLifecycleAdapter,
                    processAdapter,
                    runPath,
                    scenarioId: pending.scenarioId,
                    store,
                    workspaceBoundary,
                    workspaceDirectory: dirname(dirname(dirname(runPath))),
                });
                state = await store.read();
                const hasPending = state.handoffs.some((/** @type {{ state: string; }} */ handoff) => handoff.state === 'pending');
                state = await store.update(current => ({...current, status: hasPending ? 'paused' : current.status}));
                return pausedRunResult({fileSystem, runPath, state});
            }
            await store.update(current => ({
                ...current,
                inFlight: current.inFlight.filter(record => record.machineKey !== scenario.machineKey),
            }));
            state = await appendCompensationAuthorization({
                fileSystem,
                idFactory,
                result: evaluation,
                runPath,
                scenarioId: pending.scenarioId,
                stepId: pending.stepId,
                store,
            });
            return pausedRunResult({fileSystem, runPath, state});
        }
        if (pending.kind === 'semantic-judgment') {
            let captured;
            try {
                const factsBytes = await fileSystem.readFile(pending.resultPath, 'utf8');
                if (createHash('sha256').update(factsBytes).digest('hex') !== pending.factsDigest) {
                    throw new Error('Semantic facts digest mismatch.');
                }
                captured = JSON.parse(factsBytes);
                const scenario = state.plan.scenarios.find(item => item.archiveKind === pending.scenarioId);
                validateCapturedGuestStep({
                    captured,
                    machineKey: scenario?.machineKey,
                    scenarioId: pending.scenarioId,
                    stepId: pending.stepId,
                });
            } catch {
                throw releaseValidationOperationError('state-invalid', runPath);
            }
            if (!validateSemanticJudgmentResponse({captured, handoff: pending, plan: state.plan, response, runId: state.runId})) {
                throw releaseValidationOperationError('response-invalid', runPath);
            }
            if (response.judgment.matchesExpected) {
                const scenario = state.plan.scenarios.find(item => item.archiveKind === pending.scenarioId);
                if (!hasMachineScenario(scenario)) throw releaseValidationOperationError('state-invalid', runPath);
                const failedRecord = state.steps.find(record => record.scenarioId === pending.scenarioId
                    && record.stepId === pending.stepId
                    && record.classification === 'formal'
                    && record.outcome === 'failed');
                let evidencePath = failedRecord?.evidencePath ?? null;
                if (failedRecord === undefined) {
                    const machine = configuration.machines[scenario.machineKey];
                    const baseline = requireGuestProcessResult(await guestAdapter.run({
                        machine,
                        machineKey: scenario.machineKey,
                        remoteArguments: ['git', '-C', captured.auditedDirectory, 'add', '-A'],
                        workspaceDirectory: dirname(dirname(dirname(runPath))),
                    }), runPath);
                    if (baseline.exitCode !== 0) {
                        const step = scenario.steps.find(item => item.stepId === pending.stepId);
                        if (step === undefined) throw releaseValidationOperationError('state-invalid', runPath);
                        const store = createTransitionStore({fileSystem, runPath, state});
                        await recordBindableGuestCaptureFailure({
                            configuration,
                            consume: {
                                handoffId: pending.handoffId,
                                responsePath,
                                summary: response.judgment.summary,
                            },
                            error: new Error(`Guest Git baseline update failed: ${baseline.stderr.trim() || `exit ${baseline.exitCode}`}`),
                            fileSystem,
                            idFactory,
                            machineLifecycleAdapter,
                            runPath,
                            scenario,
                            step,
                            store,
                            workspaceDirectory: dirname(dirname(dirname(runPath))),
                        });
                        return pausedRunResult({fileSystem, runPath, state: await store.read()});
                    }
                    const finalDirectory = join(
                        dirname(runPath),
                        'archive-source',
                        ...pending.scenarioId.split('/'),
                        'steps',
                        pending.stepId,
                    );
                    evidencePath = join(finalDirectory, 'validation.json');
                    let createdFinalDirectory = false;
                    try {
                        await fileSystem.mkdir(dirname(finalDirectory), {recursive: true});
                        await fileSystem.mkdir(finalDirectory, {recursive: false});
                        createdFinalDirectory = true;
                        await writeReleaseEvidenceFiles({
                            fileSystem,
                            runPath,
                            writes: [{
                                bytes: canonicalJson({
                                    files: response.judgment.files,
                                    matchesExpected: true,
                                    summary: response.judgment.summary,
                                }),
                                path: evidencePath,
                            }],
                        });
                    } catch {
                        if (createdFinalDirectory) {
                            await fileSystem.rm(finalDirectory, {force: true, recursive: true}).catch(() => {});
                        }
                        throw releaseValidationOperationError('persistence-failed', runPath);
                    }
                }
                const store = createTransitionStore({fileSystem, runPath, state});
                state = await store.update(current => {
                    const consumed = {
                        ...current,
                        handoffs: current.handoffs.map(handoff => handoff.handoffId === pending.handoffId
                            ? {...handoff, responsePath, state: 'consumed', summary: response.judgment.summary}
                            : handoff),
                        steps: failedRecord === undefined
                            ? current.steps.map(record => record.scenarioId === pending.scenarioId && record.stepId === pending.stepId
                                ? {
                                    ...record,
                                    classification: 'formal',
                                    evidencePath,
                                    outcome: 'passed',
                                    reason: null,
                                    state: 'terminal',
                                }
                                : record)
                            : current.steps,
                        status: 'running',
                    };
                    return failedRecord === undefined
                        ? consumed
                        : reopenCompensatedPath({
                            scenarioId: pending.scenarioId,
                            state: consumed,
                            stepId: pending.stepId,
                        });
                });
                await continueMachineScenarios({
                    configuration,
                    fileSystem,
                    guestAdapter,
                    idFactory,
                    machineLifecycleAdapter,
                    processAdapter,
                    runPath,
                    scenarioId: pending.scenarioId,
                    store,
                    workspaceBoundary,
                    workspaceDirectory: dirname(dirname(dirname(runPath))),
                });
                state = await store.read();
                const hasPending = state.handoffs.some((/** @type {{ state: string; }} */ handoff) => handoff.state === 'pending');
                if (hasPending && state.status !== 'paused') state = await store.update(current => ({...current, status: 'paused'}));
                return pausedRunResult({fileSystem, runPath, state});
            }
            const store = createTransitionStore({fileSystem, runPath, state});
            state = await appendCompensationAuthorization({
                consume: {
                    handoffId: pending.handoffId,
                    responsePath,
                    summary: response.judgment.summary,
                },
                fileSystem,
                idFactory,
                result: response,
                runPath,
                scenarioId: pending.scenarioId,
                stepId: pending.stepId,
                store,
            });
            return pausedRunResult({fileSystem, runPath, state});
        }
        if (pending.kind !== 'semantic-action'
            || !validateSemanticActionResponse({handoff: pending, plan: state.plan, response, runId: state.runId})) {
            throw releaseValidationOperationError('response-invalid', runPath);
        }
        if (response.decision === 'declined'
            && (machineLifecycleAdapter === undefined || typeof machineLifecycleAdapter.run !== 'function')) {
            throw releaseValidationOperationError('adapter-result-invalid', runPath);
        }
        if (response.decision === 'completed') {
            const scenario = state.plan.scenarios.find(item => item.archiveKind === pending.scenarioId);
            if (!hasMachineScenario(scenario)) throw releaseValidationOperationError('state-invalid', runPath);
            const actionStep = scenario.steps.find(item => item.stepId === pending.stepId);
            if (actionStep === undefined) throw releaseValidationOperationError('state-invalid', runPath);
            state = await commitRunTransition({
                fileSystem,
                nextState: {
                    ...state,
                    handoffs: state.handoffs.map(handoff => handoff.handoffId === pending.handoffId
                        ? {
                            ...handoff,
                            decision: 'completed',
                            responsePath,
                            state: 'consumed',
                            summary: response.summary,
                        }
                        : handoff),
                    inFlight: [...state.inFlight, {
                        machineKey: scenario.machineKey,
                        operation: 'capture',
                        scenarioId: pending.scenarioId,
                        startedRevision: state.revision + 1,
                        stepId: pending.stepId,
                    }].sort((left, right) => inFlightOrder(left) - inFlightOrder(right)),
                    status: 'running',
                },
                runPath,
                state,
            });
            let captured;
            try {
                captured = await captureReleaseSemanticFacts({
                    captureSemanticFacts,
                    configuration,
                    fileSystem,
                    guestAdapter,
                    processAdapter,
                    runId: state.runId,
                    scenario,
                    stepId: pending.stepId,
                    workspaceBoundary,
                    workspaceDirectory: dirname(dirname(dirname(runPath))),
                });
            } catch (error) {
                const operationError = bindReleaseValidationOperationError(error, runPath);
                if (operationError !== null) throw operationError;
                const store = createTransitionStore({fileSystem, runPath, state});
                await recordBindableGuestCaptureFailure({
                    configuration,
                    error,
                    fileSystem,
                    idFactory,
                    machineLifecycleAdapter,
                    runPath,
                    scenario,
                    step: actionStep,
                    store,
                    workspaceDirectory: dirname(dirname(dirname(runPath))),
                });
                return pausedRunResult({fileSystem, runPath, state: await store.read()});
            }
            const store = createTransitionStore({fileSystem, runPath, state});
            state = await appendSemanticJudgmentHandoff({
                captured,
                fileSystem,
                idFactory,
                machineKey: scenario.machineKey,
                runPath,
                scenarioId: pending.scenarioId,
                stepId: pending.stepId,
                store,
            });
            return pausedRunResult({fileSystem, runPath, state});
        }
        const failedSteps = state.steps.map(step => step.scenarioId === pending.scenarioId && step.stepId === pending.stepId
            ? {
                ...step,
                classification: 'formal',
                outcome: 'failed',
                reason: {code: 'semantic-declined', message: response.summary, source: null},
                state: 'terminal',
            }
            : step);
        const nextState = {
            ...state,
            handoffs: state.handoffs.map(handoff => handoff.handoffId === pending.handoffId
                ? {
                    ...handoff,
                    decision: response.decision,
                    responsePath,
                    state: 'consumed',
                    summary: response.summary,
                }
                : handoff),
            steps: closeFailedDependencies({
                failedLocator: {plan: state.plan, scenarioId: pending.scenarioId, stepId: pending.stepId},
                steps: failedSteps,
            }),
        };
        state = await commitRunTransition({fileSystem, nextState, runPath, state});
        const store = createTransitionStore({fileSystem, runPath, state});
        await continueMachineScenarios({
            configuration,
            fileSystem,
            guestAdapter,
            idFactory,
            machineLifecycleAdapter,
            processAdapter,
            runPath,
            scenarioId: pending.scenarioId,
            store,
            workspaceBoundary,
            workspaceDirectory: dirname(dirname(dirname(runPath))),
        });
        state = await store.read();
        if (state.handoffs.some((/** @type {{ state: string; }} */ handoff) => handoff.state === 'pending') && state.status !== 'paused') {
            state = await store.update(current => ({...current, status: 'paused'}));
        }
        return pausedRunResult({fileSystem, runPath, state});
    }
    if (state.inFlight.some((/** @type {{ operation: string; }} */ record) => record.operation === 'capture')) {
        const store = createTransitionStore({fileSystem, runPath, state});
        for (const record of state.inFlight.filter((/** @type {{ operation: string; }} */ item) => item.operation === 'capture')) {
            if (record.scenarioId === null || record.stepId === null) throw releaseValidationOperationError('state-invalid', runPath);
            const recordStepId = record.stepId;
            const scenario = state.plan.scenarios.find(item => item.archiveKind === record.scenarioId);
            const step = scenario?.steps.find(item => item.stepId === recordStepId);
            if (!hasMachineScenario(scenario)) throw releaseValidationOperationError('state-invalid', runPath);
            if (recordStepId === 'scenario-ready') {
                const evaluation = await recaptureScenarioReadinessCompensation({
                    configuration,
                    fileSystem,
                    guestAdapter,
                    idFactory,
                    machineLifecycleAdapter,
                    runPath,
                    scenario,
                    store,
                    workspaceDirectory: dirname(dirname(dirname(runPath))),
                });
                if (evaluation === null) {
                    state = await store.read();
                    continue;
                }
                if (!evaluation.matchesExpected) {
                    state = await appendCompensationAuthorization({
                        fileSystem,
                        idFactory,
                        result: evaluation,
                        runPath,
                        scenarioId: scenario.archiveKind,
                        stepId: recordStepId,
                        store,
                    });
                    continue;
                }
                state = await store.update(current => ({
                    ...reopenCompensatedPath({scenarioId: scenario.archiveKind, state: current, stepId: recordStepId}),
                    status: 'running',
                }));
                await continueMachineScenarios({
                    configuration,
                    fileSystem,
                    guestAdapter,
                    idFactory,
                    machineLifecycleAdapter,
                    processAdapter,
                    runPath,
                    scenarioId: scenario.archiveKind,
                    store,
                    workspaceBoundary,
                    workspaceDirectory: dirname(dirname(dirname(runPath))),
                });
                continue;
            }
            if (step === undefined) throw releaseValidationOperationError('state-invalid', runPath);
            if (step.judgment === 'semantic') {
                let captured;
                try {
                    captured = await captureReleaseSemanticFacts({
                        captureSemanticFacts,
                        configuration,
                        fileSystem,
                        guestAdapter,
                        processAdapter,
                        runId: state.runId,
                        scenario,
                        stepId: recordStepId,
                        workspaceBoundary,
                        workspaceDirectory: dirname(dirname(dirname(runPath))),
                    });
                } catch (error) {
                    const operationError = bindReleaseValidationOperationError(error, runPath);
                    if (operationError !== null) throw operationError;
                    await recordBindableGuestCaptureFailure({
                        configuration,
                        error,
                        fileSystem,
                        idFactory,
                        machineLifecycleAdapter,
                        runPath,
                        scenario,
                        step,
                        store,
                        workspaceDirectory: dirname(dirname(dirname(runPath))),
                    });
                    state = await store.read();
                    continue;
                }
                state = await appendSemanticJudgmentHandoff({
                    captured,
                    fileSystem,
                    idFactory,
                    machineKey: scenario.machineKey,
                    runPath,
                    scenarioId: scenario.archiveKind,
                    stepId: recordStepId,
                    store,
                });
                continue;
            }
            let mechanicalInput;
            try {
                if (typeof captureMechanicalFacts === 'function') {
                    mechanicalInput = await captureMechanicalFacts({
                        machine: configuration.machines[scenario.machineKey],
                        machineKey: scenario.machineKey,
                        scenarioId: scenario.archiveKind,
                        stepId: recordStepId,
                        workspaceDirectory: dirname(dirname(dirname(runPath))),
                    });
                } else {
                    const captureId = idFactory();
                    if (!UUID_PATTERN.test(captureId)) throw releaseValidationOperationError('state-invalid', runPath);
                    mechanicalInput = await captureReleaseVmMechanicalObservation({
                        captureId,
                        configuration,
                        fileSystem,
                        guestAdapter,
                        machineKey: scenario.machineKey,
                        processAdapter,
                        runId: state.runId,
                        scenarioId: scenario.archiveKind,
                        stepId: recordStepId,
                        workspaceBoundary,
                        workspaceDirectory: dirname(dirname(dirname(runPath))),
                    });
                }
                if (!exactKeys(mechanicalInput, ['capturedFacts', 'currentObservation', 'operationActual'])
                    || mechanicalInput.operationActual !== null) {
                    throw adapterResultInvalidError('Mechanical compensation facts are invalid.');
                }
            } catch (error) {
                const operationError = bindReleaseValidationOperationError(error, runPath);
                if (operationError !== null) throw operationError;
                await recordBindableGuestCaptureFailure({
                    configuration,
                    error,
                    fileSystem,
                    idFactory,
                    machineLifecycleAdapter,
                    runPath,
                    scenario,
                    step,
                    store,
                    workspaceDirectory: dirname(dirname(dirname(runPath))),
                });
                state = await store.read();
                continue;
            }
            let evaluation;
            try {
                evaluation = evaluateReleaseMechanicalContract({
                    ...mechanicalInput,
                    evaluation: 'observable-state',
                    mechanicalContract: step.mechanicalContract,
                    mechanicalParameters: step.mechanicalParameters,
                });
            } catch (error) {
                const operationError = bindReleaseValidationOperationError(error, runPath);
                if (operationError !== null) throw operationError;
                throw releaseValidationOperationError('adapter-result-invalid', runPath);
            }
            if (!evaluation.matchesExpected) {
                state = await store.update(current => ({
                    ...current,
                    inFlight: current.inFlight.filter(item => item.machineKey !== scenario.machineKey),
                }));
                state = await appendCompensationAuthorization({
                    fileSystem,
                    idFactory,
                    result: evaluation,
                    runPath,
                    scenarioId: scenario.archiveKind,
                    stepId: recordStepId,
                    store,
                });
                continue;
            }
            state = await store.update(current => ({
                ...reopenCompensatedPath({scenarioId: scenario.archiveKind, state: current, stepId: recordStepId}),
                inFlight: current.inFlight.filter(item => item.machineKey !== scenario.machineKey),
                status: 'running',
            }));
            await continueMachineScenarios({
                configuration,
                fileSystem,
                guestAdapter,
                idFactory,
                machineLifecycleAdapter,
                processAdapter,
                runPath,
                scenarioId: scenario.archiveKind,
                store,
                workspaceBoundary,
                workspaceDirectory: dirname(dirname(dirname(runPath))),
            });
        }
        return pausedRunResult({fileSystem, runPath, state: await store.read()});
    }
    if (pendingHandoffs.length > 0) throw releaseValidationOperationError('response-invalid', runPath);
    if (responsePath === null && state.status !== 'completed') {
        let retryScenario = null;
        for (const scenario of state.plan.scenarios) {
            if (!state.steps.some(step => step.scenarioId === scenario.archiveKind && step.state === 'pending')) continue;
            const readinessPaths = [
                join(dirname(runPath), 'scenario-facts', ...scenario.archiveKind.split('/'), 'scenario-ready.json'),
                join(dirname(runPath), 'scenario-ready', ...scenario.archiveKind.split('/'), 'scenario-ready.json'),
            ];
            let prepared = true;
            for (const path of readinessPaths) {
                try {
                    const stats = await fileSystem.lstat(path);
                    if (!stats.isFile() || stats.isSymbolicLink()) prepared = false;
                } catch (error) {
                    if (errorCode(error) !== 'ENOENT') throw releaseValidationOperationError('state-invalid', runPath);
                    prepared = false;
                }
            }
            if (prepared) {
                retryScenario = scenario;
                break;
            }
        }
        if (retryScenario !== null) {
            const store = createTransitionStore({fileSystem, runPath, state});
            await continueMachineScenarios({
                configuration,
                fileSystem,
                guestAdapter,
                idFactory,
                machineLifecycleAdapter,
                processAdapter,
                runPath,
                scenarioId: retryScenario.archiveKind,
                store,
                workspaceBoundary,
                workspaceDirectory: dirname(dirname(dirname(runPath))),
            });
            state = await store.read();
            if (state.handoffs.some((/** @type {{ state: string; }} */ handoff) => handoff.state === 'pending') && state.status !== 'paused') {
                state = await store.update(current => ({...current, status: 'paused'}));
            }
            return pausedRunResult({fileSystem, runPath, state});
        }
    }
    if (state.archives.some((/** @type {{ status: string; }} */ record) => record.status === 'pending')) {
        state = await reconcilePendingArchives({fileSystem, runPath, state});
    }
    return pausedRunResult({fileSystem, runPath, state});
};

const collectStream = (/** @type {import("stream").Readable} */ stream) => new Promise((/** @type {(value: string) => void} */ resolvePromise, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    stream.on('data', (/** @type {Uint8Array} */ chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
});

/**
 * 建立 release host process Adapter, 以 exact executable, arguments 和 cwd 启动一个 hidden child process.
 * Result 忠实保留 numeric exit, stdout 和 stderr; process start 或 stream failure 直接 reject.
 */
export const createReleaseHostProcessAdapter = () => ({
    run: (/** @type {ProcessRequest} */ {arguments: args, cwd, executable, input = undefined, timeoutMs = undefined}) => new Promise((/** @type {(value: ProcessObservation) => void} */ resolvePromise, reject) => {
        const child = spawn(executable, args, {cwd, windowsHide: true});
        const stdout = collectStream(child.stdout);
        const stderr = collectStream(child.stderr);
        let timedOut = false;
        const timeout = timeoutMs === undefined ? undefined : setTimeout(() => {
            timedOut = true;
            child.kill();
        }, timeoutMs);
        child.once('error', error => {
            if (timeout !== undefined) clearTimeout(timeout);
            reject(error);
        });
        child.once('close', async exitCode => {
            if (timeout !== undefined) clearTimeout(timeout);
            if (timedOut) {
                const error = Object.assign(new Error('The release host process timed out.'), {code: 'ETIMEDOUT'});
                reject(error);
                return;
            }
            resolvePromise({
                exitCode: exitCode ?? 1,
                stderr: await stderr,
                stdout: await stdout,
            });
        });
        child.stdin.once('error', reject);
        child.stdin.end(input);
    }),
});

const runChecked = async (/** @type {HostProcessAdapter} */ processAdapter, /** @type {ProcessRequest} */ request, /** @type {string} */ label) => {
    const result = await processAdapter.run(request);
    if (result.exitCode !== 0) {
        throw new Error(`${label} failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
    }
    return result;
};

const prepareOneBundle = async (/** @type {{commit: string, includePriorRelease?: boolean, outputPath: string, remote: string, timeoutMs: number, workspaceDirectory: string}} */ {commit, includePriorRelease = false, outputPath, remote, timeoutMs, workspaceDirectory}, /** @type {HostProcessAdapter} */ processAdapter) => {
    const repositoryDirectory = join(workspaceDirectory, '.bundle-input', outputPath.slice(0, -7));
    await defaultFileSystem.mkdir(repositoryDirectory, {recursive: true});
    await runChecked(processAdapter, {
        arguments: ['init', '--bare', repositoryDirectory],
        cwd: workspaceDirectory,
        executable: 'git',
        timeoutMs,
    }, `Initialize ${outputPath} input`);
    await runChecked(processAdapter, {
        arguments: ['fetch', '--no-tags', remote, `${commit}:refs/heads/arw-validation`],
        cwd: repositoryDirectory,
        executable: 'git',
        timeoutMs,
    }, `Fetch ${outputPath} commit`);
    const resolved = (await runChecked(processAdapter, {
        arguments: ['rev-parse', '--verify', 'refs/heads/arw-validation^{commit}'],
        cwd: repositoryDirectory,
        executable: 'git',
        timeoutMs,
    }, `Resolve ${outputPath} commit`)).stdout.trim();
    if (resolved !== commit) throw new Error(`${outputPath} fetched commit does not match the requested commit.`);
    let priorRelease = null;
    if (includePriorRelease) {
        await runChecked(processAdapter, {
            arguments: ['fetch', remote, 'refs/tags/*:refs/tags/*'],
            cwd: repositoryDirectory,
            executable: 'git',
            timeoutMs,
        }, `Fetch ${outputPath} Release tags`);
        const candidatePackage = JSON.parse((await runChecked(processAdapter, {
            arguments: ['show', 'refs/heads/arw-validation:package.json'],
            cwd: repositoryDirectory,
            executable: 'git',
            timeoutMs,
        }, `Read ${outputPath} candidate version`)).stdout);
        const candidateVersion = typeof candidatePackage.version === 'string' && isStableReleaseTag(candidatePackage.version)
            ? candidatePackage.version
            : null;
        const priorTags = (await runChecked(processAdapter, {
            arguments: ['tag', '--merged', 'refs/heads/arw-validation', '--list'],
            cwd: repositoryDirectory,
            executable: 'git',
            timeoutMs,
        }, `List ${outputPath} reachable Release tags`)).stdout.split('\n').filter(tag => isStableReleaseTag(tag)
            && candidateVersion !== null && compareStableArwVersions(tag, candidateVersion) < 0).sort(compareStableArwVersions);
        const tag = priorTags.at(-1);
        if (candidateVersion === null || tag === undefined) throw new Error('Candidate history has no prior stable Release tag.');
        const priorCommit = (await runChecked(processAdapter, {
            arguments: ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`],
            cwd: repositoryDirectory,
            executable: 'git',
            timeoutMs,
        }, `Resolve ${outputPath} prior Release`)).stdout.trim();
        if (!OBJECT_ID_PATTERN.test(priorCommit)) throw new Error('Prior Release tag does not resolve to a full Git commit ID.');
        const priorPackage = JSON.parse((await runChecked(processAdapter, {
            arguments: ['show', `refs/tags/${tag}:package.json`],
            cwd: repositoryDirectory,
            executable: 'git',
            timeoutMs,
        }, `Read ${outputPath} prior Release version`)).stdout);
        if (priorPackage.version !== tag) throw new Error('Prior Release tag and package version do not match.');
        priorRelease = Object.freeze({commit: priorCommit, tag});
    }
    await runChecked(processAdapter, {
        arguments: ['symbolic-ref', 'HEAD', 'refs/heads/arw-validation'],
        cwd: repositoryDirectory,
        executable: 'git',
        timeoutMs,
    }, `Select ${outputPath} default branch`);
    const bundlePath = join(workspaceDirectory, outputPath);
    await runChecked(processAdapter, {
        arguments: ['bundle', 'create', bundlePath, 'refs/heads/arw-validation', ...(priorRelease === null ? [] : [`refs/tags/${priorRelease.tag}`])],
        cwd: repositoryDirectory,
        executable: 'git',
        timeoutMs,
    }, `Create ${outputPath}`);
    return {path: bundlePath, priorRelease};
};

/**
 * 从准确候选和仓库外源码目录准备完整 bundle 集合, 只写入本次新准备工作区.
 */
export const prepareReleaseValidationBundles = async (
    /** @type {{candidateCommit: string, releaseConfiguration?: unknown, sourcesConfigurationPath: string, workspaceDirectory: string}} */ {candidateCommit, releaseConfiguration, sourcesConfigurationPath, workspaceDirectory},
    /** @type {HostProcessAdapter} */
    processAdapter = createReleaseHostProcessAdapter(),
    /** @type {WorkspaceBoundary | undefined} */
    workspaceBoundary,
) => {
    if (!OBJECT_ID_PATTERN.test(candidateCommit)) throw new Error('Release candidate commit must be a full Git object ID.');
    requireWorkspaceBoundary(workspaceBoundary)(workspaceDirectory, 'Release validation workspace');
    const currentReleaseConfiguration = await resolveRootReleaseConfiguration({releaseConfiguration});
    const sources = await loadReleaseValidationSources(sourcesConfigurationPath);
    await defaultFileSystem.mkdir(workspaceDirectory, {recursive: true});
    // 排他占用准备目录, 防止后续准备覆盖活动运行的输入.
    await defaultFileSystem.mkdir(join(workspaceDirectory, '.bundle-input'));
    const timeoutMs = currentReleaseConfiguration.prepareBundles.hostCommandTimeoutMs;
    const plain = await prepareValidationSnapshotBundle({directory: sources.plain.directory, key: 'plain', timeoutMs, workspaceDirectory}, processAdapter);
    const agentAssisted = await prepareValidationSnapshotBundle({directory: sources.agentAssisted.directory, key: 'agentAssisted', timeoutMs, workspaceDirectory}, processAdapter);
    const candidate = await prepareOneBundle({
        commit: candidateCommit,
        includePriorRelease: true,
        outputPath: 'candidate.bundle',
        remote: currentReleaseConfiguration.repositories.sourceCheckout.url,
        timeoutMs,
        workspaceDirectory,
    }, processAdapter);
    if (candidate.priorRelease === null) throw new Error('Candidate bundle prior Release identity is unavailable.');
    const result = {
        bundles: {agentAssisted: agentAssisted.path, candidate: candidate.path, plain: plain.path},
        candidateCommit,
        priorRelease: candidate.priorRelease,
        status: 'prepared',
        targetCommits: {agentAssisted: agentAssisted.commit, plain: plain.commit},
    };
    await defaultFileSystem.writeFile(join(workspaceDirectory, 'bundles.json'), `${JSON.stringify(result)}\n`, {flag: 'wx'});
    return result;
};

/** @param {unknown} value @returns {value is {agentAssisted: string, plain: string}} */
const validTargetCommits = value => exactKeys(value, ['agentAssisted', 'plain'])
    && typeof value.agentAssisted === 'string' && OBJECT_ID_PATTERN.test(value.agentAssisted)
    && typeof value.plain === 'string' && OBJECT_ID_PATTERN.test(value.plain);

const parsePreparedBundleRecord = (/** @type {unknown} */ record, /** @type {string} */ workspaceDirectory) => {
    if (!exactKeys(record, ['bundles', 'candidateCommit', 'priorRelease', 'status', 'targetCommits'])
        || record.status !== 'prepared'
        || typeof record.candidateCommit !== 'string' || !OBJECT_ID_PATTERN.test(record.candidateCommit)
        || !exactKeys(record.priorRelease, ['commit', 'tag'])
        || typeof record.priorRelease.commit !== 'string' || !OBJECT_ID_PATTERN.test(record.priorRelease.commit)
        || typeof record.priorRelease.tag !== 'string' || !isStableReleaseTag(record.priorRelease.tag)
        || !validTargetCommits(record.targetCommits)
        || !isStringRecord(record.bundles)
        || !exactKeys(record.bundles, ['agentAssisted', 'candidate', 'plain'])) {
        throw new Error('Release validation bundle record is invalid.');
    }
    for (const key of ['agentAssisted', 'candidate', 'plain']) {
        if (record.bundles[key] !== join(workspaceDirectory, `${key}.bundle`)) throw new Error('Release validation bundle record contains an unexpected path.');
    }
    return {bundles: record.bundles, candidateCommit: record.candidateCommit, priorRelease: {commit: record.priorRelease.commit, tag: record.priorRelease.tag}, targetCommits: record.targetCommits};
};

/**
 * 验证 3 个 current-session bundle ordinary files 只提供准确登记的 commits.
 * Success 返回与本次准备记录一致的闭合事实, 不从文件名或调用方标签推断提交.
 */
export const inspectReleaseValidationBundles = async (/** @type {{agentAssistedBundlePath: string, candidateBundlePath: string, candidateCommit: string, plainBundlePath: string}} */ {
    agentAssistedBundlePath,
    candidateBundlePath,
    candidateCommit,
    plainBundlePath,
}, /** @type {{fileSystem?: FileSystem, loadReleaseConfiguration?: () => Promise<unknown>, processAdapter?: HostProcessAdapter, releaseConfiguration?: unknown, workspaceBoundary?: WorkspaceBoundary}} */ {
    fileSystem = defaultFileSystem,
    loadReleaseConfiguration = loadReleaseValidationConfiguration,
    processAdapter = createReleaseHostProcessAdapter(),
    releaseConfiguration,
    workspaceBoundary,
} = {}) => {
    if (!OBJECT_ID_PATTERN.test(candidateCommit)) throw new Error('Release candidate commit must be a full Git object ID.');
    const validateWorkspacePath = requireWorkspaceBoundary(workspaceBoundary);
    await resolveRootReleaseConfiguration({loadReleaseConfiguration, releaseConfiguration});
    const workspaceDirectory = dirname(candidateBundlePath);
    validateWorkspacePath(workspaceDirectory, 'Release validation bundle workspace');
    const prepared = parsePreparedBundleRecord(JSON.parse(await fileSystem.readFile(join(workspaceDirectory, 'bundles.json'), 'utf8')), workspaceDirectory);
    if (prepared.candidateCommit !== candidateCommit
        || prepared.bundles.agentAssisted !== agentAssistedBundlePath
        || prepared.bundles.plain !== plainBundlePath) throw new Error('Release validation bundle record does not match the requested inputs.');
    const entries = [
        {
            commit: prepared.targetCommits.agentAssisted,
            key: 'agentAssisted',
            kind: 'agent-assisted',
            path: agentAssistedBundlePath,
        },
        {commit: candidateCommit, key: 'candidate', kind: 'candidate', path: candidateBundlePath},
        {
            commit: prepared.targetCommits.plain,
            key: 'plain',
            kind: 'plain',
            path: plainBundlePath,
        },
    ];
    /** @type {Record<string, Readonly<{commit: string, kind: string, priorRelease?: Readonly<{commit: string, tag: string}>}>>} */
    const facts = {};
    for (const entry of entries) {
        validateWorkspacePath(entry.path, `Release validation ${entry.key} bundle`);
        await assertOrdinaryHostFile(entry.path, `Release validation ${entry.key} bundle`, fileSystem);
        await runChecked(processAdapter, {
            arguments: ['bundle', 'verify', entry.path],
            cwd: dirname(entry.path),
            executable: 'git',
        }, `Verify ${entry.key} bundle`);
        const identity = (await runChecked(processAdapter, {
            arguments: ['bundle', 'list-heads', entry.path, ...(entry.key === 'candidate' ? [] : ['refs/heads/arw-validation'])],
            cwd: dirname(entry.path),
            executable: 'git',
        }, `Resolve ${entry.key} bundle identity`)).stdout.trim();
        const identities = identity.split('\n').filter(Boolean);
        const branchIdentity = `${entry.commit} refs/heads/arw-validation`;
        const priorTagIdentity = entry.key === 'candidate'
            ? identities.find(line => {
                const match = /^\S+ refs\/tags\/(\S+)$/u.exec(line);
                return match !== null && isStableReleaseTag(match[1]);
            })
            : undefined;
        if (entry.key === 'candidate'
            ? identities.length !== 2 || !identities.includes(branchIdentity) || priorTagIdentity === undefined
            : identity !== branchIdentity) {
            throw new Error(`Release validation ${entry.key} bundle does not identify the expected commit.`);
        }
        let priorRelease = null;
        if (priorTagIdentity !== undefined) {
            const tag = priorTagIdentity.slice(priorTagIdentity.lastIndexOf('/') + 1);
            const temporaryRoot = join(dirname(entry.path), `.arw-b-${randomUUID().slice(0, 8)}`);
            const repositoryDirectory = join(temporaryRoot, 'repository.git');
            validateWorkspacePath(temporaryRoot, 'Release validation bundle inspection workspace');
            await mkdir(temporaryRoot);
            try {
                await runChecked(processAdapter, {
                    arguments: ['clone', '--quiet', '--mirror', entry.path, repositoryDirectory],
                    cwd: temporaryRoot,
                    executable: 'git',
                }, 'Open candidate bundle for identity inspection');
                const repositoryArguments = (/** @type {string[]} */ arguments_) => [
                    '-c', `safe.directory=${repositoryDirectory}`,
                    ...arguments_,
                ];
                const branchCommit = (await runChecked(processAdapter, {
                    arguments: repositoryArguments(['rev-parse', '--verify', 'refs/heads/arw-validation^{commit}']),
                    cwd: repositoryDirectory,
                    executable: 'git',
                }, 'Resolve candidate bundle branch commit')).stdout.trim();
                const tagCommit = (await runChecked(processAdapter, {
                    arguments: repositoryArguments(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]),
                    cwd: repositoryDirectory,
                    executable: 'git',
                }, 'Resolve candidate bundle prior Release commit')).stdout.trim();
                if (branchCommit !== entry.commit || !OBJECT_ID_PATTERN.test(tagCommit)) {
                    throw new Error('Release validation candidate bundle does not identify the expected commit.');
                }
                await runChecked(processAdapter, {
                    arguments: repositoryArguments(['merge-base', '--is-ancestor', tagCommit, branchCommit]),
                    cwd: repositoryDirectory,
                    executable: 'git',
                }, 'Verify candidate bundle prior Release reachability');
                const candidatePackage = JSON.parse((await runChecked(processAdapter, {
                    arguments: repositoryArguments(['show', 'refs/heads/arw-validation:package.json']),
                    cwd: repositoryDirectory,
                    executable: 'git',
                }, 'Read candidate bundle version')).stdout);
                const priorPackage = JSON.parse((await runChecked(processAdapter, {
                    arguments: repositoryArguments(['show', `refs/tags/${tag}:package.json`]),
                    cwd: repositoryDirectory,
                    executable: 'git',
                }, 'Read candidate bundle prior Release version')).stdout);
                if (typeof candidatePackage.version !== 'string'
                    || !isStableReleaseTag(candidatePackage.version)
                    || priorPackage.version !== tag
                    || compareStableArwVersions(tag, candidatePackage.version) >= 0) {
                    throw new Error('Candidate bundle prior Release tag and package version do not match.');
                }
                priorRelease = {commit: tagCommit, tag};
            } finally {
                await rm(temporaryRoot, {force: true, recursive: true});
            }
        }
        facts[entry.key] = Object.freeze({commit: entry.commit, kind: entry.kind, ...(priorRelease === null ? {} : {priorRelease: Object.freeze(priorRelease)})});
    }
    const inspectedPrior = facts.candidate.priorRelease;
    if (inspectedPrior === undefined || inspectedPrior.commit !== prepared.priorRelease.commit || inspectedPrior.tag !== prepared.priorRelease.tag) {
        throw new Error('Release validation bundle record prior Release identity does not match the candidate bundle.');
    }
    return Object.freeze({
        agentAssisted: facts.agentAssisted,
        candidate: facts.candidate,
        plain: facts.plain,
        status: 'inspected',
    });
};

/**
 * 在已配置 guest 中执行所选 absolute Node.js executable 的 `--version`.
 * Success 返回规范 `vMAJOR.MINOR.PATCH`; 未配置 runtime, nonzero exit 或 malformed output 都关闭式失败.
 */
const validateGuestNodeRoleVersion = (/** @type {{machineKey: string, runtime: string, version: string}} */ {machineKey, runtime, version}) => {
    const expectedMajor = runtime === 'minimum'
        ? RELEASE_NODE_RUNTIME_MAJORS.minimum
        : runtime === 'recommended'
            ? RELEASE_NODE_RUNTIME_MAJORS.recommended
            : undefined;
    if (expectedMajor === undefined) throw new Error('Release guest Node.js runtime role is invalid.');
    const observedMajor = Number(version.slice(1, version.indexOf('.')));
    if (observedMajor !== expectedMajor) {
        throw new Error(`${machineKey} ${runtime} Node.js runtime requires major ${expectedMajor}. Observed version: ${version}.`);
    }
    return version;
};

export const validateGuestNodeVersion = async (/** @type {{machine: VmMachine, machineKey: string, processAdapter: GuestAdapter, runtime?: string, workspaceDirectory: string}} */ {machine, machineKey, processAdapter, runtime = 'recommended', workspaceDirectory}) => {
    const executable = machine.nodeExecutables[runtime];
    if (executable === undefined) throw new Error(`${machineKey} does not configure the requested Node.js runtime.`);
    const result = requireGuestProcessResult(await processAdapter.run({
        machine,
        machineKey,
        remoteArguments: [executable, '--version'],
        workspaceDirectory,
    }));
    if (result.exitCode !== 0 || !NODE_VERSION_PATTERN.test(result.stdout.trim())) {
        throw new Error(`${machineKey} Node.js executable could not be verified.`);
    }
    return validateGuestNodeRoleVersion({machineKey, runtime, version: result.stdout.trim()});
};

const sshHostKeyParts = (/** @type {string} */ value) => {
    const parts = value.trim().split(/\s+/);
    if (parts.length < 2 || !/^(?:ssh-|ecdsa-)/.test(parts[0])) {
        throw new Error('Release VM SSH host key is invalid.');
    }
    return parts.slice(0, 2);
};

const sshTarget = (/** @type {{address: string, machine: VmMachine}} */ {address, machine}) => `${machine.ssh.user}@${address}`;
const hostKeyAlias = (/** @type {string} */ machineKey) => `arw-release-${machineKey.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`;
const quotePosix = (/** @type {string} */ value) => `'${value.replaceAll("'", `'"'"'`)}'`;
const quotePowerShell = (/** @type {string} */ value) => `'${value.replaceAll("'", "''")}'`;
const WINDOWS_REMOTE_RUNNER = "const{spawnSync}=require('node:child_process');const a=JSON.parse(Buffer.from(process.argv[1],'base64'));const r=spawnSync(a[0],a.slice(1),{stdio:'inherit',windowsHide:true});if(r.error){process.stderr.write(String(r.error.message)+'\\n');process.exit(1)}process.exit(r.status??1)";
const remoteCommand = (/** @type {string} */ machineKey, /** @type {string[]} */ remoteArguments, /** @type {string} */ nodeExecutable) => {
    if (machineKey !== 'Windows 11') return remoteArguments.map(quotePosix).join(' ');
    const argumentPayload = Buffer.from(JSON.stringify(remoteArguments)).toString('base64');
    const invocation = [nodeExecutable, '-e', WINDOWS_REMOTE_RUNNER, argumentPayload];
    return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(
        `& ${invocation.map(quotePowerShell).join(' ')}`,
        'utf16le',
    ).toString('base64')}`;
};
const guestScpPath = (/** @type {string} */ machineKey, /** @type {string} */ path) => machineKey === 'Windows 11' ? path.replaceAll('\\', '/') : path;

const vmrunArguments = (/** @type {VmMachine} */ machine, /** @type {string[]} */ ...operationArguments) => [
    '-T',
    'ws',
    ...(machine.vmwareEncryptionPassword === undefined ? [] : ['-vp', machine.vmwareEncryptionPassword]),
    ...operationArguments,
];

/** @returns {MachineFailure} */
const machineFailure = (/** @type {string} */ code, /** @type {string} */ message, /** @type {string} */ operation) => ({code, message, operation, status: 'failed'});

/** @returns {Promise<VmwareProcessExecution>} */
const runVmwareLifecycleProcess = async (/** @type {{machine: VmMachine, operation: string, processAdapter: HostProcessAdapter, vmrunOperation: string[]}} */ {machine, operation, processAdapter, vmrunOperation}) => {
    let result;
    try {
        result = await processAdapter.run({
            arguments: vmrunArguments(machine, ...vmrunOperation),
            cwd: dirname(machine.location),
            executable: machine.vmrun,
        });
    } catch {
        return {failure: machineFailure('process-failed', 'The VMware lifecycle process could not be started.', operation)};
    }
    if (!exactKeys(result, ['exitCode', 'stderr', 'stdout'])
        || !Number.isSafeInteger(result.exitCode)
        || typeof result.stderr !== 'string'
        || typeof result.stdout !== 'string') {
        return {failure: machineFailure('observation-failed', 'The VMware lifecycle process returned an invalid result.', operation)};
    }
    if (result.exitCode !== 0) {
        return {
            failure: machineFailure('process-failed', 'The VMware lifecycle process did not complete successfully.', operation),
            result,
        };
    }
    return {result};
};

const runVmwareSoftStopProcess = async (/** @type {{machine: VmMachine, machineKey: string, operation: string, processAdapter: HostProcessAdapter, releaseConfiguration: ReleaseConfiguration}} */ {
    machine,
    machineKey,
    operation,
    processAdapter,
    releaseConfiguration,
}) => {
    const timeoutMs = releaseConfiguration.vmware.softPowerOffTimeoutMs[machineKey];
    if (timeoutMs === undefined) {
        return {failure: machineFailure('observation-failed', 'The VMware soft power-off machine identity is unsupported.', operation)};
    }
    let result;
    try {
        result = await processAdapter.run({
            arguments: vmrunArguments(machine, 'stop', machine.location, 'soft'),
            cwd: dirname(machine.location),
            executable: machine.vmrun,
            timeoutMs,
        });
    } catch (error) {
        if (errorCode(error) === 'ETIMEDOUT') return {timedOut: true};
        return {failure: machineFailure('process-failed', 'The VMware lifecycle process could not be started.', operation)};
    }
    if (!exactKeys(result, ['exitCode', 'stderr', 'stdout'])
        || !Number.isSafeInteger(result.exitCode)
        || typeof result.stderr !== 'string'
        || typeof result.stdout !== 'string') {
        return {failure: machineFailure('observation-failed', 'The VMware lifecycle process returned an invalid result.', operation)};
    }
    if (result.exitCode !== 0) {
        return {failure: machineFailure('process-failed', 'The VMware lifecycle process did not complete successfully.', operation)};
    }
    return {result, timedOut: false};
};

export const matchesReleaseSoftPowerOffExpectation = (/** @type {{machineKey: string, observation: unknown, requirement: string}} */ {machineKey, observation, requirement}) => {
    if (!RELEASE_MACHINE_KEYS.includes(machineKey)
        || !['powered-off', 'soft-shutdown'].includes(requirement)
        || observation === null
        || Array.isArray(observation)
        || typeof observation !== 'object'
        || !exactKeys(observation, ['powerOffMode', 'powerState'])
        || observation.powerState !== 'powered-off'
        || typeof observation.powerOffMode !== 'string'
        || !['already-powered-off', 'hard-after-timeout', 'soft'].includes(observation.powerOffMode)) {
        throw new Error('Release soft power-off expectation input is invalid.');
    }
    if (requirement === 'powered-off') return true;
    return observation.powerOffMode === 'soft'
        || machineKey === 'Alpine' && observation.powerOffMode === 'hard-after-timeout';
};

/** @returns {Promise<{failure: MachineFailure | undefined, running: string[]}>} */
const readVmwareRunningMachines = async (/** @type {{machine: VmMachine, operation: string, processAdapter: HostProcessAdapter}} */ {machine, operation, processAdapter}) => {
    const executed = await runVmwareLifecycleProcess({machine, operation, processAdapter, vmrunOperation: ['list']});
    if (executed.failure !== undefined) return {failure: executed.failure, running: []};
    const lines = executed.result.stdout.replaceAll('\r\n', '\n').trimEnd().split('\n');
    const match = /^Total running VMs: ([0-9]+)$/.exec(lines[0]);
    if (match === null || Number(match[1]) !== lines.length - 1 || lines.slice(1).some((/** @type {string} */ path) => !isAbsolute(path))) {
        return {failure: machineFailure('observation-failed', 'The VMware running-machine observation is invalid.', operation), running: []};
    }
    return {failure: undefined, running: lines.slice(1)};
};

const usesConfiguredVmwareBuild = async (/** @type {{machine: VmMachine, processAdapter: HostProcessAdapter, releaseConfiguration: ReleaseConfiguration}} */ {machine, processAdapter, releaseConfiguration}) => {
    let result;
    try {
        result = await processAdapter.run({
            arguments: [],
            cwd: dirname(machine.location),
            executable: machine.vmrun,
        });
    } catch {
        return false;
    }
    if (!exactKeys(result, ['exitCode', 'stderr', 'stdout'])
        || !Number.isSafeInteger(result.exitCode)
        || typeof result.stderr !== 'string'
        || typeof result.stdout !== 'string') return false;
    return `${result.stdout}\n${result.stderr}`
        .replaceAll('\r\n', '\n')
        .split('\n')
        .some(line => line.trim() === releaseConfiguration.vmware.hardPowerOffCompatibility.vmrunVersion);
};

const matchesConfiguredSuspendedStopFailure = (/** @type {{machine: VmMachine, releaseConfiguration: ReleaseConfiguration, result: ProcessObservation}} */ {machine, releaseConfiguration, result}) => {
    const compatibility = releaseConfiguration.vmware.hardPowerOffCompatibility;
    return result.exitCode === compatibility.exitCode
        && result.stderr === compatibility.stderr
        && result.stdout.replaceAll('\r\n', '\n') === renderVmwareCompatibilityStdout({
            configuration: releaseConfiguration,
            machineLocation: machine.location,
        });
};

/** @returns {Promise<{failure: MachineFailure | undefined, powerState: string | undefined}>} */
const observeVmwarePowerState = async (/** @type {{fileSystem: FileSystem, machine: VmMachine, operation: string, processAdapter: HostProcessAdapter}} */ {fileSystem, machine, operation, processAdapter}) => {
    const listed = await readVmwareRunningMachines({machine, operation, processAdapter});
    if (listed.failure !== undefined || listed.running.includes(machine.location)) {
        return listed.failure === undefined
            ? {failure: undefined, powerState: 'running'}
            : {failure: listed.failure, powerState: undefined};
    }
    try {
        const vmx = (await fileSystem.readFile(machine.location)).toString('utf8');
        const vmState = /^checkpoint\.vmState\s*=\s*"([^"]*)"\s*$/mi.exec(vmx)?.[1] ?? '';
        if (vmState === '') return {failure: undefined, powerState: 'powered-off'};
        const root = dirname(machine.location);
        const statePath = resolveRelativePathWithinScope({path: vmState, scope: root});
        if (statePath.status !== 'succeeded') throw new Error('VMware suspended-state path is unsafe.');
        const stats = await fileSystem.lstat(statePath.absolutePath);
        return {failure: undefined, powerState: stats.isFile() && !stats.isSymbolicLink() ? 'suspended' : 'powered-off'};
    } catch (error) {
        if (errorCode(error) === 'ENOENT') return {failure: undefined, powerState: 'powered-off'};
        return {failure: machineFailure('observation-failed', 'The VMware power-state observation is invalid.', operation), powerState: undefined};
    }
};

const parseVmwareSnapshots = (/** @type {{currentBytes: Buffer, output: string}} */ {currentBytes, output}) => {
    const lines = output.replaceAll('\r\n', '\n').trimEnd().split('\n');
    const count = /^Total snapshots: ([0-9]+)$/.exec(lines[0]);
    if (count === null) throw new Error('Snapshot list header is invalid.');
    const snapshots = lines.slice(1)
        .map((/** @type {string} */ line) => line.replace(/^[|+`\\\- ]+/, '').trim())
        .filter(Boolean)
        .sort(compareText);
    if (snapshots.length !== Number(count[1]) || new Set(snapshots).size !== snapshots.length) {
        throw new Error('Snapshot list is invalid.');
    }
    const text = currentBytes.toString('utf8');
    const currentUid = /^snapshot\.current\s*=\s*"([^"]+)"\s*$/m.exec(text)?.[1] ?? null;
    /** @type {Map<string, string>} */
    const namesByUid = new Map();
    for (const match of text.matchAll(/^snapshot([0-9]+)\.uid\s*=\s*"([^"]+)"\s*$/gm)) {
        const display = new RegExp(`^snapshot${match[1]}\\.displayName\\s*=\\s*"([^"]+)"\\s*$`, 'm').exec(text)?.[1];
        if (display !== undefined) namesByUid.set(match[2], display);
    }
    const currentSnapshot = currentUid === null ? null : namesByUid.get(currentUid) ?? null;
    if (currentSnapshot !== null && !snapshots.includes(currentSnapshot)) throw new Error('Current snapshot is invalid.');
    return {currentSnapshot, snapshots};
};

/**
 * 建立只解释 VMware machine lifecycle 的 production Adapter.
 * Adapter 返回 closed observation 或 bindable failure, 不拥有 scenario order, judgment 或 recovery policy.
 */
export const createReleaseVmwareMachineLifecycleAdapter = (/** @type {{fileSystem?: FileSystem, processAdapter?: HostProcessAdapter, releaseConfiguration?: unknown}} */ {
    fileSystem = defaultFileSystem,
    processAdapter = createReleaseHostProcessAdapter(),
    releaseConfiguration,
} = {}) => {
    const configurationResult = validateReleaseValidationConfiguration(releaseConfiguration);
    if (configurationResult.status !== 'succeeded') {
        throw new Error('Release validation configuration is invalid.');
    }
    const currentReleaseConfiguration = configurationResult.value;
    return {
    async run(/** @type {{machine: VmMachine, machineKey: string, operation: string}} */ {machine, machineKey, operation}) {
        if (operation === 'read-power-state') {
            const observed = await observeVmwarePowerState({fileSystem, machine, operation, processAdapter});
            return observed.failure ?? {
                observation: {powerState: observed.powerState},
                operation,
                status: 'observed',
            };
        }
        if (operation === 'hard-power-off') {
            const observed = await observeVmwarePowerState({fileSystem, machine, operation, processAdapter});
            if (observed.failure !== undefined) return observed.failure;
            if (observed.powerState !== 'powered-off') {
                const stopped = await runVmwareLifecycleProcess({
                    machine,
                    operation,
                    processAdapter,
                    vmrunOperation: ['stop', machine.location, 'hard'],
                });
                if (stopped.failure !== undefined) {
                    if (observed.powerState !== 'suspended'
                        || stopped.result === undefined
                        || !matchesConfiguredSuspendedStopFailure({
                            machine,
                            releaseConfiguration: currentReleaseConfiguration,
                            result: stopped.result,
                        })
                        || !await usesConfiguredVmwareBuild({
                            machine,
                            processAdapter,
                            releaseConfiguration: currentReleaseConfiguration,
                        })) return stopped.failure;
                    const resumed = await runVmwareLifecycleProcess({
                        machine,
                        operation,
                        processAdapter,
                        vmrunOperation: ['start', machine.location, 'nogui'],
                    });
                    if (resumed.failure !== undefined) return resumed.failure;
                    const stoppedAfterResume = await runVmwareLifecycleProcess({
                        machine,
                        operation,
                        processAdapter,
                        vmrunOperation: ['stop', machine.location, 'hard'],
                    });
                    if (stoppedAfterResume.failure !== undefined) return stoppedAfterResume.failure;
                    const confirmed = await observeVmwarePowerState({fileSystem, machine, operation, processAdapter});
                    if (confirmed.failure !== undefined) return confirmed.failure;
                    if (confirmed.powerState !== 'powered-off') {
                        return machineFailure(
                            'observation-failed',
                            'The VMware Workstation 25.0.1 hard-stop workaround did not produce a powered-off machine.',
                            operation,
                        );
                    }
                }
            }
            return {observation: {powerState: 'powered-off'}, operation, status: 'observed'};
        }
        if (operation === 'soft-power-off') {
            const observed = await observeVmwarePowerState({fileSystem, machine, operation, processAdapter});
            if (observed.failure !== undefined) return observed.failure;
            if (observed.powerState === 'powered-off') {
                return {
                    observation: {powerOffMode: 'already-powered-off', powerState: 'powered-off'},
                    operation,
                    status: 'observed',
                };
            }
            if (observed.powerState !== 'running') {
                return machineFailure(
                    'observation-failed',
                    'The VMware soft power-off requires a running or powered-off machine.',
                    operation,
                );
            }
            const stopped = await runVmwareSoftStopProcess({
                machine,
                machineKey,
                operation,
                processAdapter,
                releaseConfiguration: currentReleaseConfiguration,
            });
            if (stopped.failure !== undefined) return stopped.failure;
            const afterSoftStop = await observeVmwarePowerState({fileSystem, machine, operation, processAdapter});
            if (afterSoftStop.failure !== undefined) return afterSoftStop.failure;
            if (afterSoftStop.powerState === 'powered-off') {
                return {
                    observation: {powerOffMode: 'soft', powerState: 'powered-off'},
                    operation,
                    status: 'observed',
                };
            }
            if (afterSoftStop.powerState !== 'running') {
                return machineFailure('observation-failed', 'The VMware soft power-off returned an unexpected state.', operation);
            }
            if (!stopped.timedOut) {
                return machineFailure(
                    'observation-failed',
                    'The VMware soft power-off process succeeded without producing a powered-off machine.',
                    operation,
                );
            }
            const recovered = await runVmwareLifecycleProcess({
                machine,
                operation,
                processAdapter,
                vmrunOperation: ['stop', machine.location, 'hard'],
            });
            if (recovered.failure !== undefined) return recovered.failure;
            const confirmed = await observeVmwarePowerState({fileSystem, machine, operation, processAdapter});
            if (confirmed.failure !== undefined) return confirmed.failure;
            if (confirmed.powerState !== 'powered-off') {
                return machineFailure(
                    'observation-failed',
                    'The VMware hard stop after a soft power-off timeout did not produce a powered-off machine.',
                    operation,
                );
            }
            return {
                observation: {powerOffMode: 'hard-after-timeout', powerState: 'powered-off'},
                operation,
                status: 'observed',
            };
        }
        if (operation === 'read-snapshots') {
            const listed = await runVmwareLifecycleProcess({
                machine,
                operation,
                processAdapter,
                vmrunOperation: ['listSnapshots', machine.location, 'showTree'],
            });
            if (listed.failure !== undefined) return listed.failure;
            try {
                const vmsdPath = machine.location.replace(/\.vmx$/i, '.vmsd');
                return {
                    observation: parseVmwareSnapshots({
                        currentBytes: await fileSystem.readFile(vmsdPath),
                        output: listed.result.stdout,
                    }),
                    operation,
                    status: 'observed',
                };
            } catch {
                return machineFailure('observation-failed', 'The VMware snapshot observation is invalid.', operation);
            }
        }
        if (operation === 'revert-snapshot') {
            const reverted = await runVmwareLifecycleProcess({
                machine,
                operation,
                processAdapter,
                vmrunOperation: ['revertToSnapshot', machine.location, machine.snapshot],
            });
            return reverted.failure ?? {observation: {snapshot: machine.snapshot}, operation, status: 'observed'};
        }
        if (operation === 'start-background') {
            const listed = await readVmwareRunningMachines({machine, operation, processAdapter});
            if (listed.failure !== undefined) return listed.failure;
            if (!listed.running.includes(machine.location)) {
                const started = await runVmwareLifecycleProcess({
                    machine,
                    operation,
                    processAdapter,
                    vmrunOperation: ['start', machine.location, 'nogui'],
                });
                if (started.failure !== undefined) return started.failure;
            }
            return {observation: {powerState: 'running'}, operation, status: 'observed'};
        }
        if (operation === 'wait-guest-address') {
            const addressed = await runVmwareLifecycleProcess({
                machine,
                operation,
                processAdapter,
                vmrunOperation: ['getGuestIPAddress', machine.location, '-wait'],
            });
            if (addressed.failure !== undefined) return addressed.failure;
            const address = addressed.result.stdout.trim();
            if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address) && !address.includes(':')) {
                return machineFailure('observation-failed', 'The VMware guest address observation is invalid.', operation);
            }
            return {observation: {address}, operation, status: 'observed'};
        }
        return machineFailure('observation-failed', 'The VMware lifecycle operation is unsupported.', operation);
    },
    };
};

/**
 * 建立使用 VMware address discovery 与 host-key-pinned SSH 的 guest process Adapter.
 * Credentials 只传给对应 VMware operation; SSH 固定禁用 agent forwarding 并只使用配置 identity file.
 * 双向 copy 保持 caller 指定的 source and destination order, 并在失败消息中移除 machine credentials.
 */
/** @returns {GuestAdapter} */
export const createReleaseVmwareGuestAdapter = (/** @type {{createTemporaryDirectory?: () => Promise<string>, fileSystem?: FileSystem, processAdapter?: HostProcessAdapter, removeTemporaryDirectory?: (directory: string) => Promise<void>}} */ {
    createTemporaryDirectory = () => mkdtemp(join(tmpdir(), 'arw-release-ssh-')),
    fileSystem = defaultFileSystem,
    processAdapter = createReleaseHostProcessAdapter(),
    removeTemporaryDirectory = directory => rm(directory, {force: true, recursive: true}),
} = {}) => {
    const discoverAddress = async (/** @type {VmMachine} */ machine) => {
        const args = ['-T', 'ws'];
        if (machine.vmwareEncryptionPassword !== undefined) args.push('-vp', machine.vmwareEncryptionPassword);
        args.push('getGuestIPAddress', machine.location, '-wait');
        const result = await runChecked(processAdapter, {
            arguments: args,
            cwd: dirname(machine.location),
            executable: machine.vmrun,
        }, 'VMware guest address discovery');
        const address = result.stdout.trim();
        if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address) && !address.includes(':')) {
            throw new Error('VMware guest address discovery returned an invalid address.');
        }
        return address;
    };
    /**
     * @template Result
     * @param {{isResultFailure?: (result: Result) => boolean, machine: VmMachine, machineKey: string, operation: (connection: {address: string, common: string[]}) => Promise<Result>}} request
     * @returns {Promise<Result>}
     */
    const withConnection = async ({
        machine,
        machineKey,
        operation,
        isResultFailure = () => false,
    }) => {
        const address = await discoverAddress(machine);
        const [kind, key] = sshHostKeyParts(machine.ssh.hostKey);
        const alias = hostKeyAlias(machineKey);
        const temporaryDirectory = await createTemporaryDirectory();
        let operationFailed = false;
        try {
            const knownHostsPath = join(temporaryDirectory, 'known_hosts');
            await fileSystem.writeFile(knownHostsPath, `${alias} ${kind} ${key}\n`);
            const result = await operation({
                address,
                common: [
                    '-o', 'BatchMode=yes',
                    '-o', 'IdentitiesOnly=yes',
                    '-o', 'StrictHostKeyChecking=yes',
                    '-o', `HostKeyAlias=${alias}`,
                    '-o', `UserKnownHostsFile=${knownHostsPath}`,
                    '-i', machine.ssh.identityFile,
                ],
            });
            operationFailed = isResultFailure(result);
            return result;
        } catch (error) {
            operationFailed = true;
            throw error;
        } finally {
            try {
                await removeTemporaryDirectory(temporaryDirectory);
            } catch (cleanupError) {
                if (!operationFailed) throw cleanupError;
            }
        }
    };
    /**
     * @template Result
     * @param {VmMachine} machine
     * @param {string} label
     * @param {() => Promise<Result>} operation
     * @returns {Promise<Result>}
     */
    const executeGuestOperation = async (machine, label, operation) => {
        try {
            return await operation();
        } catch (error) {
            if (error instanceof Error && typeof error.message === 'string' && error.message.trim() !== '') {
                throw new Error(redactReleaseMachineSensitiveText(error.message, machine));
            }
            throw new Error(`${label} failed.`);
        }
    };
    return {
        async copyFromGuest(/** @type {{guestPath: string, hostPath: string, machine: VmMachine, machineKey: string, workspaceDirectory: string}} */ {guestPath, hostPath, machine, machineKey, workspaceDirectory}) {
            await executeGuestOperation(machine, 'Guest result transfer', async () => {
                await withConnection({machine, machineKey, operation: connected => runChecked(processAdapter, {
                    arguments: [
                        ...connected.common,
                        '-P', String(machine.ssh.port),
                        `${sshTarget({address: connected.address, machine})}:${guestScpPath(machineKey, guestPath)}`,
                        hostPath,
                    ],
                    cwd: workspaceDirectory,
                    executable: 'scp',
                }, 'Guest result transfer')});
            });
        },
        async copyToGuest(/** @type {{guestPath: string, hostPaths: string[], machine: VmMachine, machineKey: string, workspaceDirectory: string}} */ {guestPath, hostPaths, machine, machineKey, workspaceDirectory}) {
            await executeGuestOperation(machine, 'Guest input transfer', async () => {
                await withConnection({machine, machineKey, operation: connected => runChecked(processAdapter, {
                    arguments: [
                        ...connected.common,
                        '-P', String(machine.ssh.port),
                        ...hostPaths,
                        `${sshTarget({address: connected.address, machine})}:${guestScpPath(machineKey, guestPath)}`,
                    ],
                    cwd: workspaceDirectory,
                    executable: 'scp',
                }, 'Guest input transfer')});
            });
        },
        async copyDirectoryToGuest(/** @type {{guestPath: string, hostPath: string, machine: VmMachine, machineKey: string, workspaceDirectory: string}} */ {guestPath, hostPath, machine, machineKey, workspaceDirectory}) {
            await executeGuestOperation(machine, 'Guest directory input transfer', async () => {
                await withConnection({machine, machineKey, operation: connected => runChecked(processAdapter, {
                    arguments: [
                        ...connected.common,
                        '-P', String(machine.ssh.port),
                        '-r', hostPath,
                        `${sshTarget({address: connected.address, machine})}:${guestScpPath(machineKey, guestPath)}`,
                    ],
                    cwd: workspaceDirectory,
                    executable: 'scp',
                }, 'Guest directory input transfer')});
            });
        },
        async run(/** @type {{machine: VmMachine, machineKey: string, remoteArguments: string[], workspaceDirectory: string}} */ {machine, machineKey, remoteArguments, workspaceDirectory}) {
            return executeGuestOperation(machine, 'Guest command execution', () => withConnection({
                machine,
                machineKey,
                operation: async connected => {
                    const result = await processAdapter.run({
                        arguments: [
                            ...connected.common,
                            '-p', String(machine.ssh.port),
                            sshTarget({address: connected.address, machine}),
                            remoteCommand(machineKey, remoteArguments, machine.nodeExecutables.recommended),
                        ],
                        cwd: workspaceDirectory,
                        executable: 'ssh',
                    });
                    return result.exitCode === 0
                        ? result
                        : {
                            ...result,
                            stderr: redactReleaseMachineSensitiveText(result.stderr, machine),
                            stdout: redactReleaseMachineSensitiveText(result.stdout, machine),
                        };
                },
                isResultFailure: result => result.exitCode !== 0,
            }));
        },
    };
};

const validateCapturedGuestStep = (/** @type {{captured: unknown, machineKey: unknown, requireCommandOutcome?: boolean, scenarioId: string, stepId: string}} */ {captured, machineKey, requireCommandOutcome = true, scenarioId, stepId}) => {
    if (typeof machineKey !== 'string') throw new Error('Release guest helper returned an invalid machine identity.');
    const {scenario, step} = resolveReleaseValidationStep({machineKey, scenarioId, stepId});
    if (!exactKeys(captured, ['auditedDirectory', 'changes', 'machineKey', 'reviewMaterial', 'scenarioId', 'status', 'stepId'])
        || captured.status !== 'captured'
        || captured.machineKey !== machineKey
        || captured.scenarioId !== scenarioId
        || captured.stepId !== stepId
        || typeof captured.auditedDirectory !== 'string'
        || !Array.isArray(captured.changes)
        || !isJsonObject(captured.reviewMaterial)) {
        throw new Error('Release guest helper returned an invalid result.');
    }
    assertAbsolutePath(captured.auditedDirectory, 'Release guest audited directory', machineKey === 'Windows 11');
    const expectedReviewKeys = [
        'headToIndexDiff',
        'indexToWorkingTreeDiff',
        'nonRegularEntries',
        'status',
        'untrackedFiles',
        ...(step.command && requireCommandOutcome ? ['commandOutcome'] : []),
    ];
    if (!exactKeys(captured.reviewMaterial, expectedReviewKeys)
        || !Array.isArray(captured.reviewMaterial.untrackedFiles)
        || !Array.isArray(captured.reviewMaterial.nonRegularEntries)
        || typeof captured.reviewMaterial.status !== 'string'
        || typeof captured.reviewMaterial.headToIndexDiff !== 'string'
        || typeof captured.reviewMaterial.indexToWorkingTreeDiff !== 'string') {
        throw new Error('Release guest helper returned incomplete review material.');
    }
    if (step.command && requireCommandOutcome && (!exactKeys(captured.reviewMaterial.commandOutcome, ['exitCode', 'stderr', 'stdout'])
        || !Number.isSafeInteger(captured.reviewMaterial.commandOutcome.exitCode)
        || typeof captured.reviewMaterial.commandOutcome.stdout !== 'string'
        || typeof captured.reviewMaterial.commandOutcome.stderr !== 'string')) {
        throw new Error('Release guest helper returned an invalid command outcome.');
    }
    const decodeBase64 = (/** @type {import("buffer").WithImplicitCoercion<string>} */ value, /** @type {string} */ label) => {
        if (typeof value !== 'string' || Buffer.from(value, 'base64').toString('base64') !== value) {
            throw new Error(`Release guest helper returned invalid ${label}.`);
        }
        return Buffer.from(value, 'base64');
    };
    const statusBytes = decodeBase64(captured.reviewMaterial.status, 'Git status bytes');
    decodeBase64(captured.reviewMaterial.headToIndexDiff, 'HEAD-to-index diff bytes');
    decodeBase64(captured.reviewMaterial.indexToWorkingTreeDiff, 'index-to-working-tree diff bytes');
    const parsedStatus = parseReleaseGitStatus(statusBytes);
    if (captured.changes.some((/** @type {unknown} */ change) => !exactKeys(change, ['changeType', 'path'])
        || typeof change.path !== 'string'
        || typeof change.changeType !== 'string')) throw new Error('Release guest helper returned invalid changes.');
    const sortedChanges = [...captured.changes].sort((left, right) => compareText(left.path, right.path));
    if (captured.changes.length !== sortedChanges.length
        || captured.changes.some((change, index) => JSON.stringify(change) !== JSON.stringify(sortedChanges[index]))
        || captured.changes.some(change => Object.keys(change).sort().join(',') !== 'changeType,path'
            || !isSafeReleaseRelativePath(change.path)
            || !['added', 'deleted', 'modified', 'type-changed'].includes(change.changeType))
        || JSON.stringify(captured.changes) !== JSON.stringify(parsedStatus.changes)) {
        throw new Error('Release guest helper returned invalid changes.');
    }
    const untrackedPaths = [];
    for (const file of captured.reviewMaterial.untrackedFiles) {
        if (!exactKeys(file, ['bytes', 'path'])
            || typeof file.path !== 'string'
            || !isSafeReleaseRelativePath(file.path)) {
            throw new Error('Release guest helper returned invalid untracked files.');
        }
        if (typeof file.bytes !== 'string') throw new Error('Release guest helper returned invalid untracked files.');
        decodeBase64(file.bytes, 'untracked file bytes');
        untrackedPaths.push(file.path);
    }
    for (const entry of captured.reviewMaterial.nonRegularEntries) {
        if (!exactKeys(entry, ['path', 'type'])
            || typeof entry.path !== 'string'
            || typeof entry.type !== 'string'
            || !isSafeReleaseRelativePath(entry.path)
            || !['directory', 'special', 'symbolic-link'].includes(entry.type)) {
            throw new Error('Release guest helper returned invalid non-regular entries.');
        }
        untrackedPaths.push(entry.path);
    }
    untrackedPaths.sort(compareText);
    if (new Set(untrackedPaths).size !== untrackedPaths.length
        || JSON.stringify(untrackedPaths) !== JSON.stringify(parsedStatus.untrackedPaths)) {
        throw new Error('Release guest helper returned incomplete untracked content.');
    }
    /** @type {GuestReviewMaterial} */
    const reviewMaterial = {
        headToIndexDiff: captured.reviewMaterial.headToIndexDiff,
        indexToWorkingTreeDiff: captured.reviewMaterial.indexToWorkingTreeDiff,
        nonRegularEntries: captured.reviewMaterial.nonRegularEntries.map(entry => ({path: entry.path, type: entry.type})),
        status: captured.reviewMaterial.status,
        untrackedFiles: captured.reviewMaterial.untrackedFiles.map(file => ({bytes: file.bytes, path: file.path})),
        ...(exactKeys(captured.reviewMaterial.commandOutcome, ['exitCode', 'stderr', 'stdout'])
            && typeof captured.reviewMaterial.commandOutcome.exitCode === 'number'
            && typeof captured.reviewMaterial.commandOutcome.stderr === 'string'
            && typeof captured.reviewMaterial.commandOutcome.stdout === 'string'
            ? {commandOutcome: {
                    exitCode: captured.reviewMaterial.commandOutcome.exitCode,
                    stderr: captured.reviewMaterial.commandOutcome.stderr,
                    stdout: captured.reviewMaterial.commandOutcome.stdout,
                }}
            : {}),
    };
    /** @type {CapturedGuestStep} */
    const validatedCaptured = {
        auditedDirectory: captured.auditedDirectory,
        changes: captured.changes.map(change => ({changeType: change.changeType, path: change.path})),
        machineKey,
        reviewMaterial,
        scenarioId,
        status: 'captured',
        stepId,
    };
    return {captured: validatedCaptured, scenario, step};
};

const releaseGuestWorkspace = (/** @type {string} */ machineKey, /** @type {string} */ scenarioId, /** @type {string | null} */ runId = null) => machineKey === 'Windows 11'
    ? `C:\\arw-release-validation\\${runId === null ? '' : `${runId}\\`}${scenarioId.replaceAll('/', '-').replaceAll(':', '-')}`
    : `/tmp/arw-release-validation/${runId === null ? '' : `${runId}/`}${scenarioId.replaceAll('/', '-')}`;

const releaseGuestPath = (/** @type {string} */ machineKey, /** @type {string} */ root, /** @type {string} */ child) => machineKey === 'Windows 11'
    ? `${root}\\${child}`
    : `${root}/${child}`;

const expectedGuestAuditedDirectory = (/** @type {{machineKey: string, runId: string | null, scenarioId: string, step: RegistryStep}} */ {machineKey, runId, scenarioId, step}) => releaseGuestPath(
    machineKey,
    releaseGuestWorkspace(machineKey, scenarioId, runId),
    step.auditedLocation === 'repository'
        ? 'target'
        : step.auditedLocation === 'source-checkout'
            ? 'source'
            : 'home',
);

const validateBundleRecord = async (/** @type {{bundleRecord: unknown, fileSystem: FileSystem, processAdapter: HostProcessAdapter, releaseConfiguration: ReleaseConfiguration, workspaceDirectory: string}} */ {
    bundleRecord,
    fileSystem,
    processAdapter,
    releaseConfiguration,
    workspaceDirectory,
}) => {
    const prepared = parsePreparedBundleRecord(bundleRecord, workspaceDirectory);
    const {bundles} = prepared;
    const paths = ['candidate', 'plain', 'agentAssisted'].map(key => bundles[key]);
    await Promise.all(paths.map((path, index) => assertOrdinaryHostFile(path, `Release validation bundle ${index + 1}`, fileSystem)));
    const facts = await inspectReleaseValidationBundles({
        agentAssistedBundlePath: bundles.agentAssisted,
        candidateBundlePath: bundles.candidate,
        candidateCommit: prepared.candidateCommit,
        plainBundlePath: bundles.plain,
    }, {
        fileSystem,
        processAdapter,
        releaseConfiguration,
        workspaceBoundary: () => {},
    });
    const inspectedPriorRelease = facts.candidate.priorRelease;
    if (inspectedPriorRelease === undefined
        || inspectedPriorRelease.commit !== prepared.priorRelease.commit
        || inspectedPriorRelease.tag !== prepared.priorRelease.tag) {
        throw new Error('Release validation bundle record prior Release identity does not match the candidate bundle.');
    }
    return paths;
};

const validateFinalStepResult = (/** @type {unknown} */ validation, /** @type {RegistryStep} */ step) => {
    const expectedKeys = [...(step.command ? ['exitCode'] : []), 'files', 'matchesExpected', 'summary'].sort();
    if (!exactKeys(validation, expectedKeys)
        || validation.matchesExpected !== true
        || typeof validation.summary !== 'string'
        || validation.summary.length === 0
        || !Array.isArray(validation.files)
        || step.command && !Number.isSafeInteger(validation.exitCode)) {
        throw new Error('Release validation prerequisite has an invalid formal result.');
    }
    const seen = new Set();
    for (const file of validation.files) {
        if (!exactKeys(file, ['changeType', 'matchesExpected', 'path', 'summary'])
            || typeof file.path !== 'string'
            || !isSafeReleaseRelativePath(file.path)
            || typeof file.changeType !== 'string'
            || !['added', 'deleted', 'modified', 'type-changed'].includes(file.changeType)
            || file.matchesExpected !== true
            || typeof file.summary !== 'string'
            || file.summary.length === 0
            || seen.has(file.path)) {
            throw new Error('Release validation prerequisite has invalid file judgments.');
        }
        seen.add(file.path);
    }
    const sorted = [...validation.files].sort((left, right) => compareText(left.path, right.path));
    if (JSON.stringify(sorted) !== JSON.stringify(validation.files)) {
        throw new Error('Release validation prerequisite file judgments are not canonical.');
    }
};

/**
 * 执行或只读观察一个已登记的 guest step, 回收并重新验证全部 mechanical review facts, 再写 judgment template.
 * Normal mode 验证 finalized prerequisites, 准备和传输 bundle, 运行原 step, 并可用 `retrieveMechanicalInput` 取得闭合 mechanical input.
 * `observeOnly: true` 必须与 UUID `captureId` 和 `retrieveMechanicalInput: true` 同时提供;
 * 它跳过 bundle setup 和原 step operation, 只运行该 step 已登记的当前状态 observation,
 * 并把独立 capture 写入 observation identity 目录. `enforceFinalizedPrerequisites: false` 只供 Runner 已拥有依赖判断的内部继续路径.
 * Success 返回 capture identity, review material, template 和可选 mechanical input paths.
 * Invalid mode combination, 前置 formal step 未完成或失败, bundle record 不闭合, guest path 不准确,
 * Adapter failure 或 facts 不一致时 reject, 且不会把结果表示为通过.
 */
export const runReleaseVmGuestStep = async (/** @type {{configuration: VmConfiguration, machineKey: string, scenarioId: string, stepId: string, workspaceDirectory: string}} */ {
    configuration,
    machineKey,
    scenarioId,
    stepId,
    workspaceDirectory,
}, /** @type {{fileSystem?: FileSystem, captureId?: string | null, enforceFinalizedPrerequisites?: boolean, guestAdapter?: GuestAdapter, loadReleaseConfiguration?: () => Promise<unknown>, observeOnly?: boolean, plannedChoices?: Readonly<JsonObject> | null, prepareOnly?: boolean, processAdapter?: HostProcessAdapter, retrieveMechanicalInput?: boolean, releaseConfiguration?: unknown, runId?: string | null, scenarioPrepared?: boolean, workspaceBoundary?: WorkspaceBoundary}} */ {
    fileSystem = defaultFileSystem,
    captureId = null,
    enforceFinalizedPrerequisites = true,
    guestAdapter = createReleaseVmwareGuestAdapter(),
    loadReleaseConfiguration = loadReleaseValidationConfiguration,
    observeOnly = false,
    plannedChoices = null,
    prepareOnly = false,
    processAdapter = createReleaseHostProcessAdapter(),
    retrieveMechanicalInput = false,
    releaseConfiguration,
    runId = null,
    scenarioPrepared = false,
    workspaceBoundary,
} = {}) => {
    const currentReleaseConfiguration = await resolveRootReleaseConfiguration({
        loadReleaseConfiguration,
        releaseConfiguration,
    });
    if (!matchingReleaseMachineKeys(currentReleaseConfiguration, configuration)) {
        throw new Error('Release validation configuration machine inventories do not match.');
    }
    requireWorkspaceBoundary(workspaceBoundary)(workspaceDirectory, 'Release validation workspace');
    if (observeOnly !== (captureId !== null)
        || observeOnly && (typeof captureId !== 'string' || !UUID_PATTERN.test(captureId) || !retrieveMechanicalInput)
        || prepareOnly && (observeOnly || scenarioPrepared || retrieveMechanicalInput)) {
        throw new Error('Release guest observation identity is invalid.');
    }
    const resolved = prepareReleaseStep({machineKey, scenarioId, stepId, workspaceDirectory});
    const runtime = resolveReleaseValidationRuntimeRole(resolved.scenario);
    if (!(runId === null || UUID_PATTERN.test(runId))) throw new Error('Release guest run identity is invalid.');
    const expectedChoices = resolvedChoices(resolved.step.choiceParameters);
    const choices = plannedChoices ?? expectedChoices;
    if (!exactKeys(choices, Object.keys(expectedChoices))
        || JSON.stringify(choices) !== JSON.stringify(expectedChoices)) {
        throw new Error('Release guest frozen choices are invalid.');
    }
    const runDirectory = runId === null ? workspaceDirectory : join(workspaceDirectory, 'runs', runId);
    const runPath = runId === null ? null : join(runDirectory, 'run.json');
    const machine = configuration?.machines?.[machineKey];
    if (machine === undefined) throw new Error('Release VM configuration does not contain the selected machine.');
    const guestWorkspace = releaseGuestWorkspace(machineKey, scenarioId, runId);
    const priorSteps = enforceFinalizedPrerequisites ? resolved.scenario.steps.slice(0, resolved.step.index) : [];
    for (const priorStep of priorSteps) {
        const priorValidation = join(
            runDirectory,
            'archive-source',
            ...scenarioId.split('/'),
            'steps',
            priorStep.stepId,
            'validation.json',
        );
        /** @type {unknown} */
        let validation;
        try {
            await fileSystem.lstat(priorValidation);
            validation = JSON.parse(await fileSystem.readFile(priorValidation, 'utf8'));
        } catch {
            throw new Error(`Release validation step is out of order; missing finalized step ${priorStep.stepId}.`);
        }
        try {
            validateFinalStepResult(validation, priorStep);
        } catch (error) {
            if (isJsonObject(validation) && validation.matchesExpected === false) {
                throw new Error(`Release validation step depends on failed step ${priorStep.stepId}.`);
            }
            throw error;
        }
    }
    let version;
    if (scenarioPrepared) {
        /** @type {unknown} */
        let preparation;
        try {
            preparation = JSON.parse(await fileSystem.readFile(join(
                runDirectory,
                'scenario-ready',
                ...scenarioId.split('/'),
                'scenario-ready.json',
            ), 'utf8'));
        } catch {
            throw new Error('Release guest scenario preparation state is unavailable.');
        }
        if (!exactKeys(preparation, [
            'auditedDirectory',
            'homeDirectory',
            'nodeVersion',
            'scenarioId',
            'sourceDirectory',
            'status',
            'targetDirectory',
            'workspaceDirectory',
        ])
            || preparation.status !== 'prepared'
            || preparation.scenarioId !== scenarioId
            || preparation.workspaceDirectory !== guestWorkspace
            || typeof preparation.nodeVersion !== 'string'
            || !NODE_VERSION_PATTERN.test(preparation.nodeVersion)) {
            throw new Error('Release guest scenario preparation state is invalid.');
        }
        version = validateGuestNodeRoleVersion({
            machineKey,
            runtime,
            version: preparation.nodeVersion,
        });
    } else {
        version = await validateGuestNodeVersion({
            machine,
            machineKey,
            processAdapter: guestAdapter,
            runtime,
            workspaceDirectory: runDirectory,
        });
    }
    const hostStepDirectory = join(
        runDirectory,
        prepareOnly ? 'scenario-ready' : 'guest-results',
        ...scenarioId.split('/'),
        ...(prepareOnly ? [] : [stepId]),
        ...(observeOnly && captureId !== null ? ['observations', captureId] : []),
    );
    await fileSystem.mkdir(hostStepDirectory, {recursive: true});
    /** @type {string[]} */
    let bundlePaths = [];
    if (!observeOnly && !scenarioPrepared) {
        const guestParent = machineKey === 'Windows 11'
            ? win32.dirname(guestWorkspace)
            : dirname(guestWorkspace);
        const nodeExecutable = machine.nodeExecutables[runtime];
        if (nodeExecutable === undefined) throw new Error('Release guest Node.js runtime is unavailable.');
        const workspaceScript = resolved.step.index === 0
            ? `import('node:fs/promises').then(async fs=>{await fs.mkdir(${JSON.stringify(guestParent)},{recursive:true});await fs.mkdir(${JSON.stringify(guestWorkspace)})})`
            : `import('node:fs/promises').then(async fs=>{const value=await fs.lstat(${JSON.stringify(guestWorkspace)});if(!value.isDirectory()||value.isSymbolicLink())throw new Error('invalid workspace')})`;
        const workspaceResult = requireGuestProcessResult(await guestAdapter.run({
            machine,
            machineKey,
            remoteArguments: [nodeExecutable, '-e', workspaceScript],
            workspaceDirectory: runDirectory,
        }));
        if (workspaceResult.exitCode !== 0) {
            throw new Error(`Release guest workspace preparation failed: ${workspaceResult.stderr.trim() || `exit ${workspaceResult.exitCode}`}`);
        }
        let bundleRecord;
        try {
            bundleRecord = JSON.parse(await fileSystem.readFile(join(workspaceDirectory, 'bundles.json'), 'utf8'));
        } catch {
            throw new Error('Release validation bundle record is not valid JSON.');
        }
        bundlePaths = await validateBundleRecord({
            bundleRecord,
            fileSystem,
            processAdapter,
            releaseConfiguration: currentReleaseConfiguration,
            workspaceDirectory,
        });
    }
    if (!observeOnly && !scenarioPrepared && resolved.step.index === 0) {
        await guestAdapter.copyToGuest({
            guestPath: guestWorkspace,
            hostPaths: bundlePaths,
            machine,
            machineKey,
            workspaceDirectory: runDirectory,
        });
        const guestCandidateBundle = machineKey === 'Windows 11'
            ? `${guestWorkspace}\\candidate.bundle`
            : `${guestWorkspace}/candidate.bundle`;
        const guestSourceDirectory = machineKey === 'Windows 11'
            ? `${guestWorkspace}\\source`
            : `${guestWorkspace}/source`;
        const checkoutResult = requireGuestProcessResult(await guestAdapter.run({
            machine,
            machineKey,
            remoteArguments: [
                'git', 'clone', '--quiet',
                '-c', 'core.longpaths=true', '-c', 'core.autocrlf=false',
                '--branch', 'arw-validation', guestCandidateBundle, guestSourceDirectory,
            ],
            workspaceDirectory,
        }));
        if (checkoutResult.exitCode !== 0) {
            throw new Error(`Release guest candidate checkout failed: ${checkoutResult.stderr.trim() || `exit ${checkoutResult.exitCode}`}`);
        }
    }
    const helperNodeExecutable = machine.nodeExecutables[runtime];
    if (helperNodeExecutable === undefined) throw new Error('Release guest Node.js runtime is unavailable.');
    const helperResult = requireGuestProcessResult(await guestAdapter.run({
        machine,
        machineKey,
        remoteArguments: [
            helperNodeExecutable,
            machineKey === 'Windows 11' ? `${guestWorkspace}\\source\\scripts\\release-guest-step.mjs` : `${guestWorkspace}/source/scripts/release-guest-step.mjs`,
            '--machine', machineKey,
            '--scenario', scenarioId,
            '--step', stepId,
            '--workspace', guestWorkspace,
            '--choices', JSON.stringify(choices),
            ...(prepareOnly ? ['--prepare-only', 'true'] : []),
            ...(scenarioPrepared ? ['--scenario-prepared', 'true'] : []),
            ...(observeOnly && captureId !== null ? ['--observe-only', 'true', '--capture-id', captureId] : []),
        ],
        workspaceDirectory: runDirectory,
    }));
    if (helperResult.exitCode !== 0) {
        throw new Error(`Release guest helper failed: ${helperResult.stderr.trim() || `exit ${helperResult.exitCode}`}`);
    }
    /** @type {unknown} */
    let captured;
    try {
        captured = JSON.parse(helperResult.stdout);
    } catch {
        throw adapterResultInvalidError('Release guest helper returned invalid JSON.');
    }
    if (prepareOnly) {
        const expectedWorkspace = guestWorkspace;
        const expectedHome = releaseGuestPath(machineKey, guestWorkspace, 'home');
        const expectedSource = releaseGuestPath(machineKey, guestWorkspace, 'source');
        const expectedTarget = resolved.scenario.targetKind !== null
            ? releaseGuestPath(machineKey, guestWorkspace, 'target')
            : null;
        const expectedAudited = resolved.step.auditedLocation === 'repository'
            ? expectedTarget
            : resolved.step.auditedLocation === 'source-checkout'
                ? expectedSource
                : expectedHome;
        if (expectedAudited === null) throw adapterResultInvalidError('Release guest scenario preparation returned invalid facts.');
        if (!exactKeys(captured, [
            'auditedDirectory',
            'homeDirectory',
            'scenarioId',
            'sourceDirectory',
            'status',
            'targetDirectory',
            'workspaceDirectory',
        ])
            || captured.status !== 'prepared'
            || captured.scenarioId !== scenarioId
            || captured.workspaceDirectory !== expectedWorkspace
            || captured.homeDirectory !== expectedHome
            || captured.sourceDirectory !== expectedSource
            || captured.targetDirectory !== expectedTarget
            || captured.auditedDirectory !== expectedAudited
            || new Set([expectedWorkspace, expectedHome, expectedSource, expectedTarget].filter(isNonemptyString)).size !== (expectedTarget === null ? 3 : 4)) {
            throw adapterResultInvalidError('Release guest scenario preparation returned invalid facts.');
        }
        const resultPath = join(hostStepDirectory, 'scenario-ready.json');
        await writeReleaseEvidenceFiles({
            fileSystem,
            runPath,
            writes: [{bytes: canonicalJson({...captured, nodeVersion: version}), path: resultPath}],
        });
        return {resultPath, scenarioId, status: 'prepared'};
    }
    let validated;
    try {
        validated = validateCapturedGuestStep({
            captured,
            machineKey,
            requireCommandOutcome: !observeOnly,
            scenarioId,
            stepId,
        });
    } catch (error) {
        throw adapterResultInvalidError(error instanceof Error ? error.message : 'Release guest helper returned invalid facts.');
    }
    const capturedFacts = validated.captured;
    if (capturedFacts.auditedDirectory !== expectedGuestAuditedDirectory({machineKey, runId, scenarioId, step: validated.step})) {
        throw adapterResultInvalidError('Release guest helper returned an unexpected audited directory.');
    }
    const mechanical = {
        auditedDirectory: capturedFacts.auditedDirectory,
        changes: capturedFacts.changes,
        machineKey,
        nodeVersion: version,
        reviewMaterial: capturedFacts.reviewMaterial,
        scenarioId,
        stepId,
        workspaceDirectory: resolve(runDirectory),
    };
    const template = {
        judgment: {
            files: capturedFacts.changes.map(change => ({...change, matchesExpected: null, summary: null})),
            matchesExpected: null,
            summary: null,
        },
        mechanical,
        status: 'awaiting-judgment',
    };
    const templatePath = join(hostStepDirectory, 'judgment-template.json');
    const reviewMaterialPath = join(hostStepDirectory, 'review-material.json');
    let mechanicalInputPath;
    let mechanicalInputAttempted = false;
    try {
        if (retrieveMechanicalInput) {
            if (validated.step.judgment !== 'mechanical' || typeof guestAdapter.copyFromGuest !== 'function') {
                throw adapterResultInvalidError('Release guest mechanical input transfer is unavailable.');
            }
            if (typeof fileSystem.rm !== 'function') throw releaseValidationOperationError('persistence-failed', runPath);
            mechanicalInputPath = join(hostStepDirectory, observeOnly ? `${captureId}.json` : 'mechanical-input.json');
            try {
                await fileSystem.lstat(mechanicalInputPath);
                throw releaseValidationOperationError('persistence-failed', runPath);
            } catch (error) {
                if (errorCode(error) !== 'ENOENT') throw error;
            }
            mechanicalInputAttempted = true;
            const guestMechanicalInputPath = ['runner-state', 'steps', stepId, observeOnly ? `${captureId}.json` : 'mechanical-input.json']
                .reduce((path, child) => releaseGuestPath(machineKey, path, child), guestWorkspace);
            await guestAdapter.copyFromGuest({
                guestPath: guestMechanicalInputPath,
                hostPath: mechanicalInputPath,
                machine,
                machineKey,
                workspaceDirectory: runDirectory,
            });
            let mechanicalInput;
            try {
                mechanicalInput = JSON.parse(await fileSystem.readFile(mechanicalInputPath, 'utf8'));
                if (!exactKeys(mechanicalInput, ['capturedFacts', 'currentObservation', 'operationActual'])) {
                    throw new Error('Mechanical input fields are invalid.');
                }
                releaseFactDelta(mechanicalInput.capturedFacts);
            } catch {
                throw adapterResultInvalidError('Release guest mechanical input is invalid.');
            }
        }
        await writeReleaseEvidenceFiles({
            fileSystem,
            runPath,
            writes: [
                {bytes: canonicalJson(capturedFacts.reviewMaterial), path: reviewMaterialPath},
                {bytes: canonicalJson(template), path: templatePath},
            ],
        });
    } catch (error) {
        if (mechanicalInputAttempted && mechanicalInputPath !== undefined) {
            await removeReleaseEvidenceFiles({fileSystem, paths: [mechanicalInputPath], runPath});
        }
        throw error;
    }
    return {
        changes: capturedFacts.changes,
        ...(mechanicalInputPath === undefined ? {} : {mechanicalInputPath}),
        reviewMaterialPath,
        scenarioId: validated.captured.scenarioId,
        status: 'captured',
        stepId: validated.captured.stepId,
        templatePath,
    };
};

/**
 * 把 current-step mechanical judgments 合并到 template 保留的完整 staged history.
 * 不在 current delta 中的 path 已由前一步接受并写入 index baseline; current path 沿用 template
 * 相对 HEAD 的 change type, 但保留本步 contract 对当前 bytes 的判断.
 */
/** @returns {MechanicalEvaluation} */
export const completeReleaseMechanicalEvaluation = (/** @type {{evaluation: unknown, templateChanges: unknown}} */ {evaluation, templateChanges}) => {
    if (!isJsonObject(evaluation) || !Array.isArray(evaluation.files) || !Array.isArray(templateChanges)
        || typeof evaluation.matchesExpected !== 'boolean'
        || typeof evaluation.summary !== 'string'
        || templateChanges.some((/** @type {unknown} */ change) => !exactKeys(change, ['changeType', 'path'])
            || typeof change.changeType !== 'string' || typeof change.path !== 'string')) {
        throw new Error('Release mechanical result does not cover the complete captured path set.');
    }
    /** @type {Map<string, JsonObject>} */
    const evaluated = new Map();
    for (const file of evaluation.files) {
        if (!exactKeys(file, ['changeType', 'matchesExpected', 'path', 'summary'])
            || typeof file.path !== 'string'
            || evaluated.has(file.path)) {
            throw new Error('Release mechanical result does not cover the complete captured path set.');
        }
        evaluated.set(file.path, file);
    }
    const templatePaths = new Set(templateChanges.map(change => change.path));
    if (templatePaths.size !== templateChanges.length
        || [...evaluated.keys()].some(path => !templatePaths.has(path))) {
        throw new Error('Release mechanical result does not cover the complete captured path set.');
    }
    return {
        ...evaluation,
        files: templateChanges.map(change => {
            const current = evaluated.get(change.path);
            return current === undefined
                ? {
                    ...change,
                    matchesExpected: true,
                    summary: 'The accepted Git index baseline is unchanged for this path.',
                }
                : {...current, changeType: change.changeType};
        }),
        matchesExpected: evaluation.matchesExpected,
        summary: evaluation.summary,
    };
};

const runAutomaticMechanicalStep = async (/** @type {{configuration: VmConfiguration, fileSystem: FileSystem, guestAdapter: GuestAdapter, machineKey: string, processAdapter: HostProcessAdapter, runId: string, scenario: MachineScenario, step: PlannedStep, workspaceBoundary?: WorkspaceBoundary, workspaceDirectory: string}} */ {
    configuration,
    fileSystem,
    guestAdapter,
    machineKey,
    processAdapter,
    runId,
    scenario,
    step,
    workspaceBoundary,
    workspaceDirectory,
}) => {
    const captured = await runReleaseVmGuestStep({
        configuration,
        machineKey,
        scenarioId: scenario.archiveKind,
        stepId: step.stepId,
        workspaceDirectory,
    }, {
        enforceFinalizedPrerequisites: false,
        fileSystem,
        guestAdapter,
        plannedChoices: step.choices,
        processAdapter,
        retrieveMechanicalInput: true,
        runId,
        scenarioPrepared: true,
        workspaceBoundary,
    });
    if (!('mechanicalInputPath' in captured) || typeof captured.mechanicalInputPath !== 'string'
        || !('templatePath' in captured) || typeof captured.templatePath !== 'string'
        || !('reviewMaterialPath' in captured) || typeof captured.reviewMaterialPath !== 'string') {
        throw adapterResultInvalidError('Release mechanical capture did not return required paths.');
    }
    /** @type {JsonObject} */
    let mechanicalInput;
    /** @type {JsonObject} */
    let template;
    let evaluation;
    try {
        const parsed = await Promise.all([
            parseJsonFile(captured.mechanicalInputPath, 'Release mechanical input', fileSystem),
            parseJsonFile(captured.templatePath, 'Release step template', fileSystem),
        ]);
        if (!isJsonObject(parsed[0]) || !isJsonObject(parsed[1]) || !isJsonObject(parsed[1].mechanical)
            || !Array.isArray(parsed[1].mechanical.changes)) throw new Error('Release mechanical input is invalid.');
        mechanicalInput = parsed[0];
        template = parsed[1];
        const templateMechanical = parsed[1].mechanical;
        const currentEvaluation = evaluateReleaseMechanicalContract({
            ...mechanicalInput,
            evaluation: 'full',
            mechanicalContract: step.mechanicalContract,
            mechanicalParameters: step.mechanicalParameters,
        });
        evaluation = completeReleaseMechanicalEvaluation({
            evaluation: currentEvaluation,
            templateChanges: templateMechanical.changes,
        });
    } catch (error) {
        await removeReleaseEvidenceFiles({
            fileSystem,
            paths: [captured.mechanicalInputPath, captured.reviewMaterialPath, captured.templatePath],
            runPath: join(workspaceDirectory, 'runs', runId, 'run.json'),
        });
        if (isAdapterResultInvalidError(error)) throw error;
        throw adapterResultInvalidError(error instanceof Error ? error.message : 'Release mechanical input is invalid.');
    }
    const resultDirectory = dirname(captured.templatePath);
    const evaluationPath = join(resultDirectory, 'mechanical-result.json');
    const judgmentPath = join(resultDirectory, 'automatic-judgment.json');
    await writeReleaseEvidenceFiles({
        fileSystem,
        runPath: join(workspaceDirectory, 'runs', runId, 'run.json'),
        writes: [
            {bytes: canonicalJson(evaluation), path: evaluationPath},
            {
                bytes: canonicalJson({
                    ...template,
                    judgment: {
                        files: evaluation.files,
                        matchesExpected: evaluation.matchesExpected,
                        summary: evaluation.summary,
                    },
                }),
                path: judgmentPath,
            },
        ],
    });
    const finalization = await finalizeReleaseVmGuestStep({
        configuration,
        judgmentPath,
        templatePath: captured.templatePath,
    }, {
        createFinalArchive: false,
        fileSystem,
        guestAdapter,
        workspaceBoundary,
    });
    return {evaluation, evaluationPath, finalization};
};

const captureReleaseVmMechanicalObservation = async (/** @type {{captureId: string, configuration: VmConfiguration, fileSystem: FileSystem, guestAdapter: GuestAdapter, machineKey: string, processAdapter: HostProcessAdapter, runId: string, scenarioId: string, stepId: string, workspaceBoundary?: WorkspaceBoundary, workspaceDirectory: string}} */ {
    captureId,
    configuration,
    fileSystem,
    guestAdapter,
    machineKey,
    processAdapter,
    runId,
    scenarioId,
    stepId,
    workspaceBoundary,
    workspaceDirectory,
}) => {
    const plannedStep = resolveReleaseValidationStep({machineKey, scenarioId, stepId}).step;
    const observed = await runReleaseVmGuestStep({
        configuration,
        machineKey,
        scenarioId,
        stepId,
        workspaceDirectory,
    }, {
        captureId,
        enforceFinalizedPrerequisites: false,
        fileSystem,
        guestAdapter,
        observeOnly: true,
        plannedChoices: resolvedChoices(plannedStep.choiceParameters),
        processAdapter,
        retrieveMechanicalInput: true,
        runId,
        scenarioPrepared: true,
        workspaceBoundary,
    });
    if (!('mechanicalInputPath' in observed) || typeof observed.mechanicalInputPath !== 'string') {
        throw adapterResultInvalidError('Release compensation capture did not return mechanical input.');
    }
    const [current, original] = await Promise.all([
        parseJsonFile(observed.mechanicalInputPath, 'Release compensation observation', fileSystem),
        parseJsonFile(join(
            join(workspaceDirectory, 'runs', runId),
            'guest-results',
            ...scenarioId.split('/'),
            stepId,
            'mechanical-input.json',
        ), 'Release original mechanical input', fileSystem),
    ]);
    if (!exactKeys(current, ['capturedFacts', 'currentObservation', 'operationActual'])
        || !exactKeys(original, ['capturedFacts', 'currentObservation', 'operationActual'])
        || !exactKeys(current.capturedFacts, ['after', 'before'])
        || !exactKeys(original.capturedFacts, ['after', 'before'])) {
        throw adapterResultInvalidError('Release compensation mechanical input is invalid.');
    }
    return {
        capturedFacts: {
            after: current.capturedFacts.after,
            before: original.capturedFacts.before,
        },
        currentObservation: current.currentObservation,
        operationActual: null,
    };
};

/**
 * 从闭合 registry 解析一个准确 machine, scenario 和 step, 并绑定 absolute host workspace.
 * Unknown identity, machine mismatch 或 relative workspace 在任何 I/O 前失败.
 */
export const prepareReleaseStep = (/** @type {{machineKey: string, scenarioId: string, stepId: string, workspaceDirectory: string}} */ {machineKey, scenarioId, stepId, workspaceDirectory}) => {
    assertAbsolutePath(workspaceDirectory, 'Release validation workspace');
    const {scenario, step} = resolveReleaseValidationStep({machineKey, scenarioId, stepId});
    return {
        machineKey,
        scenario,
        scenarioId: scenario.archiveKind,
        status: 'resolved',
        step,
        workspaceDirectory: resolve(workspaceDirectory),
    };
};

const compareText = (/** @type {string | number} */ left, /** @type {string | number} */ right) => left < right ? -1 : left > right ? 1 : 0;
const requireGitResult = (/** @type {{code: number | null, failure: string | null, stderr: string, stdout: Buffer}} */ result, /** @type {string} */ label) => {
    if (result.failure !== null || result.code !== 0) {
        throw new Error(`${label} failed: ${result.stderr?.trim() || result.failure || `exit ${result.code}`}`);
    }
    return result.stdout;
};

const canonicalJson = (/** @type {unknown} */ value) => `${JSON.stringify(value)}\n`;

/**
 * 从一个已执行 action 捕获 command result, 双向 tracked diff, status 与完整 untracked content.
 * 返回的 template 保留 mechanical facts, 只让 Main Agent 填写 judgment fields.
 */
export const captureReleaseGuestStep = async (/** @type {{action: (resolved: ReturnType<typeof prepareReleaseStep>) => Promise<unknown>, auditedDirectory: string, machineKey: string, nodeVersion: string, scenarioId: string, stepId: string, workspaceDirectory: string}} */ {
    action,
    auditedDirectory,
    machineKey,
    nodeVersion,
    scenarioId,
    stepId,
    workspaceDirectory,
}, /** @type {{fileSystem?: FileSystem, git?: ReturnType<typeof createNodeGitRunner>}} */ {
    fileSystem = defaultFileSystem,
    git = createNodeGitRunner(auditedDirectory),
} = {}) => {
    assertAbsolutePath(auditedDirectory, 'Release step audited directory', machineKey === 'Windows 11');
    if (!NODE_VERSION_PATTERN.test(nodeVersion)) throw new Error('Release step Node.js version is invalid.');
    const resolved = prepareReleaseStep({machineKey, scenarioId, stepId, workspaceDirectory});
    if (typeof action !== 'function') throw new Error('Release guest step action is unavailable.');
    const stepWorkspace = join(workspaceDirectory, 'steps', ...scenarioId.split('/'), stepId);
    await fileSystem.mkdir(stepWorkspace, {recursive: true});
    const outcome = await action(resolved);
    /** @type {CommandOutcome | undefined} */
    let commandOutcome;
    if (resolved.step.command) {
        if (!exactKeys(outcome, ['exitCode', 'stderr', 'stdout'])
            || !Number.isSafeInteger(outcome.exitCode)
            || typeof outcome.stderr !== 'string'
            || typeof outcome.stdout !== 'string') {
            throw new Error('Release command step returned an invalid child outcome.');
        }
        if (typeof outcome.exitCode !== 'number') throw new Error('Release command step returned an invalid child outcome.');
        commandOutcome = {exitCode: outcome.exitCode, stderr: outcome.stderr, stdout: outcome.stdout};
    } else if (outcome !== undefined) {
        throw new Error('Release Main Agent step must not return a command outcome.');
    }
    const [status, headToIndex, indexToWorktree] = await Promise.all([
        git.run({argv: ['status', '--porcelain=v1', '-z', '--untracked-files=all']}),
        git.run({argv: ['diff', '--cached', '--no-ext-diff', '--binary', '--full-index', 'HEAD', '--']}),
        git.run({argv: ['diff', '--no-ext-diff', '--binary', '--full-index', '--']}),
    ]);
    const statusBytes = requireGitResult(status, 'Guest Git status capture');
    const {changes, untrackedPaths} = parseReleaseGitStatus(statusBytes);
    const untracked = await inspectReleaseUntrackedEntries(auditedDirectory, untrackedPaths, fileSystem);
    const mechanical = {
        auditedDirectory: resolve(auditedDirectory),
        changes,
        machineKey,
        nodeVersion,
        reviewMaterial: {
            headToIndexDiff: requireGitResult(headToIndex, 'Guest HEAD-to-index diff capture').toString('base64'),
            indexToWorkingTreeDiff: requireGitResult(indexToWorktree, 'Guest index-to-working-tree diff capture').toString('base64'),
            nonRegularEntries: untracked.nonRegularEntries,
            status: statusBytes.toString('base64'),
            untrackedFiles: untracked.ordinaryFiles,
            ...(commandOutcome === undefined ? {} : {commandOutcome}),
        },
        scenarioId,
        stepId,
        workspaceDirectory: resolve(workspaceDirectory),
    };
    const template = {
        judgment: {
            files: changes.map(change => ({...change, matchesExpected: null, summary: null})),
            matchesExpected: null,
            summary: null,
        },
        mechanical,
        status: 'awaiting-judgment',
    };
    const templatePath = join(stepWorkspace, 'judgment-template.json');
    const reviewMaterialPath = join(stepWorkspace, 'review-material.json');
    await fileSystem.writeFile(reviewMaterialPath, canonicalJson(mechanical.reviewMaterial), {flag: 'wx'});
    await fileSystem.writeFile(templatePath, canonicalJson(template), {flag: 'wx'});
    return {changes, reviewMaterialPath, scenarioId, status: 'captured', stepId, templatePath};
};

const validateJudgment = (/** @type {{judgment: unknown, mechanical: MechanicalTemplate}} */ {judgment, mechanical}) => {
    if (!exactKeys(judgment, ['files', 'matchesExpected', 'summary'])
        || !Array.isArray(judgment.files)
        || typeof judgment.matchesExpected !== 'boolean'
        || typeof judgment.summary !== 'string'
        || judgment.summary.length === 0) {
        throw new Error('Release step judgment is incomplete.');
    }
    if (judgment.files.length !== mechanical.changes.length) throw new Error('Release step judgment path set changed.');
    for (const [index, file] of judgment.files.entries()) {
        const change = mechanical.changes[index];
        if (!exactKeys(file, ['changeType', 'matchesExpected', 'path', 'summary'])
            || file.path !== change.path
            || file.changeType !== change.changeType) {
            throw new Error('Release step judgment mechanical facts changed.');
        }
        if (typeof file.matchesExpected !== 'boolean'
            || typeof file.summary !== 'string'
            || file.summary.length === 0) {
            throw new Error('Release step file judgment is incomplete.');
        }
    }
    if (judgment.matchesExpected && judgment.files.some(file => !file.matchesExpected)) {
        throw new Error('Release step judgment does not include every file judgment.');
    }
    /** @type {ReleaseJudgment} */
    const validated = {
        files: judgment.files.map(file => ({
            changeType: file.changeType,
            matchesExpected: file.matchesExpected,
            path: file.path,
            summary: file.summary,
        })),
        matchesExpected: judgment.matchesExpected,
        summary: judgment.summary,
    };
    return validated;
};

const validateMechanicalTemplate = (/** @type {{mechanical: unknown, workspaceBoundary?: WorkspaceBoundary}} */ {mechanical, workspaceBoundary}) => {
    if (!exactKeys(mechanical, [
        'auditedDirectory',
        'changes',
        'machineKey',
        'nodeVersion',
        'reviewMaterial',
        'scenarioId',
        'stepId',
        'workspaceDirectory',
    ])
        || typeof mechanical.nodeVersion !== 'string'
        || typeof mechanical.workspaceDirectory !== 'string'
        || typeof mechanical.auditedDirectory !== 'string'
        || typeof mechanical.machineKey !== 'string'
        || typeof mechanical.scenarioId !== 'string'
        || typeof mechanical.stepId !== 'string'
        || !NODE_VERSION_PATTERN.test(mechanical.nodeVersion)) {
        throw new Error('Release step template contains invalid mechanical facts.');
    }
    requireWorkspaceBoundary(workspaceBoundary)(mechanical.workspaceDirectory, 'Release validation workspace');
    const validated = validateCapturedGuestStep({
        captured: {
            auditedDirectory: mechanical.auditedDirectory,
            changes: mechanical.changes,
            machineKey: mechanical.machineKey,
            reviewMaterial: mechanical.reviewMaterial,
            scenarioId: mechanical.scenarioId,
            status: 'captured',
            stepId: mechanical.stepId,
        },
        machineKey: mechanical.machineKey,
        scenarioId: mechanical.scenarioId,
        stepId: mechanical.stepId,
    });
    if (mechanical.auditedDirectory !== expectedGuestAuditedDirectory({
        machineKey: mechanical.machineKey,
        runId: basename(dirname(mechanical.workspaceDirectory)) === 'runs' && UUID_PATTERN.test(basename(mechanical.workspaceDirectory))
            ? basename(mechanical.workspaceDirectory)
            : null,
        scenarioId: mechanical.scenarioId,
        step: validated.step,
    })) {
        throw new Error('Release step template contains an unexpected audited directory.');
    }
    /** @type {MechanicalTemplate} */
    const validatedMechanical = {
        auditedDirectory: validated.captured.auditedDirectory,
        changes: validated.captured.changes,
        machineKey: validated.captured.machineKey,
        nodeVersion: mechanical.nodeVersion,
        reviewMaterial: validated.captured.reviewMaterial,
        scenarioId: validated.captured.scenarioId,
        stepId: validated.captured.stepId,
        workspaceDirectory: mechanical.workspaceDirectory,
    };
    return {...validated, mechanical: validatedMechanical};
};

const parseJsonFile = async (/** @type {string} */ path, /** @type {string} */ label, /** @type {FileSystem} */ fileSystem) => {
    /** @type {unknown} */
    let value;
    try {
        value = JSON.parse(await fileSystem.readFile(path, 'utf8'));
    } catch {
        throw new Error(`${label} is not valid JSON.`);
    }
    return value;
};

/**
 * 重新验证 template 与 submitted judgment 的闭合 schema 和 mechanical facts, 再原子写入 formal step result.
 * `createFinalArchive` 只控制最后一个 scenario step 是否建立和验证 final archive;
 * 设为 false 时仍提交 step validation 并推进 audited Repository 的 Git index baseline.
 * Final archive 只在全部登记 step validation 都通过时创建, 并可通过 `verifyArchiveBytes` 绑定另一份 archive bytes.
 * Success 返回 finalized step identity, validation path 和可选 archive result.
 * Template drift, invalid judgment, partial archive, verification 或 baseline update failure 会 reject,
 * 并删除本次已提交的 step directory, summary 和 archive, 不推进 partial finalization.
 */
export const finalizeReleaseGuestStep = async (/** @type {{judgmentPath: string, templatePath: string}} */ {judgmentPath, templatePath}, /** @type {{baselineUpdater?: (mechanical: MechanicalTemplate) => Promise<void>, createArchive?: typeof createReleaseEvidenceArchive, createFinalArchive?: boolean, fileSystem?: FileSystem, gitFactory?: typeof createNodeGitRunner, verifyArchiveBytes?: (input: {archive: unknown, archivePath: string, mechanical: MechanicalTemplate, sourceDirectory: string}) => Promise<void>, workspaceBoundary?: WorkspaceBoundary}} */ {
    baselineUpdater,
    createArchive = createReleaseEvidenceArchive,
    createFinalArchive = true,
    fileSystem = defaultFileSystem,
    gitFactory = createNodeGitRunner,
    verifyArchiveBytes,
    workspaceBoundary,
} = {}) => {
    assertAbsolutePath(templatePath, 'Release step template path');
    assertAbsolutePath(judgmentPath, 'Release step judgment path');
    workspaceBoundary = requireWorkspaceBoundary(workspaceBoundary);
    workspaceBoundary(templatePath, 'Release step template path');
    workspaceBoundary(judgmentPath, 'Release step judgment path');
    const [template, submitted] = await Promise.all([
        parseJsonFile(templatePath, 'Release step template', fileSystem),
        parseJsonFile(judgmentPath, 'Release step judgment', fileSystem),
    ]);
    if (!exactKeys(template, ['judgment', 'mechanical', 'status'])
        || !exactKeys(submitted, ['judgment', 'mechanical', 'status'])
        || template.status !== 'awaiting-judgment'
        || submitted?.status !== 'awaiting-judgment'
        || JSON.stringify(submitted.mechanical) !== JSON.stringify(template.mechanical)) {
        throw new Error('Release step mechanical facts changed.');
    }
    const validated = validateMechanicalTemplate({mechanical: template.mechanical, workspaceBoundary});
    const {mechanical} = validated;
    if (!pathInside(mechanical.workspaceDirectory, templatePath)
        || !pathInside(mechanical.workspaceDirectory, judgmentPath)) {
        throw new Error('Release step template is not bound to its workspace.');
    }
    const {scenario, step} = validated;
    const judgment = validateJudgment({judgment: submitted.judgment, mechanical});
    const commandOutcome = mechanical.reviewMaterial.commandOutcome;
    if (step.command && commandOutcome === undefined) {
        throw new Error('Release step template is missing its command outcome.');
    }
    const finalValidation = {
        ...(step.command && commandOutcome !== undefined ? {exitCode: commandOutcome.exitCode} : {}),
        files: judgment.files,
        matchesExpected: judgment.matchesExpected,
        summary: judgment.summary,
    };
    const finalDirectory = join(mechanical.workspaceDirectory, 'archive-source', ...scenario.archiveKind.split('/'), 'steps', step.stepId);
    const temporaryDirectory = `${finalDirectory}.temporary`;
    await fileSystem.mkdir(dirname(finalDirectory), {recursive: true});
    await fileSystem.mkdir(temporaryDirectory, {recursive: false});
    let committedDirectory = false;
    let archive;
    let archivePath;
    let summaryPath;
    try {
        await fileSystem.writeFile(join(temporaryDirectory, 'validation.json'), canonicalJson(finalValidation), {flag: 'wx'});
        if (step.command && commandOutcome !== undefined) {
            await fileSystem.writeFile(join(temporaryDirectory, 'stdout.txt'), commandOutcome.stdout, {flag: 'wx'});
            await fileSystem.writeFile(join(temporaryDirectory, 'stderr.txt'), commandOutcome.stderr, {flag: 'wx'});
        }
        await renameDirectoryWithRetry(fileSystem, temporaryDirectory, finalDirectory);
        committedDirectory = true;
        if (createFinalArchive && step.index === scenario.steps.length - 1) {
            const sourceDirectory = join(mechanical.workspaceDirectory, 'archive-source', ...scenario.archiveKind.split('/'));
            const validations = await Promise.all(scenario.steps.map(async (/** @type {{ stepId: string; }} */ registeredStep) => parseJsonFile(
                join(sourceDirectory, 'steps', registeredStep.stepId, 'validation.json'),
                `Release step ${registeredStep.stepId}`,
                fileSystem,
            )));
            if (validations.every(validation => isJsonObject(validation) && validation.matchesExpected === true)) {
                summaryPath = join(sourceDirectory, 'summary.json');
                await fileSystem.writeFile(summaryPath, canonicalJson({
                    matchesExpected: true,
                    steps: scenario.steps.map(registeredStep => registeredStep.stepId),
                    summary: 'Every recorded step matches the release expectation.',
                }), {flag: 'wx'});
                archivePath = scenario.archiveKind === 'post-tag'
                    ? join(mechanical.workspaceDirectory, 'archives', 'post-tag.tar')
                    : join(mechanical.workspaceDirectory, 'archives', ...scenario.archiveKind.split('/')) + '.tar';
                archive = await createArchive({archiveKind: scenario.archiveKind, outputPath: archivePath, sourceDirectory});
                if (verifyArchiveBytes !== undefined) {
                    await verifyArchiveBytes({archive, archivePath, mechanical, sourceDirectory});
                }
            }
        }
        if (baselineUpdater === undefined) {
            requireGitResult(await gitFactory(mechanical.auditedDirectory).run({argv: ['add', '-A']}), 'Guest Git baseline update');
        } else {
            await baselineUpdater(mechanical);
        }
    } catch (error) {
        if (archive !== undefined && archivePath !== undefined) await fileSystem.rm(archivePath, {force: true});
        if (summaryPath !== undefined) await fileSystem.rm(summaryPath, {force: true});
        await fileSystem.rm(committedDirectory ? finalDirectory : temporaryDirectory, {force: true, recursive: true});
        throw error;
    }
    return {
        ...(archive === undefined ? {} : {archive}),
        scenarioId: scenario.archiveKind,
        status: 'finalized',
        stepId: step.stepId,
        validationPath: join(finalDirectory, 'validation.json'),
    };
};

/**
 * 在 guest 由同一 formal source directory 重建 canonical archive, 传回 host 并比较 SHA-256.
 * Comparison files 只存在于 current session temporary workspace; mismatch 或任一 transfer 和 guest command failure 关闭式失败.
 */
export const compareReleaseGuestArchive = async (/** @type {{archivePath: string, configuration: VmConfiguration, guestAdapter: GuestAdapter, fileSystem?: FileSystem, mechanical: MechanicalTemplate, sourceDirectory: string}} */ {
    archivePath,
    configuration,
    guestAdapter,
    fileSystem = defaultFileSystem,
    mechanical,
    sourceDirectory,
}) => {
    const machine = configuration?.machines?.[mechanical.machineKey];
    if (machine === undefined) throw new Error('Release VM configuration does not contain the finalized machine.');
    const guestWorkspace = typeof mechanical.auditedDirectory === 'string'
        ? mechanical.machineKey === 'Windows 11'
            ? win32.dirname(mechanical.auditedDirectory)
            : dirname(mechanical.auditedDirectory)
        : releaseGuestWorkspace(mechanical.machineKey, mechanical.scenarioId);
    const comparisonRoot = releaseGuestPath(mechanical.machineKey, guestWorkspace, 'archive-comparison');
    const guestSourceDirectory = releaseGuestPath(mechanical.machineKey, comparisonRoot, basename(sourceDirectory));
    const guestArchivePath = releaseGuestPath(mechanical.machineKey, comparisonRoot, 'archive.tar');
    const registeredScenario = resolveReleaseValidationScenario(mechanical.scenarioId);
    const nodeExecutable = machine.nodeExecutables[resolveReleaseValidationRuntimeRole(registeredScenario)];
    if (nodeExecutable === undefined) throw new Error('Release guest Node.js runtime is unavailable.');
    const reset = requireGuestProcessResult(await guestAdapter.run({
        machine,
        machineKey: mechanical.machineKey,
        remoteArguments: [
            nodeExecutable,
            '-e',
            `import('node:fs/promises').then(async fs=>{await fs.rm(${JSON.stringify(comparisonRoot)},{force:true,recursive:true});await fs.mkdir(${JSON.stringify(comparisonRoot)},{recursive:true})})`,
        ],
        workspaceDirectory: mechanical.workspaceDirectory,
    }));
    if (reset.exitCode !== 0) throw new Error(`Guest archive comparison preparation failed: ${reset.stderr.trim() || `exit ${reset.exitCode}`}`);
    await guestAdapter.copyDirectoryToGuest({
        guestPath: comparisonRoot,
        hostPath: sourceDirectory,
        machine,
        machineKey: mechanical.machineKey,
        workspaceDirectory: mechanical.workspaceDirectory,
    });
    const create = requireGuestProcessResult(await guestAdapter.run({
        machine,
        machineKey: mechanical.machineKey,
        remoteArguments: [
            nodeExecutable,
            releaseGuestPath(mechanical.machineKey, guestWorkspace, 'source/scripts/create-release-evidence-archive.mjs'),
            '--source', guestSourceDirectory,
            '--output', guestArchivePath,
            '--archive-kind', mechanical.scenarioId,
        ],
        workspaceDirectory: mechanical.workspaceDirectory,
    }));
    if (create.exitCode !== 0) throw new Error(`Guest archive creation failed: ${create.stderr.trim() || `exit ${create.exitCode}`}`);
    const guestComparisonPath = `${archivePath}.guest-comparison`;
    try {
        await guestAdapter.copyFromGuest({
            guestPath: guestArchivePath,
            hostPath: guestComparisonPath,
            machine,
            machineKey: mechanical.machineKey,
            workspaceDirectory: mechanical.workspaceDirectory,
        });
        const [hostBytes, guestBytes] = await Promise.all([
            fileSystem.readFile(archivePath),
            fileSystem.readFile(guestComparisonPath),
        ]);
        const digest = (/** @type {import("crypto").BinaryLike | NonSharedBuffer} */ bytes) => createHash('sha256').update(bytes).digest('hex');
        if (digest(hostBytes) !== digest(guestBytes)) {
            throw new Error('Guest and host release evidence archive SHA-256 values differ.');
        }
    } finally {
        await fileSystem.rm(guestComparisonPath, {force: true});
    }
};

/**
 * 使用准确 template machine 在 guest 内推进 baseline, 并复用 `finalizeReleaseGuestStep` 的全部验证和 archive commit behavior.
 * Caller 必须提供绑定当前 Platform Adapter session 的 workspace boundary 和包含 template machine 的 configuration.
 * `createFinalArchive` 原样控制最后一步是否建立 final archive. Archive 创建时, Interface 在 guest 从同一 source directory
 * 重建 archive, 传回 host 并比较 SHA-256; 设为 false 时跳过该 archive 创建与 guest comparison, 但仍完成 step 和 guest Git baseline.
 * Guest baseline, archive transfer, byte comparison 或底层 finalization failure 会 reject, 不返回 partial success.
 */
export const finalizeReleaseVmGuestStep = async (/** @type {{configuration: VmConfiguration, judgmentPath: string, templatePath: string}} */ {configuration, judgmentPath, templatePath}, /** @type {{createFinalArchive?: boolean, fileSystem?: FileSystem, guestAdapter?: GuestAdapter, workspaceBoundary?: WorkspaceBoundary}} */ {
    createFinalArchive = true,
    fileSystem = defaultFileSystem,
    guestAdapter = createReleaseVmwareGuestAdapter(),
    workspaceBoundary,
} = {}) => {
    workspaceBoundary = requireWorkspaceBoundary(workspaceBoundary);
    workspaceBoundary(templatePath, 'Release step template path');
    workspaceBoundary(judgmentPath, 'Release step judgment path');
    return finalizeReleaseGuestStep({judgmentPath, templatePath}, {
        createFinalArchive,
        fileSystem,
        workspaceBoundary,
        verifyArchiveBytes: (/** @type {{archive: unknown, archivePath: string, mechanical: MechanicalTemplate, sourceDirectory: string}} */ request) => compareReleaseGuestArchive({
            ...request,
            configuration,
            guestAdapter,
            fileSystem,
        }),
        baselineUpdater: async (/** @type {MechanicalTemplate} */ mechanical) => {
            const machine = configuration?.machines?.[mechanical.machineKey];
            if (machine === undefined) throw new Error('Release VM configuration does not contain the finalized machine.');
            const result = requireGuestProcessResult(await guestAdapter.run({
                machine,
                machineKey: mechanical.machineKey,
                remoteArguments: ['git', '-C', mechanical.auditedDirectory, 'add', '-A'],
                workspaceDirectory: mechanical.workspaceDirectory,
            }));
            if (result.exitCode !== 0) {
                throw new Error(`Guest Git baseline update failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
            }
        },
    });
};
