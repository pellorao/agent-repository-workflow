import {prepareBadgeEvent, requiredText} from './badge-fields.mjs';
import {dailyCounts, findAnomalies, findRepeat, isLate, occupantsAt, orderEvents, readerCounts} from './badge-policy.mjs';
import {loadReaders, requireReader} from './badge-readers.mjs';

const findKeyedEvent = async (store, event) => (
    (await store.list(event)).find((stored) => stored.eventKey === event.eventKey) ?? null
);

export const recordBadgeEvent = async ({event, nextId, notifier, now, readers, store}) => {
    const prepared = prepareBadgeEvent(event);
    requireReader(loadReaders(readers), prepared);
    const at = now();
    if (prepared.at > at) throw new Error('badge time is in the future');
    if (isLate(prepared, at)) throw new Error('badge event arrived too late');
    if (prepared.eventKey !== null) {
        const existing = await findKeyedEvent(store, prepared);
        if (existing !== null) return existing;
    }
    const existingEvents = await store.list(prepared);
    const repeat = findRepeat(existingEvents, prepared);
    if (repeat !== null) return repeat;
    const recorded = {id: nextId(), ...prepared, recordedAt: at};
    await store.append(recorded);
    const anomaly = findAnomalies([...existingEvents, recorded]).find((flag) => flag.eventId === recorded.id);
    if (anomaly !== undefined) await notifier.anomaly(Object.freeze({...anomaly, buildingId: recorded.buildingId}));
    return recorded;
};

const buildingEvents = async (store, buildingId) => store.list({buildingId: requiredText(buildingId, 'building')});

export const listBuildingEvents = async ({buildingId, store}) => orderEvents(await buildingEvents(store, buildingId));

export const buildingDailyCounts = async ({buildingId, from, store, until}) => {
    if (!(until > from)) throw new Error('count window is invalid');
    const events = await buildingEvents(store, buildingId);
    return dailyCounts(events.filter((event) => from <= event.at && event.at < until));
};

export const buildingAnomalies = async ({buildingId, store}) => findAnomalies(await buildingEvents(store, buildingId));

export const buildingOccupants = async ({buildingId, now, store}) => occupantsAt(await buildingEvents(store, buildingId), now());

export const buildingReaderCounts = async ({buildingId, store}) => readerCounts(await buildingEvents(store, buildingId));
