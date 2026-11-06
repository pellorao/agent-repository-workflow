#!/usr/bin/env node
// 在可丢弃的受验系统里证明候选的安装, PATH 登记, `arw workflow init`, 对受管仓库的 `arw workflow update`, 后台管理进程运行时的重装与卸载真实可用.
// 从候选 checkout 运行: node scripts/release-guest-check.mjs --fixture <agent-assisted.tgz> --archive <arw.tar.gz> [--previous <commit>] (先安装该上一发布版再升级到候选, 并让 fixture 检出上一发布版的标签). --archive 是宿主用 pack-release 打成的候选安装压缩包. 每步输出一行 ok/FAIL, 首个失败时退出码 1.
// 它修改当前用户的 HOME 和 PATH 登记, 只能在测试后会还原快照的系统中运行.

import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {delimiter, dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {INSTALLATION_DIRECTORY_NAME} from '../lib/arw-common/product-identity.mjs';
import {backgroundAgentRuntimeDirectory} from '../lib/background-agent/client.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WINDOWS = process.platform === 'win32';
const INSTALLATION = join(homedir(), INSTALLATION_DIRECTORY_NAME);
const NODE_DIRECTORY = dirname(process.execPath);
// Git for Windows 的安装根目录 (`<root>\cmd\git.exe`), 提供 GNU tar 与 bash.
const gitLocation = WINDOWS ? spawnSync('where', ['git'], {encoding: 'utf8'}) : null;
if (gitLocation !== null && (gitLocation.status !== 0 || !gitLocation.stdout?.trim())) throw new Error('Git for Windows is required for the release guest check.');
const GIT_ROOT = gitLocation === null ? '' : dirname(dirname(gitLocation.stdout.split(/\r?\n/u)[0]));
/** @param {string} path 候选 checkout 的 lib 下的模块 */
const importLib = path => import(pathToFileURL(join(ROOT, 'lib', path)).href);
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const INIT_ARGUMENTS = 'workflow init --non-interactive --platform codex --platform claude-code'
    + ' --domain-layout single-context --code-map-root --code-map-include --code-map-exclude';

/** @param {string} file @param {string[]} args @param {import('node:child_process').SpawnSyncOptions} [options] */
const run = (file, args, options = {}) => {
    const result = spawnSync(file, args, {encoding: 'utf8', ...options});
    const stdout = `${result.stdout ?? ''}`.trim();
    return {ok: result.status === 0, stdout, stderr: `${result.stderr ?? ''}`.trim(), output: `${stdout}\n${result.stderr ?? ''}${result.error?.message ?? ''}`.trim()};
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
// Windows 上 `gitbash` 是 Git for Windows 自带的 bash (不是 WSL 的 bash.exe); Linux 上 `sh` 是登录 `sh` (dash, busybox ash), `profile` 是非登录 `sh` (调用方自己 `. ~/.profile`).
/** @param {string} command @param {string} [cwd] @param {'cmd' | 'powershell' | 'gitbash' | 'sh' | 'profile'} [shell] */
const fresh = (command, cwd = homedir(), shell = 'cmd') => {
    if (!WINDOWS) return run(shell === 'sh' || shell === 'profile' ? 'sh' : 'bash', [shell === 'profile' ? '-c' : '-lc', `PATH='${NODE_DIRECTORY}':"$PATH"; ${command}`], {cwd});
    const path = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); [Environment]::ExpandEnvironmentVariables([Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User'))"]);
    if (!path.ok) return path;
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
    const options = {cwd, env: {...env, Path: `${NODE_DIRECTORY}${delimiter}${path.stdout}`, NoDefaultCurrentDirectoryInExePath: '1'}};
    if (shell === 'gitbash') return run(join(GIT_ROOT, 'bin', 'bash.exe'), ['-lc', command], options);
    if (shell === 'powershell') return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); ${command}`], options);
    return run('cmd.exe', ['/d', '/c', command], {...options, windowsVerbatimArguments: true});
};

const locate = WINDOWS ? 'where arw' : 'command -v arw';
const previousIndex = process.argv.indexOf('--previous');
const previous = previousIndex === -1 ? undefined : process.argv[previousIndex + 1];
if (previousIndex !== -1) step('--previous 是 commit', {ok: /^[0-9a-f]{7,40}$/u.test(previous ?? ''), output: String(previous)});
/** @param {string} flag */
const fileArgument = flag => {
    const index = process.argv.indexOf(flag);
    const file = index === -1 ? '' : resolve(process.argv[index + 1] ?? '');
    step(`${flag} 是文件`, {ok: file !== '' && existsSync(file) && statSync(file).isFile(), output: file});
    return file;
};
const fixture = fileArgument('--fixture');
const archive = fileArgument('--archive');

// Windows 用户 PATH: 先写入未展开的 %USERPROFILE% 条目 ($x) 和非 ASCII 条目 ($e), 值类型 ExpandString; 全程在 PowerShell 内构造和比较, 避免命令行编码影响.
const PATH_ENTRY = "'C:\\arw-' + [char]0x8DEF + [char]0x5F84";
const REGISTRY_PATH = "$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); $v = $k.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);";
/** @param {string} body 可用 $e, $x, $d (Installation 目录), $k 和 $v (未展开的原值, 不存在时为 $null) */
const userPath = body => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$e = ${PATH_ENTRY}; $x = '%USERPROFILE%\\arw-expand-check'; $d = '${INSTALLATION}'; ${REGISTRY_PATH} ${body}`]);
/** @param {string} label @param {string} condition PowerShell 条件 */
const checkPath = (label, condition) => {
    const result = userPath(`if (${condition}) { 'yes' } else { 'no' }`);
    step(label, {ok: result.stdout === 'yes', output: result.output});
};
const PRESERVED = "$v -ne $null -and $k.GetValueKind('Path') -eq 'ExpandString' -and ($v -split ';') -contains $e -and ($v -split ';') -contains $x";

const minimumNode = Number(/\d+/u.exec(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).engines.node)?.[0]);
step(`Node.js 满足 engines (>=${minimumNode})`, {ok: Number(process.versions.node.split('.')[0]) >= minimumNode, output: process.versions.node});
step('arw 安装前不可解析', fresh(locate), false);
if (WINDOWS) step('PowerShell 在新终端可解析', fresh('where powershell.exe'));
const commit = step('读取候选 commit', run('git', ['rev-parse', 'HEAD'], {cwd: ROOT}));
const {readOperatingSystemProcessCreationTime, creationValuePattern} = await importLib('background-agent/process-identity.mjs');
const created = await readOperatingSystemProcessCreationTime(process.pid);
step('读取本进程创建时间', {ok: creationValuePattern.test(created ?? ''), output: String(created)});
const staging = mkdtempSync(join(tmpdir(), 'arw-release-archive-'));
const extracted = join(staging, 'extracted');
mkdirSync(extracted);
// 以 Bootstrap 的方式 (相对文件名, 在目录内) 用 PATH 上的默认 tar 解压, 供后面的交互重装使用 install.mjs.
copyFileSync(archive, join(extracted, 'arw.tar.gz'));
step('解压安装压缩包', run('tar', ['-xzf', 'arw.tar.gz'], {cwd: extracted}));
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
if (WINDOWS) step('写入 ExpandString 用户 PATH (含未展开项与非 ASCII 项)', userPath("$k.SetValue('Path', (([string]$v).TrimEnd(';') + ';' + $x + ';' + $e).TrimStart(';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)"));
// 候选经 Bootstrap 安装: 本地压缩包代替 GitHub 下载, 其余 (经 PATH 取 tar 解压, 交给解压出的 install.mjs) 是真实路径.
// Windows 先让系统自带的 bsdtar, 再让 Git 自带的 GNU tar 排在 PATH 最前各安装一次 (第二次是同版本非交互重装); 其他系统用 PATH 上的 tar.
process.env.PATH = `${NODE_DIRECTORY}${delimiter}${process.env.PATH}`;
const inheritedPath = process.env.PATH;
const {runBootstrap} = await importLib('installation/bootstrap.mjs');
for (const [label, directory] of WINDOWS ? [['bsdtar', join(String(process.env.SystemRoot), 'System32')], ['GNU tar', join(GIT_ROOT, 'usr', 'bin')]] : [['系统 tar', '']]) {
    process.env.PATH = directory === '' ? inheritedPath : `${directory}${delimiter}${inheritedPath}`;
    step(`Bootstrap 安装候选 (${label})`, await runBootstrap(
        ['--version', VERSION, '--non-interactive', '--register-path', 'true'], {download: async () => readFileSync(archive)},
    ).then((/** @type {number} */ code) => ({ok: code === 0, output: ''}), (/** @type {Error} */ error) => ({ok: false, output: error.message})));
}
process.env.PATH = inheritedPath;
// 安装后的每个受管文件与解压出的载荷逐字节相同 (Windows 的 rename 重试或访问控制路径可能悄悄写坏部分文件, 而本检查只运行部分模块).
/** @param {string} label */
const checkInstalledBytes = label => {
    const {managedFiles} = JSON.parse(readFileSync(join(INSTALLATION, 'manifest.json'), 'utf8'));
    const differing = managedFiles.filter((/** @type {string} */ file) => !existsSync(join(INSTALLATION, file)) || !readFileSync(join(INSTALLATION, file)).equals(readFileSync(join(extracted, file))));
    step(`${label}已安装的 ${managedFiles.length} 个受管文件与载荷逐字节相同`, {ok: differing.length === 0, output: differing.join('\n')});
};
checkInstalledBytes('');

if (WINDOWS) checkPath('安装后 ExpandString 类型, 未展开项与非 ASCII 项仍在', PRESERVED);
/** 在新会话解析 arw 并核对 Installation 目录 (Windows 路径不区分大小写, 可能输出多行) 与版本. @param {string} prefix 步骤名前缀 @param {string} resolveLabel @param {string} locateCommand @param {'cmd' | 'powershell'} shell */
const checkResolved = (prefix, resolveLabel, locateCommand, shell) => {
    const normalize = (/** @type {string} */ text) => WINDOWS ? text.toLowerCase() : text;
    const resolved = step(resolveLabel, fresh(locateCommand, homedir(), shell));
    if (!resolved.split(/\r?\n/u).every(line => normalize(line).startsWith(normalize(INSTALLATION)))) step(`${prefix}arw 指向 Installation 目录`, {ok: false, output: resolved});
    const versionRun = fresh('arw --version', homedir(), shell);
    const reported = step(`${prefix}arw --version`, versionRun);
    if (!reported.includes(VERSION)) step(`${prefix}版本为 ${VERSION}`, {ok: false, output: reported});
    step(`${prefix}arw --version 标准错误为空`, {ok: versionRun.stderr === '', output: versionRun.stderr});
};
checkResolved('', '新终端解析 arw', locate, 'cmd');
// PowerShell 新会话经 Get-Command 解析, 与 cmd 的 where 是不同的解析路径.
if (WINDOWS) checkResolved('PowerShell ', 'PowerShell 新会话解析 arw', '(Get-Command arw).Source', 'powershell');
// Git Bash 与 Linux 的 sh 登录 shell (dash, busybox ash) 和非登录 sh 读取 ~/.profile 各是不同的解析路径.
/** @param {string} label @param {{ok: boolean, stdout: string, output: string}} result @param {RegExp} location */
const checkShell = (label, result, location) => step(label, {ok: result.ok && location.test(result.stdout) && result.stdout.includes(VERSION), output: result.output});
const RESOLVE_AND_REPORT = 'command -v arw && arw --version';
if (WINDOWS) checkShell('Git Bash 解析 arw', fresh(RESOLVE_AND_REPORT, homedir(), 'gitbash'), /\.agent-repository-workflow\/arw\b/u);
else {
    checkShell('登录 sh 解析 arw', fresh(RESOLVE_AND_REPORT, homedir(), 'sh'), /\.agent-repository-workflow\/arw\b/u);
    checkShell('非登录 sh 执行 ~/.profile 后解析 arw', fresh(`. "$HOME/.profile"; ${RESOLVE_AND_REPORT}`, homedir(), 'profile'), /\.agent-repository-workflow\/arw\b/u);
}

const target = mkdtempSync(join(tmpdir(), 'arw-release-target-'));
step('创建目标 Git 仓库', run('git', ['init', '--quiet'], {cwd: target}));
step('arw workflow init', fresh(`arw ${INIT_ARGUMENTS}`, target));
step('arw workflow verify', fresh('arw workflow verify', target));

// 受管仓库经 CRLF 检出后 verify 仍应通过, 并能被 remove 移除.
step('暂存受管仓库', run('git', ['add', '-A'], {cwd: target}));
step('提交受管仓库', run('git', ['-c', 'user.name=release', '-c', 'user.email=release@example.invalid', 'commit', '--quiet', '-m', 'managed'], {cwd: target}));
const crlfTarget = join(staging, 'crlf-target');
step('CRLF 重新克隆', run('git', ['clone', '--quiet', '-c', 'core.autocrlf=true', '-c', 'core.longpaths=true', target, crlfTarget]));
step('CRLF 克隆 arw workflow verify', fresh('arw workflow verify', crlfTarget));
step('CRLF 克隆 arw workflow remove', fresh('arw workflow remove --non-interactive --arwignore delete', crlfTarget));
step('remove 后 AGENTS.md 已删除', {ok: !existsSync(join(crlfTarget, 'AGENTS.md')), output: ''});
step('remove 后 arw workflow verify 不再通过', fresh('arw workflow verify', crlfTarget), false);

// 上一发布版管理的 fixture 仓库: 检出 `arw-<上一版>` 标签 (fixture 可能已更新到更新的版本, 在其最新状态上 update 什么也不做), Windows 上用 CRLF 检出, 再用候选更新.
const fixtureSource = join(staging, 'fixture-source');
const fixtureTarget = join(staging, 'fixture-target');
mkdirSync(fixtureSource);
step('解压 fixture', run('tar', ['-xzf', fixture, '-C', fixtureSource]));
const fixtureBranch = previousVersion === undefined ? [] : ['--branch', `arw-${previousVersion}`];
/** @param {string} destination */
const cloneFixture = destination => run('git', [
    '-c', 'advice.detachedHead=false', 'clone', '--quiet', '-c', `core.autocrlf=${WINDOWS}`, '-c', 'core.longpaths=true',
    ...fixtureBranch, join(fixtureSource, 'agent-assisted'), destination,
]);
step('检出受管 fixture 仓库', cloneFixture(fixtureTarget));
step('fixture arw workflow update', fresh('arw workflow update --non-interactive', fixtureTarget));
step('fixture arw workflow verify', fresh('arw workflow verify', fixtureTarget));

// 后台管理进程: 经 `arw background-agent` 的空列表请求启动 (不需要 Agent CLI); 重装和卸载都要在它运行时成功并使它结束.
const request = join(staging, 'list-agents.json');
writeFileSync(request, '{"id":"1","operation":"list_agents","input":{}}\n');
const {observeBackgroundAgentManagerProcess} = await importLib('background-agent/manager-process.mjs');
/** @param {string} label @param {'present' | 'absent'} expected */
const expectManager = async (label, expected) => {
    const state = await observeBackgroundAgentManagerProcess({runtimeDirectory: backgroundAgentRuntimeDirectory(INSTALLATION)});
    step(label, {ok: state === expected, output: state});
};
// guest 检查不调用 Agent CLI, `arw background-agent` 需要的会话身份由这里代为提供.
process.env.CODEX_THREAD_ID = 'release-guest-check';
const startManager = async () => {
    const started = fresh(`arw background-agent < "${request}"`, target);
    step('启动后台管理进程', {ok: started.ok && started.stdout.includes('"ok":true'), output: started.output});
    await expectManager('管理进程在运行', 'present');
};
const install = (/** @type {string[]} */ options, /** @type {string} */ input = '') => run(process.execPath, ['install.mjs', '--release-tag', VERSION, ...options], {cwd: extracted, input});
// 同版本交互重装 (管道应答), PATH 只登记一次 (Linux: ~/.profile 只有一个受管块; Windows: 用户 PATH 只有一个 Installation 条目).
await startManager();
step('管理进程运行时同版本交互重装', install([], WINDOWS ? 'y\r\n' : 'y\n'));
await expectManager('重装后管理进程已结束', 'absent');
checkInstalledBytes('重装后');
if (WINDOWS) checkPath('重装后用户 PATH 只有一个 Installation 条目', "@($v -split ';' | Where-Object { $_.TrimEnd('\\') -ieq $d }).Count -eq 1");
else {
    const count = readFileSync(join(homedir(), '.profile'), 'utf8').split('# >>> agent-repository-workflow PATH >>>').length - 1;
    step('重装后 ~/.profile 只有一个受管块', {ok: count === 1, output: String(count)});
}
checkResolved('重装后 ', '重装后新终端解析 arw', locate, 'cmd');

// 保留配置的卸载 (管理进程运行时), 再重装 (Windows 上用户 PATH 值原本不存在, 由 ARW 创建).
await startManager();
step('卸载 (保留配置)', run(process.execPath, [join(INSTALLATION, 'uninstall.mjs'), '--non-interactive', '--remove-config', 'false'], {cwd: target}));
await expectManager('卸载后管理进程已结束', 'absent');
step('卸载后新终端不再解析 arw', fresh(locate), false);
step('卸载保留了配置', {ok: existsSync(join(INSTALLATION, 'config.json')), output: ''});
if (WINDOWS) {
    checkPath('卸载后 ExpandString 类型, 未展开项与非 ASCII 项仍在', PRESERVED);
    step('删除用户 PATH 值', userPath("$k.DeleteValue('Path', $false)"));
}
const reinstalled = step('卸载后重装', install(['--non-interactive', '--register-path', 'true']));
checkInstalledBytes('卸载后重装后');
step('重装无环境刷新警告', {ok: !reinstalled.includes('windows-environment-refresh-failed') && !reinstalled.includes('Windows environment refresh failed'), output: reinstalled});
if (WINDOWS) checkPath('用户 PATH 值被创建为只含 Installation 的 ExpandString', "$v -ne $null -and $k.GetValueKind('Path') -eq 'ExpandString' -and $v.TrimEnd(';') -ieq $d");
checkResolved('卸载后重装后 ', '卸载后重装后新终端解析 arw', locate, 'cmd');
// arw.cmd 的参数转发: 含空格, 逗号和 & 的参数在 cmd 与 PowerShell 中都要原样到达命令 (`language inspect` 列出收到的文件参数).
if (WINDOWS) {
    const ODD_FILE = 'a b,c&d.md';
    writeFileSync(join(target, ODD_FILE), '# arw.cmd\n');
    for (const [shell, command] of /** @type {const} */ ([['cmd', `arw language inspect "${ODD_FILE}"`], ['powershell', `arw language inspect '${ODD_FILE}'`]])) {
        const listed = fresh(command, target, shell);
        step(`${shell} 经 arw.cmd 传入特殊字符参数`, {ok: listed.ok && listed.stdout.includes(ODD_FILE), output: listed.output});
    }
}

step('卸载', run(process.execPath, [join(INSTALLATION, 'uninstall.mjs'), '--non-interactive', '--remove-config', 'true'], {cwd: target}));
step('卸载后新终端不再解析 arw', fresh(locate), false);
if (WINDOWS) checkPath('卸载后 ARW 创建的用户 PATH 值已删除', '$null -eq $v');
// 卸载后不应剩任何文件, 除了后台管理进程运行过留下的私密凭据 (安装 spec: `removeConfig` 不授权删除它).
const leftovers = existsSync(INSTALLATION)
    ? readdirSync(INSTALLATION, {recursive: true, withFileTypes: true}).filter(entry => !entry.isDirectory() && entry.name !== 'credential')
    : [];
step('Installation 目录不剩文件', {ok: leftovers.length === 0, output: leftovers.map(entry => join(entry.parentPath, entry.name)).join('\n')});
// Windows 上 Git 默认 core.autocrlf=true 检出 ARW 源码: 仓库根 .gitattributes 须使分发文件仍为 LF, 才能从这份检出安装, 并在新仓库和 fixture 上 init, update, verify.
if (WINDOWS) {
    const crlfSource = join(staging, 'crlf-source');
    step('以 CRLF 检出 ARW 源码', run('git', ['clone', '--quiet', '-c', 'core.autocrlf=true', '-c', 'core.longpaths=true', ROOT, crlfSource]));
    const crlfFiles = ['release-manifest.json', 'distribution/config.json'].filter(file => readFileSync(join(crlfSource, file), 'utf8').includes('\r'));
    step('分发文件为 LF', {ok: crlfFiles.length === 0, output: crlfFiles.join('\n')});
    step('从 CRLF 源码检出安装', run(process.execPath, ['install.mjs', '--non-interactive', '--register-path', 'true'], {cwd: crlfSource}));
    const crlfInit = mkdtempSync(join(tmpdir(), 'arw-release-crlf-init-'));
    step('CRLF 源码: 创建目标 Git 仓库', run('git', ['init', '--quiet'], {cwd: crlfInit}));
    step('CRLF 源码: arw workflow init', fresh(`arw ${INIT_ARGUMENTS}`, crlfInit));
    step('CRLF 源码: arw workflow verify', fresh('arw workflow verify', crlfInit));
    const crlfFixture = join(staging, 'crlf-fixture');
    step('CRLF 源码: 检出受管 fixture 仓库', cloneFixture(crlfFixture));
    step('CRLF 源码: fixture arw workflow update', fresh('arw workflow update --non-interactive', crlfFixture));
    step('CRLF 源码: fixture arw workflow verify', fresh('arw workflow verify', crlfFixture));
    step('CRLF 源码: 卸载', run(process.execPath, [join(INSTALLATION, 'uninstall.mjs'), '--non-interactive', '--remove-config', 'true'], {cwd: crlfInit}));
    step('CRLF 源码: 卸载后新终端不再解析 arw', fresh(locate), false);
}
// 最后用含空格和非 ASCII 字符的用户目录把以上全部情形重跑一次 (嵌套运行不再嵌套).
if (process.env.ARW_NESTED_GUEST_CHECK === undefined) {
    const home = join(mkdtempSync(join(tmpdir(), 'arw-release-home-')), '用户 home');
    mkdirSync(home);
    const nested = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
        stdio: 'inherit', env: {...process.env, HOME: home, USERPROFILE: home, ARW_NESTED_GUEST_CHECK: '1'},
    });
    step('含空格和非 ASCII 用户目录的嵌套重跑', {ok: nested.status === 0, output: String(nested.status)});
}
process.stdout.write(`PASS ${process.platform} node ${process.versions.node} ${VERSION} ${commit}\n`);
