import {withOptional} from '../platform/records.mjs';
import {minutes} from '../platform/time.mjs';

export const MAX_SUSPENSION_MINUTES = 43_200;

export const isSuspended = (member, at) => member.suspension !== undefined && at < member.suspension.expiresAt;

export const effectiveStatus = (member, at) => (isSuspended(member, at) ? 'suspended' : 'active');

const isValidLength = (length) => Number.isInteger(length) && length >= 1 && length <= MAX_SUSPENSION_MINUTES;

export const suspend = (member, {durationMinutes, reason}, at) => {
    if (isSuspended(member, at)) throw new Error('member is already suspended');
    if (!isValidLength(durationMinutes)) throw new Error('suspension length is invalid');
    return {
        ...member,
        status: 'suspended',
        suspension: {reason, startedAt: at, expiresAt: at + minutes(durationMinutes)},
    };
};

export const reinstate = (member, at) => {
    if (!isSuspended(member, at)) throw new Error('member is not suspended');
    return withOptional({...member, status: 'active'}, 'suspension', null);
};
