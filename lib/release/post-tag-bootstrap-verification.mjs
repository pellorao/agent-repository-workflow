import {execFile as execFileCallback, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
    chmod,
    copyFile,
    mkdtemp,
    readFile,
    rm,
    writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {delimiter, isAbsolute, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

import {loadReleaseValidationConfiguration} from './release-validation-config.mjs';

const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const STAGE_ORDER = ['acquisition', 'write', 'bootstrap-start', 'bootstrap-exit', 'event-forwarding', 'launcher', 'cleanup'];
const CHILD_EVENT_ORDER = ['release-selected', 'tag-resolved', 'checkout-verified', 'installer-launched'];
const BOOTSTRAP_PATH = 'scripts/install-arw.mjs';
const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const execFile = promisify(execFileCallback);
/** @typedef {{code: string, message: string, stage: string}} BootstrapDiagnostic */
/** @typedef {Record<string, unknown> & {event: string}} BootstrapEvent */
/** @typedef {{exitCode: number | null, signal?: NodeJS.Signals | null, stderr: string, stdout: string}} BootstrapProcessResult */
/** @typedef {{args: string[], cwd: string, encoding: BufferEncoding | null}} GitInvocation */
/** @typedef {{candidateRepository: string, path: string, remote: string, tag: string}} AcquisitionRequest */
const sha256 = (/** @type {import("crypto").BinaryLike | NonSharedBuffer} */ bytes) => createHash('sha256').update(bytes).digest('hex');
const errorMessage = (/** @type {unknown} */ error) => error instanceof Error ? error.message : String(error);
/** @param {string} left @param {string} right */
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export class PostTagBootstrapUsageError extends Error {
    /**
     * @param {string | undefined} message
     */
    constructor(message) {
        super(message);
        this.exitCode = 2;
        this.name = 'PostTagBootstrapUsageError';
    }
}

const diagnostic = (/** @type {string} */ stage, /** @type {string} */ code, /** @type {string} */ message) => ({code, message, stage});
/** @returns {value is BootstrapProcessResult} */
const isBootstrapProcessResult = (/** @type {unknown} */ value) => {
    if (value === null || typeof value !== 'object'
        || !('exitCode' in value) || !('stderr' in value) || !('stdout' in value)) return false;
    const numericExit = Number.isSafeInteger(value.exitCode)
        && (!('signal' in value) || value.signal === undefined || value.signal === null);
    const signalExit = value.exitCode === null
        && 'signal' in value && typeof value.signal === 'string' && value.signal.length > 0;
    return (numericExit || signalExit) && typeof value.stderr === 'string' && typeof value.stdout === 'string';
};
/** @param {BootstrapDiagnostic[]} diagnostics */
const sortDiagnostics = diagnostics => [...new Map(diagnostics.map(item => [JSON.stringify(item), item])).values()]
    .sort((left, right) => (
        STAGE_ORDER.indexOf(left.stage) - STAGE_ORDER.indexOf(right.stage)
        || compareText(left.code, right.code)
        || compareText(left.message, right.message)
    ));
/** @param {number | null} exitCode @param {NodeJS.Signals | null} signal @param {BootstrapDiagnostic[]} diagnostics */
const failed = (exitCode, signal, diagnostics) => ({
    diagnostics: sortDiagnostics(diagnostics),
    exitCode,
    signal,
    status: 'failed',
});
/** @param {(value: string) => unknown} stdout @param {Record<string, unknown>} event */
const writeEvent = (stdout, event) => stdout(`${JSON.stringify(event)}\n`);

/** @param {Record<string, unknown>} event @param {string[]} expected @param {number} index */
const assertExactEventKeys = (event, expected, index) => {
    const actual = Object.keys(event);
    if (actual.length !== expected.length || actual.some((key, keyIndex) => key !== expected[keyIndex])) {
        throw new Error(`Bootstrap stdout event ${index + 1} does not have the exact canonical fields.`);
    }
};
/** @param {Record<string, unknown>} event @param {string} key @param {number} index */
const assertEventString = (event, key, index) => {
    if (typeof event[key] !== 'string') {
        throw new Error(`Bootstrap stdout event ${index + 1} field ${key} is not text.`);
    }
};
/** @param {BootstrapEvent} event @param {number} index */
const assertChildEventShape = (event, index) => {
    if (event.event === 'release-selected') {
        assertExactEventKeys(event, ['event', 'tag'], index);
        assertEventString(event, 'tag', index);
        return;
    }
    if (event.event === 'tag-resolved') {
        assertExactEventKeys(event, ['commit', 'event', 'tag'], index);
        assertEventString(event, 'commit', index);
        assertEventString(event, 'tag', index);
        return;
    }
    if (event.event === 'checkout-verified') {
        assertExactEventKeys(event, ['commit', 'event'], index);
        assertEventString(event, 'commit', index);
        return;
    }
    if (event.event === 'installer-launched') {
        assertExactEventKeys(event, ['arguments', 'event', 'path', 'sha256'], index);
        if (!Array.isArray(event.arguments) || !event.arguments.every(argument => typeof argument === 'string')) {
            throw new Error(`Bootstrap stdout event ${index + 1} field arguments is not a text array.`);
        }
        assertEventString(event, 'path', index);
        assertEventString(event, 'sha256', index);
        return;
    }
    throw new Error(`Bootstrap stdout event ${index + 1} has an unknown event identity.`);
};

/** @param {GitInvocation} input @returns {Promise<string | Buffer>} */
const defaultRunGit = async ({args, cwd, encoding}) => {
    const {stdout} = await execFile('git', args, {
        cwd,
        encoding,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
    });
    return stdout;
};

export const acquireBootstrap = async (
    /** @type {AcquisitionRequest} */
    {candidateRepository, path, remote, tag},
    /** @type {{runGit?: (input: GitInvocation) => Promise<string | Buffer>}} */
    {runGit = defaultRunGit} = {},
) => {
    if (typeof candidateRepository !== 'string'
        || !isAbsolute(candidateRepository)
        || path !== BOOTSTRAP_PATH
        || typeof remote !== 'string'
        || remote.length === 0
        || !STABLE_VERSION_PATTERN.test(tag)) {
        throw new Error('Bootstrap acquisition request is invalid.');
    }
    const git = (/** @type {string[]} */ args, /** @type {BufferEncoding | null} */ encoding) => runGit({args, cwd: candidateRepository, encoding});
    const bare = await git(['rev-parse', '--is-bare-repository'], 'utf8');
    if (typeof bare !== 'string' || bare.trim() !== 'true') {
        throw new Error('Bootstrap candidate Repository is not a bare Repository.');
    }
    await git([
        'fetch',
        '--quiet',
        '--no-tags',
        remote,
        `refs/tags/${tag}:refs/tags/${tag}`,
    ], 'utf8');
    const resolved = await git([
        'rev-parse',
        'refs/heads/arw-validation^{commit}',
        `refs/tags/${tag}^{commit}`,
    ], 'utf8');
    if (typeof resolved !== 'string') throw new Error('Bootstrap Git references did not return text.');
    const commits = resolved.trim().split(/\r?\n/);
    if (commits.length !== 2 || commits.some((/** @type {string} */ value) => !OBJECT_ID_PATTERN.test(value))) {
        throw new Error('Bootstrap Git references did not resolve to full object IDs.');
    }
    if (commits[0] !== commits[1]) {
        throw new Error('Bootstrap tag does not match the prepared candidate commit.');
    }
    const bytes = await git(['show', `refs/tags/${tag}:${BOOTSTRAP_PATH}`], null);
    if (!Buffer.isBuffer(bytes)) throw new Error('Bootstrap Git show command did not return bytes.');
    return bytes;
};

/** @param {string} executable @param {readonly string[]} args @param {{cwd: string, env: NodeJS.ProcessEnv, onStdout: (chunk: string) => void}} options @returns {Promise<BootstrapProcessResult>} */
const defaultRunProcess = (executable, args, {cwd, env, onStdout}) => new Promise((resolve, reject) => {
    const child = spawn(executable, args, {cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
    let settled = false;
    let stderr = '';
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (/** @type {string} */ chunk) => {
        stdout += chunk;
        onStdout(chunk);
    });
    child.stderr.on('data', (/** @type {string} */ chunk) => {
        stderr += chunk;
    });
    child.once('error', error => {
        if (settled) return;
        settled = true;
        reject(error);
    });
    child.once('close', (exitCode, signal) => {
        if (settled) return;
        settled = true;
        resolve({exitCode, signal, stderr, stdout});
    });
});
/** @param {{launcherPath: string, nodePath: string}} input */
const defaultMaterializeLauncher = async ({launcherPath, nodePath}) => {
    await copyFile(nodePath, launcherPath);
    if (process.platform !== 'win32') await chmod(launcherPath, 0o755);
};
const defaultAdapters = {
    acquireBootstrap,
    createTemporaryDirectory: () => mkdtemp(join(tmpdir(), 'arw-post-tag-bootstrap-')),
    environment: process.env,
    loadReleaseConfiguration: loadReleaseValidationConfiguration,
    materializeLauncher: defaultMaterializeLauncher,
    nodePath: process.execPath,
    platform: process.platform,
    readFile,
    removeTemporaryDirectory: (/** @type {import("fs").PathLike} */ directory) => rm(directory, {force: true, recursive: true}),
    runProcess: defaultRunProcess,
    stderr: (/** @type {string | Uint8Array<ArrayBufferLike>} */ value) => process.stderr.write(value),
    stdout: (/** @type {string | Uint8Array<ArrayBufferLike>} */ value) => process.stdout.write(value),
    writeFile,
};

const launcherHookSource = `import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {basename} from 'node:path';

if (basename(process.argv[1] ?? '') === 'install.mjs') {
    const installerPath = process.argv[1];
    const bytes = await readFile(installerPath);
    const event = {
        arguments: process.argv.slice(2),
        event: 'installer-launched',
        path: 'install.mjs',
        sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    process.stdout.write(JSON.stringify(event) + '\\n');
    process.exit(0);
}
`;

/** @param {{environment: NodeJS.ProcessEnv, hookPath: string, platform: string, temporaryDirectory: string}} input */
const environmentWithLauncher = ({environment, hookPath, platform, temporaryDirectory}) => {
    const output = {...environment};
    const pathKey = Object.keys(output).find(key => key.toLowerCase() === 'path') ?? 'PATH';
    output[pathKey] = `${temporaryDirectory}${delimiter}${output[pathKey] ?? ''}`;
    const importOption = `--import=${pathToFileURL(hookPath).href}`;
    output.NODE_OPTIONS = output.NODE_OPTIONS === undefined || output.NODE_OPTIONS.length === 0
        ? importOption
        : `${output.NODE_OPTIONS} ${importOption}`;
    if (platform === 'win32' && pathKey !== 'PATH') output.PATH = output[pathKey];
    return output;
};

/** @param {string} line @param {number} index @returns {BootstrapEvent} */
const parseChildEvent = (line, index) => {
    let event;
    try {
        event = JSON.parse(line);
    } catch {
        throw new Error(`Bootstrap stdout event ${index + 1} is not JSON.`);
    }
    if (event === null || Array.isArray(event) || typeof event !== 'object' || JSON.stringify(event) !== line) {
        throw new Error(`Bootstrap stdout event ${index + 1} is not canonical JSON.`);
    }
    if (typeof event.event !== 'string') throw new Error(`Bootstrap stdout event ${index + 1} has no event identity.`);
    assertChildEventShape(event, index);
    return event;
};
/** @param {(value: string) => unknown} write */
const createChildEventStream = write => {
    let buffer = '';
    /** @type {unknown} */
    let error;
    /** @type {BootstrapEvent[]} */
    const events = [];
    return {
        finish: () => {
            if (error !== undefined) throw error;
            if (buffer.length > 0) throw new Error('Bootstrap stdout has an incomplete event line.');
            return events;
        },
        write: (/** @type {string} */ chunk) => {
            if (error !== undefined) return;
            if (typeof chunk !== 'string') {
                error = new Error('Bootstrap stdout chunk is not text.');
                return;
            }
            buffer += chunk;
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                let line = buffer.slice(0, newlineIndex);
                buffer = buffer.slice(newlineIndex + 1);
                if (line.endsWith('\r')) line = line.slice(0, -1);
                try {
                    const event = parseChildEvent(line, events.length);
                    events.push(event);
                    write(`${line}\n`);
                } catch (caught) {
                    error = caught;
                    return;
                }
            }
        },
    };
};

/**
 * 从 Main Agent 提供的 candidate Repository 取得并执行准确 version 的 Bootstrap, 只报告实际发生的 6 个 JSON events.
 */
/** @typedef {Partial<Omit<typeof defaultAdapters, 'runProcess'>> & {runProcess?: (executable: string, args: readonly string[], options: {cwd: string, env: NodeJS.ProcessEnv, onStdout: (chunk: string) => void}) => Promise<unknown>}} PostTagBootstrapAdapters */
/** @param {{candidateRepository: string, version: string}} input @param {PostTagBootstrapAdapters} [adapters] */
export const runPostTagBootstrapVerification = async ({candidateRepository, version}, adapters = {}) => {
    if (typeof version !== 'string' || !STABLE_VERSION_PATTERN.test(version)) {
        throw new PostTagBootstrapUsageError('--version requires a stable MAJOR.MINOR.PATCH tag.');
    }
    if (typeof candidateRepository !== 'string' || !isAbsolute(candidateRepository)) {
        throw new PostTagBootstrapUsageError('--candidate-repository requires an absolute path.');
    }
    const dependencies = {...defaultAdapters, ...adapters};
    const configuration = await dependencies.loadReleaseConfiguration();
    const canonicalRemote = configuration !== null && typeof configuration === 'object'
        && 'status' in configuration && configuration.status === 'succeeded'
        && 'value' in configuration && configuration.value !== null && typeof configuration.value === 'object'
        && 'repositories' in configuration.value && configuration.value.repositories !== null
        && typeof configuration.value.repositories === 'object'
        && 'sourceCheckout' in configuration.value.repositories
        && configuration.value.repositories.sourceCheckout !== null
        && typeof configuration.value.repositories.sourceCheckout === 'object'
        && 'url' in configuration.value.repositories.sourceCheckout
        ? configuration.value.repositories.sourceCheckout.url : null;
    if (typeof canonicalRemote !== 'string' || canonicalRemote.length === 0) {
        return failed(null, null, [diagnostic(
            'acquisition',
            'release-configuration-invalid',
            'Release validation configuration does not provide the canonical remote.',
        )]);
    }
    const acquisitionRequest = {candidateRepository, path: BOOTSTRAP_PATH, remote: canonicalRemote, tag: version};
    /** @type {BootstrapDiagnostic[]} */
    const diagnostics = [];
    let exitCode = null;
    let signal = null;
    /** @type {string | undefined} */
    let temporaryDirectory;
    try {
        /** @type {Buffer | undefined} */
        let bootstrapBytes;
        try {
            bootstrapBytes = await dependencies.acquireBootstrap(acquisitionRequest);
            if (!Buffer.isBuffer(bootstrapBytes)) throw new Error('Bootstrap acquisition did not return bytes.');
            writeEvent(dependencies.stdout, {
                event: 'bootstrap-acquired',
                path: BOOTSTRAP_PATH,
                remote: canonicalRemote,
                sha256: sha256(bootstrapBytes),
                tag: version,
            });
        } catch (error) {
            diagnostics.push(diagnostic('acquisition', 'bootstrap-acquisition-failed', errorMessage(error)));
        }

        let bootstrapPath;
        let hookPath;
        if (diagnostics.length === 0) {
            if (bootstrapBytes === undefined) throw new Error('Bootstrap bytes are unavailable after acquisition.');
            try {
                temporaryDirectory = await dependencies.createTemporaryDirectory();
                bootstrapPath = join(temporaryDirectory, 'install-arw.mjs');
                hookPath = join(temporaryDirectory, 'launcher-hook.mjs');
                const launcherPath = join(temporaryDirectory, dependencies.platform === 'win32' ? 'node.exe' : 'node');
                await dependencies.writeFile(bootstrapPath, bootstrapBytes, {flag: 'wx'});
                const launchedBytes = await dependencies.readFile(bootstrapPath);
                writeEvent(dependencies.stdout, {
                    event: 'bootstrap-launched',
                    path: 'install-arw.mjs',
                    sha256: sha256(launchedBytes),
                });
                await dependencies.writeFile(hookPath, launcherHookSource, {encoding: 'utf8', flag: 'wx'});
                await dependencies.materializeLauncher({launcherPath, nodePath: dependencies.nodePath});
            } catch (error) {
                diagnostics.push(diagnostic('write', 'bootstrap-materialization-failed', errorMessage(error)));
            }
        }

        /** @type {unknown} */
        let processResult;
        const childEventStream = createChildEventStream(dependencies.stdout);
        if (diagnostics.length === 0) {
            if (bootstrapPath === undefined || hookPath === undefined || temporaryDirectory === undefined) {
                throw new Error('Bootstrap materialization paths are unavailable.');
            }
            try {
                processResult = await dependencies.runProcess(
                    dependencies.nodePath,
                    [bootstrapPath, '--version', version, '--verbose'],
                    {
                        cwd: temporaryDirectory,
                        env: environmentWithLauncher({
                            environment: dependencies.environment,
                            hookPath,
                            platform: dependencies.platform,
                            temporaryDirectory,
                        }),
                        onStdout: childEventStream.write,
                    },
                );
            } catch (error) {
                diagnostics.push(diagnostic('bootstrap-start', 'bootstrap-process-start-failed', errorMessage(error)));
            }
        }

        if (diagnostics.length === 0) {
            if (!isBootstrapProcessResult(processResult)) {
                diagnostics.push(diagnostic('bootstrap-exit', 'bootstrap-process-result-invalid', 'Bootstrap process returned an invalid result.'));
            } else {
                exitCode = processResult.exitCode;
                signal = processResult.signal ?? null;
                if (processResult.stderr.length > 0) dependencies.stderr(processResult.stderr);
                if (exitCode !== 0) {
                    const outcome = signal === null
                        ? `code ${exitCode}`
                        : `signal ${signal}`;
                    diagnostics.push(diagnostic(
                        'bootstrap-exit',
                        'bootstrap-process-exit-failed',
                        `Bootstrap process exited with ${outcome}.`,
                    ));
                }
                let events;
                try {
                    events = childEventStream.finish();
                } catch (error) {
                    diagnostics.push(diagnostic('event-forwarding', 'bootstrap-event-forwarding-failed', errorMessage(error)));
                }
                if (events !== undefined) {
                    const actualOrder = events.map(event => event.event);
                    const validPrefix = actualOrder.length <= CHILD_EVENT_ORDER.length
                        && actualOrder.every((event, index) => CHILD_EVENT_ORDER[index] === event);
                    const checkoutCompleted = validPrefix
                        && CHILD_EVENT_ORDER.slice(0, 3).every((event, index) => actualOrder[index] === event);
                    const launcherMissing = checkoutCompleted && actualOrder.length === 3;
                    if (!validPrefix || (exitCode === 0 && actualOrder.length < 3)) {
                        diagnostics.push(diagnostic(
                            'event-forwarding',
                            'bootstrap-event-sequence-invalid',
                            'Bootstrap child events do not have the required execution order.',
                        ));
                    } else if (launcherMissing) {
                        diagnostics.push(diagnostic(
                            'launcher',
                            exitCode === 0 ? 'installer-launch-event-missing' : 'installer-launch-failed',
                            exitCode === 0
                                ? 'The temporary launcher did not report an Installer invocation.'
                                : 'The temporary launcher did not complete an Installer invocation.',
                        ));
                    }
                }
            }
        }
    } finally {
        if (temporaryDirectory !== undefined) {
            try {
                await dependencies.removeTemporaryDirectory(temporaryDirectory);
            } catch (error) {
                diagnostics.push(diagnostic('cleanup', 'temporary-cleanup-failed', errorMessage(error)));
            }
        }
    }
    if (diagnostics.length > 0) return failed(exitCode, signal, diagnostics);
    return {diagnostics: [], exitCode: 0, signal: null, status: 'completed'};
};

const USAGE = 'Usage: node scripts/verify-post-tag-bootstrap.mjs --version <version> --candidate-repository <absolute-path>\n';
/** @param {string[]} args */
const parseCliArguments = args => {
    if (args.length !== 4) return null;
    const values = new Map();
    for (let index = 0; index < args.length; index += 2) {
        const name = args[index];
        const value = args[index + 1];
        if (!['--candidate-repository', '--version'].includes(name)
            || values.has(name)
            || typeof value !== 'string'
            || value.length === 0) {
            return null;
        }
        values.set(name, value);
    }
    const candidateRepository = values.get('--candidate-repository');
    const version = values.get('--version');
    if (version === undefined || candidateRepository === undefined
        || !STABLE_VERSION_PATTERN.test(version) || !isAbsolute(candidateRepository)) return null;
    return {candidateRepository, version};
};
export const runPostTagBootstrapVerificationCli = async (/** @type {string[]} */ args, {
    run = runPostTagBootstrapVerification,
    stderr = (/** @type {string | Uint8Array<ArrayBufferLike>} */ value) => process.stderr.write(value),
    stdout = (/** @type {string | Uint8Array<ArrayBufferLike>} */ value) => process.stdout.write(value),
} = {}) => {
    const input = parseCliArguments(args);
    if (input === null) {
        stderr(USAGE);
        return 2;
    }
    let result;
    try {
        result = await run(input, {stderr, stdout});
    } catch (error) {
        if (error instanceof PostTagBootstrapUsageError) {
            stderr(USAGE);
            return 2;
        }
        stderr(`${errorMessage(error)}\n`);
        return 1;
    }
    if (result.status === 'completed') return 0;
    for (const item of result.diagnostics) {
        stderr(`post-tag-bootstrap-finding: stage=${JSON.stringify(item.stage)} code=${JSON.stringify(item.code)} message=${JSON.stringify(item.message)}\n`);
    }
    return 1;
};
