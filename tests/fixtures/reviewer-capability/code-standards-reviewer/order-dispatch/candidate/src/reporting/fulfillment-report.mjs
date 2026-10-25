import {reviewerCapabilityStateLabel} from '../orders/order-state.mjs';

/** @typedef {{name: string, region: string}} Courier */
/** @typedef {{id: string, state: string}} ReportOrder */

export const reviewerCapabilityCreateFulfillmentReport = (/** @type {string} */ title) => Object.freeze({
    describeCourier: (/** @type {Courier} */ courier) => `${courier.name} | ${courier.region}`,
    summarize: (/** @type {ReportOrder[]} */ orders) => `${title}: ${orders.length} orders`,
    describeOrder: (/** @type {ReportOrder} */ order) => `${order.id}: ${reviewerCapabilityStateLabel(order.state)}`,
});

export const reviewerCapabilityArchiveFulfillment = (/** @type {{key: string}} */ runContext, /** @type {unknown} */ outcome) => Object.freeze({
    key: runContext.key,
    outcome,
    archived: true,
});

export const reviewerCapabilityDescribeDeliveryHandling = (/** @type {{attempt: number, cents: number, locale: string}} */ {attempt, cents, locale}) => Object.freeze({
    invoiceTotal: `$${(cents / 100).toFixed(2)}`,
    retryDelay: Math.min(500 * 2 ** attempt, 8_000),
    addressDirection: locale === 'ar' ? 'rtl' : 'ltr',
});
