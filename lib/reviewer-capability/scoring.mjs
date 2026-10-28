import {cloneJsonValue, compareText, isJsonObject} from '../common/json.mjs';
import {createReviewerCapabilityEvidenceMatcher, lineCounts as baseLineCounts, normalizeBodyEvidence, normalizeReviewerCapabilityPath} from './evidence.mjs';

/** @typedef {Record<string, unknown>} JsonObject */
/** @typedef {{anchor?: string, filePath: string, line?: number}} FixtureLocator */
/** @typedef {{associationEvidence: FixtureLocator[], check: string, evidence: FixtureLocator[]}} FixturePlacement */
/** @typedef {{associationEvidence?: FixtureLocator[], evidence?: FixtureLocator[], evidenceAlternatives?: FixtureLocator[][], expectation?: string, findingTerms?: Array<string | string[]>, judgment?: boolean, judgmentShare?: number, k?: number, merge?: string, noOtherSupportedFinding?: boolean, placements?: FixturePlacement[], requirementSource?: string, result?: string}} FixtureCase */
/** @typedef {{cleanCases: FixtureCase[], problemCases: FixtureCase[], scope: string}} FixtureScope */
/** @typedef {{cleanCount: number, problemCount: number, scopes: FixtureScope[]}} ExpectedFixture */
/** @typedef {{check: string, findings?: Finding[], result: string}} ReviewCheck */
/** @typedef {{evidence: unknown[], finding: string, requirementSource?: string, result: string}} Finding */
/** @typedef {{check: string, finding: Finding, findingIndex: number}} ActualFinding */
/** @typedef {{problemCase: FixtureCase, problemCaseIndex: number, scope: string, scopeIndex: number}} ProblemCaseEntry */
/** @typedef {{basePoints: number, caseIndex: number, evidenceScore: number, findingIndex: number}} FindingAssociation */
/** @typedef {ReturnType<typeof createReviewerCapabilityEvidenceMatcher>} EvidenceMatcher */
/** @typedef {{actualEvidence: unknown[], cleanCaseIndex: number, requirementSource?: string, satisfied: boolean, scope: string}} CleanObservation */
/** @typedef {{referenceTerms: unknown[], candidateId: string, check: string, evidence: unknown[], expectation: string, finding: string, findingIndex: number, instanceId: string, problemCaseIndex: number, problemScope: string, result: string, reviewerId: string}} TextCandidate */


const groupBy = (/** @type {any[]} */ list, /** @type {(entry: any, index: number) => unknown} */ key) => {
    /** @type {Map<unknown, any[]>} */
    const groups = new Map();
    list.forEach((entry, index) => groups.set(key(entry, index), [...groups.get(key(entry, index)) ?? [], entry]));
    return groups;
};

// k of a case and its share; r8: 0.25 by default, 1 or 4 when the answer key marks it.
export const caseK = (/** @type {{judgment?: boolean, k?: number}} */ fixtureCase) => fixtureCase.k ?? (fixtureCase.judgment === true ? 1 : 0.25);
const caseShare = (/** @type {{judgmentShare?: number}} */ fixtureCase) => fixtureCase.judgmentShare ?? 1;
// Each tier with k >= 1 holds k problem cases per clean case, so reporting everything or nothing scores 0 on it.
export const unbalancedKTiers = (/** @type {Record<string, {clean: number, problem: number}>} */ tiers) => Object.entries(tiers)
    .filter(([k, {clean, problem}]) => Math.abs(problem - Number(k) * clean) > 1e-9).map(([k]) => k);
// r8.4: N >= 0 scores N / problem weight (capped at 1); N < 0 scores N / kCleanWeight.
export const kScore = (/** @type {{kCleanWeight: number, kEarnedProblemPoints: number, kFailedCleanWeight: number, kProblemWeight: number}} */ counts) => {
    if (!(counts.kProblemWeight > 0)) throw new Error('Reviewer capability score needs problem cases.');
    const net = counts.kEarnedProblemPoints - counts.kFailedCleanWeight;
    const rawScore = net / counts.kProblemWeight;
    if (net >= 0) return {rawScore, score: Math.min(1, rawScore)};
    if (!(counts.kCleanWeight > 0)) throw new Error('Reviewer capability score needs clean cases.');
    return {rawScore, score: net / counts.kCleanWeight};
};

// A deduction d takes d of the score's size, so it lowers a negative score as well.
export const deductScore = (/** @type {number} */ score, /** @type {number} */ deduction) => (score >= 0 ? score * (1 - deduction) : score * (1 + deduction));
export const ARW_CUT = 0.1;
// The two fixed behaviours of the frozen scorer, kept as named constants: a model failure fails no clean case (score 0, not -1);
// continuing a Spec Readiness review past a requirement-scope problem fails one clean case.
const MODEL_FAILURE_FAILS_CLEAN_CASES = false;
export const SCOPE_CONTINUATION_FAILS_CLEAN_CASE = true;

// How the project treats each report diagnostic: `format` is a whole-report error (format penalty), `record` is only recorded,
// `case` costs points inside its case; any other code is `cut` and takes the residual cut ARW_CUT.
const REPORT_DIAGNOSTIC_TREATMENT = new Map(/** @type {Array<[string, string]>} */ ([
    ['review-format-invalid', 'format'], ['review-json-invalid', 'format'], ['review-utf8-invalid', 'format'], ['review-row-unattributed', 'format'],
    ['review-evidence-overrun', 'record'],
    ...['review-evidence-invalid', 'evidence-locator-invalid', 'review-row-invalid', 'requirement-row-invalid', 'requirement-missing',
        'requirement-coverage-invalid', 'requirement-duplicate', 'requirement-conflicting', 'requirement-source-unexpected', 'requirement-source-invalid',
        'requirement-scope-continuation'].map(code => [code, 'case'])]));
const diagnosticTreatment = (/** @type {{code: string}} */ item) => REPORT_DIAGNOSTIC_TREATMENT.get(item.code) ?? 'cut';
const unrepairableFormatErrorCount = (/** @type {Array<{code: string}>} */ diagnostics) => diagnostics.filter(item => diagnosticTreatment(item) === 'format').length;
export const hasCutDiagnostic = (/** @type {Array<{code: string}>} */ diagnostics) => diagnostics.some(item => diagnosticTreatment(item) === 'cut');

const K_COUNT_KEYS = ['kCleanWeight', 'kEarnedProblemPoints', 'kFailedCleanWeight', 'kProblemWeight'];
const SUM_KEYS = ['earnedCleanPoints', 'earnedProblemPoints', 'fullProblemCases', 'passedCleanCases', 'totalCleanCases', 'totalProblemCases', 'extraFailedCleanCases',
    'kMergedCases', 'missingChecks', 'neutralCleanCases', 'locatorCount', 'overrunLocators', 'semanticProblemHits', 'unrepairableFormatErrors', ...K_COUNT_KEYS];

/** The residual cut and the score fields of a result: `scoreBeforePenalty` is the k score, `score` takes the cut once for a cut diagnostic. */
export const withReportPolicy = (/** @type {any} */ result, /** @type {Array<{code: string}>} */ diagnostics) => {
    const {score: scoreBeforePenalty, ...rest} = result;
    return {...rest, reportDiagnostics: diagnostics, scoreBeforePenalty, score: hasCutDiagnostic(diagnostics) ? deductScore(scoreBeforePenalty, ARW_CUT) : scoreBeforePenalty,
        unrepairableFormatErrors: unrepairableFormatErrorCount(diagnostics)};
};

/** The score of an instance that answered nothing: every problem case is missed, the clean cases pass and are not failed (see MODEL_FAILURE_FAILS_CLEAN_CASES). */
export const zeroCapabilityScore = (/** @type {ExpectedFixture} */ expected) => {
    const cases = expected.scopes.flatMap(scope => [...scope.problemCases.map(fixtureCase => ({fixtureCase, kind: 'problem'})),
        ...scope.cleanCases.map(fixtureCase => ({fixtureCase, kind: 'clean'}))]);
    const units = [...groupBy(cases, (entry, index) => entry.fixtureCase.merge === undefined ? index : `${entry.kind}:${entry.fixtureCase.merge}`).values()].map(group => group[0]);
    /** @type {Record<string, {clean: number, problem: number}>} */
    const kTiers = {};
    for (const {fixtureCase, kind} of units.filter(({fixtureCase}) => caseK(fixtureCase) >= 1)) {
        const key = String(caseK(fixtureCase));
        kTiers[key] = {clean: kTiers[key]?.clean ?? 0, problem: kTiers[key]?.problem ?? 0};
        kTiers[key][/** @type {'clean' | 'problem'} */ (kind)] += caseShare(fixtureCase);
    }
    const kCleanWeight = units.reduce((total, {fixtureCase, kind}) => total + (kind === 'clean' ? caseShare(fixtureCase) * caseK(fixtureCase) : 0), 0);
    const counts = {extraFailedCleanCases: 0, kCleanWeight, kEarnedProblemPoints: 0, kFailedCleanWeight: MODEL_FAILURE_FAILS_CLEAN_CASES ? kCleanWeight : 0,
        kMergedCases: cases.length - units.length, kProblemWeight: units.reduce((total, {fixtureCase, kind}) => total + (kind === 'problem' ? caseShare(fixtureCase) : 0), 0), kTiers};
    return {candidates: [], caseScores: {clean: expected.scopes.map(scope => scope.cleanCases.map(() => 1)), problem: expected.scopes.flatMap(scope => scope.problemCases.map(() => 0))},
        cleanAcceptanceRate: 1, earnedCleanPoints: expected.cleanCount, earnedProblemPoints: 0, fullProblemCases: 0, locatorCount: 0, missingChecks: 0, neutralCleanCases: 0, overrunLocators: 0,
        passedCleanCases: expected.cleanCount, problemDetectionRate: 0,
        scopes: expected.scopes.map(scope => ({scope: scope.scope, earnedCleanPoints: scope.cleanCases.length, earnedProblemPoints: 0, fullProblemCases: 0, passedCleanCases: scope.cleanCases.length,
            totalCleanCases: scope.cleanCases.length, totalProblemCases: scope.problemCases.length})),
        semanticProblemHits: 0, totalCleanCases: expected.cleanCount, totalProblemCases: expected.problemCount, ...counts, ...kScore(counts)};
};

/**
 * Adds the counts of the scored scenarios of one scoring unit (Spec Readiness: both sub-scenarios) and scores the sums again.
 * Every result must carry the k counts: a missing count would score k >= 1 cases at the default k without notice.
 */
export const combineScenarios = (/** @type {any[]} */ results) => {
    if (results.some(result => K_COUNT_KEYS.some(key => !Number.isFinite(result[key])) || !isJsonObject(result.kTiers))) throw new Error('Reviewer capability score has incomplete k counts.');
    const sum = Object.fromEntries(SUM_KEYS.map(key => [key, results.reduce((total, result) => total + (result[key] ?? 0), 0)]));
    /** @type {Record<string, {clean: number, problem: number}>} */
    const kTiers = {};
    for (const result of results) {
        for (const [k, tier] of Object.entries(/** @type {Record<string, {clean: number, problem: number}>} */ (result.kTiers))) {
            kTiers[k] = {clean: (kTiers[k]?.clean ?? 0) + tier.clean, problem: (kTiers[k]?.problem ?? 0) + tier.problem};
        }
    }
    const unbalanced = unbalancedKTiers(kTiers);
    if (unbalanced.length > 0) throw new Error(`Reviewer capability k ${unbalanced.join(', ')} problem and clean cases are unbalanced in one scoring unit.`);
    const counts = /** @type {any} */ ({...sum, kTiers});
    const {kWarning: _unused, ...first} = results[0];
    return {...first, ...counts, candidates: results.flatMap(result => result.candidates ?? []),
        caseScores: {clean: results.flatMap(result => result.caseScores.clean), problem: results.flatMap(result => result.caseScores.problem)},
        cleanAcceptanceRate: sum.earnedCleanPoints / (sum.totalCleanCases + sum.extraFailedCleanCases), problemDetectionRate: sum.earnedProblemPoints / sum.totalProblemCases,
        scopes: results.flatMap(result => result.scopes), ...kScore(counts)};
};

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

// Project scoring upgrade r7: a multi-word term matches only as a contiguous phrase (each word may
// take its variants), not as words scattered anywhere in the finding.
const conceptAlternativeMatches = (/** @type {{finding: string, term: string}} */ {finding, term}) => {
    const actualVariants = textTokens(finding).map(tokenVariants);
    const expectedVariants = textTokens(term).map(tokenVariants);
    if (expectedVariants.length === 0) return false;
    const tokenMatches = (/** @type {Set<string>} */ actual, /** @type {Set<string>} */ expected) => [...actual].some(variant => expected.has(variant));
    return actualVariants.some((_, start) => start + expectedVariants.length <= actualVariants.length
        && expectedVariants.every((expected, offset) => tokenMatches(actualVariants[start + offset], expected)));
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

const f2Score = (/** @type {{coverage: number, precision: number}} */ {coverage, precision}) => fBetaScore({beta: 2, precision, recall: coverage});

const f1Score = (/** @type {{left: number, right: number}} */ {left, right}) => fBetaScore({beta: 1, precision: right, recall: left});

const evidenceF2Score = (/** @type {{actual: unknown[], expected: FixtureLocator[], evidenceMatcher: EvidenceMatcher}} */ {actual, expected, evidenceMatcher}) => f2Score(
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
            ? Math.max(...cleanEvidenceSets(cleanCase).map(expectedEvidence => evidenceF2Score({
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
                // Project scoring upgrade r7: the problem case's findingTerms are shown for adjudication reference only.
                referenceTerms: entry.problemCase.findingTerms ?? [],
                result: actual.finding.result,
                reviewerId,
            });
            if (adjudicationDecisions.get(candidateId) !== 'matched') continue;
            associations.push(scoredAssociation({actual, caseIndex, entry, evidenceMatcher, findingIndex, placements: matchingPlacements}));
        }
    }
    return {associations, candidates};
};

const scoredAssociation = (/** @type {{actual: ActualFinding, caseIndex: number, entry: ProblemCaseEntry, evidenceMatcher: EvidenceMatcher, findingIndex: number, placements: FixturePlacement[]}} */ {
    actual, caseIndex, entry, evidenceMatcher, findingIndex, placements,
}) => {
    const evidenceScore = Math.max(...placements.map(placement => evidenceF2Score({
        actual: findingEvidence(actual.finding),
        expected: placement.evidence,
        evidenceMatcher,
    })));
    return {
        basePoints: (actual.finding?.result === entry.problemCase.result ? 0.4 : 0) + evidenceScore * 0.4,
        caseIndex,
        evidenceScore,
        findingIndex,
    };
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

// Project scoring upgrade r8.1 (user 2026-10-17): a Commit Audit finding belongs to one requirement row. On a row
// the answer key holds satisfied, its clean case is the finding's target whatever the finding's evidence and terms:
// the same wrong judgment already fails that clean case through its observation, so it is charged once.
const rowCleanTargets = (/** @type {{actual: ActualFinding, cleanCases: FixtureCase[]}} */ {actual, cleanCases}) => (
    actual.finding.requirementSource === undefined ? [] : cleanCases.flatMap((cleanCase, cleanCaseIndex) => (
        cleanCase.noOtherSupportedFinding !== true && cleanCase.requirementSource === actual.finding.requirementSource
            ? [cleanCaseIndex] : []))
);

// Project scoring upgrade r7: the evidence and term rule only nominates the ordinary clean cases a finding
// may falsely flag; adjudication confirms it. r8.1: a Commit Audit finding on a satisfied row nominates that row's
// clean case only.
const mechanicalCleanTargets = (/** @type {{actual: ActualFinding, cleanCases: FixtureCase[], evidenceMatcher: EvidenceMatcher}} */ {actual, cleanCases, evidenceMatcher}) => {
    const rowTargets = rowCleanTargets({actual, cleanCases});
    return rowTargets.length > 0 ? rowTargets : cleanCases.flatMap((cleanCase, cleanCaseIndex) => cleanCase.noOtherSupportedFinding !== true
        && (cleanCase.requirementSource === undefined || actual.finding.requirementSource === cleanCase.requirementSource)
        && cleanEvidenceSets(cleanCase).some(expected => evidenceMatcher.containsAllLocators({
            actual: findingEvidence(actual.finding),
            expected,
        }))
        && findingTermsMatch(actual.finding?.finding, cleanCase.findingTerms) ? [cleanCaseIndex] : []);
};

const findingCandidateId = (/** @type {{actual: ActualFinding, instanceId: string, reviewerId: string, scopeIndex: number}} */ {actual, instanceId, reviewerId, scopeIndex}) => [
    reviewerId,
    instanceId,
    `scope-${scopeIndex + 1}`,
    'unassociated',
    actual.check,
    `finding-${actual.findingIndex + 1}`,
].join(':');

// Project scoring upgrade r7 (R1, R3b): every finding left without an association after the association
// candidates are decided becomes a finding candidate. Its decision adds an association to a problem case of
// its scope (`problem-N`), confirms a mechanically nominated false clean (`false-positive:clean-N`), or says
// the finding is unsupported (`unsupported`) or a supported defect outside the answer key (`supported`).
const findFindingDecisions = (/** @type {{actualFindings: ActualFinding[], adjudicationDecisions: Map<string, string>, associationCandidates: TextCandidate[], associations: FindingAssociation[], evidenceMatcher: EvidenceMatcher, expected: ExpectedFixture, instanceId: string, problemCases: ProblemCaseEntry[], reviewerId: string}} */ {
    actualFindings,
    adjudicationDecisions,
    associationCandidates,
    associations,
    evidenceMatcher,
    expected,
    instanceId,
    problemCases,
    reviewerId,
}) => {
    /** @type {FindingAssociation[]} */
    const added = [];
    /** @type {JsonObject[]} */
    const candidates = [];
    /** @type {Map<number, {decision?: string, mechanicalTargets: number[]}>} */
    const outcomes = new Map();
    for (const [findingIndex, actual] of actualFindings.entries()) {
        const scopeIndex = expected.scopes.findIndex(scope => scope.scope === actual.check);
        if (scopeIndex < 0 || associations.some(association => association.findingIndex === findingIndex)) continue;
        const expectedScope = expected.scopes[scopeIndex];
        const mechanicalTargets = mechanicalCleanTargets({actual, cleanCases: expectedScope.cleanCases, evidenceMatcher});
        const pendingAssociation = associationCandidates.some(candidate => candidate.instanceId === instanceId
            && candidate.check === actual.check && candidate.findingIndex === actual.findingIndex
            && !adjudicationDecisions.has(candidate.candidateId));
        if (pendingAssociation) {
            outcomes.set(findingIndex, {mechanicalTargets});
            continue;
        }
        // r8.3: a finding that names its requirement row (Commit Audit) may only be decided onto that row's problem case.
        const problemOptions = problemCases.flatMap((entry, caseIndex) => entry.scopeIndex === scopeIndex
            && problemPlacements(entry).some(placement => placement.check === actual.check)
            && (entry.problemCase.requirementSource === undefined || actual.finding.requirementSource === undefined
                || entry.problemCase.requirementSource === actual.finding.requirementSource) ? [{caseIndex, entry}] : []);
        const candidateId = findingCandidateId({actual, instanceId, reviewerId, scopeIndex});
        const decisions = ['unsupported', 'supported', ...mechanicalTargets.map(index => `false-positive:clean-${index + 1}`),
            ...problemOptions.map(({entry}) => `problem-${entry.problemCaseIndex + 1}`)];
        candidates.push({
            allowedDecisions: decisions,
            candidateId,
            check: actual.check,
            cleanTargets: mechanicalTargets.map(index => ({cleanCaseIndex: index + 1, decision: `false-positive:clean-${index + 1}`,
                expectation: expectedScope.cleanCases[index].expectation ?? ''})),
            evidence: findingEvidence(actual.finding),
            finding: actual.finding.finding,
            findingIndex: actual.findingIndex,
            instanceId,
            kind: 'finding',
            problemOptions: problemOptions.map(({entry}) => ({decision: `problem-${entry.problemCaseIndex + 1}`, expectation: entry.problemCase.expectation})),
            result: actual.finding.result,
            reviewerId,
            scope: expectedScope.scope,
        });
        // A decision outside allowedDecisions is rejected by adjudication validation after this scoring pass.
        const decision = adjudicationDecisions.get(candidateId);
        const problem = problemOptions.find(({entry}) => decision === `problem-${entry.problemCaseIndex + 1}`);
        if (problem !== undefined) {
            added.push(scoredAssociation({actual, caseIndex: problem.caseIndex, entry: problem.entry, evidenceMatcher, findingIndex,
                placements: problemPlacements(problem.entry).filter(placement => placement.check === actual.check)}));
            continue;
        }
        // r8.1: an unsupported finding on a satisfied Commit Audit row takes that row's clean case, not no-other.
        const rowTargets = rowCleanTargets({actual, cleanCases: expectedScope.cleanCases});
        outcomes.set(findingIndex, {decision: decision === 'unsupported' && rowTargets.length > 0
            ? `false-positive:clean-${rowTargets[0] + 1}` : decision, mechanicalTargets});
    }
    return {added, candidates, outcomes};
};

const scoreScopes = (/** @type {{actualFindings: ActualFinding[], cleanObservationScores: Map<string, Map<number, number>>, expected: ExpectedFixture, outcomes: Map<number, {decision?: string, mechanicalTargets: number[]}>, presentChecks: Set<string>, problemCases: ProblemCaseEntry[], problemScores: number[]}} */ {
    actualFindings,
    cleanObservationScores,
    expected,
    outcomes,
    presentChecks,
    problemCases,
    problemScores,
}) => {
    /** @type {number[][]} */
    const clean = [];
    /** @type {number[][]} */
    const falseFindings = [];
    // Project scoring upgrade r8.5: the clean cases of a missing check are neutral.
    /** @type {boolean[][]} */
    const neutral = [];
    let missingChecks = 0;
    let extraFailedCleanCases = 0;
    const scopes = expected.scopes.map(expectedScope => {
        const missing = !presentChecks.has(expectedScope.scope);
        if (missing) missingChecks += 1;
        neutral.push(expectedScope.cleanCases.map(() => missing));
        const scoped = [...outcomes].filter(([index]) => actualFindings[index]?.check === expectedScope.scope).map(([, outcome]) => outcome);
        // A finding without its decision yet is scored by its mechanical result while adjudication is pending, as
        // adjudicated findings are (R3b, once each): its nominated clean cases fail, or, without a nomination, it
        // counts as unsupported.
        const falseTargets = scoped.flatMap(outcome => outcome.decision === undefined ? outcome.mechanicalTargets
            : outcome.decision.startsWith('false-positive:clean-') ? [Number(outcome.decision.slice('false-positive:clean-'.length)) - 1] : []);
        const unsupported = scoped.filter(outcome => outcome.decision === 'unsupported'
            || (outcome.decision === undefined && outcome.mechanicalTargets.length === 0)).length;
        const otherFails = unsupported > 0;
        const noOtherCount = expectedScope.cleanCases.filter(cleanCase => cleanCase.noOtherSupportedFinding === true).length;
        // R3b: each unsupported finding takes one failed clean slot: its confirmed clean case or the no-other
        // case first, then an extra failed clean case (k 0.25).
        const decidedTargets = scoped.flatMap(outcome => outcome.decision?.startsWith('false-positive:clean-') ? [outcome.decision] : []);
        const scopeExtra = decidedTargets.length - new Set(decidedTargets).size + Math.max(0, unsupported - noOtherCount);
        extraFailedCleanCases += scopeExtra;
        const observationScores = cleanObservationScores.get(expectedScope.scope) ?? new Map();
        const falseFindingScores = expectedScope.cleanCases.map((cleanCase, cleanCaseIndex) => (
            cleanCase.noOtherSupportedFinding === true ? !otherFails : !falseTargets.includes(cleanCaseIndex)) ? 1 : 0);
        // Project scoring upgrade r8: a clean case, no-other included, passes only when its check is present.
        const cleanCaseScores = falseFindingScores.map((falseFindingScore, cleanCaseIndex) => {
            if (!presentChecks.has(expectedScope.scope)) return 0;
            const observationScore = observationScores.get(cleanCaseIndex);
            return observationScore === undefined ? falseFindingScore : Math.min(falseFindingScore, observationScore);
        });
        clean.push(cleanCaseScores);
        falseFindings.push(falseFindingScores);
        const ownedScores = problemCases.flatMap((entry, index) => entry.scope === expectedScope.scope
            ? [problemScores[index] ?? 0]
            : []);
        return {
            earnedCleanPoints: cleanCaseScores.reduce((total, points) => total + points, 0),
            earnedProblemPoints: ownedScores.reduce((total, points) => total + points, 0),
            extraFailedCleanCases: scopeExtra,
            fullProblemCases: ownedScores.filter((/** @type {number} */ points) => Math.abs(points - 1) < Number.EPSILON * 8).length,
            passedCleanCases: cleanCaseScores.filter((/** @type {number} */ points) => Math.abs(points - 1) < Number.EPSILON * 8).length,
            scope: expectedScope.scope,
            totalCleanCases: expectedScope.cleanCases.length,
            totalProblemCases: expectedScope.problemCases.length,
        };
    });
    return {clean, extraFailedCleanCases, falseFindings, missingChecks, neutral, scopes};
};

const scoreExpectedScopes = (/** @type {{adjudicationDecisions?: Map<string, string>, checks: ReviewCheck[], cleanObservationScores?: Map<string, Map<number, number>>, evidenceMatcher: EvidenceMatcher, expected: ExpectedFixture, instanceId: string, locatorCount: number, overrunLocators: number, reportedFailedCleanCases: number, reviewerId: string}} */ {
    adjudicationDecisions = new Map(),
    checks,
    cleanObservationScores = new Map(),
    evidenceMatcher,
    expected,
    instanceId,
    locatorCount,
    overrunLocators,
    reportedFailedCleanCases,
    reviewerId,
}) => {
    const actualFindings = flattenActualFindings(checks);
    const problemCases = flattenProblemCases(expected);
    const found = findProblemAssociations({
        actualFindings,
        adjudicationDecisions,
        evidenceMatcher,
        instanceId,
        problemCases,
        reviewerId,
    });
    const findingDecisions = findFindingDecisions({
        actualFindings,
        adjudicationDecisions,
        associationCandidates: found.candidates,
        associations: found.associations,
        evidenceMatcher,
        expected,
        instanceId,
        problemCases,
        reviewerId,
    });
    const associations = [...found.associations, ...findingDecisions.added];
    const candidates = [...found.candidates.map(candidate => ({...candidate, allowedDecisions: ['matched', 'not-matched'], kind: 'association'})),
        ...findingDecisions.candidates];
    const associationsByCase = associationsByIndex({associations, count: problemCases.length, key: 'caseIndex'});
    const associationsByFinding = associationsByIndex({associations, count: actualFindings.length, key: 'findingIndex'});
    const problemScores = scoreProblemCases({associationsByCase, associationsByFinding});
    const scoped = scoreScopes({
        actualFindings,
        cleanObservationScores,
        expected,
        outcomes: findingDecisions.outcomes,
        presentChecks: new Set(checks.map(check => check.check)),
        problemCases,
        problemScores,
    });
    const scopes = scoped.scopes;
    // Project scoring upgrade r7: failed clean cases the caller reports for unsupported content outside the findings.
    scoped.extraFailedCleanCases += reportedFailedCleanCases;
    const earnedProblemPoints = problemScores.reduce((total, points) => total + points, 0);
    const fullProblemCases = problemScores.filter((/** @type {number} */ points) => Math.abs(points - 1) < Number.EPSILON * 8).length;
    const earnedCleanPoints = scopes.reduce((points, scope) => points + scope.earnedCleanPoints, 0);
    const passedCleanCases = scopes.reduce((count, scope) => count + scope.passedCleanCases, 0);
    const problemDetectionRate = earnedProblemPoints / expected.problemCount;
    const cleanAcceptanceRate = earnedCleanPoints / (expected.cleanCount + scoped.extraFailedCleanCases);
    // Project scoring upgrade r8: every case counts at its k (0.25 unless the answer key marks 1 or 4) times its share
    // (1, or the judgmentShare an instance prepared under r7 keeps). A problem case earns its partial score at
    // k 0.25, or 1 when a finding is associated with it at k >= 1 (r7: no evidence threshold). A clean case costs
    // k x (1 - its score) at k 0.25 and k when its score is 0 at k >= 1; a clean case of a missing check scores 0.
    const kOf = caseK;
    const shareOf = caseShare;
    const cleanByCase = expected.scopes.flatMap((scope, scopeIndex) => scope.cleanCases.map((cleanCase, cleanCaseIndex) => ({
        cleanCase, neutral: scoped.neutral[scopeIndex][cleanCaseIndex], points: scoped.clean[scopeIndex][cleanCaseIndex]})));
    // Project scoring upgrade r8.5: a clean case of a missing check neither passes nor fails; it keeps its k in
    // kCleanWeight. A merged case takes the larger failed weight of its two sides (r8.2), so with one side in a missing
    // check it counts as the side that is present (a false positive there still fails it); it is neutral only when both
    // sides are in missing checks.
    /** @type {Record<string, {clean: number, problem: number}>} */
    const kTiers = {};
    const tier = (/** @type {FixtureCase} */ fixtureCase, /** @type {'clean' | 'problem'} */ kind) => {
        if (kOf(fixtureCase) < 1) return;
        const key = String(kOf(fixtureCase));
        kTiers[key] = {clean: kTiers[key]?.clean ?? 0, problem: kTiers[key]?.problem ?? 0};
        kTiers[key][kind] += shareOf(fixtureCase);
    };
    // r8.2: the two cases of a merged case (`merge`) count once, at the lower of their two scores: the smaller earned
    // points of the two problem cases, the larger failed weight of the two clean cases.
    const once = (/** @type {Array<{fixtureCase: FixtureCase, value: number}>} */ entries, /** @type {(values: number[]) => number} */ pick) => (
        [...groupBy(entries, (entry, index) => entry.fixtureCase.merge ?? index).values()]
            .map(group => ({fixtureCase: group[0].fixtureCase, value: pick(group.map(entry => entry.value))})));
    const problemUnits = once(problemCases.map((entry, index) => ({fixtureCase: entry.problemCase,
        value: kOf(entry.problemCase) < 1 ? problemScores[index] : associationsByCase[index].length > 0 ? 1 : 0})), values => Math.min(...values));
    const cleanUnits = once(cleanByCase.map(({cleanCase, neutral, points}) => ({fixtureCase: cleanCase,
        value: neutral ? 0 : kOf(cleanCase) < 1 ? 1 - points : points > 0 ? 0 : 1})), values => Math.max(...values));
    problemUnits.forEach(unit => tier(unit.fixtureCase, 'problem'));
    cleanUnits.forEach(unit => tier(unit.fixtureCase, 'clean'));
    const counts = {
        extraFailedCleanCases: scoped.extraFailedCleanCases,
        // r8.4: the k of every clean case of the key, a merged case once (the denominator of a negative score).
        kCleanWeight: cleanUnits.reduce((total, unit) => total + shareOf(unit.fixtureCase) * kOf(unit.fixtureCase), 0),
        kEarnedProblemPoints: problemUnits.reduce((total, unit) => total + shareOf(unit.fixtureCase) * unit.value, 0),
        kFailedCleanWeight: cleanUnits.reduce((total, unit) => total + shareOf(unit.fixtureCase) * kOf(unit.fixtureCase) * unit.value, 0)
            + 0.25 * scoped.extraFailedCleanCases,
        kMergedCases: problemCases.length - problemUnits.length + cleanByCase.length - cleanUnits.length,
        kProblemWeight: problemUnits.reduce((total, unit) => total + shareOf(unit.fixtureCase), 0),
        kTiers,
    };
    const unbalanced = unbalancedKTiers(kTiers);
    return {
        candidates,
        caseScores: {clean: scoped.clean, problem: problemScores},
        cleanAcceptanceRate,
        earnedCleanPoints,
        earnedProblemPoints,
        fullProblemCases,
        passedCleanCases,
        problemDetectionRate,
        scopes,
        semanticProblemHits: associations.length,
        // Project scoring upgrade r7: locators of the scored report as the scorer reads them (T of the format penalty),
        // and the ranges among them cut back to the end of their file (repairable format errors).
        locatorCount,
        overrunLocators,
        totalCleanCases: expected.cleanCount,
        totalProblemCases: expected.problemCount,
        ...counts,
        // r8.5: answer-key checks absent from the report, and the clean cases they leave neutral.
        missingChecks: scoped.missingChecks,
        neutralCleanCases: [...groupBy(cleanByCase, (entry, index) => entry.cleanCase.merge ?? index).values()]
            .filter(group => group.every(entry => entry.neutral)).length,
        ...kScore(counts),
        // One Spec Readiness scenario alone may hold an unbalanced part of a balanced tier.
        ...(unbalanced.length === 0 ? {} : {kWarning: `k ${unbalanced.join(', ')} problem and clean cases are unbalanced in this instance.`}),
    };
};


class EvidenceError extends Error {}

/**
 * Scores one scenario instance. `bodyLineEvidence` is true for Spec Readiness, whose evidence is body lines of the
 * Request inputs; otherwise a line range that starts inside its file and runs past the end is cut to the last line.
 *
 * @param {{adjudicationDecisions?: Map<string, string>, bodyLineEvidence: boolean, checks: JsonObject[], cleanObservations?: CleanObservation[], evidenceSources: Map<string, string>, expected: ExpectedFixture, instanceId: string, invalidEvidenceCode?: string, reportDiagnostics?: Array<{code: string, message: string}>, reportedFailedCleanCases?: number, reviewerId: string}} input
 */
export const scoreInstance = ({adjudicationDecisions = new Map(), bodyLineEvidence, checks, cleanObservations = [], evidenceSources, expected,
    instanceId, invalidEvidenceCode = 'review-evidence-invalid', reportDiagnostics = [], reportedFailedCleanCases = 0, reviewerId}) => {
    /** @type {Array<{code: string, message: string}>} */
    const diagnostics = [...reportDiagnostics];
    const sources = evidenceSources;
    const boundExpected = /** @type {ExpectedFixture} */ (cloneJsonValue(expected));
    const normalizeEvidence = (/** @type {unknown[]} */ evidence) => {
        try {
            return normalizeBodyEvidence(evidence.map(locator => {
                if (!isJsonObject(locator) || typeof locator.filePath !== 'string'
                    || typeof locator.line !== 'number' || Object.keys(locator).sort(compareText).join(',') !== 'filePath,line') {
                    throw new EvidenceError('Spec Readiness evidence must contain body line locations.');
                }
                return {filePath: locator.filePath, lineStart: locator.line, lineEnd: locator.line};
            }), sources);
        } catch (error) {
            throw new EvidenceError('Spec Readiness evidence does not identify valid request body lines.', {cause: error});
        }
    };
    const normalizedExpected = bodyLineEvidence ? /** @type {ExpectedFixture} */ ({...boundExpected, scopes: boundExpected.scopes.map(scope => ({
        ...scope,
        problemCases: scope.problemCases.map(problemCase => ({
            ...problemCase,
            placements: problemPlacements({problemCase, scope: scope.scope}).map(placement => ({
                ...placement, associationEvidence: normalizeEvidence(placement.associationEvidence), evidence: normalizeEvidence(placement.evidence)})),
        })),
        cleanCases: scope.cleanCases.map(cleanCase => {
            if (cleanCase.noOtherSupportedFinding === true) return cleanCase;
            const [evidence, ...evidenceAlternatives] = cleanEvidenceSets(cleanCase).map(normalizeEvidence);
            return {...cleanCase, evidence, evidenceAlternatives};
        }),
    }))}) : boundExpected;
    const evidenceMatcher = createReviewerCapabilityEvidenceMatcher(sources);
    /** @type {Map<string, number>} */
    const lineCounts = new Map([...baseLineCounts(sources)].map(([filePath, count]) => [normalizeReviewerCapabilityPath(filePath), count]));
    // The line count of the file of a range locator that starts inside it and ends past its last line.
    const rangeOverrunLineCount = (/** @type {unknown} */ locator) => {
        if (!isJsonObject(locator) || Object.keys(locator).sort(compareText).join(',') !== 'filePath,lineEnd,lineStart'
            || typeof locator.filePath !== 'string' || !Number.isSafeInteger(locator.lineStart) || !Number.isSafeInteger(locator.lineEnd)) return undefined;
        const lineCount = lineCounts.get(normalizeReviewerCapabilityPath(locator.filePath));
        const {lineStart, lineEnd} = /** @type {{lineStart: number, lineEnd: number}} */ (locator);
        return lineCount !== undefined && lineStart > 0 && lineStart <= lineCount && lineEnd > lineCount ? lineCount : undefined;
    };
    let overrunLocators = 0;
    const cutOverrun = (/** @type {unknown[]} */ evidence) => bodyLineEvidence ? evidence : evidence.map(locator => {
        const lineCount = rangeOverrunLineCount(locator);
        if (lineCount === undefined) return locator;
        overrunLocators += 1;
        diagnostics.push({code: 'review-evidence-overrun', message: 'A line range runs past the end of its frozen source; it is cut to the last line.'});
        return {.../** @type {JsonObject} */ (locator), lineEnd: lineCount};
    });
    const boundChecks = /** @type {JsonObject[]} */ (cloneJsonValue(checks)).map(check => Array.isArray(check.findings)
        ? {...check, findings: check.findings.map(finding => isJsonObject(finding) && Array.isArray(finding.evidence)
            ? {...finding, evidence: cutOverrun(finding.evidence)} : finding)} : check);
    const boundObservations = /** @type {CleanObservation[]} */ (cleanObservations)
        .map(observation => ({...observation, actualEvidence: cutOverrun(observation.actualEvidence)}));
    const normalizedChecks = /** @type {JsonObject[]} */ (bodyLineEvidence ? boundChecks.map(check => ({...check, ...(Array.isArray(check.findings) ? {
        findings: check.findings.map(finding => {
            const valid = [];
            const invalid = [];
            for (const locator of finding.evidence) {
                try {
                    const normalized = normalizeEvidence([locator]);
                    if (normalized.length === 0) invalid.push(locator);
                    else valid.push(...normalized);
                } catch (error) {
                    if (!(error instanceof EvidenceError)) throw error;
                    invalid.push(locator);
                }
            }
            for (const _ of invalid) diagnostics.push({code: invalidEvidenceCode, message: 'Evidence does not identify valid request body lines.'});
            return {...finding, evidence: [...normalizeEvidence(valid), ...invalid]};
        }),
    } : {})})) : boundChecks);
    if (!bodyLineEvidence) {
        const valid = (/** @type {unknown} */ locator) => {
            if (!isJsonObject(locator) || typeof locator.filePath !== 'string') return false;
            const lineCount = lineCounts.get(normalizeReviewerCapabilityPath(locator.filePath));
            const {line, lineStart, lineEnd} = /** @type {{line: number, lineStart: number, lineEnd: number}} */ (locator);
            const shape = Object.keys(locator).sort(compareText).join(',');
            if (lineCount === undefined) return false;
            if (shape === 'filePath,line') return Number.isSafeInteger(line) && line >= 1 && line <= lineCount;
            return shape === 'filePath,lineEnd,lineStart' && Number.isSafeInteger(lineStart) && Number.isSafeInteger(lineEnd) && lineStart >= 1 && lineStart <= lineEnd && lineEnd <= lineCount;
        };
        for (const evidence of [...normalizedChecks.flatMap(check => Array.isArray(check.findings) ? check.findings : []).map(findingEvidence), ...boundObservations.map(observation => observation.actualEvidence)]) {
            for (const locator of evidence) if (!valid(locator)) diagnostics.push({code: invalidEvidenceCode, message: 'Evidence is not a valid location in the frozen source.'});
        }
    }
    const locatorCount = [...normalizedChecks.flatMap(check => Array.isArray(check.findings) ? check.findings : []).map(findingEvidence),
        ...boundObservations.map(observation => observation.actualEvidence)].reduce((total, evidence) => total + evidence.length, 0);
    const scored = scoreExpectedScopes({
        adjudicationDecisions,
        checks: normalizedChecks.map(check => ({
            check: /** @type {string} */ (check.check),
            findings: Array.isArray(check.findings) ? check.findings.map(finding => /** @type {Finding} */ (finding)) : [],
            result: /** @type {string} */ (check.result),
        })),
        cleanObservationScores: scoreCleanObservations({cleanObservations: boundObservations, evidenceMatcher, expected: normalizedExpected}),
        evidenceMatcher,
        expected: normalizedExpected,
        instanceId,
        locatorCount,
        overrunLocators,
        reportedFailedCleanCases,
        reviewerId,
    });
    return withReportPolicy(scored, diagnostics);
};
