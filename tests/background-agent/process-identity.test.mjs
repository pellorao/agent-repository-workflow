import assert from 'node:assert/strict';
import fsPromises, {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {installFakeCommand} from '../helpers/process.mjs';
import {appServerProcessIdentityPath, parseDarwinProcessStartSecond, readProcessIdentity, readOperatingSystemProcessCreationTime, recordProcessIdentity, removeEndedProcessIdentity} from '../../lib/background-agent/process-identity.mjs';



test('private process identity distinguishes live, exited, reused PID and unknown observation', async()=>{
  const runtimeDirectory=await mkdtemp(join(tmpdir(),'arw-native-identity-'));
  const path=appServerProcessIdentityPath(runtimeDirectory);
  const identity={pid:4242,createdAt:'1700000000123456789'};
  try{
    assert.deepEqual(await readProcessIdentity({runtimeDirectory,path,readCreationTime:async()=>null}),{state:'absent',identity:null});
    await recordProcessIdentity({runtimeDirectory,path,identity});
    assert.equal(await readFile(path,'ascii'),'4242,1700000000123456789');
    if(process.platform!=='win32')assert.equal((await stat(path)).mode&0o077,0);
    assert.deepEqual(await readProcessIdentity({runtimeDirectory,path,readCreationTime:async()=>identity.createdAt}),{state:'alive',identity});
    await assert.rejects(removeEndedProcessIdentity({runtimeDirectory,path,identity,readCreationTime:async()=>identity.createdAt}),/not confirmed/);
    assert.equal((await readProcessIdentity({runtimeDirectory,path,readCreationTime:async()=>{throw new Error('unknown');}})).state,'unknown');
    assert.deepEqual(await readProcessIdentity({runtimeDirectory,path,readCreationTime:async()=>String(BigInt(identity.createdAt)+1n)}),{state:'ended',identity});
    await removeEndedProcessIdentity({runtimeDirectory,path,identity,readCreationTime:async()=>null});
    assert.equal((await readProcessIdentity({runtimeDirectory,path,readCreationTime:async()=>null})).state,'absent');
    await writeFile(path,'not-a-process',{mode:0o600});
    assert.equal((await readProcessIdentity({runtimeDirectory,path,readCreationTime:async()=>null})).state,'unknown');
  }finally{await rm(runtimeDirectory,{recursive:true,force:true});}
});

test('operating system creation time is read from the running process identity',async()=>{
  if(!['linux','win32','darwin'].includes(process.platform))return;
  const observed=await readOperatingSystemProcessCreationTime(process.pid);
  assert.match(observed??'',process.platform==='linux'?/^[0-9a-f-]{36}:\d+$/:/^\d+$/);
  assert.equal(await readOperatingSystemProcessCreationTime(process.pid),observed);
});

test('Windows creation time read silences PowerShell progress output and tolerates stderr noise',async t=>{
  const directory=await createTemporaryDirectory(t,'arw-process-identity-');
  await installFakeCommand(t,directory,'powershell.exe','head -c 4096 /dev/zero | tr "\\0" x >&2\nprintf %s "$4" | base64 -d | tr -d "\\0" | grep -q "^.ProgressPreference=.SilentlyContinue.;" || exit 1\necho 12345\n');
  const platform=/** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(process,'platform'));
  Object.defineProperty(process,'platform',{value:'win32'});
  t.after(()=>Object.defineProperty(process,'platform',platform));
  assert.equal(await readOperatingSystemProcessCreationTime(1234),'12345');
});

/** Serves the files in the returned map for the Linux process paths and reads everything else for real. @param {import('node:test').TestContext} t @param {Record<string,string>} files */
function fakeProc(t,files) {
  const real=fsPromises.readFile;
  t.mock.method(fsPromises,'readFile',(/** @type {any} */ path,/** @type {any} */ ...rest)=>typeof path==='string'&&path in files?Promise.resolve(files[path]):real(path,...rest));
  syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  return files;
}

const bootId='d427385f-63f2-4b52-b058-91a63b252ad9';
const stat4242=(/** @type {number} */ ticks)=>`4242 (we) ird) S 1 4242 4242 0 -1 4194560 0 0 0 0 0 0 0 0 20 0 1 0 ${ticks} 0 0`;

test('Linux creation value is the boot id and start ticks and ignores the wall clock boot time',async t=>{
  if(process.platform!=='linux')return;
  const directory=await createTemporaryDirectory(t,'arw-process-identity-getconf-');
  const getconfLog=join(directory,'getconf.log');
  await installFakeCommand(t,directory,'getconf',`echo called >> "${getconfLog}"\necho 100\n`);
  const files=fakeProc(t,{'/proc/4242/stat':stat4242(2114598),'/proc/sys/kernel/random/boot_id':`${bootId}\n`,'/proc/stat':'btime 1700000000\n'});
  const first=await readOperatingSystemProcessCreationTime(4242);
  assert.equal(first,`${bootId}:2114598`);
  files['/proc/stat']='btime 1700009999\n';
  assert.equal(await readOperatingSystemProcessCreationTime(4242),first);
  files['/proc/sys/kernel/random/boot_id']='00000000-0000-4000-8000-000000000000\n';
  assert.notEqual(await readOperatingSystemProcessCreationTime(4242),first);
  await assert.rejects(readFile(getconfLog),{code:'ENOENT'});
});

test('Linux records written before boot-id values stay alive while their process runs and end when it does not',async t=>{
  if(process.platform!=='linux')return;
  const runtimeDirectory=await createTemporaryDirectory(t,'arw-native-identity-legacy-');
  const path=appServerProcessIdentityPath(runtimeDirectory);
  // Boot time in nanoseconds plus 2114598 ticks at 100 ticks per second.
  await writeFile(path,'4242,1793735971980000000',{mode:0o600});
  const files=fakeProc(t,{'/proc/4242/stat':stat4242(2114598),'/proc/stat':'cpu 1\nbtime 1793714826\n'});
  assert.equal((await readProcessIdentity({runtimeDirectory,path})).state,'alive');
  files['/proc/stat']='cpu 1\nbtime 1793714827\n';
  assert.equal((await readProcessIdentity({runtimeDirectory,path})).state,'ended');
});

test('process identity records accept the boot-id form and the plain number form and reject anything else',async()=>{
  const runtimeDirectory=await mkdtemp(join(tmpdir(),'arw-native-identity-forms-'));
  const path=appServerProcessIdentityPath(runtimeDirectory);
  const identity={pid:4242,createdAt:`${bootId}:2114598`};
  try{
    await recordProcessIdentity({runtimeDirectory,path,identity});
    assert.equal(await readFile(path,'ascii'),`4242,${bootId}:2114598`);
    /** @type {(string|undefined)[]} */
    const seen=[];
    assert.deepEqual(await readProcessIdentity({runtimeDirectory,path,readCreationTime:async(pid,recorded)=>{seen.push(recorded);return identity.createdAt;}}),{state:'alive',identity});
    assert.deepEqual(seen,[identity.createdAt]);
    await rm(path);
    await writeFile(path,'4242,1700000000123456789',{mode:0o600});
    assert.equal((await readProcessIdentity({runtimeDirectory,path,readCreationTime:async()=>'1700000000123456789'})).state,'alive');
    for(const bad of ['4242,abc','4242,not-a-uuid:5',`4242,${bootId}:`,`4242,${bootId}`,'4242,1,2']){
      await writeFile(path,bad,{mode:0o600});
      assert.equal((await readProcessIdentity({runtimeDirectory,path,readCreationTime:async()=>identity.createdAt})).state,'unknown');
    }
    await assert.rejects(recordProcessIdentity({runtimeDirectory,path:join(runtimeDirectory,'other'),identity:{pid:1,createdAt:'x:1'}}),/invalid/);
  }finally{await rm(runtimeDirectory,{recursive:true,force:true});}
});
