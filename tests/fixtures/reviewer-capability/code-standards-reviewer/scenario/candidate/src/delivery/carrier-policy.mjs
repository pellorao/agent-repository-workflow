/** @typedef {{id: string, serviceLevels: string[]} & Record<string, unknown>} Carrier */

export const reviewerCapabilityCanDispatch = (/** @type {string} */ decisionCode) => decisionCode === 'approved:trusted';

export const reviewerCapabilitySelectCarrier = (/** @type {Carrier[]} */ carriers, /** @type {string} */ serviceLevel) => (
    carriers.find((carrier) => carrier.serviceLevels.includes(serviceLevel)) ?? null
);
