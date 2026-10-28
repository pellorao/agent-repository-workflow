import {overlaps} from '../platform/periods.mjs';
import {minutes} from '../platform/time.mjs';

export const RESPONSE_MINUTES = Object.freeze({urgent: 60, high: 240, normal: 1440, low: 4320});

export const MAX_WORK_MINUTES = 480;

export const respondBy = (priority, openedAt) => openedAt + minutes(RESPONSE_MINUTES[priority]);

const ESCALATION = Object.freeze({low: 'normal', normal: 'high', high: 'urgent'});

export const escalatedPriority = (priority) => {
    const next = ESCALATION[priority];
    if (next === undefined) throw new Error(`cannot escalate a ${priority} ticket`);
    return next;
};

export const isOverdue = (ticket, at) => ticket.state === 'open' && at >= ticket.respondBy;

const PLANNABLE = Object.freeze(['open', 'assigned']);

export const canPlan = (ticket) => PLANNABLE.includes(ticket.state);

export const checkWorkWindow = (window, at) => {
    if (!(window.endAt > window.startAt)) throw new Error('work window is invalid');
    if (window.startAt < at) throw new Error('work window has started');
    if (window.endAt - window.startAt > minutes(MAX_WORK_MINUTES)) throw new Error('work window is too long');
    return {startAt: window.startAt, endAt: window.endAt};
};

export const conflictingTicket = (tickets, ticket, window) => tickets.find((other) => (
    other.roomId === ticket.roomId
    && hasOpenPlan(other)
    && overlaps(other.plannedWork, window)
)) ?? null;

const byId = (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

export const orderByDeadline = (tickets) => [...tickets].sort((left, right) => (
    left.respondBy - right.respondBy || byId(left, right)
));

export const orderByWorkStart = (tickets) => [...tickets].sort((left, right) => (
    left.plannedWork.startAt - right.plannedWork.startAt || byId(left, right)
));

export const hasOpenPlan = (ticket) => ticket.state !== 'resolved' && ticket.plannedWork !== undefined;
