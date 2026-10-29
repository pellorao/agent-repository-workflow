import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';

import {deriveEffortStart} from '../../lib/arw-common/effort-start.mjs';
import {createNodeGitRunner} from '../../lib/common/git-process.mjs';
import {commitAll, runGit} from '../helpers/git.mjs';
import {createRepository} from '../helpers/repository-fixture.mjs';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const head = async (/** @type {string} */ root) => (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
const write = async (/** @type {string} */ root, /** @type {string} */ path) => {
    await mkdir(join(root, path, '..'), {recursive: true});
    await writeFile(join(root, path), `${path}\n`, 'utf8');
};

test('effort start is the parent of the earliest effort commit, the empty tree for a root commit, or base for an uncommitted effort', async t => {
    const root = await createRepository(t, {initialCommit: true});
    const git = createNodeGitRunner(root);
    const first = await head(root);
    assert.equal(await deriveEffortStart({base: first, effortNumber: '0003', git}), first);
    assert.equal(await deriveEffortStart({base: '', effortNumber: '0003', git}), EMPTY_TREE);

    await write(root, '.scratch/0003-work/spec.md');
    await commitAll(root, 'effort starts');
    await write(root, '.scratch/0003-work/issues/01-a.md');
    await write(root, '.scratch/0004-other/spec.md');
    await commitAll(root, 'later effort files');
    assert.equal(await deriveEffortStart({base: await head(root), effortNumber: '0003', git}), first);
    assert.equal(await deriveEffortStart({base: await head(root), effortNumber: '0004', git}), (await runGit(root, ['rev-parse', 'HEAD~1'])).stdout.trim());

    const rootCommit = await createRepository(t);
    await write(rootCommit, '.scratch/0003-work/spec.md');
    await commitAll(rootCommit, 'root commit holds the effort');
    assert.equal(await deriveEffortStart({base: await head(rootCommit), effortNumber: '0003', git: createNodeGitRunner(rootCommit)}), EMPTY_TREE);
});

test('effort start reports Git failures instead of choosing a range', async () => {
    const git = {run: async () => ({code: 128, failure: /** @type {null} */ (null), stderr: 'fatal: broken\n', stdout: Buffer.alloc(0)})};
    await assert.rejects(deriveEffortStart({base: 'abc', effortNumber: '0003', git}), /fatal: broken/u);
});
