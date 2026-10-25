import {execFile} from 'node:child_process';
import {lstat} from 'node:fs/promises';
import {promisify} from 'node:util';

const executeFile = promisify(execFile);

const configureAcl = String.raw`
$ErrorActionPreference = 'Stop'
$path = $env:ARW_BACKGROUND_PRIVATE_PATH
$kind = $env:ARW_BACKGROUND_PRIVATE_KIND
$item = Get-Item -LiteralPath $path -Force
if (($kind -eq 'directory') -ne $item.PSIsContainer) { throw 'Private state path type changed.' }
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = Get-Acl -LiteralPath $path
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))) {
  [void]$acl.RemoveAccessRuleAll($rule)
}
if ($kind -eq 'directory') {
  $inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
} else {
  $inherit = [System.Security.AccessControl.InheritanceFlags]::None
}
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inherit, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $path -AclObject $acl
`;

const verifyAcl = String.raw`
$ErrorActionPreference = 'Stop'
$path = $env:ARW_BACKGROUND_PRIVATE_PATH
$kind = $env:ARW_BACKGROUND_PRIVATE_KIND
$item = Get-Item -LiteralPath $path -Force
if (($kind -eq 'directory') -ne $item.PSIsContainer) { throw 'Private state path type changed.' }
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = Get-Acl -LiteralPath $path
if (-not $acl.AreAccessRulesProtected) { throw 'Private state inheritance is enabled.' }
$mine = $false
foreach ($rule in @($acl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))) {
  if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
  if ($rule.IdentityReference.Value -ne $sid.Value) { throw 'Private state permits another identity.' }
  if (($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl) { $mine = $true }
}
if (-not $mine) { throw 'Current user access is not confirmed.' }
`;

/** @param {string} path @param {'directory'|'file'} kind @param {string} script */
async function runAcl(path,kind,script) {
  try {
    await executeFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{
      env:{...process.env,ARW_BACKGROUND_PRIVATE_PATH:path,ARW_BACKGROUND_PRIVATE_KIND:kind},
      windowsHide:true,timeout:10_000,maxBuffer:1024,
    });
  } catch {throw new Error('Background Agent private state access could not be verified.');}
}

/** @param {string} path @param {'directory'|'file'} kind */
export async function verifyPrivateStatePath(path,kind) {
  const info = await lstat(path);
  if ((kind === 'directory' && !info.isDirectory()) || (kind === 'file' && !info.isFile())) throw new Error('Background Agent private state path type changed.');
  if (process.platform === 'win32') await runAcl(path,kind,verifyAcl);
  else if ((info.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('Background Agent private state permissions are not private.');
}

/** @param {string} path @param {'directory'|'file'} kind */
export async function securePrivateStatePath(path,kind) {
  const info = await lstat(path);
  if ((kind === 'directory' && !info.isDirectory()) || (kind === 'file' && !info.isFile())) throw new Error('Background Agent private state path type changed.');
  if (process.platform === 'win32') await runAcl(path,kind,configureAcl);
  await verifyPrivateStatePath(path,kind);
}
