import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {launchConfiguredEditor} from '../../lib/arw-common/editor-process.mjs';

test('waiting editor executes a real Windows cmd command through the shared process Adapter', {
    skip: process.platform !== 'win32',
}, async t => {
    const directory = await createTemporaryDirectory(t, 'arw-editor-process-');
    const commandPath = join(directory, 'review editor.cmd');
    const reviewPath = join(directory, 'review result.txt');
    await writeFile(commandPath, '@echo off\r\n> "%~1" echo reviewed\r\n', 'utf8');

    await launchConfiguredEditor({
        editor: {args: ['{file}'], command: commandPath},
        filePath: reviewPath,
        platform: 'win32',
        wait: true,
    });

    assert.equal(await readFile(reviewPath, 'utf8'), 'reviewed\r\n');
});

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
