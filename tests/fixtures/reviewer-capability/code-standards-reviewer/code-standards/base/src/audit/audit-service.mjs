import {normalizeSubject, prepareEntry, reservationAction, reservationDetails} from './audit-entry.mjs';
import {prepareQuery, selectEntries, subjectTimeline, summarizeActors} from './audit-query.mjs';
import {redact} from './redaction.mjs';
import {retentionCutoff} from './retention.mjs';

export const recordEntry = async ({entry, nextId, now, publish, store}) => {
    const prepared = prepareEntry(entry);
    if (prepared.entryKey !== null) {
        const existing = await store.findByEntryKey(prepared.entryKey);
        if (existing !== null) return existing;
    }
    const recorded = Object.freeze({
        id: nextId(),
        at: now(),
        actor: prepared.actor,
        action: prepared.action,
        subjectType: prepared.subjectType,
        subjectId: prepared.subjectId,
        details: redact(prepared.details),
        entryKey: prepared.entryKey,
    });
    await store.append(recorded);
    await publish(recorded);
    return recorded;
};

export const recordReservationChange = async ({actor, nextId, now, publish, reservation, store}) => recordEntry({
    entry: {
        actor,
        action: reservationAction(reservation),
        subjectType: 'reservation',
        subjectId: reservation.id,
        details: reservationDetails(reservation),
        entryKey: `${reservation.id}:${reservation.history.length}`,
    },
    nextId,
    now,
    publish,
    store,
});

export const queryEntries = async ({now, query, store}) => {
    const prepared = prepareQuery(query);
    return selectEntries(await store.list(), prepared, now());
};

export const actorSummary = async ({now, query, store}) => {
    const prepared = prepareQuery(query);
    return summarizeActors(await store.list(), prepared, now());
};

export const subjectHistory = async ({now, store, subjectId, subjectType}) => (
    subjectTimeline(await store.list(), normalizeSubject(subjectType, subjectId), now())
);

export const pruneEntries = async ({now, store}) => {
    const cutoff = retentionCutoff(now());
    const removed = await store.pruneBefore(cutoff);
    return Object.freeze({cutoff, removed});
};
