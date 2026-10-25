import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import test from 'node:test';

import {runSuccessfulProcess} from '../helpers/process.mjs';
import {createRepository} from '../helpers/repository-fixture.mjs';
import {runUpstreamSyncCli} from '../../lib/upstream-sync/upstream-sync.mjs';

/** @typedef {Parameters<typeof runUpstreamSyncCli>[1]['module']} UpstreamSyncModule */
/** @typedef {string | Uint8Array} OutputValue */

const success = (/** @type {string} */ state) => ({diagnostics: [], permittedOperations: ['status'], state, status: /** @type {'succeeded'} */ ('succeeded')});

/** @returns {UpstreamSyncModule} */
const createModule = (/** @type {Partial<UpstreamSyncModule>} */ overrides) => ({
    abort: async () => success('unused'),
    createReviewRevision: async () => success('unused'),
    finalize: async () => success('unused'),
    prepare: async () => success('unused'),
    recordApproval: async () => success('unused'),
    status: async () => success('unused'),
    ...overrides,
});

test('upstream sync CLI forwards prepare without owning transaction policy', async () => {
    /** @type {Array<[string, string]>} */
    const calls = [];
    /** @type {OutputValue[]} */
    const stdout = [];
    const exitCode = await runUpstreamSyncCli([
        'prepare',
        '--source',
        'mattpocock-skills',
        '--to',
        '0123456789abcdef0123456789abcdef01234567',
    ], {
        module: createModule({
            async prepare(...args) {
                calls.push(args);
                return success('resolving');
            },
        }),
        stderr: value => assert.fail(String(value)),
        stdout: value => stdout.push(value),
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(calls, [['mattpocock-skills', '0123456789abcdef0123456789abcdef01234567']]);
    assert.deepEqual(stdout, ['State: resolving\nPermitted operations: status\n']);
});

test('upstream sync CLI forwards optional Skill reference review confirmation hashes', async () => {
    /** @type {unknown[]} */
    const calls = [];
    const additionalSkillReferencesHash = 'a'.repeat(64);
    const skillReferenceNormalizationsHash = 'b'.repeat(64);
    const dependencies = {
        module: createModule({
            async createReviewRevision(confirmation) {
                calls.push(confirmation);
                return success('reviewed');
            },
        }),
        stderr: (/** @type {OutputValue} */ value) => assert.fail(String(value)),
        stdout: () => {},
    };

    assert.equal(await runUpstreamSyncCli(['review'], dependencies), 0);
    assert.equal(await runUpstreamSyncCli([
        'review',
        '--confirm',
        additionalSkillReferencesHash,
        skillReferenceNormalizationsHash,
    ], dependencies), 0);
    assert.deepEqual(calls, [undefined, {
        additionalSkillReferencesHash,
        skillReferenceNormalizationsHash,
    }]);
});

test('upstream sync CLI rejects incomplete or malformed Skill reference review confirmations', async () => {
    /** @type {OutputValue[]} */
    const stderr = [];
    const dependencies = {
        module: createModule({}),
        stderr: (/** @type {OutputValue} */ value) => stderr.push(value),
        stdout: () => {},
    };

    assert.equal(await runUpstreamSyncCli(['review', '--confirm', 'a'.repeat(64)], dependencies), 2);
    assert.equal(await runUpstreamSyncCli(['review', '--confirm', 'invalid', 'b'.repeat(64)], dependencies), 2);
    assert.match(stderr.join(''), /review \[--confirm <additional-skill-references-hash> <skill-reference-normalizations-hash>\]/u);
});

test('upstream sync CLI separates usage errors from module findings', async () => {
    /** @type {OutputValue[]} */
    const stderr = [];
    /** @type {OutputValue[]} */
    const stdout = [];
    const dependencies = {
        module: createModule({
            async status() {
                return {
                    ...success('recovering'),
                    diagnostics: [{
                        blocking: true,
                        code: 'manual-recovery-required',
                        identity: '',
                        message: 'Manual recovery is required.',
                        path: '',
                        phase: 0,
                    }],
                    status: /** @type {'blocked'} */ ('blocked'),
                };
            },
        }),
        stderr: (/** @type {OutputValue} */ value) => stderr.push(value),
        stdout: (/** @type {OutputValue} */ value) => stdout.push(value),
    };

    assert.equal(await runUpstreamSyncCli(['unknown'], dependencies), 2);
    assert.equal(await runUpstreamSyncCli(['status'], dependencies), 1);
    assert.match(stderr.join(''), /Usage:/);
    assert.match(stderr.join(''), /manual-recovery-required: Manual recovery is required\./);
    assert.deepEqual(stdout, ['State: recovering\nPermitted operations: status\n']);
});

test('upstream sync CLI returns the Module blocked result when approve is not permitted', async () => {
    let approvalCalls = 0;
    /** @type {OutputValue[]} */
    const stderr = [];
    const exitCode = await runUpstreamSyncCli(['approve'], {
        module: createModule({
            async recordApproval() {
                approvalCalls += 1;
                return {
                    diagnostics: [{
                        blocking: true,
                        code: 'approval-not-permitted',
                        identity: '',
                        message: 'Approval is not permitted.',
                        path: '',
                        phase: 8,
                    }],
                    permittedOperations: ['prepare', 'status'],
                    state: 'idle',
                    status: 'blocked',
                };
            },
            async status() {
                return {...success('idle'), permittedOperations: ['prepare', 'status']};
            },
        }),
        promptApproval: async () => assert.fail('Approval prompt must not open outside reviewed state.'),
        stderr: value => stderr.push(value),
        stdout: () => {},
    });

    assert.equal(exitCode, 1);
    assert.equal(approvalCalls, 1);
    assert.match(stderr.join(''), /approval-not-permitted/);
});

test('upstream sync CLI preserves result handoffs and raw stdout boundaries', async () => {
    /** @type {OutputValue[]} */
    const rawStdout = [];
    /** @type {OutputValue[]} */
    const stdout = [];
    const digest = 'a'.repeat(64);
    const exitCode = await runUpstreamSyncCli(['review'], {
        module: createModule({
            async createReviewRevision() {
                return {
                    ...success('reviewed'),
                    agentMergeNotesDigest: 'c'.repeat(64),
                    candidateActualSkillDigest: 'a'.repeat(64),
                    candidateSourceDigest: 'b'.repeat(64),
                    finalizedEvidence: [{digest, exists: true, mode: '100644', path: 'distribution/manifest.json'}],
                    rawOutput: Buffer.from('raw artifact\n'),
                    remainingPaths: ['candidate/line\nbreak'],
                    reviewRevisionId: 'e'.repeat(64),
                    syncRecordId: 'f'.repeat(64),
                };
            },
        }),
        rawStdout: value => rawStdout.push(value),
        stderr: value => assert.fail(String(value)),
        stdout: value => stdout.push(value),
    });

    assert.equal(exitCode, 0);
    assert.match(stdout.join(''), /Agent Merge Notes Digest: c{64}/);
    assert.match(stdout.join(''), /Candidate Actual Skill Digest: a{64}/);
    assert.match(stdout.join(''), /Candidate Source Digest: b{64}/);
    assert.match(stdout.join(''), /Sync Record ID: f{64}/);
    assert.match(stdout.join(''), /Finalized path: distribution\/manifest\.json/);
    assert.match(stdout.join(''), /Remaining workspace path: candidate\/line\\nbreak\n/);
    assert.equal(rawStdout.length, 1);
    const rawOutput = rawStdout[0];
    if (rawOutput === undefined) assert.fail('Expected raw review output.');
    assert.equal(Buffer.from(rawOutput).equals(Buffer.from('raw artifact\n')), true);
});

test('scripts upstream sync entry assembles the production status path', async t => {
    const root = await createRepository(t, {prefix: 'arw-upstream-cli-'});
    const nested = join(root, 'nested');
    await mkdir(nested);
    const script = resolve('scripts/upstream-sync.mjs');

    const response = await runSuccessfulProcess(process.execPath, [script, 'status'], {cwd: nested});

    assert.match(response.stdout, /State: idle/);
    assert.match(response.stdout, /Permitted operations: prepare, status/);
    assert.equal(response.stderr, '');
});

test('upstream sync CLI forwards a digest-bound local recovery authorization', async () => {
    const recoveryPlanDigest = '9'.repeat(64);
    /** @type {Array<Parameters<UpstreamSyncModule['finalize']>[0]>} */
    const authorizations = [];
    /** @type {OutputValue[]} */
    const stdout = [];
    const module = createModule({
        async finalize(authorization) {
            authorizations.push(authorization);
            return success('awaiting-commit');
        },
        async status() {
            return {
                ...success('recovering'),
                recoveryPlan: {recoveryPlanDigest, states: [], version: 1},
            };
        },
    });

    const dependencies = {
        module,
        promptRecovery: async () => 'Continue the reviewed promotion.',
        stderr: (/** @type {OutputValue} */ value) => assert.fail(String(value)),
        stdout: (/** @type {OutputValue} */ value) => stdout.push(value),
    };
    assert.equal(await runUpstreamSyncCli(['status'], dependencies), 0);
    const exitCode = await runUpstreamSyncCli(['finalize'], dependencies);

    assert.equal(exitCode, 0);
    assert.deepEqual(authorizations, [{
        channel: 'local-cli',
        humanConfirmation: 'Continue the reviewed promotion.',
        recoveryPlanDigest,
    }]);
    assert.match(stdout.join(''), /State: awaiting-commit/);
    assert.match(stdout.join(''), new RegExp(`Recovery plan digest: ${recoveryPlanDigest}`));
});
