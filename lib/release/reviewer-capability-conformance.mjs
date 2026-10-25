import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {lstat, mkdir, readFile, readdir, realpath, writeFile} from 'node:fs/promises';
import {basename, dirname, isAbsolute, join, resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';

import {createCurrentPlatformAdapter} from '../arw-common/platform-adapter.mjs';
import {parseRegisteredArtifactPath} from '../arw-common/artifacts.mjs';
import {createTemporaryWorkspace} from '../arw-common/temporary-workspace.mjs';
import {serializeCanonicalJson} from '../common/canonical-contract.mjs';
import {joinRelativePath} from '../common/filesystem.mjs';
import {uniqueMinimumCostAssignment} from '../common/minimum-cost-assignment.mjs';
import {reviewerMeasurementRates} from '../reviewer-runtime/reviewer-measurement.mjs';
import {resolveReleaseCandidate} from './release-candidate.mjs';
import {createReviewerCapabilityScenarioScorer} from './reviewer-capability-scoring.mjs';
import {
    normalizeReviewerCapabilityPath as normalizePath,
    reviewerCapabilityEvidenceSetKey as evidenceSetKey,
    reviewerCapabilityLocatorKey as locatorKey,
    reviewerCapabilityRelativePathWithinScope as relativePathWithinScope,
} from './reviewer-capability-evidence.mjs';
import {ALL_REVIEWERS, REVIEWER_IDS} from './reviewer-capability-identities.mjs';
import {reviewerCapabilityVerificationCore} from './reviewer-capability-verification.mjs';
import {isSafeReleaseRelativePath} from './release-step-review-material.mjs';
import {
    prepareSpecReadiness,
    readCompleteSpecReadinessCapabilityDraft,
    readSpecReadinessEvidenceSources,
    SpecReadinessReviewerDraftFormatError,
} from '../spec-readiness/spec-readiness.mjs';
import {parseCommitAuditRecord as parseFormalCommitAuditRecord, prepareCommitAudit, validateCommitAuditReview, validateCommitAuditReviewForCapabilityScoring} from '../commit-audit/commit-audit.mjs';
import {compareText, isJsonObject, sha256} from '../common/json.mjs';

/** @typedef {Record<string, unknown>} JsonObject */
/** @typedef {{anchor?: string, filePath: string, line?: number}} FixtureLocator */
/** @typedef {{associationEvidence: FixtureLocator[], check: string, evidence: FixtureLocator[]}} FixturePlacement */
/** @typedef {{associationEvidence?: FixtureLocator[], evidence?: FixtureLocator[], evidenceAlternatives?: FixtureLocator[][], expectation?: string, findingTerms?: Array<string | string[]>, noOtherSupportedFinding?: boolean, placements?: FixturePlacement[], requirementSource?: string, result?: string}} FixtureCase */
/** @typedef {{cleanCases: FixtureCase[], problemCases: FixtureCase[], scope: string}} FixtureScope */
/** @typedef {{auditRecords?: AuditRecord[], authorizingIssueIds?: string[], cleanCount: number, inputs?: Array<JsonObject & {filePath: string}>, kind?: string, problemCount: number, request?: unknown, requestSha256?: string, reviewerRole?: unknown, scopes: FixtureScope[], subject?: {filePath: string, sha256?: string}, [key: string]: unknown}} ExpectedFixture */
/** @typedef {{exitCode: number, stderr: string | Buffer, stdout: string | Buffer}} CommandResult */
/** @typedef {(file: string, args: readonly string[], options: {cwd: string, encoding?: 'buffer', input?: string | Buffer}) => CommandResult | Promise<CommandResult>} RunCommand */
/** @typedef {{readBatch: (input: {repositoryRoot: string, specifications: string[]}) => Promise<{exitCode: number, stderr: Buffer, stdout: Buffer}>}} CandidateContentGitAdapter */
/** @typedef {{platform: string, sessionId: string}} AgentIdentity */
/** @typedef {{command?: string, draftPath?: string, instanceId: string, requestPath?: string, reviewerId: string, scenarioId?: string, workdir: string}} GenerationEntry */
/** @typedef {{availablePaths: Set<string>, baseFiles: Record<string, string>, candidateFiles: Record<string, string>, expected: ExpectedFixture, generation?: Omit<GenerationEntry, 'instanceId'>, handoffTemplate: string, handoffValues?: Record<string, string>, isolationTemplate: string, resultPath?: string, scenarioId?: string, temporaryFiles?: Record<string, string>}} FixtureDefinition */
/** @typedef {{evidence: FixtureLocator[], identity?: string, result: string, source: FixtureLocator}} AuditRequirement */
/** @typedef {{documents?: string[], pathSuffix: string, requirements: AuditRequirement[], result: string}} AuditRecord */
/** @typedef {{check: string, findings?: Finding[], result: string}} ReviewCheck */
/** @typedef {{evidence: unknown[], finding: string, requirementSource?: string, result: string}} Finding */
/** @typedef {{candidateId: string, check: string, evidence: unknown[], expectation: string, finding: string, findingIndex: number, instanceId: string, problemCaseIndex: number, problemScope: string, result: string, reviewerId: string}} TextCandidate */
/** @typedef {{expected: ExpectedFixture, generation?: Omit<GenerationEntry, 'instanceId'>, handoffTemplate: string, handoffValues?: Record<string, string>, isolationTemplate: string, requestPath?: string, resultPath?: string, scenarioDigest: string, scenarioId?: string, scenarioRoot: string}} ScenarioRuntime */
/** @typedef {{agentIdentity: AgentIdentity, issueId?: string, preparedPath?: string, repositoryRoot: string, reviewerId?: string, runCommand?: RunCommand, selection?: unknown}} PrepareInput */
/** @typedef {{earnedCleanPoints: number, earnedProblemPoints: number, fullProblemCases: number, passedCleanCases: number, scope: string, totalCleanCases: number, totalProblemCases: number}} ScopeScore */
/** @typedef {{clean: number[][], problem: number[], }} CaseScores */
/** @typedef {{candidates: TextCandidate[], caseScores: CaseScores, cleanAcceptanceRate: number, earnedCleanPoints: number, earnedProblemPoints: number, fullProblemCases: number, passedCleanCases: number, problemDetectionRate: number, score: number, scopes: ScopeScore[], semanticProblemHits: number, totalCleanCases: number, totalProblemCases: number}} CapabilityScore */
/** @typedef {{expected: ExpectedFixture, instanceId: string, reportPath: string, requestPath?: string, resultPath?: string, scenarioDigest: string, scenarioId?: string, scenarioRoot: string}} PreparedScenario */
/** @typedef {{instances: PreparedScenario[], platform: string, reviewerId: string, reviewerInstructionsSha256?: string, roleSha256?: string, scenarioRevision: number}} CapabilityContract */
/** @typedef {{contracts: CapabilityContract[], mode: 'release' | 'targeted', platform: string, previousPrepared?: {preparedPath: string, sha256: string}, reviewerIds: string[], runId: string}} PreparedState */
/** @typedef {{originalReportPath: string, correctedReportPath: string}} FormatCorrection */
/** @typedef {ReturnType<typeof import('../reviewer-runtime/reviewer-measurement.mjs').reviewerMeasurementResult>} ReviewerMeasurementResult */
/** @typedef {{artifactPaths: string[] | null, modelFailure?: {reason: string}, formatCorrection?: FormatCorrection, instanceId: string, measurement?: ReviewerMeasurementResult}} ArtifactInstance */
/** @typedef {{instances: ArtifactInstance[], reviewerId: string}} ArtifactEntry */
/** @typedef {{artifact: ArtifactInstance, instanceId: string, repetition: number, reportDiagnostics: ReportDiagnostic[], result: CapabilityScore, reviewerId: string, scenarioId: string}} InstanceScore */
/** @typedef {{finalRepetitionScores: number[], instances: JsonObject[], repetitions: JsonObject[], repetitionScores: number[], reportDiagnostics: ReportDiagnostic[], reviewerId: string, score?: number, scoreBeforePenalty?: number, scoreExplanation: string, scoreGate?: string}} ReviewerScore */
/** @typedef {{code: string, line?: number, field?: string, message: string}} ContentDiagnostic */
/** @typedef {{evidenceSources?: Map<string, string>, records: unknown[], reportDiagnostics: ContentDiagnostic[]}} CapabilityAuditInput */
/** @typedef {{adjudication?: unknown, requirementBindings?: unknown, agentIdentity: AgentIdentity, input: unknown, issueId?: string, preparedPath?: string, repositoryRoot: string, runCommand?: RunCommand}} VerifyInput */
/** @typedef {{code: string, field?: string, instanceId: string, line?: number, message: string, path?: string, reviewerId: string}} ReportDiagnostic */
/** @typedef {{instanceId: string, input: {role: string, identity: {kind: 'isolated', instanceId: string}, instructions: string, handoff: string, cwd: string, writePaths: string[], reportPath: string, stateDirectory: string}, reviewerId: string, scenarioId?: string, scenarioRoot: string}} ReviewerHandoff */

/** @template T @returns {value is T} */
const isDefined = (/** @type {T | undefined} */ value) => value !== undefined;

const CAPABILITY_INSTANCE_COUNT = 3;
const ROOT_AGENT_INSTRUCTIONS_PATH = 'AGENTS.md';
const REVIEWER_INSTRUCTIONS_PATH = 'docs/agents/reviewer.md';
const AGENT_WRITES_INSTRUCTIONS_PATH = 'docs/agents/agent-writes.md';
const DOMAIN_INSTRUCTIONS_PATH = 'docs/agents/domain.md';
const ENVIRONMENT_INSTRUCTIONS_PATH = 'docs/agents/environment.md';
const VALIDATION_INSTRUCTIONS_PATH = 'docs/agents/validation.md';
const ISSUE_TRACKER_INSTRUCTIONS_PATH = 'docs/agents/issue-tracker.md';
const WRITING_INSTRUCTIONS_PATH = 'docs/agents/writing.md';
const ARW_OPERATIONS_INSTRUCTIONS_PATH = 'docs/agents/arw-operations.md';
const COMMIT_AUDIT_GATE_2_REQUIREMENTS_PATH = 'docs/agents/roles/commit-audit-reviewer/gate-2.md';
const REVIEWER_AGENT_INSTRUCTION_PATHS = new Map([
    ['code-spec-reviewer', [
        ROOT_AGENT_INSTRUCTIONS_PATH,
        REVIEWER_INSTRUCTIONS_PATH,
        AGENT_WRITES_INSTRUCTIONS_PATH,
        DOMAIN_INSTRUCTIONS_PATH,
        ENVIRONMENT_INSTRUCTIONS_PATH,
        ISSUE_TRACKER_INSTRUCTIONS_PATH,
        WRITING_INSTRUCTIONS_PATH,
    ]],
    ['code-standards-reviewer', [
        ROOT_AGENT_INSTRUCTIONS_PATH,
        REVIEWER_INSTRUCTIONS_PATH,
        AGENT_WRITES_INSTRUCTIONS_PATH,
        DOMAIN_INSTRUCTIONS_PATH,
        ENVIRONMENT_INSTRUCTIONS_PATH,
        WRITING_INSTRUCTIONS_PATH,
    ]],
    ['commit-audit-reviewer', [
        ROOT_AGENT_INSTRUCTIONS_PATH,
        REVIEWER_INSTRUCTIONS_PATH,
        AGENT_WRITES_INSTRUCTIONS_PATH,
        DOMAIN_INSTRUCTIONS_PATH,
        ENVIRONMENT_INSTRUCTIONS_PATH,
        ISSUE_TRACKER_INSTRUCTIONS_PATH,
        VALIDATION_INSTRUCTIONS_PATH,
        WRITING_INSTRUCTIONS_PATH,
        ARW_OPERATIONS_INSTRUCTIONS_PATH,
        COMMIT_AUDIT_GATE_2_REQUIREMENTS_PATH,
    ]],
    ['spec-readiness-reviewer', [
        ROOT_AGENT_INSTRUCTIONS_PATH,
        REVIEWER_INSTRUCTIONS_PATH,
        AGENT_WRITES_INSTRUCTIONS_PATH,
        DOMAIN_INSTRUCTIONS_PATH,
        ENVIRONMENT_INSTRUCTIONS_PATH,
        ISSUE_TRACKER_INSTRUCTIONS_PATH,
        WRITING_INSTRUCTIONS_PATH,
        'docs/agents/roles/spec-readiness-reviewer/findings.md',
        'docs/agents/roles/spec-readiness-reviewer/module-design.md',
    ]],
]);
const COMMON_INAPPLICABLE_INSTRUCTION_PATHS = [
    'docs/agents/subagent-allocation.md',
    'docs/agents/issue-gate.md',
    'docs/agents/spec-readiness.md',
    'docs/agents/subagent-findings.md',
    'docs/agents/rule-and-design-changes.md',
    'docs/agents/commits.md',
    'docs/agents/upstream-sync.md',
    'docs/agents/platform-standards.md',
    'docs/agents/test-value-cleanup.md',
];
const INAPPLICABLE_AGENT_INSTRUCTION_PATHS = new Map([
    ['code-spec-reviewer', [...COMMON_INAPPLICABLE_INSTRUCTION_PATHS,
        VALIDATION_INSTRUCTIONS_PATH, ARW_OPERATIONS_INSTRUCTIONS_PATH]],
    ['code-standards-reviewer', [...COMMON_INAPPLICABLE_INSTRUCTION_PATHS,
        ISSUE_TRACKER_INSTRUCTIONS_PATH, VALIDATION_INSTRUCTIONS_PATH, ARW_OPERATIONS_INSTRUCTIONS_PATH]],
    ['commit-audit-reviewer', COMMON_INAPPLICABLE_INSTRUCTION_PATHS],
    ['spec-readiness-reviewer', [...COMMON_INAPPLICABLE_INSTRUCTION_PATHS,
        VALIDATION_INSTRUCTIONS_PATH, ARW_OPERATIONS_INSTRUCTIONS_PATH,
        'docs/agents/roles/spec-readiness-reviewer/challenges.md']],
]);
const inapplicableInstructionPaths = (/** @type {string} */ reviewerId) => {
    const paths = INAPPLICABLE_AGENT_INSTRUCTION_PATHS.get(reviewerId);
    if (paths === undefined) throw new Error(`Unknown Reviewer instruction exclusions: ${reviewerId}.`);
    return paths.map(path => `\`${path}\``).join(', ');
};
const validateScenarioInstructionReferences = (/** @type {{roleInstructions: string, rootInstructions: string, reviewerId: string}} */ {roleInstructions, rootInstructions, reviewerId}) => {
    const included = REVIEWER_AGENT_INSTRUCTION_PATHS.get(reviewerId);
    const ignored = INAPPLICABLE_AGENT_INSTRUCTION_PATHS.get(reviewerId);
    if (included === undefined || ignored === undefined) throw new Error(`Unknown Reviewer instruction classification: ${reviewerId}.`);
    if (ignored.some(path => included.includes(path))) throw new Error(`${reviewerId} instruction is both available and excluded.`);
    const classified = new Set([...included, ...ignored]);
    const references = [...`${rootInstructions}\n${roleInstructions}`.matchAll(/docs\/agents\/[A-Za-z0-9/_-]+\.md/gu)].map(match => match[0]);
    const missing = references.filter(path => !classified.has(path));
    if (missing.length > 0) throw new Error(`${reviewerId} scenario has unclassified Agent instruction references: ${[...new Set(missing)].join(', ')}.`);
};
const SHARED_TRIGGER_PATHS = new Set([
    'docs/agents/validation.md',
    'docs/agents/platform-standards.md',
    'lib/common/canonical-contract.mjs',
    'lib/common/evidence-locators.mjs',
    'lib/release/reviewer-capability-conformance.mjs',
    'lib/release/reviewer-capability-evidence.mjs',
    'lib/release/reviewer-capability-identities.mjs',
    'lib/release/reviewer-capability-scoring.mjs',
    'lib/release/reviewer-capability-verification.mjs',
    'scripts/reviewer-capability-conformance.mjs',
    'tests/fixtures/reviewer-capability/common-handoff.md',
]);
const PREPARED_STATE_FILE = 'prepared.json';
const COMMON_HANDOFF_TEMPLATE_FILE = 'common-handoff.md';
const HANDOFF_TEMPLATE_FILE = 'handoff.md';
const FIXTURE_DIRECTORY_SEGMENTS = ['tests', 'fixtures', 'reviewer-capability'];
const MINIMUM_CASE_COUNT = 20;
const SCENARIO_SEGMENTS = new Map([
    ['code-spec-reviewer', 'csp'],
    ['code-standards-reviewer', 'cst'],
    ['commit-audit-reviewer', 'ca'],
    ['spec-readiness-reviewer', 'sr'],
]);
const SCENARIO_REVISIONS = new Map([
    ['code-spec-reviewer', 11],
    ['code-standards-reviewer', 14],
    ['commit-audit-reviewer', 19],
    ['spec-readiness-reviewer', 40],
]);
const SPEC_READINESS_SCENARIOS = [
    {fixtureVariant: 'requirements', scenarioId: 'runtime-migration', segments: ['sr', 'runtime-migration']},
    {fixtureVariant: 'full-review', scenarioId: 'artifact-promotion', segments: ['sr', 'artifact-promotion']},
];
const capabilityInstancePosition = (/** @type {string} */ reviewerId, /** @type {number} */ index) => {
    const scenarioCount = reviewerId === 'spec-readiness-reviewer' ? SPEC_READINESS_SCENARIOS.length : 1;
    return {
        repetition: Math.floor(index / scenarioCount) + 1,
        scenarioIndex: index % scenarioCount,
    };
};
const SPEC_READINESS_SCOPES = [
    'SPEC-READINESS-INPUTS',
    'SPEC-READINESS-REQUIREMENTS',
    'SPEC-READINESS-RATIONALE',
    'SPEC-READINESS-ADR-EVALUATION',
    'MODULE-DESIGN-APPLICABILITY',
    'MODULE-DESIGN-EXEMPTION',
    'MODULE-DESIGN-MODULES',
    'MODULE-DESIGN-INTERFACES',
    'MODULE-DESIGN-SEAMS-ADAPTERS',
    'MODULE-DESIGN-DEPENDENCIES-DATA-FLOW',
    'MODULE-DESIGN-RATIONALE',
];
const SPEC_READINESS_SUBJECT_EVIDENCE_SCOPES = new Set([
    'SPEC-READINESS-INPUTS',
    'SPEC-READINESS-REQUIREMENTS',
]);
const FULL_REVIEW_SELECTED_SPECS = new Set([
    'specs/diagnostic-wording.md',
    'specs/validation-report.md',
    'specs/reader-index.md',
    'specs/cache-indexing.md',
    'specs/parser-scan.md',
    'specs/access-review.md',
    'specs/result-summary.md',
    'specs/promotion-runtime.md',
    'specs/promotion-recovery.md',
]);
const comparablePath = (/** @type {string} */ value) => process.platform === 'win32' ? value.toLowerCase() : value;
const strictUtf8Decoder = new TextDecoder('utf-8', {fatal: true});
const HANDOFF_PLACEHOLDER = /\{\{([a-z][A-Za-z0-9]*)\}\}/gu;

const fixtureRelativePath = (/** @type {string[]} */ parts) => parts.join('/');

const decodeFixtureText = (/** @type {Uint8Array} */ bytes, /** @type {string} */ path) => {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        throw new Error(`Reviewer capability fixture text must not use a UTF-8 BOM: ${path}.`);
    }
    let source;
    try {
        source = strictUtf8Decoder.decode(bytes);
    } catch {
        throw new Error(`Reviewer capability fixture text is not valid UTF-8: ${path}.`);
    }
    if (source.includes('\r')) throw new Error(`Reviewer capability fixture text must use LF line endings: ${path}.`);
    return source;
};

const renderHandoffTemplate = (/** @type {{label: string, template: string, values: Record<string, string>}} */ {label, template, values}) => {
    const used = new Set();
    const result = template.replace(HANDOFF_PLACEHOLDER, (placeholder, name) => {
        if (!Object.hasOwn(values, name)) throw new Error(`${label} handoff template contains an unknown placeholder: ${placeholder}.`);
        used.add(name);
        return values[name];
    });
    for (const name of Object.keys(values)) {
        if (!used.has(name)) throw new Error(`${label} handoff template is missing the required placeholder: {{${name}}}.`);
    }
    return result;
};

const readHandoffTemplate = async (/** @type {{label: string, path: string}} */ {label, path}) => {
    const information = await lstat(path);
    if (!information.isFile() || information.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
    const template = decodeFixtureText(await readFile(path), label).trimEnd();
    if (template.length === 0) throw new Error(`${label} must not be empty.`);
    return template;
};

const readFixtureTree = async (/** @type {{directory: string, label: string}} */ {directory, label}) => {
    const rootInformation = await lstat(directory);
    if (!rootInformation.isDirectory() || rootInformation.isSymbolicLink()) {
        throw new Error(`${label} must be a real directory.`);
    }
    /** @type {Record<string, string>} */
    const files = {};
    const visit = async (/** @type {string} */ current, /** @type {string[]} */ segments) => {
        const entries = await readdir(current, {withFileTypes: true});
        entries.sort((left, right) => compareText(left.name, right.name));
        for (const entry of entries) {
            const childSegments = [...segments, entry.name];
            const relativePath = fixtureRelativePath(childSegments);
            if (entry.name.length === 0 || entry.name === '.' || entry.name === '..' || entry.name.includes('\\')) {
                throw new Error(`${label} contains an unsafe path: ${relativePath}.`);
            }
            const absolutePath = join(current, entry.name);
            const information = await lstat(absolutePath);
            if (information.isSymbolicLink()) throw new Error(`${label} contains a linked path: ${relativePath}.`);
            if (information.isDirectory()) {
                await visit(absolutePath, childSegments);
                continue;
            }
            if (!information.isFile()) throw new Error(`${label} contains a non-regular file: ${relativePath}.`);
            files[relativePath] = decodeFixtureText(await readFile(absolutePath), `${label}/${relativePath}`);
        }
    };
    await visit(directory, []);
    if (Object.keys(files).length === 0) throw new Error(`${label} must contain at least one file.`);
    return files;
};

/** @returns {FixtureLocator} */
const canonicalFixtureLocator = (/** @type {{availablePaths: Set<string>, locator: unknown, label: string}} */ {availablePaths, locator, label}) => {
    if (!isJsonObject(locator)) {
        throw new Error(`${label} evidence locator must be one object.`);
    }
    const keys = Object.keys(locator).sort();
    const hasAnchor = typeof locator.anchor === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(locator.anchor);
    const hasLine = typeof locator.line === 'number' && Number.isInteger(locator.line) && locator.line > 0;
    const expectedKeys = hasAnchor ? ['anchor', 'filePath'] : hasLine ? ['filePath', 'line'] : ['filePath'];
    if (keys.join(',') !== expectedKeys.sort().join(',')
        || typeof locator.filePath !== 'string'
        || normalizePath(locator.filePath) !== locator.filePath
        || !availablePaths.has(locator.filePath)) {
        throw new Error(`${label} evidence locator is invalid.`);
    }
    return {
        ...(hasAnchor && typeof locator.anchor === 'string' ? {anchor: locator.anchor} : {}),
        filePath: locator.filePath,
        ...(hasLine && typeof locator.line === 'number' ? {line: locator.line} : {}),
    };
};

/** @returns {Array<string | string[]>} */
const canonicalFindingTerms = (/** @type {{entry: JsonObject, label: string}} */ {entry, label}) => {
    if (!Array.isArray(entry.findingTerms)
        || entry.findingTerms.length === 0
        || entry.findingTerms.some(group => (
            typeof group === 'string'
                ? group.trim().length === 0
                : !Array.isArray(group)
                    || group.length === 0
                    || group.some(term => typeof term !== 'string' || term.trim().length === 0)
        ))) {
        throw new Error(`${label} is malformed.`);
    }
    return entry.findingTerms.map(group => Array.isArray(group)
        ? group.filter((/** @type {unknown} */ term) => typeof term === 'string')
        : typeof group === 'string' ? group : '');
};

const fixtureLocatorsEqual = (/** @type {FixtureLocator} */ left, /** @type {FixtureLocator} */ right) => {
    return left.filePath === right.filePath && left.anchor === right.anchor && left.line === right.line;
};

const canonicalAssociationEvidence = (/** @type {{associationEvidence: unknown, availablePaths: Set<string>, evidence: FixtureLocator[], label: string}} */ {associationEvidence, availablePaths, evidence, label}) => {
    if (!Array.isArray(associationEvidence) || associationEvidence.length === 0) {
        throw new Error(`${label} association evidence must be non-empty.`);
    }
    const canonical = associationEvidence.map(locator => canonicalFixtureLocator({
        availablePaths,
        label,
        locator,
    }));
    if (canonical.some((locator, index) => canonical.slice(0, index).some(
        earlier => fixtureLocatorsEqual(locator, earlier),
    ))) {
        throw new Error(`${label} association evidence contains a duplicate locator.`);
    }
    if (canonical.some(locator => !evidence.some(candidate => fixtureLocatorsEqual(locator, candidate)))) {
        throw new Error(`${label} association evidence must be a subset of evidence.`);
    }
    return canonical;
};

/** @returns {FixtureCase} */
const canonicalFixtureCase = (/** @type {{availablePaths: Set<string>, caseIndex: number, entry: unknown, kind: string, scope: string}} */ {availablePaths, caseIndex, entry, kind, scope}) => {
    const label = `${scope} ${kind} case ${caseIndex + 1}`;
    if (!isJsonObject(entry)) {
        throw new Error(`${label} is malformed.`);
    }
    if (kind === 'clean' && entry.noOtherSupportedFinding === true) {
        if (Object.keys(entry).join(',') !== 'noOtherSupportedFinding') {
            throw new Error(`${label} no-other-supported-finding case is malformed.`);
        }
        return {noOtherSupportedFinding: true};
    }
    const usesPlacements = kind === 'problem' && Object.hasOwn(entry, 'placements');
    const hasEvidenceAlternatives = kind === 'clean' && Object.hasOwn(entry, 'evidenceAlternatives');
    const expectedKeys = kind === 'problem'
        ? usesPlacements
            ? ['expectation', 'findingTerms', 'placements', 'result']
            : ['associationEvidence', 'evidence', 'expectation', 'findingTerms', 'result']
        : hasEvidenceAlternatives
            ? ['evidence', 'evidenceAlternatives', 'expectation', 'findingTerms']
            : ['evidence', 'expectation', 'findingTerms'];
    if (Object.keys(entry).sort().join(',') !== expectedKeys.sort().join(',')
        || typeof entry.expectation !== 'string'
        || entry.expectation.trim().length === 0
        || (!usesPlacements && (!Array.isArray(entry.evidence) || entry.evidence.length === 0))
        || (usesPlacements && (!Array.isArray(entry.placements) || entry.placements.length === 0))
        || (hasEvidenceAlternatives && (
            !Array.isArray(entry.evidenceAlternatives)
            || entry.evidenceAlternatives.length === 0
            || entry.evidenceAlternatives.some(alternative => !Array.isArray(alternative) || alternative.length === 0)
        ))
        || (kind === 'problem' && entry.result !== 'gap' && entry.result !== 'uncertain')) {
        throw new Error(`${label} is malformed.`);
    }
    const rawEvidence = Array.isArray(entry.evidence) ? entry.evidence : [];
    const rawAlternatives = Array.isArray(entry.evidenceAlternatives) ? entry.evidenceAlternatives : [];
    const rawPlacements = Array.isArray(entry.placements) ? entry.placements : [];
    const findingTerms = canonicalFindingTerms({entry, label});
    const evidence = usesPlacements ? undefined : rawEvidence.map((/** @type {unknown} */ locator) => canonicalFixtureLocator({
        availablePaths,
        label,
        locator,
    }));
    const associationEvidence = kind === 'problem' && !usesPlacements
        ? canonicalAssociationEvidence({
            associationEvidence: entry.associationEvidence,
            availablePaths,
            evidence: evidence ?? [],
            label,
        })
        : undefined;
    const evidenceAlternatives = hasEvidenceAlternatives ? rawAlternatives.map((/** @type {unknown} */ alternative) => (
        Array.isArray(alternative) ? alternative.map((/** @type {unknown} */ locator) => canonicalFixtureLocator({
            availablePaths,
            label,
            locator,
        })) : []
    )) : undefined;
    if (evidenceAlternatives !== undefined) {
        const evidenceKeys = [evidence ?? [], ...evidenceAlternatives].map(evidenceSetKey);
        if (new Set(evidenceKeys).size !== evidenceKeys.length) {
            throw new Error(`${label} evidence alternatives contain a duplicate evidence set.`);
        }
    }
    const placements = usesPlacements ? rawPlacements.map((/** @type {unknown} */ placement) => {
        if (!isJsonObject(placement)
            || Object.keys(placement).sort().join(',') !== 'associationEvidence,check,evidence'
            || typeof placement.check !== 'string'
            || placement.check.length === 0
            || !Array.isArray(placement.evidence)
            || placement.evidence.length === 0) {
            throw new Error(`${label} problem case placement is malformed.`);
        }
        const placementEvidence = placement.evidence.map((/** @type {unknown} */ locator) => canonicalFixtureLocator({
            availablePaths,
            label,
            locator,
        }));
        return {
            associationEvidence: canonicalAssociationEvidence({
                associationEvidence: placement.associationEvidence,
                availablePaths,
                evidence: placementEvidence,
                label,
            }),
            check: placement.check,
            evidence: placementEvidence,
        };
    }) : undefined;
    if (placements !== undefined && placements.some((placement, index) => placements.slice(0, index).some(previous => (
        previous.check === placement.check
        && evidenceSetKey(previous.evidence) === evidenceSetKey(placement.evidence)
        && evidenceSetKey(previous.associationEvidence) === evidenceSetKey(placement.associationEvidence)
    )))) {
        throw new Error(`${label} problem case placements contain a duplicate placement.`);
    }
    return {
        ...(associationEvidence === undefined ? {} : {associationEvidence}),
        ...(evidence === undefined ? {} : {evidence}),
        ...(evidenceAlternatives === undefined ? {} : {evidenceAlternatives}),
        expectation: entry.expectation,
        findingTerms,
        ...(placements === undefined ? {} : {placements}),
        ...(kind === 'problem' && typeof entry.result === 'string' ? {result: entry.result} : {}),
    };
};

const canonicalExpectedFixture = (/** @type {{availablePaths: Set<string>, extraKeys?: string[], source: string}} */ {availablePaths, extraKeys = [], source}) => {
    /** @type {unknown} */
    let value;
    try {
        value = JSON.parse(source);
    } catch {
        throw new Error('Reviewer capability expected fixture must be valid JSON.');
    }
    if (!isJsonObject(value)
        || Object.keys(value).sort(compareText).join(',') !== [...extraKeys, 'scopes'].sort(compareText).join(',')
        || !Array.isArray(value.scopes)
        || value.scopes.length === 0) {
        throw new Error('Reviewer capability expected fixture must contain one non-empty scopes array.');
    }
    const scopeIds = new Set();
    const scopes = value.scopes.map((/** @type {unknown} */ scope) => {
        if (!isJsonObject(scope)
            || Object.keys(scope).sort().join(',') !== 'cleanCases,problemCases,scope'
            || typeof scope.scope !== 'string'
            || scope.scope.length === 0
            || scopeIds.has(scope.scope)
            || !Array.isArray(scope.problemCases)
            || !Array.isArray(scope.cleanCases)) {
            throw new Error('Reviewer capability expected scope is malformed or duplicated.');
        }
        const scopeId = scope.scope;
        scopeIds.add(scopeId);
        const problemCases = scope.problemCases.map((entry, caseIndex) => canonicalFixtureCase({
            availablePaths,
            caseIndex,
            entry,
            kind: 'problem',
            scope: scopeId,
        }));
        const cleanCases = scope.cleanCases.map((entry, caseIndex) => canonicalFixtureCase({
            availablePaths,
            caseIndex,
            entry,
            kind: 'clean',
            scope: scopeId,
        }));
        if (cleanCases.filter(entry => entry.noOtherSupportedFinding === true).length !== 1) {
            throw new Error(`${scopeId} must contain exactly one no-other-supported-finding clean case.`);
        }
        return {cleanCases, problemCases, scope: scopeId};
    });
    const problemCount = scopes.reduce((count, scope) => count + scope.problemCases.length, 0);
    const cleanCount = scopes.reduce((count, scope) => count + scope.cleanCases.length, 0);
    if (scopes.some(scope => scope.problemCases.some(problemCase => problemCase.placements?.some(
        placement => !scopeIds.has(placement.check),
    )))) {
        throw new Error('Reviewer capability problem case placement names an unknown check.');
    }
    if (problemCount < MINIMUM_CASE_COUNT || cleanCount < MINIMUM_CASE_COUNT) {
        throw new Error(`Reviewer capability fixture requires at least ${MINIMUM_CASE_COUNT} problem cases and ${MINIMUM_CASE_COUNT} clean cases.`);
    }
    return {
        cleanCount,
        problemCount,
        scopes,
        ...Object.fromEntries(extraKeys.map(key => [key, value[key]])),
    };
};

const expectedWithScopes = (/** @type {FixtureScope[]} */ scopes) => ({
    cleanCount: scopes.reduce((count, scope) => count + scope.cleanCases.length, 0),
    problemCount: scopes.reduce((count, scope) => count + scope.problemCases.length, 0),
    scopes,
});

const scopedProblemCase = (/** @type {{allowedScopes: Set<string>, problemCase: FixtureCase}} */ {allowedScopes, problemCase}) => {
    if (problemCase.placements === undefined) return problemCase;
    const placements = problemCase.placements.filter(placement => allowedScopes.has(placement.check));
    if (placements.length === 0) return undefined;
    if (placements.length > 1) return {...problemCase, placements};
    const [placement] = placements;
    return {
        associationEvidence: placement.associationEvidence,
        evidence: placement.evidence,
        expectation: problemCase.expectation,
        findingTerms: problemCase.findingTerms,
        result: problemCase.result,
    };
};

const problemCaseSpecPaths = (/** @type {FixtureCase} */ problemCase) => {
    const placements = problemCase.placements ?? [problemCase];
    return [...new Set(placements.flatMap(placement => (
        placement.associationEvidence ?? placement.evidence ?? []
    )).map(locator => locator.filePath).filter((/** @type {string} */ filePath) => filePath.startsWith('specs/')))];
};

const problemCaseHasPlacementIn = (/** @type {{allowedScopes: Set<string>, problemCase: FixtureCase}} */ {allowedScopes, problemCase}) => problemCase.placements?.some(
    placement => allowedScopes.has(placement.check),
) === true;

const splitSpecReadinessExpected = (/** @type {ExpectedFixture} */ expected) => {
    const requirementScopeIds = new Set(SPEC_READINESS_SCOPES.slice(0, 2));
    const requirementScopes = expected.scopes.slice(0, 2).map(scope => ({
        cleanCases: scope.cleanCases,
        problemCases: scope.problemCases.map(problemCase => scopedProblemCase({
            allowedScopes: requirementScopeIds,
            problemCase,
        })).filter(isDefined),
        scope: scope.scope,
    }));
    for (const scope of expected.scopes.slice(2)) {
        for (const problemCase of scope.problemCases) {
            if (!problemCaseHasPlacementIn({allowedScopes: requirementScopeIds, problemCase})) continue;
            const scoped = scopedProblemCase({allowedScopes: requirementScopeIds, problemCase});
            if (scoped !== undefined) requirementScopes[1].problemCases.push(scoped);
        }
    }
    const fullReviewScopes = expected.scopes.map(scope => ({
        cleanCases: scope.cleanCases,
        problemCases: requirementScopeIds.has(scope.scope)
            ? []
            : scope.problemCases.filter(problemCase => (
                !problemCaseHasPlacementIn({allowedScopes: requirementScopeIds, problemCase})
                && (() => {
                    const specPaths = problemCaseSpecPaths(problemCase);
                    return specPaths.length === 0 || specPaths.some(path => FULL_REVIEW_SELECTED_SPECS.has(path));
                })()
            )),
        scope: scope.scope,
    }));
    const requirements = expectedWithScopes(requirementScopes);
    const fullReview = expectedWithScopes(fullReviewScopes);
    if (requirements.problemCount + fullReview.problemCount < MINIMUM_CASE_COUNT
        || requirements.cleanCount + fullReview.cleanCount < MINIMUM_CASE_COUNT) {
        throw new Error(`Spec Readiness capability scenarios require at least ${MINIMUM_CASE_COUNT} combined problem cases and ${MINIMUM_CASE_COUNT} combined clean cases.`);
    }
    return {fullReview, requirements};
};
const includedChangedPaths = (/** @type {Record<string, string>} */ candidateFiles) => (
    Object.keys(candidateFiles).sort(compareText).map(path => `\`${path}\``).join(', ')
);
const specReadinessInstructionPaths = () => [
    ...REVIEWER_AGENT_INSTRUCTION_PATHS.get('spec-readiness-reviewer') ?? [],
    reviewerRolePath('spec-readiness-reviewer'),
].map(path => `\`${path}\``).join(', ');

const defaultRunCommand = (/** @type {string} */ file, /** @type {readonly string[]} */ args, /** @type {{cwd: string, encoding?: 'buffer', input?: string | Buffer}} */ {cwd, encoding, input = undefined}) => new Promise(resolvePromise => {
    const binaryOutput = encoding === 'buffer';
    /** @type {Buffer[]} */
    const stdout = [];
    /** @type {Buffer[]} */
    const stderr = [];
    let settled = false;
    const finish = (/** @type {CommandResult} */ result) => {
        if (settled) return;
        settled = true;
        resolvePromise(result);
    };
    let child;
    try {
        child = spawn(file, args, {cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
    } catch (error) {
        finish({exitCode: 1, stderr: error instanceof Error ? error.message : String(error), stdout: binaryOutput ? Buffer.alloc(0) : ''});
        return;
    }
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.once('error', error => finish({
        exitCode: 1,
        stderr: error.message,
        stdout: binaryOutput ? Buffer.alloc(0) : '',
    }));
    child.once('close', code => {
        const output = Buffer.concat(stdout);
        const errors = Buffer.concat(stderr);
        finish({
            exitCode: typeof code === 'number' ? code : 1,
            stderr: binaryOutput ? errors : errors.toString('utf8'),
            stdout: binaryOutput ? output : output.toString('utf8'),
        });
    });
    child.stdin.end(input);
});

const commandOutputText = (/** @type {string | Buffer} */ value) => Buffer.isBuffer(value) ? value.toString('utf8') : value;

const requireGitOutput = async (/** @type {{args: string[], label: string, repositoryRoot: string, runCommand: RunCommand}} */ {args, label, repositoryRoot, runCommand}) => {
    const result = await runCommand('git', args, {cwd: repositoryRoot});
    if (result.exitCode !== 0) {
        const detail = commandOutputText(result.stderr).trim() || commandOutputText(result.stdout).trim() || `exit ${result.exitCode}`;
        throw new Error(`${label} failed: ${detail}`);
    }
    return commandOutputText(result.stdout);
};

const runTextCommand = async (/** @type {RunCommand} */ runCommand, /** @type {string} */ file, /** @type {readonly string[]} */ args, /** @type {{cwd: string, input?: string | Buffer}} */ options) => {
    const result = await runCommand(file, args, options);
    return {
        ...result,
        stderr: commandOutputText(result.stderr),
        stdout: commandOutputText(result.stdout),
    };
};

const scenarioGitRunner = (/** @type {{repositoryRoot: string, runCommand: RunCommand}} */ {repositoryRoot, runCommand}) => ({
    run: async (/** @type {{argv: string[], input?: Buffer | string}} */ {argv, input = undefined}) => {
        try {
            const result = await runCommand('git', argv, {cwd: repositoryRoot, encoding: 'buffer', input});
            return {
                code: result.exitCode,
                failure: null,
                stderr: commandOutputText(result.stderr),
                stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout, 'utf8'),
            };
        } catch {
            return {code: null, failure: /** @type {'process'} */ ('process'), stderr: '', stdout: Buffer.alloc(0)};
        }
    },
});

const readScenarioRepositoryRoots = async (/** @type {{reviewerId: string, runCommand: RunCommand, scenarioRoot: string}} */ {reviewerId, runCommand, scenarioRoot}) => {
    const reported = (await requireGitOutput({
        args: ['rev-parse', '--show-toplevel'],
        label: `${reviewerId} scenario root confirmation`,
        repositoryRoot: scenarioRoot,
        runCommand,
    })).trim();
    if (reported.length === 0) throw new Error(`${reviewerId} scenario root confirmation returned an empty path.`);
    const expectedRoot = await realpath(scenarioRoot);
    const reportedRoot = await realpath(reported);
    if (comparablePath(expectedRoot) !== comparablePath(reportedRoot)) {
        throw new Error(`${reviewerId} scenario Repository root does not match its prepared directory.`);
    }
};

const reviewerRolePath = (/** @type {string} */ reviewerId) => joinRelativePath('docs/agents/roles', `${reviewerId}.md`);

export const createCandidateContentGitAdapter = (/** @type {RunCommand} */ runCommand) => ({
    readBatch: async (/** @type {{repositoryRoot: string, specifications: string[]}} */ {repositoryRoot, specifications}) => {
        const result = await runCommand('git', ['cat-file', '--batch'], {
            cwd: repositoryRoot,
            encoding: 'buffer',
            input: `${specifications.join('\n')}\n`,
        });
        return {
            exitCode: result.exitCode,
            stderr: Buffer.isBuffer(result.stderr) ? Buffer.from(result.stderr) : Buffer.from(result.stderr, 'utf8'),
            stdout: Buffer.isBuffer(result.stdout) ? Buffer.from(result.stdout) : Buffer.from(result.stdout, 'utf8'),
        };
    },
});

const readGitEvidenceBatch = async (/** @type {{candidateContentGit: CandidateContentGitAdapter, repositoryRoot: string, requests: Array<{filePath: string, label: string}>, specifications: string[]}} */ {candidateContentGit, repositoryRoot, requests, specifications}) => {
    let result;
    try {
        result = await candidateContentGit.readBatch({repositoryRoot, specifications});
    } catch (error) {
        const detail = error instanceof Error && error.message.length > 0 ? `: ${error.message}` : '';
        return {
            code: /** @type {'candidate-content-git-failed'} */ ('candidate-content-git-failed'),
            message: `candidate Git batch read failed${detail}`,
            status: /** @type {'failed'} */ ('failed'),
        };
    }
    if (!Number.isInteger(result.exitCode) || result.exitCode !== 0) {
        const detail = result.stderr.toString('utf8').trim() || result.stdout.toString('utf8').trim() || `exit ${result.exitCode}`;
        return {
            code: /** @type {'candidate-content-git-failed'} */ ('candidate-content-git-failed'),
            message: `candidate Git batch read failed: ${detail}`,
            status: /** @type {'failed'} */ ('failed'),
        };
    }
    const parsedEntries = [];
    let offset = 0;
    for (let index = 0; index < requests.length; index += 1) {
        const entry = requests[index];
        const specification = specifications[index];
        if (entry === undefined || specification === undefined) {
            return {
                code: /** @type {'candidate-content-invalid'} */ ('candidate-content-invalid'),
                message: 'Candidate Git batch request is incomplete.',
                status: /** @type {'failed'} */ ('failed'),
            };
        }
        const headerEnd = /** @type {number} */ (result.stdout.indexOf(0x0a, offset));
        if (headerEnd < 0) return {
            code: /** @type {'candidate-content-invalid'} */ ('candidate-content-invalid'),
            filePath: entry.filePath,
            message: `${entry.label} failed: candidate Git batch response is truncated.`,
            status: /** @type {'failed'} */ ('failed'),
        };
        const header = result.stdout.subarray(offset, headerEnd).toString('utf8');
        if (header === `${specification} missing`) return {
            code: /** @type {'candidate-content-missing'} */ ('candidate-content-missing'),
            filePath: entry.filePath,
            message: `${entry.label} failed: candidate content is missing.`,
            status: /** @type {'failed'} */ ('failed'),
        };
        const match = /^([0-9a-f]{40}|[0-9a-f]{64}) blob ([0-9]+)$/u.exec(header);
        if (match === null) return {
            code: /** @type {'candidate-content-invalid'} */ ('candidate-content-invalid'),
            filePath: entry.filePath,
            message: `${entry.label} failed: candidate Git batch response is invalid.`,
            status: /** @type {'failed'} */ ('failed'),
        };
        const size = Number(match[2]);
        const contentStart = /** @type {number} */ (headerEnd + 1);
        const contentEnd = contentStart + size;
        if (!Number.isSafeInteger(size) || size < 0 || contentEnd >= result.stdout.length || result.stdout[contentEnd] !== 0x0a) {
            return {
                code: /** @type {'candidate-content-invalid'} */ ('candidate-content-invalid'),
                filePath: entry.filePath,
                message: `${entry.label} failed: candidate Git batch response is truncated.`,
                status: /** @type {'failed'} */ ('failed'),
            };
        }
        parsedEntries.push({
            bytes: Buffer.from(result.stdout.subarray(contentStart, contentEnd)),
            filePath: entry.filePath,
        });
        offset = contentEnd + 1;
    }
    if (offset !== result.stdout.length) return {
        code: /** @type {'candidate-content-invalid'} */ ('candidate-content-invalid'),
        message: 'Candidate Git batch response contains unexpected trailing bytes.',
        status: /** @type {'failed'} */ ('failed'),
    };
    return {entries: parsedEntries, status: /** @type {'succeeded'} */ ('succeeded')};
};

export const createCandidateFilesReader = (/** @type {unknown} */ dependencies) => {
    if (!isJsonObject(dependencies)
        || JSON.stringify(Object.keys(dependencies).sort()) !== JSON.stringify(['candidateContentGit'])
        || !isJsonObject(dependencies.candidateContentGit)
        || typeof dependencies.candidateContentGit.readBatch !== 'function') {
        throw new TypeError('Candidate content reader requires one Git Adapter.');
    }
    const candidateContentGit = /** @type {CandidateContentGitAdapter} */ (dependencies.candidateContentGit);
    return async (/** @type {unknown} */ input) => {
        if (!isJsonObject(input)
            || JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(['candidateTree', 'files', 'repositoryRoot'])
            || typeof input.candidateTree !== 'string'
            || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(input.candidateTree)
            || !Array.isArray(input.files)
            || typeof input.repositoryRoot !== 'string'
            || input.repositoryRoot.length === 0
            || input.files.some(entry => !isJsonObject(entry)
                || JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(['filePath', 'label'])
                || typeof entry.filePath !== 'string'
                || !isSafeReleaseRelativePath(entry.filePath)
                || typeof entry.label !== 'string'
                || entry.label.trim().length === 0
                || entry.label.length > 256)) {
            throw new TypeError('Candidate content reader input is invalid.');
        }
        const {candidateTree, files, repositoryRoot} = /** @type {{candidateTree: string, files: Array<{filePath: string, label: string}>, repositoryRoot: string}} */ (input);
        const requests = [...new Map(files.map(entry => [entry.filePath, entry])).values()];
        if (requests.length === 0) return {entries: [], status: /** @type {'succeeded'} */ ('succeeded')};
        const specifications = requests.map(entry => `${candidateTree}:${entry.filePath}`);
        return readGitEvidenceBatch({candidateContentGit, repositoryRoot, requests, specifications});
    };
};

export const readCandidateFiles = createCandidateFilesReader({
    candidateContentGit: createCandidateContentGitAdapter(defaultRunCommand),
});

const requireCandidateFiles = async (/** @type {{candidateTree: string, files: Array<{filePath: string, label: string}>, repositoryRoot: string, runCommand: RunCommand}} */ {
    candidateTree,
    files,
    repositoryRoot,
    runCommand,
}) => {
    const result = await createCandidateFilesReader({
        candidateContentGit: createCandidateContentGitAdapter(runCommand),
    })({candidateTree, files, repositoryRoot});
    if (result.status === 'failed') throw new Error(result.message);
    return new Map(result.entries.map(entry => [entry.filePath, entry.bytes]));
};

const readAgentInstructionBytes = async (/** @type {{candidateFiles?: Map<string, Buffer>, repositoryRoot: string, reviewerId: string}} */ {candidateFiles, repositoryRoot, reviewerId}) => {
    const instructionPaths = REVIEWER_AGENT_INSTRUCTION_PATHS.get(reviewerId);
    if (instructionPaths === undefined) throw new Error(`Unknown reviewer identity: ${reviewerId}.`);
    const entries = await Promise.all(instructionPaths.map(async (/** @type {string} */ filePath) => {
        const bytes = candidateFiles === undefined
            ? await readFile(join(repositoryRoot, ...filePath.split('/')))
            : candidateFiles.get(filePath);
        if (bytes === undefined) throw new Error(`${reviewerId} candidate Agent instruction ${filePath} is unavailable.`);
        return [filePath, bytes];
    }));
    return Object.fromEntries(entries);
};

const reviewerFromIdentitySpecificPath = (/** @type {string} */ path) => {
    const normalized = normalizePath(path);
    const roleMatch = /^docs\/agents\/roles\/(?<id>[a-z0-9-]+)\.md$/.exec(normalized);
    if (roleMatch?.groups !== undefined && ALL_REVIEWERS.has(roleMatch.groups.id)) return roleMatch.groups.id;
    const handoffMatch = /^tests\/fixtures\/reviewer-capability\/(?<id>[a-z0-9-]+)\/handoff\.md$/.exec(normalized);
    if (handoffMatch?.groups !== undefined && ALL_REVIEWERS.has(handoffMatch.groups.id)) return handoffMatch.groups.id;
    if (normalized === 'tests/fixtures/reviewer-capability/spec-readiness-reviewer/full-review-handoff.md') return 'spec-readiness-reviewer';
    return undefined;
};

export const deriveAffectedReviewerIds = (/** @type {string[]} */ changedPaths) => {
    const affected = new Set();
    for (const value of changedPaths) {
        const path = normalizePath(value);
        for (const [reviewerId, instructionPaths] of REVIEWER_AGENT_INSTRUCTION_PATHS) {
            if (instructionPaths.includes(path)) affected.add(reviewerId);
        }
        if (SHARED_TRIGGER_PATHS.has(path)) {
            for (const reviewerId of REVIEWER_IDS) affected.add(reviewerId);
            continue;
        }
        const roleId = reviewerFromIdentitySpecificPath(path);
        if (roleId !== undefined) affected.add(roleId);
        if (path === 'docs/agents/commits.md') {
            affected.add('code-spec-reviewer');
            affected.add('code-standards-reviewer');
            affected.add('commit-audit-reviewer');
        }
        if (path.includes('/skills/') && path.endsWith('/code-review/SKILL.md')) {
            affected.add('code-spec-reviewer');
            affected.add('code-standards-reviewer');
        }
        if (path === 'lib/commit-audit/commit-audit.mjs'
            || path === 'lib/arw.mjs') affected.add('commit-audit-reviewer');
        if (path === 'lib/spec-readiness/spec-readiness.mjs'
            || path === 'docs/agents/spec-readiness.md') {
            affected.add('spec-readiness-reviewer');
        }
    }
    return [...affected].sort(compareText);
};

const workspaceFor = (/** @type {{agentIdentity: AgentIdentity, issueId?: string, repositoryRoot: string}} */ {agentIdentity, issueId, repositoryRoot}) => createTemporaryWorkspace({
    agentIdentity,
    issueId,
    purpose: issueId === undefined ? '_reviewer-cap' : 'reviewer-cap',
    repositoryRoot,
});

const createPreparationRun = async (/** @type {string} */ workspaceDirectory) => {
    const runsDirectory = join(workspaceDirectory, 'runs');
    await mkdir(runsDirectory, {recursive: true});
    const runId = randomUUID();
    const runDirectory = join(runsDirectory, runId);
    await mkdir(runDirectory);
    return {runDirectory, runId};
};

const specReadinessInputRole = (/** @type {string} */ filePath) => {
    if (filePath.startsWith('specs/')) return 'governing-spec';
    if (filePath.startsWith('docs/adr/')) return 'adr';
    if (filePath.startsWith('rules/')) return 'architecture-evidence';
    if (filePath.startsWith('context/')) return 'domain-context';
    if (filePath.startsWith('architecture/')) return 'architecture-evidence';
    return undefined;
};

/** @returns {Promise<FixtureDefinition>} */
const loadFixtureDefinition = async (/** @type {{expectedExtraKeys?: string[], label: string, repositoryRoot: string, reviewerId: string}} */ {expectedExtraKeys = [], label, repositoryRoot, reviewerId}) => {
    const capabilityFixtureRoot = join(repositoryRoot, ...FIXTURE_DIRECTORY_SEGMENTS);
    const fixtureRoot = join(capabilityFixtureRoot, reviewerId);
    const [baseFiles, candidateFiles, handoffTemplate, isolationTemplate] = await Promise.all([
        readFixtureTree({directory: join(fixtureRoot, 'scenario', 'base'), label: `${label} base fixture`}),
        readFixtureTree({directory: join(fixtureRoot, 'scenario', 'candidate'), label: `${label} candidate fixture`}),
        readHandoffTemplate({label: `${label} handoff template`, path: join(fixtureRoot, HANDOFF_TEMPLATE_FILE)}),
        readHandoffTemplate({label: 'Common handoff template', path: join(capabilityFixtureRoot, COMMON_HANDOFF_TEMPLATE_FILE)}),
    ]);
    const expectedPath = join(fixtureRoot, 'expected.json');
    const expectedInformation = await lstat(expectedPath);
    if (!expectedInformation.isFile() || expectedInformation.isSymbolicLink()) {
        throw new Error(`${label} expected fixture must be a regular file.`);
    }
    const scenarioFiles = {...baseFiles, ...candidateFiles};
    const availablePaths = new Set(Object.keys(scenarioFiles));
    const expected = canonicalExpectedFixture({
        availablePaths,
        extraKeys: expectedExtraKeys,
        source: decodeFixtureText(await readFile(expectedPath), `${label} expected fixture`),
    });
    return {availablePaths, baseFiles, candidateFiles, expected, handoffTemplate, isolationTemplate};
};

const mergeFixtureOverrides = (/** @type {{files: Record<string, string>, label: string, overrides: Record<string, string>}} */ {files, label, overrides}) => {
    for (const path of Object.keys(overrides)) {
        if (!Object.hasOwn(files, path)) throw new Error(`${label} override names an unknown fixture path: ${path}.`);
    }
    return {...files, ...overrides};
};

const loadSpecReadinessFixtures = async (/** @type {{agentInstructionSources: Record<string, string>, repositoryRoot: string, roleSource: string}} */ {agentInstructionSources, repositoryRoot, roleSource}) => {
    const common = await loadFixtureDefinition({
        label: 'Spec Readiness',
        repositoryRoot,
        reviewerId: 'spec-readiness-reviewer',
    });
    const {expected} = common;
    if (expected.scopes.map(scope => scope.scope).join(',') !== SPEC_READINESS_SCOPES.join(',')) {
        throw new Error('Spec Readiness expected fixture scopes must equal the complete canonical check set in order.');
    }
    const issuePath = '.scratch/0001-reviewer-capability/issues/01-review-readiness.md';
    if (!Object.hasOwn(common.baseFiles, issuePath)) throw new Error('Spec Readiness base fixture is missing its implementation issue.');
    const fixtureRoot = join(repositoryRoot, ...FIXTURE_DIRECTORY_SEGMENTS, 'spec-readiness-reviewer');
    const [fullReviewBaseOverrides, fullReviewCandidateOverrides, fullReviewHandoff] = await Promise.all([
        readFixtureTree({
            directory: join(fixtureRoot, 'scenario', 'full-review', 'base'),
            label: 'Spec Readiness full-review base override fixture',
        }),
        readFixtureTree({
            directory: join(fixtureRoot, 'scenario', 'full-review', 'candidate'),
            label: 'Spec Readiness full-review candidate override fixture',
        }),
        readHandoffTemplate({
            label: 'Spec Readiness full-review handoff',
            path: join(fixtureRoot, 'full-review-handoff.md'),
        }),
    ]);
    const splitExpected = splitSpecReadinessExpected(expected);
    return SPEC_READINESS_SCENARIOS.map(({fixtureVariant, scenarioId}) => {
        const isFullReview = fixtureVariant === 'full-review';
        const baseFiles = isFullReview
            ? mergeFixtureOverrides({
                files: common.baseFiles,
                label: 'Spec Readiness full-review base',
                overrides: fullReviewBaseOverrides,
            })
            : {...common.baseFiles};
        const candidateFiles = isFullReview
            ? mergeFixtureOverrides({
                files: common.candidateFiles,
                label: 'Spec Readiness full-review candidate',
                overrides: fullReviewCandidateOverrides,
            })
            : {...common.candidateFiles};
        Object.assign(baseFiles, agentInstructionSources);
        baseFiles['docs/agents/roles/spec-readiness-reviewer.md'] = roleSource;
        return {
            availablePaths: common.availablePaths,
            baseFiles,
            candidateFiles,
            expected: isFullReview ? splitExpected.fullReview : splitExpected.requirements,
            handoffTemplate: isFullReview ? `${common.handoffTemplate}\n\n${fullReviewHandoff}` : common.handoffTemplate,
            isolationTemplate: common.isolationTemplate,
            scenarioId,
        };
    });
};

const materializeSpecReadinessFixture = async (/** @type {{agentIdentity: AgentIdentity, definition: FixtureDefinition, repositoryRoot: string, scenarioRoot: string}} */ {agentIdentity, definition, repositoryRoot, scenarioRoot}) => {
    if (definition.scenarioId === undefined) throw new Error('Spec Readiness fixture requires a registered scenario identity.');
    const issueId = 'issue:0001:01';
    const inputFiles = {...definition.baseFiles, ...definition.candidateFiles};
    const inputs = Object.keys(inputFiles)
        .map(filePath => ({filePath, role: specReadinessInputRole(filePath)}))
        .filter(entry => entry.role !== undefined)
        .sort((left, right) => compareText(left.filePath, right.filePath));
    const draftPath = join(
        scenarioRoot,
        '.tmp',
        agentIdentity.platform,
        agentIdentity.sessionId,
        '0001_01',
        'spec-readiness',
        'reviewer-drafts',
        randomUUID(),
        'reports',
        'draft.jsonl',
    );
    const prepared = await prepareSpecReadiness({
        input: {draftPath, inputs},
        issueId,
        platformAdapter: {getCurrentAgentIdentity: () => agentIdentity},
        repositoryRoot: scenarioRoot,
    });
    const request = JSON.parse(await readFile(prepared.path, 'utf8'));
    if (!isJsonObject(request) || !Array.isArray(request.inputs)
        || request.inputs.some(input => !isJsonObject(input) || typeof input.filePath !== 'string')
        || typeof request.requestDigest !== 'string' || typeof request.requestId !== 'string'
        || !isJsonObject(request.subject) || typeof request.subject.filePath !== 'string'
        || typeof request.subject.sha256 !== 'string' || !isJsonObject(request.reviewerRole)) throw new Error('Prepared Spec Readiness request is invalid.');
    const requestRelativePath = relativePathWithinScope(scenarioRoot, prepared.path);
    if (requestRelativePath === null) throw new Error('Prepared Spec Readiness request escaped its scenario root.');
    const hostWorkspaceDraftPath = relativePathWithinScope(repositoryRoot, draftPath);
    if (hostWorkspaceDraftPath === null) throw new Error('Prepared Spec Readiness draft escaped the host workspace.');
    return {
        expected: {
            ...definition.expected,
            inputs: request.inputs.map((/** @type {JsonObject & {filePath: string}} */ {content, ...entry}) => entry),
            kind: 'spec-readiness-artifact',
            request: {digest: request.requestDigest, filePath: requestRelativePath, id: request.requestId},
            reviewerRole: request.reviewerRole,
            subject: {filePath: request.subject.filePath, sha256: request.subject.sha256},
        },
        ...(definition.scenarioId === 'artifact-promotion'
            ? {resultPath: draftPath}
            : {generation: {
                command: `node ${JSON.stringify(join(repositoryRoot, 'arw.mjs'))} spec-readiness generate --issue ${issueId} --input ${JSON.stringify(draftPath)}`,
                draftPath,
                reviewerId: 'spec-readiness-reviewer',
                scenarioId: definition.scenarioId,
                workdir: scenarioRoot,
            }}),
        handoffTemplate: definition.handoffTemplate,
        handoffValues: {
            hostWorkspaceDraftPath,
            instructionPaths: specReadinessInstructionPaths(),
            requestRelativePath,
            rolePath: reviewerRolePath('spec-readiness-reviewer'),
        },
        isolationTemplate: definition.isolationTemplate,
    };
};

/** @returns {AuditRequirement} */
const canonicalAuditRequirement = (/** @type {{availablePaths: Set<string>, label: string, requirement: unknown}} */ {availablePaths, label, requirement}) => {
    if (!isJsonObject(requirement)
        || Object.keys(requirement).sort(compareText).join(',') !== 'evidence,result,source'
        || typeof requirement.result !== 'string'
        || !['gap', 'satisfied', 'uncertain'].includes(requirement.result)
        || !Array.isArray(requirement.evidence)
        || requirement.evidence.length === 0) {
        throw new Error(`${label} is malformed.`);
    }
    const source = canonicalFixtureLocator({availablePaths, label, locator: requirement.source});
    if (!Object.hasOwn(source, 'line') && !Object.hasOwn(source, 'anchor')) {
        throw new Error(`${label} source must identify a line or anchor.`);
    }
    const evidence = requirement.evidence.map((/** @type {unknown} */ locator) => canonicalFixtureLocator({
        availablePaths,
        label,
        locator,
    }));
    return {evidence, result: requirement.result, source};
};

const COMMIT_AUDIT_SCOPES = ['COMMIT-AUDIT-GATE-1', 'COMMIT-AUDIT-GATE-2'];
const COMMIT_AUDIT_ISSUE_PATH = /^\.scratch\/((?!0000)(\d{4})-[a-z0-9][a-z0-9-]*)\/issues\/((?!00)\d{2})\.audit\.json$/;
const COMMIT_AUDIT_SPEC_PATH = /^\.scratch\/((?!0000)(\d{4})-[a-z0-9][a-z0-9-]*)\/spec-audit\.json$/;

const commitAuditScopeForPath = (/** @type {string} */ path) => COMMIT_AUDIT_ISSUE_PATH.test(path)
    ? COMMIT_AUDIT_SCOPES[0]
    : COMMIT_AUDIT_SPEC_PATH.test(path) ? COMMIT_AUDIT_SCOPES[1] : undefined;

const derivedAuditResult = (/** @type {AuditRequirement[]} */ requirements) => requirements.some(requirement => requirement.result === 'gap')
    ? 'gap'
    : requirements.some((/** @type {{ result: string; }} */ requirement) => requirement.result === 'uncertain') ? 'uncertain' : 'satisfied';

/** @returns {AuditRecord} */
const canonicalAuditRecord = (/** @type {{availablePaths: Set<string>, record: unknown, recordIndex: number}} */ {availablePaths, record, recordIndex}) => {
    if (!isJsonObject(record) || typeof record.pathSuffix !== 'string') {
        throw new Error('Commit Audit expected fixture audit record is malformed.');
    }
    const pathSuffix = normalizePath(record.pathSuffix);
    const scope = commitAuditScopeForPath(pathSuffix);
    const expectedKeys = scope === COMMIT_AUDIT_SCOPES[0]
        ? ['pathSuffix', 'requirements', 'result']
        : ['documents', 'pathSuffix', 'requirements', 'result'];
    if (scope === undefined
        || Object.keys(record).sort(compareText).join(',') !== expectedKeys.sort(compareText).join(',')
        || record.pathSuffix !== pathSuffix
        || typeof record.result !== 'string'
        || !['gap', 'satisfied', 'uncertain'].includes(record.result)
        || !Array.isArray(record.requirements)
        || record.requirements.length === 0) {
        throw new Error('Commit Audit expected fixture audit record is malformed.');
    }
    const issueMatch = COMMIT_AUDIT_ISSUE_PATH.exec(pathSuffix);
    const issueSourcePaths = issueMatch === null ? [] : [...availablePaths].filter(path => {
        try {
            const artifact = parseRegisteredArtifactPath(path);
            return artifact.kind === 'issue'
                && artifact.effortDirectory === issueMatch[1]
                && artifact.issueNumber === issueMatch[3];
        } catch {
            return false;
        }
    });
    const issueSourcePath = issueSourcePaths[0];
    if (issueMatch !== null && issueSourcePaths.length !== 1) {
        throw new Error('Commit Audit expected fixture issue audit has no source issue.');
    }
    const documents = Array.isArray(record.documents) ? record.documents : [];
    if (scope === COMMIT_AUDIT_SCOPES[1]
        && (documents.length === 0
            || documents.some((/** @type {unknown} */ document, index) => (
                typeof document !== 'string'
                || !availablePaths.has(document)
                || (index > 0 && compareText(String(documents[index - 1]), document) >= 0)
            )))) {
        throw new Error('Commit Audit expected fixture spec audit documents are malformed.');
    }
    const canonicalRequirements = record.requirements.map((requirement, requirementIndex) => canonicalAuditRequirement({
        availablePaths,
        label: `Commit Audit record ${recordIndex + 1} requirement ${requirementIndex + 1}`,
        requirement,
    }));
    const sourceCounts = new Map();
    for (const requirement of canonicalRequirements) {
        const key = locatorKey(requirement.source);
        sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
    }
    const sourceOccurrences = new Map();
    const requirements = canonicalRequirements.map(requirement => {
        const key = locatorKey(requirement.source);
        if (sourceCounts.get(key) === 1) return requirement;
        const occurrence = (sourceOccurrences.get(key) ?? 0) + 1;
        sourceOccurrences.set(key, occurrence);
        return {...requirement, identity: `${key}\0${occurrence}`};
    });
    if (requirements.some((/** @type {{ source: { filePath: string; }; }} */ requirement) => issueSourcePath !== undefined
        ? requirement.source.filePath !== issueSourcePath
        : !Array.isArray(record.documents) || !record.documents.includes(requirement.source.filePath))) {
        throw new Error('Commit Audit expected fixture requirement source is outside its audit record.');
    }
    if (record.result !== derivedAuditResult(requirements)) {
        throw new Error('Commit Audit expected fixture record result does not match its requirements.');
    }
    return {
        ...(scope === COMMIT_AUDIT_SCOPES[1] && Array.isArray(record.documents)
            ? {documents: record.documents.filter((/** @type {unknown} */ document) => typeof document === 'string')}
            : {}),
        pathSuffix,
        requirements,
        result: record.result,
    };
};

const canonicalAuditRecords = (/** @type {{availablePaths: Set<string>, records: unknown}} */ {availablePaths, records}) => {
    if (!Array.isArray(records) || records.length === 0) {
        throw new Error('Commit Audit expected fixture must contain audit records.');
    }
    const canonical = records.map((record, recordIndex) => canonicalAuditRecord({
        availablePaths,
        record,
        recordIndex,
    }));
    if (canonical.some((record, index) => index > 0
        && compareText(canonical[index - 1].pathSuffix, record.pathSuffix) >= 0)) {
        throw new Error('Commit Audit expected fixture audit records must use unique canonical path order.');
    }
    return canonical;
};

const bipartiteCoverageAssignments = (/** @type {{candidateIndexes: number[][], orderCandidates?: (input: {candidates: number[], owners: Map<number, number>}) => number[]}} */ {candidateIndexes, orderCandidates = ({candidates}) => candidates}) => {
    /** @type {Map<number, number>} */
    const owners = new Map();
    /** @returns {boolean} */
    const assign = (/** @type {number} */ candidateListIndex, /** @type {Set<number>} */ visited) => {
        const ordered = orderCandidates({candidates: [...(candidateIndexes[candidateListIndex] ?? [])], owners});
        for (const candidateIndex of ordered) {
            if (visited.has(candidateIndex)) continue;
            visited.add(candidateIndex);
            const previousOwner = owners.get(candidateIndex);
            if (previousOwner === undefined || assign(previousOwner, visited)) {
                owners.set(candidateIndex, candidateListIndex);
                return true;
            }
        }
        return false;
    };
    if (!candidateIndexes.every((_, index) => assign(index, new Set()))) return undefined;
    return new Map([...owners].map(([candidateIndex, candidateListIndex]) => [candidateListIndex, candidateIndex]));
};

const auditProblemCoverageAssignments = (/** @type {{problemCases: FixtureCase[], requirements: AuditRequirement[]}} */ {problemCases, requirements}) => {
    if (problemCases.length !== requirements.length) return undefined;
    const candidateIndexes = problemCases.map(problemCase => {
        const evidenceSets = (problemCase.placements ?? [problemCase]).map(placement => evidenceSetKey(placement.evidence));
        return requirements.flatMap((requirement, index) => (
            requirement.result === problemCase.result && evidenceSets.includes(evidenceSetKey(requirement.evidence)) ? [index] : []
        ));
    });
    return bipartiteCoverageAssignments({candidateIndexes});
};

export const auditCleanCoverageAssignments = (/** @type {{cleanCases: FixtureCase[], requirements: AuditRequirement[]}} */ {cleanCases, requirements}) => {
    const indexedCases = cleanCases.flatMap((cleanCase, cleanCaseIndex) => cleanCase.noOtherSupportedFinding === true
        ? []
        : [{cleanCase, cleanCaseIndex}]);
    if (indexedCases.length !== requirements.length) return undefined;
    const candidateIndexes = indexedCases.map(({cleanCase}) => {
        const primaryEvidence = evidenceSetKey(cleanCase.evidence ?? []);
        return requirements.flatMap((requirement, index) => primaryEvidence === evidenceSetKey(requirement.evidence) ? [index] : []);
    });
    const assignments = bipartiteCoverageAssignments({
        candidateIndexes,
        orderCandidates: ({candidates, owners}) => candidates.sort((left, right) => (
            Number(owners.has(left)) - Number(owners.has(right))
        )),
    });
    if (assignments === undefined) return undefined;
    return new Map([...assignments].map(([casePosition, requirementIndex]) => [
        indexedCases[casePosition]?.cleanCaseIndex,
        requirementIndex,
    ]));
};

const validateCommitAuditCaseCoverage = (/** @type {{auditRecords: AuditRecord[], scopes: FixtureScope[]}} */ {auditRecords, scopes}) => {
    if (scopes.map(scope => scope.scope).join(',') !== COMMIT_AUDIT_SCOPES.join(',')) {
        throw new Error('Commit Audit expected fixture scopes are invalid.');
    }
    for (const scope of scopes) {
        if (scope.problemCases.some(problemCase => problemCase.placements?.some(placement => placement.check !== scope.scope))) {
            throw new Error('Commit Audit problem cases must use their owning audit scope.');
        }
        const requirements = auditRecords
            .filter(record => commitAuditScopeForPath(record.pathSuffix) === scope.scope)
            .flatMap(record => record.requirements);
        if (requirements.length === 0) {
            throw new Error('Commit Audit expected fixture scope has no audit records.');
        }
        const nonSatisfiedRequirements = requirements.filter(requirement => requirement.result !== 'satisfied');
        const satisfiedRequirements = requirements.filter(requirement => requirement.result === 'satisfied');
        if (auditProblemCoverageAssignments({problemCases: scope.problemCases, requirements: nonSatisfiedRequirements}) === undefined
            || auditCleanCoverageAssignments({cleanCases: scope.cleanCases, requirements: satisfiedRequirements}) === undefined) {
            throw new Error('Commit Audit expected fixture cases must classify every audit requirement exactly once.');
        }
    }
};

const bindCommitAuditRequirementSources = (/** @type {{auditRecords: AuditRecord[], scopes: FixtureScope[]}} */ {auditRecords, scopes}) => scopes.map(scope => {
    const requirements = auditRecords
        .filter(record => commitAuditScopeForPath(record.pathSuffix) === scope.scope)
        .flatMap(record => record.requirements);
    const problemRequirements = requirements.filter(requirement => requirement.result !== 'satisfied');
    const cleanRequirements = requirements.filter(requirement => requirement.result === 'satisfied');
    const problemAssignments = auditProblemCoverageAssignments({problemCases: scope.problemCases, requirements: problemRequirements});
    const cleanAssignments = auditCleanCoverageAssignments({cleanCases: scope.cleanCases, requirements: cleanRequirements});
    if (problemAssignments === undefined || cleanAssignments === undefined) {
        throw new Error('Commit Audit cases cannot bind their requirement sources.');
    }
    return {
        ...scope,
        problemCases: scope.problemCases.map((problemCase, caseIndex) => {
            const requirementIndex = problemAssignments.get(caseIndex);
            const requirement = requirementIndex === undefined ? undefined : problemRequirements[requirementIndex];
            if (requirement === undefined) throw new Error('Commit Audit problem case has no requirement source.');
            return {...problemCase, requirementSource: requirement.identity ?? locatorKey(requirement.source)};
        }),
        cleanCases: scope.cleanCases.map((cleanCase, cleanCaseIndex) => {
            if (cleanCase.noOtherSupportedFinding === true) return cleanCase;
            const requirementIndex = cleanAssignments.get(cleanCaseIndex);
            const requirement = requirementIndex === undefined ? undefined : cleanRequirements[requirementIndex];
            if (requirement === undefined) throw new Error('Commit Audit clean case has no requirement source.');
            return {...cleanCase, requirementSource: requirement.identity ?? locatorKey(requirement.source)};
        }),
    };
});

/** @returns {Promise<FixtureDefinition>} */
const scenarioDefinition = async (/** @type {{agentInstructionSources: Record<string, string>, repositoryRoot: string, reviewerId: string, roleSource: string, scenarioRoot: string}} */ {agentInstructionSources, repositoryRoot, reviewerId, roleSource, scenarioRoot}) => {
    if (reviewerId === 'code-standards-reviewer' || reviewerId === 'code-spec-reviewer') {
        const isStandards = reviewerId === 'code-standards-reviewer';
        const label = isStandards ? 'Code Standards' : 'Code Spec';
        const scope = isStandards ? 'CODE-STANDARDS-FINDINGS' : 'CODE-SPEC-FINDINGS';
        const definition = await loadFixtureDefinition({label, repositoryRoot, reviewerId});
        if (definition.expected.scopes.length !== 1 || definition.expected.scopes[0].scope !== scope) {
            throw new Error(`${label} expected fixture must contain its one canonical scope.`);
        }
        Object.assign(definition.baseFiles, agentInstructionSources);
        definition.baseFiles[joinRelativePath('docs/agents/roles', `${reviewerId}.md`)] = roleSource;
        return {
            ...definition,
            expected: {...definition.expected, kind: 'markdown-findings'},
            handoffValues: {
                includedChangedPaths: includedChangedPaths(definition.candidateFiles),
            },
        };
    }
    const definition = await loadFixtureDefinition({
        expectedExtraKeys: ['auditRecords'],
        label: 'Commit Audit',
        repositoryRoot,
        reviewerId,
    });
    const auditRecords = canonicalAuditRecords({
        availablePaths: definition.availablePaths,
        records: definition.expected.auditRecords,
    });
    validateCommitAuditCaseCoverage({auditRecords, scopes: definition.expected.scopes});
    const scopes = bindCommitAuditRequirementSources({auditRecords, scopes: definition.expected.scopes});
    const authorizingIssueIds = Object.keys(definition.candidateFiles)
        .flatMap(path => {
            try {
                const artifact = parseRegisteredArtifactPath(path);
                return artifact.kind === 'issue' ? [artifact.canonicalId] : [];
            } catch {
                return [];
            }
        })
        .sort(compareText);
    if (authorizingIssueIds.length !== 2) {
        throw new Error('Commit Audit capability scenario must contain two authorizing issues from one effort.');
    }
    Object.assign(definition.baseFiles, agentInstructionSources);
    definition.baseFiles['docs/agents/roles/commit-audit-reviewer.md'] = roleSource;
    return {
        ...definition,
        expected: {...definition.expected, auditRecords, authorizingIssueIds, kind: 'commit-audit-files', scopes},
        handoffValues: {},
    };
};

const writeScenarioFiles = async (/** @type {string} */ scenarioRoot, /** @type {Record<string, string>} */ files) => {
    for (const [relativePath, source] of Object.entries(files)) {
        const targetPath = join(scenarioRoot, relativePath);
        await mkdir(dirname(targetPath), {recursive: true});
        await writeFile(targetPath, source, 'utf8');
    }
};

const calculateScenarioDigest = async (/** @type {{reviewerId: string, runCommand: RunCommand, scenarioRoot: string}} */ {reviewerId, runCommand, scenarioRoot}) => sha256(await requireGitOutput({
    args: ['diff', '--cached', '--no-ext-diff', '--binary', '--full-index', 'HEAD', '--'],
    label: `${reviewerId} staged scenario content`,
    repositoryRoot: scenarioRoot,
    runCommand,
}));

const prepareCommitAuditCapabilityRequest = async (/** @type {{agentIdentity: AgentIdentity, authorizingIssueIds: string[], runCommand: RunCommand, scenarioRoot: string}} */ {
    agentIdentity,
    authorizingIssueIds,
    runCommand,
    scenarioRoot,
}) => {
    const requestDirectory = await createTemporaryWorkspace({
        agentIdentity,
        purpose: '_commit-audit-capability',
        repositoryRoot: scenarioRoot,
    });
    const inputPath = join(requestDirectory, 'input.json');
    await writeFile(inputPath, `${JSON.stringify({authorizingIssueIds})}\n`, {encoding: 'utf8', flag: 'wx'});
    const prepared = await prepareCommitAudit({
        git: scenarioGitRunner({repositoryRoot: scenarioRoot, runCommand}),
        inputPath,
        repositoryRoot: scenarioRoot,
    });
    if (!isJsonObject(prepared) || typeof prepared.requestPath !== 'string') {
        throw new Error('Commit Audit capability preparation did not return a request path.');
    }
    /** @type {Buffer} */
    let requestBytes;
    /** @type {unknown} */
    let request;
    try {
        requestBytes = await readFile(prepared.requestPath);
        request = JSON.parse(requestBytes.toString('utf8'));
    } catch {
        throw new Error('Commit Audit capability preparation returned an unreadable request.');
    }
    if (!isJsonObject(request) || typeof request.draftPath !== 'string') {
        throw new Error('Commit Audit capability request does not bind a JSONL draft path.');
    }
    return {draftPath: request.draftPath, requestPath: prepared.requestPath, requestSha256: sha256(requestBytes), workdir: scenarioRoot};
};

/** @returns {Promise<ScenarioRuntime>} */
const createScenarioRepository = async (/** @type {{agentIdentity: AgentIdentity, definition: FixtureDefinition, repositoryRoot: string, reviewerId: string, runCommand: RunCommand, scenarioRoot: string}} */ {
    agentIdentity,
    definition,
    repositoryRoot,
    reviewerId,
    runCommand,
    scenarioRoot,
}) => {
    const markerPath = join(scenarioRoot, '.prepared');
    const scenarioRevision = SCENARIO_REVISIONS.get(reviewerId);
    const marker = `${reviewerId}:${scenarioRevision}:${definition.scenarioId ?? 'default'}\n`;
    try {
        if ((await readFile(markerPath, 'utf8')) === marker) {
            const scenarioDigest = await calculateScenarioDigest({reviewerId, runCommand, scenarioRoot});
            /** @type {Pick<ScenarioRuntime, 'expected' | 'generation' | 'handoffTemplate' | 'handoffValues' | 'isolationTemplate' | 'resultPath'>} */
            const runtime = reviewerId === 'spec-readiness-reviewer'
                ? await materializeSpecReadinessFixture({agentIdentity, definition, repositoryRoot, scenarioRoot})
                : definition;
            if (runtime.handoffValues === undefined) throw new Error(`${reviewerId} capability scenario has no handoff values.`);
            return {
                expected: runtime.expected,
                generation: runtime.generation,
                handoffTemplate: runtime.handoffTemplate,
                handoffValues: runtime.handoffValues,
                isolationTemplate: runtime.isolationTemplate,
                ...(runtime.resultPath === undefined ? {} : {resultPath: runtime.resultPath}),
                scenarioDigest,
                scenarioId: definition.scenarioId,
                scenarioRoot,
            };
        }
    } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
    await mkdir(scenarioRoot, {recursive: true});
    await writeScenarioFiles(scenarioRoot, definition.baseFiles);
    await requireGitOutput({args: ['-c', 'core.longpaths=true', 'init'], label: `${reviewerId} scenario init`, repositoryRoot: scenarioRoot, runCommand});
    await readScenarioRepositoryRoots({reviewerId, runCommand, scenarioRoot});
    await requireGitOutput({args: ['config', 'core.longpaths', 'true'], label: `${reviewerId} scenario long paths`, repositoryRoot: scenarioRoot, runCommand});
    await requireGitOutput({args: ['config', 'user.email', 'reviewer-capability@example.test'], label: `${reviewerId} scenario email`, repositoryRoot: scenarioRoot, runCommand});
    await requireGitOutput({args: ['config', 'user.name', 'Reviewer Capability'], label: `${reviewerId} scenario name`, repositoryRoot: scenarioRoot, runCommand});
    await requireGitOutput({args: ['add', '.'], label: `${reviewerId} scenario base add`, repositoryRoot: scenarioRoot, runCommand});
    await requireGitOutput({args: ['commit', '-m', 'capability scenario base'], label: `${reviewerId} scenario base commit`, repositoryRoot: scenarioRoot, runCommand});
    await writeScenarioFiles(scenarioRoot, definition.candidateFiles);
    await writeScenarioFiles(scenarioRoot, definition.temporaryFiles ?? {});
    await requireGitOutput({args: ['add', ...Object.keys(definition.candidateFiles)], label: `${reviewerId} scenario candidate add`, repositoryRoot: scenarioRoot, runCommand});
    await writeFile(markerPath, marker, 'utf8');
    const scenarioDigest = await calculateScenarioDigest({reviewerId, runCommand, scenarioRoot});
    /** @type {Pick<ScenarioRuntime, 'expected' | 'generation' | 'handoffTemplate' | 'handoffValues' | 'isolationTemplate' | 'resultPath'>} */
    const runtime = reviewerId === 'spec-readiness-reviewer'
        ? await materializeSpecReadinessFixture({agentIdentity, definition, repositoryRoot, scenarioRoot})
        : definition;
    if (runtime.handoffValues === undefined) throw new Error(`${reviewerId} capability scenario has no handoff values.`);
    return {
        expected: runtime.expected,
        generation: runtime.generation,
        handoffTemplate: runtime.handoffTemplate,
        handoffValues: runtime.handoffValues,
        isolationTemplate: runtime.isolationTemplate,
        ...(runtime.resultPath === undefined ? {} : {resultPath: runtime.resultPath}),
        scenarioDigest,
        scenarioId: definition.scenarioId,
        scenarioRoot,
    };
};

/** @returns {Promise<Array<ScenarioRuntime & {instanceId: string, prompt: string, repetition: number, reportPath: string}>>} */
const createScenarios = async (/** @type {{agentIdentity: AgentIdentity, agentInstructionSources: Record<string, string>, repositoryRoot: string, reviewerId: string, roleSource: string, runCommand: RunCommand, selectedIndexes?: number[], workspaceDirectory: string}} */ {
    agentIdentity,
    agentInstructionSources,
    repositoryRoot,
    reviewerId,
    roleSource,
    runCommand,
    selectedIndexes,
    workspaceDirectory,
}) => {
    const instanceIdFor = (/** @type {FixtureDefinition} */ definition, /** @type {number} */ index) => (
        `${definition.scenarioId ?? 'default'}-${basename(workspaceDirectory)}-instance-${index + 1}`
    );
    const instanceDirectoryName = (/** @type {number} */ index) => String(index + 1);
    const createInstances = async (/** @type {{definition: FixtureDefinition, repetitions: number[], segments: string[]}} */ {definition, repetitions, segments}) => Promise.all(
        repetitions.map(async index => {
            const instanceId = instanceIdFor(definition, index);
            const scenarioRoot = join(workspaceDirectory, ...segments, instanceDirectoryName(index));
            const runtime = await createScenarioRepository({
                agentIdentity,
                definition,
                repositoryRoot,
                reviewerId,
                runCommand,
                scenarioRoot,
            });
            const resultPath = runtime.resultPath ?? (runtime.expected.kind === 'markdown-findings'
                ? join(scenarioRoot, '.tmp', 'reports', 'review-result.md')
                : undefined);
            if (resultPath !== undefined && runtime.resultPath === undefined) {
                await mkdir(dirname(resultPath), {recursive: true});
                await writeFile(resultPath, '', {flag: 'wx'});
            }
            const commitAuditRequest = reviewerId === 'commit-audit-reviewer'
                ? await prepareCommitAuditCapabilityRequest({
                    agentIdentity,
                    authorizingIssueIds: runtime.expected.authorizingIssueIds ?? [],
                    runCommand,
                    scenarioRoot,
                })
                : undefined;
            const reportPath = commitAuditRequest?.draftPath ?? resultPath ?? runtime.generation?.draftPath;
            if (typeof reportPath !== 'string' || !isAbsolute(reportPath)
                || !relativePathWithinScope(scenarioRoot, reportPath)?.startsWith('.tmp/')) {
                throw new Error(`${reviewerId} capability report path must belong to its scenario temporary workspace.`);
            }
            const isolationPrompt = renderHandoffTemplate({
                label: 'Common',
                template: runtime.isolationTemplate,
                values: {ignoredInstructionPaths: inapplicableInstructionPaths(reviewerId), scenarioRoot},
            });
            const handoffValues = /** @type {Record<string, string>} */ (commitAuditRequest === undefined
                ? {
                    ...runtime.handoffValues,
                    isolationPrompt,
                    ...(resultPath === undefined || !runtime.handoffTemplate.includes('{{resultPath}}') ? {} : {resultPath}),
                }
                : {isolationPrompt, requestPath: commitAuditRequest.requestPath});
            return {
                ...runtime,
                ...(commitAuditRequest === undefined ? {} : {
                    expected: {...runtime.expected, requestSha256: commitAuditRequest.requestSha256},
                }),
                ...(commitAuditRequest === undefined ? {} : {
                    generation: {
                        requestPath: commitAuditRequest.requestPath,
                        reviewerId,
                        workdir: commitAuditRequest.workdir,
                    },
                    requestPath: commitAuditRequest.requestPath,
                }),
                instanceId,
                repetition: index + 1,
                reportPath,
                prompt: renderHandoffTemplate({
                    label: reviewerId,
                    template: runtime.handoffTemplate,
                    values: handoffValues,
                }),
                ...(commitAuditRequest === undefined ? {} : {requestPath: commitAuditRequest.requestPath}),
                ...(resultPath === undefined ? {} : {resultPath}),
            };
        }),
    );
    if (reviewerId !== 'spec-readiness-reviewer') {
        const segment = SCENARIO_SEGMENTS.get(reviewerId);
        if (segment === undefined) throw new Error(`Reviewer ${reviewerId} has no capability scenario path.`);
        const definition = await scenarioDefinition({
            agentInstructionSources,
            repositoryRoot,
            reviewerId,
            roleSource,
            scenarioRoot: join(workspaceDirectory, segment, instanceDirectoryName(0)),
        });
        return createInstances({definition, repetitions: selectedIndexes ?? [0, 1, 2], segments: [segment]});
    }
    const definitions = await loadSpecReadinessFixtures({agentInstructionSources, repositoryRoot, roleSource});
    /** @type {Array<ScenarioRuntime & {instanceId: string, prompt: string, repetition: number, reportPath: string}>} */
    const scenarios = [];
    for (const definition of definitions) {
        const configured = SPEC_READINESS_SCENARIOS.find(item => item.scenarioId === definition.scenarioId);
        if (configured === undefined) throw new Error(`Spec Readiness scenario ${definition.scenarioId ?? 'unknown'} is not registered.`);
        const scenarioIndex = SPEC_READINESS_SCENARIOS.indexOf(configured);
        const repetitions = [0, 1, 2].filter(index => selectedIndexes === undefined
            || selectedIndexes.includes(index * SPEC_READINESS_SCENARIOS.length + scenarioIndex));
        scenarios.push(...await createInstances({definition, repetitions, segments: configured.segments}));
    }
    return Array.from({length: CAPABILITY_INSTANCE_COUNT}, (_, index) => scenarios.filter(
        scenario => scenario.repetition === index + 1,
    )).flat();
};

/** @returns {Promise<{contract: CapabilityContract, generations: GenerationEntry[], handoffs: ReviewerHandoff[]}>} */
const createCapabilityContract = async (/** @type {{agentIdentity: AgentIdentity, candidateFiles?: Map<string, Buffer>, candidateTree: string, includeRoleIdentity: boolean, repositoryRoot: string, reviewerId: string, runCommand: RunCommand, runDirectory: string, selectedIndexes?: number[]}} */ {
    agentIdentity,
    candidateFiles: providedCandidateFiles,
    candidateTree,
    includeRoleIdentity,
    repositoryRoot,
    reviewerId,
    runCommand,
    runDirectory,
    selectedIndexes,
}) => {
    const rolePath = reviewerRolePath(reviewerId);
    const instructionPaths = REVIEWER_AGENT_INSTRUCTION_PATHS.get(reviewerId);
    if (instructionPaths === undefined) throw new Error(`Unknown reviewer identity: ${reviewerId}.`);
    const candidateFiles = includeRoleIdentity
        ? providedCandidateFiles ?? await requireCandidateFiles({
            candidateTree,
            files: [
                {filePath: rolePath, label: `${reviewerId} candidate Role`},
                ...instructionPaths.map(filePath => ({
                    filePath,
                    label: `${reviewerId} candidate Agent instruction ${filePath}`,
                })),
            ],
            repositoryRoot,
            runCommand,
        })
        : undefined;
    const roleBytes = candidateFiles === undefined
        ? await readFile(join(repositoryRoot, ...rolePath.split('/')))
        : candidateFiles.get(rolePath);
    if (roleBytes === undefined) throw new Error(`${reviewerId} candidate Role is unavailable.`);
    const agentInstructionBytes = await readAgentInstructionBytes({
        candidateFiles,
        repositoryRoot,
        reviewerId,
    });
    const rootInstructions = agentInstructionBytes[ROOT_AGENT_INSTRUCTIONS_PATH];
    if (rootInstructions === undefined) throw new Error('Root Agent instructions are unavailable for capability preparation.');
    validateScenarioInstructionReferences({
        roleInstructions: roleBytes.toString('utf8'),
        rootInstructions: rootInstructions.toString('utf8'),
        reviewerId,
    });
    const reviewerBytes = agentInstructionBytes[REVIEWER_INSTRUCTIONS_PATH];
    if (reviewerBytes === undefined) throw new Error('Reviewer instructions are unavailable for capability preparation.');
    const scenarios = await createScenarios({
        agentIdentity,
        agentInstructionSources: Object.fromEntries(Object.entries(agentInstructionBytes).map(([path, bytes]) => (
            [path, bytes.toString('utf8')]
        ))),
        repositoryRoot,
        reviewerId,
        roleSource: roleBytes.toString('utf8'),
        runCommand,
        selectedIndexes,
        workspaceDirectory: runDirectory,
    });
    const scenarioRevision = SCENARIO_REVISIONS.get(reviewerId);
    if (scenarioRevision === undefined) throw new Error(`Reviewer ${reviewerId} has no capability scenario revision.`);
    const commonContract = {
        platform: agentIdentity.platform,
        reviewerId,
        ...(includeRoleIdentity ? {
            reviewerInstructionsSha256: sha256(reviewerBytes),
            roleSha256: sha256(roleBytes),
        } : {}),
        scenarioRevision,
    };
    const instances = scenarios.map(({expected, instanceId, reportPath, requestPath, resultPath, scenarioDigest, scenarioId, scenarioRoot}) => ({
        expected,
        instanceId,
        reportPath,
        ...(requestPath === undefined ? {} : {requestPath}),
        ...(resultPath === undefined ? {} : {resultPath}),
        scenarioDigest,
        ...(scenarioId === undefined ? {} : {scenarioId}),
        scenarioRoot,
    }));
    const contract = {...commonContract, instances};
    return {
        contract,
        generations: scenarios.flatMap(({generation, instanceId}) => generation === undefined ? [] : [{...generation, instanceId}]),
        handoffs: scenarios.map(({instanceId, prompt, reportPath, scenarioId, scenarioRoot}) => ({
            instanceId,
            input: {
                role: reviewerId,
                identity: {kind: 'isolated', instanceId},
                instructions: `${roleBytes.toString('utf8')}\n${reviewerBytes.toString('utf8')}`,
                handoff: prompt,
                cwd: scenarioRoot,
                writePaths: [dirname(reportPath)],
                reportPath,
                stateDirectory: runDirectory,
            },
            reviewerId,
            ...(scenarioId === undefined ? {} : {scenarioId}),
            scenarioRoot,
        })),
    };
};

const writePreparedCapabilityState = async (/** @type {{runDirectory: string, state: JsonObject}} */ {runDirectory, state}) => {
    const preparedPath = join(runDirectory, PREPARED_STATE_FILE);
    await writeFile(preparedPath, serializeCanonicalJson(state), {encoding: 'utf8', flag: 'wx'});
    return preparedPath;
};

const prepareTargetedCapability = async (/** @type {{agentIdentity: AgentIdentity, issueId?: string, repositoryRoot: string, reviewerId: string, runCommand: RunCommand}} */ {agentIdentity, issueId, repositoryRoot, reviewerId, runCommand}) => {
    if (typeof reviewerId !== 'string' || !ALL_REVIEWERS.has(reviewerId)) {
        throw new Error('Targeted Reviewer capability requires one registered Reviewer identity.');
    }
    const workspaceDirectory = await workspaceFor({agentIdentity, issueId, repositoryRoot});
    const {runDirectory, runId} = await createPreparationRun(workspaceDirectory);
    const {generations, handoffs, preparedPath} = await reviewerCapabilityVerificationCore.prepareAtomically({
        create: identity => createCapabilityContract({
            agentIdentity,
            candidateTree: 'targeted',
            includeRoleIdentity: false,
            repositoryRoot,
            reviewerId: identity,
            runCommand,
            runDirectory,
        }),
        reviewerIds: [reviewerId],
        write: contracts => writePreparedCapabilityState({
            runDirectory,
            state: {
                contracts,
                mode: 'targeted',
                platform: agentIdentity.platform,
                reviewerIds: [reviewerId],
                runId,
            },
        }),
    });
    return {
        generations,
        handoffs,
        preparedPath,
    };
};

const prepareReleaseCapability = async (/** @type {{agentIdentity: AgentIdentity, issueId?: string, repositoryRoot: string, runCommand: RunCommand}} */ {agentIdentity, issueId, repositoryRoot, runCommand}) => {
    const candidateResult = await resolveReleaseCandidate({
        phase: 'pre-tag',
        remote: 'origin',
        repositoryRoot,
        runCommand: async (file, args, options) => runTextCommand(runCommand, file, args, options),
    });
    if (candidateResult.status === 'failed' || candidateResult.candidate === undefined) return candidateResult;
    const {candidate} = candidateResult;
    const reviewerIds = deriveAffectedReviewerIds(candidate.changedPaths);
    const workspaceDirectory = await workspaceFor({agentIdentity, issueId, repositoryRoot});
    const {runDirectory, runId} = await createPreparationRun(workspaceDirectory);
    const candidateFiles = reviewerIds.length === 0
        ? new Map()
        : await requireCandidateFiles({
            candidateTree: candidate.tree,
            files: reviewerIds.flatMap(reviewerId => {
                const instructionPaths = REVIEWER_AGENT_INSTRUCTION_PATHS.get(reviewerId);
                if (instructionPaths === undefined) throw new Error(`Unknown reviewer identity: ${reviewerId}.`);
                return [
                    {filePath: reviewerRolePath(reviewerId), label: `${reviewerId} candidate Role`},
                    ...instructionPaths.map(filePath => ({
                        filePath,
                        label: `${reviewerId} candidate Agent instruction ${filePath}`,
                    })),
                ];
            }),
            repositoryRoot,
            runCommand,
        });
    const {generations, handoffs, preparedPath} = await reviewerCapabilityVerificationCore.prepareAtomically({
        create: reviewerId => createCapabilityContract({
            agentIdentity,
            candidateFiles,
            candidateTree: candidate.tree,
            includeRoleIdentity: true,
            repositoryRoot,
            reviewerId,
            runCommand,
            runDirectory,
        }),
        reviewerIds,
        write: contracts => writePreparedCapabilityState({
            runDirectory,
            state: {
                contracts,
                mode: 'release',
                platform: agentIdentity.platform,
                reviewerIds,
                runId,
            },
        }),
    });
    return {generations, handoffs, preparedPath, reviewerIds, status: 'prepared'};
};

/**
 * 为一个 registered Reviewer 创建不绑定 Source Checkout candidate 的定向轮次, 或为当前 committed candidate 创建完整发布批次.
 * 返回只供 Main Agent 使用的 prepared path, handoffs 与 generation entries. 任一 identity, Role, fixture 或 workspace 输入无效时, 在写入不完整状态前失败.
 */
export const prepareReviewerCapabilityConformance = async (/** @type {PrepareInput} */ {
    agentIdentity,
    issueId = undefined,
    preparedPath = undefined,
    repositoryRoot,
    reviewerId = undefined,
    runCommand = defaultRunCommand,
    selection = undefined,
}) => {
    const input = {agentIdentity, issueId, repositoryRoot: resolve(repositoryRoot), runCommand};
    if (preparedPath !== undefined || selection !== undefined) {
        if (reviewerId !== undefined || typeof preparedPath !== 'string' || selection === undefined) {
            throw new Error('Reviewer capability partial preparation requires a prepared path and selection without a Reviewer override.');
        }
        return preparePartialCapability({...input, preparedPath, selection});
    }
    return reviewerId === undefined
        ? prepareReleaseCapability(input)
        : prepareTargetedCapability({...input, reviewerId});
};

/**
 * 为干净 Source Checkout 的 committed candidate 创建完整发布批次.
 */
export const prepareReviewerCapabilityRelease = async (/** @type {PrepareInput} */ input) => {
    try {
        return await prepareReviewerCapabilityConformance(input);
    } catch (error) {
        return reviewerCapabilityVerificationCore.closedOperationFailure({code: 'prepare-failed', error});
    }
};

const failed = (/** @type {string} */ message, /** @type {string} */ reviewerId = '') => ({
    diagnostics: [{code: reviewerId.length === 0 ? 'reviewer-response-identities' : 'reviewer-capability-mismatch', message, reviewerId}],
    status: 'failed',
});

const canonicalGeneratedReadinessArtifact = (/** @type {{path: string, scenarioRoot: string}} */ {path, scenarioRoot}) => {
    const relativePath = relativePathWithinScope(scenarioRoot, path);
    if (relativePath === null) return false;
    const parts = relativePath.split('/');
    const formal = parts.length === 7
        && parts[0] === '.tmp'
        && parts[1] === 'codex'
        && parts[2].length > 0
        && parts[2] !== '.'
        && parts[2] !== '..'
        && parts[3] === '0001_01'
        && parts[4] === 'spec-readiness'
        && parts[5] === 'artifacts'
        && /^artifact-[0-9a-f-]{36}\.json$/.test(parts[6]);
    return formal;
};

const evidencePathsIn = (/** @type {unknown} */ value) => {
    /** @type {string[]} */
    const paths = [];
    const visit = (/** @type {unknown} */ entry) => {
        if (Array.isArray(entry)) entry.forEach(visit);
        else if (isJsonObject(entry)) {
            if (typeof entry.filePath === 'string') paths.push(entry.filePath);
            Object.values(entry).forEach(visit);
        }
    };
    visit(value);
    return paths;
};

const loadEvidenceSources = async (/** @type {{expected: ExpectedFixture, scenarioRoot: string, additionalEvidence?: unknown, runCommand: RunCommand}} */ {expected, scenarioRoot, additionalEvidence, runCommand}) => {
    /** @type {Map<string, string>} */
    const sources = new Map();
    const paths = new Set([...evidencePathsIn(expected.scopes), ...evidencePathsIn(additionalEvidence)].map(path => isAbsolute(path) ? relativePathWithinScope(scenarioRoot, path) : normalizePath(path)).filter(isDefined));
    const index = await requireGitOutput({args: ['ls-files', '--stage', '-z'], label: 'Capability evidence index', repositoryRoot: scenarioRoot, runCommand});
    const requests = index.split('\0').flatMap(entry => {
        const match = /^100(?:644|755) ([0-9a-f]+) 0\t(.+)$/u.exec(entry);
        return match !== null && paths.has(match[2]) && isSafeReleaseRelativePath(match[2])
            ? [{filePath: match[2], label: 'Capability evidence source', specification: match[1]}] : [];
    });
    if (requests.length === 0) return sources;
    const result = await readGitEvidenceBatch({candidateContentGit: createCandidateContentGitAdapter(runCommand), repositoryRoot: scenarioRoot, requests, specifications: requests.map(entry => entry.specification)});
    if (result.status === 'failed') throw new Error(result.message);
    for (const entry of result.entries) {
        try { sources.set(entry.filePath, decodeFixtureText(entry.bytes, 'Capability evidence source')); }
        catch { /* 无法解码的证据不享有空白行计分例外. */ }
    }
    return sources;
};

const derivedReviewResult = (/** @type {Array<{result: string}>} */ values) => values.some(value => value.result === 'gap')
    ? 'gap'
    : values.some((/** @type {{ result: string; }} */ value) => value.result === 'uncertain')
        ? 'uncertain'
        : 'satisfied';

const validReadinessLocator = (/** @type {{inputPaths: Set<string>, locator: unknown}} */ {inputPaths, locator}) => {
    if (!isJsonObject(locator)) return false;
    return Object.keys(locator).sort(compareText).join(',') === 'filePath,line'
        && typeof locator.line === 'number'
        && Number.isSafeInteger(locator.line)
        && locator.line > 0
        && typeof locator.filePath === 'string'
        && normalizePath(locator.filePath) === locator.filePath
        && isSafeReleaseRelativePath(locator.filePath)
        && inputPaths.has(locator.filePath);
};

const validReadinessFinding = (/** @type {{finding: unknown, inputPaths: Set<string>}} */ {finding, inputPaths}) => isJsonObject(finding)
    && Object.keys(finding).sort(compareText).join(',') === 'evidence,finding,result'
    && typeof finding.result === 'string'
    && ['gap', 'uncertain'].includes(finding.result)
    && typeof finding.finding === 'string'
    && finding.finding.trim() === finding.finding
    && finding.finding.length > 0
    && Array.isArray(finding.evidence)
    && finding.evidence.length > 0
    && finding.evidence.every(locator => validReadinessLocator({inputPaths, locator}));

const validateReadinessCheck = (/** @type {{check: unknown, inputPaths: Set<string>, scope: string | undefined}} */ {check, inputPaths, scope}) => {
    if (!isJsonObject(check) || check.check !== scope) {
        return 'Spec Readiness artifact check identity or order is invalid.';
    }
    if (check.result === 'satisfied') {
        return Object.keys(check).sort(compareText).join(',') === 'check,result'
            ? undefined
            : 'Spec Readiness satisfied check grammar is invalid.';
    }
    if (typeof check.result !== 'string'
        || !['gap', 'uncertain'].includes(check.result)
        || Object.keys(check).sort(compareText).join(',') !== 'check,findings,result'
        || !Array.isArray(check.findings)
        || check.findings.length === 0) {
        return 'Spec Readiness non-satisfied check grammar is invalid.';
    }
    if (check.findings.some((/** @type {unknown} */ finding) => !validReadinessFinding({finding, inputPaths}))) {
        return 'Spec Readiness finding grammar is invalid.';
    }
    const findings = check.findings.filter(isJsonObject).flatMap(finding => typeof finding.result === 'string' ? [{result: finding.result}] : []);
    return check.result === derivedReviewResult(findings)
        ? undefined
        : 'Spec Readiness check result does not match its findings.';
};

const validateReadinessCheckGrammar = (/** @type {{expected: ExpectedFixture, value: JsonObject}} */ {expected, value}) => {
    if (!Array.isArray(expected.inputs) || !Array.isArray(value.checks) || expected.subject === undefined) {
        return 'Spec Readiness expected fixture or artifact checks are malformed.';
    }
    const inputPaths = new Set(expected.inputs.map(input => normalizePath(input.filePath)));
    for (const [index, check] of value.checks.entries()) {
        const scope = expected.scopes[index]?.scope;
        if (scope === undefined) return 'Spec Readiness artifact contains an unexpected check.';
        const allowedPaths = SPEC_READINESS_SUBJECT_EVIDENCE_SCOPES.has(scope)
            ? new Set([...inputPaths, normalizePath(expected.subject.filePath)])
            : inputPaths;
        const finding = validateReadinessCheck({
            check,
            inputPaths: allowedPaths,
            scope,
        });
        if (finding !== undefined) return finding;
    }
    const checks = value.checks.filter(isJsonObject).flatMap(check => typeof check.result === 'string' ? [{result: check.result}] : []);
    return value.result === derivedReviewResult(checks)
        ? undefined
        : 'Spec Readiness overall result does not match its checks.';
};

const scoreReadinessChecks = async (/** @type {{adjudicationDecisions: Map<string, string>, checks: JsonObject[], expected: ExpectedFixture, instanceId: string, reportDiagnostics?: ContentDiagnostic[], retainScorer?: (score: (decisions: Map<string, string>) => CapabilityScore) => void, reviewerId: string, scenarioRoot: string}} */ {
    adjudicationDecisions, checks, expected, instanceId, reportDiagnostics = [], retainScorer, reviewerId, scenarioRoot,
}) => {
    const request = await preparedSpecReadinessDraft({expected, scenarioRoot});
    const sources = await readSpecReadinessEvidenceSources({issueId: 'issue:0001:01', repositoryRoot: scenarioRoot, requestPath: request.requestPath});
    const scorer = createReviewerCapabilityScenarioScorer({evidenceSources: sources.sources, expected, instanceId, reviewerId, scenarioRoot});
    const presentChecks = new Set(checks.map(check => check.check));
    const missingCleanScores = new Map(expected.scopes.filter(scope => !presentChecks.has(scope.scope)).map(scope => [
        scope.scope, new Map(scope.cleanCases.map((_, index) => [index, 0])),
    ]));
    const score = (/** @type {Map<string, string>} */ decisions) => scorer({adjudicationDecisions: decisions, checks, cleanObservationScores: missingCleanScores});
    retainScorer?.(score);
    return {...score(adjudicationDecisions), reportDiagnostics};
};

const validateSpecReadiness = async (/** @type {{adjudicationDecisions: Map<string, string>, allowCorrectedReport?: boolean, artifactPaths: string[], expected: ExpectedFixture, instance: PreparedScenario, retainScorer?: (score: (decisions: Map<string, string>) => CapabilityScore) => void, reviewerId: string}} */ {
    adjudicationDecisions, allowCorrectedReport = false, artifactPaths, expected, instance, retainScorer, reviewerId,
}) => {
    const {instanceId, scenarioRoot} = instance;
    const request = await preparedSpecReadinessDraft({expected, scenarioRoot});
    if (request.draftPath !== instance.reportPath || artifactPaths.length !== 1) {
        return {finding: `${reviewerId} report is not bound to its prepared Request.`};
    }
    const path = artifactPaths[0];
    const raw = path === instance.reportPath || allowCorrectedReport;
    if (!raw && !canonicalGeneratedReadinessArtifact({path, scenarioRoot})) return {finding: `${reviewerId} report path is not bound to a raw or generated report.`};
    if (raw) {
        const review = await readCompleteSpecReadinessCapabilityDraft({
            inputPath: instance.reportPath, issueId: 'issue:0001:01', repositoryRoot: scenarioRoot,
            requestPath: request.requestPath, allowRequirementScopeContinuation: instance.scenarioId === 'artifact-promotion',
            ...(path === instance.reportPath ? {} : {correctedDraftPath: path}),
        });
        if (reviewerCapabilityVerificationCore.fullReviewBindingFailure({expected, review}) === 'binding') {
            return {finding: `${reviewerId} draft request, Inputs, Role, or subject binding is invalid.`};
        }
        return scoreReadinessChecks({adjudicationDecisions, checks: review.checks, expected, instanceId,
            reportDiagnostics: 'reportDiagnostics' in review ? /** @type {ContentDiagnostic[]} */ (review.reportDiagnostics) : [],
            retainScorer, reviewerId, scenarioRoot});
    }
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (!isJsonObject(value) || value.schemaVersion !== 6 || value.issueId !== 'issue:0001:01'
        || Object.keys(value).sort(compareText).join(',') !== 'checks,inputs,issueId,request,result,reviewerRole,schemaVersion,subject'
        || reviewerCapabilityVerificationCore.fullReviewBindingFailure({expected, review: value}) !== undefined
        || validateReadinessCheckGrammar({expected, value}) !== undefined) {
        return {finding: `${reviewerId} canonical generated artifact binding or content is invalid.`};
    }
    return scoreReadinessChecks({adjudicationDecisions, checks: /** @type {JsonObject[]} */ (value.checks), expected,
        instanceId, retainScorer, reviewerId, scenarioRoot});
};

const preparedRunIdForPath = (/** @type {{preparedPath: string, workspaceDirectory: string}} */ {preparedPath, workspaceDirectory}) => {
    const relativePath = relativePathWithinScope(workspaceDirectory, preparedPath);
    if (relativePath === null) throw new Error('Reviewer capability prepared path must belong to the current Repository, platform, and Main Agent session.');
    const match = /^runs\/(?<runId>[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/prepared\.json$/.exec(relativePath);
    if (match === null) throw new Error('Reviewer capability prepared path must belong to the current Repository, platform, and Main Agent session.');
    return match.groups?.runId;
};

const requirePreparedState = async (/** @type {{agentIdentity: AgentIdentity, currentRevision?: boolean, expectedSha256?: string, preparedPath: string, seen?: Set<string>, workspaceDirectory: string}} */ {agentIdentity, currentRevision = true, expectedSha256, preparedPath, seen = new Set(), workspaceDirectory}) => {
    const resolvedPath = resolve(preparedPath);
    if (seen.has(resolvedPath)) throw new Error('Reviewer capability prepared source chain contains a cycle.');
    seen.add(resolvedPath);
    const runId = preparedRunIdForPath({preparedPath: resolvedPath, workspaceDirectory});
    if (comparablePath(await realpath(resolvedPath)) !== comparablePath(resolvedPath)) {
        throw new Error('Reviewer capability prepared path must not traverse a symbolic link.');
    }
    const stateBytes = await readFile(resolvedPath);
    if (expectedSha256 !== undefined && sha256(stateBytes) !== expectedSha256) {
        throw new Error('Reviewer capability previous prepared record bytes changed.');
    }
    const state = /** @type {PreparedState} */ (JSON.parse(stateBytes.toString('utf8')));
    if (state === null || Array.isArray(state) || typeof state !== 'object') {
        throw new Error('Reviewer capability prepared record must be one JSON object.');
    }
    const commonKeys = ['contracts', 'mode', 'platform', 'reviewerIds', 'runId',
        ...('previousPrepared' in state ? ['previousPrepared'] : [])];
    const expectedKeys = state.mode === 'release'
        ? commonKeys
        : state.mode === 'targeted'
            ? commonKeys
            : [];
    if (expectedKeys.length === 0 || Object.keys(state).sort().join(',') !== expectedKeys.sort().join(',')) {
        throw new Error('Reviewer capability prepared record fields are invalid.');
    }
    if (state.runId !== runId || state.platform !== agentIdentity.platform) {
        throw new Error('Reviewer capability prepared record identity does not match the current run.');
    }
    if (!Array.isArray(state.reviewerIds)
        || (state.mode === 'targeted' && state.reviewerIds.length === 0)
        || new Set(state.reviewerIds).size !== state.reviewerIds.length
        || state.reviewerIds.some((/** @type {string} */ reviewerId, /** @type {number} */ index) => !ALL_REVIEWERS.has(reviewerId)
            || reviewerId !== [...state.reviewerIds].sort(compareText)[index])
        || (state.mode === 'targeted' && state.reviewerIds.length !== 1)
        || !Array.isArray(state.contracts)
        || state.contracts.length !== state.reviewerIds.length) {
        throw new Error('Reviewer capability prepared Reviewer identities are invalid.');
    }
    /** @type {PreparedState | undefined} */
    let previousState;
    if ('previousPrepared' in state) {
        const previous = state.previousPrepared;
        if (!isJsonObject(previous)
            || Object.keys(previous).sort(compareText).join(',') !== 'preparedPath,sha256'
            || typeof previous.preparedPath !== 'string'
            || !isAbsolute(previous.preparedPath)
            || resolve(previous.preparedPath) !== previous.preparedPath
            || typeof previous.sha256 !== 'string'
            || !/^[0-9a-f]{64}$/.test(previous.sha256)) {
            throw new Error('Reviewer capability previous prepared binding is invalid.');
        }
        const sourceState = await requirePreparedState({
            agentIdentity,
            currentRevision: false,
            expectedSha256: previous.sha256,
            preparedPath: previous.preparedPath,
            seen,
            workspaceDirectory,
        });
        if (sourceState.mode !== state.mode
            || sourceState.platform !== state.platform
            || !isDeepStrictEqual(sourceState.reviewerIds, state.reviewerIds)) {
            throw new Error('Reviewer capability previous prepared mode or Reviewer set changed.');
        }
        previousState = sourceState;
    }
    const runDirectory = dirname(resolvedPath);
    let freshInstances = 0;
    for (const [index, contract] of state.contracts.entries()) {
        const isSpecReadiness = contract?.reviewerId === 'spec-readiness-reviewer';
        const isCommitAudit = contract?.reviewerId === 'commit-audit-reviewer';
        const contractKeys = [
            'instances',
            'platform',
            'reviewerId',
            'scenarioRevision',
            ...(state.mode === 'release' ? ['reviewerInstructionsSha256', 'roleSha256'] : []),
        ];
        if (contract === null
            || Array.isArray(contract)
            || typeof contract !== 'object'
            || Object.keys(contract).sort().join(',') !== contractKeys.sort().join(',')
            || contract.reviewerId !== state.reviewerIds[index]
            || contract.platform !== state.platform
            || !Number.isSafeInteger(contract.scenarioRevision)
            || contract.scenarioRevision < 1
            || (currentRevision && contract.scenarioRevision !== SCENARIO_REVISIONS.get(contract.reviewerId))) {
            throw new Error('Reviewer capability prepared scenario contract is invalid.');
        }
        const previousContract = previousState?.contracts[index];
        const hasRetainedInstances = previousContract !== undefined && Array.isArray(contract.instances) && contract.instances.some((instance, position) => (
            isDeepStrictEqual(instance, previousContract.instances[position])
        ));
        if (hasRetainedInstances
            && !isDeepStrictEqual({...contract, instances: []}, {...previousContract, instances: []})) {
            throw new Error('Reviewer capability previous prepared Reviewer contract changed.');
        }
        const expectedInstanceCount = (isSpecReadiness ? SPEC_READINESS_SCENARIOS.length : 1) * CAPABILITY_INSTANCE_COUNT;
        if (!Array.isArray(contract.instances)
            || contract.instances.length !== expectedInstanceCount
            || contract.instances.some((/** @type {unknown} */ instance, /** @type {number} */ instanceIndex) => {
                const {repetition, scenarioIndex} = capabilityInstancePosition(contract.reviewerId, instanceIndex);
                const configured = isSpecReadiness ? SPEC_READINESS_SCENARIOS[scenarioIndex] : undefined;
                if (!isJsonObject(instance)
                    || Object.keys(instance).sort().join(',') !== (isSpecReadiness
                        ? configured?.scenarioId === 'artifact-promotion'
                            ? 'expected,instanceId,reportPath,resultPath,scenarioDigest,scenarioId,scenarioRoot'
                            : 'expected,instanceId,reportPath,scenarioDigest,scenarioId,scenarioRoot'
                        : isCommitAudit
                            ? 'expected,instanceId,reportPath,requestPath,scenarioDigest,scenarioRoot'
                            : contract.reviewerId === 'code-spec-reviewer' || contract.reviewerId === 'code-standards-reviewer'
                            ? 'expected,instanceId,reportPath,resultPath,scenarioDigest,scenarioRoot'
                            : 'expected,instanceId,reportPath,scenarioDigest,scenarioRoot')
                    || typeof instance.instanceId !== 'string'
                    || typeof instance.reportPath !== 'string'
                    || !isAbsolute(instance.reportPath)
                    || typeof instance.scenarioDigest !== 'string'
                    || !/^[0-9a-f]{64}$/.test(instance.scenarioDigest)
                    || typeof instance.scenarioRoot !== 'string'
                    || !relativePathWithinScope(instance.scenarioRoot, instance.reportPath)?.startsWith('.tmp/')
                    || (isCommitAudit && (typeof instance.requestPath !== 'string'
                        || relativePathWithinScope(instance.scenarioRoot, instance.requestPath) === null))
                    || ((contract.reviewerId === 'code-spec-reviewer' || contract.reviewerId === 'code-standards-reviewer')
                        && (typeof instance.resultPath !== 'string' || instance.reportPath !== instance.resultPath
                            || ![join(resolve(instance.scenarioRoot), '.tmp', 'reports', 'review-result.md'),
                                join(resolve(instance.scenarioRoot), '.tmp', 'review-result.md')].includes(resolve(instance.resultPath))))) return true;
                const expectedId = `${configured?.scenarioId ?? 'default'}-${state.runId}-instance-${repetition}`;
                const expectedPath = isSpecReadiness
                    ? [...(configured?.segments ?? []), String(repetition)].join('/')
                    : `${SCENARIO_SEGMENTS.get(contract.reviewerId)}/${repetition}`;
                const instanceRelativePath = relativePathWithinScope(runDirectory, resolve(instance.scenarioRoot)) ?? '../';
                const retained = previousContract !== undefined
                    && isDeepStrictEqual(instance, previousContract.instances[instanceIndex]);
                if (!retained) freshInstances++;
                return (!retained && (instance.instanceId !== expectedId || instanceRelativePath !== expectedPath))
                    || (isSpecReadiness && instance.scenarioId !== configured?.scenarioId)
                    || (configured?.scenarioId === 'artifact-promotion'
                        && (typeof instance.resultPath !== 'string'
                            || instance.reportPath !== instance.resultPath
                            || !instance.resultPath.endsWith('.jsonl')
                            || relativePathWithinScope(instance.scenarioRoot, instance.resultPath) === null));
            })) {
            throw new Error('Reviewer capability prepared instance contract is invalid.');
        }
        if (state.mode === 'release'
            && (typeof contract.roleSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(contract.roleSha256)
                || typeof contract.reviewerInstructionsSha256 !== 'string'
                || !/^[0-9a-f]{64}$/.test(contract.reviewerInstructionsSha256))) {
            throw new Error('Reviewer capability prepared release instruction identity is invalid.');
        }
    }
    if (previousState !== undefined && freshInstances === 0) {
        throw new Error('Reviewer capability partial preparation has no newly bound instances.');
    }
    return state;
};

const readCommitAuditArtifact = async (/** @type {{gate: number, path: string, preserveOriginalRequirements?: boolean, reviewerId: string}} */ {gate, path, preserveOriginalRequirements = false, reviewerId}) => {
    try {
        const bytes = await readFile(path);
        const canonical = parseFormalCommitAuditRecord({bytes, gate});
        if (!preserveOriginalRequirements) return {record: canonical};
        const original = JSON.parse(bytes.toString('utf8'));
        if (!isJsonObject(original) || !Array.isArray(original.requirements)) throw new Error('Audit requirements are unavailable.');
        return {record: {...canonical, requirements: original.requirements}};
    } catch {
        return {finding: `${reviewerId} returned an unreadable or malformed audit path.`};
    }
};

const evidenceSourceLineCount = (/** @type {string} */ source) => source.length === 0
    ? 0
    : (source.endsWith('\n') ? source.slice(0, -1) : source).split('\n').length;

const commitAuditEvidenceLocators = (/** @type {{evidence: unknown, evidenceSources: Map<string, string>}} */ {evidence, evidenceSources}) => {
    if (!Array.isArray(evidence)) return {locators: []};
    const locators = [];
    for (const item of evidence) {
        if (!isJsonObject(item) || typeof item.filePath !== 'string' || !Array.isArray(item.lines) || item.lines.length === 0) {
            locators.push(item);
            continue;
        }
        const source = evidenceSources.get(normalizePath(item.filePath));
        const lineCount = source === undefined ? 0 : evidenceSourceLineCount(source);
        for (const region of item.lines) {
            if (Number.isSafeInteger(region) && region > 0 && region <= lineCount) {
                locators.push({filePath: item.filePath, line: region});
            } else if (Array.isArray(region) && region.length === 2
                && region.every(line => Number.isSafeInteger(line) && line > 0)
                && region[0] <= region[1] && region[1] <= lineCount) {
                locators.push({filePath: item.filePath, lineEnd: region[1], lineStart: region[0]});
            } else locators.push({filePath: item.filePath, lines: [region]});
        }
    }
    return {locators};
};

const auditRequirementIdentity = (/** @type {AuditRequirement} */ requirement) => requirement.identity ?? locatorKey(requirement.source);

/** @typedef {{evidenceKey?: string, index: number, requirement: AuditRequirement}} IndexedExpectedRequirement */
/** @typedef {{evidenceKey?: string, index: number, requirement: unknown, result?: string}} IndexedActualRequirement */

const commitAuditRequirementGroups = (/** @type {{actualRequirements: unknown[], evidenceSources: Map<string, string>, expectedRequirements: AuditRequirement[]}} */ {
    actualRequirements,
    evidenceSources,
    expectedRequirements,
}) => {
    /** @type {Map<string, IndexedExpectedRequirement[]>} */
    const expectedBySource = new Map();
    for (const [index, requirement] of expectedRequirements.entries()) {
        const key = locatorKey(requirement.source);
        const entries = expectedBySource.get(key) ?? [];
        entries.push({evidenceKey: evidenceSetKey(requirement.evidence), index, requirement});
        expectedBySource.set(key, entries);
    }
    /** @type {Map<string, IndexedActualRequirement[]>} */
    const actualBySource = new Map();
    for (const [index, requirement] of actualRequirements.entries()) {
        const key = locatorKey(isJsonObject(requirement) ? requirement.source : undefined);
        const evidenceResult = commitAuditEvidenceLocators({
            evidence: isJsonObject(requirement) ? requirement.evidence : undefined,
            evidenceSources,
        });
        const entries = actualBySource.get(key) ?? [];
        entries.push({
            evidenceKey: evidenceSetKey(evidenceResult.locators),
            index,
            requirement,
            result: isJsonObject(requirement) && typeof requirement.result === 'string' ? requirement.result : undefined,
        });
        actualBySource.set(key, entries);
    }
    return new Map([...expectedBySource].map(([source, expectedEntries]) => [source,
        {actualEntries: actualBySource.get(source) ?? [], expectedEntries}]));
};

const uniquePreferredAuditAssignments = (/** @type {{actualEntries: IndexedActualRequirement[], expectedEntries: IndexedExpectedRequirement[]}} */ {actualEntries, expectedEntries}) => {
    const count = expectedEntries.length;
    if (actualEntries.length !== count) return undefined;
    if (count === 1) return new Map([[expectedEntries[0].index, actualEntries[0].index]]);
    // A stronger match outweighs every possible weaker match in this source group.
    const base = count + 1;
    const costs = expectedEntries.map(expected => actualEntries.map(actual => {
        const resultMatches = actual.result === expected.requirement.result;
        const evidenceMatches = actual.evidenceKey === expected.evidenceKey;
        return base * base - (resultMatches && evidenceMatches ? base * base : resultMatches ? base : evidenceMatches ? 1 : 0);
    }));
    const columns = uniqueMinimumCostAssignment(costs);
    if (columns === undefined) return undefined;
    return new Map(expectedEntries.map((expected, row) => [expected.index, actualEntries[columns[row]].index]));
};

const matchCommitAuditRequirements = (/** @type {{actualRequirements: unknown[], requirementBindings?: Map<number, number | null>, evidenceSources: Map<string, string>, expectedRequirements: AuditRequirement[]}} */ {
    actualRequirements, requirementBindings, evidenceSources, expectedRequirements,
}) => {
    /** @type {Map<number, unknown>} */
    const assignments = new Map();
    for (const group of commitAuditRequirementGroups({actualRequirements, evidenceSources, expectedRequirements}).values()) {
        const {actualEntries, expectedEntries} = group;
        const automatic = uniquePreferredAuditAssignments(group);
        if (automatic === undefined) {
            if (expectedEntries.length === 1 && requirementBindings === undefined) {
                assignments.set(expectedEntries[0].index, undefined);
                continue;
            }
            if (requirementBindings === undefined || expectedEntries.some(entry => !requirementBindings.has(entry.index))) return undefined;
            const availableActual = new Set(actualEntries.map(entry => entry.index));
            for (const expected of expectedEntries) {
                const actualIndex = requirementBindings.get(expected.index);
                if (actualIndex === null) {
                    assignments.set(expected.index, undefined);
                    continue;
                }
                if (actualIndex === undefined || !availableActual.delete(actualIndex)) return undefined;
                assignments.set(expected.index, actualRequirements[actualIndex]);
            }
            continue;
        }
        if (expectedEntries.some(entry => requirementBindings?.has(entry.index))) return undefined;
        for (const [expectedIndex, actualIndex] of automatic) assignments.set(expectedIndex, actualRequirements[actualIndex]);
    }
    return assignments.size === expectedRequirements.length
        && (requirementBindings === undefined || [...requirementBindings.keys()].every(index => assignments.has(index)))
        ? assignments : undefined;
};

const parseCommitAuditRequirement = (/** @type {{evidenceSources: Map<string, string>, expectedRequirement: AuditRequirement, requirement: unknown, reviewerId: string}} */ {evidenceSources, expectedRequirement, requirement, reviewerId}) => {
    const source = locatorKey(expectedRequirement.source);
    const requirementIdentity = auditRequirementIdentity(expectedRequirement);
    if (!isJsonObject(requirement) || typeof requirement.result !== 'string' || !['gap', 'satisfied', 'uncertain'].includes(requirement.result)) {
        return {error: `${reviewerId} did not return requirement ${source} with a valid result.`};
    }
    const evidenceResult = commitAuditEvidenceLocators({evidence: requirement.evidence, evidenceSources});
    const actualEvidence = evidenceResult.locators;
    const cleanObservation = expectedRequirement.result === 'satisfied'
        ? {
            actualEvidence,
            requirementSource: requirementIdentity,
            satisfied: requirement.result === 'satisfied' && !Object.hasOwn(requirement, 'finding'),
        }
        : undefined;
    if (requirement.result === 'satisfied') {
        if (Object.hasOwn(requirement, 'finding')) {
            return {error: `${reviewerId} attached a finding to satisfied requirement ${source}.`};
        }
        return {cleanObservation};
    }
    if (typeof requirement.finding !== 'string' || requirement.finding.trim().length === 0) {
        return {error: `${reviewerId} did not explain non-satisfied requirement ${source}.`};
    }
    return {
        cleanObservation,
        parsedFinding: {
            evidence: actualEvidence,
            finding: requirement.finding,
            requirementSource: requirementIdentity,
            result: requirement.result,
        },
    };
};

const parseCommitAuditRecord = (/** @type {{requirementBindings?: Map<number, number | null>, evidenceSources: Map<string, string>, expectedRecord: AuditRecord, record: unknown, reviewerId: string, scope: string}} */ {requirementBindings, evidenceSources, expectedRecord, record, reviewerId, scope}) => {
    if (!isJsonObject(record) || !Array.isArray(record.requirements)) {
        return {finding: `${reviewerId} returned an audit without requirements.`};
    }
    const actualRequirements = record.requirements;
    if (expectedRecord.documents !== undefined
        && JSON.stringify(record.documents) !== JSON.stringify(expectedRecord.documents)) {
        return {finding: `${reviewerId} returned the wrong governing document set for ${expectedRecord.pathSuffix}.`};
    }
    const requirements = matchCommitAuditRequirements({
        actualRequirements,
        requirementBindings,
        evidenceSources,
        expectedRequirements: expectedRecord.requirements,
    });
    if (requirements === undefined) return {
        finding: `${reviewerId} returned the wrong requirement source multiplicities for ${expectedRecord.pathSuffix}.`,
    };
    /** @type {ContentDiagnostic[]} */
    const reportDiagnostics = [];
    if (actualRequirements.length !== expectedRecord.requirements.length
        || expectedRecord.requirements.some((requirement, expectedIndex) => {
            if (requirements.get(expectedIndex) === undefined) return true;
            const source = locatorKey(requirement.source);
            return actualRequirements.filter(actual => locatorKey(isJsonObject(actual) ? actual.source : undefined) === source).length
                !== expectedRecord.requirements.filter(expected => locatorKey(expected.source) === source).length;
        })) reportDiagnostics.push({code: 'requirement-coverage-invalid', message: 'Requirement report has missing, duplicate, or split rows.'});
    const expectedSources = new Set(expectedRecord.requirements.map(requirement => locatorKey(requirement.source)));
    if (actualRequirements.some(requirement => !expectedSources.has(locatorKey(isJsonObject(requirement) ? requirement.source : undefined)))) {
        reportDiagnostics.push({code: 'requirement-source-invalid', message: 'Requirement source is outside the expected set.'});
    }
    /** @type {Finding[]} */
    const findings = [];
    /** @type {Array<{actualEvidence: unknown[], requirementSource: string, satisfied: boolean}>} */
    const cleanObservations = [];
    for (const [expectedIndex, expectedRequirement] of expectedRecord.requirements.entries()) {
        if (requirements.get(expectedIndex) === undefined) {
            if (expectedRequirement.result === 'satisfied') cleanObservations.push({
                actualEvidence: [],
                requirementSource: auditRequirementIdentity(expectedRequirement),
                satisfied: false,
            });
            continue;
        }
        const parsed = parseCommitAuditRequirement({
            evidenceSources,
            expectedRequirement,
            requirement: requirements.get(expectedIndex),
            reviewerId,
        });
        if (parsed.error !== undefined) {
            reportDiagnostics.push({code: 'review-format-invalid', message: parsed.error});
            if (expectedRequirement.result === 'satisfied') cleanObservations.push({actualEvidence: [],
                requirementSource: auditRequirementIdentity(expectedRequirement), satisfied: false});
            continue;
        }
        if (parsed.parsedFinding !== undefined) findings.push(parsed.parsedFinding);
        if (parsed.cleanObservation !== undefined) cleanObservations.push(parsed.cleanObservation);
    }
    const requirementResults = actualRequirements.flatMap((/** @type {unknown} */ requirement) => (
        isJsonObject(requirement) && typeof requirement.result === 'string' ? [{result: requirement.result}] : []
    ));
    const derivedResult = derivedReviewResult(requirementResults);
    if (record.result !== derivedResult) {
        reportDiagnostics.push({code: 'review-format-invalid', message: `${reviewerId} audit result does not match its requirement results for ${expectedRecord.pathSuffix}.`});
    }
    return {check: {check: scope, findings, result: derivedReviewResult(findings)}, cleanObservations, reportDiagnostics};
};

const parseCommitAuditRecords = (/** @type {{requirementBindings?: Map<number, Map<number, number | null>>, evidenceSources: Map<string, string>, expected: ExpectedFixture, records: unknown[], reviewerId: string}} */ {
    requirementBindings,
    evidenceSources,
    expected,
    records,
    reviewerId,
}) => {
    /** @type {Map<string, Finding[]>} */
    const checksByScope = new Map(expected.scopes.map(scope => [scope.scope, []]));
    const cleanCaseIndexesBySource = new Map(expected.scopes.map(scope => {
        const indexesBySource = new Map(scope.cleanCases.flatMap((cleanCase, cleanCaseIndex) => (
            cleanCase.noOtherSupportedFinding === true || cleanCase.requirementSource === undefined
                ? []
                : [[cleanCase.requirementSource, cleanCaseIndex]]
        )));
        return [scope.scope, indexesBySource];
    }));
    /** @type {Array<{actualEvidence: unknown[], cleanCaseIndex: number, satisfied: boolean, scope: string}>} */
    const cleanObservations = [];
    /** @type {ContentDiagnostic[]} */
    const reportDiagnostics = [];
    const expectedScopesById = new Map(expected.scopes.map(scope => [scope.scope, scope]));
    if (expected.auditRecords === undefined) return {finding: `${reviewerId} expected Commit Audit records are unavailable.`};
    for (const [index, expectedRecord] of expected.auditRecords.entries()) {
        const scope = commitAuditScopeForPath(expectedRecord.pathSuffix);
        if (scope === undefined) return {finding: `${reviewerId} expected Commit Audit scope is invalid.`};
        const parsed = parseCommitAuditRecord({
                requirementBindings: requirementBindings?.get(index),
            evidenceSources,
            expectedRecord,
            record: records[index],
            reviewerId,
            scope,
        });
        if (parsed.finding !== undefined) return parsed;
        reportDiagnostics.push(...parsed.reportDiagnostics);
        const ownedFindings = checksByScope.get(parsed.check.check);
        if (ownedFindings === undefined) return {finding: `${reviewerId} returned an unknown Commit Audit scope.`};
        ownedFindings.push(...parsed.check.findings);
        for (const observation of parsed.cleanObservations) {
            const cleanCaseIndex = cleanCaseIndexesBySource.get(parsed.check.check)?.get(observation.requirementSource);
            const cleanCase = cleanCaseIndex === undefined ? undefined : expectedScopesById.get(parsed.check.check)?.cleanCases[cleanCaseIndex];
            if (cleanCaseIndex === undefined || cleanCase === undefined) return {finding: `${reviewerId} returned an unexpected clean observation.`};
            cleanObservations.push({
                actualEvidence: observation.actualEvidence,
                cleanCaseIndex,
                satisfied: observation.satisfied,
                scope: parsed.check.check,
            });
        }
    }
    const checks = expected.scopes.map(scope => {
        const findings = checksByScope.get(scope.scope) ?? [];
        return {check: scope.scope, findings, result: derivedReviewResult(findings)};
    });
    return {checks, cleanObservations, reportDiagnostics};
};

const bindReportDiagnostics = (/** @type {{instanceId: string, reviewerId: string}} */ identity,
    /** @type {ContentDiagnostic[]} */ diagnostics) => diagnostics.map(diagnostic => ({...diagnostic, ...identity}));

const readCapabilityAuditInput = async (/** @type {{artifact: ArtifactInstance, instance: PreparedScenario, reviewerId: string, runCommand: RunCommand}} */ {artifact, instance, reviewerId, runCommand}) => {
    if (typeof instance.requestPath !== 'string') throw new Error('Prepared Commit Audit Request is unavailable.');
    const paths = artifact.formatCorrection === undefined ? artifact.artifactPaths ?? [] : [artifact.formatCorrection.correctedReportPath];
    const raw = paths.length === 1 && (paths[0] === instance.reportPath || artifact.formatCorrection !== undefined);
    if (artifact.modelFailure !== undefined || raw) {
        const validated = await validateCommitAuditReviewForCapabilityScoring({git: scenarioGitRunner({repositoryRoot: instance.scenarioRoot, runCommand}),
            repositoryRoot: instance.scenarioRoot, requestPath: instance.requestPath,
            ...(artifact.modelFailure === undefined ? {reviewPath: paths[0]} : {})});
        if (validated.status === 'failed') {
            if (artifact.modelFailure !== undefined && validated.kind === 'review-output-invalid' && validated.phase === 'review-syntax'
                && !validated.diagnostics.some(item => item.code === 'review-read-failed')) {
                return {records: [], reportDiagnostics: validated.diagnostics};
            }
            throw new Error(validated.diagnostics.map(item => item.message).join(' '));
        }
        if (artifact.modelFailure !== undefined) {
            if (validated.rows.length > 0) throw new Error('Model failure cannot replace scorable report content.');
            return {records: [], reportDiagnostics: validated.reportDiagnostics};
        }
        if (validated.rows.length === 0) throw new Error(`${reviewerId} report has no scorable content; a confirmed modelFailure is required.`);
        const expectedRecords = instance.expected.auditRecords;
        if (expectedRecords === undefined || validated.records.length !== expectedRecords.length
            || validated.records.some((record, index) => !normalizePath(record.targetPath).endsWith(normalizePath(expectedRecords[index].pathSuffix)))) {
            throw new Error(`${reviewerId} generated mapping differs from its prepared Request.`);
        }
        return {records: validated.records.map(record => record.record), reportDiagnostics: validated.reportDiagnostics};
    }
    const expectedRecords = instance.expected.auditRecords;
    if (expectedRecords === undefined || paths.length !== expectedRecords.length
        || paths.some((path, index) => resolve(path) !== join(dirname(resolve(/** @type {string} */ (instance.requestPath))), basename(normalizePath(expectedRecords[index].pathSuffix))))) {
        throw new Error(`${reviewerId} audit paths differ from the prepared generation mapping.`);
    }
    // Request and current candidate checks apply even when scoring generated artifacts.
    const candidate = await validateCommitAuditReviewForCapabilityScoring({git: scenarioGitRunner({repositoryRoot: instance.scenarioRoot, runCommand}),
        repositoryRoot: instance.scenarioRoot, requestPath: instance.requestPath});
    if (candidate.status === 'failed' && (candidate.kind !== 'review-output-invalid' || candidate.phase !== 'review-syntax')) {
        throw new Error(candidate.diagnostics.map(item => item.message).join(' '));
    }
    const records = [];
    for (const [index, path] of paths.entries()) {
        const read = await readCommitAuditArtifact({gate: commitAuditScopeForPath(expectedRecords[index].pathSuffix) === COMMIT_AUDIT_SCOPES[0] ? 1 : 2,
            path, preserveOriginalRequirements: true, reviewerId});
        if (read.finding !== undefined) throw new Error(read.finding);
        records.push(read.record);
    }
    return {records, reportDiagnostics: []};
};

const validateFormatCorrectionSource = async (/** @type {{correction: FormatCorrection, instance: PreparedScenario, reviewerId: string, runCommand: RunCommand}} */ {correction, instance, reviewerId, runCommand}) => {
    await Promise.all([correction.originalReportPath, correction.correctedReportPath].map(async path => {
        const metadata = await lstat(path);
        if (!metadata.isFile() || metadata.nlink !== 1 || comparablePath(await realpath(path)) !== comparablePath(resolve(path))) {
            throw new Error('Format correction paths must identify independent regular files.');
        }
    }));
    const identity = {instanceId: instance.instanceId, reviewerId};
    if (reviewerId === 'spec-readiness-reviewer') {
        const request = await preparedSpecReadinessDraft({expected: instance.expected, scenarioRoot: instance.scenarioRoot});
        let diagnostics;
        try {
            const parsed = await readCompleteSpecReadinessCapabilityDraft({inputPath: instance.reportPath, issueId: 'issue:0001:01',
                repositoryRoot: instance.scenarioRoot, requestPath: request.requestPath,
                allowRequirementScopeContinuation: instance.scenarioId === 'artifact-promotion'});
            diagnostics = 'reportDiagnostics' in parsed ? /** @type {ContentDiagnostic[]} */ (parsed.reportDiagnostics) : [];
        } catch (error) {
            if (!(error instanceof SpecReadinessReviewerDraftFormatError)) throw error;
            diagnostics = [{code: 'review-format-invalid', message: error.message}];
        }
        if (!diagnostics.some(item => item.code === 'review-format-invalid')) throw new Error('Original report has no verified representation error.');
        return bindReportDiagnostics(identity, diagnostics);
    }
    if (reviewerId === 'commit-audit-reviewer') {
        if (typeof instance.requestPath !== 'string') throw new Error('Prepared Commit Audit Request is unavailable.');
        const strict = await validateCommitAuditReview({git: scenarioGitRunner({repositoryRoot: instance.scenarioRoot, runCommand}),
            repositoryRoot: instance.scenarioRoot, requestPath: instance.requestPath, reviewPath: correction.originalReportPath});
        if (strict.status !== 'failed' || strict.kind !== 'review-output-invalid' || strict.phase !== 'review-syntax'
            || strict.diagnostics.some(item => item.code === 'review-read-failed' || item.code === 'review-utf8-invalid')) {
            throw new Error('Original report has no verified representation error.');
        }
        return bindReportDiagnostics(identity, strict.diagnostics);
    }
    const original = reviewerCapabilityVerificationCore.parseMarkdownArtifact({response: await readFile(correction.originalReportPath, 'utf8'),
        reviewerId, scope: instance.expected.scopes[0]?.scope});
    const diagnostics = original.reportDiagnostics ?? [];
    if (!diagnostics.some(item => item.code === 'review-format-invalid')) throw new Error('Original report has no verified representation error.');
    return bindReportDiagnostics(identity, diagnostics);
};

const zeroCapabilityScore = (/** @type {ExpectedFixture} */ expected) => {
    const scopes = expected.scopes.map(scope => ({scope: scope.scope, earnedCleanPoints: 0, earnedProblemPoints: 0,
        fullProblemCases: 0, passedCleanCases: 0, totalCleanCases: scope.cleanCases.length, totalProblemCases: scope.problemCases.length}));
    return {candidates: [], caseScores: {clean: expected.scopes.map(scope => scope.cleanCases.map(() => 0)),
        problem: expected.scopes.flatMap(scope => scope.problemCases.map(() => 0))}, cleanAcceptanceRate: 0, earnedCleanPoints: 0,
        earnedProblemPoints: 0, fullProblemCases: 0, passedCleanCases: 0, problemDetectionRate: 0, score: 0, scopes,
        semanticProblemHits: 0, totalCleanCases: expected.cleanCount, totalProblemCases: expected.problemCount};
};

const validateResponse = async (/** @type {{adjudicationDecisions: Map<string, string>, artifact: ArtifactInstance, auditInput?: CapabilityAuditInput, commitAuditBindings?: Map<number, Map<number, number | null>>, instance: PreparedScenario, retainScorer: (score: (decisions: Map<string, string>) => CapabilityScore) => void, reviewerId: string, runCommand: RunCommand}} */ {
    adjudicationDecisions, artifact, auditInput, commitAuditBindings, instance, retainScorer, reviewerId, runCommand,
}) => {
    const {expected, instanceId, scenarioRoot} = instance;
    await requireRetainedRequestBinding({instance, reviewerId});
    if (artifact.modelFailure !== undefined) {
        let reportDiagnostics = auditInput?.reportDiagnostics ?? [];
        if (reviewerId === 'spec-readiness-reviewer') {
            const request = await preparedSpecReadinessDraft({expected, scenarioRoot});
            try {
                const report = await readCompleteSpecReadinessCapabilityDraft({inputPath: instance.reportPath,
                    issueId: 'issue:0001:01', repositoryRoot: scenarioRoot, requestPath: request.requestPath,
                    allowRequirementScopeContinuation: instance.scenarioId === 'artifact-promotion'});
                if (report.checks.length > 0) throw new Error('Model failure cannot replace scorable report content.');
                reportDiagnostics = 'reportDiagnostics' in report ? /** @type {ContentDiagnostic[]} */ (report.reportDiagnostics) : [];
            } catch (error) {
                if (!(error instanceof SpecReadinessReviewerDraftFormatError)) throw error;
                reportDiagnostics = error.reportDiagnostics;
            }
        } else if (expected.kind === 'markdown-findings') {
            const report = reviewerCapabilityVerificationCore.parseMarkdownArtifact({response: await readFile(instance.reportPath, 'utf8'),
                reviewerId, scope: expected.scopes[0]?.scope});
            if (report.checks !== undefined) throw new Error('Model failure cannot replace scorable report content.');
            reportDiagnostics = report.reportDiagnostics ?? [];
        }
        const score = () => zeroCapabilityScore(expected);
        retainScorer(score);
        return {...score(), reportDiagnostics};
    }
    const artifactPaths = artifact.formatCorrection === undefined ? artifact.artifactPaths ?? [] : [artifact.formatCorrection.correctedReportPath];
    if (expected.kind === 'spec-readiness-artifact') {
        return validateSpecReadiness({adjudicationDecisions, allowCorrectedReport: artifact.formatCorrection !== undefined, artifactPaths, expected, instance, retainScorer, reviewerId});
    }
    if (expected.kind === 'markdown-findings') {
        if (artifactPaths.length !== 1) return {finding: `${reviewerId} did not return one bound Markdown report.`};
        const parsed = reviewerCapabilityVerificationCore.parseMarkdownArtifact({response: await readFile(artifactPaths[0], 'utf8'), reviewerId, scope: expected.scopes[0]?.scope});
        if (parsed.finding !== undefined) return parsed;
        const evidenceSources = await loadEvidenceSources({expected, scenarioRoot, additionalEvidence: parsed.checks, runCommand});
        const reportDiagnostics = [...parsed.reportDiagnostics];
        for (const finding of parsed.checks.flatMap(check => check.findings)) for (const evidence of finding.evidence) {
            if (!isJsonObject(evidence) || typeof evidence.filePath !== 'string') continue;
            const source = evidenceSources.get(normalizePath(evidence.filePath));
            const end = 'lineEnd' in evidence ? evidence.lineEnd : evidence.line;
            if (source === undefined || typeof end !== 'number' || end > evidenceSourceLineCount(source)) {
                reportDiagnostics.push({code: 'review-evidence-invalid', message: 'Markdown evidence is outside the frozen source.'});
            }
        }
        const scorer = createReviewerCapabilityScenarioScorer({evidenceSources, expected, instanceId, reviewerId, scenarioRoot});
        const score = (/** @type {Map<string, string>} */ decisions) => scorer({adjudicationDecisions: decisions, checks: parsed.checks});
        retainScorer(score);
        return {...score(adjudicationDecisions), reportDiagnostics};
    }
    if (auditInput === undefined) throw new Error('Commit Audit scoring input is unavailable.');
    const evidenceSources = auditInput.evidenceSources ?? await loadEvidenceSources({expected, scenarioRoot, additionalEvidence: auditInput.records, runCommand});
    const parsed = parseCommitAuditRecords({requirementBindings: commitAuditBindings, evidenceSources, expected,
        records: auditInput.records, reviewerId});
    if ('finding' in parsed) return parsed;
    const scorer = createReviewerCapabilityScenarioScorer({evidenceSources, expected, instanceId, reviewerId, scenarioRoot});
    const score = (/** @type {Map<string, string>} */ decisions) => scorer({adjudicationDecisions: decisions,
        checks: parsed.checks, cleanObservations: parsed.cleanObservations});
    retainScorer(score);
    return {...score(adjudicationDecisions), reportDiagnostics: [...auditInput.reportDiagnostics, ...parsed.reportDiagnostics]};
};

const releaseCandidateContext = async (/** @type {{repositoryRoot: string, runCommand: RunCommand, state: PreparedState}} */ {repositoryRoot, runCommand, state}) => {
    if (state.mode !== 'targeted') {
        const result = await resolveReleaseCandidate({
            phase: 'pre-tag',
            remote: 'origin',
            repositoryRoot,
            runCommand: async (file, args, options) => runTextCommand(runCommand, file, args, options),
        });
        if (result.status === 'failed' || result.candidate === undefined) return {failure: result};
        if (!isDeepStrictEqual(deriveAffectedReviewerIds(result.candidate.changedPaths), state.reviewerIds)) {
            return {failure: {
                diagnostics: [{
                    code: 'candidate-scope-drift',
                    message: 'Reviewer capability artifacts do not match the current affected Reviewer set.',
                    stage: 'candidate',
                }],
                status: 'failed',
            }};
        }
        return {candidateTree: result.candidate.tree};
    }
    return {candidateTree: null};
};

const commitAuditRequestBindingFailure = async (/** @type {PreparedScenario} */ instance) => {
    const digest = instance.expected.requestSha256;
    if (typeof instance.requestPath !== 'string' || typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
        return `Commit Audit ${instance.instanceId} original Request content binding is unavailable.`;
    }
    /** @type {Buffer} */
    let bytes;
    try {
        bytes = await readFile(instance.requestPath);
    } catch {
        return `Commit Audit ${instance.instanceId} original Request is unreadable.`;
    }
    if (sha256(bytes) !== digest) return `Commit Audit ${instance.instanceId} original Request changed after prepare.`;
    /** @type {unknown} */
    let request;
    try {
        request = JSON.parse(bytes.toString('utf8'));
    } catch {
        return `Commit Audit ${instance.instanceId} original Request is malformed.`;
    }
    if (!isJsonObject(request) || request.draftPath !== instance.reportPath) {
        return `Commit Audit ${instance.instanceId} original Request no longer binds its report.`;
    }
    return undefined;
};

const contractBindingFailure = async (/** @type {{candidateFiles?: Map<string, Buffer>, candidateTree: string | null, contract: CapabilityContract, item: ArtifactEntry, repositoryRoot: string, runCommand: RunCommand, state: PreparedState}} */ {
    candidateFiles,
    candidateTree,
    contract,
    item,
    repositoryRoot,
    runCommand,
    state,
}) => {
    if (state.mode !== 'targeted') {
        if (candidateTree === null) return failed(`${item.reviewerId} release candidate tree is unavailable.`, item.reviewerId);
        const rolePath = reviewerRolePath(item.reviewerId);
        if (candidateFiles === undefined) return failed(`${item.reviewerId} candidate content batch is unavailable.`, item.reviewerId);
        const roleBytes = candidateFiles.get(rolePath);
        if (roleBytes === undefined) return failed(`${item.reviewerId} canonical Role is unavailable.`, item.reviewerId);
        if (reviewerCapabilityVerificationCore.bindingDrift({
            actual: {roleSha256: sha256(roleBytes)},
            expected: {roleSha256: contract.roleSha256},
        }) === 'role') {
            return failed(`${item.reviewerId} canonical Role changed after prepare.`, item.reviewerId);
        }
        const reviewerBytes = candidateFiles.get(REVIEWER_INSTRUCTIONS_PATH);
        if (reviewerBytes === undefined) return failed(`${item.reviewerId} common Reviewer instructions are unavailable.`, item.reviewerId);
        if (reviewerCapabilityVerificationCore.bindingDrift({
            actual: {reviewerInstructionsSha256: sha256(reviewerBytes)},
            expected: {reviewerInstructionsSha256: contract.reviewerInstructionsSha256},
        }) === 'reviewer-instructions') {
            return failed(`${item.reviewerId} common Reviewer instructions changed after prepare.`, item.reviewerId);
        }
    }
    const scenarioDigests = await Promise.all(contract.instances.map(async scenario => {
        try {
            return {kind: /** @type {'succeeded'} */ ('succeeded'), scenario, scenarioDigest: await calculateScenarioDigest({
                reviewerId: item.reviewerId,
                runCommand,
                scenarioRoot: scenario.scenarioRoot,
            })};
        } catch (error) {
            return {error, kind: /** @type {'failed'} */ ('failed'), scenario};
        }
    }));
    for (const result of scenarioDigests) {
        if (result.kind === 'failed') throw result.error;
        const {scenario, scenarioDigest} = result;
        if (reviewerCapabilityVerificationCore.bindingDrift({
            actual: {scenarioDigests: [scenarioDigest]},
            expected: {scenarioDigests: [scenario.scenarioDigest]},
        }) === 'scenario') {
            return failed(`${item.reviewerId} capability scenario changed after prepare.`, item.reviewerId);
        }
    }
    if (contract.reviewerId === 'commit-audit-reviewer') {
        for (const instance of contract.instances) {
            const finding = await commitAuditRequestBindingFailure(instance);
            if (finding !== undefined) return failed(finding, contract.reviewerId);
        }
    }
    return undefined;
};

const requireRetainedRequestBinding = async (/** @type {{instance: PreparedScenario, reviewerId: string}} */ {instance, reviewerId}) => {
    if (reviewerId === 'spec-readiness-reviewer') {
        const request = await preparedSpecReadinessDraft({expected: instance.expected, scenarioRoot: instance.scenarioRoot});
        if (request.draftPath !== instance.reportPath) {
            throw new Error(`${reviewerId} ${instance.instanceId} retained Request no longer binds its original report.`);
        }
    } else if (reviewerId === 'commit-audit-reviewer') {
        const finding = await commitAuditRequestBindingFailure(instance);
        if (finding !== undefined) throw new Error(finding);
    }
};

const preparePartialCapability = async (/** @type {{agentIdentity: AgentIdentity, issueId?: string, preparedPath: string, repositoryRoot: string, runCommand: RunCommand, selection: unknown}} */ {
    agentIdentity,
    issueId,
    preparedPath,
    repositoryRoot,
    runCommand,
    selection,
}) => {
    if (!isJsonObject(selection) || Object.keys(selection).join(',') !== 'instances'
        || !Array.isArray(selection.instances) || selection.instances.length === 0) {
        throw new Error('Reviewer capability partial selection must contain a nonempty instances array.');
    }
    const workspaceDirectory = await workspaceFor({agentIdentity, issueId, repositoryRoot});
    const sourcePath = resolve(preparedPath);
    preparedRunIdForPath({preparedPath: sourcePath, workspaceDirectory});
    if (comparablePath(await realpath(sourcePath)) !== comparablePath(sourcePath)) {
        throw new Error('Reviewer capability source prepared path must belong to this Main Agent session without a symbolic link.');
    }
    const sourceSha256 = sha256(await readFile(sourcePath));
    const state = await requirePreparedState({agentIdentity, currentRevision: false, expectedSha256: sourceSha256,
        preparedPath: sourcePath, workspaceDirectory});
    /** @type {Map<string, number[]>} */
    const selected = new Map();
    /** @type {Set<string>} */
    const selectedKeys = new Set();
    for (const entry of selection.instances) {
        if (!isJsonObject(entry) || Object.keys(entry).sort(compareText).join(',') !== 'instanceId,reviewerId'
            || typeof entry.reviewerId !== 'string' || typeof entry.instanceId !== 'string') {
            throw new Error('Reviewer capability partial selection entry must identify one Reviewer and current instance.');
        }
        const key = JSON.stringify([entry.reviewerId, entry.instanceId]);
        if (selectedKeys.has(key)) throw new Error('Reviewer capability partial selection contains a duplicate instance.');
        selectedKeys.add(key);
        const contract = state.contracts.find(item => item.reviewerId === entry.reviewerId);
        const index = contract?.instances.findIndex(instance => instance.instanceId === entry.instanceId) ?? -1;
        if (index < 0) throw new Error(`Reviewer capability partial selection contains an unknown current instance: ${entry.reviewerId} ${entry.instanceId}.`);
        selected.set(entry.reviewerId, [...(selected.get(entry.reviewerId) ?? []), index]);
    }
    const candidateContext = await releaseCandidateContext({repositoryRoot, runCommand, state});
    if (candidateContext.failure !== undefined) return candidateContext.failure;
    const candidateTree = candidateContext.candidateTree;
    const candidateFiles = state.mode === 'targeted' || candidateTree === null
        ? undefined
        : await requireCandidateFiles({
            candidateTree,
            files: state.reviewerIds.flatMap(reviewerId => {
                const instructionPaths = REVIEWER_AGENT_INSTRUCTION_PATHS.get(reviewerId);
                if (instructionPaths === undefined) throw new Error(`Unknown Reviewer identity: ${reviewerId}.`);
                return [
                    {filePath: reviewerRolePath(reviewerId), label: `${reviewerId} candidate Role`},
                    ...instructionPaths.map(filePath => ({filePath, label: `${reviewerId} candidate Agent instruction ${filePath}`})),
                ];
            }),
            repositoryRoot,
            runCommand,
        });
    for (const contract of state.contracts) {
        const indexes = new Set(selected.get(contract.reviewerId) ?? []);
        const retained = contract.instances.filter((_, index) => !indexes.has(index));
        if (retained.length === 0) continue;
        if (contract.scenarioRevision !== SCENARIO_REVISIONS.get(contract.reviewerId)) {
            throw new Error(`${contract.reviewerId} retained scenario revision is no longer current; select every instance of this Reviewer.`);
        }
        const bindingFailure = await contractBindingFailure({candidateFiles, candidateTree,
            contract: {...contract, instances: retained}, item: {reviewerId: contract.reviewerId, instances: []},
            repositoryRoot, runCommand, state});
        if (bindingFailure !== undefined) {
            throw new Error(bindingFailure.diagnostics[0]?.message ?? `${contract.reviewerId} retained binding changed.`);
        }
        for (const instance of retained) {
            await requireRetainedRequestBinding({instance, reviewerId: contract.reviewerId});
        }
    }
    const {runDirectory, runId} = await createPreparationRun(workspaceDirectory);
    /** @type {CapabilityContract[]} */
    const contracts = [];
    /** @type {GenerationEntry[]} */
    const generations = [];
    /** @type {ReviewerHandoff[]} */
    const handoffs = [];
    for (const contract of state.contracts) {
        const indexes = [...(selected.get(contract.reviewerId) ?? [])].sort((left, right) => left - right);
        if (indexes.length === 0) {
            contracts.push(contract);
            continue;
        }
        const created = await createCapabilityContract({
            agentIdentity,
            candidateFiles,
            candidateTree: candidateTree ?? 'targeted',
            includeRoleIdentity: state.mode === 'release',
            repositoryRoot,
            reviewerId: contract.reviewerId,
            runCommand,
            runDirectory,
            selectedIndexes: indexes,
        });
        if (created.contract.instances.length !== indexes.length
            || (indexes.length < contract.instances.length
                && !isDeepStrictEqual({...created.contract, instances: []}, {...contract, instances: []}))) {
            throw new Error(`${contract.reviewerId} partial preparation changed its Reviewer contract or selected scope.`);
        }
        const replacements = new Map(indexes.map((index, position) => [index, created.contract.instances[position]]));
        contracts.push({...created.contract, instances: contract.instances.map((instance, index) => replacements.get(index) ?? instance)});
        generations.push(...created.generations);
        handoffs.push(...created.handoffs);
    }
    const preparedPathForRun = await writePreparedCapabilityState({runDirectory, state: {
        contracts,
        mode: state.mode,
        platform: state.platform,
        previousPrepared: {preparedPath: sourcePath, sha256: sourceSha256},
        reviewerIds: state.reviewerIds,
        runId,
    }});
    return {generations, handoffs, preparedPath: preparedPathForRun,
        reviewerIds: state.reviewerIds, status: 'prepared'};
};

const scoreCapabilityInstances = async (/** @type {{adjudicationDecisions: Map<string, string>, auditInputs: Map<string, CapabilityAuditInput>, commitAuditBindings: Map<string, Map<number, Map<number, number | null>>>, contract: CapabilityContract, indexes: number[], item: ArtifactEntry, runCommand: RunCommand}} */ {
    adjudicationDecisions, auditInputs, commitAuditBindings, contract, indexes, item, runCommand,
}) => {
    /** @type {InstanceScore[]} */
    const instanceScores = [];
    /** @type {Map<string, (decisions: Map<string, string>) => CapabilityScore>} */
    const scorers = new Map();
    /** @type {ReportDiagnostic[]} */
    const failures = [];
    for (const [position, artifact] of item.instances.entries()) {
        const index = indexes[position];
        const instance = contract.instances[index];
        try {
            const sourceDiagnostics = artifact.formatCorrection === undefined ? [] : await validateFormatCorrectionSource({
                correction: artifact.formatCorrection, instance, reviewerId: item.reviewerId, runCommand});
            const result = await validateResponse({adjudicationDecisions, artifact,
                auditInput: auditInputs.get(instance.instanceId), commitAuditBindings: commitAuditBindings.get(instance.instanceId),
                instance, retainScorer: scorer => scorers.set(instance.instanceId, scorer), reviewerId: item.reviewerId, runCommand});
            if ('finding' in result) throw new Error(result.finding);
            const {reportDiagnostics, ...score} = result;
            if (artifact.formatCorrection !== undefined && reportDiagnostics.some(item =>
                ['review-format-invalid', 'review-json-invalid', 'review-utf8-invalid'].includes(item.code))) {
                throw new Error('Corrected report still has a representation error.');
            }
            const diagnostics = [...sourceDiagnostics, ...bindReportDiagnostics({instanceId: instance.instanceId, reviewerId: item.reviewerId}, reportDiagnostics)];
            instanceScores.push({artifact, instanceId: instance.instanceId, repetition: capabilityInstancePosition(item.reviewerId, index).repetition,
                reportDiagnostics: diagnostics, result: score, reviewerId: item.reviewerId, scenarioId: instance.scenarioId ?? 'default'});
        } catch (error) {
            failures.push({code: 'scoring-input-invalid', instanceId: instance.instanceId, reviewerId: item.reviewerId,
                message: error instanceof Error ? error.message : String(error)});
        }
    }
    return {failures, instanceScores, scorers};
};

const capabilityInstanceDetails = (/** @type {InstanceScore} */ instance) => {
    const {candidates: unusedCandidates, semanticProblemHits: unusedSemanticProblemHits, ...details} = instance.result;
    return {instanceId: instance.instanceId, repetition: instance.repetition, scenarioId: instance.scenarioId,
        ...details, reportDiagnostics: instance.reportDiagnostics,
        ...capabilityMeasurementDetails(instance.artifact.measurement),
        ...(instance.artifact.modelFailure === undefined ? {} : {modelFailure: instance.artifact.modelFailure}),
        ...(instance.artifact.formatCorrection === undefined ? {} : {formatCorrection: instance.artifact.formatCorrection})};
};

/** Measurement is optional observation, never a scoring or validity prerequisite. @param {unknown} source */
const capabilityMeasurementDetails = source => {
    if (!isJsonObject(source)) return {measurement:null,measurementExplanation:'Reviewer measurement was not supplied.'};
    try {
        const measurement = /** @type {ReviewerMeasurementResult} */ (/** @type {unknown} */ (source));
        if (!isJsonObject(measurement.usage)) throw new Error('Native token observations are unavailable.');
        return {measurement:{wallClockMs:measurement.wallClockMs ?? null,usage:measurement.usage,
            ...(measurement.workDuration === undefined ? {} : {workDuration:measurement.workDuration}),
            ...(measurement.modelPhases === undefined ? {} : {modelPhases:measurement.modelPhases}),
            rates:reviewerMeasurementRates(measurement)}};
    } catch (error) {
        return {measurement:null,measurementExplanation:error instanceof Error ? error.message : 'Reviewer measurement is unavailable.'};
    }
};

const summarizeCapabilityScores = (/** @type {{contract: CapabilityContract, instanceScores: InstanceScore[]}} */ {contract, instanceScores}) => {
    const scenarioCount = contract.reviewerId === 'spec-readiness-reviewer' ? SPEC_READINESS_SCENARIOS.length : 1;
    const repetitions = [];
    for (let repetition = 1; repetition <= CAPABILITY_INSTANCE_COUNT; repetition += 1) {
        const paired = instanceScores.filter(instance => instance.repetition === repetition);
        if (paired.length !== scenarioCount) continue;
        const result = reviewerCapabilityVerificationCore.combineScenarios(paired.map(instance => instance.result));
        const {candidates: unusedCandidates, semanticProblemHits: unusedHits, score: scoreBeforePenalty, ...details} = result;
        const reportDiagnostics = paired.flatMap(instance => instance.reportDiagnostics);
        repetitions.push({repetition, ...details, instances: paired.map(capabilityInstanceDetails), reportDiagnostics,
            scoreBeforePenalty, score: reportDiagnostics.length > 0 ? scoreBeforePenalty * 0.9 : scoreBeforePenalty});
    }
    const aggregate = reviewerCapabilityVerificationCore.aggregateRepetitionScores({
        repetitionScores: repetitions.map(repetition => ({repetition: repetition.repetition, score: repetition.scoreBeforePenalty})),
        penaltyRepetitions: repetitions.filter(repetition => repetition.reportDiagnostics.length > 0).map(repetition => repetition.repetition),
        totalRepetitions: CAPABILITY_INSTANCE_COUNT});
    const repetitionScores = aggregate.repetitionScores.map(item => item.score);
    const finalRepetitionScores = aggregate.finalRepetitionScores.map(item => item.score);
    return {reviewerId: contract.reviewerId, instances: instanceScores.map(capabilityInstanceDetails), repetitions,
        repetitionScores, finalRepetitionScores, reportDiagnostics: instanceScores.flatMap(instance => instance.reportDiagnostics),
        ...(aggregate.scoreBeforePenalty === undefined ? {} : {scoreBeforePenalty: aggregate.scoreBeforePenalty, score: aggregate.score}),
        scoreExplanation: `${aggregate.score === undefined ? 'Incomplete repetition set.' : `Final score: ${aggregate.score.toFixed(3)}. Score before penalty: ${aggregate.scoreBeforePenalty?.toFixed(3)}.`} Repetition scores before penalty: ${repetitionScores.map(value => value.toFixed(3)).join(', ')}. Final repetition scores: ${finalRepetitionScores.map(value => value.toFixed(3)).join(', ')}. Report errors: ${instanceScores.flatMap(instance => instance.reportDiagnostics).map(item => `${item.instanceId}: ${item.message}`).join(' ') || 'None.'}`};
};

/** @typedef {{actualIndexes: number[], actualRequirements: unknown[], expectedIndexes: number[], expectedRequirements: AuditRequirement[], instanceId: string, recordIndex: number, source: FixtureLocator}} RequirementBindingRequest */
const prepareCommitAuditBindings = (/** @type {{contract: CapabilityContract, indexes: number[], item: ArtifactEntry, auditInputs: Map<string, CapabilityAuditInput>}} */ {
    contract, indexes, item, auditInputs,
}) => {
    /** @type {Map<string, Map<number, Map<number, number | null>>>} */
    const bindings = new Map();
    /** @type {RequirementBindingRequest[]} */
    const requests = [];
    for (const [position, artifact] of item.instances.entries()) {
        if (artifact.modelFailure !== undefined) continue;
        const instance = contract.instances[indexes[position]];
        const records = instance.expected.auditRecords;
        const auditInput = auditInputs.get(instance.instanceId);
        const actualRecords = auditInput?.records;
        if (records === undefined || actualRecords === undefined || records.length !== actualRecords.length) throw new Error('Commit Audit requirement input is incomplete.');
        const byRecord = new Map();
        for (const [recordIndex, expectedRecord] of records.entries()) {
            const record = actualRecords[recordIndex];
            if (!isJsonObject(record) || !Array.isArray(record.requirements)) throw new Error('Commit Audit requirements are unavailable.');
            const actualRequirements = record.requirements;
            const byExpected = new Map();
            const groups = commitAuditRequirementGroups({actualRequirements, evidenceSources: auditInput?.evidenceSources ?? new Map(),
                expectedRequirements: expectedRecord.requirements});
            for (const group of groups.values()) {
                if (uniquePreferredAuditAssignments(group) !== undefined) continue;
                const expectedIndexes = group.expectedEntries.map(entry => entry.index);
                const actualIndexes = group.actualEntries.map(entry => entry.index);
                if (expectedIndexes.length === 1) {
                    byExpected.set(expectedIndexes[0], null);
                    continue;
                }
                requests.push({actualIndexes, actualRequirements: actualIndexes.map(index => actualRequirements[index]),
                    expectedIndexes, expectedRequirements: expectedIndexes.map(index => expectedRecord.requirements[index]),
                    instanceId: instance.instanceId, recordIndex, source: expectedRecord.requirements[expectedIndexes[0]].source});
            }
            if (byExpected.size > 0) byRecord.set(recordIndex, byExpected);
        }
        if (byRecord.size > 0) bindings.set(instance.instanceId, byRecord);
    }
    return {bindings, requests};
};

const completeCommitAuditBindings = (/** @type {{bindings: Map<string, Map<number, Map<number, number | null>>>, input: unknown, requests: RequirementBindingRequest[]}} */ {bindings, input, requests}) => {
    if (requests.length === 0) return input === undefined ? undefined : 'Requirement bindings were supplied without an abnormal shared source.';
    if (!isJsonObject(input) || Object.keys(input).join(',') !== 'bindings' || !Array.isArray(input.bindings)) return 'Requirement bindings must contain a bindings array.';
    const required = new Map(requests.flatMap(request => request.expectedIndexes.map(expectedIndex => [
        `${request.instanceId}:${request.recordIndex}:${expectedIndex}`, request])));
    const seen = new Set();
    const usedActual = new Set();
    for (const entry of input.bindings) {
        if (!isJsonObject(entry) || Object.keys(entry).sort(compareText).join(',') !== 'actualIndex,expectedIndex,instanceId,recordIndex'
            || typeof entry.instanceId !== 'string'
            || typeof entry.recordIndex !== 'number' || !Number.isSafeInteger(entry.recordIndex) || entry.recordIndex < 0
            || typeof entry.expectedIndex !== 'number' || !Number.isSafeInteger(entry.expectedIndex) || entry.expectedIndex < 0
            || (entry.actualIndex !== null && (typeof entry.actualIndex !== 'number' || !Number.isSafeInteger(entry.actualIndex) || entry.actualIndex < 0))) return 'Requirement binding entry is malformed.';
        const key = `${entry.instanceId}:${entry.recordIndex}:${entry.expectedIndex}`;
        const request = required.get(key);
        if (request === undefined || seen.has(key)) return 'Requirement bindings must cover each abnormal expected requirement exactly once.';
        seen.add(key);
        if (entry.actualIndex !== null) {
            if (!request.actualIndexes.includes(entry.actualIndex)) return 'Requirement binding refers to a different source or instance.';
            const actualKey = `${entry.instanceId}:${entry.recordIndex}:${entry.actualIndex}`;
            if (usedActual.has(actualKey)) return 'Requirement bindings reuse one original row.';
            usedActual.add(actualKey);
        }
        const byRecord = bindings.get(entry.instanceId) ?? new Map();
        const byExpected = byRecord.get(entry.recordIndex) ?? new Map();
        byExpected.set(entry.expectedIndex, entry.actualIndex);
        byRecord.set(entry.recordIndex, byExpected);
        bindings.set(entry.instanceId, byRecord);
    }
    return seen.size === required.size ? undefined : 'Requirement bindings do not cover every abnormal expected requirement.';
};

const preparedSpecReadinessDraft = async (/** @type {{expected: ExpectedFixture, scenarioRoot: string}} */ {expected, scenarioRoot}) => {
    if (!isJsonObject(expected.request) || typeof expected.request.filePath !== 'string') throw new Error('Prepared Spec Readiness Request binding is unavailable.');
    const requestPath = join(scenarioRoot, ...expected.request.filePath.split('/'));
    const sources = await readSpecReadinessEvidenceSources({issueId: 'issue:0001:01', repositoryRoot: scenarioRoot, requestPath});
    if (!isDeepStrictEqual(sources.request, expected.request)) throw new Error('Prepared Spec Readiness Request binding changed.');
    const request = JSON.parse(await readFile(requestPath, 'utf8'));
    if (!isJsonObject(request) || typeof request.draftPath !== 'string') throw new Error('Prepared Spec Readiness Request draft binding is malformed.');
    return {draftPath: request.draftPath, requestPath};
};

const verifyReviewerCapabilityConformanceCore = async (/** @type {VerifyInput & {partial?: boolean}} */ {
    adjudication, agentIdentity, input, issueId, partial = false, preparedPath, repositoryRoot,
    requirementBindings, runCommand = defaultRunCommand,
}) => {
    if (typeof preparedPath !== 'string' || preparedPath.length === 0) throw new Error('Reviewer capability scoring requires an explicit prepared path.');
    const root = resolve(repositoryRoot);
    const workspaceDirectory = await workspaceFor({agentIdentity, issueId, repositoryRoot: root});
    const state = await requirePreparedState({agentIdentity, preparedPath, workspaceDirectory});
    if (partial && (state.mode !== 'targeted' || state.contracts.length !== 1)) return failed('Partial scoring requires one prepared targeted Reviewer batch.');
    // Preserve the existing closed scoring input. Optional observations stay bound
    // to the same outer prepared record, role and instance, without entering gates.
    /** @type {Map<string,unknown>} */
    const measurements = new Map();
    if (isJsonObject(input) && Array.isArray(input.artifacts)) {
        input = {...input,artifacts:input.artifacts.map(raw => {
            if (!isJsonObject(raw) || !Array.isArray(raw.instances)) return raw;
            return {...raw,instances:raw.instances.map(instance => {
                if (!isJsonObject(instance) || !Object.hasOwn(instance,'measurement')) return instance;
                const {measurement,...artifact} = instance;
                measurements.set(`${String(raw.reviewerId)}\0${String(instance.instanceId)}`,measurement);
                return artifact;
            })};
        })};
    }
    const identityFinding = reviewerCapabilityVerificationCore.artifactIdentityFailure({input, reviewerIds: state.reviewerIds});
    if (identityFinding !== undefined) return failed(identityFinding);
    const candidateContext = await releaseCandidateContext({repositoryRoot: root, runCommand, state});
    if (candidateContext.failure !== undefined) return candidateContext.failure;
    const candidateTree = candidateContext.candidateTree;
    const candidateFiles = state.mode === 'targeted' || candidateTree === null ? undefined : await requireCandidateFiles({candidateTree,
        files: state.reviewerIds.flatMap(reviewerId => [{filePath: reviewerRolePath(reviewerId), label: `${reviewerId} candidate Role`},
            {filePath: REVIEWER_INSTRUCTIONS_PATH, label: 'candidate Reviewer instructions'}]), repositoryRoot: root, runCommand});
    const rawArtifacts = /** @type {{artifacts: unknown[]}} */ (input).artifacts;
    const selected = [];
    /** @type {Map<string, CapabilityAuditInput>} */
    const auditInputs = new Map();
    /** @type {ReportDiagnostic[]} */
    const inputFailures = [];
    /** @type {Map<string, Map<number, Map<number, number | null>>>} */
    const commitAuditBindings = new Map();
    /** @type {RequirementBindingRequest[]} */
    const bindingRequests = [];
    for (const [position, contract] of state.contracts.entries()) {
        const rawItem = rawArtifacts[position];
        const subset = partial ? reviewerCapabilityVerificationCore.selectCompletedRepetitions({allowEmpty: true, contract, item: rawItem,
            scenarioCount: contract.reviewerId === 'spec-readiness-reviewer' ? SPEC_READINESS_SCENARIOS.length : 1})
            : {indexes: contract.instances.map((_, index) => index)};
        if ('finding' in subset) return failed(subset.finding, contract.reviewerId);
        const entry = reviewerCapabilityVerificationCore.validateArtifactBatch({contract: {...contract,
            instances: subset.indexes.map(index => contract.instances[index])}, item: rawItem, repositoryRoot: root});
        if (entry.finding !== undefined || entry.item === undefined) return failed(entry.finding ?? 'Artifact entry is unavailable.', contract.reviewerId);
        const item = /** @type {ArtifactEntry} */ (entry.item);
        for (const artifact of item.instances) {
            const observed = measurements.get(`${item.reviewerId}\0${artifact.instanceId}`);
            if (observed !== undefined) artifact.measurement = /** @type {ReviewerMeasurementResult} */ (observed);
        }
        const bindingFailure = await contractBindingFailure({candidateFiles, candidateTree, contract, item, repositoryRoot: root, runCommand, state});
        if (bindingFailure !== undefined) return bindingFailure;
        selected.push({contract, indexes: subset.indexes, item});
        if (contract.reviewerId !== 'commit-audit-reviewer') continue;
        for (const [artifactIndex, artifact] of item.instances.entries()) {
            const instance = contract.instances[subset.indexes[artifactIndex]];
            try {
                /** @type {CapabilityAuditInput} */
                const auditInput = await readCapabilityAuditInput({artifact, instance, reviewerId: contract.reviewerId, runCommand});
                if (artifact.modelFailure === undefined && instance.expected.auditRecords?.some(record => (
                    new Set(record.requirements.map(requirement => locatorKey(requirement.source))).size < record.requirements.length
                ))) {
                    auditInput.evidenceSources = await loadEvidenceSources({expected: instance.expected, scenarioRoot: instance.scenarioRoot,
                        additionalEvidence: auditInput.records, runCommand});
                }
                auditInputs.set(instance.instanceId, auditInput);
            } catch (error) {
                inputFailures.push({code: 'scoring-input-invalid', instanceId: instance.instanceId, reviewerId: contract.reviewerId,
                    message: error instanceof Error ? error.message : String(error)});
            }
        }
        const available = item.instances.flatMap((artifact, index) => auditInputs.has(artifact.instanceId) ? [index] : []);
        const prepared = prepareCommitAuditBindings({contract, indexes: available.map(index => subset.indexes[index]),
            item: {instances: available.map(index => item.instances[index]), reviewerId: item.reviewerId}, auditInputs});
        for (const [instanceId, binding] of prepared.bindings) commitAuditBindings.set(instanceId, binding);
        bindingRequests.push(...prepared.requests);
    }
    if (bindingRequests.length > 0 && requirementBindings === undefined) return {bindingRequests, status: 'needs-requirement-binding'};
    const bindingFinding = completeCommitAuditBindings({bindings: commitAuditBindings, input: requirementBindings, requests: bindingRequests});
    if (bindingFinding !== undefined) return failed(bindingFinding);
    /** @type {Array<{contract: CapabilityContract, instanceScores: InstanceScore[], scorers: Map<string, (decisions: Map<string, string>) => CapabilityScore>}>} */
    const evaluations = [];
    for (const selection of selected) {
        const available = selection.item.instances.flatMap((artifact, index) => inputFailures.some(failure => failure.instanceId === artifact.instanceId
            && failure.reviewerId === selection.item.reviewerId) ? [] : [index]);
        const scored = await scoreCapabilityInstances({adjudicationDecisions: new Map(), auditInputs, commitAuditBindings,
            ...selection, indexes: available.map(index => selection.indexes[index]),
            item: {instances: available.map(index => selection.item.instances[index]), reviewerId: selection.item.reviewerId}, runCommand});
        inputFailures.push(...scored.failures);
        evaluations.push({...selection, ...scored});
    }
    const candidates = evaluations.flatMap(evaluation => evaluation.instanceScores.flatMap(instance => instance.result.candidates));
    const reportDiagnostics = evaluations.flatMap(evaluation => evaluation.instanceScores.flatMap(instance => instance.reportDiagnostics));
    const summaries = () => evaluations.map(evaluation => summarizeCapabilityScores({contract: evaluation.contract, instanceScores: evaluation.instanceScores}));
    if (adjudication !== undefined) {
        const validated = reviewerCapabilityVerificationCore.validateAdjudication({adjudication, candidates});
        if ('finding' in validated || candidates.length === 0) return failed('finding' in validated ? validated.finding : 'Adjudication was supplied without candidates.');
        for (const evaluation of evaluations) for (const instance of evaluation.instanceScores) {
            const score = evaluation.scorers.get(instance.instanceId);
            if (score === undefined) throw new Error('Retained instance scorer is unavailable.');
            instance.result = score(validated.decisions);
        }
    }
    if (inputFailures.length > 0) return {status: 'failed', diagnostics: [...inputFailures, ...reportDiagnostics],
        ...(candidates.length === 0 || adjudication !== undefined ? {} : {candidates}),
        results: summaries().map(({score: unusedScore, scoreBeforePenalty: unusedBefore, ...result}) => result)};
    if (candidates.length > 0 && adjudication === undefined) return {candidates, results: summaries(), reviewerIds: state.reviewerIds,
        diagnostics: reportDiagnostics, status: 'needs-adjudication'};
    const results = summaries();
    if (partial) return {results, reviewerIds: state.reviewerIds, diagnostics: reportDiagnostics, status: 'diagnostic'};
    const result = reviewerCapabilityVerificationCore.capabilityGateResult({results, reviewerIds: state.reviewerIds});
    return {...result, diagnostics: [...('diagnostics' in result ? result.diagnostics ?? [] : []), ...reportDiagnostics]};
};

export const verifyReviewerCapabilityConformance = async (/** @type {VerifyInput} */ input) => verifyReviewerCapabilityConformanceCore(input);

/** 局部观察复用完整验证的适配与评分, 只展示齐备重复, 不提供批次授权. */
export const scoreReviewerCapabilityCompletedRepetitions = async (/** @type {VerifyInput} */ input) => (
    verifyReviewerCapabilityConformanceCore({...input, partial: true})
);

export const verifyReviewerCapabilityRelease = async (/** @type {VerifyInput} */ input) => {
    try {
        const result = await verifyReviewerCapabilityConformance(input);
        if (result.status !== 'verified') return reviewerCapabilityVerificationCore.releaseVerificationResult({result});
        const root = resolve(input.repositoryRoot);
        if (input.preparedPath === undefined) throw new Error('Reviewer capability release verification requires an explicit prepared path.');
        const workspaceDirectory = await workspaceFor({
            agentIdentity: input.agentIdentity,
            issueId: input.issueId,
            repositoryRoot: root,
        });
        const state = await requirePreparedState({
            agentIdentity: input.agentIdentity,
            preparedPath: input.preparedPath,
            workspaceDirectory,
        });
        return reviewerCapabilityVerificationCore.releaseVerificationResult({preparedMode: state.mode, result});
    } catch (error) {
        return reviewerCapabilityVerificationCore.closedOperationFailure({code: 'verify-failed', error});
    }
};

const USAGE = 'Usage: node scripts/reviewer-capability-conformance.mjs prepare [--reviewer <identity> | --prepared <prepared-path> --input <selection-path>] | verify --prepared <prepared-path> --input <artifacts-path> [--requirement-bindings <bindings-path>] [--adjudication <decisions-path>] | score-completed --prepared <prepared-path> --input <artifacts-path> [--requirement-bindings <bindings-path>] [--adjudication <decisions-path>]\n';
const defaultReadInput = async (/** @type {import("fs").PathLike | import("fs/promises").FileHandle} */ path) => JSON.parse(await readFile(path, 'utf8'));

/**
 * 执行 Reviewer Capability Conformance maintenance CLI 的 prepare, verify 或局部评分观察语法.
 * 成功时向 stdout 写一个 canonical JSON result. Usage error 返回 `2`; 评分失败, 裁决停点或操作错误向 stderr 写准确诊断并返回 `1`.
 */
export const runReviewerCapabilityConformanceCli = async (/** @type {string[]} */ args, /** @type {{agentIdentity?: AgentIdentity, prepare?: typeof prepareReviewerCapabilityConformance, readInput?: typeof defaultReadInput, repositoryRoot: string, scoreCompleted?: typeof scoreReviewerCapabilityCompletedRepetitions, stderr?: (value: string | Uint8Array) => unknown, stdout?: (value: string | Uint8Array) => unknown, verify?: typeof verifyReviewerCapabilityConformance}} */ {
    agentIdentity = undefined,
    prepare = prepareReviewerCapabilityConformance,
    readInput = defaultReadInput,
    repositoryRoot,
    scoreCompleted = scoreReviewerCapabilityCompletedRepetitions,
    stderr = (/** @type {string | Uint8Array<ArrayBufferLike>} */ value) => process.stderr.write(value),
    stdout = (/** @type {string | Uint8Array<ArrayBufferLike>} */ value) => process.stdout.write(value),
    verify = verifyReviewerCapabilityConformance,
}) => {
    const releasePrepareOperation = args.length === 1 && args[0] === 'prepare';
    const targetedPrepareOperation = args.length === 3
        && args[0] === 'prepare'
        && args[1] === '--reviewer'
        && args[2].length > 0;
    const partialPrepareOperation = args.length === 5
        && args[0] === 'prepare'
        && args[1] === '--prepared'
        && args[2].length > 0
        && args[3] === '--input'
        && args[4].length > 0;
    const scoringOptions = new Map();
    let scoringOperation = args.length >= 5 && args.length <= 9 && args.length % 2 === 1
        && ['verify', 'score-completed'].includes(args[0])
        && args[1] === '--prepared' && args[2].length > 0
        && args[3] === '--input' && args[4].length > 0;
    if (scoringOperation) for (let index = 5; index < args.length; index += 2) {
        const option = args[index];
        if (!['--requirement-bindings', '--adjudication'].includes(option)
            || scoringOptions.has(option) || !args[index + 1]) {
            scoringOperation = false;
            break;
        }
        scoringOptions.set(option, args[index + 1]);
    }
    if (!releasePrepareOperation && !targetedPrepareOperation && !partialPrepareOperation && !scoringOperation) {
        stderr(USAGE);
        return 2;
    }
    try {
        const identity = agentIdentity ?? createCurrentPlatformAdapter().getCurrentAgentIdentity();
        const result = releasePrepareOperation || targetedPrepareOperation || partialPrepareOperation
            ? await prepare({
                agentIdentity: identity,
                repositoryRoot,
                reviewerId: targetedPrepareOperation ? args[2] : undefined,
                ...(partialPrepareOperation ? {preparedPath: args[2], selection: await readInput(args[4])} : {}),
            })
            : await (args[0] === 'score-completed' ? scoreCompleted : verify)({
                adjudication: scoringOptions.has('--adjudication') ? await readInput(scoringOptions.get('--adjudication')) : undefined,
                requirementBindings: scoringOptions.has('--requirement-bindings') ? await readInput(scoringOptions.get('--requirement-bindings')) : undefined,
                agentIdentity: identity, input: await readInput(args[4]), preparedPath: args[2], repositoryRoot,
            });
        if ('status' in result && (result.status === 'failed' || result.status === 'needs-adjudication'
            || result.status === 'needs-requirement-binding')) {
            stderr(serializeCanonicalJson(result));
            return 1;
        }
        stdout(serializeCanonicalJson(result));
        return 0;
    } catch (error) {
        stderr(`reviewer-capability-conformance-failed: ${JSON.stringify(error instanceof Error ? error.message : String(error)).slice(1, -1)}\n`);
        return 1;
    }
};
