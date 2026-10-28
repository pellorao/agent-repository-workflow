import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough, Readable, Writable} from 'node:stream';
import test from 'node:test';

import {runBackgroundAgent} from '../../lib/background-agent/machine.mjs';

/** @typedef {NonNullable<Parameters<typeof runBackgroundAgent>[0]>} MachineOptions */
/** @typedef {NonNullable<MachineOptions['runtime']>} MachineRuntime */
/** @typedef {Awaited<ReturnType<MachineRuntime['execute']>>} RuntimeResult */

const flush = () => new Promise(resolve => setImmediate(resolve));
const request = (/** @type {string} */ id, /** @type {string} */ operation, input = {}) => `${JSON.stringify({id, operation, input})}\n`;
const capture = () => {
    /** @type {Array<Record<string, unknown>>} */
    const responses = [];
    let diagnostics = '';
    const output = new Writable({write(chunk, _encoding, callback) {
        responses.push(JSON.parse(chunk.toString('utf8')));
        callback();
    }});
    const errorOutput = new Writable({write(chunk, _encoding, callback) {
        diagnostics += chunk.toString('utf8');
        callback();
    }});
    return {output, errorOutput, responses, diagnostics: () => diagnostics, signals: new EventEmitter()};
};

test('wait returns one update batch while independent instructions remain usable and cancellation only ends a wait', async () => {
    const peer = capture();
    const input = new PassThrough();
    let waits = 0;
    let cancelled = false;
    /** @type {string[]} */
    const operations = [];
    /** @type {MachineRuntime} */
    const runtime = {
        async execute({operation}) { operations.push(operation); return {status:'succeeded',result:{accepted:true}}; },
        async wait({signal}) {
            if (++waits === 1) return {status:'succeeded',result:{cursor:2,notifications:['first progress','second progress']}};
            await new Promise(resolve => {
                if (signal.aborted) resolve(undefined);
                else signal.addEventListener('abort',() => resolve(undefined),{once:true});
            });
            cancelled = true;
            return {status:'succeeded',result:{cancelled:true}};
        },
        async close() {return {status:'succeeded',result:{closed:true}};},
    };
    const machine = runBackgroundAgent({...peer,input,runtime});
    input.write(request('update','wait_agent',{runId:'run',cursor:0}));
    await flush();
    assert.equal(peer.responses.length,1);
    assert.deepEqual(peer.responses[0],{id:'update',ok:true,result:{cursor:2,notifications:['first progress','second progress']}});
    input.write(request('pending','wait_agent',{runId:'run',cursor:2}));
    input.write(request('instruction','send_message',{runId:'run',message:'continue'}));
    await flush();
    assert.equal(peer.responses[1].id,'instruction');
    assert.equal(cancelled,false);
    peer.signals.emit('SIGTERM');
    assert.equal(await machine,0);
    assert.equal(cancelled,true);
    assert.deepEqual(operations,['send_message']);
});

test('machine session accepts later instructions while waits remain active and lets them finish after EOF', async () => {
    const peer = capture();
    const input = new PassThrough();
    /** @type {Array<{operation: string, input: Record<string, unknown>}>} */
    const received = [];
    /** @type {((result: RuntimeResult) => void) | undefined} */
    let finishWait;
    let closes = 0;
    /** @type {MachineRuntime} */
    const runtime = {
        async execute(message) {
            received.push(message);
            if (message.operation === 'wait_agent') return await new Promise(resolve => { finishWait = resolve; });
            if (message.operation === 'send_message') finishWait?.({status: 'succeeded', result: {state: 'running', cursor: 1, notifications: ['progress']}});
            return {status: 'succeeded', result: {accepted: true}};
        },
        async close() {
            closes++;
            finishWait?.({status: 'failed', error: {code: 'runtime-closed', message: 'Runtime closed.'}});
            return {status: 'succeeded', result: {closed: true}};
        },
    };
    const running = runBackgroundAgent({...peer, input, runtime});
    input.write(request('wait-one', 'wait_agent', {runId: 'run', cursor: 0, timeout_ms: 60000}));
    await flush();
    assert.equal(received.length, 1);
    assert.equal(peer.responses.length, 0);
    const instruction = Buffer.from(request('send-one', 'send_message', {runId: 'run', turnId: 'turn', message: '继续审核'}));
    const split = instruction.indexOf(Buffer.from('继')) + 1;
    input.write(instruction.subarray(0, split));
    input.write(instruction.subarray(split));
    await flush();
    assert.deepEqual(new Set(peer.responses.map(response => response.id)), new Set(['wait-one', 'send-one']));
    assert.deepEqual(received[1], {operation: 'send_message', input: {runId: 'run', turnId: 'turn', message: '继续审核'}});
    input.write(request('wait-two', 'wait_agent', {runId: 'run', cursor: 1, timeout_ms: 60000}));
    await flush();
    input.end();
    await flush();
    assert.equal(closes, 0);
    finishWait?.({status: 'succeeded', result: {state: 'completed', cursor: 2, notifications: []}});
    assert.equal(await running, 0);
    assert.equal(closes, 1);
    assert.deepEqual(peer.responses.at(-1), {id: 'wait-two', ok: true, result: {state: 'completed', cursor: 2, notifications: []}});
    assert.equal(peer.diagnostics(), '');
});

test('invalid requests never execute, request failures stay local, and operations preserve JSONL correlation', async () => {
    const peer = capture();
    /** @type {string[]} */
    /** @type {string[]} */
    const operations = [];
    /** @type {MachineRuntime} */
    const runtime = {
        async execute({operation}) {
            operations.push(operation);
            if (operation === 'interrupt_agent') throw new Error('native control failed');
            if (operation === 'followup_task') return {status: 'failed', error: {code: 'task-failed', message: 'Environment still runs.'}};
            return {status: 'succeeded', result: {operation}};
        },
        async close() { return {status: 'succeeded', result: {closed: true}}; },
    };
    const invalid = ['{\n', request('', 'list_agents'), request('unsupported', 'review'), request('array', 'list_agents', []),
        `${JSON.stringify({id: 'extra', operation: 'list_agents', input: {}, extra: true})}\n`];
    const valid = ['spawn_agent', 'followup_task', 'send_message', 'messages', 'list_agents', 'wait_agent', 'respond', 'interrupt_agent'];
    const input = Readable.from([...invalid, ...valid.map(operation => request(operation, operation)), request('list_agents', 'list_agents')]);
    assert.equal(await runBackgroundAgent({...peer, input, runtime}), 0);
    assert.deepEqual(operations, valid);
    assert.equal(peer.responses.length, 14);
    const failed = peer.responses.filter(response => response.ok === false);
    assert.deepEqual(failed.map(response => response.id).sort(), [null, null, 'unsupported', 'array', 'extra', 'list_agents', 'interrupt_agent', 'followup_task'].sort());
    assert.equal(peer.responses.find(response => response.id === 'spawn_agent')?.ok, true);
    assert.deepEqual(peer.responses.find(response => response.id === 'followup_task'), {id: 'followup_task', ok: false,
        error: {code: 'task-failed', message: 'Environment still runs.'}});
    assert.equal(peer.diagnostics(), '');
});

test('invalid UTF-8, stream faults and failed cleanup close the runtime and return machine failure', async () => {
    for (const fault of ['utf8', 'input', 'output', 'close']) {
        const peer = capture();
        const input = fault === 'input' ? new PassThrough()
            : Readable.from([fault === 'utf8' ? Buffer.from([0xc3]) : request('list_agents', 'list_agents')]);
        let closes = 0;
        /** @type {MachineRuntime} */
        const runtime = {
            async execute() { return {status: 'succeeded', result: {state: 'running'}}; },
            async close() {
                closes++;
                return fault === 'close' ? {status: 'failed', error: {code: 'close-failed', message: 'Recovery write failed.'}}
                    : {status: 'succeeded', result: {closed: true}};
            },
        };
        const output = fault === 'output' ? new Writable({write(_chunk, _encoding, callback) { callback(new Error('Output failed.')); }}) : peer.output;
        const running = runBackgroundAgent({...peer, input, output, runtime});
        if (fault === 'input') input.destroy(new Error('Input failed.'));
        assert.equal(await running, 1, fault);
        assert.equal(closes, 1, fault);
        assert.match(peer.diagnostics(), /^background-agent-failed: /u, fault);
    }
});

test('termination closes the held runtime once and preserves cleanup failures', async () => {
    for (const failed of [false, true]) {
        const peer = capture();
        const input = new PassThrough();
        let closes = 0;
        /** @type {MachineRuntime} */
        const runtime = {
            async execute() { return {status: 'succeeded', result: {}}; },
            async close() {
                closes++;
                return failed ? {status: 'failed', error: {code: 'task-failed', message: 'Stop failed.'}}
                    : {status: 'succeeded', result: {closed: true}};
            },
        };
        const running = runBackgroundAgent({...peer, input, runtime});
        peer.signals.emit('SIGTERM');
        peer.signals.emit('SIGINT');
        assert.equal(await running, failed ? 1 : 0);
        assert.equal(closes, 1);
        assert.equal(peer.signals.listenerCount('SIGTERM'), 0);
    }
});

test('--wait follows each accepted Reviewer task until a completion or a program pause and reports its messages once', async () => {
    const io = capture();
    /** @type {Record<string, Array<Record<string, unknown>>>} */
    const updates = {
        done: [{cursor: 1, state: 'active'}, {cursor: 2, state: 'idle', completion: {status: 'ready', reportPath: '/r'}}],
        paused: [{cursor: 1, state: 'active', notifications: [{type: 'message', messageId: 'r', source: 'agent', text: 'Issue.'}]},
            {cursor: 2, state: 'idle', notifications: [{type: 'changed'}, {type: 'message', messageId: 'm', source: 'provider-program', text: 'Paused.'}]}],
    };
    const code = await runBackgroundAgent({
        ...io,
        input: Readable.from([request('a', 'spawn_agent'), request('b', 'followup_task'), request('c', 'list_agents')]),
        runtime: {
            async execute(/** @type {{operation: string}} */ {operation}) {
                return /** @type {RuntimeResult} */ ({status: 'succeeded', result: {runId: operation === 'spawn_agent' ? 'done' : 'paused'}});
            },
            async wait({input}) {
                return /** @type {RuntimeResult} */ ({status: 'succeeded', result: updates[String(input.runId)].shift()});
            },
            async close() {
                return {status: 'succeeded', result: null};
            },
        },
        waitForCompletion: true,
    });
    assert.equal(code, 0);
    const done = Object.fromEntries(io.responses.filter(response => String(response.id).endsWith(':done')).map(response => [response.id, response.result]));
    assert.deepEqual(done, {
        'a:done': {runId: 'done', state: 'idle', completion: {status: 'ready', reportPath: '/r'}, messages: [], providerError: null},
        'b:done': {runId: 'paused', state: 'idle', completion: null, providerError: null,
            messages: [{messageId: 'r', source: 'agent', text: 'Issue.'}, {messageId: 'm', source: 'provider-program', text: 'Paused.'}]},
    });
    assert.equal(io.responses.length, 5);
});

test('`--wait` keeps waiting after a stray cancelled wait result and ends on the real completion', async () => {
    const io = capture();
    const updates = [{cursor: 2, cancelled: true}, {cursor: 3, state: 'idle', completion: {status: 'ready', reportPath: '/r'}}];
    const code = await runBackgroundAgent({
        ...io,
        input: Readable.from([request('a', 'spawn_agent')]),
        runtime: {
            async execute() {return /** @type {RuntimeResult} */ ({status: 'succeeded', result: {runId: 'run'}});},
            async wait() {return /** @type {RuntimeResult} */ ({status: 'succeeded', result: updates.shift()});},
            async close() {return {status: 'succeeded', result: null};},
        },
        waitForCompletion: true,
    });
    assert.equal(code, 0);
    assert.deepEqual(io.responses.at(-1), {id: 'a:done', ok: true, result: {runId: 'run', state: 'idle', completion: {status: 'ready', reportPath: '/r'}, messages: [], providerError: null}});
});

test('`--wait` reports `reviewer-not-ready` when the run exits without a completion or a program pause', async () => {
    const io = capture();
    const code = await runBackgroundAgent({
        ...io,
        input: Readable.from([request('a', 'spawn_agent')]),
        runtime: {
            async execute() {return /** @type {RuntimeResult} */ ({status: 'succeeded', result: {runId: 'run'}});},
            async wait() {return /** @type {RuntimeResult} */ ({status: 'succeeded', result: {cursor: 2, state: 'exited', providerError: 'crashed'}});},
            async close() {return {status: 'succeeded', result: null};},
        },
        waitForCompletion: true,
    });
    assert.equal(code, 0);
    const {id, ok, error} = /** @type {{id: string, ok: boolean, error: {code: string, message: string}}} */ (io.responses.at(-1));
    assert.deepEqual({id, ok, code: error.code}, {id: 'a:done', ok: false, code: 'reviewer-not-ready'});
    assert.match(error.message, /exited.*crashed/);
});
