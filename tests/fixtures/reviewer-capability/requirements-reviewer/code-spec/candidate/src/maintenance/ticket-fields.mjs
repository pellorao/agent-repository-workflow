export const PRIORITIES = Object.freeze(['urgent', 'high', 'normal', 'low']);

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

export const requireText = (value, label) => {
    const text = trimmed(value);
    if (!text) throw new Error(`${label} is required`);
    return text;
};

export const normalizePriority = (priority) => {
    const value = trimmed(priority).toLowerCase();
    if (!PRIORITIES.includes(value)) throw new Error('priority is unknown');
    return value;
};

export const normalizeAmenities = (amenities) => {
    if (!Array.isArray(amenities)) throw new Error('amenities must be a list');
    const names = amenities.map((amenity) => requireText(amenity, 'amenity name').toLowerCase());
    return [...new Set(names)];
};

export const prepareTicket = (request) => ({
    roomId: requireText(request.roomId, 'room'),
    buildingId: requireText(request.buildingId, 'building'),
    summary: requireText(request.summary, 'summary'),
    priority: normalizePriority(request.priority),
    amenities: normalizeAmenities(request.amenities),
});
