const setting = 'include_collaboration_mode_instructions';
const utf8BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** @param {Buffer} bytes */
const withoutBOM = bytes => bytes.subarray(bytes.subarray(0, 3).equals(utf8BOM) ? 3 : 0);

/** @param {string} text */
const parseConfiguration = text => {
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text) || /\r(?!\n)/u.test(text)) throw new Error('Invalid TOML control character.');
    let offset = 0;
    /** @type {Set<unknown[]>} */
    const tableArrays = new Set();
    /** @type {Set<Map<string, unknown>>} */
    const declared = new Set();
    /** @type {Set<Map<string, unknown>>} */
    const sealed = new Set();
    const fail = () => { throw new Error(`Unsupported or invalid TOML at offset ${offset}.`); };
    const spaces = () => { while (text[offset] === ' ' || text[offset] === '\t') offset += 1; };
    const whitespace = () => {
        while (offset < text.length) {
            if (/\s/u.test(text[offset]) && /[ \t\r\n]/u.test(text[offset])) { offset += 1; continue; }
            if (text[offset] === '#') { while (offset < text.length && text[offset] !== '\n') offset += 1; continue; }
            break;
        }
    };
    /** @param {boolean} allowMultiline @returns {string} */
    const string = allowMultiline => {
        const quote = text[offset];
        const multiline = allowMultiline && text.slice(offset, offset + 3) === quote.repeat(3);
        offset += multiline ? 3 : 1;
        if (multiline && text[offset] === '\r' && text[offset + 1] === '\n') offset += 2;
        else if (multiline && text[offset] === '\n') offset += 1;
        let result = '';
        while (offset < text.length) {
            if (text[offset] === quote) {
                if (!multiline) { offset += 1; return result; }
                let count = 0;
                while (text[offset + count] === quote) count += 1;
                if (count >= 3) {
                    if (count > 5) fail();
                    offset += count;
                    return result + quote.repeat(count - 3);
                }
            }
            const character = text[offset++];
            if ((!multiline && /[\r\n]/u.test(character)) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(character)) fail();
            if (quote !== '"' || character !== '\\') { result += character; continue; }
            if (multiline && /[ \t\r\n]/u.test(text[offset] ?? '')) {
                spaces();
                if (text[offset] !== '\n' && text.slice(offset, offset + 2) !== '\r\n') fail();
                while (offset < text.length && /[ \t\r\n]/u.test(text[offset])) offset += 1;
                continue;
            }
            const escape = text[offset++];
            /** @type {Record<string, string>} */
            const escapes = {b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\'};
            if (Object.hasOwn(escapes, escape)) { result += escapes[escape]; continue; }
            if (escape !== 'u' && escape !== 'U') fail();
            const count = escape === 'u' ? 4 : 8;
            const digits = text.slice(offset, offset + count);
            if (digits.length !== count || !/^[0-9a-f]+$/iu.test(digits)) fail();
            const point = Number.parseInt(digits, 16);
            if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) fail();
            result += String.fromCodePoint(point);
            offset += count;
        }
        return fail();
    };
    /** @returns {string[]} */
    const key = () => {
        const parts = [];
        while (true) {
            spaces();
            if (text[offset] === '"' || text[offset] === "'") parts.push(string(false));
            else {
                const match = /^[A-Za-z0-9_-]+/u.exec(text.slice(offset));
                if (match === null) return fail();
                parts.push(match[0]); offset += match[0].length;
            }
            spaces();
            if (text[offset] !== '.') return parts;
            offset += 1;
        }
    };
    /** @param {Map<string, unknown>} table @param {string[]} parts @returns {Map<string, unknown>} */
    const descend = (table, parts) => {
        for (const part of parts) {
            if (sealed.has(table)) fail();
            if (!table.has(part)) table.set(part, new Map());
            let next = table.get(part);
            if (Array.isArray(next)) { if (!tableArrays.has(next)) return fail(); next = next.at(-1); }
            if (!(next instanceof Map) || sealed.has(next)) return fail();
            table = next;
        }
        return table;
    };
    /** @param {Map<string, unknown>} table @param {string[]} parts @param {unknown} value */
    const assign = (table, parts, value) => {
        for (const part of parts.slice(0, -1)) { table = descend(table, [part]); declared.add(table); }
        const name = parts.at(-1);
        if (name === undefined || table.has(name) || sealed.has(table)) return fail();
        table.set(name, value);
    };
    /** @returns {unknown} */
    const value = () => {
        spaces();
        if (text[offset] === '"' || text[offset] === "'") return string(true);
        if (text[offset] === '[') {
            offset += 1; whitespace();
            const values = [];
            while (text[offset] !== ']') {
                values.push(value()); whitespace();
                if (text[offset] === ']') break;
                if (text[offset++] !== ',') fail();
                whitespace();
            }
            offset += 1; return values;
        }
        if (text[offset] === '{') {
            offset += 1; spaces();
            const table = new Map();
            while (text[offset] !== '}') {
                const parts = key();
                if (text[offset++] !== '=') fail();
                assign(table, parts, value()); spaces();
                if (text[offset] === '}') break;
                if (text[offset++] !== ',') fail();
                spaces();
                if (text[offset] === '}') fail();
            }
            offset += 1; sealed.add(table); return table;
        }
        const start = offset;
        while (offset < text.length && !/[\r\n,#\]}]/u.test(text[offset])) offset += 1;
        const token = text.slice(start, offset).replace(/[ \t]+$/u, '');
        if (token === 'true') return true;
        if (token === 'false') return false;
        if (/^[+-]?(?:inf|nan)$/u.test(token)) return token;
        if (/^[+-]?(?:0|[1-9](?:_?\d)*)(?:\.(?:\d(?:_?\d)*))?(?:[eE][+-]?\d(?:_?\d)*)?$/u.test(token)
            || /^0(?:x[0-9a-fA-F](?:_?[0-9a-fA-F])*|o[0-7](?:_?[0-7])*|b[01](?:_?[01])*)$/u.test(token)) return token;
        if (/^\d{4}-\d{2}-\d{2}(?:[Tt ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/u.test(token)
            && !Number.isNaN(Date.parse(token))) {
            const [year, month, day] = token.slice(0, 10).split('-').map(Number);
            const calendar = new Date(0);
            calendar.setUTCFullYear(year, month - 1, day);
            if (calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day) return token;
        }
        if (/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?$/u.test(token)) return token;
        return fail();
    };
    /** @type {Map<string, unknown>} */
    const root = new Map();
    let current = root;
    while (offset < text.length) {
        whitespace();
        if (offset === text.length) break;
        if (text[offset] === '[') {
            offset += 1;
            const array = text[offset] === '[';
            if (array) offset += 1;
            const parts = key();
            if (text[offset++] !== ']' || (array && text[offset++] !== ']')) fail();
            const parent = descend(root, parts.slice(0, -1));
            const name = /** @type {string} */ (parts.at(-1));
            if (array) {
                if (!parent.has(name)) { const items = /** @type {unknown[]} */ ([]); tableArrays.add(items); parent.set(name, items); }
                const items = parent.get(name);
                if (!Array.isArray(items) || !tableArrays.has(items)) return fail();
                current = new Map(); items.push(current);
            } else {
                if (Array.isArray(parent.get(name))) fail();
                current = descend(parent, [name]);
                if (declared.has(current)) fail();
                declared.add(current);
            }
        } else {
            const parts = key();
            if (text[offset++] !== '=') fail();
            assign(current, parts, value());
        }
        spaces();
        if (text[offset] === '#') while (offset < text.length && text[offset] !== '\n') offset += 1;
        if (offset < text.length && text[offset] !== '\n' && text.slice(offset, offset + 2) !== '\r\n') fail();
        if (text[offset] === '\r') offset += 1;
        if (text[offset] === '\n') offset += 1;
    }
    return root;
};

/** @param {{sourceBytes: Buffer | null, defaultBytes: Buffer}} input */
export const prepareCodexConfiguration = ({sourceBytes, defaultBytes}) => {
    try {
        const decoder = new TextDecoder('utf-8', {fatal: true});
        const defaults = parseConfiguration(decoder.decode(defaultBytes));
        if (defaults.get(setting) !== false) throw new Error('Codex default configuration must disable mode instructions.');
        const source = sourceBytes === null ? new Map() : parseConfiguration(decoder.decode(sourceBytes));
        const present = source.has(setting);
        if (present && typeof source.get(setting) !== 'boolean') throw new Error('Codex mode instruction setting must be a root boolean.');
        const bytes = present ? Buffer.from(/** @type {Buffer} */ (sourceBytes))
            : sourceBytes === null ? Buffer.from(defaultBytes)
                : Buffer.concat([
                    sourceBytes.subarray(0, sourceBytes.length - withoutBOM(sourceBytes).length),
                    withoutBOM(defaultBytes),
                    defaultBytes.at(-1) === 10 ? Buffer.alloc(0) : Buffer.from('\n'),
                    withoutBOM(sourceBytes),
                ]);
        return {status: /** @type {'succeeded'} */ ('succeeded'), diagnostics: [], present, changed: !present, bytes};
    } catch (error) {
        return {status: /** @type {'blocked'} */ ('blocked'), diagnostics: [{code: 'codex-configuration-invalid', message: error instanceof Error ? error.message : 'Invalid Codex configuration.'}]};
    }
};
