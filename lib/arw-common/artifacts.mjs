import {hasLegacyIssueShape, isIssueBlocked, isIssueExecutable, readIssueDocuments} from './issue-documents.mjs';
import {createScopedFilesystem, joinRelativePath} from '../common/filesystem.mjs';
import {formatTextTable} from '../common/text-table.mjs';
import {
    ARTIFACT_EFFORT_DIRECTORY_PATTERN,
    ARTIFACT_ISSUE_FILE_PATTERN,
    ARTIFACT_SLUG_PATTERN,
    formatCanonicalArtifactId,
    parseCanonicalArtifactId,
    parseRegisteredArtifactPath,
} from './artifact-identity.mjs';

export {
    ARTIFACT_EFFORT_DIRECTORY_PATTERN,
    ARTIFACT_ISSUE_FILE_PATTERN,
    ARTIFACT_SLUG_PATTERN,
    formatArtifactIdentityKey,
    compareCanonicalArtifactIds,
    formatCanonicalArtifactId,
    parseCanonicalArtifactId,
    parseEffortDirectoryName,
    parseIssueFilename,
    parseRegisteredArtifactPath,
} from './artifact-identity.mjs';

export const ISSUE_FILE_PATTERN = ARTIFACT_ISSUE_FILE_PATTERN;
export const SLUG_PATTERN = ARTIFACT_SLUG_PATTERN;
const NUMERIC_ISSUE_FILE_PATTERN = /^\d+-[a-z0-9][a-z0-9-]*\.md$/u;
const INVALID_EFFORT_NUMBER_PREFIX_PATTERN = /^(?:0000|\d{5,})-/u;
const DEFINITIONS = {
    issue: {heading: 'Issue', plural: 'issues'},
    map: {filename: 'map.md', heading: 'Map', plural: 'maps'},
    spec: {filename: 'spec.md', heading: 'Spec', plural: 'specs'},
};

/** @typedef {'issue' | 'map' | 'spec'} ArtifactKind */
/** @typedef {'invalid' | 'irrelevant' | 'legacy' | 'registered'} ArtifactClassification */
/** @typedef {{message: string, path: string}} ArtifactDiagnostic */
/** @typedef {{effortNumber: string, id: string, path: string, relativePath: string, title: string}} ProjectionRecord */
/** @typedef {ReturnType<typeof readIssueDocuments>['records'][number]} IssueRecord */
/** @typedef {{effort: string, number: string, path: string, relativePath: string, sourceKey: string, text: string}} IssueDocument */
/** @typedef {{effort: string, effortNumber: string | null, number: string | null, path: string, relativePath: string}} IssueSource */
/** @typedef {{effort: string, path: string, relativePath: string, targetPath: string, targetRelativePath: string, text: string}} LegacySpec */
/** @typedef {{classification: ArtifactClassification, kind: ArtifactKind | null, relativePath: string}} ArtifactPath */
/** @typedef {{canonical: boolean, migratable: boolean, name: string, number: string | null, path: string, slug: string | null}} ArtifactDirectory */
/** @typedef {{root: string, scratchDirectory: string}} ArtifactRepository */
/** @typedef {{diagnostics: Array<{code: string, message: string, path?: string}>, entry?: {kind: string, path: string}, entries?: Array<{kind: string, path: string}>, stage?: string, status: 'blocked' | 'failed' | 'succeeded', text?: string}} ArtifactFilesystemResult */
/** @typedef {{absolutePath?: string, diagnostics: Array<{code: string, message: string, path?: string}>, relativePath?: string, status: 'blocked' | 'succeeded'}} ArtifactPathResult */
/** @typedef {{inspect: (input: {path: string}) => Promise<ArtifactFilesystemResult>, list: (input: {path: string}) => Promise<ArtifactFilesystemResult>, readText: (input: {allowLossyDecoding: boolean, path: string}) => Promise<ArtifactFilesystemResult>, resolve: (input: {path: string}) => ArtifactPathResult}} ArtifactFilesystem */
/** @typedef {{diagnostics: Record<ArtifactKind, ArtifactDiagnostic[]>, errors: Record<ArtifactKind, Error | null>, issueSources: IssueSource[], legacyDetected: boolean, migration: {diagnostics: ArtifactDiagnostic[], effortDirectories: ArtifactDirectory[], issueDocuments: IssueDocument[], legacySpecs: LegacySpec[]}, paths: ArtifactPath[], records: {issue: IssueRecord[], map: ProjectionRecord[], spec: ProjectionRecord[]}}} ArtifactInventory */
/** @typedef {{allStatuses?: boolean, status?: string[] | null, type?: string[] | null}} ArtifactListOptions */

/** @type {ArtifactKind[]} */
const ARTIFACT_KINDS = ['issue', 'map', 'spec'];

const compareStrings = (/** @type {string | number} */ left, /** @type {string | number} */ right) => left < right ? -1 : left > right ? 1 : 0;

const toRelativePath = (/** @type {string} */ path) => path.startsWith('.') ? path : `./${path}`;

const pathName = (/** @type {string} */ path) => path.slice(path.lastIndexOf('/') + 1);

/** @param {ArtifactFilesystem} fileSystem @param {string} path */
const toAbsolutePath = (fileSystem, path) => {
    const resolved = fileSystem.resolve({path});
    if (resolved.status !== 'succeeded' || resolved.absolutePath === undefined) {
        throw new Error(`ARW Artifact path escapes the Repository: ${path}.`);
    }
    return resolved.absolutePath;
};

const firstHeading = (/** @type {string} */ text) => {
    let fenced = false;

    for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
        if (/^\s*(```|~~~)/.test(line)) {
            fenced = !fenced;
            continue;
        }

        if (!fenced) {
            const match = /^# (.+?)\s*$/.exec(line);
            if (match && match[1].trim().length > 0) {
                return match[1].trim();
            }
        }
    }

    return null;
};

/** @param {ArtifactInventory} inventory @param {ArtifactKind} kind @param {string} path @param {string} message */
const addDiagnostic = (inventory, kind, path, message) => {
    inventory.diagnostics[kind].push({message, path});
};

/** @param {ArtifactInventory} inventory @param {string} path @param {string} message */
const addMigrationDiagnostic = (inventory, path, message) => {
    inventory.migration.diagnostics.push({message, path});
};

/** @param {ArtifactInventory} inventory @param {string} relativePath @param {ArtifactKind | null} kind @param {ArtifactClassification} classification */
const addPath = (inventory, relativePath, kind, classification) => {
    inventory.paths.push({classification, kind, relativePath});
};

/** @param {ArtifactInventory} inventory @param {ArtifactDirectory} directory @param {'map' | 'spec'} kind @param {ArtifactFilesystem} fileSystem @param {Map<string, string>} entries */
const inspectProjection = async (inventory, directory, kind, fileSystem, entries) => {
    const definition = DEFINITIONS[kind];
    const logicalPath = joinRelativePath(directory.path, definition.filename);
    const relativePath = toRelativePath(logicalPath);
    const entryKind = entries.get(definition.filename);
    if (entryKind === undefined) return;

    if (!directory.canonical) {
        addPath(inventory, relativePath, kind, 'invalid');
        addDiagnostic(inventory, kind, relativePath, 'Artifact directory name is not a valid canonical ID.');
        return;
    }

    if (entryKind === 'link') {
        addPath(inventory, relativePath, kind, 'invalid');
        addDiagnostic(inventory, kind, relativePath, 'Symbolic links are not allowed in registered paths.');
        return;
    }

    if (entryKind !== 'file') {
        addPath(inventory, relativePath, kind, 'invalid');
        addDiagnostic(inventory, kind, relativePath, 'Registered artifact path must be a regular file.');
        return;
    }

    const read = await fileSystem.readText({allowLossyDecoding: false, path: logicalPath});
    if (read.status !== 'succeeded' || read.text === undefined) {
        addPath(inventory, relativePath, kind, 'invalid');
        addDiagnostic(inventory, kind, relativePath, 'Artifact file could not be read.');
        return;
    }

    const title = firstHeading(read.text);
    if (!title) {
        addPath(inventory, relativePath, kind, 'invalid');
        addDiagnostic(inventory, kind, relativePath, 'The artifact has no first level-one heading.');
        return;
    }

    addPath(inventory, relativePath, kind, 'registered');
    if (directory.number === null) throw new Error('Canonical artifact directory has no effort number.');
    const id = formatCanonicalArtifactId({effortNumber: directory.number, issueNumber: null, kind, qualifier: null});
    inventory.records[kind].push({effortNumber: directory.number, id, path: toAbsolutePath(fileSystem, logicalPath), relativePath, title});
};

/** @param {ArtifactInventory} inventory @param {ArtifactDirectory} directory @param {ArtifactFilesystem} fileSystem @param {Map<string, IssueDocument[]>} documentsByEffort @param {Map<string, string>} directoryEntries */
const inspectIssues = async (inventory, directory, fileSystem, documentsByEffort, directoryEntries) => {
    const issuesPath = joinRelativePath(directory.path, 'issues');
    const issuesRelativePath = toRelativePath(issuesPath);
    const issuesKind = directoryEntries.get('issues');
    if (issuesKind === undefined) return;

    if (issuesKind === 'link') {
        addDiagnostic(inventory, 'issue', issuesRelativePath, 'Symbolic links are not allowed in registered paths.');
        addMigrationDiagnostic(inventory, issuesRelativePath, 'Issue directory must not be a symbolic link.');
        return;
    }

    if (issuesKind !== 'directory') {
        addDiagnostic(inventory, 'issue', issuesRelativePath, 'Registered issues path is not a directory.');
        addMigrationDiagnostic(inventory, issuesRelativePath, 'Issue directory is not a usable directory.');
        return;
    }

    const listed = await fileSystem.list({path: issuesPath});
    if (listed.status !== 'succeeded' || listed.entries === undefined) {
        inventory.errors.issue ??= new Error(`The issues directory could not be read: ${issuesRelativePath}.`);
        addPath(inventory, issuesRelativePath, 'issue', 'invalid');
        addMigrationDiagnostic(inventory, issuesRelativePath, 'Issue directory could not be read.');
        return;
    }
    const entries = listed.entries;

    if (!directory.migratable) {
        addDiagnostic(inventory, 'issue', toRelativePath(directory.path), 'Effort directory name is not a valid slug.');
        for (const entry of entries) {
            const relativePath = toRelativePath(entry.path);
            addPath(inventory, relativePath, 'issue', 'invalid');
            addMigrationDiagnostic(inventory, relativePath, 'Issue path or filename cannot be converted deterministically.');
        }
        return;
    }

    for (const entry of entries) {
        const name = pathName(entry.path);
        const relativePath = toRelativePath(entry.path);
        const match = ISSUE_FILE_PATTERN.exec(name);

        if (!match) {
            if (NUMERIC_ISSUE_FILE_PATTERN.test(name)) {
                addPath(inventory, relativePath, 'issue', 'invalid');
                addDiagnostic(inventory, 'issue', relativePath, 'Issue filename has an invalid issue number.');
                addMigrationDiagnostic(inventory, relativePath, 'Issue path or filename cannot be converted deterministically.');
                continue;
            }
            addPath(inventory, relativePath, null, 'irrelevant');
            continue;
        }

        /** @type {IssueSource} */
        const source = {effort: directory.name, effortNumber: directory.number, number: null, path: toAbsolutePath(fileSystem, entry.path), relativePath};
        inventory.issueSources.push(source);

        if (entry.kind === 'link') {
            addPath(inventory, relativePath, 'issue', 'invalid');
            addDiagnostic(inventory, 'issue', relativePath, 'Symbolic links are not allowed in registered paths.');
            addMigrationDiagnostic(inventory, relativePath, 'Issue path or filename cannot be converted deterministically.');
            continue;
        }

        if (entry.kind !== 'file') {
            addPath(inventory, relativePath, 'issue', 'invalid');
            addDiagnostic(inventory, 'issue', relativePath, 'Registered issue path must be a regular file.');
            addMigrationDiagnostic(inventory, relativePath, 'Issue path or filename cannot be converted deterministically.');
            continue;
        }

        const groups = match.groups;
        if (groups === undefined) throw new Error('Canonical issue filename match has no named groups.');
        source.number = groups.number;
        const read = await fileSystem.readText({allowLossyDecoding: false, path: entry.path});
        if (read.status !== 'succeeded' || read.text === undefined) {
            addPath(inventory, relativePath, 'issue', 'invalid');
            addDiagnostic(inventory, 'issue', relativePath, 'Issue file could not be read.');
            addMigrationDiagnostic(inventory, relativePath, 'File could not be read.');
            continue;
        }

        const document = {
            effort: directory.name,
            number: groups.number,
            path: source.path,
            relativePath,
            sourceKey: relativePath,
            text: read.text,
        };
        inventory.migration.issueDocuments.push(document);

        inventory.legacyDetected ||= hasLegacyIssueShape(read.text);
        if (directory.canonical) {
            const documents = documentsByEffort.get(directory.name) ?? [];
            documents.push(document);
            documentsByEffort.set(directory.name, documents);
        } else {
            addPath(inventory, relativePath, 'issue', 'invalid');
            addDiagnostic(inventory, 'issue', relativePath, 'Effort directory is not numbered.');
        }
    }
};

/** @param {ArtifactInventory} inventory @param {ArtifactDirectory} directory @param {ArtifactFilesystem} fileSystem @param {Map<string, string>} entries */
const inspectLegacySpec = async (inventory, directory, fileSystem, entries) => {
    const logicalPath = joinRelativePath(directory.path, 'PRD.md');
    const relativePath = toRelativePath(logicalPath);
    const entryKind = entries.get('PRD.md');
    if (entryKind === undefined) return;

    if (!directory.migratable) {
        addMigrationDiagnostic(inventory, relativePath, 'Legacy PRD effort path cannot be converted deterministically.');
        return;
    }

    if (entryKind !== 'file') {
        addMigrationDiagnostic(inventory, relativePath, 'Legacy PRD is not a regular file.');
        return;
    }

    const read = await fileSystem.readText({allowLossyDecoding: false, path: logicalPath});
    if (read.status !== 'succeeded' || read.text === undefined) {
        addMigrationDiagnostic(inventory, relativePath, 'File could not be read.');
        return;
    }

    const targetLogicalPath = joinRelativePath(directory.path, 'spec.md');
    inventory.migration.legacySpecs.push({
        effort: directory.name,
        path: toAbsolutePath(fileSystem, logicalPath),
        relativePath,
        targetPath: toAbsolutePath(fileSystem, targetLogicalPath),
        targetRelativePath: toRelativePath(targetLogicalPath),
        text: read.text,
    });
};

/** @param {ArtifactInventory} inventory @param {Map<string, IssueDocument[]>} documentsByEffort */
const classifyIssueDocuments = (inventory, documentsByEffort) => {
    const registeredNumbers = new Set(inventory.issueSources.filter(source => source.number).map(source => `${source.effortNumber}:${source.number}`));

    for (const documents of documentsByEffort.values()) {
        const result = readIssueDocuments(documents);
        const validSources = new Set(result.records.map(record => record.sourceKey));
        inventory.records.issue.push(...result.records);

        for (const document of documents) {
            addPath(inventory, document.sourceKey, 'issue', validSources.has(document.sourceKey) ? 'registered' : 'invalid');
        }

        for (const diagnostic of result.diagnostics) {
            const unresolved = diagnostic.unresolvedReference;
            const message = unresolved && registeredNumbers.has(`${unresolved.effortNumber}:${unresolved.number}`)
                ? `Blocked by references malformed issue ${unresolved.number}.`
                : diagnostic.message;
            addDiagnostic(inventory, 'issue', diagnostic.sourceKey, message);
        }
    }
};

/**
 * 只读扫描一个 Repository 的 `.scratch`, 对观察到的路径分类并生成三种 Artifact records, kind-scoped diagnostics, 全局 legacy evidence 与 Artifact migration sources.
 * 可选 filesystem adapter 只用于确定性测试 I/O failure; production caller 不需要提供 parser, formatter, filter 或 path callbacks.
 * Migration sources 只包含已读取的 Issue/PRD inputs 与 discovery diagnostics, 不包含 mutation plan; Inventory 不跟随 symbolic links, 所有对外路径都使用 Repository-relative slash form.
 */
/** @param {ArtifactRepository} repository @param {ArtifactFilesystem} [fileSystem] @returns {Promise<ArtifactInventory>} */
export const readArtifactInventory = async (repository, fileSystem = undefined) => {
    /** @type {ArtifactInventory} */
    const inventory = {
        diagnostics: {issue: [], map: [], spec: []},
        errors: {issue: null, map: null, spec: null},
        issueSources: [],
        legacyDetected: false,
        migration: {diagnostics: [], effortDirectories: [], issueDocuments: [], legacySpecs: []},
        paths: [],
        records: {issue: [], map: [], spec: []},
    };
    let filesystem = fileSystem;
    if (filesystem === undefined) {
        const created = await createScopedFilesystem({root: repository.root});
        if (created.status !== 'succeeded') throw new Error('The Repository filesystem could not be opened.');
        filesystem = created.scopedFilesystem;
    }
    const scratch = await filesystem.inspect({path: '.scratch'});
    if (scratch.status === 'succeeded' && scratch.entry?.kind === 'missing') return inventory;
    if (scratch.status !== 'succeeded' || scratch.entry?.kind !== 'directory') {
        throw new Error('The .scratch directory could not be read.');
    }
    const listed = await filesystem.list({path: '.scratch'});
    if (listed.status !== 'succeeded' || listed.entries === undefined) throw new Error('The .scratch directory could not be read.');
    const entries = listed.entries;

    /** @type {Map<string, IssueDocument[]>} */
    const documentsByEffort = new Map();
    /** @type {Map<string, number>} */
    const effortNumberCounts = new Map();
    for (const entry of entries) {
        if (entry.kind !== 'directory') continue;
        const match = ARTIFACT_EFFORT_DIRECTORY_PATTERN.exec(pathName(entry.path));
        const number = match?.groups?.number;
        if (number !== undefined) effortNumberCounts.set(number, (effortNumberCounts.get(number) ?? 0) + 1);
    }

    for (const entry of entries) {
        const name = pathName(entry.path);
        const relativePath = toRelativePath(entry.path);

        if (entry.kind === 'link') {
            addPath(inventory, relativePath, null, 'invalid');
            addMigrationDiagnostic(inventory, relativePath, 'Symbolic links cannot be converted deterministically.');
            for (const kind of ARTIFACT_KINDS) {
                addDiagnostic(inventory, kind, relativePath, 'Symbolic links are not allowed in registered paths.');
            }
            continue;
        }

        if (entry.kind !== 'directory') {
            addPath(inventory, relativePath, null, 'irrelevant');
            continue;
        }

        const effortMatch = ARTIFACT_EFFORT_DIRECTORY_PATTERN.exec(name);
        const number = effortMatch?.groups?.number ?? null;
        const invalidEffortNumber = effortMatch === null && INVALID_EFFORT_NUMBER_PREFIX_PATTERN.test(name);
        const slug = effortMatch?.groups?.slug ?? (!invalidEffortNumber && SLUG_PATTERN.test(name) ? name : null);
        const duplicateNumber = number !== null && (effortNumberCounts.get(number) ?? 0) > 1;
        const directory = {
            canonical: number !== null && !duplicateNumber,
            migratable: slug !== null,
            name,
            number,
            path: entry.path,
            slug,
        };
        inventory.migration.effortDirectories.push(directory);
        if (invalidEffortNumber) {
            for (const kind of ARTIFACT_KINDS) {
                addDiagnostic(inventory, kind, relativePath, 'Effort directory has an invalid effort number.');
            }
            addMigrationDiagnostic(inventory, relativePath, 'Effort directory has an invalid effort number.');
        }
        if (duplicateNumber) {
            for (const kind of ARTIFACT_KINDS) {
                addDiagnostic(inventory, kind, relativePath, `Duplicate effort number ${number}.`);
            }
            addMigrationDiagnostic(inventory, relativePath, `Duplicate effort number ${number}.`);
        }
        const directoryList = await filesystem.list({path: entry.path});
        if (directoryList.status !== 'succeeded' || directoryList.entries === undefined) {
            addMigrationDiagnostic(inventory, relativePath, 'Effort directory could not be read.');
            for (const kind of ARTIFACT_KINDS) {
                inventory.errors[kind] ??= new Error(`The effort directory could not be read: ${relativePath}.`);
                addDiagnostic(inventory, kind, relativePath, 'Effort directory could not be read.');
            }
        }
        const directoryEntries = directoryList.status === 'succeeded' && directoryList.entries !== undefined
            ? directoryList.entries
            : [];
        const entryKinds = new Map(directoryEntries.map(child => [pathName(child.path), child.kind]));

        for (const child of directoryEntries) {
            const childName = pathName(child.path);
            const childRelativePath = toRelativePath(child.path);
            if (childName === 'PRD.md') {
                addPath(inventory, childRelativePath, 'spec', 'legacy');
                inventory.legacyDetected = true;
            } else if (!['issues', 'map.md', 'spec.md'].includes(childName)) {
                addPath(inventory, childRelativePath, null, 'irrelevant');
            }
        }

        await inspectIssues(inventory, directory, filesystem, documentsByEffort, entryKinds);
        await inspectLegacySpec(inventory, directory, filesystem, entryKinds);
        await inspectProjection(inventory, directory, 'map', filesystem, entryKinds);
        await inspectProjection(inventory, directory, 'spec', filesystem, entryKinds);
    }

    classifyIssueDocuments(inventory, documentsByEffort);

    for (const kind of ARTIFACT_KINDS) {
        inventory.diagnostics[kind].sort((left, right) => compareStrings(left.path, right.path) || compareStrings(left.message, right.message));
        inventory.records[kind].sort((left, right) => compareStrings(left.id, right.id));
    }
    inventory.paths.sort((left, right) => compareStrings(left.relativePath, right.relativePath));
    inventory.migration.diagnostics.sort((left, right) => compareStrings(left.path, right.path));

    return inventory;
};

export const parseArtifactIdentifier = (/** @type {ArtifactKind} */ kind, /** @type {unknown} */ value) => {
    const parsed = parseCanonicalArtifactId(value);
    if (parsed.kind !== kind) throw new Error(`Canonical ID must identify an ${kind} artifact.`);
    return parsed;
};

/** @param {ArtifactKind} kind @param {Array<IssueRecord | ProjectionRecord>} records */
const renderList = (kind, records) => {
    if (records.length === 0) {
        return `No matching ${DEFINITIONS[kind].plural}.`;
    }

    if (kind === 'issue') {
        return formatTextTable(['Status', 'Type', 'Issue', 'Title'], records.map(record => {
            if (!('status' in record) || !('kind' in record) || typeof record.status !== 'string' || typeof record.kind !== 'string') {
                throw new Error('Issue record is missing its status or type.');
            }
            return [record.status, record.kind, record.id, record.title];
        }));
    }

    return formatTextTable([DEFINITIONS[kind].heading, 'Title'], records.map(record => [record.id, record.title]));
};

/**
 * 从 Repository inventory 投影一个 kind 的 list result, 在 module 内完成 Issue filters 与 kind-specific table rendering.
 * 返回值只携带目标 kind diagnostics, 但保留 Repository 级 legacy evidence 供 ARW caller 决定是否输出 upgrade hint.
 */
/** @param {ArtifactInventory} inventory @param {ArtifactKind} kind @param {ArtifactListOptions} [options] */
export const listArtifacts = (inventory, kind, options = {}) => {
    if (inventory.errors[kind]) {
        throw inventory.errors[kind];
    }

    if (kind === 'issue') {
        let records = inventory.records.issue;
        if (options.status) {
            const statuses = options.status;
            records = records.filter(record => statuses.includes(record.status));
        } else if (!options.allStatuses) {
            records = records.filter(record => isIssueExecutable(record) && !isIssueBlocked(record));
        }

        if (options.type) {
            const types = options.type;
            records = records.filter(record => types.includes(record.kind));
        }

        return {
            diagnostics: inventory.diagnostics.issue,
            legacyDetected: inventory.legacyDetected,
            output: renderList('issue', records),
        };
    }

    return {
        diagnostics: inventory.diagnostics[kind],
        legacyDetected: inventory.legacyDetected,
        output: renderList(kind, inventory.records[kind]),
    };
};

/**
 * 解析 canonical Artifact ID 并从 inventory 返回已经通过 path-safety 检查的 editor target.
 * Malformed target 通过 diagnostics 与空 target 表达; missing target 另带稳定 not-found message, caller 不需要拼 registered path.
 */
/** @param {ArtifactInventory} inventory @param {unknown} idValue */
export const resolveArtifactTarget = (inventory, idValue) => {
    const id = parseCanonicalArtifactId(idValue);
    const kind = id.kind;
    if (inventory.errors[kind]) {
        throw inventory.errors[kind];
    }
    if (id.qualifier !== null) throw new Error('Canonical ID must be local for Artifact path resolution.');

    const canonicalId = formatCanonicalArtifactId(id);
    /** @type {IssueSource | ProjectionRecord | undefined} */
    let source;
    if (kind === 'issue') {
        const record = inventory.records.issue.find(candidate => candidate.id === canonicalId);
        source = record === undefined
            ? undefined
            : inventory.issueSources.find(candidate => candidate.relativePath === record.sourceKey);
    } else if (kind === 'map') {
        source = inventory.records.map.find(candidate => candidate.id === canonicalId);
    } else {
        source = inventory.records.spec.find(candidate => candidate.id === canonicalId);
    }
    const relativePath = source?.relativePath ?? null;
    const effortPrefix = joinRelativePath('.scratch', `${id.effortNumber}-`);
    const diagnostics = inventory.diagnostics[kind].filter((/** @type {{ path: string; }} */ diagnostic) => (
        relativePath !== null
            ? diagnostic.path === relativePath || relativePath.startsWith(`${diagnostic.path}/`)
            : diagnostic.path.startsWith(effortPrefix)
    ));
    const label = DEFINITIONS[kind].heading;

    return {
        diagnostics,
        legacyDetected: inventory.legacyDetected,
        notFoundMessage: `${label} not found: ${canonicalId}`,
        target: source && relativePath ? {path: source.path, relativePath} : null,
    };
};

/**
 * 比较 committed tree 与 candidate tree 中已经登记的 Artifact 身份.
 * 描述性 slug 可以改变, 但 candidate 不能删除或重复使用任何 committed 类型和编号.
 * @param {{candidateFiles: Map<string, {mode: string}>, committedFiles: Map<string, {mode: string}>}} input
 */
export const compareCommittedArtifactIdentities = ({candidateFiles, committedFiles}) => {
    const collect = (/** @type {Map<string, {mode: string}>} */ files) => {
        const identities = new Map();
        for (const [path, file] of files) {
            if (!file.mode.startsWith('100')) continue;
            try {
                const parsed = parseRegisteredArtifactPath(path);
                const paths = identities.get(parsed.canonicalId) ?? [];
                paths.push(path);
                identities.set(parsed.canonicalId, paths);
            } catch {
                // 未登记路径不属于 committed Artifact identity 合同.
            }
        }
        return identities;
    };
    const committed = collect(committedFiles);
    const candidate = collect(candidateFiles);
    const diagnostics = [];
    for (const [id, paths] of candidate) {
        if (paths.length > 1) {
            diagnostics.push({message: `Candidate contains duplicate ARW Artifact identity: ${id}.`, path: paths.sort(compareStrings)[0]});
        }
    }
    for (const [id, paths] of committed) {
        if (!candidate.has(id)) {
            diagnostics.push({message: `Committed ARW Artifact identity must be retained: ${id}.`, path: paths.sort(compareStrings)[0]});
        }
    }
    diagnostics.sort((left, right) => compareStrings(left.path, right.path) || compareStrings(left.message, right.message));
    return diagnostics;
};
