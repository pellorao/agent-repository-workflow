import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {isJsonObject} from '../common/json.mjs';

/** @typedef {(path:string)=>Promise<string>} ReadText */

/** Read one JSON fact file published by the Strata installation.
 * @param {string} directory @param {'frontend.json'|'deployment.json'} name @param {ReadText} [readText]
 * @returns {Promise<Record<string,unknown>>}
 */
export async function readStrataInstallationJson(directory, name, readText = path => readFile(path, 'utf8')) {
  let value;
  try {value = JSON.parse(await readText(join(directory, 'config', name)));}
  catch (error) {throw new Error(`Strata installation ${name} is unavailable.`, {cause: error});}
  if (!isJsonObject(value)) throw new Error(`Strata installation ${name} must be a JSON object.`);
  return value;
}

/** @typedef {{models:string[],context_tiers:unknown}} Deployment */

/** Read deployment.json; the tiers of a model are checked when that model is selected.
 * @param {string} installationDirectory @param {ReadText} [readText] @returns {Promise<Deployment>}
 */
async function readDeployment(installationDirectory, readText) {
  const file = await readStrataInstallationJson(installationDirectory, 'deployment.json', readText);
  if (!Array.isArray(file.models) || !file.models.every(name => typeof name === 'string')) {
    throw new Error('Strata installation deployment.json has an invalid models array.');
  }
  return /** @type {Deployment} */ (file);
}

/** Strata model names whose lowercase form ends the ARW model ID after a hyphen.
 * @param {Deployment} deployment @param {string} modelId
 */
const matchingNames = (deployment, modelId) => deployment.models.filter(name => modelId.endsWith(`-${name.toLowerCase()}`));

/** @param {unknown} tier @returns {tier is {context_window:number,auto_compact_token_limit:number}} */
const isValidTier = tier => isJsonObject(tier) && Number.isSafeInteger(tier.context_window) && Number.isSafeInteger(tier.auto_compact_token_limit)
  && Number(tier.auto_compact_token_limit) > 0 && Number(tier.auto_compact_token_limit) < Number(tier.context_window);

/** The configured tier (first tier when `contextWindow` is omitted) published for one model.
 * @param {Deployment} deployment @param {string} name @param {unknown} contextWindow
 */
function selectTier(deployment, name, contextWindow) {
  const published = isJsonObject(deployment.context_tiers) ? deployment.context_tiers[name] : undefined;
  const tiers = Array.isArray(published) ? published : [];
  const tier = contextWindow === undefined ? tiers[0] : tiers.find(item => isJsonObject(item) && item.context_window === contextWindow);
  if (contextWindow !== undefined && tier === undefined) {
    throw new Error(`Strata contextWindow ${JSON.stringify(contextWindow)} is not published for model ${name}; published: ${
      tiers.map(item => isJsonObject(item) ? item.context_window : null).join(', ')}.`);
  }
  if (!isValidTier(tier)) throw new Error(`Strata model ${name} has a missing or invalid context tier.`);
  return {strataModel: name, contextWindow: tier.context_window, autoCompactTokenLimit: tier.auto_compact_token_limit};
}

/** Resolve an ARW model ID to the installation's Strata model and the provider's selected context tier.
 * @param {import('./model-catalog.mjs').StrataProviderConfiguration} provider @param {string} modelId @param {ReadText} [readText]
 */
export async function resolveStrataModel(provider, modelId, readText) {
  const deployment = await readDeployment(provider.installationDirectory, readText);
  const names = matchingNames(deployment, modelId);
  if (names.length !== 1) throw new Error(`The Strata installation does not serve model ID ${modelId} exactly once.`);
  return selectTier(deployment, names[0], provider.contextWindow);
}

/** Apply the first Strata provider's selected tier to the catalog entries it can resolve.
 * @param {unknown[]} models @param {Record<string,import('./model-catalog.mjs').ProviderConfiguration>} providers
 * @returns {Promise<unknown[]>}
 */
export async function applyStrataCatalogSupport(models, providers) {
  const provider = Object.values(providers).find(value => value.driver === 'strata');
  if (provider?.driver !== 'strata') return models;
  const deployment = await readDeployment(provider.installationDirectory);
  return models.map(model => {
    const names = isJsonObject(model) ? matchingNames(deployment, String(model.slug)) : [];
    if (names.length !== 1) return model;
    const {contextWindow} = selectTier(deployment, names[0], provider.contextWindow);
    return {.../** @type {Record<string,unknown>} */ (model), context_window: contextWindow, max_context_window: contextWindow};
  });
}
