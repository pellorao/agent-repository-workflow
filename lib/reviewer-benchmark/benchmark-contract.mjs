import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseJsonText} from '../common/json.mjs';

export const BENCHMARK_REVIEWERS = ['code-standards-reviewer', 'spec-readiness-reviewer'];
export const BENCHMARK_SCENARIOS = [
    {reviewerId: 'code-standards-reviewer', scenarioId: 'default'},
    {reviewerId: 'spec-readiness-reviewer', scenarioId: 'runtime-migration'},
    {reviewerId: 'spec-readiness-reviewer', scenarioId: 'artifact-promotion'},
];
/** @typedef {{model:string,reasoningEffort:string,modelProvider:string,serviceTier:string}} BenchmarkConfiguration */
/** @typedef {{instanceId:string,reviewerId:string,scenarioRoot:string,scenarioId?:string,input:Record<string,unknown>}} BenchmarkHandoff */
/** @typedef {{preparedPath:string,handoffs:BenchmarkHandoff[]}} PreparedBenchmark */
/** @param {Pick<BenchmarkConfiguration,'model'|'reasoningEffort'>} configuration */
export const benchmarkConfigurationKey = configuration => JSON.stringify([configuration?.model, configuration?.reasoningEffort]);
/** @param {Pick<BenchmarkConfiguration,'model'|'reasoningEffort'>} configuration @param {string} reviewerId */
export const benchmarkRoleKey = (configuration, reviewerId) => JSON.stringify([configuration?.model, configuration?.reasoningEffort, reviewerId]);
/** @param {import('./statistics.mjs').RoleStatistics} role @param {string} [errorMessage] */
export const reviewedRepetitionScores = (role, errorMessage = 'A reviewed role needs three scored repetitions.') => {
    if (!Array.isArray(role.repetitions) || role.repetitions.length !== 3
        || role.repetitions.some((item, index) => item.repetition !== index + 1
            || typeof item.score !== 'number' || !Number.isFinite(item.score) || item.score < 0 || item.score > 1)) {
        throw new Error(errorMessage);
    }
    return role.repetitions.map(item => /** @type {number} */ (item.score));
};
/** @param {unknown} value @returns {asserts value is BenchmarkConfiguration} */
export function validateBenchmarkConfiguration(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
        || ['model', 'reasoningEffort', 'modelProvider', 'serviceTier'].some(key =>
            typeof /** @type {Record<string,unknown>} */ (value)[key] !== 'string'
            || !String(/** @type {Record<string,unknown>} */ (value)[key]).trim())) {
        throw new TypeError('Benchmark settings require explicit model, reasoningEffort, modelProvider, and serviceTier.');
    }
}
/** @param {PreparedBenchmark} prepared */
export const validatePreparedBenchmarkBatch = async prepared => {
    const parsed = parseJsonText(await readFile(prepared.preparedPath));
    if (parsed.status !== 'succeeded') throw new Error(parsed.diagnostics.map(item => item.message).join(' '));
    const state = parsed.value;
    const contract = state.contracts?.[0];
    const reviewerId = contract?.reviewerId;
    const scenarios = BENCHMARK_SCENARIOS.filter(item => item.reviewerId === reviewerId);
    if (state.mode === 'targeted' && state.contracts?.length === 1 && Array.isArray(prepared.handoffs)
        && contract.instances?.length === scenarios.length * 3 && prepared.handoffs.length < contract.instances.length) {
        throw new Error('Benchmark collect/score does not support partial prepared handoffs. Use the shared background-agent entry and current Conformance input for local recovery.');
    }
    if (state.mode !== 'targeted' || state.contracts?.length !== 1 || scenarios.length === 0
        || !Array.isArray(prepared.handoffs) || prepared.handoffs.length !== scenarios.length * 3
        || contract.instances?.length !== prepared.handoffs.length) {
        throw new Error('A benchmark batch needs one complete prepared targeted Reviewer role.');
    }
    for (const [index, handoff] of prepared.handoffs.entries()) {
        const instance = contract.instances[index];
        const scenarioId = handoff.scenarioId ?? 'default';
        const expectedScenario = scenarios[index % scenarios.length].scenarioId;
        const input = handoff.input;
        const identity = /** @type {Record<string,unknown>|undefined} */ (input?.identity);
        if (handoff.reviewerId !== reviewerId || instance.instanceId !== handoff.instanceId
            || scenarioId !== expectedScenario || (instance.scenarioId ?? 'default') !== scenarioId
            || resolve(handoff.scenarioRoot) !== resolve(instance.scenarioRoot)
            || input.role !== reviewerId || input.cwd !== instance.scenarioRoot
            || input.reportPath !== instance.reportPath || identity?.kind !== 'isolated'
            || identity.instanceId !== instance.instanceId) {
            throw new Error('Benchmark handoffs must retain their prepared instance, scene, and report bindings.');
        }
    }
    return {reviewerId: /** @type {string} */ (reviewerId), instances: contract.instances,
        repetitionOf: (/** @type {number} */ index) => Math.floor(index / scenarios.length) + 1};
};
