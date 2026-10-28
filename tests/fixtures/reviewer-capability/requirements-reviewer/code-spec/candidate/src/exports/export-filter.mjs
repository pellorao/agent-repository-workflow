import {minutes} from '../platform/time.mjs';
import {RESERVATION_STATES} from './reservation-columns.mjs';

export const EXPORT_LIMITS = Object.freeze({
    maxWindowMinutes: 44_640,
    maxRows: 10_000,
});

const normalizeState = (state) => {
    const normalized = typeof state === 'string' ? state.trim().toLowerCase() : '';
    if (!RESERVATION_STATES.includes(normalized)) throw new Error(`export state ${String(state)} is unknown`);
    return normalized;
};

const normalizeStates = (states) => {
    if (states === undefined) return [...RESERVATION_STATES];
    if (!Array.isArray(states) || states.length === 0) throw new Error('export states are required');
    const normalized = states.map(normalizeState);
    return RESERVATION_STATES.filter((state) => normalized.includes(state));
};

const normalizeBuilding = (buildingId) => {
    if (buildingId === undefined) return null;
    const trimmed = typeof buildingId === 'string' ? buildingId.trim() : '';
    if (!trimmed) throw new Error('export building is invalid');
    return trimmed;
};

export const prepareFilter = ({buildingId, from, states, until}) => {
    if (!Number.isInteger(from) || !Number.isInteger(until) || until <= from) throw new Error('export window is invalid');
    if (until - from > minutes(EXPORT_LIMITS.maxWindowMinutes)) throw new Error('export window is too long');
    return Object.freeze({from, until, states: normalizeStates(states), buildingId: normalizeBuilding(buildingId)});
};

export const isIncluded = (filter, reservation) => (
    filter.from <= reservation.startAt
    && reservation.startAt < filter.until
    && filter.states.includes(reservation.state)
    && (filter.buildingId === null || reservation.buildingId === filter.buildingId)
);

const byId = (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

export const selectRows = (filter, reservations) => {
    const rows = reservations.filter((reservation) => isIncluded(filter, reservation));
    if (rows.length > EXPORT_LIMITS.maxRows) throw new Error('export has too many rows');
    return rows.sort((left, right) => left.startAt - right.startAt || byId(left, right));
};
