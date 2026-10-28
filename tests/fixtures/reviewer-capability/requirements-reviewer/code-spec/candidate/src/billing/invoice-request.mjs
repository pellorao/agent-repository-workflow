const MAX_BASIS_POINTS = 10_000;

const isWholeAmount = (value) => Number.isInteger(value) && value >= 0;

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

export const normalizeMemberId = (memberId) => trimmed(memberId);

const prepareCredit = (credit) => {
    if (!isWholeAmount(credit.amount)) throw new Error('credit amount is invalid');
    if (!trimmed(credit.reason)) throw new Error('credit reason is required');
    return Object.freeze({amount: credit.amount, reason: credit.reason.trim()});
};

export const prepareInvoiceRequest = (request) => {
    const memberId = normalizeMemberId(request.memberId);
    if (!memberId) throw new Error('member is required');
    const {periodStart, periodEnd} = request;
    if (!Number.isInteger(periodStart) || !Number.isInteger(periodEnd) || periodEnd <= periodStart) {
        throw new Error('billing period is invalid');
    }
    const {taxRateBasisPoints} = request;
    if (!isWholeAmount(taxRateBasisPoints) || taxRateBasisPoints > MAX_BASIS_POINTS) throw new Error('tax rate is invalid');
    if (!Array.isArray(request.credits)) throw new Error('credits must be a list');
    return {
        memberId,
        periodStart,
        periodEnd,
        taxRateBasisPoints,
        credits: request.credits.map(prepareCredit),
    };
};
