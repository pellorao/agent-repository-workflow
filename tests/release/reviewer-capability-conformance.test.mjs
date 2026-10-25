import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {readFile, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import test, {after} from 'node:test';

import {createMockGitRepository} from '../helpers/mock-git.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {runExitedProcess} from '../helpers/process.mjs';
import {createScriptedReviewerSessions} from '../helpers/reviewer-runtime-adapter.mjs';
import {
    auditCleanCoverageAssignments,
    createCandidateContentGitAdapter,
    createCandidateFilesReader,
    deriveAffectedReviewerIds,
    prepareReviewerCapabilityConformance as prepareReviewerCapabilityConformanceImplementation,
    runReviewerCapabilityConformanceCli,
    scoreReviewerCapabilityCompletedRepetitions as scoreReviewerCapabilityCompletedRepetitionsImplementation,
    verifyReviewerCapabilityConformance as verifyReviewerCapabilityConformanceImplementation,
} from '../../lib/release/reviewer-capability-conformance.mjs';
import {generateCommitAudit, validateCommitAuditReview} from '../../lib/commit-audit/commit-audit.mjs';
import {createBackgroundAgentHost} from '../../lib/arw-background-agent-host.mjs';
import {createNodeGitRunner} from '../../lib/common/git-process.mjs';
import {REVIEWER_IDS} from '../../lib/release/reviewer-capability-identities.mjs';
import {createReviewerCapabilityScenarioScorer} from '../../lib/release/reviewer-capability-scoring.mjs';
import {aggregateConfiguration} from '../../lib/reviewer-benchmark/statistics.mjs';
import {renderTablesHtml} from '../../lib/reviewer-benchmark/statistics-presentation.mjs';
import {upsertStatisticsRole} from '../../lib/reviewer-benchmark/statistics-storage.mjs';
import {generateSpecReadiness} from '../../lib/spec-readiness/spec-readiness.mjs';

/** @typedef {{anchor?: string, filePath: string, line?: number}} EvidenceLocator */
/** @typedef {{associationEvidence: EvidenceLocator[], check: string, evidence: EvidenceLocator[]}} Placement */
/** @typedef {{associationEvidence?: EvidenceLocator[], evidence?: EvidenceLocator[], expectation: string, findingTerms: Array<string | string[]>, placements?: Placement[], requirementSource?: string, result: string}} ProblemCase */
/** @typedef {{evidence: EvidenceLocator[], evidenceAlternatives?: EvidenceLocator[][], expectation: string, findingTerms: Array<string | string[]>, noOtherSupportedFinding?: false, requirementSource?: string} | {noOtherSupportedFinding: true}} CleanCase */
/** @typedef {{cleanCases: CleanCase[], problemCases: ProblemCase[], scope: string}} ExpectedScope */
/** @typedef {{documents?: string[], pathSuffix: string, requirements: Array<{evidence: EvidenceLocator[], result: string, source: EvidenceLocator}>, result: string}} AuditRecord */
/** @typedef {{auditRecords?: AuditRecord[], authorizingIssueIds?: string[], cleanCount: number, kind: string, problemCount: number, request?: unknown, scopes: ExpectedScope[]}} PreparedExpected */
/** @typedef {Record<string, unknown>} JsonObject */
/** @typedef {Extract<Awaited<ReturnType<typeof prepareReviewerCapabilityConformanceImplementation>>, {preparedPath: string}>} PreparedConformance */
/** @typedef {{candidateId: string, check: string, evidence: unknown[], expectation: string, finding: string, findingIndex: number, instanceId: string, problemCaseIndex: number, problemScope: string, result: string, reviewerId: string}} VerificationCandidate */
/** @typedef {{code: string, instanceId?: string, line?: number, message: string}} ReportDiagnostic */
/** @typedef {{caseScores: {problem: number[], clean: number[][]}, earnedCleanPoints: number, earnedProblemPoints: number, passedCleanCases: number, totalCleanCases: number, totalProblemCases: number, scopes: Array<{earnedCleanPoints: number, scope: string}>}} CaseScoreDetails */
/** @typedef {CaseScoreDetails & {instanceId: string, repetition: number, reportDiagnostics: ReportDiagnostic[], modelFailure?: {reason: string}}} InstanceScore */
/** @typedef {CaseScoreDetails & {repetition: number, instances: InstanceScore[], score: number, scoreBeforePenalty: number, reportDiagnostics: ReportDiagnostic[]}} RepetitionScore */
/** @typedef {{finalRepetitionScores: number[], instances: InstanceScore[], repetitions: RepetitionScore[], reportDiagnostics: ReportDiagnostic[], repetitionScores: number[], reviewerId: string, score?: number, scoreExplanation: string, scoreGate?: string, scoreBeforePenalty?: number}} ReviewerScore */
/** @typedef {{candidates?: VerificationCandidate[], diagnostics?: Array<{code?: string, instanceId?: string, message?: string}>, results?: ReviewerScore[], bindingRequests?: Array<{instanceId: string, expectedIndexes: number[], actualIndexes: number[]}>, reviewerIds?: string[], status: string}} VerifiedConformance */
/** @typedef {{expected: PreparedExpected, instanceId: string, reportPath: string, requestPath?: string, resultPath?: string, scenarioDigest: string, scenarioId?: string, scenarioRoot: string}} PreparedInstance */
/** @typedef {{instances: PreparedInstance[], platform: string, reviewerId: string, reviewerInstructionsSha256?: string, roleSha256?: string, scenarioRevision: number}} PreparedContract */
/** @typedef {{contracts: PreparedContract[], mode: string, platform: string, previousPrepared?: {preparedPath: string, sha256: string}, reviewerIds: string[], runId: string}} PreparedState */
/** @typedef {{evidence: EvidenceLocator[], finding: string, requirementSource?: string, result: string}} ReadinessFinding */
/** @typedef {{artifactPaths: string[] | null, formatCorrection?: {originalReportPath: string, correctedReportPath: string}, modelFailure?: {reason: string}, instanceId: string}} CapabilityArtifact */
/** @typedef {{instances: CapabilityArtifact[], reviewerId: string}} CapabilityArtifactBatch */

/**
 * @template T
 * @param {T | null | undefined} value
 * @param {string} message
 * @returns {T}
 */
const requireValue = (value, message) => {
    if (value === undefined || value === null) throw new Error(message);
    return value;
};

const candidateBatchOutput = (/** @type {Array<{bytes: Buffer, specification: string}>} */ entries) => Buffer.concat(entries.flatMap(({bytes}, index) => [
    Buffer.from(`${String(index + 1).padStart(40, '0')} blob ${bytes.length}\n`, 'ascii'),
    bytes,
    Buffer.from('\n', 'ascii'),
]));

const agentIdentity = {platform: 'codex', sessionId: 'reviewer-capability-test'};
const fixtureSource = join(process.cwd(), 'tests', 'fixtures', 'reviewer-capability');
/** @type {Map<string, NonNullable<Parameters<typeof prepareReviewerCapabilityConformanceImplementation>[0]['runCommand']>>} */
const sharedRunCommands = new Map();

/**
 * @template {{repositoryRoot: string, runCommand?: unknown}} T
 * @param {T} input
 * @returns {T}
 */
const withSharedRunCommand = input => input.runCommand !== undefined || !sharedRunCommands.has(input.repositoryRoot)
    ? input
    : {...input, runCommand: sharedRunCommands.get(input.repositoryRoot)};

/** @returns {Promise<PreparedConformance>} */
const prepareReviewerCapabilityConformance = async (/** @type {Parameters<typeof prepareReviewerCapabilityConformanceImplementation>[0]} */ input) => {
    const result = await prepareReviewerCapabilityConformanceImplementation(withSharedRunCommand(input));
    if (!('preparedPath' in result)) throw new Error('Reviewer capability preparation did not succeed.');
    return result;
};

/** @returns {Promise<PreparedState>} */
const readPreparedState = async (/** @type {string} */ path) => {
    const state = JSON.parse(await readFile(path, 'utf8'));
    if (state === null || typeof state !== 'object' || !Array.isArray(state.contracts)) {
        throw new Error('Expected prepared Reviewer capability state.');
    }
    return state;
};

/** @returns {Promise<VerifiedConformance>} */
const rawVerifyReviewerCapabilityConformance = (/** @type {Parameters<typeof verifyReviewerCapabilityConformanceImplementation>[0]} */ input) => {
    /** @type {unknown} */
    const implementation = verifyReviewerCapabilityConformanceImplementation;
    if (typeof implementation !== 'function') throw new Error('Expected Reviewer capability verification implementation.');
    return Reflect.apply(implementation, undefined, [withSharedRunCommand(input)]);
};

/** @returns {Promise<VerifiedConformance>} */
const scoreReviewerCapabilityCompletedRepetitions = (/** @type {Parameters<typeof scoreReviewerCapabilityCompletedRepetitionsImplementation>[0]} */ input) => {
    /** @type {unknown} */
    const implementation = scoreReviewerCapabilityCompletedRepetitionsImplementation;
    if (typeof implementation !== 'function') throw new Error('Expected completed-repetition scoring implementation.');
    return Reflect.apply(implementation, undefined, [withSharedRunCommand(input)]);
};

const reviewerScore = (/** @type {VerifiedConformance} */ result) => requireValue(result.results?.[0], 'Expected Reviewer score.');

const fixtureSeed = (/** @type {{findingTerms: Array<string | string[]>}} */ entry) => entry.findingTerms
    .map(group => Array.isArray(group) ? group[0] : group)
    .join(' and ');

const fixtureCandidateDecisions = async (/** @type {Parameters<typeof verifyReviewerCapabilityConformanceImplementation>[0]} */ input, /** @type {VerificationCandidate[]} */ candidates) => {
    const state = await readPreparedState(requireValue(input.preparedPath, 'Expected prepared path.'));
    const decisions = [];
    for (const candidate of candidates) {
        const contract = requireValue(state.contracts.find(entry => entry.reviewerId === candidate.reviewerId), 'Expected contract.');
        const instance = requireValue(contract.instances.find(entry => entry.instanceId === candidate.instanceId), 'Expected instance.');
        const target = requireValue(
            instance.expected.scopes.find(entry => entry.scope === candidate.problemScope)?.problemCases[candidate.problemCaseIndex - 1],
            'Expected problem.',
        );
        assert.equal(candidate.expectation, target.expectation);
        assert.equal(typeof candidate.finding, 'string');
        assert.ok(Array.isArray(candidate.evidence));
        assert.ok(candidate.result === 'gap' || candidate.result === 'uncertain');
        decisions.push({
            candidateId: candidate.candidateId,
            decision: candidate.finding.includes(fixtureSeed(target)) ? 'matched' : 'not-matched',
            reason: 'Explicit synthetic fixture text identifies the intended problem independently of evidence pairing.',
        });
    }
    return decisions;
};

/** @returns {Promise<VerifiedConformance>} */
const verifyReviewerCapabilityConformance = async (/** @type {Parameters<typeof verifyReviewerCapabilityConformanceImplementation>[0]} */ input) => {
    if (input.adjudication !== undefined) return rawVerifyReviewerCapabilityConformance(input);
    const provisional = await rawVerifyReviewerCapabilityConformance(input);
    if (provisional.status !== 'needs-adjudication') return provisional;
    const candidates = requireValue(provisional.candidates, 'Expected verification candidates.');
    return rawVerifyReviewerCapabilityConformance({
        ...input,
        adjudication: {decisions: await fixtureCandidateDecisions(input, candidates)},
    });
};

/** @returns {Promise<number>} */
const runReviewerCapabilityCli = (/** @type {string[]} */ args, /** @type {unknown} */ options) => {
    /** @type {unknown} */
    const implementation = runReviewerCapabilityConformanceCli;
    if (typeof implementation !== 'function') throw new Error('Expected Reviewer capability CLI implementation.');
    return Reflect.apply(implementation, undefined, [args, options]);
};

const targetedProjectFiles = {
    'AGENTS.md': '# Test Agent Instructions\n\nRead each applicable linked Agent instruction.\n',
    'docs/agents/agent-writes.md': '# Agent Writes\n\nWrite only the bound Reviewer draft.\n',
    '.agents/skills/domain-modeling/SKILL.md': '# Domain\n\nInspect unfamiliar domain concepts before judging them.\n',
    'docs/agents/environment.md': '# Environment\n\nCreate temporary files only inside the scenario.\n',
    '.agents/skills/issue-tracking/SKILL.md': '# Issue Tracker Instructions\n\nApply the issue and specification workflow.\n',
    'docs/agents/reviewer.md': '# Reviewer Responsibilities\n\nRead applicable Agent instructions inside this Repository.\n',
    'docs/agents/roles/code-spec-reviewer.md': '# code-spec-reviewer\n\nCanonical targeted test role.\n',
    'docs/agents/writing.md': '# Writing\n\nUse exact paths and deterministic records.\n',
};

const createTargetedReviewerProjectOnce = async (/** @type {test.TestContext} */ t) => {
    const {repositoryRoot, runCommand} = await createMockGitRepository(t, {
        copies: [
            {
                source: join(fixtureSource, 'common-handoff.md'),
                target: 'tests/fixtures/reviewer-capability/common-handoff.md',
            },
            {
                source: join(fixtureSource, 'code-spec-reviewer'),
                target: 'tests/fixtures/reviewer-capability/code-spec-reviewer',
            },
        ],
        files: targetedProjectFiles,
        prefix: 'arw-reviewer-capability-targeted-',
    });
    sharedRunCommands.set(repositoryRoot, runCommand);
    return repositoryRoot;
};

const createCommitAuditReviewerProjectOnce = async (/** @type {test.TestContext} */ t) => {
    const {repositoryRoot, runCommand} = await createMockGitRepository(t, {
        copies: [
            {
                source: join(fixtureSource, 'common-handoff.md'),
                target: 'tests/fixtures/reviewer-capability/common-handoff.md',
            },
            {
                source: join(fixtureSource, 'commit-audit-reviewer'),
                target: 'tests/fixtures/reviewer-capability/commit-audit-reviewer',
            },
        ],
        files: {
            'AGENTS.md': targetedProjectFiles['AGENTS.md'],
            'docs/agents/agent-writes.md': '# Agent Writes\n\nWrite only the bound Reviewer draft.\n',
            '.agents/skills/arw-commands/SKILL.md': '# ARW Operations\n\nUse the current Commit Audit commands.\n',
            '.agents/skills/domain-modeling/SKILL.md': '# Domain\n\nInspect unfamiliar domain concepts before judging them.\n',
            'docs/agents/environment.md': targetedProjectFiles['docs/agents/environment.md'],
            '.agents/skills/issue-tracking/SKILL.md': targetedProjectFiles['.agents/skills/issue-tracking/SKILL.md'],
            'docs/agents/reviewer.md': targetedProjectFiles['docs/agents/reviewer.md'],
            'docs/agents/roles/commit-audit-reviewer.md': '# commit-audit-reviewer\n\nCanonical targeted test role.\n',
            'docs/agents/roles/commit-audit-reviewer/gate-2.md': '# Gate 2 Requirements\n\nAudit the applicable long-term rules.\n',
            '.agents/skills/validation/SKILL.md': '# Validation\n\nUse relevant read-only validation when needed.\n',
            'docs/agents/writing.md': '# Writing\n\nUse exact paths and deterministic records.\n',
        },
        prefix: 'arw-reviewer-capability-commit-audit-',
    });
    sharedRunCommands.set(repositoryRoot, runCommand);
    return repositoryRoot;
};

const createSpecReadinessReviewerProjectOnce = async (/** @type {test.TestContext} */ t) => {
    const {repositoryRoot, runCommand} = await createMockGitRepository(t, {
        copies: [{
            source: join(fixtureSource, 'spec-readiness-reviewer'),
            target: 'tests/fixtures/reviewer-capability/spec-readiness-reviewer',
        }, {
            source: join(fixtureSource, 'common-handoff.md'),
            target: 'tests/fixtures/reviewer-capability/common-handoff.md',
        }],
        files: {
            'AGENTS.md': targetedProjectFiles['AGENTS.md'],
            'docs/agents/agent-writes.md': '# Agent Writes\n\nWrite only the bound Reviewer draft.\n',
            '.agents/skills/domain-modeling/SKILL.md': '# Domain\n\nRead the scenario domain.\n',
            'docs/agents/environment.md': targetedProjectFiles['docs/agents/environment.md'],
            '.agents/skills/issue-tracking/SKILL.md': targetedProjectFiles['.agents/skills/issue-tracking/SKILL.md'],
            'docs/agents/reviewer.md': targetedProjectFiles['docs/agents/reviewer.md'],
            'docs/agents/roles/spec-readiness-reviewer.md': '# spec-readiness-reviewer\n\nCanonical targeted test role.\n',
            'docs/agents/roles/spec-readiness-reviewer/findings.md': '# Findings\n\nUse formal findings.\n',
            'docs/agents/roles/spec-readiness-reviewer/module-design.md': '# Module Design\n\nCheck applicable design.\n',
            'docs/agents/writing.md': '# Writing\n\nUse exact paths.\n',
        },
        prefix: 'arw-reviewer-capability-readiness-',
    });
    sharedRunCommands.set(repositoryRoot, runCommand);
    return repositoryRoot;
};

const fixtureGitRunner = (/** @type {{repositoryRoot: string, scenarioRoot: string}} */ {repositoryRoot, scenarioRoot}) => {
    const runCommand = sharedRunCommands.get(repositoryRoot);
    if (runCommand === undefined) throw new Error('Expected fixture Git command adapter.');
    return {
        run: async (/** @type {{argv: string[], input?: Buffer | string}} */ {argv, input = undefined}) => {
            try {
                const result = await runCommand('git', argv, {cwd: scenarioRoot, input});
                return {
                    code: result.exitCode,
                    failure: null,
                    stderr: Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : result.stderr,
                    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout, 'utf8'),
                };
            } catch {
                return {code: null, failure: /** @type {'process'} */ ('process'), stderr: '', stdout: Buffer.alloc(0)};
            }
        },
    };
};

/** @type {Array<() => void | Promise<void>>} */
const sharedCleanupCallbacks = [];
after(async () => {
    for (const cleanup of sharedCleanupCallbacks.reverse()) await cleanup();
});
const sharedTestContext = /** @type {test.TestContext} */ (/** @type {unknown} */ ({
    after: (/** @type {() => void | Promise<void>} */ cleanup) => sharedCleanupCallbacks.push(cleanup),
}));

const completeMarkdownResponse = (/** @type {PreparedExpected} */ expected) => `${expected.scopes.flatMap(scope => (
    scope.problemCases.map(problemCase => {
        const placement = problemCase.placements?.[0] ?? problemCase;
        const evidence = requireValue(placement.evidence, 'Expected problem case evidence.')
            .map(locator => '`' + locator.filePath + ':' + locator.line + '`').join(' ');
        return `- ${evidence} ${fixtureSeed(problemCase)}.`;
    })
)).join('\n')}\n`;

const commitAuditScopeForPath = (/** @type {string} */ path) => path.includes('/issues/')
    ? 'COMMIT-AUDIT-GATE-1'
    : 'COMMIT-AUDIT-GATE-2';

const evidenceKey = (/** @type {EvidenceLocator[]} */ evidence) => JSON.stringify([...evidence].sort((left, right) => (
    JSON.stringify(left).localeCompare(JSON.stringify(right))
)));

const createCommitAuditFixtureRecords = (/** @type {PreparedExpected} */ expected) => requireValue(
    expected.auditRecords,
    'Expected Commit Audit answer records.',
).map(expectedRecord => {
    const scope = requireValue(
        expected.scopes.find(entry => entry.scope === commitAuditScopeForPath(expectedRecord.pathSuffix)),
        `Expected Commit Audit scope for ${expectedRecord.pathSuffix}.`,
    );
    const requirements = expectedRecord.requirements.map((expectedRequirement, index) => {
        const problemCase = scope.problemCases.find(entry => (
            entry.result === expectedRequirement.result
            && (entry.placements ?? [entry]).some(placement => evidenceKey(placement.evidence ?? []) === evidenceKey(expectedRequirement.evidence))
        ));
        const finding = problemCase === undefined ? undefined : fixtureSeed(problemCase);
        return {
            evidence: expectedRequirement.evidence,
            ...(expectedRequirement.result === 'satisfied' ? {} : {finding}),
            requirement: `Requirement ${index + 1} from ${expectedRecord.pathSuffix}.`,
            result: expectedRequirement.result,
            source: expectedRequirement.source,
        };
    });
    return {
        pathSuffix: expectedRecord.pathSuffix,
        record: {
            ...(expectedRecord.documents === undefined ? {} : {documents: expectedRecord.documents}),
            requirements,
            result: expectedRecord.result,
        },
    };
});

const createCommitAuditFixtureReviewJsonl = (/** @type {PreparedExpected} */ expected) => `${createCommitAuditFixtureRecords(expected)
    .flatMap(({record}) => record.requirements)
    .map(requirement => JSON.stringify({
        evidence: requirement.evidence.map(locator => {
            if (locator.line === undefined) throw new Error('Commit Audit fixture evidence must use line locators.');
            return {filePath: locator.filePath, lines: [locator.line]};
        }),
        ...(requirement.finding === undefined ? {} : {finding: requirement.finding}),
        requirement: requirement.requirement,
        result: requirement.result,
        source: requirement.source,
    }))
    .join('\n')}\n`;

const prepareCommitAuditCapabilityFixture = async () => {
    const repositoryRoot = await createCommitAuditReviewerProjectOnce(sharedTestContext);
    const prepared = await prepareReviewerCapabilityConformance({
        agentIdentity,
        repositoryRoot,
        reviewerId: 'commit-audit-reviewer',
    });
    const state = await readPreparedState(prepared.preparedPath);
    const contract = requireValue(state.contracts[0], 'Expected Commit Audit contract.');
    const instances = await Promise.all(contract.instances.map(async instance => {
        const requestPath = requireValue(instance.requestPath, `Expected Request for ${instance.instanceId}.`);
        /** @type {{draftPath?: unknown}} */
        const request = JSON.parse(await readFile(requestPath, 'utf8'));
        if (typeof request.draftPath !== 'string') throw new Error('Expected Request draft path.');
        await writeFile(request.draftPath, createCommitAuditFixtureReviewJsonl(instance.expected), 'utf8');
        const generated = await generateCommitAudit({
            git: fixtureGitRunner({repositoryRoot, scenarioRoot: instance.scenarioRoot}),
            repositoryRoot: instance.scenarioRoot,
            requestPath,
        });
        if (!('files' in generated)) throw new Error(`Expected Commit Audit generation: ${JSON.stringify(generated)}`);
        return {
            artifactPaths: generated.files.map(({sourcePath}) => join(instance.scenarioRoot, ...sourcePath.split('/'))),
            instanceId: instance.instanceId,
        };
    }));
    const response = {instances, reviewerId: 'commit-audit-reviewer'};
    const adjudicationFor = async (/** @type {typeof response} */ artifact) => {
        const input = {
            agentIdentity,
            input: {artifacts: [artifact]},
            preparedPath: prepared.preparedPath,
            repositoryRoot,
        };
        const provisional = await rawVerifyReviewerCapabilityConformance(input);
        if (provisional.status !== 'needs-adjudication') {
            throw new Error(`Expected Commit Audit adjudication candidates: ${JSON.stringify(provisional)}`);
        }
        return {adjudication: {decisions: await fixtureCandidateDecisions(input, requireValue(provisional.candidates, 'Expected Commit Audit candidates.'))},
            pending: provisional};
    };
    const {adjudication, pending} = await adjudicationFor(response);
    return {adjudication, contract, pending, prepared, repositoryRoot, response};
};

const multiRoleLocalRecoveryFixtureWork = (async () => {
    const {repositoryRoot} = await createMockGitRepository(sharedTestContext, {
        copies: [{source: join(fixtureSource, 'common-handoff.md'),
            target: 'tests/fixtures/reviewer-capability/common-handoff.md'},
        {source: join(fixtureSource, 'code-spec-reviewer'),
            target: 'tests/fixtures/reviewer-capability/code-spec-reviewer'},
        {source: join(fixtureSource, 'code-standards-reviewer'),
            target: 'tests/fixtures/reviewer-capability/code-standards-reviewer'}],
        files: {...targetedProjectFiles,
            '.gitignore': '.tmp/\n',
            'docs/agents/roles/code-standards-reviewer.md': '# code-standards-reviewer\n\nInitial Role.\n'},
        prefix: 'arw-reviewer-capability-multi-role-',
    });
    /** @type {NonNullable<Parameters<typeof prepareReviewerCapabilityConformanceImplementation>[0]['runCommand']>} */
    const runCommand = async (file, args, {cwd, input}) => {
        if (file !== 'git') return {exitCode: 1, stderr: `Unexpected command: ${file}`, stdout: ''};
        if (args[0] === 'ls-remote') return {exitCode: 0, stderr: '', stdout: ''};
        const result = await createNodeGitRunner(cwd).run({argv: [...args], input});
        return {exitCode: result.code ?? 1, stderr: result.stderr || result.failure || '', stdout: result.stdout};
    };
    const git = async (/** @type {string[]} */ args) => {
        const result = await runCommand('git', args, {cwd: repositoryRoot});
        assert.equal(result.exitCode, 0, `${args.join(' ')}: ${result.stderr}`);
    };
    await git(['init']);
    await git(['config', 'user.email', 'reviewer-capability@example.test']);
    await git(['config', 'user.name', 'Reviewer Capability']);
    await git(['remote', 'add', 'origin',
        'https://github.com/pellorao/agent-repository-workflow.git']);
    await git(['add', '.']);
    await git(['commit', '-m', 'baseline']);
    await git(['tag', '0.2.0']);
    await writeFile(join(repositoryRoot, 'docs/agents/roles/code-spec-reviewer.md'),
        '# code-spec-reviewer\n\nCanonical release test Role.\n', 'utf8');
    await writeFile(join(repositoryRoot, 'docs/agents/roles/code-standards-reviewer.md'),
        '# code-standards-reviewer\n\nCanonical release test Role.\n', 'utf8');
    await git(['add', 'docs/agents/roles/code-spec-reviewer.md', 'docs/agents/roles/code-standards-reviewer.md']);
    await git(['commit', '-m', 'two reviewer roles']);
    sharedRunCommands.set(repositoryRoot, runCommand);
    const source = await prepareReviewerCapabilityConformance({agentIdentity, repositoryRoot});
    const sourceState = await readPreparedState(source.preparedPath);
    const codeSpec = requireValue(sourceState.contracts.find(contract => contract.reviewerId === 'code-spec-reviewer'),
        'Expected release Code Spec contract.');
    const selected = requireValue(codeSpec.instances[0], 'Expected release Code Spec instance.');
    const prepared = await prepareReviewerCapabilityConformance({
        agentIdentity,
        preparedPath: source.preparedPath,
        repositoryRoot,
        selection: {instances: [{instanceId: selected.instanceId, reviewerId: codeSpec.reviewerId}]},
    });
    const state = await readPreparedState(prepared.preparedPath);
    return {prepared, repositoryRoot, selected, source, sourceState, state};
})();

const commitAuditCapabilityFixtureWork = prepareCommitAuditCapabilityFixture();

const prepareRepeatedSourceCommitAuditCapabilityFixture = async () => {
    const repositoryRoot = await createCommitAuditReviewerProjectOnce(sharedTestContext);
    const expectedPath = join(
        repositoryRoot,
        'tests',
        'fixtures',
        'reviewer-capability',
        'commit-audit-reviewer',
        'expected.json',
    );
    const expectedFixture = JSON.parse(await readFile(expectedPath, 'utf8'));
    const firstRecord = requireValue(expectedFixture.auditRecords?.[0], 'Expected first Commit Audit record.');
    const satisfiedRequirements = firstRecord.requirements.filter((/** @type {{result?: string}} */ requirement) => requirement.result === 'satisfied');
    const firstRequirement = requireValue(satisfiedRequirements.at(-1), 'Expected final satisfied Commit Audit requirement.');
    const secondRequirement = requireValue(firstRecord.requirements.find((/** @type {{evidence?: EvidenceLocator[], result?: string}} */ requirement) => (
        requirement.result !== 'satisfied'
        && requirement.result !== undefined
        && evidenceKey(requirement.evidence ?? []) !== evidenceKey(firstRequirement.evidence)
    )), 'Expected a non-satisfied Commit Audit requirement with distinct evidence.');
    const gateOne = requireValue(
        expectedFixture.scopes?.find((/** @type {{scope?: string}} */ scope) => scope.scope === 'COMMIT-AUDIT-GATE-1'),
        'Expected Commit Audit Gate 1 scope.',
    );
    const secondProblemCase = requireValue(gateOne.problemCases.find((/** @type {{evidence?: EvidenceLocator[], placements?: Array<{evidence?: EvidenceLocator[]}>, result?: string}} */ problemCase) => (
        problemCase.result === secondRequirement.result
        && (problemCase.placements ?? [problemCase]).some(placement => evidenceKey(placement.evidence ?? []) === evidenceKey(secondRequirement.evidence))
    )), 'Expected problem case for the repeated-source requirement.');
    firstRecord.requirements.push({...structuredClone(secondRequirement), source: structuredClone(firstRequirement.source)});
    gateOne.problemCases.push(structuredClone(secondProblemCase));
    await writeFile(expectedPath, `${JSON.stringify(expectedFixture)}\n`, 'utf8');

    const prepared = await prepareReviewerCapabilityConformance({
        agentIdentity,
        repositoryRoot,
        reviewerId: 'commit-audit-reviewer',
    });
    const state = await readPreparedState(prepared.preparedPath);
    const contract = requireValue(state.contracts[0], 'Expected repeated-source Commit Audit contract.');
    const repeatedSource = JSON.stringify(firstRequirement.source);
    const instances = await Promise.all(contract.instances.map(async instance => {
        const requestPath = requireValue(instance.requestPath, `Expected Request for ${instance.instanceId}.`);
        /** @type {{draftPath?: unknown}} */
        const request = JSON.parse(await readFile(requestPath, 'utf8'));
        if (typeof request.draftPath !== 'string') throw new Error('Expected repeated-source Request draft path.');
        let repeatedSourceIndex = 0;
        const lines = createCommitAuditFixtureReviewJsonl(instance.expected).trimEnd().split('\n').map(line => {
            const row = JSON.parse(line);
            if (JSON.stringify(row.source) !== repeatedSource) return JSON.stringify(row);
            repeatedSourceIndex += 1;
            return JSON.stringify({
                ...row,
                requirement: repeatedSourceIndex === 1
                    ? 'Zulu wording chosen only by the Reviewer.'
                    : 'Alpha wording chosen only by the Reviewer.',
            });
        });
        await writeFile(request.draftPath, `${lines.join('\n')}\n`, 'utf8');
        const generated = await generateCommitAudit({
            git: fixtureGitRunner({repositoryRoot, scenarioRoot: instance.scenarioRoot}),
            repositoryRoot: instance.scenarioRoot,
            requestPath,
        });
        if (!('files' in generated)) throw new Error(`Expected repeated-source Commit Audit generation: ${JSON.stringify(generated)}`);
        return {
            artifactPaths: generated.files.map(({sourcePath}) => join(instance.scenarioRoot, ...sourcePath.split('/'))),
            instanceId: instance.instanceId,
        };
    }));
    return {
        prepared,
        repeatedSource: firstRequirement.source,
        repositoryRoot,
        response: {instances, reviewerId: 'commit-audit-reviewer'},
    };
};

const repeatedSourceCommitAuditCapabilityFixtureWork = prepareRepeatedSourceCommitAuditCapabilityFixture();

/**
 * @template T
 * @param {{instances: Array<{artifactPaths: string[] | null, instanceId: string}>}} response
 * @param {(snapshots: Array<{artifactPaths: string[], sources: string[]}>) => Promise<T>} callback
 * @returns {Promise<T>}
 */
const withCapabilityArtifactSnapshots = async (response, callback) => {
    const snapshots = await Promise.all(response.instances.map(async instance => {
        const artifactPaths = requireValue(instance.artifactPaths, `Expected artifacts for ${instance.instanceId}.`);
        return {artifactPaths, sources: await Promise.all(artifactPaths.map(path => readFile(path, 'utf8')))};
    }));
    try {
        return await callback(snapshots);
    } finally {
        for (const {artifactPaths, sources} of snapshots) {
            await Promise.all(artifactPaths.map((path, index) => writeFile(path, sources[index], 'utf8')));
        }
    }
};

const writeValidResponseBatch = async (/** @type {{prepared: PreparedConformance, repositoryRoot: string}} */ {prepared}) => {
    const state = await readPreparedState(prepared.preparedPath);
    const contract = requireValue(state.contracts[0], 'Expected one prepared contract.');
    assert.equal(contract.reviewerId, 'code-spec-reviewer');
    const instances = await Promise.all(contract.instances.map(async instance => {
        const handoff = requireValue(prepared.handoffs.find(item => item.instanceId === instance.instanceId), 'Expected prepared handoff.');
        const artifactPath = requireValue(handoff.input.reportPath, 'Expected bound result path.');
        await writeFile(artifactPath, completeMarkdownResponse(instance.expected), 'utf8');
        return {artifactPaths: [artifactPath], instanceId: instance.instanceId};
    }));
    return [{instances, reviewerId: 'code-spec-reviewer'}];
};

const codeSpecCapabilityFixtureWork = (async () => {
    const repositoryRoot = await createTargetedReviewerProjectOnce(sharedTestContext);
    const prepared = await prepareReviewerCapabilityConformance({
        agentIdentity,
        repositoryRoot,
        reviewerId: 'code-spec-reviewer',
    });
    const responses = await writeValidResponseBatch({prepared, repositoryRoot});
    return {prepared, repositoryRoot, responses};
})();

const codeStandardsCapabilityFixtureWork = (async () => {
    const {repositoryRoot, runCommand} = await createMockGitRepository(sharedTestContext, {
        copies: [{
            source: join(fixtureSource, 'common-handoff.md'),
            target: 'tests/fixtures/reviewer-capability/common-handoff.md',
        }, {
            source: join(fixtureSource, 'code-standards-reviewer'),
            target: 'tests/fixtures/reviewer-capability/code-standards-reviewer',
        }],
        files: {
            'AGENTS.md': targetedProjectFiles['AGENTS.md'],
            'docs/agents/agent-writes.md': targetedProjectFiles['docs/agents/agent-writes.md'],
            '.agents/skills/domain-modeling/SKILL.md': targetedProjectFiles['.agents/skills/domain-modeling/SKILL.md'],
            'docs/agents/environment.md': targetedProjectFiles['docs/agents/environment.md'],
            'docs/agents/reviewer.md': targetedProjectFiles['docs/agents/reviewer.md'],
            'docs/agents/roles/code-standards-reviewer.md': '# code-standards-reviewer\n\nCanonical targeted test role.\n',
            'docs/agents/writing.md': targetedProjectFiles['docs/agents/writing.md'],
        },
        prefix: 'arw-reviewer-capability-standards-',
    });
    sharedRunCommands.set(repositoryRoot, runCommand);
    const prepared = await prepareReviewerCapabilityConformance({agentIdentity, repositoryRoot, reviewerId: 'code-standards-reviewer'});
    return {prepared, repositoryRoot};
})();

const specReadinessCapabilityFixtureWork = (async () => {
    const repositoryRoot = await createSpecReadinessReviewerProjectOnce(sharedTestContext);
    const prepared = await prepareReviewerCapabilityConformance({
        agentIdentity,
        repositoryRoot,
        reviewerId: 'spec-readiness-reviewer',
    });
    const state = await readPreparedState(prepared.preparedPath);
    const contract = requireValue(state.contracts[0], 'Expected Spec Readiness contract.');
    const findingFor = (/** @type {ProblemCase} */ problem, /** @type {string} */ scope) => {
        const placement = problem.placements?.[0] ?? problem;
        const evidence = requireValue(placement.evidence, 'Expected Spec Readiness evidence.');
        return {
            check: 'check' in placement ? placement.check : scope,
            evidence: evidence.map(locator => `${locator.filePath}:${requireValue(locator.line, 'Expected line evidence.')}`),
            finding: fixtureSeed(problem),
            result: problem.result,
        };
    };
    const instances = await Promise.all(contract.instances.map(async (instance, index) => {
        const repetition = Math.floor(index / 2) + 1;
        if (instance.scenarioId === 'artifact-promotion') {
            const path = requireValue(instance.resultPath, 'Expected bound complete-review draft.');
            const selected = instance.expected.scopes.flatMap(scope => scope.problemCases.map(problem => ({problem, scope: scope.scope})))
                .slice(0, repetition - 1)
                .map(({problem, scope}) => findingFor(problem, scope));
            await writeFile(path, selected.length === 0
                ? '{"status":"no-findings"}\n'
                : `${selected.map(finding => JSON.stringify(finding)).join('\n')}\n`, 'utf8');
            return {artifactPaths: [path], instanceId: instance.instanceId};
        }
        const generation = requireValue(prepared.generations.find(entry => entry.instanceId === instance.instanceId), 'Expected Spec Readiness generation.');
        const draftPath = requireValue(generation.draftPath, 'Expected Spec Readiness draft.');
        const requirements = requireValue(instance.expected.scopes[1], 'Expected Spec Readiness Requirements scope.');
        const findings = requirements.problemCases.slice(0, repetition)
            .map(problem => findingFor(problem, requirements.scope));
        await writeFile(draftPath, `${findings.map(finding => JSON.stringify(finding)).join('\n')}\n`, 'utf8');
        const generated = await generateSpecReadiness({
            inputPath: draftPath,
            issueId: 'issue:0001:01',
            platformAdapter: {getCurrentAgentIdentity: () => agentIdentity},
            repositoryRoot: instance.scenarioRoot,
        });
        return {artifactPaths: [generated.path], instanceId: instance.instanceId};
    }));
    const response = {instances, reviewerId: 'spec-readiness-reviewer'};
    const adjudicationInput = {agentIdentity, input: {artifacts: [response]}, preparedPath: prepared.preparedPath,
        repositoryRoot};
    const pending = await rawVerifyReviewerCapabilityConformance(adjudicationInput);
    if (pending.status !== 'needs-adjudication') {
        throw new Error(`Expected Spec Readiness candidates: ${JSON.stringify(pending)}`);
    }
    const adjudication = {decisions: await fixtureCandidateDecisions(adjudicationInput,
        requireValue(pending.candidates, 'Expected Spec Readiness candidates.'))};
    return {adjudication, contract, pending, prepared, repositoryRoot, response};
})();

const codeSpecAdjudicationForCurrentReports = async (/** @type {Awaited<typeof codeSpecCapabilityFixtureWork>} */ fixture) => {
    const {prepared, repositoryRoot, responses} = fixture;
    const input = {agentIdentity, input: {artifacts: responses}, preparedPath: prepared.preparedPath, repositoryRoot};
    const pending = await rawVerifyReviewerCapabilityConformance(input);
    if (pending.status !== 'needs-adjudication') throw new Error(`Expected Code Spec candidates: ${JSON.stringify(pending)}`);
    return {adjudication: {decisions: await fixtureCandidateDecisions(input,
        requireValue(pending.candidates, 'Expected Code Spec candidates.'))}, pending};
};

const codeSpecAdjudicationFixtureWork = (async () => {
    const codeSpecCapabilityFixture = await codeSpecCapabilityFixtureWork;
    const {adjudication: codeSpecBaselineAdjudication, pending: codeSpecBaselinePending} =
        await codeSpecAdjudicationForCurrentReports(codeSpecCapabilityFixture);
    const {adjudication: codeSpecThresholdAdjudication} = await (async () => {
        const response = requireValue(codeSpecCapabilityFixture.responses[0], 'Expected Code Spec response.');
        const third = requireValue(response.instances[2], 'Expected third repetition.');
        return withCapabilityArtifactSnapshots({instances: [third]}, async snapshots => {
            const path = requireValue(third.artifactPaths?.[0], 'Expected third report.');
            const text = requireValue(snapshots[0]?.sources[0], 'Expected full third report.');
            await writeFile(path, `${text.trimEnd().split('\n').slice(0, 6).join('\n')}\n`, 'utf8');
            return codeSpecAdjudicationForCurrentReports(codeSpecCapabilityFixture);
        });
    })();

    return {codeSpecBaselineAdjudication, codeSpecBaselinePending, codeSpecThresholdAdjudication};
})();

const codeSpecLocalRecoveryFixtureWork = (async () => {
    await codeSpecAdjudicationFixtureWork;
    const codeSpecCapabilityFixture = await codeSpecCapabilityFixtureWork;
    const {prepared: source, repositoryRoot, responses} = codeSpecCapabilityFixture;
    const sourceState = await readPreparedState(source.preparedPath);
    const sourceResponse = requireValue(responses[0], 'Expected original Code Spec batch.');
    const originalPreparedBytes = await readFile(source.preparedPath);
    const originalReportBytes = await Promise.all(sourceResponse.instances.map(instance => readFile(
        requireValue(instance.artifactPaths?.[0], 'Expected original Code Spec report.'),
    )));
    const selected = requireValue(sourceState.contracts[0]?.instances[1], 'Expected second Code Spec repetition.');
    const prepared = await prepareReviewerCapabilityConformance({
        agentIdentity,
        preparedPath: source.preparedPath,
        repositoryRoot,
        selection: {instances: [{instanceId: selected.instanceId, reviewerId: 'code-spec-reviewer'}]},
    });
    const state = await readPreparedState(prepared.preparedPath);
    const replacement = requireValue(state.contracts[0]?.instances[1], 'Expected replacement Code Spec repetition.');
    await writeFile(replacement.reportPath, completeMarkdownResponse(replacement.expected), 'utf8');
    const response = {
        ...sourceResponse,
        instances: sourceResponse.instances.map((instance, index) => index === 1
            ? {artifactPaths: [replacement.reportPath], instanceId: replacement.instanceId}
            : instance),
    };
    const pendingInput = {agentIdentity, input: {artifacts: [response]}, preparedPath: prepared.preparedPath, repositoryRoot};
    const pending = await rawVerifyReviewerCapabilityConformance(pendingInput);
    if (pending.status !== 'needs-adjudication') throw new Error(`Expected recovered Code Spec candidates: ${JSON.stringify(pending)}`);
    const adjudication = {decisions: await fixtureCandidateDecisions(pendingInput,
        requireValue(pending.candidates, 'Expected recovered Code Spec candidates.'))};
    return {adjudication, originalPreparedBytes, originalReportBytes, pending, prepared, repositoryRoot, replacement, response, selected,
        source, sourceResponse, sourceState, state};
})();

const specReadinessLocalRecoveryFixtureWork = (async () => {
    const specReadinessCapabilityFixture = await specReadinessCapabilityFixtureWork;
    const {prepared: source, repositoryRoot, response: sourceResponse} = specReadinessCapabilityFixture;
    const sourceState = await readPreparedState(source.preparedPath);
    const sourceInstances = requireValue(sourceState.contracts[0], 'Expected original Spec Readiness contract.').instances;
    const selected = sourceInstances.filter(instance => instance.scenarioId === 'runtime-migration');
    const originalPreparedBytes = await readFile(source.preparedPath);
    const originalReportBytes = await Promise.all(sourceInstances.map(instance => readFile(instance.reportPath)));
    const prepared = await prepareReviewerCapabilityConformance({
        agentIdentity,
        preparedPath: source.preparedPath,
        repositoryRoot,
        selection: {instances: selected.map(instance => ({instanceId: instance.instanceId,
            reviewerId: 'spec-readiness-reviewer'}))},
    });
    const state = await readPreparedState(prepared.preparedPath);
    const instances = requireValue(state.contracts[0], 'Expected recovered Spec Readiness contract.').instances;
    const replacementArtifacts = new Map();
    for (const [index, original] of sourceInstances.entries()) {
        if (original.scenarioId !== 'runtime-migration') continue;
        const replacement = requireValue(instances[index], 'Expected runtime-migration replacement.');
        await writeFile(replacement.reportPath, originalReportBytes[index]);
        const generated = await generateSpecReadiness({
            inputPath: replacement.reportPath,
            issueId: 'issue:0001:01',
            platformAdapter: {getCurrentAgentIdentity: () => agentIdentity},
            repositoryRoot: replacement.scenarioRoot,
        });
        replacementArtifacts.set(index, {artifactPaths: [generated.path], instanceId: replacement.instanceId});
    }
    const response = {...sourceResponse, instances: sourceResponse.instances.map((instance, index) =>
        replacementArtifacts.get(index) ?? instance)};
    const pendingInput = {agentIdentity, input: {artifacts: [response]}, preparedPath: prepared.preparedPath, repositoryRoot};
    const pending = await rawVerifyReviewerCapabilityConformance(pendingInput);
    if (pending.status !== 'needs-adjudication') throw new Error(`Expected recovered Spec Readiness candidates: ${JSON.stringify(pending)}`);
    const adjudication = {decisions: await fixtureCandidateDecisions(pendingInput,
        requireValue(pending.candidates, 'Expected recovered Spec Readiness candidates.'))};
    return {adjudication, instances, originalPreparedBytes, originalReportBytes, pending, prepared, repositoryRoot, response, selected,
        source, sourceInstances, sourceResponse, sourceState, state};
})();


const releaseRoleChangeRecoveryFixtureWork = (async () => {
    const multiRoleLocalRecoveryFixture = await multiRoleLocalRecoveryFixtureWork;
    const {repositoryRoot, source, sourceState} = multiRoleLocalRecoveryFixture;
    const roleBytes = Buffer.from('# code-spec-reviewer\n\nUpdated canonical Role for the recovered candidate.\n');
    const rolePath = 'docs/agents/roles/code-spec-reviewer.md';
    await writeFile(join(repositoryRoot, rolePath), roleBytes);
    const runCommand = requireValue(sharedRunCommands.get(repositoryRoot), 'Expected release Git runner.');
    for (const args of [['add', rolePath], ['commit', '-m', 'update code spec reviewer role']]) {
        const result = await runCommand('git', args, {cwd: repositoryRoot});
        assert.equal(result.exitCode, 0, `${args.join(' ')}: ${result.stderr}`);
    }
    const sourceContract = requireValue(sourceState.contracts.find(contract => contract.reviewerId === 'code-spec-reviewer'),
        'Expected Code Spec source contract.');
    const selection = {instances: sourceContract.instances.map(instance => ({instanceId: instance.instanceId,
        reviewerId: sourceContract.reviewerId}))};
    const prepared = await prepareReviewerCapabilityConformance({
        agentIdentity, preparedPath: source.preparedPath, repositoryRoot, selection,
    });
    const state = await readPreparedState(prepared.preparedPath);
    return {prepared, repositoryRoot, roleBytes, selection, source, sourceState, state};
})();

const fixtureWork = [commitAuditCapabilityFixtureWork, repeatedSourceCommitAuditCapabilityFixtureWork,
    codeSpecCapabilityFixtureWork, codeStandardsCapabilityFixtureWork, specReadinessCapabilityFixtureWork,
    codeSpecAdjudicationFixtureWork, codeSpecLocalRecoveryFixtureWork, specReadinessLocalRecoveryFixtureWork,
    multiRoleLocalRecoveryFixtureWork, releaseRoleChangeRecoveryFixtureWork];
const fixtureResults = await Promise.allSettled(fixtureWork);
for (const result of fixtureResults) if (result.status === 'rejected') throw result.reason;
const [commitAuditCapabilityFixture, repeatedSourceCommitAuditCapabilityFixture, codeSpecCapabilityFixture,
    codeStandardsCapabilityFixture, specReadinessCapabilityFixture,
    {codeSpecBaselineAdjudication, codeSpecBaselinePending, codeSpecThresholdAdjudication}, codeSpecLocalRecoveryFixture,
    specReadinessLocalRecoveryFixture, multiRoleLocalRecoveryFixture, releaseRoleChangeRecoveryFixture] = await Promise.all([
    commitAuditCapabilityFixtureWork, repeatedSourceCommitAuditCapabilityFixtureWork, codeSpecCapabilityFixtureWork,
    codeStandardsCapabilityFixtureWork, specReadinessCapabilityFixtureWork, codeSpecAdjudicationFixtureWork,
    codeSpecLocalRecoveryFixtureWork, specReadinessLocalRecoveryFixtureWork, multiRoleLocalRecoveryFixtureWork,
    releaseRoleChangeRecoveryFixtureWork,
]);
const codeStandardsPrepared = codeStandardsCapabilityFixture.prepared;

test('adjudication candidates include the bound finding and frozen expectation for all four Reviewers', async () => {
    const standardsState = await readPreparedState(codeStandardsPrepared.preparedPath);
    const standardsInstances = await Promise.all(requireValue(standardsState.contracts[0], 'Expected Standards contract.')
        .instances.map(async instance => {
            const handoff = requireValue(codeStandardsPrepared.handoffs.find(entry => entry.instanceId === instance.instanceId),
                'Expected Standards handoff.');
            const path = requireValue(handoff.input.reportPath, 'Expected Standards result path.');
            await writeFile(path, completeMarkdownResponse(instance.expected), 'utf8');
            return {artifactPaths: [path], instanceId: instance.instanceId};
        }));
    const batches = [
        {pending: null, prepared: codeStandardsPrepared, repositoryRoot: codeStandardsCapabilityFixture.repositoryRoot,
            response: {instances: standardsInstances, reviewerId: 'code-standards-reviewer'}},
        {pending: codeSpecBaselinePending, prepared: codeSpecCapabilityFixture.prepared, repositoryRoot: codeSpecCapabilityFixture.repositoryRoot,
            response: codeSpecCapabilityFixture.responses[0]},
        {pending: specReadinessCapabilityFixture.pending, prepared: specReadinessCapabilityFixture.prepared,
            repositoryRoot: specReadinessCapabilityFixture.repositoryRoot, response: specReadinessCapabilityFixture.response},
        {pending: commitAuditCapabilityFixture.pending, prepared: commitAuditCapabilityFixture.prepared,
            repositoryRoot: commitAuditCapabilityFixture.repositoryRoot, response: commitAuditCapabilityFixture.response},
    ];
    // 初始报告和角色未变化, 复用准备阶段已经执行的真实验证.
    for (const {pending: preparedPending, prepared, repositoryRoot, response} of batches) {
        const pending = preparedPending ?? await rawVerifyReviewerCapabilityConformance({
            agentIdentity, input: {artifacts: [response]}, preparedPath: prepared.preparedPath, repositoryRoot,
        });
        assert.equal(pending.status, 'needs-adjudication', JSON.stringify(pending));
        const candidates = requireValue(pending.candidates, 'Expected adjudication candidates.');
        assert.ok(candidates.length > 0);
        const state = await readPreparedState(prepared.preparedPath);
        const instances = state.contracts.flatMap(contract => contract.instances);
        assert.deepEqual(prepared.handoffs.map(handoff => handoff.instanceId), instances.map(instance => instance.instanceId));
        for (const [index, handoff] of prepared.handoffs.entries()) {
            const instance = requireValue(instances[index], 'Expected bound handoff instance.');
            assert.equal(handoff.input.role, response.reviewerId);
            assert.deepEqual(handoff.input.identity, {kind: 'isolated', instanceId: instance.instanceId});
            assert.equal(handoff.scenarioRoot, instance.scenarioRoot);
            assert.equal(handoff.input.cwd, instance.scenarioRoot);
            assert.equal(handoff.input.reportPath, instance.reportPath);
            assert.equal(Object.hasOwn(handoff.input, 'readPaths'), false);
            const reportDirectory = dirname(instance.reportPath);
            assert.deepEqual(handoff.input.writePaths, [reportDirectory]);
            if (instance.requestPath !== undefined) {
                const requestRelativePath = relative(reportDirectory, instance.requestPath);
                assert.ok(isAbsolute(requestRelativePath) || requestRelativePath === '..' || requestRelativePath.startsWith(`..${sep}`));
            }
            const writeRelativePath = relative(join(instance.scenarioRoot, '.tmp'), reportDirectory);
            assert.ok(writeRelativePath.length > 0 && !isAbsolute(writeRelativePath)
                && writeRelativePath !== '..' && !writeRelativePath.startsWith(`..${sep}`));
            assert.equal(handoff.input.stateDirectory, dirname(prepared.preparedPath));
            const stateRelativePath = relative(instance.scenarioRoot, handoff.input.stateDirectory);
            assert.ok(isAbsolute(stateRelativePath) || stateRelativePath === '..' || stateRelativePath.startsWith(`..${sep}`));
        }
        for (const candidate of candidates) {
            const instance = requireValue(state.contracts[0]?.instances.find(entry => entry.instanceId === candidate.instanceId),
                'Expected candidate instance.');
            const problem = requireValue(instance.expected.scopes.find(scope => scope.scope === candidate.problemScope)
                ?.problemCases[candidate.problemCaseIndex - 1], 'Expected candidate problem.');
            assert.equal(candidate.reviewerId, response.reviewerId);
            assert.equal(candidate.expectation, problem.expectation);
            assert.ok(candidate.finding.length > 0);
            assert.ok(candidate.result === 'gap' || candidate.result === 'uncertain');
            assert.ok(Array.isArray(candidate.evidence));
            assert.ok(candidate.evidence.length > 0);
        }
    }
});

test('candidate content batch preserves one-operation ordered bytes and closes invalid rereads', async () => {
    const candidateTree = 'f'.repeat(40);
    for (const size of [1, 4]) {
        const uniqueFiles = Array.from({length: size}, (_, index) => ({
            filePath: `docs/reviewer-${index}.md`,
            label: `candidate Reviewer ${index}`,
        }));
        const files = size === 4
            ? [uniqueFiles[0], uniqueFiles[1], {...uniqueFiles[0], label: 'duplicate Reviewer'}, uniqueFiles[2], uniqueFiles[3]]
            : uniqueFiles;
        const entries = uniqueFiles.map(({filePath}, index) => ({
            bytes: index === size - 1
                ? Buffer.from([0x00, 0x52, 0x65, 0x76, 0xff])
                : Buffer.from(`content ${index}\n`, 'utf8'),
            specification: `${candidateTree}:${filePath}`,
        }));
        /** @type {Array<{args: string[], file: string, options: {cwd: string, encoding?: 'buffer', input?: string | Buffer}}>} */
        const calls = [];
        let adapterOutput = Buffer.alloc(0);
        const reader = createCandidateFilesReader({
            candidateContentGit: createCandidateContentGitAdapter(async (file, args, options) => {
                calls.push({args: [...args], file, options});
                adapterOutput = candidateBatchOutput(entries);
                return {exitCode: 0, stderr: Buffer.alloc(0), stdout: adapterOutput};
            }),
        });
        const result = await reader({candidateTree, files, repositoryRoot: '/repository'});
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0]?.args, ['cat-file', '--batch']);
        assert.equal(calls[0]?.file, 'git');
        assert.equal(calls[0]?.options.encoding, 'buffer');
        assert.equal(calls[0]?.options.input, `${entries.map(entry => entry.specification).join('\n')}\n`);
        assert.equal(result.status, 'succeeded');
        if (result.status !== 'succeeded') assert.fail('Candidate content batch must succeed.');
        assert.deepEqual(result.entries.map(entry => entry.filePath), uniqueFiles.map(entry => entry.filePath));
        assert.deepEqual(result.entries.map(entry => entry.bytes), entries.map(entry => entry.bytes));
        const copiedBytes = result.entries.map(entry => Buffer.from(entry.bytes));
        adapterOutput.fill(0);
        assert.deepEqual(result.entries.map(entry => entry.bytes), copiedBytes);
    }

    let emptyGitCalls = 0;
    const shapeReader = createCandidateFilesReader({
        candidateContentGit: {readBatch: async () => {
            emptyGitCalls += 1;
            return {exitCode: 0, stderr: Buffer.alloc(0), stdout: Buffer.alloc(0)};
        }},
    });
    assert.deepEqual(await shapeReader({candidateTree, files: [], repositoryRoot: '/repository'}), {
        entries: [],
        status: 'succeeded',
    });
    assert.equal(emptyGitCalls, 0);
    await assert.rejects(shapeReader({candidateTree, files: 'invalid', repositoryRoot: '/repository'}), TypeError);
    for (const reviewerId of REVIEWER_IDS) {
        assert.deepEqual(deriveAffectedReviewerIds([`docs/agents/roles/${reviewerId}.md`]), [reviewerId]);
    }
    assert.deepEqual(deriveAffectedReviewerIds(['docs/agents/roles/commit-audit-reviewer/gate-2.md']), ['commit-audit-reviewer']);
    assert.deepEqual(deriveAffectedReviewerIds(['docs/agents/roles/unregistered-reviewer.md']), []);
    assert.deepEqual(deriveAffectedReviewerIds([
        'docs/agents/roles/spec-readiness-reviewer.md',
        'lib/release/reviewer-capability-scoring.mjs',
        'docs/agents/roles/code-spec-reviewer.md',
        'lib/release/reviewer-capability-scoring.mjs',
        'docs/agents/roles/spec-readiness-reviewer.md',
    ]), REVIEWER_IDS);
    assert.deepEqual(deriveAffectedReviewerIds(['README.md']), []);

    let revision = 0;
    const driftReader = createCandidateFilesReader({
        candidateContentGit: {
            readBatch: async (/** @type {{specifications: string[]}} */ {specifications}) => {
                revision += 1;
                return {
                    exitCode: 0,
                    stderr: Buffer.alloc(0),
                    stdout: candidateBatchOutput([{
                        bytes: Buffer.from(`revision-${revision}`),
                        specification: requireValue(specifications[0], 'Expected drift specification.'),
                    }]),
                };
            },
        },
    });
    const driftInput = {
        candidateTree,
        files: [{filePath: 'docs/drift.md', label: 'candidate drift input'}],
        repositoryRoot: '/repository',
    };
    const before = await driftReader(driftInput);
    const after = await driftReader(driftInput);
    assert.equal(revision, 2);
    assert.equal(before.status === 'succeeded' ? before.entries[0]?.bytes.toString() : '', 'revision-1');
    assert.equal(after.status === 'succeeded' ? after.entries[0]?.bytes.toString() : '', 'revision-2');

    const failures = [
        {
            adapter: createCandidateContentGitAdapter(async () => ({
                exitCode: 0,
                stderr: Buffer.alloc(0),
                stdout: Buffer.from(`${candidateTree}:docs/missing.md missing\n`),
            })),
            code: 'candidate-content-missing',
        },
        {
            adapter: createCandidateContentGitAdapter(async () => ({
                exitCode: 1,
                stderr: 'simulated batch failure',
                stdout: '',
            })),
            code: 'candidate-content-git-failed',
        },
        {
            adapter: {
                readBatch: async () => ({
                    exitCode: 0,
                    stderr: Buffer.alloc(0),
                    stdout: Buffer.from(`${'1'.repeat(39)} blob 3\none\n`),
                }),
            },
            code: 'candidate-content-invalid',
        },
    ];
    for (const {adapter, code} of failures) {
        const result = await createCandidateFilesReader({candidateContentGit: adapter})({
            candidateTree,
            files: [{filePath: 'docs/missing.md', label: 'candidate missing input'}],
            repositoryRoot: '/repository',
        });
        assert.equal(result.status, 'failed');
        assert.equal(result.code, code);
        assert.equal(Object.hasOwn(result, 'entries'), false);
    }
});

test('reviewer scoring tables preserve association, placement, evidence, clean targeting, and atomic case scores', () => {
    const filePath = 'specs/reviewer.md';
    const scope = 'SPEC-READINESS-REQUIREMENTS';
    const evidenceSources = new Map([[filePath, [
        'Association.',
        'Required detail.',
        '',
        'Clean target.',
        'Alternative clean target.',
        'Unrelated.',
    ].join('\n')]]);
    const headingPath = 'specs/headings.md';
    evidenceSources.set(headingPath, '# Heading only\n');
    const expected = {
        cleanCount: 2,
        kind: 'spec-readiness-artifact',
        problemCount: 1,
        scopes: [{
            cleanCases: [
                {
                    evidence: [{filePath, line: 4}],
                    evidenceAlternatives: [[{filePath, line: 5}]],
                    expectation: 'The clean behavior is correct.',
                    findingTerms: ['clean behavior'],
                },
                {noOtherSupportedFinding: true},
            ],
            problemCases: [{
                associationEvidence: [{filePath, line: 1}],
                evidence: [{filePath, line: 1}, {filePath, line: 2}],
                expectation: 'The required behavior is missing.',
                findingTerms: ['required behavior', 'missing'],
                placements: [
                    {
                        associationEvidence: [{filePath, line: 1}],
                        check: scope,
                        evidence: [{filePath, line: 1}, {filePath, line: 2}],
                    },
                    {
                        associationEvidence: [{filePath, line: 2}],
                        check: scope,
                        evidence: [{filePath, line: 2}],
                    },
                ],
                result: 'gap',
            }],
            scope,
        }],
    };
    const scorer = createReviewerCapabilityScenarioScorer({
        evidenceSources,
        expected,
        instanceId: 'memory-score',
        reviewerId: 'spec-readiness-reviewer',
        scenarioRoot: resolve('/reviewer-capability-scenario'),
    });
    const scoreFindings = (/** @type {ReadinessFinding[]} */ findings) => {
        const checks = [{check: scope, findings, result: 'gap'}];
        const provisional = scorer({checks});
        return {
            provisional,
            result: scorer({
                adjudicationDecisions: new Map(provisional.candidates.map(candidate => [candidate.candidateId, 'matched'])),
                checks,
            }),
        };
    };
    const finding = (/** @type {EvidenceLocator[]} */ evidence) => ({
        evidence,
        finding: 'The required behavior is missing.',
        result: 'gap',
    });

    const complete = scoreFindings([finding([{filePath, line: 1}, {filePath, line: 2}])]);
    assert.equal(complete.provisional.candidates.length, 1);
    assert.deepEqual(complete.provisional.candidates[0], {
        candidateId: 'spec-readiness-reviewer:memory-score:scope-1:problem-1:SPEC-READINESS-REQUIREMENTS:finding-1',
        check: scope,
        evidence: [{filePath, line: 1}, {filePath, line: 2}],
        expectation: 'The required behavior is missing.',
        finding: 'The required behavior is missing.',
        findingIndex: 0,
        instanceId: 'memory-score',
        problemCaseIndex: 1,
        problemScope: scope,
        result: 'gap',
        reviewerId: 'spec-readiness-reviewer',
    });
    assert.equal(complete.result.caseScores.problem[0], 1);
    assert.equal(complete.result.caseScores.clean[0][0], 1);
    assert.equal(complete.result.caseScores.clean[0][1], 1);

    const headingOnly = scoreFindings([finding([{filePath: headingPath, line: 1}])]);
    assert.deepEqual(headingOnly.provisional.candidates, []);
    assert.equal(headingOnly.result.caseScores.problem[0], 0);
    const headingAndValid = scoreFindings([
        finding([{filePath: headingPath, line: 1}]),
        finding([{filePath, line: 1}, {filePath, line: 2}]),
    ]);
    assert.equal(headingAndValid.provisional.candidates.length, 1);
    assert.equal(headingAndValid.result.caseScores.problem[0], 1);

    const partial = scoreFindings([finding([{filePath, line: 1}])]).result.caseScores.problem[0];
    assert.ok(partial > 0 && partial < 1);
    const split = scoreFindings([
        finding([{filePath, line: 1}]),
        finding([{filePath, line: 2}]),
    ]).result.caseScores.problem[0];
    assert.ok(split < 1);

    const alternativePlacement = scoreFindings([finding([{filePath, line: 2}])]).result;
    assert.ok(alternativePlacement.caseScores.problem[0] > 0);

    const sourceBoundExpected = structuredClone(expected);
    Reflect.set(sourceBoundExpected.scopes[0].problemCases[0], 'requirementSource', 'specs/reviewer.md:1');
    const sourceBoundScorer = createReviewerCapabilityScenarioScorer({
        evidenceSources,
        expected: sourceBoundExpected,
        instanceId: 'source-bound',
        reviewerId: 'code-spec-reviewer',
        scenarioRoot: resolve('/reviewer-capability-scenario'),
    });
    const sourceBoundCheck = (/** @type {string} */ requirementSource) => sourceBoundScorer({checks: [{
        check: scope,
        findings: [{...finding([{filePath, line: 1}, {filePath, line: 2}]), requirementSource}],
        result: 'gap',
    }]});
    assert.equal(sourceBoundCheck('specs/reviewer.md:1').candidates.length, 1);
    assert.deepEqual(sourceBoundCheck('specs/reviewer.md:2').candidates, []);

    const blankAssociation = structuredClone(expected);
    blankAssociation.scopes[0].problemCases[0].associationEvidence = [{filePath, line: 3}];
    Reflect.deleteProperty(blankAssociation.scopes[0].problemCases[0], 'placements');
    const blankScorer = createReviewerCapabilityScenarioScorer({
        evidenceSources,
        expected: blankAssociation,
        instanceId: 'blank-association',
        reviewerId: 'code-spec-reviewer',
        scenarioRoot: resolve('/reviewer-capability-scenario'),
    });
    assert.deepEqual(blankScorer({checks: [{
        check: scope,
        findings: [finding([{filePath, line: 1}, {filePath, line: 3}])],
        result: 'gap',
    }]}).candidates, []);

    const falseClean = scorer({checks: [{
        check: scope,
        findings: [{evidence: [{filePath, line: 5}], finding: 'The clean behavior is defective.', result: 'gap'}],
        result: 'gap',
    }]});
    assert.deepEqual(falseClean.caseScores.clean, [[0, 0]]);
    const cleanSourceBoundExpected = structuredClone(expected);
    Reflect.set(cleanSourceBoundExpected.scopes[0].cleanCases[0], 'requirementSource', 'specs/reviewer.md:5');
    const cleanSourceBoundScorer = createReviewerCapabilityScenarioScorer({
        evidenceSources,
        expected: cleanSourceBoundExpected,
        instanceId: 'clean-source-bound',
        reviewerId: 'code-spec-reviewer',
        scenarioRoot: resolve('/reviewer-capability-scenario'),
    });
    const cleanSourceFinding = {
        evidence: [{filePath, line: 5}],
        finding: 'The clean behavior is defective.',
        result: 'gap',
    };
    assert.deepEqual(cleanSourceBoundScorer({checks: [{
        check: scope,
        findings: [{...cleanSourceFinding, requirementSource: 'specs/reviewer.md:5'}],
        result: 'gap',
    }]}).caseScores.clean, [[0, 0]]);
    assert.deepEqual(cleanSourceBoundScorer({checks: [{
        check: scope,
        findings: [{...cleanSourceFinding, requirementSource: 'specs/reviewer.md:6'}],
        result: 'gap',
    }]}).caseScores.clean, [[1, 0]]);
    const wrongCleanLocator = scorer({checks: [{
        check: scope,
        findings: [{evidence: [{filePath, line: 6}], finding: 'The clean behavior is defective.', result: 'gap'}],
        result: 'gap',
    }]});
    assert.deepEqual(wrongCleanLocator.caseScores.clean, [[1, 0]]);

    const stableChecks = [finding([{filePath, line: 1}, {filePath, line: 2}])];
    const stableBefore = scoreFindings(stableChecks).result;
    expected.scopes[0].problemCases[0].evidence[0].line = 6;
    evidenceSources.set(filePath, 'Changed after scorer creation.');
    assert.deepEqual(scoreFindings(stableChecks).result, stableBefore);
    assert.throws(() => createReviewerCapabilityScenarioScorer({
        evidenceSources: new Map(),
        expected: /** @type {PreparedExpected} */ (/** @type {unknown} */ ({})),
        instanceId: 'invalid',
        reviewerId: 'code-spec-reviewer',
        scenarioRoot: resolve('/reviewer-capability-scenario'),
    }), TypeError);
});

test('targeted Reviewer capability lifecycle connects one prepared contract through artifact adjudication and final gates', async () => {
    const {prepared, repositoryRoot, responses} = codeSpecCapabilityFixture;
    assert.equal(Object.hasOwn(prepared, 'contracts'), false);
    assert.equal(Object.hasOwn(prepared, 'expected'), false);
    assert.equal(Object.hasOwn(prepared, 'candidate'), false);
    assert.deepEqual(prepared.handoffs.map(handoff => handoff.reviewerId), Array(3).fill('code-spec-reviewer'));
    const state = await readPreparedState(prepared.preparedPath);
    assert.deepEqual(state.reviewerIds, ['code-spec-reviewer']);
    assert.equal(state.contracts.length, 1);
    assert.equal(state.contracts[0].instances.length, 3);
    assert.equal(state.contracts[0].instances.every(instance => !Object.hasOwn(instance, 'repetition')), true);
    assert.equal(prepared.handoffs.every(handoff => !Object.hasOwn(handoff, 'repetition')), true);
    assert.equal(new Set(state.contracts[0].instances.map(instance => instance.instanceId)).size, 3);
    assert.equal(new Set(state.contracts[0].instances.map(instance => instance.scenarioRoot)).size, 3);
    assert.deepEqual(responses.map(response => response.reviewerId), ['code-spec-reviewer']);
    assert.equal(responses.flatMap(response => response.instances).length, 3);
    assert.equal(responses.flatMap(response => response.instances).every(instance => (
        instance.artifactPaths.length === 1
    )), true);
    const result = await rawVerifyReviewerCapabilityConformance({
        adjudication: codeSpecBaselineAdjudication,
        agentIdentity,
        input: {artifacts: responses},
        preparedPath: prepared.preparedPath,
        repositoryRoot,
    });
    assert.equal(result.status, 'verified');
    assert.deepEqual(result.reviewerIds, ['code-spec-reviewer']);
    assert.deepEqual(requireValue(result.results, 'Expected Reviewer score.').map(entry => entry.score), [1]);
    const score = requireValue(result.results?.[0], 'Expected Reviewer score.');
    assert.deepEqual(score.repetitionScores, [1, 1, 1]);
    assert.deepEqual(score.finalRepetitionScores, [1, 1, 1]);
    assert.equal(score.scoreBeforePenalty, 1);


    assert.equal(score.scoreGate, 'passed');
    assert.equal(score.scoreExplanation, 'Final score: 1.000. Score before penalty: 1.000. Repetition scores before penalty: 1.000, 1.000, 1.000. Final repetition scores: 1.000, 1.000, 1.000. Report errors: None.');
    assert.equal(Object.hasOwn(score, 'notes'), false);
});

test('repairing artifact selection without changing review results reuses the complete prepared batch', async () => {
    const {prepared, repositoryRoot, responses} = codeSpecCapabilityFixture;
    const response = requireValue(responses[0], 'Expected complete Code Spec response.');
    const preparedBytes = await readFile(prepared.preparedPath);
    const reportBytes = await Promise.all(response.instances.map(instance => readFile(
        requireValue(instance.artifactPaths?.[0], 'Expected bound report.'),
    )));
    const input = {artifacts: [{...response, instances: [...response.instances, response.instances[0]]}]};
    const rejected = await rawVerifyReviewerCapabilityConformance({
        agentIdentity, input, preparedPath: prepared.preparedPath, repositoryRoot,
    });
    assert.equal(rejected.status, 'failed');
    input.artifacts[0].instances.pop();
    const repaired = await rawVerifyReviewerCapabilityConformance({
        adjudication: codeSpecBaselineAdjudication, agentIdentity, input,
        preparedPath: prepared.preparedPath, repositoryRoot,
    });
    assert.equal(repaired.status, 'verified');
    assert.deepEqual(repaired.results?.[0]?.repetitionScores, [1, 1, 1]);
    assert.deepEqual(await readFile(prepared.preparedPath), preparedBytes);
    for (const [index, instance] of response.instances.entries()) {
        assert.deepEqual(await readFile(requireValue(instance.artifactPaths?.[0], 'Expected retained report.')),
            reportBytes[index]);
    }
});

test('local preparation replaces one repetition and formally verifies the retained complete batch', async () => {
    const fixture = codeSpecLocalRecoveryFixture;
    const {adjudication, originalPreparedBytes, originalReportBytes, pending, prepared, replacement, response, repositoryRoot, selected,
        source, sourceResponse, sourceState, state} = fixture;
    assert.deepEqual(state.previousPrepared, {
        preparedPath: source.preparedPath,
        sha256: createHash('sha256').update(originalPreparedBytes).digest('hex'),
    });
    assert.notEqual(state.runId, sourceState.runId);
    assert.deepEqual(state.contracts[0].instances.map(instance => instance.instanceId), [
        sourceState.contracts[0].instances[0].instanceId,
        replacement.instanceId,
        sourceState.contracts[0].instances[2].instanceId,
    ]);
    assert.deepEqual(state.contracts[0].instances[0], sourceState.contracts[0].instances[0]);
    assert.deepEqual(state.contracts[0].instances[2], sourceState.contracts[0].instances[2]);
    assert.notEqual(replacement.instanceId, selected.instanceId);
    assert.notEqual(replacement.scenarioRoot, selected.scenarioRoot);
    assert.notEqual(replacement.reportPath, selected.reportPath);
    assert.deepEqual(prepared.handoffs.map(handoff => [handoff.reviewerId, handoff.instanceId]),
        [['code-spec-reviewer', replacement.instanceId]]);
    assert.deepEqual(prepared.generations, []);
    assert.equal(prepared.handoffs[0].input.reportPath, replacement.reportPath);
    assert.equal(prepared.handoffs[0].input.stateDirectory, dirname(prepared.preparedPath));
    assert.equal(response.instances.filter((instance, index) => instance === sourceResponse.instances[index]).length, 2);
    assert.equal(pending.status, 'needs-adjudication');
    assert.ok(pending.candidates?.some(candidate => candidate.instanceId === replacement.instanceId));
    const result = await rawVerifyReviewerCapabilityConformance({
        adjudication, agentIdentity, input: {artifacts: [response]}, preparedPath: prepared.preparedPath, repositoryRoot,
    });
    assert.equal(result.status, 'verified', JSON.stringify(result.diagnostics));
    assert.deepEqual(result.results?.[0]?.repetitionScores, [1, 1, 1]);
    assert.deepEqual(await readFile(source.preparedPath), originalPreparedBytes);
    for (const [index, instance] of sourceResponse.instances.entries()) {
        assert.deepEqual(await readFile(requireValue(instance.artifactPaths?.[0], 'Expected retained original report.')),
            originalReportBytes[index]);
    }
});

test('local verification rejects old, missing, and foreign replacement results without widening the batch', async () => {
    const {prepared, repositoryRoot, response, selected, sourceResponse} = codeSpecLocalRecoveryFixture;
    const complete = response.instances;
    const invalidBatches = [
        sourceResponse.instances,
        complete.filter((_, index) => index !== 1),
        complete.map((instance, index) => index === 1
            ? {...instance, instanceId: `${selected.instanceId}-foreign`}
            : instance),
    ];
    for (const instances of invalidBatches) {
        const result = await rawVerifyReviewerCapabilityConformance({
            agentIdentity,
            input: {artifacts: [{instances, reviewerId: 'code-spec-reviewer'}]},
            preparedPath: prepared.preparedPath,
            repositoryRoot,
        });
        assert.equal(result.status, 'failed', JSON.stringify(result));
        assert.equal(result.results?.some(entry => entry.scoreGate === 'passed') ?? false, false);
    }
});

test('local preparation rejects selections that are empty, duplicated, stale, or role mismatched', async () => {
    const {repositoryRoot, selected, source} = codeSpecLocalRecoveryFixture;
    const valid = {instanceId: selected.instanceId, reviewerId: 'code-spec-reviewer'};
    for (const selection of [
        {instances: []},
        {instances: [valid, valid]},
        {instances: [{...valid, instanceId: 'foreign-instance'}]},
        {instances: [{...valid, reviewerId: 'code-standards-reviewer'}]},
        {instances: [{...valid, extra: true}]},
        {instances: [valid], extra: true},
    ]) {
        await assert.rejects(prepareReviewerCapabilityConformance({
            agentIdentity, preparedPath: source.preparedPath, repositoryRoot, selection,
        }));
    }
});

test('Spec Readiness local preparation replaces one whole scene and retains same-order paired evidence', async () => {
    const {instances, originalPreparedBytes, originalReportBytes, prepared, repositoryRoot, response, selected,
        source, sourceInstances, sourceResponse, state, pending} = specReadinessLocalRecoveryFixture;
    assert.equal(state.previousPrepared?.preparedPath, source.preparedPath);
    assert.equal(state.previousPrepared?.sha256, createHash('sha256').update(originalPreparedBytes).digest('hex'));
    assert.equal(prepared.handoffs.length, 3);
    assert.equal(prepared.generations.length, 3);
    assert.deepEqual(prepared.handoffs.map(entry => entry.scenarioId), Array(3).fill('runtime-migration'));
    for (const [index, instance] of instances.entries()) {
        const original = requireValue(sourceInstances[index], 'Expected source scene position.');
        if (index % 2 === 0) {
            assert.equal(instance.scenarioId, 'runtime-migration');
            assert.notEqual(instance.instanceId, original.instanceId);
            assert.notEqual(instance.scenarioRoot, original.scenarioRoot);
            assert.notEqual(instance.reportPath, original.reportPath);
            assert.equal(response.instances[index]?.instanceId, instance.instanceId);
        } else {
            assert.deepEqual(instance, original);
            assert.equal(response.instances[index], sourceResponse.instances[index]);
        }
    }
    assert.deepEqual(selected.map(instance => instance.instanceId), sourceInstances.filter((_, index) => index % 2 === 0)
        .map(instance => instance.instanceId));
    assert.equal(pending.status, 'needs-adjudication');
    assert.ok(pending.candidates?.some(candidate => candidate.instanceId === instances[0].instanceId));
    assert.ok(pending.candidates?.some(candidate => candidate.instanceId === instances[3].instanceId));
    assert.deepEqual(await readFile(source.preparedPath), originalPreparedBytes);
    for (const [index, original] of sourceInstances.entries()) {
        assert.deepEqual(await readFile(original.reportPath), originalReportBytes[index]);
    }
});

test('Spec Readiness local final scoring consumes all three current scene pairs', async () => {
    const {adjudication, prepared, repositoryRoot, response} = specReadinessLocalRecoveryFixture;
    const result = await rawVerifyReviewerCapabilityConformance({
        adjudication, agentIdentity, input: {artifacts: [response]}, preparedPath: prepared.preparedPath, repositoryRoot,
    });
    const score = requireValue(result.results?.[0], 'Expected complete recovered Spec Readiness score.');
    assert.equal(result.status, 'failed');
    assert.equal(score.repetitionScores.length, 3);

    assert.equal(score.scoreGate, 'failed');
    const [requirements, fullReview] = requireValue((await readPreparedState(prepared.preparedPath)).contracts[0],
        'Expected paired Spec Readiness contract.').instances;
    const totalProblems = requirements.expected.problemCount + fullReview.expected.problemCount;
    const expectedF2 = (/** @type {number} */ detected) => 5 * (detected / totalProblems) / (4 + detected / totalProblems);
    [1, 3, 5].forEach((detected, index) => assert.ok(
        Math.abs(score.repetitionScores[index] - expectedF2(detected)) < 1e-12,
        `Expected current paired repetition ${index + 1} score.`,
    ));
});

test('Spec Readiness local verification still requires every paired scene and repetition', async () => {
    const {prepared, repositoryRoot, response} = specReadinessLocalRecoveryFixture;
    for (const missingIndex of [1, 2]) {
        const result = await rawVerifyReviewerCapabilityConformance({
            agentIdentity,
            input: {artifacts: [{...response, instances: response.instances.filter((_, index) => index !== missingIndex)}]},
            preparedPath: prepared.preparedPath,
            repositoryRoot,
        });
        assert.equal(result.status, 'failed', JSON.stringify(result));
    }
});

test('consecutive local preparations preserve the prior replacement and bind a second new repetition', async () => {
    const {prepared: first, repositoryRoot, replacement: firstReplacement, response: firstResponse,
        state: firstState} = codeSpecLocalRecoveryFixture;
    const selected = requireValue(firstState.contracts[0]?.instances[2], 'Expected third current repetition.');
    const firstBytes = await readFile(first.preparedPath);
    const firstReportBytes = await readFile(firstReplacement.reportPath);
    const second = await prepareReviewerCapabilityConformance({
        agentIdentity,
        preparedPath: first.preparedPath,
        repositoryRoot,
        selection: {instances: [{instanceId: selected.instanceId, reviewerId: 'code-spec-reviewer'}]},
    });
    const secondState = await readPreparedState(second.preparedPath);
    const secondReplacement = requireValue(secondState.contracts[0]?.instances[2], 'Expected second local replacement.');
    assert.deepEqual(secondState.previousPrepared, {
        preparedPath: first.preparedPath,
        sha256: createHash('sha256').update(firstBytes).digest('hex'),
    });
    assert.deepEqual(secondState.contracts[0].instances.slice(0, 2), firstState.contracts[0].instances.slice(0, 2));
    assert.notEqual(secondReplacement.instanceId, selected.instanceId);
    assert.deepEqual(second.handoffs.map(handoff => handoff.instanceId), [secondReplacement.instanceId]);
    await writeFile(secondReplacement.reportPath, completeMarkdownResponse(secondReplacement.expected), 'utf8');
    const current = firstResponse.instances.map((instance, index) => index === 2
        ? {artifactPaths: [secondReplacement.reportPath], instanceId: secondReplacement.instanceId}
        : instance);
    const pending = await rawVerifyReviewerCapabilityConformance({
        agentIdentity,
        input: {artifacts: [{instances: current, reviewerId: 'code-spec-reviewer'}]},
        preparedPath: second.preparedPath,
        repositoryRoot,
    });
    assert.equal(pending.status, 'needs-adjudication', JSON.stringify(pending.diagnostics));
    assert.deepEqual(await readFile(first.preparedPath), firstBytes);
    assert.deepEqual(await readFile(firstReplacement.reportPath), firstReportBytes);
});

test('local verification closes a missing or byte-changed source record', async () => {
    const {prepared, repositoryRoot, response, source} = codeSpecLocalRecoveryFixture;
    const sourceBytes = await readFile(source.preparedPath);
    const input = {agentIdentity, input: {artifacts: [response]}, preparedPath: prepared.preparedPath, repositoryRoot};
    try {
        await writeFile(source.preparedPath, Buffer.concat([sourceBytes, Buffer.from(' ')]));
        await assert.rejects(rawVerifyReviewerCapabilityConformance(input), /previous prepared record bytes changed/u);
    } finally {
        await writeFile(source.preparedPath, sourceBytes);
    }
    const hiddenPath = `${source.preparedPath}.hidden`;
    await rename(source.preparedPath, hiddenPath);
    try {
        await assert.rejects(rawVerifyReviewerCapabilityConformance(input), /ENOENT|no such file/u);
    } finally {
        await rename(hiddenPath, source.preparedPath);
    }
    assert.deepEqual(await readFile(source.preparedPath), sourceBytes);
});

test('local verification rejects forged retained and replacement bindings', async () => {
    const {prepared, repositoryRoot, response, selected, source, sourceState} = codeSpecLocalRecoveryFixture;
    const preparedBytes = await readFile(prepared.preparedPath);
    const input = {agentIdentity, input: {artifacts: [response]}, preparedPath: prepared.preparedPath, repositoryRoot};
    const foreign = await prepareReviewerCapabilityConformance({
        agentIdentity, preparedPath: source.preparedPath, repositoryRoot,
        selection: {instances: [{instanceId: selected.instanceId, reviewerId: 'code-spec-reviewer'}]},
    });
    const foreignState = await readPreparedState(foreign.preparedPath);
    try {
        for (const position of [0, 1]) {
            const forged = JSON.parse(preparedBytes.toString('utf8'));
            forged.contracts[0].instances[position] = position === 0
                ? sourceState.contracts[0].instances[2]
                : foreignState.contracts[0].instances[1];
            await writeFile(prepared.preparedPath, JSON.stringify(forged));
            await assert.rejects(rawVerifyReviewerCapabilityConformance(input),
                /prepared instance contract is invalid/u, `Position ${position} accepted a forged binding.`);
        }
        const cycle = JSON.parse(preparedBytes.toString('utf8'));
        cycle.previousPrepared.preparedPath = prepared.preparedPath;
        await writeFile(prepared.preparedPath, JSON.stringify(cycle));
        await assert.rejects(rawVerifyReviewerCapabilityConformance(input), /source chain contains a cycle/u);
    } finally {
        await writeFile(prepared.preparedPath, preparedBytes);
    }
    assert.deepEqual(await readFile(prepared.preparedPath), preparedBytes);
});

test('local preparation rejects drift in an unselected staged scene without adding it to the selection', async () => {
    const {repositoryRoot, selected, source, sourceState} = codeSpecLocalRecoveryFixture;
    const retained = requireValue(sourceState.contracts[0]?.instances[0], 'Expected retained scene.');
    const runCommand = requireValue(sharedRunCommands.get(repositoryRoot), 'Expected fixture Git runner.');
    const changedPaths = await runCommand('git', ['diff', '--cached', '--name-only'], {cwd: retained.scenarioRoot});
    assert.equal(changedPaths.exitCode, 0);
    const path = requireValue(String(changedPaths.stdout).trim().split('\n')[0], 'Expected staged candidate file.');
    const absolutePath = join(retained.scenarioRoot, ...path.split('/'));
    const originalBytes = await readFile(absolutePath);
    try {
        await writeFile(absolutePath, Buffer.concat([originalBytes, Buffer.from('\nDrifted staged evidence.\n')]));
        const staged = await runCommand('git', ['add', path], {cwd: retained.scenarioRoot});
        assert.equal(staged.exitCode, 0);
        await assert.rejects(prepareReviewerCapabilityConformance({
            agentIdentity,
            preparedPath: source.preparedPath,
            repositoryRoot,
            selection: {instances: [{instanceId: selected.instanceId, reviewerId: 'code-spec-reviewer'}]},
        }), /drift|digest|changed|binding/u);
    } finally {
        await writeFile(absolutePath, originalBytes);
        const restored = await runCommand('git', ['add', path], {cwd: retained.scenarioRoot});
        assert.equal(restored.exitCode, 0);
    }
});

test('release local selection distinguishes the same instance ID across Reviewer roles', async () => {
    const {prepared, repositoryRoot, selected, source, sourceState, state} = multiRoleLocalRecoveryFixture;
    assert.equal(sourceState.mode, 'release');
    assert.deepEqual(sourceState.reviewerIds, ['code-spec-reviewer', 'code-standards-reviewer']);
    assert.equal(sourceState.contracts[0].instances[0].instanceId, sourceState.contracts[1].instances[0].instanceId);
    assert.equal(sourceState.contracts[0].instances[0].instanceId, selected.instanceId);
    assert.equal(state.previousPrepared?.preparedPath, source.preparedPath);
    assert.notEqual(state.contracts[0].instances[0].instanceId, selected.instanceId);
    assert.deepEqual(state.contracts[0].instances.slice(1), sourceState.contracts[0].instances.slice(1));
    assert.deepEqual(state.contracts[1], sourceState.contracts[1]);
    assert.deepEqual(prepared.handoffs.map(handoff => [handoff.reviewerId, handoff.instanceId]),
        [['code-spec-reviewer', state.contracts[0].instances[0].instanceId]]);
    const identity = {instanceId: selected.instanceId, reviewerId: 'code-spec-reviewer'};
    await assert.rejects(prepareReviewerCapabilityConformance({
        agentIdentity, preparedPath: source.preparedPath, repositoryRoot,
        selection: {instances: [identity, identity]},
    }));
});

test('release recovery refreshes changed Role identity only after rebuilding every instance of that Reviewer', async () => {
    const {prepared, roleBytes, selection, source, sourceState, state} = releaseRoleChangeRecoveryFixture;
    const currentCodeSpec = requireValue(state.contracts.find(contract => contract.reviewerId === 'code-spec-reviewer'),
        'Expected rebuilt Code Spec contract.');
    const previousCodeSpec = requireValue(sourceState.contracts.find(contract => contract.reviewerId === 'code-spec-reviewer'),
        'Expected original Code Spec contract.');
    assert.notEqual(currentCodeSpec.roleSha256, previousCodeSpec.roleSha256);
    assert.equal(currentCodeSpec.roleSha256, createHash('sha256').update(roleBytes).digest('hex'));
    assert.equal(currentCodeSpec.reviewerInstructionsSha256, previousCodeSpec.reviewerInstructionsSha256);
    assert.equal(currentCodeSpec.scenarioRevision, previousCodeSpec.scenarioRevision);
    assert.deepEqual(state.contracts.find(contract => contract.reviewerId === 'code-standards-reviewer'),
        sourceState.contracts.find(contract => contract.reviewerId === 'code-standards-reviewer'));
    assert.equal(prepared.handoffs.length, 3);
    assert.deepEqual(prepared.handoffs.map(handoff => handoff.reviewerId), Array(3).fill('code-spec-reviewer'));
    assert.ok(currentCodeSpec.instances.every((instance, index) => instance.instanceId !== previousCodeSpec.instances[index].instanceId));
    assert.equal(state.previousPrepared?.preparedPath, source.preparedPath);
    assert.equal(selection.instances.length, 3);
});

test('release recovery rejects a changed Role when any old instance would be retained', async () => {
    const {repositoryRoot, selection, source} = releaseRoleChangeRecoveryFixture;
    await assert.rejects(prepareReviewerCapabilityConformance({
        agentIdentity,
        preparedPath: source.preparedPath,
        repositoryRoot,
        selection: {instances: [selection.instances[0]]},
    }), /canonical Role changed|retained binding|Role/u);
});

test('historical source revision permits complete rebuild but rejects retained old scenes', async () => {
    const {repositoryRoot, source, sourceState} = codeSpecLocalRecoveryFixture;
    const sourceBytes = await readFile(source.preparedPath);
    const historical = JSON.parse(sourceBytes.toString('utf8'));
    const currentRevision = sourceState.contracts[0].scenarioRevision;
    assert.ok(currentRevision > 1);
    historical.contracts[0].scenarioRevision = currentRevision - 1;
    await writeFile(source.preparedPath, JSON.stringify(historical));
    try {
        const historicalBytes = await readFile(source.preparedPath);
        const selection = sourceState.contracts[0].instances.map(instance => ({
            instanceId: instance.instanceId, reviewerId: 'code-spec-reviewer',
        }));
        await assert.rejects(prepareReviewerCapabilityConformance({
            agentIdentity, preparedPath: source.preparedPath, repositoryRoot,
            selection: {instances: [selection[0]]},
        }), /retained scenario revision is no longer current/u);
        const prepared = await prepareReviewerCapabilityConformance({
            agentIdentity, preparedPath: source.preparedPath, repositoryRoot,
            selection: {instances: selection},
        });
        const state = await readPreparedState(prepared.preparedPath);
        assert.equal(state.contracts[0].scenarioRevision, currentRevision);
        assert.deepEqual(state.previousPrepared, {
            preparedPath: source.preparedPath,
            sha256: createHash('sha256').update(historicalBytes).digest('hex'),
        });
        assert.equal(prepared.handoffs.length, 3);
        assert.ok(state.contracts[0].instances.every((instance, index) =>
            instance.instanceId !== sourceState.contracts[0].instances[index].instanceId));
        const incomplete = await rawVerifyReviewerCapabilityConformance({
            agentIdentity, input: {artifacts: []}, preparedPath: prepared.preparedPath, repositoryRoot,
        });
        assert.equal(incomplete.status, 'failed');
    } finally {
        await writeFile(source.preparedPath, sourceBytes);
    }
    assert.deepEqual(await readFile(source.preparedPath), sourceBytes);
});

test('a complete format correction preserves the original report and discounts only its repetition', async t => {
    const {prepared, repositoryRoot, responses} = codeSpecCapabilityFixture;
    const response = requireValue(responses[0], 'Expected Code Spec response.');
    await withCapabilityArtifactSnapshots(response, async snapshots => {
        const original = requireValue(response.instances[1], 'Expected second repetition.');
        const originalPath = requireValue(original.artifactPaths?.[0], 'Expected original report.');
        const originalText = requireValue(snapshots[1]?.sources[0], 'Expected complete report.');
        const malformedText = `# Unsupported heading\n${originalText}`;
        const correctedReportPath = join(dirname(originalPath), 'format-correction-copy.md');
        await writeFile(originalPath, malformedText, 'utf8');
        await writeFile(correctedReportPath, originalText, 'utf8');
        try {
            const corrected = /** @type {CapabilityArtifactBatch} */ (structuredClone(response));
            corrected.instances[1] = {instanceId: original.instanceId, artifactPaths: null,
                formatCorrection: {originalReportPath: originalPath, correctedReportPath}};
            const result = await rawVerifyReviewerCapabilityConformance({
                adjudication: codeSpecBaselineAdjudication, agentIdentity, input: {artifacts: [corrected]},
                preparedPath: prepared.preparedPath, repositoryRoot,
            });
            assert.equal(result.status, 'verified', JSON.stringify(result));
            const score = requireValue(result.results?.[0], 'Expected corrected score.');
            assert.deepEqual(score.repetitionScores, [1, 1, 1]);
            assert.deepEqual(score.finalRepetitionScores, [1, 0.9, 1]);
            assert.equal(score.scoreBeforePenalty, 1);
            assert.ok(Math.abs(requireValue(score.score, 'Expected complete final mean.') - 2.9 / 3) < 1e-12);

            assert.deepEqual(result.diagnostics?.map(diagnostic => diagnostic.instanceId), [original.instanceId]);
            assert.equal(score.reportDiagnostics?.[0]?.instanceId, original.instanceId);
            assert.equal(score.reportDiagnostics?.[0]?.code, 'review-format-invalid');
            assert.match(score.reportDiagnostics?.[0]?.message ?? '', /only finding bullets/u);
            assert.equal(await readFile(originalPath, 'utf8'), malformedText);
            const configuration = {model:'explicit-model',reasoningEffort:'explicit-effort'};
            const statistics = aggregateConfiguration({configuration,allowPartial:true,
                verification:{'code-spec-reviewer':result},
                observations:corrected.instances.map((instance,index) => ({reviewerId:'code-spec-reviewer',scenarioId:'default',
                    repetition:index + 1,sampleKind:'formal',completed:true,
                    runtime:{actualModel:configuration.model,actualReasoningEffort:configuration.reasoningEffort,
                        durationMs:null,tokenUsage:null,conditions:{backend:'explicit-provider',serviceTier:'default'}},
                    delivery:{mode:'reviewer-bound-report',errors:[],mainAgentCorrectedScoringCopy:instance.formatCorrection !== undefined}}))});
            const outputDirectory = await createTemporaryDirectory(t,'arw-final-score-roundtrip-');
            const saved = await upsertStatisticsRole({outputDirectory,roleStatistics:statistics});
            const loaded = JSON.parse(await readFile(saved.path,'utf8'));
            assert.deepEqual(loaded[0].roles[0].repetitions.map((/** @type {{score:number}} */ repetition) => repetition.score),[1,0.9,1]);
            assert.equal(loaded[0].roles[0].repetitions[1].scoreSource,'diagnostic');
            assert.equal(loaded[0].observations[0].runtime.durationMs,null);
            assert.equal(Object.hasOwn(loaded[0].observations[0].runtime,'workDuration'),false);
            assert.equal(Object.hasOwn(loaded[0].observations[0].runtime,'modelPhases'),false);
            const rendered = renderTablesHtml(loaded);
            assert.match(rendered,/0\.900 <sup>\*<\/sup>/u);
            assert.equal(rendered,renderTablesHtml(JSON.parse(JSON.stringify(loaded))));
        } finally {
            await rm(correctedReportPath, {force: true});
        }
    });
});

test('format correction rejects a valid original, wrong binding, cross-scene copy, and malformed copy', async () => {
    const {prepared, repositoryRoot, responses} = codeSpecCapabilityFixture;
    const response = requireValue(responses[0], 'Expected Code Spec response.');
    await withCapabilityArtifactSnapshots(response, async snapshots => {
        const original = requireValue(response.instances[0], 'Expected first repetition.');
        const originalPath = requireValue(original.artifactPaths?.[0], 'Expected original report.');
        const completeText = requireValue(snapshots[0]?.sources[0], 'Expected complete report.');
        const correctedReportPath = join(dirname(originalPath), 'binding-copy.md');
        await writeFile(correctedReportPath, completeText, 'utf8');
        const corrected = /** @type {CapabilityArtifactBatch} */ (structuredClone(response));
        corrected.instances[0] = {instanceId: original.instanceId, artifactPaths: null,
            formatCorrection: {originalReportPath: originalPath, correctedReportPath}};
        const verify = () => rawVerifyReviewerCapabilityConformance({
            agentIdentity, input: {artifacts: [corrected]}, preparedPath: prepared.preparedPath, repositoryRoot,
        });
        try {
            assert.equal((await verify()).status, 'failed', 'A valid original cannot claim a format error.');
            await writeFile(originalPath, `# Unsupported heading\n${completeText}`, 'utf8');
            const correction = requireValue(corrected.instances[0].formatCorrection, 'Expected correction binding.');
            correction.originalReportPath = response.instances[1].artifactPaths[0];
            assert.equal((await verify()).status, 'failed', 'Another instance cannot supply the original report.');
            correction.originalReportPath = originalPath;
            correction.correctedReportPath = response.instances[1].artifactPaths[0];
            assert.equal((await verify()).status, 'failed', 'Another scene cannot supply the scoring copy.');
            correction.correctedReportPath = correctedReportPath;
            await writeFile(correctedReportPath, '# Still malformed\n', 'utf8');
            assert.equal((await verify()).status, 'failed', 'A scoring copy must pass the role format check.');
        } finally {
            await rm(correctedReportPath, {force: true});
        }
    });
});

test('the final average fails the score gate when the uncorrected average reaches it', async () => {
    const {prepared, repositoryRoot, responses} = codeSpecCapabilityFixture;
    const response = requireValue(responses[0], 'Expected Code Spec response.');
    await withCapabilityArtifactSnapshots(response, async snapshots => {
        const corrected = /** @type {CapabilityArtifactBatch} */ (structuredClone(response));
        const copies = [];
        try {
            for (const index of [0, 1]) {
                const original = requireValue(response.instances[index], 'Expected full repetition.');
                const originalReportPath = requireValue(original.artifactPaths?.[0], 'Expected original report.');
                const completeText = requireValue(snapshots[index]?.sources[0], 'Expected full report.');
                const correctedReportPath = join(dirname(originalReportPath), `threshold-copy-${index}.md`);
                copies.push(correctedReportPath);
                await writeFile(originalReportPath, `# Unsupported heading\n${completeText}`, 'utf8');
                await writeFile(correctedReportPath, completeText, 'utf8');
                corrected.instances[index] = {instanceId: original.instanceId, artifactPaths: null,
                    formatCorrection: {originalReportPath, correctedReportPath}};
            }
            const third = requireValue(response.instances[2], 'Expected partial repetition.');
            const thirdReportPath = requireValue(third.artifactPaths?.[0], 'Expected third report.');
            const fullThird = requireValue(snapshots[2]?.sources[0], 'Expected third complete report.');
            await writeFile(thirdReportPath, `${fullThird.trimEnd().split('\n').slice(0, 6).join('\n')}\n`, 'utf8');
            const result = await rawVerifyReviewerCapabilityConformance({
                adjudication: codeSpecThresholdAdjudication, agentIdentity, input: {artifacts: [corrected]},
                preparedPath: prepared.preparedPath, repositoryRoot,
            });
            assert.equal(result.status, 'failed');
            const score = requireValue(result.results?.[0], 'Expected both average scores.');
            assert.ok(requireValue(score.scoreBeforePenalty, 'Expected complete original mean.') >= 0.75, JSON.stringify(score));
            assert.ok(requireValue(score.score, 'Expected complete final mean.') < 0.75, JSON.stringify(score));
            assert.deepEqual(score.finalRepetitionScores,
                score.repetitionScores.map((value, index) => index < 2 ? value * 0.9 : value));
            assert.equal(score.scoreGate, 'failed');

        } finally {
            await Promise.all(copies.map(path => rm(path, {force: true})));
        }
    });
});





test('public verification averages complete repetitions without a per-repetition score gate', async () => {
    const {prepared, repositoryRoot, responses} = codeSpecCapabilityFixture;
    await withCapabilityArtifactSnapshots(responses[0], async snapshots => {
        const first = requireValue(snapshots[0], 'Expected first Reviewer repetition.');
        const lines = requireValue(first.sources[0], 'Expected Reviewer report.').trimEnd().split('\n');
        await writeFile(first.artifactPaths[0], `${lines.slice(0, Math.ceil(lines.length / 2)).join('\n')}\n`, 'utf8');
        const result = await verifyReviewerCapabilityConformance({
            agentIdentity,
            input: {artifacts: responses},
            preparedPath: prepared.preparedPath,
            repositoryRoot,
        });
        const score = requireValue(result.results?.[0], 'Expected public Reviewer score.');
        assert.equal(result.status, 'verified');
        assert.equal(score.repetitionScores.length, 3);
        assert.ok(score.repetitionScores[0] < 0.75);
        assert.deepEqual(score.repetitionScores.slice(1), [1, 1]);
        assert.equal(score.score, score.repetitionScores.reduce((sum, value) => sum + value, 0) / 3);
        assert.ok(score.score >= 0.75);
        assert.equal(score.scoreGate, 'passed');

    });
});

test('formal report diagnostics retain every failed instance without marking healthy repetitions', async () => {
    const {prepared, repositoryRoot, responses} = codeSpecCapabilityFixture;
    const response = requireValue(responses[0], 'Expected Code Spec response.');
    await withCapabilityArtifactSnapshots(response, async snapshots => {
        const first = requireValue(snapshots[0], 'Expected first report.');
        const third = requireValue(snapshots[2], 'Expected third report.');
        const options = {agentIdentity, input: {artifacts: [response]}, preparedPath: prepared.preparedPath, repositoryRoot};
        await writeFile(first.artifactPaths[0], '# malformed report\n', 'utf8');
        const oneFailed = await rawVerifyReviewerCapabilityConformance(options);
        assert.equal(oneFailed.status, 'failed');
        assert.deepEqual(oneFailed.diagnostics?.map(diagnostic => diagnostic.instanceId), [response.instances[0].instanceId]);
        assert.equal(oneFailed.diagnostics?.[0]?.code, 'scoring-input-invalid');
        await writeFile(third.artifactPaths[0], '# another malformed report\n', 'utf8');
        const twoFailed = await rawVerifyReviewerCapabilityConformance(options);
        assert.equal(twoFailed.status, 'failed');
        assert.deepEqual(twoFailed.diagnostics?.map(diagnostic => diagnostic.instanceId),
            [response.instances[0].instanceId, response.instances[2].instanceId]);
        assert.deepEqual(twoFailed.diagnostics?.[0], oneFailed.diagnostics?.[0]);
        assert.equal(twoFailed.diagnostics?.some(diagnostic => diagnostic.instanceId === response.instances[1].instanceId), false);
    });
});

test('partial scoring binds complete prepared repetitions and uses the same case scores', async () => {
    const {prepared, repositoryRoot, responses} = codeSpecCapabilityFixture;
    const fullInput = {artifacts: [{...responses[0], instances: responses[0].instances.map((instance, index) => (
        index === 0 ? {...instance, artifactPaths: null} : instance
    ))}]};
    const formal = await rawVerifyReviewerCapabilityConformance({
        agentIdentity, input: fullInput, preparedPath: prepared.preparedPath, repositoryRoot,
    });
    assert.equal(formal.status, 'failed');
    const input = {artifacts: [{...responses[0], instances: responses[0].instances.slice(1)}]};
    const options = {
        agentIdentity,
        input,
        preparedPath: prepared.preparedPath,
        repositoryRoot,
        runCommand: requireValue(sharedRunCommands.get(repositoryRoot), 'Expected Git command adapter.'),
    };
    const selectedInstances = new Set(input.artifacts[0].instances.map(instance => instance.instanceId));
    const scored = await scoreReviewerCapabilityCompletedRepetitions({
        ...options,
        adjudication: {decisions: codeSpecBaselineAdjudication.decisions.filter(decision => (
            [...selectedInstances].some(instanceId => decision.candidateId.includes(`:${instanceId}:`))
        ))},
    });
    assert.equal(scored.status, 'diagnostic');
    const score = reviewerScore(scored);
    assert.deepEqual(score.repetitionScores, [1, 1]);
    assert.deepEqual(score.finalRepetitionScores, [1, 1]);
    assert.deepEqual(score.repetitions.map(entry => entry.repetition), [2, 3]);
    assert.deepEqual(score.reportDiagnostics, []);
    assert.equal(score.score, undefined);
    const wrongInstance = structuredClone(input);
    wrongInstance.artifacts[0].instances[0].instanceId = 'default-other-run-instance-2';
    const rejected = await scoreReviewerCapabilityCompletedRepetitions({...options, input: wrongInstance});
    assert.equal(rejected.status, 'failed');
});

test('an explicit model failure scores zero only for an empty bound report', async () => {
    const {prepared, repositoryRoot, responses} = codeSpecCapabilityFixture;
    await withCapabilityArtifactSnapshots(responses[0], async snapshots => {
        const failure = (/** @type {CapabilityArtifact} */ instance) => ({instanceId: instance.instanceId,
            artifactPaths: null, modelFailure: {reason: 'Reviewer abandoned the bound report without scorable content.'}});
        await writeFile(snapshots[0].artifactPaths[0], '', 'utf8');
        const options = {agentIdentity,
            input: {artifacts: [{...responses[0], instances: responses[0].instances.map((instance, index) => index === 0 ? failure(instance) : instance)}]},
            preparedPath: prepared.preparedPath, repositoryRoot};
        const pending = await scoreReviewerCapabilityCompletedRepetitions(options);
        assert.equal(pending.status, 'needs-adjudication');
        const scored = await scoreReviewerCapabilityCompletedRepetitions({...options,
            adjudication: {decisions: await fixtureCandidateDecisions(options,
                requireValue(pending.candidates, 'Expected candidates from complete reports.'))}});
        assert.equal(scored.status, 'diagnostic');
        const score = reviewerScore(scored);
        assert.deepEqual(score.repetitionScores, [0, 1, 1]);
        assert.equal(score.score, 2 / 3);
        assert.equal(score.instances[0].modelFailure?.reason, failure(responses[0].instances[0]).modelFailure.reason);
        const nonemptyFailure = await scoreReviewerCapabilityCompletedRepetitions({...options,
            input: {artifacts: [{...responses[0], instances: responses[0].instances.map(failure)}]}});
        assert.equal(nonemptyFailure.status, 'failed');
        await Promise.all(snapshots.map(snapshot => writeFile(snapshot.artifactPaths[0], '', 'utf8')));
        const allZero = await scoreReviewerCapabilityCompletedRepetitions({...options,
            input: {artifacts: [{...responses[0], instances: responses[0].instances.map(failure)}]}});
        assert.equal(allZero.status, 'diagnostic');
        assert.deepEqual(reviewerScore(allZero).reportDiagnostics, []);
        assert.equal(reviewerScore(allZero).score, 0);
        assert.deepEqual(reviewerScore(allZero).repetitionScores, [0, 0, 0]);
    });
});

test('Commit Audit model failure retains missing judgments from an empty original report', async () => {
    const {contract, prepared, repositoryRoot, response} = commitAuditCapabilityFixture;
    const original = requireValue(contract.instances[0], 'Expected first Commit Audit instance.');
    await withCapabilityArtifactSnapshots({instances: [{artifactPaths: [original.reportPath], instanceId: original.instanceId}]}, async () => {
        await writeFile(original.reportPath, '', 'utf8');
        const modelFailure = {reason: 'Reviewer left the bound Commit Audit report empty.'};
        const scored = await scoreReviewerCapabilityCompletedRepetitions({agentIdentity,
            input: {artifacts: [{reviewerId: response.reviewerId,
                instances: [{artifactPaths: null, instanceId: original.instanceId, modelFailure}]}]},
            preparedPath: prepared.preparedPath, repositoryRoot});
        assert.equal(scored.status, 'diagnostic');
        const score = reviewerScore(scored);
        const instance = requireValue(score.instances[0], 'Expected zero-scored instance.');
        assert.ok(score.reportDiagnostics.some(entry => entry.code === 'requirement-missing' && entry.message.includes('Gate 1')));
        assert.ok(score.reportDiagnostics.some(entry => entry.code === 'requirement-missing' && entry.message.includes('Gate 2')));
        assert.ok(score.reportDiagnostics.every(entry => entry.instanceId === original.instanceId));
        assert.deepEqual(instance.reportDiagnostics, score.reportDiagnostics);
        assert.deepEqual(score.repetitions[0].reportDiagnostics, score.reportDiagnostics);
        assert.deepEqual(instance.modelFailure, modelFailure);
        assert.equal(instance.earnedProblemPoints, 0);
        assert.equal(instance.earnedCleanPoints, 0);
        assert.equal(instance.totalProblemCases, original.expected.problemCount);
        assert.equal(instance.totalCleanCases, original.expected.cleanCount);
        assert.deepEqual(score.repetitionScores, [0]);
        assert.deepEqual(score.finalRepetitionScores, [0]);
        assert.equal(score.score, undefined);
        assert.equal(await readFile(original.reportPath, 'utf8'), '');
    });
});

test('Code Spec model failure retains format errors from a nonempty unparseable original report', async () => {
    const {prepared, repositoryRoot, responses} = codeSpecCapabilityFixture;
    const response = requireValue(responses[0], 'Expected Code Spec response.');
    const original = requireValue(response.instances[0], 'Expected first Code Spec instance.');
    await withCapabilityArtifactSnapshots({instances: [original]}, async snapshots => {
        const originalPath = requireValue(snapshots[0]?.artifactPaths[0], 'Expected original report.');
        const originalText = 'Reviewer abandoned the review without producing finding bullets.\n';
        await writeFile(originalPath, originalText, 'utf8');
        const modelFailure = {reason: 'Reviewer produced only unstructured prose in the bound report.'};
        const scored = await scoreReviewerCapabilityCompletedRepetitions({agentIdentity,
            input: {artifacts: [{reviewerId: response.reviewerId,
                instances: [{artifactPaths: null, instanceId: original.instanceId, modelFailure}]}]},
            preparedPath: prepared.preparedPath, repositoryRoot});
        assert.equal(scored.status, 'diagnostic');
        const score = reviewerScore(scored);
        const instance = requireValue(score.instances[0], 'Expected zero-scored instance.');
        assert.deepEqual(score.reportDiagnostics.map(entry => entry.code), ['review-format-invalid']);
        assert.equal(score.reportDiagnostics[0].instanceId, original.instanceId);
        assert.match(score.reportDiagnostics[0].message, /no parseable finding representation/);
        assert.deepEqual(instance.reportDiagnostics, score.reportDiagnostics);
        assert.deepEqual(score.repetitions[0].reportDiagnostics, score.reportDiagnostics);
        assert.deepEqual(instance.modelFailure, modelFailure);
        assert.ok(instance.caseScores.problem.every(value => value === 0));
        assert.ok(instance.caseScores.clean.flat().every(value => value === 0));
        assert.deepEqual(score.repetitionScores, [0]);
        assert.deepEqual(score.finalRepetitionScores, [0]);
        assert.equal(score.score, undefined);
        assert.equal(await readFile(originalPath, 'utf8'), originalText);
    });
});

test('Spec Readiness model failure retains every invalid line and the valid paired scene score', async () => {
    const {adjudication, contract, prepared, repositoryRoot, response} = specReadinessCapabilityFixture;
    const runtime = requireValue(contract.instances[2], 'Expected second runtime-migration instance.');
    const promotion = requireValue(contract.instances[3], 'Expected second artifact-promotion instance.');
    const pairedReport = requireValue(response.instances[3], 'Expected valid paired report.');
    await withCapabilityArtifactSnapshots({instances: [{artifactPaths: [runtime.reportPath], instanceId: runtime.instanceId}]}, async () => {
        const originalText = 'invalid JSON\n[]\n';
        await writeFile(runtime.reportPath, originalText, 'utf8');
        const modelFailure = {reason: 'Reviewer produced no valid JSONL finding in the bound report.'};
        const scored = await scoreReviewerCapabilityCompletedRepetitions({agentIdentity,
            input: {artifacts: [{reviewerId: response.reviewerId, instances: [
                {artifactPaths: null, instanceId: runtime.instanceId, modelFailure}, pairedReport,
            ]}]},
            adjudication: {decisions: adjudication.decisions.filter(decision => decision.candidateId.includes(`:${promotion.instanceId}:`))},
            preparedPath: prepared.preparedPath, repositoryRoot});
        assert.equal(scored.status, 'diagnostic');
        const score = reviewerScore(scored);
        assert.deepEqual(score.reportDiagnostics.map(entry => ({code: entry.code, instanceId: entry.instanceId, line: entry.line})), [
            {code: 'review-format-invalid', instanceId: runtime.instanceId, line: 1},
            {code: 'review-format-invalid', instanceId: runtime.instanceId, line: 2},
        ]);
        const failed = requireValue(score.instances.find(instance => instance.instanceId === runtime.instanceId), 'Expected failed instance.');
        const valid = requireValue(score.instances.find(instance => instance.instanceId === promotion.instanceId), 'Expected valid paired instance.');
        assert.deepEqual(failed.modelFailure, modelFailure);
        assert.deepEqual(failed.reportDiagnostics, score.reportDiagnostics);
        assert.ok(failed.caseScores.problem.every(value => value === 0));
        assert.ok(failed.caseScores.clean.flat().every(value => value === 0));
        assert.equal(valid.earnedProblemPoints, 1);
        assert.equal(valid.earnedCleanPoints, promotion.expected.cleanCount);
        assert.deepEqual(valid.reportDiagnostics, []);
        const repetition = requireValue(score.repetitions[0], 'Expected complete second repetition.');
        const totalProblems = runtime.expected.problemCount + promotion.expected.problemCount;
        const totalClean = runtime.expected.cleanCount + promotion.expected.cleanCount;
        const problemRate = 1 / totalProblems;
        const cleanRate = promotion.expected.cleanCount / totalClean;
        const expectedScore = 5 * problemRate * cleanRate / (4 * cleanRate + problemRate);
        assert.equal(repetition.repetition, 2);
        assert.equal(repetition.totalProblemCases, totalProblems);
        assert.equal(repetition.totalCleanCases, totalClean);
        assert.equal(repetition.earnedProblemPoints, 1);
        assert.equal(repetition.earnedCleanPoints, promotion.expected.cleanCount);
        assert.deepEqual(repetition.reportDiagnostics, score.reportDiagnostics);
        assert.equal(score.repetitionScores.length, 1);
        assert.ok(Math.abs(score.repetitionScores[0] - expectedScore) < 1e-12);
        assert.equal(repetition.scoreBeforePenalty, score.repetitionScores[0]);
        assert.deepEqual(score.finalRepetitionScores, [score.repetitionScores[0] * 0.9]);
        assert.equal(repetition.score, score.finalRepetitionScores[0]);
        assert.equal(score.score, undefined);
        assert.equal(await readFile(runtime.reportPath, 'utf8'), originalText);
    });
});

test('partial scoring accepts only a bound independent format copy', async () => {
    const {prepared, repositoryRoot, responses} = codeSpecCapabilityFixture;
    const original = requireValue(responses[0].instances[1], 'Expected second prepared repetition.');
    const originalPath = requireValue(original.artifactPaths?.[0], 'Expected original report.');
    const correctedPath = join(dirname(originalPath), 'partial-format-copy.md');
    await withCapabilityArtifactSnapshots({instances: [original]}, async snapshots => {
        const malformedText = `# Unsupported heading\n${requireValue(snapshots[0]?.sources[0], 'Expected source report.')}`;
        await writeFile(originalPath, malformedText, 'utf8');
        await writeFile(correctedPath, requireValue(snapshots[0]?.sources[0], 'Expected source report.'), 'utf8');
        try {
            const input = {artifacts: [{...responses[0], instances: responses[0].instances.slice(1)}]};
            const options = {agentIdentity, input, preparedPath: prepared.preparedPath, repositoryRoot};
            assert.equal((await scoreReviewerCapabilityCompletedRepetitions(options)).status, 'needs-adjudication');
            const correctedInput = {artifacts: [{...responses[0], instances: [
                {instanceId: original.instanceId, artifactPaths: null,
                    formatCorrection: {originalReportPath: originalPath, correctedReportPath: correctedPath}},
                responses[0].instances[2],
            ]}]};
            const scored = await scoreReviewerCapabilityCompletedRepetitions({...options, input: correctedInput,
                adjudication: {decisions: codeSpecBaselineAdjudication.decisions.filter(decision =>
                    correctedInput.artifacts[0].instances.some(instance => decision.candidateId.includes(`:${instance.instanceId}:`)))}});
            assert.deepEqual(reviewerScore(scored).reportDiagnostics.map(entry => entry.instanceId), [original.instanceId]);
            assert.equal(reviewerScore(scored).reportDiagnostics[0]?.code, 'review-format-invalid');
            assert.equal(scored.status, 'diagnostic');
            assert.deepEqual(reviewerScore(scored).repetitionScores, [1, 1]);
            assert.deepEqual(reviewerScore(scored).finalRepetitionScores, [0.9, 1]);
            assert.equal(await readFile(originalPath, 'utf8'), malformedText);
            correctedInput.artifacts[0].instances[0].instanceId = responses[0].instances[0].instanceId;
            assert.equal((await scoreReviewerCapabilityCompletedRepetitions({...options, input: correctedInput})).status, 'failed');
        } finally {
            await rm(correctedPath, {force: true});
        }
    });
});

test('retry prepares and verifies an entirely fresh Reviewer batch', async () => {
    const {prepared: failedBatch, repositoryRoot, responses: oldResponses} = codeSpecCapabilityFixture;
    const retry = await prepareReviewerCapabilityConformance({
        agentIdentity,
        repositoryRoot,
        reviewerId: 'code-spec-reviewer',
    });
    const oldState = await readPreparedState(failedBatch.preparedPath);
    const newState = await readPreparedState(retry.preparedPath);
    assert.notEqual(retry.preparedPath, failedBatch.preparedPath);
    assert.notEqual(newState.runId, oldState.runId);
    assert.equal(newState.contracts[0].instances.every(instance => !Object.hasOwn(instance, 'repetition')), true);
    assert.equal(new Set([
        ...oldState.contracts[0].instances.map(instance => instance.instanceId),
        ...newState.contracts[0].instances.map(instance => instance.instanceId),
    ]).size, 6);
    assert.equal(new Set([
        ...oldState.contracts[0].instances.map(instance => instance.scenarioRoot),
        ...newState.contracts[0].instances.map(instance => instance.scenarioRoot),
    ]).size, 6);
    const stale = await rawVerifyReviewerCapabilityConformance({
        agentIdentity,
        input: {artifacts: oldResponses},
        preparedPath: retry.preparedPath,
        repositoryRoot,
    });
    assert.equal(stale.status, 'failed');
    assert.match(stale.diagnostics?.[0]?.message ?? '', /prepared instance|instance identities/i);
    const responses = await writeValidResponseBatch({prepared: retry, repositoryRoot});
    const result = await verifyReviewerCapabilityConformance({
        agentIdentity,
        input: {artifacts: responses},
        preparedPath: retry.preparedPath,
        repositoryRoot,
    });
    assert.equal(result.status, 'verified');
    assert.deepEqual(result.results?.[0]?.repetitionScores, [1, 1, 1]);
});

test('Spec Readiness public preparation pairs complete, unequal scenario sets by repetition', async () => {
    const {adjudication, contract, prepared, repositoryRoot, response} = specReadinessCapabilityFixture;
    assert.equal(prepared.handoffs.length, 6);
    assert.equal(prepared.generations.length, 3);
    assert.deepEqual(contract.instances.map(instance => instance.scenarioId), [
        'runtime-migration', 'artifact-promotion',
        'runtime-migration', 'artifact-promotion',
        'runtime-migration', 'artifact-promotion',
    ]);
    assert.deepEqual(prepared.handoffs.map(handoff => handoff.instanceId),
        contract.instances.map(instance => instance.instanceId));
    assert.equal(contract.instances.every(instance => !Object.hasOwn(instance, 'repetition')), true);
    assert.equal(prepared.handoffs.every(handoff => !Object.hasOwn(handoff, 'repetition')), true);
    assert.equal(prepared.generations.every(generation => !Object.hasOwn(generation, 'repetition')), true);
    assert.equal(new Set(contract.instances.map(instance => instance.instanceId)).size, 6);
    assert.equal(new Set(contract.instances.map(instance => instance.scenarioRoot)).size, 6);
    const [requirements, fullReview] = contract.instances;
    assert.notEqual(requirements.expected.problemCount, fullReview.expected.problemCount);
    assert.notEqual(requirements.expected.cleanCount, fullReview.expected.cleanCount);
    const generated = JSON.parse(await readFile(response.instances[0].artifactPaths[0], 'utf8'));
    assert.deepEqual(generated.checks.map((/** @type {{check: string}} */ check) => check.check), requirements.expected.scopes.map(scope => scope.scope));
    const result = await rawVerifyReviewerCapabilityConformance({
        adjudication, agentIdentity,
        input: {artifacts: [response]},
        preparedPath: prepared.preparedPath,
        repositoryRoot,
    });
    const score = requireValue(result.results?.[0], `Expected Spec Readiness result: ${JSON.stringify(result)}`);
    assert.equal(result.status, 'failed');
    const totalProblems = requirements.expected.problemCount + fullReview.expected.problemCount;
    const f2 = (/** @type {number} */ problemRate) => 5 * problemRate / (4 + problemRate);
    const pairedScores = [1, 3, 5].map(earned => f2(earned / totalProblems));
    assert.equal(score.repetitionScores.length, 3);
    score.repetitionScores.forEach((actual, index) => assert.ok(
        Math.abs(actual - pairedScores[index]) < 1e-12,
        `Expected repetition ${index + 1} to merge both scenario case sets: ${actual} vs ${pairedScores[index]}.`,
    ));
    const scenarioAverage = (f2(1 / requirements.expected.problemCount) + 0) / 2;
    assert.notEqual(score.repetitionScores[0], scenarioAverage);
    assert.equal(score.score, score.repetitionScores.reduce((sum, value) => sum + value, 0) / 3);
    const details = requireValue(score.repetitions[0], 'Expected first paired repetition.');
    assert.equal(details.totalProblemCases, requirements.expected.problemCount + fullReview.expected.problemCount);
    assert.equal(details.totalCleanCases, requirements.expected.cleanCount + fullReview.expected.cleanCount);
});

test('Spec Readiness discounts one paired repetition once when both scene reports need format copies', async () => {
    const {adjudication, contract, prepared, repositoryRoot, response} = specReadinessCapabilityFixture;
    const paired = contract.instances.slice(0, 2);
    const originals = await Promise.all(paired.map(async instance => ({
        instance,
        path: requireValue(instance.reportPath, 'Expected bound original report.'),
        text: await readFile(requireValue(instance.reportPath, 'Expected bound report.'), 'utf8'),
    })));
    const corrected = /** @type {CapabilityArtifactBatch} */ (structuredClone(response));
    const copies = [];
    try {
        for (const [index, original] of originals.entries()) {
            const correctedReportPath = join(dirname(original.path), `paired-format-copy-${index}.jsonl`);
            copies.push(correctedReportPath);
            await writeFile(original.path, `\`\`\`jsonl\n${original.text}\`\`\`\n`, 'utf8');
            await writeFile(correctedReportPath, original.text, 'utf8');
            corrected.instances[index] = {instanceId: original.instance.instanceId, artifactPaths: null,
                formatCorrection: {originalReportPath: original.path, correctedReportPath}};
        }
        const result = await scoreReviewerCapabilityCompletedRepetitions({
            adjudication: {decisions: adjudication.decisions.filter(decision => paired.some(instance =>
                decision.candidateId.includes(`:${instance.instanceId}:`)))},
            agentIdentity, input: {artifacts: [{...corrected, instances: corrected.instances.slice(0, 2)}]}, preparedPath: prepared.preparedPath, repositoryRoot,
        });
        const score = requireValue(result.results?.[0], `Expected paired score: ${JSON.stringify(result)}`);
        assert.deepEqual(score.repetitions.map(entry => entry.repetition), [1]);
        assert.equal(score.finalRepetitionScores[0], score.repetitionScores[0] * 0.9);
        assert.equal(score.score, undefined);
        assert.deepEqual([...new Set(score.reportDiagnostics.map(diagnostic => diagnostic.instanceId))],
            paired.map(instance => instance.instanceId));
        for (const original of originals) {
            assert.equal(await readFile(original.path, 'utf8'), `\`\`\`jsonl\n${original.text}\`\`\`\n`);
        }
    } finally {
        for (const original of originals) await writeFile(original.path, original.text, 'utf8');
        await Promise.all(copies.map(path => rm(path, {force: true})));
    }
});

test('Spec Readiness candidates bind canonical generated finding order rather than draft line order', async () => {
    const {contract, prepared, repositoryRoot, response} = specReadinessCapabilityFixture;
    const runtime = requireValue(contract.instances[4], 'Expected third runtime-migration instance.');
    const generation = requireValue(prepared.generations.find(entry => entry.instanceId === runtime.instanceId),
        'Expected runtime generation binding.');
    const draftPath = requireValue(generation.draftPath, 'Expected bound runtime draft.');
    const originalBytes = await readFile(draftPath);
    const originalArtifactPath = requireValue(response.instances[4]?.artifactPaths[0], 'Expected generated runtime artifact.');
    const originalArtifact = JSON.parse(await readFile(originalArtifactPath, 'utf8'));
    const requirementCheck = requireValue(originalArtifact.checks.find((/** @type {{check: string}} */ check) => (
        check.check === 'SPEC-READINESS-REQUIREMENTS'
    )), 'Expected generated Requirements check.');
    const canonicalFindings = /** @type {ReadinessFinding[]} */ (requireValue(requirementCheck.findings,
        'Expected generated Requirements findings.'));
    const rawFindings = originalBytes.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
    assert.ok(canonicalFindings.length > 1);
    const reversed = [...canonicalFindings].reverse().map(finding => requireValue(
        rawFindings.find(raw => raw.finding === finding.finding), 'Expected original draft finding.',
    ));
    await writeFile(draftPath, `${reversed.map(finding => JSON.stringify(finding)).join('\n')}\n`, 'utf8');
    try {
        const generated = await generateSpecReadiness({
            inputPath: draftPath,
            issueId: 'issue:0001:01',
            platformAdapter: {getCurrentAgentIdentity: () => agentIdentity},
            repositoryRoot: runtime.scenarioRoot,
        });
        const canonical = JSON.parse(await readFile(generated.path, 'utf8'));
        const sorted = requireValue(canonical.checks.find((/** @type {{check: string}} */ check) => (
            check.check === 'SPEC-READINESS-REQUIREMENTS'
        ))?.findings, 'Expected sorted Requirements findings.');
        assert.deepEqual(sorted.map((/** @type {{finding: string}} */ finding) => finding.finding),
            canonicalFindings.map(finding => finding.finding));
        assert.notDeepEqual(reversed.map(finding => finding.finding), sorted.map((/** @type {{finding: string}} */ finding) => finding.finding));
        const instances = [{instanceId: runtime.instanceId, artifactPaths: [generated.path]}];
        const pending = await scoreReviewerCapabilityCompletedRepetitions({
            agentIdentity, input: {artifacts: [{...response, instances}]}, preparedPath: prepared.preparedPath,
            repositoryRoot,
        });
        assert.equal(pending.status, 'needs-adjudication', JSON.stringify(pending));
        const candidates = requireValue(pending.candidates, 'Expected sorted finding candidates.')
            .filter(candidate => candidate.instanceId === runtime.instanceId
                && candidate.check === 'SPEC-READINESS-REQUIREMENTS');
        assert.ok(candidates.length > 0);
        for (const candidate of candidates) {
            const finding = requireValue(sorted[candidate.findingIndex], 'Expected indexed canonical finding.');
            const problem = requireValue(runtime.expected.scopes.find(scope => scope.scope === candidate.problemScope)
                ?.problemCases[candidate.problemCaseIndex - 1], 'Expected bound problem.');
            assert.equal(candidate.finding, finding.finding);
            assert.equal(candidate.result, finding.result);
            assert.deepEqual(candidate.evidence, finding.evidence);
            assert.equal(candidate.expectation, problem.expectation);
        }
    } finally {
        await writeFile(draftPath, originalBytes);
    }
});

test('partial Spec Readiness scores only repetitions with both prepared scenarios', async () => {
    const {adjudication, contract, prepared, repositoryRoot, response} = specReadinessCapabilityFixture;
    const options = {agentIdentity, preparedPath: prepared.preparedPath, repositoryRoot};
    const incompleteInput = {artifacts: [{...response, instances: response.instances.slice(2).filter((_, index) => index !== 1)}]};
    const decisionsFor = (/** @type {typeof incompleteInput} */ input) => ({decisions: adjudication.decisions.filter(decision =>
        input.artifacts[0].instances.some(instance => decision.candidateId.includes(`:${instance.instanceId}:`)))});
    const incompleteScored = await scoreReviewerCapabilityCompletedRepetitions({...options, input: incompleteInput,
        adjudication: decisionsFor(incompleteInput)});
    assert.equal(incompleteScored.status, 'diagnostic');
    assert.equal(reviewerScore(incompleteScored).instances.length, 3);
    assert.deepEqual(reviewerScore(incompleteScored).repetitions.map(entry => entry.repetition), [3]);
    assert.equal(reviewerScore(incompleteScored).score, undefined);
    const input = {artifacts: [{...response, instances: response.instances.slice(2)}]};
    const scored = await scoreReviewerCapabilityCompletedRepetitions({...options, input, adjudication: decisionsFor(input)});
    assert.equal(scored.status, 'diagnostic');
    const totalProblems = contract.instances[0].expected.problemCount + contract.instances[1].expected.problemCount;
    const f2 = (/** @type {number} */ earned) => 5 * earned / (4 * totalProblems + earned);
    assert.deepEqual(reviewerScore(scored).repetitionScores, [f2(3), f2(5)]);
    assert.deepEqual(reviewerScore(scored).repetitions.map(entry => entry.repetition), [2, 3]);
});

test('paired Spec Readiness retains evidence errors while scoring the valid scene', async () => {
    const {contract, prepared, repositoryRoot, response} = specReadinessCapabilityFixture;
    const promotion = requireValue(response.instances[3], 'Expected second artifact-promotion report.');
    await withCapabilityArtifactSnapshots({instances: [promotion]}, async snapshots => {
        const path = requireValue(promotion.artifactPaths[0], 'Expected complete-review draft.');
        const finding = JSON.parse(requireValue(snapshots[0]?.sources[0], 'Expected draft.').trim());
        finding.evidence = ['specs/access-review.md:1'];
        await writeFile(path, `${JSON.stringify(finding)}
`, 'utf8');
        const options = {agentIdentity, input: {artifacts: [{...response, instances: response.instances.slice(2, 4)}]},
            preparedPath: prepared.preparedPath, repositoryRoot};
        const pending = await scoreReviewerCapabilityCompletedRepetitions(options);
        assert.equal(pending.status, 'needs-adjudication');
        assert.deepEqual(reviewerScore(pending).reportDiagnostics.map(entry => entry.instanceId), [promotion.instanceId]);
        const candidates = requireValue(pending.candidates, 'Expected valid scene candidates.');
        assert.equal(candidates.some(candidate => candidate.instanceId === promotion.instanceId), false);
        const scored = await scoreReviewerCapabilityCompletedRepetitions({...options,
            adjudication: {decisions: await fixtureCandidateDecisions(options, candidates)}});
        assert.equal(scored.status, 'diagnostic');
        const score = reviewerScore(scored);
        const problemCount = contract.instances[0].expected.problemCount + contract.instances[1].expected.problemCount;
        const f2 = (/** @type {number} */ earned) => 5 * earned / (4 * problemCount + earned);
        assert.deepEqual(score.repetitions.map(entry => entry.repetition), [2]);
        assert.ok(score.repetitionScores[0] > 0 && score.repetitionScores[0] < f2(3));
        assert.equal(score.finalRepetitionScores[0], score.repetitionScores[0] * 0.9);
    });
});

test('Spec Readiness capability scores other findings when one draft cites only a heading', async () => {
    const {adjudication, contract, prepared, repositoryRoot, response} = specReadinessCapabilityFixture;
    const runtime = requireValue(contract.instances[0], 'Expected first runtime-migration instance.');
    const generation = requireValue(prepared.generations.find(item => item.instanceId === runtime.instanceId), 'Expected generation binding.');
    const draftPath = requireValue(generation.draftPath, 'Expected bound Reviewer draft.');
    const originalBytes = await readFile(draftPath);
    const finding = JSON.parse(originalBytes.toString('utf8').trim());
    finding.evidence = ['specs/runtime-migration.md:1'];
    await writeFile(draftPath, `${JSON.stringify(finding)}\n`, 'utf8');
    try {
        const input = {artifacts: [{...response, instances: [response.instances[0], ...response.instances.slice(2, 4)].map(instance => (
            instance.instanceId === runtime.instanceId ? {...instance, artifactPaths: [draftPath]} : instance
        ))}]};
        const options = {
            agentIdentity, input, preparedPath: prepared.preparedPath, repositoryRoot,
            runCommand: requireValue(sharedRunCommands.get(repositoryRoot), 'Expected Git command adapter.'),
        };
        const selectedInstances = input.artifacts[0].instances.filter(instance => instance.instanceId !== runtime.instanceId);
        const scored = await scoreReviewerCapabilityCompletedRepetitions({...options,
            adjudication: {decisions: adjudication.decisions.filter(decision => selectedInstances.some(instance =>
                decision.candidateId.includes(`:${instance.instanceId}:`)))}});
        assert.equal(scored.status, 'diagnostic', JSON.stringify(scored));
        const score = reviewerScore(scored);
        assert.deepEqual(score.repetitions.map(entry => entry.repetition), [2]);
        assert.ok(score.instances[0].caseScores.problem.every(value => value === 0));
        assert.ok(score.instances.slice(1).some(instance => instance.earnedProblemPoints > 0));
        assert.ok(score.repetitionScores.every(value => value > 0));
    } finally {
        await writeFile(draftPath, originalBytes);
    }
});

test('runtime-migration scoring retains content and penalizes a stop-rule error', async () => {
    const {adjudication, contract, prepared, repositoryRoot, response} = specReadinessCapabilityFixture;
    const runtime = requireValue(contract.instances.find(instance => instance.scenarioId === 'runtime-migration'), 'Expected runtime-migration instance.');
    const generation = requireValue(prepared.generations.find(item => item.instanceId === runtime.instanceId), 'Expected generation binding.');
    const originalPath = requireValue(generation.draftPath, 'Expected bound Reviewer draft.');
    const originalBytes = await readFile(originalPath);
    const requirement = requireValue(runtime.expected.scopes[1]?.problemCases[0], 'Expected requirement problem.');
    const evidence = requireValue((requirement.placements?.[0]?.evidence ?? requirement.evidence)
        ?.find(locator => locator.filePath.startsWith('specs/') && locator.line !== undefined), 'Expected governing body evidence.');
    const continued = Buffer.concat([originalBytes, Buffer.from(`${JSON.stringify({check: 'MODULE-DESIGN-APPLICABILITY',
        evidence: [`${evidence.filePath}:${evidence.line}`], finding: 'The runtime design omits its Module Design explanation.', result: 'gap'})}
`)]);
    await writeFile(originalPath, continued);
    try {
        const input = {artifacts: [{...response, instances: response.instances.slice(0, 2).map(instance => instance.instanceId === runtime.instanceId
            ? {...instance, artifactPaths: [originalPath]} : instance)}]};
        const options = {agentIdentity, input, preparedPath: prepared.preparedPath, repositoryRoot};
        const scored = await scoreReviewerCapabilityCompletedRepetitions({...options,
            adjudication: {decisions: adjudication.decisions.filter(decision =>
                decision.candidateId.includes(`:${runtime.instanceId}:`))}});
        assert.equal(scored.status, 'diagnostic');
        assert.ok(reviewerScore(scored).reportDiagnostics.some(entry => entry.code === 'requirement-scope-continuation'));
        const score = reviewerScore(scored);
        assert.ok(score.repetitionScores[0] > 0);
        assert.equal(score.finalRepetitionScores[0], score.repetitionScores[0] * 0.9);
        assert.deepEqual(await readFile(originalPath), continued);
    } finally {
        await writeFile(originalPath, originalBytes);
    }
});

test('targeted Commit Audit preparation completes with the production Git command runner', async () => {
    const defaultRunnerAgentIdentity = {
        platform: 'codex',
        sessionId: 'reviewer-capability-default-runner-test',
    };
    const workspaceRoot = join(process.cwd(), '.tmp', 'codex', defaultRunnerAgentIdentity.sessionId);
    sharedCleanupCallbacks.push(() => rm(workspaceRoot, {force: true, recursive: true}));

    const prepared = await prepareReviewerCapabilityConformanceImplementation({
        agentIdentity: defaultRunnerAgentIdentity,
        repositoryRoot: process.cwd(),
        reviewerId: 'commit-audit-reviewer',
    });

    assert.equal('preparedPath' in prepared, true);
    if (!('preparedPath' in prepared)) return;
    assert.equal(prepared.handoffs.length, 3);
    assert.equal(prepared.generations.length, 3);
    assert.equal(
        await readFile(join(prepared.handoffs[0].scenarioRoot, 'docs', 'agents', 'roles', 'commit-audit-reviewer', 'gate-2.md'), 'utf8'),
        await readFile(join(process.cwd(), 'docs', 'agents', 'roles', 'commit-audit-reviewer', 'gate-2.md'), 'utf8'),
    );
    assert.equal(
        await readFile(join(prepared.handoffs[0].scenarioRoot, 'docs', 'agents', 'agent-writes.md'), 'utf8'),
        await readFile(join(process.cwd(), 'docs', 'agents', 'agent-writes.md'), 'utf8'),
    );
    for (const instructionPath of ['.agents/skills/domain-modeling/SKILL.md', '.agents/skills/validation/SKILL.md']) {
        assert.equal(
            await readFile(join(prepared.handoffs[0].scenarioRoot, instructionPath), 'utf8'),
            await readFile(join(process.cwd(), instructionPath), 'utf8'),
        );
    }
});



test('Commit Audit capability matches distinct requirements that share one source without using Reviewer wording', async () => {
    const {prepared, repeatedSource, repositoryRoot, response} = repeatedSourceCommitAuditCapabilityFixture;
    const firstArtifact = requireValue(response.instances[0]?.artifactPaths[0], 'Expected repeated-source Commit Audit artifact.');
    const record = JSON.parse(await readFile(firstArtifact, 'utf8'));
    const repeatedRequirements = record.requirements.filter((/** @type {{source?: unknown}} */ requirement) => (
        JSON.stringify(requirement.source) === JSON.stringify(repeatedSource)
    ));
    assert.deepEqual(repeatedRequirements.map((/** @type {{requirement?: unknown}} */ requirement) => requirement.requirement), [
        'Alpha wording chosen only by the Reviewer.',
        'Zulu wording chosen only by the Reviewer.',
    ]);
    const repeatedSourceResult = await verifyReviewerCapabilityConformance({
        agentIdentity,
        input: {artifacts: [response]},
        preparedPath: prepared.preparedPath,
        repositoryRoot,
    });
    assert.equal(repeatedSourceResult.status, 'verified', JSON.stringify(repeatedSourceResult));
    assert.equal(repeatedSourceResult.results?.[0]?.score, 1);
});

test('Commit Audit equal-count shared-source ambiguity requires bindings independent of row order', async () => {
    const {prepared, repeatedSource, repositoryRoot, response} = repeatedSourceCommitAuditCapabilityFixture;
    const instance = requireValue(response.instances[0], 'Expected first repeated-source instance.');
    const expected = requireValue((await readPreparedState(prepared.preparedPath)).contracts[0]?.instances[0]?.expected,
        'Expected repeated-source fixture.');
    const requirements = requireValue(expected.auditRecords?.[0]?.requirements, 'Expected first record requirements.');
    const sharedIndexes = requirements.flatMap((requirement, index) => JSON.stringify(requirement.source) === JSON.stringify(repeatedSource) ? [index] : []);
    const problemIndex = requireValue(sharedIndexes.find(index => requirements[index].result !== 'satisfied'), 'Expected shared-source problem.');
    const cleanIndex = requireValue(sharedIndexes.find(index => requirements[index].result === 'satisfied'), 'Expected shared-source clean requirement.');
    await withCapabilityArtifactSnapshots({instances: [instance]}, async snapshots => {
        const path = requireValue(snapshots[0]?.artifactPaths[0], 'Expected first record path.');
        const original = JSON.parse(requireValue(snapshots[0]?.sources[0], 'Expected first record.'));
        const actualIndexes = original.requirements.flatMap((/** @type {{source: unknown}} */ requirement, /** @type {number} */ index) => (
            JSON.stringify(requirement.source) === JSON.stringify(repeatedSource) ? [index] : []
        ));
        const trueIndex = requireValue(actualIndexes.find((/** @type {number} */ index) => original.requirements[index].result !== 'satisfied'), 'Expected true finding row.');
        const unrelatedIndex = requireValue(actualIndexes.find((/** @type {number} */ index) => original.requirements[index].result === 'satisfied'), 'Expected clean row.');
        const trueRow = original.requirements[trueIndex];
        const unrelatedRow = {...original.requirements[unrelatedIndex], result: trueRow.result,
            evidence: structuredClone(trueRow.evidence), finding: 'An unrelated assessment gap.'};
        const options = {agentIdentity, input: {artifacts: [{reviewerId: response.reviewerId, instances: [instance]}]},
            preparedPath: prepared.preparedPath, repositoryRoot};
        /** @type {{decisions: Awaited<ReturnType<typeof fixtureCandidateDecisions>>} | undefined} */
        let adjudication;
        /** @type {CaseScoreDetails['caseScores'] | undefined} */
        let firstScores;
        for (const reversed of [false, true]) {
            const record = structuredClone(original);
            record.requirements[trueIndex] = reversed ? unrelatedRow : trueRow;
            record.requirements[unrelatedIndex] = reversed ? trueRow : unrelatedRow;
            const report = `${JSON.stringify(record)}\n`;
            await writeFile(path, report, 'utf8');
            if (adjudication === undefined) {
                const unbound = await scoreReviewerCapabilityCompletedRepetitions(options);
                assert.equal(unbound.status, 'needs-requirement-binding');
                assert.equal(unbound.results, undefined);
                assert.deepEqual(unbound.bindingRequests?.map(request => ({instanceId: request.instanceId,
                    expectedIndexes: request.expectedIndexes, actualIndexes: request.actualIndexes})), [
                    {instanceId: instance.instanceId, expectedIndexes: sharedIndexes, actualIndexes},
                ]);
            }
            const requirementBindings = {bindings: [
                {actualIndex: reversed ? unrelatedIndex : trueIndex, expectedIndex: problemIndex, instanceId: instance.instanceId, recordIndex: 0},
                {actualIndex: reversed ? trueIndex : unrelatedIndex, expectedIndex: cleanIndex, instanceId: instance.instanceId, recordIndex: 0},
            ]};
            if (adjudication === undefined) {
                const pending = await scoreReviewerCapabilityCompletedRepetitions({...options, requirementBindings});
                assert.equal(pending.status, 'needs-adjudication', JSON.stringify(pending));
                adjudication = {decisions: await fixtureCandidateDecisions(options,
                    requireValue(pending.candidates, 'Expected explicitly bound candidates.'))};
            }
            const scored = await scoreReviewerCapabilityCompletedRepetitions({...options, requirementBindings, adjudication});
            assert.equal(scored.status, 'diagnostic', JSON.stringify(scored));
            const score = reviewerScore(scored);
            const details = requireValue(score.instances[0], 'Expected scored instance.');
            assert.equal(details.earnedProblemPoints, expected.problemCount);
            assert.equal(details.earnedCleanPoints, expected.cleanCount - 2);
            assert.deepEqual(score.reportDiagnostics, []);
            const cleanRate = (expected.cleanCount - 2) / expected.cleanCount;
            assert.ok(Math.abs(score.repetitionScores[0] - 5 * cleanRate / (4 * cleanRate + 1)) < 1e-12);
            assert.deepEqual(score.finalRepetitionScores, score.repetitionScores);
            if (firstScores === undefined) firstScores = details.caseScores;
            else assert.deepEqual(details.caseScores, firstScores);
            assert.equal(await readFile(path, 'utf8'), report);
        }
    });
});

test('Commit Audit partial scoring zeros one split requirement and scores other sources', async () => {
    const {prepared, repositoryRoot, response} = commitAuditCapabilityFixture;
    await withCapabilityArtifactSnapshots({instances: [response.instances[0]]}, async () => {
        const instance = requireValue(response.instances[0], 'Expected Commit Audit instance.');
        const path = requireValue(instance.artifactPaths[0], 'Expected Gate 1 audit.');
        const record = JSON.parse(await readFile(path, 'utf8'));
        record.requirements.splice(1, 0, {
            ...structuredClone(record.requirements[0]),
            requirement: `${record.requirements[0].requirement} separated clause`,
        });
        await writeFile(path, `${JSON.stringify(record)}\n`, 'utf8');
        const input = {artifacts: [{reviewerId: response.reviewerId, instances: [instance]}]};
        const options = {agentIdentity, input, preparedPath: prepared.preparedPath, repositoryRoot,
            runCommand: requireValue(sharedRunCommands.get(repositoryRoot), 'Expected Git command adapter.')};
        const pending = await scoreReviewerCapabilityCompletedRepetitions(options);
        assert.equal(pending.status, 'needs-adjudication', JSON.stringify(pending));
        assert.ok('candidates' in pending);
        const scored = await scoreReviewerCapabilityCompletedRepetitions({
            ...options,
            adjudication: {decisions: requireValue(pending.candidates, 'Expected available candidates.').map(candidate => ({
                candidateId: candidate.candidateId,
                decision: 'matched',
                reason: 'The fixture finding describes this expected defect.',
            }))},
        });
        assert.equal(scored.status, 'diagnostic', JSON.stringify(scored));
        const score = reviewerScore(scored);
        const problemCount = requireValue((await readPreparedState(prepared.preparedPath)).contracts[0],
            'Expected Commit Audit contract.').instances[0].expected.problemCount;
        const recall = (problemCount - 1) / problemCount;
        assert.ok(Math.abs(reviewerScore(scored).repetitionScores[0] - 5 * recall / (4 + recall)) < 1e-10,
            JSON.stringify({actual: reviewerScore(scored).repetitionScores[0], expected: 5 * recall / (4 + recall)}));
        assert.equal(reviewerScore(scored).finalRepetitionScores[0], reviewerScore(scored).repetitionScores[0] * 0.9);
    });
});

test('complete Commit Audit scoring requires ordered unique repetitions and averages all three', async () => {
    const {adjudication, prepared, repositoryRoot, response} = commitAuditCapabilityFixture;
    const options = {agentIdentity, input: {artifacts: [response]},
        preparedPath: prepared.preparedPath, repositoryRoot,
        runCommand: requireValue(sharedRunCommands.get(repositoryRoot), 'Expected Git command adapter.')};
    const reversed = await scoreReviewerCapabilityCompletedRepetitions({...options,
        input: {artifacts: [{...response, instances: [...response.instances].reverse()}]},
    });
    assert.equal(reversed.status, 'failed');
    const duplicate = await scoreReviewerCapabilityCompletedRepetitions({...options,
        input: {artifacts: [{...response, instances: [response.instances[0], response.instances[0],
            response.instances[2]]}]},
    });
    assert.equal(duplicate.status, 'failed');
    const scored = await scoreReviewerCapabilityCompletedRepetitions({...options, adjudication});
    assert.equal(scored.status, 'diagnostic', JSON.stringify(scored));
    const score = reviewerScore(scored);
    assert.deepEqual(score.repetitionScores, [1, 1, 1]);
    assert.equal(score.scoreBeforePenalty, 1);
    assert.equal(score.score, 1);
    assert.match(score.scoreExplanation, /Final score: 1\.000\. Score before penalty: 1\.000\./u);
});

test('Commit Audit shared-source scoring requires complete bindings without reusing rows', async () => {
    const {prepared, repeatedSource, repositoryRoot, response} = repeatedSourceCommitAuditCapabilityFixture;
    await withCapabilityArtifactSnapshots(response, async () => {
        const instance = requireValue(response.instances[0], 'Expected shared-source instance.');
        const path = requireValue(instance.artifactPaths[0], 'Expected shared-source audit.');
        const record = JSON.parse(await readFile(path, 'utf8'));
        const shared = /** @type {Array<{index: number, result: string | undefined}>} */ (record.requirements.flatMap((/** @type {{source?: unknown, result?: string}} */ row, /** @type {number} */ index) => (
            JSON.stringify(row.source) === JSON.stringify(repeatedSource) ? [{index, result: row.result}] : []
        )));
        const problem = requireValue(shared.find(row => row.result !== 'satisfied'), 'Expected shared-source problem.');
        const satisfied = requireValue(shared.find(row => row.result === 'satisfied'), 'Expected shared-source clean requirement.');
        record.requirements.splice(problem.index + 1, 0, {
            ...structuredClone(record.requirements[problem.index]),
            requirement: `${record.requirements[problem.index].requirement} separated clause`,
        });
        const satisfiedActualIndex = satisfied.index > problem.index ? satisfied.index + 1 : satisfied.index;
        const originalSplitReport = `${JSON.stringify(record)}\n`;
        await writeFile(path, originalSplitReport, 'utf8');
        const input = {artifacts: [{reviewerId: response.reviewerId, instances: [instance]}]};
        const options = {agentIdentity, input, preparedPath: prepared.preparedPath, repositoryRoot,
            runCommand: requireValue(sharedRunCommands.get(repositoryRoot), 'Expected Git command adapter.')};
        const formal = await verifyReviewerCapabilityConformance({...options, input: {artifacts: [response]}});
        assert.equal(formal.status, 'needs-requirement-binding');
        const requestResult = formal;
        assert.equal(requestResult.status, 'needs-requirement-binding', JSON.stringify(requestResult));
        assert.ok('bindingRequests' in requestResult);
        const request = requireValue(requestResult.bindingRequests?.[0], 'Expected shared-source binding request.');
        assert.equal(request.instanceId, instance.instanceId);
        assert.equal(request.expectedIndexes.length, 2);
        assert.equal(request.actualIndexes.length, 3);
        const expected = /** @type {Array<{result: string}>} */ (requireValue(
            requireValue(requireValue(requireValue((await readPreparedState(prepared.preparedPath)).contracts[0],
                'Expected contract.').instances[0], 'Expected first instance.').expected.auditRecords?.[0],
                'Expected first audit record.').requirements,
            'Expected requirements.'));
        const cleanIndex = requireValue(request.expectedIndexes.find(index => expected[index]?.result === 'satisfied'), 'Expected clean index.');
        const problemIndex = requireValue(request.expectedIndexes.find(index => expected[index]?.result !== 'satisfied'), 'Expected problem index.');
        const bindings = {bindings: [
            {actualIndex: satisfiedActualIndex, expectedIndex: cleanIndex, instanceId: instance.instanceId, recordIndex: 0},
            {actualIndex: null, expectedIndex: problemIndex, instanceId: instance.instanceId, recordIndex: 0},
        ]};
        const incomplete = await scoreReviewerCapabilityCompletedRepetitions({
            ...options, requirementBindings: {bindings: bindings.bindings.slice(0, 1)},
        });
        assert.equal(incomplete.status, 'failed');
        const reused = await scoreReviewerCapabilityCompletedRepetitions({
            ...options, requirementBindings: {bindings: bindings.bindings.map(entry => ({
                ...entry, actualIndex: satisfiedActualIndex,
            }))},
        });
        assert.equal(reused.status, 'failed');
        const otherSourceIndex = record.requirements.findIndex((/** @type {{source?: unknown}} */ row) => (
            JSON.stringify(row.source) !== JSON.stringify(repeatedSource)
        ));
        assert.ok(otherSourceIndex >= 0);
        const crossed = await scoreReviewerCapabilityCompletedRepetitions({
            ...options, requirementBindings: {bindings: bindings.bindings.map(entry => (
                entry.actualIndex === null ? entry : {...entry, actualIndex: otherSourceIndex}
            ))},
        });
        assert.equal(crossed.status, 'failed');
        const pending = await scoreReviewerCapabilityCompletedRepetitions({
            ...options, requirementBindings: bindings,
        });
        assert.equal(pending.status, 'needs-adjudication', JSON.stringify(pending));
        assert.ok('candidates' in pending);
        assert.ok(reviewerScore(pending).reportDiagnostics.some(entry => entry.instanceId === instance.instanceId));
        const scored = await scoreReviewerCapabilityCompletedRepetitions({
            ...options, requirementBindings: bindings,
            adjudication: {decisions: requireValue(pending.candidates, 'Expected available candidates.').map(candidate => ({
                candidateId: candidate.candidateId,
                decision: 'matched',
                reason: 'The fixture finding describes this expected defect.',
            }))},
        });
        assert.equal(scored.status, 'diagnostic', JSON.stringify(scored));
        assert.deepEqual(reviewerScore(scored).reportDiagnostics, reviewerScore(pending).reportDiagnostics);
        const problemCount = requireValue((await readPreparedState(prepared.preparedPath)).contracts[0],
            'Expected Commit Audit contract.').instances[0].expected.problemCount;
        const recall = (problemCount - 1) / problemCount;
        assert.ok(Math.abs(reviewerScore(scored).repetitionScores[0] - 5 * recall / (4 + recall)) < 1e-10,
            JSON.stringify({actual: reviewerScore(scored).repetitionScores[0], expected: 5 * recall / (4 + recall)}));
        assert.equal(reviewerScore(scored).finalRepetitionScores[0], reviewerScore(scored).repetitionScores[0] * 0.9);
        assert.equal(await readFile(path, 'utf8'), originalSplitReport);
    });
});

test('Commit Audit scoring preserves coverage errors and rejects malformed canonical records', async () => {
    const {prepared, repositoryRoot, response} = commitAuditCapabilityFixture;
    await withCapabilityArtifactSnapshots({instances: [response.instances[0]]}, async snapshots => {
        const path = requireValue(snapshots[0]?.artifactPaths[0], 'Expected first Commit Audit artifact.');
        const original = JSON.parse(requireValue(snapshots[0]?.sources[0], 'Expected first Commit Audit record.'));
        const verifyRecord = async (/** @type {unknown} */ record) => {
            await writeFile(path, `${JSON.stringify(record)}\n`, 'utf8');
            const input = {artifacts: [{...response, instances: [response.instances[0]]}]};
            const options = {agentIdentity, input,
                preparedPath: prepared.preparedPath, repositoryRoot};
            const pending = await scoreReviewerCapabilityCompletedRepetitions(options);
            if (pending.status !== 'needs-adjudication') return pending;
            return scoreReviewerCapabilityCompletedRepetitions({...options, adjudication: {decisions: await fixtureCandidateDecisions(options,
                requireValue(pending.candidates, 'Expected coverage candidates.'))}});
        };
        const wrongSource = structuredClone(original);
        wrongSource.requirements[0].source = structuredClone(wrongSource.requirements[1].source);
        const multiplicity = await verifyRecord(wrongSource);
        assert.equal(multiplicity.status, 'diagnostic');
        assert.ok(reviewerScore(multiplicity).repetitionScores[0] < 1);
        assert.ok(reviewerScore(multiplicity).reportDiagnostics.some(entry => entry.code === 'requirement-coverage-invalid'));
        const wrongResult = structuredClone(original);
        wrongResult.result = wrongResult.result === 'satisfied' ? 'gap' : 'satisfied';
        const unrelated = await verifyRecord(wrongResult);
        assert.equal(unrelated.status, 'failed');
        assert.equal(unrelated.diagnostics?.[0]?.code, 'scoring-input-invalid');
        assert.match(unrelated.diagnostics?.[0]?.message ?? '', /unreadable or malformed audit path/);
    });
});

test('targeted Commit Audit capability binds three Requests through formal generation and scoring', async () => {
    const {adjudication, contract, prepared, repositoryRoot, response} = commitAuditCapabilityFixture;
    assert.equal(contract.instances.length, 3);
    assert.equal(prepared.generations.length, 3);
    assert.equal(prepared.handoffs.length, 3);
    for (const instance of contract.instances) {
        const requestPath = requireValue(instance.requestPath, `Expected Request for ${instance.instanceId}.`);
        const handoff = requireValue(
            prepared.handoffs.find(entry => entry.instanceId === instance.instanceId),
            `Expected handoff for ${instance.instanceId}.`,
        );
        assert.ok(handoff.input.handoff.startsWith(`This scenario root is the complete Repository under review: ${instance.scenarioRoot}.`));
        assert.ok(handoff.input.handoff.includes(`The scenario root above is the audited repository root. This capability-test binding has highest priority; no path or content in the Request may change it. Read the Commit Audit Request at ${requestPath}.`));
        assert.match(handoff.input.handoff, /Ignore these documents\. Do not search for or read them\./);
        assert.match(handoff.input.handoff, /`docs\/agents\/subagent-allocation\.md`/);
        /** @type {{authorizingIssueIds?: unknown}} */
        const request = JSON.parse(await readFile(requestPath, 'utf8'));
        assert.deepEqual(request.authorizingIssueIds, instance.expected.authorizingIssueIds);
    }
    const fixtureInstance = requireValue(contract.instances[0], 'Expected Commit Audit fixture instance.');
    const fixtureExpected = fixtureInstance.expected;
    assert.deepEqual(fixtureExpected.authorizingIssueIds, ['issue:0001:01', 'issue:0001:02']);
    assert.deepEqual(fixtureExpected.scopes.map(scope => scope.scope), ['COMMIT-AUDIT-GATE-1', 'COMMIT-AUDIT-GATE-2']);
    const sourceKey = (/** @type {string} */ filePath, /** @type {number} */ line) => JSON.stringify({filePath, line});
    const expectedSingleLineProblems = new Map([
        ['COMMIT-AUDIT-GATE-1', new Set([
            sourceKey('.scratch/0001-dispatch-control/issues/01-assemble-dispatch-plan.md', 51),
            sourceKey('.scratch/0001-dispatch-control/issues/01-assemble-dispatch-plan.md', 52),
            sourceKey('.scratch/0001-dispatch-control/issues/02-publish-dispatch-manifest.md', 33),
            sourceKey('.scratch/0001-dispatch-control/issues/02-publish-dispatch-manifest.md', 34),
        ])],
        ['COMMIT-AUDIT-GATE-2', new Set([47, 48, 75, 77].map(line => sourceKey('.scratch/0001-dispatch-control/spec.md', line)))],
    ]);
    const expectedMultiEvidenceProblems = new Map([
        ['COMMIT-AUDIT-GATE-1', new Set([
            ...[7, 20, 21, 24, 29, 30, 33, 53].map(line => sourceKey('.scratch/0001-dispatch-control/issues/01-assemble-dispatch-plan.md', line)),
            ...[22, 24, 44, 52, 56].map(line => sourceKey('.scratch/0001-dispatch-control/issues/02-publish-dispatch-manifest.md', line)),
        ])],
        ['COMMIT-AUDIT-GATE-2', new Set([11, 12, 18, 23, 27, 28, 40, 43, 54, 57, 73, 76].map(
            line => sourceKey('.scratch/0001-dispatch-control/spec.md', line),
        ))],
    ]);
    const nearMissCleanSources = new Map([
        ['COMMIT-AUDIT-GATE-1', new Set([
            ...[19, 25, 32, 40, 42, 43, 44, 49, 50, 54, 55].map(line => sourceKey('.scratch/0001-dispatch-control/issues/01-assemble-dispatch-plan.md', line)),
            ...[7, 19, 23, 30, 39, 40, 42, 43, 50].map(line => sourceKey('.scratch/0001-dispatch-control/issues/02-publish-dispatch-manifest.md', line)),
        ])],
        ['COMMIT-AUDIT-GATE-2', new Set([7, 8, 9, 10, 13, 14, 15, 16, 17, 22, 26, 29, 30, 31, 32, 33, 37, 38, 39, 41].map(
            line => sourceKey('.scratch/0001-dispatch-control/spec.md', line),
        ))],
    ]);
    const auditRequirementsBySource = new Map(requireValue(fixtureExpected.auditRecords, 'Expected Commit Audit records.')
        .flatMap(record => record.requirements)
        .map(requirement => [JSON.stringify(requirement.source), requirement]));
    assert.deepEqual(
        auditRequirementsBySource.get(sourceKey('.scratch/0001-dispatch-control/spec.md', 46))?.evidence,
        [
            {filePath: 'src/dispatch/serialize.mjs', line: 2},
            {filePath: 'src/dispatch/serialize.mjs', line: 5},
        ],
    );
    assert.deepEqual(
        auditRequirementsBySource.get(sourceKey('.scratch/0001-dispatch-control/issues/02-publish-dispatch-manifest.md', 31))?.evidence,
        [
            {filePath: 'docs/dispatch/storage-contract.md', line: 3},
            {filePath: 'docs/dispatch/storage-contract.md', line: 5},
            {filePath: 'src/dispatch/publisher.mjs', line: 11},
            {filePath: 'src/dispatch/publisher.mjs', line: 12},
        ],
    );
    for (const scope of fixtureExpected.scopes) {
        assert.equal(scope.problemCases.length, 20);
        assert.equal(scope.cleanCases.length, 40);
        assert.equal(scope.problemCases.filter(problemCase => problemCase.result === 'gap').length, 18);
        assert.equal(scope.problemCases.filter(problemCase => problemCase.result === 'uncertain').length, 2);
        assert.equal(scope.cleanCases.filter(cleanCase => cleanCase.noOtherSupportedFinding === true).length, 1);
        const problemSources = new Set(scope.problemCases.map(problemCase => requireValue(
            problemCase.requirementSource,
            `Expected ${scope.scope} problem requirement source.`,
        )));
        const singleLineProblems = requireValue(expectedSingleLineProblems.get(scope.scope), `Expected ${scope.scope} single-line inventory.`);
        const multiEvidenceProblems = requireValue(expectedMultiEvidenceProblems.get(scope.scope), `Expected ${scope.scope} multi-evidence inventory.`);
        assert.equal(singleLineProblems.size, 4);
        assert.equal([...singleLineProblems].every(source => problemSources.has(source)), true);
        assert.equal(multiEvidenceProblems.size >= 12, true);
        assert.equal([...multiEvidenceProblems].every(source => problemSources.has(source)), true);
        assert.equal(scope.problemCases.filter(problemCase => multiEvidenceProblems.has(problemCase.requirementSource ?? '')
            && (problemCase.placements ?? [problemCase]).some(placement => (placement.evidence?.length ?? 0) > 1)).length, multiEvidenceProblems.size);
        const nearMisses = requireValue(nearMissCleanSources.get(scope.scope), `Expected ${scope.scope} near-miss inventory.`);
        assert.equal(nearMisses.size >= 20, true);
        assert.equal([...nearMisses].every(source => auditRequirementsBySource.get(source)?.result === 'satisfied'), true);
    }
    const auditRecords = requireValue(fixtureExpected.auditRecords, 'Expected Commit Audit fixture records.');
    assert.deepEqual(auditRecords.map(record => record.requirements.length), [29, 30, 59]);
    assert.equal(auditRecords.slice(0, 2).reduce((total, record) => total + record.requirements.length, 0), 59);
    const effortDirectories = new Set(auditRecords.flatMap(record => record.requirements.map(requirement => (
        /^\.scratch\/([^/]+)\//.exec(requirement.source.filePath)?.[1]
    ))));
    assert.deepEqual([...effortDirectories], ['0001-dispatch-control']);
    const visibleFixturePaths = new Set(auditRecords.flatMap(record => record.requirements.flatMap(requirement => [
        requirement.source.filePath,
        ...requirement.evidence.map(locator => locator.filePath),
    ])));
    assert.equal([...visibleFixturePaths].every(path => !/(?:problem|clean|gap|uncertain|broken|correct)/iu.test(path)), true);
    for (const record of auditRecords) {
        let longestRun = 0;
        let previousResult;
        let currentRun = 0;
        for (const requirement of record.requirements) {
            currentRun = requirement.result === previousResult ? currentRun + 1 : 1;
            previousResult = requirement.result;
            longestRun = Math.max(longestRun, currentRun);
        }
        assert.equal(longestRun <= 8, true);
    }
    const [firstIssue, secondIssue, governingSpec] = await Promise.all([
        readFile(join(fixtureInstance.scenarioRoot, '.scratch', '0001-dispatch-control', 'issues', '01-assemble-dispatch-plan.md'), 'utf8'),
        readFile(join(fixtureInstance.scenarioRoot, '.scratch', '0001-dispatch-control', 'issues', '02-publish-dispatch-manifest.md'), 'utf8'),
        readFile(join(fixtureInstance.scenarioRoot, '.scratch', '0001-dispatch-control', 'spec.md'), 'utf8'),
    ]);
    assert.match(firstIssue, /^# Assemble Dispatch Plan\n/);
    assert.match(secondIssue, /^# Publish Dispatch Manifest\n/);
    assert.match(governingSpec, /^# Dispatch Control Rules\n/);
    const satisfied = await verifyReviewerCapabilityConformance({
        adjudication,
        agentIdentity,
        input: {artifacts: [response]},
        preparedPath: prepared.preparedPath,
        repositoryRoot,
    });
    assert.equal(satisfied.status, 'verified');
    assert.equal(requireValue(satisfied.results, 'Expected Commit Audit score.')[0]?.score, 1);
});

test('Commit Audit Request content changes reject retained preparation and both scoring entries', async () => {
    const {adjudication, contract, prepared, repositoryRoot, response} = commitAuditCapabilityFixture;
    const retained = requireValue(contract.instances[1], 'Expected retained Commit Audit repetition.');
    const requestPath = requireValue(retained.requestPath, 'Expected bound Commit Audit Request.');
    const originalBytes = await readFile(requestPath);
    const originalRequest = JSON.parse(originalBytes.toString('utf8'));
    const originalReportBytes = await readFile(retained.reportPath);
    const selected = requireValue(contract.instances[0], 'Expected a different selected repetition.');
    const input = {artifacts: [response]};
    const runCommand = requireValue(sharedRunCommands.get(repositoryRoot), 'Expected fixture Git runner.');
    try {
        const changedIssueIds = {...originalRequest, authorizingIssueIds: originalRequest.authorizingIssueIds.slice(0, 1)};
        for (const changedBytes of [Buffer.concat([originalBytes, Buffer.from('\n')]),
            Buffer.from(`${JSON.stringify(changedIssueIds)}\n`)]) {
            await writeFile(requestPath, changedBytes);
            assert.equal(JSON.parse(changedBytes.toString('utf8')).draftPath, originalRequest.draftPath);
            await assert.rejects(prepareReviewerCapabilityConformance({
                agentIdentity, preparedPath: prepared.preparedPath, repositoryRoot,
                selection: {instances: [{instanceId: selected.instanceId, reviewerId: 'commit-audit-reviewer'}]},
            }));
            const formal = await rawVerifyReviewerCapabilityConformance({
                adjudication, agentIdentity, input, preparedPath: prepared.preparedPath, repositoryRoot,
            });
            assert.equal(formal.status, 'failed', JSON.stringify(formal));
            const completed = await scoreReviewerCapabilityCompletedRepetitions({
                adjudication, agentIdentity, input, preparedPath: prepared.preparedPath, repositoryRoot, runCommand,
            });
            assert.equal(completed.status, 'failed', JSON.stringify(completed));
        }
        assert.deepEqual(await readFile(retained.reportPath), originalReportBytes);
    } finally {
        await writeFile(requestPath, originalBytes);
    }
    assert.deepEqual(await readFile(requestPath), originalBytes);
});

test('Commit Audit recovery replaces only the repetition whose Request changed', async () => {
    const {adjudication: retainedAdjudication, contract, prepared: source, repositoryRoot, response} = commitAuditCapabilityFixture;
    const selected = requireValue(contract.instances[1], 'Expected affected Commit Audit repetition.');
    const requestPath = requireValue(selected.requestPath, 'Expected affected Commit Audit Request.');
    const originalRequestBytes = await readFile(requestPath);
    const originalRequest = JSON.parse(originalRequestBytes.toString('utf8'));
    const changedRequest = {...originalRequest, authorizingIssueIds: originalRequest.authorizingIssueIds.slice(0, 1)};
    await writeFile(requestPath, `${JSON.stringify(changedRequest)}\n`);
    try {
        const prepared = await prepareReviewerCapabilityConformance({
            agentIdentity, preparedPath: source.preparedPath, repositoryRoot,
            selection: {instances: [{instanceId: selected.instanceId, reviewerId: 'commit-audit-reviewer'}]},
        });
        const state = await readPreparedState(prepared.preparedPath);
        const current = requireValue(state.contracts[0], 'Expected recovered Commit Audit contract.');
        const replacement = requireValue(current.instances[1], 'Expected replacement Commit Audit repetition.');
        assert.deepEqual([current.instances[0], current.instances[2]], [contract.instances[0], contract.instances[2]]);
        assert.notEqual(replacement.instanceId, selected.instanceId);
        assert.notEqual(replacement.requestPath, selected.requestPath);
        assert.notEqual(replacement.reportPath, selected.reportPath);
        assert.deepEqual(prepared.handoffs.map(handoff => handoff.instanceId), [replacement.instanceId]);
        assert.deepEqual(prepared.generations.map(generation => generation.instanceId), [replacement.instanceId]);
        const replacementRequestPath = requireValue(replacement.requestPath, 'Expected new Commit Audit Request.');
        const newRequest = JSON.parse(await readFile(replacementRequestPath, 'utf8'));
        assert.deepEqual(newRequest.authorizingIssueIds, replacement.expected.authorizingIssueIds);
        assert.equal(newRequest.draftPath, replacement.reportPath);
        await writeFile(replacement.reportPath, createCommitAuditFixtureReviewJsonl(replacement.expected), 'utf8');
        const generated = await generateCommitAudit({
            git: fixtureGitRunner({repositoryRoot, scenarioRoot: replacement.scenarioRoot}),
            repositoryRoot: replacement.scenarioRoot,
            requestPath: replacementRequestPath,
        });
        if (!('files' in generated)) assert.fail(`Expected recovered Commit Audit generation: ${JSON.stringify(generated)}`);
        const artifactPaths = generated.files.map(({sourcePath}) => join(replacement.scenarioRoot, ...sourcePath.split('/')));
        const currentResponse = {...response, instances: response.instances.map((instance, index) => index === 1
            ? {artifactPaths, instanceId: replacement.instanceId}
            : instance)};
        const input = {agentIdentity, input: {artifacts: [currentResponse]}, preparedPath: prepared.preparedPath,
            repositoryRoot};
        const pending = await scoreReviewerCapabilityCompletedRepetitions({...input,
            input: {artifacts: [{reviewerId: response.reviewerId, instances: [{artifactPaths, instanceId: replacement.instanceId}]}]}});
        assert.equal(pending.status, 'needs-adjudication', JSON.stringify(pending));
        const adjudication = {decisions: [
            ...retainedAdjudication.decisions.filter(decision => !decision.candidateId.includes(`:${selected.instanceId}:`)),
            ...await fixtureCandidateDecisions(input, requireValue(pending.candidates, 'Expected replacement candidates.')),
        ]};
        const satisfied = await rawVerifyReviewerCapabilityConformance({...input, adjudication});
        assert.equal(satisfied.status, 'verified', JSON.stringify(satisfied));
        assert.deepEqual(satisfied.results?.[0]?.repetitionScores, [1, 1, 1]);
        assert.equal(JSON.parse(await readFile(requestPath, 'utf8')).draftPath, originalRequest.draftPath);
    } finally {
        await writeFile(requestPath, originalRequestBytes);
    }
});

test('Commit Audit capability preserves requirement binding while scoring swapped findings', async () => {
    const {prepared, repositoryRoot, response} = commitAuditCapabilityFixture;
    await withCapabilityArtifactSnapshots(response, async snapshots => {
        for (const {artifactPaths, sources} of snapshots) {
            const firstIssue = JSON.parse(sources[0]);
            const secondIssue = JSON.parse(sources[1]);
            const firstFinding = requireValue(firstIssue.requirements.find((/** @type {any} */ requirement) => requirement.source.line === 52), 'Expected first swapped finding.');
            const secondFinding = requireValue(secondIssue.requirements.find((/** @type {any} */ requirement) => requirement.source.line === 34), 'Expected second swapped finding.');
            [firstFinding.evidence, secondFinding.evidence] = [secondFinding.evidence, firstFinding.evidence];
            [firstFinding.finding, secondFinding.finding] = [secondFinding.finding, firstFinding.finding];
            await Promise.all([
                writeFile(artifactPaths[0], `${JSON.stringify(firstIssue)}\n`, 'utf8'),
                writeFile(artifactPaths[1], `${JSON.stringify(secondIssue)}\n`, 'utf8'),
            ]);
        }
        const misbound = await verifyReviewerCapabilityConformance({
            agentIdentity,
            input: {artifacts: [response]},
            preparedPath: prepared.preparedPath,
            repositoryRoot,
        });
        assert.equal(misbound.status, 'verified');
        assert.ok((misbound.results?.[0]?.score ?? 1) < 1);
    });
});

test('Commit Audit capability keeps clean findings bound to their requirements', async () => {
    const {prepared, repositoryRoot, response} = commitAuditCapabilityFixture;
    await withCapabilityArtifactSnapshots(response, async snapshots => {
        for (const {artifactPaths, sources} of snapshots) {
            const secondIssue = JSON.parse(sources[1]);
            const requirement = requireValue(secondIssue.requirements.find((/** @type {any} */ entry) => entry.source.line === 43), 'Expected clean source-bound requirement.');
            requirement.result = 'gap';
            requirement.finding = 'normalizePackageIds fails to remove duplicates within a supplied package-ID list.';
            await writeFile(artifactPaths[1], `${JSON.stringify(secondIssue)}\n`, 'utf8');
        }
        const input = {
            agentIdentity,
            input: {artifacts: [response]},
            preparedPath: prepared.preparedPath,
            repositoryRoot,
        };
        const provisional = await rawVerifyReviewerCapabilityConformance(input);
        const sourceBound = await verifyReviewerCapabilityConformance({
            ...input,
            adjudication: {decisions: await fixtureCandidateDecisions(input, requireValue(provisional.candidates, 'Expected clean source-bound candidates.'))},
        });
        const score = /** @type {{earnedCleanPoints: number, passedCleanCases: number, scopes: Array<{earnedCleanPoints: number, scope: string}>}} */ (/** @type {unknown} */ (
            requireValue(reviewerScore(sourceBound).repetitions[0], 'Expected first repetition.')
        ));
        assert.deepEqual(score?.scopes.map(scope => ({earnedCleanPoints: scope.earnedCleanPoints, scope: scope.scope})), [
            {earnedCleanPoints: 38, scope: 'COMMIT-AUDIT-GATE-1'},
            {earnedCleanPoints: 40, scope: 'COMMIT-AUDIT-GATE-2'},
        ]);
        assert.equal(score?.earnedCleanPoints, 78);
        assert.equal(score?.passedCleanCases, 78);
    });
});

test('Commit Audit capability scores equivalent mixed and overlapping line ranges', async () => {
    const {adjudication, prepared, repositoryRoot, response} = commitAuditCapabilityFixture;
    await withCapabilityArtifactSnapshots(response, async snapshots => {
        for (const {artifactPaths, sources} of snapshots) {
            const secondIssue = JSON.parse(sources[1]);
            const requirement = requireValue(secondIssue.requirements.find((/** @type {any} */ entry) => entry.source.line === 29), 'Expected multi-range requirement.');
            requirement.evidence = [{filePath: 'src/dispatch/manifest.mjs', lines: [[16, 18], 17, [18, 20]]}];
            await writeFile(artifactPaths[1], `${JSON.stringify(secondIssue)}\n`, 'utf8');
        }
        const ranged = await verifyReviewerCapabilityConformance({
            adjudication,
            agentIdentity,
            input: {artifacts: [response]},
            preparedPath: prepared.preparedPath,
            repositoryRoot,
        });
        assert.equal(ranged.status, 'verified');
        assert.equal(ranged.results?.[0]?.score, 1);
    });
});

test('Commit Audit formal verification accepts a complete format copy without losing the original diagnostic', async () => {
    const {adjudication, contract, prepared, repositoryRoot, response} = commitAuditCapabilityFixture;
    const instance = requireValue(contract.instances[1], 'Expected second Commit Audit instance.');
    const originalReportPath = instance.reportPath;
    const originalText = await readFile(originalReportPath, 'utf8');
    const correctedReportPath = join(dirname(originalReportPath), 'formal-format-copy.jsonl');
    const corrected = /** @type {CapabilityArtifactBatch} */ (structuredClone(response));
    corrected.instances[1] = {instanceId: instance.instanceId, artifactPaths: null,
        formatCorrection: {originalReportPath, correctedReportPath}};
    try {
        await writeFile(originalReportPath, `\`\`\`jsonl\n${originalText}\`\`\`\n`, 'utf8');
        await writeFile(correctedReportPath, originalText, 'utf8');
        const result = await rawVerifyReviewerCapabilityConformance({
            adjudication, agentIdentity, input: {artifacts: [corrected]},
            preparedPath: prepared.preparedPath, repositoryRoot,
        });
        assert.equal(result.status, 'verified', JSON.stringify(result));
        const score = requireValue(result.results?.[0], 'Expected Commit Audit score.');
        assert.deepEqual(score.repetitionScores, [1, 1, 1]);
        assert.deepEqual(score.finalRepetitionScores, [1, 0.9, 1]);
        assert.equal(score.scoreBeforePenalty, 1);
        assert.equal(score.reportDiagnostics?.[0]?.instanceId, instance.instanceId);
        assert.match(score.reportDiagnostics?.[0]?.message ?? '', /JSON|syntax|review/u);
        assert.equal(await readFile(originalReportPath, 'utf8'), `\`\`\`jsonl\n${originalText}\`\`\`\n`);
    } finally {
        await writeFile(originalReportPath, originalText, 'utf8');
        await rm(correctedReportPath, {force: true});
    }
});

test('Commit Audit completed-repetition scoring validates its format copy and preserves the original syntax diagnostic', async () => {
    const {adjudication, contract, prepared, repositoryRoot, response} = commitAuditCapabilityFixture;
    const instance = requireValue(contract.instances[1], 'Expected second Commit Audit instance.');
    const originalReportPath = instance.reportPath;
    const originalText = await readFile(originalReportPath, 'utf8');
    const correctedReportPath = join(dirname(originalReportPath), 'format-copy.jsonl');
    const corrected = /** @type {CapabilityArtifactBatch} */ (structuredClone(response));
    corrected.instances[1] = {instanceId: instance.instanceId, artifactPaths: null,
        formatCorrection: {originalReportPath, correctedReportPath}};
    try {
        await writeFile(originalReportPath, `\`\`\`jsonl\n${originalText}\`\`\`\n`, 'utf8');
        await writeFile(correctedReportPath, originalText, 'utf8');
        const input = {artifacts: [{reviewerId: corrected.reviewerId, instances: [corrected.instances[1]]}]};
        const selectedAdjudication = {decisions: adjudication.decisions.filter(decision => (
            decision.candidateId.includes(`:${instance.instanceId}:`)
        ))};
        const partial = await scoreReviewerCapabilityCompletedRepetitions({
            adjudication: selectedAdjudication, agentIdentity, input, preparedPath: prepared.preparedPath, repositoryRoot,
            runCommand: requireValue(sharedRunCommands.get(repositoryRoot), 'Expected Git command adapter.'),
        });
        assert.equal(partial.status, 'diagnostic', JSON.stringify(partial));
        const score = reviewerScore(partial);
        assert.deepEqual(score.repetitionScores, [1]);
        assert.deepEqual(score.finalRepetitionScores, [0.9]);
        assert.deepEqual(score.repetitions.map(entry => entry.repetition), [2]);
        assert.equal(score.reportDiagnostics[0]?.instanceId, instance.instanceId);
        assert.match(score.reportDiagnostics[0]?.message ?? '', /JSON|syntax|review/u);
        assert.equal(await readFile(originalReportPath, 'utf8'), `\`\`\`jsonl\n${originalText}\`\`\`\n`);
    } finally {
        await writeFile(originalReportPath, originalText, 'utf8');
        await rm(correctedReportPath, {force: true});
    }
});

test('Commit Audit format copies retain a missing original Request requirement as zero', async () => {
    const {contract, prepared, repositoryRoot, response} = commitAuditCapabilityFixture;
    const instance = requireValue(contract.instances[1], 'Expected second Commit Audit instance.');
    const originalReportPath = instance.reportPath;
    const originalText = await readFile(originalReportPath, 'utf8');
    const incompleteText = `${originalText.trimEnd().split('\n').slice(1).join('\n')}\n`;
    const correctedReportPath = join(dirname(originalReportPath), 'incomplete-format-copy.jsonl');
    const input = {artifacts: [{reviewerId: response.reviewerId, instances: [{instanceId: instance.instanceId,
        artifactPaths: null, formatCorrection: {originalReportPath, correctedReportPath}}]}]};
    try {
        await writeFile(originalReportPath, `\`\`\`jsonl\n${incompleteText}\`\`\`\n`, 'utf8');
        await writeFile(correctedReportPath, incompleteText, 'utf8');
        const options = {agentIdentity, input, preparedPath: prepared.preparedPath, repositoryRoot};
        const pending = await scoreReviewerCapabilityCompletedRepetitions(options);
        assert.equal(pending.status, 'needs-adjudication');
        const result = await scoreReviewerCapabilityCompletedRepetitions({...options,
            adjudication: {decisions: await fixtureCandidateDecisions(options,
                requireValue(pending.candidates, 'Expected remaining requirement candidates.'))}});
        assert.equal(result.status, 'diagnostic');
        const score = reviewerScore(result);
        assert.ok(score.instances[0].caseScores.problem.some(value => value === 0));
        assert.ok(score.repetitionScores[0] > 0 && score.repetitionScores[0] < 1);
        assert.equal(score.finalRepetitionScores[0], score.repetitionScores[0] * 0.9);
        assert.ok(score.reportDiagnostics.some(entry => entry.code === 'requirement-coverage-invalid'));
        assert.equal(await readFile(originalReportPath, 'utf8'), `\`\`\`jsonl\n${incompleteText}\`\`\`\n`);
    } finally {
        await writeFile(originalReportPath, originalText, 'utf8');
        await rm(correctedReportPath, {force: true});
    }
});

test('Commit Audit raw scoring keeps valid requirements when one evidence locator is out of range', async () => {
    const {contract, prepared, repositoryRoot, response} = commitAuditCapabilityFixture;
    const instance = requireValue(contract.instances[0], 'Expected first Commit Audit instance.');
    const originalPath = instance.reportPath;
    const originalBytes = await readFile(originalPath);
    const rows = originalBytes.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
    rows[0].evidence = [{filePath: rows[0].evidence[0].filePath, lines: [9999]}];
    const invalidText = `${rows.map(row => JSON.stringify(row)).join('\n')}\n`;
    await writeFile(originalPath, invalidText, 'utf8');
    try {
        const git = fixtureGitRunner({repositoryRoot, scenarioRoot: instance.scenarioRoot});
        const formal = await validateCommitAuditReview({git, repositoryRoot: instance.scenarioRoot,
            requestPath: requireValue(instance.requestPath, 'Expected Request.'), reviewPath: originalPath});
        assert.equal(formal.status, 'failed');
        assert.equal(formal.phase, 'evidence');
        const input = {artifacts: [{...response, instances: response.instances.map(artifact => artifact.instanceId === instance.instanceId ? {...artifact, artifactPaths: [originalPath]} : artifact)}]};
        const options = {agentIdentity, input, preparedPath: prepared.preparedPath, repositoryRoot};
        const pending = await scoreReviewerCapabilityCompletedRepetitions(options);
        assert.equal(pending.status, 'needs-adjudication');
        const scored = await scoreReviewerCapabilityCompletedRepetitions({...options,
            adjudication: {decisions: await fixtureCandidateDecisions(options,
                requireValue(pending.candidates, 'Expected valid requirement candidates.'))}});
        assert.equal(scored.status, 'diagnostic');
        const score = reviewerScore(scored);
        assert.ok(score.repetitionScores[0] > 0 && score.repetitionScores[0] < 1);
        assert.equal(score.finalRepetitionScores[0], score.repetitionScores[0] * 0.9);
        assert.deepEqual(score.repetitionScores.slice(1), [1, 1]);
        assert.equal(await readFile(originalPath, 'utf8'), invalidText);
    } finally {
        await writeFile(originalPath, originalBytes);
    }
});

test('a Commit Audit generation coverage failure remains scorable through its original raw report', async () => {
    const {contract, prepared, repositoryRoot, response} = commitAuditCapabilityFixture;
    const instance = requireValue(contract.instances[0], 'Expected first Commit Audit instance.');
    const originalPath = instance.reportPath;
    const originalBytes = await readFile(originalPath);
    const rows = originalBytes.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
    rows[0].source.line += 1;
    const invalidText = `${rows.map(row => JSON.stringify(row)).join('\n')}\n`;
    await writeFile(originalPath, invalidText, 'utf8');
    try {
        const git = fixtureGitRunner({repositoryRoot, scenarioRoot: instance.scenarioRoot});
        const formal = await validateCommitAuditReview({git, repositoryRoot: instance.scenarioRoot,
            requestPath: requireValue(instance.requestPath, 'Expected Request.'), reviewPath: originalPath});
        assert.equal(formal.status, 'failed');
        assert.equal(formal.phase, 'requirement-coverage');
        const input = {artifacts: [{reviewerId: response.reviewerId, instances: [{instanceId: instance.instanceId, artifactPaths: [originalPath]}]}]};
        const options = {agentIdentity, input, preparedPath: prepared.preparedPath, repositoryRoot};
        const pending = await scoreReviewerCapabilityCompletedRepetitions(options);
        assert.equal(pending.status, 'needs-adjudication');
        const scored = await scoreReviewerCapabilityCompletedRepetitions({...options,
            adjudication: {decisions: await fixtureCandidateDecisions(options,
                requireValue(pending.candidates, 'Expected valid requirement candidates.'))}});
        assert.equal(scored.status, 'diagnostic');
        const score = reviewerScore(scored);
        assert.ok(score.repetitionScores[0] > 0 && score.repetitionScores[0] < 1);
        assert.equal(score.finalRepetitionScores[0], score.repetitionScores[0] * 0.9);
        assert.deepEqual(score.repetitions.map(entry => entry.repetition), [1]);
        assert.equal(await readFile(originalPath, 'utf8'), invalidText);
    } finally {
        await writeFile(originalPath, originalBytes);
    }
});

test('prepared capability input starts through the shared offline Reviewer host with source configuration', async t => {
    const {prepared, repositoryRoot} = codeSpecCapabilityFixture;
    const handoff = requireValue(prepared.handoffs[0], 'Expected prepared capability handoff.');
    const installationDirectory = await createTemporaryDirectory(t, 'arw-capability-host-');
    const programDirectory = await createTemporaryDirectory(t, 'arw-capability-engine-');
    const sourceConfigPath = join(repositoryRoot, 'arw.config.json');
    const scenarioConfigPath = join(handoff.scenarioRoot, 'arw.config.json');
    const previousSource = await readFile(sourceConfigPath).catch(() => null);
    const previousScenario = await readFile(scenarioConfigPath).catch(() => null);
    const previousReport = await readFile(handoff.input.reportPath);
    const scripted = createScriptedReviewerSessions();
    let serverRunning = false;
    const nativeSessions = /** @type {import('../../lib/background-agent/codex-app-server.mjs').NativeSessions} */ ({
        async ensureServer() {serverRunning = true;},
        async observeServer() {return serverRunning ? 'running' : 'absent';},
        async close() {serverRunning = false; return {environmentState: 'exited', previousProcessState: 'absent'};},
        open: input => scripted.nativeSessions.open(input),
    });
    /** @type {Awaited<ReturnType<typeof createBackgroundAgentHost>> | null} */
    let host = null;
    try {
        await writeFile(join(programDirectory, 'config.json'), JSON.stringify({
            configVersion: 3, editor: {command: 'code', args: ['{file}']},
            reviewEditor: {command: 'code', args: ['{file}']}, jira: {listLimit: 50},
            reviewers: {'code-spec-reviewer': {model: 'engine-only-model', modelProvider: 'engine-provider',
                reasoningEffort: 'high', serviceTier: 'fast'}},
        }));
        await writeFile(sourceConfigPath, JSON.stringify({
            configVersion: 2, reviewers: {'code-spec-reviewer': {model: 'source-checkout-model'}},
        }));
        await writeFile(scenarioConfigPath, JSON.stringify({
            configVersion: 2, reviewers: {'code-spec-reviewer': {model: 'scene-only-model'}},
        }));
        await writeFile(handoff.input.reportPath, '');
        host = await createBackgroundAgentHost({installationDirectory, programDirectory, nativeSessions});
        const accepted = await host.dispatch({
            ownerId: agentIdentity.sessionId,
            caller: {repositoryRoot, programDirectory},
            operation: 'spawn_agent',
            input: handoff.input,
        });
        assert.equal(accepted.status, 'succeeded', JSON.stringify(accepted));
        if (accepted.status !== 'succeeded') assert.fail('Expected accepted Reviewer run.');
        const runId = String(/** @type {{runId: unknown}} */ (accepted.result).runId);
        await host.manager.owned(runId, agentIdentity.sessionId, agentIdentity.sessionId).work;
        const observed = await host.dispatch({
            ownerId: agentIdentity.sessionId,
            caller: {repositoryRoot, programDirectory},
            operation: 'list_agents',
            input: {runId},
        });
        assert.equal(observed.status, 'succeeded', JSON.stringify(observed));
        assert.equal(scripted.sessions.length, 1);
        const opened = requireValue(scripted.sessions[0], 'Expected native Reviewer session.').input;
        assert.equal(opened.cwd, handoff.scenarioRoot);
        assert.deepEqual(opened.writePaths, handoff.input.writePaths);
        assert.equal(opened.settings.model, 'source-checkout-model');
        assert.equal(opened.settings.modelProvider, 'engine-provider');
        assert.equal(opened.settings.reasoningEffort, 'high');
        assert.equal(opened.settings.serviceTier, 'fast');
        assert.equal(opened.settings.config['agents.enabled'], false);
        assert.equal(opened.settings.config['features.multi_agent'], false);
        assert.equal(scripted.calls.filter(call => call.operation === 'start').length, 1);
    } finally {
        await host?.manager.close();
        if (previousSource === null) await rm(sourceConfigPath, {force: true});
        else await writeFile(sourceConfigPath, previousSource);
        if (previousScenario === null) await rm(scenarioConfigPath, {force: true});
        else await writeFile(scenarioConfigPath, previousScenario);
        await writeFile(handoff.input.reportPath, previousReport);
    }
});
