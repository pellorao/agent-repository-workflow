import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {chmod,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {securePrivateStatePath,verifyPrivateStatePath} from '../../lib/background-agent/private-state.mjs';
import {createBackgroundAgentStateStore} from '../../lib/background-agent/state-store.mjs';
import {backgroundAgentMessageDatabasePaths} from '../../lib/background-agent/message-store.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';

test('private runtime state rejects broad filesystem access before it is read', async () => {
  const directory = await mkdtemp(join(tmpdir(),'arw-private-state-'));
  const file = join(directory,'credential');
  try {
    await writeFile(file,'private\n',{mode:0o600});
    await securePrivateStatePath(directory,'directory');
    await securePrivateStatePath(file,'file');
    if (process.platform !== 'win32') {
      await chmod(file,0o644);
      await assert.rejects(verifyPrivateStatePath(file,'file'),/not private/);
      await chmod(file,0o600);
      await chmod(directory,0o755);
      await assert.rejects(verifyPrivateStatePath(directory,'directory'),/not private/);
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('Agent, message and provider state share one private SQLite file', async t => {
  const directory = await createTemporaryDirectory(t,'arw-state-store-');
  const store = createBackgroundAgentStateStore({runtimeDirectory:directory});
  await store.loadAgents();
  const path = backgroundAgentMessageDatabasePaths(directory).database;
  await verifyPrivateStatePath(path,'file');
  const database = new DatabaseSync(path);
  assert.deepEqual(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(row => row.name),['agents','messages','providers']);
  database.close();
  await store.close();
});
