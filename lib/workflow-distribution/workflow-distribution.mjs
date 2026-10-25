import {prepareCodexConfiguration} from '../arw-common/codex-configuration.mjs';
import {resolve, sep} from 'node:path';

import {validateProjectionConfig} from '../arw-common/platform-adapter.mjs';
import {isSkillIdentity} from '../arw-common/skill-identity.mjs';
import {
    createScopedFilesystem,
    joinRelativePath,
    resolveRelativePathWithinScope,
} from '../common/filesystem.mjs';
import {compareText, exactKeys, parseJsonText} from '../common/json.mjs';

/** @typedef {{code: string, identity?: string, message: string, path?: string, platform?: string, relatedPath?: string}} Diagnostic */
/** @typedef {{kind: string, path: string}} DistributionEntry */
/** @typedef {{repositoryOwnedSeeds: string[]}} DistributionConfiguration */
/** @typedef {{platforms: Record<string, {targets: {skills: string}}>, [key: string]: unknown}} DistributionProjectionConfiguration */
/** @typedef {{diagnostics: Diagnostic[], stage?: string, status: 'blocked' | 'failed'}} DistributionBuildFailure */
/** @typedef {{diagnostics: Diagnostic[], distributionConfig: DistributionConfiguration, payload: {bytes: Buffer, path: string}[], projectionConfig: DistributionProjectionConfiguration, status: 'succeeded'}} DistributionBuildSuccess */

const DISTRIBUTION_READ_BATCH_SIZE = 16;

/** @param {Array<{code: string, message: string}>} diagnostics @param {string} path */
const configurationParseDiagnostics = (diagnostics, path) => diagnostics.map(entry => ({
    ...entry,
    code: entry.code === 'json-invalid-utf8'
        ? 'invalid-utf8'
        : entry.code === 'json-bom' ? 'utf8-bom' : entry.code,
    path,
}));

/** @param {string} code @param {string} message @param {Omit<Diagnostic, 'code' | 'message'>} [fields] @returns {Diagnostic} */
const diagnostic = (code, message, fields = {}) => ({code, message, ...fields});

/** @param {Diagnostic[]} diagnostics */
const sortDiagnostics = diagnostics => diagnostics.sort((left, right) => (
    compareText(left.path ?? '', right.path ?? '')
    || compareText(left.platform ?? '', right.platform ?? '')
    || compareText(left.code, right.code)
    || compareText(left.message, right.message)
));

const CONFIGURATION_PATH_SCOPE = resolve(process.cwd(), '.arw-workflow-distribution-path-scope');

/** @param {unknown} value @param {{root?: boolean}} [options] @returns {value is string} */
const safePath = (value, {root = false} = {}) => {
    if (typeof value !== 'string' || value.length === 0 || root !== value.endsWith('/')) return false;
    const candidate = root ? value.slice(0, -1) : value;
    if (candidate.length === 0) return false;
    try {
        const logicalPath = joinRelativePath(candidate);
        const resolved = resolveRelativePathWithinScope({path: logicalPath, scope: CONFIGURATION_PATH_SCOPE});
        if (resolved.status !== 'succeeded' || resolved.relativePath.length === 0) return false;
        const normalized = resolved.relativePath.split(sep).join('/');
        return candidate === logicalPath && value === (root ? `${normalized}/` : normalized);
    } catch {
        return false;
    }
};

/** @param {unknown} value @returns {Diagnostic[]} */
export const validateDistributionConfig = value => {
    if (!exactKeys(value, ['repositoryOwnedSeeds'])) {
        return [diagnostic('distribution-config-invalid', 'Distribution configuration must contain exactly repositoryOwnedSeeds.')];
    }
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    if (!Array.isArray(value.repositoryOwnedSeeds)
        || value.repositoryOwnedSeeds.length === 0
        || new Set(value.repositoryOwnedSeeds).size !== value.repositoryOwnedSeeds.length
        || value.repositoryOwnedSeeds.some((/** @type {string} */ path) => typeof path !== 'string'
            || !safePath(path, {root: path.endsWith('/')}))) {
        diagnostics.push(diagnostic('repository-owned-seeds-invalid', 'Repository-owned seeds must be unique safe file paths or directory roots.'));
    }
    return sortDiagnostics(diagnostics);
};

/** @param {unknown} value @returns {value is DistributionConfiguration} */
const isDistributionConfiguration = value => validateDistributionConfig(value).length === 0;

/** @param {unknown} value @returns {value is DistributionProjectionConfiguration} */
const isProjectionConfiguration = value => validateProjectionConfig(value).length === 0;

const allowedLayoutPath = (/** @type {string} */ path) => path === 'config.json'
    || path === 'baseline'
    || path.startsWith('baseline/')
    || path === 'skills'
    || path.startsWith('skills/')
    || path === 'projections'
    || path === 'projections/config.json'
    || path === 'projections/codex'
    || path === 'projections/codex/config.toml';

/** @param {DistributionEntry[]} entries @param {{distributionConfig?: DistributionConfiguration, projectionConfig?: DistributionProjectionConfiguration}} [configuration] */
export const validateWorkflowDistributionLayout = (entries, {
    distributionConfig: _distributionConfig,
    projectionConfig: _projectionConfig,
} = {}) => {
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    for (const entry of entries) {
        if (entry.kind === 'link') {
            diagnostics.push(diagnostic(
                'filesystem-link-unsupported',
                'Symbolic links and directory junctions are not supported.',
                {path: entry.path},
            ));
            continue;
        }
        if (!allowedLayoutPath(entry.path)) {
            diagnostics.push(diagnostic('distribution-layout-entry-unknown', 'The Workflow Distribution contains an unknown path.', {path: entry.path}));
        }
        if (entry.path.startsWith('skills/')
            && !entry.path.slice('skills/'.length).includes('/')
            && entry.kind !== 'directory') {
            diagnostics.push(diagnostic(
                'distribution-skill-package-invalid',
                'Each direct child of skills/ must be a Skill Package directory.',
                {path: entry.path},
            ));
        }
    }
    return sortDiagnostics(diagnostics);
};

/** @param {DistributionEntry[]} entries @returns {Diagnostic[]} */
const verifyCanonicalRoles = entries => {
    const root = 'baseline/docs/agents/roles/';
    if (!entries.some(entry => entry.path === root.slice(0, -1) && entry.kind === 'directory')) {
        return [diagnostic('role-root-missing', 'The canonical Role root does not exist.', {path: root})];
    }
    const roles = entries.filter(entry => entry.path.startsWith(root))
        .map(entry => ({...entry, relativePath: entry.path.slice(root.length)}));
    const identities = new Set(roles.filter(entry => entry.kind === 'file' && !entry.relativePath.includes('/') && entry.relativePath.endsWith('.md'))
        .map(entry => entry.relativePath.slice(0, -3)));
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    for (const entry of roles) {
        const segments = entry.relativePath.split('/');
        const valid = segments.length === 1
            ? entry.kind === 'file' && entry.relativePath.endsWith('.md') && isSkillIdentity(entry.relativePath.slice(0, -3))
                || entry.kind === 'directory' && identities.has(entry.relativePath)
            : segments.length === 2 && identities.has(segments[0]) && entry.kind === 'file' && segments[1].endsWith('.md');
        if (!valid) diagnostics.push(diagnostic('role-root-entry-invalid', 'The Role root contains an invalid canonical Role or on-demand document entry.', {path: entry.path}));
    }
    return diagnostics;
};

/** @param {{distributionConfig: DistributionConfiguration, payload: Array<{path: string}>}} input @returns {string[]} */
export const repositoryOwnedSeedPaths = ({distributionConfig, payload}) => {
    const exact = new Set(distributionConfig.repositoryOwnedSeeds.filter(path => !path.endsWith('/')));
    const roots = distributionConfig.repositoryOwnedSeeds.filter(path => path.endsWith('/'));
    return [...new Set(payload
        .filter(entry => entry.path.startsWith('baseline/'))
        .map(entry => entry.path.slice('baseline/'.length))
        .filter(path => exact.has(path) || roots.some(root => path.startsWith(root))))].sort(compareText);
};

/** @param {{distributionConfig: DistributionConfiguration, entries: DistributionEntry[], payloadByPath: Map<string, Buffer>}} input */
const verifyRepositoryOwnedSeeds = ({distributionConfig, entries, payloadByPath}) => {
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    for (const seed of distributionConfig.repositoryOwnedSeeds) {
        const sourcePath = joinRelativePath('baseline', seed);
        const found = seed.endsWith('/')
            ? entries.some(entry => entry.kind === 'file' && entry.path.startsWith(`${sourcePath}/`))
            : payloadByPath.has(sourcePath);
        if (!found) {
            diagnostics.push(diagnostic('repository-seed-source-missing', seed.endsWith('/')
                ? 'A repository-owned seed directory has no baseline files.'
                : 'A repository-owned seed file has no baseline source.', {path: seed}));
        }
    }
    return diagnostics;
};

/** @param {{distributionConfig: DistributionConfiguration, entries: DistributionEntry[], payloadByPath: Map<string, Buffer>, projectionConfig: DistributionProjectionConfiguration}} input */
export const validateWorkflowDistributionSeedInputs = ({
    distributionConfig,
    entries,
    payloadByPath,
    projectionConfig,
}) => {
    return sortDiagnostics([
        ...verifyCanonicalRoles(entries),
        ...verifyRepositoryOwnedSeeds({distributionConfig, entries, payloadByPath}),
    ]);
};

/** @param {Diagnostic[]} diagnostics @returns {{diagnostics: Diagnostic[], status: 'blocked'}} */
const blocked = diagnostics => ({diagnostics: sortDiagnostics(diagnostics), status: 'blocked'});

/** @param {{createFilesystem?: typeof createScopedFilesystem, distributionDirectory: string}} input @returns {Promise<DistributionBuildFailure | DistributionBuildSuccess>} */
export const buildWorkflowDistribution = async ({
    createFilesystem = createScopedFilesystem,
    distributionDirectory,
}) => {

    const created = await createFilesystem({createRoot: false, root: distributionDirectory});
    if (created.status !== 'succeeded') return created;
    const filesystem = created.scopedFilesystem;
    const listed = await filesystem.list({path: '.', recursive: true});
    if (listed.status !== 'succeeded') {
        return listed.status === 'blocked' ? listed : {...listed, stage: listed.stage ?? 'distribution-enumeration'};
    }
    const entries = listed.entries;
    /** @type {Diagnostic[]} */
    const diagnostics = validateWorkflowDistributionLayout(entries);
    for (const required of ['baseline', 'skills', 'projections']) {
        if (!entries.some((/** @type {{ kind: string; path: string; }} */ entry) => entry.kind === 'directory' && entry.path === required)) {
            diagnostics.push(diagnostic('distribution-layout-root-missing', 'A required Workflow Distribution directory is missing.', {path: required}));
        }
    }
    for (const required of ['config.json', 'projections/config.json', 'projections/codex/config.toml']) {
        if (!entries.some((/** @type {{ kind: string; path: string; }} */ entry) => entry.kind === 'file' && entry.path === required)) {
            diagnostics.push(diagnostic('distribution-config-missing', 'A required Workflow Distribution configuration file is missing.', {path: required}));
        }
    }
    const pathsByCase = new Map();
    for (const entry of entries) {
        const folded = entry.path.toLowerCase();
        const previous = pathsByCase.get(folded);
        if (previous !== undefined && previous !== entry.path) {
            diagnostics.push(diagnostic('distribution-path-case-collision', 'Workflow Distribution paths collide when compared without case.', {
                path: entry.path,
                relatedPath: previous,
            }));
        } else {
            pathsByCase.set(folded, entry.path);
        }
    }
    if (diagnostics.length > 0) return blocked(diagnostics);

    const files = entries
        .filter((/** @type {{ kind: string; }} */ entry) => entry.kind === 'file')
        .sort((left, right) => compareText(left.path, right.path));
    /** @type {{bytes: Buffer, path: string}[]} */
    const payload = [];
    for (let offset = 0; offset < files.length; offset += DISTRIBUTION_READ_BATCH_SIZE) {
        const batch = files.slice(offset, offset + DISTRIBUTION_READ_BATCH_SIZE);
        const reads = await Promise.all(batch.map(async entry => {
            try {
                return {result: await filesystem.read({path: entry.path})};
            } catch (error) {
                return {error};
            }
        }));
        for (const [index, entry] of batch.entries()) {
            const read = reads[index];
            if ('error' in read) throw read.error;
            const {result} = read;
            if (result.status === 'blocked') return result;
            if (result.status === 'failed') return {...result, stage: result.stage ?? 'distribution-read'};
            payload.push({bytes: result.bytes, path: entry.path});
        }
    }
    const payloadByPath = new Map(payload.map(entry => [entry.path, entry.bytes]));
    const codexDefaults = payloadByPath.get('projections/codex/config.toml');
    if (codexDefaults === undefined) throw new Error('Missing Codex configuration payload.');
    const checkedDefaults = prepareCodexConfiguration({sourceBytes: null, defaultBytes: codexDefaults});
    if (checkedDefaults.status !== 'succeeded') return blocked(checkedDefaults.diagnostics.map(entry => ({...entry, path: 'projections/codex/config.toml'})));
    const distributionBytes = payloadByPath.get('config.json');
    const projectionBytes = payloadByPath.get('projections/config.json');
    if (distributionBytes === undefined || projectionBytes === undefined) {
        throw new Error('Validated Workflow Distribution is missing configuration bytes.');
    }
    const distributionParsed = parseJsonText(distributionBytes);
    if (distributionParsed.status !== 'succeeded') {
        return blocked(configurationParseDiagnostics(distributionParsed.diagnostics, 'config.json'));
    }
    const projectionParsed = parseJsonText(projectionBytes);
    if (projectionParsed.status !== 'succeeded') {
        return blocked(configurationParseDiagnostics(projectionParsed.diagnostics, 'projections/config.json'));
    }
    if (!('value' in distributionParsed) || !('value' in projectionParsed)) {
        throw new Error('Parsed Workflow Distribution configuration is missing its value.');
    }
    const distributionConfig = distributionParsed.value;
    const projectionConfig = projectionParsed.value;
    diagnostics.push(...validateDistributionConfig(distributionConfig));
    diagnostics.push(...validateProjectionConfig(projectionConfig));
    if (diagnostics.length > 0) return blocked(diagnostics);
    if (!isDistributionConfiguration(distributionConfig) || !isProjectionConfiguration(projectionConfig)) {
        throw new Error('Validated Workflow Distribution configuration did not retain its shape.');
    }

    diagnostics.push(...validateWorkflowDistributionSeedInputs({
        distributionConfig,
        entries,
        payloadByPath,
        projectionConfig,
    }));
    if (diagnostics.length > 0) return blocked(diagnostics);
    return {diagnostics: [], distributionConfig, payload, projectionConfig, status: 'succeeded'};
};
