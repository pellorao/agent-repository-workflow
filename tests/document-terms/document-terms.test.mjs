import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import test from 'node:test';
import {renderLanguageChecks} from '../../lib/arw-common/language-composition-presentation.mjs';

import {
    checkDocumentTerms,
    createDocumentTermsChecker,
} from '../../lib/document-terms/document-terms.mjs';
import {commitAll, runGit} from '../helpers/git.mjs';
import {createRepository as createGitRepository} from '../helpers/repository-fixture.mjs';

const repositoryRoot = resolve('document-terms-test-repository');
/** @type {{mode: 'immediate', source: {kind: 'working-tree'}}} */
const immediateRequest = {mode: 'immediate', source: {kind: 'working-tree'}};
/** @type {{mode: 'release', source: {kind: 'working-tree'}}} */
const releaseRequest = {mode: 'release', source: {kind: 'working-tree'}};

const validContext = (/** @type {{avoid?: string[], name?: string}} */ {avoid = [], name = 'Amber Compass'} = {}) => [
    '# Context',
    '',
    '## Language',
    '',
    '### Core',
    '',
    `**${name}**:`,
    `Definition for ${name}.`,
    ...(avoid.length === 0 ? [] : [`_Avoid_: ${avoid.join(', ')}`]),
    '',
].join('\n');

const entryFrom = (/** @type {string} */ path, /** @type {string | Buffer | {kind: 'missing' | 'symbolic-link' | 'unreadable' | 'unsupported'}} */ value) => typeof value === 'string' || Buffer.isBuffer(value)
    ? {bytes: Buffer.isBuffer(value) ? value : Buffer.from(value), kind: /** @type {'file'} */ ('file'), mode: '100644', path}
    : {...value, path};

const createRepository = (/** @type {Map<string, string | Buffer | {kind: 'missing' | 'symbolic-link' | 'unreadable' | 'unsupported'}>} */ contents) => {
    const calls = {list: 0, read: 0};
    return {
        calls,
        async inspectDirectories(/** @type {{paths: unknown}} */ {paths}) {
            assert.ok(Array.isArray(paths));
            return paths.map((/** @type {string} */ path) => {
                if (path === '.') return {kind: /** @type {'directory'} */ ('directory'), path};
                const exact = contents.get(path);
                if (exact !== undefined) return {
                    kind: /** @type {'symbolic-link' | 'unreadable' | 'unsupported'} */ (
                        typeof exact === 'object' && !Buffer.isBuffer(exact) ? exact.kind : 'unsupported'
                    ),
                    path,
                };
                return {
                    kind: /** @type {'directory' | 'missing'} */ (
                        [...contents.keys()].some(candidate => candidate.startsWith(`${path}/`)) ? 'directory' : 'missing'
                    ),
                    path,
                };
            });
        },
        repository: {
            async listPaths() {
                calls.list += 1;
                return [...contents.keys()].sort();
            },
            async readEntries(/** @type {unknown} */ paths) {
                calls.read += 1;
                assert.ok(Array.isArray(paths));
                return paths.map((/** @type {string} */ path) => contents.has(path)
                    ? entryFrom(path, /** @type {string | Buffer | {kind: 'missing' | 'symbolic-link' | 'unreadable' | 'unsupported'}} */ (contents.get(path)))
                    : {kind: /** @type {'missing'} */ ('missing'), path});
            },
        },
    };
};

const checkContents = async (/** @type {Array<[string, string | Buffer | {kind: 'missing' | 'symbolic-link' | 'unreadable' | 'unsupported'}]>} */ contents, /** @type {{include?: string[], mode: 'immediate' | 'release', source: {kind: 'working-tree'} | {candidateTree: string, kind: 'candidate-tree'}}} */ request = immediateRequest) => {
    const source = createRepository(new Map(contents));
    const check = createDocumentTermsChecker({
        inspectDirectories: input => source.inspectDirectories(input),
        openDocumentRepository: async () => source.repository,
    });
    return {result: await check({repositoryRoot, request}), source};
};

const assertClosedResult = (/** @type {Awaited<ReturnType<typeof checkDocumentTerms>>} */ result) => {
    assert.deepEqual(Object.keys(result).sort(), ['contexts', 'diagnostics', 'languageChecks', 'languageComposition', 'source', 'status']);
    assert.equal(['failed', 'passed'].includes(result.status), true);
    for (const context of result.contexts) {
        assert.deepEqual(Object.keys(context).sort(), ['context', 'diagnostics', 'status', 'summary']);
        assert.deepEqual(Object.keys(context.summary).sort(), ['diagnostics', 'documents', 'globalTerms', 'localTerms', 'uses']);
        assert.equal(context.summary.diagnostics, context.diagnostics.length);
    }
};

test('Document Terms preserves complete overlapping checks independently of presentation', async () => {
    const config = {configVersion: 2, languageChecks: {
        english: {language: 'english', minPercentage: 100, include: ['docs/']},
        chinese: {language: 'chinese', minPercentage: 80, include: ['docs/**/*.md']},
        empty: {language: 'english', minPercentage: 0, include: ['absent/']},
    }};
    const {result} = await checkContents([
        ['arw.config.json', JSON.stringify(config)], ['CONTEXT.md', '# Context\n\n## Language\n'],
        ['docs/a.md', '# Heading\n\nEnglish words.\n'], ['docs/empty.md', '# Heading\n'],
    ]);
    assert.equal(result.status, 'passed');
    assert.deepEqual(result.languageChecks.checks.map(check => check.summary), [
        {passed: 1, failed: 0, indeterminate: 1}, {passed: 0, failed: 1, indeterminate: 1}, {passed: 0, failed: 0, indeterminate: 0},
    ]);
    assert.deepEqual(result.languageChecks.uncovered, ['CONTEXT.md']);
    const before = structuredClone(result);
    const concise = renderLanguageChecks(result);
    const verbose = renderLanguageChecks(result, {verbose: true});
    assert.equal(concise.split('docs/a.md').length - 1, 1);
    assert.equal(verbose.split('docs/a.md').length - 1, 2);
    assert.match(concise, /No documents selected/);
    assert.match(concise, /indeterminate/);
    assert.deepEqual(result, before);
});

test('Document Terms Module 把 Repository 和完整 batch 失败关闭到顶层', async () => {
    for (const openDocumentRepository of [async () => null, async () => { throw new Error('unavailable'); }]) {
        const check = createDocumentTermsChecker({openDocumentRepository});
        assert.deepEqual(await check({repositoryRoot, request: immediateRequest}), {
            contexts: [],
            diagnostics: [{code: 'repository-read-failed', path: '.'}],
            languageComposition: [], languageChecks: {checks: [], status: 'unconfigured', uncovered: []},
            source: immediateRequest,
            status: 'failed',
        });
    }
    const check = createDocumentTermsChecker({openDocumentRepository: async () => ({
        async listPaths() { return ['CONTEXT.md']; },
        async readEntries(paths) {
            if (Array.isArray(paths) && paths.includes('.arwignore')) return [{kind: 'missing', path: '.arwignore'}];
            throw new Error('batch failed');
        },
    })});
    assert.deepEqual((await check({repositoryRoot, request: immediateRequest})).diagnostics, [{code: 'repository-read-failed', path: '.'}]);

    const invalidPolicy = await checkContents([
        ['.arwignore', '[z-a]\n'],
        ['CONTEXT.md', validContext()],
    ]);
    assert.deepEqual(invalidPolicy.result, {
        contexts: [],
        diagnostics: [{code: 'agent-scope-policy-invalid', path: '.arwignore'}],
        languageComposition: [], languageChecks: {checks: [], status: 'unconfigured', uncovered: []},
        source: immediateRequest,
        status: 'failed',
    });
});

test('Document Terms Module 按 map 声明顺序独立检查 sibling context', async () => {
    const map = '# Context map\n\n## Contexts\n\n- [Second](packages(v1)/CONTEXT.md) trailing prose\n- [First](./apps/CONTEXT.md)\n';
    const {result, source} = await checkContents([
        ['CONTEXT-MAP.md', map],
        ['apps/CONTEXT.md', validContext({name: 'App Name'})],
        ['apps/README.md', '# App\n\nApp Name.\n'],
        ['packages(v1)/CONTEXT.md', validContext({name: 'Package Name'})],
        ['packages(v1)/README.md', '# Package\n\nPackage Name.\n'],
        ['README.md', '# Root\n\napp name and package name are outside both scopes.\n'],
    ]);

    assert.deepEqual(result.contexts.map(context => context.context), ['packages(v1)/CONTEXT.md', 'apps/CONTEXT.md']);
    assert.deepEqual(result.contexts.map(context => context.summary.documents), [2, 2]);
    assert.deepEqual(result.contexts.map(context => context.summary.uses), [1, 1]);
    assert.deepEqual(result.languageComposition.map(row => row.path), [
        'CONTEXT-MAP.md',
        'apps/CONTEXT.md',
        'apps/README.md',
        'packages(v1)/CONTEXT.md',
        'packages(v1)/README.md',
    ]);
    assert.deepEqual(source.calls, {list: 1, read: 2});
});

test('Document Terms Module 即使 context 被通用范围规则排除也会读取 map 声明的术语表', async () => {
    const {result, source} = await checkContents([
        ['.arwignore', 'a/\n'],
        ['CONTEXT-MAP.md', '# Map\n\n## Contexts\n\n- [A](a/CONTEXT.md)\n'],
        ['a/CONTEXT.md', '# A\n\n## Language\n'],
        ['a/README.md', '# Ignored\n'],
    ]);

    assert.equal(result.status, 'passed');
    assert.deepEqual(result.contexts.map(context => context.context), ['a/CONTEXT.md']);
    assert.deepEqual(result.contexts[0].summary, {
        diagnostics: 0,
        documents: 1,
        globalTerms: 0,
        localTerms: 0,
        uses: 0,
    });
    assert.deepEqual(source.calls, {list: 1, read: 3});
});

test('Document Terms Module 对 nested context 的 include 保留重叠检查而不合并术语', async () => {
    const map = '# Map\n\n## Contexts\n\n- [Outer](a/CONTEXT.md)\n- [Inner](a/b/CONTEXT.md)\n';
    const {result} = await checkContents([
        ['CONTEXT-MAP.md', map],
        ['a/CONTEXT.md', validContext({name: 'Outer Name'})],
        ['a/README.md', '# Outer\n\nOuter Name.\n'],
        ['a/b/CONTEXT.md', validContext({name: 'Inner Name'})],
        ['a/b/README.md', '# Inner\n\nOuter Name and Inner Name.\n'],
    ], {...immediateRequest, include: ['a/b']});

    assert.deepEqual(result.contexts.map(context => context.summary.documents), [4, 2]);
    assert.deepEqual(result.contexts.map(context => context.summary.globalTerms), [1, 1]);
    assert.deepEqual(result.contexts.map(context => context.summary.uses), [2, 1]);
});

test('Document Terms Module 收集 map target findings 并阻止全部 context', async () => {
    const map = [
        '# Map', '', '## Contexts', '',
        '- [Valid](a/CONTEXT.md)',
        '- [Duplicate](./a/CONTEXT.md)',
        '- [Missing](missing/CONTEXT.md)',
        '- [Unsafe](../CONTEXT.md)',
        '- [Linked](linked/CONTEXT.md)',
        '',
    ].join('\n');
    const {result} = await checkContents([
        ['CONTEXT-MAP.md', map],
        ['a/CONTEXT.md', validContext()],
        ['linked/CONTEXT.md', {kind: 'symbolic-link'}],
    ]);

    assert.deepEqual(result.contexts, []);
    assert.deepEqual(result.diagnostics, [6, 7, 8, 9].map(line => ({
        code: 'context-map-invalid', column: 1, line, path: 'CONTEXT-MAP.md',
    })));
});

test('Document Terms Module 对缺失, 重复或含非列表内容的 Contexts section 返回结构 finding', async () => {
    for (const map of [
        '# Map\n',
        '# Map\n\n## Contexts\n',
        '# Map\n\n## Contexts\n\nordinary text\n',
        '# Map\n\n## Contexts\n\n- [A](a/CONTEXT.md)\n\n## Contexts\n\n- [B](b/CONTEXT.md)\n',
    ]) {
        const {result} = await checkContents([
            ['CONTEXT-MAP.md', map],
            ['a/CONTEXT.md', validContext()],
            ['b/CONTEXT.md', validContext()],
        ]);
        assert.deepEqual(result.diagnostics, [{code: 'context-map-invalid', path: 'CONTEXT-MAP.md'}]);
        assert.deepEqual(result.contexts, []);
    }
});

test('Document Terms Module 把单个来源失败隔离到每个适用 context', async () => {
    const map = '# Map\n\n## Contexts\n\n- [Outer](a/CONTEXT.md)\n- [Sibling](z/CONTEXT.md)\n';
    const {result} = await checkContents([
        ['CONTEXT-MAP.md', map],
        ['a/CONTEXT.md', validContext()],
        ['a/broken.md', {kind: 'unreadable'}],
        ['z/CONTEXT.md', validContext()],
        ['z/README.md', '# Z\n\nAmber Compass.\n'],
    ]);

    assert.deepEqual(result.contexts.map(context => context.status), ['failed', 'passed']);
    assert.deepEqual(result.contexts[0].diagnostics, [{code: 'source-read-failed', path: 'a/broken.md'}]);
    assert.deepEqual(result.contexts[1].diagnostics, []);
});

test('Document Terms Module 对无效局部术语章节只返回一项无位置结构 finding', async () => {
    for (const local of [
        '# Reader\n\n## Terms introduced in this document\n',
        '# Reader\n\n## Terms introduced in this document\n\n- **First Name**: First definition.\n\n## Terms introduced in this document\n\n- **Second Name**: Second definition.\n',
        'Status: stable\n\n## Terms introduced in this document\n\n- **Local Name**: Local definition.\n',
        '# Reader\n\n## Introduction\n\nVisible text.\n\n## Terms introduced in this document\n\n- **Local Name**: Local definition.\n',
    ]) {
        const {result} = await checkContents([
            ['CONTEXT.md', '# Context\n\n## Language\n'],
            ['README.md', local],
        ]);

        assert.deepEqual(result.contexts[0].diagnostics, [{code: 'local-terms-section-invalid', path: 'README.md'}]);
        assert.equal(result.contexts[0].summary.localTerms, 0);
    }
});

test('Document Terms Module 只在 release 模式执行通用文档保留门槛', async () => {
    /** @type {Array<[string, string]>} */
    const contents = [
        ['CONTEXT.md', validContext()],
        ['README.md', '# Reader\n\nAmber Compass. Amber Compass. Amber Compass.\n'],
        ['docs/guide.md', '# Guide\n\nAmber Compass. Amber Compass.\n'],
        ['nested/CONTEXT.md', '# Nested\n\nAmber Compass. Amber Compass. Amber Compass.\n'],
        ['nested/CONTEXT-MAP.md', '# Nested map\n\nAmber Compass. Amber Compass. Amber Compass.\n'],
        ['.scratch/work.md', '# Work\n\nAmber Compass. Amber Compass. Amber Compass.\n'],
    ];
    const immediate = (await checkContents(contents, immediateRequest)).result.contexts[0];
    const release = (await checkContents(contents, releaseRequest)).result.contexts[0];

    assert.deepEqual(immediate.diagnostics, []);
    assert.deepEqual(release.diagnostics, []);
    assert.equal(immediate.summary.documents, 5);
    assert.equal(release.summary.documents, 5);
    assert.equal(immediate.summary.uses, 11);
    assert.equal(release.summary.uses, 11);

    const insufficient = (await checkContents(contents.filter(([path]) => path !== 'docs/guide.md'), releaseRequest)).result.contexts[0];
    assert.deepEqual(insufficient.diagnostics.map(({code}) => code), ['global-term-use-insufficient']);

    const included = (await checkContents(contents, {...releaseRequest, include: ['./.scratch/']})).result.contexts[0];
    assert.deepEqual(included.diagnostics, []);
    assert.equal(included.summary.documents, 6);
    assert.equal(included.summary.uses, 14);
});

test('Document Terms Module 只用 include 重新加入选定 scratch 文档并保持通用排除', async () => {
    const request = {
        ...immediateRequest,
        include: ['./.scratch/current/', '.scratch/current', '.scratch/current/nested/'],
    };
    const {result} = await checkContents([
        ['.arwignore', '.scratch/current/ignored.md\n'],
        ['CONTEXT.md', '# Context\n\n## Language\n'],
        ['README.md', '# Reader\n'],
        ['.scratch/current/work.md', '# Work\n'],
        ['.scratch/current/nested/details.md', '# Details\n'],
        ['.scratch/current/ignored.md', '# Ignored\n'],
        ['.scratch/history/old.md', '# Old\n'],
    ], request);

    assert.equal(result.status, 'passed');
    assert.equal(result.contexts[0].summary.documents, 4);
    assert.deepEqual(result.source, request);
});

test('Document Terms Module 收集完整 include 失败集合并阻止 context 结果', async () => {
    const map = '# Map\n\n## Contexts\n\n- [A](a/CONTEXT.md)\n';
    const request = {
        ...immediateRequest,
        include: ['missing', 'file.md', 'linked', 'unreadable', 'outside', './missing/'],
    };
    const {result} = await checkContents([
        ['CONTEXT-MAP.md', map],
        ['a/CONTEXT.md', '# A\n\n## Language\n'],
        ['file.md', '# File\n'],
        ['linked', {kind: 'symbolic-link'}],
        ['unreadable', {kind: 'unreadable'}],
        ['outside/child.txt', 'ordinary'],
    ], request);

    assert.deepEqual(result.contexts, []);
    assert.deepEqual(result.diagnostics, [
        {code: 'include-directory-unsupported', path: 'file.md'},
        {code: 'include-directory-unsupported', path: 'linked'},
        {code: 'include-directory-missing', path: 'missing'},
        {code: 'include-directory-outside-context', path: 'outside'},
        {code: 'include-directory-unsupported', path: 'unreadable'},
    ]);
    assert.equal(result.status, 'failed');
});

test('Document Terms Module 在术语表发现失败时不产生 include finding', async () => {
    const {result} = await checkContents([
        ['README.md', '# Reader\n'],
    ], {...immediateRequest, include: ['missing']});

    assert.deepEqual(result.diagnostics, [{code: 'terms-glossary-missing', path: '.'}]);
});

test('Document Terms Module 不读取默认排除 scratch 中的 Markdown', async () => {
    const check = createDocumentTermsChecker({openDocumentRepository: async () => ({
        async listPaths() { return ['.scratch/broken.md', 'CONTEXT.md']; },
        async readEntries(paths) {
            assert.ok(Array.isArray(paths));
            if (paths.includes('.scratch/broken.md')) throw new Error('excluded blob must not be read');
            return paths.map(path => (path === '.arwignore' || path === 'arw.config.json')
                ? {kind: /** @type {'missing'} */ ('missing'), path}
                : entryFrom(path, '# Context\n\n## Language\n'));
        },
    })});

    const result = await check({repositoryRoot, request: immediateRequest});
    assert.equal(result.status, 'passed');
    assert.deepEqual(result.diagnostics, []);
});

test('Document Terms Module 接受 working tree 中没有适用 Markdown 的空 include 目录', async t => {
    const repositoryRoot = await createGitRepository(t, {prefix: 'arw-document-terms-empty-include-'});
    await mkdir(resolve(repositoryRoot, 'empty'), {recursive: true});
    await writeFile(resolve(repositoryRoot, 'CONTEXT.md'), '# Context\n\n## Language\n', 'utf8');
    const result = await checkDocumentTerms({
        repositoryRoot,
        request: {...immediateRequest, include: ['empty']},
    });
    assert.equal(result.status, 'passed');
    assert.equal(result.contexts[0].summary.documents, 1);
});

test('Document Terms Module 对绑定 candidate tree 忽略漂移 working tree', async t => {
    const repositoryRoot = await createGitRepository(t, {prefix: 'arw-document-terms-tree-'});
    await mkdir(resolve(repositoryRoot, 'docs'), {recursive: true});
    await writeFile(resolve(repositoryRoot, 'CONTEXT.md'), validContext(), 'utf8');
    await writeFile(resolve(repositoryRoot, 'README.md'), '# Reader\n\nAmber Compass. Amber Compass. Amber Compass.\n', 'utf8');
    await writeFile(resolve(repositoryRoot, 'docs/guide.md'), '# Guide\n\nAmber Compass. Amber Compass.\n', 'utf8');
    await writeFile(resolve(repositoryRoot, 'arw.config.json'), JSON.stringify({configVersion: 2, languageChecks: {candidate: {language: 'english', minPercentage: 100, include: ['**/*.md']}}}));
    await commitAll(repositoryRoot, 'candidate terms');
    const candidateTree = (await runGit(repositoryRoot, ['rev-parse', 'HEAD^{tree}'])).stdout.trim();

    await writeFile(resolve(repositoryRoot, 'README.md'), '# Reader\n\namber compass.\n', 'utf8');
    await writeFile(resolve(repositoryRoot, 'arw.config.json'), JSON.stringify({configVersion: 2, languageChecks: {working: {language: 'chinese', minPercentage: 80, include: ['**/*.md']}}}));
    /** @type {{mode: 'release', source: {candidateTree: string, kind: 'candidate-tree'}}} */
    const request = {mode: 'release', source: {candidateTree, kind: 'candidate-tree'}};
    const candidateResult = await checkDocumentTerms({repositoryRoot, request});
    const workingResult = await checkDocumentTerms({repositoryRoot, request: releaseRequest});

    assert.deepEqual(candidateResult.source, request);
    assert.equal(candidateResult.status, 'passed');
    assert.equal(candidateResult.languageChecks.checks[0].name, 'candidate');
    assert.equal(candidateResult.languageChecks.checks[0].summary.failed, 0);
    assert.equal(workingResult.languageChecks.checks[0].name, 'working');
    assert.ok(workingResult.languageChecks.checks[0].summary.failed > 0);
    assert.equal(workingResult.status, 'failed');
    assert.equal(workingResult.contexts[0].diagnostics.some(({code}) => code === 'term-spelling-invalid'), true);
});
