const ROOM_DEFAULTS = Object.freeze({amenities: []});

const normalizeRoom = (room) => {
    const merged = {...ROOM_DEFAULTS, ...room};
    return {...merged, amenities: merged.amenities.map((amenity) => amenity.toLowerCase())};
};

export const loadRooms = (rawRooms) => rawRooms.map(normalizeRoom);

export const findRoom = (rooms, roomId) => rooms.find((room) => room.id === roomId) ?? null;

export const isActiveRoom = (room) => room.active === true;

export const canHost = (room, partySize) => partySize <= room.capacity;

export const hasAmenities = (room, amenities) => new Set([...room.amenities, ...amenities]).size === room.amenities.length;

const byId = (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

export const rankRooms = (rooms) => [...rooms].sort((left, right) => left.capacity - right.capacity || byId(left, right));
