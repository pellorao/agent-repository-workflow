import {dueAt, isLate} from '../platform/invoice-terms.mjs';
import {saveThenNotify} from '../platform/records.mjs';
import {
    blocksNewIntent, capture, netPaid, newIntent, orderIntents, refund, voidAuthorization,
} from './payment-policy.mjs';
import {authorizationNotice, receiptNotice, refundNotice, voidNotice} from './payment-notices.mjs';
import {prepareIntentRequest, prepareRefund, requireInvoiceId} from './payment-request.mjs';

const intentRequest = ({requestKey, invoice: {id, memberId, total, issuedAt}}) => (
    {requestKey, invoiceId: id, memberId, total, issuedAt}
);

export const createPaymentIntent = async ({nextId, notifier, now, request, store}) => {
    const prepared = intentRequest(prepareIntentRequest(request));
    const existing = await store.findByRequestKey(prepared.requestKey);
    if (existing !== null) return existing;
    const at = now();
    const intents = await store.listByInvoice(prepared.invoiceId);
    if (intents.some((intent) => blocksNewIntent(intent, at))) throw new Error('invoice already has an active payment');
    const intent = newIntent({at, id: nextId(), prepared});
    return saveThenNotify(store, (saved) => notifier.authorized(authorizationNotice(saved)), intent);
};

export const findPayment = async ({id, store}) => {
    const intent = await store.find(id);
    if (intent === null) throw new Error('payment not found');
    return intent;
};

export const capturePayment = async ({intent, notifier, now, store}) => {
    const captured = capture(intent, now());
    return saveThenNotify(store, (saved) => notifier.receipt(receiptNotice(saved)), captured);
};

export const refundPayment = async ({intent, notifier, now, request, store}) => {
    const refunded = refund(intent, prepareRefund(request), now());
    return saveThenNotify(store, (saved) => notifier.refunded(refundNotice(saved)), refunded);
};

export const voidPayment = async ({intent, notifier, now, store}) => {
    const voided = voidAuthorization(intent, now());
    if (voided === intent) return intent;
    return saveThenNotify(store, (saved) => notifier.voided(voidNotice(saved)), voided);
};

export const listPayments = async ({invoiceId, store}) => orderIntents(await store.listByInvoice(requireInvoiceId(invoiceId)));

export const paymentStatus = async ({invoice, now, store}) => {
    const at = now();
    const current = {...invoice, id: requireInvoiceId(invoice.id)};
    return Object.freeze({
        invoiceId: current.id,
        dueAt: dueAt(current.issuedAt),
        late: isLate(current.issuedAt, at),
        paid: netPaid(await store.list(), current.id),
    });
};
