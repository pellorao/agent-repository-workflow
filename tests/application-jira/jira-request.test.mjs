import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import test from 'node:test';

import {createJiraHttpRequest} from '../../lib/application-jira/jira-request.mjs';

const listen = async (/** @type {import('node:test').TestContext} */ t, /** @type {import('node:http').RequestListener} */ handler) => {
    const server = createServer(handler);
    await new Promise((/** @type {(value?: void) => void} */ resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });
    t.after(() => new Promise((/** @type {(value?: void) => void} */ resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Test server has no TCP address.');
    return `http://127.0.0.1:${address.port}/team/`;
};

test('JIRA HTTP request sends one Bearer request and parses JSON', async t => {
    /** @type {Array<{authorization: string | undefined, method: string | undefined, url: string | undefined}>} */
    const observations = [];
    const baseUrl = await listen(t, (request, response) => {
        observations.push({authorization: request.headers.authorization, method: request.method, url: request.url});
        response.writeHead(200, {'content-type': 'application/json'});
        response.end('{"issues":[],"total":0}');
    });

    const request = createJiraHttpRequest({token: 'secret-token'});
    assert.deepEqual(await request({
        baseUrl,
        method: 'GET',
        query: {jql: 'project = "PAY"', maxResults: '3'},
        relativeEndpoint: 'rest/api/2/search',
    }), {
        diagnostics: [],
        metadata: {status: 200},
        status: 'succeeded',
        value: {issues: [], total: 0},
    });
    assert.deepEqual(observations, [{
        authorization: 'Bearer secret-token',
        method: 'GET',
        url: '/team/rest/api/2/search?jql=project+%3D+%22PAY%22&maxResults=3',
    }]);
});

test('JIRA HTTP request rejects redirect without following it or exposing sensitive response data', async t => {
    let requests = 0;
    const baseUrl = await listen(t, (_request, response) => {
        requests += 1;
        response.writeHead(302, {location: '/credential-target', 'content-type': 'text/html'});
        response.end('<html>secret-token raw server page</html>');
    });

    const request = createJiraHttpRequest({token: 'secret-token'});
    const result = await request({baseUrl, method: 'GET', relativeEndpoint: 'rest/api/2/issue/PAY-1'});
    assert.equal(result.status, 'failed');
    assert.equal(result.stage, 'request');
    assert.equal(requests, 1);
    assert.match(result.diagnostics[0].message, /GET.*rest\/api\/2\/issue\/PAY-1.*302/u);
    assert.doesNotMatch(JSON.stringify(result), /secret-token|raw server page|authorization/iu);
});
