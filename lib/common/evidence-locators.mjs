import {compareText} from './json.mjs';
/** @typedef {{filePath: string, lineEnd: number, lineStart: number}} CompactEvidenceLocator */
/** @typedef {{filePath: string, line: number}} BodyEvidenceLocator */

/** @returns {never} */
const invalidCompactEvidence = () => {
    throw new Error('Compact evidence locator is invalid.');
};

const parseLineRange = (/** @type {string} */ value) => {
    if (!/^[1-9][0-9]*(?:-[1-9][0-9]*)?$/u.test(value)) invalidCompactEvidence();
    const [start, end = start] = value.split('-').map(Number);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) invalidCompactEvidence();
    return {lineEnd: end, lineStart: start};
};

/**
 * Parses one compact evidence value. A later comma segment may repeat its full
 * path or continue the most recent path with another line or line range.
 *
 * @param {unknown} source
 * @returns {CompactEvidenceLocator[]}
 */
export const parseCompactEvidence = source => {
    if (typeof source !== 'string' || source.trim().length === 0) invalidCompactEvidence();
    const compactSource = /** @type {string} */ (source);
    /** @type {CompactEvidenceLocator[]} */
    const locators = [];
    /** @type {string | undefined} */
    let filePath;
    for (const segment of compactSource.split(',')) {
        const match = /^(?<filePath>[^:]+):(?<lines>.*)$/u.exec(segment.trim());
        if (match?.groups?.filePath !== undefined) filePath = match.groups.filePath;
        const lines = match?.groups?.lines ?? segment;
        if (typeof filePath !== 'string' || filePath.trim().length === 0) invalidCompactEvidence();
        const {lineEnd, lineStart} = parseLineRange(lines);
        locators.push({filePath: /** @type {string} */ (filePath), lineEnd, lineStart});
    }
    return locators;
};

const fenceOpening = (/** @type {string} */ value) => {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(value);
    return match?.[1][0] === '`' && match[2].includes('`') ? null : match;
};

const fenceClosing = (/** @type {string} */ value, /** @type {{character: string, length: number}} */ fence) => (
    new RegExp(`^ {0,3}${fence.character}{${fence.length},}[ \\t]*$`, 'u').test(value)
);

const markdownHeadingLines = (/** @type {string} */ source) => {
    const headings = new Set();
    /** @type {{character: string, length: number} | undefined} */
    let fence;
    for (const [index, line] of source.split(/\r?\n/u).entries()) {
        if (fence !== undefined) {
            if (fenceClosing(line, fence)) fence = undefined;
            continue;
        }
        const opening = fenceOpening(line);
        if (opening !== null) {
            fence = {character: opening[1][0], length: opening[1].length};
            continue;
        }
        if (/^ {0,3}#{1,6}(?:[ \t]+|$)/u.test(line)) headings.add(index + 1);
    }
    return headings;
};

const isBlank = (/** @type {string} */ line) => /^\s*$/u.test(line);

/** @returns {locator is CompactEvidenceLocator} */
const compactLocatorIsValid = (/** @type {unknown} */ locator) => locator !== null
    && typeof locator === 'object'
    && !Array.isArray(locator)
    && Object.keys(locator).sort(compareText).join(',') === 'filePath,lineEnd,lineStart'
    && (() => {
        const compact = /** @type {CompactEvidenceLocator} */ (locator);
        return typeof compact.filePath === 'string'
            && compact.filePath.length > 0
            && Number.isSafeInteger(compact.lineStart)
            && Number.isSafeInteger(compact.lineEnd)
            && compact.lineStart > 0
            && compact.lineEnd >= compact.lineStart;
    })();

/**
 * Resolves compact locations against already-authorized source text. It merges
 * overlapping or adjacent selections before dropping Markdown headings and
 * trimming only each selection's leading and trailing blank lines.
 *
 * @param {unknown} locators
 * @param {Map<string, string>} sources
 * @returns {BodyEvidenceLocator[]}
 */
export const normalizeBodyEvidence = (locators, sources) => {
    if (!Array.isArray(locators) || !(sources instanceof Map)) {
        throw new TypeError('Body evidence requires locators and source text.');
    }
    /** @type {Map<string, Array<{end: number, start: number}>>} */
    const rangesByPath = new Map();
    for (const locator of locators) {
        if (!compactLocatorIsValid(locator)) throw new Error('Compact evidence locator is invalid.');
        const source = sources.get(locator.filePath);
        if (typeof source !== 'string') throw new Error(`Evidence source is unavailable: ${locator.filePath}.`);
        const lineCount = source.split(/\r?\n/u).length;
        if (locator.lineEnd > lineCount) throw new Error(`Evidence line does not exist: ${locator.filePath}:${locator.lineEnd}.`);
        const ranges = rangesByPath.get(locator.filePath) ?? [];
        ranges.push({end: locator.lineEnd, start: locator.lineStart});
        rangesByPath.set(locator.filePath, ranges);
    }

    /** @type {BodyEvidenceLocator[]} */
    const evidence = [];
    for (const [filePath, ranges] of [...rangesByPath.entries()].sort(([left], [right]) => compareText(left, right))) {
        const source = sources.get(filePath);
        if (source === undefined) throw new Error(`Evidence source is unavailable: ${filePath}.`);
        const lines = source.split(/\r?\n/u);
        const headings = filePath.toLowerCase().endsWith('.md') ? markdownHeadingLines(source) : new Set();
        /** @type {Array<{end: number, start: number}>} */
        const merged = [];
        for (const range of ranges.sort((left, right) => left.start - right.start || left.end - right.end)) {
            const previous = merged.at(-1);
            const titleGap = previous !== undefined
                && Array.from({length: range.start - previous.end - 1}, (_, index) => previous.end + index + 1)
                    .every(line => headings.has(line));
            if (previous !== undefined && (range.start <= previous.end + 1 || titleGap)) previous.end = Math.max(previous.end, range.end);
            else merged.push({...range});
        }
        for (const range of merged) {
            const selected = Array.from({length: range.end - range.start + 1}, (_, index) => range.start + index)
                .filter(line => !headings.has(line));
            while (selected.length > 0 && isBlank(lines[(selected[0] ?? 0) - 1] ?? '')) selected.shift();
            while (selected.length > 0 && isBlank(lines[(selected[selected.length - 1] ?? 0) - 1] ?? '')) selected.pop();
            evidence.push(...selected.map(line => ({filePath, line})));
        }
    }
    return evidence;
};
