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

const DAILY_FLOW_TOKEN_LIMIT = 40000;
// Heaviest daily flow: always-on rules, the implement-to-commit Skills and every document they require the Main Agent to read.
// `docs/agents/reviewer.md` is handed to Reviewers as content, not read by the Main Agent.
const DAILY_FLOW_FILES = [
    ...ALWAYS_ON_FILES,
    ...['implement', 'spec-readiness', 'validation', 'issue-tracking', 'reviewer-launch', 'commit', 'code-review']
        .map(name => `.agents/skills/${name}/SKILL.md`),
    '.agents/skills/code-review/result-reuse.md',
    ...['agent-writes', 'subagent-allocation', 'subagent-findings', 'writing', 'environment'].map(name => `docs/agents/${name}.md`),
];

test('heaviest daily flow stays within the token budget', () => {
    const chars = DAILY_FLOW_FILES.reduce((total, path) => total + [...read(path)].length, 0);
    const tokens = Math.ceil(chars / CHARS_PER_TOKEN);
    assert.ok(tokens <= DAILY_FLOW_TOKEN_LIMIT, `daily flow is about ${tokens} tokens (${chars} chars), limit ${DAILY_FLOW_TOKEN_LIMIT}.`);
});
