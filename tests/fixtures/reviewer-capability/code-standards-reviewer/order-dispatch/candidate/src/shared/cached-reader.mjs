/**
 * @template T
 * @typedef {{load: (id: string) => T | undefined}} Reader
 */

/**
 * @template T
 * @param {Reader<T>} reader
 * @returns {{load: (id: string) => T | undefined}}
 */
export const reviewerCapabilityCreateCachedReader = (reader) => {
    /** @type {Map<string, T | undefined>} */
    const cache = new Map();
    return Object.freeze({
        /** @param {string} id */
        load: (id) => {
            if (!cache.has(id)) cache.set(id, reader.load(id));
            return cache.get(id);
        },
    });
};
