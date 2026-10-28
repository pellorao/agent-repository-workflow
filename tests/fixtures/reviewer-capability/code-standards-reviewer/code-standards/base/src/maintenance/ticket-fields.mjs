import {requiredText} from '../platform/text.mjs';

export const PRIORITIES = Object.freeze(['urgent', 'high', 'normal', 'low']);

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

export const normalizePriority = (priority) => {
    const value = trimmed(priority).toLowerCase();
    if (!PRIORITIES.includes(value)) throw new Error('priority is unknown');
    return value;
};

export const normalizeAmenities = (amenities) => {
    if (!Array.isArray(amenities)) throw new Error('amenities must be a list');
    const names = amenities.map((amenity) => requiredText(amenity, 'amenity name').toLowerCase());
    return [...new Set(names)];
};

export const prepareTicket = (request) => ({
    roomId: requiredText(request.roomId, 'room'),
    buildingId: requiredText(request.buildingId, 'building'),
    summary: requiredText(request.summary, 'summary'),
    priority: normalizePriority(request.priority),
    amenities: normalizeAmenities(request.amenities),
});
