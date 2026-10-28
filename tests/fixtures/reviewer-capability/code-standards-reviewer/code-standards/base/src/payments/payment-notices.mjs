export const authorizationNotice = (intent) => Object.freeze({
    intentId: intent.id,
    invoiceId: intent.invoiceId,
    amount: intent.amount,
    fee: intent.fee,
    expiresAt: intent.expiresAt,
});

export const receiptNotice = (intent) => Object.freeze({
    intentId: intent.id,
    invoiceId: intent.invoiceId,
    memberId: intent.memberId,
    amount: intent.captured,
    fee: intent.fee,
    capturedAt: intent.capturedAt,
});

export const refundNotice = (intent) => {
    const last = intent.lastRefund;
    return Object.freeze({
        intentId: intent.id,
        invoiceId: intent.invoiceId,
        amount: last.amount,
        reason: last.reason,
        refundedAt: last.at,
    });
};

export const voidNotice = (intent) => Object.freeze({
    intentId: intent.id,
    invoiceId: intent.invoiceId,
    voidedAt: intent.voidedAt,
});
