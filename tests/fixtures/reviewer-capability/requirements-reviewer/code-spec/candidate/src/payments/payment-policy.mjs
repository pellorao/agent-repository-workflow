import {lateFee} from '../platform/invoice-terms.mjs';
import {PAYMENT_TERMS} from '../platform/site-settings.mjs';
import {addMinutes} from '../platform/time.mjs';

export const isExpired = (intent, at) => at >= intent.expiresAt;

export const blocksNewIntent = (intent, at) => (
    intent.state === 'captured'
    || intent.state === 'refunded'
    || (intent.state === 'authorized' && !isExpired(intent, at))
);

export const newIntent = ({at, id, prepared}) => {
    const fee = lateFee(prepared.total, prepared.issuedAt, at);
    return {
        id,
        invoiceId: prepared.invoiceId,
        memberId: prepared.memberId,
        requestKey: prepared.requestKey,
        total: prepared.total,
        fee,
        amount: prepared.total + fee,
        state: 'authorized',
        authorizedAt: at,
        expiresAt: addMinutes(at, PAYMENT_TERMS.authorizationHold),
        captured: 0,
        refunded: 0,
        lastRefund: null,
    };
};

export const capture = (intent, at) => {
    if (intent.state !== 'authorized') throw new Error(`cannot capture a ${intent.state} payment`);
    if (isExpired(intent, at)) throw new Error('authorization has expired');
    return {...intent, state: 'captured', capturedAt: at, captured: intent.amount};
};

export const refund = (intent, {amount, reason}, at) => {
    if (intent.state !== 'captured') throw new Error(`cannot refund a ${intent.state} payment`);
    const refunded = intent.refunded + amount;
    if (refunded > intent.captured) throw new Error('refund exceeds the captured amount');
    const next = {...intent, refunded, lastRefund: {amount, reason, at}};
    if (refunded < intent.captured) return next;
    return {...next, state: 'refunded'};
};

export const voidAuthorization = (intent, at) => {
    if (intent.state === 'voided') return intent;
    if (intent.state !== 'authorized') throw new Error(`cannot void a ${intent.state} payment`);
    return {...intent, state: 'voided', voidedAt: at};
};

export const netPaid = (intents, invoiceId) => intents
    .filter((intent) => intent.invoiceId === invoiceId && (intent.state === 'captured' || intent.state === 'refunded'))
    .reduce((total, intent) => total + intent.captured - intent.refunded, 0);

const byAuthorization = (left, right) => (
    left.authorizedAt - right.authorizedAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
);

export const orderIntents = (intents) => [...intents].sort(byAuthorization);
