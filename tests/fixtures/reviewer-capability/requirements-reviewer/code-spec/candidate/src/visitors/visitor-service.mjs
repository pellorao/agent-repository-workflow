import {normalizeBuildingId, prepareGuest} from './guest-fields.mjs';
import {moveGuest} from './guest-states.mjs';
import {
    checkInWindow, expectedDuring, hasMissedWindow, hasSeat, isDuplicateName, isInCheckInWindow, isRegistrationOpen,
    listedGuests, orderGuests,
} from './lobby-policy.mjs';

const invitationNotice = (guest) => {
    const window = checkInWindow(guest);
    return Object.freeze({
        guestId: guest.id,
        name: guest.name,
        email: guest.email,
        expectedAt: guest.expectedAt,
        checkInFrom: window.startAt,
        checkInUntil: window.endAt,
    });
};

const arrivalNotice = (guest) => Object.freeze({
    guestId: guest.id,
    reservationId: guest.reservationId,
    name: guest.name,
    checkedInAt: guest.checkedInAt,
});

const saveThenSend = async (store, send, guest) => {
    const saved = await store.save(guest);
    await send(saved);
    return saved;
};

export const registerGuest = async ({nextId, notifier, now, request, reservation, store}) => {
    const prepared = prepareGuest(request);
    if (reservation.state !== 'confirmed') throw new Error('guests need a confirmed reservation');
    if (prepared.hostId !== reservation.memberId) throw new Error('only the reservation member can register guests');
    if (!expectedDuring(reservation, prepared.expectedAt)) throw new Error('expected arrival is outside the reservation');
    const at = now();
    if (!isRegistrationOpen(reservation, at)) throw new Error('reservation has ended');
    const guests = await store.listByReservation(reservation.id);
    if (!hasSeat(guests, reservation)) throw new Error('guest list is full');
    if (isDuplicateName(guests, prepared.name)) throw new Error('guest is already registered');
    const guest = {
        id: nextId(),
        reservationId: reservation.id,
        roomId: reservation.roomId,
        buildingId: reservation.buildingId,
        memberId: reservation.memberId,
        name: prepared.name,
        email: prepared.email,
        expectedAt: prepared.expectedAt,
        state: 'registered',
        registeredAt: at,
    };
    return saveThenSend(store, (saved) => notifier.invited(invitationNotice(saved)), guest);
};

export const findGuest = async ({id, store}) => {
    const guest = await store.find(id);
    if (guest === null) throw new Error('guest not found');
    return guest;
};

export const checkInGuest = async ({guest, notifier, now, store}) => {
    const at = now();
    if (guest.state === 'registered' && !isInCheckInWindow(guest, at)) throw new Error('outside the check-in window');
    const arrived = moveGuest(guest, 'checkIn', at);
    return saveThenSend(store, (saved) => notifier.arrived(arrivalNotice(saved)), arrived);
};

export const cancelGuest = async ({guest, now, store}) => {
    const canceled = moveGuest(guest, 'cancel', now());
    if (canceled === guest) return guest;
    await store.save(canceled);
    return canceled;
};

export const recordNoShows = async ({now, reservationId, store}) => {
    const at = now();
    const missed = (await store.listByReservation(reservationId)).filter((guest) => hasMissedWindow(guest, at));
    const recorded = [];
    for (const guest of orderGuests(missed)) recorded.push(await store.save(moveGuest(guest, 'miss', at)));
    return recorded;
};

export const listGuests = async ({reservationId, store}) => orderGuests(listedGuests(await store.listByReservation(reservationId)));

export const changeArrival = async ({expectedAt, guest, notifier, now, reservation, store}) => {
    if (guest.state !== 'registered') throw new Error(`cannot move the arrival of a ${guest.state} guest`);
    if (guest.reservationId !== reservation.id) throw new Error('guest belongs to another reservation');
    if (!expectedDuring(reservation, expectedAt)) throw new Error('expected arrival is outside the reservation');
    if (!isRegistrationOpen(reservation, now())) throw new Error('reservation has ended');
    const moved = {...guest, expectedAt};
    return saveThenSend(store, (saved) => notifier.invited(invitationNotice(saved)), moved);
};

export const lobbyArrivals = async ({buildingId, from, store, until}) => {
    const building = normalizeBuildingId(buildingId);
    if (!building) throw new Error('building is required');
    if (!(until > from)) throw new Error('arrival range is invalid');
    const guests = await store.listByBuilding(building);
    const expected = guests.filter((guest) => guest.state === 'registered' && from <= guest.expectedAt && guest.expectedAt < until);
    return orderGuests(expected);
};
