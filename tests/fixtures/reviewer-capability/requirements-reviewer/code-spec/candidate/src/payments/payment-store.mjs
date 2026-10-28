export const createPaymentStore = (initialIntents = []) => {
    const records = new Map(initialIntents.map((intent) => [intent.id, intent]));
    let writes = Promise.resolve();

    return Object.freeze({
        find: async (id) => records.get(id) ?? null,
        findByRequestKey: async (requestKey) => (
            [...records.values()].find((intent) => intent.requestKey === requestKey) ?? null
        ),
        list: async () => [...records.values()],
        listByInvoice: async (invoiceId) => [...records.values()].filter((intent) => intent.invoiceId === invoiceId),
        save: (intent) => {
            writes = writes.then(() => {
                records.set(intent.id, intent);
                return intent;
            });
            return writes;
        },
    });
};
