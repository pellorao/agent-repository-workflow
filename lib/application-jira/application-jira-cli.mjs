import {loadRepositoryConfiguration} from '../arw-common/repository-configuration.mjs';
import {createJiraClient} from './jira-client.mjs';
import {renderJiraList} from './jira-presentation.mjs';
import {createJiraHttpRequest} from './jira-request.mjs';
import {createDefaultBrowserAdapter} from './browser-adapter.mjs';
import {createSubmoduleCoordinator} from './submodule-coordination.mjs';
import {createSubmoduleGitAdapter} from './submodule-git-adapter.mjs';
import {formatCanonicalArtifactId, parseCanonicalArtifactId, parseRegisteredArtifactPath, readArtifactInventory} from '../arw-common/artifacts.mjs';
import {createScopedFilesystem} from '../common/filesystem.mjs';
import {applyFileTransaction, preflightFileTransaction} from '../common/file-transaction.mjs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {TextDecoder} from 'node:util';
import {synchronizeApplicationIssues} from './application-sync.mjs';
import {associateApplicationIssue} from './application-association.mjs';
import {evaluateApplicationCompletion} from './application-completion.mjs';
import {createJiraConvergenceAdapter} from './jira-convergence-adapter.mjs';
import {convergeJiraIssue} from './jira-convergence.mjs';
import {loadCommittedApplicationConfiguration, loadCommittedApplicationEffort, proveUpstreamEffort} from './git-upstream-proof.mjs';
import {readIssueDocuments} from '../arw-common/issue-documents.mjs';
import {createNodeGitRunner} from '../common/git-process.mjs';
import {isRegularGitBlobMode, parseTreeBlobEntries, readBatchBlobs} from '../common/git-content.mjs';
import {checkModuleCorrection} from './module-correction-check.mjs';

/** @typedef {(message: string) => void} Writer */
/** @typedef {{path: string, record: {association?: unknown, number: string}}} AssociationFreezeSnapshot */
/** @typedef {Awaited<ReturnType<typeof readArtifactInventory>>['records']['issue'][number]} InventoryIssueRecord */
/** @typedef {{path: string, record: InventoryIssueRecord, text: string}} AssociationSnapshot */
/** @typedef {{kind: 'jira-list', limit: number | null} | {kind: 'jira-open', issueKey: string} | {kind: 'jira-print', issueKey: string} | {kind: 'jira-sync', phase: 'accepted' | 'completed', specId: string} | {kind: 'submodule-switch-branch', targetBranch: string} | {kind: 'module-check-correction', issueId: string} | {kind: 'application-sync'} | {kind: 'application-associate', moduleIssueId: string, moduleName: string, applicationIssueId: string}} ApplicationJiraCommand */
/** @typedef {{command: ApplicationJiraCommand, globalConfig: {jira?: {listLimit: number}}, rawStdout: Writer, repositoryRoot: string, stdout: Writer, stderr: Writer, dependencies?: {git?: ReturnType<typeof createNodeGitRunner>, openBrowser?: (url: string) => Promise<{diagnostics: Array<{code: string, message: string}>, stage?: string, status: 'failed' | 'succeeded'}>, openFilesystem?: typeof createScopedFilesystem, request?: Parameters<typeof createJiraClient>[0]['request'], submoduleGit?: Parameters<typeof createSubmoduleCoordinator>[0]['git'], token?: string}}} ApplicationJiraCommandInput */
/** @typedef {Extract<Extract<Awaited<ReturnType<typeof loadRepositoryConfiguration>>, {status: 'succeeded'}>['context'], {role: 'leader'}>} ApplicationLeaderContext */

/** @param {Buffer} bytes */
const parseIndexBlobEntries = bytes => bytes.toString('utf8').split('\0').filter(Boolean).map(record => {
    const match = /^(?<mode>\d{6}) (?<objectId>[0-9a-f]{40,64}) (?<stage>\d)\t(?<path>.+)$/u.exec(record);
    if (match?.groups === undefined || match.groups.stage !== '0') throw new Error('Git index contains an unsupported issue entry.');
    return {mode: match.groups.mode, objectId: match.groups.objectId, path: match.groups.path};
});

/** @param {Array<{objectId: string}>} entries */
const uniqueObjectIds = entries => [...new Set(entries.map(entry => entry.objectId))].sort();

/** @param {string} path */
const parseIssuePath = path => {
    try {
        const parsed = parseRegisteredArtifactPath(path);
        return parsed.kind === 'issue' && parsed.issueNumber !== null && parsed.issueFilename !== null
            ? {
                effort: parsed.effortDirectory,
                effortNumber: parsed.effortNumber,
                number: parsed.issueNumber,
            }
            : undefined;
    } catch {
        return undefined;
    }
};

/**
 * @param {{git: ReturnType<typeof createNodeGitRunner>, repositoryRoot: string, source: 'head' | 'index'}} input
 */
const readGitIssueSnapshots = async input => {
    if (input.source === 'head') {
        const resolved = await input.git.run({argv: ['rev-parse', '--verify', '--quiet', 'HEAD'], cwd: input.repositoryRoot});
        if (resolved.failure !== null || resolved.code !== 0 && resolved.code !== 1) {
            return {diagnostics: [{code: 'application-head-read-failed', message: 'Committed Application issue state could not be resolved.'}], stage: 'git-read', status: /** @type {'failed'} */ ('failed')};
        }
        if (resolved.code === 1) return {baselines: new Map(), diagnostics: [], snapshots: [], status: /** @type {'succeeded'} */ ('succeeded')};
    }
    const listed = await input.git.run({
        argv: input.source === 'head'
            ? ['ls-tree', '-r', '-z', 'HEAD', '--', '.scratch']
            : ['ls-files', '--stage', '-z', '--', '.scratch'],
        cwd: input.repositoryRoot,
    });
    if (listed.failure !== null || listed.code !== 0) {
        return {diagnostics: [{code: `application-${input.source}-read-failed`, message: `${input.source === 'head' ? 'Committed Application' : 'Git index'} issue state could not be listed.`}], stage: 'git-read', status: /** @type {'failed'} */ ('failed')};
    }
    try {
        const allEntries = input.source === 'head' ? parseTreeBlobEntries(listed.stdout) : parseIndexBlobEntries(listed.stdout);
        const entries = allEntries.filter(entry => parseIssuePath(entry.path) !== undefined);
        if (entries.some(entry => !isRegularGitBlobMode(entry.mode))) throw new Error('Application issue path is not a regular file.');
        const blobs = await readBatchBlobs({git: input.git, objectIds: uniqueObjectIds(entries)});
        const decoder = new TextDecoder('utf-8', {fatal: true});
        const documents = entries.map(entry => {
            const parts = parseIssuePath(entry.path);
            const bytes = blobs.get(entry.objectId);
            if (parts === undefined || bytes === undefined) throw new Error('Application issue blob is unavailable.');
            return {
                effort: parts.effort,
                number: parts.number,
                sourceKey: entry.path,
                text: decoder.decode(bytes),
            };
        });
        const parsed = readIssueDocuments(documents);
        if (parsed.diagnostics.length > 0) {
            return {
                diagnostics: parsed.diagnostics.map(diagnostic => ({code: `application-${input.source}-issue-invalid`, message: `${input.source === 'head' ? 'Committed Application' : 'Git index'} issue is invalid: ${diagnostic.sourceKey}: ${diagnostic.message}`})),
                status: /** @type {'blocked'} */ ('blocked'),
            };
        }
        const text = new Map(documents.map(document => [document.sourceKey, document.text]));
        const baselines = new Map(entries.map(entry => {
            const bytes = blobs.get(entry.objectId);
            if (bytes === undefined) throw new Error('Application issue baseline is unavailable.');
            return [entry.path, bytes];
        }));
        return {
            baselines,
            diagnostics: [],
            snapshots: parsed.records.map(record => {
                const parts = parseIssuePath(record.sourceKey);
                if (parts === undefined) throw new Error('Parsed Application issue path is unavailable.');
                return {
                    path: record.sourceKey,
                    record: {
                        ...record,
                        effortNumber: parts.effortNumber,
                        id: formatCanonicalArtifactId({effortNumber: parts.effortNumber, issueNumber: record.number, kind: 'issue', qualifier: null}),
                    },
                    text: text.get(record.sourceKey) ?? '',
                };
            }),
            status: /** @type {'succeeded'} */ ('succeeded'),
        };
    } catch {
        return {diagnostics: [{code: `application-${input.source}-read-failed`, message: `${input.source === 'head' ? 'Committed Application' : 'Git index'} issue state could not be read.`}], stage: 'git-read', status: /** @type {'failed'} */ ('failed')};
    }
};

/**
 * @param {{git: ReturnType<typeof createNodeGitRunner>, repositoryRoot: string, snapshots: AssociationFreezeSnapshot[]}} input
 */
const readFrozenAssociationPaths = async input => {
    const associated = input.snapshots.filter(snapshot => snapshot.record.association !== undefined);
    if (associated.length === 0) return {diagnostics: [], paths: [], status: /** @type {'succeeded'} */ ('succeeded')};
    const listed = await input.git.run({
        argv: ['ls-tree', '-r', '-z', 'HEAD', '--', ...associated.map(snapshot => snapshot.path)],
        cwd: input.repositoryRoot,
    });
    if (listed.code !== 0 || listed.failure !== null) {
        return {diagnostics: [{code: 'association-committed-input-read-failed', message: 'Committed Module association inputs could not be listed.'}], stage: 'git-read', status: /** @type {'failed'} */ ('failed')};
    }
    let entries;
    let blobs;
    try {
        entries = parseTreeBlobEntries(listed.stdout);
        if (entries.some(entry => !isRegularGitBlobMode(entry.mode))) throw new Error('Committed Module issue path is not a regular file.');
        blobs = await readBatchBlobs({git: input.git, objectIds: uniqueObjectIds(entries)});
    } catch {
        return {diagnostics: [{code: 'association-committed-input-read-failed', message: 'Committed Module association inputs could not be read.'}], stage: 'git-read', status: /** @type {'failed'} */ ('failed')};
    }
    const committed = new Map(entries.map(entry => [entry.path, blobs.get(entry.objectId)]));
    const paths = [];
    for (const snapshot of associated) {
        if (!committed.has(snapshot.path)) continue;
        const bytes = committed.get(snapshot.path);
        if (bytes === undefined) {
            return {diagnostics: [{code: 'association-committed-input-read-failed', message: `Committed Module issue could not be read: ${snapshot.path}.`}], stage: 'git-read', status: /** @type {'failed'} */ ('failed')};
        }
        const pathIdentity = parseIssuePath(snapshot.path);
        if (pathIdentity === undefined) {
            return {diagnostics: [{code: 'association-committed-input-read-failed', message: `Committed Module issue path is invalid: ${snapshot.path}.`}], stage: 'git-read', status: /** @type {'failed'} */ ('failed')};
        }
        const parsed = readIssueDocuments([{
            effort: pathIdentity.effort,
            number: pathIdentity.number,
            sourceKey: snapshot.path,
            text: bytes.toString('utf8'),
        }]);
        if (parsed.diagnostics.length === 0 && parsed.records[0]?.association !== undefined) paths.push(snapshot.path);
    }
    return {diagnostics: [], paths, status: /** @type {'succeeded'} */ ('succeeded')};
};

/** @param {{git: ReturnType<typeof createNodeGitRunner>, path: string, repositoryRoot: string}} input */
const verifyEffortWorkingBaseline = async input => {
    const unstaged = await input.git.run({argv: ['diff', '--quiet', '--', input.path], cwd: input.repositoryRoot});
    if (unstaged.failure !== null || unstaged.code === null || ![0, 1].includes(unstaged.code)) {
        return {diagnostics: [{code: 'association-effort-state-read-failed', message: `Association effort state could not be read: ${input.path}.`}], stage: 'git-read', status: /** @type {'failed'} */ ('failed')};
    }
    const untracked = await input.git.run({argv: ['ls-files', '--others', '--exclude-standard', '-z', '--', input.path], cwd: input.repositoryRoot});
    if (untracked.failure !== null || untracked.code !== 0) {
        return {diagnostics: [{code: 'association-effort-state-read-failed', message: `Association effort state could not be read: ${input.path}.`}], stage: 'git-read', status: /** @type {'failed'} */ ('failed')};
    }
    if (unstaged.code === 1 || untracked.stdout.length > 0) {
        return {diagnostics: [{code: 'association-effort-not-at-index', message: `Association effort must have no unstaged or untracked content: ${input.path}.`}], status: /** @type {'blocked'} */ ('blocked')};
    }
    return {diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded')};
};

/** @param {{git: ReturnType<typeof createNodeGitRunner>, paths: string[], repositoryRoot: string}} input */
const readIndexBaselines = async input => {
    const listed = await input.git.run({argv: ['ls-files', '--stage', '-z', '--', ...input.paths], cwd: input.repositoryRoot});
    if (listed.failure !== null || listed.code !== 0) {
        return {diagnostics: [{code: 'index-baseline-read-failed', message: 'Git index baselines could not be listed.'}], stage: 'git-read', status: /** @type {'failed'} */ ('failed')};
    }
    let entries;
    let blobs;
    try {
        entries = parseIndexBlobEntries(listed.stdout);
        blobs = await readBatchBlobs({git: input.git, objectIds: uniqueObjectIds(entries)});
    } catch {
        return {diagnostics: [{code: 'index-baseline-read-failed', message: 'Git index baselines could not be read.'}], stage: 'git-read', status: /** @type {'failed'} */ ('failed')};
    }
    const observed = new Map(entries.map(entry => [entry.path, blobs.get(entry.objectId)]));
    const baselines = new Map();
    for (const path of input.paths) {
        if (!observed.has(path)) {
            return {diagnostics: [{code: 'index-baseline-missing', message: `Git index baseline is required: ${path}.`}], status: /** @type {'blocked'} */ ('blocked')};
        }
        const bytes = observed.get(path);
        if (bytes === undefined) {
            return {diagnostics: [{code: 'index-baseline-read-failed', message: `Git index baseline could not be read: ${path}.`}], stage: 'git-read', status: /** @type {'failed'} */ ('failed')};
        }
        baselines.set(path, bytes);
    }
    return {baselines, diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded')};
};

/** @param {ApplicationJiraCommandInput} input @param {ApplicationLeaderContext} context */
const runSubmoduleSwitchBranchCommand = async (input, context) => {
    const command = /** @type {Extract<ApplicationJiraCommand, {kind: 'submodule-switch-branch'}>} */ (input.command);
    const coordinator = createSubmoduleCoordinator({git: input.dependencies?.submoduleGit ?? createSubmoduleGitAdapter()});
    const result = await coordinator.switchBranch({
        modules: Object.values(context.modules),
        remote: context.submodule.remote,
        targetBranch: command.targetBranch,
    });
    if (result.status !== 'succeeded') {
        result.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
        return 1;
    }
    if (result.finalStates.length === 0) {
        input.stdout('No configured Application Modules.');
        return 0;
    }
    for (const state of result.finalStates) {
        input.stdout(`${state.module}: ${state.branch} @ ${state.head}${state.changed ? ' (changed)' : ''}`);
    }
    return 0;
};

/** @param {{git: ReturnType<typeof createNodeGitRunner>, path: string, repositoryRoot: string}} input */
const readOptionalHeadFile = async input => {
    const listed = await input.git.run({argv: ['ls-tree', '-z', 'HEAD', '--', input.path], cwd: input.repositoryRoot});
    if (listed.failure !== null || listed.code !== 0) {
        return {diagnostics: [{code: 'module-correction-git-read-failed', message: `Git could not read HEAD input: ${input.path}.`, path: input.path}], stage: 'git-read', status: /** @type {'failed'} */ ('failed')};
    }
    try {
        const entries = parseTreeBlobEntries(listed.stdout);
        if (entries.length === 0) return {diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded'), tracked: false};
        if (entries.length !== 1 || entries[0].path !== input.path || !isRegularGitBlobMode(entries[0].mode)) throw new Error();
        const blobs = await readBatchBlobs({git: input.git, objectIds: [entries[0].objectId]});
        const bytes = blobs.get(entries[0].objectId);
        if (bytes === undefined) throw new Error();
        return {bytes, diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded'), tracked: true};
    } catch {
        return {diagnostics: [{code: 'module-correction-git-read-failed', message: `Git could not read HEAD input: ${input.path}.`, path: input.path}], stage: 'git-read', status: /** @type {'failed'} */ ('failed')};
    }
};

/** @typedef {{diagnostics: Array<{code: string, message: string, path?: string}>, stage: 'filesystem-read' | 'git-read', status: 'failed'} | {diagnostics: Array<{code: string, message: string, path?: string}>, status: 'blocked' | 'succeeded'}} ModuleCorrectionCommandResult */

/** @param {'filesystem-read' | 'git-read'} stage @param {string} message @param {string} [path] @returns {ModuleCorrectionCommandResult} */
const failedModuleCorrectionRead = (stage, message, path) => ({
    diagnostics: [{code: stage === 'git-read' ? 'module-correction-git-read-failed' : 'module-correction-filesystem-read-failed', message, ...(path === undefined ? {} : {path})}],
    stage,
    status: /** @type {'failed'} */ ('failed'),
});

/** @param {string} [path] @returns {ModuleCorrectionCommandResult} */
const invalidModuleCorrectionIssue = path => ({
    diagnostics: [{code: 'module-correction-issue-invalid', message: 'HEAD and working tree must contain the same published Module implementation issue.', ...(path === undefined ? {} : {path})}],
    status: /** @type {'blocked'} */ ('blocked'),
});

/**
 * @param {{command: Extract<ApplicationJiraCommand, {kind: 'module-check-correction'}>, dependencies?: ApplicationJiraCommandInput['dependencies'], repositoryRoot: string}} input
 * @returns {Promise<ModuleCorrectionCommandResult>}
 */
export const evaluateModuleCorrectionCheckCommand = async input => {
    const command = input.command;
    const git = input.dependencies?.git ?? createNodeGitRunner(input.repositoryRoot);
    const committed = await readGitIssueSnapshots({git, repositoryRoot: input.repositoryRoot, source: 'head'});
    if (committed.status === 'failed') return failedModuleCorrectionRead('git-read', 'Git could not read the published Module issue from HEAD.');
    if (committed.status !== 'succeeded') return invalidModuleCorrectionIssue();
    const openFilesystem = input.dependencies?.openFilesystem ?? createScopedFilesystem;
    const opened = await openFilesystem({root: input.repositoryRoot});
    if (opened.status !== 'succeeded') return failedModuleCorrectionRead('filesystem-read', 'Filesystem could not read the current Module issue.');
    let inventory;
    try {
        inventory = await readArtifactInventory({root: input.repositoryRoot, scratchDirectory: join(input.repositoryRoot, '.scratch')}, opened.scopedFilesystem);
    } catch {
        return failedModuleCorrectionRead('filesystem-read', 'Filesystem could not read the current Module issue.');
    }
    if (inventory.errors.issue !== null) return failedModuleCorrectionRead('filesystem-read', 'Filesystem could not read the current Module issue.');
    if (inventory.diagnostics.issue.length > 0) return invalidModuleCorrectionIssue();
    const committedMatches = committed.snapshots.filter(snapshot => snapshot.record.id === command.issueId);
    const workingMatches = inventory.records.issue.filter(record => record.id === command.issueId);
    if (committedMatches.length !== 1 || workingMatches.length !== 1) return invalidModuleCorrectionIssue();
    const workingRecord = workingMatches[0];
    const workingText = inventory.migration.issueDocuments.find(document => document.sourceKey === workingRecord.sourceKey)?.text;
    if (workingText === undefined) return failedModuleCorrectionRead('filesystem-read', 'Filesystem could not read the current Module issue.', workingRecord.sourceKey);
    const effort = parseIssuePath(workingRecord.sourceKey)?.effort;
    if (effort === undefined) return invalidModuleCorrectionIssue(workingRecord.sourceKey);
    const specPath = `.scratch/${effort}/spec.md`;
    const headSpec = await readOptionalHeadFile({git, path: specPath, repositoryRoot: input.repositoryRoot});
    if (headSpec.status !== 'succeeded') return {diagnostics: headSpec.diagnostics, stage: /** @type {'git-read'} */ ('git-read'), status: /** @type {'failed'} */ ('failed')};
    let spec;
    if (headSpec.tracked) {
        if (headSpec.bytes === undefined) return failedModuleCorrectionRead('git-read', `Git could not read HEAD input: ${specPath}.`, specPath);
        const currentSpec = await opened.scopedFilesystem.readText({allowLossyDecoding: false, path: specPath});
        if (currentSpec.status !== 'succeeded') return failedModuleCorrectionRead('filesystem-read', `Filesystem could not read current input: ${specPath}.`, specPath);
        try {
            spec = {headText: new TextDecoder('utf-8', {fatal: true}).decode(headSpec.bytes), path: specPath, workingText: currentSpec.text};
        } catch {
            return failedModuleCorrectionRead('git-read', `Git could not read HEAD input: ${specPath}.`, specPath);
        }
    }
    return checkModuleCorrection({
        headIssue: committedMatches[0],
        ...(spec === undefined ? {} : {spec}),
        workingIssue: {path: workingRecord.sourceKey, record: workingRecord, text: workingText},
    });
};

/** @param {ApplicationJiraCommandInput} input */
const runModuleCorrectionCheckCommand = async input => {
    const command = /** @type {Extract<ApplicationJiraCommand, {kind: 'module-check-correction'}>} */ (input.command);
    const result = await evaluateModuleCorrectionCheckCommand({command, dependencies: input.dependencies, repositoryRoot: input.repositoryRoot});
    if (result.status !== 'succeeded') {
        result.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
        return 1;
    }
    input.stdout(`Module correction check passed: ${command.issueId}.`);
    return 0;
};

/** @param {ApplicationJiraCommandInput} input @param {ApplicationLeaderContext} context */
const runApplicationSyncCommand = async (input, context) => {
    const repository = {root: input.repositoryRoot, scratchDirectory: join(input.repositoryRoot, '.scratch')};
    const applicationGit = createNodeGitRunner(input.repositoryRoot);
    const indexed = await readGitIssueSnapshots({git: applicationGit, repositoryRoot: input.repositoryRoot, source: 'index'});
    if (indexed.status !== 'succeeded') {
        indexed.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
        return 1;
    }
    const committed = await readGitIssueSnapshots({git: applicationGit, repositoryRoot: input.repositoryRoot, source: 'head'});
    if (committed.status !== 'succeeded') {
        committed.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
        return 1;
    }
    const indexedApplicationIssues = indexed.snapshots.filter(snapshot => snapshot.record.kind === 'application-source');
    const indexedByPath = new Map(indexedApplicationIssues.map(snapshot => [snapshot.path, snapshot]));
    for (const committedIssue of committed.snapshots.filter(snapshot => snapshot.record.kind === 'application-source')) {
        const indexedIssue = indexedByPath.get(committedIssue.path);
        if (indexedIssue === undefined
            || indexedIssue.record.association?.kind !== committedIssue.record.association?.kind
            || indexedIssue.record.association?.coordinate !== committedIssue.record.association?.coordinate) {
            input.stderr(`Committed Application Source Issue must remain associated in the Git index: ${committedIssue.path}.`);
            return 1;
        }
    }
    const applicationInventory = await readArtifactInventory(repository);
    if (applicationInventory.diagnostics.issue.length > 0) {
        applicationInventory.diagnostics.issue.forEach(diagnostic => input.stderr(`${diagnostic.path}: ${diagnostic.message}`));
        return 1;
    }
    const applicationText = new Map(applicationInventory.migration.issueDocuments.map(document => [document.sourceKey, document.text]));
    const workingApplicationIssues = applicationInventory.records.issue
        .filter(record => record.kind === 'application-source')
        .map(record => ({path: record.sourceKey, record, text: applicationText.get(record.sourceKey) ?? ''}));
    const workingByPath = new Map(workingApplicationIssues.map(issue => [issue.path, issue]));
    const changedApplicationIssue = indexedApplicationIssues.find(issue => {
        const workingIssue = workingByPath.get(issue.path);
        return workingIssue === undefined || !indexed.baselines.get(issue.path)?.equals(Buffer.from(workingIssue.text, 'utf8'));
    });
    if (changedApplicationIssue !== undefined) {
        input.stderr(`Application Source Issue working bytes differ from the Git index: ${changedApplicationIssue.path}.`);
        return 1;
    }
    const unexpectedApplicationIssue = workingApplicationIssues.find(issue => !indexedByPath.has(issue.path));
    if (unexpectedApplicationIssue !== undefined) {
        input.stderr(`Application Source Issue is missing from the Git index: ${unexpectedApplicationIssue.path}.`);
        return 1;
    }
    const coordinator = createSubmoduleCoordinator({git: input.dependencies?.submoduleGit ?? createSubmoduleGitAdapter()});
    const convergence = await coordinator.convergeRemote({
        branch: context.submodule.distributionBranch,
        modules: Object.values(context.modules),
        remote: context.submodule.remote,
    });
    if (convergence.status !== 'succeeded') {
        convergence.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
        return 1;
    }
    /** @type {Parameters<typeof synchronizeApplicationIssues>[0]['moduleIssues']} */
    const moduleIssues = {};
    for (const module of Object.values(context.modules)) {
        const inventory = await readArtifactInventory({root: module.repositoryRoot, scratchDirectory: join(module.repositoryRoot, '.scratch')});
        if (inventory.diagnostics.issue.length > 0) {
            inventory.diagnostics.issue.forEach(diagnostic => input.stderr(`${module.name}:${diagnostic.path}: ${diagnostic.message}`));
            return 1;
        }
        const text = new Map(inventory.migration.issueDocuments.map(document => [document.sourceKey, document.text]));
        moduleIssues[module.name] = inventory.records.issue.map(record => ({path: record.sourceKey, record, text: text.get(record.sourceKey) ?? ''}));
    }
    const synchronized = synchronizeApplicationIssues({moduleIssues, applicationIssues: indexedApplicationIssues, applicationName: context.name});
    if (synchronized.status !== 'succeeded') {
        synchronized.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
        return 1;
    }
    const openFilesystem = input.dependencies?.openFilesystem ?? createScopedFilesystem;
    const opened = await openFilesystem({root: input.repositoryRoot});
    if (opened.status !== 'succeeded') {
        input.stderr('The Application Repository filesystem could not be opened.');
        return 1;
    }
    const operations = synchronized.replacements.map(replacement => {
        const current = indexed.baselines.get(replacement.path);
        if (current === undefined) throw new Error('Application Sync index baseline is unavailable.');
        return {
            bytes: replacement.bytes,
            expected: {hash: createHash('sha256').update(current).digest('hex'), kind: /** @type {'file'} */ ('file')},
            kind: /** @type {'replace'} */ ('replace'),
            path: replacement.path,
        };
    });
    const prepared = await preflightFileTransaction({filesystem: opened.scopedFilesystem, operations});
    if (prepared.status !== 'succeeded') {
        prepared.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
        return 1;
    }
    const applied = await applyFileTransaction(prepared.preparedTransaction);
    if (applied.status !== 'succeeded') {
        if (applied.status === 'failed') input.stderr(`Application sync failed at stage: ${applied.stage}.`);
        applied.diagnostics.forEach((/** @type {{message: string}} */ diagnostic) => input.stderr(diagnostic.message));
        if ('completedOperations' in applied && Array.isArray(applied.completedOperations)) {
            for (const operation of applied.completedOperations) {
                input.stderr(`Application sync completed operation: kind=${operation.kind} path=${operation.path}.`);
            }
        }
        if ('rollback' in applied && Array.isArray(applied.rollback)) {
            for (const recovery of applied.rollback) {
                input.stderr(`Application sync rollback: path=${recovery.path} status=${recovery.status}.`);
            }
        }
        return 1;
    }
    input.stdout(`Application sync completed. Updated ${synchronized.replacements.length} Application Source Issue(s).`);
    return 0;
};

/** @param {ApplicationJiraCommandInput} input @param {ApplicationLeaderContext} context */
const runApplicationAssociateCommand = async (input, context) => {
    const command = /** @type {Extract<ApplicationJiraCommand, {kind: 'application-associate'}>} */ (input.command);
    const module = context.modules[command.moduleName];
    if (module === undefined) {
        input.stderr(`Configured Application Module not found: ${command.moduleName}.`);
        return 1;
    }
    const submoduleGit = input.dependencies?.submoduleGit ?? createSubmoduleGitAdapter();
    if (typeof submoduleGit.inspectConvergence !== 'function') throw new TypeError('Application associate requires Git preflight support.');
    for (const configuredModule of Object.values(context.modules)) {
        const inspected = await submoduleGit.inspectConvergence({
            branch: context.submodule.distributionBranch,
            module: configuredModule.name,
            repositoryRoot: configuredModule.repositoryRoot,
        });
        if (inspected.status !== 'succeeded') {
            inspected.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
            return 1;
        }
        if (inspected.state.branch !== context.submodule.distributionBranch) {
            input.stderr(`Configured Module ${configuredModule.name} must be on branch ${context.submodule.distributionBranch}.`);
            return 1;
        }
    }
    const applicationGit = createNodeGitRunner(input.repositoryRoot);
    const applicationInventory = await readArtifactInventory({root: input.repositoryRoot, scratchDirectory: join(input.repositoryRoot, '.scratch')});
    if (applicationInventory.diagnostics.issue.length > 0) {
        applicationInventory.diagnostics.issue.forEach(diagnostic => input.stderr(`${diagnostic.path}: ${diagnostic.message}`));
        return 1;
    }
    const applicationText = new Map(applicationInventory.migration.issueDocuments.map(document => [document.sourceKey, document.text]));
    /** @type {Record<string, AssociationSnapshot[]>} */
    const moduleIssues = {};
    /** @type {Record<string, string[]>} */
    const frozenModulePaths = {};
    /** @type {Map<string, {git: ReturnType<typeof createNodeGitRunner>, repositoryRoot: string}>} */
    const moduleRepositories = new Map();
    for (const configuredModule of Object.values(context.modules)) {
        const moduleGit = createNodeGitRunner(configuredModule.repositoryRoot);
        const inventory = await readArtifactInventory({root: configuredModule.repositoryRoot, scratchDirectory: join(configuredModule.repositoryRoot, '.scratch')});
        if (inventory.diagnostics.issue.length > 0) {
            inventory.diagnostics.issue.forEach(diagnostic => input.stderr(`${diagnostic.path}: ${diagnostic.message}`));
            return 1;
        }
        const moduleText = new Map(inventory.migration.issueDocuments.map(document => [document.sourceKey, document.text]));
        const snapshots = inventory.records.issue.map(record => ({path: record.sourceKey, record, text: moduleText.get(record.sourceKey) ?? ''}));
        const frozen = await readFrozenAssociationPaths({git: moduleGit, repositoryRoot: configuredModule.repositoryRoot, snapshots});
        if (frozen.status !== 'succeeded') {
            frozen.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
            return 1;
        }
        moduleIssues[configuredModule.name] = snapshots;
        frozenModulePaths[configuredModule.name] = frozen.paths;
        moduleRepositories.set(configuredModule.name, {git: moduleGit, repositoryRoot: configuredModule.repositoryRoot});
    }
    const associated = associateApplicationIssue({
        frozenModulePaths,
        moduleIssueId: command.moduleIssueId,
        moduleIssues,
        moduleName: module.name,
        applicationIssueId: command.applicationIssueId,
        applicationIssues: applicationInventory.records.issue.map(record => ({path: record.sourceKey, record, text: applicationText.get(record.sourceKey) ?? ''})),
        applicationName: context.name,
    });
    if (associated.status !== 'succeeded') {
        associated.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
        return 1;
    }
    /** @type {Map<string, typeof associated.replacements>} */
    const replacementsByRepository = new Map();
    for (const replacement of associated.replacements) {
        const replacements = replacementsByRepository.get(replacement.repository) ?? [];
        replacements.push(replacement);
        replacementsByRepository.set(replacement.repository, replacements);
    }
    const repositoryOrder = [...Object.keys(context.modules), 'application'].filter(name => replacementsByRepository.has(name));
    /** @type {Array<{baselines: Map<string, Buffer>, filesystem: Extract<Awaited<ReturnType<typeof createScopedFilesystem>>, {status: 'succeeded'}>['scopedFilesystem'], name: string, preparedTransaction: Parameters<typeof applyFileTransaction>[0], replacements: Array<{bytes: Buffer, path: string, repository: string}>}>} */
    const preparedRepositories = [];
    const openFilesystem = input.dependencies?.openFilesystem ?? createScopedFilesystem;
    for (const name of repositoryOrder) {
        const replacements = replacementsByRepository.get(name) ?? [];
        const repository = name === 'application'
            ? {git: applicationGit, repositoryRoot: input.repositoryRoot}
            : moduleRepositories.get(name);
        if (repository === undefined) throw new Error(`Association Repository is unavailable: ${name}.`);
        const effortPaths = [...new Set(replacements.map(replacement => {
            const match = /^(\.scratch\/[a-z0-9][a-z0-9-]*)\//u.exec(replacement.path);
            if (match === null) throw new Error(`Association replacement is outside an effort: ${replacement.path}.`);
            return match[1];
        }))].sort();
        for (const effortPath of effortPaths) {
            const workingBaseline = await verifyEffortWorkingBaseline({git: repository.git, path: effortPath, repositoryRoot: repository.repositoryRoot});
            if (workingBaseline.status !== 'succeeded') {
                workingBaseline.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
                return 1;
            }
        }
        const baselines = await readIndexBaselines({git: repository.git, paths: replacements.map(replacement => replacement.path), repositoryRoot: repository.repositoryRoot});
        if (baselines.status !== 'succeeded') {
            baselines.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
            return 1;
        }
        const opened = await openFilesystem({root: repository.repositoryRoot});
        if (opened.status !== 'succeeded') {
            input.stderr(`Association Repository filesystem could not be opened: ${name}.`);
            return 1;
        }
        const prepared = await preflightFileTransaction({
            filesystem: opened.scopedFilesystem,
            operations: replacements.map(replacement => {
                const current = baselines.baselines.get(replacement.path);
                if (current === undefined) throw new Error('Association index baseline is unavailable.');
                return {
                    bytes: replacement.bytes,
                    expected: {hash: createHash('sha256').update(current).digest('hex'), kind: /** @type {'file'} */ ('file')},
                    kind: /** @type {'replace'} */ ('replace'),
                    path: replacement.path,
                };
            }),
        });
        if (prepared.status !== 'succeeded') {
            prepared.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
            return 1;
        }
        preparedRepositories.push({baselines: baselines.baselines, filesystem: opened.scopedFilesystem, name, preparedTransaction: prepared.preparedTransaction, replacements});
    }
    const appliedRepositories = [];
    for (const prepared of preparedRepositories) {
        const applied = await applyFileTransaction(prepared.preparedTransaction);
        if (applied.status === 'succeeded') {
            appliedRepositories.push(prepared);
            continue;
        }
        applied.diagnostics.forEach((/** @type {{message: string}} */ diagnostic) => input.stderr(diagnostic.message));
        if ('rollback' in applied && Array.isArray(applied.rollback)) {
            for (const recovery of applied.rollback) {
                input.stderr(`Association transaction recovery: repository=${prepared.name} path=${recovery.path} status=${recovery.status}.`);
            }
        }
        const recoveryRepositories = applied.status === 'failed'
            ? [...appliedRepositories, prepared]
            : appliedRepositories;
        for (const prior of [...recoveryRepositories].reverse()) {
            for (const replacement of prior.replacements) {
                const original = prior.baselines.get(replacement.path);
                if (original === undefined) continue;
                const restored = await prior.filesystem.write({bytes: original, mode: 'replace', path: replacement.path});
                input.stderr(`Association recovery: repository=${prior.name} path=${replacement.path} status=${restored.status === 'succeeded' ? 'restored' : 'failed'}.`);
            }
        }
        return 1;
    }
    input.stdout(`Application association completed: ${command.applicationIssueId} -> ${module.name}:${command.moduleIssueId}.`);
    return 0;
};

/** @param {ApplicationJiraCommandInput} input @param {ApplicationLeaderContext} context */
const runJiraOpenCommand = async (input, context) => {
    const command = /** @type {Extract<ApplicationJiraCommand, {kind: 'jira-open'}>} */ (input.command);
    const url = new URL(`browse/${encodeURIComponent(command.issueKey)}`, context.jira.baseUrl).href;
    const openBrowser = input.dependencies?.openBrowser ?? createDefaultBrowserAdapter().open;
    const result = await openBrowser(url);
    if (result.status === 'succeeded') return 0;
    const message = result.diagnostics[0]?.message ?? 'The default browser could not be started.';
    input.stderr(`${message} Open manually: ${url}`);
    return 1;
};

/** @param {ApplicationJiraCommandInput} input @param {ApplicationLeaderContext} context @param {ReturnType<typeof createNodeGitRunner>} git @param {Parameters<typeof createJiraClient>[0]['request']} request */
const runJiraSyncCommand = async (input, context, git, request) => {
    const command = /** @type {Extract<ApplicationJiraCommand, {kind: 'jira-sync'}>} */ (input.command);
    const specIdentity = parseCanonicalArtifactId(command.specId);
    const committed = await loadCommittedApplicationEffort({effortNumber: specIdentity.effortNumber, git, repositoryRoot: input.repositoryRoot});
    if (committed.status !== 'succeeded') {
        committed.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
        return 1;
    }
    const issues = readIssueDocuments(committed.documents);
    if (issues.diagnostics.length > 0) {
        issues.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
        return 1;
    }
    const completion = evaluateApplicationCompletion({
        issues: issues.records,
        jiraBaseUrl: context.jira.baseUrl,
        phase: command.phase,
        applicationName: context.name,
        specId: command.specId,
        specText: committed.specText,
    });
    if (completion.status !== 'succeeded') {
        completion.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
        return 1;
    }
    if (!completion.eligible) {
        input.stderr(`Application effort ${command.specId} is not eligible for JIRA ${command.phase}.`);
        return 1;
    }
    const proof = await proveUpstreamEffort({effortPath: committed.effortPath, git, repositoryRoot: input.repositoryRoot});
    if (proof.status !== 'succeeded') {
        proof.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
        return 1;
    }
    const comment = command.phase === 'accepted'
        ? `ARW synchronization\nPhase: accepted\nApplication: ${completion.applicationName}\nSpec: ${completion.specId}\n\n此 JIRA issue 已被上述 application repository 接收.`
        : `ARW synchronization\nPhase: completed\nApplication: ${completion.applicationName}\nSpec: ${completion.specId}\n\n该本地 effort 已完成产品级验证.`;
    const adapter = createJiraConvergenceAdapter({baseUrl: context.jira.baseUrl, request});
    const convergence = await convergeJiraIssue({
        comment,
        issueKey: completion.jiraKey,
        issueType: context.jira.issueType,
        jira: adapter,
        phase: command.phase,
        projectKey: context.jira.projectKey,
        sourceStatus: command.phase === 'accepted' ? context.jira.candidateStatus : context.jira.acceptedStatus,
        targetStatus: command.phase === 'accepted' ? context.jira.acceptedStatus : context.jira.completedStatus,
    });
    if (convergence.status !== 'succeeded') {
        convergence.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
        return 1;
    }
    input.stdout(`JIRA synchronization: issue=${completion.jiraKey} phase=${command.phase} comment=${convergence.commentAction} status=${convergence.statusAction}`);
    return 0;
};

/** @param {ApplicationJiraCommandInput} input @param {ApplicationLeaderContext} context @param {ReturnType<typeof createJiraClient>} client */
const runJiraPrintCommand = async (input, context, client) => {
    const command = /** @type {Extract<ApplicationJiraCommand, {kind: 'jira-print'}>} */ (input.command);
    const result = await client.printIssue({baseUrl: context.jira.baseUrl, issueKey: command.issueKey});
    if (result.status !== 'succeeded') {
        result.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
        return 1;
    }
    input.rawStdout(`${JSON.stringify(result.value, null, 2)}\n`);
    return 0;
};

/** @param {ApplicationJiraCommandInput} input @param {ApplicationLeaderContext} context @param {ReturnType<typeof createJiraClient>} client */
const runJiraListCommand = async (input, context, client) => {
    const command = /** @type {Extract<ApplicationJiraCommand, {kind: 'jira-list'}>} */ (input.command);
    const limit = command.limit ?? input.globalConfig.jira?.listLimit;
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit <= 0) {
        input.stderr('Global jira.listLimit configuration is required for JIRA list.');
        return 1;
    }
    const result = await client.listCandidates({jira: context.jira, limit});
    if (result.status !== 'succeeded') {
        result.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
        return 1;
    }
    input.stdout(renderJiraList(result));
    return 0;
};

/** @param {ApplicationJiraCommandInput} input @param {ApplicationLeaderContext} context @param {ReturnType<typeof createNodeGitRunner> | undefined} git */
const runJiraRestCommand = async (input, context, git) => {
    let request = input.dependencies?.request;
    if (request === undefined) {
        const token = input.dependencies?.token ?? process.env.JIRA_ACCESS_TOKEN;
        if (typeof token !== 'string' || token.length === 0) {
            input.stderr('JIRA_ACCESS_TOKEN is required for JIRA REST commands.');
            return 1;
        }
        request = createJiraHttpRequest({token});
    }
    if (input.command.kind === 'jira-sync') {
        if (git === undefined) throw new Error('JIRA synchronization Git runner is unavailable.');
        return runJiraSyncCommand(input, context, git, request);
    }
    const client = createJiraClient({request});
    return input.command.kind === 'jira-print'
        ? runJiraPrintCommand(input, context, client)
        : runJiraListCommand(input, context, client);
};

/** @param {ApplicationJiraCommandInput} input */
export const runApplicationJiraCommand = async input => {
    if (input.command.kind === 'module-check-correction') return runModuleCorrectionCheckCommand(input);
    const git = input.command.kind === 'jira-sync'
        ? input.dependencies?.git ?? createNodeGitRunner(input.repositoryRoot)
        : undefined;
    const configuration = input.command.kind === 'jira-sync'
        ? await loadCommittedApplicationConfiguration({git, repositoryRoot: input.repositoryRoot})
        : await loadRepositoryConfiguration({repositoryRoot: input.repositoryRoot});
    if (configuration.status !== 'succeeded') {
        configuration.diagnostics.forEach(diagnostic => input.stderr(diagnostic.message));
        return 1;
    }
    if (configuration.context.role === 'member') {
        input.stderr(['submodule-switch-branch', 'application-sync', 'application-associate'].includes(input.command.kind)
            ? `Application configuration is required for ${input.command.kind === 'application-sync' ? 'application sync' : input.command.kind === 'application-associate' ? 'application associate' : 'submodule switch-branch'}.`
            : `Application configuration is required for JIRA ${input.command.kind.slice('jira-'.length)}.`);
        return 1;
    }
    if (input.command.kind === 'submodule-switch-branch') {
        return runSubmoduleSwitchBranchCommand(input, configuration.context);
    }
    if (input.command.kind === 'application-sync') {
        return runApplicationSyncCommand(input, configuration.context);
    }
    if (input.command.kind === 'application-associate') {
        return runApplicationAssociateCommand(input, configuration.context);
    }
    if (input.command.kind === 'jira-open') {
        return runJiraOpenCommand(input, configuration.context);
    }
    return runJiraRestCommand(input, configuration.context, git);
};
