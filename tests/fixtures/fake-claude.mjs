#!/usr/bin/env node
// Stand-in for `claude -p --output-format stream-json`; FAKE_CLAUDE_MODE selects ready, hang or fail.
// A ready turn writes the report named by a `report: <path>` prompt line.
import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const args = process.argv.slice(2);
if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({args, cwd: process.cwd(), prompt, baseUrl: process.env.ANTHROPIC_BASE_URL})}\n`);
const sessionId = args[args.indexOf(args.includes('--resume') ? '--resume' : '--session-id') + 1];
const projects = join(process.env.CLAUDE_CONFIG_DIR ?? '', 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-'));
mkdirSync(projects, {recursive: true});
appendFileSync(join(projects, `${sessionId}.jsonl`), `${JSON.stringify({prompt})}\n`);
const emit =(/** @type {object} */ event) => process.stdout.write(`${JSON.stringify({...event, session_id: sessionId})}\n`);
emit({type: 'system', subtype: 'init'});
if (process.env.FAKE_CLAUDE_MODE === 'hang') setInterval(() => {}, 1000);
else if (process.env.FAKE_CLAUDE_MODE === 'fail') {
    process.stderr.write('model unavailable\n');
    process.exitCode = 1;
} else {
    const report = /^report: (.+)$/m.exec(prompt)?.[1];
    if (report) writeFileSync(report, 'Complete bound report.');
    emit({type: 'assistant', message: {content: [{type: 'text', text: '{"status":"ready"}'}]}});
    emit({type: 'result', subtype: 'success', is_error: false, result: '{"status":"ready"}',
        usage: {input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 1, output_tokens: 3}});
}
