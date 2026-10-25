import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {controlProof,createBackgroundAgentClient,sendBackgroundAgentRequest} from '../../lib/background-agent/client.mjs';

const secret='1'.repeat(64);
const serverNonce='2'.repeat(32);

/** @param {(socket:import('node:net').Socket,request:Record<string,unknown>)=>void} onRequest */
async function controlServer(onRequest) {
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
    server.listen({host:'127.0.0.1',port:0},()=>{server.off('error',reject);resolve(undefined);});
  });
  const address=server.address();
  if(!address||typeof address!=='object')throw new Error('Control test port is unavailable.');
  return {port:address.port,close:async()=>{
    for(const socket of sockets)socket.destroy();
    await new Promise(resolve=>server.close(()=>resolve(undefined)));
  }};
}

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
  let launches=0;
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const client=createBackgroundAgentClient({runtimeDirectory,messageTimeoutMs:25,entryPoint:async()=>{
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
  const client=createBackgroundAgentClient({runtimeDirectory,messageTimeoutMs:15,entryPoint:()=>new Promise(()=>{})});
  try {
    await assert.rejects(client.execute({operation:'list_agents',input:{}}),/timed out before delivery/);
  }finally{await client.close();await rm(runtimeDirectory,{recursive:true,force:true});}
});

test('a refused connection cannot restart the ordinary request budget',async t=>{
  const runtimeDirectory=await mkdtemp(join(tmpdir(),'arw-background-agent-retry-'));
  await writeFile(join(runtimeDirectory,'credential'),`${secret}\n`,{mode:0o600});
  const reservation=await controlServer(()=>{});
  const port=reservation.port;
  await reservation.close();
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
