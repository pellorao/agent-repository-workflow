import {resolve} from 'node:path';

import {parseCompactEvidence} from '../common/evidence-locators.mjs';
import {
    normalizeReviewerCapabilityPath as normalizePath,
    reviewerCapabilityLocatorKey as locatorKey,
    reviewerCapabilityRelativePathWithinScope as relativePathWithinScope,
} from './reviewer-capability-evidence.mjs';
import {isJsonObject} from '../common/json.mjs';

/** @typedef {Record<string, unknown>} JsonObject */
/** @typedef {{candidateId: string}} Candidate */
/** @typedef {{earnedCleanPoints: number, earnedProblemPoints: number, fullProblemCases: number, passedCleanCases: number, scope: string, totalCleanCases: number, totalProblemCases: number}} ScopeScore */
/** @template CandidateType, ArtifactType @typedef {{candidates: CandidateType[], caseScores: {clean: number[][], problem: number[], }, cleanAcceptanceRate: number, earnedCleanPoints: number, earnedProblemPoints: number, fullProblemCases: number, passedCleanCases: number, problemDetectionRate: number, score: number, scopes: ScopeScore[], semanticProblemHits: number, totalCleanCases: number, totalProblemCases: number}} CapabilityScore */

const aggregateF2Score = (/** @type {{cleanAcceptanceRate: number, problemDetectionRate: number}} */ {cleanAcceptanceRate, problemDetectionRate}) => {
    if (cleanAcceptanceRate === 0 || problemDetectionRate === 0) return 0;
    return 5 * cleanAcceptanceRate * problemDetectionRate / (4 * cleanAcceptanceRate + problemDetectionRate);
};

/**
 * @template CandidateType, ArtifactType
 * @param {Array<CapabilityScore<CandidateType, ArtifactType>>} results
 * @returns {CapabilityScore<CandidateType, ArtifactType>}
 */
const combineScenarios = results => {
    const earnedCleanPoints = results.reduce((total, result) => total + result.earnedCleanPoints, 0);
    const earnedProblemPoints = results.reduce((total, result) => total + result.earnedProblemPoints, 0);
    const fullProblemCases = results.reduce((total, result) => total + result.fullProblemCases, 0);
    const passedCleanCases = results.reduce((total, result) => total + result.passedCleanCases, 0);
    const totalCleanCases = results.reduce((total, result) => total + result.totalCleanCases, 0);
    const totalProblemCases = results.reduce((total, result) => total + result.totalProblemCases, 0);
    const cleanAcceptanceRate = earnedCleanPoints / totalCleanCases;
    const problemDetectionRate = earnedProblemPoints / totalProblemCases;
    return {
        candidates: results.flatMap(result => result.candidates),
        caseScores: {
            clean: results.flatMap(result => result.caseScores.clean),
            problem: results.flatMap(result => result.caseScores.problem),
        },
        cleanAcceptanceRate,
        earnedCleanPoints,
        earnedProblemPoints,
        fullProblemCases,
        passedCleanCases,
        problemDetectionRate,
        score: aggregateF2Score({cleanAcceptanceRate, problemDetectionRate}),
        scopes: results.flatMap(result => result.scopes),
        semanticProblemHits: results.reduce((total, result) => total + result.semanticProblemHits, 0),
        totalCleanCases,
        totalProblemCases,
    };
};

const aggregateRepetitionScores = (/** @type {{repetitionScores: Array<{repetition: number, score: number}>, penaltyRepetitions: number[], totalRepetitions: number}} */ {
    repetitionScores, penaltyRepetitions, totalRepetitions,
}) => {
    if (!Number.isSafeInteger(totalRepetitions) || totalRepetitions < 1
        || repetitionScores.some(({repetition, score}) => !Number.isSafeInteger(repetition)
            || repetition < 1 || repetition > totalRepetitions || !Number.isFinite(score))) {
        throw new Error('Reviewer capability repetition scores are invalid.');
    }
    const ordered = [...repetitionScores].sort((left, right) => left.repetition - right.repetition);
    if (ordered.some((item, index) => index > 0 && item.repetition === ordered[index - 1].repetition)) {
        throw new Error('Reviewer capability repetition identities must be unique.');
    }
    const scoredRepetitions = new Set(ordered.map(item => item.repetition));
    if (penaltyRepetitions.some(repetition => !scoredRepetitions.has(repetition))) {
        throw new Error('Reviewer capability report error refers to an unscored repetition.');
    }
    const affected = new Set(penaltyRepetitions);
    const finalRepetitionScores = ordered.map(({repetition, score}) => ({
        repetition, score: affected.has(repetition) ? score * 0.9 : score,
    }));
    return {
        repetitionScores: ordered,
        finalRepetitionScores,
        ...(ordered.length === totalRepetitions ? {
            scoreBeforePenalty: ordered.reduce((total, item) => total + item.score, 0) / totalRepetitions,
            score: finalRepetitionScores.reduce((total, item) => total + item.score, 0) / totalRepetitions,
        } : {}),
    };
};

const artifactIdentityFailure = (/** @type {{input: unknown, reviewerIds: string[]}} */ {input, reviewerIds}) => {
    if (!isJsonObject(input) || Object.keys(input).length !== 1 || !Array.isArray(input.artifacts)) {
        return 'Reviewer capability artifact identities must be provided as one artifacts array.';
    }
    const actual = input.artifacts.map(artifact => isJsonObject(artifact) ? artifact.reviewerId : undefined);
    if (actual.length !== new Set(actual).size
        || actual.length !== reviewerIds.length
        || actual.some((value, index) => value !== reviewerIds[index])) {
        return 'Reviewer capability artifact identities must exactly equal the prepared Reviewer identity set.';
    }
    return undefined;
};

const bindingDrift = (/** @type {{actual: {reviewerInstructionsSha256?: string, roleSha256?: string, scenarioDigests?: string[]}, expected: {reviewerInstructionsSha256?: string, roleSha256?: string, scenarioDigests?: string[]}}} */ {actual, expected}) => {
    if (expected.roleSha256 !== undefined && actual.roleSha256 !== expected.roleSha256) return 'role';
    if (expected.reviewerInstructionsSha256 !== undefined
        && actual.reviewerInstructionsSha256 !== expected.reviewerInstructionsSha256) return 'reviewer-instructions';
    const expectedScenarios = expected.scenarioDigests ?? [];
    const actualScenarios = actual.scenarioDigests ?? [];
    if (actualScenarios.length !== expectedScenarios.length
        || actualScenarios.some((digest, index) => digest !== expectedScenarios[index])) return 'scenario';
    return undefined;
};

const validateAdjudication = (/** @type {{adjudication: unknown, candidates: Candidate[]}} */ {adjudication, candidates}) => {
    const invalid = () => ({
        finding: 'Reviewer capability adjudication decisions must exactly equal the eligible text candidate set.',
    });
    if (!isJsonObject(adjudication)
        || Object.keys(adjudication).join(',') !== 'decisions'
        || !Array.isArray(adjudication.decisions)) return invalid();
    const expectedIds = new Set(candidates.map(candidate => candidate.candidateId));
    /** @type {Map<string, string>} */
    const decisions = new Map();
    for (const item of adjudication.decisions) {
        if (!isJsonObject(item)
            || Object.keys(item).sort().join(',') !== 'candidateId,decision,reason'
            || typeof item.candidateId !== 'string'
            || !expectedIds.has(item.candidateId)
            || decisions.has(item.candidateId)
            || typeof item.decision !== 'string'
            || !['matched', 'not-matched'].includes(item.decision)
            || typeof item.reason !== 'string'
            || item.reason.trim().length === 0) return invalid();
        decisions.set(item.candidateId, item.decision);
    }
    if (decisions.size !== expectedIds.size) return invalid();
    return {decisions};
};

/**
 * Build every Reviewer contract before exposing a prepared record. The injected
 * writer is called only after all contract builders have succeeded.
 *
 * @template Contract, Generation, Handoff
 * @param {{create: (reviewerId: string) => Promise<{contract: Contract, generations: Generation[], handoffs: Handoff[]}>, reviewerIds: string[], write: (contracts: Contract[]) => Promise<string>}} input
 * @returns {Promise<{contracts: Contract[], generations: Generation[], handoffs: Handoff[], preparedPath: string}>}
 */
const prepareAtomically = async ({create, reviewerIds, write}) => {
    const entries = [];
    for (const reviewerId of reviewerIds) entries.push(await create(reviewerId));
    const contracts = entries.map(entry => entry.contract);
    return {
        contracts,
        generations: entries.flatMap(entry => entry.generations),
        handoffs: entries.flatMap(entry => entry.handoffs),
        preparedPath: await write(contracts),
    };
};

const closedOperationFailure = (/** @type {{code: string, error: unknown}} */ {code, error}) => ({
    diagnostics: [{
        code,
        message: error instanceof Error ? error.message : String(error),
        stage: 'reviewer-capability',
    }],
    status: 'failed',
});

const releaseVerificationResult = (/** @type {{preparedMode?: string, result: JsonObject}} */ {preparedMode, result}) => {
    if (result.status !== 'verified') {
        return {
            diagnostics: result.status === 'needs-adjudication'
                ? [{
                    code: 'adjudication-required',
                    message: 'Reviewer capability release verification requires Main Agent adjudication.',
                    stage: 'reviewer-capability',
                }]
                : (Array.isArray(result.diagnostics) ? result.diagnostics : []).filter(isJsonObject).map(diagnostic => ({
                    code: diagnostic.code,
                    message: diagnostic.message,
                    stage: diagnostic.stage ?? 'reviewer-capability',
                })),
            status: 'failed',
        };
    }
    if (preparedMode !== 'release') {
        return {
            diagnostics: [{
                code: 'malformed-input',
                message: 'Reviewer capability release verification requires a release prepared record.',
                stage: 'reviewer-capability',
            }],
            status: 'failed',
        };
    }
    return {
        reviewerIds: Array.isArray(result.reviewerIds) ? result.reviewerIds : [],
        status: 'verified',
    };
};

const markdownFindingBlocks = (/** @type {string} */ source) => {
    /** @type {string[]} */
    const blocks = [];
    for (const line of source.split(/\r?\n/)) {
        if (line.startsWith('- ') || /^[1-9][0-9]*\. /.test(line)) {
            blocks.push(line);
            continue;
        }
        if (line.trim().length === 0) continue;
        if (blocks.length === 0 || !/^\s+/.test(line)) return undefined;
        blocks[blocks.length - 1] += `\n${line}`;
    }
    return blocks;
};

const markdownEvidence = (/** @type {string} */ block) => {
    const locatorSources = [...block.matchAll(/`([^`]+)`/g)].flatMap(match => match[1] === undefined ? [] : [match[1]]);
    const leading = /^- (?<locator>\S+)/.exec(block)?.groups?.locator;
    if (leading !== undefined && !leading.startsWith('`')) locatorSources.unshift(leading);
    /** @type {unknown[]} */
    const evidence = [];
    const reportDiagnostics = [];
    for (const source of locatorSources) {
        if (/^[[(]\d{1,2}:\d{2}\s*,\s*\d{1,2}:\d{2}[)\]]$/u.test(source)) continue;
        if (!/:[0-9]/.test(source)) continue;
        try {
            for (const {filePath: rawPath, lineStart, lineEnd} of parseCompactEvidence(source)) {
                const filePath = normalizePath(rawPath);
                const value = lineStart === lineEnd
                    ? {filePath, line: lineStart}
                    : {filePath, lineEnd, lineStart};
                if (!evidence.some(existing => locatorKey(existing) === locatorKey(value))) evidence.push(value);
            }
        } catch {
            evidence.push(source);
            reportDiagnostics.push({code: 'review-evidence-invalid', message: `Markdown evidence locator is invalid: ${source}.`});
        }
    }
    return {evidence, reportDiagnostics};
};

const parseMarkdownArtifact = (/** @type {{response: string, reviewerId: string, scope?: string}} */ {response, reviewerId, scope}) => {
    const source = response.trim();
    if (scope === undefined) return {finding: `${reviewerId} expected fixture has no review scope.`};
    if (source === 'No findings.') return {checks: [{check: scope, findings: [], result: 'satisfied'}], reportDiagnostics: []};
    const reportDiagnostics = [];
    let blocks = markdownFindingBlocks(source);
    if (blocks === undefined) {
        reportDiagnostics.push({code: 'review-format-invalid', message: 'Markdown report must contain only finding bullets or exact No findings.'});
        blocks = [];
        for (const line of source.split(/\r?\n/)) {
            if (line.startsWith('- ') || /^[1-9][0-9]*\. /.test(line)) blocks.push(line);
            else if (blocks.length > 0 && /^\s+/.test(line)) blocks[blocks.length - 1] += `\n${line}`;
        }
    }
    if (blocks.length === 0) return {finding: `${reviewerId} report has no scorable content; a confirmed modelFailure is required.`,
        reportDiagnostics: source.length === 0 ? [] : [{code: 'review-format-invalid', message: 'Markdown report has no parseable finding representation.'}]};
    const findings = blocks.map(block => {
        const parsed = markdownEvidence(block);
        reportDiagnostics.push(...parsed.reportDiagnostics);
        return {evidence: parsed.evidence, finding: block, result: 'gap'};
    });
    if (findings.some(finding => finding.evidence.length === 0)) {
        reportDiagnostics.push({code: 'review-evidence-invalid', message: 'Markdown finding is missing a locatable file and line.'});
    }
    return {checks: [{check: scope, findings, result: 'gap'}], reportDiagnostics};
};

const fullReviewBindingFailure = (/** @type {{expected: JsonObject, review: JsonObject}} */ {expected, review}) => {
    if (JSON.stringify(review.inputs) !== JSON.stringify(expected.inputs)
        || JSON.stringify(review.request) !== JSON.stringify(expected.request)
        || JSON.stringify(review.reviewerRole) !== JSON.stringify(expected.reviewerRole)
        || JSON.stringify(review.subject) !== JSON.stringify(expected.subject)) return 'binding';
    if (!Array.isArray(review.checks) || !Array.isArray(expected.scopes)) return 'checks';
    const checks = review.checks;
    const scopes = expected.scopes;
    if (checks.length !== scopes.length
        || scopes.some((scope, index) => !isJsonObject(scope)
            || !isJsonObject(checks[index])
            || checks[index].check !== scope.scope)) return 'checks';
    return undefined;
};

const pathWithinTemporaryRoot = (/** @type {{path: string, repositoryRoot: string}} */ {path, repositoryRoot}) => {
    const relativePath = relativePathWithinScope(repositoryRoot, path);
    return relativePath !== null && relativePath.startsWith('.tmp/');
};

const comparablePath = (/** @type {string} */ value) => process.platform === 'win32' ? value.toLowerCase() : value;

const validateArtifactBatch = (/** @type {{contract: {instances: Array<{instanceId: string, reportPath: string, resultPath?: string, scenarioRoot: string}>, platform: string}, item: unknown, repositoryRoot: string}} */ {contract, item, repositoryRoot}) => {
    if (!isJsonObject(item)
        || Object.keys(item).sort().join(',') !== 'instances,reviewerId'
        || typeof item.reviewerId !== 'string'
        || !Array.isArray(item.instances)
        || item.instances.length !== contract.instances.length) {
        return {finding: 'Unknown Reviewer artifact entry is malformed.', reviewerId: ''};
    }
    const reviewerId = item.reviewerId;
    const instances = [];
    const formalArtifactPaths = new Set();
    for (const [index, rawInstance] of item.instances.entries()) {
        const prepared = contract.instances[index];
        const hasModelFailure = isJsonObject(rawInstance) && Object.hasOwn(rawInstance, 'modelFailure');
        const hasFormatCorrection = isJsonObject(rawInstance) && Object.hasOwn(rawInstance, 'formatCorrection');
        const expectedKeys = hasModelFailure ? 'artifactPaths,instanceId,modelFailure'
            : hasFormatCorrection ? 'artifactPaths,formatCorrection,instanceId' : 'artifactPaths,instanceId';
        if (!isJsonObject(rawInstance)
            || Object.keys(rawInstance).sort().join(',') !== expectedKeys
            || prepared === undefined
            || rawInstance.instanceId !== prepared.instanceId) {
            return {finding: `${reviewerId} instance identities must exactly equal the prepared instance set.`, reviewerId};
        }
        if (hasModelFailure) {
            if (rawInstance.artifactPaths !== null || !isJsonObject(rawInstance.modelFailure)
                || Object.keys(rawInstance.modelFailure).join(',') !== 'reason'
                || typeof rawInstance.modelFailure.reason !== 'string'
                || rawInstance.modelFailure.reason.trim().length === 0) {
                return {finding: `${reviewerId} ${prepared.instanceId} model failure input is malformed.`, reviewerId};
            }
            instances.push({artifactPaths: null, modelFailure: {reason: rawInstance.modelFailure.reason}, instanceId: rawInstance.instanceId});
            continue;
        }
        if (hasFormatCorrection) {
            const correction = rawInstance.formatCorrection;
            if (rawInstance.artifactPaths !== null || !isJsonObject(correction)
                || Object.keys(correction).sort().join(',') !== 'correctedReportPath,originalReportPath'
                || typeof correction.originalReportPath !== 'string'
                || correction.originalReportPath !== prepared.reportPath
                || typeof correction.correctedReportPath !== 'string'
                || !pathWithinTemporaryRoot({path: correction.correctedReportPath, repositoryRoot: prepared.scenarioRoot})
                || comparablePath(resolve(correction.correctedReportPath)) === comparablePath(resolve(prepared.reportPath))) {
                return {finding: `${reviewerId} ${prepared.instanceId} format correction is not bound to a distinct scenario report.`, reviewerId};
            }
            const originalPath = comparablePath(resolve(prepared.reportPath));
            const correctedPath = comparablePath(resolve(correction.correctedReportPath));
            if (formalArtifactPaths.has(originalPath) || formalArtifactPaths.has(correctedPath)) {
                return {finding: `${reviewerId} formal artifacts must be unique to one prepared instance.`, reviewerId};
            }
            formalArtifactPaths.add(originalPath);
            formalArtifactPaths.add(correctedPath);
            instances.push({artifactPaths: null, formatCorrection: {
                originalReportPath: correction.originalReportPath,
                correctedReportPath: correction.correctedReportPath,
            }, instanceId: rawInstance.instanceId});
            continue;
        }
        if (rawInstance.artifactPaths === null) {
            return {finding: `${reviewerId} ${prepared.instanceId} formal artifact output is incomplete.`, reviewerId};
        }
        if (!Array.isArray(rawInstance.artifactPaths)
            || rawInstance.artifactPaths.length === 0
            || rawInstance.artifactPaths.some(path => typeof path !== 'string'
                || !pathWithinTemporaryRoot({path, repositoryRoot}))) {
            return {finding: `${reviewerId} ${prepared.instanceId} artifact path set is not a safe Repository temporary path set.`, reviewerId};
        }
        const artifactPaths = rawInstance.artifactPaths.filter((/** @type {unknown} */ path) => typeof path === 'string');
        if (prepared.resultPath !== undefined
            && (artifactPaths.length !== 1 || artifactPaths[0] !== prepared.resultPath)) {
            return {finding: `${reviewerId} ${prepared.instanceId} result artifact must belong to its prepared scenario.`, reviewerId};
        }
        if (artifactPaths.some(path => {
            const canonicalPath = comparablePath(resolve(path));
            if (formalArtifactPaths.has(canonicalPath)) return true;
            formalArtifactPaths.add(canonicalPath);
            return false;
        })) {
            return {finding: `${reviewerId} formal artifacts must be unique to one prepared instance.`, reviewerId};
        }
        instances.push({artifactPaths, instanceId: rawInstance.instanceId});
    }
    return {item: {instances, reviewerId}};
};

const selectCompletedRepetitions = (/** @type {{allowEmpty?: boolean, contract: {instances: Array<{instanceId: string}>, reviewerId: string}, item: unknown, scenarioCount: number}} */ {allowEmpty = false, contract, item, scenarioCount}) => {
    const invalid = () => ({finding: 'Reviewer capability observation input must contain ordered prepared instance results.'});
    if (!isJsonObject(item) || !Array.isArray(item.instances)) return invalid();
    const actual = item.instances;
    const preparedIds = new Set(contract.instances.map(instance => instance.instanceId));
    const actualIds = actual.map(instance => isJsonObject(instance) ? instance.instanceId : undefined);
    if (actualIds.some(id => typeof id !== 'string' || !preparedIds.has(id))
        || new Set(actualIds).size !== actualIds.length) return invalid();
    const actualSet = new Set(actualIds);
    const repetitions = [];
    const indexes = [];
    for (let index = 0; index < contract.instances.length; index += scenarioCount) {
        const group = contract.instances.slice(index, index + scenarioCount);
        const present = group.filter(instance => actualSet.has(instance.instanceId));
        if (present.length === 0) continue;
        if (present.length === group.length) repetitions.push(index / scenarioCount + 1);
        indexes.push(...group.flatMap((instance, offset) => actualSet.has(instance.instanceId) ? [index + offset] : []));
    }
    if ((!allowEmpty && indexes.length === 0) || actual.length !== indexes.length
        || indexes.some((index, position) => actualIds[position] !== contract.instances[index]?.instanceId)) return invalid();
    return {indexes, repetitions};
};

const capabilityGateResult = (/** @type {{results: Array<{reviewerId: string, score?: number}>, reviewerIds: string[]}} */ {results, reviewerIds}) => {
    const gatedResults = results.map(result => ({...result,
        scoreGate: result.score !== undefined && result.score >= 0.75 ? 'passed' : 'failed'}));
    const failedReviewer = gatedResults.find(result => result.scoreGate === 'failed');
    if (failedReviewer !== undefined) return {
        diagnostics: [{code: 'reviewer-capability-mismatch',
            message: `${failedReviewer.reviewerId} capability score is below 0.75 or incomplete.`,
            reviewerId: failedReviewer.reviewerId}],
        results: gatedResults,
        status: 'failed',
    };
    return {results: gatedResults, reviewerIds, status: 'verified'};
};

export const reviewerCapabilityVerificationCore = Object.freeze({
    aggregateRepetitionScores,
    artifactIdentityFailure,
    bindingDrift,
    capabilityGateResult,
    closedOperationFailure,
    combineScenarios,
    fullReviewBindingFailure,
    parseMarkdownArtifact,
    prepareAtomically,
    releaseVerificationResult,
    selectCompletedRepetitions,
    validateAdjudication,
    validateArtifactBatch,
});
