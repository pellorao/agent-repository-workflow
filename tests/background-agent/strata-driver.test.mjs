import assert from 'node:assert/strict';
import test from 'node:test';

import {createStrataDriver} from '../../lib/background-agent/strata-driver.mjs';

const controllerUrl='http://192.0.2.10:8101';
const responsesUrl=`${controllerUrl}/v1`;

test('Strata driver launches its fixed entry and maps all three model IDs to service variants',async()=>{
  /** @type {Array<{path:string,method:string,body:unknown,authorization:string|undefined}>} */ const requests=[];
  const driver=createStrataDriver({installationDirectory:'/installed/strata',
    async runCommand(executable,args,options){
      assert.deepEqual([executable,args,options],['bash',['/installed/strata/Run-Strata-Controller.sh'],
        {cwd:'/installed/strata',encoding:'utf8'}]);
      return {stdout:JSON.stringify({controller_base_url:controllerUrl,responses_base_url:responsesUrl,host:'192.0.2.10'})};
    },
    fetchImpl:/** @type {typeof fetch} */ (async(url,init)=>{
      const path=new URL(String(url)).pathname;
      const body=init?.body===undefined?null:JSON.parse(String(init.body));
      requests.push({path,method:String(init?.method),body,
        authorization:new Headers(init?.headers).get('Authorization')??undefined});
      if(path==='/ownership/acquire')return new Response(JSON.stringify({key:'private-lease',ownership:'held'}));
      if(path==='/ownership/start')return new Response(JSON.stringify({status:'running',model:`qwen3.8-flash-next-${String(body.model).toLowerCase()}`}));
      if(path==='/ownership/status')return new Response(JSON.stringify({status:'running',model:'qwen3.8-flash-next-iq3_xxs'}));
      if(path==='/ownership/stop')return new Response(JSON.stringify({status:'stopped',clean_unload:true}));
      return new Response(JSON.stringify({ownership:'free',previous_key_revoked:true}));
    }),
  });
  assert.deepEqual(await driver.connect(),{controllerUrl,responsesUrl});
  assert.deepEqual(await driver.acquire({controllerUrl}),{leaseKey:'private-lease'});
  for(const modelId of ['qwen3.8-flash-next-q2_0','qwen3.8-flash-next-iq2_xs','qwen3.8-flash-next-iq3_xxs'])
    assert.deepEqual(await driver.start({controllerUrl,leaseKey:'private-lease',modelId}),{status:'running',model:modelId});
  assert.deepEqual(await driver.status({controllerUrl,leaseKey:'private-lease'}),
    {status:'running',model:'qwen3.8-flash-next-iq3_xxs'});
  assert.deepEqual(await driver.stop({controllerUrl,leaseKey:'private-lease'}),{status:'stopped',cleanUnload:true});
  assert.deepEqual(await driver.release({controllerUrl,leaseKey:'private-lease'}),
    {ownership:'free',previousKeyRevoked:true});
  assert.deepEqual(requests.map(item=>item.authorization),[undefined,...Array(6).fill('Bearer private-lease')]);
  assert.equal(requests[4].method,'GET');
});

test('Strata driver reports service refusal and rejects unconfirmed transitions without leaking the key',async()=>{
  /** @type {Response[]} */ const replies=[
    new Response(JSON.stringify({error:{message:'The model service is owned by another caller.'}}),{status:409}),
    new Response(JSON.stringify({status:'unloaded',model:null})),
    new Response(JSON.stringify({error:{message:'private-lease expired'}}),{status:403}),
    new Response('not JSON',{status:503}),
  ];
  let requested=0;
  const driver=createStrataDriver({installationDirectory:'/installed/strata',
    async runCommand(){return {stdout:'{"controller_base_url":"http://192.0.2.10:8101","responses_base_url":"http://192.0.2.10:8101/v1"}'};},
    fetchImpl:/** @type {typeof fetch} */ (async()=>{requested++;return replies.shift()??new Response('{}');}),
  });
  await assert.rejects(driver.acquire({controllerUrl}),/HTTP 409.*owned by another caller/);
  await assert.rejects(driver.start({controllerUrl,leaseKey:'private-lease',modelId:'qwen3.8-flash-next-q2_0'}),
    /did not confirm the requested model/);
  await assert.rejects(driver.release({controllerUrl,leaseKey:'private-lease'}),error=>error instanceof Error
    && error.message.includes('HTTP 403') && !error.message.includes('private-lease'));
  await assert.rejects(driver.status({controllerUrl,leaseKey:'private-lease'}),/invalid JSON \(HTTP 503\)/);
  await assert.rejects(driver.start({controllerUrl,leaseKey:'private-lease',modelId:'other-model'}),
    /Unsupported Strata model ID/);
  assert.equal(requested,4);
});
