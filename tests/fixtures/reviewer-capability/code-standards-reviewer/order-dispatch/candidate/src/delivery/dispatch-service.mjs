import {reviewerCapabilitySelectCarrier} from './carrier-policy.mjs';
import reviewerCapabilityEstimateDeliveryDays from './service-levels.mjs';

/** @typedef {{id: string, serviceLevels: string[]} & Record<string, unknown>} Carrier */
/** @typedef {{checkout: {order: {customer: {profile: {address: {region: string}}}, id: string}}}} DispatchContext */
/** @typedef {{carrier?: Carrier | null, courierId?: string, deliveryDays?: number, fee?: number, request?: Readonly<{orderId: string, region: string}>} & Record<string, unknown>} Dispatch */

export const formatCarrierReference = (/** @type {string} */ orderId) => `carrier:${orderId}`;

export const reviewerCapabilityAssignCourier = (/** @type {Dispatch} */ dispatch, /** @type {string} */ courierId) => {
    dispatch.courierId = courierId;
    return dispatch;
};

export const reviewerCapabilityBuildDispatchRequest = (/** @type {DispatchContext} */ context) => Object.freeze({
    orderId: context.checkout.order.id,
    region: context.checkout.order.customer.profile.address.region,
});

export const reviewerCapabilityDeliveryFee = (/** @type {string} */ serviceLevel) => {
    switch (serviceLevel) {
        case 'express': return 1_500;
        case 'standard': return 500;
        default: return 0;
    }
};

export const reviewerCapabilityCreateDispatch = (/** @type {{carriers: Carrier[], context: DispatchContext, serviceLevel: string}} */ {carriers, context, serviceLevel}) => Object.freeze({
    carrier: reviewerCapabilitySelectCarrier(carriers, serviceLevel),
    deliveryDays: reviewerCapabilityEstimateDeliveryDays(serviceLevel),
    fee: reviewerCapabilityDeliveryFee(serviceLevel),
    request: reviewerCapabilityBuildDispatchRequest(context),
});

/** @typedef {{status: string, trust: string}} DispatchDecision */

export const reviewerCapabilityCreateDispatchDecision = (/** @type {DispatchDecision} */ {status, trust}) => Object.freeze({
    status,
    trust,
    canDispatch: () => status === 'approved' && trust === 'trusted',
});
