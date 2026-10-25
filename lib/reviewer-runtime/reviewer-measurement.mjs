import {createUsage} from '../background-agent/usage.mjs';
import {mergeNativeResponseMeasurement, readNativeWorkClock, estimateNativeSleepInterval} from '../background-agent/native-measurement.mjs';

/** @typedef {import('../background-agent/codex-app-server.mjs').NativeUsage} NativeUsage */
/** @typedef {import('../background-agent/codex-app-server.mjs').NativeMember} NativeMember */
/** @typedef {{baseline: NativeUsage, observed: NativeUsage, current: NativeUsage, participated: boolean}} ThreadMeasurement */
/** @typedef {import('../background-agent/native-measurement.mjs').NativeMeasurementFacts} NativeMeasurementFacts */
/** @typedef {import('../background-agent/native-measurement.mjs').NativeResponseMeasurement} NativeResponseMeasurement */
/** @typedef {'native-prompt'|'native-ttft'|'native-generation'|'native-tbt'|'client-request'|'existing-events'} PhaseSource */
/** @typedef {{tokens:number,durationMs:number,source:PhaseSource,estimated:boolean,basis:string|null,measuredRequests:number}} PhaseGroup */
/** @typedef {{excludedMs:number,previousEnd:number|null,lastStart:number|null,lastEnd:number|null,openStart:number|null,estimated:boolean,basis:string[],coverage:boolean,lastWorkingAt?:number|null}} WorkMeasurement */
/** @typedef {{fresh:boolean,baselineResponses:string[],recordFloor:number|null,responses:Record<string,NativeResponseMeasurement>,complete:boolean}} PhaseMeasurement */
/** @typedef {{startedAt: number, finishedAt: number | null, threads: Record<string, ThreadMeasurement>,work?:WorkMeasurement,phases?:PhaseMeasurement}} ReviewerMeasurement */

/** @typedef {{clock:import('../background-agent/native-measurement.mjs').NativeWorkClockSample|null,workingAt:number|null}} WorkObservation */
/** @type {WeakMap<WorkMeasurement,WorkObservation>} */
const workObservations=new WeakMap();

/** @type {Array<keyof NativeUsage>} */
export const REVIEWER_USAGE_FIELDS = [
    'inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'outputTokens',
    'reasoningOutputTokens', 'totalTokens',
];

export {createUsage};

/** @param {{startedAt: number, members: NativeMember[], rootThreadId: string, freshRoot?: string,measurementFacts?:NativeMeasurementFacts}} input @returns {ReviewerMeasurement} */
export const createReviewerMeasurement = ({startedAt, members, rootThreadId, freshRoot, measurementFacts}) => ({
    startedAt,
    finishedAt: null,
    threads: Object.fromEntries(members.filter(member => member.threadId === rootThreadId).map(member => [member.threadId, {
        baseline: member.threadId === freshRoot ? createUsage(0) : {...member.usage},
        observed: {...member.usage},
        current: {...member.usage},
        participated: true,
    }])),
    work: createWorkMeasurement(startedAt),
    phases: {
        fresh: freshRoot === rootThreadId,
        baselineResponses: (measurementFacts?.responses ?? []).filter(response => response.threadId === rootThreadId).map(response => response.responseId),
        recordFloor: measurementFacts?.responses?.some(response => response.threadId === rootThreadId && knownNumber(response.recordSequence))
            ? Math.max(...measurementFacts.responses.filter(response => response.threadId === rootThreadId).map(response => response.recordSequence ?? 0)) : null,
        responses: {}, complete: false,
    },
});

/**
 * Only the original Reviewer Thread.id contributes usage. Missing observations retain
 * the last observation for recovery, but cannot become a known final total.
 * @param {ReviewerMeasurement} measurement
 * @param {{members: NativeMember[], rootThreadId: string,measurementFacts?:NativeMeasurementFacts,now?:number,verifiedWorkingAt?:number}} observation
 */
export const observeReviewerMeasurement = (measurement, {members, rootThreadId, measurementFacts, now,verifiedWorkingAt}) => {
    for (const threadId of Object.keys(measurement.threads)) if (threadId !== rootThreadId) delete measurement.threads[threadId];
    const root = members.find(member => member.threadId === rootThreadId);
    for (const member of root ? [root] : []) {
        let thread = measurement.threads[member.threadId];
        if (!thread) {
            thread = {
                baseline: createUsage(null),
                observed: createUsage(null),
                current: createUsage(null),
                participated: true,
            };
            measurement.threads[member.threadId] = thread;
        }
        thread.participated = true;
        for (const field of REVIEWER_USAGE_FIELDS) {
            const value = member.usage[field];
            const previous = thread.observed[field];
            const valid = typeof value === 'number' && Number.isFinite(value) && value >= 0;
            thread.current[field] = valid && (previous === null || value >= previous) ? value : null;
            if (valid && (previous === null || value >= previous)) thread.observed[field] = value;
        }
    }
    const thread = measurement.threads[rootThreadId];
    if (!root && thread) thread.current = createUsage(null);
    const at=now??measurementFacts?.workState?.at??measurement.startedAt;
    if (measurementFacts) {
        observePhases(measurement, measurementFacts, rootThreadId);
        observeWork(measurement, measurementFacts, at);
    }
    observeWorkClock(measurement,at);
    if(root&&measurement.finishedAt===null&&knownNumber(verifiedWorkingAt))rememberWorking(measurement.work??=createWorkMeasurement(),Math.min(at,verifiedWorkingAt));
};

/** @param {number|null} [lastWorkingAt] @returns {WorkMeasurement} */
function createWorkMeasurement(lastWorkingAt=null) {
    const work={excludedMs: 0, previousEnd: null, lastStart: null, lastEnd: null, openStart: null, estimated: false, basis: [], coverage: false,lastWorkingAt};
    workObservations.set(work,{clock:readNativeWorkClock(),workingAt:lastWorkingAt});
    return work;
}
/** @param {WorkMeasurement} work @param {number} at */
function rememberWorking(work,at) {
    const observation=workObservations.get(work)??{clock:null,workingAt:null};
    observation.workingAt=Math.max(observation.workingAt??at,at);
    workObservations.set(work,observation);
}
/** 只在调用方已决定保存恢复记录后保留边界, 不让普通查询强迫写入. @param {ReviewerMeasurement} measurement */
export function checkpointReviewerMeasurement(measurement) {
    const work=measurement.work;
    const observed=work?workObservations.get(work)?.workingAt:null;
    if(work&&knownNumber(observed))work.lastWorkingAt=Math.max(work.lastWorkingAt??observed,Math.min(observed,measurement.finishedAt??observed));
}
/** @param {WorkMeasurement} work @param {string|undefined} basis */
function workBasis(work, basis) {
    if (basis && !work.basis.includes(basis)) work.basis.push(basis);
}
/** @param {ReviewerMeasurement} measurement @param {number} at @param {string|null} [rootThreadId] */
function workingCheckpoint(measurement,at,rootThreadId) {
    const work=measurement.work;
    const retained=[work?.lastEnd,...Object.values(measurement.phases?.responses??{})
        .filter(response=>rootThreadId===undefined||response.threadId===rootThreadId)
        .flatMap(response=>[response.completedAt,response.lastGeneratedAt,response.firstGeneratedAt])]
        .filter(value=>knownNumber(value)&&value<=at);
    const boundaries=[work?workObservations.get(work)?.workingAt:null,work?.lastWorkingAt,...retained]
        .filter(value=>knownNumber(value)&&value>=measurement.startedAt);
    return boundaries.length?Math.max(.../** @type {number[]} */(boundaries)):null;
}
/** 冷恢复固定非工作估算, 整体结束时间只采用调用方交付的同任务已确认事实.
 * @param {ReviewerMeasurement} measurement @param {{rootThreadId:string|null,now:number,finishedAt:number|null}} observation
 */
export function observeReviewerUnavailableMeasurement(measurement,{rootThreadId,now,finishedAt}) {
    if(measurement.finishedAt!==null)return;
    if(measurement.work?.openStart==null){
        const checkpoint=workingCheckpoint(measurement,now,rootThreadId);
        const at=finishedAt??checkpoint??now;
        const basis=finishedAt!==null?'The same managed task is confirmed ended; timing uses its saved end observation.'
            :checkpoint!==null?'The original environment has exited. Downtime is estimated from the last verified work checkpoint; the actual task end is unknown.'
                :'Legacy records lack a recent work checkpoint. Work is conservatively estimated up to the first confirmed exit observation; earlier downtime and the actual task end were not observed.';
        observeWork(measurement,{workState:{state:'unavailable',at,estimated:true,basis}},now);
    }
    if(finishedAt!==null)measurement.finishedAt=finishedAt;
}
/** @param {ReviewerMeasurement} measurement @param {number} now */
function observeWorkClock(measurement, now) {
    if (measurement.finishedAt !== null) return;
    const work=measurement.work??=createWorkMeasurement();
    const previous=workObservations.get(work);
    const current=readNativeWorkClock();
    workObservations.set(work,{clock:current,workingAt:previous?.workingAt??null});
    if (previous===undefined||previous.clock===null&&current!==null) {
        work.estimated=true;
        workBasis(work,'The clock baseline in this process was rebuilt at the current observation. Accumulated exclusions are retained; unsampled intervals have no precise sleep boundaries.');
    }
    if (!current) {
        workBasis(work,'This Node platform lacks a verifiable suspend clock difference, or clock sampling is unavailable. Silence and connection state do not imply sleep.');
        return;
    }
    const interval=estimateNativeSleepInterval(previous?.clock??null,current);
    if (interval) observeWork(measurement,{nonWork:[interval]},now);
}
/**
 * 原生生命周期按源时间顺序交接. 只保存已合并时长, 最后边界与未闭合观察, 不保存区间历史.
 * @param {WorkMeasurement} work @param {number} start @param {number} end
 */
function accountNonWork(work, start, end) {
    if (end <= start) return;
    if (work.lastStart === null || work.lastEnd === null || start > work.lastEnd) {
        work.excludedMs += end - start;
        work.previousEnd = work.lastEnd;
        work.lastStart = start;
        work.lastEnd = end;
        return;
    }
    if (end < work.lastStart) return;
    const leading = Math.max(start, work.previousEnd ?? start);
    work.excludedMs += Math.max(0, work.lastStart - leading) + Math.max(0, end - work.lastEnd);
    work.lastStart = Math.min(work.lastStart, leading);
    work.lastEnd = Math.max(work.lastEnd, end);
    if (work.previousEnd !== null && start < work.previousEnd) {
        work.estimated = true;
        workBasis(work, 'An earlier exclusion crosses previously accumulated intervals. Saved totals and the latest merged boundary provide an estimate without counting exclusions twice.');
    }
}
/** @param {ReviewerMeasurement} measurement @param {NativeMeasurementFacts} facts @param {number} now */
function observeWork(measurement, facts, now) {
    if(measurement.finishedAt!==null)return;
    now = Math.min(now, measurement.finishedAt ?? now);
    const work = measurement.work ??= createWorkMeasurement();
    if (facts.workCoverage) {
        work.coverage = facts.workCoverage.complete;
        if (!facts.workCoverage.complete) workBasis(work, facts.workCoverage.basis);
    }
    const state = facts.workState;
    if (state && Number.isFinite(state.at)) {
        const at = Math.max(measurement.startedAt, Math.min(now,state.at));
        if (state.state === 'working') {
            const last=workingCheckpoint(measurement,at);
            if (work.openStart !== null) accountNonWork(work, work.openStart, at);
            else if(last!==null&&at>last) {
                accountNonWork(work,last,at);work.estimated=true;
                workBasis(work,'The verified original root resumed after the last verified work observation. Saved observations and native resume time estimate the interruption; the actual exit boundary was not fully observed.');
            } else if(last===null&&at>measurement.startedAt) {
                work.estimated=true;
                workBasis(work,'Legacy records lack a verified last work boundary. Resume time alone cannot classify earlier wall time as downtime; known exclusions and coverage limits are retained.');
            }
            work.openStart = null;
            rememberWorking(work,at);
            work.lastWorkingAt=Math.max(work.lastWorkingAt??at,at);
        } else work.openStart = Math.min(work.openStart ?? at, at);
        if (state.estimated) {work.estimated = true; workBasis(work, state.basis ?? 'Paused or resumed work boundaries are estimated from native state observations.');}
    }
    for (const interval of [...(facts.nonWork ?? [])].sort((left, right) => left.startedAt - right.startedAt)) {
        if (!Number.isFinite(interval.startedAt)) continue;
        const start = Math.max(measurement.startedAt, interval.startedAt);
        if (interval.finishedAt === null) work.openStart = Math.min(work.openStart ?? start, start);
        else if (Number.isFinite(interval.finishedAt)) accountNonWork(work, start, Math.min(now, interval.finishedAt));
        if (interval.estimated) {work.estimated = true; workBasis(work, interval.basis ?? 'Downtime or sleep boundaries are estimated from lifecycle observations.');}
    }
}
/** @param {ReviewerMeasurement} measurement @param {number} now */
function workResult(measurement, now) {
    const saved = measurement.work ?? createWorkMeasurement();
    const work = {...saved,basis:[...saved.basis]};
    const end = measurement.finishedAt ?? now;
    const wall = Math.max(0, end - measurement.startedAt);
    if (work.openStart !== null) accountNonWork(work,Math.max(measurement.startedAt,work.openStart),end);
    const estimated = work.estimated || !work.coverage;
    const basis = [...work.basis];
    if (!work.coverage) basis.push('Estimated from the original task start, the current or final end, and observed lifecycle facts. Unobserved downtime, sleep, and WSL host suspension remain uncertain. Normal tool execution and intentional waits count as work.');
    return {durationMs: Math.max(0, wall - work.excludedMs), estimated, basis: estimated ? basis.join(' ') : null};
}

/** @param {unknown} value @returns {value is number} */
const knownNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
/** @param {number|null|undefined} left @param {number|null|undefined} right */
function positiveDifference(left, right) {return knownNumber(left) && knownNumber(right) && left > right ? left - right : null;}
/** @param {NativeResponseMeasurement} response @returns {number|null} */
function newInput(response) {
    return knownNumber(response.inputTokens) && knownNumber(response.cachedInputTokens) && response.inputTokens >= response.cachedInputTokens
        ? response.inputTokens - response.cachedInputTokens : null;
}
/** @param {number|null|undefined} tokens @param {number|null|undefined} durationMs @param {PhaseSource} source @param {boolean} estimated @param {string|null} basis @returns {PhaseGroup|null} */
function phase(tokens, durationMs, source, estimated, basis) {
    return knownNumber(tokens) && knownNumber(durationMs) && durationMs > 0
        ? {tokens, durationMs, source, estimated, basis, measuredRequests: 1} : null;
}
/** @param {NativeResponseMeasurement} response @returns {{input:PhaseGroup|null,output:PhaseGroup|null}} */
function responsePhases(response) {
    const tokens = newInput(response);
    const basis = response.basis ?? 'Estimated from request and visible generation timestamps for the same response, including network, queueing, and hidden reasoning visibility bias.';
    const first = response.firstGeneratedAt;
    const last = response.lastGeneratedAt ?? response.completedAt;
    const input = phase(tokens, positiveDifference(first, response.startedAt), 'existing-events', true, basis);
    const firstTokens = knownNumber(response.firstChunkTokens) ? response.firstChunkTokens : 1;
    const tail = response.lastGeneratedAt == null ? ' The completion event replaces the last content event, so elapsed time includes trailing overhead.' : '';
    const output = knownNumber(response.outputTokens) ? phase(Math.max(0, response.outputTokens-firstTokens),
        positiveDifference(last, first), 'existing-events', true,
        `${basis}${knownNumber(response.firstChunkTokens) ? ' The known first chunk token count is excluded.' : ' First chunk token count is unknown; one token per request is excluded as an approximation.'}${tail}`) : null;
    return {input, output: output && output.tokens > 0 ? output : null};
}
/** @param {ReviewerMeasurement} measurement @param {NativeMeasurementFacts} facts @param {string} rootThreadId */
function observePhases(measurement, facts, rootThreadId) {
    const phases = measurement.phases ??= {fresh: false, baselineResponses: [], recordFloor: null, responses: {}, complete: false};
    if (facts.requestsComplete !== undefined) phases.complete = facts.requestsComplete;
    for (const response of facts.responses ?? []) {
        if (response.threadId !== rootThreadId || !response.responseId || phases.baselineResponses.includes(response.responseId)) continue;
        if (knownNumber(response.startedAt) && (response.startedAt < measurement.startedAt
            || measurement.finishedAt !== null && response.startedAt > measurement.finishedAt)) continue;
        if (!phases.fresh && !Object.hasOwn(phases.responses, response.responseId)
            && !(knownNumber(response.startedAt) && response.startedAt >= measurement.startedAt)
            && !(knownNumber(response.recordSequence) && phases.recordFloor !== null && response.recordSequence > phases.recordFloor)) {
            phases.complete = false;
            continue;
        }
        phases.responses[response.responseId] = mergeNativeResponseMeasurement(phases.responses[response.responseId], response);
    }
}
/** @param {PhaseGroup[]} samples @returns {PhaseGroup[]} */
function aggregateReviewerPhaseGroups(samples) {
    /** @type {Map<PhaseSource,PhaseGroup>} */
    const groups = new Map();
    for (const sample of samples) {
        const group = groups.get(sample.source);
        if (!group) {groups.set(sample.source, {...sample}); continue;}
        group.tokens += sample.tokens;
        group.durationMs += sample.durationMs;
        group.measuredRequests += sample.measuredRequests;
        group.estimated ||= sample.estimated;
        if (sample.basis && !group.basis?.includes(sample.basis)) group.basis = [group.basis, sample.basis].filter(Boolean).join(' ');
    }
    return [...groups.values()].sort((left, right) => left.source.localeCompare(right.source));
}
/** @param {ReviewerMeasurement} measurement */
function modelPhaseResult(measurement) {
    const responses = Object.values(measurement.phases?.responses ?? {});
    const samples = responses.map(responsePhases);
    return {
        totalRequests: measurement.phases?.complete ? responses.length : null,
        input: aggregateReviewerPhaseGroups(samples.flatMap(sample => sample.input ? [sample.input] : [])),
        output: aggregateReviewerPhaseGroups(samples.flatMap(sample => sample.output ? [sample.output] : [])),
    };
}

/** @param {ReviewerMeasurement} measurement @param {number} now @param {boolean} complete */
export const reviewerMeasurementResult = (measurement, now, complete = true) => {
    observeWorkClock(measurement,now);
    const usage = createUsage(0);
    const members = Object.entries(measurement.threads)
        .filter(([, thread]) => thread.participated)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([threadId, thread]) => {
            const delta = createUsage(null);
            for (const field of REVIEWER_USAGE_FIELDS) {
                const baseline = thread.baseline[field];
                const current = thread.current[field];
                delta[field] = baseline !== null && current !== null && current >= baseline
                    ? current - baseline : null;
                const aggregate = usage[field];
                usage[field] = aggregate === null || delta[field] === null
                    ? null : aggregate + delta[field];
            }
            return {threadId, usage: delta};
        });
    if (!complete || members.length === 0) {
        for (const field of REVIEWER_USAGE_FIELDS) usage[field] = null;
    }
    return {
        startedAt: measurement.startedAt,
        finishedAt: measurement.finishedAt,
        wallClockMs: Math.max(0, (measurement.finishedAt ?? now) - measurement.startedAt),
        workDuration: workResult(measurement, now),
        modelPhases: modelPhaseResult(measurement),
        usage,
        members,
    };
};
