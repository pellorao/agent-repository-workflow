// Fixture reader: a scenario directory <role>/<name> with its answer key, the files the reviewer sees (common, then own
// base and candidate overlaid) and the blind-adjudication brief and anchors.

import {readdir, readFile} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';

const SPEC_READINESS_INPUT = /^(?:specs|docs\/adr|rules|context|architecture)\//u;
const SPEC_READINESS_SUBJECT = /^\.scratch\/\d{4}-[^/]+\/issues\/\d{2}-[^/]+\.md$/u;

export class FixtureError extends Error {}

const readOptional = async (/** @type {string} */ path) => readFile(path, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
});

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
export const scenarioFiles = async (/** @type {string} */ directory) => new Map([...await overlayFiles(directory, 'base'), ...await overlayFiles(directory, 'candidate')]);

/**
 * @param {string} directory scenario directory
 * @returns {Promise<{brief: string, anchors: any, bodyLineEvidence: boolean, expected: any, name: string, role: string, sources: Map<string, string>, subjectPath: string | undefined}>}
 */
export const loadScenario = async directory => {
    const scenario = resolve(directory);
    const key = await readOptional(join(scenario, 'expected.json'));
    if (key === undefined) throw new FixtureError(`Answer key is missing: ${join(scenario, 'expected.json')}.`);
    const expected = JSON.parse(key);
    expected.problemCount = expected.scopes.reduce((/** @type {number} */ count, /** @type {any} */ scope) => count + scope.problemCases.length, 0);
    expected.cleanCount = expected.scopes.reduce((/** @type {number} */ count, /** @type {any} */ scope) => count + scope.cleanCases.length, 0);
    const role = basename(dirname(scenario));
    const files = await scenarioFiles(scenario);
    const specReadiness = role === 'spec-readiness-reviewer';
    const subjectPath = specReadiness ? [...files.keys()].find(path => SPEC_READINESS_SUBJECT.test(path)) : undefined;
    // Spec Readiness evidence is read only from the Request Inputs and the subject.
    /** @type {Map<string, string>} */
    const sources = new Map();
    for (const [path, absolute] of files) {
        if (!specReadiness || SPEC_READINESS_INPUT.test(path) || path === subjectPath) sources.set(path, await readFile(absolute, 'utf8'));
    }
    const shared = async (/** @type {string} */ name) => await readOptional(join(scenario, name)) ?? await readOptional(join(dirname(scenario), 'common', name));
    const [brief, anchors] = await Promise.all([shared('brief.md'), shared('anchors.json')]);
    return {anchors: anchors === undefined ? undefined : JSON.parse(anchors), bodyLineEvidence: specReadiness, brief: brief ?? '', expected, name: basename(scenario),
        role, sources, subjectPath};
};
