import assert from 'node:assert/strict';
import test from 'node:test';

import {notifyVendorWithRetry} from '../../src/catering/catering-service.mjs';

test('the vendor notice is retried until the vendor accepts it', async () => {
    let calls = 0;
    const notifier = {vendor: async () => {
        calls += 1;
        if (calls < 3) throw new Error('vendor busy');
    }};
    await notifyVendorWithRetry({notice: {orderId: 'order-1'}, notifier, orderId: 'order-1', retryDelayMs: 0});
    assert.equal(calls, 3);
});

test('the last failure is kept as the cause', async () => {
    const notifier = {vendor: async () => { throw new Error('vendor down'); }};
    await assert.rejects(
        notifyVendorWithRetry({attempts: 2, notice: {orderId: 'order-2'}, notifier, orderId: 'order-2', retryDelayMs: 0}),
        (error) => error.cause.message === 'vendor down',
    );
});
