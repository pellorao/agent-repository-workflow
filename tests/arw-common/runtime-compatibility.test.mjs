import assert from 'node:assert/strict';
import test from 'node:test';

import {evaluateNodeRuntime} from '../../lib/arw-common/runtime-compatibility.mjs';

test('runtime compatibility enforces the Node.js 24 minimum', () => {
    assert.throws(
        () => Reflect.apply(evaluateNodeRuntime, undefined, [22]),
        error => error instanceof TypeError,
    );

    const unparseable = evaluateNodeRuntime('unknown');
    assert.deepEqual(Object.keys(unparseable), ['error', 'status']);
    assert.deepEqual(unparseable, {
        error: 'ARW cannot determine the active Node.js major version: unknown.',
        status: 'unsupported',
    });

    const belowFloor = evaluateNodeRuntime('23.11.1');
    assert.deepEqual(Object.keys(belowFloor), ['error', 'status']);
    assert.equal(belowFloor.status, 'unsupported');
    if (belowFloor.status !== 'unsupported') assert.fail('Expected an unsupported runtime result.');
    assert.match(belowFloor.error, /23\.11\.1/);
    assert.match(belowFloor.error, /Node\.js 24/);

    for (const version of ['22.0.0', '23.not-semver']) {
        assert.deepEqual(evaluateNodeRuntime(version), {
            error: `ARW requires Node.js 24 or newer. Current runtime: ${version}.`,
            status: 'unsupported',
        });
    }

    assert.deepEqual(evaluateNodeRuntime('24.0.0'), {
        recommendation: null,
        status: 'supported',
    });
    assert.deepEqual(evaluateNodeRuntime('100000000000000000000000000000.0.0'), {
        recommendation: null,
        status: 'supported',
    });
    assert.equal(evaluateNodeRuntime('022.0.0').status, 'unsupported');
});
