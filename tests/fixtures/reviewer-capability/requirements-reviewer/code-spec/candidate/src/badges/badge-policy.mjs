import {BADGE_SETTINGS} from '../platform/site-settings.mjs';

export const ANOMALIES = Object.freeze({
    exitWithoutEntry: 'exit-without-entry',
    repeatedEntry: 'repeated-entry',
});

const byId = (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

export const compareEvents = (left, right) => left.at - right.at || byId(left, right);

export const orderEvents = (events) => [...events].sort(compareEvents);

export const isRepeatedSwipe = (recorded, candidate) => (
    recorded.memberId === candidate.memberId
    && recorded.buildingId === candidate.buildingId
    && recorded.direction === candidate.direction
    && Math.abs(recorded.at - candidate.at) < BADGE_SETTINGS.repeatWindow
);

export const findRepeat = (events, candidate) => (
    orderEvents(events.filter((event) => isRepeatedSwipe(event, candidate)))[0] ?? null
);

export const isLate = (event, at) => at - event.at > BADGE_SETTINGS.lateLimit;

export const dayStart = (at) => at - (at % BADGE_SETTINGS.day);

const distinctMembersByDay = (events, direction) => {
    const days = new Map();
    for (const event of events) {
        if (event.direction !== direction) continue;
        const start = dayStart(event.at);
        const members = days.get(start) ?? new Set();
        members.add(event.memberId);
        days.set(start, members);
    }
    return days;
};

export const dailyCounts = (events) => {
    const entries = distinctMembersByDay(events, 'in');
    const exits = distinctMembersByDay(events, 'out');
    const days = [...new Set([...entries.keys(), ...exits.keys()])].sort((left, right) => left - right);
    return days.map((start) => Object.freeze({
        dayStart: start,
        entries: entries.get(start)?.size ?? 0,
        exits: exits.get(start)?.size ?? 0,
    }));
};

const classify = (previous, event) => {
    if (event.direction === 'out' && previous?.direction !== 'in') return ANOMALIES.exitWithoutEntry;
    if (event.direction === 'in' && previous?.direction === 'in') return ANOMALIES.repeatedEntry;
    return null;
};

export const findAnomalies = (events) => {
    const lastByMember = new Map();
    const flagged = [];
    for (const event of orderEvents(events)) {
        const kind = classify(lastByMember.get(event.memberId), event);
        if (kind !== null) flagged.push(Object.freeze({eventId: event.id, memberId: event.memberId, kind}));
        lastByMember.set(event.memberId, event);
    }
    return flagged;
};

export const occupantsAt = (events, at) => {
    const lastByMember = new Map();
    for (const event of orderEvents(events)) {
        if (event.at <= at) lastByMember.set(event.memberId, event);
    }
    return [...lastByMember.values()]
        .filter((event) => event.direction === 'in')
        .map((event) => event.memberId)
        .sort();
};

export const readerCounts = (events) => {
    const counts = new Map();
    for (const event of events) {
        const current = counts.get(event.readerId) ?? {readerId: event.readerId, in: 0, out: 0};
        counts.set(event.readerId, {...current, [event.direction]: current[event.direction] + 1});
    }
    return [...counts.values()]
        .sort((left, right) => (left.readerId < right.readerId ? -1 : left.readerId > right.readerId ? 1 : 0))
        .map((count) => Object.freeze(count));
};
