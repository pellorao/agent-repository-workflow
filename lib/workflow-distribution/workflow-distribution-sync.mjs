import {prepareCodexConfiguration} from '../arw-common/codex-configuration.mjs';
import {join} from 'node:path';

import {createScopedFilesystem, joinRelativePath} from '../common/filesystem.mjs';
import {createNodeGitRunner} from '../common/git-process.mjs';
import {compareText, parseJsonText} from '../common/json.mjs';
import {
    analyzeSkillReferences,
    createClaudeCodePlatformAdapter,
    createCodexPlatformAdapter,
    validateProjectionConfig,
} from '../arw-common/platform-adapter.mjs';
import {parsePorcelainStatus} from '../arw-common/repository-state-inspector.mjs';
import {isSkillIdentity} from '../arw-common/skill-identity.mjs';
import {
    buildWorkflowDistribution,
    sortDiagnostics,
    repositoryOwnedSeedPaths,
    skillRegistrationDiagnostics,
    validateDistributionConfig,
    validateWorkflowDistributionSeedInputs,
} from './workflow-distribution.mjs';
import {composePlatformResults} from '../repository-workflow/workflow.mjs';

/** @typedef {{blocking?: boolean, code: string, column?: number, line?: number, identity?: string, message: string, path?: string, phase?: number, platform?: string, relatedPath?: string}} Diagnostic */
/** @typedef {{kind: 'directory' | 'file' | 'link' | 'other', path: string}} FileEntry */
/** @typedef {{bytes: Buffer, path: string}} FilePayload */
/** @typedef {{bytes: Buffer, targetPath: string}} DistributionSource */
/** @typedef {import('./workflow-distribution.mjs').DistributionConfiguration} DistributionConfig */
/** @typedef {{platforms: Record<string, {targets: {skills: string}, [key: string]: unknown}>, [key: string]: unknown}} ProjectionConfig */
/** @typedef {{diagnostics: Diagnostic[], stage?: string, status: 'blocked' | 'failed'}} FilesystemUnsuccessful */
/** @typedef {{bytes: Buffer, diagnostics: Diagnostic[], status: 'succeeded'}} FilesystemReadSuccess */
/** @typedef {{diagnostics: Diagnostic[], entries: FileEntry[], status: 'succeeded'}} FilesystemListSuccess */
/** @typedef {{diagnostics: Diagnostic[], status: 'succeeded'}} FilesystemMutationSuccess */
/** @typedef {{root: string, inspect: (input: {path: string}) => Promise<unknown>, read: (input: {path: string}) => Promise<FilesystemUnsuccessful | FilesystemReadSuccess>, list: (input: {path: string, recursive?: boolean}) => Promise<FilesystemUnsuccessful | FilesystemListSuccess>, createDirectory: (input: {path: string, recursive?: boolean}) => Promise<FilesystemUnsuccessful | FilesystemMutationSuccess>, write: (input: {bytes: Buffer, mode: 'create' | 'replace', path: string}) => Promise<FilesystemUnsuccessful | FilesystemMutationSuccess>, remove: (input: {path: string, recursive?: boolean}) => Promise<FilesystemUnsuccessful | FilesystemMutationSuccess>}} ScopedFilesystem */
/** @typedef {{inspect: (paths: string[]) => Promise<SyncUnsuccessful | {diagnostics: Diagnostic[], status: 'succeeded'}>}} SyncStateAdapter */
/** @typedef {import('../common/git-process.mjs').GitProcessResult} GitProcessResult */
/** @typedef {{run: (input: {argv: string[]}) => Promise<GitProcessResult>}} GitRunner */
/** @typedef {{diagnostics: Diagnostic[], status: 'blocked'} | {diagnostics: Diagnostic[], stage?: string, status: 'failed'}} SyncUnsuccessful */
/** @typedef {SyncUnsuccessful | {diagnostics: Diagnostic[], status: 'succeeded'}} SyncMutationResult */
/** @typedef {{skillPayload: FilePayload[], sources: DistributionSource[], status: 'succeeded'}} ActualSourcesSuccess */
/** @typedef {{distributionConfig: DistributionConfig, exactFileSeedPaths: string[], projectionConfig: ProjectionConfig, seedEntries: FileEntry[], seedPayload: FilePayload[], status: 'succeeded'}} DistributionInputsSuccess */
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
    if (result.status === 'failed') return {...result, stage: 'source-read'};
    return result;
};

/** @returns {Promise<SyncUnsuccessful | {entries: FileEntry[], files: FilePayload[], status: 'succeeded'}>} */
const readFilesUnder = async (/** @type {{filesystem: ScopedFilesystem, root: string}} */ {filesystem, root}) => {
    const listed = await filesystem.list({path: root, recursive: true});
    if (listed.status !== 'succeeded') return listed.status === 'failed' ? {...listed, stage: 'source-enumeration'} : listed;
    /** @type {FilePayload[]} */
    const files = [];
    for (const entry of listed.entries ?? []) {
        if (entry.kind === 'link') return blocked([diagnostic('filesystem-link-unsupported', 'Symbolic links and directory junctions are not supported.', {path: entry.path})]);
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

/** Checks that every Skill under .agents/skills is registered exactly once; shared by sync and the production check. @returns {Promise<SyncUnsuccessful | {diagnostics: Diagnostic[], status: 'succeeded'}>} */
export const checkSkillRegistration = async (/** @type {{distributionConfig: DistributionConfig, filesystem: ScopedFilesystem}} */ {distributionConfig, filesystem}) => {
    const listed = await filesystem.list({path: '.agents/skills', recursive: true});
    if (listed.status !== 'succeeded') return listed.status === 'failed' ? {...listed, stage: 'source-enumeration'} : listed;
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    /** @type {Set<string>} */
    const skillNames = new Set();
    for (const entry of listed.entries) {
        const [name, ...rest] = entry.path.slice('.agents/skills/'.length).split('/');
        if (entry.kind === 'link') diagnostics.push(diagnostic('filesystem-link-unsupported', 'Symbolic links and directory junctions are not supported.', {path: entry.path}));
        else if (rest.length === 0 && entry.kind !== 'directory') diagnostics.push(diagnostic('skill-source-path-invalid', 'Skill sources must use a valid direct package identity.', {path: entry.path}));
        else if (entry.kind === 'file' && rest.length > 0) skillNames.add(name);
    }
    diagnostics.push(...skillRegistrationDiagnostics({distributionConfig, skillNames: [...skillNames]}));
    return diagnostics.length > 0 ? blocked(diagnostics) : {diagnostics: [], status: 'succeeded'};
};

/** @returns {Promise<SyncUnsuccessful | {payload: FilePayload[], sources: DistributionSource[], status: 'succeeded'}>} */
const loadSkillSourcePayload = async (/** @type {ScopedFilesystem} */ filesystem, /** @type {string[]} */ distributedSkills) => {
    const skills = await readFilesUnder({filesystem, root: '.agents/skills'});
    if (skills.status !== 'succeeded') return skills;
    const relative = (/** @type {{path: string}} */ file) => file.path.slice('.agents/skills/'.length);
    const files = skills.files.filter(file => distributedSkills.includes(relative(file).split('/')[0]));
    return {
        payload: files.map(file => ({bytes: file.bytes, path: joinRelativePath('skills', relative(file))})).sort((left, right) => compareText(left.path, right.path)),
        sources: files.map(file => ({bytes: file.bytes, targetPath: joinRelativePath('distribution/skills', relative(file))})).sort((left, right) => compareText(left.targetPath, right.targetPath)),
        status: 'succeeded',
    };
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
const loadActualSources = async (/** @type {ScopedFilesystem} */ filesystem, /** @type {string[]} */ distributedSkills) => {
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    /** @type {DistributionSource[]} */
    const sources = [];

    const rootAgents = await readFile(filesystem, 'AGENTS.md');
    if (rootAgents.status !== 'succeeded') return rootAgents;
    const rootSpan = extractManagedSpan({bytes: rootAgents.bytes, path: 'AGENTS.md'});
    if (rootSpan.status !== 'succeeded') return rootSpan;
    sources.push({bytes: baselineDocument(rootSpan.span), targetPath: 'distribution/baseline/AGENTS.md'});

    const agentDocuments = await readFilesUnder({filesystem, root: 'docs/agents'});
    if (agentDocuments.status !== 'succeeded') return agentDocuments;
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
        else sources.push({bytes: baselineDocument(span.span), targetPath: joinRelativePath('distribution/baseline', file.path)});
    }

    const roles = await readFilesUnder({filesystem, root: 'docs/agents/roles'});
    if (roles.status !== 'succeeded') return roles;
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
                    sources.push({bytes: /** @type {FilePayload} */ (rolesByPath.get(entry.path)).bytes, targetPath: joinRelativePath('distribution/baseline', entry.path)});
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
            sources.push({bytes: /** @type {FilePayload} */ (rolesByPath.get(entry.path)).bytes, targetPath: joinRelativePath('distribution/baseline', entry.path)});
        }
    }

    const licenses = await readFilesUnder({filesystem, root: 'docs/licenses/arw'});
    if (licenses.status !== 'succeeded') return licenses;
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
        sources.push({bytes: /** @type {FilePayload} */ (licensesByPath.get(entry.path)).bytes, targetPath: joinRelativePath('distribution/baseline', entry.path)});
    }

    const skills = await loadSkillSourcePayload(filesystem, distributedSkills);
    if (skills.status !== 'succeeded') return skills;
    sources.push(...skills.sources);
    diagnostics.push(...targetDiagnostics(sources));
    if (diagnostics.length > 0) return blocked(diagnostics);
    return {
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
    /** @type {FileEntry[]} */
    const exactFileSeedEntries = exactFileSeeds.map(seed => ({kind: 'file', path: seed.path}));
    return {
        distributionConfig: configurationParsed.value,
        exactFileSeedPaths,
        projectionConfig: projectionParsed.value,
        seedEntries: [
            {kind: 'file', path: 'projections/codex/config.toml'},
            ...exactFileSeedEntries,
        ],
        seedPayload: [
            {bytes: codexDefaults.bytes, path: 'projections/codex/config.toml'},
            ...exactFileSeeds,
        ],
        status: 'succeeded',
    };
};

const cleanStateDiagnostics = (/** @type {Array<{code: string, path: string}>} */ entries) => entries
    .filter(entry => entry.code === '??' || entry.code[1] !== ' ')
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

const ancestors = (/** @type {string} */ path) => {
    const segments = path.split('/');
    const values = [];
    for (let length = 1; length < segments.length; length += 1) {
        values.push(segments.slice(0, length).join('/'));
    }
    return values;
};

const pathKey = (/** @type {string} */ path) => path.toLowerCase();

const pathsOverlap = (/** @type {string} */ left, /** @type {string} */ right) => {
    const foldedLeft = pathKey(left);
    const foldedRight = pathKey(right);
    return foldedLeft === foldedRight
        || foldedLeft.startsWith(`${foldedRight}/`)
        || foldedRight.startsWith(`${foldedLeft}/`);
};

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

const protectedDistributionFiles = (/** @type {string[]} */ exactFileSeedPaths) => [
    'distribution/config.json',
    'distribution/projections/config.json',
    'distribution/projections/codex/config.toml',
    ...exactFileSeedPaths.map(path => joinRelativePath('distribution/baseline', path)),
];

const protectedTargetDiagnostics = (/** @type {{exactFileSeedPaths: string[], sources: DistributionSource[]}} */ {exactFileSeedPaths, sources}) => {
    const protectedFiles = protectedDistributionFiles(exactFileSeedPaths);
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
    const exact = new Set();
    for (const path of protectedDistributionFiles(exactFileSeedPaths)) {
        exact.add(pathKey(path));
        for (const ancestor of ancestors(path)) {
            if (ancestor !== 'distribution') exact.add(pathKey(ancestor));
        }
    }
    const removable = entries
        .filter(entry => !exact.has(pathKey(entry.path)))
        .sort((left, right) => right.path.split('/').length - left.path.split('/').length
            || compareText(right.path, left.path));
    for (const entry of removable) {
        const removed = await filesystem.remove({path: entry.path, recursive: entry.kind === 'directory'});
        if (removed.status !== 'succeeded') return failedAfterDeletion(removed, 'cleanup');
    }
    return {diagnostics: [], status: 'succeeded'};
};

/** @returns {Promise<SyncMutationResult>} */
const writeActualSources = async (/** @type {{filesystem: ScopedFilesystem, sources: DistributionSource[]}} */ {filesystem, sources}) => {
    for (const source of sources) {
        const written = await filesystem.write({bytes: source.bytes, mode: 'create', path: source.targetPath});
        if (written.status !== 'succeeded') return failedAfterDeletion(written, 'generated-write');
    }
    return {diagnostics: [], status: 'succeeded'};
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

/** @template {{path?: string}} T @param {T} entry */
const toSourcePath = entry => ({...entry, path: entry.path?.startsWith('skills/') ? `.agents/${entry.path}` : entry.path});

/** @returns {Promise<SyncUnsuccessful | {diagnostics: Diagnostic[], notices: Array<{column: number, context: string, identity: string, line: number, path: string}>, status: 'succeeded'}>} */
export const syncWorkflowDistribution = async (/** @type {{buildDistribution?: typeof buildWorkflowDistribution, createFilesystem?: typeof createScopedFilesystem, repositoryRoot: string, stateAdapter?: SyncStateAdapter}} */ {
    buildDistribution = buildWorkflowDistribution,
    createFilesystem = createScopedFilesystem,
    repositoryRoot,
    stateAdapter = createSourceCheckoutSyncStateAdapter(repositoryRoot),
}) => {
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
    const distribution = await loadDistributionInputs(filesystem);
    if (distribution.status !== 'succeeded') return distribution;
    const registration = await checkSkillRegistration({distributionConfig: distribution.distributionConfig, filesystem});
    if (registration.status !== 'succeeded') return registration;
    const actual = await loadActualSources(filesystem, distribution.distributionConfig.distributedSkills);
    if (actual.status !== 'succeeded') return actual;
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
        ? {...listed, stage: 'distribution-enumeration'}
        : listed;
    const analysis = analyzeSkillReferences({
        payload: actual.skillPayload,
        projectionConfig: distribution.projectionConfig,
    });
    if (analysis.status !== 'succeeded') return {...analysis, diagnostics: analysis.diagnostics.map(toSourcePath)};
    const cleanup = await cleanupGeneratedRange({
        entries: listed.entries,
        exactFileSeedPaths: distribution.exactFileSeedPaths,
        filesystem,
    });
    if (cleanup.status !== 'succeeded') return cleanup;
    const written = await writeActualSources({filesystem, sources: actual.sources});
    if (written.status !== 'succeeded') return written;
    const validated = await validateRebuiltDistribution({buildDistribution, repositoryRoot});
    return validated.status === 'succeeded'
        ? {diagnostics: [], notices: analysis.unknownReferences.map(toSourcePath), status: 'succeeded'}
        : validated;
};
