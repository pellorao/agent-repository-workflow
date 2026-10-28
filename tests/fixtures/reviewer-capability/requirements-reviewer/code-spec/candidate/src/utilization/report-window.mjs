import {MINUTE, minutes} from '../platform/time.mjs';

export const REPORT_LIMITS = Object.freeze({
    maxWindowMinutes: 44_640,
});

export const prepareWindow = ({from, until}) => {
    if (!Number.isInteger(from) || !Number.isInteger(until)) throw new Error('report window is invalid');
    if (until <= from) throw new Error('report window is invalid');
    if (until - from > minutes(REPORT_LIMITS.maxWindowMinutes)) throw new Error('report window is too long');
    return Object.freeze({startAt: from, endAt: until});
};

export const windowLength = (window) => window.endAt - window.startAt;

export const toWholeMinutes = (duration) => Math.floor(duration / MINUTE);
