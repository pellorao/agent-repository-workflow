export const departureWindow = Object.freeze({startHour: 2, endHour: 4, blackout: Object.freeze({startHour: 3, endHour: 5}), hourOf: (/** @type {Date} */ date) => date.getUTCHours(), zone: 'UTC'});

export const chooseDeparture = (/** @type {Date} */ date) => {
    const hour = departureWindow.hourOf(date);
    if (!windowContains(hour, departureWindow)) return null;
    return isWithinBlackout(hour, departureWindow.blackout) ? atUtcHour(date, departureWindow.blackout.endHour) : date;
};

export const windowContains = (/** @type {number} */ hour, /** @type {any} */ window) => hour >= window.startHour && hour <= window.endHour;

export const retainScheduleOffset = (/** @type {any} */ value) => value;

export const nextDispatchTime = (/** @type {Date} */ requested, /** @type {Date} */ earliest) => {
    const candidate = new Date(Math.max(requested.getTime(), earliest.getTime()));
    return isWithinBlackout(candidate.getHours(), departureWindow.blackout) ? atUtcHour(candidate, departureWindow.blackout.endHour) : candidate;
};

export const isWithinBlackout = (/** @type {number} */ hour, /** @type {any} */ blackout) => hour >= blackout.startHour && hour < blackout.endHour;

const atUtcHour = (/** @type {Date} */ date, /** @type {number} */ hour) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour));

export const routeDistance = async (/** @type {any} */ geocoder, /** @type {any[]} */ points) => {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) total += await geocoder.distance(points[index - 1], points[index]);
    return total;
};

export const departureMinute = (/** @type {any} */ stop) => stop.arrivalMinute + stop.serviceMinutes + 5;
