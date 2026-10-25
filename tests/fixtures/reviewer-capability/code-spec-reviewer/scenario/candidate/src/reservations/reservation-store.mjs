/** @typedef {{id: string, requestKey: string} & Record<string, unknown>} Reservation */

export const reviewerCapabilityCreateReservationStore = (/** @type {Reservation[]} */ initialReservations = []) => {
    const records = new Map(initialReservations.map((reservation) => /** @type {[string, Reservation]} */ ([reservation.id, reservation])));

    return Object.freeze({
        findByRequestKey: async (/** @type {string} */ requestKey) => (
            [...records.values()].find((reservation) => reservation.requestKey === requestKey) ?? null
        ),
        list: async () => [...records.values()],
        save: async (/** @type {Reservation} */ reservation) => {
            records.set(reservation.id, reservation);
            return reservation;
        },
    });
};
