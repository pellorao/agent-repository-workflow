import assert from 'node:assert/strict';
import {request} from 'node:http';
import test from 'node:test';

import {createRateLimiter} from '../src/rate-limiter.mjs';
import {createAppServer} from '../src/server.mjs';

const clock = () => {
    let time = 0;
    return {now: () => time, advance: ms => { time += ms; }};
};

test('allows limit requests per window and frees a slot at the boundary', () => {
    const time = clock();
    const limiter = createRateLimiter({limit: 2, windowMs: 1000, now: time.now});
    assert.deepEqual(limiter.check('a'), {allowed: true, retryAfterMs: 0});
    assert.deepEqual(limiter.check('a'), {allowed: true, retryAfterMs: 0});
    assert.equal(limiter.check('a').allowed, false);
    time.advance(1000);
    assert.equal(limiter.check('a').allowed, true);
});

test('rejects invalid options', () => {
    assert.throws(() => createRateLimiter({limit: 0, windowMs: 1000}), RangeError);
    assert.throws(() => createRateLimiter({limit: 1, windowMs: -1}), RangeError);
});

test('server answers a rejected request with 429 and Retry-After', async t => {
    const server = createAppServer({handle: () => 'ok', limiter: {check: () => ({allowed: false, retryAfterMs: 1500})}});
    await new Promise(resolve => server.listen(0, resolve));
    t.after(() => server.close());
    const response = await new Promise(resolve => request({port: server.address().port}, resolve).end());
    assert.equal(response.statusCode, 429);
    assert.ok(response.headers['retry-after']);
});
