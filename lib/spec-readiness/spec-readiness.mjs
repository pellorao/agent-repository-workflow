import {randomUUID} from 'node:crypto';
import {dirname, isAbsolute, sep} from 'node:path';

import {readIssueRequirement} from '../arw-common/issue-documents.mjs';
import {
    formatArtifactIdentityKey,
    parseCanonicalArtifactId,
    parseRegisteredArtifactPath,
    readArtifactInventory,
} from '../arw-common/artifacts.mjs';
import {createCurrentPlatformAdapter} from '../arw-common/platform-adapter.mjs';
import {createTemporaryWorkspace} from '../arw-common/temporary-workspace.mjs';
import {
    createScopedFilesystem,
    joinRelativePath,
    resolveAbsolutePathWithinScope,
    resolveRelativePathWithinScope,
} from '../common/filesystem.mjs';
import {normalizeBodyEvidence, parseCompactEvidence} from '../common/evidence-locators.mjs';
import {compareText, isJsonObject, jsonSemanticallyEqual, parseJsonText, serializeJson, sha256} from '../common/json.mjs';

/** @typedef {Record<string, unknown>} JsonObject */
/** @typedef {{anchor: string | null, filePath: string}} GoverningRequirement */
/** @typedef {{kind: 'exception' | 'normal', requirements: GoverningRequirement[]}} IssueRequirement */
/** @typedef {{content: string, filePath: string, sha256: string}} ReadinessSubject */
/** @typedef {{effort: string, effortNumber: string, filename: string, issueNumber: string, issuePath: string, requirement: IssueRequirement, subject: ReadinessSubject}} ReadinessIssue */
/** @typedef {{filePath: string, role: string}} InputIdentity */
/** @typedef {{content?: string, filePath: string, role: string, sha256: string, snapshot?: string}} SnapshotInput */
/** @typedef {{content: string, filePath: string, role: string, sha256: string}} RequestInput */
/** @typedef {{filePath: string, id: string, sha256: string}} ReviewerRole */
/** @typedef {{filePath: string, sha256: string}} SubjectIdentity */
/** @typedef {{anchor?: string, filePath: string, line?: number}} EvidenceLocator */
/** @typedef {{evidence: EvidenceLocator[], finding: string, result: string}} ReviewFinding */
/** @typedef {{check: string, findings?: ReviewFinding[], result: string}} ReviewCheck */
/** @typedef {{draftPath: string, inputs: RequestInput[], issueId: string, requestDigest: string, requestId: string, reviewerRole: ReviewerRole, subject: ReadinessSubject}} ReviewerRequest */
/** @typedef {(path: string, text: string) => Promise<void>} AtomicWriteFile */
/** @typedef {Pick<ReturnType<typeof createCurrentPlatformAdapter>, 'getCurrentAgentIdentity'>} PlatformAdapter */

const errorCode = (/** @type {unknown} */ error) => isJsonObject(error) && typeof error.code === 'string' ? error.code : undefined;
const errorMessage = (/** @type {unknown} */ error) => error instanceof Error ? error.message : String(error);

const INPUT_ROLES = new Set(['governing-spec', 'governing-prd', 'adr', 'domain-context', 'architecture-evidence']);
const AGENT_ONLY_INPUT_PREFIXES = [
    'docs/agents/',
    '.agents/skills/',
    '.claude/skills/',
    '.codex/agents/',
    '.claude/agents/',
];
const REVIEWER_ROLE = {filePath: 'docs/agents/roles/spec-readiness-reviewer.md', id: 'spec-readiness-reviewer'};
export const SPEC_READINESS_DRAFT_FORMAT_SUBTYPES = Object.freeze({
    requirementScopeContinuation: 'requirement-scope-continuation',
});
const COMMON_CHECKS = [
    'SPEC-READINESS-INPUTS',
    'SPEC-READINESS-REQUIREMENTS',
    'SPEC-READINESS-RATIONALE',
    'SPEC-READINESS-ADR-EVALUATION',
    'MODULE-DESIGN-APPLICABILITY',
];
const REQUIREMENT_SCOPE_CHECKS = COMMON_CHECKS.slice(0, 2);
const SUBJECT_EVIDENCE_CHECKS = new Set(['SPEC-READINESS-INPUTS', 'SPEC-READINESS-REQUIREMENTS']);
const MODULE_DESIGN_EXEMPTION_CHECK = 'MODULE-DESIGN-EXEMPTION';
const MODULE_DESIGN_FULL_CHECKS = [
    'MODULE-DESIGN-MODULES',
    'MODULE-DESIGN-INTERFACES',
    'MODULE-DESIGN-SEAMS-ADAPTERS',
    'MODULE-DESIGN-DEPENDENCIES-DATA-FLOW',
    'MODULE-DESIGN-RATIONALE',
];
const REPOSITORY_PATH_SCOPE = process.cwd();

const decodeUtf8 = (/** @type {ArrayBuffer | NodeJS.ArrayBufferView<ArrayBufferLike> | Buffer<ArrayBuffer> | null | undefined} */ bytes, /** @type {string} */ path) => {
    try {
        return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    } catch {
        throw new Error(`Readiness input is not valid UTF-8: ${path}.`);
    }
};

const normalizePath = (/** @type {string} */ path) => {
    let resolved;
    try {
        resolved = resolveRelativePathWithinScope({path, scope: REPOSITORY_PATH_SCOPE});
    } catch {
        throw new Error(`Invalid Repository-relative input path: ${path}.`);
    }
    if (resolved.status !== 'succeeded' || resolved.relativePath.length === 0) {
        throw new Error(`Invalid Repository-relative input path: ${path}.`);
    }
    return resolved.relativePath.split(sep).join('/');
};

const assertGoverningInputPath = (/** @type {string} */ filePath) => {
    const filename = filePath.split('/').at(-1);
    if (filename === 'AGENTS.md'
        || filename === 'CLAUDE.md'
        || AGENT_ONLY_INPUT_PREFIXES.some(prefix => filePath.startsWith(prefix))) {
        throw new Error(`Readiness input cannot be an Agent instruction or platform Agent configuration: ${filePath}.`);
    }
};

const resolveRepositoryPath = (/** @type {string} */ repositoryRoot, /** @type {string} */ path) => {
    const result = resolveRelativePathWithinScope({path, scope: repositoryRoot});
    if (result.status !== 'succeeded') throw new Error(`Input path escapes the Repository: ${path}.`);
    return result.absolutePath;
};

const readSafeRepositoryFile = async (/** @type {string} */ repositoryRoot, /** @type {string} */ path) => {
    const created = await createScopedFilesystem({root: repositoryRoot});
    if (created.status !== 'succeeded') throw new Error(`Readiness Repository scope is unavailable: ${path}.`);
    const result = await created.scopedFilesystem.read({path});
    if (result.status !== 'succeeded') throw new Error(`Readiness input is not a safe regular file: ${path}.`);
    return result.bytes;
};

const assertSafeWriteTarget = async (/** @type {string} */ repositoryRoot, /** @type {string} */ path) => {
    const created = await createScopedFilesystem({root: repositoryRoot});
    if (created.status !== 'succeeded') throw new Error(`Spec Readiness target scope is unavailable: ${path}.`);
    const observed = await created.scopedFilesystem.inspect({path});
    if (observed.status !== 'succeeded'
        || observed.entry.kind !== 'missing' && observed.entry.kind !== 'file') {
        throw new Error(`Spec Readiness target is not a safe regular file target: ${path}.`);
    }
    return resolveRepositoryPath(repositoryRoot, path);
};

const repositoryRelativePath = (/** @type {string} */ repositoryRoot, /** @type {string} */ absolutePath) => {
    const resolved = resolveAbsolutePathWithinScope({path: absolutePath, scope: repositoryRoot});
    if (resolved.status !== 'succeeded') throw new Error('Spec Readiness path escapes the Repository.');
    return resolved.relativePath.split(sep).join('/');
};

const createAtomicWrite = async (/** @type {string} */ repositoryRoot) => {
    const created = await createScopedFilesystem({root: repositoryRoot});
    if (created.status !== 'succeeded') throw new Error('Spec Readiness Repository filesystem is unavailable.');
    return async (/** @type {string} */ absolutePath, /** @type {string} */ text) => {
        const path = repositoryRelativePath(repositoryRoot, absolutePath);
        const inspected = await created.scopedFilesystem.inspect({path});
        if (inspected.status !== 'succeeded') throw new Error(`Spec Readiness target is unsafe: ${path}.`);
        const mode = inspected.entry.kind === 'missing' ? 'create-atomic' : inspected.entry.kind === 'file' ? 'replace' : null;
        if (mode === null) throw new Error(`Spec Readiness target is not a regular file target: ${path}.`);
        const written = await created.scopedFilesystem.write({bytes: Buffer.from(text, 'utf8'), mode, path});
        if (written.status !== 'succeeded') throw new Error(`Spec Readiness target could not be written: ${path}.`);
    };
};

const removeRepositoryPath = async (/** @type {string} */ repositoryRoot, /** @type {string} */ absolutePath) => {
    const created = await createScopedFilesystem({root: repositoryRoot});
    if (created.status !== 'succeeded') throw new Error('Spec Readiness Repository filesystem is unavailable.');
    const removed = await created.scopedFilesystem.remove({path: repositoryRelativePath(repositoryRoot, absolutePath)});
    if (removed.status !== 'succeeded') throw new Error('Spec Readiness temporary file could not be removed.');
};

const createRepositoryDirectory = async (/** @type {string} */ repositoryRoot, /** @type {string} */ absolutePath) => {
    const created = await createScopedFilesystem({root: repositoryRoot});
    if (created.status !== 'succeeded') throw new Error('Spec Readiness Repository filesystem is unavailable.');
    const directory = await created.scopedFilesystem.createDirectory({path: repositoryRelativePath(repositoryRoot, absolutePath), recursive: true});
    if (directory.status !== 'succeeded') throw new Error('Spec Readiness temporary directory could not be created.');
};

const pathWithin = (/** @type {string} */ scope, /** @type {string[]} */ parts) => {
    const relativePath = joinRelativePath(...parts);
    const resolved = resolveRelativePathWithinScope({path: relativePath, scope});
    if (resolved.status !== 'succeeded') throw new Error('Spec Readiness path escapes its scope.');
    return resolved.absolutePath;
};

const json = (/** @type {unknown} */ value) => {
    const serialized = serializeJson(value);
    if (serialized.status !== 'succeeded') throw new Error('Spec Readiness value cannot be serialized as JSON.');
    return serialized.bytes.toString('utf8');
};
const compactJsonBytes = (/** @type {unknown} */ value) => {
    const serialized = serializeJson(value, {format: 'compact'});
    if (serialized.status !== 'succeeded') throw new Error('Spec Readiness digest input cannot be serialized as JSON.');
    return serialized.bytes;
};
const jsonKey = (/** @type {unknown} */ value) => json(value);
const assertExactKeys = (/** @type {object} */ value, /** @type {string[]} */ expected, /** @type {string} */ label) => {
    const actual = Object.keys(value).sort(compareText);
    const required = [...expected].sort(compareText);
    if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) throw new Error(`${label} has unknown or missing fields.`);
};
/** @returns {JsonObject} */
const parseJsonObject = (/** @type {string} */ text, /** @type {string} */ label) => {
    const parsed = parseJsonText(text);
    if (parsed.status !== 'succeeded' || !isJsonObject(parsed.value)) throw new Error(`${label} must be a JSON object.`);
    return parsed.value;
};

const moduleDesignForm = (/** @type {string} */ text, /** @type {string} */ path) => {
    const lines = text.split(/\r?\n/);
    const indexes = lines.flatMap((/** @type {string} */ line, /** @type {number} */ index) => line === '## Module Design' ? [index] : []);
    if (indexes.length === 0) return 'omitted';
    if (indexes.length !== 1) throw new Error(`${path} must not contain more than one ## Module Design section.`);
    const after = lines.slice(indexes[0] + 1);
    const end = after.findIndex((/** @type {string} */ line) => /^## /.test(line));
    const content = after.slice(0, end < 0 ? after.length : end).join('\n').trim();
    if (/^Not required: [^\r\n]+$/.test(content)) return 'exemption';
    const headings = content.split(/\r?\n/).filter((/** @type {string} */ line) => /^### /.test(line)).map((/** @type {string} */ line) => line.slice(4));
    const expected = ['Modules', 'Interfaces', 'Seams and Adapters', 'Dependencies and Data Flow', 'Module Design Rationale', 'ADR Evaluation'];
    const legacy = expected.with(4, 'Design Rationale');
    if (headings.length !== expected.length
        || (!headings.every((/** @type {string} */ heading, /** @type {number} */ index) => heading === expected[index])
            && !headings.every((/** @type {string} */ heading, /** @type {number} */ index) => heading === legacy[index]))) {
        throw new Error(`${path} has malformed Module Design headings.`);
    }
    return 'full';
};

const expectedChecks = (/** @type {SnapshotInput[]} */ inputs) => {
    const forms = inputs.filter(input => input.role === 'governing-spec' || input.role === 'governing-prd')
        .map((/** @type {SnapshotInput} */ input) => moduleDesignForm(
            typeof input.content === 'string'
                ? input.content
                : decodeUtf8(Buffer.from(input.snapshot ?? '', 'base64'), input.filePath),
            input.filePath,
        ));
    return [
        ...COMMON_CHECKS,
        ...(forms.includes('exemption') ? [MODULE_DESIGN_EXEMPTION_CHECK] : []),
        ...(forms.includes('full') ? MODULE_DESIGN_FULL_CHECKS : []),
    ];
};

const parseIssueId = (/** @type {unknown} */ issueId) => {
    const parsed = parseCanonicalArtifactId(issueId);
    if (parsed.kind !== 'issue' || parsed.qualifier !== null || parsed.issueNumber === null) {
        throw new Error('Invalid implementation issue ID.');
    }
    return parsed;
};

const readinessRecordPath = (/** @type {{effort: string, issueNumber: string}} */ issue) => joinRelativePath(
    '.scratch',
    issue.effort,
    'issues',
    `${issue.issueNumber}.spec-readiness.json`,
);

/** @returns {Promise<ReadinessIssue>} */
const readIssue = async (/** @type {{issueId: string, repositoryRoot: string}} */ {issueId, repositoryRoot}) => {
    const identity = parseIssueId(issueId);
    const inventory = await readArtifactInventory({root: repositoryRoot, scratchDirectory: '.scratch'});
    const effortDirectories = inventory.migration.effortDirectories.filter(directory =>
        directory.canonical && directory.number === identity.effortNumber,
    );
    if (effortDirectories.length !== 1) throw new Error(`Implementation issue not found: ${issueId}.`);
    const sources = inventory.issueSources.filter(source =>
        source.effort === effortDirectories[0].name
        && source.effortNumber === identity.effortNumber
        && source.number === identity.issueNumber,
    );
    if (sources.length !== 1) throw new Error(`Implementation issue not found: ${issueId}.`);
    const filePath = sources[0].relativePath;
    const pathIdentity = parseRegisteredArtifactPath(filePath);
    if (pathIdentity.kind !== 'issue' || pathIdentity.issueFilename === null || pathIdentity.issueNumber === null) {
        throw new Error(`Implementation issue not found: ${issueId}.`);
    }
    const path = resolveRepositoryPath(repositoryRoot, filePath);
    const text = decodeUtf8(await readSafeRepositoryFile(repositoryRoot, filePath), filePath);
    const parsedRequirement = readIssueRequirement({issuePath: filePath, text});
    const {subjectContent, subjectIdentityContent} = parsedRequirement;
    /** @type {IssueRequirement} */
    const requirement = parsedRequirement.kind === 'normal'
        ? {kind: 'normal', requirements: parsedRequirement.requirements}
        : {kind: 'exception', requirements: []};
    return {
        effort: pathIdentity.effortDirectory,
        effortNumber: pathIdentity.effortNumber,
        filename: pathIdentity.issueFilename,
        issueNumber: pathIdentity.issueNumber,
        issuePath: path,
        requirement,
        subject: {content: subjectContent, filePath, sha256: sha256(Buffer.from(subjectIdentityContent))},
    };
};

const assertExceptionApplicable = async (/** @type {{issue: ReadinessIssue, repositoryRoot: string}} */ {issue, repositoryRoot}) => {
    const created = await createScopedFilesystem({root: repositoryRoot});
    if (created.status !== 'succeeded') throw new Error('Spec Readiness Repository filesystem is unavailable.');
    const issuesPath = joinRelativePath('.scratch', issue.effort, 'issues');
    const listed = await created.scopedFilesystem.list({path: issuesPath});
    if (listed.status !== 'succeeded') throw new Error('Spec Readiness effort issues could not be enumerated.');
    const entries = listed.entries.filter(entry => /^[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(entry.path.slice(entry.path.lastIndexOf('/') + 1)));
    if (entries.length !== 1 || entries[0].path !== joinRelativePath(issuesPath, issue.filename) || entries[0].kind !== 'file') {
        throw new Error('Spec Readiness exception requires exactly one implementation issue in the effort.');
    }
};

const canonicalInputs = async (/** @type {{input: JsonObject, repositoryRoot: string}} */ {input, repositoryRoot}) => {
    if (!Array.isArray(input.inputs) || input.inputs.length === 0) throw new Error('Spec Readiness prepare requires a non-empty inputs array.');
    /** @type {Map<string, InputIdentity>} */
    const byPath = new Map();
    for (const entry of input.inputs) {
        if (!isJsonObject(entry)) throw new Error('Spec Readiness input must be an object.');
        if (typeof entry.role !== 'string' || !INPUT_ROLES.has(entry.role)) throw new Error(`Unknown readiness input role: ${entry.role}.`);
        if (typeof entry.filePath !== 'string') throw new Error('Spec Readiness input filePath must be a string.');
        const filePath = normalizePath(entry.filePath);
        assertGoverningInputPath(filePath);
        if (/^\.scratch\/[^/]+\/issues\/[^/]+\.md$/.test(filePath)) throw new Error(`Readiness input cannot be a local tracker issue: ${filePath}.`);
        const existing = byPath.get(filePath);
        if (existing && existing.role !== entry.role) throw new Error(`Readiness input path has conflicting roles: ${filePath}.`);
        byPath.set(filePath, {filePath, role: entry.role});
    }
    if (![...byPath.values()].some(entry => entry.role === 'governing-spec' || entry.role === 'governing-prd')) throw new Error('Readiness inputs must contain a governing-spec or governing-prd.');
    /** @type {SnapshotInput[]} */
    const inputs = [];
    for (const entry of [...byPath.values()].sort((left, right) => compareText(left.filePath, right.filePath) || compareText(left.role, right.role))) {
        const bytes = await readSafeRepositoryFile(repositoryRoot, entry.filePath);
        if (entry.role === 'governing-spec' || entry.role === 'governing-prd') moduleDesignForm(decodeUtf8(bytes, entry.filePath), entry.filePath);
        inputs.push({...entry, sha256: sha256(bytes), snapshot: Buffer.from(bytes).toString('base64')});
    }
    return inputs;
};

const currentReviewerRole = async (/** @type {string} */ repositoryRoot) => {
    const bytes = await readSafeRepositoryFile(repositoryRoot, REVIEWER_ROLE.filePath);
    return {...REVIEWER_ROLE, sha256: sha256(bytes)};
};

/** @returns {ReviewerRole} */
const canonicalReviewerRole = (/** @type {unknown} */ reviewerRole, /** @type {string} */ label) => {
    if (!isJsonObject(reviewerRole)) {
        throw new Error(`${label} is invalid.`);
    }
    assertExactKeys(reviewerRole, ['filePath', 'id', 'sha256'], label);
    if (typeof reviewerRole.filePath !== 'string' || typeof reviewerRole.sha256 !== 'string') throw new Error(`${label} is invalid.`);
    const filePath = normalizePath(reviewerRole.filePath);
    if (reviewerRole.id !== REVIEWER_ROLE.id
        || filePath !== REVIEWER_ROLE.filePath
        || !/^[0-9a-f]{64}$/.test(reviewerRole.sha256)) {
        throw new Error(`${label} is invalid.`);
    }
    return {filePath, id: reviewerRole.id, sha256: reviewerRole.sha256};
};

const workspace = async (/** @type {{issueId: string, platformAdapter?: PlatformAdapter, repositoryRoot: string}} */ {issueId, platformAdapter, repositoryRoot}) => createTemporaryWorkspace({
    agentIdentity: (platformAdapter ?? createCurrentPlatformAdapter()).getCurrentAgentIdentity(),
    issueId,
    purpose: 'spec-readiness',
    repositoryRoot,
});

const activeRequestPath = (/** @type {string} */ directory) => pathWithin(directory, ['active-request.json']);
const baselinePath = (/** @type {string} */ directory) => pathWithin(directory, ['baseline.json']);
const readStored = async (/** @type {string} */ repositoryRoot, /** @type {string} */ path, /** @type {string} */ label) => {
    const filePath = repositoryRelativePath(repositoryRoot, path);
    return parseJsonObject(decodeUtf8(await readSafeRepositoryFile(repositoryRoot, filePath), filePath), label);
};

const commitReviewerRequest = async (/** @type {{atomicWriteFile: AtomicWriteFile, directory: string, path: string, repositoryRoot: string, request: ReviewerRequest}} */ {atomicWriteFile, directory, path, repositoryRoot, request}) => {
    await atomicWriteFile(path, json(request));
    try {
        const storedPath = resolveAbsolutePathWithinScope({path, scope: repositoryRoot});
        if (storedPath.status !== 'succeeded') throw new Error('Spec Readiness request path escapes the Repository.');
        await atomicWriteFile(activeRequestPath(directory), json({
            draftPath: request.draftPath,
            requestDigest: request.requestDigest,
            requestId: request.requestId,
            requestPath: storedPath.relativePath.split(sep).join('/'),
        }));
    } catch (error) {
        await removeRepositoryPath(repositoryRoot, path);
        throw error;
    }
};

const prepareDraftTarget = async (/** @type {{directory: string, draftPath: string}} */ {directory, draftPath}) => {
    const resolved = resolveAbsolutePathWithinScope({path: draftPath, scope: directory});
    if (resolved.status !== 'succeeded' || resolved.relativePath.length === 0) {
        throw new Error('Spec Readiness draftPath is outside the current issue temporary workspace.');
    }
    const created = await createScopedFilesystem({root: directory});
    if (created.status !== 'succeeded') throw new Error('Spec Readiness temporary workspace is unavailable.');
    const written = await created.scopedFilesystem.write({
        bytes: Buffer.alloc(0),
        mode: 'create',
        path: resolved.relativePath,
    });
    if (written.status !== 'succeeded') {
        const code = written.diagnostics[0]?.code;
        if (code === 'filesystem-create-collision') {
            throw new Error('Spec Readiness draftPath must not already exist.');
        }
        if (code === 'filesystem-link-unsupported') {
            throw new Error('Spec Readiness draftPath contains a linked path segment.');
        }
        throw new Error('Spec Readiness draftPath could not be created safely.');
    }
};

const requestPathForIssue = (/** @type {{issueId: string, repositoryRoot: string, value: unknown}} */ {issueId, repositoryRoot, value}) => {
    if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('Spec Readiness requestPath must be an absolute path.');
    const resolved = resolveAbsolutePathWithinScope({path: value, scope: repositoryRoot});
    if (resolved.status !== 'succeeded') throw new Error('Spec Readiness request path escapes the Repository.');
    const filePath = resolved.relativePath.split(sep).join('/');
    const parsed = parseIssueId(issueId);
    const issueDirectory = formatArtifactIdentityKey(parsed);
    const escaped = issueDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^\\.tmp/(?:codex|claude-code)/[A-Za-z0-9._-]+/${escaped}/spec-readiness/requests/request-[0-9a-f-]{36}\\.json$`);
    if (!pattern.test(filePath)) throw new Error('Spec Readiness request path is outside the allowed temporary workspace.');
    return {absolute: resolved.absolutePath, filePath};
};

const validateSubjectContent = (/** @type {{content: string, filePath: string}} */ {content, filePath}) => {
    try {
        const parsed = readIssueRequirement({issuePath: filePath, text: content});
        if (parsed.subjectContent !== content) throw new Error();
        return parsed.subjectIdentityContent;
    } catch {
        throw new Error('Spec Readiness Reviewer Request subject content is invalid.');
    }
};

/** @returns {ReadinessSubject} */
const canonicalSubject = (/** @type {{issueId: string, subject: unknown}} */ {issueId, subject}) => {
    if (!isJsonObject(subject)) throw new Error('Spec Readiness Reviewer Request subject is invalid.');
    assertExactKeys(subject, ['content', 'filePath', 'sha256'], 'Spec Readiness Reviewer Request subject');
    parseIssueId(issueId);
    if (typeof subject.filePath !== 'string' || typeof subject.sha256 !== 'string') throw new Error('Spec Readiness Reviewer Request subject is invalid.');
    const filePath = normalizePath(subject.filePath);
    let subjectIdentity;
    try {
        subjectIdentity = parseRegisteredArtifactPath(filePath);
    } catch {
        throw new Error('Spec Readiness Reviewer Request subject is invalid.');
    }
    if (subjectIdentity.kind !== 'issue' || subjectIdentity.canonicalId !== issueId
        || typeof subject.content !== 'string'
        || !/^[0-9a-f]{64}$/.test(subject.sha256)) {
        throw new Error('Spec Readiness Reviewer Request subject is invalid.');
    }
    const subjectIdentityContent = validateSubjectContent({content: subject.content, filePath});
    if (sha256(Buffer.from(subjectIdentityContent)) !== subject.sha256) {
        throw new Error('Spec Readiness Reviewer Request subject is invalid.');
    }
    return {content: subject.content, filePath, sha256: subject.sha256};
};

/** @returns {SubjectIdentity} */
const canonicalSubjectIdentity = (/** @type {{issueId: string, subject: unknown}} */ {issueId, subject}) => {
    if (!isJsonObject(subject)) throw new Error('Malformed Spec Readiness subject identity.');
    assertExactKeys(subject, ['filePath', 'sha256'], 'Spec Readiness subject identity');
    parseIssueId(issueId);
    if (typeof subject.filePath !== 'string' || typeof subject.sha256 !== 'string') throw new Error('Malformed Spec Readiness subject identity.');
    const filePath = normalizePath(subject.filePath);
    let subjectIdentity;
    try {
        subjectIdentity = parseRegisteredArtifactPath(filePath);
    } catch {
        throw new Error('Malformed Spec Readiness subject identity.');
    }
    if (subjectIdentity.kind !== 'issue' || subjectIdentity.canonicalId !== issueId || !/^[0-9a-f]{64}$/.test(subject.sha256)) {
        throw new Error('Malformed Spec Readiness subject identity.');
    }
    return {filePath, sha256: subject.sha256};
};

/** @returns {ReviewerRequest} */
const canonicalStoredRequest = (/** @type {{issueId: string, repositoryRoot: string, request: unknown}} */ {issueId, repositoryRoot, request}) => {
    if (!isJsonObject(request)) throw new Error('Spec Readiness Reviewer Request must be a JSON object.');
    assertExactKeys(request, ['draftPath', 'inputs', 'issueId', 'requestDigest', 'requestId', 'reviewerRole', 'subject'], 'Spec Readiness Reviewer Request');
    if (request.issueId !== issueId
        || typeof request.draftPath !== 'string'
        || !isAbsolute(request.draftPath)
        || typeof request.requestId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(request.requestId)) {
        throw new Error('Spec Readiness Reviewer Request identity is invalid.');
    }
    if (!Array.isArray(request.inputs) || request.inputs.length === 0) throw new Error('Spec Readiness Reviewer Request inputs are invalid.');
    const inputs = request.inputs.map((/** @type {unknown} */ entry, /** @type {number} */ index) => {
        if (!isJsonObject(entry)) throw new Error(`Spec Readiness Reviewer Request input[${index}] is invalid.`);
        assertExactKeys(entry, ['content', 'filePath', 'role', 'sha256'], `Spec Readiness Reviewer Request input[${index}]`);
        if (typeof entry.filePath !== 'string') throw new Error(`Spec Readiness Reviewer Request input[${index}] is invalid.`);
        const filePath = normalizePath(entry.filePath);
        assertGoverningInputPath(filePath);
        if (typeof entry.content !== 'string' || typeof entry.role !== 'string' || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256) || sha256(Buffer.from(entry.content)) !== entry.sha256) throw new Error(`Spec Readiness Reviewer Request input[${index}] is invalid.`);
        return {content: entry.content, filePath, role: entry.role, sha256: entry.sha256};
    });
    const sorted = [...inputs].sort((left, right) => compareText(left.filePath, right.filePath) || compareText(left.role, right.role));
    if (!jsonSemanticallyEqual(inputs, sorted)) throw new Error('Spec Readiness Reviewer Request inputs are not canonical.');
    if (inputs.some((/** @type {{ role: string; }} */ input) => !INPUT_ROLES.has(input.role)) || !inputs.some((/** @type {{ role: string; }} */ input) => input.role === 'governing-spec' || input.role === 'governing-prd')) throw new Error('Spec Readiness Reviewer Request input roles are invalid.');
    const reviewerRole = canonicalReviewerRole(request.reviewerRole, 'Spec Readiness Reviewer Request Role identity');
    const subject = canonicalSubject({issueId, subject: request.subject});
    const canonicalDraft = resolveAbsolutePathWithinScope({path: request.draftPath, scope: repositoryRoot});
    if (canonicalDraft.status !== 'succeeded') throw new Error('Spec Readiness Reviewer Request draftPath escapes the Repository.');
    const payload = {requestId: request.requestId, issueId, draftPath: canonicalDraft.absolutePath, reviewerRole, inputs, subject};
    const digest = sha256(compactJsonBytes(payload));
    if (request.requestDigest !== digest) throw new Error('Spec Readiness Reviewer Request digest is invalid.');
    return {...payload, requestDigest: digest};
};

const readReviewerRequest = async (/** @type {{issueId: string, repositoryRoot: string, requestPath: unknown}} */ {issueId, repositoryRoot, requestPath}) => {
    const resolved = requestPathForIssue({issueId, repositoryRoot, value: requestPath});
    const request = canonicalStoredRequest({issueId, repositoryRoot, request: await readStored(repositoryRoot, resolved.absolute, 'Spec Readiness Reviewer Request')});
    return {...resolved, request};
};

const validateDraftInputPath = async (/** @type {{draftPath: string, inputPath: unknown, repositoryRoot: string}} */ {draftPath, inputPath, repositoryRoot}) => {
    if (typeof inputPath !== 'string' || !isAbsolute(inputPath)) throw new Error('Spec Readiness generate input path must be absolute.');
    const canonicalInput = resolveAbsolutePathWithinScope({path: inputPath, scope: repositoryRoot});
    const canonicalDraft = resolveAbsolutePathWithinScope({path: draftPath, scope: repositoryRoot});
    if (canonicalInput.status !== 'succeeded'
        || canonicalDraft.status !== 'succeeded'
        || canonicalInput.absolutePath !== canonicalDraft.absolutePath) {
        throw new Error('Spec Readiness generate input path does not match the active Reviewer Request draftPath.');
    }
    const absolute = canonicalInput.absolutePath;
    const resolved = resolveAbsolutePathWithinScope({path: absolute, scope: repositoryRoot});
    if (resolved.status !== 'succeeded') throw new Error('Spec Readiness generate input path escapes the Repository.');
    const filePath = resolved.relativePath.split(sep).join('/');
    return readSafeRepositoryFile(repositoryRoot, filePath);
};

const requestSnapshotInputs = (/** @type {SnapshotInput[]} */ inputs) => inputs.map(({filePath, role, sha256: digest, snapshot}) => ({
    content: decodeUtf8(Buffer.from(snapshot ?? '', 'base64'), filePath),
    filePath,
    role,
    sha256: digest,
}));

/**
 * 从 issue 与 Main Agent JSON Inputs 建立规范的 Reviewer Request.
 * 该 Interface 绑定 Reviewer Role identity, 冻结当前 issue 的完整 Spec Requirement 作为审核对象, 原子激活新的不可变 Reviewer Request, 并且不启动 Reviewer. 激活失败时只回滚本次 request, 保留此前 active request.
 */
export const prepareSpecReadiness = async (/** @type {{atomicWriteFile?: AtomicWriteFile, input: unknown, issueId: string, platformAdapter?: PlatformAdapter, repositoryRoot: string}} */ {atomicWriteFile = undefined, input, issueId, platformAdapter, repositoryRoot}) => {
    atomicWriteFile ??= await createAtomicWrite(repositoryRoot);
    const issue = await readIssue({issueId, repositoryRoot});
    if (issue.requirement.kind !== 'normal') throw new Error('Spec Readiness exception does not accept prepare.');
    if (!isJsonObject(input)) throw new Error('Spec Readiness prepare input must be a JSON object.');
    assertExactKeys(input, ['draftPath', 'inputs'], 'Spec Readiness prepare input');
    const inputs = await canonicalInputs({input, repositoryRoot});
    const directory = await workspace({issueId, platformAdapter, repositoryRoot});
    if (typeof input.draftPath !== 'string' || !isAbsolute(input.draftPath)) throw new Error('Spec Readiness draftPath must be absolute.');
    const resolvedDraftPath = resolveAbsolutePathWithinScope({path: input.draftPath, scope: directory});
    if (resolvedDraftPath.status !== 'succeeded'
        || resolvedDraftPath.relativePath === ''
        || !resolvedDraftPath.absolutePath.endsWith('.jsonl')) {
        throw new Error('Spec Readiness draftPath is outside the current issue temporary workspace or is not a JSONL file.');
    }
    const draftPath = resolvedDraftPath.absolutePath;
    await prepareDraftTarget({directory, draftPath});
    try {
        const requestId = randomUUID();
        const reviewerRole = await currentReviewerRole(repositoryRoot);
        const requestPayload = {
            requestId,
            issueId,
            draftPath,
            reviewerRole,
            inputs: requestSnapshotInputs(inputs),
            subject: issue.subject,
        };
        const request = {...requestPayload, requestDigest: sha256(compactJsonBytes(requestPayload))};
        const requestsDirectory = pathWithin(directory, ['requests']);
        await createRepositoryDirectory(repositoryRoot, requestsDirectory);
        const path = pathWithin(requestsDirectory, [`request-${requestId}.json`]);
        await commitReviewerRequest({atomicWriteFile, directory, path, repositoryRoot, request});
        return {path};
    } catch (error) {
        await removeRepositoryPath(repositoryRoot, draftPath);
        throw error;
    }
};

const deriveResult = (/** @type {Array<{result: string}>} */ checks) => checks.some(check => check.result === 'gap') ? 'gap' : checks.some(check => check.result === 'uncertain') ? 'uncertain' : 'satisfied';

const headingAnchor = (/** @type {string} */ heading) => heading.trim().toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');

const validateRequirementEligibility = async (/** @type {GoverningRequirement[]} */ requirements, /** @type {string} */ repositoryRoot, /** @type {Map<string, SnapshotInput>} */ reviewed) => {
    /** @type {Map<string, GoverningRequirement[]>} */
    const byPath = new Map();
    for (const requirement of requirements) {
        if (!requirement.filePath.endsWith('.md')) throw new Error(`Issue governing requirement must reference a Markdown file: ${requirement.filePath}.`);
        const entries = byPath.get(requirement.filePath) ?? [];
        entries.push(requirement);
        byPath.set(requirement.filePath, entries);
    }
    for (const [filePath, entries] of byPath) {
        const pathOnly = entries.find(requirement => requirement.anchor === null);
        const anchored = entries.filter(requirement => requirement.anchor !== null);
        if (anchored.length === 0 && (!pathOnly || !reviewed.has(filePath))) continue;
        const text = decodeUtf8(await readSafeRepositoryFile(repositoryRoot, filePath), filePath);
        const headings = text.split(/\r?\n/).filter(line => /^#{1,6} /.test(line));
        const anchors = new Set(headings.map(line => headingAnchor(line.replace(/^#{1,6} /, ''))));
        for (const requirement of anchored) {
            if (requirement.anchor === null || !anchors.has(requirement.anchor)) throw new Error(`Issue governing requirement anchor does not exist: ${filePath}#${requirement.anchor}.`);
        }
        if (pathOnly && reviewed.has(filePath)) {
            if (headings.length !== 0 && (headings.length !== 1 || !/^# /.test(headings[0]))) throw new Error(`Issue path-only governing requirement has ineligible heading structure: ${filePath}.`);
            if (headings.length === 1) {
                const anchor = headingAnchor(headings[0].replace(/^# /, ''));
                if (entries.some(requirement => requirement.anchor === anchor)) throw new Error(`Issue governing requirement duplicates the path-only scope: ${filePath}#${anchor}.`);
            }
        }
    }
};

const evidencePath = (/** @type {string} */ inputPath, /** @type {Set<string>} */ knownPaths, /** @type {string} */ check, /** @type {ReadinessSubject | SubjectIdentity | undefined} */ subject) => {
    const filePath = normalizePath(inputPath);
    if (!knownPaths.has(filePath)) {
        if (subject?.filePath !== filePath) throw new Error(`Review Evidence path is not an Input: ${filePath}.`);
        if (!SUBJECT_EVIDENCE_CHECKS.has(check)) throw new Error(`Subject evidence is not allowed for ${check}.`);
    }
    return filePath;
};

/** @returns {EvidenceLocator[]} */
const canonicalArtifactEvidence = (/** @type {unknown} */ evidence, /** @type {SnapshotInput[]} */ inputs, /** @type {string} */ check, /** @type {ReadinessSubject | SubjectIdentity | undefined} */ subject) => {
    if (!Array.isArray(evidence)) throw new Error('Reviewer check evidence must be an array.');
    const knownPaths = new Set(inputs.map(input => input.filePath));
    /** @type {Map<string, EvidenceLocator>} */
    const byIdentity = new Map();
    for (const locator of evidence) {
        if (!isJsonObject(locator) || typeof locator.filePath !== 'string') throw new Error('Review Evidence locator must contain filePath.');
        const filePath = evidencePath(locator.filePath, knownPaths, check, subject);
        const hasAnchor = Object.hasOwn(locator, 'anchor');
        const hasLine = Object.hasOwn(locator, 'line');
        if (hasAnchor && hasLine) throw new Error('Review Evidence locator cannot contain both anchor and line.');
        const keys = Object.keys(locator).sort(compareText);
        const expectedKeys = hasAnchor ? ['anchor', 'filePath'] : hasLine ? ['filePath', 'line'] : ['filePath'];
        if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
            throw new Error('Review Evidence locator has unknown or missing fields.');
        }
        const anchor = locator.anchor;
        const line = locator.line;
        if (hasAnchor && (typeof anchor !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(anchor))) throw new Error('Review Evidence anchor is invalid.');
        if (hasLine && (typeof line !== 'number' || !Number.isInteger(line) || line < 1)) throw new Error('Review Evidence line is invalid.');
        const normalized = {filePath, ...(typeof anchor === 'string' ? {anchor} : {}), ...(typeof line === 'number' ? {line} : {})};
        const identity = `${filePath}\0${typeof anchor === 'string' ? `anchor\0${anchor}` : typeof line === 'number' ? `line\0${line}` : 'path'}`;
        byIdentity.set(identity, normalized);
    }
    return [...byIdentity.values()].sort((left, right) => (
        compareText(left.filePath, right.filePath)
        || (typeof left.anchor === 'string' ? 0 : typeof left.line === 'number' ? 1 : 2)
            - (typeof right.anchor === 'string' ? 0 : typeof right.line === 'number' ? 1 : 2)
        || (typeof left.anchor === 'string' && typeof right.anchor === 'string'
            ? compareText(left.anchor, right.anchor)
            : typeof left.line === 'number' && typeof right.line === 'number'
                ? left.line - right.line
                : 0)
    ));
};

const canonicalBodyEvidenceSources = (/** @type {Array<SnapshotInput | RequestInput>} */ inputs, /** @type {ReadinessSubject} */ subject) => {
    const sources = new Map(inputs.map(input => [
        input.filePath,
        typeof input.content === 'string' ? input.content : decodeUtf8(Buffer.from('snapshot' in input ? input.snapshot ?? '' : '', 'base64'), input.filePath),
    ]));
    sources.set(subject.filePath, subject.content);
    return sources;
};

const isBodyLineLocator = (/** @type {unknown} */ locator) => isJsonObject(locator)
    && Object.keys(locator).sort(compareText).join(',') === 'filePath,line'
    && typeof locator.filePath === 'string'
    && typeof locator.line === 'number'
    && Number.isSafeInteger(locator.line)
    && locator.line > 0;

const assertCanonicalBodyEvidence = (/** @type {{checks: ReviewCheck[], inputs: Array<SnapshotInput | RequestInput>, subject: ReadinessSubject}} */ {checks, inputs, subject}) => {
    const sources = canonicalBodyEvidenceSources(inputs, subject);
    for (const check of checks) {
        for (const finding of check.findings ?? []) {
            if (!finding.evidence.every(isBodyLineLocator)) continue;
            const normalized = normalizeBodyEvidence(
                finding.evidence.map(locator => ({filePath: locator.filePath, lineEnd: locator.line, lineStart: locator.line})),
                sources,
            );
            if (!jsonSemanticallyEqual(finding.evidence, normalized)) {
                throw new Error('Review Evidence lines are not canonical body evidence.');
            }
        }
    }
};

const parseDraftEvidence = (
    /** @type {unknown} */ evidence,
    /** @type {SnapshotInput[]} */ inputs,
    /** @type {string} */ check,
    /** @type {ReadinessSubject} */ subject,
) => {
    if (!Array.isArray(evidence) || !evidence.every(value => typeof value === 'string')) {
        throw new Error('Reviewer check evidence must be an array of compact evidence strings.');
    }
    const knownPaths = new Set(inputs.map(input => input.filePath));
    const located = evidence.flatMap(item => parseCompactEvidence(item))
        .map(locator => ({...locator, filePath: evidencePath(normalizePath(locator.filePath), knownPaths, check, subject)}));
    const sources = new Map(requestSnapshotInputs(inputs).map(input => [input.filePath, input.content]));
    sources.set(subject.filePath, subject.content);
    return normalizeBodyEvidence(located, sources);
};

const parseFindingLines = (/** @type {{expected: string[], inputs: SnapshotInput[], subject: ReadinessSubject, text: string}} */ {
    expected,
    inputs,
    subject,
    text,
}) => {
    /** @type {Map<string, Array<{evidence: unknown[], finding: string, result: string}>>} */
    const byCheck = new Map();
    let noFindings = false;
    for (const [index, lineText] of text.split(/\r?\n/).entries()) {
        if (lineText.trim().length === 0) continue;
        const label = `Reviewer Response JSONL line ${index + 1}`;
        const parsed = parseJsonText(lineText);
        if (parsed.status !== 'succeeded' || !isJsonObject(parsed.value)) {
            throw new Error(`${label} ${parsed.status !== 'succeeded' ? 'is not valid JSON.' : 'must be a JSON object.'}`);
        }
        const finding = parsed.value;
        if (Object.hasOwn(finding, 'status')) {
            assertExactKeys(finding, ['status'], label);
            if (finding.status !== 'no-findings') throw new Error(`${label} has an unknown status.`);
            if (noFindings || byCheck.size !== 0) throw new Error('Reviewer Response no-findings status must be the only non-empty JSONL line.');
            noFindings = true;
            continue;
        }
        if (noFindings) throw new Error('Reviewer Response no-findings status must be the only non-empty JSONL line.');
        assertExactKeys(finding, ['check', 'evidence', 'finding', 'result'], label);
        if (typeof finding.check !== 'string' || !expected.includes(finding.check)) throw new Error(`${label} has an unknown check.`);
        if (!['gap', 'uncertain'].includes(/** @type {string} */ (finding.result))) throw new Error(`${label} result must be gap or uncertain.`);
        if (typeof finding.finding !== 'string' || finding.finding.trim().length === 0 || finding.finding.trim() !== finding.finding) {
            throw new Error(`${label} must contain finding text.`);
        }
        const check = finding.check;
        const evidence = parseDraftEvidence(finding.evidence, inputs, check, subject);
        if (evidence.length === 0) throw new Error(`${label} requires evidence.`);
        const findings = byCheck.get(check) ?? [];
        findings.push({evidence, finding: finding.finding, result: /** @type {string} */ (finding.result)});
        byCheck.set(check, findings);
    }
    if (!noFindings && byCheck.size === 0) throw new Error('Reviewer Response JSONL must contain a finding or the no-findings status.');
    const requirementsProblem = byCheck.has('SPEC-READINESS-REQUIREMENTS');
    const continued = [...byCheck.keys()].some(check => !REQUIREMENT_SCOPE_CHECKS.includes(check));
    if (requirementsProblem && continued) {
        throw Object.assign(new Error('Reviewer Response must stop after the requirement-scope checks when SPEC-READINESS-REQUIREMENTS has a problem.'),
            {code: SPEC_READINESS_DRAFT_FORMAT_SUBTYPES.requirementScopeContinuation});
    }
    const selected = requirementsProblem ? REQUIREMENT_SCOPE_CHECKS : expected;
    const checks = selected.map(check => {
        const findings = byCheck.get(check);
        return findings === undefined ? {check, result: 'satisfied'}
            : {check, findings: findings.sort((left, right) => compareText(jsonKey(left), jsonKey(right))), result: deriveResult(findings)};
    });
    return {checks, result: deriveResult(checks)};
};

export class SpecReadinessReviewerDraftFormatError extends Error {
    constructor(/** @type {unknown} */ cause) {
        super(cause instanceof Error ? cause.message : String(cause), {cause});
        this.name = 'SpecReadinessReviewerDraftFormatError';
        if (errorCode(cause) === SPEC_READINESS_DRAFT_FORMAT_SUBTYPES.requirementScopeContinuation) {
            this.subtype = SPEC_READINESS_DRAFT_FORMAT_SUBTYPES.requirementScopeContinuation;
        }
    }
}

const parseReviewerDraft = (/** @type {Parameters<typeof parseFindingLines>[0]} */ input) => {
    try {
        const {checks, result} = parseFindingLines(input);
        return {checks: /** @type {ReviewCheck[]} */ (checks), result};
    } catch (error) {
        throw new SpecReadinessReviewerDraftFormatError(error);
    }
};

/**
 * 读取冻结 Reviewer Request 中用于正文证据的唯一文本来源及其 artifact identity. 该 Interface 不读取当前治理文件.
 */
export const readSpecReadinessEvidenceSources = async (/** @type {{issueId: string, repositoryRoot: string, requestPath: unknown}} */ {
    issueId,
    repositoryRoot,
    requestPath,
}) => {
    const storedRequest = await readReviewerRequest({issueId, repositoryRoot, requestPath});
    const sources = new Map(storedRequest.request.inputs.map(input => [input.filePath, input.content]));
    sources.set(storedRequest.request.subject.filePath, storedRequest.request.subject.content);
    return {
        request: {
            digest: storedRequest.request.requestDigest,
            filePath: storedRequest.filePath,
            id: storedRequest.request.requestId,
        },
        sources,
    };
};

const canonicalChecks = (/** @type {JsonObject} */ response, /** @type {SnapshotInput[]} */ inputs, /** @type {string[]} */ expected = expectedChecks(inputs), /** @type {ReadinessSubject | SubjectIdentity | undefined} */ subject = undefined) => {
    if (!Array.isArray(response.checks)) throw new Error('Reviewer Response must contain a checks array.');
    /** @type {Map<string, ReviewCheck>} */
    const byCheck = new Map();
    for (const entry of response.checks) {
        if (!isJsonObject(entry) || typeof entry.check !== 'string' || !expected.includes(entry.check)) throw new Error('Reviewer Response has an unknown check.');
        if (byCheck.has(entry.check)) throw new Error('Reviewer Response has a duplicate check.');
        if (typeof entry.result !== 'string' || !['satisfied', 'gap', 'uncertain'].includes(entry.result)) throw new Error(`Invalid Reviewer result: ${entry.result}.`);
        if (entry.result === 'satisfied') {
            assertExactKeys(entry, ['check', 'result'], 'A satisfied Reviewer check');
            byCheck.set(entry.check, {check: entry.check, result: 'satisfied'});
            continue;
        }
        assertExactKeys(entry, ['check', 'findings', 'result'], 'A non-satisfied Reviewer check');
        if (!Array.isArray(entry.findings) || entry.findings.length === 0) throw new Error('A non-satisfied Reviewer check requires one or more findings.');
        const check = entry.check;
        const findings = entry.findings.map((/** @type {unknown} */ finding, /** @type {number} */ index) => {
            if (!isJsonObject(finding)) throw new Error(`Reviewer finding[${index}] is invalid.`);
            assertExactKeys(finding, ['evidence', 'finding', 'result'], `Reviewer finding[${index}]`);
            if (typeof finding.result !== 'string' || !['gap', 'uncertain'].includes(finding.result)) throw new Error(`Reviewer finding[${index}] result must be gap or uncertain.`);
            if (typeof finding.finding !== 'string' || finding.finding.trim() !== finding.finding || finding.finding.length === 0) throw new Error(`Reviewer finding[${index}] must contain finding text.`);
            const evidence = canonicalArtifactEvidence(finding.evidence, inputs, check, subject);
            if (evidence.length === 0) throw new Error(`Reviewer finding[${index}] requires evidence.`);
            return {evidence, finding: finding.finding, result: finding.result};
        }).sort((left, right) => compareText(jsonKey(left), jsonKey(right)));
        const result = deriveResult(findings);
        if (entry.result !== result) throw new Error('Reviewer check result does not match its findings.');
        byCheck.set(entry.check, {check: entry.check, findings, result});
    }
    const isRequirementScopeResult = byCheck.size === REQUIREMENT_SCOPE_CHECKS.length
        && REQUIREMENT_SCOPE_CHECKS.every(check => byCheck.has(check));
    const isCompleteResult = byCheck.size === expected.length && expected.every(check => byCheck.has(check));
    if (!isRequirementScopeResult && !isCompleteResult) throw new Error('Reviewer Response has missing checks.');
    const requirementCheck = byCheck.get('SPEC-READINESS-REQUIREMENTS');
    if (!requirementCheck) throw new Error('Reviewer Response has missing requirement check.');
    const requirementResult = requirementCheck.result;
    if (requirementResult === 'satisfied' && !isCompleteResult) {
        throw new Error('Reviewer Response must contain the complete check set when SPEC-READINESS-REQUIREMENTS is satisfied.');
    }
    if (requirementResult !== 'satisfied' && !isRequirementScopeResult) {
        throw new Error('Reviewer Response must stop after the requirement-scope checks when SPEC-READINESS-REQUIREMENTS is not satisfied.');
    }
    const selectedChecks = isRequirementScopeResult ? REQUIREMENT_SCOPE_CHECKS : expected;
    const checks = selectedChecks.map(check => {
        const value = byCheck.get(check);
        if (!value) throw new Error('Reviewer Response has missing checks.');
        return value;
    });
    const result = deriveResult(checks);
    return {checks, result};
};

const isUtcSecond = (/** @type {string} */ value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false;
    const parsed = Date.parse(value);
    return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19);
};
const canonicalException = (/** @type {JsonObject} */ response) => {
    assertExactKeys(response, ['exception'], 'Spec Readiness exception draft');
    const exception = response.exception;
    if (!isJsonObject(exception) || typeof exception.reason !== 'string' || exception.reason.trim() !== exception.reason || exception.reason.length === 0 || exception.reason.includes('\n') || typeof exception.confirmedAt !== 'string' || !isUtcSecond(exception.confirmedAt)) throw new Error('Spec Readiness exception is malformed.');
    return {exception: {confirmedAt: exception.confirmedAt, reason: exception.reason}, result: 'not-applicable'};
};

const recordException = (/** @type {unknown} */ record) => {
    if (!isJsonObject(record)) throw new Error('Malformed exception Spec Readiness record.');
    assertExactKeys(record, ['exception', 'issueId', 'result', 'schemaVersion', 'subject'], 'Exception Spec Readiness artifact');
    if (record.schemaVersion !== 6 || record.result !== 'not-applicable') throw new Error('Malformed exception Spec Readiness record.');
    if (typeof record.issueId !== 'string') throw new Error('Malformed exception Spec Readiness record.');
    parseIssueId(record.issueId);
    const exception = canonicalException({exception: record.exception});
    const subject = canonicalSubjectIdentity({issueId: record.issueId, subject: record.subject});
    return {schemaVersion: 6, issueId: record.issueId, exception: exception.exception, subject, result: 'not-applicable'};
};

const writeTemporaryArtifact = async (/** @type {{directory: string, record: unknown, repositoryRoot: string}} */ {directory, record, repositoryRoot}) => {
    const artifactsDirectory = pathWithin(directory, ['artifacts']);
    await createRepositoryDirectory(repositoryRoot, artifactsDirectory);
    const target = pathWithin(artifactsDirectory, [`artifact-${randomUUID()}.json`]);
    const write = await createAtomicWrite(repositoryRoot);
    await write(target, json(record));
    return target;
};

/**
 * 验证 Reviewer draft 并写入当前临时 canonical artifact, 不修改 tracked readiness 或 baseline.
 * 它只消费 `prepare` 保存的 Input 和审核对象快照, 所以不会在 `generate` 阶段比较当前 Repository 字节或定位符位置.
 */
const generateNormalSpecReadiness = async (/** @type {{inputPath: unknown, issueId: string, platformAdapter?: PlatformAdapter, repositoryRoot: string}} */ {
    inputPath,
    issueId,
    platformAdapter,
    repositoryRoot,
}) => {
    const directory = await workspace({issueId, platformAdapter, repositoryRoot});
    const active = await readStored(repositoryRoot, activeRequestPath(directory), 'Spec Readiness active request');
    assertExactKeys(active, ['draftPath', 'requestDigest', 'requestId', 'requestPath'], 'Spec Readiness active request');
    if (typeof active.requestPath !== 'string' || typeof active.draftPath !== 'string') throw new Error('Spec Readiness active request is malformed.');
    const activeRequest = resolveRelativePathWithinScope({path: active.requestPath, scope: repositoryRoot});
    if (activeRequest.status !== 'succeeded') throw new Error('Spec Readiness active request path escapes the Repository.');
    const storedRequest = await readReviewerRequest({issueId, repositoryRoot, requestPath: activeRequest.absolutePath});
    const activeDraft = typeof active.draftPath === 'string'
        ? resolveAbsolutePathWithinScope({path: active.draftPath, scope: repositoryRoot})
        : {status: /** @type {'blocked'} */ ('blocked')};
    if (active.requestId !== storedRequest.request.requestId
        || active.requestDigest !== storedRequest.request.requestDigest
        || activeDraft.status !== 'succeeded'
        || activeDraft.absolutePath !== storedRequest.request.draftPath) {
        throw new Error('Spec Readiness Reviewer Request is no longer active.');
    }
    const draftPath = storedRequest.request.draftPath;
    const draftBytes = await validateDraftInputPath({draftPath, inputPath, repositoryRoot});
    const draftText = decodeUtf8(draftBytes, draftPath);
    const requestInputs = storedRequest.request.inputs.map(({content, ...entry}) => ({...entry, snapshot: Buffer.from(content).toString('base64')}));
    const normal = parseReviewerDraft({
        expected: expectedChecks(requestInputs),
        inputs: requestInputs,
        subject: storedRequest.request.subject,
        text: draftText,
    });
    const record = {
        schemaVersion: 6,
        issueId,
        request: {
            digest: storedRequest.request.requestDigest,
            filePath: storedRequest.filePath,
            id: storedRequest.request.requestId,
        },
        reviewerRole: storedRequest.request.reviewerRole,
        inputs: requestInputs.map(({filePath, role, sha256: digest}) => ({filePath, role, sha256: digest})),
        subject: {
            filePath: storedRequest.request.subject.filePath,
            sha256: storedRequest.request.subject.sha256,
        },
        checks: normal.checks,
        result: normal.result,
    };
    const target = await writeTemporaryArtifact({directory, record, repositoryRoot});
    return {path: target, result: record.result};
};

export const generateSpecReadiness = async (/** @type {{inputPath: unknown, issueId: string, platformAdapter?: PlatformAdapter, repositoryRoot: string}} */ {inputPath, issueId, platformAdapter, repositoryRoot}) => {
    const issue = await readIssue({issueId, repositoryRoot});
    let record;
    if (issue.requirement.kind === 'normal') {
        return generateNormalSpecReadiness({inputPath, issueId, platformAdapter, repositoryRoot});
    } else {
        await assertExceptionApplicable({issue, repositoryRoot});
        const directory = await workspace({issueId, platformAdapter, repositoryRoot});
        if (typeof inputPath !== 'string' || !isAbsolute(inputPath)) throw new Error('Spec Readiness exception input path must be absolute.');
        const workspaceInput = resolveAbsolutePathWithinScope({path: inputPath, scope: directory});
        if (workspaceInput.status !== 'succeeded' || !workspaceInput.absolutePath.endsWith('.json')) {
            throw new Error('Spec Readiness exception input must be a JSON file in the current Agent temporary workspace.');
        }
        const repositoryInput = resolveAbsolutePathWithinScope({path: workspaceInput.absolutePath, scope: repositoryRoot});
        if (repositoryInput.status !== 'succeeded') {
            throw new Error('Spec Readiness exception input path escapes the Repository.');
        }
        const filePath = repositoryInput.relativePath.split(sep).join('/');
        const response = parseJsonObject(
            decodeUtf8(await readSafeRepositoryFile(repositoryRoot, filePath), filePath),
            'Spec Readiness exception draft',
        );
        const exception = canonicalException(response);
        record = {
            schemaVersion: 6,
            issueId,
            exception: exception.exception,
            subject: {filePath: issue.subject.filePath, sha256: issue.subject.sha256},
            result: exception.result,
        };
        const target = await writeTemporaryArtifact({directory, record, repositoryRoot});
        return {path: target, result: record.result};
    }
};

const verifyLocator = async (/** @type {{locator: EvidenceLocator, repositoryRoot: string, subject: ReadinessSubject}} */ {locator, repositoryRoot, subject}) => {
    if (!Object.hasOwn(locator, 'anchor') && !Object.hasOwn(locator, 'line')) return null;
    const text = Object.hasOwn(locator, 'line') && locator.filePath === subject.filePath
        ? subject.content
        : decodeUtf8(await readSafeRepositoryFile(repositoryRoot, locator.filePath), locator.filePath);
    if (Object.hasOwn(locator, 'anchor')) {
        const anchors = text.split(/\r?\n/).filter(line => /^#{1,6} /.test(line)).map(line => headingAnchor(line.replace(/^#{1,6} /, '')));
        return typeof locator.anchor === 'string' && anchors.includes(locator.anchor) ? null : `Review Evidence anchor does not exist: ${locator.filePath}#${locator.anchor}.`;
    }
    return typeof locator.line === 'number' && locator.line <= text.split(/\r?\n/).length ? null : `Review Evidence line does not exist: ${locator.filePath}:${locator.line}.`;
};

const recordNormal = (/** @type {unknown} */ record, /** @type {string[] | undefined} */ requiredChecks = undefined) => {
    if (!isJsonObject(record)) throw new Error('Malformed normal Spec Readiness record.');
    assertExactKeys(record, ['checks', 'inputs', 'issueId', 'request', 'result', 'reviewerRole', 'schemaVersion', 'subject'], 'Normal Spec Readiness artifact');
    if (record.schemaVersion !== 6 || !Array.isArray(record.inputs) || !Array.isArray(record.checks)) throw new Error('Malformed normal Spec Readiness record.');
    if (typeof record.issueId !== 'string') throw new Error('Malformed normal Spec Readiness record.');
    parseIssueId(record.issueId);
    const subject = canonicalSubjectIdentity({issueId: record.issueId, subject: record.subject});
    if (!isJsonObject(record.request)) throw new Error('Malformed Spec Readiness request identity.');
    assertExactKeys(record.request, ['digest', 'filePath', 'id'], 'Spec Readiness request identity');
    if (typeof record.request.digest !== 'string' || typeof record.request.id !== 'string' || typeof record.request.filePath !== 'string' || !/^[0-9a-f]{64}$/.test(record.request.digest) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(record.request.id)) throw new Error('Malformed Spec Readiness request identity.');
    const requestFilePath = normalizePath(record.request.filePath);
    const reviewerRole = canonicalReviewerRole(record.reviewerRole, 'Spec Readiness record Role identity');
    const inputs = record.inputs.map((/** @type {unknown} */ entry) => {
        if (!isJsonObject(entry)) throw new Error('Malformed Spec Readiness input record.');
        assertExactKeys(entry, ['filePath', 'role', 'sha256'], 'Spec Readiness input record');
        if (typeof entry.role !== 'string' || typeof entry.filePath !== 'string' || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error('Malformed Spec Readiness input record.');
        return {filePath: normalizePath(entry.filePath), role: entry.role, sha256: entry.sha256, snapshot: ''};
    });
    if (inputs.some((/** @type {{ role: string; }} */ input) => !INPUT_ROLES.has(input.role)) || !inputs.some((/** @type {{ role: string; }} */ input) => input.role === 'governing-spec' || input.role === 'governing-prd')) throw new Error('Malformed Spec Readiness input roles.');
    /** @type {Map<string, string>} */
    const rolesByPath = new Map();
    for (const input of inputs) {
        const existing = rolesByPath.get(input.filePath);
        if (existing && existing !== input.role) throw new Error('Spec Readiness input path has conflicting roles.');
        rolesByPath.set(input.filePath, input.role);
    }
    const inputKeys = new Set(inputs.map(input => `${input.role}\0${input.filePath}`));
    if (inputKeys.size !== inputs.length) throw new Error('Spec Readiness inputs contain duplicates.');
    const sortedInputs = [...inputs].sort((left, right) => compareText(left.filePath, right.filePath) || compareText(left.role, right.role));
    if (inputs.some((input, index) => input.filePath !== sortedInputs[index].filePath || input.role !== sortedInputs[index].role)) {
        throw new Error('Spec Readiness Inputs are not sorted.');
    }
    const recordChecks = record.checks.map((/** @type {unknown} */ check) => isJsonObject(check) && typeof check.check === 'string' ? check.check : undefined);
    const possibleChecks = [
        REQUIREMENT_SCOPE_CHECKS,
        COMMON_CHECKS,
        [...COMMON_CHECKS, MODULE_DESIGN_EXEMPTION_CHECK],
        [...COMMON_CHECKS, ...MODULE_DESIGN_FULL_CHECKS],
        [...COMMON_CHECKS, MODULE_DESIGN_EXEMPTION_CHECK, ...MODULE_DESIGN_FULL_CHECKS],
    ];
    const expected = requiredChecks ?? possibleChecks.find(candidate => candidate.length === recordChecks.length && candidate.every((check, index) => recordChecks[index] === check));
    const requiredCheckSetMatches = requiredChecks === undefined
        || (recordChecks.length === requiredChecks.length
            && recordChecks.every((check, index) => check === requiredChecks[index]))
        || (recordChecks.length === REQUIREMENT_SCOPE_CHECKS.length
            && recordChecks.every((check, /** @type {number} */ index) => check === REQUIREMENT_SCOPE_CHECKS[index]));
    if (!requiredCheckSetMatches) {
        throw new Error('Spec Readiness record check set does not match the Reviewer Request Inputs.');
    }
    if (!expected) throw new Error('Spec Readiness record has an invalid check set.');
    const checks = canonicalChecks(record, inputs, expected, subject);
    if (record.result !== checks.result) throw new Error('Spec Readiness result does not match the checks.');
    const canonical = {
        schemaVersion: 6,
        issueId: record.issueId,
        request: {digest: record.request.digest, filePath: requestFilePath, id: record.request.id},
        reviewerRole,
        inputs: inputs.map(({filePath, role, sha256: digest}) => ({filePath, role, sha256: digest})),
        subject,
        checks: checks.checks,
        result: checks.result,
    };
    return {checks: checks.checks, inputs, record: canonical};
};

const generatedArtifactPath = (/** @type {{inputPath: unknown, repositoryRoot: string}} */ {inputPath, repositoryRoot}) => {
    if (typeof inputPath !== 'string' || !isAbsolute(inputPath)) throw new Error('Spec Readiness generated artifact path must be absolute.');
    const resolved = resolveAbsolutePathWithinScope({path: inputPath, scope: repositoryRoot});
    if (resolved.status !== 'succeeded') throw new Error('Spec Readiness generated artifact path escapes the Repository.');
    const filePath = resolved.relativePath.split(sep).join('/');
    const match = /^\.tmp\/(codex|claude-code)\/[A-Za-z0-9._-]+\/((?!0000)\d{4}_(?!00)\d{2})\/spec-readiness\/artifacts\/artifact-[0-9a-f-]{36}\.json$/.exec(filePath);
    if (!match) throw new Error('Spec Readiness generated artifact path is outside the allowed temporary workspace.');
    return {absolute: resolved.absolutePath, filePath, issueDirectory: match[2]};
};

const commitPromotion = async (/** @type {{artifactBytes: string, atomicWriteFile: AtomicWriteFile, baselineBytes: string, baselineTarget: string, repositoryRoot: string, trackedTarget: string}} */ {artifactBytes, atomicWriteFile, baselineBytes, baselineTarget, repositoryRoot, trackedTarget}) => {
    let previousBaseline;
    const created = await createScopedFilesystem({root: repositoryRoot});
    if (created.status !== 'succeeded') throw new Error('Spec Readiness Repository filesystem is unavailable.');
    const baselinePath = repositoryRelativePath(repositoryRoot, baselineTarget);
    const baseline = await created.scopedFilesystem.inspect({path: baselinePath});
    if (baseline.status !== 'succeeded') throw new Error('Spec Readiness baseline could not be inspected.');
    if (baseline.entry.kind === 'file') {
        const read = await created.scopedFilesystem.readText({allowLossyDecoding: false, path: baselinePath});
        if (read.status !== 'succeeded') throw new Error('Spec Readiness baseline could not be read.');
        previousBaseline = read.text;
    } else if (baseline.entry.kind !== 'missing') {
        throw new Error('Spec Readiness baseline is not a regular file target.');
    }
    await atomicWriteFile(baselineTarget, baselineBytes);
    try {
        await atomicWriteFile(trackedTarget, artifactBytes);
    } catch (error) {
        if (previousBaseline === undefined) await removeRepositoryPath(repositoryRoot, baselineTarget);
        else await atomicWriteFile(baselineTarget, previousBaseline);
        throw error;
    }
};

/**
 * 重新验证当前临时 canonical artifact, Inputs, 审核对象与当前 Repository, 然后写入 tracked readiness 记录和 completed baseline.
 */
export const promoteSpecReadiness = async (/** @type {{atomicWriteFile?: AtomicWriteFile, inputPath: unknown, platformAdapter?: PlatformAdapter, repositoryRoot: string}} */ {atomicWriteFile = undefined, inputPath, platformAdapter, repositoryRoot}) => {
    atomicWriteFile ??= await createAtomicWrite(repositoryRoot);
    const generatedPath = generatedArtifactPath({inputPath, repositoryRoot});
    const artifactBytes = decodeUtf8(await readSafeRepositoryFile(repositoryRoot, generatedPath.filePath), generatedPath.filePath);
    const artifact = parseJsonObject(artifactBytes, 'Spec Readiness generated artifact');
    if (artifact.result === 'not-applicable') {
        const exception = recordException(artifact);
        if (artifactBytes !== json(exception)) throw new Error('Spec Readiness generated artifact is not canonical.');
        const parsedIssue = parseIssueId(exception.issueId);
        const issueDirectory = formatArtifactIdentityKey(parsedIssue);
        if (generatedPath.issueDirectory !== issueDirectory) throw new Error('Spec Readiness generated artifact path does not match its issue identity.');
        const issue = await readIssue({issueId: exception.issueId, repositoryRoot});
        if (issue.requirement.kind !== 'exception') throw new Error('The implementation issue must use the canonical Spec Readiness exception reference.');
        if (issue.subject.filePath !== exception.subject.filePath || issue.subject.sha256 !== exception.subject.sha256) {
            throw new Error(`Stale Spec Readiness subject: ${exception.subject.filePath}.`);
        }
        await assertExceptionApplicable({issue, repositoryRoot});
        const directory = await workspace({issueId: exception.issueId, platformAdapter, repositoryRoot});
        const target = await assertSafeWriteTarget(repositoryRoot, readinessRecordPath(issue));
        await commitPromotion({
            artifactBytes,
            atomicWriteFile,
            baselineBytes: artifactBytes,
            baselineTarget: baselinePath(directory),
            repositoryRoot,
            trackedTarget: target,
        });
        return {path: target, result: exception.result};
    }
    let normal = recordNormal(artifact);
    if (artifactBytes !== json(normal.record)) throw new Error('Spec Readiness generated artifact is not canonical.');
    const parsedIssue = parseIssueId(normal.record.issueId);
    const issueDirectory = formatArtifactIdentityKey(parsedIssue);
    if (generatedPath.issueDirectory !== issueDirectory) throw new Error('Spec Readiness generated artifact path does not match its issue identity.');
    const issue = await readIssue({issueId: normal.record.issueId, repositoryRoot});
    if (issue.requirement.kind !== 'normal') throw new Error('The implementation issue must use normal Spec Readiness requirements.');
    const requestAbsolute = resolveRepositoryPath(repositoryRoot, normal.record.request.filePath);
    const storedRequest = await readReviewerRequest({issueId: normal.record.issueId, repositoryRoot, requestPath: requestAbsolute});
    if (storedRequest.request.requestId !== normal.record.request.id || storedRequest.request.requestDigest !== normal.record.request.digest) throw new Error('Spec Readiness artifact request identity does not match the Reviewer Request.');
    if (!jsonSemanticallyEqual(storedRequest.request.reviewerRole, normal.record.reviewerRole)) throw new Error('Spec Readiness artifact Role identity does not match the Reviewer Request.');
    const directory = await workspace({issueId: normal.record.issueId, platformAdapter, repositoryRoot});
    const active = await readStored(repositoryRoot, activeRequestPath(directory), 'Spec Readiness active request');
    assertExactKeys(active, ['draftPath', 'requestDigest', 'requestId', 'requestPath'], 'Spec Readiness active request');
    if (
        active.requestId !== storedRequest.request.requestId
        || active.requestDigest !== storedRequest.request.requestDigest
        || active.requestPath !== storedRequest.filePath
        || active.draftPath !== storedRequest.request.draftPath
    ) throw new Error('Spec Readiness Reviewer Request is no longer active.');
    const requestInputs = storedRequest.request.inputs.map(({content, ...entry}) => entry);
    const artifactInputs = normal.inputs.map(({snapshot, ...entry}) => entry);
    if (!jsonSemanticallyEqual(requestInputs, artifactInputs)) throw new Error('Spec Readiness artifact Inputs do not match the Reviewer Request.');
    const requestSubject = {
        filePath: storedRequest.request.subject.filePath,
        sha256: storedRequest.request.subject.sha256,
    };
    if (!jsonSemanticallyEqual(normal.record.subject, requestSubject)) throw new Error('Spec Readiness artifact subject does not match the Reviewer Request.');
    normal = recordNormal(artifact, expectedChecks(storedRequest.request.inputs));
    if (artifactBytes !== json(normal.record)) throw new Error('Spec Readiness generated artifact is not canonical.');
    assertCanonicalBodyEvidence({
        checks: normal.checks,
        inputs: storedRequest.request.inputs,
        subject: storedRequest.request.subject,
    });
    for (const input of artifactInputs) {
        const bytes = await readSafeRepositoryFile(repositoryRoot, input.filePath);
        if (sha256(bytes) !== input.sha256) throw new Error(`Stale Spec Readiness Input: ${input.filePath}.`);
    }
    const reviewerRole = await currentReviewerRole(repositoryRoot);
    if (!jsonSemanticallyEqual(reviewerRole, normal.record.reviewerRole)) {
        throw new Error(`Stale Spec Readiness Reviewer Role: ${normal.record.reviewerRole.filePath}.`);
    }
    if (issue.subject.filePath !== normal.record.subject.filePath || issue.subject.sha256 !== normal.record.subject.sha256) {
        throw new Error(`Stale Spec Readiness subject: ${normal.record.subject.filePath}.`);
    }
    const target = await assertSafeWriteTarget(repositoryRoot, readinessRecordPath(issue));
    await commitPromotion({
        artifactBytes,
        atomicWriteFile,
        baselineBytes: json(storedRequest.request),
        baselineTarget: baselinePath(directory),
        repositoryRoot,
        trackedTarget: target,
    });
    return {path: target, result: normal.record.result};
};

const finish = (/** @type {string[]} */ findings) => ({authorized: findings.length === 0, findings: [...findings].sort(compareText)});

/**
 * 对已保存的当前 JSON 记录重新计算 Input, Reviewer Role 和审核对象原始字节的 SHA-256, 并聚合 stale Input 与其他当前可确定的 finding.
 * 旧记录不会被修改.
 */
export const verifySpecReadiness = async (/** @type {{issueId: string, repositoryRoot: string}} */ {issueId, repositoryRoot}) => {
    /** @type {ReadinessIssue} */
    let issue;
    try {
        issue = await readIssue({issueId, repositoryRoot});
    } catch (error) {
        return finish([errorMessage(error)]);
    }
    let record;
    try {
        record = await readStored(repositoryRoot, resolveRepositoryPath(repositoryRoot, readinessRecordPath(issue)), 'Spec Readiness record');
    } catch (error) {
        return finish([errorMessage(error)]);
    }
    if (typeof record.schemaVersion === 'number' && [1, 2, 3, 4, 5].includes(record.schemaVersion)) return finish([`Stale Spec Readiness schemaVersion: ${record.schemaVersion}.`]);
    if (record.result === 'not-applicable') {
        try {
            const exception = recordException(record);
            if (exception.issueId !== issueId) return finish(['Spec Readiness record does not match the issue.']);
            if (issue.requirement.kind !== 'exception') return finish(['Issue Spec Requirement does not match the exception Spec Readiness record.']);
            if (issue.subject.filePath !== exception.subject.filePath) return finish(['Spec Readiness record does not match the issue.']);
            if (issue.subject.sha256 !== exception.subject.sha256) {
                return finish([`Stale Spec Readiness subject: ${exception.subject.filePath}.`]);
            }
            await assertExceptionApplicable({issue, repositoryRoot});
            return finish([]);
        } catch (error) {
            return finish([errorMessage(error)]);
        }
    }
    let normal;
    try {
        normal = recordNormal(record);
    } catch (error) {
        return finish([errorMessage(error)]);
    }
    /** @type {string[]} */
    const stale = [];
    /** @type {SnapshotInput[]} */
    const currentInputs = [];
    for (const input of normal.inputs) {
        try {
            const bytes = await readSafeRepositoryFile(repositoryRoot, input.filePath);
            currentInputs.push({...input, snapshot: Buffer.from(bytes).toString('base64')});
            if (sha256(bytes) !== input.sha256) stale.push(`Stale Spec Readiness Input: ${input.filePath}.`);
        } catch (error) {
            stale.push(errorMessage(error));
        }
    }
    const findings = [...stale];
    try {
        const reviewerRole = await currentReviewerRole(repositoryRoot);
        if (!jsonSemanticallyEqual(reviewerRole, normal.record.reviewerRole)) {
            findings.push(`Stale Spec Readiness Reviewer Role: ${normal.record.reviewerRole.filePath}.`);
        }
    } catch (error) {
        findings.push(errorMessage(error));
    }
    if (currentInputs.length === normal.inputs.length) {
        try {
            normal = recordNormal(record, expectedChecks(currentInputs));
        } catch (error) {
            findings.push(errorMessage(error));
        }
    }
    if (currentInputs.length === normal.inputs.length) {
        try {
            assertCanonicalBodyEvidence({checks: normal.checks, inputs: currentInputs, subject: issue.subject});
        } catch (error) {
            findings.push(errorMessage(error));
        }
    }
    if (normal.record.issueId !== issueId || normal.record.subject.filePath !== issue.subject.filePath) {
        findings.push('Spec Readiness record does not match the issue.');
    } else if (normal.record.subject.sha256 !== issue.subject.sha256) {
        findings.push(`Stale Spec Readiness subject: ${normal.record.subject.filePath}.`);
    }
    /** @type {Map<string, SnapshotInput>} */
    const reviewed = new Map(normal.inputs.map((/** @type {SnapshotInput} */ input) => [input.filePath, input]));
    try {
        await validateRequirementEligibility(issue.requirement.requirements, repositoryRoot, reviewed);
    } catch (error) {
        findings.push(errorMessage(error));
    }
    for (const requirement of issue.requirement.requirements) {
        const input = reviewed.get(requirement.filePath);
        if (!input) {
            findings.push(`Issue governing requirement is not a reviewed governing Input: ${requirement.filePath}${requirement.anchor ? `#${requirement.anchor}` : ''}.`);
        }
    }
    if (issue.requirement.kind !== 'normal') findings.push('Issue Spec Requirement does not match the normal Spec Readiness record.');
    const locators = normal.checks.flatMap(check => check.result === 'satisfied'
        ? []
        : (check.findings ?? []).flatMap(finding => finding.evidence));
    for (const locator of locators) {
        try {
            const finding = await verifyLocator({locator, repositoryRoot, subject: issue.subject});
            if (finding) findings.push(finding);
        } catch (error) {
            findings.push(errorMessage(error));
        }
    }
    if (record.result !== 'satisfied') findings.push(`Spec Readiness result does not authorize implementation: ${record.result}.`);
    return finish(findings);
};
