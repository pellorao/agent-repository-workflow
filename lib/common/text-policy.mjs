const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16_LITTLE_ENDIAN_BOM = Buffer.from([0xff, 0xfe]);
const UTF16_BIG_ENDIAN_BOM = Buffer.from([0xfe, 0xff]);

/** @typedef {{fixedBytes: null, issues: string[], kind: 'binary'} | {fixedBytes: Buffer | null, issues: string[], kind: 'text'}} TextInspection */

/** @param {Buffer} bytes */
const looksLikeBinary = bytes => {
    if (
        bytes.subarray(0, 2).equals(UTF16_LITTLE_ENDIAN_BOM)
        || bytes.subarray(0, 2).equals(UTF16_BIG_ENDIAN_BOM)
    ) return false;

    const sample = bytes.subarray(0, 8192);
    let disallowedControls = 0;
    for (const byte of sample) {
        if (byte === 0) return true;
        if (byte < 32 && ![9, 10, 13].includes(byte)) disallowedControls += 1;
    }
    return sample.length > 0 && disallowedControls / sample.length > 0.3;
};

/** @param {Buffer} bytes @returns {TextInspection} */
export const inspectTextBytes = bytes => {
    if (looksLikeBinary(bytes)) return {fixedBytes: null, issues: [], kind: 'binary'};

    const hasBom = bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM);
    const content = hasBom ? bytes.subarray(UTF8_BOM.length) : bytes;
    let text;
    try {
        text = new TextDecoder('utf-8', {fatal: true}).decode(content);
    } catch {
        return {fixedBytes: null, issues: ['invalid-utf8'], kind: 'text'};
    }
    const issues = [];

    if (hasBom) issues.push('utf8-bom');
    if (text.includes('\r\n')) issues.push('crlf');
    if (/\r(?!\n)/u.test(text)) issues.push('cr');

    return {
        fixedBytes: issues.length === 0
            ? null
            : Buffer.from(text.replaceAll('\r\n', '\n').replaceAll('\r', '\n'), 'utf8'),
        issues,
        kind: 'text',
    };
};

/** @param {unknown} input */
export const validateText = input => {
    if (typeof input !== 'string' && !Buffer.isBuffer(input)) {
        throw new TypeError('Text Policy input must be a string or Buffer.');
    }
    const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
    const inspection = inspectTextBytes(bytes);
    if (inspection.kind !== 'text') {
        return {
            diagnostics: [{code: 'text-binary', message: 'The input is not text.'}],
            status: 'blocked',
        };
    }
    if (inspection.issues.length > 0) {
        return {
            diagnostics: inspection.issues.map(code => ({code, message: `Text policy violation: ${code}.`})),
            status: 'blocked',
        };
    }
    return {bytes, diagnostics: [], status: 'succeeded'};
};

/** @param {unknown} text @returns {{bytes: Buffer, diagnostics: never[], status: 'succeeded'}} */
export const generateText = text => {
    if (typeof text !== 'string') throw new TypeError('Generated text must be a string.');
    const withoutBom = text.replace(/^\uFEFF+/u, '');
    const normalized = withoutBom.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    const complete = normalized.endsWith('\n') ? normalized : `${normalized}\n`;
    return {bytes: Buffer.from(complete, 'utf8'), diagnostics: [], status: 'succeeded'};
};
