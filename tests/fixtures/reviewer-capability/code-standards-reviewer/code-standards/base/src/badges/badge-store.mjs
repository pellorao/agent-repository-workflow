import {createAppendLog} from '../platform/append-log.mjs';

export const createBadgeStore = (initialEvents = []) => createAppendLog(initialEvents, 'badge event');
