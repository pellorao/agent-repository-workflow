import {cancelClosureRecord, closureNotice, hasEnded, isActive, orderClosures, prepareClosure} from './closures.mjs';
import {findNextClosing, findNextOpening, isDeskOpen, weeklyOpenMinutes} from './desk-policy.mjs';
import {prepareWeek} from './opening-hours.mjs';

const requireBuilding = (buildingId) => {
    const trimmed = typeof buildingId === 'string' ? buildingId.trim() : '';
    if (!trimmed) throw new Error('building is required');
    return trimmed;
};

const deskState = async (store, buildingId) => {
    const building = requireBuilding(buildingId);
    return {schedule: await store.findSchedule(building), closures: await store.listClosures(building)};
};

export const setOpeningHours = async ({buildingId, intervals, now, store}) => {
    const week = prepareWeek(intervals);
    const schedule = Object.freeze({
        buildingId: requireBuilding(buildingId),
        intervals: week,
        weeklyOpenMinutes: weeklyOpenMinutes(week),
        updatedAt: now(),
    });
    return store.saveSchedule(schedule);
};

export const addClosure = async ({buildingId, closure, nextId, notifier, now, store}) => {
    const building = requireBuilding(buildingId);
    const prepared = prepareClosure(closure);
    const at = now();
    if (hasEnded(prepared, at)) throw new Error('closure has already ended');
    const saved = Object.freeze({id: nextId(), buildingId: building, ...prepared, state: 'active', createdAt: at});
    await store.saveClosure(saved);
    await notifier.closure(closureNotice(saved));
    return saved;
};

export const isFrontDeskOpen = async ({at, buildingId, store}) => {
    const {schedule, closures} = await deskState(store, buildingId);
    return isDeskOpen(schedule, closures, at);
};

export const nextOpening = async ({buildingId, now, store}) => {
    const {schedule, closures} = await deskState(store, buildingId);
    return findNextOpening(schedule, closures, now());
};

export const nextClosing = async ({buildingId, now, store}) => {
    const {schedule, closures} = await deskState(store, buildingId);
    return findNextClosing(schedule, closures, now());
};

export const upcomingClosures = async ({buildingId, now, store}) => {
    const at = now();
    const {closures} = await deskState(store, buildingId);
    return orderClosures(closures.filter((closure) => isActive(closure) && !hasEnded(closure, at)));
};

export const cancelClosure = async ({closureId, now, store}) => {
    const closure = await store.findClosure(closureId);
    if (closure === null) throw new Error('closure is unknown');
    const next = cancelClosureRecord(closure, now());
    if (next === closure) return closure;
    return store.saveClosure(Object.freeze(next));
};
