import assert from 'node:assert/strict';
import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {runGit as git} from '../helpers/git.mjs';
import {createRepository as createGitRepository} from '../helpers/repository-fixture.mjs';
import {composePlatformResults, createNodeRepositoryFilesystem, runRepositoryWorkflow as runRepositoryWorkflowImplementation} from '../../lib/repository-workflow/workflow.mjs';
import {parseWorkflowLock} from '../../lib/repository-workflow/workflow-lock.mjs';
import {buildWorkflowDistribution} from '../../lib/workflow-distribution/workflow-distribution.mjs';
import {serializeCanonicalJson} from '../../lib/common/canonical-contract.mjs';

/** @typedef {Parameters<typeof runRepositoryWorkflowImplementation>[0]} WorkflowOptions */
/** @typedef {Extract<Awaited<ReturnType<typeof buildWorkflowDistribution>>, {status: 'succeeded'}>} BuiltDistribution */
/** @typedef {{applied?: boolean, authorized?: boolean, cancelled?: boolean, diagnostics: Array<{blocking?: boolean, code?: string, message?: string, path?: string, phase?: number}>, dryRun?: boolean, handoff?: {auditRequired: boolean, checklist: string[], completionIssue: null | {kind: string, paths: string[]}, gaps: string[]}, plan?: {operations: Array<{action: string, path: string}>} | null, satisfied?: boolean, verified?: boolean}} WorkflowResult */

/** @returns {Promise<WorkflowResult>} */
const runRepositoryWorkflow = async (/** @type {WorkflowOptions} */ options) => runRepositoryWorkflowImplementation(options);

const write = async (/** @type {string} */ root, /** @type {string} */ path, /** @type {string | NodeJS.ArrayBufferView<ArrayBufferLike> | Iterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>> | AsyncIterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>>} */ contents) => {
    const target = join(root, ...path.split('/'));
    await mkdir(dirname(target), {recursive: true});
    await writeFile(target, contents);
};

const distributionConfig = {
    repositoryOwnedSeeds: ['.arwignore'],
};

const projectionConfig = {
    source: 'codex',
    skills: {
        additionalSkillReferences: [],
        root: 'skills/',
        skillReferenceNormalizations: [],
    },
    platforms: {
        codex: {
            format: {
                excludedSkillPaths: [],
                skillReference: '${name}',
            },
            supportedVersionRange: '*',
            targets: {skills: '.agents/skills/', configuration: '.codex/config.toml'},
        },
        'claude-code': {
            format: {
                excludedSkillPaths: ['agents/openai.yaml'],
                skillReference: '/{name}',
            },
            supportedVersionRange: '*',
            targets: {skills: '.claude/skills/'},
        },
    },
};

/** @returns {Promise<BuiltDistribution>} */
const createDistribution = async (/** @type {test.TestContext} */ t, /** @type {{directorySeed?: boolean, exactFileSeed?: boolean, projection?: typeof projectionConfig}} */ {directorySeed = false, exactFileSeed = false, projection = projectionConfig} = {}) => {
    const root = await createTemporaryDirectory(t, 'arw-workflow-distribution-');
    const configuration = {...distributionConfig, repositoryOwnedSeeds: [
        '.arwignore',
        ...(exactFileSeed ? ['.custom'] : []),
        ...(directorySeed ? ['docs/licenses/arw/'] : []),
    ]};
    await write(root, 'config.json', `${JSON.stringify(configuration, null, 2)}\n`);
    await write(root, 'projections/config.json', `${JSON.stringify(projection, null, 2)}\n`);
    await write(root, 'projections/codex/config.toml', 'include_collaboration_mode_instructions = false\n');
    await write(root, 'baseline/.arwignore', '.tmp/\n');
    if (exactFileSeed) await write(root, 'baseline/.custom', 'distribution default\n');
    if (directorySeed) await write(root, 'baseline/docs/licenses/arw/LICENSE.example-source', 'License.\n');
    await write(
        root,
        'baseline/AGENTS.md',
        '<!-- arw:managed:start -->\n- Code Map roots: (none)\n<!-- arw:managed:end -->\n<!-- arw:repository-owned:start -->\nNone.\n<!-- arw:repository-owned:end -->\n',
    );
    await write(root, 'baseline/docs/agents/roles/reviewer.md', '# Reviewer\n');
    await write(root, 'skills/review/SKILL.md', '# Review\n');
    await write(root, 'skills/review/agents/openai.yaml', 'interface:\n  display_name: Review\n');
    const distribution = await buildWorkflowDistribution({distributionDirectory: root});
    assert.equal(distribution.status, 'succeeded', JSON.stringify(distribution.diagnostics));
    if (distribution.status !== 'succeeded') throw new Error('Expected valid Workflow Distribution fixture.');
    return distribution;
};

const createRepository = async (/** @type {test.TestContext} */ t, {localLicenseNote = false} = {}) => {
    const root = await createGitRepository(t, {prefix: 'arw-workflow-repository-'});
    await write(root, '.scratch/.keep', '');
    if (localLicenseNote) await write(root, 'docs/licenses/arw/local-notes.txt', 'Repository notes.\n');
    await git(root, ['add', '.scratch/.keep', ...(localLicenseNote ? ['docs/licenses/arw/local-notes.txt'] : [])]);
    await git(root, ['commit', '--quiet', '-m', 'fixture']);
    return root;
};

const profile = (/** @type {string[]} */ platforms) => ({
    codeMaps: {excludes: [], includes: [], roots: []},
    domainLayout: 'single-context',
    platforms,
});

const initWorkflow = (/** @type {Omit<WorkflowOptions, 'operation'> & {platforms?: string[]}} */ {distribution, platforms = ['codex'], repositoryRoot, ...options}) => runRepositoryWorkflow({
    choices: {
        mode: 'non-interactive',
        platforms,
        profile: profile(platforms),
    },
    distribution,
    operation: 'init',
    repositoryRoot,
    ...options,
});

test('init blocks configured targets excluded by the unified Repository write scope', async t => {
    await t.test('tracked target later excluded by .gitignore', async t => {
        const distribution = await createDistribution(t);
        const root = await createRepository(t);
        await write(root, '.codex/config.toml', 'include_collaboration_mode_instructions = false\n');
        await git(root, ['add', '.codex/config.toml']);
        await git(root, ['commit', '--quiet', '-m', 'tracked configuration']);
        await write(root, '.gitignore', '.codex/\n');
        await git(root, ['add', '.gitignore']);
        await git(root, ['commit', '--quiet', '-m', 'ignore configuration target']);

        const result = await initWorkflow({distribution, repositoryRoot: root});
        assert.deepEqual(result.diagnostics.filter(entry => entry.code === 'excluded-planned-target'), [{
            blocking: true, code: 'excluded-planned-target', message: 'A planned target is outside the Repository Workflow write scope.', path: '.codex/config.toml', phase: 1,
        }]);
    });

    await t.test('target excluded by .arwignore', async t => {
        const distribution = await createDistribution(t);
        const root = await createRepository(t);
        await write(root, '.arwignore', '.codex/\n');
        await git(root, ['add', '.arwignore']);
        await git(root, ['commit', '--quiet', '-m', 'exclude configuration target']);

        const result = await initWorkflow({distribution, repositoryRoot: root});
        assert.ok(result.diagnostics.some(entry => entry.code === 'excluded-planned-target'
            && entry.path === '.codex/config.toml'));
    });

    await t.test('target under intrinsic .git metadata', async t => {
        const projection = {
            ...projectionConfig,
            platforms: {
                ...projectionConfig.platforms,
                codex: {
                    ...projectionConfig.platforms.codex,
                    targets: {
                        ...projectionConfig.platforms.codex.targets,
                        skills: '.git/skills/',
                    },
                },
            },
        };
        const distribution = await createDistribution(t, {projection});
        const root = await createRepository(t);
        const result = await initWorkflow({distribution, repositoryRoot: root});
        assert.ok(result.diagnostics.some(entry => entry.code === 'excluded-planned-target'
            && entry.path === '.git/skills/review/SKILL.md'));
    });
});

test('init writes one v2 transaction and verify ignores repository-owned changes', async t => {
    const distribution = await createDistribution(t);
    const root = await createRepository(t);
    const initialized = await initWorkflow({distribution, repositoryRoot: root});
    assert.equal(initialized.applied, true, JSON.stringify(initialized.diagnostics));
    assert.equal(initialized.verified, true, JSON.stringify(initialized.diagnostics));
    assert.equal(initialized.plan?.operations.at(-1)?.action, 'write-lock');
    const lock = parseWorkflowLock(await readFile(join(root, 'arw-lock.json'), 'utf8'));
    assert.equal(lock.lockSchemaVersion, 2);
    assert.equal('distribution' in lock, false);
    assert.ok(lock.managedTargets.some(record => record.path === 'AGENTS.md'));
    assert.ok(lock.repositoryOwnedSeeds.some(record => record.path === '.arwignore'));

    await writeFile(join(root, '.arwignore'), '# Local exclusions\n', 'utf8');
    const verified = await runRepositoryWorkflow({distribution, operation: 'verify', repositoryRoot: root});
    assert.deepEqual(verified, {diagnostics: [], satisfied: true});
});

test('verify checks configured Code Map coverage', async t => {
    const distribution = await createDistribution(t);
    const root = await createRepository(t);
    await write(root, 'src/index.js', 'export {};\n');
    await git(root, ['add', 'src/index.js']);
    await git(root, ['commit', '--quiet', '-m', 'source without code map']);
    const configuredProfile = {
        codeMaps: {excludes: [], includes: ['src/**'], roots: ['src']},
        domainLayout: 'single-context',
        platforms: ['codex'],
    };
    const initialized = await initWorkflow({
        choices: {mode: 'non-interactive', platforms: ['codex'], profile: configuredProfile},
        distribution,
        repositoryRoot: root,
    });
    assert.equal(initialized.applied, true, JSON.stringify(initialized.diagnostics));

    const verified = await runRepositoryWorkflow({distribution, operation: 'verify', repositoryRoot: root});
    assert.ok(verified.diagnostics.some(entry => entry.code === 'missing-code-map-readme'));
});

test('dual-platform init migrates meaningful CLAUDE.md content into AGENTS.md in the same plan', async t => {
    const distribution = await createDistribution(t);
    const root = await createRepository(t);
    await writeFile(join(root, 'CLAUDE.md'), 'Local Claude instructions.\n', 'utf8');
    await git(root, ['add', 'CLAUDE.md']);
    await git(root, ['commit', '--quiet', '-m', 'local claude instructions']);

    const initialized = await initWorkflow({distribution, platforms: ['codex', 'claude-code'], repositoryRoot: root});
    assert.equal(initialized.applied, true, JSON.stringify(initialized.diagnostics));
    assert.equal(await readFile(join(root, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
    assert.match(await readFile(join(root, 'AGENTS.md'), 'utf8'), /Local Claude instructions\./u);
    const lock = parseWorkflowLock(await readFile(join(root, 'arw-lock.json'), 'utf8'));
    assert.deepEqual(lock.profile.platforms, ['claude-code', 'codex']);
    assert.deepEqual(lock.managedTargets.find(record => record.path === 'AGENTS.md')?.platforms, ['claude-code', 'codex']);
});

test('exact file seeds are created once, enter the lock, and survive remove', async t => {
    const distribution = await createDistribution(t, {exactFileSeed: true});
    const root = await createRepository(t);
    const created = await initWorkflow({
        distribution,
        platforms: ['codex', 'claude-code'],
        repositoryRoot: root,
    });
    assert.equal(created.applied, true, JSON.stringify(created.diagnostics));
    assert.equal(await readFile(join(root, '.custom'), 'utf8'), 'distribution default\n');
    const createdLock = parseWorkflowLock(await readFile(join(root, 'arw-lock.json'), 'utf8'));
    assert.deepEqual(createdLock.repositoryOwnedSeeds.find(record => record.path === '.custom'), {
        kind: 'file',
        ownership: 'repository-owned-seed',
        path: '.custom',
        strategy: 'regular-file',
    });
    assert.equal(createdLock.managedTargets.some(record => record.path === '.custom'), false);

    await git(root, ['add', '.']);
    await git(root, ['commit', '--quiet', '-m', 'initialized']);

    const removed = await runRepositoryWorkflow({
        choices: {
            mode: 'non-interactive',
            removal: {
                arwignore: 'retain',
            },
        },
        operation: 'remove',
        repositoryRoot: root,
    });
    assert.equal(removed.applied, true, JSON.stringify(removed.diagnostics));
    assert.equal(await readFile(join(root, '.custom'), 'utf8'), 'distribution default\n');
});

test('a directory declaration seeds only projected baseline files and leaves other files alone', async t => {
    const distribution = await createDistribution(t, {directorySeed: true});
    const root = await createRepository(t, {localLicenseNote: true});
    const created = await initWorkflow({distribution, repositoryRoot: root});
    assert.equal(created.applied, true, JSON.stringify(created.diagnostics));
    assert.equal(await readFile(join(root, 'docs/licenses/arw/LICENSE.example-source'), 'utf8'), 'License.\n');
    assert.equal(await readFile(join(root, 'docs/licenses/arw/local-notes.txt'), 'utf8'), 'Repository notes.\n');
    const lock = parseWorkflowLock(await readFile(join(root, 'arw-lock.json'), 'utf8'));
    assert.deepEqual(lock.repositoryOwnedSeeds.find(record => record.path === 'docs/licenses/arw/LICENSE.example-source'), {
        kind: 'file', ownership: 'repository-owned-seed', path: 'docs/licenses/arw/LICENSE.example-source', strategy: 'regular-file',
    });
    assert.equal(lock.repositoryOwnedSeeds.some(record => record.path === 'docs/licenses/arw/local-notes.txt'), false);
    assert.equal(lock.managedTargets.some(record => record.path === 'docs/licenses/arw/LICENSE.example-source'), false);
    assert.equal(lock.managedTargets.some(record => record.path === 'docs/agents/roles/reviewer.md'), true);
});

test('update is byte-stable, blocks managed drift, and returns zero-write on post-authorization change', async t => {
    const distribution = await createDistribution(t);
    const root = await createRepository(t);
    const initialized = await initWorkflow({distribution, repositoryRoot: root});
    assert.equal(initialized.applied, true, JSON.stringify(initialized.diagnostics));
    await git(root, ['add', '.']);
    await git(root, ['commit', '--quiet', '-m', 'initialized']);

    const unchanged = await runRepositoryWorkflow({distribution, operation: 'update', repositoryRoot: root});
    assert.equal(unchanged.applied, true, JSON.stringify(unchanged.diagnostics));
    assert.deepEqual(unchanged.plan?.operations, []);

    const changed = await runRepositoryWorkflow({
        beforeApply: async () => writeFile(join(root, '.scratch', '.keep'), 'changed after plan\n'),
        distribution,
        operation: 'update',
        repositoryRoot: root,
    });
    assert.equal(changed.applied, false);
    assert.deepEqual(changed.diagnostics.map(entry => entry.code), ['state-changed-after-preflight']);

    await writeFile(join(root, '.scratch', '.keep'), '');
    await writeFile(join(root, 'docs', 'agents', 'roles', 'reviewer.md'), '# Drift\n', 'utf8');
    const drifted = await runRepositoryWorkflow({allowDirty: true, distribution, operation: 'update', repositoryRoot: root});
    assert.equal(drifted.applied, false);
    assert.ok(drifted.diagnostics.some(entry => entry.code === 'managed-content-drift'));
});

test('update inserts one LF before retained repository-major text', async t => {
    const distribution = await createDistribution(t);
    const repositoryMajorDistribution = {
        ...distribution,
        payload: distribution.payload.map(entry => entry.path === 'baseline/AGENTS.md'
            ? {...entry, bytes: Buffer.from('<!-- arw:managed:start -->\nInitial.\n<!-- arw:managed:end -->')}
            : entry),
    };
    const root = await createRepository(t);
    const initialized = await initWorkflow({distribution: repositoryMajorDistribution, repositoryRoot: root});
    assert.equal(initialized.applied, true, JSON.stringify(initialized.diagnostics));
    await git(root, ['add', '.']);
    await git(root, ['commit', '--quiet', '-m', 'initialized']);

    const agentsPath = join(root, 'AGENTS.md');
    const current = (await readFile(agentsPath, 'utf8')).trimEnd();
    await writeFile(agentsPath, `${current}Local instructions.\n`, 'utf8');
    const changedManagedBytes = Buffer.from('<!-- arw:managed:start -->\nChanged.\n<!-- arw:managed:end -->');
    const changedDistribution = {
        ...repositoryMajorDistribution,
        payload: repositoryMajorDistribution.payload.map(entry => entry.path === 'baseline/AGENTS.md'
            ? {...entry, bytes: changedManagedBytes}
            : entry),
    };

    const updated = await runRepositoryWorkflow({
        allowDirty: true,
        distribution: changedDistribution,
        operation: 'update',
        repositoryRoot: root,
    });
    assert.equal(updated.applied, true, JSON.stringify(updated.diagnostics));
    assert.equal(
        await readFile(agentsPath, 'utf8'),
        '<!-- arw:managed:start -->\nChanged.\n<!-- arw:managed:end -->\nLocal instructions.\n',
    );
});

test('update safely migrates a verified v1 repository-major document to baseline-major ownership', async t => {
    const distribution = await createDistribution(t);
    const oldDistribution = {
        ...distribution,
        payload: distribution.payload.map(entry => entry.path === 'baseline/AGENTS.md'
            ? {...entry, bytes: Buffer.from('<!-- arw:managed:start -->\nOld managed rules.\n<!-- arw:managed:end -->\n')}
            : entry),
    };
    const root = await createRepository(t);
    const initialized = await initWorkflow({distribution: oldDistribution, repositoryRoot: root});
    assert.equal(initialized.applied, true, JSON.stringify(initialized.diagnostics));
    const currentLock = parseWorkflowLock(await readFile(join(root, 'arw-lock.json'), 'utf8'));
    const legacyLock = {
        distribution: {
            digest: 'a'.repeat(64),
            distributionContractVersion: 1,
            minimumArwVersion: '0.2.0',
            provenance: {
                arwModification: 'agent-repository-workflow',
                commit: 'b'.repeat(40),
                license: 'MIT',
                repository: 'https://example.invalid/arw',
            },
            sourceArwVersion: '0.2.0',
        },
        lockSchemaVersion: 1,
        managedContent: currentLock.managedTargets.map((record, index) => ({
            canonicalObjectId: `legacy:${index}`,
            ...(record.kind === 'region' ? {
                documentOwnership: record.documentOwnership,
                regionId: `legacy:region:${index}`,
            } : {}),
            hash: record.hash,
            kind: record.kind,
            path: record.path,
            projections: record.platforms.map(platform => ({platform, projectionContractVersion: 1})),
        })),
        policies: {arwignore: {path: '.arwignore', schemaVersion: 1}},
        profile: currentLock.profile,
        projections: currentLock.profile.platforms.map(platform => ({platform, projectionContractVersion: 1})),
    };
    await writeFile(join(root, 'arw-lock.json'), serializeCanonicalJson(legacyLock));
    await writeFile(
        join(root, 'AGENTS.md'),
        'Repository preface.\n<!-- arw:managed:start -->\nOld managed rules.\n<!-- arw:managed:end -->\nRepository appendix.\n',
    );

    const updated = await runRepositoryWorkflow({
        allowDirty: true,
        distribution,
        operation: 'update',
        repositoryRoot: root,
    });

    assert.equal(updated.applied, true, JSON.stringify(updated.diagnostics));
    assert.equal(updated.diagnostics.some(entry => entry.code === 'existing-agent-document-collision'), false);
    assert.equal(
        await readFile(join(root, 'AGENTS.md'), 'utf8'),
        '<!-- arw:managed:start -->\n- Code Map roots: (none)\n<!-- arw:managed:end -->\n<!-- arw:repository-owned:start -->\nRepository preface.\n\nRepository appendix.\n<!-- arw:repository-owned:end -->\n',
    );
    const migratedLock = parseWorkflowLock(await readFile(join(root, 'arw-lock.json'), 'utf8'));
    assert.equal(migratedLock.lockSchemaVersion, 2);
    assert.equal(migratedLock.managedTargets.find(record => record.path === 'AGENTS.md')?.documentOwnership, 'baseline-major');
});

test('update blocks invalid UTF-8 in repository-owned document bytes without rewriting them', async t => {
    const distribution = await createDistribution(t);
    const repositoryMajorDistribution = {
        ...distribution,
        payload: distribution.payload.map(entry => entry.path === 'baseline/AGENTS.md'
            ? {...entry, bytes: Buffer.from('<!-- arw:managed:start -->\nInitial.\n<!-- arw:managed:end -->')}
            : entry),
    };
    const root = await createRepository(t);
    const initialized = await initWorkflow({distribution: repositoryMajorDistribution, repositoryRoot: root});
    assert.equal(initialized.applied, true, JSON.stringify(initialized.diagnostics));
    await git(root, ['add', '.']);
    await git(root, ['commit', '--quiet', '-m', 'initialized']);

    const agentsPath = join(root, 'AGENTS.md');
    const invalidBytes = Buffer.concat([
        Buffer.from('<!-- arw:managed:start -->\nInitial.\n<!-- arw:managed:end -->\nLocal ', 'utf8'),
        Buffer.from([0xc3, 0x28]),
        Buffer.from('\n', 'utf8'),
    ]);
    await writeFile(agentsPath, invalidBytes);
    const changedDistribution = {
        ...repositoryMajorDistribution,
        payload: repositoryMajorDistribution.payload.map(entry => entry.path === 'baseline/AGENTS.md'
            ? {...entry, bytes: Buffer.from('<!-- arw:managed:start -->\nChanged.\n<!-- arw:managed:end -->')}
            : entry),
    };

    const result = await runRepositoryWorkflow({
        allowDirty: true,
        distribution: changedDistribution,
        operation: 'update',
        repositoryRoot: root,
    });
    assert.equal(result.applied, false);
    assert.ok(result.diagnostics.some(entry => entry.code === 'managed-document-invalid-text'));
    assert.deepEqual(await readFile(agentsPath), invalidBytes);
});

test('remove deletes managed state last while explicitly retaining repository-owned seeds', async t => {
    const distribution = await createDistribution(t);
    const root = await createRepository(t);
    const initialized = await initWorkflow({distribution, repositoryRoot: root});
    assert.equal(initialized.applied, true, JSON.stringify(initialized.diagnostics));
    await git(root, ['add', '.']);
    await git(root, ['commit', '--quiet', '-m', 'initialized']);
    const codexConfiguration = await readFile(join(root, '.codex', 'config.toml'));

    const removed = await runRepositoryWorkflow({
        choices: {
            mode: 'non-interactive',
            removal: {
                arwignore: 'retain',
            },
        },
        operation: 'remove',
        repositoryRoot: root,
    });
    assert.equal(removed.applied, true, JSON.stringify(removed.diagnostics));
    const removalPlan = /** @type {{canonical?: string, operations: Array<{action: string}>, profile?: ReturnType<typeof profile>}} */ (removed.plan);
    assert.equal(removalPlan.operations.at(-1)?.action, 'delete-lock');
    assert.deepEqual(removalPlan.profile, profile(['codex']));
    assert.deepEqual(JSON.parse(removalPlan.canonical ?? '{}').profile, profile(['codex']));
    await assert.rejects(readFile(join(root, 'arw-lock.json')));
    assert.deepEqual(await readFile(join(root, '.codex', 'config.toml')), codexConfiguration);
    assert.equal(await readFile(join(root, '.arwignore'), 'utf8'), '.tmp/\n');
    await assert.rejects(readFile(join(root, 'AGENTS.md')));
});

test('interactive init asks for one Profile and final authorization before writing', async t => {
    const distribution = await createDistribution(t);
    const root = await createRepository(t);
    const beforeEntries = (await readdir(root)).sort();
    const answers = new Map([
        ['platforms', 'codex'],
        ['domain-layout', 'single-context'],
        ['code-map-roots', ''],
        ['confirm-plan', 'yes'],
    ]);
    /** @type {string[]} */
    const asked = [];
    const initialized = await runRepositoryWorkflow({
        choices: {mode: 'interactive'},
        distribution,
        operation: 'init',
        prompt: async question => {
            if (question.id === undefined) throw new Error('Expected prompt id.');
            asked.push(question.id);
            if (question.id === 'confirm-plan') {
                assert.deepEqual((await readdir(root)).sort(), beforeEntries);
            }
            return answers.get(question.id);
        },
        repositoryRoot: root,
    });

    assert.equal(initialized.applied, true, JSON.stringify(initialized.diagnostics));
    assert.deepEqual(asked, ['platforms', 'domain-layout', 'code-map-roots', 'confirm-plan']);
    assert.equal(initialized.handoff?.auditRequired, true);
    assert.ok(initialized.handoff?.checklist.includes('arw workflow verify'));
    assert.ok(initialized.handoff?.checklist.includes('arw terms check'));
});

test('non-interactive init normalizes one trailing Code Map root slash and rejects other unsafe forms', async t => {
    const distribution = await createDistribution(t);
    const root = await createRepository(t);
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'index.js'), 'export {};\n', 'utf8');
    await git(root, ['add', 'src/index.js']);
    await git(root, ['commit', '--quiet', '-m', 'source']);

    const initialized = await runRepositoryWorkflow({
        choices: {
            mode: 'non-interactive',
            platforms: ['codex'],
            profile: {
                codeMaps: {excludes: [], includes: ['src/**'], roots: ['src/']},
                domainLayout: 'single-context',
                platforms: ['codex'],
            },
        },
        distribution,
        operation: 'init',
        repositoryRoot: root,
    });
    assert.equal(initialized.applied, true, JSON.stringify(initialized.diagnostics));
    assert.deepEqual(parseWorkflowLock(await readFile(join(root, 'arw-lock.json'), 'utf8')).profile.codeMaps.roots, ['src']);

    const invalidRoot = await createRepository(t);
    const rejected = await runRepositoryWorkflow({
        choices: {
            mode: 'non-interactive',
            platforms: ['codex'],
            profile: {
                codeMaps: {excludes: [], includes: ['src/**'], roots: ['src//']},
                domainLayout: 'single-context',
                platforms: ['codex'],
            },
        },
        distribution,
        operation: 'init',
        repositoryRoot: invalidRoot,
    });
    assert.equal(rejected.applied, false);
    assert.ok(rejected.diagnostics.some(entry => entry.code === 'invalid-code-map-root'));
    await assert.rejects(readFile(join(invalidRoot, 'arw-lock.json')));
});

test('File Transaction rolls back earlier Workflow files when the lock write fails', async t => {
    const distribution = await createDistribution(t);
    const root = await createRepository(t);
    const baseFilesystem = createNodeRepositoryFilesystem(root);
    const result = await initWorkflow({
        distribution,
        filesystem: {
            ...baseFilesystem,
            async replaceFileAtomically(input) {
                if (input.path === 'arw-lock.json') throw Object.assign(new Error('lock write failed'), {code: 'EIO'});
                return baseFilesystem.replaceFileAtomically(input);
            },
        },
        repositoryRoot: root,
    });

    assert.equal(result.applied, false);
    assert.ok(result.diagnostics.some(entry => entry.code === 'filesystem-operation-failed'));
    await assert.rejects(readFile(join(root, 'arw-lock.json')));
    await assert.rejects(readFile(join(root, 'AGENTS.md')));
    await assert.rejects(readFile(join(root, '.arwignore')));
});

test('init rejects malformed marker-bearing existing AGENTS.md before transformation', async t => {
    for (const scenario of [
        {
            name: 'one-sided managed marker',
            text: '<!-- arw:managed:start -->\n# Local instructions\n',
        },
        {
            name: 'duplicate managed markers',
            text: '<!-- arw:managed:start -->\nFirst.\n<!-- arw:managed:end -->\n<!-- arw:managed:start -->\nSecond.\n<!-- arw:managed:end -->\n',
        },
    ]) {
        await t.test(scenario.name, async t => {
            const distribution = await createDistribution(t);
            for (const transformExistingAgentDocs of [undefined, true]) {
                const root = await createRepository(t);
                await writeFile(join(root, 'AGENTS.md'), scenario.text, 'utf8');
                await git(root, ['add', 'AGENTS.md']);
                await git(root, ['commit', '--quiet', '-m', 'malformed markers']);

                const result = await initWorkflow({
                    distribution,
                    repositoryRoot: root,
                    ...(transformExistingAgentDocs === undefined ? {} : {transformExistingAgentDocs}),
                });
                assert.equal(result.applied, false);
                const diagnosticCodes = result.diagnostics.map(entry => entry.code);
                assert.ok(diagnosticCodes.includes('existing-agent-document-collision'));
                assert.equal(diagnosticCodes.includes('missing-existing-agent-document-choice'), false);
                assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), scenario.text);
                await assert.rejects(readFile(join(root, 'arw-lock.json')));
            }
        });
    }
});

test('init resolves existing Agent text and orphan Code Maps only after explicit choices', async t => {
    const distribution = await createDistribution(t);
    const root = await createRepository(t);
    await write(root, 'AGENTS.md', '# Local instructions\n');
    await write(root, 'src/module/index.js', 'export const value = 1;\n');
    await write(
        root,
        'src/orphan/README.md',
        '---\ncode-map-version: 1\ncode-map-kind: directory\ntitle: Keep me\n---\nOrphan prose.\n',
    );
    await git(root, ['add', 'AGENTS.md', 'src']);
    await git(root, ['commit', '--quiet', '-m', 'repository content']);
    const selectedProfile = {
        codeMaps: {excludes: [], includes: ['src/**/*.js'], roots: ['src']},
        domainLayout: 'single-context',
        platforms: ['codex'],
    };
    const choices = {mode: 'non-interactive', platforms: ['codex'], profile: selectedProfile};

    const blocked = await runRepositoryWorkflow({
        choices,
        distribution,
        operation: 'init',
        repositoryRoot: root,
    });
    assert.equal(blocked.applied, false);
    assert.deepEqual(
        blocked.diagnostics.map(entry => entry.code).filter(code => code?.startsWith('missing-')).sort(),
        ['missing-existing-agent-document-choice', 'missing-orphan-code-map-choice'],
    );
    assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), '# Local instructions\n');
    await assert.rejects(readFile(join(root, 'arw-lock.json')));

    const initialized = await runRepositoryWorkflow({
        choices,
        distribution,
        operation: 'init',
        orphanCodeMapReadmes: 'demote',
        repositoryRoot: root,
        transformExistingAgentDocs: true,
    });
    assert.equal(initialized.applied, true, JSON.stringify(initialized.diagnostics));
    const agents = await readFile(join(root, 'AGENTS.md'), 'utf8');
    assert.match(agents, /arw:managed:start/u);
    assert.match(agents, /# Local instructions/u);
    const orphan = await readFile(join(root, 'src', 'orphan', 'README.md'), 'utf8');
    assert.doesNotMatch(orphan, /code-map-(?:version|kind):/u);
    assert.match(orphan, /title: Keep me/u);
    assert.match(orphan, /Orphan prose\./u);
    assert.ok(initialized.handoff?.completionIssue?.paths.includes('src/module/README.md'));
});

test('update blocks dirty state and invalid Reviewer settings without changing the lock', async t => {
    const distribution = await createDistribution(t);
    const root = await createRepository(t);
    const initialized = await initWorkflow({distribution, repositoryRoot: root});
    assert.equal(initialized.applied, true, JSON.stringify(initialized.diagnostics));
    await git(root, ['add', '.']);
    await git(root, ['commit', '--quiet', '-m', 'initialized']);
    const lockBefore = await readFile(join(root, 'arw-lock.json'));

    await writeFile(join(root, '.scratch', '.keep'), 'dirty\n', 'utf8');
    const dirty = await runRepositoryWorkflow({distribution, operation: 'update', repositoryRoot: root});
    assert.equal(dirty.applied, false);
    assert.ok(dirty.diagnostics.some(entry => entry.code === 'unstaged-tracked-changes'));
    assert.deepEqual(await readFile(join(root, 'arw-lock.json')), lockBefore);

    await writeFile(join(root, '.scratch', '.keep'), '', 'utf8');
    await writeFile(join(root, 'arw.config.json'), '{"configVersion":2,"reviewers":{"code-spec-reviewer":{"serviceTier":"invalid"}}}\n', 'utf8');
    const incompatible = await runRepositoryWorkflow({
        allowDirty: true,
        distribution,
        operation: 'update',
        repositoryRoot: root,
    });
    assert.equal(incompatible.applied, false);
    assert.ok(incompatible.diagnostics.some(entry => entry.code === 'reviewer-configuration-invalid'));
    assert.deepEqual(await readFile(join(root, 'arw-lock.json')), lockBefore);
});

test('remove requires explicit repository-owned seed choices and can delete them', async t => {
    const distribution = await createDistribution(t);
    const root = await createRepository(t);
    const initialized = await initWorkflow({distribution, repositoryRoot: root});
    assert.equal(initialized.applied, true, JSON.stringify(initialized.diagnostics));
    await git(root, ['add', '.']);
    await git(root, ['commit', '--quiet', '-m', 'initialized']);
    const lockBefore = await readFile(join(root, 'arw-lock.json'));

    const blocked = await runRepositoryWorkflow({
        choices: {mode: 'non-interactive', removal: {}},
        operation: 'remove',
        repositoryRoot: root,
    });
    assert.equal(blocked.applied, false);
    assert.ok(blocked.diagnostics.some(entry => entry.code === 'missing-removal-choice'));
    assert.deepEqual(await readFile(join(root, 'arw-lock.json')), lockBefore);

    const removed = await runRepositoryWorkflow({
        choices: {
            mode: 'non-interactive',
            removal: {
                arwignore: 'delete',
            },
        },
        operation: 'remove',
        repositoryRoot: root,
    });
    assert.equal(removed.applied, true, JSON.stringify(removed.diagnostics));
    assert.equal(removed.plan?.operations.at(-1)?.action, 'delete-lock');
    await assert.rejects(readFile(join(root, 'arw-lock.json')));
    await assert.rejects(readFile(join(root, '.arwignore')));
});

test('platform composition rejects configuration collisions across target kinds and platform order', () => {
    const target = {path: '.codex/config.toml', source: 'projections/codex/config.toml', bytes: Buffer.from('include_collaboration_mode_instructions = false\n')};
    const codex = {platform: 'codex', status: 'succeeded', diagnostics: [], configurationDefaults: [target]};
    for (const path of [target.path, '.CODEX/config.toml']) {
        for (const entries of [
            {managedTargets: [{...target, path}]},
            {repositoryOwnedSeeds: [{...target, path, action: 'create', strategy: 'regular-file'}]},
            {configurationDefaults: [{...target, path}]},
        ]) {
            const other = {platform: 'claude-code', status: 'succeeded', diagnostics: [], ...entries};
            for (const results of [[codex, other], [other, codex]]) {
                const result = composePlatformResults(results);
                assert.equal(result.authorized, false);
                assert.ok(result.diagnostics.some(entry => entry.code === 'projection-target-collision' && entry.phase === 2));
            }
        }
    }
    assert.equal(composePlatformResults([codex]).authorized, true);
});

test('init final verification detects Codex settings lost after transaction writes', async t => {
    const distribution = await createDistribution(t);
    const root = await createRepository(t);
    const filesystem = createNodeRepositoryFilesystem(root);
    const initialized = await initWorkflow({
        distribution,
        repositoryRoot: root,
        filesystem: {
            ...filesystem,
            replaceFileAtomically: async input => {
                await filesystem.replaceFileAtomically(input);
                if (input.path === 'arw-lock.json') await write(root, '.codex/config.toml', '# Setting lost\n');
            },
        },
    });
    assert.equal(initialized.applied, true, JSON.stringify(initialized.diagnostics));
    assert.equal(initialized.verified, false);
    assert.ok(initialized.diagnostics.some(entry => entry.code === 'codex-configuration-setting-missing' && entry.phase === 5));
});

test('Codex configuration lifecycle preserves user bytes and stays outside managed lock targets', async t => {
    const distribution = await createDistribution(t);
    const root = await createRepository(t);
    const original = 'model = "example"\r\n[features]\r\nfast = true\r\n';
    await write(root, '.codex/config.toml', original);
    await git(root, ['add', '.']); await git(root, ['commit', '--quiet', '-m', 'user config']);
    const initialized = await initWorkflow({distribution, repositoryRoot: root, platforms: ['codex', 'claude-code']});
    assert.equal(initialized.applied, true, JSON.stringify(initialized.diagnostics));
    assert.equal(initialized.plan?.operations.filter(operation => operation.path === '.codex/config.toml').length, 1);
    const configured = await readFile(join(root, '.codex/config.toml'));
    assert.equal(configured.toString().endsWith(original), true);
    const lock = JSON.parse(await readFile(join(root, 'arw-lock.json'), 'utf8'));
    assert.equal(lock.managedTargets.some((/** @type {{path: string}} */ target) => target.path === '.codex/config.toml'), false);
    assert.equal(lock.repositoryOwnedSeeds.some((/** @type {{path: string}} */ target) => target.path === '.codex/config.toml'), false);
    await git(root, ['add', '.']); await git(root, ['commit', '--quiet', '-m', 'initialized']);
    await write(root, '.codex/config.toml', original);
    const missing = await runRepositoryWorkflow({distribution, operation: 'verify', repositoryRoot: root});
    assert.ok(missing.diagnostics.some(item => item.code === 'codex-configuration-setting-missing'));
    const updated = await runRepositoryWorkflow({allowDirty: true, distribution, operation: 'update', repositoryRoot: root, choices: {mode: 'non-interactive'}});
    assert.equal(updated.applied, true, JSON.stringify(updated.diagnostics));
    assert.deepEqual(await readFile(join(root, '.codex/config.toml')), configured);
});

test('Codex invalid configuration blocks all writes while Claude-only ignores it', async t => {
    const distribution = await createDistribution(t);
    const root = await createRepository(t);
    await write(root, '.codex/config.toml', 'include_collaboration_mode_instructions = "false"\n');
    await git(root, ['add', '.']); await git(root, ['commit', '--quiet', '-m', 'invalid codex config']);
    const index = await git(root, ['write-tree']);
    const blocked = await initWorkflow({distribution, repositoryRoot: root});
    assert.equal(blocked.applied, false);
    assert.ok(blocked.diagnostics.some(item => item.code === 'codex-configuration-invalid'));
    await assert.rejects(readFile(join(root, 'arw-lock.json')));
    assert.deepEqual(await git(root, ['write-tree']), index);
    const claude = await initWorkflow({distribution, repositoryRoot: root, platforms: ['claude-code']});
    assert.equal(claude.applied, true, JSON.stringify(claude.diagnostics));
    assert.equal(claude.plan?.operations.some(operation => operation.path === '.codex/config.toml'), false);
});
