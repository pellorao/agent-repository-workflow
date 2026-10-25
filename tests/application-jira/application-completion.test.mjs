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
