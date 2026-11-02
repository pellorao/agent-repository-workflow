import assert from 'node:assert/strict';
import {access, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {createRepository, createRepositoryWithMockGit, run} from '../helpers/arw-cli.mjs';
import {runArw} from '../../arw.mjs';
import {parseCommand, UsageError} from '../../lib/arw.mjs';
import {createNodeRepositoryFilesystem} from '../../lib/repository-workflow/workflow.mjs';
import {createWorkflowLock, serializeWorkflowLock} from '../../lib/repository-workflow/workflow-lock.mjs';

const SUCCEEDED = 'succeeded';
const ORIGINAL_MANAGED_AGENTS = Buffer.from(
    '<!-- arw:managed:start -->\n- Original workflow fixture.\n<!-- arw:managed:end -->\n'
    + '<!-- arw:repository-owned:start -->\nNone.\n<!-- arw:repository-owned:end -->\n',
    'utf8',
);
const UPDATED_MANAGED_AGENTS = Buffer.from(
    '<!-- arw:managed:start -->\n- Updated workflow fixture.\n<!-- arw:managed:end -->\n'
    + '<!-- arw:repository-owned:start -->\nNone.\n<!-- arw:repository-owned:end -->\n',
    'utf8',
);
const WORKFLOW_INIT_ARGS = [
    'workflow',
    'init',
    '--non-interactive',
    '--platform',
    'codex',
    '--domain-layout',
    'single-context',
    '--code-map-root',
    '--code-map-include',
    '--code-map-exclude',
];

const createUpdateDependencies = (/** @type {Buffer} */ managedAgents, /** @type {{git: {runner: import('../../lib/common/git-process.mjs').GitRunner}}} */ repository) => {
    const policyBytes = Buffer.from('.tmp/\n');
    /** @type {NonNullable<NonNullable<Parameters<typeof runArw>[1]>['workflowDependencies']>['distribution']} */
    const distribution = {
        diagnostics: [],
        distributionConfig: {repositoryOwnedSeeds: ['.arwignore']},
        payload: [{bytes: policyBytes, path: 'baseline/.arwignore'}],
        projectionConfig: {
            platforms: {
                codex: {targets: {skills: '.agents/skills/'}},
            },
        },
        status: SUCCEEDED,
    };
    /** @type {NonNullable<NonNullable<Parameters<typeof runArw>[1]>['workflowDependencies']>} */
    const workflowDependencies = {
        adapters: {
            codex: {
                evaluate(/** @type {{seedTargets: Record<string, Buffer | null>}} */ {seedTargets}) {
                    return {
                        diagnostics: [],
                        managedTargets: [{bytes: managedAgents, path: 'AGENTS.md', source: 'baseline/AGENTS.md'}],
                        repositoryOwnedSeeds: [{
                            action: seedTargets['.arwignore'] === null ? 'create' : 'compatible',
                            bytes: policyBytes,
                            path: '.arwignore',
                            source: 'baseline/.arwignore',
                            strategy: 'regular-file',
                        }],
                        status: SUCCEEDED,
                    };
                },
            },
        },
        distribution,
        git: repository.git.runner,
    };
    return workflowDependencies;
};

const createInitializedWorkflowRepository = async (/** @type {import('node:test').TestContext} */ t, /** @type {Buffer} */ managedAgents, createFixture = createRepositoryWithMockGit) => {
    const repository = await createFixture(t);
    const workflowDependencies = createUpdateDependencies(managedAgents, repository);
    const initialized = await run(WORKFLOW_INIT_ARGS, repository, {workflowDependencies});
    assert.equal(initialized.result, 0, JSON.stringify(initialized.events));
    await repository.git.commitAll('workflow initialized');
    return {repository, workflowDependencies};
};

const createWriteRejectingRepositoryFilesystem = (/** @type {string} */ repositoryRoot) => {
    const filesystem = createNodeRepositoryFilesystem(repositoryRoot);
    const rejectWrite = (/** @type {string} */ operation) => async () => {
        throw new Error(`Dry-run attempted Repository filesystem write: ${operation}.`);
    };
    return {
        ...filesystem,
        ensureDirectory: rejectWrite('ensureDirectory'),
        removeFile: rejectWrite('removeFile'),
        replaceFileAtomically: rejectWrite('replaceFileAtomically'),
    };
};

test('workflow CLI reports an uninitialized Repository through the public Workflow Module', async t => {
    const repository = await createRepositoryWithMockGit(t);
    const result = await run(['workflow', 'verify'], repository, {workflowDependencies: {git: repository.git.runner}});

    assert.equal(result.result, 1);
    assert.deepEqual(result.events.map(event => event.channel), ['stderr', 'stderr']);
    assert.ok(result.events.some(event => event.message.includes('workflow-uninitialized')));
    assert.ok(result.events.some(event => event.message.includes('required-policy-missing')));
});

test('workflow update dry-run reports only operation actions and Repository-relative paths without writing', async t => {
    const {repository} = await createInitializedWorkflowRepository(t, ORIGINAL_MANAGED_AGENTS);
    const workflowDependencies = {
        ...createUpdateDependencies(UPDATED_MANAGED_AGENTS, repository),
        filesystem: createWriteRejectingRepositoryFilesystem(repository.root),
    };

    const dryRun = await run(['workflow', 'update', '--dry-run'], repository, {
        workflowDependencies,
    });

    assert.deepEqual(dryRun, {
        events: [
            {channel: 'stdout', message: 'write AGENTS.md'},
            {channel: 'stdout', message: 'write-lock arw-lock.json'},
        ],
        result: 0,
    });
});

test('interactive workflow update shows the concise plan before confirmation and applies its unchanged operations', async t => {
    const {repository} = await createInitializedWorkflowRepository(t, ORIGINAL_MANAGED_AGENTS);
    /** @type {Array<{channel: 'stderr' | 'stdout', message: string}>} */
    const events = [];
    let summaryComplete = false;
    const result = await runArw(['workflow', 'update'], {
        cwd: repository.root,
        prompt: async question => {
            assert.equal(question.id, 'confirm-plan');
            assert.equal(summaryComplete, true);
            return 'yes';
        },
        programDirectory: repository.programDirectory,
        stderr: message => events.push({channel: 'stderr', message}),
        stdout: message => {
            events.push({channel: 'stdout', message});
            if (message === 'write-lock arw-lock.json') summaryComplete = true;
        },
        workflowDependencies: createUpdateDependencies(UPDATED_MANAGED_AGENTS, repository),
    });

    assert.deepEqual({events, result}, {
        events: [
            {channel: 'stdout', message: 'write AGENTS.md'},
            {channel: 'stdout', message: 'write-lock arw-lock.json'},
            {channel: 'stdout', message: 'Workflow update completed.'},
        ],
        result: 0,
    });
    assert.deepEqual(await readFile(join(repository.root, 'AGENTS.md')), UPDATED_MANAGED_AGENTS);
});

test('workflow update reports removed deprecated config fields and is then a no-op', async t => {
    const {repository, workflowDependencies} = await createInitializedWorkflowRepository(t, ORIGINAL_MANAGED_AGENTS);
    await writeFile(join(repository.root, 'arw.config.json'), '{"configVersion":2,"languageChecks":{"a":{}}}\n');
    await repository.git.commitAll('old config');

    const updated = await run(['workflow', 'update', '--non-interactive'], repository, {workflowDependencies});
    assert.deepEqual(updated.events.map(event => event.message), [
        'Workflow update completed.',
        'Removed deprecated fields from arw.config.json: languageChecks.',
    ]);
    await repository.git.commitAll('updated');
    const again = await run(['workflow', 'update', '--non-interactive'], repository, {workflowDependencies});
    assert.deepEqual(again.events.map(event => event.message), ['No changes.']);
});

test('workflow update lists agent role seed files that the new lock no longer records', async t => {
    const {repository, workflowDependencies} = await createInitializedWorkflowRepository(t, ORIGINAL_MANAGED_AGENTS);
    const lockPath = join(repository.root, 'arw-lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    lock.repositoryOwnedSeeds.push({identity: 'reviewer', kind: 'agent-role', ownership: 'repository-owned-seed', path: '.codex/agents/reviewer.toml', platform: lock.profile.platforms[0], strategy: 'declared-role-identity'});
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    await repository.git.commitAll('old role seed');

    const updated = await run(['workflow', 'update', '--non-interactive'], repository, {workflowDependencies});
    assert.deepEqual(updated.events.map(event => event.message), [
        'Workflow update completed.',
        '',
        'These agent role files are no longer used by the workflow and can be deleted:',
        '- .codex/agents/reviewer.toml',
    ]);
});

test('interactive workflow update preserves cancellation after showing the concise plan', async t => {
    const {repository} = await createInitializedWorkflowRepository(t, ORIGINAL_MANAGED_AGENTS);

    const cancelled = await run(['workflow', 'update'], repository, {
        prompt: async question => {
            assert.equal(question.id, 'confirm-plan');
            return 'cancel';
        },
        workflowDependencies: createUpdateDependencies(UPDATED_MANAGED_AGENTS, repository),
    });

    assert.deepEqual(cancelled, {
        events: [
            {channel: 'stdout', message: 'write AGENTS.md'},
            {channel: 'stdout', message: 'write-lock arw-lock.json'},
            {channel: 'stdout', message: 'Cancelled.'},
        ],
        result: 0,
    });
    assert.deepEqual(await readFile(join(repository.root, 'AGENTS.md')), ORIGINAL_MANAGED_AGENTS);
});

test('interactive workflow update reports a safe plan when diagnostics stop before confirmation', async t => {
    const {repository} = await createInitializedWorkflowRepository(t, ORIGINAL_MANAGED_AGENTS);
    await writeFile(join(repository.root, '.arwignore'), Buffer.from([0]));
    await repository.git.commitAll('malformed workflow policy');
    let prompted = false;

    const result = await run(['workflow', 'update'], repository, {
        prompt: async () => {
            prompted = true;
            return 'yes';
        },
        workflowDependencies: createUpdateDependencies(UPDATED_MANAGED_AGENTS, repository),
    });

    assert.equal(result.result, 1);
    assert.equal(prompted, false);
    assert.deepEqual(result.events.filter(event => event.channel === 'stdout'), [
        {channel: 'stdout', message: 'write AGENTS.md'},
        {channel: 'stdout', message: 'write-lock arw-lock.json'},
    ]);
    const diagnostics = result.events.filter(event => event.channel === 'stderr').map(event => event.message);
    assert.ok(diagnostics.some(message => message.includes('malformed-policy')));
    assert.ok(result.events.every(event => !/"(?:bytes|diagnostics|operations|profile)"/u.test(event.message)));
    assert.deepEqual(await readFile(join(repository.root, 'AGENTS.md')), ORIGINAL_MANAGED_AGENTS);
});

test('interactive workflow update does not repeat a plan already shown before an invalid confirmation', async t => {
    const {repository} = await createInitializedWorkflowRepository(t, ORIGINAL_MANAGED_AGENTS);

    const result = await run(['workflow', 'update'], repository, {
        prompt: async question => {
            assert.equal(question.id, 'confirm-plan');
            return 'invalid';
        },
        workflowDependencies: createUpdateDependencies(UPDATED_MANAGED_AGENTS, repository),
    });

    assert.equal(result.result, 2);
    assert.deepEqual(result.events.filter(event => event.channel === 'stdout'), [
        {channel: 'stdout', message: 'write AGENTS.md'},
        {channel: 'stdout', message: 'write-lock arw-lock.json'},
    ]);
    const diagnostics = result.events.filter(event => event.channel === 'stderr').map(event => event.message);
    assert.ok(diagnostics.some(message => message.includes('invalid-final-confirmation')));
    assert.deepEqual(await readFile(join(repository.root, 'AGENTS.md')), ORIGINAL_MANAGED_AGENTS);
});

test('workflow update dry-run reports diagnostics without serializing its internal plan', async t => {
    const {repository, workflowDependencies} = await createInitializedWorkflowRepository(t, ORIGINAL_MANAGED_AGENTS, createRepository);
    await writeFile(join(repository.root, 'untracked.txt'), 'untracked\n', 'utf8');

    const result = await run(['workflow', 'update', '--dry-run'], repository, {workflowDependencies});

    assert.equal(result.result, 1);
    assert.equal(result.events.some(event => event.channel === 'stdout'), false);
    const diagnostics = result.events.filter(event => event.channel === 'stderr').map(event => event.message);
    assert.ok(diagnostics.some(message => message.includes('git-visible-untracked')));
    assert.ok(diagnostics.every(message => /^\[phase \d+\] [a-z0-9-]+(?: [^:]+)?: .+/u.test(message)));
    assert.ok(diagnostics.every(message => !/"(?:bytes|diagnostics|operations|profile)"/u.test(message)));
});

test('Code Map CLI 只公开有命名空间的只读验证操作', async t => {
    const repository = await createRepositoryWithMockGit(t);
    const lock = createWorkflowLock({
        managedTargets: [],
        profile: {
            codeMaps: {excludes: [], includes: [], roots: []},
            domainLayout: 'single-context',
            platforms: ['codex'],
        },
        repositoryOwnedSeeds: [],
    });
    await writeFile(join(repository.root, 'arw-lock.json'), serializeWorkflowLock(lock), 'utf8');

    const passed = await run(['code-map', 'verify'], repository);
    assert.deepEqual(passed, {
        events: [{channel: 'stdout', message: 'Code Map verification passed. Required maps: 0.'}],
        result: 0,
    });

    const uninitialized = await createRepositoryWithMockGit(t);
    const finding = await run(['code-map', 'verify'], uninitialized);
    assert.equal(finding.result, 1);
    assert.deepEqual(finding.events.map(event => event.channel), ['stderr']);
    assert.match(finding.events[0].message, /workflow-uninitialized/);

    for (const args of [
        ['code-map', 'verify', 'extra'],
        ['check'],
        ['verify'],
        ['check-integrity'],
    ]) {
        assert.throws(() => parseCommand(args), error => error instanceof UsageError && error.exitCode === 2);
    }
});

test('workflow init and remove reject dry-run as an inapplicable option', async () => {
    for (const operation of ['init', 'remove']) {
        /** @type {string[]} */
        const diagnostics = [];
        const result = await runArw(['workflow', operation, '--dry-run'], {
            stderr: message => diagnostics.push(message),
            stdout: () => assert.fail('Invalid arguments must not produce standard output.'),
        });
        assert.equal(result, 2);
        assert.match(diagnostics.join('\n'), new RegExp(`workflow ${operation} received an inapplicable option`));
    }
});

const createNestedTargetRepository = async (/** @type {import('node:test').TestContext} */ t) => {
    const repository = await createRepositoryWithMockGit(t);
    const base = createUpdateDependencies(ORIGINAL_MANAGED_AGENTS, repository);
    const adapter = /** @type {Record<string, {evaluate: (input: any) => any}>} */ (base.adapters).codex;
    const workflowDependencies = {
        ...base,
        adapters: {
            codex: {
                evaluate: (/** @type {unknown} */ input) => {
                    /** @type {{managedTargets: Array<{bytes: Buffer, path: string, source: string}>, status: 'succeeded', diagnostics: []}} */
                    const result = adapter.evaluate(input);
                    return {...result, managedTargets: [...result.managedTargets, {bytes: Buffer.from('Nested.\n'), path: 'docs/agents/nested.md', source: 'baseline/docs/agents/nested.md'}]};
                },
            },
        },
    };
    const initialized = await run(WORKFLOW_INIT_ARGS, repository, {workflowDependencies});
    assert.equal(initialized.result, 0, JSON.stringify(initialized.events));
    await repository.git.commitAll('workflow initialized');
    return {repository, workflowDependencies};
};

const REMOVE_ARGS = ['workflow', 'remove', '--non-interactive', '--arwignore', 'retain'];

test('workflow remove deletes directories it emptied and prints nothing extra', async t => {
    const {repository, workflowDependencies} = await createNestedTargetRepository(t);

    const removed = await run(REMOVE_ARGS, repository, {workflowDependencies});

    assert.equal(removed.result, 0, JSON.stringify(removed.events));
    assert.equal(removed.events.at(-1)?.message, 'Workflow remove completed.');
    await assert.rejects(access(join(repository.root, 'docs')));
});

test('workflow remove lists directories it could not remove on stdout after all other output and still succeeds', async t => {
    const {repository, workflowDependencies} = await createNestedTargetRepository(t);
    const filesystem = createNodeRepositoryFilesystem(repository.root);

    const removed = await run(REMOVE_ARGS, repository, {workflowDependencies: {
        ...workflowDependencies,
        filesystem: {...filesystem, removeEmptyDirectory: async input => {
            if (input.path === 'docs/agents') return {diagnostics: [{code: 'filesystem-operation-failed', message: 'refused'}], status: 'failed'};
            return filesystem.removeEmptyDirectory(input);
        }},
    }});

    assert.equal(removed.result, 0, JSON.stringify(removed.events));
    assert.deepEqual(removed.events.slice(-4), [
        {channel: 'stdout', message: 'Workflow remove completed.'},
        {channel: 'stdout', message: ''},
        {channel: 'stdout', message: 'These directories could not be removed and were left in place:'},
        {channel: 'stdout', message: '- docs/agents'},
    ]);
    assert.ok(removed.events.every(event => event.channel === 'stdout'));
});
