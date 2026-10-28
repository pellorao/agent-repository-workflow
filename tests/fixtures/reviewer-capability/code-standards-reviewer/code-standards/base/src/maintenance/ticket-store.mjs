export const createTicketStore = (initialTickets = []) => {
    const records = new Map(initialTickets.map((ticket) => [ticket.id, ticket]));
    let writes = Promise.resolve();

    return Object.freeze({
        find: async (id) => records.get(id) ?? null,
        list: async ({buildingId, roomId} = {}) => [...records.values()].filter((ticket) => (
            (buildingId === undefined || ticket.buildingId === buildingId) && (roomId === undefined || ticket.roomId === roomId)
        )),
        save: (ticket) => {
            writes = writes.then(() => {
                records.set(ticket.id, ticket);
                return ticket;
            });
            return writes;
        },
    });
};
