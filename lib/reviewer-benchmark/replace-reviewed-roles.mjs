import {benchmarkConfigurationKey,benchmarkRoleKey,reviewedRepetitionScores} from './benchmark-contract.mjs';
import {jsonSemanticallyEqual} from '../common/json.mjs';

/** @typedef {import('./recheck-statistics.mjs').ReviewedStatistics} ReviewedStatistics */
/** @param {string} message @returns {never} */
function fail(message) {throw new Error(message);}
const collectedObservation = (/** @type {Record<string,any>} */ item) => {
    const copy = structuredClone(item);
    if (copy.delivery) delete copy.delivery.mainAgentCorrectedScoringCopy;
    return copy;
};
const collectedRepetition = (/** @type {import('./statistics.mjs').Repetition} */ item) => {
    const copy = /** @type {Record<string,unknown>} */ ({...item});
    for (const key of ['score', 'scoreSource', 'diagnosticReason', 'mainAgentCorrectedScoringCopy']) {
        delete copy[key];
    }
    return copy;
};

/** Replace reviewed role scoring while preserving collected runtime and delivery facts. */
export const replaceReviewedRoles = (/** @type {ReviewedStatistics[]} */ current, /** @type {ReviewedStatistics[]} */ updates) => {
    if (!Array.isArray(current) || !Array.isArray(updates)) fail('Statistics must be arrays.');
    const result = structuredClone(current);
    const configurations = new Map(result.map(entry => [benchmarkConfigurationKey(entry.configuration), entry]));
    if (configurations.size !== result.length) fail('Current configurations are duplicated.');
    const seen = new Set();
    const replaced = [];
    for (const update of updates) {
        const key = benchmarkConfigurationKey(update.configuration);
        const label = `${update.configuration?.model}/${update.configuration?.reasoningEffort}`;
        const entry = configurations.get(key);
        if (!entry || update.schemaVersion !== 4 || update.schemaVersion !== entry.schemaVersion
            || !Array.isArray(update.roles) || !Array.isArray(update.observations)
            || update.roles.length !== 1) fail(`Invalid reviewed configuration: ${label}.`);
        const role = update.roles[0];
        const identity = benchmarkRoleKey(update.configuration, role.reviewerId);
        const roleLabel = `${label}/${role.reviewerId}`;
        const index = entry.roles.findIndex(item => item.reviewerId === role.reviewerId);
        if (seen.has(identity) || index < 0) fail(`Duplicate or missing reviewed role: ${roleLabel}.`);
        seen.add(identity);
        const observations = entry.observations.filter(item => item.reviewerId === role.reviewerId);
        if (!jsonSemanticallyEqual(observations.map(collectedObservation),update.observations.map(collectedObservation))) {
            fail(`Collected observations changed during scoring: ${roleLabel}.`);
        }
        const errorMessage = `Invalid reviewed repetitions: ${roleLabel}.`;
        const before = reviewedRepetitionScores(entry.roles[index], errorMessage);
        const after = reviewedRepetitionScores(role, errorMessage);
        if (!jsonSemanticallyEqual(entry.roles[index].repetitions.map(collectedRepetition),role.repetitions.map(collectedRepetition))) {
            fail(`Invalid reviewed score: ${roleLabel}.`);
        }
        entry.roles[index] = structuredClone(role);
        let replacementIndex = 0;
        entry.observations = entry.observations.map(item => item.reviewerId === role.reviewerId
            ? structuredClone(update.observations[replacementIndex++]) : item);
        replaced.push({model: update.configuration.model,
            reasoningEffort: update.configuration.reasoningEffort, reviewerId: role.reviewerId,
            before, after});
    }
    return {statistics: result, replaced};
};
