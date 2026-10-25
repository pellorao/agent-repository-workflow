import {prepareRepositoryConfiguration} from '../arw-common/repository-configuration.mjs';
import {evaluateLanguageChecks} from '../arw-common/language-checks.mjs';
import {lstat, realpath} from 'node:fs/promises';
import {dirname, isAbsolute} from 'node:path';

import {
    createTreeDocumentRepository,
    createWorkingTreeDocumentRepository,
    inspectDocumentDirectories,
} from './document-terms-repository.mjs';
import {filterAgentManagedPaths} from '../arw-common/text-policy.mjs';
import {canonicalRepositoryRelativePath} from '../common/canonical-contract.mjs';
import {createNodeGitRunner} from '../common/git-process.mjs';
import {analyzeDocumentLanguage} from '../common/document-language.mjs';
import {parseMarkdownVisibleText} from '../common/markdown-visible-text.mjs';
import {inspectTextBytes} from '../common/text-policy.mjs';

/** @typedef {'immediate' | 'release'} TermsMode */
/** @typedef {{kind: 'working-tree'} | {candidateTree: string, kind: 'candidate-tree'}} TermsSource */
/** @typedef {{languageThresholds?: import('../arw-common/language-checks.mjs').LanguageThreshold[], include?: string[], mode: TermsMode, source: TermsSource}} TermsRequest */
/** @typedef {{repositoryRoot: string, request: TermsRequest}} TermsInput */
/** @typedef {{column: number, line: number}} TextPosition */
/** @typedef {{column?: number, line?: number, path: string}} TextLocator */
/** @typedef {{code: string, column?: number, line?: number, name?: string, path: string, related?: TextLocator[]}} TermsDiagnostic */
/** @typedef {{kind: 'body' | 'heading', positions: TextPosition[], text: string}} VisibleFlow */
/** @typedef {{flows: VisibleFlow[], malformed: boolean, path: string, text: string}} TermsDocument */
/** @typedef {{disallowedNames: string[], name: string, position: TextPosition}} GlobalTerm */
/** @typedef {{name: string, position: TextPosition}} LocalTerm */
/** @typedef {{definitionLines: Set<number>, diagnostics: TermsDiagnostic[], terms: Map<string, GlobalTerm>}} GlobalPolicy */
/** @typedef {{definitionLines: Set<number>, diagnostics: TermsDiagnostic[], terms: Map<string, LocalTerm>}} LocalPolicy */
/** @typedef {{actual: string, canonical: string, kind: 'canonical' | 'disallowed', length: number, match: string, scope: 'global' | 'local'}} SelectedTerm */
/** @typedef {{canonical: string, characters: string[], foldedCharacters: string[], kind: 'canonical' | 'disallowed', length: number, match: string, scope: 'global' | 'local'}} TermCandidate */
/** @typedef {{diagnostics: TermsDiagnostic[], globalUses: Map<string, TextLocator[]>, localUses: number}} MatchedTerms */
/** @typedef {{bytes: Buffer, kind: 'file', mode: string, path: string} | {kind: 'missing', path: string} | {kind: 'symbolic-link', path: string} | {kind: 'unreadable', path: string} | {kind: 'unsupported', path: string}} DocumentEntry */
/** @typedef {{kind: 'directory' | 'missing' | 'symbolic-link' | 'unreadable' | 'unsupported', path: string}} DirectoryEntry */
/** @typedef {{listPaths: () => Promise<string[]>, readEntries: (paths: unknown) => Promise<DocumentEntry[]>}} DocumentRepository */
/** @typedef {(input: TermsInput) => Promise<DocumentRepository | null>} OpenDocumentRepository */
/** @typedef {(input: {paths: unknown, repositoryRoot: string, source: TermsSource, visiblePaths: string[]}) => Promise<DirectoryEntry[]>} InspectDirectories */
/** @typedef {{context: string, diagnostics: TermsDiagnostic[], status: 'failed' | 'passed', summary: {diagnostics: number, documents: number, globalTerms: number, localTerms: number, uses: number}}} TermsContextResult */
/** @typedef {{chinese: number | null, english: number | null, other: number | null, path: string}} LanguageComposition */
/** @typedef {{contexts: TermsContextResult[], diagnostics: TermsDiagnostic[], languageComposition: LanguageComposition[], languageChecks: import('../arw-common/language-checks.mjs').LanguageChecksResult, source: TermsRequest, status: 'failed' | 'passed'}} TermsResult */

const exactKeys = (/** @type {unknown} */ value, /** @type {string[]} */ expected) => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...expected].sort().join(',')
);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export const canonicalDocumentTermsInclude = canonicalRepositoryRelativePath;

/** @param {unknown} input @returns {asserts input is TermsInput} */
function validateRequest(input) {
    if (!isRecord(input)
        || !exactKeys(input, ['repositoryRoot', 'request'])
        || typeof input.repositoryRoot !== 'string'
        || input.repositoryRoot.length === 0
        || !isAbsolute(input.repositoryRoot)
        || !isRecord(input.request)) throw new TypeError('Document terms call is invalid.');

    if (!Object.keys(input.request).every(key => ['mode', 'source', 'include', 'languageThresholds'].includes(key))
        || !['immediate', 'release'].includes(/** @type {string} */ (input.request.mode))
        || !isRecord(input.request.source)) throw new TypeError('Document terms request is invalid.');
    if ('include' in input.request && (!Array.isArray(input.request.include)
        || input.request.include.some(value => typeof value !== 'string' || canonicalDocumentTermsInclude(value) === null))) {
        throw new TypeError('Document terms request is invalid.');
    }
    if ('languageThresholds' in input.request && (!Array.isArray(input.request.languageThresholds)
        || input.request.languageThresholds.some(value => !isRecord(value) || !exactKeys(value, ['name', 'minPercentage'])
            || typeof value.name !== 'string' || typeof value.minPercentage !== 'number'
            || !Number.isFinite(value.minPercentage) || value.minPercentage < 0 || value.minPercentage > 100))) {
        throw new TypeError('Document terms language thresholds are invalid.');
    }
    if (exactKeys(input.request.source, ['kind']) && input.request.source.kind === 'working-tree') return;
    if (input.request.mode === 'release'
        && exactKeys(input.request.source, ['candidateTree', 'kind'])
        && input.request.source.kind === 'candidate-tree'
        && typeof input.request.source.candidateTree === 'string'
        && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(input.request.source.candidateTree)) return;
    throw new TypeError('Document terms request is invalid.');
}

/** @param {TermsRequest} request @returns {TermsRequest} */
const copyRequest = request => ({
    ...(request.languageThresholds === undefined ? {} : {languageThresholds: request.languageThresholds.map(value => ({...value}))}),
    ...(request.include === undefined ? {} : {include: [...request.include]}),
    mode: request.mode,
    source: {...request.source},
});

/** @param {TermsRequest} request @returns {TermsResult} */
const emptyFailure = request => ({
    contexts: [],
    diagnostics: [{code: 'repository-read-failed', path: '.'}],
    languageComposition: [],
    languageChecks: evaluateLanguageChecks({rules: [], rows: []}),
    source: copyRequest(request),
    status: 'failed',
});

const comparablePath = (/** @type {string} */ value) => process.platform === 'win32' ? value.toLowerCase() : value;
const compareText = (/** @type {string | number} */ left, /** @type {string | number} */ right) => left < right ? -1 : left > right ? 1 : 0;
const foldAscii = (/** @type {string} */ value) => value.replace(/[A-Z]/gu, (/** @type {string} */ character) => character.toLowerCase());
const foldAsciiCharacter = (/** @type {string} */ character) => /^[A-Z]$/u.test(character) ? character.toLowerCase() : character;
/** @param {TermsDiagnostic} left @param {TermsDiagnostic} right */
const compareDiagnostic = (left, right) => (
    compareText(left.path, right.path)
    || (left.line ?? 0) - (right.line ?? 0)
    || (left.column ?? 0) - (right.column ?? 0)
    || compareText(left.code, right.code)
    || compareText(left.name ?? '', right.name ?? '')
);

/** @param {{context: string, diagnostics: TermsDiagnostic[], documents: number, globalTerms?: number, localTerms?: number, uses?: number}} input @returns {TermsContextResult} */
const contextResultFrom = ({context, diagnostics, documents, globalTerms = 0, localTerms = 0, uses = 0}) => ({
    context,
    diagnostics,
    status: diagnostics.length === 0 ? 'passed' : 'failed',
    summary: {diagnostics: diagnostics.length, documents, globalTerms, localTerms, uses},
});

/** @param {{contexts?: TermsContextResult[], diagnostics?: TermsDiagnostic[], languageComposition?: LanguageComposition[], languageChecks?: import('../arw-common/language-checks.mjs').LanguageChecksResult, request: TermsRequest}} input @returns {TermsResult} */
const resultFrom = ({contexts = [], diagnostics = [], languageComposition = [], languageChecks = evaluateLanguageChecks({rules: [], rows: languageComposition}), request}) => ({
    contexts,
    diagnostics,
    languageComposition,
    languageChecks,
    source: copyRequest(request),
    status: diagnostics.length === 0 && contexts.every(context => context.status === 'passed') ? 'passed' : 'failed',
});

/** @param {{bytes: Buffer, issues: string[], path: string}} input @returns {TermsDiagnostic[]} */
const positionedTextIssues = ({bytes, issues, path}) => {
    /** @type {TermsDiagnostic[]} */
    const diagnostics = [];
    if (issues.includes('utf8-bom')) diagnostics.push({code: 'utf8-bom', column: 1, line: 1, path});
    if (!issues.includes('crlf') && !issues.includes('cr')) return diagnostics;
    const characters = Array.from(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    let line = 1;
    let column = 1;
    for (let index = 0; index < characters.length; index += 1) {
        const character = characters[index];
        if (character === '\r') diagnostics.push({
            code: characters[index + 1] === '\n' ? 'crlf' : 'cr',
            column,
            line,
            path,
        });
        if (character === '\n') {
            line += 1;
            column = 1;
        } else column += 1;
    }
    return diagnostics;
};

const parseAvoidNames = (/** @type {string} */ value) => {
    const names = value.split(',').map(name => name.trim());
    return names.length > 0 && names.every(name => name.length > 0) ? names : null;
};

/** @param {TermsDocument} document */
const visibleSourceLines = document => new Set(document.flows.flatMap((/** @type {VisibleFlow} */ flow) => (
    flow.positions.map((/** @type {TextPosition} */ position) => position.line)
)));

/** @param {TermsDocument} document @returns {GlobalPolicy} */
const parseGlobalTerms = document => {
    const {path, text} = document;
    const lines = text.split('\n');
    const visibleLines = visibleSourceLines(document);
    /** @type {TermsDiagnostic[]} */
    const diagnostics = [];
    /** @type {Map<string, GlobalTerm>} */
    const terms = new Map();
    /** @type {Set<number>} */
    const definitionLines = new Set();
    /** @type {Set<string>} */
    const registeredNames = new Set();
    const h1Lines = lines.flatMap((/** @type {string} */ line, /** @type {number} */ index) => (
        visibleLines.has(index + 1) && /^#(?:\s|$)/u.test(line) ? [index] : []
    ));
    const languageLines = lines.flatMap((/** @type {string} */ line, /** @type {number} */ index) => (
        visibleLines.has(index + 1) && line === '## Language' ? [index] : []
    ));
    if (h1Lines.length !== 1 || h1Lines[0] !== 0 || languageLines.length !== 1) {
        diagnostics.push({code: 'global-terms-section-invalid', path});
        return {definitionLines, diagnostics, terms};
    }
    let index = languageLines[0] + 1;
    while (index < lines.length && !(visibleLines.has(index + 1) && /^##(?:\s|$)/u.test(lines[index]))) {
        if (lines[index] === '' || !visibleLines.has(index + 1)) {
            index += 1;
            continue;
        }
        if (/^#{3,6}(?:\s|$)/u.test(lines[index])) {
            index += 1;
            continue;
        }
        const entryLine = index;
        const entry = /^\*\*(.+)\*\*:$/.exec(lines[index]);
        const name = entry?.[1] ?? '';
        index += 1;
        const definitionStart = index;
        while (index < lines.length
            && lines[index] !== ''
            && visibleLines.has(index + 1)
            && !/^_Avoid_:/u.test(lines[index])
            && !/^#{2,6}(?:\s|$)/u.test(lines[index])
            && !/^\*\*(.+)\*\*:$/.test(lines[index])) index += 1;
        const definitionEnd = index;
        /** @type {string[] | null} */
        let disallowedNames = [];
        if (/^_Avoid_:/u.test(lines[index] ?? '')) {
            const avoid = /^_Avoid_: (.+)$/u.exec(lines[index]);
            disallowedNames = avoid === null ? null : parseAvoidNames(avoid[1]);
            index += 1;
        }
        if (entry === null || name.length === 0 || definitionEnd === definitionStart || disallowedNames === null) {
            diagnostics.push({
                code: 'global-term-entry-invalid',
                column: 1,
                line: entryLine + 1,
                name,
                path,
            });
            continue;
        }
        const position = {column: 3, line: entryLine + 1};
        for (let line = entryLine + 1; line <= index; line += 1) definitionLines.add(line);
        const foldedNames = [name, ...disallowedNames].map(foldAscii);
        const nameConflict = new Set(foldedNames).size !== foldedNames.length
            || foldedNames.some(candidate => registeredNames.has(candidate));
        for (const candidate of foldedNames) registeredNames.add(candidate);
        if (nameConflict) {
            diagnostics.push({
                code: 'global-term-entry-invalid',
                column: 1,
                line: entryLine + 1,
                name,
                path,
            });
        } else {
            terms.set(name, {disallowedNames, name, position});
        }
    }
    return {definitionLines, diagnostics, terms};
};

const asciiWord = (/** @type {string | undefined} */ character) => character !== undefined && /^[0-9A-Z_a-z]$/u.test(character);
const asciiWhitespace = (/** @type {string | undefined} */ character) => character !== undefined && /^[\t\n\f\r\v ]$/u.test(character);
const sentenceStartTransparent = (/** @type {string} */ character) => asciiWhitespace(character)
    || character === '"' || character === "'"
    || character === '(' || character === '[' || character === '{';

/** @param {{characters: string[], index: number}} input */
const isSentenceStart = ({characters, index}) => {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        if (sentenceStartTransparent(characters[cursor])) continue;
        return characters[cursor] === '.' || characters[cursor] === '?'
            || characters[cursor] === '!';
    }
    return true;
};

const wordStartsWithAsciiUppercase = (/** @type {string} */ word) => {
    for (const character of Array.from(word)) {
        if (/^[A-Z]$/u.test(character)) return true;
        if (/^[a-z]$/u.test(character)) return false;
    }
    return false;
};

/** @param {{actual: string, characters: string[], index: number}} input */
const disallowedTermIsCapitalized = ({actual, characters, index}) => {
    const capitalizedWords = actual
        .split(/[\t\n\f\r\v ]+/u)
        .filter(word => word.length > 0)
        .map(wordStartsWithAsciiUppercase);
    const firstCheckedWord = isSentenceStart({characters, index}) ? 1 : 0;
    return capitalizedWords.slice(firstCheckedWord).some(Boolean);
};

/** @param {{canonical: string, kind: 'canonical' | 'disallowed', match: string, scope: 'global' | 'local'}} candidate @returns {TermCandidate} */
const compileTermCandidate = candidate => {
    const characters = Array.from(candidate.match);
    return {
        ...candidate,
        characters,
        foldedCharacters: characters.map(foldAsciiCharacter),
        length: characters.length,
    };
};

/** @param {Map<string, GlobalTerm>} globalTerms @param {Map<string, LocalTerm>} localTerms @returns {Map<string, TermCandidate[]>} */
const termCandidates = (globalTerms, localTerms) => {
    /** @type {TermCandidate[]} */
    const candidates = [];
    for (const term of globalTerms.values()) {
        candidates.push(compileTermCandidate({canonical: term.name, kind: 'canonical', match: term.name, scope: 'global'}));
        for (const name of term.disallowedNames) {
            candidates.push(compileTermCandidate({canonical: term.name, kind: 'disallowed', match: name, scope: 'global'}));
        }
    }
    for (const term of localTerms.values()) {
        candidates.push(compileTermCandidate({canonical: term.name, kind: 'canonical', match: term.name, scope: 'local'}));
    }
    candidates.sort((left, right) => (
        right.length - left.length
        || (left.scope === right.scope ? 0 : left.scope === 'global' ? -1 : 1)
        || (left.kind === right.kind ? 0 : left.kind === 'canonical' ? -1 : 1)
        || compareText(left.match, right.match)
    ));
    /** @type {Map<string, TermCandidate[]>} */
    const byFirstCharacter = new Map();
    for (const candidate of candidates) {
        const first = candidate.foldedCharacters[0];
        if (first === undefined) continue;
        const bucket = byFirstCharacter.get(first) ?? [];
        bucket.push(candidate);
        byFirstCharacter.set(first, bucket);
    }
    return byFirstCharacter;
};

/** @param {{candidates: Map<string, TermCandidate[]>, characters: string[], foldedCharacters: string[], index: number}} input @returns {SelectedTerm | null} */
const selectTermCandidate = ({candidates, characters, foldedCharacters, index}) => {
    const first = foldedCharacters[index];
    if (first === undefined) return null;
    for (const candidate of candidates.get(first) ?? []) {
        if (candidate.foldedCharacters.some((character, offset) => foldedCharacters[index + offset] !== character)) continue;
        if (asciiWord(characters[index - 1]) || asciiWord(characters[index + candidate.length])) continue;
        const actual = characters.slice(index, index + candidate.length).join('');
        return {...candidate, actual};
    }
    return null;
};

/** @param {{contextPath: string, documents: TermsDocument[], globalPolicy: GlobalPolicy, localPolicies: Map<string, LocalPolicy>}} input @returns {MatchedTerms} */
const matchTerms = ({contextPath, documents, globalPolicy, localPolicies}) => {
    /** @type {TermsDiagnostic[]} */
    const diagnostics = [];
    /** @type {Map<string, TextLocator[]>} */
    const globalUses = new Map([...globalPolicy.terms.keys()].map(name => [name, []]));
    let localUses = 0;
    for (const document of documents) {
        if (document.malformed) continue;
        const localPolicy = localPolicies.get(document.path);
        if (localPolicy === undefined) throw new Error(`Local term policy is missing: ${document.path}.`);
        /** @type {Map<string, TextLocator[]>} */
        const localOccurrences = new Map([...localPolicy.terms.keys()].map(name => [name, []]));
        const candidates = termCandidates(globalPolicy.terms, localPolicy.terms);
        for (const flow of document.flows) {
            const characters = Array.from(flow.text);
            const foldedCharacters = characters.map(foldAsciiCharacter);
            for (let index = 0; index < characters.length;) {
                const selected = selectTermCandidate({candidates, characters, foldedCharacters, index});
                if (selected === null) {
                    index += 1;
                    continue;
                }
                const position = flow.positions[index];
                if (position === undefined) throw new Error('Visible text position is missing.');
                const definitionLine = localPolicy.definitionLines.has(position.line)
                    || (document.path === contextPath && globalPolicy.definitionLines.has(position.line));
                if (definitionLine) {
                    index += selected.length;
                    continue;
                }
                if (selected.scope === 'global') {
                    if (selected.kind === 'disallowed') {
                        if (disallowedTermIsCapitalized({
                            actual: selected.actual,
                            characters,
                            index,
                        })) diagnostics.push({
                            code: 'term-disallowed',
                            column: position.column,
                            line: position.line,
                            name: selected.actual,
                            path: document.path,
                        });
                    } else if (selected.actual !== selected.canonical) diagnostics.push({
                        code: 'term-spelling-invalid',
                        column: position.column,
                        line: position.line,
                        name: selected.canonical,
                        path: document.path,
                    });
                    else globalUses.get(selected.canonical)?.push({...position, path: document.path});
                } else if (selected.scope === 'local') {
                    if (selected.actual !== selected.canonical) diagnostics.push({
                        code: 'term-spelling-invalid',
                        column: position.column,
                        line: position.line,
                        name: selected.canonical,
                        path: document.path,
                    });
                    else {
                        localUses += 1;
                        const occurrences = localOccurrences.get(selected.canonical);
                        if (occurrences === undefined) throw new Error(`Local term occurrence bucket is missing: ${selected.canonical}.`);
                        occurrences.push({...position, path: document.path});
                    }
                }
                index += selected.length;
            }
        }
        for (const [name, locators] of localOccurrences) {
            if (locators.length >= 2) continue;
            const term = localPolicy.terms.get(name);
            if (term === undefined) throw new Error(`Local term is missing: ${name}.`);
            diagnostics.push({
                code: 'local-term-use-insufficient',
                column: term.position.column,
                line: term.position.line,
                name,
                path: document.path,
                ...(locators.length > 0 ? {related: locators} : {}),
            });
        }
    }
    return {diagnostics, globalUses, localUses};
};

const eligibleRetentionPath = (/** @type {string} */ path) => path !== 'CONTEXT.md'
    && path !== 'CONTEXT-MAP.md'
    && !path.endsWith('/CONTEXT.md')
    && !path.endsWith('/CONTEXT-MAP.md');

/** @param {TermsDocument} document @param {GlobalPolicy} globalPolicy @returns {LocalPolicy} */
const parseLocalTerms = (document, globalPolicy) => {
    const lines = document.text.split('\n');
    const visibleLines = visibleSourceLines(document);
    /** @type {TermsDiagnostic[]} */
    const diagnostics = [];
    /** @type {Set<number>} */
    const definitionLines = new Set();
    /** @type {Map<string, LocalTerm>} */
    const terms = new Map();
    const seenNames = new Set();
    const globalNames = new Set([...globalPolicy.terms.values()].flatMap(term => (
        [term.name, ...term.disallowedNames].map(foldAscii)
    )));
    const headings = lines.flatMap((/** @type {string} */ line, /** @type {number} */ index) => (
        visibleLines.has(index + 1) && line === '## Terms introduced in this document' ? [index] : []
    ));
    if (headings.length === 0) return {definitionLines, diagnostics, terms};
    const h1 = lines.findIndex((/** @type {string} */ line, /** @type {number} */ index) => visibleLines.has(index + 1) && /^#(?:\s|$)/u.test(line));
    const firstH2 = lines.findIndex((/** @type {string} */ line, /** @type {number} */ index) => visibleLines.has(index + 1) && /^##(?:\s|$)/u.test(line));
    if (headings.length !== 1 || h1 < 0 || headings[0] <= h1 || headings[0] !== firstH2) {
        diagnostics.push({code: 'local-terms-section-invalid', path: document.path});
        return {definitionLines, diagnostics, terms};
    }
    let sectionEnd = headings[0] + 1;
    while (sectionEnd < lines.length && !(visibleLines.has(sectionEnd + 1) && /^##(?:\s|$)/u.test(lines[sectionEnd]))) {
        sectionEnd += 1;
    }
    const sectionIsEmpty = !lines.slice(headings[0] + 1, sectionEnd)
        .some((line, offset) => line !== '' && visibleLines.has(headings[0] + offset + 2));
    if (sectionIsEmpty) {
        diagnostics.push({code: 'local-terms-section-invalid', path: document.path});
        return {definitionLines, diagnostics, terms};
    }
    let index = headings[0] + 1;
    while (index < lines.length && !(visibleLines.has(index + 1) && /^##(?:\s|$)/u.test(lines[index]))) {
        if (lines[index] === '' || !visibleLines.has(index + 1)) {
            index += 1;
            continue;
        }
        const entry = /^- \*\*(.+)\*\*: (.+)$/u.exec(lines[index]);
        const name = entry?.[1] ?? '';
        if (entry === null || entry[2].length === 0) {
            diagnostics.push({
                code: 'local-term-entry-invalid',
                column: 1,
                line: index + 1,
                name,
                path: document.path,
            });
            index += 1;
            continue;
        }
        const position = {column: 5, line: index + 1};
        definitionLines.add(index + 1);
        const foldedName = foldAscii(name);
        if (seenNames.has(foldedName) || globalNames.has(foldedName)) {
            diagnostics.push({
                code: 'local-term-entry-invalid',
                column: 1,
                line: index + 1,
                name,
                path: document.path,
            });
            index += 1;
            continue;
        }
        seenNames.add(foldedName);
        terms.set(name, {name, position});
        index += 1;
    }
    return {definitionLines, diagnostics, terms};
};

/** @param {TermsInput} input @returns {Promise<DocumentRepository | null>} */
const openDocumentRepository = async ({repositoryRoot, request}) => {
    try {
        const stats = await lstat(repositoryRoot);
        if (!stats.isDirectory()) return null;
    } catch {
        return null;
    }
    const git = createNodeGitRunner(repositoryRoot);
    const rootResult = await git.run({argv: ['rev-parse', '--show-toplevel']});
    if (rootResult.failure !== null || rootResult.code !== 0) return null;
    try {
        const requestedRoot = await realpath(repositoryRoot);
        const reported = new TextDecoder('utf-8', {fatal: true}).decode(rootResult.stdout).trim();
        const reportedRoot = await realpath(reported);
        if (comparablePath(requestedRoot) !== comparablePath(reportedRoot)) return null;
    } catch {
        return null;
    }
    return request.source.kind === 'working-tree'
        ? createWorkingTreeDocumentRepository({git, repositoryRoot})
        : createTreeDocumentRepository({candidateTree: request.source.candidateTree, git});
};

/** @param {DocumentRepository} repository */
const readRepositoryInputs = async repository => {
    try {
        const visiblePaths = await repository.listPaths();
        const [scopeEntry, configurationEntry] = await repository.readEntries(['.arwignore', 'arw.config.json']);
        return {
            scopeEntry,
            configurationEntry,
            visiblePaths,
        };
    } catch {
        return null;
    }
};

/** @param {DocumentEntry | undefined} entry @returns {{diagnostics: TermsDiagnostic[], text: string}} */
const scopePolicy = entry => {
    if (entry === undefined) return {diagnostics: [{code: 'agent-scope-policy-invalid', path: '.arwignore'}], text: ''};
    if (entry.kind === 'missing') return {diagnostics: [], text: ''};
    if (entry.kind !== 'file') return {
        diagnostics: [{code: 'agent-scope-policy-invalid', path: '.arwignore'}],
        text: '',
    };
    try {
        const text = new TextDecoder('utf-8', {fatal: true}).decode(entry.bytes);
        if (entry.bytes.includes(0)) throw new Error('Invalid policy bytes.');
        return {diagnostics: [], text};
    } catch {
        return {diagnostics: [{code: 'agent-scope-policy-invalid', path: '.arwignore'}], text: ''};
    }
};

/** @param {{entry: DocumentEntry | undefined, path: string}} input @returns {{diagnostics: TermsDiagnostic[], document: TermsDocument | null}} */
const parseMarkdownEntry = ({entry, path}) => {
    if (entry === undefined || entry.kind === 'missing' || entry.kind === 'unreadable') {
        return {diagnostics: [{code: 'source-read-failed', path}], document: null};
    }
    if (entry.kind === 'symbolic-link' || entry.kind === 'unsupported') {
        return {diagnostics: [{code: 'unsupported-source-entry', path}], document: null};
    }
    const {bytes} = entry;
    const inspection = inspectTextBytes(bytes);
    if (inspection.kind === 'binary') {
        return {diagnostics: [{code: 'unsupported-source-type', path}], document: null};
    }
    if (inspection.issues.includes('invalid-utf8')) {
        return {diagnostics: [{code: 'invalid-utf8', path}], document: null};
    }
    const parseBytes = inspection.fixedBytes ?? bytes;
    const parsed = parseMarkdownVisibleText({bytes: parseBytes, path});
    return {
        diagnostics: [
            ...positionedTextIssues({bytes, issues: inspection.issues, path}),
            ...parsed.diagnostics,
        ],
        document: {
            flows: parsed.flows,
            malformed: parsed.diagnostics.length > 0,
            path,
            text: new TextDecoder('utf-8', {fatal: true}).decode(parseBytes),
        },
    };
};

/** @param {{markdownPaths: string[], entriesByPath: Map<string, DocumentEntry>}} input @returns {{diagnostics: TermsDiagnostic[], documents: TermsDocument[]}} */
const loadMarkdownDocuments = ({markdownPaths, entriesByPath}) => {
    /** @type {TermsDiagnostic[]} */
    const diagnostics = [];
    /** @type {TermsDocument[]} */
    const documents = [];
    for (const path of markdownPaths) {
        const parsed = parseMarkdownEntry({entry: entriesByPath.get(path), path});
        diagnostics.push(...parsed.diagnostics);
        if (parsed.document !== null) documents.push(parsed.document);
    }
    return {diagnostics, documents};
};

/** @param {DocumentRepository} repository @param {string[]} paths */
const readDocumentEntries = async (repository, paths) => {
    try {
        const entries = await repository.readEntries(paths);
        if (entries.length !== paths.length) return null;
        return new Map(paths.map((path, index) => [path, entries[index]]));
    } catch {
        return null;
    }
};

/** @param {string} path */
const contextDirectory = path => {
    const directory = dirname(path).replaceAll('\\', '/');
    return directory === '.' ? '' : `${directory}/`;
};

/** @param {string} path @param {string} contextPath */
const pathInContext = (path, contextPath) => path.startsWith(contextDirectory(contextPath));

/** @param {string} directory @param {string} contextPath */
const directoryInContext = (directory, contextPath) => {
    const prefix = contextDirectory(contextPath);
    if (prefix === '') return true;
    const contextRoot = prefix.slice(0, -1);
    return directory === contextRoot || directory.startsWith(prefix);
};

/** @param {{contextPaths: string[], entries: DirectoryEntry[]}} input */
const validateIncludes = ({contextPaths, entries}) => {
    /** @type {TermsDiagnostic[]} */
    const diagnostics = [];
    for (const entry of entries) {
        if (entry.kind !== 'directory') {
            diagnostics.push({
                code: entry.kind === 'missing' ? 'include-directory-missing' : 'include-directory-unsupported',
                path: entry.path,
            });
            continue;
        }
        if (!contextPaths.some(contextPath => directoryInContext(entry.path, contextPath))) {
            diagnostics.push({code: 'include-directory-outside-context', path: entry.path});
        }
    }
    return diagnostics.sort(compareDiagnostic);
};

/** @param {string} target @returns {string | null} */
const canonicalMapTarget = target => {
    if (target.length === 0
        || /[\s\\\0%?#]/u.test(target)
        || target.startsWith('/')
        || /^[A-Za-z]:/u.test(target)) return null;
    const canonical = target.startsWith('./') ? target.slice(2) : target;
    const components = canonical.split('/');
    if (components.length === 0
        || components.some(component => component.length === 0 || component === '.' || component === '..')
        || components.at(-1) !== 'CONTEXT.md') return null;
    return canonical;
};

/** @param {string} line @returns {{label: string, target: string} | null} */
const parseContextMapItem = line => {
    const prefix = /^- \[([^\]]+)\]\(/u.exec(line);
    if (prefix === null) return null;
    let depth = 1;
    let end = -1;
    for (let index = prefix[0].length; index < line.length; index += 1) {
        if (line[index] === '(') depth += 1;
        else if (line[index] === ')') {
            depth -= 1;
            if (depth === 0) {
                end = index;
                break;
            }
        }
    }
    if (end === -1 || end === prefix[0].length) return null;
    const suffix = line.slice(end + 1);
    if (suffix !== '' && !/^\s/u.test(suffix)) return null;
    return {
        label: prefix[1],
        target: line.slice(prefix[0].length, end),
    };
};

/** @param {{document: TermsDocument, entriesByPath: Map<string, DocumentEntry>, markdownPaths: string[]}} input */
const parseContextMap = ({document, entriesByPath, markdownPaths}) => {
    const lines = document.text.split('\n');
    const visibleLines = visibleSourceLines(document);
    const headings = lines.flatMap((line, index) => visibleLines.has(index + 1) && line === '## Contexts' ? [index] : []);
    /** @type {TermsDiagnostic[]} */
    const diagnostics = [];
    if (headings.length !== 1) return {
        contexts: [],
        diagnostics: [{code: 'context-map-invalid', path: document.path}],
        targets: [],
    };
    /** @type {string[]} */
    const contexts = [];
    /** @type {string[]} */
    const targets = [];
    let itemCount = 0;
    let structuralError = false;
    let index = headings[0] + 1;
    while (index < lines.length && !(visibleLines.has(index + 1) && /^##(?:\s|$)/u.test(lines[index]))) {
        if (lines[index] === '' || !visibleLines.has(index + 1)) {
            index += 1;
            continue;
        }
        const item = parseContextMapItem(lines[index]);
        if (item === null || item.label.trim().length === 0) {
            structuralError = true;
            index += 1;
            continue;
        }
        itemCount += 1;
        const target = canonicalMapTarget(item.target);
        if (target !== null && markdownPaths.includes(target) && !targets.includes(target)) targets.push(target);
        const entry = target === null ? undefined : entriesByPath.get(target);
        if (target === null
            || contexts.includes(target)
            || !markdownPaths.includes(target)
            || entry === undefined
            || entry.kind !== 'file') {
            diagnostics.push({code: 'context-map-invalid', column: 1, line: index + 1, path: document.path});
        } else contexts.push(target);
        index += 1;
    }
    if (structuralError || itemCount === 0) diagnostics.unshift({code: 'context-map-invalid', path: document.path});
    return {contexts: diagnostics.length === 0 ? contexts : [], diagnostics, targets};
};

/** @param {{contextPath: string, enforce: boolean, globalPolicy: GlobalPolicy, matched: MatchedTerms}} input */
const globalRetention = ({contextPath, enforce, globalPolicy, matched}) => {
    /** @type {TermsDiagnostic[]} */
    const diagnostics = [];
    let uses = 0;
    for (const [name, locators] of matched.globalUses) {
        uses += locators.length;
        if (!enforce) continue;
        const eligible = locators.filter((/** @type {TextLocator} */ locator) => eligibleRetentionPath(locator.path));
        const identities = new Set(eligible.map((/** @type {TextLocator} */ locator) => locator.path));
        if (eligible.length >= 5 && identities.size >= 2) continue;
        const term = globalPolicy.terms.get(name);
        if (term === undefined) throw new Error(`Global term is missing: ${name}.`);
        diagnostics.push({
            code: 'global-term-use-insufficient',
            column: term.position.column,
            line: term.position.line,
            name,
            path: contextPath,
            ...(locators.length > 0 ? {related: locators} : {}),
        });
    }
    return {diagnostics, uses};
};

/** @param {{contextPath: string, documents: TermsDocument[], mode: TermsMode}} input */
const analyzeTerms = ({contextPath, documents, mode}) => {
    /** @type {TermsDiagnostic[]} */
    const diagnostics = [];
    /** @type {GlobalPolicy} */
    let globalPolicy = {definitionLines: new Set(), diagnostics: [], terms: new Map()};
    const context = documents.find((/** @type {{ path: string; }} */ document) => document.path === contextPath);
    if (context !== undefined && !context.malformed) {
        globalPolicy = parseGlobalTerms(context);
        diagnostics.push(...globalPolicy.diagnostics);
    }
    const globalPolicyTrusted = context !== undefined
        && !context.malformed
        && globalPolicy.diagnostics.length === 0;
    const matchingGlobalPolicy = globalPolicyTrusted
        ? globalPolicy
        : {definitionLines: new Set(), diagnostics: [], terms: new Map()};
    /** @type {Map<string, LocalPolicy>} */
    const localPolicies = new Map();
    for (const document of documents) {
        const policy = document.malformed
            ? {definitionLines: new Set(), diagnostics: [], terms: new Map()}
            : parseLocalTerms(document, matchingGlobalPolicy);
        localPolicies.set(document.path, policy);
        diagnostics.push(...policy.diagnostics);
    }
    const matched = matchTerms({contextPath, documents, globalPolicy: matchingGlobalPolicy, localPolicies});
    const retention = globalPolicyTrusted
        ? globalRetention({contextPath, enforce: mode === 'release', globalPolicy, matched})
        : {diagnostics: [], uses: 0};
    diagnostics.push(...matched.diagnostics, ...retention.diagnostics);
    return {
        diagnostics,
        globalTerms: globalPolicy.terms.size,
        globalPolicyTrusted,
        localTerms: [...localPolicies.values()].reduce((count, policy) => count + policy.terms.size, 0),
        uses: matched.localUses + retention.uses,
    };
};

/** @param {TermsInput} input @param {OpenDocumentRepository} openRepository @param {InspectDirectories} inspectDirectories @returns {Promise<TermsResult>} */
const checkTerms = async (input, openRepository, inspectDirectories) => {
    let repository;
    try {
        repository = await openRepository(input);
    } catch {
        return emptyFailure(input.request);
    }
    if (repository === null) return emptyFailure(input.request);
    const repositoryInputs = await readRepositoryInputs(repository);
    if (repositoryInputs === null) return emptyFailure(input.request);
    const configurationEntry = repositoryInputs.configurationEntry;
    if (configurationEntry === undefined) return emptyFailure(input.request);
    if (configurationEntry.kind !== 'file' && configurationEntry.kind !== 'missing') return resultFrom({
        diagnostics: [{code: 'repository-configuration-read-failed', path: 'arw.config.json'}], request: input.request,
    });
    const configuration = configurationEntry.kind === 'missing' ? null
        : prepareRepositoryConfiguration({repositoryRoot: input.repositoryRoot, sourceBytes: configurationEntry.bytes});
    if (configuration !== null && configuration.status !== 'succeeded') return resultFrom({
        diagnostics: configuration.diagnostics.map(entry => ({code: entry.code, path: 'arw.config.json'})), request: input.request,
    });
    evaluateLanguageChecks({rules: configuration?.languageChecks ?? [], rows: [], overrides: input.request.languageThresholds});
    const policy = scopePolicy(repositoryInputs.scopeEntry);
    if (policy.diagnostics.length > 0) return resultFrom({
        diagnostics: [...policy.diagnostics].sort(compareDiagnostic),
        request: input.request,
    });
    const allMarkdownPaths = repositoryInputs.visiblePaths.filter(path => path.endsWith('.md'));
    const includes = [...new Set((input.request.include ?? [])
        .map(value => /** @type {string} */ (canonicalDocumentTermsInclude(value))))];
    let markdownPaths;
    try {
        const managedMarkdownPaths = filterAgentManagedPaths(allMarkdownPaths, policy.text);
        markdownPaths = managedMarkdownPaths.filter(path => (
            !path.startsWith('.scratch/')
            || includes.some(include => include === '.' || path.startsWith(`${include}/`))
        ));
    } catch {
        return resultFrom({
            diagnostics: [{code: 'agent-scope-policy-invalid', path: '.arwignore'}],
            request: input.request,
        });
    }
    const discoveryPath = allMarkdownPaths.includes('CONTEXT-MAP.md')
        ? 'CONTEXT-MAP.md'
        : allMarkdownPaths.includes('CONTEXT.md') ? 'CONTEXT.md' : null;
    if (discoveryPath === null) return resultFrom({
        diagnostics: [{code: 'terms-glossary-missing', path: '.'}],
        request: input.request,
    });
    const selectedPaths = [...new Set([...markdownPaths, discoveryPath])].sort(compareText);
    const entriesByPath = await readDocumentEntries(repository, selectedPaths);
    if (entriesByPath === null) return emptyFailure(input.request);

    /** @type {string[]} */
    let contextPaths;
    if (discoveryPath === 'CONTEXT-MAP.md') {
        const parsed = parseMarkdownEntry({entry: entriesByPath.get('CONTEXT-MAP.md'), path: 'CONTEXT-MAP.md'});
        if (parsed.diagnostics.length > 0 || parsed.document === null) return resultFrom({
            diagnostics: [...parsed.diagnostics].sort(compareDiagnostic),
            request: input.request,
        });
        let map = parseContextMap({document: parsed.document, entriesByPath, markdownPaths: allMarkdownPaths});
        const supplementalPaths = map.targets.filter(path => !entriesByPath.has(path)).sort(compareText);
        if (supplementalPaths.length > 0) {
            const supplementalEntries = await readDocumentEntries(repository, supplementalPaths);
            if (supplementalEntries === null) return emptyFailure(input.request);
            for (const [path, entry] of supplementalEntries) entriesByPath.set(path, entry);
            map = parseContextMap({document: parsed.document, entriesByPath, markdownPaths: allMarkdownPaths});
        }
        if (map.diagnostics.length > 0) return resultFrom({
            diagnostics: [...map.diagnostics].sort(compareDiagnostic),
            request: input.request,
        });
        contextPaths = map.contexts;
    } else contextPaths = ['CONTEXT.md'];

    let includeEntries;
    try {
        includeEntries = includes.length === 0
            ? []
            : await inspectDirectories({
                paths: [...includes].sort(compareText),
                repositoryRoot: input.repositoryRoot,
                source: input.request.source,
                visiblePaths: repositoryInputs.visiblePaths,
            });
    } catch {
        return emptyFailure(input.request);
    }
    const includeDiagnostics = validateIncludes({contextPaths, entries: includeEntries});
    if (includeDiagnostics.length > 0) return resultFrom({
        diagnostics: includeDiagnostics,
        request: input.request,
    });

    const compositionPaths = [...new Set([
        discoveryPath,
        ...contextPaths.flatMap(contextPath => [
            ...markdownPaths.filter(path => pathInContext(path, contextPath)),
            contextPath,
        ]),
    ])].sort(compareText);
    const compositionDocuments = loadMarkdownDocuments({entriesByPath, markdownPaths: compositionPaths}).documents;
    const languageComposition = compositionDocuments.map(document => analyzeDocumentLanguage({
        flows: document.flows
            .filter(flow => flow.kind === 'body')
            .map(flow => ({kind: /** @type {'body'} */ (flow.kind), text: flow.text})),
        path: document.path,
    }));

    const contexts = contextPaths.map(contextPath => {
        const scopedPaths = [...new Set([
            ...markdownPaths.filter(path => pathInContext(path, contextPath)),
            contextPath,
        ])].sort(compareText);
        const loaded = loadMarkdownDocuments({entriesByPath, markdownPaths: scopedPaths});
        const analysis = analyzeTerms({contextPath, documents: loaded.documents, mode: input.request.mode});
        const diagnostics = [...loaded.diagnostics, ...analysis.diagnostics].sort(compareDiagnostic);
        return contextResultFrom({
            context: contextPath,
            diagnostics,
            documents: scopedPaths.length,
            globalTerms: analysis.globalTerms,
            localTerms: analysis.localTerms,
            uses: analysis.uses,
        });
    });
    return resultFrom({contexts, languageComposition, languageChecks: evaluateLanguageChecks({rules: configuration?.languageChecks ?? [], rows: languageComposition, overrides: input.request.languageThresholds}), request: input.request});
};

/**
 * 检查 Git Repository 工作树或调用方绑定的候选树是否符合 Document Terms 政策.
 * 输入必须符合封闭请求语法; 无效调用同步抛出 TypeError, 有效调用后的来源失败返回封闭结果.
 * 返回诊断使用稳定的 Repository 相对顺序, 两种请求都保持 Repository 和 Git 状态零写入.
 */
export const createDocumentTermsChecker = (/** @type {{inspectDirectories?: InspectDirectories, openDocumentRepository: OpenDocumentRepository}} */ {inspectDirectories = inspectDocumentDirectories, openDocumentRepository: openRepository}) => {
    if (typeof openRepository !== 'function' || typeof inspectDirectories !== 'function') {
        throw new TypeError('Document repository dependencies are invalid.');
    }
    return (/** @type {unknown} */ input) => {
        validateRequest(input);
        return checkTerms(input, openRepository, inspectDirectories);
    };
};

const documentTermsChecker = createDocumentTermsChecker({openDocumentRepository});

export const checkDocumentTerms = (/** @type {unknown} */ input) => documentTermsChecker(input);

const serializeRelated = (/** @type {TextLocator[]} */ related) => JSON.stringify(related.map((/** @type {TextLocator} */ locator) => ({
    path: locator.path,
    line: locator.line,
    column: locator.column,
})));

export const serializeDocumentTermsDiagnostic = (/** @type {TermsDiagnostic} */ diagnostic, /** @type {string | null} */ context = null) => {
    const fields = [
        ...(context === null ? [] : [`context=${JSON.stringify(context)}`]),
        `path=${JSON.stringify(diagnostic.path)}`,
    ];
    if (diagnostic.line !== undefined) fields.push(`line=${diagnostic.line}`);
    if (diagnostic.column !== undefined) fields.push(`column=${diagnostic.column}`);
    fields.push(`code=${JSON.stringify(diagnostic.code)}`);
    if (diagnostic.name !== undefined) fields.push(`name=${JSON.stringify(diagnostic.name)}`);
    if (diagnostic.related !== undefined) fields.push(`related=${serializeRelated(diagnostic.related)}`);
    return `document-terms-finding: ${fields.join(' ')}\n`;
};
