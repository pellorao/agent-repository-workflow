import assert from 'node:assert/strict';
import {mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {dirname, join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {createScopedFilesystem} from '../../lib/common/filesystem.mjs';
import {buildWorkflowDistribution} from '../../lib/workflow-distribution/workflow-distribution.mjs';
import {createClaudeCodePlatformAdapter, createCodexPlatformAdapter} from '../../lib/arw-common/platform-adapter.mjs';
import {
    createSourceCheckoutSyncStateAdapter,
    syncWorkflowDistribution,
} from '../../lib/workflow-distribution/workflow-distribution-sync.mjs';

/** @typedef {NonNullable<Parameters<typeof syncWorkflowDistribution>[0]['stateAdapter']>} SyncStateAdapter */

const BASE_BYTES = 'Use $review and $external now.\n';

/** @param {Parameters<typeof syncWorkflowDistribution>[0]} input */
const requireSync = async input => {
    const result = await syncWorkflowDistribution(input);
    assert.equal(result.status, 'succeeded', JSON.stringify(result.diagnostics));
    if (result.status !== 'succeeded') throw new Error('Expected a successful sync.');
    return result;
};

const createSuccessfulFilesystem = async (/** @type {Parameters<typeof createScopedFilesystem>[0]} */ options) => {
    const created = await createScopedFilesystem(options);
    assert.equal(created.status, 'succeeded', JSON.stringify(created.diagnostics));
    if (created.status !== 'succeeded') throw new Error('Expected scoped filesystem fixture.');
    return created;
};

const distributionConfig = {
    distributedSkills: ['review'],
    repositoryOwnedSeeds: ['.arwignore'],
    sourceOnlySkills: [],
};

const projectionConfig = {
    source: 'codex',
    skills: {root: 'skills/', additionalSkillReferences: []},
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
    await write(root, 'docs/agents/reviewer.md', '<!-- arw:managed:start -->\n# Reviewer Responsibilities\n\nShared reviewer rules.\n<!-- arw:managed:end -->\n<!-- arw:repository-owned:start -->\nNone.\n<!-- arw:repository-owned:end -->\n');
    await write(root, 'docs/agents/reviewer-role-seeds.md', '# Reviewer Role Seeds\n\nSource Checkout only.\n');
    await write(root, 'docs/agents/roles/reviewer.md', '# Reviewer\n');
    await write(root, 'docs/licenses/arw/LICENSE.example-source', 'License.\n');
    await write(root, '.agents/skills/review/SKILL.md', BASE_BYTES);
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

const obsoletePath = (/** @type {string} */ root) => join(root, 'distribution', 'skills', 'obsolete', 'SKILL.md');
const rootAgentsBytes = '<!-- arw:managed:start -->\nManaged root.\n<!-- arw:managed:end -->\n<!-- arw:repository-owned:start -->\nNone.\n<!-- arw:repository-owned:end -->\n';

test('sync checks the whole input range once and rebuilds it with unknown identities as notices', async t => {
    const root = await createSourceCheckout(t);
    const projectionBefore = await readFile(join(root, 'distribution', 'projections', 'config.json'));
    /** @type {string[][]} */
    const calls = [];
    const result = await requireSync({repositoryRoot: root, stateAdapter: cleanState(calls)});
    assert.deepEqual(calls, [['.agents/skills', 'AGENTS.md', 'docs/agents', 'docs/licenses/arw', 'distribution']]);
    assert.deepEqual(result, {
        diagnostics: [],
        notices: [{column: 17, context: '$external now.', identity: 'external', line: 1, path: '.agents/skills/review/SKILL.md'}],
        status: 'succeeded',
    });
    await assert.rejects(readFile(obsoletePath(root)), {code: 'ENOENT'});
    assert.equal(await readFile(join(root, 'distribution', 'skills', 'review', 'SKILL.md'), 'utf8'), BASE_BYTES);
    assert.deepEqual(await readFile(join(root, 'distribution', 'projections', 'config.json')), projectionBefore);
    assert.equal(await readFile(join(root, 'distribution', 'baseline', 'AGENTS.md'), 'utf8'), rootAgentsBytes);
    assert.equal(await readFile(join(root, 'distribution', 'baseline', '.arwignore'), 'utf8'), '.tmp/\n');
    await assert.rejects(
        readFile(join(root, 'distribution', 'baseline', 'docs', 'agents', 'reviewer-role-seeds.md')),
        {code: 'ENOENT'},
    );
    const built = await buildWorkflowDistribution({distributionDirectory: join(root, 'distribution')});
    assert.equal(built.status, 'succeeded', JSON.stringify(built.diagnostics));
});

test('sync returns blocked without writing when an input path is dirty', async t => {
    const root = await createSourceCheckout(t);
    const result = await syncWorkflowDistribution({
        repositoryRoot: root,
        stateAdapter: {
            async inspect() {
                return {diagnostics: [{code: 'sync-input-dirty', message: 'Dirty.', path: 'AGENTS.md'}], status: 'blocked'};
            },
        },
    });
    assert.equal(result.status, 'blocked');
    assert.equal(await readFile(obsoletePath(root), 'utf8'), '# Obsolete\n');
});

test('sync blocks on a known identity with a bad terminator and writes nothing', async t => {
    const root = await createSourceCheckout(t);
    await write(root, '.agents/skills/review/SKILL.md', 'Use $review, then $review');
    const result = await syncWorkflowDistribution({repositoryRoot: root, stateAdapter: cleanState([])});
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics.map(({code, column, line, path}) => ({code, column, line, path})), [
        {code: 'skill-reference-terminator-invalid', column: 5, line: 1, path: '.agents/skills/review/SKILL.md'},
        {code: 'skill-reference-terminator-invalid', column: 19, line: 1, path: '.agents/skills/review/SKILL.md'},
    ]);
    assert.equal(await readFile(obsoletePath(root), 'utf8'), '# Obsolete\n');
});

test('sync reports read failures by closed stage without writing', async t => {
    for (const [stage, failing] of /** @type {const} */ ([
        ['root-observation', {root: 'root-observation'}],
        ['root-resolution', {root: 'root-resolution'}],
        ['source-enumeration', {list: '.agents/skills'}],
        ['source-read', {read: 'AGENTS.md'}],
        ['distribution-enumeration', {list: 'distribution'}],
    ])) {
        await t.test(stage, async t => {
            const root = await createSourceCheckout(t);
            const createFilesystem = async (/** @type {Parameters<typeof createScopedFilesystem>[0]} */ options) => {
                const created = await createSuccessfulFilesystem(options);
                if ('root' in failing) return injectedFailure(failing.root);
                const {scopedFilesystem} = created;
                return {
                    ...created,
                    scopedFilesystem: {
                        ...scopedFilesystem,
                        list: async (/** @type {Parameters<typeof scopedFilesystem.list>[0]} */ input) => 'list' in failing && input?.path === failing.list
                            ? injectedFailure('enumerate')
                            : scopedFilesystem.list(input),
                        read: async (/** @type {Parameters<typeof scopedFilesystem.read>[0]} */ input) => 'read' in failing && input.path === failing.read
                            ? injectedFailure('read')
                            : scopedFilesystem.read(input),
                    },
                };
            };
            const result = await syncWorkflowDistribution({createFilesystem, repositoryRoot: root, stateAdapter: cleanState([])});
            assert.equal(result.status, 'failed');
            assert.equal('stage' in result && result.stage, stage);
            assert.equal(await readFile(obsoletePath(root), 'utf8'), '# Obsolete\n');
        });
    }
});

test('sync reports a Git state read failure with the git-state stage', async t => {
    const root = await createSourceCheckout(t);
    const state = createSourceCheckoutSyncStateAdapter(root, {
        git: {run: async () => ({code: 1, failure: null, stderr: '', stdout: Buffer.alloc(0)})},
    });
    const result = await syncWorkflowDistribution({repositoryRoot: root, stateAdapter: state});
    assert.equal(result.status, 'failed');
    assert.equal('stage' in result && result.stage, 'git-state');
    assert.equal(await readFile(obsoletePath(root), 'utf8'), '# Obsolete\n');
});

test('sync rejects invalid UTF-8 in either Distribution configuration file', async t => {
    for (const path of ['distribution/config.json', 'distribution/projections/config.json']) {
        const root = await createSourceCheckout(t);
        await write(root, path, Buffer.from([0xc3, 0x28]));
        const result = await syncWorkflowDistribution({repositoryRoot: root, stateAdapter: cleanState([])});
        assert.equal(result.status, 'blocked');
        assert.deepEqual(result.diagnostics.map(entry => [entry.code, entry.path]), [['invalid-utf8', path]]);
    }
});

test('sync copies fixed license sources and excludes other direct license-directory files', async t => {
    const root = await createSourceCheckout(t);
    await write(root, 'docs/licenses/arw/NOTICE.md', 'Obsolete notice.\n');
    await write(root, 'distribution/baseline/docs/licenses/arw/NOTICE.md', 'Old projected notice.\n');
    await requireSync({repositoryRoot: root, stateAdapter: cleanState([])});
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
    await requireSync({repositoryRoot: root, stateAdapter: cleanState([])});
    assert.equal(
        await readFile(join(root, 'distribution', 'baseline', 'docs', 'agents', 'roles', 'reviewer', 'checks.md'), 'utf8'),
        '# Reviewer Checks\n',
    );
});

test('sync rejects invalid on-demand Role source layouts before rebuilding', async t => {
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
            await scenario.mutate(root);
            const result = await syncWorkflowDistribution({repositoryRoot: root, stateAdapter: cleanState([])});
            assert.equal(result.status, 'blocked');
            assert.ok(result.diagnostics.some(entry => entry.code === 'role-source-invalid'), JSON.stringify(result.diagnostics));
            assert.equal(await readFile(obsoletePath(root), 'utf8'), '# Obsolete\n');
        });
    }
});

test('sync rejects a case-folded collision between a protected seed and a generated target', async t => {
    const root = await createSourceCheckout(t);
    const configuration = structuredClone(distributionConfig);
    configuration.repositoryOwnedSeeds.push('agents.md');
    await write(root, 'distribution/config.json', `${JSON.stringify(configuration, null, 2)}\n`);
    await write(root, 'distribution/baseline/agents.md', 'Protected seed.\n');
    const result = await syncWorkflowDistribution({repositoryRoot: root, stateAdapter: cleanState([])});
    assert.deepEqual(result, {
        diagnostics: [{
            code: 'sync-protected-target-collision',
            message: 'An actual source target collides with a protected Workflow Distribution path.',
            path: 'distribution/baseline/AGENTS.md',
            relatedPath: 'distribution/baseline/agents.md',
        }],
        status: 'blocked',
    });
    assert.equal(await readFile(join(root, 'distribution', 'baseline', 'agents.md'), 'utf8'), 'Protected seed.\n');
});

/** @param {'remove' | 'write'} method @param {string} path @param {string} stage */
const failingFilesystem = (method, path, stage) => async (/** @type {Parameters<typeof createScopedFilesystem>[0]} */ options) => {
    const created = await createSuccessfulFilesystem(options);
    return {
        ...created,
        scopedFilesystem: {
            ...created.scopedFilesystem,
            [method]: async (/** @type {{path: string}} */ request) => request.path === path
                ? injectedFailure(stage)
                : /** @type {Function} */ (created.scopedFilesystem[method])(request),
        },
    };
};

test('sync reports a cleanup failure without internal rollback', async t => {
    const root = await createSourceCheckout(t);
    const result = await syncWorkflowDistribution({
        createFilesystem: failingFilesystem('remove', 'distribution/skills/obsolete/SKILL.md', 'filesystem-remove'),
        repositoryRoot: root,
        stateAdapter: cleanState([]),
    });
    assert.deepEqual(result, {
        diagnostics: [{code: 'injected-failure', message: 'Injected failure.'}],
        stage: 'cleanup',
        status: 'failed',
    });
    assert.equal(await readFile(obsoletePath(root), 'utf8'), '# Obsolete\n');
});

test('sync reports a generated write failure after deletion without internal rollback', async t => {
    const root = await createSourceCheckout(t);
    const result = await syncWorkflowDistribution({
        createFilesystem: failingFilesystem('write', 'distribution/baseline/AGENTS.md', 'filesystem-file-create'),
        repositoryRoot: root,
        stateAdapter: cleanState([]),
    });
    assert.deepEqual(result, {
        diagnostics: [{code: 'injected-failure', message: 'Injected failure.'}],
        stage: 'generated-write',
        status: 'failed',
    });
    await assert.rejects(readFile(obsoletePath(root)), {code: 'ENOENT'});
    await assert.rejects(readFile(join(root, 'distribution', 'baseline', 'AGENTS.md')), {code: 'ENOENT'});
});

test('sync reports final rebuilt Distribution validation failure without rollback', async t => {
    const root = await createSourceCheckout(t);
    const result = await syncWorkflowDistribution({
        buildDistribution: async () => injectedFailure('distribution-build'),
        repositoryRoot: root,
        stateAdapter: cleanState([]),
    });
    assert.deepEqual(result, {
        diagnostics: [{code: 'injected-failure', message: 'Injected failure.'}],
        stage: 'final-validation',
        status: 'failed',
    });
    await assert.rejects(readFile(obsoletePath(root)), {code: 'ENOENT'});
    assert.equal(await readFile(join(root, 'distribution', 'baseline', 'AGENTS.md'), 'utf8'), rootAgentsBytes);
});

test('sync directly rebuilds the fixed generated range and leaves source-only Skills out', async t => {
    const root = await createSourceCheckout(t);
    await write(root, '.agents/skills/reviewer-capability/SKILL.md', 'Use $reviewer-capability and $source-only-external.\n');
    await write(root, '.agents/skills/reviewer-capability/agents/openai.yaml', 'policy:\n  allow_implicit_invocation: false\n');
    await write(root, '.agents/skills/reviewer-capability/references/strata.md', 'Source-only model operations.\n');
    await write(root, '.agents/skills/release/SKILL.md', 'Source-only release operations.\n');
    await write(root, '.agents/skills/unattended-run/SKILL.md', 'Source-only unattended operations.\n');
    await write(root, 'distribution/config.json', `${JSON.stringify({
        ...distributionConfig,
        sourceOnlySkills: ['release', 'reviewer-capability', 'unattended-run'],
    }, null, 2)}\n`);
    await write(root, 'distribution/rogue/nested.txt', 'obsolete\n');
    const configurationBefore = await readFile(join(root, 'distribution', 'config.json'));
    await requireSync({repositoryRoot: root, stateAdapter: cleanState([])});
    await assert.rejects(readFile(join(root, 'distribution', 'rogue', 'nested.txt')), {code: 'ENOENT'});
    assert.deepEqual(await readFile(join(root, 'distribution', 'config.json')), configurationBefore);
    const built = await buildWorkflowDistribution({distributionDirectory: join(root, 'distribution')});
    assert.equal(built.status, 'succeeded', JSON.stringify(built.diagnostics));
    if (built.status !== 'succeeded') throw new Error('Expected rebuilt Workflow Distribution.');
    assert.equal(built.payload.some(file => /^skills\/(?:reviewer-capability|release|unattended-run)\//u.test(file.path)), false);
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
        assert.equal(projected.managedTargets.some(file => file.path.includes('/reviewer-capability/')), false);
        assert.ok(projected.managedTargets.some(file => file.path.endsWith('/review/SKILL.md')));
        assert.ok(projected.managedTargets.some(file => file.path === 'docs/agents/roles/reviewer.md'));
    }
});

test('sync blocks before deleting anything when Skill registration is wrong', async t => {
    const cases = /** @type {Array<[string, (root: string) => Promise<void>, string]>} */ ([
        ['unregistered Skill', root => write(root, '.agents/skills/extra/SKILL.md', 'extra\n'), 'skill-unregistered'],
        ['stale name', root => write(root, 'distribution/config.json', `${JSON.stringify({...distributionConfig, sourceOnlySkills: ['gone']})}\n`), 'skill-registration-stale'],
        ['invalid list', root => write(root, 'distribution/config.json', `${JSON.stringify({...distributionConfig, distributedSkills: []})}\n`), 'skill-lists-invalid'],
        ['stray file', root => write(root, '.agents/skills/notes.md', 'notes\n'), 'skill-source-path-invalid'],
        ['symbolic link', root => symlink(root, join(root, '.agents', 'skills', 'linked'), 'dir'), 'filesystem-link-unsupported'],
    ]);
    for (const [name, arrange, code] of cases) {
        const root = await createSourceCheckout(t);
        try {
            await arrange(root);
        } catch (error) {
            if (name === 'symbolic link') continue;
            throw error;
        }
        const result = await syncWorkflowDistribution({repositoryRoot: root, stateAdapter: cleanState([])});
        assert.equal(result.status, 'blocked', name);
        assert.ok(result.diagnostics.some(entry => entry.code === code), name);
        assert.equal(await readFile(obsoletePath(root), 'utf8'), '# Obsolete\n', name);
    }
});

test('sync ignores empty Skill directories and fails when .agents/skills is missing', async t => {
    const root = await createSourceCheckout(t);
    await mkdir(join(root, '.agents', 'skills', 'empty'));
    const result = await syncWorkflowDistribution({repositoryRoot: root, stateAdapter: cleanState([])});
    assert.equal(result.status, 'succeeded', JSON.stringify(result.diagnostics));
    const bare = await createSourceCheckout(t);
    await rm(join(bare, '.agents'), {recursive: true});
    const missing = await syncWorkflowDistribution({repositoryRoot: bare, stateAdapter: cleanState([])});
    assert.notEqual(missing.status, 'succeeded');
    assert.ok(missing.diagnostics.length > 0);
    assert.equal(await readFile(obsoletePath(bare), 'utf8'), '# Obsolete\n');
});

test('sync blocks symbolic links in source trees', async t => {
    const root = await createSourceCheckout(t);
    /** @type {typeof createScopedFilesystem} */
    const createFilesystem = async options => {
        const created = await createSuccessfulFilesystem(options);
        const {scopedFilesystem} = created;
        return {
            ...created,
            scopedFilesystem: {
                ...scopedFilesystem,
                createDirectory: async () => assert.fail('No write expected.'),
                remove: async () => assert.fail('No write expected.'),
                setMode: async () => assert.fail('No write expected.'),
                write: async () => assert.fail('No write expected.'),
                list: async input => {
                    const listed = await scopedFilesystem.list(input);
                    return listed.status === 'succeeded' && input?.path === '.agents/skills'
                        ? {...listed, entries: [...listed.entries, {kind: /** @type {const} */ ('link'), path: '.agents/skills/odd'}]}
                        : listed;
                },
            },
        };
    };
    const result = await syncWorkflowDistribution({createFilesystem, repositoryRoot: root, stateAdapter: cleanState([])});
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics.map(entry => [entry.code, entry.path]), [['filesystem-link-unsupported', '.agents/skills/odd']]);
});

test('sync blocks non-regular entries in source trees', {skip: process.platform === 'win32'}, async t => {
    const root = await createSourceCheckout(t);
    const server = createServer();
    await new Promise(resolve => server.listen(join(root, '.agents/skills/odd.sock'), () => resolve(undefined)));
    t.after(() => server.close());
    const result = await syncWorkflowDistribution({repositoryRoot: root, stateAdapter: cleanState([])});
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics.map(entry => [entry.code, entry.path]), [['filesystem-entry-unsupported', '.agents/skills/odd.sock']]);
});
