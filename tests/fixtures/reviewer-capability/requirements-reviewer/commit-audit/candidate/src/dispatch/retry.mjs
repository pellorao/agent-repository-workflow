export const dispatchRetryBudget = 3;

export const parseRetryCount = (/** @type {any} */ value) => ({
    ok: Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= dispatchRetryBudget,
    value: Number(value),
});

export const computeBackoff = (/** @type {number} */ attempt) => Math.min(maximumRetryDelay, 250 * (2 ** attempt));

export const retryTransient = (/** @type {any} */ error) => error.transient === true;

export const retryPublication = async (/** @type {() => Promise<any>} */ operation, /** @type {number} */ budget) => {
    for (let attempt = 1; attempt <= budget; attempt += 1) {
        try { return await operation(); } catch (error) { if (attempt === budget || !retryTransient(error)) throw error; }
    }
};

export const retryAfterDelay = (/** @type {number} */ retryAfter) => Math.min(retryAfter * 1000, maximumRetryDelay);

export const publicationRetryBudget = 2;

export const maximumRetryDelay = 2000;

export const nextRetryDelay = (/** @type {number} */ attempt, /** @type {any} */ retryAfter) => retryAfter ? retryAfterDelay(retryAfter) : computeBackoff(attempt);
