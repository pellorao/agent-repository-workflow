import {readApplicationSourceField, readDownstreamChanges, readModuleCorrectionSoftLocks} from '../arw-common/issue-documents.mjs';
import {parseApplicationAssociationCoordinate} from './application-association.mjs';
import {isJsonObject} from '../common/json.mjs';

/** @typedef {{code: string, message: string, path?: string}} Diagnostic */
/** @typedef {{association?: {coordinate: string, kind: string}, id: string, kind: string, status: string}} CorrectionIssueRecord */
/** @typedef {{path: string, record: CorrectionIssueRecord, text: string}} CorrectionIssueSnapshot */

const categoryOrder = new Map([
    ['module-correction-issue-invalid', 0],
    ['module-correction-association-invalid', 1],
    ['module-correction-association-changed', 2],
    ['module-correction-soft-lock-unchanged', 3],
    ['downstream-comments-duplicate', 4],
    ['downstream-changes-duplicate', 4],
    ['downstream-changes-position-invalid', 4],
    ['downstream-changes-content-invalid', 5],
    ['module-correction-downstream-unchanged', 5],
    ['module-correction-downstream-empty', 5],
]);

/** @param {unknown} value @returns {value is CorrectionIssueSnapshot} */
const isSnapshot = value => isJsonObject(value)
    && typeof value.path === 'string'
    && typeof value.text === 'string'
    && isJsonObject(value.record)
    && typeof value.record.id === 'string'
    && typeof value.record.kind === 'string'
    && typeof value.record.status === 'string';

/** @param {CorrectionIssueSnapshot} snapshot */
const validAssociation = snapshot => snapshot.record.association?.kind === 'application-source'
    && typeof snapshot.record.association.coordinate === 'string'
    && parseApplicationAssociationCoordinate(snapshot.record.association.coordinate) !== null;

/** @param {Diagnostic[]} diagnostics */
const sortDiagnostics = diagnostics => diagnostics.sort((left, right) =>
    (categoryOrder.get(left.code) ?? 99) - (categoryOrder.get(right.code) ?? 99)
    || (left.path ?? '').localeCompare(right.path ?? '')
    || left.code.localeCompare(right.code)
    || left.message.localeCompare(right.message));

/**
 * Check the mechanical Module correction boundary between HEAD and the current working-tree snapshots.
 * @param {{headIssue: CorrectionIssueSnapshot, workingIssue: CorrectionIssueSnapshot, spec?: {headText: string, path: string, workingText: string}}} input
 */
export const checkModuleCorrection = input => {
    if (!isJsonObject(input) || !isSnapshot(input.headIssue) || !isSnapshot(input.workingIssue)
        || input.spec !== undefined && (!isJsonObject(input.spec)
            || typeof input.spec.headText !== 'string'
            || typeof input.spec.path !== 'string'
            || typeof input.spec.workingText !== 'string')) {
        throw new TypeError('Module Correction Check input is invalid.');
    }
    const diagnostics = [];
    const issueIdentityValid = input.headIssue.record.kind === 'implementation'
        && input.workingIssue.record.kind === 'implementation'
        && input.headIssue.record.id === input.workingIssue.record.id;
    if (!issueIdentityValid) {
        diagnostics.push({code: 'module-correction-issue-invalid', message: 'HEAD and working tree must contain the same published Module implementation issue.', path: input.workingIssue.path});
    }
    const headAssociationValid = validAssociation(input.headIssue);
    const workingAssociationValid = validAssociation(input.workingIssue);
    if (!headAssociationValid || !workingAssociationValid) {
        diagnostics.push({code: 'module-correction-association-invalid', message: 'HEAD and working-tree Module issues must contain a valid Application source issue association.', path: input.workingIssue.path});
    } else if (input.headIssue.record.association?.coordinate !== input.workingIssue.record.association?.coordinate
        || readApplicationSourceField({text: input.headIssue.text}) !== readApplicationSourceField({text: input.workingIssue.text})) {
        diagnostics.push({code: 'module-correction-association-changed', message: 'Application source issue association must not change.', path: input.workingIssue.path});
    }

    let softLockChanged = input.spec !== undefined && input.spec.headText !== input.spec.workingText;
    try {
        const headLocks = readModuleCorrectionSoftLocks({text: input.headIssue.text});
        const workingLocks = readModuleCorrectionSoftLocks({text: input.workingIssue.text});
        softLockChanged ||= Object.keys(headLocks).some(key => headLocks[key] !== workingLocks[key]);
    } catch {
        if (!diagnostics.some(diagnostic => diagnostic.code === 'module-correction-issue-invalid')) {
            diagnostics.push({code: 'module-correction-issue-invalid', message: 'HEAD and working-tree Module issues must contain every correction soft-lock section exactly once.', path: input.workingIssue.path});
        }
    }
    if (!softLockChanged) {
        diagnostics.push({code: 'module-correction-soft-lock-unchanged', message: 'At least one Module correction soft lock must change.', path: input.workingIssue.path});
    }

    const headDownstream = readDownstreamChanges({path: input.headIssue.path, text: input.headIssue.text});
    const workingDownstream = readDownstreamChanges({path: input.workingIssue.path, text: input.workingIssue.text});
    if (headDownstream.status !== 'succeeded') diagnostics.push(...headDownstream.diagnostics);
    if (workingDownstream.status !== 'succeeded') diagnostics.push(...workingDownstream.diagnostics);
    if (headDownstream.status === 'succeeded' && workingDownstream.status === 'succeeded') {
        if (headDownstream.value.present === workingDownstream.value.present
            && headDownstream.value.content === workingDownstream.value.content) {
            diagnostics.push({code: 'module-correction-downstream-unchanged', message: 'Downstream changes must change relative to HEAD.', path: input.workingIssue.path});
        }
        if (!workingDownstream.value.hasItems) {
            diagnostics.push({code: 'module-correction-downstream-empty', message: 'Current Downstream changes must contain at least one real item.', path: input.workingIssue.path});
        }
    }

    sortDiagnostics(diagnostics);
    return diagnostics.length === 0
        ? {diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded')}
        : {diagnostics, status: /** @type {'blocked'} */ ('blocked')};
};
