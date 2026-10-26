import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
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
  assert.match(observed??'',/^\d+$/);
  assert.equal(await readOperatingSystemProcessCreationTime(process.pid),observed);
});
