#!/usr/bin/env node
// 由 .agents/skills/ 生成本仓库的 .claude/skills/; `--check` 只比较, 不一致时退出码 1.

import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

import {createClaudeCodePlatformAdapter} from '../lib/arw-common/platform-adapter.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE = join(ROOT, '.agents/skills');
const TARGET = join(ROOT, '.claude/skills');

/** @param {string} directory @returns {Promise<string[]>} */
const listFiles = async directory => (await readdir(directory, {recursive: true, withFileTypes: true}))
    .filter(entry => entry.isFile())
    .map(entry => relative(directory, join(entry.parentPath, entry.name)).split('\\').join('/'))
    .sort();

/** @returns {Promise<Map<string, Buffer>>} 以 .claude/skills/ 下相对路径为键的期望内容 */
const expectedClaudeSkills = async () => {
    const payload = await Promise.all((await listFiles(SOURCE)).map(async path => ({
        bytes: await readFile(join(SOURCE, path)),
        path: `skills/${path}`,
    })));
    const result = createClaudeCodePlatformAdapter().evaluate({
        payload,
        platform: 'claude-code',
        profile: {codeMaps: {excludes: [], includes: [], roots: []}, domainLayout: 'single-context', platforms: ['claude-code']},
        projectionConfig: JSON.parse(await readFile(join(ROOT, 'distribution/projections/config.json'), 'utf8')),
        seedTargets: {},
    });
    if (result.status !== 'succeeded') throw new Error(`Claude Skill projection failed:\n${JSON.stringify(result.diagnostics, null, 2)}`);
    return new Map(result.managedTargets
        .filter(target => target.path.startsWith('.claude/skills/'))
        .map(target => [target.path.slice('.claude/skills/'.length), target.bytes]));
};

/** @returns {Promise<string[]>} 与期望不一致的 .claude/skills/ 相对路径 */
export const staleClaudeSkills = async () => {
    const expected = await expectedClaudeSkills();
    const actual = await listFiles(TARGET).catch(() => []);
    const stale = actual.filter(path => !expected.has(path));
    for (const [path, bytes] of expected) {
        const current = await readFile(join(TARGET, path)).catch(() => undefined);
        if (current === undefined || !current.equals(bytes)) stale.push(path);
    }
    return stale.sort();
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    if (process.argv[2] === '--check') {
        const stale = await staleClaudeSkills();
        for (const path of stale) process.stderr.write(`stale: .claude/skills/${path}\n`);
        if (stale.length > 0) process.stderr.write('Run: node scripts/project-claude-skills.mjs\n');
        process.exitCode = stale.length > 0 ? 1 : 0;
    } else {
        const expected = await expectedClaudeSkills();
        await rm(TARGET, {force: true, recursive: true});
        for (const [path, bytes] of expected) {
            await mkdir(dirname(join(TARGET, path)), {recursive: true});
            await writeFile(join(TARGET, path), bytes);
        }
        process.stdout.write(`Wrote ${expected.size} files to .claude/skills/\n`);
    }
}
