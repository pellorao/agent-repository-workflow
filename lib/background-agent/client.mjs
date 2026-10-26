import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir, readFile, lstat, unlink, writeFile} from 'node:fs/promises';
import {createConnection, createServer} from 'node:net';
import {homedir, userInfo} from 'node:os';
import {join} from 'node:path';
import {StringDecoder} from 'node:string_decoder';
import {createBackgroundAgentStateStore} from './state-store.mjs';
import {backgroundAgentMessageDatabasePaths} from './message-store.mjs';
import {observeBackgroundAgentManagerProcess} from './manager-process.mjs';
import {appServerProcessIdentityPath, readProcessIdentity, readClaudeProcessIdentities} from './process-identity.mjs';
import {securePrivateStatePath,verifyPrivateStatePath} from './private-state.mjs';
import {isClaudeSettings} from './claude-provider.mjs';
import {recoverEndedBackgroundAgent} from './recovery-state.mjs';

/** @param {string} installationDirectory */
export const backgroundAgentRuntimeDirectory = installationDirectory => join(installationDirectory, 'background-agent-state');
// The same OS user uses one port even when ARW is invoked from another repository.
export const backgroundAgentPort = () => 30000 + (createHash('sha256').update(`${userInfo().username}\0${homedir()}`).digest().readUInt32BE(0) % 20000);
export const backgroundAgentMaintenancePort = () => 50000 + (createHash('sha256').update(`maintenance\0${userInfo().username}\0${homedir()}`).digest().readUInt32BE(0) % 10000);

/** @param {string} left @param {string} right */
export const sameCredential = (left, right) => {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
};

/** @param {string} secret @param {'server'|'client'} side @param {string} clientNonce @param {string} serverNonce */
export const controlProof = (secret,side,clientNonce,serverNonce) => createHmac('sha256',Buffer.from(secret,'hex'))
  .update(`${side}\0${clientNonce}\0${serverNonce}`).digest('hex');

// A Codex sandbox denies local sockets (`EPERM`) and makes the home directory read-only (`EROFS`).
/** @param {unknown} error @returns {error is Error & {code:string}} */
const sandboxed = error => error instanceof Error && 'code' in error && ['EPERM','EACCES','EROFS'].includes(String(error.code));
const sandboxBlocked = () => new Error('Background Agent control is blocked by the sandbox. Rerun this same command with escalated permissions outside the sandbox.');

/** @param {string} runtimeDirectory */
async function credential(runtimeDirectory) {
  await verifyPrivateStatePath(runtimeDirectory,'directory');
  const file = join(runtimeDirectory, 'credential');
  await verifyPrivateStatePath(file,'file');
  const secret = (await readFile(file, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Background Agent credential is invalid.');
  return secret;
}

/**
 * @param {{port:number,secret:string,timeoutMs:number,signal?:AbortSignal}} input
 * @returns {Promise<{socket:import('node:net').Socket,auth:string}>}
 */
function connectAuthenticated({port,secret,timeoutMs,signal}) {
  return new Promise((resolve,reject) => {
    const socket = createConnection({host:'127.0.0.1',port});
    const clientNonce = randomBytes(16).toString('hex');
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let done = false;
    const finish = (/** @type {unknown} */ error, /** @type {{socket:import('node:net').Socket,auth:string}|null} */ result) => {
      if (done) return;
      done = true;
      socket.off('data',onData);
      socket.off('end',onEnd);
      socket.off('error',onError);
      clearTimeout(timer);
      signal?.removeEventListener('abort',onAbort);
      if (error) {socket.destroy(); reject(error);}
      else if (result) resolve(result);
      else reject(new Error('Background Agent authentication response is invalid.'));
    };
    const onError = (/** @type {Error} */ error) => finish(error,null);
    const onEnd = () => {buffer += decoder.end(); finish(new Error('Background Agent closed before authentication.'),null);};
    const onTimeout = () => finish(new Error('Background Agent authentication timed out.'),null);
    const onAbort = () => finish(new Error('Background Agent control wait was cancelled.'),null);
    const timer = setTimeout(onTimeout,timeoutMs);
    timer.unref();
    const onData = (/** @type {Buffer} */ chunk) => {
      buffer += decoder.write(chunk);
      if (buffer.length > 4096) {finish(new Error('Background Agent authentication response is invalid.'),null); return;}
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      try {
        if (buffer.slice(end+1).length) throw new Error('Background Agent authentication response is invalid.');
        const response = JSON.parse(buffer.slice(0,end));
        if (!response || typeof response.serverNonce !== 'string' || !/^[a-f0-9]{32}$/.test(response.serverNonce)
          || typeof response.proof !== 'string' || !sameCredential(response.proof,controlProof(secret,'server',clientNonce,response.serverNonce))) {
          throw new Error('Background Agent server authentication failed.');
        }
        finish(null,{socket,auth:controlProof(secret,'client',clientNonce,response.serverNonce)});
      } catch (error) {finish(error,null);}
    };
    socket.on('connect',()=>socket.write(`${JSON.stringify({hello:clientNonce})}\n`));
    socket.on('data',onData);
    socket.on('error',onError);
    socket.on('end',onEnd);
    signal?.addEventListener('abort',onAbort,{once:true});
    if (signal?.aborted) onAbort();
  });
}

/** @param {{port: number, message: Record<string, unknown>, timeoutMs?: number, waitBudgetMs?:number, signal?:AbortSignal}} input */
export const sendBackgroundAgentRequest = async ({port, message, timeoutMs = 5000, waitBudgetMs=0, signal}) => {
  const secret = message.credential;
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) throw new Error('Background Agent credential is invalid.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(waitBudgetMs) || waitBudgetMs<0)
    throw new Error('Background Agent request budget is invalid.');
  const deadline = Date.now() + timeoutMs;
  const connected = await connectAuthenticated({port,secret,timeoutMs,signal});
  if (Date.now()>=deadline) {connected.socket.destroy();throw new Error('Background Agent control timed out before delivery.');}
  const {credential:_credential,...control} = message;
  return new Promise((resolve, reject) => {
    const socket = connected.socket;
    const decoder = new StringDecoder('utf8');
    let text = '';
    let settled = false;
    const finish = (/** @type {unknown} */ error, /** @type {unknown} */ value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort',abort);
      socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(new Error('Background Agent control wait was cancelled.'),null);
    const timer = setTimeout(() => finish(new Error('Background Agent control timed out; acceptance is unknown.'),null),
      Math.max(0,deadline+waitBudgetMs-Date.now()));
    timer.unref();
    socket.on('error', error => finish(error,null));
    socket.on('data', chunk => {
      text += decoder.write(chunk);
      if (text.length > 2_000_000) {finish(new Error('Background Agent response is too large.'),null);return;}
      const end = text.indexOf('\n');
      if (end < 0) return;
      try {
        const wire = JSON.parse(text.slice(0,end));
        if (!wire || wire.id !== message.id || typeof wire.ok !== 'boolean') throw new Error('Background Agent response identity is invalid.');
        finish(null,wire);
      } catch (error) {finish(error,null);}
    });
    socket.on('end', () => {text += decoder.end();finish(new Error('Background Agent closed without a response.'),null);});
    signal?.addEventListener('abort',abort,{once:true});
    if (signal?.aborted) abort();
    else socket.write(`${JSON.stringify({...control,auth:connected.auth})}\n`);
  });
};

/** @param {{runtimeDirectory: string, entryPoint?: string | (() => Promise<void>), ownerId?: string | null, caller?: {repositoryRoot:string|null,programDirectory:string,platform?:string}|null, port?: number, messageTimeoutMs?:number, observeManagerProcess?: typeof observeBackgroundAgentManagerProcess}} input */
export function createBackgroundAgentClient({runtimeDirectory, entryPoint, ownerId = null, caller = null, port = backgroundAgentPort(), messageTimeoutMs = 5000, observeManagerProcess = observeBackgroundAgentManagerProcess}) {
  if (!Number.isSafeInteger(messageTimeoutMs) || messageTimeoutMs < 1) throw new Error('Background Agent request budget is invalid.');
  let closed = false;
  /** @type {Set<() => void>} */
  const activeWaitCancels = new Set();
  const unavailableOrAbsent = async () => {
    let state;
    try {state = await observeManagerProcess({runtimeDirectory});}
    catch {state = 'unknown';}
    if (state === 'absent') return null;
    throw new Error('The background Agent list is temporarily unavailable.');
  };
  /** @param {number} deadline */
  const remaining = deadline => {
    const value=deadline-Date.now();
    if(value<=0)throw new Error('Background Agent control timed out before delivery.');
    return value;
  };
  /** @template T @param {()=>Promise<T>} work @param {number} deadline @param {AbortSignal|undefined} signal @returns {Promise<T>} */
  const beforeDelivery = (work,deadline,signal) => new Promise((resolve,reject)=>{
    let done=false;
    const finish=(/** @type {unknown} */ error,/** @type {T|undefined} */ value)=>{
      if(done)return;
      done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(error)reject(error);else resolve(/** @type {T} */(value));
    };
    const abort=()=>finish(new Error('Background Agent control wait was cancelled.'),undefined);
    const timer=setTimeout(()=>finish(new Error('Background Agent control timed out before delivery.'),undefined),remaining(deadline));
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){abort();return;}
    Promise.resolve().then(work).then(value=>finish(null,value),error=>finish(error,undefined));
  });
  /** @param {string} operation @param {Record<string, unknown>} input */
  const request = async (operation, input, allowLaunch = true, signal = /** @type {AbortSignal|undefined} */ (undefined)) => {
    try {return await deliver(operation,input,allowLaunch,signal);}
    catch (error) {throw sandboxed(error) && 'syscall' in error && error.syscall === 'connect' ? sandboxBlocked() : error;}
  };
  /** @param {string} operation @param {Record<string, unknown>} input @param {boolean} allowLaunch @param {AbortSignal|undefined} signal */
  const deliver = async (operation, input, allowLaunch, signal) => {
    if (closed) throw new Error('Background Agent control client is closed.');
    const deadline=Date.now()+messageTimeoutMs;
    const waitBudget = operation === 'wait_agent' ? input.timeout_ms ?? 30000 : 0;
    if (typeof waitBudget !== 'number' || !Number.isSafeInteger(waitBudget) || waitBudget < 0 || (operation === 'wait_agent' && (waitBudget < 10000 || waitBudget > 3600000))) throw new Error('Background Agent wait budget is invalid.');
    let secret;
    try { secret = await beforeDelivery(()=>credential(runtimeDirectory),deadline,signal); }
    catch (error) {
      if (!allowLaunch || !entryPoint || !(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      await launch(deadline,signal);
      secret = await beforeDelivery(()=>credential(runtimeDirectory),deadline,signal);
    }
    const message = {id: '1', credential: secret, ownerId, caller, operation, input};
    try { return await sendBackgroundAgentRequest({port, message, timeoutMs:remaining(deadline),waitBudgetMs:waitBudget, signal}); }
    catch (error) {
      if (!allowLaunch || !entryPoint || !(error instanceof Error && 'code' in error && error.code === 'ECONNREFUSED')) throw error;
      await launch(deadline,signal);
      return sendBackgroundAgentRequest({port, message, timeoutMs:remaining(deadline),waitBudgetMs:waitBudget, signal});
    }
  };
  /** @param {number} deadline @param {AbortSignal|undefined} signal */
  const launch = async (deadline,signal) => {
    if (typeof entryPoint === 'function') {await beforeDelivery(entryPoint,deadline,signal); return;}
    if (typeof entryPoint !== 'string') throw new Error('Background Agent entry point is unavailable.');
    remaining(deadline);
    // A manager started inside a sandbox could not write its state, so it must start outside.
    try {
      await mkdir(runtimeDirectory,{recursive:true,mode:0o700});
      const probe = join(runtimeDirectory,`.launch-probe-${process.pid}`);
      await writeFile(probe,'');
      await unlink(probe);
    } catch (error) {throw sandboxed(error) ? sandboxBlocked() : error;}
    // The manager outlives this caller; a caller's session identity must not pass to the Agents it starts.
    const {CLAUDECODE:_platform,CLAUDE_CODE_SESSION_ID:_claude,CODEX_THREAD_ID:_codex,...env} = process.env;
    const child = spawn(process.execPath, [entryPoint, '--background-agent-daemon', runtimeDirectory], {detached: true, stdio: 'ignore', windowsHide: true, env});
    child.unref();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await beforeDelivery(()=>new Promise(resolveWait => setTimeout(resolveWait, Math.min(20,remaining(deadline)))),deadline,signal);
      try { const startupSecret=await beforeDelivery(()=>credential(runtimeDirectory),deadline,signal);
        await sendBackgroundAgentRequest({port, message: {id: 'probe', credential: startupSecret, ownerId: null, operation: '__ping', input: {}},
          timeoutMs:Math.min(200,remaining(deadline)),signal}); return; }
      catch (error) { if (!(error instanceof Error && 'code' in error && ['ECONNREFUSED', 'ENOENT'].includes(String(error.code)))) throw error; }
    }
    throw new Error('Background Agent manager did not start.');
  };
  /** @param {{input:Record<string,unknown>,signal?:AbortSignal}} requestInput */
  const wait = async ({input, signal}) => {
    if (closed) throw new Error('Background Agent control client is closed.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort',abort,{once:true});
    activeWaitCancels.add(abort);
    try {
      if (signal?.aborted) controller.abort();
      if (controller.signal.aborted) return {status:'succeeded',result:{cancelled:true}};
      const wire = /** @type {{ok?:boolean,result?:unknown,error?:{code:string,message:string}}} */ (await request('wait_agent',input,true,controller.signal));
      return wire.ok ? wire.result : {status:'failed',error:wire.error ?? {code:'background-agent-control-failed',message:'Background Agent wait failed.'}};
    } catch (error) {
      if (controller.signal.aborted) return {status:'succeeded',result:{cancelled:true}};
      throw error;
    } finally {
      activeWaitCancels.delete(abort);
      signal?.removeEventListener('abort',abort);
    }
  };
  return {
    /** @param {{operation: string, input: Record<string, unknown>}} value */
    execute: async value => {
      const wire = /** @type {{ok?:boolean,result?:unknown,error?:{code:string,message:string}}} */ (await request(value.operation, value.input));
      return wire.ok ? wire.result : {status: 'failed', error: wire.error ?? {code: 'background-agent-control-failed', message: 'Background Agent control failed.'}};
    },
    list: async () => {
      try {await lstat(runtimeDirectory);}
      catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return unavailableOrAbsent();
        throw error;
      }
      await verifyPrivateStatePath(runtimeDirectory,'directory');
      // Maintenance can create this private directory before any manager has run.
      // Both files absent is an empty installation.
      const presence = await Promise.all([join(runtimeDirectory,'credential'), backgroundAgentMessageDatabasePaths(runtimeDirectory).database].map(async path => {
        try {await lstat(path); return true;}
        catch (error) {if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false; throw error;}
      }));
      if (!presence[0] && !presence[1]) return unavailableOrAbsent();
      if (!presence[0]) throw new Error('Background Agent state is incomplete.');
      let wire;
      try {wire = /** @type {{ok?:boolean,result?:unknown,error?:{code:string,message:string}}} */ (await request('__list', {}, false));}
      catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ECONNREFUSED') return unavailableOrAbsent();
        throw error;
      }
      if (!wire.ok) throw new Error(wire.error?.message ?? 'Background Agent list failed.');
      return wire.result;
    },
    wait,
    close: async () => {closed = true; for (const cancel of [...activeWaitCancels]) cancel(); return {status: /** @type {const} */ ('succeeded'), result: {closed: true}};},
  };
}

/** The startup lease is held before loading a daemon and released after its control listener is live. */
/** @param {{runtimeDirectory:string,maintenancePort?:number}} input */
export async function acquireBackgroundAgentStartupLease({runtimeDirectory,maintenancePort=backgroundAgentMaintenancePort()}) {
  if (typeof runtimeDirectory!=='string'||!runtimeDirectory) throw new Error('Background Agent runtime directory is missing.');
  const server=createServer(socket=>socket.destroy());
  await new Promise((resolveListen,rejectListen)=>{
    server.once('error',rejectListen);
    server.listen({host:'127.0.0.1',port:maintenancePort,exclusive:true},()=>{server.off('error',rejectListen);resolveListen(undefined);});
  });
  const address=server.address();
  let released=false;
  return {port:typeof address==='object'&&address?address.port:maintenancePort,unref:()=>server.unref(),release:async()=>{
    if(released)return;
    released=true;
    await new Promise(resolveClose=>server.close(()=>resolveClose(undefined)));
  }};
}

/** The controller keeps this OS lease until its process exits. */
const maintenanceListeners=new Set();

/**
 * @param {{runtimeDirectory: string, stopBackgroundAgents?: boolean, allowIdleEviction?:boolean, port?: number, maintenancePort?:number, observeProcessExit?:(pid:number)=>Promise<boolean>,observeManagerProcess?:typeof observeBackgroundAgentManagerProcess}} input
 * @returns {Promise<{status:'acquired',stoppedAgents:string[]}|{status:'busy'|'unknown',reason:string,stoppedAgents:string[]}>}
 */
export async function acquireBackgroundAgentMaintenance({runtimeDirectory,stopBackgroundAgents=false,allowIdleEviction=true,port=backgroundAgentPort(),maintenancePort=backgroundAgentMaintenancePort(),observeManagerProcess=observeBackgroundAgentManagerProcess,observeProcessExit=async pid=>{
  try {process.kill(pid,0);return false;}
  catch(error){if(error instanceof Error&&'code'in error&&error.code==='ESRCH')return true;throw error;}
}}) {
  /** @type {string[]} */
  let stoppedAgents=[];
  /** @type {Awaited<ReturnType<typeof acquireBackgroundAgentStartupLease>>|null} */
  let lease=null;
  try {
    try {lease=await acquireBackgroundAgentStartupLease({runtimeDirectory,maintenancePort});}
    catch(error){if(error instanceof Error&&'code'in error&&error.code==='EADDRINUSE')return {status:'busy',reason:'Background Agent maintenance or startup is active.',stoppedAgents};throw error;}
    await mkdir(runtimeDirectory,{recursive:true,mode:0o700});
    await securePrivateStatePath(runtimeDirectory,'directory');
    let managerPid=/** @type {number|null} */ (null);
    let secret=/** @type {string|null} */ (null);
    try {secret=await credential(runtimeDirectory);}
    catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}
    if(!secret){
      const statePresent=await Promise.all(Object.values(backgroundAgentMessageDatabasePaths(runtimeDirectory)).map(async path=>{
        try {await lstat(path);return true;}
        catch(error){if(error instanceof Error&&'code'in error&&error.code==='ENOENT')return false;throw error;}
      }));
      if(statePresent.some(Boolean))throw new Error('Background Agent credential is missing for existing state.');
    } else {
      try {
        const wire=/** @type {{ok?:boolean,result?:{status?:string,stoppedAgents?:string[],reason?:string,managerPid?:number},error?:{message?:string}}} */ (await sendBackgroundAgentRequest({port,message:{id:'maintenance',credential:secret,ownerId:null,operation:'__maintenance',input:{stopBackgroundAgents,allowIdleEviction}},timeoutMs:30_000}));
        if(!wire.ok||!wire.result||!['ready','busy','unknown'].includes(String(wire.result.status)))throw new Error(wire.error?.message??'Background Agent maintenance response is invalid.');
        stoppedAgents=Array.isArray(wire.result.stoppedAgents)?wire.result.stoppedAgents:[];
        if(wire.result.status!=='ready') {await lease.release();return {status:wire.result.status==='busy'?'busy':'unknown',reason:wire.result.reason??'Background Agent work is busy or unknown.',stoppedAgents};}
        if(!Number.isSafeInteger(wire.result.managerPid)||Number(wire.result.managerPid)<1)throw new Error('Background Agent manager process identity is missing.');
        managerPid=Number(wire.result.managerPid);
      } catch(error) {
        if(!(error instanceof Error&&'code'in error&&error.code==='ECONNREFUSED'))throw error;
      }
    }
    if(managerPid!==null){
      let exited=false;
      for(let attempt=0;attempt<100;attempt+=1){
        if(await observeProcessExit(managerPid)){exited=true;break;}
        await new Promise(resolveWait=>setTimeout(resolveWait,20));
      }
      if(!exited)throw new Error('Background Agent manager process exit is unverified.');
    }
    if(managerPid===null&&secret&&(await observeManagerProcess({runtimeDirectory}))!=='absent')
      throw new Error('Background Agent manager absence could not be confirmed.');
    const identity=await readProcessIdentity({runtimeDirectory,path:appServerProcessIdentityPath(runtimeDirectory)});
    if(identity.state==='alive'||identity.state==='unknown')throw new Error('Shared App Server process exit is unknown.');
    const claudeProcesses=await readClaudeProcessIdentities({runtimeDirectory});
    if(claudeProcesses.some(({observation})=>observation.state!=='ended'))throw new Error('Claude Agent process exit is unknown.');
    if(secret){
      const store=createBackgroundAgentStateStore({runtimeDirectory});
      try {
        const agents=await store.loadAgents();
        if(managerPid===null&&store.listProviders().some(provider=>provider.leaseKey!==null))
          throw new Error('Offline Background Agent maintenance is blocked by an unreleased provider lease.');
        if(agents.length){
          // Claude runs have no shared process; their recorded turn processes were confirmed ended above.
          if(managerPid!==null||(identity.state!=='ended'&&agents.some(agent=>!isClaudeSettings(agent.settings))))throw new Error('Background Agent process exit is unknown.');
          for(const agent of agents)store.upsertAgent(recoverEndedBackgroundAgent(agent,store.latestMessageSequence(agent.runId)));
          await store.flush();
        }
      }
      finally {await store.close();}
    }
    // This lease is intentionally not released by the installer module.
    lease.unref();
    maintenanceListeners.add(lease);
    return {status:'acquired',stoppedAgents:stoppedAgents.sort()};
  } catch(error) {
    await lease?.release();
    return {status:'unknown',reason:error instanceof Error?error.message:'Background Agent maintenance failed.',stoppedAgents:stoppedAgents.sort()};
  }
}
