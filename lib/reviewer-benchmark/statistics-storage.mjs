import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createScopedFilesystem} from '../common/filesystem.mjs';
import {jsonSemanticallyEqual,parseJsonText,serializeJson} from '../common/json.mjs';
import {BENCHMARK_REVIEWERS,BENCHMARK_SCENARIOS,benchmarkConfigurationKey,reviewedRepetitionScores} from './benchmark-contract.mjs';
import {assertMatchingConditions,projectRuntimeMeasurement} from './statistics.mjs';

/** @typedef {import('./statistics.mjs').Statistics} Statistics */
const assert = (/** @type {unknown} */ condition, /** @type {string} */ message) => {if (!condition) throw new Error(message);};
/** @param {string} path @returns {Promise<Statistics[]>} */
const readStatistics = async path => {
    try {
        const result = parseJsonText(await readFile(path));
        if (result.status !== 'succeeded') throw new Error(result.diagnostics.map(item => item.message).join(' '));
        return result.value;
    }
    catch (error) {if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []; throw error;}
};
/** @param {string} outputDirectory @param {string} name @param {Buffer} bytes */
export const writeBenchmarkFile = async (outputDirectory,name,bytes) => {
    const created = await createScopedFilesystem({root:resolve(outputDirectory),createRoot:true});
    if (created.status !== 'succeeded') throw new Error(created.diagnostics.map(item => item.message).join(' '));
    const observed = await created.scopedFilesystem.inspect({path:name});
    if (observed.status !== 'succeeded') throw new Error(observed.diagnostics.map(item => item.message).join(' '));
    const result = await created.scopedFilesystem.write({path:name,bytes,mode:observed.entry.kind === 'missing' ? 'create-atomic' : 'replace'});
    if (result.status !== 'succeeded') throw new Error(result.diagnostics.map(item => item.message).join(' '));
};
/** @param {Statistics[]} statistics @param {Statistics} roleStatistics */
const insertStatisticsRole = (statistics,roleStatistics) => {
    const configuration = roleStatistics?.configuration;
    const reviewerId = roleStatistics?.roles?.[0]?.reviewerId;
    const scenarios = BENCHMARK_SCENARIOS.filter(item => item.reviewerId === reviewerId);
    assert(typeof configuration?.model === 'string' && configuration.model.length > 0
        && typeof configuration.reasoningEffort === 'string' && configuration.reasoningEffort.length > 0
        && roleStatistics.schemaVersion === 4 && roleStatistics.roles.length === 1
        && BENCHMARK_REVIEWERS.includes(reviewerId)
        && roleStatistics.observations?.length === scenarios.length * 3
        && roleStatistics.observations.every(item => item.reviewerId === reviewerId),'Statistics insertion requires one complete role.');
    for (const observation of roleStatistics.observations) projectRuntimeMeasurement(observation.runtime ?? {});
    assertMatchingConditions(roleStatistics.observations);
    assert(Array.isArray(statistics),'Existing statistics are not an array.');
    const entries = new Map();
    for (const entry of statistics) {
        assert(typeof entry.configuration?.model === 'string' && typeof entry.configuration.reasoningEffort === 'string'
            && entry.schemaVersion === 4 && Array.isArray(entry.roles) && Array.isArray(entry.observations),'Existing statistics have an invalid configuration.');
        const key = benchmarkConfigurationKey(entry.configuration);
        assert(!entries.has(key),'Existing statistics have a duplicate configuration.');
        entries.set(key,entry);
    }
    const key = benchmarkConfigurationKey(configuration);
    const existing = entries.get(key);
    const entry = existing === undefined ? {schemaVersion:4,configuration,observations:[],roles:[]} : {...existing};
    assertMatchingConditions([...entry.observations,...roleStatistics.observations]);
    const previous = entry.roles.find((/** @type {import('./statistics.mjs').RoleStatistics} */ role) => role.reviewerId === reviewerId);
    if (previous !== undefined) {
        assert(jsonSemanticallyEqual(previous,roleStatistics.roles[0])
            && jsonSemanticallyEqual(entry.observations.filter((/** @type {import('./statistics.mjs').Observation} */ item) => item.reviewerId === reviewerId),roleStatistics.observations),
        `Existing statistics differ for ${configuration.model}/${configuration.reasoningEffort}/${reviewerId}.`);
        return {statistics,inserted:false,roleCount:statistics.reduce((sum,item) => sum + item.roles.length,0)};
    }
    reviewedRepetitionScores(roleStatistics.roles[0]);
    assert(roleStatistics.observations.every(item => [1,2,3].includes(item.repetition)
        && (scenarios.some(scene => scene.scenarioId === item.scenarioId)
            || item.scenarioId === undefined && scenarios.length === 1 && scenarios[0].scenarioId === 'default'))
        && new Set(roleStatistics.observations.map(item => JSON.stringify([item.scenarioId ?? 'default',item.repetition]))).size === roleStatistics.observations.length,
    'Statistics insertion requires one complete role.');
    assert(entry.roles.every((/** @type {import('./statistics.mjs').RoleStatistics} */ role) => BENCHMARK_REVIEWERS.includes(role.reviewerId))
        && new Set(entry.roles.map((/** @type {import('./statistics.mjs').RoleStatistics} */ role) => role.reviewerId)).size === entry.roles.length
        && entry.observations.every((/** @type {import('./statistics.mjs').Observation} */ item) => entry.roles.some((/** @type {import('./statistics.mjs').RoleStatistics} */ role) => role.reviewerId === item.reviewerId)),
    'Existing statistics have incomplete role bindings.');
    entry.roles = [...entry.roles,...roleStatistics.roles].sort((a,b) => BENCHMARK_REVIEWERS.indexOf(a.reviewerId) - BENCHMARK_REVIEWERS.indexOf(b.reviewerId));
    entry.observations = [...entry.observations,...roleStatistics.observations].sort((a,b) => BENCHMARK_REVIEWERS.indexOf(a.reviewerId) - BENCHMARK_REVIEWERS.indexOf(b.reviewerId)
        || a.repetition - b.repetition || String(a.scenarioId).localeCompare(String(b.scenarioId),'en'));
    entries.set(key,entry);
    const ordered = [...entries.values()];
    return {statistics:ordered,inserted:true,roleCount:ordered.reduce((sum,item) => sum + item.roles.length,0)};
};

/** @param {string} outputDirectory @param {Statistics[]} statistics */
const saveStatistics = async (outputDirectory,statistics) => {
    const serialized = serializeJson(statistics);
    if (serialized.status !== 'succeeded') throw new Error(serialized.diagnostics.map(item => item.message).join(' '));
    await writeBenchmarkFile(outputDirectory,'statistics.json',serialized.bytes);
};

/** Insert one completed role without recomputing previously saved scores. @param {{outputDirectory:string,roleStatistics:Statistics}} input */
export const upsertStatisticsRole = async ({outputDirectory,roleStatistics}) => {
    assert(typeof outputDirectory === 'string' && outputDirectory.length > 0,'Statistics output directory is required.');
    const path = join(outputDirectory,'statistics.json');
    const current = await readStatistics(path);
    const result = insertStatisticsRole(current,roleStatistics);
    if (result.inserted) await saveStatistics(outputDirectory,result.statistics);
    return {path,inserted:result.inserted,roleCount:result.roleCount};
};

/** Publish all completed roles after validating the entire batch. @param {{outputDirectory:string,roleStatistics:Statistics[]}} input */
export const upsertStatisticsRoles = async ({outputDirectory,roleStatistics}) => {
    assert(typeof outputDirectory === 'string' && outputDirectory.length > 0,'Statistics output directory is required.');
    const path = join(outputDirectory,'statistics.json');
    let statistics = await readStatistics(path);
    assert(Array.isArray(roleStatistics) && Array.isArray(statistics),'Statistics publication requires arrays.');
    /** @type {Map<string,import('./statistics.mjs').Observation[]>} */
    const conditions = new Map();
    for (const entry of [...statistics,...roleStatistics]) {
        const key = benchmarkConfigurationKey(entry.configuration);
        conditions.set(key,[...(conditions.get(key) ?? []),...entry.observations]);
    }
    for (const observations of conditions.values()) assertMatchingConditions(observations);
    const results = roleStatistics.map(role => {
        const result = insertStatisticsRole(statistics,role);
        statistics = result.statistics;
        return {path,inserted:result.inserted,roleCount:result.roleCount};
    });
    if (results.some(result => result.inserted)) await saveStatistics(outputDirectory,statistics);
    return results;
};
