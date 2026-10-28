// Entry operations of the Reviewer capability suite: score a report, build and use blind pools. Each returns
// {status, diagnostics, ...}; only fixtures, reports and the decision store are external input, read and checked here.

import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {basename, dirname, extname, join} from 'node:path';

import {isJsonObject} from '../common/json.mjs';
import {PoolError, buildPool, candidateFingerprint, overridePool, poolPrompt, splitPool} from './pool.mjs';
import {FormatError, REGISTRY_PATH, bootstrapInterval, finalFields, loadRegistry, pauseCount, registeredBaseline, repairableCount, sha256, unitBaseline, verifyArchive} from './format-penalty.mjs';
import {lineCounts} from './evidence.mjs';
import {auditRequirementLines, changeSummary, repairJsonl, repairMarkdown} from './repair.mjs';
import {NoContentError, ReportError, readReport} from './reports.mjs';
import {FixtureError, loadScenario} from './scenario.mjs';
import {combineScenarios, hasCutDiagnostic, scoreInstance, withReportPolicy, zeroCapabilityScore} from './scoring.mjs';

const POOL_LIMIT = 150;
const LARGE_POOL_LIMIT = 210;
const LARGE_POOL_ROLES = ['spec-readiness-reviewer', 'code-standards-reviewer'];

const blocked = (/** @type {string} */ message) => ({diagnostics: [message], status: 'blocked'});
const failed = (/** @type {string} */ stage, /** @type {unknown} */ error) => ({diagnostics: [error instanceof Error ? error.message : String(error)], stage, status: 'failed'});

/** Reads a file; a missing one is the caller's input problem (blocked), any other failure is I/O (failed). */
const readInput = async (/** @type {string} */ stage, /** @type {string} */ path, /** @type {string} */ what) => {
    try { return {text: await readFile(path, 'utf8')}; } catch (error) {
        return /** @type {any} */ (error).code === 'ENOENT' ? {result: blocked(`${what} is missing: ${path}.`)} : {result: failed(stage, error)};
    }
};

const FORMAT_SUM_KEYS = ['rRepairable', 'rUnrepairable', 'rOverrun', 'finalStatusFormatErrors', 'T'];
const exists = (/** @type {string} */ path) => stat(path).then(() => true, () => false);

/**
 * A JSON input file: `{value}`, or `{result}` (blocked or failed) when it cannot be read as JSON.
 * @param {string} path @param {string} what @returns {Promise<{result?: any, value?: any}>}
 */
const readJson = async (/** @type {string} */ path, /** @type {string} */ what) => {
    const read = await readInput('report-read', path, what);
    if (read.result !== undefined) return read;
    try { return {value: JSON.parse(/** @type {string} */ (read.text))}; } catch { return {result: blocked(`${what} is not JSON: ${path}.`)}; }
};

/**
 * Counts that follow from the repair record, the overrun locators and the pause notices; the final score fields of a complete scoring unit.
 * @param {{baseline: {pBase: number}, ownsFinalScore: boolean, paused: boolean, pauseNotices: number, record: any, result: any}} input
 */
const formatFields = ({baseline, ownsFinalScore, paused, pauseNotices, record, result}) => {
    const counts = {finalStatusFormatErrors: 0, rOverrun: result.overrunLocators, rRepairable: record === null ? 0 : repairableCount(record), rUnrepairable: result.unrepairableFormatErrors};
    const r = counts.rRepairable + counts.rUnrepairable + counts.rOverrun + counts.finalStatusFormatErrors;
    const cut = hasCutDiagnostic(result.reportDiagnostics);
    return {...counts, cut, pBase: baseline.pBase, pauseCount: pauseNotices, paused, r, T: result.locatorCount,
        ...(ownsFinalScore ? finalFields({cut, paused, pBase: baseline.pBase, r, scoreBeforePenalty: result.scoreBeforePenalty, T: result.locatorCount}) : {})};
};

/**
 * @param {{agent?: string, decisions?: string[], instance?: string, noRepair?: boolean, registry?: string, repair?: string, report: string, scenario: string}} input
 * @returns {Promise<any>} {status, diagnostics, candidates, scores, role, scenario}
 */
export const score = async ({agent, decisions = [], instance, noRepair = false, registry = REGISTRY_PATH, repair, report, scenario}) => {
    if ((repair === undefined) === !noRepair) return blocked('Declare the report repair: give exactly one of a repair record and noRepair.');
    let fixture;
    try { fixture = await loadScenario(scenario); } catch (error) {
        return error instanceof FixtureError ? blocked(error.message) : failed('fixture-read', error);
    }
    if (agent === undefined) return blocked('The pause notices need an agent listing: give the saved list_agents result.');
    const listing = await readJson(agent, 'Agent listing');
    if (listing.result !== undefined) return listing.result;
    if (!isJsonObject(listing.value) || listing.value.status !== 'succeeded' || !isJsonObject(listing.value.result)) return blocked(`Agent listing is not a succeeded list_agents result: ${agent}.`);
    let record = null;
    if (repair !== undefined) {
        const read = await readJson(repair, 'Repair record');
        if (read.result !== undefined) return read.result;
        if (!isJsonObject(read.value) || !isJsonObject(read.value.changes)) return blocked(`Repair record is not a repair record: ${repair}.`);
        record = Object.keys(read.value.changes).length === 0 ? null : read.value;
    }
    let baseline;
    try {
        baseline = registeredBaseline(await loadRegistry(registry), fixture.role, fixture.name, fixture.scenarioSha256);
        if (record !== null) repairableCount(record);
    } catch (error) {
        if (error instanceof FormatError) return blocked(error.message);
        return failed('fixture-read', error);
    }
    let bytes;
    try { bytes = await readFile(report); } catch (error) {
        return /** @type {any} */ (error).code === 'ENOENT' ? blocked(`Report is missing: ${report}.`) : failed('report-read', error);
    }
    if (record !== null && record.normalized_sha256 !== sha256(bytes)) return blocked('The repair record does not belong to the report: the report differs from its normalized copy.');
    const stores = [];
    for (const path of decisions) {
        const store = await readInput('report-read', path, 'Decision store');
        if (store.result !== undefined) return store.result;
        let decisionsByCandidate;
        try { decisionsByCandidate = JSON.parse(/** @type {string} */ (store.text)).decisions; } catch { decisionsByCandidate = undefined; }
        if (!isJsonObject(decisionsByCandidate)) return blocked(`Decision store is not a JSON object with a decisions object: ${path}.`);
        stores.push(decisionsByCandidate);
    }
    const instanceId = instance ?? `${fixture.name}-${basename(report, extname(report))}`;
    const paused = pauseCount(listing.value);
    const unit = {baseline, paused: paused > 0, pauseNotices: paused, ownsFinalScore: fixture.role !== 'spec-readiness-reviewer'};
    const output = (/** @type {any} */ result, /** @type {any[]} */ candidates, /** @type {any} */ extra = {}) => {
        const {candidates: unused, ...scores} = result;
        return {candidates, diagnostics: [], role: fixture.role, scenario: fixture.name, scores: {...scores, ...extra, ...formatFields({...unit, record, result})}, status: 'succeeded'};
    };
    let text;
    let parsed;
    try {
        try { text = new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch {
            throw new NoContentError('Report is not valid UTF-8.', [{code: 'review-utf8-invalid', message: 'The report bytes are not valid UTF-8.'}]);
        }
        parsed = readReport({expected: fixture.expected, extension: extname(report), role: fixture.role, scenario: fixture.name, sources: fixture.sources,
            subjectPath: fixture.subjectPath, text});
    } catch (error) {
        if (error instanceof NoContentError) {
            if (record !== null) return blocked('A model failure has no report to repair; declare noRepair.');
            return output(withReportPolicy(zeroCapabilityScore(fixture.expected), error.reportDiagnostics), [], {modelFailure: {reason: error.message}});
        }
        if (error instanceof ReportError) return blocked(error.message);
        throw error;
    }
    const scoreWith = (/** @type {Map<string, string>} */ adjudicationDecisions) => {
        const result = scoreInstance({adjudicationDecisions, bodyLineEvidence: fixture.bodyLineEvidence, checks: parsed.checks, cleanObservations: parsed.cleanObservations,
            evidenceSources: fixture.sources, expected: fixture.expected, instanceId, invalidEvidenceCode: /** @type {any} */ (parsed).invalidEvidenceCode, reportDiagnostics: parsed.reportDiagnostics,
            reportedFailedCleanCases: parsed.reportedFailedCleanCases, reviewerId: fixture.role});
        if (fixture.bodyLineEvidence) result.candidates = result.candidates.map((/** @type {any} */ candidate) => ({...candidate, scenario: fixture.name}));
        return result;
    };
    // A stored decision applies to a candidate with the same fingerprint (what the judge saw) and an allowed decision.
    const known = new Map(stores.flatMap(store => Object.entries(store)));
    const applied = new Map();
    let result = scoreWith(applied);
    for (;;) {
        const added = result.candidates.filter((/** @type {any} */ candidate) => {
            const entry = /** @type {any} */ (known.get(candidate.candidateId));
            return !applied.has(candidate.candidateId) && entry?.fingerprint === candidateFingerprint(candidate) && candidate.allowedDecisions.includes(entry.decision);
        });
        if (added.length === 0) break;
        for (const candidate of added) applied.set(/** @type {string} */ (candidate.candidateId), /** @type {any} */ (known.get(/** @type {string} */ (candidate.candidateId))).decision);
        result = scoreWith(applied);
    }
    return output(result, result.candidates.filter((/** @type {any} */ candidate) => !applied.has(candidate.candidateId)));
};

/**
 * Fuses the two `score` outputs of one Spec Readiness scoring unit.
 * @param {{scores: [string, string]}} input
 * @returns {Promise<any>} {status, diagnostics, candidates, scores}
 */
export const combine = async ({scores: paths}) => {
    /** @type {any[]} */
    const outputs = [];
    for (const path of paths) {
        const read = await readJson(path, 'Score output');
        if (read.result !== undefined) return read.result;
        const value = /** @type {any} */ (read.value);
        if (!isJsonObject(value) || value.status !== 'succeeded' || !isJsonObject(value.scores)) return blocked(`Score output is not a succeeded score output: ${path}.`);
        outputs.push(value);
    }
    const [first, second] = outputs;
    if (first.role !== second.role || first.scenario === second.scenario || typeof first.role !== 'string' || typeof second.scenario !== 'string') return blocked('The two score outputs must be two different scenarios of one role.');
    const ids = [...first.candidates, ...second.candidates].map((/** @type {any} */ candidate) => candidate.candidateId);
    if (new Set(ids).size !== ids.length) return blocked('The two score outputs share candidate ids; score each report with its own --instance.');
    /** @type {any[]} */
    const fields = outputs.map(output => output.scores);
    if (fields.some(item => FORMAT_SUM_KEYS.some(key => !Number.isFinite(item[key])) || !Number.isFinite(item.pBase) || !Array.isArray(item.reportDiagnostics)) || first.scores.pBase !== second.scores.pBase) {
        return blocked('The score outputs lack format counts or have different format baselines.');
    }
    let merged;
    try { merged = combineScenarios(fields.map(item => ({...item, score: item.scoreBeforePenalty}))); } catch (error) {
        return blocked(error instanceof Error ? error.message : String(error));
    }
    const result = withReportPolicy(merged, fields.flatMap(item => item.reportDiagnostics));
    const sum = Object.fromEntries(FORMAT_SUM_KEYS.map(key => [key, fields.reduce((total, item) => total + item[key], 0)]));
    const cut = hasCutDiagnostic(result.reportDiagnostics);
    const paused = fields.some(item => item.paused);
    const r = sum.rRepairable + sum.rUnrepairable + sum.rOverrun + sum.finalStatusFormatErrors;
    const {modelFailure: unused, ...rest} = result;
    return {candidates: [...first.candidates, ...second.candidates], diagnostics: [], scores: {...rest, ...sum, cut, pBase: first.scores.pBase, pauseCount: Math.max(...fields.map(item => item.pauseCount)), paused, r,
        ...finalFields({cut, paused, pBase: first.scores.pBase, r, scoreBeforePenalty: result.scoreBeforePenalty, T: sum.T})}, status: 'succeeded'};
};

/**
 * Repairs the format of a report on a new copy and writes the repair record next to it.
 * @param {{out: string, report: string, scenario: string, spills?: string[]}} input
 * @returns {Promise<any>} {status, diagnostics, changes, normalized, record}
 */
export const repair = async ({out, report, scenario, spills = []}) => {
    let fixture;
    try { fixture = await loadScenario(scenario); } catch (error) {
        return error instanceof FixtureError ? blocked(error.message) : failed('fixture-read', error);
    }
    if (await exists(out)) return blocked(`Output already exists: ${out}.`);
    let bytes;
    try { bytes = await readFile(report); } catch (error) {
        return /** @type {any} */ (error).code === 'ENOENT' ? blocked(`Report is missing: ${report}.`) : failed('report-read', error);
    }
    const spillTexts = [];
    for (const path of spills) {
        const read = await readInput('report-read', path, 'Spill file');
        if (read.result !== undefined) return read.result;
        spillTexts.push(/** @type {string} */ (read.text));
    }
    const text = new TextDecoder('utf-8', {fatal: false}).decode(bytes);
    /** @type {{changes: any[], normalized?: string, diagnostics?: Record<string, unknown>}} */
    let repaired = {changes: []};
    if (extname(report) === '.jsonl') {
        const lines = text.split(/\r?\n/u).filter(line => line.trim() !== '');
        let rows;
        try { rows = lines.map(line => JSON.parse(line)); } catch (error) { rows = undefined; repaired = {changes: [], diagnostics: {unparseable: String(error)}}; }
        if (rows !== undefined) {
            repaired = repairJsonl(rows, fixture.role === 'requirements-reviewer' && fixture.name === 'commit-audit' ? auditRequirementLines(fixture.expected.auditRecords, fixture.sources) : undefined);
        }
    } else {
        repaired = repairMarkdown(text, {sources: lineCounts(fixture.sources), spills: spillTexts, texts: new Map([...fixture.sources].map(([path, source]) => [path, source.split('\n')]))});
    }
    const record = {original: report, original_sha256: sha256(bytes), ...(spills.length > 0 ? {spills: await Promise.all(spills.map(async path => ({path, sha256: sha256(await readFile(path))})))} : {}),
        changes: changeSummary(repaired.changes), details: repaired.changes,
        ...(spills.length > 0 || repaired.diagnostics !== undefined && Object.keys(repaired.diagnostics).length > 0 ? {diagnostics: repaired.diagnostics} : {})};
    try {
        await mkdir(dirname(out), {recursive: true});
        if (repaired.normalized !== undefined) {
            await writeFile(out, repaired.normalized);
            Object.assign(record, {normalized: out, normalized_sha256: sha256(repaired.normalized)});
        }
        await writeFile(`${out}.changes.json`, `${JSON.stringify(record, null, 1)}\n`);
    } catch (error) { return failed('repair-write', error); }
    return {changes: record.changes, diagnostics: [], normalized: /** @type {any} */ (record).normalized, record: `${out}.changes.json`, status: 'succeeded'};
};

/**
 * Checks a registered format baseline against its archive and answer keys.
 * @param {{registry?: string, unit: string}} input
 * @returns {Promise<any>} {status, diagnostics, pBase, pooled, floor, bootstrap90, filesChecked}
 */
export const baseline = async ({registry = REGISTRY_PATH, unit}) => {
    try {
        const entry = (await loadRegistry(registry))[unit];
        if (entry === undefined) return blocked(`The format baseline ${unit} is not registered.`);
        const root = dirname(dirname(registry));
        for (const [scenario, scenarioSha256] of Object.entries(entry.scenarioSha256)) {
            if ((await loadScenario(join(root, scenario))).scenarioSha256 !== scenarioSha256) throw new FormatError(`The scenario ${scenario} differs from its registered format baseline; measure the baseline again.`);
        }
        const {floor, pBase, pooled} = unitBaseline(entry, unit);
        const filesChecked = await verifyArchive(entry, join(dirname(registry), 'archive'));
        const bootstrap90 = bootstrapInterval(entry.runs.map((/** @type {any} */ run) => [run.r, run.T]));
        if (bootstrap90.some((value, index) => Math.abs(Math.round(value * 1e7) / 1e7 - entry.pBaseBootstrap90[index]) > 1e-9)) throw new FormatError(`The bootstrap interval of ${unit} differs from its registration.`);
        return {bootstrap90, diagnostics: [], filesChecked, floor, pBase, pooled, status: 'succeeded'};
    } catch (error) {
        if (error instanceof FormatError) return blocked(error.message);
        return failed('fixture-read', error);
    }
};

/**
 * @param {{action: 'build' | 'prompt' | 'split' | 'override', [key: string]: any}} input
 * @returns {Promise<any>}
 */
export const pool = async ({action, ...input}) => {
    let stage = 'pool-write';
    try {
        if (action === 'build') {
            stage = 'fixture-read';
            const fixture = await loadScenario(input.scenario);
            if (fixture.anchors === undefined || fixture.brief === '') return blocked(`Brief or anchors are missing for ${input.scenario}.`);
            const candidates = [];
            for (const path of input.candidates) {
                const read = await readInput('pool-write', path, 'Candidates file');
                if (read.result !== undefined) return read.result;
                let list;
                try {
                    const value = JSON.parse(/** @type {string} */ (read.text));
                    list = Array.isArray(value) ? value : value.candidates;
                } catch { list = undefined; }
                if (!Array.isArray(list)) return blocked(`Candidates file is not a JSON array or an object with a candidates array: ${path}.`);
                candidates.push(...list);
            }
            stage = 'pool-write';
            const built = await buildPool({anchors: fixture.anchors, brief: fixture.brief, candidates, limit: LARGE_POOL_ROLES.includes(fixture.role) ? LARGE_POOL_LIMIT : POOL_LIMIT,
                name: input.name, root: input.root, scenario: input.scenario});
            return {...built, diagnostics: [], status: 'succeeded'};
        }
        if (action === 'prompt') return {...await poolPrompt({name: input.name, root: input.root}), diagnostics: [], status: 'succeeded'};
        if (action === 'split') {
            const read = await readInput('pool-write', input.decisions, 'Decisions file');
            if (read.result !== undefined) return read.result;
            let decisions;
            try { decisions = JSON.parse(/** @type {string} */ (read.text)); } catch { decisions = undefined; }
            if (!isJsonObject(decisions)) return blocked(`Decisions file is not a JSON object: ${input.decisions}.`);
            const verdict = await splitPool({decisions, name: input.name, root: input.root});
            return verdict.passed ? {...verdict, diagnostics: [], status: 'succeeded'}
                : {...verdict, ...blocked('Controls failed: adjudicate the whole pool again; nothing was written.')};
        }
        return {entry: await overridePool({decision: input.decision, id: input.id, name: input.name, reason: input.reason, root: input.root}), diagnostics: [], status: 'succeeded'};
    } catch (error) {
        if (error instanceof PoolError || error instanceof FixtureError) return blocked(error.message);
        return failed(stage, error);
    }
};
