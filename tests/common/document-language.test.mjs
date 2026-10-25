import assert from 'node:assert/strict';
import test from 'node:test';

import {analyzeDocumentLanguage} from '../../lib/common/document-language.mjs';

test('Document Language Analysis Module 按 Unicode code point 与规定权重统计正文', () => {
    assert.deepEqual(analyzeDocumentLanguage({
        flows: [{kind: 'body', text: '中文 English Русский 123 !'}],
        path: 'docs/example.md',
    }), {
        chinese: 16,
        english: 28,
        other: 56,
        path: 'docs/example.md',
    });
});
