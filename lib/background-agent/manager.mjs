import {randomUUID} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {BACKGROUND_AGENT_DEFAULTS} from '../arw-common/config.mjs';
import {REVIEWER_ROLES} from '../arw-common/reviewer-configuration.mjs';
import {jsonSemanticallyEqual} from '../common/json.mjs';
import {createSerialExecutor} from '../common/serial-executor.mjs';
import {backgroundAgentRecoveryPath, readBackgroundAgentRecoveryRecord, requireBackgroundAgentStateDirectory, saveBackgroundAgentRecoveryRecord} from './recovery-record.mjs';
import {createStrataDriver as defaultCreateStrataDriver,reviewerTaskSupport} from './strata-driver.mjs';
import {nextBackgroundAgentSequence,recoverEndedBackgroundAgent} from './recovery-state.mjs';
import {isClaudeSettings} from './claude-sessions.mjs';

/** @typedef {import('./codex-app-server.mjs').NativeSession} NativeSession */
/** @typedef {import('./codex-app-server.mjs').NativeSessions} NativeSessions */
/** @typedef {import('./codex-app-server.mjs').NativeSnapshot} NativeSnapshot */
/** @typedef {import('./codex-app-server.mjs').NativeNotification} NativeNotification */
/** @typedef {import('./codex-app-server.mjs').NativeSettings} NativeSettings */
/** @typedef {ReturnType<typeof import('./state-store.mjs').createBackgroundAgentStateStore>} BackgroundAgentStateStore */
/** @typedef {import('./state-store.mjs').AgentState} EnvironmentState */
/** @typedef {import('./state-store.mjs').TaskState} TaskState */
/** @typedef {import('./state-store.mjs').BackgroundAgentRow} AgentRow */
/** @typedef {import('./message-store.mjs').StoredMessage} MessageRow */
/** @typedef {import('./model-catalog.mjs').ProviderConfiguration} ProviderConfiguration */
/** @typedef {import('./state-store.mjs').ProviderLease} ProviderLease */
/** @typedef {ReturnType<typeof defaultCreateStrataDriver>} StrataDriver */
/** @typedef {{lease:ProviderLease,driver:StrataDriver,responsesUrl:string|null,persisted:boolean,released:boolean}} ActiveProvider */
/** @typedef {{instructions?:string,settings?:NativeSettings,cwd?:string,readPaths?:string[],writePaths?:string[]}} TaskOptions */
/** @typedef {AgentRow & {native:NativeSession|null,snapshot:NativeSnapshot|null,onNotification:(notification:NativeNotification)=>void,onUnloaded?:()=>void,onClientRequests?:((input:{native:NativeSession,requests:import('./codex-app-server.mjs').NativeClientRequest[]})=>Promise<void>|void),waiters:Set<() => void>,work:Promise<void>,pendingWork:number,callerReservations:number,taskOptions:Map<string,TaskOptions>,protectedTurnId:string|null,providerTaskSupport?:ReturnType<typeof reviewerTaskSupport>,deadlineStopWork?:{pending:Promise<void>|null},onResumeTask?:()=>Promise<void>,resumeWorkScheduled?:string|null,readTaskMeasurement?:()=>{workDuration?:{durationMs:number|null,estimated?:boolean|null,basis?:string|null}}}} Entry */
/** @typedef {{notifications:Array<{sequence:number,type:'message'|'changed',threadId:string|null,turnId:string|null,messageId?:string,source?:string,text?:string,deliveryStatus?:string,persistenceStatus?:string}>,cursor:number,pendingRequests:import('./codex-app-server.mjs').NativeClientRequest[]}} ManagedObservation */
/** @typedef {Omit<NativeSession,'startTurn'|'steer'|'resume'|'stopForDeadline'> & {runId:string,previous:{runId:string,threadId:string|null,sessionPath:string|null},managementState:()=>EnvironmentState,observe:(input:{cursor:number})=>Promise<ManagedObservation>,waitNotifications:(input:{cursor:number,timeoutMs?:number,signal?:AbortSignal})=>Promise<ManagedObservation>,detach:()=>void,holdManagedWork:()=>()=>void,protectTurn:(input:{rootThreadId:string,turnId:string})=>Promise<{confirmed:true}>,releaseProtectedTurn:(input:{rootThreadId:string,turnId:string})=>Promise<{confirmed:true}>,acceptStart:(input:{handoff:string,instructions:string})=>Promise<{runId:string,messageId:string,deliveryStatus:'accepted',recoveryPath:string|null}>,acceptTask:(input:{handoff:string,turnId?:string,instructions?:string,settings?:NativeSettings,cwd?:string,readPaths?:string[],writePaths?:string[]})=>Promise<{runId:string,messageId:string,deliveryStatus:'accepted'}>,prepareNativeStart:()=>Promise<{threadId:string,sessionPath:string|null}>,prepareForTask:(input:{messageId:string})=>Promise<{threadId:string,sessionPath:string|null}>,failAcceptedTask:(input:{messageId:string})=>Promise<void>,dispatchAccepted:(input:{messageId:string})=>Promise<{turnId:string|null,messageId:string,deliveryStatus:string|undefined}>,resume:(input:{runId?:string,threadId:string,expectedSessionPath:string|null,instructions:string,deferRestore?:boolean})=>Promise<{threadId:string,sessionPath:string|null}>,startTurn:(input:{threadId:string,handoff:string})=>Promise<{turnId:string|null,messageId:string,deliveryStatus:string|undefined,persistenceStatus:string|undefined}>,steer:(input:{threadId:string,turnId:string,instruction:string})=>Promise<{turnId:string|null,messageId:string,deliveryStatus:string|undefined,persistenceStatus:string|undefined}>} & {restoreCurrentTask?:()=>Promise<void>,getTaskMessage?:(messageId:string)=>import('./message-store.mjs').StoredMessage|null,setResumeHandler?:(handler:()=>Promise<void>,resumePending?:boolean)=>void,noteEarlyExit?:(input:{turnId:string})=>Promise<boolean>,recoverContinuation?:(input:{rootThreadId:string,endedTurnId:string})=>Promise<string|null>,stopForDeadline?:(input:{rootThreadId:string})=>Promise<{environmentState:'exited'}>,createProviderWorkPolicy?:(input:Pick<Parameters<NonNullable<ReturnType<typeof reviewerTaskSupport>>['createPolicy']>[0],'identityKind'|'workDuration'|'send'|'stop'>)=>ReturnType<NonNullable<ReturnType<typeof reviewerTaskSupport>>['createPolicy']>|null,setTaskMeasurement?:(read:()=>{workDuration?:{durationMs:number|null,estimated?:boolean|null,basis?:string|null}})=>void,getTaskStartedAt?:()=>number|null,providerWorkClock?:()=>typeof systemClock,getProviderWork?:()=>Record<string,unknown>|null,saveProviderWork?:(state:Record<string,unknown>)=>void,configureReviewerTask?:(input:{identityKind:'ordinary'|'isolated',stateDirectory:string,compactBinding?:import('./strata-work-policy.mjs').StrataCompactBinding|null,restore?:boolean,messageId?:string})=>Promise<{enabled:boolean,settings:NativeSettings,compactBinding:import('./strata-work-policy.mjs').StrataCompactBinding|null}>,sendProgramInstruction?:(input:{threadId:string,turnId:string,instruction:string,messageId?:string,onAccepted:(id:string)=>void})=>Promise<void>,continueTask?:(input:{rootThreadId:string,endedTurnId:string,instruction:string,canContinue?:()=>boolean,messageId?:string,onAccepted:(id:string)=>void,compactBinding?:import('./strata-work-policy.mjs').StrataCompactBinding|null})=>Promise<{turnId:string,deliveryStatus:string}>}} ManagedNativeSession */
/** @typedef {{open:(input:Parameters<NativeSessions['open']>[0] & {onUnloaded?:()=>void})=>Promise<ManagedNativeSession & {reserve:(input:{stateDirectory?:string})=>Promise<{runId:string,threadId:string|null,sessionPath:string|null}>}>}} ManagedNativeSessions */

const systemClock = {
  now:()=>Date.now(),
  setTimeout:(/** @type {()=>void} */ callback,/** @type {number} */ delay)=>setTimeout(callback,delay),
  clearTimeout:(/** @type {ReturnType<typeof setTimeout>} */ timer)=>clearTimeout(timer),
};
/** @param {unknown} value */
const explanation = value => value instanceof Error ? value.message : String(value);
/** @param {Entry} entry */
const row = entry => ({
  runId:entry.runId,ownerId:entry.ownerId,role:entry.role,ownerTitle:entry.ownerTitle,
  ownerSessionPath:entry.ownerSessionPath,threadId:entry.threadId,turnId:entry.turnId,
  sessionPath:entry.sessionPath,settings:entry.settings,cwd:entry.cwd,readPaths:entry.readPaths,
  writePaths:entry.writePaths,instructions:entry.instructions,recoveryPath:entry.recoveryPath,
  state:entry.state,taskState:entry.taskState,stateVersion:entry.stateVersion,
  lastUsedAtMs:entry.lastUsedAtMs,taskStartedAtMs:entry.taskStartedAtMs,
  taskFinishedAtMs:entry.taskFinishedAtMs,knownThreadIds:entry.knownThreadIds,providerWork:entry.providerWork??null,
});

/**
 * Owns root-session admission and message sequencing. SQLite stores the latest
 * row for each run and message; native notifications never become a second log.
 * @param {{nativeSessions:NativeSessions,maxInstances:number,earlyExitNotificationThreshold?:number,stateStore:BackgroundAgentStateStore,
 * clock?:typeof systemClock,readOwnerTitle?:(input:{ownerId:string,native:NativeSession})=>Promise<string|null>,
 * modelCatalog?:{getProviders:()=>Promise<Record<string,ProviderConfiguration>>},
 * createStrataDriver?:typeof defaultCreateStrataDriver}} options
 */
export async function createBackgroundAgentManager({nativeSessions,maxInstances,stateStore,clock=systemClock,readOwnerTitle,
  modelCatalog,earlyExitNotificationThreshold=BACKGROUND_AGENT_DEFAULTS.earlyExitNotificationThreshold,createStrataDriver=defaultCreateStrataDriver}) {
  if (!Number.isSafeInteger(maxInstances) || maxInstances < 1) throw new Error('Background Agent capacity must be a positive safe integer.');
  /** @type {Map<string,Entry>} */
  const runs = new Map();
  const serial = createSerialExecutor();
  const providerSerial = createSerialExecutor();
  let maintenance = false;
  /** @type {ReturnType<typeof clock.setTimeout>|null} */
  let idleCloseTimer = null;
  let sharedServerOpen = false;
  /** @type {Map<string,ActiveProvider>} */
  const activeProviders = new Map();
  /** @type {Set<string>} */
  const providersAwaitingRelease = new Set();
  /** @param {Entry} entry */
  const wake = entry => {for (const listener of [...entry.waiters]) listener();};
  const cancelIdleClose = () => {if (idleCloseTimer !== null) clock.clearTimeout(idleCloseTimer);idleCloseTimer=null;};
  /** @param {Entry} entry */
  const occupied = entry => ['starting','running','idle','stopping','unknown'].includes(entry.state);
  /** @param {Entry} entry */
  const providerIdOf = entry => {
    if(typeof entry.settings.modelProvider!=='string'||!entry.settings.modelProvider)
      throw new Error('Managed model provider identity is unavailable.');
    return entry.settings.modelProvider;
  };
  /** @param {Entry} entry */
  const modelIdOf = entry => {
    if(typeof entry.settings.model!=='string'||!entry.settings.model)
      throw new Error('Managed model identity is unavailable.');
    return entry.settings.model;
  };
  /** @param {Entry} entry */
  const nextSequence = entry => nextBackgroundAgentSequence(entry.stateVersion,stateStore.latestMessageSequence(entry.runId));
  /** @param {Entry} entry @param {Partial<AgentRow>} patch */
  const update = (entry,patch) => {
    const oldState=entry.state,oldTask=entry.taskState;
    const changed=Object.entries(patch).some(([key,value])=>{
      const before=/** @type {Record<string,unknown>} */(entry)[key];
      return typeof value==='object' && value!==null ? before===undefined||!jsonSemanticallyEqual(before,value) : before!==value;
    });
    if(!changed)return;
    Object.assign(entry,patch);
    if (entry.state!==oldState || entry.taskState!==oldTask) {
      entry.stateVersion=nextSequence(entry);
      wake(entry);
    }
    stateStore.upsertAgent(row(entry));
  };
  /** @param {Entry} entry @param {NativeNotification} notification */
  const notify = (entry,notification) => {
    entry.onNotification(notification);
    if (notification.type==='message') return;
    void serial(async()=>{
      if (notification.type==='exited' && entry.state!=='exited') {
        update(entry,{state:'unknown'});
      } else if (notification.type==='changed' && entry.native && entry.threadId) {
        try {await refreshSnapshot(entry);}
        catch {update(entry,{state:'unknown'});}
      }
      wake(entry);
    }).catch(()=>{update(entry,{state:'unknown'});});
  };
  /** @param {AgentRow} stored */
  const restore = stored => {
    const entry=/** @type {Entry} */ ({
      ...stored,state:stored.state==='exited'?stored.state:'unknown',
      native:null,snapshot:null,onNotification:()=>{},waiters:new Set(),work:Promise.resolve(),pendingWork:0,callerReservations:0,taskOptions:new Map(),
      protectedTurnId:null,
    });
    return entry;
  };
  const storedAgents=await stateStore.loadAgents();
  const storedProviders=modelCatalog?stateStore.listProviders().filter(provider=>provider.leaseKey!==null):[];
  const hadUnfinishedStoredEnvironment=storedAgents.some(stored=>stored.state!=='exited');
  let priorProcessExited=false;
  let coldProcessCheckFailed=false;
  if(hadUnfinishedStoredEnvironment||modelCatalog){
    try{
      const closed=await nativeSessions.close({retainProcessIdentity:true});
      priorProcessExited=closed.environmentState==='exited'&&closed.previousProcessState==='ended';
    }catch {coldProcessCheckFailed=true;}
  }
  const coldProcessExitUnverified=coldProcessCheckFailed
    ||(hadUnfinishedStoredEnvironment||storedProviders.length>0)&&!priorProcessExited;
  if(priorProcessExited)for(const provider of storedProviders)providersAwaitingRelease.add(provider.providerId);
  for (const stored of storedAgents) {
    if (runs.has(stored.runId)) throw new Error('Stored Background Agent identity was repeated.');
    const entry=restore(stored);
    runs.set(stored.runId,entry);
    if(priorProcessExited&&stored.state!=='exited'){
      Object.assign(entry,recoverEndedBackgroundAgent(stored,stateStore.latestMessageSequence(stored.runId)));
      stateStore.upsertAgent(row(entry));
    }
    else if(entry.state!==stored.state) stateStore.upsertAgent(row(entry));
  }
  const reapExited = () => {
    for(const entry of runs.values()){
      if(entry.state!=='exited'||entry.native||entry.pendingWork||entry.waiters.size||entry.taskOptions.size)continue;
      if(stateStore.isAgentPersisted(entry.runId)&&stateStore.releaseAgent(entry.runId))runs.delete(entry.runId);
    }
  };
  const unsubscribePersisted=stateStore.onPersisted(()=>{void serial(async()=>reapExited()).catch(()=>{});});
  /** @param {Entry} entry */
  const refreshOwner = async entry => {
    if (!entry.native) return;
    /** @type {{title:string|null,preview:string,sessionPath:string|null}|null} */
    let metadata=null;
    try {
      metadata=await entry.native.readThreadMetadata({threadId:entry.ownerId});
    } catch { /* The last confirmed owner path remains authoritative. */ }
    if(metadata?.sessionPath!==null && metadata?.sessionPath!==undefined) {
      if(!isAbsolute(metadata.sessionPath)||(entry.ownerSessionPath!==null&&entry.ownerSessionPath!==metadata.sessionPath))
        throw new Error('Owning Main native record path changed.');
      entry.ownerSessionPath=metadata.sessionPath;
    }
    if (readOwnerTitle && entry.ownerTitle===null) {
      try {entry.ownerTitle=await readOwnerTitle({ownerId:entry.ownerId,native:entry.native});}
      catch { /* An unknown title stays unknown. */ }
    }
    stateStore.upsertAgent(row(entry));
  };
  /** @param {Entry} entry */
  const verifyRecovery = async entry => {
    if (!entry.recoveryPath || !entry.threadId || !entry.instructions) throw new Error('Background Agent recovery binding is unavailable.');
    const record=await readBackgroundAgentRecoveryRecord(entry.recoveryPath);
    if (record.runId!==entry.runId || record.ownerId!==entry.ownerId || record.controllerId!==entry.ownerId
      || record.role!==entry.role || record.threadId!==entry.threadId || record.sessionPath!==entry.sessionPath
      || record.instructions!==entry.instructions || record.cwd!==entry.cwd || record.recoveryPath!==entry.recoveryPath
      || !jsonSemanticallyEqual(record.settings,entry.settings) || !jsonSemanticallyEqual(record.readPaths,entry.readPaths)
      || !jsonSemanticallyEqual(record.writePaths,entry.writePaths)) throw new Error('Background Agent recovery record does not match the original run.');
  };
  /** @param {Entry} entry */
  const saveRecovery = async entry => {
    if (!entry.recoveryPath || !entry.threadId || !entry.instructions) return;
    await saveBackgroundAgentRecoveryRecord({runId:entry.runId,ownerId:entry.ownerId,
      controllerId:entry.ownerId,role:entry.role,settings:/** @type {NativeSettings} */(/** @type {unknown} */(entry.settings)),
      cwd:entry.cwd,readPaths:entry.readPaths,writePaths:entry.writePaths,instructions:entry.instructions,
      threadId:entry.threadId,sessionPath:entry.sessionPath,recoveryPath:entry.recoveryPath});
  };
  /** @param {Entry} entry */
  const refreshSnapshot = async entry => {
    if (!entry.native || !entry.threadId) throw new Error('Native environment facts are unavailable.');
    const native=entry.native;
    let facts=await native.snapshot({rootThreadId:entry.threadId,knownThreadIds:entry.knownThreadIds});
    if(!entry.deadlineStopWork&&facts.environmentState==='running' && entry.onClientRequests && facts.clientRequests.length) {
      await entry.onClientRequests({native,requests:facts.clientRequests});
      facts=await native.snapshot({rootThreadId:entry.threadId,knownThreadIds:entry.knownThreadIds});
    }
    if(native!==entry.native&&entry.snapshot)return entry.snapshot;
    if(entry.deadlineStopWork){
      entry.snapshot={...facts,publicMessages:[],userMessages:[],factsComplete:false,
        unknownReasons:[...facts.unknownReasons,'Deadline root exit has not been confirmed.']};
      return entry.snapshot;
    }
    entry.snapshot={...facts,publicMessages:[],userMessages:[]};
    if(facts.environmentState!=='running'){
      entry.snapshot={...entry.snapshot,factsComplete:false,
        unknownReasons:[...new Set([...facts.unknownReasons,'Native root exit was not confirmed by a managed unload.'])]};
      update(entry,{state:'unknown',taskState:'unknown'});
      return entry.snapshot;
    }
    const knownThreadIds=[...new Set([...entry.knownThreadIds,...facts.members.map(member=>member.threadId)])];
    const active=facts.members.some(member=>member.state==='active');
    const taskState=facts.clientRequests.length || active || entry.protectedTurnId!==null || entry.providerWork?.paused===true ? 'working'
      : entry.taskState==='not-started' ? 'not-started' : 'ended';
    update(entry,{knownThreadIds,taskState,state:active||facts.clientRequests.length?'running':'idle',
      taskFinishedAtMs:taskState==='ended' ? entry.taskFinishedAtMs??clock.now() : null});
    return entry.snapshot;
  };
  /** @param {Entry} entry @param {boolean} [ignoreCurrentTask] */
  const availableForSafeUnload = (entry,ignoreCurrentTask=false) =>
    ['running','idle'].includes(entry.state)&&!!entry.native&&!!entry.threadId&&!!entry.sessionPath&&!!entry.instructions
      &&entry.taskState!=='working'&&entry.protectedTurnId===null
      &&entry.pendingWork<=(ignoreCurrentTask?Math.max(1,entry.callerReservations):0);
  /** @param {Entry} entry @param {boolean} [ignoreCurrentTask] */
  const safeIdle = async (entry,ignoreCurrentTask=false) => {
    if (!availableForSafeUnload(entry,ignoreCurrentTask)||!entry.native||!entry.threadId) return false;
    if (entry.recoveryPath) {try {await verifyRecovery(entry);}catch{return false;}}
    const idle=await entry.native.idleFacts({rootThreadId:entry.threadId,knownThreadIds:entry.knownThreadIds});
    if (!idle.safe||!idle.known) return false;
    const facts=await refreshSnapshot(entry);
    return facts.factsComplete && !facts.clientRequests.length && !facts.members.some(member=>member.state==='active');
  };
  /** @param {Entry} entry */
  const confirmRootExit = async entry => {
    if (!entry.native||!entry.threadId) return;
    const facts=await entry.native.snapshot({rootThreadId:entry.threadId,knownThreadIds:entry.knownThreadIds});
    if (facts.environmentState!=='exited'||!facts.members.some(member=>member.threadId===entry.threadId)
      || facts.members.some(member=>member.state==='active')) throw new Error('Native observation does not confirm root and tool exit.');
    entry.snapshot={...facts,publicMessages:[],userMessages:[]};
  };
  /** @param {Entry} entry @param {{expectedWork?:Promise<void>,ignoreCurrentTask?:boolean}} [safety] */
  const unload = async (entry,safety,deadline=false) => {
    if(safety && (entry.work!==safety.expectedWork||!availableForSafeUnload(entry,safety.ignoreCurrentTask)))return false;
    if (!entry.native) {
      if (entry.state!=='exited') throw new Error('Native root exit is not confirmed.');
      return true;
    }
    update(entry,{state:'stopping'});
    try {
      const result=await (deadline&&entry.native.stopForDeadline?entry.native.stopForDeadline():entry.native.stop());
      if (result.environmentState!=='exited') throw new Error('Native root exit is not confirmed.');
      await confirmRootExit(entry);
      entry.native=null;
      entry.protectedTurnId=null;
      update(entry,{state:'exited',lastUsedAtMs:clock.now(),
        taskState:'ended',taskFinishedAtMs:entry.taskFinishedAtMs??clock.now()});
    } catch(error) {update(entry,{state:'unknown'});throw error;}
    entry.onUnloaded?.();
    return true;
  };
  /** @param {Entry} entry @param {boolean} [ignoreCurrentTask] */
  const unloadSafely = async (entry,ignoreCurrentTask=false) => {
    const expectedWork=entry.work;
    if(!await safeIdle(entry,ignoreCurrentTask))return false;
    return unload(entry,{expectedWork,ignoreCurrentTask});
  };
  /** @returns {Promise<Record<string,ProviderConfiguration>>} */
  const providerConfigurations = () => modelCatalog?.getProviders() ?? Promise.resolve({});
  /** @param {string} providerId @param {unknown} error @param {string|null} [controllerUrl] */
  const recordProviderError = (providerId,error,controllerUrl) => {
    const key=activeProviders.get(providerId)?.lease.leaseKey;
    const message=key ? explanation(error).replaceAll(key,'[redacted]') : explanation(error);
    stateStore.updateProviderError({providerId,controllerUrl,lastError:message});
  };
  /** @param {Entry} entry */
  const providerError = entry => {
    const providerId=providerIdOf(entry);
    const message=stateStore.getProvider(providerId)?.lastError;
    return message ? {providerId,message} : null;
  };
  /** @param {string} providerId @param {ProviderConfiguration} configuration */
  const driverFor = (providerId,configuration) => {
    if(configuration.driver!=='strata'||!configuration.installationDirectory)
      throw new Error(`Stored provider ${providerId} cannot be released without its Strata configuration.`);
    return createStrataDriver({installationDirectory:configuration.installationDirectory});
  };
  const releaseEndedProviders = async () => {
    if(!providersAwaitingRelease.size)return;
    const configurations=await providerConfigurations();
    for(const providerId of [...providersAwaitingRelease]){
      let active=activeProviders.get(providerId);
      try {
        if(!active){
          const stored=stateStore.getProvider(providerId);
          if(!stored?.leaseKey){providersAwaitingRelease.delete(providerId);continue;}
          if(!stored.controllerUrl)throw new Error(`Stored provider ${providerId} has no controller address for its lease.`);
          const lease={providerId,controllerUrl:stored.controllerUrl,leaseKey:stored.leaseKey};
          const driver=driverFor(providerId,configurations[providerId]??{});
          active={lease,driver,responsesUrl:null,persisted:true,released:false};
          activeProviders.set(providerId,active);
        }
        if(!active.released){
          if(active.responsesUrl===null)await active.driver.status(active.lease);
          await active.driver.release(active.lease);
          active.released=true;
        }
        if(active.persisted)stateStore.deleteProvider(providerId);
        activeProviders.delete(providerId);
        providersAwaitingRelease.delete(providerId);
      } catch(error) {
        recordProviderError(providerId,error);
        throw error;
      }
    }
  };
  const closeSharedServer = async () => {
    if([...runs.values()].some(entry=>occupied(entry)||entry.pendingWork>0))
      throw new Error('Background Agent root or work remains before shared App Server closure.');
    const processState=await nativeSessions.observeServer();
    const hasLease=activeProviders.size>0||providersAwaitingRelease.size>0
      ||stateStore.listProviders().some(provider=>provider.leaseKey!==null);
    if(processState==='running'&&!sharedServerOpen)
      throw new Error('Earlier App Server is not owned by this manager.');
    if(processState==='ended'||processState==='unknown'
      ||processState==='absent'&&(sharedServerOpen||hasLease))
      throw new Error('Shared App Server exited outside normal closure; retain its identity and provider leases for startup recovery.');
    if(!sharedServerOpen && providersAwaitingRelease.size)
      throw new Error('Earlier App Server provider recovery requires a new startup request.');
    for(const providerId of activeProviders.keys())providersAwaitingRelease.add(providerId);
    for(const lease of stateStore.listProviders())if(lease.leaseKey!==null)providersAwaitingRelease.add(lease.providerId);
    await releaseEndedProviders();
    await nativeSessions.close();
    sharedServerOpen=false;
  };
  const scheduleIdleClose = () => {
    cancelIdleClose();
    if ((!sharedServerOpen&&!activeProviders.size) || [...runs.values()].some(entry=>occupied(entry)||entry.pendingWork>0)) return;
    idleCloseTimer=clock.setTimeout(()=>{
      idleCloseTimer=null;
      void serial(async()=>{
        if ((!sharedServerOpen&&!activeProviders.size)||[...runs.values()].some(entry=>occupied(entry)||entry.pendingWork>0)) return;
        try {await closeSharedServer();}
        catch { /* Preserve the shared process as unknown; the factory prevents a second spawn. */ }
      });
    },60_000);
    idleCloseTimer?.unref?.();
  };
  /** @param {string} providerId */
  const admit = async providerId => {
    if (maintenance) throw new Error('Background Agent maintenance is in progress.');
    if (coldProcessExitUnverified) throw new Error('Earlier App Server exit could not be confirmed.');
    stateStore.assertCanAccept();
    cancelIdleClose();
    const configuration=(await providerConfigurations())[providerId];
    /** @param {string|null} target @param {number} limit */
    const ensureCapacity = async (target,limit) => {
      const matches=/** @param {Entry} entry */ (entry)=>target===null||entry.settings.modelProvider===target;
      if([...runs.values()].filter(entry=>occupied(entry)&&matches(entry)).length<limit)return;
      const candidates=[...runs.values()].filter(entry=>matches(entry)&&(entry.state==='running'||entry.state==='idle'))
        .sort((a,b)=>a.lastUsedAtMs-b.lastUsedAtMs);
      for(const candidate of candidates){
        if(!await unloadSafely(candidate))continue;
        if([...runs.values()].filter(entry=>occupied(entry)&&matches(entry)).length<limit)return;
      }
      throw new Error(target===null?'Background Agent capacity is exhausted.':`Provider ${target} capacity is exhausted.`);
    };
    if(configuration?.maxInstances!==undefined)await ensureCapacity(providerId,configuration.maxInstances);
    await ensureCapacity(null,maxInstances);
  };
  /** @param {Entry} entry */
  const prepareProvider = entry => providerSerial(async() => {
    const providerId=providerIdOf(entry);
    const modelId=modelIdOf(entry);
    const configuration=(await providerConfigurations())[providerId];
    if(configuration?.driver!=='strata')return undefined;
    /** @type {string|null} */
    let controllerUrl=null;
    try {
      const driver=driverFor(providerId,configuration);
      let active=activeProviders.get(providerId);
      if(!active){
        const connected=await driver.connect();
        controllerUrl=connected.controllerUrl;
        const acquired=await driver.acquire({controllerUrl:connected.controllerUrl});
        active={lease:{providerId,controllerUrl:connected.controllerUrl,leaseKey:acquired.leaseKey},
          driver,responsesUrl:connected.responsesUrl,persisted:false,released:false};
        activeProviders.set(providerId,active);
      }
      if(!active.persisted){
        stateStore.saveProvider(active.lease);
        active.persisted=true;
      }
      const observed=await active.driver.status(active.lease);
      if(observed.status!=='running'||observed.model!==modelId){
        const conflicting=[...runs.values()].some(other=>other!==entry&&other.settings.modelProvider===providerId
          &&(other.native||other.pendingWork>0||['starting','stopping','unknown'].includes(other.state)));
        if(conflicting)throw new Error(`Provider ${providerId} cannot switch models while its Agent work is loaded or pending.`);
        if(observed.status==='running'||observed.status==='partial')await active.driver.stop(active.lease);
        await active.driver.start({...active.lease,modelId});
        const confirmed=await active.driver.status(active.lease);
        if(confirmed.status!=='running'||confirmed.model!==modelId)
          throw new Error(`Provider ${providerId} did not confirm the requested model.`);
      }
      if(active.responsesUrl===null)throw new Error(`Provider ${providerId} connection is unavailable.`);
      stateStore.updateProviderError({providerId,lastError:null});
      return {providerId,baseUrl:active.responsesUrl,leaseKey:active.lease.leaseKey};
    } catch(error) {
      recordProviderError(providerId,error,controllerUrl);
      throw error;
    }
  });
  /** @param {Entry} entry */
  const openNative = async entry => {
    if (entry.native) return;
    update(entry,{state:'starting'});
    let nativeRequestAttempted=false;
    try {
      // A Claude session runs its own process per turn and needs no shared App Server.
      if(!isClaudeSettings(entry.settings)){
        await nativeSessions.ensureServer({onPreviousExit:async()=>{
          for(const providerId of activeProviders.keys())providersAwaitingRelease.add(providerId);
          for(const provider of stateStore.listProviders())if(provider.leaseKey!==null)providersAwaitingRelease.add(provider.providerId);
          await releaseEndedProviders();
        }});
        sharedServerOpen=true;
      }
      const providerConnection=await prepareProvider(entry);
      nativeRequestAttempted=true;
      entry.native=await nativeSessions.open({settings:/** @type {NativeSettings} */(/** @type {unknown} */(entry.settings)),role:entry.role,cwd:entry.cwd,readPaths:entry.readPaths,
        writePaths:entry.writePaths,runId:entry.runId,providerConnection,onNotification:notification=>notify(entry,notification)});
      update(entry,{state:'running',lastUsedAtMs:clock.now()});
      await refreshOwner(entry);
    } catch(error) {
      update(entry,nativeRequestAttempted?{state:'unknown'}:{state:'exited',taskState:'unknown'});
      if(!nativeRequestAttempted)scheduleIdleClose();
      throw error;
    }
  };
  /** @param {Entry} entry @param {boolean} [verify] */
  const restoreNative = async (entry,verify=true) => {
    if(verify && entry.recoveryPath) await verifyRecovery(entry);
    if(['running','idle'].includes(entry.state)&&entry.native) return;
    if(entry.state!=='exited') throw new Error('Agent environment cannot be safely restored.');
    if(!entry.threadId||!entry.instructions) throw new Error('Original native thread identity is unavailable.');
    await admit(providerIdOf(entry));
    await openNative(entry);
    try {
      const restored=await /** @type {NativeSession} */(entry.native).resume({threadId:entry.threadId,
        expectedSessionPath:entry.sessionPath,instructions:entry.instructions});
      if(restored.threadId!==entry.threadId||(entry.sessionPath!==null&&restored.sessionPath!==entry.sessionPath))
        throw new Error('Original native thread changed.');
      update(entry,{sessionPath:restored.sessionPath});
      await saveRecovery(entry);
    } catch(error) {
      try {await unload(entry);}catch {update(entry,{state:'unknown'});}
      throw error;
    }
  };
  /** @param {Entry} entry @param {'main-to-agent'|'agent-to-main'} direction @param {string} body @param {import('./message-store.mjs').MessageSource} [source] */
  const accept = (entry,direction,body,source=direction==='agent-to-main'?'agent':'main') => {
    if(maintenance)throw new Error('Background Agent maintenance is in progress.');
    stateStore.assertCanAccept();
    if(typeof body!=='string'||!body.trim()) throw new Error('Background Agent message must be nonempty text.');
    const messageId=randomUUID();
    const message=stateStore.acceptMessage({messageId,runId:entry.runId,sequence:nextSequence(entry),
      direction,body,source,threadId:entry.threadId,turnId:entry.taskState==='working'&&entry.providerWork?.paused!==true?entry.turnId:null});
    wake(entry);
    return message;
  };
  /** @param {Entry} entry @param {MessageRow} message @param {boolean} [onlyActive] */
  const dispatch = async (entry,message,onlyActive=false) => {
    let nativeRequestAttempted=false;
    try {
      if(!entry.native||!entry.threadId) throw new Error('Original native thread identity is unavailable.');
      const facts=await refreshSnapshot(entry);
      if(!facts.factsComplete) throw new Error('Native Agent facts are incomplete.');
      const root=facts.members.find(member=>member.threadId===entry.threadId);
      if(!root) throw new Error('Original native thread is missing.');
      if(onlyActive && root.state!=='active') throw new Error('Active native turn ended before message delivery.');
      if(message.turnId!==null && (root.state!=='active'||root.turnId!==message.turnId))
        throw new Error('Active native turn changed.');
      if(entry.protectedTurnId!==null && (root.state!=='active'||root.turnId!==entry.protectedTurnId))
        throw new Error('The protected native turn has not been released.');
      const prior=onlyActive?[]:stateStore.pendingDelivery({runId:entry.runId,direction:'main-to-agent'})
        .filter(item=>item.messageId!==message.messageId&&item.sequence<message.sequence)
        .filter(item=>{
          if(item.turnId===null||root.state==='active'&&root.turnId===item.turnId)return true;
          // A saved acceptance does not prove that a native request was never attempted.
          stateStore.updateMessage(item.messageId,{deliveryStatus:'unknown'});
          return false;
        });
      const instruction=[...prior,message].map(item=>`ARW messageId: ${item.messageId}\n\n${item.body}`).join('\n\n');
      nativeRequestAttempted=true;
      const continuing=root.state==='active';
      const taskStartedAtMs=continuing?entry.taskStartedAtMs:clock.now();
      const result=continuing
        ? await entry.native.steer({threadId:entry.threadId,turnId:/** @type {string} */(root.turnId),instruction})
        : await entry.native.startTurn({threadId:entry.threadId,handoff:instruction});
      if(entry.deadlineStopWork)throw new Error('The root stopped while its native instruction was pending.');
      stateStore.updateMessage(message.messageId,{deliveryStatus:'delivered',threadId:entry.threadId,turnId:result.turnId});
      for(const queued of prior)stateStore.updateMessage(queued.messageId,
        {deliveryStatus:'delivered',threadId:entry.threadId,turnId:result.turnId});
      update(entry,{turnId:result.turnId,taskState:'working',taskStartedAtMs,
        taskFinishedAtMs:null,lastUsedAtMs:clock.now()});
    } catch(error) {
      stateStore.updateMessage(message.messageId,{deliveryStatus:nativeRequestAttempted?'unknown':'failed'});
      if(!onlyActive&&!entry.deadlineStopWork)update(entry,{taskState:'unknown'});
    }
  };
  /** @param {Entry} entry @param {() => Promise<void>} task */
  const queueWork = (entry,task) => {
    entry.pendingWork++;
    entry.work=entry.work.then(task,task).finally(()=>{
      entry.pendingWork--;
      if(entry.pendingWork===0)scheduleIdleClose();
      void serial(async()=>reapExited()).catch(()=>{});
    });
    void entry.work.catch(()=>{if(entry.state!=='exited')update(entry,{state:'unknown'});});
  };
  /** @param {Entry} entry */
  const queueResume = entry => {
    if(!entry.onResumeTask||typeof entry.providerWork?.resumeMessageId!=='string'
      ||entry.resumeWorkScheduled===entry.providerWork.resumeMessageId)return;
    const message=stateStore.getMessage(entry.providerWork.resumeMessageId);
    if(!message||!['accepted','unknown'].includes(message.deliveryStatus))return;
    entry.resumeWorkScheduled=message.messageId;
    queueWork(entry,async()=>{
      try {await entry.onResumeTask?.();}
      finally {if(entry.resumeWorkScheduled===message.messageId)entry.resumeWorkScheduled=null;}
    });
  };
  /** @param {Entry} entry */
  const holdManagedWork = entry => {
    if(entry.state==='stopping')throw new Error('Managed root is stopping and cannot reserve new work.');
    /** @type {()=>void} */let finish=()=>{};
    const done=new Promise(resolve=>{finish=()=>resolve(undefined);});
    entry.pendingWork++;
    entry.callerReservations++;
    entry.work=Promise.allSettled([entry.work,done]).then(()=>{});
    let released=false;
    return ()=>{
      if(released)return;
      released=true;
      entry.pendingWork--;
      entry.callerReservations--;
      finish();
      if(entry.pendingWork===0)scheduleIdleClose();
      void serial(async()=>reapExited()).catch(()=>{});
    };
  };
  /** @param {Entry} entry @param {number} cursor */
  const observation = (entry,cursor) => {
    const messages=stateStore.messagesAfter({runId:entry.runId,direction:'agent-to-main',sequence:cursor});
    /** @type {ManagedObservation['notifications']} */
    const notices=messages.map(message=>({sequence:message.sequence,type:/** @type {const} */('message'),messageId:message.messageId,source:message.source,
      threadId:message.threadId,turnId:message.turnId,text:message.body,
      deliveryStatus:message.deliveryStatus,persistenceStatus:message.persistenceStatus}));
    if(entry.stateVersion>cursor) notices.push({sequence:entry.stateVersion,type:'changed',
      threadId:entry.threadId,turnId:entry.turnId});
    notices.sort((a,b)=>a.sequence-b.sequence);
    return {notifications:notices,cursor:Math.max(cursor,entry.stateVersion,...notices.map(notice=>notice.sequence)),
      pendingRequests:entry.snapshot?.clientRequests??[]};
  };
  /** @param {Entry} entry @param {number} cursor @param {AbortSignal|undefined} signal */
  const awaitChange = (entry,cursor,signal) => new Promise(resolve=>{
    const current=observation(entry,cursor);
    if(signal?.aborted||current.cursor>cursor||current.pendingRequests.length||entry.taskState==='ended'){resolve(undefined);return;}
    const wakeWaiter=()=>{entry.waiters.delete(wakeWaiter);signal?.removeEventListener('abort',wakeWaiter);resolve(undefined);};
    entry.waiters.add(wakeWaiter);signal?.addEventListener('abort',wakeWaiter,{once:true});
    const after=observation(entry,cursor);
    if(after.cursor>cursor||after.pendingRequests.length) wakeWaiter();
  });
  /** @param {Entry} entry @param {MessageRow} message */
  const prepareTask = async (entry,message) => {
    if(message.runId!==entry.runId || message.direction!=='main-to-agent' || message.deliveryStatus!=='accepted')
      throw new Error('Accepted Background Agent task was not found.');
    const changes=entry.taskOptions.get(message.messageId)??{};
    const patch=/** @type {Partial<AgentRow>} */ ({});
    for(const key of /** @type {const} */ (['instructions','settings','cwd','readPaths','writePaths'])) {
      if(changes[key]!==undefined) /** @type {Record<string,unknown>} */ (patch)[key]=changes[key];
    }
    const altered=Object.entries(patch).some(([key,value])=>!jsonSemanticallyEqual(/** @type {Record<string,unknown>} */(entry)[key],value));
    if(altered && entry.native){
      if(!await unloadSafely(entry,true))throw new Error('Native root is not safely idle for new task settings.');
    }
    if(altered && entry.recoveryPath && entry.threadId) await verifyRecovery(entry);
    if(altered) update(entry,patch);
    if(entry.state==='exited') await restoreNative(entry,!altered);
    if(!entry.native||!entry.threadId)throw new Error('Original native thread identity is unavailable.');
    entry.taskOptions.delete(message.messageId);
    return {threadId:entry.threadId,sessionPath:entry.sessionPath};
  };
  /** @param {Entry} entry */
  const proxy = entry => /** @type {ManagedNativeSession} */ (new Proxy({
    runId:entry.runId, get previous(){return {runId:entry.runId,threadId:entry.threadId,sessionPath:entry.sessionPath};},
    detach:()=>{},managementState:()=>entry.state,
    holdManagedWork:()=>holdManagedWork(entry),
    setTaskMeasurement:read=>{entry.readTaskMeasurement=read;},
    getTaskStartedAt:()=>entry.taskStartedAtMs,
    providerWorkClock:()=>clock,
    getProviderWork:()=>entry.providerWork??null,
    saveProviderWork:state=>{update(entry,{providerWork:state});},
    restoreCurrentTask:()=>serial(async()=>{await restoreNative(entry,false);}),
    getTaskMessage:messageId=>{const message=stateStore.getMessage(messageId);return message?.runId===entry.runId?message:null;},
    setResumeHandler:(handler,resumePending=true)=>{const initial=!entry.onResumeTask;entry.onResumeTask=handler;
      if(initial&&resumePending)queueResume(entry);},
    noteEarlyExit:({turnId})=>serial(async()=>{
      const state=entry.providerWork??{};
      if(state.lastEarlyExitTurnId===turnId)return state.paused===true;
      const count=Number(state.earlyExitCount??0)+1;
      const boundary=typeof state.nextEarlyExitNotificationCount==='number'?state.nextEarlyExitNotificationCount:earlyExitNotificationThreshold;
      const pause=count>=boundary;
      const message=pause?accept(entry,'agent-to-main',`The Reviewer runtime paused this same task after ${count} normally completed turns without full report delivery. Ask the user whether to continue. After approval, send this task an ordinary work message; to end it, interrupt the original task.`, 'provider-program'):null;
      update(entry,{providerWork:{...state,earlyExitCount:count,lastEarlyExitTurnId:turnId,
        ...(pause?{paused:true,pauseMessageId:message?.messageId,nextEarlyExitNotificationCount:count+5}: {})}});
      return pause;
    }),
    recoverContinuation:({rootThreadId,endedTurnId})=>serial(async()=>{
      const state=entry.providerWork;
      if(state?.continuationTurnId!==endedTurnId||typeof state.continuationMessageId!=='string')return null;
      const message=stateStore.getMessage(state.continuationMessageId);
      if(!message||message.runId!==entry.runId||message.threadId!==rootThreadId)return null;
      if(!entry.native)return null;
      const facts=await entry.native.snapshot({rootThreadId,knownThreadIds:entry.knownThreadIds});
      const root=facts.members.find(member=>member.threadId===rootThreadId);
      if(!facts.factsComplete||!root?.turnId||root.turnId===endedTurnId)return null;
      const seen=message.deliveryStatus==='delivered'&&message.turnId===root.turnId
        ||facts.userMessages?.some(item=>item.threadId===rootThreadId&&item.turnId===root.turnId
          &&item.text.startsWith(`ARW messageId: ${message.messageId}\n`));
      if(!seen)return null;
      stateStore.updateMessage(message.messageId,{deliveryStatus:'delivered',threadId:rootThreadId,turnId:root.turnId});
      entry.protectedTurnId=root.turnId;
      update(entry,{turnId:root.turnId,taskState:'working',providerWork:{...state,paused:false,resumeMessageId:null}});
      return root.turnId;
    }),
    createProviderWorkPolicy:callbacks=>entry.providerTaskSupport&&entry.providerWork
      ?entry.providerTaskSupport.createPolicy({...callbacks,clock,readWorkState:()=>entry.providerWork??null,
        saveWorkState:state=>update(entry,{providerWork:state}),
        readInstructionStatus:async messageId=>{const message=stateStore.getMessage(messageId);
          return message?.runId===entry.runId&&message.direction==='main-to-agent'&&message.source==='provider-program'
            ?message.deliveryStatus:null;}}):null,
    configureReviewerTask:async({identityKind,stateDirectory,compactBinding=null,restore=false,messageId})=>{
      const pending=messageId?entry.taskOptions.get(messageId):undefined;
      const selected=pending?.settings??/** @type {NativeSettings} */(entry.settings);
      const provider=(await providerConfigurations())[selected.modelProvider];
      const support=reviewerTaskSupport(provider);entry.providerTaskSupport=support;
      if(!support){if(!restore)update(entry,{providerWork:null});return {enabled:false,settings:selected,compactBinding:null};}
      if(!entry.native&&!entry.threadId) {
        await nativeSessions.ensureServer({onPreviousExit:async()=>{
          for(const providerId of activeProviders.keys())providersAwaitingRelease.add(providerId);
          for(const held of stateStore.listProviders())if(held.leaseKey!==null)providersAwaitingRelease.add(held.providerId);
          await releaseEndedProviders();
        }});
        sharedServerOpen=true;
        await prepareProvider(entry);
      }
      const prepared=await support.prepare({settings:selected,stateDirectory,identityKind,binding:compactBinding,restore,workState:entry.providerWork??null});
      if(pending)pending.settings=prepared.settings;
      else update(entry,{settings:prepared.settings});
      update(entry,{providerWork:prepared.workState});
      await saveRecovery(entry);
      return {enabled:true,settings:prepared.settings,compactBinding:prepared.compactBinding};
    },
    sendProgramInstruction:async({threadId,turnId,instruction,messageId,onAccepted})=>{
      const message=await serial(async()=>{
        const support=reviewerTaskSupport((await providerConfigurations())[providerIdOf(entry)]);
        if(entry.threadId!==threadId||entry.turnId!==turnId||entry.state==='stopping'||support?.canSendInstruction(entry.providerWork)===false)throw new Error('Program instruction no longer belongs to the active task.');
        if(messageId) {
          const prior=stateStore.getMessage(messageId);
          if(!prior||prior.runId!==entry.runId||prior.direction!=='main-to-agent'||prior.source!=='provider-program'
            ||prior.threadId!==threadId||entry.protectedTurnId!==turnId)
            throw new Error('The original program instruction is unavailable.');
          if(prior.deliveryStatus==='delivered')return prior;
          if(prior.deliveryStatus!=='failed')throw new Error('The original program instruction delivery remains unverified.');
          const retried=stateStore.updateMessage(messageId,{deliveryStatus:'accepted',threadId,turnId});
          onAccepted(messageId);return retried;
        }
        const accepted=accept(entry,'main-to-agent',instruction,'provider-program');
        onAccepted(accepted.messageId);return accepted;
      });
      if(message.deliveryStatus==='delivered')return;
      await serial(async()=>dispatch(entry,message,true));
      const result=stateStore.getMessage(message.messageId);
      if(result?.deliveryStatus!=='delivered')throw new Error('Program instruction delivery is unverified.');
    },
    continueTask:({rootThreadId,endedTurnId,instruction,onAccepted,compactBinding,canContinue,messageId})=>serial(async()=>{
      if(entry.threadId!==rootThreadId||entry.turnId!==endedTurnId||entry.protectedTurnId!==endedTurnId
        ||entry.state==='stopping'||entry.state==='exited')
        throw new Error('The protected original task cannot continue.');
      const support=reviewerTaskSupport((await providerConfigurations())[providerIdOf(entry)]);
      const facts=await refreshSnapshot(entry);
      const root=facts.members.find(member=>member.threadId===rootThreadId);
      const mayContinue=root&&(support?support.canContinue(root,entry.providerWork):root.state!=='failed'||root.retryableModelFailure);
      if(!facts.factsComplete||!root||root.turnId!==endedTurnId||root.state==='active'||root.state==='interrupted'||!mayContinue)
        throw new Error('The original completed native turn is unavailable for continuation.');
      if(root.state==='failed') {
        const safe=await /** @type {NativeSession} */(entry.native).idleFacts({rootThreadId,knownThreadIds:entry.knownThreadIds});
        if(!safe.known||!safe.safe)throw new Error('Failed native work still has unverified tool or interaction effects.');
      }
      await support?.verifyBinding(compactBinding);
      const previous=messageId?stateStore.getMessage(messageId):null;
      if(messageId&&(!previous||previous.runId!==entry.runId||previous.source!=='main'||previous.deliveryStatus!=='accepted'))
        throw new Error('The original Main work message cannot resume this task.');
      const message=previous??accept(entry,'main-to-agent',instruction,'provider-program');
      update(entry,{providerWork:{...entry.providerWork,continuationTurnId:endedTurnId,continuationMessageId:message.messageId}});
      onAccepted(message.messageId);
      let nativeRequestAttempted=false;
      try {
        if(canContinue?.()===false||entry.threadId!==rootThreadId||entry.turnId!==endedTurnId
          ||entry.protectedTurnId!==endedTurnId||['stopping','exited'].includes(entry.state)
          ||support?.canContinue(root,entry.providerWork)===false)
          throw new Error('The protected original task can no longer continue.');
        nativeRequestAttempted=true;
        const result=await /** @type {NativeSession} */(entry.native).startTurn({threadId:rootThreadId,handoff:`ARW messageId: ${message.messageId}\n\n${instruction}`});
        if(entry.deadlineStopWork)throw new Error('The original root stopped while its turn start was pending.');
        entry.protectedTurnId=result.turnId;
        stateStore.updateMessage(message.messageId,{deliveryStatus:'delivered',threadId:rootThreadId,turnId:result.turnId});
        update(entry,{turnId:result.turnId,taskState:'working',taskFinishedAtMs:null,lastUsedAtMs:clock.now(),
          providerWork:{...entry.providerWork,paused:false,resumeMessageId:null}});
        return {...result,deliveryStatus:'delivered'};
      } catch(error) {
        stateStore.updateMessage(message.messageId,{deliveryStatus:nativeRequestAttempted?'unknown':'failed'});throw error;
      }
    }),
    observe:({cursor})=>serial(async()=>observation(entry,cursor)),
    waitNotifications:async({cursor,timeoutMs=30_000,signal})=>{
      if(!Number.isSafeInteger(timeoutMs)||timeoutMs<10_000||timeoutMs>3_600_000)
        throw new Error('wait_agent timeout_ms must be between 10000 and 3600000.');
      const current=observation(entry,cursor);
      if(current.cursor<=cursor && !current.pendingRequests.length && entry.taskState!=='ended' && !signal?.aborted){
        const timeout=new AbortController();
        const timer=clock.setTimeout(()=>timeout.abort(),timeoutMs);
        timer?.unref?.();
        const abort=()=>timeout.abort();
        signal?.addEventListener('abort',abort,{once:true});
        try{await awaitChange(entry,cursor,timeout.signal);}
        finally{clock.clearTimeout(timer);signal?.removeEventListener('abort',abort);}
      }
      return observation(entry,cursor);
    },
    acceptStart:({handoff,instructions})=>serial(async()=>{
      if(entry.threadId||entry.instructions) throw new Error('Native thread has already started.');
      try {
        update(entry,{instructions});
        const message=accept(entry,'main-to-agent',handoff);
        return {runId:entry.runId,messageId:message.messageId,deliveryStatus:'accepted',recoveryPath:entry.recoveryPath};
      } catch(error) {
        update(entry,{state:'exited',taskState:'ended',taskFinishedAtMs:clock.now()});
        throw error;
      }
    }),
    acceptTask:({handoff,turnId,instructions,settings,cwd,readPaths,writePaths})=>serial(async()=>{
      if(entry.protectedTurnId!==null)throw new Error('The protected native turn has not been released.');
      if(!entry.threadId || entry.state==='unknown'||entry.state==='starting'||entry.state==='stopping')
        throw new Error('Original native thread identity is unavailable.');
      if(entry.native){
        const facts=await refreshSnapshot(entry);
        if(!facts.factsComplete)throw new Error('Native Agent facts are incomplete.');
        const root=facts.members.find(member=>member.threadId===entry.threadId);
        if(!root)throw new Error('Original native thread is missing.');
        if(root.state==='active'&&root.turnId!==turnId)throw new Error('Active native turn changed.');
        if(root.state==='active' && (instructions!==undefined&&instructions!==entry.instructions
          ||settings!==undefined&&!jsonSemanticallyEqual(settings,entry.settings)
          ||cwd!==undefined&&cwd!==entry.cwd
          ||readPaths!==undefined&&!jsonSemanticallyEqual(readPaths,entry.readPaths)
          ||writePaths!==undefined&&!jsonSemanticallyEqual(writePaths,entry.writePaths)))
          throw new Error('Active native turn cannot change its run settings.');
      }
      const message=accept(entry,'main-to-agent',handoff);
      entry.taskOptions.set(message.messageId,{instructions,settings,cwd,readPaths,writePaths});
      return {runId:entry.runId,messageId:message.messageId,deliveryStatus:'accepted'};
    }),
    prepareForTask:({messageId})=>serial(async()=>{
      if(entry.protectedTurnId!==null)throw new Error('The protected native turn has not been released.');
      const message=stateStore.getMessage(messageId);
      if(!message)throw new Error('Accepted Background Agent task was not found.');
      return prepareTask(entry,message);
    }),
    failAcceptedTask:({messageId})=>serial(async()=>{
      const message=stateStore.getMessage(messageId);
      if(!message||message.runId!==entry.runId||message.direction!=='main-to-agent')
        throw new Error('Accepted Background Agent task was not found.');
      if(message.deliveryStatus==='accepted')stateStore.updateMessage(messageId,{deliveryStatus:'failed'});
      entry.taskOptions.delete(messageId);
      if(!entry.threadId&&!entry.native)update(entry,{state:'exited',taskState:'ended',taskFinishedAtMs:clock.now()});
    }),
    prepareNativeStart:async()=>{
      if(!entry.native) await openNative(entry);
      const started=await /** @type {NativeSession} */(entry.native).start({instructions:/** @type {string} */(entry.instructions)});
      if([...runs.values()].some(other=>other!==entry&&other.threadId===started.threadId))
        throw new Error('Native thread is already managed by another run.');
      update(entry,{threadId:started.threadId,sessionPath:started.sessionPath});
      await saveRecovery(entry);
      return started;
    },
    dispatchAccepted:async({messageId})=>{
      const message=stateStore.getMessage(messageId);
      if(!message||message.runId!==entry.runId||message.direction!=='main-to-agent'||message.deliveryStatus!=='accepted')
        throw new Error('Accepted Background Agent instruction was not found.');
      await dispatch(entry,message);
      for(const queued of stateStore.pendingDelivery({runId:entry.runId,direction:'main-to-agent'}))
        if(queued.messageId!==messageId && queued.sequence>message.sequence)
          await dispatch(entry,queued,true);
      return {turnId:entry.turnId,messageId,deliveryStatus:stateStore.getMessage(messageId)?.deliveryStatus};
    },
    start:({instructions})=>serial(async()=>{
      if(!entry.native) await openNative(entry);
      const result=await /** @type {NativeSession} */(entry.native).start({instructions});
      update(entry,{instructions,threadId:result.threadId,sessionPath:result.sessionPath});
      return result;
    }),
    resume:({threadId,expectedSessionPath,instructions})=>serial(async()=>{
      if(!entry.native) await openNative(entry);
      const result=await /** @type {NativeSession} */(entry.native).resume({threadId,expectedSessionPath,instructions});
      if([...runs.values()].some(other=>other!==entry&&other.threadId===result.threadId))
        throw new Error('Native thread is already managed by another run.');
      update(entry,{instructions,threadId:result.threadId,sessionPath:result.sessionPath});
      return result;
    }),
    startTurn:({threadId,handoff})=>serial(async()=>{
      if(threadId!==entry.threadId) throw new Error('Native thread identity changed.');
      const message=accept(entry,'main-to-agent',handoff);
      await dispatch(entry,message);
      return {turnId:entry.turnId,messageId:message.messageId,
        deliveryStatus:stateStore.getMessage(message.messageId)?.deliveryStatus,
        persistenceStatus:stateStore.getMessage(message.messageId)?.persistenceStatus};
    }),
    steer:({threadId,turnId,instruction})=>serial(async()=>{
      if(threadId!==entry.threadId||turnId!==entry.turnId) throw new Error('Active native turn changed.');
      const message=accept(entry,'main-to-agent',instruction);
      await dispatch(entry,message);
      return {turnId:entry.turnId,messageId:message.messageId,
        deliveryStatus:stateStore.getMessage(message.messageId)?.deliveryStatus,
        persistenceStatus:stateStore.getMessage(message.messageId)?.persistenceStatus};
    }),
    snapshot:({rootThreadId})=>serial(async()=>{
      if(rootThreadId!==entry.threadId) throw new Error('Native thread identity changed.');
      if(entry.native) return refreshSnapshot(entry);
      if(entry.snapshot) return entry.snapshot;
      throw new Error('Native environment facts are unavailable.');
    }),
    respond:({requestId,response})=>serial(async()=>{
      if(!entry.native) throw new Error('Native request is no longer pending.');
      return entry.native.respond({requestId,response});
    }),
    rejectRequest:({requestId,reason})=>serial(async()=>{
      if(!entry.native) throw new Error('Native request is no longer pending.');
      return entry.native.rejectRequest({requestId,reason});
    }),
    readThreadMetadata:({threadId})=>serial(async()=>{
      if(!entry.native) throw new Error('Native environment is unavailable.');
      return entry.native.readThreadMetadata({threadId});
    }),
    idleFacts:({rootThreadId,knownThreadIds})=>serial(async()=>{
      if(!entry.native) return {safe:false,known:false,reason:'Native environment is unavailable.'};
      return entry.native.idleFacts({rootThreadId,knownThreadIds});
    }),
    protectTurn:({rootThreadId,turnId})=>serial(async()=>{
      if(!entry.native||entry.threadId!==rootThreadId||entry.turnId!==turnId
        ||entry.protectedTurnId!==null&&entry.protectedTurnId!==turnId)
        throw new Error('The managed native turn changed before protection.');
      entry.protectedTurnId=turnId;
      return {confirmed:/** @type {true} */(true)};
    }),
    cleanupTurnTerminals:async({rootThreadId,turnId,knownThreadIds})=>{
      await serial(async()=>{
        if(!entry.native||entry.threadId!==rootThreadId||entry.turnId!==turnId||entry.protectedTurnId!==turnId)
          throw new Error('The protected native turn changed before terminal cleanup.');
      });
      const confirmed=await /** @type {NativeSession} */ (entry.native).cleanupTurnTerminals({rootThreadId,turnId,knownThreadIds});
      await serial(async()=>{
        if(entry.threadId!==rootThreadId||entry.turnId!==turnId||entry.protectedTurnId!==turnId)
          throw new Error('The protected native turn changed during terminal cleanup.');
      });
      return confirmed;
    },
    releaseProtectedTurn:({rootThreadId,turnId})=>serial(async()=>{
      if(!entry.native||entry.threadId!==rootThreadId||entry.turnId!==turnId||entry.protectedTurnId!==turnId)
        throw new Error('The protected native turn changed before release.');
      const idle=await entry.native.idleFacts({rootThreadId,knownThreadIds:entry.knownThreadIds});
      if(!idle.safe||!idle.known)throw new Error(idle.reason??'Native idle facts are unavailable.');
      entry.protectedTurnId=null;
      update(entry,{taskState:'ended',taskFinishedAtMs:entry.taskFinishedAtMs??clock.now(),state:'idle'});
      return {confirmed:/** @type {true} */(true)};
    }),
    interruptGroup:({rootThreadId,turnId})=>serial(async()=>{
      if(!entry.native) throw new Error('Native environment is unavailable.');
      return entry.native.interruptGroup({rootThreadId,turnId});
    }),
    stop:()=>serial(async()=>{await unload(entry);scheduleIdleClose();return {environmentState:'exited'};}),
    stopForDeadline:({rootThreadId})=>{
      if(entry.threadId!==rootThreadId)throw new Error('Deadline stop does not identify the original root.');
      const work=entry.deadlineStopWork??={pending:null};
      if(!work.pending){
        const pending=unload(entry,undefined,true).then(()=>{scheduleIdleClose();});
        work.pending=pending;
        void pending.catch(()=>{if(work.pending===pending)work.pending=null;});
      }
      return work.pending.then(()=>({environmentState:/** @type {const} */('exited')}));
    },
  },{get(target,property,receiver){
    const value=Reflect.get(target,property,receiver);
    if(typeof value!=='function'||property==='managementState'||property==='detach')return value;
    return (/** @type {any[]} */...args)=>{
      if(runs.get(entry.runId)!==entry)throw new Error('Managed Agent handle was released; reattach the original run.');
      return value(...args);
    };
  }}));
  /** @param {{ownerId:string,controllerId:string,role:string,ownerTitle?:string|null,settings:NativeSettings,cwd:string,
   * readPaths:string[],writePaths:string[],stateDirectory?:string,onNotification:(notification:NativeNotification)=>void,onUnloaded?:()=>void,
   * onClientRequests?:Entry['onClientRequests']}} input */
  const openManaged=input=>serial(async()=>{
    await admit(input.settings.modelProvider);
    const runId=randomUUID(), now=clock.now();
    const entry=/** @type {Entry} */ ({
      runId,ownerId:input.ownerId,role:input.role,ownerTitle:input.ownerTitle??null,ownerSessionPath:null,
      threadId:null,turnId:null,sessionPath:null,settings:input.settings,cwd:input.cwd,
      readPaths:input.readPaths,writePaths:input.writePaths,instructions:'',
      recoveryPath:input.stateDirectory?backgroundAgentRecoveryPath({stateDirectory:input.stateDirectory,runId}):null,
      state:'starting',taskState:'not-started',stateVersion:0,lastUsedAtMs:now,
      taskStartedAtMs:null,taskFinishedAtMs:null,knownThreadIds:[],native:null,snapshot:null,
      onNotification:input.onNotification,onUnloaded:input.onUnloaded,onClientRequests:input.onClientRequests,
      waiters:new Set(),work:Promise.resolve(),pendingWork:0,callerReservations:0,taskOptions:new Map(),
      protectedTurnId:null,
    });
    runs.set(runId,entry);stateStore.upsertAgent(row(entry));
    return proxy(entry);
  });
  /** @param {{runId?:string,threadId:string,expectedSessionPath:string|null,ownerId:string,controllerId:string,role?:string,settings:NativeSettings,
   * cwd:string,readPaths:string[],writePaths:string[],instructions?:string,onNotification:(notification:NativeNotification)=>void,onUnloaded?:()=>void,
   * onClientRequests?:Entry['onClientRequests'],deferRestore?:boolean}} input */
  const attachExisting=input=>serial(async()=>{
    let entry=input.runId ? runs.get(input.runId) : [...runs.values()].find(item=>item.threadId===input.threadId);
    if(!entry && input.runId){
      const saved=stateStore.getAgent(input.runId);
      if(!saved)throw new Error('Original managed run was not found.');
      if(saved.ownerId!==input.ownerId)throw new Error('Native thread belongs to another Main session.');
      entry=restore(saved);
      runs.set(entry.runId,entry);
    }
    if(!entry) return null;
    if(entry.threadId!==input.threadId)throw new Error('Original native thread identity changed.');
    if(entry.ownerId!==input.ownerId) throw new Error('Native thread belongs to another Main session.');
    if(input.role && entry.role!==input.role)throw new Error('Original managed role changed.');
    if(input.expectedSessionPath!==null&&entry.sessionPath!==input.expectedSessionPath)
      throw new Error('Original native record path changed.');
    if(!['running','idle','exited'].includes(entry.state))
      throw new Error('Original native environment cannot be safely restored.');
    if(!input.deferRestore && (entry.instructions!==input.instructions||!jsonSemanticallyEqual(entry.settings,input.settings)
      ||entry.cwd!==input.cwd||!jsonSemanticallyEqual(entry.readPaths,input.readPaths)
      ||!jsonSemanticallyEqual(entry.writePaths,input.writePaths))) throw new Error('Original run settings changed.');
    entry.onNotification=input.onNotification;
    entry.onUnloaded=input.onUnloaded;
    entry.onClientRequests=input.onClientRequests;
    if(!input.deferRestore && entry.state==='exited') await restoreNative(entry);
    return {session:proxy(entry),sessionPath:entry.sessionPath};
  });
  /** @param {string} runId @param {(notification:NativeNotification)=>void} listener */
  const detachManaged=(runId,listener)=>{const entry=runs.get(runId);if(entry&&entry.onNotification===listener){entry.onNotification=()=>{};entry.onUnloaded=undefined;}};
  /** @param {string} runId @param {string} ownerId @param {string} controllerId */
  const owned=(runId,ownerId,controllerId)=>{
    let entry=runs.get(runId);
    if(!entry){const saved=stateStore.getAgent(runId);if(saved){
      if(saved.ownerId!==ownerId)throw new Error('Background Agent belongs to another Main session.');
      entry=restore(saved);runs.set(runId,entry);
    }}
    if(!entry) throw new Error('Background Agent run was not found.');
    if(entry.ownerId!==ownerId) throw new Error('Background Agent belongs to another Main session.');
    return entry;
  };
  /** @param {{runId:string,callerId:string}} input */
  const callerAccess=({runId,callerId})=>{
    let entry=runs.get(runId);
    if(!entry){const saved=stateStore.getAgent(runId);if(saved){
      if(callerId!==saved.ownerId&&callerId!==saved.threadId)
        throw new Error('Background Agent caller does not belong to this run.');
      entry=restore(saved);runs.set(runId,entry);
    }}
    if(!entry) throw new Error('Background Agent run was not found.');
    const kind=callerId===entry.ownerId?'owner':callerId===entry.threadId?'root':null;
    if(!kind) throw new Error('Background Agent caller does not belong to this run.');
    if(entry.state==='exited')queueMicrotask(()=>{void serial(async()=>reapExited()).catch(()=>{});});
    return {kind,ownerId:entry.ownerId,controllerId:entry.ownerId,threadId:entry.threadId,role:entry.role};
  };
  /** @param {string} callerId */
  const assertMainCaller=callerId=>{
    if([...runs.values()].some(entry=>entry.threadId===callerId||entry.knownThreadIds.includes(callerId)))
      throw new Error('Background Agent root or child cannot control another Agent as Main.');
  };
  /** @param {string} runId @param {(notification:NativeNotification)=>void} listener */
  const subscribe=(runId,listener)=>{
    const entry=runs.get(runId);if(!entry)throw new Error('Background Agent run was not found.');
    const prior=entry.onNotification;entry.onNotification=notification=>{prior(notification);listener(notification);};
    return()=>{entry.onNotification=prior;};
  };
  const list=()=>serial(async()=>{
    const overview=[];
    for(const entry of runs.values()){
      if(!occupied(entry))continue;
      let state=entry.state;
      if(entry.state==='running'&&entry.native&&entry.threadId){
        try{const facts=await refreshSnapshot(entry);state=facts.factsComplete
          ? facts.members.some(member=>member.state==='active')||facts.clientRequests.length?'running':'idle':'unknown';}
        catch{state='unknown';}
      }
      const measured=entry.readTaskMeasurement?.().workDuration;
      const reviewer=REVIEWER_ROLES.includes(entry.role);
      overview.push({runId:entry.runId,role:entry.role,ownerId:entry.ownerId,ownerTitle:entry.ownerTitle,
        threadId:entry.threadId,state,taskStartedAt:entry.taskStartedAtMs,taskFinishedAt:entry.taskFinishedAtMs,
        taskElapsedMs:measured?measured.durationMs:entry.taskStartedAtMs===null?null:(entry.taskFinishedAtMs??clock.now())-entry.taskStartedAtMs,
        taskElapsedEstimated:measured?.estimated??reviewer,
        taskElapsedBasis:measured?.basis??(reviewer?'Only task start and end observations were recovered; downtime and sleep boundaries are incomplete.':null)});
    }
    return overview;
  });
  /** @param {{stopBackgroundAgents:boolean,allowIdleEviction?:boolean}} input
   * @returns {Promise<{status:'busy'|'unknown'|'ready',stoppedAgents:string[],reason?:string}>} */
  const prepareMaintenance=async({stopBackgroundAgents,allowIdleEviction=true})=>{
    const gate=await serial(async()=>{
      if(maintenance)return null;
      maintenance=true;cancelIdleClose();
      return [...runs.values()].map(entry=>({entry,work:entry.work}));
    });
    if(!gate)return {status:'busy',stoppedAgents:[],reason:'Background Agent maintenance is already active.'};
    // Work may itself need the global executor. Drain it without holding that executor.
    await Promise.allSettled(gate.map(({work})=>work));
    let ready=false;
    /** @type {string[]} */
    const stoppedAgents=[];
    try{
      return await serial(async()=>{
        if(gate.some(({entry,work})=>entry.work!==work||entry.pendingWork>0)
          || [...runs.values()].some(entry=>stateStore.pendingDelivery({runId:entry.runId,direction:'main-to-agent'}).length>0))
          return {status:'busy',stoppedAgents,reason:'Accepted Background Agent work is still pending.'};
        const active=[...runs.values()].filter(occupied);
        if(!stopBackgroundAgents&&!allowIdleEviction&&active.length)
          return {status:'busy',stoppedAgents,reason:'Background Agent closure was not authorized.'};
        /** @type {Map<Entry,Promise<void>>} */
        const safeWork=new Map();
        if(!stopBackgroundAgents)for(const entry of active){
          const expectedWork=entry.work;
          if(!await safeIdle(entry))
            return {status:'busy',stoppedAgents,reason:'Background Agent work is busy or unknown.'};
          safeWork.set(entry,expectedWork);
        }
        for(const entry of active){
          try{
            if(!await unload(entry,stopBackgroundAgents?undefined:{expectedWork:safeWork.get(entry)}))
              return {status:'busy',stoppedAgents,reason:'Background Agent work is busy or unknown.'};
            stoppedAgents.push(entry.runId);
          }
          catch{return {status:'unknown',stoppedAgents,reason:'Background Agent or tool exit is unverified.'};}
        }
        await closeSharedServer();
        await stateStore.flush();
        ready=true;
        return {status:'ready',stoppedAgents};
      });
    }catch(error){return{status:'unknown',stoppedAgents,reason:explanation(error)};}
    finally{if(!ready)maintenance=false;}
  };
  /** @param {{ownerId:string,controllerId:string,callerId?:string,operation:string,input:Record<string,unknown>,
   * emit?:(result:unknown)=>Promise<void>,signal?:AbortSignal}} request
   * @returns {Promise<import('./machine.mjs').RuntimeResult>} */
  const execute=async({ownerId,controllerId,callerId=ownerId,operation,input,emit,signal})=>{
    try{
      if(!['send_message','messages','list_agents','wait_agent'].includes(operation))assertMainCaller(callerId);
      if(operation==='spawn_agent'){
        if(callerId!==ownerId)throw new Error('Only the owning Main may start an Agent.');
        const stateDirectory=await requireBackgroundAgentStateDirectory(input.stateDirectory);
        const session=await openManaged({ownerId,controllerId,role:String(input.role??''),
          settings:/** @type {NativeSettings} */(input.settings),cwd:String(input.cwd??''),
          readPaths:/** @type {string[]} */(input.readPaths??[]),writePaths:/** @type {string[]} */(input.writePaths??[]),
          stateDirectory,onNotification:()=>{}});
        const accepted=await session.acceptStart({instructions:String(input.instructions??''),handoff:String(input.handoff??'')});
        const entry=owned(session.runId,ownerId,controllerId);
        queueWork(entry,async()=>{
          try {await session.prepareNativeStart();await session.dispatchAccepted({messageId:accepted.messageId});}
          catch(error) {if(stateStore.getMessage(accepted.messageId)?.deliveryStatus==='accepted')
            stateStore.updateMessage(accepted.messageId,{deliveryStatus:'failed'});throw error;}
        });
        return {status:'succeeded',result:accepted};
      }
      if(operation==='list_agents' && input.runId===undefined){
        assertMainCaller(callerId);
        return {status:'succeeded',result:{agents:await list()}};
      }
      const runId=String(input.runId??''),entry=owned(runId,ownerId,controllerId);
      const access=callerAccess({runId,callerId}),session=proxy(entry);
      if(operation==='messages'){
        const direction=input.direction??(access.kind==='root'?'agent-to-main':'main-to-agent');
        if((direction!=='main-to-agent'&&direction!=='agent-to-main')||(access.kind==='root'&&direction!=='agent-to-main'))
          throw new Error('Message direction is not allowed for this caller.');
        const limit=input.limit===undefined?3:input.limit;
        if(typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1)
          throw new Error('Message limit must be a positive safe integer.');
        if(input.beforeMessageId!==undefined&&typeof input.beforeMessageId!=='string')
          throw new Error('Message page identity is invalid.');
        const page=stateStore.messagePage({runId,direction,limit,beforeMessageId:input.beforeMessageId});
        return{status:'succeeded',result:{runId,direction,...page,recoveryIncomplete:stateStore.recoveryIncomplete}};
      }
      if(access.kind==='root'&&operation!=='send_message')throw new Error('Background Agent root may only send or query its own messages.');
      if(operation==='send_message'){
        if(typeof input.message!=='string'||!input.message.trim())throw new Error('Background Agent message must be nonempty text.');
        const message=input.message;
        if(access.kind==='root'){
          if(entry.state!=='running'||!entry.native||!entry.threadId)
            throw new Error('Original native root is no longer running.');
          const accepted=await serial(async()=>accept(entry,'agent-to-main',message));
          return{status:'succeeded',result:{runId,messageId:accepted.messageId,deliveryStatus:'accepted',
            persistenceStatus:accepted.persistenceStatus,threadId:entry.threadId}};
        }
        if(!entry.threadId)throw new Error('Original native thread identity is unavailable.');
        const accepted=await serial(async()=>{
          if(entry.native){
            const facts=await refreshSnapshot(entry);
            if(!facts.factsComplete)throw new Error('Native Agent facts are incomplete.');
            const root=facts.members.find(member=>member.threadId===entry.threadId);
            if(!root)throw new Error('Original native thread is missing.');
            if(root.state==='active'&&root.turnId!==input.turnId)throw new Error('Active native turn changed.');
          }
          return accept(entry,'main-to-agent',message);
        });
        if(entry.providerWork?.paused===true&&entry.onResumeTask){
          const previous=entry.providerWork.resumeMessageId;
          const replacesUnknown=typeof previous==='string'&&stateStore.getMessage(previous)?.deliveryStatus==='unknown';
          if(!previous||replacesUnknown)update(entry,{providerWork:{...entry.providerWork,resumeMessageId:accepted.messageId}});
          queueResume(entry);
          if(previous&&!replacesUnknown)queueWork(entry,()=>dispatch(entry,accepted,true));
        } else if(entry.native && entry.taskState==='working')queueWork(entry,()=>dispatch(entry,accepted,true));
        return{status:'succeeded',result:{runId,threadId:entry.threadId,messageId:accepted.messageId,
          deliveryStatus:'accepted',persistenceStatus:accepted.persistenceStatus}};
      }
      if(operation==='followup_task'){
        if(access.kind!=='owner')throw new Error('Only the owning Main may assign follow-up work.');
        const accepted=await session.acceptTask({handoff:String(input.handoff??''),turnId:typeof input.turnId==='string'?input.turnId:undefined,
          instructions:typeof input.instructions==='string'?input.instructions:undefined,
          settings:/** @type {NativeSettings|undefined} */(input.settings),
          cwd:typeof input.cwd==='string'?input.cwd:undefined,
          readPaths:/** @type {string[]|undefined} */(input.readPaths),
          writePaths:/** @type {string[]|undefined} */(input.writePaths)});
        queueWork(entry,async()=>{
          try {await session.prepareForTask({messageId:accepted.messageId});
            await session.dispatchAccepted({messageId:accepted.messageId});}
          catch(error){if(stateStore.getMessage(accepted.messageId)?.deliveryStatus==='accepted')
            stateStore.updateMessage(accepted.messageId,{deliveryStatus:'failed'});throw error;}
        });
        return{status:'succeeded',result:accepted};
      }
      if(operation==='list_agents'){
        if(entry.native&&entry.threadId)await serial(()=>refreshSnapshot(entry));
        const cursor=typeof input.cursor==='number'&&Number.isSafeInteger(input.cursor)&&input.cursor>=0?input.cursor:0;
        const observed=observation(entry,cursor);
        const response=/** @type {import('./machine.mjs').RuntimeResult} */ ({status:'succeeded',result:{runId,threadId:entry.threadId,
          turnId:entry.turnId,state:entry.state,taskState:entry.taskState,
          snapshot:entry.snapshot,notifications:observed.notifications,cursor:observed.cursor,
          pendingRequests:observed.pendingRequests,providerError:providerError(entry),
          recoveryIncomplete:stateStore.recoveryIncomplete}});
        if(emit){await emit(response);for(const notice of observed.notifications)if(notice.type==='message'&&notice.messageId)
          stateStore.updateMessage(notice.messageId,{deliveryStatus:'delivered'});}
        return response;
      }
      if(operation==='wait_agent'){
        const cursor=typeof input.cursor==='number'&&Number.isSafeInteger(input.cursor)&&input.cursor>=0?input.cursor:0;
        const observed=await session.waitNotifications({cursor,
          timeoutMs:/** @type {number} */(input.timeout_ms===undefined?30_000:input.timeout_ms),signal});
        const response=/** @type {import('./machine.mjs').RuntimeResult} */ ({status:'succeeded',result:{runId,threadId:entry.threadId,
          turnId:entry.turnId,state:entry.state,taskState:entry.taskState,snapshot:entry.snapshot,
          notifications:observed.notifications,cursor:observed.cursor,pendingRequests:observed.pendingRequests,
          providerError:providerError(entry),cancelled:signal?.aborted??false,
          recoveryIncomplete:stateStore.recoveryIncomplete}});
        if(emit){await emit(response);for(const notice of observed.notifications)if(notice.type==='message'&&notice.messageId)
          stateStore.updateMessage(notice.messageId,{deliveryStatus:'delivered'});}
        return response;
      }
      if(operation==='respond'){
        if(entry.onClientRequests)throw new Error('Reviewer native requests cannot be answered by Main.');
        if(!entry.native||!entry.threadId)throw new Error('Native request is no longer pending.');
        const facts=await entry.native.snapshot({rootThreadId:entry.threadId,knownThreadIds:entry.knownThreadIds});
        if(!facts.factsComplete||!facts.clientRequests.some(request=>request.requestId===input.requestId))
          throw new Error('Native request is no longer pending.');
        await entry.native.respond({requestId:String(input.requestId),response:/** @type {Record<string,unknown>} */(input.response)});
        return{status:'succeeded',result:{runId,accepted:true}};
      }
      if(operation==='interrupt_agent'){
        if(!entry.threadId||!entry.native)throw new Error('Native environment is unavailable.');
        const facts=await entry.native.snapshot({rootThreadId:entry.threadId,knownThreadIds:entry.knownThreadIds});
        if(!facts.factsComplete||!facts.members.some(member=>member.threadId===entry.threadId&&member.state==='active'&&member.turnId===input.turnId))
          throw new Error('Active native turn changed.');
        await entry.native.interruptGroup({rootThreadId:entry.threadId,turnId:String(input.turnId??'')});
        return{status:'succeeded',result:{runId,accepted:true}};
      }
      throw new Error('Unsupported Background Agent operation.');
    }catch(error){return{status:'failed',error:{code:/** @type {any} */(error)?.code??'background-agent-operation-failed',
      message:explanation(error)}};}
    finally{void serial(async()=>reapExited()).catch(()=>{});}
  };
  return {openManaged,attachExisting,detachManaged,owned,callerAccess,assertMainCaller,proxy,execute,subscribe,
    list,prepareMaintenance,releaseMaintenance:()=>{maintenance=false;},
    close:async()=>{cancelIdleClose();unsubscribePersisted();await Promise.allSettled([...runs.values()].map(entry=>entry.work));
      await serial(async()=>{});await stateStore.close();},serial,stateStore};
}

/** @param {{manager:Awaited<ReturnType<typeof createBackgroundAgentManager>>,ownerId:string,controllerId:string,
 * role:string,ownerTitle?:string|null,onClientRequests?:Entry['onClientRequests']}} input */
export function createManagedNativeSessions({manager,ownerId,controllerId,role,ownerTitle=null,onClientRequests}) {
  return /** @type {ManagedNativeSessions} */ ({open:async({settings,cwd,readPaths,writePaths,onNotification,onUnloaded})=>{
    let held=/** @type {Awaited<ReturnType<typeof manager.openManaged>>|null} */(null);
    const current=()=>{if(!held)throw new Error('Native session has not started or resumed.');return held;};
    return /** @type {ManagedNativeSession & {reserve:(input:{stateDirectory?:string})=>Promise<{runId:string,threadId:string|null,sessionPath:string|null}>}} */ ({
      get runId(){return current().runId;},
      get previous(){return current().previous;},
      managementState:()=>current().managementState(),
      holdManagedWork:()=>current().holdManagedWork(),
      setTaskMeasurement:read=>current().setTaskMeasurement?.(read),getTaskStartedAt:()=>current().getTaskStartedAt?.()??null,
      restoreCurrentTask:()=>current().restoreCurrentTask?.(),
      getTaskMessage:messageId=>current().getTaskMessage?.(messageId)??null,
      setResumeHandler:(handler,resumePending)=>current().setResumeHandler?.(handler,resumePending),noteEarlyExit:input=>current().noteEarlyExit?.(input),recoverContinuation:input=>current().recoverContinuation?.(input),
      providerWorkClock:()=>current().providerWorkClock?.(),getProviderWork:()=>current().getProviderWork?.(),saveProviderWork:state=>current().saveProviderWork?.(state),
      stopForDeadline:input=>{const held=current();return held.stopForDeadline?held.stopForDeadline(input):held.stop();},
      createProviderWorkPolicy:input=>current().createProviderWorkPolicy?.(input)??null,
      configureReviewerTask:input=>current().configureReviewerTask?.(input),sendProgramInstruction:input=>current().sendProgramInstruction?.(input),continueTask:input=>current().continueTask?.(input),
      detach:()=>{if(held)manager.detachManaged(held.runId,onNotification);},
      observe:input=>current().observe(input),waitNotifications:input=>current().waitNotifications(input),
      reserve:async({stateDirectory})=>{
        if(held)throw new Error('Native session has already been reserved.');
        held=await manager.openManaged({ownerId,controllerId,role,ownerTitle,settings,cwd,readPaths,writePaths,
          stateDirectory,onNotification,onUnloaded,onClientRequests});
        return held.previous;
      },
      acceptStart:input=>current().acceptStart(input),
      acceptTask:input=>current().acceptTask(input),
      prepareNativeStart:()=>current().prepareNativeStart(),
      prepareForTask:input=>current().prepareForTask(input),
      failAcceptedTask:input=>current().failAcceptedTask(input),
      dispatchAccepted:input=>current().dispatchAccepted(input),
      start:async input=>{
        if(!held)held=await manager.openManaged({ownerId,controllerId,role,ownerTitle,settings,cwd,readPaths,writePaths,onNotification,onUnloaded,onClientRequests});
        return held.start(input);
      },
      resume:async input=>{
        if(held)throw new Error('Native session has already resumed.');
        const existing=await manager.attachExisting({runId:input.runId,threadId:input.threadId,expectedSessionPath:input.expectedSessionPath,
          ownerId,controllerId,role,settings,cwd,readPaths,writePaths,instructions:input.instructions,onNotification,onUnloaded,onClientRequests,
          deferRestore:input.deferRestore});
        if(existing){held=existing.session;return {threadId:input.threadId,sessionPath:existing.sessionPath};}
        if(input.runId)throw new Error('Original managed run was not found.');
        held=await manager.openManaged({ownerId,controllerId,role,ownerTitle,settings,cwd,readPaths,writePaths,onNotification,onUnloaded,onClientRequests});
        return held.resume(input);
      },
      startTurn:input=>current().startTurn(input),steer:input=>current().steer(input),
      snapshot:input=>current().snapshot(input),respond:input=>current().respond(input),
      rejectRequest:input=>current().rejectRequest(input),readThreadMetadata:input=>current().readThreadMetadata(input),
      idleFacts:input=>current().idleFacts(input),interruptGroup:input=>current().interruptGroup(input),
      protectTurn:input=>current().protectTurn(input),
      cleanupTurnTerminals:input=>current().cleanupTurnTerminals(input),
      releaseProtectedTurn:input=>current().releaseProtectedTurn(input),
      stop:()=>current().stop(),
    });
  }});
}
