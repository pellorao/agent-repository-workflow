import {isJsonObject} from '../common/json.mjs';
import {readStrataInstallationJson,resolveStrataModel} from './strata-models.mjs';
import {createStrataTaskSupport} from './strata-work-policy.mjs';

/** Select the installed provider's task support without exposing its policy to the manager.
 * @param {import('./model-catalog.mjs').ProviderConfiguration|undefined} configuration
 */
export const reviewerTaskSupport = configuration => configuration?.driver==='strata' ? createStrataTaskSupport(configuration) : null;

/** @typedef {{controllerUrl:string,leaseKey:string}} LeaseRequest */
const PATHS={acquire:'/lease/acquire',status:'/model/status',start:'/model/start',stop:'/model/stop',release:'/lease/release'};

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
 * @param {import('./model-catalog.mjs').StrataProviderConfiguration} provider
 * @param {{readText?:import('./strata-models.mjs').ReadText,fetchImpl?:typeof fetch}} [seams]
 */
export function createStrataDriver(provider,{readText,fetchImpl=fetch}={}) {
  /** @param {keyof typeof PATHS} operation @param {string} controllerUrl @param {string|null} leaseKey @param {'GET'|'POST'} method @param {Record<string,unknown>|null} body */
  const request = async (operation,controllerUrl,leaseKey,method,body) => {
    const base=httpUrl(controllerUrl);
    /** @type {Record<string,string>} */ const headers={};
    if(body!==null)headers['Content-Type']='application/json';
    if(leaseKey!==null){
      if(typeof leaseKey!=='string'||!leaseKey)throw new Error('Strata ownership key is unavailable.');
      headers.Authorization=`Bearer ${leaseKey}`;
    }
    /** @type {Response} */ let response;
    try {response=await fetchImpl(new URL(PATHS[operation],base),{
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
      const frontend=await readStrataInstallationJson(provider.installationDirectory,'frontend.json',readText);
      if(typeof frontend.listen_address!=='string'||!frontend.listen_address||!Number.isSafeInteger(frontend.port)||Number(frontend.port)<=0)
        throw new Error('Strata installation frontend.json has an invalid address.');
      const controllerUrl=httpUrl(`http://${frontend.listen_address}:${frontend.port}`);
      return {controllerUrl,responsesUrl:`${controllerUrl}/strata/v1`};
    },
    /** @param {{controllerUrl:string}} input */
    async acquire({controllerUrl}) {
      const payload=await request('acquire',controllerUrl,null,'POST',{});
      if(typeof payload.key!=='string'||!payload.key||payload.lease!=='held')
        throw new Error('Strata acquire did not confirm ownership.');
      return {leaseKey:payload.key};
    },
    /** @param {LeaseRequest} input */
    async status({controllerUrl,leaseKey}) {
      const payload=await request('status',controllerUrl,leaseKey,'GET',null);
      if(!['stopped','starting','unloaded','running'].includes(String(payload.status)))
        throw new Error('Strata status is invalid.');
      if(payload.status==='running' && typeof payload.model!=='string')
        throw new Error('Strata running model identity is unavailable.');
      return {status:/** @type {'stopped'|'partial'|'unloaded'|'running'} */ (payload.status==='starting'?'partial':payload.status),
        model:typeof payload.model==='string'?payload.model:null};
    },
    /** @param {LeaseRequest & {modelId:string}} input */
    async start({controllerUrl,leaseKey,modelId}) {
      const tier=await resolveStrataModel(provider,modelId,readText);
      const payload=await request('start',controllerUrl,leaseKey,'POST',{model:tier.strataModel,context_window:tier.contextWindow});
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
      if(payload.lease!=='free')
        throw new Error('Strata release did not confirm ownership return.');
      return {ownership:/** @type {const} */ ('free'),previousKeyRevoked:true};
    },
  };
}
