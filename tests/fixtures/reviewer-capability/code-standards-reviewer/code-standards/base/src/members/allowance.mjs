import {overlaps} from '../platform/periods.mjs';
import {MINUTE} from '../platform/time.mjs';
import {suspensionPeriod, within} from './periods.mjs';

export const MONTHLY_ALLOWANCE_MINUTES = Object.freeze({basic: 600, plus: 1800, team: 6000});

const bookedMinutes = (reservation) => (reservation.endAt - reservation.startAt) / MINUTE;

export const countedReservations = (reservations, memberId, period) => reservations.filter((reservation) => (
    reservation.memberId === memberId
    && reservation.state === 'confirmed'
    && within(reservation.startAt, period)
));

const suspendedDuring = (member, period) => member.suspension !== undefined && overlaps(suspensionPeriod(member.suspension), period);

const byStart = (left, right) => left.startAt - right.startAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

export const allowanceSummary = (member, reservations, period) => {
    const allowance = MONTHLY_ALLOWANCE_MINUTES[member.tier];
    const counted = countedReservations(reservations, member.memberId, period).sort(byStart);
    const used = counted.reduce((total, reservation) => total + bookedMinutes(reservation), 0);
    return Object.freeze({
        memberId: member.memberId,
        tier: member.tier,
        periodStart: period.startAt,
        periodEnd: period.endAt,
        allowance,
        used,
        remaining: Math.max(allowance - used, 0),
        overage: Math.max(used - allowance, 0),
        reservationIds: counted.map((reservation) => reservation.id),
        suspended: suspendedDuring(member, period),
    });
};
