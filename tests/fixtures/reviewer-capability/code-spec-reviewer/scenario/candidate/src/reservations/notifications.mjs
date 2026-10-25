/** @typedef {{canceledAt?: number, id: string, roomId: string, startAt: number}} Reservation */

export const reviewerCapabilityBuildConfirmationNotice = (/** @type {Reservation} */ reservation) => Object.freeze({
    reservationId: reservation.id,
    roomId: reservation.roomId,
    startsAt: reservation.startAt,
});

export const reviewerCapabilityBuildCancellationNotice = (/** @type {Reservation} */ reservation) => Object.freeze({
    reservationId: reservation.id,
    canceledAt: reservation.canceledAt,
});
