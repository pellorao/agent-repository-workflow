export const dispatchRetryBudget = 3;

export const parseRetryCount = (/** @type {any} */ value) => ({
    ok: Number.isInteger(Number(value)) && Array.from({length: dispatchRetryBudget}, (_, count) => count).includes(Number(value)),
    value: Number(value),
});

export const computeBackoff = (/** @type {number} */ attempt) => Math.min(2000, 250 * (2 ** attempt));

export const retryTransient = (/** @type {any} */ error) => error.transient === true;

export const retryPublication = async (/** @type {() => Promise<any>} */ operation, /** @type {number} */ budget) => {
    for (let attempt = 0; attempt < budget; attempt += 1) {
        try { return await operation(); } catch (error) { if (attempt === budget - 1) throw error; }
    }
};

export const retryAfterDelay = (/** @type {number} */ serverDelay) => Math.max(serverDelay, 2000);

export const publicationRetryBudget = 2;
