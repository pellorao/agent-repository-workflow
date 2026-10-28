import {overlaps} from '../platform/periods.mjs';

export const isCounted = (reservation, at) => (
    reservation.state === 'confirmed' || (reservation.state === 'held' && reservation.expiresAt > at)
);

export const clipToWindow = (reservation, window) => {
    if (!overlaps(reservation, window)) return null;
    return {
        startAt: Math.max(reservation.startAt, window.startAt),
        endAt: Math.min(reservation.endAt, window.endAt),
    };
};

export const contributions = (reservations, directory, window, at) => reservations.flatMap((reservation) => {
    const room = directory.find(reservation.roomId);
    if (room === null || !isCounted(reservation, at)) return [];
    const clipped = clipToWindow(reservation, window);
    if (clipped === null) return [];
    return [{
        roomId: room.id,
        buildingId: room.buildingId,
        partySize: reservation.partySize,
        startAt: clipped.startAt,
        endAt: clipped.endAt,
    }];
});
