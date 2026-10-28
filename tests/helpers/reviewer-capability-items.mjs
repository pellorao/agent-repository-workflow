// Candidate and control shapes shared by the Reviewer capability pool tests.

export const item = (/** @type {string} */ expectation) => ({allowedDecisions: ['matched', 'not-matched'], check: 'X', evidence: [], expectation, finding: 'f', kind: 'association', result: 'gap'});
export const control = (/** @type {string} */ id, /** @type {string} */ expected, /** @type {any} */ extra = {}) => ({id, family: 'openai', model: 'm', expected, item: item(`control ${id}`), ...extra});
