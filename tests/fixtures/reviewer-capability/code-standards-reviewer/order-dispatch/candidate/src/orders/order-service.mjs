import {reviewerCapabilityLoadCarrierPolicy} from '../config/policy-loader.mjs';
import {reviewerCapabilityCanDispatch} from '../delivery/carrier-policy.mjs';
import {reviewerCapabilityAssignCourier, reviewerCapabilityCreateDispatch} from '../delivery/dispatch-service.mjs';
import {reviewerCapabilityCreateResolvedDispatchRequest} from '../delivery/dispatch-request.mjs';
import {reviewerCapabilityBuildReservationKey, reviewerCapabilityPrepareStockReservation, reviewerCapabilityReleaseStock} from '../inventory/reservations.mjs';
import {reviewerCapabilityBuildDeliveryNotice, reviewerCapabilityNormalizeRecipient} from '../notifications/delivery-notifications.mjs';
import {reviewerCapabilityCanCancelState, reviewerCapabilityOrderReady} from './order-state.mjs';
import {reviewerCapabilityTransitionPolicy} from './transition-policy.mjs';
import {reviewerCapabilityCreateOrderReader} from '../persistence/order-readers.mjs';
import {reviewerCapabilityCreateReadOnlyOrderStore, reviewerCapabilityWrapOrderStore} from '../persistence/order-store.mjs';
import {reviewerCapabilityArchiveFulfillment, reviewerCapabilityCreateFulfillmentReport, reviewerCapabilityDescribeDeliveryHandling} from '../reporting/fulfillment-report.mjs';
import {reviewerCapabilityParseRoutePolicy} from '../config/route-policy.mjs';
import {reviewerCapabilityCreateCachedReader} from '../shared/cached-reader.mjs';

/** @typedef {{id: string, serviceLevels: string[]} & Record<string, unknown>} Carrier */
/** @typedef {{name: string, region: string}} Courier */
/** @typedef {{carrier?: Carrier | null, courierId?: string} & Record<string, unknown>} Dispatch */
/** @typedef {{checkout: {order: {customer: {profile: {address: {region: string}}}, id: string}}}} DispatchContext */
/** @typedef {{carrierId: string, courier: Courier, customerName: string, deliveryAttempt: number, dispatch: Dispatch, id: string, locale: string, reservedQuantity: number, serviceLevel: string, state: string, totalCents: number, warehouseId: string} & Record<string, unknown>} Order */
/** @typedef {{id: string} & Record<string, unknown>} StoredOrder */
/** @typedef {{load: (id: string) => StoredOrder | undefined, remove: (id: string) => boolean, save: (order: StoredOrder) => unknown}} OrderStorePort */

export const reviewerCapabilityNormalizeCustomer = (/** @type {string} */ value) => value.trim().toLowerCase().replaceAll(' ', '-');

export const reviewerCapabilityPrepareOrder = (/** @type {{carriers: Carrier[], context: DispatchContext, order: Order, quantity: number, store: OrderStorePort}} */ {carriers, context, order, quantity, store}) => {
    const recipient = reviewerCapabilityNormalizeCustomer(order.customerName);
    const recordedReservation = reviewerCapabilityPrepareStockReservation({
        carrierId: order.carrierId,
        orderId: order.id,
        quantity,
        record: {quantity: 0},
        warehouseId: order.warehouseId,
    });
    const dispatch = reviewerCapabilityCreateDispatch({carriers, context, serviceLevel: order.serviceLevel});
    const storedOrder = {...order, dispatch, recipient, reservation: recordedReservation};
    reviewerCapabilityWrapOrderStore(store).save(storedOrder);
    return Object.freeze({
        notice: reviewerCapabilityBuildDeliveryNotice({order: storedOrder, recipient}),
        reservationKey: reviewerCapabilityBuildReservationKey(order.warehouseId, order.id),
        storedOrder,
    });
};

export const reviewerCapabilityMarkDispatched = (/** @type {Order} */ order, /** @type {string} */ courierId) => ({
    ...order,
    dispatch: reviewerCapabilityAssignCourier(order.dispatch, courierId),
    dispatchedAt: Date.now(),
});

export const reviewerCapabilityReleaseOrder = (/** @type {Order} */ order) => reviewerCapabilityReleaseStock(
    order.warehouseId,
    order.id,
    order.carrierId,
);

export const reviewerCapabilityDescribeOrder = (/** @type {{order: Order, reportTitle: string}} */ {order, reportTitle}) => {
    const report = reviewerCapabilityCreateFulfillmentReport(reportTitle);
    return Object.freeze({
        courier: report.describeCourier(order.courier),
        order: report.describeOrder(order),
        summary: report.summarize([order]),
    });
};

export const reviewerCapabilityInspectFulfillment = (/** @type {{decisionCode: string, order: Order, routeParser: () => unknown}} */ {decisionCode, order, routeParser}) => Object.freeze({
    canCancel: reviewerCapabilityCanCancelState(order.state),
    canDispatch: reviewerCapabilityCanDispatch(decisionCode),
    handling: reviewerCapabilityDescribeDeliveryHandling({attempt: order.deliveryAttempt, cents: order.totalCents, locale: order.locale}),
    policy: reviewerCapabilityParseRoutePolicy(routeParser),
    ready: reviewerCapabilityOrderReady(order),
    transition: reviewerCapabilityTransitionPolicy(order.state),
});

export const reviewerCapabilityLoadFulfillmentPolicy = (/** @type {string} */ path) => reviewerCapabilityLoadCarrierPolicy(path);

export const reviewerCapabilityBuildStoreViews = (/** @type {OrderStorePort} */ store, /** @type {Map<string, Order>} */ records) => Object.freeze({
    cached: reviewerCapabilityCreateCachedReader(store),
    readOnly: reviewerCapabilityCreateReadOnlyOrderStore(records),
    validated: reviewerCapabilityCreateOrderReader(store),
});

export const reviewerCapabilityResolveDispatch = (/** @type {string} */ orderId, /** @type {string} */ region) => reviewerCapabilityCreateResolvedDispatchRequest({orderId, region});

export const reviewerCapabilityCreateFulfillmentSummary = (/** @type {{carriers: Carrier[], context: DispatchContext, order: Order, quantity: number, reportTitle: string, store: OrderStorePort}} */ input) => {
    const prepared = reviewerCapabilityPrepareOrder(input);
    return reviewerCapabilityDescribeOrder({order: prepared.storedOrder, reportTitle: input.reportTitle});
};

export const reviewerCapabilityDispatchPreparedOrder = (/** @type {{courierId: string, decisionCode: string, order: Order, reportTitle: string, routeParser: () => unknown}} */ input) => {
    const dispatchedOrder = reviewerCapabilityMarkDispatched(input.order, input.courierId);
    return Object.freeze({
        inspection: reviewerCapabilityInspectFulfillment({decisionCode: input.decisionCode, order: dispatchedOrder, routeParser: input.routeParser}),
        summary: reviewerCapabilityDescribeOrder({order: dispatchedOrder, reportTitle: input.reportTitle}),
    });
};

export const reviewerCapabilityCloseFulfillment = (/** @type {{order: Order, outcome: unknown, runContext: {key: string}}} */ {order, outcome, runContext}) => {
    const releasedInventory = reviewerCapabilityReleaseOrder(order);
    return Object.freeze({
        archive: reviewerCapabilityArchiveFulfillment(runContext, {orderId: order.id, outcome, releasedInventory}),
        releasedInventory,
    });
};

export const reviewerCapabilityLoadOrderSnapshot = (/** @type {{orderId: string, records: Map<string, Order>, store: OrderStorePort}} */ {orderId, records, store}) => {
    const views = reviewerCapabilityBuildStoreViews(store, records);
    return Object.freeze({
        cached: views.cached.load(orderId),
        readOnly: views.readOnly.load(orderId),
        validated: views.validated.load(orderId),
    });
};
