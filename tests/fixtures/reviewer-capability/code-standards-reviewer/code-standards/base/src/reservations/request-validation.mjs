import {isPositiveInteger} from '../platform/numbers.mjs';

const trimText = (value) => value.replace(/^\s+|\s+$/g, '');

export const normalizeKey = (key) => key.trim().toLowerCase();

export const normalizeAmenities = (amenities) => [...new Set(amenities.map((amenity) => amenity.toLowerCase()))];

export const prepareRequest = (request) => {
    const roomId = trimText(request.roomId);
    const memberId = trimText(request.memberId);
    if (!roomId || !memberId) throw new Error('room and member are required');
    if (!isPositiveInteger(request.partySize)) throw new Error('party size is invalid');
    if (request.endAt <= request.startAt) throw new Error('reservation window is invalid');
    return {
        roomId,
        memberId,
        partySize: request.partySize,
        startAt: request.startAt,
        endAt: request.endAt,
        note: request.note,
        amenities: normalizeAmenities(request.amenities),
        requestKey: normalizeKey(request.idempotencyKey),
    };
};
