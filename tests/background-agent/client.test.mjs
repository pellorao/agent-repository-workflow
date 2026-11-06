import assert from 'node:assert/strict';
import {chmod,mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {controlProof,createBackgroundAgentClient,sendBackgroundAgentRequest} from '../../lib/background-agent/client.mjs';
import {installFakeCommand} from '../helpers/process.mjs';

const secret='1'.repeat(64);
const serverNonce='2'.repeat(32);

/** @param {(socket:import('node:net').Socket,request:Record<string,unknown>)=>void} onRequest */
async function controlServer(onRequest,port=0) {
  /** @type {Set<import('node:net').Socket>} */
  const sockets=new Set();
  const server=createServer(socket=>{
    sockets.add(socket);
    socket.once('close',()=>sockets.delete(socket));
    let bytes=Buffer.alloc(0);
    let authenticated=false;
    socket.on('data',chunk=>{
      bytes=Buffer.concat([bytes,chunk]);
      const newline=bytes.indexOf(10);
      if(newline<0)return;
      const line=bytes.subarray(0,newline).toString('utf8');
      bytes=bytes.subarray(newline+1);
      if(!authenticated){
        const hello=JSON.parse(line);
        authenticated=true;
        socket.write(`${JSON.stringify({serverNonce,proof:controlProof(secret,'server',hello.hello,serverNonce)})}\n`);
        return;
      }
      onRequest(socket,JSON.parse(line));
    });
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen({host:'127.0.0.1',port},()=>{server.off('error',reject);resolve(undefined);});
  });
  const address=server.address();
  if(!address||typeof address!=='object')throw new Error('Control test port is unavailable.');
  return {port:address.port,close:async()=>{
    for(const socket of sockets)socket.destroy();
    await new Promise(resolve=>server.close(()=>resolve(undefined)));
  }};
}

/** A port nothing listens on, so a client never reaches a manager running on this machine. */
async function closedPort() {
  const reservation=await controlServer(()=>{});
  await reservation.close();
  return reservation.port;
}

/** The startup lease of a manager that is still starting: its port accepts connections. */
const leaseHeldPort=async()=>{
  let connections=0;
  const server=createServer(socket=>{connections++;socket.destroy();});
  await new Promise(resolve=>server.listen({host:'127.0.0.1',port:0},()=>resolve(undefined)));
  const address=server.address();
  if(!address||typeof address!=='object')throw new Error('Lease test port is unavailable.');
  return {port:address.port,connections:()=>connections,close:()=>new Promise(resolve=>server.close(()=>resolve(undefined)))};
};
/** A manager entry that fails at startup the way the real one does. @param {string} directory */
const failingDaemon=async directory=>{
  const entryPoint=join(directory,'failing-daemon.mjs');
  await writeFile(entryPoint,"process.stderr.write('Runtime is broken.\\n');process.exitCode=3;");
  return entryPoint;
};
/** @param {string} directory */
const stderrFiles=async directory=>(await readdir(directory)).filter(name=>name.startsWith('daemon-stderr-'));

/** @param {import('node:net').Socket} socket @param {object} message @param {string} splitText */
function sendSplitLine(socket,message,splitText){
  const bytes=Buffer.from(`${JSON.stringify(message)}\n`);
  const marker=Buffer.from(splitText);
  const at=bytes.indexOf(marker);
  assert.ok(at>=0);
  socket.setNoDelay(true);
  socket.write(bytes.subarray(0,at+1));
  setTimeout(()=>socket.write(bytes.subarray(at+1)),5);
}

test('ordinary control response decodes a multibyte character split across TCP chunks',async()=>{
  const server=await controlServer((socket,request)=>{
    assert.equal(request.operation,'list_agents');
    sendSplitLine(socket,{id:request.id,ok:true,result:{text:'完成🧭通知'}},'🧭');
  });
  try{
    const result=await sendBackgroundAgentRequest({port:server.port,message:{id:'1',credential:secret,operation:'list_agents',input:{}}});
    assert.deepEqual(result,{id:'1',ok:true,result:{text:'完成🧭通知'}});
  }finally{await server.close();}
});

test('wait returns one complete UTF-8 update batch and closing a client cancels pending waits',async()=>{
  const runtimeDirectory=await mkdtemp(join(tmpdir(),'arw-background-agent-utf8-'));
  await writeFile(join(runtimeDirectory,'credential'),`${secret}\n`,{mode:0o600});
  /** @type {() => void} */ let awaiting=()=>{};
  const requestSeen=new Promise(resolve=>{awaiting=()=>resolve(undefined);});
  let calls=0;
  const server=await controlServer((socket,request)=>{
    assert.equal(request.operation,'wait_agent');
    if (++calls===1) sendSplitLine(socket,{id:request.id,ok:true,result:{status:'succeeded',result:{notifications:['进度🧭通知','完成中文'],cursor:2}}},'🧭');
    else awaiting();
  });
  try{
    const client=createBackgroundAgentClient({runtimeDirectory,port:server.port,ownerId:'main-1',caller:{repositoryRoot:null,programDirectory:'/source'}});
    assert.deepEqual(await client.wait({input:{runId:'run-1'}}),{status:'succeeded',result:{notifications:['进度🧭通知','完成中文'],cursor:2}});
    const waiting=client.wait({input:{runId:'run-1',cursor:2}});
    await requestSeen;
    await client.close();
    assert.deepEqual(await waiting,{status:'succeeded',result:{cancelled:true}});
  }finally{await server.close();await rm(runtimeDirectory,{recursive:true,force:true});}
});

test('ordinary request budget covers a partial response and timeout leaves acceptance unknown',async()=>{
  let requests=0;
  const server=await controlServer((socket,request)=>{requests++;socket.write(`${JSON.stringify({id:request.id,ok:true})}`);});
  try {
    await assert.rejects(sendBackgroundAgentRequest({port:server.port,message:{id:'1',credential:secret,operation:'send_message',input:{message:'once'}},timeoutMs:20}),/timed out; acceptance is unknown/);
    assert.equal(requests,1);
  }finally{await server.close();}
});

test('cold credential and manager startup share one pre-delivery budget',async t=>{
  const runtimeDirectory=await mkdtemp(join(tmpdir(),'arw-background-agent-budget-'));
  const port=await closedPort();
  let launches=0;
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const client=createBackgroundAgentClient({runtimeDirectory,port,messageTimeoutMs:25,entryPoint:async()=>{
    launches++;t.mock.timers.setTime(1025);
    await writeFile(join(runtimeDirectory,'credential'),`${secret}\n`,{mode:0o600});
  }});
  try {
    await assert.rejects(client.execute({operation:'list_agents',input:{}}),/timed out before delivery/);
    assert.equal(launches,1);
  }finally{await client.close();await rm(runtimeDirectory,{recursive:true,force:true});}
});

test('a stalled cold launch cannot hold the control call beyond its budget',async()=>{
  const runtimeDirectory=await mkdtemp(join(tmpdir(),'arw-background-agent-stalled-'));
  const client=createBackgroundAgentClient({runtimeDirectory,port:await closedPort(),messageTimeoutMs:15,entryPoint:()=>new Promise(()=>{})});
  try {
    await assert.rejects(client.execute({operation:'list_agents',input:{}}),/timed out before delivery/);
  }finally{await client.close();await rm(runtimeDirectory,{recursive:true,force:true});}
});

test('a refused connection cannot restart the ordinary request budget',async t=>{
  const runtimeDirectory=await mkdtemp(join(tmpdir(),'arw-background-agent-retry-'));
  await writeFile(join(runtimeDirectory,'credential'),`${secret}\n`,{mode:0o600});
  const port=await closedPort();
  let launches=0;
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const client=createBackgroundAgentClient({runtimeDirectory,port,messageTimeoutMs:25,entryPoint:async()=>{
    launches++;t.mock.timers.setTime(1025);
  }});
  try {
    await assert.rejects(client.execute({operation:'list_agents',input:{}}),/timed out before delivery/);
    assert.equal(launches,1);
  }finally{await client.close();await rm(runtimeDirectory,{recursive:true,force:true});}
});

test('a manager launch that cannot write its state asks for a rerun outside the sandbox',async()=>{
  const parent=await mkdtemp(join(tmpdir(),'arw-background-agent-sandbox-'));
  await chmod(parent,0o500);
  const client=createBackgroundAgentClient({runtimeDirectory:join(parent,'runtime'),port:await closedPort(),entryPoint:'/unused-entry.mjs'});
  try {
    await assert.rejects(client.execute({operation:'list_agents',input:{}}),/blocked by the sandbox\. Rerun this same command with escalated permissions/);
  }finally{await client.close();await chmod(parent,0o700);await rm(parent,{recursive:true,force:true});}
});

test('two concurrent cold launches whose managers exit while another manager keeps starting time out and leave no standard error file',async()=>{
  const runtimeDirectory=await mkdtemp(join(tmpdir(),'arw-background-agent-probe-'));
  const port=await closedPort();
  const lease=await leaseHeldPort();
  // The budget is far above the time the failing entry needs to exit, so a lease probe proves the exit was seen.
  // Only the compatibility port is held, as by an earlier version's manager.
  const client=createBackgroundAgentClient({runtimeDirectory,port,maintenancePorts:[await closedPort(),lease.port],messageTimeoutMs:400,entryPoint:await failingDaemon(runtimeDirectory)});
  try {
    const results=await Promise.allSettled([1,2].map(()=>client.execute({operation:'list_agents',input:{}})));
    for(const result of results)assert.match(String(/** @type {PromiseRejectedResult} */(result).reason?.message),/timed out before delivery/);
    assert.ok(lease.connections()>0);
    assert.deepEqual(await stderrFiles(runtimeDirectory),[]);
  }finally{await lease.close();await client.close();await rm(runtimeDirectory,{recursive:true,force:true});}
});

test('a manager that exits during startup is reported at once with its standard error',async()=>{
  const runtimeDirectory=await mkdtemp(join(tmpdir(),'arw-background-agent-exit-'));
  const client=createBackgroundAgentClient({runtimeDirectory,port:await closedPort(),maintenancePorts:[await closedPort()],messageTimeoutMs:30000,entryPoint:await failingDaemon(runtimeDirectory)});
  try {
    const started=Date.now();
    await assert.rejects(client.execute({operation:'list_agents',input:{}}),/^Error: Background Agent manager exited during startup \(exit code 3\): Runtime is broken\.$/);
    assert.ok(Date.now()-started<20000);
    assert.deepEqual(await stderrFiles(runtimeDirectory),[]);
  }finally{await client.close();await rm(runtimeDirectory,{recursive:true,force:true});}
});

test('a request reads the credential only after the control port accepts connections',async()=>{
  const runtimeDirectory=await mkdtemp(join(tmpdir(),'arw-background-agent-ready-'));
  const port=await closedPort();
  // Another client's manager has published its credential but not yet secured it or started listening.
  await writeFile(join(runtimeDirectory,'credential'),`${secret}\n`,{mode:0o644});
  const lease=await leaseHeldPort();
  const client=createBackgroundAgentClient({runtimeDirectory,port,maintenancePorts:[lease.port],entryPoint:'/unused-entry.mjs'});
  /** @type {{close:()=>Promise<void>}[]} */
  const servers=[lease];
  const manager=(async()=>{
    await new Promise(resolve=>setTimeout(resolve,30));
    await chmod(join(runtimeDirectory,'credential'),0o600);
    servers.push(await controlServer((socket,request)=>socket.write(`${JSON.stringify({id:request.id,ok:true,result:{late:true}})}\n`),port));
  })();
  try {
    assert.deepEqual(await client.execute({operation:'list_agents',input:{}}),{late:true});
    assert.deepEqual(await stderrFiles(runtimeDirectory),[]);
  }finally{await manager;for(const server of servers)await server.close();await client.close();await rm(runtimeDirectory,{recursive:true,force:true});}
});

test('a missing credential fails with ENOENT before any PowerShell process starts',async t=>{
  const runtimeDirectory=await mkdtemp(join(tmpdir(),'arw-background-agent-missing-'));
  const log=join(runtimeDirectory,'calls.log');
  await installFakeCommand(t,runtimeDirectory,'powershell.exe',`echo called >> "${log}"\n`);
  const platform=/** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(process,'platform'));
  Object.defineProperty(process,'platform',{value:'win32'});
  t.after(()=>Object.defineProperty(process,'platform',platform));
  const client=createBackgroundAgentClient({runtimeDirectory});
  try {
    await assert.rejects(client.execute({operation:'list_agents',input:{}}),{code:'ENOENT'});
    await assert.rejects(readFile(log),{code:'ENOENT'});
  }finally{await client.close();await rm(runtimeDirectory,{recursive:true,force:true});}
});
