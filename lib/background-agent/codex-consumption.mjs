import {createReadStream} from 'node:fs';
import {glob} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {isAbsolute, join} from 'node:path';
import {codexHomeLocation} from '../common/codex-home.mjs';
import {isJsonObject} from '../common/json.mjs';
import {joinText, promptTitle} from './main-title.mjs';

/** @param {{ownerId:string,native:Pick<import('./codex-app-server.mjs').NativeSession,'readThreadMetadata'>,environment?:NodeJS.ProcessEnv}} input @returns {Promise<string|null>} */
export async function readCodexMainTitle({ownerId,native,environment=process.env}) {
    try {
        const metadata = await native.readThreadMetadata({threadId:ownerId});
        if (metadata.title?.trim()) return metadata.title;
        let sessionPath = metadata.sessionPath;
        // A Claude background agent has no Codex App Server to ask; the Main's rollout file is found by its thread id.
        if (sessionPath === null) {
            const matches = [];
            for await (const found of glob(join(codexHomeLocation(environment, process.platform).directory, 'sessions', '*', '*', '*', `rollout-*-${ownerId}.jsonl`))) matches.push(found);
            sessionPath = matches.sort().at(-1) ?? null;
        }
        if (typeof sessionPath !== 'string' || !isAbsolute(sessionPath)) return null;
        const stream = createReadStream(sessionPath, {encoding:'utf8'});
        const lines = createInterface({input:stream,crlfDelay:Infinity});
        let identity = false;
        try {
            for await (const line of lines) {
                let record;
                try {record = JSON.parse(line);}
                catch {continue;}
                if (!isJsonObject(record) || !isJsonObject(record.payload)) continue;
                if (record.type === 'session_meta') {
                    if (record.payload.id !== ownerId) return null;
                    identity = true;
                }
                if (!identity || record.type !== 'response_item' || record.payload.type !== 'message'
                    || record.payload.role !== 'user' || !Array.isArray(record.payload.content)) continue;
                const text = joinText(/** @type {Array<{text:string}>} */ (record.payload.content.filter(isJsonObject)
                    .filter(part => ['input_text','text'].includes(String(part.type)) && typeof part.text === 'string')));
                // Codex injects the repository instructions as a user message; the title comes from the real one.
                if (text.length && !text.startsWith('# AGENTS.md instructions for')) return promptTitle(text);
            }
        } finally {lines.close(); stream.destroy();}
    } catch {}
    return null;
}
