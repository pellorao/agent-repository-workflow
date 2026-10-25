import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {PassThrough} from 'node:stream';
import {isJsonObject,parseJsonText,serializeJson} from '../common/json.mjs';

/** @typedef {{request:(operation:string,input:Record<string,unknown>)=>Promise<Record<string,any>>,close:()=>Promise<void>}} MachineClient */

/** Disconnecting the control stream does not stop background work.
 * @param {(streams:{input:PassThrough,output:PassThrough,errorOutput:PassThrough})=>Promise<unknown>} runMachine
 * @returns {MachineClient}
 */
export const createBackgroundAgentMachineClient = runMachine => {
    const input = new PassThrough();
    const output = new PassThrough();
    const errorOutput = new PassThrough();
    errorOutput.resume();
    /** @type {Map<string,{resolve:(value:Record<string,any>)=>void,reject:(error:Error)=>void}>} */
    const pending = new Map();
    const lines = createInterface({input:output});
    lines.on('line',line => {
        try {
            const parsed = parseJsonText(line);
            if (parsed.status !== 'succeeded' || !isJsonObject(parsed.value)
                || typeof parsed.value.id !== 'string' || typeof parsed.value.ok !== 'boolean') {
                throw new Error('Invalid Background Agent machine response.');
            }
            const response = /** @type {{id:string,ok:boolean,result:Record<string,any>,error?:{message?:string}}} */ (parsed.value);
            const waiting = pending.get(response.id);
            if (!waiting) return;
            pending.delete(response.id);
            if (response.ok) waiting.resolve(response.result);
            else waiting.reject(new Error(response.error?.message ?? 'Background Agent operation failed.'));
        } catch (error) {
            for (const waiting of pending.values()) waiting.reject(error instanceof Error ? error : new Error(String(error)));
            pending.clear();
        }
    });
    const machine = runMachine({input,output,errorOutput});
    const failPending = (/** @type {unknown} */ error) => {
        for (const waiting of pending.values()) waiting.reject(error instanceof Error ? error : new Error('Background Agent connection ended.'));
        pending.clear();
    };
    void machine.then(() => failPending(new Error('Background Agent connection ended.')),failPending);
    return {request:(operation,requestInput) => new Promise((accept,reject) => {
        const id = randomUUID();
        const serialized = serializeJson({id,operation,input:requestInput},{format:'compact'});
        if (serialized.status !== 'succeeded') throw new Error(serialized.diagnostics.map(item => item.message).join(' '));
        pending.set(id,{resolve:accept,reject});
        input.write(Buffer.concat([serialized.bytes,Buffer.from('\n')]));
    }),close:async () => {input.end();await machine;lines.close();output.destroy();errorOutput.destroy();}};
};
