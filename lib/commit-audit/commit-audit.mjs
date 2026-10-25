import {basename, dirname, isAbsolute, relative, resolve, sep} from 'node:path';

import {
    formatCanonicalArtifactId,
    parseCanonicalArtifactId,
    parseEffortDirectoryName,
    parseRegisteredArtifactPath,
} from '../arw-common/artifact-identity.mjs';
import {compareCommittedArtifactIdentities} from '../arw-common/artifacts.mjs';
import {readIssueRequirement} from '../arw-common/issue-documents.mjs';
import {readStagedCandidate} from '../arw-common/repository-state-inspector.mjs';
import {createFileTransaction} from '../common/file-transaction.mjs';
import {
    createScopedFilesystem,
    joinRelativePath,
    resolveAbsolutePathWithinScope,
    resolveRelativePathWithinScope,
} from '../common/filesystem.mjs';
import {createNodeGitRunner} from '../common/git-process.mjs';
import {compareText, exactKeys, jsonSemanticallyEqual, parseJsonText, serializeJson, sha256} from '../common/json.mjs';

/** @typedef {{filePath: string, line: number}} Locator */
/** @typedef {{filePath: string, lines: Array<number | [number, number]>} | {command: string, exitCode: number}} Evidence */
/** @typedef {{evidence: Evidence[], finding?: string, requirement: string, result: string, source: Locator}} Requirement */
/** @typedef {{authorizingIssueIds?: string[], command?: string, confirmedAt?: string, documents?: string[], draftPath?: string, effort?: string, evidence?: AuditObject[], exception?: AuditObject, exitCode?: number, filePath?: string, finding?: string, gate1?: AuditObject[], gate2?: AuditObject[], gate2Exception?: AuditObject, issueId?: string, line?: number, lines?: Array<number | [number, number]>, minimumSourceLines?: Array<{count: number, filePath: string}>, reason?: string, requirement?: string, requirements?: AuditObject[], result?: string, source?: AuditObject}} AuditObject */
/** @typedef {{diagnostics: Array<{code: string, field?: string, line?: number, message: string, path?: string}>, kind: string, phase: string, status: 'failed'}} GenerationFailure */
/** @typedef {{diagnostics: Array<{code: string, field?: string, line?: number, message: string}>, kind: 'review-output-invalid', phase: 'evidence' | 'requirement-coverage' | 'review-syntax', status: 'failed'}} ReviewOutputInvalidFailure */
/** @typedef {Awaited<ReturnType<typeof readStagedCandidate>>} StagedCandidate */
/** @typedef {{bytes: Buffer, effortDirectory: string, effortNumber: string, filePath: string, issueId: string, issueNumber: string, status: string}} StagedIssue */
/** @typedef {{byEffort: Map<string, StagedIssue[]>, byId: Map<string, StagedIssue>, effortDirectories: Map<string, string>, terminalTransitions: Set<string>}} IssueInventory */
/** @typedef {{filePath: string, record: AuditObject | {requirements: Requirement[], result: string}}} AuditOutput */
/** @typedef {{code: string, message: string, path?: string}} FilesystemDiagnostic */
/** @typedef {{diagnostics: FilesystemDiagnostic[], status: 'blocked'} | {diagnostics: FilesystemDiagnostic[], stage: string, status: 'failed'} | {bytes?: Buffer, diagnostics: [], entry?: {kind: string}, path?: string, removed?: boolean, status: 'succeeded'}} TransactionFilesystemResult */

const json = (/** @type {unknown} */ value) => {
    const serialized = serializeJson(value);
    if (serialized.status !== 'succeeded') throw new Error('Commit Audit value cannot be serialized as JSON.');
    return serialized.bytes.toString('utf8');
};

const parseIssueId = (/** @type {string} */ issueId) => {
    let parsed;
    try {
        parsed = parseCanonicalArtifactId(issueId);
    } catch {
        throw new Error('Invalid implementation issue ID.');
    }
    if (parsed.kind !== 'issue' || parsed.qualifier !== null || parsed.issueNumber === null) throw new Error('Invalid implementation issue ID.');
    return {effortNumber: parsed.effortNumber, issueNumber: parsed.issueNumber};
};

const nonEmptyText = (/** @type {string | undefined} */ value, /** @type {string} */ label) => {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string.`);
    return value;
};

const relativeFilePath = (/** @type {string | undefined} */ value, /** @type {string} */ label, /** @type {string} */ repositoryRoot = process.cwd()) => {
    if (typeof value !== 'string' || value.includes('\\') || value.includes('\0')) throw new Error(`${label} must be a Repository-relative path.`);
    let resolved;
    try {
        resolved = resolveRelativePathWithinScope({path: value ?? '', scope: repositoryRoot});
    } catch {
        throw new Error(`${label} must be a Repository-relative path.`);
    }
    if (resolved.status !== 'succeeded' || resolved.relativePath.length === 0) {
        throw new Error(`${label} must be a Repository-relative path.`);
    }
    return resolved.relativePath.split(sep).join('/');
};

const isGate2DocumentPath = (/** @type {string} */ filePath) => /^docs\/adr\/[^/]+\.md$/.test(filePath)
    || /^docs\/specs\/(?:[^/]+\/)*[^/]+\.md$/.test(filePath)
    || /^\.scratch\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:spec|PRD)\.md$/.test(filePath);

const gate2DocumentPath = (/** @type {string | undefined} */ value, /** @type {string} */ label) => {
    const filePath = relativeFilePath(value, label);
    if (!isGate2DocumentPath(filePath)) throw new Error(`${label} must use a recognized spec, PRD, or ADR path.`);
    return filePath;
};

const locator = (/** @type {AuditObject | null | undefined} */ value, /** @type {string} */ label, /** @type {string} */ repositoryRoot = process.cwd()) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a locator object.`);
    assertExactKeys(value, ['filePath', 'line'], label);
    const filePath = relativeFilePath(value.filePath, `${label}.filePath`, repositoryRoot);
    const line = value.line;
    if (!Number.isSafeInteger(line) || line === undefined || line < 1) throw new Error(`${label}.line must be a positive safe integer.`);
    return {filePath, line};
};

const locatorKey = (/** @type {Locator} */ value) => `${value.filePath}\0${value.line}`;

const canonicalLineRegions = (/** @type {Array<number | [number, number]> | undefined} */ values, /** @type {string} */ label) => {
    if (!Array.isArray(values) || values.length === 0) throw new Error(`${label} must be a non-empty array.`);
    /** @type {Array<[number, number]>} */
    const regions = values.map((value, index) => {
        if (Number.isSafeInteger(value) && /** @type {number} */ (value) > 0) return /** @type {[number, number]} */ ([/** @type {number} */ (value), /** @type {number} */ (value)]);
        if (Array.isArray(value) && value.length === 2 && value.every(item => Number.isSafeInteger(item) && item > 0) && value[0] <= value[1]) return /** @type {[number, number]} */ ([value[0], value[1]]);
        throw new Error(`${label}[${index}] must be a positive safe integer or an ordered positive safe integer pair.`);
    }).sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    /** @type {Array<[number, number]>} */
    const merged = [];
    for (const region of regions) {
        const previous = merged.at(-1);
        if (previous && region[0] <= previous[1] + 1) previous[1] = Math.max(previous[1], region[1]);
        else merged.push([...region]);
    }
    return merged.map(([start, end]) => start === end ? start : /** @type {[number, number]} */ ([start, end]));
};

/** @returns {Evidence} */
const evidence = (/** @type {AuditObject | null} */ value, /** @type {string} */ label, /** @type {string} */ repositoryRoot = process.cwd()) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an evidence object.`);
    const hasFilePath = Object.hasOwn(value, 'filePath');
    const hasCommand = Object.hasOwn(value, 'command');
    if (hasFilePath === hasCommand) throw new Error(`${label} must contain exactly one locator or command.`);
    if (hasFilePath) {
        assertExactKeys(value, ['filePath', 'lines'], label);
        return {
            filePath: relativeFilePath(value.filePath, `${label}.filePath`, repositoryRoot),
            lines: canonicalLineRegions(value.lines, `${label}.lines`),
        };
    }
    assertExactKeys(value, ['command', 'exitCode'], label);
    const command = nonEmptyText(value.command, `${label}.command`);
    const exitCode = value.exitCode;
    if (!Number.isSafeInteger(exitCode) || exitCode === undefined) throw new Error(`${label}.exitCode must be a safe integer.`);
    return {command, exitCode};
};

const evidenceKey = (/** @type {Evidence} */ value) => 'command' in value
    ? `command\0${value.command}\0${value.exitCode}`
    : `file\0${value.filePath}`;

const canonicalEvidence = (/** @type {AuditObject[] | undefined} */ values, /** @type {string} */ label, /** @type {string} */ repositoryRoot = process.cwd()) => {
    if (!Array.isArray(values)) throw new Error(`${label} must be an array.`);
    /** @type {Map<string, Evidence>} */
    const canonical = new Map();
    for (const [index, value] of values.entries()) {
        const normalized = evidence(value, `${label}[${index}]`, repositoryRoot);
        const key = evidenceKey(normalized);
        const previous = canonical.get(key);
        if (previous && 'filePath' in previous && 'filePath' in normalized) {
            previous.lines = canonicalLineRegions([...previous.lines, ...normalized.lines], `${label}[${index}].lines`);
        } else if (!previous) canonical.set(key, normalized);
    }
    return [...canonical.entries()].sort(([left], [right]) => compareText(left, right)).map(([, value]) => value);
};

const deriveResult = (/** @type {Requirement[]} */ requirements) => requirements.some((/** @type {{ result: string; }} */ requirement) => requirement.result === 'gap')
    ? 'gap'
    : requirements.some((/** @type {{ result: string; }} */ requirement) => requirement.result === 'uncertain') ? 'uncertain' : 'satisfied';

const validateTopLevelResult = (/** @type {AuditObject} */ input, /** @type {string} */ result) => {
    if (Object.hasOwn(input, 'result') && input.result !== result) throw new Error('Commit Audit result does not match the derived requirement result.');
};

const sourceWithLine = (/** @type {AuditObject | undefined} */ value, /** @type {string} */ label) => {
    const source = locator(value, label);
    if (source.line === undefined) throw new Error(`${label} must contain filePath and line.`);
    return {...source, line: source.line};
};

const requirementKey = (/** @type {{requirement: string, source: Locator}} */ {requirement, source}) => `${locatorKey(source)}\0${requirement}`;

const compareRequirement = (/** @type {Requirement} */ left, /** @type {Requirement} */ right) => compareText(left.source.filePath, right.source.filePath)
    || left.source.line - right.source.line
    || compareText(left.requirement, right.requirement);

const canonicalGate1 = (/** @type {AuditObject} */ input) => {
    if (!Array.isArray(input.requirements) || input.requirements.length === 0) throw new Error('Gate 1 requires a non-empty requirements array.');
    /** @type {Map<string, Requirement>} */
    const requirements = new Map();
    for (const [index, value] of input.requirements.entries()) {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Gate 1 requirement[${index}] must be an object.`);
        assertExactKeys(value, value.result === 'satisfied'
            ? ['evidence', 'requirement', 'result', 'source']
            : ['evidence', 'finding', 'requirement', 'result', 'source'], `Gate 1 requirement[${index}]`);
        const hasSource = Object.hasOwn(value, 'source');
        if (!hasSource) throw new Error(`Gate 1 requirement[${index}].source must contain filePath and line.`);
        const source = sourceWithLine(value.source, `Gate 1 requirement[${index}].source`);
        const requirement = nonEmptyText(value.requirement, `Gate 1 requirement[${index}].requirement`);
        const result = value.result;
        if (typeof result !== 'string' || !['satisfied', 'gap', 'uncertain'].includes(result)) throw new Error(`Gate 1 requirement[${index}].result must be satisfied, gap, or uncertain.`);
        const hasFinding = typeof value.finding === 'string' && value.finding.trim().length > 0;
        const normalized = {
            evidence: canonicalEvidence(value.evidence, `Gate 1 requirement[${index}].evidence`),
            ...(result === 'satisfied' ? {} : {finding: value.finding}),
            requirement,
            result,
            source,
        };
        if (normalized.evidence.length === 0) throw new Error(`Gate 1 requirement[${index}] evidence must be non-empty.`);
        if (normalized.result === 'satisfied' && Object.hasOwn(value, 'finding')) throw new Error(`Gate 1 requirement[${index}] satisfied result requires no finding.`);
        if (normalized.result !== 'satisfied' && !hasFinding) throw new Error(`Gate 1 requirement[${index}] non-satisfied result requires a finding.`);
        const key = requirementKey(normalized);
        const existing = requirements.get(key);
        if (existing && !jsonSemanticallyEqual(existing, normalized)) throw new Error(`Gate 1 has conflicting requirements for source and requirement: ${source.filePath}:${source.line}.`);
        requirements.set(key, normalized);
    }
    const values = [...requirements.values()].sort(compareRequirement);
    const result = deriveResult(values);
    validateTopLevelResult(input, result);
    return {requirements: values, result};
};

const canonicalDocuments = (/** @type {string[] | undefined} */ documents) => {
    if (!Array.isArray(documents) || documents.length === 0) throw new Error('Gate 2 requires a non-empty documents array.');
    return [...new Set(documents.map((document, index) => gate2DocumentPath(document, `Gate 2 documents[${index}]`)))].sort(compareText);
};

const canonicalGate2Normal = (/** @type {AuditObject} */ input) => {
    const documents = canonicalDocuments(input.documents);
    if (!Array.isArray(input.requirements) || input.requirements.length === 0) throw new Error('Gate 2 requires a non-empty requirements array.');
    /** @type {Map<string, Requirement>} */
    const requirements = new Map();
    for (const [index, value] of input.requirements.entries()) {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Gate 2 requirement[${index}] must be an object.`);
        assertExactKeys(value, value.result === 'satisfied'
            ? ['evidence', 'requirement', 'result', 'source']
            : ['evidence', 'finding', 'requirement', 'result', 'source'], `Gate 2 requirement[${index}]`);
        const source = sourceWithLine(value.source, `Gate 2 requirement[${index}].source`);
        if (!documents.includes(source.filePath)) throw new Error(`Gate 2 requirement[${index}].source must reference a listed document.`);
        const requirement = nonEmptyText(value.requirement, `Gate 2 requirement[${index}].requirement`);
        const result = value.result;
        if (typeof result !== 'string' || !['satisfied', 'gap', 'uncertain'].includes(result)) throw new Error(`Gate 2 requirement[${index}].result must be satisfied, gap, or uncertain.`);
        const hasFinding = typeof value.finding === 'string' && value.finding.trim().length > 0;
        const normalized = {evidence: canonicalEvidence(value.evidence, `Gate 2 requirement[${index}].evidence`), ...(result === 'satisfied' ? {} : {finding: value.finding}), requirement, result, source};
        if (normalized.evidence.length === 0) throw new Error(`Gate 2 requirement[${index}] evidence must be non-empty.`);
        if (normalized.result === 'satisfied' && Object.hasOwn(value, 'finding')) throw new Error(`Gate 2 requirement[${index}] satisfied result requires no finding.`);
        if (normalized.result !== 'satisfied' && !hasFinding) throw new Error(`Gate 2 requirement[${index}] non-satisfied result requires a finding.`);
        const key = requirementKey(normalized);
        const existing = requirements.get(key);
        if (existing && !jsonSemanticallyEqual(existing, normalized)) throw new Error(`Gate 2 has conflicting requirements for source and requirement: ${source.filePath}:${source.line}.`);
        requirements.set(key, normalized);
    }
    const values = [...requirements.values()].sort(compareRequirement);
    const result = deriveResult(values);
    validateTopLevelResult(input, result);
    return {documents, requirements: values, result};
};

const canonicalGate2ExceptionValue = (/** @type {AuditObject | undefined} */ value, /** @type {string} */ label) => {
    assertExactKeys(value ?? null, ['confirmedAt', 'reason'], label);
    const reason = nonEmptyText(value?.reason, `${label}.reason`);
    const confirmedAt = nonEmptyText(value?.confirmedAt, `${label}.confirmedAt`);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(confirmedAt)
        || Number.isNaN(Date.parse(confirmedAt))
        || new Date(confirmedAt).toISOString() !== `${confirmedAt.slice(0, -1)}.000Z`) {
        throw new Error(`${label}.confirmedAt must be a UTC timestamp with second precision.`);
    }
    return {confirmedAt, reason};
};

const canonicalGate2Exception = (/** @type {AuditObject} */ input) => {
    const exception = canonicalGate2ExceptionValue(input.exception, 'Gate 2 exception');
    if (!Array.isArray(input.documents) || input.documents.length !== 0) throw new Error('Gate 2 exception documents must be an empty array.');
    if (!Array.isArray(input.requirements) || input.requirements.length !== 0) throw new Error('Gate 2 exception requirements must be an empty array.');
    if (Object.hasOwn(input, 'result') && input.result !== 'not-applicable') throw new Error('Gate 2 exception result must be not-applicable.');
    return {documents: [], exception, requirements: [], result: 'not-applicable'};
};

const canonicalGate2 = (/** @type {AuditObject} */ input) => Object.hasOwn(input, 'exception') ? canonicalGate2Exception(input) : canonicalGate2Normal(input);

const bodyLineNumbers = (/** @type {string} */ text) => {
    const lines = text.split(/\r?\n/);
    const bodyLines = new Set();
    let fence;
    for (const [index, line] of lines.entries()) {
        const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
        if (marker) {
            if (fence === undefined) fence = {character: marker[0], length: marker.length};
            else if (marker[0] === fence.character && marker.length >= fence.length) fence = undefined;
            continue;
        }
        if (fence !== undefined || line.trim().length === 0 || /^#{1,6} /.test(line)) continue;
        bodyLines.add(index + 1);
    }
    return bodyLines;
};

const bodyLineNumbersInRange = (/** @type {{end: number, lines: string[], start: number}} */ {end, lines, start}) => {
    const local = bodyLineNumbers(lines.slice(start, end).join('\n'));
    return new Set([...local].map(line => line + start));
};

const issueRequirementLineNumbers = (/** @type {{filePath: string, text: string}} */ {filePath, text}) => {
    const lines = text.split(/\r?\n/);
    const heading = (/** @type {string} */ value) => lines.indexOf(value);
    const whatToBuild = heading('## What to build');
    const specRequirement = heading('## Spec Requirement');
    const acceptanceCriteria = heading('## Acceptance criteria');
    const blockedBy = heading('## Blocked by');
    if (whatToBuild < 0 || specRequirement < 0 || acceptanceCriteria < 0 || blockedBy < 0 || !(whatToBuild < specRequirement && specRequirement < acceptanceCriteria && acceptanceCriteria < blockedBy)) {
        throw new Error(`Commit Audit issue has malformed requirement sections: ${filePath}.`);
    }
    const required = bodyLineNumbersInRange({end: specRequirement, lines, start: whatToBuild + 1});
    for (const [index, line] of lines.slice(acceptanceCriteria + 1, blockedBy).entries()) {
        if (/^- \[[ xX]\] /.test(line)) required.add(acceptanceCriteria + index + 2);
    }
    return required;
};

const verifyGate1Sources = (/** @type {{filePath: string, record: {requirements: Requirement[]}, text: string}} */ {filePath, record, text}) => {
    /** @type {string[]} */
    const errors = [];
    const required = issueRequirementLineNumbers({filePath, text});
    const sourceLines = new Set();
    for (const requirement of record.requirements) {
        if (!Object.hasOwn(requirement, 'source')) continue;
        if (requirement.source.filePath !== filePath) {
            errors.push(`Gate 1 source must reference its current issue: ${filePath}.`);
            continue;
        }
        if (!required.has(requirement.source.line)) {
            errors.push(`Gate 1 source line is not an issue requirement line: ${filePath}:${requirement.source.line}.`);
            continue;
        }
        sourceLines.add(requirement.source.line);
    }
    for (const line of [...required].sort((left, right) => left - right)) {
        if (!sourceLines.has(line)) errors.push(`Gate 1 record does not cover issue requirement line: ${filePath}:${line}.`);
    }
    return errors;
};

const verifyGate2Sources = (/** @type {{record: {documents?: string[], requirements?: Requirement[]}, textByPath: Map<string, string>}} */ {record, textByPath}) => {
    /** @type {string[]} */
    const errors = [];
    if (!Object.hasOwn(record, 'requirements')) return errors;
    for (const document of record.documents ?? []) {
        const text = textByPath.get(document);
        if (text === undefined) continue;
        const bodyLines = bodyLineNumbers(text);
        const sourceLines = new Set();
        for (const requirement of (record.requirements ?? []).filter(item => item.source.filePath === document)) {
            if (!bodyLines.has(requirement.source.line)) {
                errors.push(`Gate 2 source line is not a governing document body line: ${document}:${requirement.source.line}.`);
                continue;
            }
            sourceLines.add(requirement.source.line);
        }
        const minimum = Math.ceil(bodyLines.size / 3);
        if (sourceLines.size < minimum) errors.push(`Gate 2 document has ${sourceLines.size} distinct valid source lines but requires at least ${minimum}: ${document}.`);
    }
    return errors;
};

const assertExactKeys = (/** @type {{} | null} */ value, /** @type {string[]} */ expected, /** @type {string} */ label) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    if (!exactKeys(value, expected)) throw new Error(`${label} has unknown or missing fields.`);
};

const canonicalAuthorizingIssueIds = (/** @type {string[] | undefined} */ value) => {
    if (!Array.isArray(value) || value.length === 0) throw new Error('Commit Audit authorizingIssueIds must be a non-empty array.');
    const ids = value.map((issueId, index) => {
        parseIssueId(issueId);
        if (index > 0 && compareText(value[index - 1], issueId) >= 0) throw new Error('Commit Audit authorizingIssueIds must be unique and sorted.');
        return issueId;
    });
    return ids;
};

const candidateBytes = (/** @type {{bytes: Buffer | null}} */ file, /** @type {string} */ filePath) => {
    if (file.bytes === null) throw new Error(`Commit Audit staged regular file has no bytes: ${filePath}.`);
    return file.bytes;
};

const previousIssueFile = (/** @type {StagedCandidate} */ candidate, /** @type {{canonicalId: string, effortDirectory: string, issueFilename: string | null}} */ path, /** @type {string} */ filePath) => {
    const exact = candidate.headFiles.get(filePath);
    if (exact || path.issueFilename === null) return exact;
    for (const [headPath, file] of candidate.headFiles) {
        try {
            const identity = parseRegisteredArtifactPath(headPath);
            if (identity.kind === 'issue' && identity.canonicalId === path.canonicalId) return file;
        } catch {
            // Legacy unnumbered paths are resolved by the migration fallback below.
        }
    }
    try {
        const effort = parseEffortDirectoryName(path.effortDirectory);
        return candidate.headFiles.get(joinRelativePath('.scratch', effort.slug, 'issues', path.issueFilename));
    } catch {
        return undefined;
    }
};

const stagedIssueInventory = (/** @type {StagedCandidate} */ candidate) => {
    /** @type {Map<string, StagedIssue>} */
    const byId = new Map();
    /** @type {Map<string, StagedIssue[]>} */
    const byEffort = new Map();
    /** @type {Map<string, string>} */
    const effortDirectories = new Map();
    /** @type {Set<string>} */
    const terminalTransitions = new Set();
    for (const [filePath, file] of [...candidate.files.entries()].sort(([left], [right]) => compareText(left, right))) {
        let path;
        try {
            path = parseRegisteredArtifactPath(filePath);
        } catch {
            continue;
        }
        if (path.kind !== 'issue' || path.issueNumber === null || path.issueFilename === null || !file.mode.startsWith('100')) continue;
        const bytes = candidateBytes(file, filePath);
        const status = issueStatus(bytes, filePath);
        if (status === null) continue;
        const issueId = path.canonicalId;
        const issue = {
            bytes,
            effortDirectory: path.effortDirectory,
            effortNumber: path.effortNumber,
            filePath,
            issueId,
            issueNumber: path.issueNumber,
            status,
        };
        const existingDirectory = effortDirectories.get(path.effortNumber);
        if (existingDirectory !== undefined && existingDirectory !== path.effortDirectory) {
            throw new Error(`Commit Audit staged candidate contains duplicate effort number: ${path.effortNumber}.`);
        }
        effortDirectories.set(path.effortNumber, path.effortDirectory);
        if (byId.has(issueId)) throw new Error(`Commit Audit staged candidate contains duplicate canonical issue ID: ${issueId}.`);
        byId.set(issueId, issue);
        const effortIssues = byEffort.get(path.effortNumber) ?? [];
        effortIssues.push(issue);
        byEffort.set(path.effortNumber, effortIssues);
        const previousFile = previousIssueFile(candidate, path, filePath);
        const previous = previousFile ? issueStatus(candidateBytes(previousFile, filePath), filePath) : null;
        if (TERMINAL_ISSUE_STATUSES.has(status) && (previous === null || !TERMINAL_ISSUE_STATUSES.has(previous))) terminalTransitions.add(issueId);
    }
    return {byEffort, byId, effortDirectories, terminalTransitions};
};

const nodeScopedFilesystemFactory = {open: createScopedFilesystem};

const validatedGitRunner = (/** @type {Parameters<typeof readStagedCandidate>[0]['git']} */ delegate) => ({
    async run(/** @type {{argv: string[], input?: Buffer | string}} */ input) {
        if (!input || !Array.isArray(input.argv) || input.argv.some(argument => typeof argument !== 'string')
            || (input.input !== undefined && typeof input.input !== 'string' && !Buffer.isBuffer(input.input))) {
            throw new TypeError('GitRunner input violates the Commit Audit Interface.');
        }
        const result = await delegate.run(input);
        const completed = Number.isSafeInteger(result?.code) && result.failure === null;
        const interrupted = result?.code === null && ['process', 'timeout'].includes(result.failure ?? '');
        if ((!completed && !interrupted) || !Buffer.isBuffer(result?.stdout) || typeof result?.stderr !== 'string'
            || (interrupted && (result.stdout.length !== 0 || result.stderr.length !== 0))) {
            throw new Error('GitRunner returned a result that violates the Commit Audit Interface.');
        }
        return result;
    },
});

const commitAuditGit = (/** @type {Parameters<typeof readStagedCandidate>[0]['git'] | undefined} */ git, /** @type {string} */ repositoryRoot) => validatedGitRunner(git ?? createNodeGitRunner(repositoryRoot));

const diagnostic = (/** @type {string} */ code, /** @type {string} */ message, /** @type {{field?: string, line?: number, path?: string}} */ details = {}) => ({code, ...details, message});

const REVIEW_OUTPUT_FAILURE_CODES = new Map([
    ['review-syntax', new Map([
        ['review-json-invalid', 'line'],
        ['review-read-failed', null],
        ['review-row-invalid', 'line'],
        ['review-utf8-invalid', null],
    ])],
    ['requirement-coverage', new Map([
        ['requirement-conflicting', 'field'],
        ['requirement-duplicate', 'field'],
        ['requirement-missing', 'field'],
        ['requirement-source-invalid', 'field'],
        ['requirement-source-unexpected', 'field'],
    ])],
    ['evidence', new Map([['evidence-locator-invalid', 'field']])],
]);

const validReviewOutputDiagnostic = (/** @type {unknown} */ value, /** @type {Map<string, string | null>} */ codes) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const diagnostic = /** @type {Record<string, unknown>} */ (value);
    const locatorField = typeof diagnostic.code === 'string' ? codes.get(diagnostic.code) : undefined;
    if (locatorField === undefined
        || !exactKeys(diagnostic, ['code', ...(locatorField === null ? [] : [locatorField]), 'message'])
        || typeof diagnostic.message !== 'string'
        || diagnostic.message.length === 0) return false;
    if (locatorField === 'line') return Number.isSafeInteger(diagnostic.line) && /** @type {number} */ (diagnostic.line) > 0;
    return locatorField !== 'field' || typeof diagnostic.field === 'string' && diagnostic.field.length > 0;
};

/** @returns {value is ReviewOutputInvalidFailure} */
export const isCommitAuditReviewOutputInvalid = (/** @type {unknown} */ value) => {
    if (!exactKeys(value, ['diagnostics', 'kind', 'phase', 'status'])) return false;
    const failure = /** @type {Record<string, unknown>} */ (value);
    const codes = typeof failure.phase === 'string' ? REVIEW_OUTPUT_FAILURE_CODES.get(failure.phase) : undefined;
    return failure.status === 'failed'
        && failure.kind === 'review-output-invalid'
        && codes !== undefined
        && Array.isArray(failure.diagnostics)
        && failure.diagnostics.length > 0
        && failure.diagnostics.every(item => validReviewOutputDiagnostic(item, codes));
};

/** @returns {GenerationFailure} */
const failedGeneration = (/** @type {string} */ phase, /** @type {string} */ kind, /** @type {Array<{code: string, field?: string, line?: number, message: string, path?: string}>} */ diagnostics) => ({
    diagnostics,
    kind,
    phase,
    status: 'failed',
});

const stableDiagnostics = (/** @type {Array<{code: string, field?: string, line?: number, message: string, path?: string}>} */ diagnostics) => diagnostics.sort((left, right) => (
    (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER)
    || compareText(left.field ?? left.path ?? '', right.field ?? right.path ?? '')
    || compareText(left.code, right.code)
    || compareText(left.message, right.message)
));

const validateRequestHandle = (/** @type {{fileName: string, path: string, repositoryRoot: string}} */ {fileName, path, repositoryRoot}) => {
    if (typeof path !== 'string' || !isAbsolute(path) || basename(path) !== fileName) {
        throw new Error(`Commit Audit path must be an absolute ${fileName} path.`);
    }
    const scoped = resolveAbsolutePathWithinScope({path, scope: repositoryRoot});
    if (scoped.status !== 'succeeded' || !scoped.relativePath.split(sep).join('/').startsWith('.tmp/')) {
        throw new Error(`Commit Audit ${fileName} must be inside the Repository .tmp directory.`);
    }
    return {directory: dirname(scoped.absolutePath), path: scoped.absolutePath};
};

const validateReviewPath = (/** @type {{path: string, repositoryRoot: string}} */ {path, repositoryRoot}) => {
    if (typeof path !== 'string' || !isAbsolute(path) || !path.endsWith('.jsonl')) {
        throw new Error('Commit Audit reviewPath must be an absolute JSONL path.');
    }
    const scoped = resolveAbsolutePathWithinScope({path, scope: repositoryRoot});
    if (scoped.status !== 'succeeded' || !scoped.relativePath.split(sep).join('/').startsWith('.tmp/')) {
        throw new Error('Commit Audit reviewPath must be inside the Repository .tmp directory.');
    }
    return {directory: dirname(scoped.absolutePath), fileName: basename(scoped.absolutePath)};
};

const openRequestFilesystem = async (/** @type {{directory: string, repositoryRoot: string, scopedFilesystemFactory?: {open: typeof createScopedFilesystem}}} */ {directory, repositoryRoot, scopedFilesystemFactory = nodeScopedFilesystemFactory}) => {
    if (!scopedFilesystemFactory || typeof scopedFilesystemFactory.open !== 'function') throw new TypeError('scopedFilesystemFactory.open must be a function.');
    const opened = await scopedFilesystemFactory.open({root: directory});
    if (!validFilesystemResultForPath(opened, directory, ['scopedFilesystem'])) {
        throw new Error('ScopedFilesystemFactory returned an invalid result.');
    }
    if (opened.status !== 'succeeded') {
        const messages = opened.diagnostics.map(item => item.message).join(' ');
        throw new Error(messages || 'Commit Audit Request filesystem could not be opened.');
    }
    const filesystem = opened.scopedFilesystem;
    if (filesystem === null
        || typeof filesystem !== 'object'
        || Array.isArray(filesystem)
        || !exactKeys(filesystem, ['createDirectory', 'inspect', 'list', 'read', 'readText', 'remove', 'resolve', 'root', 'setMode', 'write'])
        || typeof filesystem.root !== 'string'
        || !isAbsolute(filesystem.root)
        || resolve(filesystem.root) !== resolve(directory)
        || typeof filesystem.resolve !== 'function'
        || typeof filesystem.inspect !== 'function'
        || typeof filesystem.read !== 'function'
        || typeof filesystem.readText !== 'function'
        || typeof filesystem.list !== 'function'
        || typeof filesystem.createDirectory !== 'function'
        || typeof filesystem.write !== 'function'
        || typeof filesystem.remove !== 'function'
        || typeof filesystem.setMode !== 'function') {
        throw new Error('ScopedFilesystemFactory returned an invalid result.');
    }
    const root = filesystem.resolve({path: '.'});
    if (!validFilesystemResult(root, ['absolutePath', 'relativePath'], false)
        || root.status !== 'succeeded'
        || typeof root.absolutePath !== 'string'
        || !isAbsolute(root.absolutePath)
        || typeof root.relativePath !== 'string'
        || root.relativePath !== ''
        || resolve(root.absolutePath) !== resolve(filesystem.root)) {
        throw new Error('ScopedFilesystemFactory returned an invalid result.');
    }
    const repositoryPath = root.status === 'succeeded'
        ? resolveAbsolutePathWithinScope({path: root.absolutePath, scope: repositoryRoot})
        : root;
    if (!repositoryPath || repositoryPath.status !== 'succeeded' || !repositoryPath.relativePath.split(sep).join('/').startsWith('.tmp/')) {
        throw new Error('Commit Audit Request filesystem root must remain inside the Repository .tmp directory.');
    }
    return filesystem;
};

const readJsonObject = async (/** @type {{filesystem: Awaited<ReturnType<typeof openRequestFilesystem>>, label: string, path: string}} */ {filesystem, label, path}) => {
    const read = await filesystem.read({path, rejectHardLinks: true});
    if (!validFilesystemResultForPath(read, path, ['bytes', 'path'])
        || read.status === 'succeeded' && (!Buffer.isBuffer(read.bytes) || read.path !== path)) {
        throw new Error(`${label} read returned an invalid result.`);
    }
    if (read.status !== 'succeeded') throw new Error(`${label} must be an existing regular file.`);
    const parsed = parseJsonText(read.bytes);
    if (parsed.status !== 'succeeded' || parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
        throw new Error(`${label} must contain one JSON object.`);
    }
    return parsed.value;
};

const canonicalGate2ExceptionInput = (/** @type {AuditObject | undefined} */ value) => {
    if (value === undefined) return undefined;
    return canonicalGate2ExceptionValue(value, 'Commit Audit gate2Exception');
};

const prepareInput = (/** @type {AuditObject} */ input) => {
    const keys = Object.hasOwn(input, 'gate2Exception') ? ['authorizingIssueIds', 'gate2Exception'] : ['authorizingIssueIds'];
    assertExactKeys(input, keys, 'Commit Audit input');
    const authorizingIssueIds = canonicalAuthorizingIssueIds(input.authorizingIssueIds);
    const efforts = new Set(authorizingIssueIds.map(issueId => parseIssueId(issueId).effortNumber));
    if (efforts.size !== 1) throw new Error('Commit Audit authorizingIssueIds must all belong to one effort.');
    return {
        authorizingIssueIds,
        effort: [...efforts][0],
        gate2Exception: canonicalGate2ExceptionInput(/** @type {AuditObject | undefined} */ (input.gate2Exception)),
    };
};

const gate1RequestScope = (/** @type {{inventory: IssueInventory, issueIds: Set<string>}} */ {inventory, issueIds}) => {
    const gate1 = [];
    for (const issueId of [...inventory.terminalTransitions].sort(compareText)) {
        if (!issueIds.has(issueId)) throw new Error(`Commit Audit terminal issue transition is not authorized: ${issueId}.`);
        const issue = inventory.byId.get(issueId);
        if (!issue) throw new Error(`Commit Audit authorizing issue is not present in the staged candidate: ${issueId}.`);
        const requirements = [...issueRequirementLineNumbers({filePath: issue.filePath, text: decodeCandidateText(issue.bytes, issue.filePath)})]
            .sort((left, right) => left - right)
            .map(line => ({filePath: issue.filePath, line}));
        gate1.push({issueId, requirements});
    }
    return gate1;
};

const gate2RequestScope = (/** @type {{authorizingIssues: StagedIssue[], candidate: StagedCandidate, exception?: {confirmedAt: string, reason: string}, inventory: IssueInventory}} */ {authorizingIssues, candidate, exception, inventory}) => {
    const effort = authorizingIssues[0]?.effortNumber;
    if (!effort) return [];
    const effortIssues = inventory.byEffort.get(effort) ?? [];
    if (effortIssues.length === 0 || effortIssues.some(issue => !TERMINAL_ISSUE_STATUSES.has(issue.status))) {
        if (exception) throw new Error('Commit Audit gate2Exception is not applicable before the effort reaches Gate 2.');
        return [];
    }
    const documents = [...new Set(authorizingIssues.flatMap(issue => issueGoverningDocuments(issue.bytes, issue.filePath)))].sort(compareText);
    if (documents.length === 0 && !exception) throw new Error('Commit Audit Gate 2 without governing requirements requires gate2Exception.');
    if (documents.length > 0 && exception) throw new Error('Commit Audit gate2Exception conflicts with governing requirements.');
    const minimumSourceLines = documents.map(filePath => {
        const file = candidate.files.get(filePath);
        if (!file || !file.mode.startsWith('100')) throw new Error(`Commit Audit governing document is not a regular staged file: ${filePath}.`);
        const count = Math.max(1, Math.ceil(bodyLineNumbers(decodeCandidateText(candidateBytes(file, filePath), filePath)).size / 3));
        return {count, filePath};
    });
    return [{documents, effort, ...(exception ? {exception} : {}), minimumSourceLines}];
};

const assertCandidateEffortScope = (/** @type {{candidate: StagedCandidate, effort: string}} */ {candidate, effort}) => {
    for (const filePath of candidate.changedPaths) {
        const segments = filePath.split('/');
        if (segments[0] !== '.scratch' || segments.length < 3) continue;
        let changedEffort;
        try {
            changedEffort = parseEffortDirectoryName(segments[1]).number;
        } catch {
            continue;
        }
        if (changedEffort !== effort) {
            throw new Error(`Commit Audit staged candidate contains a changed path under another effort: ${filePath}.`);
        }
    }
};

const deriveRequest = (/** @type {{candidate: StagedCandidate, draftPath: string, input: ReturnType<typeof prepareInput>}} */ {candidate, draftPath, input}) => {
    assertCandidateEffortScope({candidate, effort: input.effort});
    const inventory = stagedIssueInventory(candidate);
    const authorizingIssues = input.authorizingIssueIds.map(issueId => {
        const issue = inventory.byId.get(issueId);
        if (!issue) throw new Error(`Commit Audit authorizing issue is not present in the staged candidate: ${issueId}.`);
        if (issue.effortNumber !== input.effort) throw new Error('Commit Audit authorizing issue effort binding is invalid.');
        return issue;
    });
    for (const issueId of inventory.terminalTransitions) {
        const issue = inventory.byId.get(issueId);
        if (issue && issue.effortNumber !== input.effort) throw new Error(`Commit Audit staged candidate has a terminal transition from another effort: ${issueId}.`);
    }
    const gate1 = gate1RequestScope({inventory, issueIds: new Set(input.authorizingIssueIds)});
    const gate2 = gate2RequestScope({authorizingIssues, candidate, exception: input.gate2Exception, inventory});
    return {
        authorizingIssueIds: input.authorizingIssueIds,
        draftPath,
        effort: input.effort,
        gate1,
        gate2,
    };
};

const managedRequestFile = (/** @type {string} */ path) => path === 'request.json'
    || path === 'review.jsonl'
    || path === 'reports'
    || path === 'spec-audit.json'
    || /^((?!00)\d{2})\.audit\.json$/.test(path);

/**
 * 从冻结 staged candidate 派生一个独立 Commit Audit Request.
 */
export const prepareCommitAudit = async (/** @type {{git?: Parameters<typeof readStagedCandidate>[0]['git'], inputPath: string, repositoryRoot: string, scopedFilesystemFactory?: {open: typeof createScopedFilesystem}}} */ {git, inputPath, repositoryRoot, scopedFilesystemFactory}) => {
    const handle = validateRequestHandle({fileName: 'input.json', path: inputPath, repositoryRoot});
    const filesystem = await openRequestFilesystem({directory: handle.directory, repositoryRoot, scopedFilesystemFactory});
    const listed = await filesystem.list({recursive: false});
    if (!validFilesystemResultForPath(listed, '.', ['entries'])
        || listed.status === 'succeeded' && !validListSuccess(listed, filesystem.root)) {
        throw new Error('Commit Audit Request directory inspection returned an invalid result.');
    }
    if (listed.status !== 'succeeded') throw new Error('Commit Audit Request directory could not be inspected.');
    const conflicts = listed.entries.filter(entry => managedRequestFile(entry.path));
    if (conflicts.length > 0) throw new Error(`Commit Audit Request contains a managed file conflict: ${conflicts[0].path}.`);
    const input = prepareInput(/** @type {AuditObject} */ (await readJsonObject({filesystem, label: 'Commit Audit input.json', path: 'input.json'})));
    const candidate = await readStagedCandidate({git: commitAuditGit(git, repositoryRoot)});
    const draftFileName = 'reports/review.jsonl';
    const draftPath = resolve(handle.directory, draftFileName);
    const request = deriveRequest({candidate, draftPath, input});
    const requestBytes = Buffer.from(json(request), 'utf8');
    const requestWrite = await filesystem.write({bytes: requestBytes, mode: 'create-atomic', path: 'request.json'});
    if (!validFilesystemResultForPath(requestWrite, 'request.json', ['path'])
        || requestWrite.status === 'succeeded' && requestWrite.path !== 'request.json') {
        const recovery = await filesystem.remove({path: 'request.json'});
        if (!validFilesystemResultForPath(recovery, 'request.json', ['path', 'removed'])
            || recovery.status !== 'succeeded'
            || recovery.path !== 'request.json'
            || typeof recovery.removed !== 'boolean') {
            throw new Error('Commit Audit request.json creation returned an invalid result, and request.json could not be restored.');
        }
        throw new Error('Commit Audit request.json creation returned an invalid result.');
    }
    if (requestWrite.status !== 'succeeded') throw new Error('Commit Audit request.json could not be created.');
    const draftWrite = await filesystem.write({bytes: Buffer.alloc(0), mode: 'create-atomic', path: draftFileName});
    const draftWriteValid = validFilesystemResultForPath(draftWrite, draftFileName, ['path'])
        && (draftWrite.status !== 'succeeded' || draftWrite.path === draftFileName);
    if (!draftWriteValid || draftWrite.status !== 'succeeded') {
        let draftRecoverySucceeded = true;
        if (!draftWriteValid) {
            const draftRecovery = await filesystem.remove({path: draftFileName});
            draftRecoverySucceeded = validFilesystemResultForPath(draftRecovery, draftFileName, ['path', 'removed'])
                && draftRecovery.status === 'succeeded'
                && draftRecovery.path === draftFileName
                && typeof draftRecovery.removed === 'boolean';
        }
        const recovery = await filesystem.remove({path: 'request.json'});
        const recoverySucceeded = validFilesystemResultForPath(recovery, 'request.json', ['path', 'removed'])
            && recovery.status === 'succeeded'
            && recovery.path === 'request.json'
            && recovery.removed === true;
        const directoryRecovery = await filesystem.remove({path: 'reports'});
        const directoryRecoverySucceeded = validFilesystemResultForPath(directoryRecovery, 'reports', ['path', 'removed'])
            && directoryRecovery.status === 'succeeded'
            && directoryRecovery.path === 'reports'
            && typeof directoryRecovery.removed === 'boolean';
        const failure = draftWriteValid
            ? 'Commit Audit review.jsonl could not be created.'
            : 'Commit Audit review.jsonl creation returned an invalid result.';
        if (!draftRecoverySucceeded) throw new Error(`${failure} Commit Audit review.jsonl could not be restored.`);
        if (!recoverySucceeded) throw new Error(`${failure} Commit Audit request.json could not be restored.`);
        if (!directoryRecoverySucceeded) throw new Error(`${failure} Commit Audit reports directory could not be restored.`);
        throw new Error(failure);
    }
    return {requestPath: resolve(handle.directory, 'request.json')};
};

const parseRequest = (/** @type {AuditObject} */ request, /** @type {{directory: string, repositoryRoot: string}} */ {directory, repositoryRoot}) => {
    assertExactKeys(request, ['authorizingIssueIds', 'draftPath', 'effort', 'gate1', 'gate2'], 'Commit Audit Request');
    const input = prepareInput({authorizingIssueIds: request.authorizingIssueIds});
    if (request.effort !== input.effort) throw new Error('Commit Audit Request effort does not match authorizingIssueIds.');
    if (typeof request.draftPath !== 'string' || !isAbsolute(request.draftPath)
        || !['reports/review.jsonl', 'review.jsonl'].some(path => resolve(request.draftPath ?? '') === resolve(directory, path))) {
        throw new Error('Commit Audit Request draftPath must bind reports/review.jsonl or the existing review.jsonl in the Request directory.');
    }
    validateRequestHandle({fileName: 'review.jsonl', path: request.draftPath, repositoryRoot});
    if (!Array.isArray(request.gate1) || !Array.isArray(request.gate2)) throw new Error('Commit Audit Request gate scopes must be arrays.');
    if (request.gate2.length > 1) throw new Error('Commit Audit Request can contain at most one Gate 2 scope.');
    let previousIssueId = '';
    for (const [index, scope] of request.gate1.entries()) {
        assertExactKeys(scope, ['issueId', 'requirements'], `Commit Audit Request gate1[${index}]`);
        const issueId = nonEmptyText(scope.issueId, `Commit Audit Request gate1[${index}].issueId`);
        if (parseIssueId(issueId).effortNumber !== input.effort) throw new Error(`Commit Audit Request gate1[${index}] has the wrong effort.`);
        if (previousIssueId && compareText(previousIssueId, issueId) >= 0) throw new Error('Commit Audit Request gate1 must be unique and sorted by issueId.');
        previousIssueId = issueId;
        if (!Array.isArray(scope.requirements) || scope.requirements.length === 0) throw new Error(`Commit Audit Request gate1[${index}].requirements must be non-empty.`);
        /** @type {Locator | undefined} */
        let previousSource;
        for (const [sourceIndex, value] of scope.requirements.entries()) {
            const source = locator(value, `Commit Audit Request gate1[${index}].requirements[${sourceIndex}]`, repositoryRoot);
            if (previousSource && (compareText(previousSource.filePath, source.filePath) > 0
                || previousSource.filePath === source.filePath && previousSource.line >= source.line)) {
                throw new Error(`Commit Audit Request gate1[${index}].requirements must be unique and sorted.`);
            }
            previousSource = source;
        }
    }
    for (const [index, scope] of request.gate2.entries()) {
        const hasException = Object.hasOwn(scope, 'exception');
        assertExactKeys(scope, hasException
            ? ['documents', 'effort', 'exception', 'minimumSourceLines']
            : ['documents', 'effort', 'minimumSourceLines'], `Commit Audit Request gate2[${index}]`);
        if (scope.effort !== input.effort) throw new Error(`Commit Audit Request gate2[${index}] has the wrong effort.`);
        if (!Array.isArray(scope.documents) || !Array.isArray(scope.minimumSourceLines)) throw new Error(`Commit Audit Request gate2[${index}] has malformed document scope.`);
        const documents = scope.documents.map((document, documentIndex) => gate2DocumentPath(document, `Commit Audit Request gate2[${index}].documents[${documentIndex}]`));
        if (documents.some((document, documentIndex) => documentIndex > 0 && compareText(documents[documentIndex - 1], document) >= 0)) {
            throw new Error(`Commit Audit Request gate2[${index}].documents must be unique and sorted.`);
        }
        if (scope.minimumSourceLines.length !== documents.length) throw new Error(`Commit Audit Request gate2[${index}] must bind every document minimum.`);
        for (const [minimumIndex, minimum] of scope.minimumSourceLines.entries()) {
            assertExactKeys(minimum, ['count', 'filePath'], `Commit Audit Request gate2[${index}].minimumSourceLines[${minimumIndex}]`);
            if (!Number.isSafeInteger(minimum.count) || minimum.count === undefined || minimum.count < 1 || minimum.filePath !== documents[minimumIndex]) {
                throw new Error(`Commit Audit Request gate2[${index}].minimumSourceLines[${minimumIndex}] is invalid.`);
            }
        }
        if (hasException) {
            canonicalGate2ExceptionInput(scope.exception);
            if (documents.length !== 0) throw new Error(`Commit Audit Request gate2[${index}] exception conflicts with documents.`);
        } else if (documents.length === 0) throw new Error(`Commit Audit Request gate2[${index}] without documents requires an exception.`);
    }
    return {input, request};
};

const reviewSyntax = (/** @type {{bytes: Buffer, capabilityScoring?: boolean, repositoryRoot: string}} */ {bytes, capabilityScoring = false, repositoryRoot}) => {
    let text;
    try {
        text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    } catch {
        return {diagnostics: [diagnostic('review-utf8-invalid', 'review.jsonl must be valid UTF-8.')], rows: []};
    }
    /** @type {Requirement[]} */
    const rows = [];
    const diagnostics = [];
    for (const [index, lineText] of text.split(/\r?\n/).entries()) {
        if (lineText.trim().length === 0) continue;
        const line = index + 1;
        let value;
        try {
            value = JSON.parse(lineText);
        } catch {
            diagnostics.push(diagnostic('review-json-invalid', 'Each nonblank review line must contain one JSON object.', {line}));
            continue;
        }
        try {
            if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Review line must be an object.');
            const keys = ['evidence', ...(value.result === 'satisfied' ? [] : ['finding']), 'requirement', 'result', 'source'];
            assertExactKeys(value, keys, `review.jsonl line ${line}`);
            if (!['satisfied', 'gap', 'uncertain'].includes(value.result)) throw new Error('result must be satisfied, gap, or uncertain.');
            const source = locator(value.source, `review.jsonl line ${line}.source`, repositoryRoot);
            const requirement = nonEmptyText(value.requirement, `review.jsonl line ${line}.requirement`);
            const normalizedEvidence = canonicalEvidence(value.evidence, `review.jsonl line ${line}.evidence`, repositoryRoot);
            if (normalizedEvidence.length === 0) throw new Error('evidence must be non-empty.');
            const finding = value.result === 'satisfied' ? undefined : nonEmptyText(value.finding, `review.jsonl line ${line}.finding`);
            rows.push({evidence: normalizedEvidence, ...(finding ? {finding} : {}), requirement, result: value.result, source});
        } catch (error) {
            diagnostics.push(diagnostic('review-row-invalid', error instanceof Error ? error.message : String(error), {line}));
            if (capabilityScoring && value !== null && typeof value === 'object' && !Array.isArray(value)
                && ['satisfied', 'gap', 'uncertain'].includes(value.result)
                && typeof value.requirement === 'string' && value.requirement.trim().length > 0) {
                try {
                    const source = locator(value.source, `review.jsonl line ${line}.source`, repositoryRoot);
                    if (value.result !== 'satisfied' && (typeof value.finding !== 'string' || value.finding.trim().length === 0)) continue;
                    rows.push({evidence: Array.isArray(value.evidence) ? value.evidence : [],
                        ...(typeof value.finding === 'string' ? {finding: value.finding} : {}),
                        requirement: value.requirement, result: value.result, source});
                } catch {
                    // An unlocatable source cannot be assigned to a requested requirement.
                }
            }
        }
    }
    return {diagnostics: stableDiagnostics(diagnostics), rows};
};

const coverageDiagnostics = (/** @type {{candidate: StagedCandidate, request: AuditObject, rows: Requirement[]}} */ {candidate, request, rows}) => {
    const diagnostics = [];
    const seen = new Map();
    for (const row of rows) {
        const key = requirementKey(row);
        const existing = seen.get(key);
        if (existing) diagnostics.push(diagnostic(
            jsonSemanticallyEqual(existing, row) ? 'requirement-duplicate' : 'requirement-conflicting',
            `source and requirement must have exactly one judgment: ${row.source.filePath}:${row.source.line}.`,
            {field: `${row.source.filePath}:${row.source.line}`},
        ));
        else seen.set(key, row);
    }
    const gate1Scopes = /** @type {AuditObject[]} */ (request.gate1 ?? []);
    const gate1Sources = new Set(gate1Scopes.flatMap(scope => (scope.requirements ?? []).map(source => locator(source, 'Request Gate 1 source'))).map(locatorKey));
    const gate2Scopes = /** @type {AuditObject[]} */ (request.gate2 ?? []);
    const gate2Documents = new Set(gate2Scopes.flatMap(scope => scope.documents ?? []));
    /** @type {Map<string, Set<number>>} */
    const gate2BodyLines = new Map();
    for (const document of gate2Documents) {
        const file = candidate.files.get(document);
        if (!file || !file.mode.startsWith('100')) continue;
        gate2BodyLines.set(document, bodyLineNumbers(decodeCandidateText(candidateBytes(file, document), document)));
    }
    for (const row of rows) {
        if (!gate1Sources.has(locatorKey(row.source)) && !gate2Documents.has(row.source.filePath)) {
            diagnostics.push(diagnostic('requirement-source-unexpected', `Review source is outside the Request scope: ${row.source.filePath}:${row.source.line}.`, {field: 'source'}));
        } else if (gate2Documents.has(row.source.filePath) && !gate2BodyLines.get(row.source.filePath)?.has(row.source.line)) {
            diagnostics.push(diagnostic(
                'requirement-source-invalid',
                `Gate 2 source line is not a governing document body line: ${row.source.filePath}:${row.source.line}.`,
                {field: `${row.source.filePath}:${String(row.source.line).padStart(10, '0')}`},
            ));
        }
    }
    for (const scope of gate1Scopes) {
        for (const sourceValue of scope.requirements ?? []) {
            const source = locator(sourceValue, 'Request Gate 1 source');
            if (!rows.some(row => locatorKey(row.source) === locatorKey(source))) diagnostics.push(diagnostic(
                'requirement-missing',
                `Review is missing a Gate 1 requirement judgment for ${source.filePath}:${source.line}.`,
                {field: `${source.filePath}:${String(source.line).padStart(10, '0')}`},
            ));
        }
    }
    for (const scope of gate2Scopes) {
        for (const minimum of /** @type {Array<{count: number, filePath: string}>} */ (scope.minimumSourceLines ?? [])) {
            const bodyLines = gate2BodyLines.get(minimum.filePath) ?? new Set();
            const count = new Set(rows
                .filter(row => row.source.filePath === minimum.filePath && bodyLines.has(row.source.line))
                .map(row => row.source.line)).size;
            if (count < minimum.count) diagnostics.push(diagnostic(
                'requirement-missing',
                `Gate 2 document has ${count} distinct reviewed source lines but requires at least ${minimum.count}: ${minimum.filePath}.`,
                {field: minimum.filePath},
            ));
        }
    }
    return stableDiagnostics(diagnostics);
};

const evidenceDiagnostics = (/** @type {{candidate: StagedCandidate, rows: Requirement[]}} */ {candidate, rows}) => {
    const diagnostics = [];
    for (const row of rows) {
        for (const item of row.evidence) {
            for (const evidenceLocator of evidenceLocators(item)) {
                let message;
                try {
                    message = verifyLocator({candidate, locator: evidenceLocator});
                } catch (error) {
                    message = error instanceof Error ? error.message : String(error);
                }
                if (message) diagnostics.push(diagnostic('evidence-locator-invalid', message, {field: `${row.source.filePath}:${row.source.line}`}));
            }
        }
    }
    return stableDiagnostics(diagnostics);
};

const outputRecords = (/** @type {{inventory: IssueInventory, preserveRequirementOrder?: boolean, request: AuditObject, rows: Requirement[]}} */ {inventory, preserveRequirementOrder = false, request, rows}) => {
    /** @type {AuditOutput[]} */
    const records = [];
    for (const scope of /** @type {AuditObject[]} */ (request.gate1 ?? [])) {
        const sources = new Set((scope.requirements ?? []).map(source => locatorKey(locator(source, 'Request Gate 1 source'))));
        const requirements = rows.filter(row => sources.has(locatorKey(row.source))).sort(preserveRequirementOrder ? () => 0 : compareRequirement);
        const issueId = nonEmptyText(scope.issueId, 'Request Gate 1 issueId');
        const issue = parseIssueId(issueId);
        const inventoryIssue = inventory.byId.get(issueId);
        if (!inventoryIssue) throw new Error(`Request Gate 1 issue is unavailable: ${issueId}.`);
        records.push({
            filePath: joinRelativePath('.scratch', inventoryIssue.effortDirectory, 'issues', `${issue.issueNumber}.audit.json`),
            record: {requirements, result: deriveResult(requirements)},
        });
    }
    for (const scope of /** @type {AuditObject[]} */ (request.gate2 ?? [])) {
        const documents = /** @type {string[]} */ (scope.documents ?? []);
        const requirements = rows.filter(row => documents.includes(row.source.filePath)).sort(preserveRequirementOrder ? () => 0 : compareRequirement);
        const effort = nonEmptyText(scope.effort, 'Request Gate 2 effort');
        const effortDirectory = inventory.effortDirectories.get(effort);
        if (!effortDirectory) throw new Error(`Request Gate 2 effort is unavailable: ${effort}.`);
        records.push({
            filePath: joinRelativePath('.scratch', effortDirectory, 'spec-audit.json'),
            record: scope.exception
                ? {documents: [], exception: scope.exception, requirements: [], result: 'not-applicable'}
                : {documents, requirements, result: deriveResult(requirements)},
        });
    }
    return records.sort((left, right) => compareText(left.filePath, right.filePath));
};

const filesystemDiagnostic = (/** @type {unknown} */ result, /** @type {string} */ target, /** @type {boolean} */ strictPath = true) => {
    if ((strictPath ? validFilesystemFailureForPath(result, target) : validTransactionFailure(result))) {
        const candidate = /** @type {{diagnostics: FilesystemDiagnostic[]}} */ (result);
        return candidate.diagnostics.map(item => diagnostic(item.code, item.message, {path: item.path ?? target}));
    }
    return [diagnostic('filesystem-adapter-invalid', 'Scoped filesystem returned an invalid operation result.', {path: target})];
};

const validFilesystemDiagnostic = (/** @type {unknown} */ value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const hasPath = Object.hasOwn(value, 'path');
    return exactKeys(value, ['code', ...(hasPath ? ['path'] : []), 'message'])
        && typeof /** @type {{code?: unknown}} */ (value).code === 'string'
        && /** @type {{code: string}} */ (value).code.length > 0
        && typeof /** @type {{message?: unknown}} */ (value).message === 'string'
        && /** @type {{message: string}} */ (value).message.length > 0
        && (!hasPath
            || typeof /** @type {{path?: unknown}} */ (value).path === 'string'
                && /** @type {{path: string}} */ (value).path.length > 0);
};

const validFilesystemFailure = (/** @type {unknown} */ result, /** @type {boolean} */ allowFailed = true) => {
    if (result === null || typeof result !== 'object' || Array.isArray(result)) return false;
    const candidate = /** @type {{diagnostics?: unknown, stage?: unknown, status?: unknown}} */ (result);
    if (!Array.isArray(candidate.diagnostics)
        || candidate.diagnostics.length === 0
        || candidate.diagnostics.some(item => !validFilesystemDiagnostic(item))) return false;
    if (candidate.status === 'blocked') return exactKeys(candidate, ['diagnostics', 'status']);
    return allowFailed
        && candidate.status === 'failed'
        && exactKeys(candidate, ['diagnostics', 'stage', 'status'])
        && typeof candidate.stage === 'string'
        && candidate.stage.length > 0;
};

const validFilesystemResult = (/** @type {unknown} */ result, /** @type {string[]} */ successFields, /** @type {boolean} */ allowFailed = true) => {
    if (result === null || typeof result !== 'object' || Array.isArray(result)) return false;
    const candidate = /** @type {{diagnostics?: unknown, status?: unknown}} */ (result);
    if (candidate.status !== 'succeeded') return validFilesystemFailure(candidate, allowFailed);
    return exactKeys(candidate, ['diagnostics', ...successFields, 'status'])
        && Array.isArray(candidate.diagnostics)
        && candidate.diagnostics.length === 0;
};

const validFilesystemFailureForPath = (/** @type {unknown} */ result, /** @type {string} */ path) => validFilesystemFailure(result)
    && /** @type {{diagnostics: FilesystemDiagnostic[]}} */ (result).diagnostics.every(item => item.path === undefined || item.path === path);

const validFilesystemResultForPath = (/** @type {unknown} */ result, /** @type {string} */ path, /** @type {string[]} */ successFields) => validFilesystemResult(result, successFields)
    && (/** @type {{status?: unknown}} */ (result).status === 'succeeded' || validFilesystemFailureForPath(result, path));

const validTransactionFailure = (/** @type {unknown} */ result) => result !== null
    && typeof result === 'object'
    && !Array.isArray(result)
    && ['blocked', 'failed'].includes(String(/** @type {{status?: unknown}} */ (result).status))
    && Array.isArray(/** @type {{diagnostics?: unknown}} */ (result).diagnostics)
    && /** @type {{diagnostics: unknown[]}} */ (result).diagnostics.length > 0
    && /** @type {{diagnostics: unknown[]}} */ (result).diagnostics.every(item => validFilesystemDiagnostic(item));

const validInspectSuccess = (/** @type {unknown} */ result, /** @type {string} */ path) => {
    if (!validFilesystemResult(result, ['entry'])
        || /** @type {{status?: unknown}} */ (result).status !== 'succeeded'
        || /** @type {{entry?: unknown}} */ (result).entry === null
        || typeof /** @type {{entry?: unknown}} */ (result).entry !== 'object') return false;
    const entry = /** @type {{entry: {kind?: unknown, path?: unknown, size?: unknown}}} */ (result).entry;
    const hasSize = Object.hasOwn(entry, 'size');
    return exactKeys(entry, ['kind', 'path', ...(hasSize ? ['size'] : [])])
        && ['directory', 'file', 'link', 'missing', 'other'].includes(String(entry.kind))
        && entry.path === path
        && (!hasSize || Number.isSafeInteger(entry.size) && /** @type {number} */ (entry.size) >= 0);
};

const validReadSuccess = (/** @type {unknown} */ result, /** @type {string} */ path) => validFilesystemResult(result, ['bytes', 'path'])
    && /** @type {{status?: unknown}} */ (result).status === 'succeeded'
    && Buffer.isBuffer(/** @type {{bytes?: unknown}} */ (result).bytes)
    && /** @type {{path?: unknown}} */ (result).path === path;

const validListSuccess = (/** @type {unknown} */ result, /** @type {string} */ scope) => {
    if (!validFilesystemResult(result, ['entries'])
        || !Array.isArray(/** @type {{entries?: unknown}} */ (result).entries)) return false;
    let previous = '';
    for (const entry of /** @type {{entries: unknown[]}} */ (result).entries) {
        if (entry === null
            || typeof entry !== 'object'
            || Array.isArray(entry)
            || !exactKeys(entry, ['kind', 'path'])
            || !['directory', 'file', 'link', 'other'].includes(String(/** @type {{kind?: unknown}} */ (entry).kind))) return false;
        const path = /** @type {{path?: unknown}} */ (entry).path;
        if (typeof path !== 'string'
            || path.length === 0
            || path === '.'
            || path === '..'
            || path.includes('/')
            || path.includes('\\')
            || path.includes('\0')
            || previous !== '' && compareText(previous, path) >= 0) return false;
        const resolved = resolveRelativePathWithinScope({path, scope});
        if (resolved.status !== 'succeeded' || resolved.relativePath.split(sep).join('/') !== path) return false;
        previous = path;
    }
    return true;
};

/** @returns {TransactionFilesystemResult} */
const operationResult = (/** @type {'inspect' | 'read' | 'remove' | 'write'} */ operation, /** @type {unknown} */ result, /** @type {string} */ path) => {
    const valid = operation === 'inspect'
        ? validFilesystemResultForPath(result, path, ['entry']) && (/** @type {{status?: unknown}} */ (result).status !== 'succeeded' || validInspectSuccess(result, path))
        : operation === 'read'
            ? validFilesystemResultForPath(result, path, ['bytes', 'path']) && (/** @type {{status?: unknown}} */ (result).status !== 'succeeded' || validReadSuccess(result, path))
            : operation === 'remove'
                ? validFilesystemResultForPath(result, path, ['path', 'removed']) && (/** @type {{status?: unknown}} */ (result).status !== 'succeeded'
                    || /** @type {{path?: unknown}} */ (result).path === path && typeof /** @type {{removed?: unknown}} */ (result).removed === 'boolean')
                : validFilesystemResultForPath(result, path, ['path']) && (/** @type {{status?: unknown}} */ (result).status !== 'succeeded'
                    || /** @type {{path?: unknown}} */ (result).path === path);
    return valid ? /** @type {TransactionFilesystemResult} */ (result) : {
        diagnostics: [{code: 'filesystem-adapter-invalid', message: 'Scoped filesystem returned an invalid operation result.', path}],
        stage: `adapter:${operation}`,
        status: /** @type {'failed'} */ ('failed'),
    };
};

const transactionFilesystem = (/** @type {Awaited<ReturnType<typeof openRequestFilesystem>>} */ filesystem) => ({
    async inspect(/** @type {{path: string}} */ input) {
        return operationResult('inspect', await filesystem.inspect(input), input.path);
    },
    async read(/** @type {{path: string}} */ input) {
        return operationResult('read', await filesystem.read(input), input.path);
    },
    async remove(/** @type {{path: string, recursive: boolean}} */ input) {
        return operationResult('remove', await filesystem.remove(input), input.path);
    },
    resolve(/** @type {{path: string}} */ input) {
        const result = filesystem.resolve(input);
        if (validFilesystemResult(result, ['absolutePath', 'relativePath'], false)
            && (result.status !== 'succeeded'
                || typeof result.absolutePath === 'string'
                    && typeof result.relativePath === 'string'
                    && result.relativePath === input.path
                    && resolve(result.absolutePath) === resolve(filesystem.root, input.path))) return result;
        return {
            diagnostics: [{code: 'filesystem-adapter-invalid', message: 'Scoped filesystem returned an invalid operation result.', path: input.path}],
            status: /** @type {'blocked'} */ ('blocked'),
        };
    },
    async write(/** @type {{bytes: Buffer, mode: 'create' | 'replace', path: string}} */ input) {
        return operationResult('write', await filesystem.write(input), input.path);
    },
});

const adapterViolation = (/** @type {unknown} */ result) => result !== null
    && typeof result === 'object'
    && !Array.isArray(result)
    && Array.isArray(/** @type {{diagnostics?: unknown}} */ (result).diagnostics)
    && /** @type {{diagnostics: Array<{code?: unknown}>}} */ (result).diagnostics.some(item => item?.code === 'filesystem-adapter-invalid');

const writeOutputTransaction = async (/** @type {{directory: string, filesystem: Awaited<ReturnType<typeof openRequestFilesystem>>, records: AuditOutput[], repositoryRoot: string}} */ {directory, filesystem, records, repositoryRoot}) => {
    const plans = [];
    const sourceNames = new Set();
    const targetNames = new Set();
    for (const record of records) {
        const sourceName = basename(record.filePath);
        if (sourceNames.has(sourceName) || targetNames.has(record.filePath)) {
            return failedGeneration('output-plan', 'generation-failed', [diagnostic('output-mapping-nonunique', 'Commit Audit output mappings must have unique source and target paths.', {path: record.filePath})]);
        }
        sourceNames.add(sourceName);
        targetNames.add(record.filePath);
        plans.push({bytes: Buffer.from(json(record.record), 'utf8'), sourceName, targetPath: record.filePath});
    }

    const operations = [];
    for (const plan of plans) {
        const sourceName = plan.sourceName;
        const inspected = await filesystem.inspect({path: sourceName, rejectHardLinks: true});
        if (!validFilesystemResultForPath(inspected, sourceName, ['entry']) || inspected.status === 'succeeded' && !validInspectSuccess(inspected, sourceName)) {
            return failedGeneration('output-plan', 'generation-failed', stableDiagnostics(filesystemDiagnostic(inspected, sourceName)));
        }
        if (inspected.status !== 'succeeded' || !['missing', 'file'].includes(inspected.entry.kind)) {
            return failedGeneration('output-plan', 'output-write-failed', stableDiagnostics(filesystemDiagnostic(inspected, sourceName)));
        }
        let before = null;
        if (inspected.entry.kind === 'file') {
            const read = await filesystem.read({path: sourceName, rejectHardLinks: true});
            if (!validFilesystemResultForPath(read, sourceName, ['bytes', 'path']) || read.status === 'succeeded' && !validReadSuccess(read, sourceName)) {
                return failedGeneration('output-plan', 'generation-failed', stableDiagnostics(filesystemDiagnostic(read, sourceName)));
            }
            if (read.status !== 'succeeded') {
                return failedGeneration('output-plan', 'output-write-failed', stableDiagnostics(filesystemDiagnostic(read, sourceName)));
            }
            before = Buffer.from(read.bytes);
        }
        operations.push(before === null
            ? {bytes: plan.bytes, expected: {kind: /** @type {'missing'} */ ('missing')}, kind: /** @type {'create'} */ ('create'), path: sourceName}
            : {bytes: plan.bytes, expected: {hash: sha256(before), kind: /** @type {'file'} */ ('file')}, kind: /** @type {'replace'} */ ('replace'), path: sourceName});
    }

    const transaction = createFileTransaction(transactionFilesystem(filesystem));
    const preflight = await transaction.preflight(operations);
    if (preflight.status !== 'succeeded') {
        return failedGeneration('output-plan', adapterViolation(preflight) ? 'generation-failed' : 'output-write-failed', stableDiagnostics(filesystemDiagnostic(preflight, 'output-plan', false)));
    }
    const applied = await transaction.apply(preflight.preparedTransaction);
    if (applied.status !== 'succeeded') {
        const recoveryFailures = applied.status === 'failed' && Array.isArray(applied.rollback)
            ? applied.rollback.filter(entry => entry.status !== 'restored')
            : [];
        const recoveryDiagnostics = recoveryFailures.map(entry => diagnostic(
            'output-recovery-failed',
            'Commit Audit output could not be restored after the transaction failed.',
            {path: entry.path},
        ));
        return failedGeneration(
            'output-plan',
            recoveryFailures.length > 0 || adapterViolation(applied) ? 'generation-failed' : 'output-write-failed',
            stableDiagnostics([...filesystemDiagnostic(applied, 'output-plan', false), ...recoveryDiagnostics]),
        );
    }
    const files = plans.map(plan => {
        const absolute = resolve(directory, plan.sourceName);
        const sourcePath = relative(repositoryRoot, absolute).split(sep).join('/');
        if (sourcePath === '..' || sourcePath.startsWith('../') || isAbsolute(sourcePath)) throw new Error('Commit Audit output source escapes the Repository.');
        return {sourcePath, targetPath: plan.targetPath};
    }).sort((left, right) => compareText(left.targetPath, right.targetPath));
    return {files};
};

/**
 * 验证并规范化一个绑定的 Commit Audit JSONL, 但不写正式输出.
 * 正式入口检查要求覆盖和证据位置; 能力评分入口保留单项错误和可评分内容.
 */
const validateCommitAuditReviewInternal = async (/** @type {{capabilityScoring?: boolean, git?: Parameters<typeof readStagedCandidate>[0]['git'], repositoryRoot: string, requestPath: string, reviewPath?: string, scopedFilesystemFactory?: {open: typeof createScopedFilesystem}}} */ {capabilityScoring = false, git, repositoryRoot, requestPath, reviewPath, scopedFilesystemFactory}) => {
    let handle;
    let filesystem;
    let parsedRequest;
    try {
        handle = validateRequestHandle({fileName: 'request.json', path: requestPath, repositoryRoot});
        filesystem = await openRequestFilesystem({directory: handle.directory, repositoryRoot, scopedFilesystemFactory});
        parsedRequest = parseRequest(/** @type {AuditObject} */ (await readJsonObject({filesystem, label: 'Commit Audit request.json', path: 'request.json'})), {directory: handle.directory, repositoryRoot});
    } catch (error) {
        return failedGeneration('request', 'request-invalid', [diagnostic('request-invalid', error instanceof Error ? error.message : String(error))]);
    }
    let reviewFilesystem = filesystem;
    let reviewFileName = relative(handle.directory, parsedRequest.request.draftPath ?? '').split(sep).join('/');
    if (reviewPath !== undefined) {
        try {
            const review = validateReviewPath({path: reviewPath, repositoryRoot});
            reviewFileName = review.fileName;
            if (resolve(review.directory) !== resolve(handle.directory)) {
                reviewFilesystem = await openRequestFilesystem({directory: review.directory, repositoryRoot, scopedFilesystemFactory});
            }
        } catch (error) {
            return failedGeneration('request', 'request-invalid', [diagnostic('review-path-invalid', error instanceof Error ? error.message : String(error))]);
        }
    }
    let candidate;
    try {
        candidate = await readStagedCandidate({git: commitAuditGit(git, repositoryRoot)});
        const gate2Scope = /** @type {AuditObject[]} */ (parsedRequest.request.gate2 ?? []);
        const input = {
            ...parsedRequest.input,
            gate2Exception: gate2Scope[0]?.exception ? canonicalGate2ExceptionInput(gate2Scope[0].exception) : undefined,
        };
        const expected = deriveRequest({candidate, draftPath: parsedRequest.request.draftPath ?? '', input});
        if (!jsonSemanticallyEqual(expected, parsedRequest.request)) throw new Error('Commit Audit Request does not match current candidate preconditions.');
    } catch (error) {
        return failedGeneration('candidate-preconditions', 'candidate-invalid', [diagnostic('candidate-invalid', error instanceof Error ? error.message : String(error))]);
    }
    let draft;
    try {
        draft = await reviewFilesystem.read({path: reviewFileName, rejectHardLinks: true});
        if (!validFilesystemResultForPath(draft, reviewFileName, ['bytes', 'path'])
            || draft.status === 'succeeded' && !validReadSuccess(draft, reviewFileName)) {
            throw new Error('Commit Audit review.jsonl read returned an invalid result.');
        }
        if (draft.status !== 'succeeded') throw new Error('Commit Audit review.jsonl must be an existing regular file.');
    } catch (error) {
        return failedGeneration('review-syntax', 'review-output-invalid', [diagnostic('review-read-failed', error instanceof Error ? error.message : String(error))]);
    }
    const syntax = reviewSyntax({bytes: draft.bytes, capabilityScoring, repositoryRoot});
    if (!capabilityScoring && syntax.diagnostics.length > 0) return failedGeneration('review-syntax', 'review-output-invalid', syntax.diagnostics);
    const coverage = coverageDiagnostics({candidate, request: parsedRequest.request, rows: syntax.rows});
    const evidenceProblems = evidenceDiagnostics({candidate, rows: syntax.rows.filter(row => {
        try { canonicalEvidence(row.evidence, 'Capability evidence', repositoryRoot); return true; } catch { return false; }
    })});
    if (!capabilityScoring) {
        if (coverage.length > 0) return failedGeneration('requirement-coverage', 'review-output-invalid', coverage);
        if (evidenceProblems.length > 0) return failedGeneration('evidence', 'review-output-invalid', evidenceProblems);
    }
    try {
        return {
            candidate,
            directory: handle.directory,
            filesystem,
            records: outputRecords({inventory: stagedIssueInventory(candidate), preserveRequirementOrder: capabilityScoring, request: parsedRequest.request, rows: syntax.rows}),
            rows: syntax.rows,
            reportDiagnostics: [...syntax.diagnostics, ...coverage, ...evidenceProblems],
            status: /** @type {'succeeded'} */ ('succeeded'),
        };
    } catch (error) {
        return failedGeneration('output-plan', 'generation-failed', [diagnostic('generation-failed', error instanceof Error ? error.message : String(error))]);
    }
};

export const validateCommitAuditReview = async (/** @type {{git?: Parameters<typeof readStagedCandidate>[0]['git'], repositoryRoot: string, requestPath: string, reviewPath?: string, scopedFilesystemFactory?: {open: typeof createScopedFilesystem}}} */ input) => {
    const result = await validateCommitAuditReviewInternal({...input, capabilityScoring: false});
    if (result.status === 'failed') return result;
    return {
        records: result.records.map(({filePath: targetPath, record}) => ({record, targetPath})),
        rows: result.rows,
        status: /** @type {'succeeded'} */ ('succeeded'),
    };
};

/** 能力评分保留单项要求和证据错误, 不产生正式 Commit Audit 文件. */
export const validateCommitAuditReviewForCapabilityScoring = async (/** @type {Parameters<typeof validateCommitAuditReview>[0]} */ input) => {
    const result = await validateCommitAuditReviewInternal({...input, capabilityScoring: true});
    if (result.status === 'failed') return result;
    return {
        records: result.records.map(({filePath: targetPath, record}) => ({record, targetPath})),
        rows: result.rows,
        reportDiagnostics: result.reportDiagnostics,
        status: /** @type {'succeeded'} */ ('succeeded'),
    };
};

/**
 * 验证 Request, 当前候选和完整 JSONL, 再确定性写入平铺的临时正式记录.
 */
export const generateCommitAudit = async (/** @type {{git?: Parameters<typeof readStagedCandidate>[0]['git'], repositoryRoot: string, requestPath: string, scopedFilesystemFactory?: {open: typeof createScopedFilesystem}}} */ {git, repositoryRoot, requestPath, scopedFilesystemFactory}) => {
    const validated = await validateCommitAuditReviewInternal({git, repositoryRoot, requestPath, scopedFilesystemFactory});
    if (validated.status === 'failed') return validated;
    try {
        return await writeOutputTransaction({
            directory: validated.directory,
            filesystem: validated.filesystem,
            records: validated.records,
            repositoryRoot,
        });
    } catch (error) {
        return failedGeneration('output-plan', 'generation-failed', [diagnostic('generation-failed', error instanceof Error ? error.message : String(error))]);
    }
};

const GATE1_PATH = /^\.scratch\/([^/]+)\/issues\/((?!00)\d{2})\.audit\.json$/;
const GATE2_PATH = /^\.scratch\/([^/]+)\/spec-audit\.json$/;
const TERMINAL_ISSUE_STATUSES = new Set(['completed', 'wontfix']);

const parseGate1Path = (/** @type {string} */ filePath) => {
    const match = GATE1_PATH.exec(filePath);
    if (!match) return null;
    try {
        const effort = parseEffortDirectoryName(match[1]);
        return {
            canonicalId: formatCanonicalArtifactId({
                effortNumber: effort.number,
                issueNumber: match[2],
                kind: 'issue',
                qualifier: null,
            }),
            effortDirectory: match[1],
            effortNumber: effort.number,
            issueNumber: match[2],
        };
    } catch {
        return null;
    }
};

const parseGate2Path = (/** @type {string} */ filePath) => {
    const match = GATE2_PATH.exec(filePath);
    if (!match) return null;
    try {
        const effort = parseEffortDirectoryName(match[1]);
        return {effortDirectory: match[1], effortNumber: effort.number};
    } catch {
        return null;
    }
};

const decodeCandidateText = (/** @type {Buffer} */ bytes, /** @type {string} */ filePath) => {
    try {
        return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    } catch {
        throw new Error(`Commit Audit staged file is not valid UTF-8: ${filePath}.`);
    }
};

const issueStatus = (/** @type {Buffer} */ bytes, /** @type {string} */ filePath) => {
    const text = decodeCandidateText(bytes, filePath);
    if (text.split(/\r?\n/).some(line => /^Type: /.test(line))) return null;
    const values = text.split(/\r?\n/)
        .flatMap(line => /^Status: ([a-z-]+)$/.exec(line)?.[1] ?? []);
    if (values.length !== 1) throw new Error(`Commit Audit issue has malformed Status: ${filePath}.`);
    return values[0];
};

const issueGoverningDocuments = (/** @type {Buffer} */ bytes, /** @type {string} */ filePath) => {
    const text = decodeCandidateText(bytes, filePath);
    const requirement = readIssueRequirement({issuePath: filePath, text});

    if (requirement.kind === 'exception') return [];

    const documents = new Set();
    for (const {filePath: document} of requirement.requirements) {
        if (isGate2DocumentPath(document)) documents.add(document);
    }
    return [...documents].sort(compareText);
};

const verifyLocator = (/** @type {{candidate: StagedCandidate, locator: Locator}} */ {candidate, locator}) => {
    const file = candidate.files.get(locator.filePath);
    if (!file) return `Repository locator does not exist in the staged candidate: ${locator.filePath}.`;
    if (!file.mode.startsWith('100')) return `Repository locator is not a regular staged file: ${locator.filePath}.`;
    const text = decodeCandidateText(candidateBytes(file, locator.filePath), locator.filePath);
    return locator.line <= text.split(/\r?\n/).length ? null : `Repository locator line does not exist: ${locator.filePath}:${locator.line}.`;
};

const evidenceLocators = (/** @type {Evidence} */ item) => {
    if (!('filePath' in item)) return [];
    return item.lines.flatMap(region => Array.isArray(region)
        ? [region[0], region[1]].map(line => ({filePath: item.filePath, line}))
        : [{filePath: item.filePath, line: region}]);
};

export const parseCommitAuditRecord = (/** @type {{bytes: Buffer, gate: number}} */ {bytes, gate}) => {
    if (!Buffer.isBuffer(bytes) || (gate !== 1 && gate !== 2)) {
        throw new TypeError('Commit Audit record parser requires bytes and Gate 1 or Gate 2.');
    }
    const parsed = parseJsonText(bytes);
    if (parsed.status !== 'succeeded') throw new Error('Commit Audit record must be a JSON object.');
    const input = parsed.value;
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Commit Audit record must be a JSON object.');
    return gate === 1 ? canonicalGate1(input) : canonicalGate2(input);
};

const verifyRecordLocators = (/** @type {{candidate: StagedCandidate, record: {requirements?: Requirement[]}}} */ {candidate, record}) => {
    /** @type {string[]} */
    const errors = [];
    const check = (/** @type {Locator} */ locator) => {
        const message = verifyLocator({candidate, locator});
        if (message !== null) errors.push(message);
    };
    if (record.requirements) {
        for (const requirement of record.requirements) {
            if (Object.hasOwn(requirement, 'source')) check(requirement.source);
            for (const item of requirement.evidence) {
                for (const evidenceLocator of evidenceLocators(item)) check(evidenceLocator);
            }
        }
    }
    return errors;
};

const verifyGate2SourcesInCandidate = (/** @type {{candidate: StagedCandidate, record: {documents?: string[], requirements?: Requirement[]}}} */ {candidate, record}) => {
    /** @type {Map<string, string>} */
    const textByPath = new Map();
    for (const document of record.documents ?? []) {
        const file = candidate.files.get(document);
        if (!file || !file.mode.startsWith('100')) continue;
        try {
            textByPath.set(document, decodeCandidateText(candidateBytes(file, document), document));
        } catch {
            // `verifyRecordLocators` 会报告该暂存文件的规范 UTF-8 locator 错误.
        }
    }
    return verifyGate2Sources({record, textByPath});
};

const auditError = (/** @type {Array<{filePath: string, message: string}>} */ errors, /** @type {string} */ filePath, /** @type {string} */ message) => errors.push({filePath, message});

/**
 * 只读取完整 staged candidate, 验证 Gate 1 和 Gate 2 记录的当前机械事实.
 * 它不修改 index, worktree, audit 文件或 issue, 且把可独立判断的错误一起返回.
 */
export const verifyCommitAudit = async (/** @type {{git?: Parameters<typeof readStagedCandidate>[0]['git'], repositoryRoot: string}} */ {git, repositoryRoot}) => {
    let candidate;
    try {
        candidate = await readStagedCandidate({git: commitAuditGit(git, repositoryRoot)});
    } catch (error) {
        return {errors: [{filePath: '.', message: error instanceof Error ? error.message : String(error)}]};
    }
    /** @type {Array<{filePath: string, message: string}>} */
    const errors = [];
    for (const diagnostic of compareCommittedArtifactIdentities({candidateFiles: candidate.files, committedFiles: candidate.headFiles})) {
        auditError(errors, diagnostic.path, diagnostic.message);
    }
    /** @type {Map<string, {requirements: Requirement[], result: string}>} */
    const gate1Records = new Map();
    /** @type {Map<string, {filePath: string, record: AuditObject}>} */
    const gate2Records = new Map();
    /** @type {Map<string, Array<{bytes: Buffer, filePath: string, status: string}>>} */
    const implementationStatusesByEffort = new Map();
    /** @type {Map<string, string>} */
    const effortDirectories = new Map();
    /** @type {Set<string>} */
    const terminalTransitions = new Set();
    /** @type {Map<string, {bytes: Buffer, effortDirectory: string, effortNumber: string, filePath: string, issueNumber: string}>} */
    const terminalIssueTransitions = new Map();

    for (const [filePath, file] of [...candidate.files.entries()].sort(([left], [right]) => compareText(left, right))) {
        let issue;
        try {
            issue = parseRegisteredArtifactPath(filePath);
        } catch {
            continue;
        }
        if (issue.kind !== 'issue' || issue.issueNumber === null || !file.mode.startsWith('100')) continue;
        try {
            const bytes = candidateBytes(file, filePath);
            const current = issueStatus(bytes, filePath);
            const previousFile = previousIssueFile(candidate, issue, filePath);
            const previous = previousFile ? issueStatus(candidateBytes(previousFile, filePath), filePath) : null;
            if (current === null) continue;
            const existingDirectory = effortDirectories.get(issue.effortNumber);
            if (existingDirectory !== undefined && existingDirectory !== issue.effortDirectory) {
                throw new Error(`Commit Audit staged candidate contains duplicate effort number: ${issue.effortNumber}.`);
            }
            effortDirectories.set(issue.effortNumber, issue.effortDirectory);
            const statuses = implementationStatusesByEffort.get(issue.effortNumber) ?? [];
            statuses.push({bytes, filePath, status: current});
            implementationStatusesByEffort.set(issue.effortNumber, statuses);
            if (TERMINAL_ISSUE_STATUSES.has(current) && (previous === null || !TERMINAL_ISSUE_STATUSES.has(previous))) {
                terminalIssueTransitions.set(issue.canonicalId, {
                    bytes,
                    effortDirectory: issue.effortDirectory,
                    effortNumber: issue.effortNumber,
                    filePath,
                    issueNumber: issue.issueNumber,
                });
                terminalTransitions.add(issue.effortNumber);
            }
        } catch (error) {
            auditError(errors, filePath, error instanceof Error ? error.message : String(error));
        }
    }

    const applicableGate2Efforts = new Set([...terminalTransitions].filter(effort => {
        const statuses = implementationStatusesByEffort.get(effort) ?? [];
        return statuses.every(({status}) => TERMINAL_ISSUE_STATUSES.has(status));
    }));

    for (const [filePath, file] of [...candidate.files.entries()].sort(([left], [right]) => compareText(left, right))) {
        const gate1 = parseGate1Path(filePath);
        const gate2 = parseGate2Path(filePath);
        if (!gate1 && !gate2) continue;
        const terminalIssue = gate1 ? terminalIssueTransitions.get(gate1.canonicalId) : undefined;
        if (gate1 && (!terminalIssue || terminalIssue.effortDirectory !== gate1.effortDirectory)) continue;
        if (gate2 && (!applicableGate2Efforts.has(gate2.effortNumber) || effortDirectories.get(gate2.effortNumber) !== gate2.effortDirectory)) continue;
        if (!file.mode.startsWith('100')) {
            auditError(errors, filePath, 'Commit Audit record is not a regular staged file.');
            continue;
        }
        try {
            const record = parseCommitAuditRecord({bytes: candidateBytes(file, filePath), gate: gate1 ? 1 : 2});
            for (const message of verifyRecordLocators({candidate, record})) auditError(errors, filePath, message);
            if (gate2) for (const message of verifyGate2SourcesInCandidate({candidate, record})) auditError(errors, filePath, message);
            if (gate1) gate1Records.set(gate1.canonicalId, record);
            else if (gate2) gate2Records.set(gate2.effortNumber, {filePath, record});
        } catch (error) {
            auditError(errors, filePath, error instanceof Error ? error.message : String(error));
        }
    }

    for (const [id, {bytes, effortDirectory, filePath, issueNumber}] of [...terminalIssueTransitions.entries()].sort(([left], [right]) => compareText(left, right))) {
        const record = gate1Records.get(id);
        if (!record) auditError(errors, filePath, `Gate 1 record is required for terminal issue transition: .scratch/${effortDirectory}/issues/${issueNumber}.audit.json.`);
        else if (record.result !== 'satisfied') auditError(errors, filePath, `Gate 1 record must be satisfied for terminal issue transition: .scratch/${effortDirectory}/issues/${issueNumber}.audit.json.`);
        else for (const message of verifyGate1Sources({filePath, record, text: decodeCandidateText(bytes, filePath)})) auditError(errors, filePath, message);
    }

    for (const effort of [...applicableGate2Efforts].sort(compareText)) {
        const filePath = joinRelativePath('.scratch', effortDirectories.get(effort) ?? effort, 'spec-audit.json');
        const record = gate2Records.get(effort)?.record;
        if (!record || !['satisfied', 'not-applicable'].includes(record.result ?? '')) auditError(errors, filePath, 'Gate 2 record must contain a complete satisfied or confirmed not-applicable result for the terminal effort.');
    }

    errors.sort((left, right) => compareText(left.filePath, right.filePath) || compareText(left.message, right.message));
    return {errors};
};
