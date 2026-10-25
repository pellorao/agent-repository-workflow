import assert from 'node:assert/strict';
import test from 'node:test';
import {stripVTControlCharacters} from 'node:util';

import {renderBackgroundAgents} from '../../lib/background-agent/presentation.mjs';

test('background Agent overview uses four columns and retains full Main identity and elapsed time', () => {
    const fullId = '019caaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const fullTitle = '日本語の長い Main タイトル 😀';
    const result = renderBackgroundAgents([
        {role: 'requirements-reviewer', ownerId: fullId, ownerTitle: fullTitle, state: 'running', taskElapsedMs: 3_661_000},
        {role: 'code-standards-reviewer', ownerId: 'main-2', ownerTitle: 'ASCII', state: 'idle', taskElapsedMs: 3_000},
        {role: 'spec-readiness-reviewer', ownerId: 'main-3', ownerTitle: null, state: 'unknown', taskElapsedMs: null},
        {role: 'spec-readiness-reviewer', ownerId: 'main-4', ownerTitle: ' \t ', state: 'starting', taskElapsedMs: 0},
    ]);
    const [heading, divider, first, second, third, fourth] = result.split('\n');

    assert.match(heading, /^Status\s{2,}Role\s{2,}Main session\s{2,}Elapsed$/u);
    assert.match(divider, /^[- ]+$/u);
    assert.equal(divider.split(/ {2,}/u).length, 4);
    assert.ok(first.includes(`${fullTitle} (${fullId})`));
    assert.ok(first.endsWith('1:01:01'));
    assert.ok(second.endsWith('0:00:03'));
    assert.ok(second.includes('main-2'));
    assert.match(third, /\u001b\[90mN\/A\u001b\[0m/u);
    assert.match(fourth, /\u001b\[90mN\/A\u001b\[0m/u);
    assert.ok(third.includes('unknown'));
    assert.ok(third.includes('spec-readiness-reviewer'));
    assert.ok(third.includes('main-3'));
    assert.ok(third.endsWith('  -'));
    assert.ok(fourth.endsWith('0:00:00'));
    assert.match(third, /\u001b\[90mN\/A\u001b\[0m \(main-3\)/u);
    assert.equal(result.includes('cwd'), false);
});







test('untrusted titles cannot emit terminal controls while missing titles retain gray N/A', () => {
    const rows = renderBackgroundAgents([
        {role: 'reviewer', ownerId: 'root-unsafe', ownerTitle: 'Before\u001b[2J\u001b[31mAfter\u001b[0m\u0007\u202e', state: 'running', taskElapsedMs: 0},
        {role: 'reviewer', ownerId: 'root-missing', ownerTitle: null, state: 'idle', taskElapsedMs: 0},
    ]).split('\n').slice(2);
    assert.equal(stripVTControlCharacters(rows[0]), rows[0]);
    assert.doesNotMatch(rows[0], /[\p{Cc}\p{Bidi_Control}]/u);
    assert.match(rows[0], /BeforeAfter\\u0007\\u202e/u);
    assert.match(rows[0], /root-unsafe/u);
    assert.match(rows[1], /\u001b\[90mN\/A\u001b\[0m \(root-missing\)/u);
});
