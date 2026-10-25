import {BENCHMARK_REVIEWERS, BENCHMARK_SCENARIOS} from './benchmark-contract.mjs';

/** @typedef {import('../reviewer-runtime/reviewer-measurement.mjs').PhaseGroup} PhaseGroup */
/** @typedef {{durationMs:number|null,estimated:boolean|null,basis:string|null}} WorkDuration */
/** @typedef {{totalRequests:number|null,input:PhaseGroup[],output:PhaseGroup[]}} ModelPhases */
/** @typedef {{input:number,cachedInput:number,output:number}} TokenUsage */
/** @typedef {{actualModel:string,actualReasoningEffort:string,durationMs:number|null,tokenUsage:TokenUsage|null,tokenUsageError?:string,conditions:Record<string,string|number|boolean>,workDuration?:WorkDuration,modelPhases?:ModelPhases}} Runtime */
/** @typedef {{reviewerId:string,scenarioId:string,repetition:number,sampleKind?:string,runtime:Runtime,delivery:{mode:string,errors:Array<{category:string,actor:string}>,mainAgentCorrectedScoringCopy:boolean},completed:boolean,error?:{code?:string,message?:string}}} Observation */
/** @typedef {{repetition:number,score:number|null,scoreSource:string,diagnosticReason:string|null,mainAgentCorrectedScoringCopy:boolean,completedInstances:number,expectedInstances:number,deliveryErrors:string[]}} Repetition */
/** @typedef {{reviewerId:string,repetitions:Repetition[]}} RoleStatistics */
/** @typedef {{schemaVersion:number,configuration:{model:string,reasoningEffort:string},observations:Observation[],roles:RoleStatistics[]}} Statistics */
/** @typedef {{status:string,results?:Array<{reviewerId:string,score?:number,finalRepetitionScores?:number[],repetitions?:Record<string,unknown>[]}>,diagnostics?:unknown[]}} Verification */
export const tokenKeys = /** @type {const} */ (['input', 'cachedInput', 'output']);
const phaseSources = ['native-prompt', 'native-ttft', 'native-generation', 'native-tbt', 'client-request', 'existing-events'];
const conditionKeys = ['apiModel', 'availablePhysicalBytesAtEnd', 'availablePhysicalBytesAtStart', 'backend',
    'contextWindowTokens', 'forwardedReasoningEffort', 'forwardedRequestCount', 'hostMemoryGb', 'kvCache',
    'operatingSystem', 'reasoningCapContinuationCount', 'rejectedToolOutputCount', 'serverPid', 'serviceTier',
    'thinkingEnabled', 'timeLimitMs', 'timeoutSeconds'];
const scenariosFor = (/** @type {string} */ reviewerId) => BENCHMARK_SCENARIOS.filter(item => item.reviewerId === reviewerId);
const fail = (/** @type {string} */ message) => {throw new TypeError(message);};
const finite = (/** @type {unknown} */ value) => typeof value === 'number' && Number.isFinite(value);
const count = (/** @type {unknown} */ value) => Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0;
const named = (/** @type {unknown} */ value) => typeof value === 'string' && value.trim().length > 0;
const conciseText = (/** @type {string} */ value) => value.replace(/\b[0-9a-f]{64}\b/giu, '[hash]')
    .replace(/(["'`])(?:[a-z]:[\\/]|\/|\\\\|~\/|\.{1,2}\/)[^"'`\r\n]*\1/giu, '[path]')
    .replace(/(^|[\s([{=:"'`])(?:file:\/\/|[a-z]:[\\/]|\/|\\\\|~\/|\.{1,2}\/)[^\s)\]};,"'`]+/giu, '$1[path]');

/** Project only optional v4 measurement facts, without filling legacy gaps. @param {{workDuration?:WorkDuration,modelPhases?:ModelPhases}} runtime */
export const projectRuntimeMeasurement = runtime => {
    /** @type {{workDuration?:WorkDuration,modelPhases?:ModelPhases}} */
    const result = {};
    if (runtime.workDuration !== undefined) {
        const work = runtime.workDuration;
        if (work === null || (work.durationMs !== null && (!finite(work.durationMs) || work.durationMs < 0))
            || (work.durationMs === null ? work.estimated !== null : typeof work.estimated !== 'boolean')
            || (work.basis !== null && !named(work.basis)) || work.estimated === true && !named(work.basis)) {
            fail('Work duration needs a known time or explicit unknown, with its estimate basis.');
        }
        result.workDuration = {durationMs:work.durationMs,estimated:work.estimated,
            basis:work.basis === null ? null : conciseText(work.basis)};
    }
    if (runtime.modelPhases !== undefined) {
        const phases = runtime.modelPhases;
        if (phases === null || phases.totalRequests !== null && !count(phases.totalRequests)
            || !Array.isArray(phases.input) || !Array.isArray(phases.output)) fail('Model phase coverage is invalid.');
        const project = (/** @type {PhaseGroup[]} */ groups) => {
            if (new Set(groups.map(group => group.source)).size !== groups.length) fail('Model phase sources are duplicated.');
            const projected = groups.map(group => {
                if (!count(group.tokens) || !finite(group.durationMs) || group.durationMs <= 0
                    || !phaseSources.includes(group.source) || typeof group.estimated !== 'boolean'
                    || !count(group.measuredRequests) || group.measuredRequests === 0
                    || (group.basis !== null && !named(group.basis)) || group.estimated && !named(group.basis)
                    || ['native-ttft','native-tbt','client-request','existing-events'].includes(group.source) && !group.estimated) {
                    fail('Model phase tokens and positive time must be paired with their source and coverage.');
                }
                return {tokens:group.tokens,durationMs:group.durationMs,source:group.source,
                    estimated:group.estimated,basis:group.basis === null ? null : conciseText(group.basis),
                    measuredRequests:group.measuredRequests};
            });
            if (phases.totalRequests !== null && projected.reduce((sum, group) => sum + group.measuredRequests, 0) > phases.totalRequests) {
                fail('Model phase coverage exceeds observed requests.');
            }
            return projected;
        };
        result.modelPhases = {totalRequests:phases.totalRequests,input:project(phases.input),output:project(phases.output)};
    }
    return result;
};

/** @param {Observation} item @returns {Observation} */
const projectObservation = item => {
    const {reviewerId,scenarioId,repetition,runtime,delivery} = item;
    if (!scenariosFor(reviewerId).some(scene => scene.scenarioId === scenarioId) || ![1,2,3].includes(repetition)
        || item.sampleKind !== 'formal' || !runtime || !named(runtime.actualModel) || !named(runtime.actualReasoningEffort)
        || runtime.durationMs !== null && (!finite(runtime.durationMs) || runtime.durationMs < 0)
        || !delivery || !named(delivery.mode) || !Array.isArray(delivery.errors) || typeof item.completed !== 'boolean') {
        fail('A formal observation has invalid identity or runtime facts.');
    }
    const usage = runtime.tokenUsage;
    if (usage !== null && (!usage || tokenKeys.some(key => !count(usage[key])))) fail('Token usage needs three nonnegative integer categories.');
    const conditions = Object.fromEntries(conditionKeys.flatMap(key => {
        const value = runtime.conditions?.[key];
        return typeof value === 'boolean' || finite(value) || named(value) && String(value).length <= 120 && !/[\\/\r\n]/u.test(String(value))
            ? [[key,value]] : [];
    }));
    return {reviewerId,scenarioId,repetition,runtime:{actualModel:runtime.actualModel,
        actualReasoningEffort:runtime.actualReasoningEffort,durationMs:runtime.durationMs,
        tokenUsage:usage === null ? null : {input:usage.input,cachedInput:usage.cachedInput,output:usage.output},
        ...(usage === null || named(runtime.tokenUsageError) ? {tokenUsageError:conciseText(runtime.tokenUsageError ?? 'token-usage-missing')} : {}),
        conditions,...projectRuntimeMeasurement(runtime)},
    delivery:{mode:delivery.mode,errors:delivery.errors.map(error => {
        if (!named(error.category) || !named(error.actor)) fail('A delivery error fact is invalid.');
        return {category:conciseText(error.category),actor:conciseText(error.actor)};
    }),mainAgentCorrectedScoringCopy:delivery.mainAgentCorrectedScoringCopy === true},completed:item.completed,
    ...(item.error === undefined ? {} : {error:{...(item.error.code === undefined ? {} : {code:conciseText(item.error.code)}),
        ...(item.error.message === undefined ? {} : {message:conciseText(item.error.message)})}})};
};

/** Reject different provider/tier conditions rather than guessing historical defaults. @param {Observation[]} observations */
export const assertMatchingConditions = observations => {
    const conditions = new Set(observations.map(item => JSON.stringify([
        item.runtime?.conditions?.backend ?? null,item.runtime?.conditions?.serviceTier ?? null])));
    if (conditions.size > 1) fail('Statistics provider or service tier conditions differ.');
};

/** @param {{configuration:{model:string,reasoningEffort:string},observations:Observation[],verification:Record<string,Verification>,allowPartial?:boolean}} input @returns {Statistics} */
export const aggregateConfiguration = ({configuration,observations,verification,allowPartial = false}) => {
    if (!named(configuration?.model) || !named(configuration?.reasoningEffort) || !Array.isArray(observations) || !verification) {
        fail('A configuration needs observations and current Conformance results.');
    }
    const reviewerIds = BENCHMARK_REVIEWERS.filter(id => Object.hasOwn(verification,id));
    if (!reviewerIds.length || Object.keys(verification).length !== reviewerIds.length
        || !allowPartial && reviewerIds.length !== BENCHMARK_REVIEWERS.length) fail('A configuration needs complete observations for every selected role.');
    const projected = observations.map(projectObservation);
    const expected = reviewerIds.reduce((sum,id) => sum + scenariosFor(id).length * 3,0);
    if (projected.length !== expected || new Set(projected.map(item => `${item.reviewerId}/${item.scenarioId}/${item.repetition}`)).size !== expected
        || projected.some(item => !reviewerIds.includes(item.reviewerId) || item.runtime.actualModel !== configuration.model
            || item.runtime.actualReasoningEffort !== configuration.reasoningEffort)) fail('Configuration observations are duplicated or use another setting.');
    assertMatchingConditions(projected);
    const roles = reviewerIds.map(reviewerId => {
        const source = verification[reviewerId];
        if (!['verified','failed'].includes(source?.status)) fail('Only a completed current Conformance result can enter statistics.');
        const result = source.results?.find(item => item.reviewerId === reviewerId);
        const scores = finite(result?.score) ? result?.finalRepetitionScores : undefined;
        if (scores !== undefined && (scores.length !== 3 || scores.some(score => !finite(score) || score < 0 || score > 1))) {
            fail('Final Conformance repetition scores are invalid.');
        }
        return {reviewerId,repetitions:[1,2,3].map(repetition => {
            const paired = projected.filter(item => item.reviewerId === reviewerId && item.repetition === repetition);
            const originalDiagnostics = result?.repetitions?.find(item => item.repetition === repetition)?.reportDiagnostics;
            const diagnosticCode = Array.isArray(originalDiagnostics) && typeof originalDiagnostics[0]?.code === 'string' ? originalDiagnostics[0].code : null;
            const corrected = paired.some(item => item.delivery.mainAgentCorrectedScoringCopy);
            const score = scores?.[repetition - 1] ?? null;
            const diagnosticReason = score === null ? null : corrected ? 'report-format-correction' : diagnosticCode;
            return {repetition,score,scoreSource:score === null ? 'unavailable' : diagnosticReason === null ? 'formal' : 'diagnostic',
                diagnosticReason,mainAgentCorrectedScoringCopy:corrected,
                completedInstances:paired.filter(item => item.completed).length,expectedInstances:paired.length,
                deliveryErrors:[...new Set(paired.flatMap(item => [...item.delivery.errors.map(error => error.category),
                    ...(item.error?.code === undefined ? [] : [item.error.code])]))]};
        })};
    });
    return {schemaVersion:4,configuration:{model:configuration.model,reasoningEffort:configuration.reasoningEffort},observations:projected,roles};
};
