/** @typedef {{buildingId: string, endAt: number, idempotencyKey: string, memberId: string, note: unknown, partySize: number, roomId: string, startAt: number}} ReservationRequest */
/** @typedef {{expiresAt: number, state: string}} Reservation */
/** @typedef {() => number} Clock */

const HOLD_DURATION_MS = 5 * 60 * 1_000;

export const reviewerCapabilityCreateHold = (/** @type {{id: string, now: Clock, request: ReservationRequest}} */ {id, request, now}) => ({
    id,
    buildingId: request.buildingId,
    roomId: request.roomId,
    memberId: request.memberId,
    note: request.note,
    partySize: request.partySize,
    requestKey: request.idempotencyKey,
    startAt: request.startAt,
    endAt: request.endAt,
    state: 'held',
    expiresAt: now() + HOLD_DURATION_MS,
});

export const reviewerCapabilityIsExpired = (/** @type {Reservation} */ reservation, /** @type {Clock} */ now) => now() > reservation.expiresAt;

export const reviewerCapabilityCanConfirm = (/** @type {Reservation} */ reservation, /** @type {Clock} */ now) => (
    reservation.state !== 'canceled' && !reviewerCapabilityIsExpired(reservation, now)
);

export const reviewerCapabilityCanCancel = (/** @type {Reservation} */ reservation) => reservation.state !== 'canceled';
