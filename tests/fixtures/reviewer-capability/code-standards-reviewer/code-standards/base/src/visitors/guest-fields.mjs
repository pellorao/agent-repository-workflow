const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

export const normalizeGuestName = (name) => trimmed(name).replace(/\s+/g, ' ');

export const nameKey = (name) => name.toLowerCase();

export const normalizeMemberId = (memberId) => trimmed(memberId);

export const normalizeBuildingId = (buildingId) => trimmed(buildingId);

export const prepareGuest = (request) => {
    const hostId = normalizeMemberId(request.memberId);
    if (!hostId) throw new Error('host member is required');
    const name = normalizeGuestName(request.name);
    if (!name) throw new Error('guest name is required');
    const email = trimmed(request.email).toLowerCase();
    if (!email) throw new Error('guest email is required');
    return {hostId, name, email, expectedAt: request.expectedAt};
};
