#!/usr/bin/env node
// 在 VMware 受验系统中运行 scripts/release-guest-check.mjs: 还原快照, 启动, 经固定主机密钥的 SSH 传入候选 bundle 并运行检查, 最后硬关机并还原快照.
// 用法见 USAGE. 配置来源是 --config 文件或仓库根 .arw.local.json 的 release 对象, 格式见 .agents/skills/release/references/vm.md.

import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {isAbbreviatedCommitId} from '../lib/common/git-content.mjs';

const SSH_WAIT_ATTEMPTS = 60;
const SSH_WAIT_INTERVAL_MS = 5000;
const GUEST_BUNDLE = 'arw-candidate.bundle';
const GUEST_FIXTURE = 'arw-fixture.tgz';
const GUEST_ARCHIVE = 'arw-archive.tar.gz';
const GUEST_CHECKOUT = 'arw-candidate';
const USAGE = `Usage:
  node scripts/release-vm.mjs check <machine> <candidate.bundle> --archive <arw.tar.gz> [--config <path>] [--previous <commit>] [--keep]
  node scripts/release-vm.mjs ssh <machine> <command> [--config <path>]
  node scripts/release-vm.mjs down <machine> [--config <path>]
Without --config the release config is the "release" object of .arw.local.json in the repository root.`;

/** @typedef {{vmrun: string, location: string, snapshot: string, ssh: {user: string, port: number, identityFile: string, hostKey: string}, nodeExecutables: {recommended: string, minimum?: string}}} Machine */

const argv = process.argv.slice(2);
const configFlag = argv.indexOf('--config');
const configOption = configFlag === -1 ? undefined : argv.splice(configFlag, 2)[1];
const [operation, machineKey, argument, ...rest] = argv;
if (!['check', 'ssh', 'down'].includes(operation) || !machineKey || (operation !== 'down' && !argument) || (configFlag !== -1 && !configOption)) {
    process.stderr.write(`${USAGE}\n`);
    process.exit(2);
}
// --archive 是宿主用 scripts/pack-release.mjs 为候选打成的安装压缩包, 传入客户机供 Bootstrap 步骤使用.
const archiveFlag = rest.indexOf('--archive');
const archive = rest[archiveFlag + 1];
if (operation === 'check' && (archiveFlag === -1 || !archive || archive.startsWith('--'))) {
    process.stderr.write(`${USAGE}\n--archive <arw.tar.gz> is required.\n`);
    process.exit(2);
}
// --previous 的值是 commit (7-40 位十六进制), 在拼进远程命令前校验.
const previousIndex = rest.indexOf('--previous');
const previous = previousIndex === -1 ? undefined : rest[previousIndex + 1];
if (operation === 'check' && previousIndex !== -1 && !isAbbreviatedCommitId(previous ?? '')) {
    process.stderr.write(`${USAGE}\n--previous expects a commit (7-40 hex digits).\n`);
    process.exit(2);
}
/** @type {(message: string) => never} */
const fail = message => {
    process.stderr.write(`${message}\n`);
    process.exit(2);
};
// 错误只含路径, 不含解析器消息 (它可能引用文件片段, 而共用文件含密码). fatal 解码拒绝非法 UTF-8, 不悄悄改写值. 顶层必须是对象.
/** @param {string} file @param {string} label @returns {any} */
const readJson = (file, label) => {
    let value = null;
    try {
        value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(readFileSync(file)));
    } catch { /* 读取, 解码或解析失败都归一为下面的路径消息 */ }
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : fail(`${label} is not readable JSON: ${file}`);
};
// ARW 发布配置: --config 文件本身, 或仓库根 (按脚本位置) .arw.local.json 的 release 对象.
const localConfig = join(dirname(fileURLToPath(import.meta.url)), '..', '.arw.local.json');
const configDirectory = dirname(resolve(configOption ?? localConfig));
const config = configOption !== undefined ? readJson(configOption, 'Config file')
    : existsSync(localConfig) ? readJson(localConfig, 'Config file').release : undefined;
if (typeof config !== 'object' || config === null || Array.isArray(config)) fail('No release config: pass --config <path> or add a "release" object to .arw.local.json.');
const shared = typeof config.sharedMachinesConfig === 'string' ? readJson(resolve(configDirectory, config.sharedMachinesConfig), 'Shared machines config')
    : config.sharedMachinesConfig === undefined ? {} : fail('sharedMachinesConfig must be a path string.');
/** @type {Machine | undefined} */
const machine = shared.machines?.[machineKey] === undefined && config.machines?.[machineKey] === undefined
    ? undefined : {...shared.machines?.[machineKey], ...config.machines?.[machineKey]};
if (machine === undefined) fail(`Machine not found in config: ${machineKey}`);
if (operation === 'check' && typeof config.fixturesDirectory !== 'string') fail('fixturesDirectory is missing from the config.');

/** @param {string} file @param {string[]} args @param {{cwd?: string, quiet?: boolean}} [options] */
const run = (file, args, {cwd, quiet = false} = {}) => {
    const result = spawnSync(file, args, {cwd, encoding: 'utf8', stdio: quiet ? 'pipe' : ['ignore', 'inherit', 'inherit']});
    return {ok: result.status === 0, stdout: result.stdout ?? '', error: result.error?.message ?? result.stderr ?? ''};
};

// vmrun 参数逐项传递, 含空格的 VMX 路径保持为一个参数.
/** @param {string[]} args */
const vmrun = (...args) => run(machine.vmrun, ['-T', 'ws', ...args], {quiet: true});

/** @template {{ok: boolean, error: string}} T @param {string} label @param {T} result @returns {T} */
const must = (label, result) => {
    if (!result.ok) throw new Error(`${label} failed: ${result.error.trim()}`);
    return result;
};

const down = () => {
    vmrun('stop', machine.location, 'hard'); // 已关机时 vmrun 报错, 忽略; 随后的还原会证明状态.
    must('revertToSnapshot', vmrun('revertToSnapshot', machine.location, machine.snapshot));
};

// 每次连接使用自己的本地临时目录写固定 known-hosts, 结束时删除. 文件只属于这台机器, 别名固定 (机器键可能含空格).
const workspace = mkdtempSync(join(tmpdir(), 'arw-release-vm-'));
const alias = 'arw-release-vm';
writeFileSync(join(workspace, 'known_hosts'), `${alias} ${machine.ssh.hostKey}\n`);
const sshOptions = [
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes',
    '-o', `HostKeyAlias=${alias}`, '-o', `UserKnownHostsFile=${join(workspace, 'known_hosts')}`,
    '-i', machine.ssh.identityFile,
];
const address = () => must('getGuestIPAddress', vmrun('getGuestIPAddress', machine.location, '-wait')).stdout.trim();
/** @param {string} host @param {string} command @param {boolean} [quiet] */
const ssh = (host, command, quiet = false) => run('ssh', [...sshOptions, '-p', String(machine.ssh.port), `${machine.ssh.user}@${host}`, command], {quiet});

const check = async (/** @type {string} */ bundle) => {
    down();
    must('start', vmrun('start', machine.location, 'nogui'));
    // 每次重新取地址: 刚启动时可能先报告临时地址.
    let host = address();
    let attempt = 0;
    while (!ssh(host, 'exit', true).ok) {
        if (++attempt >= SSH_WAIT_ATTEMPTS) throw new Error(`SSH to ${machineKey} (${host}) did not become available.`);
        await new Promise(resolve => setTimeout(resolve, SSH_WAIT_INTERVAL_MS));
        host = address();
    }
    // 两个文件先复制到本地临时目录再传: Windows 路径里的 `C:` 会被 scp 当作主机名.
    copyFileSync(bundle, join(workspace, GUEST_BUNDLE));
    copyFileSync(join(resolve(configDirectory, config.fixturesDirectory), 'agent-assisted.tgz'), join(workspace, GUEST_FIXTURE));
    copyFileSync(archive, join(workspace, GUEST_ARCHIVE));
    must('scp bundle, fixture and archive', run('scp', [...sshOptions, '-P', String(machine.ssh.port), GUEST_BUNDLE, GUEST_FIXTURE, GUEST_ARCHIVE, `${machine.ssh.user}@${host}:`], {cwd: workspace}));
    must('guest clone', ssh(host, `git -c advice.detachedHead=false clone --quiet -c core.autocrlf=false -c core.longpaths=true ${GUEST_BUNDLE} ${GUEST_CHECKOUT}`));
    // 每个 Node.js (recommended, minimum) 各跑一次, 首个失败即停. 路径不得含空格.
    // --previous <commit> 转交 guest 检查, 让它先安装上一发布版再升级到候选; --fixture 是传入的 agent-assisted fixture, --archive 是传入的候选安装压缩包.
    const previousArgument = previous === undefined ? '' : ` --previous ${previous}`;
    return Object.values(machine.nodeExecutables).every(node => ssh(host, `${node} ${GUEST_CHECKOUT}/scripts/release-guest-check.mjs --fixture ${GUEST_FIXTURE} --archive ${GUEST_ARCHIVE}${previousArgument}`).ok);
};

let exitCode = 1;
try {
    if (operation === 'down') {
        down();
        exitCode = 0;
    } else if (operation === 'ssh') {
        exitCode = ssh(address(), argument).ok ? 0 : 1;
    } else {
        try {
            exitCode = await check(argument) ? 0 : 1;
        } catch (error) {
            process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        }
        if (!rest.includes('--keep')) down();
    }
} catch (error) {
    exitCode = 1;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
} finally {
    rmSync(workspace, {force: true, recursive: true});
}
if (operation === 'check') process.stdout.write(`${machineKey}: ${exitCode === 0 ? 'PASS' : 'FAIL'}\n`);
process.exitCode = exitCode;
