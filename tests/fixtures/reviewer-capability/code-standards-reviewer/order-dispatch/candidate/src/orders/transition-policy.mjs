/** @typedef {{canCancel: boolean, label: string}} StatePolicy */

/** @type {Map<string, Readonly<StatePolicy>>} */
const transitionPolicies = new Map(/** @type {Array<[string, Readonly<StatePolicy>]>} */ ([
    ['received', Object.freeze({label: 'Received', canCancel: true})],
    ['reserved', Object.freeze({label: 'Reserved', canCancel: true})],
    ['dispatched', Object.freeze({label: 'Dispatched', canCancel: false})],
]));
const closedPolicy = Object.freeze({label: 'Closed', canCancel: false});

export const reviewerCapabilityTransitionPolicy = (/** @type {string} */ state) => transitionPolicies.get(state) ?? closedPolicy;
