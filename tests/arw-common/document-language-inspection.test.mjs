import assert from 'node:assert/strict';
import {mkdir, symlink, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import test from 'node:test';

import {inspectDocumentLanguages} from '../../lib/arw-common/document-language-inspection.mjs';
import {createRepository} from '../helpers/repository-fixture.mjs';

test('Document Language Inspection 展开多个目录并包含 Git 范围外 Markdown', async t => {
    const repository = await createRepository(t);
    await mkdir(resolve(repository, 'inputs/nested'), {recursive: true});
    await mkdir(resolve(repository, '.scratch/current'), {recursive: true});
    await mkdir(resolve(repository, 'docs/licenses/arw'), {recursive: true});
    await writeFile(resolve(repository, 'inputs/a.md'), '# English heading\n\n中文 English.\n', 'utf8');
    await writeFile(resolve(repository, 'inputs/crlf.md'), Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('English heading\r\n===============\r\n\r\n中文正文\r\n'),
    ]));
    await writeFile(resolve(repository, 'inputs/ignored.md'), 'Ignored English.\n', 'utf8');
    await writeFile(resolve(repository, 'inputs/malformed.md'), '正文 `未闭合\n', 'utf8');
    await writeFile(resolve(repository, 'inputs/nested/empty.md'), '# Heading only\n', 'utf8');
    await writeFile(resolve(repository, '.gitignore'), 'inputs/ignored.md\n', 'utf8');
    await writeFile(resolve(repository, '.scratch/current/work.md'), '草稿\n', 'utf8');
    await writeFile(resolve(repository, 'docs/licenses/arw/LICENSE.md'), 'License text.\n', 'utf8');
    await writeFile(resolve(repository, '.git/hidden.md'), 'Hidden.\n', 'utf8');

    const result = await inspectDocumentLanguages({
        paths: ['inputs', 'inputs/nested', 'inputs/a.md', '.scratch', 'docs/licenses', '.git'],
        repositoryRoot: repository,
    });

    assert.deepEqual(result, {
        diagnostics: [],
        rows: [
            {chinese: 100, english: 0, other: 0, path: '.scratch/current/work.md'},
            {chinese: 0, english: 100, other: 0, path: 'docs/licenses/arw/LICENSE.md'},
            {chinese: 36.4, english: 63.6, other: 0, path: 'inputs/a.md'},
            {chinese: 100, english: 0, other: 0, path: 'inputs/crlf.md'},
            {chinese: 0, english: 100, other: 0, path: 'inputs/ignored.md'},
            {chinese: 100, english: 0, other: 0, path: 'inputs/malformed.md'},
            {chinese: null, english: null, other: null, path: 'inputs/nested/empty.md'},
        ],
        status: 'passed',
    });
});

test('Document Language Inspection 不跟随目录中的 symlink 并拒绝显式 symlink', async t => {
    const repository = await createRepository(t);
    await mkdir(resolve(repository, 'inputs'), {recursive: true});
    await writeFile(resolve(repository, 'outside.md'), 'English.\n', 'utf8');
    await symlink('../outside.md', resolve(repository, 'inputs/link.md'));
    await writeFile(resolve(repository, 'inputs/kept.md'), '中文.\n', 'utf8');

    const directory = await inspectDocumentLanguages({paths: ['inputs'], repositoryRoot: repository});
    assert.deepEqual(directory.rows, [{chinese: 100, english: 0, other: 0, path: 'inputs/kept.md'}]);

    const explicit = await inspectDocumentLanguages({paths: ['inputs/link.md'], repositoryRoot: repository});
    assert.equal(explicit.status, 'failed');
    assert.deepEqual(explicit.rows, []);
    assert.equal(explicit.diagnostics[0].code, 'language-inspection-path-invalid');
});

test('Document Language Inspection 先验证全部输入且失败时不返回部分表格', async t => {
    const repository = await createRepository(t);
    await writeFile(resolve(repository, 'valid.md'), 'English.\n', 'utf8');
    await writeFile(resolve(repository, 'invalid.md'), Buffer.from([0xff]));
    await writeFile(resolve(repository, 'binary.md'), Buffer.from([0]));
    await writeFile(resolve(repository, 'notes.txt'), 'Not Markdown.\n', 'utf8');

    for (const paths of [
        ['valid.md', 'missing.md'],
        ['valid.md', 'invalid.md'],
        ['valid.md', 'binary.md'],
        ['valid.md', '../escape.md'],
        ['valid.md', 'notes.txt'],
    ]) {
        const result = await inspectDocumentLanguages({paths, repositoryRoot: repository});
        assert.equal(result.status, 'failed');
        assert.deepEqual(result.rows, []);
    }
});

test('Document Language Inspection 对空目录返回失败', async t => {
    const repository = await createRepository(t);
    await mkdir(resolve(repository, 'empty'));
    const result = await inspectDocumentLanguages({paths: ['empty'], repositoryRoot: repository});
    assert.deepEqual(result, {
        diagnostics: [{
            code: 'language-inspection-empty-selection',
            message: 'The supplied directories contain no regular Markdown files.',
            path: '.',
        }],
        rows: [],
        status: 'failed',
    });
});
