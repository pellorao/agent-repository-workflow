// Fixture reader: a scenario directory <role>/<name> with its answer key, the files the reviewer sees (common, then own
// base and candidate overlaid) and the blind-adjudication brief and anchors.

import {createHash} from 'node:crypto';
import {readdir, readFile, stat} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';

import {caseK, unbalancedKTiers} from './scoring.mjs';

const SPEC_READINESS_INPUT = /^(?:specs|docs\/adr|rules|context|architecture)\//u;
const SPEC_READINESS_SUBJECT = /^\.scratch\/\d{4}-[^/]+\/issues\/\d{2}-[^/]+\.md$/u;

export class FixtureError extends Error {}

const readOptional = async (/** @type {string} */ path) => readFile(path, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
});

export const exists = (/** @type {string} */ path) => stat(path).then(() => true, () => false);

/** Where a shared fixture file (brief, anchors) lives: the scenario directory if it holds one, else its role's `common` directory. */
const sharedPath = async (/** @type {string} */ directory, /** @type {string} */ name) => (await exists(join(directory, name))
    ? join(directory, name) : join(dirname(directory), 'common', name));

export const readShared = async (/** @type {string} */ directory, /** @type {string} */ name) => readOptional(await sharedPath(directory, name));

/** Files of one overlay part (`base` or `candidate`), common first so the scenario's own files win. */
export const overlayFiles = async (/** @type {string} */ directory, /** @type {string} */ part) => {
    /** @type {Map<string, string>} */
    const files = new Map();
    for (const root of [join(dirname(directory), 'common', part), join(directory, part)]) {
        const entries = await readdir(root, {recursive: true, withFileTypes: true}).catch(error => {
            if (error.code === 'ENOENT') return [];
            throw error;
        });
        for (const entry of entries.filter(item => item.isFile())) {
            const path = join(entry.parentPath, entry.name);
            files.set(path.slice(root.length + 1).split('\\').join('/'), path);
        }
    }
    return files;
};

/** Source path -> absolute path, base then candidate (the staged comparison the reviewer reads). */
const scenarioFiles = async (/** @type {string} */ directory) => new Map([...await overlayFiles(directory, 'base'), ...await overlayFiles(directory, 'candidate')]);

const evidenceSets = (/** @type {any} */ fixtureCase) => new Set((fixtureCase.placements?.map((/** @type {any} */ placement) => placement.evidence)
    ?? [fixtureCase.evidence ?? [], ...fixtureCase.evidenceAlternatives ?? []]).map((/** @type {any[]} */ locators) => JSON.stringify(
    [...new Set(locators.map(locator => `${locator.filePath}:${locator.line ?? locator.anchor}`))].sort())).filter((/** @type {string} */ key) => key !== '[]'));

/**
 * Checks the answer keys of a role once (the scenario's own key and its siblings'): problem and clean cases exist, no k 4, every
 * k >= 1 tier balanced, merged cases well formed, no repeated question unless `repeats.json` registers the shared evidence.
 */
const checkAnswerKeys = (/** @type {Map<string, any>} */ keys, /** @type {any} */ repeats) => {
    const fail = (/** @type {string} */ message) => { throw new FixtureError(message); };
    /** @type {Record<string, {clean: number, problem: number}>} */
    const tiers = {};
    /** @type {Map<string, Array<{name: string, kind: string, scope: string, fixtureCase: any}>>} */
    const merged = new Map();
    /** @type {Map<string, string[]>} */
    const byExpectation = new Map();
    /** @type {Map<string, string[]>} */
    const byEvidence = new Map();
    for (const [scenario, key] of keys) {
        const cases = key.scopes.flatMap((/** @type {any} */ scope) => ['problem', 'clean'].flatMap(kind => scope[`${kind}Cases`].map((/** @type {any} */ fixtureCase, /** @type {number} */ index) => (
            {fixtureCase, kind, name: `${scenario}:${scope.scope}/${kind}/${index}`, scope: scope.scope}))));
        if (!cases.some((/** @type {any} */ entry) => entry.kind === 'problem') || !cases.some((/** @type {any} */ entry) => entry.kind === 'clean')) fail(`Answer key of ${scenario} needs problem and clean cases.`);
        for (const entry of cases) {
            const {fixtureCase, kind, name} = entry;
            if (fixtureCase.k === 4) fail(`Answer key case ${name} marks k 4, which needs dual adjudication that is not implemented.`);
            if (fixtureCase.k !== undefined || fixtureCase.judgment === true) {
                const tier = String(caseK(fixtureCase));
                if (caseK(fixtureCase) >= 1) {
                    tiers[tier] = {clean: tiers[tier]?.clean ?? 0, problem: tiers[tier]?.problem ?? 0};
                    tiers[tier][/** @type {'clean' | 'problem'} */ (kind)] += 1;
                }
            }
            if (fixtureCase.merge !== undefined) merged.set(fixtureCase.merge, [...merged.get(fixtureCase.merge) ?? [], entry]);
            if (fixtureCase.noOtherSupportedFinding === true) continue;
            byExpectation.set(fixtureCase.expectation, [...byExpectation.get(fixtureCase.expectation) ?? [], name]);
            for (const evidence of evidenceSets(fixtureCase)) byEvidence.set(evidence, [...byEvidence.get(evidence) ?? [], name]);
        }
    }
    for (const k of unbalancedKTiers(tiers)) fail(`Answer keys of the role have ${tiers[k].problem} problem and ${tiers[k].clean} clean cases at k ${k}; each k tier needs k problem cases per clean case.`);
    const question = new Map();
    for (const [name, items] of merged) {
        const same = (/** @type {(entry: any) => unknown} */ pick) => new Set(items.map(entry => JSON.stringify(pick(entry)))).size === 1;
        if (items.length !== 2 || items[0].scope === items[1].scope || items[0].kind !== items[1].kind || name === '' || items.some(entry => entry.fixtureCase.noOtherSupportedFinding === true
            || caseK(entry.fixtureCase) >= 1) || !same(entry => [entry.fixtureCase.k, entry.fixtureCase.judgment, entry.fixtureCase.result])) {
            fail(`Merged case ${JSON.stringify(name)} must hold two cases of one kind, k and result in two scopes at k below 1.`);
        }
        if (!same(entry => [...evidenceSets(entry.fixtureCase)].sort())) fail(`Merged case ${JSON.stringify(name)} must expect the same evidence in both cases.`);
        for (const entry of items) question.set(entry.name, `merge:${name}`);
    }
    const repeated = (/** @type {string[]} */ names) => new Set(names.map(name => question.get(name) ?? name)).size > 1;
    const registered = new Set((repeats?.sharedEvidence ?? []).map((/** @type {{cases: string[]}} */ item) => JSON.stringify([...item.cases].sort())));
    for (const names of byExpectation.values()) if (repeated(names)) fail(`Answer key repeats a question (expectation): ${names.join(' ')}.`);
    for (const names of byEvidence.values()) {
        if (repeated(names) && !registered.has(JSON.stringify([...new Set(names)].sort()))) fail(`Answer key repeats a question (evidence): ${names.join(' ')}.`);
    }
};

/**
 * @param {string} directory scenario directory
 * @returns {Promise<{brief: string, anchors: any, anchorsPath: string, anchorsSha256: string | undefined, bodyLineEvidence: boolean, expected: any, scenarioSha256: string, name: string, role: string, sources: Map<string, string>, subjectPath: string | undefined}>}
 */
export const loadScenario = async directory => {
    const scenario = resolve(directory);
    const key = await readOptional(join(scenario, 'expected.json'));
    if (key === undefined) throw new FixtureError(`Answer key is missing: ${join(scenario, 'expected.json')}.`);
    const expected = JSON.parse(key);
    const roleDirectory = dirname(scenario);
    const keys = new Map([[basename(scenario), expected]]);
    for (const entry of await readdir(roleDirectory, {withFileTypes: true})) {
        const sibling = entry.isDirectory() && entry.name !== 'common' && entry.name !== basename(scenario) ? await readOptional(join(roleDirectory, entry.name, 'expected.json')) : undefined;
        if (sibling !== undefined) keys.set(entry.name, JSON.parse(sibling));
    }
    const repeats = await readOptional(join(roleDirectory, 'repeats.json'));
    checkAnswerKeys(keys, repeats === undefined ? undefined : JSON.parse(repeats));
    expected.problemCount = expected.scopes.reduce((/** @type {number} */ count, /** @type {any} */ scope) => count + scope.problemCases.length, 0);
    expected.cleanCount = expected.scopes.reduce((/** @type {number} */ count, /** @type {any} */ scope) => count + scope.cleanCases.length, 0);
    const role = basename(dirname(scenario));
    const files = await scenarioFiles(scenario);
    // The scenario identity: the answer key plus every file the Reviewer's request is built from.
    const hash = createHash('sha256').update(key);
    for (const [path, absolute] of [...files].sort(([left], [right]) => (left < right ? -1 : 1))) hash.update(`\0${path}\0`).update(await readFile(absolute));
    const scenarioSha256 = hash.digest('hex');
    const specReadiness = role === 'spec-readiness-reviewer';
    const subjectPath = specReadiness ? [...files.keys()].find(path => SPEC_READINESS_SUBJECT.test(path)) : undefined;
    // Spec Readiness evidence is read only from the Request Inputs and the subject.
    /** @type {Map<string, string>} */
    const sources = new Map();
    for (const [path, absolute] of files) {
        if (!specReadiness || SPEC_READINESS_INPUT.test(path) || path === subjectPath) sources.set(path, await readFile(absolute, 'utf8'));
    }
    // The Reviewer sees the issue from `## What to build` through the end of `## Acceptance criteria`, not the whole file.
    if (subjectPath !== undefined) {
        const lines = /** @type {string} */ (sources.get(subjectPath)).split('\n');
        const start = lines.indexOf('## What to build');
        const acceptance = lines.indexOf('## Acceptance criteria');
        const next = lines.findIndex((line, index) => index > acceptance && line.startsWith('## '));
        sources.set(subjectPath, `${lines.slice(start, next === -1 ? lines.length : next).join('\n')}\n`);
    }
    const [brief, anchors] = await Promise.all([readShared(scenario, 'brief.md'), readShared(scenario, 'anchors.json')]);
    return {anchors: anchors === undefined ? undefined : JSON.parse(anchors), anchorsPath: await sharedPath(scenario, 'anchors.json'), anchorsSha256: anchors === undefined ? undefined : createHash('sha256').update(anchors).digest('hex'), bodyLineEvidence: specReadiness, brief: brief ?? '', expected, scenarioSha256, name: basename(scenario),
        role, sources, subjectPath};
};
