import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {chmod,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {securePrivateStatePath,verifyPrivateStatePath} from '../../lib/background-agent/private-state.mjs';
import {createBackgroundAgentStateStore} from '../../lib/background-agent/state-store.mjs';
import {backgroundAgentMessageDatabasePaths} from '../../lib/background-agent/message-store.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {installFakeCommand} from '../helpers/process.mjs';

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

test('Windows ACL calls survive PowerShell writing progress output to stderr',async t => {
  const directory = await createTemporaryDirectory(t,'arw-private-state-acl-');
  await installFakeCommand(t,directory,'powershell.exe','head -c 4096 /dev/zero | tr "\\0" x >&2\n');
  const platform = /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(process,'platform'));
  Object.defineProperty(process,'platform',{value:'win32'});
  t.after(() => Object.defineProperty(process,'platform',platform));
  await securePrivateStatePath(directory,'directory');
  await verifyPrivateStatePath(directory,'directory');
});

test('Windows private state is secured and verified in one PowerShell process per call',async t => {
  const directory = await createTemporaryDirectory(t,'arw-private-state-batch-');
  const file = join(directory,'credential');
  await writeFile(file,'private\n');
  const log = join(directory,'calls.log');
  await installFakeCommand(t,directory,'powershell.exe',`env >> "${log}"\necho ---- >> "${log}"\n[ ! -e "${directory}/fail" ]\n`);
  const platform = /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(process,'platform'));
  Object.defineProperty(process,'platform',{value:'win32'});
  t.after(() => Object.defineProperty(process,'platform',platform));
  const calls = async () => (await readFile(log,'utf8')).split('----\n').length - 1;
  await securePrivateStatePath(directory,'directory');
  assert.equal(await calls(),1);
  await verifyPrivateStatePath(directory,'directory',[file,'file']);
  assert.equal(await calls(),2);
  assert.ok((await readFile(log,'utf8')).split('----\n')[1].includes(file));
  await writeFile(join(directory,'fail'),'');
  await assert.rejects(verifyPrivateStatePath(directory,'directory',[file,'file']),/could not be verified/);
});

test('Windows ACL child drops PSModulePath and a failed check names its cause',async t => {
  const directory = await createTemporaryDirectory(t,'arw-private-state-reason-');
  const log = join(directory,'env.log');
  await installFakeCommand(t,directory,'powershell.exe',`echo "[$PSModulePath]" >> "${log}"\necho "ARW: Private state permits another identity." >&2\nexit 1\n`);
  const platform = /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(process,'platform'));
  Object.defineProperty(process,'platform',{value:'win32'});
  process.env.PSModulePath = '/powershell7/modules';
  t.after(() => {Object.defineProperty(process,'platform',platform);delete process.env.PSModulePath;});
  await assert.rejects(verifyPrivateStatePath(directory,'directory'),/could not be verified: Private state permits another identity\./);
  assert.equal((await readFile(log,'utf8')).trim(),'[]');
});
