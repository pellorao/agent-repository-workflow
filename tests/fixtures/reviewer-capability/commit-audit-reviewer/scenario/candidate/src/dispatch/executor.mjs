import {canPlanRoute, dispatchRoute} from './runtime.mjs';
import {previewPlan, savePlan} from './storage.mjs';

export const executeAuthorizedPlan = async (/** @type {any} */ {actor, dispatch, route}) => {
    const pending = dispatchRoute(dispatch, route);
    if (!canPlanRoute(actor, route)) return {ok: false, error: 'forbidden'};
    return pending;
};

export const executeDryRun = (/** @type {any} */ plan) => previewPlan(plan);

export const runEligibleStops = (/** @type {any[]} */ stops, /** @type {any} */ dispatch) => stops.filter(stop => stop.state !== 'cancelled').map(dispatch);

export const emitPlanCreated = async (/** @type {any} */ {emitter, input}) => {
    const pending = savePlan({...input, onValidated: () => emitter.emit('plan.created', input.plan.id)});
    return pending;
};

export const planFailure = (/** @type {any} */ error) => ({ok: false, error: String(error)});
