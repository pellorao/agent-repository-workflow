import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {
    ADDITIONAL_SKILL_REFERENCES_FILE,
    SKILL_REFERENCE_NORMALIZATIONS_FILE,
    reviewSkillReferences,
} from '../../lib/workflow-distribution/skill-reference-review.mjs';

const candidates = {
    additionalSkillReferences: ['alpha', 'beta'],
    skillReferenceNormalizations: [
        {path: 'skills/alpha/SKILL.md', line: 1, column: 1, identity: 'alpha', context: '$alpha,'},
        {path: 'skills/beta/SKILL.md', line: 2, column: 3, identity: 'beta', context: '$beta.'},
    ],
};

const createWorkspace = async (/** @type {test.TestContext} */ t) => {
    const parent = await createTemporaryDirectory(t, 'arw-reference-review-');
    return join(parent, 'review');
};

const alphaLine = '{"path":"skills/alpha/SKILL.md","line":1,"column":1,"identity":"alpha","context":"$alpha,"}';
const betaLine = '{"path":"skills/beta/SKILL.md","line":2,"column":3,"identity":"beta","context":"$beta."}';
const review = (/** @type {string} */ workspaceDirectory, /** @type {Record<string, unknown>} */ extra = {}) => reviewSkillReferences({
    ...candidates,
    workspaceDirectory,
    ...extra,
});
const writeFiles = async (/** @type {string} */ workspaceDirectory, /** @type {string} */ additional, /** @type {string} */ normalizations) => {
    await writeFile(join(workspaceDirectory, ADDITIONAL_SKILL_REFERENCES_FILE), additional);
    await writeFile(join(workspaceDirectory, SKILL_REFERENCE_NORMALIZATIONS_FILE), normalizations);
};

test('reference review rejects normalization paths outside canonical Skill Markdown', async t => {
    const workspaceDirectory = await createWorkspace(t);
    await assert.rejects(() => reviewSkillReferences({
        additionalSkillReferences: [],
        skillReferenceNormalizations: [{column: 1, context: '$alpha', identity: 'alpha', line: 1, path: 'docs/example.md'}],
        workspaceDirectory,
    }), /skillReferenceNormalizations must be valid and sorted/);
});

test('reference review writes both full candidate files and returns their paths', async t => {
    const workspaceDirectory = await createWorkspace(t);
    const result = await review(workspaceDirectory);
    assert.equal(result.status, 'succeeded');
    assert.deepEqual('paths' in result && result.paths, [
        join(workspaceDirectory, ADDITIONAL_SKILL_REFERENCES_FILE),
        join(workspaceDirectory, SKILL_REFERENCE_NORMALIZATIONS_FILE),
    ]);
    assert.equal(await readFile(join(workspaceDirectory, ADDITIONAL_SKILL_REFERENCES_FILE), 'utf8'), 'alpha\nbeta\n');
    assert.equal(await readFile(join(workspaceDirectory, SKILL_REFERENCE_NORMALIZATIONS_FILE), 'utf8'), `${alphaLine}\n${betaLine}\n`);
});

test('reference review reports a candidate write failure', async t => {
    const workspaceDirectory = await createWorkspace(t);
    const result = await review(workspaceDirectory, {
        createFilesystem: async () => ({
            scopedFilesystem: {
                inspect: async () => ({entry: {kind: 'missing'}, status: 'succeeded'}),
                write: async () => ({diagnostics: [{code: 'disk-full', message: 'No space.'}], status: 'failed'}),
            },
            status: 'succeeded',
        }),
    });
    assert.equal(result.status, 'failed');
    assert.equal('stage' in result && result.stage, 'review-write');
});

test('complete accepts deletion-only results and unchanged files', async t => {
    const workspaceDirectory = await createWorkspace(t);
    await review(workspaceDirectory);
    const unchanged = await review(workspaceDirectory, {complete: true});
    assert.equal(unchanged.status, 'succeeded');
    assert.deepEqual('additionalSkillReferences' in unchanged && unchanged.additionalSkillReferences, ['alpha', 'beta']);

    await writeFiles(workspaceDirectory, 'alpha\n', `${alphaLine}\n`);
    const edited = await review(workspaceDirectory, {complete: true});
    assert.equal(edited.status, 'succeeded');
    assert.deepEqual('additionalSkillReferences' in edited && edited.additionalSkillReferences, ['alpha']);
    assert.deepEqual('skillReferenceNormalizations' in edited && edited.skillReferenceNormalizations.map(record => record.identity), ['alpha']);
});

test('complete blocks inserted, rewritten, reordered, or invalid lines', async t => {
    const workspaceDirectory = await createWorkspace(t);
    await review(workspaceDirectory);
    for (const [additional, normalizations] of [
        ['beta\nalpha\n', `${alphaLine}\n${betaLine}\n`],
        ['alpha\ngamma\n', `${alphaLine}\n${betaLine}\n`],
        ['alpha\nbeta\n', `${betaLine}\n${alphaLine}\n`],
        ['alpha\nbeta\n', `${alphaLine.replace('"line":1', '"line":9')}\n`],
        ['alpha\nbeta\n', `${alphaLine}\nnot json\n`],
        ['alpha\nbeta', `${alphaLine}\n`],
    ]) {
        await writeFiles(workspaceDirectory, additional, normalizations);
        const result = await review(workspaceDirectory, {complete: true});
        assert.equal(result.status, 'blocked');
        assert.deepEqual(result.diagnostics.map(entry => entry.code), ['review-edit-not-delete-only']);
    }
});

test('complete blocks normalizations for additional Skills removed from the first file', async t => {
    const workspaceDirectory = await createWorkspace(t);
    await review(workspaceDirectory);
    await writeFiles(workspaceDirectory, 'alpha\n', `${alphaLine}\n${betaLine}\n`);
    const result = await review(workspaceDirectory, {complete: true});
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics.map(entry => entry.code), ['review-edit-not-delete-only']);
});

test('complete keeps in-scope normalizations when no additional Skills are retained', async t => {
    const workspaceDirectory = await createWorkspace(t);
    const local = {path: 'skills/local/SKILL.md', line: 3, column: 5, identity: 'local', context: '$local,'};
    const input = {skillReferenceNormalizations: [candidates.skillReferenceNormalizations[0], local]};
    await review(workspaceDirectory, input);
    await writeFiles(workspaceDirectory, '', `${JSON.stringify(local)}\n`);
    const result = await review(workspaceDirectory, {...input, complete: true});
    assert.equal(result.status, 'succeeded');
});

test('complete blocks when review was not run and fails when a file cannot be read', async t => {
    const workspaceDirectory = await createWorkspace(t);
    const missing = await review(workspaceDirectory, {complete: true});
    assert.equal(missing.status, 'blocked');

    await review(workspaceDirectory);
    const failed = await review(workspaceDirectory, {
        complete: true,
        createFilesystem: async () => ({
            scopedFilesystem: {read: async () => ({diagnostics: [{code: 'read-failed', message: 'No read.'}], status: 'failed'})},
            status: 'succeeded',
        }),
    });
    assert.equal(failed.status, 'failed');
    assert.equal('stage' in failed && failed.stage, 'review-read');
});

test('confirmation blocks when either reviewed file changed after the reported hashes', async t => {
    const workspaceDirectory = await createWorkspace(t);
    await review(workspaceDirectory);
    const completed = await review(workspaceDirectory, {complete: true});
    if (!('additionalSkillReferencesHash' in completed)) throw new Error('Expected a completed review.');
    const confirmHashes = {
        additionalSkillReferencesHash: completed.additionalSkillReferencesHash,
        skillReferenceNormalizationsHash: completed.skillReferenceNormalizationsHash,
    };
    assert.equal((await review(workspaceDirectory, {confirmHashes})).status, 'succeeded');

    await writeFile(join(workspaceDirectory, SKILL_REFERENCE_NORMALIZATIONS_FILE), `${alphaLine}\n`);
    const result = await review(workspaceDirectory, {confirmHashes});
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics.map(entry => entry.code), ['review-input-changed']);
});
