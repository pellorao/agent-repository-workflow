import assert from 'node:assert/strict';
import test from 'node:test';

import {inspectTextBytes} from '../../lib/common/text-policy.mjs';

test('Text Policy Module 检查并规范化 UTF-8 BOM 和换行', () => {
    assert.deepEqual(inspectTextBytes(Buffer.from('line one\nline two\n', 'utf8')), {
        fixedBytes: null,
        issues: [],
        kind: 'text',
    });

    assert.deepEqual(inspectTextBytes(Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('line one\r\nline two\rline three\n', 'utf8'),
    ])), {
        fixedBytes: Buffer.from('line one\nline two\nline three\n', 'utf8'),
        issues: ['utf8-bom', 'crlf', 'cr'],
        kind: 'text',
    });
});

test('Text Policy Module 稳定区分 binary 与 invalid UTF-8', () => {
    assert.deepEqual(inspectTextBytes(Buffer.from([0x00, 0x61])), {
        fixedBytes: null,
        issues: [],
        kind: 'binary',
    });
    assert.equal(inspectTextBytes(Buffer.from([0x01, 0x02, 0x03, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67])).kind, 'text');
    assert.equal(inspectTextBytes(Buffer.from([0x01, 0x02, 0x03, 0x04, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66])).kind, 'binary');

    for (const bytes of [
        Buffer.from([0xff, 0xfe, 0x61, 0x00]),
        Buffer.from([0xfe, 0xff, 0x00, 0x61]),
        Buffer.from([0xc3, 0x28]),
    ]) {
        assert.deepEqual(inspectTextBytes(bytes), {
            fixedBytes: null,
            issues: ['invalid-utf8'],
            kind: 'text',
        });
    }

    const nulAfterSample = Buffer.concat([Buffer.alloc(8192, 0x61), Buffer.from([0x00])]);
    assert.equal(inspectTextBytes(nulAfterSample).kind, 'text');
});
