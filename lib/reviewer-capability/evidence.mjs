import {compareText, isJsonObject} from '../common/json.mjs';

/** @typedef {Record<string, unknown>} JsonObject */
/** @typedef {{anchor?: string, filePath: string, line?: number}} FixtureLocator */

/** @typedef {{filePath: string, lineEnd: number, lineStart: number}} CompactEvidenceLocator */
/** @typedef {{filePath: string, line: number}} BodyEvidenceLocator */

export const normalizeReviewerCapabilityPath = (/** @type {string} */ value) => value.replaceAll('\\', '/');

export const reviewerCapabilityLocatorKey = (/** @type {unknown} */ locator) => {
    if (locator === null || Array.isArray(locator) || typeof locator !== 'object') return JSON.stringify(locator);
    return JSON.stringify(Object.fromEntries(Object.entries(locator).sort(([left], [right]) => compareText(left, right))));
};

/** @returns {locator is {filePath: string, lineEnd: number, lineStart: number}} */
const isLineRangeLocator = (/** @type {unknown} */ locator) => {
    if (!isJsonObject(locator)
        || Object.keys(locator).sort(compareText).join(',') !== 'filePath,lineEnd,lineStart'
        || typeof locator.filePath !== 'string'
        || typeof locator.lineStart !== 'number'
        || typeof locator.lineEnd !== 'number') return false;
    return Number.isSafeInteger(locator.lineStart)
        && Number.isSafeInteger(locator.lineEnd)
        && locator.lineStart > 0
        && locator.lineEnd >= locator.lineStart;
};

const headingAnchor = (/** @type {string} */ heading) => heading.trim().toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

const markdownSectionRanges = (/** @type {string} */ source) => {
    const lines = source.split('\n');
    const headings = lines.flatMap((/** @type {string} */ line, /** @type {number} */ index) => {
        const match = /^(#{1,6}) +(.+?)\s*$/.exec(line);
        return match === null ? [] : [{
            anchor: headingAnchor(match[2]),
            level: match[1].length,
            line: index + 1,
        }];
    });
    /** @type {Map<string, Array<{end: number, start: number}>>} */
    const rangesByAnchor = new Map();
    for (const [index, heading] of headings.entries()) {
        const nextBoundary = headings.slice(index + 1).find((/** @type {{level: number}} */ candidate) => candidate.level <= heading.level);
        const ranges = rangesByAnchor.get(heading.anchor) ?? [];
        ranges.push({
            end: nextBoundary?.line ?? lines.length + 1,
            start: heading.line,
        });
        rangesByAnchor.set(heading.anchor, ranges);
    }
    return rangesByAnchor;
};

export const createReviewerCapabilityEvidenceMatcher = (/** @type {Map<string, string>} */ evidenceSources) => {
    /** @type {Map<string, Map<string, Array<{end: number, start: number}>>>} */
    const sections = new Map();
    /** @type {Map<string, Set<number>>} */
    const blanks = new Map();
    for (const [filePath, source] of evidenceSources) {
        sections.set(filePath, markdownSectionRanges(source));
        blanks.set(filePath, new Set((source.length === 0 ? [] : (source.endsWith('\n') ? source.slice(0, -1) : source).split('\n')).flatMap(
            (line, index) => /^\s*$/u.test(line) ? [index + 1] : [],
        )));
    }

    const blankLines = (/** @type {string} */ filePath) => {
        return blanks.get(normalizeReviewerCapabilityPath(filePath));
    };

    const isBlankEvidence = (/** @type {unknown} */ locator) => {
        if (!isJsonObject(locator) || typeof locator.filePath !== 'string') return false;
        const sourceBlanks = blankLines(locator.filePath);
        if (sourceBlanks === undefined) return false;
        if (typeof locator.line === 'number'
            && Number.isSafeInteger(locator.line)
            && locator.line > 0
            && Object.keys(locator).sort(compareText).join(',') === 'filePath,line') return sourceBlanks.has(locator.line);
        if (!isLineRangeLocator(locator)) return false;
        return locator.lineEnd - locator.lineStart + 1 <= sourceBlanks.size
            && Array.from({length: locator.lineEnd - locator.lineStart + 1}, (_, index) => locator.lineStart + index).every(
                line => sourceBlanks.has(line),
            );
    };

    const scoredExpectedEvidence = (/** @type {FixtureLocator[]} */ evidence) => evidence.filter(locator => !isBlankEvidence(locator));

    const locatorMatches = (/** @type {{actual: unknown, expected: FixtureLocator}} */ {actual, expected}) => {
        if (!isJsonObject(actual) || isBlankEvidence(actual) || isBlankEvidence(expected)) return false;
        const expectedKeys = Object.keys(expected).sort(compareText);
        const actualKeys = Object.keys(actual).sort(compareText);
        if (typeof actual.filePath !== 'string'
            || normalizeReviewerCapabilityPath(actual.filePath) !== normalizeReviewerCapabilityPath(expected.filePath)) return false;
        if (isLineRangeLocator(actual)) {
            if (expectedKeys.join(',') === 'filePath,line') {
                const expectedLine = expected.line;
                return typeof expectedLine === 'number'
                    && Number.isInteger(expectedLine)
                    && expectedLine >= actual.lineStart
                    && expectedLine <= actual.lineEnd;
            }
            if (expectedKeys.join(',') !== 'anchor,filePath') return false;
            const ranges = sections
                .get(normalizeReviewerCapabilityPath(expected.filePath))
                ?.get(expected.anchor ?? '') ?? [];
            return ranges.some(range => actual.lineStart >= range.start && actual.lineEnd < range.end);
        }
        if (actualKeys.length === expectedKeys.length
            && actualKeys.every((key, index) => key === expectedKeys[index])) {
            return Object.entries(expected).every(([key, value]) => key === 'filePath' || actual[key] === value);
        }
        if (expectedKeys.join(',') !== 'anchor,filePath'
            || actualKeys.join(',') !== 'filePath,line'
            || typeof actual.line !== 'number'
            || !Number.isInteger(actual.line)
            || actual.line <= 0) return false;
        const ranges = sections
            .get(normalizeReviewerCapabilityPath(expected.filePath))
            ?.get(expected.anchor ?? '') ?? [];
        const actualLine = actual.line;
        return ranges.some(range => actualLine >= range.start && actualLine < range.end);
    };

    const containsAllLocators = (/** @type {{actual: unknown[], expected: FixtureLocator[]}} */ {actual, expected}) => {
        const required = scoredExpectedEvidence(expected);
        return required.length > 0 && required.every(expectedLocator => (
            actual.some(actualLocator => locatorMatches({actual: actualLocator, expected: expectedLocator}))
        ));
    };

    const evidenceCardinality = (/** @type {unknown[]} */ evidence) => {
        /** @type {Map<string, Array<{start: number, end: number}>>} */
        const rangesByFile = new Map();
        let invalidCount = 0;
        for (const locator of evidence) {
            if (!isJsonObject(locator) || typeof locator.filePath !== 'string') {
                invalidCount += 1;
                continue;
            }
            const range = isLineRangeLocator(locator)
                ? {start: locator.lineStart, end: locator.lineEnd}
                : Object.keys(locator).sort(compareText).join(',') === 'filePath,line'
                    && typeof locator.line === 'number' && Number.isSafeInteger(locator.line) && locator.line > 0
                    ? {start: locator.line, end: locator.line} : undefined;
            if (range === undefined) {
                invalidCount += 1;
                continue;
            }
            const path = normalizeReviewerCapabilityPath(locator.filePath);
            const ranges = rangesByFile.get(path) ?? [];
            ranges.push(range);
            rangesByFile.set(path, ranges);
        }
        let count = invalidCount;
        for (const [filePath, ranges] of rangesByFile) {
            let end = 0;
            for (const range of ranges.sort((left, right) => left.start - right.start)) {
                if (range.end > end) {
                    const start = Math.max(end + 1, range.start);
                    count += range.end - start + 1;
                    for (const blank of blankLines(filePath) ?? []) if (blank >= start && blank <= range.end) count -= 1;
                }
                end = Math.max(end, range.end);
            }
        }
        return count;
    };

    const countExactMatches = (/** @type {{actual: unknown[], expected: FixtureLocator[]}} */ {actual, expected}) => {
        const consumed = new Set();
        let matches = 0;
        for (const expectedLocator of expected) {
            const index = actual.findIndex((actualLocator, actualIndex) => {
                if (!locatorMatches({actual: actualLocator, expected: expectedLocator})) return false;
                const unit = isLineRangeLocator(actualLocator)
                    ? `${actualIndex}:${reviewerCapabilityLocatorKey(expectedLocator)}`
                    : String(actualIndex);
                if (consumed.has(unit)) return false;
                consumed.add(unit);
                return true;
            });
            if (index !== -1) matches += 1;
        }
        return matches;
    };

    const matchRates = (/** @type {{actual: unknown[], expected: FixtureLocator[]}} */ {actual, expected}) => {
        const relevantExpected = scoredExpectedEvidence(expected);
        const matches = countExactMatches({actual, expected: relevantExpected});
        return matches === 0 ? {coverage: 0, precision: 0} : {
            coverage: matches / relevantExpected.length,
            precision: matches / evidenceCardinality(actual),
        };
    };

    return {containsAllLocators, locatorMatches, matchRates, scoredExpectedEvidence};
};


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

export const FINDING_START = /^(?:[1-9][0-9]*\. |- )/u;
export const SHORT_LOCATOR = /`(?<name>[^`\s/:]+\.[A-Za-z0-9]+):(?<lines>[1-9][0-9]*(?:-[1-9][0-9]*)?(?:,[1-9][0-9]*(?:-[1-9][0-9]*)?)*)`/gu;
/** Line count of each source (a trailing newline ends the last line, it does not start one). */
export const lineCounts = (/** @type {Map<string, string>} */ sources) => new Map([...sources].map(([path, source]) => [path, source === '' ? 0 : (source.endsWith('\n') ? source.slice(0, -1) : source).split('\n').length]));

/** The path a short `name.ext:lines` locator completes to: the only source of that name that holds every line. */
export const shortLocatorPath = (/** @type {string} */ name, /** @type {string} */ lines, /** @type {Map<string, number>} */ counts) => {
    const paths = [...counts.keys()].filter(path => path.split('/').at(-1) === name);
    return counts.has(name) || paths.length !== 1 || Math.max(...lines.split(/[,-]/u).map(Number)) > /** @type {number} */ (counts.get(paths[0])) ? undefined : paths[0];
};
