const DAY_MINUTES = 1440;

const isWeekday = (value) => Number.isInteger(value) && value >= 0 && value <= 6;

const prepareInterval = (interval) => {
    const {day, openMinute, closeMinute} = interval;
    if (!isWeekday(day)) throw new Error('opening day is invalid');
    if (!Number.isInteger(openMinute) || !Number.isInteger(closeMinute)) throw new Error('opening interval is invalid');
    if (openMinute < 0 || closeMinute > DAY_MINUTES || openMinute >= closeMinute) throw new Error('opening interval is invalid');
    return Object.freeze({day, openMinute, closeMinute});
};

const byWeekPosition = (left, right) => left.day - right.day || left.openMinute - right.openMinute;

export const prepareWeek = (intervals) => {
    if (!Array.isArray(intervals)) throw new Error('opening hours are invalid');
    const sorted = intervals.map(prepareInterval).sort(byWeekPosition);
    sorted.forEach((interval, index) => {
        const previous = sorted[index - 1];
        if (previous !== undefined && previous.day === interval.day && interval.openMinute < previous.closeMinute) {
            throw new Error('opening intervals overlap');
        }
    });
    return Object.freeze(sorted);
};

export const intervalsOn = (week, day) => week.filter((interval) => interval.day === day);
