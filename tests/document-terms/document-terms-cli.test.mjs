import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import test from 'node:test';

import {createRepository, run} from '../helpers/arw-cli.mjs';

const passedContext = (context = 'CONTEXT.md', summary = {diagnostics: 0, documents: 4, globalTerms: 1, localTerms: 0, uses: 3}) => ({
    context,
    diagnostics: [],
    status: /** @type {'passed'} */ ('passed'),
    summary,
});

/** @param {unknown} input */
const termsInput = input => /** @type {{repositoryRoot: string, request: {include?: string[], mode: 'immediate' | 'release', source: {kind: 'working-tree'}}}} */ (input);

test('arw terms check 固定 grammar 并拒绝无效 include', async t => {
    const repository = await createRepository(t);
    for (const args of [
        ['terms'],
        ['terms', 'unknown'],
        ['terms', 'check', '--threshold', 'docs=80'],
        ['terms', 'check', '--verbose', '--verbose'],
        ['terms', 'check', '--language-threshold'],
        ['terms', 'check', '--language-threshold', 'docs=101'],
        ['terms', 'check', '--language-threshold', 'docs=NaN'],
        ['terms', 'check', '--language-threshold', 'docs=80', '--language-threshold', 'docs=90'],
        ['terms', 'check', '--unknown'],
        ['terms', 'check', '--strict', '--strict'],
        ['terms', 'check', '--strict', 'extra'],
        ['terms', 'check', '--include'],
        ['terms', 'check', '--include', '--strict'],
        ['terms', 'check', '--include', '--unknown'],
        ['terms', 'check', '--include', ''],
        ['terms', 'check', '--include', '/absolute'],
        ['terms', 'check', '--include', 'C:/absolute'],
        ['terms', 'check', '--include', '..'],
        ['terms', 'check', '--include', 'docs/../other'],
        ['terms', 'check', '--include', 'docs\\other'],
        ['terms', 'check', '--include', 'docs//other'],
        ['terms', 'check', '--include', '././docs'],
    ]) {
        const output = await run(args, repository);
        assert.equal(output.result, 2);
        assert.equal(output.events.length, 1);
        assert.equal(output.events[0].channel, 'stderr');
        assert.match(output.events[0].message, /^Usage:\n/u);
        assert.match(output.events[0].message, /arw terms check \[--strict\] \[--include <repository-relative-directory>\]\.\.\./u);
    }
});

test('arw terms check 传递 mode 和规范化 include request', async t => {
    const repository = await createRepository(t);
    /** @type {Array<[string[], {include?: string[], mode: 'immediate' | 'release', source: {kind: 'working-tree'}}]>} */
    const validCases = [
        [['terms', 'check'], {mode: 'immediate', source: {kind: 'working-tree'}}],
        [['terms', 'check', '--verbose'], {mode: 'immediate', source: {kind: 'working-tree'}}],
        [['terms', 'check', '--strict'], {mode: 'release', source: {kind: 'working-tree'}}],
        [
            ['terms', 'check', '--include', './.scratch/current/', '--strict', '--include', '.', '--include', './'],
            {include: ['.scratch/current', '.', '.'], mode: 'release', source: {kind: 'working-tree'}},
        ],
    ];
    for (const [args, request] of validCases) {
        let observed;
        const output = await run(args, repository, {
            documentTermsDependencies: {
                check: async input => {
                    observed = input;
                    return {
                        contexts: [passedContext()],
                        diagnostics: [],
                        languageComposition: [], languageChecks: {checks: [], status: /** @type {'unconfigured'} */ ('unconfigured'), uncovered: []},
                        source: termsInput(input).request,
                        status: 'passed',
                    };
                },
            },
        });
        assert.deepEqual(observed, {repositoryRoot: repository.root, request});
        assert.equal(output.result, 0);
        assert.deepEqual(output.events, [{
            channel: 'stdout',
            message: 'Document terms check passed. Documents: 4; global terms: 1; local terms: 0; uses: 3.',
        }, {channel: 'stdout', message: ''}, {channel: 'stdout', message: 'Language checks: unconfigured.'}]);
    }
});

test('arw terms check 保持单 context finding 兼容格式', async t => {
    const repository = await createRepository(t);
    const diagnostic = {
        code: 'term-disallowed',
        column: 4,
        line: 12,
        name: 'Ar"tifact',
        path: 'docs/example.md',
        related: [{column: 2, line: 3, path: 'README.md'}],
    };
    const output = await run(['terms', 'check'], repository, {
        documentTermsDependencies: {check: async input => ({
            contexts: [{
                context: 'CONTEXT.md',
                diagnostics: [diagnostic],
                status: 'failed',
                summary: {diagnostics: 1, documents: 2, globalTerms: 1, localTerms: 0, uses: 0},
            }],
            diagnostics: [],
            languageComposition: [], languageChecks: {checks: [], status: /** @type {'unconfigured'} */ ('unconfigured'), uncovered: []},
            source: termsInput(input).request,
            status: 'failed',
        })},
    });

    assert.equal(output.result, 1);
    assert.deepEqual(output.events, [{
        channel: 'stderr',
        message: 'document-terms-finding: path="docs/example.md" line=12 column=4 code="term-disallowed" name="Ar\\"tifact" related=[{"path":"README.md","line":3,"column":2}]',
    }, {channel: 'stdout', message: 'Language checks: unconfigured.'}]);
});

test('arw terms check 按 map 顺序串行显示多 context 结果和归属', async t => {
    const repository = await createRepository(t);
    const diagnostic = {code: 'term-spelling-invalid', column: 2, line: 3, name: 'App Name', path: 'apps/README.md'};
    const output = await run(['terms', 'check'], repository, {
        documentTermsDependencies: {check: async input => ({
            contexts: [
                passedContext('packages/CONTEXT.md', {diagnostics: 0, documents: 2, globalTerms: 1, localTerms: 0, uses: 1}),
                {
                    context: 'apps/CONTEXT.md',
                    diagnostics: [diagnostic],
                    status: 'failed',
                    summary: {diagnostics: 1, documents: 3, globalTerms: 1, localTerms: 0, uses: 0},
                },
            ],
            diagnostics: [],
            languageComposition: [], languageChecks: {checks: [], status: /** @type {'unconfigured'} */ ('unconfigured'), uncovered: []},
            source: termsInput(input).request,
            status: 'failed',
        })},
    });

    assert.equal(output.result, 1);
    assert.deepEqual(output.events, [
        {channel: 'stdout', message: 'Document terms check passed. Context: "packages/CONTEXT.md"; Documents: 2; global terms: 1; local terms: 0; uses: 1.'},
        {channel: 'stdout', message: 'Document terms check failed. Context: "apps/CONTEXT.md"; Diagnostics: 1; Documents: 3; global terms: 1; local terms: 0; uses: 0.'},
        {channel: 'stderr', message: 'document-terms-finding: context="apps/CONTEXT.md" path="apps/README.md" line=3 column=2 code="term-spelling-invalid" name="App Name"'},
        {channel: 'stdout', message: ''},
        {channel: 'stdout', message: 'Language checks: unconfigured.'},
    ]);
});

test('arw terms check 直接显示 map finding 并返回 Exit 1', async t => {
    const repository = await createRepository(t);
    const output = await run(['terms', 'check'], repository, {
        documentTermsDependencies: {check: async input => ({
            contexts: [],
            diagnostics: [{code: 'context-map-invalid', path: 'CONTEXT-MAP.md'}],
            languageComposition: [], languageChecks: {checks: [], status: /** @type {'unconfigured'} */ ('unconfigured'), uncovered: []},
            source: termsInput(input).request,
            status: 'failed',
        })},
    });
    assert.equal(output.result, 1);
    assert.deepEqual(output.events, [{channel: 'stderr', message: 'document-terms-finding: path="CONTEXT-MAP.md" code="context-map-invalid"'}, {channel: 'stdout', message: 'Language checks: unconfigured.'}]);
});

test('arw terms check 真实入口默认排除 scratch 并按 include 重新加入', async t => {
    const repository = await createRepository(t);
    await mkdir(resolve(repository.root, '.scratch/current'), {recursive: true});
    await writeFile(resolve(repository.root, 'CONTEXT.md'), '# Context\n\n## Language\n\n**Amber Compass**:\nDefinition.\n', 'utf8');
    await writeFile(resolve(repository.root, 'README.md'), '# Reader\n\nAmber Compass.\n', 'utf8');
    await writeFile(resolve(repository.root, '.scratch/current/work.md'), '# Work\n\namber compass.\n', 'utf8');

    const excluded = await run(['terms', 'check'], repository);
    assert.equal(excluded.result, 0);

    const included = await run(['terms', 'check', '--include', './.scratch/current/'], repository);
    assert.equal(included.result, 1);
    assert.deepEqual(included.events, [
        {
            channel: 'stderr',
            message: 'document-terms-finding: path=".scratch/current/work.md" line=3 column=1 code="term-spelling-invalid" name="Amber Compass"',
        },
        {
            channel: 'stdout',
            message: [
                'Language checks: unconfigured.',
                '',
                'Uncovered documents: 3.',
                '.scratch/current/work.md',
                'CONTEXT.md',
                'README.md',
            ].join('\n'),
        },
    ]);
});

test('arw terms check applies named overrides without changing configuration or check status', async t => {
    const repository = await createRepository(t);
    const config = JSON.stringify({configVersion: 2, languageChecks: {docs: {language: 'chinese', minPercentage: 80, include: ['CONTEXT.md']}}});
    await writeFile(resolve(repository.root, 'arw.config.json'), config);
    await writeFile(resolve(repository.root, 'CONTEXT.md'), '# Context\n\nEnglish prose.\n\n## Language\n');
    const failedLanguage = await run(['terms', 'check'], repository);
    assert.equal(failedLanguage.result, 0);
    assert.match(failedLanguage.events.map(event => event.message).join('\n'), /CONTEXT\.md/u);
    const overridden = await run(['terms', 'check', '--language-threshold', 'docs=0'], repository);
    assert.equal(overridden.result, 0);
    assert.doesNotMatch(overridden.events.map(event => event.message).join('\n'), /CONTEXT\.md/u);
    const verbose = await run(['terms', 'check', '--language-threshold', 'docs=0', '--verbose'], repository);
    assert.equal(verbose.result, 0);
    assert.match(verbose.events.map(event => event.message).join('\n'), /CONTEXT\.md/u);
    assert.equal(await readFile(resolve(repository.root, 'arw.config.json'), 'utf8'), config);
    assert.equal((await run(['terms', 'check', '--language-threshold', 'missing=0'], repository)).result, 2);
});
