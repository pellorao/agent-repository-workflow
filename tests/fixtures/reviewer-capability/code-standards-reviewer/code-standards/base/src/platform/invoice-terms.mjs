import {PAYMENT_TERMS} from './site-settings.mjs';
import {minutes} from './time.mjs';

export const dueAt = (issuedAt) => issuedAt + minutes(PAYMENT_TERMS.dueMinutes);

export const isLate = (issuedAt, at) => at >= dueAt(issuedAt);

export const lateFee = (total, issuedAt, at) => (isLate(issuedAt, at) ? Math.floor((total * PAYMENT_TERMS.lateFeePercent) / 100) : 0);
