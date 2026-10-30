import assert from 'node:assert/strict';
import test from 'node:test';

import {launchConfiguredEditor} from '../../lib/arw-common/editor-process.mjs';

test('editor launch passes a file path containing replacement patterns unchanged', async () => {
    /** @type {readonly string[]} */
    let received = [];
    await launchConfiguredEditor({
        editor: {args: ['--open', '{file}'], command: 'editor'},
        filePath: '/x/a$&b$$c.md',
        platform: 'linux',
        spawn: (_command, args) => {
            received = args;
            return {once: (event, listener) => { if (event === 'spawn') /** @type {() => void} */ (listener)(); }};
        },
    });
    assert.deepEqual(received, ['--open', '/x/a$&b$$c.md']);
});
