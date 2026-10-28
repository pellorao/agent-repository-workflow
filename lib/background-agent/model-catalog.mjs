import {readFile, realpath, stat} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';

import {BACKGROUND_AGENT_DEFAULTS} from '../arw-common/config.mjs';
import {codexHomeLocation} from '../common/codex-home.mjs';
import {createScopedFilesystem} from '../common/filesystem.mjs';
import {isJsonObject, parseJsonText, serializeJson} from '../common/json.mjs';
import {securePrivateStatePath, verifyPrivateStatePath} from './private-state.mjs';
import {applyStrataCatalogSupport} from './strata-models.mjs';

const CUSTOM_NAME = 'models.custom.json';
const CACHE_NAME = 'models_cache.json';
const GENERATED_NAME = 'models.json';

/** @template {{status: string}} T @param {T} result @param {string} action @returns {Extract<T, {status: 'succeeded'}>} */
function requireFilesystemResult(result, action) {
  if (result.status !== 'succeeded') {
    const diagnostics = 'diagnostics' in result && Array.isArray(result.diagnostics)
      ? result.diagnostics.map(item => isJsonObject(item) && typeof item.message === 'string' ? item.message : String(item)).join('; ')
      : String(result.status);
    throw new Error(`${action}: ${diagnostics}`);
  }
  return /** @type {Extract<T, {status: 'succeeded'}>} */ (result);
}

/** @param {{directory: string}} location @returns {Promise<import('../common/filesystem.mjs').ScopedFilesystem | null>} null when the default Codex home does not exist */
async function openCodexHome(location) {
  let information;
  try {
    information = await stat(location.directory);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw new Error('Codex home is unavailable.', {cause: error});
  }
  if (!information.isDirectory()) throw new Error('Codex home must be a directory.');
  return requireFilesystemResult(await createScopedFilesystem({root: await realpath(location.directory)}), 'Codex home is unavailable').scopedFilesystem;
}

/** @typedef {{driver?: 'strata', installationDirectory?: string, maxInstances?: number}} ProviderConfiguration */

/** @param {string} providerId @param {unknown} value */
function providerCapacity(providerId, value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Provider ${providerId} maxInstances must be a positive safe integer.`);
  }
  return value;
}

/** @param {string} directory @param {string} path */
async function readCatalogSource(directory, path, optional = false) {
  let bytes;
  try {
    // Codex reads its model cache as a normal file, including a linked source.
    bytes = await readFile(join(directory, path));
  } catch (error) {
    if (optional && error instanceof Error && 'code' in error && error.code === 'ENOENT') return {models: []};
    throw new Error(`Cannot read ${path}.`, {cause: error});
  }
  const parsed = parseJsonText(bytes);
  if (parsed.status !== 'succeeded' || !isJsonObject(parsed.value) || !Array.isArray(parsed.value.models)) {
    throw new Error(`${path} must contain a valid JSON models array.`);
  }
  return /** @type {{models: unknown[], providers?: unknown}} */ (parsed.value);
}

/** @param {unknown} value @param {number} globalMaxInstances @returns {Promise<Record<string, ProviderConfiguration>>} */
async function readProviders(value, globalMaxInstances) {
  if (value === undefined) return {};
  if (!isJsonObject(value)) throw new Error('Providers must be an object.');
  /** @type {[string, ProviderConfiguration][]} */
  const entries = [];
  for (const [providerId, raw] of Object.entries(value)) {
    if (providerId.trim().length === 0 || !isJsonObject(raw)) {
      throw new Error('Provider entries must have a nonempty ID and an object value.');
    }
    const keys = Object.keys(raw);
    if (keys.some(key => !['driver', 'installationDirectory', 'maxInstances'].includes(key))) {
      throw new Error(`Provider ${providerId} has an unsupported field.`);
    }
    if (raw.driver !== undefined && raw.driver !== 'strata') {
      throw new Error(`Provider ${providerId} has an unsupported driver.`);
    }
    if (raw.installationDirectory !== undefined && raw.driver !== 'strata') {
      throw new Error(`Provider ${providerId} cannot set installationDirectory without the Strata driver.`);
    }
    const configuredMax = providerCapacity(providerId, raw.maxInstances);
    if (configuredMax !== undefined && configuredMax > globalMaxInstances) {
      throw new Error(`Provider ${providerId} maxInstances must be a positive safe integer no greater than the global limit.`);
    }
    /** @type {ProviderConfiguration} */
    const provider = {};
    if (raw.driver === 'strata') {
      if (typeof raw.installationDirectory !== 'string' || !isAbsolute(raw.installationDirectory)) {
        throw new Error(`Provider ${providerId} installationDirectory must be an accessible absolute directory.`);
      }
      let information;
      try {
        information = await stat(raw.installationDirectory);
      } catch (error) {
        throw new Error(`Provider ${providerId} installationDirectory is unavailable.`, {cause: error});
      }
      if (!information.isDirectory()) throw new Error(`Provider ${providerId} installationDirectory must be a directory.`);
      provider.driver = 'strata';
      provider.installationDirectory = raw.installationDirectory;
      provider.maxInstances = configuredMax === undefined ? 1 : /** @type {number} */ (configuredMax);
    } else if (configuredMax !== undefined) {
      provider.maxInstances = /** @type {number} */ (configuredMax);
    }
    entries.push([providerId, provider]);
  }
  return Object.fromEntries(entries);
}

/**
 * Providers a Codex-era installation kept in models.custom.json, read once so
 * installation can migrate them into config.json. Returns undefined when
 * there is no such file; unreadable content is an error so no value is lost.
 * @param {NodeJS.ProcessEnv} environment @param {string} platform
 */
export async function readLegacyProviders(environment, platform) {
  const home = await openCodexHome(codexHomeLocation(environment, platform));
  if (home === null) return undefined;
  let bytes;
  try {
    bytes = await readFile(join(home.root, CUSTOM_NAME));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw new Error(`Cannot read ${CUSTOM_NAME} for provider migration.`, {cause: error});
  }
  const parsed = parseJsonText(bytes);
  if (parsed.status !== 'succeeded' || !isJsonObject(parsed.value)) throw new Error(`${CUSTOM_NAME} must be a JSON object to migrate its providers.`);
  if (parsed.value.providers === undefined) return undefined;
  if (!isJsonObject(parsed.value.providers) || Object.values(parsed.value.providers).some(entry => !isJsonObject(entry))) {
    throw new Error(`${CUSTOM_NAME} providers must be an object of provider objects.`);
  }
  return parsed.value.providers;
}

/**
 * One instance belongs to one shared App Server process lifetime. The caller
 * removes the generated file only after it confirms that process has exited.
 * @param {{runtimeDirectory: string, environment?: () => NodeJS.ProcessEnv, platform?: string, maxInstances?: number, providers?: unknown}} input
 */
export function createSharedModelCatalog({runtimeDirectory, environment = () => process.env, platform = process.platform, maxInstances = BACKGROUND_AGENT_DEFAULTS.maxInstances, providers = {}}) {
  const generatedFilesystem = async () => {
    await verifyPrivateStatePath(runtimeDirectory, 'directory');
    const filesystem = requireFilesystemResult(await createScopedFilesystem({root: runtimeDirectory}), 'Private model catalog directory is unavailable').scopedFilesystem;
    const observed = requireFilesystemResult(await filesystem.inspect({path: GENERATED_NAME}), 'Generated model catalog inspection failed');
    return {filesystem, kind: observed.entry.kind};
  };
  /** @type {string | null} */
  let preparedPath = null;
  /** @type {Promise<string> | null} */
  let preparing = null;
  /** @type {Promise<unknown[] | null> | null} */
  let snapshot = null;

  // Only the Codex App Server needs the Codex user directory; providers come from ARW's own configuration.
  function loadSnapshot() {
    if (snapshot !== null) return snapshot;
    snapshot = (async () => {
      const source = await openCodexHome(codexHomeLocation(environment(), platform));
      if (source === null) return null;
      const cached = await readCatalogSource(source.root, CACHE_NAME);
      const custom = await readCatalogSource(source.root, CUSTOM_NAME, true);
      return applyStrataCatalogSupport([...cached.models, ...custom.models], providers);
    })();
    const currentSnapshot = snapshot;
    currentSnapshot.catch(() => {
      if (snapshot === currentSnapshot) snapshot = null;
    });
    return snapshot;
  }

  return {
    /** @returns {Promise<Record<string, ProviderConfiguration>>} */
    async getProviders() {
      return readProviders(providers, maxInstances);
    },
    async prepare() {
      if (preparedPath !== null) return preparedPath;
      if (preparing !== null) return preparing;
      preparing = (async () => {
        const models = await loadSnapshot();
        if (models === null) throw new Error('Codex home and model catalog sources are missing.');
        const serialized = serializeJson({models}, {format: 'compact'});
        if (serialized.status !== 'succeeded') throw new Error('Cannot serialize the shared model catalog.');

        const {filesystem, kind} = await generatedFilesystem();
        if (kind !== 'missing') throw new Error('Generated model catalog already exists; process exit must be confirmed before replacement.');

        requireFilesystemResult(await filesystem.write({bytes: serialized.bytes, mode: 'create-atomic', path: GENERATED_NAME}), 'Generated model catalog creation failed');
        const path = join(runtimeDirectory, GENERATED_NAME);
        try {
          requireFilesystemResult(await filesystem.setMode({mode: 0o600, path: GENERATED_NAME}), 'Generated model catalog private mode failed');
          await securePrivateStatePath(path, 'file');
        } catch (error) {
          await filesystem.remove({path: GENERATED_NAME});
          throw error;
        }
        preparedPath = path;
        return path;
      })();
      try {
        return await preparing;
      } finally {
        preparing = null;
      }
    },
    async remove() {
      const {filesystem, kind} = await generatedFilesystem();
      if (kind !== 'missing') {
        if (kind !== 'file') throw new Error('Generated model catalog path is not a regular file.');
        requireFilesystemResult(await filesystem.remove({path: GENERATED_NAME}), 'Generated model catalog removal failed');
      }
      preparedPath = null;
      snapshot = null;
    },
  };
}
