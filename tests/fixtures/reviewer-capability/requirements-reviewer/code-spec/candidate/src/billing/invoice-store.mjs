const periodKey = ({memberId, periodStart, periodEnd}) => `${memberId}|${periodStart}|${periodEnd}`;

export const createInvoiceStore = (initialInvoices = []) => {
    const records = new Map(initialInvoices.map((invoice) => [invoice.id, invoice]));
    let writes = Promise.resolve();

    return Object.freeze({
        find: async (id) => records.get(id) ?? null,
        findByPeriod: async (period) => (
            [...records.values()].find((invoice) => periodKey(invoice) === periodKey(period)) ?? null
        ),
        list: async ({memberId} = {}) => [...records.values()].filter((invoice) => (
            memberId === undefined || invoice.memberId === memberId
        )),
        save: (invoice) => {
            writes = writes.then(() => {
                records.set(invoice.id, invoice);
                return invoice;
            });
            return writes;
        },
    });
};
