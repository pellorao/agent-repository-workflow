import {pageOf} from '../platform/listing.mjs';
import {normalizeAction, normalizeActor, normalizeSubject} from './audit-entry.mjs';
import {AUDIT_LIMITS, isRetained, windowSpan} from './retention.mjs';

export const prepareQuery = (query) => {
    if (!Number.isInteger(query.from) || !Number.isInteger(query.until) || query.until <= query.from) {
        throw new Error('audit query window is invalid');
    }
    if (windowSpan(query) > AUDIT_LIMITS.maxQueryWindow) throw new Error('audit query window is too long');
    const limit = query.limit ?? AUDIT_LIMITS.maxResults;
    if (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_LIMITS.maxResults) throw new Error('audit query limit is invalid');
    return {
        limit,
        from: query.from,
        until: query.until,
        actor: query.actor === undefined ? null : normalizeActor(query.actor),
        action: query.action === undefined ? null : normalizeAction(query.action),
        subject: query.subjectType === undefined && query.subjectId === undefined
            ? null
            : normalizeSubject(query.subjectType, query.subjectId),
    };
};

const byId = (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

const matches = (entry, query, at) => (
    query.from <= entry.at
    && entry.at < query.until
    && isRetained(entry, at)
    && (query.actor === null || entry.actor === query.actor)
    && (query.action === null || entry.action === query.action)
    && (query.subject === null || (
        entry.subjectType === query.subject.subjectType && entry.subjectId === query.subject.subjectId
    ))
);

const byTime = (left, right) => left.at - right.at || byId(left, right);

const inOrder = (entries) => [...entries].sort(byTime);

export const selectEntries = (entries, query, at) => pageOf(entries, (entry) => matches(entry, query, at), byTime, query);

export const subjectTimeline = (entries, subject, at) => inOrder(entries.filter((entry) => (
    entry.subjectType === subject.subjectType
    && entry.subjectId === subject.subjectId
    && isRetained(entry, at)
)));

export const summarizeActors = (entries, query, at) => {
    const counts = new Map();
    for (const entry of selectEntries(entries, query, at)) {
        counts.set(entry.actor, (counts.get(entry.actor) ?? 0) + 1);
    }
    return [...counts.entries()]
        .sort(([leftActor, leftCount], [rightActor, rightCount]) => (
            rightCount - leftCount || (leftActor < rightActor ? -1 : 1)
        ))
        .map(([actor, entryCount]) => Object.freeze({actor, entries: entryCount}));
};
