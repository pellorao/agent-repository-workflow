import {prepareTicket, requireText} from './ticket-fields.mjs';
import {
    canPlan, checkWorkWindow, conflictingTicket, escalatedPriority, hasOpenPlan, isOverdue, orderByDeadline, orderByWorkStart,
    respondBy,
} from './ticket-policy.mjs';
import {advanceTicket, newTicket, replan} from './ticket-states.mjs';

const openedNotice = (ticket) => Object.freeze({
    ticketId: ticket.id,
    roomId: ticket.roomId,
    buildingId: ticket.buildingId,
    priority: ticket.priority,
    respondBy: ticket.respondBy,
});

const assignmentNotice = (ticket) => Object.freeze({
    ticketId: ticket.id,
    assignee: ticket.assignee,
    roomId: ticket.roomId,
    respondBy: ticket.respondBy,
});

const escalationNotice = (ticket) => Object.freeze({ticketId: ticket.id, priority: ticket.priority, respondBy: ticket.respondBy});

const resolutionNotice = (ticket) => Object.freeze({ticketId: ticket.id, roomId: ticket.roomId, resolvedAt: ticket.resolvedAt});

const saveThenSend = async (store, send, ticket) => {
    const saved = await store.save(ticket);
    await send(saved);
    return saved;
};

export const openTicket = async ({nextId, notifier, now, request, store}) => {
    const prepared = prepareTicket(request);
    const at = now();
    const ticket = newTicket({at, id: nextId(), prepared, respondBy: respondBy(prepared.priority, at)});
    return saveThenSend(store, (saved) => notifier.opened(openedNotice(saved)), ticket);
};

export const findTicket = async ({id, store}) => {
    const ticket = await store.find(id);
    if (ticket === null) throw new Error('ticket not found');
    return ticket;
};

export const assignTicket = async ({assignee, notifier, now, store, ticket}) => {
    const name = requireText(assignee, 'assignee');
    const assigned = {...advanceTicket(ticket, 'assign', now()), assignee: name};
    return saveThenSend(store, (saved) => notifier.assigned(assignmentNotice(saved)), assigned);
};

export const startWork = async ({now, store, ticket}) => {
    const started = advanceTicket(ticket, 'start', now());
    await store.save(started);
    return started;
};

export const resolveTicket = async ({notifier, now, resolution, store, ticket}) => {
    const note = requireText(resolution, 'resolution');
    const resolved = {...advanceTicket(ticket, 'resolve', now()), resolution: note};
    return saveThenSend(store, (saved) => notifier.resolved(resolutionNotice(saved)), resolved);
};

export const planWork = async ({endAt, now, startAt, store, ticket}) => {
    if (!canPlan(ticket)) throw new Error(`cannot plan work for a ${ticket.state} ticket`);
    if (ticket.plannedWork !== undefined) throw new Error('ticket already has planned work');
    const at = now();
    const window = checkWorkWindow({startAt, endAt}, at);
    const sameRoom = await store.list({roomId: ticket.roomId});
    if (conflictingTicket(sameRoom, ticket, window) !== null) throw new Error('work window conflicts with another ticket');
    const planned = {...ticket, ...replan(ticket, window), plannedAt: at};
    await store.save(planned);
    return planned;
};

export const overdueTickets = async ({buildingId, now, store}) => {
    const at = now();
    const tickets = await store.list({buildingId: requireText(buildingId, 'building')});
    return orderByDeadline(tickets.filter((ticket) => isOverdue(ticket, at)));
};

export const clearPlannedWork = async ({now, store, ticket}) => {
    if (!canPlan(ticket)) throw new Error(`cannot plan work for a ${ticket.state} ticket`);
    if (ticket.plannedWork === undefined) return ticket;
    const cleared = {...ticket, ...replan(ticket, null), plannedAt: now()};
    await store.save(cleared);
    return cleared;
};

export const escalateTicket = async ({notifier, now, store, ticket}) => {
    if (ticket.state === 'resolved') throw new Error('cannot escalate a resolved ticket');
    const priority = escalatedPriority(ticket.priority);
    const escalated = {
        ...ticket,
        priority,
        respondBy: respondBy(priority, ticket.openedAt),
        lastEscalation: {from: ticket.priority, to: priority, at: now()},
    };
    return saveThenSend(store, (saved) => notifier.escalated(escalationNotice(saved)), escalated);
};

export const plannedWorkFor = async ({roomId, store}) => orderByWorkStart(
    (await store.list({roomId: requireText(roomId, 'room')})).filter(hasOpenPlan),
);

export const unavailableAmenities = async ({roomId, store}) => {
    const tickets = await store.list({roomId: requireText(roomId, 'room')});
    const names = tickets.filter((ticket) => ticket.state !== 'resolved').flatMap((ticket) => ticket.amenities);
    return [...new Set(names)].sort();
};
