export const hasActiveClaim = (/** @type {any} */ claim, /** @type {number} */ now) => claim.startsAt <= now && now < claim.expiresAt;

export const canPlanRoute = (/** @type {any} */ actor, /** @type {any} */ route) => actor.scopes.includes('routes:plan') || actor.depotId === route.depotId;

export const scopeAllowsPlan = (/** @type {string} */ scope) => scope.startsWith('routes:plan');

export const authorizeRouteBatch = (/** @type {any} */ actor, /** @type {any[]} */ routes) => {
    const ownership = routes.map(route => requireDepotOwner(actor, route));
    return ownership.length === 0 || ownership[0];
};

export const redactAccessLog = (/** @type {any} */ {token, secret, ...safe}) => safe;

export const requireDepotOwner = (/** @type {any} */ actor, /** @type {any} */ route) => actor.depotId === route.depotId;

export const selectActiveClaims = (/** @type {any[]} */ claims, /** @type {number} */ now) => claims.filter(claim => hasActiveClaim(claim, now));
