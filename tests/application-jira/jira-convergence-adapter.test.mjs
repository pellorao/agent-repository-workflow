import assert from 'node:assert/strict';
import test from 'node:test';

import {createJiraConvergenceAdapter} from '../../lib/application-jira/jira-convergence-adapter.mjs';

test('JIRA Convergence Adapter encodes keys and pages newest comments toward older comments', async () => {
    /** @type {Array<{baseUrl: string, body?: unknown, method: string, query?: Record<string, string>, relativeEndpoint: string}>} */
    const requests = [];
    const adapter = createJiraConvergenceAdapter({
        baseUrl: 'https://jira.example.test/team/',
        request: async input => {
            requests.push(input);
            if (input.query?.startAt === '0') return {diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded'), value: {comments: [{body: 'different'}], startAt: 0, total: 2}};
            return {diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded'), value: {comments: [{body: 'exact'}], startAt: 1, total: 2}};
        },
    });
    assert.deepEqual(await adapter.findComment({body: 'exact', issueKey: 'PAY/17'}), {diagnostics: [], found: true, status: 'succeeded'});
    assert.deepEqual(requests.map(request => ({method: request.method, query: request.query, relativeEndpoint: request.relativeEndpoint})), [
        {method: 'GET', query: {maxResults: '10', orderBy: '-created', startAt: '0'}, relativeEndpoint: 'rest/api/2/issue/PAY%2F17/comment'},
        {method: 'GET', query: {maxResults: '10', orderBy: '-created', startAt: '1'}, relativeEndpoint: 'rest/api/2/issue/PAY%2F17/comment'},
    ]);
});

test('JIRA Convergence Adapter sends canonical comment and transition request bodies', async () => {
    /** @type {Array<{body?: unknown, method: string, relativeEndpoint: string}>} */
    const requests = [];
    const adapter = createJiraConvergenceAdapter({
        baseUrl: 'https://jira.example.test/',
        request: async input => {
            requests.push(input);
            return {diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded'), value: null};
        },
    });
    assert.deepEqual(await adapter.createComment({body: 'body', issueKey: 'PAY-1'}), {diagnostics: [], status: 'succeeded'});
    assert.deepEqual(await adapter.transition({issueKey: 'PAY-1', transitionId: '31'}), {diagnostics: [], status: 'succeeded'});
    assert.deepEqual(requests, [
        {baseUrl: 'https://jira.example.test/', body: {body: 'body'}, method: 'POST', relativeEndpoint: 'rest/api/2/issue/PAY-1/comment'},
        {baseUrl: 'https://jira.example.test/', body: {transition: {id: '31'}}, method: 'POST', relativeEndpoint: 'rest/api/2/issue/PAY-1/transitions'},
    ]);
});

test('JIRA Convergence Adapter rejects malformed comment pagination without partial success', async () => {
    const pages = [
        {comments: [], startAt: 0, total: -1},
        {comments: [{body: 7}], startAt: 0, total: 1},
        {comments: Array.from({length: 11}, () => ({body: 'different'})), startAt: 0, total: 11},
        {comments: [], startAt: 0, total: 1},
        {comments: [{body: 'different'}, {body: 'extra'}], startAt: 0, total: 1},
        {comments: [{body: 'different'}], startAt: 1, total: 1},
    ];
    for (const value of pages) {
        const adapter = createJiraConvergenceAdapter({
            baseUrl: 'https://jira.example.test/',
            request: async () => ({diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded'), value}),
        });
        const result = await adapter.findComment({body: 'exact', issueKey: 'PAY-1'});
        assert.equal(result.status, 'failed');
        assert.equal(result.diagnostics[0]?.code, 'jira-response-invalid');
    }
});
