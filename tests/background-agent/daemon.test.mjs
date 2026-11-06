import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import fsPromises, {mkdtemp, readFile, readdir, rm, unlink, writeFile} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {createConnection, createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {mock} from 'node:test';
import {createBackgroundAgentDaemon} from '../../lib/background-agent/daemon.mjs';
import {acquireBackgroundAgentMaintenance,acquireBackgroundAgentStartupLease,backgroundAgentMaintenancePorts,controlProof,createBackgroundAgentClient,sendBackgroundAgentRequest} from '../../lib/background-agent/client.mjs';
import {backgroundAgentMessageDatabasePaths} from '../../lib/background-agent/message-store.mjs';
import {appServerProcessIdentityPath, readOperatingSystemProcessCreationTime} from '../../lib/background-agent/process-identity.mjs';
import {createBackgroundAgentStateStore} from '../../lib/background-agent/state-store.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {installAclLog} from '../helpers/process.mjs';

/** @param {string} runId @returns {import('../../lib/background-agent/state-store.mjs').BackgroundAgentRow} */
const maintenanceAgent = runId => ({
  runId,ownerId:'main',role:'spec',ownerTitle:'Original Main',ownerSessionPath:'/main.jsonl',
  threadId:`thread-${runId}`,turnId:'turn',sessionPath:`/${runId}.jsonl`,
  settings:{model:'example',modelProvider:'openai'},cwd:'/work',readPaths:['/input'],writePaths:['/report'],
  instructions:'review',recoveryPath:`/${runId}.recovery.json`,state:'idle',taskState:'ended',stateVersion:3,
  lastUsedAtMs:1000,taskStartedAtMs:900,taskFinishedAtMs:1000,knownThreadIds:[`thread-${runId}`],
});

/** @param {import('node:test').TestContext} t */
async function offlineMaintenance(t) {
  const runtimeDirectory=await createTemporaryDirectory(t,'arw-maintenance-recovery-');
  await writeFile(join(runtimeDirectory,'credential'),'1'.repeat(64),{mode:0o600});
  const identity='2147483647,0';
  await writeFile(appServerProcessIdentityPath(runtimeDirectory),identity,{mode:0o600});
  const store=createBackgroundAgentStateStore({runtimeDirectory,persistenceIntervalMs:60_000});
  await store.loadAgents();
  return {runtimeDirectory,store,identity,port:await freePort(),maintenancePorts:[0],
    observeManagerProcess:async()=>/** @type {const} */('absent')};
}

const freePort=async()=>{
  const server=createServer();
  await new Promise(resolveListen=>server.listen({host:'127.0.0.1',port:0},()=>resolveListen(undefined)));
  const address=server.address();
  await new Promise(resolveClose=>server.close(()=>resolveClose(undefined)));
  if(!address||typeof address!=='object')throw new Error('Ephemeral port is missing.');
  return address.port;
};

test('control authentication keeps the private credential from an unrelated listener', async () => {
  const secret = '1'.repeat(64);
  /** @type {string[]} */
  const received = [];
  const listener = createServer(socket => {
    socket.on('data', chunk => {
      received.push(String(chunk));
      socket.write(`${JSON.stringify({serverNonce:'2'.repeat(32),proof:'0'.repeat(64)})}\n`);
    });
  });
  await new Promise((resolveListen,rejectListen) => {
    listener.once('error',rejectListen);
    listener.listen({host:'127.0.0.1',port:0},() => {listener.off('error',rejectListen); resolveListen(undefined);});
  });
  try {
    const address = listener.address();
    assert.ok(address && typeof address === 'object');
    await assert.rejects(sendBackgroundAgentRequest({port:address.port,message:{id:'1',credential:secret,operation:'list_agents',input:{}}}),/server authentication failed/);
    assert.equal(received.length,1);
    assert.deepEqual(Object.keys(JSON.parse(received[0])).sort(),['hello']);
    assert.equal(received[0].includes(secret),false);
  } finally {await new Promise(resolveClose => listener.close(() => resolveClose(undefined)));}
});

test('daemon decodes a multibyte request split across TCP chunks',async()=>{
  const runtimeDirectory=await mkdtemp(join(tmpdir(),'arw-background-agent-request-utf8-'));
  const daemon=await createBackgroundAgentDaemon({runtimeDirectory,port:0,maintenancePorts:[await freePort()],
    dispatch:async ({input})=>({status:'succeeded',result:input}),
    list:()=>[],prepareMaintenance:async()=>({status:'busy',stoppedAgents:[]}),
  });
  const socket=createConnection({host:'127.0.0.1',port:daemon.port});
  /** @returns {Promise<string>} */
  const readLine=()=>new Promise((resolve,reject)=>{
    let bytes=Buffer.alloc(0);
    const onData=(/** @type {Buffer} */ chunk)=>{
      bytes=Buffer.concat([bytes,chunk]);
      const end=bytes.indexOf(10);
      if(end<0)return;
      socket.off('data',onData);
      socket.off('error',onError);
      resolve(bytes.subarray(0,end).toString('utf8'));
    };
    const onError=(/** @type {Error} */ error)=>{socket.off('data',onData);reject(error);};
    socket.on('data',onData);
    socket.once('error',onError);
  });
  try{
    await once(socket,'connect');
    const secret=(await readFile(join(runtimeDirectory,'credential'),'utf8')).trim();
    const clientNonce='3'.repeat(32);
    const challengeLine=readLine();
    socket.write(`${JSON.stringify({hello:clientNonce})}\n`);
    const challenge=JSON.parse(await challengeLine);
    assert.equal(challenge.proof,controlProof(secret,'server',clientNonce,challenge.serverNonce));
    const request=Buffer.from(`${JSON.stringify({id:'split',auth:controlProof(secret,'client',clientNonce,challenge.serverNonce),ownerId:'main-1',caller:{repositoryRoot:null,programDirectory:'/source'},operation:'send_message',input:{message:'指示🧭完成'}})}\n`);
    const split=request.indexOf(Buffer.from('🧭'))+1;
    assert.ok(split>0);
    socket.setNoDelay(true);
    const responseLine=readLine();
    socket.write(request.subarray(0,split));
    await new Promise(resolve=>setTimeout(resolve,5));
    socket.write(request.subarray(split));
    assert.deepEqual(JSON.parse(await responseLine),{id:'split',ok:true,result:{status:'succeeded',result:{message:'指示🧭完成'}}});
  }finally{
    socket.destroy();
    await daemon.close();
    await rm(runtimeDirectory,{recursive:true,force:true});
  }
});

test('authenticated wait returns one batch after a successful output and cancellation only ends the connection', async () => {
  const runtimeDirectory = await mkdtemp(join(tmpdir(),'arw-background-agent-wait-auth-'));
  let delivered = false;
  let waitingReady = () => {};
  const pendingReady = new Promise(resolve => {waitingReady=()=>resolve(undefined);});
  const daemon = await createBackgroundAgentDaemon({runtimeDirectory,port:0,maintenancePorts:[await freePort()],
    dispatch:async ({operation,emit,signal,input}) => {
      if (operation === 'wait_agent') {
        if (input.cursor === 0) {
          const value={status:'succeeded',result:{cursor:2,notifications:['progress','complete']}};
          await emit(value);
          delivered=true;
          return value;
        }
        waitingReady();
        await new Promise(resolve => {
          if(signal.aborted)resolve(undefined);
          else signal.addEventListener('abort',()=>resolve(undefined),{once:true});
        });
        return {status:'succeeded',result:{cancelled:true}};
      }
      return {status:'succeeded',result:{delivered,workInterrupted:false}};
    },
    list:() => [],prepareMaintenance:async () => ({status:'busy',stoppedAgents:[]}),
  });
  try {
    const client = createBackgroundAgentClient({runtimeDirectory,port:daemon.port,ownerId:'main-1',caller:{repositoryRoot:null,programDirectory:'/source'}});
    const updates=await client.wait({input:{runId:'run-1',cursor:0}});
    assert.deepEqual(updates,{status:'succeeded',result:{cursor:2,notifications:['progress','complete']}});
    const controller = new AbortController();
    const pending=client.wait({input:{runId:'run-1',cursor:2},signal:controller.signal});
    await pendingReady;
    controller.abort();
    assert.deepEqual(await pending,{status:'succeeded',result:{cancelled:true}});
    assert.deepEqual(await client.execute({operation:'list_agents',input:{}}),{status:'succeeded',result:{delivered:true,workInterrupted:false}});
  } finally {await daemon.close();await rm(runtimeDirectory,{recursive:true,force:true});}
});

test('maintenance forwards the idle-eviction authorization separately from stop authorization',async()=>{
  const runtimeDirectory=await mkdtemp(join(tmpdir(),'arw-background-agent-maintenance-options-'));
  const maintenancePorts=[await freePort()];
  /** @type {{stopBackgroundAgents:boolean,allowIdleEviction:boolean}[]} */
  const received=[];
  const daemon=await createBackgroundAgentDaemon({runtimeDirectory,port:0,maintenancePorts,
    dispatch:async()=>({status:'succeeded'}),list:()=>[],
    prepareMaintenance:async options=>{received.push(options);return {status:'busy',stoppedAgents:[]};},
  });
  try{
    const secret=(await readFile(join(runtimeDirectory,'credential'),'utf8')).trim();
    const malformed=await sendBackgroundAgentRequest({port:daemon.port,message:{id:'maintenance',credential:secret,operation:'__maintenance',input:{stopBackgroundAgents:false}}});
    assert.equal(malformed.ok,false);
    assert.deepEqual(received,[]);
    assert.equal((await acquireBackgroundAgentMaintenance({runtimeDirectory,port:daemon.port,maintenancePorts})).status,'busy');
    assert.equal((await acquireBackgroundAgentMaintenance({runtimeDirectory,port:daemon.port,maintenancePorts,stopBackgroundAgents:false,allowIdleEviction:false})).status,'busy');
    assert.equal((await acquireBackgroundAgentMaintenance({runtimeDirectory,port:daemon.port,maintenancePorts,stopBackgroundAgents:true,allowIdleEviction:false})).status,'busy');
    assert.deepEqual(received,[
      {stopBackgroundAgents:false,allowIdleEviction:true},
      {stopBackgroundAgents:false,allowIdleEviction:false},
      {stopBackgroundAgents:true,allowIdleEviction:false},
    ]);
  }finally{await daemon.close();await rm(runtimeDirectory,{recursive:true,force:true});}
});

test('maintenance holds the compatibility port of earlier versions and frees its own port when it cannot', async t => {
  const runtimeDirectory=await createTemporaryDirectory(t,'arw-maintenance-ports-');
  const [maintenance,compatibility]=backgroundAgentMaintenancePorts();
  assert.ok(maintenance>=20000&&maintenance<30000);
  assert.equal(compatibility,maintenance+30000);
  const ports=[await freePort(),await freePort()];
  // An earlier version holds only the compatibility port.
  const earlier=await acquireBackgroundAgentStartupLease({runtimeDirectory,maintenancePorts:[ports[1]]});
  assert.deepEqual(await acquireBackgroundAgentMaintenance({runtimeDirectory,maintenancePorts:ports}),{status:'busy',reason:'Background Agent maintenance or startup is active.',stoppedAgents:[]});
  await earlier.release();
  await assert.rejects(acquireBackgroundAgentStartupLease({runtimeDirectory,maintenancePorts:[ports[0],65536]}),{code:'ERR_SOCKET_BAD_PORT'});
  await assert.rejects(acquireBackgroundAgentStartupLease({runtimeDirectory,maintenancePorts:[65536,ports[1]]}),{code:'ERR_SOCKET_BAD_PORT'});
  // No failure left a port held, and a current holder keeps earlier versions out.
  const current=await acquireBackgroundAgentStartupLease({runtimeDirectory,maintenancePorts:ports});
  try {await assert.rejects(acquireBackgroundAgentStartupLease({runtimeDirectory,maintenancePorts:[ports[1]]}),/EADDRINUSE/);}
  finally {await current.release();}
});

test('a compatibility port the OS refuses is skipped and the maintenance port alone is held', async t => {
  const refused=1;
  const probe=await new Promise(resolve=>{
    const server=createServer();
    server.once('error',error=>resolve(/** @type {NodeJS.ErrnoException} */ (error).code));
    server.listen({host:'127.0.0.1',port:refused},()=>server.close(()=>resolve(null)));
  });
  if(probe!=='EACCES'){t.skip('this environment lets the process bind privileged ports');return;}
  const runtimeDirectory=await createTemporaryDirectory(t,'arw-maintenance-refused-');
  const maintenancePorts=[await freePort(),refused];
  const lease=await acquireBackgroundAgentStartupLease({runtimeDirectory,maintenancePorts});
  try {await assert.rejects(acquireBackgroundAgentStartupLease({runtimeDirectory,maintenancePorts:[maintenancePorts[0]]}),/EADDRINUSE/);}
  finally {await lease.release();}
});

test('authenticated localhost control retains work across client disconnect and fences maintenance', async () => {
  const runtimeDirectory = await mkdtemp(join(tmpdir(), 'arw-background-agent-'));
  const maintenancePorts=[await freePort()];
  let calls = 0;
  const daemon = await createBackgroundAgentDaemon({runtimeDirectory, port: 0,maintenancePorts,
    dispatch: async ({ownerId, caller, operation, emit, signal}) => {
      calls += 1;
      if (operation === 'wait_agent') {
        return {status:'succeeded',result:{notifications:[{sequence:1}],cursor:1}};
      }
      return {status: 'succeeded', result: {ownerId, caller, operation}};
    },
    list: () => [{runId: 'retained'}], prepareMaintenance: async () => ({status: /** @type {const} */ ('ready'), stoppedAgents: []}),
  });
  try {
    const caller = {repositoryRoot: '/source', programDirectory: '/installed'};
    const first = createBackgroundAgentClient({runtimeDirectory, ownerId: 'main-1', caller, port: daemon.port});
    assert.deepEqual(await first.execute({operation: 'list_agents', input: {}}), {status: 'succeeded', result: {ownerId: 'main-1', caller, operation: 'list_agents'}});
    await first.close();
    const second = createBackgroundAgentClient({runtimeDirectory, ownerId: null, port: daemon.port});
    assert.deepEqual(await second.list(), [{runId: 'retained'}]);
    assert.equal(calls, 1);
    const waiting = createBackgroundAgentClient({runtimeDirectory,ownerId:'main-1',caller,port:daemon.port});
    const update = await waiting.wait({input:{runId:'retained',cursor:0}});
    assert.deepEqual(update,{status:'succeeded',result:{notifications:[{sequence:1}],cursor:1}});
    await waiting.close();
    await assert.rejects(sendBackgroundAgentRequest({port: daemon.port, message: {id: 'wrong', credential: '0'.repeat(64), ownerId: 'main-2', caller, operation: 'interrupt_agent', input: {}}}),/server authentication failed/);
    assert.equal(calls, 2);
    const lease = await acquireBackgroundAgentMaintenance({runtimeDirectory, port: daemon.port,maintenancePorts,observeProcessExit:async pid => {
      assert.equal(pid,process.pid);
      return true;
    }});
    assert.equal(lease.status, 'acquired');
    await assert.rejects(acquireBackgroundAgentStartupLease({runtimeDirectory,maintenancePorts}),/EADDRINUSE/);
    if (lease.status === 'acquired') {
      await assert.rejects(sendBackgroundAgentRequest({port: daemon.port, message: {id: 'later', credential: '0'.repeat(64), ownerId: 'main-1', caller, operation: 'spawn_agent', input: {}}}));
    }
  } finally {
    if (daemon.server.listening) await daemon.close();
    await rm(runtimeDirectory, {recursive: true, force: true});
  }
});

test('maintenance observes the owning manager process exit before it acquires the control port', async () => {
  const runtimeDirectory = await mkdtemp(join(tmpdir(),'arw-background-agent-exit-'));
  const maintenancePorts=[await freePort()];
  const moduleUrl = new URL('../../lib/background-agent/daemon.mjs',import.meta.url).href;
  const source = `import {createBackgroundAgentDaemon} from ${JSON.stringify(moduleUrl)};
const daemon=await createBackgroundAgentDaemon({runtimeDirectory:process.argv[1],port:0,maintenancePorts:[${maintenancePorts}],dispatch:async()=>({status:'succeeded'}),list:()=>[],prepareMaintenance:async()=>({status:'ready',stoppedAgents:[]})});
process.stdout.write(String(daemon.port)+'\\n');`;
  const child = spawn(process.execPath,['--input-type=module','-e',source,runtimeDirectory],{stdio:['ignore','pipe','pipe']});
  try {
    const [chunk] = await once(child.stdout,'data');
    const port = Number(String(chunk).trim());
    assert.ok(Number.isSafeInteger(port) && port > 0);
    const lease = await acquireBackgroundAgentMaintenance({runtimeDirectory,port,maintenancePorts});
    assert.deepEqual(lease,{status:'acquired',stoppedAgents:[]});
    if (child.exitCode === null) await once(child,'exit');
    assert.equal(child.exitCode,0);
  } finally {
    if (child.exitCode === null) child.kill();
    await rm(runtimeDirectory,{recursive:true,force:true});
  }
});

test('list distinguishes a never-started private state directory from incomplete state without launching work', async () => {
  const runtimeDirectory = await mkdtemp(join(tmpdir(),'arw-background-agent-empty-'));
  let launched = false;
  try {
    const client = createBackgroundAgentClient({runtimeDirectory,entryPoint:async () => {launched = true;},observeManagerProcess:async () => 'absent'});
    assert.equal(await client.list(),null);
    assert.equal(launched,false);
    const {writeFile} = await import('node:fs/promises');
    await writeFile(join(runtimeDirectory,'messages.sqlite'),'{}\n',{mode:0o600});
    await assert.rejects(client.list(),/incomplete/);
    const maintenance = await acquireBackgroundAgentMaintenance({runtimeDirectory,port:0,maintenancePorts:[await freePort()]});
    assert.equal(maintenance.status,'unknown');
    if (maintenance.status === 'unknown') assert.match(maintenance.reason,/credential is missing/);
    assert.equal(launched,false);
  } finally {await rm(runtimeDirectory,{recursive:true,force:true});}
});

test('maintenance admits consecutive never-started installations without creating a database', async () => {
  const runtimeDirectory=await mkdtemp(join(tmpdir(),'arw-maintenance-empty-'));
  try {
    for(let attempt=0;attempt<2;attempt+=1){
      assert.deepEqual(await acquireBackgroundAgentMaintenance({runtimeDirectory,maintenancePorts:[0]}),{status:'acquired',stoppedAgents:[]});
      assert.deepEqual(await readdir(runtimeDirectory),[]);
    }
  } finally {await rm(runtimeDirectory,{recursive:true,force:true});}
});

test('maintenance rejects every orphaned database file without creating or changing state', async () => {
  const runtimeDirectory=await mkdtemp(join(tmpdir(),'arw-maintenance-orphan-'));
  try {
    for(const path of Object.values(backgroundAgentMessageDatabasePaths(runtimeDirectory))){
      await writeFile(path,'orphaned state',{mode:0o600});
      const result=await acquireBackgroundAgentMaintenance({runtimeDirectory,maintenancePorts:[0]});
      assert.equal(result.status,'unknown');
      if(result.status==='unknown')assert.match(result.reason,/credential is missing/);
      assert.equal(await readFile(path,'utf8'),'orphaned state');
      assert.equal((await readdir(runtimeDirectory)).length,1);
      await unlink(path);
    }
  } finally {await rm(runtimeDirectory,{recursive:true,force:true});}
});

test('maintenance without database state preserves ended identities and rejects live or unknown identities', async () => {
  const runtimeDirectory=await mkdtemp(join(tmpdir(),'arw-maintenance-identity-'));
  const path=appServerProcessIdentityPath(runtimeDirectory);
  try {
    const createdAt=await readOperatingSystemProcessCreationTime(process.pid);
    assert.ok(createdAt);
    for(const [content,expected] of [[`${process.pid},${createdAt}`,'unknown'],['invalid identity','unknown'],[`${process.pid},0`,'acquired']]){
      await writeFile(path,content,{mode:0o600});
      const result=await acquireBackgroundAgentMaintenance({runtimeDirectory,maintenancePorts:[0]});
      assert.equal(result.status,expected);
      if(result.status==='unknown')assert.match(result.reason,content==='invalid identity'?/process exit is unknown\. Process identity is invalid\./:/process exit is unknown/);
      assert.equal(await readFile(path,'utf8'),content);
      assert.deepEqual(await readdir(runtimeDirectory),['app-server-process']);
    }
  } finally {await rm(runtimeDirectory,{recursive:true,force:true});}
});

test('offline maintenance persists ended environments without losing recovery facts and admits retry',async t=>{
  const input=await offlineMaintenance(t);
  const original=maintenanceAgent('finished');
  const paused={...maintenanceAgent('paused'),providerWork:{paused:true}};
  input.store.upsertAgent(original);
  input.store.upsertAgent(paused);
  input.store.acceptMessage({messageId:'latest',runId:original.runId,sequence:20,direction:'agent-to-main',body:'report ready'});
  await input.store.close();
  assert.deepEqual(await acquireBackgroundAgentMaintenance(input),{status:'acquired',stoppedAgents:[]});
  const saved=createBackgroundAgentStateStore({runtimeDirectory:input.runtimeDirectory});
  await saved.loadAgents();
  assert.deepEqual(saved.getAgent(original.runId),{...original,state:'exited',taskState:'unknown',stateVersion:21,providerWork:null});
  assert.deepEqual(saved.getAgent(paused.runId),{...paused,state:'exited',taskState:'working',stateVersion:4});
  assert.equal(saved.getMessage('latest')?.body,'report ready');
  await saved.close();
  assert.equal(await readFile(appServerProcessIdentityPath(input.runtimeDirectory),'utf8'),input.identity);
  assert.deepEqual(await acquireBackgroundAgentMaintenance(input),{status:'acquired',stoppedAgents:[]});
});

test('offline maintenance rejects present or unobservable managers before recovering rows',async t=>{
  const input=await offlineMaintenance(t);
  const original=maintenanceAgent('run');
  input.store.upsertAgent(original);
  await input.store.close();
  for(const state of ['present','unknown']){
    const result=await acquireBackgroundAgentMaintenance({...input,
      observeManagerProcess:async()=>/** @type {'present'|'unknown'} */(state)});
    assert.equal(result.status,'unknown');
    if(result.status==='unknown')assert.match(result.reason,/manager absence/);
  }
  const saved=createBackgroundAgentStateStore({runtimeDirectory:input.runtimeDirectory});
  assert.deepEqual(await saved.loadAgents(),[{...original,providerWork:null}]);
  await saved.close();
  assert.equal(await readFile(appServerProcessIdentityPath(input.runtimeDirectory),'utf8'),input.identity);
});

test('offline maintenance cannot recover rows without reliable old process exit evidence',async t=>{
  const input=await offlineMaintenance(t);
  const original=maintenanceAgent('run');
  input.store.upsertAgent(original);
  await input.store.close();
  const identityPath=appServerProcessIdentityPath(input.runtimeDirectory);
  const createdAt=await readOperatingSystemProcessCreationTime(process.pid);
  assert.ok(createdAt);
  for(const content of [null,'invalid identity',`${process.pid},${createdAt}`]){
    if(content===null)await unlink(identityPath);
    else await writeFile(identityPath,content,{mode:0o600});
    const result=await acquireBackgroundAgentMaintenance(input);
    assert.equal(result.status,'unknown');
    if(result.status==='unknown')assert.match(result.reason,/process exit is unknown/);
  }
  const saved=createBackgroundAgentStateStore({runtimeDirectory:input.runtimeDirectory});
  assert.deepEqual(await saved.loadAgents(),[{...original,providerWork:null}]);
  await saved.close();
  assert.equal(await readFile(identityPath,'utf8'),`${process.pid},${createdAt}`);
});

test('offline maintenance retains unreleased provider leases even when no roots remain',async t=>{
  const input=await offlineMaintenance(t);
  const lease={providerId:'strata',controllerUrl:'http://unused.invalid',leaseKey:'retained-key'};
  input.store.saveProvider(lease);
  await input.store.close();
  for(const state of ['empty','idle']){
    if(state==='idle'){
      const setup=createBackgroundAgentStateStore({runtimeDirectory:input.runtimeDirectory});
      await setup.loadAgents();setup.upsertAgent(maintenanceAgent('run'));await setup.close();
    }
    const result=await acquireBackgroundAgentMaintenance(input);
    assert.equal(result.status,'unknown');
    if(result.status==='unknown')assert.match(result.reason,/unreleased provider lease/);
  }
  const saved=createBackgroundAgentStateStore({runtimeDirectory:input.runtimeDirectory});
  assert.equal((await saved.loadAgents())[0]?.state,'idle');
  assert.deepEqual(saved.listProviders(),[{...lease,lastError:null}]);
  await saved.close();
  assert.equal(await readFile(appServerProcessIdentityPath(input.runtimeDirectory),'utf8'),input.identity);
});

test('offline maintenance preserves exit evidence after a failed recovery save and permits retry',async t=>{
  const input=await offlineMaintenance(t);
  const original=maintenanceAgent('run');
  input.store.upsertAgent(original);
  await input.store.close();
  const database=new DatabaseSync(backgroundAgentMessageDatabasePaths(input.runtimeDirectory).database);
  try{
    database.exec("CREATE TRIGGER reject_recovery BEFORE UPDATE ON agents BEGIN SELECT RAISE(ABORT,'recovery save failed'); END");
    const result=await acquireBackgroundAgentMaintenance(input);
    assert.equal(result.status,'unknown');
    if(result.status==='unknown')assert.match(result.reason,/recovery save failed/);
    const saved=createBackgroundAgentStateStore({runtimeDirectory:input.runtimeDirectory});
    assert.deepEqual(await saved.loadAgents(),[{...original,providerWork:null}]);
    await saved.close();
    assert.equal(await readFile(appServerProcessIdentityPath(input.runtimeDirectory),'utf8'),input.identity);
    database.exec('DROP TRIGGER reject_recovery');
    assert.deepEqual(await acquireBackgroundAgentMaintenance(input),{status:'acquired',stoppedAgents:[]});
  }finally{database.close();}
});

/** @param {string} runtimeDirectory @param {boolean} [runtimeDirectorySecured] */
const startCredentialDaemon=async(runtimeDirectory,runtimeDirectorySecured=false)=>createBackgroundAgentDaemon({runtimeDirectory,port:0,maintenancePorts:[await freePort()],runtimeDirectorySecured,
  dispatch:async()=>({}),list:()=>[],prepareMaintenance:async()=>({status:'ready',stoppedAgents:[]})});

/** @param {import('node:test').TestContext} t @param {(...args:Parameters<typeof fsPromises.link>)=>Promise<void>} replacement */
const mockLink=(t,replacement)=>{
  const original=fsPromises.link;
  mock.method(fsPromises,'link',replacement);
  syncBuiltinESMExports();
  t.after(()=>{mock.restoreAll();syncBuiltinESMExports();});
  return original;
};

test('credential never appears empty or partial while the daemon publishes it',async t=>{
  const runtimeDirectory=await createTemporaryDirectory(t,'arw-credential-atomic-');
  /** @type {{names:string[],content:string}[]} */
  const seen=[];
  const original=mockLink(t,async(existing,target)=>{
    const names=await readdir(runtimeDirectory);
    seen.push({names,content:await readFile(existing,'utf8')});
    return original(existing,target);
  });
  const daemon=await startCredentialDaemon(runtimeDirectory);
  try{
    assert.equal(seen.length,1);
    const observed=seen[0];
    assert.equal(observed.names.includes('credential'),false);
    assert.match(observed.content,/^[a-f0-9]{64}\n$/);
    assert.match(await readFile(join(runtimeDirectory,'credential'),'utf8'),/^[a-f0-9]{64}\n$/);
    assert.deepEqual((await readdir(runtimeDirectory)).filter(name=>name.includes('.arw-tmp-')),[]);
  }finally{await daemon.close();}
});

test('a failed credential publish leaves no temporary file',async t=>{
  const runtimeDirectory=await createTemporaryDirectory(t,'arw-credential-fail-');
  mockLink(t,async()=>{throw Object.assign(new Error('link failed'),{code:'EIO'});});
  await assert.rejects(startCredentialDaemon(runtimeDirectory),/link failed/);
  assert.deepEqual((await readdir(runtimeDirectory)).filter(name=>name.includes('.arw-tmp-')||name==='credential'),[]);
});

test('an existing credential is kept and an invalid one is still rejected',async t=>{
  const runtimeDirectory=await createTemporaryDirectory(t,'arw-credential-existing-');
  await writeFile(join(runtimeDirectory,'credential'),'not a credential\n',{mode:0o600});
  await assert.rejects(startCredentialDaemon(runtimeDirectory),/Background Agent credential is invalid\./);
  assert.equal(await readFile(join(runtimeDirectory,'credential'),'utf8'),'not a credential\n');
  assert.deepEqual((await readdir(runtimeDirectory)).filter(name=>name.includes('.arw-tmp-')),[]);
});

test('a credential published by another process after the pre-check is kept',async t=>{
  const runtimeDirectory=await createTemporaryDirectory(t,'arw-credential-race-');
  const published=`${'a'.repeat(64)}\n`;
  const original=mockLink(t,async(existing,target)=>{
    await writeFile(target,published,{mode:0o600});
    return original(existing,target);
  });
  const daemon=await startCredentialDaemon(runtimeDirectory);
  try{
    assert.equal(await readFile(join(runtimeDirectory,'credential'),'utf8'),published);
    assert.deepEqual((await readdir(runtimeDirectory)).filter(name=>name.includes('.arw-tmp-')),[]);
  }finally{await daemon.close();}
});

test('Windows standalone daemon secures the runtime directory before the credential exists',async t=>{
  const directory=await createTemporaryDirectory(t,'arw-daemon-acl-');
  const calls=await installAclLog(t,directory);
  const daemon=await startCredentialDaemon(directory);
  await daemon.close();
  assert.deepEqual(await calls(),[
    {paths:[directory],secure:true,credential:false},
    {paths:[join(directory,'credential')],secure:true,credential:true},
  ]);
});

test('Windows manager start secures the runtime directory once, before the credential exists',async t=>{
  const directory=await createTemporaryDirectory(t,'arw-manager-start-acl-');
  const calls=await installAclLog(t,directory);
  // The same sequence as the manager entry: the state store opens first, then the daemon is told the directory is secured.
  const store=createBackgroundAgentStateStore({runtimeDirectory:directory});
  await store.loadAgents();
  await store.close();
  const daemon=await startCredentialDaemon(directory,true);
  await daemon.close();
  assert.deepEqual(await calls(),[
    {paths:[directory],secure:true,credential:false},
    {paths:[backgroundAgentMessageDatabasePaths(directory).database],secure:true,credential:false},
    {paths:[join(directory,'credential')],secure:true,credential:true},
  ]);
});
