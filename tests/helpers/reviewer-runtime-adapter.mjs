import {basename, dirname, relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {cloneJsonValue} from '../../lib/common/json.mjs';
import {createUsage} from '../../lib/reviewer-runtime/reviewer-measurement.mjs';
import {createScriptedScopedFilesystemFactory} from './scripted-filesystem.mjs';

/** @typedef {import('../../lib/background-agent/codex-app-server.mjs').NativeMember} NativeMember */
/** @typedef {import('../../lib/background-agent/codex-app-server.mjs').NativeSession} NativeSession */
/** @typedef {import('../../lib/background-agent/codex-app-server.mjs').NativeSessions} NativeSessions */
/** @typedef {import('../../lib/background-agent/codex-app-server.mjs').NativeSnapshot} NativeSnapshot */
/** @typedef {import('../../lib/background-agent/codex-app-server.mjs').NativeSettings} NativeSettings */
/** @typedef {import('../../lib/background-agent/codex-app-server.mjs').NativeNotification} NativeNotification */
/** @typedef {Awaited<ReturnType<import('../../lib/background-agent/manager.mjs').ManagedNativeSessions['open']>>} ManagedNativeSession */
/** @typedef {import('../../lib/background-agent/manager.mjs').ManagedObservation} ManagedObservation */
/** @typedef {{runId:string, notifications:ManagedObservation['notifications'], cursor:number, finished:boolean, waiters:Set<() => void>}} ScriptedQueue */
/** @typedef {{rootThreadId: string | null, environmentState: 'running' | 'exited', input: Parameters<import('../../lib/background-agent/manager.mjs').ManagedNativeSessions['open']>[0], stopFailure: boolean, factsComplete: boolean, clientRequests: NativeSnapshot['clientRequests'], queue:ScriptedQueue|null, attached:boolean, accepted:Map<string,string>, instructions:string}} ScriptedSessionState */

export const reviewerSettings = /** @type {NativeSettings} */ ({
    model: 'test-model', modelProvider: 'test-provider', reasoningEffort: 'high', serviceTier: 'default', config: {},
});

export const reviewerHandoff = {
    role: 'requirements-reviewer',
    identity: {kind: /** @type {'ordinary'} */ ('ordinary'), issueIds: ['issue:0093:01']},
    settings: reviewerSettings,
    instructions: 'Full Canonical Role and common Reviewer rules.',
    handoff: 'Review the complete prepared input and personally write the bound report.',
    cwd: '/review',
    writePaths: ['/review/.tmp/codex/test-session/0093_01/reports'],
    reportPath: '/review/.tmp/codex/test-session/0093_01/reports/report.md',
    stateDirectory: '/review/.tmp/codex/test-session/0093_01/runtime',
};

export const createReviewerTestClock = () => {
    let now = 1_000;
    return {
        now: () => now,
        advance(/** @type {number} */ milliseconds) {now += milliseconds;},
    };
};

export const createScriptedReviewerSessions = () => {
    /** @type {Map<string, NativeMember>} */
    const members = new Map();
    /** @type {ScriptedSessionState[]} */
    const sessions = [];
    /** @type {Map<string, ScriptedQueue>} */
    const queues = new Map();
    /** @type {Map<string, Set<string>>} */
    const backgroundTerminals = new Map();
    /** @type {Map<string, () => Promise<void>>} */
    const cleanupBehaviors = new Map();
    /** @type {Map<string, () => Promise<void>>} */
    const afterCleanupBehaviors = new Map();
    /** @type {Map<string, () => Promise<void>>} */
    const completionBehaviors = new Map();
    /** @type {Map<string, () => Promise<void>>} */
    const idleBehaviors = new Map();
    /** @type {Array<{operation: string, threadId?: string, turnId?: string, text?: string}>} */
    const calls = [];
    let nextThread = 0;
    let nextTurn = 0;
    let nextMessage = 0;

    /** @param {string} threadId @param {string} rootThreadId */
    const belongs = (threadId, rootThreadId) => {
        const seen = new Set();
        let current = members.get(threadId);
        while (current && !seen.has(current.threadId)) {
            if (current.threadId === rootThreadId) return true;
            seen.add(current.threadId);
            current = current.parentThreadId ? members.get(current.parentThreadId) : undefined;
        }
        return false;
    };
    /** @param {ScriptedSessionState} session @param {string | null} [threadId] */
    const emit = (session, threadId = session.rootThreadId) => {
        const notification = {type: /** @type {const} */ ('changed'), threadId, turnId: threadId ? members.get(threadId)?.turnId ?? null : null};
        if (session.queue) {
            session.queue.notifications.push({sequence: ++session.queue.cursor, ...notification});
            for (const waiter of [...session.queue.waiters]) waiter();
        }
        if (session.attached) session.input.onNotification(notification);
    };
    /** @param {string} threadId */
    const required = threadId => {
        const member = members.get(threadId);
        if (!member) throw Object.assign(new Error('The original native thread is unavailable.'), {code: 'thread-unavailable'});
        return member;
    };
    /** @param {ScriptedSessionState} session @param {NativeMember} member @param {string} text */
    const beginTurn = (session, member, text) => {
        const turnId = `turn-${++nextTurn}`;
        member.hasConversationHistory = true;
        if (session.queue) session.queue.finished = false;
        member.turnId = turnId;
        member.state = 'active';
        member.turnStatus = 'inProgress';
        member.finalResponse = null;
        member.contexts.push({
            turnId, recordSequence: member.contexts.length + 1,
            model: session.input.settings.model, modelProvider: session.input.settings.modelProvider,
            reasoningEffort: session.input.settings.reasoningEffort, cwd: session.input.cwd,
            permissionsRules: [
                {path: '/', access: 'deny'}, {path: ':minimal', access: 'read'},
                ...[session.input.cwd, ...session.input.readPaths].map(path => ({path, access: /** @type {'read'} */ ('read')})),
                ...session.input.writePaths.map(path => ({path, access: /** @type {'write'} */ ('write')})),
            ],
            unknownReasons: [],
        });
        calls.push({operation: 'startTurn', threadId: member.threadId, turnId, text});
        emit(session, member.threadId);
        return {turnId, messageId: `message-${++nextMessage}`, deliveryStatus: /** @type {const} */ ('consumed'), persistenceStatus: /** @type {const} */ ('persisted')};
    };

    /** @type {import('../../lib/background-agent/manager.mjs').ManagedNativeSessions} */
    const nativeSessions = {
        async open(input) {
            const state = /** @type {ScriptedSessionState} */ ({rootThreadId: null, environmentState: 'running', input, stopFailure: false, factsComplete: true, clientRequests: [], queue: null, attached: true, accepted: new Map(), instructions: ''});
            sessions.push(state);
            calls.push({operation: 'open'});
            /** @type {ManagedNativeSession} */
            const session = {
                get runId() { if (!state.queue) throw new Error('Scripted Reviewer has no run identity.'); return state.queue.runId; },
                managementState: () => state.environmentState === 'running' ? 'running' : 'exited',
                detach: () => {state.attached = false;},
                holdManagedWork: () => () => {},
                async observe({cursor}) {
                    const queue = state.queue;
                    if (!queue) throw new Error('Scripted Reviewer has no notification queue.');
                    return {notifications: queue.notifications.filter(item => item.sequence > cursor), cursor: queue.cursor, pendingRequests: state.clientRequests};
                },
                async waitNotifications({cursor, timeoutMs = 30_000, signal}) {
                    const queue = state.queue;
                    if (!queue) throw new Error('Scripted Reviewer has no notification queue.');
                    if (timeoutMs < 10_000 || timeoutMs > 3_600_000) throw new Error('Invalid wait timeout.');
                    if (queue.cursor <= cursor && !queue.finished && !signal?.aborted) {
                        await new Promise(resolve => {
                            const wake = () => {queue.waiters.delete(wake); signal?.removeEventListener('abort', wake); resolve(undefined);};
                            queue.waiters.add(wake);
                            signal?.addEventListener('abort', wake, {once: true});
                            if (signal?.aborted || queue.cursor > cursor || queue.finished) wake();
                        });
                    }
                    return {notifications: queue.notifications.filter(item => item.sequence > cursor), cursor: queue.cursor, pendingRequests: state.clientRequests};
                },
                async reserve() {
                    state.queue = {runId: randomUUID(), notifications: [], cursor: 0, finished: false, waiters: new Set()};
                    calls.push({operation: 'reserve'});
                    return {runId: state.queue.runId, threadId: null, sessionPath: null};
                },
                get previous() {return {runId: session.runId, threadId: state.rootThreadId, sessionPath: state.rootThreadId ? required(state.rootThreadId).sessionPath : null};},
                async acceptStart({handoff, instructions}) {
                    if (!state.queue) throw new Error('No reserved run.');
                    state.instructions = instructions;
                    const messageId = `message-${++nextMessage}`;
                    state.accepted.set(messageId, handoff);
                    calls.push({operation: 'acceptStart', text: handoff});
                    return {runId: state.queue.runId, messageId, deliveryStatus: /** @type {const} */ ('accepted'), recoveryPath: null};
                },
                async acceptTask({handoff, instructions, settings, cwd, readPaths, writePaths}) {
                    if (!state.queue || !state.rootThreadId) throw new Error('Original run unavailable.');
                    if (instructions) state.instructions = instructions;
                    if (settings) state.input.settings = settings;
                    if (cwd) state.input.cwd = cwd;
                    if (readPaths) state.input.readPaths = readPaths;
                    if (writePaths) state.input.writePaths = writePaths;
                    const messageId = `message-${++nextMessage}`;
                    state.accepted.set(messageId, handoff);
                    calls.push({operation: 'acceptTask', threadId: state.rootThreadId, text: handoff});
                    return {runId: state.queue.runId, messageId, deliveryStatus: /** @type {const} */ ('accepted')};
                },
                async prepareNativeStart() {return session.start({instructions: state.instructions});},
                async prepareForTask({messageId}) {
                    if (!state.accepted.has(messageId) || !state.rootThreadId) throw new Error('Accepted task missing.');
                    if (state.environmentState === 'exited') {
                        state.environmentState = 'running';
                        for (const member of members.values()) if (belongs(member.threadId, state.rootThreadId) && member.state === 'exited') member.state = 'idle';
                    }
                    calls.push({operation: 'prepareForTask', threadId: state.rootThreadId});
                    return {threadId: state.rootThreadId, sessionPath: required(state.rootThreadId).sessionPath};
                },
                async failAcceptedTask({messageId}) {
                    state.accepted.delete(messageId);
                },
                async dispatchAccepted({messageId}) {
                    const handoff = state.accepted.get(messageId);
                    if (!handoff || !state.rootThreadId) throw new Error('Accepted task missing.');
                    state.accepted.delete(messageId);
                    const result = beginTurn(state, required(state.rootThreadId), `ARW messageId: ${messageId}\n\n${handoff}`);
                    calls.push({operation: 'dispatchAccepted', threadId: state.rootThreadId, turnId: result.turnId, text: handoff});
                    return {turnId: result.turnId, messageId, deliveryStatus: 'delivered'};
                },
                async start({instructions}) {
                    const threadId = `thread-${++nextThread}`;
                    state.rootThreadId = threadId;
                    state.queue ??= {runId: randomUUID(), notifications: [], cursor: 0, finished: false, waiters: new Set()};
                    queues.set(threadId, state.queue);
                    const member = /** @type {NativeMember} */ ({
                        threadId, parentThreadId: null, hasConversationHistory: false, state: 'idle', turnId: null,
                        sessionPath: `/native/${threadId}.jsonl`, modelProvider: input.settings.modelProvider,
                        contexts: [], usage: createUsage(0), finalResponse: null,
                    });
                    members.set(threadId, member);
                    calls.push({operation: 'start', threadId, text: instructions});
                    return {threadId, sessionPath: /** @type {string} */ (member.sessionPath)};
                },
                async resume({runId, threadId, expectedSessionPath, instructions, deferRestore}) {
                    const member = required(threadId);
                    if (expectedSessionPath !== null && member.sessionPath !== expectedSessionPath) throw new Error('The original native record path differs.');
                    state.rootThreadId = threadId;
                    state.environmentState = deferRestore
                        ? sessions.find(candidate => candidate !== state && candidate.rootThreadId === threadId)?.environmentState ?? 'running'
                        : 'running';
                    state.queue = queues.get(threadId) ?? {runId: runId ?? randomUUID(), notifications: [], cursor: 0, finished: false, waiters: new Set()};
                    if (runId && state.queue.runId !== runId) throw new Error('The original managed run differs.');
                    queues.set(threadId, state.queue);
                    if (!deferRestore) for (const child of members.values()) {
                        if (belongs(child.threadId, threadId) && child.state === 'exited') child.state = 'idle';
                    }
                    calls.push({operation: 'resume', threadId, text: instructions});
                    return {threadId, sessionPath: member.sessionPath};
                },
                async startTurn({threadId, handoff}) { return beginTurn(state, required(threadId), handoff); },
                async steer({threadId, turnId, instruction}) {
                    const member = required(threadId);
                    if (member.state !== 'active' || member.turnId !== turnId) throw Object.assign(new Error('The active native turn differs.'), {code: 'turn-mismatch'});
                    calls.push({operation: 'steer', threadId, turnId, text: instruction});
                    emit(state, threadId);
                    return {turnId, messageId: `message-${++nextMessage}`, deliveryStatus: /** @type {const} */ ('consumed'), persistenceStatus: /** @type {const} */ ('persisted')};
                },
                async snapshot({rootThreadId, knownThreadIds = []}) {
                    calls.push({operation: 'snapshot', threadId: rootThreadId});
                    const snapshotMembers = [...members.values()].filter(member => belongs(member.threadId, rootThreadId) || knownThreadIds.includes(member.threadId));
                    return /** @type {NativeSnapshot} */ (cloneJsonValue({
                        rootThreadId, environmentState: state.environmentState, members: snapshotMembers,
                        factsComplete: state.factsComplete, unknownReasons: state.factsComplete ? [] : ['Injected incomplete native discovery.'],
                        clientRequests: state.clientRequests,
                    }));
                },
                async respond({requestId, response}) {
                    const index = state.clientRequests.findIndex(request => request.requestId === requestId);
                    if (index < 0) throw new Error('Native request is no longer pending.');
                    calls.push({operation: 'respond', text: JSON.stringify({requestId, response})});
                    state.clientRequests.splice(index, 1);
                    return {accepted: true};
                },
                async rejectRequest({requestId}) {
                    const index = state.clientRequests.findIndex(request => request.requestId === requestId);
                    if (index < 0) throw new Error('Native request is no longer pending.');
                    calls.push({operation: 'rejectRequest', text: requestId});
                    state.clientRequests.splice(index, 1);
                    return {accepted: true};
                },
                async readThreadMetadata({threadId}) {
                    return {title: null, preview: `First user message for ${threadId}`, sessionPath: required(threadId).sessionPath};
                },
                async idleFacts({rootThreadId}) {
                    await idleBehaviors.get(rootThreadId)?.();
                    const membersInRoot = [...members.values()].filter(member => belongs(member.threadId, rootThreadId));
                    return {
                        known: state.factsComplete,
                        safe: state.factsComplete && state.clientRequests.length === 0
                            && membersInRoot.every(member => ['idle', 'interrupted', 'failed'].includes(member.state)
                                && !backgroundTerminals.get(member.threadId)?.size),
                        reason: membersInRoot.some(member => backgroundTerminals.get(member.threadId)?.size)
                            ? 'Native background terminal is running.' : null,
                    };
                },
                async protectTurn({rootThreadId, turnId}) {
                    const root = required(rootThreadId);
                    if (state.rootThreadId !== rootThreadId || root.turnId !== turnId) throw new Error('The protected turn changed.');
                    return {confirmed: /** @type {const} */ (true)};
                },
                async cleanupTurnTerminals({rootThreadId, turnId}) {
                    const root = required(rootThreadId);
                    if (state.rootThreadId !== rootThreadId || root.turnId !== turnId || root.state !== 'idle') {
                        throw new Error('The completed Reviewer turn changed before terminal cleanup.');
                    }
                    await cleanupBehaviors.get(rootThreadId)?.();
                    if (root.turnId !== turnId || root.state !== 'idle') {
                        throw new Error('The completed Reviewer turn changed during terminal cleanup.');
                    }
                    for (const member of members.values()) {
                        if (belongs(member.threadId, rootThreadId)) backgroundTerminals.delete(member.threadId);
                    }
                    await afterCleanupBehaviors.get(rootThreadId)?.();
                    return {confirmed: /** @type {const} */ (true)};
                },
                async releaseProtectedTurn({rootThreadId, turnId}) {
                    const root = required(rootThreadId);
                    if (state.rootThreadId !== rootThreadId || root.turnId !== turnId || !['idle', 'interrupted', 'failed'].includes(root.state)) {
                        throw new Error('The completed Reviewer turn changed before final idle confirmation.');
                    }
                    if (root.state === 'idle') await completionBehaviors.get(rootThreadId)?.();
                    return {confirmed: /** @type {const} */ (true)};
                },
                async interruptGroup({rootThreadId, turnId}) {
                    const root = required(rootThreadId);
                    if (root.turnId !== turnId || root.state !== 'active') throw new Error('The root turn is not active.');
                    for (const member of members.values()) if (belongs(member.threadId, rootThreadId) && member.state === 'active') {
                        member.state = 'interrupted';
                        member.turnStatus = 'interrupted';
                    }
                    calls.push({operation: 'interruptGroup', threadId: rootThreadId, turnId});
                    emit(state, rootThreadId);
                    return {accepted: true};
                },
                async stop() {
                    calls.push({operation: 'stop', ...(state.rootThreadId ? {threadId: state.rootThreadId} : {})});
                    if (state.stopFailure) throw new Error('Injected native exit failure.');
                    const rootThreadId = state.rootThreadId;
                    if (rootThreadId && [...members.values()].some(member => belongs(member.threadId, rootThreadId)
                        && backgroundTerminals.get(member.threadId)?.size)) throw new Error('Native background tool remains active.');
                    state.environmentState = 'exited';
                    if (state.queue) {
                        state.queue.finished = true;
                        for (const waiter of [...state.queue.waiters]) waiter();
                    }
                    for (const member of members.values()) if (state.rootThreadId && belongs(member.threadId, state.rootThreadId)) member.state = 'exited';
                    state.input.onUnloaded?.();
                    if (state.attached) state.input.onNotification({type: 'exited', reason: null});
                    return {environmentState: 'exited'};
                },
            };
            return session;
        },
    };
    return {
        nativeSessions, sessions, members, calls, backgroundTerminals, cleanupBehaviors, afterCleanupBehaviors, completionBehaviors, idleBehaviors,
        exit() {
            for(const session of sessions){session.environmentState='exited';session.attached=false;}
            for(const member of members.values())member.state='exited';
        },
        emit(/** @type {string} */ rootThreadId) {
            const session = [...sessions].reverse().find(candidate => candidate.rootThreadId === rootThreadId && candidate.environmentState === 'running');
            if (session) emit(session);
        },
        addHelper(/** @type {string} */ rootThreadId, /** @type {{parentThreadId?: string, state?: NativeMember['state'], model?: string, reasoningEffort?: string}} */ options = {}) {
            const session = [...sessions].reverse().find(candidate => candidate.rootThreadId === rootThreadId && candidate.environmentState === 'running');
            if (!session) throw new Error('No active scripted Reviewer session.');
            const threadId = `thread-${++nextThread}`;
            const member = /** @type {NativeMember} */ ({
                threadId, parentThreadId: options.parentThreadId ?? rootThreadId, hasConversationHistory: false, state: 'idle', turnId: null,
                sessionPath: `/native/${threadId}.jsonl`, modelProvider: session.input.settings.modelProvider,
                contexts: [], usage: createUsage(0), finalResponse: null,
            });
            members.set(threadId, member);
            beginTurn(session, member, 'Assigned independent check.');
            member.state = options.state ?? 'active';
            if (options.model) member.contexts[0].model = options.model;
            if (options.reasoningEffort) member.contexts[0].reasoningEffort = options.reasoningEffort;
            return threadId;
        },
        finish(/** @type {string} */ threadId, /** @type {string} */ finalResponse = '{"status":"ready"}') {
            const member = required(threadId);
            member.state = 'idle';
            member.turnStatus = 'completed';
            member.finalResponse = finalResponse;
            const session = [...sessions].reverse().find(candidate => candidate.environmentState === 'running' && candidate.rootThreadId && belongs(threadId, candidate.rootThreadId));
            if (session) {
                if (session.queue) {
                    session.queue.finished = true;
                    for (const waiter of [...session.queue.waiters]) waiter();
                }
                emit(session, threadId);
            }
        },
        message(/** @type {string} */ threadId, /** @type {string} */ text) {
            const session = [...sessions].reverse().find(candidate => candidate.environmentState === 'running' && candidate.rootThreadId && belongs(threadId, candidate.rootThreadId));
            if (!session?.queue) throw new Error('No active scripted Reviewer queue.');
            const messageId = `message-${++nextMessage}`;
            session.queue.notifications.push({sequence: ++session.queue.cursor, type: 'message', messageId, threadId, turnId: required(threadId).turnId, text,
                deliveryStatus: 'consumed', persistenceStatus: 'persisted'});
            for (const waiter of [...session.queue.waiters]) waiter();
            if (session.attached) session.input.onNotification({type: 'changed', threadId, turnId: required(threadId).turnId});
            return messageId;
        },
        nativeOutput(/** @type {string} */ threadId) {
            const session = [...sessions].reverse().find(candidate => candidate.environmentState === 'running' && candidate.rootThreadId && belongs(threadId, candidate.rootThreadId));
            if (session) emit(session, threadId);
        },
    };
};

export const createReviewerRuntimeFixture = (/** @type {{filesystemFailures?: Array<{operation: string, path?: string, result: object}>, handoff?: typeof reviewerHandoff}} */ {filesystemFailures = [], handoff = reviewerHandoff} = {}) => {
    const files = new Map([[basename(handoff.reportPath), Buffer.alloc(0)]]);
    const repositoryRoot = reviewerHandoff.cwd;
    const sessionWorkspaceRoot = '/review/.tmp/codex/test-session';
    const recoveryDirectory = relative(repositoryRoot, handoff.stateDirectory).split('\\').join('/');
    const reportRelativePath = relative(handoff.cwd, handoff.reportPath).split('\\').join('/');
    const repositoryFiles = new Map([[`${recoveryDirectory}/.prepared`, Buffer.alloc(0)]]);
    if (handoff.cwd === repositoryRoot) repositoryFiles.set(reportRelativePath, Buffer.alloc(0));
    const roots = new Map([[repositoryRoot, repositoryFiles], [dirname(handoff.reportPath), files]]);
    if (handoff.cwd !== repositoryRoot) roots.set(handoff.cwd, new Map([[reportRelativePath, Buffer.alloc(0)]]));
    const filesystem = createScriptedScopedFilesystemFactory({
        roots,
        failures: filesystemFailures,
    });
    const native = createScriptedReviewerSessions();
    const clock = createReviewerTestClock();
    return {
        filesystem, native, clock,
        recoveryBoundary: () => ({repositoryRoot, sessionWorkspaceRoot}),
        async writeReport(/** @type {string} */ text, /** @type {string} */ path = handoff.reportPath) {
            for (const root of [handoff.cwd, dirname(path)]) {
                const opened = await filesystem.open({root, createRoot: root !== handoff.cwd});
                if (opened.status !== 'succeeded') throw new Error('Scripted report directory unavailable.');
                const logicalPath = relative(root, path).split('\\').join('/');
                if (root === handoff.cwd) {
                    const directory = relative(root, dirname(path)).split('\\').join('/');
                    const created = await opened.scopedFilesystem.createDirectory({path: directory, recursive: true});
                    if (created.status !== 'succeeded') throw new Error('Scripted report directory could not be created.');
                }
                const existing = await opened.scopedFilesystem.inspect({path: logicalPath});
                if (existing.status !== 'succeeded') throw new Error('Scripted report binding unavailable.');
                const written = await opened.scopedFilesystem.write({path: logicalPath, bytes: Buffer.from(text), mode: existing.entry.kind === 'missing' ? 'create' : 'replace'});
                if (written.status !== 'succeeded') throw new Error('Scripted Reviewer report write failed.');
            }
        },
    };
};
