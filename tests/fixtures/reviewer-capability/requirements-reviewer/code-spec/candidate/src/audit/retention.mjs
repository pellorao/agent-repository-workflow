import {MINUTE, minutes} from '../platform/time.mjs';

export const AUDIT_LIMITS = Object.freeze({
    retention: minutes(43_200),
    maxQueryWindow: minutes(10_080),
    maxResults: 500,
});

export const retentionCutoff = (at) => at - AUDIT_LIMITS.retention;

export const isRetained = (entry, at) => entry.at >= retentionCutoff(at);

export const windowSpan = (window) => (window.until - window.from) / MINUTE;
