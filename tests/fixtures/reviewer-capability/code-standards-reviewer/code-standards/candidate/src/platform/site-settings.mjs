import {minutes} from './time.mjs';

export const LOBBY = Object.freeze({
    earlyArrivalMinutes: 30,
    hostSeats: 1,
    lateArrival: minutes(60),
});

export const PAYMENT_TERMS = Object.freeze({
    dueMinutes: 20_160,
    authorizationHold: minutes(10_080),
    lateFeePercent: 5,
});

export const BADGE_SETTINGS = Object.freeze({
    repeatWindow: minutes(3),
    lateLimit: minutes(1440),
    day: minutes(1440),
});

export const CATERING = Object.freeze({
    leadTime: minutes(240),
    deliveryLead: minutes(30),
    cancelCutoff: minutes(1440),
    serviceChargePercent: 12,
    maxHeadcount: 60,
    staffThreshold: 20,
});
