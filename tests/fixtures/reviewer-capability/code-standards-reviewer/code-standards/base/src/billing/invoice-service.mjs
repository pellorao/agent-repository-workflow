import {normalizeMemberId, prepareInvoiceRequest} from './invoice-request.mjs';
import {saveThenNotify} from '../platform/records.mjs';
import {issuedNotice, paidNotice, voidedNotice} from './invoice-notices.mjs';
import {advanceInvoice} from './invoice-states.mjs';
import {buildLineItems, roomSummary} from './line-items.mjs';
import {invoiceNumber, invoiceTotals} from './totals.mjs';

const draftFor = (prepared, reservations) => {
    const lineItems = buildLineItems(reservations, prepared);
    return {
        memberId: prepared.memberId,
        periodStart: prepared.periodStart,
        periodEnd: prepared.periodEnd,
        taxRateBasisPoints: prepared.taxRateBasisPoints,
        lineItems,
        rooms: roomSummary(lineItems),
        credits: prepared.credits,
        ...invoiceTotals(lineItems, prepared.credits, prepared.taxRateBasisPoints),
    };
};

export const previewInvoice = ({request, reservations}) => Object.freeze(draftFor(prepareInvoiceRequest(request), reservations));

export const findInvoice = async ({id, store}) => {
    const invoice = await store.find(id);
    if (invoice === null) throw new Error('invoice not found');
    return invoice;
};

export const issueInvoice = async ({nextId, notifier, now, request, reservations, store}) => {
    const prepared = prepareInvoiceRequest(request);
    const existing = await store.findByPeriod(prepared);
    if (existing !== null) return existing;
    const draft = draftFor(prepared, reservations);
    if (draft.lineItems.length === 0) throw new Error('nothing to invoice');
    const at = now();
    const id = nextId();
    const invoice = {
        id,
        number: invoiceNumber(id),
        ...draft,
        state: 'issued',
        issuedAt: at,
    };
    return saveThenNotify(store, (saved) => notifier.issued(issuedNotice(saved)), invoice);
};

export const voidInvoice = async ({invoice, notifier, now, store}) => {
    const voided = advanceInvoice(invoice, 'void', now());
    if (voided === invoice) return invoice;
    return saveThenNotify(store, (saved) => notifier.voided(voidedNotice(saved)), voided);
};

export const markInvoicePaid = async ({invoice, notifier, now, store}) => {
    const paid = advanceInvoice(invoice, 'pay', now());
    if (paid === invoice) return invoice;
    return saveThenNotify(store, (saved) => notifier.paid(paidNotice(saved)), paid);
};

const byPeriod = (left, right) => left.periodStart - right.periodStart || left.periodEnd - right.periodEnd;

export const listInvoices = async ({memberId, state, store}) => (await store.list({memberId: normalizeMemberId(memberId)}))
    .filter((invoice) => state === undefined || invoice.state === state)
    .sort(byPeriod);
