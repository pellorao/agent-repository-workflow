import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {loadConfig} from '../arw-common/config.mjs';
import {REVIEWER_ROLES} from '../arw-common/reviewer-configuration.mjs';
import {claudeConfigDirectory, messageText, readClaudeSession} from './claude-consumption.mjs';
import {claudeProcessIdentityPath, readClaudeProcessIdentities, readOperatingSystemProcessCreationTime, recordProcessIdentity, removeEndedProcessIdentity} from './process-identity.mjs';
import {createUsage} from './usage.mjs';
import {REVIEWER_GIT_COMMANDS} from '../reviewer-runtime/reviewer-native-policy.mjs';

/** @typedef {import('./codex-app-server.mjs').NativeSessions} NativeSessions */
/** @typedef {import('./codex-app-server.mjs').NativeSession} NativeSession */
/** @typedef {import('./codex-app-server.mjs').NativeMember} NativeMember */
/** @typedef {import('./codex-app-server.mjs').NativeSpawn} NativeSpawn */
/** @typedef {import('./codex-app-server.mjs').NativeProcess} NativeProcess */
/** @typedef {import('./codex-app-server.mjs').NativeClientRequest} NativeClientRequest */


// The Reviewer final status; `claude -p` rejects a top-level union, so `if` keeps `ready` alone and requires a reason otherwise.
const FINAL_STATUS_SCHEMA = JSON.stringify({type: 'object', properties: {status: {enum: ['ready', 'incomplete']}, reason: {type: 'string', pattern: '\\S'}},
    required: ['status'], additionalProperties: false, if: {properties: {status: {const: 'ready'}}}, then: {maxProperties: 1}, else: {required: ['reason']}});
// Read-only git commands let the Reviewer read the staged index; `--output` is denied because it writes a file.
// Rules match command prefixes, so `git -C <path>` is allowed only with the exact working directory.
const readOnlyGit = (/** @type {string} */ cwd) => ['', `-C ${cwd} `].flatMap(prefix => REVIEWER_GIT_COMMANDS.map(command => `Bash(git ${prefix}${command}:*)`));
/** ARW input, like the Codex count, includes cache reads and writes; Claude reports them apart. @param {Record<string, number>} [usage] */
const usageCounts = (usage = {}) => {
    const {input_tokens: fresh = 0, cache_read_input_tokens: cacheRead = 0, cache_creation_input_tokens: cacheWrite = 0, output_tokens: output = 0} = usage;
    return {input: fresh + cacheRead + cacheWrite, cacheRead, cacheWrite, output};
};
/**
 * Model phase facts of one turn from the request status, each response start, its generated deltas and its final output count.
 * @param {import('./native-measurement.mjs').NativeResponseMeasurement[]} responses @param {string} threadId @param {string} turnId
 */
const observeModelPhases = (responses, threadId, turnId) => {
    /** @type {number|null} */ let requestedAt = null;
    /** @type {import('./native-measurement.mjs').NativeResponseMeasurement|null} */ let response = null;
    return (/** @type {Record<string, any>} */ event) => {
        if (event.type === 'system' && event.status === 'requesting') requestedAt = Date.now();
        if (event.type !== 'stream_event') return;
        const {type, message, delta, usage} = event.event ?? {};
        if (type === 'message_start' && typeof message?.id === 'string') {
            const {input, cacheRead} = usageCounts(message.usage);
            response = {threadId, responseId: message.id, turnId, recordSequence: responses.length, startedAt: requestedAt, completedAt: null,
                inputTokens: input, cachedInputTokens: cacheRead, outputTokens: null, firstGeneratedAt: null, lastGeneratedAt: null, source: 'existing-events',
                basis: 'Times are when the manager read the Claude request status and stream events from the turn process stdout.'};
            responses.push(response);
            requestedAt = null;
        } else if (type === 'content_block_delta' && response && (delta?.text || delta?.thinking || delta?.partial_json)) {
            response.firstGeneratedAt ??= Date.now();
            response.lastGeneratedAt = Date.now();
        } else if (type === 'message_delta' && response) {
            response.outputTokens = usage?.output_tokens ?? null;
            response.completedAt = Date.now();
        }
    };
};
/**
 * Claude backend: each turn is one headless `claude -p` that keeps stream-json stdin open, so Main and program
 * instructions reach the running turn; its permission requests come to the manager over the same stdio.
 * The turn ends when every written message was taken up and a `result` followed; the process then exits.
 * Each running process records its identity under the runtime directory so a later manager can confirm its exit.
 * @param {{runtimeDirectory:string,executable?:string,environment?:NodeJS.ProcessEnv,spawnProcess?:NativeSpawn,readCreationTime?:(pid:number)=>Promise<string|null>}} options
 * @returns {NativeSessions}
 */
export function createClaudeSessions({runtimeDirectory, executable = 'claude', environment = process.env,
    spawnProcess = (command, args, options) => spawn(command, args, options), readCreationTime = readOperatingSystemProcessCreationTime}) {
    /** @type {Map<NativeProcess, {threadId:string, exit:Promise<void>}>} */
    const live = new Map();
    const projects = join(claudeConfigDirectory(environment), 'projects');
    /** @param {NativeProcess} child */
    const terminate = child => {child.kill('SIGTERM'); return live.get(child)?.exit;};
    return {
        async ensureServer() {},
        async observeServer() {return 'absent';},
        async close() {
            await Promise.all([...live.keys()].map(terminate));
            return {environmentState: 'exited'};
        },
        // A process left by an earlier manager keeps its thread unknown until its recorded identity has ended.
        async unresolvedProcesses() {
            /** @type {string[]} */ const unresolved = [];
            for (const {threadId, path, observation} of await readClaudeProcessIdentities({runtimeDirectory, readCreationTime})) {
                if (observation.state === 'ended') await unlink(path);
                else if (![...live.values()].some(process => process.threadId === threadId)) unresolved.push(threadId);
            }
            return unresolved;
        },
        async open({settings, role, cwd, readPaths, writePaths, runId, onNotification}) {
            const reviewer = REVIEWER_ROLES.includes(String(role));
            /** @type {string|null} */ let threadId = null;
            /** @type {string|null} */ let turnId = null;
            /** @type {NativeMember['state']} */ let state = 'idle';
            /** @type {string|null} */ let turnStatus = null;
            /** @type {string|null} */ let finalResponse = null;
            /** @type {NativeProcess|null} */ let child = null;
            /** @type {NativeMember['contexts']} */ const contexts = [];
            /** @type {Map<string, NativeClientRequest>} */ const requests = new Map();
            /** @type {NonNullable<import('./codex-app-server.mjs').NativeSnapshot['userMessages']>} */ const userMessages = [];
            /** @type {import('./native-measurement.mjs').NativeResponseMeasurement[]} */ const responses = [];
            const usage = createUsage(0);
            let instructions = '';
            let resumable = false;
            let exited = false;
            /** @type {{state:'working'|'unavailable',at:number}|null} */ let work = null;
            const permissionsRules = /** @type {import('./codex-app-server.mjs').NativePermissionRule[]} */ ([
                ...[cwd, ...readPaths].map(path => ({path, access: 'read'})), ...writePaths.map(path => ({path, access: 'write'}))]);
            /** @returns {NativeMember} */
            const member = () => ({threadId: /** @type {string} */ (threadId), parentThreadId: null, state: exited ? 'exited' : state,
                turnId, turnStatus, sessionPath: join(projects, cwd.replace(/[^A-Za-z0-9]/g, '-'), `${threadId}.jsonl`),
                modelProvider: settings.modelProvider, contexts, usage, finalResponse, hasConversationHistory: resumable});
            // Messages written to the running turn that the model has not taken up yet; ending stops new writes.
            /** @type {string[]} */ let unconsumed = [];
            let ending = false;
            /** @param {string} text */
            const write = text => new Promise((resolve, reject) => {
                unconsumed.push(text);
                /** @type {NativeProcess} */ (child).stdin.write(`${JSON.stringify({type: 'user', message: {role: 'user', content: text}})}\n`,
                    error => error ? reject(error) : resolve(undefined));
            });
            /** @param {string} requestId @param {Record<string, unknown>} response */
            const answer = (requestId, response) => {
                if (!requests.delete(requestId) || !child || ending) throw new Error('Native request is no longer pending.');
                child.stdin.write(`${JSON.stringify({type: 'control_response', response: {subtype: 'success', request_id: requestId, response}})}\n`);
                onNotification({type: 'changed', threadId, turnId});
                return /** @type {{accepted: true}} */ ({accepted: true});
            };
            /** @type {NativeSession} */
            const session = {
                async start(input) {
                    threadId = randomUUID();
                    instructions = input.instructions;
                    work = {state: 'working', at: Date.now()};
                    return {threadId, sessionPath: member().sessionPath};
                },
                async resume(input) {
                    threadId = input.threadId;
                    instructions = input.instructions;
                    resumable = true;
                    work = {state: 'working', at: Date.now()};
                    return {threadId, sessionPath: member().sessionPath};
                },
                async startTurn({handoff}) {
                    if (child) throw new Error('A Claude turn is already running.');
                    const current = `turn-${randomUUID()}`;
                    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--replay-user-messages', '--include-partial-messages',
                        '--model', settings.model, '--effort', settings.reasoningEffort,
                        ...(existsSync(/** @type {string} */ (member().sessionPath)) ? ['--resume', /** @type {string} */ (threadId)] : ['--session-id', /** @type {string} */ (threadId)]),
                        '--append-system-prompt', instructions,
                        // A Reviewer keeps its read-only tool set and final status; other roles use the default tools.
                        ...(reviewer ? ['--json-schema', FINAL_STATUS_SCHEMA, '--tools', 'Read,Grep,Glob,Edit,Write,Bash',
                            '--disallowedTools', 'Bash(git *--output*)', 'Bash(git *--no-index*)'] : []),
                        // Requests outside the allowed rules come to the manager, which declines or forwards them with a reason.
                        '--permission-mode', 'default', '--permission-prompt-tool', 'stdio', '--strict-mcp-config', '--setting-sources', '',
                        // `--setting-sources ''` alone still loads auto-memory; `--safe-mode` also drops every CLAUDE.md, memory, hook and plugin.
                        '--safe-mode',
                        ...[...readPaths, ...writePaths].flatMap(path => ['--add-dir', path]),
                        // `//` marks an absolute path in Claude permission rules; Edit rules also govern Write.
                        '--allowedTools', 'Bash(arw background-agent:*)', ...(reviewer ? readOnlyGit(cwd) : []), ...writePaths.map(path => `Edit(/${path}/**)`)];
                    // A role that falls back to the Claude defaults (provider not `anthropic`) runs without its `env`.
                    const configured = reviewer ? (await loadConfig(/** @type {string} */ (settings.programDirectory))).reviewers?.[/** @type {string} */ (role)] : undefined;
                    const env = {...environment, ...(configured?.modelProvider === 'anthropic' ? configured.env : undefined),
                        ...(runId ? {ARW_BACKGROUND_AGENT_RUN_ID: runId} : {}),
                        // Background shell tasks would outlive the turn; without them the process exit ends every tool.
                        CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1'};
                    const turnProcess = spawnProcess(executable, args, {cwd, env, stdio: 'pipe', shell: false, windowsHide: true});
                    const identityPath = claudeProcessIdentityPath(runtimeDirectory, /** @type {string} */ (threadId));
                    const recorded = (async () => {
                        const createdAt = turnProcess.pid ? await readCreationTime(turnProcess.pid) : null;
                        if (!createdAt) throw new Error('Claude process identity is unavailable.');
                        const identity = {pid: /** @type {number} */ (turnProcess.pid), createdAt};
                        await recordProcessIdentity({runtimeDirectory, path: identityPath, identity});
                        return identity;
                    })();
                    child = turnProcess;
                    turnId = current;
                    state = 'active';
                    turnStatus = 'inProgress';
                    finalResponse = null;
                    resumable = true;
                    unconsumed = [];
                    ending = false;
                    contexts.push({turnId: current, recordSequence: contexts.length, model: settings.model, modelProvider: settings.modelProvider,
                        reasoningEffort: settings.reasoningEffort, cwd, permissionsRules, unknownReasons: []});
                    /** @type {Record<string, any>|null} */ let result = null;
                    const observePhases = observeModelPhases(responses, /** @type {string} */ (threadId), current);
                    /** Applies one stdout event of this turn: a taken-up message echo, a permission request or its cancellation, or a result. */
                    const readEvent = (/** @type {string} */ line) => {
                        let event;
                        try {event = JSON.parse(line);}
                        catch {return;}
                        observePhases(event);
                        const text = event.type === 'user' ? messageText(event.message?.content) : null;
                        // Queued messages may be echoed together, so each written text found in the echo is taken up.
                        if (text !== null && unconsumed.some(item => text.includes(item))) {
                            unconsumed = unconsumed.filter(item => !text.includes(item));
                            userMessages.push({itemId: null, threadId: /** @type {string} */ (threadId), turnId: current, text, recordSequence: userMessages.length});
                        } else if (event.type === 'control_request' && event.request?.subtype === 'can_use_tool') {
                            const {tool_name: toolName, input, decision_reason: reason} = event.request;
                            requests.set(event.request_id, {requestId: event.request_id, kind: 'approval', method: 'can_use_tool',
                                params: {toolName, input, reason}, threadId, turnId: current});
                            onNotification({type: 'changed', threadId, turnId: current});
                        } else if (event.type === 'control_cancel_request') {
                            requests.delete(event.request_id);
                        } else if (event.type === 'result') {
                            result = event;
                            const {input, cacheRead, cacheWrite, output} = usageCounts(event.usage);
                            Object.assign(usage, {
                                inputTokens: /** @type {number} */ (usage.inputTokens) + input,
                                cachedInputTokens: /** @type {number} */ (usage.cachedInputTokens) + cacheRead,
                                cacheWriteInputTokens: /** @type {number} */ (usage.cacheWriteInputTokens) + cacheWrite,
                                outputTokens: /** @type {number} */ (usage.outputTokens) + output,
                                totalTokens: /** @type {number} */ (usage.totalTokens) + input + output,
                            });
                            // A message queued behind a successful result runs as the next Claude turn within the same ARW turn.
                            if (!unconsumed.length || event.is_error) {
                                ending = true;
                                turnProcess.stdin.end();
                            }
                        }
                    };
                    createInterface({input: turnProcess.stdout}).on('line', readEvent);
                    turnProcess.stderr.resume();
                    turnProcess.stdin.on('error', () => {}); // An early exit is reported by close.
                    live.set(turnProcess, {threadId: /** @type {string} */ (threadId), exit: new Promise(resolve => {
                        let done = false;
                        const finish = async (/** @type {number|null} */ code) => {
                            if (done) return;
                            done = true;
                            const identity = await recorded.catch(() => null);
                            if (identity) await removeEndedProcessIdentity({runtimeDirectory, path: identityPath, identity, readCreationTime}).catch(() => {});
                            live.delete(turnProcess);
                            child = null;
                            requests.clear();
                            if (state === 'active') {
                                const succeeded = ending && code === 0 && result?.is_error === false;
                                state = succeeded ? 'idle' : 'failed';
                                turnStatus = succeeded ? 'completed' : 'failed';
                                if (succeeded) finalResponse = String(result?.result);
                            }
                            onNotification({type: 'changed', threadId, turnId: current});
                            resolve(undefined);
                        };
                        turnProcess.once('close', finish);
                        turnProcess.once('error', () => finish(null));
                    })});
                    // A process without a recorded identity could outlive a manager failure unseen, so it does not run.
                    try {await recorded;}
                    catch (error) {await terminate(turnProcess); throw error;}
                    await write(handoff);
                    return {turnId: current};
                },
                async steer({turnId: expected, instruction}) {
                    if (!child || ending || state !== 'active' || expected !== turnId) throw new Error('The Claude turn has ended.');
                    await write(instruction);
                    return {turnId: expected};
                },
                async snapshot() {
                    return {rootThreadId: /** @type {string} */ (threadId), environmentState: exited ? 'exited' : 'running',
                        members: threadId ? [member()] : [], factsComplete: true, unknownReasons: [], clientRequests: [...requests.values()], userMessages: [...userMessages],
                        measurementFacts: {responses: responses.map(item => ({...item})), requestsComplete: false,
                            ...(work ? {workState: {...work, estimated: true, basis: 'Session start or resume and the confirmed exit of the running turn process on stop, observed by the manager; the actual boundaries may precede these observations.'}} : {}),
                            workCoverage: {complete: false, basis: 'Coverage is limited to the session start, resume and stop the manager observed.'}}};
                },
                async respond({requestId, response}) {
                    if (response.behavior === 'deny' && typeof response.message === 'string') return answer(requestId, response);
                    if (response.behavior === 'allow') return answer(requestId, {updatedInput: requests.get(requestId)?.params.input, ...response});
                    throw new Error('A Claude permission response needs behavior allow, or deny with a message.');
                },
                async rejectRequest({requestId, reason}) {return answer(requestId, {behavior: 'deny', message: reason});},
                async readThreadMetadata({threadId: requested}) {
                    const {title, sessionPath} = await readClaudeSession({threadId: requested, environment});
                    return {title, sessionPath};
                },
                async idleFacts() {
                    return child ? {safe: false, known: true, reason: 'The Claude turn is running.'} : {safe: true, known: true, reason: null};
                },
                // The turn ends only after its process exited, and background shell tasks are disabled.
                async cleanupTurnTerminals() {return {confirmed: true};},
                async interruptGroup() {
                    if (state !== 'active' || !child) throw new Error('The Claude turn is not running.');
                    state = 'interrupted';
                    turnStatus = 'interrupted';
                    await terminate(child);
                    return {accepted: true};
                },
                async stop() {
                    exited = true;
                    if (child) await terminate(child);
                    work = {state: 'unavailable', at: Date.now()};
                    return {environmentState: 'exited'};
                },
            };
            return session;
        },
    };
}
