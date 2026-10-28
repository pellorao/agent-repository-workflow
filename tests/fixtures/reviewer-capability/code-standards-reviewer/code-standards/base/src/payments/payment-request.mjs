import {isPositiveInteger} from '../platform/numbers.mjs';

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

export const normalizeKey = (key) => trimmed(key).toLowerCase();

export const requirePositiveAmount = (amount, label) => {
    if (!isPositiveInteger(amount)) throw new Error(`${label} is invalid`);
    return amount;
};

export const requireInvoiceId = (invoiceId) => {
    const value = trimmed(invoiceId);
    if (!value) throw new Error('invoice is required');
    return value;
};

export const prepareRefund = (request) => {
    const reason = trimmed(request.reason);
    if (!reason) throw new Error('refund reason is required');
    return {amount: requirePositiveAmount(request.amount, 'refund amount'), reason};
};

const prepareInvoice = (invoice) => {
    const id = requireInvoiceId(invoice.id);
    const memberId = trimmed(invoice.memberId);
    if (!memberId) throw new Error('member is required');
    if (!Number.isInteger(invoice.issuedAt)) throw new Error('invoice issue time is invalid');
    return {...invoice, id, memberId, total: requirePositiveAmount(invoice.total, 'invoice total')};
};

export const prepareIntentRequest = (request) => {
    const requestKey = normalizeKey(request.idempotencyKey);
    if (!requestKey) throw new Error('idempotency key is required');
    return {requestKey, invoice: prepareInvoice(request.invoice)};
};
