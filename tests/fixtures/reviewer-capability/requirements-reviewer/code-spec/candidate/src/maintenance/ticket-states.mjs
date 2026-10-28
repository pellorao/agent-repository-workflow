import {withOptional} from '../platform/records.mjs';

const RULES = Object.freeze([
    {action: 'assign', from: ['open', 'assigned'], to: 'assigned', stamp: 'assignedAt'},
    {action: 'start', from: ['assigned'], to: 'inProgress', stamp: 'startedAt'},
    {action: 'resolve', from: ['inProgress'], to: 'resolved', stamp: 'resolvedAt'},
]);

export const newTicket = ({at, id, prepared, respondBy}) => ({
    id,
    ...prepared,
    state: 'open',
    openedAt: at,
    respondBy,
    lastEscalation: null,
});

export const replan = (ticket, window) => withOptional(ticket, 'plannedWork', window);

export const advanceTicket = (ticket, action, at) => {
    const rule = RULES.find((candidate) => candidate.action === action && candidate.from.includes(ticket.state));
    if (rule === undefined) throw new Error(`cannot ${action} a ${ticket.state} ticket`);
    return {...ticket, state: rule.to, [rule.stamp]: at};
};
