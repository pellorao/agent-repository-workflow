import {randomBytes} from 'node:crypto';
import {mkdir, open, readFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {join} from 'node:path';
import {StringDecoder} from 'node:string_decoder';
import {acquireBackgroundAgentStartupLease,backgroundAgentPort, controlProof, sameCredential} from './client.mjs';
import {securePrivateStatePath,verifyPrivateStatePath} from './private-state.mjs';

/** @param {string} runtimeDirectory */
async function privateCredential(runtimeDirectory) {
  await mkdir(runtimeDirectory, {recursive: true, mode: 0o700});
  await securePrivateStatePath(runtimeDirectory,'directory');
  const path = join(runtimeDirectory, 'credential');
  try {
    const handle = await open(path, 'wx', 0o600);
    try {await handle.writeFile(`${randomBytes(32).toString('hex')}\n`); await handle.sync();}
    finally {await handle.close();}
    await securePrivateStatePath(path,'file');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  }
  await verifyPrivateStatePath(path,'file');
  const secret = (await readFile(path, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Background Agent credential is invalid.');
  return secret;
}

/**
 * @param {{runtimeDirectory:string, dispatch:(request:{ownerId:string,caller:{repositoryRoot:string|null,programDirectory:string},operation:string,input:Record<string,unknown>,emit:(result:unknown)=>Promise<void>,signal:AbortSignal})=>Promise<unknown>, list:()=>Promise<unknown>|unknown, prepareMaintenance:(request:{stopBackgroundAgents:boolean,allowIdleEviction:boolean})=>Promise<{status:'ready'|'busy'|'unknown',stoppedAgents:string[],reason?:string}>, port?:number,maintenancePort?:number,startupLease?:Awaited<ReturnType<typeof acquireBackgroundAgentStartupLease>>}} input
 */
export async function createBackgroundAgentDaemon({runtimeDirectory, dispatch, list, prepareMaintenance, port = backgroundAgentPort(),maintenancePort,startupLease:providedStartupLease}) {
  const startupLease=providedStartupLease??await acquireBackgroundAgentStartupLease({runtimeDirectory,maintenancePort});
  try {
  const secret = await privateCredential(runtimeDirectory);
  let closing = false;
  /** @type {Set<import('node:net').Socket>} */
  const sockets=new Set();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.once('close',()=>sockets.delete(socket));
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let consumed = false;
    /** @type {{clientNonce:string,serverNonce:string}|null} */
    let challenge = null;
    const controller = new AbortController();
    socket.once('close', () => controller.abort());
    socket.setTimeout(30_000, () => socket.destroy());
    socket.on('data', chunk => {
      if (consumed) return;
      buffer += decoder.write(chunk);
      if (buffer.length > 2_000_000) {socket.destroy(); return;}
      let newline = buffer.indexOf('\n');
      if (newline === -1) return;
      if (!challenge) {
        let hello;
        try {hello = JSON.parse(buffer.slice(0,newline));}
        catch {socket.destroy(); return;}
        if (!hello || typeof hello.hello !== 'string' || !/^[a-f0-9]{32}$/.test(hello.hello)) {socket.destroy(); return;}
        const clientNonce = hello.hello;
        const serverNonce = randomBytes(16).toString('hex');
        challenge = {clientNonce,serverNonce};
        buffer = buffer.slice(newline+1);
        socket.write(`${JSON.stringify({serverNonce,proof:controlProof(secret,'server',clientNonce,serverNonce)})}\n`);
        newline = buffer.indexOf('\n');
        if (newline === -1) return;
      }
      consumed = true;
      void (async () => {
        /** @type {unknown} */
        let id = null;
        try {
          const raw = JSON.parse(buffer.slice(0, newline));
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Control request is invalid.');
          const request = /** @type {Record<string, unknown>} */ (raw);
          id = request.id ?? null;
          if (typeof request.auth !== 'string' || !sameCredential(request.auth,controlProof(secret,'client',challenge.clientNonce,challenge.serverNonce))) throw new Error('Background Agent authentication failed.');
          const operation = request.operation;
          if (typeof operation !== 'string') throw new Error('Background Agent operation is invalid.');
          if (operation === 'wait_agent') socket.setTimeout(0);
          let emitted = false;
          const emit = (/** @type {unknown} */ value) => new Promise((resolveWrite, rejectWrite) => {
            if (socket.destroyed) {rejectWrite(new Error('Background Agent control connection ended.')); return;}
            if (emitted) {rejectWrite(new Error('Background Agent request already has a response.')); return;}
            emitted = true;
            socket.write(`${JSON.stringify({id,ok:true,result:value})}\n`, error => error ? rejectWrite(error) : resolveWrite(undefined));
          });
          let result;
          if (operation === '__ping') result = {alive: true};
          else if (operation === '__list') result = await list();
          else if (operation === '__maintenance') {
            const input = request.input;
            if (!input || typeof input !== 'object' || Array.isArray(input) || typeof /** @type {Record<string,unknown>} */ (input).stopBackgroundAgents !== 'boolean' || typeof /** @type {Record<string,unknown>} */ (input).allowIdleEviction !== 'boolean') throw new Error('Maintenance authorization is invalid.');
            result = await prepareMaintenance({stopBackgroundAgents: /** @type {Record<string,boolean>} */ (input).stopBackgroundAgents,allowIdleEviction: /** @type {Record<string,boolean>} */ (input).allowIdleEviction});
            if (/** @type {{status?:string}} */ (result).status === 'ready') {
              result = {.../** @type {object} */ (result),managerPid:process.pid};
              closing = true;
              for(const other of sockets) if(other!==socket) other.destroy();
              queueMicrotask(() => server.close());
            }
          } else {
            if (closing) throw new Error('Background Agent maintenance is in progress.');
            if (typeof request.ownerId !== 'string' || request.ownerId.length === 0) throw new Error('Main session identity is missing.');
            if (!request.caller || typeof request.caller !== 'object' || Array.isArray(request.caller)) throw new Error('Background Agent caller context is missing.');
            const caller = /** @type {Record<string, unknown>} */ (request.caller);
            if ((caller.repositoryRoot !== null && typeof caller.repositoryRoot !== 'string') || typeof caller.programDirectory !== 'string') throw new Error('Background Agent caller context is invalid.');
            if (!request.input || typeof request.input !== 'object' || Array.isArray(request.input)) throw new Error('Background Agent input is invalid.');
            result = await dispatch({ownerId: request.ownerId, caller: /** @type {{repositoryRoot:string|null,programDirectory:string}} */ (caller), operation, input: /** @type {Record<string, unknown>} */ (request.input), emit, signal:controller.signal});
          }
          if (!socket.destroyed) {
            if (emitted) socket.end();
            else socket.end(`${JSON.stringify({id, ok: true, result})}\n`);
          }
        } catch (error) {
          if (!socket.destroyed) socket.end(`${JSON.stringify({id, ok: false, error: {code: 'background-agent-control-failed', message: error instanceof Error ? error.message : 'Background Agent control failed.'}})}\n`);
        }
      })();
    });
    socket.on('end', () => {buffer += decoder.end(); if (!consumed) socket.destroy();});
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen({host: '127.0.0.1', port, exclusive: true}, () => {server.off('error', rejectListen); resolveListen(undefined);});
  });
  await startupLease.release();
  const address = server.address();
  return {address: '127.0.0.1', port: typeof address === 'object' && address ? address.port : port, close: () => new Promise(resolveClose => server.close(() => resolveClose(undefined))), server};
  } catch(error) {await startupLease.release();throw error;}
}
