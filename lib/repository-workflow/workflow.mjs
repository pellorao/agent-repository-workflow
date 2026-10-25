import {prepareCodexConfiguration} from '../arw-common/codex-configuration.mjs';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';

import {createNodeRepositoryStateInspector} from '../arw-common/repository-state-inspector.mjs';
import {assertSafePath} from '../common/canonical-contract.mjs';
import {applyFileTransaction, preflightFileTransaction} from '../common/file-transaction.mjs';
import {createScopedFilesystem, joinRelativePath, resolveRelativePathWithinScope} from '../common/filesystem.mjs';
import {createNodeGitRunner} from '../common/git-process.mjs';
import {isJsonObject, serializeJson} from '../common/json.mjs';
import {completeRepositoryConfigurationBytes, prepareRepositoryConfiguration, REPOSITORY_CONFIGURATION_PATH} from '../arw-common/repository-configuration.mjs';
import {inspectCodeMapCoverage, runCodeMapVerification, verifyCodeMaps} from './code-map.mjs';
import {
    createClaudeCodePlatformAdapter,
    createCodexPlatformAdapter,
} from '../arw-common/platform-adapter.mjs';
import {buildWorkflowDistribution, repositoryOwnedSeedPaths} from '../workflow-distribution/workflow-distribution.mjs';
import {
    createWorkflowLock,
    parseWorkflowLock,
    serializeWorkflowLock,
    verifyManagedContent,
} from './workflow-lock.mjs';

export const WORKFLOW_LOCK_PATH = 'arw-lock.json';
export const WORKFLOW_OPERATIONS = Object.freeze(['init', 'update', 'verify', 'remove']);
export {createNodeGitRunner};

/** @typedef {Buffer | string | Uint8Array} Bytes */
/** @typedef {{blocking?: boolean, canonicalIdentity?: string | null, cause?: string, code: string, identity?: string, locator?: string, message: string, observedIdentity?: string | null, operation?: string, path?: string, phase?: number, platform?: string, remediation?: string, targetPath?: string | null, [key: string]: unknown}} Diagnostic */
/** @typedef {{codeMaps: {excludes: string[], includes: string[], roots: string[]}, domainLayout: string, platforms: string[]}} WorkflowProfile */
/** @typedef {{bytes: Buffer, path: string}} PayloadEntry */
/** @typedef {{platforms: Record<string, {targets: {skills: string}}>, [key: string]: unknown}} ProjectionConfig */
/** @typedef {{diagnostics?: Diagnostic[], distributionConfig?: {repositoryOwnedSeeds?: string[]}, payload: PayloadEntry[], projectionConfig: ProjectionConfig, status: 'succeeded'}} WorkflowDistribution */
/** @typedef {{diagnostics: Diagnostic[], status: 'blocked' | 'failed'}} WorkflowDistributionFailure */
/** @typedef {{action: string, bytes: Buffer, path: string, source: string, strategy: string}} RepositoryOwnedSeed */
/** @typedef {{bytes: Buffer, path: string, source: string}} ManagedTarget */
/** @typedef {{diagnostics: Diagnostic[], configurationDefaults?: ManagedTarget[], managedTargets?: ManagedTarget[], platform: string, repositoryOwnedSeeds?: RepositoryOwnedSeed[], status: string}} PlatformResult */
/** @typedef {{diagnostics: Diagnostic[], configurationDefaults?: ManagedTarget[], managedTargets?: ManagedTarget[], repositoryOwnedSeeds?: RepositoryOwnedSeed[], status: string}} ProjectionEvaluation */
/** @typedef {{evaluate: (input: {payload: PayloadEntry[], platform: string, profile: WorkflowProfile, projectionConfig: ProjectionConfig, seedTargets: Record<string, Buffer | null>}) => ProjectionEvaluation | Promise<ProjectionEvaluation>}} WorkflowAdapter */
/** @typedef {{ensureDirectory: (input: {path: string, phase?: number}) => Promise<unknown>, inspectPath: (input: {path: string, phase?: number}) => Promise<{kind: string, path: string}>, listDirectory: (input: {path: string, phase?: number}) => Promise<Array<{kind: string, name: string}>>, readBytes: (input: {path: string, phase?: number}) => Promise<Buffer>, readFrontmatterBytes: (input: {path: string, phase?: number}) => Promise<Buffer>, removeEmptyDirectory: (input: {path: string, phase?: number}) => Promise<unknown>, removeFile: (input: {path: string, phase?: number}) => Promise<unknown>, replaceFileAtomically: (input: {bytes: Bytes, path: string, phase?: number}) => Promise<unknown>}} RepositoryFilesystem */
/** @typedef {'baseline-major' | 'repository-major'} DocumentOwnership */
/** @typedef {{bytes: Buffer, path: string, platforms: string[], sources: string[]} & ({kind: 'file'} | {documentOwnership: DocumentOwnership, kind: 'region'})} ComposedTarget */
/** @typedef {{authorized: boolean, diagnostics: Diagnostic[], managedTargets: ComposedTarget[], repositoryOwnedSeeds: Array<RepositoryOwnedSeed & {platform: string}>}} PlatformComposition */
/** @typedef {{bytes: Buffer | null, observed: {kind: string}}} RepositoryFileState */
/** @typedef {{agentScopeExcludedPaths: string[], conflicts: string[], excludedPaths: string[], gitVisiblePaths: string[], ignoredPaths: string[], unstaged: string[], untracked: string[]}} RepositoryGitState */
/** @typedef {{files: Record<string, RepositoryFileState>, git: RepositoryGitState, lock: {bytes: Buffer | null, diagnostic?: Diagnostic, lock?: WorkflowLock | null}, policy: {kind: string}, repositoryRoot: string, request: {paths: string[]}, [key: string]: unknown}} RepositoryState */
/** @typedef {{inspect: (input: {repositoryLocation: string, request: {paths: string[], roots: string[]}}) => Promise<RepositoryState>}} RepositoryStateInspector */
/** @typedef {{documentOwnership?: unknown, hash: string, kind: string, path: string, platforms: string[]}} WorkflowLockRecord */
/** @typedef {{managedTargets: WorkflowLockRecord[], profile: WorkflowProfile, repositoryOwnedSeeds: Array<{path: string, [key: string]: unknown}>}} WorkflowLock */
/** @typedef {{bytes: Buffer, locator: string, platforms: string[]} & ({kind: 'file'} | {documentOwnership: DocumentOwnership, kind: 'region'})} TargetDescriptor */
/** @typedef {{action: string, bytes: Buffer | null, expected?: {hash?: string, kind: string}, path: string}} FileOperation */
/** @typedef {{diagnostics: Array<{code: string, message: string, path?: string}>, stage: string, status: 'failed'} | {bytes?: Buffer, diagnostics: Array<{code: string, message: string, path?: string}>, entry?: {kind: string}, path?: string, removed?: boolean, status: 'succeeded'}} TransactionResult */
/** @typedef {{inspect: (input: {path: string}) => Promise<TransactionResult>, read: (input: {path: string}) => Promise<TransactionResult>, remove: (input: {path: string}) => Promise<TransactionResult>, resolve: (input: {path: string}) => {diagnostics: Diagnostic[], status: 'blocked'} | {absolutePath: string, diagnostics: Diagnostic[], relativePath: string, status: 'succeeded'}, write: (input: {bytes: Buffer, path: string}) => Promise<TransactionResult>}} TransactionFilesystem */
/** @typedef {{choices?: string[], description?: string, example?: string, id?: string, message: string}} PromptRequest */
/** @typedef {(request: PromptRequest) => string | null | undefined | Promise<string | null | undefined>} WorkflowPrompt */
/** @typedef {Record<string, {paths: string[]}>} RemovalCategories */
/** @typedef {'platform-agent-configs' | 'arwignore' | 'code-maps' | 'mixed-agent-documents'} RemovalCategory */
/** @typedef {{orphanCodeMapPaths: string[], transformationCandidates: Array<{path: string}>}} ConditionalChoices */
/** @typedef {{canonical: string, diagnostics: Diagnostic[], operations: FileOperation[], profile?: WorkflowProfile, stateDigest?: string, [key: string]: unknown}} WorkflowPlan */
/** @typedef {{mode?: string, platforms?: string[], profile?: WorkflowProfile, removal?: Record<string, string>, reuseProfile?: boolean}} WorkflowChoices */
/** @typedef {{adapters?: Map<string, WorkflowAdapter> | Record<string, WorkflowAdapter>, allowDirty?: boolean, beforeApply?: (plan: WorkflowPlan) => unknown | Promise<unknown>, choices?: WorkflowChoices, distribution?: WorkflowDistribution, distributionDirectory?: string, dryRun?: boolean, filesystem?: RepositoryFilesystem, git?: ReturnType<typeof createNodeGitRunner>, operation: string, orphanCodeMapReadmes?: string, prompt?: WorkflowPrompt, repositoryRoot: string, repositoryStateInspector?: RepositoryStateInspector, showPlan?: (plan: WorkflowPlan) => unknown | Promise<unknown>, showRemovalPreview?: (preview: unknown) => unknown | Promise<unknown>, transformExistingAgentDocs?: boolean | string[]}} WorkflowOptions */

const MANAGED_START = '<!-- arw:managed:start -->';
const MANAGED_END = '<!-- arw:managed:end -->';
const REPOSITORY_START = '<!-- arw:repository-owned:start -->';
const REPOSITORY_END = '<!-- arw:repository-owned:end -->';
const compareText = (/** @type {string | number | undefined} */ left, /** @type {string | number | undefined} */ right) => String(left ?? '').localeCompare(String(right ?? ''), 'en');
const asBytes = (/** @type {Bytes} */ value) => Buffer.isBuffer(value) ? value : Buffer.from(value);
const decodeUtf8 = (/** @type {Bytes} */ value) => {
    try {
        return new TextDecoder('utf-8', {fatal: true}).decode(asBytes(value));
    } catch {
        return null;
    }
};
const digest = (/** @type {Bytes} */ value) => createHash('sha256').update(asBytes(value)).digest('hex');
const stable = (/** @type {unknown} */ value) => JSON.stringify(value, (_key, entry) => (
    Buffer.isBuffer(entry) ? {__arwBytes: entry.toString('base64')} : entry
));
const uniqueSorted = (/** @type {string[]} */ values) => [...new Set(values)].sort(compareText);
const canonicalJson = (/** @type {unknown} */ value) => {
    const serialized = serializeJson(value, {sortKeys: true});
    if (serialized.status !== 'succeeded') throw new Error(serialized.diagnostics[0]?.message ?? 'JSON serialization failed.');
    return serialized.bytes.toString('utf8');
};

const compareDiagnostic = (/** @type {Diagnostic} */ left, /** @type {Diagnostic} */ right) => (
    (left.phase ?? 0) - (right.phase ?? 0)
    || compareText(left.path ?? left.targetPath ?? left.locator ?? '', right.path ?? right.targetPath ?? right.locator ?? '')
    || compareText(left.code ?? '', right.code ?? '')
    || compareText(left.platform ?? '', right.platform ?? '')
    || compareText(left.identity ?? left.canonicalIdentity ?? left.observedIdentity ?? '', right.identity ?? right.canonicalIdentity ?? right.observedIdentity ?? '')
);

const sortDiagnostics = (/** @type {Diagnostic[]} */ diagnostics) => [...diagnostics].sort(compareDiagnostic).filter((entry, index, all) => (
    index === 0 || stable(entry) !== stable(all[index - 1])
));

/** @returns {Diagnostic} */
const createDiagnostic = (/** @type {string} */ code, /** @type {string} */ message, /** @type {Partial<Diagnostic>} */ fields = {}) => ({
    blocking: fields.blocking ?? true,
    code,
    message,
    phase: fields.phase ?? 1,
    ...(fields.path === undefined ? {} : {path: fields.path}),
    ...(fields.platform === undefined ? {} : {platform: fields.platform}),
    ...(fields.identity === undefined ? {} : {identity: fields.identity}),
    ...(fields.operation === undefined ? {} : {operation: fields.operation}),
    ...(fields.cause === undefined ? {} : {cause: fields.cause}),
    ...(fields.remediation === undefined ? {} : {remediation: fields.remediation}),
});

/** @param {{bytes: Buffer | null, observed: {kind: string}}} file */
const interpretWorkflowLock = file => {
    const {bytes, observed} = file;
    if (observed.kind === 'missing') return {bytes: null, lock: null, observed};
    if (observed.kind !== 'file') {
        return {
            bytes: null,
            diagnostic: createDiagnostic('invalid-lock-path', 'arw-lock.json is not a regular file.', {
                blocking: true,
                path: WORKFLOW_LOCK_PATH,
                phase: 1,
            }),
            lock: null,
            observed,
        };
    }
    try {
        if (bytes === null) throw new Error('A regular lock path did not return bytes.');
        return {bytes, lock: parseWorkflowLock(bytes), observed};
    } catch (error) {
        return {
            bytes,
            diagnostic: createDiagnostic(
                'invalid-workflow-lock',
                error instanceof Error ? error.message : String(error),
                {blocking: true, path: WORKFLOW_LOCK_PATH, phase: 1},
            ),
            lock: null,
            observed,
        };
    }
};

/** @param {Parameters<typeof createNodeRepositoryStateInspector>[0]} input */
const createWorkflowRepositoryStateInspector = input => {
    const inspector = createNodeRepositoryStateInspector(input);
    return {
        /** @param {{repositoryLocation?: string, request?: {paths?: string[], roots?: string[]}}} request */
        async inspect(request) {
            const state = await inspector.inspect(request);
            return {...state, lock: interpretWorkflowLock(state.lock)};
        },
    };
};

const createPlatformDiagnostic = (/** @type {string} */ code, /** @type {string} */ message, /** @type {string} */ platform) => ({
    ...createDiagnostic(code, message, {
        phase: 2,
        platform,
        remediation: 'Correct the platform configuration or environment, then rerun the operation.',
    }),
    canonicalIdentity: null,
    contributingConfiguration: [],
    evidence: [],
    objectKind: null,
    observedIdentity: null,
    skippedReason: null,
    targetPath: null,
});

/** @returns {Diagnostic} */
const normalizeDiagnostic = (/** @type {unknown} */ value, /** @type {number} */ phase) => {
    if (!isJsonObject(value) || typeof value.code !== 'string') {
        return createDiagnostic('invalid-diagnostic', 'A component returned a malformed diagnostic.', {phase});
    }
    return {
        ...value,
        code: value.code,
        message: typeof value.message === 'string' ? value.message : value.code,
        phase: typeof value.phase === 'number' ? value.phase : phase,
    };
};

const escapeText = (/** @type {unknown} */ value) => String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('\0', '\\0');

const classifyFileSystemError = (/** @type {unknown} */ error) => {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'EACCES' || code === 'EPERM') return 'access-denied';
    if (code === 'ENOENT') return 'missing-path';
    if (code === 'EEXIST') return 'path-collision';
    if (code === 'EINVAL' || code === 'EISDIR' || code === 'ENOTDIR') return 'invalid-path-kind';
    return 'io-failure';
};

const operationFailure = (/** @type {number} */ phase, /** @type {string} */ operation, /** @type {string} */ path, /** @type {unknown} */ error) => createDiagnostic(
    'filesystem-operation-failed',
    `Filesystem operation ${operation} failed for ${path}: ${error instanceof Error ? error.message : String(error)}.`,
    {cause: classifyFileSystemError(error), operation, path, phase},
);

/** @param {{diagnostics?: Array<{code: string, message: string}>, status: 'blocked' | 'failed'}} result @returns {never} */
function requireFilesystemResult(result) {
    const diagnostic = result.diagnostics?.[0];
    const error = new Error(diagnostic?.message ?? 'Filesystem operation failed.');
    throw Object.assign(error, {
        arwCode: diagnostic?.code,
        code: result.status === 'blocked' ? 'EINVAL' : 'EIO',
    });
}

const frontmatterBytes = (/** @type {Buffer} */ bytes) => {
    if (bytes.length < 4 || bytes.subarray(0, 4).toString('utf8') !== '---\n') return bytes.subarray(0, Math.min(4, bytes.length));
    const end = bytes.indexOf(Buffer.from('\n---\n', 'utf8'), 4);
    return end < 0 ? bytes : bytes.subarray(0, end + 5);
};

/** @returns {RepositoryFilesystem} */
export const createNodeRepositoryFilesystem = (/** @type {string} */ repositoryRoot) => {
    const scoped = createScopedFilesystem({createRoot: false, root: repositoryRoot});
    const filesystem = async () => {
        const result = await scoped;
        if (result.status !== 'succeeded') requireFilesystemResult(result);
        if (result.status !== 'succeeded') throw new Error('Repository filesystem is unavailable.');
        return result.scopedFilesystem;
    };
    return {
        async inspectPath(/** @type {{path: string}} */ {path}) {
            const inspected = await (await filesystem()).inspect({path});
            if (inspected.status !== 'succeeded') requireFilesystemResult(inspected);
            return {
                kind: inspected.entry.kind === 'link' ? 'symbolic-link' : inspected.entry.kind,
                path: inspected.entry.path,
            };
        },
        async listDirectory(/** @type {{path: string}} */ {path}) {
            const listed = await (await filesystem()).list({path, recursive: false});
            if (listed.status !== 'succeeded') requireFilesystemResult(listed);
            return listed.entries.map((/** @type {{kind: string, path: string}} */ entry) => ({
                kind: entry.kind === 'link' ? 'symbolic-link' : entry.kind,
                name: entry.path.slice(entry.path.lastIndexOf('/') + 1),
            }));
        },
        async readBytes(/** @type {{path: string}} */ {path}) {
            const read = await (await filesystem()).read({path});
            if (read.status !== 'succeeded') requireFilesystemResult(read);
            return read.bytes;
        },
        async readFrontmatterBytes(/** @type {{path: string}} */ {path}) {
            const read = await (await filesystem()).read({path});
            if (read.status !== 'succeeded') requireFilesystemResult(read);
            return frontmatterBytes(read.bytes);
        },
        async ensureDirectory(/** @type {{path: string}} */ {path}) {
            const created = await (await filesystem()).createDirectory({path, recursive: true});
            if (created.status !== 'succeeded') requireFilesystemResult(created);
            return {completed: true, path};
        },
        async replaceFileAtomically(/** @type {{path: string, bytes: Bytes}} */ {path, bytes}) {
            const current = await (await filesystem()).inspect({path});
            if (current.status !== 'succeeded') requireFilesystemResult(current);
            if (!['file', 'missing'].includes(current.entry.kind)) {
                throw Object.assign(new Error('Planned target is not a replaceable file.'), {code: 'EINVAL'});
            }
            const written = await (await filesystem()).write({
                bytes: asBytes(bytes),
                mode: current.entry.kind === 'missing' ? 'create' : 'replace',
                path,
            });
            if (written.status !== 'succeeded') requireFilesystemResult(written);
            return {completed: true, path};
        },
        async removeFile(/** @type {{path: string}} */ {path}) {
            const removed = await (await filesystem()).remove({path, recursive: false});
            if (removed.status !== 'succeeded') requireFilesystemResult(removed);
            return {completed: true, path};
        },
        async removeEmptyDirectory(/** @type {{path: string}} */ {path}) {
            const removed = await (await filesystem()).remove({path, recursive: false});
            if (removed.status !== 'succeeded') requireFilesystemResult(removed);
            return {completed: true, path};
        },
    };
};

const asAdapterMap = (/** @type {Map<string, WorkflowAdapter> | Record<string, WorkflowAdapter> | undefined} */ adapters) => adapters instanceof Map ? adapters : new Map(Object.entries(adapters ?? {}));

const seedPathsForPlatform = (/** @type {{distribution: WorkflowDistribution, platform: string}} */ {distribution, platform}) => {
    if (distribution.projectionConfig.platforms[platform] === undefined) return [];
    return repositoryOwnedSeedPaths({
        distributionConfig: {repositoryOwnedSeeds: distribution.distributionConfig?.repositoryOwnedSeeds ?? []},
        payload: distribution.payload,
    });
};

const readSeedTargets = async (/** @type {{distribution: WorkflowDistribution, filesystem: RepositoryFilesystem, platform: string}} */ {distribution, filesystem, platform}) => {
    /** @type {Record<string, Buffer | null>} */
    const targets = {};
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    for (const path of seedPathsForPlatform({distribution, platform})) {
        const observed = await filesystem.inspectPath({phase: 2, path});
        if (observed.kind === 'missing') {
            targets[path] = null;
        } else if (observed.kind === 'file') {
            targets[path] = await filesystem.readBytes({phase: 2, path});
        } else {
            diagnostics.push(createDiagnostic('repository-owned-seed-collision', 'A repository-owned seed target is not a regular file.', {
                path,
                phase: 2,
                platform,
            }));
            targets[path] = null;
        }
    }
    return {diagnostics, targets};
};

/** @returns {PlatformResult} */
const blockedAdapterResult = (/** @type {string} */ platform, /** @type {string} */ message, /** @type {string} */ code = 'platform-evaluation-failed') => ({
    diagnostics: [createPlatformDiagnostic(code, message, platform)],
    managedTargets: [],
    platform,
    repositoryOwnedSeeds: [],
    status: 'blocked',
});

const evaluatePlatforms = async (/** @type {{adapters: Map<string, WorkflowAdapter> | Record<string, WorkflowAdapter> | undefined, distribution: WorkflowDistribution, filesystem: RepositoryFilesystem, platforms: string[], profile: WorkflowProfile}} */ {adapters, distribution, filesystem, platforms, profile}) => {
    const adapterMap = asAdapterMap(adapters);
    /** @type {PlatformResult[]} */
    const results = [];
    for (const platform of platforms) {
        const adapter = adapterMap.get(platform);
        if (!adapter || typeof adapter.evaluate !== 'function') {
            results.push(blockedAdapterResult(platform, `No Platform Adapter is available for ${platform}.`, 'unsupported-platform'));
            continue;
        }
        try {
            const current = await readSeedTargets({distribution, filesystem, platform});
            if (current.diagnostics.length > 0) {
                results.push({
                    diagnostics: current.diagnostics,
                    managedTargets: [],
                    platform,
                    repositoryOwnedSeeds: [],
                    status: 'blocked',
                });
                continue;
            }
            const evaluated = await Promise.resolve(adapter.evaluate({
                payload: distribution.payload,
                platform,
                profile,
                projectionConfig: distribution.projectionConfig,
                seedTargets: current.targets,
            }));
            results.push({...evaluated, platform});
        } catch (error) {
            results.push(blockedAdapterResult(platform, error instanceof Error ? error.message : String(error)));
        }
    }
    return results;
};

const extractManagedSpan = (/** @type {Bytes} */ bytes) => {
    const text = decodeUtf8(bytes);
    if (text === null) return null;
    const start = text.indexOf(MANAGED_START);
    const endMarker = text.indexOf(MANAGED_END);
    if (start < 0 || endMarker < 0 || text.indexOf(MANAGED_START, start + MANAGED_START.length) >= 0 || text.indexOf(MANAGED_END, endMarker + MANAGED_END.length) >= 0 || endMarker < start) return null;
    const end = endMarker + MANAGED_END.length;
    return {end, span: text.slice(start, end), start, text};
};

const hasValidRegionDocument = (/** @type {Bytes} */ bytes, /** @type {DocumentOwnership} */ ownership) => {
    const extracted = extractManagedSpan(bytes);
    if (!extracted) return false;
    const text = extracted.text;
    const starts = [...text.matchAll(new RegExp(REPOSITORY_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))];
    const ends = [...text.matchAll(new RegExp(REPOSITORY_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))];
    if (ownership === 'repository-major') return starts.length === 0 && ends.length === 0;
    return starts.length === 1 && ends.length === 1 && starts[0].index > extracted.end && ends[0].index > starts[0].index && text.endsWith('\n');
};

const hasOwnershipMarker = (/** @type {string} */ text) => [MANAGED_START, MANAGED_END, REPOSITORY_START, REPOSITORY_END]
    .some(marker => text.includes(marker));

const hasRepositoryOwnedRemainder = (/** @type {Bytes} */ bytes) => {
    const text = decodeUtf8(bytes);
    if (text === null) return false;
    const start = text.indexOf(REPOSITORY_START);
    const end = text.indexOf(REPOSITORY_END);
    return start >= 0
        && end > start
        && text.indexOf(REPOSITORY_START, start + REPOSITORY_START.length) < 0
        && text.indexOf(REPOSITORY_END, end + REPOSITORY_END.length) < 0
        && !text.includes(MANAGED_START)
        && !text.includes(MANAGED_END)
        && text.endsWith('\n');
};

const replaceRegion = (/** @type {Bytes} */ currentBytes, /** @type {Bytes} */ desiredBytes) => {
    const current = extractManagedSpan(currentBytes);
    const desired = extractManagedSpan(desiredBytes);
    if (!current || !desired) return null;
    const suffix = current.text.slice(current.end);
    const separator = suffix.length > 0 && !suffix.startsWith('\n') ? '\n' : '';
    return Buffer.from(`${current.text.slice(0, current.start)}${desired.span}${separator}${suffix}`, 'utf8');
};

const transformExistingDocument = (/** @type {{currentBytes: Bytes, desiredBytes: Bytes, ownership: DocumentOwnership}} */ {currentBytes, desiredBytes, ownership}) => {
    const currentText = decodeUtf8(currentBytes);
    const desired = extractManagedSpan(desiredBytes);
    if (currentText === null || desired === null) throw new Error('Managed document transformation requires valid UTF-8 managed bytes.');
    if (ownership === 'repository-major') {
        const suffix = currentText.length === 0 ? '' : `${currentText.startsWith('\n') ? '' : '\n'}${currentText}`;
        return Buffer.from(`${desired.span}${suffix}`, 'utf8');
    }
    const original = currentText.endsWith('\n') ? currentText : `${currentText}\n`;
    return Buffer.from(`${desired.span}\n${REPOSITORY_START}\n${original}${REPOSITORY_END}\n`, 'utf8');
};

const removeManagedRegion = (/** @type {{currentBytes: Bytes, ownership: DocumentOwnership}} */ {currentBytes, ownership}) => {
    const current = extractManagedSpan(currentBytes);
    if (!current) return null;
    const remainder = `${current.text.slice(0, current.start)}${current.text.slice(current.end)}`;
    if (ownership === 'repository-major' && remainder.trim() === '') return null;
    if (ownership === 'baseline-major') {
        const start = remainder.indexOf(REPOSITORY_START);
        const end = remainder.indexOf(REPOSITORY_END);
        if (start >= 0 && end > start) {
            const content = remainder.slice(start + REPOSITORY_START.length, end).trim();
            if (content === '' || content === 'None.') return null;
        }
    }
    return Buffer.from(remainder, 'utf8');
};

const contentHash = (/** @type {{bytes: Bytes, kind: 'file' | 'region', ownership?: DocumentOwnership}} */ {bytes, kind, ownership}) => {
    if (kind === 'file') return digest(bytes);
    const span = extractManagedSpan(bytes);
    if (!span) throw new Error('Managed region is malformed.');
    return digest(Buffer.from(span.span, 'utf8'));
};

/** @returns {{kind: 'file'} | {documentOwnership: DocumentOwnership, kind: 'region'}} */
const targetOwnership = (/** @type {{bytes: Buffer, sources: string[]}} */ target) => {
    if (!target.sources.some((/** @type {string} */ source) => source.startsWith('baseline/'))) return {kind: 'file'};
    if (hasValidRegionDocument(target.bytes, 'baseline-major')) {
        return {documentOwnership: 'baseline-major', kind: 'region'};
    }
    if (hasValidRegionDocument(target.bytes, 'repository-major')) {
        return {documentOwnership: 'repository-major', kind: 'region'};
    }
    return {kind: 'file'};
};

/** @returns {PlatformComposition} */
export const composePlatformResults = (/** @type {PlatformResult[]} */ results) => {
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    /** @type {Map<string, {bytes: Buffer, path: string, platforms: string[], sources: string[]}>} */
    const targets = new Map();
    /** @type {Map<string, RepositoryOwnedSeed & {platform: string}>} */
    const seeds = new Map();
    const configurationPaths = new Set();
    for (const result of results) {
        if (result.status !== 'succeeded') continue;
        for (const target of result.configurationDefaults ?? []) {
            const key = target.path.toLowerCase();
            if (configurationPaths.has(key)) diagnostics.push(createDiagnostic('projection-target-collision', 'Multiple projection entries target the same path.', {path: target.path, phase: 2}));
            configurationPaths.add(key);
        }
    }
    for (const result of results) {
        diagnostics.push(...(result.diagnostics ?? []).map(entry => ({...entry, phase: entry.phase ?? 2})));
        if (result.status !== 'succeeded') continue;
        for (const target of result.managedTargets ?? []) {
            const key = target.path.toLowerCase();
            if (seeds.has(key) || configurationPaths.has(key)) {
                diagnostics.push(createDiagnostic('projection-target-collision', 'Multiple projection entries target the same path.', {
                    path: target.path,
                    phase: 2,
                }));
                continue;
            }
            const current = targets.get(key);
            if (current !== undefined && current.path !== target.path) {
                diagnostics.push(createDiagnostic('managed-target-case-collision', 'Managed target paths collide when compared without case.', {
                    path: target.path,
                    phase: 2,
                }));
                continue;
            }
            if (current !== undefined && !current.bytes.equals(target.bytes)) {
                diagnostics.push(createDiagnostic('managed-target-conflict', 'Selected platforms produced different bytes for one managed target.', {
                    path: target.path,
                    phase: 2,
                }));
                continue;
            }
            if (current === undefined) {
                targets.set(key, {
                    bytes: target.bytes,
                    path: target.path,
                    platforms: [result.platform],
                    sources: [target.source],
                });
            } else {
                current.platforms = uniqueSorted([...current.platforms, result.platform]);
                current.sources = uniqueSorted([...current.sources, target.source]);
            }
        }
        for (const seed of result.repositoryOwnedSeeds ?? []) {
            const key = seed.path.toLowerCase();
            if (targets.has(key) || configurationPaths.has(key)) {
                diagnostics.push(createDiagnostic('projection-target-collision', 'Multiple projection entries target the same path.', {
                    path: seed.path,
                    phase: 2,
                }));
                continue;
            }
            const current = seeds.get(key);
            if (current !== undefined && current.path !== seed.path) {
                diagnostics.push(createDiagnostic('repository-owned-seed-case-collision', 'Repository-owned seed paths collide when compared without case.', {
                    path: seed.path,
                    phase: 2,
                }));
                continue;
            }
            if (current !== undefined) {
                const identicalRegularFile = current.strategy === 'regular-file'
                    && seed.strategy === 'regular-file'
                    && current.action === seed.action
                    && current.source === seed.source
                    && current.bytes.equals(seed.bytes);
                if (identicalRegularFile) continue;
                diagnostics.push(createDiagnostic('repository-owned-seed-duplicate', 'Multiple selected platforms produced one repository-owned seed target.', {
                    path: seed.path,
                    phase: 2,
                }));
                continue;
            }
            seeds.set(key, {...seed, platform: result.platform});
        }
    }
    const managedTargets = [...targets.values()]
        .map(target => ({...target, ...targetOwnership(target)}))
        .sort((left, right) => compareText(left.path, right.path));
    const repositoryOwnedSeeds = [...seeds.values()].sort((left, right) => compareText(left.path, right.path));
    return {
        authorized: diagnostics.length === 0,
        diagnostics: sortDiagnostics(diagnostics),
        managedTargets,
        repositoryOwnedSeeds,
    };
};

const appendRepositoryOwnedContent = (/** @type {{bytes: Bytes, content: string}} */ {bytes, content}) => {
    const text = asBytes(bytes).toString('utf8');
    const start = text.indexOf(REPOSITORY_START);
    const end = text.indexOf(REPOSITORY_END);
    if (start < 0 || end < start) throw new Error('Repository-owned document region is malformed.');
    const bodyStart = start + REPOSITORY_START.length;
    const current = text.slice(bodyStart, end).replace(/^\n/u, '').replace(/\n$/u, '');
    const retained = current.trim() === 'None.' ? '' : current;
    const incoming = content.endsWith('\n') ? content.slice(0, -1) : content;
    const body = [retained, incoming].filter((/** @type {string} */ value) => value.length > 0).join('\n\n');
    return Buffer.from(`${text.slice(0, bodyStart)}\n${body}\n${text.slice(end)}`, 'utf8');
};

const normalizeProfile = (/** @type {WorkflowProfile} */ profile) => ({
    codeMaps: {
        excludes: uniqueSorted(profile.codeMaps.excludes ?? []),
        includes: uniqueSorted(profile.codeMaps.includes ?? []),
        roots: uniqueSorted(profile.codeMaps.roots ?? []),
    },
    domainLayout: profile.domainLayout,
    platforms: uniqueSorted(profile.platforms),
});

const normalizeReplacementRoot = (/** @type {string} */ root) => {
    if (
        typeof root !== 'string'
        || !root.endsWith('/')
        || root.endsWith('//')
    ) {
        return root;
    }
    const candidate = root.slice(0, -1);
    if (candidate === '.' || candidate.includes('*') || candidate.includes('?')) return root;
    try {
        assertSafePath(candidate, 'Code Map root');
        return candidate;
    } catch {
        return root;
    }
};

const normalizeReplacementProfile = (/** @type {WorkflowProfile} */ profile) => normalizeProfile({
    ...profile,
    codeMaps: {
        ...profile.codeMaps,
        roots: (profile.codeMaps.roots ?? []).map(normalizeReplacementRoot),
    },
});

const validateProfile = (/** @type {unknown} */ profile) => {
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    if (!isJsonObject(profile)) {
        return [createDiagnostic('invalid-profile', 'Workflow profile must be one object.', {phase: 1})];
    }
    if (!('domainLayout' in profile) || typeof profile.domainLayout !== 'string' || !['single-context', 'multi-context'].includes(profile.domainLayout)) {
        diagnostics.push(createDiagnostic('invalid-domain-layout', 'Profile domain layout is invalid.', {phase: 1}));
    }
    if (!('platforms' in profile) || !Array.isArray(profile.platforms) || profile.platforms.length === 0) {
        diagnostics.push(createDiagnostic('missing-platform-selection', 'At least one platform must be selected.', {phase: 1}));
    }
    if (Array.isArray(profile.platforms) && profile.platforms.some((/** @type {unknown} */ platform) => typeof platform !== 'string' || !['codex', 'claude-code'].includes(platform))) {
        diagnostics.push(createDiagnostic('unsupported-platform', 'Profile contains an unsupported platform.', {phase: 1}));
    }
    const codeMaps = isJsonObject(profile.codeMaps)
        ? profile.codeMaps
        : undefined;
    for (const key of ['roots', 'includes', 'excludes']) {
        const values = codeMaps?.[key];
        if (!Array.isArray(values) || values.some((/** @type {unknown} */ value) => typeof value !== 'string' || value.length === 0)) {
            diagnostics.push(createDiagnostic('invalid-code-map-input', `Code Map ${key} must contain non-empty strings.`, {phase: 1, identity: key}));
        }
    }
    const roots = Array.isArray(codeMaps?.roots) ? codeMaps.roots : [];
    const includes = Array.isArray(codeMaps?.includes) ? codeMaps.includes : [];
    const excludes = Array.isArray(codeMaps?.excludes) ? codeMaps.excludes : [];
    if (roots.length === 0 && (includes.length > 0 || excludes.length > 0)) {
        diagnostics.push(createDiagnostic('inapplicable-code-map-option', 'Code Map includes and excludes require at least one root.', {phase: 1}));
    }
    if (roots.length > 0 && includes.length === 0) {
        diagnostics.push(createDiagnostic('missing-code-map-include', 'Code Map roots require at least one include glob.', {phase: 1}));
    }
    for (const path of roots.filter((/** @type {unknown} */ value) => typeof value === 'string')) {
        if (path === '.') continue;
        try {
            assertSafePath(path, 'Code Map root');
            if (path.startsWith('./')) {
                throw new Error('Code Map root must not start with ./ syntax.');
            }
            if (path.includes('*') || path.includes('?')) {
                throw new Error('Code Map root must not contain glob syntax.');
            }
        } catch (error) {
            diagnostics.push(createDiagnostic('invalid-code-map-root', error instanceof Error ? error.message : String(error), {phase: 1, path}));
        }
    }
    return diagnostics;
};

const fileStateForPath = (/** @type {{repositoryState: RepositoryState, path: string}} */ {repositoryState, path}) => {
    const current = repositoryState.files?.[path];
    if (current === undefined) throw new Error(`Repository state is missing requested path: ${path}.`);
    return current;
};

const requireFileBytes = (/** @type {Buffer | null} */ bytes, /** @type {string} */ path) => {
    if (bytes === null) throw new Error(`Repository state has no bytes for regular file: ${path}.`);
    return bytes;
};

const validateCodeMapProfile = (/** @type {{policy: {kind: string}, profile: WorkflowProfile, repositoryState: RepositoryState}} */ {policy, profile, repositoryState}) => {
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    let policyAvailable = policy.kind === 'file';
    if (policyAvailable) policyAvailable = verifyPolicyBytes(requireFileBytes(fileStateForPath({repositoryState, path: '.arwignore'}).bytes, '.arwignore'));
    const roots = profile.codeMaps.roots;
    const ignoredPaths = new Set(repositoryState.git.ignoredPaths);
    const agentScopeExcludedPaths = new Set(repositoryState.git.agentScopeExcludedPaths);
    for (const root of roots) {
        if (root !== '.') {
            try {
                assertSafePath(root, 'Code Map root');
            } catch {
                continue;
            }
        }
        const observed = fileStateForPath({repositoryState, path: root}).observed;
        if (observed.kind === 'missing') continue;
        if (observed.kind === 'symbolic-link') {
            diagnostics.push(createDiagnostic('invalid-code-map-root', 'Code Map root must be a real directory, not a symbolic link.', {phase: 1, path: root}));
            continue;
        }
        if (observed.kind !== 'directory') diagnostics.push(createDiagnostic('invalid-code-map-root', 'Code Map root must be a real directory.', {phase: 1, path: root}));
        if (ignoredPaths.has(root)) diagnostics.push(createDiagnostic('ignored-code-map-root', 'Code Map root is excluded by Git ignore rules.', {phase: 1, path: root}));
        else {
            const probe = root === '.' ? 'arw-code-map-probe' : joinRelativePath(root, 'arw-code-map-probe');
            if (policyAvailable && (agentScopeExcludedPaths.has(root) || agentScopeExcludedPaths.has(probe))) {
                diagnostics.push(createDiagnostic('excluded-code-map-root', 'Code Map root is excluded by the .arwignore policy.', {phase: 1, path: root}));
            }
        }
    }
    for (const root of roots) {
        if (roots.some(other => other !== root && root.startsWith(`${other}/`))) {
            diagnostics.push(createDiagnostic('nested-code-map-root', 'Nested Code Map root is already covered by an outer root.', {phase: 1, path: root}));
        }
    }
    return diagnostics;
};

const verifyPolicyBytes = (/** @type {Bytes} */ bytes) => {
    const text = asBytes(bytes).toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(asBytes(bytes)) || text.includes('\0')) return false;
    return true;
};

const demoteCodeMap = (/** @type {Bytes} */ bytes) => {
    const text = asBytes(bytes).toString('utf8');
    const end = text.indexOf('\n---\n', 4);
    if (end < 0) return asBytes(bytes);
    const fields = text.slice(4, end).split('\n').filter(line => !/^code-map-(?:version|kind):/.test(line));
    const body = text.slice(end + 5);
    return fields.length === 0 ? Buffer.from(body, 'utf8') : Buffer.from(`---\n${fields.join('\n')}\n---\n${body}`, 'utf8');
};

const readCurrentBytes = (/** @type {{repositoryState: RepositoryState, path: string}} */ {repositoryState, path}) => fileStateForPath({repositoryState, path});

const readCurrentFrontmatterBytes = async (/** @type {{filesystem: RepositoryFilesystem, path: string}} */ {filesystem, path}) => {
    const observed = await filesystem.inspectPath({phase: 3, path});
    if (observed.kind !== 'file') return {observed, bytes: null};
    return {observed, bytes: await filesystem.readFrontmatterBytes({phase: 3, path})};
};

const currentRecordForPath = (/** @type {WorkflowLock | null | undefined} */ lock, /** @type {string} */ path) => lock?.managedTargets.find(record => record.path === path);

/** @returns {TargetDescriptor[]} */
const buildTargetDescriptors = (/** @type {PlatformComposition} */ composition) => composition.managedTargets.map(target => target.kind === 'region'
    ? {
        bytes: asBytes(target.bytes),
        documentOwnership: target.documentOwnership,
        kind: 'region',
        locator: target.path,
        platforms: target.platforms,
    }
    : {
        bytes: asBytes(target.bytes),
        kind: 'file',
        locator: target.path,
        platforms: target.platforms,
    });

/** @returns {Promise<{diagnostics: Diagnostic[], satisfied: boolean}>} */
const currentManagedVerification = async (/** @type {RepositoryState} */ state) => {
    if (!state.lock.lock) return {diagnostics: [], satisfied: true};
    const result = await verifyManagedContent({lock: state.lock.lock, repositoryRoot: state.repositoryRoot, repositoryState: state});
    return {diagnostics: result.diagnostics.map(entry => normalizeDiagnostic(entry, 3)), satisfied: result.satisfied};
};

const operationForTarget = (/** @type {{currentManagedVerified: boolean, descriptor: TargetDescriptor, current: RepositoryFileState, currentRecord?: WorkflowLockRecord, operation: string, transformExistingAgentDocs?: boolean | string[]}} */ {currentManagedVerified, descriptor, current, currentRecord, operation, transformExistingAgentDocs}) => {
    if (current.observed.kind === 'missing') return {bytes: descriptor.bytes, changed: true};
    if (current.observed.kind !== 'file') {
        return {diagnostic: createDiagnostic('managed-target-collision', 'Planned target is not a regular file.', {phase: 3, path: descriptor.locator})};
    }
    const currentBytes = requireFileBytes(current.bytes, descriptor.locator);
    if (descriptor.kind === 'file') {
        if (currentBytes.equals(descriptor.bytes)) return {bytes: currentBytes, changed: false};
        if (!currentRecord) return {diagnostic: createDiagnostic('managed-target-collision', 'Existing bytes differ from the managed target.', {phase: 3, path: descriptor.locator})};
        return {bytes: descriptor.bytes, changed: true};
    }
    const currentText = decodeUtf8(currentBytes);
    if (currentText === null) {
        return {diagnostic: createDiagnostic('managed-document-invalid-text', 'Existing managed document is not valid UTF-8.', {phase: 3, path: descriptor.locator})};
    }
    if (hasValidRegionDocument(currentBytes, descriptor.documentOwnership)) {
        const bytes = replaceRegion(currentBytes, descriptor.bytes);
        if (bytes === null) return {diagnostic: createDiagnostic('managed-document-invalid-text', 'Managed document region is malformed.', {phase: 3, path: descriptor.locator})};
        return {bytes, changed: !bytes.equals(currentBytes)};
    }
    if (operation === 'update'
        && currentManagedVerified
        && currentRecord?.kind === 'region'
        && currentRecord.documentOwnership === 'repository-major'
        && descriptor.documentOwnership === 'baseline-major'
        && hasValidRegionDocument(currentBytes, 'repository-major')) {
        const retainedBytes = removeManagedRegion({currentBytes, ownership: 'repository-major'});
        if (retainedBytes === null) return {bytes: descriptor.bytes, changed: !descriptor.bytes.equals(currentBytes)};
        const retained = decodeUtf8(retainedBytes);
        if (retained === null) {
            return {diagnostic: createDiagnostic('managed-document-invalid-text', 'Managed document region is malformed.', {phase: 3, path: descriptor.locator})};
        }
        const bytes = retained.trim() === ''
            ? descriptor.bytes
            : appendRepositoryOwnedContent({bytes: descriptor.bytes, content: retained});
        return {bytes, changed: !bytes.equals(currentBytes)};
    }
    if (descriptor.documentOwnership === 'baseline-major' && !currentRecord && hasRepositoryOwnedRemainder(currentBytes)) {
        const desired = extractManagedSpan(descriptor.bytes);
        if (desired === null) return {diagnostic: createDiagnostic('managed-document-invalid-text', 'Desired managed document region is malformed.', {phase: 3, path: descriptor.locator})};
        return {bytes: Buffer.from(`${desired.span}${currentText}`, 'utf8'), changed: true};
    }
    if (!currentRecord && hasOwnershipMarker(currentText)) {
        return {
            diagnostic: createDiagnostic(
                'existing-agent-document-collision',
                'Existing agent document has malformed managed-region ownership.',
                {phase: 3, path: descriptor.locator},
            ),
        };
    }
    const transformAuthorized = transformExistingAgentDocs === true
        || (Array.isArray(transformExistingAgentDocs) && transformExistingAgentDocs.includes(descriptor.locator));
    if (!currentRecord && transformExistingAgentDocs === undefined) {
        return {conditional: 'transform-existing-agent-docs'};
    }
    if (!currentRecord && transformAuthorized) {
        return {bytes: transformExistingDocument({currentBytes, desiredBytes: descriptor.bytes, ownership: descriptor.documentOwnership}), changed: true};
    }
    return {
        diagnostic: createDiagnostic(
            'existing-agent-document-collision',
            transformExistingAgentDocs === true
                ? 'Existing agent document has malformed managed-region ownership.'
                : 'Existing agent document requires explicit transformation authorization.',
            {phase: 3, path: descriptor.locator},
        ),
    };
};

const isExistingAgentDocumentTransformationCandidate = (/** @type {{current: RepositoryFileState, currentRecord?: WorkflowLockRecord, descriptor: TargetDescriptor}} */ {current, currentRecord, descriptor}) => {
    if (descriptor.kind !== 'region' || currentRecord !== undefined || current.observed.kind !== 'file') return false;
    const currentBytes = requireFileBytes(current.bytes, descriptor.locator);
    const currentText = decodeUtf8(currentBytes);
    return currentRecord === undefined
        && currentText !== null
        && !hasOwnershipMarker(currentText)
        && !hasValidRegionDocument(currentBytes, descriptor.documentOwnership)
        && !(descriptor.documentOwnership === 'baseline-major' && hasRepositoryOwnedRemainder(currentBytes));
};

const planOldRecordRemoval = (/** @type {{repositoryState: RepositoryState, record: WorkflowLockRecord}} */ {repositoryState, record}) => {
    const current = readCurrentBytes({repositoryState, path: record.path});
    if (current.observed.kind === 'missing') return {diagnostic: createDiagnostic('managed-content-missing', 'Managed content is missing.', {phase: 3, path: record.path})};
    if (current.observed.kind !== 'file') return {diagnostic: createDiagnostic('managed-content-invalid-kind', 'Managed content is not a regular file.', {phase: 3, path: record.path})};
    if (record.kind === 'file') return {action: 'delete', bytes: null, path: record.path};
    if (record.kind !== 'region' || (record.documentOwnership !== 'baseline-major' && record.documentOwnership !== 'repository-major')) {
        return {diagnostic: createDiagnostic('managed-content-invalid-kind', 'Managed content has invalid ownership metadata.', {phase: 3, path: record.path})};
    }
    const currentBytes = requireFileBytes(current.bytes, record.path);
    if (decodeUtf8(currentBytes) === null) {
        return {diagnostic: createDiagnostic('managed-document-invalid-text', 'Existing managed document is not valid UTF-8.', {phase: 3, path: record.path})};
    }
    const bytes = removeManagedRegion({currentBytes, ownership: record.documentOwnership});
    return bytes === null
        ? {action: 'delete', bytes: null, path: record.path}
        : {action: 'write', bytes, path: record.path};
};

const checkPlannedGitPaths = (/** @type {{repositoryState: RepositoryState, paths: string[], allowDirty: boolean, allowedDirtyPaths?: string[]}} */ {repositoryState, paths, allowDirty, allowedDirtyPaths = []}) => {
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    const state = repositoryState.git;
    if (state.conflicts.length > 0) diagnostics.push(createDiagnostic('unresolved-merge', 'Repository has unresolved merge entries.', {phase: 1}));
    const allowedDirty = new Set(allowedDirtyPaths);
    const unstaged = state.unstaged.filter(path => !allowedDirty.has(path));
    const untracked = state.untracked.filter(path => !allowedDirty.has(path));
    if (!allowDirty && unstaged.length > 0) {
        diagnostics.push(createDiagnostic('unstaged-tracked-changes', `Unstaged tracked paths: ${unstaged.map(escapeText).join(', ')}.`, {phase: 1}));
    }
    if (!allowDirty && untracked.length > 0) {
        diagnostics.push(createDiagnostic('git-visible-untracked', `Git-visible untracked paths: ${untracked.map(escapeText).join(', ')}.`, {phase: 1}));
    }
    const excludedPaths = new Set(state.excludedPaths);
    for (const path of uniqueSorted(paths)) {
        if (excludedPaths.has(path)) {
            diagnostics.push(createDiagnostic('excluded-planned-target', 'A planned target is outside the Repository Workflow write scope.', {phase: 1, path}));
        }
    }
    return {diagnostics: sortDiagnostics(diagnostics), state};
};

const inspectApplicationConfiguration = (/** @type {{phase: number, repositoryRoot: string, repositoryState: RepositoryState, complete?: boolean}} */ {phase, repositoryRoot, repositoryState, complete = false}) => {
    const current = fileStateForPath({repositoryState, path: REPOSITORY_CONFIGURATION_PATH});
    if (current.observed.kind === 'missing') return {
        diagnostics: [],
        operation: complete ? {action: 'write', bytes: completeRepositoryConfigurationBytes(null).bytes, path: REPOSITORY_CONFIGURATION_PATH} : null,
    };
    if (current.observed.kind !== 'file') {
        return {
            diagnostics: [createDiagnostic('application-configuration-path-invalid', 'arw.config.json must be a regular file.', {path: REPOSITORY_CONFIGURATION_PATH, phase})],
            operation: null,
        };
    }
    const sourceBytes = requireFileBytes(current.bytes, REPOSITORY_CONFIGURATION_PATH);
    const prepared = prepareRepositoryConfiguration({repositoryRoot, sourceBytes});
    if (prepared.status !== 'succeeded') {
        return {
            diagnostics: prepared.diagnostics.map(entry => createDiagnostic(entry.code, entry.message, {path: entry.path ?? REPOSITORY_CONFIGURATION_PATH, phase})),
            operation: null,
        };
    }
    const completed = complete ? completeRepositoryConfigurationBytes(prepared.bytes) : {bytes: prepared.bytes, changed: false};
    return {
        diagnostics: [],
        operation: (prepared.changed || completed.changed) && !completed.bytes.equals(sourceBytes)
            ? {action: 'write', bytes: completed.bytes, path: REPOSITORY_CONFIGURATION_PATH}
            : null,
    };
};

/** @param {{target: ManagedTarget, state: RepositoryState, verify: boolean}} input */
const inspectCodexConfiguration = ({target, state, verify}) => {
    const current = fileStateForPath({repositoryState: state, path: target.path});
    if (current.observed.kind !== 'missing' && current.observed.kind !== 'file') return {
        diagnostics: [createDiagnostic('codex-configuration-path-invalid', 'Codex configuration must be a regular file.', {path: target.path, phase: 2})], operation: null,
    };
    const result = prepareCodexConfiguration({sourceBytes: current.observed.kind === 'missing' ? null : requireFileBytes(current.bytes, target.path), defaultBytes: target.bytes});
    if (result.status !== 'succeeded') return {diagnostics: result.diagnostics.map(entry => createDiagnostic(entry.code, entry.message, {path: target.path, phase: 2})), operation: null};
    if (verify && !result.present) return {diagnostics: [createDiagnostic('codex-configuration-setting-missing', 'Codex mode instruction setting is missing.', {path: target.path, phase: 3})], operation: null};
    return {diagnostics: [], operation: !verify && result.changed ? {action: 'write', path: target.path, bytes: result.bytes} : null};
};

const operationBytes = (/** @type {{bytes?: Bytes | null}} */ operation) => operation.bytes === null || operation.bytes === undefined
    ? undefined
    : asBytes(operation.bytes).toString('base64');

const canonicalPlan = (/** @type {{operation: string, profile: WorkflowProfile, operations: FileOperation[], diagnostics: Diagnostic[]}} */ {operation, profile, operations, diagnostics}) => canonicalJson({
    diagnostics: sortDiagnostics(diagnostics),
    operation,
    operations: operations.map(entry => ({
        action: entry.action,
        ...(operationBytes(entry) === undefined ? {} : {bytes: operationBytes(entry)}),
        path: entry.path,
    })),
    profile,
});

const planSeedOperations = (/** @type {{repositoryState: RepositoryState, repositoryOwnedSeeds: Array<RepositoryOwnedSeed & {platform: string}>, diagnostics: Diagnostic[], operations: FileOperation[]}} */ {repositoryState, repositoryOwnedSeeds, diagnostics, operations}) => {
    for (const seed of repositoryOwnedSeeds) {
        if (seed.action === 'compatible') continue;
        const observed = fileStateForPath({repositoryState, path: seed.path}).observed;
        if (observed.kind !== 'missing') {
            diagnostics.push(createDiagnostic('repository-owned-seed-collision', 'A repository-owned seed target changed after projection evaluation.', {phase: 3, path: seed.path}));
            continue;
        }
        operations.push({action: 'write', bytes: seed.bytes, path: seed.path});
    }
};

const baselineSeed = (/** @type {WorkflowDistribution} */ distribution) => distribution.payload.find(entry => entry.path === 'baseline/.arwignore');

/** @returns {Promise<WorkflowDistribution | WorkflowDistributionFailure>} */
const loadWorkflowDistribution = async (/** @type {{distribution?: WorkflowDistribution, distributionDirectory?: string}} */ {distribution, distributionDirectory}) => {
    if (distribution !== undefined) return distribution;
    if (distributionDirectory === undefined) {
        return {
            diagnostics: [{code: 'workflow-distribution-unavailable', message: 'Workflow Distribution directory is required.'}],
            status: 'failed',
        };
    }
    return buildWorkflowDistribution({distributionDirectory});
};

const roleSeedIdentity = (/** @type {{source: string, platform: string}} */ seed) => {
    const fileName = seed.source.slice(seed.source.lastIndexOf('/') + 1);
    const extension = seed.platform === 'codex' ? '.toml' : '.md';
    return fileName.endsWith(extension) ? fileName.slice(0, -extension.length) : fileName;
};

const buildWorkflowLock = (/** @type {{descriptors: TargetDescriptor[], profile: WorkflowProfile, repositoryOwnedSeeds: Array<RepositoryOwnedSeed & {platform: string}>}} */ {descriptors, profile, repositoryOwnedSeeds}) => createWorkflowLock({
    managedTargets: descriptors.map(descriptor => ({
        ...(descriptor.kind === 'region' ? {documentOwnership: descriptor.documentOwnership} : {}),
        hash: contentHash({
            bytes: descriptor.bytes,
            kind: descriptor.kind,
            ownership: descriptor.kind === 'region' ? descriptor.documentOwnership : undefined,
        }),
        kind: descriptor.kind,
        ownership: 'managed',
        path: descriptor.locator,
        platforms: descriptor.platforms,
    })),
    profile,
    repositoryOwnedSeeds: repositoryOwnedSeeds.map(seed => seed.strategy === 'regular-file'
        ? {
            kind: 'file',
            ownership: 'repository-owned-seed',
            path: seed.path,
            strategy: 'regular-file',
        }
        : {
            identity: roleSeedIdentity(seed),
            kind: 'agent-role',
            ownership: 'repository-owned-seed',
            path: seed.path,
            platform: seed.platform,
            strategy: 'declared-role-identity',
        }),
});

const COMPLETE_INSPECTION_ATTEMPTS = 8;

const inspectCompleteRepositoryState = async (/** @type {{repositoryRoot: string, repositoryStateInspector: RepositoryStateInspector, paths: string[], roots: string[], derivePaths?: (state: RepositoryState) => string[]}} */ {repositoryRoot, repositoryStateInspector, paths, roots, derivePaths = undefined}) => {
    let requestedPaths = uniqueSorted(paths);
    for (let attempt = 0; attempt < COMPLETE_INSPECTION_ATTEMPTS; attempt += 1) {
        const state = await repositoryStateInspector.inspect({
            repositoryLocation: repositoryRoot,
            request: {paths: requestedPaths, roots},
        });
        const completePaths = uniqueSorted([
            ...requestedPaths,
            ...state.lock.lock?.managedTargets.map(record => record.path) ?? [],
            ...(derivePaths?.(state) ?? []),
        ]);
        if (completePaths.length === requestedPaths.length) return state;
        requestedPaths = completePaths;
    }
    throw Object.assign(new Error('Repository state did not stabilize during complete inspection.'), {
        code: 'ARW_REPOSITORY_STATE_UNSTABLE',
    });
};

const stateChangedAfterPreflight = (/** @type {WorkflowPlan} */ plan) => ({
    applied: false,
    authorized: false,
    diagnostics: [createDiagnostic('state-changed-after-preflight', 'Repository state changed after plan authorization.', {phase: 3})],
    plan,
});

const buildInitOrUpdatePlan = async (/** @type {{adapters: Map<string, WorkflowAdapter> | Record<string, WorkflowAdapter> | undefined, allowDirty: boolean, distribution: WorkflowDistribution, filesystem: RepositoryFilesystem, operation: string, orphanCodeMapReadmes?: string, profile: WorkflowProfile, repositoryRoot: string, repositoryStateInspector: RepositoryStateInspector, transformExistingAgentDocs?: boolean | string[]}} */ {
    adapters,
    allowDirty,
    distribution,
    filesystem,
    operation,
    orphanCodeMapReadmes,
    profile,
    repositoryRoot,
    repositoryStateInspector,
    transformExistingAgentDocs,
}) => {
    const platforms = profile.platforms;
    const results = await evaluatePlatforms({
        adapters,
        distribution,
        filesystem,
        platforms,
        profile,
    });
    const composition = composePlatformResults(results);
    const configurationDefaults = results.flatMap(result => result.configurationDefaults ?? []);
    const requestedPaths = uniqueSorted([
        WORKFLOW_LOCK_PATH,
        '.arwignore',
        REPOSITORY_CONFIGURATION_PATH,
        ...configurationDefaults.map(target => target.path),
        ...composition.managedTargets.map(target => target.path),
        ...composition.repositoryOwnedSeeds.map(seed => seed.path),
        ...platforms.flatMap(platform => seedPathsForPlatform({distribution, platform})),
    ]);
    let state = await inspectCompleteRepositoryState({
        paths: requestedPaths,
        repositoryRoot,
        repositoryStateInspector,
        roots: profile.codeMaps.roots,
    });
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    if (state.lock.diagnostic) diagnostics.push(state.lock.diagnostic);
    if (operation === 'update' && !state.lock.lock) {
        diagnostics.push(createDiagnostic('workflow-uninitialized', 'Repository Workflow is not initialized; run arw workflow init.', {phase: 1}));
    }
    diagnostics.push(...validateProfile(profile));
    diagnostics.push(...validateCodeMapProfile({policy: state.policy, profile, repositoryState: state}));
    const applicationConfiguration = inspectApplicationConfiguration({phase: 1, repositoryRoot, repositoryState: state, complete: true});
    diagnostics.push(...applicationConfiguration.diagnostics);
    const currentVerification = await currentManagedVerification(state);
    diagnostics.push(...currentVerification.diagnostics.map(entry => normalizeDiagnostic(entry, 3)));
    const gitResult = checkPlannedGitPaths({allowDirty, allowedDirtyPaths: [REPOSITORY_CONFIGURATION_PATH], paths: state.request.paths, repositoryState: state});
    diagnostics.push(...gitResult.diagnostics);
    diagnostics.push(...composition.diagnostics.map(entry => ({...entry, phase: entry.phase ?? 2})));
    const descriptors = buildTargetDescriptors(composition);
    /** @type {FileOperation[]} */
    const operations = [];
    if (applicationConfiguration.operation !== null) operations.push(applicationConfiguration.operation);
    /** @type {Array<{path: string}>} */
    const transformationCandidates = [];
    const claudeDescriptor = descriptors.find((/** @type {{ locator: string; }} */ descriptor) => descriptor.locator === 'CLAUDE.md');
    const currentClaude = claudeDescriptor === undefined ? null : readCurrentBytes({repositoryState: state, path: 'CLAUDE.md'});
    const currentClaudeRecord = currentRecordForPath(state.lock.lock, 'CLAUDE.md');
    let claudeMigrationContent = null;
    let canonicalizeUnownedClaude = false;
    if (claudeDescriptor !== undefined
        && currentClaude !== null
        && currentClaudeRecord === undefined
        && currentClaude.observed.kind === 'file'
        && !requireFileBytes(currentClaude.bytes, 'CLAUDE.md').equals(claudeDescriptor.bytes)) {
        const currentClaudeBytes = requireFileBytes(currentClaude.bytes, 'CLAUDE.md');
        if (!verifyPolicyBytes(currentClaudeBytes)) {
            diagnostics.push(createDiagnostic('claude-document-invalid-text', 'Existing CLAUDE.md is not valid text.', {phase: 3, path: 'CLAUDE.md'}));
        } else {
            const text = currentClaudeBytes.toString('utf8');
            canonicalizeUnownedClaude = true;
            if (text.trim() !== '' && text.trim() !== '@AGENTS.md') claudeMigrationContent = text;
        }
    }
    for (const descriptor of descriptors) {
        const current = readCurrentBytes({repositoryState: state, path: descriptor.locator});
        const currentRecord = currentRecordForPath(state.lock.lock, descriptor.locator);
        if (isExistingAgentDocumentTransformationCandidate({current, currentRecord, descriptor})) {
            transformationCandidates.push({path: descriptor.locator});
        }
        const planned = descriptor.locator === 'CLAUDE.md' && canonicalizeUnownedClaude
            ? {bytes: descriptor.bytes, changed: true}
            : operationForTarget({
                current,
                currentManagedVerified: currentVerification.satisfied,
                currentRecord,
                descriptor,
                operation,
                transformExistingAgentDocs,
            });
        if (planned.conditional === 'transform-existing-agent-docs') {
            continue;
        }
        if (planned.diagnostic) {
            diagnostics.push(planned.diagnostic);
            continue;
        }
        if (planned.bytes === undefined) {
            diagnostics.push(createDiagnostic('invalid-workflow-plan', 'Managed target planning did not produce bytes.', {phase: 3, path: descriptor.locator}));
            continue;
        }
        if (descriptor.locator === 'AGENTS.md' && claudeMigrationContent !== null) {
            if (descriptor.kind !== 'region' || descriptor.documentOwnership !== 'baseline-major') {
                diagnostics.push(createDiagnostic('claude-migration-target-invalid', 'CLAUDE.md content requires a baseline-major AGENTS.md target.', {phase: 3, path: 'AGENTS.md'}));
                continue;
            }
            try {
                planned.bytes = appendRepositoryOwnedContent({bytes: planned.bytes, content: claudeMigrationContent});
                planned.changed = true;
            } catch (error) {
                diagnostics.push(createDiagnostic('claude-migration-target-invalid', error instanceof Error ? error.message : String(error), {phase: 3, path: 'AGENTS.md'}));
                continue;
            }
        }
        if (planned.changed) operations.push({action: 'write', bytes: planned.bytes, path: descriptor.locator});
    }
    if (claudeMigrationContent !== null && !descriptors.some((/** @type {{ locator: string; }} */ descriptor) => descriptor.locator === 'AGENTS.md')) {
        diagnostics.push(createDiagnostic('claude-migration-target-missing', 'CLAUDE.md content cannot be migrated because AGENTS.md is not in the selected projection.', {phase: 3, path: 'AGENTS.md'}));
    }
    if (transformationCandidates.length === 0 && transformExistingAgentDocs !== undefined) {
        diagnostics.push(createDiagnostic('inapplicable-choice', 'Existing agent document transformation is not applicable.', {phase: 3, identity: 'transform-existing-agent-docs'}));
    }
    /** @type {string[]} */
    const migratedRuleDocuments = [];
    if (state.lock.lock && currentVerification.satisfied) {
        const desiredPaths = new Set(descriptors.map(descriptor => descriptor.locator));
        for (const record of state.lock.lock.managedTargets) {
            if (desiredPaths.has(record.path)) continue;
            const removal = planOldRecordRemoval({repositoryState: state, record});
            if (removal.diagnostic) diagnostics.push(removal.diagnostic);
            else if (removal.action === 'write' && record.kind === 'region' && record.documentOwnership === 'baseline-major') {
                // 已删除的规则文档仍有仓库自有内容: 迁入 AGENTS.md 的仓库自有区域, 删除原文件.
                const content = asBytes(/** @type {Buffer} */ (removal.bytes)).toString('utf8').replace(REPOSITORY_START, '').replace(REPOSITORY_END, '').trim();
                const agentsOperation = operations.find(entry => entry.path === 'AGENTS.md' && entry.action === 'write');
                const agentsBytes = agentsOperation?.bytes ?? requireFileBytes(readCurrentBytes({repositoryState: state, path: 'AGENTS.md'}).bytes, 'AGENTS.md');
                const bytes = appendRepositoryOwnedContent({bytes: agentsBytes, content: `# 迁自 \`${record.path}\` 的仓库自有内容\n\n${content}`});
                if (agentsOperation) agentsOperation.bytes = bytes;
                else operations.push({action: 'write', bytes, path: 'AGENTS.md'});
                operations.push({action: 'delete', bytes: null, path: record.path});
                migratedRuleDocuments.push(record.path);
            } else operations.push({action: removal.action, bytes: removal.bytes, path: removal.path});
        }
    }
    for (const target of configurationDefaults) {
        const configured = inspectCodexConfiguration({target, state, verify: false});
        diagnostics.push(...configured.diagnostics);
        if (configured.operation !== null) operations.push(configured.operation);
    }
    planSeedOperations({
        diagnostics,
        operations,
        repositoryState: state,
        repositoryOwnedSeeds: composition.repositoryOwnedSeeds,
    });
    const policy = baselineSeed(distribution);
    if (!policy) diagnostics.push(createDiagnostic('missing-policy-seed', 'Distribution does not declare .arwignore policy seed.', {phase: 2, path: '.arwignore'}));
    else {
        const currentPolicy = fileStateForPath({repositoryState: state, path: '.arwignore'});
        const observed = currentPolicy.observed;
        if (observed.kind !== 'missing' && observed.kind !== 'file') diagnostics.push(createDiagnostic('invalid-policy-path', '.arwignore is not a regular file.', {phase: 3, path: '.arwignore'}));
        else if (observed.kind === 'file' && !verifyPolicyBytes(requireFileBytes(currentPolicy.bytes, '.arwignore'))) diagnostics.push(createDiagnostic('malformed-policy', '.arwignore is not valid text.', {phase: 3, path: '.arwignore'}));
    }
    /** @type {string[]} */
    let orphanCodeMapPaths = [];
    if (operation === 'init') {
        const policyAvailable = state.policy.kind === 'file'
            && verifyPolicyBytes(requireFileBytes(fileStateForPath({repositoryState: state, path: '.arwignore'}).bytes, '.arwignore'));
        const scanRoots = uniqueSorted([
            ...(state.lock.lock?.profile.codeMaps.roots ?? []),
            ...profile.codeMaps.roots,
        ]);
        const codeMapResult = verifyCodeMaps(await inspectCodeMapCoverage({
            filesystem,
            policyAvailable,
                profile: profile.codeMaps,
                repositoryState: state,
            scanRoots,
        }));
        orphanCodeMapPaths = codeMapResult.orphanReadmes;
        if (typeof orphanCodeMapReadmes === 'string' && ['delete', 'demote'].includes(orphanCodeMapReadmes)
            && orphanCodeMapPaths.some(path => state.files[path] === undefined)) {
            state = await inspectCompleteRepositoryState({
                paths: [...requestedPaths, ...orphanCodeMapPaths],
                repositoryRoot,
                repositoryStateInspector,
                roots: profile.codeMaps.roots,
            });
        }
        if (orphanCodeMapPaths.length > 0 && orphanCodeMapReadmes === undefined) {
            // 交互 runner 会在询问这个条件选择前先取得完整 evaluation.
        } else if (orphanCodeMapPaths.length === 0 && orphanCodeMapReadmes !== undefined) {
            diagnostics.push(createDiagnostic('inapplicable-choice', 'Orphan Code Map README handling is not applicable.', {phase: 3, identity: 'orphan-code-map-readmes'}));
        } else if (orphanCodeMapReadmes === 'delete') {
            for (const path of orphanCodeMapPaths) operations.push({action: 'delete', bytes: null, path});
        } else if (orphanCodeMapReadmes === 'demote') {
            for (const path of orphanCodeMapPaths) {
                const current = readCurrentBytes({repositoryState: state, path});
                if (current.observed.kind !== 'file' || current.bytes === null) {
                    diagnostics.push(createDiagnostic('orphan-code-map-unreadable', 'Orphan Code Map README is not a readable regular file.', {phase: 3, path}));
                    continue;
                }
                operations.push({action: 'write', bytes: demoteCodeMap(requireFileBytes(current.bytes, path)), path});
            }
        } else if (orphanCodeMapReadmes !== undefined) {
            diagnostics.push(createDiagnostic('invalid-orphan-code-map-choice', 'Orphan Code Map README handling must be delete or demote.', {phase: 3, identity: 'orphan-code-map-readmes'}));
        }
    }
    if (state.lock.lock || operation === 'update') {
        if (composition.authorized && descriptors.length > 0) {
            let nextLock;
            try {
                nextLock = buildWorkflowLock({descriptors, profile, repositoryOwnedSeeds: composition.repositoryOwnedSeeds});
                const lockBytes = Buffer.from(serializeWorkflowLock(nextLock), 'utf8');
                if (state.lock.bytes === null || !state.lock.bytes.equals(lockBytes)) operations.push({action: 'write-lock', bytes: lockBytes, path: WORKFLOW_LOCK_PATH});
            } catch (error) {
                diagnostics.push(createDiagnostic('invalid-workflow-lock-plan', error instanceof Error ? error.message : String(error), {phase: 3, path: WORKFLOW_LOCK_PATH}));
            }
        }
    } else if (composition.authorized && descriptors.length > 0) {
        try {
            const nextLock = buildWorkflowLock({descriptors, profile, repositoryOwnedSeeds: composition.repositoryOwnedSeeds});
            operations.push({action: 'write-lock', bytes: Buffer.from(serializeWorkflowLock(nextLock), 'utf8'), path: WORKFLOW_LOCK_PATH});
        } catch (error) {
            diagnostics.push(createDiagnostic('invalid-workflow-lock-plan', error instanceof Error ? error.message : String(error), {phase: 3, path: WORKFLOW_LOCK_PATH}));
        }
    }
    const sortedOperations = operations.map(entry => {
        const current = fileStateForPath({repositoryState: state, path: entry.path});
        return {
            ...entry,
            expected: current.observed.kind === 'file'
                ? {hash: digest(requireFileBytes(current.bytes, entry.path)), kind: 'file'}
                : {kind: 'missing'},
        };
    }).sort((left, right) => (
        (left.action === 'write-lock' ? 1 : 0) - (right.action === 'write-lock' ? 1 : 0)
        || compareText(left.path, right.path)
        || compareText(left.action, right.action)
    ));
    const allTargetPaths = sortedOperations.map(entry => entry.path);
    const targetGit = checkPlannedGitPaths({allowDirty, allowedDirtyPaths: [REPOSITORY_CONFIGURATION_PATH], paths: allTargetPaths, repositoryState: state});
    diagnostics.push(...targetGit.diagnostics.filter(entry => !diagnostics.some(existing => stable(existing) === stable(entry))));
    const observedPaths = uniqueSorted([
        ...descriptors.map(descriptor => descriptor.locator),
        ...state.lock.lock?.managedTargets.map(record => record.path) ?? [],
        '.arwignore',
        REPOSITORY_CONFIGURATION_PATH,
        ...orphanCodeMapPaths,
    ]);
    /** @type {Record<string, {bytes: Buffer | null, kind: string}>} */
    const observedContent = {};
    const frontmatterOnlyOrphans = new Set(orphanCodeMapReadmes === 'demote' ? [] : orphanCodeMapPaths);
    for (const path of observedPaths) {
        const current = state.files[path] === undefined || frontmatterOnlyOrphans.has(path)
            ? await readCurrentFrontmatterBytes({filesystem, path})
            : readCurrentBytes({repositoryState: state, path});
        observedContent[path] = {bytes: current.bytes, kind: current.observed.kind};
    }
    const finalDiagnostics = sortDiagnostics(diagnostics);
    const plan = {
        canonical: canonicalPlan({diagnostics: finalDiagnostics, operation, operations: sortedOperations, profile}),
        diagnostics: finalDiagnostics,
        migratedRuleDocuments,
        operations: sortedOperations,
        profile,
        stateDigest: stable({
            currentLock: state.lock.bytes,
            git: gitResult.state,
            observedContent,
            orphanCodeMapPaths,
            results: results.map(result => ({
                diagnostics: result.diagnostics,
                managedTargets: result.managedTargets,
                repositoryOwnedSeeds: result.repositoryOwnedSeeds,
                status: result.status,
            })),
        }),
    };
    return {conditional: {orphanCodeMapPaths, transformationCandidates}, plan, results, state};
};

/** @returns {TransactionFilesystem} */
const transactionFilesystem = (/** @type {RepositoryFilesystem} */ filesystem, /** @type {string} */ repositoryRoot) => ({
    resolve(/** @type {{path: string}} */ {path}) {
        return resolveRelativePathWithinScope({path, scope: repositoryRoot});
    },
    async inspect(/** @type {{path: string}} */ {path}) {
        try {
            return {diagnostics: [], entry: await filesystem.inspectPath({phase: 4, path}), status: 'succeeded'};
        } catch (error) {
            return {diagnostics: [operationFailure(4, 'inspect', path, error)], stage: 'inspect', status: 'failed'};
        }
    },
    async read(/** @type {{path: string}} */ {path}) {
        try {
            return {bytes: await filesystem.readBytes({phase: 4, path}), diagnostics: [], path, status: 'succeeded'};
        } catch (error) {
            return {diagnostics: [operationFailure(4, 'read', path, error)], stage: 'read', status: 'failed'};
        }
    },
    async write(/** @type {{bytes: Buffer, path: string}} */ {bytes, path}) {
        try {
            const parent = dirname(path).replaceAll('\\', '/');
            if (parent !== '.') await filesystem.ensureDirectory({phase: 4, path: parent});
            await filesystem.replaceFileAtomically({phase: 4, path, bytes});
            return {diagnostics: [], path, status: 'succeeded'};
        } catch (error) {
            return {diagnostics: [operationFailure(4, 'write', path, error)], stage: 'write', status: 'failed'};
        }
    },
    async remove(/** @type {{path: string}} */ {path}) {
        try {
            const observed = await filesystem.inspectPath({phase: 4, path});
            if (observed.kind !== 'missing') await filesystem.removeFile({phase: 4, path});
            return {diagnostics: [], path, removed: observed.kind !== 'missing', status: 'succeeded'};
        } catch (error) {
            return {diagnostics: [operationFailure(4, 'delete', path, error)], stage: 'remove', status: 'failed'};
        }
    },
});

const applyOperations = async (/** @type {{filesystem: RepositoryFilesystem, operations: FileOperation[], repositoryRoot: string}} */ {filesystem, operations, repositoryRoot}) => {
    const transactionOperations = operations.map(operation => {
        if (operation.expected === undefined) throw new Error(`Workflow operation ${operation.path} has no preflight expectation.`);
        return {
            ...(operation.bytes === null || operation.bytes === undefined ? {} : {bytes: operation.bytes}),
            expected: operation.expected,
            kind: operation.action === 'delete' || operation.action === 'delete-lock'
                ? 'delete'
                : operation.expected.kind === 'missing' ? 'create' : 'replace',
            path: operation.path,
        };
    });
    const preflight = await preflightFileTransaction({filesystem: transactionFilesystem(filesystem, repositoryRoot), operations: transactionOperations});
    if (preflight.status !== 'succeeded') {
        return {applied: false, diagnostics: preflight.diagnostics.map(entry => ({...entry, phase: 'phase' in entry && typeof entry.phase === 'number' ? entry.phase : 4}))};
    }
    const applied = await applyFileTransaction(preflight.preparedTransaction);
    if (applied.status === 'succeeded') return {applied: true, diagnostics: []};
    return {
        applied: false,
        completedOperations: applied.completedOperations,
        diagnostics: applied.diagnostics.map((/** @type {{[key: string]: unknown, phase?: number}} */ entry) => ({...entry, phase: typeof entry.phase === 'number' ? entry.phase : 4})),
        rollback: applied.rollback,
    };
};

const finalVerify = async (/** @type {{configurationDefaults?: ManagedTarget[], operation: string, repositoryRoot: string, filesystem: RepositoryFilesystem, repositoryStateInspector: RepositoryStateInspector}} */ {configurationDefaults = [], operation, repositoryRoot, filesystem, repositoryStateInspector}) => {
    if (operation === 'remove') {
        const lock = await filesystem.inspectPath({phase: 5, path: WORKFLOW_LOCK_PATH});
        return lock.kind === 'missing'
            ? {satisfied: true, diagnostics: []}
            : {satisfied: false, diagnostics: [createDiagnostic('lock-remains-after-remove', 'arw-lock.json remains after removal.', {phase: 5, path: WORKFLOW_LOCK_PATH})]};
    }
    const state = await inspectCompleteRepositoryState({
        paths: [WORKFLOW_LOCK_PATH, REPOSITORY_CONFIGURATION_PATH, ...configurationDefaults.map(target => target.path)],
        repositoryRoot,
        repositoryStateInspector,
        roots: [],
    });
    const lock = state.lock;
    if (!lock.lock) return {satisfied: false, diagnostics: [lock.diagnostic ?? createDiagnostic('missing-workflow-lock', 'arw-lock.json is missing after apply.', {phase: 5, path: WORKFLOW_LOCK_PATH})]};
    const verification = await verifyManagedContent({lock: lock.lock, repositoryRoot, repositoryState: state});
    const applicationConfiguration = inspectApplicationConfiguration({phase: 5, repositoryRoot, repositoryState: state});
    const configurationDiagnostics = configurationDefaults.flatMap(target => inspectCodexConfiguration({target, state, verify: true}).diagnostics)
        .map(entry => ({...entry, phase: 5}));
    return {
        diagnostics: [...verification.diagnostics.map(entry => ({...entry, phase: 5})), ...applicationConfiguration.diagnostics, ...configurationDiagnostics],
        satisfied: verification.satisfied && applicationConfiguration.diagnostics.length === 0 && configurationDiagnostics.length === 0,
    };
};

const defaultPrompt = async (/** @type {PromptRequest} */ {description, example, message, choices}) => {
    const readline = await import('node:readline/promises');
    const terminal = await import('node:process');
    const interfaceHandle = readline.createInterface({input: terminal.stdin, output: terminal.stdout});
    try {
        if (description !== undefined) terminal.stdout.write(`${description}\n`);
        if (example !== undefined) terminal.stdout.write(`Example: ${example}\n`);
        return await interfaceHandle.question(`${message}${choices ? ` [${choices.join('|')}]` : ''}: `);
    } finally {
        interfaceHandle.close();
    }
};

/** @type {readonly RemovalCategory[]} */
const REMOVAL_CATEGORIES = Object.freeze([
    'platform-agent-configs',
    'arwignore',
    'code-maps',
    'mixed-agent-documents',
]);

const codeMapIdentity = (/** @type {Bytes} */ bytes) => {
    const text = asBytes(bytes).toString('utf8');
    if (!text.startsWith('---\n')) return false;
    const end = text.indexOf('\n---\n', 4);
    if (end < 0) return false;
    return /^code-map-version:\s*\S+/m.test(text.slice(4, end)) && /^code-map-kind:\s*\S+/m.test(text.slice(4, end));
};

const scanCodeMapReadmes = async (/** @type {{filesystem: RepositoryFilesystem, roots: string[]}} */ {filesystem, roots}) => {
    /** @type {string[]} */
    const found = [];
    const visit = async (/** @type {string} */ path) => {
        const observed = await filesystem.inspectPath({phase: 2, path});
        if (observed.kind !== 'directory') return;
        let entries;
        try {
            entries = await filesystem.listDirectory({phase: 2, path});
        } catch {
            return;
        }
        for (const entry of entries) {
            const child = path === '.' ? entry.name : joinRelativePath(path, entry.name);
            if (entry.kind === 'symbolic-link') continue;
            if (entry.kind === 'directory' && entry.name === '.git') continue;
            if (entry.kind === 'directory') {
                await visit(child);
                continue;
            }
            if (entry.kind !== 'file' || entry.name !== 'README.md') continue;
            try {
                if (codeMapIdentity(await filesystem.readFrontmatterBytes({phase: 2, path: child}))) found.push(child);
            } catch {
                // 后续 workflow operation 会通过标准 filesystem diagnostics 报告不可读文件.
            }
        }
    };
    for (const root of roots) await visit(root);
    return uniqueSorted(found);
};

const seedPathsFromLock = (/** @type {WorkflowLock | null | undefined} */ lock) => uniqueSorted((lock?.repositoryOwnedSeeds ?? [])
    .filter(seed => seed.kind === 'agent-role')
    .map(seed => seed.path));

const removalPreview = (/** @type {{categories: RemovalCategories}} */ {categories}) => REMOVAL_CATEGORIES.filter(category => (categories[category]?.paths.length ?? 0) > 0).map(category => ({
    category,
    deleteWarning: 'Deleting Repository-owned custom content cannot be recovered by re-init after the deletion is staged or committed.',
    paths: categories[category]?.paths ?? [],
    postRemove: category === 'platform-agent-configs'
        ? 'Canonical role references may no longer resolve; retained files can be reused by a later init.'
        : category === 'arwignore'
            ? 'Agent scope policy is inactive until a later init recreates or reuses it.'
            : category === 'code-maps'
                ? 'Code Map README files remain available for Agent and Human orientation when retained.'
                : 'Repository-owned document remainder stays byte-preserved when retained.',
    retentionBenefit: category === 'platform-agent-configs'
        ? 'Preserves local role tuning.'
        : category === 'arwignore'
            ? 'Preserves the future init scope policy.'
            : category === 'code-maps'
                ? 'Preserves structural documentation.'
                : 'Preserves Repository-specific prose and round-trip material.',
}));

const removalCategories = async (/** @type {{filesystem: RepositoryFilesystem, lock: WorkflowLock | null | undefined, profile: WorkflowProfile, repositoryState: RepositoryState}} */ {filesystem, lock, profile, repositoryState}) => {
    const platformAgentConfigs = [];
    for (const path of seedPathsFromLock(lock)) {
        if (fileStateForPath({repositoryState, path}).observed.kind !== 'missing') platformAgentConfigs.push(path);
    }
    const arwignore = fileStateForPath({repositoryState, path: '.arwignore'}).observed.kind === 'missing' ? [] : ['.arwignore'];
    const codeMaps = await scanCodeMapReadmes({filesystem, roots: profile.codeMaps.roots});
    const mixedAgentDocuments = [];
    for (const record of lock?.managedTargets ?? []) {
        if (record.kind !== 'region') continue;
        if (record.documentOwnership !== 'baseline-major' && record.documentOwnership !== 'repository-major') continue;
        const current = readCurrentBytes({repositoryState, path: record.path});
        if (current.observed.kind !== 'file') continue;
        const remainder = removeManagedRegion({currentBytes: requireFileBytes(current.bytes, record.path), ownership: record.documentOwnership});
        if (remainder !== null && remainder.length > 0) mixedAgentDocuments.push(record.path);
    }
    return {
        'arwignore': {paths: arwignore},
        'code-maps': {paths: codeMaps},
        'mixed-agent-documents': {paths: uniqueSorted(mixedAgentDocuments)},
        'platform-agent-configs': {paths: uniqueSorted(platformAgentConfigs)},
    };
};

const validateRemovalChoices = (/** @type {{categories: RemovalCategories, choices?: Record<string, string>}} */ {categories, choices}) => {
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    const selected = choices ?? {};
    for (const category of REMOVAL_CATEGORIES) {
        const present = (categories[category]?.paths.length ?? 0) > 0;
        const value = selected[category];
        if (present && !['retain', 'delete'].includes(value)) {
            diagnostics.push(createDiagnostic('missing-removal-choice', `Removal choice is required for ${category}.`, {phase: 3, identity: category}));
        }
        if (!present && value !== undefined) {
            diagnostics.push(createDiagnostic('inapplicable-removal-choice', `Removal choice is not applicable for ${category}.`, {phase: 3, identity: category}));
        }
    }
    return diagnostics;
};

/**
 * @overload
 * @param {string | null | undefined} value
 * @param {'list'} kind
 * @returns {{cancelled: true} | {cancelled?: false, value: string[]}}
 */
/**
 * @overload
 * @param {string | null | undefined} value
 * @param {'value'} kind
 * @returns {{cancelled: true} | {cancelled?: false, value: string}}
 */
function parsePromptValue(/** @type {string | null | undefined} */ value, /** @type {'list' | 'value'} */ kind) {
    if (value === undefined || value === null) return {cancelled: true};
    const text = String(value).trim();
    if (text.toLowerCase() === 'cancel' || text === '^C') return {cancelled: true};
    if (kind === 'list') return {value: text === '' ? [] : text.split(',').map(item => item.trim()).filter(Boolean)};
    return {value: text};
}

const collectInteractiveRemovalChoices = async (/** @type {{categories: RemovalCategories, prompt?: WorkflowPrompt}} */ {categories, prompt = defaultPrompt}) => {
    /** @type {Record<string, string>} */
    const choices = {};
    for (const category of REMOVAL_CATEGORIES) {
        const paths = categories[category]?.paths ?? [];
        if (paths.length === 0) continue;
        const answer = parsePromptValue(await prompt({
            id: `remove-${category}`,
            message: `Choose retain or delete for ${category} (${paths.join(', ')}). Delete cannot be recovered by re-init after stage or commit.`,
            choices: ['retain', 'delete', 'cancel'],
        }), 'value');
        if (answer.cancelled) return {cancelled: true};
        if (!['retain', 'delete'].includes(answer.value)) return {invalid: true};
        choices[category] = answer.value;
    }
    return {choices};
};

const collectInteractiveProfile = async (/** @type {{currentProfile?: WorkflowProfile | null, prompt?: WorkflowPrompt}} */ {currentProfile, prompt = defaultPrompt}) => {
    if (currentProfile) {
        const reuse = parsePromptValue(await prompt({
            id: 'reuse-profile',
            description: 'Choose yes to reuse the Repository Profile stored in arw-lock.json, no to enter a complete replacement Profile, or cancel to stop without applying.',
            message: 'Reuse the current Repository Profile',
            choices: ['yes', 'no', 'cancel'],
        }), 'value');
        if (reuse.cancelled) return {cancelled: true};
        const reuseChoice = reuse.value.toLowerCase();
        if (reuseChoice === 'yes') return {profile: normalizeProfile(currentProfile)};
        if (reuseChoice !== 'no') return {invalid: true};
    }
    const platformChoices = ['codex', 'claude-code'];
    const platforms = parsePromptValue(await prompt({
        id: 'platforms',
        description: 'Choose codex to install Codex-native workflow projections, claude-code to install Claude Code-native projections, or both. Separate multiple values with commas.',
        message: 'Select platforms',
        choices: platformChoices,
    }), 'list');
    if (platforms.cancelled) return platforms;
    if (platforms.value.length === 0 || platforms.value.some((/** @type {string} */ platform) => !platformChoices.includes(platform))) return {invalid: true};
    const domainLayoutChoices = ['single-context', 'multi-context'];
    const domainLayout = parsePromptValue(await prompt({
        id: 'domain-layout',
        description: 'Choose single-context for one root CONTEXT.md, or multi-context for separate domain documents under docs/domain.',
        message: 'Select domain-documentation layout',
        choices: domainLayoutChoices,
    }), 'value');
    if (domainLayout.cancelled) return domainLayout;
    if (!domainLayoutChoices.includes(domainLayout.value)) return {invalid: true};
    const roots = parsePromptValue(await prompt({
        id: 'code-map-roots',
        description: 'Enter Repository-relative directories to document with Code Maps. Separate multiple roots with commas, or leave empty to disable Code Maps.',
        example: 'src, packages/app',
        message: 'Enter Code Map roots, or empty',
        choices: undefined,
    }), 'list');
    if (roots.cancelled) return roots;
    const includes = roots.value.length === 0
        ? {value: []}
        : parsePromptValue(await prompt({
            id: 'code-map-includes',
            description: 'Enter Repository-relative glob patterns for files included in Code Map coverage. Separate multiple globs with commas. * matches within one path segment, ? matches one character, and ** matches zero or more complete path segments.',
            example: 'src/**/*.ts, src/**/*.tsx',
            message: 'Enter Code Map include globs',
            choices: undefined,
        }), 'list');
    if (includes.cancelled) return includes;
    const excludes = roots.value.length === 0
        ? {value: []}
        : parsePromptValue(await prompt({
            id: 'code-map-excludes',
            description: 'Enter Repository-relative glob patterns removed after include matching. Separate multiple globs with commas, or leave empty to exclude nothing.',
            example: '**/*.test.ts, dist/**',
            message: 'Enter Code Map exclude globs, or empty',
            choices: undefined,
        }), 'list');
    if (excludes.cancelled) return excludes;
    return {
        profile: normalizeReplacementProfile({
            codeMaps: {excludes: excludes.value, includes: includes.value, roots: roots.value},
            domainLayout: domainLayout.value,
            platforms: platforms.value,
        }),
    };
};

const authorizeInteractive = async (/** @type {{operation: string, plan: WorkflowPlan, prompt?: WorkflowPrompt}} */ {operation, plan, prompt = defaultPrompt}) => {
    const init = operation === 'init';
    const answer = parsePromptValue(await prompt({
        id: 'confirm-plan',
        description: init
            ? 'Choose yes to apply the current workflow configuration and write the resulting managed files and arw-lock.json. Choose no or cancel to stop without applying.'
            : 'Choose yes to apply the canonical plan shown above and write the resulting managed files and arw-lock.json. Choose no or cancel to stop without applying.',
        message: init
            ? `Apply workflow configuration ${digest(plan.canonical).slice(0, 12)}`
            : `Apply canonical plan ${digest(plan.canonical).slice(0, 12)}`,
        choices: ['yes', 'no', 'cancel'],
    }), 'value');
    if (answer.cancelled || ['no', 'n'].includes(answer.value.toLowerCase())) return {authorized: false, cancelled: true};
    if (['yes', 'y'].includes(answer.value.toLowerCase())) return {authorized: true, cancelled: false};
    return {authorized: false, cancelled: false, invalid: true};
};

const collectInteractiveConditionalChoices = async (/** @type {{conditional: ConditionalChoices, operation: string, prompt?: WorkflowPrompt}} */ {conditional, operation, prompt = defaultPrompt}) => {
    const transformationCandidates = uniqueSorted((conditional?.transformationCandidates ?? []).map(entry => entry.path));
    const transformPaths = [];
    let transformAll = false;
    for (const path of transformationCandidates) {
        const answer = parsePromptValue(await prompt({
            id: `transform-existing-agent-doc:${path}`,
            description: `The existing ${path} is not managed by ARW. Choose yes to transform this file while preserving eligible Repository-owned text, no to leave it unchanged, all to transform this and every remaining candidate, or cancel to stop without applying.`,
            message: `Transform the existing agent document ${path}`,
            choices: ['yes', 'no', 'all', 'cancel'],
        }), 'value');
        if (answer.cancelled) return {cancelled: true};
        const normalized = answer.value.toLowerCase();
        if (normalized === 'no' || normalized === 'n') return {choices: {transformExistingAgentDocs: []}, rejected: true};
        if (normalized === 'all') {
            transformAll = true;
            break;
        }
        if (normalized === 'yes' || normalized === 'y') {
            transformPaths.push(path);
            continue;
        }
        return {invalid: true};
    }
    let orphanCodeMapReadmes;
    if (operation === 'init' && (conditional?.orphanCodeMapPaths ?? []).length > 0) {
        const paths = uniqueSorted(conditional.orphanCodeMapPaths);
        const answer = parsePromptValue(await prompt({
            id: 'orphan-code-map-readmes',
            description: 'These Code Map READMEs are outside the replacement Profile. Choose delete to remove them, demote to keep their prose without Code Map identity metadata, or cancel to stop without applying.',
            message: `Handle orphan Code Map READMEs (${paths.join(', ')})`,
            choices: ['delete', 'demote', 'cancel'],
        }), 'value');
        if (answer.cancelled) return {cancelled: true};
        if (!['delete', 'demote'].includes(answer.value.toLowerCase())) return {invalid: true};
        orphanCodeMapReadmes = answer.value.toLowerCase();
    }
    return {
        choices: {
            ...(transformationCandidates.length === 0 ? {} : {transformExistingAgentDocs: transformAll ? true : transformPaths}),
            ...(orphanCodeMapReadmes === undefined ? {} : {orphanCodeMapReadmes}),
        },
    };
};

const buildPostInitHandoff = async (/** @type {{filesystem: RepositoryFilesystem, profile: WorkflowProfile, repositoryRoot: string, repositoryStateInspector: RepositoryStateInspector}} */ {filesystem, profile, repositoryRoot, repositoryStateInspector}) => {
    const repositoryState = await repositoryStateInspector.inspect({
        repositoryLocation: repositoryRoot,
        request: {paths: [], roots: profile.codeMaps.roots},
    });
    const result = verifyCodeMaps(await inspectCodeMapCoverage({
        filesystem,
        policyAvailable: true,
        profile: profile.codeMaps,
        repositoryState,
    }));
    const gaps = result.missingReadmes;
    return {
        auditRequired: true,
        checklist: [
            'arw workflow verify',
            'arw code-map verify when Code Maps are configured',
            'arw text check',
            'arw terms check',
            'domain documents and durable terminology',
            'managed regions and semantic duplication',
            'replace Repository-owned rules that conflict with the current Workflow Distribution, then retain and apply non-conflicting Repository-owned rules',
            'validation coverage and Repository-owned commands',
            'writing rules, local-language filename choices, and Baseline exceptions',
            '.arwignore and Agent-managed Scope',
            'Artifact migration readiness',
        ],
        completionIssue: gaps.length === 0 ? null : {kind: 'repository-workflow-completion', paths: gaps},
        gaps,
    };
};

const planWithDiagnostics = (/** @type {{operation: string, plan: WorkflowPlan & {profile: WorkflowProfile}, diagnostics: Diagnostic[]}} */ {operation, plan, diagnostics}) => {
    const stableDiagnostics = sortDiagnostics(diagnostics);
    return {
        ...plan,
        canonical: canonicalPlan({diagnostics: stableDiagnostics, operation, operations: plan.operations, profile: plan.profile}),
        diagnostics: stableDiagnostics,
    };
};

const runInitOrUpdate = async (/** @type {WorkflowOptions} */ options) => {
    const {
        adapters = {
            codex: createCodexPlatformAdapter(),
            'claude-code': createClaudeCodePlatformAdapter(),
        },
        allowDirty = false,
        beforeApply,
        distribution,
        distributionDirectory,
        filesystem = createNodeRepositoryFilesystem(options.repositoryRoot),
        git = createNodeGitRunner(options.repositoryRoot),
        operation,
        orphanCodeMapReadmes,
        prompt,
        repositoryRoot,
        repositoryStateInspector = createWorkflowRepositoryStateInspector({filesystem, git, repositoryRoot}),
        transformExistingAgentDocs,
    } = options;
    const current = await repositoryStateInspector.inspect({
        repositoryLocation: repositoryRoot,
        request: {paths: [WORKFLOW_LOCK_PATH, '.arwignore', REPOSITORY_CONFIGURATION_PATH], roots: []},
    });
    const applicationConfiguration = inspectApplicationConfiguration({phase: 1, repositoryRoot, repositoryState: current});
    if (applicationConfiguration.diagnostics.length > 0) {
        return {applied: false, authorized: false, diagnostics: applicationConfiguration.diagnostics, plan: null};
    }
    if (operation === 'update' && !current.lock.lock) {
        const diagnostic = current.lock.diagnostic ?? createDiagnostic('workflow-uninitialized', 'Repository Workflow is not initialized; run arw workflow init.', {phase: 1});
        return {applied: false, authorized: false, diagnostics: [diagnostic], plan: null};
    }
    if (operation === 'init' && options.choices?.reuseProfile && !current.lock.lock) {
        return {
            applied: false,
            authorized: false,
            diagnostics: [createDiagnostic('workflow-uninitialized', 'Repository Workflow is not initialized; --reuse-profile cannot be used.', {phase: 1})],
            plan: null,
        };
    }
    const eligibility = checkPlannedGitPaths({allowDirty, allowedDirtyPaths: [REPOSITORY_CONFIGURATION_PATH], paths: [], repositoryState: current});
    if (!options.dryRun && eligibility.diagnostics.length > 0) {
        return {applied: false, authorized: false, diagnostics: eligibility.diagnostics, plan: null};
    }
    let profile;
    if (operation === 'update') profile = normalizeProfile(current.lock.lock?.profile ?? {codeMaps: {excludes: [], includes: [], roots: []}, domainLayout: 'single-context', platforms: []});
    else {
        const suppliedProfile = options.choices?.profile ?? current.lock.lock?.profile ?? {codeMaps: {excludes: [], includes: [], roots: []}, domainLayout: 'single-context', platforms: []};
        const normalizeSuppliedProfile = options.choices?.profile === undefined
            ? normalizeProfile
            : normalizeReplacementProfile;
        profile = normalizeSuppliedProfile({
            ...suppliedProfile,
            platforms: options.choices?.platforms ?? suppliedProfile.platforms,
        });
    }
    const selected = options.choices?.mode === 'interactive' && operation === 'init'
        ? await collectInteractiveProfile({currentProfile: current.lock.lock?.profile, prompt})
        : {profile};
    if ('cancelled' in selected && selected.cancelled) return {applied: false, authorized: false, cancelled: true, diagnostics: [], plan: null};
    if ('invalid' in selected && selected.invalid) return {
        applied: false,
        authorized: false,
        diagnostics: [createDiagnostic('invalid-conditional-choice', 'Conditional workflow choice is invalid.', {phase: 3})],
        plan: null,
    };
    if (!('profile' in selected) || selected.profile === undefined) throw new Error('Interactive workflow profile is unavailable.');
    profile = normalizeProfile(selected.profile);
    const profileDiagnostics = validateProfile(profile);
    if (profileDiagnostics.length > 0) {
        return {applied: false, authorized: false, diagnostics: profileDiagnostics, plan: null};
    }
    const targetDistribution = await loadWorkflowDistribution({distribution, distributionDirectory});
    if (targetDistribution.status !== 'succeeded') {
        const diagnostics = (targetDistribution.diagnostics ?? [
            {code: 'workflow-distribution-unavailable', message: 'The installed Workflow Distribution could not be loaded.'},
        ]).map(entry => ({...entry, phase: entry.phase ?? 2}));
        return {applied: false, authorized: false, diagnostics: sortDiagnostics(diagnostics), plan: null};
    }
    const interactive = options.choices?.mode === 'interactive' && !options.dryRun;
    const initial = await buildInitOrUpdatePlan({
        adapters,
        allowDirty,
        distribution: targetDistribution,
        filesystem,
        operation,
        orphanCodeMapReadmes: interactive ? undefined : orphanCodeMapReadmes,
        profile,
        repositoryRoot,
        repositoryStateInspector,
        transformExistingAgentDocs: interactive ? undefined : transformExistingAgentDocs,
    });
    if (initial.plan.diagnostics.length > 0) return {applied: false, authorized: false, diagnostics: initial.plan.diagnostics, plan: initial.plan};
    let selectedConditionalChoices = {
        ...(interactive ? {} : (transformExistingAgentDocs === undefined && initial.conditional.transformationCandidates.length > 0
            ? {transformExistingAgentDocs: undefined}
            : {transformExistingAgentDocs})),
        ...(interactive ? {} : {orphanCodeMapReadmes}),
    };
    /** @type {Diagnostic[]} */
    const missingConditionalDiagnostics = [];
    if (!interactive && initial.conditional.transformationCandidates.length > 0 && transformExistingAgentDocs === undefined) {
        missingConditionalDiagnostics.push(createDiagnostic('missing-existing-agent-document-choice', 'Existing agent document transformation requires an explicit choice.', {phase: 3, identity: 'transform-existing-agent-docs'}));
    }
    if (!interactive && initial.conditional.orphanCodeMapPaths.length > 0 && orphanCodeMapReadmes === undefined) {
        missingConditionalDiagnostics.push(createDiagnostic('missing-orphan-code-map-choice', 'Orphan Code Map README handling requires an explicit choice.', {phase: 3, identity: 'orphan-code-map-readmes'}));
    }
    if (missingConditionalDiagnostics.length > 0) {
        const plan = planWithDiagnostics({operation, plan: initial.plan, diagnostics: missingConditionalDiagnostics});
        return {applied: false, authorized: false, diagnostics: plan.diagnostics, plan};
    }
    if (interactive) {
        const selected = await collectInteractiveConditionalChoices({conditional: initial.conditional, operation, prompt});
        if ('cancelled' in selected && selected.cancelled) return {applied: false, authorized: false, cancelled: true, diagnostics: [], plan: initial.plan};
        if ('invalid' in selected && selected.invalid) return {applied: false, authorized: false, diagnostics: [createDiagnostic('invalid-conditional-choice', 'Conditional workflow choice is invalid.', {phase: 3})], plan: initial.plan};
        if (!('choices' in selected) || selected.choices === undefined) throw new Error('Interactive conditional choices are unavailable.');
        selectedConditionalChoices = selected.choices;
    }
    const first = await buildInitOrUpdatePlan({
        adapters,
        allowDirty,
        distribution: targetDistribution,
        filesystem,
        operation,
        orphanCodeMapReadmes: selectedConditionalChoices.orphanCodeMapReadmes,
        profile,
        repositoryRoot,
        repositoryStateInspector,
        transformExistingAgentDocs: selectedConditionalChoices.transformExistingAgentDocs,
    });
    if (first.plan.diagnostics.length > 0) return {applied: false, authorized: false, diagnostics: first.plan.diagnostics, plan: first.plan};
    if (interactive) {
        if (typeof options.showPlan === 'function') await options.showPlan(first.plan);
        const authorization = await authorizeInteractive({operation, plan: first.plan, prompt});
        if (authorization.invalid) {
            return {applied: false, authorized: false, diagnostics: [createDiagnostic('invalid-final-confirmation', 'Final plan confirmation must be yes, no, or cancel.', {phase: 3})], plan: first.plan};
        }
        if (!authorization.authorized) return {applied: false, authorized: false, cancelled: authorization.cancelled, diagnostics: [], plan: first.plan};
    }
    if (operation === 'update' && options.dryRun) return {applied: false, authorized: false, dryRun: true, diagnostics: [], plan: first.plan};
    if (typeof beforeApply === 'function') await beforeApply(first.plan);
    let second;
    try {
        second = await buildInitOrUpdatePlan({
            adapters,
            allowDirty,
            distribution: targetDistribution,
            filesystem,
            operation,
            orphanCodeMapReadmes: selectedConditionalChoices.orphanCodeMapReadmes,
            profile,
            repositoryRoot,
            repositoryStateInspector,
            transformExistingAgentDocs: selectedConditionalChoices.transformExistingAgentDocs,
        });
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ARW_REPOSITORY_STATE_UNSTABLE') return stateChangedAfterPreflight(first.plan);
        throw error;
    }
    if (second.plan.stateDigest !== first.plan.stateDigest || second.plan.canonical !== first.plan.canonical) {
        return stateChangedAfterPreflight(first.plan);
    }
    const applied = await applyOperations({filesystem, operations: first.plan.operations, repositoryRoot});
    if (!applied.applied) return {...applied, authorized: true, plan: first.plan};
    const verification = await finalVerify({
        configurationDefaults: second.results.flatMap(result => result.configurationDefaults ?? []),
        filesystem,
        operation,
        repositoryRoot,
        repositoryStateInspector,
    });
    const handoff = operation === 'init'
        ? await buildPostInitHandoff({filesystem, profile, repositoryRoot, repositoryStateInspector})
        : undefined;
    return {
        applied: true,
        authorized: true,
        diagnostics: verification.diagnostics,
        ...(handoff === undefined ? {} : {handoff}),
        ...(first.plan.migratedRuleDocuments.length === 0 ? {} : {migratedRuleDocuments: first.plan.migratedRuleDocuments}),
        plan: first.plan,
        verified: verification.satisfied,
    };
};

const runVerify = async (/** @type {WorkflowOptions & {filesystem: RepositoryFilesystem}} */ {
    adapters = {
        codex: createCodexPlatformAdapter(),
        'claude-code': createClaudeCodePlatformAdapter(),
    },
    distribution,
    distributionDirectory,
    filesystem,
    repositoryRoot,
    git = createNodeGitRunner(repositoryRoot),
    repositoryStateInspector = createWorkflowRepositoryStateInspector({filesystem, git, repositoryRoot}),
}) => {
    const state = await inspectCompleteRepositoryState({
        paths: [WORKFLOW_LOCK_PATH, '.arwignore', REPOSITORY_CONFIGURATION_PATH],
        repositoryRoot,
        repositoryStateInspector,
        roots: [],
    });
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    if (state.lock.diagnostic) diagnostics.push(state.lock.diagnostic);
    if (!state.lock.lock) diagnostics.push(createDiagnostic('workflow-uninitialized', 'Repository Workflow is not initialized; run arw workflow init.', {phase: 1}));
    if (state.policy.kind !== 'file') diagnostics.push(createDiagnostic('required-policy-missing', 'Required .arwignore policy file is missing.', {phase: 1, path: '.arwignore'}));
    else if (!verifyPolicyBytes(requireFileBytes(fileStateForPath({repositoryState: state, path: '.arwignore'}).bytes, '.arwignore'))) diagnostics.push(createDiagnostic('malformed-policy', '.arwignore is not valid text.', {phase: 1, path: '.arwignore'}));
    diagnostics.push(...inspectApplicationConfiguration({phase: 1, repositoryRoot, repositoryState: state}).diagnostics);
    if (state.lock.lock) {
        const profile = normalizeProfile(state.lock.lock.profile);
        const profileDiagnostics = validateProfile(profile);
        diagnostics.push(...profileDiagnostics);
        const verification = await verifyManagedContent({lock: state.lock.lock, repositoryRoot, repositoryState: state});
        diagnostics.push(...verification.diagnostics.map(entry => normalizeDiagnostic(entry, 3)));
        const policyAvailable = state.policy.kind === 'file'
            && verifyPolicyBytes(requireFileBytes(fileStateForPath({repositoryState: state, path: '.arwignore'}).bytes, '.arwignore'));
        if (profileDiagnostics.length === 0 && (profile.codeMaps.roots.length === 0 || policyAvailable)) {
            const codeMapVerification = await runCodeMapVerification({filesystem, git, repositoryRoot});
            diagnostics.push(...codeMapVerification.diagnostics.map(entry => ({...entry, phase: entry.phase ?? 3})));
        }

        if (profileDiagnostics.length === 0) {
            const targetDistribution = await loadWorkflowDistribution({distribution, distributionDirectory});
            if (targetDistribution.status !== 'succeeded') {
                diagnostics.push(...(targetDistribution.diagnostics ?? [{
                    code: 'workflow-distribution-unavailable',
                    message: 'The installed Workflow Distribution could not be loaded.',
                }]).map(entry => ({...entry, phase: entry.phase ?? 2})));
            } else {
                const results = await evaluatePlatforms({
                    adapters,
                    distribution: targetDistribution,
                    filesystem,
                    platforms: profile.platforms,
                    profile,
                });
                const composition = composePlatformResults(results);
                diagnostics.push(...composition.diagnostics.map(entry => ({...entry, phase: entry.phase ?? 2})));
                if (composition.authorized) {
                    const defaults = results.flatMap(result => result.configurationDefaults ?? []);
                    if (defaults.length > 0) {
                        const configurationState = await inspectCompleteRepositoryState({paths: defaults.map(target => target.path), roots: [], repositoryRoot, repositoryStateInspector});
                        for (const target of defaults) diagnostics.push(...inspectCodexConfiguration({target, state: configurationState, verify: true}).diagnostics);
                    }
                    for (const seed of composition.repositoryOwnedSeeds) {
                        if (seed.action === 'create' && seed.path !== '.arwignore') {
                            diagnostics.push(createDiagnostic(
                                'repository-owned-seed-missing',
                                'A repository-owned seed required by the selected projection is missing.',
                                {phase: 3, path: seed.path},
                            ));
                        }
                    }
                    try {
                        const expectedLock = buildWorkflowLock({
                            descriptors: buildTargetDescriptors(composition),
                            profile,
                            repositoryOwnedSeeds: composition.repositoryOwnedSeeds,
                        });
                        if (serializeWorkflowLock(expectedLock) !== serializeWorkflowLock(state.lock.lock)) {
                            diagnostics.push(createDiagnostic(
                                'workflow-projection-drift',
                                'The lock does not match the current installed Workflow Distribution and selected platform projection.',
                                {phase: 3, path: WORKFLOW_LOCK_PATH},
                            ));
                        }
                    } catch (error) {
                        diagnostics.push(createDiagnostic(
                            'invalid-workflow-lock-plan',
                            error instanceof Error ? error.message : String(error),
                            {phase: 3, path: WORKFLOW_LOCK_PATH},
                        ));
                    }
                }
            }
        }
    }
    const stableDiagnostics = sortDiagnostics(diagnostics);
    return {diagnostics: stableDiagnostics, satisfied: stableDiagnostics.length === 0};
};

const buildRemovalPlan = async (/** @type {{filesystem: RepositoryFilesystem, repositoryRoot: string, state: RepositoryState, choices?: Record<string, string>, requireChoices?: boolean}} */ {filesystem, repositoryRoot, state, choices = undefined, requireChoices = true}) => {
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    if (state.lock.diagnostic) diagnostics.push(state.lock.diagnostic);
    if (!state.lock.lock) diagnostics.push(createDiagnostic('workflow-uninitialized', 'Repository Workflow is not initialized; run arw workflow init.', {phase: 1}));
    const profile = state.lock.lock?.profile ?? {codeMaps: {roots: [], includes: [], excludes: []}, domainLayout: 'single-context', platforms: []};
    const categories = await removalCategories({filesystem, lock: state.lock.lock, profile, repositoryState: state});
    if (requireChoices) diagnostics.push(...validateRemovalChoices({categories, choices}));
    if (state.lock.lock) {
        const verification = await verifyManagedContent({lock: state.lock.lock, repositoryRoot, repositoryState: state});
        diagnostics.push(...verification.diagnostics.map(entry => normalizeDiagnostic(entry, 3)));
    }
    /** @type {FileOperation[]} */
    const operations = [];
    if (state.lock.lock && diagnostics.filter(entry => entry.code !== 'missing-removal-choice' && entry.code !== 'inapplicable-removal-choice').length === 0) {
        const mixedPaths = new Set(categories['mixed-agent-documents'].paths);
        for (const record of state.lock.lock.managedTargets) {
            const removal = mixedPaths.has(record.path) && choices?.['mixed-agent-documents'] === 'delete'
                ? {action: 'delete', bytes: null, path: record.path}
                : planOldRecordRemoval({repositoryState: state, record});
            if (removal.diagnostic) diagnostics.push(removal.diagnostic);
            else operations.push({action: removal.action, bytes: removal.bytes, path: removal.path});
        }
        if (choices?.['platform-agent-configs'] === 'delete') {
            for (const path of categories['platform-agent-configs'].paths) operations.push({action: 'delete', bytes: null, path});
        }
        if (choices?.arwignore === 'delete') {
            for (const path of categories.arwignore.paths) operations.push({action: 'delete', bytes: null, path});
        }
        if (choices?.['code-maps'] === 'delete') {
            for (const path of categories['code-maps'].paths) operations.push({action: 'delete', bytes: null, path});
        }
        operations.push({action: 'delete-lock', bytes: null, path: WORKFLOW_LOCK_PATH});
    }
    const sortedOperations = operations.map(entry => {
        const current = fileStateForPath({repositoryState: state, path: entry.path});
        return {
            ...entry,
            expected: current.observed.kind === 'file'
                ? {hash: digest(requireFileBytes(current.bytes, entry.path)), kind: 'file'}
                : {kind: 'missing'},
        };
    }).sort((left, right) => (
        (left.action === 'delete-lock' ? 1 : 0) - (right.action === 'delete-lock' ? 1 : 0)
        || compareText(left.path, right.path)
        || compareText(left.action, right.action)
    ));
    const gitResult = checkPlannedGitPaths({
        allowDirty: false,
        paths: sortedOperations.map(operation => operation.path),
        repositoryState: state,
    });
    diagnostics.push(...gitResult.diagnostics);
    const stableDiagnostics = sortDiagnostics(diagnostics);
    const observedPaths = uniqueSorted([
        ...state.lock.lock?.managedTargets.map(record => record.path) ?? [],
        ...REMOVAL_CATEGORIES.flatMap(category => categories[category].paths),
        WORKFLOW_LOCK_PATH,
    ]);
    /** @type {Record<string, {bytes: Buffer | null, kind: string}>} */
    const observedContent = {};
    const codeMapPaths = new Set(categories['code-maps'].paths);
    for (const path of observedPaths) {
        const current = codeMapPaths.has(path) || state.files[path] === undefined
            ? await readCurrentFrontmatterBytes({filesystem, path})
            : readCurrentBytes({repositoryState: state, path});
        observedContent[path] = {bytes: current.bytes, kind: current.observed.kind};
    }
    return {
        canonical: canonicalJson({
            categories: removalPreview({categories}),
            choices: choices ?? null,
            diagnostics: stableDiagnostics,
            operation: 'remove',
            operations: sortedOperations.map(entry => ({action: entry.action, path: entry.path})),
            profile,
        }),
        categories,
        diagnostics: stableDiagnostics,
        operations: sortedOperations,
        profile,
        preview: removalPreview({categories}),
        stateDigest: stable({categories, choices, git: gitResult.state, lock: state.lock.bytes, observedContent}),
    };
};

const runRemove = async (/** @type {WorkflowOptions} */ options) => {
    const filesystem = options.filesystem ?? createNodeRepositoryFilesystem(options.repositoryRoot);
    const git = options.git ?? createNodeGitRunner(options.repositoryRoot);
    const repositoryStateInspector = options.repositoryStateInspector
        ?? createWorkflowRepositoryStateInspector({filesystem, git, repositoryRoot: options.repositoryRoot});
    const state = await inspectCompleteRepositoryState({
        derivePaths: current => seedPathsFromLock(current.lock.lock),
        paths: [WORKFLOW_LOCK_PATH, '.arwignore'],
        repositoryRoot: options.repositoryRoot,
        repositoryStateInspector,
        roots: [],
    });
    const previewPlan = await buildRemovalPlan({filesystem, repositoryRoot: options.repositoryRoot, requireChoices: false, state});
    if (previewPlan.diagnostics.length > 0) return {applied: false, authorized: false, diagnostics: previewPlan.diagnostics, plan: previewPlan};
    if (typeof options.showRemovalPreview === 'function') await options.showRemovalPreview(previewPlan.preview);
    let removalChoices = options.choices?.removal;
    if (options.choices?.mode === 'interactive') {
        const selected = await collectInteractiveRemovalChoices({categories: previewPlan.categories, prompt: options.prompt});
        if ('cancelled' in selected && selected.cancelled) return {applied: false, authorized: false, cancelled: true, diagnostics: [], plan: previewPlan};
        if ('invalid' in selected && selected.invalid) return {applied: false, authorized: false, diagnostics: [createDiagnostic('invalid-removal-choice', 'Removal choice must be retain or delete.', {phase: 3})], plan: previewPlan};
        if (!('choices' in selected)) throw new Error('Interactive removal choices are unavailable.');
        removalChoices = selected.choices;
    }
    const observationRequest = {
        paths: uniqueSorted([
            ...state.lock.lock?.managedTargets.map(record => record.path) ?? [],
            ...REMOVAL_CATEGORIES.flatMap(category => previewPlan.categories[category].paths),
            WORKFLOW_LOCK_PATH,
        ]),
        roots: state.lock.lock?.profile.codeMaps.roots ?? [],
    };
    const finalState = await inspectCompleteRepositoryState({
        paths: observationRequest.paths,
        repositoryRoot: options.repositoryRoot,
        repositoryStateInspector,
        roots: observationRequest.roots,
    });
    const plan = await buildRemovalPlan({
        choices: removalChoices,
        filesystem,
        repositoryRoot: options.repositoryRoot,
        state: finalState,
    });
    if (plan.diagnostics.length > 0) return {applied: false, authorized: false, diagnostics: plan.diagnostics, plan};
    if (options.choices?.mode === 'interactive') {
        if (typeof options.showPlan === 'function') await options.showPlan(plan);
        const authorization = await authorizeInteractive({operation: 'remove', plan, prompt: options.prompt});
        if (authorization.invalid) {
            return {applied: false, authorized: false, diagnostics: [createDiagnostic('invalid-final-confirmation', 'Final plan confirmation must be yes, no, or cancel.', {phase: 3})], plan};
        }
        if (!authorization.authorized) return {applied: false, authorized: false, cancelled: authorization.cancelled, diagnostics: [], plan};
    }
    if (typeof options.beforeApply === 'function') await options.beforeApply(plan);
    let repeatedState;
    try {
        repeatedState = await inspectCompleteRepositoryState({
            paths: observationRequest.paths,
            repositoryRoot: options.repositoryRoot,
            repositoryStateInspector,
            roots: observationRequest.roots,
        });
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ARW_REPOSITORY_STATE_UNSTABLE') return stateChangedAfterPreflight(plan);
        throw error;
    }
    const repeated = await buildRemovalPlan({
        choices: removalChoices,
        filesystem,
        repositoryRoot: options.repositoryRoot,
        state: repeatedState,
    });
    if (repeated.stateDigest !== plan.stateDigest || repeated.canonical !== plan.canonical) {
        return stateChangedAfterPreflight(plan);
    }
    const applied = await applyOperations({filesystem, operations: plan.operations, repositoryRoot: options.repositoryRoot});
    if (!applied.applied) return {...applied, authorized: true, plan};
    const verification = await finalVerify({
        filesystem,
        operation: 'remove',
        repositoryRoot: options.repositoryRoot,
        repositoryStateInspector,
    });
    return {
        applied: true,
        authorized: true,
        diagnostics: verification.diagnostics,
        plan,
        verified: verification.satisfied,
    };
};

/**
 * Repository Workflow 公共 Module Interface 组合 Inspector, Verifier, Platform Adapter 和 Planner,
 * 并拥有授权, 应用与最终验证.
 */
export const runRepositoryWorkflow = async (/** @type {WorkflowOptions} */ options) => {
    if (!WORKFLOW_OPERATIONS.includes(options.operation)) throw new TypeError(`Unsupported workflow operation: ${options.operation}.`);
    const filesystem = options.filesystem ?? createNodeRepositoryFilesystem(options.repositoryRoot);
    try {
        if (options.operation === 'verify') return await runVerify({...options, filesystem});
        if (options.operation === 'remove') return await runRemove({...options, filesystem});
        return await runInitOrUpdate({...options, filesystem});
    } catch (error) {
        return {
            applied: false,
            authorized: false,
            diagnostics: [operationFailure(1, `${options.operation}-inspection`, '.', error)],
            plan: null,
        };
    }
};

export const createRepositoryWorkflow = (/** @type {Partial<WorkflowOptions>} */ dependencies) => ({
    run: (/** @type {WorkflowOptions} */ input) => runRepositoryWorkflow({...dependencies, ...input}),
    verify: (/** @type {WorkflowOptions & {filesystem: RepositoryFilesystem}} */ input) => runVerify({...dependencies, ...input}),
});
