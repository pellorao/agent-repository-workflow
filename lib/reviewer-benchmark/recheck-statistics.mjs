import {benchmarkRoleKey,reviewedRepetitionScores as repetitionScores} from './benchmark-contract.mjs';
import {jsonSemanticallyEqual} from '../common/json.mjs';

/** @typedef {{schemaVersion:number,configuration:{model:string,reasoningEffort:string},observations:Record<string,any>[],roles:import('./statistics.mjs').RoleStatistics[]}} ReviewedStatistics */
/** @typedef {{entry:ReviewedStatistics,role:import('./statistics.mjs').RoleStatistics,observations:Record<string,any>[]}} ReviewedRole */
const THRESHOLD = 0.1;
/** @param {string} message @returns {never} */
function fail(message) {throw new Error(message);}
const roleLabel = (/** @type {ReviewedStatistics} */ entry, /** @type {import('./statistics.mjs').RoleStatistics} */ role) =>
    `${entry.configuration?.model}/${entry.configuration?.reasoningEffort}/${role.reviewerId}`;
export const scoreDivergence = (/** @type {number} */ first, /** @type {number} */ second) => {
    if (![first, second].every(score => Number.isFinite(score) && score >= 0 && score <= 1)) {
        fail('Both repetition scores must be finite numbers between 0 and 1.');
    }
    if (first === second) return 0;
    if (first === 0 || second === 0) return Infinity;
    const difference = Math.abs(first - second);
    return Math.max(difference / first, difference / second);
};

const entriesByRole = (/** @type {ReviewedStatistics[]} */ source) => {
    if (!Array.isArray(source)) fail('Independent statistics must be arrays.');
    const entries = new Map();
    for (const entry of source) {
        if (entry?.schemaVersion !== 4 || !Array.isArray(entry.roles)
            || !Array.isArray(entry.observations)) fail('Invalid independent statistics.');
        for (const role of entry.roles) {
            const key = benchmarkRoleKey(entry.configuration, role.reviewerId);
            if (entries.has(key)) fail(`Duplicate independent role: ${roleLabel(entry, role)}.`);
            entries.set(key, {entry, role,
                observations: entry.observations.filter(item => item.reviewerId === role.reviewerId)});
        }
    }
    return entries;
};

const matchingScores = (/** @type {string} */ label, /** @type {ReviewedRole|undefined} */ a, /** @type {ReviewedRole|undefined} */ b) => {
    if (!a || !b || !jsonSemanticallyEqual(a.observations,b.observations)) {
        fail(`Independent observations differ: ${label}.`);
    }
    const firstScores = repetitionScores(/** @type {ReviewedRole} */ (a).role);
    const secondScores = repetitionScores(/** @type {ReviewedRole} */ (b).role);
    for (let index = 0; index < 3; index++) {
        const aRepeat = {.../** @type {ReviewedRole} */ (a).role.repetitions[index]};
        const bRepeat = {.../** @type {ReviewedRole} */ (b).role.repetitions[index]};
        delete /** @type {Partial<import('./statistics.mjs').Repetition>} */ (aRepeat).score;
        delete /** @type {Partial<import('./statistics.mjs').Repetition>} */ (bRepeat).score;
        if (!jsonSemanticallyEqual(aRepeat,bRepeat)) {
            fail(`Independent repetition facts differ: ${label}/${index + 1}.`);
        }
    }
    return {firstScores, secondScores};
};

const reviewedEntry = (/** @type {ReviewedRole} */ source, /** @type {number[]} */ scores) => ({schemaVersion: 4,
    configuration: source.entry.configuration,
    observations: source.observations,
    roles: [{reviewerId: source.role.reviewerId,
        repetitions: source.role.repetitions.map((item, index) => ({...item, score: scores[index]}))}]});

/** Compare each repetition independently and retain complete roles without disputed repetitions. */
export const combineIndependentScores = (/** @type {ReviewedStatistics[]} */ first, /** @type {ReviewedStatistics[]} */ second) => {
    const left = entriesByRole(first);
    const right = entriesByRole(second);
    if (left.size !== right.size) fail('Independent results cover different roles.');
    const combined = [];
    const disputes = [];
    for (const [key, a] of left) {
        const b = right.get(key);
        const {firstScores, secondScores} = matchingScores(roleLabel(a.entry, a.role), a, b);
        const differences = firstScores.map((firstScore, index) => ({
            repetition: index + 1, firstScore, secondScore: secondScores[index],
            divergence: scoreDivergence(firstScore, secondScores[index])}));
        const disputed = differences.filter(item => item.divergence >= THRESHOLD);
        if (disputed.length > 0) {
            disputes.push({model: a.entry.configuration.model,
                reasoningEffort: a.entry.configuration.reasoningEffort,
                reviewerId: a.role.reviewerId,
                repetitions: disputed.map(item => ({...item,
                    divergence: Number.isFinite(item.divergence) ? item.divergence : 'Infinity'}))});
        } else {
            combined.push(reviewedEntry(a, firstScores.map((score, index) =>
                (score + secondScores[index]) / 2)));
        }
    }
    return {combined, disputes};
};

/** Compare roles scored by both independent reviewers without waiting for other role batches. */
export const combineAvailableIndependentScores = (/** @type {ReviewedStatistics[]} */ first, /** @type {ReviewedStatistics[]} */ second) => {
    const left = entriesByRole(first);
    const right = entriesByRole(second);
    const sharedFirst = [];
    const sharedSecond = [];
    for (const [key, a] of left) {
        const b = right.get(key);
        if (b === undefined) continue;
        sharedFirst.push(reviewedEntry(a, repetitionScores(a.role)));
        sharedSecond.push(reviewedEntry(b, repetitionScores(b.role)));
    }
    return {...combineIndependentScores(sharedFirst, sharedSecond),
        commonRoles: sharedFirst.length, firstOnly: left.size - sharedFirst.length,
        secondOnly: right.size - sharedFirst.length};
};

/** Retain each agreed repetition's average and use Main Agent scores for disputed repetitions. */
export const finalizeIndependentScores = (/** @type {ReviewedStatistics[]} */ first, /** @type {ReviewedStatistics[]} */ second, /** @type {ReviewedStatistics[]} */ adjudicated) => {
    const comparison = combineIndependentScores(first, second);
    const left = entriesByRole(first);
    const right = entriesByRole(second);
    const reviewed = entriesByRole(adjudicated);
    const disputedKeys = new Set(comparison.disputes.map(item =>
        benchmarkRoleKey(item, item.reviewerId)));
    if (reviewed.size !== disputedKeys.size
        || [...reviewed.keys()].some(key => !disputedKeys.has(key))) {
        fail('Main Agent results must cover exactly the disputed roles.');
    }
    const resolved = comparison.disputes.map(dispute => {
        const key = benchmarkRoleKey(dispute, dispute.reviewerId);
        const label = `${dispute.model}/${dispute.reasoningEffort}/${dispute.reviewerId}`;
        const a = left.get(key);
        const b = right.get(key);
        const c = reviewed.get(key);
        matchingScores(label, a, c);
        const {firstScores, secondScores} = matchingScores(label, a, b);
        const mainScores = repetitionScores(/** @type {ReviewedRole} */ (c).role);
        const disputedRepetitions = new Set(dispute.repetitions.map(item => item.repetition));
        return reviewedEntry(/** @type {ReviewedRole} */ (a), firstScores.map((score, index) =>
            disputedRepetitions.has(index + 1)
                ? mainScores[index] : (score + secondScores[index]) / 2));
    });
    return [...comparison.combined, ...resolved];
};
