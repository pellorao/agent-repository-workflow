/** @typedef {{column: number, line: number}} SourcePosition */
/** @typedef {{characters: string[], positions: SourcePosition[]}} SourceLine */
/** @typedef {{code: 'malformed-markdown', column: number, line: number, path: string}} MarkdownDiagnostic */
/** @typedef {{characters: string[], diagnostics: MarkdownDiagnostic[], positions: SourcePosition[]}} ParsedInline */
/** @typedef {{kind: 'body' | 'heading', positions: SourcePosition[], text: string}} VisibleFlow */
/** @typedef {{kind: 'quote'} | {indent: number, kind: 'list'}} MarkdownContainer */
/** @typedef {{character: string, containers: MarkdownContainer[], length: number, position: SourcePosition}} MarkdownFence */
/** @typedef {{kind: 'visible'} | {kind: 'code', marker: string, position: SourcePosition} | {kind: 'comment', position: SourcePosition} | {kind: 'raw', position: SourcePosition, tag: string} | {kind: 'tag', position: SourcePosition, quote: string}} HtmlState */
/** @typedef {{close: number, kind: 'hidden'} | {kind: 'malformed'} | {kind: 'visible'}} AngleConstruct */

/** @param {string} path @param {SourcePosition} position @returns {MarkdownDiagnostic} */
const malformed = (path, position) => ({
    code: 'malformed-markdown',
    column: position.column,
    line: position.line,
    path,
});

/** @param {string} line @param {number} lineNumber @returns {SourceLine} */
const lineCharacters = (line, lineNumber) => {
    const characters = Array.from(line);
    return {
        characters,
        positions: characters.map((_, index) => ({column: index + 1, line: lineNumber})),
    };
};

/** @param {SourceLine} line @param {number} start @param {number} [end] @returns {SourceLine} */
const sliceLine = (line, start, end = line.characters.length) => ({
    characters: line.characters.slice(start, end),
    positions: line.positions.slice(start, end),
});

/** @param {string[]} characters @param {number} index @param {string} value */
const startsWith = (characters, index, value) => (
    characters.slice(index, index + Array.from(value).length).join('').toLowerCase() === value.toLowerCase()
);

/** @param {string[]} characters @param {number} start @param {string} value */
const findSequence = (characters, start, value) => {
    for (let index = start; index <= characters.length - value.length; index += 1) {
        if (startsWith(characters, index, value)) return index;
    }
    return -1;
};

/** @param {string[]} characters @param {number} start @param {string} [initialQuote] */
const scanTagEnd = (characters, start, initialQuote = '') => {
    let quote = initialQuote;
    for (let index = start; index < characters.length; index += 1) {
        const character = characters[index];
        if (quote.length > 0) {
            if (character === quote) quote = '';
        } else if (character === '"' || character === "'") quote = character;
        else if (character === '>') return {close: index, quote};
    }
    return {close: -1, quote};
};

/** @param {string[]} characters @param {number} start */
const findTagEnd = (characters, start) => scanTagEnd(characters, start).close;

/** @param {string[]} characters @param {number} start @returns {AngleConstruct} */
const inlineAngleConstruct = (characters, start) => {
    const close = findTagEnd(characters, start);
    const rest = characters.slice(start).join('');
    const resemblesHiddenConstruct = /^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s|\/?>|$)|^<[A-Za-z][A-Za-z0-9+.-]{1,31}:|^<\?|^<![A-Z]|^<!\[CDATA\[/u.test(rest);
    if (close < 0) return resemblesHiddenConstruct ? {kind: 'malformed'} : {kind: 'visible'};
    const value = characters.slice(start, close + 1).join('');
    const openTag = /^<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^ "'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>$/u;
    const closingTag = /^<\/[A-Za-z][A-Za-z0-9-]*\s*>$/u;
    const uriAutolink = /^<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\u0000-\u0020<>]*>$/u;
    const emailAutolink = /^<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+>$/u;
    const processingInstruction = /^<\?[\s\S]*\?>$/u;
    const declaration = /^<![A-Z][^>]*>$/u;
    const cdata = /^<!\[CDATA\[[\s\S]*\]\]>$/u;
    if ([openTag, closingTag, uriAutolink, emailAutolink, processingInstruction, declaration, cdata]
        .some(pattern => pattern.test(value))) return {close, kind: 'hidden'};
    return {kind: 'visible'};
};

/** @param {SourceLine} line @param {HtmlState} state @returns {{line: SourceLine, state: HtmlState}} */
const stripHiddenHtml = (line, state) => {
    const keptCharacters = [];
    const keptPositions = [];
    let index = 0;
    while (index < line.characters.length) {
        if (state.kind === 'code') {
            const close = findSequence(line.characters, index, state.marker);
            if (close < 0) {
                keptCharacters.push(...line.characters.slice(index));
                keptPositions.push(...line.positions.slice(index));
                return {line: {characters: keptCharacters, positions: keptPositions}, state};
            }
            const end = close + state.marker.length;
            keptCharacters.push(...line.characters.slice(index, end));
            keptPositions.push(...line.positions.slice(index, end));
            index = end;
            state = {kind: 'visible'};
            continue;
        }
        if (state.kind === 'comment') {
            const close = findSequence(line.characters, index, '-->');
            if (close < 0) return {line: {characters: keptCharacters, positions: keptPositions}, state};
            index = close + 3;
            state = {kind: 'visible'};
            continue;
        }
        if (state.kind === 'raw') {
            const rest = line.characters.slice(index).join('');
            const closing = new RegExp(`</${state.tag}\\s*>`, 'iu').exec(rest);
            if (closing === null) return {line: {characters: keptCharacters, positions: keptPositions}, state};
            index += Array.from(rest.slice(0, closing.index) + closing[0]).length;
            state = {kind: 'visible'};
            continue;
        }
        if (state.kind === 'tag') {
            const scanned = scanTagEnd(line.characters, index, state.quote);
            if (scanned.close < 0) return {
                line: {characters: keptCharacters, positions: keptPositions},
                state: {...state, quote: scanned.quote},
            };
            index = scanned.close + 1;
            state = {kind: 'visible'};
            continue;
        }
        if (line.characters[index] === '`') {
            let runLength = 1;
            while (line.characters[index + runLength] === '`') runLength += 1;
            const marker = '`'.repeat(runLength);
            const close = findSequence(line.characters, index + runLength, marker);
            if (close < 0) {
                keptCharacters.push(...line.characters.slice(index));
                keptPositions.push(...line.positions.slice(index));
                return {
                    line: {characters: keptCharacters, positions: keptPositions},
                    state: {kind: 'code', marker, position: line.positions[index]},
                };
            }
            const end = close + runLength;
            keptCharacters.push(...line.characters.slice(index, end));
            keptPositions.push(...line.positions.slice(index, end));
            index = end;
            continue;
        }
        if (line.characters[index] === '<') {
            if (startsWith(line.characters, index, '<!--')) {
                state = {kind: 'comment', position: line.positions[index]};
                index += 4;
                continue;
            }
            const rest = line.characters.slice(index).join('');
            const rawMatch = /^<(script|style)(?:\s|>)/iu.exec(rest);
            if (rawMatch) {
                const tagEnd = findTagEnd(line.characters, index);
                state = {kind: 'raw', position: line.positions[index], tag: rawMatch[1].toLowerCase()};
                if (tagEnd < 0) return {line: {characters: keptCharacters, positions: keptPositions}, state};
                index = tagEnd + 1;
                continue;
            }
            const angle = inlineAngleConstruct(line.characters, index);
            if (angle.kind === 'malformed') {
                const scanned = scanTagEnd(line.characters, index);
                return {
                    line: {characters: keptCharacters, positions: keptPositions},
                    state: {kind: 'tag', position: line.positions[index], quote: scanned.quote},
                };
            }
        }
        keptCharacters.push(line.characters[index]);
        keptPositions.push(line.positions[index]);
        index += 1;
    }
    return {line: {characters: keptCharacters, positions: keptPositions}, state};
};

/** @param {string[]} characters @param {number} start */
const findClosingBracket = (characters, start) => {
    let depth = 0;
    for (let index = start; index < characters.length; index += 1) {
        if (characters[index] === '\\') {
            index += 1;
            continue;
        }
        if (characters[index] === '[') depth += 1;
        else if (characters[index] === ']') {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    return -1;
};

/** @param {string[]} characters @param {number} start */
const findClosingParenthesis = (characters, start) => {
    let depth = 0;
    let quote = '';
    for (let index = start; index < characters.length; index += 1) {
        const character = characters[index];
        if (character === '\\') {
            index += 1;
            continue;
        }
        if (quote.length > 0) {
            if (character === quote) quote = '';
            continue;
        }
        if (character === '"' || character === "'") quote = character;
        else if (character === '(') depth += 1;
        else if (character === ')') {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    return -1;
};

/** @param {string[]} characters @param {SourcePosition[]} positions @returns {SourceLine} */
const normalizeVisible = (characters, positions) => {
    const visibleCharacters = [];
    const visiblePositions = [];
    let pendingSpace = null;
    for (let index = 0; index < characters.length; index += 1) {
        const character = characters[index];
        if (/\s/u.test(character)) {
            if (visibleCharacters.length > 0 && pendingSpace === null) pendingSpace = positions[index];
            continue;
        }
        if (pendingSpace !== null) {
            visibleCharacters.push(' ');
            visiblePositions.push(pendingSpace);
            pendingSpace = null;
        }
        visibleCharacters.push(character);
        visiblePositions.push(positions[index]);
    }
    return {characters: visibleCharacters, positions: visiblePositions};
};

/** @param {{line: SourceLine, path: string}} input @returns {ParsedInline} */
const parseInline = ({line, path}) => {
    /** @type {string[]} */
    const outputCharacters = [];
    /** @type {SourcePosition[]} */
    const outputPositions = [];
    /** @type {MarkdownDiagnostic[]} */
    const diagnostics = [];
    /** @param {ParsedInline} parsed */
    const append = parsed => {
        outputCharacters.push(...parsed.characters);
        outputPositions.push(...parsed.positions);
        diagnostics.push(...parsed.diagnostics);
    };
    let index = 0;
    while (index < line.characters.length) {
        const character = line.characters[index];
        if (character === '\\' && index + 1 < line.characters.length) {
            outputCharacters.push(line.characters[index + 1]);
            outputPositions.push(line.positions[index + 1]);
            index += 2;
            continue;
        }
        if (character === '`') {
            let runLength = 1;
            while (line.characters[index + runLength] === '`') runLength += 1;
            const marker = '`'.repeat(runLength);
            const close = findSequence(line.characters, index + runLength, marker);
            if (close < 0) {
                diagnostics.push(malformed(path, line.positions[index]));
                break;
            }
            index = close + runLength;
            continue;
        }
        const image = character === '!' && line.characters[index + 1] === '[';
        if (image || character === '[') {
            const open = image ? index + 1 : index;
            const close = findClosingBracket(line.characters, open);
            if (close < 0) {
                diagnostics.push(malformed(path, line.positions[open]));
                break;
            }
            append(parseInline({line: sliceLine(line, open + 1, close), path}));
            let next = close + 1;
            if (line.characters[next] === '(') {
                const targetClose = findClosingParenthesis(line.characters, next);
                if (targetClose < 0) {
                    diagnostics.push(malformed(path, line.positions[next]));
                    break;
                }
                next = targetClose + 1;
            } else if (line.characters[next] === '[') {
                const referenceClose = findClosingBracket(line.characters, next);
                if (referenceClose < 0) {
                    diagnostics.push(malformed(path, line.positions[next]));
                    break;
                }
                next = referenceClose + 1;
            }
            index = next;
            continue;
        }
        if (character === '<') {
            const angle = inlineAngleConstruct(line.characters, index);
            if (angle.kind === 'malformed') {
                diagnostics.push(malformed(path, line.positions[index]));
                break;
            }
            if (angle.kind === 'hidden') {
                index = angle.close + 1;
                continue;
            }
            outputCharacters.push(character);
            outputPositions.push(line.positions[index]);
            index += 1;
            continue;
        }
        if (character === '*' || character === '~' || character === '_') {
            let runLength = 1;
            while (line.characters[index + runLength] === character) runLength += 1;
            const previous = line.characters[index - 1] ?? '';
            const next = line.characters[index + runLength] ?? '';
            const insideWord = character === '_' && /[0-9A-Z_a-z]/u.test(previous) && /[0-9A-Z_a-z]/u.test(next);
            if (!insideWord) {
                index += runLength;
                continue;
            }
        }
        outputCharacters.push(character);
        outputPositions.push(line.positions[index]);
        index += 1;
    }
    const normalized = normalizeVisible(outputCharacters, outputPositions);
    return {...normalized, diagnostics};
};

/** @param {SourceLine} line @returns {SourceLine[]} */
const tableCells = line => {
    /** @type {SourceLine[]} */
    const cells = [];
    let start = line.characters[0] === '|' ? 1 : 0;
    let codeRun = 0;
    for (let index = start; index <= line.characters.length; index += 1) {
        if (line.characters[index] === '`') {
            let runLength = 1;
            while (line.characters[index + runLength] === '`') runLength += 1;
            if (codeRun === 0) codeRun = runLength;
            else if (codeRun === runLength) codeRun = 0;
            index += runLength - 1;
            continue;
        }
        if (index < line.characters.length && (line.characters[index] !== '|' || codeRun !== 0)) continue;
        if (index > 0 && line.characters[index - 1] === '\\') continue;
        const cell = sliceLine(line, start, index);
        if (cell.characters.length > 0 || index < line.characters.length) cells.push(cell);
        start = index + 1;
    }
    if (cells.at(-1)?.characters.every((/** @type {string} */ character) => /\s/u.test(character))) cells.pop();
    return cells;
};

const isTableDelimiter = (/** @type {string} */ value) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/u.test(value);

const fenceOpening = (/** @type {string} */ value) => {
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(value);
    if (opening?.[1][0] === '`' && opening[2].includes('`')) return null;
    return opening;
};

/** @param {string} value @param {MarkdownFence} fence */
const fenceClosing = (value, fence) => new RegExp(`^ {0,3}${fence.character}{${fence.length},}[ \\t]*$`, 'u').test(value);

/**
 * 把一个严格 UTF-8 Markdown 文件转为带 Repository 相对位置的可见自然语言 `flows`.
 * 非法 UTF-8 会抛出 TypeError.
 * 返回值保持来源顺序, 排除受支持的隐藏结构, 并用稳定 `malformed-markdown` 诊断封闭不确定边界.
 */
/** @param {{bytes: Buffer, path: string}} input */
export const parseMarkdownVisibleText = input => {
    const text = new TextDecoder('utf-8', {fatal: true}).decode(input.bytes);
    const lines = text.split('\n');
    /** @type {VisibleFlow[]} */
    const flows = [];
    /** @type {MarkdownDiagnostic[]} */
    const diagnostics = [];
    /** @type {MarkdownFence | null} */
    let fence = null;
    /** @type {{position: SourcePosition} | null} */
    let frontmatter = lines[0] === '---' ? {position: {column: 1, line: 1}} : null;
    /** @type {HtmlState} */
    let htmlState = {kind: 'visible'};
    let inTable = false;
    /** @type {SourceLine[]} */
    let paragraph = [];
    /** @type {string | null} */
    let paragraphKind = null;
    /** @type {MarkdownContainer[]} */
    let paragraphContainers = [];
    /** @type {{containers: MarkdownContainer[]} | null} */
    let referenceDefinitionContinuation = null;

    /** @param {ParsedInline} parsed @param {'body' | 'heading'} [kind] */
    const addParsedFlow = (parsed, kind = 'body') => {
        diagnostics.push(...parsed.diagnostics);
        if (parsed.characters.length === 0) return;
        flows.push({kind, positions: parsed.positions, text: parsed.characters.join('')});
    };
    /** @param {'body' | 'heading'} [kind] */
    const flushParagraph = (kind = 'body') => {
        if (paragraph.length > 0) {
            /** @type {SourceLine} */
            const combined = {characters: [], positions: []};
            for (const line of paragraph) {
                if (combined.characters.length > 0) {
                    const firstVisible = line.characters.findIndex((/** @type {string} */ character) => !/\s/u.test(character));
                    const positionIndex = firstVisible < 0 ? 0 : firstVisible;
                    combined.characters.push(' ');
                    combined.positions.push(line.positions[positionIndex] ?? combined.positions.at(-1));
                }
                combined.characters.push(...line.characters);
                combined.positions.push(...line.positions);
            }
            addParsedFlow(parseInline({line: combined, path: input.path}), kind);
        }
        paragraph = [];
        paragraphKind = null;
        paragraphContainers = [];
    };
    /** @param {SourceLine} line @param {MarkdownContainer[]} containers */
    const appendParagraph = (line, containers) => {
        const kind = containers.map(container => container.kind).join('/') || 'normal';
        if (paragraphKind !== null && paragraphKind !== kind) flushParagraph();
        paragraphKind = kind;
        paragraphContainers = containers;
        paragraph.push(line);
    };
    const startsBlock = (/** @type {string} */ value) => /^(?: {0,3}(?:#{1,6})(?:[ \t]+|$)|(?: {4}|\t))/u.test(value)
        || fenceOpening(value) !== null;
    /** @param {MarkdownContainer[]} actual @param {MarkdownContainer[]} expected */
    const matchingPrefix = (actual, expected) => actual.length <= expected.length
        && actual.every((container, index) => container.kind === expected[index].kind);
    /** @param {SourceLine} line @param {MarkdownContainer[]} containers */
    const stripExpectedContainers = (line, containers) => {
        let content = line;
        for (const container of containers) {
            const currentValue = content.characters.join('');
            if (container.kind === 'quote') {
                const quote = /^ {0,3}>[ \t]?/u.exec(currentValue);
                if (quote === null) return {content, matched: false};
                content = sliceLine(content, quote[0].length);
                continue;
            }
            const indentation = /^[ \t]+/u.exec(currentValue);
            if (indentation === null || (!indentation[0].includes('\t')
                && indentation[0].length < container.indent)) return {content, matched: false};
            content = sliceLine(content, Math.min(indentation[0].length, container.indent));
        }
        return {content, matched: true};
    };

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const lineNumber = lineIndex + 1;
        const value = lines[lineIndex];
        if (frontmatter !== null) {
            if (lineIndex > 0 && (value === '---' || value === '...')) frontmatter = null;
            continue;
        }
        if (fence !== null) {
            const strippedFence = stripExpectedContainers(lineCharacters(value, lineNumber), fence.containers);
            if (strippedFence.matched) {
                const closingValue = strippedFence.content.characters.join('');
                if (fenceClosing(closingValue, fence)) fence = null;
                continue;
            }
            fence = null;
        }
        const stripped = stripHiddenHtml(lineCharacters(value, lineNumber), htmlState);
        htmlState = stripped.state;
        const visibleValue = stripped.line.characters.join('');

        let content = stripped.line;
        /** @type {MarkdownContainer[]} */
        let containers = [];
        while (true) {
            const currentValue = content.characters.join('');
            const quote = /^ {0,3}>[ \t]?/u.exec(currentValue);
            if (quote !== null) {
                content = sliceLine(content, quote[0].length);
                containers.push({kind: 'quote'});
                continue;
            }
            const list = /^([ \t]*)(?:[-+*]|\d+[.)])[ \t]+/u.exec(currentValue);
            const listIndent = list === null ? -1 : list[1].length;
            if (list !== null && (listIndent <= 3 || containers.length > 0
                || paragraphContainers.some(container => container.kind === 'list'))) {
                flushParagraph();
                content = sliceLine(content, list[0].length);
                containers.push({indent: list[0].length, kind: 'list'});
                continue;
            }
            break;
        }
        const expectedContainers = referenceDefinitionContinuation?.containers ?? paragraphContainers;
        if (expectedContainers.length > containers.length && matchingPrefix(containers, expectedContainers)) {
            let inherited = true;
            for (const container of expectedContainers.slice(containers.length)) {
                if (container.kind === 'list') {
                    const currentValue = content.characters.join('');
                    const indentation = /^[ \t]+/u.exec(currentValue);
                    if (indentation !== null && (indentation[0].includes('\t')
                        || indentation[0].length >= container.indent)) {
                        content = sliceLine(content, Math.min(indentation[0].length, container.indent));
                    } else if (startsBlock(currentValue)) {
                        inherited = false;
                        break;
                    }
                } else if (startsBlock(content.characters.join(''))) {
                    inherited = false;
                    break;
                }
            }
            if (inherited) containers = expectedContainers;
        }
        const contentValue = content.characters.join('');
        if (referenceDefinitionContinuation !== null) {
            referenceDefinitionContinuation = null;
            if (/^ {0,3}(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\))[ \t]*$/u.test(contentValue)) continue;
        }
        if (contentValue.trim().length === 0) {
            flushParagraph();
            inTable = false;
            if (htmlState.kind === 'code') htmlState = {kind: 'visible'};
            continue;
        }
        const opening = fenceOpening(contentValue);
        if (opening) {
            flushParagraph();
            const openingIndex = contentValue.indexOf(opening[1]);
            fence = {
                character: opening[1][0],
                containers,
                length: opening[1].length,
                position: content.positions[openingIndex],
            };
            continue;
        }
        const referenceDefinition = /^\s*\[[^\]]+\]:\s*\S/u.test(contentValue);
        if (referenceDefinition) {
            flushParagraph();
            referenceDefinitionContinuation = {containers};
            continue;
        }
        const containerKind = containers.map(container => container.kind).join('/') || 'normal';
        if (paragraph.length > 0 && paragraphKind === containerKind
            && /^ {0,3}(?:=+|-+)[ \t]*$/u.test(contentValue)) {
            flushParagraph('heading');
            continue;
        }
        if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(contentValue)) {
            flushParagraph();
            continue;
        }
        const heading = /^ {0,3}(#{1,6})(?:[ \t]+|$)/u.exec(contentValue);
        if (heading) {
            flushParagraph();
            const start = heading[0].length;
            let end = content.characters.length;
            while (end > start && /\s/u.test(content.characters[end - 1])) end -= 1;
            let hashes = end;
            while (hashes > start && content.characters[hashes - 1] === '#') hashes -= 1;
            if (hashes < end && hashes > start && /\s/u.test(content.characters[hashes - 1])) end = hashes - 1;
            addParsedFlow(parseInline({line: sliceLine(content, start, end), path: input.path}), 'heading');
            continue;
        }
        if (isTableDelimiter(contentValue)) {
            flushParagraph();
            inTable = true;
            continue;
        }
        const nextLine = stripExpectedContainers(
            lineCharacters(lines[lineIndex + 1] ?? '', lineNumber + 1),
            containers,
        );
        const tableHeader = nextLine.matched
            && isTableDelimiter(nextLine.content.characters.join(''));
        if (contentValue.includes('|') && (inTable || tableHeader)) {
            flushParagraph();
            inTable = true;
            for (const cell of tableCells(content)) addParsedFlow(parseInline({line: cell, path: input.path}));
            continue;
        }
        inTable = false;
        if (/^(?: {4}|\t)/u.test(contentValue)) {
            flushParagraph();
            continue;
        }
        appendParagraph(content, containers);
    }
    flushParagraph();
    if (frontmatter !== null) diagnostics.push(malformed(input.path, frontmatter.position));
    if (htmlState.kind === 'comment' || htmlState.kind === 'raw' || htmlState.kind === 'tag') {
        diagnostics.push(malformed(input.path, htmlState.position));
    }
    diagnostics.sort((left, right) => left.line - right.line || left.column - right.column);
    return {flows, diagnostics};
};
