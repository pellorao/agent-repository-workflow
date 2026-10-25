import assert from 'node:assert/strict';
import test from 'node:test';

import {parseTreeBlobEntries} from '../../lib/common/git-content.mjs';

test('Git Content parses only complete NUL-delimited blob tree entries', () => {
    assert.deepEqual(parseTreeBlobEntries(Buffer.from('100644 blob 0123456789012345678901234567890123456789\tpath/file.md\0')), [{
        mode: '100644',
        objectId: '0123456789012345678901234567890123456789',
        path: 'path/file.md',
    }]);
    assert.throws(() => parseTreeBlobEntries(Buffer.from('160000 commit 0123456789012345678901234567890123456789\tmodule\0')), /unsupported blob entry/u);
});
