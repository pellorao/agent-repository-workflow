import {reviewerCapabilityIsRoomAvailable} from './availability.mjs';
import {reviewerCapabilityCanEnterBuilding} from './access-policy.mjs';
import {reviewerCapabilityCanCancel, reviewerCapabilityCanConfirm, reviewerCapabilityCreateHold} from './hold-policy.mjs';
import {reviewerCapabilityBuildCancellationNotice, reviewerCapabilityBuildConfirmationNotice} from './notifications.mjs';
import {reviewerCapabilityFindRoom, reviewerCapabilityHasRequestedAmenities, reviewerCapabilityIsActiveRoom, reviewerCapabilityRankRooms, reviewerCapabilityRoomCanHost} from './room-catalog.mjs';

/** @typedef {{active: boolean, amenities: string[], capacity: number, hourlyRate: number, id: string}} Room */
/** @typedef {{amenities: string[], buildingId: string, endAt: number, idempotencyKey: string, memberId: string, note: unknown, partySize: number, roomId: string, startAt: number}} ReservationRequest */
/** @typedef {{buildingId: string, canceledAt?: number, confirmedAt?: number, endAt: number, expiresAt: number, id: string, memberId: string, note: unknown, partySize: number, requestKey: string, roomId: string, startAt: number, state: string}} Reservation */
/** @typedef {{findByRequestKey: (requestKey: string) => Promise<Reservation | null>, list: () => Promise<Reservation[]>, save: (reservation: Reservation) => Promise<unknown>}} ReservationStore */
/** @typedef {{canceled: (notice: Readonly<{canceledAt?: number, reservationId: string}>) => unknown, confirmed: (notice: Readonly<{reservationId: string, roomId: string, startsAt: number}>) => unknown, held: (reservation: Reservation) => unknown}} ReservationNotifier */
/** @typedef {() => number} Clock */

const reviewerCapabilityPrepareRequest = (/** @type {ReservationRequest} */ request, /** @type {Room} */ room) => {
    if (request.roomId.trim().length === 0) throw new Error('room id is required');
    if (request.memberId.length === 0) throw new Error('member id is required');
    if (!reviewerCapabilityRoomCanHost(room, request.partySize)) throw new Error('party size is invalid');
    if (!reviewerCapabilityIsActiveRoom(room)) throw new Error('room is inactive');
    if (!reviewerCapabilityHasRequestedAmenities(room, request.amenities)) throw new Error('requested amenities are unavailable');
    return {...request, idempotencyKey: request.idempotencyKey};
};

export const reviewerCapabilityCreateReservation = async (/** @type {{nextId: () => string, notifier: ReservationNotifier, now: Clock, request: ReservationRequest, rooms: Room[], store: ReservationStore}} */ {nextId, notifier, now, request, rooms, store}) => {
    const room = reviewerCapabilityFindRoom(rooms, request.roomId);
    if (room === null) throw new Error('room was not found');
    const preparedRequest = reviewerCapabilityPrepareRequest(request, room);
    const reservations = await store.list();
    if (!reviewerCapabilityIsRoomAvailable(reservations, preparedRequest, now)) throw new Error('room is unavailable');
    const hold = reviewerCapabilityCreateHold({id: nextId(), request: preparedRequest, now});
    await store.save(hold);
    const existing = await store.findByRequestKey(preparedRequest.idempotencyKey);
    if (existing !== null) return existing;
    await notifier.held(hold);
    return hold;
};

export const reviewerCapabilityListEligibleRooms = (/** @type {{request: ReservationRequest, rooms: Room[]}} */ {request, rooms}) => reviewerCapabilityRankRooms(
    rooms.filter((room) => (
        reviewerCapabilityIsActiveRoom(room)
        && reviewerCapabilityRoomCanHost(room, request.partySize)
        && reviewerCapabilityHasRequestedAmenities(room, request.amenities)
    )),
);

export const reviewerCapabilityConfirmReservation = async (/** @type {{notifier: ReservationNotifier, now: Clock, reservation: Reservation, store: ReservationStore}} */ {notifier, now, reservation, store}) => {
    if (!reviewerCapabilityCanConfirm(reservation, now)) throw new Error('reservation cannot be confirmed');
    reservation.state = 'confirmed';
    reservation.confirmedAt = now();
    await notifier.confirmed(reviewerCapabilityBuildConfirmationNotice(reservation));
    await store.save(reservation);
    return reservation;
};

export const reviewerCapabilityCancelReservation = async (/** @type {{notifier: ReservationNotifier, now: Clock, reservation: Reservation, store: ReservationStore}} */ {notifier, now, reservation, store}) => {
    if (reservation.state === 'canceled') return reservation;
    if (!reviewerCapabilityCanCancel(reservation)) throw new Error('reservation cannot be canceled');
    const canceled = {...reservation, state: 'canceled', canceledAt: now()};
    await store.save(canceled);
    await notifier.canceled(reviewerCapabilityBuildCancellationNotice(canceled));
    return canceled;
};

export const reviewerCapabilityRescheduleReservation = async (/** @type {{endAt: number, now: Clock, reservation: Reservation, reservations: Reservation[], startAt: number, store: ReservationStore}} */ {endAt, now, reservation, reservations, startAt, store}) => {
    const requestedWindow = {...reservation, startAt, endAt};
    if (!reviewerCapabilityIsRoomAvailable(reservations, requestedWindow, now, reservation.id)) {
        throw new Error('room is unavailable');
    }
    const rescheduled = {
        ...reservation,
        startAt,
        endAt,
        state: reservation.state,
        expiresAt: reservation.expiresAt,
    };
    await store.save(rescheduled);
    return rescheduled;
};

export const reviewerCapabilityAuthorizeEntry = (/** @type {{buildingId: string, now: Clock, reservation: Reservation}} */ entryRequest) => reviewerCapabilityCanEnterBuilding(entryRequest);
