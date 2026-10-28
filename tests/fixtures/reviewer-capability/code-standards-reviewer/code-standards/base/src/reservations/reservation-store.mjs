export const createReservationStore = (initialReservations = []) => {
    const records = new Map(initialReservations.map((reservation) => [reservation.id, reservation]));
    let writes = Promise.resolve();

    return Object.freeze({
        findByRequestKey: async (requestKey) => (
            [...records.values()].find((reservation) => reservation.requestKey === requestKey) ?? null
        ),
        list: async ({roomId} = {}) => [...records.values()].filter((reservation) => (
            roomId === undefined || reservation.roomId === roomId
        )),
        save: (reservation) => {
            writes = writes.then(() => {
                records.set(reservation.id, reservation);
                return reservation;
            });
            return writes;
        },
    });
};
