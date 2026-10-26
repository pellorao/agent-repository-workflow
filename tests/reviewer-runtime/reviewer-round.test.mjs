import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

import {prepareReviewerRound} from '../../lib/reviewer-runtime/reviewer-round.mjs';
import {reviewerRecoveryPath} from '../../lib/reviewer-runtime/reviewer-session-record.mjs';

test('a round follows a usable thread, opens a new thread after a failed run, and stops on an unreadable record', async t => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'arw-round-'));
    t.after(() => rm(stateDirectory, {recursive: true, force: true}));
    const ruleFiles = new Map([['docs/agents/roles/r.md', Buffer.from('role')], ['docs/agents/reviewer.md', Buffer.from('common')]]);
    const recordPath = reviewerRecoveryPath({stateDirectory, role: 'r', identity: {kind: 'ordinary', issueIds: ['issue:0001:01']}});
    const round = async (/** @type {string} */ name) => {
        const roundDirectory = join(stateDirectory, name);
        await prepareReviewerRound({repositoryRoot: '/repo', roundDirectory, ruleFiles, reviewers: [{role: 'r', issueIds: ['issue:0001:01'],
            reportPath: join(roundDirectory, 'r', 'review.txt'), handoff: previous => `previous: ${previous?.reportPath ?? 'none'}`}]});
        return JSON.parse(await readFile(join(roundDirectory, 'r.jsonl'), 'utf8'));
    };
    const first = await round('1');
    assert.equal(first.operation, 'spawn_agent');
    assert.equal(first.input.newThread, undefined);
    const record = {runId: 'run-1', threadId: 'thread-1', failure: null, reportPath: join(stateDirectory, '1', 'r', 'review.txt')};
    await writeFile(recordPath, JSON.stringify(record));
    const second = await round('2');
    assert.equal(second.operation, 'followup_task');
    assert.equal(second.input.runId, 'run-1');
    assert.match(second.input.handoff, /previous: .*\/1\/r\/review\.txt/u);
    await writeFile(recordPath, JSON.stringify({...record, failure: {code: 'reviewer-stop-failed', message: 'Not exited.'}}));
    const third = await round('3');
    assert.deepEqual([third.operation, third.input.newThread, third.input.runId], ['spawn_agent', true, undefined]);
    await writeFile(recordPath, '{');
    await assert.rejects(round('4'), SyntaxError);
});
