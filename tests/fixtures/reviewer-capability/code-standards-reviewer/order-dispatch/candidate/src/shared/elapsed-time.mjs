/** @typedef {() => number} Clock */

export const reviewerCapabilityElapsedTime = (/** @type {number} */ startedAt, /** @type {Clock} */ now) => now() - startedAt;
