import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {createRepository, run} from '../helpers/arw-cli.mjs';
import {commitAll} from '../helpers/git.mjs';
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

const createUpdateDependencies = (/** @type {Buffer} */ managedAgents) => {
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
    };
    return workflowDependencies;
};

const createInitializedWorkflowRepository = async (/** @type {import('node:test').TestContext} */ t, /** @type {Buffer} */ managedAgents) => {
    const repository = await createRepository(t);
    const workflowDependencies = createUpdateDependencies(managedAgents);
    const initialized = await run(WORKFLOW_INIT_ARGS, repository, {workflowDependencies});
    assert.equal(initialized.result, 0, JSON.stringify(initialized.events));
    await commitAll(repository.root, 'workflow initialized');
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
    const repository = await createRepository(t);
    const result = await run(['workflow', 'verify'], repository);

    assert.equal(result.result, 1);
    assert.deepEqual(result.events.map(event => event.channel), ['stderr', 'stderr']);
    assert.ok(result.events.some(event => event.message.includes('workflow-uninitialized')));
    assert.ok(result.events.some(event => event.message.includes('required-policy-missing')));
});

test('workflow update dry-run reports only operation actions and Repository-relative paths without writing', async t => {
    const {repository} = await createInitializedWorkflowRepository(t, ORIGINAL_MANAGED_AGENTS);
    const workflowDependencies = {
        ...createUpdateDependencies(UPDATED_MANAGED_AGENTS),
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
        workflowDependencies: createUpdateDependencies(UPDATED_MANAGED_AGENTS),
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

test('interactive workflow update preserves cancellation after showing the concise plan', async t => {
    const {repository} = await createInitializedWorkflowRepository(t, ORIGINAL_MANAGED_AGENTS);

    const cancelled = await run(['workflow', 'update'], repository, {
        prompt: async question => {
            assert.equal(question.id, 'confirm-plan');
            return 'cancel';
        },
        workflowDependencies: createUpdateDependencies(UPDATED_MANAGED_AGENTS),
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
    await commitAll(repository.root, 'malformed workflow policy');
    let prompted = false;

    const result = await run(['workflow', 'update'], repository, {
        prompt: async () => {
            prompted = true;
            return 'yes';
        },
        workflowDependencies: createUpdateDependencies(UPDATED_MANAGED_AGENTS),
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
        workflowDependencies: createUpdateDependencies(UPDATED_MANAGED_AGENTS),
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
    const {repository, workflowDependencies} = await createInitializedWorkflowRepository(t, ORIGINAL_MANAGED_AGENTS);
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
    const repository = await createRepository(t);
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

    const uninitialized = await createRepository(t);
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
