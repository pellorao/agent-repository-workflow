import {createHash} from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, normalize, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { isJsonObject, jsonSemanticallyEqual, parseJsonText, serializeJson } from '../common/json.mjs';
import {createSharedModelCatalog} from './model-catalog.mjs';
import {readAppServerProcessIdentity, readOperatingSystemProcessCreationTime, recordAppServerProcessIdentity, removeEndedAppServerProcessIdentity} from './process-identity.mjs';
import {createUsage} from './usage.mjs';

/** @typedef {null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue}} JsonValue */
/** @typedef {{model: string, modelProvider: string, reasoningEffort: string, serviceTier: string | null, programDirectory?: string, config: {[key: string]: JsonValue}}} NativeSettings */
/** @typedef {{path: string, access: 'read' | 'write' | 'deny'}} NativePermissionRule */
/** @typedef {{turnId: string, recordSequence: number, model: string | null, modelProvider: string | null, reasoningEffort: string | null, cwd: string | null, permissionsRules: NativePermissionRule[] | null, unknownReasons: string[]}} NativeContext */
/** @typedef {import('./usage.mjs').NativeUsage} NativeUsage */
/** @typedef {{threadId: string, parentThreadId: string | null, state: 'active' | 'idle' | 'interrupted' | 'failed' | 'exited', turnId: string | null, turnStatus?: string | null, sessionPath: string | null, modelProvider: string | null, contexts: NativeContext[], usage: NativeUsage, finalResponse: string | null, hasConversationHistory: boolean | null,retryableModelFailure?:boolean,turnError?:Record<string,unknown>|null}} NativeMember */
/** @typedef {{requestId: string, kind: 'user-input' | 'approval' | 'unsupported', method: string, params: Record<string, unknown>, threadId: string | null, turnId: string | null}} NativeClientRequest */
/** @typedef {{itemId: string, threadId: string, turnId: string | null, phase: 'commentary' | 'final_answer', text: string, recordSequence: number}} NativePublicMessage */
/** @typedef {{itemId:string|null,threadId:string,turnId:string|null,text:string,recordSequence:number}} NativeUserMessage */
/** @typedef {{rootThreadId: string, environmentState: 'running' | 'exited', members: NativeMember[], factsComplete: boolean, unknownReasons: string[], clientRequests: NativeClientRequest[], publicMessages?: NativePublicMessage[], userMessages?:NativeUserMessage[], commandFacts?:import('./strata-work-policy.mjs').NativeCommandFact[], measurementFacts?:import('./native-measurement.mjs').NativeMeasurementFacts}} NativeSnapshot */
/** @typedef {{type: 'changed', threadId: string | null, turnId: string | null} | {type: 'exited', reason: string | null} | {type: 'message', message: NativePublicMessage}} NativeNotification */
/** @typedef {{start(input: {instructions: string}): Promise<{threadId: string, sessionPath: string | null}>, resume(input: {threadId: string, expectedSessionPath: string | null, instructions: string}): Promise<{threadId: string, sessionPath: string | null}>, startTurn(input: {threadId: string, handoff: string}): Promise<{turnId: string}>, steer(input: {threadId: string, turnId: string, instruction: string}): Promise<{turnId: string}>, snapshot(input: {rootThreadId: string, knownThreadIds?: string[]}): Promise<NativeSnapshot>, respond(input: {requestId: string, response: Record<string, unknown>}): Promise<{accepted: true}>, rejectRequest(input: {requestId: string, reason: string}): Promise<{accepted: true}>, readThreadMetadata(input: {threadId: string}): Promise<{title: string | null, preview: string, sessionPath: string | null}>, idleFacts(input: {rootThreadId: string, knownThreadIds?: string[]}): Promise<{safe: boolean, known: boolean, reason: string | null}>, cleanupTurnTerminals(input: {rootThreadId: string, turnId: string, knownThreadIds?: string[]}): Promise<{confirmed: true}>, interruptGroup(input: {rootThreadId: string, turnId: string}): Promise<{accepted: true}>, stop(): Promise<{environmentState: 'exited'}>, stopForDeadline?(): Promise<{environmentState:'exited'}>}} NativeSession */
/** @typedef {{providerId:string,baseUrl:string,leaseKey:string}} NativeProviderConnection */
/** @typedef {{open(input: {settings: NativeSettings, role?: string, cwd: string, readPaths: string[], writePaths: string[], runId?:string, providerConnection?:NativeProviderConnection, onNotification: (notification: NativeNotification) => void}): Promise<NativeSession>, ensureServer(input?:{onPreviousExit?:()=>Promise<void>}):Promise<void>, observeServer():Promise<'running'|'ended'|'absent'|'unknown'>, close(input?:{retainProcessIdentity?:boolean}):Promise<{environmentState:'exited',previousProcessState?:'ended'|'absent'}>}} NativeSessions */
/** @typedef {{pid?:number,stdin: import('node:stream').Writable, stdout: import('node:stream').Readable, stderr: import('node:stream').Readable, on(event: string, listener: (...args: any[]) => void): unknown, once(event: string, listener: (...args: any[]) => void): unknown, kill(signal?: NodeJS.Signals | number): boolean}} NativeProcess */
/** @typedef {{cwd: string, env: NodeJS.ProcessEnv, stdio: 'pipe', shell: false, windowsHide: true}} NativeSpawnOptions */
/** @typedef {(executable: string, args: string[], options: NativeSpawnOptions) => NativeProcess} NativeSpawn */
/** @typedef {{thread: Record<string, unknown>, turnId: string | null, liveTurnId: string | null, turnState: string | null, turnError?:Record<string,unknown>|null, finals: Map<string, string>, unphasedMessages: Map<string, string>, usage: NativeUsage | null}} ObservedThread */
/** @typedef {{request:(method:string,params:Record<string,unknown>)=>Promise<Record<string,unknown>>,write:(message:Record<string,unknown>)=>void,subscribe:(listener:(message:Record<string,unknown>)=>boolean|void,onFailure:(reason:string)=>void,onExit:()=>void)=>()=>void,claimRoot:(threadId:string)=>void,releaseRoot:(threadId:string)=>void,isClaimed:(threadId:string)=>boolean,isOtherRoot:(threadId:string,rootThreadId:string)=>boolean,close:()=>Promise<{environmentState:'exited'}>,readonly exited:boolean,readonly exitedAt:number|null,readonly failure:string|null}} NativeConnection */
/** @typedef {{read:()=>Promise<import('./process-identity.mjs').AppServerProcessObservation>,record:(identity:import('./process-identity.mjs').AppServerProcessIdentity)=>Promise<void>,remove:(identity:import('./process-identity.mjs').AppServerProcessIdentity)=>Promise<void>,creationTime:(pid:number)=>Promise<string|null>}} ProcessIdentityBoundary */
/** @typedef {{prepare:()=>Promise<string>,remove:()=>Promise<void>}} ModelCatalogBoundary */

const sourceKinds = ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown'];

class NativeRequestRejected extends Error {}

/** @param {NativeProcess} child @returns {NativeConnection} */
function createConnection(child) {
  /** @type {Map<string,{method:string,resolve:(value:Record<string,unknown>)=>void,reject:(error:Error)=>void,timer:NodeJS.Timeout}>} */
  const pending = new Map();
  /** @type {Set<{receive:(message:Record<string,unknown>)=>boolean|void,fail:(reason:string)=>void,exit:()=>void}>} */
  const listeners = new Set();
  const claimedRoots=new Set();
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let nextId = 0;
  let exited = false;
  let exitedAt = /** @type {number|null} */ (null);
  /** @type {string|null} */
  let failure = null;
  let resolveExit = /** @type {()=>void} */ (()=>{});
  const exitPromise = new Promise(resolve => {resolveExit=()=>resolve(undefined);});
  /** @param {string} reason */
  function fail(reason) {
    if (failure) return;
    failure = reason;
    for (const entry of pending.values()) {clearTimeout(entry.timer);entry.reject(new Error(reason));}
    pending.clear();
    for (const listener of listeners) listener.fail(reason);
  }
  child.on('error',()=>fail('Codex App Server process failed.'));
  child.stdin.on('error',()=>fail('Codex App Server input failed.'));
  child.stdout.on('error',()=>fail('Codex App Server output failed.'));
  child.stderr.on('data',()=>{});
  child.stderr.on('error',()=>fail('Codex App Server diagnostics failed.'));
  child.once('close',()=>{
    exited=true;
    exitedAt=Date.now();
    fail('Codex App Server exited.');
    resolveExit();
    for (const listener of listeners) listener.exit();
  });
  /** @param {Record<string,unknown>} message */
  function write(message) {
    const result=serializeJson(message,{format:'compact'});
    if(result.status!=='succeeded')throw new Error('Native request is not JSON.');
    child.stdin.write(Buffer.concat([result.bytes,Buffer.from('\n')]));
  }
  /** @param {string} method @param {Record<string,unknown>} params */
  function request(method,params) {
    if(exited||failure)return Promise.reject(new Error(failure??'Codex App Server exited.'));
    const id=String(++nextId);
    return new Promise((/** @type {(value:Record<string,unknown>)=>void} */ resolveDone,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Native request timed out: ${method}.`));},30_000);
      timer.unref();
      pending.set(id,{method,resolve:resolveDone,reject,timer});
      try {write({id,method,params});}
      catch {clearTimeout(timer);pending.delete(id);reject(new Error('Codex App Server input failed.'));}
    });
  }
  child.stdout.on('data',chunk=>{
    buffer+=typeof chunk==='string'?chunk:decoder.write(chunk);
    let newline;
    while((newline=buffer.indexOf('\n'))!==-1){
      const line=buffer.slice(0,newline);
      buffer=buffer.slice(newline+1);
      if(!line.trim())continue;
      const parsed=parseJsonText(line);
      if(parsed.status!=='succeeded'||!isJsonObject(parsed.value)){fail('Invalid Codex App Server JSON.');return;}
      const message=parsed.value;
      if('id' in message&&!('method' in message)){
        const entry=pending.get(String(message.id));
        if(!entry)continue;
        pending.delete(String(message.id));clearTimeout(entry.timer);
        if('error' in message){
          const code=object(message.error).code;
          const diagnostic=typeof code==='number'&&Number.isInteger(code)?` (code ${code})`:'';
          entry.reject(new NativeRequestRejected(`Codex App Server rejected ${entry.method}${diagnostic}.`));
        }else entry.resolve(object(message.result));
        continue;
      }
      if(!text(message.method)){fail('Invalid Codex App Server message.');return;}
      try {
        let handled=false;
        for(const listener of listeners)if(listener.receive(message)===true)handled=true;
        if('id' in message&&!handled)fail('Native request could not be routed to a root thread.');
      }
      catch {fail('Invalid Codex App Server message.');return;}
    }
  });
  return {
    request,write,
    claimRoot(threadId){if(claimedRoots.has(threadId))throw new Error('Native root thread already has a control handle.');claimedRoots.add(threadId);},
    releaseRoot(threadId){claimedRoots.delete(threadId);},
    isClaimed(threadId){return claimedRoots.has(threadId);},
    isOtherRoot(threadId,rootThreadId){return threadId!==rootThreadId&&claimedRoots.has(threadId);},
    subscribe(receive,onFailure,onExit){const listener={receive,fail:onFailure,exit:onExit};listeners.add(listener);return()=>listeners.delete(listener);},
    async close(){
      if(!exited){
        child.stdin.end();
        const terminate=setTimeout(()=>child.kill('SIGTERM'),1000);
        const kill=setTimeout(()=>child.kill('SIGKILL'),3000);
        /** @type {NodeJS.Timeout|undefined} */let timeout;
        try{await Promise.race([exitPromise,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Codex App Server exit was not observed.')),5000);})]);}
        finally{clearTimeout(terminate);clearTimeout(kill);clearTimeout(timeout);}
      }
      if(!exited)throw new Error('Codex App Server exit was not observed.');
      return {environmentState:'exited'};
    },
    get exited(){return exited;},get exitedAt(){return exitedAt;},get failure(){return failure},
  };
}

/**
 * 工厂按需持有一个共享 App Server, 每次 open 仅建立独立根线程句柄.
 * @param {{runtimeDirectory?:string,processIdentity?:ProcessIdentityBoundary,modelCatalog?:ModelCatalogBoundary,spawnProcess?: NativeSpawn, readNativeFile?: (path: string) => Promise<string | Buffer>, environment?: () => NodeJS.ProcessEnv, codexExecutable?: string,unloadWaitMs?:number}} [dependencies]
 * @returns {NativeSessions}
 */
export function createCodexAppServerSessions({
  runtimeDirectory,
  processIdentity,
  modelCatalog,
  spawnProcess = (executable, args, options) => spawn(executable, args, options),
  readNativeFile = (path) => readFile(path),
  environment = () => ({ ...process.env }),
  codexExecutable = 'codex',
  unloadWaitMs = 5000,
} = {}) {
  if ((!processIdentity || !modelCatalog) && (!runtimeDirectory || !isAbsolute(runtimeDirectory))) throw new Error('App Server private runtime directory is required.');
  if(!Number.isSafeInteger(unloadWaitMs)||unloadWaitMs<=0)throw new Error('Native unload observation deadline is invalid.');
  const identity = processIdentity ?? {
    read:()=>readAppServerProcessIdentity({runtimeDirectory:/** @type {string} */ (runtimeDirectory)}),
    record:(/** @type {import('./process-identity.mjs').AppServerProcessIdentity} */ value)=>recordAppServerProcessIdentity({runtimeDirectory:/** @type {string} */ (runtimeDirectory),identity:value}),
    remove:(/** @type {import('./process-identity.mjs').AppServerProcessIdentity} */ value)=>removeEndedAppServerProcessIdentity({runtimeDirectory:/** @type {string} */ (runtimeDirectory),identity:value}),
    creationTime:readOperatingSystemProcessCreationTime,
  };
  /** @type {NodeJS.ProcessEnv} */
  let launchEnvironment = {};
  const catalog = modelCatalog ?? createSharedModelCatalog({runtimeDirectory:/** @type {string} */ (runtimeDirectory),environment:()=>launchEnvironment});
  /** @param {import('./process-identity.mjs').AppServerProcessIdentity} value */
  async function cleanExitedServer(value) {
    const results=await Promise.allSettled([
      Promise.resolve().then(()=>identity.remove(value)),
      Promise.resolve().then(()=>catalog.remove()),
    ]);
    const failed=[];
    if(results[0].status==='rejected')failed.push('process identity');
    if(results[1].status==='rejected')failed.push('shared model catalog');
    if(failed.length)throw new Error(`App Server exit cleanup failed: ${failed.join(' and ')}.`);
  }
  /** @type {{connection:NativeConnection,identity:import('./process-identity.mjs').AppServerProcessIdentity,active:Set<NativeSession>,cleanup:Promise<void>|null,cleanupError:Error|null}|null} */
  let shared = null;
  /** @type {Promise<void>|null} */
  let starting = null;
  /** @param {{onPreviousExit?:()=>Promise<void>}} [input] */
  async function ensureServer({onPreviousExit}={}) {
    if (shared && !shared.connection.exited) return;
    if(shared?.cleanup)await shared.cleanup;
    if(shared?.cleanupError)throw shared.cleanupError;
    if (starting) {await starting; return;}
    starting = (async()=>{
      const previous = await identity.read();
      if (previous.state === 'alive' || previous.state === 'unknown') throw new Error('Earlier App Server exit could not be confirmed.');
      if (previous.state === 'ended' && previous.identity) {
        if (!onPreviousExit) throw new Error('Earlier App Server exit requires provider recovery before restart.');
        await onPreviousExit();
        await cleanExitedServer(previous.identity);
        shared=null;
      } else if (shared) {
        throw new Error('Earlier App Server process identity is missing.');
      }
      launchEnvironment={...environment()};
      if (typeof launchEnvironment.CODEX_HOME === 'string' && launchEnvironment.CODEX_HOME.length > 0) {
        launchEnvironment.CODEX_HOME=await realpath(launchEnvironment.CODEX_HOME);
      }
      const catalogPath=await catalog.prepare();
      /** @type {NativeProcess} */
      let child;
      try {
        child=spawnProcess(codexExecutable,['-c','thread_unload_delay_secs=0','-c',`model_catalog_json=${JSON.stringify(catalogPath)}`,'app-server','--listen','stdio://'],{
          cwd:runtimeDirectory ?? process.cwd(),env:launchEnvironment,stdio:'pipe',shell:false,windowsHide:true,
        });
      } catch(error) {
        try {await catalog.remove();} catch {throw new Error('App Server launch failed and shared model catalog cleanup failed.');}
        throw error;
      }
      const connection = createConnection(child);
      /** @type {import('./process-identity.mjs').AppServerProcessIdentity|null} */
      let recordedIdentity = null;
      try {
        if (!Number.isSafeInteger(child.pid) || /** @type {number} */ (child.pid) <= 0) throw new Error('App Server PID is unavailable.');
        const createdAt = await identity.creationTime(/** @type {number} */ (child.pid));
        if (!createdAt) throw new Error('App Server operating system creation time is unavailable.');
        const value = {pid:/** @type {number} */ (child.pid),createdAt};
        await identity.record(value);
        recordedIdentity=value;
        await connection.request('initialize',{clientInfo:{name:'arw-background-agent',version:'1'},capabilities:{experimentalApi:true}});
        if(connection.exited)throw new Error('App Server exited during initialization.');
        connection.write({method:'initialized',params:{}});
        const owner={connection,identity:value,active:new Set(),cleanup:/** @type {Promise<void>|null} */ (null),cleanupError:/** @type {Error|null} */ (null)};
        connection.subscribe(()=>{},()=>{},()=>{owner.cleanup=catalog.remove().catch(()=>{
          owner.cleanupError=new Error('App Server exit cleanup failed: shared model catalog.');
        });});
        shared=owner;
      } catch(error) {
        try {await connection.close();} catch {throw new Error('Native initialization failed and App Server exit was not observed.');}
        if(recordedIdentity)await cleanExitedServer(recordedIdentity);
        else await catalog.remove();
        throw error;
      }
    })();
    try {await starting;} finally {starting = null;}
  }
  return {
    ensureServer,
    async observeServer() {
      const observed=await identity.read();
      if(observed.state==='ended')return 'ended';
      if(observed.state==='absent'&&!shared)return 'absent';
      if(observed.state==='alive'&&shared&&!shared.connection.exited
        &&observed.identity?.pid===shared.identity.pid&&observed.identity.createdAt===shared.identity.createdAt)return 'running';
      return 'unknown';
    },
    async open({ settings, cwd, readPaths, writePaths, runId, providerConnection, onNotification }) {
      validateSettings(settings);
      for (const path of [cwd, ...readPaths, ...writePaths]) {
        if (!isAbsolute(path)) throw new Error('Native runtime paths must be absolute.');
      }
      if (runId !== undefined && (typeof runId !== 'string' || !runId.trim())) throw new Error('Background Agent run identity is invalid.');
      /** @type {Record<string, JsonValue>} */
      const config = {...settings.config, model_reasoning_effort: settings.reasoningEffort};
      if (providerConnection) {
        if (providerConnection.providerId !== settings.modelProvider || !providerConnection.baseUrl || !providerConnection.leaseKey)
          throw new Error('Trusted provider connection does not match the native model provider.');
        delete config[`model_providers.${providerConnection.providerId}.base_url`];
        const providers = object(config.model_providers);
        const selected = {...object(providers[providerConnection.providerId])};
        delete selected.env_key;
        config.model_providers = /** @type {JsonValue} */ (/** @type {unknown} */ ({...providers,[providerConnection.providerId]:{
          ...selected,base_url:providerConnection.baseUrl,
          experimental_bearer_token:providerConnection.leaseKey,
        }}));
      }
      if (runId) {
        const policy = object(config.shell_environment_policy);
        config.shell_environment_policy = {...policy,set:{...object(policy.set),ARW_BACKGROUND_AGENT_RUN_ID:runId}};
      }
      await ensureServer();
      const server = /** @type {NonNullable<typeof shared>} */ (shared);
      const session = openNativeSession({connection:server.connection,settings,cwd,config,env:environment(),readNativeFile,onNotification,
        onStopped:()=>server.active.delete(session),unloadWaitMs});
      server.active.add(session);
      return session;
    },
    async close({retainProcessIdentity=false}={}) {
      if (starting) await starting;
      if (!shared) {
        const observed=await identity.read();
        if(observed.state==='alive'||observed.state==='unknown')throw new Error('Earlier App Server exit could not be confirmed.');
        if(observed.state==='ended'){
          if(!observed.identity)throw new Error('Earlier App Server identity could not be confirmed.');
          if(retainProcessIdentity)await catalog.remove();
          else await cleanExitedServer(observed.identity);
          return {environmentState:'exited',previousProcessState:'ended'};
        }
        return {environmentState:'exited',previousProcessState:'absent'};
      }
      if (shared.active.size) throw new Error('Shared App Server still has loaded roots.');
      const current = shared;
      if(current.connection.exited)
        throw new Error('Shared App Server exited outside normal closure; process identity retained.');
      const result = await current.connection.close();
      if(current.cleanup)await current.cleanup;
      else await catalog.remove();
      if(current.cleanupError)throw current.cleanupError;
      if(!retainProcessIdentity) {
        try {await identity.remove(current.identity);}
        catch {throw new Error('App Server exit cleanup failed: process identity.');}
      }
      if (shared === current) shared = null;
      return result;
    },
  };
}

/** @param {NativeSettings} settings */
function validateSettings(settings) {
  for (const value of [settings.model, settings.modelProvider, settings.reasoningEffort]) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Native model settings must be explicit.');
  }
  if (settings.serviceTier !== null && typeof settings.serviceTier !== 'string') throw new Error('Invalid native service tier.');
  if (!isJsonObject(settings.config)) throw new Error('Native config must be a JSON object.');
  if (serializeJson(settings.config).status !== 'succeeded') throw new Error('Native config must contain JSON values.');
  if ('model_catalog_json' in settings.config) throw new Error('Shared model catalog is fixed when the App Server starts; a root thread cannot override model_catalog_json.');
  // 只允许提供方引用环境变量名, 不把凭据值写入设置或恢复记录.
  const providers = object(settings.config.model_providers);
  for(const [key,value] of Object.entries(settings.config)) {
    if(!key.startsWith('model_providers.'))continue;
    if(/\.(?:api_key|apiKey|bearer_token|bearerToken|experimental_bearer_token)$/.test(key)
      || ['api_key','apiKey','bearer_token','bearerToken','experimental_bearer_token']
        .some(secret=>secret in object(value)))
      throw new Error('Provider credentials must use an environment key reference.');
  }
  for (const provider of Object.values(providers)) {
    const value = object(provider);
    if (['api_key', 'apiKey', 'bearer_token', 'bearerToken', 'experimental_bearer_token'].some((key) => key in value)) {
      throw new Error('Provider credentials must use an environment key reference.');
    }
    if ('env_key' in value && (typeof value.env_key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.env_key))) {
      throw new Error('Provider env_key must name an environment variable.');
    }
  }
}

/**
 * @param {{connection: NativeConnection, settings: NativeSettings, cwd: string, config: Record<string, unknown>, env: NodeJS.ProcessEnv, readNativeFile: (path: string) => Promise<string | Buffer>, onNotification: (notification: NativeNotification) => void, onStopped:()=>void,unloadWaitMs:number}} input
 * @returns {NativeSession}
 */
function openNativeSession({ connection, settings, cwd, config, env, readNativeFile, onNotification, onStopped, unloadWaitMs }) {
  const {request,write}=connection;
  /** @type {Map<string, ObservedThread>} */
  const threads = new Map();
  /** @type {Map<string, NativeClientRequest & {nativeId: string | number}>} */
  const clientRequests = new Map();
  /** @type {Set<string>} */
  const observedMessages = new Set();
  /** @type {Set<string>} */
  const knownIds = new Set();
  /** @type {Map<string,{content:string,parsed:ReturnType<typeof parseNativeRecords>}>} */
  const recordCache = new Map();
  let stopped = false;
  let deadlineStopping=false;
  /** @type {{priorTurnId:string|null,turnId:string|null,rejected:boolean}|null} */ let uncertainStart=null;
  let stoppedAt = /** @type {number|null} */ (null);
  let workingSince = /** @type {number|null} */ (null);
  let failure = /** @type {string | null} */ (null);
  let discoveryComplete = false;
  /** @type {string[]} */
  let discoveryReasons = [];
  let rootId = /** @type {string | null} */ (null);
  let freshRoot = false;
  /** @type {{threadId:string,path:string,source:unknown}|null} */
  let freshCreation = null;
  let changeVersion=0;

  /** @param {NativeNotification} notification */
  function notify(notification) {
    if(notification.type==='changed'||notification.type==='exited')changeVersion+=1;
    onNotification(notification);
    if(notification.type==='changed'||notification.type==='exited')for(const done of waiters)done();
  }
  /** @param {string} turnId */
  function interruptDeadlineTurn(turnId) {
    if(!rootId||stopped||connection.exited)return;
    void request('turn/interrupt',{threadId:rootId,turnId}).catch(()=>{});
  }
  /** @param {string} reason */
  function fail(reason) {
    const first = failure === null;
    failure ??= reason;
    if (first && !connection.exited && !stopped) notify({ type: 'changed', threadId: rootId, turnId: rootId ? threads.get(rootId)?.turnId ?? null : null });
  }

  /** @param {string} id @returns {ObservedThread} */
  function observed(id) {
    knownIds.add(id);
    let entry = threads.get(id);
    if (!entry) {
      discoveryComplete = false;
      entry = { thread: { id }, turnId: null, liveTurnId: null, turnState: null,turnError:null, finals: new Map(), unphasedMessages: new Map(), usage: null };
      threads.set(id, entry);
    }
    return entry;
  }
  /** @type {Map<string,import('./strata-work-policy.mjs').NativeCommandFact>} */
  const commands=new Map();
  /** @param {Record<string, unknown>} item @param {string} threadId @param {string | null} turnId @param {boolean} [live] */
  function consumeItem(item, threadId, turnId, live = false) {
    if(item.type==='commandExecution'&&typeof item.id==='string'&&typeof item.command==='string'&&typeof item.cwd==='string'
      &&['completed','failed','declined'].includes(String(item.status))) {
      const key=`${threadId}\0${turnId}\0${item.id}`;
      if(!commands.has(key)) {
        commands.set(key,{threadId,turnId,itemId:item.id,position:commands.size+1,command:item.command,cwd:item.cwd,
          exitCode:typeof item.exitCode==='number'?item.exitCode:null,outputDigest:typeof item.aggregatedOutput==='string'?createHash('sha256').update(item.aggregatedOutput).digest('hex'):null});
        if(live)notify({type:'changed',threadId,turnId});
      }
    }
    if (item.type === 'agentMessage' || item.type === 'userMessage') observedMessages.add(threadId);
    if (live && item.type === 'agentMessage' && (item.phase === 'commentary' || item.phase === 'final_answer') && typeof item.id === 'string' && typeof item.text === 'string' && item.text.length) {
      notify({type: 'message', message: {itemId: item.id, threadId, turnId, phase: item.phase, text: item.text, recordSequence: 0}});
    }
    if (item.type === 'agentMessage' && item.phase === 'final_answer' && turnId && typeof item.text === 'string') {
      observed(threadId).finals.set(turnId, item.text);
    }
    if (item.type === 'agentMessage' && (item.phase === null || item.phase === undefined) && turnId && typeof item.text === 'string') {
      observed(threadId).unphasedMessages.set(turnId, item.text);
    }
    if (item.type === 'collabAgentToolCall') {
      for (const receiver of strings(item.receiverThreadIds) ?? []) observed(receiver);
    }
    if (item.type === 'subAgentActivity' && typeof item.agentThreadId === 'string') observed(item.agentThreadId);
  }
  /** @param {Record<string, unknown>} raw */
  function consumeThread(raw) {
    const id = text(raw.id);
    if (!id) throw new Error('Native thread identity is missing.');
    const entry = observed(id);
    entry.thread = { ...entry.thread, ...raw, historyMode: raw.historyMode ?? entry.thread.historyMode ?? 'legacy' };
    consumeTurns(id, array(raw.turns).map(object));
    return id;
  }
  /** @param {Record<string,unknown>} raw */
  function emptyParentlessThread(raw) {
    return Object.hasOwn(raw, 'parentThreadId') && raw.parentThreadId === null
      && Object.hasOwn(raw, 'forkedFromId') && raw.forkedFromId === null
      && typeof raw.preview === 'string' && raw.preview.length === 0
      && Array.isArray(raw.turns) && raw.turns.length === 0
      && raw.source !== undefined && typeof raw.path === 'string' && isAbsolute(raw.path)
      && ['idle', 'notLoaded'].includes(String(object(raw.status).type));
  }
  /** @param {string} id @param {Record<string, unknown>[]} turns */
  function consumeTurns(id, turns) {
    const entry = observed(id);
    for (const turn of turns) {
      const turnId = text(turn.id);
      if (turnId === entry.liveTurnId && turn.status === 'inProgress' && ['completed', 'interrupted', 'failed'].includes(entry.turnState ?? '')) continue;
      for (const item of array(turn.items)) consumeItem(object(item), id, turnId);
    }
    const latest = turns.at(-1);
    // 持久页可能落后于已观察到的活动回合, 也可能尚未刷新该回合的完成状态.
    if (latest && typeof latest.id === 'string' && (!entry.liveTurnId || latest.id === entry.liveTurnId)) {
      const completed = entry.liveTurnId === latest.id && ['completed', 'interrupted', 'failed'].includes(entry.turnState ?? '');
      entry.turnId = latest.id;
      if (!completed) {entry.turnState = text(latest.status);entry.turnError=object(latest.error);}
    }
  }
  /** @param {Record<string, unknown>} message */
  function receive(message) {
    if (!rootId || stopped) return false;
    const method = text(message.method);
    if (!method) { fail('Invalid Codex App Server message.'); return; }
    const params = object(message.params);
    const threadId = text(params.threadId)
      ?? (['execCommandApproval', 'applyPatchApproval'].includes(method) ? text(params.conversationId) : null)
      ?? text(object(params.thread).id);
    const turnId = text(params.turnId) ?? text(object(params.turn).id);
    if (method === 'serverRequest/resolved') {
      const requestId=String(params.requestId);
      if (!clientRequests.delete(requestId)) return false;
      notify({type:'changed',threadId:null,turnId:null});
      return true;
    }
    if (!threadId) return false;
    const parent = text(object(params.thread).parentThreadId)
      ?? parentFromSource(object(params.thread).source,'subAgent');
    if (!knownIds.has(threadId) && !(parent && knownIds.has(parent))) return false;
    if ('id' in message) {
      const nativeId = message.id;
      if (typeof nativeId !== 'string' && (typeof nativeId !== 'number' || !Number.isSafeInteger(nativeId))) {
        fail('Native request identity is invalid.');
        return true;
      }
      const requestId = String(nativeId);
      if (clientRequests.has(requestId)) { fail('Native request identity was repeated.'); return true; }
      clientRequests.set(requestId, {
        nativeId, requestId, method, params, threadId, turnId,
        kind: method.includes('requestUserInput') ? 'user-input' : /approval/i.test(method) ? 'approval' : 'unsupported',
      });
    } else {
      if (method === 'thread/started') consumeThread(object(params.thread));
      if (threadId) {
        const entry = observed(threadId);
        if (method === 'turn/started' || method === 'turn/completed') {
          const turn = object(params.turn);
          if (turnId) entry.turnId = entry.liveTurnId = turnId;
          if(threadId===rootId&&turnId){
            if(uncertainStart&&turnId!==uncertainStart.priorTurnId)uncertainStart.turnId=turnId;
            if(method==='turn/started'&&deadlineStopping)interruptDeadlineTurn(turnId);
          }
          entry.turnState = text(turn.status);
          entry.turnError=object(turn.error);
          for (const item of array(turn.items)) consumeItem(object(item), threadId, turnId);
        }
        if (method === 'item/completed') consumeItem(object(params.item), threadId, turnId, true);
        if (method === 'thread/status/changed') entry.thread.status = params.status;
        if (method === 'thread/closed') entry.thread.status = {type:'notLoaded'};
        if (method === 'thread/tokenUsage/updated') entry.usage = usage(object(object(params.tokenUsage).total), false);
      }
    }
    if ('id' in message || ['thread/started','thread/closed','turn/started','turn/completed','thread/status/changed'].includes(method)
      || (method === 'item/completed' && ['collabAgentToolCall','subAgentActivity'].includes(String(object(params.item).type)))) {
      notify({type:'changed',threadId,turnId});
    }
    return true;
  }
  const detach=connection.subscribe(receive,fail,()=>{if(!stopped)notify({type:'exited',reason:connection.failure});});

  /** @param {string} instructions */
  function threadParams(instructions) {
    requireText(instructions);
    const params = {
      model: settings.model, modelProvider: settings.modelProvider, serviceTier: settings.serviceTier,
      cwd, runtimeWorkspaceRoots: [cwd], config,
      developerInstructions: instructions,
    };
    return {
      ...params,
      ...(typeof config.default_permissions === 'string' ? {permissions: config.default_permissions} : {}),
      ...(typeof config.approval_policy === 'string' ? {approvalPolicy: config.approval_policy} : {}),
    };
  }
  /** @param {string} threadId */
  function requireRoot(threadId) {
    if (!rootId || threadId !== rootId) throw new Error('The request must identify this native root thread.');
  }

  /** @param {string} ancestor @param {boolean} archived */
  async function discover(ancestor, archived) {
    let cursor = /** @type {string | null} */ (null);
    const cursors = new Set();
    do {
      const response = await request('thread/list', { ancestorThreadId: ancestor, archived, sourceKinds, limit: 100, cursor });
      if (!Array.isArray(response.data)) throw new Error('Native member discovery is incomplete.');
      for (const raw of response.data) consumeThread(object(raw));
      cursor = text(response.nextCursor);
      if (cursor && cursors.has(cursor)) throw new Error('Native member pagination did not advance.');
      if (cursor) cursors.add(cursor);
    } while (cursor);
  }

  /** @param {{rootThreadId: string, knownThreadIds?: string[]}} input @returns {Promise<NativeSnapshot>} */
  async function snapshot({ rootThreadId, knownThreadIds = [] }) {
    requireRoot(rootThreadId);
    const exited=stopped||connection.exited;
    for (const id of knownThreadIds) observed(id);
    const unknownReasons = [];
    /** @type {Set<string>} */
    const matchingFreshReads = new Set();
    if (failure && !exited) unknownReasons.push(failure);
    if (!exited) {
      const discoveries = await Promise.allSettled([discover(rootThreadId, false), discover(rootThreadId, true)]);
      if (discoveries.some((result) => result.status === 'rejected')) unknownReasons.push('Native member discovery failed.');
      // 加载列表覆盖尚未写入子线程索引的成员, 但共享进程里的其他根线程不属于此组.
      try {
        let cursor = /** @type {string | null} */ (null);
        const cursors = new Set();
        do {
          const loaded = await request('thread/loaded/list', { cursor, limit: 100 });
          if (!Array.isArray(loaded.data)) throw new Error('Missing native loaded threads.');
          for (const id of loaded.data) {
            if (typeof id !== 'string' || knownIds.has(id) || connection.isOtherRoot(id,rootThreadId)) continue;
            const raw=object((await request('thread/read',{threadId:id,includeTurns:false})).thread);
            const parent=text(raw.parentThreadId)??parentFromSource(raw.source,'subAgent');
            if (parent && knownIds.has(parent)) consumeThread(raw);
          }
          cursor = text(loaded.nextCursor);
          if (cursor && cursors.has(cursor)) throw new Error('Native loaded pagination did not advance.');
          if (cursor) cursors.add(cursor);
        } while (cursor);
      } catch { unknownReasons.push('Native loaded member discovery failed.'); }
      const readIds = new Set();
      while ([...knownIds].some((id) => !readIds.has(id))) {
        const reads = await Promise.allSettled([...knownIds].filter((id) => !readIds.has(id)).map(async (id) => {
          readIds.add(id);
          const historyMode = observed(id).thread.historyMode;
          const response = await request('thread/read', { threadId: id, includeTurns: historyMode === 'legacy' });
          const thread = object(response.thread);
          if (id === rootThreadId && freshCreation && thread.id === freshCreation.threadId
            && thread.path === freshCreation.path && jsonSemanticallyEqual(thread.source, freshCreation.source)
            && emptyParentlessThread(thread)) matchingFreshReads.add(id);
          if (consumeThread(thread) !== id) throw new Error('Native thread identity changed.');
          if (observed(id).thread.historyMode === 'paginated') {
            // 原生新线程在首条用户消息前尚未物化, 此时 turns/list 会拒绝, 但没有历史回合需要读取.
            const status = object(observed(id).thread.status).type;
            if (!(freshRoot && id === rootThreadId && observed(id).turnId === null && (status === 'idle' || status === 'notLoaded'))) {
              const page = await request('thread/turns/list', { threadId: id, limit: 1, sortDirection: 'desc', itemsView: 'full' });
              if (!Array.isArray(page.data)) throw new Error('Native latest turn page is missing.');
              const turns = page.data.map(object);
              if (turns.some((turn) => (turn.itemsView === undefined ? 'full' : turn.itemsView) !== 'full')) throw new Error('Native latest turn items are not fully loaded.');
              if (turns.some((turn) => !text(turn.id) || !Array.isArray(turn.items) || !['completed', 'interrupted', 'failed', 'inProgress'].includes(String(turn.status)))) {
                throw new Error('Native latest turn facts are incomplete.');
              }
              consumeTurns(id, turns.reverse());
            }
          } else if (historyMode !== 'legacy') {
            const full = await request('thread/read', { threadId: id, includeTurns: true });
            if (consumeThread(object(full.thread)) !== id) throw new Error('Native thread identity changed.');
          }
        }));
        for (const result of reads) if (result.status === 'rejected') {
          unknownReasons.push(result.reason instanceof Error ? result.reason.message : 'Native member read failed.');
        }
      }
      discoveryReasons = [...unknownReasons];
      discoveryComplete = discoveryReasons.length === 0;
    } else if (!discoveryComplete && !stopped) {
      unknownReasons.push(...discoveryReasons, 'Native group discovery was not complete before App Server exit.');
    }
    // 协作 item 可在读线程时发现先前未索引的成员, 本轮仍须把它们保留为未知而不遗漏.
    const memberIds = [...knownIds].sort();
    /** @type {NativePublicMessage[]} */
    const publicMessages = [];
    /** @type {import('./native-measurement.mjs').NativeResponseMeasurement[]} */const responses=[];
    /** @type {NativeUserMessage[]} */
    const userMessages = [];
    const members = await Promise.all(memberIds.map(async (id) => {
      const entry = observed(id);
      const path = text(entry.thread.path);
      const beforeFirstTurn = id === rootThreadId && freshRoot && entry.turnId === null;
      let missingNativeRecord = false;
      let native = /** @type {ReturnType<typeof parseNativeRecords> | null} */ (null);
      if (path) {
        let content = /** @type {string | Buffer | null} */ (null);
        try { content = await readNativeFile(path); }
        catch (error) {
          missingNativeRecord = beforeFirstTurn && error instanceof Error && 'code' in error && error.code === 'ENOENT';
          if (!missingNativeRecord) unknownReasons.push(`${id}: native records could not be read.`);
        }
        if (content !== null && !String(content).trim()) unknownReasons.push(`${id}: native records contain no verifiable metadata.`);
        if (content !== null && (String(content).trim() || !beforeFirstTurn)) {
          try {
            const source=String(content);
            const cached=recordCache.get(path);
            native=cached?.content===source?cached.parsed:parseNativeRecords(source,id,env);
            if (cached?.content!==source) recordCache.set(path,{content:source,parsed:native});
          }
          catch { unknownReasons.push(`${id}: native records could not be read.`); }
        }
      } else if (!beforeFirstTurn) unknownReasons.push(`${id}: native record path is missing.`);
      if (native) {
        unknownReasons.push(...native.unknownReasons.map((reason) => `${id}: ${reason}`));
        publicMessages.push(...native.publicMessages);
        responses.push(...native.responses);
        userMessages.push(...native.userMessages);
      }
      const contexts = native?.contexts ?? [];
      const turnId = entry.turnId ?? native?.turnId ?? null;
      const createdWithoutHistory = missingNativeRecord && beforeFirstTurn && freshCreation?.threadId === id
        && freshCreation.path === path && matchingFreshReads.has(id)
        && entry.liveTurnId === null && entry.turnState === null && entry.finals.size === 0
        && entry.unphasedMessages.size === 0 && !observedMessages.has(id) && contexts.length === 0;
      if (missingNativeRecord && !createdWithoutHistory) unknownReasons.push(`${id}: native conversation history could not be verified.`);
      if (beforeFirstTurn && turnId === null && native?.contexts.length) unknownReasons.push(`${id}: native turn identity is missing.`);
      if (turnId && !contexts.some((context) => context.turnId === turnId)) unknownReasons.push(`${id}: current native turn context is missing.`);
      if (!exited && !['notLoaded', 'idle', 'active', 'systemError'].includes(String(object(entry.thread.status).type))) unknownReasons.push(`${id}: current native thread status is missing.`);
      if (turnId && !entry.turnState) unknownReasons.push(`${id}: current native turn state is missing.`);
      const parentThreadId = text(entry.thread.parentThreadId) ?? parentFromSource(entry.thread.source, 'subAgent') ?? native?.parentThreadId ?? null;
      if (id !== rootThreadId && !parentThreadId) unknownReasons.push(`${id}: native parent identity is missing.`);
      const modelProvider = native?.modelProvider ?? null;
      return /** @type {NativeMember} */ ({
        threadId: id, parentThreadId,
        state: exited ? 'exited' : memberState(entry), turnId, turnStatus:entry.turnState,
        sessionPath: path, modelProvider, contexts,
        hasConversationHistory: native?.hasConversationHistory === true || observedMessages.has(id) ? true
          : native?.hasConversationHistory ?? (createdWithoutHistory ? false : null),
        usage: nativeUsage(native, entry.usage),
        turnError:entry.turnError ? {message:entry.turnError.message,additionalDetails:entry.turnError.additionalDetails,
          codexErrorInfo:entry.turnError.codexErrorInfo} : null,
        retryableModelFailure:['httpConnectionFailed','responseStreamConnectionFailed'].includes(typeof entry.turnError?.codexErrorInfo==='string'?entry.turnError.codexErrorInfo:String(Object.keys(object(entry.turnError?.codexErrorInfo))[0]??'')),
        finalResponse: turnId ? entry.finals.get(turnId) ?? native?.finals.get(turnId)
          ?? (entry.turnState === 'completed' ? entry.unphasedMessages.get(turnId) : null) ?? null : null,
      });
    }));
    if (knownIds.size !== memberIds.length) unknownReasons.push('Native member discovery changed during snapshot observation.');
    const reasons = [...new Set(unknownReasons)];
    const unavailableAt=stoppedAt??connection.exitedAt;
    return { commandFacts:[...commands.values()].filter(item=>item.threadId===rootThreadId),measurementFacts:{responses:responses.filter(item=>item.threadId===rootThreadId),
      requestsComplete:false,
      ...(unavailableAt!==null?{workState:{state:'unavailable',at:unavailableAt,estimated:true,basis:'Client observation of native process closure or verified root unload; the actual exit may precede this observation.'}}
        :workingSince!==null?{workState:{state:'working',at:workingSince,estimated:true,basis:'Creation or resume of the original native root is confirmed; accumulated non-work facts for the same task are retained.'}}:{}),
      workCoverage:{complete:false,basis:'Coverage is limited to verified native exit and original root resume observations; unobserved downtime boundaries remain estimated.'}}, rootThreadId, environmentState: exited ? 'exited' : 'running', members, factsComplete: reasons.length === 0, unknownReasons: reasons, clientRequests: [...clientRequests.values()].map(({nativeId: _nativeId, ...value}) => ({ ...value })), publicMessages: publicMessages.sort((a, b) => a.threadId.localeCompare(b.threadId) || a.recordSequence - b.recordSequence), userMessages:userMessages.sort((a,b)=>a.threadId.localeCompare(b.threadId)||a.recordSequence-b.recordSequence) };
  }

  /** @returns {Promise<Set<string>>} */
  async function loadedThreadIds() {
    const ids=new Set();
    /** @type {string|null} */let cursor=null;
    const cursors=new Set();
    do {
      const page=await request('thread/loaded/list',{cursor,limit:100});
      if(!Array.isArray(page.data)||!page.data.every(id=>typeof id==='string'))throw new Error('Native loaded thread facts are unavailable.');
      for(const id of page.data)ids.add(/** @type {string} */ (id));
      cursor=text(page.nextCursor);
      if(cursor&&cursors.has(cursor))throw new Error('Native loaded pagination did not advance.');
      if(cursor)cursors.add(cursor);
    }while(cursor);
    return ids;
  }
  /** @param {string} threadId */
  async function noBackgroundTerminals(threadId) {
    return (await backgroundTerminalIds(threadId)).length===0;
  }
  /** @param {string} threadId @returns {Promise<string[]>} */
  async function backgroundTerminalIds(threadId) {
    /** @type {string|null} */let cursor=null;
    const cursors=new Set();
    const ids=new Set();
    do {
      const page=await request('thread/backgroundTerminals/list',{threadId,limit:100,cursor});
      if(!Array.isArray(page.data))throw new Error('Native background terminal facts are unavailable.');
      for(const value of page.data){
        const processId=text(object(value).processId);
        if(!processId)throw new Error('Native background terminal identity is missing.');
        ids.add(processId);
      }
      cursor=page.nextCursor===null?null:text(page.nextCursor);
      if(page.nextCursor!==null&&!cursor)throw new Error('Native terminal pagination cursor is invalid.');
      if(cursor&&cursors.has(cursor))throw new Error('Native terminal pagination did not advance.');
      if(cursor)cursors.add(cursor);
    }while(cursor);
    return [...ids];
  }
  /** @param {number} since @returns {Promise<void>} */
  async function waitChange(since) {
    if(changeVersion!==since)return;
    await new Promise((resolveDone,reject)=>{
      const timer=setTimeout(()=>{waiters.delete(done);reject(new Error('Native root unload was not observed.'));},unloadWaitMs);
      const done=()=>{clearTimeout(timer);waiters.delete(done);resolveDone(undefined);};
      waiters.add(done);
      if(changeVersion!==since)done();
    });
  }
  /** @type {Set<()=>void>} */
  const waiters=new Set();
  /** @returns {Promise<{environmentState:'exited'}>} */
  async function stop() {
    if(stopped)return {environmentState:'exited'};
    if(connection.exited)throw new Error('Native root and tool unload could not be confirmed after App Server exit.');
    if(!rootId){stopped=true;stoppedAt=Date.now();detach();onStopped();return {environmentState:'exited'};}
    let facts=await snapshot({rootThreadId:rootId});
    if(!discoveryComplete)throw new Error('Native group membership is incomplete for unload.');
    for(const member of facts.members.filter(member=>member.state==='active')){
      if(!member.turnId)throw new Error('Native active turn identity is missing.');
      await request('turn/interrupt',{threadId:member.threadId,turnId:member.turnId});
    }
    while(facts.members.some(member=>member.state==='active')){
      const version=changeVersion;
      facts=await snapshot({rootThreadId:rootId});
      if(!discoveryComplete)throw new Error('Native group membership is incomplete for unload.');
      if(facts.members.some(member=>member.state==='active'))await waitChange(version);
    }
    if(deadlineStopping&&uncertainStart){
      const root=facts.members.find(member=>member.threadId===rootId);
      const priorUnchanged=uncertainStart.rejected&&uncertainStart.turnId===null&&facts.factsComplete
        &&root?.turnId===uncertainStart.priorTurnId&&root.state!=='active'&&!facts.clientRequests.length
        &&!facts.members.some(member=>member.state==='active')
        &&(uncertainStart.priorTurnId===null?root.turnStatus===null
          :['completed','interrupted','failed'].includes(root.turnStatus??''));
      if(priorUnchanged)uncertainStart=null;
      else if(!uncertainStart.turnId||root?.turnId!==uncertainStart.turnId
        ||!['completed','interrupted','failed'].includes(root.turnStatus??''))
        throw new Error('A native turn start remains unconfirmed during deadline stop.');
    }
    if(facts.clientRequests.length)throw new Error('Native interaction remains pending.');
    for(const member of facts.members){
      if(!await noBackgroundTerminals(member.threadId))throw new Error('Native background tool remains active.');
    }
    const members=facts.members.map(member=>member.threadId);
    for(const id of [...members].reverse())await request('thread/unsubscribe',{threadId:id});
    let version=changeVersion;
    let loaded=await loadedThreadIds();
    while(members.some(id=>loaded.has(id))){
      await waitChange(version);
      version=changeVersion;
      loaded=await loadedThreadIds();
    }
    await discover(rootId,false);
    await discover(rootId,true);
    if(knownIds.size!==members.length||clientRequests.size)throw new Error('Native group changed during unload confirmation.');
    // A final native read keeps recorded tokens and completion facts after the handle is unloaded.
    stopped=true;
    uncertainStart=null;
    stoppedAt=Date.now();
    connection.releaseRoot(rootId);
    for(const done of waiters)done();
    detach();
    onStopped();
    return {environmentState:'exited'};
  }

  return {
    async start({ instructions }) {
      if (rootId) throw new Error('This native session already has a root thread.');
      const response = await request('thread/start', threadParams(instructions));
      const created = object(response.thread);
      const createdId=text(created.id);
      if(!createdId)throw new Error('Native thread identity is missing.');
      connection.claimRoot(createdId);
      try{rootId=consumeThread(created);}catch(error){connection.releaseRoot(createdId);throw error;}
      freshCreation = emptyParentlessThread(created)
        ? {threadId:rootId,path:/** @type {string} */ (created.path),source:created.source} : null;
      freshRoot = true;
      workingSince=Date.now();
      return { threadId: rootId, sessionPath: text(observed(rootId).thread.path) };
    },
    async resume({ threadId, expectedSessionPath, instructions }) {
      if (rootId) throw new Error('This native session already has a root thread.');
      if(connection.isClaimed(threadId))throw new Error('Native root thread already has a control handle.');
      const response = await request('thread/resume', { ...threadParams(instructions), threadId, excludeTurns: true });
      const returned=object(response.thread);
      const actualId=text(returned.id);
      if (actualId !== threadId) throw new Error('Native resume did not return the original thread.');
      const sessionPath = text(returned.path);
      if (expectedSessionPath !== null && sessionPath !== expectedSessionPath) throw new Error('Native resume record path changed.');
      connection.claimRoot(actualId);
      try{rootId=consumeThread(returned);}catch(error){connection.releaseRoot(actualId);throw error;}
      freshRoot = false;
      freshCreation = null;
      workingSince=Date.now();
      return { threadId: actualId, sessionPath };
    },
    async startTurn({ threadId, handoff }) {
      requireRoot(threadId);
      requireText(handoff);
      if(deadlineStopping)throw new Error('The native root has a deadline stop in progress.');
      const starting={priorTurnId:observed(threadId).turnId,turnId:/** @type {string|null} */(null),rejected:false};
      uncertainStart=starting;
      try {
        const response = await request('turn/start', {
          threadId, input: [{ type: 'text', text: handoff, text_elements: [] }],
          model: settings.model, effort: settings.reasoningEffort, serviceTier: settings.serviceTier,
        });
        const turn = object(response.turn);
        const turnId = text(turn.id);
        if (!turnId) throw new Error('Native turn identity is missing.');
        starting.turnId=turnId;
        if(deadlineStopping){interruptDeadlineTurn(turnId);throw new Error('The native turn start completed after deadline stop.');}
        if(uncertainStart===starting)uncertainStart=null;
        const entry = observed(threadId);
        const terminalNotice = entry.liveTurnId === turnId && ['completed','interrupted','failed'].includes(entry.turnState ?? '');
        entry.turnId = entry.liveTurnId = turnId;
        if (!terminalNotice) {entry.turnState = text(turn.status) ?? 'inProgress';entry.turnError=object(turn.error);}
        for (const item of array(turn.items)) consumeItem(object(item), threadId, turnId);
        return { turnId };
      } catch(error) {
        if(error instanceof NativeRequestRejected)starting.rejected=true;
        throw error;
      } finally {
        if(deadlineStopping)notify({type:'changed',threadId,turnId:threads.get(threadId)?.turnId??null});
      }
    },
    async steer({ threadId, turnId, instruction }) {
      requireRoot(threadId);
      requireText(instruction);
      const response = await request('turn/steer', { threadId, expectedTurnId: turnId, input: [{ type: 'text', text: instruction, text_elements: [] }] });
      const actualTurnId = text(response.turnId);
      if (actualTurnId !== turnId) throw new Error('Native steering did not target the expected turn.');
      return { turnId };
    },
    snapshot,
    async respond({requestId, response}) {
      const pendingRequest = clientRequests.get(requestId);
      if (!pendingRequest) throw new Error('Native request is no longer pending.');
      if (!isJsonObject(response) || serializeJson(response).status !== 'succeeded') throw new Error('Native response must be a JSON object.');
      clientRequests.delete(requestId);
      try { write({id: pendingRequest.nativeId, result: response}); }
      catch (error) { clientRequests.set(requestId, pendingRequest); throw error; }
      return {accepted: true};
    },
    async rejectRequest({requestId, reason}) {
      const pendingRequest = clientRequests.get(requestId);
      if (!pendingRequest) throw new Error('Native request is no longer pending.');
      requireText(reason);
      clientRequests.delete(requestId);
      try { write({id: pendingRequest.nativeId, error: {code: -32000, message: reason}}); }
      catch (error) {clientRequests.set(requestId, pendingRequest); throw error;}
      return {accepted: true};
    },
    async readThreadMetadata({threadId}) {
      const result = await request('thread/read', {threadId, includeTurns: false});
      const raw = object(result.thread);
      if (text(raw.id) !== threadId) throw new Error('Native metadata thread identity changed.');
      return {title: text(raw.name), preview: text(raw.preview) ?? '', sessionPath:text(raw.path)};
    },
    async idleFacts({rootThreadId, knownThreadIds = []}) {
      const facts = await snapshot({rootThreadId, knownThreadIds});
      if (!facts.factsComplete || facts.environmentState !== 'running') return {safe: false, known: false, reason: 'Native member facts are incomplete.'};
      if (facts.members.some(member => !['idle', 'interrupted', 'failed'].includes(member.state)) || facts.clientRequests.length > 0) return {safe: false, known: true, reason: 'Native work or interaction is pending.'};
      try {
        for (const member of facts.members) {
          if(!await noBackgroundTerminals(member.threadId))return {safe:false,known:true,reason:'Native background terminal is running.'};
        }
      } catch { return {safe: false, known: false, reason: 'Native background terminal facts are unavailable.'}; }
      return {safe: true, known: true, reason: null};
    },
    async cleanupTurnTerminals({rootThreadId,turnId,knownThreadIds=[]}) {
      requireRoot(rootThreadId);
      requireText(turnId);
      const deadline=Date.now()+unloadWaitMs;
      const requested=new Set();
      while(true){
        const facts=await snapshot({rootThreadId,knownThreadIds});
        const root=facts.members.find(member=>member.threadId===rootThreadId);
        if(!facts.factsComplete||facts.environmentState!=='running'||!root||root.turnId!==turnId
          ||threads.get(rootThreadId)?.turnState!=='completed'||facts.members.some(member=>member.state==='active'))
          throw new Error('The exact native turn is not confirmed completed.');
        const terminals=[];
        for(const member of facts.members)for(const processId of await backgroundTerminalIds(member.threadId))
          terminals.push({threadId:member.threadId,processId});
        if(!terminals.length){
          const idle=await this.idleFacts({rootThreadId,knownThreadIds});
          if(!idle.safe||!idle.known)throw new Error(idle.reason??'Native idle facts are unavailable.');
          return {confirmed: /** @type {true} */ (true)};
        }
        for(const terminal of terminals){
          const key=`${terminal.threadId}:${terminal.processId}`;
          if(requested.has(key))continue;
          const current=threads.get(rootThreadId);
          if(current?.turnId!==turnId||current.turnState!=='completed')
            throw new Error('The native turn changed during terminal cleanup.');
          const result=await request('thread/backgroundTerminals/terminate',terminal);
          if(typeof result.terminated!=='boolean')throw new Error('Native terminal termination was not acknowledged.');
          requested.add(key);
        }
        if(Date.now()>=deadline)throw new Error('Native background terminal exit was not observed.');
        await new Promise(resolveDone=>setTimeout(resolveDone,25));
      }
    },
    async interruptGroup({ rootThreadId, turnId }) {
      const facts = await snapshot({ rootThreadId });
      const root = facts.members.find((member) => member.threadId === rootThreadId);
      if (!root || root.turnId !== turnId) throw new Error('Native interrupt turn changed.');
      if (!facts.factsComplete) throw new Error('Native group facts are incomplete for interruption.');
      const active = facts.members.filter((member) => member.state === 'active');
      await Promise.all(active.map(async (member) => {
        if (!member.turnId) throw new Error('Native active turn identity is missing.');
        await request('turn/interrupt', { threadId: member.threadId, turnId: member.turnId });
      }));
      return { accepted: true };
    },
    stop,
    stopForDeadline(){
      deadlineStopping=true;
      const root=rootId?threads.get(rootId):null;
      if(root&&root.turnId&&memberState(root)==='active')interruptDeadlineTurn(root.turnId);
      return stop();
    },
  };
}

/** @param {ObservedThread} entry @returns {NativeMember['state']} */
function memberState(entry) {
  const status = object(entry.thread.status).type;
  if (status === 'systemError') return 'failed';
  if (status === 'active' || (status !== 'notLoaded' && entry.liveTurnId === entry.turnId && entry.turnState === 'inProgress')) return 'active';
  if (entry.turnState === 'failed') return 'failed';
  if (entry.turnState === 'interrupted') return 'interrupted';
  return 'idle';
}

/** @param {string | Buffer} content @param {string} threadId @param {NodeJS.ProcessEnv} env */
function parseNativeRecords(content, threadId, env) {
  const source = Buffer.isBuffer(content) ? new TextDecoder('utf-8', { fatal: true }).decode(content) : content;
  const lines = source.split('\n');
  /** @type {string[]} */
  const unknownReasons = [];
  /** @type {NativeContext[]} */
  const contexts = [];
  /** @type {Map<string, string>} */
  const finals = new Map();
  /** @type {NativePublicMessage[]} */
  const publicMessages = [];
  /** @type {NativeUserMessage[]} */
  const userMessages = [];
  /** @type {Record<string, unknown>[]} */
  const records = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) { records.push({}); continue; }
    const parsed = parseJsonText(line);
    if (parsed.status !== 'succeeded' || !isJsonObject(parsed.value)) {
      unknownReasons.push('Native records contain an incomplete or invalid JSON line.');
      records.push({});
    } else records.push(parsed.value);
  }
  const meta = object(records.find((record) => record.type === 'session_meta')?.payload);
  if (meta.id !== threadId) throw new Error('Native record identity differs from Thread.id.');
  const modelProvider = text(meta.model_provider);
  const parentThreadId = parentFromSource(meta.source, 'subagent');
  const historyStart = meta.subagent_history_start_ordinal;
  if (historyStart !== undefined && (!Number.isSafeInteger(historyStart) || Number(historyStart) < 0)) {
    unknownReasons.push('Native subagent history boundary is invalid.');
  }
  let turnId = /** @type {string | null} */ (null);
  let measuredUsage = /** @type {NativeUsage | null} */ (null);
  let responseUsage = /** @type {NativeUsage | null} */ (null);
  /** @type {import('./native-measurement.mjs').NativeResponseMeasurement[]} */const responses=[];
  /** @type {Map<string, NativeUsage>} */
  const seenResponses = new Map();
  let conflictingUsage = false;
  let hasConversationHistory = false;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (Object.keys(record).length === 0) continue;
    // fork 复制的父线程记录不是这个子 Agent 的实际设置, 用量或结论.
    if (historyStart !== undefined) {
      if (!Number.isSafeInteger(record.ordinal)) {
        unknownReasons.push('Native forked history ordinal is missing.');
        continue;
      }
      if (Number(record.ordinal) < Number(historyStart)) continue;
    }
    const payload = object(record.payload);
    if (record.type === 'response_item' && payload.type === 'message' && (payload.role === 'user' || payload.role === 'assistant')) hasConversationHistory = true;
    if (record.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
      const parts = array(payload.content).map(object).filter(part => ['input_text','text'].includes(String(part.type)) && typeof part.text === 'string');
      const messageText = parts.map(part => String(part.text)).join('');
      if (messageText) userMessages.push({itemId:text(payload.id),threadId,turnId:text(payload.turn_id) ?? turnId,text:messageText,recordSequence:index+1});
    }
    if (record.type === 'event_msg' && (payload.type === 'user_message' || payload.type === 'agent_message')) hasConversationHistory = true;
    if (record.type === 'token_usage_record') {
      const responseThreadId = text(payload.thread_id);
      const responseId = text(payload.response_id);
      if (!responseThreadId || !responseId || responseThreadId !== threadId) {
        unknownReasons.push('Native response usage identity is missing or differs from Thread.id.');
      } else {
        const identity = `${responseThreadId}\0${responseId}`;
        const actual = usage(object(payload.usage), true);
        const prior = seenResponses.get(identity);
        if (prior) {
          if (!jsonSemanticallyEqual(prior, actual)) {
            conflictingUsage = true;
            unknownReasons.push('Native response usage records conflict.');
          }
        } else {
          seenResponses.set(identity, actual);
          responseUsage = responseUsage === null ? actual : addUsage(responseUsage, actual);
          responses.push({threadId:responseThreadId,responseId,turnId:text(payload.turn_id),recordSequence:index+1,
            completedAt:typeof record.timestamp==='string'?Date.parse(record.timestamp):null,
            inputTokens:actual.inputTokens,cachedInputTokens:actual.cachedInputTokens,outputTokens:actual.outputTokens,source:'existing-events',basis:'Native response usage record has no verified request-start or generated-content time.'});
        }
      }
    }
    if (record.type === 'turn_context') {
      const currentTurn = text(payload.turn_id);
      if (!currentTurn) { unknownReasons.push('Native turn context identity is missing.'); continue; }
      turnId = currentTurn;
      const contextReasons = [];
      const model = text(payload.model);
      const reasoningEffort = text(payload.effort);
      const cwd = text(payload.cwd);
      if (!cwd) contextReasons.push('Native turn cwd is missing.');
      const permissionsRules = permissions(payload, env);
      if (!permissionsRules) contextReasons.push('Native filesystem permissions could not be interpreted.');
      contexts.push({ turnId: currentTurn, recordSequence: index + 1, model, modelProvider, reasoningEffort, cwd, permissionsRules, unknownReasons: contextReasons });
    }
    if (record.type === 'event_msg') {
      if (payload.type === 'task_started') turnId = text(payload.turn_id) ?? turnId;
      if (payload.type === 'token_count') {
        const total = object(object(payload.info).total_token_usage);
        if (Object.keys(total).length) measuredUsage = usage(total, true);
      }
      if (payload.type === 'task_complete' && turnId && typeof payload.last_agent_message === 'string') finals.set(text(payload.turn_id) ?? turnId, payload.last_agent_message);
      if (payload.type === 'agent_message' && payload.phase === 'final_answer' && turnId && typeof payload.message === 'string') finals.set(text(payload.turn_id) ?? turnId, payload.message);
    }
    if (record.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant' && payload.phase === 'final_answer' && turnId) {
      const parts = array(payload.content).map(object).filter((part) => part.type === 'output_text' && typeof part.text === 'string');
      if (parts.length) finals.set(turnId, parts.map((part) => part.text).join(''));
    }
    if (record.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant'
      && (payload.phase === 'commentary' || payload.phase === 'final_answer') && typeof payload.id === 'string') {
      const parts = array(payload.content).map(object).filter((part) => part.type === 'output_text' && typeof part.text === 'string');
      const messageText = parts.map((part) => String(part.text)).join('');
      if (messageText) publicMessages.push({itemId: payload.id, threadId, turnId, phase: payload.phase, text: messageText, recordSequence: index + 1});
    }
  }
  return { contexts, finals, publicMessages, userMessages, responses, responseUsage: conflictingUsage ? createUsage(null) : responseUsage, cumulativeUsage: measuredUsage, modelProvider, parentThreadId, turnId, hasConversationHistory: unknownReasons.some(reason => reason.includes('invalid JSON') || reason.includes('ordinal')) ? null : hasConversationHistory, unknownReasons };
}

/** @param {Record<string, unknown>} payload @param {NodeJS.ProcessEnv} env @returns {NativePermissionRule[] | null} */
function permissions(payload, env) {
  const policy = object(payload.file_system_sandbox_policy);
  const profile = object(object(payload.permission_profile).file_system);
  const hasPolicy = Object.hasOwn(payload, 'file_system_sandbox_policy');
  const actual = hasPolicy ? policy : profile;
  if ((hasPolicy ? policy.kind : profile.type) !== 'restricted' || !Array.isArray(actual.entries)) return null;
  /** @type {NativePermissionRule[]} */
  const rules = [];
  for (const raw of actual.entries) {
    const entry = object(raw);
    if (entry.access !== 'read' && entry.access !== 'write' && entry.access !== 'deny') return null;
    const pathValue = object(entry.path);
    const special = object(pathValue.value);
    const name = text(special.kind);
    let paths = /** @type {string[] | null} */ (null);
    if (pathValue.type === 'path' && typeof pathValue.path === 'string' && isAbsolute(pathValue.path)) paths = [normalize(pathValue.path)];
    if (pathValue.type === 'special') {
      if (name === 'root') paths = ['/'];
      if (name === 'minimal') paths = [':minimal'];
      if (name === 'slash_tmp') paths = ['/tmp'];
      if (name === 'tmpdir') paths = [resolve(env.TMPDIR ?? '/tmp')];
    }
    if (!paths) return null;
    for (const path of paths) rules.push({ path, access: entry.access });
  }
  return rules;
}

/** @param {Record<string, unknown>} raw @param {boolean} snake @returns {NativeUsage} */
function usage(raw, snake) {
  const keys = snake ? ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'] : ['inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'];
  const values = keys.map((key) => typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= 0 ? raw[key] : null);
  return { inputTokens: values[0], cachedInputTokens: values[1], cacheWriteInputTokens: values[2], outputTokens: values[3], reasoningOutputTokens: values[4], totalTokens: values[5] };
}
/** @param {number | null} left @param {number | null} right */
function addKnown(left, right) { return left === null || right === null ? null : left + right; }
/** @param {NativeUsage} left @param {NativeUsage} right @returns {NativeUsage} */
function addUsage(left, right) {
  return {
    inputTokens: addKnown(left.inputTokens, right.inputTokens),
    cachedInputTokens: addKnown(left.cachedInputTokens, right.cachedInputTokens),
    cacheWriteInputTokens: addKnown(left.cacheWriteInputTokens, right.cacheWriteInputTokens),
    outputTokens: addKnown(left.outputTokens, right.outputTokens),
    reasoningOutputTokens: addKnown(left.reasoningOutputTokens, right.reasoningOutputTokens),
    totalTokens: addKnown(left.totalTokens, right.totalTokens),
  };
}
/** @param {NativeUsage | null} left @param {NativeUsage | null} right */
function usageAhead(left, right) {
  if (!left || !right) return false;
  return /** @type {(keyof NativeUsage)[]} */ (['inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'])
    .some((key) => left[key] !== null && right[key] !== null && left[key] > right[key]);
}
/** @param {ReturnType<typeof parseNativeRecords> | null} native @param {NativeUsage | null} notified @returns {NativeUsage} */
function nativeUsage(native, notified) {
  if (!native?.responseUsage) return latestUsage(native?.cumulativeUsage ?? null, notified);
  // 通知可先于原生文件到达, 此时累计通知不含已记录的压缩响应, 无法合成准确总量.
  if (usageAhead(native.cumulativeUsage, native.responseUsage)
    || usageAhead(notified, native.cumulativeUsage ?? native.responseUsage)) return createUsage(null);
  return native.responseUsage;
}
/** @param {NativeUsage | null} recorded @param {NativeUsage | null} notified @returns {NativeUsage} */
function latestUsage(recorded, notified) {
  if (!recorded) return notified ?? createUsage(null);
  if (!notified) return recorded;
  /** @type {NativeUsage} */
  const result = { ...recorded };
  for (const key of /** @type {(keyof NativeUsage)[]} */ (Object.keys(result))) {
    const left = recorded[key];
    const right = notified[key];
    result[key] = left === null ? right : right === null ? left : Math.max(left, right);
  }
  return result;
}
// JSON-RPC 的 source 使用 subAgent, rollout 元数据使用 subagent. 这是两种当前原生表示.
/** @param {unknown} value @param {'subAgent' | 'subagent'} representation @returns {string | null} */
function parentFromSource(value, representation) { return text(object(object(object(value)[representation]).thread_spawn).parent_thread_id); }
/** @param {unknown} value @returns {Record<string, unknown>} */
function object(value) { return isJsonObject(value) ? value : {}; }
/** @param {unknown} value @returns {unknown[]} */
function array(value) { return Array.isArray(value) ? value : []; }
/** @param {unknown} value @returns {string | null} */
function text(value) { return typeof value === 'string' && value.length ? value : null; }
/** @param {unknown} value @returns {string[] | null} */
function strings(value) { return Array.isArray(value) && value.every((part) => typeof part === 'string') ? value : null; }
/** @param {string} value */
function requireText(value) { if (typeof value !== 'string' || !value.trim()) throw new Error('Native instructions must be nonempty text.'); }
