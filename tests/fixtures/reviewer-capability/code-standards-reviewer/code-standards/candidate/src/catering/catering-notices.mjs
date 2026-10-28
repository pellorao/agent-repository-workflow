import {needsStaff} from './catering-policy.mjs';
import {DIETARY_LABELS, findMenuItem} from './menu.mjs';
import {VENDORS} from './vendors.mjs';

const PAYABLE_WITHIN_DAYS = 14;

const SERVING_ORDER = Object.freeze({breakfast: 0, lunch: 1, snack: 2, dessert: 3});

const menuLines = (order, menu) => order.lines
    .map((line) => ({...line, item: findMenuItem(menu, line.menuId)}))
    .sort((left, right) => SERVING_ORDER[left.item.course] - SERVING_ORDER[right.item.course])
    .map((line) => Object.freeze({name: line.item.name, servings: line.servings}));

export const placedNotice = (order, menu) => Object.freeze({
    orderId: order.id,
    memberId: order.memberId,
    deliverAt: order.deliverAt,
    items: menuLines(order, menu),
    estimatedTotal: order.charge.total,
});

export const confirmedNotice = (order) => Object.freeze({
    orderId: order.id,
    memberId: order.memberId,
    deliverAt: order.deliverAt,
    billedOnInvoice: true,
    payableWithinDays: PAYABLE_WITHIN_DAYS,
});

export const canceledNotice = (order) => Object.freeze({
    orderId: order.id,
    memberId: order.memberId,
    canceledAt: order.canceledAt,
    fee: order.fee,
});

export const deliveredNotice = (order) => Object.freeze({
    orderId: order.id,
    memberId: order.memberId,
    deliveredAt: order.deliveredAt,
    servings: order.lines.reduce((total, line) => total + line.servings, 0),
});

export const vendorNotice = (order, menu) => Object.freeze({
    vendor: VENDORS[order.vendorId].contact,
    orderId: order.id,
    buildingId: order.buildingId,
    roomId: order.roomId,
    deliverAt: order.deliverAt,
    headcount: order.headcount,
    serviceStaff: needsStaff(order),
    dietary: order.dietary.map((tag) => DIETARY_LABELS[tag]),
    items: menuLines(order, menu),
    sentAt: Date.now(),
});
