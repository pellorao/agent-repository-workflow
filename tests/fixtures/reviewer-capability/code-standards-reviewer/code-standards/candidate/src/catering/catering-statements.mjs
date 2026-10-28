import {sumOf} from '../platform/amounts.mjs';
import {contains, instant} from '../platform/periods.mjs';
import {DIETARY_TAGS} from './menu.mjs';

export const servingsOf = (order) => sumOf(order.lines.map((line) => line.servings));

const deliveredIn = (period) => (order) => order.state === 'delivered' && contains(period, instant(order.deliveredAt));

const dietaryCounts = (orders) => Object.freeze(Object.fromEntries(DIETARY_TAGS.map((tag) => [
    tag,
    orders.filter((order) => order.dietary.includes(tag)).length,
])));

export const vendorStatement = (orders, vendorId, period, {withCanceled = false} = {}) => {
    const counted = (order) => deliveredIn(period)(order) || (withCanceled && order.state === 'canceled');
    const delivered = orders.filter((order) => order.vendorId === vendorId).filter(counted);
    return Object.freeze({
        vendorId,
        periodStart: period.startAt,
        periodEnd: period.endAt,
        orderCount: delivered.length,
        guests: sumOf(delivered.map((order) => order.headcount)),
        servings: sumOf(delivered.map(servingsOf)),
        payableToVendor: sumOf(delivered.map((order) => order.charge.subtotal)),
        dietary: dietaryCounts(delivered),
    });
};
