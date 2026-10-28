import test from 'node:test';
import assert from 'node:assert/strict';
import {publishManifest, publicationResult} from '../../src/dispatch/index.mjs';

test('public dispatch entry publishes a valid manifest', async () => {
    const writes = [];
    const result = await publishManifest({manifest: {entries: [{packageId: 'P1'}]}, store: {put: (/** @type {any} */ value) => writes.push(value)}});
    assert.equal(result.ok, true);
    assert.equal(writes.length, 1);
});

test('publication failures use a structured result', () => {
    assert.deepEqual(publicationResult(false, 'offline'), {ok: false, error: 'offline'});
});
