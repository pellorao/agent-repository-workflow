import {mkdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';

import {formatArtifactIdentityKey, parseCanonicalArtifactId} from './artifacts.mjs';

const PATH_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const SUPPORTED_CLI_PLATFORMS = new Set(['claude-code', 'codex']);

/** @typedef {{agentIdentity: unknown, issueId?: unknown, purpose?: unknown, repositoryRoot: string}} TemporaryWorkspaceRequest */

/** @param {unknown} value @param {string} label @returns {string} */
const requirePathSegment = (value, label) => {
    if (typeof value !== 'string' || !PATH_SEGMENT.test(value)) {
        throw new Error(`${label} must be a non-empty safe path segment.`);
    }
    return value;
};

/** @param {unknown} agentIdentity */
const workspaceIdentity = agentIdentity => {
    if (agentIdentity === null
        || typeof agentIdentity !== 'object'
        || Array.isArray(agentIdentity)
        || !('platform' in agentIdentity)
        || !('sessionId' in agentIdentity)) {
        throw new Error('Temporary workspace requires a Platform Adapter identity result.');
    }
    const platform = requirePathSegment(agentIdentity.platform, 'Platform Adapter platform');
    if (!SUPPORTED_CLI_PLATFORMS.has(platform)) {
        throw new Error('Platform Adapter platform must be one of: claude-code, codex.');
    }
    return {
        platform,
        sessionId: requirePathSegment(agentIdentity.sessionId, 'Platform Adapter session identity'),
    };
};

/** @param {{issueId: unknown, purpose: unknown}} options @returns {string[]} */
const workspaceSegments = ({issueId, purpose}) => {
    if (issueId === undefined) {
        if (purpose === undefined) return [];
        const nestedPurpose = requirePathSegment(purpose, 'Temporary workspace purpose');
        if (!nestedPurpose.startsWith('_')) {
            throw new Error('A temporary workspace without an issue requires a purpose that starts with _.');
        }
        return [nestedPurpose];
    }

    const issue = parseCanonicalArtifactId(issueId);
    if (issue.kind !== 'issue' || issue.qualifier !== null || issue.issueNumber === null) {
        throw new Error('Temporary workspace requires a local issue Canonical ID.');
    }
    return [
        formatArtifactIdentityKey(issue),
        requirePathSegment(purpose, 'Temporary workspace purpose'),
    ];
};

/**
 * 根据 Platform Adapter identity 计算 Engine temporary workspace path, 但不创建目录.
 * 所有 path segments 使用与 `createTemporaryWorkspace` 相同的关闭式验证.
 * @param {TemporaryWorkspaceRequest} request
 */
export const resolveTemporaryWorkspace = ({agentIdentity, issueId = undefined, purpose = undefined, repositoryRoot}) => {
    if (typeof repositoryRoot !== 'string' || repositoryRoot.length === 0) {
        throw new Error('Temporary workspace requires a Repository root.');
    }
    const identity = workspaceIdentity(agentIdentity);
    return join(
        resolve(repositoryRoot),
        '.tmp',
        identity.platform,
        identity.sessionId,
        ...workspaceSegments({issueId, purpose}),
    );
};

/**
 * 根据已验证的 Platform Adapter identity 创建当前 Repository 的唯一 temporary workspace.
 * Path validation 在任何 directory write 前完成; success 返回已创建或已存在的 absolute directory.
 * @param {TemporaryWorkspaceRequest} request
 */
export const createTemporaryWorkspace = async request => {
    const directory = resolveTemporaryWorkspace(request);
    await mkdir(directory, {recursive: true});
    return directory;
};
