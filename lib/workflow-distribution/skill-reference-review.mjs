
import {launchConfiguredEditor} from '../arw-common/editor-process.mjs';
import {isSkillIdentity} from '../arw-common/skill-identity.mjs';
import {createScopedFilesystem} from '../common/filesystem.mjs';
import {compareText, isJsonObject, parseJsonText, serializeJson, sha256} from '../common/json.mjs';
import {validateText} from '../common/text-policy.mjs';

export const ADDITIONAL_SKILL_REFERENCES_FILE = 'additional-skill-references.txt';
export const SKILL_REFERENCE_NORMALIZATIONS_FILE = 'skill-reference-normalizations.jsonl';

const HASH = /^[0-9a-f]{64}$/u;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
/** @typedef {{column: number, context: string, identity: string, line: number, path: string}} SkillReferenceNormalization */
/** @typedef {{additionalSkillReferencesHash: string, skillReferenceNormalizationsHash: string}} ReviewHashes */
/** @typedef {{bytes: Buffer, lines: string[], path: string}} ReviewOriginal */
/** @typedef {{bytes: Buffer, lines: string[], path: string, retained: string[]}} ReviewedFile */
/** @typedef {Extract<Awaited<ReturnType<typeof createScopedFilesystem>>, {status: 'succeeded'}>['scopedFilesystem']} ReviewFilesystem */
/** @typedef {{diagnostics: Array<{code: string, message: string, path?: string}>, stage?: string, status: 'blocked' | 'failed'}} ReviewUnsuccessful */
/** @typedef {{additionalSkillReferences: string[], additionalSkillReferencesHash: string, diagnostics: never[], skillReferenceNormalizations: SkillReferenceNormalization[], skillReferenceNormalizationsHash: string, status: 'succeeded'}} ReviewSucceeded */

/** @param {unknown} value @returns {value is string} */
const canonicalSkillMarkdownPath = value => {
    if (typeof value !== 'string'
        || !value.startsWith('skills/')
        || !value.endsWith('.md')
        || value.includes('\\')
        || /[\0-\x1f\x7f]/u.test(value)) return false;
    const [root, identity, ...relativePath] = value.split('/');
    return root === 'skills'
        && typeof identity === 'string'
        && isSkillIdentity(identity)
        && relativePath.length > 0
        && [root, identity, ...relativePath].every(component => component !== ''
            && component !== '.'
            && component !== '..'
            && !/[<>:"|?*]/u.test(component)
            && !/[. ]$/u.test(component)
            && !WINDOWS_RESERVED.test(component));
};

/** @param {SkillReferenceNormalization} left @param {SkillReferenceNormalization} right */
const normalizationOrder = (left, right) => compareText(left.path, right.path)
    || left.line - right.line
    || left.column - right.column
    || compareText(left.identity, right.identity);

/** @param {unknown} value @returns {value is SkillReferenceNormalization} */
const exactNormalization = value => isJsonObject(value)
    && Object.keys(value).sort(compareText).join('\0') === ['column', 'context', 'identity', 'line', 'path'].join('\0')
    && canonicalSkillMarkdownPath(value.path)
    && typeof value.line === 'number'
    && Number.isSafeInteger(value.line)
    && value.line > 0
    && typeof value.column === 'number'
    && Number.isSafeInteger(value.column)
    && value.column > 0
    && typeof value.identity === 'string'
    && isSkillIdentity(value.identity)
    && typeof value.context === 'string'
    && value.context.length > 0;

/** @param {unknown} value @returns {value is string[]} */
const exactSkillIdentities = value => Array.isArray(value)
    && value.every(identity => typeof identity === 'string' && isSkillIdentity(identity));

/** @param {unknown} value @returns {value is SkillReferenceNormalization[]} */
const exactNormalizations = value => Array.isArray(value) && value.every(exactNormalization);

/**
 * @param {{additionalSkillReferences: unknown, skillReferenceNormalizations: unknown}} input
 * @returns {{additionalSkillReferences: string[], skillReferenceNormalizations: SkillReferenceNormalization[]}}
 */
const assertCandidates = ({additionalSkillReferences, skillReferenceNormalizations}) => {
    if (!exactSkillIdentities(additionalSkillReferences)
        || new Set(additionalSkillReferences).size !== additionalSkillReferences.length
        || [...additionalSkillReferences].sort(compareText).some((identity, index) => identity !== additionalSkillReferences[index])) {
        throw new TypeError('additionalSkillReferences must be sorted, unique Skill identities.');
    }
    if (!exactNormalizations(skillReferenceNormalizations)
        || [...skillReferenceNormalizations].sort(normalizationOrder)
            .some((record, index) => normalizationOrder(record, skillReferenceNormalizations[index]) !== 0)) {
        throw new TypeError('skillReferenceNormalizations must be valid and sorted.');
    }
    return {additionalSkillReferences, skillReferenceNormalizations};
};

/** @param {SkillReferenceNormalization} record */
const normalLine = record => {
    const serialized = serializeJson({
        path: record.path,
        line: record.line,
        column: record.column,
        identity: record.identity,
        context: record.context,
    }, {format: 'compact'});
    if (serialized.status !== 'succeeded') throw new TypeError('Skill reference normalization must be JSON serializable.');
    return serialized.bytes.toString('utf8');
};

/** @param {string[]} lines */
const linesToBytes = lines => Buffer.from(lines.length === 0 ? '' : `${lines.join('\n')}\n`, 'utf8');

/** @param {{bytes: Buffer, originalLines: string[], path: string}} input @returns {ReviewUnsuccessful | {lines: string[], status: 'succeeded'}} */
const retainedLines = ({bytes, originalLines, path}) => {
    const validated = validateText(bytes);
    if (validated.status !== 'succeeded') {
        return {diagnostics: validated.diagnostics.map(entry => ({...entry, path})), status: 'blocked'};
    }
    const text = bytes.toString('utf8');
    if (text.length > 0 && !text.endsWith('\n')) {
        return {
            diagnostics: [{code: 'review-edit-not-delete-only', message: 'Review files must retain LF-delimited complete lines.', path}],
            status: 'blocked',
        };
    }
    const lines = text.length === 0 ? [] : text.slice(0, -1).split('\n');
    let cursor = 0;
    for (const line of lines) {
        while (cursor < originalLines.length && originalLines[cursor] !== line) cursor += 1;
        if (cursor >= originalLines.length) {
            return {
                diagnostics: [{code: 'review-edit-not-delete-only', message: 'Review files may only delete original lines without reordering them.', path}],
                status: 'blocked',
            };
        }
        cursor += 1;
    }
    return {lines, status: 'succeeded'};
};

/** @param {{filesystem: ReviewFilesystem, originals: ReviewOriginal[]}} input @returns {Promise<ReviewUnsuccessful | {files: ReviewedFile[], status: 'succeeded'}>} */
const readReviewFiles = async ({filesystem, originals}) => {
    /** @type {ReviewedFile[]} */
    const results = [];
    for (const file of originals) {
        const read = await filesystem.read({path: file.path});
        if (read.status !== 'succeeded') {
            return read.status === 'failed' ? {...read, stage: read.stage ?? 'review-read'} : read;
        }
        const retained = retainedLines({bytes: read.bytes, originalLines: file.lines, path: file.path});
        if (retained.status !== 'succeeded') return retained;
        results.push({...file, bytes: read.bytes, retained: retained.lines});
    }
    return {files: results, status: 'succeeded'};
};

/** @param {{file: ReviewOriginal, filesystem: ReviewFilesystem}} input @returns {Promise<ReviewUnsuccessful | {status: 'succeeded'}>} */
const writeReviewFile = async ({file, filesystem}) => {
    const inspected = await filesystem.inspect({path: file.path});
    if (inspected.status !== 'succeeded') {
        return inspected.status === 'failed' ? {...inspected, stage: inspected.stage ?? 'review-write'} : inspected;
    }
    const written = await filesystem.write({
        bytes: file.bytes,
        mode: inspected.entry.kind === 'missing' ? 'create' : 'replace',
        path: file.path,
    });
    return written.status === 'failed' ? {...written, stage: written.stage ?? 'review-write'} : written;
};

/**
 * @param {{file: ReviewOriginal, filesystem: ReviewFilesystem, launchEditor: typeof launchConfiguredEditor, reviewEditor: unknown}} input
 * @returns {Promise<ReviewUnsuccessful | {status: 'succeeded'}>}
 */
const openReviewFile = async ({file, filesystem, launchEditor, reviewEditor}) => {
    try {
        const resolved = filesystem.resolve({path: file.path});
        if (resolved.status !== 'succeeded') throw new Error('Skill Review file path escapes its temporary workspace.');
        await launchEditor({
            editor: reviewEditor,
            filePath: resolved.absolutePath,
            wait: true,
        });
        return {status: 'succeeded'};
    } catch (error) {
        return {
            diagnostics: [{code: 'review-editor-failed', message: error instanceof Error ? error.message : String(error), path: file.path}],
            stage: 'editor',
            status: 'failed',
        };
    }
};

/** @param {ReviewedFile[]} files @returns {ReviewSucceeded} */
const completedResult = files => {
    const additional = files[0];
    const normalizations = files[1];
    if (additional === undefined || normalizations === undefined) {
        throw new Error('Reviewed Skill reference files are incomplete.');
    }
    return {
        status: 'succeeded',
        additionalSkillReferences: additional.retained,
        skillReferenceNormalizations: normalizations.retained.map((/** @type {string} */ line) => {
            const parsed = parseJsonText(line);
            if (parsed.status !== 'succeeded') throw new Error('Reviewed Skill reference normalization is not valid JSON.');
            return parsed.value;
        }),
        additionalSkillReferencesHash: sha256(additional.bytes),
        skillReferenceNormalizationsHash: sha256(normalizations.bytes),
        diagnostics: [],
    };
};

/** @param {{additionalSkillReferences: string[], skillReferenceNormalizations: SkillReferenceNormalization[]}} input @returns {ReviewOriginal[]} */
const originalsFor = ({additionalSkillReferences, skillReferenceNormalizations}) => [
    {
        bytes: linesToBytes(additionalSkillReferences),
        lines: additionalSkillReferences,
        path: ADDITIONAL_SKILL_REFERENCES_FILE,
    },
    {
        bytes: linesToBytes(skillReferenceNormalizations.map(normalLine)),
        lines: skillReferenceNormalizations.map(normalLine),
        path: SKILL_REFERENCE_NORMALIZATIONS_FILE,
    },
];

/**
 * @param {{additionalSkillReferences: string[], retainedAdditionalSkillReferences: string[], skillReferenceNormalizations: SkillReferenceNormalization[]}} input
 * @returns {ReviewOriginal}
 */
const normalizationOriginalFor = ({
    additionalSkillReferences,
    retainedAdditionalSkillReferences,
    skillReferenceNormalizations,
}) => {
    const additional = new Set(additionalSkillReferences);
    const retained = new Set(retainedAdditionalSkillReferences);
    const lines = skillReferenceNormalizations
        .filter(record => !additional.has(record.identity) || retained.has(record.identity))
        .map(normalLine);
    return {
        bytes: linesToBytes(lines),
        lines,
        path: SKILL_REFERENCE_NORMALIZATIONS_FILE,
    };
};

/** @param {unknown} value @returns {value is ReviewHashes} */
const isReviewHashes = value => value !== null
    && typeof value === 'object'
    && 'additionalSkillReferencesHash' in value
    && typeof value.additionalSkillReferencesHash === 'string'
    && HASH.test(value.additionalSkillReferencesHash)
    && 'skillReferenceNormalizationsHash' in value
    && typeof value.skillReferenceNormalizationsHash === 'string'
    && HASH.test(value.skillReferenceNormalizationsHash);

/**
 * @param {object} input
 * @param {unknown} input.additionalSkillReferences
 * @param {unknown} [input.confirmHashes]
 * @param {typeof createScopedFilesystem} [input.createFilesystem]
 * @param {(hash: string) => void} [input.emitHash]
 * @param {typeof launchConfiguredEditor} [input.launchEditor]
 * @param {unknown} [input.reviewEditor]
 * @param {unknown} input.skillReferenceNormalizations
 * @param {unknown} input.workspaceDirectory
 * @returns {Promise<ReviewUnsuccessful | ReviewSucceeded>}
 */
export const reviewSkillReferences = async ({
    additionalSkillReferences,
    confirmHashes = null,
    createFilesystem = createScopedFilesystem,
    emitHash = () => {},
    launchEditor = launchConfiguredEditor,
    reviewEditor = undefined,
    skillReferenceNormalizations,
    workspaceDirectory,
}) => {
    const candidates = assertCandidates({additionalSkillReferences, skillReferenceNormalizations});
    if (typeof workspaceDirectory !== 'string' || workspaceDirectory.length === 0) {
        throw new TypeError('workspaceDirectory must be a non-empty string.');
    }
    if (typeof createFilesystem !== 'function' || typeof emitHash !== 'function' || typeof launchEditor !== 'function') {
        throw new TypeError('Review adapters are invalid.');
    }
    if (confirmHashes !== null && !isReviewHashes(confirmHashes)) {
        throw new TypeError('confirmHashes must contain the two review result hashes.');
    }

    const candidateOriginals = originalsFor(candidates);
    const additionalOriginal = candidateOriginals[0];
    if (additionalOriginal === undefined) throw new Error('Additional Skill review candidates are incomplete.');
    const created = await createFilesystem({createRoot: confirmHashes === null, root: workspaceDirectory});
    if (created.status !== 'succeeded') return created;
    const filesystem = created.scopedFilesystem;

    if (confirmHashes === null) {
        if (reviewEditor === undefined) throw new TypeError('reviewEditor is required for an initial review.');
        const additionalWritten = await writeReviewFile({file: additionalOriginal, filesystem});
        if (additionalWritten.status !== 'succeeded') return additionalWritten;
        const additionalOpened = await openReviewFile({
            file: additionalOriginal,
            filesystem,
            launchEditor,
            reviewEditor,
        });
        if (additionalOpened.status !== 'succeeded') return additionalOpened;

        const additionalReview = await readReviewFiles({filesystem, originals: [additionalOriginal]});
        if (additionalReview.status !== 'succeeded') return additionalReview;
        const reviewedAdditional = additionalReview.files[0];
        if (reviewedAdditional === undefined) throw new Error('Additional Skill review result is incomplete.');
        const normalizationOriginal = normalizationOriginalFor({
            ...candidates,
            retainedAdditionalSkillReferences: reviewedAdditional.retained,
        });
        const normalizationWritten = await writeReviewFile({file: normalizationOriginal, filesystem});
        if (normalizationWritten.status !== 'succeeded') return normalizationWritten;
        const normalizationOpened = await openReviewFile({
            file: normalizationOriginal,
            filesystem,
            launchEditor,
            reviewEditor,
        });
        if (normalizationOpened.status !== 'succeeded') return normalizationOpened;
    }

    if (confirmHashes !== null) {
        const reviewedBytes = [];
        for (const path of [ADDITIONAL_SKILL_REFERENCES_FILE, SKILL_REFERENCE_NORMALIZATIONS_FILE]) {
            const read = await filesystem.read({path});
            if (read.status !== 'succeeded') {
                return read.status === 'failed' ? {...read, stage: read.stage ?? 'review-read'} : read;
            }
            reviewedBytes.push(read.bytes);
        }
        if (sha256(reviewedBytes[0]) !== confirmHashes.additionalSkillReferencesHash
            || sha256(reviewedBytes[1]) !== confirmHashes.skillReferenceNormalizationsHash) {
            return {
                diagnostics: [{code: 'review-input-changed', message: 'The reviewed files changed after their hashes were reported.'}],
                status: 'blocked',
            };
        }
    }

    const finalAdditionalReview = await readReviewFiles({filesystem, originals: [additionalOriginal]});
    if (finalAdditionalReview.status !== 'succeeded') return finalAdditionalReview;
    const finalAdditional = finalAdditionalReview.files[0];
    if (finalAdditional === undefined) throw new Error('Additional Skill review result is incomplete.');
    const originals = [additionalOriginal, normalizationOriginalFor({
        ...candidates,
        retainedAdditionalSkillReferences: finalAdditional.retained,
    })];
    const reviewed = await readReviewFiles({filesystem, originals});
    if (reviewed.status !== 'succeeded') return reviewed;
    const hashes = {
        additionalSkillReferencesHash: sha256(reviewed.files[0].bytes),
        skillReferenceNormalizationsHash: sha256(reviewed.files[1].bytes),
    };

    if (confirmHashes !== null) {
        if (hashes.additionalSkillReferencesHash !== confirmHashes.additionalSkillReferencesHash
            || hashes.skillReferenceNormalizationsHash !== confirmHashes.skillReferenceNormalizationsHash) {
            return {
                diagnostics: [{code: 'review-input-changed', message: 'The reviewed files changed after their hashes were reported.'}],
                status: 'blocked',
            };
        }
        return completedResult(reviewed.files);
    }

    emitHash(hashes.additionalSkillReferencesHash);
    emitHash(hashes.skillReferenceNormalizationsHash);
    const unchangedNonempty = reviewed.files.some((file, index) => {
        const original = originals[index];
        return original !== undefined && original.lines.length > 0 && file.bytes.equals(original.bytes);
    });
    if (unchangedNonempty) {
        return {
            diagnostics: [{code: 'review-confirmation-required', message: 'Confirm that no candidates should be deleted before completing this review.'}],
            status: 'blocked',
        };
    }
    return completedResult(reviewed.files);
};
