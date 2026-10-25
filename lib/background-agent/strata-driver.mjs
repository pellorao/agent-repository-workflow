import {execFile} from 'node:child_process';
import {isAbsolute, join} from 'node:path';
import {isJsonObject} from '../common/json.mjs';
import {STRATA_CONTEXT_WINDOW,STRATA_MODEL_VARIANTS} from './strata-models.mjs';
import {createStrataTaskSupport} from './strata-work-policy.mjs';

/** Select the installed provider's task support without exposing its policy to the manager.
 * @param {import('./model-catalog.mjs').ProviderConfiguration|undefined} configuration
 */
export const reviewerTaskSupport = configuration => configuration?.driver==='strata'&&configuration.installationDirectory
  ? createStrataTaskSupport({installationDirectory:configuration.installationDirectory}) : null;

/** @typedef {{controllerUrl:string,leaseKey:string}} LeaseRequest */
/** @typedef {(executable:string,args:string[],options:{cwd:string,encoding:'utf8'})=>Promise<{stdout:string}>} RunCommand */

/** @type {RunCommand} */
const defaultRunCommand = (executable,args,options) => new Promise((resolve,reject) => {
  execFile(executable,args,options,(error,stdout) => {
    if(error)reject(error);
    else resolve({stdout});
  });
});

/** @param {unknown} value */
const object = value => isJsonObject(value) ? value : null;

/** @param {unknown} value */
function httpUrl(value) {
  if(typeof value!=='string')throw new Error('Strata controller returned an invalid URL.');
  let parsed;
  try {parsed=new URL(value);} catch {throw new Error('Strata controller returned an invalid URL.');}
  if(parsed.protocol!=='http:' || !parsed.hostname || parsed.username || parsed.password)
    throw new Error('Strata controller returned an invalid URL.');
  return parsed.href.replace(/\/$/,'');
}

/**
 * Implements only the installed Strata service protocol. The manager owns
 * admission, lease persistence, model switching and release timing.
 * @param {{installationDirectory:string,runCommand?:RunCommand,fetchImpl?:typeof fetch}} input
 */
export function createStrataDriver({installationDirectory,runCommand=defaultRunCommand,fetchImpl=fetch}) {
  if(typeof installationDirectory!=='string'||!isAbsolute(installationDirectory))
    throw new Error('Strata installation directory must be absolute.');

  /** @param {string} operation @param {string} controllerUrl @param {string|null} leaseKey @param {'GET'|'POST'} method @param {Record<string,unknown>|null} body */
  const request = async (operation,controllerUrl,leaseKey,method,body) => {
    const base=httpUrl(controllerUrl);
    /** @type {Record<string,string>} */ const headers={};
    if(body!==null)headers['Content-Type']='application/json';
    if(leaseKey!==null){
      if(typeof leaseKey!=='string'||!leaseKey)throw new Error('Strata ownership key is unavailable.');
      headers.Authorization=`Bearer ${leaseKey}`;
    }
    /** @type {Response} */ let response;
    try {response=await fetchImpl(new URL(`/ownership/${operation}`,base),{
      method,headers,...(body===null?{}:{body:JSON.stringify(body)}),
    });}
    catch {throw new Error(`Strata ${operation} request could not reach the controller.`);}
    /** @type {Record<string,unknown>|null} */ let payload;
    try {payload=object(await response.json());}
    catch {throw new Error(`Strata ${operation} returned invalid JSON (HTTP ${response.status}).`);}
    if(!payload)throw new Error(`Strata ${operation} returned an invalid response (HTTP ${response.status}).`);
    if(!response.ok){
      const detail=object(payload.error)?.message;
      const message=typeof detail==='string'&&detail.trim() ? detail.trim() : 'Service refused the request.';
      throw new Error(`Strata ${operation} rejected (HTTP ${response.status}): ${message.replaceAll(leaseKey??'\0','[redacted]')}`);
    }
    return payload;
  };

  return {
    async connect() {
      let launched;
      try {launched=await runCommand('bash',[join(installationDirectory,'Run-Strata-Controller.sh')],
        {cwd:installationDirectory,encoding:'utf8'});}
      catch(error){throw new Error('Strata controller launch failed.',{cause:error});}
      let parsed;
      try {parsed=object(JSON.parse(launched.stdout));}
      catch {throw new Error('Strata controller returned invalid JSON.');}
      if(!parsed)throw new Error('Strata controller returned an invalid response.');
      return {controllerUrl:httpUrl(parsed.controller_base_url),responsesUrl:httpUrl(parsed.responses_base_url)};
    },
    /** @param {{controllerUrl:string}} input */
    async acquire({controllerUrl}) {
      const payload=await request('acquire',controllerUrl,null,'POST',{});
      if(typeof payload.key!=='string'||!payload.key||payload.ownership!=='held')
        throw new Error('Strata acquire did not confirm ownership.');
      return {leaseKey:payload.key};
    },
    /** @param {LeaseRequest} input */
    async status({controllerUrl,leaseKey}) {
      const payload=await request('status',controllerUrl,leaseKey,'GET',null);
      if(!['stopped','partial','unloaded','running'].includes(String(payload.status)))
        throw new Error('Strata status is invalid.');
      if(payload.status==='running' && typeof payload.model!=='string')
        throw new Error('Strata running model identity is unavailable.');
      return {status:/** @type {'stopped'|'partial'|'unloaded'|'running'} */ (payload.status),
        model:typeof payload.model==='string'?payload.model:null};
    },
    /** @param {LeaseRequest & {modelId:string}} input */
    async start({controllerUrl,leaseKey,modelId}) {
      const variant=Object.hasOwn(STRATA_MODEL_VARIANTS,modelId) ? STRATA_MODEL_VARIANTS[/** @type {keyof typeof STRATA_MODEL_VARIANTS} */ (modelId)] : null;
      if(!variant)throw new Error('Unsupported Strata model ID.');
      const payload=await request('start',controllerUrl,leaseKey,'POST',{model:variant,engine_overrides:{'spec-min-p':0.7,'max-context':STRATA_CONTEXT_WINDOW},
        request_defaults:{temperature:0,top_p:1,top_k:20}});
      if(payload.status!=='running'||payload.model!==modelId)
        throw new Error('Strata start did not confirm the requested model.');
      return {status:/** @type {const} */ ('running'),model:modelId};
    },
    /** @param {LeaseRequest} input */
    async stop({controllerUrl,leaseKey}) {
      const payload=await request('stop',controllerUrl,leaseKey,'POST',{});
      if(payload.status!=='stopped')throw new Error('Strata stop did not confirm model exit.');
      return {status:/** @type {const} */ ('stopped'),cleanUnload:payload.clean_unload===true?true:payload.clean_unload===false?false:null};
    },
    /** @param {LeaseRequest} input */
    async release({controllerUrl,leaseKey}) {
      const payload=await request('release',controllerUrl,leaseKey,'POST',{});
      if(payload.ownership!=='free'||payload.previous_key_revoked!==true)
        throw new Error('Strata release did not confirm ownership return.');
      return {ownership:/** @type {const} */ ('free'),previousKeyRevoked:true};
    },
  };
}
