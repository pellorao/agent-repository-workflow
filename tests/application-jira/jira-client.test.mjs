import assert from 'node:assert/strict';
import test from 'node:test';

import {createJiraClient} from '../../lib/application-jira/jira-client.mjs';


test('JIRA Print rejects invalid comment bodies and pagination metadata without partial output', async () => {
    const cases = [
        {
            initial: {comments: [{body: null, id: '1'}], startAt: 0, total: 1},
            label: 'non-string body',
        },
        {
            fields: {comment: []},
            label: 'non-object comment collection',
        },
        {
            fields: {attachment: {}},
            label: 'non-array attachment collection',
        },
        {
            fields: {issuelinks: 'invalid'},
            label: 'non-array link collection',
        },
        {
            initial: {comments: [{body: 'body', created: null, id: '1'}], startAt: 0, total: 1},
            label: 'non-string created date',
        },
        {
            initial: {comments: [{body: 'body', id: '1'}], startAt: 1, total: 2},
            label: 'nonzero initial cursor',
        },
        {
            initial: {comments: [{body: 'body', id: '1'}], startAt: 0, total: 0},
            label: 'initial page beyond total',
        },
        {
            initial: {comments: [{body: 'first', id: '1'}], startAt: 0, total: 2},
            label: 'non-progressing next cursor',
            next: {comments: [{body: 'second', id: '2'}], startAt: 0, total: 2},
        },
        {
            initial: {comments: [{body: 'first', id: '1'}], startAt: 0, total: 2},
            label: 'empty incomplete page',
            next: {comments: [], startAt: 1, total: 2},
        },
    ];

    for (const entry of cases) {
        const client = createJiraClient({
            request: async input => ({
                diagnostics: [],
                status: /** @type {'succeeded'} */ ('succeeded'),
                value: input.relativeEndpoint.endsWith('/comment')
                    ? entry.next
                    : {fields: entry.fields ?? {comment: entry.initial}, key: 'PAY-1', names: {}, schema: {}},
            }),
        });
        const result = await client.printIssue({baseUrl: 'https://jira.example.test/', issueKey: 'PAY-1'});
        assert.equal(result.status, 'failed', entry.label);
        assert.equal(result.diagnostics[0]?.code, 'jira-response-invalid', entry.label);
    }
});
