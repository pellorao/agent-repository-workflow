import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import test from 'node:test';

// Spec approximation for mixed Chinese and English rules; pure Chinese text is closer to 1 char per token.
const CHARS_PER_TOKEN = 1.3;
const ALWAYS_ON_TOKEN_LIMIT = 8000;
// The entry file plus every file it requires reading unconditionally.
const ALWAYS_ON_FILES = ['AGENTS.md'];

const read = (/** @type {string} */ path) => {
    const url = new URL(`../${path}`, import.meta.url);
    // During the Claude Code migration the entry file is temporarily renamed to AGENTS.md.bak.
    const migrationUrl = new URL(`../${path}.bak`, import.meta.url);
    return readFileSync(existsSync(url) ? url : migrationUrl, 'utf8');
};

test('always-on rules stay within the token budget', () => {
    const chars = ALWAYS_ON_FILES.reduce((total, path) => total + [...read(path)].length, 0);
    const tokens = Math.ceil(chars / CHARS_PER_TOKEN);
    assert.ok(tokens <= ALWAYS_ON_TOKEN_LIMIT, `always-on rules are about ${tokens} tokens (${chars} chars), limit ${ALWAYS_ON_TOKEN_LIMIT}.`);
});
