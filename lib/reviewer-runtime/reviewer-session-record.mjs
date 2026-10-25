import {join, isAbsolute, posix, relative, resolve, sep} from 'node:path';
import {resolveAbsolutePathWithinScope} from '../common/filesystem.mjs';
import {digestJson, isJsonObject, parseJsonText, serializeJson} from '../common/json.mjs';
import {parseCanonicalArtifactId} from '../arw-common/artifact-identity.mjs';
import {validateReviewerFields} from '../arw-common/reviewer-configuration.mjs';
import {resolveTemporaryWorkspace} from '../arw-common/temporary-workspace.mjs';
import {REVIEWER_USAGE_FIELDS} from './reviewer-measurement.mjs';

/** @typedef {import('../background-agent/codex-app-server.mjs').NativeSettings} NativeSettings */
/** @typedef {import('../common/filesystem.mjs').ScopedFilesystem} ScopedFilesystem */
/** @typedef {{open: typeof import('../common/filesystem.mjs').createScopedFilesystem}} ReviewerFilesystem */
/** @typedef {{repositoryRoot: string, sessionWorkspaceRoot: string}} ReviewerRecoveryBoundary */
/** @typedef {{kind: 'ordinary', issueIds: string[]} | {kind: 'isolated', instanceId: string}} ReviewerIdentity */
/** @typedef {'starting' | 'running' | 'idle' | 'interrupted' | 'stopped' | 'failed'} ReviewerState */
/** @typedef {{status: 'ready', reportPath: string} | {status: 'incomplete', reason: string, reportPath: string}} ReviewerCompletion */
/** @typedef {{code: string, message: string}} ReviewerError */
/**
 * @typedef {object} ReviewerSessionRecord
 * @property {string} runId
 * @property {string} role
 * @property {ReviewerIdentity} identity
 * @property {NativeSettings} settings
 * @property {string} cwd
 * @property {string[]} readPaths
 * @property {string[]} writePaths
 * @property {string} reportPath
 * @property {string} recoveryPath
 * @property {string | null} threadId
 * @property {string | null} sessionPath
 * @property {string | null} turnId
 * @property {string[]} knownThreadIds
 * @property {Record<string, number>} contextFloors
 * @property {import('./reviewer-measurement.mjs').ReviewerMeasurement} measurement
 * @property {import('../background-agent/strata-work-policy.mjs').StrataCompactBinding | null} [compactBinding]
 * @property {ReviewerState} state
 * @property {'running' | 'exited'} environmentState
 * @property {boolean} factsComplete
 * @property {ReviewerCompletion | null} completion
 * @property {ReviewerError | null} failure
 */

/** @param {string} code @param {string} message */
export const reviewerFailure = (code, message) => Object.assign(new Error(message), {code});

/** @param {unknown} value @param {string} label @returns {string} */
export const requireReviewerText = (value, label) => {
    if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
        throw reviewerFailure('invalid-input', `${label} must be a non-empty string.`);
    }
    return value;
};

/** @param {unknown} value @param {string} label @returns {string} */
export const requireReviewerPath = (value, label) => {
    const path = requireReviewerText(value, label);
    if (!isAbsolute(path)) throw reviewerFailure('invalid-input', `${label} must be an absolute path.`);
    return resolve(path);
};

/** @param {unknown} value @param {string} label @returns {string[]} */
export const requireReviewerPaths = (value, label) => {
    if (!Array.isArray(value)) throw reviewerFailure('invalid-input', `${label} must be an array of absolute paths.`);
    return [...new Set(value.map(path => requireReviewerPath(path, label)))];
};

/** @param {unknown} value @returns {ReviewerIdentity} */
export const normalizeReviewerIdentity = value => {
    if (!isJsonObject(value)) {
        throw reviewerFailure('invalid-input', 'Reviewer identity must be an object.');
    }
    if ('kind' in value && value.kind === 'ordinary' && 'issueIds' in value && Array.isArray(value.issueIds) && value.issueIds.length > 0) {
        const issueIds = [...new Set(value.issueIds.map(id => {
            const text = requireReviewerText(id, 'issueIds entry');
            try {
                if (parseCanonicalArtifactId(text).kind !== 'issue') throw new Error('Identity is not an issue.');
            } catch {
                throw reviewerFailure('invalid-input', 'Ordinary Reviewer identities require complete canonical issue IDs.');
            }
            return text;
        }))];
        issueIds.sort();
        return {kind: 'ordinary', issueIds};
    }
    if ('kind' in value && value.kind === 'isolated' && 'instanceId' in value) {
        return {kind: 'isolated', instanceId: requireReviewerText(value.instanceId, 'instanceId')};
    }
    throw reviewerFailure('invalid-input', 'Reviewer identity requires ordinary issueIds or an isolated instanceId.');
};

/** @param {{stateDirectory: string, role: string, identity: ReviewerIdentity}} input */
export const reviewerRecoveryPath = ({stateDirectory, role, identity}) =>
    join(stateDirectory, `reviewer-${digestJson({role, identity})}.json`);

/** @param {string} recoveryPath @param {ReviewerRecoveryBoundary} boundary */
export const requireReviewerRecoveryLocation = (recoveryPath, boundary) => {
    const {repositoryRoot, sessionWorkspaceRoot} = boundary;
    const withinTemp = resolveAbsolutePathWithinScope({path: recoveryPath, scope: join(repositoryRoot, '.tmp')});
    if (withinTemp.status !== 'succeeded') throw reviewerFailure('invalid-input', 'Reviewer recovery path must stay in the launching repository temporary workspace.');
    const segments = withinTemp.relativePath.split(sep);
    if (segments.length < 3) throw reviewerFailure('invalid-input', 'Reviewer recovery path must name a session workspace record.');
    try {
        const sessionRoot = resolveTemporaryWorkspace({
            agentIdentity: {platform: segments[0], sessionId: segments[1]}, repositoryRoot,
        });
        if (resolveAbsolutePathWithinScope({path: recoveryPath, scope: sessionRoot}).status !== 'succeeded') {
            throw new Error('Recovery path escaped its session workspace.');
        }
    } catch {
        throw reviewerFailure('invalid-input', 'Reviewer recovery path must name a valid session workspace record.');
    }
    return {
        relativePath: relative(repositoryRoot, recoveryPath).split(sep).join('/'),
        currentSession: resolveAbsolutePathWithinScope({path: recoveryPath, scope: sessionWorkspaceRoot}).status === 'succeeded',
    };
};

/** @param {ReviewerFilesystem} filesystem @param {string} repositoryRoot @param {string} relativePath @returns {Promise<ScopedFilesystem>} */
export const openReviewerRecordFilesystem = async (filesystem, repositoryRoot, relativePath) => {
    const opened = await filesystem.open({root: repositoryRoot});
    if (opened.status !== 'succeeded') {
        throw reviewerFailure('recovery-io-failed', 'The launching repository could not be opened for Reviewer recovery.');
    }
    const directory = await opened.scopedFilesystem.inspect({path: posix.dirname(relativePath)});
    if (directory.status !== 'succeeded' || directory.entry.kind !== 'directory') {
        throw reviewerFailure('recovery-io-failed', 'The caller-prepared recovery directory could not be opened.');
    }
    return opened.scopedFilesystem;
};

/** @param {ScopedFilesystem} filesystem @param {ReviewerSessionRecord} record @param {string} path */
export const saveReviewerSessionRecord = async (filesystem, record, path) => {
    const existing = await filesystem.inspect({path});
    if (existing.status !== 'succeeded') throw reviewerFailure('recovery-io-failed', 'The recovery record could not be inspected.');
    const serialized = serializeJson(record);
    if (serialized.status !== 'succeeded') throw reviewerFailure('recovery-invalid', 'The recovery facts could not be serialized.');
    const written = await filesystem.write({
        bytes: serialized.bytes,
        mode: existing.entry.kind === 'missing' ? 'create-atomic' : 'replace',
        path,
    });
    if (written.status !== 'succeeded') {
        throw reviewerFailure('recovery-io-failed', 'The recovery record could not be saved. Previously saved recovery facts remain authoritative.');
    }
};

/** @param {unknown} value */
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0);
/** @param {unknown} value */
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
/** @param {unknown} value */
const usage = value => isJsonObject(value) && REVIEWER_USAGE_FIELDS.every(field => value[field] === null || finite(value[field]));
/** @param {unknown} value */
const nullableFinite = value => value === null || finite(value);
/** @param {unknown} value */
const workMeasurement = value => isJsonObject(value) && finite(value.excludedMs)
    && ['previousEnd', 'lastStart', 'lastEnd', 'openStart'].every(field => nullableFinite(value[field]))
    && (value.lastWorkingAt === undefined || nullableFinite(value.lastWorkingAt))
    && typeof value.estimated === 'boolean' && typeof value.coverage === 'boolean'
    && Array.isArray(value.basis) && value.basis.every(item => typeof item === 'string');
/** @param {unknown} value */
const responseMeasurement = value => isJsonObject(value)
    && typeof value.threadId === 'string' && value.threadId.length > 0
    && typeof value.responseId === 'string' && value.responseId.length > 0
    && (value.turnId === undefined || value.turnId === null || typeof value.turnId === 'string')
    && (value.recordSequence === undefined || finite(value.recordSequence))
    && ['startedAt', 'completedAt', 'inputTokens', 'cachedInputTokens', 'outputTokens',
        'firstGeneratedAt', 'lastGeneratedAt', 'firstChunkTokens'].every(field =>
        value[field] === undefined || nullableFinite(value[field]))
    && (value.source === undefined || value.source === 'client-request' || value.source === 'existing-events')
    && (value.basis === undefined || typeof value.basis === 'string');
/** @param {unknown} value */
const phaseMeasurement = value => isJsonObject(value) && typeof value.fresh === 'boolean'
    && typeof value.complete === 'boolean' && strings(value.baselineResponses)
    && nullableFinite(value.recordFloor) && isJsonObject(value.responses)
    && Object.values(value.responses).every(responseMeasurement);

/** @param {ScopedFilesystem} filesystem @param {string} recoveryPath @param {string} path @returns {Promise<ReviewerSessionRecord | null>} */
export const readReviewerSessionRecord = async (filesystem, recoveryPath, path) => {
    const existing = await filesystem.inspect({path});
    if (existing.status !== 'succeeded') throw reviewerFailure('recovery-io-failed', 'The recovery record could not be inspected.');
    if (existing.entry.kind === 'missing') return null;
    const read = await filesystem.read({path});
    if (read.status !== 'succeeded') throw reviewerFailure('recovery-io-failed', 'The recovery record could not be read.');
    const parsed = parseJsonText(read.bytes);
    if (parsed.status !== 'succeeded') throw reviewerFailure('recovery-invalid', 'The recovery record is not valid JSON.');
    const value = /** @type {unknown} */ (parsed.value);
    const settings = isJsonObject(value) && isJsonObject(value.settings) ? value.settings : null;
    if (!isJsonObject(value) || !isJsonObject(value.measurement) || !isJsonObject(value.measurement.threads)
        || !isJsonObject(value.contextFloors) || !settings
        || !['runId', 'role', 'cwd', 'reportPath', 'recoveryPath'].every(key => typeof value[key] === 'string' && value[key].length > 0)
        || !(typeof value.threadId === 'string' && value.threadId.length > 0
            || value.threadId === null && ['starting', 'failed', 'stopped'].includes(String(value.state)) && value.turnId === null)
        || !(value.sessionPath === null || typeof value.sessionPath === 'string')
        || !strings(value.readPaths) || !strings(value.writePaths) || !strings(value.knownThreadIds)
        || !['starting', 'running', 'idle', 'interrupted', 'stopped', 'failed'].includes(String(value.state))
        || !['running', 'exited'].includes(String(value.environmentState))
        || typeof value.factsComplete !== 'boolean'
        || !(value.turnId === null || typeof value.turnId === 'string')
        || !finite(value.measurement.startedAt)
        || !(value.measurement.finishedAt === null || finite(value.measurement.finishedAt))
        || Object.values(value.contextFloors).some(sequence => typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < -1)
        || Object.values(value.measurement.threads).some(thread => !isJsonObject(thread)
            || !usage(thread.baseline) || !usage(thread.observed) || !usage(thread.current) || typeof thread.participated !== 'boolean')
        || !(value.failure === null || (isJsonObject(value.failure) && typeof value.failure.code === 'string' && typeof value.failure.message === 'string'))
        || !(value.completion === null || (isJsonObject(value.completion)
            && ['ready', 'incomplete'].includes(String(value.completion.status)) && typeof value.completion.reportPath === 'string'
            && (value.completion.status !== 'incomplete' || typeof value.completion.reason === 'string')))) {
        throw reviewerFailure('recovery-invalid', 'The recovery record is missing required thread, binding or measurement facts.');
    }
    try {
        validateReviewerFields({
            model: settings.model,
            modelProvider: settings.modelProvider,
            reasoningEffort: settings.reasoningEffort,
            serviceTier: settings.serviceTier,
        }, 'recovery.settings');
    } catch (error) {
        throw reviewerFailure('recovery-invalid', error instanceof Error ? error.message : 'The recovery Reviewer settings are invalid.');
    }
    if (value.measurement.work !== undefined && !workMeasurement(value.measurement.work)) {
        throw reviewerFailure('recovery-invalid', 'The recovery work measurement has invalid structure or numeric facts.');
    }
    if (value.measurement.phases !== undefined && !phaseMeasurement(value.measurement.phases)) {
        throw reviewerFailure('recovery-invalid', 'The recovery response phase measurement has invalid structure or numeric facts.');
    }
    if(value.compactBinding!==undefined&&value.compactBinding!==null) {
        const binding=value.compactBinding;
        if(!isJsonObject(binding)||typeof binding.path!=='string'||!isAbsolute(binding.path)
          ||typeof binding.sha256!=='string'||!/^[a-f0-9]{64}$/.test(binding.sha256))
            throw reviewerFailure('recovery-invalid','The original compaction content binding is invalid.');
    }
    normalizeReviewerIdentity(value.identity);
    if (resolve(String(value.recoveryPath)) !== recoveryPath) {
        throw reviewerFailure('recovery-invalid', 'The recovery record does not match its exact location.');
    }
    return /** @type {ReviewerSessionRecord} */ (/** @type {unknown} */ (value));
};
