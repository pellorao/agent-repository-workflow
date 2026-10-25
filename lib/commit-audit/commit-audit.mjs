import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {basename, dirname, isAbsolute, join, relative, sep} from 'node:path';

import {parseCanonicalArtifactId, parseEffortDirectoryName, parseRegisteredArtifactPath} from '../arw-common/artifact-identity.mjs';
import {compareCommittedArtifactIdentities} from '../arw-common/artifacts.mjs';
import {readIssueRequirement} from '../arw-common/issue-documents.mjs';
import {readStagedCandidate} from '../arw-common/repository-state-inspector.mjs';
import {joinRelativePath} from '../common/filesystem.mjs';
import {createNodeGitRunner} from '../common/git-process.mjs';
import {compareText, exactKeys, jsonSemanticallyEqual} from '../common/json.mjs';

/** @typedef {Awaited<ReturnType<typeof readStagedCandidate>>} StagedCandidate */
/** @typedef {{effortDirectory: string, effortNumber: string, filePath: string, issueId: string, issueNumber: string, status: string, text: string}} StagedIssue */
/** @typedef {{filePath: string, line: number}} Source */
/** @typedef {{confirmedAt: string, reason: string}} Gate2Exception */
/** @typedef {{authorizingIssueIds: string[], effort: string, gate1: string[], gate2: {documents: string[], exception?: Gate2Exception} | null, items: Source[], reviewPath: string}} AuditRequest */
/** @typedef {{evidence?: string, note?: string, result: string, source: string}} ItemResult */

const TERMINAL_ISSUE_STATUSES = new Set(['completed', 'wontfix']);
const VERDICTS = new Set(['satisfied', 'gap', 'uncertain', 'n/a']);
const REVIEW_FILE = 'reports/review.md';

const json = (/** @type {unknown} */ value) => `${JSON.stringify(value, null, 2)}\n`;

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

const formatSource = (/** @type {Source} */ source) => `${source.filePath}:${source.line}`;

/** Parse `path:line` or `path:start-end`, the only locator form Reviewers and records use. */
const parseLocator = (/** @type {string} */ value) => {
    const match = /^`?([^`\s:][^`:]*):(\d+)(?:-(\d+))?`?$/.exec(value.trim());
    if (!match) return null;
    const start = Number(match[2]);
    const end = match[3] === undefined ? start : Number(match[3]);
    return start >= 1 && end >= start ? {end, filePath: match[1], start} : null;
};

/** Returns a diagnostic when the locator does not name existing lines of a regular staged file. */
const locatorProblem = (/** @type {StagedCandidate} */ candidate, /** @type {string} */ value) => {
    const locator = parseLocator(value);
    if (!locator) return `locator must be path:line or path:start-end: ${value}`;
    const text = stagedText(candidate, locator.filePath);
    if (text === null) return `locator file is not a regular file in the reviewed version: ${locator.filePath}`;
    const lineCount = text.split(/\r?\n/).length - (/\r?\n$/.test(text) ? 1 : 0);
    return locator.end <= lineCount ? null : `locator line does not exist: ${value}`;
};

const parseIssueId = (/** @type {string} */ issueId) => {
    const parsed = parseCanonicalArtifactId(issueId);
    if (parsed.kind !== 'issue' || parsed.qualifier !== null || parsed.issueNumber === null) throw new Error(`Invalid implementation issue ID: ${issueId}.`);
    return parsed;
};

const isGate2DocumentPath = (/** @type {string} */ filePath) => /^docs\/adr\/[^/]+\.md$/.test(filePath)
    || /^docs\/specs\/(?:[^/]+\/)*[^/]+\.md$/.test(filePath)
    || /^\.scratch\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:spec|PRD)\.md$/.test(filePath);

/** Non-empty, non-heading lines outside fenced code blocks, as 1-based line numbers. */
const bodyLineNumbers = (/** @type {string[]} */ lines, /** @type {number} */ offset = 0) => {
    const body = [];
    let fence;
    for (const [index, line] of lines.entries()) {
        const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
        if (marker) {
            if (fence === undefined) fence = marker;
            else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
            continue;
        }
        if (fence === undefined && line.trim().length > 0 && !/^#{1,6} /.test(line)) body.push(index + 1 + offset);
    }
    return body;
};

/** Requirement lines of an issue: `## What to build` body lines and every acceptance criterion. */
const issueRequirementLines = (/** @type {string} */ text, /** @type {string} */ filePath) => {
    const lines = text.split(/\r?\n/);
    const [whatToBuild, specRequirement, acceptance, blockedBy] = ['## What to build', '## Spec Requirement', '## Acceptance criteria', '## Blocked by'].map(heading => lines.indexOf(heading));
    if (!(whatToBuild >= 0 && whatToBuild < specRequirement && specRequirement < acceptance && acceptance < blockedBy)) {
        throw new Error(`Commit Audit issue has malformed requirement sections: ${filePath}.`);
    }
    const criteria = lines.slice(acceptance + 1, blockedBy).flatMap((line, index) => /^- \[[ xX]\] /.test(line) ? [acceptance + index + 2] : []);
    return [...bodyLineNumbers(lines.slice(whatToBuild + 1, specRequirement), whatToBuild + 1), ...criteria];
};

/** Acceptance criteria always need a judgment, so `n/a` is reserved for other lines. */
const isAcceptanceCriterion = (/** @type {StagedCandidate} */ candidate, /** @type {Source} */ source) => /\/issues\/[^/]+\.md$/.test(source.filePath)
    && /^- \[[ xX]\] /.test(stagedText(candidate, source.filePath)?.split(/\r?\n/)[source.line - 1] ?? '');

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
    const efforts = new Set(ids.map(id => parseIssueId(id).effortNumber));
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
        gate2 = {documents, ...(input.gate2Exception ? {exception: input.gate2Exception} : {})};
    }
    const items = authorizing.flatMap(issue => issueRequirementLines(issue.text, issue.filePath).map(line => ({filePath: issue.filePath, line})));
    for (const document of gate2?.documents ?? []) {
        const text = stagedText(candidate, document);
        if (text === null) throw new Error(`Commit Audit governing document is not a regular staged file: ${document}.`);
        items.push(...bodyLineNumbers(text.split(/\r?\n/)).map(line => ({filePath: document, line})));
    }
    return {authorizingIssueIds: input.authorizingIssueIds, effort: input.effort, gate1, gate2, items, reviewPath};
};

const renderChecklist = (/** @type {{candidate: StagedCandidate, request: AuditRequest}} */ {candidate, request}) => {
    const sections = request.items.map((source, index) => {
        const text = /** @type {string} */ (stagedText(candidate, source.filePath)).split(/\r?\n/)[source.line - 1];
        return `## R${index + 1} \`${formatSource(source)}\`\n\n> ${text}\n\nverdict:\nevidence:\nnote:\n`;
    });
    return [
        '# Requirement checklist',
        '',
        'For every item fill `verdict` (satisfied, gap, uncertain or n/a) and one `evidence` locator (`path:line` or `path:start-end` in the reviewed version; not needed for n/a). Write `note` only for gap, uncertain and n/a.',
        '',
        ...sections,
    ].join('\n');
};

const requestDirectory = (/** @type {{fileName: string, path: string, repositoryRoot: string}} */ {fileName, path, repositoryRoot}) => {
    const relativePath = isAbsolute(path) ? relative(repositoryRoot, path).split(sep).join('/') : '';
    if (basename(path) !== fileName || !relativePath.startsWith('.tmp/')) {
        throw new Error(`Commit Audit path must be an absolute ${fileName} path inside the Repository .tmp directory.`);
    }
    return dirname(path);
};

/**
 * 从冻结的已暂存候选派生 Request, 并生成待 Reviewer 填写的要求清单.
 */
export const prepareCommitAudit = async (/** @type {{inputPath: string, repositoryRoot: string}} */ {inputPath, repositoryRoot}) => {
    const directory = requestDirectory({fileName: 'input.json', path: inputPath, repositoryRoot});
    const input = parseInput(JSON.parse(await readFile(inputPath, 'utf8')));
    const candidate = await readStagedCandidate({git: createNodeGitRunner(repositoryRoot)});
    const request = deriveRequest({candidate, input, reviewPath: join(directory, REVIEW_FILE)});
    await mkdir(join(directory, 'reports'), {recursive: true});
    // `wx` keeps an earlier round's Request and filled checklist from being overwritten.
    await writeFile(join(directory, 'request.json'), json(request), {flag: 'wx'});
    await writeFile(request.reviewPath, renderChecklist({candidate, request}), {flag: 'wx'});
    return {requestPath: join(directory, 'request.json')};
};

/** Read each `## R<n>` block's verdict, evidence and note; the note may continue on later lines. */
const parseChecklist = (/** @type {string} */ text) => {
    /** @type {Map<string, {evidence: string, note: string, verdict: string}>} */
    const entries = new Map();
    /** @type {string[]} */
    const duplicates = [];
    let current;
    let inNote = false;
    for (const line of text.split(/\r?\n/)) {
        const header = /^## (R\d+)\b/.exec(line);
        if (header) {
            if (entries.has(header[1])) duplicates.push(header[1]);
            current = {evidence: '', note: '', verdict: ''};
            entries.set(header[1], current);
            inNote = false;
            continue;
        }
        if (!current) continue;
        const field = /^(verdict|evidence|note):\s*(.*)$/.exec(line);
        if (field) {
            current[/** @type {'evidence' | 'note' | 'verdict'} */ (field[1])] = field[2].trim();
            inNote = field[1] === 'note';
        } else if (inNote) current.note = `${current.note}\n${line}`.trim();
    }
    return {duplicates, entries};
};

/** Every checklist item needs a known verdict, a locator that exists in the reviewed version and a note when it is not satisfied. */
const checkChecklist = (/** @type {{candidate: StagedCandidate, request: AuditRequest, text: string}} */ {candidate, request, text}) => {
    const {duplicates, entries} = parseChecklist(text);
    const diagnostics = duplicates.map(id => `${id}: item appears more than once.`);
    /** @type {ItemResult[]} */
    const results = [];
    for (const [index, source] of request.items.entries()) {
        const id = `R${index + 1}`;
        const entry = entries.get(id);
        entries.delete(id);
        if (!entry) {
            diagnostics.push(`${id}: item is missing.`);
            continue;
        }
        const verdict = entry.verdict.toLowerCase();
        if (!VERDICTS.has(verdict)) {
            diagnostics.push(`${id}: verdict must be satisfied, gap, uncertain or n/a.`);
            continue;
        }
        if (verdict !== 'n/a') {
            const problem = locatorProblem(candidate, entry.evidence);
            if (problem) diagnostics.push(`${id}: ${problem}.`);
        }
        if (verdict !== 'satisfied' && entry.note.length === 0) diagnostics.push(`${id}: ${verdict} requires a note.`);
        if (verdict === 'n/a' && isAcceptanceCriterion(candidate, source)) diagnostics.push(`${id}: an acceptance criterion cannot be n/a.`);
        results.push({
            ...(verdict === 'n/a' ? {} : {evidence: entry.evidence}),
            ...(verdict === 'satisfied' ? {} : {note: entry.note}),
            result: verdict,
            source: formatSource(source),
        });
    }
    for (const id of entries.keys()) diagnostics.push(`${id}: item is not part of the Request.`);
    return {diagnostics, results};
};

const deriveResult = (/** @type {ItemResult[]} */ results) => results.some(item => item.result === 'gap')
    ? 'gap'
    : results.some(item => item.result === 'uncertain') ? 'uncertain' : 'satisfied';

/**
 * 检查已填写的清单, 在 Request 目录写入 Gate 1 和 Gate 2 临时记录, 并返回提升映射与未满足项.
 * @returns {Promise<{status: 'failed', kind: string, diagnostics: string[]} | {files: Array<{sourcePath: string, targetPath: string}>, open: Array<ItemResult & {blocking: boolean}>}>}
 */
export const generateCommitAudit = async (/** @type {{repositoryRoot: string, requestPath: string}} */ {repositoryRoot, requestPath}) => {
    let request;
    try {
        requestDirectory({fileName: 'request.json', path: requestPath, repositoryRoot});
        request = /** @type {AuditRequest} */ (JSON.parse(await readFile(requestPath, 'utf8')));
    } catch (error) {
        return {diagnostics: [error instanceof Error ? error.message : String(error)], kind: 'request-invalid', status: 'failed'};
    }
    const directory = dirname(requestPath);
    let candidate;
    try {
        candidate = await readStagedCandidate({git: createNodeGitRunner(repositoryRoot)});
        const input = parseInput({authorizingIssueIds: request.authorizingIssueIds, ...(request.gate2?.exception ? {gate2Exception: request.gate2.exception} : {})});
        const expected = deriveRequest({candidate, input, reviewPath: join(directory, REVIEW_FILE)});
        if (!jsonSemanticallyEqual(expected, request)) throw new Error('Commit Audit Request does not match the current staged candidate; prepare a new Request.');
    } catch (error) {
        return {diagnostics: [error instanceof Error ? error.message : String(error)], kind: 'candidate-invalid', status: 'failed'};
    }
    const {diagnostics, results} = checkChecklist({candidate, request, text: await readFile(request.reviewPath, 'utf8')});
    if (diagnostics.length > 0) return {diagnostics, kind: 'review-incomplete', status: 'failed'};

    const inventory = stagedIssueInventory(candidate);
    /** @type {Array<{record: unknown, sourceName: string, targetPath: string}>} */
    const outputs = [];
    for (const issueId of request.gate1) {
        const issue = /** @type {StagedIssue} */ (inventory.byId.get(issueId));
        const requirements = results.filter(item => item.source.startsWith(`${issue.filePath}:`));
        outputs.push({
            record: {requirements, result: deriveResult(requirements)},
            sourceName: `${issue.issueNumber}.audit.json`,
            targetPath: joinRelativePath('.scratch', issue.effortDirectory, 'issues', `${issue.issueNumber}.audit.json`),
        });
    }
    if (request.gate2) {
        const effortDirectory = /** @type {StagedIssue[]} */ (inventory.byEffort.get(request.effort))[0].effortDirectory;
        const documents = request.gate2.documents;
        const requirements = results.filter(item => documents.some(document => item.source.startsWith(`${document}:`)));
        outputs.push({
            record: request.gate2.exception
                ? {documents: [], exception: request.gate2.exception, requirements: [], result: 'not-applicable'}
                : {documents, requirements, result: deriveResult(requirements)},
            sourceName: 'spec-audit.json',
            targetPath: joinRelativePath('.scratch', effortDirectory, 'spec-audit.json'),
        });
    }
    for (const output of outputs) await writeFile(join(directory, output.sourceName), json(output.record));
    const blocking = new Set(outputs.flatMap(output => /** @type {{requirements: ItemResult[]}} */ (output.record).requirements.map(item => item.source)));
    return {
        files: outputs.map(output => ({sourcePath: relative(repositoryRoot, join(directory, output.sourceName)).split(sep).join('/'), targetPath: output.targetPath}))
            .sort((left, right) => compareText(left.targetPath, right.targetPath)),
        open: results.filter(item => item.result === 'gap' || item.result === 'uncertain').map(item => ({...item, blocking: blocking.has(item.source)})),
    };
};

/** Committed audit records may be edited by hand, so verify checks their shape and locators. */
const recordProblems = (/** @type {{candidate: StagedCandidate, record: any, requiredSources: Source[]}} */ {candidate, record, requiredSources}) => {
    if (!Array.isArray(record?.requirements) || record.result !== 'satisfied') return ['record must contain requirements and a satisfied result.'];
    const problems = [];
    const covered = new Set();
    const required = new Map(requiredSources.map(source => [formatSource(source), source]));
    for (const item of record.requirements) {
        const source = required.get(item?.source);
        if (!source) {
            problems.push(`record requirement is not a requirement line: ${item?.source}.`);
            continue;
        }
        if (item.result !== 'satisfied' && !(item.result === 'n/a' && !isAcceptanceCriterion(candidate, source))) {
            problems.push(`record requirement is not satisfied: ${item.source}.`);
            continue;
        }
        covered.add(item.source);
        if (item.result === 'satisfied') {
            const problem = locatorProblem(candidate, String(item.evidence));
            if (problem) problems.push(`${problem}.`);
        }
    }
    for (const source of required.keys()) if (!covered.has(source)) problems.push(`record does not cover requirement line: ${source}.`);
    return problems;
};

const readRecord = (/** @type {StagedCandidate} */ candidate, /** @type {string} */ filePath) => {
    const text = stagedText(candidate, filePath);
    if (text === null) return undefined;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
};

/**
 * 只读取完整已暂存候选, 验证本次终态转换所需的 Gate 1 和 Gate 2 记录.
 */
export const verifyCommitAudit = async (/** @type {{repositoryRoot: string}} */ {repositoryRoot}) => {
    /** @type {Array<{filePath: string, message: string}>} */
    const errors = [];
    try {
        const candidate = await readStagedCandidate({git: createNodeGitRunner(repositoryRoot)});
        for (const diagnostic of compareCommittedArtifactIdentities({candidateFiles: candidate.files, committedFiles: candidate.headFiles})) {
            errors.push({filePath: diagnostic.path, message: diagnostic.message});
        }
        const inventory = stagedIssueInventory(candidate);
        const gate2Efforts = new Set();
        for (const issueId of [...inventory.terminalTransitions].sort(compareText)) {
            const issue = /** @type {StagedIssue} */ (inventory.byId.get(issueId));
            const filePath = joinRelativePath('.scratch', issue.effortDirectory, 'issues', `${issue.issueNumber}.audit.json`);
            const record = readRecord(candidate, filePath);
            const requiredSources = issueRequirementLines(issue.text, issue.filePath).map(line => ({filePath: issue.filePath, line}));
            const problems = record === undefined
                ? [`Gate 1 record is required for terminal issue transition: ${filePath}.`]
                : recordProblems({candidate, record, requiredSources}).map(message => `Gate 1 ${message}`);
            for (const message of problems) errors.push({filePath, message});
            if ((inventory.byEffort.get(issue.effortNumber) ?? []).every(other => TERMINAL_ISSUE_STATUSES.has(other.status))) gate2Efforts.add(issue.effortNumber);
        }
        for (const effort of [...gate2Efforts].sort(compareText)) {
            const effortDirectory = /** @type {StagedIssue[]} */ (inventory.byEffort.get(effort))[0].effortDirectory;
            const filePath = joinRelativePath('.scratch', effortDirectory, 'spec-audit.json');
            const record = readRecord(candidate, filePath);
            if (record === undefined) {
                errors.push({filePath, message: 'Gate 2 record is required for the terminal effort.'});
                continue;
            }
            const governing = governingDocuments([...inventory.terminalTransitions].map(id => /** @type {StagedIssue} */ (inventory.byId.get(id))).filter(issue => issue.effortNumber === effort));
            if (record?.result === 'not-applicable') {
                try {
                    gate2Exception(record.exception);
                    if (governing.length > 0) throw new Error(`gate2Exception conflicts with governing documents: ${governing.join(', ')}.`);
                } catch (error) {
                    errors.push({filePath, message: `Gate 2 ${error instanceof Error ? error.message : String(error)}`});
                }
                continue;
            }
            const documents = Array.isArray(record?.documents) ? record.documents.filter((/** @type {unknown} */ document) => typeof document === 'string' && isGate2DocumentPath(document)) : [];
            const requiredSources = documents.flatMap((/** @type {string} */ document) => {
                const text = stagedText(candidate, document);
                return text === null ? [] : bodyLineNumbers(text.split(/\r?\n/)).map(line => ({filePath: document, line}));
            });
            if (documents.length === 0 || documents.length !== record?.documents?.length) errors.push({filePath, message: 'Gate 2 record must list only governing documents.'});
            for (const document of governing) if (!documents.includes(document)) errors.push({filePath, message: `Gate 2 record does not cover governing document: ${document}.`});
            for (const message of recordProblems({candidate, record, requiredSources})) errors.push({filePath, message: `Gate 2 ${message}`});
        }
    } catch (error) {
        errors.push({filePath: '.', message: error instanceof Error ? error.message : String(error)});
    }
    errors.sort((left, right) => compareText(left.filePath, right.filePath) || compareText(left.message, right.message));
    return {errors};
};
