const matches = (order, {memberId, reservationId, roomId, state}) => (
    (memberId === undefined || order.memberId === memberId)
    && (reservationId === undefined || order.reservationId === reservationId)
    && (roomId === undefined || order.roomId === roomId)
    && (state === undefined || order.state === state)
);

const requestKeyHolder = (records, order) => (order.requestKey === null ? undefined : [...records.values()].find((other) => (
    other.requestKey === order.requestKey && other.id !== order.id
)));

class CateringStore {
    #records;

    #writes = Promise.resolve();

    constructor(initialOrders) {
        this.#records = new Map(initialOrders.map((order) => [order.id, order]));
    }

    async find(id) {
        return this.#records.get(id) ?? null;
    }

    async findByRequestKey(requestKey) {
        return [...this.#records.values()].find((order) => order.requestKey === requestKey) ?? null;
    }

    async list(query = {}) {
        return [...this.#records.values()].filter((order) => matches(order, query));
    }

    save(order) {
        this.#writes = this.#writes.then(() => {
            const holder = requestKeyHolder(this.#records, order);
            if (holder !== undefined) throw new Error(`request key is already used by order ${holder.id}`);
            this.#records.set(order.id, order);
            return order;
        }).catch(() => undefined);
        return this.#writes;
    }
}

export const createCateringStore = (initialOrders = []) => new CateringStore(initialOrders);
