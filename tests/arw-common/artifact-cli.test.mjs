import assert from 'node:assert/strict';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {createMockChild, createRepository, run, writeArtifact, writeConfig, writeIssue} from '../helpers/arw-cli.mjs';
import {runGit} from '../helpers/git.mjs';
import {launchEditor} from '../../arw.mjs';
import {createScopedFilesystem} from '../../lib/common/filesystem.mjs';

/** @typedef {NonNullable<NonNullable<Parameters<typeof import('../../arw.mjs').runArw>[1]>['spawnProcess']>} ArwSpawn */
/** @typedef {{args: readonly string[], command: string, spawnOptions: Parameters<ArwSpawn>[2]}} EditorSpawnCall */

test('open and print route one local canonical artifact ID and reject removed forms', async t => {
    const repository = await createRepository(t);
    const issue = '# Print issue\n\nStatus: completed\n';
    await writeIssue(repository.root, '0067-cli', '02-result.md', issue);

    assert.deepEqual(await run(['print', 'issue:0067:02'], repository), {
        events: [{channel: 'stdout', message: issue}],
        result: 0,
    });
    for (const args of [
        ['print', 'issue', 'issue:0067:02'],
        ['open', 'issue', 'issue:0067:02'],
        ['oi', 'issue:0067:02'],
        ['om', 'map:0067'],
        ['os', 'spec:0067'],
        ['print', 'issue:billing:0067:02'],
    ]) {
        const outcome = await run(args, repository);
        assert.equal(outcome.result, 2);
        assert.equal(outcome.events[0]?.channel, 'stderr');
    }
});

test('list issues outputs a canonical implementation issue', async t => {
    const repository = await createRepository(t);
    await writeIssue(
        repository.root,
        '0001-demo-effort',
        '01-first-task.md',
        '# 第一个任务\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- None - can start immediately\n',
    );

    const complete = await run(['list', 'issues'], repository);
    const short = await run(['li'], repository);

    assert.equal(complete.result, 0);
    assert.deepEqual(complete.events, [
        {
            channel: 'stdout',
            message: [
                'Status           Type            Issue          Title',
                '---------------  --------------  -------------  ----------',
                'ready-for-agent  implementation  issue:0001:01  第一个任务',
            ].join('\n'),
        },
    ]);
    assert.deepEqual(short, complete);
});

test('list, open, and print fail closed when an effort directory cannot be read', async t => {
    const repository = await createRepository(t);
    await writeIssue(repository.root, '0001-unreadable', '01-hidden.md', '# Hidden\n\nStatus: completed\n');
    const created = await createScopedFilesystem({root: repository.root});
    if (created.status !== 'succeeded') assert.fail('Artifact CLI test filesystem must open.');
    const filesystem = {
        ...created.scopedFilesystem,
        list: async (/** @type {{path: string}} */ input) => input.path === '.scratch/0001-unreadable'
            ? {diagnostics: [{code: 'test-list-failed', message: 'simulated list failure'}], stage: 'list', status: /** @type {'failed'} */ ('failed')}
            : created.scopedFilesystem.list(input),
    };
    let editorStarted = false;
    const outcomes = await Promise.all([
        run(['list', 'issues'], repository, {artifactInventoryFilesystem: filesystem}),
        run(['open', 'issue:0001:01'], repository, {artifactInventoryFilesystem: filesystem, spawnProcess: () => {
            editorStarted = true;
            return createMockChild();
        }}),
        run(['print', 'issue:0001:01'], repository, {artifactInventoryFilesystem: filesystem}),
    ]);

    for (const outcome of outcomes) {
        assert.equal(outcome.result, 1);
        assert.match(outcome.events.map(event => event.message).join('\n'), /The effort directory could not be read: \.scratch\/0001-unreadable/);
        assert.doesNotMatch(outcome.events.map(event => event.message).join('\n'), /not found/);
    }
    assert.equal(editorStarted, false);
});

test('list maps and specs outputs registered artifacts', async t => {
    const repository = await createRepository(t);
    await writeArtifact(repository.root, '0002-zeta-effort', 'map.md', '# Zeta map\n');
    await writeArtifact(repository.root, '0001-alpha-effort', 'map.md', '# Alpha map\n');
    await writeArtifact(repository.root, '0004-zeta-effort', 'spec.md', '# Zeta spec\n');
    await writeArtifact(repository.root, '0003-alpha-effort', 'spec.md', '# Alpha spec\n');
    await writeArtifact(repository.root, '0005-legacy-effort', 'PRD.md', '# Legacy spec\n');
    await writeArtifact(repository.root, 'unregistered', 'notes.md', '# Notes\n');

    const maps = await run(['list', 'maps'], repository);
    const shortMaps = await run(['lm'], repository);
    const specs = await run(['list', 'specs'], repository);
    const shortSpecs = await run(['ls'], repository);

    assert.equal(maps.result, 0);
    assert.deepEqual(maps.events, [
        {
            channel: 'stdout',
            message: ['Map       Title', '--------  ---------', 'map:0001  Alpha map', 'map:0002  Zeta map'].join('\n'),
        },
    ]);
    assert.deepEqual(shortMaps, maps);
    assert.equal(specs.result, 0);
    assert.deepEqual(specs.events, [
        {
            channel: 'stdout',
            message: ['Spec       Title', '---------  ----------', 'spec:0003  Alpha spec', 'spec:0004  Zeta spec'].join('\n'),
        },
    ]);
    assert.deepEqual(shortSpecs, specs);
});

test('print writes raw registered artifacts to stdout', async t => {
    const repository = await createRepository(t);
    const issue = '# Print issue\n\nStatus: completed\n';
    const map = '# Print map\n';
    const spec = '# Print spec\n';
    await writeIssue(repository.root, '0001-print-effort', '01-result.md', issue);
    await writeArtifact(repository.root, '0001-print-effort', 'map.md', map);
    await writeArtifact(repository.root, '0002-print-effort', 'spec.md', spec);

    assert.deepEqual(await run(['print', 'issue:0001:01'], repository), {
        events: [{channel: 'stdout', message: issue}],
        result: 0,
    });
    assert.deepEqual(await run(['print', 'map:0001'], repository), {
        events: [{channel: 'stdout', message: map}],
        result: 0,
    });
    assert.deepEqual(await run(['print', 'spec:0002'], repository), {
        events: [{channel: 'stdout', message: spec}],
        result: 0,
    });
});

test('artifact lists report malformed paths and legacy upgrade hint', async t => {
    const repository = await createRepository(t);
    await writeArtifact(repository.root, '0001-good', 'spec.md', '# Good spec\n');
    await writeArtifact(repository.root, '0002-missing-heading', 'spec.md', '## Not an H1\n');
    await writeArtifact(repository.root, '0003-legacy', 'PRD.md', '# Legacy\n');
    await mkdir(join(repository.root, '.scratch', '0004-not-a-file', 'spec.md'), {recursive: true});

    const {events, result} = await run(['list', 'specs'], repository);

    assert.equal(result, 1);
    assert.match(events[0].message, /spec:0001  Good spec/);
    assert.deepEqual(events.slice(1), [
        {
            channel: 'stderr',
            message: 'Malformed .scratch/0002-missing-heading/spec.md: The artifact has no first level-one heading.',
        },
        {
            channel: 'stderr',
            message: 'Malformed .scratch/0004-not-a-file/spec.md: Registered artifact path must be a regular file.',
        },
        {channel: 'stderr', message: 'Hint: legacy issue or PRD format detected.'},
        {channel: 'stderr', message: 'Run `arw migrate artifacts` to upgrade the entire repository before retrying.'},
    ]);
});

test('open map and spec enforce artifact boundaries', async t => {
    const repository = await createRepository(t);
    await writeArtifact(repository.root, '0001-bad-map', 'map.md', '## Missing H1\n');
    await writeArtifact(repository.root, '0002-legacy-spec', 'PRD.md', '# Legacy\n');
    await writeArtifact(repository.root, '0003-editor-failure', 'spec.md', '# Editor failure\n');
    let started = false;
    const spawn = () => {
        started = true;
        const child = createMockChild();
        queueMicrotask(() => child.emit('error', new Error('ENOENT')));
        return child;
    };

    const traversal = await run(['open', '../map:0001'], repository, {spawnProcess: spawn});
    const absolute = await run(['open', join(repository.root, '.scratch', '0002-legacy-spec', 'PRD.md')], repository, {spawnProcess: spawn});
    const legacy = await run(['open', 'spec:0002'], repository, {spawnProcess: spawn});
    const malformed = await run(['open', 'map:0001'], repository, {spawnProcess: spawn});

    assert.equal(traversal.result, 2);
    assert.equal(absolute.result, 2);
    assert.equal(legacy.result, 1);
    assert.match(legacy.events[0].message, /Spec not found/);
    assert.equal(malformed.result, 1);
    assert.match(malformed.events.map(event => event.message).join('\n'), /no first level-one heading/);
    assert.equal(started, false);

    const failedEditor = await run(['open', 'spec:0003'], repository, {spawnProcess: spawn});
    assert.equal(failedEditor.result, 1);
    assert.deepEqual(failedEditor.events, [
        {channel: 'stdout', message: 'Opening .scratch/0003-editor-failure/spec.md'},
        {channel: 'stderr', message: 'Failed to start editor command "code".'},
    ]);
});

test('explicit list filters replace defaults and intersect', async t => {
    const repository = await createRepository(t);
    await writeIssue(repository.root, '0001-filters', '01-ready.md', '# Ready\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- None\n');
    await writeIssue(repository.root, '0001-filters', '02-blocked.md', '# Blocked\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- 01\n');
    await writeIssue(repository.root, '0001-filters', '03-claimed.md', '# Claimed\n\nType: task\nStatus: claimed\nBlocked by: None\n');
    await writeIssue(repository.root, '0001-filters', '04-completed.md', '# Completed\n\nStatus: completed\n\n## Blocked by\n\n- None\n');

    const complete = await run(
        ['list', 'issues', '--status', 'ready-for-agent,claimed', '--type', 'implementation,wayfinder'],
        repository,
    );
    const short = await run(['li', '-s', 'ready-for-agent,claimed', '-t', 'implementation,wayfinder'], repository);
    const output = short.events.find(event => event.channel === 'stdout')?.message ?? '';

    assert.equal(short.result, 0);
    assert.deepEqual(short, complete);
    assert.match(output, /issue:0001:01/);
    assert.match(output, /issue:0001:02/);
    assert.match(output, /issue:0001:03/);
    assert.doesNotMatch(output, /issue:0001:04/);
});

test('all-statuses short option intersects with type', async t => {
    const repository = await createRepository(t);
    await writeIssue(repository.root, '0001-all-type', '01-completed.md', '# Completed\n\nStatus: completed\n\n## Blocked by\n\n- None\n');
    await writeIssue(repository.root, '0001-all-type', '02-claimed.md', '# Claimed\n\nType: task\nStatus: claimed\nBlocked by: None\n');

    const invocations = [
        ['list', 'issues', '--all-statuses', '--type', 'implementation'],
        ['list', 'issues', '--all-statuses', '-t', 'implementation'],
        ['li', '-a', '--type', 'implementation'],
        ['li', '-a', '-t', 'implementation'],
    ];
    const outcomes = await Promise.all(invocations.map(args => run(args, repository)));
    const output = outcomes[0].events.find(event => event.channel === 'stdout')?.message ?? '';

    for (const outcome of outcomes) {
        assert.deepEqual(outcome, outcomes[0]);
    }
    assert.equal(outcomes[0].result, 0);
    assert.match(output, /issue:0001:01/);
    assert.doesNotMatch(output, /issue:0001:02/);
});

test('issue list rejects the removed release-validation type filter', async t => {
    const repository = await createRepository(t);
    const outcome = await run(['list', 'issues', '--all-statuses', '--type', 'release-validation'], repository);

    assert.equal(outcome.result, 2);
    assert.equal(outcome.events[0]?.channel, 'stderr');
    assert.match(
        outcome.events[0]?.message ?? '',
        /--type only accepts implementation, application-source, and wayfinder\./,
    );
});

test('all-statuses rejects status filters and repeated flags', async t => {
    const repository = await createRepository(t);
    const allOptions = ['--all-statuses', '-a'];
    const statusOptions = ['--status', '-s'];
    const conflicts = allOptions.flatMap(allOption =>
        statusOptions.flatMap(statusOption => [
            ['li', allOption, statusOption, 'completed'],
            ['li', statusOption, 'completed', allOption],
        ]),
    );
    const repetitions = allOptions.flatMap(first => allOptions.map(second => ['li', first, second]));

    for (const args of conflicts) {
        const outcome = await run(args, repository);

        assert.equal(outcome.result, 2);
        assert.match(outcome.events[0].message, /\n--all-statuses\/-a cannot be combined with --status\/-s\.$/);
        assert.ok(outcome.events.every(event => event.channel === 'stderr'));
    }

    for (const args of repetitions) {
        const outcome = await run(args, repository);

        assert.equal(outcome.result, 2);
        assert.match(outcome.events[0].message, /\nUnknown or repeated option: (?:--all-statuses|-a)\.$/);
        assert.ok(outcome.events.every(event => event.channel === 'stderr'));
    }
});

test('nested repository discovery is nearest and IDs include effort', async t => {
    const repository = await createRepository(t);
    const nestedRoot = join(repository.root, 'nested');

    await mkdir(nestedRoot, {recursive: true});
    await runGit(nestedRoot, ['init', '--quiet']);
    await mkdir(join(nestedRoot, '.scratch'), {recursive: true});
    await writeIssue(repository.root, '0001-outer-effort', '01-same-name.md', '# Outer\n\nStatus: ready-for-agent\n');
    await writeIssue(nestedRoot, '0001-inner-effort', '01-same-name.md', '# Inner\n\nStatus: ready-for-agent\n');

    const nestedRun = await run(['li'], repository, {cwd: nestedRoot});
    const outerRun = await run(['li'], repository);
    const nestedOutput = nestedRun.events.find(event => event.channel === 'stdout')?.message ?? '';
    const outerOutput = outerRun.events.find(event => event.channel === 'stdout')?.message ?? '';

    assert.equal(nestedRun.result, 0);
    assert.match(nestedOutput, /issue:0001:01/);
    assert.match(nestedOutput, /Inner/);
    assert.doesNotMatch(nestedOutput, /Outer/);
    assert.equal(outerRun.result, 0);
    assert.match(outerOutput, /issue:0001:01/);
    assert.match(outerOutput, /Outer/);
    assert.doesNotMatch(outerOutput, /Inner/);
});

test('open issue starts configured editor with absolute file path', async t => {
    const repository = await createRepository(t);
    /** @type {EditorSpawnCall[]} */
    const calls = [];
    await writeIssue(repository.root, '0001-open-effort', '01-open-me.md', '# Open me\n\nStatus: completed\n');
    await writeConfig(repository.programDirectory, {configVersion: 1, editor: {command: 'code', args: ['--file={file}']}});

    const spawn = (/** @type {string} */ command, /** @type {readonly string[]} */ args, /** @type {Parameters<ArwSpawn>[2]} */ spawnOptions) => {
        calls.push({args, command, spawnOptions});
        const child = createMockChild(true);
        queueMicrotask(() => child.emit('spawn'));
        queueMicrotask(() => child.emit('exit', 0));
        return child;
    };
    const complete = await run(['open', 'issue:0001:01'], repository, {spawnProcess: spawn});

    assert.equal(complete.result, 0);
    assert.deepEqual(complete.events, [{channel: 'stdout', message: 'Opening .scratch/0001-open-effort/issues/01-open-me.md'}]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].spawnOptions.stdio, 'ignore');

    if (process.platform === 'win32') {
        assert.equal(calls[0].command, 'powershell.exe');
        for (const call of calls) {
            assert.deepEqual(JSON.parse(call.spawnOptions.env?.ARW_EDITOR_ARGS ?? '[]'), [
                `--file=${join(repository.root, '.scratch', '0001-open-effort', 'issues', '01-open-me.md')}`,
            ]);
        }
    } else {
        assert.equal(calls[0].command, 'code');
        for (const call of calls) {
            assert.equal(call.args.length, 1);
            assert.match(call.args[0], /^--file=.*[\\/]\.scratch[\\/]0001-open-effort[\\/]issues[\\/]01-open-me\.md$/);
        }
    }
});

test('Windows editor launcher preserves command arguments', async () => {
    /** @type {EditorSpawnCall[]} */
    const calls = [];
    const spawn = (/** @type {string} */ command, /** @type {readonly string[]} */ args, /** @type {Parameters<ArwSpawn>[2]} */ spawnOptions) => {
        calls.push({args, command, spawnOptions});
        const child = createMockChild();
        queueMicrotask(() => child.emit('spawn'));
        queueMicrotask(() => child.emit('exit', 0));
        return child;
    };

    await launchEditor(
        {command: 'code', args: ['--reuse-window', '{file}']},
        'C:\\path with spaces\\issue.md',
        spawn,
        'win32',
    );

    assert.equal(calls.length, 1);
    const call = calls[0];
    if (call === undefined) assert.fail('Expected one Windows editor launch.');
    const environment = call.spawnOptions.env;
    if (environment === undefined) assert.fail('Expected Windows editor environment.');
    assert.equal(call.command, 'powershell.exe');
    assert.deepEqual(call.args.slice(0, 2), ['-NoProfile', '-Command']);
    assert.equal(call.spawnOptions.stdio, 'ignore');
    assert.equal(call.spawnOptions.windowsHide, true);
    assert.equal(environment.ARW_EDITOR_COMMAND, 'code');
    assert.deepEqual(JSON.parse(environment.ARW_EDITOR_ARGS ?? '[]'), [
        '--reuse-window',
        'C:\\path with spaces\\issue.md',
    ]);
});

test('Windows editor launcher reports launcher failure', async () => {
    const spawn = () => {
        const child = createMockChild();
        queueMicrotask(() => child.emit('spawn'));
        queueMicrotask(() => child.emit('exit', 1));
        return child;
    };

    await assert.rejects(
        launchEditor({command: 'missing-editor', args: ['{file}']}, 'C:\\issue.md', spawn, 'win32'),
        /launcher exited with code 1/,
    );
});
