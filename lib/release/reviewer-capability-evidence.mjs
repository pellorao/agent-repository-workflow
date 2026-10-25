import {isAbsolute} from 'node:path';

import {resolveAbsolutePathWithinScope} from '../common/filesystem.mjs';

/** @typedef {Record<string, unknown>} JsonObject */
/** @typedef {{anchor?: string, filePath: string, line?: number}} FixtureLocator */

/** @returns {value is JsonObject} */
const isJsonObject = (/** @type {unknown} */ value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const compareText = (/** @type {string | number} */ left, /** @type {string | number} */ right) => left < right ? -1 : left > right ? 1 : 0;

export const normalizeReviewerCapabilityPath = (/** @type {string} */ value) => value.replaceAll('\\', '/');

export const reviewerCapabilityRelativePathWithinScope = (/** @type {string} */ scope, /** @type {string} */ path) => {
    if (!isAbsolute(path)) return null;
    const result = resolveAbsolutePathWithinScope({path, scope});
    return result.status === 'succeeded' ? normalizeReviewerCapabilityPath(result.relativePath) : null;
};

export const reviewerCapabilityLocatorKey = (/** @type {unknown} */ locator) => {
    if (locator === null || Array.isArray(locator) || typeof locator !== 'object') return JSON.stringify(locator);
    return JSON.stringify(Object.fromEntries(Object.entries(locator).sort(([left], [right]) => compareText(left, right))));
};

export const reviewerCapabilityEvidenceSetKey = (/** @type {FixtureLocator[] | undefined} */ evidence) => (
    evidence ?? []
).map(reviewerCapabilityLocatorKey).sort(compareText).join('|');

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

export const createReviewerCapabilityEvidenceMatcher = (/** @type {{evidenceSources: Map<string, string>, scenarioRoot: string}} */ {
    evidenceSources,
    scenarioRoot,
}) => {
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
        const path = isAbsolute(filePath)
            ? reviewerCapabilityRelativePathWithinScope(scenarioRoot, filePath)
            : normalizeReviewerCapabilityPath(filePath);
        return path === null ? undefined : blanks.get(path);
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
