import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

import {createBackgroundAgentClient} from '../../lib/background-agent/client.mjs';
import {observeBackgroundAgentManagerProcess} from '../../lib/background-agent/manager-process.mjs';

test('manager process observation requires the complete same-user launch and keeps missing state distinct from absence', async t => {
  const runtimeDirectory = '/home/example/arw/background-agent-state';
  const daemon = ['/usr/bin/node', '/opt/engine-a/lib/arw-background-agent-host.mjs', '--background-agent-daemon', runtimeDirectory];
  /** @param {Array<{argv?:string[],command?:string,uncertain?:boolean}>} processes */
  const observe = processes => observeBackgroundAgentManagerProcess({runtimeDirectory,listProcesses:async()=>processes});
  assert.equal(await observe([{argv:daemon}]), 'present');
  assert.equal(await observe([{argv:[daemon[0], '/different/engine/lib/arw-background-agent-host.mjs', daemon[2], daemon[3]]}]), 'present');
  assert.equal(await observe([]), 'absent');
  assert.equal(await observe([{argv:[daemon[0], '/opt/other.mjs', daemon[2], daemon[3]]}]), 'absent');
  assert.equal(await observe([{argv:[...daemon, 'extra']}]), 'absent');
  assert.equal(await observe([{argv:[...daemon.slice(0, 3), '/another/runtime']}]), 'absent');
  assert.equal(await observe([{uncertain:true}]), 'unknown');
  assert.equal(await observeBackgroundAgentManagerProcess({runtimeDirectory,listProcesses:async()=>{throw new Error('No process access.');}}), 'unknown');

  const darwinCommand = daemon.join(' ');
  assert.equal(await observeBackgroundAgentManagerProcess({platform:'darwin',runtimeDirectory,listProcesses:async()=>[{command:darwinCommand}]}), 'present');
  assert.equal(await observeBackgroundAgentManagerProcess({platform:'darwin',runtimeDirectory,listProcesses:async()=>[{command:`/bin/bash -lc echo ${darwinCommand}`}]}), 'absent');
  assert.equal(await observeBackgroundAgentManagerProcess({platform:'win32',runtimeDirectory:'C:\\ARW State',listProcesses:async()=>[{
    command:'"C:\\Program Files\\node.exe" "C:\\Engine A\\lib\\arw-background-agent-host.mjs" --background-agent-daemon "C:\\ARW State"',
  }]}), 'present');
  assert.equal(await observeBackgroundAgentManagerProcess({platform:'win32',runtimeDirectory:'C:\\ARW State',
    listProcesses:async()=>[{command:''}]}), 'unknown');

  const installation = await mkdtemp(join(tmpdir(), 'arw-manager-observation-'));
  const missing = join(installation, 'not-created');
  try {
    let launches = 0;
    const present = createBackgroundAgentClient({runtimeDirectory:missing,observeManagerProcess:async()=> 'present'});
    await assert.rejects(present.list(), /The background Agent list is temporarily unavailable\./);
    await present.close();
    const absent = createBackgroundAgentClient({runtimeDirectory:missing,observeManagerProcess:async()=> 'absent'});
    assert.equal(await absent.list(), null);
    await absent.close();
    const empty = createBackgroundAgentClient({runtimeDirectory:installation,observeManagerProcess:async()=> 'unknown'});
    await assert.rejects(empty.list(), /The background Agent list is temporarily unavailable\./);
    await empty.close();

    await writeFile(join(installation, 'credential'), `${'a'.repeat(64)}\n`, {mode:0o600});
    t.mock.method(Socket.prototype, 'connect', /** @this {Socket} */ function () {
      queueMicrotask(() => this.emit('error', Object.assign(new Error('connect ECONNREFUSED'), {code:'ECONNREFUSED'})));
      return this;
    });
    for (const state of ['present', 'unknown', 'absent']) {
      const client = createBackgroundAgentClient({runtimeDirectory:installation,
        entryPoint:async()=>{launches++;}, observeManagerProcess:async()=> /** @type {'present'|'unknown'|'absent'} */ (state)});
      try {
        if (state === 'absent') assert.equal(await client.list(), null);
        else await assert.rejects(client.list(), /The background Agent list is temporarily unavailable\./);
      } finally {await client.close();}
    }
    assert.equal(launches, 0);
    t.mock.restoreAll();
  } finally {await rm(installation,{recursive:true,force:true});}
});
