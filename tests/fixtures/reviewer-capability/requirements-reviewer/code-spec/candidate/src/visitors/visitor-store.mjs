export const createVisitorStore = (initialGuests = []) => {
    const records = new Map(initialGuests.map((guest) => [guest.id, guest]));
    let writes = Promise.resolve();

    return Object.freeze({
        find: async (id) => records.get(id) ?? null,
        listByBuilding: async (buildingId) => [...records.values()].filter((guest) => guest.buildingId === buildingId),
        listByReservation: async (reservationId) => [...records.values()].filter((guest) => guest.reservationId === reservationId),
        save: (guest) => {
            writes = writes.then(() => {
                records.set(guest.id, guest);
                return guest;
            });
            return writes;
        },
    });
};
