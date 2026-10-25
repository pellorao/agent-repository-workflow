import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';

import {createBackgroundAgentStateStore} from '../../lib/background-agent/state-store.mjs';
import {backgroundAgentMessageDatabasePaths} from '../../lib/background-agent/message-store.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';

/** @param {string} runId @returns {import('../../lib/background-agent/state-store.mjs').BackgroundAgentRow} */
export const agentRow = runId => ({
  runId,ownerId:'main',role:'worker',ownerTitle:null,ownerSessionPath:null,threadId:null,turnId:null,sessionPath:null,
  settings:{model:'example'},cwd:'/work',readPaths:[],writePaths:[],instructions:'review',recoveryPath:null,
  state:'starting',taskState:'not-started',stateVersion:1,lastUsedAtMs:1000,
  taskStartedAtMs:null,taskFinishedAtMs:null,knownThreadIds:[],
});

test('one SQLite transaction saves the latest Agent row and every distinct message',async t=>{
  const directory=await createTemporaryDirectory(t,'arw-agent-batch-');
  const store=createBackgroundAgentStateStore({runtimeDirectory:directory,persistenceIntervalMs:60_000});
  assert.deepEqual(await store.loadAgents(),[]);
  const first=agentRow('run');
  store.upsertAgent(first);
  store.upsertAgent({...first,state:'running',taskState:'working',stateVersion:2,taskStartedAtMs:1001});
  store.acceptMessage({messageId:'one',runId:'run',sequence:3,direction:'main-to-agent',body:'first'});
  store.acceptMessage({messageId:'two',runId:'run',sequence:4,direction:'agent-to-main',body:'second'});
  assert.equal(store.getAgent('run')?.state,'running');
  assert.equal(store.messagePage({runId:'run',direction:'main-to-agent'}).messages[0]?.persistenceStatus,'nonpersisted');

  const path=backgroundAgentMessageDatabasePaths(directory).database;
  const before=new DatabaseSync(path);
  assert.equal(before.prepare('SELECT count(*) AS count FROM agents').get()?.count,0);
  assert.equal(before.prepare('SELECT count(*) AS count FROM messages').get()?.count,0);
  before.close();
  await store.flush();
  assert.equal(store.recoveryIncomplete,false);
  await store.close();

  const saved=new DatabaseSync(path);
  assert.deepEqual(saved.prepare('SELECT state,state_version FROM agents').all().map(row=>({...row})),[{state:'running',state_version:2}]);
  assert.deepEqual(saved.prepare('SELECT message_id FROM messages ORDER BY sequence').all().map(row=>({...row})),[{message_id:'one'},{message_id:'two'}]);
  saved.close();
  const reopened=createBackgroundAgentStateStore({runtimeDirectory:directory});
  assert.deepEqual((await reopened.loadAgents()).map(row=>row.runId),['run']);
  assert.equal(reopened.getMessage('one')?.body,'first');
  await reopened.close();
});

test('failed batch rolls back, gates new acceptance, then retries without stopping old updates',async t=>{
  const directory=await createTemporaryDirectory(t,'arw-agent-rollback-');
  const store=createBackgroundAgentStateStore({runtimeDirectory:directory,persistenceIntervalMs:60_000});
  await store.loadAgents();
  store.upsertAgent(agentRow('run'));
  store.acceptMessage({messageId:'one',runId:'run',sequence:2,direction:'main-to-agent',body:'first'});
  const database=new DatabaseSync(backgroundAgentMessageDatabasePaths(directory).database);
  database.exec("CREATE TRIGGER reject_message BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'injected batch failure'); END");
  await assert.rejects(store.flush(),/injected batch failure/);
  assert.equal(database.prepare('SELECT count(*) AS count FROM agents').get()?.count,0);
  assert.equal(database.prepare('SELECT count(*) AS count FROM messages').get()?.count,0);
  assert.throws(()=>store.assertCanAccept(),error=>error instanceof Error
    && 'code' in error && error.code==='background-agent-persistence-unavailable'
    && /injected batch failure/.test(error.message));
  store.upsertAgent({...agentRow('run'),state:'running',stateVersion:3});
  store.updateMessage('one',{deliveryStatus:'unknown'});
  assert.equal(store.getAgent('run')?.state,'running');
  assert.equal(store.getMessage('one')?.deliveryStatus,'unknown');
  database.exec('DROP TRIGGER reject_message');
  await store.flush();
  assert.doesNotThrow(()=>store.assertCanAccept());
  assert.deepEqual(database.prepare('SELECT state,state_version FROM agents').all().map(row=>({...row})),[{state:'running',state_version:3}]);
  assert.deepEqual(database.prepare('SELECT message_id,delivery_status FROM messages').all().map(row=>({...row})),[{message_id:'one',delivery_status:'unknown'}]);
  database.close();
  await store.close();
});

test('batch timing stays anchored to the first dirty row and never polls when clean',async t=>{
  const directory=await createTemporaryDirectory(t,'arw-agent-timer-');
  let now=0;
  /** @type {Array<{due:number,callback:()=>void,active:boolean}>} */ const timers=[];
  const clock={now:()=>now,
    setTimeout:/** @type {typeof setTimeout} */ (/** @type {unknown} */ ((/** @type {()=>void} */ callback,/** @type {number} */ delay)=>{
      const timer={due:now+delay,callback,active:true};timers.push(timer);return timer;
    })),
    clearTimeout:/** @type {typeof clearTimeout} */ (/** @type {unknown} */ ((/** @type {{active:boolean}} */ timer)=>{timer.active=false;}))};
  const store=createBackgroundAgentStateStore({runtimeDirectory:directory,clock,persistenceIntervalMs:1000});
  await store.loadAgents();
  assert.equal(timers.filter(timer=>timer.active).length,0);
  store.upsertAgent(agentRow('run'));
  now=500;
  store.upsertAgent({...agentRow('run'),state:'running',stateVersion:2});
  assert.equal(timers.find(timer=>timer.active)?.due,1000);
  now=1000;
  const due=timers.find(timer=>timer.active);
  if(due)due.active=false;
  due?.callback();
  await Promise.resolve();
  const database=new DatabaseSync(backgroundAgentMessageDatabasePaths(directory).database);
  assert.equal(database.prepare('SELECT state FROM agents WHERE run_id=?').get('run')?.state,'running');
  assert.equal(timers.filter(timer=>timer.active).length,0);
  store.updateProviderError({providerId:'strata',lastError:'controller unavailable'});
  assert.equal(timers.find(timer=>timer.active)?.due,2000);
  now=2000;
  const providerDue=timers.find(timer=>timer.active);
  if(providerDue)providerDue.active=false;
  providerDue?.callback();
  await Promise.resolve();
  assert.equal(database.prepare('SELECT last_error FROM providers').get()?.last_error,'controller unavailable');
  assert.equal(timers.filter(timer=>timer.active).length,0);
  database.close();
  await store.close();
});

test('a row changed during commit remains dirty for the next transaction',async t=>{
  const directory=await createTemporaryDirectory(t,'arw-agent-version-');
  /** @type {ReturnType<typeof createBackgroundAgentStateStore>|null} */ let store=null;
  let injected=false;
  const openDatabase=/** @type {(path:string)=>DatabaseSync} */ (path=>{
    const database=new DatabaseSync(path);
    return new Proxy(database,{get(target,key){
      if(key==='prepare')return (/** @type {string} */ sql)=>{
        const statement=target.prepare(sql);
        if(!sql.startsWith('INSERT INTO agents'))return statement;
        return new Proxy(statement,{get(inner,method){
          if(method==='run')return /** @type {typeof inner.run} */ ((...args)=>{
            const result=inner.run(.../** @type {Parameters<typeof inner.run>} */ (args));
            if(!injected){injected=true;store?.upsertAgent({...agentRow('run'),state:'running',stateVersion:2});}
            return result;
          });
          const value=Reflect.get(inner,method);
          return typeof value==='function'?value.bind(inner):value;
        }});
      };
      const value=Reflect.get(target,key);
      return typeof value==='function'?value.bind(target):value;
    }});
  });
  store=createBackgroundAgentStateStore({runtimeDirectory:directory,persistenceIntervalMs:60_000,openDatabase});
  await store.loadAgents();
  store.upsertAgent(agentRow('run'));
  await store.flush();
  assert.equal(store.recoveryIncomplete,true);
  assert.equal(store.getAgent('run')?.stateVersion,2);
  await store.flush();
  assert.equal(store.recoveryIncomplete,false);
  await store.close();
  const database=new DatabaseSync(backgroundAgentMessageDatabasePaths(directory).database);
  assert.equal(database.prepare('SELECT state_version FROM agents WHERE run_id=?').get('run')?.state_version,2);
  database.close();
});

test('persisted exited Agents and delivered message bodies are read on demand',async t=>{
  const directory=await createTemporaryDirectory(t,'arw-agent-release-');
  const store=createBackgroundAgentStateStore({runtimeDirectory:directory,persistenceIntervalMs:60_000});
  await store.loadAgents();
  store.upsertAgent({...agentRow('run'),state:'exited',taskState:'ended',stateVersion:2});
  store.acceptMessage({messageId:'notice',runId:'run',sequence:3,direction:'agent-to-main',body:'original'});
  store.updateMessage('notice',{deliveryStatus:'delivered'});
  await store.flush();
  assert.deepEqual(await store.loadAgents(),[]);
  const database=new DatabaseSync(backgroundAgentMessageDatabasePaths(directory).database);
  database.prepare('UPDATE agents SET last_used_at_ms=? WHERE run_id=?').run(1002,'run');
  database.prepare('UPDATE messages SET body=? WHERE message_id=?').run('saved body','notice');
  assert.equal(store.getAgent('run')?.lastUsedAtMs,1002);
  assert.equal(store.latestMessageSequence('run'),3);
  assert.equal(store.getMessage('notice')?.body,'saved body');
  store.acceptMessage({messageId:'followup',runId:'run',sequence:4,direction:'main-to-agent',body:'Continue the original thread.'});
  assert.equal(store.releaseAgent('run'),false);
  await store.flush();
  assert.equal(store.releaseAgent('run'),true);
  assert.equal(store.getAgent('run')?.state,'exited');
  assert.equal(store.latestMessageSequence('run'),4);
  database.close();
  await store.close();
  assert.throws(()=>store.getMessage('notice'),/not open/);
});

test('successful batches notify release observers after the matching dirty Agent row is saved',async t=>{
  const directory=await createTemporaryDirectory(t,'arw-agent-persist-notice-');
  const store=createBackgroundAgentStateStore({runtimeDirectory:directory,persistenceIntervalMs:60_000});
  await store.loadAgents();
  store.upsertAgent({...agentRow('run'),state:'exited',taskState:'ended'});
  assert.equal(store.isAgentPersisted('run'),false);
  /** @type {Array<{persisted:boolean,released:boolean}>} */ const notifications=[];
  const unsubscribe=store.onPersisted(()=>{
    notifications.push({persisted:store.isAgentPersisted('run'),released:store.releaseAgent('run')});
  });
  await store.flush();
  assert.deepEqual(notifications,[{persisted:true,released:true}]);
  unsubscribe();
  store.upsertAgent({...agentRow('run'),state:'exited',taskState:'ended',stateVersion:2});
  await store.flush();
  assert.equal(notifications.length,1);
  await store.close();
});

test('a failed Agent-row load can retry after the saved row is repaired',async t=>{
  const directory=await createTemporaryDirectory(t,'arw-agent-load-');
  const path=backgroundAgentMessageDatabasePaths(directory).database;
  const first=createBackgroundAgentStateStore({runtimeDirectory:directory});
  await first.loadAgents();
  first.upsertAgent(agentRow('run'));
  await first.close();

  const database=new DatabaseSync(path);
  database.prepare('UPDATE agents SET settings_json=? WHERE run_id=?').run('{','run');
  const reopened=createBackgroundAgentStateStore({runtimeDirectory:directory});
  await assert.rejects(reopened.loadAgents(),SyntaxError);
  database.prepare('UPDATE agents SET settings_json=? WHERE run_id=?').run('{}','run');
  assert.deepEqual((await reopened.loadAgents()).map(row=>row.runId),['run']);
  database.close();
  await reopened.close();
});

test('provider lease saves and deletes immediately without changing its held address or flushing Agents',async t=>{
  const directory=await createTemporaryDirectory(t,'arw-provider-immediate-');
  const path=backgroundAgentMessageDatabasePaths(directory).database;
  const store=createBackgroundAgentStateStore({runtimeDirectory:directory,persistenceIntervalMs:60_000});
  await store.loadAgents();
  store.upsertAgent(agentRow('pending'));
  const first={providerId:'strata',controllerUrl:'http://127.0.0.1:8101',leaseKey:'private-lease'};
  store.saveProvider(first);
  const second=new DatabaseSync(path);
  assert.deepEqual(second.prepare('SELECT provider_id,controller_url,lease_key FROM providers').all().map(row=>({...row})),
    [{provider_id:'strata',controller_url:first.controllerUrl,lease_key:first.leaseKey}]);
  assert.equal(second.prepare('SELECT count(*) AS count FROM agents').get()?.count,0);
  assert.equal(store.recoveryIncomplete,true);
  store.saveProvider({...first,controllerUrl:'http://127.0.0.2:8101'});
  assert.equal(second.prepare('SELECT controller_url FROM providers').get()?.controller_url,first.controllerUrl);
  assert.throws(()=>store.saveProvider({...first,leaseKey:'different-lease'}),/different lease/);
  assert.doesNotThrow(()=>store.assertCanAccept());
  assert.equal(second.prepare('SELECT lease_key FROM providers').get()?.lease_key,first.leaseKey);
  store.deleteProvider('strata');
  assert.deepEqual(store.listProviders(),[]);
  assert.equal(second.prepare('SELECT count(*) AS count FROM providers').get()?.count,0);
  assert.equal(second.prepare('SELECT count(*) AS count FROM agents').get()?.count,0);
  second.close();
  await store.close();
});

test('failed provider transactions leave the saved lease and pending Agent batch intact',async t=>{
  const directory=await createTemporaryDirectory(t,'arw-provider-failure-');
  const path=backgroundAgentMessageDatabasePaths(directory).database;
  const store=createBackgroundAgentStateStore({runtimeDirectory:directory,persistenceIntervalMs:60_000});
  await store.loadAgents();
  const lease={providerId:'strata',controllerUrl:'http://127.0.0.1:8101',leaseKey:'private-lease'};
  store.upsertAgent(agentRow('pending'));
  const second=new DatabaseSync(path);
  second.exec("CREATE TRIGGER reject_provider BEFORE INSERT ON providers BEGIN SELECT RAISE(ABORT,'injected provider failure'); END");
  assert.throws(()=>store.saveProvider(lease),/injected provider failure/);
  assert.throws(()=>store.assertCanAccept(),/injected provider failure/);
  assert.deepEqual(store.listProviders(),[]);
  assert.equal(second.prepare('SELECT count(*) AS count FROM agents').get()?.count,0);
  store.updateProviderError({providerId:'strata',lastError:'injected provider failure'});
  second.exec('DROP TRIGGER reject_provider');
  await store.flush();
  assert.doesNotThrow(()=>store.assertCanAccept());
  store.saveProvider(lease);
  second.exec("CREATE TRIGGER reject_provider_delete BEFORE DELETE ON providers BEGIN SELECT RAISE(ABORT,'injected delete failure'); END");
  assert.throws(()=>store.deleteProvider('strata'),/injected delete failure/);
  assert.throws(()=>store.assertCanAccept(),/injected delete failure/);
  store.updateProviderError({providerId:'strata',lastError:'injected delete failure'});
  assert.deepEqual(store.listProviders(),[{...lease,lastError:'injected delete failure'}]);
  second.exec('DROP TRIGGER reject_provider_delete');
  await store.flush();
  assert.doesNotThrow(()=>store.assertCanAccept());
  second.close();
  await store.close();
  const reopened=createBackgroundAgentStateStore({runtimeDirectory:directory});
  await reopened.loadAgents();
  assert.deepEqual(reopened.listProviders(),[{...lease,lastError:'injected delete failure'}]);
  await reopened.close();
});

test('provider errors batch the latest fact, retain the held key, and never revive a confirmed deletion',async t=>{
  const directory=await createTemporaryDirectory(t,'arw-provider-errors-');
  const path=backgroundAgentMessageDatabasePaths(directory).database;
  const store=createBackgroundAgentStateStore({runtimeDirectory:directory,persistenceIntervalMs:60_000});
  await store.loadAgents();
  const database=new DatabaseSync(path);
  store.updateProviderError({providerId:'strata',lastError:'launcher failed'});
  store.updateProviderError({providerId:'strata',lastError:'controller unavailable'});
  assert.deepEqual(store.getProvider('strata'),{providerId:'strata',controllerUrl:null,
    leaseKey:null,lastError:'controller unavailable'});
  assert.equal(database.prepare('SELECT count(*) AS count FROM providers').get()?.count,0);
  assert.equal(store.recoveryIncomplete,true);
  await store.flush();
  assert.deepEqual(database.prepare('SELECT provider_id,controller_url,lease_key,last_error FROM providers').all()
    .map(row=>({...row})),[{provider_id:'strata',controller_url:null,lease_key:null,last_error:'controller unavailable'}]);
  store.updateProviderError({providerId:'strata',controllerUrl:'http://old:8101',lastError:'acquire rejected'});
  const lease={providerId:'strata',controllerUrl:'http://new:8101',leaseKey:'private-lease'};
  store.saveProvider(lease);
  assert.deepEqual(store.getProvider('strata'),{...lease,lastError:'acquire rejected'});
  assert.deepEqual({...database.prepare('SELECT controller_url,lease_key,last_error FROM providers').get()},
    {controller_url:'http://new:8101',lease_key:'private-lease',last_error:'controller unavailable'});
  store.updateProviderError({providerId:'strata',controllerUrl:'http://wrong:8101',lastError:'start failed'});
  assert.deepEqual(store.getProvider('strata'),{...lease,lastError:'start failed'});
  await store.flush();
  assert.deepEqual({...database.prepare('SELECT controller_url,lease_key,last_error FROM providers').get()},
    {controller_url:'http://new:8101',lease_key:'private-lease',last_error:'start failed'});
  store.updateProviderError({providerId:'strata',lastError:null});
  assert.equal(store.getProvider('strata')?.lastError,null);
  await store.flush();
  assert.equal(database.prepare('SELECT last_error FROM providers').get()?.last_error,null);
  store.updateProviderError({providerId:'strata',lastError:'return uncertain'});
  store.deleteProvider('strata');
  assert.equal(store.getProvider('strata'),null);
  await store.flush();
  assert.equal(database.prepare('SELECT count(*) AS count FROM providers').get()?.count,0);
  database.close();
  await store.close();
  const reopened=createBackgroundAgentStateStore({runtimeDirectory:directory});
  await reopened.loadAgents();
  assert.deepEqual(reopened.listProviders(),[]);
  await reopened.close();
});

test('provider-error batch failure keeps the newest fact and blocks acceptance until retry',async t=>{
  const directory=await createTemporaryDirectory(t,'arw-provider-error-retry-');
  const path=backgroundAgentMessageDatabasePaths(directory).database;
  const store=createBackgroundAgentStateStore({runtimeDirectory:directory,persistenceIntervalMs:60_000});
  await store.loadAgents();
  store.upsertAgent(agentRow('pending'));
  store.updateProviderError({providerId:'strata',lastError:'first failure'});
  const database=new DatabaseSync(path);
  database.exec("CREATE TRIGGER reject_error BEFORE INSERT ON providers BEGIN SELECT RAISE(ABORT,'injected provider batch failure'); END");
  await assert.rejects(store.flush(),/injected provider batch failure/);
  assert.equal(database.prepare('SELECT count(*) AS count FROM agents').get()?.count,0);
  assert.equal(database.prepare('SELECT count(*) AS count FROM providers').get()?.count,0);
  assert.throws(()=>store.assertCanAccept(),/injected provider batch failure/);
  store.updateProviderError({providerId:'strata',lastError:'latest failure'});
  assert.equal(store.getProvider('strata')?.lastError,'latest failure');
  database.exec('DROP TRIGGER reject_error');
  await store.flush();
  assert.doesNotThrow(()=>store.assertCanAccept());
  assert.deepEqual(database.prepare('SELECT last_error FROM providers').all().map(row=>row.last_error),['latest failure']);
  assert.equal(database.prepare('SELECT count(*) AS count FROM agents').get()?.count,1);
  database.close();
  await store.close();
});
