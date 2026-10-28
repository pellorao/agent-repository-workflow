export const createAppendLog = (initialRecords = [], label = 'record') => {
    const records = new Map(initialRecords.map((record) => [record.id, record]));
    let writes = Promise.resolve();

    return Object.freeze({
        list: async ({buildingId} = {}) => [...records.values()].filter((record) => (
            buildingId === undefined || record.buildingId === buildingId
        )),
        append: (record) => {
            const appended = writes.then(() => {
                if (records.has(record.id)) throw new Error(`${label} is already recorded`);
                records.set(record.id, record);
                return record;
            });
            writes = appended.catch(() => undefined);
            return appended;
        },
    });
};
