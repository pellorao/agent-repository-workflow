import assert from 'node:assert/strict';
import {mkdir, rm} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {createMockChild, createRepository, run, writeConfig} from '../helpers/arw-cli.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {parseCommand, UsageError} from '../../lib/arw.mjs';

/** @typedef {NonNullable<NonNullable<Parameters<typeof import('../../arw.mjs').runArw>[1]>['spawnProcess']>} ArwSpawn */
/** @typedef {{args: readonly string[], command: string, options: Parameters<ArwSpawn>[2]}} AgentSpawnCall */

test('agent start parser keeps every token after the configured name', () => {
    assert.deepEqual(parseCommand(['agent', 'start', 'impl']), {
        agentArguments: [],
        kind: 'agent-start',
        name: 'impl',
    });
    assert.deepEqual(parseCommand(['agent', 'start', 'impl', 'resume', '--last', '--', 'task']), {
        agentArguments: ['resume', '--last', '--', 'task'],
        kind: 'agent-start',
        name: 'impl',
    });
    assert.throws(
        () => parseCommand(['agent', 'start']),
        error => error instanceof UsageError && /Agent start expects a name\.$/.test(error.message),
    );
});

test('agent start selects an exact configured name and preserves invocation process options', async t => {
    const repository = await createRepository(t);
    const nested = join(repository.root, 'nested', 'directory');
    /** @type {AgentSpawnCall[]} */
    const calls = [];
    const exitCodes = [0, 7, 0, 0, 0, 0];
    await mkdir(nested, {recursive: true});
    await writeConfig(repository.programDirectory, {
        agents: {
            impl: {args: ['--model', 'test-model'], command: 'agent-cli'},
        },
        configVersion: 1,
        editor: {args: ['{file}'], command: 'code'},
    });
    const spawn = (/** @type {string} */ command, /** @type {readonly string[]} */ args, /** @type {Parameters<ArwSpawn>[2]} */ options) => {
        calls.push({args, command, options});
        const child = createMockChild();
        queueMicrotask(() => child.emit('exit', exitCodes.shift()));
        return child;
    };

    const succeeded = await run(['agent', 'start', 'impl'], repository, {cwd: nested, spawnProcess: spawn});
    const nonzero = await run(['agent', 'start', 'impl'], repository, {cwd: nested, spawnProcess: spawn});
    const ordinary = await run(['agent', 'start', 'impl', '--flag', 'value'], repository, {cwd: nested, spawnProcess: spawn});
    const codexResume = await run(['agent', 'start', 'impl', 'resume', '--last'], repository, {cwd: nested, spawnProcess: spawn});
    const claudeResume = await run(['agent', 'start', 'impl', '--resume', 'session-1'], repository, {cwd: nested, spawnProcess: spawn});
    const literalSeparator = await run(['agent', 'start', 'impl', '--', '--literal'], repository, {cwd: nested, spawnProcess: spawn});
    const wrongCase = await run(['agent', 'start', 'Impl'], repository, {cwd: nested, spawnProcess: spawn});
    const aliasLike = await run(['agent', 'start', 'implementer'], repository, {cwd: nested, spawnProcess: spawn});

    assert.deepEqual(succeeded, {events: [], result: 0});
    assert.deepEqual(nonzero, {events: [], result: 7});
    assert.deepEqual(ordinary, {events: [], result: 0});
    assert.deepEqual(codexResume, {events: [], result: 0});
    assert.deepEqual(claudeResume, {events: [], result: 0});
    assert.deepEqual(literalSeparator, {events: [], result: 0});
    const processOptions = {cwd: nested, shell: false, stdio: 'inherit', windowsHide: true};
    assert.deepEqual(calls, [
        {args: ['--model', 'test-model'], command: 'agent-cli', options: processOptions},
        {args: ['--model', 'test-model'], command: 'agent-cli', options: processOptions},
        {args: ['--model', 'test-model', '--flag', 'value'], command: 'agent-cli', options: processOptions},
        {args: ['--model', 'test-model', 'resume', '--last'], command: 'agent-cli', options: processOptions},
        {args: ['--model', 'test-model', '--resume', 'session-1'], command: 'agent-cli', options: processOptions},
        {args: ['--model', 'test-model', '--', '--literal'], command: 'agent-cli', options: processOptions},
    ]);
    assert.deepEqual(wrongCase, {
        events: [{channel: 'stderr', message: 'Agent configuration not found: Impl.'}],
        result: 1,
    });
    assert.deepEqual(aliasLike, {
        events: [{channel: 'stderr', message: 'Agent configuration not found: implementer.'}],
        result: 1,
    });
});

test('agent start maps process failures without starting a shell', async t => {
    const repository = await createRepository(t);
    await writeConfig(repository.programDirectory, {
        agents: {impl: {args: [], command: 'agent-cli'}},
        configVersion: 1,
        editor: {args: ['{file}'], command: 'code'},
    });
    /** @type {Array<{expected: string, spawn: ArwSpawn}>} */
    const variants = [
        {
            expected: 'Agent CLI command could not be started.',
            spawn: () => {
                throw new Error('missing executable');
            },
        },
        {
            expected: 'Agent CLI command could not be started.',
            spawn: () => {
                const child = createMockChild();
                queueMicrotask(() => child.emit('error', new Error('missing executable')));
                return child;
            },
        },
        {
            expected: 'Agent CLI exited without a numeric exit code.',
            spawn: () => {
                const child = createMockChild();
                queueMicrotask(() => child.emit('exit', null));
                return child;
            },
        },
    ];

    for (const variant of variants) {
        assert.deepEqual(await run(['agent', 'start', 'impl'], repository, {spawnProcess: variant.spawn}), {
            events: [{channel: 'stderr', message: variant.expected}],
            result: 1,
        });
    }
});

test('agent configuration is complete, optional, and validated before Repository discovery', async t => {
    const repository = await createRepository(t);
    const outside = await createTemporaryDirectory(t, 'arw-agent-outside-');
    const invalidEntries = [
        [[], 'agents must be an object.'],
        [null, 'agents must be an object.'],
        ['invalid', 'agents must be an object.'],
        [7, 'agents must be an object.'],
        [true, 'agents must be an object.'],
        [{impl: null}, 'agents["impl"] must be an object.'],
        [{impl: {args: [], command: 'agent-cli', extra: true}}, 'agents["impl"] must contain only command and args.'],
        [{impl: {args: [], command: ''}}, 'agents["impl"].command must be a non-empty PATH command or absolute path.'],
        [{impl: {args: [], command: './relative-agent'}}, 'agents["impl"].command must not be a relative path.'],
        [{impl: {args: [7], command: 'agent-cli'}}, 'agents["impl"].args must be an array of strings.'],
    ];

    for (const [agents, diagnostic] of invalidEntries) {
        await writeConfig(repository.programDirectory, {
            agents,
            configVersion: 1,
            editor: {args: ['{file}'], command: 'code'},
        });
        assert.deepEqual(await run(['li'], repository, {cwd: outside}), {
            events: [{channel: 'stderr', message: `Invalid configuration: ${diagnostic}`}],
            result: 1,
        });
    }

    await writeConfig(repository.programDirectory);
    assert.deepEqual(await run(['agent', 'start', 'impl'], repository), {
        events: [{channel: 'stderr', message: 'Agent configuration not found: impl.'}],
        result: 1,
    });

    assert.deepEqual(await run(['agent', 'start', 'impl', 'resume'], repository, {cwd: outside}), {
        events: [{channel: 'stderr', message: 'Unable to discover the nearest Git working-tree root.'}],
        result: 1,
    });
});

test('agent start uses the nearest Git root even when scratch is absent', async t => {
    const repository = await createRepository(t);
    let started = false;
    await writeConfig(repository.programDirectory, {
        agents: {impl: {args: [], command: 'agent-cli'}},
        configVersion: 1,
        editor: {args: ['{file}'], command: 'code'},
    });
    await rm(join(repository.root, '.scratch'), {recursive: true});

    const result = await run(['agent', 'start', 'impl'], repository, {
        spawnProcess: () => {
            started = true;
            const child = createMockChild();
            queueMicrotask(() => child.emit('exit', 0));
            return child;
        },
    });

    assert.deepEqual(result, {events: [], result: 0});
    assert.equal(started, true);
});

test('agent start does not launch outside a Git Repository', async t => {
    const repository = await createRepository(t);
    const outside = await createTemporaryDirectory(t, 'arw-agent-outside-');
    let started = false;
    await writeConfig(repository.programDirectory, {
        agents: {impl: {args: [], command: 'agent-cli'}},
        configVersion: 1,
        editor: {args: ['{file}'], command: 'code'},
    });

    const result = await run(['agent', 'start', 'impl'], repository, {
        cwd: outside,
        spawnProcess: () => {
            started = true;
            throw new Error('must not start outside a Git Repository');
        },
    });

    assert.deepEqual(result, {
        events: [{channel: 'stderr', message: 'Unable to discover the nearest Git working-tree root.'}],
        result: 1,
    });
    assert.equal(started, false);
});
