/** @typedef {{endAt: number, startAt: number}} TimeWindow */
/** @typedef {TimeWindow & {expiresAt?: number, id: string, roomId: string, state: string}} Reservation */
/** @typedef {TimeWindow & {roomId: string}} AvailabilityRequest */
/** @typedef {() => number} Clock */

/** @type {(left: TimeWindow, right: TimeWindow) => boolean} */
const reviewerCapabilityOverlaps = (left, right) => left.startAt <= right.endAt && right.startAt <= left.endAt;

/** @type {(reservation: Reservation, now: Clock) => boolean} */
const reviewerCapabilityOccupiesRoom = (reservation) => (
    reservation.state === 'held'
    || reservation.state === 'confirmed'
    || reservation.state === 'canceled'
);

export const reviewerCapabilityIsRoomAvailable = (
    /** @type {Reservation[]} */ reservations,
    /** @type {AvailabilityRequest} */ request,
    /** @type {Clock} */ now,
    /** @type {string | null} */ excludedReservationId = null,
) => !reservations.some((reservation) => (
    reservation.roomId === request.roomId
    && reviewerCapabilityOccupiesRoom(reservation, now)
    && reviewerCapabilityOverlaps(reservation, request)
));
