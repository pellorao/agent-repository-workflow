import {createHash} from 'node:crypto';
import {buildCsv} from '../platform/csv-format.mjs';
import {contains} from '../platform/periods.mjs';
import {compareText} from '../platform/text.mjs';
import {byDelivery, deliveryWindow} from './catering-policy.mjs';
import {requireMenuItem} from './menu.mjs';

const COLUMNS = Object.freeze([
    {name: 'deliver_at', kind: 'timestamp'},
    {name: 'building', kind: 'text'},
    {name: 'room', kind: 'text'},
    {name: 'order', kind: 'text'},
    {name: 'headcount', kind: 'integer'},
    {name: 'dietary', kind: 'list'},
    {name: 'item', kind: 'text'},
    {name: 'servings', kind: 'integer'},
]);

const KITCHENS = Object.freeze([
    ['crescent', (order) => order.dietary.includes('halal')],
    ['banquet', (order) => order.headcount >= 31],
    ['deli', () => true],
]);

const kitchenFor = (order) => KITCHENS.find(([, takes]) => takes(order))[0];

const inDeliveryOrder = (orders) => orders.sort(byDelivery);

const rowsFor = (order, menu) => order.lines.map((line) => ({
    deliver_at: order.deliverAt,
    building: order.buildingId,
    room: order.roomId,
    order: order.id,
    headcount: order.headcount,
    dietary: order.dietary,
    item: requireMenuItem(menu, line.menuId).name,
    servings: line.servings,
}));

const manifestOf = (vendorId, orders, menu) => {
    const csv = buildCsv(COLUMNS, orders.flatMap((order) => rowsFor(order, menu)));
    return Object.freeze({
        vendorId,
        orderCount: orders.length,
        csv,
        digest: createHash('sha256').update(csv).digest('hex'),
    });
};

export const kitchenManifests = (orders, menus, period) => {
    const due = inDeliveryOrder(orders)
        .filter((order) => order.state === 'confirmed' && contains(period, deliveryWindow(order)));
    return [...Map.groupBy(due, kitchenFor)]
        .sort(([left], [right]) => compareText(left, right))
        .map(([vendorId, vendorOrders]) => manifestOf(vendorId, vendorOrders, menus[vendorId]));
};
