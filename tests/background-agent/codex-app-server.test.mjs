import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {mkdir, readFile, realpath, symlink, writeFile} from 'node:fs/promises';
import {join, relative} from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import { createCodexAppServerSessions } from '../../lib/background-agent/codex-app-server.mjs';
import {createReviewerMeasurement, observeReviewerMeasurement, reviewerMeasurementResult} from '../../lib/reviewer-runtime/reviewer-measurement.mjs';
import {cloneJsonValue} from '../../lib/common/json.mjs';
import {securePrivateStatePath} from '../../lib/background-agent/private-state.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';

/** @typedef {import('../../lib/background-agent/codex-app-server.mjs').NativeSettings} NativeSettings */
/** @typedef {import('../../lib/background-agent/codex-app-server.mjs').NativeNotification} NativeNotification */
/** @typedef {import('../../lib/background-agent/codex-app-server.mjs').NativeSpawnOptions} NativeSpawnOptions */

const rootId = 'root-native-id';
const cwd = '/scenes/current';
const rootPath = '/native/root.jsonl';
/** @type {NativeSettings} */
const settings = {
  model: 'custom-review-model', modelProvider: 'custom-provider', reasoningEffort: 'high', serviceTier: null,
  config: { model_providers: { 'custom-provider': { name: 'Custom', base_url: 'https://provider.invalid', wire_api: 'responses', env_key: 'REVIEW_API_KEY' } } },
};

/** @param {string} id @param {string | null} [parent] @param {string | null} [turnId] @param {string} [status] @returns {Record<string, unknown>} */
function thread(id, parent = null, turnId = null, status = 'completed') {
  return {
    id, sessionId: 'shared-family-id', parentThreadId: parent, forkedFromId: null, preview: '', path: `/native/${id === rootId ? 'root' : id}.jsonl`,
    source: parent ? { subAgent: { thread_spawn: { parent_thread_id: parent, depth: 1 } } } : 'appServer',
    status: { type: status === 'inProgress' ? 'active' : 'idle' }, model: 'configured-model-is-not-proof',
    modelProvider: 'configured-provider-is-not-proof', reasoningEffort: 'low', cwd,
    turns: turnId ? [{ id: turnId, status, items: [] }] : [],
  };
}

/** @param {string} id @param {{turnId?: string, effort?: string | null, model?: string, parent?: string, total?: number, final?: string, policy?: unknown, permissionProfile?: unknown}} [options] */
function records(id, { turnId, effort = 'high', model = settings.model, parent, total, final, policy, permissionProfile } = {}) {
  const source = parent ? { subagent: { thread_spawn: { parent_thread_id: parent, depth: 1 } } } : 'appServer';
  /** @type {Record<string, unknown>[]} */
  const lines = [{ type: 'session_meta', payload: { id, session_id: 'shared-family-id', model_provider: settings.modelProvider, source } }];
  if (turnId) lines.push({ type: 'turn_context', payload: {
    turn_id: turnId, model, effort, cwd,
    file_system_sandbox_policy: policy ?? (permissionProfile === undefined ? { kind: 'restricted', entries: [
      { path: { type: 'special', value: { kind: 'root' } }, access: 'deny' },
      { path: { type: 'special', value: { kind: 'minimal' } }, access: 'read' },
      { path: { type: 'path', path: cwd }, access: 'read' },
      { path: { type: 'path', path: `${cwd}/.tmp/reports` }, access: 'write' },
    ] } : undefined),
    ...(permissionProfile === undefined ? {} : {permission_profile: permissionProfile}),
  } });
  if (total !== undefined) lines.push({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: {
    input_tokens: total - 20, cached_input_tokens: 12, cache_write_input_tokens: 7,
    output_tokens: 20, reasoning_output_tokens: 5, total_tokens: total,
  } } } });
  if (final !== undefined) lines.push({ type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: final }] } });
  return lines.map((value) => JSON.stringify(value)).join('\n') + '\n';
}

/** @param {string} id @param {string} responseId @param {number} total */
function responseRecord(id, responseId, total) {
  return JSON.stringify({ type: 'token_usage_record', payload: {
    thread_id: id, response_id: responseId, usage: {
      input_tokens: total - 20, cached_input_tokens: 12, cache_write_input_tokens: 7,
      output_tokens: 20, reasoning_output_tokens: 5, total_tokens: total,
    },
  } }) + '\n';
}

/** @param {(message: Record<string, unknown>) => Record<string, unknown> | undefined} [override] @param {(path: string) => Promise<void>} [beforeNativeRead] @param {number} [unloadWaitMs] @param {()=>NodeJS.ProcessEnv} [nativeEnvironment] */
function harness(override = () => undefined, beforeNativeRead = async () => {}, unloadWaitMs=5000, nativeEnvironment=()=>({REVIEW_API_KEY:'private-provider-secret'})) {
  /** @type {Record<string, unknown>[]} */
  const messages = [];
  /** @type {NativeNotification[]} */
  const notifications = [];
  const nativeFiles = new Map([[rootPath, records(rootId)]]);
  const nativeThreads = new Map([[rootId, thread(rootId)]]);
  const backgroundTerminals = new Map();
  const child = Object.assign(new EventEmitter(), {
    pid: 4242,
    stdout: new PassThrough(), stderr: new PassThrough(),
    stdin: /** @type {Writable} */ (new PassThrough()),
    kill: /** @param {NodeJS.Signals | number} [_signal] */ (_signal) => { queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return true; },
  });
  let spawnCount = 0;
  let startedRoots = 0;
  let processExited = false;
  child.on('close',()=>{processExited=true;});
  /** @type {{pid:number,createdAt:string}|null} */
  let processIdentity = null;
  /** @type {string[]} */
  const catalogEvents = [];
  const catalogPath = '/private/models "shared".json';
  /** @type {import('../../lib/background-agent/codex-app-server.mjs').ModelCatalogBoundary} */
  const modelCatalog = {
    async prepare(){catalogEvents.push('prepare');return catalogPath;},
    async remove(){catalogEvents.push('remove');},
  };
  /** @type {{executable: string, args: string[], options: NativeSpawnOptions} | null} */
  let launch = null;
  /** @param {unknown} value */
  function emit(value) { child.stdout.write(JSON.stringify(value) + '\n'); }
  /** @param {Record<string, unknown>} message @returns {Record<string, unknown>} */
  function response(message) {
    const custom = override(message);
    if (custom) return custom;
    const params = /** @type {Record<string, unknown>} */ (message.params);
    if (message.method === 'initialize') return {};
    if (message.method === 'thread/start' || message.method === 'thread/resume') {
      const id=message.method==='thread/start'?(startedRoots++===0?rootId:'second-root'):String(params.threadId);
      if(id==='second-root'&&!nativeThreads.has(id)){
        nativeThreads.set(id,thread(id));
        nativeFiles.set('/native/second-root.jsonl',records(id));
      }
      const found = nativeThreads.get(id);
      return { thread: params.excludeTurns ? { ...found, turns: [] } : found };
    }
    if (message.method === 'thread/list') return { data: [...nativeThreads.values()].filter((value) => value.parentThreadId && !params.archived), nextCursor: null };
    if (message.method === 'thread/loaded/list') return { data: [...nativeThreads.entries()].filter(([, value]) => paramsOfStatus(value).type !== 'notLoaded').map(([id]) => id), nextCursor: null };
    if (message.method === 'thread/backgroundTerminals/list') return {data: backgroundTerminals.get(String(params.threadId)) ?? [], nextCursor: null};
    if (message.method === 'thread/backgroundTerminals/terminate') {
      const threadId=String(params.threadId);
      const terminals=/** @type {Array<{processId:string}>} */ (backgroundTerminals.get(threadId) ?? []);
      const index=terminals.findIndex(terminal=>terminal.processId===params.processId);
      if(index<0)return {terminated:false};
      terminals.splice(index,1);
      backgroundTerminals.set(threadId,terminals);
      return {terminated:true};
    }
    if (message.method === 'thread/read') {
      const found = nativeThreads.get(String(params.threadId));
      if (!found) throw new Error('Unknown fake thread.');
      return { thread: params.includeTurns ? found : { ...found, turns: [] } };
    }
    if (message.method === 'thread/turns/list') {
      const found = nativeThreads.get(String(params.threadId));
      if (!found) throw new Error('Unknown fake thread.');
      const turns = /** @type {Record<string, unknown>[]} */ (found.turns);
      return { data: turns.slice(-Number(params.limit)).reverse().map((turn) => ({ ...turn, itemsView: 'full' })), nextCursor: null };
    }
    if (message.method === 'turn/start') {
      const value = { ...thread(rootId, null, 'new-turn', 'inProgress'), historyMode: nativeThreads.get(rootId)?.historyMode ?? 'legacy' };
      nativeThreads.set(rootId, value);
      nativeFiles.set(rootPath, records(rootId, { turnId: 'new-turn' }));
      return { turn: { id: 'new-turn', status: 'inProgress', items: [] } };
    }
    if (message.method === 'turn/steer') return { turnId: params.expectedTurnId };
    if (message.method === 'turn/interrupt') {
      const id=String(params.threadId);
      const found=nativeThreads.get(id);
      if(found){
        nativeThreads.set(id,{...found,status:{type:'idle'},turns:[{id:params.turnId,status:'interrupted',items:[]}]});
        queueMicrotask(()=>emit({method:'turn/completed',params:{threadId:id,turn:{id:params.turnId,status:'interrupted',items:[]}}}));
      }
      return {};
    }
    if (message.method === 'thread/unsubscribe') {
      const id=String(params.threadId);
      const found=nativeThreads.get(id);
      if(found)nativeThreads.set(id,{...found,status:{type:'notLoaded'}});
      queueMicrotask(()=>emit({method:'thread/closed',params:{threadId:id}}));
      return {status:'unsubscribed'};
    }
    throw new Error(`Unexpected fake method: ${message.method}.`);
  }
  child.stdin = new Writable({
    write(chunk, _encoding, done) {
      for (const line of String(chunk).trim().split('\n')) {
        const message = /** @type {Record<string, unknown>} */ (JSON.parse(line));
        messages.push(message);
        if ('method' in message && 'id' in message) queueMicrotask(() => {
          try { emit({ id: message.id, result: response(message) }); }
          catch (error) {
            const code = error instanceof Error && 'code' in error && typeof error.code === 'number' ? error.code : -32000;
            emit({ id: message.id, error: { code, message: 'private-provider-secret' } });
          }
        });
      }
      done();
    },
    final(done) { done(); queueMicrotask(() => child.emit('close', 0, null)); },
  });
  /** @type {import('../../lib/background-agent/codex-app-server.mjs').ProcessIdentityBoundary} */
  const processIdentityBoundary = {
      async read(){return processIdentity?{state:processExited?'ended':'alive',identity:processIdentity}:{state:'absent',identity:null};},
      async record(value){processIdentity=value;},
      async remove(value){if(processIdentity?.pid!==value.pid||processIdentity.createdAt!==value.createdAt)throw new Error('Identity changed.');processIdentity=null;},
      async creationTime(){return '1700000000000000000';},
  };
  const factory = createCodexAppServerSessions({
    unloadWaitMs,
    runtimeDirectory:'/private/runtime',
    modelCatalog,
    processIdentity:processIdentityBoundary,
    spawnProcess(executable, args, options) { processExited=false;catalogEvents.push('spawn');spawnCount += 1; launch = { executable, args, options }; return child; },
    async readNativeFile(path) {
      await beforeNativeRead(path);
      const contents = nativeFiles.get(path);
      if (contents === undefined) throw Object.assign(new Error('Missing fake records.'), {code:'ENOENT'});
      return contents;
    },
    environment: nativeEnvironment,
  });
  return {
    factory, messages, notifications, nativeFiles, nativeThreads, backgroundTerminals, child, emit, modelCatalog, catalogEvents, catalogPath, processIdentityBoundary,
    get spawnCount() { return spawnCount; },
    get launch() { return launch; },
    /** @param {string} [runId] */
    open: (runId) => factory.open({ settings, cwd, readPaths: [], writePaths: [`${cwd}/.tmp/reports`], runId, onNotification: (value) => notifications.push(value) }),
  };
}

test('a member first observed during native record reads invalidates that snapshot and appears on retry', async () => {
  /** @type {(() => void) | undefined} */
  let enteredRead;
  /** @type {(() => void) | undefined} */
  let releaseRead;
  const readEntered = /** @type {Promise<void>} */ (new Promise((resolve) => { enteredRead = resolve; }));
  const readGate = /** @type {Promise<void>} */ (new Promise((resolve) => { releaseRead = resolve; }));
  let holdRootRead = true;
  const fake = harness(() => undefined, async (path) => {
    if (path === rootPath && holdRootRead) {
      holdRootRead = false;
      enteredRead?.();
      await readGate;
    }
  });
  fake.nativeThreads.set(rootId, thread(rootId, null, 'root-turn'));
  fake.nativeFiles.set(rootPath, records(rootId, { turnId: 'root-turn', final: 'ready' }));
  const session = await fake.open();
  await session.resume({ threadId: rootId, expectedSessionPath: rootPath, instructions: '完整角色规则' });
  const pending = session.snapshot({ rootThreadId: rootId });
  await readEntered;
  const late = thread('late-child', rootId, 'late-turn', 'inProgress');
  fake.nativeThreads.set('late-child', late);
  fake.nativeFiles.set('/native/late-child.jsonl', records('late-child', { parent: rootId, turnId: 'late-turn' }));
  fake.emit({ method: 'thread/started', params: { thread: late } });
  releaseRead?.();
  const stale = await pending;
  assert.deepEqual(stale.members.map((member) => member.threadId), [rootId]);
  assert.equal(stale.members[0].finalResponse, 'ready');
  assert.equal(stale.factsComplete, false);
  assert.match(stale.unknownReasons.join(' '), /member.*observ/i);
  const retry = await session.snapshot({ rootThreadId: rootId });
  assert.equal(retry.members.some((member) => member.threadId === 'late-child'), true);
  await session.stop();
});

/** @param {Record<string, unknown>} value @returns {Record<string, unknown>} */
function params(value) { return /** @type {Record<string, unknown>} */ (value.params); }
/** @param {Record<string, unknown>} value @returns {Record<string, unknown>} */
function paramsOfStatus(value) { return /** @type {Record<string, unknown>} */ (value.status); }

test('generic native start preserves caller instructions and provider environment reference', async () => {
  const fake = harness();
  assert.equal(fake.spawnCount, 0);
  const session = await fake.open('manager-run-1');
  assert.equal(fake.spawnCount, 1);
  assert.ok(fake.launch);
  assert.deepEqual(fake.launch.args, ['-c', 'thread_unload_delay_secs=0', '-c', `model_catalog_json=${JSON.stringify(fake.catalogPath)}`, 'app-server', '--listen', 'stdio://']);
  assert.deepEqual(fake.catalogEvents,['prepare','spawn']);
  assert.equal(fake.launch.options.env.REVIEW_API_KEY, 'private-provider-secret');
  assert.equal(fake.launch.options.env.ARW_BACKGROUND_AGENT_RUN_ID, undefined);
  const instructions = '完整 Canonical Role\n公共 Reviewer 规则\n独立审核与绑定文件交接';
  const started = await session.start({ instructions });
  assert.deepEqual(started, { threadId: rootId, sessionPath: rootPath });
  assert.equal(fake.messages.some((value) => value.method === 'turn/start'), false);
  const start = params(fake.messages.find((value) => value.method === 'thread/start') ?? {});
  assert.equal(start.developerInstructions, instructions);
  assert.equal(start.model, settings.model);
  assert.equal(start.modelProvider, settings.modelProvider);
  assert.equal(start.approvalPolicy, undefined);
  assert.equal(start.baseInstructions, undefined);
  assert.equal(start.outputSchema, undefined);
  const config = /** @type {Record<string, unknown>} */ (start.config);
  assert.equal(start.permissions, undefined);
  assert.equal(config['agents.enabled'], undefined);
  assert.equal(config['features.multi_agent'], undefined);
  assert.equal(config['features.multi_agent_v2'], undefined);
  assert.equal(config.model_catalog_json, undefined);
  assert.equal(config.approvals_reviewer, undefined);
  assert.equal(/** @type {Record<string,unknown>} */ (/** @type {Record<string,unknown>} */ (config.shell_environment_policy).set).ARW_BACKGROUND_AGENT_RUN_ID,'manager-run-1');
  assert.equal(JSON.stringify(fake.messages).includes('private-provider-secret'), false);
  const baseline = await session.snapshot({ rootThreadId: rootId });
  assert.equal(baseline.factsComplete, true);
  assert.equal(baseline.members[0].usage.totalTokens, null);
  assert.equal(baseline.members[0].hasConversationHistory, false);
  await session.startTurn({ threadId: rootId, handoff: '完整审核输入和报告路径' });
  await session.steer({ threadId: rootId, turnId: 'new-turn', instruction: '补充工作指示' });
  const steer = params(fake.messages.find((value) => value.method === 'turn/steer') ?? {});
  assert.equal(steer.expectedTurnId, 'new-turn');
  assert.equal(steer.outputSchema, undefined);
  assert.equal(fake.messages.filter((value) => value.method === 'thread/start').length, 1);
  await session.stop();
});

test('generic adapter passes explicit collaboration settings to process and native thread', async () => {
  const attempted = { ...settings, config: {
    ...settings.config, 'agents.enabled': true, 'features.multi_agent': true, 'features.multi_agent_v2': true,
    'agents.max_concurrent_threads_per_session': 3, 'agents.default_subagent_model': 'other-model',
    'agents.default_subagent_reasoning_effort': 'ultra',
    agents: { enabled: true, max_concurrent_threads_per_session: 3, default_subagent_model: 'other-model' },
    features: { multi_agent: true, multi_agent_v2: true, other_feature: true },
  } };
  for (const operation of ['start', 'resume']) {
    const fake = harness();
    const session = await fake.factory.open({ settings: attempted, cwd, readPaths: [], writePaths: [`${cwd}/.tmp/reports`], onNotification() {} });
    if (operation === 'start') await session.start({ instructions: '完整角色规则' });
    else await session.resume({ threadId: rootId, expectedSessionPath: rootPath, instructions: '完整角色规则' });
    const request = params(fake.messages.find((value) => value.method === `thread/${operation}`) ?? {});
    const config = /** @type {Record<string, unknown>} */ (request.config);
    assert.equal(config['agents.enabled'], true);
    assert.equal(config['features.multi_agent'], true);
    assert.equal(config['features.multi_agent_v2'], true);
    assert.deepEqual(config.agents, { enabled: true, max_concurrent_threads_per_session: 3, default_subagent_model: 'other-model' });
    assert.deepEqual(config.features, { multi_agent: true, multi_agent_v2: true, other_feature: true });
    assert.deepEqual(fake.launch?.args, ['-c', 'thread_unload_delay_secs=0', '-c', `model_catalog_json=${JSON.stringify(fake.catalogPath)}`, 'app-server', '--listen', 'stdio://']);
    await session.stop();
  }
});

test('two independent roots share one App Server while settings, notifications and unload stay isolated',async()=>{
  const fake=harness();
  const first=await fake.open('run-one');
  const secondNotifications=/** @type {NativeNotification[]} */ ([]);
  const second=await fake.factory.open({
    settings:{...settings,model:'second-model',modelProvider:'second-provider',reasoningEffort:'low',
      config:{'agents.enabled':true,'features.multi_agent':true,'features.multi_agent_v2':true}},
    cwd:'/other-scene',readPaths:[],writePaths:['/other-scene/report'],runId:'run-two',
    onNotification:value=>secondNotifications.push(value),
  });
  assert.equal(fake.spawnCount,1);
  assert.deepEqual(fake.catalogEvents,['prepare','spawn']);
  assert.equal((await first.start({instructions:'first role'})).threadId,rootId);
  assert.equal((await second.start({instructions:'second role'})).threadId,'second-root');
  const duplicate=await fake.open();
  await assert.rejects(duplicate.resume({threadId:rootId,expectedSessionPath:rootPath,instructions:'duplicate'}),/already has a control handle/);
  assert.equal(fake.messages.some(message=>message.method==='thread/resume'),false);
  await duplicate.stop();
  const starts=fake.messages.filter(message=>message.method==='thread/start').map(params);
  assert.deepEqual(starts.map(value=>[value.model,value.modelProvider,value.cwd]),[
    [settings.model,settings.modelProvider,cwd],['second-model','second-provider','/other-scene'],
  ]);
  const firstConfig=/** @type {Record<string,unknown>} */ (starts[0].config);
  const secondConfig=/** @type {Record<string,unknown>} */ (starts[1].config);
  const firstPolicy=/** @type {Record<string,unknown>} */ (firstConfig.shell_environment_policy);
  const secondPolicy=/** @type {Record<string,unknown>} */ (secondConfig.shell_environment_policy);
  assert.equal(/** @type {Record<string,unknown>} */ (firstPolicy.set).ARW_BACKGROUND_AGENT_RUN_ID,'run-one');
  assert.equal(/** @type {Record<string,unknown>} */ (secondPolicy.set).ARW_BACKGROUND_AGENT_RUN_ID,'run-two');
  assert.equal(firstConfig['agents.enabled'],undefined);
  assert.equal(secondConfig['agents.enabled'],true);
  assert.deepEqual((await first.snapshot({rootThreadId:rootId})).members.map(value=>value.threadId),[rootId]);
  assert.deepEqual((await second.snapshot({rootThreadId:'second-root'})).members.map(value=>value.threadId),['second-root']);
  const firstCount=fake.notifications.length;
  fake.emit({method:'thread/status/changed',params:{threadId:'second-root',status:{type:'idle'}}});
  assert.equal(fake.notifications.length,firstCount);
  assert.equal(secondNotifications.at(-1)?.type,'changed');
  await first.stop();
  assert.equal((await first.snapshot({rootThreadId:rootId})).environmentState,'exited');
  assert.equal((await second.snapshot({rootThreadId:'second-root'})).environmentState,'running');
  assert.equal(fake.spawnCount,1);
  await assert.rejects(fake.factory.close(),/loaded roots/);
  await second.stop();
  assert.deepEqual(await fake.factory.close(),{environmentState:'exited'});
  assert.deepEqual(fake.catalogEvents,['prepare','spawn','remove']);
});

test('unsubscribe acceptance cannot claim root unload while the original thread remains loaded',async()=>{
  const fake=harness(message=>message.method==='thread/unsubscribe'?{status:'unsubscribed'}:undefined,async()=>{},5);
  const session=await fake.open();
  await session.start({instructions:'rules'});
  await assert.rejects(session.stop(),/unload was not observed/);
  assert.equal((await session.snapshot({rootThreadId:rootId})).environmentState,'running');
  await assert.rejects(fake.factory.close(),/loaded roots/);
  assert.equal(fake.spawnCount,1);
});

test('cold factory close distinguishes a confirmed ended process from an absent identity',async()=>{
  /** @type {'alive'|'unknown'|'ended'|'absent'} */
  let state='alive';
  let removed=false;
  let catalogRemoved=false;
  let spawned=false;
  const original={pid:4242,createdAt:'1700000000000000000'};
  const factory=createCodexAppServerSessions({
    modelCatalog:{async prepare(){throw new Error('Cold close cannot prepare a catalog.');},async remove(){catalogRemoved=true;}},
    processIdentity:{
      async read(){return {state,identity:state==='absent'?null:original};},
      async record(){throw new Error('Cold close cannot record an identity.');},
      async remove(value){assert.deepEqual(value,original);removed=true;},
      async creationTime(){throw new Error('Cold close cannot read a new process.');},
    },
    spawnProcess(){spawned=true;throw new Error('Cold close cannot start a process.');},
  });
  await assert.rejects(factory.close(),/exit could not be confirmed/);
  state='unknown';
  await assert.rejects(factory.close(),/exit could not be confirmed/);
  assert.equal(removed,false);
  assert.equal(catalogRemoved,false);
  state='ended';
  assert.deepEqual(await factory.close({retainProcessIdentity:true}),{environmentState:'exited',previousProcessState:'ended'});
  assert.equal(removed,false);
  assert.equal(catalogRemoved,true);
  assert.deepEqual(await factory.close(),{environmentState:'exited',previousProcessState:'ended'});
  assert.equal(removed,true);
  state='absent';
  assert.deepEqual(await factory.close(),{environmentState:'exited',previousProcessState:'absent'});
  assert.equal(spawned,false);
});

test('unexpected shared exit retains process identity until startup recovers its provider leases',async()=>{
  const fake=harness();
  const session=await fake.open();
  await session.start({instructions:'root instructions'});
  await session.stop();
  fake.child.emit('close',1,null);
  assert.equal(await fake.factory.observeServer(),'ended');
  assert.equal((await fake.processIdentityBoundary.read()).state,'ended');
  await assert.rejects(fake.factory.close(),/outside normal closure/);
  assert.equal((await fake.processIdentityBoundary.read()).state,'ended');
  await assert.rejects(fake.open(),/requires provider recovery/);
  await assert.rejects(fake.factory.ensureServer({onPreviousExit:async()=>{throw new Error('Original lease remains unreturned.');}}),
    /Original lease remains unreturned/);
  assert.equal((await fake.processIdentityBoundary.read()).state,'ended');
  assert.equal(fake.spawnCount,1);
});

test('shared catalog is prepared before launch and cannot be overridden by a root',async()=>{
  const fake=harness();
  await assert.rejects(fake.factory.open({settings:{...settings,config:{...settings.config,model_catalog_json:'/other/catalog.json'}},cwd,readPaths:[],writePaths:[],onNotification(){}}),/root thread cannot override model_catalog_json/);
  assert.equal(fake.spawnCount,0);
  assert.deepEqual(fake.catalogEvents,[]);
  const session=await fake.open();
  await session.start({instructions:'root instructions'});
  assert.deepEqual(fake.catalogEvents,['prepare','spawn']);
  const start=params(fake.messages.find(value=>value.method==='thread/start')??{});
  assert.equal(/** @type {Record<string,unknown>} */ (start.config).model_catalog_json,undefined);
  await session.stop();
  assert.deepEqual(await fake.factory.close(),{environmentState:'exited'});
  assert.deepEqual(fake.catalogEvents,['prepare','spawn','remove']);
});

test('trusted provider lease reaches only this root native request and not saved settings',async()=>{
  const fake=harness();
  const credential={providerId:settings.modelProvider,baseUrl:'http://responses.local/v1',leaseKey:'private-strata-key'};
  await assert.rejects(fake.factory.open({settings:{...settings,config:{model_providers:{
    [settings.modelProvider]:{experimental_bearer_token:'caller-secret'},
  }}},cwd,readPaths:[],writePaths:[],onNotification(){}}),/environment key reference/);
  await assert.rejects(fake.factory.open({settings:{...settings,config:{
    [`model_providers.${settings.modelProvider}.experimental_bearer_token`]:'caller-secret',
  }},cwd,readPaths:[],writePaths:[],onNotification(){}}),/environment key reference/);
  assert.equal(fake.spawnCount,0);
  const session=await fake.factory.open({settings,cwd,readPaths:[],writePaths:[],providerConnection:credential,onNotification(){}});
  await session.start({instructions:'first root'});
  const first=params(fake.messages.find(value=>value.method==='thread/start')??{});
  const firstProvider=/** @type {Record<string,unknown>} */ (/** @type {Record<string,any>} */ (first.config).model_providers[settings.modelProvider]);
  assert.equal(firstProvider.base_url,credential.baseUrl);
  assert.equal(firstProvider.experimental_bearer_token,credential.leaseKey);
  assert.equal(firstProvider.env_key,undefined);
  assert.equal(JSON.stringify(settings).includes(credential.leaseKey),false);
  await session.stop();
  const ordinary=await fake.factory.open({settings:{...settings,model:'ordinary-root'},cwd,readPaths:[],writePaths:[],onNotification(){}});
  await ordinary.start({instructions:'second root'});
  const starts=fake.messages.filter(value=>value.method==='thread/start').map(params);
  const ordinaryConfig=/** @type {Record<string,any>} */ (starts[1].config);
  assert.equal(ordinaryConfig.model_providers[settings.modelProvider].experimental_bearer_token,undefined);
  assert.equal(ordinaryConfig.model_providers[settings.modelProvider].env_key,'REVIEW_API_KEY');
  await ordinary.stop();
  await fake.factory.close();
});

test('default catalog source produces the launched shared file and removes it after native exit',async(t)=>{
  const fixture=await createTemporaryDirectory(t,'native-catalog-integration-');
    const codexHome=join(fixture,'codex-home');
    const runtimeDirectory=join(fixture,'private-runtime');
    await mkdir(codexHome,{mode:0o700});
    await mkdir(runtimeDirectory,{mode:0o700});
    await securePrivateStatePath(runtimeDirectory,'directory');
    const cachePath=join(codexHome,'models_cache.json');
    const customPath=join(codexHome,'models.custom.json');
    const cacheBytes=Buffer.from('{"cacheIdentity":"native-only","models":[{"slug":"native-gpt"}]}\n');
    const customBytes=Buffer.from('{"models":[{"slug":"local-model"}]}\n');
    await writeFile(cachePath,cacheBytes);
    await writeFile(customPath,customBytes);
    const fake=harness();
    /** @type {{args:string[],options:NativeSpawnOptions}|null} */
    let launch=null;
    /** @returns {{args:string[],options:NativeSpawnOptions}|null} */
    function observedLaunch(){return launch;}
    const factory=createCodexAppServerSessions({
      runtimeDirectory,
      processIdentity:fake.processIdentityBoundary,
      spawnProcess(_executable,args,options){launch={args,options};return fake.child;},
      async readNativeFile(path){
        const value=fake.nativeFiles.get(path);
        if(value===undefined)throw Object.assign(new Error('Missing fake native records.'),{code:'ENOENT'});
        return value;
      },
      environment:()=>({CODEX_HOME:codexHome}),
    });
    const session=await factory.open({settings,cwd,readPaths:[],writePaths:[`${cwd}/.tmp/reports`],onNotification(){}});
    const generatedPath=join(runtimeDirectory,'models.json');
    const started=observedLaunch();
    assert.ok(started);
    assert.equal(started.args.find(value=>value.startsWith('model_catalog_json=')),`model_catalog_json=${JSON.stringify(generatedPath)}`);
    assert.equal(started.options.env.CODEX_HOME,await realpath(codexHome));
    assert.deepEqual(JSON.parse(await readFile(generatedPath,'utf8')),{models:[{slug:'native-gpt'},{slug:'local-model'}]});
    assert.deepEqual(await readFile(cachePath),cacheBytes);
    assert.deepEqual(await readFile(customPath),customBytes);
    await session.start({instructions:'root instructions'});
    await session.stop();
    assert.deepEqual(await factory.close(),{environmentState:'exited'});
    await assert.rejects(readFile(generatedPath),error=>error instanceof Error&&'code' in error&&error.code==='ENOENT');
    assert.deepEqual(await readFile(cachePath),cacheBytes);
    assert.deepEqual(await readFile(customPath),customBytes);
});

test('relative or linked CODEX_HOME is resolved before catalog preparation and native launch',async(t)=>{
  const fixture=await createTemporaryDirectory(t,'native-codex-home-');
    const actual=join(fixture,'actual');
    const linked=join(fixture,'linked');
    await mkdir(actual);
    await symlink(actual,linked,process.platform==='win32'?'junction':'dir');
    const expected=await realpath(actual);
    for(const source of [actual,linked]){
      const fake=harness(()=>undefined,async()=>{},5000,()=>({CODEX_HOME:relative(process.cwd(),source)}));
      const session=await fake.open();
      assert.equal(fake.launch?.options.cwd,'/private/runtime');
      assert.equal(fake.launch?.options.env.CODEX_HOME,expected);
      assert.deepEqual(fake.catalogEvents,['prepare','spawn']);
      await session.start({instructions:'root instructions'});
      await session.stop();
      await fake.factory.close();
    }
    const missing=harness(()=>undefined,async()=>{},5000,()=>({CODEX_HOME:relative(process.cwd(),join(fixture,'missing'))}));
    await assert.rejects(missing.open(),/ENOENT/);
    assert.equal(missing.spawnCount,0);
    assert.deepEqual(missing.catalogEvents,[]);
});

test('a confirmed earlier process is cleaned before the next shared catalog is prepared',async()=>{
  const fake=harness();
  const old={pid:1234,createdAt:'1699999999999999999'};
  let oldIdentity=true;
  let staleCatalog=true;
  const read=fake.processIdentityBoundary.read;
  const removeIdentity=fake.processIdentityBoundary.remove;
  const prepare=fake.modelCatalog.prepare;
  const removeCatalog=fake.modelCatalog.remove;
  fake.processIdentityBoundary.read=async()=>oldIdentity?{state:'ended',identity:old}:read();
  fake.processIdentityBoundary.remove=async(value)=>{
    if(oldIdentity){assert.deepEqual(value,old);oldIdentity=false;return;}
    return removeIdentity(value);
  };
  fake.modelCatalog.prepare=async()=>{
    if(staleCatalog)throw new Error('The old generated file was not removed.');
    return prepare();
  };
  fake.modelCatalog.remove=async()=>{staleCatalog=false;return removeCatalog();};
  await fake.factory.ensureServer({onPreviousExit:async()=>{}});
  const session=await fake.open();
  assert.deepEqual(fake.catalogEvents,['remove','prepare','spawn']);
  await session.start({instructions:'root instructions'});
  await session.stop();
  await fake.factory.close();
  assert.deepEqual(fake.catalogEvents,['remove','prepare','spawn','remove']);
});

test('catalog preparation or synchronous spawn failure leaves no unmanaged generated catalog',async()=>{
  const invalid=harness();
  invalid.modelCatalog.prepare=async()=>{throw new Error('Invalid source catalog.');};
  await assert.rejects(invalid.open(),/Invalid source catalog/);
  assert.equal(invalid.spawnCount,0);

  /** @type {string[]} */const events=[];
  const factory=createCodexAppServerSessions({
    processIdentity:{
      async read(){return {state:'absent',identity:null};},
      async record(){throw new Error('Spawn failure must not record a process.');},
      async remove(){throw new Error('Spawn failure must not remove a process.');},
      async creationTime(){throw new Error('Spawn failure has no process.');},
    },
    modelCatalog:{async prepare(){events.push('prepare');return '/private/models.json';},async remove(){events.push('remove');}},
    spawnProcess(){events.push('spawn');throw new Error('Codex executable is unavailable.');},
  });
  await assert.rejects(factory.open({settings,cwd,readPaths:[],writePaths:[],onNotification(){}}),/Codex executable is unavailable/);
  assert.deepEqual(events,['prepare','spawn','remove']);
});

test('confirmed exit attempts both cleanups and reports a failed component',async()=>{
  for(const failed of ['process identity','shared model catalog']){
    const fake=harness();
    const session=await fake.open();
    await session.start({instructions:'root instructions'});
    await session.stop();
    if(failed==='process identity')fake.processIdentityBoundary.remove=async()=>{throw new Error('Identity cleanup failed.');};
    else fake.modelCatalog.remove=async()=>{fake.catalogEvents.push('remove');throw new Error('Catalog cleanup failed.');};
    await assert.rejects(fake.factory.close(),error=>error instanceof Error&&error.message.includes(`exit cleanup failed: ${failed}`));
    assert.deepEqual(fake.catalogEvents,['prepare','spawn','remove']);
  }
});

test('a descendant created during root unload prevents a false stopped result',async()=>{
  /** @type {ReturnType<typeof harness>} */
  let fake;
  fake=harness(message=>{
    if(message.method!=='thread/unsubscribe')return undefined;
    const id=String(params(message).threadId);
    const found=fake.nativeThreads.get(id);
    if(found)fake.nativeThreads.set(id,{...found,status:{type:'notLoaded'}});
    if(id===rootId){
      const late=thread('late-child',rootId);
      fake.nativeThreads.set('late-child',late);
      fake.nativeFiles.set('/native/late-child.jsonl',records('late-child',{parent:rootId}));
      fake.emit({method:'thread/started',params:{thread:late}});
    }
    return {status:'unsubscribed'};
  });
  const session=await fake.open();
  await session.start({instructions:'rules'});
  await assert.rejects(session.stop(),/changed during unload/);
  assert.equal((await session.snapshot({rootThreadId:rootId})).environmentState,'running');
});

test('fresh root can complete member discovery before its first native record is flushed', async () => {
  const fake = harness();
  fake.nativeThreads.set(rootId, { ...thread(rootId), path: null });
  fake.nativeFiles.delete(rootPath);
  const session = await fake.open();
  assert.deepEqual(await session.start({ instructions: '完整角色规则' }), { threadId: rootId, sessionPath: null });
  const beforeTurn = await session.snapshot({ rootThreadId: rootId });
  assert.equal(beforeTurn.factsComplete, true);
  assert.deepEqual(beforeTurn.members.map((member) => member.threadId), [rootId]);
  assert.equal(beforeTurn.members[0].modelProvider, null);
  assert.equal(beforeTurn.members[0].usage.totalTokens, null);
  await session.startTurn({ threadId: rootId, handoff: '审核输入' });
  const afterTurn = await session.snapshot({ rootThreadId: rootId });
  assert.equal(afterTurn.factsComplete, true);
  assert.equal(afterTurn.members[0].sessionPath, rootPath);
  await session.stop();
});

test('fresh paginated root skips unavailable turn pagination while still discovering members', async () => {
  const fake = harness((message) => {
    if (message.method === 'thread/turns/list' && params(message).threadId === rootId
      && /** @type {Record<string, unknown>[]} */ (fake.nativeThreads.get(rootId)?.turns).length === 0) {
      throw Object.assign(new Error('thread is not materialized yet; unavailable before first user message'), { code: -32600 });
    }
    return undefined;
  });
  fake.nativeThreads.set(rootId, { ...thread(rootId), historyMode: 'paginated' });
  fake.nativeThreads.set('child', thread('child', rootId, 'child-turn'));
  fake.nativeFiles.set('/native/child.jsonl', records('child', { parent: rootId, turnId: 'child-turn' }));
  const session = await fake.open();
  await session.start({ instructions: '完整角色规则' });
  const beforeTurn = await session.snapshot({ rootThreadId: rootId });
  assert.equal(beforeTurn.factsComplete, true);
  assert.deepEqual(beforeTurn.members.map((member) => member.threadId), ['child', rootId]);
  assert.equal(fake.messages.some((message) => message.method === 'thread/turns/list'), false);
  assert.deepEqual(fake.messages.filter((message) => message.method === 'thread/list').map((message) => params(message).archived).sort(), [false, true]);
  assert.equal(fake.messages.some((message) => message.method === 'thread/loaded/list'), true);
  fake.nativeThreads.set(rootId, { ...fake.nativeThreads.get(rootId), status: { type: 'active' } });
  const inconsistent = await session.snapshot({ rootThreadId: rootId });
  assert.equal(inconsistent.factsComplete, false);
  assert.match(inconsistent.unknownReasons.join(' '), /rejected thread\/turns\/list \(code -32600\)/);
  await session.startTurn({ threadId: rootId, handoff: '审核输入' });
  const duringTurn = await session.snapshot({ rootThreadId: rootId });
  assert.equal(duringTurn.factsComplete, true);
  assert.equal(fake.messages.some((message) => message.method === 'thread/turns/list' && params(message).threadId === rootId), true);
  await session.stop();
});

test('resume targets the original Thread.id and never returns an earlier final response for a new turn', async t => {
  let observedAt=1000;
  t.mock.method(Date,'now',()=>observedAt);
  const fake = harness();
  fake.nativeThreads.set(rootId, thread(rootId, null, 'old-turn'));
  fake.nativeFiles.set(rootPath, records(rootId, { turnId: 'old-turn', final: 'ready', total: 80 }));
  const session = await fake.open();
  await session.resume({ threadId: rootId, expectedSessionPath: rootPath, instructions: '同一完整角色和公共规则' });
  const resume = params(fake.messages.find((value) => value.method === 'thread/resume') ?? {});
  assert.equal(resume.threadId, rootId);
  assert.equal(resume.excludeTurns, true);
  assert.equal(resume.path, undefined);
  assert.equal(resume.history, undefined);
  const baseline=await session.snapshot({rootThreadId:rootId});
  assert.equal(baseline.members[0].finalResponse,'ready');
  observedAt=2000;
  const measurement=createReviewerMeasurement({startedAt:observedAt,members:baseline.members,rootThreadId:rootId,measurementFacts:baseline.measurementFacts});
  await session.startTurn({ threadId: rootId, handoff: '本轮完整输入' });
  fake.nativeThreads.set(rootId, thread(rootId, null, 'old-turn'));
  fake.nativeFiles.set(rootPath, records(rootId, { turnId: 'old-turn', final: 'ready', total: 80 }));
  const during = await session.snapshot({ rootThreadId: rootId });
  assert.equal(during.members[0].turnId, 'new-turn');
  assert.equal(during.members[0].state, 'active');
  assert.equal(during.members[0].finalResponse, null);
  assert.equal(during.factsComplete, false);
  assert.match(during.unknownReasons.join(' '), /current native turn context/);
  observeReviewerMeasurement(measurement,{members:during.members,rootThreadId:rootId,measurementFacts:during.measurementFacts,now:observedAt});
  observedAt=3000;
  fake.child.emit('close',1,null);
  const exited=await session.snapshot({rootThreadId:rootId});
  observeReviewerMeasurement(measurement,{members:exited.members,rootThreadId:rootId,measurementFacts:exited.measurementFacts,now:observedAt});
  observedAt=4000;
  assert.equal(reviewerMeasurementResult(measurement,observedAt).workDuration.durationMs,1000);
  observedAt=5000;
  await fake.factory.ensureServer({onPreviousExit:async()=>{}});
  fake.nativeThreads.set(rootId,thread(rootId,null,'new-turn','inProgress'));
  fake.nativeFiles.set(rootPath,records(rootId,{turnId:'new-turn',total:110}));
  const resumed=await fake.open();
  await resumed.resume({threadId:rootId,expectedSessionPath:rootPath,instructions:'同一原线程继续当前审核'});
  observedAt=6000;
  const restored=await resumed.snapshot({rootThreadId:rootId});
  observeReviewerMeasurement(measurement,{members:restored.members,rootThreadId:rootId,measurementFacts:restored.measurementFacts,now:observedAt});
  assert.equal(reviewerMeasurementResult(measurement,observedAt).workDuration.durationMs,2000);
  const recovered=/** @type {typeof measurement} */(cloneJsonValue(measurement));
  observedAt=7000;
  observeReviewerMeasurement(recovered,{members:restored.members,rootThreadId:rootId,measurementFacts:restored.measurementFacts,now:observedAt});
  recovered.finishedAt=observedAt;
  const final=reviewerMeasurementResult(recovered,observedAt);
  assert.equal(final.startedAt,2000);assert.equal(final.wallClockMs,5000);assert.equal(final.workDuration.durationMs,3000);
  assert.equal(final.usage.totalTokens,30);assert.deepEqual(final.members.map(member=>member.threadId),[rootId]);
  observedAt=9000;
  assert.equal(reviewerMeasurementResult(recovered,observedAt).workDuration.durationMs,3000);
  await resumed.stop();await fake.factory.close();
});

test('resume path or thread identity mismatch fails without creating a replacement', async () => {
  for (const wrongIdentity of [false, true]) {
    const fake = harness((message) => message.method === 'thread/resume' ? { thread: { ...thread(wrongIdentity ? 'replacement' : rootId), path: '/native/different.jsonl' } } : undefined);
    const session = await fake.open();
    await assert.rejects(session.resume({ threadId: rootId, expectedSessionPath: rootPath, instructions: '完整角色规则' }), /original thread|record path changed/);
    assert.equal(fake.messages.some((value) => value.method === 'thread/start' || value.method === 'thread/fork'), false);
    await session.stop();
  }
});

test('native family snapshots preserve unloaded legacy members, actual per-turn changes and cumulative cache writes', async () => {
  const fake = harness((message) => {
    if (message.method !== 'thread/list') return undefined;
    const input = params(message);
    assert.equal(input.ancestorThreadId, rootId);
    assert.equal(input.modelProviders, undefined);
    assert.equal(input.cwd, undefined);
    assert.ok(/** @type {string[]} */ (input.sourceKinds).includes('subAgentThreadSpawn'));
    if (input.archived) return { data: [fake.nativeThreads.get('historic')], nextCursor: null };
    if (!input.cursor) return { data: [fake.nativeThreads.get('child')], nextCursor: 'next' };
    return { data: [fake.nativeThreads.get('grandchild')], nextCursor: null };
  });
  fake.nativeThreads.set(rootId, thread(rootId, null, 'root-turn'));
  fake.nativeFiles.set(rootPath, records(rootId, { turnId: 'root-turn', total: 100, final: 'ready' }));
  for (const [id, parent] of [['child', rootId], ['grandchild', 'child'], ['historic', rootId]]) {
    fake.nativeThreads.set(id, thread(id, parent, `${id}-turn`));
    fake.nativeFiles.set(`/native/${id}.jsonl`, records(id, { parent, turnId: `${id}-turn`, effort: 'medium', total: 60 }));
  }
  const historicalRecords = String(fake.nativeFiles.get('/native/historic.jsonl')).trim().split('\n').map((line) => JSON.parse(line));
  delete historicalRecords[0].payload.model_provider;
  fake.nativeFiles.set('/native/historic.jsonl', historicalRecords.map((record) => JSON.stringify(record)).join('\n') + '\n');
  fake.nativeThreads.set('historic', { ...thread('historic', rootId, 'historic-turn', 'inProgress'), historyMode: 'legacy', status: { type: 'notLoaded' } });
  fake.nativeThreads.set('child', { ...thread('child', rootId, 'child-turn'), parentThreadId: null, source: 'unknown' });
  const changed = JSON.parse(records('child', { parent: rootId, turnId: 'child-turn', effort: 'ultra', model: 'different-model' }).split('\n')[1]);
  fake.nativeFiles.set('/native/child.jsonl', fake.nativeFiles.get('/native/child.jsonl') + JSON.stringify(changed) + '\n' + responseRecord('child', 'own-response', 60));
  const ownRecords = String(fake.nativeFiles.get('/native/child.jsonl')).trim().split('\n').map((line) => JSON.parse(line));
  const inherited = (records(rootId, { turnId: 'inherited-turn', effort: 'max', model: 'inherited-model', total: 9000, final: 'inherited-result' }) + responseRecord(rootId, 'inherited-response', 9000))
    .trim().split('\n').map((line) => JSON.parse(line)).slice(1);
  const historyStart = inherited.length + 1;
  ownRecords[0].payload.subagent_history_start_ordinal = historyStart;
  fake.nativeFiles.set('/native/child.jsonl', [ownRecords[0], ...inherited, ...ownRecords.slice(1)]
    .map((record, ordinal) => JSON.stringify({ ...record, ordinal })).join('\n') + '\n');
  const session = await fake.open();
  await session.resume({ threadId: rootId, expectedSessionPath: rootPath, instructions: '完整共同角色规则' });
  const snapshot = await session.snapshot({ rootThreadId: rootId });
  assert.equal(snapshot.factsComplete, true);
  assert.equal(snapshot.members.length, 4);
  assert.equal(snapshot.members.find((value) => value.threadId === 'historic')?.state, 'idle');
  assert.equal(params(fake.messages.find((value) => value.method === 'thread/read' && params(value).threadId === 'historic') ?? {}).includeTurns, true);
  const child = snapshot.members.find((value) => value.threadId === 'child');
  assert.ok(child);
  assert.deepEqual(child.contexts.map((value) => value.reasoningEffort), ['medium', 'ultra']);
  assert.deepEqual(child.contexts.map((value) => value.model), [settings.model, 'different-model']);
  assert.ok(child.contexts[1].recordSequence > child.contexts[0].recordSequence);
  assert.equal(child.modelProvider, settings.modelProvider);
  assert.equal(child.parentThreadId, rootId);
  assert.equal(child.usage.cacheWriteInputTokens, 7);
  assert.equal(child.usage.totalTokens, 60);
  assert.equal(child.finalResponse, null);
  assert.equal(snapshot.members.find((value) => value.threadId === 'grandchild')?.parentThreadId, 'child');
  assert.equal('costUsd' in snapshot.members[0].usage, false);
  fake.emit({ method: 'thread/tokenUsage/updated', params: { threadId: 'child', turnId: 'child-turn', tokenUsage: { total: { inputTokens: 70, cachedInputTokens: 24, cacheWriteInputTokens: 14, outputTokens: 40, reasoningOutputTokens: 10, totalTokens: 110 } } } });
  const later = await session.snapshot({ rootThreadId: rootId, knownThreadIds: ['historic'] });
  assert.equal(later.members.find((value) => value.threadId === 'child')?.usage.totalTokens, null);
  assert.equal(later.members.find((value) => value.threadId === 'child')?.usage.cacheWriteInputTokens, null);
  const childRecords = String(fake.nativeFiles.get('/native/child.jsonl'));
  const nextOrdinal = childRecords.trim().split('\n').length;
  fake.nativeFiles.set('/native/child.jsonl', childRecords
    + JSON.stringify({ ...JSON.parse(responseRecord('child', 'later-response', 50)), ordinal: nextOrdinal }) + '\n'
    + JSON.stringify({ ordinal: nextOrdinal + 1, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: {
      input_tokens: 70, cached_input_tokens: 24, cache_write_input_tokens: 14,
      output_tokens: 40, reasoning_output_tokens: 10, total_tokens: 110,
    } } } }) + '\n');
  const caughtUp = await session.snapshot({ rootThreadId: rootId });
  assert.equal(caughtUp.members.find((value) => value.threadId === 'child')?.usage.totalTokens, 110);
  assert.equal(caughtUp.members.find((value) => value.threadId === 'child')?.usage.cacheWriteInputTokens, 14);
  assert.equal(later.members.length, 4);
  await session.stop();
});

test('resume replays unique ordinary and compaction responses without adding token-count totals', async () => {
  const fake = harness();
  fake.nativeThreads.set(rootId, thread(rootId, null, 'old-turn'));
  fake.nativeFiles.set(rootPath,
    records(rootId, { turnId: 'old-turn', total: 100, final: 'ready' })
    + responseRecord(rootId, 'ordinary-response', 100)
    + responseRecord(rootId, 'compaction-response', 40)
    + JSON.stringify({ type: 'compacted', payload: {} }) + '\n'
    + responseRecord(rootId, 'ordinary-response', 100));
  const session = await fake.open();
  await session.resume({ threadId: rootId, expectedSessionPath: rootPath, instructions: '完整角色规则' });
  const first = (await session.snapshot({ rootThreadId: rootId })).members[0];
  assert.equal(first.usage.totalTokens, 140);
  assert.equal(first.usage.inputTokens, 100);
  assert.equal(first.usage.outputTokens, 40);
  assert.equal(first.usage.cacheWriteInputTokens, 14);
  assert.equal((await session.snapshot({ rootThreadId: rootId })).members[0].usage.totalTokens, 140);
  fake.nativeFiles.set(rootPath, String(fake.nativeFiles.get(rootPath)) + JSON.stringify({
    type: 'token_usage_record', payload: { thread_id: rootId, response_id: 'later-response', usage: {
      input_tokens: 10, cached_input_tokens: 2, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 30,
    } },
  }) + '\n');
  const later = (await session.snapshot({ rootThreadId: rootId })).members[0];
  assert.equal(later.usage.totalTokens, 170);
  assert.equal(later.usage.cacheWriteInputTokens, null);
  fake.emit({ method: 'thread/tokenUsage/updated', params: { threadId: rootId, turnId: 'old-turn', tokenUsage: { total: {
    inputTokens: 90, cachedInputTokens: 14, cacheWriteInputTokens: 7,
    outputTokens: 40, reasoningOutputTokens: 10, totalTokens: 130,
  } } } });
  assert.equal((await session.snapshot({ rootThreadId: rootId })).members[0].usage.totalTokens, null);
  fake.nativeFiles.set(rootPath, String(fake.nativeFiles.get(rootPath)) + JSON.stringify({
    type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: {
      input_tokens: 90, cached_input_tokens: 14, cache_write_input_tokens: 7,
      output_tokens: 40, reasoning_output_tokens: 10, total_tokens: 130,
    } } },
  }) + '\n');
  const caughtUp = (await session.snapshot({ rootThreadId: rootId })).members[0];
  assert.equal(caughtUp.usage.totalTokens, 170);
  assert.equal(caughtUp.usage.cacheWriteInputTokens, null);
  await session.stop();
});

test('paginated snapshots read only the latest full turn and retain live turn identity ahead of stored pages', async () => {
  const fake = harness();
  const previous = { id: 'old-turn', status: 'completed', items: [{ type: 'agentMessage', phase: null, text: '旧回合回复' }] };
  const latest = { id: 'latest-turn', status: 'completed', items: [{ type: 'agentMessage', phase: null, text: 'ready' }] };
  fake.nativeThreads.set(rootId, { ...thread(rootId), historyMode: 'paginated', turns: [previous, latest] });
  fake.nativeFiles.set(rootPath, records(rootId, { turnId: 'old-turn', total: 80 }) + records(rootId, { turnId: 'latest-turn', total: 120 }).split('\n').slice(1).join('\n'));
  fake.nativeThreads.set('historic', { ...thread('historic', rootId, 'historic-turn', 'inProgress'), historyMode: 'paginated', status: { type: 'notLoaded' } });
  fake.nativeFiles.set('/native/historic.jsonl', records('historic', { parent: rootId, turnId: 'historic-turn', total: 60 }));
  const session = await fake.open();
  await session.resume({ threadId: rootId, expectedSessionPath: rootPath, instructions: '完整共同规则' });
  const baseline = await session.snapshot({ rootThreadId: rootId });
  assert.equal(baseline.factsComplete, true);
  const root = baseline.members.find((value) => value.threadId === rootId);
  assert.equal(root?.turnId, 'latest-turn');
  assert.equal(root?.finalResponse, 'ready');
  assert.equal(root?.usage.totalTokens, 120);
  assert.deepEqual(root?.contexts.map((value) => value.turnId), ['old-turn', 'latest-turn']);
  assert.equal(baseline.members.find((value) => value.threadId === 'historic')?.state, 'idle');
  assert.ok(fake.messages.filter((value) => value.method === 'thread/read').every((value) => params(value).includeTurns === false));
  assert.deepEqual(fake.messages.filter((value) => value.method === 'thread/turns/list').map(params).sort((left, right) => String(left.threadId).localeCompare(String(right.threadId))), [
    { threadId: 'historic', limit: 1, sortDirection: 'desc', itemsView: 'full' },
    { threadId: rootId, limit: 1, sortDirection: 'desc', itemsView: 'full' },
  ]);
  fake.nativeThreads.set(rootId, { ...fake.nativeThreads.get(rootId), status: { type: 'active' } });
  fake.nativeFiles.set(rootPath, fake.nativeFiles.get(rootPath) + records(rootId, { turnId: 'notified-turn', total: 140 }).split('\n').slice(1).join('\n'));
  fake.emit({ method: 'turn/started', params: { threadId: rootId, turn: { id: 'notified-turn', status: 'inProgress', items: [] } } });
  const running = await session.snapshot({ rootThreadId: rootId });
  const active = running.members.find((value) => value.threadId === rootId);
  assert.equal(running.factsComplete, true);
  assert.equal(active?.turnId, 'notified-turn');
  assert.equal(active?.state, 'active');
  assert.equal(active?.finalResponse, null);
  assert.equal(active?.usage.totalTokens, 140);
  fake.nativeThreads.set(rootId, { ...fake.nativeThreads.get(rootId), status: { type: 'idle' } });
  const final = { type: 'agentMessage', phase: null, text: 'incomplete - 缺少输入' };
  fake.emit({ method: 'turn/completed', params: { threadId: rootId, turn: { id: 'notified-turn', status: 'completed', items: [final] } } });
  let completed = (await session.snapshot({ rootThreadId: rootId })).members.find((value) => value.threadId === rootId);
  assert.equal(completed?.turnId, 'notified-turn');
  assert.equal(completed?.state, 'idle');
  assert.equal(completed?.finalResponse, final.text);
  fake.nativeThreads.set(rootId, { ...fake.nativeThreads.get(rootId), turns: [{ id: 'notified-turn', status: 'inProgress', items: [{ type: 'agentMessage', phase: null, text: '较早进度' }] }] });
  completed = (await session.snapshot({ rootThreadId: rootId })).members.find((value) => value.threadId === rootId);
  assert.equal(completed?.state, 'idle');
  assert.equal(completed?.finalResponse, final.text);
  assert.equal(fake.messages.some((value) => ['thread/items/list', 'thread/fork'].includes(String(value.method))), false);
  await session.stop();
});

test('unsupported pagination and non-full turn pages remain incomplete without exposing native error contents', async () => {
  for (const view of ['unsupported', 'notMaterialized', 'summary', 'notLoaded']) {
    const fake = harness((message) => {
      if (message.method !== 'thread/turns/list') return undefined;
      if (view === 'unsupported') throw Object.assign(new Error('private-provider-secret'), { code: -32601 });
      if (view === 'notMaterialized') throw Object.assign(new Error('private-provider-secret'), { code: -32600 });
      return { data: [{ id: 'latest-turn', status: 'completed', itemsView: view, items: [{ type: 'agentMessage', phase: null, text: 'ready' }] }], nextCursor: null };
    });
    fake.nativeThreads.set(rootId, { ...thread(rootId), historyMode: 'paginated' });
    fake.nativeFiles.set(rootPath, records(rootId, { turnId: 'latest-turn', total: 120 }));
    const session = await fake.open();
    await session.resume({ threadId: rootId, expectedSessionPath: rootPath, instructions: '完整共同规则' });
    const snapshot = await session.snapshot({ rootThreadId: rootId });
    assert.equal(snapshot.factsComplete, false);
    assert.equal(snapshot.members[0].finalResponse, null);
    assert.equal(snapshot.members[0].usage.totalTokens, 120);
    const diagnostic = snapshot.unknownReasons.join(' ');
    assert.match(diagnostic, view === 'unsupported' ? /rejected thread\/turns\/list \(code -32601\)/
      : view === 'notMaterialized' ? /rejected thread\/turns\/list \(code -32600\)/ : /not fully loaded/);
    assert.equal(diagnostic.includes('private-provider-secret'), false);
    await assert.rejects(session.stop(), /membership is incomplete/);
  }
});

test('native permissions reject a present malformed policy instead of using a permissive profile', async () => {
  const fake = harness();
  fake.nativeThreads.set(rootId, thread(rootId, null, 'turn'));
  const session = await fake.open();
  await session.resume({threadId: rootId, expectedSessionPath: rootPath, instructions: '完整角色规则'});
  const permissionProfile = {type: 'managed', file_system: {type: 'restricted', entries: [
    {path: {type: 'special', value: {kind: 'root'}}, access: 'write'},
  ]}};
  for (const policy of [undefined, {}, null, [], 42, {kind: 'unknown', entries: []}, {kind: 'restricted', entries: null}]) {
    const contents = records(rootId, {turnId: 'turn', permissionProfile}).trim().split('\n').map(line => {
      const record = JSON.parse(line);
      if (record.type === 'turn_context' && policy !== undefined) record.payload.file_system_sandbox_policy = policy;
      return JSON.stringify(record);
    }).join('\n') + '\n';
    fake.nativeFiles.set(rootPath, contents);
    const context = (await session.snapshot({rootThreadId: rootId})).members[0].contexts[0];
    assert.deepEqual(context.permissionsRules, policy === undefined ? [{path: '/', access: 'write'}] : null);
    assert.deepEqual(context.unknownReasons, policy === undefined ? [] : ['Native filesystem permissions could not be interpreted.']);
  }
  await session.stop();
});

test('native permissions use current path entries without legacy workspace fields', async () => {
  const fake = harness();
  fake.nativeThreads.set(rootId, thread(rootId, null, 'turn'));
  const session = await fake.open();
  await session.resume({ threadId: rootId, expectedSessionPath: rootPath, instructions: '完整角色规则' });
  const symbolicPolicy = {kind: 'restricted', entries: [
    {path: {type: 'special', value: {kind: 'workspace_roots'}}, access: 'read'},
  ]};
  for (const observation of [
    {input: {turnId: 'turn'}, expected: [
      {path: '/', access: 'deny'}, {path: ':minimal', access: 'read'},
      {path: cwd, access: 'read'}, {path: `${cwd}/.tmp/reports`, access: 'write'},
    ]},
    {input: {turnId: 'turn', permissionProfile: {type: 'managed', file_system: {type: 'restricted', entries: [
      {path: {type: 'path', path: cwd}, access: 'read'},
      {path: {type: 'path', path: `${cwd}/.tmp/reports`}, access: 'write'},
      {path: {type: 'special', value: {kind: 'root'}}, access: 'read'},
    ]}}}, expected: [{path: cwd, access: 'read'}, {path: `${cwd}/.tmp/reports`, access: 'write'}, {path: '/', access: 'read'}]},
    {input: {turnId: 'turn', policy: symbolicPolicy}, legacyWorkspaceRoots: [cwd], expected: null},
    {input: {turnId: 'turn', policy: {type: 'restricted', entries: []}}, expected: null},
    {input: {turnId: 'turn', permissionProfile: {type: 'managed', file_system: {kind: 'restricted', entries: []}}}, expected: null},
  ]) {
    let contents = records(rootId, observation.input);
    if (observation.legacyWorkspaceRoots) {
      contents = contents.trim().split('\n').map(line => {
        const record = JSON.parse(line);
        if (record.type === 'turn_context') record.payload.workspace_roots = observation.legacyWorkspaceRoots;
        return JSON.stringify(record);
      }).join('\n') + '\n';
    }
    fake.nativeFiles.set(rootPath, contents);
    const snapshot = await session.snapshot({rootThreadId: rootId});
    const context = snapshot.members[0].contexts[0];
    assert.deepEqual(context.permissionsRules, observation.expected);
    assert.deepEqual(context.unknownReasons, observation.expected === null
      ? ['Native filesystem permissions could not be interpreted.'] : []);
    assert.equal(Object.hasOwn(context, 'workspaceRoots'), false);
  }
  await session.stop();
});

test('native permissions remain unknown and optional effort stays observable', async () => {
  const fake = harness();
  fake.nativeThreads.set(rootId, thread(rootId, null, 'turn'));
  fake.nativeFiles.set(rootPath, records(rootId, { turnId: 'turn', effort: null, policy: { kind: 'unknown' } }));
  const session = await fake.open();
  await session.resume({ threadId: rootId, expectedSessionPath: rootPath, instructions: '完整角色规则' });
  const snapshot = await session.snapshot({ rootThreadId: rootId });
  assert.equal(snapshot.factsComplete, true);
  assert.equal(snapshot.members[0].contexts[0].reasoningEffort, null);
  assert.equal(snapshot.members[0].contexts[0].permissionsRules, null);
  assert.equal(snapshot.members[0].usage.totalTokens, null);
  await session.stop();
});

test('notifications expose pending native requests and exact responses without auto approval', async () => {
  const fake = harness();
  const session = await fake.open();
  await session.start({ instructions: '完整角色规则' });
  await session.startTurn({ threadId: rootId, handoff: '完整输入' });
  fake.emit({ id: 'question-id', method: 'item/tool/requestUserInput', params: { threadId: rootId, turnId: 'new-turn', questions: [{ question: 'private question body' }] } });
  assert.equal(fake.notifications.at(-1)?.type, 'changed');
  assert.equal(fake.messages.some((value) => value.id === 'question-id'), false);
  const snapshot = await session.snapshot({ rootThreadId: rootId });
  assert.deepEqual(snapshot.clientRequests, [{ requestId: 'question-id', kind: 'user-input', method: 'item/tool/requestUserInput', params: {threadId: rootId, turnId: 'new-turn', questions: [{question: 'private question body'}]}, threadId: rootId, turnId: 'new-turn' }]);
  await session.respond({requestId: 'question-id', response: {answers: {question: {answers: ['answer']}}}});
  assert.deepEqual(fake.messages.find(value => value.id === 'question-id')?.result, {answers: {question: {answers: ['answer']}}});
  assert.equal((await session.snapshot({rootThreadId: rootId})).clientRequests.length, 0);
  await assert.rejects(session.respond({requestId: 'question-id', response: {}}), /no longer pending/);
  const notification = Buffer.from(JSON.stringify({ method: 'item/completed', params: { threadId: rootId, turnId: 'new-turn', item: { type: 'agentMessage', phase: 'final_answer', text: 'ready - 报告已交付' } } }) + '\n');
  const split = notification.indexOf(Buffer.from('报告')) + 1;
  fake.child.stdout.write(notification.subarray(0, split));
  fake.child.stdout.write(notification.subarray(split));
  assert.equal((await session.snapshot({ rootThreadId: rootId })).members[0].finalResponse, 'ready - 报告已交付');
  await session.stop();
});

test('a native request can be declined with its reason without interrupting the active turn', async () => {
  const fake = harness();
  const session = await fake.open();
  await session.start({instructions: '完整角色规则'});
  await session.startTurn({threadId: rootId, handoff: '完整输入'});
  fake.emit({id: 42, method: 'item/tool/requestUserInput', params: {threadId: rootId, turnId: 'new-turn', questions: []}});
  await assert.rejects(session.rejectRequest({requestId: '42', reason: ''}), /nonempty text/);
  assert.equal((await session.snapshot({rootThreadId: rootId})).clientRequests.length, 1);
  const reason = 'Reviewer cannot request an answer from the user. Continue with available evidence.';
  await session.rejectRequest({requestId: '42', reason});
  assert.deepEqual(fake.messages.find(message => message.id === 42)?.error, {code: -32000, message: reason});
  assert.equal((await session.snapshot({rootThreadId: rootId})).clientRequests.length, 0);
  await session.steer({threadId: rootId, turnId: 'new-turn', instruction: reason});
  const steering = fake.messages.find(message => message.method === 'turn/steer');
  assert.equal(params(steering ?? {}).expectedTurnId, 'new-turn');
  const steeringInput = /** @type {Record<string, unknown>[]} */ (params(steering ?? {}).input);
  assert.equal(steeringInput[0]?.text, reason);
  assert.equal(fake.messages.some(message => message.method === 'turn/interrupt'), false);
  await session.stop();
});

test('legacy approval is routed only when its conversationId matches the owned root Thread.id', async () => {
  const fake=harness();
  const session=await fake.open();
  await session.start({instructions:'rules'});
  fake.emit({id:'legacy-approval',method:'execCommandApproval',params:{conversationId:rootId,callId:'tool-call',command:'read-only'}});
  const pending=(await session.snapshot({rootThreadId:rootId})).clientRequests;
  assert.equal(pending.length,1);
  assert.equal(pending[0].threadId,rootId);
  assert.equal(pending[0].turnId,null);
  const reason='Reviewer declined the manual approval.';
  await session.respond({requestId:'legacy-approval',response:{decision:{denied:{rejection:reason}}}});
  assert.deepEqual(fake.messages.find(message=>message.id==='legacy-approval')?.result,{decision:{denied:{rejection:reason}}});
  assert.equal((await session.snapshot({rootThreadId:rootId})).clientRequests.length,0);
  await session.stop();
});

test('safe idle requires complete native members, no pending request and no background terminal', async () => {
  const fake = harness();
  const session = await fake.open();
  await session.start({instructions: 'rules'});
  assert.deepEqual(await session.idleFacts({rootThreadId: rootId}), {safe: true, known: true, reason: null});
  fake.backgroundTerminals.set(rootId, [{processId: 'terminal-1', itemId: 'tool-1', command: 'task', cwd}]);
  assert.equal((await session.idleFacts({rootThreadId: rootId})).safe, false);
  fake.backgroundTerminals.delete(rootId);
  fake.emit({id: 42, method: 'item/commandExecution/requestApproval', params: {threadId: rootId}});
  assert.equal((await session.idleFacts({rootThreadId: rootId})).safe, false);
  await session.respond({requestId: '42', response: {decision: 'decline'}});
  assert.equal(/** @type {Record<string, unknown>} */ (fake.messages.find(message => message.id === 42)?.result).decision, 'decline');
  await session.stop();
});

test('completed Reviewer terminal cleanup confirms every target exit and leaves another root intact', async () => {
  let refuseTermination=true;
  /** @type {ReturnType<typeof harness>} */ let fake;
  fake=harness(message=>{
    if(message.method==='thread/backgroundTerminals/terminate' && refuseTermination)return {terminated:false};
    if(message.method==='turn/start'){
      fake.nativeThreads.set(rootId,thread(rootId,null,'new-turn','completed'));
      fake.nativeFiles.set(rootPath,records(rootId,{turnId:'new-turn',final:'{"status":"ready"}'}));
      fake.emit({method:'turn/completed',params:{threadId:rootId,turn:{id:'new-turn',status:'completed',items:[]}}});
      return {turn:{id:'new-turn',status:'inProgress',items:[]}};
    }
    return undefined;
  },async()=>{},20);
  const reviewer=await fake.open('reviewer-run');
  const generic=await fake.open('generic-run');
  await reviewer.start({instructions:'Reviewer rules'});
  await generic.start({instructions:'Generic task'});
  await reviewer.startTurn({threadId:rootId,handoff:'Complete the review.'});
  fake.backgroundTerminals.set(rootId,[
    {processId:'701',itemId:'review-tool-1',command:'notify',cwd},
    {processId:'702',itemId:'review-tool-2',command:'other',cwd},
  ]);
  fake.backgroundTerminals.set('second-root',[
    {processId:'703',itemId:'generic-tool',command:'generic',cwd:'/other-scene'},
  ]);
  await assert.rejects(reviewer.cleanupTurnTerminals({rootThreadId:rootId,turnId:'new-turn'}));
  assert.equal((await reviewer.idleFacts({rootThreadId:rootId})).safe,false);
  refuseTermination=false;
  assert.deepEqual(await reviewer.cleanupTurnTerminals({rootThreadId:rootId,turnId:'new-turn'}),{confirmed:true});
  assert.equal(fake.backgroundTerminals.get(rootId)?.length,0);
  assert.equal(fake.backgroundTerminals.get('second-root')?.length,1);
  assert.equal((await reviewer.idleFacts({rootThreadId:rootId})).safe,true);
  assert.equal((await generic.idleFacts({rootThreadId:'second-root'})).safe,false);
  await reviewer.stop();
  fake.backgroundTerminals.delete('second-root');
  await generic.stop();
});

test('native records distinguish a new conversation from a thread with prior messages', async () => {
  const fake = harness();
  const session = await fake.open();
  await session.start({instructions: 'rules'});
  assert.equal((await session.snapshot({rootThreadId: rootId})).members[0].hasConversationHistory, false);
  fake.nativeFiles.set(rootPath, records(rootId) + JSON.stringify({type: 'response_item', payload: {type: 'message', role: 'user', content: [{type: 'input_text', text: 'prior'}]}}) + '\n');
  assert.equal((await session.snapshot({rootThreadId: rootId})).members[0].hasConversationHistory, true);
  await session.stop();
});

test('a native-created parentless thread with matching metadata and ENOENT record proves no inherited conversation before its first turn', async () => {
  const fake=harness();
  fake.nativeThreads.set(rootId,{...thread(rootId),historyMode:'paginated'});
  fake.nativeFiles.delete(rootPath);
  const session=await fake.open();
  await session.start({instructions:'rules'});
  const baseline=await session.snapshot({rootThreadId:rootId});
  assert.equal(baseline.factsComplete,true);
  assert.equal(baseline.members[0].hasConversationHistory,false);
  assert.equal(baseline.members[0].turnId,null);
  assert.equal(fake.messages.some(message=>message.method==='turn/start'),false);
  await session.stop();
});

test('missing creation evidence, inconsistent metadata, observed messages and non-ENOENT reads never prove an empty conversation', async () => {
  for(const kind of ['start-parent-missing','start-fork-missing','start-parent','start-fork','start-preview',
    'read-parent-missing','read-fork-missing','read-parent','read-fork','read-preview','read-path','read-source','read-turn',
    'observed-message','permission-denied','unknown-read-error','empty-file','resume']){
    const override=(/** @type {Record<string,unknown>} */ message)=>{
      if(!['thread/start','thread/read'].includes(String(message.method)))return undefined;
      const start=message.method==='thread/start';
      const own=start?kind.startsWith('start-'):kind.startsWith('read-');
      if(!own)return undefined;
      /** @type {Record<string,unknown>} */
      const value={...thread(rootId),historyMode:'paginated'};
      if(kind.endsWith('parent-missing'))delete value.parentThreadId;
      if(kind.endsWith('fork-missing'))delete value.forkedFromId;
      if(kind.endsWith('parent')&&!kind.endsWith('missing'))value.parentThreadId='inherited-thread';
      if(kind.endsWith('fork')&&!kind.endsWith('missing'))value.forkedFromId='inherited-thread';
      if(kind==='read-preview'||kind==='start-preview')value.preview='earlier user message';
      if(kind==='read-path')value.path='/native/other.jsonl';
      if(kind==='read-source')value.source='subAgent';
      if(kind==='read-turn')value.turns=[{id:'earlier-turn',status:'completed',items:[]}];
      return {thread:value};
    };
    const readFailure=async()=>{
      if(kind==='permission-denied')throw Object.assign(new Error('denied'),{code:'EACCES'});
      if(kind==='unknown-read-error')throw new Error('Unknown read failure.');
    };
    const fake=harness(override,readFailure);
    fake.nativeThreads.set(rootId,{...thread(rootId),historyMode:'paginated'});
    fake.nativeFiles.delete(rootPath);
    if(kind==='empty-file')fake.nativeFiles.set(rootPath,'');
    const session=await fake.open();
    if(kind==='resume')await session.resume({threadId:rootId,expectedSessionPath:rootPath,instructions:'rules'});
    else await session.start({instructions:'rules'});
    if(kind==='observed-message')fake.emit({method:'item/completed',params:{threadId:rootId,turnId:'prior-turn',
      item:{id:'prior-message',type:'agentMessage',phase:'commentary',text:'earlier assistant message'}}});
    const baseline=await session.snapshot({rootThreadId:rootId});
    assert.notEqual(baseline.members[0].hasConversationHistory,false,kind);
    assert.equal(baseline.factsComplete,false,kind);
    await session.stop();
  }
});

test('native snapshot exposes persisted user instruction identity and ordinal for private delivery reconciliation', async () => {
  const fake = harness();
  const session = await fake.open();
  await session.start({instructions:'rules'});
  await session.startTurn({threadId:rootId,handoff:'inspect this change'});
  fake.nativeFiles.set(rootPath, records(rootId,{turnId:'new-turn'})
    + JSON.stringify({type:'response_item',payload:{type:'message',id:'native-user-item',role:'user',turn_id:'new-turn',content:[{type:'input_text',text:'inspect this change'}]}}) + '\n');
  const facts = await session.snapshot({rootThreadId:rootId});
  assert.deepEqual(facts.userMessages,[{itemId:'native-user-item',threadId:rootId,turnId:'new-turn',text:'inspect this change',recordSequence:3}]);
  await session.stop();
});



test('a model without message phases only exposes its last message after native turn completion', async () => {
  const fake = harness();
  const session = await fake.open();
  await session.start({ instructions: '同一完整角色规则' });
  await session.startTurn({ threadId: rootId, handoff: '完整输入' });
  fake.emit({ method: 'item/completed', params: { threadId: rootId, turnId: 'new-turn', item: { id: 'progress', type: 'agentMessage', phase: null, text: '检查进度' } } });
  assert.equal((await session.snapshot({ rootThreadId: rootId })).members[0].finalResponse, null);
  const final = { id: 'final', type: 'agentMessage', phase: null, text: '{"status":"ready"}' };
  fake.nativeThreads.set(rootId, { ...thread(rootId, null, 'new-turn'), turns: [{ id: 'new-turn', status: 'completed', items: [final] }] });
  fake.emit({ method: 'turn/completed', params: { threadId: rootId, turn: { id: 'new-turn', status: 'completed', items: [final] } } });
  const completed = await session.snapshot({ rootThreadId: rootId });
  assert.equal(completed.members[0].turnId, 'new-turn');
  assert.equal(completed.members[0].state, 'idle');
  assert.equal(completed.members[0].finalResponse, '{"status":"ready"}');
  await session.stop();
});

test('interrupt targets the actual active group while stop observes exit and retains final recorded usage', async () => {
  const fake = harness();
  const session = await fake.open();
  await session.start({ instructions: '完整角色规则' });
  await session.startTurn({ threadId: rootId, handoff: '完整输入' });
  fake.nativeThreads.set('child', thread('child', rootId, 'child-turn', 'inProgress'));
  fake.nativeFiles.set('/native/child.jsonl', records('child', { parent: rootId, turnId: 'child-turn', total: 50 }));
  fake.nativeThreads.set('idle', thread('idle', rootId, 'idle-turn'));
  fake.nativeFiles.set('/native/idle.jsonl', records('idle', { parent: rootId, turnId: 'idle-turn', total: 40 }));
  assert.deepEqual(await session.interruptGroup({ rootThreadId: rootId, turnId: 'new-turn' }), { accepted: true });
  assert.deepEqual(fake.messages.filter((value) => value.method === 'turn/interrupt').map((value) => params(value).threadId).sort(), ['child', rootId].sort());
  assert.equal((await session.snapshot({ rootThreadId: rootId })).environmentState, 'running');
  await assert.rejects(session.interruptGroup({ rootThreadId: rootId, turnId: 'wrong-turn' }), /turn changed/);
  await session.stop();
  const callsAtExit = fake.messages.length;
  fake.nativeFiles.set(rootPath, records(rootId, { turnId: 'new-turn', total: 120 }));
  const stopped = await session.snapshot({ rootThreadId: rootId });
  assert.equal(stopped.environmentState, 'exited');
  assert.ok(stopped.members.every((value) => value.state === 'exited'));
  assert.equal(stopped.members.find((value) => value.threadId === rootId)?.usage.totalTokens, 120);
  assert.equal(fake.messages.length, callsAtExit);
  assert.equal(fake.messages.some((value) => ['thread/archive', 'thread/delete', 'thread/fork'].includes(String(value.method))), false);
});

test('invalid records, identity mismatch and missing members block native completeness without fabricated values', async () => {
  const fake = harness();
  const session = await fake.open();
  await session.start({ instructions: '完整角色规则' });
  await session.startTurn({ threadId: rootId, handoff: '完整输入' });
  fake.nativeFiles.set(rootPath, records(rootId, { turnId: 'new-turn' }) + '{');
  const partial = await session.snapshot({ rootThreadId: rootId });
  assert.equal(partial.factsComplete, false);
  assert.match(partial.unknownReasons.join(' '), /incomplete or invalid/);
  fake.nativeFiles.set(rootPath, records('other-identity', { turnId: 'new-turn', total: 400 }));
  const mismatch = await session.snapshot({ rootThreadId: rootId, knownThreadIds: ['missing-child'] });
  assert.equal(mismatch.factsComplete, false);
  assert.equal(mismatch.members.length, 2);
  assert.ok(mismatch.members.every((value) => value.usage.totalTokens === null));
  assert.equal(mismatch.members.find((value) => value.threadId === rootId)?.contexts.length, 0);
  fake.nativeFiles.set(rootPath, records(rootId, { turnId: 'new-turn' })
    + responseRecord(rootId, 'same-response', 100) + responseRecord(rootId, 'same-response', 120));
  const conflict = await session.snapshot({ rootThreadId: rootId });
  assert.equal(conflict.factsComplete, false);
  assert.match(conflict.unknownReasons.join(' '), /response usage records conflict/);
  assert.equal(conflict.members.find((value) => value.threadId === rootId)?.usage.totalTokens, null);
  await assert.rejects(session.stop(), /membership is incomplete/);
});

test('native errors are bounded diagnostics and invalid settings never spawn a process', async () => {
  const fake = harness((message) => { if (message.method === 'turn/steer') throw new Error('private-provider-secret'); return undefined; });
  const session = await fake.open();
  await session.start({ instructions: '完整角色规则' });
  await assert.rejects(session.steer({ threadId: rootId, turnId: 'old-turn', instruction: '补充指示' }), (error) => error instanceof Error && !error.message.includes('private-provider-secret') && error.message.includes('rejected turn/steer (code -32000)'));
  await session.stop();
  const invalid = harness();
  await assert.rejects(invalid.factory.open({ settings: { ...settings, config: { model_providers: { custom: { api_key: 'private-provider-secret' } } } }, cwd, readPaths: [], writePaths: [], onNotification() {} }), /environment key reference/);
  assert.equal(invalid.spawnCount, 0);
});

test('failed initialization cleans up the spawned environment and malformed protocol signals failure', async () => {
  const initial = harness((message) => { if (message.method === 'initialize') throw new Error('private-provider-secret'); return undefined; });
  let initialExited = false;
  initial.child.once('close', () => { initialExited = true; });
  await assert.rejects(initial.open(), /rejected/);
  assert.equal(initialExited, true);
  assert.deepEqual(initial.catalogEvents,['prepare','spawn','remove']);
  const fake = harness();
  const session = await fake.open();
  await session.start({ instructions: '完整角色规则' });
  fake.child.stdout.write('{invalid\n');
  assert.equal(fake.notifications.at(-1)?.type, 'changed');
  const broken = await session.snapshot({ rootThreadId: rootId });
  assert.equal(broken.factsComplete, false);
  assert.match(broken.unknownReasons.join(' '), /Invalid Codex App Server JSON/);
  await assert.rejects(session.stop(), /membership is incomplete/);
  const stopped = await session.snapshot({ rootThreadId: rootId });
  assert.equal(stopped.environmentState, 'running');
  assert.equal(stopped.factsComplete, false);
  assert.match(stopped.unknownReasons.join(' '), /Native member discovery failed/);
});

test('native output stream failures reject initialization and retain bounded recovery facts', async () => {
  for (const [stream, reason] of /** @type {Array<['stdout' | 'stderr', string]>} */ ([['stdout', 'output'], ['stderr', 'diagnostics']])) {
    const fake = harness();
    let exited = false;
    fake.child.once('close', () => { exited = true; });
    const opening = fake.open();
    while(fake.spawnCount===0)await Promise.resolve();
    fake.child[stream].emit('error', new Error('private-provider-secret'));
    await assert.rejects(opening, (error) => error instanceof Error
      && error.message.includes(`Codex App Server ${reason} failed.`)
      && !error.message.includes('private-provider-secret'));
    assert.equal(exited, true);
  }

  const fake = harness();
  const session = await fake.open();
  await session.start({ instructions: '完整角色规则' });
  fake.child.stdout.emit('error', new Error('private-provider-secret'));
  const failed = await session.snapshot({ rootThreadId: rootId });
  assert.equal(failed.factsComplete, false);
  assert.match(failed.unknownReasons.join(' '), /Codex App Server output failed/);
  assert.equal(JSON.stringify(failed).includes('private-provider-secret'), false);
  await assert.rejects(session.stop(), /membership is incomplete/);
  assert.equal((await session.snapshot({ rootThreadId: rootId })).environmentState, 'running');
});
