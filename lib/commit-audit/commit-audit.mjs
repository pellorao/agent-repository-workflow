import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {basename, dirname, join, relative, sep} from 'node:path';

import {parseCanonicalArtifactId, parseEffortDirectoryName, parseRegisteredArtifactPath} from '../arw-common/artifact-identity.mjs';
import {compareCommittedArtifactIdentities} from '../arw-common/artifacts.mjs';
import {readIssueRequirement} from '../arw-common/issue-documents.mjs';
import {readStagedCandidate} from '../arw-common/repository-state-inspector.mjs';
import {createNodeGitRunner} from '../common/git-process.mjs';
import {compareText, exactKeys} from '../common/json.mjs';

/** @typedef {Awaited<ReturnType<typeof readStagedCandidate>>} StagedCandidate */
/** @typedef {{effortDirectory: string, effortNumber: string, filePath: string, issueId: string, issueNumber: string, status: string, text: string}} StagedIssue */
/** @typedef {{confirmedAt: string, reason: string}} Gate2Exception */
/** @typedef {{authorizingIssueIds: string[], effort: string, gate1: string[], gate2: {documents: string[], exception?: Gate2Exception} | null, reviewPath: string}} AuditRequest */

const TERMINAL_ISSUE_STATUSES = new Set(['completed', 'wontfix']);
const decodeText = (/** @type {Buffer} */ bytes, /** @type {string} */ filePath) => {
    try {
        return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    } catch {
        throw new Error(`Commit Audit staged file is not valid UTF-8: ${filePath}.`);
    }
};

const stagedText = (/** @type {StagedCandidate} */ candidate, /** @type {string} */ filePath) => {
    const file = candidate.files.get(filePath);
    if (!file || !file.mode.startsWith('100') || file.bytes === null) return null;
    return decodeText(file.bytes, filePath);
};

const isGate2DocumentPath = (/** @type {string} */ filePath) => /^docs\/adr\/[^/]+\.md$/.test(filePath)
    || /^docs\/specs\/(?:[^/]+\/)*[^/]+\.md$/.test(filePath)
    || /^\.scratch\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:spec|PRD)\.md$/.test(filePath);

/** Gate 2 documents: the union of the issues' governing spec, PRD and ADR references. */
const governingDocuments = (/** @type {StagedIssue[]} */ issues) => [...new Set(issues.flatMap(issue => readIssueRequirement({issuePath: issue.filePath, text: issue.text})
    .requirements.map(item => item.filePath).filter(isGate2DocumentPath)))].sort(compareText);

const issueStatus = (/** @type {string} */ text, /** @type {string} */ filePath) => {
    if (text.split(/\r?\n/).some(line => /^Type: /.test(line))) return null;
    const values = text.split(/\r?\n/).flatMap(line => /^Status: ([a-z-]+)$/.exec(line)?.[1] ?? []);
    if (values.length !== 1) throw new Error(`Commit Audit issue has malformed Status: ${filePath}.`);
    return values[0];
};

const previousIssueText = (/** @type {StagedCandidate} */ candidate, /** @type {{canonicalId: string}} */ path, /** @type {string} */ filePath) => {
    const exact = candidate.headFiles.get(filePath);
    if (exact?.bytes) return decodeText(exact.bytes, filePath);
    for (const [headPath, file] of candidate.headFiles) {
        try {
            const identity = parseRegisteredArtifactPath(headPath);
            if (identity.kind === 'issue' && identity.canonicalId === path.canonicalId && file.bytes) return decodeText(file.bytes, headPath);
        } catch {
            // Paths that are not registered Artifacts cannot be an earlier version of this issue.
        }
    }
    return null;
};

/** Implementation issues in the staged candidate, grouped by effort, with their new terminal transitions. */
const stagedIssueInventory = (/** @type {StagedCandidate} */ candidate) => {
    /** @type {Map<string, StagedIssue>} */
    const byId = new Map();
    /** @type {Map<string, StagedIssue[]>} */
    const byEffort = new Map();
    /** @type {Set<string>} */
    const terminalTransitions = new Set();
    for (const filePath of [...candidate.files.keys()].sort(compareText)) {
        let path;
        try {
            path = parseRegisteredArtifactPath(filePath);
        } catch {
            continue;
        }
        if (path.kind !== 'issue' || path.issueNumber === null) continue;
        const text = stagedText(candidate, filePath);
        if (text === null) continue;
        const status = issueStatus(text, filePath);
        if (status === null) continue;
        const issue = {effortDirectory: path.effortDirectory, effortNumber: path.effortNumber, filePath, issueId: path.canonicalId, issueNumber: path.issueNumber, status, text};
        if (byId.has(issue.issueId)) throw new Error(`Commit Audit staged candidate contains duplicate canonical issue ID: ${issue.issueId}.`);
        if (byEffort.get(path.effortNumber)?.some(other => other.effortDirectory !== path.effortDirectory)) {
            throw new Error(`Commit Audit staged candidate contains duplicate effort number: ${path.effortNumber}.`);
        }
        byId.set(issue.issueId, issue);
        byEffort.set(path.effortNumber, [...(byEffort.get(path.effortNumber) ?? []), issue]);
        const previousText = previousIssueText(candidate, path, filePath);
        const previous = previousText === null ? null : issueStatus(previousText, filePath);
        if (TERMINAL_ISSUE_STATUSES.has(status) && (previous === null || !TERMINAL_ISSUE_STATUSES.has(previous))) terminalTransitions.add(issue.issueId);
    }
    return {byEffort, byId, terminalTransitions};
};

const isUtcSecond = (/** @type {unknown} */ value) => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === `${value.slice(0, -1)}.000Z`;

const gate2Exception = (/** @type {unknown} */ value) => {
    const exception = /** @type {{confirmedAt?: unknown, reason?: unknown}} */ (value);
    if (!exactKeys(value, ['confirmedAt', 'reason']) || typeof exception.reason !== 'string' || exception.reason.trim().length === 0 || !isUtcSecond(exception.confirmedAt)) {
        throw new Error('Commit Audit gate2Exception must contain a non-empty reason and a UTC second-precision confirmedAt.');
    }
    return {confirmedAt: /** @type {string} */ (exception.confirmedAt), reason: exception.reason};
};

/** input.json is written by the Main Agent, so its shape is checked. */
const parseInput = (/** @type {unknown} */ value) => {
    const input = /** @type {{authorizingIssueIds?: unknown, gate2Exception?: unknown}} */ (value);
    if (!exactKeys(value, Object.hasOwn(Object(value), 'gate2Exception') ? ['authorizingIssueIds', 'gate2Exception'] : ['authorizingIssueIds'])) {
        throw new Error('Commit Audit input must contain authorizingIssueIds and an optional gate2Exception.');
    }
    const ids = input.authorizingIssueIds;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id, index) => typeof id !== 'string' || (index > 0 && compareText(ids[index - 1], id) >= 0))) {
        throw new Error('Commit Audit authorizingIssueIds must be a non-empty, unique and sorted array.');
    }
    const efforts = new Set(ids.map(id => {
        const parsed = parseCanonicalArtifactId(id);
        if (parsed.kind !== 'issue' || parsed.qualifier !== null || parsed.issueNumber === null) throw new Error(`Invalid implementation issue ID: ${id}.`);
        return parsed.effortNumber;
    }));
    if (efforts.size !== 1) throw new Error('Commit Audit authorizingIssueIds must all belong to one effort.');
    return {
        authorizingIssueIds: /** @type {string[]} */ (ids),
        effort: [...efforts][0],
        ...(input.gate2Exception === undefined ? {} : {gate2Exception: gate2Exception(input.gate2Exception)}),
    };
};

/** @returns {AuditRequest} */
const deriveRequest = (/** @type {{candidate: StagedCandidate, input: ReturnType<typeof parseInput>, reviewPath: string}} */ {candidate, input, reviewPath}) => {
    for (const filePath of candidate.changedPaths) {
        const segments = filePath.split('/');
        if (segments[0] !== '.scratch' || segments.length < 3) continue;
        let effort;
        try {
            effort = parseEffortDirectoryName(segments[1]).number;
        } catch {
            continue;
        }
        if (effort !== input.effort) throw new Error(`Commit Audit staged candidate contains a changed path under another effort: ${filePath}.`);
    }
    const inventory = stagedIssueInventory(candidate);
    const authorizing = input.authorizingIssueIds.map(issueId => {
        const issue = inventory.byId.get(issueId);
        if (!issue) throw new Error(`Commit Audit authorizing issue is not present in the staged candidate: ${issueId}.`);
        return issue;
    });
    const gate1 = [...inventory.terminalTransitions].sort(compareText);
    for (const issueId of gate1) {
        if (!input.authorizingIssueIds.includes(issueId)) throw new Error(`Commit Audit terminal issue transition is not authorized: ${issueId}.`);
    }
    const effortIssues = inventory.byEffort.get(input.effort) ?? [];
    const gate2Applies = effortIssues.every(issue => TERMINAL_ISSUE_STATUSES.has(issue.status));
    let gate2 = null;
    if (!gate2Applies && input.gate2Exception) throw new Error('Commit Audit gate2Exception is not applicable before the effort reaches Gate 2.');
    if (gate2Applies) {
        const documents = governingDocuments(authorizing);
        if (documents.length === 0 && !input.gate2Exception) throw new Error('Commit Audit Gate 2 without governing requirements requires gate2Exception.');
        if (documents.length > 0 && input.gate2Exception) throw new Error('Commit Audit gate2Exception conflicts with governing requirements.');
        for (const document of documents) {
            if (stagedText(candidate, document) === null) throw new Error(`Commit Audit governing document is not a regular staged file: ${document}.`);
        }
        gate2 = {documents, ...(input.gate2Exception ? {exception: input.gate2Exception} : {})};
    }
    return {authorizingIssueIds: input.authorizingIssueIds, effort: input.effort, gate1, gate2, reviewPath};
};

/**
 * 从冻结的已暂存候选派生 Request, 并创建 Reviewer 写入问题的空报告.
 */
export const prepareCommitAudit = async (/** @type {{inputPath: string, repositoryRoot: string}} */ {inputPath, repositoryRoot}) => {
    if (basename(inputPath) !== 'input.json' || !relative(repositoryRoot, inputPath).split(sep).join('/').startsWith('.tmp/')) {
        throw new Error('Commit Audit path must be an absolute input.json path inside the Repository .tmp directory.');
    }
    const directory = dirname(inputPath);
    const input = parseInput(JSON.parse(await readFile(inputPath, 'utf8')));
    const candidate = await readStagedCandidate({git: createNodeGitRunner(repositoryRoot)});
    const request = deriveRequest({candidate, input, reviewPath: join(directory, 'reports/review.txt')});
    await mkdir(join(directory, 'reports'), {recursive: true});
    // `wx` keeps an earlier round's Request and report from being overwritten.
    await writeFile(join(directory, 'request.json'), `${JSON.stringify(request, null, 2)}\n`, {flag: 'wx'});
    await writeFile(request.reviewPath, '', {flag: 'wx'});
    return {requestPath: join(directory, 'request.json')};
};

/**
 * 只读取完整已暂存候选, 确认它保留每个已提交的 ARW Artifact 身份.
 */
export const verifyCommitAudit = async (/** @type {{repositoryRoot: string}} */ {repositoryRoot}) => {
    /** @type {Array<{filePath: string, message: string}>} */
    const errors = [];
    try {
        const candidate = await readStagedCandidate({git: createNodeGitRunner(repositoryRoot)});
        for (const diagnostic of compareCommittedArtifactIdentities({candidateFiles: candidate.files, committedFiles: candidate.headFiles})) {
            errors.push({filePath: diagnostic.path, message: diagnostic.message});
        }
    } catch (error) {
        errors.push({filePath: '.', message: error instanceof Error ? error.message : String(error)});
    }
    errors.sort((left, right) => compareText(left.filePath, right.filePath) || compareText(left.message, right.message));
    return {errors};
};
