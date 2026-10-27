import {mkdir, open, lstat} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {securePrivateStatePath, verifyPrivateStatePath} from './private-state.mjs';
import {backgroundAgentMessageDatabasePaths, createBackgroundAgentMessageStatements} from './message-store.mjs';

/** @typedef {import('./message-store.mjs').StoredMessage} StoredMessage */
/** @typedef {import('./message-store.mjs').MessageDirection} MessageDirection */
/** @typedef {import('./message-store.mjs').DeliveryStatus} DeliveryStatus */
/** @typedef {'starting'|'running'|'idle'|'stopping'|'exited'|'unknown'} AgentState */
/** @typedef {'not-started'|'working'|'ended'|'unknown'} TaskState */
/** @typedef {{runId:string,ownerId:string,role:string,ownerTitle:string|null,ownerSessionPath:string|null,threadId:string|null,turnId:string|null,sessionPath:string|null,settings:Record<string,unknown>,cwd:string,readPaths:string[],writePaths:string[],instructions:string,recoveryPath:string|null,state:AgentState,taskState:TaskState,stateVersion:number,lastUsedAtMs:number,taskStartedAtMs:number|null,taskFinishedAtMs:number|null,knownThreadIds:string[],providerWork?:Record<string,unknown>|null}} BackgroundAgentRow */
/** @typedef {{providerId:string,controllerUrl:string,leaseKey:string}} ProviderLease */
/** @typedef {{providerId:string,controllerUrl:string|null,leaseKey:string|null,lastError:string|null}} ProviderState */
/** @typedef {{providerId:string,controllerUrl:string|null,lastError:string|null}} ProviderErrorUpdate */

const retentionMs = 24 * 60 * 60 * 1000;
const systemClock = {now: Date.now, setTimeout, clearTimeout};
const isMissing = /** @param {unknown} error */ error => error instanceof Error && 'code' in error && error.code === 'ENOENT';
/** @param {unknown} value */
const reason = value => value instanceof Error ? value.message : String(value);

export class BackgroundAgentPersistenceUnavailableError extends Error {
  /** @param {unknown} cause */
  constructor(cause) {
    super(`Background Agent persistence is unavailable: ${reason(cause)}`, {cause});
    this.code = 'background-agent-persistence-unavailable';
  }
}

/** @param {Record<string,unknown>} value */
function agentFromDatabase(value) {
  /** @type {BackgroundAgentRow} */
  const row = {
    runId:String(value.run_id), ownerId:String(value.owner_id), role:String(value.role),
    ownerTitle:/** @type {string|null} */ (value.owner_title), ownerSessionPath:/** @type {string|null} */ (value.owner_session_path),
    threadId:/** @type {string|null} */ (value.thread_id), turnId:/** @type {string|null} */ (value.turn_id),
    sessionPath:/** @type {string|null} */ (value.session_path),
    settings:/** @type {Record<string,unknown>} */ (JSON.parse(String(value.settings_json))), cwd:String(value.cwd),
    readPaths:/** @type {string[]} */ (JSON.parse(String(value.read_paths_json))),
    writePaths:/** @type {string[]} */ (JSON.parse(String(value.write_paths_json))),
    instructions:String(value.instructions), recoveryPath:/** @type {string|null} */ (value.recovery_path),
    state:/** @type {AgentState} */ (value.state), taskState:/** @type {TaskState} */ (value.task_state),
    stateVersion:Number(value.state_version), lastUsedAtMs:Number(value.last_used_at_ms),
    taskStartedAtMs:/** @type {number|null} */ (value.task_started_at_ms),
    taskFinishedAtMs:/** @type {number|null} */ (value.task_finished_at_ms),
    knownThreadIds:/** @type {string[]} */ (JSON.parse(String(value.known_thread_ids_json))),
    providerWork:value.provider_work_json==null?null:JSON.parse(String(value.provider_work_json)),
  };
  if (!row.runId || !row.ownerId || !row.role || !row.cwd || !row.settings || typeof row.settings!=='object'
    || Array.isArray(row.settings) || row.providerWork!=null&&(typeof row.providerWork!=='object'||Array.isArray(row.providerWork))
    || !Array.isArray(row.readPaths) || !row.readPaths.every(value=>typeof value==='string')
    || !Array.isArray(row.writePaths) || !row.writePaths.every(value=>typeof value==='string')
    || !Array.isArray(row.knownThreadIds) || !row.knownThreadIds.every(value=>typeof value==='string')
    || !Number.isSafeInteger(row.stateVersion) || row.stateVersion < 0
    || !Number.isSafeInteger(row.lastUsedAtMs)
    || !['starting','running','idle','stopping','exited','unknown'].includes(row.state)
    || !['not-started','working','ended','unknown'].includes(row.taskState)) throw new Error('Background Agent database has an invalid Agent row.');
  return row;
}

/** @param {Record<string,unknown>} value */
function messageFromDatabase(value) {
  /** @type {StoredMessage} */
  const row = {
    messageId:String(value.message_id), runId:String(value.run_id), sequence:Number(value.sequence),
    direction:/** @type {MessageDirection} */ (value.direction), body:String(value.body),
    source:/** @type {import('./message-store.mjs').MessageSource} */(value.source ?? (value.direction==='agent-to-main'?'agent':'main')),
    deliveryStatus:/** @type {DeliveryStatus} */ (value.delivery_status), acceptedAtMs:Number(value.accepted_at_ms),
    deliveredAtMs:/** @type {number|null} */ (value.delivered_at_ms),
    threadId:/** @type {string|null} */ (value.thread_id), turnId:/** @type {string|null} */ (value.turn_id),
    persistenceStatus:'persisted',
  };
  if (typeof value.message_id!=='string' || typeof value.run_id!=='string' || typeof value.body!=='string'
    || !row.messageId || !row.runId || !Number.isSafeInteger(row.sequence) || row.sequence < 1
    || !['main-to-agent','agent-to-main'].includes(row.direction)
    || !['main','agent','provider-program'].includes(String(row.source))
    || !['accepted','delivered','failed','unknown'].includes(row.deliveryStatus)
    || !Number.isSafeInteger(row.acceptedAtMs)) throw new Error('Background Agent database has an invalid message row.');
  return row;
}

/** @param {Record<string,unknown>} value @returns {ProviderState} */
function providerFromDatabase(value) {
  const row={providerId:value.provider_id,controllerUrl:value.controller_url,
    leaseKey:value.lease_key,lastError:value.last_error};
  if (typeof row.providerId!=='string' || !row.providerId
    || (row.controllerUrl!==null && typeof row.controllerUrl!=='string')
    || (row.leaseKey!==null && typeof row.leaseKey!=='string')
    || (row.lastError!==null && typeof row.lastError!=='string')
    || (row.leaseKey!==null && (!row.leaseKey || !row.controllerUrl)))
    throw new Error('Background Agent database has an invalid provider row.');
  return /** @type {ProviderState} */ (row);
}

/**
 * The sole SQLite connection for Agent, message and provider facts. Agent and
 * message and provider-error changes are batched; provider leases commit immediately.
 * @param {{runtimeDirectory:string,clock?:typeof systemClock,persistenceIntervalMs?:number,openDatabase?:(path:string)=>DatabaseSync}} input
 */
export function createBackgroundAgentStateStore({runtimeDirectory,clock=systemClock,persistenceIntervalMs=1000,openDatabase=path=>new DatabaseSync(path)}) {
  if (!Number.isSafeInteger(persistenceIntervalMs) || persistenceIntervalMs < 1) throw new Error('Persistence interval must be a positive safe integer.');
  /** @type {DatabaseSync|null} */ let database = null;
  /** @type {ReturnType<typeof createBackgroundAgentMessageStatements>|null} */ let messageStatements = null;
  /** @type {ReturnType<DatabaseSync['prepare']>|null} */ let upsertAgentStatement = null;
  /** @type {ReturnType<DatabaseSync['prepare']>|null} */ let getAgentStatement = null;
  /** @type {ReturnType<DatabaseSync['prepare']>|null} */ let activeAgentsStatement = null;
  /** @type {ReturnType<DatabaseSync['prepare']>|null} */ let upsertProviderErrorStatement = null;
  /** @type {Map<string,{row:BackgroundAgentRow,revision:number}>} */ const dirtyAgents = new Map();
  /** @type {Map<string,{row:StoredMessage,revision:number}>} */ const dirtyMessages = new Map();
  /** @type {Map<string,{row:ProviderErrorUpdate,revision:number}>} */ const dirtyProviders = new Map();
  /** @type {Set<string>} */ const knownAgents = new Set();
  /** @type {Map<string,number>} */ const sequenceHeads = new Map();
  /** @type {Set<()=>void>} */ const persistenceListeners = new Set();
  let expirationPending = false;
  /** @type {ReturnType<typeof setTimeout>|null} */ let timer = null;
  /** @type {Error|null} */ let lastError = null;
  let revision = 0;
  let initialized = false;
  let closed = false;
  let nextSavedExpiryMs = Infinity;
  let retryNotBeforeMs = 0;
  let batchDueAtMs = Infinity;

  const requireOpen = () => {
    if (!initialized || !database || !messageStatements || !upsertAgentStatement || !getAgentStatement
      || !activeAgentsStatement || !upsertProviderErrorStatement || closed)
      throw new Error('Background Agent database is not open.');
    return {database,messageStatements,upsertAgentStatement,getAgentStatement,activeAgentsStatement,upsertProviderErrorStatement};
  };
  const cutoff = () => clock.now() - retentionMs;
  /** @param {StoredMessage} row */
  const retained = row => row.deliveredAtMs === null || row.deliveredAtMs > cutoff();
  const collectExpired = () => {
    if (!initialized || closed) return;
    const {messageStatements} = requireOpen();
    expirationPending = messageStatements.expired.get(cutoff())!==undefined
      || [...dirtyMessages.values()].some(({row})=>!retained(row));
    if (expirationPending) batchDueAtMs=Math.min(batchDueAtMs,clock.now());
  };
  const markDirty = () => {batchDueAtMs=Math.min(batchDueAtMs,clock.now()+persistenceIntervalMs);schedule();};
  const schedule = () => {
    if (timer !== null) {clock.clearTimeout(timer);timer=null;}
    if (!initialized || closed) return;
    const dirty = dirtyAgents.size > 0 || dirtyMessages.size > 0 || dirtyProviders.size > 0 || expirationPending;
    let delay = dirty ? Math.max(0,batchDueAtMs-clock.now()) : Infinity;
    if (Number.isFinite(nextSavedExpiryMs)) delay = Math.min(delay,Math.max(0,nextSavedExpiryMs-clock.now()));
    for (const {row} of dirtyMessages.values()) if (row.deliveredAtMs !== null)
      delay = Math.min(delay,Math.max(0,row.deliveredAtMs + retentionMs - clock.now()));
    if (lastError !== null) delay = Math.max(delay,Math.max(1,retryNotBeforeMs-clock.now()));
    if (!Number.isFinite(delay)) return;
    timer = clock.setTimeout(() => {timer=null;void flush().catch(() => {});},delay);
    timer?.unref?.();
  };
  const initialize = async () => {
    if (initialized) return;
    await mkdir(runtimeDirectory,{recursive:true,mode:0o700});
    await securePrivateStatePath(runtimeDirectory,'directory');
    const paths = backgroundAgentMessageDatabasePaths(runtimeDirectory);
    for (const path of Object.values(paths)) {
      try {await lstat(path);await verifyPrivateStatePath(path,'file');}
      catch (error) {if (!isMissing(error)) throw error;}
    }
    try {const handle = await open(paths.database,'wx',0o600);await handle.close();}
    catch (error) {if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;}
    await securePrivateStatePath(paths.database,'file');
    const candidate = openDatabase(paths.database);
    try {
      candidate.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS agents (
          run_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, role TEXT NOT NULL,
          owner_title TEXT, owner_session_path TEXT, thread_id TEXT, turn_id TEXT, session_path TEXT,
          settings_json TEXT NOT NULL, cwd TEXT NOT NULL, read_paths_json TEXT NOT NULL,
          write_paths_json TEXT NOT NULL, instructions TEXT NOT NULL, recovery_path TEXT,
          state TEXT NOT NULL CHECK (state IN ('starting','running','idle','stopping','exited','unknown')),
          task_state TEXT NOT NULL CHECK (task_state IN ('not-started','working','ended','unknown')),
          state_version INTEGER NOT NULL CHECK (state_version>=0), last_used_at_ms INTEGER NOT NULL,
          task_started_at_ms INTEGER, task_finished_at_ms INTEGER, known_thread_ids_json TEXT NOT NULL, provider_work_json TEXT
        );
        CREATE INDEX IF NOT EXISTS agents_state_last_used ON agents(state,last_used_at_ms);
        CREATE TABLE IF NOT EXISTS providers (
          provider_id TEXT PRIMARY KEY, controller_url TEXT, lease_key TEXT, last_error TEXT,
          CHECK (lease_key IS NULL OR (lease_key != '' AND controller_url IS NOT NULL))
        );`);
      if(!candidate.prepare('PRAGMA table_info(agents)').all().some(column=>column.name==='provider_work_json'))
        candidate.exec('ALTER TABLE agents ADD COLUMN provider_work_json TEXT');
      const messages = createBackgroundAgentMessageStatements(candidate);
      database = candidate;
      messageStatements = messages;
      upsertAgentStatement = candidate.prepare(`INSERT INTO agents
        (run_id,owner_id,role,owner_title,owner_session_path,thread_id,turn_id,session_path,settings_json,cwd,
         read_paths_json,write_paths_json,instructions,recovery_path,state,task_state,state_version,
         last_used_at_ms,task_started_at_ms,task_finished_at_ms,known_thread_ids_json,provider_work_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(run_id) DO UPDATE SET owner_id=excluded.owner_id,role=excluded.role,
          owner_title=excluded.owner_title,owner_session_path=excluded.owner_session_path,
          thread_id=excluded.thread_id,turn_id=excluded.turn_id,session_path=excluded.session_path,
          settings_json=excluded.settings_json,cwd=excluded.cwd,read_paths_json=excluded.read_paths_json,
          write_paths_json=excluded.write_paths_json,instructions=excluded.instructions,recovery_path=excluded.recovery_path,
          state=excluded.state,task_state=excluded.task_state,state_version=excluded.state_version,
          last_used_at_ms=excluded.last_used_at_ms,task_started_at_ms=excluded.task_started_at_ms,
          task_finished_at_ms=excluded.task_finished_at_ms,known_thread_ids_json=excluded.known_thread_ids_json,
          provider_work_json=excluded.provider_work_json`);
      getAgentStatement = candidate.prepare('SELECT * FROM agents WHERE run_id=?');
      activeAgentsStatement = candidate.prepare("SELECT * FROM agents WHERE state!='exited'");
      upsertProviderErrorStatement = candidate.prepare(`INSERT INTO providers
        (provider_id,controller_url,lease_key,last_error) VALUES (?,?,NULL,?)
        ON CONFLICT(provider_id) DO UPDATE SET
          controller_url=COALESCE(providers.controller_url,excluded.controller_url),
          last_error=excluded.last_error`);
      const next = /** @type {Record<string,unknown>} */ (messages.nextExpiry.get(cutoff()) ?? {});
      nextSavedExpiryMs = typeof next.time === 'number' ? next.time + retentionMs : Infinity;
      for (const raw of activeAgentsStatement.all()) {
        const agent = agentFromDatabase(/** @type {Record<string,unknown>} */ (raw));
        knownAgents.add(agent.runId);
        const head = /** @type {Record<string,unknown>} */ (messages.latestSequence.get(agent.runId)??{});
        sequenceHeads.set(agent.runId,typeof head.sequence==='number'?head.sequence:0);
      }
      initialized = true;
      collectExpired();
      schedule();
    } catch (error) {
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
      initialized = false;
      database = null;
      messageStatements = null;
      upsertAgentStatement = null;
      getAgentStatement = null;
      activeAgentsStatement = null;
      upsertProviderErrorStatement = null;
      knownAgents.clear();
      sequenceHeads.clear();
      try {candidate.close();} catch {}
      throw error;
    }
  };
  /** @param {BackgroundAgentRow} row */
  const upsertAgent = row => {
    requireOpen();
    const copy = /** @type {BackgroundAgentRow} */ (structuredClone(row));
    dirtyAgents.set(copy.runId,{row:copy,revision:++revision});
    knownAgents.add(copy.runId);
    if (!sequenceHeads.has(copy.runId)) sequenceHeads.set(copy.runId,0);
    markDirty();
  };
  /** @returns {Promise<void>} */
  const flush = async () => {
    const {database,messageStatements,upsertAgentStatement,upsertProviderErrorStatement} = requireOpen();
    collectExpired();
    if (!dirtyAgents.size && !dirtyMessages.size && !dirtyProviders.size && !expirationPending) {batchDueAtMs=Infinity;schedule();return;}
    const agents = [...dirtyAgents.values()];
    const messages = [...dirtyMessages.values()];
    const providers = [...dirtyProviders.values()];
    const deleteExpired = expirationPending;
    const expiryCutoff = cutoff();
    try {
      database.exec('BEGIN IMMEDIATE');
      for (const {row} of agents) upsertAgentStatement.run(row.runId,row.ownerId,row.role,row.ownerTitle,row.ownerSessionPath,
        row.threadId,row.turnId,row.sessionPath,JSON.stringify(row.settings),row.cwd,JSON.stringify(row.readPaths),
        JSON.stringify(row.writePaths),row.instructions,row.recoveryPath,row.state,row.taskState,row.stateVersion,
        row.lastUsedAtMs,row.taskStartedAtMs,row.taskFinishedAtMs,JSON.stringify(row.knownThreadIds),row.providerWork==null?null:JSON.stringify(row.providerWork));
      for (const {row} of messages) messageStatements.upsert.run(row.messageId,row.runId,row.sequence,row.direction,row.body,
        row.deliveryStatus,row.acceptedAtMs,row.deliveredAtMs,row.threadId,row.turnId,row.source??(row.direction==='agent-to-main'?'agent':'main'));
      for (const {row} of providers) upsertProviderErrorStatement.run(row.providerId,row.controllerUrl,row.lastError);
      if (deleteExpired) messageStatements.deleteExpired.run(expiryCutoff);
      database.exec('COMMIT');
    } catch (error) {
      try {database.exec('ROLLBACK');} catch {}
      lastError = error instanceof Error ? error : new Error(String(error));
      retryNotBeforeMs=clock.now()+persistenceIntervalMs;
      batchDueAtMs=retryNotBeforeMs;
      schedule();
      throw lastError;
    }
    for (const {row,revision:version} of agents) {
      if (dirtyAgents.get(row.runId)?.revision === version) {
        dirtyAgents.delete(row.runId);
        if (row.state==='exited') {knownAgents.delete(row.runId);sequenceHeads.delete(row.runId);}
      }
    }
    for (const {row,revision:version} of messages) {
      if (dirtyMessages.get(row.messageId)?.revision === version) dirtyMessages.delete(row.messageId);
    }
    for (const {row,revision:version} of providers) {
      if (dirtyProviders.get(row.providerId)?.revision === version) dirtyProviders.delete(row.providerId);
    }
    expirationPending=false;
    collectExpired();
    if (!dirtyAgents.size && !dirtyMessages.size && !dirtyProviders.size && !expirationPending) lastError=null;
    retryNotBeforeMs=0;
    batchDueAtMs=dirtyAgents.size||dirtyMessages.size||dirtyProviders.size||expirationPending
      ?clock.now()+persistenceIntervalMs:Infinity;
    try {
      const next = /** @type {Record<string,unknown>} */ (messageStatements.nextExpiry.get(cutoff()) ?? {});
      nextSavedExpiryMs = typeof next.time === 'number' ? next.time + retentionMs : Infinity;
    } catch {nextSavedExpiryMs=clock.now()+persistenceIntervalMs;}
    schedule();
    for (const listener of persistenceListeners) {
      try {listener();} catch {}
    }
  };
  /** @param {string} messageId */
  const getMessage = messageId => {
    const pending = dirtyMessages.get(messageId)?.row;
    if (pending) return {...pending};
    const {messageStatements} = requireOpen();
    const value = messageStatements.get.get(messageId);
    return value ? messageFromDatabase(/** @type {Record<string,unknown>} */ (value)) : null;
  };
  /** @param {{runId:string,direction:MessageDirection,sequence:number}} input */
  const messagesAfter = ({runId,direction,sequence}) => {
    const {messageStatements} = requireOpen();
    const found = new Map();
    for (const raw of messageStatements.after.all(runId,direction,sequence,cutoff())) {
      const row = messageFromDatabase(/** @type {Record<string,unknown>} */ (raw));
      found.set(row.messageId,row);
    }
    for (const {row} of dirtyMessages.values()) if (row.runId===runId && row.direction===direction && row.sequence>sequence) {
      if (retained(row)) found.set(row.messageId,{...row}); else found.delete(row.messageId);
    }
    return [...found.values()].sort((a,b)=>a.sequence-b.sequence);
  };
  const assertCanAccept = () => {if(lastError!==null)throw new BackgroundAgentPersistenceUnavailableError(lastError);};
  /** @param {unknown} failure */
  const recordPersistenceFailure = failure => {
    lastError=failure instanceof Error?failure:new Error(String(failure));
    retryNotBeforeMs=clock.now()+persistenceIntervalMs;
    batchDueAtMs=retryNotBeforeMs;
    schedule();
  };
  /** @param {string} runId */
  const latestMessageSequence = runId => {requireOpen();return sequenceHeads.get(runId)??0;};
  /** @param {ProviderState|null} saved @param {ProviderErrorUpdate} pending @returns {ProviderState} */
  const mergeProvider = (saved,pending) => ({providerId:pending.providerId,
    controllerUrl:saved?.controllerUrl??pending.controllerUrl,leaseKey:saved?.leaseKey??null,
    lastError:pending.lastError});
  /** @param {string} providerId @returns {ProviderState|null} */
  const getProvider = providerId => {
    const {database} = requireOpen();
    const raw=database.prepare('SELECT * FROM providers WHERE provider_id=?').get(providerId);
    const saved=raw?providerFromDatabase(/** @type {Record<string,unknown>} */ (raw)):null;
    const pending=dirtyProviders.get(providerId)?.row;
    return pending?mergeProvider(saved,pending):saved;
  };
  return {
    runtimeDirectory,
    get lastError() {return lastError;},
    get recoveryIncomplete() {return lastError!==null || dirtyAgents.size>0 || dirtyMessages.size>0
      || dirtyProviders.size>0 || expirationPending;},
    /** @returns {ProviderState[]} */
    listProviders() {
      const {database} = requireOpen();
      const rows=new Map(database.prepare('SELECT * FROM providers').all().map(raw=>{
        const row=providerFromDatabase(/** @type {Record<string,unknown>} */ (raw));
        return [row.providerId,row];
      }));
      for(const {row} of dirtyProviders.values())rows.set(row.providerId,mergeProvider(rows.get(row.providerId)??null,row));
      return [...rows.values()].sort((left,right)=>left.providerId.localeCompare(right.providerId));
    },
    getProvider,
    /** @param {{providerId:string,controllerUrl?:string|null,lastError:string|null}} input */
    updateProviderError({providerId,controllerUrl=null,lastError}) {
      requireOpen();
      const current=getProvider(providerId);
      const row={providerId,controllerUrl:current?.controllerUrl??controllerUrl,lastError};
      dirtyProviders.set(providerId,{row,revision:++revision});
      markDirty();
    },
    /** @param {ProviderLease} lease */
    saveProvider(lease) {
      const {database} = requireOpen();
      let differentLease=false;
      try {
        database.exec('BEGIN IMMEDIATE');
        const existing=database.prepare('SELECT lease_key FROM providers WHERE provider_id=?').get(lease.providerId);
        if(existing){
          if(existing.lease_key!==null && existing.lease_key!==lease.leaseKey){
            differentLease=true;
            throw new Error('Provider already holds a different lease.');
          }
          if(existing.lease_key===null)
            database.prepare('UPDATE providers SET controller_url=?,lease_key=? WHERE provider_id=?')
              .run(lease.controllerUrl,lease.leaseKey,lease.providerId);
        } else {
          database.prepare('INSERT INTO providers (provider_id,controller_url,lease_key) VALUES (?,?,?)')
            .run(lease.providerId,lease.controllerUrl,lease.leaseKey);
        }
        database.exec('COMMIT');
      } catch(error) {
        try {database.exec('ROLLBACK');} catch {}
        if(!differentLease)recordPersistenceFailure(error);
        throw error;
      }
    },
    /** @param {string} providerId */
    deleteProvider(providerId) {
      const {database} = requireOpen();
      try {
        database.exec('BEGIN IMMEDIATE');
        database.prepare('DELETE FROM providers WHERE provider_id=?').run(providerId);
        database.exec('COMMIT');
      } catch(error) {
        try {database.exec('ROLLBACK');} catch {}
        recordPersistenceFailure(error);
        throw error;
      }
      dirtyProviders.delete(providerId);
      if(!dirtyAgents.size && !dirtyMessages.size && !dirtyProviders.size && !expirationPending){
        lastError=null;
        retryNotBeforeMs=0;
        batchDueAtMs=Infinity;
      }
      schedule();
    },
    async loadAgents() {
      await initialize();
      const {activeAgentsStatement} = requireOpen();
      return activeAgentsStatement.all().map(raw=>agentFromDatabase(/** @type {Record<string,unknown>} */ (raw)));
    },
    /** @param {string} runId */
    getAgent(runId) {
      const pending=dirtyAgents.get(runId)?.row;
      if (pending) return structuredClone(pending);
      const {getAgentStatement}=requireOpen();
      const value=getAgentStatement.get(runId);
      if (!value) return null;
      const row=agentFromDatabase(/** @type {Record<string,unknown>} */ (value));
      knownAgents.add(runId);
      if (!sequenceHeads.has(runId)) {
        const {messageStatements}=requireOpen();
        const head=/** @type {Record<string,unknown>} */ (messageStatements.latestSequence.get(runId)??{});
        sequenceHeads.set(runId,typeof head.sequence==='number'?head.sequence:0);
      }
      return row;
    },
    /** @param {string} runId */
    isAgentPersisted(runId) {requireOpen();return !dirtyAgents.has(runId);},
    /** @param {string} runId */
    releaseAgent(runId) {
      requireOpen();
      if (dirtyAgents.has(runId) || [...dirtyMessages.values()].some(({row})=>row.runId===runId)) return false;
      knownAgents.delete(runId);
      sequenceHeads.delete(runId);
      return true;
    },
    /** @param {()=>void} listener */
    onPersisted(listener) {
      persistenceListeners.add(listener);
      return () => {persistenceListeners.delete(listener);};
    },
    upsertAgent,
    /** @param {string} runId */
    latestMessageSequence,
    assertCanAccept,
    /** @param {{messageId:string,runId:string,sequence:number,direction:MessageDirection,body:string,threadId?:string|null,turnId?:string|null,source?:import('./message-store.mjs').MessageSource}} input */
    acceptMessage({messageId,runId,sequence,direction,body,threadId=null,turnId=null,source=direction==='agent-to-main'?'agent':'main'}) {
      requireOpen();
      if (sequence<=latestMessageSequence(runId)) throw new Error('Background Agent message is invalid.');
      assertCanAccept();
      if (!knownAgents.has(runId)) throw new Error('Background Agent message has no Agent.');
      /** @type {StoredMessage} */
      const row={messageId,runId,sequence,direction,body,source,deliveryStatus:'accepted',acceptedAtMs:clock.now(),
        deliveredAtMs:null,threadId,turnId,persistenceStatus:'nonpersisted'};
      dirtyMessages.set(messageId,{row,revision:++revision});
      sequenceHeads.set(runId,sequence);
      markDirty();
      return {...row};
    },
    /** @param {string} messageId @param {{deliveryStatus:DeliveryStatus,threadId?:string|null,turnId?:string|null}} patch */
    updateMessage(messageId,patch) {
      const previous=getMessage(messageId);
      if(!previous)throw new Error('Background Agent message identity is unavailable.');
      const row={...previous,deliveryStatus:patch.deliveryStatus,
        deliveredAtMs:patch.deliveryStatus==='delivered'?previous.deliveredAtMs??clock.now():previous.deliveredAtMs,
        threadId:patch.threadId===undefined?previous.threadId:patch.threadId,
        turnId:patch.turnId===undefined?previous.turnId:patch.turnId,
        persistenceStatus:/** @type {const} */ ('nonpersisted')};
      dirtyMessages.set(messageId,{row,revision:++revision});
      markDirty();
      return {...row};
    },
    getMessage,
    messagesAfter,
    /** @param {{runId:string,direction:MessageDirection}} input */
    pendingDelivery({runId,direction}) {
      const {messageStatements}=requireOpen();
      const found=new Map();
      for(const raw of messageStatements.pending.all(runId,direction,cutoff())){
        const row=messageFromDatabase(/** @type {Record<string,unknown>} */ (raw));found.set(row.messageId,row);
      }
      for(const {row} of dirtyMessages.values())if(row.runId===runId && row.direction===direction){
        if(row.deliveryStatus==='accepted'&&retained(row))found.set(row.messageId,{...row});else found.delete(row.messageId);
      }
      return [...found.values()].sort((a,b)=>a.sequence-b.sequence);
    },
    /** @param {{runId:string,direction:MessageDirection,limit?:number,beforeMessageId?:string|null}} input */
    messagePage({runId,direction,limit=3,beforeMessageId=null}) {
      const {messageStatements}=requireOpen();
      let before=Number.MAX_SAFE_INTEGER;
      if(beforeMessageId!==null){
        const marker=getMessage(beforeMessageId);
        if(!marker||marker.runId!==runId||marker.direction!==direction||!retained(marker))throw new Error('Message page identity is invalid.');
        before=marker.sequence;
      }
      /** @type {Map<string,{messageId:string,sequence:number,preview:string,deliveryStatus:DeliveryStatus,persistenceStatus:import('./message-store.mjs').PersistenceStatus}>} */
      const found=new Map();
      const hiddenDirtyCount=[...dirtyMessages.values()].filter(({row})=>row.runId===runId
        && row.direction===direction && row.sequence<before && !retained(row)).length;
      for(const raw of messageStatements.page.all(runId,direction,before,cutoff(),limit+1+hiddenDirtyCount)){
        const value=/** @type {Record<string,unknown>} */ (raw);
        found.set(String(value.message_id),{messageId:String(value.message_id),sequence:Number(value.sequence),
          preview:String(value.preview),deliveryStatus:/** @type {DeliveryStatus} */ (value.delivery_status),persistenceStatus:'persisted'});
      }
      for(const {row} of dirtyMessages.values())if(row.runId===runId&&row.direction===direction&&row.sequence<before){
        if(retained(row))found.set(row.messageId,{messageId:row.messageId,sequence:row.sequence,
          preview:[...row.body].slice(0,100).join(''),deliveryStatus:row.deliveryStatus,persistenceStatus:'nonpersisted'});
        else found.delete(row.messageId);
      }
      const selected=[...found.values()].sort((a,b)=>b.sequence-a.sequence);
      const page=selected.slice(0,limit);
      return {messages:page.map(({sequence,...value})=>value),beforeMessageId:selected.length>limit?page.at(-1)?.messageId??null:null,
        recoveryIncomplete:this.recoveryIncomplete};
    },
    flush,
    async close() {
      if(closed)return;
      if(timer!==null){clock.clearTimeout(timer);timer=null;}
      /** @type {unknown} */ let error;
      try{await flush();}catch(failure){error=failure;}
      if(timer!==null){clock.clearTimeout(timer);timer=null;}
      closed=true;
      persistenceListeners.clear();
      try{database?.close();}catch(failure){error ??= failure;}
      if(error!==undefined)throw error;
    },
  };
}
