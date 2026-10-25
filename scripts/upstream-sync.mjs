#!/usr/bin/env node
// upstream-sync Skill 的三方视图: 取得上游旧固定提交 (Base) 和新提交 (Theirs), 列出范围内每个上游变化及本地 (Ours) 状态.
// 用法: node scripts/upstream-sync.mjs <source> <full-commit-id>
// 输出到 .tmp/upstream-sync/<source>/{base,theirs,merged}/<本地路径>, 不修改仓库文件.

import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const [sourceId, target] = process.argv.slice(2);
if (sourceId === undefined || !/^[0-9a-f]{40}$/u.test(target ?? '')) {
    console.error('Usage: node scripts/upstream-sync.mjs <source> <full-commit-id>');
    process.exit(2);
}
/** @type {{url: string, commit: string, map: Record<string, string>, exclude: string[]}} */
const source = JSON.parse(readFileSync(join(ROOT, 'upstream/sources', sourceId, 'source.json'), 'utf8'));
const work = join(ROOT, '.tmp/upstream-sync', sourceId);
const repo = join(work, 'repo.git');
const git = (/** @type {string[]} */ ...args) => execFileSync('git', ['--git-dir', repo, '-c', 'core.quotePath=false', ...args], {maxBuffer: 1 << 28});

if (!existsSync(repo)) execFileSync('git', ['init', '--quiet', '--bare', repo]);
git('fetch', '--quiet', source.url, source.commit, target);
for (const side of ['base', 'theirs', 'merged']) rmSync(join(work, side), {force: true, recursive: true});

/** 上游路径对应的本地路径; 不在范围内时返回 undefined. 以 `/` 结尾的键按前缀匹配, 其余精确匹配. */
const localPath = (/** @type {string} */ path) => {
    const matches = (/** @type {string} */ pattern) => (pattern.endsWith('/') ? path.startsWith(pattern) : path === pattern);
    const prefix = Object.keys(source.map).find(matches);
    if (prefix === undefined || source.exclude.some(matches)) return undefined;
    return source.map[prefix] + path.slice(prefix.length);
};
const save = (/** @type {string} */ side, /** @type {string} */ path, /** @type {Buffer} */ bytes) => {
    const file = join(work, side, path);
    mkdirSync(dirname(file), {recursive: true});
    writeFileSync(file, bytes);
    return file;
};

console.log(git('log', '--oneline', `${source.commit}..${target}`, '--', ...Object.keys(source.map)).toString());
const changes = git('diff', '--name-status', '-M', source.commit, target).toString().split('\n').filter(Boolean);
for (const line of changes) {
    // 改名行是 `R<相似度>\t<旧路径>\t<新路径>`: Base 与 Ours 取旧路径, Theirs 和输出取新路径.
    const [code, oldPath, newPath = oldPath] = line.split('\t');
    const newMapped = localPath(newPath);
    const oldMapped = localPath(oldPath);
    if (newMapped === undefined && oldMapped === undefined) continue;
    // 改出范围按删除处理, 改入范围按新增处理.
    const status = newMapped === undefined ? 'D' : oldMapped === undefined ? 'A' : code[0];
    const local = /** @type {string} */ (newMapped ?? oldMapped);
    const oldLocal = /** @type {string} */ (oldMapped ?? newMapped);
    const base = status === 'A' ? undefined : git('show', `${source.commit}:${oldPath}`);
    const theirs = status === 'D' ? undefined : git('show', `${target}:${newPath}`);
    const oursFile = join(ROOT, oldLocal);
    const ours = existsSync(oursFile) ? readFileSync(oursFile) : undefined;
    const baseFile = base && save('base', local, base);
    const theirsFile = theirs && save('theirs', local, theirs);
    let state = ours === undefined ? 'ours-missing'
        : base?.equals(ours) ? 'ours=base'
        : theirs?.equals(ours) ? 'ours=theirs'
        : 'ours-changed';
    if (state === 'ours-changed' && baseFile && theirsFile) {
        const merged = spawnSync('git', ['merge-file', '-p', '-L', 'ours', '-L', 'base', '-L', 'theirs', oursFile, baseFile, theirsFile]);
        save('merged', local, merged.stdout);
        state += ` conflicts=${merged.status}`;
    }
    console.log(`${status}\t${state}\t${local}${oldLocal === local ? '' : ` (from ${oldLocal})`}`);
}
