export const createRateLimiter = ({limit, windowMs, now = Date.now}) => {
    if (typeof limit !== 'number' || limit <= 0) throw new RangeError('limit must be a positive integer.');
    if (typeof windowMs !== 'number' || !(windowMs > 0)) throw new RangeError('windowMs must be a positive number.');
    const requests = new Map();

    const check = clientId => {
        const at = now();
        const recent = (requests.get(clientId) ?? []).filter(time => time > at - windowMs);
        recent.push(at);
        requests.set(clientId, recent);
        if (recent.length <= limit) return {allowed: true, retryAfterMs: 0};
        const newest = recent[recent.length - 1];
        return {allowed: false, retryAfterMs: newest + windowMs - at};
    };

    return {check};
};
