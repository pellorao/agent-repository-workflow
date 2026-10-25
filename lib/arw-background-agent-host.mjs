import {fileURLToPath} from 'node:url';
import {dirname, isAbsolute, resolve} from 'node:path';
import {createCurrentPlatformAdapter} from './arw-common/platform-adapter.mjs';
import {BACKGROUND_AGENT_DEFAULTS, loadConfig} from './arw-common/config.mjs';
import {loadRepositoryConfiguration} from './arw-common/repository-configuration.mjs';
import {REVIEWER_ROLES, resolveReviewerSettings, validateReviewerFields} from './arw-common/reviewer-configuration.mjs';
import {resolveTemporaryWorkspace} from './arw-common/temporary-workspace.mjs';
import {resolveInstallation} from './installation/installation-contract.mjs';
import {createBackgroundAgentClient, backgroundAgentRuntimeDirectory, acquireBackgroundAgentStartupLease} from './background-agent/client.mjs';
import {createBackgroundAgentDaemon} from './background-agent/daemon.mjs';
import {createBackgroundAgentStateStore} from './background-agent/state-store.mjs';
import {createBackgroundAgentManager, createManagedNativeSessions} from './background-agent/manager.mjs';
import {createCodexAppServerSessions} from './background-agent/codex-app-server.mjs';
import {createSharedModelCatalog} from './background-agent/model-catalog.mjs';
import {createStrataDriver as createDefaultStrataDriver} from './background-agent/strata-driver.mjs';
import {readCodexMainTitle} from './background-agent/codex-consumption.mjs';
import {runBackgroundAgent} from './background-agent/machine.mjs';
import {createBackgroundAgentMachineClient as createMachineClient} from './background-agent/machine-client.mjs';
import {createReviewerRuntime} from './reviewer-runtime/reviewer-runtime.mjs';
import {declineReviewerInteractions} from './reviewer-runtime/reviewer-native-policy.mjs';
import {isJsonObject} from './common/json.mjs';

/** @typedef {import('./background-agent/machine.mjs').MachineRuntime} MachineRuntime */
/** @typedef {import('./background-agent/machine.mjs').RuntimeResult} RuntimeResult */
/** @typedef {Omit<import('./background-agent/machine.mjs').MachineOptions,'runtime'> & {runtime?:MachineRuntime,hostRepositoryRoot:string,programDirectory:string,configuration?:Awaited<ReturnType<typeof loadConfig>>,platformAdapter?:Pick<ReturnType<typeof createCurrentPlatformAdapter>,'getCurrentAgentIdentity'>,environment?:NodeJS.ProcessEnv}} BackgroundAgentHostOptions */
const entryPoint = fileURLToPath(import.meta.url);
const programDirectory = dirname(dirname(entryPoint));
const installationDirectory = (/** @type {NodeJS.ProcessEnv} */ environment) => resolveInstallation(environment, process.platform).directory;
const failure = (/** @type {unknown} */ error) => ({status:/** @type {const} */ ('failed'),error:{code:'background-agent-host-failed',message:error instanceof Error ? error.message : 'Background Agent host failed.'}});

/** Compose the shared JSONL client with the existing host and daemon entry.
 * @param {{programDirectory:string,hostRepositoryRoot:string}} directories
 */
export const createBackgroundAgentMachineClient = directories => createMachineClient(streams =>
    runBackgroundAgentMachine({...streams,...directories}));

/** @param {BackgroundAgentHostOptions} options */
export async function runBackgroundAgentMachine(options) {
    if (options.runtime) return runBackgroundAgent({...options,runtime:options.runtime});
    const owner = (options.platformAdapter ?? createCurrentPlatformAdapter()).getCurrentAgentIdentity();
    if (owner.platform !== 'codex') throw new Error('Background Agent execution currently requires Codex.');
    const directory=installationDirectory(options.environment ?? process.env);
    const configuration=options.configuration ?? await loadConfig(options.programDirectory);
    const client = createBackgroundAgentClient({
        messageTimeoutMs:configuration.backgroundAgent?.messageTimeoutMs ?? BACKGROUND_AGENT_DEFAULTS.messageTimeoutMs,
        runtimeDirectory:backgroundAgentRuntimeDirectory(directory),
        entryPoint,
        ownerId:owner.sessionId,
        caller:{repositoryRoot:options.hostRepositoryRoot,programDirectory:options.programDirectory},
    });
    return runBackgroundAgent({...options,runtime:/** @type {MachineRuntime} */ (client)});
}

/** @param {{programDirectory?:string,configuration?:Awaited<ReturnType<typeof loadConfig>>,environment?:NodeJS.ProcessEnv,observeManagerProcess?:Parameters<typeof createBackgroundAgentClient>[0]['observeManagerProcess']}} [options] @returns {Promise<import('./background-agent/presentation.mjs').BackgroundAgentOverview[]|null>} */
export async function listBackgroundAgents({programDirectory:callerProgramDirectory = programDirectory,configuration:providedConfiguration,environment = process.env,observeManagerProcess} = {}) {
    const directory=installationDirectory(environment);
    const configuration=providedConfiguration ?? await loadConfig(callerProgramDirectory);
    const client = createBackgroundAgentClient({runtimeDirectory:backgroundAgentRuntimeDirectory(directory),messageTimeoutMs:configuration.backgroundAgent?.messageTimeoutMs ?? BACKGROUND_AGENT_DEFAULTS.messageTimeoutMs,observeManagerProcess});
    try {return /** @type {import('./background-agent/presentation.mjs').BackgroundAgentOverview[]|null} */ (await client.list());}
    finally {await client.close();}
}

/**
 * Compose control, native facts and Reviewer semantics in the owning daemon.
 * Callers cannot replace ownership or capacity through machine input.
 * @param {{installationDirectory:string,programDirectory:string,nativeSessions?:import('./background-agent/codex-app-server.mjs').NativeSessions,
 * modelCatalog?:ReturnType<typeof createSharedModelCatalog>,createStrataDriver?:typeof createDefaultStrataDriver}} options
 */
export async function createBackgroundAgentHost({installationDirectory:directory,programDirectory:hostProgramDirectory,nativeSessions,modelCatalog,createStrataDriver}) {
    const configured = await loadConfig(hostProgramDirectory);
    const backgroundConfiguration = configured.backgroundAgent ?? BACKGROUND_AGENT_DEFAULTS;
    const runtimeDirectory = backgroundAgentRuntimeDirectory(directory);
    const catalog = modelCatalog ?? (nativeSessions ? undefined : createSharedModelCatalog({runtimeDirectory,maxInstances:backgroundConfiguration.maxInstances}));
    const driverFactory = createStrataDriver ?? (nativeSessions ? undefined : createDefaultStrataDriver);
    const manager = await createBackgroundAgentManager({
        nativeSessions:nativeSessions ?? createCodexAppServerSessions({runtimeDirectory,modelCatalog:catalog}),maxInstances:backgroundConfiguration.maxInstances,
        earlyExitNotificationThreshold:backgroundConfiguration.earlyExitNotificationThreshold,
        stateStore:createBackgroundAgentStateStore({runtimeDirectory,persistenceIntervalMs:backgroundConfiguration.persistenceIntervalMs}),
        readOwnerTitle:readCodexMainTitle,
        ...(catalog ? {modelCatalog:catalog} : {}),
        ...(driverFactory ? {createStrataDriver:driverFactory} : {}),
    });
    /** @type {Map<string, ReturnType<typeof createReviewerRuntime>>} */
    const reviewers = new Map();
    /** @type {Map<string,{ownerId:string,runtime:ReturnType<typeof createReviewerRuntime>}>} */
    const bindings = new Map();
    /** @type {Map<ReturnType<typeof createReviewerRuntime>,number>} */
    const activeRuntimeCalls = new Map();
    /** @param {ReturnType<typeof createReviewerRuntime>} runtime */
    const pruneRuntime = runtime => {
        if (runtime.hasLiveRuns() || activeRuntimeCalls.has(runtime)
            || [...bindings.values()].some(binding => binding.runtime === runtime)) return;
        for (const [key, current] of reviewers) if (current === runtime) reviewers.delete(key);
        void runtime.close();
    };
    /** @param {ReturnType<typeof createReviewerRuntime>} runtime */
    const holdRuntime = runtime => {
        activeRuntimeCalls.set(runtime, (activeRuntimeCalls.get(runtime) ?? 0) + 1);
        return () => {
            const remaining = /** @type {number} */ (activeRuntimeCalls.get(runtime)) - 1;
            if (remaining) activeRuntimeCalls.set(runtime, remaining);
            else activeRuntimeCalls.delete(runtime);
            pruneRuntime(runtime);
        };
    };
    /** @param {string} ownerId @param {string} repositoryRoot @param {string} role */
    const reviewerRuntime = (ownerId,repositoryRoot,role) => {
        const key = JSON.stringify([ownerId,repositoryRoot,role]);
        let runtime = reviewers.get(key);
        if (!runtime) {
            const workspace = resolveTemporaryWorkspace({repositoryRoot,agentIdentity:{platform:'codex',sessionId:ownerId}});
            runtime = createReviewerRuntime({
                nativeSessions:createManagedNativeSessions({manager,ownerId,controllerId:ownerId,role,onClientRequests:({native,requests})=>declineReviewerInteractions(native,requests)}),
                recoveryBoundary:() => ({repositoryRoot,sessionWorkspaceRoot:workspace}),
                onRetired: runId => {
                    if (bindings.get(runId)?.runtime === runtime) bindings.delete(runId);
                    pruneRuntime(/** @type {ReturnType<typeof createReviewerRuntime>} */ (runtime));
                },
            });
            reviewers.set(key,runtime);
        }
        return runtime;
    };
    /** @param {{ownerId:string,caller:{repositoryRoot:string|null,programDirectory:string},operation:string,input:Record<string,unknown>,emit?:(result:unknown)=>Promise<void>,signal?:AbortSignal}} request @returns {Promise<RuntimeResult>} */
    const dispatch = async ({ownerId,caller,operation,input,emit,signal}) => {
        try {
            for (const key of ['ownerId','ownerTitle','controllerId','maxInstances']) {
                if (Object.hasOwn(input,key)) throw new Error(`Machine input cannot override ${key}.`);
            }
            if (!['send_message','messages'].includes(operation)) manager.assertMainCaller(ownerId);
            if (['send_message','messages'].includes(operation) && typeof input.runId === 'string') {
                const access = manager.callerAccess({runId:input.runId,callerId:ownerId});
                const managed=manager.owned(input.runId,access.ownerId,access.controllerId);
                if(operation==='send_message'&&access.kind==='owner'&&managed.providerWork?.paused===true&&REVIEWER_ROLES.includes(managed.role)){
                    if(!caller.repositoryRoot)throw new Error('Reviewer resumption requires its launching Git repository.');
                    const runtime=reviewerRuntime(access.ownerId,caller.repositoryRoot,managed.role);
                    await runtime.restorePausedTask({runId:input.runId,managed});
                    bindings.set(input.runId,{ownerId:access.ownerId,runtime});
                }
                return await manager.execute({
                    ownerId:access.ownerId,controllerId:access.controllerId,callerId:ownerId,
                    operation,input,emit,signal,
                });
            }
            const role = typeof input.role === 'string' ? input.role : null;
            const reviewer = role !== null && REVIEWER_ROLES.includes(role);
            const bound = typeof input.runId === 'string' ? bindings.get(input.runId) : undefined;
            if (bound && bound.ownerId !== ownerId) throw new Error('The Background Agent belongs to another Main session.');
            let runtime = bound?.runtime;
            let prepared = input;
            if ((operation === 'spawn_agent' || operation === 'followup_task') && reviewer) {
                if (!caller.repositoryRoot || !isAbsolute(caller.repositoryRoot)) throw new Error('Reviewer control requires its launching Git repository.');
                const identity = input.identity;
                if (!isJsonObject(identity) || !['ordinary','isolated'].includes(String(identity.kind))) throw new Error('Reviewer identity is invalid.');
                const settings = input.settings === undefined ? {} : input.settings;
                if (!isJsonObject(settings)) throw new Error('Reviewer settings must be an object.');
                const config = settings.config === undefined ? {} : settings.config;
                if (!isJsonObject(config)) throw new Error('Reviewer native config must be an object.');
                const {config:_config,...fields} = settings;
                const overrides = validateReviewerFields(fields,'settings');
                if (identity.kind === 'ordinary' && Object.keys(overrides).length) throw new Error('Ordinary Reviewer model settings come from user configuration.');
                const repository = await loadRepositoryConfiguration({repositoryRoot:caller.repositoryRoot});
                if (repository.status !== 'succeeded') throw new Error('Reviewer repository configuration could not be loaded.');
                const global = await loadConfig(caller.programDirectory);
                const selected = resolveReviewerSettings({
                    role:/** @type {string} */ (role),globalConfig:global,repositoryConfig:repository,
                    ...(identity.kind === 'isolated' ? {overrides} : {}),
                });
                prepared = {...input,settings:{...selected,config}};
                runtime = reviewerRuntime(ownerId,caller.repositoryRoot,role);
            }
            const saved = !runtime && typeof input.runId === 'string' && ['list_agents','wait_agent','interrupt_agent'].includes(operation)
                ? manager.owned(input.runId,ownerId,ownerId) : null;
            if (saved && REVIEWER_ROLES.includes(saved.role)) {
                if (!caller.repositoryRoot || !isAbsolute(caller.repositoryRoot)) throw new Error('Reviewer observation requires its launching Git repository.');
                runtime = reviewerRuntime(ownerId,caller.repositoryRoot,saved.role);
            }
            if (runtime) {
                if(operation==='interrupt_agent'&&saved?.providerWork?.paused===true)await runtime.restorePausedTask({runId:String(input.runId),managed:saved,resumePending:false});
                const releaseRuntime = holdRuntime(runtime);
                try {
                    if (operation === 'respond') throw new Error('Reviewer requests cannot receive human responses.');
                    if (operation === 'list_agents' || operation === 'wait_agent') {
                        const runId = /** @type {string} */ (input.runId);
                        const managed = saved ?? manager.owned(runId,ownerId,ownerId);
                        const before = await runtime.inspect({runId,managed});
                        if (before.status === 'failed') return before;
                        /** @type {RuntimeResult|undefined} */
                        let emitted;
                        /** @param {unknown} value @returns {Promise<RuntimeResult>} */
                        const annotate = async value => {
                            const result = /** @type {RuntimeResult} */ (value);
                            if (result.status === 'failed') return result;
                            const inspected = await runtime.inspect({runId,managed});
                            if (inspected.status === 'failed') throw new Error(inspected.error.message);
                            const {completion,measurement,recoveryPath} = inspected.result;
                            return {status:'succeeded',result:{.../** @type {Record<string,unknown>} */ (result.result),completion,measurement,recoveryPath}};
                        };
                        const result = await manager.execute({ownerId,controllerId:ownerId,callerId:ownerId,
                            operation,
                            input:prepared,signal,
                            ...(emit ? {emit:async value=>{emitted=await annotate(value);await emit(emitted);}} : {}),
                        });
                        return emitted ?? await annotate(result);
                    }
                    const result = await runtime.execute({operation,input:prepared});
                    if (result.status === 'succeeded' && runtime.holdsRun(result.result.runId)) bindings.set(result.result.runId,{ownerId,runtime});
                    return result;
                } finally { releaseRuntime(); }
            }
            // Reading does not restore a thread; work requires its full Reviewer binding.
            if (typeof input.runId === 'string') {
                const entry = manager.owned(input.runId,ownerId,ownerId);
                if (REVIEWER_ROLES.includes(entry.role) && !['list_agents','wait_agent'].includes(operation)) {
                    throw new Error('Reviewer control requires its complete original Reviewer binding.');
                }
            }
            return await manager.execute({ownerId,controllerId:ownerId,callerId:ownerId,operation,input:prepared,emit,signal});
        } catch (error) {return failure(error);}
    };
    return {manager,dispatch,runtimeDirectory};
}

if (process.argv[1] && resolve(process.argv[1]) === entryPoint) {
    try {
        const directory = installationDirectory(process.env);
        if (process.argv.length !== 4 || process.argv[2] !== '--background-agent-daemon'
            || process.argv[3] !== backgroundAgentRuntimeDirectory(directory)) throw new Error('Invalid private Background Agent daemon invocation.');
        const startupLease = await acquireBackgroundAgentStartupLease({runtimeDirectory:backgroundAgentRuntimeDirectory(directory)});
        try {
            const host = await createBackgroundAgentHost({installationDirectory:directory,programDirectory});
            await createBackgroundAgentDaemon({runtimeDirectory:host.runtimeDirectory,dispatch:host.dispatch,list:host.manager.list,prepareMaintenance:host.manager.prepareMaintenance,startupLease});
        } finally {await startupLease.release();}
    } catch (error) {
        process.stderr.write(`${failure(error).error.message}\n`);
        process.exitCode = 1;
    }
}
