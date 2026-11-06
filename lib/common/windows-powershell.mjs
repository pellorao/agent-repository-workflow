import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const executeFile = promisify(execFile);

/**
 * Runs a script in Windows PowerShell 5.1 and returns its stdout. Progress output is silenced, any error stops the script, and the child does not inherit
 * `PSModulePath` (PowerShell 7 exports one that 5.1 must not load). A failure rejects with the script's own error, a timeout, or the exit code.
 * @param {string} script @param {Record<string,string>} [environment]
 */
export async function runWindowsPowerShell(script, environment = {}) {
  const wrapped = `$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop';try{${script}\n}catch{[Console]::Error.WriteLine('ARW: '+$_.Exception.Message);exit 1}`;
  try {
    const {stdout} = await executeFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(wrapped,'utf16le').toString('base64')],{
      env:{...Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PSMODULEPATH')),...environment},
      windowsHide:true,timeout:10_000,maxBuffer:1024*1024,
    });
    return stdout;
  } catch (error) {
    const failure = /** @type {any} */ (error);
    throw new Error(/^ARW: (.+)$/m.exec(String(failure.stderr))?.[1].trim() ?? (failure.killed ? 'PowerShell timed out.' : `PowerShell failed (${failure.code}).`));
  }
}
