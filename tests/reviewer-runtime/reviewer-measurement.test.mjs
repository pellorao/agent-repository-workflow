import assert from 'node:assert/strict';
import test from 'node:test';
import {cloneJsonValue} from '../../lib/common/json.mjs';
import {estimateNativeSleepInterval, mergeNativeResponseMeasurement} from '../../lib/background-agent/native-measurement.mjs';
import {
    checkpointReviewerMeasurement,createReviewerMeasurement, createUsage, observeReviewerMeasurement, reviewerMeasurementResult,
} from '../../lib/reviewer-runtime/reviewer-measurement.mjs';

/** @typedef {import('../../lib/background-agent/codex-app-server.mjs').NativeMember} NativeMember */
/** @param {string} threadId @param {number | null} value @returns {NativeMember} */
const member = (threadId, value) => ({
    threadId, parentThreadId: threadId === 'root' ? null : 'root', hasConversationHistory: true, state: 'idle', turnId: 'turn',
    sessionPath: `/native/${threadId}.jsonl`, modelProvider: 'provider', contexts: [],
    usage: createUsage(value), finalResponse: null,
});

test('Reviewer measurement deduplicates the original Thread.id across recovery and ignores historical Agent usage', () => {
    const root = member('root', 100);
    const historical = member('historical', 50);
    const measurement = createReviewerMeasurement({startedAt: 1_000, members: [root, historical], rootThreadId: 'root'});
    root.usage = {...createUsage(130), cachedInputTokens: 110, reasoningOutputTokens: 120};
    historical.usage = createUsage(10_000);
    const observation = {members: [root, historical], rootThreadId: 'root'};
    observeReviewerMeasurement(measurement, observation);
    observeReviewerMeasurement(measurement, observation);
    assert.equal(reviewerMeasurementResult(measurement, 1_500).usage.totalTokens, 30);
    assert.equal(reviewerMeasurementResult(measurement, 1_500).usage.cachedInputTokens, 10);
    const resumed = /** @type {typeof measurement} */ (cloneJsonValue(measurement));
    root.usage.inputTokens = 140;
    observeReviewerMeasurement(resumed, observation);
    resumed.finishedAt = 2_000;
    const result = reviewerMeasurementResult(resumed, 9_000);
    assert.equal(result.usage.inputTokens, 40);
    assert.equal(result.wallClockMs, 1_000);
    assert.deepEqual(result.members.map(entry => entry.threadId), ['root']);
});

test('Fresh Reviewer measurement uses the first actual cumulative usage and retains unknown telemetry', () => {
    const root = member('root', null);
    const historical = member('historical', 100);
    const measurement = createReviewerMeasurement({startedAt: 1_000, members: [root, historical], rootThreadId: 'root', freshRoot: 'root'});
    assert.equal(reviewerMeasurementResult(measurement, 1_000).usage.totalTokens, null);
    root.usage = createUsage(20);
    observeReviewerMeasurement(measurement, {members: [root, historical], rootThreadId: 'root'});
    assert.equal(reviewerMeasurementResult(measurement, 1_200).usage.totalTokens, 20);
    assert.equal(Object.hasOwn(reviewerMeasurementResult(measurement, 1_200).usage, 'costUsd'), false);
    observeReviewerMeasurement(measurement, {members: [historical], rootThreadId: 'root'});
    assert.equal(reviewerMeasurementResult(measurement, 1_300, false).usage.totalTokens, null);
    observeReviewerMeasurement(measurement, {members: [root, historical], rootThreadId: 'root'});
    assert.equal(reviewerMeasurementResult(measurement, 1_400).usage.totalTokens, 20);
    const unknownBaseline = createReviewerMeasurement({startedAt: 1_000, members: [member('root', null)], rootThreadId: 'root'});
    observeReviewerMeasurement(unknownBaseline, {members: [root], rootThreadId: 'root'});
    assert.equal(reviewerMeasurementResult(unknownBaseline, 1_400).usage.totalTokens, null);
});

test('Existing response samples produce paired estimates and retain working tool waits across overlapping downtime and recovery', () => {
    /** @type {Map<string,import('../../lib/background-agent/native-measurement.mjs').NativeResponseMeasurement>} */
    const responses = new Map();
    /** @param {import('../../lib/background-agent/native-measurement.mjs').NativeResponseMeasurement[]} observations */
    const consume = observations => {
        for (const observation of observations) {
            const key = JSON.stringify([observation.threadId,observation.responseId]);
            responses.set(key,mergeNativeResponseMeasurement(responses.get(key),observation));
        }
    };
    consume([{threadId:'root',responseId:'old',startedAt:100,completedAt:500,inputTokens:1000,cachedInputTokens:100,outputTokens:500}]);
    const root = member('root', 0);
    root.usage = {...createUsage(0),inputTokens:1000,cachedInputTokens:100,outputTokens:500,reasoningOutputTokens:100,totalTokens:1500};
    const measurement = createReviewerMeasurement({startedAt:1000,members:[root],rootThreadId:'root',measurementFacts:{responses:[...responses.values()]}});
    const first = [
        {threadId:'root',responseId:'a',startedAt:1000,firstGeneratedAt:1100,lastGeneratedAt:1100,firstChunkTokens:1},
        {threadId:'root',responseId:'a',firstGeneratedAt:1500,lastGeneratedAt:1500},
        {threadId:'root',responseId:'a',completedAt:1550,inputTokens:100,cachedInputTokens:20,outputTokens:21},
        {threadId:'other',responseId:'a',startedAt:1000,firstGeneratedAt:1100,lastGeneratedAt:1300,inputTokens:100000,cachedInputTokens:0,outputTokens:100000},
    ];
    consume(first);
    root.usage = {...createUsage(0),inputTokens:1100,cachedInputTokens:120,outputTokens:521,reasoningOutputTokens:120,totalTokens:1621};
    observeReviewerMeasurement(measurement,{members:[root],rootThreadId:'root',now:3000,measurementFacts:{
        responses:[...responses.values()],workState:{state:'unavailable',at:3000,estimated:true,basis:'原生退出生命周期的客户端观察.'},
    }});
    const sleep = estimateNativeSleepInterval(
        {at:4000,lowerSleepOffsetMs:1000,upperSleepOffsetMs:1000},
        {at:6000,lowerSleepOffsetMs:3000,upperSleepOffsetMs:3000});
    assert.ok(sleep);
    observeReviewerMeasurement(measurement,{members:[root],rootThreadId:'root',now:6000,measurementFacts:{nonWork:[sleep]}});
    assert.equal(reviewerMeasurementResult(measurement,6000).workDuration.durationMs,2000);
    const second = [
        {threadId:'root',responseId:'b',startedAt:5500,firstGeneratedAt:5700,lastGeneratedAt:5700},
        {threadId:'root',responseId:'b',firstGeneratedAt:6700,lastGeneratedAt:6700},
        {threadId:'root',responseId:'b',completedAt:6750,inputTokens:200,cachedInputTokens:50,outputTokens:41},
    ];
    consume(second);consume([...first,...second]);
    root.usage = {...createUsage(0),inputTokens:1300,cachedInputTokens:170,outputTokens:562,reasoningOutputTokens:140,totalTokens:1862};
    const facts = {responses:[...responses.values()],requestsComplete:true,workCoverage:{complete:true},nonWork:[sleep],
        workState:{state:/** @type {const} */('working'),at:5000,estimated:true,basis:'同一原根恢复工作生命周期的客户端观察.'}};
    observeReviewerMeasurement(measurement,{members:[root],rootThreadId:'root',measurementFacts:facts,now:7000,verifiedWorkingAt:7000});
    checkpointReviewerMeasurement(measurement);
    const recovered = /** @type {typeof measurement} */(cloneJsonValue(measurement));
    observeReviewerMeasurement(recovered,{members:[root],rootThreadId:'root',measurementFacts:facts,now:8000});
    assert.equal(reviewerMeasurementResult(recovered,8000).workDuration.durationMs,4000);
    const restored={...facts,workState:{...facts.workState,at:9000,basis:'准确原根恢复工作, 先前退出边界未完整观测.'}};
    observeReviewerMeasurement(recovered,{members:[root,member('other',100000)],rootThreadId:'root',measurementFacts:restored,now:11000,verifiedWorkingAt:11000});
    observeReviewerMeasurement(recovered,{members:[root],rootThreadId:'root',measurementFacts:restored,now:11000});
    recovered.finishedAt = 11000;
    const result = reviewerMeasurementResult(recovered,50000);
    assert.equal(result.wallClockMs,10000);
    assert.equal(result.workDuration.durationMs,5000);
    assert.equal(result.workDuration.estimated,true);
    assert.match(result.workDuration.basis??'',/生命周期/);
    assert.equal(reviewerMeasurementResult(recovered,90000).workDuration.durationMs,5000);
    assert.equal(result.startedAt,1000);
    assert.equal(result.usage.outputTokens,62);
    assert.equal(result.usage.reasoningOutputTokens,40);
    assert.equal(result.modelPhases.totalRequests,2);
    assert.equal(result.modelPhases.input[0].tokens,230);
    assert.equal(result.modelPhases.input[0].durationMs,300);
    assert.equal(result.modelPhases.output[0].tokens,60);
    assert.equal(result.modelPhases.output[0].durationMs,1400);
    for(const group of [...result.modelPhases.input,...result.modelPhases.output]) {
        assert.equal(group.measuredRequests,2);assert.equal(group.source,'existing-events');
        assert.equal(group.estimated,true);assert.ok(group.basis);
    }
    assert.match(result.modelPhases.output[0].basis??'',/First chunk token count is unknown/);
});
