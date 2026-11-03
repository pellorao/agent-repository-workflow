import {execFile} from 'node:child_process';
import {lstat} from 'node:fs/promises';
import {promisify} from 'node:util';

const executeFile = promisify(execFile);

const aclScript = String.raw`
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
function Assert-Private($path) {
  $acl = Get-Acl -LiteralPath $path
  if (-not $acl.AreAccessRulesProtected) { throw 'Private state inheritance is enabled.' }
  $mine = $false
  foreach ($rule in @($acl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))) {
    if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
    if ($rule.IdentityReference.Value -ne $sid.Value) { throw 'Private state permits another identity.' }
    if (($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl) { $mine = $true }
  }
  if (-not $mine) { throw 'Current user access is not confirmed.' }
}
function Set-Private($path, $kind) {
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
}
foreach ($entry in (ConvertFrom-Json $env:ARW_BACKGROUND_PRIVATE_ENTRIES)) {
  $item = Get-Item -LiteralPath $entry.path -Force
  if (($entry.kind -eq 'directory') -ne $item.PSIsContainer) { throw 'Private state path type changed.' }
  try { Assert-Private $entry.path }
  catch {
    if (-not $env:ARW_BACKGROUND_PRIVATE_SECURE) { throw }
    Set-Private $entry.path $entry.kind
    Assert-Private $entry.path
  }
}
`;

/** @param {[string,'directory'|'file'][]} entries @param {boolean} secure */
async function checkPrivateState(entries,secure) {
  const posix = process.platform !== 'win32';
  for (const [path,kind] of entries) {
    const info = await lstat(path);
    if ((kind === 'directory' && !info.isDirectory()) || (kind === 'file' && !info.isFile())) throw new Error('Background Agent private state path type changed.');
    if (posix && ((info.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && info.uid !== process.getuid()))) throw new Error('Background Agent private state permissions are not private.');
  }
  if (posix) return;
  try {
    await executeFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(`$ProgressPreference='SilentlyContinue';${aclScript}`,'utf16le').toString('base64')],{
      env:{...process.env,ARW_BACKGROUND_PRIVATE_ENTRIES:JSON.stringify(entries.map(([path,kind]) => ({path,kind}))),ARW_BACKGROUND_PRIVATE_SECURE:secure ? '1' : ''},
      windowsHide:true,timeout:10_000,maxBuffer:1024*1024,
    });
  } catch {throw new Error('Background Agent private state access could not be verified.');}
}

/** Verifies the paths with one PowerShell process on Windows. @param {string} path @param {'directory'|'file'} kind @param {[string,'directory'|'file'][]} others */
export const verifyPrivateStatePath = (path,kind,...others) => checkPrivateState([[path,kind],...others],false);

/** Makes the path private unless it already is, then verifies it. @param {string} path @param {'directory'|'file'} kind */
export const securePrivateStatePath = (path,kind) => checkPrivateState([[path,kind]],true);
