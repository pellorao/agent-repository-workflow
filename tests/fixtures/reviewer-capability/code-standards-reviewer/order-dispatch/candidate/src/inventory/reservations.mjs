/** @typedef {{quantity: number} & Record<string, unknown>} QuantityRecord */

export const reviewerCapabilityPrepareStockReservation = (/** @type {{carrierId: string, orderId: string, quantity: number, record: QuantityRecord, reservationMapper?: (value: Record<string, unknown>) => unknown, warehouseId: string}} */ {carrierId, orderId, quantity, record, reservationMapper = (value) => value, warehouseId}) => {
    const adjustReservationQuantity = (/** @type {QuantityRecord} */ r, /** @type {number} */ v) => ({...r, quantity: r.quantity + v});
    const adjusted = adjustReservationQuantity(record, quantity);
    const reservation = {
        warehouseId,
        orderId,
        carrierId,
        quantity: adjusted.quantity,
        state: 'reserved',
    };
    return reservationMapper({...reservation, recorded: true});
};

export const reviewerCapabilityReleaseStock = (/** @type {string} */ warehouseId, /** @type {string} */ orderId, /** @type {string} */ carrierId) => ({
    warehouseId,
    orderId,
    carrierId,
    state: 'released',
});

export const reviewerCapabilityBuildReservationKey = (/** @type {string} */ warehouseId, /** @type {string} */ orderId) => (
    `${encodeURIComponent(warehouseId)}::${encodeURIComponent(orderId)}`
);

/** @typedef {{reservedQuantity: number}} Order */

export const reviewerCapabilityHasReservedInventory = (/** @type {Order} */ order) => order.reservedQuantity > 0;
