import {isJsonObject} from '../common/json.mjs';
/** @typedef {{code: string, message: string}} Diagnostic */
/** @typedef {{diagnostics: Diagnostic[], status: 'blocked'} | {diagnostics: Diagnostic[], stage?: string, status: 'failed'}} Unsuccessful */
/** @typedef {{createComment: (input: {body: string, issueKey: string}) => Promise<Unsuccessful | {diagnostics: Diagnostic[], status: 'succeeded'}>, findComment: (input: {body: string, issueKey: string}) => Promise<Unsuccessful | {diagnostics: Diagnostic[], found: boolean, status: 'succeeded'}>, readIssue: (input: {issueKey: string}) => Promise<Unsuccessful | {diagnostics: Diagnostic[], issue: {issueType: string, projectKey: string, status: string}, status: 'succeeded'}>, readTransitions: (input: {issueKey: string}) => Promise<Unsuccessful | {diagnostics: Diagnostic[], status: 'succeeded', transitions: Array<{id: string, status: string}>}>, transition: (input: {issueKey: string, transitionId: string}) => Promise<Unsuccessful | {diagnostics: Diagnostic[], status: 'succeeded'}>}} JiraConvergenceAdapter */

/**
 * @param {{comment: string, issueKey: string, issueType: string, jira: JiraConvergenceAdapter, phase: 'accepted' | 'completed', projectKey: string, sourceStatus: string, targetStatus: string}} input
 */
export const convergeJiraIssue = async input => {
    if (!isJsonObject(input)
        || typeof input.comment !== 'string'
        || typeof input.issueKey !== 'string'
        || typeof input.issueType !== 'string'
        || !isJsonObject(input.jira)
        || !['accepted', 'completed'].includes(/** @type {string} */ (input.phase))
        || typeof input.projectKey !== 'string'
        || typeof input.sourceStatus !== 'string'
        || typeof input.targetStatus !== 'string') {
        throw new TypeError('JIRA Convergence input is invalid.');
    }
    const current = await input.jira.readIssue({issueKey: input.issueKey});
    if (current.status !== 'succeeded') return {...current, commentAction: 'none', stage: ('stage' in current ? current.stage : undefined) ?? 'issue-read', statusAction: 'none'};
    if (current.issue.projectKey !== input.projectKey
        || current.issue.issueType !== input.issueType
        || ![input.sourceStatus, input.targetStatus].includes(current.issue.status)) {
        return {
            commentAction: 'none',
            diagnostics: [{code: 'jira-convergence-policy-mismatch', message: 'JIRA issue project, type, or source status does not match Application policy.'}],
            status: 'blocked',
            statusAction: 'none',
        };
    }
    const existingComment = await input.jira.findComment({body: input.comment, issueKey: input.issueKey});
    if (existingComment.status !== 'succeeded') return {...existingComment, commentAction: 'none', stage: ('stage' in existingComment ? existingComment.stage : undefined) ?? 'comment-read', statusAction: 'none'};
    let transitionId = null;
    if (current.issue.status !== input.targetStatus && current.issue.status === input.sourceStatus) {
        const transitions = await input.jira.readTransitions({issueKey: input.issueKey});
        if (transitions.status !== 'succeeded') return {...transitions, commentAction: 'none', stage: ('stage' in transitions ? transitions.stage : undefined) ?? 'transition-read', statusAction: 'none'};
        transitionId = transitions.transitions.find(transition => transition.status === input.targetStatus)?.id ?? null;
        if (transitionId === null) {
            return {
                commentAction: 'none',
                diagnostics: [{code: 'jira-transition-missing', message: `JIRA has no transition to configured target status ${input.targetStatus}.`}],
                status: 'blocked',
                statusAction: 'none',
            };
        }
    }
    let commentAction = /** @type {'created' | 'existing'} */ (existingComment.found ? 'existing' : 'created');
    let statusAction = /** @type {'existing' | 'transitioned'} */ (current.issue.status === input.targetStatus ? 'existing' : 'transitioned');
    if (!existingComment.found) {
        const created = await input.jira.createComment({body: input.comment, issueKey: input.issueKey});
        if (created.status !== 'succeeded') return {...created, commentAction: 'unknown', stage: ('stage' in created ? created.stage : undefined) ?? 'comment-create', statusAction: 'none'};
    }
    if (transitionId !== null) {
        const transitioned = await input.jira.transition({issueKey: input.issueKey, transitionId});
        if (transitioned.status !== 'succeeded') return {...transitioned, commentAction, stage: ('stage' in transitioned ? transitioned.stage : undefined) ?? 'transition', statusAction: 'unknown'};
    }
    const finalIssue = await input.jira.readIssue({issueKey: input.issueKey});
    if (finalIssue.status !== 'succeeded') return {...finalIssue, commentAction, stage: 'final-verification', statusAction};
    const finalComment = await input.jira.findComment({body: input.comment, issueKey: input.issueKey});
    if (finalComment.status !== 'succeeded') return {...finalComment, commentAction, stage: 'final-verification', statusAction};
    if (finalIssue.issue.status !== input.targetStatus || !finalComment.found) {
        return {
            commentAction,
            diagnostics: [{code: 'jira-final-verification-failed', message: 'JIRA comment and status did not converge to the requested final state.'}],
            stage: 'final-verification',
            status: 'failed',
            statusAction,
        };
    }
    return {commentAction, diagnostics: [], status: 'succeeded', statusAction};
};
