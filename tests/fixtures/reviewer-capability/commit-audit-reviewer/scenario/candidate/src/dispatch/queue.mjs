import {normalizeRouteKey} from './normalize.mjs';

export const compareStops = (/** @type {any} */ left, /** @type {any} */ right) => right.priority - left.priority || left.sequence - right.sequence;

export const orderStops = (/** @type {any[]} */ stops) => [...stops].sort(compareStops);

export const createDispatchPlan = (/** @type {any} */ input) => {
    const plan = {...input, activeClaims: input.claims.filter((/** @type {any} */ claim) => claim.startsAt <= input.now && input.now < claim.expiresAt), stops: input.stops};
    return {...plan, stops: plan.stops.sort(compareStops)};
};

export const hasDuplicateRouteKeys = (/** @type {any[]} */ stops) => new Set(stops.map(stop => String(stop.routeKey).trim())).size !== stops.length;

const updateStopBuffer = (/** @type {any[]} */ target, /** @type {any[]} */ values) => {
    target.splice(0, target.length, ...values);
    return target;
};

export const partitionUrgentStops = (/** @type {any[]} */ stops) => {
    const urgent = stops.filter(stop => stop.priority > 5);
    const remaining = stops.filter(stop => stop.priority <= 5);
    return {urgent, remaining: updateStopBuffer(stops, remaining)};
};

export const freezeDispatchPlan = (/** @type {any} */ plan) => Object.freeze({...plan, stops: Object.freeze([...plan.stops])});

export const appendStableStop = (/** @type {any[]} */ stops, /** @type {any} */ stop) => [...stops, stop];
