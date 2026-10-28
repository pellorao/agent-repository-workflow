const requiredText = (value, label) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) throw new Error(`${label} is required`);
    return text;
};

const ENTRY_DEFAULTS = Object.freeze({active: true, amenities: []});

const prepareRoom = (entry) => {
    const room = {...ENTRY_DEFAULTS, ...entry};
    const id = requiredText(room.id, 'room');
    const buildingId = requiredText(room.buildingId, 'building');
    if (!Number.isInteger(room.capacity) || room.capacity <= 0) throw new Error('room capacity is invalid');
    const amenities = room.amenities.map((amenity) => amenity.toLowerCase());
    return Object.freeze({id, buildingId, capacity: room.capacity, active: room.active, amenities});
};

export const normalizeAmenities = (amenities = []) => [...new Set(amenities.map((amenity) => amenity.toLowerCase()))];

const offersAll = (room, wanted) => {
    const offered = new Set(room.amenities);
    return wanted.filter((amenity) => !offered.has(amenity)).length === 0;
};

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

export const compareRooms = (left, right) => compareText(left.buildingId, right.buildingId) || compareText(left.id, right.id);

export const loadDirectory = (rawRooms, amenities) => {
    const listed = rawRooms.map(prepareRoom);
    const seen = new Set();
    for (const room of listed) {
        if (seen.has(room.id)) throw new Error('room is listed twice');
        seen.add(room.id);
    }
    const rooms = listed.filter((room) => room.active === true && offersAll(room, amenities)).sort(compareRooms);
    const byId = new Map(rooms.map((room) => [room.id, room]));
    return Object.freeze({
        rooms,
        buildingIds: [...new Set(rooms.map((room) => room.buildingId))].sort(compareText),
        find: (roomId) => byId.get(roomId) ?? null,
    });
};
