import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {isAbsolute} from 'node:path';
import {isJsonObject} from '../common/json.mjs';

/** @param {{ownerId:string,native:Pick<import('./codex-app-server.mjs').NativeSession,'readThreadMetadata'>}} input @returns {Promise<string|null>} */
export async function readCodexMainTitle({ownerId,native}) {
    try {
        const metadata = await native.readThreadMetadata({threadId:ownerId});
        if (metadata.title?.trim()) return metadata.title;
        if (typeof metadata.sessionPath !== 'string' || !isAbsolute(metadata.sessionPath)) return null;
        const stream = createReadStream(metadata.sessionPath, {encoding:'utf8'});
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
                const text = record.payload.content.filter(isJsonObject)
                    .filter(part => ['input_text','text'].includes(String(part.type)) && typeof part.text === 'string')
                    .map(part => part.text).join('\n');
                // Codex injects the repository instructions as a user message; the title comes from the real one.
                if (text.length && !text.startsWith('# AGENTS.md instructions for')) return [...text].slice(0,40).join('');
            }
        } finally {lines.close(); stream.destroy();}
    } catch {}
    return null;
}
