import {resolve, sep} from 'node:path';

import {createNodePlatformEnvironment} from './platform-environment.mjs';
import {isSkillIdentity} from './skill-identity.mjs';
import {joinRelativePath, resolveRelativePathWithinScope} from '../common/filesystem.mjs';

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
/** @typedef {{payload: unknown, platform: unknown, profile: unknown, projectionConfig: unknown, seedTargets: unknown}} ProjectionIntentInput */
/** @typedef {{bytes: Buffer, path: string, source: string}} ManagedProjectionTarget */
/** @typedef {{action: 'compatible' | 'create', bytes: Buffer, path: string, source: string, strategy: 'regular-file'}} RepositoryOwnedProjectionSeed */
/** @typedef {{diagnostics: Diagnostic[], status: 'blocked'} | {diagnostics: Diagnostic[], configurationDefaults: ManagedProjectionTarget[], managedTargets: ManagedProjectionTarget[], repositoryOwnedSeeds: RepositoryOwnedProjectionSeed[], status: 'succeeded'}} ProjectionResult */

/** @param {string} left @param {string} right */
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

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

/** @template {string} T @param {unknown} value @param {readonly T[]} expected @returns {value is Record<T, unknown>} */
const exactKeys = (value, expected) => value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).sort(compareText).join('\0') === [...expected].sort(compareText).join('\0');

/** @param {unknown} value @returns {value is ProjectionIntentInput} */
const isProjectionIntentInput = value => exactKeys(value, ['payload', 'platform', 'profile', 'projectionConfig', 'seedTargets']);

/** @param {unknown} value @returns {value is RepositoryProfile & {platforms: readonly string[]}} */
const isRepositoryProfile = value => value !== null
    && typeof value === 'object'
    && 'platforms' in value
    && Array.isArray(value.platforms)
    && value.platforms.every(platform => typeof platform === 'string');

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

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
const safeRoot = value => safeRelativePath(value, true);

/** @param {unknown} value */
const safeRelative = value => safeRelativePath(value, false);

/** @param {unknown} value */
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
            const valid = records.every(record => exactKeys(record, ['column', 'identity', 'line', 'path'])
                && typeof record.path === 'string'
                && safeRelative(record.path)
                && record.path.startsWith('skills/')
                && record.path.endsWith('.md')
                && typeof record.line === 'number'
                && Number.isSafeInteger(record.line)
                && record.line > 0
                && typeof record.column === 'number'
                && Number.isSafeInteger(record.column)
                && record.column > 0
                && typeof record.identity === 'string'
                && isSkillIdentity(record.identity));
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
                || !safeRoot(configuration.targets.skills)
                || (platform === 'codex' && configuration.targets.configuration !== '.codex/config.toml')) {
                diagnostics.push(diagnostic('projection-targets-invalid', 'Platform targets must be safe root-relative directories.', {platform}));
            }
        }
    }
    return sortedDiagnostics(diagnostics);
};

/** @param {unknown} value @returns {value is ProjectionConfiguration} */
const isProjectionConfiguration = value => validateProjectionConfig(value).length === 0;

/** @param {string} text @param {number} offset */
const lineAndColumn = (text, offset) => {
    const prefix = text.slice(0, offset);
    const lines = prefix.split('\n');
    return {column: (lines.at(-1) ?? '').length + 1, line: lines.length};
};

/** @param {string} text @param {number} offset */
const referenceContext = (text, offset) => [...text.slice(offset).split('\n', 1)[0]].slice(0, 80).join('');

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
            context: referenceContext(text, match.index),
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

/** @param {unknown} payload @returns {Diagnostic[]} */
const validatePayload = payload => {
    if (!Array.isArray(payload)) throw new TypeError('payload must be an array.');
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
 * @param {{payload: readonly unknown[], projectionConfig: unknown, sourcePlatform?: unknown}} input
 * @returns {{diagnostics: Diagnostic[], status: 'blocked'} | {additionalSkillReferences: string[], diagnostics: Diagnostic[], skillReferenceNormalizations: SkillReferenceNormalization[], status: 'succeeded'}}
 */
export const analyzeSkillReferences = ({payload, projectionConfig, sourcePlatform = undefined}) => {
    const diagnostics = [...validatePayload(payload), ...validateProjectionConfig(projectionConfig)];
    const identities = payloadSkillIdentities(payload);
    for (const identity of identities) {
        if (!isSkillIdentity(identity)) {
            diagnostics.push(diagnostic('skill-identity-invalid', 'A Skill directory has an invalid identity.', {identity, path: `${joinRelativePath('skills', identity)}/`}));
        }
    }
    if (diagnostics.length > 0) return {diagnostics: sortedDiagnostics(diagnostics), status: 'blocked'};
    if (!isProjectionConfiguration(projectionConfig)) {
        throw new Error('Validated Projection configuration did not retain its required shape.');
    }
    const selectedSource = sourcePlatform ?? projectionConfig.source;
    if (selectedSource !== 'codex' && selectedSource !== 'claude-code') {
        return {diagnostics: [diagnostic('projection-source-platform-invalid', 'The source platform is not configured.', {platform: String(selectedSource)})], status: 'blocked'};
    }
    const skillReference = projectionConfig.platforms[selectedSource].format.skillReference;

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

/** @param {{configuration: MarkdownProjectionConfiguration, entry: PayloadEntry, known: ReadonlySet<string>}} input */
const projectMarkdown = input => evaluateMarkdownReferences({...input, emitBytes: true});

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
    if (!isProjectionConfiguration(projectionConfig)) {
        throw new Error('Validated Projection configuration did not retain its required shape.');
    }

    const configuration = {
        platform: projectionConfig.platforms.codex,
        skills: projectionConfig.skills,
        sourceSkillReference: projectionConfig.platforms[projectionConfig.source].format.skillReference,
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

/**
 * @param {{additionalSkillReferences: unknown, payload: readonly unknown[], projectionConfig: unknown, skillReferenceNormalizations: unknown, sourcePlatform: unknown}} input
 * @returns {{diagnostics: Diagnostic[], status: 'blocked'} | {diagnostics: Diagnostic[], payload: PayloadEntry[], status: 'succeeded'}}
 */
const toCanonicalSkills = ({
    additionalSkillReferences,
    payload,
    projectionConfig,
    skillReferenceNormalizations,
    sourcePlatform,
}) => {
    const configured = isRecord(projectionConfig) && isRecord(projectionConfig.skills)
        ? {
            ...projectionConfig,
            skills: {
                ...projectionConfig.skills,
                additionalSkillReferences,
                skillReferenceNormalizations,
            },
        }
        : projectionConfig;
    const diagnostics = [...validatePayload(payload), ...validateProjectionConfig(configured)];
    if (sourcePlatform !== 'codex' && sourcePlatform !== 'claude-code') {
        diagnostics.push(diagnostic('projection-source-platform-invalid', 'The source platform is not configured.', {platform: String(sourcePlatform)}));
    }
    if (diagnostics.length > 0) return {diagnostics: sortedDiagnostics(diagnostics), status: 'blocked'};
    if (!isProjectionConfiguration(configured) || !Array.isArray(payload)) {
        throw new Error('Validated canonical Skill input did not retain its required shape.');
    }
    const configuredSourcePlatform = /** @type {'claude-code' | 'codex'} */ (sourcePlatform);

    const entries = payload.filter(isPayloadEntry);
    for (const entry of entries) {
        if (!entry.path.startsWith('skills/')) continue;
        const [, identity, ...relativePath] = entry.path.split('/');
        if (typeof identity !== 'string' || !isSkillIdentity(identity) || relativePath.length === 0) {
            diagnostics.push(diagnostic(
                'projection-skill-identity-invalid',
                'A canonical Skill path must use a valid direct-child Skill identity.',
                {path: entry.path},
            ));
        }
    }
    if (diagnostics.length > 0) return {diagnostics: sortedDiagnostics(diagnostics), status: 'blocked'};
    const identities = payloadSkillIdentities(entries);
    const configuration = {
        platform: configured.platforms[configured.source],
        skills: configured.skills,
        sourceSkillReference: configured.platforms[configuredSourcePlatform].format.skillReference,
    };
    const known = new Set([...identities, ...configured.skills.additionalSkillReferences]);
    const usedNormalizations = new Set();
    /** @type {PayloadEntry[]} */
    const canonical = [];
    for (const entry of entries) {
        let bytes = entry.bytes;
        if (entry.path.startsWith('skills/') && entry.path.endsWith('.md')) {
            const projected = projectMarkdown({configuration, entry, known});
            if (projected.diagnostic) diagnostics.push(projected.diagnostic);
            else if (projected.bytes === undefined) throw new Error('Canonical Skill projection did not produce bytes.');
            else {
                bytes = projected.bytes;
                for (const key of projected.encountered) usedNormalizations.add(key);
            }
        }
        canonical.push({...entry, bytes});
    }
    if (diagnostics.length === 0) {
        for (const record of configured.skills.skillReferenceNormalizations) {
            if (!usedNormalizations.has(normalizationKey(record))) {
                diagnostics.push(diagnostic('skill-reference-normalization-stale', 'A configured Skill reference normalization no longer identifies a candidate.', record));
            }
        }
    }
    return diagnostics.length > 0
        ? {diagnostics: sortedDiagnostics(diagnostics), status: 'blocked'}
        : {diagnostics: [], payload: canonical.sort((left, right) => compareText(left.path, right.path)), status: 'succeeded'};
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

/** @param {{path: string, seedTargets: Record<string, unknown>}} input */
const seedTarget = ({path, seedTargets}) => {
    const current = seedTargets[path];
    if (current !== undefined && current !== null && !Buffer.isBuffer(current)) {
        throw new TypeError(`seedTargets[${path}] must be a Buffer, null, or undefined.`);
    }
    return current;
};

/** @param {'claude-code' | 'codex'} platform @param {unknown} intent @returns {ProjectionResult} */
const evaluateProjection = (platform, intent) => {
    if (!isProjectionIntentInput(intent)) {
        throw new TypeError('Platform projection intent must be an object.');
    }
    if (intent.platform !== platform) {
        throw new TypeError(`Projection intent platform must be ${platform}.`);
    }
    if (!isRepositoryProfile(intent.profile)) {
        throw new TypeError('Projection intent must contain a Repository Profile.');
    }
    const profile = intent.profile;
    const diagnostics = [...validatePayload(intent.payload), ...validateProjectionConfig(intent.projectionConfig)];
    if (!profile.platforms.includes(platform)) {
        diagnostics.push(diagnostic('projection-platform-not-selected', 'The platform is not selected by the Repository Profile.', {platform}));
    }
    if (!isRecord(intent.seedTargets)) {
        throw new TypeError('seedTargets must be an object keyed by target path.');
    }
    if (!Array.isArray(intent.payload)) {
        throw new TypeError('payload must be an array.');
    }
    const payload = intent.payload.filter(isPayloadEntry);
    const identities = payloadSkillIdentities(payload);
    for (const identity of identities) {
        if (!isSkillIdentity(identity)) {
            diagnostics.push(diagnostic('skill-identity-invalid', 'A Skill directory has an invalid identity.', {identity, path: `${joinRelativePath('skills', identity)}/`}));
        }
    }
    if (diagnostics.length > 0) return {diagnostics: sortedDiagnostics(diagnostics), status: 'blocked'};
    if (!isProjectionConfiguration(intent.projectionConfig)) {
        throw new Error('Validated Projection configuration did not retain its required shape.');
    }
    const projectionConfig = intent.projectionConfig;
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
                const current = seedTarget({path, seedTargets});
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
                const projected = projectMarkdown({configuration, entry, known});
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
        return evaluateProjection(platform, intent);
    },
    getCurrentAgentIdentity() {
        return currentAgentIdentity({environment, platform});
    },
    /** @param {{additionalSkillReferences: unknown, payload: readonly unknown[], projectionConfig: unknown, skillReferenceNormalizations: unknown, sourcePlatform: unknown}} input */
    toCanonicalSkills(input) {
        return toCanonicalSkills(input);
    },
});

/** @param {{environment?: PlatformEnvironment}} [options] */
export const createCodexPlatformAdapter = options => createPlatformAdapter('codex', options);

/** @param {{environment?: PlatformEnvironment}} [options] */
export const createClaudeCodePlatformAdapter = options => createPlatformAdapter('claude-code', options);
