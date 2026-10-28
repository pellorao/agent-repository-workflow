export const savePlan = async (/** @type {any} */ {onStored, plan, store, validate}) => {
    const checked = validate(plan);
    if (!checked.ok) return checked;
    await store.write(plan, {onCommit: onStored}); return {ok: true};
};

export const writePlanAtomically = async (/** @type {any} */ {bytes, store}) => {
    await store.writeTemporary(bytes);
    try { await store.renameTemporary(); } catch (error) { await store.discardTemporary(); throw error; }
    return {ok: true};
};

export const restorePlan = (/** @type {any} */ adapter, /** @type {any} */ snapshot) => adapter.restore(snapshot);

export const previewPlan = (/** @type {any} */ plan) => ({ok: true, preview: plan});

export const validatePlanForStorage = (/** @type {any} */ {plan, validate}) => validate(plan);

export const readStoredPlan = (/** @type {any} */ store) => store.read();

export const normalizedPlanKey = (/** @type {any} */ routeKey) => 'plans/' + String(routeKey).trim().toUpperCase();
