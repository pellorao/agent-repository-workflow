import assert from 'node:assert/strict';
import test from 'node:test';

import {evaluateApplicationCompletion} from '../../lib/application-jira/application-completion.mjs';

const spec = '# Payment retry\n\nJIRA issue: [`PAY-123`](https://jira.example.test/browse/PAY-123)\n\nApplication validation issue: 05\n';

test('Application Completion returns an ineligible decision for incomplete validation', () => {
    const result = evaluateApplicationCompletion({
        issues: [
            {blockers: [], id: 'issue:0001:02', kind: 'application-source', number: '02', status: 'completed'},
            {blockers: [{number: '02'}], id: 'issue:0001:05', kind: 'implementation', number: '05', status: 'ready-for-agent'},
        ],
        jiraBaseUrl: 'https://jira.example.test/',
        phase: 'completed',
        applicationName: 'payments',
        specId: 'spec:0001',
        specText: spec,
    });
    assert.equal(result.status, 'succeeded');
    assert.equal(result.eligible, false);
});

test('Application Completion treats a resolved Wayfinder issue as terminal and an open one as not', () => {
    const evaluate = (/** @type {string} */ wayfinderStatus) => evaluateApplicationCompletion({
        issues: [
            {blockers: [], id: 'issue:0001:02', kind: 'wayfinder', number: '02', status: wayfinderStatus},
            {blockers: [{number: '02'}], id: 'issue:0001:05', kind: 'implementation', number: '05', status: 'completed'},
        ],
        jiraBaseUrl: 'https://jira.example.test/',
        phase: 'completed',
        applicationName: 'payments',
        specId: 'spec:0001',
        specText: spec,
    });
    assert.equal(evaluate('resolved').eligible, true);
    assert.equal(evaluate('open').eligible, false);
});
