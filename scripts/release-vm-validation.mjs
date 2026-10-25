#!/usr/bin/env node

import {lstat, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

import {
    createReleaseHostProcessAdapter,
    completeReleasePostInitChoice,
    createReleasePostInitChoiceHandoff,
    createReleaseSessionWorkspaceBoundary,
    createReleaseVmwareGuestAdapter,
    finalizeReleaseVmGuestStep,
    loadReleaseVmConfiguration,
    loadReleaseValidationInputs,
    parseReleasePostInitChoiceState,
    prepareReleaseValidationBundles,
    releaseValidationOperationError,
    releasePostInitAllowsLocalTag,
    resolveReleasePostInitChoice,
    resumeReleaseValidationRun,
    runReleaseVmGuestStep,
    startReleaseValidationRun,
} from '../lib/release/release-vm-validation.mjs';
import {RELEASE_MACHINE_KEYS, resolveReleaseValidationScenario} from '../lib/release/release-validation-registry.mjs';
import {createCurrentPlatformAdapter} from '../lib/arw-common/platform-adapter.mjs';
import {discoverRepository} from '../lib/arw-common/repository.mjs';

const usage = 'Usage:\n'
    + '  node scripts/release-vm-validation.mjs run --config <absolute-json-path> --candidate <full-object-id> --workspace <absolute-session-workspace>\n'
    + '  node scripts/release-vm-validation.mjs resume --run <absolute-run-path> [--input <absolute-response-path>]\n'
    + '  node scripts/release-vm-validation.mjs post-init-choose --candidate <full-object-id> --choice <run|skip> --pre-tag-result <absolute-json-path> --state <absolute-json-path> [--config <absolute-json-path> --workspace <absolute-session-workspace>]\n'
    + '  node scripts/release-vm-validation.mjs post-init-resume --candidate <full-object-id> --state <absolute-json-path> [--input <absolute-response-path>]\n'
    + '  node scripts/release-vm-validation.mjs post-init-status --candidate <full-object-id> --state <absolute-json-path>\n'
    + '  node scripts/release-vm-validation.mjs validate-config --config <absolute-json-path>\n'
    + '  node scripts/release-vm-validation.mjs prepare-bundles --candidate <commit> --workspace <absolute-directory> --sources <absolute-json-path>\n'
    + '  node scripts/release-vm-validation.mjs copy-to-guest --config <absolute-json-path> --machine <machine-key> --workspace <absolute-session-workspace> --host-path <absolute-file-path> --guest-path <absolute-guest-path>\n'
    + '  node scripts/release-vm-validation.mjs copy-from-guest --config <absolute-json-path> --machine <machine-key> --workspace <absolute-session-workspace> --host-path <absolute-file-path> --guest-path <absolute-guest-path>\n'
    + '  node scripts/release-vm-validation.mjs run-step --config <absolute-json-path> --machine <machine-key> --scenario <scenario-id> --step <step-id> --workspace <absolute-directory>\n'
    + '  node scripts/release-vm-validation.mjs finalize-step --config <absolute-json-path> --template <absolute-json-path> --judgment <absolute-json-path>\n';

/** @typedef {(value: string, label?: string) => unknown} WorkspaceBoundary */
/** @typedef {{write: (value: string) => unknown}} TextOutput */
/** @typedef {Parameters<ReturnType<typeof createReleaseVmwareGuestAdapter>['copyToGuest']>[0]['machine']} VmMachine */
/**
 * @typedef {object} ReleaseVmCliOperations
 * @property {TextOutput} [output]
 * @property {TextOutput} [errorOutput]
 * @property {WorkspaceBoundary} [validateWorkspacePath]
 * @property {typeof discoverRepository} [discoverRepository]
 * @property {ReturnType<typeof createCurrentPlatformAdapter>} [platformAdapter]
 * @property {typeof loadReleaseValidationInputs} [loadInputs]
 * @property {typeof loadReleaseVmConfiguration} [loadConfiguration]
 * @property {typeof startReleaseValidationRun} [startRun]
 * @property {typeof resumeReleaseValidationRun} [resumeRun]
 * @property {(request: Parameters<typeof prepareReleaseValidationBundles>[0]) => ReturnType<typeof prepareReleaseValidationBundles>} [prepareBundles]
 * @property {typeof runReleaseVmGuestStep} [runStep]
 * @property {typeof finalizeReleaseVmGuestStep} [finalizeStep]
 * @property {ReturnType<typeof createReleaseVmwareGuestAdapter>} [guestAdapter]
 * @property {typeof assertOrdinaryHostFile} [assertOrdinaryHostFile]
 */

/**
 * @template {string} Name
 * @param {Partial<Record<string, string>>} options
 * @param {readonly Name[]} names
 * @returns {asserts options is Partial<Record<string, string>> & Record<Name, string>}
 */
function assertRequiredOptions(options, names) {
    if (names.some(name => !Object.hasOwn(options, name))) throw new Error('usage');
}

/**
 * @template {string} RequiredName
 * @param {string[]} args
 * @param {readonly RequiredName[]} names
 * @param {readonly string[]} [optionalNames]
 * @returns {Record<RequiredName, string> & Partial<Record<string, string>>}
 */
const parseOptions = (args, names, optionalNames = []) => {
    const allowedNames = new Set([...names, ...optionalNames]);
    if (args.length % 2 !== 0 || args.length < names.length * 2 || args.length > allowedNames.size * 2) throw new Error('usage');
    /** @type {Partial<Record<string, string>>} */
    const result = {};
    for (let index = 0; index < args.length; index += 2) {
        const name = args[index];
        const value = args[index + 1];
        if (!allowedNames.has(name) || value === undefined || value.length === 0 || Object.hasOwn(result, name)) {
            throw new Error('usage');
        }
        result[name] = value;
    }
    assertRequiredOptions(result, names);
    return result;
};

const requireAbsolute = (/** @type {string[]} */ ...values) => {
    if (values.some(value => !isAbsolute(value))) throw new Error('usage');
};

const requireGuestAbsolute = (/** @type {string} */ machineKey, /** @type {string} */ value) => {
    const valid = machineKey === 'Windows 11' ? /^[A-Za-z]:[\\/]/u.test(value) : value.startsWith('/');
    if (!valid) throw new Error('usage');
};

const requireConfiguredMachine = (/** @type {{ machines: Record<string, VmMachine>; }} */ configuration, /** @type {string} */ machineKey) => {
    if (!RELEASE_MACHINE_KEYS.includes(machineKey) || !Object.hasOwn(configuration.machines, machineKey)) {
        throw new Error('usage');
    }
    return configuration.machines[machineKey];
};

const assertOrdinaryHostFile = async (/** @type {string} */ path) => {
    const status = await lstat(path);
    if (!status.isFile() || status.isSymbolicLink()) throw new Error('Release guest copy host path must be an ordinary file.');
};

const isOperationError = (/** @type {unknown} */ value) => value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'code,message,runPath,stage'
    && 'code' in value
    && 'message' in value
    && 'runPath' in value
    && 'stage' in value
    && typeof value.code === 'string'
    && typeof value.message === 'string'
    && (value.runPath === null || typeof value.runPath === 'string')
    && typeof value.stage === 'string';

const readJsonFile = async (/** @type {string} */ path) => JSON.parse(await readFile(path, 'utf8'));
const postInitEvidenceBytes = (/** @type {unknown} */ value) => `${JSON.stringify(value)}\n`;
const writePostInitEvidence = async (/** @type {{exclusive?: boolean, path: string, value: unknown}} */ {exclusive = false, path, value}) => {
    if (exclusive) {
        await writeFile(path, postInitEvidenceBytes(value), {encoding: 'utf8', flag: 'wx'});
        return;
    }
    const temporaryPath = `${path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, postInitEvidenceBytes(value), {encoding: 'utf8', flag: 'wx'});
    await rename(temporaryPath, path);
};

/** @typedef {{candidateCommit: string, choiceState: {candidateCommit: string, choices: readonly string[], decision: 'run' | 'skip' | null, scenarioId: string, status: 'blocked' | 'passed' | 'pending' | 'running' | 'skipped'}, resultPath: string | null, runPath: string | null, schemaVersion: 1, status: string, tagAllowed: boolean}} PostInitEvidence */
/** @returns {PostInitEvidence} */
const validatePostInitEvidence = (/** @type {unknown} */ value, /** @type {string} */ candidateCommit) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== 'candidateCommit,choiceState,resultPath,runPath,schemaVersion,status,tagAllowed'
        || !('candidateCommit' in value) || value.candidateCommit !== candidateCommit
        || !('choiceState' in value) || !('runPath' in value) || !('resultPath' in value)
        || !('schemaVersion' in value) || value.schemaVersion !== 1
        || !('status' in value) || !['blocked', 'passed', 'running', 'skipped'].includes(String(value.status))
        || !('tagAllowed' in value) || typeof value.tagAllowed !== 'boolean') throw new Error('Release post-init state is invalid.');
    const evidence = /** @type {PostInitEvidence} */ (value);
    let choice;
    try {
        choice = parseReleasePostInitChoiceState(evidence.choiceState);
    } catch {
        throw new Error('Release post-init state is invalid.');
    }
    const validPaths = (evidence.runPath === null || typeof evidence.runPath === 'string')
        && (evidence.resultPath === null || typeof evidence.resultPath === 'string');
    const validTerminal = evidence.status === 'skipped'
        ? choice?.status === 'skipped' && choice.decision === 'skip'
            && evidence.runPath === null && evidence.resultPath === null && evidence.tagAllowed
        : evidence.status === 'running'
            ? choice?.status === 'running' && choice.decision === 'run'
                && evidence.resultPath === null && !evidence.tagAllowed
            : evidence.status === 'blocked'
                ? choice?.status === 'blocked' && choice.decision === 'run' && !evidence.tagAllowed
                : choice?.status === 'passed' && choice.decision === 'run'
                    && typeof evidence.runPath === 'string' && typeof evidence.resultPath === 'string' && evidence.tagAllowed;
    if (!validPaths || choice?.candidateCommit !== candidateCommit || !validTerminal
        || releasePostInitAllowsLocalTag(choice) !== evidence.tagAllowed) {
        throw new Error('Release post-init state is invalid.');
    }
    return evidence;
};

/** @returns {PostInitEvidence} */
const evidenceFromChoice = (/** @type {{resultPath?: string | null, runPath?: string | null, state: PostInitEvidence['choiceState']}} */ {resultPath = null, runPath = null, state}) => ({
    candidateCommit: state.candidateCommit,
    choiceState: state,
    resultPath,
    runPath,
    schemaVersion: /** @type {const} */ (1),
    status: state.status,
    tagAllowed: releasePostInitAllowsLocalTag(state),
});

const finishPostInitRunnerResult = async (/** @type {{evidence: ReturnType<typeof validatePostInitEvidence>, result: unknown, statePath: string, workspaceBoundary: WorkspaceBoundary}} */ {evidence, result, statePath, workspaceBoundary}) => {
    if (result === null || typeof result !== 'object' || Array.isArray(result)
        || !('status' in result) || !('runPath' in result) || typeof result.runPath !== 'string') {
        throw new Error('Release post-init Runner result is invalid.');
    }
    if (result.status === 'paused') {
        workspaceBoundary(result.runPath, 'Release post-init run state');
        const next = {...evidence, runPath: result.runPath};
        await writePostInitEvidence({path: statePath, value: next});
        return next;
    }
    if (result.status !== 'completed' || !('resultPath' in result) || typeof result.resultPath !== 'string') {
        throw new Error('Release post-init Runner result is invalid.');
    }
    workspaceBoundary(result.runPath, 'Release post-init run state');
    workspaceBoundary(result.resultPath, 'Release post-init result');
    const completeResult = await readJsonFile(result.resultPath);
    const scenario = resolveReleaseValidationScenario(evidence.choiceState.scenarioId);
    const expectedSteps = scenario.steps.map(step => step.stepId);
    const archive = completeResult?.archives?.find?.((/** @type {{archiveKind?: unknown}} */ item) => item?.archiveKind === evidence.choiceState.scenarioId);
    const resultScenario = completeResult?.scenarios?.[0];
    const cleanup = completeResult?.cleanup?.[0];
    const passed = completeResult?.candidateCommit === evidence.candidateCommit
        && completeResult?.status === 'completed'
        && Array.isArray(completeResult?.archives) && completeResult.archives.length === 1
        && archive?.status === 'created'
        && Array.isArray(completeResult?.scenarios) && completeResult.scenarios.length === 1
        && resultScenario?.scenarioId === evidence.choiceState.scenarioId
        && resultScenario?.archive?.archiveKind === evidence.choiceState.scenarioId
        && Array.isArray(resultScenario?.steps)
        && JSON.stringify(resultScenario.steps.map((/** @type {{stepId?: unknown}} */ step) => step?.stepId)) === JSON.stringify(expectedSteps)
        && resultScenario.steps.every((/** @type {{classification?: unknown, outcome?: unknown}} */ step) => step?.classification === 'formal' && step?.outcome === 'passed')
        && Array.isArray(completeResult?.cleanup) && completeResult.cleanup.length === 1
        && cleanup?.scenarioId === evidence.choiceState.scenarioId
        && cleanup?.outcome === 'passed';
    const choiceState = completeReleasePostInitChoice({archive, outcome: passed ? 'passed' : 'failed', state: evidence.choiceState});
    const next = evidenceFromChoice({resultPath: result.resultPath, runPath: result.runPath, state: choiceState});
    await writePostInitEvidence({path: statePath, value: next});
    return next;
};

/**
 * 解析并执行一个闭合 release VM maintenance operation.
 * Guest copy commands 使用具名 host and guest paths, 并只把已验证的请求交给 Guest Adapter.
 * Success 只向 stdout 写一行 JSON 并返回 0; operational failure 写 stderr 并返回 1; usage failure 返回 2.
 */
export const runReleaseVmValidationCli = async (/** @type {string[]} */ args, /** @type {ReleaseVmCliOperations} */ operations = {}) => {
    const output = operations.output ?? process.stdout;
    const errorOutput = operations.errorOutput ?? process.stderr;
    const operation = args[0];
    /** @type {WorkspaceBoundary | undefined} */
    let resolvedWorkspaceBoundary;
    const getWorkspaceBoundary = async () => {
        if (resolvedWorkspaceBoundary !== undefined) return resolvedWorkspaceBoundary;
        if (operations.validateWorkspacePath !== undefined) {
            resolvedWorkspaceBoundary = operations.validateWorkspacePath;
            return resolvedWorkspaceBoundary;
        }
        const repository = await (operations.discoverRepository ?? discoverRepository)();
        const agentIdentity = (operations.platformAdapter ?? createCurrentPlatformAdapter()).getCurrentAgentIdentity();
        resolvedWorkspaceBoundary = createReleaseSessionWorkspaceBoundary({agentIdentity, repositoryRoot: repository.root});
        return resolvedWorkspaceBoundary;
    };
    /**
     * @template T
     * @param {string} code
     * @param {() => Promise<T> | T} action
     * @returns {Promise<T>}
     */
    const mapGuestCopyFailure = async (code, action) => {
        try {
            return await action();
        } catch {
            throw releaseValidationOperationError(code);
        }
    };
    const loadConfigurations = (/** @type {string} */ configurationPath) => (operations.loadInputs ?? loadReleaseValidationInputs)(
        {configurationPath},
        {loadConfiguration: operations.loadConfiguration ?? loadReleaseVmConfiguration},
    );
    const resolveGuestCopyRequest = async () => {
        const options = parseOptions(args.slice(1), [
            '--config', '--guest-path', '--host-path', '--machine', '--workspace',
        ]);
        requireAbsolute(options['--config'], options['--host-path'], options['--workspace']);
        requireGuestAbsolute(options['--machine'], options['--guest-path']);
        const validateWorkspacePath = await mapGuestCopyFailure('identity-invalid', getWorkspaceBoundary);
        await mapGuestCopyFailure('workspace-invalid', () => {
            validateWorkspacePath(options['--workspace'], 'Release validation workspace');
            validateWorkspacePath(options['--host-path'], 'Release guest copy host path');
        });
        const inputs = await mapGuestCopyFailure(
            'configuration-invalid',
            () => loadConfigurations(options['--config']),
        );
        return {
            hostPath: options['--host-path'],
            request: {
                guestPath: options['--guest-path'],
                machine: requireConfiguredMachine(inputs.vmConfiguration, options['--machine']),
                machineKey: options['--machine'],
                workspaceDirectory: options['--workspace'],
            },
        };
    };
    try {
        let result;
        if (operation === 'run') {
            const options = parseOptions(args.slice(1), ['--candidate', '--config', '--workspace']);
            requireAbsolute(options['--config'], options['--workspace']);
            const startRun = operations.startRun ?? (async request => {
                const workspaceBoundary = await getWorkspaceBoundary();
                const processAdapter = createReleaseHostProcessAdapter();
                return startReleaseValidationRun(request, {
                    guestAdapter: createReleaseVmwareGuestAdapter({processAdapter}),
                    processAdapter,
                    workspaceBoundary,
                });
            });
            result = await startRun({
                candidateCommit: options['--candidate'],
                configurationPath: options['--config'],
                workspaceDirectory: options['--workspace'],
            });
        } else if (operation === 'resume') {
            const options = parseOptions(args.slice(1), ['--run'], ['--input']);
            requireAbsolute(options['--run'], ...(options['--input'] === undefined ? [] : [options['--input']]));
            const resumeRun = operations.resumeRun ?? (async request => {
                const workspaceBoundary = await getWorkspaceBoundary();
                const processAdapter = createReleaseHostProcessAdapter();
                return resumeReleaseValidationRun(request, {
                    guestAdapter: createReleaseVmwareGuestAdapter({processAdapter}),
                    processAdapter,
                    workspaceBoundary,
                });
            });
            result = await resumeRun({
                responsePath: options['--input'] ?? null,
                runPath: options['--run'],
            });
        } else if (operation === 'post-init-choose') {
            const options = parseOptions(args.slice(1), [
                '--candidate', '--choice', '--pre-tag-result', '--state',
            ], ['--config', '--workspace']);
            requireAbsolute(options['--pre-tag-result'], options['--state']);
            if (options['--choice'] === 'run') {
                if (options['--config'] === undefined || options['--workspace'] === undefined) throw new Error('usage');
                requireAbsolute(options['--config'], options['--workspace']);
            }
            const workspaceBoundary = await getWorkspaceBoundary();
            workspaceBoundary(options['--pre-tag-result'], 'Release pre-tag result');
            workspaceBoundary(options['--state'], 'Release post-init state');
            if (options['--workspace'] !== undefined) workspaceBoundary(options['--workspace'], 'Release validation workspace');
            const preTagResult = await readJsonFile(options['--pre-tag-result']);
            const pending = createReleasePostInitChoiceHandoff({
                candidateCommit: options['--candidate'],
                preTagResult,
            });
            const choiceState = /** @type {PostInitEvidence['choiceState']} */ (resolveReleasePostInitChoice({
                choice: options['--choice'],
                state: pending,
            }));
            let evidence = evidenceFromChoice({state: choiceState});
            await writePostInitEvidence({exclusive: true, path: options['--state'], value: evidence});
            if (options['--choice'] === 'run') {
                const configurationPath = options['--config'];
                const workspaceDirectory = options['--workspace'];
                if (configurationPath === undefined || workspaceDirectory === undefined) throw new Error('usage');
                const startRun = operations.startRun ?? (async request => {
                    const workspaceBoundary = await getWorkspaceBoundary();
                    const processAdapter = createReleaseHostProcessAdapter();
                    return startReleaseValidationRun(request, {
                        guestAdapter: createReleaseVmwareGuestAdapter({processAdapter}),
                        processAdapter,
                        workspaceBoundary,
                    });
                });
                try {
                    const runResult = await startRun({
                        candidateCommit: options['--candidate'],
                        configurationPath,
                        postInitChoiceState: choiceState,
                        workspaceDirectory,
                    });
                    evidence = await finishPostInitRunnerResult({evidence, result: runResult, statePath: options['--state'], workspaceBoundary});
                } catch (error) {
                    const blocked = completeReleasePostInitChoice({outcome: 'failed', state: choiceState});
                    await writePostInitEvidence({path: options['--state'], value: evidenceFromChoice({state: blocked})});
                    throw error;
                }
            }
            result = evidence;
        } else if (operation === 'post-init-resume') {
            const options = parseOptions(args.slice(1), ['--candidate', '--state'], ['--input']);
            requireAbsolute(options['--state'], ...(options['--input'] === undefined ? [] : [options['--input']]));
            const workspaceBoundary = await getWorkspaceBoundary();
            workspaceBoundary(options['--state'], 'Release post-init state');
            if (options['--input'] !== undefined) workspaceBoundary(options['--input'], 'Release post-init response');
            const evidence = validatePostInitEvidence(await readJsonFile(options['--state']), options['--candidate']);
            if (evidence.status !== 'running' || typeof evidence.runPath !== 'string') {
                throw new Error('Release post-init state cannot be resumed.');
            }
            workspaceBoundary(evidence.runPath, 'Release post-init run state');
            const resumeRun = operations.resumeRun ?? (async request => {
                const workspaceBoundary = await getWorkspaceBoundary();
                const processAdapter = createReleaseHostProcessAdapter();
                return resumeReleaseValidationRun(request, {
                    guestAdapter: createReleaseVmwareGuestAdapter({processAdapter}),
                    processAdapter,
                    workspaceBoundary,
                });
            });
            try {
                result = await finishPostInitRunnerResult({
                    evidence,
                    result: await resumeRun({responsePath: options['--input'] ?? null, runPath: evidence.runPath}),
                    statePath: options['--state'],
                    workspaceBoundary,
                });
            } catch (error) {
                const blocked = completeReleasePostInitChoice({outcome: 'failed', state: evidence.choiceState});
                await writePostInitEvidence({path: options['--state'], value: evidenceFromChoice({state: blocked})});
                throw error;
            }
        } else if (operation === 'post-init-status') {
            const options = parseOptions(args.slice(1), ['--candidate', '--state']);
            requireAbsolute(options['--state']);
            const workspaceBoundary = await getWorkspaceBoundary();
            workspaceBoundary(options['--state'], 'Release post-init state');
            result = validatePostInitEvidence(await readJsonFile(options['--state']), options['--candidate']);
            if (result.runPath !== null) workspaceBoundary(result.runPath, 'Release post-init run state');
            if (result.resultPath !== null) workspaceBoundary(result.resultPath, 'Release post-init result');
        } else if (operation === 'validate-config') {
            const options = parseOptions(args.slice(1), ['--config']);
            requireAbsolute(options['--config']);
            const inputs = await loadConfigurations(options['--config']);
            result = {
                machineKeys: RELEASE_MACHINE_KEYS.filter(key => Object.hasOwn(inputs.vmConfiguration.machines, key)),
                maxParallelMachines: inputs.vmConfiguration.maxParallelMachines,
                status: 'valid',
            };
        } else if (operation === 'prepare-bundles') {
            const options = parseOptions(args.slice(1), ['--candidate', '--workspace', '--sources']);
            requireAbsolute(options['--workspace'], options['--sources']);
            const validateWorkspacePath = await getWorkspaceBoundary();
            validateWorkspacePath(options['--workspace'], 'Release validation workspace');
            const prepareBundles = operations.prepareBundles
                ?? (request => prepareReleaseValidationBundles(request, undefined, validateWorkspacePath));
            result = await prepareBundles({
                candidateCommit: options['--candidate'],
                sourcesConfigurationPath: options['--sources'],
                workspaceDirectory: options['--workspace'],
            });
        } else if (operation === 'copy-to-guest') {
            const {hostPath, request} = await resolveGuestCopyRequest();
            await mapGuestCopyFailure(
                'input-invalid',
                () => (operations.assertOrdinaryHostFile ?? assertOrdinaryHostFile)(hostPath),
            );
            const guestAdapter = operations.guestAdapter ?? createReleaseVmwareGuestAdapter();
            await mapGuestCopyFailure('adapter-result-invalid', () => guestAdapter.copyToGuest({
                ...request,
                hostPaths: [hostPath],
            }));
            result = {direction: 'to-guest', machineKey: request.machineKey, status: 'copied'};
        } else if (operation === 'copy-from-guest') {
            const {hostPath, request} = await resolveGuestCopyRequest();
            const guestAdapter = operations.guestAdapter ?? createReleaseVmwareGuestAdapter();
            await mapGuestCopyFailure('adapter-result-invalid', () => guestAdapter.copyFromGuest({
                ...request,
                hostPath,
            }));
            result = {direction: 'from-guest', machineKey: request.machineKey, status: 'copied'};
        } else if (operation === 'run-step') {
            const options = parseOptions(args.slice(1), ['--config', '--machine', '--scenario', '--step', '--workspace']);
            requireAbsolute(options['--config'], options['--workspace']);
            const validateWorkspacePath = await getWorkspaceBoundary();
            validateWorkspacePath(options['--workspace'], 'Release validation workspace');
            const inputs = await loadConfigurations(options['--config']);
            const runStep = operations.runStep
                ?? (request => runReleaseVmGuestStep(request, {
                    releaseConfiguration: inputs.releaseConfiguration,
                    workspaceBoundary: validateWorkspacePath,
                }));
            result = await runStep({
                configuration: inputs.vmConfiguration,
                machineKey: options['--machine'],
                scenarioId: options['--scenario'],
                stepId: options['--step'],
                workspaceDirectory: options['--workspace'],
            });
        } else if (operation === 'finalize-step') {
            const options = parseOptions(args.slice(1), ['--config', '--judgment', '--template']);
            requireAbsolute(options['--config'], options['--judgment'], options['--template']);
            const validateWorkspacePath = await getWorkspaceBoundary();
            validateWorkspacePath(options['--judgment'], 'Release step judgment path');
            validateWorkspacePath(options['--template'], 'Release step template path');
            const inputs = await loadConfigurations(options['--config']);
            const finalizeStep = operations.finalizeStep
                ?? (request => finalizeReleaseVmGuestStep(request, {workspaceBoundary: validateWorkspacePath}));
            result = await finalizeStep({
                configuration: inputs.vmConfiguration,
                judgmentPath: options['--judgment'],
                templatePath: options['--template'],
            });
        } else {
            throw new Error('usage');
        }
        output.write(`${JSON.stringify(result)}\n`);
        return 0;
    } catch (error) {
        if (error instanceof Error && error.message === 'usage') {
            errorOutput.write(usage);
            return 2;
        }
        if (isOperationError(error)) {
            errorOutput.write(`${JSON.stringify(error)}\n`);
            return 1;
        }
        errorOutput.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = await runReleaseVmValidationCli(process.argv.slice(2));
}
