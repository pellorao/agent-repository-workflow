export const loadAllowedRegions = (/** @type {any} */ provider) => provider.load();

export const isAllowedRegion = (/** @type {any[]} */ regions, /** @type {any} */ region) => regions.includes(region);

export const policyVersion = (/** @type {any} */ policy) => policy.version;

export const selectRegionPolicy = (/** @type {any[]} */ policies, /** @type {any} */ region) => policies.find(policy => policy.region === region) ?? null;
