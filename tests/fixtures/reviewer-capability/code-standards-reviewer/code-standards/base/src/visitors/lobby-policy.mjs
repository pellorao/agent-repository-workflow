import {nameKey} from './guest-fields.mjs';
import {LOBBY} from '../platform/site-settings.mjs';
import {addMinutes} from '../platform/time.mjs';

const checkInOpens = (guest) => addMinutes(guest.expectedAt, -LOBBY.earlyArrivalMinutes);

export const isListed = (guest) => guest.state !== 'canceled';

export const listedGuests = (guests) => guests.filter(isListed);

export const guestLimit = (reservation) => reservation.partySize - LOBBY.hostSeats;

export const hasSeat = (guests, reservation) => listedGuests(guests).length < guestLimit(reservation);

export const isDuplicateName = (guests, name) => listedGuests(guests).some((guest) => nameKey(guest.name) === nameKey(name));

export const expectedDuring = (reservation, expectedAt) => reservation.startAt <= expectedAt && expectedAt < reservation.endAt;

export const isRegistrationOpen = (reservation, at) => at < reservation.endAt;

const checkInCloses = (guest) => guest.expectedAt + LOBBY.lateArrival;

export const checkInWindow = (guest) => ({startAt: checkInOpens(guest), endAt: checkInCloses(guest)});

export const isInCheckInWindow = (guest, at) => {
    const window = checkInWindow(guest);
    return window.startAt <= at && at < window.endAt;
};

export const hasMissedWindow = (guest, at) => guest.state === 'registered' && at >= checkInCloses(guest);

const byName = (left, right) => {
    const a = nameKey(left.name);
    const b = nameKey(right.name);
    return a < b ? -1 : a > b ? 1 : 0;
};

export const orderGuests = (guests) => [...guests].sort((left, right) => left.expectedAt - right.expectedAt || byName(left, right));
