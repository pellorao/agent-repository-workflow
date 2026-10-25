import {formatCanonicalArtifactId, parseCanonicalArtifactId} from '../arw-common/artifact-identity.mjs';
import {isIssueBlocked, readDownstreamChanges, replaceDownstreamChanges} from '../arw-common/issue-documents.mjs';
import {parseApplicationAssociationCoordinate} from './application-association.mjs';

/** @typedef {{code: string, message: string, path?: string}} Diagnostic */
/** @typedef {{association?: {coordinate: string, kind: string}, blockerRecords?: Array<{status: string}>, id: string, kind: string, status: string}} SyncIssueRecord */
/** @typedef {{path: string, record: SyncIssueRecord, text: string}} SyncIssueSnapshot */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** @param {string} text @param {string} currentStatus @param {string} targetStatus */
const replaceStatus = (text, currentStatus, targetStatus) => {
    const matches = [...text.matchAll(/^Status: ([^\r\n]*)(?=\r?$)/gmu)];
    if (matches.length !== 1 || matches[0][1] !== currentStatus) return null;
    return text.replace(/^Status: [^\r\n]*(?=\r?$)/mu, `Status: ${targetStatus}`);
};

/**
 * @param {{moduleIssues: Record<string, SyncIssueSnapshot[]>, applicationIssues: SyncIssueSnapshot[], applicationName: string}} input
 */
export const synchronizeApplicationIssues = input => {
    if (!isRecord(input)
        || typeof input.applicationName !== 'string'
        || !Array.isArray(input.applicationIssues)
        || !isRecord(input.moduleIssues)) {
        throw new TypeError('Application Sync input is invalid.');
    }
    /** @type {Diagnostic[]} */
    const diagnostics = [];
    /** @type {Array<{bytes: Buffer, path: string}>} */
    const replacements = [];
    const targets = new Set();
    for (const applicationIssue of input.applicationIssues) {
        if (!isRecord(applicationIssue)
            || typeof applicationIssue.path !== 'string'
            || typeof applicationIssue.text !== 'string'
            || !isRecord(applicationIssue.record)
            || applicationIssue.record.kind !== 'application-source'
            || typeof applicationIssue.record.id !== 'string'
            || typeof applicationIssue.record.status !== 'string'
            || !isRecord(applicationIssue.record.association)
            || applicationIssue.record.association.kind !== 'module-implementation'
            || typeof applicationIssue.record.association.coordinate !== 'string') {
            diagnostics.push({code: 'application-source-invalid', message: 'Application Sync input contains an invalid Application Source Issue.', path: isRecord(applicationIssue) && typeof applicationIssue.path === 'string' ? applicationIssue.path : undefined});
            continue;
        }
        const target = parseApplicationAssociationCoordinate(applicationIssue.record.association.coordinate);
        if (target === null || !Array.isArray(input.moduleIssues[target.repository])) {
            diagnostics.push({code: 'application-association-mismatch', message: `Application Source Issue ${applicationIssue.record.id} references an unavailable configured Module issue.`, path: applicationIssue.path});
            continue;
        }
        const targetIdentity = `${target.repository}:${target.issueId}`;
        if (targets.has(targetIdentity)) {
            diagnostics.push({code: 'application-association-duplicate', message: `More than one Application Source Issue references ${targetIdentity}.`, path: applicationIssue.path});
            continue;
        }
        targets.add(targetIdentity);
        const candidates = input.moduleIssues[target.repository].filter(snapshot => snapshot.record.id === target.issueId);
        if (candidates.length !== 1) {
            diagnostics.push({code: 'application-association-mismatch', message: `Application Source Issue ${applicationIssue.record.id} does not resolve to exactly one Module issue.`, path: applicationIssue.path});
            continue;
        }
        const moduleIssue = candidates[0];
        let expectedReverse;
        try {
            const applicationIdentity = parseCanonicalArtifactId(applicationIssue.record.id);
            if (applicationIdentity.kind !== 'issue' || applicationIdentity.qualifier !== null || applicationIdentity.issueNumber === null) throw new Error();
            expectedReverse = formatCanonicalArtifactId({...applicationIdentity, qualifier: input.applicationName});
        } catch {
            diagnostics.push({code: 'application-source-invalid', message: 'Application Sync input contains an invalid Application Source Issue.', path: applicationIssue.path});
            continue;
        }
        if (moduleIssue.record.kind !== 'implementation'
            || moduleIssue.record.association?.kind !== 'application-source'
            || moduleIssue.record.association.coordinate !== expectedReverse) {
            diagnostics.push({code: 'application-association-mismatch', message: `Module issue ${targetIdentity} does not point back to ${expectedReverse}.`, path: applicationIssue.path});
            continue;
        }
        if (isIssueBlocked(moduleIssue.record)) {
            diagnostics.push({code: 'application-module-blocked', message: `Module issue ${targetIdentity} has a nonterminal blocker.`, path: moduleIssue.path});
            continue;
        }
        const moduleDownstream = readDownstreamChanges({path: moduleIssue.path, text: moduleIssue.text});
        const applicationDownstream = readDownstreamChanges({path: applicationIssue.path, text: applicationIssue.text});
        if (moduleDownstream.status !== 'succeeded' || applicationDownstream.status !== 'succeeded') {
            if (moduleDownstream.status !== 'succeeded') diagnostics.push(...moduleDownstream.diagnostics);
            if (applicationDownstream.status !== 'succeeded') diagnostics.push(...applicationDownstream.diagnostics);
            continue;
        }
        const statusText = moduleIssue.record.status === applicationIssue.record.status
            ? applicationIssue.text
            : replaceStatus(applicationIssue.text, applicationIssue.record.status, moduleIssue.record.status);
        if (statusText === null) {
            diagnostics.push({code: 'application-status-replacement-invalid', message: `Application Source Issue ${applicationIssue.record.id} has an invalid Status line.`, path: applicationIssue.path});
            continue;
        }
        const downstreamText = replaceDownstreamChanges({
            content: moduleDownstream.value.hasItems ? moduleDownstream.value.content : '- None.',
            path: applicationIssue.path,
            text: statusText,
        });
        if (downstreamText.status !== 'succeeded') {
            diagnostics.push(...downstreamText.diagnostics);
            continue;
        }
        if (downstreamText.text !== applicationIssue.text) {
            replacements.push({bytes: Buffer.from(downstreamText.text, 'utf8'), path: applicationIssue.path});
        }
    }
    diagnostics.sort((left, right) => (left.path ?? '').localeCompare(right.path ?? '')
        || left.code.localeCompare(right.code)
        || left.message.localeCompare(right.message));
    if (diagnostics.length > 0) return {diagnostics, status: /** @type {'blocked'} */ ('blocked')};
    replacements.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    return {diagnostics: [], replacements, status: /** @type {'succeeded'} */ ('succeeded')};
};
