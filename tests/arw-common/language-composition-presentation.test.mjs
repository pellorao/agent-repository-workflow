import assert from 'node:assert/strict';
import test from 'node:test';

import {renderLanguageCompositionTable} from '../../lib/arw-common/language-composition-presentation.mjs';

test('language composition table aligns columns after a Chinese path', () => {
    const rows = [
        {chinese: 90, english: 10, other: 0, path: 'docs/说明.md'},
        {chinese: null, english: 100, other: 0, path: 'README.md'},
    ];
    assert.equal(renderLanguageCompositionTable(rows), [
        'Document      Chinese  English  Other',
        '------------  -------  -------  -----',
        'docs/说明.md  90.0%    10.0%    0.0%',
        'README.md     -        100.0%   0.0%',
    ].join('\n'));
});
