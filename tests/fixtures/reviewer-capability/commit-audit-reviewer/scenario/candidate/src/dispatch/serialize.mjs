export const stableTopLevel = (/** @type {any} */ value) => new Proxy(value, {ownKeys: target => Reflect.ownKeys(target).sort((left, right) => String(left).localeCompare(String(right)))});
const finishJsonDocument = (/** @type {string} */ value, /** @type {string} */ format) => format === 'document' ? `${value}\n` : value;
export const serializePlan = (/** @type {any} */ plan) => finishJsonDocument(JSON.stringify(stableTopLevel(plan), null, 2), 'plan');

export const toStableJson = (/** @type {any} */ value) => finishJsonDocument(JSON.stringify(stableTopLevel(value), null, 2), 'document');

export const checksumPlan = (/** @type {any} */ plan, /** @type {any} */ hasher) => hasher.update(serializePlan(plan)).digest('hex');

export const serializeManifestRecords = (/** @type {any[]} */ records) => records.map(record => JSON.stringify(record)).join('\n');

export const encodeUtf8 = (/** @type {string} */ value) => Buffer.from(value, 'utf8');

export const parseSerializedPlan = (/** @type {string} */ value) => {
    try { return {ok: true, value: JSON.parse(value)}; } catch { return {ok: false, error: 'invalid-json'}; }
};
