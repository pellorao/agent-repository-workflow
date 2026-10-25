import {initialStrataWorkState,createStrataTaskSupport} from '../../lib/background-agent/strata-work-policy.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {link, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {dirname, join, relative} from 'node:path';
import {backgroundAgentRecoveryPath} from '../../lib/background-agent/recovery-record.mjs';
import {createBackgroundAgentManager,createManagedNativeSessions} from '../../lib/background-agent/manager.mjs';
import {createBackgroundAgentStateStore} from '../../lib/background-agent/state-store.mjs';
import {createReviewerRuntime} from '../../lib/reviewer-runtime/reviewer-runtime.mjs';
import {createUsage} from '../../lib/reviewer-runtime/reviewer-measurement.mjs';
import {readReviewerSessionRecord, saveReviewerSessionRecord} from '../../lib/reviewer-runtime/reviewer-session-record.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {createReviewerRuntimeFixture, createReviewerTestClock, createScriptedReviewerSessions, reviewerHandoff} from '../helpers/reviewer-runtime-adapter.mjs';

/** @typedef {import('../../lib/reviewer-runtime/reviewer-runtime.mjs').ReviewerRuntimeResult} ReviewerRuntimeResult */
/** @param {ReviewerRuntimeResult} response */
const succeeded = response => {
    assert.equal(response.status, 'succeeded', response.status === 'failed' ? response.error.message : '');
    if (response.status !== 'succeeded') throw new Error('Expected successful Reviewer operation.');
    return response.result;
};
/** @param {ReviewerRuntimeResult} response @param {string} code */
const failed = (response, code) => {
    assert.equal(response.status, 'failed');
    if (response.status === 'failed') assert.equal(response.error.code, code);
};
const options = (/** @type {ReturnType<typeof createReviewerRuntimeFixture>} */ fixture) => ({
    nativeSessions: fixture.native.nativeSessions, filesystem: fixture.filesystem,
    clock: fixture.clock, recoveryBoundary: fixture.recoveryBoundary,
});
/** @param {ReturnType<typeof createReviewerRuntimeFixture>} fixture @param {{runId:string,recoveryPath:string}} observed @param {import('../../lib/background-agent/state-store.mjs').AgentState} state */
const managedBinding = async (fixture, observed, state) => {
    const opened = await fixture.filesystem.open({root: reviewerHandoff.cwd});
    assert.equal(opened.status, 'succeeded');
    if (opened.status !== 'succeeded') throw new Error('Scripted repository unavailable.');
    const path = relative(reviewerHandoff.cwd, observed.recoveryPath).split('\\').join('/');
    const record = await readReviewerSessionRecord(opened.scopedFilesystem, observed.recoveryPath, path);
    assert.ok(record);
    return /** @type {import('../../lib/background-agent/state-store.mjs').BackgroundAgentRow} */ (/** @type {unknown} */ ({
        runId: observed.runId, role: record.role, threadId: record.threadId, sessionPath: record.sessionPath,
        recoveryPath: backgroundAgentRecoveryPath({stateDirectory: reviewerHandoff.stateDirectory,runId: observed.runId}),
        cwd: record.cwd, readPaths: record.readPaths, writePaths: record.writePaths, settings: record.settings, state,
    }));
};
const start = async (/** @type {ReturnType<typeof createReviewerRuntimeFixture>} */ fixture, /** @type {typeof reviewerHandoff} */ handoff = reviewerHandoff) => {
    const runtime = createReviewerRuntime(options(fixture));
    const accepted = succeeded(await runtime.execute({operation: 'spawn_agent', input: handoff}));
    assert.equal(accepted.deliveryStatus, 'accepted');
    assert.equal(typeof accepted.messageId, 'string');
    assert.equal(accepted.threadId, null);
    const observed = succeeded(await runtime.inspect({runId: accepted.runId}));
    assert.equal(typeof observed.threadId, 'string');
    assert.equal(typeof observed.turnId, 'string');
    return {runtime, accepted, observed};
};

test('spawn accepts once before native work, then verifies a bound report and root-only usage', async () => {
    const fixture = createReviewerRuntimeFixture();
    const runtime = createReviewerRuntime(options(fixture));
    failed(await runtime.execute({operation: 'spawn_agent', input: {...reviewerHandoff, settings: {...reviewerHandoff.settings, serviceTier: null}}}), 'invalid-input');
    assert.equal(fixture.native.sessions.length, 0);
    const accepted = succeeded(await runtime.execute({operation: 'spawn_agent', input: reviewerHandoff}));
    assert.equal(accepted.threadId, null);
    assert.equal(accepted.turnId, null);
    assert.equal(accepted.deliveryStatus, 'accepted');
    assert.equal(fixture.native.calls.some(call => call.operation === 'startTurn'), false);
    const observed = succeeded(await runtime.inspect({runId: accepted.runId}));
    assert.equal(fixture.native.calls.filter(call => call.operation === 'startTurn').length, 1);
    assert.equal(fixture.native.calls.filter(call => call.operation === 'dispatchAccepted').length, 1);
    assert.equal(observed.state, 'running');
    assert.equal(observed.completion, null);
    failed(await runtime.execute({operation: 'spawn_agent', input: {...reviewerHandoff, newThread: true}}), 'reviewer-busy');
    assert.equal(fixture.native.calls.filter(call => call.operation === 'start').length, 1);
    assert.equal(fixture.native.sessions[0].input.settings.config['agents.enabled'], false);
    const root = fixture.native.members.get(/** @type {string} */ (observed.threadId));
    assert.ok(root);
    root.usage = createUsage(17);
    fixture.clock.advance(120);
    await fixture.writeReport('The complete Reviewer-written report.');
    fixture.native.finish(root.threadId);
    const completed = succeeded(await runtime.inspect({runId: accepted.runId}));
    assert.deepEqual(completed.completion, {status: 'ready', reportPath: reviewerHandoff.reportPath});
    assert.equal(completed.measurement?.usage.totalTokens, 17);
    assert.equal(completed.measurement?.wallClockMs, 120);
    assert.equal(JSON.stringify(completed).includes('The complete Reviewer-written report.'), false);
    failed(await runtime.execute({operation: 'spawn_agent', input: reviewerHandoff}), 'reviewer-identity-exists');
    await runtime.close();
});

test('a provisional missing report stays live, then a native completion retires it without another inspection', async () => {
    const fixture = createReviewerRuntimeFixture();
    /** @type {(runId:string)=>void} */ let resolveRetired = () => {};
    const retired = new Promise(resolve => {resolveRetired = resolve;});
    /** @type {string[]} */ const retiredRuns = [];
    const runtime = createReviewerRuntime({...options(fixture), onRetired: runId => {retiredRuns.push(runId);resolveRetired(runId);}});
    const accepted = succeeded(await runtime.execute({operation: 'spawn_agent',input: reviewerHandoff}));
    const active = succeeded(await runtime.inspect({runId: accepted.runId}));
    const threadId = /** @type {string} */ (active.threadId);
    fixture.native.finish(threadId);
    assert.equal(succeeded(await runtime.inspect({runId: accepted.runId})).completion?.status, 'incomplete');
    assert.equal(runtime.holdsRun(accepted.runId), true);
    assert.deepEqual(retiredRuns, []);
    await fixture.writeReport('Personally written final report.');
    fixture.native.emit(threadId);
    await retired;
    assert.deepEqual(retiredRuns, [accepted.runId]);
    assert.equal(runtime.holdsRun(accepted.runId), false);
    assert.equal(fixture.native.sessions[0].attached, false);
    const managed = await managedBinding(fixture, active, 'running');
    const cold = succeeded(await runtime.inspect({runId: accepted.runId,managed}));
    assert.equal(cold.completion?.status, 'ready');
    const nextReport = join(dirname(reviewerHandoff.writePaths[0]), 'next-report', 'reports', 'report.md');
    await fixture.writeReport('', nextReport);
    const next = succeeded(await runtime.execute({operation: 'followup_task',input: {
        ...reviewerHandoff,runId: accepted.runId,reportPath: nextReport, writePaths: [dirname(nextReport)],handoff: 'Review another complete input.',
    }}));
    const resumed = succeeded(await runtime.inspect({runId: next.runId}));
    assert.equal(resumed.threadId, threadId);
    assert.equal(next.runId, accepted.runId);
    await runtime.close();
    {
    const continuingFixture=createReviewerRuntimeFixture();
    let work=initialStrataWorkState(false);let instructions=0;
    const nativeSessions={open:async(/** @type {Parameters<typeof continuingFixture.native.nativeSessions.open>[0]} */ input)=>{
        const session=await continuingFixture.native.nativeSessions.open(input);
        return Object.assign(session,{
            getProviderWork:()=>/** @type {Record<string,unknown>} */(/** @type {unknown} */(work)),
            saveProviderWork:/** @param {Record<string,unknown>} state */ state=>{work=/** @type {typeof work} */(/** @type {unknown} */(state));},
            createProviderWorkPolicy:/** @param {Parameters<NonNullable<typeof session.createProviderWorkPolicy>>[0]} callbacks */ callbacks=>
                createStrataTaskSupport({installationDirectory:'/unused'}).createPolicy({...callbacks,
                    readWorkState:()=>/** @type {Record<string,unknown>} */(/** @type {unknown} */(work)),
                    saveWorkState:state=>{work=/** @type {typeof work} */(/** @type {unknown} */(state));}}),
            configureReviewerTask:async()=>({enabled:true,settings:input.settings,compactBinding:null}),
            continueTask:async(/** @type {NonNullable<typeof session.continueTask> extends (input:infer T)=>unknown?T:never} */ request)=>{
                const root=continuingFixture.native.members.get(request.rootThreadId);assert.ok(root);assert.equal(root.turnId,request.endedTurnId);
                instructions++;request.onAccepted(`program-${instructions}`);
                const delivered=await session.startTurn({threadId:request.rootThreadId,handoff:request.instruction});
                return {turnId:/** @type {string} */(delivered.turnId),deliveryStatus:'delivered'};
            },
        });
    }};
    const continuing=createReviewerRuntime({...options(continuingFixture),nativeSessions});
    const receipt=succeeded(await continuing.execute({operation:'spawn_agent',input:reviewerHandoff}));
    const before=succeeded(await continuing.inspect({runId:receipt.runId}));
    const originalThread=/** @type {string} */(before.threadId);const root=continuingFixture.native.members.get(originalThread);assert.ok(root);
    root.usage=createUsage(20);continuingFixture.clock.advance(50);continuingFixture.native.finish(originalThread,'Progress only.');
    const resumed=succeeded(await continuing.inspect({runId:receipt.runId}));
    assert.equal(resumed.completion,null);assert.equal(resumed.threadId,originalThread);assert.equal(resumed.runId,receipt.runId);
    assert.notEqual(resumed.turnId,before.turnId);assert.equal(instructions,1);
    assert.equal(resumed.measurement?.usage.totalTokens,20);
    await continuing.execute({operation:'interrupt_agent',input:{runId:receipt.runId,turnId:resumed.turnId}});
    continuingFixture.native.emit(originalThread);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(instructions,1);assert.ok(work.stopReason);await continuing.close();
    }

});

test('a queued follow-up reattaches after a coalesced completion retires its captured handle', async () => {
    const fixture = createReviewerRuntimeFixture();
    let pauseSnapshot = false;
    /** @type {()=>void} */ let captured = () => {};
    /** @type {()=>void} */ let release = () => {};
    const entered = new Promise(resolve => {captured = () => resolve(undefined);});
    const gate = new Promise(resolve => {release = () => resolve(undefined);});
    const nativeSessions = {
        async open(/** @type {Parameters<typeof fixture.native.nativeSessions.open>[0]} */ input) {
            const session = await fixture.native.nativeSessions.open(input);
            return Object.assign(Object.create(session), {
                async snapshot(/** @type {Parameters<typeof session.snapshot>[0]} */ request) {
                    const facts = await session.snapshot(request);
                    if (pauseSnapshot) {pauseSnapshot = false;captured();await gate;}
                    return facts;
                },
            });
        },
    };
    const runtime = createReviewerRuntime({...options(fixture),nativeSessions});
    const first = succeeded(await runtime.execute({operation: 'spawn_agent',input: reviewerHandoff}));
    const active = succeeded(await runtime.inspect({runId: first.runId}));
    const threadId = /** @type {string} */ (active.threadId);
    await fixture.writeReport('First complete report.');
    const nextReport = join(dirname(reviewerHandoff.writePaths[0]), 'queued-followup', 'reports', 'report.md');
    await fixture.writeReport('', nextReport);
    pauseSnapshot = true;
    fixture.native.emit(threadId);
    await entered;
    const pending = runtime.execute({operation: 'followup_task',input: {
        ...reviewerHandoff,runId: first.runId,reportPath: nextReport, writePaths: [dirname(nextReport)],handoff: 'Review the next input.',
    }});
    await new Promise(resolve => setImmediate(resolve));
    fixture.native.finish(threadId);
    release();
    const accepted = succeeded(await pending);
    assert.equal(accepted.runId, first.runId);
    assert.equal(fixture.native.sessions.length, 2);
    const next = succeeded(await runtime.inspect({runId: first.runId}));
    assert.equal(next.threadId, threadId);
    assert.equal(next.state, 'running');
    assert.equal(fixture.native.sessions[0].attached, false);
    assert.equal(fixture.native.sessions[1].attached, true);
    await runtime.close();
});

test('a follow-up waits for the previous completed turn to finish terminal cleanup', async () => {
    const fixture = createReviewerRuntimeFixture();
    const {runtime, observed} = await start(fixture);
    const threadId = /** @type {string} */ (observed.threadId);
    /** @type {()=>void} */ let entered = () => {};
    /** @type {()=>void} */ let release = () => {};
    const cleanupEntered = new Promise(resolve => {entered = () => resolve(undefined);});
    const cleanupGate = new Promise(resolve => {release = () => resolve(undefined);});
    const root = fixture.native.members.get(threadId);
    assert.ok(root);
    const nativeRoot = /** @type {typeof root & {turnStatus?: 'inProgress' | 'completed'}} */ (root);
    nativeRoot.state = 'idle';
    nativeRoot.turnStatus = 'inProgress';
    fixture.native.backgroundTerminals.set(threadId, new Set(['old-turn-terminal']));
    assert.equal(succeeded(await runtime.inspect({runId: observed.runId})).state, 'running');
    assert.deepEqual([...fixture.native.backgroundTerminals.get(threadId) ?? []], ['old-turn-terminal']);
    fixture.native.afterCleanupBehaviors.set(threadId, async () => {entered(); await cleanupGate;});
    await fixture.writeReport('First complete report.');
    fixture.native.finish(threadId);
    nativeRoot.turnStatus = 'completed';
    await cleanupEntered;
    const nextReport = join(dirname(reviewerHandoff.writePaths[0]), 'after-cleanup', 'reports', 'report.md');
    await fixture.writeReport('', nextReport);
    const pending = runtime.execute({operation: 'followup_task', input: {
        ...reviewerHandoff, runId: observed.runId, reportPath: nextReport, writePaths: [dirname(nextReport)],
        handoff: 'Review a new complete input.',
    }});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fixture.native.calls.filter(call => call.operation === 'startTurn').length, 1);
    release();
    const accepted = succeeded(await pending);
    assert.equal(accepted.runId, observed.runId);
    const resumed = succeeded(await runtime.inspect({runId: observed.runId}));
    assert.equal(resumed.threadId, threadId);
    assert.equal(resumed.state, 'running');
    fixture.native.backgroundTerminals.set(threadId, new Set(['new-turn-terminal']));
    assert.deepEqual([...fixture.native.backgroundTerminals.get(threadId) ?? []], ['new-turn-terminal']);
    await runtime.close();
});

test('completion observed before native start acknowledgment still finishes terminal cleanup', async () => {
    const fixture = createReviewerRuntimeFixture();
    const nativeSessions = {
        async open(/** @type {Parameters<typeof fixture.native.nativeSessions.open>[0]} */ input) {
            const session = await fixture.native.nativeSessions.open(input);
            return Object.assign(Object.create(session), {
                async dispatchAccepted(/** @type {Parameters<typeof session.dispatchAccepted>[0]} */ request) {
                    const delivered = await session.dispatchAccepted(request);
                    const rootThreadId = session.previous.threadId;
                    assert.ok(rootThreadId);
                    fixture.native.backgroundTerminals.set(rootThreadId, new Set(['notification-client']));
                    await fixture.writeReport('Report delivered before the start acknowledgment.');
                    fixture.native.finish(rootThreadId);
                    return delivered;
                },
            });
        },
    };
    const runtime = createReviewerRuntime({...options(fixture), nativeSessions});
    const accepted = succeeded(await runtime.execute({operation: 'spawn_agent', input: reviewerHandoff}));
    const completed = succeeded(await runtime.inspect({runId: accepted.runId}));
    assert.deepEqual(completed.completion, {status: 'ready', reportPath: reviewerHandoff.reportPath});
    assert.equal(fixture.native.backgroundTerminals.get(/** @type {string} */ (completed.threadId))?.size ?? 0, 0);
    await runtime.close();
});

test('a missing bound report still finishes Reviewer terminal cleanup without ready delivery', async () => {
    const fixture = createReviewerRuntimeFixture();
    const {runtime, observed} = await start(fixture);
    const threadId = /** @type {string} */ (observed.threadId);
    fixture.native.backgroundTerminals.set(threadId, new Set(['notification-client']));
    fixture.native.finish(threadId);
    const completed = succeeded(await runtime.inspect({runId: observed.runId}));
    assert.equal(completed.completion?.status, 'incomplete');
    assert.equal(fixture.native.backgroundTerminals.get(threadId)?.size ?? 0, 0);
    await runtime.close();
});

test('failed recovery save cannot publish a cleaned Reviewer turn as ready', async () => {
    const fixture = createReviewerRuntimeFixture();
    let failRecoverySave = false;
    let recoveryLogicalPath = '';
    const filesystem = {
        async open(/** @type {Parameters<typeof fixture.filesystem.open>[0]} */ input) {
            const opened = await fixture.filesystem.open(input);
            if (opened.status !== 'succeeded') return opened;
            const original = opened.scopedFilesystem;
            return {...opened, scopedFilesystem: Object.assign(Object.create(original), {
                async write(/** @type {Parameters<typeof original.write>[0]} */ request) {
                    if (failRecoverySave && request.path === recoveryLogicalPath) {
                        return {status: 'blocked', error: {code: 'injected-save-failure', message: 'Injected recovery save failure.'}};
                    }
                    return original.write(request);
                },
            })};
        },
    };
    const runtime = createReviewerRuntime({...options(fixture), filesystem});
    const accepted = succeeded(await runtime.execute({operation: 'spawn_agent', input: reviewerHandoff}));
    const active = succeeded(await runtime.inspect({runId: accepted.runId}));
    const threadId = /** @type {string} */ (active.threadId);
    recoveryLogicalPath = relative(reviewerHandoff.cwd, active.recoveryPath).split('\\').join('/');
    fixture.native.backgroundTerminals.set(threadId, new Set(['notification-client']));
    await fixture.writeReport('The original full report.');
    failRecoverySave = true;
    fixture.native.finish(threadId);
    const blocked = await runtime.inspect({runId: accepted.runId});
    assert.notEqual(blocked.status === 'succeeded' ? blocked.result.completion?.status : null, 'ready');
    assert.equal(runtime.holdsRun(accepted.runId), true);
    failRecoverySave = false;
    const recovered = succeeded(await runtime.inspect({runId: accepted.runId}));
    assert.deepEqual(recovered.completion, {status: 'ready', reportPath: reviewerHandoff.reportPath});
    assert.equal(recovered.threadId, threadId);
    assert.equal(fixture.native.calls.filter(call => call.operation === 'startTurn').length, 1);
    await runtime.close();
});

test('unknown final idle facts cannot leave a saved ready Reviewer result', async () => {
    const fixture = createReviewerRuntimeFixture();
    const {runtime, observed} = await start(fixture);
    const threadId = /** @type {string} */ (observed.threadId);
    fixture.native.backgroundTerminals.set(threadId, new Set(['notification-client']));
    fixture.native.completionBehaviors.set(threadId, async () => {throw new Error('Injected final idle facts unavailable.');});
    await fixture.writeReport('The complete bound report.');
    fixture.native.finish(threadId);
    const blocked = succeeded(await runtime.inspect({runId: observed.runId}));
    assert.equal(blocked.completion?.status, 'incomplete');
    assert.match(String(blocked.completion?.reason), /idle facts unavailable/u);
    const opened = await fixture.filesystem.open({root: reviewerHandoff.cwd});
    assert.equal(opened.status, 'succeeded');
    if (opened.status !== 'succeeded') throw new Error('Scripted repository unavailable.');
    const logicalPath = relative(reviewerHandoff.cwd, observed.recoveryPath).split('\\').join('/');
    const saved = await readReviewerSessionRecord(opened.scopedFilesystem, observed.recoveryPath, logicalPath);
    assert.notEqual(saved?.completion?.status, 'ready');
    fixture.native.completionBehaviors.delete(threadId);
    const recovered = succeeded(await runtime.inspect({runId: observed.runId}));
    assert.deepEqual(recovered.completion, {status: 'ready', reportPath: reviewerHandoff.reportPath});
    assert.equal(recovered.threadId, threadId);
    assert.equal(fixture.native.calls.filter(call => call.operation === 'startTurn').length, 1);
    await runtime.close();
});

test('fresh isolation and pre-turn additional Agents reject work before its model turn', async () => {
    for (const variant of ['parent', 'history', 'helper']) {
        const fixture = createReviewerRuntimeFixture();
        const nativeSessions = {
            async open(/** @type {Parameters<typeof fixture.native.nativeSessions.open>[0]} */ input) {
                const session = await fixture.native.nativeSessions.open(input);
                return Object.assign(Object.create(session), {
                    async prepareNativeStart() {
                        const native = await session.prepareNativeStart();
                        const root = fixture.native.members.get(native.threadId);
                        assert.ok(root);
                        if (variant === 'parent') root.parentThreadId = 'other-thread';
                        if (variant === 'history') root.hasConversationHistory = true;
                        if (variant === 'helper') fixture.native.addHelper(native.threadId);
                        return native;
                    },
                });
            },
        };
        const runtime = createReviewerRuntime({...options(fixture), nativeSessions});
        const accepted = succeeded(await runtime.execute({operation: 'spawn_agent', input: reviewerHandoff}));
        const result = succeeded(await runtime.inspect({runId: accepted.runId}));
        assert.equal(result.state, 'failed');
        assert.equal(result.completion?.status, 'incomplete');
        assert.equal(fixture.native.calls.filter(call => call.operation === 'startTurn' && call.threadId === result.threadId).length, 0);
        assert.equal(fixture.native.sessions[0].environmentState, 'exited');
        await runtime.close();
    }
});

test('failure before native thread creation preserves a readable incomplete recovery record', async () => {
    const fixture = createReviewerRuntimeFixture();
    const nativeSessions = {
        async open(/** @type {Parameters<typeof fixture.native.nativeSessions.open>[0]} */ input) {
            const session = await fixture.native.nativeSessions.open(input);
            return Object.assign(Object.create(session), {async prepareNativeStart() {
                throw new Error('Injected native start failure.');
            }});
        },
    };
    const runtime = createReviewerRuntime({...options(fixture), nativeSessions});
    const accepted = succeeded(await runtime.execute({operation: 'spawn_agent', input: reviewerHandoff}));
    const observed = succeeded(await runtime.inspect({runId: accepted.runId}));
    assert.equal(observed.threadId, null);
    assert.equal(observed.completion?.status, 'incomplete');
    const opened = await fixture.filesystem.open({root: reviewerHandoff.cwd});
    assert.equal(opened.status, 'succeeded');
    if (opened.status !== 'succeeded') throw new Error('Scripted repository unavailable.');
    const logical = relative(reviewerHandoff.cwd, observed.recoveryPath).split('\\').join('/');
    const recovered = await readReviewerSessionRecord(opened.scopedFilesystem, observed.recoveryPath, logical);
    assert.equal(recovered?.runId, accepted.runId);
    assert.equal(recovered.threadId, null);
    await runtime.close();
});

test('followup_task reuses the original run and native Thread.id with current settings and a new measurement baseline', async () => {
    const fixture = createReviewerRuntimeFixture();
    const {runtime, observed} = await start(fixture);
    const threadId = /** @type {string} */ (observed.threadId);
    const root = fixture.native.members.get(threadId);
    assert.ok(root);
    root.usage = createUsage(40);
    await fixture.writeReport('First full report.');
    fixture.native.finish(threadId);
    assert.equal(succeeded(await runtime.inspect({runId: observed.runId})).completion?.status, 'ready');
    const newReport = join(dirname(reviewerHandoff.writePaths[0]), 'next', 'reports', 'report.md');
    await fixture.writeReport('', newReport);
    const nextHandoff = {...reviewerHandoff, reportPath: newReport, writePaths: [dirname(newReport)],
        settings: {...reviewerHandoff.settings, model: 'next-model'}};
    const accepted = succeeded(await runtime.execute({operation: 'followup_task', input: {...nextHandoff, runId: observed.runId}}));
    assert.equal(accepted.runId, observed.runId);
    assert.equal(accepted.threadId, threadId);
    assert.equal(accepted.deliveryStatus, 'accepted');
    const next = succeeded(await runtime.inspect({runId: observed.runId}));
    assert.equal(next.threadId, threadId);
    assert.notEqual(next.turnId, observed.turnId);
    assert.equal(next.completion, null);
    assert.equal(fixture.native.calls.filter(call => call.operation === 'start').length, 1);
    assert.equal(fixture.native.calls.filter(call => call.operation === 'acceptTask').length, 1);
    root.usage = createUsage(45);
    await fixture.writeReport('Second full report.', newReport);
    fixture.native.finish(threadId);
    const result = succeeded(await runtime.inspect({runId: observed.runId}));
    assert.equal(result.completion?.status, 'ready');
    assert.equal(result.measurement?.usage.totalTokens, 5);
    assert.deepEqual(result.measurement?.members.map(member => member.threadId), [threadId]);
    await runtime.close();
});

test('a follow-up cannot replace active work and a completed run can reattach without a new native thread', async () => {
    const fixture = createReviewerRuntimeFixture();
    const {runtime, observed} = await start(fixture);
    const nextReport = join(dirname(reviewerHandoff.writePaths[0]), 'followup', 'reports', 'report.md');
    await fixture.writeReport('', nextReport);
    failed(await runtime.execute({operation: 'followup_task', input: {...reviewerHandoff, runId: observed.runId,
        reportPath: nextReport, writePaths: [dirname(nextReport)]}}), 'reviewer-busy');
    assert.equal(fixture.native.calls.filter(call => call.operation === 'acceptTask').length, 0);
    await fixture.writeReport('Complete original report.');
    fixture.native.finish(/** @type {string} */ (observed.threadId));
    succeeded(await runtime.inspect({runId: observed.runId}));
    await runtime.close();
    const restored = createReviewerRuntime(options(fixture));
    const accepted = succeeded(await restored.execute({operation: 'followup_task', input: {...reviewerHandoff,
        runId: observed.runId, reportPath: nextReport, writePaths: [dirname(nextReport)]}}));
    assert.equal(accepted.runId, observed.runId);
    const next = succeeded(await restored.inspect({runId: observed.runId}));
    assert.equal(next.threadId, observed.threadId);
    assert.equal(fixture.native.calls.filter(call => call.operation === 'start').length, 1);
    assert.equal(fixture.native.calls.filter(call => call.operation === 'resume').length, 1);
    await restored.close();
});

test('a crashed saved running review becomes incomplete before explicit work resumes its original thread', async () => {
    const fixture = createReviewerRuntimeFixture();
    const {runtime, observed} = await start(fixture);
    const threadId = /** @type {string} */ (observed.threadId);
    const originalTurn = observed.turnId;
    const root = fixture.native.members.get(threadId);
    assert.ok(root);
    root.usage = createUsage(25);
    await runtime.close();
    fixture.native.sessions[0].environmentState = 'exited';
    root.state = 'exited';
    fixture.clock.advance(500);
    const reportPath = join(dirname(reviewerHandoff.writePaths[0]), 'after-crash', 'reports', 'report.md');
    await fixture.writeReport('', reportPath);
    let checkedOldRound = false;
    const nativeSessions = {
        async open(/** @type {Parameters<typeof fixture.native.nativeSessions.open>[0]} */ input) {
            const session = await fixture.native.nativeSessions.open(input);
            return Object.assign(Object.create(session), {
                async acceptTask(/** @type {Parameters<typeof session.acceptTask>[0]} */ task) {
                    const opened = await fixture.filesystem.open({root: reviewerHandoff.cwd});
                    assert.equal(opened.status, 'succeeded');
                    if (opened.status !== 'succeeded') throw new Error('Scripted repository unavailable.');
                    const path = relative(reviewerHandoff.cwd, observed.recoveryPath).split('\\').join('/');
                    const old = await readReviewerSessionRecord(opened.scopedFilesystem, observed.recoveryPath, path);
                    assert.equal(old?.runId, observed.runId);
                    assert.equal(old.state, 'stopped');
                    assert.equal(old.environmentState, 'exited');
                    assert.equal(old.completion?.status, 'incomplete');
                    assert.equal(old.measurement.finishedAt, null);
                    checkedOldRound = true;
                    return session.acceptTask(task);
                },
            });
        },
    };
    const restored = createReviewerRuntime({...options(fixture), nativeSessions});
    assert.equal(fixture.native.calls.filter(call => call.operation === 'resume').length, 0);
    const accepted = succeeded(await restored.execute({operation: 'followup_task', input: {
        ...reviewerHandoff, runId: observed.runId, reportPath, writePaths: [dirname(reportPath)], handoff: 'Explicit work after crash.',
    }}));
    assert.equal(checkedOldRound, true);
    assert.equal(accepted.runId, observed.runId);
    assert.equal(accepted.threadId, threadId);
    const next = succeeded(await restored.inspect({runId: observed.runId}));
    assert.equal(next.threadId, threadId);
    assert.notEqual(next.turnId, originalTurn);
    assert.equal(next.measurement?.startedAt, fixture.clock.now());
    assert.equal(fixture.native.calls.filter(call => call.operation === 'start').length, 1);
    assert.equal(fixture.native.calls.filter(call => call.operation === 'resume').length, 1);
    assert.equal(fixture.native.calls.filter(call => call.operation === 'startTurn').length, 2);
    assert.match(fixture.native.calls.filter(call => call.operation === 'startTurn').at(-1)?.text ?? '', /Explicit work after crash/);
    root.usage = createUsage(30);
    await fixture.writeReport('New complete report.', reportPath);
    fixture.native.finish(threadId);
    const finished = succeeded(await restored.inspect({runId: observed.runId}));
    assert.equal(finished.completion?.status, 'ready');
    assert.equal(finished.measurement?.usage.totalTokens, 5);
    await restored.close();
});

test('cold inspection uses the exact saved managed binding and never opens a native session', async () => {
    const fixture = createReviewerRuntimeFixture();
    const {runtime, observed} = await start(fixture);
    await runtime.close();
    const opened = await fixture.filesystem.open({root: reviewerHandoff.cwd});
    assert.equal(opened.status, 'succeeded');
    if (opened.status !== 'succeeded') throw new Error('Scripted repository unavailable.');
    const logical = relative(reviewerHandoff.cwd, observed.recoveryPath).split('\\').join('/');
    const record = await readReviewerSessionRecord(opened.scopedFilesystem, observed.recoveryPath, logical);
    assert.ok(record);
    const managed = /** @type {import('../../lib/background-agent/state-store.mjs').BackgroundAgentRow} */ (/** @type {unknown} */ ({
        runId: observed.runId, role: record.role, threadId: record.threadId, sessionPath: record.sessionPath,
        recoveryPath: backgroundAgentRecoveryPath({stateDirectory: reviewerHandoff.stateDirectory,runId: observed.runId}),
        cwd: record.cwd, readPaths: record.readPaths, writePaths: record.writePaths, settings: record.settings, state: 'exited',
    }));
    const before = fixture.native.calls.length;
    const uncertain = createReviewerRuntime(options(fixture));
    const unknown = succeeded(await uncertain.inspect({runId: observed.runId, managed: {...managed,state: 'unknown'}}));
    assert.equal(unknown.state, 'running');
    assert.equal(unknown.measurement?.wallClockMs, null);
    await uncertain.close();
    const restored = createReviewerRuntime(options(fixture));
    const inspected = succeeded(await restored.inspect({runId: observed.runId,managed}));
    assert.equal(inspected.threadId, observed.threadId);
    assert.equal(inspected.state, 'stopped');
    assert.equal(inspected.completion?.status, 'incomplete');
    assert.equal(inspected.measurement?.wallClockMs, null);
    assert.equal(fixture.native.calls.length, before);
    await restored.close();
    record.threadId = 'different-thread';
    await saveReviewerSessionRecord(opened.scopedFilesystem, record, logical);
    const mismatch = createReviewerRuntime(options(fixture));
    failed(await mismatch.inspect({runId: observed.runId,managed}), 'recovery-identity-mismatch');
    assert.equal(fixture.native.calls.length, before);
    await mismatch.close();
    record.threadId = observed.threadId;
    record.failure = {code: 'reviewer-group-violation',message: 'Saved native group violation.'};
    record.state = 'failed';
    await saveReviewerSessionRecord(opened.scopedFilesystem, record, logical);
    const priorFailure = createReviewerRuntime(options(fixture));
    const failedReview = succeeded(await priorFailure.inspect({runId: observed.runId,managed}));
    assert.equal(failedReview.state, 'failed');
    assert.equal(failedReview.completion?.status, 'incomplete');
    await priorFailure.close();

    const completedFixture = createReviewerRuntimeFixture();
    const completed = await start(completedFixture);
    await completedFixture.writeReport('Original historical report.');
    completedFixture.clock.advance(25);
    completedFixture.native.finish(/** @type {string} */ (completed.observed.threadId));
    const original = succeeded(await completed.runtime.inspect({runId: completed.observed.runId}));
    assert.equal(original.completion?.status, 'ready');
    await completed.runtime.close();
    const completedFilesystem = await completedFixture.filesystem.open({root: reviewerHandoff.cwd});
    assert.equal(completedFilesystem.status, 'succeeded');
    if (completedFilesystem.status !== 'succeeded') throw new Error('Scripted repository unavailable.');
    const completedLogical = relative(reviewerHandoff.cwd, completed.observed.recoveryPath).split('\\').join('/');
    const historical = await readReviewerSessionRecord(completedFilesystem.scopedFilesystem, completed.observed.recoveryPath, completedLogical);
    assert.ok(historical);
    historical.writePaths = [historical.reportPath];
    await saveReviewerSessionRecord(completedFilesystem.scopedFilesystem, historical, completedLogical);
    const historicalInput = relative(reviewerHandoff.cwd, join(dirname(historical.reportPath), 'request.json')).split('\\').join('/');
    assert.equal((await completedFilesystem.scopedFilesystem.write({path: historicalInput, bytes: Buffer.from('Historical frozen input.'), mode: 'create'})).status, 'succeeded');
    const historicalManaged = await managedBinding(completedFixture, completed.observed, 'running');
    const historicalQueries = createReviewerRuntime(options(completedFixture));
    const nativeCalls = completedFixture.native.calls.length;
    const recovered = succeeded(await historicalQueries.inspect({runId: completed.observed.runId, managed: historicalManaged}));
    assert.deepEqual(recovered.completion, original.completion);
    assert.equal(recovered.threadId, original.threadId);
    assert.deepEqual(recovered.measurement?.usage, original.measurement?.usage);
    assert.equal(recovered.measurement?.wallClockMs, original.measurement?.wallClockMs);
    failed(await historicalQueries.execute({operation: 'followup_task', input: {...reviewerHandoff,
        runId: completed.observed.runId, writePaths: [historical.reportPath]}}), 'invalid-input');
    historical.completion = null;
    historical.measurement.finishedAt = null;
    await saveReviewerSessionRecord(completedFilesystem.scopedFilesystem, historical, completedLogical);
    await assert.rejects(historicalQueries.restorePausedTask({runId: completed.observed.runId,
        managed: {...historicalManaged, providerWork: {paused: true}}}), /only the exact bound report directory/);
    assert.equal(completedFixture.native.calls.length, nativeCalls);
    const report = await completedFilesystem.scopedFilesystem.readText({path: relative(reviewerHandoff.cwd, historical.reportPath).split('\\').join('/'),
        allowLossyDecoding: false});
    assert.equal(report.status === 'succeeded' ? report.text : null, 'Original historical report.');
    const input = await completedFilesystem.scopedFilesystem.readText({path: historicalInput, allowLossyDecoding: false});
    assert.equal(input.status === 'succeeded' ? input.text : null, 'Historical frozen input.');
    await historicalQueries.close();
});

test('a crashed saved starting review remains incomplete with unknown wall time when no new work is accepted', async () => {
    const fixture = createReviewerRuntimeFixture();
    const {runtime, observed} = await start(fixture);
    const threadId = /** @type {string} */ (observed.threadId);
    await runtime.close();
    fixture.native.sessions[0].environmentState = 'exited';
    const root = fixture.native.members.get(threadId);
    assert.ok(root);
    root.state = 'exited';
    const opened = await fixture.filesystem.open({root: reviewerHandoff.cwd});
    assert.equal(opened.status, 'succeeded');
    if (opened.status !== 'succeeded') throw new Error('Scripted repository unavailable.');
    const recoveryFile = relative(reviewerHandoff.cwd, observed.recoveryPath).split('\\').join('/');
    const saved = await readReviewerSessionRecord(opened.scopedFilesystem, observed.recoveryPath, recoveryFile);
    assert.ok(saved);
    saved.state = 'starting';
    await saveReviewerSessionRecord(opened.scopedFilesystem, saved, recoveryFile);
    fixture.clock.advance(900);
    const reportPath = join(dirname(reviewerHandoff.writePaths[0]), 'not-accepted', 'reports', 'report.md');
    await fixture.writeReport('', reportPath);
    const nativeSessions = {
        async open(/** @type {Parameters<typeof fixture.native.nativeSessions.open>[0]} */ input) {
            const session = await fixture.native.nativeSessions.open(input);
            return Object.assign(Object.create(session), {
                async acceptTask() {throw new Error('Injected acceptance failure.');},
            });
        },
    };
    const restored = createReviewerRuntime({...options(fixture), nativeSessions});
    failed(await restored.execute({operation: 'followup_task', input: {...reviewerHandoff,
        runId: observed.runId, reportPath, writePaths: [dirname(reportPath)], handoff: 'Explicit later work.',
    }}), 'reviewer-runtime-failed');
    const previous = succeeded(await restored.inspect({runId: observed.runId}));
    assert.equal(previous.state, 'stopped');
    assert.equal(previous.completion?.status, 'incomplete');
    assert.equal(previous.measurement?.finishedAt, null);
    assert.equal(previous.measurement?.wallClockMs, null);
    assert.equal(fixture.native.calls.filter(call => call.operation === 'startTurn').length, 1);
    await restored.close();
});

test('an active additional Agent blocks a new follow-up turn on the original Reviewer', async () => {
    const fixture = createReviewerRuntimeFixture();
    const {runtime, observed} = await start(fixture);
    const threadId = /** @type {string} */ (observed.threadId);
    await fixture.writeReport('Original full report.');
    fixture.native.finish(threadId);
    succeeded(await runtime.inspect({runId: observed.runId}));
    const reportPath = join(dirname(reviewerHandoff.writePaths[0]), 'blocked-followup', 'reports', 'report.md');
    await fixture.writeReport('', reportPath);
    fixture.native.addHelper(threadId);
    const turns = fixture.native.calls.filter(call => call.operation === 'startTurn' && call.threadId === threadId).length;
    failed(await runtime.execute({operation: 'followup_task', input: {...reviewerHandoff,
        runId: observed.runId, reportPath, writePaths: [dirname(reportPath)]}}), 'reviewer-group-violation');
    assert.equal(fixture.native.calls.filter(call => call.operation === 'startTurn' && call.threadId === threadId).length, turns);
    assert.equal(fixture.native.sessions.at(-1)?.environmentState, 'exited');
    await runtime.close();
});

test('an unexpected extra Agent invalidates the result while ended historical members do not enter usage', async () => {
    const fixture = createReviewerRuntimeFixture();
    const {runtime, observed} = await start(fixture);
    const threadId = /** @type {string} */ (observed.threadId);
    const root = fixture.native.members.get(threadId);
    assert.ok(root);
    root.usage = createUsage(8);
    const childId = fixture.native.addHelper(threadId);
    const child = fixture.native.members.get(childId);
    assert.ok(child);
    child.usage = createUsage(70);
    const result = succeeded(await runtime.inspect({runId: observed.runId}));
    assert.equal(result.completion?.status, 'incomplete');
    assert.equal(result.state, 'failed');
    assert.equal(fixture.native.sessions[0].environmentState, 'exited');
    assert.deepEqual(result.measurement?.members.map(member => member.threadId), [threadId]);
    assert.equal(runtime.holdsRun(observed.runId), false);
    await runtime.close();
});

test('an explicit incomplete final retires without a report', async () => {
    const fixture = createReviewerRuntimeFixture();
    const {runtime,observed} = await start(fixture);
    const threadId = /** @type {string} */ (observed.threadId);
    assert.equal(runtime.holdsRun(observed.runId),true);
    fixture.native.finish(threadId,'{"status":"incomplete","reason":"Evidence remains unknown."}');
    const result = succeeded(await runtime.inspect({runId:observed.runId}));
    assert.equal(result.completion?.status,'incomplete');
    assert.equal(runtime.holdsRun(observed.runId),false);
    await runtime.close();
});

test('a nonretryable native failure freezes work and releases its local budget after protected completion',async()=>{
    const fixture=createReviewerRuntimeFixture();
    let work=initialStrataWorkState(true);let automaticMessages=0;let released=false;
    /** @type {Map<NodeJS.Timeout,{callback:()=>void,at:number}>} */
    const scheduled=new Map();
    const policyClock={now:fixture.clock.now,
        setTimeout:(/** @type {()=>void} */ callback,/** @type {number} */ delay)=>{
            const timer=/** @type {NodeJS.Timeout} */(/** @type {unknown} */({unref(){}}));
            scheduled.set(timer,{callback,at:fixture.clock.now()+delay});return timer;
        },
        clearTimeout:(/** @type {NodeJS.Timeout} */ timer)=>{scheduled.delete(timer);},
    };
    const nativeSessions={open:async(/** @type {Parameters<typeof fixture.native.nativeSessions.open>[0]} */ input)=>{
        const session=await fixture.native.nativeSessions.open(input);
        const release=session.releaseProtectedTurn;
        return Object.assign(session,{
            getProviderWork:()=>/** @type {Record<string,unknown>} */(/** @type {unknown} */(work)),
            saveProviderWork:/** @param {Record<string,unknown>} state */ state=>{work=/** @type {typeof work} */(/** @type {unknown} */(state));},
            createProviderWorkPolicy:/** @param {Parameters<NonNullable<typeof session.createProviderWorkPolicy>>[0]} callbacks */ callbacks=>
                createStrataTaskSupport({installationDirectory:'/unused'}).createPolicy({...callbacks,clock:policyClock,
                    readWorkState:()=>/** @type {Record<string,unknown>} */(/** @type {unknown} */(work)),
                    saveWorkState:state=>{work=/** @type {typeof work} */(/** @type {unknown} */(state));}}),
            configureReviewerTask:async()=>({enabled:true,settings:input.settings,compactBinding:null}),
            sendProgramInstruction:async(/** @type {Parameters<NonNullable<typeof session.sendProgramInstruction>>[0]} */ instruction)=>{
                automaticMessages++;instruction.onAccepted(`automatic-${automaticMessages}`);
            },
            releaseProtectedTurn:async(/** @type {Parameters<typeof release>[0]} */ request)=>{
                const result=await release(request);released=true;return result;
            },
        });
    }};
    const runtime=createReviewerRuntime({...options(fixture),nativeSessions});
    const handoff={...reviewerHandoff,identity:{kind:/** @type {const} */('isolated'),instanceId:'fatal-budget'}};
    const receipt=succeeded(await runtime.execute({operation:'spawn_agent',input:handoff}));
    const active=succeeded(await runtime.inspect({runId:receipt.runId}));
    assert.equal(scheduled.size,1);
    const threadId=/** @type {string} */(active.threadId);const root=fixture.native.members.get(threadId);assert.ok(root);
    fixture.clock.advance(20);fixture.native.finish(threadId,'');
    root.state='failed';root.turnStatus='failed';root.finalResponse=null;root.retryableModelFailure=false;
    const ended=succeeded(await runtime.inspect({runId:receipt.runId}));
    assert.equal(ended.state,'failed');assert.equal(ended.completion?.status,'incomplete');
    assert.equal(ended.measurement?.finishedAt,fixture.clock.now());assert.equal(ended.measurement?.workDuration.durationMs,20);
    assert.equal(released,true);assert.equal(runtime.holdsRun(receipt.runId),false);assert.equal(scheduled.size,0);
    const binding=await managedBinding(fixture,{runId:receipt.runId,recoveryPath:/** @type {string} */(ended.recoveryPath)},'running');
    fixture.clock.advance(61*60_000);
    for(const [timer,pending] of [...scheduled])if(pending.at<=fixture.clock.now()){scheduled.delete(timer);pending.callback();}
    await new Promise(resolve=>setImmediate(resolve));
    const later=succeeded(await runtime.inspect({runId:receipt.runId,managed:binding}));
    assert.equal(later.measurement?.workDuration.durationMs,20);assert.equal(automaticMessages,0);
    assert.equal(fixture.native.calls.some(call=>call.operation==='stop'),false);await runtime.close();
});

test('an unexpected native service exit keeps persisted Reviewer end unknown and work stable while unverified resources keep capacity',async t=>{
    const directory=await createTemporaryDirectory(t,'arw-reviewer-unexpected-exit-');
    const workspace=join(directory,'.tmp','codex','test-session');
    const stateDirectory=join(workspace,'0093_03','runtime');
    const reportDirectory=join(workspace,'0093_03','reports');
    const reportPath=join(reportDirectory,'report.md');
    await Promise.all([mkdir(stateDirectory,{recursive:true}),mkdir(reportDirectory,{recursive:true})]);
    await writeFile(reportPath,'');
    const clock=createReviewerTestClock();
    const scripted=createScriptedReviewerSessions();
    /** @type {number|null} */ let exitedAt=null;
    /** @type {((notification:import('../../lib/background-agent/codex-app-server.mjs').NativeNotification)=>void)|null} */ let notify=null;
    /** @type {import('../../lib/background-agent/codex-app-server.mjs').NativeSessions} */
    const nativeSessions={
        async ensureServer(){},async observeServer(){return exitedAt===null?'running':'ended';},
        async close(){return{environmentState:'exited',previousProcessState:'ended'};},
        async open(input){
            notify=input.onNotification;
            const session=await scripted.nativeSessions.open(input);
            const startedAt=clock.now();
            return /** @type {import('../../lib/background-agent/codex-app-server.mjs').NativeSession} */(new Proxy(session,{get(target,property,receiver){
                if(property==='snapshot')return async(/** @type {Parameters<typeof target.snapshot>[0]} */ request)=>{
                    const facts=await target.snapshot(request);
                    return {...facts,environmentState:exitedAt===null?facts.environmentState:/** @type {const} */('exited'),
                        factsComplete:exitedAt===null&&facts.factsComplete,
                        unknownReasons:exitedAt===null?facts.unknownReasons:['Native service exited; root and tool unload are unverified.'],
                        measurementFacts:{workState:{state:exitedAt===null?/** @type {const} */('working'):/** @type {const} */('unavailable'),
                            at:exitedAt??startedAt,estimated:true,basis:exitedAt===null?'准确原生根线程已建立的客户端观察时间.':'原生服务退出的客户端观察时间, 工具退出未证实.'}},
                    };
                };
                if(property==='stop')return async()=>{throw new Error('Root and tool unload are unverified after native service exit.');};
                return Reflect.get(target,property,receiver);
            }}));
        },
    };
    const stateStore=createBackgroundAgentStateStore({runtimeDirectory:join(directory,'managed'),clock:{...clock,setTimeout,clearTimeout}});
    const manager=await createBackgroundAgentManager({nativeSessions,stateStore,maxInstances:1,clock:{...clock,setTimeout,clearTimeout}});
    const managedSessions=createManagedNativeSessions({manager,ownerId:'test-session',controllerId:'test-session',role:reviewerHandoff.role});
    const runtimeOptions={nativeSessions:managedSessions,clock,recoveryBoundary:()=>({repositoryRoot:directory,sessionWorkspaceRoot:workspace})};
    const runtime=createReviewerRuntime(runtimeOptions);
    t.after(async()=>{await runtime.close();await manager.close();});
    const handoff={...reviewerHandoff,cwd:directory,stateDirectory,writePaths:[reportDirectory],reportPath,
        identity:{kind:/** @type {const} */('ordinary'),issueIds:['issue:0093:03']}};
    const accepted=succeeded(await runtime.execute({operation:'spawn_agent',input:handoff}));
    const active=succeeded(await runtime.inspect({runId:accepted.runId}));
    assert.equal(active.state,'running');
    clock.advance(200);exitedAt=clock.now();
    scripted.backgroundTerminals.set(/** @type {string} */(active.threadId),new Set(['unverified-tool']));
    clock.advance(300);assert.ok(notify);
    /** @type {(notification:import('../../lib/background-agent/codex-app-server.mjs').NativeNotification)=>void} */(notify)({type:'exited',reason:'Native service exited.'});
    const ended=succeeded(await runtime.inspect({runId:accepted.runId}));
    assert.equal(ended.state,'failed');assert.equal(ended.completion?.status,'incomplete');
    assert.equal(ended.measurement?.wallClockMs,null);assert.equal(ended.measurement?.workDuration.durationMs,200);
    assert.equal(ended.measurement?.finishedAt,null);assert.equal(ended.measurement?.workDuration.estimated,true);
    assert.match(ended.measurement?.workDuration.basis??'',/客户端观察时间/u);
    clock.advance(10_000);
    const later=succeeded(await runtime.inspect({runId:accepted.runId}));
    assert.deepEqual(later.measurement,ended.measurement);
    const overview=await manager.execute({ownerId:'test-session',controllerId:'test-session',operation:'list_agents',input:{runId:accepted.runId}});
    assert.equal(overview.status,'succeeded');
    if(overview.status==='succeeded')assert.equal(/** @type {{state:string}} */(overview.result).state,'unknown');
    assert.equal((await manager.prepareMaintenance({stopBackgroundAgents:false})).status,'busy');
    const admission=await manager.execute({ownerId:'test-session',controllerId:'test-session',operation:'spawn_agent',input:{
        role:'researcher',settings:handoff.settings,cwd:directory,stateDirectory,instructions:'Read the supplied evidence.',handoff:'Read.',
    }});
    assert.equal(admission.status,'failed');
    if(admission.status==='failed')assert.match(admission.error.message,/capacity is exhausted/u);
    await stateStore.flush();await runtime.close();
    const managed=stateStore.getAgent(accepted.runId);assert.ok(managed);
    const cold=createReviewerRuntime(runtimeOptions);
    try{
        const reread=succeeded(await cold.inspect({runId:accepted.runId,managed}));
        assert.equal(reread.state,'failed');assert.deepEqual(reread.completion,ended.completion);
        assert.ok(reread.measurement);assert.ok(ended.measurement);
        const {workDuration,...other}=reread.measurement;
        const {workDuration:observedWork,...observedOther}=ended.measurement;
        assert.deepEqual(other,observedOther);
        assert.equal(workDuration.durationMs,observedWork.durationMs);assert.equal(workDuration.estimated,observedWork.estimated);
        // 重读可以补充时钟采样重建的覆盖限制, 原退出观察依据仍须保留.
        assert.match(workDuration.basis??'',/原生服务退出的客户端观察时间/u);
    }finally{await cold.close();}
});

test('native manual requests do not themselves fail or stop the Reviewer and unknown facts cannot authorize ready', async () => {
    const fixture = createReviewerRuntimeFixture();
    const {runtime, observed} = await start(fixture);
    fixture.native.sessions[0].clientRequests.push({requestId: 'permission-1', kind: 'approval',
        method: 'item/commandExecution/requestApproval', params: {},
        threadId: observed.threadId, turnId: observed.turnId});
    const pending = succeeded(await runtime.inspect({runId: observed.runId}));
    assert.equal(pending.state, 'running');
    assert.equal(fixture.native.sessions[0].environmentState, 'running');
    assert.equal(fixture.native.calls.filter(call => call.operation === 'stop').length, 0);
    fixture.native.sessions[0].clientRequests.length = 0;
    fixture.native.sessions[0].factsComplete = false;
    await fixture.writeReport('Full report.');
    fixture.native.finish(/** @type {string} */ (observed.threadId));
    const unknown = succeeded(await runtime.inspect({runId: observed.runId}));
    assert.equal(unknown.completion?.status, 'incomplete');
    assert.equal(unknown.measurement?.usage.totalTokens, null);
    await runtime.close();
});

test('interrupt_agent binds the exact active turn, and close only detaches control', async () => {
    const fixture = createReviewerRuntimeFixture();
    const {runtime, observed} = await start(fixture);
    failed(await runtime.execute({operation: 'interrupt_agent', input: {runId: observed.runId, turnId: 'old-turn'}}), 'turn-mismatch');
    const interrupted = succeeded(await runtime.execute({operation: 'interrupt_agent', input: {
        runId: observed.runId, turnId: observed.turnId,
    }}));
    assert.equal(interrupted.accepted, true);
    assert.equal(runtime.holdsRun(observed.runId), false);
    assert.equal(fixture.native.sessions[0].environmentState, 'running');
    const managed = await managedBinding(fixture, observed, 'running');
    assert.equal(succeeded(await runtime.inspect({runId: observed.runId,managed})).completion?.status, 'incomplete');
    assert.equal((await runtime.close()).status, 'succeeded');
    assert.equal(fixture.native.sessions[0].environmentState, 'running');
    failed(await runtime.execute({operation: 'resume', input: {runId: observed.runId}}), 'runtime-closed');
});

test('only repository temporary write scope and a complete current bound report can authorize delivery', async () => {
    const fixture = createReviewerRuntimeFixture();
    const runtime = createReviewerRuntime(options(fixture));
    failed(await runtime.execute({operation: 'spawn_agent', input: {...reviewerHandoff,
        writePaths: [reviewerHandoff.cwd]}}), 'invalid-input');
    failed(await runtime.execute({operation: 'spawn_agent', input: {...reviewerHandoff,
        readPaths: ['/another-repository']}}), 'invalid-input');
    failed(await runtime.execute({operation: 'spawn_agent', input: {...reviewerHandoff,
        writePaths: [reviewerHandoff.reportPath]}}), 'invalid-input');
    assert.equal(fixture.native.sessions.length, 0);
    const accepted = succeeded(await runtime.execute({operation: 'spawn_agent', input: reviewerHandoff}));
    const observed = succeeded(await runtime.inspect({runId: accepted.runId}));
    fixture.native.finish(/** @type {string} */ (observed.threadId));
    const empty = succeeded(await runtime.inspect({runId: accepted.runId}));
    assert.equal(empty.completion?.status, 'incomplete');
    await fixture.writeReport('Full report, personally written by the Reviewer.');
    assert.equal(succeeded(await runtime.inspect({runId: accepted.runId})).completion?.status, 'ready');
    await fixture.writeReport('');
    const managed = await managedBinding(fixture, observed, 'running');
    assert.equal(succeeded(await runtime.inspect({runId: accepted.runId,managed})).completion?.status, 'incomplete');
    await runtime.close();
});

test('actual native permissions without bound report write access reject a complete report', async () => {
    const fixture = createReviewerRuntimeFixture();
    const {runtime, observed} = await start(fixture);
    const threadId = /** @type {string} */ (observed.threadId);
    const context = fixture.native.members.get(threadId)?.contexts.at(-1);
    assert.ok(context?.permissionsRules);
    context.permissionsRules = context.permissionsRules.filter(rule => rule.access !== 'write');
    await fixture.writeReport('Complete report despite missing native write permission.');
    fixture.native.finish(threadId);
    const result = succeeded(await runtime.inspect({runId: observed.runId}));
    assert.equal(result.completion?.status, 'incomplete');
    assert.match(result.completion?.status === 'incomplete' ? result.completion.reason : '', /write permission for the bound report/);
    await runtime.close();
});

test('Reviewer admission rejects an additional temporary write directory before native work', async () => {
    const fixture = createReviewerRuntimeFixture();
    const opened = await fixture.filesystem.open({root: reviewerHandoff.cwd});
    assert.equal(opened.status, 'succeeded');
    if (opened.status !== 'succeeded') throw new Error('Scripted repository unavailable.');
    const extraDirectory = join(dirname(reviewerHandoff.writePaths[0]), 'extra');
    assert.equal((await opened.scopedFilesystem.createDirectory({path: relative(reviewerHandoff.cwd, extraDirectory).split('\\').join('/')})).status, 'succeeded');
    const runtime = createReviewerRuntime(options(fixture));
    failed(await runtime.execute({operation: 'spawn_agent', input: {...reviewerHandoff,
        writePaths: [...reviewerHandoff.writePaths, extraDirectory]}}), 'invalid-input');
    assert.equal(fixture.native.sessions.length, 0);
    await runtime.close();
});

test('Reviewer rejects mixed report-directory input at admission, continuation and result delivery', async () => {
    const fixture = createReviewerRuntimeFixture();
    const opened = await fixture.filesystem.open({root: reviewerHandoff.cwd});
    assert.equal(opened.status, 'succeeded');
    if (opened.status !== 'succeeded') throw new Error('Scripted repository unavailable.');
    const inputPath = relative(reviewerHandoff.cwd, join(dirname(reviewerHandoff.reportPath), 'request.json')).split('\\').join('/');
    let continuations = 0;
    const nativeSessionsFor = (/** @type {ReturnType<typeof createReviewerRuntimeFixture>} */ fixture) => ({open: async (/** @type {Parameters<typeof fixture.native.nativeSessions.open>[0]} */ input) => {
        const session = await fixture.native.nativeSessions.open(input);
        return Object.assign(session, {continueTask: async () => {continuations++; throw new Error('Unsafe continuation started.');}});
    }});
    const runtime = createReviewerRuntime({...options(fixture), nativeSessions: nativeSessionsFor(fixture)});
    assert.equal((await opened.scopedFilesystem.write({path: inputPath, bytes: Buffer.from('{}'), mode: 'create'})).status, 'succeeded');
    failed(await runtime.execute({operation: 'spawn_agent', input: reviewerHandoff}), 'report-binding-invalid');
    assert.equal(fixture.native.sessions.length, 0);
    assert.equal((await opened.scopedFilesystem.remove({path: inputPath})).status, 'succeeded');
    const receipt = succeeded(await runtime.execute({operation: 'spawn_agent', input: reviewerHandoff}));
    const active = succeeded(await runtime.inspect({runId: receipt.runId}));
    assert.equal((await opened.scopedFilesystem.write({path: inputPath, bytes: Buffer.from('{}'), mode: 'create'})).status, 'succeeded');
    const managed = await managedBinding(fixture, active, 'running');
    await assert.rejects(runtime.restorePausedTask({runId: receipt.runId, managed}), /report directory must contain only/);
    await fixture.writeReport('No problems.\n');fixture.native.finish(/** @type {string} */ (active.threadId));
    failed(await runtime.inspect({runId: receipt.runId}), 'report-binding-invalid');
    assert.equal(continuations, 0);
    assert.equal(fixture.native.calls.filter(call => call.operation === 'startTurn').length, 1);
    assert.equal((await opened.scopedFilesystem.read({path: inputPath})).status, 'succeeded');
    await runtime.close();

    for (const phase of ['final', 'saved']) {
        const completedFixture = createReviewerRuntimeFixture();
        const completedRuntime = createReviewerRuntime({...options(completedFixture), nativeSessions: nativeSessionsFor(completedFixture)});
        const receipt = succeeded(await completedRuntime.execute({operation: 'spawn_agent', input: reviewerHandoff}));
        const active = succeeded(await completedRuntime.inspect({runId: receipt.runId}));
        const threadId = /** @type {string} */ (active.threadId);
        const root = completedFixture.native.members.get(threadId);
        assert.ok(root);
        root.usage = createUsage(7);
        completedFixture.clock.advance(25);
        await completedFixture.writeReport('Complete original bound report.');
        if (phase === 'saved') {
            completedFixture.native.finish(threadId);
            assert.equal(succeeded(await completedRuntime.inspect({runId: receipt.runId})).completion?.status, 'ready');
        }
        const opened = await completedFixture.filesystem.open({root: reviewerHandoff.cwd});
        assert.equal(opened.status, 'succeeded');
        if (opened.status !== 'succeeded') throw new Error('Scripted repository unavailable.');
        assert.equal((await opened.scopedFilesystem.write({path: inputPath, bytes: Buffer.from('{}'), mode: 'create'})).status, 'succeeded');
        if (phase === 'final') completedFixture.native.finish(threadId);
        const managed = await managedBinding(completedFixture, active, 'running');
        failed(await completedRuntime.inspect({runId: receipt.runId, managed}), 'report-binding-invalid');
        if (phase === 'saved') {
            const cold = createReviewerRuntime(options(completedFixture));
            failed(await cold.inspect({runId: receipt.runId, managed}), 'report-binding-invalid');
            assert.equal((await opened.scopedFilesystem.remove({path: inputPath})).status, 'succeeded');
            const restored = succeeded(await cold.inspect({runId: receipt.runId, managed}));
            assert.deepEqual(restored.completion, {status: 'ready', reportPath: reviewerHandoff.reportPath});
            assert.equal(restored.threadId, threadId);
            assert.equal(restored.measurement?.usage.totalTokens, 7);
            assert.equal(restored.measurement?.wallClockMs, 25);
            await cold.close();
        }
        assert.equal(continuations, 0);
        assert.equal(completedFixture.native.sessions.length, 1);
        assert.equal(completedFixture.native.calls.filter(call => call.operation === 'startTurn').length, 1);
        const report = await opened.scopedFilesystem.readText({path: relative(reviewerHandoff.cwd, reviewerHandoff.reportPath).split('\\').join('/'),
            allowLossyDecoding: false});
        assert.equal(report.status === 'succeeded' ? report.text : null, 'Complete original bound report.');
        await completedRuntime.close();
    }
});

test('Reviewer admission rejects recovery records inside its writable report directory', async () => {
    const handoff = {...reviewerHandoff, stateDirectory: join(dirname(reviewerHandoff.reportPath), 'runtime')};
    const fixture = createReviewerRuntimeFixture({handoff});
    const runtime = createReviewerRuntime(options(fixture));
    const rejected = await runtime.execute({operation: 'spawn_agent', input: handoff});
    failed(rejected, 'invalid-input');
    assert.match(rejected.status === 'failed' ? rejected.error.message : '', /recovery records must stay outside/);
    assert.equal(fixture.native.sessions.length, 0);
    await runtime.close();
});

test('actual native write access to review input rejects a complete report', async () => {
    const fixture = createReviewerRuntimeFixture();
    const {runtime, observed} = await start(fixture);
    const threadId = /** @type {string} */ (observed.threadId);
    const context = fixture.native.members.get(threadId)?.contexts.at(-1);
    assert.ok(context?.permissionsRules);
    context.permissionsRules.push({path: `${reviewerHandoff.cwd}/.tmp/request.json`, access: 'write'});
    await fixture.writeReport('Complete report despite unauthorized native input write permission.');
    fixture.native.finish(threadId);
    const result = succeeded(await runtime.inspect({runId: observed.runId}));
    assert.equal(result.completion?.status, 'incomplete');
    assert.match(result.completion?.status === 'incomplete' ? result.completion.reason : '', /write permission outside the authorized temporary paths/);
    await runtime.close();
});

test('report and write-path ancestor links are rejected before native admission', async t => {
    const repositoryRoot = await createTemporaryDirectory(t, 'arw-reviewer-scope-');
    const cwd = join(repositoryRoot, 'audited');
    const external = join(repositoryRoot, 'external');
    const reportDirectory = join(cwd, '.tmp', 'reports');
    const linkedDirectory = join(cwd, '.tmp', 'redirect');
    const stateDirectory = join(repositoryRoot, '.tmp', 'codex', 'test-session', '0093_01', 'runtime');
    await Promise.all([mkdir(reportDirectory, {recursive: true}), mkdir(external), mkdir(stateDirectory, {recursive: true})]);
    await Promise.all([writeFile(join(external, 'report.md'), ''), writeFile(join(reportDirectory, 'report.md'), '')]);
    await symlink(external, linkedDirectory);
    const native = createScriptedReviewerSessions();
    const runtime = createReviewerRuntime({nativeSessions: native.nativeSessions,
        recoveryBoundary: () => ({repositoryRoot, sessionWorkspaceRoot: join(repositoryRoot, '.tmp', 'codex', 'test-session')})});
    const handoff = {...reviewerHandoff, cwd, stateDirectory};
    failed(await runtime.execute({operation: 'spawn_agent', input: {...handoff,
        writePaths: [linkedDirectory], reportPath: join(linkedDirectory, 'report.md')}}), 'invalid-input');
    failed(await runtime.execute({operation: 'spawn_agent', input: {...handoff,
        writePaths: [reportDirectory, linkedDirectory], reportPath: join(reportDirectory, 'report.md')}}), 'invalid-input');
    assert.equal(native.calls.length, 0);
    assert.equal(await readFile(join(external, 'report.md'), 'utf8'), '');
    await runtime.close();
});

test('a bound report hard link is rejected before work, paused recovery and completion', async t => {
    const repositoryRoot = await createTemporaryDirectory(t, 'arw-reviewer-hardlink-');
    const cwd = join(repositoryRoot, 'audited');
    const reportDirectory = join(cwd, '.tmp', 'reports');
    const reportPath = join(reportDirectory, 'report.md');
    const otherLink = join(repositoryRoot, 'other-report.md');
    const stateDirectory = join(repositoryRoot, '.tmp', 'codex', 'test-session', '0093_01', 'runtime');
    await Promise.all([mkdir(reportDirectory, {recursive: true}), mkdir(stateDirectory, {recursive: true})]);
    await writeFile(otherLink, '');
    await link(otherLink, reportPath);
    const native = createScriptedReviewerSessions();
    const runtime = createReviewerRuntime({nativeSessions: native.nativeSessions,
        recoveryBoundary: () => ({repositoryRoot, sessionWorkspaceRoot: join(repositoryRoot, '.tmp', 'codex', 'test-session')})});
    const handoff = {...reviewerHandoff, cwd, stateDirectory, writePaths: [reportDirectory], reportPath};
    failed(await runtime.execute({operation: 'spawn_agent', input: handoff}), 'report-binding-invalid');
    assert.equal(native.calls.length, 0);
    await rm(reportPath);
    await writeFile(reportPath, '');
    const accepted = succeeded(await runtime.execute({operation: 'spawn_agent', input: handoff}));
    const observed = succeeded(await runtime.inspect({runId: accepted.runId}));
    await rm(reportPath);
    await writeFile(otherLink, 'A nonempty file outside the audited repository.');
    await link(otherLink, reportPath);
    const record = JSON.parse(await readFile(observed.recoveryPath, 'utf8'));
    const managed = /** @type {import('../../lib/background-agent/state-store.mjs').BackgroundAgentRow} */ (/** @type {unknown} */ ({
        ...record, recoveryPath: backgroundAgentRecoveryPath({stateDirectory, runId: accepted.runId}),
        state: 'idle', providerWork: {paused: true}, instructions: handoff.instructions,
    }));
    await assert.rejects(runtime.restorePausedTask({runId: accepted.runId, managed}), /without hard links/);
    const cold = createReviewerRuntime({nativeSessions: native.nativeSessions,
        recoveryBoundary: () => ({repositoryRoot, sessionWorkspaceRoot: join(repositoryRoot, '.tmp', 'codex', 'test-session')})});
    await assert.rejects(cold.restorePausedTask({runId: accepted.runId, managed}), /without hard links/);
    assert.equal(native.sessions.length, 1);
    assert.equal(native.calls.filter(call => call.operation === 'startTurn').length, 1);
    await cold.close();
    native.finish(/** @type {string} */ (observed.threadId));
    assert.equal(succeeded(await runtime.inspect({runId: accepted.runId})).completion?.status, 'incomplete');
    assert.equal(await readFile(otherLink, 'utf8'), 'A nonempty file outside the audited repository.');
    await runtime.close();
});




test('unpaired existing response events preserve a legal bound report and unknown phases without extra work',async()=>{
    const fixture=createReviewerRuntimeFixture();
    const limitation='仅有原任务起止观察, 未观测完整停机或休眠生命周期.';
    const nativeSessions={open:async(/** @type {Parameters<typeof fixture.native.nativeSessions.open>[0]} */ input)=>{
        const session=await fixture.native.nativeSessions.open(input);
        const snapshot=session.snapshot;
        return Object.assign(session,{snapshot:async(/** @type {Parameters<typeof session.snapshot>[0]} */ request)=>{
            const observed=await snapshot(request);
            const root=observed.members.find(member=>member.threadId===request.rootThreadId);
            return {...observed,measurementFacts:{requestsComplete:false,
                responses:root?.turnId?[{threadId:request.rootThreadId,responseId:'response',inputTokens:100,cachedInputTokens:20,outputTokens:21}]:[],
                workCoverage:{complete:false,basis:limitation}}};
        }});
    }};
    const runtime=createReviewerRuntime({...options(fixture),nativeSessions});
    const accepted=succeeded(await runtime.execute({operation:'spawn_agent',input:reviewerHandoff}));
    const active=succeeded(await runtime.inspect({runId:accepted.runId}));
    fixture.clock.advance(25);await fixture.writeReport('Complete current bound report.');
    fixture.native.finish(/** @type {string} */(active.threadId));
    const final=succeeded(await runtime.inspect({runId:accepted.runId}));
    assert.equal(final.completion?.status,'ready');assert.equal(final.measurement?.workDuration.estimated,true);
    assert.ok(final.measurement?.workDuration.basis?.includes(limitation));
    assert.equal(final.measurement?.modelPhases.totalRequests,null);
    assert.deepEqual(final.measurement?.modelPhases.input,[]);assert.deepEqual(final.measurement?.modelPhases.output,[]);
    assert.equal(fixture.native.calls.some(call=>call.operation==='steer'||call.operation==='interruptGroup'||call.operation==='stop'),false);
    await runtime.close();
});


test('a recoverable bound report read fault receives concrete feedback and resumes the same review', async () => {
    const reportRelative=relative(reviewerHandoff.cwd,reviewerHandoff.reportPath).split('\\').join('/');
    const fixture=createReviewerRuntimeFixture({filesystemFailures:[{operation:'readText',path:reportRelative,
        result:{status:'failed',stage:'read',diagnostics:[{code:'filesystem-io-failed',message:'The bound report is temporarily unreadable.'}]}}]});
    let work=initialStrataWorkState(false);
    const nativeSessions={open:async(/** @type {Parameters<typeof fixture.native.nativeSessions.open>[0]} */ input)=>{
        const session=await fixture.native.nativeSessions.open(input);
        return Object.assign(session,{
            configureReviewerTask:async()=>({enabled:true,settings:input.settings,compactBinding:null}),
            createProviderWorkPolicy:/** @param {Parameters<NonNullable<typeof session.createProviderWorkPolicy>>[0]} callbacks */ callbacks=>
                createStrataTaskSupport({installationDirectory:'/unused'}).createPolicy({...callbacks,
                    readWorkState:()=>/** @type {Record<string,unknown>} */(/** @type {unknown} */(work)),
                    saveWorkState:state=>{work=/** @type {typeof work} */(/** @type {unknown} */(state));}}),
            continueTask:async(/** @type {Parameters<NonNullable<typeof session.continueTask>>[0]} */ request)=>{
                request.onAccepted('report-read-feedback');
                const delivered=await session.startTurn({threadId:request.rootThreadId,handoff:request.instruction});
                return {turnId:/** @type {string} */(delivered.turnId),deliveryStatus:'delivered'};
            },
        });
    }};
    const runtime=createReviewerRuntime({...options(fixture),nativeSessions});
    try {
        const receipt=succeeded(await runtime.execute({operation:'spawn_agent',input:reviewerHandoff}));
        const initial=succeeded(await runtime.inspect({runId:receipt.runId}));
        const threadId=/** @type {string} */(initial.threadId);
        const root=fixture.native.members.get(threadId);assert.ok(root);
        const originalInput=fixture.native.calls.find(call=>call.operation==='startTurn')?.text;
        assert.equal(typeof originalInput,'string');
        const report='No findings.\n';await fixture.writeReport(report);
        root.usage=createUsage(20);fixture.clock.advance(25);fixture.native.finish(threadId);
        const continued=succeeded(await runtime.inspect({runId:receipt.runId}));
        assert.equal(continued.completion,null);assert.equal(continued.threadId,threadId);assert.equal(continued.runId,receipt.runId);
        assert.equal(continued.measurement?.startedAt,initial.measurement?.startedAt);
        assert.equal(continued.measurement?.usage.totalTokens,20);
        const feedback=fixture.native.calls.find(call=>call.operation==='startTurn'&&call.turnId===continued.turnId)?.text;
        assert.match(String(feedback),/filesystem-io-failed: The bound report is temporarily unreadable/);
        assert.equal(fixture.native.calls.find(call=>call.operation==='startTurn')?.text,originalInput);
        assert.equal(fixture.filesystem.snapshot(reviewerHandoff.cwd).get(reportRelative)?.toString(),report);
        const opened=await fixture.filesystem.open({root:reviewerHandoff.cwd});
        assert.equal(opened.status,'succeeded');
        if(opened.status!=='succeeded')throw new Error('Scripted repository unavailable.');
        assert.equal((await opened.scopedFilesystem.remove({path:reportRelative})).status,'succeeded');
        root.usage=createUsage(25);fixture.clock.advance(10);fixture.native.finish(threadId);
        const missing=succeeded(await runtime.inspect({runId:receipt.runId}));
        assert.equal(missing.completion,null);assert.equal(missing.threadId,threadId);assert.equal(missing.runId,receipt.runId);
        assert.equal(missing.measurement?.startedAt,initial.measurement?.startedAt);
        assert.match(fixture.native.calls.find(call=>call.operation==='startTurn'&&call.turnId===missing.turnId)?.text??'',/bound report is missing/);
        await fixture.writeReport(report);
        root.usage=createUsage(35);fixture.clock.advance(30);fixture.native.finish(threadId);
        const completed=succeeded(await runtime.inspect({runId:receipt.runId}));
        assert.deepEqual(completed.completion,{status:'ready',reportPath:reviewerHandoff.reportPath});
        assert.equal(completed.runId,receipt.runId);assert.equal(completed.threadId,threadId);
        assert.equal(completed.measurement?.startedAt,initial.measurement?.startedAt);
        assert.equal(completed.measurement?.wallClockMs,65);assert.equal(completed.measurement?.usage.totalTokens,35);
        assert.equal(fixture.filesystem.snapshot(reviewerHandoff.cwd).get(reportRelative)?.toString(),report);
    } finally {await runtime.close();}
});
