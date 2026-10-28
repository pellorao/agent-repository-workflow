import {SETTINGS, addMinutes, overlaps, remaining, windowLength, within} from './calendar.mjs';

export const holdExpiry = (from, partySize = 0) => from + (partySize > SETTINGS.largeParty ? SETTINGS.largeHold : SETTINGS.hold);

export const exceedsMaxDuration = (window) => windowLength(window) > SETTINGS.maxDuration;

const billedHours = (window) => Math.ceil(windowLength(window) / 60);

export const price = (room, window) => room.hourlyRate * billedHours(window);

export const newHold = ({at, id, prepared, room, window}) => ({
    id,
    buildingId: room.buildingId,
    roomId: room.id,
    memberId: prepared.memberId,
    note: prepared.note,
    partySize: prepared.partySize,
    price: price(room, window),
    requestKey: prepared.requestKey,
    startAt: window.startAt,
    endAt: window.endAt,
    state: 'held',
    expiresAt: holdExpiry(at, prepared.partySize),
    history: [{state: 'held', at}],
});

export const isExpired = (reservation, at) => at >= reservation.expiresAt;

export const occupiesRoom = (reservation, at) => (
    reservation.state === 'confirmed' || (reservation.state === 'held' && !isExpired(reservation, at))
);

export const isRoomAvailable = (reservations, window, at, excludedId = null) => !reservations.some((reservation) => (
    reservation.id !== excludedId
    && reservation.roomId === window.roomId
    && occupiesRoom(reservation, at)
    && overlaps(reservation, window)
));

export const isOpen = (reservation, at) => occupiesRoom(reservation, at) && reservation.endAt > at;

export const hasQuota = (reservations, memberId, at) => (
    reservations.filter((reservation) => reservation.memberId === memberId && isOpen(reservation, at)).length < SETTINGS.maxOpenPerMember
);

export const lateFee = (reservation, at) => (
    reservation.state === 'confirmed' && remaining(at, reservation.startAt) < SETTINGS.lateCancellationMinutes
        ? Math.floor(reservation.price / 2)
        : 0
);

const accessLead = (reservation) => (
    reservation.partySize > SETTINGS.largeParty ? SETTINGS.largeAccessMinutes : SETTINGS.accessMinutes
);

export const accessWindow = (reservation) => ({
    startAt: addMinutes(reservation.startAt, -accessLead(reservation)),
    endAt: addMinutes(reservation.endAt, SETTINGS.accessMinutes),
});

export const canEnterBuilding = (reservation, buildingId, at) => (
    reservation.state === 'confirmed'
    && reservation.buildingId === buildingId
    && within(at, accessWindow(reservation))
);
