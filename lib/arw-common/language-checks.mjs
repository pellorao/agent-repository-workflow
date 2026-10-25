import {globToRegExp, normalizePathPattern} from '../common/path-pattern.mjs';

/** @typedef {import('./repository-configuration.mjs').LanguageCheck} LanguageCheck */
/** @typedef {import('./language-composition-presentation.mjs').LanguageComposition} LanguageComposition */
/** @typedef {{name: string, minPercentage: number}} LanguageThreshold */
/** @typedef {{path: string, status: 'passed' | 'failed' | 'indeterminate'}} DocumentJudgment */
/** @typedef {LanguageCheck & {effectiveMinPercentage: number, documents: DocumentJudgment[], summary: {passed: number, failed: number, indeterminate: number}}} LanguageCheckResult */
/** @typedef {{checks: LanguageCheckResult[], status: 'configured' | 'unconfigured', uncovered: string[]}} LanguageChecksResult */

/** @param {string} path @param {string} pattern */
const matches = (path, pattern) => {
    const normalized = normalizePathPattern(pattern);
    if (normalized === '.') return true;
    return /[*?]/u.test(normalized)
        ? globToRegExp(normalized).test(path)
        : path === normalized || path.startsWith(`${normalized}/`);
};

/** @param {{rules: LanguageCheck[], rows: LanguageComposition[], overrides?: LanguageThreshold[]}} input @returns {LanguageChecksResult} */
export const evaluateLanguageChecks = ({rules, rows, overrides = []}) => {
    const thresholds = new Map();
    for (const override of overrides) {
        if (thresholds.has(override.name) || !rules.some(rule => rule.name === override.name)
            || !Number.isFinite(override.minPercentage) || override.minPercentage < 0 || override.minPercentage > 100) {
            throw new TypeError(`Invalid language threshold override: ${override.name}.`);
        }
        thresholds.set(override.name, override.minPercentage);
    }
    const covered = new Set();
    const checks = rules.map(rule => {
        const effectiveMinPercentage = thresholds.get(rule.name) ?? rule.minPercentage;
        const summary = {passed: 0, failed: 0, indeterminate: 0};
        const documents = rows.filter(row => rule.include.some(pattern => matches(row.path, pattern))
            && !rule.exclude.some(pattern => matches(row.path, pattern))).map(row => {
            covered.add(row.path);
            const percentage = row[rule.language];
            const status = percentage === null ? 'indeterminate' : percentage >= effectiveMinPercentage ? 'passed' : 'failed';
            summary[status] += 1;
            return {path: row.path, status: /** @type {DocumentJudgment['status']} */ (status)};
        });
        return {...rule, include: [...rule.include], exclude: [...rule.exclude], effectiveMinPercentage, documents, summary};
    });
    return {checks, status: rules.length === 0 ? 'unconfigured' : 'configured', uncovered: rows.filter(row => !covered.has(row.path)).map(row => row.path)};
};
