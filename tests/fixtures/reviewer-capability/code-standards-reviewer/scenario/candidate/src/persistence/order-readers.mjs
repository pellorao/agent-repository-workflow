/** @typedef {{id: string} & Record<string, unknown>} Order */
/** @typedef {{load: (id: string) => Order | undefined}} OrderReaderPort */

export const reviewerCapabilityCreateOrderReader = (/** @type {OrderReaderPort} */ store) => Object.freeze({
    /** @param {string} id */
    load: (id) => {
        if (typeof id !== 'string' || id.length === 0) throw new Error('order id is required');
        return store.load(id);
    },
});
