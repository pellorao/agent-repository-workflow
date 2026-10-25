import {createHash} from 'node:crypto';
import {chmod, lstat, mkdir, readFile, readdir, rename, rm, rmdir, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, join, parse, sep} from 'node:path';

import {createNodeGitRunner} from '../common/git-process.mjs';
import {joinRelativePath} from '../common/filesystem.mjs';
import {serializeJson} from '../common/json.mjs';
import {loadConfig} from '../arw-common/config.mjs';
import {isSkillIdentity} from '../arw-common/skill-identity.mjs';
import {analyzeSkillReferences, createCodexPlatformAdapter} from '../arw-common/platform-adapter.mjs';
import {
    reviewSkillReferences,
    skillReferenceReviewHashes,
} from '../workflow-distribution/skill-reference-review.mjs';

/** @typedef {{blocking: boolean, code: string, identity: string, message: string, path: string, phase: number}} SyncDiagnostic */
/** @typedef {{bytes: Buffer, mode: string, path: string}} SnapshotEntry */
/** @typedef {{digest?: string, mode: string, path: string}} SnapshotInventoryEntry */
/** @typedef {{expression: RegExp, pattern: string}} ScopeRule */
/** @typedef {{exclude: ScopeRule[], include: ScopeRule[]}} NormalizedScope */
/** @typedef {{end: number, lines: string[], start: number}} LineHunk */
/** @typedef {'approved' | 'awaiting-commit' | 'checkpoint-satisfied' | 'recovering' | 'resolving' | 'reviewed'} WorkspaceState */
/** @typedef {{additionalSkillReferences: string[], additionalSkillReferencesHash: string, skillReferenceNormalizations: Array<{column: number, context: string, identity: string, line: number, path: string}>, skillReferenceNormalizationsHash: string}} SkillReferenceReview */
/** @typedef {{code: number | null, failure: 'process' | 'timeout' | null, stderr: string, stdout: Buffer}} GitProcessResult */
/** @typedef {{run: (input: {argv: string[], cwd?: string, environment?: NodeJS.ProcessEnv, input?: Buffer | string, timeoutMs?: number}) => Promise<GitProcessResult>}} GitRunner */
/** @typedef {{additionalSkillReferences: string[], commit: string, platform: 'claude-code' | 'codex', scope: {exclude: string[], include: string[]}, skillReferenceNormalizations: Array<{column: number, identity: string, line: number, path: string}>, url: string}} SourceConfiguration */
/** @typedef {{agentMergeNotes: string, agentMergeNotesDigest?: string, approval?: ApprovalEvidence | null, base: SnapshotEntry[], binaryConflicts?: string[], candidate: SnapshotEntry[], candidateActualSkillDigest?: string, candidateSourceDigest?: string, configurationDigest: string, dualChangedPaths?: string[], finalizedEvidence?: Array<PathState & {path: string, syncRecordId?: string}>, mergeBase: SnapshotEntry[], mergeTheirs: SnapshotEntry[], ours: SnapshotEntry[], ownedWorkspacePaths?: string[], ownershipEvidence?: unknown, pendingPromotion?: PromotionPlan | null, preflightEvidence?: PreflightEntry[], previousCommit: string, projectionConfigurationDigest?: string, reviewInputDigest?: string, sourceId: string, recoveryKind?: string, remainingPaths?: string[], requiredLegalPaths: string[], reviewRevisionId?: string, sourceConfiguration: SourceConfiguration, sourceRelationship: string, state: WorkspaceState, syncRecordId?: string, targetCommit: string, theirs: SnapshotEntry[], theirsSkillReferenceReview?: SkillReferenceReview, textConflicts?: string[], [key: string]: unknown}} SyncWorkspace */
/** @typedef {{run: (input: {argv: string[], cwd?: string, environment?: NodeJS.ProcessEnv, input?: Buffer | string, timeoutMs?: number}) => Promise<GitProcessResult>}} SourceGitRunner */
/** @typedef {{mode: string, objectId: string, stage: number}} IndexEvidence */
/** @typedef {{bytes?: string, digest?: string, exists: boolean, kind?: string, mode?: string}} PathState */
/** @typedef {PathState & {gitObjectId?: string, index: IndexEvidence | null, path: string}} PreflightEntry */
/** @typedef {{index: IndexEvidence | null, path: string, post: PathState, pre: PathState}} PromotionTarget */
/** @typedef {{finalizedEvidence: Array<PathState & {path: string, syncRecordId?: string}>, recoveryPlanDigest: string, targets: PromotionTarget[], version: number}} PromotionPlan */
/** @typedef {{matches: boolean, recoveryPlan?: {direction?: string, recoveryPlanDigest: string, states?: Array<{path: string, state: string}>, version?: number}}} RecoveryInspection */
/** @typedef {{agentMergeNotesDigest?: string, approvalAttestationId?: string, candidateActualSkillDigest?: string, candidateSourceDigest?: string, channel?: string, externalEvidence?: string, humanConfirmation?: string, reviewRevisionId?: string, status?: string, [key: string]: unknown}} ApprovalEvidence */
/** @typedef {{additionalSkillReferencesHash: string, skillReferenceNormalizationsHash: string}} SkillReferenceReviewConfirmation */
/** @typedef {{preflightPromotion?: (workspace: SyncWorkspace) => Promise<{matches: boolean}>, loadConfigurationDigest?: (sourceId: string) => Promise<string | undefined>, loadProjectionConfiguration?: () => Promise<unknown>}} ReviewBindingState */
/** @typedef {{pendingPromotion?: PromotionPlan | null, recoveryKind: string, remainingPaths?: string[], state: 'recovering', [key: string]: unknown}} RecoveryWorkspace */
/** @typedef {{channel?: string, externalEvidence?: string, humanConfirmation?: string, recoveryPlanDigest?: string}} RecoveryAuthorization */
/** @typedef {{candidate: SnapshotEntry[], sourceId: string, syncRecord: {syncRecordId: string, [key: string]: unknown}, workspace: SyncWorkspace}} PromotionRequest */
/** @typedef {{abortWorkspace: (workspace: SyncWorkspace, authorization?: RecoveryAuthorization) => Promise<{remainingPaths: string[]}>, applyPromotion: (request: PromotionRequest & Partial<PromotionPlan>) => Promise<{finalizedEvidence: Array<PathState & {path: string}>}>, applyRecovery: (workspace: SyncWorkspace, direction: 'abort' | 'finalize', plan: {recoveryPlanDigest: string}) => Promise<{finalizedEvidence: Array<PathState & {path: string}>}>, createPromotionPlan: (request: PromotionRequest) => Promise<PromotionPlan>, deleteWorkspace: (workspace?: SyncWorkspace) => Promise<void>, headMatches: (evidence: unknown) => Promise<boolean>, inspectPreparePreflight?: (sourceId: string, canonicalPaths: string[]) => Promise<{evidence?: PreflightEntry[], matches: boolean}>, inspectRecovery: (workspace: SyncWorkspace) => Promise<RecoveryInspection>, loadActualOurs: (input: {canonicalPaths: string[], sourceId: string}) => Promise<{entries: SnapshotEntry[], ownershipEvidence?: unknown}>, loadConfiguration: (sourceId: string) => Promise<Partial<SourceConfiguration>>, loadConfigurationDigest?: (sourceId: string) => Promise<string | undefined>, loadProjectionConfiguration: () => Promise<unknown>, loadWorkspace: () => Promise<SyncWorkspace | null>, preflightPromotion: (workspace: SyncWorkspace, authorization?: RecoveryAuthorization) => Promise<{matches: boolean}>, recordAbortRecovery?: (workspace: SyncWorkspace, remainingPaths: string[]) => Promise<void>, reviewWorkspaceDirectory: string, saveWorkspace: (workspace: SyncWorkspace) => Promise<void>}} SourceState */
/** @typedef {{code: string, message: string, status: 'failed'} | {entries: SnapshotEntry[], status: 'succeeded'}} AcquisitionResult */
/** @typedef {{acquire: (input: {commit: string, scope?: {exclude: string[], include: string[]}, url: string}) => Promise<AcquisitionResult>, classifyRelationship: (baseCommit: string, targetCommit: string) => Promise<string>, dispose?: () => Promise<void>}} UpstreamGit */
/** @typedef {{attempted: boolean, retryable: boolean, status: 'failed' | 'not-required' | 'succeeded'}} AcquisitionCleanup */
/** @typedef {{agentMergeNotesDigest?: string, approvalAttestationId?: string, candidateActualSkillDigest?: string, candidateSourceDigest?: string, cleanup?: AcquisitionCleanup, completedOperations?: Array<{kind: string, path: string}>, diagnostics: SyncDiagnostic[], finalizedEvidence?: Array<PathState & {path: string}>, noSelectedSourceChanges?: boolean, permittedOperations: string[], rawOutput?: string | Uint8Array, recoveryPlan?: {recoveryPlanDigest: string}, remainingPaths?: string[], removedWorkspace?: boolean, reviewRevisionId?: string, rollback?: Array<{path: string, status: string}>, sourceRelationship?: string, stage?: string, state: string, status: 'blocked' | 'failed' | 'succeeded', syncRecordId?: string, workspaceId?: string, [key: string]: unknown}} SyncOperationResult */
/** @typedef {{abort: (authorization?: RecoveryAuthorization) => Promise<SyncOperationResult>, createReviewRevision: (confirmation?: SkillReferenceReviewConfirmation) => Promise<SyncOperationResult>, finalize: (authorization?: RecoveryAuthorization) => Promise<SyncOperationResult>, prepare: (sourceId: string, targetCommit: string) => Promise<SyncOperationResult>, recordApproval: (attestation: ApprovalEvidence) => Promise<SyncOperationResult>, status: () => Promise<SyncOperationResult>}} UpstreamSyncModule */
/** @typedef {(value: string | Uint8Array) => unknown} OutputWriter */

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PORTABLE_MODES = new Set(['100644', '100755']);
const WORKSPACE_STATES = new Set(['approved', 'awaiting-commit', 'checkpoint-satisfied', 'recovering', 'resolving', 'reviewed']);
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const compareText = (/** @type {string} */ left, /** @type {string} */ right) => left < right ? -1 : left > right ? 1 : 0;
const sourceNormalizationOrder = (
    /** @type {{column: number, identity: string, line: number, path: string}} */ left,
    /** @type {{column: number, identity: string, line: number, path: string}} */ right,
) => compareText(left.path, right.path)
    || left.line - right.line
    || left.column - right.column
    || compareText(left.identity, right.identity);
const sourceNormalizationKey = (/** @type {{column: number, identity: string, line: number, path: string}} */ record) =>
    `${record.path}\0${record.line}\0${record.column}\0${record.identity}`;
const permittedOperationsFor = (/** @type {string | number} */ state) => ({
    'awaiting-commit': ['status'],
    approved: ['finalize', 'status'],
    'checkpoint-satisfied': ['prepare', 'status'],
    idle: ['prepare', 'status'],
    recovering: ['status'],
    resolving: ['abort', 'review', 'status'],
    reviewed: ['abort', 'approve', 'review', 'status'],
})[state];

const diagnostic = (/** @type {string} */ code, /** @type {string} */ message, {identity = '', path = '', phase = 1} = {}) => ({
    blocking: true,
    code,
    identity,
    message,
    path,
    phase,
});

const result = (/** @type {string} */ state, /** @type {SyncDiagnostic[]} */ diagnostics = [], /** @type {{permittedOperations?: string[], status?: 'blocked' | 'failed' | 'succeeded', [key: string]: unknown}} */ additional = {}) => {
    const {
        permittedOperations = permittedOperationsFor(state) ?? [],
        status = diagnostics.length === 0 ? 'succeeded' : 'blocked',
        ...details
    } = additional;
    return {
        ...details,
        diagnostics,
        permittedOperations,
        state,
        status,
    };
};

const failedResult = (/** @type {string} */ state, /** @type {SyncDiagnostic[]} */ diagnostics, /** @type {{permittedOperations?: string[], [key: string]: unknown}} */ additional = {}) => result(
    state,
    diagnostics,
    {...additional, status: 'failed'},
);

const promotionOperationSummary = (/** @type {PromotionTarget} */ target) => ({
    kind: !target.pre.exists ? 'create' : !target.post.exists ? 'delete' : 'replace',
    path: target.path,
});

const completedPromotionOperations = (/** @type {Partial<PromotionPlan> | null | undefined} */ plan, /** @type {RecoveryInspection | undefined} */ inspection) => {
    const states = new Map((inspection?.recoveryPlan?.states ?? []).map(entry => [entry.path, entry.state]));
    return (Array.isArray(plan?.targets) ? plan.targets : [])
        .filter(target => target && typeof target.path === 'string' && states.get(target.path) === 'post-image')
        .map(promotionOperationSummary);
};

const allPromotionTargetsAtState = (/** @type {PromotionPlan} */ plan, /** @type {RecoveryInspection} */ inspection, /** @type {string} */ state) => {
    const states = new Map((inspection.recoveryPlan?.states ?? []).map(entry => [entry.path, entry.state]));
    return plan.targets.every(target => states.get(target.path) === state);
};

const rollbackEvidence = (/** @type {Array<{kind: string, path: string}>} */ completedOperations, /** @type {RecoveryInspection | undefined} */ inspection) => {
    const states = new Map((inspection?.recoveryPlan?.states ?? []).map(entry => [entry.path, entry.state]));
    return completedOperations.map(operation => ({
        path: operation.path,
        status: states.get(operation.path) === 'pre-image' ? 'restored' : 'failed',
    }));
};

const exactFinalizedEvidence = (/** @type {unknown} */ evidence, /** @type {PromotionPlan} */ plan) => {
    if (!Array.isArray(evidence) || !Array.isArray(plan.finalizedEvidence)) return false;
    try {
        return canonicalJson(evidence) === canonicalJson(plan.finalizedEvidence);
    } catch {
        return false;
    }
};

/** @returns {value is {entries: SnapshotEntry[], status: 'succeeded'}} */
const validSuccessfulAcquisition = (/** @type {unknown} */ value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = /** @type {Record<string, unknown>} */ (value);
    return Object.keys(record).sort(compareText).join('\0') === ['entries', 'status'].join('\0')
        && record.status === 'succeeded'
        && Array.isArray(record.entries);
};

const validPlanPathState = (/** @type {unknown} */ state) => {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
    const record = /** @type {Record<string, unknown>} */ (state);
    if (Object.keys(record).sort(compareText).join('\0') === 'exists') return record.exists === false;
    if (Object.keys(record).sort(compareText).join('\0') !== ['bytes', 'digest', 'exists', 'mode'].join('\0')
        || record.exists !== true
        || typeof record.bytes !== 'string'
        || typeof record.digest !== 'string'
        || !SHA256_PATTERN.test(record.digest)
        || typeof record.mode !== 'string'
        || !PORTABLE_MODES.has(record.mode)) return false;
    try {
        const bytes = Buffer.from(record.bytes, 'base64');
        return bytes.toString('base64') === record.bytes && sha256(bytes) === record.digest;
    } catch {
        return false;
    }
};

const validPlanIndex = (/** @type {unknown} */ index) => {
    if (index === null) return true;
    if (!index || typeof index !== 'object' || Array.isArray(index)) return false;
    const record = /** @type {Record<string, unknown>} */ (index);
    return Object.keys(record).sort(compareText).join('\0') === ['mode', 'objectId', 'stage'].join('\0')
        && typeof record.mode === 'string'
        && PORTABLE_MODES.has(record.mode)
        && typeof record.objectId === 'string'
        && /^[0-9a-f]{40,64}$/.test(record.objectId)
        && record.stage === 0;
};

const validFinalizedEvidenceEntry = (
    /** @type {unknown} */ value,
    /** @type {string} */ recordPath,
    /** @type {string} */ syncRecordId,
) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = /** @type {Record<string, unknown>} */ (value);
    if (typeof record.path !== 'string' || !isPortablePath(record.path)) return false;
    const isRecord = record.path === recordPath;
    const stateKeys = record.exists === false
        ? ['exists', 'path']
        : ['bytes', 'digest', 'exists', 'mode', 'path'];
    if (isRecord) stateKeys.push('syncRecordId');
    if (Object.keys(record).sort(compareText).join('\0') !== stateKeys.sort(compareText).join('\0')
        || (isRecord && record.syncRecordId !== syncRecordId)) return false;
    return validPlanPathState(record.exists === false
        ? {exists: record.exists}
        : {
            bytes: record.bytes,
            digest: record.digest,
            exists: record.exists,
            mode: record.mode,
        });
};

const validPromotionPlanResult = (/** @type {unknown} */ value, /** @type {string} */ sourceId, /** @type {string} */ syncRecordId) => {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const plan = /** @type {Partial<PromotionPlan>} */ (value);
        if (Object.keys(plan).sort(compareText).join('\0') !== ['finalizedEvidence', 'recoveryPlanDigest', 'targets', 'version'].join('\0')
            || plan.version !== 1
            || !Array.isArray(plan.targets)
            || plan.targets.length === 0
            || !Array.isArray(plan.finalizedEvidence)
            || typeof plan.recoveryPlanDigest !== 'string') return false;
        const recordPath = joinRelativePath('upstream/sources', sourceId, 'sync-records', `${syncRecordId}.json`);
        const sourcePath = joinRelativePath('upstream/sources', sourceId, 'source.json');
        const licensePath = joinRelativePath('docs/licenses/arw', `LICENSE.${sourceId}`);
        const paths = new Set();
        for (const target of plan.targets) {
            if (!target
                || typeof target !== 'object'
                || Array.isArray(target)
                || Object.keys(target).sort(compareText).join('\0') !== ['index', 'path', 'post', 'pre'].join('\0')
                || typeof target.path !== 'string'
                || !isPortablePath(target.path)
                || (!isAssignedSkillTargetPath(target.path)
                    && target.path !== licensePath
                    && target.path !== sourcePath
                    && target.path !== recordPath)
                || paths.has(target.path)
                || !validPlanIndex(target.index)
                || !validPlanPathState(target.pre)
                || !validPlanPathState(target.post)) return false;
            paths.add(target.path);
        }
        const evidencePaths = new Set();
        for (const evidence of plan.finalizedEvidence) {
            if (!validFinalizedEvidenceEntry(evidence, recordPath, syncRecordId)
                || !paths.has(evidence.path)
                || evidencePaths.has(evidence.path)) return false;
            evidencePaths.add(evidence.path);
        }
        if (!paths.has(recordPath)
            || evidencePaths.size !== paths.size
            || plan.recoveryPlanDigest !== sha256(canonicalJson({targets: plan.targets, version: 1}))) return false;
        const expectedEvidence = plan.targets.map(target => ({
            ...target.post,
            path: target.path,
            ...(target.path === recordPath ? {syncRecordId} : {}),
        }));
        return canonicalJson(plan.finalizedEvidence) === canonicalJson(expectedEvidence);
    } catch {
        return false;
    }
};

const validateUrl = (/** @type {string | { toString: () => string; }} */ value) => {
    if (typeof value !== 'string' || value.includes('\0') || /[\r\n]/.test(value) || value.startsWith('-')) {
        return false;
    }
    let url;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    if (!['https:', 'ssh:'].includes(url.protocol)) return false;
    if (!url.hostname || url.username || url.password) return false;
    return true;
};

const validateSourceConfiguration = (/** @type {Partial<SourceConfiguration> | null | undefined} */ configuration, /** @type {string} */ sourceId, /** @type {boolean} */ requireFieldOrder = true) => {
    const expectedKeys = ['url', 'commit', 'platform', 'scope', 'additionalSkillReferences', 'skillReferenceNormalizations'];
    const additional = configuration?.additionalSkillReferences;
    const normalizations = configuration?.skillReferenceNormalizations;
    if (!configuration
        || (requireFieldOrder
            ? Object.keys(configuration).join('\0') !== expectedKeys.join('\0')
            : Object.keys(configuration).sort().join('\0') !== [...expectedKeys].sort().join('\0'))
        || typeof configuration.commit !== 'string'
        || !FULL_COMMIT_PATTERN.test(configuration.commit)
        || !ID_PATTERN.test(sourceId)
        || !['claude-code', 'codex'].includes(configuration.platform ?? '')
        || typeof configuration.url !== 'string'
        || !configuration.scope
        || (requireFieldOrder
            ? Object.keys(configuration.scope).join('\0') !== ['include', 'exclude'].join('\0')
            : Object.keys(configuration.scope).sort().join('\0') !== ['exclude', 'include'].join('\0'))
        || !Array.isArray(configuration.scope.exclude)
        || !Array.isArray(configuration.scope.include)
        || !Array.isArray(additional)
        || additional.some(identity => !isSkillIdentity(identity))
        || new Set(additional).size !== additional.length
        || [...additional].sort().some((identity, index) => identity !== additional[index])
        || !Array.isArray(normalizations)
        || normalizations.some(record => !record
            || typeof record !== 'object'
            || Array.isArray(record)
            || (requireFieldOrder
                ? Object.keys(record).join('\0') !== ['path', 'line', 'column', 'identity'].join('\0')
                : Object.keys(record).sort().join('\0') !== ['column', 'identity', 'line', 'path'].join('\0'))
            || typeof record.path !== 'string'
            || !isCanonicalSkillMarkdownPath(record.path)
            || !Number.isSafeInteger(record.line)
            || record.line <= 0
            || !Number.isSafeInteger(record.column)
            || record.column <= 0
            || !isSkillIdentity(record.identity))
        || new Set(normalizations.map(sourceNormalizationKey)).size !== normalizations.length
        || [...normalizations].sort(sourceNormalizationOrder)
            .some((record, index) => sourceNormalizationOrder(record, normalizations[index]) !== 0)) {
        return null;
    }
    return {
        url: configuration.url,
        commit: configuration.commit,
        platform: /** @type {'claude-code' | 'codex'} */ (configuration.platform),
        scope: {
            include: [...configuration.scope.include],
            exclude: [...configuration.scope.exclude],
        },
        additionalSkillReferences: [...additional],
        skillReferenceNormalizations: normalizations.map(record => ({
            path: record.path,
            line: record.line,
            column: record.column,
            identity: record.identity,
        })),
    };
};

/** @param {unknown} value @returns {unknown} */
const canonicalize = value => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
        return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right, 'en'))
            .filter(([, entryValue]) => entryValue !== undefined)
            .map(([key, entryValue]) => [key, canonicalize(entryValue)]));
    }
    return value;
};

const canonicalJson = (/** @type {unknown} */ value) => {
    const serialized = serializeJson(canonicalize(value), {sortKeys: true});
    if (serialized.status !== 'succeeded') throw new TypeError('Value is not canonical JSON data.');
    return serialized.bytes.toString('utf8');
};

const sourceConfigurationJson = (/** @type {SourceConfiguration} */ configuration) => {
    const serialized = serializeJson(configuration);
    if (serialized.status !== 'succeeded') throw new TypeError('Source Configuration is not JSON data.');
    return serialized.bytes.toString('utf8');
};

const sha256 = (/** @type {import("crypto").BinaryLike} */ value) => createHash('sha256').update(value).digest('hex');

const snapshotDigest = (/** @type {SnapshotEntry[]} */ entries) => sha256(canonicalJson(serializeEntries(entries)));

const serializeEntries = (/** @type {SnapshotEntry[] | null | undefined} */ entries) => [...(entries ?? [])]
    .sort((left, right) => left.path.localeCompare(right.path, 'en'))
    .map(entry => ({
        bytes: entry.bytes.toString('base64'),
        mode: entry.mode,
        path: entry.path,
    }));

const snapshotEvidence = (/** @type {SnapshotEntry[] | null | undefined} */ entries) => [...(entries ?? [])]
    .sort((left, right) => left.path.localeCompare(right.path, 'en'))
    .map(entry => ({digest: sha256(entry.bytes), mode: entry.mode, path: entry.path}));

const isPortablePath = (/** @type {string} */ path) => {
    if (typeof path !== 'string' || path === '' || path.includes('\\') || /[\0-\x1f\x7f]/.test(path)) return false;
    const components = path.split('/');
    return components.every(component =>
        component !== ''
        && component !== '.'
        && component !== '..'
        && !/[<>:"|?*]/.test(component)
        && !/[. ]$/.test(component)
        && !WINDOWS_RESERVED.test(component));
};

const isCanonicalSkillMarkdownPath = (/** @type {string} */ path) => {
    if (!isPortablePath(path) || !path.endsWith('.md')) return false;
    const [root, identity, ...relativePath] = path.split('/');
    return root === 'skills'
        && typeof identity === 'string'
        && isSkillIdentity(identity)
        && relativePath.length > 0;
};

const validateGlob = (/** @type {string} */ pattern) =>
    typeof pattern === 'string'
    && pattern !== ''
    && !pattern.startsWith('!')
    && !pattern.includes('\\')
    && !/[\[\]{}]/.test(pattern)
    && pattern.split('/').every(component => component === '**' || !component.includes('**'))
    && isPortablePath(pattern.replaceAll('**', 'x').replaceAll('*', 'x').replaceAll('?', 'x'));

const globExpression = (/** @type {string} */ pattern) => {
    let source = '^';
    for (let index = 0; index < pattern.length;) {
        if (pattern.startsWith('**/', index)) {
            source += '(?:[^/]+/)*';
            index += 3;
        } else if (pattern.startsWith('**', index)) {
            source += '.*';
            index += 2;
        } else if (pattern[index] === '*') {
            source += '[^/]*';
            index += 1;
        } else if (pattern[index] === '?') {
            source += '[^/]';
            index += 1;
        } else {
            source += pattern[index].replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
            index += 1;
        }
    }
    return new RegExp(`${source}$`);
};

/** @returns {NormalizedScope | null} */
const normalizeScope = (/** @type {{exclude?: string[], include?: string[]} | null | undefined} */ scope) => {
    if (!scope || Object.keys(scope).sort().join('\0') !== ['exclude', 'include'].join('\0')
        || !Array.isArray(scope.include) || !Array.isArray(scope.exclude)) return null;
    const configuredInclude = scope.include;
    const configuredExclude = scope.exclude;
    const include = [...new Set(configuredInclude)].sort();
    const exclude = [...new Set(configuredExclude)].sort();
    if (include.length !== configuredInclude.length
        || exclude.length !== configuredExclude.length
        || include.some((pattern, index) => pattern !== configuredInclude[index])
        || exclude.some((pattern, index) => pattern !== configuredExclude[index])) return null;
    if ([...include, ...exclude].some(pattern => !validateGlob(pattern))) return null;
    return {
        exclude: exclude.map(pattern => ({expression: globExpression(pattern), pattern})),
        include: include.map(pattern => ({expression: globExpression(pattern), pattern})),
    };
};

const pathMatchesScope = (/** @type {string} */ path, /** @type {NormalizedScope} */ scope) =>
    scope.include.some(rule => rule.expression.test(path))
    && !scope.exclude.some(rule => rule.expression.test(path));

const projectTree = (/** @type {Array<Partial<SnapshotEntry> | null> | unknown} */ entries, /** @type {NormalizedScope} */ scope) => {
    if (!Array.isArray(entries)) {
        return {diagnostics: [diagnostic('invalid-acquired-tree', 'Acquisition did not return a tree entry list.', {phase: 2})], selected: []};
    }
    /** @type {SnapshotEntry[]} */
    const selected = [];
    /** @type {Set<string>} */
    const foldedPaths = new Set();
    /** @type {SyncDiagnostic[]} */
    const diagnostics = [];
    for (const entry of [...entries].sort((left, right) => String(left.path).localeCompare(String(right.path), 'en'))) {
        const path = entry?.path;
        if (!isPortablePath(path) || !PORTABLE_MODES.has(entry?.mode) || !Buffer.isBuffer(entry?.bytes)) {
            diagnostics.push(diagnostic('non-portable-source-entry', 'Selected source entries must be portable regular blobs.', {path: path ?? '', phase: 2}));
            continue;
        }
        if (!pathMatchesScope(path, scope)) continue;
        const folded = path.toLowerCase();
        if (foldedPaths.has(folded)) {
            diagnostics.push(diagnostic('portable-path-collision', 'Selected source entries collide under portable case folding.', {path, phase: 2}));
            continue;
        }
        foldedPaths.add(folded);
        selected.push({bytes: entry.bytes, mode: entry.mode, path});
    }
    return {diagnostics, selected};
};

const canonicalSourceTree = (/** @type {SnapshotEntry[]} */ selected) => {
    const diagnostics = [];
    const skillRoots = selected
        .filter(entry => entry.path.startsWith('skills/') && entry.path.endsWith('/SKILL.md'))
        .map(entry => entry.path.slice(0, -'/SKILL.md'.length));
    const uniqueRoots = [...new Set(skillRoots)].sort((left, right) => right.length - left.length || compareText(left, right));
    const foldedPaths = new Set();
    /** @type {SnapshotEntry[]} */
    const entries = [];
    for (const entry of selected) {
        let path;
        if (entry.path === 'LICENSE') {
            path = 'LICENSE';
        } else if (entry.path.startsWith('skills/')) {
            const roots = uniqueRoots.filter(root => entry.path === root || entry.path.startsWith(`${root}/`));
            if (roots.length !== 1) {
                diagnostics.push(diagnostic('source-skill-root-ambiguous', 'Every selected Skill file must belong to exactly one directory containing SKILL.md.', {path: entry.path, phase: 2}));
                continue;
            }
            const root = roots[0];
            const identity = root.split('/').at(-1);
            if (!identity || !isSkillIdentity(identity)) {
                diagnostics.push(diagnostic('source-skill-identity-invalid', 'A selected Skill directory has an invalid identity.', {path: root, phase: 2}));
                continue;
            }
            path = joinRelativePath('skills', identity, entry.path.slice(root.length + 1));
        } else {
            diagnostics.push(diagnostic('source-path-unassigned', 'A selected source path is neither a Skill file nor LICENSE.', {path: entry.path, phase: 2}));
            continue;
        }
        const folded = path.toLowerCase();
        if (foldedPaths.has(folded)) {
            diagnostics.push(diagnostic('canonical-skill-path-collision', 'Selected source entries collide after canonical Skill path projection.', {path, phase: 2}));
            continue;
        }
        foldedPaths.add(folded);
        entries.push({...entry, path});
    }
    return {diagnostics: sortDiagnostics(diagnostics), entries: entries.sort((left, right) => compareText(left.path, right.path))};
};

const isAssignedCanonicalPath = (/** @type {string} */ canonicalPath) => {
    if (canonicalPath === 'LICENSE') return true;
    const [root, identity, ...relativePath] = canonicalPath.split('/');
    return root === 'skills'
        && typeof identity === 'string'
        && isSkillIdentity(identity)
        && relativePath.length > 0;
};

const isAssignedSkillTargetPath = (/** @type {string} */ path) => {
    const [agents, skills, identity, ...relativePath] = path.split('/');
    return agents === '.agents'
        && skills === 'skills'
        && typeof identity === 'string'
        && isSkillIdentity(identity)
        && relativePath.length > 0;
};

const repositoryTargetPath = (/** @type {string} */ sourceId, /** @type {string} */ canonicalPath) => {
    if (canonicalPath === 'LICENSE') return joinRelativePath('docs/licenses/arw', `LICENSE.${sourceId}`);
    if (isAssignedCanonicalPath(canonicalPath)) return joinRelativePath('.agents/skills', canonicalPath.slice('skills/'.length));
    throw new Error('Canonical source path has no Source Checkout target.');
};

const sameEntry = (/** @type {SnapshotEntry | null | undefined} */ left, /** @type {SnapshotEntry | null | undefined} */ right) =>
    left === right
    || Boolean(left && right && left.mode === right.mode && left.bytes.equals(right.bytes));

const snapshotMap = (/** @type {SnapshotEntry[] | null | undefined} */ entries) => new Map((entries ?? []).map(entry => [entry.path, entry]));

const decodeTextLines = (/** @type {ArrayBuffer | NodeJS.ArrayBufferView<ArrayBufferLike> | null | undefined} */ bytes) => {
    try {
        const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
        return text.includes('\0') ? null : text.split('\n');
    } catch {
        return null;
    }
};

const diffLineHunks = (/** @type {string[]} */ baseLines, /** @type {string[]} */ changedLines) => {
    const columns = changedLines.length + 1;
    const lcs = new Uint32Array((baseLines.length + 1) * columns);
    for (let baseIndex = baseLines.length - 1; baseIndex >= 0; baseIndex -= 1) {
        for (let changedIndex = changedLines.length - 1; changedIndex >= 0; changedIndex -= 1) {
            const offset = baseIndex * columns + changedIndex;
            lcs[offset] = baseLines[baseIndex] === changedLines[changedIndex]
                ? lcs[(baseIndex + 1) * columns + changedIndex + 1] + 1
                : Math.max(lcs[(baseIndex + 1) * columns + changedIndex], lcs[offset + 1]);
        }
    }
    /** @type {LineHunk[]} */
    const hunks = [];
    let baseIndex = 0;
    let changedIndex = 0;
    /** @type {LineHunk | null} */
    let current = null;
    const begin = () => {
        current ??= {end: baseIndex, lines: [], start: baseIndex};
        return current;
    };
    const finish = () => {
        if (!current) return;
        current.end = baseIndex;
        hunks.push(current);
        current = null;
    };
    while (baseIndex < baseLines.length || changedIndex < changedLines.length) {
        if (baseIndex < baseLines.length
            && changedIndex < changedLines.length
            && baseLines[baseIndex] === changedLines[changedIndex]) {
            finish();
            baseIndex += 1;
            changedIndex += 1;
        } else if (changedIndex < changedLines.length
            && (baseIndex === baseLines.length
                || lcs[baseIndex * columns + changedIndex + 1]
                    > lcs[(baseIndex + 1) * columns + changedIndex])) {
            begin().lines.push(changedLines[changedIndex]);
            changedIndex += 1;
        } else {
            begin();
            baseIndex += 1;
        }
    }
    finish();
    return hunks;
};

const sameHunk = (/** @type {LineHunk} */ left, /** @type {LineHunk} */ right) => left.start === right.start
    && left.end === right.end
    && left.lines.length === right.lines.length
    && left.lines.every((line, index) => line === right.lines[index]);

const overlappingHunks = (/** @type {{ start: number; end: number; }} */ left, /** @type {{ start: number; end: number; }} */ right) => {
    const leftInsertion = left.start === left.end;
    const rightInsertion = right.start === right.end;
    if (leftInsertion && rightInsertion) return left.start === right.start;
    if (leftInsertion) return left.start > right.start && left.start < right.end;
    if (rightInsertion) return right.start > left.start && right.start < left.end;
    return left.start < right.end && right.start < left.end;
};

const mergeText = (/** @type {SnapshotEntry | undefined} */ base, /** @type {SnapshotEntry | undefined} */ ours, /** @type {SnapshotEntry | undefined} */ theirs) => {
    if (!base || !ours || !theirs || base.mode !== ours.mode || base.mode !== theirs.mode) return null;
    const [baseLines, oursLines, theirsLines] = [base, ours, theirs].map(entry => decodeTextLines(entry.bytes));
    if (!baseLines || !oursLines || !theirsLines) return null;
    const oursHunks = diffLineHunks(baseLines, oursLines);
    const theirsHunks = diffLineHunks(baseLines, theirsLines);
    const mergedHunks = [];
    let oursIndex = 0;
    let theirsIndex = 0;
    while (oursIndex < oursHunks.length || theirsIndex < theirsHunks.length) {
        const oursHunk = oursHunks[oursIndex];
        const theirsHunk = theirsHunks[theirsIndex];
        if (!oursHunk) {
            mergedHunks.push(theirsHunk);
            theirsIndex += 1;
        } else if (!theirsHunk) {
            mergedHunks.push(oursHunk);
            oursIndex += 1;
        } else if (sameHunk(oursHunk, theirsHunk)) {
            mergedHunks.push(oursHunk);
            oursIndex += 1;
            theirsIndex += 1;
        } else if (overlappingHunks(oursHunk, theirsHunk)) {
            return null;
        } else if (oursHunk.start < theirsHunk.start
            || (oursHunk.start === theirsHunk.start && oursHunk.end <= theirsHunk.end)) {
            mergedHunks.push(oursHunk);
            oursIndex += 1;
        } else {
            mergedHunks.push(theirsHunk);
            theirsIndex += 1;
        }
    }
    const merged = [...baseLines];
    for (const hunk of mergedHunks.reverse()) merged.splice(hunk.start, hunk.end - hunk.start, ...hunk.lines);
    return {bytes: Buffer.from(merged.join('\n')), mode: ours.mode, path: ours.path};
};

const buildCandidate = (/** @type {{base: SnapshotEntry[], ours: SnapshotEntry[], theirs: SnapshotEntry[]}} */ {base, ours, theirs}) => {
    const maps = [base, ours, theirs].map(snapshotMap);
    const paths = [...new Set(maps.flatMap(map => [...map.keys()]))].sort();
    /** @type {SnapshotEntry[]} */
    const candidate = [];
    const binaryConflicts = [];
    const dualChangedPaths = [];
    const textConflicts = [];
    for (const path of paths) {
        const [baseEntry, oursEntry, theirsEntry] = maps.map(map => map.get(path));
        let selected;
        if (sameEntry(oursEntry, baseEntry)) selected = theirsEntry;
        else if (sameEntry(theirsEntry, baseEntry) || sameEntry(oursEntry, theirsEntry)) selected = oursEntry;
        else {
            dualChangedPaths.push(path);
            selected = mergeText(baseEntry, oursEntry, theirsEntry);
            if (!selected) {
                selected = oursEntry;
                const entries = [baseEntry, oursEntry, theirsEntry];
                if (entries.some(entry => entry && decodeTextLines(entry.bytes) === null)) {
                    binaryConflicts.push(path);
                } else {
                    textConflicts.push(path);
                }
            }
        }
        if (selected) candidate.push(selected);
    }
    return {binaryConflicts, candidate, dualChangedPaths, textConflicts};
};

const sortDiagnostics = (/** @type {SyncDiagnostic[]} */ diagnostics) => diagnostics.sort((left, right) =>
    left.phase - right.phase
    || left.path.localeCompare(right.path, 'en')
    || left.code.localeCompare(right.code, 'en')
    || left.identity.localeCompare(right.identity, 'en'));

const changedPaths = (/** @type {SnapshotEntry[]} */ left, /** @type {SnapshotEntry[]} */ right) => {
    const maps = [left, right].map(snapshotMap);
    return [...new Set(maps.flatMap(map => [...map.keys()]))]
        .filter(path => !sameEntry(maps[0].get(path), maps[1].get(path)))
        .sort();
};

const validAgentMergeNotes = (/** @type {unknown} */ notes) => {
    if (typeof notes !== 'string' || notes.trim() === '' || notes.includes('\0')) return false;
    const bytes = Buffer.from(notes, 'utf8');
    try {
        return new TextDecoder('utf-8', {fatal: true}).decode(bytes) === notes;
    } catch {
        return false;
    }
};

const candidateSourceConfigurationFor = (/** @type {SyncWorkspace} */ workspace) => ({
    url: workspace.sourceConfiguration.url,
    commit: workspace.targetCommit,
    platform: workspace.sourceConfiguration.platform,
    scope: {
        include: [...workspace.sourceConfiguration.scope.include],
        exclude: [...workspace.sourceConfiguration.scope.exclude],
    },
    additionalSkillReferences: workspace.theirsSkillReferenceReview?.additionalSkillReferences ?? [],
    skillReferenceNormalizations: (workspace.theirsSkillReferenceReview?.skillReferenceNormalizations ?? []).map(record => ({
        path: record.path,
        line: record.line,
        column: record.column,
        identity: record.identity,
    })),
});

const completedCanonicalPathsFor = (/** @type {SyncWorkspace} */ workspace) => {
    const paths = [];
    const beforeByPath = new Map(workspace.ours.map(entry => [entry.path, entry]));
    const afterByPath = new Map(workspace.candidate.map(entry => [entry.path, entry]));
    for (const path of new Set([...beforeByPath.keys(), ...afterByPath.keys()])) {
        if (!sameEntry(beforeByPath.get(path), afterByPath.get(path))) {
            paths.push(repositoryTargetPath(workspace.sourceId, path));
        }
    }
    const preflightByPath = new Map((workspace.preflightEvidence ?? []).map(entry => [entry.path, entry]));
    const addChangedStatePath = (/** @type {string} */ path, /** @type {Buffer} */ bytes) => {
        const preflight = preflightByPath.get(path);
        if (!preflight?.exists || preflight.digest !== sha256(bytes) || preflight.mode !== '100644') paths.push(path);
    };
    const sourcePath = joinRelativePath('upstream/sources', workspace.sourceId, 'source.json');
    addChangedStatePath(sourcePath, Buffer.from(sourceConfigurationJson(candidateSourceConfigurationFor(workspace))));
    return [...new Set(paths)].sort(compareText);
};

const syncRecordWithoutIdentityFor = (
    /** @type {SyncWorkspace} */ workspace,
    /** @type {{candidateActualSkillDigest?: string, candidateSourceDigest?: string}} */ digests = {},
) => ({
    approvalAttestationId: workspace.approval?.approvalAttestationId,
    binaryConflicts: workspace.binaryConflicts ?? [],
    candidateActualSkillDigest: digests.candidateActualSkillDigest ?? candidateActualSkillDigestFor(workspace),
    candidateSourceDigest: digests.candidateSourceDigest ?? candidateSourceDigestFor(workspace),
    completedCanonicalPaths: completedCanonicalPathsFor(workspace),
    conflicts: workspace.textConflicts ?? [],
    dualChangedPaths: workspace.dualChangedPaths ?? [],
    legalResult: 'satisfied',
    localDifferencePaths: changedPaths(workspace.mergeBase, workspace.ours),
    newBaseDigest: snapshotDigest(workspace.theirs),
    newOursDigest: snapshotDigest(workspace.candidate),
    newSourceCommit: workspace.targetCommit,
    oldBaseDigest: snapshotDigest(workspace.base),
    oldOursDigest: snapshotDigest(workspace.ours),
    oldSourceCommit: workspace.previousCommit,
    reviewRevisionId: workspace.reviewRevisionId,
    sourceId: workspace.sourceId,
    sourceRelationship: workspace.sourceRelationship,
    syncRecordVersion: 1,
    toolContract: 'upstream-sync-v1',
});

const candidateActualSkillDigestFor = (/** @type {SyncWorkspace} */ workspace) => snapshotDigest(workspace.candidate);

const candidateSourceDigestFor = (/** @type {SyncWorkspace} */ workspace) => sha256(canonicalJson({
    base: serializeEntries(workspace.base),
    candidateSourceConfiguration: candidateSourceConfigurationFor(workspace),
    configurationDigest: workspace.configurationDigest,
    previousCommit: workspace.previousCommit,
    sourceId: workspace.sourceId,
    sourceRelationship: workspace.sourceRelationship,
    targetCommit: workspace.targetCommit,
    theirs: serializeEntries(workspace.theirs),
    theirsSkillReferenceReview: workspace.theirsSkillReferenceReview,
}));

const reviewInputDigestFor = (/** @type {SyncWorkspace} */ workspace) => sha256(canonicalJson({
    agentMergeNotes: workspace.agentMergeNotes,
    binaryConflicts: workspace.binaryConflicts ?? [],
    dualChangedPaths: workspace.dualChangedPaths ?? [],
    mergeBase: serializeEntries(workspace.mergeBase),
    mergeTheirs: serializeEntries(workspace.mergeTheirs),
    ours: serializeEntries(workspace.ours),
    preflightEvidence: workspace.preflightEvidence,
    projectionConfigurationDigest: workspace.projectionConfigurationDigest,
    requiredLegalPaths: workspace.requiredLegalPaths,
    textConflicts: workspace.textConflicts ?? [],
}));

const reviewRevisionBindingsFor = (/** @type {SyncWorkspace} */ workspace) => {
    const agentMergeNotesDigest = sha256(Buffer.from(workspace.agentMergeNotes, 'utf8'));
    const candidateActualSkillDigest = candidateActualSkillDigestFor(workspace);
    const candidateSourceDigest = candidateSourceDigestFor(workspace);
    const reviewInputDigest = reviewInputDigestFor(workspace);
    return {
        agentMergeNotesDigest,
        candidateActualSkillDigest,
        candidateSourceDigest,
        reviewInputDigest,
        reviewRevisionId: sha256(`${agentMergeNotesDigest}\0${candidateSourceDigest}\0${candidateActualSkillDigest}\0${reviewInputDigest}`),
    };
};

const approvalMatchesWorkspace = (/** @type {ApprovalEvidence | null | undefined} */ approval, /** @type {Partial<SyncWorkspace>} */ workspace) => {
    if (!approval
        || typeof approval.approvalAttestationId !== 'string'
        || !/^[0-9a-f]{64}$/.test(approval.approvalAttestationId)) return false;
    const {approvalAttestationId, ...attestation} = approval;
    return sha256(canonicalJson(canonicalize(attestation))) === approvalAttestationId
        && approval.candidateActualSkillDigest === workspace.candidateActualSkillDigest
        && approval.candidateSourceDigest === workspace.candidateSourceDigest
        && approval.agentMergeNotesDigest === workspace.agentMergeNotesDigest
        && approval.reviewRevisionId === workspace.reviewRevisionId;
};

const validRecoveryAuthorization = (/** @type {{channel?: string, externalEvidence?: string, humanConfirmation?: string, recoveryPlanDigest?: string} | null | undefined} */ authorization, /** @type {string} */ recoveryPlanDigest) => {
    const requiredKeys = ['channel', 'recoveryPlanDigest'];
    const optionalKeys = ['externalEvidence', 'humanConfirmation'];
    const keys = Object.keys(authorization ?? {}).sort();
    return authorization
        && keys.every(key => [...requiredKeys, ...optionalKeys].includes(key))
        && requiredKeys.every(key => keys.includes(key))
        && authorization.recoveryPlanDigest === recoveryPlanDigest
        && typeof authorization.channel === 'string'
        && authorization.channel.trim() !== ''
        && optionalKeys.every(key => key === 'externalEvidence'
            ? authorization.externalEvidence === undefined
                || (typeof authorization.externalEvidence === 'string' && authorization.externalEvidence.trim() !== '')
            : authorization.humanConfirmation === undefined
                || (typeof authorization.humanConfirmation === 'string' && authorization.humanConfirmation.trim() !== ''))
        && ((typeof authorization.humanConfirmation === 'string' && authorization.humanConfirmation.trim() !== '')
            || (typeof authorization.externalEvidence === 'string' && authorization.externalEvidence.trim() !== ''));
};

/** @template T @param {() => Promise<T>} read @returns {Promise<{ok: true, value: T} | {ok: false, value: undefined}>} */
const attemptRead = async read => {
    try {
        return {ok: true, value: await read()};
    } catch {
        return {ok: false, value: undefined};
    }
};

const inspectCanonicalPreflight = async (/** @type {ReviewBindingState} */ sourceState, /** @type {SyncWorkspace} */ workspace, /** @type {number} */ phase) => {
    const preflightPromotion = sourceState.preflightPromotion;
    if (typeof preflightPromotion !== 'function') return null;
    const preflight = await attemptRead(() => preflightPromotion(workspace));
    if (!preflight.ok) {
        return diagnostic('sync-owned-preflight-read-failed', 'Sync-owned canonical preflight evidence could not be inspected safely.', {phase});
    }
    if (!preflight.value?.matches) {
        return diagnostic('sync-owned-review-input-drift', 'Sync-owned actual targets or index evidence changed after prepare.', {phase});
    }
    return null;
};

const inspectReviewBindings = async (/** @type {ReviewBindingState} */ sourceState, /** @type {SyncWorkspace} */ workspace, /** @type {number} */ phase) => {
    const preflightDiagnostic = await inspectCanonicalPreflight(sourceState, workspace, phase);
    if (preflightDiagnostic) return preflightDiagnostic;
    if (typeof sourceState.loadConfigurationDigest === 'function') {
        const loadConfigurationDigest = sourceState.loadConfigurationDigest;
        const configuration = await attemptRead(() => loadConfigurationDigest(workspace.sourceId));
        if (!configuration.ok) {
            return diagnostic('source-configuration-read-failed', 'Source Configuration could not be read safely.', {phase});
        }
        if (configuration.value !== workspace.configurationDigest) {
            return diagnostic('source-configuration-drift', 'Source Configuration changed after prepare.', {phase});
        }
    }
    if (!SHA256_PATTERN.test(workspace.projectionConfigurationDigest ?? '')) {
        return diagnostic('projection-configuration-stale', 'Workspace is missing its Projection Definition binding.', {phase});
    }
    const loadProjectionConfiguration = sourceState.loadProjectionConfiguration;
    if (typeof loadProjectionConfiguration !== 'function') {
        return diagnostic('projection-configuration-read-failed', 'Projection Definition could not be read safely.', {phase});
    }
    const projection = await attemptRead(() => loadProjectionConfiguration());
    if (!projection.ok) {
        return diagnostic('projection-configuration-read-failed', 'Projection Definition could not be read safely.', {phase});
    }
    if (sha256(canonicalJson(projection.value)) !== workspace.projectionConfigurationDigest) {
        return diagnostic('projection-configuration-drift', 'Projection Definition changed after Review Revision creation.', {phase});
    }
    if (!SHA256_PATTERN.test(workspace.reviewRevisionId ?? '')
        || !SHA256_PATTERN.test(workspace.agentMergeNotesDigest ?? '')) {
        return diagnostic('review-revision-stale', 'Workspace is missing its Review Revision binding.', {phase});
    }
    const bindings = reviewRevisionBindingsFor(workspace);
    if (bindings.candidateSourceDigest !== workspace.candidateSourceDigest) {
        return diagnostic('candidate-source-stale', 'Candidate source or review inputs changed after Review Revision creation.', {phase});
    }
    if (bindings.candidateActualSkillDigest !== workspace.candidateActualSkillDigest) {
        return diagnostic('candidate-actual-skills-stale', 'Candidate actual Skill bytes changed after Review Revision creation.', {phase});
    }
    if (bindings.reviewInputDigest !== workspace.reviewInputDigest) {
        return diagnostic('review-input-stale', 'Review inputs changed after Review Revision creation.', {phase});
    }
    if (bindings.agentMergeNotesDigest !== workspace.agentMergeNotesDigest
        || bindings.reviewRevisionId !== workspace.reviewRevisionId) {
        return diagnostic('review-revision-stale', 'Review Revision bindings do not match the current reviewed inputs.', {phase});
    }
    return null;
};

const requireGitSuccess = (/** @type {GitProcessResult} */ response, /** @type {string} */ operation) => {
    if (response?.failure || response?.code !== 0) {
        throw new Error(`Git ${operation} failed.`);
    }
    return response.stdout;
};

const splitNulRecords = (/** @type {Buffer} */ bytes) => {
    /** @type {Buffer[]} */
    const records = [];
    let start = 0;
    for (let index = 0; index < bytes.length; index += 1) {
        if (bytes[index] !== 0) continue;
        if (index > start) records.push(bytes.subarray(start, index));
        start = index + 1;
    }
    if (start !== bytes.length) throw new Error('Git tree output is not NUL terminated.');
    return records;
};

const decodeUtf8Path = (/** @type {ArrayBuffer | NodeJS.ArrayBufferView<ArrayBufferLike> | null | undefined} */ bytes) => {
    try {
        return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    } catch {
        throw new Error('Git returned a path that is not strict UTF-8.');
    }
};

const parseBatchBlobs = (/** @type {string[]} */ objectIds, /** @type {Buffer<ArrayBufferLike>} */ bytes) => {
    const blobs = new Map();
    let offset = 0;
    for (const expectedObjectId of objectIds) {
        const newline = bytes.indexOf(0x0a, offset);
        if (newline < 0) throw new Error('Git cat-file batch output is truncated.');
        const header = bytes.subarray(offset, newline).toString('ascii');
        const match = /^([0-9a-f]+) blob (\d+)$/.exec(header);
        if (!match || match[1] !== expectedObjectId) throw new Error('Git cat-file batch returned an invalid blob header.');
        const size = Number(match[2]);
        const start = newline + 1;
        const end = start + size;
        if (!Number.isSafeInteger(size) || end >= bytes.length || bytes[end] !== 0x0a) {
            throw new Error('Git cat-file batch returned invalid blob bytes.');
        }
        blobs.set(expectedObjectId, bytes.subarray(start, end));
        offset = end + 1;
    }
    if (offset !== bytes.length) throw new Error('Git cat-file batch returned trailing output.');
    return blobs;
};

const parseGitTree = async (/** @type {GitRunner} */ gitRunner, /** @type {string} */ gitDirectory, /** @type {Buffer} */ treeBytes, /** @type {NormalizedScope} */ scope) => {
    /** @type {Array<{mode: string, objectId: string, path: string, type: string}>} */
    const metadata = [];
    for (const recordBytes of splitNulRecords(treeBytes)) {
        const tab = recordBytes.indexOf(0x09);
        if (tab < 0) throw new Error('Git returned an invalid tree record.');
        const headerBytes = recordBytes.subarray(0, tab);
        if (headerBytes.some((/** @type {number} */ byte) => byte > 0x7f)) throw new Error('Git returned a non-ASCII tree header.');
        const match = /^(\d{6}) ([^ ]+) ([0-9a-f]+)$/.exec(headerBytes.toString('ascii'));
        if (!match) throw new Error('Git returned an invalid tree record.');
        const [, mode, type, objectId] = match;
        metadata.push({mode, objectId, path: decodeUtf8Path(recordBytes.subarray(tab + 1)), type});
    }
    const selectedMetadata = metadata.filter(entry => pathMatchesScope(entry.path, scope));
    const objectIds = selectedMetadata.filter(entry => entry.type === 'blob').map(entry => entry.objectId);
    const blobs = objectIds.length === 0 ? new Map() : parseBatchBlobs(
        objectIds,
        requireGitSuccess(await gitRunner.run({
            argv: [`--git-dir=${gitDirectory}`, 'cat-file', '--batch'],
            input: Buffer.from(`${objectIds.join('\n')}\n`),
        }), 'cat-file'),
    );
    return selectedMetadata.map(entry => ({
        bytes: entry.type === 'blob' ? blobs.get(entry.objectId) : Buffer.alloc(0),
        mode: entry.mode,
        path: entry.path,
    }));
};

const realDirectoryChainExists = async (/** @type {string} */ path) => {
    if (!isAbsolute(path)) throw new TypeError('Acquisition workspace root must be absolute.');
    const parsed = parse(path);
    let current = parsed.root;
    for (const component of path.slice(parsed.root.length).split(sep).filter(Boolean)) {
        current = join(current, component);
        let information;
        try {
            information = await lstat(current);
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
            throw error;
        }
        if (!information.isDirectory() || information.isSymbolicLink()) {
            throw new Error('Acquisition workspace parent chain must contain only real directories.');
        }
    }
    return true;
};

/**
 * 创建只服务于 Source Checkout 的 Git Adapter.
 * 输入允许注入进程运行器和临时目录. 返回值按精确 commit 获取原始 tree 字节和 Git mode,
 * 并分类 Base 与 Theirs 的提交关系. Adapter 不读取目标 Repository, 不执行上游代码,
 * 且在关系分类或显式清理后删除它创建的 bare Repository.
 */
export const createUpstreamGitAdapter = (/** @type {{gitRunner?: GitRunner, removeDirectory?: typeof rm, temporaryDirectory?: string}} */ {
    gitRunner = createNodeGitRunner(process.cwd()),
    removeDirectory = rm,
    temporaryDirectory,
} = {}) => {
    if (typeof temporaryDirectory !== 'string' || !isAbsolute(temporaryDirectory)) {
        throw new TypeError('Upstream Git Adapter requires an absolute Repository-scoped workspace root.');
    }
    const root = join(temporaryDirectory, 'acquisition');
    const controlPath = join(root, 'control.json');
    const repositoryPath = join(root, 'repository.git');
    /** @type {string | undefined} */
    let gitDirectory;
    const ownedRootExists = async () => {
        if (!await realDirectoryChainExists(temporaryDirectory)) return false;
        let rootInformation;
        try {
            rootInformation = await lstat(root);
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
            throw error;
        }
        if (!rootInformation.isDirectory() || rootInformation.isSymbolicLink()) {
            throw new Error('Acquisition workspace must be a real directory.');
        }
        const controlInformation = await lstat(controlPath);
        if (!controlInformation.isFile() || controlInformation.isSymbolicLink()) {
            throw new Error('Acquisition workspace ownership record must be a real file.');
        }
        const control = JSON.parse((await readFile(controlPath)).toString('utf8'));
        if (!control
            || typeof control !== 'object'
            || Array.isArray(control)
            || Object.keys(control).sort(compareText).join('\0') !== ['kind', 'version'].join('\0')
            || control.kind !== 'upstream-git-acquisition'
            || control.version !== 1) {
            throw new Error('Acquisition workspace ownership record is invalid.');
        }
        const entries = (await readdir(root)).sort(compareText);
        if (entries.some(entry => !['control.json', 'repository.git'].includes(entry))) {
            throw new Error('Acquisition workspace contains unowned entries.');
        }
        if (entries.includes('repository.git')) {
            const repositoryInformation = await lstat(repositoryPath);
            if (!repositoryInformation.isDirectory() || repositoryInformation.isSymbolicLink()) {
                throw new Error('Acquisition Git repository must be a real directory.');
            }
        }
        return true;
    };
    const ensureRepository = async () => {
        if (gitDirectory) return gitDirectory;
        await realDirectoryChainExists(temporaryDirectory);
        await mkdir(temporaryDirectory, {recursive: true});
        await realDirectoryChainExists(temporaryDirectory);
        await mkdir(root);
        await writeFile(controlPath, canonicalJson({kind: 'upstream-git-acquisition', version: 1}), {encoding: 'utf8', flag: 'wx'});
        gitDirectory = repositoryPath;
        requireGitSuccess(await gitRunner.run({argv: ['init', '--bare', gitDirectory]}), 'init');
        return gitDirectory;
    };
    const dispose = async () => {
        if (!await ownedRootExists()) {
            gitDirectory = undefined;
            return;
        }
        await removeDirectory(root, {force: true, recursive: true});
        if (await ownedRootExists()) throw new Error('Acquisition workspace cleanup did not remove the owned directory.');
        gitDirectory = undefined;
    };
    return {
        /** @returns {Promise<AcquisitionResult>} */
        async acquire(/** @type {{commit: string, scope?: {exclude: string[], include: string[]}, url: string}} */ {
            commit,
            scope: configuredScope = {exclude: [], include: ['**']},
            url,
        }) {
            try {
                if (!FULL_COMMIT_PATTERN.test(commit) || !validateUrl(url)) {
                    return {
                        code: 'invalid-acquisition-request',
                        message: 'Git acquisition requires a safe URL and an exact commit identity.',
                        status: 'failed',
                    };
                }
                const scope = normalizeScope(configuredScope);
                if (!scope) {
                    return {code: 'invalid-source-scope', message: 'Source Scope is invalid.', status: 'failed'};
                }
                const repository = await ensureRepository();
                const reference = `refs/arw/${commit}`;
                requireGitSuccess(await gitRunner.run({
                    argv: [
                        `--git-dir=${repository}`,
                        'fetch',
                        '--no-tags',
                        '--',
                        url,
                        `${commit}:${reference}`,
                    ],
                    timeoutMs: 60_000,
                }), 'fetch');
                const resolved = requireGitSuccess(await gitRunner.run({
                    argv: [`--git-dir=${repository}`, 'rev-parse', `${reference}^{commit}`],
                }), 'rev-parse').toString('utf8').trim();
                if (resolved !== commit) throw new Error('Git did not resolve the requested exact commit.');
                if (scope.include.length === 0) return {entries: [], status: 'succeeded'};
                const tree = requireGitSuccess(await gitRunner.run({
                    argv: [`--git-dir=${repository}`, 'ls-tree', '-rz', '--full-tree', reference],
                }), 'ls-tree');
                return {entries: await parseGitTree(gitRunner, repository, tree, scope), status: 'succeeded'};
            } catch {
                return {
                    code: 'source-acquisition-failed',
                    message: 'The requested exact source tree could not be acquired safely.',
                    status: 'failed',
                };
            }
        },
        /**
         * @param {string} baseCommit
         * @param {string} targetCommit
         */
        async classifyRelationship(baseCommit, targetCommit) {
            if (!FULL_COMMIT_PATTERN.test(baseCommit ?? '') || !FULL_COMMIT_PATTERN.test(targetCommit ?? '')) {
                throw new TypeError('Relationship revisions must be full lowercase commit IDs.');
            }
            const repository = await ensureRepository();
            const run = async (/** @type {string[]} */ argv) => {
                const response = await gitRunner.run({argv: [`--git-dir=${repository}`, ...argv]});
                if (response.failure) throw new Error('Git relationship inspection failed.');
                return response;
            };
            let relationship = 'unknown';
            try {
                if (baseCommit === targetCommit) relationship = 'same';
                else {
                    const baseAncestor = await run(['merge-base', '--is-ancestor', baseCommit, targetCommit]);
                    if (![0, 1].includes(baseAncestor.code ?? -1)) throw new Error('Git returned an invalid ancestry result.');
                    if (baseAncestor.code === 0) relationship = 'descendant';
                    else {
                        const targetAncestor = await run(['merge-base', '--is-ancestor', targetCommit, baseCommit]);
                        if (![0, 1].includes(targetAncestor.code ?? -1)) throw new Error('Git returned an invalid ancestry result.');
                        if (targetAncestor.code === 0) relationship = 'ancestor';
                        else {
                    const mergeBase = await run(['merge-base', baseCommit, targetCommit]);
                            if (![0, 1].includes(mergeBase.code ?? -1)) throw new Error('Git returned an invalid merge-base result.');
                            relationship = mergeBase.code === 0 ? 'diverged' : 'unrelated';
                        }
                    }
                }
                return relationship;
            } finally {
                await dispose();
            }
        },
        dispose,
    };
};

const readRegularFile = async (/** @type {import("fs").PathLike} */ path) => {
    const information = await lstat(path);
    if (!information.isFile() || information.isSymbolicLink()) throw new Error('Input must be a real regular file.');
    return readFile(path);
};

const readUtf8File = async (/** @type {import("fs").PathLike} */ path) => {
    const bytes = await readRegularFile(path);
    try {
        return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    } catch {
        throw new Error('Input must be valid UTF-8.');
    }
};

const readJson = async (/** @type {string} */ path) => JSON.parse((await readRegularFile(path)).toString('utf8'));

const readOptionalJson = async (/** @type {string} */ path, /** @type {unknown} */ fallback) => {
    try {
        return await readJson(path);
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return fallback;
        throw error;
    }
};

const writeCanonicalJson = async (/** @type {string} */ path, /** @type {unknown} */ value) => {
    const temporaryPath = `${path}.tmp`;
    await writeFile(temporaryPath, canonicalJson(value), {encoding: 'utf8', flag: 'wx'});
    await rename(temporaryPath, path);
};

const snapshotInventory = (/** @type {SnapshotEntry[]} */ entries) => entries.map(entry => ({mode: entry.mode, path: entry.path}));

const validSnapshotInventory = (/** @type {Array<Partial<SnapshotInventoryEntry> | null> | unknown} */ inventory, /** @type {boolean} */ requiresDigest) => {
    if (!Array.isArray(inventory)) return false;
    const foldedPaths = new Set();
    for (const entry of inventory) {
        const expectedKeys = requiresDigest ? ['digest', 'mode', 'path'] : ['mode', 'path'];
        if (!entry
            || Object.keys(entry).sort().join('\0') !== expectedKeys.join('\0')
            || !isPortablePath(entry.path)
            || !PORTABLE_MODES.has(entry.mode)
            || (requiresDigest && !/^[0-9a-f]{64}$/.test(entry.digest))) return false;
        const folded = entry.path.toLowerCase();
        if (foldedPaths.has(folded)) return false;
        foldedPaths.add(folded);
    }
    return true;
};

const writeSnapshotTree = async (/** @type {string} */ root, /** @type {SnapshotEntry[]} */ entries) => {
    await rm(root, {force: true, recursive: true});
    await mkdir(root, {recursive: true});
    for (const entry of entries) {
        if (!isPortablePath(entry.path) || !PORTABLE_MODES.has(entry.mode) || !Buffer.isBuffer(entry.bytes)) {
            throw new Error('Cannot persist an invalid workspace snapshot entry.');
        }
        const target = join(root, ...entry.path.split('/'));
        await mkdir(dirname(target), {recursive: true});
        await writeFile(target, entry.bytes, {flag: 'wx'});
        if (entry.mode === '100755' && process.platform !== 'win32') await chmod(target, 0o755);
    }
};

const assertSafeSnapshotParents = async (/** @type {string} */ root, /** @type {string} */ path) => {
    let current = root;
    for (const component of path.split('/').slice(0, -1)) {
        current = join(current, component);
        const information = await lstat(current);
        if (!information.isDirectory() || information.isSymbolicLink()) {
            throw new Error('Immutable workspace snapshot has an unsafe parent component.');
        }
    }
};

const readSnapshotTree = async (/** @type {string} */ root, /** @type {SnapshotInventoryEntry[]} */ inventory) => {
    const rootInformation = await lstat(root);
    if (!rootInformation.isDirectory() || rootInformation.isSymbolicLink()) {
        throw new Error('Immutable workspace snapshot root is unsafe.');
    }
    return Promise.all(inventory.map(async entry => {
        await assertSafeSnapshotParents(root, entry.path);
        const path = join(root, ...entry.path.split('/'));
        const information = await lstat(path);
        if (!information.isFile()
            || information.isSymbolicLink()
            || (process.platform !== 'win32'
                && (information.mode & 0o111 ? '100755' : '100644') !== entry.mode)) {
            throw new Error('Immutable workspace snapshot mode changed after prepare.');
        }
        const bytes = await readFile(path);
        if (entry.digest === undefined || !/^[0-9a-f]{64}$/.test(entry.digest) || sha256(bytes) !== entry.digest) {
            throw new Error('Immutable workspace snapshot bytes changed after prepare.');
        }
        return {bytes, mode: entry.mode, path: entry.path};
    }));
};

const readEditableSnapshotTree = async (/** @type {string} */ root, /** @type {SnapshotInventoryEntry[]} */ inventory) => {
    const recordedModes = new Map((inventory ?? []).map(entry => [entry.path, entry.mode]));
    const foldedPaths = new Set();
    return (await listRegularTree(root)).map(entry => {
        if (!isPortablePath(entry.path)) throw new Error('Editable candidate contains a non-portable path.');
        const folded = entry.path.toLowerCase();
        if (foldedPaths.has(folded)) throw new Error('Editable candidate contains a portable path collision.');
        foldedPaths.add(folded);
        return {
            ...entry,
            mode: process.platform === 'win32' ? recordedModes.get(entry.path) ?? '100644' : entry.mode,
        };
    });
};

/** @param {string} root @param {string} [directory] @returns {Promise<SnapshotEntry[]>} */
const listRegularTree = async (root, directory = root) => {
    /** @type {SnapshotEntry[]} */
    const entries = [];
    if (directory === root) {
        const information = await lstat(root);
        if (!information.isDirectory() || information.isSymbolicLink()) {
            throw new Error('Tree root must be a real directory.');
        }
    }
    for (const directoryEntry of await readdir(directory, {withFileTypes: true})) {
        const absolutePath = join(directory, directoryEntry.name);
        if (directoryEntry.isDirectory()) {
            entries.push(...await listRegularTree(root, absolutePath));
            continue;
        }
        const information = await lstat(absolutePath);
        if (!information.isFile() || information.isSymbolicLink()) {
            throw new Error('Snapshot tree contains a non-regular entry.');
        }
        entries.push({
            bytes: await readFile(absolutePath),
            mode: information.mode & 0o111 ? '100755' : '100644',
            path: absolutePath.slice(root.length + 1).replaceAll('\\', '/'),
        });
    }
    return entries.sort((left, right) => left.path.localeCompare(right.path, 'en'));
};

const assertSafeDirectoryChain = async (/** @type {string} */ root, /** @type {string[]} */ components) => {
    let current = root;
    for (const component of components) {
        current = join(current, component);
        try {
            const information = await lstat(current);
            if (!information.isDirectory() || information.isSymbolicLink()) {
                throw new Error('Workspace path has an unsafe directory component.');
            }
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
            throw error;
        }
    }
};

/**
 * 创建 Source Checkout 持久化和提升 Adapter.
 * 输入绑定最近 Git Repository 根目录, 并允许注入 Git runner.
 * 返回值读取来源配置和实际 Source Checkout 目标, 管理唯一 disposable Sync Workspace,
 * 构造审核修订版本, 执行限定范围的提升与恢复, 并生成 HEAD 检查点证据.
 * Adapter 不决定合并, 审核, Approval 或 delta lifecycle 策略.
 */
export const createSourceCheckoutStateAdapter = (/** @type {{repositoryRoot: string, gitRunner?: GitRunner}} */ {
    repositoryRoot,
    gitRunner = createNodeGitRunner(repositoryRoot),
}) => {
    const activeWorkspace = join(repositoryRoot, 'upstream', '.workspaces', 'active');
    const controlPath = join(activeWorkspace, 'control.json');
    const workspaceControlKeys = new Set([
        'agentMergeNotesDigest',
        'approval',
        'base',
        'binaryConflicts',
        'candidate',
        'candidateActualSkillDigest',
        'candidateSourceDigest',
        'configurationDigest',
        'dualChangedPaths',
        'finalizedEvidence',
        'mergeBase',
        'mergeTheirs',
        'ours',
        'ownedWorkspacePaths',
        'ownershipEvidence',
        'pendingPromotion',
        'preflightEvidence',
        'previousCommit',
        'projectionConfigurationDigest',
        'recoveryKind',
        'remainingPaths',
        'requiredLegalPaths',
        'reviewInputDigest',
        'reviewRevisionId',
        'sourceConfiguration',
        'sourceId',
        'sourceRelationship',
        'state',
        'syncRecordId',
        'targetCommit',
        'textConflicts',
        'theirs',
        'theirsSkillReferenceReview',
    ]);
    /** @template {Record<string, unknown>} T @param {T} value @returns {T} */
    const currentWorkspaceControl = value => /** @type {T} */ (Object.fromEntries(
        Object.entries(value).filter(([key]) => workspaceControlKeys.has(key)),
    ));
    const sourceRoot = (/** @type {string} */ sourceId) => {
        if (!ID_PATTERN.test(sourceId ?? '')) throw new Error('Source ID is invalid.');
        return join(repositoryRoot, 'upstream', 'sources', sourceId);
    };
    const assertSafeSourceRoot = (/** @type {string} */ sourceId) => {
        if (!ID_PATTERN.test(sourceId ?? '')) throw new Error('Source ID is invalid.');
        return assertSafeDirectoryChain(repositoryRoot, ['upstream', 'sources', sourceId]);
    };
    const assertSafeWorkspace = () => assertSafeDirectoryChain(repositoryRoot, ['upstream', '.workspaces', 'active']);
    const indexEntries = async (/** @type {string[]} */ paths) => {
        if (paths.length === 0) return new Map();
        const response = await gitRunner.run({argv: ['ls-files', '-s', '-z', '--', ...paths]});
        if (response.failure || response.code !== 0) throw new Error('Cannot inspect the Git index for sync-owned paths.');
        /** @type {Map<string, IndexEvidence>} */
        const entries = new Map();
        for (const record of response.stdout.toString('utf8').split('\0')) {
            if (record === '') continue;
            const match = /^(\d{6}) ([0-9a-f]+) (\d+)\t(.+)$/.exec(record);
            if (!match) throw new Error('Git returned invalid index evidence.');
            entries.set(match[4], {mode: match[1], objectId: match[2], stage: Number(match[3])});
        }
        return entries;
    };
    const inspectWorkingPath = async (/** @type {string} */ path) => {
        await assertSafeRepositoryParents(path);
        const absolutePath = join(repositoryRoot, ...path.split('/'));
        try {
            const information = await lstat(absolutePath);
            if (!information.isFile() || information.isSymbolicLink()) return {exists: true, kind: 'other', path};
            const bytes = await readFile(absolutePath);
            const objectHash = createHash('sha1');
            objectHash.update(`blob ${bytes.length}\0`);
            objectHash.update(bytes);
            return {
                digest: sha256(bytes),
                exists: true,
                gitObjectId: objectHash.digest('hex'),
                mode: information.mode & 0o111 ? '100755' : '100644',
                path,
            };
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {exists: false, path};
            throw error;
        }
    };
    const assertSafeRepositoryParents = async (/** @type {string} */ path) => {
        if (!isPortablePath(path)) throw new Error('Repository path is not portable.');
        const components = path.split('/');
        let current = repositoryRoot;
        for (const component of components.slice(0, -1)) {
            current = join(current, component);
            try {
                const information = await lstat(current);
                if (!information.isDirectory() || information.isSymbolicLink()) {
                    throw new Error('Repository path has an unsafe parent component.');
                }
            } catch (error) {
                if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
                throw error;
            }
        }
    };
    const validIndexEvidence = (/** @type {Partial<IndexEvidence> | null | undefined} */ index) => index === null
        || (index
            && Object.keys(index).sort().join('\0') === ['mode', 'objectId', 'stage'].join('\0')
            && typeof index.mode === 'string'
            && typeof index.objectId === 'string'
            && PORTABLE_MODES.has(index.mode)
            && /^[0-9a-f]{40,64}$/.test(index.objectId)
            && index.stage === 0);
    const validPreflightEvidence = (/** @type {Array<Partial<PreflightEntry> | null> | unknown} */ evidence, /** @type {string} */ sourceId) => {
        if (!Array.isArray(evidence) || !ID_PATTERN.test(sourceId ?? '')) return false;
        const sourcePaths = new Set([joinRelativePath('upstream/sources', sourceId, 'source.json')]);
        /** @type {Set<string>} */
        const paths = new Set();
        for (const entry of evidence) {
            if (!entry
                || typeof entry.path !== 'string'
                || !isPortablePath(entry.path)
                || (!isAssignedSkillTargetPath(entry.path)
                    && entry.path !== joinRelativePath('docs/licenses/arw', `LICENSE.${sourceId}`)
                    && !sourcePaths.has(entry.path))
                || paths.has(entry.path)
                || typeof entry.exists !== 'boolean'
                || !validIndexEvidence(entry.index)) return false;
            if (entry.exists) {
                if (!/^[0-9a-f]{64}$/.test(entry.digest ?? '')
                    || !/^[0-9a-f]{40,64}$/.test(entry.gitObjectId ?? '')
                    || !PORTABLE_MODES.has(entry.mode)
                    || entry.kind !== undefined) return false;
            } else if (entry.index !== null) return false;
            paths.add(entry.path);
        }
        return paths.has(joinRelativePath('upstream/sources', sourceId, 'source.json'));
    };
    const validCanonicalControlPath = (/** @type {string} */ path, /** @type {string} */ sourceId) => isPortablePath(path)
        && (isAssignedSkillTargetPath(path)
            || path === joinRelativePath('docs/licenses/arw', `LICENSE.${sourceId}`)
            || path === joinRelativePath('upstream/sources', sourceId, 'source.json')
            || new RegExp(`^upstream/sources/${sourceId}/sync-records/[0-9a-f]{64}\\.json$`).test(path));
    const validBase64 = (/** @type {import("buffer").WithImplicitCoercion<string>} */ value) => typeof value === 'string'
        && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
        && Buffer.from(value, 'base64').toString('base64') === value;
    const validPathState = (/** @type {Partial<PathState> | null | undefined} */ state) => Boolean(state
        && ((Object.keys(state).sort().join('\0') === ['exists'].join('\0') && state.exists === false)
            || (Object.keys(state).sort().join('\0') === ['bytes', 'digest', 'exists', 'mode'].join('\0')
                && state.exists === true
                && typeof state.bytes === 'string'
                && typeof state.digest === 'string'
                && typeof state.mode === 'string'
                && validBase64(state.bytes)
                && /^[0-9a-f]{64}$/.test(state.digest ?? '')
                && sha256(Buffer.from(state.bytes, 'base64')) === state.digest
                && PORTABLE_MODES.has(state.mode))));
    const validFinalizedEvidence = (/** @type {Array<(Partial<PathState> & {path?: string, syncRecordId?: string})> | unknown} */ evidence, /** @type {string} */ sourceId, /** @type {Map<string, PromotionTarget> | undefined} */ expectedTargets = undefined, /** @type {string | undefined} */ syncRecordId = undefined) => {
        if (!Array.isArray(evidence) || evidence.length === 0) return false;
        /** @type {Set<string>} */
        const paths = new Set();
        let recordCount = 0;
        for (const entry of evidence) {
            const {path, syncRecordId: entrySyncRecordId, ...state} = entry ?? {};
            if (typeof path !== 'string') return false;
            const expectedTarget = expectedTargets?.get(path);
            const recordPath = syncRecordId
                ? joinRelativePath('upstream/sources', sourceId, 'sync-records', `${syncRecordId}.json`)
                : null;
            if (!validCanonicalControlPath(path, sourceId)
                || paths.has(path)
                || !validPathState(state)
                || (expectedTarget && canonicalJson(state) !== canonicalJson(expectedTarget.post))
                || (path === recordPath && entrySyncRecordId !== syncRecordId)
                || (path !== recordPath && entrySyncRecordId !== undefined)) return false;
            if (path === recordPath) recordCount += 1;
            paths.add(path);
        }
        return (!expectedTargets
            || (paths.size === expectedTargets.size && [...paths].every(path => expectedTargets.has(path))))
            && (!syncRecordId || recordCount === 1);
    };
    const validPendingPromotion = (/** @type {Partial<PromotionPlan> | null | undefined} */ pendingPromotion, /** @type {{preflightEvidence?: PreflightEntry[], sourceId: string, syncRecordId?: string}} */ control) => {
        const sourceId = control.sourceId;
        if (!pendingPromotion
            || Object.keys(pendingPromotion).sort().join('\0')
                !== ['finalizedEvidence', 'recoveryPlanDigest', 'targets', 'version'].join('\0')
            || pendingPromotion.version !== 1
            || !Array.isArray(pendingPromotion.targets)
            || pendingPromotion.targets.length === 0
            || !Array.isArray(pendingPromotion.finalizedEvidence)
            || pendingPromotion.recoveryPlanDigest
                !== sha256(canonicalJson({targets: pendingPromotion.targets, version: 1}))) return false;
        /** @type {Set<string>} */
        const paths = new Set();
        /** @type {Map<string, PromotionTarget>} */
        const targets = new Map();
        const preflightByPath = new Map((control.preflightEvidence ?? []).map(entry => [entry.path, entry]));
        const recordPath = joinRelativePath('upstream/sources', sourceId, 'sync-records', `${control.syncRecordId}.json`);
        for (const target of pendingPromotion.targets) {
            if (!target
                || Object.keys(target).sort().join('\0') !== ['index', 'path', 'post', 'pre'].join('\0')
                || !validCanonicalControlPath(target.path, sourceId)
                || paths.has(target.path)
                || !validIndexEvidence(target.index)
                || !validPathState(target.pre)
                || !validPathState(target.post)) return false;
            const expected = preflightByPath.get(target.path) ?? {exists: false, index: null};
            const preMatches = target.path === recordPath
                ? target.index === null && canonicalJson(target.pre) === canonicalJson({exists: false})
                : canonicalJson(target.index) === canonicalJson(expected.index)
                    && target.pre.exists === expected.exists
                    && (!expected.exists
                        || (target.pre.digest === expected.digest && target.pre.mode === expected.mode));
            if (!preMatches) return false;
            paths.add(target.path);
            targets.set(target.path, target);
        }
        return /^[0-9a-f]{64}$/.test(control.syncRecordId ?? '')
            && paths.has(recordPath)
            && validFinalizedEvidence(
                pendingPromotion.finalizedEvidence,
                sourceId,
                targets,
                control.syncRecordId,
            );
    };
    const validSkillReferenceReview = (/** @type {Partial<SkillReferenceReview> | null | undefined} */ review) => {
        const additional = review?.additionalSkillReferences;
        const normalizations = review?.skillReferenceNormalizations;
        if (!review) return false;
        const structureIsValid = Boolean(
            Object.keys(review).sort().join('\0') === [
                'additionalSkillReferences',
                'additionalSkillReferencesHash',
                'skillReferenceNormalizations',
                'skillReferenceNormalizationsHash',
            ].join('\0')
            && Array.isArray(additional)
            && additional.every(identity => isSkillIdentity(identity))
            && new Set(additional).size === additional.length
            && [...additional].sort().every((identity, index) => identity === additional[index])
            && typeof review.additionalSkillReferencesHash === 'string'
            && /^[0-9a-f]{64}$/.test(review.additionalSkillReferencesHash)
            && Array.isArray(normalizations)
            && normalizations.every(record => record
                && typeof record === 'object'
                && !Array.isArray(record)
                && Object.keys(record).sort().join('\0') === ['column', 'context', 'identity', 'line', 'path'].join('\0')
                && Number.isSafeInteger(record.column)
                && record.column > 0
                && Number.isSafeInteger(record.line)
                && record.line > 0
                && isSkillIdentity(record.identity)
                && isPortablePath(record.path)
                && record.path.startsWith('skills/')
                && record.path.endsWith('.md')
                && typeof record.context === 'string'
                && record.context.length > 0)
            && new Set(normalizations.map(sourceNormalizationKey)).size === normalizations.length
            && [...normalizations].sort(sourceNormalizationOrder)
                .every((record, index) => sourceNormalizationOrder(record, normalizations[index]) === 0)
            && typeof review.skillReferenceNormalizationsHash === 'string'
            && /^[0-9a-f]{64}$/.test(review.skillReferenceNormalizationsHash));
        if (!structureIsValid || !additional || !normalizations) return false;
        try {
            const hashes = skillReferenceReviewHashes({
                additionalSkillReferences: additional,
                skillReferenceNormalizations: normalizations,
            });
            return hashes.additionalSkillReferencesHash === review.additionalSkillReferencesHash
                && hashes.skillReferenceNormalizationsHash === review.skillReferenceNormalizationsHash;
        } catch {
            return false;
        }
    };
    const validApprovalEvidence = (/** @type {ApprovalEvidence | null | undefined} */ approval, /** @type {Partial<SyncWorkspace>} */ workspace) => approval === null
        || Boolean(approval
            && Object.keys(approval).every(key => [
                'approvalAttestationId',
                'candidateActualSkillDigest',
                'candidateSourceDigest',
                'channel',
                'externalEvidence',
                'humanConfirmation',
                'agentMergeNotesDigest',
                'reviewRevisionId',
                'status',
            ].includes(key))
            && ['agentMergeNotesDigest', 'approvalAttestationId', 'candidateActualSkillDigest', 'candidateSourceDigest', 'reviewRevisionId']
                .every(key => typeof approval[key] === 'string' && /^[0-9a-f]{64}$/.test(approval[key]))
            && approval.status === 'approved'
            && typeof approval.channel === 'string'
            && approval.channel.trim() !== ''
            && ['externalEvidence', 'humanConfirmation'].every(key => !(key in approval)
                || (typeof approval[key] === 'string' && approval[key].trim() !== ''))
            && (approval.externalEvidence || approval.humanConfirmation)
            && approvalMatchesWorkspace(approval, workspace));
    const validOwnedWorkspacePaths = (/** @type {string[] | unknown} */ paths) => Array.isArray(paths)
        && new Set(paths).size === paths.length
        && paths.every(path => isPortablePath(path)
            && (path === 'agent-merge-notes.md'
                || ['base/', 'candidate/', 'merge-base/', 'merge-theirs/', 'ours/', 'skill-reference-review/', 'theirs/']
                    .some(prefix => path.startsWith(prefix))));
    const manualWorkspace = async () => {
        let remainingPaths = ['control.json'];
        try {
            remainingPaths = (await readdir(activeWorkspace)).sort();
        } catch {
            // 保留稳定的 control.json 恢复提示.
        }
        return {recoveryKind: 'manual-workspace', remainingPaths, state: 'recovering'};
    };
    const captureActualPreflightEvidence = async (/** @type {string} */ sourceId, /** @type {string[]} */ canonicalPaths) => {
        const paths = canonicalPaths.map(path => repositoryTargetPath(sourceId, path));
        const sourcePath = joinRelativePath('upstream/sources', sourceId, 'source.json');
        paths.push(sourcePath);
        const indexed = await indexEntries([...new Set(paths)]);
        const completePaths = [...new Set([...paths, ...indexed.keys()])].sort(compareText);
        return Promise.all(completePaths.map(async path => ({
            ...await inspectWorkingPath(path),
            index: indexed.get(path) ?? null,
        })));
    };
    const replaceCanonicalFile = async (/** @type {string} */ path, /** @type {string | Uint8Array} */ bytes, /** @type {string} */ mode = '100644') => {
        await assertSafeRepositoryParents(path);
        const target = join(repositoryRoot, ...path.split('/'));
        await mkdir(dirname(target), {recursive: true});
        await rm(`${target}.tmp`, {force: true});
        await writeFile(`${target}.tmp`, bytes, {flag: 'wx'});
        await rename(`${target}.tmp`, target);
        if (mode === '100755' && process.platform !== 'win32') await chmod(target, 0o755);
    };
    const exactPathState = async (/** @type {string} */ path) => {
        await assertSafeRepositoryParents(path);
        const absolutePath = join(repositoryRoot, ...path.split('/'));
        try {
            const information = await lstat(absolutePath);
            if (!information.isFile() || information.isSymbolicLink()) return {exists: true, kind: 'other'};
            const bytes = await readFile(absolutePath);
            return {
                bytes: bytes.toString('base64'),
                digest: sha256(bytes),
                exists: true,
                mode: information.mode & 0o111 ? '100755' : '100644',
            };
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {exists: false};
            throw error;
        }
    };
    const bytesState = (/** @type {Buffer} */ bytes, /** @type {string} */ mode = '100644') => ({
        bytes: bytes.toString('base64'),
        digest: sha256(bytes),
        exists: true,
        mode,
    });
    const expectedSyncRecord = (/** @type {SyncWorkspace} */ workspace) => {
        const recordWithoutIdentity = syncRecordWithoutIdentityFor(workspace);
        const syncRecordId = sha256(canonicalJson(recordWithoutIdentity));
        return {
            path: joinRelativePath('upstream/sources', workspace.sourceId, 'sync-records', `${syncRecordId}.json`),
            state: bytesState(Buffer.from(canonicalJson({...recordWithoutIdentity, syncRecordId}))),
            syncRecordId,
        };
    };
    const samePathState = (/** @type {PathState} */ left, /** @type {PathState} */ right) => canonicalJson(left) === canonicalJson(right);
    const expectedPromotionPostStates = (/** @type {SyncWorkspace} */ workspace) => {
        const candidateEntries = new Map(workspace.candidate.map(entry => [repositoryTargetPath(workspace.sourceId, entry.path), entry]));
        /** @type {Map<string, PathState>} */
        const states = new Map();
        const sourcePath = joinRelativePath('upstream/sources', workspace.sourceId, 'source.json');
        const licensePath = joinRelativePath('docs/licenses/arw', `LICENSE.${workspace.sourceId}`);
        for (const path of completedCanonicalPathsFor(workspace)) {
            const entry = candidateEntries.get(path);
            if (entry) states.set(path, bytesState(entry.bytes, entry.mode));
            else if (path.startsWith('.agents/skills/') || path === licensePath) states.set(path, {exists: false});
            else if (path === sourcePath) states.set(path, bytesState(Buffer.from(sourceConfigurationJson(candidateSourceConfigurationFor(workspace)))));
            else throw new Error('Completed canonical path has no reconstructed post-state.');
        }
        const record = expectedSyncRecord(workspace);
        states.set(record.path, record.state);
        return {record, states};
    };
    const validFinalizedPromotionEvidence = (/** @type {SyncWorkspace} */ workspace) => {
        if (!Array.isArray(workspace.finalizedEvidence)) return false;
        try {
            const {record, states} = expectedPromotionPostStates(workspace);
            if (workspace.syncRecordId !== record.syncRecordId || workspace.finalizedEvidence.length !== states.size) return false;
            const paths = new Set();
            for (const entry of workspace.finalizedEvidence) {
                const {path, syncRecordId, ...state} = entry ?? {};
                const expectedState = typeof path === 'string' ? states.get(path) : undefined;
                if (typeof path !== 'string'
                    || paths.has(path)
                    || !validCanonicalControlPath(path, workspace.sourceId)
                    || !validPathState(state)
                    || !expectedState
                    || !samePathState(state, expectedState)) return false;
                if ((path === record.path && syncRecordId !== record.syncRecordId)
                    || (path !== record.path && syncRecordId !== undefined)) return false;
                paths.add(path);
            }
            return paths.size === states.size;
        } catch {
            return false;
        }
    };
    const validPromotionPostEvidence = async (/** @type {SyncWorkspace} */ workspace) => {
        if (!workspace.pendingPromotion) return true;
        try {
            const targets = new Map(workspace.pendingPromotion.targets.map(target => [target.path, target]));
            const {record, states} = expectedPromotionPostStates(workspace);
            if (record.syncRecordId !== workspace.syncRecordId || targets.size !== states.size) return false;
            for (const [path, state] of states) {
                const target = targets.get(path);
                if (!target || !samePathState(target.post, state)) return false;
            }
            return true;
        } catch {
            return false;
        }
    };
    const writePathState = async (/** @type {string} */ path, /** @type {PathState} */ state) => {
        await assertSafeRepositoryParents(path);
        if (!state.exists) {
            await rm(join(repositoryRoot, ...path.split('/')), {force: true});
            return;
        }
        if (state.bytes === undefined || state.mode === undefined) throw new Error('Path state is missing bytes or mode.');
        await replaceCanonicalFile(path, Buffer.from(state.bytes, 'base64'), state.mode);
    };
    const constructPromotionPlan = async (/** @type {PromotionRequest} */ {sourceId, syncRecord, workspace}) => {
        /** @type {PromotionTarget[]} */
        const targets = [];
        const beforeByPath = new Map(workspace.ours.map(entry => [repositoryTargetPath(sourceId, entry.path), entry]));
        const afterByPath = new Map(workspace.candidate.map(entry => [repositoryTargetPath(sourceId, entry.path), entry]));
        const preflightByPath = new Map((workspace?.preflightEvidence ?? []).map(entry => [entry.path, entry]));
        for (const path of [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])]
            .sort((left, right) => left.localeCompare(right, 'en'))) {
            if (sameEntry(beforeByPath.get(path), afterByPath.get(path))) continue;
            targets.push({
                index: preflightByPath.get(path)?.index ?? null,
                path,
                post: afterByPath.has(path)
                    ? bytesState(afterByPath.get(path)?.bytes ?? Buffer.alloc(0), afterByPath.get(path)?.mode ?? '100644')
                    : {exists: false},
                pre: await exactPathState(path),
            });
        }
        const sourcePath = joinRelativePath('upstream/sources', sourceId, 'source.json');
        const sourcePre = await exactPathState(sourcePath);
        const sourcePost = bytesState(Buffer.from(sourceConfigurationJson(candidateSourceConfigurationFor(workspace))));
        if (!samePathState(sourcePre, sourcePost)) {
            targets.push({
                index: preflightByPath.get(sourcePath)?.index ?? null,
                path: sourcePath,
                post: sourcePost,
                pre: sourcePre,
            });
        }
        const recordPath = joinRelativePath('upstream/sources', sourceId, 'sync-records', `${syncRecord.syncRecordId}.json`);
        const recordPre = await exactPathState(recordPath);
        const recordIndex = (await indexEntries([recordPath])).get(recordPath) ?? null;
        if (recordPre.exists || recordIndex) throw new Error('Sync Record identity already exists.');
        targets.push({
            index: null,
            path: recordPath,
            post: bytesState(Buffer.from(canonicalJson(syncRecord))),
            pre: {exists: false},
        });
        for (const target of targets) {
            const expected = preflightByPath.get(target.path) ?? {exists: false, index: null};
            const bound = target.path === recordPath
                ? target.index === null && samePathState(target.pre, {exists: false})
                : canonicalJson(target.index) === canonicalJson(expected.index)
                    && target.pre.exists === expected.exists
                    && (!expected.exists
                        || (target.pre.digest === expected.digest && target.pre.mode === expected.mode));
            if (!bound) throw new Error('Promotion pre-image no longer matches prepare evidence.');
        }
        const recoveryPlanDigest = sha256(canonicalJson({targets, version: 1}));
        return {
            finalizedEvidence: targets.map(target => ({
                ...target.post,
                path: target.path,
                ...(target.path === recordPath ? {syncRecordId: syncRecord.syncRecordId} : {}),
            })),
            recoveryPlanDigest,
            targets,
            version: 1,
        };
    };
    const inspectPromotionRecovery = async (/** @type {SyncWorkspace} */ workspace) => {
        const pendingPromotion = workspace.pendingPromotion;
        if (!pendingPromotion
            || !validPendingPromotion(pendingPromotion, workspace)
            || !await validPromotionPostEvidence(workspace)) {
            return {matches: false};
        }
        const paths = pendingPromotion.targets.map(target => target.path);
        const indexed = await indexEntries(paths);
        const states = [];
        for (const target of pendingPromotion.targets) {
            const currentIndex = indexed.get(target.path) ?? null;
            if (canonicalJson(currentIndex) !== canonicalJson(target.index)) return {matches: false};
            const current = await exactPathState(target.path);
            const state = samePathState(current, target.pre)
                ? 'pre-image'
                : samePathState(current, target.post) ? 'post-image' : 'third-state';
            if (state === 'third-state') return {matches: false};
            states.push({path: target.path, state});
        }
        return {
            matches: true,
            recoveryPlan: {
                recoveryPlanDigest: pendingPromotion.recoveryPlanDigest,
                states,
                version: 1,
            },
        };
    };
    return {
        reviewWorkspaceDirectory: join(activeWorkspace, 'skill-reference-review'),
        async loadConfiguration(/** @type {string} */ sourceId) {
            await assertSafeSourceRoot(sourceId);
            return readJson(join(sourceRoot(sourceId), 'source.json'));
        },
        async loadConfigurationDigest(/** @type {string} */ sourceId) {
            await assertSafeSourceRoot(sourceId);
            return sha256(canonicalJson(await readJson(join(sourceRoot(sourceId), 'source.json'))));
        },
        async loadProjectionConfiguration() {
            await assertSafeDirectoryChain(repositoryRoot, ['distribution', 'projections']);
            return readJson(join(repositoryRoot, 'distribution', 'projections', 'config.json'));
        },
        async loadActualOurs(/** @type {{canonicalPaths: string[], sourceId: string}} */ {canonicalPaths, sourceId}) {
            if (!ID_PATTERN.test(sourceId ?? '')
                || !Array.isArray(canonicalPaths)
                || canonicalPaths.some(path => !isPortablePath(path))
                || new Set(canonicalPaths.map(path => path.toLowerCase())).size !== canonicalPaths.length) {
                throw new Error('Canonical Source Checkout paths are invalid.');
            }
            const skillsDirectory = join(repositoryRoot, '.agents', 'skills');
            await assertSafeDirectoryChain(repositoryRoot, ['.agents', 'skills']);
            /** @type {import('node:fs').Dirent[]} */
            let skillDirectories;
            try {
                skillDirectories = await readdir(skillsDirectory, {withFileTypes: true});
            } catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
                skillDirectories = [];
            }
            skillDirectories.sort((left, right) => compareText(left.name, right.name));
            if (skillDirectories.some(entry => !entry.isDirectory() || entry.isSymbolicLink() || !isSkillIdentity(entry.name))) {
                throw new Error('Actual Skill roots must be safe direct Skill directories.');
            }
            /** @type {Array<{canonicalPath: string, repositoryPath: string}>} */
            const mappings = [];
            for (const {name: identity} of skillDirectories) {
                const repositoryDirectory = join(repositoryRoot, '.agents', 'skills', identity);
                const entries = await listRegularTree(repositoryDirectory);
                if (!entries.some(entry => entry.path === 'SKILL.md')) {
                    throw new Error('Actual Skill roots must contain SKILL.md.');
                }
                for (const entry of entries) {
                    if (!isPortablePath(entry.path)) {
                        throw new Error('Actual Skill content paths must be portable.');
                    }
                    mappings.push({
                        canonicalPath: joinRelativePath('skills', identity, entry.path),
                        repositoryPath: joinRelativePath('.agents/skills', identity, entry.path),
                    });
                }
            }
            if (canonicalPaths.includes('LICENSE')) {
                const repositoryPath = joinRelativePath('docs/licenses/arw', `LICENSE.${sourceId}`);
                try {
                    await assertSafeRepositoryParents(repositoryPath);
                    const information = await lstat(join(repositoryRoot, ...repositoryPath.split('/')));
                    if (!information.isFile() || information.isSymbolicLink()) throw new Error('The fixed license target is not a regular file.');
                    mappings.push({canonicalPath: 'LICENSE', repositoryPath});
                } catch (error) {
                    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
                }
            }
            mappings.sort((left, right) => compareText(left.canonicalPath, right.canonicalPath));
            if (new Set(mappings.map(mapping => mapping.canonicalPath.toLowerCase())).size !== mappings.length) {
                throw new Error('Actual Source Checkout targets contain a portable path collision.');
            }
            const indexed = await indexEntries(mappings.map(mapping => mapping.repositoryPath));
            const entries = await Promise.all(mappings.map(async mapping => {
                const mode = indexed.get(mapping.repositoryPath)?.mode;
                if (!PORTABLE_MODES.has(mode)) throw new Error('An actual Source Checkout target is not a portable stage-zero blob.');
                return {
                    bytes: await readRegularFile(join(repositoryRoot, ...mapping.repositoryPath.split('/'))),
                    mode,
                    path: mapping.canonicalPath,
                };
            }));
            await assertSafeSourceRoot(sourceId);
            return {entries};
        },
        async inspectPreparePreflight(/** @type {string} */ sourceId, /** @type {string[]} */ canonicalPaths) {
            const evidence = await captureActualPreflightEvidence(sourceId, canonicalPaths);
            const matches = evidence.every(entry => (!entry.exists && !entry.index)
                || (entry.exists
                    && !entry.kind
                    && entry.index
                    && entry.index.stage === 0
                    && entry.index.objectId === entry.gitObjectId
                    && (process.platform === 'win32' || entry.index.mode === entry.mode)));
            return {evidence, matches};
        },
        async loadWorkspace() {
            try {
                await assertSafeWorkspace();
            } catch {
                return {recoveryKind: 'manual-workspace', remainingPaths: ['unsafe-workspace-root'], state: 'recovering'};
            }
            let control;
            try {
                control = await readOptionalJson(controlPath, null);
            } catch {
                return manualWorkspace();
            }
            if (!control) {
                try {
                    const residualEntries = await readdir(activeWorkspace);
                    if (residualEntries.length === 0) return null;
                    return {
                        recoveryKind: 'manual-workspace',
                        remainingPaths: residualEntries.sort(),
                        state: 'recovering',
                    };
                } catch (error) {
                    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
                    throw error;
                }
            }
            control = currentWorkspaceControl(control);
            if (!control
                || typeof control !== 'object'
                || !WORKSPACE_STATES.has(control.state)
                || !validOwnedWorkspacePaths(control.ownedWorkspacePaths)) {
                return manualWorkspace();
            }
            if (!validSnapshotInventory(control.base, true)
                || !validSnapshotInventory(control.candidate, false)
                || !validSnapshotInventory(control.mergeBase, true)
                || !validSnapshotInventory(control.mergeTheirs, true)
                || !validSnapshotInventory(control.ours, true)
                || !validSnapshotInventory(control.theirs, true)
                || !validateSourceConfiguration(control.sourceConfiguration, control.sourceId, false)
                || !validateUrl(control.sourceConfiguration?.url)
                || !normalizeScope(control.sourceConfiguration?.scope)
                || control.configurationDigest !== sha256(canonicalJson(control.sourceConfiguration))
                || control.sourceConfiguration.commit !== control.previousCommit
                || !FULL_COMMIT_PATTERN.test(control.targetCommit ?? '')
                || !validPreflightEvidence(control.preflightEvidence, control.sourceId)
                || ('approval' in control && !validApprovalEvidence(control.approval, control))
                || (control.state === 'approved' && !validApprovalEvidence(control.approval, control))
                || ('theirsSkillReferenceReview' in control
                    && control.theirsSkillReferenceReview !== undefined
                    && !validSkillReferenceReview(control.theirsSkillReferenceReview))
                || ('pendingPromotion' in control
                    && control.pendingPromotion !== null
                    && !validPendingPromotion(control.pendingPromotion, control))
                || (control.state === 'recovering'
                    && control.recoveryKind !== 'abort'
                    && !validPendingPromotion(control.pendingPromotion, control))
                || ('finalizedEvidence' in control
                    && !validFinalizedEvidence(
                        control.finalizedEvidence,
                        control.sourceId,
                        undefined,
                        control.syncRecordId,
                    ))
                || (['awaiting-commit', 'checkpoint-satisfied'].includes(control.state)
                    && (!/^[0-9a-f]{64}$/.test(control.syncRecordId ?? '')
                        || !validFinalizedEvidence(
                            control.finalizedEvidence,
                            control.sourceId,
                            undefined,
                            control.syncRecordId,
                        )))) {
                return manualWorkspace();
            }
            if (control.recoveryKind === 'abort') return control;
            try {
                const loaded = {
                    ...control,
                    agentMergeNotes: await readUtf8File(join(activeWorkspace, 'agent-merge-notes.md')),
                    base: await readSnapshotTree(join(activeWorkspace, 'base'), control.base),
                    candidate: await readEditableSnapshotTree(join(activeWorkspace, 'candidate'), control.candidate),
                    mergeBase: await readSnapshotTree(join(activeWorkspace, 'merge-base'), control.mergeBase),
                    mergeTheirs: await readSnapshotTree(join(activeWorkspace, 'merge-theirs'), control.mergeTheirs),
                    ours: await readSnapshotTree(join(activeWorkspace, 'ours'), control.ours),
                    theirs: await readSnapshotTree(join(activeWorkspace, 'theirs'), control.theirs),
                };
                if (!await validPromotionPostEvidence(loaded)
                    || (['awaiting-commit', 'checkpoint-satisfied'].includes(loaded.state)
                        && !validFinalizedPromotionEvidence(loaded))) return manualWorkspace();
                return loaded;
            } catch {
                return manualWorkspace();
            }
        },
        async saveWorkspace(/** @type {SyncWorkspace} */ workspace) {
            await assertSafeWorkspace();
            await mkdir(activeWorkspace, {recursive: true});
            await assertSafeWorkspace();
            const existingControl = await readOptionalJson(controlPath, null);
            await writeSnapshotTree(join(activeWorkspace, 'base'), workspace.base ?? []);
            await writeSnapshotTree(join(activeWorkspace, 'candidate'), workspace.candidate ?? []);
            await writeSnapshotTree(join(activeWorkspace, 'merge-base'), workspace.mergeBase ?? []);
            await writeSnapshotTree(join(activeWorkspace, 'merge-theirs'), workspace.mergeTheirs ?? []);
            await writeSnapshotTree(join(activeWorkspace, 'ours'), workspace.ours ?? []);
            await writeSnapshotTree(join(activeWorkspace, 'theirs'), workspace.theirs ?? []);
            const notesPath = join(activeWorkspace, 'agent-merge-notes.md');
            await rm(`${notesPath}.tmp`, {force: true});
            await writeFile(`${notesPath}.tmp`, workspace.agentMergeNotes ?? '', {encoding: 'utf8', flag: 'wx'});
            await rename(`${notesPath}.tmp`, notesPath);
            const {agentMergeNotes: discardedAgentMergeNotes, ...workspaceWithoutNotes} = workspace;
            const workspaceControl = currentWorkspaceControl(workspaceWithoutNotes);
            const control = {
                ...workspaceControl,
                base: snapshotEvidence(workspace.base ?? []),
                candidate: snapshotInventory(workspace.candidate ?? []),
                mergeBase: snapshotEvidence(workspace.mergeBase ?? []),
                mergeTheirs: snapshotEvidence(workspace.mergeTheirs ?? []),
                ours: snapshotEvidence(workspace.ours ?? []),
                theirs: snapshotEvidence(workspace.theirs ?? []),
            };
            if (Array.isArray(workspace.preflightEvidence)) {
                control.preflightEvidence = workspace.preflightEvidence;
            } else if (!existingControl && FULL_COMMIT_PATTERN.test(workspace.targetCommit ?? '')) {
                control.preflightEvidence = await captureActualPreflightEvidence(
                    workspace.sourceId,
                    [...new Set([...workspace.mergeBase, ...workspace.ours, ...workspace.mergeTheirs].map(entry => entry.path))].sort(compareText),
                );
            } else {
                control.preflightEvidence = existingControl?.preflightEvidence ?? [];
            }
            control.ownedWorkspacePaths = (await listRegularTree(activeWorkspace))
                .map(entry => entry.path)
                .filter((/** @type {string} */ path) => path !== 'control.json' && !path.endsWith('.tmp'))
                .sort((left, right) => left.localeCompare(right, 'en'));
            await rm(`${controlPath}.tmp`, {force: true});
            await writeCanonicalJson(controlPath, control);
        },
        async preflightPromotion(/** @type {SyncWorkspace} */ workspace) {
            await assertSafeWorkspace();
            if (!Array.isArray(workspace.preflightEvidence)) return {matches: false};
            const candidatePaths = workspace.candidate.map(entry => repositoryTargetPath(workspace.sourceId, entry.path));
            const expectedByPath = new Map(workspace.preflightEvidence.map(entry => [entry.path, entry]));
            const allPaths = [...new Set([...expectedByPath.keys(), ...candidatePaths])]
                .sort((left, right) => left.localeCompare(right, 'en'));
            const indexed = await indexEntries(allPaths);
            for (const path of allPaths) {
                const expected = expectedByPath.get(path) ?? {exists: false, index: null, path};
                const actual = await inspectWorkingPath(path);
                const actualIndex = indexed.get(path) ?? null;
                if (actual.exists !== expected.exists
                    || actual.kind !== expected.kind
                    || actual.digest !== expected.digest
                    || actual.gitObjectId !== expected.gitObjectId
                    || (process.platform !== 'win32' && actual.mode !== expected.mode)
                    || canonicalJson(actualIndex) !== canonicalJson(expected.index)) {
                    return {matches: false};
                }
            }
            return {matches: true};
        },
        async createPromotionPlan(/** @type {Parameters<typeof constructPromotionPlan>[0]} */ request) {
            await assertSafeWorkspace();
            return constructPromotionPlan(request);
        },
        async applyPromotion(/** @type {PromotionRequest & Partial<PromotionPlan>} */ request) {
            const requestKeys = [
                'candidate',
                'finalizedEvidence',
                'recoveryPlanDigest',
                'sourceId',
                'syncRecord',
                'targets',
                'version',
                'workspace',
            ];
            if (!request
                || typeof request !== 'object'
                || Object.keys(request).sort(compareText).join('\0') !== requestKeys.join('\0')) {
                throw new TypeError('Promotion apply requires a bound request.');
            }
            const expectedRecord = expectedSyncRecord(request.workspace);
            const expectedSyncRecordValue = {
                ...syncRecordWithoutIdentityFor(request.workspace),
                syncRecordId: expectedRecord.syncRecordId,
            };
            if (request.workspace.state !== 'approved'
                || request.sourceId !== request.workspace.sourceId
                || canonicalJson(serializeEntries(request.candidate)) !== canonicalJson(serializeEntries(request.workspace.candidate))
                || canonicalJson(request.syncRecord) !== canonicalJson(expectedSyncRecordValue)
                || expectedRecord.syncRecordId !== request.syncRecord.syncRecordId) {
                throw new Error('Promotion request does not match its workspace binding.');
            }
            const plan = await constructPromotionPlan({
                candidate: request.workspace.candidate,
                sourceId: request.workspace.sourceId,
                syncRecord: expectedSyncRecordValue,
                workspace: request.workspace,
            });
            const suppliedPlan = {
                finalizedEvidence: request.finalizedEvidence,
                recoveryPlanDigest: request.recoveryPlanDigest,
                targets: request.targets,
                version: request.version,
            };
            if (canonicalJson(suppliedPlan) !== canonicalJson(plan)) {
                throw new Error('Promotion plan does not match its bound request.');
            }
            const indexed = await indexEntries(plan.targets.map(target => target.path));
            for (const target of plan.targets) {
                const current = await exactPathState(target.path);
                const currentIndex = indexed.get(target.path) ?? null;
                if (!samePathState(current, target.pre)
                    || canonicalJson(currentIndex) !== canonicalJson(target.index)) {
                    throw new Error('Promotion pre-image changed before the first write.');
                }
            }
            for (const target of plan.targets) await writePathState(target.path, target.post);
            return {finalizedEvidence: plan.finalizedEvidence};
        },
        async inspectRecovery(/** @type {SyncWorkspace} */ workspace) {
            return workspace.pendingPromotion
                ? inspectPromotionRecovery(workspace)
                : {matches: false};
        },
        async applyRecovery(/** @type {SyncWorkspace} */ workspace, /** @type {'abort' | 'finalize'} */ direction, /** @type {{recoveryPlanDigest: string}} */ recoveryPlan) {
            if (!workspace.pendingPromotion) throw new Error('Recovery workspace has no pending promotion.');
            const inspection = await inspectPromotionRecovery(workspace);
            if (!inspection.matches
                || !inspection.recoveryPlan
                || inspection.recoveryPlan.recoveryPlanDigest !== recoveryPlan.recoveryPlanDigest
                || !['abort', 'finalize'].includes(direction)) {
                throw new Error('Recovery evidence changed before apply.');
            }
            const selectedState = direction === 'finalize' ? 'post-image' : 'pre-image';
            const states = new Map(inspection.recoveryPlan.states?.map(entry => [entry.path, entry.state]));
            for (const target of workspace.pendingPromotion.targets) {
                if (states.get(target.path) === selectedState) continue;
                await writePathState(target.path, direction === 'finalize' ? target.post : target.pre);
            }
            return direction === 'finalize'
                ? {finalizedEvidence: workspace.pendingPromotion.finalizedEvidence}
                : {finalizedEvidence: []};
        },
        async headMatches(/** @type {Array<PathState & {path: string}> | unknown} */ finalizedEvidence) {
            if (!Array.isArray(finalizedEvidence)) return false;
            const paths = finalizedEvidence.map(entry => entry.path);
            const response = await gitRunner.run({argv: ['ls-tree', '-rz', '--full-tree', 'HEAD', '--', ...paths]});
            if (response.failure || response.code !== 0) return false;
            const metadata = [];
            for (const record of response.stdout.toString('utf8').split('\0')) {
                if (record === '') continue;
                const match = /^(\d{6}) blob ([0-9a-f]+)\t(.+)$/.exec(record);
                if (!match) return false;
                metadata.push({mode: match[1], objectId: match[2], path: match[3]});
            }
            const objectIds = metadata.map(entry => entry.objectId);
            let blobs = new Map();
            if (objectIds.length > 0) {
                const batch = await gitRunner.run({
                    argv: ['cat-file', '--batch'],
                    input: Buffer.from(`${objectIds.join('\n')}\n`),
                });
                if (batch.failure || batch.code !== 0) return false;
                try {
                    blobs = parseBatchBlobs(objectIds, batch.stdout);
                } catch {
                    return false;
                }
            }
            const headEntries = new Map(metadata.map(entry => [entry.path, {
                bytes: blobs.get(entry.objectId),
                mode: entry.mode,
            }]));
            return finalizedEvidence.every(expected => {
                const actual = headEntries.get(expected.path);
                if (!expected.exists) return !actual;
                return Boolean(actual
                    && actual.mode === expected.mode
                    && actual.bytes.equals(Buffer.from(expected.bytes, 'base64')));
            });
        },
        async abortWorkspace(/** @type {SyncWorkspace} */ workspace) {
            await assertSafeWorkspace();
            const remainingPaths = [];
            const ownedPaths = [...new Set(workspace.ownedWorkspacePaths ?? [])]
                .filter(isPortablePath)
                .sort((left, right) => right.localeCompare(left, 'en'));
            for (const path of ownedPaths) {
                try {
                    await assertSafeDirectoryChain(activeWorkspace, path.split('/').slice(0, -1));
                    await rm(join(activeWorkspace, ...path.split('/')), {force: true});
                } catch {
                    remainingPaths.push(path);
                }
            }
            const directoryPaths = new Set();
            for (const path of ['base', 'candidate', 'merge-base', 'merge-theirs', 'ours', 'reviews', 'skill-reference-review', 'theirs']) {
                directoryPaths.add(path);
            }
            for (const path of ownedPaths) {
                const components = path.split('/');
                for (let length = components.length - 1; length > 0; length -= 1) {
                    directoryPaths.add(components.slice(0, length).join('/'));
                }
            }
            for (const path of [...directoryPaths].sort((left, right) =>
                right.split('/').length - left.split('/').length
                || right.localeCompare(left, 'en'))) {
                try {
                    await assertSafeDirectoryChain(activeWorkspace, path.split('/').slice(0, -1));
                    await rmdir(join(activeWorkspace, ...path.split('/')));
                } catch (error) {
                    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
                        remainingPaths.push(path);
                    }
                }
            }
            let observed = [];
            try {
                observed = (await listRegularTree(activeWorkspace))
                    .map(entry => entry.path)
                    .filter((/** @type {string} */ path) => path !== 'control.json');
            } catch {
                observed = ['workspace-inspection-failed'];
            }
            const remaining = [...new Set([...remainingPaths, ...observed])]
                .sort((left, right) => left.localeCompare(right, 'en'));
            if (remaining.length === 0) {
                await rm(controlPath, {force: true});
                try {
                    await rmdir(activeWorkspace);
                } catch (error) {
                    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
                        return {remainingPaths: ['workspace-directory']};
                    }
                }
            }
            return {remainingPaths: remaining};
        },
        async recordAbortRecovery(/** @type {SyncWorkspace} */ workspace, /** @type {string[]} */ remainingPaths) {
            await assertSafeWorkspace();
            const control = currentWorkspaceControl({
                ...workspace,
                recoveryKind: 'abort',
                remainingPaths,
                state: 'recovering',
            });
            await rm(`${controlPath}.tmp`, {force: true});
            await writeCanonicalJson(controlPath, control);
        },
        async deleteWorkspace(/** @type {SyncWorkspace | undefined} */ workspace = undefined) {
            await assertSafeWorkspace();
            const saved = workspace ?? await readOptionalJson(controlPath, null);
            const current = saved ? currentWorkspaceControl(saved) : null;
            if (!current) return;
            const cleanup = await this.abortWorkspace(current);
            if (cleanup.remainingPaths.length > 0) throw new Error('Disposable workspace contains paths not proven by the control record.');
        },
    };
};

/**
 * 从当前目录发现最近的 Source Checkout, 组装生产 Upstream Sync Module.
 * 输入允许替换 Git runner 和临时目录. 返回值是完成 Git 获取, workspace 持久化,
 * 实际目标事务和状态策略绑定后的 Module. 非 Git Repository 会关闭式失败.
 */
export const createSourceCheckoutUpstreamSyncModule = async (/** @type {{currentDirectory?: string, gitRunner?: GitRunner, temporaryDirectory?: string}} */ {
    currentDirectory = process.cwd(),
    gitRunner = createNodeGitRunner(currentDirectory),
    temporaryDirectory = undefined,
} = {}) => {
    const response = await gitRunner.run({argv: ['rev-parse', '--show-toplevel']});
    if (response.failure || response.code !== 0) throw new Error('Upstream Sync requires a Git Source Checkout.');
    const repositoryRoot = response.stdout.toString('utf8').trim();
    const acquisitionWorkspaceRoot = temporaryDirectory ?? join(repositoryRoot, 'upstream', '.workspaces');
    const sourceState = createSourceCheckoutStateAdapter({gitRunner, repositoryRoot});
    return createUpstreamSyncModule({
        git: createUpstreamGitAdapter({gitRunner, temporaryDirectory: acquisitionWorkspaceRoot}),
        loadReviewEditor: async () => (await loadConfig(repositoryRoot)).reviewEditor,
        sourceState,
    });
};

const CLI_USAGE = 'Usage: node scripts/upstream-sync.mjs prepare --source <source-id> --to <full-commit-id> | status | review [--confirm <additional-skill-references-hash> <skill-reference-normalizations-hash>] | approve | finalize | abort\n';

const escapeCliValue = (/** @type {unknown} */ value) => JSON.stringify(String(value)).slice(1, -1);

const presentCliResult = (/** @type {SyncOperationResult} */ operationResult, /** @type {{rawStdout: OutputWriter, stderr: OutputWriter, stdout: OutputWriter}} */ {rawStdout, stderr, stdout}) => {
    stdout(`State: ${escapeCliValue(operationResult.state)}\nPermitted operations: ${operationResult.permittedOperations.map(escapeCliValue).join(', ')}\n`);
    const scalarFields = [
        ['workspaceId', 'Workspace ID'],
        ['sourceRelationship', 'Source relationship'],
        ['reviewRevisionId', 'Review Revision ID'],
        ['agentMergeNotesDigest', 'Agent Merge Notes Digest'],
        ['candidateActualSkillDigest', 'Candidate Actual Skill Digest'],
        ['candidateSourceDigest', 'Candidate Source Digest'],
        ['approvalAttestationId', 'Approval Attestation ID'],
        ['syncRecordId', 'Sync Record ID'],
    ];
    for (const [field, label] of scalarFields) {
        if (operationResult[field] !== undefined) stdout(`${label}: ${escapeCliValue(operationResult[field])}\n`);
    }
    if (operationResult.noSelectedSourceChanges) stdout('Selected source changes: none\n');
    if (operationResult.removedWorkspace) stdout('Workspace cleanup: complete\n');
    if (operationResult.recoveryPlan?.recoveryPlanDigest) {
        stdout(`Recovery plan digest: ${escapeCliValue(operationResult.recoveryPlan.recoveryPlanDigest)}\n`);
    }
    for (const path of [...(operationResult.remainingPaths ?? [])].sort()) {
        stdout(`Remaining workspace path: ${escapeCliValue(path)}\n`);
    }
    for (const entry of [...(operationResult.finalizedEvidence ?? [])]
        .sort((left, right) => left.path.localeCompare(right.path, 'en'))) {
        stdout(`Finalized path: ${escapeCliValue(entry.path)}; exists=${escapeCliValue(entry.exists)}; mode=${escapeCliValue(entry.mode ?? '-')}; digest=${escapeCliValue(entry.digest ?? '-')}\n`);
    }
    if (operationResult.rawOutput !== undefined) rawStdout(operationResult.rawOutput);
    for (const finding of operationResult.diagnostics) {
        stderr(`${escapeCliValue(finding.code)}: ${escapeCliValue(finding.message)}\n`);
    }
    return operationResult.status === 'succeeded' ? 0 : 1;
};

/**
 * 把根脚本参数适配为 Upstream Sync Module 调用.
 * 输入包含 argv, 已创建的 Module, 可选 Human 提示函数和输出函数.
 * 返回公共退出码 0, 1 或 2. 此函数只收集已经发生的 Human 决定并展示结果,
 * 不复制事务, 恢复, Approval 或文件布局策略.
 */
export const runUpstreamSyncCli = async (/** @type {string[]} */ args, /** @type {{module: UpstreamSyncModule, promptApproval?: (current: SyncOperationResult) => Promise<string | null>, promptRecovery?: (current: SyncOperationResult, command: string) => Promise<string | null>, rawStdout?: OutputWriter, stderr?: OutputWriter, stdout?: OutputWriter}} */ {
    module,
    promptApproval = undefined,
    promptRecovery = undefined,
    rawStdout = (/** @type {string | Uint8Array<ArrayBufferLike>} */ value) => process.stdout.write(value),
    stderr = (/** @type {string | Uint8Array<ArrayBufferLike>} */ value) => process.stderr.write(value),
    stdout = (/** @type {string | Uint8Array<ArrayBufferLike>} */ value) => process.stdout.write(value),
}) => {
    const [command, ...options] = args;
    let operationResult;
    if (command === 'prepare'
        && options.length === 4
        && options[0] === '--source'
        && options[2] === '--to') {
        operationResult = await module.prepare(options[1], options[3]);
    } else if (command === 'status' && options.length === 0) {
        operationResult = await module.status();
    } else if (command === 'review' && options.length === 0) {
        operationResult = await module.createReviewRevision();
    } else if (command === 'review'
        && options.length === 3
        && options[0] === '--confirm'
        && SHA256_PATTERN.test(options[1])
        && SHA256_PATTERN.test(options[2])) {
        operationResult = await module.createReviewRevision({
            additionalSkillReferencesHash: options[1],
            skillReferenceNormalizationsHash: options[2],
        });
    } else if (['finalize', 'abort'].includes(command) && options.length === 0) {
        const current = await module.status();
        if (current.state === 'recovering'
            && current.recoveryPlan?.recoveryPlanDigest
            && typeof promptRecovery === 'function') {
            const humanConfirmation = await promptRecovery(current, command);
            if (humanConfirmation === null) return 0;
            const recoveryAuthorization = {
                channel: 'local-cli',
                humanConfirmation,
                recoveryPlanDigest: current.recoveryPlan.recoveryPlanDigest,
            };
            operationResult = command === 'finalize'
                ? await module.finalize(recoveryAuthorization)
                : await module.abort(recoveryAuthorization);
        } else {
            operationResult = command === 'finalize'
                ? await module.finalize()
                : await module.abort();
        }
    } else if (command === 'approve' && options.length === 0 && typeof promptApproval === 'function') {
        const current = await module.status();
        if (current.state !== 'reviewed' || !current.reviewRevisionId) {
            operationResult = await module.recordApproval({});
        } else {
            const humanConfirmation = await promptApproval(current);
            if (humanConfirmation === null) return 0;
            operationResult = await module.recordApproval({
                agentMergeNotesDigest: current.agentMergeNotesDigest,
                candidateActualSkillDigest: current.candidateActualSkillDigest,
                candidateSourceDigest: current.candidateSourceDigest,
                channel: 'local-cli',
                humanConfirmation,
                reviewRevisionId: current.reviewRevisionId,
                status: 'approved',
            });
        }
    } else {
        stderr(CLI_USAGE);
        return 2;
    }
    return presentCliResult(operationResult, {rawStdout, stderr, stdout});
};

/**
 * 创建 Source Checkout 专用的 Upstream Sync 事务 Module.
 * 输入是 Git 获取 Adapter, Platform Adapter, 共享引用审核和 Source State Adapter.
 * 返回值公开 `prepare`, `status`, `createReviewRevision`, `recordApproval`, `finalize` 和 `abort`.
 * Module 拥有状态转换与确定性验证, 但不直接绑定文件系统, 进程或交互界面.
 */
const persistWorkspace = async (/** @type {SourceState} */ sourceState, /** @type {SyncWorkspace} */ workspace) => (await attemptRead(() => sourceState.saveWorkspace(workspace))).ok;

const workspacePersistenceFailure = (/** @type {number} */ phase) => failedResult('recovering', [
    diagnostic('workspace-persistence-failed', 'Sync Workspace state could not be persisted safely.', {phase}),
], {permittedOperations: ['status']});

const promotionPersistenceFailure = async (
    /** @type {SourceState} */ sourceState,
    /** @type {SyncWorkspace} */ workspace,
    /** @type {PromotionPlan} */ plan,
    /** @type {number} */ phase,
    /** @type {string} */ stage,
) => {
    let inspection;
    try {
        inspection = await sourceState.inspectRecovery(workspace);
    } catch {
        inspection = undefined;
    }
    return failedResult('recovering', [
        diagnostic('workspace-persistence-failed', 'Sync Workspace state could not be persisted safely.', {phase}),
    ], {
        completedOperations: completedPromotionOperations(plan, inspection),
        permittedOperations: ['status'],
        ...(inspection?.recoveryPlan ? {recoveryPlan: inspection.recoveryPlan} : {}),
        rollback: [],
        stage,
    });
};

const abortFailure = (
    /** @type {number} */ phase,
    /** @type {string[]} */ remainingPaths,
    /** @type {string} */ stage,
) => failedResult('recovering', [
    diagnostic('workspace-persistence-failed', 'Sync Workspace state could not be persisted safely.', {phase}),
], {
    completedOperations: [],
    permittedOperations: ['abort', 'status'],
    remainingPaths: [...new Set(remainingPaths)].sort(compareText),
    rollback: [],
    stage,
});

export const createUpstreamSyncModule = (/** @type {{git: UpstreamGit, loadReviewEditor?: () => Promise<unknown>, platformAdapter?: ReturnType<typeof createCodexPlatformAdapter>, referenceReview?: typeof reviewSkillReferences, reviewEditor?: unknown, sourceState: SourceState}} */ {
    git,
    loadReviewEditor = async () => undefined,
    platformAdapter = createCodexPlatformAdapter(),
    referenceReview = reviewSkillReferences,
    reviewEditor = undefined,
    sourceState,
}) => {
    const cleanupAcquisition = async () => {
        if (typeof git.dispose !== 'function') {
            return /** @type {AcquisitionCleanup} */ ({attempted: false, retryable: false, status: 'not-required'});
        }
        try {
            await git.dispose();
            return /** @type {AcquisitionCleanup} */ ({attempted: true, retryable: false, status: 'succeeded'});
        } catch {
            return /** @type {AcquisitionCleanup} */ ({attempted: true, retryable: true, status: 'failed'});
        }
    };
    const acquisitionFailure = async (/** @type {SyncDiagnostic} */ primary) => {
        const cleanup = await cleanupAcquisition();
        return failedResult('idle', sortDiagnostics([
            primary,
            ...(cleanup.status === 'failed'
                ? [diagnostic('acquisition-cleanup-failed', 'The temporary Git repository could not be removed and cleanup must be retried.', {phase: 2})]
                : []),
        ]), {
            cleanup,
            permittedOperations: ['prepare', 'status'],
            stage: cleanup.status === 'failed' ? 'acquisition-cleanup' : 'acquisition',
        });
    };
    return ({
    /**
     * @param {string} sourceId
     * @param {string} targetCommit
     */
    async prepare(sourceId, targetCommit) {
        if (typeof sourceId !== 'string' || typeof targetCommit !== 'string') {
            throw new TypeError('Prepare requires string source and target commit arguments.');
        }
        /** @type {SyncWorkspace | null} */
        let workspace;
        try {
            workspace = await sourceState.loadWorkspace();
        } catch {
            return failedResult('recovering', [
                diagnostic('workspace-read-failed', 'The active Sync Workspace could not be read safely.', {phase: 1}),
            ]);
        }
        if (workspace?.state === 'awaiting-commit') {
            const checkpointWorkspace = workspace;
            const checkpoint = await attemptRead(() => sourceState.headMatches(checkpointWorkspace.finalizedEvidence));
            if (!checkpoint.ok) {
                return failedResult('awaiting-commit', [
                    diagnostic('head-checkpoint-read-failed', 'The finalized HEAD checkpoint could not be inspected safely.', {phase: 1}),
                ]);
            }
            if (checkpoint.value) workspace = {...workspace, state: 'checkpoint-satisfied'};
        }
        if (workspace && workspace.state !== 'checkpoint-satisfied') {
            return result(workspace.state, [
                diagnostic('active-sync-workspace', 'An active Sync Workspace already exists.'),
            ], workspace.recoveryKind === 'manual-workspace'
                ? {permittedOperations: ['status']}
                : workspace.recoveryKind === 'abort'
                    ? {permittedOperations: ['abort', 'status']}
                    : {});
        }
        const pendingCleanup = await cleanupAcquisition();
        if (pendingCleanup.status === 'failed') {
            return failedResult('idle', [
                diagnostic('acquisition-cleanup-failed', 'The temporary Git repository could not be removed and cleanup must be retried.', {phase: 2}),
            ], {
                cleanup: pendingCleanup,
                permittedOperations: ['prepare', 'status'],
                stage: 'acquisition-cleanup',
            });
        }
        if (!ID_PATTERN.test(sourceId ?? '')) {
            return result('idle', [diagnostic('invalid-source-id', 'Source ID must use the canonical slug form.')]);
        }
        if (!FULL_COMMIT_PATTERN.test(targetCommit ?? '')) {
            return result('idle', [diagnostic('invalid-target-commit', 'Target commit must be a full lowercase commit ID.')]);
        }
        let configuration;
        try {
            configuration = await sourceState.loadConfiguration(sourceId);
        } catch {
            return failedResult('idle', [
                diagnostic('source-configuration-read-failed', 'Source Configuration is missing, malformed, or unreadable.', {identity: sourceId}),
            ]);
        }
        const source = validateSourceConfiguration(configuration, sourceId);
        if (!source) {
            return result('idle', [diagnostic('invalid-source-configuration', 'Source Configuration must match the closed schema for the requested source directory.', {identity: sourceId})]);
        }
        if (!validateUrl(source.url)) {
            return result('idle', [diagnostic('invalid-source-url', 'Source URL must use explicit HTTPS or SSH form without embedded credentials.', {identity: sourceId})]);
        }
        const scope = normalizeScope(source.scope);
        if (!scope) {
            return result('idle', [diagnostic('invalid-source-scope', 'Source Scope must use the supported deterministic glob syntax.', {identity: sourceId})]);
        }
        let acquiredBase;
        let acquiredTheirs;
        try {
            acquiredBase = await git.acquire({commit: source.commit, scope: source.scope, url: source.url});
        } catch {
            return acquisitionFailure(diagnostic('base-acquisition-failed', 'The configured URL did not provide the pinned commit.', {identity: sourceId, phase: 2}));
        }
        if (!validSuccessfulAcquisition(acquiredBase)) {
            return acquisitionFailure(diagnostic('base-acquisition-failed', 'The configured URL did not provide the pinned commit.', {identity: sourceId, phase: 2}));
        }
        try {
            acquiredTheirs = await git.acquire({commit: targetCommit, scope: source.scope, url: source.url});
        } catch {
            return acquisitionFailure(diagnostic('target-acquisition-failed', 'The configured URL did not provide the target commit.', {identity: sourceId, phase: 2}));
        }
        if (!validSuccessfulAcquisition(acquiredTheirs)) {
            return acquisitionFailure(diagnostic('target-acquisition-failed', 'The configured URL did not provide the target commit.', {identity: sourceId, phase: 2}));
        }
        let sourceRelationship;
        try {
            sourceRelationship = await git.classifyRelationship(source.commit, targetCommit);
        } catch {
            return acquisitionFailure(diagnostic('source-relationship-failed', 'The acquired commits could not be classified.', {identity: sourceId, phase: 2}));
        }
        const baseProjection = projectTree(acquiredBase?.entries, scope);
        const theirsProjection = projectTree(acquiredTheirs?.entries, scope);
        const projectionDiagnostics = [...baseProjection.diagnostics, ...theirsProjection.diagnostics];
        if (projectionDiagnostics.length > 0) return result('idle', sortDiagnostics(projectionDiagnostics));
        const baseDigest = snapshotDigest(baseProjection.selected);
        const theirsDigest = snapshotDigest(theirsProjection.selected);
        if (baseDigest === theirsDigest) {
            if (workspace?.state === 'checkpoint-satisfied') {
                const deleted = await attemptRead(() => sourceState.deleteWorkspace(workspace));
                if (!deleted.ok) return workspacePersistenceFailure(3);
            }
            return result('idle', [], {
                noSelectedSourceChanges: true,
                sourceRelationship,
            });
        }
        const baseSource = canonicalSourceTree(baseProjection.selected);
        const theirsSource = canonicalSourceTree(theirsProjection.selected);
        const sourceTreeDiagnostics = [...baseSource.diagnostics, ...theirsSource.diagnostics];
        if (sourceTreeDiagnostics.length > 0) return result('idle', sortDiagnostics(sourceTreeDiagnostics));
        const canonicalPaths = [...new Set([...baseSource.entries, ...theirsSource.entries].map(entry => entry.path))].sort(compareText);
        if (typeof sourceState.inspectPreparePreflight === 'function') {
            let initialPreflight;
            try {
                initialPreflight = await sourceState.inspectPreparePreflight(sourceId, canonicalPaths);
            } catch {
                return failedResult('idle', [
                    diagnostic('sync-owned-prepare-preflight-failed', 'Sync-owned canonical Git evidence could not be inspected.', {phase: 1}),
                ]);
            }
            if (!initialPreflight?.matches) {
                return result('idle', [
                    diagnostic('sync-owned-prepare-preflight-failed', 'Sync-owned canonical paths must exactly match clean Git index pre-images.', {phase: 1}),
                ]);
            }
        }
        let current;
        try {
            if (typeof sourceState.loadActualOurs !== 'function') throw new Error('Missing actual Ours adapter.');
            current = await sourceState.loadActualOurs({canonicalPaths, sourceId});
        } catch {
            return failedResult('idle', [
                diagnostic('ours-snapshot-read-failed', 'Current actual Skill or fixed license bytes could not be read.', {phase: 3}),
            ]);
        }
        const boundCanonicalPaths = [...new Set([...canonicalPaths, ...current.entries.map(entry => entry.path)])].sort(compareText);
        /** @type {SyncWorkspace} */
        const workspaceRecord = {
            agentMergeNotes: '',
            base: baseProjection.selected,
            candidate: [],
            configurationDigest: sha256(canonicalJson(source)),
            mergeBase: [],
            mergeTheirs: [],
            ownershipEvidence: current.ownershipEvidence,
            previousCommit: source.commit,
            sourceId,
            requiredLegalPaths: [...baseProjection.selected, ...theirsProjection.selected]
                .some(entry => entry.path === 'LICENSE') ? ['LICENSE'] : [],
            sourceConfiguration: source,
            sourceRelationship,
            state: 'resolving',
            targetCommit,
            theirs: theirsProjection.selected,
            ours: current.entries,
        };
        if (typeof sourceState.inspectPreparePreflight === 'function') {
            let repeatedPreflight;
            try {
                repeatedPreflight = await sourceState.inspectPreparePreflight(sourceId, boundCanonicalPaths);
            } catch {
                return failedResult('idle', [
                    diagnostic('sync-owned-prepare-preflight-failed', 'Sync-owned canonical Git evidence could not be re-inspected.', {phase: 3}),
                ]);
            }
            if (!repeatedPreflight?.matches) {
                return result('idle', [
                    diagnostic('sync-owned-prepare-preflight-failed', 'Sync-owned canonical paths changed during prepare.', {phase: 3}),
                ]);
            }
            workspaceRecord.preflightEvidence = repeatedPreflight.evidence;
        }
        if (workspace?.state === 'checkpoint-satisfied') {
            const deleted = await attemptRead(() => sourceState.deleteWorkspace(workspace));
            if (!deleted.ok) return workspacePersistenceFailure(3);
        }
        if (!await persistWorkspace(sourceState, workspaceRecord)) return workspacePersistenceFailure(3);
        return result('resolving', [], {
            sourceRelationship,
            workspaceId: createHash('sha256').update(`${sourceId}\0${source.commit}\0${targetCommit}\0${theirsDigest}`).digest('hex'),
        });
    },

    async status() {
        let workspace;
        try {
            workspace = await sourceState.loadWorkspace();
        } catch {
            return failedResult('recovering', [
                diagnostic('workspace-read-failed', 'The active Sync Workspace could not be read safely.'),
            ], {permittedOperations: ['status']});
        }
        if (workspace?.state === 'awaiting-commit') {
            const checkpoint = await attemptRead(() => sourceState.headMatches(workspace.finalizedEvidence));
            if (!checkpoint.ok) {
                return failedResult('awaiting-commit', [
                    diagnostic('head-checkpoint-read-failed', 'The finalized HEAD checkpoint could not be inspected safely.', {phase: 1}),
                ], {permittedOperations: ['status']});
            }
            if (checkpoint.value) {
                return result('checkpoint-satisfied', [], {
                    syncRecordId: workspace.syncRecordId,
                });
            }
        }
        if (workspace?.state === 'recovering' && workspace.pendingPromotion) {
            const recoveryRead = await attemptRead(() => sourceState.inspectRecovery(workspace));
            if (!recoveryRead.ok) {
                return failedResult('recovering', [
                    diagnostic('recovery-evidence-read-failed', 'Recovery evidence could not be inspected safely.', {phase: 11}),
                ], {permittedOperations: ['status']});
            }
            const inspection = recoveryRead.value;
            if (inspection?.matches && inspection.recoveryPlan) {
                return result('recovering', [], {
                    permittedOperations: ['abort', 'finalize', 'status'],
                    recoveryPlan: inspection.recoveryPlan,
                });
            }
            return result('recovering', [
                diagnostic('manual-recovery-required', 'Recovery evidence contains index drift or a third target state.', {phase: 11}),
            ]);
        }
        if (workspace?.state === 'recovering' && workspace.recoveryKind === 'abort') {
            return result('recovering', [], {
                permittedOperations: ['abort', 'status'],
                remainingPaths: workspace.remainingPaths ?? [],
            });
        }
        if (workspace?.state === 'recovering' && workspace.recoveryKind === 'manual-workspace') {
            return result('recovering', [
                diagnostic('manual-workspace-recovery-required', 'A control-less Sync Workspace must be inspected and cleaned manually.', {phase: 11}),
            ], {
                permittedOperations: ['status'],
                remainingPaths: workspace.remainingPaths ?? [],
            });
        }
        if (workspace && ['reviewed', 'approved'].includes(workspace.state)) {
            const bindingDiagnostic = await inspectReviewBindings(sourceState, workspace, 8);
            if (bindingDiagnostic?.code.endsWith('-read-failed')) {
                return failedResult(workspace.state, [bindingDiagnostic], {permittedOperations: ['status']});
            }
            if (bindingDiagnostic) return result('resolving', [bindingDiagnostic]);
        }
        const bindings = workspace && ['reviewed', 'approved'].includes(workspace.state)
            ? {
                agentMergeNotesDigest: workspace.agentMergeNotesDigest,
                candidateActualSkillDigest: workspace.candidateActualSkillDigest,
                candidateSourceDigest: workspace.candidateSourceDigest,
                reviewRevisionId: workspace.reviewRevisionId,
            }
            : {};
        return result(workspace?.state ?? 'idle', [], bindings);
    },

    async createReviewRevision(/** @type {SkillReferenceReviewConfirmation | undefined} */ confirmation = undefined) {
        if (confirmation !== undefined
            && (!confirmation
                || typeof confirmation !== 'object'
                || Array.isArray(confirmation)
                || Object.keys(confirmation).sort(compareText).join('\0')
                    !== ['additionalSkillReferencesHash', 'skillReferenceNormalizationsHash'].join('\0')
                || !SHA256_PATTERN.test(confirmation.additionalSkillReferencesHash ?? '')
                || !SHA256_PATTERN.test(confirmation.skillReferenceNormalizationsHash ?? ''))) {
            throw new TypeError('Review confirmation must contain exactly two SHA-256 hashes.');
        }
        /** @type {SyncWorkspace | null} */
        let workspace;
        try {
            workspace = await sourceState.loadWorkspace();
        } catch {
            return failedResult('recovering', [
                diagnostic('workspace-read-failed', 'The active Sync Workspace could not be read safely.', {phase: 3}),
            ], {permittedOperations: ['status']});
        }
        if (!workspace || !['approved', 'resolving', 'reviewed'].includes(workspace.state)) {
            return result(workspace?.state ?? 'idle', [
                diagnostic('review-not-permitted', 'Review is permitted only while resolving.', {phase: 3}),
            ]);
        }
        if (workspace.state === 'approved') {
            const bindingDiagnostic = await inspectReviewBindings(sourceState, workspace, 3);
            if (!bindingDiagnostic) {
                return result('approved', [
                    diagnostic('review-not-permitted', 'Review is permitted only after the approved revision becomes stale.', {phase: 3}),
                ]);
            }
            if (bindingDiagnostic.code.endsWith('-read-failed')) {
                return failedResult('approved', [bindingDiagnostic], {permittedOperations: ['status']});
            }
            workspace = {...workspace, approval: null, state: 'resolving'};
            if (!await persistWorkspace(sourceState, workspace)) return workspacePersistenceFailure(3);
        }
        const workspaceSourceId = workspace.sourceId;
        const loadConfigurationDigest = sourceState.loadConfigurationDigest;
        const configurationRead = typeof loadConfigurationDigest === 'function'
            ? await attemptRead(() => loadConfigurationDigest(workspaceSourceId))
            : {ok: true, value: workspace.configurationDigest};
        if (!configurationRead.ok) {
            return failedResult('resolving', [
                diagnostic('source-configuration-read-failed', 'Source Configuration could not be read safely.', {phase: 3}),
            ]);
        }
        if (configurationRead.value !== workspace.configurationDigest) {
            if (!await persistWorkspace(sourceState, {...workspace, approval: null, state: 'resolving'})) {
                return workspacePersistenceFailure(3);
            }
            return result('resolving', [
                diagnostic('source-configuration-drift', 'Source Configuration changed after prepare.', {phase: 3}),
            ]);
        }
        const preflightDiagnostic = await inspectCanonicalPreflight(sourceState, workspace, 3);
        if (preflightDiagnostic) {
            if (preflightDiagnostic.code.endsWith('-read-failed')) {
                return failedResult('resolving', [preflightDiagnostic]);
            }
            if (workspace.state === 'reviewed') {
                workspace = {...workspace, approval: null, state: 'resolving'};
                if (!await persistWorkspace(sourceState, workspace)) return workspacePersistenceFailure(3);
            }
            return result('resolving', [preflightDiagnostic]);
        }
        let projectionConfig;
        try {
            if (typeof sourceState.loadProjectionConfiguration !== 'function') throw new Error('Missing projection configuration adapter.');
            projectionConfig = await sourceState.loadProjectionConfiguration();
        } catch {
            return failedResult('resolving', [diagnostic('projection-configuration-read-failed', 'Platform projection configuration could not be read safely.', {phase: 3})]);
        }
        const projectionConfigurationDigest = sha256(canonicalJson(projectionConfig));
        if (projectionConfigurationDigest !== workspace.projectionConfigurationDigest) {
            workspace = {
                ...workspace,
                approval: null,
                candidate: [],
                mergeBase: [],
                mergeTheirs: [],
                projectionConfigurationDigest,
                state: 'resolving',
                theirsSkillReferenceReview: undefined,
            };
            if (!await persistWorkspace(sourceState, workspace)) return workspacePersistenceFailure(3);
        }
        let referenceReviewOutput;
        if (workspace.theirsSkillReferenceReview === undefined) {
            const baseSource = canonicalSourceTree(workspace.base);
            const theirsSource = canonicalSourceTree(workspace.theirs);
            const sourceTreeDiagnostics = [...baseSource.diagnostics, ...theirsSource.diagnostics];
            if (sourceTreeDiagnostics.length > 0) return result('resolving', sortDiagnostics(sourceTreeDiagnostics));
            const analysis = analyzeSkillReferences({
                payload: theirsSource.entries,
                projectionConfig,
                sourcePlatform: workspace.sourceConfiguration.platform,
            });
            if (analysis.status !== 'succeeded') {
                return result('resolving', analysis.diagnostics.map(finding => diagnostic(
                    finding.code,
                    finding.message,
                    {identity: finding.identity ?? '', path: finding.path ?? '', phase: 3},
                )), {status: 'blocked'});
            }
            /** @type {string[]} */
            const emittedHashes = [];
            let reviewed;
            try {
                const configuredReviewEditor = reviewEditor ?? await loadReviewEditor();
                reviewed = await referenceReview({
                    additionalSkillReferences: analysis.additionalSkillReferences,
                    confirmHashes: confirmation ?? null,
                    emitHash: hash => emittedHashes.push(hash),
                    reviewEditor: configuredReviewEditor,
                    skillReferenceNormalizations: analysis.skillReferenceNormalizations,
                    workspaceDirectory: sourceState.reviewWorkspaceDirectory,
                });
            } catch (error) {
                return failedResult('resolving', [diagnostic('skill-reference-review-failed', error instanceof Error ? error.message : String(error), {phase: 3})]);
            }
            if (emittedHashes.length === 2) {
                referenceReviewOutput = Buffer.from(canonicalJson({
                    additionalSkillReferencesHash: emittedHashes[0],
                    skillReferenceNormalizationsHash: emittedHashes[1],
                }));
            }
            if (reviewed.status !== 'succeeded') {
                if (!await persistWorkspace(sourceState, workspace)) return workspacePersistenceFailure(3);
                return result('resolving', (reviewed.diagnostics ?? []).map(finding => diagnostic(
                    finding.code,
                    finding.message,
                    {path: finding.path ?? '', phase: 3},
                )), {
                    ...(referenceReviewOutput === undefined ? {} : {rawOutput: referenceReviewOutput}),
                    status: reviewed.status,
                });
            }
            const reviewedNormalizations = reviewed.skillReferenceNormalizations.map(record => ({
                column: record.column,
                identity: record.identity,
                line: record.line,
                path: record.path,
            }));
            const convertedBase = platformAdapter.toCanonicalSkills({
                additionalSkillReferences: workspace.sourceConfiguration.additionalSkillReferences,
                payload: baseSource.entries,
                projectionConfig,
                skillReferenceNormalizations: workspace.sourceConfiguration.skillReferenceNormalizations,
                sourcePlatform: workspace.sourceConfiguration.platform,
            });
            if (convertedBase.status !== 'succeeded') {
                return result('resolving', convertedBase.diagnostics.map(finding => diagnostic(
                    finding.code,
                    finding.message,
                    {identity: finding.identity ?? '', path: finding.path ?? '', phase: 3},
                )), {status: 'blocked'});
            }
            const convertedTheirs = platformAdapter.toCanonicalSkills({
                additionalSkillReferences: reviewed.additionalSkillReferences,
                payload: theirsSource.entries,
                projectionConfig,
                skillReferenceNormalizations: reviewedNormalizations,
                sourcePlatform: workspace.sourceConfiguration.platform,
            });
            if (convertedTheirs.status !== 'succeeded') {
                return result('resolving', convertedTheirs.diagnostics.map(finding => diagnostic(
                    finding.code,
                    finding.message,
                    {identity: finding.identity ?? '', path: finding.path ?? '', phase: 3},
                )), {status: 'blocked'});
            }
            const canonicalBase = convertedBase.payload.map(entry => {
                if (typeof entry.mode !== 'string' || !PORTABLE_MODES.has(entry.mode)) {
                    throw new Error('Platform Adapter did not preserve a portable source mode.');
                }
                return {bytes: entry.bytes, mode: entry.mode, path: entry.path};
            });
            const canonicalTheirs = convertedTheirs.payload.map(entry => {
                if (typeof entry.mode !== 'string' || !PORTABLE_MODES.has(entry.mode)) {
                    throw new Error('Platform Adapter did not preserve a portable source mode.');
                }
                return {bytes: entry.bytes, mode: entry.mode, path: entry.path};
            });
            const candidateState = buildCandidate({
                base: canonicalBase,
                ours: workspace.ours,
                theirs: canonicalTheirs,
            });
            workspace = {
                ...workspace,
                binaryConflicts: candidateState.binaryConflicts,
                candidate: candidateState.candidate,
                dualChangedPaths: candidateState.dualChangedPaths,
                mergeBase: canonicalBase,
                mergeTheirs: canonicalTheirs,
                theirsSkillReferenceReview: {
                    additionalSkillReferences: reviewed.additionalSkillReferences,
                    additionalSkillReferencesHash: reviewed.additionalSkillReferencesHash,
                    skillReferenceNormalizations: reviewed.skillReferenceNormalizations,
                    skillReferenceNormalizationsHash: reviewed.skillReferenceNormalizationsHash,
                },
                textConflicts: candidateState.textConflicts,
            };
            if (!await persistWorkspace(sourceState, workspace)) return workspacePersistenceFailure(3);
        } else {
            const theirsSource = canonicalSourceTree(workspace.theirs);
            if (theirsSource.diagnostics.length > 0) return result('resolving', sortDiagnostics(theirsSource.diagnostics));
            const analysis = analyzeSkillReferences({
                payload: theirsSource.entries,
                projectionConfig,
                sourcePlatform: workspace.sourceConfiguration.platform,
            });
            if (analysis.status !== 'succeeded') {
                return result('resolving', analysis.diagnostics.map(finding => diagnostic(
                    finding.code,
                    finding.message,
                    {identity: finding.identity ?? '', path: finding.path ?? '', phase: 3},
                )), {status: 'blocked'});
            }
            let reviewed;
            try {
                reviewed = await referenceReview({
                    additionalSkillReferences: analysis.additionalSkillReferences,
                    confirmHashes: {
                        additionalSkillReferencesHash: workspace.theirsSkillReferenceReview.additionalSkillReferencesHash,
                        skillReferenceNormalizationsHash: workspace.theirsSkillReferenceReview.skillReferenceNormalizationsHash,
                    },
                    skillReferenceNormalizations: analysis.skillReferenceNormalizations,
                    workspaceDirectory: sourceState.reviewWorkspaceDirectory,
                });
            } catch (error) {
                return failedResult('resolving', [diagnostic('skill-reference-review-failed', error instanceof Error ? error.message : String(error), {phase: 3})]);
            }
            if (reviewed.status !== 'succeeded') {
                return result('resolving', (reviewed.diagnostics ?? []).map(finding => diagnostic(
                    finding.code,
                    finding.message,
                    {path: finding.path ?? '', phase: 3},
                )), {status: reviewed.status});
            }
            const expectedReview = {
                additionalSkillReferences: reviewed.additionalSkillReferences,
                additionalSkillReferencesHash: reviewed.additionalSkillReferencesHash,
                skillReferenceNormalizations: reviewed.skillReferenceNormalizations,
                skillReferenceNormalizationsHash: reviewed.skillReferenceNormalizationsHash,
            };
            if (canonicalJson(expectedReview) !== canonicalJson(workspace.theirsSkillReferenceReview)) {
                return result('resolving', [
                    diagnostic('skill-reference-review-evidence-changed', 'Persisted Theirs Skill reference review no longer matches its reviewed candidates.', {phase: 3}),
                ]);
            }
        }
        const diagnostics = [];
        const candidateSkillEntrypoints = new Set();
        const candidateSkillIdentities = new Set();
        for (const entry of workspace.candidate) {
            if (!isAssignedCanonicalPath(entry.path)) {
                diagnostics.push(diagnostic('candidate-path-unassigned', 'Editable candidate paths must map to the fixed Source Checkout output layout.', {
                    path: entry.path,
                    phase: 3,
                }));
                continue;
            }
            if (entry.path === 'LICENSE') continue;
            const [, identity, relativePath] = entry.path.split('/');
            candidateSkillIdentities.add(identity);
            if (relativePath === 'SKILL.md') candidateSkillEntrypoints.add(identity);
        }
        for (const identity of [...candidateSkillIdentities].sort()) {
            if (!candidateSkillEntrypoints.has(identity)) {
                diagnostics.push(diagnostic('candidate-skill-entrypoint-missing', 'Every non-empty candidate Skill root must contain SKILL.md.', {
                    identity,
                    path: `skills/${identity}`,
                    phase: 3,
                }));
            }
        }
        if (!validAgentMergeNotes(workspace.agentMergeNotes)) {
            diagnostics.push(diagnostic('agent-merge-notes-required', 'Agent merge notes must be non-empty UTF-8 Markdown before review.', {phase: 4}));
        }
        const candidateMap = snapshotMap(workspace.candidate);
        const theirsMap = snapshotMap(workspace.mergeTheirs);
        for (const path of [...new Set(workspace.requiredLegalPaths ?? [])].sort()) {
            if (!sameEntry(candidateMap.get(path), theirsMap.get(path))) {
                diagnostics.push(diagnostic('legal-material-change', 'Legal material must pass through exactly from Theirs.', {path, phase: 5}));
            }
        }
        if (diagnostics.length > 0) return result('resolving', sortDiagnostics(diagnostics));
        const {
            agentMergeNotesDigest,
            candidateActualSkillDigest,
            candidateSourceDigest,
            reviewInputDigest,
            reviewRevisionId,
        } = reviewRevisionBindingsFor(workspace);
        /** @type {SyncWorkspace} */
        const reviewedWorkspace = {
            ...workspace,
            agentMergeNotesDigest,
            approval: null,
            candidateActualSkillDigest,
            candidateSourceDigest,
            reviewInputDigest,
            reviewRevisionId,
            state: 'reviewed',
        };
        if (!await persistWorkspace(sourceState, reviewedWorkspace)) return workspacePersistenceFailure(7);
        return result('reviewed', [], {
            agentMergeNotesDigest,
            candidateActualSkillDigest,
            candidateSourceDigest,
            ...(referenceReviewOutput === undefined ? {} : {rawOutput: referenceReviewOutput}),
            reviewRevisionId,
        });
    },

    async recordApproval(/** @type {ApprovalEvidence} */ attestation) {
        if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) {
            throw new TypeError('Approval Attestation must be an object.');
        }
        let workspace;
        try {
            workspace = await sourceState.loadWorkspace();
        } catch {
            return failedResult('recovering', [
                diagnostic('workspace-read-failed', 'The active Sync Workspace could not be read safely.', {phase: 8}),
            ], {permittedOperations: ['status']});
        }
        if (!workspace || workspace.state !== 'reviewed') {
            return result(workspace?.state ?? 'idle', [
                diagnostic('approval-not-permitted', 'Approval is permitted only for the current reviewed revision.', {phase: 8}),
            ]);
        }
        const bindingDiagnostic = await inspectReviewBindings(sourceState, workspace, 8);
        if (bindingDiagnostic) {
            if (bindingDiagnostic.code.endsWith('-read-failed')) {
                return failedResult('reviewed', [bindingDiagnostic], {permittedOperations: ['status']});
            }
            if (!await persistWorkspace(sourceState, {...workspace, approval: null, state: 'resolving'})) {
                return workspacePersistenceFailure(8);
            }
            return result('resolving', [bindingDiagnostic]);
        }
        const exactKeys = [
            'agentMergeNotesDigest',
            'candidateActualSkillDigest',
            'candidateSourceDigest',
            'channel',
            'reviewRevisionId',
            'status',
        ];
        const optionalKeys = ['externalEvidence', 'humanConfirmation'];
        const keys = Object.keys(attestation ?? {}).sort();
        const allowedKeys = [...exactKeys, ...optionalKeys].sort();
        const validShape = attestation
            && keys.every(key => allowedKeys.includes(key))
            && exactKeys.every(key => keys.includes(key))
            && attestation.status === 'approved'
            && typeof attestation.channel === 'string'
            && attestation.channel.trim() !== ''
            && optionalKeys.every(key => !(key in attestation)
                || (typeof attestation[key] === 'string' && attestation[key].trim() !== ''))
            && ((typeof attestation.humanConfirmation === 'string' && attestation.humanConfirmation.trim() !== '')
                || (typeof attestation.externalEvidence === 'string' && attestation.externalEvidence.trim() !== ''))
            && ['agentMergeNotesDigest', 'candidateActualSkillDigest', 'candidateSourceDigest', 'reviewRevisionId']
                .every(key => typeof attestation[key] === 'string' && /^[0-9a-f]{64}$/.test(attestation[key]))
            && attestation.agentMergeNotesDigest === workspace.agentMergeNotesDigest
            && attestation.candidateActualSkillDigest === workspace.candidateActualSkillDigest
            && attestation.candidateSourceDigest === workspace.candidateSourceDigest
            && attestation.reviewRevisionId === workspace.reviewRevisionId;
        if (!validShape) {
            return result('reviewed', [
                diagnostic('invalid-approval-attestation', 'Approval Attestation must bind the current revision and candidate digest to a recorded Human decision.', {phase: 8}),
            ]);
        }
        const normalized = {...attestation};
        const approvalAttestationId = sha256(canonicalJson(normalized));
        if (!await persistWorkspace(sourceState, {
            ...workspace,
            approval: {...normalized, approvalAttestationId},
            state: 'approved',
        })) return workspacePersistenceFailure(8);
        return result('approved', [], {
            agentMergeNotesDigest: workspace.agentMergeNotesDigest,
            approvalAttestationId,
            candidateActualSkillDigest: workspace.candidateActualSkillDigest,
            candidateSourceDigest: workspace.candidateSourceDigest,
            reviewRevisionId: workspace.reviewRevisionId,
        });
    },

    async finalize(/** @type {RecoveryAuthorization | undefined} */ recoveryAuthorization = undefined) {
        if (recoveryAuthorization !== undefined
            && (!recoveryAuthorization || typeof recoveryAuthorization !== 'object' || Array.isArray(recoveryAuthorization))) {
            throw new TypeError('Recovery authorization must be an object when provided.');
        }
        let workspace;
        try {
            workspace = await sourceState.loadWorkspace();
        } catch {
            return failedResult('recovering', [
                diagnostic('workspace-read-failed', 'The active Sync Workspace could not be read safely.', {phase: 9}),
            ], {permittedOperations: ['status']});
        }
        if (recoveryAuthorization !== undefined
            && !(workspace?.state === 'recovering' && workspace.pendingPromotion)) {
            return result(workspace?.state ?? 'idle', [
                diagnostic('recovery-authorization-not-permitted', 'Recovery authorization is accepted only for a validated promotion recovery plan.', {phase: 9}),
            ]);
        }
        if (workspace?.state === 'recovering' && workspace.pendingPromotion) {
            const recoveryRead = await attemptRead(() => sourceState.inspectRecovery(workspace));
            if (!recoveryRead.ok) {
                return failedResult('recovering', [
                    diagnostic('recovery-evidence-read-failed', 'Recovery evidence could not be inspected safely.', {phase: 11}),
                ], {permittedOperations: ['status']});
            }
            const inspection = recoveryRead.value;
            if (!inspection?.matches || !inspection.recoveryPlan) {
                return result('recovering', [
                    diagnostic('manual-recovery-required', 'Recovery evidence contains index drift or a third target state.', {phase: 11}),
                ]);
            }
            if (!validRecoveryAuthorization(recoveryAuthorization, inspection.recoveryPlan.recoveryPlanDigest)) {
                return result('recovering', [
                    diagnostic('invalid-recovery-authorization', 'Recovery authorization must bind the current plan and contain Human evidence.', {phase: 11}),
                ], {
                    permittedOperations: ['abort', 'finalize', 'status'],
                    recoveryPlan: inspection.recoveryPlan,
                });
            }
            let recovered;
            try {
                recovered = await sourceState.applyRecovery(workspace, 'finalize', inspection.recoveryPlan);
            } catch {
                let currentInspection;
                try {
                    currentInspection = await sourceState.inspectRecovery(workspace);
                } catch {
                    currentInspection = undefined;
                }
                return failedResult('recovering', [
                    diagnostic('recovery-io-failure', 'Scoped recovery did not complete and must be retried from current evidence.', {phase: 11}),
                ], {
                    completedOperations: completedPromotionOperations(workspace.pendingPromotion, currentInspection),
                    permittedOperations: ['status'],
                    recoveryPlan: inspection.recoveryPlan,
                    rollback: [],
                    stage: 'recovery-finalize',
                });
            }
            if (!exactFinalizedEvidence(recovered?.finalizedEvidence, workspace.pendingPromotion)) {
                return failedResult('recovering', [
                    diagnostic('promotion-evidence-missing', 'Recovery did not return complete finalized path evidence.', {phase: 11}),
                ], {
                    completedOperations: completedPromotionOperations(workspace.pendingPromotion, inspection),
                    permittedOperations: ['status'],
                    recoveryPlan: inspection.recoveryPlan,
                    rollback: [],
                    stage: 'recovery-evidence',
                });
            }
            if (!await persistWorkspace(sourceState, {
                ...workspace,
                finalizedEvidence: recovered.finalizedEvidence,
                pendingPromotion: null,
                state: 'awaiting-commit',
            })) return promotionPersistenceFailure(sourceState, workspace, workspace.pendingPromotion, 11, 'recovery-persistence');
            return result('awaiting-commit', [], {
                candidateActualSkillDigest: workspace.candidateActualSkillDigest,
                candidateSourceDigest: workspace.candidateSourceDigest,
                finalizedEvidence: recovered.finalizedEvidence,
                syncRecordId: workspace.syncRecordId,
            });
        }
        if (!workspace || workspace.state !== 'approved') {
            return result(workspace?.state ?? 'idle', [
                diagnostic('finalize-not-permitted', 'Finalize is permitted only for the current approved revision.', {phase: 9}),
            ]);
        }
        if (!approvalMatchesWorkspace(workspace.approval, workspace)) {
            if (!await persistWorkspace(sourceState, {...workspace, approval: null, state: 'resolving'})) {
                return workspacePersistenceFailure(9);
            }
            return result('resolving', [
                diagnostic('invalid-approval-attestation', 'Persisted Approval Attestation bindings do not match the approved workspace.', {phase: 9}),
            ]);
        }
        const bindingDiagnostic = await inspectReviewBindings(sourceState, workspace, 9);
        if (bindingDiagnostic) {
            if (bindingDiagnostic.code.endsWith('-read-failed')) {
                return failedResult('approved', [bindingDiagnostic], {permittedOperations: ['status']});
            }
            if (!await persistWorkspace(sourceState, {...workspace, approval: null, state: 'resolving'})) {
                return workspacePersistenceFailure(9);
            }
            return result('resolving', [bindingDiagnostic]);
        }
        const loadConfigurationDigest = sourceState.loadConfigurationDigest;
        const configurationRead = typeof loadConfigurationDigest === 'function'
            ? await attemptRead(() => loadConfigurationDigest(workspace.sourceId))
            : {ok: true, value: workspace.configurationDigest};
        if (!configurationRead.ok) {
            return failedResult('approved', [
                diagnostic('source-configuration-read-failed', 'Source Configuration could not be read safely.', {phase: 9}),
            ], {permittedOperations: ['status']});
        }
        if (configurationRead.value !== workspace.configurationDigest) {
            if (!await persistWorkspace(sourceState, {...workspace, approval: null, state: 'resolving'})) {
                return workspacePersistenceFailure(9);
            }
            return result('resolving', [
                diagnostic('approval-stale', 'Source Configuration changed after approval.', {phase: 9}),
            ]);
        }
        const candidateActualSkillDigest = candidateActualSkillDigestFor(workspace);
        const candidateSourceDigest = candidateSourceDigestFor(workspace);
        const reviewInputDigest = reviewInputDigestFor(workspace);
        if (candidateSourceDigest !== workspace.candidateSourceDigest
            || candidateActualSkillDigest !== workspace.candidateActualSkillDigest
            || reviewInputDigest !== workspace.reviewInputDigest) {
            if (!await persistWorkspace(sourceState, {
                ...workspace,
                approval: null,
                state: 'resolving',
            })) return workspacePersistenceFailure(9);
            return result('resolving', [
                diagnostic('approval-stale', 'Candidate source state, actual Skill bytes, or review inputs changed after approval.', {phase: 9}),
            ]);
        }
        const preflightRead = await attemptRead(() => sourceState.preflightPromotion(workspace, recoveryAuthorization));
        if (!preflightRead.ok) {
            return failedResult('approved', [
                diagnostic('sync-owned-preflight-read-failed', 'Sync-owned canonical paths could not be inspected safely.', {phase: 10}),
            ], {permittedOperations: ['status']});
        }
        const preflight = preflightRead.value;
        if (!preflight?.matches) {
            if (!await persistWorkspace(sourceState, {...workspace, approval: null, state: 'resolving'})) {
                return workspacePersistenceFailure(10);
            }
            return result('resolving', [
                diagnostic('sync-owned-preflight-failed', 'Sync-owned canonical paths changed after prepare.', {phase: 10}),
            ]);
        }
        if (!workspace.approval?.approvalAttestationId) {
            return result('approved', [
                diagnostic('invalid-approval-attestation', 'Approved workspace is missing its Approval Attestation binding.', {phase: 9}),
            ]);
        }
        const recordWithoutIdentity = syncRecordWithoutIdentityFor(workspace, {
            candidateActualSkillDigest,
            candidateSourceDigest,
        });
        const syncRecordId = sha256(canonicalJson(recordWithoutIdentity));
        const syncRecord = {...recordWithoutIdentity, syncRecordId};
        let pendingPromotion;
        try {
            pendingPromotion = await sourceState.createPromotionPlan({
                candidate: workspace.candidate,
                sourceId: workspace.sourceId,
                syncRecord,
                workspace,
            });
        } catch {
            return failedResult('approved', [
                diagnostic('promotion-plan-failed', 'The canonical promotion plan could not be constructed.', {phase: 10}),
            ]);
        }
        if (!validPromotionPlanResult(pendingPromotion, workspace.sourceId, syncRecordId)) {
            return failedResult('approved', [
                diagnostic('invalid-promotion-plan', 'Promotion planning did not return a deterministic recoverable target set.', {phase: 10}),
            ]);
        }
        if (!await persistWorkspace(sourceState, {
            ...workspace,
            pendingPromotion,
            state: 'recovering',
            syncRecordId,
        })) return workspacePersistenceFailure(10);
        let promotion;
        try {
            promotion = await sourceState.applyPromotion({
                candidate: workspace.candidate,
                sourceId: workspace.sourceId,
                syncRecord,
                workspace,
                ...pendingPromotion,
            });
        } catch {
            /** @type {SyncWorkspace} */
            const recoveringWorkspace = {
                ...workspace,
                pendingPromotion,
                state: 'recovering',
                syncRecordId,
            };
            let inspection;
            try {
                inspection = await sourceState.inspectRecovery(recoveringWorkspace);
                if (inspection?.matches && inspection.recoveryPlan) {
                    const completedOperations = completedPromotionOperations(pendingPromotion, inspection);
                    if (allPromotionTargetsAtState(pendingPromotion, inspection, 'pre-image')) {
                        await sourceState.saveWorkspace({
                            ...workspace,
                            pendingPromotion: null,
                            state: 'approved',
                        });
                        return failedResult('approved', [
                            diagnostic('promotion-recovered', 'Promotion failed, and all sync-owned targets were restored to their pre-images.', {phase: 11}),
                        ], {
                            completedOperations,
                            rollback: [],
                            stage: 'promotion-apply',
                        });
                    }
                    await sourceState.applyRecovery(recoveringWorkspace, 'abort', inspection.recoveryPlan);
                    const restoredInspection = await sourceState.inspectRecovery(recoveringWorkspace);
                    const rollback = rollbackEvidence(completedOperations, restoredInspection);
                    if (rollback.every(entry => entry.status === 'restored')) {
                        await sourceState.saveWorkspace({
                            ...workspace,
                            pendingPromotion: null,
                            state: 'approved',
                        });
                        return failedResult('approved', [
                            diagnostic('promotion-recovered', 'Promotion failed, and all sync-owned targets were restored to their pre-images.', {phase: 11}),
                        ], {
                            completedOperations,
                            rollback,
                            stage: 'promotion-apply',
                        });
                    }
                }
            } catch {
                // 已持久化的 recovering workspace 保持唯一恢复权威.
            }
            let currentInspection;
            try {
                currentInspection = await sourceState.inspectRecovery(recoveringWorkspace);
            } catch {
                currentInspection = inspection;
            }
            const completedOperations = completedPromotionOperations(pendingPromotion, inspection);
            return failedResult('recovering', [
                diagnostic('promotion-io-failure', 'Promotion failed and requires scoped recovery.', {phase: 11}),
            ], {
                completedOperations,
                permittedOperations: ['status'],
                ...(currentInspection?.recoveryPlan ? {recoveryPlan: currentInspection.recoveryPlan} : {}),
                rollback: rollbackEvidence(completedOperations, currentInspection),
                stage: 'promotion-apply',
            });
        }
        if (!exactFinalizedEvidence(promotion?.finalizedEvidence, pendingPromotion)) {
            return failedResult('recovering', [
                diagnostic('promotion-evidence-missing', 'Promotion did not return complete finalized path evidence.', {phase: 11}),
            ], {
                completedOperations: [],
                permittedOperations: ['status'],
                rollback: [],
                stage: 'promotion-evidence',
            });
        }
        if (!await persistWorkspace(sourceState, {
            ...workspace,
            finalizedEvidence: promotion.finalizedEvidence,
            state: 'awaiting-commit',
            syncRecordId,
        })) return promotionPersistenceFailure(sourceState, {
            ...workspace,
            pendingPromotion,
            state: 'recovering',
            syncRecordId,
        }, pendingPromotion, 11, 'promotion-persistence');
        return result('awaiting-commit', [], {
            candidateActualSkillDigest,
            candidateSourceDigest,
            finalizedEvidence: promotion.finalizedEvidence,
            syncRecordId,
        });
    },

    async abort(/** @type {RecoveryAuthorization | undefined} */ recoveryAuthorization = undefined) {
        if (recoveryAuthorization !== undefined
            && (!recoveryAuthorization || typeof recoveryAuthorization !== 'object' || Array.isArray(recoveryAuthorization))) {
            throw new TypeError('Recovery authorization must be an object when provided.');
        }
        let workspace;
        try {
            workspace = await sourceState.loadWorkspace();
        } catch {
            return failedResult('recovering', [
                diagnostic('workspace-read-failed', 'The active Sync Workspace could not be read safely.', {phase: 12}),
            ], {permittedOperations: ['status']});
        }
        if (recoveryAuthorization !== undefined
            && !(workspace?.state === 'recovering' && workspace.pendingPromotion)) {
            return result(workspace?.state ?? 'idle', [
                diagnostic('recovery-authorization-not-permitted', 'Recovery authorization is accepted only for a validated promotion recovery plan.', {phase: 12}),
            ]);
        }
        if (!workspace) return result('idle');
        if (workspace.recoveryKind === 'manual-workspace') {
            return result('recovering', [
                diagnostic('manual-workspace-recovery-required', 'A control-less Sync Workspace must be inspected and cleaned manually.', {phase: 12}),
            ], {
                permittedOperations: ['status'],
                remainingPaths: workspace.remainingPaths ?? [],
            });
        }
        if (['awaiting-commit', 'checkpoint-satisfied'].includes(workspace.state)) {
            return result(workspace.state, [
                diagnostic('abort-not-permitted', 'Finalized checkpoint evidence cannot be aborted.', {phase: 12}),
            ]);
        }
        if (!['resolving', 'reviewed', 'recovering'].includes(workspace.state)) {
            return result(workspace.state, [
                diagnostic('abort-not-permitted', 'Abort is not permitted in the current state.', {phase: 12}),
            ]);
        }
        if (workspace.state === 'recovering' && workspace.pendingPromotion) {
            const recoveryRead = await attemptRead(() => sourceState.inspectRecovery(workspace));
            if (!recoveryRead.ok) {
                return failedResult('recovering', [
                    diagnostic('recovery-evidence-read-failed', 'Recovery evidence could not be inspected safely.', {phase: 12}),
                ], {permittedOperations: ['status']});
            }
            const inspection = recoveryRead.value;
            if (!inspection?.matches || !inspection.recoveryPlan) {
                return result('recovering', [
                    diagnostic('manual-recovery-required', 'Recovery evidence contains index drift or a third target state.', {phase: 12}),
                ]);
            }
            if (!validRecoveryAuthorization(recoveryAuthorization, inspection.recoveryPlan.recoveryPlanDigest)) {
                return result('recovering', [
                    diagnostic('invalid-recovery-authorization', 'Recovery authorization must bind the current plan and contain Human evidence.', {phase: 12}),
                ], {
                    permittedOperations: ['abort', 'finalize', 'status'],
                    recoveryPlan: inspection.recoveryPlan,
                });
            }
            const originallyCompleted = completedPromotionOperations(workspace.pendingPromotion, inspection);
            try {
                await sourceState.applyRecovery(workspace, 'abort', inspection.recoveryPlan);
            } catch {
                let currentInspection;
                try {
                    currentInspection = await sourceState.inspectRecovery(workspace);
                } catch {
                    currentInspection = undefined;
                }
                return failedResult('recovering', [
                    diagnostic('recovery-io-failure', 'Scoped recovery did not complete and must be retried from current evidence.', {phase: 12}),
                ], {
                    completedOperations: completedPromotionOperations(workspace.pendingPromotion, currentInspection),
                    permittedOperations: ['abort', 'finalize', 'status'],
                    recoveryPlan: currentInspection?.recoveryPlan ?? inspection.recoveryPlan,
                    rollback: rollbackEvidence(originallyCompleted, currentInspection),
                    stage: 'recovery-abort',
                });
            }
            const deleted = await attemptRead(() => sourceState.deleteWorkspace());
            if (!deleted.ok) {
                let remainingPaths = workspace.ownedWorkspacePaths ?? ['workspace-directory'];
                if (typeof sourceState.abortWorkspace === 'function') {
                    const inspectedCleanup = await attemptRead(() => sourceState.abortWorkspace(workspace));
                    if (inspectedCleanup.ok) remainingPaths = inspectedCleanup.value.remainingPaths;
                }
                return abortFailure(12, remainingPaths, 'recovery-cleanup');
            }
            return result('idle', [], {removedWorkspace: true});
        }
        const cleanupRead = await attemptRead(() => sourceState.abortWorkspace(workspace));
        if (!cleanupRead.ok) return abortFailure(
            12,
            workspace.remainingPaths ?? workspace.ownedWorkspacePaths ?? ['workspace-directory'],
            'abort-cleanup',
        );
        const cleanup = cleanupRead.value;
        const remainingPaths = [...new Set(cleanup?.remainingPaths ?? [])].sort();
        if (remainingPaths.length > 0) {
            if (typeof sourceState.recordAbortRecovery === 'function') {
                const recordAbortRecovery = sourceState.recordAbortRecovery;
                const recorded = await attemptRead(() => recordAbortRecovery(workspace, remainingPaths));
                if (!recorded.ok) return abortFailure(12, remainingPaths, 'abort-recovery-persistence');
            } else {
                if (!await persistWorkspace(sourceState, {
                    ...workspace,
                    recoveryKind: 'abort',
                    remainingPaths,
                    state: 'recovering',
                })) return abortFailure(12, remainingPaths, 'abort-recovery-persistence');
            }
            return failedResult('recovering', [
                diagnostic('abort-partial', 'Disposable workspace cleanup is incomplete and must be retried forward.', {phase: 12}),
            ], {
                permittedOperations: ['abort', 'status'],
                remainingPaths,
            });
        }
        const deleted = await attemptRead(() => sourceState.deleteWorkspace());
        if (!deleted.ok) return abortFailure(12, ['workspace-directory'], 'abort-delete');
        return result('idle', [], {removedWorkspace: true});
    },
    });
};
