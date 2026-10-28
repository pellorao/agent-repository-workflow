import {isPositiveInteger} from '../platform/numbers.mjs';

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

export const normalizeRequestKey = (key) => trimmed(key).toLowerCase();

export const requireRoomId = (roomId) => {
    const value = trimmed(roomId);
    if (!value) throw new Error('room is required');
    return value;
};

export const requireMemberId = (memberId) => {
    const value = trimmed(memberId);
    if (!value) throw new Error('member is required');
    return value;
};

const requireWindow = (window) => {
    if (!(window.endAt > window.startAt)) throw new Error('waitlist window is invalid');
    return {startAt: window.startAt, endAt: window.endAt};
};

export const prepareEntry = (request) => {
    const memberId = requireMemberId(request.memberId);
    const roomId = requireRoomId(request.roomId);
    if (!isPositiveInteger(request.partySize)) throw new Error('party size is invalid');
    const requestKey = normalizeRequestKey(request.requestKey);
    if (!requestKey) throw new Error('request key is required');
    return {memberId, roomId, partySize: request.partySize, ...requireWindow(request), requestKey};
};

export const prepareOpening = (opening) => {
    const roomId = requireRoomId(opening.roomId);
    if (!isPositiveInteger(opening.capacity)) throw new Error('room capacity is invalid');
    return {roomId, capacity: opening.capacity, ...requireWindow(opening)};
};
