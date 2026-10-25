import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {basename,dirname, join, resolve} from 'node:path';

import {parseJsonText,serializeJson} from '../common/json.mjs';
import {replaceReviewedRoles} from './replace-reviewed-roles.mjs';
import {upsertStatisticsRole,writeBenchmarkFile} from './statistics-storage.mjs';
import {benchmarkRoleKey} from './benchmark-contract.mjs';

/** @param {string} message @returns {never} */
function fail(message) {throw new Error(message);}
const identity = (/** @type {import('./recheck-statistics.mjs').ReviewedStatistics} */ entry) => benchmarkRoleKey(entry.configuration, entry.roles?.[0]?.reviewerId);

/** Apply complete independent role results as one checked, backed-up statistics update. */
export const applyReviewedUpdates = async (/** @type {{currentPath:string,updatesPath:string,backupPath:string}} */ {currentPath, updatesPath, backupPath}) => {
    if ([currentPath, updatesPath, backupPath].some(path => typeof path !== 'string')
        || new Set([currentPath, updatesPath, backupPath].map(path => resolve(path))).size !== 3) {
        fail('Current statistics, reviewed updates, and backup must use different paths.');
    }
    const original = await readFile(currentPath);
    const currentJson = parseJsonText(original);
    if (currentJson.status !== 'succeeded') fail(currentJson.diagnostics.map(item => item.message).join(' '));
    const updatesJson = parseJsonText(await readFile(updatesPath));
    if (updatesJson.status !== 'succeeded') fail(updatesJson.diagnostics.map(item => item.message).join(' '));
    const current = /** @type {import('./recheck-statistics.mjs').ReviewedStatistics[]} */ (currentJson.value);
    const updates = /** @type {import('./recheck-statistics.mjs').ReviewedStatistics[]} */ (updatesJson.value);
    if (!Array.isArray(current) || !Array.isArray(updates) || updates.length === 0
        || new Set(updates.map(identity)).size !== updates.length) {
        fail('Reviewed updates must be a nonempty set of distinct roles.');
    }
    const existing = new Set(current.flatMap(entry => (entry.roles ?? []).map(role =>
        benchmarkRoleKey(entry.configuration, role.reviewerId))));
    const replacements = updates.filter(entry => existing.has(identity(entry)));
    const insertions = updates.filter(entry => !existing.has(identity(entry)));
    const replaced = replaceReviewedRoles(current, replacements);
    const temporaryDirectory = await mkdtemp(join(dirname(backupPath), 'reviewed-statistics-'));
    const stagedPath = join(temporaryDirectory, 'statistics.json');
    try {
        const serialized = serializeJson(replaced.statistics);
        if (serialized.status !== 'succeeded') fail(serialized.diagnostics.map(item => item.message).join(' '));
        await writeFile(stagedPath, serialized.bytes, {flag: 'wx'});
        for (const entry of insertions) {
            const inserted = await upsertStatisticsRole({outputDirectory: temporaryDirectory,
                roleStatistics: /** @type {import('./statistics.mjs').Statistics} */ (entry)});
            if (inserted.inserted !== true) fail(`Reviewed role was not inserted: ${entry.configuration?.model}/${entry.configuration?.reasoningEffort}/${entry.roles?.[0]?.reviewerId}.`);
        }
        const staged = await readFile(stagedPath);
        await writeFile(backupPath, original, {flag: 'wx'});
        await writeBenchmarkFile(dirname(currentPath),basename(currentPath),staged);
        return {replaced: replaced.replaced,
            inserted: insertions.map(entry => ({model: entry.configuration.model,
                reasoningEffort: entry.configuration.reasoningEffort,
                reviewerId: entry.roles[0].reviewerId,
                scores: entry.roles[0].repetitions.map(item => item.score)}))};
    } finally {
        await rm(temporaryDirectory, {recursive: true, force: true});
    }
};
