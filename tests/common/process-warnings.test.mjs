import assert from 'node:assert/strict';
import test from 'node:test';

import {withDroppedWarnings} from '../../lib/common/process-warnings.mjs';

/** 把 process.emitWarning 换成记录器, 返回已转发的警告; 测试结束还原. */
const recordWarnings = (/** @type {import('node:test').TestContext} */ t) => {
    /** @type {unknown[][]} */
    const forwarded = [];
    const original = process.emitWarning;
    process.emitWarning = /** @type {typeof process.emitWarning} */ ((...args) => { forwarded.push(args); });
    t.after(() => { process.emitWarning = original; });
    return {forwarded, recorder: process.emitWarning};
};

test('withDroppedWarnings drops matching warnings in both argument forms, forwards others and returns the result', async t => {
    const {forwarded, recorder} = recordWarnings(t);
    const result = await withDroppedWarnings((warning, type) => type === 'ExperimentalWarning' && warning.includes('SQLite'), async () => {
        process.emitWarning('SQLite is an experimental feature', 'ExperimentalWarning');
        process.emitWarning('SQLite is an experimental feature', {type: 'ExperimentalWarning'});
        process.emitWarning('Other experimental feature', 'ExperimentalWarning');
        process.emitWarning('SQLite deprecated thing', 'DeprecationWarning');
        return 'done';
    });
    assert.equal(result, 'done');
    assert.deepEqual(forwarded, [['Other experimental feature', 'ExperimentalWarning'], ['SQLite deprecated thing', 'DeprecationWarning']]);
    assert.equal(process.emitWarning, recorder);
});

test('withDroppedWarnings restores process.emitWarning when run fails', async t => {
    const {recorder} = recordWarnings(t);
    await assert.rejects(withDroppedWarnings(() => true, async () => { throw new Error('run failed'); }), /run failed/u);
    assert.equal(process.emitWarning, recorder);
});
