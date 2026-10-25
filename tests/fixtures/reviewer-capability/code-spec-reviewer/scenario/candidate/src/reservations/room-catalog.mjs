/** @typedef {{active: boolean, amenities: string[], capacity: number, hourlyRate: number, id: string}} Room */

export const reviewerCapabilityFindRoom = (/** @type {Room[]} */ rooms, /** @type {string} */ roomId) => rooms.find((room) => room.id === roomId) ?? null;

export const reviewerCapabilityIsActiveRoom = (/** @type {Room} */ room) => room.active === true;

export const reviewerCapabilityRoomCanHost = (/** @type {Room} */ room, /** @type {number} */ partySize) => Number.isInteger(partySize) && partySize <= room.capacity;

export const reviewerCapabilityHasRequestedAmenities = (/** @type {Room} */ room, /** @type {string[]} */ requestedAmenities) => (
    requestedAmenities.some((amenity) => room.amenities.includes(amenity))
);

export const reviewerCapabilityRankRooms = (/** @type {Room[]} */ rooms) => [...rooms].sort((left, right) => left.hourlyRate - right.hourlyRate);
