/** @typedef {{buildingId: string, endAt: number, startAt: number}} Reservation */
/** @typedef {{buildingId: string, now: () => number, reservation: Reservation}} EntryRequest */

const EARLY_ACCESS_MS = 10 * 60 * 1_000;
const LATE_ACCESS_MS = 15 * 60 * 1_000;

export const reviewerCapabilityCanEnterBuilding = (/** @type {EntryRequest} */ {buildingId, reservation, now}) => (
    reservation.buildingId === buildingId
    && now() >= reservation.startAt - EARLY_ACCESS_MS
    && now() <= reservation.endAt + LATE_ACCESS_MS
);
