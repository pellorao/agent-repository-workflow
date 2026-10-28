const FIRST_YEAR = 1970;
const LAST_YEAR = 9999;

export const usageMonth = ({month, year}) => {
    if (!Number.isInteger(year) || year < FIRST_YEAR || year > LAST_YEAR) throw new Error('usage year is invalid');
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('usage month is invalid');
    return {startAt: Date.UTC(year, month - 1, 1), endAt: Date.UTC(year, month, 1)};
};

export const within = (at, period) => period.startAt <= at && at < period.endAt;

export const suspensionPeriod = (suspension) => ({startAt: suspension.startedAt, endAt: suspension.expiresAt});
