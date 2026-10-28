// Format normalization of a Reviewer report on an independent copy. Only writing with exactly one meaning is repaired; results, findings,
// evidence files and the lines pointed at stay the same. JSONL (Commit Audit): scalar `lines` and requirement rows moved to the line they
// quote. Markdown: preamble, lines outside every finding, short locator paths, locators that cite harness-spilled tool output.
import {FINDING_START, SHORT_LOCATOR, shortLocatorPath} from './evidence.mjs';

const isInteger = (/** @type {unknown} */ value) => typeof value === 'number' && Number.isInteger(value);
const STOPWORDS = new Set('a an the to of in on at or and is are be by for with under that it its their as if from'.split(' '));
const SPAN = /`([^`]+)`/gu;
const WORD = /[a-z0-9]+/gu;
const CONTINUATION = /^\s/u;
const BACKQUOTED = /`[^`\n]+`/gu;
const LOCATOR_PART = /^(?:(?<path>[^\s:`]+\/[^\s:`]+|[^\s:`/]+\.[A-Za-z0-9]+):)?(?<start>[1-9][0-9]*)(?:-(?<end>[1-9][0-9]*))?$/u;
const HUNK = /^@@ -[0-9]+(?:,(?<old>[0-9]+))? \+(?<newStart>[0-9]+)(?:,(?<new>[0-9]+))? @@/u;

const splitLines = (/** @type {string} */ text) => /** @type {string[]} */ (text.match(/[^\n]*\n|[^\n]+/gu) ?? []);

// ---- JSONL ----------------------------------------------------------------------------------------------------------------

const requirementWords = (/** @type {string} */ text) => ({spans: new Set([...text.matchAll(SPAN)].map(match => match[1])),
    words: new Set([...text.replace(SPAN, ' ').toLowerCase().matchAll(WORD)].map(match => match[0]).filter(word => !STOPWORDS.has(word))
        .map(word => word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word))});

const textMatches = (/** @type {string} */ quoted, /** @type {string} */ lineText) => {
    const wanted = requirementWords(quoted);
    const line = requirementWords(lineText);
    if (![...wanted.spans].every(span => line.spans.has(span)) || wanted.spans.size + wanted.words.size === 0) return false;
    return wanted.words.size === 0 || [...wanted.words].filter(word => line.words.has(word)).length / wanted.words.size >= 0.8;
};

/** Row number -> [before line, after line, quoted text] of the rows whose quoted requirement belongs to exactly one other line of their file. */
const requirementMoves = (/** @type {any[]} */ rows, /** @type {Map<string, Map<number, string>>} */ requirements) => {
    /** @type {Map<number, [number, number, string]>} */
    const moves = new Map();
    rows.forEach((row, index) => {
        const {source, requirement: quoted} = row ?? {};
        if (!(source !== null && typeof source === 'object' && isInteger(source.line) && typeof quoted === 'string')) return;
        const lines = requirements.get(source.filePath);
        if (lines === undefined || !lines.has(source.line) || textMatches(quoted, /** @type {string} */ (lines.get(source.line)))) return;
        const hits = [...lines].filter(([line, text]) => line !== source.line && textMatches(quoted, text)).map(([line]) => line);
        if (hits.length === 1) moves.set(index + 1, [source.line, hits[0], quoted]);
    });
    // A target another row also ends on (moved or staying) is not unique: drop those moves until stable.
    for (;;) {
        /** @type {Map<string, number[]>} */
        const end = new Map();
        rows.forEach((row, index) => {
            if (row?.source === null || typeof row?.source !== 'object') return;
            const key = `${row.source.filePath}\0${moves.has(index + 1) ? moves.get(index + 1)?.[1] : row.source.line}`;
            end.set(key, [...end.get(key) ?? [], index + 1]);
        });
        const bad = [...moves].filter(([number, [, after]]) => /** @type {number[]} */ (end.get(`${rows[number - 1].source.filePath}\0${after}`)).length > 1).map(([number]) => number);
        if (bad.length === 0) return moves;
        for (const number of bad) moves.delete(number);
    }
};

/** The lines a Commit Audit report may quote per file: the lines of the answer key's requirement rows, and every line of its whole-document sources. */
export const auditRequirementLines = (/** @type {any[]} */ auditRecords, /** @type {Map<string, string>} */ sources) => {
    /** @type {Map<string, Map<number, string>>} */
    const requirements = new Map();
    const lineOf = (/** @type {string} */ path) => (sources.get(path) ?? '').split('\n');
    for (const {requirements: rowsOfRecord} of auditRecords.filter(item => item.documents === undefined)) {
        for (const {source} of rowsOfRecord) requirements.set(source.filePath, new Map([...requirements.get(source.filePath) ?? [], [source.line, lineOf(source.filePath)[source.line - 1]]]));
    }
    for (const document of auditRecords.flatMap(item => item.documents ?? [])) {
        if (sources.has(document) && !requirements.has(document)) requirements.set(document, new Map(lineOf(document).map((line, index) => [index + 1, line])));
    }
    return requirements;
};

/** @param {any[]} original @param {Map<string, Map<number, string>> | undefined} requirements */
export const repairJsonl = (original, requirements) => {
    const rows = structuredClone(original);
    /** @type {any[]} */
    const changes = [];
    rows.forEach((row, rowIndex) => (Array.isArray(row?.evidence) ? row.evidence : []).forEach((/** @type {any} */ item, /** @type {number} */ index) => {
        if (item !== null && typeof item === 'object' && 'lines' in item && isInteger(item.lines)) {
            changes.push({after: [item.lines], before: item.lines, evidence: index, kind: 'scalar-lines', row: rowIndex + 1});
            item.lines = [item.lines];
        }
    }));
    for (const [number, [, after, quoted]] of [...requirementMoves(rows, requirements ?? new Map())].sort(([left], [right]) => left - right)) {
        const row = rows[number - 1];
        changes.push({after, before: row.source.line, filePath: row.source.filePath, kind: 'requirement-line', requirement: quoted, row: number});
        row.source.line = after;
    }
    return {changes, normalized: changes.length === 0 ? undefined : rows.map(row => `${JSON.stringify(row)}\n`).join('')};
};

// ---- Markdown -------------------------------------------------------------------------------------------------------------

/** Indexes of the lines after the first finding that belong to no finding. */
const strayLines = (/** @type {string[]} */ body) => {
    const first = body.findIndex(line => FINDING_START.test(line));
    return first < 0 ? [] : body.flatMap((line, index) => index > first && line.trim() !== '' && !FINDING_START.test(line) && !CONTINUATION.test(line) ? [index] : []);
};

/** Rebuilds the copy from the original and the recorded changes. */
const applyChanges = (/** @type {string} */ original, /** @type {any[]} */ changes) => {
    let lines = splitLines(original);
    const preamble = changes.find(change => change.kind === 'markdown-preamble');
    lines = lines.slice(preamble?.before.length ?? 0);
    const stray = changes.find(change => change.kind === 'markdown-stray-lines');
    if (stray !== undefined) lines = lines.filter((_, index) => !stray.lines.includes(index));
    for (const change of changes.filter(item => item.kind === 'short-evidence-path' || item.kind === 'spill-locator')) {
        const line = lines[change.line];
        lines[change.line] = line.slice(0, change.column) + change.after + line.slice(change.column + change.before.length);
    }
    return lines.join('');
};

const spillMap = (/** @type {string} */ text) => {
    /** @type {Map<number, [string, number, string]>} */
    const out = new Map();
    /** @type {string | null} */
    let path = null;
    let old = 0;
    let added = 0;
    let lineNo = 0;
    text.split('\n').forEach((line, index) => {
        const number = index + 1;
        if (old > 0 || added > 0) {
            if (line.startsWith('\\')) return;
            if (line.startsWith('-')) { old -= 1; return; }
            if (line.startsWith('+') || line.startsWith(' ') || line === '') {
                if (path !== null) out.set(number, [path, lineNo, line.slice(1)]);
                lineNo += 1;
                added -= 1;
                if (!line.startsWith('+')) old -= 1;
                return;
            }
            old = 0;
            added = 0;
        }
        if (line.startsWith('diff --git ')) path = null;
        else if (line.startsWith('+++ ')) {
            const target = line.slice(4).trim();
            path = target.startsWith('b/') ? target.slice(2) : null;
        } else {
            const hunk = HUNK.exec(line);
            if (hunk?.groups && path !== null) {
                old = Number(hunk.groups.old ?? 1);
                added = Number(hunk.groups.new ?? 1);
                lineNo = Number(hunk.groups.newStart);
            }
        }
    });
    return out;
};

/** The one source range every spill that reads spill lines start-end as new-side lines of the path agrees on; undefined when none or several. */
const spillReading = (/** @type {string} */ path, /** @type {number} */ start, /** @type {number} */ end, /** @type {Map<string, number>} */ sources,
    /** @type {Array<Map<number, [string, number, string]>>} */ maps, /** @type {Map<string, string[]>} */ texts) => {
    const results = new Set();
    for (const mapping of maps) {
        const a = mapping.get(start);
        const b = mapping.get(end);
        if (!(a && b && a[0] === path && path === b[0] && a[1] <= b[1] && b[1] <= /** @type {number} */ (sources.get(path)))) continue;
        const lines = texts.get(path) ?? [];
        const inside = Array.from({length: end - start + 1}, (_, offset) => mapping.get(start + offset)).filter(item => item !== undefined);
        if (inside.every(item => item[0] === path && item[1] <= lines.length && lines[item[1] - 1] === item[2])) results.add(`${a[1]}-${b[1]}`);
    }
    if (results.size !== 1) return undefined;
    const [a, b] = [...results][0].split('-').map(Number);
    return [a, b];
};

/** The converted content and parts of one backquoted locator, or undefined when no part is converted. `found.inRangeSpillReadable` counts parts a spill also reads. */
const spillConversion = (/** @type {string} */ content, /** @type {Map<string, number>} */ sources, /** @type {any[]} */ maps, /** @type {Map<string, string[]>} */ texts, /** @type {{inRangeSpillReadable: number}} */ found) => {
    /** @type {string | undefined} */
    let path;
    const changed = [];
    const converted = [];
    for (const part of content.split(',')) {
        const match = LOCATOR_PART.exec(part);
        if (match?.groups === undefined) return undefined;
        path = match.groups.path ?? path;
        if (path === undefined || !sources.has(path)) return undefined;
        const start = Number(match.groups.start);
        const end = Number(match.groups.end ?? match.groups.start);
        const reading = spillReading(path, start, end, sources, maps, texts);
        if (start <= /** @type {number} */ (sources.get(path))) {
            if (reading !== undefined) found.inRangeSpillReadable += 1;
            changed.push(part);
            continue;
        }
        if (reading === undefined) { changed.push(part); continue; }
        const lines = match.groups.end === undefined ? `${reading[0]}` : `${reading[0]}-${reading[1]}`;
        const after = match.groups.path === undefined ? lines : `${match.groups.path}:${lines}`;
        changed.push(after);
        converted.push({after, before: part});
    }
    return converted.length === 0 ? undefined : {content: changed.join(','), converted};
};

/**
 * @param {string} text
 * @param {{sources: Map<string, number>, spills: string[], texts: Map<string, string[]>}} context sources: line count of each frozen source;
 *   texts: its lines (split at newline); spills: the texts of harness-spilled tool-output files
 */
export const repairMarkdown = (text, {sources, spills, texts}) => {
    const lines = splitLines(text);
    const firstFinding = lines.findIndex(line => FINDING_START.test(line));
    const removed = lines.slice(0, Math.max(firstFinding, 0));
    /** @type {any[]} */
    const changes = removed.some(line => line.trim() !== '') ? [{before: removed, kind: 'markdown-preamble'}] : [];
    let body = changes.length > 0 ? lines.slice(removed.length) : lines;
    const stray = strayLines(body);
    if (stray.length > 0) {
        changes.push({before: stray.map(index => body[index]), kind: 'markdown-stray-lines', lines: stray});
        body = body.filter((_, index) => !stray.includes(index));
    }
    body.forEach((line, index) => {
        let offset = 0;
        for (const match of line.matchAll(SHORT_LOCATOR)) {
            const {name, lines: locatorLines} = /** @type {{name: string, lines: string}} */ (match.groups);
            const path = shortLocatorPath(name, locatorLines, sources);
            if (path === undefined) continue;
            const after = `\`${path}:${locatorLines}\``;
            changes.push({after, before: match[0], column: /** @type {number} */ (match.index) + offset, kind: 'short-evidence-path', line: index});
            offset += after.length - match[0].length;
        }
    });
    const found = {inRangeSpillReadable: 0};
    const maps = spills.map(spillMap);
    if (maps.length > 0) {
        splitLines(applyChanges(text, changes)).forEach((line, index) => {
            let offset = 0;
            for (const match of line.matchAll(BACKQUOTED)) {
                const converted = spillConversion(match[0].slice(1, -1), sources, maps, texts, found);
                if (converted === undefined) continue;
                const after = `\`${converted.content}\``;
                changes.push({after, before: match[0], column: /** @type {number} */ (match.index) + offset, converted: converted.converted, kind: 'spill-locator', line: index});
                offset += after.length - match[0].length;
            }
        });
    }
    return {changes, diagnostics: found, normalized: changes.length === 0 ? undefined : applyChanges(text, changes)};
};

export const changeSummary = (/** @type {Array<{kind: string}>} */ changes) => changes.reduce((/** @type {Record<string, number>} */ counts, change) => ({...counts, [change.kind]: (counts[change.kind] ?? 0) + 1}), {});
