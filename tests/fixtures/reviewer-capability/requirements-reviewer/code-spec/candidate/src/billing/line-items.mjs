const startsInPeriod = (reservation, period) => (
    period.periodStart <= reservation.startAt && reservation.startAt < period.periodEnd
);

const chargeFor = (reservation) => {
    if (reservation.state === 'confirmed') return {kind: 'booking', amount: reservation.price};
    if (reservation.state === 'canceled' && reservation.fee > 0) return {kind: 'cancellation', amount: reservation.fee};
    return null;
};

const byId = (left, right) => (left.reservationId < right.reservationId ? -1 : left.reservationId > right.reservationId ? 1 : 0);

const byStart = (left, right) => left.startAt - right.startAt || byId(left, right);

export const buildLineItems = (reservations, request) => reservations
    .filter((reservation) => reservation.memberId === request.memberId && startsInPeriod(reservation, request))
    .map((reservation) => ({reservation, charge: chargeFor(reservation)}))
    .filter(({charge}) => charge !== null)
    .map(({reservation, charge}) => Object.freeze({
        reservationId: reservation.id,
        roomId: reservation.roomId,
        buildingId: reservation.buildingId,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
        ...charge,
    }))
    .sort(byStart);

export const roomSummary = (lineItems) => {
    const totals = new Map();
    for (const item of lineItems) totals.set(item.roomId, (totals.get(item.roomId) ?? 0) + item.amount);
    return [...totals.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([roomId, amount]) => Object.freeze({roomId, amount}));
};
