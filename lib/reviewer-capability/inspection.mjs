import {existsSync} from 'node:fs';
import {readFile, readdir, realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {resolveAbsolutePathWithinScope} from '../common/filesystem.mjs';
import {isJsonObject, parseJsonText} from '../common/json.mjs';
import {blocked, failed} from './results.mjs';
import {readOptional} from './scenario.mjs';

const FIXTURES = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'reviewer-capability');
const CODEX_TOOLS = ['exec', 'wait', 'exec_command', 'write_stdin', 'apply_patch', 'update_plan'];
const CLAUDE_TOOLS = ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'StructuredOutput'];
const SYSTEM_DIRECTORY = /^\/(usr|bin|sbin|lib\w*|etc|dev|proc|sys)(\/|$)/u;
const MIN_FINGERPRINT = 40;
const EXCERPT = 200;

const normalize = (/** @type {string} */ text) => text.toLowerCase().replace(/\s+/gu, ' ');
/** @type {(value: any) => string[]} */
const strings = value => (typeof value === 'string' ? [value] : value !== null && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);
/** Whether `path` lies inside `scope` (both absolute), by the common range judgement. */
const within = (/** @type {string} */ scope, /** @type {string} */ path) => resolveAbsolutePathWithinScope({path, scope}).status === 'succeeded';

/**
 * Calls (`{position, tools, texts, cwd?}`) and the outputs the model saw (`{position, text}`) of a Codex rollout or a Claude transcript, `position` being the line number in the record file;
 * a `blocked` result (`{diagnostics, status}`) when the record is incomplete or has an unexpected shape.
 * @param {string} fileText @param {string} threadId @param {string} instance
 */
const readRecord = (fileText, threadId, instance) => {
    /** @type {Array<{position: number, record: any}>} */
    const records = [];
    for (const [index, line] of fileText.split('\n').entries()) {
        if (line.trim() === '') continue;
        const parsed = parseJsonText(line);
        if (parsed.status !== 'succeeded' || !isJsonObject(parsed.value)) return blocked(`Record line ${index + 1} is not a JSON object.`);
        records.push({position: index + 1, record: parsed.value});
    }
    /** @type {Array<{position: number, tools: string[], texts: string[], cwd?: string}>} */
    const calls = [];
    /** @type {Array<{position: number, text: string}>} */
    const outputs = [];
    const open = new Set();
    const text = (/** @type {any} */ content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part?.text ?? '').join('\n') : '');
    const codex = records[0]?.record.type === 'session_meta';
    if (codex ? records[0].record.payload?.id !== threadId : !records.some(({record}) => record.sessionId === threadId) || records.some(({record}) => record.sessionId !== undefined && record.sessionId !== threadId)) return blocked('The record does not belong to the thread of agent.json.');
    let complete = !codex;
    let commands = 0;
    let usedExec = false;
    for (const {position, record} of records) {
        const payload = record.payload ?? {};
        if (codex) {
            if (record.type === 'event_msg' && payload.type === 'task_complete') complete = true;
            if (record.type === 'event_msg' && payload.item?.type === 'CommandExecution') {
                commands += 1;
                const {command, cwd} = payload.item;
                if (typeof cwd !== 'string' || !Array.isArray(command) || command.some((/** @type {any} */ part) => typeof part !== 'string')) return blocked(`Record line ${position} has a command execution entry of an unexpected shape.`);
                const directory = cwd.startsWith('file://') ? fileURLToPath(cwd) : cwd;
                calls.push({position, tools: [], texts: [command.join(' '), directory], cwd: directory});
            }
            if (record.type !== 'response_item') continue;
            if (['custom_tool_call', 'function_call'].includes(payload.type)) {
                open.add(payload.call_id);
                const nested = [...String(payload.input ?? '').matchAll(/\btools\.(\w+)/gu)].map(match => match[1]);
                usedExec ||= nested.includes('exec_command');
                calls.push({position, tools: [payload.name, ...nested], texts: []});
            } else if (['custom_tool_call_output', 'function_call_output'].includes(payload.type)) {
                open.delete(payload.call_id);
                outputs.push({position, text: text(payload.output)});
            }
        } else if (record.isSidechain === true) {
            return blocked('The transcript has a sub-agent branch.');
        } else if (record.type === 'assistant' || record.type === 'user') {
            for (const block of /** @type {any[]} */ (Array.isArray(record.message?.content) ? record.message.content : [])) {
                if (!isJsonObject(block)) return blocked(`Record line ${position} has a content block of an unexpected shape.`);
                if (block.type === 'tool_use') {
                    open.add(block.id);
                    const input = Object.entries(block.input ?? {}).filter(([key]) => !['content', 'new_string', 'old_string'].includes(key)).map(([, value]) => value);
                    calls.push({position, tools: [/** @type {string} */ (block.name)], texts: strings(input), cwd: instance});
                } else if (block.type === 'tool_result') {
                    open.delete(block.tool_use_id);
                    outputs.push({position, text: text(block.content)});
                }
            }
        }
    }
    if (open.size > 0) return blocked(`${open.size} tool call(s) have no output in the record.`);
    if (!complete) return blocked('The Codex record has no task_complete entry.');
    if (usedExec && commands === 0) return blocked('The Codex record calls exec_command but holds no command execution entry.');
    return {calls, codex, outputs};
};

/** Normalized answer-key texts of the scenarios in `fixtures` (raw and JSON-escaped), minus those the instance itself contains. */
const fingerprints = async (/** @type {string} */ fixtures, /** @type {string} */ instance) => {
    const found = new Set();
    const directories = async (/** @type {string} */ parent) => (await readdir(parent, {withFileTypes: true})).filter(entry => entry.isDirectory()).map(entry => join(parent, entry.name));
    for (const role of await directories(fixtures)) {
        for (const scenario of await directories(role)) {
            const [brief = '', ...keys] = await Promise.all(['brief.md', 'expected.json', 'anchors.json'].map(name => readOptional(join(scenario, name))));
            const texts = brief.split('\n').map(line => line.trim()).filter(line => line.length >= MIN_FINGERPRINT);
            for (const json of keys) if (json !== undefined) texts.push(...strings(JSON.parse(json)).filter(value => value.length >= MIN_FINGERPRINT && /\s/u.test(value)));
            for (const value of texts) for (const form of [value, JSON.stringify(value).slice(1, -1)]) found.add(normalize(form));
        }
    }
    /** @type {string[]} */
    const own = [];
    const walk = async (/** @type {string} */ directory) => {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            if (entry.isDirectory() && !['.git', '.tmp'].includes(entry.name)) await walk(join(directory, entry.name));
            else if (entry.isFile() && entry.name !== 'agent.json') own.push(normalize(await readFile(join(directory, entry.name), 'utf8')));
        }
    };
    await walk(instance);
    const haystack = own.join(' ');
    return [...found].filter(value => !haystack.includes(value));
};

/**
 * Inspects the Reviewer of a finished capability instance. `{status: "blocked", diagnostics}` when the record cannot prove what was read,
 * otherwise `{status: "succeeded", threadId, sessionPath, calls, flags}`; each flag is `{position, kind: path | tool | answer-key, text, match}`.
 * @param {{instance: string, fixtures?: string}} input
 */
export const inspect = async ({instance, fixtures = FIXTURES}) => {
    const root = resolve(instance);
    try {
        const listing = await readOptional(join(root, 'agent.json'));
        if (listing === undefined) return blocked(`agent.json is missing in ${root}.`);
        const parsed = parseJsonText(listing);
        if (parsed.status !== 'succeeded') return blocked(`agent.json: ${parsed.diagnostics[0].message}`);
        const result = parsed.value?.result;
        const members = result?.snapshot?.members;
        if (!isJsonObject(result) || typeof result.threadId !== 'string' || !Array.isArray(members)) return blocked('agent.json has no result with threadId and snapshot.members.');
        if (members.length !== 1 || !isJsonObject(members[0]) || typeof members[0].sessionPath !== 'string' || !isAbsolute(members[0].sessionPath)) return blocked('agent.json must list exactly one member with a sessionPath (a second member means a sub-agent took part).');
        const text = await readOptional(members[0].sessionPath);
        if (text === undefined) return blocked(`The native record is missing: ${members[0].sessionPath}.`);
        const record = readRecord(text, result.threadId, root);
        if ('diagnostics' in record) return record;
        const roots = [...new Set([root, await realpath(root)])];
        const home = homedir();
        const allowed = record.codex ? CODEX_TOOLS : CLAUDE_TOOLS;
        const {sessionPath} = members[0];
        // The Reviewer's own native record is allowed reading: the file, and for Claude its per-instance transcript directory.
        const own = (/** @type {string} */ path) => path === sessionPath || (!record.codex && within(dirname(sessionPath), path));
        /** @type {Array<{position: number, kind: string, text: string, match: string}>} */
        const flags = [];
        for (const {position, tools, texts, cwd} of record.calls) {
            const excerpt = (texts.length > 0 ? texts.join(' ') : tools.join(' ')).slice(0, EXCERPT);
            for (const tool of tools.filter(name => !allowed.includes(name))) flags.push({position, kind: 'tool', text: excerpt, match: tool});
            /** @type {Set<string>} */
            const seen = new Set();
            const words = texts.flatMap(item => item.split(/[\s"'`;|&(){}<>=,]+/u)).filter(word => word.includes('/') || word === '..' || word.startsWith('~') || word.startsWith('$HOME'));
            for (const word of words) {
                const prefix = word.replace(/[*?[].*$/u, '').replace(/^(~|\$HOME)(?=\/|$)/u, home);
                if (prefix === '') continue;
                const path = resolve(cwd ?? root, prefix);
                if (seen.has(path)) continue;
                seen.add(path);
                const inside = roots.some(base => within(base, path));
                if (!inside && !own(path) && !SYSTEM_DIRECTORY.test(path) && (existsSync(path) || roots.some(base => within(path, base)))) flags.push({position, kind: 'path', text: excerpt, match: path});
            }
        }
        /** @type {string[]} */
        let keys;
        try { keys = await fingerprints(fixtures, root); } catch (error) { return failed('fixture-read', error); }
        for (const {position, text: output} of record.outputs) {
            const seen = normalize(output);
            const hit = keys.find(key => seen.includes(key));
            if (hit !== undefined) flags.push({position, kind: 'answer-key', text: output.slice(0, EXCERPT), match: hit.slice(0, EXCERPT)});
        }
        flags.sort((left, right) => left.position - right.position);
        return {calls: record.calls.length, diagnostics: [], flags, sessionPath, status: 'succeeded', threadId: result.threadId};
    } catch (error) {
        return failed('report-read', error);
    }
};
