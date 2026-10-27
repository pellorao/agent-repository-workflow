import assert from 'node:assert/strict';
import {chmod, mkdir, readFile, readdir, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {join, relative} from 'node:path';
import test from 'node:test';

import {PROVIDER_DEFAULTS} from '../../lib/arw-common/config.mjs';
import {createSharedModelCatalog, readLegacyProviders} from '../../lib/background-agent/model-catalog.mjs';
import {securePrivateStatePath} from '../../lib/background-agent/private-state.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';

/** @param {string} home */
async function createPrivateRuntimeDirectory(home) {
  const directory = join(home, 'background-agent-state');
  await mkdir(directory, {mode: 0o700});
  await securePrivateStatePath(directory, 'directory');
  return directory;
}

test('legacy providers are read for migration without creating or changing a Codex home', async t => {
  const home = await createTemporaryDirectory(t, 'arw-model-legacy-');
  const environment = {HOME: home, CODEX_HOME: ''};
  assert.equal(await readLegacyProviders(environment, 'linux'), undefined);
  assert.equal(await readLegacyProviders({CODEX_HOME: join(home, 'missing')}, 'linux'), undefined);
  assert.deepEqual(await readdir(home), []);
  await writeFile(join(home, 'file'), '');
  await assert.rejects(readLegacyProviders({CODEX_HOME: join(home, 'file')}, 'linux'), /must be a directory/);
  await rm(join(home, 'file'));
  await mkdir(join(home, '.codex'));
  const path = join(home, '.codex', 'models.custom.json');
  await writeFile(path, '{"models":[]}');
  assert.equal(await readLegacyProviders(environment, 'linux'), undefined);
  await writeFile(path, '{"models":[],"providers":{"openai":{"maxInstances":7}}}');
  assert.deepEqual(await readLegacyProviders(environment, 'linux'), {openai: {maxInstances: 7}});
  for (const content of ['{"models":[', '[]', '{"providers":null}', '{"providers":{"openai":null}}']) {
    await writeFile(path, content);
    await assert.rejects(readLegacyProviders(environment, 'linux'));
  }
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
  const generated = createSharedModelCatalog({runtimeDirectory, environment: () => environment, providers: {openai: {maxInstances: 5}}});
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
  const providers = JSON.parse(`{
    "qwen_strata": {"driver": "strata", "installationDirectory": ${JSON.stringify(strataDirectory)}},
    "another_strata": {"driver": "strata", "installationDirectory": ${JSON.stringify(strataDirectory)}, "maxInstances": 2},
    "deepseek": {"maxInstances": 3},
    "unlimited": {},
    "__proto__": {"maxInstances": 2}
  }`);
  const customBytes = Buffer.from(JSON.stringify({
    models: [{slug: 'strata', provider: 'local'}],
    providers: {ignored: {maxInstances: 1}},
    userNote: 'keep',
    authToken: 'must-not-copy',
  }));
  await writeFile(cachePath, cacheBytes);
  await writeFile(customPath, customBytes);
  const catalog = createSharedModelCatalog({runtimeDirectory, environment: () => ({CODEX_HOME: codexHome}), maxInstances: 3, providers});
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
  await writeFile(customPath, '{"models":[{"slug":"new"}]}');
  await catalog.remove();
  await assert.rejects(readFile(generatedPath), {code: 'ENOENT'});
  await catalog.remove();
  assert.equal(await catalog.prepare(), generatedPath);
  assert.deepEqual(JSON.parse(await readFile(generatedPath, 'utf8')).models, [
    {slug: 'gpt', other: {a: 1}}, {slug: 'new'},
  ]);
  assert.deepEqual(await readFile(cachePath), cacheBytes);
  assert.deepEqual(await readFile(customPath), Buffer.from('{"models":[{"slug":"new"}]}'));
});

test('provider configuration rejects invalid shape, limits, and Strata directories before writing the native catalog', async t => {
  const home = await createTemporaryDirectory(t, 'arw-model-providers-invalid-');
  const codexHome = join(home, '.codex');
  const runtimeDirectory = await createPrivateRuntimeDirectory(home);
  await mkdir(codexHome);
  await writeFile(join(codexHome, 'models_cache.json'), '{"models":[]}');
  const cases = [
    [{providers: []}, /Providers must be an object/],
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
  for (const [source, pattern] of /** @type {[{providers: unknown}, RegExp][]} */ (cases)) {
    const catalog = createSharedModelCatalog({runtimeDirectory, environment: () => ({CODEX_HOME: codexHome}), maxInstances: 2, providers: source.providers});
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

test('a missing Codex home does not affect providers for Claude Reviewers but still fails the Codex catalog', async t => {
  const home = await createTemporaryDirectory(t, 'arw-model-no-codex-');
  const catalog = createSharedModelCatalog({runtimeDirectory: await createPrivateRuntimeDirectory(home), environment: () => ({HOME: home}), platform: 'linux', providers: PROVIDER_DEFAULTS});
  assert.deepEqual(await catalog.getProviders(), {openai: {maxInstances: 4}, anthropic: {maxInstances: 4}});
  assert.deepEqual(await readdir(home), ['background-agent-state']);
  await assert.rejects(catalog.prepare(), /Codex home and model catalog sources are missing/);
});
