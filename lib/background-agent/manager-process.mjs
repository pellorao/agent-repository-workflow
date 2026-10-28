import {execFile} from 'node:child_process';
import {readFile, readdir} from 'node:fs/promises';
import {posix, win32} from 'node:path';
import {promisify} from 'node:util';
import {parseWindowsProcessCommandLine} from '../common/windows-command-line.mjs';

const executeFile = promisify(execFile);
const daemonFlag = '--background-agent-daemon';
const daemonScript = ['lib', 'arw-background-agent-host.mjs'];

/** @param {string} value */
const isAbsolutePath = value => posix.isAbsolute(value) || win32.isAbsolute(value);
/** @param {string} value */
const normalizePath = value => win32.isAbsolute(value) ? win32.normalize(value).toLowerCase() : posix.normalize(value);
/** @param {string} value */
const isNodeExecutable = value => /^node(?:js)?(?:\.exe)?$/i.test(value.split(/[\\/]/).at(-1) ?? '');

/** @typedef {{argv?:string[],command?:string,uncertain?:boolean}} ProcessRecord */

/** @param {string} value */
function isDaemonScript(value) {
  if (!isAbsolutePath(value)) return false;
  const parts = normalizePath(value).split(/[\\/]/);
  return parts.at(-2) === daemonScript[0] && parts.at(-1) === daemonScript[1];
}

/** @param {string[]} argv @param {string} runtimeDirectory */
function matchesArgv(argv, runtimeDirectory) {
  return argv.length === 4 && isNodeExecutable(argv[0]) && isDaemonScript(argv[1]) && argv[2] === daemonFlag
    && isAbsolutePath(argv[3]) && normalizePath(argv[3]) === normalizePath(runtimeDirectory);
}

/** @param {string} runtimeDirectory @param {string} command */
function classifyDarwinCommand(runtimeDirectory, command) {
  // ps presents a joined command, so only the complete production invocation
  // is accepted. A plausible but unparseable Node invocation stays unknown.
  const prefix = /^(?:(?:\/[^\s]+)*\/)?node(?:js)?(?:\.exe)? /u.exec(command);
  if (!prefix) {
    const first = command.split(' ', 1)[0];
    if (/(?:^|\/)(?:bash|sh|zsh|fish|pwsh|codex)$/u.test(first)) return 'other';
    return /^\/.*\/node(?:js)?(?:\.exe)? /u.test(command)
      && command.includes(daemonFlag) && command.endsWith(runtimeDirectory) ? 'unknown' : 'other';
  }
  const rest = command.slice(prefix[0].length);
  if (rest.startsWith('-')) return 'other';
  const match = /^(\/[^\s]+(?:\/[^\s]+)*\/lib\/arw-background-agent-host\.mjs) --background-agent-daemon (.+)$/u.exec(rest);
  if (match && isDaemonScript(match[1]) && isAbsolutePath(match[2])
    && normalizePath(match[2]) === normalizePath(runtimeDirectory)) return 'present';
  if (rest.includes(daemonFlag) && rest.endsWith(runtimeDirectory)) return 'unknown';
  return 'other';
}

/** @param {string} runtimeDirectory @param {ProcessRecord} record @param {string} platform */
function classifyRecord(runtimeDirectory, record, platform) {
  if (record.uncertain) return 'unknown';
  if (record.argv) return matchesArgv(record.argv, runtimeDirectory) ? 'present' : 'other';
  if (typeof record.command === 'string') {
    if (platform === 'darwin') return classifyDarwinCommand(runtimeDirectory, record.command);
    if (platform === 'win32') {
      if (record.command.trim().length === 0) return 'unknown';
      const argv = parseWindowsProcessCommandLine(record.command);
      return argv ? (matchesArgv(argv, runtimeDirectory) ? 'present' : 'other') : 'unknown';
    }
  }
  return 'unknown';
}

/** @returns {Promise<ProcessRecord[]>} */
async function listLinuxProcesses() {
  const uid = /** @type {() => number} */ (process.getuid)();
  const names = await readdir('/proc');
  const records = await Promise.all(names.filter(name => /^[1-9]\d*$/.test(name)).map(async name => {
    let status;
    try {status = await readFile(`/proc/${name}/status`, 'utf8');}
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      return {uncertain:true};
    }
    const owner = /^Uid:\s+(\d+)/m.exec(status);
    if (!owner) return {uncertain:true};
    if (Number(owner[1]) !== uid) return null;
    let bytes;
    try {bytes = await readFile(`/proc/${name}/cmdline`);}
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      return {uncertain:true};
    }
    if (!bytes.length) return /^State:\s+Z\b/m.test(status) ? null : {uncertain:true};
    if (bytes.at(-1) !== 0) return {uncertain:true};
    return {argv:bytes.toString('utf8').slice(0, -1).split('\0')};
  }));
  return /** @type {ProcessRecord[]} */ (records.filter(Boolean));
}

/** @returns {Promise<ProcessRecord[]>} */
async function listWindowsProcesses() {
  const script = '$ErrorActionPreference="Stop";[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);'
    + '$user=[Security.Principal.WindowsIdentity]::GetCurrent().Name;'
    + '$rows=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -match "^node(js)?\\.exe$" -or $_.CommandLine -like "*arw-background-agent-host.mjs*" } | ForEach-Object {'
    + 'try {$owner=Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction Stop;'
    + 'if ($owner.ReturnValue -ne 0) { @{uncertain=$true} }'
    + 'elseif (($owner.Domain+"\\"+$owner.User) -ieq $user) { @{command=$_.CommandLine;uncertain=($null -eq $_.CommandLine)} } }'
    + 'catch { @{uncertain=$true} } });'
    + 'ConvertTo-Json -InputObject $rows -Compress -Depth 3';
  const {stdout} = await executeFile('powershell.exe', ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
    {windowsHide:true,timeout:10000,maxBuffer:2_000_000});
  const rows = JSON.parse(stdout);
  if (!Array.isArray(rows)) throw new Error('Process observation is incomplete.');
  return rows.map(row => !row || row.uncertain || typeof row.command !== 'string'
    ? {uncertain:true} : {command:row.command});
}

/** @returns {Promise<ProcessRecord[]>} */
async function listDarwinProcesses() {
  const uid = /** @type {() => number} */ (process.getuid)();
  const {stdout} = await executeFile('/bin/ps', ['-ww','-axo','uid=,pid=,command='],
    {env:{...process.env,LC_ALL:'C'},timeout:5000,maxBuffer:2_000_000});
  return stdout.split('\n').filter(Boolean).map(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
    if (!match) return {uncertain:true};
    return Number(match[1]) === uid ? {command:match[3]} : null;
  }).filter(record => record !== null);
}

/**
 * Read-only observation. Only a complete scan with no matching process proves
 * that no manager is running at the observation boundary.
 * @param {{runtimeDirectory:string,platform?:string,listProcesses?:()=>Promise<ProcessRecord[]>}} input
 * @returns {Promise<'present'|'absent'|'unknown'>}
 */
export async function observeBackgroundAgentManagerProcess({runtimeDirectory,platform=process.platform,listProcesses}) {
  if (!isAbsolutePath(runtimeDirectory)) return 'unknown';
  try {
    const records = await (listProcesses ?? (platform === 'linux' ? listLinuxProcesses
      : platform === 'win32' ? listWindowsProcesses : platform === 'darwin' ? listDarwinProcesses
        : async () => {throw new Error('Unsupported process observation platform.');}))();
    if (!Array.isArray(records)) return 'unknown';
    let unknown = false;
    for (const record of records) {
      const state = classifyRecord(runtimeDirectory, record, platform);
      if (state === 'present') return 'present';
      if (state === 'unknown') unknown = true;
    }
    return unknown ? 'unknown' : 'absent';
  } catch {return 'unknown';}
}
