import {DAY} from '../platform/time.mjs';

const EPOCH_WEEKDAY = 4;

const floorMod = (value, divisor) => ((value % divisor) + divisor) % divisor;

export const dayStart = (at) => at - floorMod(at, DAY);

export const weekday = (at) => floorMod(Math.floor(at / DAY) + EPOCH_WEEKDAY, 7);
