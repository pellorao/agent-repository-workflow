/** @typedef {{state: string}} Order */

export const reviewerCapabilityDeliveryStages = ['received', 'reserved', 'dispatched'];

export const reviewerCapabilityOrderReady = (/** @type {Order} */ order) => order.state === 'reserved';

export const reviewerCapabilityStateLabel = (/** @type {string} */ state) => {
    switch (state) {
        case 'received': return 'Received';
        case 'reserved': return 'Reserved';
        case 'dispatched': return 'Dispatched';
        default: return 'Closed';
    }
};

export const reviewerCapabilityCanCancelState = (/** @type {string} */ state) => {
    switch (state) {
        case 'received': return true;
        case 'reserved': return true;
        case 'dispatched': return false;
        default: return false;
    }
};
