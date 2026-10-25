import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {Readable, Writable} from 'node:stream';
import test from 'node:test';

import {createBackgroundAgentHost, listBackgroundAgents, runBackgroundAgentMachine} from '../../lib/arw-background-agent-host.mjs';
import {isJsonObject} from '../../lib/common/json.mjs';
import {createUsage} from '../../lib/reviewer-runtime/reviewer-measurement.mjs';
import {createScriptedReviewerSessions} from '../helpers/reviewer-runtime-adapter.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';

/** @typedef {import('../../lib/background-agent/codex-app-server.mjs').NativeSessions} NativeSessions */
/** @typedef {import('../../lib/background-agent/codex-app-server.mjs').NativeUserMessage} NativeUserMessage */

/** @param {import('../../lib/background-agent/machine.mjs').RuntimeResult} response */
const succeeded = response => {
    assert.equal(response.status, 'succeeded', JSON.stringify(response));
    assert.ok(response.result !== null && typeof response.result === 'object');
    return /** @type {Record<string, unknown>} */ (response.result);
};

/** @param {import('../../lib/background-agent/machine.mjs').RuntimeResult} response */
const failed = response => {
    assert.equal(response.status, 'failed', JSON.stringify(response));
    return response.error;
};

/** @returns {{scripted: ReturnType<typeof createScriptedReviewerSessions>, nativeSessions: NativeSessions}} */
const scriptedNativeSessions = () => {
    const scripted = createScriptedReviewerSessions();
    let nextItem = 0;
    let serverRunning = false;
    const nativeSessions = /** @type {NativeSessions} */ ({
        async ensureServer() {serverRunning = true;},
        async observeServer() {return serverRunning ? 'running' : 'absent';},
        async close() {serverRunning = false;return {environmentState: 'exited', previousProcessState: 'absent'};},
        async open(input) {
            const session = await scripted.nativeSessions.open(input);
            /** @type {NativeUserMessage[]} */
            const userMessages = [];
            const record = (/** @type {string} */ threadId, /** @type {string} */ turnId, /** @type {string} */ text) => {
                userMessages.push({itemId: `native-input-${++nextItem}`, threadId, turnId, text, recordSequence: nextItem});
            };
            return /** @type {import('../../lib/background-agent/codex-app-server.mjs').NativeSession} */ (new Proxy(session, {
                get(target, property, receiver) {
                    if (property === 'startTurn') return async (/** @type {{threadId:string,handoff:string}} */ request) => {
                        const result = await target.startTurn(request);
                        assert.ok(result.turnId);
                        record(request.threadId, result.turnId, request.handoff);
                        return {turnId: result.turnId};
                    };
                    if (property === 'steer') return async (/** @type {{threadId:string,turnId:string,instruction:string}} */ request) => {
                        const result = await target.steer(request);
                        assert.ok(result.turnId);
                        record(request.threadId, result.turnId, request.instruction);
                        return {turnId: result.turnId};
                    };
                    if (property === 'snapshot') return async (/** @type {Parameters<typeof target.snapshot>[0]} */ request) => ({
                        ...await target.snapshot(request), userMessages: [...userMessages],
                    });
                    return Reflect.get(target, property, receiver);
                },
            }));
        },
    });
    return {scripted, nativeSessions};
};

/** @param {string} repositoryRoot @param {string} taskName */
const prepareReport = async (repositoryRoot, taskName) => {
    const reportPath = join(repositoryRoot, '.tmp', 'codex', 'main-session', taskName, 'reports', 'review.md');
    await mkdir(dirname(reportPath), {recursive: true});
    await writeFile(reportPath, '');
    return reportPath;
};

/**
 * @param {import('node:test').TestContext} t
 * @param {Record<string,import('../../lib/background-agent/model-catalog.mjs').ProviderConfiguration>|undefined} [providers]
 * @param {Parameters<typeof createBackgroundAgentHost>[0]['createStrataDriver']} [createStrataDriver]
 * @param {{backgroundAgent?: Record<string, number>, reviewers?: Record<string, Record<string, string>>}} [engineOptions]
 */
const fixture = async (t, providers, createStrataDriver, engineOptions = {}) => {
    /** @type {Awaited<ReturnType<typeof createBackgroundAgentHost>>|null} */ let host = null;
    t.after(() => host?.manager.close());
    const directory = await createTemporaryDirectory(t, 'arw-background-host-');
    const repositoryRoot = join(directory, 'repository');
    const installationDirectory = join(directory, 'installation');
    const programDirectory = join(directory, 'engine');
    const reportPath = await prepareReport(repositoryRoot, 'first');
    const reportDirectory = dirname(reportPath);
    const stateDirectory = join(repositoryRoot, '.tmp', 'codex', 'main-session', 'runtime');
    await mkdir(installationDirectory);
    await mkdir(programDirectory);
    await mkdir(stateDirectory, {recursive: true});
    await writeFile(join(programDirectory, 'config.json'), JSON.stringify({
        configVersion: 3, editor: {command: 'code', args: ['{file}']},
        reviewEditor: {command: 'code', args: ['{file}']}, jira: {listLimit: 50},
        ...engineOptions,
    }));
    const {scripted, nativeSessions} = scriptedNativeSessions();
    const modelCatalog = providers === undefined ? undefined : {
        async prepare() {return join(directory, 'models.json');},
        async getProviders() {return structuredClone(providers);},
        async remove() {},
    };
    host = await createBackgroundAgentHost({installationDirectory, programDirectory, nativeSessions, modelCatalog, createStrataDriver});
    const caller = {repositoryRoot, programDirectory};
    const dispatch = (/** @type {string} */ operation, /** @type {Record<string, unknown>} */ input,
        /** @type {string} */ ownerId = 'main-session',
        /** @type {((value:unknown)=>Promise<void>)|undefined} */ emit = undefined) =>
        host.dispatch({ownerId, caller, operation, input, emit});
    const handoff = {role: 'requirements-reviewer', identity: {kind: 'ordinary', issueIds: ['issue:0093:01']},
        instructions: 'Complete Reviewer rules.', handoff: 'Review the prepared evidence.',
        cwd: repositoryRoot, writePaths: [reportDirectory], reportPath, stateDirectory};
    return {directory, repositoryRoot, installationDirectory, programDirectory, reportDirectory, reportPath, stateDirectory,
        host, scripted, nativeSessions, dispatch, handoff};
};

/** @param {Record<string,unknown>} result */
const measurement = result => {
    assert.ok(isJsonObject(result.measurement));
    return /** @type {NonNullable<import('../../lib/reviewer-runtime/reviewer-runtime.mjs').ReviewerOperationResult['measurement']>} */(/** @type {unknown} */(result.measurement));
};
/** @param {import('node:test').TestContext} t */
const earlyExitFixture = async t => {
    t.mock.timers.enable({apis:['Date'],now:1000});
    const f=await fixture(t,undefined,undefined,{backgroundAgent:{earlyExitNotificationThreshold:2},
        reviewers:{'requirements-reviewer':{modelProvider:'test-provider'}}});
    const accepted=succeeded(await f.dispatch('spawn_agent',{...f.handoff,identity:{kind:'ordinary',issueIds:['issue:0093:03']}}));
    const runId=String(accepted.runId);
    await f.host.manager.owned(runId,'main-session','main-session').work;
    const active=succeeded(await f.dispatch('list_agents',{runId}));
    const threadId=String(active.threadId);const root=f.scripted.members.get(threadId);assert.ok(root);
    return {...f,runId,threadId,root,startedAt:measurement(active).startedAt};
};
/** @param {Awaited<ReturnType<typeof earlyExitFixture>>} f @param {import('node:test').TestContext} t @param {string} [finalResponse] */
const finishEarly = async (f,t,finalResponse) => {
    const previous=f.root.turnId;
    f.root.usage=createUsage((f.root.usage.totalTokens??0)+10);
    t.mock.timers.tick(100);f.scripted.finish(f.threadId,finalResponse);
    const current=succeeded(await f.dispatch('list_agents',{runId:f.runId}));
    assert.equal(current.completion,null);assert.equal(current.threadId,f.threadId);
    assert.equal(measurement(current).startedAt,f.startedAt);
    return {previous,current};
};
/** @param {Awaited<ReturnType<typeof earlyExitFixture>>} f */
const pauseNotices = async f => {
    succeeded(await f.dispatch('wait_agent',{runId:f.runId,cursor:0},'main-session',async()=>{}));
    const page=succeeded(await f.dispatch('messages',{runId:f.runId,direction:'agent-to-main',limit:10}));
    assert.ok(Array.isArray(page.messages));
    return page.messages.filter(item=>isJsonObject(item)&&String(item.preview).includes('Reviewer runtime paused'));
};

test('Host applies provider capacity to generic background work and keeps another provider available', async t => {
    const f = await fixture(t, {limited: {maxInstances: 1}});
    const spawn = (/** @type {string} */ modelProvider) => f.dispatch('spawn_agent', {
        role: 'researcher', cwd: f.repositoryRoot, stateDirectory: f.stateDirectory,
        instructions: 'Complete the assigned work.',
        handoff: 'Inspect the supplied evidence.',
        settings: {model: 'test-model', modelProvider, reasoningEffort: 'high', serviceTier: 'default', config: {}},
    });
    const first = succeeded(await spawn('limited'));
    await f.host.manager.owned(String(first.runId), 'main-session', 'main-session').work;
    const firstActive = succeeded(await f.dispatch('list_agents', {runId: first.runId}));
    assert.equal(firstActive.state, 'running');
    const rejected = failed(await spawn('limited'));
    assert.match(String(rejected.message), /Provider limited capacity is exhausted/);
    assert.equal(f.scripted.sessions.length, 1);
    const third = succeeded(await spawn('other'));
    await f.host.manager.owned(String(third.runId), 'main-session', 'main-session').work;
    const otherActive = succeeded(await f.dispatch('list_agents', {runId: third.runId}));
    assert.equal(otherActive.state, 'running');
    assert.equal(f.scripted.sessions.length, 2);
    assert.equal(succeeded(await f.dispatch('list_agents', {runId: first.runId})).state, 'running');
});

test('two Engine callers select Reviewer settings and manager capacity changes only after restart', async t => {
    const f = await fixture(t, undefined, undefined, {
        backgroundAgent: {maxInstances: 2, persistenceIntervalMs: 4000},
        reviewers: {'requirements-reviewer': {model: 'engine-a-model', modelProvider: 'provider-a',
            reasoningEffort: 'high', serviceTier: 'default'}},
    });
    const otherProgramDirectory = join(f.directory, 'engine-b');
    await mkdir(otherProgramDirectory);
    const otherConfig = {
        configVersion: 3, editor: {command: 'code', args: ['{file}']},
        reviewEditor: {command: 'code', args: ['{file}']}, jira: {listLimit: 50},
        backgroundAgent: {maxInstances: 5, persistenceIntervalMs: 1},
        reviewers: {'requirements-reviewer': {model: 'engine-b-model', modelProvider: 'provider-b',
            reasoningEffort: 'low', serviceTier: 'fast'}},
    };
    await writeFile(join(otherProgramDirectory, 'config.json'), JSON.stringify(otherConfig));
    await writeFile(join(f.repositoryRoot, 'arw.config.json'), JSON.stringify({
        configVersion: 2, reviewers: {'requirements-reviewer': {model: 'repository-model'}},
    }));
    const otherCaller = {repositoryRoot: f.repositoryRoot, programDirectory: otherProgramDirectory};
    const otherDispatch = (/** @type {Record<string, unknown>} */ input) => f.host.dispatch({
        ownerId: 'main-session', caller: otherCaller, operation: 'spawn_agent', input,
    });
    const spawnInput = (/** @type {string} */ instanceId, /** @type {string} */ reportPath) => ({
        ...f.handoff, identity: {kind: 'isolated', instanceId}, writePaths: [dirname(reportPath)], reportPath,
    });
    const first = succeeded(await f.dispatch('spawn_agent', spawnInput('engine-a', f.reportPath)));
    await f.host.manager.owned(String(first.runId), 'main-session', 'main-session').work;
    const secondReport = await prepareReport(f.repositoryRoot, 'engine-b');
    const second = succeeded(await otherDispatch(spawnInput('engine-b', secondReport)));
    await f.host.manager.owned(String(second.runId), 'main-session', 'main-session').work;
    assert.deepEqual(f.scripted.sessions.map(session => {
        const {model, modelProvider, reasoningEffort, serviceTier} = session.input.settings;
        return {model, modelProvider, reasoningEffort, serviceTier};
    }), [
        {model: 'repository-model', modelProvider: 'provider-a', reasoningEffort: 'high', serviceTier: 'default'},
        {model: 'repository-model', modelProvider: 'provider-b', reasoningEffort: 'low', serviceTier: 'fast'},
    ]);
    await writeFile(join(f.programDirectory, 'config.json'), JSON.stringify({
        configVersion: 3, editor: {command: 'code', args: ['{file}']},
        reviewEditor: {command: 'code', args: ['{file}']}, jira: {listLimit: 50},
        backgroundAgent: {maxInstances: 5, persistenceIntervalMs: 1},
    }));
    const thirdReport = await prepareReport(f.repositoryRoot, 'engine-b-third');
    const blocked = failed(await otherDispatch(spawnInput('engine-b-third', thirdReport)));
    assert.match(String(blocked.message), /Background Agent capacity is exhausted/);
    assert.equal(f.scripted.sessions.length, 2);
    const maintenance = await f.host.manager.prepareMaintenance({stopBackgroundAgents: true});
    assert.equal(maintenance.status, 'ready', JSON.stringify(maintenance));
    await f.host.manager.close();
    await writeFile(join(otherProgramDirectory, 'config.json'), JSON.stringify({
        ...otherConfig, backgroundAgent: {...otherConfig.backgroundAgent, maxInstances: 1},
    }));
    const {scripted: restartedScripted, nativeSessions: restartedNative} = scriptedNativeSessions();
    const restarted = await createBackgroundAgentHost({
        installationDirectory: f.installationDirectory,
        programDirectory: otherProgramDirectory,
        nativeSessions: restartedNative,
    });
    try {
        const accepted = succeeded(await restarted.dispatch({
            ownerId: 'main-session', caller: otherCaller, operation: 'spawn_agent',
            input: spawnInput('engine-b-after-restart', thirdReport),
        }));
        await restarted.manager.owned(String(accepted.runId), 'main-session', 'main-session').work;
        assert.equal(restartedScripted.sessions[0]?.input.settings.modelProvider, 'provider-b');
        const anotherReport = await prepareReport(f.repositoryRoot, 'engine-b-after-restart-second');
        const afterRestartBlocked = failed(await restarted.dispatch({
            ownerId: 'main-session', caller: otherCaller, operation: 'spawn_agent',
            input: spawnInput('engine-b-after-restart-second', anotherReport),
        }));
        assert.match(String(afterRestartBlocked.message), /Background Agent capacity is exhausted/);
    } finally {
        await restarted.manager.close();
    }
});

test('machine and user list clients validate the timeout in their own Engine configuration', async t => {
    const home = await createTemporaryDirectory(t, 'arw-background-client-config-');
    const validEngine = join(home, 'valid-engine');
    const invalidEngine = join(home, 'invalid-engine');
    await mkdir(validEngine);
    await mkdir(invalidEngine);
    const configuration = {
        configVersion: 3, editor: {command: 'code', args: ['{file}']},
        reviewEditor: {command: 'code', args: ['{file}']}, jira: {listLimit: 50},
        backgroundAgent: {messageTimeoutMs: 20},
    };
    await writeFile(join(validEngine, 'config.json'), JSON.stringify(configuration));
    await writeFile(join(invalidEngine, 'config.json'), JSON.stringify({
        ...configuration, backgroundAgent: {messageTimeoutMs: 0},
    }));
    const installationDirectory = join(home, '.agent-repository-workflow');
    await mkdir(installationDirectory);
    await writeFile(join(installationDirectory, 'config.json'), '{invalid-json');
    const environment = {...process.env, HOME: home, USERPROFILE: home};
    assert.equal(await listBackgroundAgents({programDirectory: validEngine, environment, observeManagerProcess: async () => 'absent'}), null);
    assert.equal(await runBackgroundAgentMachine({
        hostRepositoryRoot: home, programDirectory: validEngine, environment,
        platformAdapter: {getCurrentAgentIdentity: () => ({platform: 'codex', sessionId: 'main-session'})},
        input: Readable.from([]), output: new Writable({write(_chunk, _encoding, callback) {callback();}}),
        signals: new EventEmitter(),
    }), 0);
    await assert.rejects(listBackgroundAgents({programDirectory: invalidEngine, environment}),
        /backgroundAgent\.messageTimeoutMs/);
    await assert.rejects(runBackgroundAgentMachine({
        hostRepositoryRoot: home, programDirectory: invalidEngine, environment,
        platformAdapter: {getCurrentAgentIdentity: () => ({platform: 'codex', sessionId: 'main-session'})},
    }), /backgroundAgent\.messageTimeoutMs/);
});

test('Host keeps a refused Strata Reviewer diagnostic after saving and releasing its runtime memory', async t => {
    const model = 'qwen3.8-flash-next-q2_0';
    const refusal = 'Strata acquire rejected (HTTP 409): Ownership is already held.';
    let acquired = 0;
    const f = await fixture(t, {
        first: {driver: 'strata', installationDirectory: '/strata', maxInstances: 1},
        second: {driver: 'strata', installationDirectory: '/strata', maxInstances: 1},
    }, () => ({
        async connect() {return {controllerUrl: 'http://127.0.0.1:9001', responsesUrl: 'http://127.0.0.1:9002'};},
        async acquire() {
            if (++acquired > 1) throw new Error(refusal);
            return {leaseKey: 'held-provider-key'};
        },
        async status() {return {status: 'running', model};},
        async start() {return {status: 'running', model};},
        async stop() {return {status: 'stopped', cleanUnload: true};},
        async release() {return {ownership: 'free', previousKeyRevoked: true};},
    }));
    const first = succeeded(await f.dispatch('spawn_agent', {
        role: 'researcher', cwd: f.repositoryRoot, stateDirectory: f.stateDirectory,
        instructions: 'Complete the assigned work.', handoff: 'Inspect the supplied evidence.',
        settings: {model, modelProvider: 'first', reasoningEffort: 'high', serviceTier: 'default', config: {}},
    }));
    await f.host.manager.owned(String(first.runId), 'main-session', 'main-session').work;
    const firstLease = f.host.manager.stateStore.getProvider('first');
    const second = succeeded(await f.dispatch('spawn_agent', {
        ...f.handoff, identity: {kind: 'isolated', instanceId: 'strata-refused'},
        settings: {model, modelProvider: 'second', reasoningEffort: 'high', serviceTier: 'default'},
    }));
    assert.equal(second.deliveryStatus, 'accepted');
    await f.host.manager.owned(String(second.runId), 'main-session', 'main-session').work;
    const diagnostic = {providerId: 'second', message: refusal};
    const current = succeeded(await f.dispatch('list_agents', {runId: second.runId}));
    assert.equal(current.state, 'exited');
    assert.equal(current.threadId, null);
    assert.deepEqual(current.providerError, diagnostic);
    assert.deepEqual(f.host.manager.stateStore.getProvider('second'), {
        providerId: 'second', controllerUrl: 'http://127.0.0.1:9001', leaseKey: null, lastError: refusal,
    });
    await f.host.manager.stateStore.flush();
    await f.host.manager.serial(async () => {});
    const saved = succeeded(await f.dispatch('wait_agent', {runId: second.runId, cursor: 0}));
    assert.deepEqual(saved.providerError, diagnostic);
    assert.equal(saved.state, 'exited');
    assert.equal(JSON.stringify(saved).includes('held-provider-key'), false);
    assert.deepEqual(f.host.manager.stateStore.getProvider('first'), firstLease);
    assert.equal(succeeded(await f.dispatch('list_agents', {runId: first.runId})).state, 'running');
    assert.equal(f.scripted.sessions.length, 1);
    assert.equal(acquired, 2);
    const messages = succeeded(await f.dispatch('messages', {runId: second.runId, direction: 'agent-to-main'}));
    assert.deepEqual(messages.messages, []);
});

test('Host accepts Reviewer work asynchronously and delivers its messages through the single manager queue', async t => {
    const f = await fixture(t);
    const started = succeeded(await f.dispatch('spawn_agent', f.handoff));
    assert.equal(started.threadId, null);
    assert.equal(started.deliveryStatus, 'accepted');
    assert.equal(typeof started.messageId, 'string');
    const runId = String(started.runId);
    await f.host.manager.owned(runId, 'main-session', 'main-session').work;
    const active = succeeded(await f.dispatch('list_agents', {runId}));
    const threadId = String(active.threadId);
    assert.equal(active.state, 'running');
    assert.equal(f.scripted.calls.filter(call => call.operation === 'startTurn').length, 1);
    const notice = succeeded(await f.dispatch('send_message', {runId, message: 'Checking the bound evidence.'}, threadId));
    assert.equal(notice.persistenceStatus, 'nonpersisted');
    assert.equal(f.scripted.calls.filter(call => call.operation === 'steer').length, 0);
    /** @type {unknown[]} */ const emitted = [];
    const response = await f.dispatch('wait_agent', {runId, cursor: active.cursor}, 'main-session', async value => {emitted.push(value);});
    const received = succeeded(response);
    assert.deepEqual(emitted, [response]);
    assert.ok(Array.isArray(received.notifications));
    assert.equal(received.notifications.filter(item => item.type === 'message').length, 1);
    assert.equal(received.notifications.find(item => item.type === 'message').messageId, notice.messageId);
    const page = succeeded(await f.dispatch('messages', {runId, direction: 'agent-to-main'}));
    assert.ok(Array.isArray(page.messages));
    assert.equal(page.messages[0].deliveryStatus, 'delivered');
    assert.equal(page.messages[0].preview, 'Checking the bound evidence.');
    const instruction = succeeded(await f.dispatch('send_message', {runId, turnId: active.turnId, message: 'Inspect the current contract.'}));
    assert.equal(instruction.deliveryStatus, 'accepted');
    await f.host.manager.owned(runId, 'main-session', 'main-session').work;
    assert.equal(f.scripted.calls.filter(call => call.operation === 'steer').length, 1);
    failed(await f.dispatch('messages', {runId}, 'another-session'));
    failed(await f.dispatch('spawn_agent', f.handoff, threadId));
    failed(await f.dispatch('respond', {runId, requestId: 'request', response: {}}));
    for (const key of ['ownerId', 'ownerTitle', 'controllerId', 'maxInstances']) {
        failed(await f.dispatch('send_message', {runId, message: 'Override.', [key]: 'other'}));
    }
    for (const operation of ['start', 'resume', 'send', 'wait', 'status', 'interrupt', 'stop']) {
        failed(await f.dispatch(operation, {runId}));
    }
    await writeFile(f.reportPath, 'Complete bound report.');
    f.scripted.finish(threadId);
    const completed = succeeded(await f.dispatch('list_agents', {runId}));
    assert.equal(completed.state, 'idle');
    assert.deepEqual(completed.completion, {status: 'ready', reportPath: f.reportPath});
    const overview = succeeded(await f.dispatch('list_agents', {}, 'another-session'));
    assert.ok(Array.isArray(overview.agents));
    assert.equal(overview.agents.length, 1);
});

test('Reviewer pre-turn rejection ends accepted delivery and permits safe maintenance', async t => {
    const f = await fixture(t);
    f.nativeSessions.ensureServer = async () => {throw new Error('Injected native startup failure.');};
    const accepted = succeeded(await f.dispatch('spawn_agent', f.handoff));
    assert.equal(accepted.deliveryStatus, 'accepted');
    const runId = String(accepted.runId);
    await f.host.manager.owned(runId, 'main-session', 'main-session').work;
    const rejected = succeeded(await f.dispatch('list_agents', {runId}));
    assert.ok(isJsonObject(rejected.completion), JSON.stringify(rejected));
    assert.equal(rejected.completion.status, 'incomplete');
    assert.match(String(rejected.completion.reason), /Injected native startup failure/u);
    assert.equal(f.scripted.calls.filter(call => call.operation === 'startTurn').length, 0);
    const page = succeeded(await f.dispatch('messages', {runId, direction: 'main-to-agent'}));
    assert.ok(Array.isArray(page.messages));
    const message = page.messages.find(item => item.messageId === accepted.messageId);
    assert.ok(message);
    assert.equal(message.deliveryStatus, 'failed', JSON.stringify(rejected));
    const maintenance = await f.host.manager.prepareMaintenance({stopBackgroundAgents: false});
    assert.equal(maintenance.status, 'ready', JSON.stringify(maintenance));
});

test('generic and Reviewer elapsed time spans the task, freezes on completion and resets for follow-up', async t => {
    t.mock.timers.enable({apis: ['Date'], now: 1000});
    const f = await fixture(t);
    const inputs = [
        {...f.handoff, role: 'researcher', settings: {model: 'test-model', modelProvider: 'test-provider',
            reasoningEffort: 'high', serviceTier: 'default', config: {}}},
        f.handoff,
    ];
    /** @type {Array<{runId: string, input: typeof inputs[number]}>} */
    const runs = [];
    for (const input of inputs) {
        const accepted = succeeded(await f.dispatch('spawn_agent', input));
        const runId = String(accepted.runId);
        await f.host.manager.owned(runId, 'main-session', 'main-session').work;
        runs.push({runId, input});
    }
    const elapsed = async () => {
        const overview = succeeded(await f.dispatch('list_agents', {}));
        assert.ok(Array.isArray(overview.agents));
        const agents = overview.agents;
        return runs.map(({runId}) => {
            const agent = agents.find(item => item.runId === runId);
            assert.ok(agent);
            return agent.taskElapsedMs;
        });
    };
    t.mock.timers.tick(20000);
    assert.deepEqual(await elapsed(), [20000, 20000]);
    for (const {runId} of runs) {
        const active = succeeded(await f.dispatch('list_agents', {runId}));
        succeeded(await f.dispatch('send_message', {runId, turnId: active.turnId, message: 'Additional evidence.'}));
        await f.host.manager.owned(runId, 'main-session', 'main-session').work;
    }
    t.mock.timers.tick(5000);
    assert.deepEqual(await elapsed(), [25000, 25000]);
    assert.deepEqual(await elapsed(), [25000, 25000]);
    await writeFile(f.reportPath, 'Complete bound report.');
    t.mock.timers.tick(1000);
    for (const {runId} of runs) {
        const active = succeeded(await f.dispatch('list_agents', {runId}));
        f.scripted.finish(String(active.threadId));
        assert.equal(succeeded(await f.dispatch('list_agents', {runId})).state, 'idle');
    }
    t.mock.timers.tick(10000);
    assert.deepEqual(await elapsed(), [26000, 26000]);
    for (const {runId, input} of runs) {
        const nextReport = await prepareReport(f.repositoryRoot, `elapsed-followup-${input.role}`);
        succeeded(await f.dispatch('followup_task', {...input, runId, writePaths: [dirname(nextReport)], reportPath: nextReport, handoff: 'Next task.'}));
        await f.host.manager.owned(runId, 'main-session', 'main-session').work;
    }
    t.mock.timers.tick(3000);
    assert.deepEqual(await elapsed(), [3000, 3000]);
});

test('Reviewer startup waits retain their update and independent timeout behavior', async t => {
    t.mock.timers.enable({apis: ['setTimeout']});
    let release = () => {};
    let entered = () => {};
    const gate = new Promise(resolve => {release = () => resolve(undefined);});
    const opening = new Promise(resolve => {entered = () => resolve(undefined);});
    t.after(() => release());
    const f = await fixture(t);
    const open = f.nativeSessions.open;
    f.nativeSessions.open = async input => {entered();await gate;return open(input);};
    const accepted = succeeded(await f.dispatch('spawn_agent', f.handoff));
    await opening;
    const runId = String(accepted.runId);
    const initial = succeeded(await f.dispatch('list_agents', {runId}));
    assert.equal(initial.state, 'starting');
    assert.equal(initial.threadId, null);
    let settled = false;
    const timed = f.dispatch('wait_agent', {runId, cursor: initial.cursor, timeout_ms: 10000})
        .then(result => {settled = true;return result;});
    // Allow the wait to register without advancing its timer or releasing startup.
    for (let turn = 0; turn < 20; turn++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    t.mock.timers.tick(10000);
    const expired = succeeded(await timed);
    assert.equal(expired.state, 'starting');
    assert.equal(expired.cursor, initial.cursor);
    assert.deepEqual(expired.notifications, []);
    const updated = f.dispatch('wait_agent', {runId, cursor: expired.cursor, timeout_ms: 10000});
    release();
    const observation = succeeded(await updated);
    assert.ok(Number(observation.cursor) > Number(expired.cursor));
    await f.host.manager.owned(runId, 'main-session', 'main-session').work;
    const active = succeeded(await f.dispatch('list_agents', {runId}));
    assert.equal(active.state, 'running');
    assert.equal(f.scripted.sessions.length, 1);
});

test('failed Reviewer terminal cleanup blocks delivery and can be retried without another turn', async t => {
    const f = await fixture(t);
    const started = succeeded(await f.dispatch('spawn_agent', f.handoff));
    await f.host.manager.owned(String(started.runId), 'main-session', 'main-session').work;
    const active = succeeded(await f.dispatch('list_agents', {runId: started.runId}));
    const threadId = String(active.threadId);
    f.scripted.backgroundTerminals.set(threadId, new Set(['notification-client']));
    f.scripted.cleanupBehaviors.set(threadId, async () => {throw new Error('Injected terminal exit failure.');});
    await writeFile(f.reportPath, 'The original complete report.');
    f.scripted.finish(threadId);
    const blocked = succeeded(await f.dispatch('list_agents', {runId: started.runId}));
    assert.ok(isJsonObject(blocked.completion));
    assert.equal(blocked.completion?.status, 'incomplete');
    assert.match(String(blocked.completion?.reason), /terminal exit failure/u);
    assert.equal((await f.host.manager.prepareMaintenance({stopBackgroundAgents: false})).status, 'busy');
    assert.equal(f.scripted.backgroundTerminals.get(threadId)?.size, 1);
    f.scripted.cleanupBehaviors.delete(threadId);
    const recovered = succeeded(await f.dispatch('list_agents', {runId: started.runId}));
    assert.deepEqual(recovered.completion, {status: 'ready', reportPath: f.reportPath});
    assert.equal(recovered.threadId, threadId);
    assert.equal(await readFile(f.reportPath, 'utf8'), 'The original complete report.');
    assert.equal((await f.host.manager.prepareMaintenance({stopBackgroundAgents: false})).status, 'ready');
});

test('unknown final Reviewer idle facts keep the cleared root occupied until rechecked', async t => {
    const f = await fixture(t, undefined, undefined, {backgroundAgent: {maxInstances: 1}});
    const started = succeeded(await f.dispatch('spawn_agent', f.handoff));
    await f.host.manager.owned(String(started.runId), 'main-session', 'main-session').work;
    const active = succeeded(await f.dispatch('list_agents', {runId: started.runId}));
    const threadId = String(active.threadId);
    f.scripted.backgroundTerminals.set(threadId, new Set(['notification-client']));
    f.scripted.idleBehaviors.set(threadId, async () => {throw new Error('Injected final idle facts unavailable.');});
    await writeFile(f.reportPath, 'The complete bound report.');
    f.scripted.finish(threadId);
    const blocked = succeeded(await f.dispatch('list_agents', {runId: started.runId}));
    assert.ok(isJsonObject(blocked.completion));
    assert.equal(blocked.completion.status, 'incomplete');
    assert.equal(f.scripted.backgroundTerminals.get(threadId)?.size ?? 0, 0);
    assert.equal((await f.host.manager.prepareMaintenance({stopBackgroundAgents: false})).status, 'busy');
    const secondReport = await prepareReport(f.repositoryRoot, 'unknown-second');
    const secondInput = {...f.handoff, identity: {kind: 'isolated', instanceId: 'unknown-second'}, writePaths: [dirname(secondReport)], reportPath: secondReport};
    assert.match(String(failed(await f.dispatch('spawn_agent', secondInput)).message), /capacity is exhausted/u);
    f.scripted.idleBehaviors.delete(threadId);
    const recovered = succeeded(await f.dispatch('list_agents', {runId: started.runId}));
    assert.deepEqual(recovered.completion, {status: 'ready', reportPath: f.reportPath});
    assert.equal((await f.host.manager.prepareMaintenance({stopBackgroundAgents: false})).status, 'ready');
});

test('an incomplete Reviewer paused at its threshold ends through user interruption without fabricating a report', async t => {
    const f = await fixture(t,undefined,undefined,{backgroundAgent:{earlyExitNotificationThreshold:1}});
    const started = succeeded(await f.dispatch('spawn_agent', f.handoff));
    await f.host.manager.owned(String(started.runId), 'main-session', 'main-session').work;
    const active = succeeded(await f.dispatch('list_agents', {runId: started.runId}));
    const threadId = String(active.threadId);
    f.scripted.backgroundTerminals.set(threadId, new Set(['notification-client']));
    f.scripted.finish(threadId, '{"status":"incomplete","reason":"The required input is absent."}');
    const paused = succeeded(await f.dispatch('list_agents', {runId: started.runId}));
    assert.equal(paused.completion,null);
    const notices = succeeded(await f.dispatch('messages', {runId: started.runId,direction:'agent-to-main'}));
    assert.ok(Array.isArray(notices.messages));
    assert.equal(notices.messages.length,1);
    assert.ok(isJsonObject(notices.messages[0]));
    assert.match(String(notices.messages[0].preview),/Reviewer runtime paused/u);
    const noticeIds = notices.messages.map(message => isJsonObject(message) ? message.messageId : null);
    const instructions = succeeded(await f.dispatch('messages', {runId: started.runId,direction:'main-to-agent'}));
    assert.ok(Array.isArray(instructions.messages));
    const instructionIds = instructions.messages.map(message => isJsonObject(message) ? message.messageId : null);
    succeeded(await f.dispatch('interrupt_agent', {runId: started.runId,turnId:paused.turnId}));
    const completed = succeeded(await f.dispatch('list_agents', {runId:started.runId}));
    assert.ok(isJsonObject(completed.completion));
    assert.equal(completed.completion?.status, 'incomplete');
    assert.match(String(completed.completion.reason),/interrupted/u);
    f.scripted.finish(threadId);
    await f.host.manager.serial(async () => {});
    const late = succeeded(await f.dispatch('list_agents', {runId:started.runId}));
    assert.deepEqual([late.runId,late.threadId,late.turnId],[started.runId,threadId,paused.turnId]);
    assert.equal(late.taskState,'ended');
    assert.deepEqual(late.completion,completed.completion);
    const after = succeeded(await f.dispatch('messages', {runId: started.runId,direction:'agent-to-main'}));
    assert.ok(Array.isArray(after.messages));
    assert.deepEqual(after.messages.map(message => isJsonObject(message) ? message.messageId : null),noticeIds);
    const afterInstructions = succeeded(await f.dispatch('messages', {runId: started.runId,direction:'main-to-agent'}));
    assert.ok(Array.isArray(afterInstructions.messages));
    assert.deepEqual(afterInstructions.messages.map(message => isJsonObject(message) ? message.messageId : null),instructionIds);
    assert.equal(await readFile(f.reportPath, 'utf8'), '');
    assert.equal(f.scripted.backgroundTerminals.get(threadId)?.size ?? 0, 0);
    assert.equal((await f.host.manager.prepareMaintenance({stopBackgroundAgents: false})).status, 'ready');
});

test('safe maintenance waits between Reviewer terminal exit and durable completion', async t => {
    const f = await fixture(t);
    const started = succeeded(await f.dispatch('spawn_agent', f.handoff));
    await f.host.manager.owned(String(started.runId), 'main-session', 'main-session').work;
    const active = succeeded(await f.dispatch('list_agents', {runId: started.runId}));
    const threadId = String(active.threadId);
    /** @type {()=>void} */ let entered = () => {};
    /** @type {()=>void} */ let release = () => {};
    const cleanupEntered = new Promise(resolve => {entered = () => resolve(undefined);});
    const cleanupGate = new Promise(resolve => {release = () => resolve(undefined);});
    f.scripted.backgroundTerminals.set(threadId, new Set(['notification-client']));
    f.scripted.afterCleanupBehaviors.set(threadId, async () => {entered(); await cleanupGate;});
    await writeFile(f.reportPath, 'A complete report.');
    f.scripted.finish(threadId);
    await cleanupEntered;
    assert.equal(f.scripted.backgroundTerminals.get(threadId)?.size ?? 0, 0);
    let maintenanceSettled = false;
    const maintenance = f.host.manager.prepareMaintenance({stopBackgroundAgents: false})
        .then(result => {maintenanceSettled = true; return result;});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(maintenanceSettled, false);
    release();
    assert.equal((await maintenance).status, 'ready');
    const completed = succeeded(await f.dispatch('list_agents', {runId: started.runId}));
    assert.deepEqual(completed.completion, {status: 'ready', reportPath: f.reportPath});
});

test('a confirmed quiet unload retires Reviewer control while cold status and follow-up keep its run and thread', async t => {
    const f = await fixture(t);
    const started = succeeded(await f.dispatch('spawn_agent', f.handoff));
    await f.host.manager.owned(String(started.runId), 'main-session', 'main-session').work;
    const active = succeeded(await f.dispatch('list_agents', {runId: started.runId}));
    const threadId = String(active.threadId);
    const managed = f.host.manager.owned(String(started.runId), 'main-session', 'main-session');
    const listener = managed.onNotification;
    await f.host.manager.proxy(f.host.manager.owned(String(started.runId), 'main-session', 'main-session')).stop();
    const stopped = succeeded(await f.dispatch('list_agents', {runId: started.runId}));
    assert.equal(stopped.state, 'exited');
    assert.ok(isJsonObject(stopped.completion));
    assert.equal(stopped.completion.status, 'incomplete');
    assert.notEqual(managed.onNotification, listener);
    const nextReport = await prepareReport(f.repositoryRoot, 'after-unload');
    const next = succeeded(await f.dispatch('followup_task', {...f.handoff,runId: started.runId,
        writePaths: [dirname(nextReport)], reportPath: nextReport,handoff: 'Review a complete new input.'}));
    await f.host.manager.owned(String(started.runId), 'main-session', 'main-session').work;
    const resumed = succeeded(await f.dispatch('list_agents', {runId: started.runId}));
    assert.equal(next.runId, started.runId);
    assert.equal(resumed.threadId, threadId);
    assert.equal(f.scripted.calls.filter(call => call.operation === 'start').length, 1);
});

test('a held wait cannot close the Reviewer runtime reused by a concurrent follow-up', async t => {
    const f = await fixture(t);
    const started = succeeded(await f.dispatch('spawn_agent', f.handoff));
    await f.host.manager.owned(String(started.runId), 'main-session', 'main-session').work;
    const active = succeeded(await f.dispatch('list_agents', {runId: started.runId}));
    const runId = String(started.runId), threadId = String(active.threadId);
    const managed = f.host.manager.owned(runId, 'main-session', 'main-session');
    const listener = managed.onNotification;
    /** @type {()=>void} */ let release = () => {};
    /** @type {()=>void} */ let entered = () => {};
    const gate = new Promise(resolve => {release = () => resolve(undefined);});
    const emitting = new Promise(resolve => {entered = () => resolve(undefined);});
    const waiting = f.dispatch('wait_agent', {runId,cursor: active.cursor}, 'main-session', async () => {entered();await gate;});
    succeeded(await f.dispatch('send_message', {runId,message: 'A progress notice.'}, threadId));
    await emitting;
    await writeFile(f.reportPath, 'First complete report.');
    f.scripted.finish(threadId);
    const completed = succeeded(await f.dispatch('list_agents', {runId}));
    assert.ok(isJsonObject(completed.completion));
    assert.equal(completed.completion.status, 'ready');
    assert.notEqual(managed.onNotification, listener);
    const nextReport = await prepareReport(f.repositoryRoot, 'concurrent-followup');
    const accepted = succeeded(await f.dispatch('followup_task', {...f.handoff,runId,
        writePaths: [dirname(nextReport)], reportPath: nextReport,handoff: 'Review the next input.'}));
    assert.equal(accepted.runId, runId);
    release();
    succeeded(await waiting);
    await f.host.manager.owned(runId, 'main-session', 'main-session').work;
    const resumed = succeeded(await f.dispatch('list_agents', {runId}));
    assert.equal(resumed.threadId, threadId);
    assert.equal(resumed.state, 'running');
    assert.equal(f.scripted.sessions.length, 2);
});

test('cold Reviewer status restores exact reports and unfinished measurement without native work', async t => {
    const f = await fixture(t);
    const first = succeeded(await f.dispatch('spawn_agent', f.handoff));
    await f.host.manager.owned(String(first.runId), 'main-session', 'main-session').work;
    const firstActive = succeeded(await f.dispatch('list_agents', {runId: first.runId}));
    await writeFile(f.reportPath, 'Complete report from the original Reviewer.');
    f.scripted.finish(String(firstActive.threadId));
    const ready = succeeded(await f.dispatch('list_agents', {runId: first.runId}));
    assert.ok(isJsonObject(ready.completion));
    assert.equal(ready.completion.status, 'ready');
    await f.host.manager.proxy(f.host.manager.owned(String(first.runId), 'main-session', 'main-session')).stop();
    const secondReport = await prepareReport(f.repositoryRoot, 'unfinished');
    const second = succeeded(await f.dispatch('spawn_agent', {...f.handoff,
        identity: {kind: 'isolated', instanceId: 'unfinished'}, writePaths: [dirname(secondReport)], reportPath: secondReport}));
    await f.host.manager.owned(String(second.runId), 'main-session', 'main-session').work;
    const secondActive = succeeded(await f.dispatch('list_agents', {runId: second.runId}));
    assert.equal(secondActive.state, 'running');
    await f.host.manager.stateStore.flush();
    let opened = 0;
    const coldNative = /** @type {NativeSessions} */ ({
        async ensureServer() {throw new Error('Observation must not start a native server.');},
        async observeServer() {return 'absent';},
        async close() {return {environmentState: 'exited', previousProcessState: 'ended'};},
        async open() {opened++;throw new Error('Observation must not open a native thread.');},
    });
    const cold = await createBackgroundAgentHost({installationDirectory: f.installationDirectory,
        programDirectory: f.programDirectory, nativeSessions: coldNative});
    try {
        const dispatch = (/** @type {string} */ operation, /** @type {string} */ runId) => cold.dispatch({
            ownerId: 'main-session', caller: {repositoryRoot: f.repositoryRoot,programDirectory: f.programDirectory},
            operation,input: {runId},
        });
        const completed = succeeded(await dispatch('list_agents', String(first.runId)));
        assert.ok(isJsonObject(completed.measurement));
        assert.ok(isJsonObject(ready.measurement));
        assert.deepEqual(completed.completion, ready.completion);
        assert.deepEqual(completed.measurement.usage, ready.measurement.usage);
        assert.equal(completed.recoveryPath, ready.recoveryPath);
        const unfinished = succeeded(await dispatch('wait_agent', String(second.runId)));
        assert.ok(isJsonObject(unfinished.completion));
        assert.ok(isJsonObject(unfinished.measurement));
        assert.equal(unfinished.state, 'exited');
        assert.equal(unfinished.completion.status, 'incomplete');
        assert.equal(unfinished.measurement.wallClockMs, null);
        assert.equal(unfinished.recoveryPath, secondActive.recoveryPath);
        assert.equal(opened, 0);
    } finally {await cold.manager.close();}
});

test('Reviewer keeps current-turn settings and adopts user configuration only for a complete follow-up task', async t => {
    const f = await fixture(t);
    /** @param {'a'|'b'} suffix @param {'default'|'fast'} serviceTier */
    const writeConfiguration = async (suffix, serviceTier) => {
        await writeFile(join(f.programDirectory, 'config.json'), JSON.stringify({
            configVersion: 3, agents: {}, editor: {command: 'code', args: ['{file}']},
            reviewEditor: {command: 'code', args: ['{file}']}, jira: {listLimit: 50},
            reviewers: {'requirements-reviewer': {modelProvider: `provider-${suffix}`,
                reasoningEffort: suffix === 'a' ? 'high' : 'low', serviceTier}},
        }));
        await writeFile(join(f.repositoryRoot, 'arw.config.json'), JSON.stringify({
            configVersion: 2, reviewers: {'requirements-reviewer': {model: `repository-model-${suffix}`}},
        }));
    };
    await writeConfiguration('a', 'default');
    const started = succeeded(await f.dispatch('spawn_agent', f.handoff));
    const runId = String(started.runId);
    await f.host.manager.owned(runId, 'main-session', 'main-session').work;
    const active = succeeded(await f.dispatch('list_agents', {runId}));
    const threadId = String(active.threadId);
    const original = f.scripted.sessions.at(-1)?.input.settings;
    assert.equal(original?.model, 'repository-model-a');
    assert.equal(original?.serviceTier, 'default');
    await writeConfiguration('b', 'fast');
    succeeded(await f.dispatch('list_agents', {runId}));
    assert.equal(f.scripted.sessions.at(-1)?.input.settings.model, 'repository-model-a');
    assert.equal(f.scripted.sessions.at(-1)?.input.settings.serviceTier, 'default');
    failed(await f.dispatch('followup_task', {...f.handoff, runId, settings: {model: 'override'}}));
    failed(await f.dispatch('followup_task', {...f.handoff, runId}));
    await writeFile(f.reportPath, 'First full report.');
    f.scripted.finish(threadId);
    assert.ok(succeeded(await f.dispatch('list_agents', {runId})).completion);
    const entry = f.host.manager.owned(runId, 'main-session', 'main-session');
    await f.host.manager.proxy(entry).stop();
    await f.host.manager.stateStore.flush();
    await f.host.manager.serial(async () => {});
    const nextReport = await prepareReport(f.repositoryRoot, 'next');
    const accepted = succeeded(await f.dispatch('followup_task', {...f.handoff, runId, writePaths: [dirname(nextReport)], reportPath: nextReport, handoff: 'Review the next complete input.'}));
    assert.equal(accepted.runId, runId);
    await f.host.manager.owned(runId, 'main-session', 'main-session').work;
    const next = succeeded(await f.dispatch('list_agents', {runId}));
    assert.equal(next.state,'running',JSON.stringify({next,calls:f.scripted.calls,sessions:f.scripted.sessions.map(item=>({root:item.rootThreadId,state:item.environmentState}))}));
    assert.equal(next.threadId, threadId);
    assert.equal(f.scripted.sessions.at(-1)?.input.settings.model, 'repository-model-b');
    assert.equal(f.scripted.sessions.at(-1)?.input.settings.serviceTier, 'fast');
    assert.equal(f.scripted.calls.filter(call => call.operation === 'start').length, 1);
    assert.equal(f.scripted.calls.filter(call => call.operation === 'startTurn').length, 2);
});


test('Strata rejected undeclared tool response receives concrete feedback and completes its original task', async t => {
    const serviceDirectory = await createTemporaryDirectory(t, 'arw-strata-rejected-tool-');
    await mkdir(join(serviceDirectory, 'config'));
    await writeFile(join(serviceDirectory, 'config', 'compact_prompt.txt'), 'Summarize the current task without calling tools.');
    let model = /** @type {string|null} */ (null);
    const driver = /** @type {NonNullable<Parameters<typeof fixture>[2]>} */ (/** @type {unknown} */ (() => ({
        async connect() {return {controllerUrl:'http://offline-controller',responsesUrl:'http://offline-responses/v1'};},
        async acquire() {return {leaseKey:'offline-lease'};},
        async status() {return {status:model ? 'running' : 'stopped',model};},
        async start(/** @type {{modelId:string}} */ input) {model=input.modelId;},
        async stop() {model=null;return {status:'stopped',cleanUnload:true};},
        async release() {},
    })));
    const f = await fixture(t, {strata:{driver:'strata',installationDirectory:serviceDirectory}}, driver, {
        reviewers:{'requirements-reviewer':{model:'qwen3.8-flash-next-q2_0',modelProvider:'strata',reasoningEffort:'high',serviceTier:'default'}},
    });
    const accepted = succeeded(await f.dispatch('spawn_agent',f.handoff));
    await f.host.manager.owned(String(accepted.runId),'main-session','main-session').work;
    const initial = succeeded(await f.dispatch('list_agents',{runId:accepted.runId}));
    assert.ok(isJsonObject(initial.measurement));
    const startedAt = initial.measurement.startedAt;
    const root = f.scripted.members.get(String(initial.threadId));assert.ok(root);
    root.usage=createUsage(20);
    root.state='failed';root.turnStatus='failed';root.finalResponse=null;
    root.turnError={message:'stream disconnected before completion: [invalid_response] Model returned unknown tool: exec_command',codexErrorInfo:'other'};
    const continuing = succeeded(await f.dispatch('list_agents',{runId:accepted.runId}));
    assert.equal(continuing.completion,null);
    assert.equal(continuing.threadId,initial.threadId);
    assert.equal(continuing.runId,accepted.runId);
    assert.ok(isJsonObject(continuing.measurement));
    assert.equal(continuing.measurement.startedAt,startedAt);
    assert.ok(isJsonObject(continuing.measurement.usage));
    assert.equal(continuing.measurement.usage.totalTokens,20);
    const feedback = f.scripted.calls.find(call=>call.operation==='startTurn' && call.turnId===continuing.turnId)?.text;
    assert.equal(typeof feedback,'string');
    assert.match(String(feedback),/\[invalid_response\] Model returned unknown tool: exec_command/);
    assert.match(String(feedback),/rejected.*before execution/);
    assert.match(String(feedback),/only tools declared for the current request/);
    root.turnError=null;root.turnStatus='completed';root.usage=createUsage(35);
    await writeFile(f.reportPath,'No findings.\n');
    f.scripted.finish(root.threadId);
    const completed = succeeded(await f.dispatch('list_agents',{runId:accepted.runId}));
    assert.ok(isJsonObject(completed.completion));
    assert.deepEqual(completed.completion,{status:'ready',reportPath:f.reportPath});
    assert.equal(completed.runId,accepted.runId);assert.equal(completed.threadId,initial.threadId);
    assert.ok(isJsonObject(completed.measurement));assert.equal(completed.measurement.startedAt,startedAt);
    assert.ok(isJsonObject(completed.measurement.usage));assert.equal(completed.measurement.usage.totalTokens,35);
});

test('a non-Strata Reviewer resumes its original task through ordinary messages after each early-exit pause',async t=>{
    const f=await earlyExitFixture(t);
    await writeFile(f.reportPath,Buffer.from([0xc3,0x28]));
    const unreadable=await finishEarly(f,t);assert.notEqual(unreadable.current.turnId,unreadable.previous);
    const feedback=succeeded(await f.dispatch('messages',{runId:f.runId,direction:'main-to-agent',limit:3}));
    assert.ok(Array.isArray(feedback.messages));
    assert.ok(feedback.messages.some(item=>isJsonObject(item)&&item.deliveryStatus==='delivered'
        &&String(item.preview).includes('filesystem-text-decoding-failed')));
    assert.equal((await pauseNotices(f)).length,0);
    await writeFile(f.reportPath,'');
    const first=await finishEarly(f,t,'{"status":"incomplete","reason":"The original review remains unfinished."}');assert.notEqual(first.current.turnId,first.previous);
    assert.equal((await pauseNotices(f)).length,0);
    const second=await finishEarly(f,t);assert.equal(second.current.turnId,second.previous);
    const firstNotices=await pauseNotices(f);assert.equal(firstNotices.length,1);
    assert.match(String(firstNotices[0].preview),/after 2 normally completed turns/u);
    const pausedWork=measurement(second.current).workDuration.durationMs;
    t.mock.timers.tick(10_000);
    const waiting=succeeded(await f.dispatch('list_agents',{runId:f.runId}));
    assert.equal(waiting.turnId,second.current.turnId);assert.equal(waiting.completion,null);
    assert.equal(measurement(waiting).workDuration.durationMs,pausedWork);
    const receipt=succeeded(await f.dispatch('send_message',{runId:f.runId,message:'Additional evidence is available.'}));
    assert.equal(receipt.deliveryStatus,'accepted');
    const resumed=succeeded(await f.dispatch('list_agents',{runId:f.runId}));
    assert.notEqual(resumed.turnId,second.current.turnId);assert.equal(resumed.threadId,f.threadId);
    assert.equal(measurement(resumed).startedAt,f.startedAt);
    for(let index=0;index<5;index++){
        const step=await finishEarly(f,t);
        if(index<4)assert.notEqual(step.current.turnId,step.previous);
        else assert.equal(step.current.turnId,step.previous);
    }
    const notices=await pauseNotices(f);assert.equal(notices.length,2);
    assert.match(String(notices[0].preview),/after 7 normally completed turns/u);
    t.mock.timers.tick(5_000);
    succeeded(await f.dispatch('send_message',{runId:f.runId,message:'Additional evidence is available.'}));
    await f.dispatch('list_agents',{runId:f.runId});
    f.root.usage=createUsage(90);t.mock.timers.tick(100);
    await writeFile(f.reportPath,'No findings.\n');f.scripted.finish(f.threadId);
    const completed=succeeded(await f.dispatch('list_agents',{runId:f.runId}));
    assert.deepEqual(completed.completion,{status:'ready',reportPath:f.reportPath});
    assert.equal(completed.runId,f.runId);assert.equal(completed.threadId,f.threadId);
    assert.equal(measurement(completed).startedAt,f.startedAt);assert.equal(measurement(completed).usage.totalTokens,90);
    assert.equal(measurement(completed).wallClockMs,15_900);assert.equal(measurement(completed).workDuration.durationMs,900);
    assert.equal(await readFile(f.reportPath,'utf8'),'No findings.\n');
});

test('a cold paused Reviewer retains its early-exit count and does not replay ended turns or pause notices',async t=>{
    const f=await earlyExitFixture(t);
    await finishEarly(f,t);const paused=(await finishEarly(f,t)).current;
    assert.equal((await pauseNotices(f)).length,1);
    await f.host.manager.stateStore.flush();await f.host.manager.close();
    const nativeSessions=/** @type {NativeSessions} */({...f.nativeSessions,async close(){
        f.scripted.exit();await f.nativeSessions.close();return{environmentState:'exited',previousProcessState:'ended'};
    }});
    const cold=await createBackgroundAgentHost({installationDirectory:f.installationDirectory,programDirectory:f.programDirectory,nativeSessions});
    try{
        f.dispatch=(operation,input,ownerId='main-session',emit=undefined)=>cold.dispatch({ownerId,
            caller:{repositoryRoot:f.repositoryRoot,programDirectory:f.programDirectory},operation,input,emit});
        t.mock.timers.tick(10_000);
        const observed=succeeded(await f.dispatch('list_agents',{runId:f.runId}));
        assert.equal(observed.threadId,f.threadId);assert.equal(observed.completion,null);
        assert.equal(measurement(observed).startedAt,f.startedAt);
        assert.equal(measurement(observed).workDuration.durationMs,measurement(paused).workDuration.durationMs);
        await f.dispatch('list_agents',{runId:f.runId});assert.equal((await pauseNotices(f)).length,1);
        succeeded(await f.dispatch('send_message',{runId:f.runId,message:'Additional evidence is available.'}));
        const resumed=succeeded(await f.dispatch('list_agents',{runId:f.runId}));
        assert.notEqual(resumed.turnId,paused.turnId);assert.equal(resumed.threadId,f.threadId);
        assert.equal(measurement(resumed).startedAt,f.startedAt);
        for(let index=0;index<5;index++){
            f.scripted.emit(f.threadId);await f.dispatch('list_agents',{runId:f.runId});
            const step=await finishEarly(f,t);
            if(index<4){assert.notEqual(step.current.turnId,step.previous);assert.equal((await pauseNotices(f)).length,1);}
            else assert.equal(step.current.turnId,step.previous);
        }
        const notices=await pauseNotices(f);assert.equal(notices.length,2);
        assert.match(String(notices[0].preview),/after 7 normally completed turns/u);
        succeeded(await f.dispatch('send_message',{runId:f.runId,message:'Additional evidence is available.'}));
        await f.dispatch('list_agents',{runId:f.runId});
        await writeFile(f.reportPath,'No findings.\n');f.scripted.finish(f.threadId);
        const completed=succeeded(await f.dispatch('list_agents',{runId:f.runId}));
        assert.deepEqual(completed.completion,{status:'ready',reportPath:f.reportPath});
        assert.equal(completed.threadId,f.threadId);assert.equal(measurement(completed).usage.totalTokens,70);
    }finally{await cold.manager.close();}
});
