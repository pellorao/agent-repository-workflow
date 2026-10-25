#!/usr/bin/env node

import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

import {loadConfig} from '../lib/arw-common/config.mjs';
import {createScopedFilesystem} from '../lib/common/filesystem.mjs';
import {parseJson, writeJson} from '../lib/common/json.mjs';
import {createCurrentPlatformAdapter} from '../lib/arw-common/platform-adapter.mjs';
import {reviewSkillReferences} from '../lib/workflow-distribution/skill-reference-review.mjs';
import {resolveTemporaryWorkspace} from '../lib/arw-common/temporary-workspace.mjs';
import {
    applyWorkflowDistributionSync,
    prepareWorkflowDistributionReview,
    prepareWorkflowDistributionSync,
} from '../lib/workflow-distribution/workflow-distribution-sync.mjs';

const SOURCE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REVIEW_WORKSPACE_PURPOSE = '_workflow-distribution-sync';
const REVIEW_HANDOFF_PATH = 'completed-review.json';
const HASH = /^[0-9a-f]{64}$/u;
const CLI_USAGE = 'Usage:\n'
    + '  node scripts/sync-workflow-distribution.mjs review\n'
    + '  node scripts/sync-workflow-distribution.mjs review --confirm <additional-skill-references-hash> <skill-reference-normalizations-hash>\n'
    + '  node scripts/sync-workflow-distribution.mjs prepare\n'
    + '  node scripts/sync-workflow-distribution.mjs apply --plan-digest <plan-digest>\n';
/** @param {string} code @param {string} message @returns {{diagnostics: SyncDiagnostic[], status: 'blocked'}} */
const blocked = (code, message) => ({diagnostics: [{code, message}], status: 'blocked'});
/** @typedef {{code: string, message: string, path?: string}} SyncDiagnostic */
/** @typedef {{additionalSkillReferencesHash: string, skillReferenceNormalizationsHash: string}} ReviewHashes */
/** @typedef {{diagnostics?: SyncDiagnostic[], status: string}} SyncResult */
/** @typedef {{getCurrentAgentIdentity: () => {platform: string, sessionId: string}}} SyncPlatformAdapter */
/** @typedef {(repositoryRoot: string) => Promise<Record<string, unknown> & {reviewEditor?: {args: string[], command: string}}>} ConfigurationLoader */
/** @typedef {{additionalSkillReferences: unknown, confirmHashes?: ReviewHashes, emitHash?: (hash: string) => unknown, reviewEditor?: {args: string[], command: string}, skillReferenceNormalizations: unknown, workspaceDirectory: string}} ReviewInput */
/** @typedef {{additionalSkillReferences: string[], additionalSkillReferencesHash: string, skillReferenceNormalizations: Array<{column: number, context?: string, identity: string, line: number, path: string}>, skillReferenceNormalizationsHash: string, status: 'succeeded'}} CompletedReview */
/** @typedef {(input: ReviewInput) => Promise<CompletedReview | {diagnostics?: SyncDiagnostic[], status: 'blocked' | 'failed'}>} ReviewFunction */
/** @typedef {{configurationLoader?: ConfigurationLoader, createFilesystem?: typeof createScopedFilesystem, platformAdapter?: SyncPlatformAdapter, repositoryRoot?: string, review?: ReviewFunction, stderr?: (value: string) => unknown, stdout?: (value: string) => unknown, syncApply?: typeof applyWorkflowDistributionSync, syncPrepare?: typeof prepareWorkflowDistributionSync, syncReview?: typeof prepareWorkflowDistributionReview}} SyncCliOptions */

/** @param {string[]} args */
const parseInvocation = args => {
    if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) return null;
    if (args.length === 1 && args[0] === 'review') return {command: 'review', confirmHashes: null};
    if (args.length === 4
        && args[0] === 'review'
        && args[1] === '--confirm'
        && HASH.test(args[2])
        && HASH.test(args[3])) {
        return {
            command: 'review',
            confirmHashes: {
                additionalSkillReferencesHash: args[2],
                skillReferenceNormalizationsHash: args[3],
            },
        };
    }
    if (args.length === 1 && args[0] === 'prepare') return {command: 'prepare'};
    if (args.length === 3
        && args[0] === 'apply'
        && args[1] === '--plan-digest'
        && HASH.test(args[2])) {
        return {command: 'apply', planDigest: args[2]};
    }
    return null;
};

/** @param {unknown} value @returns {value is ReviewHashes} */
const exactReviewHashes = value => value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [
        'additionalSkillReferencesHash',
        'skillReferenceNormalizationsHash',
    ].sort().join('\0')
    && 'additionalSkillReferencesHash' in value
    && 'skillReferenceNormalizationsHash' in value
    && typeof value.additionalSkillReferencesHash === 'string'
    && typeof value.skillReferenceNormalizationsHash === 'string'
    && HASH.test(value.additionalSkillReferencesHash)
    && HASH.test(value.skillReferenceNormalizationsHash);

/** @param {unknown} value @returns {value is ReviewHashes} */
const hasReviewHashes = value => value !== null && typeof value === 'object'
    && 'additionalSkillReferencesHash' in value
    && 'skillReferenceNormalizationsHash' in value
    && typeof value.additionalSkillReferencesHash === 'string'
    && typeof value.skillReferenceNormalizationsHash === 'string'
    && HASH.test(value.additionalSkillReferencesHash)
    && HASH.test(value.skillReferenceNormalizationsHash);

/** @param {unknown} value @returns {value is CompletedReview} */
const isCompletedReview = value => value !== null
    && typeof value === 'object'
    && 'status' in value
    && 'additionalSkillReferences' in value
    && 'skillReferenceNormalizations' in value
    && value.status === 'succeeded'
    && Array.isArray(value.additionalSkillReferences)
    && value.additionalSkillReferences.every((/** @type {unknown} */ entry) => typeof entry === 'string')
    && Array.isArray(value.skillReferenceNormalizations)
    && hasReviewHashes(value);

/** @param {{platformAdapter: SyncPlatformAdapter, repositoryRoot: string}} input */
const resolveReviewWorkspace = ({platformAdapter, repositoryRoot}) => resolveTemporaryWorkspace({
    agentIdentity: platformAdapter.getCurrentAgentIdentity(),
    purpose: REVIEW_WORKSPACE_PURPOSE,
    repositoryRoot,
});

const invalidReviewHandoff = () => blocked(
    'sync-review-handoff-invalid',
    'The completed Workflow Distribution review handoff is invalid.',
);

const unavailableReviewHandoff = () => blocked(
    'sync-review-handoff-unavailable',
    'A completed Workflow Distribution review is required before this command.',
);

/** @param {{createFilesystem: typeof createScopedFilesystem, createRoot: boolean, workspaceDirectory: string}} input */
const openReviewWorkspace = async ({createFilesystem, createRoot, workspaceDirectory}) => {
    const created = await createFilesystem({createRoot, root: workspaceDirectory});
    if (created.status === 'succeeded') return created;
    if (!createRoot
        && created.status === 'blocked'
        && created.diagnostics?.length === 1
        && created.diagnostics[0].code === 'filesystem-root-missing') {
        return unavailableReviewHandoff();
    }
    return created;
};

/** @param {{createFilesystem: typeof createScopedFilesystem, workspaceDirectory: string}} input */
const invalidateReviewHandoff = async ({createFilesystem, workspaceDirectory}) => {
    const created = await openReviewWorkspace({createFilesystem, createRoot: true, workspaceDirectory});
    if (created.status !== 'succeeded') return created;
    const inspected = await created.scopedFilesystem.inspect({path: REVIEW_HANDOFF_PATH});
    if (inspected.status !== 'succeeded') return inspected;
    if (inspected.entry.kind === 'missing') return {diagnostics: [], status: 'succeeded'};
    if (inspected.entry.kind !== 'file') return invalidReviewHandoff();
    return created.scopedFilesystem.remove({path: REVIEW_HANDOFF_PATH});
};

/** @param {{createFilesystem: typeof createScopedFilesystem, review: ReviewHashes, workspaceDirectory: string}} input */
const writeReviewHandoff = async ({createFilesystem, review, workspaceDirectory}) => {
    const hashes = {
        additionalSkillReferencesHash: review.additionalSkillReferencesHash,
        skillReferenceNormalizationsHash: review.skillReferenceNormalizationsHash,
    };
    if (!exactReviewHashes(hashes)) return invalidReviewHandoff();
    const created = await openReviewWorkspace({createFilesystem, createRoot: true, workspaceDirectory});
    if (created.status !== 'succeeded') return created;
    const inspected = await created.scopedFilesystem.inspect({path: REVIEW_HANDOFF_PATH});
    if (inspected.status !== 'succeeded') return inspected;
    if (!['file', 'missing'].includes(inspected.entry.kind)) return invalidReviewHandoff();
    const written = await writeJson({
        filesystem: created.scopedFilesystem,
        path: REVIEW_HANDOFF_PATH,
        value: hashes,
    }, {mode: inspected.entry.kind === 'missing' ? 'create' : 'replace'});
    return written.status === 'succeeded'
        ? {diagnostics: [], status: 'succeeded'}
        : written;
};

/** @param {{createFilesystem: typeof createScopedFilesystem, workspaceDirectory: string}} input */
const readReviewHandoff = async ({createFilesystem, workspaceDirectory}) => {
    const created = await openReviewWorkspace({createFilesystem, createRoot: false, workspaceDirectory});
    if (created.status !== 'succeeded') return created;
    const inspected = await created.scopedFilesystem.inspect({path: REVIEW_HANDOFF_PATH});
    if (inspected.status !== 'succeeded') return inspected;
    if (inspected.entry.kind === 'missing') return unavailableReviewHandoff();
    if (inspected.entry.kind !== 'file') return invalidReviewHandoff();
    const parsed = await parseJson({filesystem: created.scopedFilesystem, path: REVIEW_HANDOFF_PATH});
    if (parsed.status === 'failed') return parsed;
    if (parsed.status !== 'succeeded' || !('value' in parsed) || !exactReviewHashes(parsed.value)) return invalidReviewHandoff();
    return {diagnostics: [], hashes: parsed.value, status: 'succeeded'};
};

/** @param {ReviewHashes} hashes */
const renderReviewHashes = hashes => JSON.stringify({
    additionalSkillReferencesHash: hashes.additionalSkillReferencesHash,
    skillReferenceNormalizationsHash: hashes.skillReferenceNormalizationsHash,
}, null, 2);

/** @param {{planDigest: string}} plan */
export const renderWorkflowDistributionSyncPlan = plan => JSON.stringify({
    planDigest: plan.planDigest,
}, null, 2);

/** @param {{configurationLoader: ConfigurationLoader, confirmHashes: ReviewHashes | null, createFilesystem: typeof createScopedFilesystem, repositoryRoot: string, review: ReviewFunction, stdout: (value: string) => unknown, syncReview: typeof prepareWorkflowDistributionReview, workspaceDirectory: string}} input */
const runReview = async ({
    configurationLoader,
    confirmHashes,
    createFilesystem,
    repositoryRoot,
    review,
    stdout,
    syncReview,
    workspaceDirectory,
}) => {
    let reviewEditor;
    if (confirmHashes === null) {
        const configuration = await configurationLoader(repositoryRoot);
        if (configuration.reviewEditor === undefined) {
            return blocked(
                'review-editor-unavailable',
                'The Source Checkout configuration does not provide reviewEditor.',
            );
        }
        reviewEditor = configuration.reviewEditor;
    }

    const analysis = await syncReview({repositoryRoot});
    if (analysis.status !== 'succeeded') return analysis;
    if (confirmHashes === null) {
        const invalidated = await invalidateReviewHandoff({createFilesystem, workspaceDirectory});
        if (invalidated.status !== 'succeeded') return invalidated;
    }

    /** @type {string[]} */
    const emittedHashes = [];
    const reviewed = await review({
        additionalSkillReferences: analysis.additionalSkillReferences,
        ...(confirmHashes === null ? {emitHash: hash => emittedHashes.push(hash), reviewEditor} : {confirmHashes}),
        skillReferenceNormalizations: analysis.skillReferenceNormalizations,
        workspaceDirectory,
    });
    const outputHashes = emittedHashes.length === 2
        ? {
            additionalSkillReferencesHash: emittedHashes[0],
            skillReferenceNormalizationsHash: emittedHashes[1],
        }
        : reviewed.status === 'succeeded' && hasReviewHashes(reviewed)
            ? {
                additionalSkillReferencesHash: reviewed.additionalSkillReferencesHash,
                skillReferenceNormalizationsHash: reviewed.skillReferenceNormalizationsHash,
            }
            : null;
    if (outputHashes !== null && exactReviewHashes(outputHashes)) stdout(`${renderReviewHashes(outputHashes)}\n`);
    if (reviewed.status !== 'succeeded') return reviewed;
    if (!hasReviewHashes(reviewed)) return invalidReviewHandoff();

    const written = await writeReviewHandoff({
        createFilesystem,
        review: {
            additionalSkillReferencesHash: reviewed.additionalSkillReferencesHash,
            skillReferenceNormalizationsHash: reviewed.skillReferenceNormalizationsHash,
        },
        workspaceDirectory,
    });
    return written.status === 'succeeded' ? reviewed : written;
};

/** @param {{createFilesystem: typeof createScopedFilesystem, repositoryRoot: string, review: ReviewFunction, syncReview: typeof prepareWorkflowDistributionReview, workspaceDirectory: string}} input */
const loadCompletedReview = async ({
    createFilesystem,
    repositoryRoot,
    review,
    syncReview,
    workspaceDirectory,
}) => {
    const handoff = await readReviewHandoff({createFilesystem, workspaceDirectory});
    if (handoff.status !== 'succeeded') return handoff;
    if (!('hashes' in handoff)) return invalidReviewHandoff();
    const analysis = await syncReview({repositoryRoot});
    if (analysis.status !== 'succeeded') return analysis;
    return review({
        additionalSkillReferences: analysis.additionalSkillReferences,
        confirmHashes: handoff.hashes,
        skillReferenceNormalizations: analysis.skillReferenceNormalizations,
        workspaceDirectory,
    });
};

/** @param {SyncDiagnostic} diagnostic */
const renderDiagnostic = diagnostic => {
    const path = diagnostic.path === undefined ? '' : ` path=${diagnostic.path}`;
    return `${diagnostic.code}${path}: ${diagnostic.message}`;
};

/** @param {{command: string, result: SyncResult, stderr: (value: string) => unknown, stdout: (value: string) => unknown}} input */
const presentResult = ({command, result, stderr, stdout}) => {
    for (const diagnostic of result.diagnostics ?? []) stderr(`${renderDiagnostic(diagnostic)}\n`);
    if (result.status !== 'succeeded') return 1;
    const message = command === 'review'
        ? 'Workflow Distribution review completed.'
        : command === 'prepare'
            ? 'Workflow Distribution sync plan prepared.'
            : 'Workflow Distribution synchronization completed.';
    stdout(`${message}\n`);
    return 0;
};

export const runWorkflowDistributionSyncCli = async (/** @type {string[]} */ args, /** @type {SyncCliOptions} */ {
    configurationLoader = loadConfig,
    createFilesystem = createScopedFilesystem,
    platformAdapter = createCurrentPlatformAdapter(),
    repositoryRoot = SOURCE_ROOT,
    review = reviewSkillReferences,
    stderr = (/** @type {string | Uint8Array<ArrayBufferLike>} */ value) => process.stderr.write(value),
    stdout = (/** @type {string | Uint8Array<ArrayBufferLike>} */ value) => process.stdout.write(value),
    syncApply = applyWorkflowDistributionSync,
    syncPrepare = prepareWorkflowDistributionSync,
    syncReview = prepareWorkflowDistributionReview,
} = {}) => {
    const invocation = parseInvocation(args);
    if (invocation === null) {
        stderr(CLI_USAGE);
        return 2;
    }

    try {
        const workspaceDirectory = resolveReviewWorkspace({platformAdapter, repositoryRoot});
        let result;
        if (invocation.command === 'review') {
            result = await runReview({
                configurationLoader,
                confirmHashes: invocation.confirmHashes ?? null,
                createFilesystem,
                repositoryRoot,
                review,
                stdout,
                syncReview,
                workspaceDirectory,
            });
        } else {
            const completedReview = await loadCompletedReview({
                createFilesystem,
                repositoryRoot,
                review,
                syncReview,
                workspaceDirectory,
            });
            if (completedReview.status !== 'succeeded') {
                result = completedReview;
            } else if (!isCompletedReview(completedReview)) {
                result = invalidReviewHandoff();
            } else {
                const plan = await syncPrepare({repositoryRoot, review: completedReview});
                if (plan.status !== 'succeeded') {
                    result = plan;
                } else if (invocation.command === 'prepare') {
                    stdout(`${renderWorkflowDistributionSyncPlan(plan)}\n`);
                    result = plan;
                } else {
                    result = await syncApply({
                        authorization: {approved: true, planDigest: invocation.planDigest},
                        plan,
                    });
                }
            }
        }
        return presentResult({command: invocation.command, result, stderr, stdout});
    } catch (error) {
        stderr(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = await runWorkflowDistributionSyncCli(process.argv.slice(2));
}
