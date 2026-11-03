import {spawn} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {basename, join} from 'node:path';

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

/**
 * Put an executable shell script named `name` first on PATH for the rest of the test.
 * @param {import('node:test').TestContext} t @param {string} directory @param {string} name @param {string} script
 */
export const installFakeCommand = async (t, directory, name, script) => {
    const bin = join(directory, 'bin');
    await mkdir(bin, {recursive: true});
    await writeFile(join(bin, name), `#!/bin/sh\n${script}`, {mode: 0o755});
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath}`;
    t.after(() => {
        process.env.PATH = previousPath;
    });
};

/** Fake PowerShell that logs each call's entries, secure flag and whether the credential already exists. @param {import('node:test').TestContext} t @param {string} directory */
export const installAclLog = async (t,directory) => {
    const log = join(directory,'calls.log');
    await installFakeCommand(t,directory,'powershell.exe',`echo "$ARW_BACKGROUND_PRIVATE_ENTRIES|$ARW_BACKGROUND_PRIVATE_SECURE|$(test -e "${directory}/credential" && echo credential)" >> "${log}"\n[ ! -e "${directory}/fail" ] || [ -n "$ARW_BACKGROUND_PRIVATE_SECURE" ]\n`);
    const platform = /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(process,'platform'));
    Object.defineProperty(process,'platform',{value:'win32'});
    t.after(() => Object.defineProperty(process,'platform',platform));
    return async () => (await readFile(log,'utf8')).trim().split('\n').map(line => {
        const [entries,secure,credential] = line.split('|');
        return {paths:JSON.parse(entries).map((/** @type {{path:string}} */ entry) => entry.path),secure:secure === '1',credential:credential === 'credential'};
    });
};
