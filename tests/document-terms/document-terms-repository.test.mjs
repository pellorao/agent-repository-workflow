import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {
    createTreeDocumentRepository,
    createWorkingTreeDocumentRepository,
    inspectDocumentDirectories,
} from '../../lib/document-terms/document-terms-repository.mjs';

const gitResult = (/** @type {string | Buffer} */ stdout, /** @type {number} */ code = 0) => ({
    code,
    failure: null,
    stderr: '',
    stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout, 'utf8'),
});

test('Document Terms tree Adapter 使用一次 inventory 和一次 batch blob 读取', async () => {
    const first = '1111111111111111111111111111111111111111';
    const second = '2222222222222222222222222222222222222222';
    /** @type {Array<{argv: string[], input?: Buffer | string}>} */
    const calls = [];
    const git = {
        /**
         * @param {{ argv: string[], input?: Buffer | string }} call
         */
        async run(call) {
            calls.push(call);
            if (call.argv[0] === 'ls-tree') {
                return gitResult(`100644 blob ${second}\tdocs/z.md\0` + `100644 blob ${first}\tdocs/a.md\0`);
            }
            assert.deepEqual(call.argv, ['cat-file', '--batch']);
            return gitResult(`${first} blob 4\n# A\n\n${second} blob 4\n# Z\n\n`);
        },
    };
    const repository = createTreeDocumentRepository({candidateTree: 'a'.repeat(40), git});

    assert.deepEqual(Object.keys(repository), ['listPaths', 'readEntries']);
    assert.deepEqual(await repository.listPaths(), ['docs/a.md', 'docs/z.md']);
    assert.deepEqual(await inspectDocumentDirectories({
        paths: ['.', 'docs', 'docs/a.md', 'missing'],
        repositoryRoot: 'unused',
        source: {kind: 'candidate-tree'},
        visiblePaths: ['docs/a.md', 'docs/z.md'],
    }), [
        {kind: 'directory', path: '.'},
        {kind: 'directory', path: 'docs'},
        {kind: 'unsupported', path: 'docs/a.md'},
        {kind: 'missing', path: 'missing'},
    ]);
    await assert.rejects(repository.readEntries(['docs/z.md', 'docs/a.md']), /sorted/u);
    await assert.rejects(repository.readEntries(['../docs/a.md']), /invalid/u);
    await assert.rejects(repository.readEntries(['docs/missing.md']), /inventory/u);
    assert.deepEqual(await repository.readEntries(['.arwignore']), [{kind: 'missing', path: '.arwignore'}]);
    assert.deepEqual((await repository.readEntries(['docs/a.md', 'docs/z.md'])).map(entry => entry.kind), ['file', 'file']);
    assert.equal(calls.length, 2);
});

test('Document Terms tree Adapter 接受含换行 path 并拒绝截断 inventory', async () => {
    const objectId = '1111111111111111111111111111111111111111';
    const path = 'docs/line\nbreak.md';
    const repository = createTreeDocumentRepository({
        candidateTree: 'a'.repeat(40),
        git: {
            /**
             * @param {{ argv: string[]; }} call
             */
            async run(call) {
                return call.argv[0] === 'ls-tree'
                    ? gitResult(`100644 blob ${objectId}\t${path}\0`)
                    : gitResult(`${objectId} blob 4\n# A\n\n`);
            },
        },
    });

    assert.deepEqual(await repository.listPaths(), [path]);
    assert.deepEqual(await repository.readEntries([path]), [
        {bytes: Buffer.from('# A\n'), kind: 'file', mode: '100644', path},
    ]);

    for (const stdout of [
        `100644 blob ${objectId}\tdocs/a.md`,
        `100644 blob ${objectId}\tdocs/a.md\0\0`,
    ]) {
        const malformed = createTreeDocumentRepository({
            candidateTree: 'a'.repeat(40),
            git: {async run() { return gitResult(stdout); }},
        });
        await assert.rejects(malformed.listPaths(), /invalid entry/u);
    }
});

test('Document Terms tree Adapter 要求 batch blob 响应与请求逐项对应', async () => {
    const first = '1111111111111111111111111111111111111111';
    const second = '2222222222222222222222222222222222222222';
    const record = (/** @type {string} */ objectId, /** @type {string} */ value) => `${objectId} blob 1\n${value}\n`;
    const outputs = [
        '',
        record(first, 'A'),
        `${record(first, 'A')}${record(first, 'A')}`,
        `${record(second, 'B')}${record(first, 'A')}`,
        `${record(first, 'A')}${record(second, 'B')}${record(first, 'A')}`,
    ];

    for (const stdout of outputs) {
        const repository = createTreeDocumentRepository({
            candidateTree: 'a'.repeat(40),
            git: {
                /**
                 * @param {{ argv: string[]; }} call
                 */
                async run(call) {
                    return call.argv[0] === 'ls-tree'
                        ? gitResult(`100644 blob ${first}\tdocs/a.md\0` + `100644 blob ${second}\tdocs/b.md\0`)
                        : gitResult(stdout);
                },
            },
        });
        assert.deepEqual(await repository.listPaths(), ['docs/a.md', 'docs/b.md']);
        await assert.rejects(repository.readEntries(['docs/a.md', 'docs/b.md']), /Git blob/u);
    }
});

test('Document Terms working-tree Adapter 在排序前拒绝重复 inventory path', async () => {
    const git = {
        /**
         * @param {{ argv: string[]; }} call
         */
        async run(call) {
            if (call.argv[0] === 'ls-files') return gitResult('docs/a.md\0docs/a.md\0');
            return gitResult('');
        },
    };
    const repository = createWorkingTreeDocumentRepository({git, repositoryRoot: 'unused'});

    await assert.rejects(repository.listPaths(), /invalid/u);
});

test('Document Terms working-tree Adapter 隔离 symbolic link 和 unreadable entry', async () => {
    const git = {
        /**
         * @param {{ argv: string[]; }} call
         */
        async run(call) {
            if (call.argv[0] === 'ls-files') return gitResult('docs/link.md\0docs/unreadable.md\0');
            return gitResult('');
        },
    };
    let parentObservations = 0;
    const filesystem = {
        /**
         * @param {string} path
         */
        async lstat(path) {
            if (path.endsWith('docs')) {
                parentObservations += 1;
                return {
                    isDirectory: () => true,
                    isFile: () => false,
                    isSymbolicLink: () => false,
                    mode: 0,
                };
            }
            return path.endsWith('link.md')
                ? {isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true, mode: 0}
                : {isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false, mode: 0};
        },
        async readFile() {
            throw new Error('unreadable');
        },
    };
    const repository = createWorkingTreeDocumentRepository({filesystem, git, repositoryRoot: 'unused'});

    assert.deepEqual(await repository.listPaths(), ['docs/link.md', 'docs/unreadable.md']);
    assert.deepEqual(await repository.readEntries(['docs/link.md', 'docs/unreadable.md']), [
        {kind: 'symbolic-link', path: 'docs/link.md'},
        {kind: 'unreadable', path: 'docs/unreadable.md'},
    ]);
    assert.equal(parentObservations, 1);
});

test('Document Terms directory inspector 要求 working-tree include 目录可读且可进入', async () => {
    const directoryStats = {
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
        mode: 0,
    };
    const filesystem = {
        async access() { throw new Error('permission denied'); },
        async lstat() { return directoryStats; },
        async readFile() { return Buffer.alloc(0); },
    };

    assert.deepEqual(await inspectDocumentDirectories({
        filesystem,
        paths: ['blocked'],
        repositoryRoot: 'unused',
        source: {kind: 'working-tree'},
        visiblePaths: [],
    }), [{kind: 'unreadable', path: 'blocked'}]);
});

test('Document Terms working-tree Adapter 拒绝由 symbolic link parent 解析的 path', async () => {
    const git = {
        /**
         * @param {{ argv: string[]; }} call
         */
        async run(call) {
            if (call.argv[0] === 'ls-files') return gitResult('docs/a.md\0');
            return gitResult('');
        },
    };
    let read = false;
    const filesystem = {
        /**
         * @param {string} path
         */
        async lstat(path) {
            if (path.endsWith('docs')) return {
                isDirectory: () => false,
                isFile: () => false,
                isSymbolicLink: () => true,
                mode: 0,
            };
            return {isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false, mode: 0};
        },
        async readFile() {
            read = true;
            return Buffer.from('# Outside\n');
        },
    };
    const repository = createWorkingTreeDocumentRepository({filesystem, git, repositoryRoot: 'unused'});

    assert.deepEqual(await repository.listPaths(), ['docs/a.md']);
    assert.deepEqual(await repository.readEntries(['docs/a.md']), [
        {kind: 'symbolic-link', path: 'docs/a.md'},
    ]);
    assert.equal(read, false);
});

test('Document Terms tree Adapter 隔离 missing blob 并保留其他可信 entry', async () => {
    const missing = '1111111111111111111111111111111111111111';
    const present = '2222222222222222222222222222222222222222';
    const git = {
        /**
         * @param {{ argv: string[]; }} call
         */
        async run(call) {
            if (call.argv[0] === 'ls-tree') {
                return gitResult(`100644 blob ${missing}\tdocs/a.md\0` + `100644 blob ${present}\tdocs/z.md\0`);
            }
            return gitResult(`${missing} missing\n${present} blob 4\n# Z\n\n`);
        },
    };
    const repository = createTreeDocumentRepository({candidateTree: 'a'.repeat(40), git});

    assert.deepEqual(await repository.listPaths(), ['docs/a.md', 'docs/z.md']);
    assert.deepEqual(await repository.readEntries(['docs/a.md', 'docs/z.md']), [
        {kind: 'unreadable', path: 'docs/a.md'},
        {bytes: Buffer.from('# Z\n'), kind: 'file', mode: '100644', path: 'docs/z.md'},
    ]);
});

test('Document Terms tree Adapter 分类 symbolic link, gitlink 和隐含 required directory', async () => {
    const link = '1111111111111111111111111111111111111111';
    const gitlink = '2222222222222222222222222222222222222222';
    const child = '3333333333333333333333333333333333333333';
    const git = {
        /**
         * @param {{ argv: string[]; }} call
         */
        async run(call) {
            if (call.argv[0] === 'ls-tree') return gitResult(
                `120000 blob ${link}\tdocs/link.md\0`
                + `160000 commit ${gitlink}\tdocs/submodule\0`
                + `100644 blob ${child}\t.arwignore/policy.txt\0`,
            );
            return gitResult('');
        },
    };
    const repository = createTreeDocumentRepository({candidateTree: 'a'.repeat(40), git});

    assert.deepEqual(await repository.listPaths(), ['.arwignore/policy.txt', 'docs/link.md', 'docs/submodule']);
    assert.deepEqual(await repository.readEntries(['.arwignore', 'docs/link.md', 'docs/submodule']), [
        {kind: 'unsupported', path: '.arwignore'},
        {kind: 'symbolic-link', path: 'docs/link.md'},
        {kind: 'unsupported', path: 'docs/submodule'},
    ]);
});
