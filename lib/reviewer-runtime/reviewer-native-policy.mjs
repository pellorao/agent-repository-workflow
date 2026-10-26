import {randomUUID} from 'node:crypto';

/** @typedef {import('../background-agent/codex-app-server.mjs').NativeSettings} NativeSettings */

/** Read-only git commands a Reviewer may run; `--output` and `--no-index` stay denied. */
export const REVIEWER_GIT_COMMANDS = ['show', 'diff', 'log', 'ls-files', 'ls-tree', 'cat-file'];

/** @param {NativeSettings} settings @param {{cwd: string, readPaths: string[], writePaths: string[]}} paths @returns {NativeSettings} */
export const reviewerNativeSettings = (settings, {cwd, readPaths, writePaths}) => {
    const profile = `arw-reviewer-${randomUUID()}`;
    /** @type {Record<string, 'read' | 'write'>} */
    const filesystem = {[cwd]: 'read'};
    for (const path of readPaths) filesystem[path] = 'read';
    for (const path of writePaths) filesystem[path] = 'write';
    /** @type {NativeSettings['config']} */
    const config = {
        ...settings.config,
        model: settings.model,
        model_provider: settings.modelProvider,
        model_reasoning_effort: settings.reasoningEffort,
        service_tier: settings.serviceTier,
        'agents.enabled': false,
        'features.multi_agent': false,
        'features.multi_agent_v2': false,
        approval_policy: 'on-request',
        approvals_reviewer: 'auto_review',
        [`permissions.${profile}.extends`]: ':read-only',
        [`permissions.${profile}.filesystem`]: filesystem,
        default_permissions: profile,
    };
    for (const key of ['agents', 'features']) {
        const value = settings.config[key];
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            config[key] = key === 'agents'
                ? {...value, enabled: false}
                : {...value, multi_agent: false, multi_agent_v2: false};
        }
    }
    return {...settings, config};
};

/** @param {import('../background-agent/codex-app-server.mjs').NativeSession} session @param {import('../background-agent/codex-app-server.mjs').NativeClientRequest[]} requests */
export const declineReviewerInteractions = async (session, requests) => {
    for (const request of requests) {
        const reason = `The Reviewer cannot obtain external input or manual approval for ${request.method}. Continue this review with authorized evidence. If this check is necessary and cannot proceed, explain why the report is incomplete.`;
        const legacy = ['execCommandApproval', 'applyPatchApproval'].includes(request.method);
        if (!request.threadId) throw new Error('Native interaction is not bound to the Reviewer root.');
        if (request.method === 'can_use_tool') {
            // The Claude backend shows this message as the tool result, so the turn continues without another instruction.
            await session.respond({requestId: request.requestId, response: {behavior: 'deny', message: `${reason} Denied ${String(request.params.toolName)}: ${String(request.params.reason ?? 'it is outside the allowed rules')}. Use Read, Grep or Glob inside the working directory, the allowed read-only git commands (${REVIEWER_GIT_COMMANDS.join(', ')}), and write only the bound report.`}});
            continue;
        }
        let turnId = request.turnId;
        if (!legacy && !turnId) {
            const snapshot = await session.snapshot({rootThreadId: request.threadId});
            const root = snapshot.members.find(member => member.threadId === request.threadId);
            if (!snapshot.factsComplete || root?.state !== 'active' || !root.turnId) {
                throw new Error('Native interaction is not bound to an active Reviewer turn.');
            }
            turnId = root.turnId;
        }
        if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(request.method)) {
            await session.respond({requestId: request.requestId, response: {decision: 'decline'}});
        } else if (legacy) {
            await session.respond({requestId: request.requestId, response: {decision: {denied: {rejection: reason}}}});
        } else if (request.method === 'item/permissions/requestApproval') {
            await session.respond({requestId: request.requestId, response: {permissions: {}, scope: 'turn'}});
        } else if (request.method === 'mcpServer/elicitation/request') {
            await session.respond({requestId: request.requestId, response: {action: 'decline', content: null}});
        } else {
            await session.rejectRequest({requestId: request.requestId, reason});
        }
        if (!legacy) await session.steer({threadId: request.threadId, turnId: /** @type {string} */ (turnId), instruction: reason});
    }
};
