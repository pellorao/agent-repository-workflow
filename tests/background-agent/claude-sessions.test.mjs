import assert from 'node:assert/strict';
import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {createBackgroundAgentHost} from '../../lib/arw-background-agent-host.mjs';
import {createClaudeSessions} from '../../lib/background-agent/claude-sessions.mjs';
import {readClaudeMainTitle} from '../../lib/background-agent/claude-consumption.mjs';
import {claudeProcessIdentityPath} from '../../lib/background-agent/process-identity.mjs';
import {renderBackgroundAgents} from '../../lib/background-agent/presentation.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';

const executable = fileURLToPath(new URL('../fixtures/fake-claude.mjs', import.meta.url));
const settings = {model: 'haiku', modelProvider: 'anthropic', reasoningEffort: 'high', serviceTier: 'default', config: {}};

/** @param {import('node:test').TestContext} t @param {Record<string,string>} [environment] */
const fixture = async (t, environment = {}) => {
    const directory = await createTemporaryDirectory(t, 'arw-claude-sessions-');
    const runtimeDirectory = join(directory, 'runtime');
    await mkdir(runtimeDirectory, {mode: 0o700});
    const log = join(directory, 'calls.jsonl');
    await writeFile(join(directory, 'config.json'), JSON.stringify({configVersion: 3, editor: {command: 'code', args: ['{file}']}, reviewEditor: {command: 'code', args: ['{file}']},
        jira: {listLimit: 50}, reviewers: {'requirements-reviewer': {model: 'haiku', modelProvider: 'anthropic', env: {ANTHROPIC_BASE_URL: 'https://models.example'}}}}));
    const sessions = createClaudeSessions({executable, runtimeDirectory,
        environment: {...process.env, ...environment, FAKE_CLAUDE_LOG: log, CLAUDE_CONFIG_DIR: directory}});
    t.after(() => sessions.close());
    /** @type {Array<() => void>} */
    const waiters = [];
    const open = (role = 'requirements-reviewer') => sessions.open({settings: {...settings, programDirectory: directory}, role, cwd: directory, readPaths: [],
        writePaths: [join(directory, 'reports')], runId: 'run-1', onNotification: () => {for (const wake of waiters.splice(0)) wake();}});
    const changed = () => new Promise(resolve => {waiters.push(() => resolve(undefined));});
    const calls = async () => (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    return {directory, runtimeDirectory, sessions, open, changed, calls};
};

/** @param {Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['open']>>} session @param {string} threadId */
const root = async (session, threadId) => (await session.snapshot({rootThreadId: threadId})).members[0];
/** @param {Awaited<ReturnType<typeof fixture>>} f @param {Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['open']>>} session @param {string} threadId @param {string} state */
const settle = async (f, session, threadId, state) => {
    while ((await root(session, threadId)).state !== state) await f.changed();
};

test('a Claude turn runs one restricted stream-json process and later turns resume the session', async t => {
    const f = await fixture(t);
    const session = await f.open();
    const {threadId, sessionPath} = await session.start({instructions: 'Reviewer rules.'});
    assert.equal(sessionPath, join(f.directory, 'projects', f.directory.replace(/[^A-Za-z0-9]/g, '-'), `${threadId}.jsonl`));
    assert.equal((await root(session, threadId)).hasConversationHistory, false);
    const {turnId} = await session.startTurn({threadId, handoff: 'Review it.'});
    assert.match(turnId, /^turn-[0-9a-f-]{36}$/u);
    await settle(f, session, threadId, 'idle');
    const first = await root(session, threadId);
    assert.equal(first.turnStatus, 'completed');
    assert.equal(first.finalResponse, '{"status":"ready"}');
    assert.equal(first.usage.totalTokens, 19);
    const facts = /** @type {any} */ (await session.snapshot({rootThreadId: threadId})).measurementFacts;
    const [measured] = facts.responses;
    assert.equal(facts.workState.state, 'working');
    assert.deepEqual([measured.turnId, measured.inputTokens, measured.cachedInputTokens, measured.outputTokens], [turnId, 16, 5, 3]);
    assert.ok(measured.startedAt <= measured.firstGeneratedAt && measured.firstGeneratedAt <= measured.completedAt);
    assert.deepEqual(first.contexts[0].permissionsRules, [{path: f.directory, access: 'read'}, {path: join(f.directory, 'reports'), access: 'write'}]);
    assert.deepEqual(await readdir(f.runtimeDirectory), []);
    await session.startTurn({threadId, handoff: 'Review the fix.'});
    await settle(f, session, threadId, 'idle');
    const [created, firstPrompt, resumed, secondPrompt] = await f.calls();
    assert.deepEqual([firstPrompt.prompt, secondPrompt.prompt], ['Review it.', 'Review the fix.']);
    assert.equal(created.cwd, f.directory);
    assert.equal(created.baseUrl, 'https://models.example');
    assert.equal(created.runId, 'run-1');
    assert.equal(JSON.parse(created.args[created.args.indexOf('--json-schema') + 1]).required[0], 'status');
    for (const [flag, ...values] of [['--session-id', threadId], ['--model', 'haiku'], ['--effort', 'high'], ['--input-format', 'stream-json'],
        ['--permission-mode', 'default'], ['--permission-prompt-tool', 'stdio'],
        ['--tools', 'Read,Grep,Glob,Edit,Write,Bash'], ['--disallowedTools', 'Bash(git *--output*)', 'Bash(git *--no-index*)'],
        ['--allowedTools', 'Bash(arw background-agent:*)', 'Bash(git show:*)'], ['--append-system-prompt', 'Reviewer rules.']]) {
        const index = created.args.indexOf(flag) + 1;
        assert.deepEqual(created.args.slice(index, index + values.length), values, flag);
    }
    assert.equal(created.args.at(-1), `Edit(/${join(f.directory, 'reports')}/**)`);
    assert.ok(created.args.includes(`Bash(git -C ${f.directory} ls-tree:*)`));
    assert.ok(['--safe-mode', '--replay-user-messages', '--include-partial-messages'].every(flag => created.args.includes(flag)));
    assert.equal(resumed.args[resumed.args.indexOf('--resume') + 1], threadId);
    assert.ok(!resumed.args.includes('--session-id'));

    const general = await f.open('generic');
    await general.start({instructions: 'General rules.'});
    const restored = await f.open();
    await restored.resume({threadId, expectedSessionPath: sessionPath, instructions: 'Reviewer rules.'});
    assert.equal((await root(restored, threadId)).hasConversationHistory, true);
    await assert.rejects(restored.steer({threadId, turnId, instruction: 'More.'}), /turn has ended/);
});

test('a running Claude turn takes instructions and pending permission requests through stdio', async t => {
    const f = await fixture(t, {FAKE_CLAUDE_MODE: 'ask'});
    const session = await f.open('generic');
    const {threadId} = await session.start({instructions: 'General rules.'});
    const {turnId} = await session.startTurn({threadId, handoff: 'Do it.'});
    let requests = [];
    while (!(requests = (await session.snapshot({rootThreadId: threadId})).clientRequests).length) await f.changed();
    assert.deepEqual(requests, [{requestId: 'permission-1', kind: 'approval', method: 'can_use_tool', threadId, turnId,
        params: {toolName: 'Bash', input: {command: 'git status'}, reason: 'This command requires approval'}}]);
    assert.deepEqual(await session.steer({threadId, turnId, instruction: 'Also this.'}), {turnId});
    await assert.rejects(session.respond({requestId: 'permission-1', response: {behavior: 'maybe'}}), /behavior allow, or deny/);
    await session.respond({requestId: 'permission-1', response: {behavior: 'allow'}});
    await settle(f, session, threadId, 'idle');
    const snapshot = await session.snapshot({rootThreadId: threadId});
    assert.deepEqual(snapshot.userMessages?.map(item => item.text), ['Do it.', 'Also this.']);
    assert.equal(snapshot.members[0].usage.totalTokens, 38);
    const calls = await f.calls();
    assert.deepEqual(calls.find(call => call.control).control, {updatedInput: {command: 'git status'}, behavior: 'allow'});
    // An ordinary agent runs natively: settings, CLAUDE.md and the permission mode stay in force, and requests outside them still reach the manager.
    const {args} = calls[0];
    for (const flag of ['--safe-mode', '--setting-sources', '--strict-mcp-config', '--permission-mode']) assert.ok(!args.includes(flag), flag);
    assert.equal(args[args.indexOf('--permission-prompt-tool') + 1], 'stdio');
    assert.equal(args[args.indexOf('--allowedTools') + 1], 'Bash(arw background-agent:*)');
    assert.ok(!calls[0].args.includes('--json-schema') && !calls[0].args.includes('--tools'));
});

test('interrupting a Claude turn ends its process before the turn is reported', async t => {
    const f = await fixture(t, {FAKE_CLAUDE_MODE: 'hang'});
    const session = await f.open();
    const {threadId} = await session.start({instructions: 'Reviewer rules.'});
    const {turnId} = await session.startTurn({threadId, handoff: 'Review it.'});
    assert.deepEqual(await session.idleFacts({rootThreadId: threadId}), {safe: false, known: true, reason: 'The Claude turn is running.'});
    await session.interruptGroup({rootThreadId: threadId, turnId});
    const member = await root(session, threadId);
    assert.equal(member.state, 'interrupted');
    assert.equal(member.finalResponse, null);
    assert.equal((await session.idleFacts({rootThreadId: threadId})).safe, true);
    assert.deepEqual(await readdir(f.runtimeDirectory), []);
});

test('a failed Claude process marks its turn failed', async t => {
    const f = await fixture(t, {FAKE_CLAUDE_MODE: 'fail'});
    const session = await f.open();
    const {threadId} = await session.start({instructions: 'Reviewer rules.'});
    await session.startTurn({threadId, handoff: 'Review it.'});
    await settle(f, session, threadId, 'failed');
    assert.equal((await root(session, threadId)).finalResponse, null);
});

test('a Claude turn whose process identity cannot be recorded ends its process and fails', async t => {
    const f = await fixture(t);
    const sessions = createClaudeSessions({executable, runtimeDirectory: f.runtimeDirectory, environment: {...process.env, FAKE_CLAUDE_MODE: 'hang'},
        readCreationTime: async () => null});
    const session = await sessions.open({settings: {...settings, programDirectory: f.directory}, role: 'generic', cwd: f.directory, readPaths: [], writePaths: [],
        runId: 'run-1', onNotification: () => {}});
    const {threadId} = await session.start({instructions: 'General rules.'});
    await assert.rejects(session.startTurn({threadId, handoff: 'Do it.'}), /identity is unavailable/);
    assert.equal((await root(session, threadId)).state, 'failed');
    assert.equal((await session.idleFacts({rootThreadId: threadId})).safe, true);
});

test('a recorded Claude process stays unresolved until it has ended', async t => {
    const f = await fixture(t);
    await writeFile(claudeProcessIdentityPath(f.runtimeDirectory, 'ended-thread'), '999999,1', {mode: 0o600});
    await writeFile(claudeProcessIdentityPath(f.runtimeDirectory, 'live-thread'), `${process.pid},2`, {mode: 0o600});
    const sessions = createClaudeSessions({executable, runtimeDirectory: f.runtimeDirectory, readCreationTime: async pid => pid === process.pid ? '2' : null});
    assert.deepEqual(await sessions.unresolvedProcesses?.(), ['live-thread']);
    assert.deepEqual(await readdir(f.runtimeDirectory), ['claude-process-live-thread']);
});

test('a Claude Code Main title prefers its custom title, then the generated one, then its first prompt', async t => {
    const f = await fixture(t);
    const directory = await createTemporaryDirectory(t, 'arw-claude-title-');
    const path = join(directory, 'projects', '-repo', 'main.jsonl');
    await mkdir(dirname(path), {recursive: true});
    const title = () => readClaudeMainTitle({ownerId: 'main', environment: {CLAUDE_CONFIG_DIR: directory}});
    const lines = [{type: 'user', isMeta: true, message: {content: 'meta'}}, {type: 'user', message: {content: '<command-name>/x</command-name>'}},
        {type: 'user', message: {content: `${'界'.repeat(45)}`}}];
    await writeFile(path, lines.map(line => JSON.stringify(line)).join('\n'));
    assert.equal(await title(), '界'.repeat(40));
    await writeFile(path, [...lines, {type: 'ai-title', aiTitle: 'Generated'}].map(line => JSON.stringify(line)).join('\n'));
    assert.equal(await title(), 'Generated');
    await writeFile(path, [...lines, {type: 'custom-title', customTitle: 'Chosen'}, {type: 'ai-title', aiTitle: 'Generated'}].map(line => JSON.stringify(line)).join('\n'));
    assert.equal(await title(), 'Chosen');
    assert.equal(await readClaudeMainTitle({ownerId: 'other', environment: {CLAUDE_CONFIG_DIR: directory}}), null);
    const session = await createClaudeSessions({executable, runtimeDirectory: f.runtimeDirectory, environment: {CLAUDE_CONFIG_DIR: directory}})
        .open({settings, role: 'generic', cwd: directory, readPaths: [], writePaths: [], onNotification: () => {}});
    assert.deepEqual(await session.readThreadMetadata({threadId: 'main'}), {title: 'Chosen', sessionPath: path});
    assert.deepEqual(await session.readThreadMetadata({threadId: 'other'}), {title: null, sessionPath: null});
    await writeFile(path, JSON.stringify({type: 'user', sessionId: 'forked', message: {content: 'x'}}));
    await assert.rejects(session.readThreadMetadata({threadId: 'main'}), /identity changed/);
});

test('a Claude Code Main starts, waits for, follows up and messages a Claude Reviewer through the host', async t => {
    /** @type {Awaited<ReturnType<typeof createBackgroundAgentHost>>|null} */ let host = null;
    t.after(() => host?.manager.close());
    const directory = await createTemporaryDirectory(t, 'arw-claude-host-');
    const repositoryRoot = join(directory, 'repository');
    const programDirectory = join(directory, 'engine');
    const workspace = join(repositoryRoot, '.tmp', 'claude-code', 'main-session');
    const stateDirectory = join(workspace, 'runtime');
    const runtimeDirectory = join(directory, 'claude-runtime');
    await mkdir(stateDirectory, {recursive: true});
    await mkdir(runtimeDirectory, {mode: 0o700});
    await mkdir(programDirectory);
    await writeFile(join(programDirectory, 'config.json'), JSON.stringify({configVersion: 3, editor: {command: 'code', args: ['{file}']},
        reviewEditor: {command: 'code', args: ['{file}']}, jira: {listLimit: 50}, reviewers: {'requirements-reviewer': {model: 'haiku', modelProvider: 'anthropic', env: {ANTHROPIC_BASE_URL: 'https://host.example'}}}}));
    const log = join(directory, 'calls.jsonl');
    /** @type {NodeJS.ProcessEnv} */ const environment = {...process.env, FAKE_CLAUDE_LOG: log, CLAUDE_CONFIG_DIR: directory, FAKE_CLAUDE_MODE: 'ask'};
    const nativeSessions = createClaudeSessions({executable, environment, runtimeDirectory});
    t.after(() => nativeSessions.close());
    const started = host = await createBackgroundAgentHost({installationDirectory: join(directory, 'installation'), programDirectory, nativeSessions});
    const caller = {repositoryRoot, programDirectory, platform: 'claude-code'};
    const dispatch = async (/** @type {string} */ operation, /** @type {Record<string, unknown>} */ input) => {
        const response = await started.dispatch({ownerId: 'main-session', caller, operation, input});
        assert.equal(response.status, 'succeeded', JSON.stringify(response));
        return /** @type {Record<string, any>} */ (response.result);
    };
    const report = async (/** @type {string} */ name) => {
        const path = join(workspace, name, 'reports', 'review.md');
        await mkdir(dirname(path), {recursive: true});
        await writeFile(path, '');
        return {writePaths: [dirname(path)], reportPath: path, handoff: `Review the prepared evidence.\nreport: ${path}`};
    };
    const handoff = {role: 'requirements-reviewer', identity: {kind: 'ordinary', issueIds: ['issue:0093:01']},
        instructions: 'Complete Reviewer rules.', cwd: repositoryRoot, stateDirectory};
    const completion = async (/** @type {string} */ runId) => {
        for (let attempt = 0; attempt < 200; attempt++) {
            const status = await dispatch('list_agents', {runId});
            if (status.completion) return status.completion;
            await new Promise(resolve => setTimeout(resolve, 2));
        }
        assert.fail('The Claude Reviewer did not complete.');
    };
    const first = await report('first');
    const {runId} = await dispatch('spawn_agent', {...handoff, ...first});
    assert.deepEqual(await completion(runId), {status: 'ready', reportPath: first.reportPath});
    assert.match(renderBackgroundAgents(await started.manager.list()), /idle +requirements-reviewer +.*main-session/);
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(calls[0].args[calls[0].args.indexOf('--model') + 1], 'haiku');
    assert.equal(calls[0].baseUrl, 'https://host.example');
    assert.equal(calls[0].runId, runId);
    // The Reviewer policy declines the permission request with its reason, and the turn continues.
    assert.equal(calls.find(call => call.control).control.behavior, 'deny');
    assert.match(calls.find(call => call.control).control.message, /Denied Bash: This command requires approval/);

    environment.FAKE_CLAUDE_MODE = 'hang';
    const third = await report('third');
    await dispatch('followup_task', {...handoff, ...third, runId});
    await started.manager.owned(runId, 'main-session', 'main-session').work;
    const running = await dispatch('list_agents', {runId});
    assert.equal(running.state, 'running');
    assert.equal((await dispatch('send_message', {runId, turnId: running.turnId, message: 'Check the tests too.'})).deliveryStatus, 'accepted');
    for (let attempt = 0; attempt < 200 && !(await readFile(log, 'utf8')).includes('Check the tests too.'); attempt++) await new Promise(resolve => setTimeout(resolve, 2));
    assert.match(await readFile(log, 'utf8'), /ARW messageId: [^\\]+\\n\\nCheck the tests too\./);
    const starts = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(call => call.args);
    assert.equal(starts[1].args[starts[1].args.indexOf('--resume') + 1], starts[0].args[starts[0].args.indexOf('--session-id') + 1]);
});
