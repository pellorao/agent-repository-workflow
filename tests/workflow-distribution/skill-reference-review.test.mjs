import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {basename, join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {
    ADDITIONAL_SKILL_REFERENCES_FILE,
    SKILL_REFERENCE_NORMALIZATIONS_FILE,
    reviewSkillReferences,
    skillReferenceReviewHashes,
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

test('reference review hashes use the exact shared review file bytes', () => {
    assert.deepEqual(skillReferenceReviewHashes(candidates), {
        additionalSkillReferencesHash: createHash('sha256').update('alpha\nbeta\n').digest('hex'),
        skillReferenceNormalizationsHash: createHash('sha256').update([
            '{"path":"skills/alpha/SKILL.md","line":1,"column":1,"identity":"alpha","context":"$alpha,"}',
            '{"path":"skills/beta/SKILL.md","line":2,"column":3,"identity":"beta","context":"$beta."}',
            '',
        ].join('\n')).digest('hex'),
    });
});

test('reference review rejects normalization paths outside canonical Skill Markdown', async t => {
    const workspaceDirectory = await createWorkspace(t);
    await assert.rejects(() => reviewSkillReferences({
        additionalSkillReferences: [],
        launchEditor: async () => assert.fail('invalid candidates must not open an editor'),
        reviewEditor: {args: ['{file}'], command: 'editor'},
        skillReferenceNormalizations: [{
            column: 1,
            context: '$alpha',
            identity: 'alpha',
            line: 1,
            path: 'docs/example.md',
        }],
        workspaceDirectory,
    }), /skillReferenceNormalizations must be valid and sorted/);
});

test('reference review opens two files in order and accepts deletion-only results', async t => {
    const workspaceDirectory = await createWorkspace(t);
    /** @type {string[]} */
    const opened = [];
    /** @type {string[]} */
    const hashes = [];
    const result = await reviewSkillReferences({
        ...candidates,
        emitHash: hash => hashes.push(hash),
        launchEditor: async ({filePath, wait}) => {
            assert.equal(wait, true);
            assert.equal(typeof filePath, 'string');
            if (typeof filePath !== 'string') throw new TypeError('filePath must be a string.');
            opened.push(basename(filePath));
            if (filePath.endsWith(ADDITIONAL_SKILL_REFERENCES_FILE)) {
                await writeFile(filePath, 'alpha\n');
            } else {
                await writeFile(filePath, '');
            }
        },
        reviewEditor: {args: ['--wait', '{file}'], command: 'editor'},
        workspaceDirectory,
    });
    assert.equal(result.status, 'succeeded');
    assert.deepEqual(opened, [ADDITIONAL_SKILL_REFERENCES_FILE, SKILL_REFERENCE_NORMALIZATIONS_FILE]);
    assert.equal(hashes.length, 2);
    assert.deepEqual(result.additionalSkillReferences, ['alpha']);
    assert.deepEqual(result.skillReferenceNormalizations, []);
});

test('reference review shows normalizations only for in-scope and retained additional Skills', async t => {
    const workspaceDirectory = await createWorkspace(t);
    let normalizationFile = '';
    const result = await reviewSkillReferences({
        additionalSkillReferences: ['alpha', 'beta'],
        launchEditor: async ({filePath}) => {
            if (typeof filePath !== 'string') throw new TypeError('filePath must be a string.');
            if (filePath.endsWith(ADDITIONAL_SKILL_REFERENCES_FILE)) {
                await writeFile(filePath, 'alpha\n');
                return;
            }
            normalizationFile = await readFile(filePath, 'utf8');
            await writeFile(filePath, '{"path":"skills/alpha/SKILL.md","line":1,"column":1,"identity":"alpha","context":"$alpha,"}\n');
        },
        reviewEditor: {args: ['{file}'], command: 'editor'},
        skillReferenceNormalizations: [
            {path: 'skills/alpha/SKILL.md', line: 1, column: 1, identity: 'alpha', context: '$alpha,'},
            {path: 'skills/beta/SKILL.md', line: 2, column: 3, identity: 'beta', context: '$beta.'},
            {path: 'skills/local/SKILL.md', line: 3, column: 5, identity: 'local', context: '$local,'},
        ],
        workspaceDirectory,
    });

    assert.equal(result.status, 'succeeded');
    assert.equal(normalizationFile, [
        '{"path":"skills/alpha/SKILL.md","line":1,"column":1,"identity":"alpha","context":"$alpha,"}',
        '{"path":"skills/local/SKILL.md","line":3,"column":5,"identity":"local","context":"$local,"}',
        '',
    ].join('\n'));
});

test('unchanged nonempty review requires Human confirmation and returns no hash in the blocked result', async t => {
    const workspaceDirectory = await createWorkspace(t);
    /** @type {string[]} */
    const hashes = [];
    const first = await reviewSkillReferences({
        ...candidates,
        emitHash: hash => hashes.push(hash),
        launchEditor: async () => {},
        reviewEditor: {args: ['{file}'], command: 'editor'},
        workspaceDirectory,
    });
    assert.deepEqual(first, {
        diagnostics: [{code: 'review-confirmation-required', message: 'Confirm that no candidates should be deleted before completing this review.'}],
        status: 'blocked',
    });
    assert.equal(hashes.length, 2);

    const confirmed = await reviewSkillReferences({
        ...candidates,
        confirmHashes: {
            additionalSkillReferencesHash: hashes[0],
            skillReferenceNormalizationsHash: hashes[1],
        },
        launchEditor: async () => assert.fail('confirm must not reopen an editor'),
        workspaceDirectory,
    });
    assert.equal(confirmed.status, 'succeeded');
    assert.deepEqual(confirmed.additionalSkillReferences, candidates.additionalSkillReferences);
    assert.deepEqual(confirmed.skillReferenceNormalizations, candidates.skillReferenceNormalizations);
});

test('confirmation blocks when either reviewed file changed after the reported hashes', async t => {
    const workspaceDirectory = await createWorkspace(t);
    /** @type {string[]} */
    const hashes = [];
    await reviewSkillReferences({
        ...candidates,
        emitHash: hash => hashes.push(hash),
        launchEditor: async () => {},
        reviewEditor: {args: ['{file}'], command: 'editor'},
        workspaceDirectory,
    });
    await writeFile(join(workspaceDirectory, ADDITIONAL_SKILL_REFERENCES_FILE), 'alpha\n');
    const result = await reviewSkillReferences({
        ...candidates,
        confirmHashes: {
            additionalSkillReferencesHash: hashes[0],
            skillReferenceNormalizationsHash: hashes[1],
        },
        workspaceDirectory,
    });
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics.map(entry => entry.code), ['review-input-changed']);
    assert.equal('additionalSkillReferencesHash' in result, false);
});

test('confirmation blocks normalizations for additional Skills removed from the first file', async t => {
    const workspaceDirectory = await createWorkspace(t);
    await reviewSkillReferences({
        ...candidates,
        launchEditor: async () => {},
        reviewEditor: {args: ['{file}'], command: 'editor'},
        workspaceDirectory,
    });
    await writeFile(join(workspaceDirectory, ADDITIONAL_SKILL_REFERENCES_FILE), '');
    const result = await reviewSkillReferences({
        ...candidates,
        confirmHashes: skillReferenceReviewHashes({
            additionalSkillReferences: [],
            skillReferenceNormalizations: candidates.skillReferenceNormalizations,
        }),
        workspaceDirectory,
    });

    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics.map(entry => entry.code), ['review-edit-not-delete-only']);
});

test('reference review rejects inserted, rewritten, or reordered lines', async t => {
    const workspaceDirectory = await createWorkspace(t);
    const result = await reviewSkillReferences({
        ...candidates,
        launchEditor: async ({filePath}) => {
            assert.equal(typeof filePath, 'string');
            if (typeof filePath !== 'string') throw new TypeError('filePath must be a string.');
            if (filePath.endsWith(ADDITIONAL_SKILL_REFERENCES_FILE)) await writeFile(filePath, 'beta\nalpha\n');
        },
        reviewEditor: {args: ['{file}'], command: 'editor'},
        workspaceDirectory,
    });
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics.map(entry => entry.code), ['review-edit-not-delete-only']);
});

test('reference review identifies a normalization editor failure', async t => {
    const workspaceDirectory = await createWorkspace(t);
    const result = await reviewSkillReferences({
        additionalSkillReferences: [],
        launchEditor: async ({filePath}) => {
            if (typeof filePath !== 'string') throw new TypeError('filePath must be a string.');
            if (filePath.endsWith(SKILL_REFERENCE_NORMALIZATIONS_FILE)) throw new Error('No normalization editor.');
        },
        reviewEditor: {args: ['{file}'], command: 'editor'},
        skillReferenceNormalizations: [{
            column: 1,
            context: '$local,',
            identity: 'local',
            line: 1,
            path: 'skills/local/SKILL.md',
        }],
        workspaceDirectory,
    });

    assert.deepEqual(result, {
        diagnostics: [{
            code: 'review-editor-failed',
            message: 'No normalization editor.',
            path: SKILL_REFERENCE_NORMALIZATIONS_FILE,
        }],
        stage: 'editor',
        status: 'failed',
    });
});
