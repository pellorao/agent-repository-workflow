const DIRECTIONS = Object.freeze(['in', 'out']);

export const requiredText = (value, label) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) throw new Error(`${label} is required`);
    return text;
};

export const normalizeEventKey = (key) => {
    if (typeof key !== 'string') return null;
    const normalized = key.trim().toLowerCase();
    return normalized === '' ? null : normalized;
};

const normalizeDirection = (direction) => {
    const normalized = typeof direction === 'string' ? direction.trim().toLowerCase() : '';
    if (!DIRECTIONS.includes(normalized)) throw new Error(`badge direction ${String(direction)} is invalid`);
    return normalized;
};

export const prepareBadgeEvent = (raw) => {
    const buildingId = requiredText(raw.buildingId, 'building');
    const memberId = requiredText(raw.memberId, 'member');
    const readerId = requiredText(raw.readerId, 'reader');
    const direction = normalizeDirection(raw.direction);
    if (!Number.isInteger(raw.at) || raw.at < 0) throw new Error('badge time is invalid');
    return {
        buildingId,
        memberId,
        readerId,
        direction,
        at: raw.at,
        eventKey: normalizeEventKey(raw.eventKey),
    };
};
