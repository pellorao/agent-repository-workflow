import assert from 'node:assert/strict';
import test from 'node:test';

import {
    checkShape,
    deleteJsonPath,
    digestJson,
    jsonSemanticallyEqual,
    parseJson,
    readJsonPath,
    serializeJson,
    writeJson,
    writeJsonPath,
} from '../../lib/common/json.mjs';

test('parseJson accepts strings, exact UTF-8 bytes, and scoped files without newline normalization', async () => {
    const crlf = Buffer.from('{\r\n  "value": true\r\n}\r\n', 'utf8');
    assert.deepEqual(await parseJson(crlf), {
        diagnostics: [],
        status: 'succeeded',
        value: {value: true},
    });
    assert.deepEqual(await parseJson({
        filesystem: {read: async () => ({bytes: crlf, diagnostics: [], status: 'succeeded'})},
        path: 'value.json',
    }), {
        diagnostics: [],
        status: 'succeeded',
        value: {value: true},
    });
    assert.equal((await parseJson(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), crlf]))).status, 'blocked');
    assert.equal((await parseJson(Buffer.from([0xff]))).status, 'blocked');
    assert.equal((await parseJson('{')).status, 'blocked');
});

test('JSON path operations preserve __proto__ as an ordinary object key', () => {
    const source = JSON.parse('{"__proto__":{"leaf":1}}');
    const written = writeJsonPath({}, ['__proto__', 'leaf'], 2);

    assert.deepEqual(readJsonPath(source, ['__proto__', 'leaf']), {
        diagnostics: [],
        present: true,
        status: 'succeeded',
        value: 1,
    });
    assert.deepEqual(written, {
        diagnostics: [],
        status: 'succeeded',
        value: JSON.parse('{"__proto__":{"leaf":2}}'),
    });
    if (written.status !== 'succeeded' || written.value === null || typeof written.value !== 'object') {
        throw new Error('JSON path write did not return an object value.');
    }
    assert.equal(Object.getPrototypeOf(written.value), Object.prototype);
    assert.equal(Object.hasOwn(written.value, '__proto__'), true);
    assert.deepEqual(deleteJsonPath(source, ['__proto__']), {
        diagnostics: [],
        removed: true,
        status: 'succeeded',
        value: {},
    });
});

test('JSON Module preserves default field order while semantic operations ignore object key order', async () => {
    const value = {z: 1, a: {y: 2, x: 3}};
    const preserved = serializeJson(value);
    const sorted = serializeJson(value, {sortKeys: true});
    const compact = serializeJson(value, {format: 'compact'});
    const compactSorted = serializeJson(value, {format: 'compact', sortKeys: true});
    assert.equal(preserved.status, 'succeeded');
    if (preserved.status !== 'succeeded'
        || sorted.status !== 'succeeded'
        || compact.status !== 'succeeded'
        || compactSorted.status !== 'succeeded') assert.fail('Valid JSON serialization must succeed.');
    assert.equal(preserved.bytes.toString('utf8'), '{\n  "z": 1,\n  "a": {\n    "y": 2,\n    "x": 3\n  }\n}\n');
    assert.equal(sorted.bytes.toString('utf8'), '{\n  "a": {\n    "x": 3,\n    "y": 2\n  },\n  "z": 1\n}\n');
    assert.equal(compact.bytes.toString('utf8'), '{"z":1,"a":{"y":2,"x":3}}');
    assert.equal(compactSorted.bytes.toString('utf8'), '{"a":{"x":3,"y":2},"z":1}');
    assert.equal(compact.bytes.includes(0x0a), false);
    assert.deepEqual(await parseJson(sorted.bytes.toString('utf8')), {diagnostics: [], status: 'succeeded', value: {a: {x: 3, y: 2}, z: 1}});
    assert.equal(jsonSemanticallyEqual(value, {a: {x: 3, y: 2}, z: 1}), true);
    assert.equal(digestJson(value), digestJson({a: {x: 3, y: 2}, z: 1}));
    assert.equal(serializeJson({value: Number.NaN}).status, 'blocked');

    /** @type {Buffer | undefined} */
    let writtenBytes;
    const written = await writeJson({
        filesystem: {
            async write({bytes}) {
                writtenBytes = bytes;
                return {status: 'succeeded'};
            },
        },
        path: 'record.json',
        value,
    }, {format: 'compact'});
    assert.equal(written.status, 'succeeded');
    assert.equal(writtenBytes?.toString('utf8'), '{"z":1,"a":{"y":2,"x":3}}');
});

test('checkShape reports the first missing key, wrong type, or failed predicate', () => {
    /** @type {import('../../lib/common/json.mjs').Shape} */
    const shape = {count: 'positive-integer', nested: {name: 'string'}, tag: (/** @type {unknown} */ value) => value === 'x'};
    assert.equal(checkShape({count: 1, nested: {name: 'a'}, tag: 'x'}, shape), null);
    assert.equal(checkShape({count: 1, tag: 'x'}, shape, 'input'), 'input must contain exactly: count, nested, tag.');
    assert.equal(checkShape({count: 0, nested: {name: 'a'}, tag: 'x'}, shape), 'value.count must be a positive-integer.');
    assert.equal(checkShape({count: 1, nested: {name: 2}, tag: 'x'}, shape), 'value.nested.name must be a string.');
    assert.equal(checkShape({count: 1, nested: {name: 'a'}, tag: 'y'}, shape), 'value.tag is invalid.');
});
