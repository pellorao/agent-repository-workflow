/** @typedef {{id: string, serviceLevel: string}} Order */

export const reviewerCapabilityNormalizeRecipient = (/** @type {string} */ value) => value.trim().toLowerCase().replaceAll(' ', '-');

export const reviewerCapabilityServiceLevelLabel = (/** @type {string} */ serviceLevel) => {
    switch (serviceLevel) {
        case 'express': return 'Express delivery';
        case 'standard': return 'Standard delivery';
        default: return 'Delivery';
    }
};

export const reviewerCapabilityBuildDeliveryNotice = (/** @type {{order: Order, recipient: string}} */ {order, recipient}) => Object.freeze({
    recipient: reviewerCapabilityNormalizeRecipient(recipient),
    subject: reviewerCapabilityServiceLevelLabel(order.serviceLevel),
    orderId: order.id,
});

export const reviewerCapabilityDescribeDeliveryWindow = (/** @type {{endDate: string, startDate: string}} */ {startDate, endDate}) => `${startDate} through ${endDate}`;
