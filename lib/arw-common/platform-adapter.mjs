import {resolve, sep} from 'node:path';

import {createNodePlatformEnvironment} from './platform-environment.mjs';
import {isSkillIdentity} from './skill-identity.mjs';
import {joinRelativePath, resolveRelativePathWithinScope} from '../common/filesystem.mjs';
import {checkShape, compareText, exactKeys} from '../common/json.mjs';

const TERMINATORS = new Set([' ', '\t', '\n', '`']);
/** @typedef {{code: string, column?: number, identity?: string, line?: number, message: string, path?: string, platform?: string, relatedPath?: string}} Diagnostic */
/** @typedef {{column: number, context?: string, identity: string, line: number, path: string}} SkillReferenceNormalization */
/** @typedef {{bytes: Buffer, mode?: number | string, path: string}} PayloadEntry */
/** @typedef {{excludedSkillPaths: readonly string[], skillReference: string}} ProjectionFormat */
/** @typedef {{skills: string, configuration?: string}} ProjectionTargets */
/** @typedef {{format: ProjectionFormat, supportedVersionRange: string, targets: ProjectionTargets}} PlatformConfiguration */
/** @typedef {{additionalSkillReferences: readonly string[], root: string, skillReferenceNormalizations: readonly SkillReferenceNormalization[]}} ProjectionSkills */
/** @typedef {{platforms: {'claude-code': PlatformConfiguration, codex: PlatformConfiguration}, skills: ProjectionSkills, source: 'codex'}} ProjectionConfiguration */
/** @typedef {{platform: PlatformConfiguration, skills: ProjectionSkills, sourceSkillReference: string}} MarkdownProjectionConfiguration */
/** @typedef {{codeMaps?: {roots?: readonly string[]}}} RepositoryProfile */
/** @typedef {Record<string, Buffer | null | undefined>} SeedTargets */
/** @typedef {{currentAgentIdentity?: (input: {platform: string}) => unknown}} PlatformEnvironment */
/** @typedef {{payload: readonly unknown[], platform: string, profile: RepositoryProfile & {platforms: readonly string[]}, projectionConfig: unknown, seedTargets: Record<string, Buffer | null | undefined>}} ProjectionIntentInput */
/** @typedef {{bytes: Buffer, path: string, source: string}} ManagedProjectionTarget */
/** @typedef {{action: 'compatible' | 'create', bytes: Buffer, path: string, source: string, strategy: 'regular-file'}} RepositoryOwnedProjectionSeed */
/** @typedef {{diagnostics: Diagnostic[], status: 'blocked'} | {diagnostics: Diagnostic[], configurationDefaults: ManagedProjectionTarget[], managedTargets: ManagedProjectionTarget[], repositoryOwnedSeeds: RepositoryOwnedProjectionSeed[], status: 'succeeded'}} ProjectionResult */

/** @param {string} code @param {string} message @param {Omit<Diagnostic, 'code' | 'message'>} [fields] @returns {Diagnostic} */
const diagnostic = (code, message, fields = {}) => ({code, message, ...fields});

/** @param {Diagnostic[]} diagnostics */
const sortedDiagnostics = diagnostics => diagnostics.sort((left, right) => (
    compareText(left.path ?? '', right.path ?? '')
    || (left.line ?? 0) - (right.line ?? 0)
    || (left.column ?? 0) - (right.column ?? 0)
    || compareText(left.code, right.code)
    || compareText(left.message, right.message)
));

const CONFIGURATION_PATH_SCOPE = resolve(process.cwd(), '.arw-platform-projection-path-scope');

/** @param {unknown} value @param {boolean} root */
const safeRelativePath = (value, root) => {
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

/** @param {unknown} value */
const safeRelative = value => safeRelativePath(value, false);

/** @type {import('../common/json.mjs').Shape} */
const NORMALIZATION_SHAPE = {
    column: 'positive-integer',
    identity: isSkillIdentity,
    line: 'positive-integer',
    path: (/** @type {unknown} */ path) => safeRelative(path) && typeof path === 'string' && path.startsWith('skills/') && path.endsWith('.md'),
};

/** @param {unknown} value */
const safeSkillReference = value => typeof value === 'string'
    && !/[\u0000-\u0020\u007f]/u.test(value)
    && value.split('{name}').length === 2;

/** @param {unknown} value */
const safeExcludedSkillPaths = value => Array.isArray(value)
    && value.every(safeRelative)
    && new Set(value).size === value.length
    && [...value].sort(compareText).every((path, index) => path === value[index]);

/** @param {SkillReferenceNormalization} left @param {SkillReferenceNormalization} right */
const normalizationOrder = (left, right) => compareText(left.path, right.path)
    || left.line - right.line
    || left.column - right.column
    || compareText(left.identity, right.identity);

/** @param {unknown} value @returns {Diagnostic[]} */
export const validateProjectionConfig = value => {
    const diagnostics = [];
    if (!exactKeys(value, ['platforms', 'skills', 'source'])) {
        return [diagnostic('projection-config-invalid', 'Projection configuration must contain exactly source, skills, and platforms.')];
    }
    if (value.source !== 'codex') {
        diagnostics.push(diagnostic('projection-source-invalid', 'Projection source must be codex.'));
    }
    const skills = value.skills;
    if (!exactKeys(skills, ['additionalSkillReferences', 'root', 'skillReferenceNormalizations'])) {
        diagnostics.push(diagnostic('projection-skills-invalid', 'Projection skills configuration is invalid.'));
    } else {
        if (skills.root !== 'skills/') {
            diagnostics.push(diagnostic('projection-skills-root-invalid', 'Projection skills root must be skills/.'));
        }
        if (!Array.isArray(skills.additionalSkillReferences)) {
            diagnostics.push(diagnostic('projection-additional-references-invalid', 'Additional Skill references must be an array.'));
        } else {
            const identities = skills.additionalSkillReferences.filter(identity => typeof identity === 'string');
            const sorted = [...identities].sort(compareText);
            if (
                identities.length !== skills.additionalSkillReferences.length
                || identities.some(identity => !isSkillIdentity(identity))
                || new Set(skills.additionalSkillReferences).size !== skills.additionalSkillReferences.length
                || sorted.some((identity, index) => identity !== identities[index])
            ) {
                diagnostics.push(diagnostic('projection-additional-references-invalid', 'Additional Skill references must be sorted, unique Skill identities.'));
            }
        }
        if (!Array.isArray(skills.skillReferenceNormalizations)) {
            diagnostics.push(diagnostic('projection-normalizations-invalid', 'Skill reference normalizations must be an array.'));
        } else {
            const records = skills.skillReferenceNormalizations;
            const valid = records.every(record => checkShape(record, NORMALIZATION_SHAPE) === null);
            if (!valid) {
                diagnostics.push(diagnostic('projection-normalizations-invalid', 'Skill reference normalizations must be valid and sorted by path, line, column, and identity.'));
            } else {
                const sorted = [...records].sort(normalizationOrder);
                if (sorted.some((record, index) => normalizationOrder(record, records[index]) !== 0)) {
                    diagnostics.push(diagnostic('projection-normalizations-invalid', 'Skill reference normalizations must be valid and sorted by path, line, column, and identity.'));
                }
            }
        }
    }

    if (!exactKeys(value.platforms, ['claude-code', 'codex'])) {
        diagnostics.push(diagnostic('projection-platforms-invalid', 'Projection platforms must be exactly claude-code and codex.'));
    } else {
        /** @type {('claude-code' | 'codex')[]} */
        const platformNames = ['claude-code', 'codex'];
        for (const platform of platformNames) {
            const configuration = value.platforms[platform];
            if (!exactKeys(configuration, ['format', 'supportedVersionRange', 'targets'])) {
                diagnostics.push(diagnostic('projection-platform-invalid', 'Platform configuration has an invalid shape.', {platform}));
                continue;
            }
            if (typeof configuration.supportedVersionRange !== 'string' || configuration.supportedVersionRange.length === 0) {
                diagnostics.push(diagnostic('projection-version-range-invalid', 'Platform supportedVersionRange must be non-empty.', {platform}));
            }
            if (!exactKeys(configuration.format, ['excludedSkillPaths', 'skillReference'])
                || !safeSkillReference(configuration.format.skillReference)
                || !safeExcludedSkillPaths(configuration.format.excludedSkillPaths)) {
                diagnostics.push(diagnostic('projection-format-invalid', 'Platform format must contain safe configuration-owned values.', {platform}));
            }
            if (!exactKeys(configuration.targets, platform === 'codex' ? ['skills', 'configuration'] : ['skills'])
                || !safeRelativePath(configuration.targets.skills, true)
                || (platform === 'codex' && configuration.targets.configuration !== '.codex/config.toml')) {
                diagnostics.push(diagnostic('projection-targets-invalid', 'Platform targets must be safe root-relative directories.', {platform}));
            }
        }
    }
    return sortedDiagnostics(diagnostics);
};

/** @param {string} text @param {number} offset */
const lineAndColumn = (text, offset) => {
    const prefix = text.slice(0, offset);
    const lines = prefix.split('\n');
    return {column: (lines.at(-1) ?? '').length + 1, line: lines.length};
};

/** @param {string} value */
const escapeRegularExpression = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** @param {string} template */
const referenceExpression = template => {
    const [prefix, suffix] = template.split('{name}');
    return new RegExp(`${escapeRegularExpression(prefix)}([a-z-]+)${escapeRegularExpression(suffix)}`, 'gu');
};

/** @param {{path: string, skillReference: string, text: string}} input */
const findReferences = ({path, skillReference, text}) => {
    const references = [];
    const expression = referenceExpression(skillReference);
    for (const match of text.matchAll(expression)) {
        if (!isSkillIdentity(match[1])) continue;
        const end = match.index + match[0].length;
        references.push({
            ...lineAndColumn(text, match.index),
            context: [...text.slice(match.index).split('\n', 1)[0]].slice(0, 80).join(''),
            end,
            identity: match[1],
            normalized: TERMINATORS.has(text[end]),
            offset: match.index,
            path,
        });
    }
    return references;
};

/** @param {unknown} entry @returns {entry is PayloadEntry} */
const isPayloadEntry = entry => entry !== null
    && typeof entry === 'object'
    && 'bytes' in entry
    && Buffer.isBuffer(entry.bytes)
    && 'path' in entry
    && typeof entry.path === 'string'
    && safeRelative(entry.path);

/** @param {readonly unknown[]} payload */
const payloadSkillIdentities = payload => {
    const identities = new Set();
    for (const entry of payload) {
        if (!isPayloadEntry(entry)) continue;
        if (!entry.path.startsWith('skills/')) continue;
        const identity = entry.path.slice('skills/'.length).split('/')[0];
        if (identity !== undefined && identity.length > 0) identities.add(identity);
    }
    return identities;
};

/** @param {readonly unknown[]} payload @returns {Diagnostic[]} */
const validatePayload = payload => {
    const diagnostics = [];
    for (const [index, entry] of payload.entries()) {
        if (!isPayloadEntry(entry)) {
            const path = entry !== null && typeof entry === 'object' && 'path' in entry && typeof entry.path === 'string'
                ? entry.path
                : String(index);
            diagnostics.push(diagnostic('projection-payload-invalid', 'A payload entry is invalid.', {path}));
        }
    }
    return diagnostics;
};

/**
 * @param {{payload: readonly unknown[], projectionConfig: unknown}} input
 * @returns {{diagnostics: Diagnostic[], status: 'blocked'} | {additionalSkillReferences: string[], diagnostics: Diagnostic[], skillReferenceNormalizations: SkillReferenceNormalization[], status: 'succeeded'}}
 */
export const analyzeSkillReferences = ({payload, projectionConfig}) => {
    const diagnostics = [...validatePayload(payload), ...validateProjectionConfig(projectionConfig)];
    const identities = payloadSkillIdentities(payload);
    for (const identity of identities) {
        if (!isSkillIdentity(identity)) {
            diagnostics.push(diagnostic('skill-identity-invalid', 'A Skill directory has an invalid identity.', {identity, path: `${joinRelativePath('skills', identity)}/`}));
        }
    }
    if (diagnostics.length > 0) return {diagnostics: sortedDiagnostics(diagnostics), status: 'blocked'};
    const config = /** @type {ProjectionConfiguration} */ (projectionConfig);
    const skillReference = config.platforms[config.source].format.skillReference;

    const known = new Set(identities);
    const additional = new Set();
    const normalizations = [];
    for (const entry of payload) {
        if (!isPayloadEntry(entry)) continue;
        if (!entry.path.startsWith('skills/') || !entry.path.endsWith('.md')) continue;
        let text;
        try {
            text = new TextDecoder('utf-8', {fatal: true}).decode(entry.bytes);
        } catch {
            diagnostics.push(diagnostic('skill-markdown-invalid-utf8', 'A Markdown Skill file is not valid UTF-8.', {path: entry.path}));
            continue;
        }
        for (const reference of findReferences({path: entry.path, skillReference, text})) {
            if (!known.has(reference.identity)) additional.add(reference.identity);
            if (!reference.normalized) {
                normalizations.push({
                    column: reference.column,
                    context: reference.context,
                    identity: reference.identity,
                    line: reference.line,
                    path: reference.path,
                });
            }
        }
    }
    if (diagnostics.length > 0) return {diagnostics: sortedDiagnostics(diagnostics), status: 'blocked'};
    return {
        additionalSkillReferences: [...additional].sort(compareText),
        diagnostics: [],
        skillReferenceNormalizations: normalizations.sort(normalizationOrder),
        status: 'succeeded',
    };
};

/** @param {SkillReferenceNormalization} record */
const normalizationKey = record => `${record.path}\0${record.line}\0${record.column}\0${record.identity}`;

/** @param {{configuration: MarkdownProjectionConfiguration, emitBytes: boolean, entry: PayloadEntry, known: ReadonlySet<string>}} input */
const evaluateMarkdownReferences = ({configuration, emitBytes, entry, known}) => {
    let text;
    try {
        text = new TextDecoder('utf-8', {fatal: true}).decode(entry.bytes);
    } catch {
        return {diagnostic: diagnostic('skill-markdown-invalid-utf8', 'A Markdown Skill file is not valid UTF-8.', {path: entry.path})};
    }
    const configured = new Set(configuration.skills.skillReferenceNormalizations.map(normalizationKey));
    const encountered = new Set();
    const references = findReferences({path: entry.path, skillReference: configuration.sourceSkillReference, text});
    let cursor = 0;
    let projected = emitBytes ? '' : null;
    for (const reference of references) {
        if (emitBytes) projected += text.slice(cursor, reference.offset);
        const key = normalizationKey(reference);
        const approvedNormalization = !reference.normalized && configured.has(key);
        if (!reference.normalized && !approvedNormalization) {
            if (emitBytes) projected += text.slice(reference.offset, reference.end);
            cursor = reference.end;
            continue;
        }
        if (approvedNormalization) encountered.add(key);
        if (!known.has(reference.identity)) {
            if (reference.normalized) {
                if (emitBytes) projected += text.slice(reference.offset, reference.end);
                cursor = reference.end;
                continue;
            }
            return {diagnostic: diagnostic('skill-reference-unresolved', 'A Skill reference identity is not available or approved.', {
                column: reference.column,
                identity: reference.identity,
                line: reference.line,
                path: reference.path,
            })};
        }
        if (emitBytes) {
            projected += configuration.platform.format.skillReference.replace('{name}', reference.identity);
            if (approvedNormalization) projected += ' ';
        }
        cursor = reference.end;
    }
    if (emitBytes) projected += text.slice(cursor);
    return {bytes: projected === null ? undefined : Buffer.from(projected, 'utf8'), encountered};
};

/**
 * @param {{payload: readonly unknown[], projectionConfig: unknown}} input
 * @returns {{diagnostics: Diagnostic[], status: 'blocked'} | {diagnostics: Diagnostic[], status: 'succeeded'}}
 */
export const validateSkillReferenceProjection = ({payload, projectionConfig}) => {
    const diagnostics = [...validatePayload(payload), ...validateProjectionConfig(projectionConfig)];
    const identities = payloadSkillIdentities(payload);
    for (const identity of identities) {
        if (!isSkillIdentity(identity)) {
            diagnostics.push(diagnostic('skill-identity-invalid', 'A Skill directory has an invalid identity.', {identity, path: `${joinRelativePath('skills', identity)}/`}));
        }
    }
    if (diagnostics.length > 0) return {diagnostics: sortedDiagnostics(diagnostics), status: 'blocked'};
    const config = /** @type {ProjectionConfiguration} */ (projectionConfig);

    const configuration = {
        platform: config.platforms.codex,
        skills: config.skills,
        sourceSkillReference: config.platforms[config.source].format.skillReference,
    };
    const known = new Set([...identities, ...configuration.skills.additionalSkillReferences]);
    const usedNormalizations = new Set();
    for (const entry of payload) {
        if (!isPayloadEntry(entry)) continue;
        if (!entry.path.startsWith('skills/') || !entry.path.endsWith('.md')) continue;
        const evaluated = evaluateMarkdownReferences({configuration, emitBytes: false, entry, known});
        if (evaluated.diagnostic) diagnostics.push(evaluated.diagnostic);
        else for (const key of evaluated.encountered) usedNormalizations.add(key);
    }
    if (diagnostics.length === 0) {
        for (const record of configuration.skills.skillReferenceNormalizations) {
            if (!usedNormalizations.has(normalizationKey(record))) {
                diagnostics.push(diagnostic('skill-reference-normalization-stale', 'A configured Skill reference normalization no longer identifies a candidate.', record));
            }
        }
    }
    return diagnostics.length === 0
        ? {diagnostics: [], status: 'succeeded'}
        : {diagnostics: sortedDiagnostics(diagnostics), status: 'blocked'};
};

/** @param {{entry: PayloadEntry, profile: RepositoryProfile}} input */
const projectBaselineBytes = ({entry, profile}) => {
    if (entry.path !== 'baseline/AGENTS.md' || !Array.isArray(profile.codeMaps?.roots)) return {bytes: entry.bytes};
    let text;
    try {
        text = new TextDecoder('utf-8', {fatal: true}).decode(entry.bytes);
    } catch {
        return {diagnostic: diagnostic(
            'baseline-document-invalid-utf8',
            'A transformed baseline document is not valid UTF-8.',
            {path: entry.path},
        )};
    }
    const roots = profile.codeMaps.roots.length === 0 ? '(none)' : profile.codeMaps.roots.join(', ');
    return {bytes: Buffer.from(text.replace('Code Map roots: (none)', `Code Map roots: ${roots}`), 'utf8')};
};

/** @param {'claude-code' | 'codex'} platform @param {ProjectionIntentInput} intent @returns {ProjectionResult} */
const evaluateProjection = (platform, intent) => {
    const profile = intent.profile;
    const diagnostics = [...validatePayload(intent.payload), ...validateProjectionConfig(intent.projectionConfig)];
    if (!profile.platforms.includes(platform)) {
        diagnostics.push(diagnostic('projection-platform-not-selected', 'The platform is not selected by the Repository Profile.', {platform}));
    }
    const payload = intent.payload.filter(isPayloadEntry);
    const identities = payloadSkillIdentities(payload);
    for (const identity of identities) {
        if (!isSkillIdentity(identity)) {
            diagnostics.push(diagnostic('skill-identity-invalid', 'A Skill directory has an invalid identity.', {identity, path: `${joinRelativePath('skills', identity)}/`}));
        }
    }
    if (diagnostics.length > 0) return {diagnostics: sortedDiagnostics(diagnostics), status: 'blocked'};
    const projectionConfig = /** @type {ProjectionConfiguration} */ (intent.projectionConfig);
    const seedTargets = intent.seedTargets;

    const configuration = {
        platform: projectionConfig.platforms[platform],
        skills: projectionConfig.skills,
        sourceSkillReference: projectionConfig.platforms[projectionConfig.source].format.skillReference,
    };
    const known = new Set([...identities, ...configuration.skills.additionalSkillReferences]);
    const exclusions = new Set(configuration.platform.format.excludedSkillPaths);
    /** @type {ManagedProjectionTarget[]} */
    const managedTargets = [];
    /** @type {ManagedProjectionTarget[]} */
    const configurationDefaults = [];
    if (platform === 'codex') {
        const entry = payload.find(entry => entry.path === 'projections/codex/config.toml');
        if (entry === undefined) diagnostics.push(diagnostic('codex-default-configuration-missing', 'Codex default configuration payload is missing.', {platform}));
        else configurationDefaults.push({bytes: entry.bytes, source: entry.path, path: /** @type {string} */ (configuration.platform.targets.configuration)});
    }
    /** @type {RepositoryOwnedProjectionSeed[]} */
    const repositoryOwnedSeeds = [];
    const usedNormalizations = new Set();

    for (const entry of payload) {
        if (entry.path.startsWith('baseline/')) {
            const path = entry.path.slice('baseline/'.length);
            if (Object.hasOwn(seedTargets, path)) {
                const current = seedTargets[path];
                repositoryOwnedSeeds.push({
                    action: current === undefined || current === null ? 'create' : 'compatible',
                    bytes: entry.bytes,
                    path,
                    source: entry.path,
                    strategy: 'regular-file',
                });
                continue;
            }
            const projected = projectBaselineBytes({entry, profile});
            if (projected.diagnostic) diagnostics.push(projected.diagnostic);
            else managedTargets.push({bytes: projected.bytes, path, source: entry.path});
            continue;
        }
        if (entry.path.startsWith('skills/')) {
            const skillPath = entry.path.slice('skills/'.length);
            const [, ...relativeSegments] = skillPath.split('/');
            if (exclusions.has(relativeSegments.join('/'))) continue;
            let bytes = entry.bytes;
            if (entry.path.endsWith('.md')) {
                const projected = evaluateMarkdownReferences({configuration, emitBytes: true, entry, known});
                if (projected.diagnostic) diagnostics.push(projected.diagnostic);
                else if (projected.bytes === undefined) {
                    throw new Error('Markdown projection did not produce bytes.');
                }
                else {
                    bytes = projected.bytes;
                    for (const key of projected.encountered) usedNormalizations.add(key);
                }
            }
            managedTargets.push({
                bytes,
                path: joinRelativePath(configuration.platform.targets.skills, skillPath),
                source: entry.path,
            });
            continue;
        }
    }

    if (diagnostics.length === 0) {
        for (const record of configuration.skills.skillReferenceNormalizations) {
            if (!usedNormalizations.has(normalizationKey(record))) {
                diagnostics.push(diagnostic('skill-reference-normalization-stale', 'A configured Skill reference normalization no longer identifies a candidate.', record));
            }
        }
    }

    if (platform === 'claude-code') {
        managedTargets.push({bytes: Buffer.from('@AGENTS.md\n', 'utf8'), path: 'CLAUDE.md', source: 'platform:claude-code'});
    }

    const paths = new Map();
    for (const target of [...managedTargets, ...repositoryOwnedSeeds, ...configurationDefaults]) {
        const collision = paths.get(target.path.toLowerCase());
        if (collision !== undefined) {
            diagnostics.push(diagnostic('projection-target-collision', 'Multiple projection entries target the same path.', {
                path: target.path,
                relatedPath: collision,
            }));
        } else {
            paths.set(target.path.toLowerCase(), target.path);
        }
    }
    if (diagnostics.length > 0) return {diagnostics: sortedDiagnostics(diagnostics), status: 'blocked'};
    managedTargets.sort((left, right) => compareText(left.path, right.path));
    repositoryOwnedSeeds.sort((left, right) => compareText(left.path, right.path));
    return {diagnostics: [], configurationDefaults, managedTargets, repositoryOwnedSeeds, status: 'succeeded'};
};

/** @param {{environment: PlatformEnvironment, platform: string}} input */
const currentAgentIdentity = ({environment, platform}) => {
    if (typeof environment.currentAgentIdentity !== 'function') {
        throw new Error(`Cannot determine the current Agent session identity for ${platform}: the platform did not provide an identity source.`);
    }
    const sessionId = environment.currentAgentIdentity({platform});
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new Error(`Cannot determine the current Agent session identity for ${platform}: the platform returned no usable identity.`);
    }
    return {platform, sessionId};
};

/** @param {'claude-code' | 'codex'} platform @param {{environment?: PlatformEnvironment}} [options] */
const createPlatformAdapter = (platform, {environment = createNodePlatformEnvironment()} = {}) => ({
    /** @param {unknown} intent */
    evaluate(intent) {
        return evaluateProjection(platform, /** @type {ProjectionIntentInput} */ (intent));
    },
    getCurrentAgentIdentity() {
        return currentAgentIdentity({environment, platform});
    },
});

/** @param {{environment?: PlatformEnvironment}} [options] */
export const createCodexPlatformAdapter = options => createPlatformAdapter('codex', options);

/** @param {{environment?: PlatformEnvironment}} [options] */
export const createClaudeCodePlatformAdapter = options => createPlatformAdapter('claude-code', options);

/** Claude Code 给 Bash tool 子进程设置 `CLAUDECODE=1`; 否则按 Codex 处理. @param {{environment?: NodeJS.ProcessEnv}} [options] */
export const createCurrentPlatformAdapter = ({environment = process.env} = {}) => createPlatformAdapter(
    environment.CLAUDECODE === '1' ? 'claude-code' : 'codex',
    {environment: createNodePlatformEnvironment({environment})},
);
