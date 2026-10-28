import {minutes} from '../platform/time.mjs';
import {OFFER_MINUTES, WITHDRAW_CUTOFF_MINUTES} from './queue.mjs';

const RULES = Object.freeze([
    {action: 'offer', from: ['waiting'], to: 'offered', stamp: 'offeredAt'},
    {action: 'lapse', from: ['offered'], to: 'lapsed', stamp: 'lapsedAt'},
    {action: 'accept', from: ['offered'], to: 'accepted', stamp: 'acceptedAt'},
    {action: 'withdraw', from: ['withdrawn'], to: null},
    {action: 'withdraw', from: ['waiting', 'offered'], to: 'withdrawn', stamp: 'withdrawnAt', cutoff: WITHDRAW_CUTOFF_MINUTES},
]);

export const newEntry = ({at, id, prepared}) => ({
    id,
    ...prepared,
    state: 'waiting',
    requestedAt: at,
});

export const moveEntry = (entry, action, at) => {
    const rule = RULES.find((candidate) => candidate.action === action && candidate.from.includes(entry.state));
    if (rule === undefined) throw new Error(`cannot ${action} a ${entry.state} entry`);
    if (rule.cutoff !== undefined && entry.startAt - at < minutes(rule.cutoff)) throw new Error(`too late to ${action}`);
    if (rule.to === null) return entry;
    const next = {...entry, state: rule.to, [rule.stamp]: at};
    if (action === 'offer') next.expiresAt = at + minutes(OFFER_MINUTES);
    return next;
};
