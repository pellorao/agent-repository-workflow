import * as nodeFileSystem from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';

import {readArtifactInventory} from '../arw-common/artifacts.mjs';
import {findUnfencedPrefixedLines, migrateIssueDocuments} from '../arw-common/issue-documents.mjs';
import {createScopedFilesystem, joinRelativePath} from '../common/filesystem.mjs';
import {createNodeGitRunner} from '../common/git-process.mjs';
import {compareText} from '../common/json.mjs';

/** @typedef {Awaited<ReturnType<typeof readArtifactInventory>>} ArtifactInventory */
/** @typedef {ArtifactInventory['migration']['issueDocuments'][number]} IssueDocument */
/** @typedef {ReturnType<typeof migrateIssueDocuments>['outputs'][number]} IssueOutput */
/** @typedef {{input: IssueDocument, output: IssueOutput}} IssueMigrationPair */
/** @typedef {{message: string, path: string}} MigrationDiagnostic */
/** @typedef {{kind: 'write', path: string, relativePath: string, text: string} | {kind: 'rename', path: string, relativePath: string, targetPath: string, targetRelativePath: string}} MigrationOperation */
/** @typedef {{diagnostics: MigrationDiagnostic[], operations: MigrationOperation[]}} MigrationPlan */
/** @typedef {{lstat: (path: string) => Promise<{isDirectory: () => boolean, isFile: () => boolean, isSymbolicLink: () => boolean}>, rename: (source: string, target: string) => Promise<void>, rm: (path: string, options: {force: true}) => Promise<void>, writeFile: (path: string, contents: string, encoding: 'utf8') => Promise<void>}} MigrationFilesystem */
/** @typedef {{run: (input: {argv: string[]}) => Promise<{code: number | null, failure: 'process' | 'timeout' | null, stderr: string, stdout: Buffer}>}} MigrationGit */

const normalizeText = (/** @type {string} */ text) => text.replace(/\r\n?/g, '\n');
const hasReadableFirstHeading = (/** @type {string} */ text) => {
    const lines = normalizeText(text).split('\n');
    const hasFrontmatter = lines[0]?.trim() === '---';
    const frontmatterEnd = hasFrontmatter
        ? lines.findIndex((/** @type {string} */ line, /** @type {number} */ index) => index > 0 && line.trim() === '---')
        : -1;

    if (hasFrontmatter && frontmatterEnd < 0) {
        throw new Error('YAML frontmatter is not closed.');
    }

    let fenced = false;

    for (let index = frontmatterEnd + 1; index < lines.length; index += 1) {
        if (/^\s*(```|~~~)/.test(lines[index])) {
            fenced = !fenced;
            continue;
        }

        if (!fenced && /^# (.+?)\s*$/.test(lines[index])) {
            return true;
        }
    }

    return false;
};

const isActiveImplementationIssue = (/** @type {string} */ text) => {
    if (findUnfencedPrefixedLines(text, 'Type:').indexes.length > 0) {
        return false;
    }
    const {indexes, lines} = findUnfencedPrefixedLines(text, 'Status: ');
    const status = indexes.length === 0 ? '' : lines[indexes[0]].slice('Status: '.length).replace(/\r$/u, '');
    return Boolean(status && !['completed', 'wontfix'].includes(status));
};

const runGitText = async (/** @type {MigrationGit} */ git, /** @type {string[]} */ argv, /** @type {string} */ failureMessage) => {
    const result = await git.run({argv});
    if (result.failure !== null || result.code !== 0) throw new Error(failureMessage);
    try {
        return new TextDecoder('utf-8', {fatal: true}).decode(result.stdout).trim();
    } catch {
        throw new Error(failureMessage);
    }
};

const compareUtf8 = (/** @type {string} */ left, /** @type {string} */ right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));

const planEffortNumbers = async (/** @type {ArtifactInventory} */ inventory, /** @type {MigrationGit} */ git) => {
    const assignments = new Map();
    const occupied = new Set();
    /** @type {MigrationDiagnostic[]} */
    const diagnostics = [];
    const unnumbered = [];

    for (const directory of inventory.migration.effortDirectories) {
        if (!directory.migratable || directory.slug === null) continue;
        if (directory.number !== null) {
            occupied.add(directory.number);
            assignments.set(directory.name, {number: directory.number, targetName: directory.name});
        } else {
            unnumbered.push(directory);
        }
    }
    if (unnumbered.length === 0) return {assignments, diagnostics};

    let commits;
    try {
        const shallow = await runGitText(git, ['rev-parse', '--is-shallow-repository'], 'Repository history completeness could not be determined.');
        if (shallow !== 'false') throw new Error('Shallow Repository history cannot assign persistent effort numbers.');
        commits = (await runGitText(git, ['rev-list', '--reverse', '--topo-order', 'HEAD'], 'Current HEAD history could not be read.'))
            .split('\n')
            .filter(Boolean);
    } catch (error) {
        return {
            assignments,
            diagnostics: unnumbered.map(directory => ({message: error instanceof Error ? error.message : String(error), path: directory.path})),
        };
    }
    const commitOrder = new Map(commits.map((commit, index) => [commit, index]));
    const observations = [];
    for (const directory of unnumbered) {
        try {
            await runGitText(git, ['cat-file', '-e', `HEAD:.scratch/${directory.name}`], 'Effort is not committed in current HEAD.');
            const history = (await runGitText(
                git,
                ['rev-list', '--reverse', '--topo-order', 'HEAD', '--', `.scratch/${directory.name}`],
                'Effort creation history could not be read.',
            )).split('\n').filter(Boolean);
            const commit = history[0];
            const order = commit === undefined ? undefined : commitOrder.get(commit);
            if (commit === undefined || order === undefined) throw new Error('Effort has no provable first reachable commit in current HEAD.');
            const timestampText = await runGitText(git, ['show', '-s', '--format=%ct', commit], 'Effort committer timestamp could not be read.');
            if (!/^\d+$/.test(timestampText)) throw new Error('Effort committer timestamp is malformed.');
            observations.push({commit, directory, order, timestamp: Number(timestampText)});
        } catch (error) {
            diagnostics.push({message: error instanceof Error ? error.message : String(error), path: directory.path});
        }
    }
    observations.sort((left, right) => left.timestamp - right.timestamp
        || left.order - right.order
        || compareUtf8(left.directory.slug ?? '', right.directory.slug ?? ''));

    let candidate = 1;
    for (const {directory} of observations) {
        while (candidate <= 9999 && occupied.has(String(candidate).padStart(4, '0'))) candidate += 1;
        if (candidate > 9999) {
            diagnostics.push({message: 'Effort number space is exhausted.', path: directory.path});
            continue;
        }
        const number = String(candidate).padStart(4, '0');
        occupied.add(number);
        assignments.set(directory.name, {number, targetName: `${number}-${directory.slug}`});
        candidate += 1;
    }
    return {assignments, diagnostics};
};

const rewriteStructuredRequirementPaths = (/** @type {string} */ text, /** @type {Map<string, {number: string, targetName: string}>} */ assignments) => {
    const lines = normalizeText(text).split('\n');
    let inRequirement = false;
    let changed = false;
    const rewritten = lines.map(line => {
        if (line === '## Spec Requirement') {
            inRequirement = true;
            return line;
        }
        if (inRequirement && /^## /.test(line)) inRequirement = false;
        if (!inRequirement) return line;
        const match = /^(- `\.scratch\/)([^/]+)(\/[^`]*`)$/.exec(line);
        const target = match ? assignments.get(match[2]) : undefined;
        if (!match || target === undefined || match[2] === target.targetName) return line;
        changed = true;
        return `${match[1]}${target.targetName}${match[3]}`;
    });
    return {changed, text: changed ? rewritten.join('\n') : text};
};

/** @param {{root: string, scratchDirectory: string}} repository @param {MigrationFilesystem} [fileSystem] @param {Parameters<typeof readArtifactInventory>[1]} [inventoryFilesystem] @returns {Promise<MigrationPlan>} */
const createUpdatePlan = async (repository, fileSystem = nodeFileSystem, inventoryFilesystem = undefined, git = createNodeGitRunner(repository.root)) => {
    let scopedFilesystem = inventoryFilesystem;
    if (scopedFilesystem === undefined) {
        const created = await createScopedFilesystem({root: repository.root});
        if (created.status !== 'succeeded') throw new Error('The Repository filesystem could not be opened.');
        scopedFilesystem = created.scopedFilesystem;
    }
    const inventory = await readArtifactInventory(repository, scopedFilesystem);
    const diagnostics = [...inventory.migration.diagnostics];
    const numbering = await planEffortNumbers(inventory, git);
    diagnostics.push(...numbering.diagnostics);
    /** @type {MigrationOperation[]} */
    const operations = [];
    /** @type {Map<string, IssueDocument[]>} */
    const issueDocumentsByEffort = new Map();
    /** @type {Map<string, IssueMigrationPair[]>} */
    const issueOutputsByEffort = new Map();

    for (const document of inventory.migration.issueDocuments) {
        const documents = issueDocumentsByEffort.get(document.effort) ?? [];
        documents.push(document);
        issueDocumentsByEffort.set(document.effort, documents);
    }

    for (const [effort, documents] of issueDocumentsByEffort) {
        const migration = migrateIssueDocuments(documents);
        const inputBySourceKey = new Map(documents.map(document => [document.sourceKey, document]));

        for (const diagnostic of migration.diagnostics) {
            diagnostics.push({message: diagnostic.message, path: diagnostic.sourceKey});
        }

        issueOutputsByEffort.set(effort, migration.outputs.map(output => {
            const input = inputBySourceKey.get(output.sourceKey);
            if (input === undefined) throw new Error(`Migration output has no input: ${output.sourceKey}.`);
            return {input, output};
        }));
    }

    const legacySpecsByEffort = new Map(inventory.migration.legacySpecs.map(source => [source.effort, source]));
    const efforts = [...new Set([
        ...inventory.migration.effortDirectories.filter(directory => directory.migratable).map(directory => directory.name),
        ...issueOutputsByEffort.keys(),
        ...legacySpecsByEffort.keys(),
    ])].sort((left, right) => {
        const leftNumber = numbering.assignments.get(left)?.number ?? '9999';
        const rightNumber = numbering.assignments.get(right)?.number ?? '9999';
        return compareText(leftNumber, rightNumber) || compareText(left, right);
    });

    for (const effort of efforts) {
        const issueOutputs = issueOutputsByEffort.get(effort) ?? [];
        const activeIssues = issueOutputs.filter(({output}) => isActiveImplementationIssue(output.text));
        const assignment = numbering.assignments.get(effort);

        if (activeIssues.length > 0) {
            for (const {input, output} of activeIssues) {
                if (!output.text.includes('\n## Spec Requirement\n')) {
                    diagnostics.push({
                        message: 'Active implementation issue requires a manual ## Spec Requirement before migration.',
                        path: input.relativePath,
                    });
                }
            }

            const legacySpec = legacySpecsByEffort.get(effort);
            if (legacySpec && !legacySpec.text.includes('\n## Module Design\n')) {
                diagnostics.push({
                    message: 'Active governing spec requires a manual ## Module Design before migration.',
                    path: legacySpec.relativePath,
                });
            }

            for (const {input} of activeIssues) {
                const readinessPath = joinRelativePath('.scratch', effort, 'issues', `${input.number}.spec-readiness.json`);
                if (!inventory.paths.some(observation => observation.relativePath === readinessPath)) {
                    diagnostics.push({
                        message: 'Active implementation issue requires a manually generated Spec Readiness record.',
                        path: readinessPath,
                    });
                }
            }
        }

        for (const {input, output} of issueOutputs) {
            const rewritten = rewriteStructuredRequirementPaths(output.text, numbering.assignments);
            if (output.changed || rewritten.changed) {
                operations.push({kind: 'write', path: input.path, relativePath: input.relativePath, text: rewritten.text});
            }
        }

        const legacySpec = legacySpecsByEffort.get(effort);
        if (legacySpec) {
            try {
                if (inventory.paths.some(observation => observation.relativePath === legacySpec.targetRelativePath)) {
                    throw new Error('Legacy PRD conflicts with an existing spec.md.');
                }

                if (!hasReadableFirstHeading(legacySpec.text)) {
                    throw new Error('Legacy PRD has no readable first level-one heading.');
                }

                operations.push({
                    kind: 'rename',
                    path: legacySpec.path,
                    relativePath: legacySpec.relativePath,
                    targetPath: legacySpec.targetPath,
                    targetRelativePath: legacySpec.targetRelativePath,
                });
            } catch (error) {
                diagnostics.push({message: error instanceof Error ? error.message : String(error), path: legacySpec.relativePath});
            }
        }

        if (assignment !== undefined && assignment.targetName !== effort) {
            const targetPath = join(repository.scratchDirectory, assignment.targetName);
            try {
                await fileSystem.lstat(targetPath);
                diagnostics.push({message: 'Numbered effort target already exists.', path: `.scratch/${assignment.targetName}`});
            } catch (error) {
                if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
            }
            operations.push({
                kind: 'rename',
                path: join(repository.scratchDirectory, effort),
                relativePath: `.scratch/${effort}`,
                targetPath,
                targetRelativePath: `.scratch/${assignment.targetName}`,
            });
        }
    }

    return {diagnostics: diagnostics.sort((left, right) => compareText(left.path, right.path)), operations};
};

/** @param {Extract<MigrationOperation, {kind: 'write'}>} operation @param {MigrationFilesystem} fileSystem @param {number} index */
const applyWrite = async (operation, fileSystem, index) => {
    const temporaryPath = join(dirname(operation.path), `.${basename(operation.path)}.arw-${process.pid}-${index}.tmp`);

    try {
        await fileSystem.writeFile(temporaryPath, operation.text, 'utf8');
        await fileSystem.rename(temporaryPath, operation.path);
    } catch (error) {
        await fileSystem.rm(temporaryPath, {force: true}).catch(() => {});
        throw error;
    }
};

/**
 * 对当前 Repository 的完整 `.scratch` 执行确定性升级。函数先建立完整 plan, 只要预检存在任一 diagnostic 就不写入; 预检成功后逐项原子替换 issue 并重命名 PRD。
 * `fileSystem` 用于测试注入 I/O 失败。apply 中途失败时停止后续操作, 通过 stderr 分别列出已完成和未完成路径, 使下一次运行可从磁盘的实际状态继续。
 */
export const runArtifactMigration = async (/** @type {{ root: string; scratchDirectory: string; }} */ repository, /** @type {(arg0: string) => void} */ stdout, /** @type {(arg0: string) => void} */ stderr, /** @type {MigrationFilesystem} */ fileSystem = nodeFileSystem, /** @type {Parameters<typeof readArtifactInventory>[1]} */ inventoryFilesystem = undefined, /** @type {MigrationGit} */ git = createNodeGitRunner(repository.root)) => {
    const plan = await createUpdatePlan(repository, fileSystem, inventoryFilesystem, git);

    if (plan.diagnostics.length > 0) {
        for (const diagnostic of plan.diagnostics) {
            stderr(`Cannot update ${diagnostic.path}: ${diagnostic.message}`);
        }
        stderr('Convert the listed files manually, then run `arw migrate artifacts` again.');
        return 1;
    }

    if (plan.operations.length === 0) {
        stdout('No updates needed.');
        return 0;
    }

    /** @type {MigrationOperation[]} */
    const completed = [];

    for (const [index, operation] of plan.operations.entries()) {
        try {
            if (operation.kind === 'write') {
                await applyWrite(operation, fileSystem, index);
                stdout(`Updated ${operation.relativePath}`);
            } else {
                await fileSystem.rename(operation.path, operation.targetPath);
                stdout(`Renamed ${operation.relativePath} -> ${operation.targetRelativePath}`);
            }
            completed.push(operation);
        } catch (error) {
            stderr(`Update failed at ${operation.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
            stderr(`Completed: ${completed.length === 0 ? 'None' : completed.map(item => item.relativePath).join(', ')}`);
            stderr(`Not completed: ${plan.operations.slice(completed.length).map(item => item.relativePath).join(', ')}`);
            return 1;
        }
    }

    stdout(`Updated ${completed.length} paths.`);
    return 0;
};
