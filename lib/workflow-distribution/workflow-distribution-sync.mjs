import {prepareCodexConfiguration} from '../arw-common/codex-configuration.mjs';
import {join} from 'node:path';

import {createScopedFilesystem, joinRelativePath} from '../common/filesystem.mjs';
import {createNodeGitRunner} from '../common/git-process.mjs';
import {compareText, digestJson, parseJsonText, serializeJson, sha256} from '../common/json.mjs';
import {
    analyzeSkillReferences,
    createClaudeCodePlatformAdapter,
    createCodexPlatformAdapter,
    validateProjectionConfig,
    validateSkillReferenceProjection,
} from '../arw-common/platform-adapter.mjs';
import {parsePorcelainStatus} from '../arw-common/repository-state-inspector.mjs';
import {isSkillIdentity} from '../arw-common/skill-identity.mjs';
import {
    buildWorkflowDistribution,
    repositoryOwnedSeedPaths,
    validateDistributionConfig,
    validateWorkflowDistributionSeedInputs,
} from './workflow-distribution.mjs';
import {composePlatformResults} from '../repository-workflow/workflow.mjs';

/** @typedef {{blocking?: boolean, code: string, identity?: string, message: string, path?: string, phase?: number, platform?: string, relatedPath?: string}} Diagnostic */
/** @typedef {{kind: 'directory' | 'file' | 'link' | 'other', path: string}} FileEntry */
/** @typedef {{bytes: Buffer, path: string}} FilePayload */
/** @typedef {{entries: FileEntry[], files: FilePayload[]}} FileTree */
/** @typedef {{kind: 'copy' | 'managed', sourcePath: string, targetPath: string}} DistributionSource */
/** @typedef {{hash?: string, kind: string, path: string}} SnapshotRecord */
/** @typedef {{column: number, context?: string, identity: string, line: number, path: string}} SkillNormalization */
/** @typedef {{additionalSkillReferences: string[], additionalSkillReferencesHash: string, skillReferenceNormalizations: SkillNormalization[], skillReferenceNormalizationsHash: string, status: 'succeeded'}} SkillReview */
/** @typedef {{additionalSkillReferences?: readonly string[], skillReferenceNormalizations?: readonly SkillNormalization[], status: string}} SkillAnalysis */
/** @typedef {{repositoryOwnedSeeds: string[], [key: string]: unknown}} DistributionConfig */
/** @typedef {{platforms: Record<string, {targets: {skills: string}, [key: string]: unknown}>, skills: {additionalSkillReferences: readonly string[], skillReferenceNormalizations: readonly SkillNormalization[], [key: string]: unknown}, [key: string]: unknown}} ProjectionConfig */
/** @typedef {{diagnostics: Diagnostic[], stage?: string, status: 'blocked' | 'failed'}} FilesystemUnsuccessful */
/** @typedef {{bytes: Buffer, diagnostics: Diagnostic[], status: 'succeeded'}} FilesystemReadSuccess */
/** @typedef {{diagnostics: Diagnostic[], entries: FileEntry[], status: 'succeeded'}} FilesystemListSuccess */
/** @typedef {{diagnostics: Diagnostic[], status: 'succeeded'}} FilesystemMutationSuccess */
/** @typedef {{root: string, inspect: (input: {path: string}) => Promise<unknown>, read: (input: {path: string}) => Promise<FilesystemUnsuccessful | FilesystemReadSuccess>, list: (input: {path: string, recursive?: boolean}) => Promise<FilesystemUnsuccessful | FilesystemListSuccess>, createDirectory: (input: {path: string, recursive?: boolean}) => Promise<FilesystemUnsuccessful | FilesystemMutationSuccess>, write: (input: {bytes: Buffer, mode: 'create' | 'replace', path: string}) => Promise<FilesystemUnsuccessful | FilesystemMutationSuccess>, remove: (input: {path: string, recursive?: boolean}) => Promise<FilesystemUnsuccessful | FilesystemMutationSuccess>}} ScopedFilesystem */
/** @typedef {{inspect: (paths: string[]) => Promise<SyncUnsuccessful | {diagnostics: Diagnostic[], status: 'succeeded'}>}} SyncStateAdapter */
/** @typedef {{code: number | null, failure: 'process' | 'timeout' | null, stderr: string, stdout: Buffer}} GitProcessResult */
/** @typedef {{run: (input: {argv: string[]}) => Promise<GitProcessResult>}} GitRunner */
/** @typedef {{diagnostics: Diagnostic[], status: 'blocked'} | {diagnostics: Diagnostic[], stage?: string, status: 'failed'}} SyncUnsuccessful */
/** @typedef {{entries: FileEntry[], files: FilePayload[], status: 'succeeded'}} ReadTreeSuccess */
/** @typedef {{entries: FileEntry[], payload: FilePayload[], sources: DistributionSource[], status: 'succeeded'}} SkillSourcesSuccess */
/** @typedef {{inputRecords: SnapshotRecord[], skillPayload: FilePayload[], sources: DistributionSource[], status: 'succeeded'}} ActualSourcesSuccess */
/** @typedef {{configurationBytes: Buffer, distributionConfig: DistributionConfig, exactFileSeedPaths: string[], projectionBytes: Buffer, projectionConfig: ProjectionConfig, seedEntries: FileEntry[], seedPayload: FilePayload[], seedRecords: SnapshotRecord[], status: 'succeeded'}} DistributionInputsSuccess */
/** @typedef {{actual: ActualSourcesSuccess, cleanupEntries: FileEntry[], distribution: DistributionInputsSuccess, filesystem: ScopedFilesystem, status: 'succeeded'}} CommonInputSuccess */
/** @typedef {{buildDistribution: typeof buildWorkflowDistribution, createFilesystem: typeof createScopedFilesystem, repositoryRoot: string, review: SkillReview, stateAdapter: SyncStateAdapter}} SyncBinding */
/** @typedef {{diagnostics: Diagnostic[], planDigest: string, status: 'succeeded', [key: symbol]: SyncBinding | undefined}} SyncPlan */
/** @typedef {SyncUnsuccessful | {diagnostics: Diagnostic[], status: 'succeeded'}} SyncMutationResult */
/** @typedef {{context: {input: CommonInputSuccess, projectionConfig: ProjectionConfig}, result: SyncPlan} | {result: SyncUnsuccessful}} PreparedSyncContext */

const PLAN_BINDING = Symbol('workflow-distribution-sync-plan');
const MANAGED_START = '<!-- arw:managed:start -->';
const MANAGED_END = '<!-- arw:managed:end -->';
const REPOSITORY_START = '<!-- arw:repository-owned:start -->';
const REPOSITORY_END = '<!-- arw:repository-owned:end -->';

/** @param {Array<{code: string, message: string}>} diagnostics @param {string} path */
const configurationParseDiagnostics = (diagnostics, path) => diagnostics.map(entry => ({
    ...entry,
    code: entry.code === 'json-invalid-utf8'
        ? 'invalid-utf8'
        : entry.code === 'json-bom' ? 'utf8-bom' : entry.code,
    path,
}));

const diagnostic = (/** @type {string} */ code, /** @type {string} */ message, /** @type {Omit<Diagnostic, 'code' | 'message'>} */ fields = {}) => ({code, message, ...fields});

const sortDiagnostics = (/** @type {Diagnostic[]} */ diagnostics) => diagnostics.sort((left, right) => (
    compareText(left.path ?? '', right.path ?? '')
    || compareText(left.code, right.code)
    || compareText(left.message, right.message)
));

/** @returns {{diagnostics: Diagnostic[], status: 'blocked'}} */
const blocked = (/** @type {Diagnostic[]} */ diagnostics) => ({diagnostics: sortDiagnostics(diagnostics), status: 'blocked'});

/** @returns {{diagnostics: Diagnostic[], stage: string, status: 'failed'}} */
const failedAfterDeletion = (/** @type {{diagnostics?: Diagnostic[]}} */ result, /** @type {string} */ stage) => ({
    diagnostics: sortDiagnostics(result.diagnostics ?? []),
    stage,
    status: 'failed',
});

const syncDiagnostics = (/** @type {Diagnostic[]} */ diagnostics) => diagnostics.map(({blocking: _blocking, phase: _phase, ...entry}) => entry);

const readFile = async (/** @type {ScopedFilesystem} */ filesystem, /** @type {string} */ path) => {
    const result = await filesystem.read({path});
    if (result.status === 'failed') return {...result, stage: result.stage ?? 'source-read'};
    if (result.status === 'succeeded' && result.bytes === undefined) throw new Error('Successful source read returned no bytes.');
    return result;
};

/** @returns {Promise<SyncUnsuccessful | ReadTreeSuccess>} */
const readFilesUnder = async (/** @type {{filesystem: ScopedFilesystem, root: string}} */ {filesystem, root}) => {
    const listed = await filesystem.list({path: root, recursive: true});
    if (listed.status !== 'succeeded') return listed.status === 'failed' ? {...listed, stage: listed.stage ?? 'source-enumeration'} : listed;
    /** @type {FilePayload[]} */
    const files = [];
    for (const entry of listed.entries ?? []) {
        if (entry.kind !== 'file') continue;
        const read = await readFile(filesystem, entry.path);
        if (read.status !== 'succeeded') return read;
        files.push({bytes: read.bytes, path: entry.path});
    }
    return {entries: listed.entries, files, status: 'succeeded'};
};

/** @returns {{status: 'succeeded', text: string} | {diagnostics: Diagnostic[], status: 'blocked'}} */
const decodeText = (/** @type {Buffer} */ bytes, /** @type {string} */ path) => {
    try {
        return {status: 'succeeded', text: new TextDecoder('utf-8', {fatal: true}).decode(bytes)};
    } catch {
        return blocked([diagnostic('sync-source-invalid-utf8', 'A required source document is not valid UTF-8.', {path})]);
    }
};

/** @returns {{span: string, status: 'succeeded'} | {diagnostics: Diagnostic[], status: 'blocked'}} */
const extractManagedSpan = (/** @type {{bytes: Buffer, path: string}} */ {bytes, path}) => {
    const decoded = decodeText(bytes, path);
    if (decoded.status !== 'succeeded') return decoded;
    const starts = [...decoded.text.matchAll(new RegExp(MANAGED_START, 'gu'))];
    const ends = [...decoded.text.matchAll(new RegExp(MANAGED_END, 'gu'))];
    if (starts.length !== 1 || ends.length !== 1 || starts[0].index >= ends[0].index) {
        return blocked([diagnostic('managed-region-invalid', 'A shared source document must contain one complete managed region.', {path})]);
    }
    return {
        span: decoded.text.slice(starts[0].index, ends[0].index + MANAGED_END.length),
        status: 'succeeded',
    };
};

const baselineDocument = (/** @type {string} */ span) => Buffer.from(
    `${span}\n${REPOSITORY_START}\nNone.\n${REPOSITORY_END}\n`,
    'utf8',
);

const directFiles = (/** @type {{files: FilePayload[], root: string}} */ {files, root}) => files.filter((/** @type {{ path: string; }} */ file) => {
    if (!file.path.startsWith(root)) return false;
    return !file.path.slice(root.length).includes('/');
});

/** @returns {Promise<SyncUnsuccessful | SkillSourcesSuccess>} */
const loadSkillSourcePayload = async (/** @type {ScopedFilesystem} */ filesystem) => {
    const skills = await readFilesUnder({filesystem, root: '.agents/skills'});
    if (skills.status !== 'succeeded') return skills;
    const sourceOnlyRoots = ['.agents/skills/reviewer-benchmark/', '.agents/skills/release/'];
    const distributed = (/** @type {{path: string}} */ entry) => !sourceOnlyRoots.some(root => entry.path.startsWith(root));
    const files = skills.files.filter(distributed);
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    /** @type {FilePayload[]} */
    const payload = [];
    /** @type {Set<string>} */
    const skillIdentities = new Set();
    for (const file of files) {
        const relativePath = file.path.slice('.agents/skills/'.length);
        const [identity, ...rest] = relativePath.split('/');
        if (!isSkillIdentity(identity) || rest.length === 0) {
            diagnostics.push(diagnostic('skill-source-path-invalid', 'Skill sources must use a valid direct package identity.', {path: file.path}));
            continue;
        }
        skillIdentities.add(identity);
        payload.push({bytes: file.bytes, path: joinRelativePath('skills', relativePath)});
    }
    if (skillIdentities.size === 0) {
        diagnostics.push(diagnostic('skill-source-empty', 'The actual Skill source tree must contain at least one package.', {path: '.agents/skills/'}));
    }
    /** @type {DistributionSource[]} */
    const sources = files.map(file => ({
        kind: 'copy',
        sourcePath: file.path,
        targetPath: joinRelativePath('distribution/skills', file.path.slice('.agents/skills/'.length)),
    }));
    return diagnostics.length > 0
        ? blocked(diagnostics)
        : {
            entries: skills.entries.filter(distributed),
            payload: payload.sort((left, right) => compareText(left.path, right.path)),
            sources: sources.sort((left, right) => compareText(left.targetPath, right.targetPath)),
            status: 'succeeded',
        };
};

const addFileSnapshot = (/** @type {Map<string, SnapshotRecord>} */ records, /** @type {FilePayload} */ file) => records.set(file.path, {
    hash: sha256(file.bytes),
    kind: 'file',
    path: file.path,
});

const addTreeSnapshot = (/** @type {Map<string, SnapshotRecord>} */ records, /** @type {FileTree} */ tree) => {
    const files = new Map(tree.files.map(file => [file.path, file]));
    for (const entry of tree.entries) {
        const file = files.get(entry.path);
        records.set(entry.path, file === undefined
            ? {kind: entry.kind, path: entry.path}
            : {hash: sha256(file.bytes), kind: 'file', path: file.path});
    }
};

const targetDiagnostics = (/** @type {DistributionSource[]} */ sources) => {
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    /** @type {Map<string, string>} */
    const targets = new Map();
    for (const source of sources) {
        const key = source.targetPath.toLowerCase();
        const previous = targets.get(key);
        if (previous !== undefined) {
            diagnostics.push(diagnostic(
                'sync-target-collision',
                'Multiple actual sources produce one Workflow Distribution path.',
                {path: source.targetPath, relatedPath: previous},
            ));
        } else {
            targets.set(key, source.targetPath);
        }
    }
    return diagnostics;
};

/** @returns {Promise<SyncUnsuccessful | ActualSourcesSuccess>} */
const loadActualSources = async (/** @type {ScopedFilesystem} */ filesystem) => {
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    /** @type {Map<string, SnapshotRecord>} */
    const inputRecords = new Map();
    /** @type {DistributionSource[]} */
    const sources = [];

    const rootAgents = await readFile(filesystem, 'AGENTS.md');
    if (rootAgents.status !== 'succeeded') return rootAgents;
    addFileSnapshot(inputRecords, {bytes: rootAgents.bytes, path: 'AGENTS.md'});
    const rootSpan = extractManagedSpan({bytes: rootAgents.bytes, path: 'AGENTS.md'});
    if (rootSpan.status !== 'succeeded') return rootSpan;
    sources.push({kind: 'managed', sourcePath: 'AGENTS.md', targetPath: 'distribution/baseline/AGENTS.md'});

    const agentDocuments = await readFilesUnder({filesystem, root: 'docs/agents'});
    if (agentDocuments.status !== 'succeeded') return agentDocuments;
    addTreeSnapshot(inputRecords, agentDocuments);
    const directAgentDocuments = directFiles({files: agentDocuments.files, root: 'docs/agents/'})
        .sort((left, right) => compareText(left.path, right.path));
    for (const file of directAgentDocuments) {
        if (!file.path.endsWith('.md')) continue;
        const decoded = decodeText(file.bytes, file.path);
        if (decoded.status !== 'succeeded') return decoded;
        const hasStart = decoded.text.includes(MANAGED_START);
        const hasEnd = decoded.text.includes(MANAGED_END);
        if (!hasStart && !hasEnd) continue;
        const span = extractManagedSpan({bytes: file.bytes, path: file.path});
        if (span.status !== 'succeeded') diagnostics.push(...span.diagnostics);
        else sources.push({kind: 'managed', sourcePath: file.path, targetPath: joinRelativePath('distribution/baseline', file.path)});
    }

    const roles = await readFilesUnder({filesystem, root: 'docs/agents/roles'});
    if (roles.status !== 'succeeded') return roles;
    addTreeSnapshot(inputRecords, roles);
    const rolesByPath = new Map(roles.files.map(file => [file.path, file]));
    const roleIdentities = new Set();
    const validRolePaths = new Set();
    for (const file of roles.files) {
        const relativePath = file.path.slice('docs/agents/roles/'.length);
        if (relativePath.includes('/')) continue;
        if (!relativePath.endsWith('.md')) {
            diagnostics.push(diagnostic('role-source-invalid', 'Role sources must use the canonical Role and on-demand Markdown layout.', {path: file.path}));
            continue;
        }
        const identity = relativePath.slice(0, -'.md'.length);
        if (!isSkillIdentity(identity)) {
            diagnostics.push(diagnostic('role-source-identity-invalid', 'A Role source has an invalid identity.', {identity, path: file.path}));
            continue;
        }
        roleIdentities.add(identity);
        validRolePaths.add(file.path);
    }
    for (const entry of roles.entries) {
        const relativePath = entry.path.slice('docs/agents/roles/'.length);
        const segments = relativePath.split('/');
        if (segments.length === 1) {
            if (entry.kind === 'directory') {
                if (!roleIdentities.has(relativePath)) {
                    diagnostics.push(diagnostic('role-source-invalid', 'Role sources must use the canonical Role and on-demand Markdown layout.', {path: entry.path}));
                }
                continue;
            }
            if (entry.kind === 'file') {
                if (validRolePaths.has(entry.path)) {
                    sources.push({kind: 'copy', sourcePath: entry.path, targetPath: joinRelativePath('distribution/baseline', entry.path)});
                }
                continue;
            }
            diagnostics.push(diagnostic('role-source-invalid', 'Role sources must use the canonical Role and on-demand Markdown layout.', {path: entry.path}));
            continue;
        }
        if (segments.length !== 2
            || !roleIdentities.has(segments[0])
            || entry.kind !== 'file'
            || !segments[1].endsWith('.md')) {
            diagnostics.push(diagnostic('role-source-invalid', 'Role sources must use the canonical Role and on-demand Markdown layout.', {path: entry.path}));
            continue;
        }
        if (rolesByPath.has(entry.path)) {
            sources.push({kind: 'copy', sourcePath: entry.path, targetPath: joinRelativePath('distribution/baseline', entry.path)});
        }
    }

    const licenses = await readFilesUnder({filesystem, root: 'docs/licenses/arw'});
    if (licenses.status !== 'succeeded') return licenses;
    addTreeSnapshot(inputRecords, licenses);
    const licensesByPath = new Map(licenses.files.map(file => [file.path, file]));
    for (const entry of licenses.entries) {
        const relativePath = entry.path.slice('docs/licenses/arw/'.length);
        if (relativePath.includes('/')) {
            diagnostics.push(diagnostic('license-source-invalid', 'ARW license sources must use direct LICENSE.<source-id> regular files.', {path: entry.path}));
            continue;
        }
        const sourceId = relativePath.startsWith('LICENSE.') ? relativePath.slice('LICENSE.'.length) : null;
        if (sourceId === null || !isSkillIdentity(sourceId)) continue;
        if (entry.kind !== 'file' || !licensesByPath.has(entry.path)) {
            diagnostics.push(diagnostic('license-source-invalid', 'ARW license sources must use direct LICENSE.<source-id> regular files.', {path: entry.path}));
            continue;
        }
        sources.push({kind: 'copy', sourcePath: entry.path, targetPath: joinRelativePath('distribution/baseline', entry.path)});
    }

    const skills = await loadSkillSourcePayload(filesystem);
    if (skills.status !== 'succeeded') return skills;
    addTreeSnapshot(inputRecords, {entries: skills.entries, files: skills.payload.map(file => ({
        bytes: file.bytes,
        path: joinRelativePath('.agents', file.path),
    }))});
    sources.push(...skills.sources);
    diagnostics.push(...targetDiagnostics(sources));
    if (diagnostics.length > 0) return blocked(diagnostics);
    return {
        inputRecords: [...inputRecords.values()].sort((left, right) => compareText(left.path, right.path)),
        skillPayload: skills.payload,
        sources: sources.sort((left, right) => compareText(left.targetPath, right.targetPath)),
        status: 'succeeded',
    };
};

/** @returns {Promise<SyncUnsuccessful | DistributionInputsSuccess>} */
const loadDistributionInputs = async (/** @type {ScopedFilesystem} */ filesystem) => {
    const configuration = await readFile(filesystem, 'distribution/config.json');
    if (configuration.status !== 'succeeded') return configuration;
    const configurationParsed = parseJsonText(configuration.bytes);
    if (configurationParsed.status !== 'succeeded') {
        return blocked(configurationParseDiagnostics(configurationParsed.diagnostics, 'distribution/config.json'));
    }
    if (!('value' in configurationParsed)) throw new Error('Successful Distribution configuration parse returned no value.');
    const configurationDiagnostics = validateDistributionConfig(configurationParsed.value);
    if (configurationDiagnostics.length > 0) {
        return blocked(configurationDiagnostics.map(entry => ({...entry, path: 'distribution/config.json'})));
    }
    const projection = await readFile(filesystem, 'distribution/projections/config.json');
    if (projection.status !== 'succeeded') return projection;
    const projectionParsed = parseJsonText(projection.bytes);
    if (projectionParsed.status !== 'succeeded') {
        return blocked(configurationParseDiagnostics(projectionParsed.diagnostics, 'distribution/projections/config.json'));
    }
    if (!('value' in projectionParsed)) throw new Error('Successful Projection configuration parse returned no value.');
    const projectionDiagnostics = validateProjectionConfig(projectionParsed.value);
    if (projectionDiagnostics.length > 0) {
        return blocked(projectionDiagnostics.map(entry => ({...entry, path: 'distribution/projections/config.json'})));
    }
    const codexDefaults = await readFile(filesystem, 'distribution/projections/codex/config.toml');
    if (codexDefaults.status !== 'succeeded') return codexDefaults;
    const checkedDefaults = prepareCodexConfiguration({sourceBytes: null, defaultBytes: codexDefaults.bytes});
    if (checkedDefaults.status !== 'succeeded') return blocked(checkedDefaults.diagnostics);
    const exactFileSeedPaths = configurationParsed.value.repositoryOwnedSeeds
        .filter((/** @type {string} */ path) => !path.endsWith('/'))
        .sort(compareText);
    /** @type {FilePayload[]} */
    const exactFileSeeds = [];
    for (const path of exactFileSeedPaths) {
        const seed = await readFile(filesystem, joinRelativePath('distribution/baseline', path));
        if (seed.status !== 'succeeded') return seed;
        exactFileSeeds.push({bytes: seed.bytes, path: joinRelativePath('baseline', path)});
    }
    /** @type {Map<string, SnapshotRecord>} */
    const seedRecords = new Map();
    addFileSnapshot(seedRecords, {bytes: codexDefaults.bytes, path: 'distribution/projections/codex/config.toml'});
    for (const seed of exactFileSeeds) {
        addFileSnapshot(seedRecords, {bytes: seed.bytes, path: joinRelativePath('distribution', seed.path)});
    }
    /** @type {FileEntry[]} */
    const exactFileSeedEntries = exactFileSeeds.map(seed => ({kind: 'file', path: seed.path}));
    return {
        configurationBytes: configuration.bytes,
        distributionConfig: configurationParsed.value,
        exactFileSeedPaths,
        projectionBytes: projection.bytes,
        projectionConfig: projectionParsed.value,
        seedEntries: [
            {kind: 'file', path: 'projections/codex/config.toml'},
            ...exactFileSeedEntries,
        ],
        seedPayload: [
            {bytes: codexDefaults.bytes, path: 'projections/codex/config.toml'},
            ...exactFileSeeds,
        ],
        seedRecords: [...seedRecords.values()].sort((left, right) => compareText(left.path, right.path)),
        status: 'succeeded',
    };
};

const cleanStateDiagnostics = (/** @type {Array<{code: string, path: string}>} */ entries) => entries
    .filter((/** @type {{ code: string | string[]; }} */ entry) => entry.code === '??' || entry.code[1] !== ' ')
    .map(entry => diagnostic('sync-input-dirty', 'A sync input path has unstaged or untracked content.', {path: entry.path}));

export const createSourceCheckoutSyncStateAdapter = (/** @type {string} */ repositoryRoot, /** @type {{git?: GitRunner}} */ {
    git = createNodeGitRunner(repositoryRoot),
} = {}) => {
    return {
        /**
         * @param {string[]} paths
         * @returns {Promise<SyncUnsuccessful | {diagnostics: Diagnostic[], status: 'succeeded'}>}
         */
        async inspect(paths) {
            const result = await git.run({
                argv: ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--', ...paths],
            });
            if (result.failure !== null || result.code !== 0) {
                return {
                    diagnostics: [diagnostic('sync-git-state-failed', 'Git state for sync inputs could not be read.')],
                    stage: 'git-state',
                    status: 'failed',
                };
            }
            const diagnostics = cleanStateDiagnostics(parsePorcelainStatus(result.stdout));
            return diagnostics.length === 0 ? {diagnostics: [], status: 'succeeded'} : blocked(diagnostics);
        },
    };
};

const compactJsonLine = (/** @type {unknown} */ value) => {
    const serialized = serializeJson(value, {format: 'compact'});
    if (serialized.status !== 'succeeded') throw new TypeError('Workflow Distribution review record must be JSON serializable.');
    return serialized.bytes.toString('utf8');
};

const reviewLines = (/** @type {SkillReview} */ review) => ({
    additional: review.additionalSkillReferences,
    normalizations: review.skillReferenceNormalizations.map(record => compactJsonLine({
        path: record.path,
        line: record.line,
        column: record.column,
        identity: record.identity,
        context: record.context,
    })),
});

const linesBytes = (/** @type {string[]} */ lines) => Buffer.from(lines.length === 0 ? '' : `${lines.join('\n')}\n`, 'utf8');

/** @template T @param {readonly T[]} selected @param {readonly T[]} candidates @param {(left: T, right: T) => boolean} [same] */
const subsequence = (selected, candidates, same = (left, right) => left === right) => {
    let cursor = 0;
    for (const value of selected) {
        while (cursor < candidates.length && !same(value, candidates[cursor])) cursor += 1;
        if (cursor >= candidates.length) return false;
        cursor += 1;
    }
    return true;
};

const normalizationSame = (/** @type {SkillNormalization} */ left, /** @type {SkillNormalization} */ right) => left.path === right.path
    && left.line === right.line
    && left.column === right.column
    && left.identity === right.identity
    && left.context === right.context;

const validateReviewResult = (/** @type {{analysis: SkillAnalysis, review: SkillReview}} */ {analysis, review}) => {
    if (review === null || typeof review !== 'object' || review.status !== 'succeeded'
        || !Array.isArray(review.additionalSkillReferences)
        || !Array.isArray(review.skillReferenceNormalizations)) {
        throw new TypeError('review must be a completed Skill reference review result.');
    }
    if (!Array.isArray(analysis.additionalSkillReferences) || !Array.isArray(analysis.skillReferenceNormalizations)) {
        throw new TypeError('analysis must be a completed Skill reference analysis result.');
    }
    const lines = reviewLines(review);
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    if (sha256(linesBytes(lines.additional)) !== review.additionalSkillReferencesHash
        || sha256(linesBytes(lines.normalizations)) !== review.skillReferenceNormalizationsHash) {
        diagnostics.push(diagnostic('sync-review-hash-invalid', 'The completed review hashes do not match its lists.'));
    }
    if (!subsequence(review.additionalSkillReferences, analysis.additionalSkillReferences)
        || !subsequence(review.skillReferenceNormalizations, analysis.skillReferenceNormalizations, normalizationSame)) {
        diagnostics.push(diagnostic('sync-review-candidates-invalid', 'The completed review is not a deletion-only subset of current candidates.'));
    }
    return diagnostics;
};

const reviewedProjectionConfig = (/** @type {{projectionConfig: ProjectionConfig, review: SkillReview}} */ {projectionConfig, review}) => ({
    ...projectionConfig,
    skills: {
        ...projectionConfig.skills,
        additionalSkillReferences: review.additionalSkillReferences,
        skillReferenceNormalizations: review.skillReferenceNormalizations.map(record => ({
            path: record.path,
            line: record.line,
            column: record.column,
            identity: record.identity,
        })),
    },
});

const ancestors = (/** @type {string} */ path) => {
    const segments = path.split('/');
    const values = [];
    for (let length = 1; length < segments.length; length += 1) {
        values.push(segments.slice(0, length).join('/'));
    }
    return values;
};

const pathKey = (/** @type {string} */ path) => path.toLowerCase();

const isSameOrDescendantPath = (/** @type {{path: string, root: string}} */ {path, root}) => {
    const foldedPath = pathKey(path);
    const foldedRoot = pathKey(root);
    return foldedPath === foldedRoot || foldedPath.startsWith(`${foldedRoot}/`);
};

const pathsOverlap = (/** @type {string} */ left, /** @type {string} */ right) => isSameOrDescendantPath({path: left, root: right})
    || isSameOrDescendantPath({path: right, root: left});

const generatedEntries = (/** @type {DistributionSource[]} */ sources) => {
    /** @type {Map<string, FileEntry>} */
    const entries = new Map();
    for (const source of sources) {
        const path = source.targetPath.slice('distribution/'.length);
        entries.set(path, {kind: 'file', path});
        for (const ancestor of ancestors(path)) {
            entries.set(ancestor, {kind: 'directory', path: ancestor});
        }
    }
    return [...entries.values()].sort((left, right) => compareText(left.path, right.path));
};

const protectedDistributionPaths = (/** @type {string[]} */ exactFileSeedPaths) => {
    const exact = new Set([
        'distribution/config.json',
        'distribution/projections',
        'distribution/projections/codex',
        'distribution/projections/config.json',
        'distribution/projections/codex/config.toml',
    ].map(pathKey));
    for (const path of exactFileSeedPaths.map(value => joinRelativePath('distribution/baseline', value))) {
        exact.add(pathKey(path));
        for (const ancestor of ancestors(path)) {
            if (ancestor !== 'distribution') exact.add(pathKey(ancestor));
        }
    }
    return exact;
};

const isProtectedDistributionPath = (/** @type {{exact: Set<string>, path: string}} */ {exact, path}) => exact.has(pathKey(path));

const protectedTargetDiagnostics = (/** @type {{exactFileSeedPaths: string[], sources: DistributionSource[]}} */ {exactFileSeedPaths, sources}) => {
    const protectedFiles = [
        'distribution/config.json',
        'distribution/projections/config.json',
        'distribution/projections/codex/config.toml',
        ...exactFileSeedPaths.map(path => joinRelativePath('distribution/baseline', path)),
    ];
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    for (const source of sources) {
        const collision = protectedFiles.find(path => pathsOverlap(source.targetPath, path));
        if (collision !== undefined) {
            diagnostics.push(diagnostic(
                'sync-protected-target-collision',
                'An actual source target collides with a protected Workflow Distribution path.',
                {path: source.targetPath, relatedPath: collision},
            ));
        }
    }
    return diagnostics;
};

/** @returns {Promise<SyncMutationResult>} */
const cleanupGeneratedRange = async (/** @type {{entries: FileEntry[], exactFileSeedPaths: string[], filesystem: ScopedFilesystem}} */ {entries, exactFileSeedPaths, filesystem}) => {
    const exact = protectedDistributionPaths(exactFileSeedPaths);
    const removable = entries
        .filter(entry => !isProtectedDistributionPath({exact, path: entry.path}))
        .sort((left, right) => right.path.split('/').length - left.path.split('/').length
            || compareText(right.path, left.path));
    for (const entry of removable) {
        const removed = await filesystem.remove({path: entry.path, recursive: entry.kind === 'directory'});
        if (removed.status !== 'succeeded') return failedAfterDeletion(removed, 'cleanup');
    }
    return {diagnostics: [], status: 'succeeded'};
};

/** @returns {{bytes: Buffer, status: 'succeeded'} | {diagnostics: Diagnostic[], status: 'blocked'}} */
const transformedSourceBytes = (/** @type {{bytes: Buffer, source: DistributionSource}} */ {bytes, source}) => {
    if (source.kind === 'copy') return {bytes, status: 'succeeded'};
    const span = extractManagedSpan({bytes, path: source.sourcePath});
    return span.status === 'succeeded'
        ? {bytes: baselineDocument(span.span), status: 'succeeded'}
        : span;
};

/** @returns {Promise<SyncMutationResult>} */
const writeActualSources = async (/** @type {{filesystem: ScopedFilesystem, sources: DistributionSource[]}} */ {filesystem, sources}) => {
    for (const source of sources) {
        const read = await readFile(filesystem, source.sourcePath);
        if (read.status !== 'succeeded') return failedAfterDeletion(read, 'source-read');
        const transformed = transformedSourceBytes({bytes: read.bytes, source});
        if (transformed.status !== 'succeeded') return failedAfterDeletion(transformed, 'source-transform');
        const written = await filesystem.write({bytes: transformed.bytes, mode: 'create', path: source.targetPath});
        if (written.status !== 'succeeded') return failedAfterDeletion(written, 'generated-write');
    }
    return {diagnostics: [], status: 'succeeded'};
};

/** @returns {Promise<SyncMutationResult>} */
const writeProjectionConfig = async (/** @type {{filesystem: ScopedFilesystem, projectionConfig: ProjectionConfig}} */ {filesystem, projectionConfig}) => {
    const serialized = serializeJson(projectionConfig);
    if (serialized.status !== 'succeeded') return failedAfterDeletion(serialized, 'projection-config-write');
    const written = await filesystem.write({
        bytes: serialized.bytes,
        mode: 'replace',
        path: 'distribution/projections/config.json',
    });
    return written.status === 'succeeded'
        ? {diagnostics: [], status: 'succeeded'}
        : failedAfterDeletion(written, 'projection-config-write');
};

/** @returns {Promise<SyncMutationResult>} */
const validateRebuiltDistribution = async (/** @type {{buildDistribution: typeof buildWorkflowDistribution, repositoryRoot: string}} */ {buildDistribution, repositoryRoot}) => {
    const distribution = await buildDistribution({distributionDirectory: join(repositoryRoot, 'distribution')});
    if (distribution.status !== 'succeeded') return failedAfterDeletion(distribution, 'final-validation');
    const seedPaths = repositoryOwnedSeedPaths({distributionConfig: distribution.distributionConfig, payload: distribution.payload});
    const results = [];
    for (const {adapter, platform} of [
        {adapter: createCodexPlatformAdapter(), platform: 'codex'},
        {adapter: createClaudeCodePlatformAdapter(), platform: 'claude-code'},
    ]) {
        const projection = adapter.evaluate({
            payload: distribution.payload,
            platform,
            profile: {platforms: [platform]},
            projectionConfig: distribution.projectionConfig,
            seedTargets: Object.fromEntries(seedPaths.map(path => [path, null])),
        });
        if (projection.status !== 'succeeded') return failedAfterDeletion(projection, 'final-validation');
        results.push({...projection, platform});
    }
    const composition = composePlatformResults(results);
    return composition.authorized
        ? {diagnostics: [], status: 'succeeded'}
        : failedAfterDeletion({diagnostics: syncDiagnostics(composition.diagnostics)}, 'final-validation');
};

/** @returns {Promise<SyncUnsuccessful | CommonInputSuccess>} */
const commonInput = async (/** @type {{createFilesystem: typeof createScopedFilesystem, repositoryRoot: string, stateAdapter: SyncStateAdapter}} */ {createFilesystem, repositoryRoot, stateAdapter}) => {
    const state = await stateAdapter.inspect([
        '.agents/skills',
        'AGENTS.md',
        'docs/agents',
        'docs/licenses/arw',
        'distribution',
    ]);
    if (state.status !== 'succeeded') return state;
    const created = await createFilesystem({createRoot: false, root: repositoryRoot});
    if (created.status !== 'succeeded') return created;
    const filesystem = created.scopedFilesystem;
    const actual = await loadActualSources(filesystem);
    if (actual.status !== 'succeeded') return actual;
    const distribution = await loadDistributionInputs(filesystem);
    if (distribution.status !== 'succeeded') return distribution;
    const targetConflicts = protectedTargetDiagnostics({
        exactFileSeedPaths: distribution.exactFileSeedPaths,
        sources: actual.sources,
    });
    if (targetConflicts.length > 0) return blocked(targetConflicts);
    const seedDiagnostics = validateWorkflowDistributionSeedInputs({
        distributionConfig: distribution.distributionConfig,
        entries: [...generatedEntries(actual.sources), ...distribution.seedEntries],
        payloadByPath: new Map(distribution.seedPayload.map(entry => [entry.path, entry.bytes])),
        projectionConfig: distribution.projectionConfig,
    });
    if (seedDiagnostics.length > 0) return blocked(seedDiagnostics);
    const listed = await filesystem.list({path: 'distribution', recursive: true});
    if (listed.status !== 'succeeded') return listed.status === 'failed'
        ? {...listed, stage: listed.stage ?? 'distribution-enumeration'}
        : listed;
    return {actual, cleanupEntries: listed.entries, distribution, filesystem, status: 'succeeded'};
};

export const prepareWorkflowDistributionReview = async (/** @type {{createFilesystem?: typeof createScopedFilesystem, repositoryRoot: string, stateAdapter?: SyncStateAdapter}} */ {
    createFilesystem = createScopedFilesystem,
    repositoryRoot,
    stateAdapter = createSourceCheckoutSyncStateAdapter(repositoryRoot),
}) => {
    const state = await stateAdapter.inspect(['.agents/skills', 'distribution/projections/config.json']);
    if (state.status !== 'succeeded') return state;
    const created = await createFilesystem({createRoot: false, root: repositoryRoot});
    if (created.status !== 'succeeded') return created;
    const filesystem = created.scopedFilesystem;
    const skills = await loadSkillSourcePayload(filesystem);
    if (skills.status !== 'succeeded') return skills;
    const projection = await readFile(filesystem, 'distribution/projections/config.json');
    if (projection.status !== 'succeeded') return projection;
    const parsed = parseJsonText(projection.bytes);
    if (parsed.status !== 'succeeded') {
        return blocked(configurationParseDiagnostics(parsed.diagnostics, 'distribution/projections/config.json'));
    }
    if (!('value' in parsed)) throw new Error('Successful Projection configuration parse returned no value.');
    return analyzeSkillReferences({payload: skills.payload, projectionConfig: parsed.value});
};

/** @returns {Promise<PreparedSyncContext>} */
const prepareSyncContext = async (/** @type {SyncBinding} */ {
    createFilesystem = createScopedFilesystem,
    repositoryRoot,
    review,
    stateAdapter = createSourceCheckoutSyncStateAdapter(repositoryRoot),
}) => {
    const input = await commonInput({createFilesystem, repositoryRoot, stateAdapter});
    if (input.status !== 'succeeded') return {result: input};
    const analysis = analyzeSkillReferences({
        payload: input.actual.skillPayload,
        projectionConfig: input.distribution.projectionConfig,
    });
    if (analysis.status !== 'succeeded') return {result: analysis};
    const diagnostics = validateReviewResult({analysis, review});
    if (diagnostics.length > 0) return {result: blocked(diagnostics)};

    const projectionConfig = reviewedProjectionConfig({
        projectionConfig: input.distribution.projectionConfig,
        review,
    });
    const referenceValidation = validateSkillReferenceProjection({
        payload: input.actual.skillPayload,
        projectionConfig,
    });
    if (referenceValidation.status !== 'succeeded') return {result: referenceValidation};
    const lines = reviewLines(review);
    const planDigest = digestJson({
        actualInputs: input.actual.inputRecords,
        configurations: [
            {hash: sha256(input.distribution.configurationBytes), path: 'distribution/config.json'},
            {hash: sha256(input.distribution.projectionBytes), path: 'distribution/projections/config.json'},
        ],
        fixedRebuildRange: {
            preserved: [
                'distribution/config.json',
                'distribution/projections/config.json',
                'distribution/projections/codex/config.toml',
                ...input.distribution.exactFileSeedPaths.map(path => joinRelativePath('distribution/baseline', path)),
            ].sort(compareText),
            root: 'distribution/',
        },
        generatedTargets: input.actual.sources.map(source => source.targetPath),
        review: {
            additionalSkillReferences: lines.additional,
            additionalSkillReferencesHash: review.additionalSkillReferencesHash,
            skillReferenceNormalizations: lines.normalizations,
            skillReferenceNormalizationsHash: review.skillReferenceNormalizationsHash,
        },
        seeds: input.distribution.seedRecords,
    });
    /** @type {SyncPlan} */
    const result = {
        diagnostics: [],
        planDigest,
        status: 'succeeded',
    };
    return {context: {input, projectionConfig}, result};
};

/** @returns {Promise<SyncUnsuccessful | SyncPlan>} */
export const prepareWorkflowDistributionSync = async (/** @type {{buildDistribution?: typeof buildWorkflowDistribution, createFilesystem?: typeof createScopedFilesystem, repositoryRoot: string, review: SkillReview, stateAdapter?: SyncStateAdapter}} */ {
    buildDistribution = buildWorkflowDistribution,
    createFilesystem = createScopedFilesystem,
    repositoryRoot,
    review,
    stateAdapter = createSourceCheckoutSyncStateAdapter(repositoryRoot),
}) => {
    const binding = {buildDistribution, createFilesystem, repositoryRoot, review, stateAdapter};
    const prepared = await prepareSyncContext(binding);
    if (prepared.result.status !== 'succeeded') return prepared.result;
    if (!('planDigest' in prepared.result)) throw new Error('Successful sync preparation returned no plan digest.');
    const result = prepared.result;
    Object.defineProperty(result, PLAN_BINDING, {
        value: binding,
    });
    return result;
};

/** @returns {Promise<SyncUnsuccessful | {diagnostics: Diagnostic[], status: 'succeeded'}>} */
export const applyWorkflowDistributionSync = async (/** @type {{authorization: {approved?: boolean, planDigest?: string} | null, plan: SyncPlan | null}} */ {authorization, plan}) => {
    if (plan === null || typeof plan !== 'object' || plan.status !== 'succeeded' || plan[PLAN_BINDING] === undefined) {
        throw new TypeError('plan must be an original successful sync prepare result.');
    }
    const binding = plan[PLAN_BINDING];
    if (binding === undefined) throw new TypeError('plan must retain its original sync binding.');
    if (authorization === null
        || typeof authorization !== 'object'
        || authorization.approved !== true
        || authorization.planDigest !== plan.planDigest) {
        return blocked([diagnostic('sync-authorization-invalid', 'User authorization does not match the current sync plan.')]);
    }
    const current = await prepareSyncContext(binding);
    if (current.result.status !== 'succeeded') return current.result;
    if (!('planDigest' in current.result) || !('context' in current) || current.context === undefined) {
        throw new Error('Successful sync re-preparation returned no context.');
    }
    if (current.result.planDigest !== plan.planDigest) {
        return blocked([diagnostic('sync-plan-changed', 'Sync inputs changed after the authorized plan was prepared.')]);
    }
    const {input, projectionConfig} = current.context;
    const cleanup = await cleanupGeneratedRange({
        entries: input.cleanupEntries,
        exactFileSeedPaths: input.distribution.exactFileSeedPaths,
        filesystem: input.filesystem,
    });
    if (cleanup.status !== 'succeeded') return cleanup;
    const copied = await writeActualSources({filesystem: input.filesystem, sources: input.actual.sources});
    if (copied.status !== 'succeeded') return copied;
    const configured = await writeProjectionConfig({filesystem: input.filesystem, projectionConfig});
    if (configured.status !== 'succeeded') return configured;
    const validated = await validateRebuiltDistribution({
        buildDistribution: binding.buildDistribution,
        repositoryRoot: binding.repositoryRoot,
    });
    return validated.status === 'succeeded'
        ? {diagnostics: [], status: 'succeeded'}
        : validated;
};
