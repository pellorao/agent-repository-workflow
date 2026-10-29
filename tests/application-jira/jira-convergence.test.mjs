import assert from 'node:assert/strict';
import test from 'node:test';

import {convergeJiraIssue} from '../../lib/application-jira/jira-convergence.mjs';

test('JIRA convergence writes an absent comment before the first exact transition and verifies both', async () => {
    /** @type {string[]} */
    const events = [];
    let final = false;
    /** @type {Parameters<typeof convergeJiraIssue>[0]['jira']} */
    const jira = {
        createComment: async () => {
            events.push('comment-create');
            return {diagnostics: [], status: 'succeeded'};
        },
        findComment: async () => ({diagnostics: [], found: final, status: 'succeeded'}),
        readIssue: async () => ({diagnostics: [], issue: {issueType: 'Story', projectKey: 'PAY', status: final ? 'Done' : 'In Progress'}, status: 'succeeded'}),
        readTransitions: async () => ({diagnostics: [], status: 'succeeded', transitions: [{id: '9', status: 'Done'}, {id: '10', status: 'Done'}]}),
        transition: async input => {
            events.push(`transition:${input.transitionId}`);
            final = true;
            return {diagnostics: [], status: 'succeeded'};
        },
    };

    assert.deepEqual(await convergeJiraIssue({
        comment: 'exact body',
        issueKey: 'PAY-1',
        issueType: 'Story',
        jira,
        phase: 'completed',
        projectKey: 'PAY',
        sourceStatus: 'In Progress',
        targetStatus: 'Done',
    }), {
        commentAction: 'created',
        diagnostics: [],
        status: 'succeeded',
        statusAction: 'transitioned',
    });
    assert.deepEqual(events, ['comment-create', 'transition:9']);
});

test('JIRA convergence reports its own stage and effects for lower-layer failures', async () => {
    const cases = /** @type {Array<[string, string, number, string, string]>} */ ([
        ['issue-read', 'readIssue', 1, 'none', 'none'],
        ['comment-read', 'findComment', 1, 'none', 'none'],
        ['transition-read', 'readTransitions', 1, 'none', 'none'],
        ['comment-create', 'createComment', 1, 'unknown', 'none'],
        ['transition', 'transition', 1, 'created', 'unknown'],
        ['final-verification', 'readIssue', 2, 'created', 'transitioned'],
    ]);
    for (const [stage, method, failingCall, commentAction, statusAction] of cases) {
        /** @type {Record<string, number>} */
        const calls = {};
        const call = (/** @type {string} */ name, /** @type {object} */ success) => async () => {
            calls[name] = (calls[name] ?? 0) + 1;
            return name === method && calls[name] === failingCall ? {diagnostics: [], stage: 'lower', status: 'failed'} : {diagnostics: [], status: 'succeeded', ...success};
        };
        const jira = /** @type {Parameters<typeof convergeJiraIssue>[0]['jira']} */ (/** @type {unknown} */ ({
            createComment: call('createComment', {}),
            findComment: call('findComment', {found: false}),
            readIssue: call('readIssue', {issue: {issueType: 'Story', projectKey: 'PAY', status: 'In Progress'}}),
            readTransitions: call('readTransitions', {transitions: [{id: '9', status: 'Done'}]}),
            transition: call('transition', {}),
        }));
        const result = await convergeJiraIssue({comment: 'c', issueKey: 'PAY-1', issueType: 'Story', jira, phase: 'completed', projectKey: 'PAY', sourceStatus: 'In Progress', targetStatus: 'Done'});
        assert.deepEqual([result.status, 'stage' in result && result.stage, result.commentAction, result.statusAction], ['failed', stage, commentAction, statusAction], stage);
    }
});
