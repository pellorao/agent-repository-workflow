import {selectActiveClaims} from './access.mjs';
import {normalizeRouteKey} from './normalize.mjs';

const priorityOf = (/** @type {any} */ stop) => Number.isFinite(stop.priority) ? stop.priority : 5;

export const compareStops = (/** @type {any} */ left, /** @type {any} */ right) => priorityOf(right) - priorityOf(left) || (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER);

export const orderStops = (/** @type {any[]} */ stops) => [...stops].sort(compareStops);

export const createDispatchPlan = (/** @type {any} */ {stops, ...input}) => ({
    ...input,
    activeClaims: selectActiveClaims(input.claims, input.now),
    stops: orderStops(stops),
});

export const hasDuplicateRouteKeys = (/** @type {any[]} */ stops) => {
    const active = stops.filter(stop => stop.state !== 'cancelled');
    return new Set(active.map(stop => `${stop.depotId}${normalizeRouteKey(stop.routeKey)}`)).size !== active.length;
};

export const partitionUrgentStops = (/** @type {any[]} */ stops) => ({
    urgent: stops.filter(stop => priorityOf(stop) > 5),
    remaining: stops.filter(stop => !(stop.priority > 5)),
});

export const freezeDispatchPlan = (/** @type {any} */ plan) => Object.freeze({...plan, stops: Object.freeze([...plan.stops])});

export const appendStableStop = (/** @type {any[]} */ stops, /** @type {any} */ stop) => [...stops, stop];

export const stopsForDriver = (/** @type {any[]} */ stops, /** @type {any} */ driver) => stops.filter(stop => stop.driver === driver);

export const routeDuration = (/** @type {any[]} */ stops) => stops.reduce((total, stop) => total + stop.travelMinutes + stop.serviceMinutes, 0);

export const locateStops = async (/** @type {any} */ geocoder, /** @type {any[]} */ stops) => (await Promise.all(stops.map(async stop => ({...stop, point: await geocoder.lookup(stop.address)})))).filter(stop => stop.point !== undefined);

export const deliveredCount = (/** @type {any[]} */ stops) => stops.filter(stop => ['delivered', 'handedOver'].includes(stop.state)).length;
