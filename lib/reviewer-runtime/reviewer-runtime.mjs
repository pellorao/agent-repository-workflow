import {dirname, join, relative, resolve, sep} from 'node:path';
import {REVIEWER_ROLES} from '../arw-common/reviewer-configuration.mjs';
import {createScopedFilesystem} from '../common/filesystem.mjs';
import {cloneJsonValue, isJsonObject, jsonSemanticallyEqual, parseJsonText} from '../common/json.mjs';
import {createSerialExecutor} from '../common/serial-executor.mjs';
import {inspectReviewerGroup, isWithinReviewerPaths, reviewerContextFloors} from './reviewer-group.mjs';
import {checkpointReviewerMeasurement,createReviewerMeasurement, observeReviewerMeasurement, observeReviewerUnavailableMeasurement, reviewerMeasurementResult} from './reviewer-measurement.mjs';
import {reviewerNativeSettings} from './reviewer-native-policy.mjs';
import {
    normalizeReviewerIdentity, openReviewerRecordFilesystem, readReviewerSessionRecord,
    requireReviewerPath, requireReviewerPaths, requireReviewerRecoveryLocation, requireReviewerText, reviewerFailure,
    reviewerRecoveryPath, saveReviewerSessionRecord,
} from './reviewer-session-record.mjs';
import {backgroundAgentRecoveryPath} from '../background-agent/recovery-record.mjs';

/** @typedef {import('../background-agent/manager.mjs').ManagedNativeSessions} ManagedNativeSessions */
/** @typedef {Awaited<ReturnType<ManagedNativeSessions['open']>>} ManagedReviewerSession */
/** @typedef {import('../background-agent/codex-app-server.mjs').NativeSettings} NativeSettings */
/** @typedef {import('../background-agent/codex-app-server.mjs').NativeSnapshot} NativeSnapshot */
/** @typedef {import('../background-agent/codex-app-server.mjs').NativeNotification} NativeNotification */
/** @typedef {import('./reviewer-session-record.mjs').ReviewerSessionRecord} ReviewerSessionRecord */
/** @typedef {import('./reviewer-session-record.mjs').ReviewerFilesystem} ReviewerFilesystem */
/** @typedef {import('./reviewer-session-record.mjs').ReviewerError} ReviewerError */
/** @typedef {{now: () => number}} ReviewerClock */
/** @typedef {{role: string, identity: import('./reviewer-session-record.mjs').ReviewerIdentity, settings: NativeSettings, instructions: string, handoff: string, cwd: string, readPaths: string[], writePaths: string[], reportPath: string}} ReviewerHandoff */
/** @typedef {Omit<ReturnType<typeof reviewerMeasurementResult>,'wallClockMs'> & {wallClockMs:number|null}} ReviewerMeasurementResult */
/** @typedef {{runId: string, threadId: string | null, turnId: string | null, recoveryPath: string, state: import('./reviewer-session-record.mjs').ReviewerState, accepted?: true, messageId?: string, deliveryStatus?: 'accepted', completion?: import('./reviewer-session-record.mjs').ReviewerCompletion | null, measurement?: ReviewerMeasurementResult}} ReviewerOperationResult */
/** @typedef {{status: 'succeeded', result: ReviewerOperationResult} | {status: 'failed', error: ReviewerError}} ReviewerRuntimeResult */
/** @typedef {{status: 'succeeded', result: {closed: true}} | {status: 'failed', error: ReviewerError}} ReviewerCloseResult */
/** @typedef {{execute: (request: {operation: string, input: unknown}) => Promise<ReviewerRuntimeResult>, inspect: (input: {runId: string, managed?: import('../background-agent/state-store.mjs').BackgroundAgentRow}) => Promise<ReviewerRuntimeResult>, holdsRun: (runId: string) => boolean, hasLiveRuns: () => boolean,restorePausedTask:(input:{runId:string,managed:import('../background-agent/state-store.mjs').BackgroundAgentRow,resumePending?:boolean})=>Promise<void>, close: () => Promise<ReviewerCloseResult>}} ReviewerRuntime */
/** @typedef {{record: ReviewerSessionRecord, session: ManagedReviewerSession, filesystem: import('../common/filesystem.mjs').ScopedFilesystem, reviewFilesystem: import('../common/filesystem.mjs').ScopedFilesystem, recoveryRecordPath: string, serial: ReturnType<typeof createSerialExecutor>, persistSerial: ReturnType<typeof createSerialExecutor>, snapshot: NativeSnapshot | null, persistedRecord: string | null, refreshScheduled: boolean, refreshAgain: boolean, stopping: boolean, stopped: boolean, deadlineStopRequested?:boolean,resumePendingOnAttach?:boolean, interruptRequested: boolean, cleanupTurnId: string | null, cleanupFinalizedTurnId: string | null, cleanupError: ReviewerError | null,providerPolicy?:ReturnType<NonNullable<ManagedReviewerSession['createProviderWorkPolicy']>>}} ReviewerEntry */

/** @param {string} cwd @param {string} path */
const reviewLogicalPath = (cwd, path) => relative(cwd, path).split(sep).join('/') || '.';
/** @type {ReviewerClock} */
const systemClock = {now: () => Date.now()};

/** @param {unknown} value @returns {Record<string, unknown>} */
const requireObject = value => {
    if (!isJsonObject(value)) {
        throw reviewerFailure('invalid-input', 'Reviewer operation input must be an object.');
    }
    return value;
};

/** @param {string} text @returns {{status: 'ready'} | {status: 'incomplete', reason: string} | null} */
const reviewerFinalStatus = text => {
    const parsed = parseJsonText(text);
    const value = parsed.status === 'succeeded' ? /** @type {unknown} */ (parsed.value) : null;
    if (!isJsonObject(value)) return null;
    if (value.status === 'ready' && Object.keys(value).length === 1) return {status: 'ready'};
    if (value.status === 'incomplete' && Object.keys(value).length === 2
        && typeof value.reason === 'string' && value.reason.trim().length > 0) {
        return {status: 'incomplete', reason: value.reason};
    }
    return null;
};

/** @param {Pick<ReviewerHandoff, 'writePaths' | 'reportPath'>} paths */
const requireReportDirectory = ({writePaths, reportPath}) => {
    const directory = dirname(reportPath);
    if (writePaths.length !== 1 || resolve(writePaths[0]) !== directory) {
        throw reviewerFailure('invalid-input', 'Reviewer write paths must contain only the exact bound report directory.');
    }
    return directory;
};

// The former single-file binding is accepted only for completed-result queries.
/** @param {Pick<ReviewerHandoff, 'writePaths' | 'reportPath'>} paths */
const hasFileReportWritePath = ({writePaths, reportPath}) => writePaths.length === 1 && writePaths[0] === reportPath;

/** @param {unknown} value @returns {ReviewerHandoff} */
const readHandoff = value => {
    const input = requireObject(value);
    const role = requireReviewerText(input.role, 'role');
    if (!REVIEWER_ROLES.includes(role)) throw reviewerFailure('invalid-input', 'The requested Canonical Reviewer Role is unsupported.');
    const settings = requireObject(input.settings);
    for (const key of ['model', 'modelProvider', 'reasoningEffort']) requireReviewerText(settings[key], `settings.${key}`);
    requireReviewerText(settings.serviceTier, 'settings.serviceTier');
    requireObject(settings.config);
    const result = {
        role,
        identity: normalizeReviewerIdentity(input.identity),
        settings: /** @type {NativeSettings} */ (cloneJsonValue(settings)),
        instructions: requireReviewerText(input.instructions, 'instructions'),
        handoff: requireReviewerText(input.handoff, 'handoff'),
        cwd: requireReviewerPath(input.cwd, 'cwd'),
        readPaths: input.readPaths === undefined ? [] : requireReviewerPaths(input.readPaths, 'readPaths'),
        writePaths: requireReviewerPaths(input.writePaths, 'writePaths'),
        reportPath: requireReviewerPath(input.reportPath, 'reportPath'),
    };
    if ([...result.readPaths, ...result.writePaths].some(path => !isWithinReviewerPaths(path, [result.cwd]))) {
        throw reviewerFailure('invalid-input', 'Reviewer read and write paths must stay within the current Git repository.');
    }
    if (result.writePaths.some(path => !isWithinReviewerPaths(path, [join(result.cwd, '.tmp')]))) {
        throw reviewerFailure('invalid-input', 'Reviewer write paths must stay within the audited repository temporary workspace.');
    }
    requireReportDirectory(result);
    return result;
};

/** @param {unknown} error @param {string} [fallback] @returns {ReviewerError} */
const errorResult = (error, fallback = 'reviewer-runtime-failed') => ({
    code: error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : fallback,
    message: error instanceof Error ? error.message : 'The Reviewer runtime operation failed.',
});

/** @param {ReviewerSessionRecord} record @returns {ReviewerOperationResult} */
const recordIdentity = record => ({
    runId: record.runId,
    threadId: record.threadId,
    turnId: record.turnId,
    recoveryPath: record.recoveryPath,
    state: record.state,
});
/** @param {ReviewerEntry} entry @returns {ReviewerOperationResult} */
const identityResult = entry => recordIdentity(entry.record);

/** @template T @param {ReviewerEntry} entry @param {() => Promise<T>} action @returns {Promise<T>} */
const serialize = (entry, action) => {
    // Reserve the managed root before this action enters the Reviewer queue.
    const release = entry.session.holdManagedWork();
    return entry.serial(action).finally(release);
};

/**
 * Controls only caller-prepared Reviewer work. Native protocol facts are supplied by
 * one Session per Reviewer; report bytes remain exclusively the Reviewer's output.
 * @param {{nativeSessions: ManagedNativeSessions, recoveryBoundary: () => import('./reviewer-session-record.mjs').ReviewerRecoveryBoundary, filesystem?: ReviewerFilesystem, clock?: ReviewerClock, onRetired?: (runId: string) => void}} options
 * @returns {ReviewerRuntime}
 */
export const createReviewerRuntime = ({nativeSessions, recoveryBoundary, filesystem = {open: createScopedFilesystem}, clock = systemClock, onRetired}) => {
    /** @type {Map<string, ReviewerEntry>} */
    const runs = new Map();
    /** @type {Map<string, string>} */
    const recoveryPaths = new Map();
    /** @type {Map<string,ReturnType<typeof createSerialExecutor>>} */
    const recordSerials=new Map();
    /** 同恢复文件的冷读与保存共用队列, 原生工作不进入该队列. @param {string} path */
    const recordSerial=path=>{
        let serial=recordSerials.get(path);
        if(!serial){serial=createSerialExecutor();recordSerials.set(path,serial);}
        return serial;
    };
    let closed = false;
    /** @type {Promise<unknown>} */
    let launchTail = Promise.resolve();
    /** @type {Promise<ReviewerCloseResult> | null} */
    let closePromise = null;
    /** @param {import('../common/filesystem.mjs').ScopedFilesystem} reportFilesystem @param {ReviewerSessionRecord} record */
    const readReport = (reportFilesystem, record) => reportFilesystem.readText({path: reviewLogicalPath(record.cwd, record.reportPath), allowLossyDecoding: false, rejectHardLinks: true});
    /** @param {Pick<ReviewerEntry, 'record' | 'session' | 'filesystem' | 'reviewFilesystem' | 'recoveryRecordPath'> & Partial<ReviewerEntry>} fields @returns {ReviewerEntry} */
    const newEntry = fields => ({
        serial: createSerialExecutor(), persistSerial: recordSerial(fields.record.recoveryPath), snapshot: null, persistedRecord: null,
        refreshScheduled: false, refreshAgain: false, stopping: false, stopped: false, interruptRequested: false,
        cleanupTurnId: null, cleanupFinalizedTurnId: null, cleanupError: null, ...fields,
    });
    /** @param {ReviewerEntry} entry */
    const providerPolicy = entry => {
        entry.session.setResumeHandler?.(()=>serialize(entry,async()=>{await refresh(entry);await ensurePersisted(entry);}),entry.resumePendingOnAttach!==false);
        if(entry.providerPolicy)return entry.providerPolicy;
        entry.providerPolicy=entry.session.createProviderWorkPolicy?.({
            identityKind:entry.record.identity.kind,
            workDuration:()=>{const measured=reviewerMeasurementResult(entry.record.measurement,clock.now(),entry.record.factsComplete);return measured.workDuration?.durationMs??null;},
            send:async({instruction,messageId,onAccepted})=>{if(!entry.record.threadId||!entry.record.turnId)return;await entry.session.sendProgramInstruction?.({threadId:entry.record.threadId,turnId:entry.record.turnId,instruction,messageId,onAccepted});},
            stop:async (reason,code)=>{entry.record.failure=reviewerFailure(code,reason);incomplete(entry,reason);await stopEntry(entry,true);
                if(!entry.stopped)throw reviewerFailure('reviewer-stop-failed','The Reviewer stop is not yet confirmed.');},
        })??null;
        return entry.providerPolicy;
    };

    /** @param {ReviewerEntry} entry @param {string} reason */
    const incomplete = (entry, reason) => {
        entry.record.completion = {status: 'incomplete', reason, reportPath: entry.record.reportPath};
    };
    /** @param {ReviewerEntry} entry */
    const finishTask = entry => {
        const work=entry.session.getProviderWork?.();
        if(work?.paused===true&&entry.record.threadId){
            if(entry.record.measurement.work?.openStart!=null)observeReviewerMeasurement(entry.record.measurement,{members:entry.snapshot?.members??[],rootThreadId:entry.record.threadId,now:clock.now(),
                measurementFacts:{workState:{state:'working',at:clock.now(),estimated:false,basis:'The paused task ended at this program observation; waiting for user approval is excluded.'}}});
            entry.session.saveProviderWork?.({...work,paused:false,resumeMessageId:null});
        }
        entry.record.measurement.finishedAt??=clock.now();
        entry.providerPolicy?.close();
    };
    /** @param {ReviewerEntry} entry */
    const persist = entry => entry.persistSerial(async()=>{
        if(entry.persistedRecord===JSON.stringify(entry.record))return;
        checkpointReviewerMeasurement(entry.record.measurement);
        const snapshot=/** @type {ReviewerSessionRecord} */(/** @type {unknown} */(cloneJsonValue(entry.record)));
        const serialized=JSON.stringify(snapshot);
        await saveReviewerSessionRecord(entry.filesystem, snapshot, entry.recoveryRecordPath);
        entry.persistedRecord = serialized;
    });
    /** @param {ReviewerEntry} entry */
    const ensurePersisted = async entry => {
        while (entry.persistedRecord !== JSON.stringify(entry.record)) await persist(entry);
    };

    /** A missing final, unverified facts or an unreadable report can still become ready. */
    /** @param {ReviewerEntry} entry */
    const definitive = entry => {
        const record = entry.record;
        if (!record.completion || entry.stopping || ['starting', 'running'].includes(record.state)) return false;
        if (record.environmentState === 'exited') return true;
        if (entry.cleanupFinalizedTurnId !== record.turnId) return false;
        const snapshot = entry.snapshot;
        if (!snapshot?.factsComplete || !record.factsComplete || !record.turnId) return false;
        const group = inspectReviewerGroup(snapshot, {
            rootThreadId: /** @type {string} */ (record.threadId), cwd: record.cwd,
            writePaths: record.writePaths, reportPath: record.reportPath, contextFloors: record.contextFloors,
        });
        if (group.active || group.unknownReasons.length || group.violations.length
            || !group.root || group.root.turnId !== record.turnId) return false;
        if (record.completion.status === 'ready' || record.state === 'interrupted' || record.state === 'failed') return true;
        const final = group.root.finalResponse;
        return final !== null && reviewerFinalStatus(final)?.status !== 'ready';
    };

    /** @param {ReviewerEntry} entry */
    const retireIfTerminal = entry => {
        const runId = entry.record.runId;
        if (runs.get(runId) !== entry || !definitive(entry)
            || entry.persistedRecord !== JSON.stringify(entry.record)) return;
        entry.providerPolicy?.close();
        entry.session.detach();
        entry.snapshot = null;
        runs.delete(runId);
        recoveryPaths.delete(runId);
        onRetired?.(runId);
    };

    /** @param {ReviewerSessionRecord} record */
    const measurementResult = record => {
        const measured = reviewerMeasurementResult(record.measurement, clock.now(), record.factsComplete);
        return (record.environmentState === 'exited' || record.failure !== null) && record.measurement.finishedAt === null
            ? {...measured, wallClockMs: null} : measured;
    };

    /** @param {ReviewerEntry} entry @param {boolean} observedExitTime */
    const reconcileExited = async (entry, observedExitTime) => {
        if (entry.session.managementState() !== 'exited' || entry.record.environmentState === 'exited') return;
        entry.record.environmentState = 'exited';
        entry.record.state = 'stopped';
        entry.providerPolicy?.close();
        if (observedExitTime) entry.record.measurement.finishedAt ??= clock.now();
        if (entry.record.completion?.status !== 'ready') {
            incomplete(entry, 'The Reviewer environment exited before complete report delivery.');
        }
        await persist(entry);
    };

    /** @param {ReviewerEntry} entry @param {NativeSnapshot} snapshot @param {boolean} [allowCompletion] */
    const observe = async (entry, snapshot, allowCompletion = true) => {
        const record = entry.record;
        if (!record.threadId) return;
        entry.snapshot = snapshot;
        const group = inspectReviewerGroup(snapshot, {
            rootThreadId: record.threadId,
            cwd: record.cwd,
            writePaths: record.writePaths,
            reportPath: record.reportPath,
            contextFloors: record.contextFloors,
        });
        if (group.root?.sessionPath) {
            if (record.sessionPath !== null && record.sessionPath !== group.root.sessionPath) {
                group.violations.push('The original root native record path changed.');
            } else record.sessionPath = group.root.sessionPath;
        }
        record.knownThreadIds = [...new Set([...record.knownThreadIds, ...snapshot.members.map(member => member.threadId)])];
        record.factsComplete = snapshot.factsComplete;
        const unconfirmedExit=snapshot.environmentState==='exited'&&entry.session.managementState()==='unknown';
        if (!unconfirmedExit) record.environmentState = snapshot.environmentState;
        const observedAt=clock.now();
        const taskWork=entry.session.getProviderWork?.();
        const resumeMessage=typeof taskWork?.resumeMessageId==='string'?entry.session.getTaskMessage?.(taskWork.resumeMessageId):null;
        observeReviewerMeasurement(record.measurement, {measurementFacts:taskWork?.paused===true
                ?{...snapshot.measurementFacts,workState:resumeMessage
                    ?{state:'working',at:resumeMessage.acceptedAtMs,estimated:false,basis:'The owning Main accepted resumption of this same paused task through an ordinary work message.'}
                    :{state:'paused',at:record.measurement.work?.openStart??observedAt,estimated:false,basis:'The same task is paused while the owning Main obtains user approval.'}}
                :snapshot.measurementFacts,now:observedAt,
            members: snapshot.members,
            rootThreadId: record.threadId,
            ...(entry.session.getProviderWork?.()?.paused!==true&&snapshot.factsComplete&&snapshot.environmentState==='running'&&group.root
                &&['active','idle'].includes(group.root.state)&&group.unknownReasons.length===0&&group.violations.length===0
                ?{verifiedWorkingAt:observedAt}:{}),
        });
        if (unconfirmedExit && !record.failure) {
            await failBackground(entry, new Error(snapshot.unknownReasons.join(' ') || 'The native Reviewer environment became unavailable.'));
            return;
        }
        if (record.failure) {
            if(!entry.deadlineStopRequested)entry.providerPolicy?.close();
            if (entry.session.managementState() === 'exited') finishTask(entry);
            record.state = 'failed';
            incomplete(entry, record.failure.message);
            if (snapshot.environmentState === 'running' && !entry.stopping) await stopEntry(entry);
            return;
        }
        if (group.violations.length > 0) {
            record.failure = {code: 'reviewer-group-violation', message: group.violations.join(' ')};
            record.state = 'failed';
            incomplete(entry, record.failure.message);
            try { await persist(entry); }
            finally { if (!entry.stopping) await stopEntry(entry); }
            return;
        }
        if (record.turnId !== null && group.root?.turnId && group.root.turnId !== record.turnId) {
            const recovered=await entry.session.recoverContinuation?.({rootThreadId:record.threadId,endedTurnId:record.turnId});
            if(recovered!==group.root.turnId)throw reviewerFailure('turn-mismatch', 'The original Reviewer root is now associated with a different native turn.');
            record.turnId=recovered;record.state='running';record.completion=null;
            entry.cleanupTurnId=null;entry.cleanupFinalizedTurnId=null;
        }
        if (snapshot.environmentState === 'exited') {
            finishTask(entry);
            record.state = 'stopped';
            if (record.completion?.status !== 'ready') incomplete(entry, 'The Reviewer environment exited before complete report delivery.');
            return;
        }
        const policy=providerPolicy(entry);
        if(record.failure||entry.stopped)return;
        if (group.active) {
            if(policy&&allowCompletion&&!entry.stopping)await policy.observeCommands(snapshot.commandFacts??[],/** @type {string} */(record.threadId));
            if(record.failure||entry.stopped)return;
            record.state = 'running';
            record.completion = null;
            record.measurement.finishedAt = null;
            return;
        }
        if (entry.interruptRequested || group.root?.state === 'interrupted') {
            const paused=entry.session.getProviderWork?.()?.paused===true;
            if(!paused)finishTask(entry);
            record.state = 'interrupted';
            if (record.turnId && entry.cleanupFinalizedTurnId !== record.turnId) {
                await entry.session.protectTurn({rootThreadId: record.threadId, turnId: record.turnId});
                entry.cleanupTurnId = record.turnId;
                entry.cleanupError = null;
                if(paused)try {
                    await entry.session.cleanupTurnTerminals({rootThreadId:record.threadId,turnId:record.turnId,knownThreadIds:record.knownThreadIds});
                } catch(error) {
                    entry.cleanupError=errorResult(error,'reviewer-cleanup-unverified');
                    incomplete(entry,`Reviewer background terminal cleanup is unverified: ${entry.cleanupError.message}`);return;
                }
            }
            if(paused)finishTask(entry);
            incomplete(entry, 'The current Reviewer work was interrupted.');
            return;
        }
        record.state = group.root?.state === 'failed' ? 'failed' : 'idle';
        if (!allowCompletion || !record.turnId) return;
        const failure=policy?.inspectFailure(group.root);
        if (group.root?.state === 'failed'&&!(failure?.canContinue??group.root.retryableModelFailure)) {
            finishTask(entry);
            if (entry.cleanupFinalizedTurnId !== record.turnId) {
                await entry.session.protectTurn({rootThreadId: record.threadId, turnId: record.turnId});
                entry.cleanupTurnId = record.turnId;
                entry.cleanupError = null;
            }
            incomplete(entry, 'The native Reviewer turn failed.');
            return;
        }
        if (!group.root || group.root.turnId !== record.turnId) {
            incomplete(entry, 'The exact current root turn has not delivered a final status.');
            return;
        }
        if (group.root.turnStatus === 'inProgress') {
            record.state = 'running';
            record.completion = null;
            record.measurement.finishedAt = null;
            return;
        }
        if(entry.session.continueTask&&allowCompletion&&!entry.stopping) {
            const final=group.root.finalResponse===null?null:reviewerFinalStatus(group.root.finalResponse);
            const report=await readReport(entry.reviewFilesystem,record);
            const delivered=!failure?.requiresContinuation&&final?.status==='ready'&&report.status==='succeeded'&&report.text.trim().length>0;
            const absent=report.status!=='succeeded'?await entry.reviewFilesystem.inspect({path:reviewLogicalPath(record.cwd,record.reportPath),rejectHardLinks:true}):null;
            const missing=absent?.status==='succeeded'&&absent.entry.kind==='missing';
            const recoverableRead=report.status!=='succeeded'&&absent?.status==='succeeded'&&absent.entry.kind==='file'
                && report.diagnostics.length>0&&(report.status==='failed'&&report.stage==='read'
                    &&report.diagnostics.every(item=>item.code==='filesystem-io-failed')
                    ||report.status==='blocked'&&report.diagnostics.every(item=>item.code==='filesystem-text-decoding-failed'));
            // An explicit incomplete status ends the round and returns to the Main Agent.
            if(!delivered&&final?.status!=='incomplete'&&(report.status==='succeeded'||missing||recoverableRead)) {
                await checkReportBinding(record, false, record.recoveryPath);
                await entry.session.protectTurn({rootThreadId:/** @type {string} */(record.threadId),turnId:record.turnId});
                await policy?.refresh();
                if(record.failure||entry.stopped||policy?.canContinue()===false)return;
                const work=entry.session.getProviderWork?.()??{};
                const resume=typeof work.resumeMessageId==='string'?entry.session.getTaskMessage?.(work.resumeMessageId):null;
                if(work.paused===true&&(!resume||entry.resumePendingOnAttach===false)){record.state='idle';record.completion=null;return;}
                if(!resume&&snapshot.factsComplete&&group.unknownReasons.length===0&&group.root.turnStatus==='completed'&&!recoverableRead){
                    if(await entry.session.noteEarlyExit?.({turnId:record.turnId})){
                        observeReviewerMeasurement(record.measurement,{members:snapshot.members,rootThreadId:record.threadId,now:clock.now(),
                            measurementFacts:{workState:{state:'paused',at:clock.now(),estimated:false,basis:'The same task is paused while the owning Main obtains user approval.'}}});
                        record.state='idle';record.completion=null;await persist(entry);return;
                    }
                }
                const current=entry.session.getProviderWork?.()??{};
                if(resume&&(resume.deliveryStatus==='unknown'||current.continuationMessageId===resume.messageId)){record.completion=null;return;}
                if(!resume&&current.continuationTurnId===record.turnId&&current.continuationMessageId){record.completion=null;return;}
                const reportFeedback=recoverableRead?`The original bound report could not be read: ${report.diagnostics.map(item=>`${item.code}: ${item.message}`).join(' ')}. Correct this recoverable error and preserve the original report, judgments and evidence.\n\n`:'';
                const instruction=resume?.body??(policy?.continuationFeedback(group.root.turnError)??'')+reportFeedback+
                    (report.status==='succeeded'&&report.text.trim().length>0
                        ?'The bound report exists, but complete successful delivery of this task has not been confirmed. Verify the complete review and deliver the required ready status. Preserve the existing report and evidence; do not create another Agent.'
                        :`${missing?'The bound report is missing. ':report.status==='succeeded'?'The bound report is empty. ':''}Complete successful delivery of this review task has not been confirmed. Continue this same task using the existing input and evidence, correct recoverable errors, complete the necessary checks, personally deliver its original bound report and return the required ready status. Do not create another Agent or replace this task.`);
                const next=await entry.session.continueTask({rootThreadId:record.threadId,endedTurnId:record.turnId,instruction,
                    ...(resume?{messageId:resume.messageId}:{}),compactBinding:record.compactBinding,
                    canContinue:()=>!entry.interruptRequested&&!entry.stopped&&!entry.deadlineStopRequested&&policy?.canContinue()!==false,
                    onAccepted:()=>{}});
                if(next?.deliveryStatus==='delivered'&&next.turnId) {
                    record.turnId=next.turnId;record.state='running';record.completion=null;record.measurement.finishedAt=null;
                    entry.cleanupTurnId=null;entry.cleanupFinalizedTurnId=null;await persist(entry);
                    await policy?.observeCommands(snapshot.commandFacts??[],/** @type {string} */(record.threadId));return;
                }
                if(record.failure||entry.stopped)return;
            }
        }
        if (entry.cleanupFinalizedTurnId !== record.turnId) {
            entry.cleanupTurnId = record.turnId;
            try {
                await entry.session.protectTurn({rootThreadId: record.threadId, turnId: record.turnId});
                await entry.session.cleanupTurnTerminals({rootThreadId: record.threadId, turnId: record.turnId,
                    knownThreadIds: record.knownThreadIds});
                entry.cleanupError = null;
            } catch (error) {
                entry.cleanupError = errorResult(error, 'reviewer-cleanup-unverified');
                incomplete(entry, `Reviewer background terminal cleanup is unverified: ${entry.cleanupError.message}`);
                return;
            }
        }
        if (group.root.finalResponse === null) {
            incomplete(entry, 'The exact current root turn has not delivered a final status.');
            return;
        }
        finishTask(entry);
        const response = reviewerFinalStatus(group.root.finalResponse);
        if (!response) {
            incomplete(entry, 'The Reviewer final message does not follow the status-only contract.');
            return;
        }
        if (response.status === 'incomplete') {
            incomplete(entry, response.reason);
            return;
        }
        if (group.unknownReasons.length > 0) {
            incomplete(entry, `Required native facts remain unverified: ${group.unknownReasons.join(' ')}`);
            return;
        }
        const report = await readReport(entry.reviewFilesystem, record);
        if (report.status !== 'succeeded' || report.text.trim().length === 0) {
            incomplete(entry, 'The exact bound report is missing, empty or unreadable.');
            return;
        }
        await checkReportBinding(record, false, record.recoveryPath);
        record.completion = {status: 'ready', reportPath: record.reportPath};
    };

    /** @param {ReviewerEntry} entry @param {boolean} [allowCompletion] */
    const refresh = async (entry, allowCompletion = true) => {
        if (entry.stopped) return;
        if (!entry.record.threadId) return;
        const before = JSON.stringify(entry.record);
        const snapshot = await entry.session.snapshot({rootThreadId: entry.record.threadId, knownThreadIds: entry.record.knownThreadIds});
        await observe(entry, snapshot, allowCompletion);
        if (entry.cleanupTurnId && !entry.cleanupError && entry.cleanupFinalizedTurnId !== entry.cleanupTurnId) {
            try {
                const idle = await entry.session.idleFacts({rootThreadId: /** @type {string} */ (entry.record.threadId),
                    knownThreadIds: entry.record.knownThreadIds});
                if (!idle.safe || !idle.known) throw new Error(idle.reason ?? 'Native idle facts are unavailable.');
            } catch (error) {
                entry.cleanupError = errorResult(error, 'reviewer-cleanup-unverified');
                incomplete(entry, `Reviewer background terminal cleanup is unverified: ${entry.cleanupError.message}`);
            }
        }
        if (JSON.stringify(entry.record) !== before) await persist(entry);
        if (entry.cleanupTurnId && !entry.cleanupError && entry.cleanupFinalizedTurnId !== entry.cleanupTurnId) {
            await ensurePersisted(entry);
            try {
                await entry.session.releaseProtectedTurn({rootThreadId: /** @type {string} */ (entry.record.threadId),
                    turnId: entry.cleanupTurnId});
                entry.cleanupFinalizedTurnId = entry.cleanupTurnId;
                entry.cleanupTurnId = null;
            } catch (error) {
                entry.cleanupError = errorResult(error, 'reviewer-cleanup-unverified');
                incomplete(entry, `Reviewer background terminal cleanup is unverified: ${entry.cleanupError.message}`);
                await persist(entry);
            }
        }
    };

    /** @param {ReviewerEntry} entry @param {boolean} [deadline] */
    const stopEntry = async (entry,deadline=false) => {
        deadline ||= entry.deadlineStopRequested === true;
        if (entry.stopping || entry.stopped) return;
        if(deadline)entry.deadlineStopRequested=true;
        entry.stopping = true;if(!deadline)entry.providerPolicy?.close();
        /** @type {ReviewerError[]} */
        const failures = [];
        try {
            if(!deadline)try { await refresh(entry, false); } catch (error) { failures.push(errorResult(error)); }
            try {
                const stopped = deadline&&entry.record.threadId&&entry.session.stopForDeadline
                    ?await entry.session.stopForDeadline({rootThreadId:entry.record.threadId}):await entry.session.stop();
                if (stopped.environmentState !== 'exited') throw reviewerFailure('reviewer-stop-failed', 'The Reviewer root environment has not exited.');
                entry.record.environmentState = 'exited';
                await refresh(entry, false);
                if (entry.record.environmentState !== 'exited') throw reviewerFailure('reviewer-stop-failed', 'Native observation does not confirm Reviewer environment exit.');
                if (entry.snapshot?.members.some(member => member.state === 'active')) throw reviewerFailure('reviewer-stop-failed', 'Native observation does not confirm that the Reviewer environment has stopped.');
                const root=entry.snapshot?.members.find(member=>member.threadId===entry.record.threadId);
                if(root?.turnId)entry.record.turnId=root.turnId;
            } catch (error) { failures.push(errorResult(error, 'reviewer-stop-failed')); }
            entry.record.state = failures.length > 0 || entry.record.failure ? 'failed' : 'stopped';
            if (entry.record.environmentState === 'exited') finishTask(entry);
            if (entry.record.completion?.status !== 'ready' || failures.length > 0) {
                incomplete(entry, failures.length > 0 ? failures.map(failure => failure.message).join(' ')
                    : entry.record.failure?.message ?? 'The Reviewer environment stopped before complete report delivery.');
            }
            if (failures.length > 0) entry.record.failure = {code: failures[0].code, message: failures.map(failure => failure.message).join(' ')};
            try { await persist(entry); } catch (error) { failures.push(errorResult(error)); }
            entry.stopped = failures.length === 0;
            if (failures.length > 0) throw reviewerFailure(failures[0].code, failures.map(failure => failure.message).join(' '));
        } finally {
            entry.stopping = false;
            if(entry.stopped)retireIfTerminal(entry);
            else if(entry.deadlineStopRequested&&entry.refreshAgain){
                entry.refreshAgain=false;nativeNotification(entry,{type:'changed',threadId:entry.record.threadId,turnId:entry.record.turnId});
            }
        }
    };

    /** @param {ReviewerEntry} entry @param {NativeNotification} notification */
    const nativeNotification = (entry, notification) => {
        if (closed || runs.get(entry.record.runId) !== entry) return;
        if(entry.stopping){entry.refreshAgain=true;return;}
        if(['stopping','exited'].includes(entry.session.managementState()))return;
        if (entry.refreshScheduled) {entry.refreshAgain = true; return;}
        entry.refreshScheduled = true;
        void serialize(entry, async () => {
            try {
                do {
                    entry.refreshAgain = false;
                    if(entry.deadlineStopRequested&&!entry.stopped)await stopEntry(entry,true);
                    else await refresh(entry);
                } while (entry.refreshAgain && runs.get(entry.record.runId) === entry);
            }
            catch (error) {
                if(entry.deadlineStopRequested){
                    try {await ensurePersisted(entry);} catch { /* Retain unconfirmed stop and persistence facts. */ }
                } else if (entry.cleanupTurnId) {
                    entry.cleanupError = errorResult(error, 'reviewer-completion-unverified');
                    incomplete(entry, `Reviewer completion could not be saved: ${entry.cleanupError.message}`);
                    try { await persist(entry); } catch { /* Keep the original save failure observable on inspection. */ }
                } else await failBackground(entry, error);
            }
            finally {
                retireIfTerminal(entry);entry.refreshScheduled=false;
                if(entry.deadlineStopRequested&&entry.refreshAgain&&!entry.stopped){
                    entry.refreshAgain=false;nativeNotification(entry,{type:'changed',threadId:entry.record.threadId,turnId:entry.record.turnId});
                }
            }
        });
    };

    /** Manager confirmed the root and its tools unloaded; no native snapshot is needed. */
    /** @param {ReviewerEntry} entry */
    const confirmedUnload = entry => {
        if (closed) return;
        // The manager already confirmed root and tool exit; do not reserve live capacity during its closure.
        void entry.serial(async () => {
            if (runs.get(entry.record.runId) !== entry || entry.session.managementState() !== 'exited') return;
            try {await reconcileExited(entry, true);await ensurePersisted(entry);retireIfTerminal(entry);}
            catch { /* Preserve the live handle until a later inspection can report the save failure. */ }
        });
    };

    /** @param {Pick<ReviewerHandoff, 'cwd' | 'writePaths' | 'reportPath'>} handoff @param {boolean} fresh @param {string} recoveryPath */
    const checkReportBinding = async (handoff, fresh, recoveryPath) => {
        const reportDirectory = requireReportDirectory(handoff);
        if (isWithinReviewerPaths(dirname(recoveryPath), handoff.writePaths)) {
            throw reviewerFailure('invalid-input', 'Reviewer recovery records must stay outside the writable report directory.');
        }
        const opened = await filesystem.open({root: handoff.cwd});
        if (opened.status !== 'succeeded') throw reviewerFailure('report-binding-invalid', 'The audited repository cannot be opened for its bound report.');
        const reviewFilesystem = opened.scopedFilesystem;
        const inspected = await reviewFilesystem.inspect({path: reviewLogicalPath(handoff.cwd, reportDirectory)});
        if (inspected.status !== 'succeeded' || inspected.entry.kind !== 'directory') {
            throw reviewerFailure('invalid-input', 'A Reviewer write path must be an existing directory within the audited repository.');
        }
        const reportLogicalPath = reviewLogicalPath(handoff.cwd, handoff.reportPath);
        const listed = await reviewFilesystem.list({path: reviewLogicalPath(handoff.cwd, reportDirectory), recursive: false});
        if (listed.status !== 'succeeded' || listed.entries.some(entry => entry.path !== reportLogicalPath || entry.kind !== 'file')) {
            throw reviewerFailure('report-binding-invalid', 'The Reviewer report directory must contain only its exact bound report.');
        }
        if (fresh) {
            const read = await reviewFilesystem.read({path: reportLogicalPath, rejectHardLinks: true});
            if (read.status !== 'succeeded' || read.bytes.length > 0) {
                throw reviewerFailure('report-binding-invalid', 'A new review requires its own existing empty bound report file.');
            }
        } else {
            const report = await reviewFilesystem.inspect({path: reportLogicalPath, rejectHardLinks: true});
            if (report.status !== 'succeeded' || !['missing', 'file'].includes(report.entry.kind)) {
                throw reviewerFailure('report-binding-invalid', 'The bound report path must be missing or a regular file without hard links.');
            }
        }
        return reviewFilesystem;
    };

    /** @param {ReviewerEntry} entry @param {unknown} error */
    const failBackground = async (entry, error) => {
        const failure = errorResult(error);
        entry.record.failure = failure;
        entry.record.state = 'failed';
        incomplete(entry, failure.message);
        if(!entry.deadlineStopRequested)entry.providerPolicy?.close();
        try { await stopEntry(entry); }
        catch (stopError) {
            entry.record.failure = {code: failure.code, message: `${failure.message} ${errorResult(stopError).message}`};
            try { await persist(entry); } catch { /* The last saved recovery facts remain authoritative. */ }
        }
    };

    /** @param {ReviewerEntry} entry @param {ReviewerHandoff} handoff @param {{threadId:string,sessionPath:string|null}} native @param {boolean} fresh */
    const prepareRound = async (entry, handoff, native, fresh) => {
        const record = entry.record;
        if (!fresh && record.threadId !== native.threadId) {
            throw reviewerFailure('recovery-thread-mismatch', 'Native recovery did not return the confirmed original thread.');
        }
        if (!fresh && record.sessionPath !== null && native.sessionPath !== record.sessionPath) {
            throw reviewerFailure('recovery-thread-mismatch', 'The original native record path changed.');
        }
        const baseline = await entry.session.snapshot({rootThreadId: native.threadId, knownThreadIds: fresh ? [] : record.knownThreadIds});
        const root = baseline.members.find(member => member.threadId === native.threadId);
        providerPolicy(entry)?.setCommandBaseline(baseline.commandFacts??[],native.threadId);

        if (fresh && (!root || root.parentThreadId !== null || root.hasConversationHistory !== false
            || root.turnId !== null || root.contexts.length !== 0 || root.finalResponse !== null)) {
            throw reviewerFailure('reviewer-context-not-isolated', 'A new Reviewer must have a confirmed parentless native thread with no inherited conversation.');
        }
        if (root?.state === 'active') throw reviewerFailure('reviewer-busy', 'The original Reviewer is still executing.');
        const floors = reviewerContextFloors(baseline.members);
        const checked = inspectReviewerGroup(baseline, {
            rootThreadId: native.threadId, cwd: handoff.cwd,
            writePaths: handoff.writePaths, reportPath: handoff.reportPath, contextFloors: floors, beforeTurn: true,
        });
        if (fresh && baseline.members.some(member => member.threadId !== native.threadId)) {
            checked.violations.push('A new Reviewer thread already has an additional Agent.');
        }
        if (checked.violations.length > 0) throw reviewerFailure('reviewer-group-violation', checked.violations.join(' '));
        if (checked.unknownReasons.length > 0) throw reviewerFailure('native-facts-unverified', checked.unknownReasons.join(' '));
        Object.assign(record, {
            settings: handoff.settings, cwd: handoff.cwd, readPaths: handoff.readPaths,
            writePaths: handoff.writePaths, reportPath: handoff.reportPath,
            threadId: native.threadId, sessionPath: native.sessionPath, turnId: null,
            knownThreadIds: [...new Set([...record.knownThreadIds, ...baseline.members.map(member => member.threadId)])],
            contextFloors: floors,
            measurement: createReviewerMeasurement({
                startedAt: clock.now(), members: baseline.members, rootThreadId: native.threadId,measurementFacts:baseline.measurementFacts,
                ...(fresh ? {freshRoot: native.threadId} : {}),
            }),
            state: 'starting', environmentState: 'running', factsComplete: baseline.factsComplete,
            completion: null, failure: null,
        });
        entry.snapshot = baseline;
        entry.session.setTaskMeasurement?.(()=>reviewerMeasurementResult(entry.record.measurement,clock.now(),entry.record.factsComplete));
        await persist(entry);
    };

    /** @param {ReviewerEntry} entry @param {string} messageId @param {() => Promise<{threadId:string,sessionPath:string|null}>} prepare @param {ReviewerHandoff} handoff @param {boolean} fresh */
    const finishAccepted = (entry, messageId, prepare, handoff, fresh) => {
        void serialize(entry, async () => {
            try {
                await checkReportBinding(handoff, true, entry.record.recoveryPath);
                const configured=await entry.session.configureReviewerTask?.({identityKind:handoff.identity.kind,stateDirectory:dirname(entry.record.recoveryPath),messageId});
                if(configured){entry.providerPolicy?.close();entry.providerPolicy=null;entry.record.compactBinding=configured.compactBinding;if(configured.enabled)handoff.settings=configured.settings;}
                await prepareRound(entry, handoff, await prepare(), fresh);
                const delivered = await entry.session.dispatchAccepted({messageId});
                if (!delivered.turnId || delivered.deliveryStatus !== 'delivered') {
                    throw reviewerFailure('reviewer-delivery-unknown', 'The accepted Reviewer task was not confirmed delivered to its native turn.');
                }
                entry.record.turnId = delivered.turnId;
                entry.record.measurement.startedAt=entry.session.getTaskStartedAt?.()??entry.record.measurement.startedAt;
                await entry.session.protectTurn({rootThreadId: /** @type {string} */ (entry.record.threadId), turnId: delivered.turnId});
                entry.record.state = 'running';
                entry.interruptRequested = false;
                await persist(entry);
                await refresh(entry);
            } catch (error) {
                try { await entry.session.failAcceptedTask({messageId}); }
                catch (deliveryError) {
                    const original = errorResult(error);
                    error = reviewerFailure(original.code,
                        `${original.message} Pending task failure could not be recorded: ${errorResult(deliveryError).message}`);
                }
                await failBackground(entry, error);
            }
            finally { retireIfTerminal(entry); }
        });
    };

    /** @param {unknown} raw @returns {Promise<ReviewerOperationResult>} */
    const spawn = async raw => {
        const input = requireObject(raw);
        const handoff = readHandoff(input);
        if (input.newThread !== undefined && typeof input.newThread !== 'boolean') throw reviewerFailure('invalid-input', 'newThread must be a boolean.');
        const stateDirectory = requireReviewerPath(input.stateDirectory, 'stateDirectory');
        if (isWithinReviewerPaths(stateDirectory, handoff.writePaths)) {
            throw reviewerFailure('invalid-input', 'Reviewer recovery records must stay outside the writable report directory.');
        }
        const recoveryPath = reviewerRecoveryPath({stateDirectory, role: handoff.role, identity: handoff.identity});
        const boundary = recoveryBoundary();
        const location = requireReviewerRecoveryLocation(recoveryPath, boundary);
        if (!location.currentSession) throw reviewerFailure('invalid-input', 'A new Reviewer must use the current session workspace.');
        const recordFilesystem = await openReviewerRecordFilesystem(filesystem, boundary.repositoryRoot, location.relativePath);
        const previous = await readReviewerSessionRecord(recordFilesystem, recoveryPath, location.relativePath);
        if (previous && !input.newThread) throw reviewerFailure('reviewer-identity-exists', 'The original Reviewer identity already exists; assign a complete follow-up task to its run.');
        const held = previous ? runs.get(previous.runId) : undefined;
        if (held) await serialize(held, async () => {
            if (held.record.state === 'starting') throw reviewerFailure('reviewer-busy', 'The original Reviewer task is still starting.');
            if (held.session.managementState() !== 'exited') await refresh(held);
            if (held.record.state === 'running') throw reviewerFailure('reviewer-busy', 'The original Reviewer is still executing.');
        });
        const reviewFilesystem = await checkReportBinding(handoff, true, recoveryPath);
        /** @type {ReviewerEntry | null} */
        let entry = null;
        const session = await nativeSessions.open({
            settings: reviewerNativeSettings(handoff.settings, handoff), cwd: handoff.cwd,
            readPaths: handoff.readPaths, writePaths: handoff.writePaths,
            onNotification: notification => { if (entry) nativeNotification(entry, notification); },
            onUnloaded: () => { if (entry) confirmedUnload(entry); },
        });
        const reserved = await session.reserve({stateDirectory});
        const receipt = await session.acceptStart({handoff: handoff.handoff, instructions: handoff.instructions});
        if (reserved.runId !== receipt.runId) throw reviewerFailure('run-mismatch', 'The accepted Reviewer run identity changed.');
        const record = /** @type {ReviewerSessionRecord} */ ({
            runId: receipt.runId, role: handoff.role, identity: handoff.identity, settings: handoff.settings,
            cwd: handoff.cwd, readPaths: handoff.readPaths, writePaths: handoff.writePaths,
            reportPath: handoff.reportPath, recoveryPath, threadId: null, sessionPath: null,
            turnId: null, knownThreadIds: [], contextFloors: {},
            measurement: {startedAt: clock.now(), finishedAt: null, threads: {}},
            state: 'starting', environmentState: 'running', factsComplete: false, completion: null, failure: null,
        });
        entry = newEntry({record, session, filesystem: recordFilesystem, reviewFilesystem, recoveryRecordPath: location.relativePath});
        if (held) {
            held.session.detach();
            held.snapshot = null;
            runs.delete(held.record.runId);
            recoveryPaths.delete(held.record.runId);
        }
        runs.set(record.runId, entry);
        recoveryPaths.set(record.runId, recoveryPath);
        finishAccepted(entry, receipt.messageId, () => session.prepareNativeStart(), handoff, true);
        return {...identityResult(entry), accepted: true, messageId: receipt.messageId, deliveryStatus: 'accepted'};
    };

    /** @param {unknown} raw @returns {Promise<ReviewerOperationResult>} */
    const followup = async raw => {
        const input = requireObject(raw);
        const runId = requireReviewerText(input.runId, 'runId');
        const handoff = readHandoff(input);
        const stateDirectory = requireReviewerPath(input.stateDirectory, 'stateDirectory');
        if (isWithinReviewerPaths(stateDirectory, handoff.writePaths)) {
            throw reviewerFailure('invalid-input', 'Reviewer recovery records must stay outside the writable report directory.');
        }
        const recoveryPath = reviewerRecoveryPath({stateDirectory, role: handoff.role, identity: handoff.identity});
        if (input.recoveryPath !== undefined && requireReviewerPath(input.recoveryPath, 'recoveryPath') !== recoveryPath) {
            throw reviewerFailure('recovery-binding-mismatch', 'The exact Reviewer recovery path differs.');
        }
        const boundary = recoveryBoundary();
        const location = requireReviewerRecoveryLocation(recoveryPath, boundary);
        const recordFilesystem = await openReviewerRecordFilesystem(filesystem, boundary.repositoryRoot, location.relativePath);
        const {entry:held,reviewFilesystem}=await recordSerial(recoveryPath)(async()=>{
            const previous = await readReviewerSessionRecord(recordFilesystem, recoveryPath, location.relativePath);
            if (!previous) throw reviewerFailure('recovery-not-found', 'The exact original Reviewer recovery record does not exist.');
            if (previous.runId !== runId || previous.role !== handoff.role || !jsonSemanticallyEqual(previous.identity, handoff.identity)) {
                throw reviewerFailure('recovery-identity-mismatch', 'The run, role or complete Reviewer identity differs from the original thread.');
            }
            if (!previous.threadId || previous.failure) {
                throw reviewerFailure(previous.failure?.code ?? 'recovery-thread-unavailable', 'The original Reviewer thread is not reliable for another task.');
            }
            const reviewFilesystem = await checkReportBinding(handoff, true, recoveryPath);
            let entry = runs.get(runId);
            if (entry?.session.managementState() === 'exited') {
                entry.session.detach();
                runs.delete(runId);
                entry = undefined;
            }
            if (!entry) {
                const session = await nativeSessions.open({
                    settings: reviewerNativeSettings(previous.settings, previous), cwd: previous.cwd,
                    readPaths: previous.readPaths, writePaths: previous.writePaths,
                    onNotification: notification => { if (entry) nativeNotification(entry, notification); },
                    onUnloaded: () => { if (entry) confirmedUnload(entry); },
                });
                await session.resume({runId, threadId: previous.threadId, expectedSessionPath: previous.sessionPath,
                    instructions: handoff.instructions, deferRestore: true});
                if (session.runId !== runId) throw reviewerFailure('recovery-thread-mismatch', 'The original managed run identity changed.');
                entry = newEntry({record: previous, session, filesystem: recordFilesystem, reviewFilesystem,
                    recoveryRecordPath: location.relativePath, persistedRecord: JSON.stringify(previous)});
                runs.set(runId, entry);
            }
            return {entry,reviewFilesystem};
        });
        return serialize(held, async () => {
            // A queued completion may have retired this handle after it was selected.
            if (runs.get(runId) !== held) return followup(raw);
            recoveryPaths.set(runId, recoveryPath);
            if (held.session.managementState() === 'exited') await reconcileExited(held, false);
            else {
                if (held.record.state === 'starting') throw reviewerFailure('reviewer-busy', 'The original Reviewer task is still starting.');
                await refresh(held);
            }
            if (held.cleanupError || held.cleanupTurnId) {
                throw reviewerFailure('reviewer-cleanup-unverified', held.cleanupError?.message
                    ?? 'The previous Reviewer turn has not completed terminal cleanup.');
            }
            if (held.record.failure) throw reviewerFailure(held.record.failure.code, held.record.failure.message);
            if (held.record.state === 'running') throw reviewerFailure('reviewer-busy', 'The original Reviewer is still executing.');
            const accepted = await held.session.acceptTask({
                handoff: handoff.handoff, instructions: handoff.instructions,
                settings: reviewerNativeSettings(handoff.settings, handoff), cwd: handoff.cwd,
                readPaths: handoff.readPaths, writePaths: handoff.writePaths,
            });
            held.reviewFilesystem = reviewFilesystem;
            held.record.state = 'starting';
            held.record.completion = null;
            held.record.measurement.finishedAt = null;
            finishAccepted(held, accepted.messageId, () => held.session.prepareForTask({messageId: accepted.messageId}), handoff, false);
            return {...identityResult(held), accepted: true, messageId: accepted.messageId, deliveryStatus: 'accepted'};
        });
    };

    /** Restore only the original still-paused task; a work message does not create a new review.
     * @param {{runId:string,managed:import('../background-agent/state-store.mjs').BackgroundAgentRow,resumePending?:boolean}} input
     */
    const restorePausedTask=async({runId,managed,resumePending=true})=>{
        const held=runs.get(runId);
        if(held){await checkReportBinding(held.record, false, held.record.recoveryPath);held.resumePendingOnAttach=resumePending;return;}
        if(managed.providerWork?.paused!==true||!managed.recoveryPath)return;
        const discovered=await inspect({runId,managed});
        if(discovered.status!=='succeeded')throw reviewerFailure(discovered.error.code,discovered.error.message);
        const recoveryPath=discovered.result.recoveryPath;
        const boundary=recoveryBoundary();
        const location=requireReviewerRecoveryLocation(recoveryPath,boundary);
        const recordFilesystem=await openReviewerRecordFilesystem(filesystem,boundary.repositoryRoot,location.relativePath);
        await recordSerial(recoveryPath)(async()=>{
            if(runs.has(runId))return;
            const record=await readReviewerSessionRecord(recordFilesystem,recoveryPath,location.relativePath);
            if(!record||record.runId!==runId||record.role!==managed.role||record.threadId!==managed.threadId
                ||record.sessionPath!==managed.sessionPath||record.cwd!==managed.cwd
                ||!jsonSemanticallyEqual(record.readPaths,managed.readPaths)||!jsonSemanticallyEqual(record.writePaths,managed.writePaths)
                ||!isWithinReviewerPaths(record.reportPath,record.writePaths)
                ||!record.threadId||!record.turnId||record.failure||record.completion||record.measurement.finishedAt!==null)
                throw reviewerFailure('recovery-identity-mismatch','The original paused Reviewer task cannot be restored.');
            const reviewFilesystem=await checkReportBinding(record, false, record.recoveryPath);
            /** @type {ReviewerEntry|undefined} */let entry;
            const session=await nativeSessions.open({settings:record.settings,cwd:record.cwd,readPaths:record.readPaths,writePaths:record.writePaths,
                onNotification:notification=>{if(entry)nativeNotification(entry,notification);},onUnloaded:()=>{if(entry)confirmedUnload(entry);}});
            await session.resume({runId,threadId:record.threadId,expectedSessionPath:record.sessionPath,instructions:managed.instructions,deferRestore:true});
            entry=newEntry({record,session,filesystem:recordFilesystem,reviewFilesystem,recoveryRecordPath:location.relativePath,
                persistedRecord:JSON.stringify(record),resumePendingOnAttach:resumePending});
            runs.set(runId,entry);recoveryPaths.set(runId,record.recoveryPath);
            session.setTaskMeasurement?.(()=>reviewerMeasurementResult(record.measurement,clock.now(),record.factsComplete));
            await session.configureReviewerTask?.({identityKind:record.identity.kind,stateDirectory:dirname(record.recoveryPath),compactBinding:record.compactBinding,restore:true});
            await session.restoreCurrentTask?.();
            providerPolicy(entry);
        });
    };

    /** @param {{runId: string, managed?: import('../background-agent/state-store.mjs').BackgroundAgentRow}} input @returns {Promise<ReviewerRuntimeResult>} */
    const inspect = async input => {
        try {
            if (closed) throw reviewerFailure('runtime-closed', 'The Reviewer runtime has closed.');
            const runId = requireReviewerText(input.runId, 'runId');
            let entry = runs.get(runId);
            if (!entry) {
                let recoveryPath = recoveryPaths.get(runId);
                if (!recoveryPath && input.managed) {
                    const managed = input.managed;
                    if (managed.runId !== runId || !REVIEWER_ROLES.includes(managed.role) || !managed.recoveryPath
                        || managed.recoveryPath !== backgroundAgentRecoveryPath({stateDirectory: dirname(managed.recoveryPath), runId})) {
                        throw reviewerFailure('recovery-identity-mismatch', 'The saved managed Reviewer binding is invalid.');
                    }
                    const boundary = recoveryBoundary();
                    const location = requireReviewerRecoveryLocation(managed.recoveryPath, boundary);
                    const recordFilesystem = await openReviewerRecordFilesystem(filesystem, boundary.repositoryRoot, location.relativePath);
                    const directory = dirname(location.relativePath).split(sep).join('/');
                    const listed = await recordFilesystem.list({path: directory});
                    if (listed.status !== 'succeeded') throw reviewerFailure('recovery-io-failed', 'The Reviewer recovery directory could not be listed.');
                    /** @type {string[]} */
                    const matches = [];
                    for (const candidate of listed.entries) {
                        if (candidate.kind !== 'file' || !/^reviewer-[a-f0-9]+\.json$/u.test(candidate.path.split('/').at(-1) ?? '')) continue;
                        const candidatePath = resolve(boundary.repositoryRoot, ...candidate.path.split('/'));
                        const record = await readReviewerSessionRecord(recordFilesystem, candidatePath, candidate.path);
                        if (!record || record.runId !== runId) continue;
                        matches.push(candidatePath);
                    }
                    if (matches.length !== 1) throw reviewerFailure('recovery-identity-mismatch', 'The exact saved Reviewer binding is unavailable.');
                    recoveryPath = matches[0];
                }
                if (!recoveryPath) throw reviewerFailure('run-not-found', 'The original Reviewer run is not held by this runtime.');
                const savedPath=recoveryPath;
                const cold=await recordSerial(savedPath)(async()=>{
                    const current=runs.get(runId);
                    if(current)return current;
                    const boundary = recoveryBoundary();
                    const location = requireReviewerRecoveryLocation(savedPath, boundary);
                    const recordFilesystem = await openReviewerRecordFilesystem(filesystem, boundary.repositoryRoot, location.relativePath);
                    const record = await readReviewerSessionRecord(recordFilesystem, savedPath, location.relativePath);
                    if (!record || record.runId !== runId) throw reviewerFailure('recovery-identity-mismatch', 'The saved Reviewer run identity changed.');
                    if (input.managed && (savedPath !== reviewerRecoveryPath({stateDirectory: dirname(input.managed.recoveryPath ?? ''),
                        role: record.role, identity: record.identity})
                        || record.role !== input.managed.role || record.threadId !== input.managed.threadId
                        || record.sessionPath !== input.managed.sessionPath || record.cwd !== input.managed.cwd
                        || !jsonSemanticallyEqual(record.readPaths, input.managed.readPaths)
                        || !jsonSemanticallyEqual(record.writePaths, input.managed.writePaths)
                        || !isWithinReviewerPaths(record.reportPath, record.writePaths))) {
                        throw reviewerFailure('recovery-identity-mismatch', 'The saved Reviewer and managed native bindings differ.');
                    }
                    const before=JSON.stringify(record);
                    if (input.managed?.providerWork?.paused!==true&&input.managed?.state === 'exited' && (record.environmentState !== 'exited'
                        || ['starting', 'running', 'idle', 'interrupted'].includes(record.state))) {
                        record.environmentState = 'exited';
                        record.state = record.failure ? 'failed' : 'stopped';
                        if (record.failure || record.completion?.status !== 'ready') record.completion = {status: 'incomplete',
                            reason: record.failure?.message ?? 'The Reviewer environment exited before complete report delivery.', reportPath: record.reportPath};
                    }
                    if(input.managed?.providerWork?.paused!==true&&input.managed?.state==='exited'){
                        const managed=input.managed;
                        const end=managed.taskFinishedAtMs;
                        const finishedAt=managed.taskState==='ended'&&managed.taskStartedAtMs===record.measurement.startedAt
                            &&typeof end==='number'&&Number.isFinite(end)&&end>=record.measurement.startedAt?end:null;
                        observeReviewerUnavailableMeasurement(record.measurement,{rootThreadId:record.threadId,now:clock.now(),finishedAt});
                    }
                    if (record.completion?.status === 'ready') {
                        let reviewFilesystem;
                        if (hasFileReportWritePath(record)) {
                            const opened = await filesystem.open({root: record.cwd});
                            reviewFilesystem = opened.status === 'succeeded' ? opened.scopedFilesystem : null;
                        } else reviewFilesystem = await checkReportBinding(record, false, record.recoveryPath);
                        const report = reviewFilesystem ? await readReport(reviewFilesystem, record) : null;
                        if (report?.status !== 'succeeded' || report.text.trim().length === 0) {
                            record.completion = {status: 'incomplete', reason: 'The exact bound report is missing, empty or unreadable.',
                                reportPath: record.reportPath};
                        }
                    }
                    const measurement = measurementResult(record);
                    if(JSON.stringify(record)!==before){
                        checkpointReviewerMeasurement(record.measurement);
                        const snapshot=/** @type {ReviewerSessionRecord} */(/** @type {unknown} */(cloneJsonValue(record)));
                        await saveReviewerSessionRecord(recordFilesystem,snapshot,location.relativePath);
                    }
                    return {status: /** @type {const} */('succeeded'), result: {...recordIdentity(record), completion: record.completion,
                        measurement: input.managed?.state === 'unknown' && record.measurement.finishedAt === null
                            ? {...measurement, wallClockMs: null} : measurement}};
                });
                if('record' in cold)entry=cold;
                else return cold;
            }
            // A native start can be blocked before a thread exists. Its accepted, persisted
            // starting state is observable without waiting for the background start task.
            if (input.managed && entry.record.state === 'starting' && entry.record.threadId === null) {
                return {status: 'succeeded', result: {...identityResult(entry),
                    completion: entry.record.completion ? {...entry.record.completion} : null,
                    measurement: measurementResult(entry.record)}};
            }
            const result = await serialize(entry, async () => {
                if (entry.session.managementState() === 'exited' && entry.record.environmentState !== 'exited') {
                    await reconcileExited(entry, true);
                } else if (entry.record.threadId && entry.session.managementState() !== 'exited'
                    && !(entry.record.completion?.status === 'ready' && hasFileReportWritePath(entry.record))) await refresh(entry);
                if (entry.record.completion?.status === 'ready') {
                    if (!hasFileReportWritePath(entry.record)) await checkReportBinding(entry.record, false, entry.record.recoveryPath);
                    const report = await readReport(entry.reviewFilesystem, entry.record);
                    if (report.status !== 'succeeded' || report.text.trim().length === 0) {
                        incomplete(entry, 'The exact bound report is missing, empty or unreadable.');
                        await persist(entry);
                    }
                }
                await ensurePersisted(entry);
                const observed = {...identityResult(entry), completion: entry.record.completion ? {...entry.record.completion} : null,
                    measurement: measurementResult(entry.record)};
                retireIfTerminal(entry);
                return observed;
            });
            return {status: 'succeeded', result};
        } catch (error) { return {status: 'failed', error: errorResult(error)}; }
    };

    /** @param {{operation: string, input: unknown}} request @returns {Promise<ReviewerRuntimeResult>} */
    const execute = async request => {
        try {
            if (closed) throw reviewerFailure('runtime-closed', 'The Reviewer runtime has closed.');
            const outer = requireObject(request);
            const operation = requireReviewerText(outer.operation, 'operation');
            const input = requireObject(outer.input);
            if (operation === 'spawn_agent' || operation === 'followup_task') {
                const pending = launchTail.then(() => operation === 'spawn_agent' ? spawn(input) : followup(input));
                launchTail = pending.catch(() => undefined);
                return {status: 'succeeded', result: await pending};
            }
            if (operation !== 'interrupt_agent') throw reviewerFailure('unsupported-operation', 'The Reviewer operation is unsupported.');
            const runId = requireReviewerText(input.runId, 'runId');
            const entry = runs.get(runId);
            if (!entry || !entry.record.threadId) throw reviewerFailure('run-not-found', 'The original Reviewer thread is unavailable.');
            const turnId = requireReviewerText(input.turnId, 'turnId');
            const result = await serialize(entry, async () => {
                await refresh(entry, false);
                if (entry.record.failure) throw reviewerFailure(entry.record.failure.code, entry.record.failure.message);
                const root = entry.snapshot?.members.find(member => member.threadId === entry.record.threadId);
                const paused=entry.session.getProviderWork?.()?.paused===true;
                if (!root || (!paused&&root.state !== 'active') || root.turnId !== turnId || entry.record.turnId !== turnId) {
                    throw reviewerFailure('turn-mismatch', 'The observed active Reviewer turn has changed.');
                }
                if(!paused)await entry.session.interruptGroup({rootThreadId: /** @type {string} */ (entry.record.threadId), turnId});
                entry.interruptRequested = true;entry.providerPolicy?.cancel('The user interrupted the current task.');
                await refresh(entry);
                retireIfTerminal(entry);
                return {...identityResult(entry), accepted: /** @type {true} */ (true)};
            });
            return {status: 'succeeded', result};
        } catch (error) { return {status: 'failed', error: errorResult(error)}; }
    };

    /** @returns {Promise<ReviewerCloseResult>} */
    const close = () => {
        if (closePromise) return closePromise;
        closed = true;
        closePromise = (async () => {
            await launchTail;
            for (const entry of runs.values()) entry.session.detach();
            return {status: 'succeeded', result: {closed: /** @type {true} */ (true)}};
        })();
        return closePromise;
    };
    return {execute, inspect, restorePausedTask, holdsRun: runId => runs.has(runId), hasLiveRuns: () => runs.size > 0, close};
};
