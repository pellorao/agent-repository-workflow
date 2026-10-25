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
