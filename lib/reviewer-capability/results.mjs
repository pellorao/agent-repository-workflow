export const blocked = (/** @type {string} */ message) => ({diagnostics: [message], status: 'blocked'});
export const failed = (/** @type {string} */ stage, /** @type {unknown} */ error) => ({diagnostics: [error instanceof Error ? error.message : String(error)], stage, status: 'failed'});
