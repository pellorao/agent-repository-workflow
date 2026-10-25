import assert from 'node:assert/strict';
import test from 'node:test';

import {createCurrentPlatformAdapter} from '../../lib/arw-common/platform-adapter.mjs';

test('current Platform Adapter reports the Claude Code session identity', () => {
    const environment = {CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'claude-session'};
    assert.deepEqual(createCurrentPlatformAdapter({environment}).getCurrentAgentIdentity(), {platform: 'claude-code', sessionId: 'claude-session'});
});

test('current Platform Adapter keeps the Codex thread identity outside Claude Code', () => {
    const environment = {CODEX_THREAD_ID: 'codex-thread'};
    assert.deepEqual(createCurrentPlatformAdapter({environment}).getCurrentAgentIdentity(), {platform: 'codex', sessionId: 'codex-thread'});
});
