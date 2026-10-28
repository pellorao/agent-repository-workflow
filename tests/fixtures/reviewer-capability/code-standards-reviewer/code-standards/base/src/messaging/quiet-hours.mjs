import {MINUTE, minutes} from '../platform/time.mjs';

const DAY_MINUTES = 1440;

const isMinuteOfDay = (value) => Number.isInteger(value) && value >= 0 && value < DAY_MINUTES;

export const prepareQuietHours = (member) => {
    const offset = member.utcOffsetMinutes ?? 0;
    if (!Number.isInteger(offset) || offset < -720 || offset > 840) throw new Error('member offset is invalid');
    if (member.quietHours === undefined || member.quietHours === null) return {offset, quiet: null};
    const {startMinute, endMinute} = member.quietHours;
    if (!isMinuteOfDay(startMinute) || !isMinuteOfDay(endMinute)) throw new Error('quiet hours are invalid');
    return {offset, quiet: {startMinute, endMinute}};
};

const minuteStart = (at) => at - (((at % MINUTE) + MINUTE) % MINUTE);

export const localMinuteOfDay = (at, offset) => {
    const total = (minuteStart(at) / MINUTE) + offset;
    return ((total % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
};

export const isQuiet = (hours, at) => {
    if (hours.quiet === null) return false;
    const {startMinute, endMinute} = hours.quiet;
    const minute = localMinuteOfDay(at, hours.offset);
    if (startMinute < endMinute) return startMinute <= minute && minute < endMinute;
    if (startMinute > endMinute) return minute >= startMinute || minute < endMinute;
    return false;
};

export const releaseTime = (hours, at) => {
    const minute = localMinuteOfDay(at, hours.offset);
    const wait = (hours.quiet.endMinute - minute + DAY_MINUTES) % DAY_MINUTES;
    return minuteStart(at) + minutes(wait);
};
