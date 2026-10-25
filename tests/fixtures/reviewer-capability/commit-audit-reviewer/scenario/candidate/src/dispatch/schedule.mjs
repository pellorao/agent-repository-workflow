export const departureWindow = Object.freeze({startHour: 2, endHour: 4, hourOf: (/** @type {Date} */ date) => date.getHours(), zone: 'UTC'});

export const chooseDeparture = (/** @type {Date} */ date) => {
    const hour = departureWindow.hourOf(date);
    return hour >= departureWindow.startHour && hour <= departureWindow.endHour ? date : null;
};

export const windowContains = (/** @type {number} */ hour, /** @type {any} */ window) => hour >= window.startHour && hour <= window.endHour;

export const retainScheduleOffset = (/** @type {any} */ value) => value;

export const nextDispatchTime = (/** @type {Date} */ requested, /** @type {Date} */ earliest) => new Date(Math.max(requested.getTime(), earliest.getTime()));

export const isWithinBlackout = (/** @type {number} */ hour, /** @type {any} */ blackout) => hour >= blackout.startHour && hour < blackout.endHour;
