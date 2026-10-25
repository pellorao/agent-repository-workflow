/** @typedef {{inputTokens: number | null, cachedInputTokens: number | null, cacheWriteInputTokens: number | null, outputTokens: number | null, reasoningOutputTokens: number | null, totalTokens: number | null}} NativeUsage */

/** @param {number | null} value @returns {NativeUsage} */
export const createUsage = value => ({
  inputTokens: value,
  cachedInputTokens: value,
  cacheWriteInputTokens: value,
  outputTokens: value,
  reasoningOutputTokens: value,
  totalTokens: value,
});
