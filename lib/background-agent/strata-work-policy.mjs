import {createHash, randomUUID} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createSerialExecutor} from '../common/serial-executor.mjs';
import {STRATA_CONTEXT_WINDOW} from './strata-models.mjs';

/** @typedef {{path:string,sha256:string}} StrataCompactBinding */
/** @typedef {{threadId:string,turnId:string|null,itemId:string,position:number,command:string,cwd:string,exitCode:number|null,output?:string|null,outputDigest?:string|null}} NativeCommandFact */
/** The installed bridge rejects this undeclared tool before executing it.
 * @param {Record<string,unknown>|null|undefined} error @returns {string|null}
 */
export const strataRejectedToolError = error => {
  for (const detail of [error?.message,error?.additionalDetails]) {
    if (typeof detail !== 'string') continue;
    const rejected = /\[invalid_response\] Model returned unknown tool: [A-Za-z0-9_.:/-]+/u.exec(detail);
    if (rejected) return rejected[0];
  }
  return null;
};

const digest = (/** @type {Buffer|string} */ value) => createHash('sha256').update(value).digest('hex');

/** @param {StrataCompactBinding} binding */
export async function verifyStrataCompactBinding(binding) {
  if(digest(await readFile(binding.path))!==binding.sha256)throw new Error('The bound Strata compaction content changed or is unavailable.');
}

/** @param {{settings:import('./codex-app-server.mjs').NativeSettings,installationDirectory:string,stateDirectory:string,binding?:StrataCompactBinding|null}} input */
export async function prepareStrataSettings({settings,installationDirectory,stateDirectory,binding}) {
  if(binding) {
    await verifyStrataCompactBinding(binding);
  } else {
    const base=await readFile(join(installationDirectory,'config','compact_prompt.txt'));
    const supplementPath=settings.config.experimental_compact_prompt_file;
    const supplement=typeof supplementPath==='string'?await readFile(supplementPath):null;
    const combined=supplement&&!supplement.equals(base)?Buffer.concat([base,Buffer.from('\n\n'),supplement]):base;
    const path=join(stateDirectory,`strata-compact-${randomUUID()}.txt`);
    await writeFile(path,combined,{flag:'wx',mode:0o600});
    binding={path,sha256:digest(combined)};
  }
  return {binding,settings:{...settings,config:{...settings.config,
    model_context_window:STRATA_CONTEXT_WINDOW,model_auto_compact_token_limit:100000,
    experimental_compact_prompt_file:binding.path}}};
}

/** @typedef {{cursor:number,lastCommandId?:string|null,lastCommandTurnId?:string|null,signature:string|null,count:number,repeatMessageId:string|null,reminderMessageId:string|null,stopReason:string|null,isolated:boolean}} StrataWorkState */
/** @param {boolean} isolated @returns {StrataWorkState} */
export const initialStrataWorkState = isolated => ({cursor:0,lastCommandId:null,lastCommandTurnId:null,signature:null,count:0,repeatMessageId:null,
  reminderMessageId:null,stopReason:null,isolated});

/** @param {import('./codex-app-server.mjs').NativeMember|undefined} root */
const inspectStrataFailure = root => {
  const rejected=root?.state==='failed'&&strataRejectedToolError(root.turnError)!==null;
  return {canContinue:root?.retryableModelFailure===true||rejected,requiresContinuation:rejected};
};

/** Provider-owned task preparation and continuation rules.
 * @param {{installationDirectory:string}} input
 */
export function createStrataTaskSupport({installationDirectory}) {
  return {
    /** @param {{settings:import('./codex-app-server.mjs').NativeSettings,stateDirectory:string,identityKind:'ordinary'|'isolated',binding?:StrataCompactBinding|null,restore:boolean,workState:Record<string,unknown>|null}} input */
    async prepare({settings,stateDirectory,identityKind,binding,restore,workState}) {
      const prepared=await prepareStrataSettings({settings,installationDirectory,stateDirectory,binding});
      return {settings:prepared.settings,compactBinding:prepared.binding,
        workState:restore&&workState?workState:initialStrataWorkState(identityKind==='isolated')};
    },
    /** @param {Record<string,unknown>|null|undefined} workState */
    canSendInstruction:workState=>!workState?.stopReason,
    /** @param {import('./codex-app-server.mjs').NativeMember} root @param {Record<string,unknown>|null|undefined} workState */
    canContinue:(root,workState)=>!workState?.stopReason
      && (root.state!=='failed'||root.retryableModelFailure===true||!!workState&&inspectStrataFailure(root).requiresContinuation),
    /** @param {Omit<Parameters<typeof createStrataWorkPolicy>[0],'readState'|'saveState'> & {identityKind:'ordinary'|'isolated',readWorkState:()=>Record<string,unknown>|null,saveWorkState:(state:Record<string,unknown>)=>void}} input */
    createPolicy({identityKind,readWorkState,saveWorkState,...callbacks}) {
      return createStrataWorkPolicy({...callbacks,
        readState:()=>/** @type {StrataWorkState} */(/** @type {unknown} */(readWorkState()??initialStrataWorkState(identityKind==='isolated'))),
        saveState:state=>saveWorkState(/** @type {Record<string,unknown>} */(/** @type {unknown} */(state)))});
    },
    /** @param {StrataCompactBinding|null|undefined} binding */
    async verifyBinding(binding) {if(binding)await verifyStrataCompactBinding(binding);},
  };
}

/**
 * Provider decisions consume facts; message admission and protected turn transitions
 * stay in the manager. The work budget uses the caller's single measurement clock.
 * @param {{readState:()=>StrataWorkState,saveState:(state:StrataWorkState)=>void,
 * send:(input:{kind:'repeat'|'reminder',instruction:string,messageId?:string,onAccepted:(messageId:string)=>void})=>Promise<void>,
 * stop:(reason:string,code:string)=>Promise<void>,workDuration:()=>number|null,
 * readInstructionStatus?:(messageId:string)=>Promise<import('./message-store.mjs').DeliveryStatus|null>,
 * clock?:{setTimeout:(callback:()=>void,delay:number)=>ReturnType<typeof setTimeout>,clearTimeout:(timer:ReturnType<typeof setTimeout>)=>void}}} input
 */
export function createStrataWorkPolicy({readState,saveState,send,stop,workDuration,readInstructionStatus,clock={setTimeout,clearTimeout}}) {
  /** @type {ReturnType<typeof setTimeout>|null} */ let timer=null;
  let closed=false;
  let reminderRetryAt=0;
  let reminderDelivered=false;
  /** @type {Promise<void>|null} */ let stopping=null;
  const queue=createSerialExecutor();
  const save=(/** @type {Partial<StrataWorkState>} */ patch)=>saveState({...readState(),...patch});
  const cancelTimer=()=>{if(timer!==null)clock.clearTimeout(timer);timer=null;};
  const cutoffReason='The local measurement work budget reached 60 minutes.';
  const checkCutoff=()=>{
    const state=readState();
    if(closed)return true;
    if(state.stopReason&&state.stopReason!==cutoffReason)return true;
    if(!state.isolated)return false;
    if(!state.stopReason){
      const elapsed=workDuration();
      if(elapsed===null||elapsed<60*60_000)return false;
      save({stopReason:cutoffReason});
    }
    if(!stopping){
      cancelTimer();
      const attempt=stop(cutoffReason,'local-reviewer-timeout');
      stopping=attempt;
      void attempt.then(()=>{
        if(stopping===attempt){stopping=null;cancelTimer();}
      },()=>{
        if(stopping!==attempt)return;
        stopping=null;
        if(closed||readState().stopReason!==cutoffReason)return;
        cancelTimer();
        timer=clock.setTimeout(()=>{timer=null;checkCutoff();},10_000);
        timer?.unref?.();
      });
    }
    return true;
  };
  /** @param {boolean} [canRemind] */
  const budget=async(canRemind=true)=>{
    if(checkCutoff()){await stopping;return;}
    const state=readState();if(!state.isolated)return;
    const elapsed=workDuration();if(elapsed===null)return;
    if(canRemind&&elapsed>=55*60_000&&!reminderDelivered&&elapsed>=reminderRetryAt) {
      reminderRetryAt=elapsed+10_000;
      try {
        const status=state.reminderMessageId?await readInstructionStatus?.(state.reminderMessageId):null;
        if(closed||readState().stopReason)return;
        if(status==='delivered'){reminderDelivered=true;return;}
        if(state.reminderMessageId&&status!=='failed')return;
        await send({kind:'reminder',instruction:'The model work budget has reached 55 minutes. Finish the remaining necessary checks and write the complete bound report before the 60-minute limit.',
          ...(state.reminderMessageId?{messageId:state.reminderMessageId}:{}),
          onAccepted:messageId=>save({reminderMessageId:messageId})});
        reminderDelivered=!!readState().reminderMessageId;
      } catch { /* Retain the original message identity; only confirmed failed delivery may be retried. */ }
    }
  };
  const schedule=(cutoffOnly=false)=>{
    const state=readState();
    if(!closed&&state.isolated&&state.stopReason===cutoffReason)return;
    cancelTimer();const elapsed=workDuration();
    if(closed||state.stopReason||!state.isolated||elapsed===null)return;
    const boundary=cutoffOnly?60*60_000:elapsed<55*60_000?55*60_000:reminderDelivered?60*60_000
      :Math.min(60*60_000,Math.max(elapsed+10_000,reminderRetryAt));
    timer=clock.setTimeout(()=>{
      timer=null;if(checkCutoff())return;
      schedule(true);
      if(!cutoffOnly)void queue(async()=>{try {await budget();} finally {schedule();}}).catch(()=>{});
    },Math.max(1,boundary-elapsed));
    timer?.unref?.();
  };
  return {
    inspectFailure:inspectStrataFailure,
    /** @param {NativeCommandFact[]} facts @param {string} threadId */
    setCommandBaseline(facts,threadId) {
      const prior=facts.filter(fact=>fact.threadId===threadId).at(-1);
      if(prior)save({cursor:prior.position,lastCommandId:prior.itemId,lastCommandTurnId:prior.turnId,count:0,signature:null});
    },
    /** @param {NativeCommandFact[]} facts @param {string} threadId */
    observeCommands:(facts,threadId)=>queue(async()=>{
      if(checkCutoff()){await stopping;return;}
      schedule(true);
      const cursor=readState();
      const anchor=cursor.lastCommandId?facts.findIndex(fact=>fact.itemId===cursor.lastCommandId&&fact.turnId===cursor.lastCommandTurnId):-1;
      for(const fact of facts.slice(anchor>=0?anchor+1:0)) {
        const state=readState();if(closed||state.stopReason)return;
        if(fact.threadId!==threadId||fact.itemId===state.lastCommandId&&fact.turnId===state.lastCommandTurnId
          ||anchor<0&&fact.turnId===state.lastCommandTurnId&&fact.position<=state.cursor)continue;
        const output=fact.outputDigest??fact.output;
        if(fact.exitCode==null||output==null) {
          save({cursor:fact.position,lastCommandId:fact.itemId,lastCommandTurnId:fact.turnId,signature:null,count:0});
          continue;
        }
        const signature=digest(JSON.stringify([fact.command,fact.cwd,fact.exitCode,output]));
        const count=state.signature===signature?state.count+1:1;
        save({cursor:fact.position,lastCommandId:fact.itemId,lastCommandTurnId:fact.turnId,signature,count:count===3?0:count});
        if(count===3)try {await send({kind:'repeat',instruction:'The same command in the same working directory returned the same exit code and available output three times consecutively. Use the results already obtained and change the approach to advance the current review; do not repeat an unchanged unsuccessful probe.',
          onAccepted:messageId=>save({repeatMessageId:messageId})});} catch { /* A hint failure must not end the review or replay its command. */ }
      }
      await budget();schedule();
    }),
    canContinue:()=>!checkCutoff(),
    /** @param {Record<string,unknown>|null|undefined} turnError */
    continuationFeedback:turnError=>{
      const rejected=strataRejectedToolError(turnError);
      return rejected===null?'':`The native model response failed: ${rejected}. The bridge rejected this undeclared tool call before execution; it is not a shell command failure. Correct the response and use only tools declared for the current request. For compaction, follow the task's already bound base compaction instructions. Do not replay earlier tool calls or assume unknown side effects are safe to repeat.\n\n`;
    },
    refresh:()=>queue(async()=>{await budget();schedule();}),
    /** @param {string} reason */
    cancel(reason){save({stopReason:reason});cancelTimer();},
    close(){closed=true;cancelTimer();},
  };
}
