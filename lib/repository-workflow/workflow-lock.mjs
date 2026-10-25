import {createHash} from 'node:crypto';
import {posix} from 'node:path';

import {
    assertExactKeys,
    assertSafePath,
    assertString,
    assertVersion,
} from '../common/canonical-contract.mjs';
import {createScopedFilesystem} from '../common/filesystem.mjs';
import {parseJsonText, serializeJson} from '../common/json.mjs';
import {isSkillIdentity} from '../arw-common/skill-identity.mjs';

export const CURRENT_LOCK_SCHEMA_VERSION = 2;

/** @type {Map<number, (legacy: ReturnType<typeof normalizeLegacyLock>) => unknown>} */
const registeredMigrators = new Map();

export const KNOWN_LOCK_MIGRATORS = Object.freeze({
    get size() {
        return registeredMigrators.size;
    },
});

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const MANAGED_START = '<!-- arw:managed:start -->';
const MANAGED_END = '<!-- arw:managed:end -->';
const REPOSITORY_START = '<!-- arw:repository-owned:start -->';
const REPOSITORY_END = '<!-- arw:repository-owned:end -->';
/** @param {string} left @param {string} right */
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
/** @param {string[]} values */
const uniqueSorted = values => [...new Set(values)].sort(compareText);

/** @param {unknown} value @param {string} label @returns {asserts value is Record<string, unknown>} */
function assertRecord(value, label) {
    if (value === null || Array.isArray(value) || typeof value !== 'object') {
        throw new Error(`${label} must be an object.`);
    }
}

const canonicalJson = (/** @type {unknown} */ value) => {
    const serialized = serializeJson(value, {sortKeys: true});
    if (serialized.status !== 'succeeded') throw new Error(serialized.diagnostics[0].message);
    return serialized.bytes.toString('utf8');
};

/** @param {unknown} value @param {string} label @returns {asserts value is string} */
function assertHash(value, label) {
    if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
        throw new Error(`${label} must be a lowercase SHA-256 digest.`);
    }
}

/** @param {unknown} value @param {string} label @param {{allowEmpty?: boolean}} [options] @returns {asserts value is string[]} */
function assertStringArray(value, label, {allowEmpty = true} = {}) {
    if (!Array.isArray(value)
        || (!allowEmpty && value.length === 0)
        || value.some(entry => typeof entry !== 'string' || entry.length === 0)) {
        throw new Error(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array of non-empty strings.`);
    }
}

export const normalizeWorkflowProfile = (/** @type {unknown} */ profile) => {
    assertExactKeys(profile, ['codeMaps', 'domainLayout', 'platforms'], 'profile');
    assertExactKeys(profile.codeMaps, ['excludes', 'includes', 'roots'], 'profile.codeMaps');
    assertString(profile.domainLayout, 'profile.domainLayout');
    if (!['single-context', 'multi-context'].includes(profile.domainLayout)) {
        throw new Error('profile.domainLayout is unsupported.');
    }
    assertStringArray(profile.platforms, 'profile.platforms', {allowEmpty: false});
    for (const platform of profile.platforms) {
        if (!['claude-code', 'codex'].includes(platform)) {
            throw new Error('profile.platforms contains an unsupported platform.');
        }
    }
    assertStringArray(profile.codeMaps.excludes, 'profile.codeMaps.excludes');
    assertStringArray(profile.codeMaps.includes, 'profile.codeMaps.includes');
    assertStringArray(profile.codeMaps.roots, 'profile.codeMaps.roots');
    const excludes = profile.codeMaps.excludes;
    const includes = profile.codeMaps.includes;
    const roots = profile.codeMaps.roots;
    for (const root of roots) {
        if (
            root !== '.'
            && (root.includes('\\')
                || root.includes('*')
                || root.includes('?')
                || /^[A-Za-z]:\//u.test(root)
                || posix.isAbsolute(root)
                || posix.normalize(root) !== root
                || root === '..'
                || root.startsWith('../'))
        ) {
            throw new Error('profile.codeMaps.roots contains an unsupported Repository-relative root.');
        }
    }
    for (const [key, globs] of [['excludes', excludes], ['includes', includes]]) {
        for (const glob of globs) {
            const segments = glob.split('/');
            if (
                glob.includes('\\')
                || glob.startsWith('!')
                || /[\[\]{}]/u.test(glob)
                || /^[A-Za-z]:\//u.test(glob)
                || posix.isAbsolute(glob)
                || segments.some((/** @type {string | string[]} */ segment) => segment === ''
                    || segment === '.'
                    || segment === '..'
                    || (segment.includes('**') && segment !== '**'))
            ) {
                throw new Error(`profile.codeMaps.${key} contains an unsupported Repository-relative glob.`);
            }
        }
    }
    return {
        codeMaps: {
            excludes: uniqueSorted(excludes),
            includes: uniqueSorted(includes),
            roots: uniqueSorted(roots),
        },
        domainLayout: profile.domainLayout,
        platforms: uniqueSorted(profile.platforms),
    };
};

const normalizeManagedTarget = (/** @type {unknown} */ record, /** @type {string} */ label) => {
    assertRecord(record, label);
    const keys = record.kind === 'region'
        ? ['documentOwnership', 'hash', 'kind', 'ownership', 'path', 'platforms']
        : ['hash', 'kind', 'ownership', 'path', 'platforms'];
    assertExactKeys(record, keys, label);
    assertString(record.kind, `${label}.kind`);
    if (!['file', 'region'].includes(record.kind)) throw new Error(`${label}.kind is unsupported.`);
    if (record.ownership !== 'managed') throw new Error(`${label}.ownership must be managed.`);
    assertSafePath(record.path, `${label}.path`);
    assertHash(record.hash, `${label}.hash`);
    assertStringArray(record.platforms, `${label}.platforms`, {allowEmpty: false});
    if (record.kind === 'region'
    ) {
        assertString(record.documentOwnership, `${label}.documentOwnership`);
        if (!['baseline-major', 'repository-major'].includes(record.documentOwnership)) {
            throw new Error(`${label}.documentOwnership is unsupported.`);
        }
    }
    return {
        ...(record.kind === 'region' ? {documentOwnership: record.documentOwnership} : {}),
        hash: record.hash,
        kind: record.kind,
        ownership: 'managed',
        path: record.path,
        platforms: uniqueSorted(record.platforms),
    };
};

const normalizeRepositoryOwnedSeed = (/** @type {unknown} */ record, /** @type {string} */ label) => {
    assertRecord(record, label);
    const declaredIdentity = record.strategy === 'declared-role-identity';
    const keys = declaredIdentity
        ? ['identity', 'kind', 'ownership', 'path', 'platform', 'strategy']
        : ['kind', 'ownership', 'path', 'strategy'];
    assertExactKeys(record, keys, label);
    if (record.ownership !== 'repository-owned-seed') {
        throw new Error(`${label}.ownership must be repository-owned-seed.`);
    }
    assertSafePath(record.path, `${label}.path`);
    if (record.strategy === 'regular-file') {
        if (record.kind !== 'file') throw new Error(`${label}.kind must be file.`);
        return {
            kind: 'file',
            ownership: 'repository-owned-seed',
            path: record.path,
            strategy: 'regular-file',
        };
    }
    if (!declaredIdentity || record.kind !== 'agent-role') {
        throw new Error(`${label}.strategy is unsupported.`);
    }
    assertString(record.identity, `${label}.identity`);
    if (!isSkillIdentity(record.identity)) throw new Error(`${label}.identity is invalid.`);
    assertString(record.platform, `${label}.platform`);
    if (!['claude-code', 'codex'].includes(record.platform)) throw new Error(`${label}.platform is unsupported.`);
    return {
        identity: record.identity,
        kind: 'agent-role',
        ownership: 'repository-owned-seed',
        path: record.path,
        platform: record.platform,
        strategy: 'declared-role-identity',
    };
};

/** @param {{path: string}[]} records @param {string} label */
const assertUniquePaths = (records, label) => {
    const paths = new Map();
    for (const record of records) {
        const folded = record.path.toLowerCase();
        if (paths.has(folded)) throw new Error(`${label} contains a duplicate or case-colliding path: ${record.path}.`);
        paths.set(folded, record.path);
    }
};

const normalizeCurrentLock = (/** @type {unknown} */ lock) => {
    assertExactKeys(lock, ['lockSchemaVersion', 'managedTargets', 'profile', 'repositoryOwnedSeeds'], 'Workflow lock');
    if (lock.lockSchemaVersion !== CURRENT_LOCK_SCHEMA_VERSION) {
        throw new Error(`Expected lockSchemaVersion ${CURRENT_LOCK_SCHEMA_VERSION}.`);
    }
    if (!Array.isArray(lock.managedTargets)) throw new Error('managedTargets must be an array.');
    if (!Array.isArray(lock.repositoryOwnedSeeds)) throw new Error('repositoryOwnedSeeds must be an array.');
    const profile = normalizeWorkflowProfile(lock.profile);
    const managedTargets = lock.managedTargets
        .map((record, index) => normalizeManagedTarget(record, `managedTargets[${index}]`))
        .sort((left, right) => compareText(left.path, right.path) || compareText(left.kind, right.kind));
    const repositoryOwnedSeeds = lock.repositoryOwnedSeeds
        .map((record, index) => normalizeRepositoryOwnedSeed(record, `repositoryOwnedSeeds[${index}]`))
        .sort((left, right) => compareText(left.path, right.path) || compareText(left.kind, right.kind));
    assertUniquePaths(managedTargets, 'managedTargets');
    assertUniquePaths(repositoryOwnedSeeds, 'repositoryOwnedSeeds');
    assertUniquePaths([...managedTargets, ...repositoryOwnedSeeds], 'Workflow lock targets');
    const selected = new Set(profile.platforms);
    for (const [index, record] of managedTargets.entries()) {
        for (const platform of record.platforms) {
            if (!selected.has(platform)) {
                throw new Error(`managedTargets[${index}] references a platform outside the Profile: ${platform}.`);
            }
        }
    }
    for (const [index, record] of repositoryOwnedSeeds.entries()) {
        if (record.kind === 'agent-role') {
            if (record.platform === undefined) throw new Error(`repositoryOwnedSeeds[${index}] is missing its platform.`);
            if (!selected.has(record.platform)) {
                throw new Error(`repositoryOwnedSeeds[${index}] references a platform outside the Profile: ${record.platform}.`);
            }
        }
    }
    return {
        lockSchemaVersion: CURRENT_LOCK_SCHEMA_VERSION,
        managedTargets,
        profile,
        repositoryOwnedSeeds,
    };
};

/** @param {{managedTargets: unknown[], profile: unknown, repositoryOwnedSeeds: unknown[]}} input */
export const createWorkflowLock = ({managedTargets, profile, repositoryOwnedSeeds}) => normalizeCurrentLock({
    lockSchemaVersion: CURRENT_LOCK_SCHEMA_VERSION,
    managedTargets,
    profile,
    repositoryOwnedSeeds,
});

/** @param {unknown} lock */
export const serializeWorkflowLock = lock => canonicalJson(normalizeCurrentLock(lock));

const normalizeLegacyProjection = (/** @type {unknown} */ projection, /** @type {string} */ label) => {
    assertExactKeys(projection, ['platform', 'projectionContractVersion'], label);
    assertString(projection.platform, `${label}.platform`);
    assertVersion(projection.projectionContractVersion, `${label}.projectionContractVersion`);
    return {platform: projection.platform, projectionContractVersion: projection.projectionContractVersion};
};

const normalizeLegacyManagedRecord = (/** @type {unknown} */ record, /** @type {string} */ label) => {
    assertRecord(record, label);
    const keys = record.kind === 'region'
        ? ['canonicalObjectId', 'documentOwnership', 'hash', 'kind', 'path', 'projections', 'regionId']
        : ['canonicalObjectId', 'hash', 'kind', 'path', 'projections'];
    assertExactKeys(record, keys, label);
    assertString(record.kind, `${label}.kind`);
    if (!['file', 'region'].includes(record.kind)) throw new Error(`${label}.kind is unsupported.`);
    assertString(record.canonicalObjectId, `${label}.canonicalObjectId`);
    assertSafePath(record.path, `${label}.path`);
    assertHash(record.hash, `${label}.hash`);
    if (record.kind === 'region') {
        assertString(record.regionId, `${label}.regionId`);
        assertString(record.documentOwnership, `${label}.documentOwnership`);
        if (!['baseline-major', 'repository-major'].includes(record.documentOwnership)) {
            throw new Error(`${label}.documentOwnership is unsupported.`);
        }
    }
    if (!Array.isArray(record.projections) || record.projections.length === 0) {
        throw new Error(`${label}.projections must be a non-empty array.`);
    }
    const projections = record.projections
        .map((projection, index) => normalizeLegacyProjection(projection, `${label}.projections[${index}]`))
        .sort((left, right) => compareText(left.platform, right.platform));
    if (new Set(projections.map(projection => projection.platform)).size !== projections.length) {
        throw new Error(`${label}.projections contains a duplicate platform.`);
    }
    return {
        canonicalObjectId: record.canonicalObjectId,
        ...(record.kind === 'region' ? {documentOwnership: record.documentOwnership} : {}),
        hash: record.hash,
        kind: record.kind,
        path: record.path,
        projections,
        ...(record.kind === 'region' ? {regionId: record.regionId} : {}),
    };
};

const normalizeLegacyLock = (/** @type {unknown} */ lock) => {
    assertExactKeys(lock, ['distribution', 'lockSchemaVersion', 'managedContent', 'policies', 'profile', 'projections'], 'Workflow lock');
    if (lock.lockSchemaVersion !== 1) throw new Error('Expected lockSchemaVersion 1.');
    assertExactKeys(lock.distribution, ['digest', 'distributionContractVersion', 'minimumArwVersion', 'provenance', 'sourceArwVersion'], 'distribution');
    assertHash(lock.distribution.digest, 'distribution.digest');
    assertVersion(lock.distribution.distributionContractVersion, 'distribution.distributionContractVersion');
    assertString(lock.distribution.minimumArwVersion, 'distribution.minimumArwVersion');
    assertString(lock.distribution.sourceArwVersion, 'distribution.sourceArwVersion');
    assertExactKeys(lock.distribution.provenance, ['arwModification', 'commit', 'license', 'repository'], 'distribution.provenance');
    for (const key of ['arwModification', 'commit', 'license', 'repository']) {
        assertString(lock.distribution.provenance[key], `distribution.provenance.${key}`);
    }
    assertExactKeys(lock.policies, ['arwignore'], 'policies');
    assertExactKeys(lock.policies.arwignore, ['path', 'schemaVersion'], 'policies.arwignore');
    if (lock.policies.arwignore.path !== '.arwignore' || lock.policies.arwignore.schemaVersion !== 1) {
        throw new Error('policies.arwignore does not match the v1 policy contract.');
    }
    if (!Array.isArray(lock.projections)) throw new Error('projections must be an array.');
    if (!Array.isArray(lock.managedContent)) throw new Error('managedContent must be an array.');
    const profile = normalizeWorkflowProfile(lock.profile);
    const projections = lock.projections
        .map((projection, index) => normalizeLegacyProjection(projection, `projections[${index}]`))
        .sort((left, right) => compareText(left.platform, right.platform));
    if (new Set(projections.map(projection => projection.platform)).size !== projections.length) {
        throw new Error('projections contains a duplicate platform.');
    }
    if (profile.platforms.length !== projections.length
        || profile.platforms.some((platform, index) => platform !== projections[index].platform)) {
        throw new Error('profile platforms and projections must match exactly.');
    }
    const projectionKeys = new Set(projections.map(projection => `${projection.platform}@${projection.projectionContractVersion}`));
    const managedContent = lock.managedContent
        .map((record, index) => normalizeLegacyManagedRecord(record, `managedContent[${index}]`))
        .sort((left, right) => compareText(left.path, right.path)
            || compareText(left.kind, right.kind)
            || compareText(left.canonicalObjectId, right.canonicalObjectId));
    assertUniquePaths(managedContent, 'managedContent');
    for (const [index, record] of managedContent.entries()) {
        for (const projection of record.projections) {
            if (!projectionKeys.has(`${projection.platform}@${projection.projectionContractVersion}`)) {
                throw new Error(`managedContent[${index}] references an unavailable projection.`);
            }
        }
    }
    return {
        distribution: {
            digest: lock.distribution.digest,
            distributionContractVersion: lock.distribution.distributionContractVersion,
            minimumArwVersion: lock.distribution.minimumArwVersion,
            provenance: {...lock.distribution.provenance},
            sourceArwVersion: lock.distribution.sourceArwVersion,
        },
        lockSchemaVersion: 1,
        managedContent,
        policies: {arwignore: {path: '.arwignore', schemaVersion: 1}},
        profile,
        projections,
    };
};

/** @param {ReturnType<typeof normalizeLegacyLock>} legacy */
const migrateLegacyLock = legacy => ({
    lockSchemaVersion: CURRENT_LOCK_SCHEMA_VERSION,
    managedTargets: legacy.managedContent.map(record => ({
        ...(record.kind === 'region' ? {documentOwnership: record.documentOwnership} : {}),
        hash: record.hash,
        kind: record.kind,
        ownership: 'managed',
        path: record.path,
        platforms: uniqueSorted(record.projections.map(projection => projection.platform)),
    })),
    profile: legacy.profile,
    repositoryOwnedSeeds: [{
        kind: 'file',
        ownership: 'repository-owned-seed',
        path: legacy.policies.arwignore.path,
        strategy: 'regular-file',
    }],
});

registeredMigrators.set(1, migrateLegacyLock);

export const parseWorkflowLock = (/** @type {string | Buffer<ArrayBufferLike>} */ source) => {
    const parsedResult = parseJsonText(source);
    if (parsedResult.status !== 'succeeded') throw new Error('Workflow lock is not valid JSON text.');
    const sourceText = Buffer.isBuffer(source) ? source.toString('utf8') : source;
    if (!('value' in parsedResult)) throw new Error('Workflow lock JSON result is missing its value.');
    const parsed = parsedResult.value;
    assertRecord(parsed, 'Workflow lock');
    if (typeof parsed.lockSchemaVersion !== 'number' || !Number.isSafeInteger(parsed.lockSchemaVersion)) {
        throw new Error('Workflow lock is missing an integer lockSchemaVersion.');
    }
    if (parsed.lockSchemaVersion > CURRENT_LOCK_SCHEMA_VERSION) {
        throw new Error(`Unsupported future lockSchemaVersion: ${parsed.lockSchemaVersion}.`);
    }
    if (parsed.lockSchemaVersion < CURRENT_LOCK_SCHEMA_VERSION) {
        const migrator = registeredMigrators.get(parsed.lockSchemaVersion);
        if (!migrator) throw new Error(`Unsupported old lockSchemaVersion: ${parsed.lockSchemaVersion}.`);
        const legacy = normalizeLegacyLock(parsed);
        if (canonicalJson(legacy) !== sourceText) throw new Error('Workflow lock is not canonical JSON.');
        return normalizeCurrentLock(migrator(legacy));
    }
    const normalized = normalizeCurrentLock(parsed);
    if (canonicalJson(normalized) !== sourceText) throw new Error('Workflow lock is not canonical JSON.');
    return normalized;
};

const sha256 = (/** @type {import("crypto").BinaryLike} */ bytes) => createHash('sha256').update(bytes).digest('hex');
const occurrences = (/** @type {string} */ text, /** @type {string | RegExp} */ marker) => [...text.matchAll(new RegExp(marker, 'gu'))];

const extractManagedSpan = (/** @type {string} */ text, /** @type {string} */ path, /** @type {unknown} */ documentOwnership) => {
    const starts = occurrences(text, MANAGED_START);
    const ends = occurrences(text, MANAGED_END);
    const repositoryStarts = occurrences(text, REPOSITORY_START);
    const repositoryEnds = occurrences(text, REPOSITORY_END);
    const managedMarkersValid = starts.length === 1 && ends.length === 1 && starts[0].index < ends[0].index;
    const managedEnd = managedMarkersValid ? ends[0].index + MANAGED_END.length : -1;
    const repositoryMajorValid = documentOwnership === 'repository-major'
        && managedMarkersValid
        && repositoryStarts.length === 0
        && repositoryEnds.length === 0;
    const baselineMajorValid = documentOwnership === 'baseline-major'
        && managedMarkersValid
        && starts[0].index === 0
        && repositoryStarts.length === 1
        && repositoryEnds.length === 1
        && repositoryStarts[0].index === managedEnd + 1
        && text.slice(managedEnd, repositoryStarts[0].index) === '\n'
        && repositoryStarts[0].index < repositoryEnds[0].index
        && repositoryEnds[0].index + REPOSITORY_END.length === text.length - 1
        && text.endsWith('\n');
    if (!repositoryMajorValid && !baselineMajorValid) {
        return {diagnostic: {code: 'invalid-managed-region', path}};
    }
    return {span: text.slice(starts[0].index, managedEnd)};
};

/** @typedef {{files: Record<string, {bytes: Buffer | null, observed: {kind: string}}>} } WorkflowRepositoryState */

/** @param {{lock: unknown, repositoryRoot?: string, repositoryState?: WorkflowRepositoryState}} input */
export const verifyManagedTargets = async ({lock, repositoryRoot, repositoryState}) => {
    const current = normalizeCurrentLock(lock);
    /** @type {Record<string, unknown>[]} */
    const diagnostics = [];
    /** @type {Awaited<ReturnType<typeof createScopedFilesystem>> | null} */
    let createdFilesystem = null;
    let filesystem;
    if (repositoryState === undefined) {
        if (repositoryRoot === undefined) throw new Error('repositoryRoot is required without Repository state.');
        const created = await createScopedFilesystem({root: repositoryRoot});
        if (created.status !== 'succeeded') {
            return {diagnostics: created.diagnostics, satisfied: false};
        }
        createdFilesystem = created;
        filesystem = created.scopedFilesystem;
    }
    for (const record of current.managedTargets) {
        let bytes;
        if (repositoryState !== undefined) {
            const file = repositoryState.files[record.path];
            if (file === undefined) throw new Error(`Repository state is missing requested path: ${record.path}.`);
            if (file.observed.kind === 'missing') {
                diagnostics.push({code: 'managed-content-missing', path: record.path});
                continue;
            }
            if (file.observed.kind !== 'file') {
                diagnostics.push({code: 'managed-content-kind-invalid', path: record.path});
                continue;
            }
            if (file.bytes === null) {
                diagnostics.push({code: 'managed-content-unreadable', path: record.path});
                continue;
            }
            bytes = file.bytes;
        } else {
            if (filesystem === undefined || createdFilesystem === null) {
                throw new Error('Workflow lock filesystem is unavailable.');
            }
            const inspected = await filesystem.inspect({path: record.path});
            if (inspected.status !== 'succeeded') {
                diagnostics.push(...inspected.diagnostics);
                continue;
            }
            if (inspected.entry.kind === 'missing') {
                diagnostics.push({code: 'managed-content-missing', path: record.path});
                continue;
            }
            if (inspected.entry.kind !== 'file') {
                diagnostics.push({code: 'managed-content-kind-invalid', path: record.path});
                continue;
            }
            const read = await filesystem.read({path: record.path});
            if (read.status !== 'succeeded') {
                diagnostics.push(...read.diagnostics);
                continue;
            }
            bytes = read.bytes;
        }
        if (record.kind === 'file') {
            if (sha256(bytes) !== record.hash) diagnostics.push({code: 'managed-content-drift', path: record.path});
            continue;
        }
        const extracted = extractManagedSpan(bytes.toString('utf8'), record.path, record.documentOwnership);
        if (extracted.diagnostic) {
            diagnostics.push(extracted.diagnostic);
        } else if (sha256(extracted.span) !== record.hash) {
            diagnostics.push({code: 'managed-content-drift', path: record.path});
        }
    }
    return {diagnostics, satisfied: diagnostics.length === 0};
};

export const verifyManagedContent = verifyManagedTargets;

/** @param {{managedTargets: ReturnType<typeof normalizeCurrentLock>['managedTargets'], remainingPlatforms: string[]}} input */
export const selectRemovableManagedContent = ({managedTargets, remainingPlatforms}) => {
    const remaining = new Set(remainingPlatforms);
    return managedTargets.filter(record => record.platforms.every(platform => !remaining.has(platform)));
};

/** @param {{lock: unknown, remainingPlatforms: string[], repositoryRoot: string}} input */
export const planManagedContentRemoval = async ({lock, remainingPlatforms, repositoryRoot}) => {
    const current = normalizeCurrentLock(lock);
    const verification = await verifyManagedTargets({lock: current, repositoryRoot});
    if (!verification.satisfied) return {...verification, removable: []};
    return {
        diagnostics: [],
        removable: selectRemovableManagedContent({managedTargets: current.managedTargets, remainingPlatforms}),
        satisfied: true,
    };
};
