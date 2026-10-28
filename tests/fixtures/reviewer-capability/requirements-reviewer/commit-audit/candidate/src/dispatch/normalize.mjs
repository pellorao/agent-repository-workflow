const asText = (/** @type {any} */ value) => String(value);

export const normalizeRouteKey = (/** @type {any} */ value) => asText(value).normalize('NFKC').trim().toUpperCase();

export const preserveDriverLabel = (/** @type {any} */ value) => asText(value).trim();

export const normalizeDepotAlias = (/** @type {any} */ value) => asText(value).trim().toLowerCase();

export const normalizeDestination = (/** @type {any} */ value) => asText(value).normalize('NFKC').trim().toUpperCase();

export const normalizePackageIds = (/** @type {any[]} */ values) => [...new Set(values.map(value => asText(value).trim()))].sort();

export const formatRouteToken = (/** @type {any} */ {routeKey, destination}) => normalizeDestination(destination) + ':' + normalizeRouteKey(routeKey);
