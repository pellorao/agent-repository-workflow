import {spawn} from 'node:child_process';

/** @typedef {{code: number | null, failure: 'process' | 'timeout' | null, stderr: string, stdout: Buffer}} GitProcessResult */
/** @typedef {{argv: string[], cwd: string, environment: NodeJS.ProcessEnv, input?: Buffer | string, timeoutMs: number}} GitProcessInput */
/** @typedef {{run: (input: {argv: string[], cwd?: string, environment?: NodeJS.ProcessEnv, input?: Buffer | string, timeoutMs?: number}) => Promise<GitProcessResult>}} GitRunner */

/** @param {import('node:stream').Readable} stream @returns {Promise<Buffer>} */
const collectStream = stream => new Promise((resolvePromise, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    /** @param {Buffer} chunk */
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolvePromise(Buffer.concat(chunks)));
});

/** @param {GitProcessInput} input @returns {Promise<GitProcessResult>} */
const runGitProcess = ({argv, cwd, environment, input = undefined, timeoutMs}) => new Promise(resolvePromise => {
    let settled = false;
    /** @param {GitProcessResult} result */
    const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolvePromise(result);
    };
    const child = spawn('git', argv, {cwd, env: environment, windowsHide: true});
    const stdoutPromise = collectStream(child.stdout);
    const stderrPromise = collectStream(child.stderr);
    const timeout = setTimeout(() => {
        child.kill();
        finish({code: null, failure: 'timeout', stderr: '', stdout: Buffer.alloc(0)});
    }, timeoutMs);
    child.once('error', () => finish({code: null, failure: 'process', stderr: '', stdout: Buffer.alloc(0)}));
    child.once('close', async code => {
        try {
            finish({
                code: code ?? 1,
                failure: null,
                stderr: (await stderrPromise).toString('utf8'),
                stdout: await stdoutPromise,
            });
        } catch {
            finish({code: null, failure: 'process', stderr: '', stdout: Buffer.alloc(0)});
        }
    });
    child.stdin.end(input);
});

/**
 * Git 进程执行函数只处理 argv, cwd, environment, stream, timeout 和进程失败约定.
 * 调用方解释 Git 语义, 此函数不读取 Repository 策略或构造领域结果.
 * @param {string} repositoryRoot
 * @returns {GitRunner}
 */
export const createNodeGitRunner = repositoryRoot => ({
    run: ({
        argv,
        cwd = repositoryRoot,
        environment = process.env,
        input = undefined,
        timeoutMs = 30_000,
    }) => runGitProcess({argv, cwd, environment, input, timeoutMs}),
});
