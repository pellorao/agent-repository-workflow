import {canPlanRoute, dispatchRoute} from './runtime.mjs';
import {previewPlan, savePlan} from './storage.mjs';

export const executeAuthorizedPlan = async (/** @type {any} */ {actor, dispatch, now, route}) => unlessForbidden(canPlanRoute(actor, route, now), await dispatchRoute(dispatch, route));

const unlessForbidden = (/** @type {boolean} */ allowed, /** @type {any} */ outcome) => allowed ? outcome : {ok: false, error: 'forbidden'};

export const executeDryRun = (/** @type {any} */ plan) => previewPlan(plan);

export const planFailure = (/** @type {any} */ error) => ({ok: false, error: String(error)});

export const runEligibleStops = (/** @type {any[]} */ stops, /** @type {any} */ dispatch) => stops.filter(stop => stop.state !== 'cancelled').map(dispatch);

export const emitPlanCreated = async (/** @type {any} */ {emitter, input}) => {
    const pending = savePlan({...input, onStored: () => emitter.emit('plan.created', input.plan.id)});
    return pending;
};

export const pendingStops = (/** @type {any[]} */ stops) => stops.filter(stop => stop.state !== 'delivered');
