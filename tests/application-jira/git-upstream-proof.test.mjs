import assert from 'node:assert/strict';
import test from 'node:test';

import {loadCommittedApplicationEffort, proveUpstreamEffort} from '../../lib/application-jira/git-upstream-proof.mjs';

const result = (/** @type {Buffer | string} */ stdout, code = 0) => ({code, failure: null, stderr: '', stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout, 'utf8')});

/** @param {Array<{bytes: Buffer, objectId: string}>} entries */
const batchResult = entries => result(Buffer.concat(entries.flatMap(entry => [
    Buffer.from(`${entry.objectId} blob ${entry.bytes.length}\n`, 'utf8'),
    entry.bytes,
    Buffer.from('\n', 'utf8'),
])));

test('Git Upstream Proof fetches the current upstream and accepts an identical effort tree', async () => {
    /** @type {string[][]} */
    const calls = [];
    const proof = await proveUpstreamEffort({
        effortPath: '.scratch/payment-retry',
        git: {run: async (/** @type {{argv: string[]}} */ input) => {
            calls.push(input.argv);
            if (input.argv.includes('@{upstream}')) return result('origin/dev\n');
            if (input.argv[0] === 'fetch') return result('');
            return result('same-tree\n');
        }},
        repositoryRoot: '/repository',
    });
    assert.deepEqual(proof, {
        diagnostics: [],
        proof: {localTree: 'same-tree', upstream: 'origin/dev', upstreamTree: 'same-tree'},
        status: 'succeeded',
    });
    assert.deepEqual(calls, [
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
        ['fetch'],
        ['rev-parse', 'HEAD:.scratch/payment-retry'],
        ['rev-parse', 'origin/dev:.scratch/payment-retry'],
    ]);
});

test('Git Upstream Proof blocks a local and live-upstream effort tree mismatch', async () => {
    let treeRead = 0;
    const proof = await proveUpstreamEffort({
        effortPath: '.scratch/payment-retry',
        git: {run: async (/** @type {{argv: string[]}} */ input) => {
            if (input.argv.includes('@{upstream}')) return result('origin/dev\n');
            if (input.argv[0] === 'fetch') return result('');
            treeRead += 1;
            return result(treeRead === 1 ? 'local-tree\n' : 'remote-tree\n');
        }},
        repositoryRoot: '/repository',
    });
    assert.equal(proof.status, 'blocked');
    assert.deepEqual(proof.diagnostics.map(diagnostic => diagnostic.code), ['upstream-tree-mismatch']);
});

test('Committed Application effort batches every issue blob independently of issue count', async () => {
    for (const issueCount of [1, 3]) {
        const spec = {bytes: Buffer.from('# Payment retry\n', 'utf8'), objectId: '0'.repeat(40), path: '.scratch/0001-payment-retry/spec.md'};
        const entries = Array.from({length: issueCount}, (_, index) => ({
            bytes: Buffer.from(`# Issue ${index + 1}\n`, 'utf8'),
            objectId: String(index + 1).repeat(40),
            path: `.scratch/0001-payment-retry/issues/${String(index + 1).padStart(2, '0')}-issue-${index + 1}.md`,
        }));
        /** @type {Array<{argv: string[], input?: Buffer | string}>} */
        const calls = [];
        const loaded = await loadCommittedApplicationEffort({
            effortNumber: '0001',
            git: {run: async (/** @type {{argv: string[], input?: Buffer | string}} */ input) => {
                calls.push(input);
                if (input.argv[0] === 'ls-tree') {
                    return result([spec, ...entries].map(entry => `100644 blob ${entry.objectId}\t${entry.path}\0`).join(''));
                }
                if (input.argv.join(' ') === 'cat-file --batch') {
                    const expected = [spec, ...entries].sort((left, right) => left.objectId.localeCompare(right.objectId));
                    assert.deepEqual(Buffer.from(input.input ?? '').toString('utf8').trim().split('\n'), expected.map(entry => entry.objectId));
                    return batchResult(expected);
                }
                assert.fail(`Unexpected Git call: ${input.argv.join(' ')}.`);
            }},
            repositoryRoot: '/repository',
        });
        assert.equal(loaded.status, 'succeeded');
        if (loaded.status !== 'succeeded') assert.fail('Committed effort must load.');
        assert.equal(loaded.documents.length, issueCount);
        assert.equal(calls.filter(call => call.argv.join(' ') === 'cat-file --batch').length, 1);
    }
});

test('Committed Application effort rejects symbolic links and malformed UTF-8', async () => {
    const specPath = '.scratch/0001-payment-retry/spec.md';
    const issuePath = '.scratch/0001-payment-retry/issues/01-first.md';
    const specId = '1'.repeat(40);
    const issueId = '2'.repeat(40);
    const cases = [
        {
            blobs: [],
            label: 'symbolic link spec',
            tree: `120000 blob ${specId}\t${specPath}\u0000100644 blob ${issueId}\t${issuePath}\0`,
        },
        {
            blobs: [],
            label: 'symbolic link issue',
            tree: `100644 blob ${specId}\t${specPath}\u0000120000 blob ${issueId}\t${issuePath}\0`,
        },
        {
            blobs: [{bytes: Buffer.from([0xc3, 0x28]), objectId: specId}, {bytes: Buffer.from('# Issue\n'), objectId: issueId}],
            label: 'invalid spec UTF-8',
            tree: `100644 blob ${specId}\t${specPath}\u0000100644 blob ${issueId}\t${issuePath}\0`,
        },
        {
            blobs: [{bytes: Buffer.from('# Spec\n'), objectId: specId}, {bytes: Buffer.from([0xc3, 0x28]), objectId: issueId}],
            label: 'invalid issue UTF-8',
            tree: `100644 blob ${specId}\t${specPath}\u0000100644 blob ${issueId}\t${issuePath}\0`,
        },
    ];
    for (const entry of cases) {
        const loaded = await loadCommittedApplicationEffort({
            effortNumber: '0001',
            git: {run: async (/** @type {{argv: string[]}} */ input) => input.argv[0] === 'ls-tree'
                ? result(entry.tree)
                : batchResult(entry.blobs)},
            repositoryRoot: '/repository',
        });
        assert.equal(loaded.status, 'blocked', entry.label);
    }
});
