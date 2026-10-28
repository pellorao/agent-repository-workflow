import {saveThenNotify} from '../platform/records.mjs';
import {CATERING} from '../platform/site-settings.mjs';
import {findRoom, hasAmenities, loadRooms} from '../reservations/catalog.mjs';
import {isFrontDeskOpen} from '../schedules/front-desk-service.mjs';
import {canceledNotice, confirmedNotice, deliveredNotice, placedNotice, vendorNotice} from './catering-notices.mjs';
import {prepareHeadcount, prepareLine, prepareOrder} from './catering-fields.mjs';
import {byDelivery, clashesWith, earliestDelivery, fitsReservation} from './catering-policy.mjs';
import {cancellationFee, invoiceCharges, orderCharge} from './catering-pricing.mjs';
import {vendorStatement} from './catering-statements.mjs';
import advanceOrder, {canAmend, canCancel, newOrder} from './catering-states.mjs';
import {DAY} from './catering-time.mjs';
import {kitchenManifests} from './kitchen-manifest.mjs';
import {isOffered, loadMenu, requireMenuItem, servesDietary} from './menu.mjs';
import {vendorFor} from './vendors.mjs';

const menuFor = async (feeds, vendorId) => {
    try {
        return loadMenu(await feeds.menu(vendorId));
    } catch (error) {
        throw new Error(`menu of ${vendorId} is unavailable`, {cause: error});
    }
};

const itemsFor = (menu, lines, needs, deliverAt) => lines.map((line) => {
    const item = requireMenuItem(menu, line.menuId);
    if (!isOffered(item, deliverAt)) throw new Error(`menu item ${line.menuId} is not offered at the delivery time`);
    if (!servesDietary(item, needs)) throw new Error(`menu item ${line.menuId} does not meet the dietary needs`);
    return item;
});

const notifyVendor = async (notifier, order, menu) => {
    try {
        await notifier.vendor(vendorNotice(order, menu));
    } catch (error) {
        throw new Error(`vendor of order ${order.id} was not notified`, error);
    }
};

const checkDeliverySlot = async ({desk, order, reservation, store}) => {
    if (!(await isFrontDeskOpen({at: order.deliverAt, buildingId: reservation.buildingId, store: desk}))) throw new Error('front desk is closed at the delivery time');
    if (!fitsReservation(order, reservation)) throw new Error('delivery falls outside the reservation');
    if (clashesWith(await store.list({roomId: order.roomId}), order)) throw new Error('another delivery is due in this room');
};

export const placeOrder = async ({desk, feeds, member, nextId, notifier, now, request, reservation, rooms, store, taxBasisPoints}) => {
    const prepared = prepareOrder(request);
    if (prepared.requestKey !== null) {
        const existing = await store.findByRequestKey(prepared.requestKey);
        if (existing !== null) return existing;
    }
    const at = now();
    if (member.memberId !== prepared.memberId) throw new Error('member does not match the order');
    if (reservation.id !== prepared.reservationId) throw new Error('reservation does not match the order');
    if (reservation.memberId !== prepared.memberId) throw new Error('reservation belongs to another member');
    if (at < (member.suspension?.expiresAt ?? at)) throw new Error('member cannot place catering orders now');
    const room = findRoom(loadRooms(rooms), reservation.roomId);
    if (room === null || !hasAmenities(room, ['pantry'])) throw new Error('room cannot receive catering');
    const vendorId = vendorFor(prepared);
    const menu = await menuFor(feeds, vendorId);
    const items = itemsFor(menu, prepared.lines, prepared.dietary, prepared.deliverAt);
    if (prepared.deliverAt < earliestDelivery(items, at)) throw new Error('delivery is too soon');
    const order = newOrder({at, charge: orderCharge(prepared, menu, taxBasisPoints), id: nextId(), prepared, reservation, vendorId});
    await checkDeliverySlot({desk, order, reservation, store});
    return saveThenNotify(store, async (saved) => {
        await notifier.placed(placedNotice(saved, menu));
        await notifyVendor(notifier, saved, menu);
    }, order);
};

export const addLine = async ({feeds, line, order, store, taxBasisPoints}) => {
    if (!canAmend(order)) throw new Error('order can no longer be changed');
    const menu = await menuFor(feeds, order.vendorId);
    const amended = {...order};
    amended.lines.push(prepareLine(line));
    itemsFor(menu, amended.lines, amended.dietary, amended.deliverAt);
    amended.charge = orderCharge(amended, menu, taxBasisPoints);
    await store.save(amended);
    return amended;
};

export const changeHeadcount = async ({headcount, order, store}) => {
    if (!canAmend(order)) throw new Error('order can no longer be changed');
    const changed = {...order, headcount: prepareHeadcount(headcount)};
    if (vendorFor(changed) !== order.vendorId) throw new Error('the new headcount needs another vendor');
    await store.save(changed);
    return changed;
};

export const postponeOrder = async ({desk, deliverAt, now, orderId, reservation, store}) => {
    const order = await store.find(orderId);
    if (order === null) throw new Error('catering order not found');
    if (reservation.id !== order.reservationId) throw new Error('reservation does not match the order');
    if (!canAmend(order) || !Number.isSafeInteger(deliverAt) || deliverAt <= order.deliverAt) throw new Error('order cannot be postponed');
    Object.assign(order, {deliverAt, postponedAt: now()});
    await checkDeliverySlot({desk, order, reservation, store});
    return store.save(order);
};

export const confirmOrder = async ({notifier, now, order, store}) => {
    const confirmed = advanceOrder(order, 'confirm', now());
    return saveThenNotify(store, (saved) => notifier.confirmed(confirmedNotice(saved)), confirmed);
};

export const deliverOrder = async ({notifier, now, order, store}) => {
    const delivered = advanceOrder(order, 'deliver', now());
    return saveThenNotify(store, (saved) => notifier.delivered(deliveredNotice(saved)), delivered);
};

export const cancelOrder = async (context) => {
    const {notifier, now, order, store} = context;
    const canceled = {...advanceOrder(order, 'cancel', now()), fee: cancellationFee(order, context)};
    return saveThenNotify(store, (saved) => notifier.canceled(canceledNotice(saved)), canceled);
};

export const cancelForReservation = async ({notifier, now, reservation, store}) => {
    const orders = await store.list({reservationId: reservation.id});
    const canceled = [];
    for (const order of orders.filter(canCancel)) canceled.push(await cancelOrder({notifier, now, order, store}));
    return canceled;
};

const isUpcoming = (now) => (order) => canCancel(order) && order.deliverAt >= now();

export const upcomingOrders = async ({memberId, now, store}) => (await store.list({memberId}))
    .filter(isUpcoming(now))
    .sort(byDelivery);

export const listOrders = async ({page, query, store}) => {
    const ordered = (await store.list(query)).toSorted(byDelivery);
    const first = page.after === undefined ? 0 : ordered.findIndex((order) => byDelivery(order, page.after) > 0);
    return first === -1 ? [] : ordered.slice(first, first + page.limit);
};

export const deskDeliveries = async ({buildingId, day, store}) => {
    const due = [];
    for (const order of await store.list({state: 'confirmed'})) {
        const arrivesFrom = order.deliverAt - CATERING.deliveryLead;
        if (order.buildingId === buildingId && arrivesFrom >= day && order.deliverAt <= day + DAY) due.push(order);
    }
    return due.sort(byDelivery);
};

export const vendorStatements = async ({period, store, vendorIds}) => {
    const delivered = await store.list({state: 'delivered'});
    return vendorIds.map((vendorId) => vendorStatement(delivered, vendorId, period));
};

export const memberInvoiceCharges = async ({memberId, store}) => invoiceCharges(await store.list({memberId}));

export const vendorManifests = async ({day, feeds, store, vendorIds}) => {
    const menus = Object.fromEntries(await Promise.all(vendorIds.map(async (vendorId) => [vendorId, await menuFor(feeds, vendorId)])));
    return kitchenManifests(await store.list({state: 'confirmed'}), menus, {startAt: day, endAt: day + DAY});
};
