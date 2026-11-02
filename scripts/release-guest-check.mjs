#!/usr/bin/env node
// 在可丢弃的受验系统里证明候选的安装, PATH 登记, `arw workflow init`, 对受管仓库的 `arw workflow update` 和卸载真实可用.
// 从候选 checkout 运行: node scripts/release-guest-check.mjs --fixture <agent-assisted.tgz> [--previous <commit>] (先安装该上一发布版再升级到候选, 并让 fixture 检出上一发布版的标签). 每步输出一行 ok/FAIL, 首个失败时退出码 1.
// 它修改当前用户的 HOME 和 PATH 登记, 只能在测试后会还原快照的系统中运行.

import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {delimiter, dirname, join, resolve} from 'node:path';
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
/** @param {string} command @param {string} [cwd] @param {'cmd' | 'powershell'} [shell] */
const fresh = (command, cwd = homedir(), shell = 'cmd') => {
    if (!WINDOWS) return run('bash', ['-lc', `PATH='${NODE_DIRECTORY}':"$PATH"; ${command}`], {cwd});
    const path = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); [Environment]::ExpandEnvironmentVariables([Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User'))"]);
    if (!path.ok) return path;
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
    const options = {cwd, env: {...env, Path: `${NODE_DIRECTORY}${delimiter}${path.stdout}`, NoDefaultCurrentDirectoryInExePath: '1'}};
    if (shell === 'powershell') return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); ${command}`], options);
    return run('cmd.exe', ['/d', '/c', command], {...options, windowsVerbatimArguments: true});
};

const locate = WINDOWS ? 'where arw' : 'command -v arw';
const previousIndex = process.argv.indexOf('--previous');
const previous = previousIndex === -1 ? undefined : process.argv[previousIndex + 1];
if (previousIndex !== -1) step('--previous 是 commit', {ok: /^[0-9a-f]{7,40}$/u.test(previous ?? ''), output: String(previous)});
const fixtureIndex = process.argv.indexOf('--fixture');
const fixture = fixtureIndex === -1 ? '' : resolve(process.argv[fixtureIndex + 1] ?? '');
step('--fixture 是文件', {ok: fixture !== '' && existsSync(fixture) && statSync(fixture).isFile(), output: fixture});

// Windows 用户 PATH 的非 ASCII 项 (全程在 PowerShell 内构造和比较, 避免命令行编码影响).
const PATH_ENTRY = "'C:\\arw-' + [char]0x8DEF + [char]0x5F84";
/** @param {string} body */
const userPath = body => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$e = ${PATH_ENTRY}; ${body}`]);
/** @param {string} label */
const checkEntry = label => {
    const result = userPath("if (([Environment]::GetEnvironmentVariable('Path','User') -split ';') -contains $e) { 'present' } else { 'missing' }");
    step(label, {ok: result.stdout === 'present', output: result.output});
};

const minimumNode = Number(/\d+/u.exec(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).engines.node)?.[0]);
step(`Node.js 满足 engines (>=${minimumNode})`, {ok: Number(process.versions.node.split('.')[0]) >= minimumNode, output: process.versions.node});
step('arw 安装前不可解析', fresh(locate), false);
if (WINDOWS) step('PowerShell 在新终端可解析', fresh('where powershell.exe'));
const commit = step('读取候选 commit', run('git', ['rev-parse', 'HEAD'], {cwd: ROOT}));
const staging = mkdtempSync(join(tmpdir(), 'arw-release-archive-'));
const archive = join(staging, 'arw.tar.gz');
const extracted = join(staging, 'extracted');
mkdirSync(extracted);
step('打包安装压缩包', run(process.execPath, [join(ROOT, 'scripts', 'pack-release.mjs'), archive]));
step('解压安装压缩包', run('tar', ['-xzf', archive, '-C', extracted]));
let previousVersion;
if (previous !== undefined) {
    // 上一发布版: 用 git archive 从候选 checkout 的历史取出该 commit (不注册 worktree), 打包安装; 随后的候选安装就是升级.
    const previousSource = join(staging, 'previous');
    const previousExtracted = join(staging, 'previous-extracted');
    mkdirSync(previousExtracted);
    mkdirSync(previousSource);
    step('取出上一发布版', run('git', ['archive', '--format=tar', `--output=${join(staging, 'previous.tar')}`, previous], {cwd: ROOT}));
    step('解开上一发布版源码', run('tar', ['-xf', join(staging, 'previous.tar'), '-C', previousSource]));
    step('打包上一发布版', run(process.execPath, [join(previousSource, 'scripts', 'pack-release.mjs'), join(staging, 'previous.tar.gz')]));
    step('解压上一发布版', run('tar', ['-xzf', join(staging, 'previous.tar.gz'), '-C', previousExtracted]));
    previousVersion = JSON.parse(readFileSync(join(previousSource, 'package.json'), 'utf8')).version;
    step('安装上一发布版', run(process.execPath, ['install.mjs', '--release-tag', previousVersion, '--non-interactive', '--register-path', 'true'], {cwd: previousExtracted}));
}
// 上一发布版可能还不会正确读写非 ASCII 的 PATH 项, 所以在其安装之后, 候选安装之前写入.
if (WINDOWS) step('写入含非 ASCII 的用户 PATH 项', userPath("[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';' + $e, 'User')"));
step('从压缩包安装', run(process.execPath, [
    'install.mjs', '--release-tag', VERSION, '--non-interactive', '--register-path', 'true',
], {cwd: extracted}));

if (WINDOWS) checkEntry('安装后非 ASCII 用户 PATH 项仍在');
/** 在新会话解析 arw 并核对 Installation 目录 (Windows 路径不区分大小写, 可能输出多行) 与版本. @param {string} prefix 步骤名前缀 @param {string} resolveLabel @param {string} locateCommand @param {'cmd' | 'powershell'} shell */
const checkResolved = (prefix, resolveLabel, locateCommand, shell) => {
    const normalize = (/** @type {string} */ text) => WINDOWS ? text.toLowerCase() : text;
    const resolved = step(resolveLabel, fresh(locateCommand, homedir(), shell));
    if (!resolved.split(/\r?\n/u).every(line => normalize(line).startsWith(normalize(INSTALLATION)))) step(`${prefix}arw 指向 Installation 目录`, {ok: false, output: resolved});
    const reported = step(`${prefix}arw --version`, fresh('arw --version', homedir(), shell));
    if (!reported.includes(VERSION)) step(`${prefix}版本为 ${VERSION}`, {ok: false, output: reported});
};
checkResolved('', '新终端解析 arw', locate, 'cmd');
// PowerShell 新会话经 Get-Command 解析, 与 cmd 的 where 是不同的解析路径.
if (WINDOWS) checkResolved('PowerShell ', 'PowerShell 新会话解析 arw', '(Get-Command arw).Source', 'powershell');

const target = mkdtempSync(join(tmpdir(), 'arw-release-target-'));
step('创建目标 Git 仓库', run('git', ['init', '--quiet'], {cwd: target}));
step('arw workflow init', fresh(`arw ${INIT_ARGUMENTS}`, target));
step('arw workflow verify', fresh('arw workflow verify', target));

// 受管仓库经 CRLF 检出后 verify 仍应通过.
step('暂存受管仓库', run('git', ['add', '-A'], {cwd: target}));
step('提交受管仓库', run('git', ['-c', 'user.name=release', '-c', 'user.email=release@example.invalid', 'commit', '--quiet', '-m', 'managed'], {cwd: target}));
const crlfTarget = join(staging, 'crlf-target');
step('CRLF 重新克隆', run('git', ['clone', '--quiet', '-c', 'core.autocrlf=true', '-c', 'core.longpaths=true', target, crlfTarget]));
step('CRLF 克隆 arw workflow verify', fresh('arw workflow verify', crlfTarget));

// 上一发布版管理的 fixture 仓库: 检出 `arw-<上一版>` 标签 (fixture 可能已更新到更新的版本, 在其最新状态上 update 什么也不做), Windows 上用 CRLF 检出, 再用候选更新.
const fixtureSource = join(staging, 'fixture-source');
const fixtureTarget = join(staging, 'fixture-target');
mkdirSync(fixtureSource);
step('解压 fixture', run('tar', ['-xzf', fixture, '-C', fixtureSource]));
step('检出受管 fixture 仓库', run('git', [
    '-c', 'advice.detachedHead=false', 'clone', '--quiet', '-c', `core.autocrlf=${WINDOWS}`, '-c', 'core.longpaths=true',
    ...(previousVersion === undefined ? [] : ['--branch', `arw-${previousVersion}`]), join(fixtureSource, 'agent-assisted'), fixtureTarget,
]));
step('fixture arw workflow update', fresh('arw workflow update --non-interactive', fixtureTarget));
step('fixture arw workflow verify', fresh('arw workflow verify', fixtureTarget));

step('卸载', run(process.execPath, [join(INSTALLATION, 'uninstall.mjs'), '--non-interactive', '--remove-config', 'true'], {cwd: target}));
step('卸载后新终端不再解析 arw', fresh(locate), false);
if (WINDOWS) checkEntry('卸载后非 ASCII 用户 PATH 项仍在');
// 卸载后不应剩任何文件.
const leftovers = existsSync(INSTALLATION)
    ? readdirSync(INSTALLATION, {recursive: true, withFileTypes: true}).filter(entry => !entry.isDirectory())
    : [];
step('Installation 目录不剩文件', {ok: leftovers.length === 0, output: leftovers.map(entry => join(entry.parentPath, entry.name)).join('\n')});
process.stdout.write(`PASS ${process.platform} node ${process.versions.node} ${VERSION} ${commit}\n`);
