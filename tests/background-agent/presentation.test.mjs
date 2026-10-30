import assert from 'node:assert/strict';
import test from 'node:test';
import {stripVTControlCharacters} from 'node:util';

import {renderBackgroundAgents} from '../../lib/background-agent/presentation.mjs';

test('background Agent overview uses five columns and retains full Main identity and elapsed time', () => {
    const fullId = '019caaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const fullTitle = '日本語の長い Main タイトル 😀';
    const result = renderBackgroundAgents([
        {role: 'requirements-reviewer', ownerId: fullId, ownerTitle: fullTitle, state: 'running', taskElapsedMs: 3_661_000},
        {role: 'code-standards-reviewer', ownerId: 'main-2', ownerTitle: 'ASCII', state: 'idle', taskElapsedMs: 3_000},
        {role: 'spec-readiness-reviewer', ownerId: 'main-3', ownerTitle: null, state: 'unknown', taskElapsedMs: null},
        {role: 'spec-readiness-reviewer', ownerId: 'main-4', ownerTitle: ' \t ', state: 'starting', taskElapsedMs: 0},
    ], true);
    const [heading, divider, first, second, third, fourth] = result.split('\n');

    assert.match(heading, /^Status\s{2,}Role\s{2,}Elapsed\s{2,}Session\s{2,}Title$/u);
    assert.match(divider, /^[- ]+$/u);
    assert.equal(divider.split(/ {2,}/u).length, 5);
    assert.ok(first.includes(`1:01:01  ${fullId}  ${fullTitle}`));
    assert.match(second, /0:00:03  main-2 +ASCII$/u);
    assert.match(third, /\u001b\[90mN\/A\u001b\[0m/u);
    assert.match(fourth, /\u001b\[90mN\/A\u001b\[0m/u);
    assert.ok(third.includes('unknown'));
    assert.ok(third.includes('spec-readiness-reviewer'));
    assert.match(third, / -  +main-3 +\u001b/u);
    assert.match(fourth, /0:00:00  main-4 +\u001b/u);
});
test('default width truncates only Title and keeps Session whole', () => {
    const row = {role: 'reviewer', ownerId: 'id-'.repeat(8), ownerTitle: 'T'.repeat(150), state: 'idle', taskElapsedMs: 0};
    const line = renderBackgroundAgents([row], false).split('\n')[2];
    assert.ok(line.includes(row.ownerId));
    assert.match(line, /T\.\.\.$/u);
    assert.ok(line.length <= 100);
    assert.ok(renderBackgroundAgents([row], true).endsWith('T'.repeat(150)));
});

test('untrusted titles cannot emit terminal controls while missing titles retain gray N/A', () => {
    const rows = renderBackgroundAgents([
        {role: 'reviewer', ownerId: 'root-unsafe', ownerTitle: 'Before\u001b[2J\u001b[31mAfter\u001b[0m\u0007\u202e', state: 'running', taskElapsedMs: 0},
        {role: 'reviewer', ownerId: 'root-missing', ownerTitle: null, state: 'idle', taskElapsedMs: 0},
    ], false).split('\n').slice(2);
    assert.equal(stripVTControlCharacters(rows[0]), rows[0]);
    assert.doesNotMatch(rows[0], /[\p{Cc}\p{Bidi_Control}]/u);
    assert.match(rows[0], /BeforeAfter\\u0007\\u202e/u);
    assert.match(rows[0], /root-unsafe/u);
    assert.match(rows[1], /root-missing  \u001b\[90mN\/A\u001b\[0m$/u);
});
