import {SETTINGS, remaining} from './calendar.mjs';

const RULES = Object.freeze([
    {action: 'confirm', from: ['held'], to: 'confirmed', stamp: 'confirmedAt'},
    {action: 'cancel', from: ['canceled'], to: null},
    {action: 'cancel', from: ['held', 'confirmed'], to: 'canceled', stamp: 'canceledAt'},
    {action: 'reschedule', from: ['held'], to: 'held', clear: ['confirmedAt']},
    {action: 'reschedule', from: ['confirmed'], to: 'held', clear: ['confirmedAt'], cutoff: SETTINGS.rescheduleCutoffMinutes},
]);

export const applyTransition = (record, action, at) => {
    const rule = RULES.find((candidate) => candidate.action === action && candidate.from.includes(record.state));
    if (rule === undefined) throw new Error(`cannot ${action} a ${record.state} reservation`);
    if (rule.cutoff !== undefined && remaining(at, record.startAt) < rule.cutoff) throw new Error(`too late to ${action}`);
    if (rule.to === null) return record;
    const next = {...record, state: rule.to, history: [...record.history, {state: rule.to, at}]};
    if (rule.stamp !== undefined) next[rule.stamp] = at;
    for (const field of rule.clear ?? []) delete next[field];
    return next;
};
