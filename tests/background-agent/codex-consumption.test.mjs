import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {readCodexMainTitle} from '../../lib/background-agent/codex-consumption.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';

const ownerId = 'main-native-session-full-id-1234567890';

/** @param {unknown} value */
const line = value => `${JSON.stringify(value)}\n`;
/** @param {string} id */
const session = id => ({type: 'session_meta', payload: {id}});
/** @param {string} sessionPath @param {string | null} [title] */
const native = (sessionPath, title = null) => ({
    readThreadMetadata: async (/** @type {{threadId:string}} */ input) => {
        assert.equal(input.threadId, ownerId);
        return {title, preview: '', sessionPath};
    },
});

test('Main title prefers native title and otherwise uses the first user message up to 40 code points', async t => {
    const directory = await createTemporaryDirectory(t, 'arw-main-title-');
    const sessionPath = join(directory, 'main.jsonl');
    const firstUser = `😀${'界'.repeat(45)}`;
    const userMessage = (/** @type {string} */ text) => ({type: 'response_item', payload: {type: 'message', role: 'user', content: [{type: 'input_text', text}]}});

    await writeFile(sessionPath, line(session(ownerId)) + line(userMessage(firstUser)) + line(userMessage('later')), 'utf8');
    assert.equal(await readCodexMainTitle({ownerId, native: native(sessionPath, 'Native session title')}), 'Native session title');
    assert.equal(await readCodexMainTitle({ownerId, native: native(sessionPath)}), `😀${'界'.repeat(39)}`);

    await writeFile(sessionPath, line(session(ownerId)) + line({type: 'response_item', payload: {type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'assistant text'}]}}), 'utf8');
    assert.equal(await readCodexMainTitle({ownerId, native: native(sessionPath)}), null);
    await writeFile(sessionPath, line(session('other-native-session')) + line(userMessage(firstUser)), 'utf8');
    assert.equal(await readCodexMainTitle({ownerId, native: native(sessionPath)}), null);
});
