export const reviewerCapabilitySelectObjectFields = (/** @type {Record<string, unknown>} */ object, /** @type {string[]} */ fields) => Object.fromEntries(
    fields.map((field) => [field, object[field]]),
);
