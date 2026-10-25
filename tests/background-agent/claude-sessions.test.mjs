import assert from 'node:assert/strict';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {createBackgroundAgentHost} from '../../lib/arw-background-agent-host.mjs';
import {createClaudeSessions} from '../../lib/background-agent/claude-sessions.mjs';
import {renderBackgroundAgents} from '../../lib/background-agent/presentation.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';

const executable = fileURLToPath(new URL('../fixtures/fake-claude.mjs', import.meta.url));
const settings = {model: 'haiku', modelProvider: 'anthropic', reasoningEffort: 'high', serviceTier: 'default', config: {}};

/** @param {import('node:test').TestContext} t @param {Record<string,string>} [environment] */
const fixture = async (t, environment = {}) => {
    const directory = await createTemporaryDirectory(t, 'arw-claude-sessions-');
    const log = join(directory, 'calls.jsonl');
    await writeFile(join(directory, 'config.json'), JSON.stringify({configVersion: 3, editor: {command: 'code', args: ['{file}']}, reviewEditor: {command: 'code', args: ['{file}']},
        jira: {listLimit: 50}, reviewers: {'requirements-reviewer': {model: 'haiku', modelProvider: 'anthropic', env: {ANTHROPIC_BASE_URL: 'https://models.example'}}}}));
    const sessions = createClaudeSessions({executable,
        environment: {...process.env, ...environment, FAKE_CLAUDE_LOG: log, CLAUDE_CONFIG_DIR: directory}});
    t.after(() => sessions.close());
    /** @type {Array<() => void>} */
    const waiters = [];
    const open = () => sessions.open({settings: {...settings, programDirectory: directory}, role: 'requirements-reviewer', cwd: directory, readPaths: [], writePaths: [join(directory, 'reports')],
        onNotification: () => {for (const wake of waiters.splice(0)) wake();}});
    const changed = () => new Promise(resolve => {waiters.push(() => resolve(undefined));});
    const calls = async () => (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    return {directory, open, changed, calls};
};

/** @param {Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['open']>>} session @param {string} threadId */
const root = async (session, threadId) => (await session.snapshot({rootThreadId: threadId})).members[0];

test('a new Claude session runs one restricted turn and later turns resume it', async t => {
    const f = await fixture(t);
    const session = await f.open();
    const {threadId, sessionPath} = await session.start({instructions: 'Reviewer rules.'});
    assert.equal(sessionPath, join(f.directory, 'projects', f.directory.replace(/[^A-Za-z0-9]/g, '-'), `${threadId}.jsonl`));
    assert.equal((await root(session, threadId)).hasConversationHistory, false);
    let changed = f.changed();
    assert.deepEqual(await session.startTurn({threadId, handoff: 'Review it.'}), {turnId: 'turn-1'});
    assert.equal((await root(session, threadId)).state, 'active');
    await changed;
    const first = await root(session, threadId);
    assert.equal(first.state, 'idle');
    assert.equal(first.turnStatus, 'completed');
    assert.equal(first.finalResponse, '{"status":"ready"}');
    assert.equal(first.usage.totalTokens, 19);
    assert.deepEqual(first.contexts[0].permissionsRules, [{path: f.directory, access: 'read'}, {path: join(f.directory, 'reports'), access: 'write'}]);
    changed = f.changed();
    await session.startTurn({threadId, handoff: 'Review the fix.'});
    await changed;
    const [created, resumed] = await f.calls();
    assert.equal(created.prompt, 'Review it.');
    assert.equal(created.cwd, f.directory);
    assert.equal(created.baseUrl, 'https://models.example');
    assert.equal(JSON.parse(created.args[created.args.indexOf('--json-schema') + 1]).required[0], 'status');
    for (const [flag, value] of [['--session-id', threadId], ['--model', 'haiku'], ['--effort', 'high'], ['--permission-mode', 'dontAsk'],
        ['--tools', 'Read,Grep,Glob,Edit,Write,Bash'], ['--disallowedTools', 'Bash(git *--output*)', 'Bash(git *--no-index*)'], ['--allowedTools', 'Bash(git show:*)'],
        ['--append-system-prompt', 'Reviewer rules.']]) {
        assert.equal(created.args[created.args.indexOf(flag) + 1], value, flag);
    }
    assert.equal(created.args.at(-1), `Edit(/${join(f.directory, 'reports')}/**)`);
    assert.equal(resumed.args[resumed.args.indexOf('--resume') + 1], threadId);
    assert.ok(!resumed.args.includes('--session-id'));
    assert.equal((await root(session, threadId)).usage.totalTokens, 38);

    const restored = await f.open();
    await restored.resume({threadId, expectedSessionPath: sessionPath, instructions: 'Reviewer rules.'});
    assert.equal((await root(restored, threadId)).hasConversationHistory, true);
    await assert.rejects(restored.steer({threadId, turnId: 'turn-1', instruction: 'More.'}), /cannot take instructions while it runs/);
});

test('interrupting a Claude turn ends its process', async t => {
    const f = await fixture(t, {FAKE_CLAUDE_MODE: 'hang'});
    const session = await f.open();
    const {threadId} = await session.start({instructions: 'Reviewer rules.'});
    const changed = f.changed();
    const {turnId} = await session.startTurn({threadId, handoff: 'Review it.'});
    assert.deepEqual(await session.idleFacts({rootThreadId: threadId}), {safe: false, known: true, reason: 'The Claude turn is running.'});
    await session.interruptGroup({rootThreadId: threadId, turnId});
    await changed;
    const member = await root(session, threadId);
    assert.equal(member.state, 'interrupted');
    assert.equal(member.finalResponse, null);
    assert.equal((await session.idleFacts({rootThreadId: threadId})).safe, true);
});

test('a failed Claude process marks its turn failed', async t => {
    const f = await fixture(t, {FAKE_CLAUDE_MODE: 'fail'});
    const session = await f.open();
    const {threadId} = await session.start({instructions: 'Reviewer rules.'});
    const changed = f.changed();
    await session.startTurn({threadId, handoff: 'Review it.'});
    await changed;
    const member = await root(session, threadId);
    assert.equal(member.state, 'failed');
    assert.equal(member.turnStatus, 'failed');
    assert.equal(member.finalResponse, null);
});

test('a Claude Code Main starts, follows up, waits for and interrupts a Claude Reviewer through the host', async t => {
    /** @type {Awaited<ReturnType<typeof createBackgroundAgentHost>>|null} */ let host = null;
    t.after(() => host?.manager.close());
    const directory = await createTemporaryDirectory(t, 'arw-claude-host-');
    const repositoryRoot = join(directory, 'repository');
    const programDirectory = join(directory, 'engine');
    const workspace = join(repositoryRoot, '.tmp', 'claude-code', 'main-session');
    const stateDirectory = join(workspace, 'runtime');
    await mkdir(stateDirectory, {recursive: true});
    await mkdir(programDirectory);
    await writeFile(join(programDirectory, 'config.json'), JSON.stringify({configVersion: 3, editor: {command: 'code', args: ['{file}']},
        reviewEditor: {command: 'code', args: ['{file}']}, jira: {listLimit: 50}, reviewers: {'requirements-reviewer': {model: 'haiku', modelProvider: 'anthropic', env: {ANTHROPIC_BASE_URL: 'https://host.example'}}}}));
    const log = join(directory, 'calls.jsonl');
    /** @type {NodeJS.ProcessEnv} */ const environment = {...process.env, FAKE_CLAUDE_LOG: log, CLAUDE_CONFIG_DIR: directory};
    const started = host = await createBackgroundAgentHost({installationDirectory: join(directory, 'installation'), programDirectory,
        nativeSessions: createClaudeSessions({executable, environment})});
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
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.fail('The Claude Reviewer did not complete.');
    };
    const first = await report('first');
    await writeFile(join(repositoryRoot, 'arw.config.json'), JSON.stringify({configVersion: 2, reviewers: {'requirements-reviewer': {env: {ANTHROPIC_AUTH_TOKEN: 'secret'}}}}));
    const rejected = await started.dispatch({ownerId: 'main-session', caller, operation: 'spawn_agent', input: {...handoff, ...first}});
    assert.match(JSON.stringify(rejected), /requirements-reviewer\.env is allowed only in the user-level ARW config\.json/);
    await rm(join(repositoryRoot, 'arw.config.json'));
    const {runId} = await dispatch('spawn_agent', {...handoff, ...first});
    assert.deepEqual(await completion(runId), {status: 'ready', reportPath: first.reportPath});
    assert.match(renderBackgroundAgents(await started.manager.list()), /idle +requirements-reviewer +.*main-session/);
    const second = await report('second');
    await dispatch('followup_task', {...handoff, ...second, runId});
    assert.deepEqual(await completion(runId), {status: 'ready', reportPath: second.reportPath});
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(calls.length, 2);
    assert.equal(calls[0].args[calls[0].args.indexOf('--model') + 1], 'haiku');
    assert.equal(calls[0].baseUrl, 'https://host.example');
    assert.equal(calls[1].args[calls[1].args.indexOf('--resume') + 1], calls[0].args[calls[0].args.indexOf('--session-id') + 1]);

    environment.FAKE_CLAUDE_MODE = 'hang';
    const third = await report('third');
    await dispatch('followup_task', {...handoff, ...third, runId});
    await started.manager.owned(runId, 'main-session', 'main-session').work;
    const running = await dispatch('list_agents', {runId});
    assert.equal(running.state, 'running');
    await dispatch('interrupt_agent', {runId, turnId: running.turnId});
    for (let attempt = 0; attempt < 200 && (await dispatch('list_agents', {runId})).state === 'running'; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.notEqual((await dispatch('list_agents', {runId})).state, 'running');
});
