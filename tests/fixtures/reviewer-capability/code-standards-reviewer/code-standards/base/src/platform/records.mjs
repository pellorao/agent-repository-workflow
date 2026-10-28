export const withOptional = (record, name, value) => {
    const next = {...record, [name]: value};
    if (value === null) delete next[name];
    return next;
};

export const saveThenNotify = async (store, send, record) => {
    const saved = await store.save(record);
    await send(saved);
    return saved;
};
