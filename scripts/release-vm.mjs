#!/usr/bin/env node
// 在 VMware 受验系统中运行 scripts/release-guest-check.mjs: 还原快照, 启动, 经固定主机密钥的 SSH 传入候选 bundle 并运行检查, 最后硬关机并还原快照.
// 用法见 USAGE. 配置是仓库外的 JSON, 格式见 .agents/skills/release/references/vm.md.

import {spawnSync} from 'node:child_process';
import {copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const SSH_WAIT_ATTEMPTS = 60;
const SSH_WAIT_INTERVAL_MS = 5000;
const GUEST_BUNDLE = 'arw-candidate.bundle';
const GUEST_CHECKOUT = 'arw-candidate';
const USAGE = `Usage:
  node scripts/release-vm.mjs check <config.json> <machine> <candidate.bundle> [--keep]
  node scripts/release-vm.mjs ssh <config.json> <machine> <command>
  node scripts/release-vm.mjs down <config.json> <machine>`;

/** @typedef {{vmrun: string, vmx: string, snapshot: string, vmPassword?: string, ssh: {user: string, port: number, identityFile: string, hostKey: string}}} Machine */

const [operation, configPath, machineKey, argument, ...rest] = process.argv.slice(2);
if (!['check', 'ssh', 'down'].includes(operation) || !configPath || !machineKey || (operation !== 'down' && !argument)) {
    process.stderr.write(`${USAGE}\n`);
    process.exit(2);
}
/** @type {Machine | undefined} */
const machine = JSON.parse(readFileSync(configPath, 'utf8')).machines?.[machineKey];
if (machine === undefined) {
    process.stderr.write(`Machine not found in config: ${machineKey}\n`);
    process.exit(2);
}

/** @param {string} file @param {string[]} args @param {{cwd?: string, quiet?: boolean}} [options] */
const run = (file, args, {cwd, quiet = false} = {}) => {
    const result = spawnSync(file, args, {cwd, encoding: 'utf8', stdio: quiet ? 'pipe' : ['ignore', 'inherit', 'inherit']});
    return {ok: result.status === 0, stdout: result.stdout ?? '', error: result.error?.message ?? result.stderr ?? ''};
};

// vmrun 参数逐项传递, 含空格的 VMX 路径保持为一个参数.
/** @param {string[]} args */
const vmrun = (...args) => run(machine.vmrun, [
    '-T', 'ws', ...(machine.vmPassword === undefined ? [] : ['-vp', machine.vmPassword]), ...args,
], {quiet: true});

/** @template {{ok: boolean, error: string}} T @param {string} label @param {T} result @returns {T} */
const must = (label, result) => {
    if (!result.ok) throw new Error(`${label} failed: ${result.error.trim()}`);
    return result;
};

const down = () => {
    vmrun('stop', machine.vmx, 'hard'); // 已关机时 vmrun 报错, 忽略; 随后的还原会证明状态.
    must('revertToSnapshot', vmrun('revertToSnapshot', machine.vmx, machine.snapshot));
};

// 每次连接使用自己的本地临时目录写固定 known-hosts, 结束时删除.
const workspace = mkdtempSync(join(tmpdir(), 'arw-release-vm-'));
const alias = `arw-release-${machineKey}`;
writeFileSync(join(workspace, 'known_hosts'), `${alias} ${machine.ssh.hostKey}\n`);
const sshOptions = [
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes',
    '-o', `HostKeyAlias=${alias}`, '-o', `UserKnownHostsFile=${join(workspace, 'known_hosts')}`,
    '-i', machine.ssh.identityFile,
];
const address = () => must('getGuestIPAddress', vmrun('getGuestIPAddress', machine.vmx, '-wait')).stdout.trim();
/** @param {string} host @param {string} command @param {boolean} [quiet] */
const ssh = (host, command, quiet = false) => run('ssh', [...sshOptions, '-p', String(machine.ssh.port), `${machine.ssh.user}@${host}`, command], {quiet});

const check = async (/** @type {string} */ bundle) => {
    down();
    must('start', vmrun('start', machine.vmx, 'nogui'));
    // 每次重新取地址: 刚启动时可能先报告临时地址.
    let host = address();
    let attempt = 0;
    while (!ssh(host, 'exit', true).ok) {
        if (++attempt >= SSH_WAIT_ATTEMPTS) throw new Error(`SSH to ${machineKey} (${host}) did not become available.`);
        await new Promise(resolve => setTimeout(resolve, SSH_WAIT_INTERVAL_MS));
        host = address();
    }
    copyFileSync(bundle, join(workspace, GUEST_BUNDLE));
    must('scp bundle', run('scp', [...sshOptions, '-P', String(machine.ssh.port), GUEST_BUNDLE, `${machine.ssh.user}@${host}:${GUEST_BUNDLE}`], {cwd: workspace}));
    must('guest clone', ssh(host, `git -c advice.detachedHead=false clone --quiet -c core.autocrlf=false -c core.longpaths=true ${GUEST_BUNDLE} ${GUEST_CHECKOUT}`));
    return ssh(host, `node ${GUEST_CHECKOUT}/scripts/release-guest-check.mjs`).ok;
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
        } finally {
            if (!rest.includes('--keep')) down();
        }
    }
} catch (error) {
    exitCode = 1;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
} finally {
    rmSync(workspace, {force: true, recursive: true});
}
if (operation === 'check') process.stdout.write(`${machineKey}: ${exitCode === 0 ? 'PASS' : 'FAIL'}\n`);
process.exitCode = exitCode;
