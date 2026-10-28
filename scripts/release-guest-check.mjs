#!/usr/bin/env node
// 在可丢弃的受验系统里证明候选的安装, PATH 登记, `arw workflow init` 和卸载真实可用.
// 从候选 checkout 运行: node scripts/release-guest-check.mjs. 每步输出一行 ok/FAIL, 首个失败时退出码 1.
// 它修改当前用户的 HOME 和 PATH 登记, 只能在测试后会还原快照的系统中运行.

import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readdirSync, readFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {delimiter, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WINDOWS = process.platform === 'win32';
const INSTALLATION = join(homedir(), '.agent-repository-workflow');
const NODE_DIRECTORY = dirname(process.execPath);
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const INIT_ARGUMENTS = 'workflow init --non-interactive --platform codex --platform claude-code'
    + ' --domain-layout single-context --code-map-root --code-map-include --code-map-exclude';

/** @param {string} file @param {string[]} args @param {import('node:child_process').SpawnSyncOptions} [options] */
const run = (file, args, options = {}) => {
    const result = spawnSync(file, args, {encoding: 'utf8', ...options});
    const stdout = `${result.stdout ?? ''}`.trim();
    return {ok: result.status === 0, stdout, output: `${stdout}\n${result.stderr ?? ''}${result.error?.message ?? ''}`.trim()};
};

/** @param {string} label @param {{ok: boolean, output: string}} result @param {boolean} [expectOk] */
const step = (label, result, expectOk = true) => {
    if (result.ok !== expectOk) {
        process.stdout.write(`FAIL ${label}\n${result.output}\n`);
        process.exit(1);
    }
    process.stdout.write(`ok ${label}${result.output ? `: ${result.output.split(/\r?\n/u)[0]}` : ''}\n`);
    return result.output;
};

// 新开命令解释器: Windows 从注册表重新读取 Machine + User Path (与新打开的终端相同), Linux 用登录 shell 读取 ~/.profile.
// 运行本脚本的 node 所在目录排在 PATH 最前, 让 arw 启动器调用的 `node` 就是受验的 Node.js.
// 默认在 HOME 运行, 且 Windows 禁止从当前目录解析命令, 以免解析到候选 checkout 自带的 arw.
/** @param {string} command @param {string} [cwd] */
const fresh = (command, cwd = homedir()) => {
    if (!WINDOWS) return run('bash', ['-lc', `PATH='${NODE_DIRECTORY}':"$PATH"; ${command}`], {cwd});
    const path = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "[Environment]::ExpandEnvironmentVariables([Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User'))"]);
    if (!path.ok) return path;
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
    return run('cmd.exe', ['/d', '/c', command], {cwd, env: {...env, Path: `${NODE_DIRECTORY}${delimiter}${path.stdout}`, NoDefaultCurrentDirectoryInExePath: '1'}, windowsVerbatimArguments: true});
};

const locate = WINDOWS ? 'where arw' : 'command -v arw';

step('arw 安装前不可解析', fresh(locate), false);
if (!run('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${VERSION}`], {cwd: ROOT}).ok) {
    step(`创建本地 tag ${VERSION}`, run('git', ['tag', VERSION], {cwd: ROOT}));
}
const commit = step('读取候选 commit', run('git', ['rev-parse', 'HEAD'], {cwd: ROOT}));
step('安装候选', run(process.execPath, [
    'install.mjs', '--release-tag', VERSION, '--release-commit', commit,
    '--non-interactive', '--register-path', 'true',
], {cwd: ROOT}));

const resolved = step('新终端解析 arw', fresh(locate));
if (!resolved.split(/\r?\n/u).every(line => line.startsWith(INSTALLATION))) step('arw 指向 Installation 目录', {ok: false, output: resolved});
const reported = step('arw --version', fresh('arw --version'));
if (!reported.includes(VERSION)) step(`版本为 ${VERSION}`, {ok: false, output: reported});

const target = mkdtempSync(join(tmpdir(), 'arw-release-target-'));
step('创建目标 Git 仓库', run('git', ['init', '--quiet'], {cwd: target}));
step('arw workflow init', fresh(`arw ${INIT_ARGUMENTS}`, target));
step('arw workflow verify', fresh('arw workflow verify', target));

step('卸载', run(process.execPath, [join(INSTALLATION, 'uninstall.mjs'), '--non-interactive', '--remove-config', 'true'], {cwd: target}));
step('卸载后新终端不再解析 arw', fresh(locate), false);
// 卸载后不应剩任何文件.
const leftovers = existsSync(INSTALLATION)
    ? readdirSync(INSTALLATION, {recursive: true, withFileTypes: true}).filter(entry => !entry.isDirectory())
    : [];
step('Installation 目录不剩文件', {ok: leftovers.length === 0, output: leftovers.map(entry => join(entry.parentPath, entry.name)).join('\n')});
process.stdout.write(`PASS ${process.platform} node ${process.versions.node} ${VERSION} ${commit}\n`);
