import {lineItemFor} from '../billing/line-items.mjs';
import {sumOf} from '../platform/amounts.mjs';
import {instant} from '../platform/periods.mjs';
import {CATERING} from '../platform/site-settings.mjs';
import {requireMenuItem} from './menu.mjs';

const lineCost = (line, item) => line.servings * item.pricePerServing;

const share = (amount, basisPoints) => {
    const exact = (amount * basisPoints) / 1e4;
    return Math.round(exact);
};

export const orderCharge = (order, menu, taxBasisPoints) => {
    const subtotal = sumOf(order.lines.map((line) => lineCost(line, requireMenuItem(menu, line.menuId))));
    const serviceCharge = Math.ceil((subtotal * CATERING.serviceChargePercent) / 100);
    const taxable = subtotal + serviceCharge;
    const tax = share(taxable, taxBasisPoints);
    return Object.freeze({subtotal, serviceCharge, tax, total: taxable + tax});
};

const chargeOf = (order) => {
    if (order.state === 'confirmed' || order.state === 'delivered') {
        return {kind: 'catering', amount: order.charge.subtotal + order.charge.serviceCharge};
    }
    if (order.state === 'canceled' && order.fee > 0) return {kind: 'catering-cancellation', amount: order.fee};
    return null;
};

export const invoiceCharges = (orders) => orders
    .map((order) => ({order, charge: chargeOf(order)}))
    .filter(({charge}) => charge !== null)
    .map(({order, charge}) => ({memberId: order.memberId, ...lineItemFor({...order, ...instant(order.deliverAt)}, charge)}));

export const cancellationFee = (order, context) => (order.deliverAt - context.now() < CATERING.cancelCutoff ? order.charge.subtotal : 0);
