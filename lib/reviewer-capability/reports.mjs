// Reviewer report readers: turn a report (baseline JSONL or the current role's free-form txt/md) into scorer input.
// Returns {checks, cleanObservations, reportedFailedCleanCases}; throws ReportError when the report cannot be read.

import {isJsonObject} from '../common/json.mjs';
import {FINDING_START, SHORT_LOCATOR, createReviewerCapabilityEvidenceMatcher, lineCounts, normalizeBodyEvidence, parseCompactEvidence, shortLocatorPath} from './evidence.mjs';
import {SCOPE_CONTINUATION_FAILS_CLEAN_CASE} from './scoring.mjs';

export class ReportError extends Error {}
/** A report that is readable but holds nothing to score: the instance is a model failure. */
export class NoContentError extends ReportError {
    /** @param {string} message @param {Array<{code: string, message: string}>} reportDiagnostics */
    constructor(message, reportDiagnostics) {
        super(message);
        this.reportDiagnostics = reportDiagnostics;
    }
}
const diagnostic = (/** @type {string} */ code, /** @type {string} */ message) => ({code, message});
const FORMAT_INVALID = diagnostic('review-format-invalid', 'The report has text outside its findings.');

const SPEC_READINESS_ITEM = /^- ([A-Z][A-Z-]+), (gap|uncertain): (.*)$/u;
const SPEC_READINESS_LOCATOR = /([\p{L}\p{N}_.][\p{L}\p{N}_./-]*\.(?:md|mjs|js|json|txt)):(\d+(?:-\d+)?(?:,\s*\d+(?:-\d+)?)*)/gu;
const SPEC_READINESS_CHECKS = ['SPEC-READINESS-INPUTS', 'SPEC-READINESS-REQUIREMENTS', 'SPEC-READINESS-RATIONALE', 'SPEC-READINESS-ADR-EVALUATION',
    'MODULE-DESIGN-APPLICABILITY', 'MODULE-DESIGN-EXEMPTION', 'MODULE-DESIGN-MODULES', 'MODULE-DESIGN-INTERFACES', 'MODULE-DESIGN-SEAMS-ADAPTERS',
    'MODULE-DESIGN-DEPENDENCIES-DATA-FLOW', 'MODULE-DESIGN-RATIONALE'];
const SUBJECT_EVIDENCE_CHECKS = new Set(['SPEC-READINESS-INPUTS', 'SPEC-READINESS-REQUIREMENTS']);

const sortedKey = (/** @type {unknown} */ value) => JSON.stringify(value, (_, nested) => (
    nested !== null && typeof nested === 'object' && !Array.isArray(nested)
        ? Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : nested));
const derivedResult = (/** @type {Array<{result: string}>} */ values) => values.some(value => value.result === 'gap') ? 'gap'
    : values.some(value => value.result === 'uncertain') ? 'uncertain' : 'satisfied';
const byKey = (/** @type {unknown} */ left, /** @type {unknown} */ right) => {
    const [a, b] = [JSON.stringify(left), JSON.stringify(right)];
    return a < b ? -1 : a > b ? 1 : 0;
};

/** The current Spec Readiness role's `- CHECK, result: finding` lines as baseline JSONL rows. */
const specReadinessTextRows = (/** @type {string} */ text, /** @type {Array<{code: string, message: string}>} */ diagnostics) => {
    /** @type {Array<{check: string, evidence: string[], finding: string, result: string}>} */
    const rows = [];
    for (const line of text.split(/\r?\n/u)) {
        const match = SPEC_READINESS_ITEM.exec(line);
        if (match) rows.push({check: match[1], evidence: [], finding: match[3], result: match[2]});
        else if (line.trim() !== '' && rows.length > 0) rows[rows.length - 1].finding += `\n${line}`;
        else if (line.trim() !== '' && !diagnostics.includes(FORMAT_INVALID)) diagnostics.push(FORMAT_INVALID);
    }
    for (const row of rows) {
        row.evidence = [...new Set([...row.finding.matchAll(SPEC_READINESS_LOCATOR)].map(match => `${match[1]}:${match[2].replace(/\s+/gu, '')}`))];
    }
    return rows;
};

/** The JSON rows of a JSONL report; each line that is not JSON is skipped with a `review-json-invalid` diagnostic. */
const jsonlRows = (/** @type {string} */ text, /** @type {Array<{code: string, message: string}>} */ diagnostics) => text.split(/\r?\n/u).filter(line => line.trim() !== '').flatMap(line => {
    try { return [JSON.parse(line)]; } catch {
        diagnostics.push(diagnostic('review-json-invalid', 'A report line is not valid JSON.'));
        return [];
    }
});

/**
 * Spec Readiness rows to checks. Evidence becomes request body lines; a locator outside the Inputs (the subject only
 * for INPUTS and REQUIREMENTS) or without body lines stays as its raw text, which matches nothing and counts as noise.
 */
const specReadinessChecks = (/** @type {{allowContinuation: boolean, diagnostics: Array<{code: string, message: string}>, rows: any[], sources: Map<string, string>, subjectPath?: string}} */ {allowContinuation, diagnostics, rows, sources, subjectPath}) => {
    const expectedChecks = SPEC_READINESS_CHECKS;
    const evidenceOf = (/** @type {string} */ check, /** @type {unknown} */ evidence) => {
        if (!Array.isArray(evidence) || evidence.length === 0) return [];
        const scored = [];
        for (const item of evidence) {
            let compact;
            try { compact = parseCompactEvidence(item); } catch { scored.push(item); continue; }
            for (const locator of compact) {
                try {
                    const filePath = locator.filePath.replaceAll('\\', '/');
                    if (!sources.has(filePath) || (filePath === subjectPath && !SUBJECT_EVIDENCE_CHECKS.has(check))) throw new Error('not an Input');
                    const lines = normalizeBodyEvidence([{...locator, filePath}], sources);
                    if (lines.length === 0) throw new Error('no body lines');
                    scored.push(...lines);
                } catch { scored.push(item); }
            }
        }
        return [...new Map(scored.map(item => [JSON.stringify(item), item])).values()].sort(byKey);
    };
    let partial = false;
    /** @type {Map<string, Array<{evidence: unknown[], finding: string, result: string}>>} */
    const byCheck = new Map();
    /** Format diagnostics of rows of a known check; they count only while the check is kept (see `keeps`). */
    const rowFormat = [];
    for (const row of rows) {
        if (!isJsonObject(row) || !expectedChecks.includes(/** @type {string} */ (row.check)) || !['gap', 'uncertain'].includes(/** @type {string} */ (row.result))
            || typeof row.finding !== 'string' || row.finding.trim() === '') {
            partial = true;
            const invalid = diagnostic('review-format-invalid', 'A report row has no valid finding judgment.');
            if (isJsonObject(row) && expectedChecks.includes(/** @type {string} */ (row.check))) rowFormat.push({check: row.check, invalid});
            else diagnostics.push(invalid);
            continue;
        }
        if (Object.keys(row).sort().join(',') !== 'check,evidence,finding,result' || row.finding.trim() !== row.finding) {
            rowFormat.push({check: row.check, invalid: diagnostic('review-format-invalid', 'A report row representation is invalid.')});
        }
        const findings = byCheck.get(/** @type {string} */ (row.check)) ?? [];
        findings.push({evidence: evidenceOf(/** @type {string} */ (row.check), row.evidence), finding: row.finding, result: /** @type {string} */ (row.result)});
        byCheck.set(/** @type {string} */ (row.check), findings);
    }
    if (byCheck.size === 0) throw new NoContentError('Report has no scorable finding.', diagnostics);
    // A requirement-scope problem ends the review (Runtime Migration): checks after it are ignored and the continuation fails one clean case.
    const requirementsProblem = byCheck.has(SPEC_READINESS_CHECKS[1]);
    const continued = [...byCheck.keys()].some(check => !SPEC_READINESS_CHECKS.slice(0, 2).includes(check));
    const stopped = !allowContinuation && requirementsProblem;
    const selected = partial ? expectedChecks.filter(check => byCheck.has(check)) : stopped && !continued ? SPEC_READINESS_CHECKS.slice(0, 2) : expectedChecks;
    // Frozen scorer (scoring-k.patch withoutScopeContinuation): once the review continued past the stop, the checks after it and the diagnostics of their rows are dropped.
    const keeps = (/** @type {string} */ check) => !(stopped && continued) || SPEC_READINESS_CHECKS.slice(0, 2).includes(check);
    const checks = selected.filter(keeps).map(check => {
        const findings = byCheck.get(check);
        return findings === undefined ? {check, result: 'satisfied'}
            : {check, findings: findings.sort((left, right) => byKey(left, right)), result: derivedResult(findings)};
    });
    for (const {check, invalid} of rowFormat) if (keeps(/** @type {string} */ (check))) diagnostics.push(invalid);
    if (stopped && continued) diagnostics.push(diagnostic('requirement-scope-continuation', 'The review continued after a requirement-scope problem.'));
    return {checks, cleanObservations: [], reportDiagnostics: diagnostics, reportedFailedCleanCases: SCOPE_CONTINUATION_FAILS_CLEAN_CASE && stopped && continued ? 1 : 0};
};

const markdownBlocks = (/** @type {string} */ source) => {
    const blocks = [];
    for (const line of source.split(/\r?\n/u)) {
        if (FINDING_START.test(line)) blocks.push(line);
        else if (blocks.length > 0 && /^\s+/u.test(line)) blocks[blocks.length - 1] += `\n${line}`;
    }
    return blocks;
};

/** Locators a finding names: backticked spans and a leading bare locator. */
const markdownEvidence = (/** @type {string} */ block) => {
    const sources = [...block.matchAll(/`([^`]+)`/gu)].flatMap(match => match[1] === undefined ? [] : [match[1]]);
    const leading = /^- (?<locator>\S+)/u.exec(block)?.groups?.locator;
    if (leading !== undefined && !leading.startsWith('`')) sources.unshift(leading);
    /** @type {unknown[]} */
    const evidence = [];
    for (const source of sources) {
        if (/^[[(]\d{1,2}:\d{2}\s*,\s*\d{1,2}:\d{2}[)\]]$/u.test(source)) continue;
        // Clock times (`13:45`, `00:00:00.000`) are not locators.
        if (!/:[0-9]/u.test(source.replace(/(?<![\w./-])\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?(?![\w:])/gu, ''))) continue;
        try {
            for (const {filePath: rawPath, lineStart, lineEnd} of parseCompactEvidence(source)) {
                const filePath = rawPath.replaceAll('\\', '/');
                const value = lineStart === lineEnd ? {filePath, line: lineStart} : {filePath, lineEnd, lineStart};
                if (!evidence.some(existing => sortedKey(existing) === sortedKey(value))) evidence.push(value);
            }
        } catch { evidence.push(source); }
    }
    return evidence;
};

/** A backquoted `name.ext:lines` that names a file only is completed with its directory when exactly one source has that name and holds every line. */
const completeShortPaths = (/** @type {string} */ text, /** @type {Map<string, string>} */ sources) => {
    const counts = lineCounts(sources);
    return text.replace(SHORT_LOCATOR, (whole, name, lines) => {
        const path = shortLocatorPath(name, lines, counts);
        return path === undefined ? whole : `\`${path}:${lines}\``;
    });
};

const markdownFindings = (/** @type {string} */ text, /** @type {Map<string, string>} */ sources, /** @type {Array<{code: string, message: string}>} */ diagnostics) => {
    const completed = completeShortPaths(text, sources).trim();
    const blocks = markdownBlocks(completed);
    if (blocks.length === 0) throw new NoContentError('Report has no finding bullets.', [...diagnostics, FORMAT_INVALID]);
    // A non-blank line outside every finding (a preamble, or an unindented line after a finding) makes the whole report a format error, once.
    let inside = false;
    for (const line of completed.split(/\r?\n/u)) {
        if (FINDING_START.test(line)) inside = true;
        else if (line.trim() !== '' && !(inside && /^\s/u.test(line)) && !diagnostics.includes(FORMAT_INVALID)) diagnostics.push(FORMAT_INVALID);
    }
    return blocks.map(block => ({evidence: markdownEvidence(block), finding: block, result: 'gap'}));
};

const noProblems = (/** @type {string} */ text) => ['No problems.', 'No findings.'].includes(text.trim());

/** Commit Audit baseline rows (source, requirement, result, evidence, finding) against the answer key's requirement rows. */
const commitAuditJsonl = (/** @type {{diagnostics: Array<{code: string, message: string}>, expected: any, rows: any[], sources: Map<string, string>}} */ {diagnostics, expected, rows, sources}) => {
    const lineCount = (/** @type {string} */ filePath) => {
        const source = sources.get(filePath);
        return source === undefined ? 0 : source.length === 0 ? 0 : (source.endsWith('\n') ? source.slice(0, -1) : source).split('\n').length;
    };
    // The frozen flow normalized evidence first: same-file evidence in a row is merged, its lines sorted and adjacent or overlapping lines joined into regions.
    const regionOf = (/** @type {any} */ value) => Number.isSafeInteger(value) && value > 0 ? [value, value] : Array.isArray(value) && value.length === 2 && value.every(line => Number.isSafeInteger(line) && line > 0) && value[0] <= value[1] ? value : undefined;
    const canonical = (/** @type {unknown[]} */ evidence) => {
        /** @type {Map<string, any>} */
        const files = new Map();
        const others = [];
        for (const item of evidence) {
            const regions = isJsonObject(item) && typeof item.filePath === 'string' && Array.isArray(item.lines) && item.lines.length > 0 ? item.lines.map(regionOf) : undefined;
            if (regions === undefined || regions.includes(undefined)) others.push(item);
            else files.set(/** @type {any} */ (item).filePath, [...files.get(/** @type {any} */ (item).filePath) ?? [], ...regions]);
        }
        return [...files].flatMap(([filePath, regions]) => {
            /** @type {number[][]} */
            const merged = [];
            for (const region of regions.sort((/** @type {number[]} */ left, /** @type {number[]} */ right) => left[0] - right[0] || left[1] - right[1])) {
                const previous = merged.at(-1);
                if (previous !== undefined && region[0] <= previous[1] + 1) previous[1] = Math.max(previous[1], region[1]);
                else merged.push([...region]);
            }
            return /** @type {any[]} */ ([{filePath, lines: merged.map(([start, end]) => start === end ? start : [start, end])}]);
        }).concat(/** @type {any[]} */ (others));
    };
    const locators = (/** @type {unknown} */ evidence) => !Array.isArray(evidence) ? [] : /** @type {any[]} */ (canonical(evidence)).flatMap((/** @type {any} */ item) => {
        if (!isJsonObject(item) || typeof item.filePath !== 'string' || !Array.isArray(item.lines) || item.lines.length === 0) return [item];
        return item.lines.map(region => Number.isSafeInteger(region) && region > 0 && region <= lineCount(String(item.filePath))
            ? {filePath: item.filePath, line: region}
            : Array.isArray(region) && region.length === 2 && region.every(line => Number.isSafeInteger(line) && line > 0)
                && region[0] <= region[1] && region[0] <= lineCount(String(item.filePath))
                ? {filePath: item.filePath, lineEnd: region[1], lineStart: region[0]} : {filePath: item.filePath, lines: [region]});
    });
    const scopeOf = (/** @type {string} */ pathSuffix) => expected.scopes[/\/issues\//u.test(pathSuffix) ? 0 : 1].scope;
    const evidenceKey = (/** @type {unknown} */ evidence) => (Array.isArray(evidence) ? evidence : []).map(sortedKey).sort().join('|');
    const expectedRows = expected.auditRecords.flatMap((/** @type {{pathSuffix: string, requirements: Array<{evidence: unknown[], result: string, source: unknown}>}} */ record) => (
        record.requirements.map(requirement => ({...requirement, key: sortedKey(requirement.source), scope: scopeOf(record.pathSuffix)}))));
    const unused = rows.map((/** @type {unknown} */ row, /** @type {number} */ index) => ({index, row}));
    /** @type {Map<string, any>} */
    const claimed = new Map();
    const claim = (/** @type {{evidence: unknown[], key: string, result: string}} */ want) => {
        const candidates = unused.filter(({row}) => isJsonObject(row) && sortedKey(row.source) === want.key);
        const best = candidates.find(({row}) => isJsonObject(row) && row.result === want.result && evidenceKey(locators(row.evidence)) === evidenceKey(want.evidence))
            ?? candidates.find(({row}) => isJsonObject(row) && row.result === want.result) ?? candidates[0];
        if (best !== undefined) {
            unused.splice(unused.indexOf(best), 1);
            claimed.set(want.key, best.row);
        }
        return best?.row;
    };
    const checks = expected.scopes.map((/** @type {{scope: string}} */ scope) => ({check: scope.scope, findings: /** @type {unknown[]} */ ([]), result: 'satisfied'}));
    const cleanObservations = [];
    for (const want of expectedRows) {
        const scope = expected.scopes.find((/** @type {{scope: string}} */ candidate) => candidate.scope === want.scope);
        const row = claim(want);
        const valid = isJsonObject(row) && ['gap', 'satisfied', 'uncertain'].includes(/** @type {string} */ (row.result));
        if (row === undefined) diagnostics.push(diagnostic('requirement-missing', 'A requested requirement has no row.'));
        else if (!valid) diagnostics.push(diagnostic('requirement-row-invalid', 'A requirement row has no valid result.'));
        const cleanCaseIndex = scope.cleanCases.findIndex((/** @type {{noOtherSupportedFinding?: boolean, requirementSource?: string}} */ cleanCase) => (
            cleanCase.noOtherSupportedFinding !== true && cleanCase.requirementSource === want.key));
        if (want.result === 'satisfied' && cleanCaseIndex >= 0) {
            cleanObservations.push({actualEvidence: valid ? locators(row.evidence) : [], cleanCaseIndex, requirementSource: want.key,
                satisfied: valid && row.result === 'satisfied' && !Object.hasOwn(row, 'finding'), scope: want.scope});
        }
        if (valid && row.result !== 'satisfied') {
            checks.find((/** @type {{check: string}} */ check) => check.check === want.scope)?.findings.push({evidence: locators(row.evidence), finding: String(row.finding ?? ''),
                requirementSource: want.key, result: row.result});
        }
    }
    for (const check of checks) check.result = derivedResult(/** @type {Array<{result: string}>} */ (check.findings));
    // A row outside the requested requirements, or a second row for a requirement, fails one clean case.
    for (const {row} of unused) {
        if (!isJsonObject(row) || !isJsonObject(row.source)) diagnostics.push(diagnostic('review-row-unattributed', 'A report row cannot be assigned to a requirement.'));
        else if (!claimed.has(sortedKey(row.source))) diagnostics.push(diagnostic('requirement-source-unexpected', 'A report row is outside the requested requirements.'));
        else diagnostics.push(diagnostic(claimed.get(sortedKey(row.source)).result === row.result ? 'requirement-duplicate' : 'requirement-conflicting', 'A requirement has more than one row.'));
    }
    return {checks, cleanObservations, invalidEvidenceCode: 'evidence-locator-invalid', reportDiagnostics: diagnostics, reportedFailedCleanCases: unused.length};
};

/**
 * @param {{expected: any, extension: string, role: string, scenario: string, sources: Map<string, string>, subjectPath?: string, text: string}} input
 */
export const readReport = ({expected, extension, role, scenario, sources, subjectPath, text}) => {
    const baseline = extension === '.jsonl';
    /** @type {Array<{code: string, message: string}>} */
    const diagnostics = [];
    const empty = (/** @type {string[]} */ checkNames, /** @type {boolean} */ findings = false) => ({checks: checkNames.map(check => (findings ? {check, findings: [], result: 'satisfied'} : {check, result: 'satisfied'})),
        cleanObservations: [], reportDiagnostics: diagnostics, reportedFailedCleanCases: 0});
    if (role === 'spec-readiness-reviewer') {
        const rows = noProblems(text) ? [] : baseline ? jsonlRows(text, diagnostics) : specReadinessTextRows(text, diagnostics);
        if (noProblems(text) || (rows.length === 1 && sortedKey(rows[0]) === '{"status":"no-findings"}')) return empty(SPEC_READINESS_CHECKS);
        return specReadinessChecks({allowContinuation: scenario === 'artifact-promotion', diagnostics, rows, sources, subjectPath});
    }
    if (role === 'requirements-reviewer' && scenario === 'commit-audit') {
        if (baseline) {
            const rows = jsonlRows(text, diagnostics);
            if (rows.length === 0) throw new NoContentError('Report has no rows.', diagnostics);
            return commitAuditJsonl({diagnostics, expected, rows, sources});
        }
        // The current role's txt has no satisfied rows, so clean observations are not scored. A finding is read in the
        // scopes whose answer key placements it locates; one that locates none goes to the first scope.
        const matcher = createReviewerCapabilityEvidenceMatcher(sources);
        const findings = noProblems(text) ? [] : markdownFindings(text, sources, diagnostics);
        const checks = expected.scopes.map((/** @type {{scope: string, problemCases: any[]}} */ scope) => ({check: scope.scope, findings: findings.filter(finding => (
            (expected.scopes.some((/** @type {any} */ candidate) => candidate.problemCases.some((/** @type {any} */ problem) => (problem.placements ?? [problem]).some((/** @type {any} */ placement) => (
                matcher.containsAllLocators({actual: finding.evidence, expected: placement.associationEvidence}))))
            ) ? scope.problemCases.some((/** @type {any} */ problem) => (problem.placements ?? [problem]).some((/** @type {any} */ placement) => (
                matcher.containsAllLocators({actual: finding.evidence, expected: placement.associationEvidence})))) : scope === expected.scopes[0])))
            .map(finding => ({...finding})), result: 'satisfied'}));
        for (const check of checks) check.result = derivedResult(/** @type {Array<{result: string}>} */ (check.findings));
        return {checks, cleanObservations: [], reportDiagnostics: diagnostics, reportedFailedCleanCases: 0};
    }
    if (baseline) throw new ReportError('Only Spec Readiness and Commit Audit have a baseline JSONL report.');
    const scope = expected.scopes[0].scope;
    if (noProblems(text)) return empty([scope], true);
    return {checks: [{check: scope, findings: markdownFindings(text, sources, diagnostics), result: 'gap'}], cleanObservations: [], reportDiagnostics: diagnostics, reportedFailedCleanCases: 0};
};
