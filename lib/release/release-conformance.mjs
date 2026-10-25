import {evaluateLanguageChecks} from '../arw-common/language-checks.mjs';
import {execFile as execFileCallback} from 'node:child_process';
import {lstat, readdir} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {promisify} from 'node:util';

import {assertExactKeys, assertSafePath, assertString} from '../common/canonical-contract.mjs';
import {joinRelativePath} from '../common/filesystem.mjs';
import {renderLanguageChecks} from '../arw-common/language-composition-presentation.mjs';
import {checkDocumentTerms as checkRepositoryDocumentTerms, serializeDocumentTermsDiagnostic} from '../document-terms/document-terms.mjs';
import {resolveReleaseCandidate} from './release-candidate.mjs';
import {verifyReleaseEvidenceArchive} from './release-evidence-archive.mjs';
import {listPreTagArchiveKinds} from './release-validation-registry.mjs';

const execFile = promisify(execFileCallback);
const PHASES = new Set(['pre-tag', 'post-tag']);
const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const DIAGNOSTIC_STAGE_ORDER = ['input', 'ownership', 'repository', 'archive', 'validation', 'runtime'];
/** @typedef {'input' | 'ownership' | 'repository' | 'archive' | 'validation' | 'runtime'} DiagnosticStage */
/** @typedef {{code: string, identity: string, message: string, path: string, stage: DiagnosticStage}} ConformanceDiagnostic */
/** @typedef {{chinese: number | null, english: number | null, other: number | null, path: string}} LanguageComposition */
/** @typedef {{diagnostics: ConformanceDiagnostic[], documentTerms: DocumentTermsResult | null, languageComposition: LanguageComposition[], status: 'failed'}} FailedResult */
/** @typedef {{exitCode: number, stderr: string, stdout: string}} CommandResult */
/** @typedef {(file: string, args: string[], options: {cwd?: string, env?: NodeJS.ProcessEnv, input?: Buffer | string}) => Promise<CommandResult>} CommandRunner */
/** @typedef {(input: unknown) => Promise<unknown>} TermsChecker */
/** @typedef {(input: {archiveKind: string, archivePath: string, sourceDirectory?: string | null}) => Promise<unknown>} ArchiveVerifier */
/** @typedef {{baseline: {commit: string | null, kind: 'empty-tree' | 'stable-tag', tag: string | null, tree: string}, changedPaths: string[], commit: string, tree: string, version: string}} ReleaseCandidate */
/** @typedef {{candidate: ReleaseCandidate, repositoryRoot: string}} SourceCheckout */
/** @typedef {{column?: number, line?: number, path: string}} TermsLocator */
/** @typedef {{code: string, column?: number, line?: number, name?: string, path: string, related?: TermsLocator[]}} TermsDiagnostic */
/** @typedef {{context: string, diagnostics: TermsDiagnostic[], status: 'failed' | 'passed', summary: {diagnostics: number, documents: number, globalTerms: number, localTerms: number, uses: number}}} DocumentTermsContext */
/** @typedef {{contexts: DocumentTermsContext[], diagnostics: TermsDiagnostic[], languageComposition: LanguageComposition[], languageChecks: import('../arw-common/language-checks.mjs').LanguageChecksResult, source: {mode: 'release', source: {candidateTree: string, kind: 'candidate-tree'}}, status: 'failed' | 'passed'}} DocumentTermsResult */
/** @typedef {{sourceCheckout: SourceCheckout, status: 'resolved'} | FailedResult} CandidateResolution */
/** @typedef {{candidateVersion: string, documentTerms: DocumentTermsResult | null, languageComposition: LanguageComposition[], phase: 'pre-tag' | 'post-tag', status: 'passed', tagAllowed: boolean} | FailedResult} ConformanceCliResult */
/** @returns {value is Record<string, unknown>} */
const isRecord = (/** @type {unknown} */ value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @returns {value is DiagnosticStage} */
const isDiagnosticStage = (/** @type {unknown} */ value) => typeof value === 'string' && DIAGNOSTIC_STAGE_ORDER.includes(value);
const compareText = (/** @type {string | number} */ left, /** @type {string | number} */ right) => left < right ? -1 : left > right ? 1 : 0;

const createDiagnostic = (/** @type {{code: string, identity?: string, message: string, path: string, stage: DiagnosticStage}} */ {code, identity = '', message, path, stage}) => ({
    code,
    identity,
    message,
    path: path.replaceAll('\\', '/'),
    stage,
});
const compareDiagnostic = (/** @type {ConformanceDiagnostic} */ left, /** @type {ConformanceDiagnostic} */ right) => (
    DIAGNOSTIC_STAGE_ORDER.indexOf(left.stage) - DIAGNOSTIC_STAGE_ORDER.indexOf(right.stage)
    || compareText(left.path, right.path)
    || compareText(left.code, right.code)
    || compareText(left.identity, right.identity)
    || compareText(left.message, right.message)
);
/** @returns {FailedResult} */
const failedResult = (/** @type {ConformanceDiagnostic[]} */ diagnostics, /** @type {LanguageComposition[]} */ languageComposition = [], /** @type {DocumentTermsResult | null} */ documentTerms = null) => ({
    diagnostics: [...new Map(diagnostics.map(item => [JSON.stringify(item), item])).values()].sort(compareDiagnostic),
    languageComposition,
    documentTerms,
    status: 'failed',
});
const codeFromMessage = (/** @type {string} */ message) => message
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 80) || 'operation-failed';
const errorMessage = (/** @type {unknown} */ error) => error instanceof Error ? error.message : String(error);
const diagnosticFromError = (/** @type {unknown} */ error, /** @type {{code?: string, identity?: string, path: string, stage: DiagnosticStage}} */ fallback) => {
    const embedded = isRecord(error) && isRecord(error.diagnostic) ? error.diagnostic : {};
    return createDiagnostic({
    ...fallback,
    code: typeof embedded.code === 'string' ? embedded.code : fallback.code ?? codeFromMessage(errorMessage(error)),
    identity: typeof embedded.identity === 'string' ? embedded.identity : fallback.identity ?? '',
    message: errorMessage(error),
    });
};
const diagnosticError = (/** @type {string | undefined} */ message, /** @type {{ code: string; identity: string; }} */ diagnostic) => Object.assign(new Error(message), {diagnostic});

/** @type {CommandRunner} */
export const runReleaseConformanceCommand = async (file, args, {cwd, env, input} = {}) => {
    const isWindowsCommandShim = process.platform === 'win32' && ['npm', 'pnpm'].includes(file);
    const commandFile = isWindowsCommandShim
        ? process.env.ComSpec || 'cmd.exe'
        : file;
    const commandArgs = isWindowsCommandShim
        ? ['/d', '/s', '/c', `${file}.cmd`, ...args]
        : args;
    try {
        const result = await execFile(commandFile, commandArgs, {
            cwd,
            encoding: 'utf8',
            env,
            ...(input === undefined ? {} : {input}),
            windowsHide: true,
        });
        return {exitCode: 0, stderr: result.stderr, stdout: result.stdout};
    } catch (error) {
        if (!isRecord(error) || typeof error.code !== 'number') throw error;
        return {
            exitCode: error.code,
            stderr: typeof error.stderr === 'string' ? error.stderr : '',
            stdout: typeof error.stdout === 'string' ? error.stdout : '',
        };
    }
};

/**
 * @template T
 * @param {ConformanceDiagnostic[]} diagnostics
 * @param {{code: string, identity: string, path: string, stage: DiagnosticStage}} fallback
 * @param {() => Promise<T>} operation
 * @returns {Promise<{ok: true, value: T} | {ok: false}>}
 */
const captureDiagnostic = async (diagnostics, fallback, operation) => {
    try {
        return {ok: true, value: await operation()};
    } catch (error) {
        diagnostics.push(diagnosticFromError(error, fallback));
        return {ok: false};
    }
};
/** @type {(value: unknown, label: string) => asserts value is string[]} */
const assertSortedUniqueStrings = (value, label) => {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length === 0)) {
        throw new Error(`${label} must be an array of non-empty strings.`);
    }
    const sorted = [...value].sort(compareText);
    if (sorted.some((item, index) => item !== value[index]) || new Set(value).size !== value.length) {
        throw new Error(`${label} must be sorted and unique.`);
    }
};
/** @returns {SourceCheckout} */
const canonicalSourceCheckout = (/** @type {unknown} */ sourceCheckout) => {
    assertExactKeys(sourceCheckout, ['candidate', 'repositoryRoot'], 'Release conformance sourceCheckout');
    if (typeof sourceCheckout.repositoryRoot !== 'string' || !isAbsolute(sourceCheckout.repositoryRoot)) {
        throw new Error('Release conformance sourceCheckout Repository root must be absolute.');
    }
    const {candidate} = sourceCheckout;
    assertExactKeys(candidate, ['baseline', 'changedPaths', 'commit', 'tree', 'version'], 'Release conformance candidate');
    if (typeof candidate.commit !== 'string' || typeof candidate.tree !== 'string'
        || !OBJECT_ID_PATTERN.test(candidate.commit) || !OBJECT_ID_PATTERN.test(candidate.tree)) {
        throw new Error('Release conformance candidate object identity is invalid.');
    }
    if (typeof candidate.version !== 'string' || !STABLE_VERSION_PATTERN.test(candidate.version)) {
        throw new Error('Release conformance candidate version is invalid.');
    }
    assertSortedUniqueStrings(candidate.changedPaths, 'Release conformance candidate changedPaths');
    for (const path of candidate.changedPaths) assertSafePath(path, 'Release conformance candidate changed path');
    assertExactKeys(candidate.baseline, ['commit', 'kind', 'tag', 'tree'], 'Release conformance candidate baseline');
    if (typeof candidate.baseline.tree !== 'string' || !OBJECT_ID_PATTERN.test(candidate.baseline.tree)) throw new Error('Release conformance baseline tree is invalid.');
    if (candidate.baseline.kind === 'empty-tree') {
        if (candidate.baseline.commit !== null || candidate.baseline.tag !== null) {
            throw new Error('Release conformance empty-tree baseline is invalid.');
        }
    } else if (candidate.baseline.kind === 'stable-tag') {
        if (typeof candidate.baseline.commit !== 'string' || !OBJECT_ID_PATTERN.test(candidate.baseline.commit)
            || typeof candidate.baseline.tag !== 'string'
            || !STABLE_VERSION_PATTERN.test(candidate.baseline.tag)) {
            throw new Error('Release conformance stable-tag baseline is invalid.');
        }
    } else {
        throw new Error('Release conformance baseline kind is invalid.');
    }
    return {
        candidate: {
            baseline: {
                commit: candidate.baseline.commit,
                kind: candidate.baseline.kind,
                tag: candidate.baseline.tag,
                tree: candidate.baseline.tree,
            },
            changedPaths: candidate.changedPaths,
            commit: candidate.commit,
            tree: candidate.tree,
            version: candidate.version,
        },
        repositoryRoot: sourceCheckout.repositoryRoot,
    };
};
const archivePathFor = (/** @type {string} */ evidenceDirectory, /** @type {string} */ archiveKind) => (
    archiveKind === 'post-tag'
        ? join(evidenceDirectory, 'archives', 'post-tag.tar')
        : join(evidenceDirectory, 'archives', ...archiveKind.split('/')) + '.tar'
);
const archiveDiagnosticPath = (/** @type {string} */ archiveKind) => (
    joinRelativePath('archives', `${archiveKind}.tar`)
);
const isMissingFileError = (/** @type {unknown} */ error) => error instanceof Error && 'code' in error && error.code === 'ENOENT';

/** @returns {Promise<string[]>} */
const listArchiveArtifacts = async (/** @type {string} */ directory, /** @type {string} */ relativeDirectory = 'archives') => {
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try {
        entries = await readdir(directory, {withFileTypes: true});
    } catch (error) {
        if (isMissingFileError(error)) return [];
        throw error;
    }
    /** @type {string[]} */
    const paths = [];
    for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
        const relativePath = joinRelativePath(relativeDirectory, entry.name);
        if (entry.isDirectory()) {
            paths.push(...await listArchiveArtifacts(join(directory, entry.name), relativePath));
        } else if (entry.name.endsWith('.tar')) {
            paths.push(relativePath);
        }
    }
    return paths;
};

const inspectArchiveInventory = async (/** @type {{evidenceDirectory: string, phase: string}} */ {evidenceDirectory, phase}) => {
    const allowed = new Set([
        ...listPreTagArchiveKinds().map(archiveDiagnosticPath),
        ...(phase === 'post-tag' ? [archiveDiagnosticPath('post-tag')] : []),
    ]);
    let paths;
    try {
        paths = await listArchiveArtifacts(join(evidenceDirectory, 'archives'));
    } catch (error) {
        return [createDiagnostic({
            code: 'release-evidence-archive-inventory-failed',
            identity: 'archives',
            message: error instanceof Error ? error.message : String(error),
            path: 'archives',
            stage: 'archive',
        })];
    }
    return paths.filter((/** @type {string} */ path) => !allowed.has(path)).map(path => createDiagnostic({
        code: 'unexpected-release-evidence-archive',
        identity: path.slice('archives/'.length, -'.tar'.length),
        message: `Release evidence contains an unregistered archive: ${path}.`,
        path,
        stage: 'archive',
    }));
};

const verifyArchives = async (/** @type {{archiveKinds: string[], evidenceDirectory: string, verifyArchive: ArchiveVerifier}} */ {archiveKinds, evidenceDirectory, verifyArchive}) => {
    /** @type {ConformanceDiagnostic[]} */
    const diagnostics = [];
    for (const archiveKind of archiveKinds) {
        await captureDiagnostic(diagnostics, {
            code: 'invalid-release-evidence-archive',
            identity: archiveKind,
            path: archiveDiagnosticPath(archiveKind),
            stage: 'archive',
        }, async () => verifyArchive({
            archiveKind,
            archivePath: archivePathFor(evidenceDirectory, archiveKind),
        }));
    }
    return diagnostics;
};

const runRequiredCommand = async (/** @type {{args: string[], file: string, label: string, repositoryRoot: string, runCommand: CommandRunner}} */ {args, file, label, repositoryRoot, runCommand}) => {
    const result = await runCommand(file, args, {cwd: repositoryRoot});
    if (result === null
        || typeof result !== 'object'
        || !Number.isSafeInteger(result.exitCode)
        || typeof result.stdout !== 'string'
        || typeof result.stderr !== 'string') {
        throw new Error(`${label} returned an invalid process result.`);
    }
    if (result.exitCode !== 0) throw new Error(`${label} failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`);
    return result.stdout;
};

const documentTermsIdentity = (/** @type {TermsDiagnostic} */ diagnostic, /** @type {string | null} */ context = null) => {
    if (context === null && diagnostic.column === undefined && diagnostic.line === undefined && diagnostic.name === undefined) return '';
    return JSON.stringify({
        ...(diagnostic.column === undefined ? {} : {column: diagnostic.column}),
        ...(context === null ? {} : {context}),
        ...(diagnostic.line === undefined ? {} : {line: diagnostic.line}),
        ...(diagnostic.name === undefined ? {} : {name: diagnostic.name}),
    });
};

/** @type {(value: unknown, label: string) => asserts value is string} */
const assertSafeTermsPath = (value, label) => {
    if (value === '.') return;
    assertSafePath(value, label);
};
const compareTermsLocator = (/** @type {TermsLocator} */ left, /** @type {TermsLocator} */ right) => (
    compareText(left.path, right.path)
    || (left.line ?? 0) - (right.line ?? 0)
    || (left.column ?? 0) - (right.column ?? 0)
);
const compareTermsDiagnostic = (/** @type {TermsDiagnostic} */ left, /** @type {TermsDiagnostic} */ right) => (
    compareTermsLocator(left, right)
    || compareText(left.code, right.code)
    || compareText(left.name ?? '', right.name ?? '')
);
/** @returns {TermsLocator} */
const canonicalTermsLocator = (/** @type {unknown} */ locator, /** @type {string} */ label) => {
    if (!isRecord(locator)) throw new Error(`${label} is invalid.`);
    const keys = ['path', ...(Object.hasOwn(locator, 'line') ? ['line'] : []), ...(Object.hasOwn(locator, 'column') ? ['column'] : [])];
    assertExactKeys(locator, keys, label);
    assertSafeTermsPath(locator.path, `${label} path`);
    if (Object.hasOwn(locator, 'line') && (typeof locator.line !== 'number' || !Number.isSafeInteger(locator.line) || locator.line < 1)) throw new Error(`${label} line is invalid.`);
    if (Object.hasOwn(locator, 'column') && (typeof locator.column !== 'number' || !Number.isSafeInteger(locator.column) || locator.column < 1)) throw new Error(`${label} column is invalid.`);
    return {
        path: locator.path,
        ...(typeof locator.line === 'number' ? {line: locator.line} : {}),
        ...(typeof locator.column === 'number' ? {column: locator.column} : {}),
    };
};
/** @returns {TermsDiagnostic} */
const canonicalTermsDiagnostic = (/** @type {unknown} */ diagnostic, /** @type {number} */ index) => {
    if (!isRecord(diagnostic)) {
        throw new Error(`Document Terms diagnostic[${index}] is invalid.`);
    }
    const allowed = new Set(['code', 'column', 'line', 'name', 'path', 'related']);
    if (Object.keys(diagnostic).some(key => !allowed.has(key)) || !Object.hasOwn(diagnostic, 'code') || !Object.hasOwn(diagnostic, 'path')) {
        throw new Error(`Document Terms diagnostic[${index}] fields are invalid.`);
    }
    assertString(diagnostic.code, `Document Terms diagnostic[${index}] code`);
    assertSafeTermsPath(diagnostic.path, `Document Terms diagnostic[${index}] path`);
    if (Object.hasOwn(diagnostic, 'line') && (typeof diagnostic.line !== 'number' || !Number.isSafeInteger(diagnostic.line) || diagnostic.line < 1)) throw new Error(`Document Terms diagnostic[${index}] line is invalid.`);
    if (Object.hasOwn(diagnostic, 'column') && (typeof diagnostic.column !== 'number' || !Number.isSafeInteger(diagnostic.column) || diagnostic.column < 1)) throw new Error(`Document Terms diagnostic[${index}] column is invalid.`);
    if (Object.hasOwn(diagnostic, 'name')) assertString(diagnostic.name, `Document Terms diagnostic[${index}] name`);
    /** @type {TermsLocator[] | undefined} */
    let related;
    if (Object.hasOwn(diagnostic, 'related')) {
        if (!Array.isArray(diagnostic.related)) throw new Error(`Document Terms diagnostic[${index}] related is invalid.`);
        related = diagnostic.related.map((locator, locatorIndex) => canonicalTermsLocator(locator, `Document Terms diagnostic[${index}] related[${locatorIndex}]`));
        const sorted = [...related].sort(compareTermsLocator);
        if (related.some((locator, locatorIndex) => locator !== sorted[locatorIndex])
            || new Set(related.map(locator => JSON.stringify(locator))).size !== related.length) {
            throw new Error(`Document Terms diagnostic[${index}] related is not sorted and unique.`);
        }
    }
    return {
        code: diagnostic.code,
        path: diagnostic.path,
        ...(typeof diagnostic.line === 'number' ? {line: diagnostic.line} : {}),
        ...(typeof diagnostic.column === 'number' ? {column: diagnostic.column} : {}),
        ...(typeof diagnostic.name === 'string' ? {name: diagnostic.name} : {}),
        ...(related === undefined ? {} : {related}),
    };
};
/** @returns {LanguageComposition[]} */
const canonicalLanguageComposition = (/** @type {unknown} */ value, /** @type {string} */ label) => {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
    const rows = value.map((row, index) => {
        assertExactKeys(row, ['chinese', 'english', 'other', 'path'], `${label}[${index}]`);
        assertSafePath(row.path, `${label}[${index}] path`);
        for (const key of ['chinese', 'english', 'other']) {
            const percentage = row[key];
            if (percentage !== null && (typeof percentage !== 'number'
                || !Number.isFinite(percentage)
                || percentage < 0
                || percentage > 100
                || Math.round(percentage * 10) !== percentage * 10)) {
                throw new Error(`${label}[${index}] ${key} is invalid.`);
            }
        }
        const percentages = [row.chinese, row.english, row.other];
        if (percentages.some(percentage => percentage === null)
            && !percentages.every(percentage => percentage === null)) {
            throw new Error(`${label}[${index}] percentages must all be null or all be numbers.`);
        }
        return {
            chinese: /** @type {number | null} */ (row.chinese),
            english: /** @type {number | null} */ (row.english),
            other: /** @type {number | null} */ (row.other),
            path: row.path,
        };
    });
    const sorted = [...rows].sort((left, right) => compareText(left.path, right.path));
    if (rows.some((row, index) => row !== sorted[index])
        || new Set(rows.map(row => row.path)).size !== rows.length) {
        throw new Error(`${label} must be sorted and unique.`);
    }
    return rows;
};
/** @returns {DocumentTermsResult} */
const canonicalDocumentTermsResult = (/** @type {{candidate: ReleaseCandidate, result: unknown}} */ {candidate, result}) => {
    assertExactKeys(result, ['contexts', 'diagnostics', 'languageChecks', 'languageComposition', 'source', 'status'], 'Document Terms result');
    assertExactKeys(result.source, ['mode', 'source'], 'Document Terms result source');
    assertExactKeys(result.source.source, ['candidateTree', 'kind'], 'Document Terms result nested source');
    if (result.source.mode !== 'release'
        || result.source.source.candidateTree !== candidate.tree
        || result.source.source.kind !== 'candidate-tree') {
        throw new Error('Document Terms result source does not match the release candidate.');
    }
    if (!Array.isArray(result.diagnostics)) throw new Error('Document Terms result diagnostics must be an array.');
    const diagnostics = result.diagnostics.map(canonicalTermsDiagnostic);
    const sorted = [...diagnostics].sort(compareTermsDiagnostic);
    if (diagnostics.some((diagnostic, index) => diagnostic !== sorted[index])
        || new Set(diagnostics.map(diagnostic => JSON.stringify(diagnostic))).size !== diagnostics.length) {
        throw new Error('Document Terms diagnostics are not sorted and unique.');
    }
    if (!Array.isArray(result.contexts)) throw new Error('Document Terms result contexts must be an array.');
    const seenContexts = new Set();
    const contexts = result.contexts.map((context, contextIndex) => {
        assertExactKeys(context, ['context', 'diagnostics', 'status', 'summary'], `Document Terms context[${contextIndex}]`);
        assertSafePath(context.context, `Document Terms context[${contextIndex}] context`);
        if (context.context !== 'CONTEXT.md' && !context.context.endsWith('/CONTEXT.md')) {
            throw new Error(`Document Terms context[${contextIndex}] path is invalid.`);
        }
        if (seenContexts.has(context.context)) throw new Error('Document Terms contexts are not unique.');
        seenContexts.add(context.context);
        if (!Array.isArray(context.diagnostics)) throw new Error(`Document Terms context[${contextIndex}] diagnostics must be an array.`);
        const contextDiagnostics = context.diagnostics.map(canonicalTermsDiagnostic);
        const contextSorted = [...contextDiagnostics].sort(compareTermsDiagnostic);
        if (contextDiagnostics.some((diagnostic, index) => diagnostic !== contextSorted[index])
            || new Set(contextDiagnostics.map(diagnostic => JSON.stringify(diagnostic))).size !== contextDiagnostics.length) {
            throw new Error(`Document Terms context[${contextIndex}] diagnostics are not sorted and unique.`);
        }
        assertExactKeys(context.summary, ['diagnostics', 'documents', 'globalTerms', 'localTerms', 'uses'], `Document Terms context[${contextIndex}] summary`);
        /** @type {Record<string, number>} */
        const summary = {};
        for (const key of ['diagnostics', 'documents', 'globalTerms', 'localTerms', 'uses']) {
            const value = context.summary[key];
            if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
                throw new Error(`Document Terms context[${contextIndex}] summary ${key} is invalid.`);
            }
            summary[key] = value;
        }
        if (summary.diagnostics !== contextDiagnostics.length) throw new Error(`Document Terms context[${contextIndex}] summary diagnostics does not match diagnostics length.`);
        if ((context.status === 'passed' && contextDiagnostics.length !== 0)
            || (context.status === 'failed' && contextDiagnostics.length === 0)
            || (context.status !== 'passed' && context.status !== 'failed')) {
            throw new Error(`Document Terms context[${contextIndex}] status does not match diagnostics.`);
        }
        return {
            context: context.context,
            diagnostics: contextDiagnostics,
            status: /** @type {'failed' | 'passed'} */ (context.status),
            summary: {
                diagnostics: summary.diagnostics,
                documents: summary.documents,
                globalTerms: summary.globalTerms,
                localTerms: summary.localTerms,
                uses: summary.uses,
            },
        };
    });
    const hasFindings = diagnostics.length > 0 || contexts.some(context => context.status === 'failed');
    if ((result.status === 'passed' && hasFindings)
        || (result.status === 'failed' && !hasFindings)
        || (result.status !== 'passed' && result.status !== 'failed')) {
        throw new Error('Document Terms result status does not match diagnostics.');
    }
    const status = result.status === 'passed' ? 'passed' : 'failed';
    const languageComposition = canonicalLanguageComposition(
        result.languageComposition,
        'Document Terms languageComposition',
    );
    assertExactKeys(result.languageChecks, ['checks', 'status', 'uncovered'], 'Document Terms language checks');
    if (!Array.isArray(result.languageChecks.checks)) throw new Error('Language checks must be an array.');
    const rules = result.languageChecks.checks.map(check => {
        assertExactKeys(check, ['name', 'language', 'minPercentage', 'include', 'exclude', 'effectiveMinPercentage', 'documents', 'summary'], 'Language check');
        if (typeof check.name !== 'string' || (check.language !== 'chinese' && check.language !== 'english')
            || typeof check.minPercentage !== 'number' || !Number.isFinite(check.minPercentage) || check.minPercentage < 0 || check.minPercentage > 100
            || check.effectiveMinPercentage !== check.minPercentage
            || !Array.isArray(check.include) || check.include.length === 0 || check.include.some(value => typeof value !== 'string')
            || !Array.isArray(check.exclude) || check.exclude.some(value => typeof value !== 'string')) throw new Error('Invalid candidate language check.');
        return {name: check.name, language: /** @type {'chinese' | 'english'} */ (check.language), minPercentage: check.minPercentage, include: check.include, exclude: check.exclude};
    });
    const languageChecks = evaluateLanguageChecks({rules, rows: languageComposition});
    if (JSON.stringify(languageChecks) !== JSON.stringify(result.languageChecks)) throw new Error('Candidate language results are not canonical.');
    return {
        contexts,
        diagnostics,
        languageComposition,
        languageChecks,
        source: {mode: 'release', source: {candidateTree: candidate.tree, kind: 'candidate-tree'}},
        status,
    };
};

/** @returns {Promise<{diagnostics: ConformanceDiagnostic[], documentTerms: DocumentTermsResult, languageComposition: LanguageComposition[]}>} */
const runDocumentTermsValidation = async (/** @type {{candidate: ReleaseCandidate, checkDocumentTerms: TermsChecker, repositoryRoot: string}} */ {candidate, checkDocumentTerms, repositoryRoot}) => {
    const termsResult = canonicalDocumentTermsResult({candidate, result: await checkDocumentTerms({
        repositoryRoot,
        request: {mode: 'release', source: {candidateTree: candidate.tree, kind: 'candidate-tree'}},
    })});
    if (termsResult.status === 'passed') return {diagnostics: [], documentTerms: termsResult, languageComposition: termsResult.languageComposition};
    const includeContext = termsResult.contexts.length > 1;
    const findings = [
        ...termsResult.diagnostics.map(diagnostic => ({context: null, diagnostic})),
        ...termsResult.contexts.flatMap(context => context.diagnostics.map(diagnostic => ({
            context: includeContext ? context.context : null,
            diagnostic,
        }))),
    ];
    return {diagnostics: findings.map(({context, diagnostic}) => createDiagnostic({
        code: `document-terms-${diagnostic.code}`,
        identity: documentTermsIdentity(diagnostic, context),
        message: serializeDocumentTermsDiagnostic(diagnostic, context).slice(0, -1),
        path: diagnostic.path,
        stage: 'validation',
    })), documentTerms: termsResult, languageComposition: termsResult.languageComposition};
};

/** @returns {Promise<FailedResult | {status: 'passed'}>} */
const runPreTagValidation = async (/** @type {{repositoryRoot: string, runCommand: CommandRunner}} */ {repositoryRoot, runCommand}) => {
    /** @type {ConformanceDiagnostic[]} */
    const diagnostics = [];
    const inventory = await captureDiagnostic(diagnostics, {
        code: 'syntax-inventory-failed',
        identity: 'tracked-modules',
        path: '.',
        stage: 'validation',
    }, async () => runRequiredCommand({
        args: ['ls-files', '-z', '--', '*.mjs'],
        file: 'git',
        label: 'Production syntax inventory',
        repositoryRoot,
        runCommand,
    }));
    const modules = inventory.ok
        ? inventory.value.split('\0').filter(path => path.length > 0).sort(compareText)
        : [];
    // `node --check` accepts one module path, so separate processes preserve the required per-path diagnostics.
    for (const path of modules) {
        await captureDiagnostic(diagnostics, {
            code: 'syntax-check-failed',
            identity: path,
            path,
            stage: 'validation',
        }, async () => runRequiredCommand({
            args: ['--check', path],
            file: 'node',
            label: `Production syntax check ${path}`,
            repositoryRoot,
            runCommand,
        }));
    }

    const pnpmVersion = await captureDiagnostic(diagnostics, {
        code: 'pnpm-version-check-failed',
        identity: 'pnpm-version',
        path: 'package.json',
        stage: 'validation',
    }, async () => {
        const version = (await runRequiredCommand({
            args: ['--version'],
            file: 'pnpm',
            label: 'pnpm version check',
            repositoryRoot,
            runCommand,
        })).trim();
        const match = STABLE_VERSION_PATTERN.exec(version);
        if (match === null || Number(match[1]) !== 11) {
            throw new Error(`Release Conformance requires pnpm >=11 <12. Observed version: ${version || '(empty)'}.`);
        }
        return version;
    });
    if (pnpmVersion.ok) {
        const installation = await captureDiagnostic(diagnostics, {
            code: 'development-dependency-install-failed',
            identity: 'pnpm-frozen-install',
            path: 'pnpm-lock.yaml',
            stage: 'validation',
        }, async () => runRequiredCommand({
            args: ['install', '--frozen-lockfile'],
            file: 'pnpm',
            label: 'Frozen development dependency installation',
            repositoryRoot,
            runCommand,
        }));
        if (installation.ok) {
            for (const check of [
                {
                    args: ['typecheck'],
                    code: 'javascript-typecheck-failed',
                    identity: 'pnpm-typecheck',
                    label: 'Strict JavaScript typecheck',
                    path: 'tsconfig.json',
                },
                {
                    args: ['test'],
                    code: 'deterministic-test-suite-failed',
                    identity: 'pnpm-test',
                    label: 'Complete deterministic test suite',
                    path: 'package.json',
                },
            ]) {
                await captureDiagnostic(diagnostics, {
                    code: check.code,
                    identity: check.identity,
                    path: check.path,
                    stage: 'validation',
                }, async () => runRequiredCommand({
                    ...check,
                    file: 'pnpm',
                    repositoryRoot,
                    runCommand,
                }));
            }
        }
    }
    for (const check of [
        {
            args: ['scripts/generate-install-arw.mjs', '--check'],
            code: 'generated-bootstrap-check-failed',
            file: 'node',
            identity: 'generated-bootstrap',
            label: 'Generated Bootstrap check',
            path: 'scripts/install-arw.mjs',
        },
        {
            args: ['scripts/check-workflow-distribution.mjs'],
            code: 'workflow-distribution-conformance-failed',
            file: 'node',
            identity: 'workflow-distribution-platform-conformance',
            label: 'Workflow Distribution production check',
            path: 'distribution',
        },
        {
            args: ['arw.mjs', 'text', 'check'],
            code: 'agent-managed-text-check-failed',
            file: 'node',
            identity: 'text-check',
            label: 'Agent-managed text check',
            path: '.',
        },
        {
            args: ['diff', '--check', '--', '.', ':(exclude).idea/**'],
            code: 'git-whitespace-check-failed',
            file: 'git',
            identity: 'unstaged',
            label: 'Git whitespace check',
            path: '.',
        },
        {
            args: ['diff', '--cached', '--check', '--', '.', ':(exclude).idea/**'],
            code: 'git-whitespace-check-failed',
            file: 'git',
            identity: 'staged',
            label: 'Git whitespace check',
            path: '.',
        },
    ]) {
        await captureDiagnostic(diagnostics, {
            code: check.code,
            identity: check.identity,
            path: check.path,
            stage: 'validation',
        }, async () => runRequiredCommand({...check, repositoryRoot, runCommand}));
    }
    return diagnostics.length === 0 ? {status: 'passed'} : failedResult(diagnostics);
};

const assertPostTagAbsent = async (/** @type {string} */ evidenceDirectory) => {
    const path = archivePathFor(evidenceDirectory, 'post-tag');
    try {
        await lstat(path);
    } catch (error) {
        if (isMissingFileError(error)) return;
        throw error;
    }
    throw diagnosticError('Pre-tag evidence must not contain archives/post-tag.tar.', {
        code: 'unexpected-post-tag-archive',
        identity: 'post-tag',
    });
};

/** @returns {Promise<ConformanceCliResult>} */
const runReleaseConformanceUnchecked = async (/** @type {{checkDocumentTerms?: TermsChecker, evidenceDirectory: unknown, phase: unknown, runCommand?: CommandRunner, sourceCheckout: unknown, verifyArchive?: ArchiveVerifier}} */ {
    checkDocumentTerms = checkRepositoryDocumentTerms,
    evidenceDirectory,
    phase,
    runCommand = runReleaseConformanceCommand,
    sourceCheckout,
    verifyArchive = verifyReleaseEvidenceArchive,
}) => {
    /** @type {ConformanceDiagnostic[]} */
    const inputDiagnostics = [];
    const validEvidenceDirectory = typeof evidenceDirectory === 'string' && isAbsolute(evidenceDirectory)
        ? evidenceDirectory
        : null;
    const validPhase = phase === 'pre-tag' || phase === 'post-tag' ? phase : null;
    if (typeof evidenceDirectory !== 'string' || !isAbsolute(evidenceDirectory)) {
        inputDiagnostics.push(createDiagnostic({
            code: 'invalid-evidence-directory',
            identity: 'evidence-directory',
            message: 'Release conformance evidence directory must be absolute.',
            path: '.',
            stage: 'input',
        }));
    }
    if (validPhase === null) inputDiagnostics.push(createDiagnostic({
        code: 'invalid-release-phase',
        identity: typeof phase === 'string' ? phase : '',
        message: 'Release conformance phase must be pre-tag or post-tag.',
        path: '.',
        stage: 'input',
    }));
    const sourceCheckoutResult = await captureDiagnostic(inputDiagnostics, {
        code: 'invalid-source-checkout',
        identity: 'sourceCheckout',
        path: '.',
        stage: 'input',
    }, async () => canonicalSourceCheckout(sourceCheckout));
    if (inputDiagnostics.length > 0) return failedResult(inputDiagnostics);
    if (validEvidenceDirectory === null || validPhase === null || !sourceCheckoutResult.ok) {
        throw new Error('Release conformance input validation produced an inconsistent result.');
    }
    const {candidate, repositoryRoot} = sourceCheckoutResult.value;
    /** @type {ConformanceDiagnostic[]} */
    const termsDiagnostics = [];
    /** @type {LanguageComposition[]} */
    let languageComposition = [];
    /** @type {DocumentTermsResult | null} */
    let documentTerms = null;
    if (validPhase === 'pre-tag') {
        try {
            const terms = await runDocumentTermsValidation({candidate, checkDocumentTerms, repositoryRoot});
            termsDiagnostics.push(...terms.diagnostics);
            languageComposition = terms.languageComposition;
            documentTerms = terms.documentTerms;
        } catch (error) {
            termsDiagnostics.push(diagnosticFromError(error, {
                code: 'document-terms-check-failed',
                identity: '',
                path: '.',
                stage: 'runtime',
            }));
        }
    }

    if (validPhase === 'pre-tag') {
        /** @type {ConformanceDiagnostic[]} */
        const absenceDiagnostics = [];
        await captureDiagnostic(absenceDiagnostics, {
            code: 'unexpected-post-tag-archive',
            identity: 'post-tag',
            path: 'archives/post-tag.tar',
            stage: 'archive',
        }, async () => assertPostTagAbsent(validEvidenceDirectory));
        if (absenceDiagnostics.length > 0) return failedResult([...termsDiagnostics, ...absenceDiagnostics], languageComposition, documentTerms);
    }
    const inventoryDiagnostics = await inspectArchiveInventory({evidenceDirectory: validEvidenceDirectory, phase: validPhase});
    if (inventoryDiagnostics.length > 0) return failedResult([...termsDiagnostics, ...inventoryDiagnostics], languageComposition, documentTerms);
    const archives = validPhase === 'pre-tag' ? listPreTagArchiveKinds() : ['post-tag'];
    const archiveDiagnostics = await verifyArchives({archiveKinds: archives, evidenceDirectory: validEvidenceDirectory, verifyArchive});
    if (archiveDiagnostics.length > 0) return failedResult([...termsDiagnostics, ...archiveDiagnostics], languageComposition, documentTerms);

    if (validPhase === 'pre-tag') {
        const validation = await runPreTagValidation({repositoryRoot, runCommand});
        if (validation.status === 'failed') return failedResult([...termsDiagnostics, ...validation.diagnostics], languageComposition, documentTerms);
    }
    if (termsDiagnostics.length > 0) return failedResult(termsDiagnostics, languageComposition, documentTerms);
    return {
        candidateVersion: candidate.version,
        languageComposition,
        documentTerms,
        phase: validPhase,
        status: 'passed',
        tagAllowed: validPhase === 'pre-tag',
    };
};

/**
 * 执行只读 release conformance, 并把运行异常转换为稳定 diagnostic.
 */
/** @returns {Promise<ConformanceCliResult>} */
export const runReleaseConformance = async (/** @type {Parameters<typeof runReleaseConformanceUnchecked>[0]} */ options) => {
    try {
        return await runReleaseConformanceUnchecked(options);
    } catch (error) {
        return failedResult([diagnosticFromError(error, {
            identity: '',
            path: '.',
            stage: 'runtime',
        })]);
    }
};

const USAGE = 'Usage: node scripts/release-conformance.mjs --evidence-directory <absolute-directory> --phase <pre-tag|post-tag>\n';
export const serializeReleaseConformanceDiagnostic = (/** @type {ConformanceDiagnostic} */ diagnostic) => (
    `release-conformance-finding: stage=${JSON.stringify(diagnostic.stage)}`
    + ` path=${JSON.stringify(diagnostic.path)}`
    + ` code=${JSON.stringify(diagnostic.code)}`
    + ` identity=${JSON.stringify(diagnostic.identity)}`
    + ` message=${JSON.stringify(diagnostic.message)}\n`
);

const candidateRuntimeFailure = (/** @type {string} */ message) => failedResult([createDiagnostic({
    code: 'candidate-resolution-failed',
    identity: '',
    message,
    path: '.',
    stage: 'runtime',
})]);
const repositoryRuntimeFailure = (/** @type {string} */ message) => failedResult([createDiagnostic({
    code: 'repository-discovery-failed',
    identity: '',
    message,
    path: '.',
    stage: 'runtime',
})]);
const conformanceRuntimeFailure = (/** @type {unknown} */ error) => failedResult([diagnosticFromError(error, {
    identity: '',
    path: '.',
    stage: 'runtime',
})]);
/** @returns {CandidateResolution} */
const canonicalCandidateResolution = (/** @type {{repositoryRoot: string, result: unknown}} */ {repositoryRoot, result}) => {
    if (isRecord(result) && result.status === 'resolved') {
        assertExactKeys(result, ['candidate', 'status'], 'Release candidate resolver result');
        return {sourceCheckout: canonicalSourceCheckout({candidate: result.candidate, repositoryRoot}), status: 'resolved'};
    }
    if (isRecord(result) && result.status === 'failed') {
        assertExactKeys(result, ['diagnostics', 'status'], 'Release candidate resolver result');
        if (!Array.isArray(result.diagnostics) || result.diagnostics.length === 0) throw new Error('Release candidate diagnostics are invalid.');
        const diagnostics = result.diagnostics.map((item, index) => {
            assertExactKeys(item, ['code', 'message', 'stage'], `Release candidate diagnostic[${index}]`);
            if (typeof item.code !== 'string'
                || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(item.code)
                || typeof item.message !== 'string'
                || item.message.length === 0
                || item.stage !== 'candidate') {
                throw new Error(`Release candidate diagnostic[${index}] is invalid.`);
            }
            return createDiagnostic({
                code: `candidate-${item.code}`,
                identity: '',
                message: item.message,
                path: '.',
                stage: 'repository',
            });
        });
        return failedResult(diagnostics);
    }
    throw new Error('Release candidate resolver returned an invalid result.');
};
/** @returns {ConformanceCliResult} */
const canonicalConformanceCliResult = (/** @type {{phase: 'pre-tag' | 'post-tag', result: unknown, sourceCheckout: SourceCheckout}} */ {phase, result, sourceCheckout}) => {
    if (!isRecord(result)) throw new Error('Release result must be an object.');
    const documentTerms = result.documentTerms === null ? null : canonicalDocumentTermsResult({candidate: sourceCheckout.candidate, result: result.documentTerms});
    if (isRecord(result) && result.status === 'failed') {
        assertExactKeys(result, ['diagnostics', 'documentTerms', 'languageComposition', 'status'], 'Release conformance result');
        if (!Array.isArray(result.diagnostics) || result.diagnostics.length === 0) {
            throw new Error('Release conformance diagnostics are invalid.');
        }
        for (const [index, diagnostic] of result.diagnostics.entries()) {
            assertExactKeys(diagnostic, ['code', 'identity', 'message', 'path', 'stage'], `Release conformance diagnostic[${index}]`);
            if (typeof diagnostic.code !== 'string'
                || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(diagnostic.code)
                || typeof diagnostic.identity !== 'string'
                || typeof diagnostic.message !== 'string'
                || diagnostic.message.length === 0
                || typeof diagnostic.path !== 'string'
                || !isDiagnosticStage(diagnostic.stage)) {
                throw new Error(`Release conformance diagnostic[${index}] is invalid.`);
            }
            if (diagnostic.path !== '.') assertSafePath(diagnostic.path, `Release conformance diagnostic[${index}] path`);
        }
        const languageComposition = canonicalLanguageComposition(
            result.languageComposition,
            'Release conformance languageComposition',
        );
        if (JSON.stringify(failedResult(result.diagnostics, languageComposition, documentTerms)) !== JSON.stringify(result)) {
            throw new Error('Release conformance diagnostics are not canonical.');
        }
        return failedResult(result.diagnostics.map((/** @type {unknown} */ diagnostic) => {
            if (!isRecord(diagnostic)) throw new Error('Release conformance diagnostic is invalid.');
            return createDiagnostic({
                code: typeof diagnostic.code === 'string' ? diagnostic.code : '',
                identity: typeof diagnostic.identity === 'string' ? diagnostic.identity : '',
                message: typeof diagnostic.message === 'string' ? diagnostic.message : '',
                path: typeof diagnostic.path === 'string' ? diagnostic.path : '.',
                stage: isDiagnosticStage(diagnostic.stage) ? diagnostic.stage : 'runtime',
            });
        }), languageComposition, documentTerms);
    }
    if (isRecord(result) && result.status === 'passed') {
        assertExactKeys(result, ['candidateVersion', 'documentTerms', 'languageComposition', 'phase', 'status', 'tagAllowed'], 'Release conformance result');
        if (result.candidateVersion !== sourceCheckout.candidate.version
            || result.phase !== phase
            || result.tagAllowed !== (phase === 'pre-tag')) {
            throw new Error('Release conformance passed result is invalid.');
        }
        return {
            documentTerms,
            candidateVersion: sourceCheckout.candidate.version,
            languageComposition: canonicalLanguageComposition(
                result.languageComposition,
                'Release conformance languageComposition',
            ),
            phase,
            status: 'passed',
            tagAllowed: phase === 'pre-tag',
        };
    }
    throw new Error('Release conformance result status is invalid.');
};
const writeCliFailure = (/** @type {{result: FailedResult, stderr: (value: string) => unknown, stdout?: (value: string) => unknown}} */ {result, stderr, stdout}) => {
    for (const diagnostic of result.diagnostics) stderr(serializeReleaseConformanceDiagnostic(diagnostic));
    if (stdout !== undefined && result.documentTerms !== null) {
        stdout(`${renderLanguageChecks(result.documentTerms)}\n`);
    }
    return 1;
};

export const runReleaseConformanceCli = async (/** @type {string[]} */ args, /** @type {{getRepositoryRoot?: () => Promise<string | undefined>, repositoryRoot?: string, resolveCandidate?: (...args: Parameters<typeof resolveReleaseCandidate>) => Promise<unknown>, run?: (options: Parameters<typeof runReleaseConformance>[0]) => Promise<unknown>, stderr?: (value: string) => unknown, stdout?: (value: string) => unknown}} */ {
    getRepositoryRoot = async () => repositoryRoot,
    repositoryRoot,
    resolveCandidate = resolveReleaseCandidate,
    run = runReleaseConformance,
    stderr = (/** @type {string | Uint8Array<ArrayBufferLike>} */ value) => process.stderr.write(value),
    stdout = (/** @type {string | Uint8Array<ArrayBufferLike>} */ value) => process.stdout.write(value),
}) => {
    if (args.length !== 4
        || args[0] !== '--evidence-directory'
        || !isAbsolute(args[1])
        || args[2] !== '--phase'
        || (args[3] !== 'pre-tag' && args[3] !== 'post-tag')) {
        stderr(USAGE);
        return 2;
    }
    const phase = args[3] === 'pre-tag' ? 'pre-tag' : 'post-tag';
    try {
        repositoryRoot = await getRepositoryRoot();
        if (typeof repositoryRoot !== 'string') throw new Error('Repository root is unavailable.');
    } catch (error) {
        return writeCliFailure({result: repositoryRuntimeFailure(errorMessage(error)), stderr});
    }
    let candidateResult;
    try {
        candidateResult = await resolveCandidate({phase, remote: 'origin', repositoryRoot});
    } catch (error) {
        return writeCliFailure({result: candidateRuntimeFailure(errorMessage(error)), stderr});
    }
    let resolution;
    try {
        resolution = canonicalCandidateResolution({repositoryRoot, result: candidateResult});
    } catch {
        return writeCliFailure({
            result: candidateRuntimeFailure('Release candidate resolver returned an invalid result.'),
            stderr,
        });
    }
    if (resolution.status === 'failed') return writeCliFailure({result: resolution, stderr});

    let result;
    try {
        result = await run({
            evidenceDirectory: args[1],
            phase,
            sourceCheckout: resolution.sourceCheckout,
        });
    } catch (error) {
        return writeCliFailure({result: conformanceRuntimeFailure(error), stderr});
    }
    try {
        result = canonicalConformanceCliResult({
            phase,
            result,
            sourceCheckout: resolution.sourceCheckout,
        });
    } catch {
        return writeCliFailure({
            result: conformanceRuntimeFailure(new Error('Release conformance returned an invalid result.')),
            stderr,
        });
    }
    if (result.status === 'failed') return writeCliFailure({result, stderr, stdout});
    stdout(`Release conformance passed for candidate version ${result.candidateVersion} in ${result.phase} phase.\n`);
    if (result.documentTerms !== null) {
        stdout(`\n${renderLanguageChecks(result.documentTerms)}\n`);
    }
    return 0;
};
