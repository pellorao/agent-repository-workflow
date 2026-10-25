import {spawn as spawnProcess} from 'node:child_process';

/** @typedef {{args: string[], command: string}} AgentCommand */
/** @typedef {{exitCode: number, kind: 'exited'} | {kind: 'failed', reason: 'missing-exit-code' | 'spawn-failed'}} AgentCliResult */
/** @typedef {{once: { (event: 'error', listener: () => void): unknown, (event: 'exit', listener: (code: number | null) => void): unknown }}} AgentChildProcess */
/** @typedef {(command: string, args: readonly string[], options: {cwd: string, shell: false, stdio: 'inherit', windowsHide: true}) => AgentChildProcess} AgentSpawn */

/**
 * @param {AgentCommand} agent
 * @param {string} cwd
 * @param {AgentSpawn} [spawn]
 * @param {string[]} [agentArguments]
 * @returns {Promise<AgentCliResult>}
 */
export const launchAgentCli = async (agent, cwd, spawn = spawnProcess, agentArguments = []) => new Promise(resolve => {
    let settled = false;
    /** @param {AgentCliResult} result */
    const finish = result => {
        if (settled) return;
        settled = true;
        resolve(result);
    };
    let child;
    try {
        child = spawn(agent.command, [...agent.args, ...agentArguments], {
            cwd,
            shell: false,
            stdio: 'inherit',
            windowsHide: true,
        });
    } catch {
        finish({kind: 'failed', reason: 'spawn-failed'});
        return;
    }
    child.once('error', () => finish({kind: 'failed', reason: 'spawn-failed'}));
    child.once('exit', code => finish(code !== null && Number.isInteger(code) && code >= 0
        ? {exitCode: code, kind: 'exited'}
        : {kind: 'failed', reason: 'missing-exit-code'}));
});
