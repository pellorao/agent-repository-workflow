import assert from 'node:assert/strict';
import test from 'node:test';
import {declineReviewerInteractions} from '../../lib/reviewer-runtime/reviewer-native-policy.mjs';

test('Reviewer declines each native interaction without interrupting its active turn', async () => {
    const cases = [
        ['item/commandExecution/requestApproval', {decision: 'decline'}, true],
        ['item/fileChange/requestApproval', {decision: 'decline'}, true],
        ['execCommandApproval', 'legacy', false],
        ['applyPatchApproval', 'legacy', false],
        ['item/permissions/requestApproval', {permissions: {}, scope: 'turn'}, true],
        ['mcpServer/elicitation/request', {action: 'decline', content: null}, true],
        ['item/tool/requestUserInput', 'error', true],
    ];
    for (const [method, expected, needsSteer] of cases) {
        /** @type {{operation:string, input:Record<string,unknown>}[]} */
        const calls = [];
        const session = /** @type {import('../../lib/background-agent/codex-app-server.mjs').NativeSession} */ (/** @type {unknown} */ ({
            async respond(/** @type {Record<string,unknown>} */ input) {calls.push({operation:'respond',input});return {accepted:true};},
            async rejectRequest(/** @type {Record<string,unknown>} */ input) {calls.push({operation:'rejectRequest',input});return {accepted:true};},
            async steer(/** @type {Record<string,unknown>} */ input) {calls.push({operation:'steer',input});return {turnId:'active-turn'};},
        }));
        await declineReviewerInteractions(session, [{requestId:'native-request',kind:'approval',method:/** @type {string} */ (method),params:{},threadId:'reviewer-root',turnId:needsSteer?'active-turn':null}]);
        assert.equal(calls[0].input.requestId,'native-request');
        if (expected === 'legacy') {
            assert.equal(calls[0].operation,'respond');
            const decision = /** @type {Record<string,unknown>} */ (/** @type {Record<string,unknown>} */ (calls[0].input.response).decision);
            assert.match(String(/** @type {Record<string,unknown>} */ (decision.denied).rejection), /cannot obtain external input/);
        } else if (expected === 'error') {
            assert.equal(calls[0].operation,'rejectRequest');
            assert.match(String(calls[0].input.reason),/cannot obtain external input/);
        } else {
            assert.equal(calls[0].operation,'respond');
            assert.deepEqual(calls[0].input.response,expected);
        }
        assert.equal(calls.length,needsSteer?2:1);
        if (needsSteer) {
            assert.equal(calls[1].operation,'steer');
            assert.deepEqual([calls[1].input.threadId,calls[1].input.turnId],['reviewer-root','active-turn']);
            assert.match(String(calls[1].input.instruction),/cannot obtain external input/);
        }
    }
});

test('Reviewer does not answer an interaction without a verifiable active turn', async () => {
    let answered = false;
    const session = /** @type {import('../../lib/background-agent/codex-app-server.mjs').NativeSession} */ (/** @type {unknown} */ ({
        async snapshot() {return {factsComplete:false,members:[]};},
        async respond() {answered=true;return {accepted:true};},
        async rejectRequest() {answered=true;return {accepted:true};},
    }));
    await assert.rejects(declineReviewerInteractions(session,[{requestId:'request',kind:'user-input',method:'item/tool/requestUserInput',params:{},threadId:'reviewer-root',turnId:null}]),/not bound to an active Reviewer turn/);
    assert.equal(answered,false);
});

test('an MCP request without turnId uses only the observed active root turn for its reason', async () => {
    /** @type {{operation:string,input:Record<string,unknown>}[]} */
    const calls=[];
    const session = /** @type {import('../../lib/background-agent/codex-app-server.mjs').NativeSession} */ (/** @type {unknown} */ ({
        async snapshot() {return {factsComplete:true,members:[{threadId:'reviewer-root',state:'active',turnId:'observed-turn'}]};},
        async respond(/** @type {Record<string,unknown>} */ input) {calls.push({operation:'respond',input});return {accepted:true};},
        async steer(/** @type {Record<string,unknown>} */ input) {calls.push({operation:'steer',input});return {turnId:'observed-turn'};},
    }));
    await declineReviewerInteractions(session,[{requestId:'mcp-request',kind:'unsupported',method:'mcpServer/elicitation/request',params:{},threadId:'reviewer-root',turnId:null}]);
    assert.deepEqual(calls.map(call=>call.operation),['respond','steer']);
    assert.equal(calls[1].input.turnId,'observed-turn');
});
