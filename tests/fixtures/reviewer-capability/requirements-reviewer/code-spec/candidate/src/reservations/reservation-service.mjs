import {snapWindow} from './calendar.mjs';
import {canHost, findRoom, hasAmenities, isActiveRoom, loadRooms, rankRooms} from './catalog.mjs';
import {cancellationNotice, confirmationNotice, persistAndNotify} from './notifications.mjs';
import {canEnterBuilding, exceedsMaxDuration, hasQuota, holdExpiry, isExpired, isRoomAvailable, lateFee, newHold, price} from './policy.mjs';
import {normalizeAmenities, prepareRequest} from './request-validation.mjs';
import {applyTransition} from './transitions.mjs';

export const createReservation = async ({nextId, notifier, now, request, rooms, store}) => {
    const prepared = prepareRequest(request);
    if (prepared.startAt < now()) throw new Error('reservation start has passed');
    const existing = await store.findByRequestKey(prepared.requestKey);
    if (existing !== null) return existing;
    const window = {roomId: prepared.roomId, ...snapWindow(prepared)};
    if (exceedsMaxDuration(window)) throw new Error('reservation is too long');
    const room = findRoom(loadRooms(rooms), prepared.roomId);
    if (room === null || !isActiveRoom(room)) throw new Error('room cannot be booked');
    if (!canHost(room, prepared.partySize)) throw new Error('party does not fit the room');
    if (!hasAmenities(room, prepared.amenities)) throw new Error('requested amenities are unavailable');
    const at = now();
    const reservations = await store.list();
    if (!hasQuota(reservations, prepared.memberId, at)) throw new Error('member has too many open reservations');
    if (!isRoomAvailable(reservations, window, at)) throw new Error('room is unavailable');
    const hold = newHold({at, id: nextId(), prepared, room, window});
    await persistAndNotify(store, (record) => notifier.held(record), hold);
    return hold;
};

export const listEligibleRooms = ({request, rooms}) => rankRooms(loadRooms(rooms).filter((room) => (
    isActiveRoom(room)
    && canHost(room, request.partySize)
    && hasAmenities(room, normalizeAmenities(request.amenities))
)));

export const confirmReservation = async ({notifier, now, reservation, store}) => {
    const at = now();
    if (isExpired(reservation, at)) throw new Error('hold has expired');
    const confirmed = applyTransition(reservation, 'confirm', at);
    await store.save(confirmed);
    await notifier.confirmed(confirmationNotice(confirmed));
    return confirmed;
};

export const cancelReservation = async ({notifier, now, reservation, store}) => {
    const at = now();
    const next = applyTransition(reservation, 'cancel', at);
    if (next === reservation) return reservation;
    const saved = {...next, fee: lateFee(reservation, at)};
    await store.save(saved);
    await notifier.canceled(cancellationNotice(saved));
    return saved;
};

export const rescheduleReservation = async ({endAt, now, reservation, rooms, startAt, store}) => {
    if (endAt <= startAt) throw new Error('reschedule window is invalid');
    const at = now();
    const window = {roomId: reservation.roomId, ...snapWindow({startAt, endAt})};
    if (!isRoomAvailable(await store.list(window), window, at, reservation.id)) throw new Error('room is unavailable');
    const moved = applyTransition(reservation, 'reschedule', at);
    const room = findRoom(loadRooms(rooms), reservation.roomId);
    const rescheduled = {
        ...moved,
        expiresAt: holdExpiry(at),
        price: price(room, window),
        startAt: window.startAt,
        endAt: window.endAt,
    };
    await store.save(rescheduled);
    return rescheduled;
};

export const authorizeEntry = ({buildingId, now, reservation}) => canEnterBuilding(reservation, buildingId, now());
