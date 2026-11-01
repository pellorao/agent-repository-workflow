import assert from 'node:assert/strict';
import test from 'node:test';

import {createStrataDriver} from '../../lib/background-agent/strata-driver.mjs';
import {resolveStrataModel} from '../../lib/background-agent/strata-models.mjs';
import {strataTiers as tiers} from '../helpers/strata-installation.mjs';

const controllerUrl='http://192.0.2.10:8101';
const modelId='family-alpha';
const provider={driver:/** @type {const} */('strata'),installationDirectory:'/installed/strata'};
const deployment={models:['Alpha','Beta'],context_tiers:{Alpha:tiers,Beta:[]}};

/** Installation files served from memory; records every path read.
 * @param {Record<string,unknown>} files */
const installation=files=>{
  /** @type {string[]} */ const reads=[];
  return {reads,readText:/** @param {string} path */ async path=>{
    reads.push(path);
    const name=path.replace('/installed/strata/config/','');
    if(!Object.hasOwn(files,name))throw new Error('ENOENT');
    return typeof files[name]==='string'?files[name]:JSON.stringify(files[name]);
  }};
};
const frontend={listen_address:'192.0.2.10',port:8101};

test('Strata driver reads only the frontend file and uses the frontend routes and success checks',async()=>{
  const files=installation({'frontend.json':frontend,'deployment.json':deployment});
  /** @type {Array<{path:string,method:string,body:unknown,authorization:string|undefined}>} */ const requests=[];
  let status='starting';
  const driver=createStrataDriver({...provider,contextWindow:2000},{readText:files.readText,
    fetchImpl:/** @type {typeof fetch} */ (async(url,init)=>{
      const path=new URL(String(url)).pathname;
      requests.push({path,method:String(init?.method),body:init?.body===undefined?null:JSON.parse(String(init.body)),
        authorization:new Headers(init?.headers).get('Authorization')??undefined});
      if(path==='/lease/acquire')return new Response(JSON.stringify({key:'private-lease',lease:'held'}));
      if(path==='/model/start')return new Response(JSON.stringify({status:'running',model:modelId}));
      if(path==='/model/status')return new Response(JSON.stringify({status,model:status==='running'?modelId:null}));
      if(path==='/model/stop')return new Response(JSON.stringify({status:'stopped',clean_unload:true}));
      return new Response(JSON.stringify({lease:'free'}));
    }),
  });
  assert.deepEqual(await driver.connect(),{controllerUrl,responsesUrl:`${controllerUrl}/strata/v1`});
  assert.deepEqual(files.reads,['/installed/strata/config/frontend.json']);
  assert.deepEqual(await driver.acquire({controllerUrl}),{leaseKey:'private-lease'});
  const lease={controllerUrl,leaseKey:'private-lease'};
  assert.deepEqual(await driver.status(lease),{status:'partial',model:null});
  assert.deepEqual(await driver.start({...lease,modelId}),{status:'running',model:modelId});
  status='running';
  assert.deepEqual(await driver.status(lease),{status:'running',model:modelId});
  assert.deepEqual(await driver.stop(lease),{status:'stopped',cleanUnload:true});
  assert.deepEqual(await driver.release(lease),{ownership:'free',previousKeyRevoked:true});
  assert.deepEqual(requests.map(item=>[item.method,item.path,item.authorization]),[
    ['POST','/lease/acquire',undefined],['GET','/model/status','Bearer private-lease'],['POST','/model/start','Bearer private-lease'],
    ['GET','/model/status','Bearer private-lease'],['POST','/model/stop','Bearer private-lease'],['POST','/lease/release','Bearer private-lease']]);
  assert.deepEqual(requests[2].body,{model:'Alpha',context_window:2000});
});

test('Strata driver reports invalid frontend files, refusals and unconfirmed transitions without leaking the key',async()=>{
  for(const bad of [undefined,'not JSON',{listen_address:'',port:8101},{listen_address:'192.0.2.10',port:0},{listen_address:'192.0.2.10',port:'8101'}]){
    const files=installation(bad===undefined?{}:{'frontend.json':bad});
    await assert.rejects(createStrataDriver(provider,{readText:files.readText}).connect(),/frontend\.json/);
  }
  /** @type {Response[]} */ const replies=[
    new Response(JSON.stringify({error:{message:'The model service is owned by another caller.'}}),{status:409}),
    new Response(JSON.stringify({error:{message:'Alpha is not served.'}}),{status:400}),
    new Response(JSON.stringify({status:'running',model:'family-other'})),
    new Response(JSON.stringify({error:{message:'private-lease expired'}}),{status:403}),
    new Response('not JSON',{status:503}),
  ];
  const files=installation({'deployment.json':deployment});
  const driver=createStrataDriver(provider,{readText:files.readText,
    fetchImpl:/** @type {typeof fetch} */ (async()=>replies.shift()??new Response('{}'))});
  const lease={controllerUrl,leaseKey:'private-lease'};
  await assert.rejects(driver.acquire({controllerUrl}),/HTTP 409.*owned by another caller/);
  await assert.rejects(driver.start({...lease,modelId}),/HTTP 400.*Alpha is not served/);
  await assert.rejects(driver.start({...lease,modelId}),/did not confirm the requested model/);
  await assert.rejects(driver.release(lease),error=>error instanceof Error
    && error.message.includes('HTTP 403') && !error.message.includes('private-lease'));
  await assert.rejects(driver.status(lease),/invalid JSON \(HTTP 503\)/);
  const unreachable=createStrataDriver(provider,{readText:files.readText,
    fetchImpl:/** @type {typeof fetch} */ (async()=>{throw new Error('ECONNREFUSED');})});
  await assert.rejects(unreachable.acquire({controllerUrl}),/could not reach the controller/);
});

test('Strata model resolution selects the configured published tier and rejects everything else, sending no start request',async()=>{
  /** @param {unknown} contextWindow @param {string} id @param {unknown} files */
  const attempt=(contextWindow,id=modelId,files=deployment)=>{
    const reader=installation({'deployment.json':files}).readText;
    let requested=0;
    const driver=createStrataDriver({...provider,contextWindow},{readText:reader,
      fetchImpl:/** @type {typeof fetch} */ (async()=>{requested++;return new Response('{}');})});
    return {resolved:()=>resolveStrataModel({...provider,contextWindow},id,reader),
      started:()=>driver.start({controllerUrl,leaseKey:'private-lease',modelId:id}),requested:()=>requested};
  };
  /** @param {unknown} contextWindow @param {string} id @param {unknown} files @param {RegExp} pattern */
  const rejected=async(contextWindow,id,files,pattern)=>{
    const run=attempt(contextWindow,id,files);
    await assert.rejects(run.resolved(),pattern);
    await assert.rejects(run.started(),pattern);
    assert.equal(run.requested(),0);
  };
  assert.deepEqual(await attempt(undefined).resolved(),{strataModel:'Alpha',contextWindow:1000,autoCompactTokenLimit:800});
  assert.equal((await attempt(undefined,modelId,{models:['Alpha','Beta'],context_tiers:{Alpha:tiers,Beta:'bad'}}).resolved()).strataModel,'Alpha');
  assert.deepEqual(await attempt(2000).resolved(),{strataModel:'Alpha',contextWindow:2000,autoCompactTokenLimit:1500});
  await rejected(undefined,'family-gamma',deployment,/does not serve model ID family-gamma/);
  await rejected(undefined,modelId,{...deployment,models:['Alpha','ALPHA']},/does not serve model ID family-alpha/);
  await rejected(undefined,'family-beta',deployment,/model Beta has a missing or invalid context tier/);
  await rejected(undefined,modelId,{models:['Alpha'],context_tiers:{}},/model Alpha has a missing or invalid context tier/);
  await rejected(undefined,modelId,{models:['Alpha'],context_tiers:{Alpha:[{context_window:1000,auto_compact_token_limit:1000}]}},
    /model Alpha has a missing or invalid context tier/);
  await rejected(undefined,modelId,{models:'Alpha',context_tiers:{}},/invalid models array/);
  await rejected(2000,modelId,{models:['Alpha'],context_tiers:[]},/contextWindow 2000 is not published for model Alpha; published: \./);
  await rejected(undefined,modelId,{models:['Alpha'],context_tiers:[]},/model Alpha has a missing or invalid context tier/);
  for(const value of [1500,'2000',2000.5])
    await rejected(value,modelId,deployment,new RegExp(`contextWindow ${JSON.stringify(value)} is not published for model Alpha; published: 1000, 2000`));
  await rejected(undefined,modelId,{},/invalid models array/);
  assert.equal((await attempt(1000,modelId,{models:['Alpha'],context_tiers:{Alpha:[tiers[0],{context_window:1000,auto_compact_token_limit:900}]}}).resolved()).autoCompactTokenLimit,800);
  await assert.rejects(resolveStrataModel(provider,modelId,installation({}).readText),/deployment\.json is unavailable/);
});
