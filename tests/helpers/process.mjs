import {spawn} from 'node:child_process';
import {basename} from 'node:path';

const nodeProcessStdioBootstrap = new URL('./node-process-stdio.mjs', import.meta.url).href;
const nodeExecutable = (/** @type {string} */ file) => file === process.execPath
    || ['node', 'node.exe'].includes(basename(file).toLowerCase());

/** @param {NodeJS.ProcessEnv} [environment] */
export const createOrdinaryNodeProcessEnvironment = (environment = process.env) => {
    const output = {...environment};
    delete output.NODE_TEST_CONTEXT;
    delete output.NODE_TEST_WORKER_ID;
    const importOption = `--import=${nodeProcessStdioBootstrap}`;
    if (!(output.NODE_OPTIONS ?? '').includes(importOption)) {
        output.NODE_OPTIONS = output.NODE_OPTIONS === undefined || output.NODE_OPTIONS.length === 0
            ? importOption
            : `${output.NODE_OPTIONS} ${importOption}`;
    }
    return output;
};

/**
 * @typedef {object} ProcessOptions
 * @property {string} [cwd]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {string | Uint8Array} [input]
 * @property {number} [timeout]
 *
 * @typedef {object} ExitedProcessResult
 * @property {'exited'} status
 * @property {number} exitCode
 * @property {string} stdout
 * @property {string} stderr
 *
 * @typedef {object} SignaledProcessResult
 * @property {'signaled'} status
 * @property {NodeJS.Signals} signal
 * @property {string} stdout
 * @property {string} stderr
 *
 * @typedef {object} SpawnFailedProcessResult
 * @property {'spawn-failed'} status
 * @property {Error} error
 *
 * @typedef {ExitedProcessResult | SignaledProcessResult | SpawnFailedProcessResult} ProcessResult
 */

/**
 * @param {string} file
 * @param {string[]} args
 * @param {ProcessOptions} [options]
 * @returns {Promise<ProcessResult>}
 */
export const runProcess = (file, args, options = {}) => new Promise(resolve => {
    const env = nodeExecutable(file)
        ? createOrdinaryNodeProcessEnvironment(options.env)
        : {...(options.env ?? process.env)};
    const child = spawn(file, args, {
        cwd: options.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: options.timeout,
        windowsHide: true,
    });
    if (child.stdin === null || child.stdout === null || child.stderr === null) {
        resolve({error: new Error('Test process streams are unavailable.'), status: 'spawn-failed'});
        return;
    }
    let settled = false;
    let stderr = '';
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
        stdout += chunk;
    });
    child.stderr.on('data', chunk => {
        stderr += chunk;
    });
    child.once('error', error => {
        if (settled) return;
        settled = true;
        resolve({error, status: 'spawn-failed'});
    });
    child.once('close', (exitCode, signal) => {
        if (settled) return;
        settled = true;
        if (signal !== null) {
            resolve({signal, status: 'signaled', stderr, stdout});
            return;
        }
        resolve({exitCode: exitCode ?? 1, status: 'exited', stderr, stdout});
    });
    child.stdin.end(options.input);
});

/**
 * @param {string} file
 * @param {string[]} args
 * @param {ProcessOptions} [options]
 * @returns {Promise<ExitedProcessResult>}
 */
export const runExitedProcess = async (file, args, options = {}) => {
    const result = await runProcess(file, args, options);
    if (result.status === 'spawn-failed') {
        throw new Error(`Cannot start test process ${file}: ${result.error.message}`);
    }
    if (result.status === 'signaled') {
        throw new Error(`Test process ${file} was terminated by signal ${result.signal}: ${result.stderr || result.stdout}`);
    }
    return result;
};

/**
 * @param {string} file
 * @param {string[]} args
 * @param {ProcessOptions} [options]
 * @returns {Promise<ExitedProcessResult>}
 */
export const runSuccessfulProcess = async (file, args, options = {}) => {
    const result = await runExitedProcess(file, args, options);
    if (result.exitCode !== 0) {
        throw new Error(`Test process ${file} failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`);
    }
    return result;
};
