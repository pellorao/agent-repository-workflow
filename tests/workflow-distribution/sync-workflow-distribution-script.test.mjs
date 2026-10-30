import assert from 'node:assert/strict';
import test from 'node:test';

import {runWorkflowDistributionSyncCli} from '../../scripts/sync-workflow-distribution.mjs';

/** @param {Awaited<ReturnType<NonNullable<Parameters<typeof runWorkflowDistributionSyncCli>[1]>['sync'] & {}>>} result */
const runWith = async result => {
    /** @type {string[]} */
    const stderr = [];
    /** @type {string[]} */
    const stdout = [];
    let calls = 0;
    const code = await runWorkflowDistributionSyncCli([], {
        repositoryRoot: 'unused',
        stderr: value => stderr.push(value),
        stdout: value => stdout.push(value),
        sync: async () => {
            calls += 1;
            return result;
        },
    });
    return {calls, code, stderr: stderr.join(''), stdout: stdout.join('')};
};

test('sync CLI rejects every argument as a usage error without calling the sync', async () => {
    for (const args of [['review'], ['prepare'], ['apply', '--plan-digest', 'a'.repeat(64)], ['--help']]) {
        let called = false;
        /** @type {string[]} */
        const stderr = [];
        const code = await runWorkflowDistributionSyncCli(args, {
            stderr: value => stderr.push(value),
            sync: async () => {
                called = true;
                return {diagnostics: [], notices: [], status: 'succeeded'};
            },
        });
        assert.equal(code, 2);
        assert.equal(called, false);
        assert.match(stderr.join(''), /^Usage:/u);
    }
});

test('sync CLI prints notice lines to stderr and exits 0 on success', async () => {
    const result = await runWith({
        diagnostics: [],
        notices: [{column: 5, context: '$other now', identity: 'other', line: 2, path: '.agents/skills/a/SKILL.md'}],
        status: 'succeeded',
    });
    assert.equal(result.code, 0);
    assert.equal(result.calls, 1);
    assert.equal(result.stderr, 'notice skill-reference-unknown path=.agents/skills/a/SKILL.md:2:5 identity=other: $other now\n');
    assert.match(result.stdout, /completed/u);
});

test('sync CLI renders blocked diagnostics with path:line:column and exits 1', async () => {
    const result = await runWith({
        diagnostics: [{code: 'skill-reference-terminator-invalid', column: 3, identity: 'implement', line: 4, message: 'Bad.', path: '.agents/skills/a/SKILL.md'}],
        status: 'blocked',
    });
    assert.equal(result.code, 1);
    assert.equal(result.stderr, 'skill-reference-terminator-invalid path=.agents/skills/a/SKILL.md:4:3 identity=implement: Bad.\n');
    assert.equal(result.stdout, '');
});
