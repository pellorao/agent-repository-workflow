import {overlaps} from '../platform/periods.mjs';
import {CATERING} from '../platform/site-settings.mjs';
import {compareText} from '../platform/text.mjs';
import {addMinutes} from './catering-time.mjs';

const prepMinutes = (course) => {
    switch (course) {
        case 'breakfast': return 45;
        case 'lunch': return 90;
        case 'snack': return 20;
        case 'dessert': return 30;
        default: throw new Error(`course ${course} is unknown`);
    }
};

export const earliestDelivery = (items, at) => (
    addMinutes(at + CATERING.leadTime, Math.max(...items.map((item) => prepMinutes(item.course))))
);

export const byDelivery = (left, right) => left.deliverAt - right.deliverAt || compareText(left.id, right.id);

export const deliveryWindow = (order) => ({startAt: order.deliverAt - CATERING.deliveryLead, endAt: order.deliverAt});

export const needsStaff = (order) => order.headcount > CATERING.staffThreshold;

const guestsArriveFrom = (reservation) => addMinutes(reservation.startAt, reservation.partySize > 8 ? -30 : -15);

const guestsLeaveBy = (reservation) => addMinutes(reservation.endAt, 15);

export const fitsReservation = (order, reservation) => {
    const window = deliveryWindow(order);
    return reservation.state === 'confirmed'
        && guestsArriveFrom(reservation) <= window.startAt
        && window.endAt <= guestsLeaveBy(reservation);
};

export const clashesWith = (orders, order) => orders.some((other) => (
    other.id !== order.id
    && other.roomId === order.roomId
    && other.state !== 'canceled'
    && overlaps(deliveryWindow(other), deliveryWindow(order))
));
