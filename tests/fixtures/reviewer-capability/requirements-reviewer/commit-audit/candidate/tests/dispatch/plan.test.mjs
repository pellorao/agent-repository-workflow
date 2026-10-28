import test from 'node:test';
import assert from 'node:assert/strict';
import {configuredCapacityIsAccepted, savePlan} from './scenarios.mjs';

test('configured dispatch capacity is accepted', () => {
    assert.equal(configuredCapacityIsAccepted(), true);
});

test('invalid storage input performs no writes', async () => {
    let writes = 0;
    const result = await savePlan({plan: null, store: {write: async () => { writes += 1; }}, validate: () => ({ok: false, error: 'invalid'})});
    assert.deepEqual(result, {ok: false, error: 'invalid'});
    assert.equal(writes, 0);
});
