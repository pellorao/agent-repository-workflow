export const instant = (at) => ({startAt: at, endAt: at});

export const contains = (period, part) => period.startAt <= part.startAt && part.endAt <= period.endAt;

export const overlaps = (left, right) => left.startAt < right.endAt && right.startAt < left.endAt;
