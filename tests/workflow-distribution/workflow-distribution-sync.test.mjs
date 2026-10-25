import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {createScopedFilesystem} from '../../lib/common/filesystem.mjs';
import {buildWorkflowDistribution} from '../../lib/workflow-distribution/workflow-distribution.mjs';
import {createClaudeCodePlatformAdapter, createCodexPlatformAdapter} from '../../lib/arw-common/platform-adapter.mjs';
import {
    applyWorkflowDistributionSync,
    createSourceCheckoutSyncStateAdapter,
    prepareWorkflowDistributionReview as prepareWorkflowDistributionReviewImplementation,
    prepareWorkflowDistributionSync,
} from '../../lib/workflow-distribution/workflow-distribution-sync.mjs';

/** @typedef {NonNullable<Parameters<typeof prepareWorkflowDistributionReviewImplementation>[0]['stateAdapter']>} SyncStateAdapter */
/** @typedef {Extract<Awaited<ReturnType<typeof prepareWorkflowDistributionReviewImplementation>>, {status: 'succeeded'}>} SkillAnalysis */
/** @typedef {Parameters<typeof prepareWorkflowDistributionSync>[0]['review']} SkillReview */
/** @typedef {Extract<Awaited<ReturnType<typeof prepareWorkflowDistributionSync>>, {status: 'succeeded'}>} SyncPlan */

/** @returns {Promise<SkillAnalysis>} */
const prepareWorkflowDistributionReview = async (/** @type {Parameters<typeof prepareWorkflowDistributionReviewImplementation>[0]} */ input) => {
    const result = await prepareWorkflowDistributionReviewImplementation(input);
    assert.equal(result.status, 'succeeded', JSON.stringify(result.diagnostics));
    if (result.status !== 'succeeded') throw new Error('Expected Workflow Distribution review analysis.');
    return result;
};

/** @returns {SyncPlan} */
const requireSyncPlan = (/** @type {Awaited<ReturnType<typeof prepareWorkflowDistributionSync>>} */ result) => {
    assert.equal(result.status, 'succeeded', JSON.stringify(result.diagnostics));
    if (result.status !== 'succeeded') throw new Error('Expected Workflow Distribution sync plan.');
    return result;
};

const createSuccessfulFilesystem = async (/** @type {Parameters<typeof createScopedFilesystem>[0]} */ options) => {
    const created = await createScopedFilesystem(options);
    assert.equal(created.status, 'succeeded', JSON.stringify(created.diagnostics));
    if (created.status !== 'succeeded') throw new Error('Expected scoped filesystem fixture.');
    return created;
};

const sha256 = (/** @type {Buffer<ArrayBuffer> | import("crypto").BinaryLike} */ bytes) => createHash('sha256').update(bytes).digest('hex');

const distributionConfig = {
    repositoryOwnedSeeds: ['.arwignore'],
};

const projectionConfig = {
    source: 'codex',
    skills: {root: 'skills/', additionalSkillReferences: [], skillReferenceNormalizations: []},
    platforms: {
        codex: {
            supportedVersionRange: '*',
            format: {skillReference: '${name}', excludedSkillPaths: []},
            targets: {skills: '.agents/skills/', configuration: '.codex/config.toml'},
        },
        'claude-code': {
            supportedVersionRange: '*',
            format: {skillReference: '/{name}', excludedSkillPaths: ['agents/openai.yaml']},
            targets: {skills: '.claude/skills/'},
        },
    },
};

const write = async (/** @type {string} */ root, /** @type {string} */ path, /** @type {string | NodeJS.ArrayBufferView<ArrayBufferLike> | Buffer<ArrayBuffer> | Iterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>> | AsyncIterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>>} */ contents) => {
    const target = join(root, ...path.split('/'));
    await mkdir(dirname(target), {recursive: true});
    await writeFile(target, contents);
};

const createSourceCheckout = async (/** @type {test.TestContext} */ t) => {
    const root = await createTemporaryDirectory(t, 'arw-sync-');
    await write(root, 'AGENTS.md', 'Repository text.\n<!-- arw:managed:start -->\nManaged root.\n<!-- arw:managed:end -->\nSource-only text.\n');
    await write(root, 'docs/agents/writing.md', '<!-- arw:managed:start -->\nManaged writing.\n<!-- arw:managed:end -->\n');
    await write(root, 'docs/agents/code-maps.md', '# Code Maps\n\nShared workflow.\n');
    await write(root, 'docs/agents/reviewer.md', '<!-- arw:managed:start -->\n# Reviewer Responsibilities\n\nShared reviewer rules.\n<!-- arw:managed:end -->\n<!-- arw:repository-owned:start -->\nNone.\n<!-- arw:repository-owned:end -->\n');
    await write(root, 'docs/agents/reviewer-role-seeds.md', '# Reviewer Role Seeds\n\nSource Checkout only.\n');
    await write(root, 'docs/agents/roles/reviewer.md', '# Reviewer\n');
    await write(root, 'docs/licenses/arw/LICENSE.example-source', 'License.\n');
    await write(root, '.agents/skills/review/SKILL.md', 'Use $review and $external.\n');
    await write(root, '.agents/skills/review/agents/openai.yaml', 'interface:\n  display_name: Review\n');
    await write(root, 'distribution/config.json', `${JSON.stringify(distributionConfig, null, 2)}\n`);
    await write(root, 'distribution/projections/config.json', `${JSON.stringify(projectionConfig, null, 2)}\n`);
    await write(root, 'distribution/projections/codex/config.toml', 'include_collaboration_mode_instructions = false\n');
    await write(root, 'distribution/baseline/.arwignore', '.tmp/\n');
    await write(root, 'distribution/skills/obsolete/SKILL.md', '# Obsolete\n');
    return root;
};

/** @returns {SyncStateAdapter} */
const cleanState = (/** @type {string[][]} */ calls) => ({
    async inspect(paths) {
        calls.push(paths);
        return {diagnostics: [], status: 'succeeded'};
    },
});

/** @returns {{diagnostics: Array<{code: string, message: string}>, stage: string, status: 'failed'}} */
const injectedFailure = (/** @type {string} */ stage) => ({
    diagnostics: [{code: 'injected-failure', message: 'Injected failure.'}],
    stage,
    status: 'failed',
});

/** @returns {SkillReview} */
const completedReview = (/** @type {SkillAnalysis} */ analysis) => {
    const additionalBytes = Buffer.from(`${analysis.additionalSkillReferences.join('\n')}\n`);
    const normalizationLines = analysis.skillReferenceNormalizations.map(record => JSON.stringify({
        path: record.path,
        line: record.line,
        column: record.column,
        identity: record.identity,
        context: record.context,
    }));
    const normalizationBytes = Buffer.from(`${normalizationLines.join('\n')}\n`);
    return {
        status: 'succeeded',
        additionalSkillReferences: analysis.additionalSkillReferences,
        skillReferenceNormalizations: analysis.skillReferenceNormalizations,
        additionalSkillReferencesHash: sha256(additionalBytes),
        skillReferenceNormalizationsHash: sha256(normalizationBytes),
    };
};

const invalidUtf8ProjectionConfig = () => {
    const source = JSON.stringify(projectionConfig);
    const marker = '"supportedVersionRange":"*"';
    const markerOffset = source.indexOf(marker);
    assert.notEqual(markerOffset, -1);
    const invalidOffset = markerOffset + marker.indexOf('*');
    return Buffer.concat([
        Buffer.from(source.slice(0, invalidOffset), 'utf8'),
        Buffer.from([0xc3, 0x28]),
        Buffer.from(source.slice(invalidOffset + 1), 'utf8'),
    ]);
};

test('sync state rejects ignored files inside an authoritative input tree', async () => {
    /** @type {Array<{argv: string[]}>} */
    const calls = [];
    const state = createSourceCheckoutSyncStateAdapter('C:\\repo', {
        git: {
            async run(request) {
                calls.push(request);
                return {
                    code: 0,
                    failure: null,
                    stderr: '',
                    stdout: Buffer.from('!! .agents/skills/review/ignored.md\0', 'utf8'),
                };
            },
        },
    });

    const result = await state.inspect(['.agents/skills']);
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics.map(entry => entry.code), ['sync-input-dirty']);
    assert.deepEqual(result.diagnostics.map(entry => entry.path), ['.agents/skills/review/ignored.md']);
    assert.deepEqual(calls[0].argv, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--ignored=matching',
        '--',
        '.agents/skills',
    ]);
});

test('sync review checks only the Skill and projection-config paths it actually reads', async t => {
    const root = await createSourceCheckout(t);
    /** @type {string[][]} */
    const calls = [];
    const result = await prepareWorkflowDistributionReview({repositoryRoot: root, stateAdapter: cleanState(calls)});
    assert.equal(result.status, 'succeeded', JSON.stringify(result.diagnostics));
    assert.deepEqual(calls, [['.agents/skills', 'distribution/projections/config.json']]);
    assert.deepEqual(result.additionalSkillReferences, ['external']);
    assert.deepEqual(result.skillReferenceNormalizations, [{
        column: 17,
        context: '$external.',
        identity: 'external',
        line: 1,
        path: 'skills/review/SKILL.md',
    }]);
});

test('sync review rejects invalid UTF-8 projection configuration before analysis', async t => {
    const root = await createSourceCheckout(t);
    await write(root, 'distribution/projections/config.json', invalidUtf8ProjectionConfig());
    await write(root, 'distribution/projections/codex/config.toml', 'include_collaboration_mode_instructions = false\n');

    const result = await prepareWorkflowDistributionReviewImplementation({repositoryRoot: root, stateAdapter: cleanState([])});
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics.map(entry => [entry.code, entry.path]), [
        ['invalid-utf8', 'distribution/projections/config.json'],
    ]);
});

test('sync prepare strictly validates both Distribution configuration files', async t => {
    for (const path of ['distribution/config.json', 'distribution/projections/config.json']) {
        const root = await createSourceCheckout(t);
        const stateAdapter = cleanState([]);
        const analysis = await prepareWorkflowDistributionReview({repositoryRoot: root, stateAdapter});
        assert.equal(analysis.status, 'succeeded', JSON.stringify(analysis.diagnostics));
        await write(root, path, Buffer.from([0xc3, 0x28]));

        const result = await prepareWorkflowDistributionSync({
            repositoryRoot: root,
            review: completedReview(analysis),
            stateAdapter,
        });
        assert.equal(result.status, 'blocked');
        assert.deepEqual(result.diagnostics.map(entry => [entry.code, entry.path]), [
            ['invalid-utf8', path],
        ]);
    }
});

test('sync copies fixed license sources and excludes other direct license-directory files', async t => {
    const root = await createSourceCheckout(t);
    await write(root, 'docs/licenses/arw/NOTICE.md', 'Obsolete notice.\n');
    await write(root, 'distribution/baseline/docs/licenses/arw/NOTICE.md', 'Old projected notice.\n');
    const stateAdapter = cleanState([]);
    const analysis = await prepareWorkflowDistributionReview({repositoryRoot: root, stateAdapter});
    const plan = requireSyncPlan(await prepareWorkflowDistributionSync({
        repositoryRoot: root,
        review: completedReview(analysis),
        stateAdapter,
    }));

    const applied = await applyWorkflowDistributionSync({
        authorization: {approved: true, planDigest: plan.planDigest},
        plan,
    });

    assert.deepEqual(applied, {diagnostics: [], status: 'succeeded'});
    assert.equal(
        await readFile(join(root, 'distribution', 'baseline', 'docs', 'licenses', 'arw', 'LICENSE.example-source'), 'utf8'),
        'License.\n',
    );
    await assert.rejects(
        readFile(join(root, 'distribution', 'baseline', 'docs', 'licenses', 'arw', 'NOTICE.md')),
        {code: 'ENOENT'},
    );
});

test('sync copies a canonical Role on-demand document without adding a platform seed identity', async t => {
    const root = await createSourceCheckout(t);
    await write(root, 'docs/agents/roles/reviewer/checks.md', '# Reviewer Checks\n');
    const stateAdapter = cleanState([]);
    const analysis = await prepareWorkflowDistributionReview({repositoryRoot: root, stateAdapter});

    const plan = requireSyncPlan(await prepareWorkflowDistributionSync({
        repositoryRoot: root,
        review: completedReview(analysis),
        stateAdapter,
    }));
    const applied = await applyWorkflowDistributionSync({
        authorization: {approved: true, planDigest: plan.planDigest},
        plan,
    });

    assert.deepEqual(applied, {diagnostics: [], status: 'succeeded'});
    assert.equal(
        await readFile(join(root, 'distribution', 'baseline', 'docs', 'agents', 'roles', 'reviewer', 'checks.md'), 'utf8'),
        '# Reviewer Checks\n',
    );
});

test('sync prepare rejects invalid on-demand Role source layouts before rebuilding', async t => {
    for (const scenario of [
        {
            label: 'orphan directory',
            mutate: (/** @type {string} */ root) => mkdir(join(root, 'docs', 'agents', 'roles', 'orphan')),
        },
        {
            label: 'deeper directory',
            mutate: (/** @type {string} */ root) => write(root, 'docs/agents/roles/reviewer/checks/details.md', '# Details\n'),
        },
        {
            label: 'non-Markdown document',
            mutate: (/** @type {string} */ root) => write(root, 'docs/agents/roles/reviewer/checks.txt', 'checks\n'),
        },
    ]) {
        await t.test(scenario.label, async t => {
            const root = await createSourceCheckout(t);
            const stateAdapter = cleanState([]);
            const analysis = await prepareWorkflowDistributionReview({repositoryRoot: root, stateAdapter});
            await scenario.mutate(root);

            const result = await prepareWorkflowDistributionSync({
                repositoryRoot: root,
                review: completedReview(analysis),
                stateAdapter,
            });

            assert.equal(result.status, 'blocked');
            assert.ok(result.diagnostics.some(entry => entry.code === 'role-source-invalid'), JSON.stringify(result.diagnostics));
            assert.equal('planDigest' in result, false);
            assert.equal(
                await readFile(join(root, 'distribution', 'skills', 'obsolete', 'SKILL.md'), 'utf8'),
                '# Obsolete\n',
            );
        });
    }
});

test('sync prepare requires the actual Code Map workflow source', async t => {
    const root = await createSourceCheckout(t);
    const stateAdapter = cleanState([]);
    const analysis = await prepareWorkflowDistributionReview({repositoryRoot: root, stateAdapter});
    await rm(join(root, 'docs', 'agents', 'code-maps.md'));
    await write(root, 'distribution/baseline/docs/agents/code-maps.md', '# Existing Code Maps\n');

    const result = await prepareWorkflowDistributionSync({
        repositoryRoot: root,
        review: completedReview(analysis),
        stateAdapter,
    });
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics, [{
        code: 'agent-document-source-missing',
        message: 'A required actual Agent document is missing.',
        path: 'docs/agents/code-maps.md',
    }]);
    assert.equal('operations' in result, false);
});

test('sync prepare rejects a case-folded collision between a protected seed and a generated target', async t => {
    const root = await createSourceCheckout(t);
    const configuration = structuredClone(distributionConfig);
    configuration.repositoryOwnedSeeds.push('agents.md');
    await write(root, 'distribution/config.json', `${JSON.stringify(configuration, null, 2)}\n`);
    await write(root, 'distribution/baseline/agents.md', 'Protected seed.\n');
    const stateAdapter = cleanState([]);
    const analysis = await prepareWorkflowDistributionReview({repositoryRoot: root, stateAdapter});

    const result = await prepareWorkflowDistributionSync({
        repositoryRoot: root,
        review: completedReview(analysis),
        stateAdapter,
    });
    assert.deepEqual(result, {
        diagnostics: [{
            code: 'sync-protected-target-collision',
            message: 'An actual source target collides with a protected Workflow Distribution path.',
            path: 'distribution/baseline/AGENTS.md',
            relatedPath: 'distribution/baseline/agents.md',
        }],
        status: 'blocked',
    });
    assert.equal('planDigest' in result, false);
    assert.equal(
        await readFile(join(root, 'distribution', 'baseline', 'agents.md'), 'utf8'),
        'Protected seed.\n',
    );
});

test('sync prepare returns one no-write plan and apply requires matching user authorization', async t => {
    const root = await createSourceCheckout(t);
    /** @type {string[][]} */
    const calls = [];
    const stateAdapter = cleanState(calls);
    const analysis = await prepareWorkflowDistributionReview({repositoryRoot: root, stateAdapter});
    const plan = requireSyncPlan(await prepareWorkflowDistributionSync({repositoryRoot: root, review: completedReview(analysis), stateAdapter}));
    assert.equal(plan.status, 'succeeded', JSON.stringify(plan.diagnostics));
    assert.match(plan.planDigest, /^[0-9a-f]{64}$/u);
    assert.deepEqual(Object.keys(plan), ['diagnostics', 'planDigest', 'status']);
    await assert.rejects(readFile(join(root, 'distribution', 'baseline', 'AGENTS.md')), {code: 'ENOENT'});

    const denied = await applyWorkflowDistributionSync({
        authorization: {approved: false, planDigest: plan.planDigest},
        plan,
    });
    assert.equal(denied.status, 'blocked');
    await assert.rejects(readFile(join(root, 'distribution', 'baseline', 'AGENTS.md')), {code: 'ENOENT'});

    const applied = await applyWorkflowDistributionSync({
        authorization: {approved: true, planDigest: plan.planDigest},
        plan,
    });
    assert.deepEqual(applied, {diagnostics: [], status: 'succeeded'});
    await assert.rejects(readFile(join(root, 'distribution', 'skills', 'obsolete', 'SKILL.md')), {code: 'ENOENT'});
    const built = await buildWorkflowDistribution({distributionDirectory: join(root, 'distribution')});
    assert.equal(built.status, 'succeeded', JSON.stringify(built.diagnostics));
    assert.match(
        await readFile(join(root, 'distribution', 'projections', 'config.json'), 'utf8'),
        /"additionalSkillReferences": \[\s+"external"/u,
    );
    assert.equal((await readFile(join(root, 'distribution', 'baseline', '.arwignore'), 'utf8')), '.tmp/\n');
    assert.equal(
        await readFile(join(root, 'distribution', 'baseline', 'docs', 'agents', 'reviewer.md'), 'utf8'),
        '<!-- arw:managed:start -->\n# Reviewer Responsibilities\n\nShared reviewer rules.\n<!-- arw:managed:end -->\n<!-- arw:repository-owned:start -->\nNone.\n<!-- arw:repository-owned:end -->\n',
    );
    await assert.rejects(
        readFile(join(root, 'distribution', 'baseline', 'docs', 'agents', 'reviewer-role-seeds.md')),
        {code: 'ENOENT'},
    );
});

test('sync apply revalidates every plan-bound byte and blocks state drift before deletion', async t => {
    const root = await createSourceCheckout(t);
    const stateAdapter = cleanState([]);
    const analysis = await prepareWorkflowDistributionReview({repositoryRoot: root, stateAdapter});
    const plan = requireSyncPlan(await prepareWorkflowDistributionSync({repositoryRoot: root, review: completedReview(analysis), stateAdapter}));
    await write(root, 'AGENTS.md', 'Repository text.\n<!-- arw:managed:start -->\nChanged managed root.\n<!-- arw:managed:end -->\nSource-only text.\n');
    const result = await applyWorkflowDistributionSync({
        authorization: {approved: true, planDigest: plan.planDigest},
        plan,
    });
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics.map(entry => entry.code), ['sync-plan-changed']);
    await assert.rejects(readFile(join(root, 'distribution', 'baseline', 'AGENTS.md')), {code: 'ENOENT'});
});

test('sync apply preserves a pre-delete failure without transaction-only result fields', async t => {
    const root = await createSourceCheckout(t);
    let stateInspections = 0;
    /** @type {SyncStateAdapter} */
    const stateAdapter = {
        async inspect() {
            stateInspections += 1;
            return stateInspections === 3
                ? injectedFailure('sync-revalidation')
                : {diagnostics: [], status: 'succeeded'};
        },
    };
    const analysis = await prepareWorkflowDistributionReview({repositoryRoot: root, stateAdapter});
    const plan = requireSyncPlan(await prepareWorkflowDistributionSync({
        repositoryRoot: root,
        review: completedReview(analysis),
        stateAdapter,
    }));
    const result = await applyWorkflowDistributionSync({
        authorization: {approved: true, planDigest: plan.planDigest},
        plan,
    });
    assert.deepEqual(result, {
        diagnostics: [{code: 'injected-failure', message: 'Injected failure.'}],
        stage: 'sync-revalidation',
        status: 'failed',
    });
    assert.equal(await readFile(join(root, 'distribution', 'skills', 'obsolete', 'SKILL.md'), 'utf8'), '# Obsolete\n');
});

test('sync apply reports a cleanup failure without internal rollback', async t => {
    const root = await createSourceCheckout(t);
    const stateAdapter = cleanState([]);
    const createFilesystem = async (/** @type {Parameters<typeof createScopedFilesystem>[0]} */ options) => {
        const created = await createSuccessfulFilesystem(options);
        return {
            ...created,
            scopedFilesystem: {
                ...created.scopedFilesystem,
                async remove(/** @type {{path: string, recursive?: boolean}} */ request) {
                    if (request.path === 'distribution/skills/obsolete/SKILL.md') {
                        return injectedFailure('filesystem-remove');
                    }
                    return created.scopedFilesystem.remove(request);
                },
            },
        };
    };
    const analysis = await prepareWorkflowDistributionReview({repositoryRoot: root, stateAdapter});
    const plan = requireSyncPlan(await prepareWorkflowDistributionSync({
        createFilesystem,
        repositoryRoot: root,
        review: completedReview(analysis),
        stateAdapter,
    }));
    const result = await applyWorkflowDistributionSync({
        authorization: {approved: true, planDigest: plan.planDigest},
        plan,
    });
    assert.deepEqual(result, {
        diagnostics: [{code: 'injected-failure', message: 'Injected failure.'}],
        stage: 'cleanup',
        status: 'failed',
    });
    assert.equal('completedOperations' in result, false);
    assert.equal('rollback' in result, false);
    assert.equal(await readFile(join(root, 'distribution', 'skills', 'obsolete', 'SKILL.md'), 'utf8'), '# Obsolete\n');
});

test('sync apply reports the failing stage after deletion and performs no internal rollback', async t => {
    const root = await createSourceCheckout(t);
    const stateAdapter = cleanState([]);
    const createFilesystem = async (/** @type {Parameters<typeof createScopedFilesystem>[0]} */ options) => {
        const created = await createSuccessfulFilesystem(options);
        return {
            ...created,
            scopedFilesystem: {
                ...created.scopedFilesystem,
                async write(/** @type {{bytes: Buffer, mode: 'create' | 'create-atomic' | 'replace', path: string}} */ request) {
                    if (request.path === 'distribution/baseline/AGENTS.md') {
                        return injectedFailure('filesystem-file-create');
                    }
                    return created.scopedFilesystem.write(request);
                },
            },
        };
    };
    const analysis = await prepareWorkflowDistributionReview({repositoryRoot: root, stateAdapter});
    const plan = requireSyncPlan(await prepareWorkflowDistributionSync({
        createFilesystem,
        repositoryRoot: root,
        review: completedReview(analysis),
        stateAdapter,
    }));
    const result = await applyWorkflowDistributionSync({
        authorization: {approved: true, planDigest: plan.planDigest},
        plan,
    });
    assert.deepEqual(result, {
        diagnostics: [{code: 'injected-failure', message: 'Injected failure.'}],
        stage: 'generated-write',
        status: 'failed',
    });
    assert.equal('completedOperations' in result, false);
    assert.equal('rollback' in result, false);
    await assert.rejects(readFile(join(root, 'distribution', 'skills', 'obsolete', 'SKILL.md')), {code: 'ENOENT'});
    await assert.rejects(readFile(join(root, 'distribution', 'baseline', 'AGENTS.md')), {code: 'ENOENT'});
});

test('sync apply reports a Projection config write failure after rebuilding generated content', async t => {
    const root = await createSourceCheckout(t);
    const stateAdapter = cleanState([]);
    const createFilesystem = async (/** @type {Parameters<typeof createScopedFilesystem>[0]} */ options) => {
        const created = await createSuccessfulFilesystem(options);
        return {
            ...created,
            scopedFilesystem: {
                ...created.scopedFilesystem,
                async write(/** @type {{bytes: Buffer, mode: 'create' | 'create-atomic' | 'replace', path: string}} */ request) {
                    if (request.path === 'distribution/projections/config.json') {
                        return injectedFailure('filesystem-file-replace');
                    }
                    return created.scopedFilesystem.write(request);
                },
            },
        };
    };
    const analysis = await prepareWorkflowDistributionReview({repositoryRoot: root, stateAdapter});
    const plan = requireSyncPlan(await prepareWorkflowDistributionSync({
        createFilesystem,
        repositoryRoot: root,
        review: completedReview(analysis),
        stateAdapter,
    }));
    const result = await applyWorkflowDistributionSync({
        authorization: {approved: true, planDigest: plan.planDigest},
        plan,
    });
    assert.deepEqual(result, {
        diagnostics: [{code: 'injected-failure', message: 'Injected failure.'}],
        stage: 'projection-config-write',
        status: 'failed',
    });
    assert.equal('completedOperations' in result, false);
    assert.equal('rollback' in result, false);
    await assert.rejects(readFile(join(root, 'distribution', 'skills', 'obsolete', 'SKILL.md')), {code: 'ENOENT'});
    assert.equal(
        await readFile(join(root, 'distribution', 'baseline', 'AGENTS.md'), 'utf8'),
        '<!-- arw:managed:start -->\nManaged root.\n<!-- arw:managed:end -->\n<!-- arw:repository-owned:start -->\nNone.\n<!-- arw:repository-owned:end -->\n',
    );
});

test('sync apply reports final rebuilt Distribution validation failure without rollback fields', async t => {
    const root = await createSourceCheckout(t);
    const stateAdapter = cleanState([]);
    const analysis = await prepareWorkflowDistributionReview({repositoryRoot: root, stateAdapter});
    const plan = requireSyncPlan(await prepareWorkflowDistributionSync({
        buildDistribution: async () => injectedFailure('distribution-build'),
        repositoryRoot: root,
        review: completedReview(analysis),
        stateAdapter,
    }));
    assert.equal(plan.status, 'succeeded', JSON.stringify(plan.diagnostics));

    const result = await applyWorkflowDistributionSync({
        authorization: {approved: true, planDigest: plan.planDigest},
        plan,
    });
    assert.deepEqual(result, {
        diagnostics: [{code: 'injected-failure', message: 'Injected failure.'}],
        stage: 'final-validation',
        status: 'failed',
    });
    assert.equal('completedOperations' in result, false);
    assert.equal('rollback' in result, false);
    await assert.rejects(readFile(join(root, 'distribution', 'skills', 'obsolete', 'SKILL.md')), {code: 'ENOENT'});
    assert.equal(
        await readFile(join(root, 'distribution', 'baseline', 'AGENTS.md'), 'utf8'),
        '<!-- arw:managed:start -->\nManaged root.\n<!-- arw:managed:end -->\n<!-- arw:repository-owned:start -->\nNone.\n<!-- arw:repository-owned:end -->\n',
    );
});

test('sync prepare preserves exact text when review deletes a normalization candidate', async t => {
    const root = await createSourceCheckout(t);
    const stateAdapter = cleanState([]);
    const analysis = await prepareWorkflowDistributionReview({repositoryRoot: root, stateAdapter});
    const review = completedReview(analysis);
    review.skillReferenceNormalizations = [];
    review.skillReferenceNormalizationsHash = sha256(Buffer.alloc(0));

    const plan = requireSyncPlan(await prepareWorkflowDistributionSync({repositoryRoot: root, review, stateAdapter}));
    assert.equal(plan.status, 'succeeded', JSON.stringify(plan.diagnostics));

    const applied = await applyWorkflowDistributionSync({
        authorization: {approved: true, planDigest: plan.planDigest},
        plan,
    });
    assert.equal(applied.status, 'succeeded', JSON.stringify(applied.diagnostics));
    assert.equal(
        await readFile(join(root, 'distribution', 'skills', 'review', 'SKILL.md'), 'utf8'),
        'Use $review and $external.\n',
    );
});

test('sync prepare blocks when review deletes a Skill identity still required by the projected bytes', async t => {
    const root = await createSourceCheckout(t);
    const stateAdapter = cleanState([]);
    const analysis = await prepareWorkflowDistributionReview({repositoryRoot: root, stateAdapter});
    const review = completedReview(analysis);
    review.additionalSkillReferences = [];
    review.additionalSkillReferencesHash = sha256(Buffer.alloc(0));
    const result = await prepareWorkflowDistributionSync({repositoryRoot: root, review, stateAdapter});
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics.map(entry => entry.code), ['skill-reference-unresolved']);
    assert.equal('planDigest' in result, false);
});

test('sync prepare exposes only a digest and apply directly rebuilds the fixed generated range', async t => {
    const root = await createSourceCheckout(t);
    await write(root, '.agents/skills/reviewer-benchmark/SKILL.md', 'Use $reviewer-benchmark and $source-only-external.\n');
    await write(root, '.agents/skills/reviewer-benchmark/agents/openai.yaml', 'policy:\n  allow_implicit_invocation: false\n');
    await write(root, '.agents/skills/reviewer-benchmark/references/strata.md', 'Source-only model operations.\n');
    const stateAdapter = cleanState([]);
    const analysis = await prepareWorkflowDistributionReview({repositoryRoot: root, stateAdapter});
    await write(root, 'distribution/rogue/nested.txt', 'obsolete\n');
    const configurationBefore = await readFile(join(root, 'distribution', 'config.json'));

    const plan = requireSyncPlan(await prepareWorkflowDistributionSync({
        repositoryRoot: root,
        review: completedReview(analysis),
        stateAdapter,
    }));
    assert.deepEqual(Object.keys(plan), ['diagnostics', 'planDigest', 'status']);
    assert.deepEqual(plan.diagnostics, []);
    assert.match(plan.planDigest, /^[0-9a-f]{64}$/u);
    assert.equal(await readFile(join(root, 'distribution', 'rogue', 'nested.txt'), 'utf8'), 'obsolete\n');

    const result = await applyWorkflowDistributionSync({
        authorization: {approved: true, planDigest: plan.planDigest},
        plan,
    });
    assert.deepEqual(result, {diagnostics: [], status: 'succeeded'});
    await assert.rejects(readFile(join(root, 'distribution', 'rogue', 'nested.txt')), {code: 'ENOENT'});
    await assert.rejects(readFile(join(root, 'distribution', 'skills', 'obsolete', 'SKILL.md')), {code: 'ENOENT'});
    assert.deepEqual(await readFile(join(root, 'distribution', 'config.json')), configurationBefore);
    const built = await buildWorkflowDistribution({distributionDirectory: join(root, 'distribution')});
    assert.equal(built.status, 'succeeded', JSON.stringify(built.diagnostics));
    if (built.status !== 'succeeded') throw new Error('Expected rebuilt Workflow Distribution.');
    assert.equal(built.payload.some(file => file.path.startsWith('skills/reviewer-benchmark/')), false);
    assert.ok(built.payload.some(file => file.path === 'baseline/docs/agents/roles/reviewer.md'));
    for (const [platform, adapter] of /** @type {const} */ ([
        ['codex', createCodexPlatformAdapter()],
        ['claude-code', createClaudeCodePlatformAdapter()],
    ])) {
        const projected = adapter.evaluate({
            payload: built.payload, platform, profile: {platforms: [platform]},
            projectionConfig: built.projectionConfig, seedTargets: {},
        });
        assert.equal(projected.status, 'succeeded', JSON.stringify(projected.diagnostics));
        if (projected.status !== 'succeeded') throw new Error('Expected platform projection.');
        assert.equal(projected.managedTargets.some(file => file.path.includes('/reviewer-benchmark/')), false);
        assert.ok(projected.managedTargets.some(file => file.path.endsWith('/review/SKILL.md')));
        assert.ok(projected.managedTargets.some(file => file.path === 'docs/agents/roles/reviewer.md'));
    }
});
