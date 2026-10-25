import assert from 'node:assert/strict';
import {mkdir, symlink, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {createScopedFilesystem} from '../../lib/common/filesystem.mjs';
import {
    analyzeSkillReferences,
    createClaudeCodePlatformAdapter,
    createCodexPlatformAdapter,
    validateProjectionConfig,
} from '../../lib/arw-common/platform-adapter.mjs';
import {buildWorkflowDistribution, validateDistributionConfig} from '../../lib/workflow-distribution/workflow-distribution.mjs';
import {checkWorkflowDistributionProduction} from '../../scripts/check-workflow-distribution.mjs';

/** @param {Awaited<ReturnType<typeof buildWorkflowDistribution>>} result */
const requireBuiltDistribution = result => {
    assert.equal(result.status, 'succeeded', JSON.stringify(result.diagnostics));
    if (result.status !== 'succeeded') throw new Error('Expected a built Workflow Distribution.');
    return result;
};

/** @template {{status: string}} T @param {T} result */
const requireProjection = result => {
    assert.equal(result.status, 'succeeded');
    if (!('managedTargets' in result) || !('repositoryOwnedSeeds' in result)) {
        throw new Error('Expected a successful platform projection.');
    }
    return result;
};

const projectionConfig = ({configured = true} = {}) => ({
    source: 'codex',
    skills: {
        root: 'skills/',
        additionalSkillReferences: configured ? ['external'] : [],
        skillReferenceNormalizations: configured ? [{
            path: 'skills/review/SKILL.md',
            line: 1,
            column: 17,
            identity: 'external',
        }] : [],
    },
    platforms: {
        codex: {
            supportedVersionRange: '*',
            format: {
                skillReference: '${name}',
                /** @type {string[]} */
                excludedSkillPaths: [],
            },
            targets: {skills: '.agents/skills/', configuration: '.codex/config.toml'},
        },
        'claude-code': {
            supportedVersionRange: '*',
            format: {
                skillReference: '/{name}',
                excludedSkillPaths: ['agents/openai.yaml'],
            },
            targets: {skills: '.claude/skills/'},
        },
    },
});

const distributionConfig = {
    repositoryOwnedSeeds: ['.arwignore'],
};

const write = async (/** @type {string} */ root, /** @type {string} */ path, /** @type {string | NodeJS.ArrayBufferView<ArrayBufferLike> | Buffer<ArrayBuffer> | Iterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>> | AsyncIterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>>} */ contents) => {
    const target = join(root, ...path.split('/'));
    await mkdir(dirname(target), {recursive: true});
    await writeFile(target, contents);
};

const createDistribution = async (/** @type {test.TestContext} */ t, {exactFileSeed = false} = {}) => {
    const root = await createTemporaryDirectory(t, 'arw-distribution-');
    const configuration = exactFileSeed
        ? {...distributionConfig, repositoryOwnedSeeds: ['.arwignore', '.custom']}
        : distributionConfig;
    await write(root, 'config.json', `${JSON.stringify(configuration, null, 2)}\n`);
    await write(root, 'projections/config.json', `${JSON.stringify(projectionConfig(), null, 2)}\n`);
    await write(root, 'projections/codex/config.toml', 'include_collaboration_mode_instructions = false\n');
    await write(root, 'baseline/.arwignore', '.tmp/\n');
    if (exactFileSeed) await write(root, 'baseline/.custom', 'distribution default\n');
    await write(root, 'baseline/AGENTS.md', '<!-- arw:managed:start -->\nmanaged\n<!-- arw:managed:end -->\n');
    await write(root, 'baseline/docs/agents/roles/reviewer.md', '# Reviewer\n');
    await write(root, 'skills/review/SKILL.md', 'Use $review and $external.\n');
    await write(root, 'skills/review/agents/openai.yaml', 'interface:\n  display_name: Review\n');
    return root;
};

const invalidUtf8ProjectionConfig = () => {
    const source = JSON.stringify(projectionConfig());
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

test('Workflow Distribution reads cross-batch payload files concurrently while preserving the first sorted failure', async t => {
    const root = await createDistribution(t);
    const batchPaths = Array.from({length: 17}, (_, index) => `baseline/batch-${String(index).padStart(2, '0')}.txt`);
    await Promise.all(batchPaths.map((path, index) => write(root, path, `batch ${index}\n`)));
    const complete = requireBuiltDistribution(await buildWorkflowDistribution({distributionDirectory: root}));
    const payloadPaths = complete.payload.map(entry => entry.path);
    assert.deepEqual(payloadPaths, [...payloadPaths].sort());
    assert.deepEqual(complete.payload.filter(entry => batchPaths.includes(entry.path)), batchPaths.map((path, index) => ({
        bytes: Buffer.from(`batch ${index}\n`),
        path,
    })));
    const firstFailurePath = payloadPaths[16];
    const laterFailurePath = payloadPaths[17];
    assert.equal(batchPaths.includes(firstFailurePath), true);
    assert.equal(batchPaths.includes(laterFailurePath), true);
    let laterReadStarted = false;
    const createFilesystem = async (/** @type {Parameters<typeof createScopedFilesystem>[0]} */ input) => {
        const opened = await createScopedFilesystem(input);
        if (opened.status !== 'succeeded') return opened;
        const filesystem = opened.scopedFilesystem;
        return {
            ...opened,
            scopedFilesystem: {
                ...filesystem,
                read: async (/** @type {Parameters<typeof filesystem.read>[0]} */ request) => {
                    if (request.path === firstFailurePath) {
                        await new Promise(resolve => setImmediate(resolve));
                        throw new Error('first second-batch read failure');
                    }
                    if (request.path === laterFailurePath) {
                        laterReadStarted = true;
                        throw new Error('later second-batch read failure');
                    }
                    return filesystem.read(request);
                },
            },
        };
    };

    await assert.rejects(
        buildWorkflowDistribution({createFilesystem, distributionDirectory: root}),
        /first second-batch read failure/,
    );
    assert.equal(laterReadStarted, true);
});

test('Workflow Distribution rejects invalid on-demand Role document layouts', async t => {
    for (const scenario of [
        {
            label: 'orphan directory',
            mutate: (/** @type {string} */ root) => mkdir(join(root, 'baseline', 'docs', 'agents', 'roles', 'orphan')),
        },
        {
            label: 'deeper directory',
            mutate: (/** @type {string} */ root) => write(root, 'baseline/docs/agents/roles/reviewer/checks/details.md', '# Details\n'),
        },
        {
            label: 'non-Markdown document',
            mutate: (/** @type {string} */ root) => write(root, 'baseline/docs/agents/roles/reviewer/checks.txt', 'checks\n'),
        },
    ]) {
        await t.test(scenario.label, async t => {
            const root = await createDistribution(t);
            await scenario.mutate(root);

            const result = await buildWorkflowDistribution({distributionDirectory: root});

            assert.equal(result.status, 'blocked');
            assert.ok(result.diagnostics.some(entry => entry.code === 'role-root-entry-invalid'), JSON.stringify(result.diagnostics));
            assert.equal('payload' in result, false);
        });
    }
});

test('Workflow Distribution rejects a direct file where a Skill Package directory is required', async t => {
    const root = await createDistribution(t);
    await write(root, 'skills/not-a-package', '# Not a package\n');

    const result = await buildWorkflowDistribution({distributionDirectory: root});
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics, [{
        code: 'distribution-skill-package-invalid',
        message: 'Each direct child of skills/ must be a Skill Package directory.',
        path: 'skills/not-a-package',
    }]);
});

test('Workflow Distribution rejects invalid UTF-8 configuration before JSON replacement decoding', async t => {
    const root = await createDistribution(t);
    await write(root, 'projections/config.json', invalidUtf8ProjectionConfig());
    await write(root, 'projections/codex/config.toml', 'include_collaboration_mode_instructions = false\n');

    const result = await buildWorkflowDistribution({distributionDirectory: root});
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics.map(entry => [entry.code, entry.path]), [
        ['invalid-utf8', 'projections/config.json'],
    ]);
});

test('Workflow Distribution blocks malformed repository-owned seed types without throwing', async t => {
    const root = await createDistribution(t);
    await write(root, 'config.json', `${JSON.stringify({
        ...distributionConfig,
        repositoryOwnedSeeds: [1],
    }, null, 2)}\n`);

    const result = await buildWorkflowDistribution({distributionDirectory: root});
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics.map(entry => entry.code), ['repository-owned-seeds-invalid']);
    assert.equal('payload' in result, false);
});

test('Workflow Distribution rejects a retired native Reviewer seed path', async t => {
    const root = await createDistribution(t);
    await write(root, 'projections/agent-role-seeds/rogue.txt', 'rogue\n');

    const result = await buildWorkflowDistribution({distributionDirectory: root});
    assert.equal(result.status, 'blocked');
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.every(entry => entry.code === 'distribution-layout-entry-unknown'));
    assert.equal('payload' in result, false);
});

test('Distribution and projection configs reject non-normalized POSIX paths', () => {
    for (const target of ['.agents/./skills/', '.agents//skills/', '.agents\\skills/', '.agents/\0skills/']) {
        const configuration = projectionConfig();
        configuration.platforms.codex.targets.skills = target;
        assert.deepEqual(validateProjectionConfig(configuration).map(entry => entry.code), ['projection-targets-invalid']);
    }

    for (const path of ['baseline/./policy', 'baseline\\policy', 'baseline/\0policy']) {
        const seedConfiguration = structuredClone(distributionConfig);
        seedConfiguration.repositoryOwnedSeeds[0] = path;
        assert.deepEqual(validateDistributionConfig(seedConfiguration).map(entry => entry.code), ['repository-owned-seeds-invalid']);
    }

    const retiredConfiguration = {...distributionConfig, verifications: {}};
    assert.deepEqual(validateDistributionConfig(retiredConfiguration).map(entry => entry.code), ['distribution-config-invalid']);
});

test('Distribution and projection configs reject an exact parent traversal through Filesystem containment', () => {
    const seedConfiguration = structuredClone(distributionConfig);
    seedConfiguration.repositoryOwnedSeeds[0] = '..';
    assert.deepEqual(validateDistributionConfig(seedConfiguration).map(entry => entry.code), ['repository-owned-seeds-invalid']);

    const projectionConfiguration = projectionConfig();
    projectionConfiguration.platforms.codex.format.excludedSkillPaths = ['..'];
    assert.deepEqual(validateProjectionConfig(projectionConfiguration).map(entry => entry.code), ['projection-format-invalid']);
});

test('Projection configuration owns safe platform format values', () => {
    const configuration = projectionConfig();
    configuration.platforms.codex.format = {
        excludedSkillPaths: ['agents/custom.yaml'],
        skillReference: '@{name}',
    };
    assert.deepEqual(validateProjectionConfig(configuration), []);

    for (const format of [
        {...configuration.platforms.codex.format, agentRoleSeedExtension: '.toml'},
        {...configuration.platforms.codex.format, excludedSkillPaths: ['z.yaml', 'a.yaml']},
        {...configuration.platforms.codex.format, skillReference: '@name'},
    ]) {
        const invalid = structuredClone(configuration);
        invalid.platforms.codex.format = format;
        assert.deepEqual(validateProjectionConfig(invalid).map(entry => entry.code), ['projection-format-invalid']);
    }
});

test('Workflow Distribution rejects linked entries without returning a partial payload', async t => {
    const root = await createDistribution(t);
    const outside = await createTemporaryDirectory(t, 'arw-distribution-outside-');
    try {
        await symlink(outside, join(root, 'baseline', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
            t.skip('This host does not permit creation of a test link.');
            return;
        }
        throw error;
    }
    const result = await buildWorkflowDistribution({distributionDirectory: root});
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics.map(entry => entry.code), ['filesystem-link-unsupported']);
    assert.equal('payload' in result, false);
});

test('Platform Adapter blocks malformed normalization and payload entries without throwing', () => {
    const validConfiguration = projectionConfig({configured: false});
    const malformedConfiguration = {
        ...validConfiguration,
        skills: {...validConfiguration.skills, skillReferenceNormalizations: [null]},
    };
    assert.deepEqual(validateProjectionConfig(malformedConfiguration), [{
        code: 'projection-normalizations-invalid',
        message: 'Skill reference normalizations must be valid and sorted by path, line, column, and identity.',
    }]);

    const malformedPayload = [null];
    assert.deepEqual(analyzeSkillReferences({
        payload: malformedPayload,
        projectionConfig: projectionConfig({configured: false}),
    }), {
        diagnostics: [{
            code: 'projection-payload-invalid',
            message: 'A payload entry is invalid.',
            path: '0',
        }],
        status: 'blocked',
    });
    assert.deepEqual(createCodexPlatformAdapter().evaluate({
        payload: malformedPayload,
        platform: 'codex',
        profile: {platforms: ['codex']},
        projectionConfig: projectionConfig({configured: false}),
        seedTargets: {},
    }), {
        diagnostics: [{
            code: 'projection-payload-invalid',
            message: 'A payload entry is invalid.',
            path: '0',
        }],
        status: 'blocked',
    });
});

test('one configuration-driven Platform Adapter projects exact Codex and Claude Code bytes', async t => {
    const root = await createDistribution(t);
    const distribution = requireBuiltDistribution(await buildWorkflowDistribution({distributionDirectory: root}));
    const codex = requireProjection(createCodexPlatformAdapter().evaluate({
        payload: distribution.payload,
        platform: 'codex',
        profile: {platforms: ['codex']},
        projectionConfig: distribution.projectionConfig,
        seedTargets: {},
    }));
    assert.equal(codex.status, 'succeeded', JSON.stringify(codex.diagnostics));
    const codexSkill = codex.managedTargets.find(entry => entry.path === '.agents/skills/review/SKILL.md');
    if (codexSkill === undefined) throw new Error('Expected projected Codex Skill.');
    assert.equal(codexSkill.bytes.toString('utf8'), 'Use $review and $external .\n');
    assert.ok(codex.managedTargets.some(entry => entry.path === '.agents/skills/review/agents/openai.yaml'));
    assert.deepEqual(codex.repositoryOwnedSeeds, []);

    const claude = requireProjection(createClaudeCodePlatformAdapter().evaluate({
        payload: distribution.payload,
        platform: 'claude-code',
        profile: {platforms: ['claude-code']},
        projectionConfig: distribution.projectionConfig,
        seedTargets: {},
    }));
    assert.equal(claude.status, 'succeeded', JSON.stringify(claude.diagnostics));
    const claudeSkill = claude.managedTargets.find(entry => entry.path === '.claude/skills/review/SKILL.md');
    if (claudeSkill === undefined) throw new Error('Expected projected Claude Code Skill.');
    assert.equal(claudeSkill.bytes.toString('utf8'), 'Use /review and /external .\n');
    assert.equal(claude.managedTargets.some(entry => entry.path.endsWith('agents/openai.yaml')), false);
    const claudeDocument = claude.managedTargets.find(entry => entry.path === 'CLAUDE.md');
    if (claudeDocument === undefined) throw new Error('Expected projected CLAUDE.md.');
    assert.equal(claudeDocument.bytes.toString('utf8'), '@AGENTS.md\n');
});

test('Platform Adapter blocks a collision between managed targets and repository-owned seeds', async t => {
    const root = await createDistribution(t);
    const distribution = requireBuiltDistribution(await buildWorkflowDistribution({distributionDirectory: root}));
    const path = '.agents/skills/review/SKILL.md';
    const result = createCodexPlatformAdapter().evaluate({
        payload: [
            ...distribution.payload,
            {bytes: Buffer.from('Repository seed.\n'), path: `baseline/${path}`},
        ].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
        platform: 'codex',
        profile: {platforms: ['codex']},
        projectionConfig: distribution.projectionConfig,
        seedTargets: {[path]: null},
    });

    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics, [{
        code: 'projection-target-collision',
        message: 'Multiple projection entries target the same path.',
        path,
        relatedPath: path,
    }]);
    assert.equal('managedTargets' in result, false);
    assert.equal('repositoryOwnedSeeds' in result, false);
});

test('Platform Adapter classifies every supplied exact file seed as repository-owned', async t => {
    const root = await createDistribution(t, {exactFileSeed: true});
    const distribution = requireBuiltDistribution(await buildWorkflowDistribution({distributionDirectory: root}));
    const adapter = createCodexPlatformAdapter();
    const created = requireProjection(adapter.evaluate({
        payload: distribution.payload,
        platform: 'codex',
        profile: {platforms: ['codex']},
        projectionConfig: distribution.projectionConfig,
        seedTargets: {'.arwignore': null, '.custom': null},
    }));
    assert.equal(created.status, 'succeeded', JSON.stringify(created.diagnostics));
    assert.equal(created.managedTargets.some(entry => entry.path === '.custom'), false);
    assert.deepEqual(
        created.repositoryOwnedSeeds.find(entry => entry.path === '.custom'),
        {
            action: 'create',
            bytes: Buffer.from('distribution default\n'),
            path: '.custom',
            source: 'baseline/.custom',
            strategy: 'regular-file',
        },
    );

    const compatible = requireProjection(adapter.evaluate({
        payload: distribution.payload,
        platform: 'codex',
        profile: {platforms: ['codex']},
        projectionConfig: distribution.projectionConfig,
        seedTargets: {'.arwignore': null, '.custom': Buffer.from('repository value\n')},
    }));
    assert.equal(compatible.status, 'succeeded', JSON.stringify(compatible.diagnostics));
    assert.equal(compatible.repositoryOwnedSeeds.find(entry => entry.path === '.custom')?.action, 'compatible');
});

test('Platform Adapter blocks invalid UTF-8 before transforming baseline AGENTS bytes', async t => {
    const root = await createDistribution(t);
    const distribution = requireBuiltDistribution(await buildWorkflowDistribution({distributionDirectory: root}));
    const payload = distribution.payload.map((/** @type {{ path: string; }} */ entry) => entry.path === 'baseline/AGENTS.md'
        ? {bytes: Buffer.from([0xc3, 0x28]), path: entry.path}
        : entry);

    const result = createCodexPlatformAdapter().evaluate({
        payload,
        platform: 'codex',
        profile: {codeMaps: {roots: ['lib']}, platforms: ['codex']},
        projectionConfig: distribution.projectionConfig,
        seedTargets: {},
    });

    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics, [{
        code: 'baseline-document-invalid-utf8',
        message: 'A transformed baseline document is not valid UTF-8.',
        path: 'baseline/AGENTS.md',
    }]);
    assert.equal('managedTargets' in result, false);
});

test('production check rejects conflicting targets produced across configured platforms', async t => {
    const root = await createDistribution(t);
    const adapter = (/** @type {string} */ bytes) => ({
        evaluate: (/** @type {{platform: string}} */ {platform}) => ({
            diagnostics: [],
            managedTargets: [{bytes: Buffer.from(bytes), path: 'shared.md', source: `platform:${platform}`}],
            repositoryOwnedSeeds: [],
            status: 'succeeded',
        }),
    });

    assert.deepEqual(await checkWorkflowDistributionProduction({
        adapters: {
            'claude-code': adapter('claude\n'),
            codex: adapter('codex\n'),
        },
        distributionDirectory: root,
    }), {
        diagnostics: [{
            code: 'managed-target-conflict',
            message: 'Selected platforms produced different bytes for one managed target.',
            path: 'shared.md',
        }],
        status: 'failed',
    });
});

test('production check rejects a managed target that collides with a seed from another platform', async t => {
    const root = await createDistribution(t);
    const result = await checkWorkflowDistributionProduction({
        adapters: {
            'claude-code': {
                evaluate: () => ({
                    diagnostics: [],
                    managedTargets: [{bytes: Buffer.from('managed\n'), path: 'shared.md', source: 'claude-code'}],
                    repositoryOwnedSeeds: [],
                    status: 'succeeded',
                }),
            },
            codex: {
                evaluate: () => ({
                    diagnostics: [],
                    managedTargets: [],
                    repositoryOwnedSeeds: [{
                        action: 'create',
                        bytes: Buffer.from('seed\n'),
                        path: 'shared.md',
                        source: 'codex',
                        strategy: 'regular-file',
                    }],
                    status: 'succeeded',
                }),
            },
        },
        distributionDirectory: root,
    });

    assert.deepEqual(result, {
        diagnostics: [{
            code: 'projection-target-collision',
            message: 'Multiple projection entries target the same path.',
            path: 'shared.md',
        }],
        status: 'failed',
    });
});
