import {isAbsolute} from 'node:path';

import {normalizeBodyEvidence} from '../common/evidence-locators.mjs';
import {cloneJsonValue, compareText, isJsonObject} from '../common/json.mjs';
import {createReviewerCapabilityEvidenceMatcher} from './reviewer-capability-evidence.mjs';
import {ALL_REVIEWERS} from './reviewer-capability-identities.mjs';

/** @typedef {Record<string, unknown>} JsonObject */
/** @typedef {{anchor?: string, filePath: string, line?: number}} FixtureLocator */
/** @typedef {{associationEvidence: FixtureLocator[], check: string, evidence: FixtureLocator[]}} FixturePlacement */
/** @typedef {{associationEvidence?: FixtureLocator[], evidence?: FixtureLocator[], evidenceAlternatives?: FixtureLocator[][], expectation?: string, findingTerms?: Array<string | string[]>, noOtherSupportedFinding?: boolean, placements?: FixturePlacement[], requirementSource?: string, result?: string}} FixtureCase */
/** @typedef {{cleanCases: FixtureCase[], problemCases: FixtureCase[], scope: string}} FixtureScope */
/** @typedef {{cleanCount: number, problemCount: number, scopes: FixtureScope[]}} ExpectedFixture */
/** @typedef {{check: string, findings?: Finding[], result: string}} ReviewCheck */
/** @typedef {{evidence: unknown[], finding: string, requirementSource?: string, result: string}} Finding */
/** @typedef {{check: string, finding: Finding, findingIndex: number}} ActualFinding */
/** @typedef {{problemCase: FixtureCase, problemCaseIndex: number, scope: string, scopeIndex: number}} ProblemCaseEntry */
/** @typedef {{basePoints: number, caseIndex: number, findingIndex: number}} FindingAssociation */
/** @typedef {ReturnType<typeof createReviewerCapabilityEvidenceMatcher>} EvidenceMatcher */
/** @typedef {{actualEvidence: unknown[], cleanCaseIndex: number, requirementSource?: string, satisfied: boolean, scope: string}} CleanObservation */
/** @typedef {{candidateId: string, check: string, evidence: unknown[], expectation: string, finding: string, findingIndex: number, instanceId: string, problemCaseIndex: number, problemScope: string, result: string, reviewerId: string}} TextCandidate */

const tokenVariants = (/** @type {string} */ token) => {
    const variants = new Set([token]);
    if (token.length > 4 && token.endsWith('ies')) variants.add(`${token.slice(0, -3)}y`);
    if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) variants.add(token.slice(0, -1));
    for (const suffix of ['ing', 'ed']) {
        if (token.length <= suffix.length + 2 || !token.endsWith(suffix)) continue;
        const root = token.slice(0, -suffix.length);
        variants.add(root);
        variants.add(`${root}e`);
        if (root.length > 2 && root.at(-1) === root.at(-2)) variants.add(root.slice(0, -1));
    }
    return variants;
};

const textTokens = (/** @type {string} */ source) => source.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

const conceptAlternativeMatches = (/** @type {{finding: string, term: string}} */ {finding, term}) => {
    const actualTokens = textTokens(finding);
    const expectedTokens = textTokens(term);
    if (expectedTokens.length === 0) return false;
    return expectedTokens.every(expectedToken => {
        const expectedVariants = tokenVariants(expectedToken);
        return actualTokens.some(actualToken => [...tokenVariants(actualToken)].some(
            variant => expectedVariants.has(variant),
        ));
    });
};

const findingTermsMatch = (/** @type {unknown} */ finding, /** @type {Array<string | string[]> | undefined} */ groups) => {
    if (typeof finding !== 'string') return false;
    return (groups ?? []).every(group => (Array.isArray(group) ? group : [group]).some(
        term => conceptAlternativeMatches({finding, term}),
    ));
};

const findingEvidence = (/** @type {unknown} */ finding) => isJsonObject(finding) && Array.isArray(finding.evidence) ? finding.evidence : [];

const problemPlacements = (/** @type {{problemCase: FixtureCase, scope: string}} */ {problemCase, scope}) => problemCase.placements ?? [{
    associationEvidence: problemCase.associationEvidence ?? [],
    check: scope,
    evidence: problemCase.evidence ?? [],
}];

const cleanEvidenceSets = (/** @type {FixtureCase} */ cleanCase) => [cleanCase.evidence ?? [], ...(cleanCase.evidenceAlternatives ?? [])];

const fBetaScore = (/** @type {{beta: number, precision: number, recall: number}} */ {beta, precision, recall}) => {
    if (recall === 0 || precision === 0) return 0;
    const betaSquared = beta ** 2;
    return ((1 + betaSquared) * precision * recall) / (betaSquared * precision + recall);
};

const f3Score = (/** @type {{coverage: number, precision: number}} */ {coverage, precision}) => fBetaScore({beta: 3, precision, recall: coverage});

const f1Score = (/** @type {{left: number, right: number}} */ {left, right}) => fBetaScore({beta: 1, precision: right, recall: left});

const evidenceF3Score = (/** @type {{actual: unknown[], expected: FixtureLocator[], evidenceMatcher: EvidenceMatcher}} */ {actual, expected, evidenceMatcher}) => f3Score(
    evidenceMatcher.matchRates({actual, expected}),
);

const scoreCleanObservations = (/** @type {{cleanObservations: CleanObservation[], evidenceMatcher: EvidenceMatcher, expected: ExpectedFixture}} */ {
    cleanObservations,
    evidenceMatcher,
    expected,
}) => {
    const scopesById = new Map(expected.scopes.map(scope => [scope.scope, scope]));
    const scores = new Map(expected.scopes.map(scope => [scope.scope, new Map()]));
    for (const observation of cleanObservations) {
        const cleanCase = scopesById.get(observation.scope)?.cleanCases[observation.cleanCaseIndex];
        const scopeScores = scores.get(observation.scope);
        if (cleanCase === undefined || cleanCase.noOtherSupportedFinding === true || scopeScores === undefined
            || scopeScores.has(observation.cleanCaseIndex)) {
            throw new TypeError('Reviewer capability clean observation binding is invalid.');
        }
        const points = observation.satisfied
            ? Math.max(...cleanEvidenceSets(cleanCase).map(expectedEvidence => evidenceF3Score({
                actual: observation.actualEvidence,
                expected: expectedEvidence,
                evidenceMatcher,
            })))
            : 0;
        scopeScores.set(observation.cleanCaseIndex, points);
    }
    return scores;
};

const textCandidateId = (/** @type {{actual: ActualFinding, instanceId: string, problemCaseIndex: number, reviewerId: string, scopeIndex: number}} */ {actual, instanceId, problemCaseIndex, reviewerId, scopeIndex}) => [
    reviewerId,
    instanceId,
    `scope-${scopeIndex + 1}`,
    `problem-${problemCaseIndex + 1}`,
    actual.check,
    `finding-${actual.findingIndex + 1}`,
].join(':');

const flattenActualFindings = (/** @type {ReviewCheck[]} */ checks) => checks.flatMap(check => (
    Array.isArray(check.findings) ? check.findings.map((finding, findingIndex) => ({
        check: check.check,
        finding,
        findingIndex,
    })) : []
));

const flattenProblemCases = (/** @type {ExpectedFixture} */ expected) => expected.scopes.flatMap((expectedScope, scopeIndex) => (
    expectedScope.problemCases.map((problemCase, problemCaseIndex) => ({
        problemCase,
        problemCaseIndex,
        scope: expectedScope.scope,
        scopeIndex,
    }))
));

const findProblemAssociations = (/** @type {{actualFindings: ActualFinding[], adjudicationDecisions: Map<string, string>, evidenceMatcher: EvidenceMatcher, instanceId: string, problemCases: ProblemCaseEntry[], reviewerId: string}} */ {
    actualFindings,
    adjudicationDecisions,
    evidenceMatcher,
    instanceId,
    problemCases,
    reviewerId,
}) => {
    /** @type {FindingAssociation[]} */
    const associations = [];
    /** @type {TextCandidate[]} */
    const candidates = [];
    for (const [caseIndex, entry] of problemCases.entries()) {
        if (typeof entry.problemCase.expectation !== 'string' || entry.problemCase.expectation.trim().length === 0) {
            throw new TypeError('Reviewer capability problem expectation is invalid.');
        }
        for (const [findingIndex, actual] of actualFindings.entries()) {
            const actualEvidence = findingEvidence(actual.finding);
            const matchingPlacements = problemPlacements(entry).filter(placement => (
                placement.check === actual.check
                && (entry.problemCase.requirementSource === undefined
                    || entry.problemCase.requirementSource === actual.finding.requirementSource)
                && evidenceMatcher.scoredExpectedEvidence(placement.associationEvidence).length > 0
                && evidenceMatcher.scoredExpectedEvidence(placement.associationEvidence).every(expectedLocator => (
                    actualEvidence.some(actualLocator => evidenceMatcher.locatorMatches({
                        actual: actualLocator,
                        expected: expectedLocator,
                    }))
                ))
            ));
            if (matchingPlacements.length === 0) continue;
            const candidateId = textCandidateId({
                actual,
                instanceId,
                problemCaseIndex: entry.problemCaseIndex,
                reviewerId,
                scopeIndex: entry.scopeIndex,
            });
            candidates.push({
                candidateId,
                check: actual.check,
                evidence: actualEvidence,
                expectation: entry.problemCase.expectation,
                finding: actual.finding.finding,
                findingIndex: actual.findingIndex,
                instanceId,
                problemCaseIndex: entry.problemCaseIndex + 1,
                problemScope: entry.scope,
                result: actual.finding.result,
                reviewerId,
            });
            if (adjudicationDecisions.get(candidateId) !== 'matched') continue;
            const bestPlacement = matchingPlacements.map(placement => ({
                placement,
                evidenceScore: evidenceF3Score({
                    actual: actualEvidence,
                    expected: placement.evidence,
                    evidenceMatcher,
                }),
            })).reduce((best, candidate) => candidate.evidenceScore > best.evidenceScore ? candidate : best);
            associations.push({
                basePoints: (actual.finding?.result === entry.problemCase.result ? 0.4 : 0)
                    + bestPlacement.evidenceScore * 0.4,
                caseIndex,
                findingIndex,
            });
        }
    }
    return {associations, candidates};
};

const associationsByIndex = (/** @type {{associations: FindingAssociation[], count: number, key: 'caseIndex' | 'findingIndex'}} */ {associations, count, key}) => Array.from({length: count}, (_, index) => (
    associations.filter(association => association[key] === index)
));

const scoreProblemCases = (/** @type {{associationsByCase: FindingAssociation[][], associationsByFinding: FindingAssociation[][]}} */ {associationsByCase, associationsByFinding}) => associationsByCase.map(caseAssociations => {
    if (caseAssociations.length === 0) return 0;
    const best = caseAssociations.reduce((/** @type {FindingAssociation} */ current, /** @type {FindingAssociation} */ candidate) => (
            candidate.basePoints > current.basePoints ? candidate : current
    ));
    const atomicityPoints = f1Score({
        left: 1 / caseAssociations.length,
        right: 1 / (associationsByFinding[best.findingIndex]?.length ?? 1),
    }) * 0.2;
    return best.basePoints + atomicityPoints;
});

const cleanCasePasses = (/** @type {{actualFindings: ActualFinding[], cleanCase: FixtureCase, evidenceMatcher: EvidenceMatcher, unassociatedFindingIndexes: number[]}} */ {
    actualFindings,
    cleanCase,
    evidenceMatcher,
    unassociatedFindingIndexes,
}) => {
    if (cleanCase.noOtherSupportedFinding === true) return unassociatedFindingIndexes.length === 0;
    return !unassociatedFindingIndexes.some(index => {
        const actual = actualFindings[index];
        if (actual === undefined) return false;
        if (cleanCase.requirementSource !== undefined
            && actual.finding.requirementSource !== cleanCase.requirementSource) return false;
        return cleanEvidenceSets(cleanCase).some(expected => evidenceMatcher.containsAllLocators({
            actual: findingEvidence(actual.finding),
            expected,
        })) && findingTermsMatch(actual.finding?.finding, cleanCase.findingTerms);
    });
};

const scoreScopes = (/** @type {{actualFindings: ActualFinding[], associationsByFinding: FindingAssociation[][], cleanObservationScores: Map<string, Map<number, number>>, evidenceMatcher: EvidenceMatcher, expected: ExpectedFixture, problemCases: ProblemCaseEntry[], problemScores: number[]}} */ {
    actualFindings,
    associationsByFinding,
    cleanObservationScores,
    evidenceMatcher,
    expected,
    problemCases,
    problemScores,
}) => {
    /** @type {number[][]} */
    const clean = [];
    const scopes = expected.scopes.map(expectedScope => {
        const unassociatedFindingIndexes = actualFindings.flatMap((actual, index) => (
            actual.check === expectedScope.scope && (associationsByFinding[index]?.length ?? 0) === 0 ? [index] : []
        ));
        const observationScores = cleanObservationScores.get(expectedScope.scope) ?? new Map();
        const cleanCaseScores = expectedScope.cleanCases.map((cleanCase, cleanCaseIndex) => {
            const falseFindingScore = cleanCasePasses({
                actualFindings,
                cleanCase,
                evidenceMatcher,
                unassociatedFindingIndexes,
            }) ? 1 : 0;
            const observationScore = observationScores.get(cleanCaseIndex);
            return observationScore === undefined ? falseFindingScore : Math.min(falseFindingScore, observationScore);
        });
        clean.push(cleanCaseScores);
        const ownedScores = problemCases.flatMap((entry, index) => entry.scope === expectedScope.scope
            ? [problemScores[index] ?? 0]
            : []);
        return {
            earnedCleanPoints: cleanCaseScores.reduce((total, points) => total + points, 0),
            earnedProblemPoints: ownedScores.reduce((total, points) => total + points, 0),
            fullProblemCases: ownedScores.filter((/** @type {number} */ points) => Math.abs(points - 1) < Number.EPSILON * 8).length,
            passedCleanCases: cleanCaseScores.filter((/** @type {number} */ points) => Math.abs(points - 1) < Number.EPSILON * 8).length,
            scope: expectedScope.scope,
            totalCleanCases: expectedScope.cleanCases.length,
            totalProblemCases: expectedScope.problemCases.length,
        };
    });
    return {clean, scopes};
};

const scoreExpectedScopes = (/** @type {{adjudicationDecisions?: Map<string, string>, checks: ReviewCheck[], cleanObservationScores?: Map<string, Map<number, number>>, evidenceMatcher: EvidenceMatcher, expected: ExpectedFixture, instanceId: string, reviewerId: string}} */ {
    adjudicationDecisions = new Map(),
    checks,
    cleanObservationScores = new Map(),
    evidenceMatcher,
    expected,
    instanceId,
    reviewerId,
}) => {
    const actualFindings = flattenActualFindings(checks);
    const problemCases = flattenProblemCases(expected);
    const {associations, candidates} = findProblemAssociations({
        actualFindings,
        adjudicationDecisions,
        evidenceMatcher,
        instanceId,
        problemCases,
        reviewerId,
    });
    const associationsByCase = associationsByIndex({associations, count: problemCases.length, key: 'caseIndex'});
    const associationsByFinding = associationsByIndex({associations, count: actualFindings.length, key: 'findingIndex'});
    const problemScores = scoreProblemCases({associationsByCase, associationsByFinding});
    const scoped = scoreScopes({
        actualFindings,
        associationsByFinding,
        cleanObservationScores,
        evidenceMatcher,
        expected,
        problemCases,
        problemScores,
    });
    const scopes = scoped.scopes;
    const earnedProblemPoints = problemScores.reduce((total, points) => total + points, 0);
    const fullProblemCases = problemScores.filter((/** @type {number} */ points) => Math.abs(points - 1) < Number.EPSILON * 8).length;
    const earnedCleanPoints = scopes.reduce((points, scope) => points + scope.earnedCleanPoints, 0);
    const passedCleanCases = scopes.reduce((count, scope) => count + scope.passedCleanCases, 0);
    const problemDetectionRate = earnedProblemPoints / expected.problemCount;
    const cleanAcceptanceRate = earnedCleanPoints / expected.cleanCount;
    return {
        candidates,
        caseScores: {clean: scoped.clean, problem: problemScores},
        cleanAcceptanceRate,
        earnedCleanPoints,
        earnedProblemPoints,
        fullProblemCases,
        passedCleanCases,
        problemDetectionRate,
        score: fBetaScore({
            beta: 2,
            precision: cleanAcceptanceRate,
            recall: problemDetectionRate,
        }),
        scopes,
        semanticProblemHits: associations.length,
        totalCleanCases: expected.cleanCount,
        totalProblemCases: expected.problemCount,
    };
};

export class ReviewerCapabilityEvidenceError extends Error {}

/**
 * 创建一个只处理单个 Reviewer 场景实例的纯内存评分操作.
 * 调用方先完成 artifact identity, grammar 与 evidence source binding.
 */
export const createReviewerCapabilityScenarioScorer = (/** @type {{evidenceSources: Map<string, string>, expected: ExpectedFixture, instanceId: string, reviewerId: string, scenarioRoot: string}} */ {
    evidenceSources,
    expected,
    instanceId,
    reviewerId,
    scenarioRoot,
}) => {
    if (!(evidenceSources instanceof Map)
        || !isJsonObject(expected)
        || !Array.isArray(expected.scopes)
        || !Number.isSafeInteger(expected.problemCount)
        || !Number.isSafeInteger(expected.cleanCount)
        || typeof instanceId !== 'string'
        || instanceId.length === 0
        || typeof reviewerId !== 'string'
        || !ALL_REVIEWERS.has(reviewerId)
        || typeof scenarioRoot !== 'string'
        || !isAbsolute(scenarioRoot)) {
        throw new TypeError('Reviewer capability scenario scorer input is invalid.');
    }
    const sources = new Map(evidenceSources);
    if ([...sources].some(([filePath, source]) => typeof filePath !== 'string' || filePath.length === 0 || typeof source !== 'string')) {
        throw new TypeError('Reviewer capability scenario scorer evidence sources are invalid.');
    }
    const boundExpected = /** @type {ExpectedFixture} */ (cloneJsonValue(expected));
    const bodyLineEvidence = reviewerId === 'spec-readiness-reviewer';
    const normalizeEvidence = (/** @type {unknown[]} */ evidence) => {
        try {
            return normalizeBodyEvidence(evidence.map(locator => {
                if (!isJsonObject(locator) || typeof locator.filePath !== 'string'
                    || typeof locator.line !== 'number' || Object.keys(locator).sort(compareText).join(',') !== 'filePath,line') {
                    throw new ReviewerCapabilityEvidenceError('Spec Readiness evidence must contain body line locations.');
                }
                return {filePath: locator.filePath, lineStart: locator.line, lineEnd: locator.line};
            }), sources);
        } catch (error) {
            if (error instanceof ReviewerCapabilityEvidenceError) throw error;
            throw new ReviewerCapabilityEvidenceError('Spec Readiness evidence does not identify valid request body lines.', {cause: error});
        }
    };
    const normalizedExpected = bodyLineEvidence ? /** @type {ExpectedFixture} */ ({...boundExpected, scopes: boundExpected.scopes.map(scope => ({
        ...scope,
        problemCases: scope.problemCases.map(problemCase => ({
            ...problemCase,
            placements: problemPlacements({problemCase, scope: scope.scope}).map(placement => {
                const associationEvidence = normalizeEvidence(placement.associationEvidence);
                const evidence = normalizeEvidence(placement.evidence);
                if (associationEvidence.length === 0 || evidence.length === 0) throw new ReviewerCapabilityEvidenceError('Expected evidence has no body lines.');
                return {...placement, associationEvidence, evidence};
            }),
        })),
        cleanCases: scope.cleanCases.map(cleanCase => {
            if (cleanCase.noOtherSupportedFinding === true) return cleanCase;
            const [evidence, ...evidenceAlternatives] = cleanEvidenceSets(cleanCase).map(normalizeEvidence);
            if (evidence === undefined || evidence.length === 0 || evidenceAlternatives.some(alternative => alternative.length === 0)) {
                throw new ReviewerCapabilityEvidenceError('Expected clean evidence has no body lines.');
            }
            return {...cleanCase, evidence, evidenceAlternatives};
        }),
    }))}) : boundExpected;
    const evidenceMatcher = createReviewerCapabilityEvidenceMatcher({evidenceSources: sources, scenarioRoot});

    return (/** @type {{adjudicationDecisions?: Map<string, string>, checks: JsonObject[], cleanObservations?: CleanObservation[], cleanObservationScores?: Map<string, Map<number, number>>}} */ {
        adjudicationDecisions = new Map(),
        checks,
        cleanObservations = [],
        cleanObservationScores = new Map(),
    }) => {
        if (!(adjudicationDecisions instanceof Map)
            || !Array.isArray(checks)
            || !Array.isArray(cleanObservations)
            || !(cleanObservationScores instanceof Map)) {
            throw new TypeError('Reviewer capability scenario score input is invalid.');
        }
        if ([...adjudicationDecisions.values()].some(decision => decision !== 'matched' && decision !== 'not-matched')
            || checks.some(check => !isJsonObject(check)
                || typeof check.check !== 'string'
                || typeof check.result !== 'string'
                || (check.findings !== undefined && (!Array.isArray(check.findings) || check.findings.some(finding => (
                    !isJsonObject(finding)
                    || !Array.isArray(finding.evidence)
                    || typeof finding.finding !== 'string'
                    || typeof finding.result !== 'string'
                )))))
            || cleanObservations.some(observation => !isJsonObject(observation)
                || !Array.isArray(observation.actualEvidence)
                || typeof observation.cleanCaseIndex !== 'number'
                || !Number.isSafeInteger(observation.cleanCaseIndex)
                || observation.cleanCaseIndex < 0
                || typeof observation.satisfied !== 'boolean'
                || typeof observation.scope !== 'string'
                || (observation.requirementSource !== undefined && typeof observation.requirementSource !== 'string'))
            || (cleanObservations.length > 0 && cleanObservationScores.size > 0)
            || [...cleanObservationScores.values()].some(scores => !(scores instanceof Map)
                || [...scores.values()].some(value => typeof value !== 'number' || !Number.isFinite(value)))) {
            throw new TypeError('Reviewer capability scenario score values are invalid.');
        }
        const boundChecks = /** @type {JsonObject[]} */ (cloneJsonValue(checks));
        const normalizedChecks = /** @type {JsonObject[]} */ (bodyLineEvidence ? boundChecks.map(check => ({...check, ...(Array.isArray(check.findings) ? {
            findings: check.findings.map(finding => {
                if (!isJsonObject(finding) || !Array.isArray(finding.evidence)) throw new TypeError('Invalid finding.');
                const valid = [];
                const invalid = [];
                for (const locator of finding.evidence) {
                    try {
                        const normalized = normalizeEvidence([locator]);
                        if (normalized.length === 0) invalid.push(locator);
                        else valid.push(...normalized);
                    }
                    catch (error) {
                        if (!(error instanceof ReviewerCapabilityEvidenceError)) throw error;
                        invalid.push(locator);
                    }
                }
                const evidence = [...normalizeEvidence(valid), ...invalid];
                return {...finding, evidence};
            }),
        } : {})})) : boundChecks);
        return scoreExpectedScopes({
            adjudicationDecisions,
            checks: normalizedChecks.map(check => ({
                check: /** @type {string} */ (check.check),
                findings: Array.isArray(check.findings) ? check.findings.map(finding => /** @type {Finding} */ (finding)) : [],
                result: /** @type {string} */ (check.result),
            })),
            cleanObservationScores: cleanObservations.length === 0 ? cleanObservationScores : scoreCleanObservations({
                cleanObservations: /** @type {CleanObservation[]} */ (cleanObservations),
                evidenceMatcher,
                expected: normalizedExpected,
            }),
            evidenceMatcher,
            expected: normalizedExpected,
            instanceId,
            reviewerId,
        });
    };
};
