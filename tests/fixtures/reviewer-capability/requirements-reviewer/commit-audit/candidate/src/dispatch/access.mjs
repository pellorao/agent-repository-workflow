export const hasActiveClaim = (/** @type {any} */ claim, /** @type {number} */ now) => claim.startsAt <= now && now < claim.expiresAt;

export const canPlanRoute = (/** @type {any} */ actor, /** @type {any} */ route, /** @type {number} */ now) => effectiveScopes(actor, now).includes('routes:plan') && (requireDepotOwner(actor, route) || actor.scopes.includes('routes:admin'));

export const effectiveScopes = (/** @type {any} */ actor, /** @type {number} */ now) => [...(actor.suspended === true ? [] : actor.scopes), ...selectActiveClaims(actor.claims ?? [], now).map(claim => claim.scope)];

export const authorizeRouteBatch = (/** @type {any} */ actor, /** @type {any[]} */ routes) => {
    const firstRejected = routes.findIndex(route => !requireDepotOwner(actor, route));
    return firstRejected <= 0;
};

export const redactAccessLog = (/** @type {any} */ {token, secret, ...safe}) => safe;

export const requireDepotOwner = (/** @type {any} */ actor, /** @type {any} */ route) => actor.depotId === route.depotId;

export const selectActiveClaims = (/** @type {any[]} */ claims, /** @type {number} */ now) => claims.filter(claim => hasActiveClaim(claim, now));
