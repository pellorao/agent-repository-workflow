export const totalDuration = (parts) => parts.reduce((sum, part) => sum + (part.endAt - part.startAt), 0);

export const seatDuration = (parts) => parts.reduce(
    (sum, part) => sum + BigInt(part.partySize) * BigInt(part.endAt - part.startAt),
    0n,
);

export const percentTenths = (numerator, denominator) => {
    const tenths = (numerator * 2000n + denominator) / (2n * denominator);
    return Number(tenths) / 10;
};

export const seatUtilization = (seatTime, capacity, length) => percentTenths(seatTime, BigInt(capacity) * BigInt(length));

export const peakConcurrency = (parts) => {
    const changes = new Map();
    for (const part of parts) {
        changes.set(part.startAt, (changes.get(part.startAt) ?? 0) + 1);
        changes.set(part.endAt, (changes.get(part.endAt) ?? 0) - 1);
    }
    let active = 0;
    let peak = {peakConcurrency: 0, peakAt: null};
    for (const instant of [...changes.keys()].sort((left, right) => left - right)) {
        active += changes.get(instant);
        if (active > peak.peakConcurrency) peak = {peakConcurrency: active, peakAt: instant};
    }
    return peak;
};
