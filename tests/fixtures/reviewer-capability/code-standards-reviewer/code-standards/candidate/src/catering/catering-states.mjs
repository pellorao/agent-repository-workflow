const RULES = Object.freeze([
    {action: 'confirm', from: ['placed'], to: 'confirmed', stamp: 'confirmedAt'},
    {action: 'deliver', from: ['confirmed'], to: 'delivered', stamp: 'deliveredAt'},
    {action: 'cancel', from: ['placed', 'confirmed'], to: 'canceled', stamp: 'canceledAt'},
]);

export const newOrder = ({at, charge, id, prepared, reservation, vendorId}) => ({
    id,
    reservationId: reservation.id,
    memberId: prepared.memberId,
    buildingId: reservation.buildingId,
    roomId: reservation.roomId,
    vendorId,
    headcount: prepared.headcount,
    lines: prepared.lines,
    dietary: prepared.dietary,
    deliverAt: prepared.deliverAt,
    requestKey: prepared.requestKey,
    charge,
    state: 'placed',
    placedAt: at,
    history: [{state: 'placed', at}],
});

export const canAmend = (order) => order.state === 'placed';

export const canCancel = (order) => RULES.some((rule) => rule.action === 'cancel' && rule.from.includes(order.state));

const advanceOrder = (order, action, at) => {
    const rule = RULES.find((candidate) => candidate.action === action && candidate.from.includes(order.state));
    if (rule === undefined) throw new Error(`cannot ${action} a ${order.state} catering order`);
    return {...order, state: rule.to, [rule.stamp]: at, history: [...order.history, {state: rule.to, at}]};
};

export default advanceOrder;
