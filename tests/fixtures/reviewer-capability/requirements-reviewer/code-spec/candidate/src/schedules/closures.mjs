import {minutes, minutesBetween} from '../platform/time.mjs';

export const CLOSURE_LIMITS = Object.freeze({
    maxMinutes: 20_160,
});

export const prepareClosure = (closure) => {
    const {startAt, endAt} = closure;
    if (!Number.isInteger(startAt) || !Number.isInteger(endAt) || endAt <= startAt) throw new Error('closure window is invalid');
    if (endAt - startAt > minutes(CLOSURE_LIMITS.maxMinutes)) throw new Error('closure is too long');
    const reason = typeof closure.reason === 'string' ? closure.reason.trim() : '';
    if (!reason) throw new Error('closure reason is required');
    return {startAt, endAt, reason};
};

export const isActive = (closure) => closure.state === 'active';

export const isClosedBy = (closure, at) => isActive(closure) && closure.startAt <= at && at < closure.endAt;

export const cancelClosureRecord = (closure, at) => {
    if (closure.state === 'canceled') return closure;
    if (!isActive(closure)) throw new Error(`cannot cancel a ${closure.state} closure`);
    return {...closure, state: 'canceled', canceledAt: at};
};

export const hasEnded = (closure, at) => minutesBetween(at, closure.endAt) <= 0;

const byId = (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

export const orderClosures = (closures) => [...closures].sort((left, right) => left.startAt - right.startAt || byId(left, right));

export const closureNotice = (closure) => Object.freeze({
    closureId: closure.id,
    buildingId: closure.buildingId,
    startAt: closure.startAt,
    endAt: closure.endAt,
    reason: closure.reason,
});
