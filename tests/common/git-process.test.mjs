import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import test from 'node:test';

import {createNodeGitRunner} from '../../lib/common/git-process.mjs';

test('Git runner returns the exit result when git exits before reading stdin', async () => {
    const child = Object.assign(new EventEmitter(), {stderr: new PassThrough(), stdout: new PassThrough()});
    const stdin = new EventEmitter();
    // @ts-expect-error minimal stdin double: end() fails the way a closed pipe does
    stdin.end = () => setImmediate(() => {
        stdin.emit('error', new Error('write EPIPE'));
        child.stdout.end();
        child.stderr.end('bad option');
        child.emit('close', 129);
    });
    // @ts-expect-error minimal child double
    const result = await createNodeGitRunner('/repo', () => Object.assign(child, {stdin})).run({argv: ['--bad'], input: 'data'});
    assert.deepEqual({code: result.code, failure: result.failure, stderr: result.stderr}, {code: 129, failure: null, stderr: 'bad option'});
});
