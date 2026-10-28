const MAX_INSTANT = 8.64e15;

const isMissing = (value) => value === undefined || value === null;

const FORMULA_START = /^[=+\-@]/;

const formatText = (value) => {
    if (typeof value !== 'string') throw new Error('text value is invalid');
    return FORMULA_START.test(value) ? `'${value}` : value;
};

const formatInteger = (value) => {
    if (!Number.isSafeInteger(value)) throw new Error('integer value is invalid');
    return String(value);
};

const formatTimestamp = (value) => {
    if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_INSTANT) throw new Error('timestamp value is invalid');
    return new Date(value).toISOString();
};

const formatBoolean = (value) => {
    if (typeof value !== 'boolean') throw new Error('boolean value is invalid');
    return value ? 'true' : 'false';
};

const formatList = (value) => {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error('list value is invalid');
    return value.map(formatText).join(';');
};

export const FORMATTERS = Object.freeze({
    text: formatText,
    integer: formatInteger,
    timestamp: formatTimestamp,
    boolean: formatBoolean,
    list: formatList,
});

export const formatValue = (kind, value) => (isMissing(value) ? '' : FORMATTERS[kind](value));
