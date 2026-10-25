import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBackgroundAgentManager} from '../../lib/background-agent/manager.mjs';
import {createStrataWorkPolicy,initialStrataWorkState} from '../../lib/background-agent/strata-work-policy.mjs';
import {createReviewerMeasurement,observeReviewerMeasurement,reviewerMeasurementResult} from '../../lib/reviewer-runtime/reviewer-measurement.mjs';
import {createBackgroundAgentStateStore} from '../../lib/background-agent/state-store.mjs';

const settings={model:'test',modelProvider:'test',reasoningEffort:'high',serviceTier:null,config:{}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
/** @param {ReturnType<typeof createBackgroundAgentStateStore>} store @param {string} messageId */
async function waitDelivered(store,messageId){
  for(let attempt=0;attempt<50 && store.getMessage(messageId)?.deliveryStatus!=='delivered';attempt++)
    await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(store.getMessage(messageId)?.deliveryStatus,'delivered');
}
/** @param {ReturnType<typeof createBackgroundAgentStateStore>} store @param {string} messageId
 * @param {'failed'|'unknown'} expected */
async function waitFailedDelivery(store,messageId,expected){
  for(let attempt=0;attempt<50 && store.getMessage(messageId)?.deliveryStatus!==expected;attempt++)
    await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(store.getMessage(messageId)?.deliveryStatus,expected);
}
/** @param {import('../../lib/background-agent/machine.mjs').RuntimeResult} reply */
const result=reply=>{assert.equal(reply.status,'succeeded');return /** @type {Record<string,any>} */(reply.result);};

/** @param {{blockedStart?:boolean,unsafeIdle?:boolean,failStart?:boolean,incompleteFacts?:boolean,failTurn?:boolean}} [options] */
function nativeHarness({blockedStart=false,unsafeIdle=false,failStart=false,incompleteFacts=false,failTurn=false}={}){
  let openCount=0,closeCount=0,rootStops=0,startCount=0,serverStarts=0;
  let serverRunning=false,serverExited=false;
  /** @type {string[]} */
  const resumedThreads=[];
  /** @type {string[]} */
  const turnInputs=[];
  /** @type {import('../../lib/background-agent/codex-app-server.mjs').NativeSettings[]} */
  const openedSettings=[];
  /** @type {Array<import('../../lib/background-agent/codex-app-server.mjs').NativeProviderConnection|undefined>} */
  const openedProviderConnections=[];
  /** @type {(() => void)|null} */
  let releaseStart=null;
  const startGate=blockedStart?new Promise(resolve=>{releaseStart=()=>resolve(undefined);}):Promise.resolve();
  /** @type {Map<string,{id:string,ended:boolean,active:boolean,turnId:string|null,turnCount:number,onNotification:(notification:import('../../lib/background-agent/codex-app-server.mjs').NativeNotification)=>void}>} */
  const roots=new Map();
  const nativeSessions=/** @type {import('../../lib/background-agent/codex-app-server.mjs').NativeSessions} */ ({
    async ensureServer({onPreviousExit}={}){
      if(serverExited){
        if(!onPreviousExit)throw new Error('Earlier App Server exit requires provider recovery before restart.');
        await onPreviousExit();serverExited=false;
      }
      if(!serverRunning){serverRunning=true;serverStarts++;}
    },
    async observeServer(){return serverExited?'ended':serverRunning?'running':'absent';},
    async open({runId,onNotification,settings:actualSettings,providerConnection}){
      await nativeSessions.ensureServer();
      openCount++;
      openedSettings.push(actualSettings);
      openedProviderConnections.push(providerConnection);
      const item={id:`thread-${openCount}`,ended:false,active:false,turnId:/** @type {string|null} */(null),turnCount:0,onNotification};
      roots.set(/** @type {string} */(runId),item);
      const member=()=>({threadId:item.id,parentThreadId:null,state:item.ended?'exited':item.active?'active':'idle',
        turnId:item.turnId,sessionPath:`/native/${item.id}.jsonl`,modelProvider:'test',
        contexts:[],usage:{inputTokens:0,cachedInputTokens:0,cacheWriteInputTokens:0,outputTokens:0,
          reasoningOutputTokens:0,totalTokens:0},finalResponse:null,hasConversationHistory:true});
      return {
        async start(){await startGate;startCount++;if(failStart)throw new Error('Native root creation rejected.');
          return{threadId:item.id,sessionPath:`/native/${item.id}.jsonl`};},
        async resume({threadId}){resumedThreads.push(threadId);item.id=threadId;return{threadId,sessionPath:`/native/${threadId}.jsonl`};},
        async startTurn({handoff}){turnInputs.push(handoff);if(failTurn)throw new Error('Native reply was lost.');
          item.active=true;item.turnCount++;item.turnId=item.turnCount===1?'turn':`turn-${item.turnCount}`;return{turnId:item.turnId};},
        async steer({turnId}){return{turnId};},
        async snapshot(){return{rootThreadId:item.id,environmentState:item.ended?'exited':'running',
          members:[member()],factsComplete:!incompleteFacts,unknownReasons:incompleteFacts?['member discovery incomplete']:[],
          clientRequests:[],publicMessages:[],userMessages:[]};},
        async respond(){return{accepted:true};},
        async rejectRequest(){return{accepted:true};},
        async readThreadMetadata({threadId}){return{title:null,preview:'',sessionPath:`/native/${threadId}.jsonl`};},
        async idleFacts(){return{safe:!unsafeIdle,known:!unsafeIdle,reason:unsafeIdle?'active tool':null};},
        async cleanupTurnTerminals(){throw new Error('The fake native session has no background terminals.');},
        async interruptGroup(){return{accepted:true};},
        async stop(){rootStops++;item.ended=true;return{environmentState:'exited'};},
      };
    },
    async close(){closeCount++;serverRunning=false;serverExited=false;return{environmentState:'exited'};},
  });
  return {nativeSessions,openedSettings,openedProviderConnections,resumedThreads,turnInputs,releaseStart:()=>releaseStart?.(),
    get openCount(){return openCount;},get closeCount(){return closeCount;},get rootStops(){return rootStops;},get startCount(){return startCount;},
    get serverStarts(){return serverStarts;},
    exitServer(){serverRunning=false;serverExited=true;for(const item of roots.values())if(!item.ended)item.onNotification({type:'exited',reason:null});},
    /** @param {string} runId */
    finish(runId){const item=roots.get(runId);assert.ok(item);item.active=false;
      item.onNotification({type:'changed',threadId:item.id,turnId:null});},
  };
}

/** @param {import('node:test').TestContext} t
 * @param {{blockedStart?:boolean,unsafeIdle?:boolean,failStart?:boolean,incompleteFacts?:boolean,failTurn?:boolean,maxInstances?:number,
 * providers?:Record<string,import('../../lib/background-agent/model-catalog.mjs').ProviderConfiguration>,
 * createStrataDriver?:typeof import('../../lib/background-agent/strata-driver.mjs').createStrataDriver}} [options] */
async function harness(t,options={}){
  const directory=await mkdtemp(join(tmpdir(),'arw-manager-'));
  /** @type {Set<{handler:()=>void,delay:number,unref:()=>void}>} */
  const timers=new Set();
  const clock=/** @type {{now:()=>number,setTimeout:typeof setTimeout,clearTimeout:typeof clearTimeout}} */ (
    /** @type {unknown} */ ({now:()=>1000,setTimeout:/** @param {()=>void} handler @param {number} delay */ (handler,delay)=>{
      const timer={handler,delay,unref(){}};timers.add(timer);return timer;},
    clearTimeout:/** @param {{handler:()=>void,delay:number,unref:()=>void}} timer */timer=>{timers.delete(timer);}}));
  const native=nativeHarness(options);
  const stateStore=createBackgroundAgentStateStore({runtimeDirectory:directory,clock});
  const manager=await createBackgroundAgentManager({nativeSessions:native.nativeSessions,maxInstances:options.maxInstances??2,
    stateStore,clock,modelCatalog:options.providers?{getProviders:async()=>options.providers??{}}:undefined,
    createStrataDriver:options.createStrataDriver});
  t.after(async()=>{try{await manager.close();}finally{await rm(directory,{recursive:true,force:true});}});
  const start=(ownerId='main-1',runSettings=settings)=>manager.execute({ownerId,controllerId:ownerId,operation:'spawn_agent',input:{
    role:'generic',settings:runSettings,cwd:directory,stateDirectory:directory,readPaths:[],writePaths:[],
    instructions:'instructions',handoff:'initial work',
  }});
  /** @param {string} runId @param {string} operation @param {Record<string,unknown>} [input] @param {string} [ownerId] */
  const execute=(runId,operation,input={},ownerId='main-1')=>
    manager.execute({ownerId,controllerId:ownerId,operation,input:{runId,...input}});
  return {manager,native,stateStore,clock,start,execute,directory,
    /** @param {number} delay */ fireTimeout(delay){const timer=[...timers].find(item=>item.delay===delay);
      assert.ok(timer);timers.delete(timer);timer.handler();}};
}

function strataService(){
  /** @type {string|null} */ let heldKey=null;
  /** @type {string|null} */ let model=null;
  let acquireCount=0,releaseCount=0;
  let connectCount=0,statusFailures=0,releaseFailures=0;
  /** @type {(()=>void)|null} */ let afterAcquire=null;
  /** @type {string[]} */ const starts=[];
  /** @type {string[]} */ const statusUrls=[];
  /** @type {string[]} */ const releaseUrls=[];
  const createStrataDriver=/** @type {typeof import('../../lib/background-agent/strata-driver.mjs').createStrataDriver} */ (
    /** @type {unknown} */ ((/** @type {{installationDirectory:string}} */ {installationDirectory})=>({
      async connect(){connectCount++;return{controllerUrl:`http://controller/${installationDirectory.length}`,responsesUrl:'http://responses/v1'};},
      async acquire(){if(heldKey)throw new Error('Strata acquire rejected (HTTP 409): Ownership is held.');
        heldKey=`key-${++acquireCount}`;afterAcquire?.();return{leaseKey:heldKey};},
      async status(/** @type {{leaseKey:string,controllerUrl:string}} */ {leaseKey,controllerUrl}){
        statusUrls.push(controllerUrl);
        if(statusFailures>0){statusFailures--;throw new Error('Original controller status could not be verified.');}
        if(leaseKey!==heldKey)throw new Error('Strata ownership key changed.');
        return{status:model?'running':'stopped',model};},
      async start(/** @type {{leaseKey:string,modelId:string}} */ {leaseKey,modelId}){if(leaseKey!==heldKey)throw new Error('Strata ownership key changed.');
        model=modelId;starts.push(modelId);return{status:'running',model:modelId};},
      async stop(/** @type {{leaseKey:string}} */ {leaseKey}){if(leaseKey!==heldKey)throw new Error('Strata ownership key changed.');
        model=null;return{status:'stopped',cleanUnload:true};},
      async release(/** @type {{leaseKey:string,controllerUrl:string}} */ {leaseKey,controllerUrl}){
        releaseUrls.push(controllerUrl);
        if(releaseFailures>0){releaseFailures--;throw new Error('Original controller release could not be verified.');}
        if(leaseKey!==heldKey)throw new Error('Strata ownership key changed.');
        heldKey=null;model=null;releaseCount++;return{ownership:'free',previousKeyRevoked:true};},
    })));
  return{createStrataDriver,starts,statusUrls,releaseUrls,setStatusFailures(/** @type {number} */ value){statusFailures=value;},
    setReleaseFailures(/** @type {number} */ value){releaseFailures=value;},
    setAfterAcquire(/** @type {(()=>void)|null} */ callback){afterAcquire=callback;},
    get connectCount(){return connectCount;},get acquireCount(){return acquireCount;},get releaseCount(){return releaseCount;}};
}

test('start returns an accepted message before native root creation or task delivery',async t=>{
  const fake=await harness(t,{blockedStart:true,maxInstances:1});
  const reply=await fake.start();
  assert.equal(reply.status,'succeeded');
  const accepted=result(reply);
  assert.equal(accepted.deliveryStatus,'accepted');
  assert.equal(typeof accepted.messageId,'string');
  const before=await fake.execute(accepted.runId,'list_agents');
  assert.equal(result(before).threadId,null);
  assert.equal(fake.stateStore.getMessage(accepted.messageId)?.deliveryStatus,'accepted');
  const competing=await fake.start('main-2');
  assert.equal(competing.status,'failed');
  if(competing.status!=='failed')throw new Error('Expected occupied capacity.');
  assert.match(competing.error.message,/capacity/);
  fake.native.releaseStart();
  await waitDelivered(fake.stateStore,accepted.messageId);
  assert.equal(fake.native.openCount,1);
});

test('preparation and local validation fail definitely, while an attempted native turn remains unknown',async t=>{
  /** @type {Array<{options:NonNullable<Parameters<typeof harness>[1]>,expected:'failed'|'unknown',attempted:boolean}>} */
  const cases=[
    {options:{failStart:true},expected:'failed',attempted:false},
    {options:{incompleteFacts:true},expected:'failed',attempted:false},
    {options:{failTurn:true},expected:'unknown',attempted:true},
  ];
  for(const {options,expected,attempted} of cases){
    const fake=await harness(t,options);
    const accepted=result(await fake.start());
    await waitFailedDelivery(fake.stateStore,accepted.messageId,expected);
    assert.equal(fake.native.turnInputs.length,attempted?1:0);
  }
});

test('maintenance unloads roots and closes the shared server only after exit',async t=>{
  const fake=await harness(t);
  const first=await fake.start('main-1');
  const second=await fake.start('main-2');
  assert.equal(first.status,'succeeded');
  assert.equal(second.status,'succeeded');
  await Promise.all([waitDelivered(fake.stateStore,result(first).messageId),
    waitDelivered(fake.stateStore,result(second).messageId)]);
  assert.equal(fake.native.openCount,2);
  const maintenance=await fake.manager.prepareMaintenance({stopBackgroundAgents:true});
  assert.equal(maintenance.status,'ready');
  assert.equal(fake.native.rootStops,2);
  assert.equal(fake.native.closeCount,1);
  const rejected=await fake.execute(result(first).runId,'send_message',{message:'during maintenance'},'main-1');
  assert.equal(rejected.status,'failed');
});

test('the internal unload signal follows confirmed root and tool exit, never a failed stop',async t=>{
  const fake=await harness(t);
  /** @type {string[]} */ const signals=[];
  const session=await fake.manager.openManaged({ownerId:'main-1',controllerId:'main-1',role:'requirements-reviewer',
    settings,cwd:fake.directory,readPaths:[],writePaths:[],onNotification:()=>{},
    onUnloaded:()=>{signals.push('unloaded');}});
  await session.start({instructions:'Complete one Reviewer task.'});
  const entry=fake.manager.owned(session.runId,'main-1','main-1');
  assert.ok(entry.native);
  const originalStop=entry.native.stop;
  entry.native.stop=async()=>{throw new Error('Root exit is unverified.');};
  await assert.rejects(session.stop(),/Root exit is unverified/u);
  assert.deepEqual(signals,[]);
  entry.native.stop=originalStop;
  assert.deepEqual(await session.stop(),{environmentState:'exited'});
  assert.deepEqual(signals,['unloaded']);
});

test('maintenance ready persists all idle root exits before another store reads the database',async t=>{
  const fake=await harness(t,{maxInstances:3});
  /** @type {string[]} */
  const runIds=[];
  for(let index=0;index<3;index++){
    const accepted=result(await fake.start(`main-${index}`));
    await waitDelivered(fake.stateStore,accepted.messageId);
    fake.native.finish(accepted.runId);
    runIds.push(accepted.runId);
  }
  await fake.manager.list();
  const maintenance=await fake.manager.prepareMaintenance({stopBackgroundAgents:false});
  assert.deepEqual(maintenance,{status:'ready',stoppedAgents:runIds});
  assert.equal(fake.native.rootStops,3);
  assert.equal(fake.native.closeCount,1);
  const independent=createBackgroundAgentStateStore({runtimeDirectory:fake.directory,clock:fake.clock});
  try {
    assert.deepEqual(await independent.loadAgents(),[]);
    for(const runId of runIds)assert.equal(independent.getAgent(runId)?.state,'exited');
  } finally {await independent.close();}
});

test('maintenance reports a flush failure without changing confirmed root exits to unknown',async t=>{
  const fake=await harness(t);
  const accepted=result(await fake.start());
  await waitDelivered(fake.stateStore,accepted.messageId);
  fake.stateStore.flush=async()=>{throw new Error('SQLite final write failed.');};
  const maintenance=await fake.manager.prepareMaintenance({stopBackgroundAgents:true});
  assert.deepEqual(maintenance,{status:'unknown',stoppedAgents:[accepted.runId],reason:'SQLite final write failed.'});
  assert.equal(fake.native.rootStops,1);
  assert.equal(fake.native.closeCount,1);
  assert.equal(fake.manager.owned(accepted.runId,'main-1','main-1').state,'exited');
  assert.equal(fake.manager.owned(accepted.runId,'main-1','main-1').taskState,'ended');
});

test('maintenance drains accepted follow-up work outside the global executor',async t=>{
  const fake=await harness(t);
  const started=result(await fake.start());
  await waitDelivered(fake.stateStore,started.messageId);
  fake.native.finish(started.runId);
  await fake.manager.serial(async()=>{});
  const followup=result(await fake.execute(started.runId,'followup_task',{handoff:'complete another task'}));
  const maintenance=fake.manager.prepareMaintenance({stopBackgroundAgents:true});
  await waitDelivered(fake.stateStore,followup.messageId);
  assert.deepEqual(await maintenance,{status:'ready',stoppedAgents:[started.runId]});
  assert.equal(fake.native.rootStops,1);
  assert.equal((await fake.start('main-2')).status,'failed');
});

test('maintenance cannot discard an accepted idle instruction that has no work yet',async t=>{
  const fake=await harness(t);
  const started=result(await fake.start());
  await waitDelivered(fake.stateStore,started.messageId);
  fake.native.finish(started.runId);
  await fake.manager.serial(async()=>{});
  const queued=result(await fake.execute(started.runId,'send_message',{message:'next task evidence'}));
  assert.equal(queued.deliveryStatus,'accepted');
  const maintenance=await fake.manager.prepareMaintenance({stopBackgroundAgents:true});
  assert.equal(maintenance.status,'busy');
  assert.equal(fake.native.rootStops,0);
  assert.equal(fake.stateStore.getMessage(queued.messageId)?.deliveryStatus,'accepted');
});

test('persistence failure rejects new work with a reason while status remains available',async t=>{
  const fake=await harness(t);
  const started=await fake.start();
  assert.equal(started.status,'succeeded');
  await waitDelivered(fake.stateStore,result(started).messageId);
  const original=fake.stateStore.assertCanAccept;
  fake.stateStore.assertCanAccept=()=>{const error=new Error('SQLite disk full');
    /** @type {Error & {code?:string}} */(error).code='background-agent-persistence-unavailable';throw error;};
  const rejected=await fake.execute(result(started).runId,'send_message',{message:'new work',turnId:'turn'});
  assert.equal(rejected.status,'failed');
  if(rejected.status!=='failed')throw new Error('Expected a failed request.');
  assert.equal(rejected.error.code,'background-agent-persistence-unavailable');
  assert.match(rejected.error.message,/SQLite disk full/);
  assert.equal((await fake.execute(result(started).runId,'list_agents')).status,'succeeded');
  fake.stateStore.assertCanAccept=original;
});

test('wait_agent returns one batch and records delivery only after its output is written',async t=>{
  const fake=await harness(t);
  const started=result(await fake.start());
  await waitDelivered(fake.stateStore,started.messageId);
  const before=result(await fake.execute(started.runId,'list_agents'));
  assert.equal(typeof before.threadId,'string');
  const notice=await fake.manager.execute({ownerId:'main-1',controllerId:'main-1',callerId:before.threadId,
    operation:'send_message',input:{runId:started.runId,message:'progress'}});
  const sent=result(notice);
  assert.equal(fake.stateStore.getMessage(sent.messageId)?.deliveryStatus,'accepted');
  const readOnly=await fake.execute(started.runId,'list_agents',{cursor:before.cursor});
  assert.equal(readOnly.status,'succeeded');
  assert.equal(fake.stateStore.getMessage(sent.messageId)?.deliveryStatus,'accepted');
  /** @type {unknown[]} */
  const emitted=[];
  const waited=await fake.manager.execute({ownerId:'main-1',controllerId:'main-1',operation:'wait_agent',
    input:{runId:started.runId,cursor:before.cursor},emit:async value=>{emitted.push(value);}});
  assert.equal(waited.status,'succeeded');
  assert.equal(emitted.length,1);
  assert.equal(fake.stateStore.getMessage(sent.messageId)?.deliveryStatus,'delivered');
});

test('wait_agent uses its own bounded timeout without ending native work',async t=>{
  const fake=await harness(t);
  const started=result(await fake.start());
  await waitDelivered(fake.stateStore,started.messageId);
  const before=result(await fake.execute(started.runId,'list_agents'));
  const invalid=await fake.execute(started.runId,'wait_agent',{cursor:before.cursor,timeout_ms:9_999});
  assert.equal(invalid.status,'failed');
  const pending=fake.execute(started.runId,'wait_agent',{cursor:before.cursor});
  await tick();
  fake.fireTimeout(30_000);
  const waited=result(await pending);
  assert.deepEqual(waited.notifications,[]);
  assert.equal(waited.taskState,'working');
  assert.equal(fake.native.rootStops,0);
});

test('failed output does not claim that an Agent notice was delivered',async t=>{
  const fake=await harness(t);
  const started=result(await fake.start());
  await waitDelivered(fake.stateStore,started.messageId);
  const before=result(await fake.execute(started.runId,'list_agents'));
  const notice=result(await fake.manager.execute({ownerId:'main-1',controllerId:'main-1',callerId:before.threadId,
    operation:'send_message',input:{runId:started.runId,message:'progress'}}));
  const failed=await fake.manager.execute({ownerId:'main-1',controllerId:'main-1',operation:'wait_agent',
    input:{runId:started.runId,cursor:before.cursor},emit:async()=>{throw new Error('output failed');}});
  assert.equal(failed.status,'failed');
  assert.equal(fake.stateStore.getMessage(notice.messageId)?.deliveryStatus,'accepted');
});

test('a stale turn is rejected before allocating an instruction message',async t=>{
  const fake=await harness(t);
  const started=result(await fake.start());
  await waitDelivered(fake.stateStore,started.messageId);
  const before=result(await fake.execute(started.runId,'messages',{direction:'main-to-agent'}));
  const rejected=await fake.execute(started.runId,'send_message',{message:'later work',turnId:'older-turn'});
  assert.equal(rejected.status,'failed');
  if(rejected.status!=='failed')throw new Error('Expected stale turn rejection.');
  assert.match(rejected.error.message,/turn changed/);
  const after=result(await fake.execute(started.runId,'messages',{direction:'main-to-agent'}));
  assert.deepEqual(after.messages,before.messages);
});

test('active native work rejects changed follow-up settings before message allocation',async t=>{
  const fake=await harness(t);
  const started=result(await fake.start());
  await waitDelivered(fake.stateStore,started.messageId);
  const before=result(await fake.execute(started.runId,'messages',{direction:'main-to-agent'}));
  const rejected=await fake.execute(started.runId,'followup_task',{
    handoff:'new task',turnId:'turn',settings:{...settings,model:'different'},
  });
  assert.equal(rejected.status,'failed');
  const after=result(await fake.execute(started.runId,'messages',{direction:'main-to-agent'}));
  assert.deepEqual(after.messages,before.messages);
  assert.equal(fake.native.rootStops,0);
});

test('unverified tool work cannot be evicted to exceed the root capacity',async t=>{
  const fake=await harness(t,{maxInstances:1,unsafeIdle:true});
  const first=await fake.start();
  assert.equal(first.status,'succeeded');
  for(let attempt=0;attempt<10 && fake.native.openCount<1;attempt++)await tick();
  fake.native.finish(result(first).runId);
  await fake.manager.list();
  const denied=await fake.start();
  assert.equal(denied.status,'failed');
  if(denied.status!=='failed')throw new Error('Expected capacity failure.');
  assert.match(denied.error.message,/capacity/);
  assert.equal(fake.native.rootStops,0);
});

test('safe eviction and maintenance cannot unload work reserved during native idle verification',async t=>{
  const fake=await harness(t,{maxInstances:1});
  const first=result(await fake.start());
  await waitDelivered(fake.stateStore,first.messageId);
  await fake.manager.owned(first.runId,'main-1','main-1').work;
  fake.native.finish(first.runId);
  await fake.manager.list();
  const entry=fake.manager.owned(first.runId,'main-1','main-1');
  assert.ok(entry.native);
  const session=fake.manager.proxy(entry);
  const native=entry.native;
  const originalIdleFacts=native.idleFacts;
  /** @returns {{entered:Promise<void>,release:()=>void,install:()=>void}} */
  const idleGate=()=>{
    /** @type {()=>void} */let enter=()=>{},release=()=>{};
    return {entered:new Promise(resolve=>{enter=()=>resolve(undefined);}),
      release:()=>release(),install(){
        const gate=new Promise(resolve=>{release=()=>resolve(undefined);});
        native.idleFacts=async input=>{enter();await gate;return originalIdleFacts(input);};
      }};
  };

  const capacityGate=idleGate();
  /** @type {ReturnType<typeof idleGate>|null} */let maintenanceGate=null;
  /** @type {()=>void} */let releaseCapacity=()=>{},releaseMaintenance=()=>{},stopped=()=>{},continueStop=()=>{};
  try{
    capacityGate.install();
    const capacity=fake.start();
    await capacityGate.entered;
    releaseCapacity=session.holdManagedWork();
    capacityGate.release();
    const denied=await capacity;
    assert.equal(denied.status,'failed');
    if(denied.status==='failed')assert.match(denied.error.message,/capacity is exhausted/u);
    assert.equal(fake.native.rootStops,0);
    releaseCapacity();

    maintenanceGate=idleGate();
    maintenanceGate.install();
    const maintenance=fake.manager.prepareMaintenance({stopBackgroundAgents:false});
    await maintenanceGate.entered;
    releaseMaintenance=session.holdManagedWork();
    maintenanceGate.release();
    assert.equal((await maintenance).status,'busy');
    assert.equal(fake.native.rootStops,0);
    releaseMaintenance();

    native.idleFacts=originalIdleFacts;
    const stopEntered=new Promise(resolve=>{stopped=()=>resolve(undefined);});
    const stopGate=new Promise(resolve=>{continueStop=()=>resolve(undefined);});
    const originalStop=native.stop;
    native.stop=async()=>{stopped();await stopGate;return originalStop();};
    const finalMaintenance=fake.manager.prepareMaintenance({stopBackgroundAgents:false});
    await stopEntered;
    /** @type {()=>void} */let lateRelease=()=>{};
    let lateHoldRejected=false;
    try{lateRelease=session.holdManagedWork();}
    catch(error){lateHoldRejected=true;assert.match(String(error),/stopping|unload|unavailable/u);}
    lateRelease();
    assert.equal(lateHoldRejected,true);
    continueStop();
    assert.equal((await finalMaintenance).status,'ready');
    assert.equal(fake.native.rootStops,1);
  } finally {
    capacityGate.release();
    maintenanceGate?.release();
    releaseCapacity();
    releaseMaintenance();
    continueStop();
    native.idleFacts=originalIdleFacts;
  }
});

test('provider capacity evicts only its safe idle root before the global capacity pass',async t=>{
  const fake=await harness(t,{maxInstances:2,providers:{a:{maxInstances:1}}});
  const a={...settings,modelProvider:'a'},b={...settings,modelProvider:'b'};
  const first=result(await fake.start('main-a',a));
  await waitDelivered(fake.stateStore,first.messageId);
  fake.native.finish(first.runId);
  await fake.manager.list();
  const second=result(await fake.start('main-b',b));
  await waitDelivered(fake.stateStore,second.messageId);
  fake.native.finish(second.runId);
  await fake.manager.list();
  const third=result(await fake.start('main-c',a));
  await waitDelivered(fake.stateStore,third.messageId);
  assert.equal(fake.manager.owned(first.runId,'main-a','main-a').state,'exited');
  assert.notEqual(fake.manager.owned(second.runId,'main-b','main-b').state,'exited');
  assert.equal(fake.native.rootStops,1);
  const rejected=await fake.start('main-d',a);
  assert.equal(rejected.status,'failed');
  if(rejected.status==='failed')assert.match(rejected.error.message,/Provider a capacity/);
  assert.equal(fake.native.rootStops,1);
});

test('Strata lease saves before native root and remains private until confirmed shared exit',async t=>{
  const service=strataService();
  const fake=await harness(t,{maxInstances:1,providers:{strata:{driver:'strata',installationDirectory:'/service',maxInstances:1}},
    createStrataDriver:service.createStrataDriver});
  const firstSettings={...settings,model:'qwen3.8-flash-next-q2_0',modelProvider:'strata'};
  const first=result(await fake.start('main-a',firstSettings));
  await waitDelivered(fake.stateStore,first.messageId);
  assert.equal(service.acquireCount,1);
  assert.equal(fake.stateStore.listProviders().length,1);
  assert.equal(fake.native.openedProviderConnections[0]?.leaseKey,'key-1');
  assert.equal(JSON.stringify(fake.stateStore.getAgent(first.runId)?.settings).includes('key-1'),false);
  fake.native.finish(first.runId);
  await fake.manager.list();
  const generic=result(await fake.start('main-b'));
  await waitDelivered(fake.stateStore,generic.messageId);
  fake.native.finish(generic.runId);
  await fake.manager.list();
  const second=result(await fake.start('main-c',{...firstSettings,model:'qwen3.8-flash-next-iq2_xs'}));
  await waitDelivered(fake.stateStore,second.messageId);
  assert.equal(service.acquireCount,1);
  assert.deepEqual(service.starts,['qwen3.8-flash-next-q2_0','qwen3.8-flash-next-iq2_xs']);
  assert.equal(service.releaseCount,0);
  const maintenance=await fake.manager.prepareMaintenance({stopBackgroundAgents:true});
  assert.equal(maintenance.status,'ready');
  assert.equal(service.releaseCount,1);
  assert.deepEqual(fake.stateStore.listProviders(),[]);
});

test('App Server initializes before key acquisition, and startup failure acquires no key',async t=>{
  const service=strataService();
  const providerSettings={...settings,model:'qwen3.8-flash-next-q2_0',modelProvider:'strata'};
  const fake=await harness(t,{providers:{strata:{driver:'strata',installationDirectory:'/service'}},
    createStrataDriver:service.createStrataDriver});
  service.setAfterAcquire(()=>assert.equal(fake.native.serverStarts,1));
  const accepted=result(await fake.start('main-a',providerSettings));
  await waitDelivered(fake.stateStore,accepted.messageId);
  assert.equal(service.acquireCount,1);
  const close=fake.native.nativeSessions.close;
  fake.native.nativeSessions.close=async input=>{
    assert.equal(service.releaseCount,1);
    return close(input);
  };
  const maintenance=await fake.manager.prepareMaintenance({stopBackgroundAgents:true});
  assert.equal(maintenance.status,'ready');
  assert.equal(service.releaseCount,1);
  assert.equal(fake.native.closeCount,2);

  const failed=await harness(t,{providers:{strata:{driver:'strata',installationDirectory:'/service'}},
    createStrataDriver:service.createStrataDriver});
  failed.native.nativeSessions.ensureServer=async()=>{throw new Error('App Server initialization failed.');};
  const rejected=result(await failed.start('main-b',providerSettings));
  await waitFailedDelivery(failed.stateStore,rejected.messageId,'failed');
  assert.equal(failed.native.openCount,0);
  assert.equal(service.acquireCount,1);
});

test('rejected key acquisition leaves an empty initialized server for the normal idle timeout',async t=>{
  const service=strataService();
  const driver=service.createStrataDriver({installationDirectory:'/service'});
  await driver.acquire({controllerUrl:'http://original-controller'});
  const fake=await harness(t,{providers:{strata:{driver:'strata',installationDirectory:'/service'}},
    createStrataDriver:service.createStrataDriver});
  const accepted=result(await fake.start('main-a',{...settings,model:'qwen3.8-flash-next-q2_0',modelProvider:'strata'}));
  await waitFailedDelivery(fake.stateStore,accepted.messageId,'failed');
  assert.equal(fake.native.serverStarts,1);
  assert.equal(fake.native.openCount,0);
  assert.equal(fake.native.closeCount,1);
  fake.fireTimeout(60_000);
  for(let attempt=0;attempt<10 && fake.native.closeCount===1;attempt++)await tick();
  assert.equal(fake.native.closeCount,2);
  assert.equal(await fake.native.nativeSessions.observeServer(),'absent');
});

test('a key acquired during unexpected App Server exit cannot restart the process during native open',async t=>{
  const service=strataService();
  const providerSettings={...settings,model:'qwen3.8-flash-next-q2_0',modelProvider:'strata'};
  const fake=await harness(t,{maxInstances:3,providers:{strata:{driver:'strata',installationDirectory:'/service'}},
    createStrataDriver:service.createStrataDriver});
  service.setAfterAcquire(()=>fake.native.exitServer());
  const accepted=result(await fake.start('main-a',providerSettings));
  await waitFailedDelivery(fake.stateStore,accepted.messageId,'failed');
  assert.equal(fake.native.serverStarts,1);
  assert.equal(fake.native.openCount,0);
  assert.equal(fake.native.turnInputs.length,0);
  assert.equal(service.acquireCount,1);
  assert.equal(service.releaseCount,0);
  assert.equal(fake.stateStore.getProvider('strata')?.leaseKey,'key-1');
  service.setAfterAcquire(null);
  const next=result(await fake.start('main-b'));
  await waitDelivered(fake.stateStore,next.messageId);
  assert.equal(service.releaseCount,1);
  assert.equal(fake.native.serverStarts,2);
  assert.equal(fake.native.openCount,1);
  assert.deepEqual(fake.stateStore.listProviders(),[]);
});

test('the idle timer does not treat an unexpected empty App Server exit as normal key release',async t=>{
  const service=strataService();
  const providerSettings={...settings,model:'qwen3.8-flash-next-q2_0',modelProvider:'strata'};
  const fake=await harness(t,{providers:{strata:{driver:'strata',installationDirectory:'/service'}},
    createStrataDriver:service.createStrataDriver});
  const accepted=result(await fake.start('main-a',providerSettings));
  await waitDelivered(fake.stateStore,accepted.messageId);
  await fake.manager.proxy(fake.manager.owned(accepted.runId,'main-a','main-a')).stop();
  fake.native.exitServer();
  fake.fireTimeout(60_000);
  for(let attempt=0;attempt<10;attempt++)await tick();
  assert.equal(service.releaseCount,0);
  assert.equal(fake.native.closeCount,1);
  assert.equal(fake.stateStore.getProvider('strata')?.leaseKey,'key-1');
  assert.equal(await fake.native.nativeSessions.observeServer(),'ended');
});

test('failed key return keeps the normal shared server alive for a later confirmed return',async t=>{
  const service=strataService();
  const fake=await harness(t,{providers:{strata:{driver:'strata',installationDirectory:'/service'}},
    createStrataDriver:service.createStrataDriver});
  const accepted=result(await fake.start('main-a',{...settings,model:'qwen3.8-flash-next-q2_0',modelProvider:'strata'}));
  await waitDelivered(fake.stateStore,accepted.messageId);
  await fake.manager.proxy(fake.manager.owned(accepted.runId,'main-a','main-a')).stop();
  service.setReleaseFailures(1);
  const first=await fake.manager.prepareMaintenance({stopBackgroundAgents:true});
  assert.equal(first.status,'unknown');
  assert.match(first.reason??'',/Original controller release could not be verified/);
  assert.equal(fake.native.closeCount,1);
  assert.equal(await fake.native.nativeSessions.observeServer(),'running');
  assert.equal(fake.stateStore.getProvider('strata')?.leaseKey,'key-1');
  const second=await fake.manager.prepareMaintenance({stopBackgroundAgents:true});
  assert.equal(second.status,'ready');
  assert.equal(service.releaseCount,1);
  assert.equal(fake.native.closeCount,2);
  assert.deepEqual(fake.stateStore.listProviders(),[]);
});

test('failed immediate Strata lease save cannot create a root or acquire a replacement key',async t=>{
  const service=strataService();
  const fake=await harness(t,{providers:{strata:{driver:'strata',installationDirectory:'/service',maxInstances:1}},
    createStrataDriver:service.createStrataDriver});
  const original=fake.stateStore.saveProvider;
  fake.stateStore.saveProvider=()=>{throw new Error('Provider lease SQLite commit failed.');};
  const first=result(await fake.start('main-a',{...settings,model:'qwen3.8-flash-next-q2_0',modelProvider:'strata'}));
  await waitFailedDelivery(fake.stateStore,first.messageId,'failed');
  assert.equal(fake.native.openCount,0);
  assert.equal(service.acquireCount,1);
  assert.match(fake.stateStore.getProvider('strata')?.lastError??'',/SQLite commit failed/);
  assert.equal(fake.stateStore.getProvider('strata')?.leaseKey,null);
  fake.stateStore.saveProvider=original;
  const second=result(await fake.start('main-b',{...settings,model:'qwen3.8-flash-next-q2_0',modelProvider:'strata'}));
  await waitDelivered(fake.stateStore,second.messageId);
  assert.equal(service.acquireCount,1);
  assert.equal(fake.native.openCount,1);
  assert.equal(fake.stateStore.listProviders().length,1);
  assert.equal(fake.stateStore.getProvider('strata')?.lastError,null);
});

test('a held Strata key survives preparation failure and clears its current error after success',async t=>{
  const service=strataService();
  const providerSettings={...settings,model:'qwen3.8-flash-next-q2_0',modelProvider:'strata'};
  const fake=await harness(t,{maxInstances:3,providers:{strata:{driver:'strata',installationDirectory:'/service',maxInstances:3}},
    createStrataDriver:service.createStrataDriver});
  const first=result(await fake.start('main-a',providerSettings));
  await waitDelivered(fake.stateStore,first.messageId);
  service.setStatusFailures(1);
  const second=result(await fake.start('main-b',providerSettings));
  await waitFailedDelivery(fake.stateStore,second.messageId,'failed');
  assert.equal(fake.native.openCount,1);
  assert.equal(fake.stateStore.getProvider('strata')?.leaseKey,'key-1');
  assert.deepEqual(result(await fake.execute(second.runId,'list_agents',{},'main-b')).providerError,
    {providerId:'strata',message:'Original controller status could not be verified.'});
  const third=result(await fake.start('main-c',providerSettings));
  await waitDelivered(fake.stateStore,third.messageId);
  assert.equal(service.acquireCount,1);
  assert.equal(fake.native.openCount,2);
  assert.equal(fake.stateStore.getProvider('strata')?.lastError,null);
  assert.equal(result(await fake.execute(second.runId,'list_agents',{},'main-b')).providerError,null);
});

test('cold provider lease is returned only after the old App Server exit is proved',async t=>{
  const service=strataService();
  const providers={strata:{driver:/** @type {const} */('strata'),installationDirectory:'/service',maxInstances:1}};
  const fake=await harness(t,{providers,createStrataDriver:service.createStrataDriver});
  const driver=service.createStrataDriver({installationDirectory:'/service'});
  const originalControllerUrl='http://original-controller';
  const acquired=await driver.acquire({controllerUrl:originalControllerUrl});
  fake.stateStore.saveProvider({providerId:'strata',controllerUrl:originalControllerUrl,leaseKey:acquired.leaseKey});
  await fake.manager.close();
  const store=createBackgroundAgentStateStore({runtimeDirectory:fake.directory,clock:fake.clock});
  let previous=true;
  const sessions={...fake.native.nativeSessions,async close(){return{
    environmentState:/** @type {const} */('exited'),previousProcessState:/** @type {const} */('ended'),
  };},async ensureServer(input={}){
    if(previous){await /** @type {{onPreviousExit?:()=>Promise<void>}} */(input).onPreviousExit?.();previous=false;}
    await fake.native.nativeSessions.ensureServer();
  }};
  const manager=await createBackgroundAgentManager({nativeSessions:sessions,maxInstances:2,stateStore:store,
    clock:fake.clock,modelCatalog:{getProviders:async()=>providers},createStrataDriver:service.createStrataDriver});
  assert.equal(service.releaseCount,0);
  const reply=await manager.execute({ownerId:'main',controllerId:'main',operation:'spawn_agent',input:{
    role:'generic',settings,cwd:fake.directory,stateDirectory:fake.directory,readPaths:[],writePaths:[],
    instructions:'instructions',handoff:'work',
  }});
  assert.equal(reply.status,'succeeded');
  await waitDelivered(store,result(reply).messageId);
  assert.equal(service.releaseCount,1);
  assert.equal(service.connectCount,0);
  assert.deepEqual(service.statusUrls,[originalControllerUrl]);
  assert.deepEqual(service.releaseUrls,[originalControllerUrl]);
  assert.deepEqual(store.listProviders(),[]);
  await manager.close();
});

test('cold status and release failures retain the original lease, and a failed delete never repeats release',async t=>{
  const service=strataService();
  const providers={strata:{driver:/** @type {const} */('strata'),installationDirectory:'/service',maxInstances:1}};
  const fake=await harness(t,{providers,createStrataDriver:service.createStrataDriver});
  const originalControllerUrl='http://original-controller';
  const acquired=await service.createStrataDriver({installationDirectory:'/service'}).acquire({controllerUrl:originalControllerUrl});
  fake.stateStore.saveProvider({providerId:'strata',controllerUrl:originalControllerUrl,leaseKey:acquired.leaseKey});
  await fake.manager.close();
  const store=createBackgroundAgentStateStore({runtimeDirectory:fake.directory,clock:fake.clock});
  let previous=true;
  const sessions={...fake.native.nativeSessions,async close(){return{
    environmentState:/** @type {const} */('exited'),previousProcessState:/** @type {const} */('ended'),
  };},async ensureServer(input={}){
    if(previous){await /** @type {{onPreviousExit?:()=>Promise<void>}} */(input).onPreviousExit?.();previous=false;}
    await fake.native.nativeSessions.ensureServer();
  }};
  const manager=await createBackgroundAgentManager({nativeSessions:sessions,maxInstances:2,stateStore:store,
    clock:fake.clock,modelCatalog:{getProviders:async()=>providers},createStrataDriver:service.createStrataDriver});
  /** @param {'delivered'|'failed'} expected */
  const spawn=async expected=>{const accepted=result(await manager.execute({ownerId:'main',controllerId:'main',operation:'spawn_agent',input:{
    role:'generic',settings,cwd:fake.directory,stateDirectory:fake.directory,readPaths:[],writePaths:[],
    instructions:'instructions',handoff:'work',
  }}));
    if(expected==='delivered')await waitDelivered(store,accepted.messageId);
    else await waitFailedDelivery(store,accepted.messageId,'failed');
  };
  service.setStatusFailures(1);
  await spawn('failed');
  assert.equal(fake.native.openCount,0);
  assert.deepEqual(store.listProviders(),[{providerId:'strata',controllerUrl:originalControllerUrl,
    leaseKey:acquired.leaseKey,lastError:'Original controller status could not be verified.'}]);
  assert.deepEqual(service.releaseUrls,[]);
  service.setReleaseFailures(1);
  await spawn('failed');
  assert.deepEqual(store.listProviders(),[{providerId:'strata',controllerUrl:originalControllerUrl,
    leaseKey:acquired.leaseKey,lastError:'Original controller release could not be verified.'}]);
  assert.deepEqual(service.releaseUrls,[originalControllerUrl]);
  const originalDelete=store.deleteProvider;
  let failDelete=true;
  store.deleteProvider=providerId=>{
    if(failDelete)throw new Error('SQLite delete failed.');
    return originalDelete(providerId);
  };
  await spawn('failed');
  assert.deepEqual(service.statusUrls,[originalControllerUrl,originalControllerUrl,originalControllerUrl]);
  assert.deepEqual(service.releaseUrls,[originalControllerUrl,originalControllerUrl]);
  assert.deepEqual(store.listProviders(),[{providerId:'strata',controllerUrl:originalControllerUrl,
    leaseKey:acquired.leaseKey,lastError:'SQLite delete failed.'}]);
  failDelete=false;
  await spawn('delivered');
  assert.deepEqual(service.statusUrls,[originalControllerUrl,originalControllerUrl,originalControllerUrl]);
  assert.deepEqual(service.releaseUrls,[originalControllerUrl,originalControllerUrl]);
  assert.equal(service.connectCount,0);
  assert.deepEqual(store.listProviders(),[]);
  await manager.close();
});

test('cold provider lease with absent or unverified old process blocks new roots despite spare capacity',async t=>{
  for(const proof of ['absent','unknown']){
    const service=strataService();
    const providers={strata:{driver:/** @type {const} */('strata'),installationDirectory:'/service',maxInstances:1}};
    const fake=await harness(t,{providers,createStrataDriver:service.createStrataDriver,maxInstances:4});
    const driver=service.createStrataDriver({installationDirectory:'/service'});
    const connection=await driver.connect(), acquired=await driver.acquire(connection);
    fake.stateStore.saveProvider({providerId:'strata',controllerUrl:connection.controllerUrl,leaseKey:acquired.leaseKey});
    await fake.manager.close();
    const store=createBackgroundAgentStateStore({runtimeDirectory:fake.directory,clock:fake.clock});
    const sessions={...fake.native.nativeSessions,async close(){if(proof==='unknown')throw new Error('Process identity unknown.');
      return{environmentState:/** @type {const} */('exited'),previousProcessState:/** @type {const} */('absent')};}};
    const manager=await createBackgroundAgentManager({nativeSessions:sessions,maxInstances:4,stateStore:store,
      clock:fake.clock,modelCatalog:{getProviders:async()=>providers},createStrataDriver:service.createStrataDriver});
    const denied=await manager.execute({ownerId:'main',controllerId:'main',operation:'spawn_agent',input:{
      role:'generic',settings,cwd:fake.directory,stateDirectory:fake.directory,readPaths:[],writePaths:[],
      instructions:'instructions',handoff:'work',
    }});
    assert.equal(denied.status,'failed');
    if(denied.status==='failed')assert.match(denied.error.message,/Earlier App Server exit could not be confirmed/);
    assert.equal(fake.native.openCount,0);
    assert.equal(service.releaseCount,0);
    assert.equal(store.listProviders().length,1);
    await manager.close();
  }
});

test('cold provider diagnostic without a lease does not require old process proof or block another provider',async t=>{
  const providers={strata:{driver:/** @type {const} */('strata'),installationDirectory:'/service',maxInstances:1}};
  const service=strataService();
  const fake=await harness(t,{providers,createStrataDriver:service.createStrataDriver});
  fake.stateStore.updateProviderError({providerId:'strata',lastError:'Controller unavailable.'});
  await fake.stateStore.flush();
  await fake.manager.close();
  const store=createBackgroundAgentStateStore({runtimeDirectory:fake.directory,clock:fake.clock});
  const sessions={...fake.native.nativeSessions,async close(){return{
    environmentState:/** @type {const} */('exited'),previousProcessState:/** @type {const} */('absent'),
  };}};
  const manager=await createBackgroundAgentManager({nativeSessions:sessions,maxInstances:2,stateStore:store,
    clock:fake.clock,modelCatalog:{getProviders:async()=>providers},createStrataDriver:service.createStrataDriver});
  const reply=await manager.execute({ownerId:'main',controllerId:'main',operation:'spawn_agent',input:{
    role:'generic',settings,cwd:fake.directory,stateDirectory:fake.directory,readPaths:[],writePaths:[],
    instructions:'instructions',handoff:'work',
  }});
  const accepted=result(reply);
  await waitDelivered(store,accepted.messageId);
  assert.equal(fake.native.openCount,1);
  assert.equal(service.releaseCount,0);
  assert.deepEqual(store.getProvider('strata'),{providerId:'strata',controllerUrl:null,leaseKey:null,
    lastError:'Controller unavailable.'});
  await manager.close();
});

test('concurrent starts for one Strata provider share its one saved key',async t=>{
  const service=strataService();
  const fake=await harness(t,{maxInstances:2,providers:{strata:{driver:'strata',installationDirectory:'/service',maxInstances:2}},
    createStrataDriver:service.createStrataDriver});
  const providerSettings={...settings,model:'qwen3.8-flash-next-q2_0',modelProvider:'strata'};
  const first=result(await fake.start('main-a',providerSettings));
  const second=result(await fake.start('main-b',providerSettings));
  await Promise.all([waitDelivered(fake.stateStore,first.messageId),waitDelivered(fake.stateStore,second.messageId)]);
  assert.equal(service.acquireCount,1);
  assert.equal(fake.native.openCount,2);
  assert.equal(fake.native.openedProviderConnections[0]?.leaseKey,'key-1');
  assert.equal(fake.native.openedProviderConnections[1]?.leaseKey,'key-1');
});

test('separate Strata provider entries at one installation keep independent lease requests',async t=>{
  const service=strataService();
  const fake=await harness(t,{maxInstances:2,providers:{
    first:{driver:'strata',installationDirectory:'/service',maxInstances:1},
    second:{driver:'strata',installationDirectory:'/service',maxInstances:1},
  },createStrataDriver:service.createStrataDriver});
  const first=result(await fake.start('main-a',{...settings,model:'qwen3.8-flash-next-q2_0',modelProvider:'first'}));
  await waitDelivered(fake.stateStore,first.messageId);
  const secondReply=await fake.start('main-b',{...settings,model:'qwen3.8-flash-next-q2_0',modelProvider:'second'});
  assert.equal(secondReply.status,'succeeded',JSON.stringify(secondReply));
  const second=result(secondReply);
  await waitFailedDelivery(fake.stateStore,second.messageId,'failed');
  assert.equal(fake.native.openCount,1);
  const rejected=result(await fake.execute(second.runId,'list_agents',{},'main-b'));
  assert.equal(rejected.threadId,null);
  assert.equal(rejected.state,'exited');
  assert.deepEqual(rejected.providerError,{providerId:'second',message:'Strata acquire rejected (HTTP 409): Ownership is held.'});
  const waited=result(await fake.execute(second.runId,'wait_agent',{},'main-b'));
  assert.deepEqual(waited.providerError,rejected.providerError);
  assert.deepEqual(fake.stateStore.getProvider('first'),{providerId:'first',controllerUrl:'http://controller/8',
    leaseKey:'key-1',lastError:null});
  assert.deepEqual(fake.stateStore.getProvider('second'),{providerId:'second',controllerUrl:'http://controller/8',
    leaseKey:null,lastError:'Strata acquire rejected (HTTP 409): Ownership is held.'});
  assert.equal(service.releaseCount,0);
});

test('send_message to an idle root stays queued until followup_task starts work',async t=>{
  const fake=await harness(t);
  const started=result(await fake.start());
  await waitDelivered(fake.stateStore,started.messageId);
  fake.native.finish(started.runId);
  await tick();
  const before=fake.native.openCount;
  const queued=result(await fake.execute(started.runId,'send_message',{message:'queued instruction'}));
  assert.equal(queued.deliveryStatus,'accepted');
  assert.equal(fake.stateStore.getMessage(queued.messageId)?.deliveryStatus,'accepted');
  assert.equal(fake.native.openCount,before);
  const followup=result(await fake.execute(started.runId,'followup_task',{handoff:'next task'}));
  assert.equal(followup.deliveryStatus,'accepted');
  await waitDelivered(fake.stateStore,followup.messageId);
  assert.equal(fake.stateStore.getMessage(queued.messageId)?.deliveryStatus,'delivered');
  assert.equal(fake.native.openCount,before);
});

test('an active-turn message delayed past that turn fails and cannot enter a later follow-up',async t=>{
  const fake=await harness(t);
  const started=result(await fake.start());
  await waitDelivered(fake.stateStore,started.messageId);
  const entry=fake.manager.owned(started.runId,'main-1','main-1');
  /** @type {()=>void} */ let release=()=>{};
  entry.work=new Promise(resolve=>{release=resolve;});
  const delayed=result(await fake.execute(started.runId,'send_message',{message:'old active turn only',turnId:'turn'}));
  assert.equal(delayed.deliveryStatus,'accepted');
  fake.native.finish(started.runId);
  await fake.manager.serial(async()=>{});
  release();
  await waitFailedDelivery(fake.stateStore,delayed.messageId,'failed');
  const followup=result(await fake.execute(started.runId,'followup_task',{handoff:'new follow-up'}));
  await waitDelivered(fake.stateStore,followup.messageId);
  assert.equal(fake.native.turnInputs.at(-1)?.includes('old active turn only'),false);
  assert.equal(fake.stateStore.getMessage(delayed.messageId)?.deliveryStatus,'failed');
});

test('followup_task restores an evicted root using the original native thread',async t=>{
  const fake=await harness(t,{maxInstances:1});
  const first=result(await fake.start());
  await waitDelivered(fake.stateStore,first.messageId);
  const original=result(await fake.execute(first.runId,'list_agents')).threadId;
  fake.native.finish(first.runId);
  await tick();
  const second=result(await fake.start());
  await waitDelivered(fake.stateStore,second.messageId);
  assert.equal(fake.native.rootStops,1);
  await fake.stateStore.flush();
  await tick();
  fake.native.finish(second.runId);
  await tick();
  const accepted=result(await fake.execute(first.runId,'followup_task',{handoff:'continue original task'}));
  assert.equal(accepted.deliveryStatus,'accepted');
  await waitDelivered(fake.stateStore,accepted.messageId);
  const resumed=result(await fake.execute(first.runId,'list_agents'));
  assert.equal(resumed.threadId,original);
  assert.equal(fake.native.rootStops,2);
});

test('cold startup confirms the old process once and restores only an explicit new task on the same root',async t=>{
  const fake=await harness(t,{maxInstances:1});
  const first=result(await fake.start());
  await waitDelivered(fake.stateStore,first.messageId);
  const original=result(await fake.execute(first.runId,'list_agents')).threadId;
  await fake.stateStore.flush();
  await fake.manager.close();
  let proofCalls=0;
  const stateStore=createBackgroundAgentStateStore({runtimeDirectory:fake.directory,clock:fake.clock});
  const nativeSessions={...fake.native.nativeSessions,async close(){proofCalls++;
    return {environmentState:/** @type {const} */('exited'),previousProcessState:/** @type {const} */('ended')};}};
  const restored=await createBackgroundAgentManager({nativeSessions,maxInstances:1,stateStore,clock:fake.clock});
  assert.equal(proofCalls,1);
  assert.equal(fake.native.openCount,1);
  const saved=restored.owned(first.runId,'main-1','main-1');
  assert.equal(saved.state,'exited');
  assert.equal(saved.taskState,'unknown');
  assert.equal(saved.taskFinishedAtMs,null);
  assert.equal(fake.native.turnInputs.length,1);
  const accepted=result(await restored.execute({ownerId:'main-1',controllerId:'main-1',operation:'followup_task',
    input:{runId:first.runId,handoff:'explicit new work'}}));
  assert.equal(accepted.runId,first.runId);
  await waitDelivered(stateStore,accepted.messageId);
  assert.equal(result(await restored.execute({ownerId:'main-1',controllerId:'main-1',operation:'list_agents',
    input:{runId:first.runId}})).threadId,original);
  assert.equal(fake.native.openCount,2);
  assert.equal(fake.native.startCount,1);
  assert.deepEqual(fake.native.resumedThreads,[original]);
  assert.equal(fake.native.turnInputs.length,2);
  assert.match(fake.native.turnInputs[1],/explicit new work/);
  assert.doesNotMatch(fake.native.turnInputs[1],/initial work/);
  assert.equal(proofCalls,1);
  await restored.close();
});

test('cold startup retains unknown capacity when old process exit is absent or unverified',async t=>{
  for(const proof of ['absent','alive','unknown']){
    const fake=await harness(t,{maxInstances:4});
    const first=result(await fake.start());
    await waitDelivered(fake.stateStore,first.messageId);
    const original=result(await fake.execute(first.runId,'list_agents')).threadId;
    await fake.stateStore.flush();
    await fake.manager.close();
    let proofCalls=0;
    const stateStore=createBackgroundAgentStateStore({runtimeDirectory:fake.directory,clock:fake.clock});
    const nativeSessions={...fake.native.nativeSessions,async close(){proofCalls++;
      if(proof!=='absent')throw new Error(`Old App Server is ${proof}.`);
      return {environmentState:/** @type {const} */('exited'),previousProcessState:/** @type {const} */('absent')};}};
    const restored=await createBackgroundAgentManager({nativeSessions,maxInstances:4,stateStore,clock:fake.clock});
    assert.equal(proofCalls,1);
    assert.equal(restored.owned(first.runId,'main-1','main-1').state,'unknown');
    assert.equal(result(await restored.execute({ownerId:'main-1',controllerId:'main-1',operation:'list_agents',
      input:{runId:first.runId}})).state,'unknown');
    const denied=await restored.execute({ownerId:'main-1',controllerId:'main-1',operation:'spawn_agent',input:{
      role:'generic',settings,cwd:fake.directory,stateDirectory:fake.directory,readPaths:[],writePaths:[],
      instructions:'instructions',handoff:'must not start',
    }});
    assert.equal(denied.status,'failed');
    if(denied.status==='failed')assert.match(denied.error.message,/Earlier App Server exit could not be confirmed/);
    await assert.rejects(restored.attachExisting({runId:first.runId,threadId:original,
      expectedSessionPath:`/native/${original}.jsonl`,ownerId:'main-1',controllerId:'main-1',role:'generic',
      settings,cwd:fake.directory,readPaths:[],writePaths:[],instructions:'instructions',onNotification(){},
      deferRestore:true}),/cannot be safely restored/);
    assert.equal(fake.native.openCount,1);
    await restored.close();
  }
});

test('cold recovery preserves paused work and advances past the saved message cursor',async t=>{
  const fake=await harness(t);
  const stored=/** @type {import('../../lib/background-agent/state-store.mjs').BackgroundAgentRow} */({
    runId:'paused',ownerId:'main-1',role:'generic',ownerTitle:null,ownerSessionPath:null,
    threadId:'original-thread',turnId:'original-turn',sessionPath:'/native/original.jsonl',settings,
    cwd:fake.directory,readPaths:[],writePaths:[],instructions:'original instructions',recoveryPath:null,
    state:'idle',taskState:'working',stateVersion:3,lastUsedAtMs:1000,taskStartedAtMs:900,
    taskFinishedAtMs:null,knownThreadIds:['original-thread'],providerWork:{paused:true,earlyExitCount:10},
  });
  fake.stateStore.upsertAgent(stored);
  fake.stateStore.acceptMessage({messageId:'pause-notice',runId:stored.runId,sequence:20,
    direction:'agent-to-main',body:'paused original work'});
  await fake.manager.close();
  const stateStore=createBackgroundAgentStateStore({runtimeDirectory:fake.directory,clock:fake.clock});
  const nativeSessions={...fake.native.nativeSessions,async close(){
    return {environmentState:/** @type {const} */('exited'),previousProcessState:/** @type {const} */('ended')};}};
  const restored=await createBackgroundAgentManager({nativeSessions,maxInstances:1,stateStore,clock:fake.clock});
  assert.equal(fake.native.openCount,0);
  const current=restored.owned(stored.runId,'main-1','main-1');
  for(const [key,value] of Object.entries({...stored,state:'exited',stateVersion:21}))
    assert.deepEqual(/** @type {Record<string,unknown>} */(current)[key],value,key);
  await restored.close();
});

test('released proxy cannot bypass manager and callerAccess reloads the persisted run',async t=>{
  const fake=await harness(t,{maxInstances:1});
  const first=result(await fake.start());
  await waitDelivered(fake.stateStore,first.messageId);
  const old=fake.manager.proxy(fake.manager.owned(first.runId,'main-1','main-1'));
  fake.native.finish(first.runId);
  await tick();
  const second=result(await fake.start());
  await waitDelivered(fake.stateStore,second.messageId);
  await fake.stateStore.flush();
  await tick();
  assert.equal(old.managementState(),'exited');
  assert.throws(()=>old.acceptTask({handoff:'stale proxy'}),/reattach the original run/);
  assert.equal(fake.manager.callerAccess({runId:first.runId,callerId:'main-1'}).kind,'owner');
  const queued=result(await fake.execute(first.runId,'send_message',{message:'later instruction'}));
  assert.equal(queued.deliveryStatus,'accepted');
  assert.equal(fake.native.openCount,2);
});


test('program repetition hints survive a SQLite reopen without replaying consumed commands',async t=>{
  const fake=await harness(t);
  const started=result(await fake.start());await waitDelivered(fake.stateStore,started.messageId);
  const observed=result(await fake.execute(started.runId,'list_agents'));
  const session=fake.manager.proxy(fake.manager.owned(started.runId,'main-1','main-1'));
  session.saveProviderWork?.(initialStrataWorkState(false));
  const make=()=>createStrataWorkPolicy({
    readState:()=>/** @type {import('../../lib/background-agent/strata-work-policy.mjs').StrataWorkState} */(/** @type {unknown} */(session.getProviderWork?.())),
    saveState:state=>session.saveProviderWork?.(/** @type {Record<string,unknown>} */(/** @type {unknown} */(state))),
    clock:fake.clock,workDuration:()=>null,
    send:async({instruction,onAccepted})=>session.sendProgramInstruction?.({threadId:observed.threadId,turnId:observed.turnId,instruction,onAccepted}),
    stop:async()=>{throw new Error('No stop was requested.');},
  });
  const commands=Array.from({length:6},(_,i)=>({threadId:observed.threadId,turnId:observed.turnId,itemId:`command-${i+1}`,position:i+1,
    command:'read-current-evidence',cwd:'/review',exitCode:1,output:'unchanged failure'}));
  const first=make();await first.observeCommands(commands.slice(0,2),observed.threadId);first.close();
  await fake.stateStore.flush();
  const reopened=createBackgroundAgentStateStore({runtimeDirectory:fake.directory,clock:fake.clock});
  await reopened.loadAgents();
  session.saveProviderWork?.(reopened.getAgent(started.runId)?.providerWork??{});await reopened.close();
  const recovered=make();await recovered.observeCommands(commands.slice(0,3),observed.threadId);
  await recovered.observeCommands(commands.slice(0,3),observed.threadId);
  await recovered.observeCommands(commands,observed.threadId);recovered.close();
  const delivered=fake.stateStore.messagesAfter({runId:started.runId,direction:'main-to-agent',sequence:0})
    .filter(message=>message.source==='provider-program');
  assert.equal(delivered.length,2);
  assert.equal(new Set(delivered.map(message=>message.messageId)).size,2);
  assert.ok(delivered.every(message=>message.deliveryStatus==='delivered'&&message.threadId===observed.threadId));
});

test('local measured work budget sends its reminder once and stops only its task after continuation and recovery',async t=>{
  const fake=await harness(t,{maxInstances:3});let now=1000;fake.clock.now=()=>now;
  const local=result(await fake.start('local'));const ordinary=result(await fake.start('ordinary'));const remote=result(await fake.start('remote'));
  await Promise.all([local,ordinary,remote].map(item=>waitDelivered(fake.stateStore,item.messageId)));
  const session=fake.manager.proxy(fake.manager.owned(local.runId,'local','local'));
  const observed=result(await fake.execute(local.runId,'list_agents',{},'local'));
  const snapshot=await session.snapshot({rootThreadId:observed.threadId});
  let measured=createReviewerMeasurement({startedAt:now,members:snapshot.members,rootThreadId:observed.threadId,freshRoot:observed.threadId,
    measurementFacts:{workCoverage:{complete:true}}});
  /** @param {'working'|'paused'|'unavailable'} state */
  const availability=state=>observeReviewerMeasurement(measured,{members:snapshot.members,rootThreadId:observed.threadId,now,
    measurementFacts:{workCoverage:{complete:true},workState:{state,at:now}}});
  session.saveProviderWork?.(initialStrataWorkState(true));await session.protectTurn({rootThreadId:observed.threadId,turnId:observed.turnId});
  const make=()=>createStrataWorkPolicy({
    readState:()=>/** @type {import('../../lib/background-agent/strata-work-policy.mjs').StrataWorkState} */(/** @type {unknown} */(session.getProviderWork?.())),
    saveState:state=>session.saveProviderWork?.(/** @type {Record<string,unknown>} */(/** @type {unknown} */(state))),clock:fake.clock,
    workDuration:()=>reviewerMeasurementResult(measured,now).workDuration.durationMs,
    send:async({instruction,onAccepted})=>{const current=result(await fake.execute(local.runId,'list_agents',{},'local'));await session.sendProgramInstruction?.({threadId:current.threadId,turnId:current.turnId,instruction,onAccepted});},
    stop:async()=>{await session.stop();},
  });
  let policy=make();availability('working');now+=54*60_000;availability('paused');await policy.refresh();
  now+=3*60_000;availability('working');await policy.refresh();now+=60_000;fake.fireTimeout(60_000);
  await policy.refresh();
  const hints=()=>fake.stateStore.messagesAfter({runId:local.runId,direction:'main-to-agent',sequence:0}).filter(item=>item.source==='provider-program');
  assert.equal(hints().length,1);assert.equal(hints()[0].deliveryStatus,'delivered');
  fake.native.finish(local.runId);await tick();
  if(!session.continueTask)throw new Error('Managed continuation missing');
  const continued=await session.continueTask({rootThreadId:observed.threadId,endedTurnId:observed.turnId,
    instruction:'Continue the same measurement task.',canContinue:()=>policy.canContinue(),onAccepted:()=>{}});
  assert.equal(continued?.deliveryStatus,'delivered');
  policy.close();await fake.stateStore.flush();
  const reopened=createBackgroundAgentStateStore({runtimeDirectory:fake.directory,clock:fake.clock});await reopened.loadAgents();
  session.saveProviderWork?.(reopened.getAgent(local.runId)?.providerWork??{});await reopened.close();
  measured=structuredClone(measured);policy=make();availability('unavailable');now+=10*60_000;await policy.refresh();
  assert.equal(hints().length,2);assert.equal(result(await fake.execute(local.runId,'list_agents',{},'local')).taskState,'working');
  availability('working');now+=5*60_000;await policy.refresh();policy.close();
  assert.equal(result(await fake.execute(local.runId,'list_agents',{},'local')).state,'exited');
  assert.equal(result(await fake.execute(ordinary.runId,'list_agents',{},'ordinary')).taskState,'working');
  assert.equal(result(await fake.execute(remote.runId,'list_agents',{},'remote')).taskState,'working');
  assert.equal(hints().length,2);
});


test('missing command results break repetition without hiding complete zero-exit empty-output results',async t=>{
  const fake=await harness(t);
  const started=result(await fake.start());await waitDelivered(fake.stateStore,started.messageId);
  const observed=result(await fake.execute(started.runId,'list_agents'));
  const entry=fake.manager.owned(started.runId,'main-1','main-1');
  const session=fake.manager.proxy(entry);session.saveProviderWork?.(initialStrataWorkState(false));
  const commands=Array.from({length:8},(_,index)=>({threadId:observed.threadId,turnId:observed.turnId,
    itemId:`result-${index+1}`,position:index+1,command:'read-current-evidence',cwd:'/review',
    exitCode:index>=2&&index<5?null:0,output:index>=2&&index<5?null:''}));
  let nativeCommands=commands.slice(0,2);
  const native=entry.native;assert.ok(native);
  const snapshot=native.snapshot.bind(native);
  native.snapshot=async input=>({...await snapshot(input),commandFacts:nativeCommands});
  const policy=createStrataWorkPolicy({
    readState:()=>/** @type {import('../../lib/background-agent/strata-work-policy.mjs').StrataWorkState} */(/** @type {unknown} */(session.getProviderWork?.())),
    saveState:state=>session.saveProviderWork?.(/** @type {Record<string,unknown>} */(/** @type {unknown} */(state))),
    clock:fake.clock,workDuration:()=>null,
    send:async({instruction,onAccepted})=>session.sendProgramInstruction?.({threadId:observed.threadId,turnId:observed.turnId,instruction,onAccepted}),
    stop:async()=>{throw new Error('No stop was requested.');},
  });
  const hints=()=>fake.stateStore.messagesAfter({runId:started.runId,direction:'main-to-agent',sequence:0})
    .filter(message=>message.source==='provider-program');
  const consume=async()=>{
    const facts=await session.snapshot({rootThreadId:observed.threadId});
    await policy.observeCommands(facts.commandFacts??[],observed.threadId);
  };
  try {
    await consume();assert.equal(hints().length,0);
    nativeCommands=commands.slice(0,5);await consume();assert.equal(hints().length,0);
    nativeCommands=commands.slice(0,7);await consume();assert.equal(hints().length,0);
    nativeCommands=commands;await consume();
    const delivered=hints();assert.equal(delivered.length,1);
    assert.equal(delivered[0].deliveryStatus,'delivered');assert.equal(delivered[0].threadId,observed.threadId);
  } finally {policy.close();}
});
