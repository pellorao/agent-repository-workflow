import {optionalKey, requiredText} from '../platform/text.mjs';

export const normalizeActor = (actor) => requiredText(actor, 'actor');

export const normalizeAction = (action) => requiredText(action, 'action').toLowerCase();

const isRecord = (value) => (
    typeof value === 'object' && value !== null && [Object.prototype, null].includes(Object.getPrototypeOf(value))
);

export const normalizeSubject = (subjectType, subjectId) => ({
    subjectType: requiredText(subjectType, 'subject type').toLowerCase(),
    subjectId: requiredText(subjectId, 'subject'),
});

export const prepareEntry = (raw) => {
    const actor = normalizeActor(raw.actor);
    const action = normalizeAction(raw.action);
    const subject = normalizeSubject(raw.subjectType, raw.subjectId);
    const details = raw.details ?? {};
    if (!isRecord(details)) throw new Error('audit details are invalid');
    return {actor, action, ...subject, details, entryKey: optionalKey(raw.entryKey)};
};

const RESERVATION_FIELDS = Object.freeze([
    'id', 'roomId', 'buildingId', 'memberId', 'partySize', 'state', 'startAt', 'endAt', 'expiresAt', 'price', 'fee', 'note',
]);

export const reservationDetails = (reservation) => Object.fromEntries(
    RESERVATION_FIELDS.filter((field) => field in reservation).map((field) => [field, reservation[field]]),
);

export const reservationAction = (reservation) => {
    const latest = reservation.history.at(-1);
    if (latest === undefined) throw new Error('reservation has no history');
    return `reservation.${latest.state}`;
};
