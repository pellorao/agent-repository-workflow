import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {inspect} from '../../lib/reviewer-capability/inspection.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {runProcess} from '../helpers/process.mjs';

const THREAD = 'thread-1';
const KEY = 'The reviewer must report that the dispatch plan drops the retry budget.';
const lines = (/** @type {any[]} */ records) => `${records.map(record => JSON.stringify(record)).join('\n')}\n`;

/** Codex record builders. */
const codex = {
    meta: (id = THREAD) => ({type: 'session_meta', payload: {id}}),
    call: (/** @type {string} */ id, input = 'const r = await tools.exec_command({cmd: "ls"});', name = 'exec') => ({type: 'response_item', payload: {type: 'custom_tool_call', call_id: id, name, input}}),
    out: (/** @type {string} */ id, text = 'ok') => ({type: 'response_item', payload: {type: 'custom_tool_call_output', call_id: id, output: [{type: 'input_text', text}]}}),
    run: (/** @type {string} */ command, /** @type {string} */ cwd) => ({type: 'event_msg', payload: {type: 'item_completed', item: {type: 'CommandExecution', command: ['/bin/bash', '-lc', command], cwd: `file://${cwd}`}}}),
    done: {type: 'event_msg', payload: {type: 'task_complete'}},
};
/** Claude record builders. */
const claude = {
    owner: (id = THREAD) => ({type: 'session-owner', sessionId: id}),
    use: (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({type: 'assistant', isSidechain: false, message: {content: [{type: 'tool_use', id, name, input}]}}),
    result: (/** @type {string} */ id, /** @type {string} */ content) => ({type: 'user', isSidechain: false, message: {content: [{type: 'tool_result', tool_use_id: id, content}]}}),
};

/** An instance with one file, an agent.json for `members` and a record of `records`; the fixtures hold one scenario whose answer key is `KEY`. */
const setup = async (/** @type {import('node:test').TestContext} */ t, /** @type {any[]} */ records, /** @type {any} */ options = {}) => {
    const root = await createTemporaryDirectory(t, 'arw-inspect-');
    const instance = join(root, 'run', 'one');
    await mkdir(join(instance, 'src'), {recursive: true});
    await mkdir(join(root, 'run', 'two'), {recursive: true});
    await writeFile(join(instance, 'src', 'a.mjs'), 'export const a = 1;\n');
    const sessionPath = join(root, 'record.jsonl');
    if (options.record !== false) await writeFile(sessionPath, options.text ?? lines(records));
    const member = {threadId: THREAD, sessionPath};
    if (options.agent !== false) await writeFile(join(instance, 'agent.json'), options.agentText ?? JSON.stringify(options.agent ?? {result: {threadId: THREAD, snapshot: {members: [member]}}}));
    const fixtures = join(root, 'fixtures');
    await mkdir(join(fixtures, 'role', 'scenario'), {recursive: true});
    await writeFile(join(fixtures, 'role', 'scenario', 'expected.json'), JSON.stringify({expectation: KEY, short: 'tiny', path: 'a/very/long/path/without/any/blank/in/it/at/all.md'}));
    return {fixtures, instance, root, sessionPath};
};
const run = async (/** @type {import('node:test').TestContext} */ t, /** @type {any[]} */ records, /** @type {any} */ options = {}) => {
    const {fixtures, instance, root} = await setup(t, records, options);
    return {result: /** @type {any} */ (await inspect({fixtures, instance})), instance, root};
};
const codexRecords = (/** @type {any[]} */ ...middle) => [codex.meta(), ...middle, codex.done];

test('a Reviewer that reads inside the instance with allowed tools has no flags, on both backends', async t => {
    const first = await setup(t, []);
    const codexClean = codexRecords(codex.call('c1'), codex.run('git diff --cached HEAD && sed -n "/a/,/b/p" src/a.mjs 2>/dev/null', first.instance), codex.out('c1', 'file text'));
    await writeFile(first.sessionPath, lines(codexClean));
    const codexResult = /** @type {any} */ (await inspect(first));
    assert.deepEqual([codexResult.status, codexResult.threadId, codexResult.calls, codexResult.flags], ['succeeded', THREAD, 2, []]);
    const {result} = await run(t, [claude.owner(), claude.use('u1', 'Read', {file_path: 'src/a.mjs'}), claude.result('u1', 'text'), claude.use('u2', 'Bash', {command: 'git show :src/a.mjs | head -3'}), claude.result('u2', 'x')]);
    assert.deepEqual([result.status, result.calls, result.flags], ['succeeded', 2, []]);
});

test('an incomplete record blocks instead of passing', async t => {
    const good = codexRecords(codex.call('c1'), codex.run('ls', '/x'), codex.out('c1'));
    /** @type {Array<[string, any[], any]>} */
    const cases = [
        ['no agent.json', good, {agent: false}],
        ['agent.json not JSON', good, {agentText: '{nope'}],
        ['no result', good, {agent: {}}],
        ['no threadId', good, {agent: {result: {snapshot: {members: [{sessionPath: 'a'}]}}}}],
        ['no member', good, {agent: {result: {threadId: THREAD, snapshot: {members: []}}}}],
        ['no session_meta', [codex.call('c1'), codex.done], {}],
        ['claude without sessionId', [claude.use('u1', 'Read', {}), claude.result('u1', 'x')], {}],
        ['no sessionPath', good, {agent: {result: {threadId: THREAD, snapshot: {members: [{threadId: THREAD}]}}}}],
        ['two members', good, {agent: {result: {threadId: THREAD, snapshot: {members: [{sessionPath: 'a'}, {sessionPath: 'b'}]}}}}],
        ['record file missing', good, {record: false}],
        ['another thread', [codex.meta('other'), codex.done], {}],
        ['bad JSON line', good, {text: `${lines(good)}{broken\n`}],
        ['call without output', codexRecords(codex.call('c1'), codex.run('ls', '/x')), {}],
        ['no task_complete', good.slice(0, -1), {}],
        ['exec_command without execution entry', codexRecords(codex.call('c1'), codex.out('c1')), {}],
        ['claude tool_use without result', [claude.owner(), claude.use('u1', 'Read', {file_path: 'x'})], {}],
        ['codex cwd not a string', codexRecords(codex.call('c1'), {type: 'event_msg', payload: {type: 'item_completed', item: {type: 'CommandExecution', command: ['ls'], cwd: 7}}}, codex.out('c1')), {}],
        ['codex command not an array', codexRecords(codex.call('c1'), {type: 'event_msg', payload: {type: 'item_completed', item: {type: 'CommandExecution', command: 'ls', cwd: '/x'}}}, codex.out('c1')), {}],
        ['null member', good, {agent: {result: {threadId: THREAD, snapshot: {members: [null]}}}}],
        ['null content block', [claude.owner(), {type: 'assistant', message: {content: [null]}}], {}],
        ['record line not an object', [...good, null], {}],
        ['claude sidechain', [claude.owner(), {...claude.use('u1', 'Read', {}), isSidechain: true}], {}],
    ];
    for (const [name, records, options] of cases) {
        const {result} = await run(t, records, options);
        assert.equal(result.status, 'blocked', name);
        assert.equal(result.flags, undefined, name);
    }
});

test('calls that leave the instance, and tools outside the allow list, are flagged', async t => {
    const {fixtures, instance, root, sessionPath} = await setup(t, []);
    const other = join(root, 'run', 'two');
    await writeFile(join(root, 'run', 'x'), 'outside\n');
    const records = codexRecords(
        codex.call('c1', 'await tools.view_image({path: "x"});'), codex.out('c1'),
        codex.run(`cat ../x; git -C ${root} status; find / -name "*.json"`, instance),
        codex.run(`cat ${other}/notes.md`, instance),
        codex.run('ls', other),
    );
    await writeFile(sessionPath, lines(records));
    const {flags} = /** @type {any} */ (await inspect({fixtures, instance}));
    const matches = flags.map((/** @type {any} */ flag) => `${flag.kind}:${flag.match}`);
    assert.ok(matches.includes('tool:view_image'));
    assert.ok(matches.includes(`path:${join(root, 'run', 'x')}`));
    assert.ok(matches.includes(`path:${root}`));
    assert.ok(matches.includes('path:/'));
    assert.ok(matches.includes(`path:${other}`));
    assert.ok(flags.every((/** @type {any} */ flag) => flag.text.length <= 200));
    assert.deepEqual(flags.map((/** @type {any} */ flag) => flag.position), [...flags.map((/** @type {any} */ flag) => flag.position)].sort((a, b) => a - b));
    const outside = await run(t, [claude.owner(), claude.use('u1', 'Read', {file_path: '/tmp'}), claude.result('u1', 'x'), claude.use('u2', 'WebFetch', {url: 'https://example.test'}), claude.result('u2', 'x')]);
    assert.deepEqual(outside.result.flags.map((/** @type {any} */ flag) => [flag.kind, flag.match]), [['path', '/tmp'], ['tool', 'WebFetch']]);
});

test('a path is flagged once per call, positions are file line numbers, and the Reviewer own record is allowed', async t => {
    const {fixtures, instance, root, sessionPath} = await setup(t, []);
    await writeFile(join(root, 'run', 'x'), 'outside\n');
    const records = codexRecords(codex.call('c1'), codex.run(`cat ../x ../x/ ${root}/run/x ${sessionPath}`, instance), codex.out('c1'));
    await writeFile(sessionPath, `\n${lines(records).replace('\n', '\n\n')}`);
    const {flags} = /** @type {any} */ (await inspect({fixtures, instance}));
    assert.deepEqual(flags.map((/** @type {any} */ flag) => [flag.kind, flag.position, flag.match]), [['path', 5, join(root, 'run', 'x')]]);
    const transcript = join(root, 'projects', 'one');
    await mkdir(transcript, {recursive: true});
    const claudePath = join(transcript, `${THREAD}.jsonl`);
    await writeFile(claudePath, lines([claude.owner(), claude.use('u1', 'Grep', {path: transcript}), claude.result('u1', 'x'), claude.use('u2', 'Read', {file_path: claudePath}), claude.result('u2', 'x')]));
    await writeFile(join(instance, 'agent.json'), JSON.stringify({result: {threadId: THREAD, snapshot: {members: [{threadId: THREAD, sessionPath: claudePath}]}}}));
    assert.deepEqual(/** @type {any} */ (await inspect({fixtures, instance})).flags, []);
});

test('answer-key text in tool output is flagged, in the Reviewer own writing or the instance it is not', async t => {
    const escaped = JSON.stringify(KEY).slice(1, -1);
    const {result} = await run(t, codexRecords(
        codex.call('c1'), codex.run('ls', '/x'), codex.out('c1', `{"expectation": "${escaped}"}`),
        codex.call('c2'), codex.out('c2', 'a/very/long/path/without/any/blank/in/it/at/all.md and the dispatch plan'),
        codex.call('c3'), codex.out('c3', `  ${KEY.toUpperCase()}`),
    ));
    assert.deepEqual(result.flags.map((/** @type {any} */ flag) => [flag.kind, flag.position]), [['answer-key', 4], ['answer-key', 8]]);
    const own = await run(t, [claude.owner(), claude.use('w1', 'Write', {file_path: 'report.txt', content: KEY}), claude.result('w1', 'written')]);
    assert.deepEqual(own.result.flags, []);
    const {fixtures, instance, sessionPath} = await setup(t, []);
    await writeFile(join(instance, 'src', 'copy.txt'), `${KEY}\n`);
    await writeFile(sessionPath, lines([claude.owner(), claude.use('u1', 'Read', {file_path: 'src/copy.txt'}), claude.result('u1', KEY)]));
    assert.deepEqual(/** @type {any} */ (await inspect({fixtures, instance})).flags, []);
});

test('unreadable inputs fail, repeated runs agree, and the entry maps results to exit codes', async t => {
    const {fixtures, instance, root, sessionPath} = await setup(t, []);
    await writeFile(join(root, 'run', 'x'), 'outside\n');
    await writeFile(sessionPath, lines(codexRecords(codex.call('c1'), codex.run('cat ../x ../x', instance), codex.out('c1', `${KEY} ${KEY}`))));
    const first = /** @type {any} */ (await inspect({fixtures, instance}));
    assert.deepEqual(JSON.stringify(first), JSON.stringify(await inspect({fixtures, instance})));
    assert.deepEqual([first.status, first.diagnostics, first.flags.map((/** @type {any} */ flag) => flag.kind)], ['succeeded', [], ['path', 'answer-key']]);
    const missing = /** @type {any} */ (await inspect({fixtures: sessionPath, instance}));
    assert.deepEqual([missing.status, missing.stage, missing.diagnostics.length], ['failed', 'fixture-read', 1]);
    const {instance: directory, fixtures: keys} = await setup(t, [], {agent: false});
    await mkdir(join(directory, 'agent.json'));
    const unreadable = /** @type {any} */ (await inspect({fixtures: keys, instance: directory}));
    assert.deepEqual([unreadable.status, unreadable.stage], ['failed', 'report-read']);
    const entry = join(import.meta.dirname, '..', '..', 'scripts', 'reviewer-capability.mjs');
    const [usage, blocked] = await Promise.all([runProcess(process.execPath, [entry, 'inspect']), runProcess(process.execPath, [entry, 'inspect', join(instance, 'src')])]);
    assert.equal(/** @type {any} */ (usage).exitCode, 2);
    assert.deepEqual([/** @type {any} */ (blocked).exitCode, JSON.parse(/** @type {any} */ (blocked).stdout).status], [1, 'blocked']);
});
