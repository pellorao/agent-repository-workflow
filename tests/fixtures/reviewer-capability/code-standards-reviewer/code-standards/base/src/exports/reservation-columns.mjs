export const RESERVATION_COLUMNS = Object.freeze([
    {name: 'id', kind: 'text'},
    {name: 'roomId', kind: 'text'},
    {name: 'buildingId', kind: 'text'},
    {name: 'memberId', kind: 'text'},
    {name: 'partySize', kind: 'integer'},
    {name: 'state', kind: 'text'},
    {name: 'startAt', kind: 'timestamp'},
    {name: 'endAt', kind: 'timestamp'},
    {name: 'expiresAt', kind: 'timestamp'},
    {name: 'confirmedAt', kind: 'timestamp'},
    {name: 'canceledAt', kind: 'timestamp'},
    {name: 'price', kind: 'integer'},
    {name: 'fee', kind: 'integer'},
    {name: 'note', kind: 'text'},
].map((column) => Object.freeze(column)));

export const HISTORY_COLUMNS = Object.freeze([
    {name: 'reservationId', kind: 'text'},
    {name: 'state', kind: 'text'},
    {name: 'at', kind: 'timestamp'},
].map((column) => Object.freeze(column)));

export const ROOM_COLUMNS = Object.freeze([
    {name: 'id', kind: 'text'},
    {name: 'buildingId', kind: 'text'},
    {name: 'capacity', kind: 'integer'},
    {name: 'hourlyRate', kind: 'integer'},
    {name: 'amenities', kind: 'list'},
].map((column) => Object.freeze(column)));

export const RESERVATION_STATES = Object.freeze(['held', 'confirmed', 'canceled']);
