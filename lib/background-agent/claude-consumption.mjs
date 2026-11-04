import {createReadStream, existsSync, readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {joinText, promptTitle} from './main-title.mjs';

/** @param {NodeJS.ProcessEnv} environment */
export const claudeConfigDirectory = environment => environment.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
/** @param {unknown} content */
export const messageText = content => typeof content === 'string' ? content
    : Array.isArray(content) && content.every(part => part?.type === 'text') ? joinText(content) : null;

/** The path of a session record in any project directory, or undefined. @param {string} projects @param {string} threadId */
export const findClaudeSessionRecord = (projects, threadId) => {
    try {return readdirSync(projects).map(name => join(projects, name, `${threadId}.jsonl`)).find(candidate => existsSync(candidate));}
    catch {return undefined;}
};

/**
 * Reads one Claude Code session record: its native title (custom, else generated), its first real prompt and its path.
 * A thread without a session file, such as a Codex Main, has none of them.
 * @param {{threadId:string,environment?:NodeJS.ProcessEnv}} input
 * @returns {Promise<{title:string|null,prompt:string|null,sessionPath:string|null}>}
 */
export async function readClaudeSession({threadId, environment = process.env}) {
    const projects = join(claudeConfigDirectory(environment), 'projects');
    const sessionPath = findClaudeSessionRecord(projects, threadId);
    if (!sessionPath) return {title: null, prompt: null, sessionPath: null};
    /** @type {{custom:string|null,ai:string|null,prompt:string|null}} */ const found = {custom: null, ai: null, prompt: null};
    for await (const line of createInterface({input: createReadStream(sessionPath, 'utf8'), crlfDelay: Infinity})) {
        let record;
        try {record = JSON.parse(line);}
        catch {continue;}
        if (typeof record?.sessionId === 'string' && record.sessionId !== threadId) throw new Error('Claude session record identity changed.');
        if (record?.type === 'custom-title' && typeof record.customTitle === 'string') found.custom = record.customTitle;
        else if (record?.type === 'ai-title' && typeof record.aiTitle === 'string') found.ai = record.aiTitle;
        else if (found.prompt === null && record?.type === 'user' && !record.isMeta) {
            const text = messageText(record.message?.content);
            // Command and reminder records start with a tag; they are not the user's request.
            if (text?.trim() && !text.startsWith('<')) found.prompt = promptTitle(text);
        }
    }
    return {title: [found.custom, found.ai].find(title => title?.trim()) ?? null, prompt: found.prompt, sessionPath};
}

/** The title of a Claude Code Main: its native title, else its first real prompt. @param {{ownerId:string,environment?:NodeJS.ProcessEnv}} input */
export async function readClaudeMainTitle({ownerId, environment}) {
    try {
        const session = await readClaudeSession({threadId: ownerId, environment});
        return session.title ?? session.prompt;
    } catch {return null;}
}
