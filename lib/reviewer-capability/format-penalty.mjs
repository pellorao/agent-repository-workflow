// Format penalty of a scored report: repair counts, the pBase baseline registry and its archive, and the overall deduction that gives `final`.
// pBase is a fixed yardstick: registered per scoring unit against the SHA-256 of each scenario's answer key, re-measured only when a scenario changes.

import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {createRandom} from './random.mjs';
import {ARW_CUT, deductScore} from './scoring.mjs';

export const REGISTRY_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'fixtures', 'reviewer-capability', 'format-baseline', 'registry.json');
const PAUSE_CUT = 0.1;
const FORMAT_CAP = 0.1;
const PAUSE_PREFIX = 'The Reviewer runtime paused this same task after ';

export class FormatError extends Error {}

export const sha256 = (/** @type {Buffer | string} */ data) => createHash('sha256').update(data).digest('hex');

/** Repairable format errors of one repair record, in scorer units. */
export const repairableCount = (/** @type {{details?: any[]}} */ record) => (record.details ?? []).reduce((/** @type {number} */ count, /** @type {any} */ change) => {
    if (change.kind === 'short-evidence-path') return count + change.before.replaceAll('`', '').split(':').at(-1).split(',').length;
    if (change.kind === 'spill-locator') return count + change.converted.length;
    if (['markdown-preamble', 'markdown-stray-lines', 'scalar-lines', 'requirement-line'].includes(change.kind)) return count + 1;
    throw new FormatError(`Repair record has an unknown repair kind ${change.kind}.`);
}, 0);

/** Pause notices of a saved `list_agents` result, once per message. */
export const pauseCount = (/** @type {any} */ listing) => new Set((listing.result.notifications ?? []).filter((/** @type {any} */ notice) => notice.type === 'message'
    && notice.source === 'provider-program' && typeof notice.text === 'string' && notice.text.startsWith(PAUSE_PREFIX)).map((/** @type {any} */ notice) => notice.messageId)).size;

/** pBase from (r, T) of each baseline run: the pooled sum(r) / sum(T), at least 2 errors per run. */
const pooledBaseline = (/** @type {Array<[number, number]>} */ runs) => {
    const sumR = runs.reduce((total, [r]) => total + r, 0);
    const sumT = runs.reduce((total, [, t]) => total + t, 0);
    const floor = 2 / (sumT / runs.length);
    return {floor, pBase: Math.max(sumR / sumT, floor), pooled: sumR / sumT, sumR, sumT};
};

/** The 90% bootstrap interval of pBase, resampling the baseline reports with replacement (Python `random.Random(0).choice`). */
export const bootstrapInterval = (/** @type {Array<[number, number]>} */ runs, resamples = 10000) => {
    const random = createRandom(0);
    const values = Array.from({length: resamples}, () => pooledBaseline(runs.map(() => /** @type {[number, number]} */ (random.choice(runs)))).pBase).sort((a, b) => a - b);
    return [values[Math.floor(0.05 * resamples)], values[Math.floor(0.95 * resamples) - 1]];
};

export const loadRegistry = async (/** @type {string} */ path) => JSON.parse(await readFile(path, 'utf8'));

/** The unit (scoring unit) entry of a registry that registers `<role>/<scenario>`, with its pBase recomputed from the registered runs. */
export const registeredBaseline = (/** @type {any} */ registry, /** @type {string} */ role, /** @type {string} */ scenario, /** @type {string} */ scenarioSha256) => {
    const units = Object.keys(registry).filter(name => registry[name].scenarioSha256?.[`${role}/${scenario}`] !== undefined);
    if (units.length !== 1) throw new FormatError(`The format baseline of ${role}/${scenario} is ${units.length === 0 ? 'not registered' : 'registered more than once'}.`);
    const [unit] = units;
    if (registry[unit].scenarioSha256[`${role}/${scenario}`] !== scenarioSha256) throw new FormatError(`The scenario ${role}/${scenario} differs from its registered format baseline; measure the baseline again.`);
    return unitBaseline(registry[unit], unit);
};

/** The baseline of a registered unit entry; pBase is recomputed from the registered runs and must match the registered copy. */
export const unitBaseline = (/** @type {any} */ entry, /** @type {string} */ unit) => {
    if (entry.runs.some((/** @type {any} */ run) => run.r !== run.rRepairable + run.rUnrepairable + run.rOverrun)) throw new FormatError(`The format baseline of ${unit} does not match its runs.`);
    const baseline = pooledBaseline(entry.runs.map((/** @type {any} */ run) => [run.r, run.T]));
    if (Math.abs(baseline.pBase - entry.pBase) > 1e-6) throw new FormatError(`The format baseline of ${unit} does not match its runs.`);
    return {...baseline, entry};
};

/** Checks a registry entry against its archived reports and repair records; returns the number of files checked. */
export const verifyArchive = async (/** @type {any} */ entry, /** @type {string} */ archive) => {
    let checked = 0;
    for (const run of entry.runs) {
        let repairable = 0;
        for (const item of run.reports) {
            if (sha256(await readFile(join(archive, item.report))) !== item.reportSha256) throw new FormatError(`Archived report ${item.report} differs from its registration.`);
            checked += 1;
            if (item.changes === undefined) continue;
            const bytes = await readFile(join(archive, item.changes));
            if (sha256(bytes) !== item.changesSha256) throw new FormatError(`Archived repair record ${item.changes} differs from its registration.`);
            const record = JSON.parse(bytes.toString('utf8'));
            if (record.original_sha256 !== item.reportSha256) throw new FormatError(`Repair record ${item.changes} was made from another report.`);
            for (const spill of record.spills ?? []) {
                if (sha256(await readFile(join(archive, dirname(item.changes), basename(spill.path)))) !== spill.sha256) throw new FormatError(`Archived spill file ${spill.path} differs from its repair record.`);
                checked += 1;
            }
            repairable += repairableCount(record);
            checked += 1;
        }
        if (repairable !== run.rRepairable) throw new FormatError(`Run ${run.run} repairable count differs from its archived repair records.`);
    }
    return checked;
};

/** The format penalty and the overall deduction of a scoring unit: final = s - d|s|, d = max(pause cut, f, residual cut). */
export const finalFields = (/** @type {{cut: boolean, paused: boolean, pBase: number, r: number, scoreBeforePenalty: number, T: number}} */ {cut, paused, pBase, r, scoreBeforePenalty, T}) => {
    const p = T > 0 ? r / T : r === 0 ? 0 : 1;
    const f = FORMAT_CAP * Math.min(1, p / (2 * pBase));
    const overallDeduction = Math.max(paused ? PAUSE_CUT : 0, f, cut ? ARW_CUT : 0);
    return {f, final: deductScore(scoreBeforePenalty, overallDeduction), overallDeduction, p};
};
