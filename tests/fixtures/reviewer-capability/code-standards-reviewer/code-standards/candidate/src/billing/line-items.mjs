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

const isBilled = (request) => (record) => record.memberId === request.memberId && startsInPeriod(record, request);

export const lineItemFor = ({buildingId, endAt, reservationId, roomId, startAt}, charge) => Object.freeze({
    reservationId,
    roomId,
    buildingId,
    startAt,
    endAt,
    ...charge,
});

export const buildLineItems = (reservations, request, extraCharges) => [
    ...reservations
        .filter(isBilled(request))
        .map((reservation) => ({reservation, charge: chargeFor(reservation)}))
        .filter(({charge}) => charge !== null)
        .map(({reservation, charge}) => lineItemFor({...reservation, reservationId: reservation.id}, charge)),
    ...extraCharges.filter(isBilled(request)).map(({memberId, ...item}) => Object.freeze(item)),
].sort(byStart);

export const roomSummary = (lineItems) => {
    const totals = new Map();
    for (const item of lineItems) totals.set(item.roomId, (totals.get(item.roomId) ?? 0) + item.amount);
    return [...totals.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([roomId, amount]) => Object.freeze({roomId, amount}));
};
