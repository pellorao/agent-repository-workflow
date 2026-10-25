import assert from 'node:assert/strict';
import test from 'node:test';

import {createRepository, run} from '../helpers/arw-cli.mjs';

test('arw language inspect 固定 grammar 并传递全部路径', async t => {
    const repository = await createRepository(t);
    for (const args of [
        ['language'],
        ['language', 'unknown'],
        ['language', 'inspect'],
        ['language', 'inspect', '--unknown'],
    ]) {
        const output = await run(args, repository);
        assert.equal(output.result, 2);
        assert.match(output.events[0].message, /^Usage:/u);
    }

    let observed;
    const output = await run(['language', 'inspect', 'docs', 'README.md'], repository, {
        documentLanguageDependencies: {inspect: async input => {
            observed = input;
            return {
                diagnostics: [],
                rows: [
                    {chinese: 75, english: 25, other: 0, path: 'README.md'},
                    {chinese: null, english: null, other: null, path: 'docs/empty.md'},
                ],
                status: 'passed',
            };
        }},
    });
    assert.deepEqual(observed, {paths: ['docs', 'README.md'], repositoryRoot: repository.root});
    assert.equal(output.result, 0);
    assert.deepEqual(output.events, [{
        channel: 'stdout',
        message: [
            'Document       Chinese  English  Other',
            '-------------  -------  -------  -----',
            'README.md      75.0%    25.0%    0.0%',
            'docs/empty.md  -        -        -',
        ].join('\n'),
    }]);
});

test('arw language inspect 失败时只输出诊断', async t => {
    const repository = await createRepository(t);
    const output = await run(['language', 'inspect', 'missing.md'], repository, {
        documentLanguageDependencies: {inspect: async () => ({
            diagnostics: [{code: 'language-inspection-path-invalid', message: 'Missing.', path: 'missing.md'}],
            rows: [],
            status: 'failed',
        })},
    });
    assert.equal(output.result, 1);
    assert.deepEqual(output.events, [{
        channel: 'stderr',
        message: '[language-inspection-path-invalid] missing.md: Missing.',
    }]);
});
