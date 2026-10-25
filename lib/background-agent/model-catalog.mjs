import {lstat, readFile, realpath, stat} from 'node:fs/promises';
import {basename, dirname, isAbsolute, join, resolve} from 'node:path';

import {BACKGROUND_AGENT_DEFAULTS} from '../arw-common/config.mjs';
import {createScopedFilesystem} from '../common/filesystem.mjs';
import {completeConfigurationBytes, isJsonObject, parseJsonText, serializeJson} from '../common/json.mjs';
import {securePrivateStatePath, verifyPrivateStatePath} from './private-state.mjs';
import {applyStrataCatalogSupport} from './strata-models.mjs';

const CUSTOM_NAME = 'models.custom.json';
const CACHE_NAME = 'models_cache.json';
const GENERATED_NAME = 'models.json';
const OPENAI_DEFAULT_MAX_INSTANCES = 4;

/** @param {unknown} result @param {string} action */
function requireFilesystemResult(result, action) {
  if (result === null || typeof result !== 'object' || !('status' in result)) {
    throw new Error(`${action} did not return a filesystem result.`);
  }
  if (result.status !== 'succeeded') {
    const diagnostics = 'diagnostics' in result && Array.isArray(result.diagnostics)
      ? result.diagnostics.map(item => isJsonObject(item) && typeof item.message === 'string' ? item.message : String(item)).join('; ')
      : String(result.status);
    throw new Error(`${action}: ${diagnostics}`);
  }
}

/** @param {NodeJS.ProcessEnv} environment @param {string} platform */
function codexHomeLocation(environment, platform) {
  if (!['linux', 'darwin', 'win32'].includes(platform)) {
    throw new Error(`Unsupported Codex home platform: ${platform}.`);
  }
  const configured = environment.CODEX_HOME;
  if (typeof configured === 'string' && configured.length > 0) {
    return {directory: resolve(configured), defaultParent: null};
  }
  const variable = platform === 'win32' ? 'USERPROFILE' : 'HOME';
  const home = environment[variable];
  if (typeof home !== 'string' || !isAbsolute(home)) {
    throw new Error(`Cannot resolve an absolute ${variable} directory.`);
  }
  return {directory: join(home, '.codex'), defaultParent: home};
}

/**
 * @param {{directory: string, defaultParent: string | null}} location
 * @param {boolean} createDefault
 * @returns {Promise<import('../common/filesystem.mjs').ScopedFilesystem | null>}
 */
async function openCodexHome(location, createDefault) {
  let information;
  try {
    information = await stat(location.directory);
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    if (!missing || location.defaultParent === null) {
      throw new Error('Codex home is unavailable.', {cause: error});
    }
    if (!createDefault) return null;
    let parentPath;
    try {
      parentPath = await realpath(location.defaultParent);
    } catch (parentError) {
      throw new Error('Codex home parent is unavailable.', {cause: parentError});
    }
    const parent = await createScopedFilesystem({root: parentPath});
    requireFilesystemResult(parent, 'Codex home parent inspection failed');
    if (parent.status !== 'succeeded') throw new Error('Codex home parent is unavailable.');
    const created = await parent.scopedFilesystem.createDirectory({path: '.codex'});
    requireFilesystemResult(created, 'Codex home creation failed');
    information = await stat(location.directory);
  }
  if (!information.isDirectory()) throw new Error('Codex home must be a directory.');
  const opened = await createScopedFilesystem({root: await realpath(location.directory)});
  requireFilesystemResult(opened, 'Codex home is unavailable');
  if (opened.status !== 'succeeded') throw new Error('Codex home is unavailable.');
  return opened.scopedFilesystem;
}

/** @typedef {{driver?: 'strata', installationDirectory?: string, maxInstances?: number}} ProviderConfiguration */

/** @param {string} providerId @param {unknown} value */
function providerCapacity(providerId, value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Custom model catalog provider ${providerId} maxInstances must be a positive safe integer.`);
  }
  return value;
}

/** @param {string} directory @param {string} path */
async function readCatalogSource(directory, path) {
  let bytes;
  try {
    // Codex reads its model cache as a normal file, including a linked source.
    bytes = await readFile(join(directory, path));
  } catch (error) {
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
  if (!isJsonObject(value)) throw new Error('Custom model catalog providers must be an object.');
  /** @type {[string, ProviderConfiguration][]} */
  const entries = [];
  for (const [providerId, raw] of Object.entries(value)) {
    if (providerId.trim().length === 0 || !isJsonObject(raw)) {
      throw new Error('Custom model catalog provider entries must have a nonempty ID and an object value.');
    }
    const keys = Object.keys(raw);
    if (keys.some(key => !['driver', 'installationDirectory', 'maxInstances'].includes(key))) {
      throw new Error(`Custom model catalog provider ${providerId} has an unsupported field.`);
    }
    if (raw.driver !== undefined && raw.driver !== 'strata') {
      throw new Error(`Custom model catalog provider ${providerId} has an unsupported driver.`);
    }
    if (raw.installationDirectory !== undefined && raw.driver !== 'strata') {
      throw new Error(`Custom model catalog provider ${providerId} cannot set installationDirectory without the Strata driver.`);
    }
    const configuredMax = providerCapacity(providerId, raw.maxInstances);
    if (configuredMax !== undefined && configuredMax > globalMaxInstances) {
      throw new Error(`Custom model catalog provider ${providerId} maxInstances must be a positive safe integer no greater than the global limit.`);
    }
    /** @type {ProviderConfiguration} */
    const provider = {};
    if (raw.driver === 'strata') {
      if (typeof raw.installationDirectory !== 'string' || !isAbsolute(raw.installationDirectory)) {
        throw new Error(`Custom model catalog provider ${providerId} installationDirectory must be an accessible absolute directory.`);
      }
      let information;
      try {
        information = await stat(raw.installationDirectory);
        await realpath(raw.installationDirectory);
      } catch (error) {
        throw new Error(`Custom model catalog provider ${providerId} installationDirectory is unavailable.`, {cause: error});
      }
      if (!information.isDirectory()) throw new Error(`Custom model catalog provider ${providerId} installationDirectory must be a directory.`);
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

/** @param {string} path */
async function customFileKind(path) {
  let entry;
  try {
    entry = await lstat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 'missing';
    throw new Error('Custom model catalog inspection failed.', {cause: error});
  }
  if (!entry.isSymbolicLink()) return entry.isFile() ? 'file' : 'other';
  try {
    return (await stat(path)).isFile() ? 'file' : 'other';
  } catch (error) {
    throw new Error('Custom model catalog link target is unavailable.', {cause: error});
  }
}

/** @param {Buffer} bytes @param {number} globalMaxInstances */
function providerCapacityWarnings(bytes, globalMaxInstances) {
  const parsed = parseJsonText(bytes);
  if (parsed.status !== 'succeeded' || !isJsonObject(parsed.value) || !isJsonObject(parsed.value.providers)) {
    throw new Error('Custom model catalog capacity inspection failed.');
  }
  return Object.entries(parsed.value.providers).flatMap(([providerId, provider]) => {
    if (!isJsonObject(provider)) return [];
    const maxInstances = providerCapacity(providerId, provider.maxInstances);
    if (maxInstances === undefined || maxInstances <= globalMaxInstances) return [];
    return [`Provider ${providerId} maxInstances ${maxInstances} exceeds global maxInstances ${globalMaxInstances}.`];
  });
}

/** @param {{bytes: Buffer, customPath: string, filesystem: import('../common/filesystem.mjs').ScopedFilesystem, mode: number, originalBytes: Buffer, targetName: string, targetPath: string}} input */
async function replaceCustomCatalog({bytes, customPath, filesystem, mode, originalBytes, targetName, targetPath}) {
  const written = await filesystem.write({
    bytes,
    fileMode: mode,
    mode: 'replace',
    path: targetName,
    async beforeReplace() {
      if (await realpath(customPath) !== targetPath) throw new Error('Custom model catalog link target changed after preparation.');
      const observed = await filesystem.inspect({path: targetName});
      requireFilesystemResult(observed, 'Custom model catalog target revalidation failed');
      if (observed.status !== 'succeeded' || observed.entry.kind !== 'file') throw new Error('Custom model catalog target is not a regular file.');
      const current = await filesystem.read({path: targetName});
      requireFilesystemResult(current, 'Custom model catalog target revalidation failed');
      if (current.status !== 'succeeded' || !current.bytes.equals(originalBytes)
          || ((await stat(targetPath)).mode & 0o7777) !== mode) {
        throw new Error('Custom model catalog changed after preparation.');
      }
    },
  });
  requireFilesystemResult(written, 'Custom model catalog replacement failed');
}

/**
 * Inspect the user's Codex location before the installer performs any write.
 * @param {{environment?: NodeJS.ProcessEnv, platform?: string, maxInstances?: number}} [input]
 */
export async function prepareCustomModelCatalog({environment = process.env, platform = process.platform, maxInstances = BACKGROUND_AGENT_DEFAULTS.maxInstances} = {}) {
  if (!Number.isSafeInteger(maxInstances) || maxInstances <= 0) throw new TypeError('maxInstances must be a positive safe integer.');
  const location = codexHomeLocation(environment, platform);
  const existingHome = await openCodexHome(location, false);
  let existing = null;
  if (existingHome !== null) {
    const customPath = join(existingHome.root, CUSTOM_NAME);
    const kind = await customFileKind(customPath);
    if (kind !== 'missing' && kind !== 'file') {
      throw new Error('Custom model catalog path must be a regular file.');
    }
    if (kind === 'file') {
      const targetPath = await realpath(customPath);
      const targetName = basename(targetPath);
      const openedTarget = await createScopedFilesystem({root: dirname(targetPath)});
      requireFilesystemResult(openedTarget, 'Custom model catalog target is unavailable');
      if (openedTarget.status !== 'succeeded') throw new Error('Custom model catalog target is unavailable.');
      const targetFilesystem = openedTarget.scopedFilesystem;
      const original = await targetFilesystem.read({path: targetName});
      requireFilesystemResult(original, 'Custom model catalog target is unreadable');
      if (original.status !== 'succeeded') throw new Error('Custom model catalog target is unreadable.');
      const originalBytes = original.bytes;
      let completed;
      try {
        completed = completeConfigurationBytes({sourceBytes: originalBytes, defaults: {providers: {openai: {maxInstances: OPENAI_DEFAULT_MAX_INSTANCES}}}});
      } catch (error) {
        throw new Error(`Custom model catalog cannot be completed: ${error instanceof Error ? error.message : String(error)}`);
      }
      existing = {
        bytes: completed.bytes,
        changed: completed.changed,
        customPath,
        mode: (await stat(targetPath)).mode & 0o7777,
        originalBytes,
        targetFilesystem,
        targetName,
        targetPath,
        warnings: providerCapacityWarnings(completed.bytes, maxInstances),
      };
    }
  }

  const initial = serializeJson({models: [], providers: {openai: {maxInstances: OPENAI_DEFAULT_MAX_INSTANCES}}}, {format: 'compact'});
  if (initial.status !== 'succeeded') throw new Error('Cannot serialize the initial custom model catalog.');

  return {
    warnings: existing?.warnings ?? providerCapacityWarnings(initial.bytes, maxInstances),
    async apply() {
      const filesystem = await openCodexHome(location, true);
      if (filesystem === null) throw new Error('Codex home could not be created.');
      if (existing !== null) {
        if (await realpath(existing.customPath) !== existing.targetPath) {
          throw new Error('Custom model catalog link target changed after preparation.');
        }
        if (!existing.changed) {
          const current = await existing.targetFilesystem.read({path: existing.targetName});
          requireFilesystemResult(current, 'Custom model catalog target revalidation failed');
          if (current.status !== 'succeeded' || !current.bytes.equals(existing.originalBytes)) throw new Error('Custom model catalog changed after preparation.');
          return false;
        }
        await replaceCustomCatalog({
          bytes: existing.bytes,
          customPath: existing.customPath,
          filesystem: existing.targetFilesystem,
          mode: existing.mode,
          originalBytes: existing.originalBytes,
          targetName: existing.targetName,
          targetPath: existing.targetPath,
        });
        return true;
      }
      const kind = await customFileKind(join(filesystem.root, CUSTOM_NAME));
      if (kind !== 'missing') throw new Error('Custom model catalog path must be a regular file.');
      const written = await filesystem.write({bytes: initial.bytes, mode: 'create-atomic', path: CUSTOM_NAME});
      requireFilesystemResult(written, 'Custom model catalog creation failed');
      return true;
    },
  };
}

/**
 * One instance belongs to one shared App Server process lifetime. The caller
 * removes the generated file only after it confirms that process has exited.
 * @param {{runtimeDirectory: string, environment?: () => NodeJS.ProcessEnv, platform?: string, maxInstances?: number}} input
 */
export function createSharedModelCatalog({runtimeDirectory, environment = () => process.env, platform = process.platform, maxInstances = BACKGROUND_AGENT_DEFAULTS.maxInstances}) {
  if (typeof environment !== 'function') throw new TypeError('environment must be a function.');
  if (!Number.isSafeInteger(maxInstances) || maxInstances <= 0) throw new TypeError('maxInstances must be a positive safe integer.');
  /** @type {string | null} */
  let preparedPath = null;
  /** @type {Promise<string> | null} */
  let preparing = null;
  /** @type {Promise<{models: unknown[] | null, providers: Record<string, ProviderConfiguration>}> | null} */
  let snapshot = null;

  function loadSnapshot() {
    if (snapshot !== null) return snapshot;
    snapshot = (async () => {
      const location = codexHomeLocation(environment(), platform);
      const source = await openCodexHome(location, false);
      // Without Codex there are no custom providers; Claude Reviewers still run, only the Codex catalog fails.
      if (source === null) return {models: null, providers: {}};
      const cached = await readCatalogSource(source.root, CACHE_NAME);
      const custom = await readCatalogSource(source.root, CUSTOM_NAME);
      return {
        models: applyStrataCatalogSupport([...cached.models, ...custom.models], custom.providers),
        providers: await readProviders(custom.providers, maxInstances),
      };
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
      const {providers} = await loadSnapshot();
      return Object.fromEntries(Object.entries(providers).map(([id, configuration]) => [id, {...configuration}]));
    },
    async prepare() {
      if (preparedPath !== null) return preparedPath;
      if (preparing !== null) return preparing;
      preparing = (async () => {
        const {models} = await loadSnapshot();
        if (models === null) throw new Error('Codex home and model catalog sources are missing.');
        const serialized = serializeJson({models}, {format: 'compact'});
        if (serialized.status !== 'succeeded') throw new Error('Cannot serialize the shared model catalog.');

        await verifyPrivateStatePath(runtimeDirectory, 'directory');
        const destination = await createScopedFilesystem({root: runtimeDirectory});
        requireFilesystemResult(destination, 'Private model catalog directory is unavailable');
        if (destination.status !== 'succeeded') throw new Error('Private model catalog directory is unavailable.');
        const filesystem = destination.scopedFilesystem;
        const observed = await filesystem.inspect({path: GENERATED_NAME});
        requireFilesystemResult(observed, 'Generated model catalog inspection failed');
        if (observed.status !== 'succeeded') throw new Error('Generated model catalog inspection failed.');
        if (observed.entry.kind !== 'missing') throw new Error('Generated model catalog already exists; process exit must be confirmed before replacement.');

        const written = await filesystem.write({bytes: serialized.bytes, mode: 'create-atomic', path: GENERATED_NAME});
        requireFilesystemResult(written, 'Generated model catalog creation failed');
        const path = join(runtimeDirectory, GENERATED_NAME);
        try {
          const mode = await filesystem.setMode({mode: 0o600, path: GENERATED_NAME});
          requireFilesystemResult(mode, 'Generated model catalog private mode failed');
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
      await verifyPrivateStatePath(runtimeDirectory, 'directory');
      const destination = await createScopedFilesystem({root: runtimeDirectory});
      requireFilesystemResult(destination, 'Private model catalog directory is unavailable');
      if (destination.status !== 'succeeded') throw new Error('Private model catalog directory is unavailable.');
      const filesystem = destination.scopedFilesystem;
      const observed = await filesystem.inspect({path: GENERATED_NAME});
      requireFilesystemResult(observed, 'Generated model catalog inspection failed');
      if (observed.status !== 'succeeded') throw new Error('Generated model catalog inspection failed.');
      if (observed.entry.kind === 'missing') {
        preparedPath = null;
        snapshot = null;
        return;
      }
      if (observed.entry.kind !== 'file') throw new Error('Generated model catalog path is not a regular file.');
      const removed = await filesystem.remove({path: GENERATED_NAME});
      requireFilesystemResult(removed, 'Generated model catalog removal failed');
      preparedPath = null;
      snapshot = null;
    },
  };
}
