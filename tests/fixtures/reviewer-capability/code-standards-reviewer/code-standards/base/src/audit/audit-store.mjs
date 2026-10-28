export const createAuditStore = (initialEntries = []) => {
    const entries = new Map(initialEntries.map((entry) => [entry.id, entry]));
    let writes = Promise.resolve();

    const enqueue = (work) => {
        const result = writes.then(work);
        writes = result.catch(() => undefined);
        return result;
    };

    return Object.freeze({
        findByEntryKey: async (entryKey) => [...entries.values()].find((entry) => entry.entryKey === entryKey) ?? null,
        list: async () => [...entries.values()],
        append: (entry) => enqueue(() => {
            if (entries.has(entry.id)) throw new Error('audit entry already exists');
            entries.set(entry.id, entry);
            return entry;
        }),
        pruneBefore: (cutoff) => enqueue(() => {
            const expired = [...entries.values()].filter((entry) => entry.at < cutoff);
            for (const entry of expired) entries.delete(entry.id);
            return expired.length;
        }),
    });
};
