import assert from 'node:assert/strict';
import {chmod, mkdir, readFile, readdir, rm, stat, symlink, writeFile} from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import timersPromises from 'node:timers/promises';
import {join, resolve} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {
    createScopedFilesystem,
    joinRelativePath,
    resolveAbsolutePathWithinScope,
    resolveRelativePathWithinScope,
} from '../../lib/common/filesystem.mjs';

test('Filesystem Module resolves relative and absolute paths within a scope without I/O', () => {
    const scope = resolve('missing-scope');
    const inside = resolve(scope, 'docs', 'inside.txt');
    assert.deepEqual(resolveRelativePathWithinScope({path: '.', scope}), {
        absolutePath: scope,
        diagnostics: [],
        relativePath: '',
        status: 'succeeded',
    });
    assert.deepEqual(resolveRelativePathWithinScope({path: 'draft/../docs/inside.txt', scope}), {
        absolutePath: inside,
        diagnostics: [],
        relativePath: join('docs', 'inside.txt'),
        status: 'succeeded',
    });
    assert.deepEqual(resolveAbsolutePathWithinScope({path: inside, scope}), {
        absolutePath: inside,
        diagnostics: [],
        relativePath: join('docs', 'inside.txt'),
        status: 'succeeded',
    });
    assert.deepEqual(
        resolveRelativePathWithinScope({path: '../outside', scope}).diagnostics.map(entry => entry.code),
        ['filesystem-path-escape'],
    );
    assert.deepEqual(
        resolveAbsolutePathWithinScope({path: resolve(scope, '..', 'outside'), scope}).diagnostics.map(entry => entry.code),
        ['filesystem-path-escape'],
    );
    assert.throws(() => resolveRelativePathWithinScope({path: inside, scope}), TypeError);
    assert.throws(() => resolveAbsolutePathWithinScope({path: 'docs/inside.txt', scope}), TypeError);
    assert.throws(() => resolveRelativePathWithinScope({path: 'docs/inside.txt', scope: 'relative'}), TypeError);
    assert.throws(() => resolveRelativePathWithinScope({path: 'docs/\0inside.txt', scope}), TypeError);
    assert.throws(() => resolveAbsolutePathWithinScope({path: `${scope}\0inside.txt`, scope}), TypeError);
});

test('Filesystem Module scopes reads and rejects traversal without touching outside files', async t => {
    const root = await createTemporaryDirectory(t, 'arw-filesystem-');
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'docs', 'inside.txt'), 'inside\n');
    const created = await createScopedFilesystem({root});
    assert.equal(created.status, 'succeeded');
    if (created.status !== 'succeeded') assert.fail('Filesystem creation must succeed.');
    const {scopedFilesystem} = created;
    assert.deepEqual(scopedFilesystem.resolve({path: 'nested/../replace.txt'}), {
        absolutePath: join(root, 'replace.txt'),
        diagnostics: [],
        relativePath: 'replace.txt',
        status: 'succeeded',
    });
    const read = await scopedFilesystem.read({path: 'docs/inside.txt'});
    assert.equal(read.status, 'succeeded');
    if (read.status !== 'succeeded' || read.bytes === undefined) assert.fail('Filesystem read must succeed with bytes.');
    assert.equal(read.bytes.toString('utf8'), 'inside\n');
    assert.deepEqual((await scopedFilesystem.inspect({path: '../outside'})).diagnostics.map(entry => entry.code), ['filesystem-path-escape']);
    assert.deepEqual(await scopedFilesystem.list({path: '.', recursive: true}), {
        diagnostics: [],
        entries: [
            {kind: 'directory', path: 'docs'},
            {kind: 'file', path: 'docs/inside.txt'},
        ],
        status: 'succeeded',
    });

    const createdAtomically = await scopedFilesystem.write({
        bytes: Buffer.from('atomic\n'),
        mode: 'create-atomic',
        path: 'docs/atomic.txt',
    });
    assert.equal(createdAtomically.status, 'succeeded');
    assert.deepEqual(
        (await scopedFilesystem.write({bytes: Buffer.from('collision'), mode: 'create-atomic', path: 'docs/atomic.txt'}))
            .diagnostics.map(entry => entry.code),
        ['filesystem-create-collision'],
    );
    assert.equal(await readFile(join(root, 'docs', 'atomic.txt'), 'utf8'), 'atomic\n');
    assert.equal((await scopedFilesystem.setMode({mode: 0o600, path: 'docs/atomic.txt'})).status, 'succeeded');

    assert.equal((await scopedFilesystem.createDirectory({path: 'docs/empty'})).status, 'succeeded');
    assert.deepEqual(await scopedFilesystem.remove({path: 'docs/empty'}), {
        diagnostics: [],
        path: 'docs/empty',
        removed: true,
        status: 'succeeded',
    });
    assert.deepEqual(
        (await scopedFilesystem.remove({path: 'docs'})).diagnostics.map(entry => entry.code),
        ['filesystem-directory-not-empty'],
    );
    assert.deepEqual(
        (await scopedFilesystem.remove({path: '.', recursive: true})).diagnostics.map(entry => entry.code),
        ['filesystem-path-unsafe'],
    );
    assert.equal((await scopedFilesystem.inspect({path: 'docs/inside.txt'})).status, 'succeeded');
});

test('Filesystem replacement checks the prepared temporary file before publishing and preserves the original on rejection', async t => {
    const root = await createTemporaryDirectory(t, 'arw-filesystem-replace-check-');
    const target = join(root, 'catalog.json');
    await writeFile(target, 'original\n');
    await chmod(target, 0o660);
    const mode = (await stat(target)).mode & 0o7777;
    const created = await createScopedFilesystem({root});
    if (created.status !== 'succeeded') assert.fail('Filesystem creation must succeed.');
    let checks = 0;
    const checkPrepared = async () => {
        checks += 1;
        assert.equal(await readFile(target, 'utf8'), 'original\n');
        assert.equal((await stat(target)).mode & 0o7777, mode);
        const temporaryFiles = (await readdir(root)).filter(name => name !== 'catalog.json');
        assert.equal(temporaryFiles.length, 1);
        const temporary = join(root, temporaryFiles[0]);
        assert.equal(await readFile(temporary, 'utf8'), 'replacement\n');
        assert.equal((await stat(temporary)).mode & 0o7777, mode);
    };
    const rejected = await created.scopedFilesystem.write({
        bytes: Buffer.from('replacement\n'), fileMode: mode, mode: 'replace', path: 'catalog.json',
        async beforeReplace() {
            await checkPrepared();
            throw new Error('Target changed after preparation.');
        },
    });
    assert.equal(rejected.status, 'failed');
    if (rejected.status !== 'failed') assert.fail('The failed precondition must reject replacement.');
    assert.equal(rejected.stage, 'file-replace');
    assert.equal(rejected.diagnostics[0].message, 'Target changed after preparation.');
    assert.equal(checks, 1);
    assert.equal(await readFile(target, 'utf8'), 'original\n');
    assert.equal((await stat(target)).mode & 0o7777, mode);
    assert.deepEqual(await readdir(root), ['catalog.json']);

    const published = await created.scopedFilesystem.write({
        bytes: Buffer.from('replacement\n'), fileMode: mode, mode: 'replace', path: 'catalog.json',
        beforeReplace: checkPrepared,
    });
    assert.equal(published.status, 'succeeded');
    assert.equal(checks, 2);
    assert.equal(await readFile(target, 'utf8'), 'replacement\n');
    assert.equal((await stat(target)).mode & 0o7777, mode);
    assert.deepEqual(await readdir(root), ['catalog.json']);
});

test('Filesystem Module rejects target and ancestor links and revalidates after missing-prefix creation', async t => {
    const directory = await createTemporaryDirectory(t, 'arw-filesystem-links-');
    const root = join(directory, 'scope');
    const outside = join(directory, 'outside');
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, 'outside.txt'), 'outside\n');
    await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');

    const created = await createScopedFilesystem({root});
    if (created.status !== 'succeeded') assert.fail('Filesystem creation must succeed.');
    assert.deepEqual(
        (await created.scopedFilesystem.inspect({path: 'linked'})).diagnostics.map(entry => entry.code),
        ['filesystem-link-unsupported'],
    );
    assert.deepEqual(
        (await created.scopedFilesystem.read({path: 'linked/outside.txt'})).diagnostics.map(entry => entry.code),
        ['filesystem-link-unsupported'],
    );
    const removed = await created.scopedFilesystem.remove({path: 'linked', recursive: false});
    assert.deepEqual(removed.diagnostics.map(entry => entry.code), ['filesystem-link-unsupported']);
    assert.equal(await readFile(join(outside, 'outside.txt'), 'utf8'), 'outside\n');
    assert.deepEqual(await created.scopedFilesystem.list({path: '.', recursive: true}), {
        diagnostics: [],
        entries: [{kind: 'link', path: 'linked'}],
        status: 'succeeded',
    });

    assert.equal((await created.scopedFilesystem.write({
        bytes: Buffer.from('inside\n'),
        mode: 'create',
        path: 'created/deep/inside.txt',
    })).status, 'succeeded');
    await rm(join(root, 'created'), {recursive: true});
    await symlink(outside, join(root, 'created'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.deepEqual(
        (await created.scopedFilesystem.read({path: 'created/outside.txt'})).diagnostics.map(entry => entry.code),
        ['filesystem-link-unsupported'],
    );
});

test('Filesystem Module joins logical paths and makes lossy UTF-8 decoding explicit', async t => {
    assert.equal(joinRelativePath('distribution/', 'baseline/agents.md'), 'distribution/baseline/agents.md');
    assert.equal(joinRelativePath('distribution//', 'baseline//agents.md/'), 'distribution/baseline/agents.md');
    assert.equal(joinRelativePath('distribution', '../outside'), 'outside');
    assert.throws(() => joinRelativePath(), TypeError);

    const root = await createTemporaryDirectory(t, 'arw-filesystem-text-');
    await writeFile(join(root, 'invalid.txt'), Buffer.from([0x66, 0x80]));
    const created = await createScopedFilesystem({root});
    if (created.status !== 'succeeded') assert.fail('Filesystem creation must succeed.');

    const strict = await created.scopedFilesystem.readText({
        allowLossyDecoding: false,
        path: 'invalid.txt',
    });
    assert.equal(strict.status, 'blocked');
    assert.deepEqual(strict.diagnostics.map(entry => entry.code), ['filesystem-text-decoding-failed']);

    const lossy = await created.scopedFilesystem.readText({
        allowLossyDecoding: true,
        path: 'invalid.txt',
    });
    assert.equal(lossy.status, 'succeeded');
    if (lossy.status !== 'succeeded') assert.fail('Lossy decoding must succeed when explicitly allowed.');
    assert.equal(lossy.text, 'f\ufffd');
});

test('Filesystem enumeration reports unrepresentable root and nested names as failures', {skip: process.platform === 'win32'}, async t => {
    const root = await createTemporaryDirectory(t, 'arw-enumeration-');
    await mkdir(join(root, 'nested'));
    const opened = await createScopedFilesystem({root});
    if (opened.status !== 'succeeded') assert.fail('Filesystem must open.');
    for (const path of ['bad\\name', 'nested/bad\\name']) {
        await writeFile(join(root, path), 'content');
        const result = await opened.scopedFilesystem.list({path: '.', recursive: true});
        assert.equal(result.status, 'failed');
        if (result.status !== 'failed') assert.fail('Enumeration must fail.');
        assert.equal(result.stage, 'enumerate');
        assert.equal(result.diagnostics[0].code, 'filesystem-io-failed');
        await rm(join(root, path));
    }
});

/** 以 `platform` 运行替换写入; rename 依次抛出 `codes` 中的错误码 (空串表示成功), 超出则成功; 退避等待不真正等待. */
const replaceWithRenameFailures = async (/** @type {import('node:test').TestContext} */ t, /** @type {string} */ platform, /** @type {string[]} */ codes) => {
    const root = await createTemporaryDirectory(t, 'arw-filesystem-rename-retry-');
    await writeFile(join(root, 'manifest.json'), 'original\n');
    const created = await createScopedFilesystem({root});
    if (created.status !== 'succeeded') assert.fail('Filesystem creation must succeed.');
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    const realRename = fsPromises.rename;
    /** @type {number[]} */
    const delays = [];
    let calls = 0;
    t.mock.method(fsPromises, 'rename', async (/** @type {string} */ from, /** @type {string} */ to) => {
        const code = codes[calls];
        calls += 1;
        if (code) throw Object.assign(new Error(`${code}: simulated, rename`), {code});
        return realRename(from, to);
    });
    t.mock.method(timersPromises, 'setTimeout', async (/** @type {number} */ delay) => { delays.push(delay); });
    syncBuiltinESMExports();
    Object.defineProperty(process, 'platform', {value: platform});
    try {
        const result = await created.scopedFilesystem.write({bytes: Buffer.from('replacement\n'), mode: 'replace', path: 'manifest.json'});
        const content = await readFile(join(root, 'manifest.json'), 'utf8');
        return {calls, content, delays, files: await readdir(root), result};
    } finally {
        Object.defineProperty(process, 'platform', /** @type {PropertyDescriptor} */ (platformDescriptor));
        t.mock.restoreAll();
        syncBuiltinESMExports();
    }
};

test('Filesystem replacement retries a Windows rename that reports EPERM, EACCES or EBUSY and then succeeds', async t => {
    const {calls, content, delays, files, result} = await replaceWithRenameFailures(t, 'win32', ['EPERM', 'EACCES', 'EBUSY']);
    assert.equal(result.status, 'succeeded');
    assert.equal(calls, 4);
    assert.deepEqual(delays, [50, 100, 200]);
    assert.equal(content, 'replacement\n');
    assert.deepEqual(files, ['manifest.json']);
});

test('Filesystem replacement returns the original Windows rename error once the bounded retries are exhausted', async t => {
    const {calls, content, delays, files, result} = await replaceWithRenameFailures(t, 'win32', Array(20).fill('EPERM'));
    assert.equal(result.status, 'failed');
    if (result.status !== 'failed') assert.fail('Persistent rename failure must fail the replacement.');
    assert.equal(result.stage, 'file-replace');
    assert.match(result.diagnostics[0].message, /^EPERM: simulated, rename/u);
    assert.equal(calls, delays.length + 1);
    assert.ok(delays.reduce((total, delay) => total + delay, 0) <= 5000);
    assert.equal(content, 'original\n');
    assert.deepEqual(files, ['manifest.json']);
});

test('Filesystem replacement does not retry on other platforms or for other error codes', async t => {
    for (const [platform, code] of [['linux', 'EPERM'], ['darwin', 'EBUSY'], ['win32', 'ENOENT']]) {
        const {calls, delays, result} = await replaceWithRenameFailures(t, platform, [code]);
        assert.equal(result.status, 'failed', `${platform} ${code}`);
        assert.equal(calls, 1, `${platform} ${code}`);
        assert.deepEqual(delays, [], `${platform} ${code}`);
    }
});


test('Filesystem replacement preserves existing permissions unless fileMode is explicit', {skip: process.platform === 'win32'}, async t => {
    const root = await createTemporaryDirectory(t, 'arw-filesystem-mode-');
    await writeFile(join(root, 'run.sh'), '#!/bin/sh\n', {mode: 0o755});
    const created = await createScopedFilesystem({root});
    assert.equal(created.status, 'succeeded');
    if (created.status !== 'succeeded') return;
    for (const [fileMode, expected] of [[undefined, 0o755], [0o640, 0o640]]) {
        const written = await created.scopedFilesystem.write({bytes: Buffer.from('updated\n'), fileMode, mode: 'replace', path: 'run.sh'});
        assert.equal(written.status, 'succeeded');
        assert.equal((await stat(join(root, 'run.sh'))).mode & 0o777, expected);
    }
});
