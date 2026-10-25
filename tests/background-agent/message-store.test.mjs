import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';

import {createBackgroundAgentStateStore} from '../../lib/background-agent/state-store.mjs';
import {backgroundAgentMessageDatabasePaths} from '../../lib/background-agent/message-store.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';

const day = 24*60*60*1000;
/** @param {string} runId @returns {import('../../lib/background-agent/state-store.mjs').BackgroundAgentRow} */
const agent = runId => ({runId,ownerId:'main',role:'worker',ownerTitle:null,ownerSessionPath:null,
  threadId:null,turnId:null,sessionPath:null,settings:{model:'example'},cwd:'/work',readPaths:[],writePaths:[],
  instructions:'work',recoveryPath:null,state:'running',taskState:'working',stateVersion:1,lastUsedAtMs:1000,
  taskStartedAtMs:1000,taskFinishedAtMs:null,knownThreadIds:[]});

test('pages merge saved and dirty messages with bounded previews and no full-history load',async t=>{
  const directory=await createTemporaryDirectory(t,'arw-message-page-');
  const store=createBackgroundAgentStateStore({runtimeDirectory:directory,persistenceIntervalMs:60_000});
  await store.loadAgents();
  store.upsertAgent(agent('run'));
  for(let i=1;i<=4;i++)store.acceptMessage({messageId:`id-${i}`,runId:'run',sequence:i+1,
    direction:'agent-to-main',body:i===1?'😀'.repeat(101):`message ${i}`});
  await store.flush();
  store.updateMessage('id-4',{deliveryStatus:'unknown'});
  store.acceptMessage({messageId:'id-5',runId:'run',sequence:6,direction:'agent-to-main',body:'new in memory'});
  store.acceptMessage({messageId:'other',runId:'run',sequence:7,direction:'main-to-agent',body:'other direction'});

  const first=store.messagePage({runId:'run',direction:'agent-to-main',limit:3});
  assert.deepEqual(first.messages.map(value=>value.messageId),['id-5','id-4','id-3']);
  assert.deepEqual(first.messages.map(value=>value.persistenceStatus),['nonpersisted','nonpersisted','persisted']);
  assert.deepEqual(store.messagePage({runId:'run',direction:'agent-to-main',limit:3,beforeMessageId:first.beforeMessageId}).messages
    .map(value=>value.messageId),['id-2','id-1']);
  assert.equal([.../** @type {string} */ (store.messagePage({runId:'run',direction:'agent-to-main',limit:6}).messages.at(-1)?.preview)].length,100);
  assert.deepEqual(store.messagesAfter({runId:'run',direction:'agent-to-main',sequence:4}).map(value=>value.messageId),['id-4','id-5']);
  assert.equal(store.pendingDelivery({runId:'run',direction:'main-to-agent'})[0]?.body,'other direction');
  assert.throws(()=>store.messagePage({runId:'run',direction:'agent-to-main',beforeMessageId:'other'}),/identity/);
  await store.close();

  const reopened=createBackgroundAgentStateStore({runtimeDirectory:directory});
  await reopened.loadAgents();
  assert.equal(reopened.getMessage('id-5')?.body,'new in memory');
  assert.equal(reopened.getMessage('id-4')?.deliveryStatus,'unknown');
  await reopened.close();
});

test('first delivery time is fixed and expiry clears only delivered rows without an idle write loop',async t=>{
  const directory=await createTemporaryDirectory(t,'arw-message-expiry-');
  let now=1000;
  /** @type {Array<{due:number,callback:()=>void,active:boolean}>} */ const timers=[];
  const clock={now:()=>now,
    setTimeout:/** @type {typeof setTimeout} */ (/** @type {unknown} */ ((/** @type {()=>void} */ callback,/** @type {number} */ delay)=>{
      const timer={due:now+delay,callback,active:true};timers.push(timer);return timer;
    })),
    clearTimeout:/** @type {typeof clearTimeout} */ (/** @type {unknown} */ ((/** @type {{active:boolean}} */ timer)=>{timer.active=false;}))};
  let transactions=0;
  const openDatabase=/** @type {(path:string)=>DatabaseSync} */ (path=>{
    const database=new DatabaseSync(path);
    return new Proxy(database,{get(target,key){
      if(key==='exec')return (/** @type {string} */ sql)=>{if(sql==='BEGIN IMMEDIATE')transactions++;return target.exec(sql);};
      const value=Reflect.get(target,key);
      return typeof value==='function'?value.bind(target):value;
    }});
  });
  const store=createBackgroundAgentStateStore({runtimeDirectory:directory,clock,persistenceIntervalMs:60_000,openDatabase});
  await store.loadAgents();
  store.upsertAgent(agent('run'));
  store.acceptMessage({messageId:'delivered',runId:'run',sequence:2,direction:'agent-to-main',body:'notice'});
  store.acceptMessage({messageId:'unknown',runId:'run',sequence:3,direction:'agent-to-main',body:'uncertain'});
  store.updateMessage('delivered',{deliveryStatus:'delivered'});
  const firstDelivery=store.getMessage('delivered')?.deliveredAtMs;
  await store.flush();
  store.updateMessage('delivered',{deliveryStatus:'failed'});
  now+=10;
  store.updateMessage('delivered',{deliveryStatus:'delivered'});
  assert.equal(store.getMessage('delivered')?.deliveredAtMs,firstDelivery);
  await store.flush();
  const afterChanges=transactions;
  await store.flush();
  assert.equal(transactions,afterChanges);

  now=/** @type {number} */ (firstDelivery)+day;
  for(let step=0;step<10;step++){
    const due=timers.find(timer=>timer.active&&timer.due<=now);
    if(!due)break;
    due.active=false;due.callback();await Promise.resolve();
  }
  assert.equal(store.getMessage('delivered'),null);
  assert.equal(store.getMessage('unknown')?.body,'uncertain');
  const database=new DatabaseSync(backgroundAgentMessageDatabasePaths(directory).database);
  assert.deepEqual(database.prepare('SELECT message_id FROM messages').all().map(row=>({...row})),[{message_id:'unknown'}]);
  database.close();
  await store.close();
});

test('paging fills past expired dirty rows that still appear in saved SQLite rows',async t=>{
  const directory=await createTemporaryDirectory(t,'arw-message-dirty-page-');
  let now=1000;
  const store=createBackgroundAgentStateStore({runtimeDirectory:directory,
    clock:{now:()=>now,setTimeout,clearTimeout},persistenceIntervalMs:60_000});
  await store.loadAgents();
  store.upsertAgent(agent('run'));
  for(let sequence=1;sequence<=5;sequence++)store.acceptMessage({messageId:`id-${sequence}`,runId:'run',
    sequence,direction:'agent-to-main',body:`message ${sequence}`});
  await store.flush();
  store.updateMessage('id-5',{deliveryStatus:'delivered'});
  store.updateMessage('id-4',{deliveryStatus:'delivered'});
  now+=day;

  const first=store.messagePage({runId:'run',direction:'agent-to-main',limit:2});
  assert.deepEqual(first.messages.map(message=>message.messageId),['id-3','id-2']);
  assert.equal(first.beforeMessageId,'id-2');
  assert.deepEqual(store.messagePage({runId:'run',direction:'agent-to-main',limit:2,
    beforeMessageId:first.beforeMessageId}).messages.map(message=>message.messageId),['id-1']);
  await store.close();
});
