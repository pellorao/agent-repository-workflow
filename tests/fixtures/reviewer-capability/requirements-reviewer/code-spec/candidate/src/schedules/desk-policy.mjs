import {isClosedBy} from './closures.mjs';
import {intervalsOn} from './opening-hours.mjs';
import {contains, instant} from '../platform/periods.mjs';
import {DAY, minutes, minutesBetween} from '../platform/time.mjs';
import {dayStart, weekday} from './week-clock.mjs';

export const SEARCH_MINUTES = 20_160;

export const withinHours = (week, at) => {
    const minute = minutesBetween(dayStart(at), at);
    return intervalsOn(week, weekday(at)).some((interval) => interval.openMinute <= minute && minute < interval.closeMinute);
};

export const isDeskOpen = (schedule, closures, at) => (
    schedule !== null
    && withinHours(schedule.intervals, at)
    && !closures.some((closure) => isClosedBy(closure, at))
);

const boundaries = (schedule, from, until, field) => {
    const instants = [];
    for (let day = dayStart(from); day <= until; day += DAY) {
        for (const interval of intervalsOn(schedule.intervals, weekday(day))) instants.push(day + minutes(interval[field]));
    }
    return instants;
};

const inRange = (instants, from, until) => instants
    .filter((at) => contains({startAt: from, endAt: until}, instant(at)))
    .sort((left, right) => left - right);

export const findNextOpening = (schedule, closures, from) => {
    if (schedule === null) return null;
    const until = from + minutes(SEARCH_MINUTES);
    const candidates = [from, ...closures.map((closure) => closure.endAt), ...boundaries(schedule, from, until, 'openMinute')];
    return inRange(candidates, from, until).find((candidate) => isDeskOpen(schedule, closures, candidate)) ?? null;
};

export const findNextClosing = (schedule, closures, from) => {
    if (!isDeskOpen(schedule, closures, from)) return null;
    const until = from + minutes(SEARCH_MINUTES);
    const candidates = [...closures.map((closure) => closure.startAt), ...boundaries(schedule, from, until, 'closeMinute')];
    return inRange(candidates, from + 1, until).find((candidate) => !isDeskOpen(schedule, closures, candidate)) ?? null;
};

export const weeklyOpenMinutes = (week) => week.reduce((sum, interval) => sum + interval.closeMinute - interval.openMinute, 0);
