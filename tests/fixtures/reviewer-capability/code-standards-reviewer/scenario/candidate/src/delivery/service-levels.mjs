export default function reviewerCapabilityEstimateDeliveryDays(/** @type {string} */ serviceLevel) {
    return serviceLevel === 'express' ? 1 : 4;
}

export const reviewerCapabilityRiskPolicies = Object.freeze({
    low: Object.freeze({label: 'Low', requiresSignature: false}),
    high: Object.freeze({label: 'High', requiresSignature: true}),
});
