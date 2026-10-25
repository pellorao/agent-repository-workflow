import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {loadConfig} from '../arw-common/config.mjs';
import {createUsage} from './usage.mjs';

/** @typedef {import('./codex-app-server.mjs').NativeSessions} NativeSessions */
/** @typedef {import('./codex-app-server.mjs').NativeSession} NativeSession */
/** @typedef {import('./codex-app-server.mjs').NativeMember} NativeMember */
/** @typedef {import('./codex-app-server.mjs').NativeSpawn} NativeSpawn */

/** Reviewer settings with this provider run on the Claude backend. @param {{modelProvider?:unknown}} settings */
export const isClaudeSettings = settings => settings.modelProvider === 'anthropic';

// The Reviewer final status; `claude -p` rejects a top-level union, so `if` keeps `ready` alone and requires a reason otherwise.
const FINAL_STATUS_SCHEMA = JSON.stringify({type: 'object', properties: {status: {enum: ['ready', 'incomplete']}, reason: {type: 'string', pattern: '\\S'}},
    required: ['status'], additionalProperties: false, if: {properties: {status: {const: 'ready'}}}, then: {maxProperties: 1}, else: {required: ['reason']}});

/**
 * Claude backend: each turn is one headless `claude -p`; the first creates the session, later turns resume it.
 * A turn cannot take mid-turn instructions, and interruption ends its process.
 * Each turn adds the role's `env` (e.g. a third-party model endpoint) from the user-level config in `settings.programDirectory`.
 * @param {{executable?:string,environment?:NodeJS.ProcessEnv,spawnProcess?:NativeSpawn}} [options]
 * @returns {NativeSessions}
 */
export function createClaudeSessions({executable = 'claude', environment = process.env,
    spawnProcess = (command, args, options) => spawn(command, args, options)} = {}) {
    /** @type {Set<import('./codex-app-server.mjs').NativeProcess>} */
    const live = new Set();
    const projects = join(environment.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
    return {
        async ensureServer() {},
        async observeServer() {return 'absent';},
        async close() {
            for (const child of live) child.kill();
            return {environmentState: 'exited'};
        },
        async open({settings, role, cwd, readPaths, writePaths, onNotification}) {
            /** @type {string|null} */ let threadId = null;
            /** @type {string|null} */ let turnId = null;
            /** @type {NativeMember['state']} */ let state = 'idle';
            /** @type {string|null} */ let turnStatus = null;
            /** @type {string|null} */ let finalResponse = null;
            /** @type {import('./codex-app-server.mjs').NativeProcess|null} */ let child = null;
            /** @type {NativeMember['contexts']} */ const contexts = [];
            const usage = createUsage(0);
            let instructions = '';
            let resumable = false;
            let exited = false;
            const permissionsRules = /** @type {import('./codex-app-server.mjs').NativePermissionRule[]} */ ([
                ...[cwd, ...readPaths].map(path => ({path, access: 'read'})), ...writePaths.map(path => ({path, access: 'write'}))]);
            /** @returns {NativeMember} */
            const member = () => ({threadId: /** @type {string} */ (threadId), parentThreadId: null, state: exited ? 'exited' : state,
                turnId, turnStatus, sessionPath: join(projects, cwd.replace(/[^A-Za-z0-9]/g, '-'), `${threadId}.jsonl`),
                modelProvider: settings.modelProvider, contexts, usage, finalResponse, hasConversationHistory: resumable});
            /** @type {NativeSession} */
            const session = {
                async start(input) {
                    threadId = randomUUID();
                    instructions = input.instructions;
                    return {threadId, sessionPath: member().sessionPath};
                },
                async resume(input) {
                    threadId = input.threadId;
                    instructions = input.instructions;
                    resumable = true;
                    return {threadId, sessionPath: member().sessionPath};
                },
                async startTurn({handoff}) {
                    const current = `turn-${contexts.length + 1}`;
                    const args = ['-p', '--output-format', 'stream-json', '--verbose',
                        '--model', settings.model, '--effort', settings.reasoningEffort, '--json-schema', FINAL_STATUS_SCHEMA,
                        ...(existsSync(/** @type {string} */ (member().sessionPath)) ? ['--resume', /** @type {string} */ (threadId)] : ['--session-id', /** @type {string} */ (threadId)]),
                        '--append-system-prompt', instructions,
                        '--tools', 'Read,Grep,Glob,Edit,Write', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--setting-sources', '',
                        ...[...readPaths, ...writePaths].flatMap(path => ['--add-dir', path]),
                        // `//` marks an absolute path in Claude permission rules; Edit rules also govern Write.
                        '--allowedTools', ...writePaths.map(path => `Edit(/${path}/**)`)];
                    const env = {...environment, ...(await loadConfig(/** @type {string} */ (settings.programDirectory))).reviewers?.[/** @type {string} */ (role)]?.env};
                    const turnProcess = spawnProcess(executable, args, {cwd, env, stdio: 'pipe', shell: false, windowsHide: true});
                    child = turnProcess;
                    live.add(turnProcess);
                    turnId = current;
                    state = 'active';
                    turnStatus = 'inProgress';
                    finalResponse = null;
                    resumable = true;
                    contexts.push({turnId: current, recordSequence: contexts.length, model: settings.model, modelProvider: settings.modelProvider,
                        reasoningEffort: settings.reasoningEffort, cwd, permissionsRules, unknownReasons: []});
                    /** @type {Record<string, any>|null} */ let result = null;
                    createInterface({input: turnProcess.stdout}).on('line', line => {
                        try {
                            const event = JSON.parse(line);
                            if (event.type === 'result') result = event;
                        } catch { /* Only the result event is consumed. */ }
                    });
                    turnProcess.stderr.resume();
                    const finish = (/** @type {number|null} */ code) => {
                        if (child !== turnProcess) return;
                        child = null;
                        live.delete(turnProcess);
                        if (state === 'active') {
                            const succeeded = code === 0 && result?.is_error === false;
                            state = succeeded ? 'idle' : 'failed';
                            turnStatus = succeeded ? 'completed' : 'failed';
                            if (succeeded) finalResponse = String(result?.result);
                        }
                        const reported = result?.usage ?? {};
                        const input = (reported.input_tokens ?? 0) + (reported.cache_read_input_tokens ?? 0) + (reported.cache_creation_input_tokens ?? 0);
                        Object.assign(usage, {
                            inputTokens: /** @type {number} */ (usage.inputTokens) + input,
                            cachedInputTokens: /** @type {number} */ (usage.cachedInputTokens) + (reported.cache_read_input_tokens ?? 0),
                            cacheWriteInputTokens: /** @type {number} */ (usage.cacheWriteInputTokens) + (reported.cache_creation_input_tokens ?? 0),
                            outputTokens: /** @type {number} */ (usage.outputTokens) + (reported.output_tokens ?? 0),
                            totalTokens: /** @type {number} */ (usage.totalTokens) + input + (reported.output_tokens ?? 0),
                        });
                        onNotification({type: 'changed', threadId, turnId: current});
                    };
                    turnProcess.once('close', finish);
                    turnProcess.once('error', () => finish(null));
                    turnProcess.stdin.on('error', () => {}); // An early exit is reported by close.
                    turnProcess.stdin.end(handoff);
                    return {turnId: current};
                },
                async steer() {throw new Error('A Claude Reviewer turn cannot take instructions while it runs; send a follow-up after it ends.');},
                async snapshot() {
                    return {rootThreadId: /** @type {string} */ (threadId), environmentState: exited ? 'exited' : 'running',
                        members: threadId ? [member()] : [], factsComplete: true, unknownReasons: [], clientRequests: []};
                },
                async respond() {throw new Error('Claude Reviewer sessions have no pending requests.');},
                async rejectRequest() {throw new Error('Claude Reviewer sessions have no pending requests.');},
                async readThreadMetadata() {return {title: null, preview: '', sessionPath: null};},
                async idleFacts() {
                    return child ? {safe: false, known: true, reason: 'The Claude turn is running.'} : {safe: true, known: true, reason: null};
                },
                async cleanupTurnTerminals() {return {confirmed: true};},
                async interruptGroup() {
                    if (state !== 'active') throw new Error('The Claude Reviewer turn is not running.');
                    state = 'interrupted';
                    turnStatus = 'interrupted';
                    child?.kill();
                    return {accepted: true};
                },
                async stop() {
                    exited = true;
                    child?.kill();
                    return {environmentState: 'exited'};
                },
            };
            return session;
        },
    };
}
