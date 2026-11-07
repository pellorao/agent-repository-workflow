import assert from 'node:assert/strict';
import {copyFile, symlink} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {Readable, Writable} from 'node:stream';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test from 'node:test';

import {createRepository, run, writeConfig, writeIssue} from './helpers/arw-cli.mjs';
import {createTemporaryDirectory} from './helpers/cleanup.mjs';
import {runSuccessfulProcess} from './helpers/process.mjs';
import {parseCommand, UsageError} from '../lib/arw.mjs';

const SOURCE_DIRECTORY = dirname(dirname(fileURLToPath(import.meta.url)));
const NO_COMMAND_MESSAGE = 'A command is required.\nRun `arw help` for usage.';

test('root arw entry executes while the internal arw module has no direct behavior', async t => {
    const repository = await createRepository(t);
    await writeIssue(repository.root, '0001-entry-layout', '01-ready.md', '# Entry layout\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- None - can start immediately\n');
    await Promise.all([
        symlink(join(SOURCE_DIRECTORY, 'lib'), join(repository.programDirectory, 'lib'), 'junction'),
        copyFile(join(SOURCE_DIRECTORY, 'package.json'), join(repository.programDirectory, 'package.json')),
        copyFile(join(SOURCE_DIRECTORY, 'arw.mjs'), join(repository.programDirectory, 'arw.mjs')),
    ]);

    const [internal, entry] = await Promise.all([
        runSuccessfulProcess('node', [join(repository.programDirectory, 'lib', 'arw.mjs'), 'li'], {cwd: repository.root}),
        runSuccessfulProcess('node', [join(repository.programDirectory, 'arw.mjs'), 'li'], {cwd: repository.root}),
    ]);

    assert.deepEqual(internal, {exitCode: 0, status: 'exited', stderr: '', stdout: ''});
    assert.equal(entry.stderr, '');
    assert.match(entry.stdout, /ready-for-agent\s+implementation\s+issue:0001:01\s+Entry layout/u);
});

test('commands using configuration validate it before repository discovery', async t => {
    const repository = await createRepository(t);
    await writeConfig(repository.programDirectory, {configVersion: 1, editor: {command: './relative-editor', args: ['--file']}});
    const outside = await createTemporaryDirectory(t, 'arw-outside-');

    const {events, result} = await run(['agent', 'start', 'impl'], repository, {cwd: outside});

    assert.equal(result, 1);
    assert.deepEqual(events, [{channel: 'stderr', message: 'Invalid configuration: editor.command must not be a relative path.'}]);
});

test('global background list preserves title and full session identity without Main ownership or repository discovery', async t => {
    assert.deepEqual(parseCommand(['list','background-agents']),{kind:'list-background-agents', full: false});
    assert.deepEqual(parseCommand(['lba']),{kind:'list-background-agents', full: false});
    for (const args of [['lba','extra'],['list','background-agents','--all'],['lba','-f','-f'],['lm','-a'],['ls','--full','x']]) assert.throws(() => parseCommand(args),UsageError);
    assert.deepEqual(parseCommand(['lba','-f']),{kind:'list-background-agents', full: true});
    assert.deepEqual(parseCommand(['list','background-agents','--full']),{kind:'list-background-agents', full: true});
    assert.equal(parseCommand(['lm','-f']).options.full, true);
    assert.equal(parseCommand(['list','specs']).options.full, false);
    assert.equal(parseCommand(['li','-a','--full']).options.full, true);
    assert.throws(() => parseCommand(['li','-f','--full']),UsageError);
    assert.deepEqual(parseCommand(['jl','-f','--limit','5']),{kind:'jira-list', limit: 5, full: true});
    assert.deepEqual(parseCommand(['jira','list','--limit','5','--full']),{kind:'jira-list', limit: 5, full: true});
    assert.throws(() => parseCommand(['jl','-f','--full']),UsageError);
    const repository = await createRepository(t);
    const outside = await createTemporaryDirectory(t,'background-list-outside-');
    const ownerId = '01a0ec14-e396-7d63-a075-a20c21e0f1cb';
    const unknownId = '01a0ec14-e396-7d63-a075-a20c21e0f1cc';
    for (const args of [['list','background-agents'],['lba']]) {
        const result = await run(args,repository,{
            cwd:outside,
            backgroundAgentList:async () => [
                {role:'reviewer',cwd:'/w/a',ownerId,ownerTitle:'中文标题 with long visible text',state:'idle',taskElapsedMs:3_723_000},
                {role:'requirements-reviewer',cwd:'/w/a',ownerId:unknownId,ownerTitle:null,state:'running',taskElapsedMs:2_000},
                {role:'code-standards-reviewer',cwd:'/w/a',ownerId:'main-blank',ownerTitle:' \t ',state:'unknown',taskElapsedMs:null},
            ],
        });
        assert.equal(result.result,0);
        assert.equal(result.events.length,1);
        assert.match(result.events[0].message,/01a0ec14\S* +中文标题 with lo\.\.\.$/mu);
        assert.ok(result.events[0].message.includes(ownerId));
        assert.ok(result.events[0].message.includes(unknownId));
        assert.ok(result.events[0].message.includes('requirements-reviewer'));
        assert.ok(result.events[0].message.includes('running'));
        assert.ok(result.events[0].message.includes('main-blank'));
        assert.ok(!result.events[0].message.includes('/w/a'));
        assert.equal((result.events[0].message.match(/\u001b\[90mN\/A\u001b\[0m/gu) ?? []).length, 2);
        assert.match(result.events[0].message,/1:02:03/u);
        assert.ok(!result.events[0].message.includes(repository.root));
    }
});

test('background list reports a manager running older code instead of crashing on rows without required fields', async t => {
    const programDirectory = await createTemporaryDirectory(t, 'arw-list-program-');
    const root = await createTemporaryDirectory(t, 'arw-list-cwd-');
    await writeConfig(programDirectory);
    for (const args of [['list', 'background-agents'], ['lba']]) {
        const stale = await run(args, {root, programDirectory}, {backgroundAgentList: async () => /** @type {any} */ ([{role: 'reviewer', cwd: '/w', ownerTitle: null, state: 'idle', taskElapsedMs: 1}])});
        assert.equal(stale.result, 1);
        assert.equal(stale.events[0].channel, 'stderr');
        assert.match(stale.events[0].message, /incompatible with this command.*node install\.mjs/u);
        for (const row of [{role: 'reviewer', cwd: '/w', ownerId: 'main', state: 'idle', taskElapsedMs: 1}, {role: 'reviewer', cwd: '/w', ownerId: 'main', ownerTitle: null, state: 'idle'}]) {
            const partial = await run(args, {root, programDirectory}, {backgroundAgentList: async () => /** @type {any} */ ([row])});
            assert.equal(partial.result, 1);
            assert.match(partial.events[0].message, /incompatible with this command/u);
        }
    }
});

test('background list commands distinguish confirmed manager absence from unavailable and ordinary results', async t => {
    const programDirectory = await createTemporaryDirectory(t, 'arw-list-program-');
    const root = await createTemporaryDirectory(t, 'arw-list-cwd-');
    await writeConfig(programDirectory);
    const repository = {root, programDirectory};
    const unavailable = 'The background Agent list is temporarily unavailable.';
    for (const args of [['list', 'background-agents'], ['lba']]) {
        const noManager = await run(args, repository, {backgroundAgentList: async () => null,
            spawnProcess: () => {throw new Error('List must not start a process.');}});
        assert.deepEqual(noManager, {result: 0, events: [{channel: 'stdout', message: 'The manager process is not running; there are no managed background Agents.'}]});

        const failed = await run(args, repository, {backgroundAgentList: async () => {throw new Error(unavailable);}});
        assert.deepEqual(failed, {result: 1, events: [{channel: 'stderr', message: unavailable}]});

        const empty = await run(args, repository, {backgroundAgentList: async () => []});
        assert.equal(empty.result, 0);
        assert.equal(empty.events[0].channel, 'stdout');
        assert.match(empty.events[0].message, /Status.*Role.*Elapsed.*Session.*Title/s);

        const otherError = await run(args, repository, {backgroundAgentList: async () => {throw new Error('Credential is invalid.');}});
        assert.deepEqual(otherError, {result: 1, events: [{channel: 'stderr', message: 'Credential is invalid.'}]});
    }
});

test('help aliases show grouped usage without configuration or a repository', async t => {
    const root = await createTemporaryDirectory(t, 'arw-help-cwd-');
    const programDirectory = await createTemporaryDirectory(t, 'arw-help-program-');
    let help;
    for (const flag of ['help', '--help', '-h']) {
        const result = await run([flag], {root, programDirectory});
        assert.equal(result.result, 0);
        assert.equal(result.events.length, 1);
        assert.equal(result.events[0].channel, 'stdout');
        const message = result.events[0].message;
        assert.match(message, /^Usage:\nEveryday commands:\n/u);
        assert.match(message, /arw workflow verify[\s\S]*Agent-internal commands:[\s\S]*arw spec-readiness prepare[\s\S]*arw commit-audit verify/u);
        assert.match(message, /Agent-internal commands:\n  arw background-agent \[--wait\]/u);
        assert.ok(!message.includes('Unknown command or artifact.'));
        if (help !== undefined) assert.equal(message, help);
        help = message;
    }
});

test('invalid command shapes return usage exit code', async t => {
    const repository = await createRepository(t);
    const noCommand = await run([], repository);
    const unknownCommand = await run(['unknown'], repository);
    const unknownOption = await run(['li', '--unknown'], repository);
    const missingId = await run(['oi'], repository);
    const pathId = await run(['oi', '.scratch/workflow/issues/01-task.md'], repository);

    assert.equal(noCommand.result, 2);
    assert.equal(unknownCommand.result, 2);
    assert.equal(unknownOption.result, 2);
    assert.equal(missingId.result, 2);
    assert.equal(pathId.result, 2);
    assert.deepEqual(noCommand.events, [{channel: 'stderr', message: NO_COMMAND_MESSAGE}]);
    assert.match(unknownCommand.events[0].message, /^Unknown command or artifact\.\nRun `arw help` for usage\.$/);
    assert.ok(noCommand.events.every(event => event.channel === 'stderr'));
    assert.ok(unknownCommand.events.every(event => event.channel === 'stderr'));
    assert.ok(unknownOption.events.every(event => event.channel === 'stderr'));
    assert.ok(missingId.events.every(event => event.channel === 'stderr'));
    assert.ok(pathId.events.every(event => event.channel === 'stderr'));
});

test('background-agent routes its exact machine form through persistent streams without the foreground launcher', async t => {
    assert.deepEqual(parseCommand(['background-agent']), {kind: 'background-agent', wait: false});
    assert.deepEqual(parseCommand(['background-agent', '--wait']), {kind: 'background-agent', wait: true});
    for (const args of [['start'], ['--input', 'request.json'], ['--help']]) {
        assert.throws(() => parseCommand(['background-agent', ...args]), error => error instanceof UsageError && error.exitCode === 2);
    }
    const repository = await createRepository(t);
    let closes = 0;
    /** @type {unknown[]} */
    const received = [];
    let output = '';
    const result = await run(['background-agent'], repository, {
        spawnProcess: () => { throw new Error('Foreground launch must not run.'); },
        backgroundAgentDependencies: {
            input: Readable.from(['{"id":"one","operation":"list_agents","input":{"runId":"run"}}\n']),
            output: new Writable({write(chunk, _encoding, callback) { output += chunk.toString('utf8'); callback(); }}),
            signals: new EventEmitter(),
            runtime: {
                async execute(request) { received.push(request); return {status: 'succeeded', result: {state: 'running'}}; },
                async close() { closes++; return {status: 'succeeded', result: {closed: true}}; },
            },
        },
    });
    assert.deepEqual(result, {events: [], result: 0});
    assert.deepEqual(received, [{operation: 'list_agents', input: {runId: 'run'}}]);
    assert.deepEqual(JSON.parse(output), {id: 'one', ok: true, result: {state: 'running'}});
    assert.equal(closes, 1);
});

test('root arw entry recognizes invocation through a directory symlink', async t => {
    const root = await createTemporaryDirectory(t, 'arw-entry-link-');
    const linked = join(root, 'source');
    await symlink(SOURCE_DIRECTORY, linked, 'junction');
    const argv = process.argv;
    const exitCode = process.exitCode;
    let output = '';
    const write = t.mock.method(process.stdout, 'write', (/** @type {string | Uint8Array} */ chunk) => { output += String(chunk); return true; });
    try {
        process.argv = [process.execPath, join(root, 'missing.mjs'), '--version'];
        await import(`${pathToFileURL(join(linked, 'arw.mjs')).href}?unrelated-import`);
        assert.equal(output, '');
        assert.equal(process.exitCode, exitCode);
        process.argv = [process.execPath, join(linked, 'arw.mjs'), '--version'];
        await import(`${pathToFileURL(join(linked, 'arw.mjs')).href}?linked-entry`);
        assert.equal(process.exitCode, 0);
        assert.match(output, /\d+\.\d+\.\d+/u);
    } finally {
        process.argv = argv;
        process.exitCode = exitCode;
        write.mock.restore();
    }
});

test('usage failures keep command-specific messages and a help hint without configuration', async t => {
    const root = await createTemporaryDirectory(t, 'arw-usage-cwd-');
    const programDirectory = await createTemporaryDirectory(t, 'arw-usage-program-');
    const repository = {root, programDirectory};
    for (const [alias, kind, flag] of [['lm', 'maps', '-f'], ['ls', 'specs', '--full']]) {
        const short = await run([alias, flag, flag], repository);
        const full = await run(['list', kind, flag, flag], repository);
        assert.deepEqual(short, full);
        assert.equal(short.result, 2);
        assert.equal(short.events[0].message, `List ${kind} accepts only --full | -f.\nRun ` + '`arw help` for usage.');
    }
    for (const [args, message] of /** @type {Array<[string[], string]>} */ ([
        [[], 'A command is required.'],
        [['bogus-command'], 'Unknown command or artifact.'],
        [['help', 'extra'], 'Unknown command or artifact.'],
        [['--help', 'extra'], 'Unknown command or artifact.'],
        [['-h', 'extra'], 'Unknown command or artifact.'],
        [['li', '--unknown'], 'Unknown or repeated option: --unknown.'],
        [['commit-audit', 'prepare', 'bad\nargument\rvalue'], 'Unexpected argument: bad\\nargument\\rvalue.'],
        [['li', '--type', 'bogus'], '--type only accepts implementation, application-source, and wayfinder.'],
        [['background-agent', '--bogus'], 'arw background-agent accepts only --wait.'],
        [['lba', '-x'], 'Background Agent list accepts only --full | -f.'],
        [['li', '-s', ''], '-s expects one or more comma-separated values without empty items.'],
        [['li', '-s', 'a,,b'], '-s expects one or more comma-separated values without empty items.'],
        [['li', '-s', 'a b'], '-s expects one or more comma-separated values without spaces.'],
    ])) {
        const result = await run(args, repository);
        assert.equal(result.result, 2);
        assert.equal(result.events.length, 1);
        assert.equal(result.events[0].channel, 'stderr');
        assert.equal(result.events[0].message, `${message}\nRun ` + '`arw help` for usage.');
    }
});

test('commands without configuration execute when config.json is missing', async t => {
    const repository = await createRepository(t);
    const programDirectory = await createTemporaryDirectory(t, 'arw-no-config-');
    for (const args of [['list', 'issues'], ['text', 'check'], ['terms', 'check']]) {
        const result = await run(args, {...repository, programDirectory});
        assert.equal(result.result, 0, JSON.stringify(result.events));
    }
    const missingConfig = await run(['agent', 'start', 'impl'], {...repository, programDirectory});
    assert.equal(missingConfig.result, 1);
    assert.match(missingConfig.events[0].message, /Configuration file not found: config.json/u);
});
