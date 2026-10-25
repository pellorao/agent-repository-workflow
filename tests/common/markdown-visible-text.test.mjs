import assert from 'node:assert/strict';
import test from 'node:test';

import {parseMarkdownVisibleText} from '../../lib/common/markdown-visible-text.mjs';

const parse = (/** @type {import("buffer").WithImplicitCoercion<string>} */ text) => parseMarkdownVisibleText({
    bytes: Buffer.from(text, 'utf8'),
    path: 'docs/example.md',
});

test('Markdown Visible Text Module 提取可见自然语言并排除语法和代码', () => {
    const source = [
        '---',
        'title: Hidden frontmatter',
        '---',
        '# 说明 `hidden code`',
        '',
        '第一行 [ARW Artifact](https://example.invalid) 与 ![图片说明](image.png)',
        '第二行 **Main Agent**.',
        '',
        '> 引用文字',
        '',
        '| 列一 | 列二 |',
        '| --- | --- |',
        '| visible | `hidden cell` |',
        '| state | `exited | failed` |',
        '',
        '<!-- hidden comment -->',
        '<div class="hidden">HTML 正文</div>',
        '<https://example.invalid>',
        '<script>hidden script body</script>',
        '    hidden indented code',
        '```js',
        'hidden fenced code',
        '```',
        '',
    ].join('\n');

    const result = parse(source);

    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.flows.map(flow => flow.text), [
        '说明',
        '第一行 ARW Artifact 与 图片说明 第二行 Main Agent.',
        '引用文字',
        '列一',
        '列二',
        'visible',
        'state',
        'HTML 正文',
    ]);
    for (const flow of result.flows) assert.equal(flow.positions.length, Array.from(flow.text).length);
});

test('Markdown Visible Text Module 使用 Unicode code point column 并定位软换行', () => {
    const result = parse('# 😀名\n\n首行\n  次行\n');

    assert.deepEqual(result, {
        diagnostics: [],
        flows: [
            {
                kind: 'heading',
                positions: [
                    {column: 3, line: 1},
                    {column: 4, line: 1},
                ],
                text: '😀名',
            },
            {
                kind: 'body',
                positions: [
                    {column: 1, line: 3},
                    {column: 2, line: 3},
                    {column: 3, line: 4},
                    {column: 3, line: 4},
                    {column: 4, line: 4},
                ],
                text: '首行 次行',
            },
        ],
    });
});

test('Markdown Visible Text Module 允许 fenced code 在文档结尾结束并报告其他未闭合结构', () => {
    assert.deepEqual(parse('正文\n\n~~~js\nconst hidden = true;\n'), {
        diagnostics: [],
        flows: [{
            kind: 'body',
            positions: [
                {column: 1, line: 1},
                {column: 2, line: 1},
            ],
            text: '正文',
        }],
    });

    assert.deepEqual(parse('正文 `未闭合\n'), {
        diagnostics: [{code: 'malformed-markdown', column: 4, line: 1, path: 'docs/example.md'}],
        flows: [{
            kind: 'body',
            positions: [
                {column: 1, line: 1},
                {column: 2, line: 1},
            ],
            text: '正文',
        }],
    });
});

test('Markdown Visible Text Module 递归解释嵌套引用与列表容器', () => {
    const result = parse([
        '> - [nested-ref]: https://example.invalid',
        '>   "Workflow Distribution"',
        '> - Visible [nested][nested-ref]',
        '>   and [Workflow',
        '>   Distribution](https://example.invalid)',
        '> - ~~~js',
        '>   Workflow Distribution',
        '>   ~~~',
        '> >     Workflow Distribution',
        '> > Visible quote',
        '',
    ].join('\n'));

    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.flows.map(flow => flow.text), [
        'Visible nested and Workflow Distribution',
        'Visible quote',
    ]);
});
