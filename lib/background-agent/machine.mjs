import {assertExactKeys} from '../common/canonical-contract.mjs';
import {isJsonObject} from '../common/json.mjs';
/** @typedef {{code: string, message: string}} MachineError */
/** @typedef {{status: 'succeeded', result: unknown} | {status: 'failed', error: MachineError}} RuntimeResult */
/** @typedef {{execute: (request: {operation: string, input: Record<string, unknown>}) => Promise<RuntimeResult>, wait?: (request: {input:Record<string,unknown>,signal:AbortSignal})=>Promise<RuntimeResult>, close: () => Promise<RuntimeResult>}} MachineRuntime */
/** @typedef {{input?: import('node:stream').Readable, output?: import('node:stream').Writable, errorOutput?: import('node:stream').Writable, runtime: MachineRuntime, signals?: import('node:events').EventEmitter, waitForCompletion?: boolean}} MachineOptions */

const OPERATIONS = new Set(['spawn_agent', 'followup_task', 'send_message', 'wait_agent', 'interrupt_agent', 'unload_agent', 'list_agents', 'messages', 'respond']);
const errorMessage = (/** @type {unknown} */ error) => error instanceof Error ? error.message : String(error);
const write = (/** @type {import('node:stream').Writable} */ stream, /** @type {string} */ text) => new Promise((resolve, reject) => {
    stream.write(text, error => error ? reject(error) : resolve(undefined));
});

/**
 * 保留一个 JSONL 机器会话. 等待请求独立执行, 因而不会阻塞同一会话中的指示.
 * EOF 后先等未返回的请求 (含 `wait_agent`) 写出响应再关闭本控制连接; 终止信号取消等待. 后台运行仍由管理进程持有.
 * @param {MachineOptions} options
 * @returns {Promise<number>}
 */
export const runBackgroundAgent = async ({
    input = process.stdin,
    output = process.stdout,
    errorOutput = process.stderr,
    runtime,
    signals = process,
    waitForCompletion = false,
}) => {
    /** @type {Set<string>} */
    const ids = new Set();
    /** @type {Set<Promise<void>>} */
    const pending = new Set();
    /** @type {Promise<RuntimeResult> | undefined} */
    let closing;
    /** @type {unknown} */
    let fatal;
    let terminating = false;
    let outputQueue = Promise.resolve();
    const waiting = new AbortController();
    const close = () => {
        waiting.abort();
        closing ??= Promise.resolve().then(() => runtime.close());
        return closing;
    };
    const failOutput = (/** @type {Error} */ error) => {
        fatal ??= error;
        input.destroy(error);
    };
    const ignoreDiagnosticError = () => {};
    const terminate = () => {
        terminating = true;
        void close().catch(error => { fatal ??= error; });
        input.destroy();
    };
    output.on('error', failOutput);
    errorOutput.on('error', ignoreDiagnosticError);
    signals.on('SIGINT', terminate);
    signals.on('SIGTERM', terminate);

    const respond = (/** @type {unknown} */ response) => {
        const task = outputQueue.then(() => write(output, `${JSON.stringify(response)}\n`));
        outputQueue = task.catch(error => { failOutput(error); });
        return task;
    };
    const dispatch = (/** @type {string} */ line) => {
        /** @type {string | null} */
        let id = null;
        /** @type {{operation: string, input: Record<string, unknown>} | undefined} */
        let request;
        /** @type {MachineError | undefined} */
        let requestError;
        try {
            const value = JSON.parse(line);
            if (isJsonObject(value) && typeof value.id === 'string' && value.id.length > 0) id = value.id;
            if (id !== null && ids.has(id)) {
                requestError = {code: 'background-agent-request-duplicate', message: 'Request id was already used in this machine session.'};
            } else {
                if (id !== null) ids.add(id);
                assertExactKeys(value, ['id', 'operation', 'input'], 'Machine request');
                if (id === null) throw new Error('Request id must be a non-empty string.');
                if (typeof value.operation !== 'string' || !OPERATIONS.has(value.operation)) {
                    requestError = {code: 'background-agent-operation-unsupported', message: 'Unsupported background Agent operation.'};
                } else if (!isJsonObject(value.input)) {
                    throw new Error('Request input must be an object.');
                } else {
                    request = {operation: value.operation, input: value.input};
                }
            }
        } catch (error) {
            requestError = {code: 'background-agent-request-invalid', message: errorMessage(error)};
        }
        const task = (async () => {
            if (requestError) {
                await respond({id, ok: false, error: requestError});
                return;
            }
            if (!request) return;
            /** @type {RuntimeResult} */
            let result;
            const deliver = (/** @type {RuntimeResult} */ value) => respond(value.status === 'succeeded'
                ? {id, ok: true, result: value.result}
                : {id, ok: false, error: value.error});
            try {
                result = request.operation === 'wait_agent' && runtime.wait
                    ? await runtime.wait({input:request.input,signal:waiting.signal})
                    : await runtime.execute(request);
            } catch (error) {
                result = {status: 'failed', error: {code: 'background-agent-operation-failed', message: errorMessage(error)}};
            }
            await deliver(result);
            if (!waitForCompletion || !runtime.wait || result.status !== 'succeeded' || !['spawn_agent', 'followup_task'].includes(request.operation)) return;
            // `--wait`: follow this run until its Reviewer round has a completion or a program pause notice, then report it once with every message collected.
            const runId = /** @type {{runId: string}} */ (result.result).runId;
            let cursor = 0;
            /** @type {Array<{messageId?: string, source?: string, text?: string}>} */
            const messages = [];
            for (;;) {
                const waited = await runtime.wait({input: {runId, cursor, timeout_ms: 3600000}, signal: waiting.signal});
                const value = /** @type {{cancelled?: boolean, completion?: unknown, cursor: number, notifications?: Array<{type: string, messageId?: string, source?: string, text?: string}>, providerError?: unknown, state?: string}} */ (waited.status === 'succeeded' ? waited.result : {});
                for (const {type, messageId, source, text} of value.notifications ?? []) if (type === 'message') messages.push({messageId, source, text});
                const paused = messages.some(message => message.source === 'provider-program');
                const abortedByCaller = value.cancelled && waiting.signal.aborted;
                if (waited.status === 'failed') {
                    await respond({id: `${id}:done`, ok: false, error: waited.error});
                    return;
                }
                if (value.completion || paused || abortedByCaller) {
                    await respond({id: `${id}:done`, ok: true, result: {runId, state: value.state, completion: value.completion ?? null, messages, providerError: value.providerError ?? null}});
                    return;
                }
                if (value.state === 'exited') {
                    await respond({id: `${id}:done`, ok: false, error: {code: 'reviewer-not-ready', message: `Run ${runId} ended in state ${value.state} without a completion (providerError: ${JSON.stringify(value.providerError ?? null)}); the review did not finish.`}});
                    return;
                }
                // A cancelled result without the caller's own abort is a stray wait cancellation; the review is still running.
                cursor = value.cursor;
            }
        })().catch(error => { fatal ??= error; input.destroy(); });
        pending.add(task);
        void task.then(() => { pending.delete(task); });
    };

    try {
        const decoder = new TextDecoder('utf-8', {fatal: true});
        let remaining = '';
        for await (const chunk of input) {
            remaining += typeof chunk === 'string' ? chunk : decoder.decode(chunk, {stream: true});
            let newline;
            while ((newline = remaining.indexOf('\n')) !== -1) {
                dispatch(remaining.slice(0, newline));
                remaining = remaining.slice(newline + 1);
            }
        }
        remaining += decoder.decode();
        if (remaining.length > 0) dispatch(remaining);
    } catch (error) {
        if (!terminating) fatal ??= error;
    } finally {
        if (!terminating) await Promise.all(pending);
        try {
            const result = await close();
            if (result.status === 'failed') fatal ??= new Error(result.error.message);
        } catch (error) {
            fatal ??= error;
        }
        await Promise.all(pending);
        await outputQueue;
        signals.off('SIGINT', terminate);
        signals.off('SIGTERM', terminate);
        output.off('error', failOutput);
    }
    try {
        if (fatal !== undefined) await write(errorOutput, `background-agent-failed: ${errorMessage(fatal)}\n`);
    } catch {
        fatal ??= new Error('Machine diagnostic output failed.');
    } finally {
        errorOutput.off('error', ignoreDiagnosticError);
    }
    return fatal === undefined ? 0 : 1;
};
