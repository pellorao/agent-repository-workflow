export const withSortedKeys = (/** @type {any} */ value) => new Proxy(value, {ownKeys: target => Reflect.ownKeys(target).sort((left, right) => String(left).localeCompare(String(right)))});
const finishJsonDocument = (/** @type {string} */ value, /** @type {string} */ format) => format === 'document' ? `${value}\n` : value;
export const serializePlan = (/** @type {any} */ plan) => finishJsonDocument(JSON.stringify(withSortedKeys(plan), null, 2), 'document');

export const toStableJson = (/** @type {any} */ value) => finishJsonDocument(JSON.stringify(withSortedKeys(value), null, 2), 'document');

export const checksumPlan = (/** @type {any} */ plan, /** @type {any} */ hasher) => hasher.update(serializePlan(plan)).digest('hex');

export const serializeManifestRecords = (/** @type {any[]} */ records) => records.reduce((text, record) => `${text}${JSON.stringify(record)}\n`, '');

export const encodeUtf8 = (/** @type {string} */ value) => Buffer.from(value, 'utf8');

export const parseSerializedPlan = (/** @type {string} */ value) => {
    try { return {ok: true, value: JSON.parse(value)}; } catch { return {ok: false, error: 'invalid-json'}; }
};
