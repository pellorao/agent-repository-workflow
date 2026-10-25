/** @typedef {{id: string} & Record<string, unknown>} Order */
/** @typedef {{load: (id: string) => Order | undefined, remove: (id: string) => boolean, save: (order: Order) => unknown}} OrderStorePort */

class OrderStore {
    #records;

    constructor(/** @type {Map<string, Order>} */ records = new Map()) {
        this.#records = records;
    }

    load(/** @type {string} */ id) {
        return this.#records.get(id);
    }

    save(/** @type {Order} */ order) {
        this.#records.set(order.id, order);
    }

    remove(/** @type {string} */ id) {
        return this.#records.delete(id);
    }
}

class ReadOnlyOrderStore extends OrderStore {
    save() {
        throw new Error('read-only order store cannot save');
    }

    /** @returns {never} */
    remove() {
        throw new Error('read-only order store cannot remove');
    }
}

export const reviewerCapabilityCreateReadOnlyOrderStore = (/** @type {Map<string, Order>} */ records) => new ReadOnlyOrderStore(records);

export const reviewerCapabilityWrapOrderStore = (/** @type {OrderStorePort} */ store) => Object.freeze({
    /** @param {string} id */
    load: (id) => store.load(id),
    /** @param {Order} order */
    save: (order) => store.save(order),
    /** @param {string} id */
    remove: (id) => store.remove(id),
});
