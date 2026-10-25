import assert from 'node:assert/strict';
import {chmod, mkdir, readFile, readdir, stat, symlink, writeFile} from 'node:fs/promises';
import {join, relative} from 'node:path';
import test from 'node:test';

import {createSharedModelCatalog, prepareCustomModelCatalog} from '../../lib/background-agent/model-catalog.mjs';
import {securePrivateStatePath} from '../../lib/background-agent/private-state.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';

/** @param {string} home */
async function createPrivateRuntimeDirectory(home) {
  const directory = join(home, 'background-agent-state');
  await mkdir(directory, {mode: 0o700});
  await securePrivateStatePath(directory, 'directory');
  return directory;
}

test('installation prepares without writing, creates only a missing custom catalog, and preserves an existing file', async t => {
  const home = await createTemporaryDirectory(t, 'arw-model-install-');
  const environment = {HOME: home, CODEX_HOME: ''};
  const path = join(home, '.codex', 'models.custom.json');
  const preparation = await prepareCustomModelCatalog({environment, platform: 'linux'});
  await assert.rejects(readFile(path), {code: 'ENOENT'});
  assert.equal(await preparation.apply(), true);
  const initial = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(initial.models, []);
  assert.ok(Number.isSafeInteger(initial.providers.openai.maxInstances));
  assert.ok(initial.providers.openai.maxInstances > 0);
  const userBytes = Buffer.from('{ "models" : [{"slug":"user"}], "note": 1 }\n');
  await writeFile(path, userBytes);
  const existing = await prepareCustomModelCatalog({environment, platform: 'linux'});
  assert.equal(await existing.apply(), true);
  const completed = await readFile(path, 'utf8');
  assert.ok(completed.startsWith('{ "models" : [{"slug":"user"}], "note": 1'));
  assert.deepEqual(JSON.parse(completed), {...initial, models: [{slug: 'user'}], note: 1});
  assert.equal(await (await prepareCustomModelCatalog({environment, platform: 'linux'})).apply(), false);
  assert.equal(await readFile(path, 'utf8'), completed);
  await assert.rejects(prepareCustomModelCatalog({environment: {CODEX_HOME: join(home, 'missing'), HOME: home}, platform: 'linux'}), /Codex home is unavailable/);
  const windowsHome = join(home, 'windows-profile');
  await mkdir(windowsHome);
  const windowsPreparation = await prepareCustomModelCatalog({environment: {USERPROFILE: windowsHome}, platform: 'win32'});
  assert.equal(await windowsPreparation.apply(), true);
  assert.deepEqual(JSON.parse(await readFile(join(windowsHome, '.codex', 'models.custom.json'), 'utf8')), initial);
});

test('installation rejects a target that becomes a directory after preparation', async t => {
  const home = await createTemporaryDirectory(t, 'arw-model-install-collision-');
  const preparation = await prepareCustomModelCatalog({environment: {HOME: home}, platform: 'linux'});
  await mkdir(join(home, '.codex'));
  await mkdir(join(home, '.codex', 'models.custom.json'));
  await assert.rejects(preparation.apply(), /regular file/);
  assert.equal((await stat(join(home, '.codex', 'models.custom.json'))).isDirectory(), true);
});

test('catalog replacement refuses changed user bytes and removes its temporary file', async t => {
  const home = await createTemporaryDirectory(t, 'arw-model-install-drift-');
  const codexHome = join(home, '.codex');
  const customPath = join(codexHome, 'models.custom.json');
  await mkdir(codexHome);
  await writeFile(customPath, '{"models":[]}');
  const prepared = await prepareCustomModelCatalog({environment: {CODEX_HOME: codexHome}});
  const changed = '{"models":[{"slug":"new-user-value"}]}';
  await writeFile(customPath, changed);

  await assert.rejects(prepared.apply(), /changed after preparation/u);
  assert.equal(await readFile(customPath, 'utf8'), changed);
  assert.deepEqual(await readdir(codexHome), ['models.custom.json']);
});

test('relative CODEX_HOME, linked Codex homes, and linked read-only sources follow native paths', async t => {
  const home = await createTemporaryDirectory(t, 'arw-model-linked-');
  const actualHome = join(home, 'actual-codex');
  const linkedHome = join(home, 'linked-codex');
  const defaultHome = join(home, 'default-home');
  const runtimeDirectory = await createPrivateRuntimeDirectory(home);
  await mkdir(actualHome);
  await mkdir(defaultHome);
  await symlink(actualHome, linkedHome, process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(actualHome, join(defaultHome, '.codex'), process.platform === 'win32' ? 'junction' : 'dir');
  const cacheBytes = Buffer.from('{"models":[{"slug":"cached"}]}');
  const customBytes = Buffer.from('{"models":[{"slug":"custom"}],"providers":{"openai":{"maxInstances":5}}}');
  const cacheSource = join(home, 'cache-source.json');
  const customSource = join(home, 'custom-source.json');
  await writeFile(cacheSource, cacheBytes);
  await writeFile(customSource, customBytes);
  if (process.platform === 'win32') {
    await writeFile(join(actualHome, 'models_cache.json'), cacheBytes);
    await writeFile(join(actualHome, 'models.custom.json'), customBytes);
  } else {
    await symlink(cacheSource, join(actualHome, 'models_cache.json'));
    await symlink(customSource, join(actualHome, 'models.custom.json'));
  }
  const environment = {CODEX_HOME: relative(process.cwd(), linkedHome)};
  const prepared = await prepareCustomModelCatalog({environment});
  assert.equal(await prepared.apply(), false);
  const defaultEnvironment = process.platform === 'win32' ? {USERPROFILE: defaultHome} : {HOME: defaultHome};
  const defaultPrepared = await prepareCustomModelCatalog({environment: defaultEnvironment});
  assert.equal(await defaultPrepared.apply(), false);
  const generated = createSharedModelCatalog({runtimeDirectory, environment: () => environment});
  assert.deepEqual(await generated.getProviders(), {openai: {maxInstances: 5}});
  assert.deepEqual(JSON.parse(await readFile(await generated.prepare(), 'utf8')), {
    models: [{slug: 'cached'}, {slug: 'custom'}],
  });
  assert.deepEqual(await readFile(cacheSource), cacheBytes);
  assert.deepEqual(await readFile(customSource), customBytes);
});

test('a shared process uses a private merged catalog without changing either source', async t => {
  const home = await createTemporaryDirectory(t, 'arw-model-sources-');
  const codexHome = join(home, '.codex');
  const runtimeDirectory = await createPrivateRuntimeDirectory(home);
  await mkdir(codexHome);
  const cachePath = join(codexHome, 'models_cache.json');
  const customPath = join(codexHome, 'models.custom.json');
  const cacheBytes = Buffer.from('{"cacheVersion":12,"models":[{"slug":"gpt","other":{"a":1}}]}');
  const strataDirectory = join(home, 'strata');
  await mkdir(strataDirectory);
  const customBytes = Buffer.from(JSON.stringify({
    models: [{slug: 'strata', provider: 'local'}],
    providers: {
      qwen_strata: {driver: 'strata', installationDirectory: strataDirectory},
      another_strata: {driver: 'strata', installationDirectory: strataDirectory, maxInstances: 2},
      deepseek: {maxInstances: 3},
      unlimited: {},
      ['__proto__']: {maxInstances: 2},
    },
    userNote: 'keep',
    authToken: 'must-not-copy',
  }));
  await writeFile(cachePath, cacheBytes);
  await writeFile(customPath, customBytes);
  const catalog = createSharedModelCatalog({runtimeDirectory, environment: () => ({CODEX_HOME: codexHome}), maxInstances: 3});
  /** @type {Record<string, import('../../lib/background-agent/model-catalog.mjs').ProviderConfiguration>} */
  const expectedProviders = {
    qwen_strata: {driver: 'strata', installationDirectory: strataDirectory, maxInstances: 1},
    another_strata: {driver: 'strata', installationDirectory: strataDirectory, maxInstances: 2},
    deepseek: {maxInstances: 3},
    unlimited: {},
    ['__proto__']: {maxInstances: 2},
  };
  assert.deepEqual(await catalog.getProviders(), expectedProviders);
  assert.equal(Object.hasOwn(await catalog.getProviders(), '__proto__'), true);
  await writeFile(customPath, '{"models":[{"slug":"new"}],"providers":{"deepseek":{"maxInstances":2}}}');
  const generatedPath = await catalog.prepare();
  assert.equal(generatedPath, join(runtimeDirectory, 'models.json'));
  assert.deepEqual(JSON.parse(await readFile(generatedPath, 'utf8')), {
    models: [{slug: 'gpt', other: {a: 1}}, {slug: 'strata', provider: 'local'}],
  });
  assert.equal((await readFile(generatedPath, 'utf8')).includes('must-not-copy'), false);
  if (process.platform !== 'win32') assert.equal((await stat(generatedPath)).mode & 0o077, 0);
  assert.deepEqual((await catalog.getProviders()).deepseek, {maxInstances: 3});
  assert.equal(await catalog.prepare(), generatedPath);
  assert.deepEqual(JSON.parse(await readFile(generatedPath, 'utf8')).models, [
    {slug: 'gpt', other: {a: 1}}, {slug: 'strata', provider: 'local'},
  ]);
  await catalog.remove();
  await assert.rejects(readFile(generatedPath), {code: 'ENOENT'});
  await catalog.remove();
  assert.deepEqual(await catalog.getProviders(), {deepseek: {maxInstances: 2}});
  assert.equal(await catalog.prepare(), generatedPath);
  assert.deepEqual(JSON.parse(await readFile(generatedPath, 'utf8')).models, [
    {slug: 'gpt', other: {a: 1}}, {slug: 'new'},
  ]);
  assert.deepEqual(await readFile(cachePath), cacheBytes);
  assert.deepEqual(await readFile(customPath), Buffer.from('{"models":[{"slug":"new"}],"providers":{"deepseek":{"maxInstances":2}}}'));
});

test('provider configuration rejects invalid shape, limits, and Strata directories before writing the native catalog', async t => {
  const home = await createTemporaryDirectory(t, 'arw-model-providers-invalid-');
  const codexHome = join(home, '.codex');
  const runtimeDirectory = await createPrivateRuntimeDirectory(home);
  await mkdir(codexHome);
  await writeFile(join(codexHome, 'models_cache.json'), '{"models":[]}');
  const customPath = join(codexHome, 'models.custom.json');
  const catalog = createSharedModelCatalog({runtimeDirectory, environment: () => ({CODEX_HOME: codexHome}), maxInstances: 2});
  const cases = [
    [{providers: []}, /providers must be an object/],
    [{providers: {generic: null}}, /object value/],
    [{providers: {generic: {driver: 'other'}}}, /unsupported driver/],
    [{providers: {generic: {installationDirectory: home}}}, /without the Strata driver/],
    [{providers: {generic: {maxInstances: 0}}}, /positive safe integer/],
    [{providers: {generic: {maxInstances: 3}}}, /global limit/],
    [{providers: {generic: {maxInstances: 1.5}}}, /positive safe integer/],
    [{providers: {generic: {maxInstances: 1, unknown: true}}}, /unsupported field/],
    [{providers: {qwen_strata: {driver: 'strata', installationDirectory: 'relative'}}}, /accessible absolute directory/],
    [{providers: {qwen_strata: {driver: 'strata', installationDirectory: join(home, 'missing')}}}, /unavailable/],
  ];
  for (const [source, pattern] of cases) {
    await writeFile(customPath, JSON.stringify({models: [], ...source}));
    await assert.rejects(catalog.getProviders(), pattern);
  }
  await assert.rejects(readFile(join(runtimeDirectory, 'models.json')), {code: 'ENOENT'});
});

test('missing or invalid sources cannot produce a partial shared catalog', async t => {
  const home = await createTemporaryDirectory(t, 'arw-model-invalid-');
  const codexHome = join(home, '.codex');
  const runtimeDirectory = await createPrivateRuntimeDirectory(home);
  await mkdir(codexHome);
  const cachePath = join(codexHome, 'models_cache.json');
  const customPath = join(codexHome, 'models.custom.json');
  const generatedPath = join(runtimeDirectory, 'models.json');
  const catalog = createSharedModelCatalog({runtimeDirectory, environment: () => ({CODEX_HOME: codexHome})});
  await assert.rejects(catalog.prepare(), /Cannot read models_cache.json/);
  await writeFile(cachePath, '{"models":[{"slug":"gpt"}]}');
  await assert.rejects(catalog.prepare(), /Cannot read models.custom.json/);
  await writeFile(customPath, '{"models":"[]"}');
  await assert.rejects(catalog.prepare(), /valid JSON models array/);
  await writeFile(customPath, '{"models":[');
  await assert.rejects(catalog.prepare(), /valid JSON models array/);
  await assert.rejects(readFile(generatedPath), {code: 'ENOENT'});
  await writeFile(customPath, '{"models":[]}');
  if (process.platform !== 'win32') {
    await chmod(runtimeDirectory, 0o755);
    await assert.rejects(catalog.prepare(), /not private/);
    await assert.rejects(readFile(generatedPath), {code: 'ENOENT'});
  }
});

test('a generated catalog is never overwritten before its prior process exit is confirmed', async t => {
  const home = await createTemporaryDirectory(t, 'arw-model-collision-');
  const codexHome = join(home, '.codex');
  const runtimeDirectory = await createPrivateRuntimeDirectory(home);
  await mkdir(codexHome);
  await writeFile(join(codexHome, 'models_cache.json'), '{"models":[]}');
  await writeFile(join(codexHome, 'models.custom.json'), '{"models":[]}');
  const generatedPath = join(runtimeDirectory, 'models.json');
  await writeFile(generatedPath, 'prior process catalog', {mode: 0o600});
  const catalog = createSharedModelCatalog({runtimeDirectory, environment: () => ({CODEX_HOME: codexHome})});
  await assert.rejects(catalog.prepare(), /already exists/);
  assert.equal(await readFile(generatedPath, 'utf8'), 'prior process catalog');
});

test('a missing Codex home leaves no providers for Claude Reviewers but still fails the Codex catalog', async t => {
  const home = await createTemporaryDirectory(t, 'arw-model-no-codex-');
  const catalog = createSharedModelCatalog({runtimeDirectory: await createPrivateRuntimeDirectory(home), environment: () => ({HOME: home}), platform: 'linux'});
  assert.deepEqual(await catalog.getProviders(), {});
  await assert.rejects(catalog.prepare(), /Codex home and model catalog sources are missing/);
});
