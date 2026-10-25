import assert from 'node:assert/strict';
import {unlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {runGit} from '../helpers/git.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {createRepository as createGitRepository} from '../helpers/repository-fixture.mjs';
import {
    collectGitVisiblePaths,
    executeTextPolicy,
    filterAgentManagedPaths,
    runTextPolicy,
} from '../../lib/arw-common/text-policy.mjs';
import {inspectTextBytes} from '../../lib/common/text-policy.mjs';

test('Text Policy Module 关闭式拒绝 Git path inventory 中的 invalid UTF-8', async () => {
    await assert.rejects(
        collectGitVisiblePaths({
            async run() {
                return {code: 0, failure: null, stderr: Buffer.alloc(0), stdout: Buffer.from([0xc3, 0x28, 0])};
            },
        }),
        /encoded as UTF-8/u,
    );
});

test('Text Policy Module 关闭式拒绝失败或截断的 Git path inventory', async () => {
    await assert.rejects(
        collectGitVisiblePaths({
            async run() {
                return {code: 1, failure: null, stderr: Buffer.alloc(0), stdout: Buffer.from('docs/a.md\0')};
            },
        }),
        /Git command failed/u,
    );

    for (const stdout of [Buffer.from('docs/a.md'), Buffer.from('docs/a.md\0\0')]) {
        await assert.rejects(
            collectGitVisiblePaths({
                async run() {
                    return {code: 0, failure: null, stderr: Buffer.alloc(0), stdout};
                },
            }),
            /inventory/u,
        );
    }
});

test('Text Policy Module 批量检查和修复精确目标', async () => {
    const files = [
        {bytes: Buffer.from('clean\n', 'utf8'), path: 'a-clean.txt'},
        {bytes: Buffer.from('bad\r\n', 'utf8'), path: 'b-crlf.txt'},
        {bytes: Buffer.from([0x00, 0x61]), path: 'c-binary.bin'},
    ];
    /** @type {{bytes: Buffer<ArrayBufferLike>, path: string}[]} */
    const writes = [];
    const filesystem = {
        /**
         * @param {{ path: string; bytes: Buffer<ArrayBufferLike>; }} input
         */
        async replaceFileAtomically(input) {
            writes.push(input);
            const file = files.find(entry => entry.path === input.path);
            assert.notEqual(file, undefined);
            if (file === undefined) throw new Error('Expected matching test file.');
            file.bytes = Buffer.from(input.bytes);
        },
    };

    assert.deepEqual(await executeTextPolicy({files: [], filesystem, intent: 'check'}), {
        changed: [],
        checked: 0,
        diagnostics: [],
        satisfied: true,
        skippedBinary: 0,
        unchanged: [],
    });

    const checked = await executeTextPolicy({files, filesystem, intent: 'check'});
    assert.deepEqual(checked, {
        changed: [],
        checked: 2,
        diagnostics: [{code: 'text-policy-violation', issues: ['crlf'], path: 'b-crlf.txt'}],
        satisfied: false,
        skippedBinary: 1,
        unchanged: ['b-crlf.txt'],
    });
    assert.deepEqual(writes, []);

    const fixed = await executeTextPolicy({files, filesystem, intent: 'fix'});
    assert.deepEqual(fixed, {
        changed: ['b-crlf.txt'],
        checked: 2,
        diagnostics: [],
        satisfied: true,
        skippedBinary: 1,
        unchanged: [],
    });
    assert.deepEqual(writes, [{bytes: Buffer.from('bad\n', 'utf8'), path: 'b-crlf.txt'}]);

    const repeated = await executeTextPolicy({files, filesystem, intent: 'fix'});
    assert.deepEqual(repeated.changed, []);
    assert.deepEqual(repeated.unchanged, []);
    assert.equal(repeated.satisfied, true);

    await assert.rejects(
        executeTextPolicy({files, filesystem, intent: 'fiz'}),
        /intent must be check or fix/u,
    );
    assert.deepEqual(writes, [{bytes: Buffer.from('bad\n', 'utf8'), path: 'b-crlf.txt'}]);
});

test('Text Policy Module 在 invalid UTF-8 时保持整个批次零写入', async () => {
    /** @type {{bytes: Buffer<ArrayBufferLike>, path: string}[]} */
    const writes = [];
    const result = await executeTextPolicy({
        files: [
            {bytes: Buffer.from([0xc3, 0x28]), path: 'z-invalid.txt'},
            {bytes: Buffer.from('bad\r\n', 'utf8'), path: 'a-fixable.txt'},
        ],
        filesystem: {async replaceFileAtomically(input) { writes.push(input); }},
        intent: 'fix',
    });

    assert.deepEqual(writes, []);
    assert.deepEqual(result, {
        changed: [],
        checked: 2,
        diagnostics: [{code: 'invalid-utf8', issues: ['invalid-utf8'], path: 'z-invalid.txt'}],
        satisfied: false,
        skippedBinary: 0,
        unchanged: ['a-fixable.txt'],
    });
});

test('Text Policy Module 报告 partial I/O failure 的精确恢复边界', async () => {
    /** @type {string[]} */
    const attempted = [];
    const result = await executeTextPolicy({
        files: ['c.txt', 'a.txt', 'b.txt'].map(path => ({bytes: Buffer.from('bad\r\n', 'utf8'), path})),
        filesystem: {
            async replaceFileAtomically({path}) {
                attempted.push(path);
                if (path === 'b.txt') throw Object.assign(new Error('injected failure'), {code: 'EIO'});
            },
        },
        intent: 'fix',
    });

    assert.deepEqual(attempted, ['a.txt', 'b.txt']);
    assert.deepEqual(result, {
        changed: ['a.txt'],
        checked: 3,
        diagnostics: [{
            cause: 'io',
            code: 'text-fix-partial',
            operation: 'replace-file-atomically',
            path: 'b.txt',
            remediation: 'Inspect or restore changed paths from the Git index, then rerun arw text fix.',
        }],
        satisfied: false,
        skippedBinary: 0,
        unchanged: ['b.txt', 'c.txt'],
    });
});

test('Text Policy Module 独立应用有序 .arwignore 规则', () => {
    const paths = [
        '#literal',
        'generated/drop.js',
        'generated/keep.js',
        'keep.txt',
        'nested/root.log',
        'nested/scratch.tmp',
        'root.log',
    ];
    const policy = [
        '# comment',
        'generated/**',
        '!generated/keep.js',
        '/root.log',
        '*.tmp',
        '\\#literal',
        '',
    ].join('\n');

    assert.deepEqual(filterAgentManagedPaths(paths, policy), [
        'generated/keep.js',
        'keep.txt',
        'nested/root.log',
    ]);
});

test('Text Policy Module 在当前主机收集 Agent-managed Scope', async t => {
    const root = await createGitRepository(t, {prefix: 'arw-text-policy-'});
    await writeFile(join(root, '.arwignore'), 'excluded.txt\n', 'utf8');
    await writeFile(join(root, '.gitignore'), 'ignored.txt\ntracked-ignored.txt\n', 'utf8');
    await writeFile(join(root, 'tracked.txt'), 'tracked\r\n', 'utf8');
    await writeFile(join(root, 'deleted.txt'), 'deleted\n', 'utf8');
    await writeFile(join(root, 'excluded.txt'), 'excluded\r\n', 'utf8');
    await writeFile(join(root, 'tracked-ignored.txt'), 'tracked ignored\r\n', 'utf8');
    await writeFile(join(root, 'binary.bin'), Buffer.from([0x00, 0x61]));
    await runGit(root, ['add', '.arwignore', '.gitignore', 'tracked.txt', 'deleted.txt', 'excluded.txt', 'binary.bin']);
    await runGit(root, ['add', '--force', 'tracked-ignored.txt']);
    await unlink(join(root, 'deleted.txt'));
    await writeFile(join(root, 'untracked.txt'), 'untracked\r\n', 'utf8');
    await writeFile(join(root, 'ignored.txt'), 'ignored\r\n', 'utf8');

    const result = await runTextPolicy({intent: 'check', repositoryRoot: root});

    assert.deepEqual(result, {
        changed: [],
        checked: 4,
        diagnostics: [
            {code: 'text-policy-violation', issues: ['crlf'], path: 'tracked.txt'},
            {code: 'text-policy-violation', issues: ['crlf'], path: 'untracked.txt'},
        ],
        satisfied: false,
        skippedBinary: 1,
        unchanged: ['tracked.txt', 'untracked.txt'],
    });
});

test('Text Policy Module 批量收集不同规模的 Git-visible inventory', async () => {
    const runCase = async (/** @type {number} */ count) => {
        let gitCalls = 0;
        const paths = Array.from({length: count}, (_value, index) => `file-${index}.txt`);
        const result = await runTextPolicy({
            filesystem: {
                async inspectPath({path}) {
                    return {kind: path === '.arwignore' ? 'missing' : 'file', path};
                },
                async readBytes() {
                    return Buffer.from('clean\n', 'utf8');
                },
            },
            git: {
                async run({argv}) {
                    gitCalls += 1;
                    return argv[0] === 'ls-files'
                        ? {code: 0, failure: null, stderr: '', stdout: Buffer.from(`${paths.join('\0')}\0`, 'utf8')}
                        : {code: 1, failure: null, stderr: '', stdout: Buffer.alloc(0)};
                },
            },
            intent: 'check',
            repositoryRoot: '.',
        });
        return {checked: result.checked, gitCalls};
    };

    assert.deepEqual(await runCase(1), {checked: 1, gitCalls: 2});
    assert.deepEqual(await runCase(40), {checked: 40, gitCalls: 2});
});
