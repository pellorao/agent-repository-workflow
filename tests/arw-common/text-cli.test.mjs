import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {createRepository as createGitRepository} from '../helpers/repository-fixture.mjs';
import {parseCommand, runArw, UsageError} from '../../lib/arw.mjs';
import {createNodeTextPolicyFilesystem} from '../../lib/arw-common/text-policy.mjs';


const createRepository = async (/** @type {test.TestContext} */ t) => {
    const root = await createGitRepository(t, {prefix: 'arw-text-cli-'});
    const programDirectory = await createTemporaryDirectory(t, 'arw-text-program-');
    await mkdir(join(root, '.scratch'));
    await writeFile(join(root, '.arwignore'), '', 'utf8');
    await writeFile(join(programDirectory, 'config.json'), '{"configVersion":1,"editor":{"command":"code","args":["{file}"]}}', 'utf8');
    return {programDirectory, root};
};

const run = async (/** @type {string[]} */ args, /** @type {{programDirectory: string, root: string}} */ repository) => {
    /** @type {Array<{channel: 'stderr' | 'stdout', message: string}>} */
    const events = [];
    const result = await runArw(args, {
        ...repository,
        cwd: repository.root,
        stdout: (/** @type {string} */ message) => events.push({channel: 'stdout', message}),
        stderr: (/** @type {string} */ message) => events.push({channel: 'stderr', message}),
    });
    return {events, result};
};

test('text CLI 提供独立 check 和 fix 操作及稳定 exits', async t => {
    const repository = await createRepository(t);
    await writeFile(join(repository.root, 'bad.txt'), 'bad\r\n', 'utf8');

    const checked = await run(['text', 'check'], repository);
    assert.equal(checked.result, 1);
    assert.deepEqual(checked.events, [{
        channel: 'stderr',
        message: '[text-policy-violation] bad.txt: crlf.',
    }]);

    const fixed = await run(['text', 'fix'], repository);
    assert.equal(fixed.result, 0);
    assert.deepEqual(fixed.events, [{
        channel: 'stdout',
        message: 'Text fix completed. Changed: bad.txt. Checked 2 text file(s); skipped 0 binary file(s).',
    }]);
    assert.deepEqual(await readFile(join(repository.root, 'bad.txt')), Buffer.from('bad\n', 'utf8'));

    const repeated = await run(['text', 'fix'], repository);
    assert.deepEqual(repeated, {
        events: [{
            channel: 'stdout',
            message: 'Text fix passed. No changes. Checked 2 text file(s); skipped 0 binary file(s).',
        }],
        result: 0,
    });

    for (const args of [['text'], ['text', 'verify'], ['text', 'check', 'extra'], ['check'], ['verify'], ['check-integrity']]) {
        assert.throws(() => parseCommand(args), error => error instanceof UsageError && error.exitCode === 2);
    }
});

test('text CLI 报告 partial fix 并允许继续重试', async t => {
    const repository = await createRepository(t);
    for (const path of ['a.txt', 'b.txt', 'c.txt']) await writeFile(join(repository.root, path), 'bad\r\n', 'utf8');
    const baseFilesystem = createNodeTextPolicyFilesystem(repository.root);
    const replaceFileAtomically = baseFilesystem.replaceFileAtomically;
    if (replaceFileAtomically === undefined) throw new Error('Text policy filesystem must support replacement.');
    const filesystem = {
        ...baseFilesystem,
        async replaceFileAtomically(/** @type {Parameters<typeof replaceFileAtomically>[0]} */ input) {
            if (input.path === 'b.txt') throw Object.assign(new Error('injected failure'), {code: 'EIO'});
            return replaceFileAtomically(input);
        },
    };

    const failed = await runArw(['text', 'fix'], {
        cwd: repository.root,
        programDirectory: repository.programDirectory,
        stdout() {},
        stderr: (/** @type {unknown} */ message) => assert.equal(
            message,
            '[text-fix-partial] b.txt: io. Changed: a.txt. Unchanged: b.txt, c.txt. Inspect or restore changed paths from the Git index, then rerun arw text fix.',
        ),
        textPolicyDependencies: {filesystem},
    });
    assert.equal(failed, 1);
    assert.deepEqual(await readFile(join(repository.root, 'a.txt')), Buffer.from('bad\n', 'utf8'));
    assert.deepEqual(await readFile(join(repository.root, 'b.txt')), Buffer.from('bad\r\n', 'utf8'));

    const retried = await run(['text', 'fix'], repository);
    assert.equal(retried.result, 0);
    const retryEvent = retried.events[0];
    if (retryEvent === undefined) assert.fail('Retry must emit a completion event.');
    assert.match(retryEvent.message, /Changed: b\.txt, c\.txt\./);
});

test('text CLI 可逆转义动态路径', async t => {
    const repository = await createRepository(t);
    const result = await runArw(['text', 'check'], {
        cwd: repository.root,
        programDirectory: repository.programDirectory,
        stdout() {},
        stderr: (/** @type {unknown} */ message) => assert.equal(message, '[text-policy-violation] line\\nname.txt: crlf.'),
        textPolicyDependencies: {
            filesystem: {
                async inspectPath(/** @type {{path: string}} */ {path}) {
                    return {kind: path === '.arwignore' ? 'missing' : 'file', path};
                },
                async readBytes() {
                    return Buffer.from('bad\r\n', 'utf8');
                },
            },
            git: {
                async run(/** @type {{argv: string[]}} */ {argv}) {
                    return argv[0] === 'ls-files'
                        ? {code: 0, failure: null, stderr: '', stdout: Buffer.from('line\nname.txt\0', 'utf8')}
                        : {code: 1, failure: null, stderr: '', stdout: Buffer.alloc(0)};
                },
            },
        },
    });
    assert.equal(result, 1);
});
