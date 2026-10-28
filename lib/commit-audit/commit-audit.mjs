import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {basename, join, relative, sep} from 'node:path';

import {parseCanonicalArtifactId, parseEffortDirectoryName, parseRegisteredArtifactPath} from '../arw-common/artifact-identity.mjs';
import {compareCommittedArtifactIdentities, readArtifactInventory} from '../arw-common/artifacts.mjs';
import {readIssueRequirement} from '../arw-common/issue-documents.mjs';
import {createCurrentPlatformAdapter} from '../arw-common/platform-adapter.mjs';
import {parsePorcelainStatus, readStagedCandidate} from '../arw-common/repository-state-inspector.mjs';
import {createTemporaryWorkspace} from '../arw-common/temporary-workspace.mjs';
import {createNodeGitRunner} from '../common/git-process.mjs';
import {compareText, exactKeys} from '../common/json.mjs';
import {inspectTextBytes} from '../common/text-policy.mjs';
import {isRuleFile, prepareReviewerRound} from '../reviewer-runtime/reviewer-round.mjs';

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

/** @returns {AuditRequest & {issuePaths: string[]}} */
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
        if (input.gate2Exception && documents.some(document => candidate.changedPaths.includes(document))) throw new Error('Commit Audit gate2Exception conflicts with a changed governing document.');
        for (const document of documents) {
            if (stagedText(candidate, document) === null) throw new Error(`Commit Audit governing document is not a regular staged file: ${document}.`);
        }
        gate2 = input.gate2Exception ? {documents: [], exception: input.gate2Exception} : {documents};
    }
    return {authorizingIssueIds: input.authorizingIssueIds, effort: input.effort, gate1, gate2, issuePaths: authorizing.map(issue => issue.filePath), reviewPath};
};

const git = async (/** @type {string} */ repositoryRoot, /** @type {string[]} */ argv) => {
    const result = await createNodeGitRunner(repositoryRoot).run({argv});
    if (result.failure !== null || result.code !== 0) throw new Error(`Commit Audit git ${argv.join(' ')} failed: ${result.stderr.trim()}`);
    return result.stdout.toString('utf8');
};

/** Effort prototype and research files: outside Code Standards review, eligible for a non-implementation commit. Group 1 is the effort directory. */
const EFFORT_AUXILIARY_PATH = /^\.scratch\/([^/]+)\/(?:prototype|research)\/./u;

/** Changed paths given to the Code Standards Reviewer: `.arwignore` matches and effort prototype or research files are excluded. */
const standardsPaths = async (/** @type {string} */ repositoryRoot, /** @type {string[]} */ changedPaths) => {
    const ignored = await createNodeGitRunner(repositoryRoot).run({argv: ['-c', 'core.excludesFile=.arwignore', 'check-ignore', '--no-index', '--stdin', '-z'],
        input: `${changedPaths.join('\0')}\0`});
    if (ignored.failure !== null || ![0, 1].includes(ignored.code ?? -1)) throw new Error('Commit Audit could not read .arwignore matches.');
    const excluded = new Set(ignored.stdout.toString('utf8').split('\0'));
    return changedPaths.filter(path => !excluded.has(path) && !EFFORT_AUXILIARY_PATH.test(path));
};

/**
 * 从已暂存候选派生 Request, 用 `base` (HEAD) 和 `tree` (`git write-tree`) 固定受审版本,
 * 并在会话工作区 `_commit-audit/<n>/` 写出两个 Reviewer 的空报告, 规则副本和机器请求.
 */
export const prepareCommitAudit = async (/** @type {{inputPath: string, platformAdapter?: Pick<ReturnType<typeof createCurrentPlatformAdapter>, 'getCurrentAgentIdentity'>, repositoryRoot: string}} */ {inputPath, platformAdapter, repositoryRoot}) => {
    if (basename(inputPath) !== 'input.json' || !relative(repositoryRoot, inputPath).split(sep).join('/').startsWith('.tmp/')) {
        throw new Error('Commit Audit path must be an absolute input.json path inside the Repository .tmp directory.');
    }
    const input = parseInput(JSON.parse(await readFile(inputPath, 'utf8')));
    const candidate = await readStagedCandidate({git: createNodeGitRunner(repositoryRoot)});
    const workspace = await createTemporaryWorkspace({agentIdentity: (platformAdapter ?? createCurrentPlatformAdapter()).getCurrentAgentIdentity(),
        purpose: '_commit-audit', repositoryRoot});
    const round = join(workspace, String((await readdir(workspace)).filter(name => /^\d+$/u.test(name)).length + 1));
    await mkdir(round);
    const {issuePaths, ...derived} = deriveRequest({candidate, input, reviewPath: join(round, 'requirements-reviewer', 'review.txt')});
    const request = {
        ...derived,
        base: (await git(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim(),
        tree: (await git(repositoryRoot, ['write-tree'])).trim(),
    };
    const version = `受审版本: 起点提交 ${request.base}, 终点已暂存树 ${request.tree}. 只用 \`git diff ${request.base} ${request.tree}\` 和 \`git show ${request.tree}:<path>\` 读取, 不读实时索引或工作树.`;
    const changes = async (/** @type {import('../reviewer-runtime/reviewer-round.mjs').PreviousRound | null} */ previous) => previous
        ? `\n复审: 前轮报告 ${previous.reportPath}; 相邻版本变化 \`git diff ${JSON.parse(await readFile(join(previous.roundDirectory, 'request.json'), 'utf8')).tree} ${request.tree}\`.`
        : '';
    const paths = await standardsPaths(repositoryRoot, candidate.changedPaths);
    await prepareReviewerRound({
        repositoryRoot, roundDirectory: round,
        ruleFiles: new Map([...candidate.files].flatMap(([path, file]) => isRuleFile(path) && file.bytes !== null ? [[path, file.bytes]] : [])),
        reviewers: [
            {role: 'requirements-reviewer', issueIds: input.authorizingIssueIds, reportPath: request.reviewPath,
                handoff: async previous => `提交审核 (要求符合). Request: ${join(round, 'request.json')}\n${version}${await changes(previous)}`},
            {role: 'code-standards-reviewer', issueIds: input.authorizingIssueIds, reportPath: join(round, 'code-standards-reviewer', 'review.txt'),
                handoff: async previous => `提交审核 (Code Standards). ${version}\n纳入路径:\n${paths.map(path => `- ${path}`).join('\n')}\n预估净增行数见授权 issue: ${issuePaths.join(', ')}.${await changes(previous)}`},
        ],
    });
    await writeFile(join(round, 'request.json'), `${JSON.stringify(request, null, 2)}\n`);
    return {roundDirectory: round};
};

/** Agent rule and documentation Markdown: Agent instructions, docs and `distribution/` copies. Belongs to no effort. */
const isRuleDocument = (/** @type {string} */ path) => path.endsWith('.md') && (isRuleFile(path) || /^(?:docs|distribution)\//u.test(path));

const NON_IMPLEMENTATION_PATH = /^\.scratch\/([^/]+)\/(?:spec\.md|map\.md|issues\/[^/]+\.md)$/u;

/** The staged index as the read-only filesystem `readArtifactInventory` scans, so Artifact parsing sees staged bytes. */
const stagedFilesystem = (/** @type {string} */ repositoryRoot, /** @type {StagedCandidate['files']} */ files) => {
    const kindOf = (/** @type {string} */ path) => {
        const file = files.get(path);
        if (file) return file.mode === '120000' ? 'link' : file.mode.startsWith('100') ? 'file' : 'other';
        return [...files.keys()].some(other => other.startsWith(`${path}/`)) ? 'directory' : 'missing';
    };
    const ok = (/** @type {object} */ value) => Promise.resolve({diagnostics: [], status: /** @type {const} */ ('succeeded'), ...value});
    return {
        inspect: (/** @type {{path: string}} */ {path}) => ok({entry: {kind: kindOf(path), path}}),
        list: (/** @type {{path: string}} */ {path}) => ok({entries: [...new Set([...files.keys()].filter(other => other.startsWith(`${path}/`))
            .map(other => `${path}/${other.slice(path.length + 1).split('/')[0]}`))].map(child => ({kind: kindOf(child), path: child}))}),
        readText: (/** @type {{path: string}} */ {path}) => ok({text: decodeText(/** @type {Buffer} */ (files.get(path)?.bytes), path)}),
        resolve: (/** @type {{path: string}} */ {path}) => ({absolutePath: join(repositoryRoot, path), diagnostics: [], relativePath: path, status: /** @type {const} */ ('succeeded')}),
    };
};

/** Non-implementation commit checks: classification, one effort, no unstaged replacement, no new terminal issue, Artifact parsing and text format. */
const nonImplementationErrors = async (/** @type {string} */ repositoryRoot, /** @type {StagedCandidate} */ candidate) => {
    /** @type {Array<{filePath: string, message: string}>} */
    const errors = [];
    if (candidate.changedPaths.length === 0) return [{filePath: '.', message: 'The staged candidate is empty.'}];
    const staged = candidate.changedPaths.filter(path => candidate.files.has(path));
    const efforts = new Set();
    for (const path of candidate.changedPaths) {
        const file = candidate.files.get(path) ?? candidate.headFiles.get(path);
        if (file?.mode === '160000') continue;
        const match = NON_IMPLEMENTATION_PATH.exec(path) ?? EFFORT_AUXILIARY_PATH.exec(path);
        if (isRuleDocument(path) && (!candidate.files.has(path) || file?.mode.startsWith('100'))) continue;
        if (!match || (candidate.files.has(path) && !file?.mode.startsWith('100'))) errors.push({filePath: path, message: 'Path is not eligible for a non-implementation commit.'});
        else efforts.add(match[1]);
    }
    if (efforts.size > 1) errors.push({filePath: '.', message: `The staged candidate spans more than one effort: ${[...efforts].join(', ')}.`});
    const status = await git(repositoryRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=dirty', '--', ...candidate.changedPaths]);
    for (const entry of parsePorcelainStatus(Buffer.from(status))) {
        if (entry.code[1] !== ' ') errors.push({filePath: entry.path, message: 'Staged path has an unstaged replacement.'});
    }
    for (const issueId of stagedIssueInventory(candidate).terminalTransitions) {
        errors.push({filePath: issueId, message: 'A non-implementation commit cannot move an implementation issue into a terminal status.'});
    }
    const inventory = await readArtifactInventory({root: repositoryRoot, scratchDirectory: join(repositoryRoot, '.scratch')}, stagedFilesystem(repositoryRoot, candidate.files));
    for (const path of staged) {
        let identity;
        try {
            identity = parseRegisteredArtifactPath(path);
        } catch {
            continue;
        }
        const diagnostic = inventory.diagnostics[identity.kind].find(item => item.path === path);
        if (diagnostic || !inventory.records[identity.kind].some(record => record.id === identity.canonicalId)) {
            errors.push({filePath: path, message: diagnostic?.message ?? `Staged Artifact does not parse as ${identity.canonicalId}.`});
        }
    }
    for (const path of staged) {
        const bytes = candidate.files.get(path)?.bytes;
        if (!bytes) continue;
        if (inspectTextBytes(bytes).issues.some(issue => issue !== 'invalid-utf8')) errors.push({filePath: path, message: 'Staged text must be UTF-8 without BOM and use LF line endings.'});
        try {
            decodeText(bytes, path);
        } catch (error) {
            errors.push({filePath: path, message: error instanceof Error ? error.message : String(error)});
        }
    }
    const check = await createNodeGitRunner(repositoryRoot).run({argv: ['diff', '--cached', '--check', '--', ...staged]});
    if (check.code !== 0) errors.push({filePath: '.', message: `git diff --cached --check failed:\n${check.stdout.toString('utf8').trim()}`});
    return errors;
};

/**
 * 只读取完整已暂存候选, 确认它保留每个已提交的 ARW Artifact 身份.
 */
export const verifyCommitAudit = async (/** @type {{nonImplementation?: boolean, repositoryRoot: string}} */ {nonImplementation = false, repositoryRoot}) => {
    /** @type {Array<{filePath: string, message: string}>} */
    const errors = [];
    try {
        const tree = nonImplementation ? await git(repositoryRoot, ['write-tree']) : '';
        const candidate = await readStagedCandidate({git: createNodeGitRunner(repositoryRoot)});
        for (const diagnostic of compareCommittedArtifactIdentities({candidateFiles: candidate.files, committedFiles: candidate.headFiles})) {
            errors.push({filePath: diagnostic.path, message: diagnostic.message});
        }
        if (nonImplementation) {
            errors.push(...await nonImplementationErrors(repositoryRoot, candidate));
            if (await git(repositoryRoot, ['write-tree']) !== tree) errors.push({filePath: '.', message: 'The staged candidate changed during verification.'});
        }
    } catch (error) {
        errors.push({filePath: '.', message: error instanceof Error ? error.message : String(error)});
    }
    errors.sort((left, right) => compareText(left.filePath, right.filePath) || compareText(left.message, right.message));
    return {errors};
};
