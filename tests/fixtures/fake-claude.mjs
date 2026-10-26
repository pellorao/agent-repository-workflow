#!/usr/bin/env node
// Stand-in for `claude -p --input-format stream-json --output-format stream-json`; FAKE_CLAUDE_MODE selects ready, hang, fail or ask.
// Stdin user messages are handled in order: each is echoed and answered with one result; a `report: <path>` line writes that report.
// `ask` holds the first message on a permission request until the manager answers it. The process exits when stdin ends.
import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createInterface} from 'node:readline';

const args = process.argv.slice(2);
const log = (/** @type {object} */ entry) => {if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify(entry)}\n`);};
const sessionId = args[args.indexOf(args.includes('--resume') ? '--resume' : '--session-id') + 1];
const projects = join(process.env.CLAUDE_CONFIG_DIR ?? '', 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-'));
mkdirSync(projects, {recursive: true});
const emit = (/** @type {object} */ event) => process.stdout.write(`${JSON.stringify({...event, session_id: sessionId})}\n`);
log({args, cwd: process.cwd(), baseUrl: process.env.ANTHROPIC_BASE_URL, runId: process.env.ARW_BACKGROUND_AGENT_RUN_ID});
emit({type: 'system', subtype: 'init'});
const mode = process.env.FAKE_CLAUDE_MODE;
if (mode === 'fail') {
    process.stderr.write('model unavailable\n');
    process.exit(1);
}
if (mode === 'hang') setInterval(() => {}, 1000);
/** @type {string[]} */ const queue = [];
/** @type {(() => void)|null} */ let wake = null;
/** @type {((response: unknown) => void)|null} */ let answered = null;
let ended = false;
const lines = createInterface({input: process.stdin});
lines.on('line', line => {
    const message = JSON.parse(line);
    if (message.type === 'control_response') {
        log({control: message.response.response});
        answered?.(message.response.response);
    } else queue.push(message.message.content);
    wake?.();
});
lines.on('close', () => {ended = true; wake?.();});
let asked = false;
while (queue.length || !ended) {
    const prompt = queue.shift();
    if (prompt === undefined) {
        await new Promise(resolve => {wake = () => resolve(undefined);});
        continue;
    }
    log({prompt});
    appendFileSync(join(projects, `${sessionId}.jsonl`), `${JSON.stringify({type: 'user', message: {role: 'user', content: prompt}})}\n`);
    emit({type: 'user', message: {role: 'user', content: prompt}});
    if (mode === 'hang') continue;
    if (mode === 'ask' && !asked) {
        asked = true;
        const response = new Promise(resolve => {answered = resolve;});
        emit({type: 'control_request', request_id: 'permission-1', request: {subtype: 'can_use_tool', tool_name: 'Bash', input: {command: 'git status'}, decision_reason: 'This command requires approval'}});
        await response;
    }
    const report = /^report: (.+)$/m.exec(prompt)?.[1];
    if (report) writeFileSync(report, 'Complete bound report.');
    emit({type: 'system', subtype: 'status', status: 'requesting'});
    emit({type: 'stream_event', event: {type: 'message_start', message: {id: `msg-${sessionId}-${prompt.length}`, usage: {input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 1}}}});
    emit({type: 'stream_event', event: {type: 'content_block_delta', delta: {type: 'text_delta', text: '{'}}});
    emit({type: 'stream_event', event: {type: 'message_delta', usage: {output_tokens: 3}}});
    emit({type: 'assistant', message: {content: [{type: 'text', text: '{"status":"ready"}'}]}});
    emit({type: 'result', subtype: 'success', is_error: false, result: '{"status":"ready"}',
        usage: {input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 1, output_tokens: 3}});
}
