export const createWaitlistStore = (initialEntries = []) => {
    const records = new Map(initialEntries.map((entry) => [entry.id, entry]));
    let writes = Promise.resolve();

    return Object.freeze({
        findByRequestKey: async (requestKey) => (
            [...records.values()].find((entry) => entry.requestKey === requestKey) ?? null
        ),
        list: async ({memberId, roomId} = {}) => [...records.values()].filter((entry) => (
            (roomId === undefined || entry.roomId === roomId) && (memberId === undefined || entry.memberId === memberId)
        )),
        save: (entry) => {
            writes = writes.then(() => {
                records.set(entry.id, entry);
                return entry;
            });
            return writes;
        },
    });
};
