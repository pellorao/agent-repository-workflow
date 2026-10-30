import assert from 'node:assert/strict';
import test from 'node:test';

import {formatTextTable} from '../../lib/common/text-table.mjs';
import {listArtifacts} from '../../lib/arw-common/artifacts.mjs';
import {renderJiraList} from '../../lib/application-jira/jira-presentation.mjs';
import {renderBackgroundAgents} from '../../lib/background-agent/presentation.mjs';

const widest = (/** @type {string} */ table) => Math.max(...table.split('\n').map(line => [...line].reduce((sum, character) => sum + (/[\u4e00-\u9fff]/u.test(character) ? 2 : 1), 0)));

test('formatTextTable without options or within the width is unchanged', () => {
    const plain = formatTextTable(['A', 'Title'], [['x', 'short']]);
    assert.equal(plain, 'A  Title\n-  -----\nx  short');
    assert.equal(formatTextTable(['A', 'Title'], [['x', 'short']], {flexColumn: 1, width: 100}), plain);
});

test('formatTextTable truncates only the name to the cap with ... and never splits wide characters', () => {
    const ascii = formatTextTable(['A', 'Title'], [['x', 'a'.repeat(200)]], {flexColumn: 1, width: 100});
    assert.equal(ascii.split('\n')[2], `x  ${'a'.repeat(94)}...`);
    const wide = formatTextTable(['A', 'Title'], [['x', '汉'.repeat(100)]], {flexColumn: 1, width: 100}).split('\n')[2];
    assert.equal(wide, `x  ${'汉'.repeat(47)}...`);
    assert.ok(widest(wide) <= 100);
    const family = formatTextTable(['Title'], [['👨‍👩‍👧'.repeat(40)]], {flexColumn: 0, width: 20}).split('\n')[2];
    assert.equal(family, `${'👨‍👩‍👧'.repeat(8)}...`);
});

test('formatTextTable keeps 16 columns of the name when other columns are wide', () => {
    const wideOther = formatTextTable(['Other', 'Title'], [['o'.repeat(95), 'n'.repeat(50)]], {flexColumn: 1, width: 100}).split('\n')[2];
    assert.ok(wideOther.endsWith(`${'n'.repeat(13)}...`));
});

test('list renderers truncate by default and print full names with full', () => {
    const title = 'T'.repeat(150);
    const inventory = /** @type {any} */ ({errors: {}, diagnostics: {map: [], issue: []}, legacyDetected: false, records: {map: [{id: 'map:0001', title}], issue: [{id: 'issue:0001:01', title, status: 'ready-for-agent', kind: 'implementation', blockedBy: []}]}});
    for (const kind of ['map', 'issue']) {
        const options = {allStatuses: true, status: null, type: null};
        const lines = listArtifacts(inventory, /** @type {any} */ (kind), options).output.split('\n');
        assert.match(lines[2], /\.\.\.$/u);
        assert.ok(widest(lines[2]) <= 100);
        assert.ok(listArtifacts(inventory, /** @type {any} */ (kind), {...options, full: true}).output.endsWith(title));
    }
    const jira = {entries: [{key: 'PAY-1', title}], total: 1};
    assert.match(renderJiraList(jira, false).split('\n').at(-1) ?? '', /^PAY-1  T+\.\.\.$/u);
    assert.ok(renderJiraList(jira, true).endsWith(title));
    const rows = [{role: 'reviewer', ownerId: 'sess-1', ownerTitle: title, state: 'idle', taskElapsedMs: 1000}];
    assert.match(renderBackgroundAgents(rows, false).split('\n')[2], /sess-1 +T+\.\.\.$/u);
    assert.ok(renderBackgroundAgents(rows, true).endsWith(title));
});
