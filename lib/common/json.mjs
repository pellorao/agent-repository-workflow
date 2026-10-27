import {createHash} from 'node:crypto';

import {generateText} from './text-policy.mjs';

/** @typedef {null | boolean | number | string | object} JsonValue */
/** @typedef {{code: string, message: string}} JsonDiagnostic */
/** @typedef {{bytes?: Buffer, diagnostics: JsonDiagnostic[], stage?: string, status: string}} FilesystemReadResult */
/** @typedef {{stage?: string, status: string}} FilesystemWriteResult */
/** @typedef {{read?: (input: {path: string}) => Promise<FilesystemReadResult>, write?: (input: {bytes: Buffer, mode: 'create' | 'replace', path: string}) => Promise<FilesystemWriteResult>}} JsonFilesystem */
/** @typedef {{text: string | Buffer, filesystem?: undefined, path?: undefined} | {filesystem: Required<Pick<JsonFilesystem, 'read'>>, path: string, text?: undefined}} JsonParseInput */
/** @typedef {'compact' | 'readable'} JsonSerializationFormat */
/** @typedef {{format?: JsonSerializationFormat, sortKeys?: boolean}} JsonSerializationOptions */

/** @param {string | number} left @param {string | number} right */
export const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/** @param {import('node:crypto').BinaryLike} bytes */
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** @param {unknown} value @param {Set<object>} [seen] @returns {value is JsonValue} */
const isJsonValue = (value, seen = new Set()) => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    const valid = Array.isArray(value)
        ? value.every(entry => isJsonValue(entry, seen))
        : Object.getPrototypeOf(value) === Object.prototype
            && Object.values(value).every(entry => isJsonValue(entry, seen));
    seen.delete(value);
    return valid;
};

/** @param {JsonValue} value @returns {JsonValue} */
const sortedValue = value => {
    if (Array.isArray(value)) return value.map(sortedValue);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareText(left, right)).map(([key, nested]) => [key, sortedValue(nested)]));
    }
    return value;
};

/** @param {string} code @param {string} message @returns {{diagnostics: JsonDiagnostic[], status: 'blocked'}} */
const blocked = (code, message) => ({diagnostics: [{code, message}], status: 'blocked'});

/** @param {string | Buffer} input */
export const parseJsonText = input => {
    let text;
    if (Buffer.isBuffer(input)) {
        if (input.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
            return blocked('json-bom', 'JSON input must not contain a UTF-8 BOM.');
        }
        try {
            text = new TextDecoder('utf-8', {fatal: true}).decode(input);
        } catch {
            return blocked('json-invalid-utf8', 'JSON input is not valid UTF-8.');
        }
    } else {
        text = input;
        if (text.startsWith('\uFEFF')) return blocked('json-bom', 'JSON input must not contain a UTF-8 BOM.');
    }
    try {
        return {diagnostics: [], status: 'succeeded', value: JSON.parse(text)};
    } catch {
        return blocked('json-invalid', 'The input is not valid JSON.');
    }
};

/** @param {string | Buffer | JsonParseInput} input */
export const parseJson = async input => {
    if (typeof input === 'string' || Buffer.isBuffer(input)) return parseJsonText(input);
    if (input.text !== undefined) return parseJsonText(input.text);
    const read = await input.filesystem.read({path: input.path});
    if (read.status !== 'succeeded') {
        return read.status === 'blocked'
            ? read
            : {...read, stage: read.stage ?? 'json-read'};
    }
    return parseJsonText(/** @type {Buffer} */ (read.bytes));
};

/** @param {unknown} value @param {JsonSerializationOptions} [options] @returns {ReturnType<typeof blocked> | ReturnType<typeof generateText>} */
export const serializeJson = (value, {format = 'readable', sortKeys = false} = {}) => {
    if (!isJsonValue(value)) return blocked('json-unserializable', 'The value is not JSON serializable.');
    const serializable = sortKeys ? sortedValue(value) : value;
    const source = format === 'compact'
        ? JSON.stringify(serializable)
        : JSON.stringify(serializable, null, 2);
    return format === 'compact'
        ? {bytes: Buffer.from(source, 'utf8'), diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded')}
        : generateText(source);
};

/** @param {{filesystem: Required<Pick<JsonFilesystem, 'write'>>, path: string, value: unknown}} input @param {JsonSerializationOptions & {mode?: 'create' | 'replace'}} [options] */
export const writeJson = async ({filesystem, path, value}, options = {}) => {
    const serialized = serializeJson(value, options);
    if (serialized.status !== 'succeeded') return serialized;
    const mode = options.mode ?? 'replace';
    const written = await filesystem.write({bytes: serialized.bytes, mode, path});
    return written.status === 'failed' ? {...written, stage: written.stage ?? 'json-write'} : written;
};

/** @type {(value: unknown, label: string) => asserts value is JsonValue} */
const requireJsonValue = (value, label) => {
    if (!isJsonValue(value)) throw new TypeError(`${label} must be a valid JSON value.`);
};

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export const isJsonObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** True when value is a plain object whose own keys are exactly `keys`. @param {unknown} value @param {readonly string[]} keys @returns {value is Record<string, unknown>} */
export const exactKeys = (value, keys) => isJsonObject(value)
    && Object.keys(value).sort(compareText).join('\0') === [...keys].sort(compareText).join('\0');

/** @typedef {'string' | 'positive-integer' | ((value: unknown) => boolean) | {[key: string]: Shape}} Shape */
/** @type {Record<string, (value: unknown) => boolean>} */
const SHAPE_TYPES = {
    string: value => typeof value === 'string',
    'positive-integer': value => Number.isSafeInteger(value) && /** @type {number} */ (value) > 0,
};

/**
 * Declarative check for external input (files, CLI, subprocess output): object shapes have exactly
 * the listed keys, strings name a type in SHAPE_TYPES, functions are predicates.
 * @param {unknown} value @param {Shape} shape @param {string} [label]
 * @returns {string | null} the first problem, or null when value matches.
 */
export const checkShape = (value, shape, label = 'value') => {
    if (typeof shape === 'string') return SHAPE_TYPES[shape](value) ? null : `${label} must be a ${shape}.`;
    if (typeof shape === 'function') return shape(value) ? null : `${label} is invalid.`;
    if (!exactKeys(value, Object.keys(shape))) return `${label} must contain exactly: ${Object.keys(shape).sort(compareText).join(', ')}.`;
    for (const [key, rule] of Object.entries(shape)) {
        const problem = checkShape(value[key], rule, `${label}.${key}`);
        if (problem !== null) return problem;
    }
    return null;
};

/** @type {(segments: unknown) => asserts segments is string[]} */
const requireJsonPath = segments => {
    if (!Array.isArray(segments)
        || segments.length === 0
        || segments.some(segment => typeof segment !== 'string')) {
        throw new TypeError('JSON path segments must be a non-empty array of strings.');
    }
};

/** @param {string[]} segments @param {number} length */
const ancestorPath = (segments, length) => length === 0 ? '<root>' : segments.slice(0, length).join('.');

/** @param {string} path */
const blockedJsonPath = path => ({
    diagnostics: [{
        code: 'json-path-ancestor-not-object',
        message: `JSON path ancestor is not an object: ${path}.`,
        path,
    }],
    status: /** @type {'blocked'} */ ('blocked'),
});

/** @param {Record<string, JsonValue>} target @param {string} key @param {JsonValue} value */
const defineJsonProperty = (target, key, value) => {
    Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
    });
};

/** @param {unknown} value @returns {JsonValue} */
export const cloneJsonValue = value => {
    requireJsonValue(value, 'value');
    if (Array.isArray(value)) return value.map(entry => cloneJsonValue(entry));
    if (isJsonObject(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneJsonValue(nested)]));
    }
    return value;
};

/** @param {unknown} value @param {unknown} segments */
export const readJsonPath = (value, segments) => {
    requireJsonValue(value, 'value');
    requireJsonPath(segments);
    /** @type {JsonValue} */
    let current = value;
    for (let index = 0; index < segments.length; index += 1) {
        if (!isJsonObject(current)) return blockedJsonPath(ancestorPath(segments, index));
        const segment = segments[index];
        if (!Object.hasOwn(current, segment)) {
            return {diagnostics: [], present: false, status: /** @type {'succeeded'} */ ('succeeded')};
        }
        current = /** @type {JsonValue} */ (current[segment]);
    }
    return {
        diagnostics: [],
        present: true,
        status: /** @type {'succeeded'} */ ('succeeded'),
        value: cloneJsonValue(current),
    };
};

/** @param {unknown} value @param {unknown} segments @param {unknown} nextValue */
export const writeJsonPath = (value, segments, nextValue) => {
    requireJsonValue(value, 'value');
    requireJsonValue(nextValue, 'nextValue');
    requireJsonPath(segments);
    const nextRoot = cloneJsonValue(value);
    /** @type {JsonValue} */
    let current = nextRoot;
    for (let index = 0; index < segments.length - 1; index += 1) {
        if (!isJsonObject(current)) return blockedJsonPath(ancestorPath(segments, index));
        const segment = segments[index];
        if (!Object.hasOwn(current, segment)) defineJsonProperty(/** @type {Record<string, JsonValue>} */ (current), segment, {});
        current = /** @type {JsonValue} */ (current[segment]);
    }
    if (!isJsonObject(current)) return blockedJsonPath(ancestorPath(segments, segments.length - 1));
    defineJsonProperty(/** @type {Record<string, JsonValue>} */ (current), segments[segments.length - 1], cloneJsonValue(nextValue));
    return {diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded'), value: nextRoot};
};

/** @param {unknown} value @param {unknown} segments */
export const deleteJsonPath = (value, segments) => {
    requireJsonValue(value, 'value');
    requireJsonPath(segments);
    const nextRoot = cloneJsonValue(value);
    /** @type {JsonValue} */
    let current = nextRoot;
    for (let index = 0; index < segments.length - 1; index += 1) {
        if (!isJsonObject(current)) return blockedJsonPath(ancestorPath(segments, index));
        const segment = segments[index];
        if (!Object.hasOwn(current, segment)) {
            return {diagnostics: [], removed: false, status: /** @type {'succeeded'} */ ('succeeded'), value: nextRoot};
        }
        current = /** @type {JsonValue} */ (current[segment]);
    }
    if (!isJsonObject(current)) return blockedJsonPath(ancestorPath(segments, segments.length - 1));
    const leaf = segments[segments.length - 1];
    const removed = Object.hasOwn(current, leaf);
    if (removed) delete current[leaf];
    return {diagnostics: [], removed, status: /** @type {'succeeded'} */ ('succeeded'), value: nextRoot};
};

/** @param {unknown} left @param {unknown} right */
export const jsonSemanticallyEqual = (left, right) => {
    requireJsonValue(left, 'left');
    requireJsonValue(right, 'right');
    return JSON.stringify(sortedValue(left)) === JSON.stringify(sortedValue(right));
};

/** @param {unknown} value */
export const digestJson = value => {
    requireJsonValue(value, 'value');
    return sha256(JSON.stringify(sortedValue(value)));
};

/** @typedef {{start: number, end: number, entries?: Map<string, JsonPosition>, keyStart?: number}} JsonPosition */

/** @param {string} source @param {number} position */
const skipWhitespace = (source, position) => {
    while (/\s/u.test(source[position] ?? '')) position += 1;
    return position;
};

/** @param {string} source @param {number} position */
const scanString = (source, position) => {
    let cursor = position + 1;
    while (cursor < source.length) {
        if (source[cursor] === '\\') cursor += 2;
        else if (source[cursor++] === '"') return cursor;
    }
    throw new Error('Validated JSON has an unterminated string.');
};

/** @param {string} source @param {number} position @returns {JsonPosition} */
const scanValue = (source, position) => {
    const start = skipWhitespace(source, position);
    const first = source[start];
    if (first === '"') return {start, end: scanString(source, start)};
    if (first === '{') {
        const entries = new Map();
        let cursor = skipWhitespace(source, start + 1);
        while (source[cursor] !== '}') {
            const keyStart = cursor;
            const keyEnd = scanString(source, cursor);
            const key = JSON.parse(source.slice(cursor, keyEnd));
            cursor = skipWhitespace(source, keyEnd) + 1;
            const child = scanValue(source, cursor);
            entries.set(key, {...child, keyStart});
            cursor = skipWhitespace(source, child.end);
            if (source[cursor] === ',') cursor = skipWhitespace(source, cursor + 1);
        }
        return {start, end: cursor + 1, entries};
    }
    if (first === '[') {
        let cursor = skipWhitespace(source, start + 1);
        while (source[cursor] !== ']') {
            const child = scanValue(source, cursor);
            cursor = skipWhitespace(source, child.end);
            if (source[cursor] === ',') cursor = skipWhitespace(source, cursor + 1);
        }
        return {start, end: cursor + 1};
    }
    let cursor = start;
    while (cursor < source.length && !/[,}\]\s]/u.test(source[cursor])) cursor += 1;
    return {start, end: cursor};
};

/** @param {string} source @param {JsonPosition} position */
const memberIndent = (source, position) => {
    const first = position.entries?.values().next().value;
    if (first === undefined) {
        const lineStart = source.lastIndexOf('\n', position.start) + 1;
        return `${/^\s*/u.exec(source.slice(lineStart, position.start))?.[0] ?? ''}  `;
    }
    const lineStart = source.lastIndexOf('\n', first.start) + 1;
    return /^\s*/u.exec(source.slice(lineStart, first.start))?.[0] ?? '';
};

/**
 * Add missing object members without rewriting any existing JSON text.
 * Validation of known fields belongs to the owning configuration module.
 * @param {{sourceBytes: Buffer, defaults: Record<string, unknown>}} input
 * @returns {{bytes: Buffer, changed: boolean}}
 */
export const completeConfigurationBytes = ({sourceBytes, defaults}) => {
    const parsed = parseJsonText(sourceBytes);
    if (parsed.status !== 'succeeded' || !isJsonObject(parsed.value)) throw new Error('Configuration must be a valid UTF-8 JSON object.');
    const source = sourceBytes.toString('utf8');
    const root = scanValue(source, 0);
    /** @type {{offset: number, text: string}[]} */
    const edits = [];
    /** @param {JsonPosition} position @param {Record<string, unknown>} expected */
    const collect = (position, expected) => {
        if (!position.entries) throw new Error('Configuration default parent is not an object.');
        /** @type {[string, unknown][]} */
        const missing = [];
        for (const [key, value] of Object.entries(expected)) {
            const child = position.entries.get(key);
            if (child === undefined) missing.push([key, value]);
            else if (isJsonObject(value)) collect(child, value);
        }
        if (missing.length === 0) return;
        const pretty = source.slice(position.start, position.end).includes('\n');
        const separator = pretty ? `\n${memberIndent(source, position)}` : '';
        const members = missing.map(([key, value]) => `${JSON.stringify(key)}:${pretty ? ' ' : ''}${JSON.stringify(value)}`).join(`,${separator}`);
        const last = [...position.entries.values()].at(-1);
        edits.push({
            offset: last?.end ?? position.start + 1,
            text: `${last ? ',' : ''}${separator}${members}`,
        });
    };
    collect(root, defaults);
    if (edits.length === 0) return {bytes: Buffer.from(sourceBytes), changed: false};
    let result = source;
    for (const edit of edits.sort((left, right) => right.offset - left.offset)) {
        result = `${result.slice(0, edit.offset)}${edit.text}${result.slice(edit.offset)}`;
    }
    return {bytes: Buffer.from(result, 'utf8'), changed: true};
};

/**
 * Remove the named top-level members, leaving all other JSON text untouched.
 * @param {{sourceBytes: Buffer, keys: readonly string[]}} input
 * @returns {{bytes: Buffer, removed: string[]}}
 */
export const removeConfigurationMembers = ({sourceBytes, keys}) => {
    let source = sourceBytes.toString('utf8');
    const removed = [];
    for (const key of keys) {
        const entries = [.../** @type {Map<string, JsonPosition>} */ (scanValue(source, 0).entries)];
        const index = entries.findIndex(([name]) => name === key);
        if (index === -1) continue;
        const position = entries[index][1];
        const next = entries[index + 1]?.[1];
        const start = next === undefined && index > 0 ? entries[index - 1][1].end : /** @type {number} */ (position.keyStart);
        source = `${source.slice(0, start)}${source.slice(next?.keyStart ?? position.end)}`;
        removed.push(key);
    }
    return {bytes: Buffer.from(source, 'utf8'), removed};
};
