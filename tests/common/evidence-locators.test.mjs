import assert from 'node:assert/strict';
import test from 'node:test';

import {normalizeBodyEvidence, parseCompactEvidence} from '../../lib/common/evidence-locators.mjs';

test('compact evidence parses complete and continued paths and rejects invalid segments', () => {
    assert.deepEqual(parseCompactEvidence('docs/spec.md:14-17,18,docs/adr.md:2-4,6'), [
        {filePath: 'docs/spec.md', lineEnd: 17, lineStart: 14},
        {filePath: 'docs/spec.md', lineEnd: 18, lineStart: 18},
        {filePath: 'docs/adr.md', lineEnd: 4, lineStart: 2},
        {filePath: 'docs/adr.md', lineEnd: 6, lineStart: 6},
    ]);
    assert.deepEqual(parseCompactEvidence('docs/spec.md:1, docs/other.md:2'), [
        {filePath: 'docs/spec.md', lineEnd: 1, lineStart: 1},
        {filePath: 'docs/other.md', lineEnd: 2, lineStart: 2},
    ]);
    for (const source of ['', 'docs/spec.md:', ':1', 'docs/spec.md:0', 'docs/spec.md:4-3', 'docs/spec.md:1, 2', 'docs/spec.md:1,not-a-range']) {
        assert.throws(() => parseCompactEvidence(source), /Compact evidence locator is invalid/);
    }
});

test('body evidence merges equivalent selections and excludes Markdown headings without treating fenced code as headings', () => {
    const sources = new Map([['docs/spec.md', [
        '# Title',
        '',
        '## Contract',
        '',
        'Body one.',
        '',
        '```js',
        '# retained code',
        '```',
        '',
        'Body two.',
    ].join('\n')], ['notes.txt', '# plain text is body']]);
    const whole = normalizeBodyEvidence(parseCompactEvidence('docs/spec.md:1-11'), sources);
    const combined = normalizeBodyEvidence(parseCompactEvidence('docs/spec.md:1-5,6-11'), sources);

    assert.deepEqual(whole, [
        {filePath: 'docs/spec.md', line: 5},
        {filePath: 'docs/spec.md', line: 6},
        {filePath: 'docs/spec.md', line: 7},
        {filePath: 'docs/spec.md', line: 8},
        {filePath: 'docs/spec.md', line: 9},
        {filePath: 'docs/spec.md', line: 10},
        {filePath: 'docs/spec.md', line: 11},
    ]);
    assert.deepEqual(combined, whole);
    const titleSplitSources = new Map([['docs/title-split.md', [
        'Body one.',
        '',
        '## Intervening title',
        '',
        'Body two.',
    ].join('\n')]]);
    const normalized = normalizeBodyEvidence(parseCompactEvidence('docs/title-split.md:1-5'), titleSplitSources);
    assert.deepEqual(
        normalizeBodyEvidence(normalized.map(({filePath, line}) => ({filePath, lineEnd: line, lineStart: line})), titleSplitSources),
        normalized,
    );
    assert.deepEqual(normalizeBodyEvidence(parseCompactEvidence('docs/spec.md:1-4'), sources), []);
    assert.deepEqual(normalizeBodyEvidence(parseCompactEvidence('notes.txt:1'), sources), [
        {filePath: 'notes.txt', line: 1},
    ]);
});

test('body evidence rejects missing sources and out-of-bounds ranges', () => {
    const sources = new Map([['docs/spec.md', 'Body.']]);
    assert.throws(
        () => normalizeBodyEvidence(parseCompactEvidence('docs/missing.md:1'), sources),
        /Evidence source is unavailable: docs\/missing\.md/,
    );
    assert.throws(
        () => normalizeBodyEvidence(parseCompactEvidence('docs/spec.md:2'), sources),
        /Evidence line does not exist: docs\/spec\.md:2/,
    );
});
