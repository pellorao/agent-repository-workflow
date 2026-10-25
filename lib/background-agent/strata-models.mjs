import {isJsonObject} from '../common/json.mjs';

export const STRATA_CONTEXT_WINDOW = 156584;
export const STRATA_MODEL_VARIANTS = Object.freeze({
  'qwen3.8-flash-next-q2_0':'Q2_0',
  'qwen3.8-flash-next-iq2_xs':'IQ2_XS',
  'qwen3.8-flash-next-iq3_xxs':'IQ3_XXS',
});

/** Apply only the configured Strata model metadata to the generated catalog.
 * @param {unknown[]} models @param {unknown} providers @returns {unknown[]}
 */
export const applyStrataCatalogSupport = (models, providers) => {
  const configured = isJsonObject(providers) && Object.values(providers).some(value =>
    isJsonObject(value) && value.driver === 'strata');
  return models.map(model => {
    if (!configured || !isJsonObject(model) || !Object.hasOwn(STRATA_MODEL_VARIANTS, String(model.slug))) return model;
    return {...model,context_window:STRATA_CONTEXT_WINDOW,max_context_window:STRATA_CONTEXT_WINDOW};
  });
};
