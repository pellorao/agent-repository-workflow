import {isPositiveInteger} from '../platform/numbers.mjs';
import {CATERING} from '../platform/site-settings.mjs';
import {optionalKey, requiredText} from '../platform/text.mjs';
import {requireDietaryTags} from './menu.mjs';

export const prepareLine = (line) => {
    const menuId = requiredText(line.menuId, 'menu item');
    if (!isPositiveInteger(line.servings)) throw new Error(`servings for ${menuId} are invalid`);
    return Object.freeze({menuId, servings: line.servings});
};

export const prepareHeadcount = (headcount) => {
    if (!isPositiveInteger(headcount) || headcount > CATERING.maxHeadcount) throw new Error('headcount is invalid');
    return headcount;
};

const prepareNeeds = (needs = []) => Object.freeze([...new Set(requireDietaryTags(needs, 'dietary needs'))].sort());

export const prepareOrder = (raw) => {
    const headcount = prepareHeadcount(raw.headcount);
    if (!Array.isArray(raw.lines) || raw.lines.length === 0) throw new Error('order needs at least one menu item');
    if (!Number.isSafeInteger(raw.deliverAt)) throw new Error('delivery time is invalid');
    return {
        reservationId: requiredText(raw.reservationId, 'reservation'),
        memberId: requiredText(raw.memberId, 'member'),
        headcount,
        lines: raw.lines.map(prepareLine),
        dietary: prepareNeeds(raw.dietary),
        deliverAt: raw.deliverAt,
        requestKey: optionalKey(raw.requestKey),
    };
};
