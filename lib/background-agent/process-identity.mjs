import {execFile} from 'node:child_process';
import {open, readdir, readFile, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {securePrivateStatePath, verifyPrivateStatePath} from './private-state.mjs';

const executeFile = promisify(execFile);
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** Apple ps lstart prints the kernel process start second using the C locale. @param {string} value */
export function parseDarwinProcessStartSecond(value) {
  const match=/^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+([1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):([0-5]\d):([0-5]\d) (\d{4})$/.exec(value.trim());
  if(!match)throw new Error('Operating system process creation time is unavailable.');
  const month=months.indexOf(match[1]);
  const year=Number(match[6]),day=Number(match[2]);
  const date=new Date(Date.UTC(year,month,day,Number(match[3]),Number(match[4]),Number(match[5])));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month||date.getUTCDate()!==day)
    throw new Error('Operating system process creation time is unavailable.');
  return (BigInt(date.getTime())*1_000_000n).toString();
}

/** @param {number} pid @returns {Promise<string|null>} */
export async function readDarwinProcessCreationTime(pid) {
  let stdout;
  try {
    ({stdout}=await executeFile('/bin/ps',['-p',String(pid),'-o','lstart='],{
      env:{...process.env,LC_ALL:'C',TZ:'UTC0'},timeout:5000,maxBuffer:256,
    }));
  } catch(error) {
    if(error instanceof Error && 'code' in error && error.code===1 && 'stdout' in error && 'stderr' in error
      && String(error.stdout).trim()==='' && String(error.stderr).trim()==='') return null;
    throw error;
  }
  if(!stdout.trim())return null;
  return parseDarwinProcessStartSecond(stdout);
}

/** @typedef {{pid:number,createdAt:string}} ProcessIdentity */
/** @typedef {{state:'absent'|'alive'|'ended'|'unknown',identity:ProcessIdentity|null}} ProcessObservation */

/** @param {string} runtimeDirectory */
export const appServerProcessIdentityPath = runtimeDirectory => join(runtimeDirectory,'app-server-process');
/** Each running Claude turn process has its own identity file beside the shared App Server one. */
const CLAUDE_PROCESS_PREFIX = 'claude-process-';

/**
 * The creation value comes from the operating system, never a file timestamp or the manager clock.
 * @param {number} pid
 * @returns {Promise<string|null>}
 */
export async function readOperatingSystemProcessCreationTime(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Process PID is invalid.');
  if (process.platform === 'linux') {
    let stat;
    try {stat = await readFile(`/proc/${pid}/stat`,'utf8');}
    catch (error) {if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error;}
    const end = stat.lastIndexOf(')');
    if (end < 0) throw new Error('Operating system process identity is unavailable.');
    const fields = stat.slice(end + 2).trim().split(/\s+/);
    const startTicks = fields[19]; // Field 22, after pid and the parenthesized command.
    const boot = (await readFile('/proc/stat','utf8')).match(/^btime (\d+)$/m)?.[1];
    const ticks = (await executeFile('getconf',['CLK_TCK'],{timeout:5000,maxBuffer:128})).stdout.trim();
    if (!startTicks || !boot || !/^\d+$/.test(startTicks) || !/^\d+$/.test(ticks) || BigInt(ticks) === 0n) {
      throw new Error('Operating system process creation time is unavailable.');
    }
    return (BigInt(boot) * 1_000_000_000n + BigInt(startTicks) * 1_000_000_000n / BigInt(ticks)).toString();
  }
  if (process.platform === 'win32') {
    const script = '$p = Get-CimInstance Win32_Process -Filter "ProcessId = ' + pid + '"; if ($null -ne $p) { [DateTime]$p.CreationDate.ToUniversalTime().Ticks.ToString() }';
    const {stdout} = await executeFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{
      windowsHide:true,timeout:10000,maxBuffer:256,
    });
    const value = stdout.trim();
    if (!value) return null;
    if (!/^\d+$/.test(value)) throw new Error('Operating system process creation time is unavailable.');
    return value;
  }
  if (process.platform === 'darwin') return readDarwinProcessCreationTime(pid);
  throw new Error('Operating system process creation time is unavailable on this platform.');
}

/** @param {string} content @returns {ProcessIdentity} */
function parseIdentity(content) {
  const match = /^([1-9]\d*),(\d+)$/.exec(content);
  const pid = match ? Number(match[1]) : NaN;
  if (!match || !Number.isSafeInteger(pid)) throw new Error('Process identity is invalid.');
  return {pid,createdAt:match[2]};
}

/**
 * @param {{runtimeDirectory:string,path:string,readCreationTime?:(pid:number)=>Promise<string|null>}} input
 * @returns {Promise<ProcessObservation>}
 */
export async function readProcessIdentity({runtimeDirectory,path,readCreationTime=readOperatingSystemProcessCreationTime}) {
  let content;
  try {
    await verifyPrivateStatePath(runtimeDirectory,'directory');
    await verifyPrivateStatePath(path,'file');
    content = await readFile(path,'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      // An absent identity is only useful under the caller's serialized startup ownership.
      return {state:'absent',identity:null};
    }
    return {state:'unknown',identity:null};
  }
  let identity;
  try {identity = parseIdentity(content);}
  catch {return {state:'unknown',identity:null};}
  try {
    const current = await readCreationTime(identity.pid);
    return {state:current === null || current !== identity.createdAt ? 'ended':'alive',identity};
  } catch {return {state:'unknown',identity};}
}

/**
 * @param {{runtimeDirectory:string,path:string,identity:ProcessIdentity,readCreationTime?:(pid:number)=>Promise<string|null>}} input
 */
export async function removeEndedProcessIdentity({runtimeDirectory,path,identity,readCreationTime=readOperatingSystemProcessCreationTime}) {
  const observed = await readProcessIdentity({runtimeDirectory,path,readCreationTime});
  if (observed.state !== 'ended' || observed.identity?.pid !== identity.pid || observed.identity.createdAt !== identity.createdAt) {
    throw new Error('Process exit and identity were not confirmed.');
  }
  await unlink(path);
}

/**
 * @param {{runtimeDirectory:string,path:string,identity:ProcessIdentity}} input
 */
export async function recordProcessIdentity({runtimeDirectory,path,identity}) {
  if (!Number.isSafeInteger(identity.pid) || identity.pid <= 0 || !/^\d+$/.test(identity.createdAt)) throw new Error('Process identity is invalid.');
  await verifyPrivateStatePath(runtimeDirectory,'directory');
  const handle = await open(path,'wx',0o600);
  try {
    await handle.writeFile(`${identity.pid},${identity.createdAt}`,'ascii');
    await handle.sync();
  } finally {await handle.close();}
  await securePrivateStatePath(path,'file');
}

/** @param {string} runtimeDirectory @param {string} threadId */
export const claudeProcessIdentityPath = (runtimeDirectory,threadId) => join(runtimeDirectory,`${CLAUDE_PROCESS_PREFIX}${threadId}`);

/**
 * Observes the recorded Claude turn processes, including those left by an earlier manager.
 * @param {{runtimeDirectory:string,readCreationTime?:(pid:number)=>Promise<string|null>}} input
 * @returns {Promise<Array<{threadId:string,path:string,observation:ProcessObservation}>>}
 */
export async function readClaudeProcessIdentities({runtimeDirectory,readCreationTime=readOperatingSystemProcessCreationTime}) {
  let names;
  try {names = await readdir(runtimeDirectory);}
  catch (error) {if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []; throw error;}
  return Promise.all(names.filter(name => name.startsWith(CLAUDE_PROCESS_PREFIX)).map(async name => {
    const path = join(runtimeDirectory,name);
    return {threadId:name.slice(CLAUDE_PROCESS_PREFIX.length),path,observation:await readProcessIdentity({runtimeDirectory,path,readCreationTime})};
  }));
}
