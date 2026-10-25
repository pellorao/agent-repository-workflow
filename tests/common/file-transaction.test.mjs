import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {applyFileTransaction, preflightFileTransaction} from '../../lib/common/file-transaction.mjs';
import {createScopedFilesystem} from '../../lib/common/filesystem.mjs';

const sha256 = (/** @type {Buffer<ArrayBuffer> | import("crypto").BinaryLike} */ bytes) => createHash('sha256').update(bytes).digest('hex');

test('File Transaction applies ordered operations and detects state drift before writing', async t => {
    const root = await createTemporaryDirectory(t, 'arw-transaction-');
    await writeFile(join(root, 'replace.txt'), 'before\n');
    const created = await createScopedFilesystem({root});
    if (created.status !== 'succeeded') assert.fail('Filesystem creation must succeed.');
    const {scopedFilesystem} = created;
    const preflight = await preflightFileTransaction({
        filesystem: scopedFilesystem,
        operations: [
            {bytes: Buffer.from('created\n'), expected: {kind: 'missing'}, kind: 'create', path: 'nested/create.txt'},
            {bytes: Buffer.from('after\n'), expected: {hash: sha256(Buffer.from('before\n')), kind: 'file'}, kind: 'replace', path: 'replace.txt'},
        ],
    });
    assert.equal(preflight.status, 'succeeded');
    if (preflight.status !== 'succeeded') assert.fail('Transaction preflight must succeed.');
    assert.deepEqual(Object.keys(preflight).sort(), ['diagnostics', 'preparedTransaction', 'status']);
    assert.deepEqual(Object.keys(preflight.preparedTransaction), []);
    const applied = await applyFileTransaction(preflight.preparedTransaction);
    assert.deepEqual(applied, {diagnostics: [], status: 'succeeded'});
    assert.equal((await readFile(join(root, 'nested', 'create.txt'))).toString('utf8'), 'created\n');
    assert.equal((await readFile(join(root, 'replace.txt'))).toString('utf8'), 'after\n');

    const drift = await preflightFileTransaction({
        filesystem: scopedFilesystem,
        operations: [{bytes: Buffer.from('next\n'), expected: {hash: sha256(Buffer.from('after\n')), kind: 'file'}, kind: 'replace', path: 'replace.txt'}],
    });
    await writeFile(join(root, 'replace.txt'), 'drift\n');
    if (drift.status !== 'succeeded') assert.fail('Transaction preflight must succeed before drift.');
    const blocked = await applyFileTransaction(drift.preparedTransaction);
    assert.equal(blocked.status, 'blocked');
    assert.deepEqual(blocked.diagnostics.map((/** @type {{code: string}} */ entry) => entry.code), ['transaction-state-changed']);
    assert.equal((await readFile(join(root, 'replace.txt'))).toString('utf8'), 'drift\n');

    const duplicate = await preflightFileTransaction({
        filesystem: scopedFilesystem,
        operations: [
            {bytes: Buffer.from('one'), expected: {kind: 'missing'}, kind: 'create', path: 'nested/../same.txt'},
            {bytes: Buffer.from('two'), expected: {kind: 'missing'}, kind: 'create', path: 'same.txt'},
        ],
    });
    assert.equal(duplicate.status, 'blocked');
    assert.deepEqual(duplicate.diagnostics.map(entry => entry.code), ['transaction-path-duplicate']);
    await assert.rejects(preflightFileTransaction({
        filesystem: scopedFilesystem,
        operations: [{bytes: Buffer.from('invalid'), expected: {hash: '0'.repeat(64), kind: 'file'}, kind: 'create', path: 'invalid.txt'}],
    }), /create requires expected missing/u);
    await assert.rejects(preflightFileTransaction({
        filesystem: scopedFilesystem,
        operations: [{expected: {kind: 'missing'}, kind: 'delete', path: 'invalid.txt'}],
    }), /delete requires expected file/u);
});

test('File Transaction reports completed operations and rolls them back after an apply failure', async () => {
    /** @type {Map<string, Buffer>} */
    const files = new Map();
    let writes = 0;
    /** @type {Parameters<typeof preflightFileTransaction>[0]['filesystem']} */
    const filesystem = {
        resolve({path}) {
            return {absolutePath: path, diagnostics: [], relativePath: path, status: /** @type {'succeeded'} */ ('succeeded')};
        },
        async inspect({path}) {
            return {diagnostics: [], entry: files.has(path) ? {kind: 'file', path} : {kind: 'missing', path}, status: 'succeeded'};
        },
        async read({path}) {
            return {bytes: files.get(path), diagnostics: [], path, status: 'succeeded'};
        },
        async remove({path}) {
            files.delete(path);
            return {diagnostics: [], removed: true, status: 'succeeded'};
        },
        async write({bytes, path}) {
            writes += 1;
            if (writes === 2) return {diagnostics: [{code: 'injected-failure', message: 'Injected.'}], stage: 'write', status: 'failed'};
            files.set(path, bytes);
            return {diagnostics: [], status: 'succeeded'};
        },
    };
    const preflight = await preflightFileTransaction({
        filesystem,
        operations: [
            {bytes: Buffer.from('one'), expected: {kind: 'missing'}, kind: 'create', path: 'one.txt'},
            {bytes: Buffer.from('two'), expected: {kind: 'missing'}, kind: 'create', path: 'two.txt'},
        ],
    });
    if (preflight.status !== 'succeeded') assert.fail('Transaction preflight must succeed.');
    const result = await applyFileTransaction(preflight.preparedTransaction);
    assert.equal(result.status, 'failed');
    assert.deepEqual(result.completedOperations, [{kind: 'create', path: 'one.txt'}]);
    assert.deepEqual(result.rollback, [{path: 'one.txt', status: 'restored'}]);
    assert.equal(files.size, 0);
});
