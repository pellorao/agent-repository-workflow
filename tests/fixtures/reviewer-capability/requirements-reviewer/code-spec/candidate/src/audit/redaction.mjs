export const REDACTED = '[redacted]';

const SENSITIVE_KEYS = Object.freeze(['note', 'email', 'phone']);

const isSensitive = (key) => SENSITIVE_KEYS.includes(key.toLowerCase());

const isPlainObject = (value) => (
    typeof value === 'object' && value !== null && [Object.prototype, null].includes(Object.getPrototypeOf(value))
);

export const redact = (value) => {
    if (Array.isArray(value)) return value.map(redact);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, isSensitive(key) ? REDACTED : redact(inner)]));
};
