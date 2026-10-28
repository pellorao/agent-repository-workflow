export const MINUTE = 60_000;

export const minutes = (count) => count * MINUTE;

export const addMinutes = (instant, count) => instant + minutes(count);

export const remaining = (from, to) => Math.trunc((to - from) / MINUTE);

export const SETTINGS = Object.freeze({
    slot: minutes(15),
    hold: minutes(10),
    largeHold: minutes(30),
    largeParty: 8,
    accessMinutes: 15,
    largeAccessMinutes: 30,
    maxDuration: 240,
    lateCancellationMinutes: 120,
    rescheduleCutoffMinutes: 60,
    maxOpenPerMember: 2,
});

const alignDown = (instant, unit) => instant - (instant % unit);

const alignUp = (instant, unit) => alignDown(instant + unit - 1, unit);

export const snapWindow = (window) => ({
    startAt: alignDown(window.startAt, SETTINGS.slot),
    endAt: alignUp(window.endAt, SETTINGS.slot),
});

const SLOT_MINUTES = SETTINGS.slot / MINUTE;

export const slotCount = (window) => (window.endAt - window.startAt) / SETTINGS.slot;

export const windowLength = (window) => slotCount(window) * SLOT_MINUTES;

export const within = (at, window) => window.startAt <= at && at < window.endAt;

export const overlaps = (left, right) => left.startAt < right.endAt && right.startAt < left.endAt;
