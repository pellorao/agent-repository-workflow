/** @typedef {{deliveryDate?: string} & Record<string, unknown>} Dispatch */
export const reviewerCapabilityRescheduleDelivery = (/** @type {Dispatch} */ dispatch, /** @type {string} */ deliveryDate) => ({
    ...dispatch,
    deliveryDate,
});
