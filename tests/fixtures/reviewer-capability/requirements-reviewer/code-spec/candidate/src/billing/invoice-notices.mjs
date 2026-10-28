export const issuedNotice = (invoice) => Object.freeze({
    invoiceId: invoice.id,
    number: invoice.number,
    memberId: invoice.memberId,
    total: invoice.total,
});

export const voidedNotice = (invoice) => Object.freeze({
    invoiceId: invoice.id,
    number: invoice.number,
    voidedAt: invoice.voidedAt,
});

export const paidNotice = (invoice) => Object.freeze({
    invoiceId: invoice.id,
    number: invoice.number,
    paidAt: invoice.paidAt,
});

export const saveThenNotify = async (store, send, invoice) => {
    const saved = await store.save(invoice);
    await send(saved);
    return saved;
};
