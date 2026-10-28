// Entry operations of the Reviewer capability suite: score a report, build and use blind pools. Each returns
// {status, diagnostics, ...}; only fixtures, reports and the decision store are external input, read and checked here.

import {readFile} from 'node:fs/promises';
import {basename, extname} from 'node:path';

import {isJsonObject} from '../common/json.mjs';
import {PoolError, buildPool, candidateFingerprint, overridePool, poolPrompt, splitPool} from './pool.mjs';
import {ReportError, readReport} from './reports.mjs';
import {FixtureError, loadScenario} from './scenario.mjs';
import {scoreInstance} from './scoring.mjs';

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

/**
 * @param {{decisions?: string[], instance?: string, report: string, scenario: string}} input
 * @returns {Promise<any>} {status, diagnostics, candidates, scores}
 */
export const score = async ({decisions = [], instance, report, scenario}) => {
    let fixture;
    try { fixture = await loadScenario(scenario); } catch (error) {
        return error instanceof FixtureError ? blocked(error.message) : failed('fixture-read', error);
    }
    const read = await readInput('report-read', report, 'Report');
    if (read.result !== undefined) return read.result;
    const stores = [];
    for (const path of decisions) {
        const store = await readInput('report-read', path, 'Decision store');
        if (store.result !== undefined) return store.result;
        let decisionsByCandidate;
        try { decisionsByCandidate = JSON.parse(/** @type {string} */ (store.text)).decisions; } catch { decisionsByCandidate = undefined; }
        if (!isJsonObject(decisionsByCandidate)) return blocked(`Decision store is not a JSON object with a decisions object: ${path}.`);
        stores.push(decisionsByCandidate);
    }
    let parsed;
    try {
        parsed = readReport({expected: fixture.expected, extension: extname(report), role: fixture.role, scenario: fixture.name, sources: fixture.sources,
            subjectPath: fixture.subjectPath, text: /** @type {string} */ (read.text)});
    } catch (error) {
        if (error instanceof ReportError) return blocked(error.message);
        throw error;
    }
    const instanceId = instance ?? `${fixture.name}-${basename(report, extname(report))}`;
    const scoreWith = (/** @type {Map<string, string>} */ adjudicationDecisions) => {
        const result = scoreInstance({adjudicationDecisions, bodyLineEvidence: fixture.bodyLineEvidence, checks: parsed.checks, cleanObservations: parsed.cleanObservations,
            evidenceSources: fixture.sources, expected: fixture.expected, instanceId, reportedFailedCleanCases: parsed.reportedFailedCleanCases, reviewerId: fixture.role});
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
    const {candidates, ...scores} = result;
    return {candidates: candidates.filter((/** @type {any} */ candidate) => !applied.has(candidate.candidateId)), diagnostics: [], scores, status: 'succeeded'};
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
