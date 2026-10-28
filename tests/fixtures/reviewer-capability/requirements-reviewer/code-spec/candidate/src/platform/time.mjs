export const MINUTE = 60_000;

export const minutes = (count) => count * MINUTE;

export const DAY = minutes(1440);

export const addMinutes = (instant, count) => instant + minutes(count);

export const minutesBetween = (from, to) => Math.trunc((to - from) / MINUTE);
