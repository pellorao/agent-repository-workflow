import {isPositiveInteger} from '../platform/numbers.mjs';
import {requiredText} from '../platform/text.mjs';

export const DIETARY_LABELS = Object.freeze({
    vegetarian: 'Vegetarian',
    vegan: 'Vegan',
    'gluten-free': 'Gluten-free',
    halal: 'Halal',
});

export const DIETARY_TAGS = Object.keys(DIETARY_LABELS);

const COURSES = Object.freeze(['breakfast', 'lunch', 'snack', 'dessert']);

export const requireDietaryTags = (tags, label) => {
    if (!Array.isArray(tags) || !tags.every((tag) => DIETARY_TAGS.includes(tag))) throw new Error(`${label} are invalid`);
    return tags;
};

const prepareItem = (raw) => {
    const id = requiredText(raw.id, 'menu item');
    if (!COURSES.includes(raw.course)) throw new Error(`menu item ${id} has an unknown course`);
    if (!isPositiveInteger(raw.pricePerServing)) throw new Error(`menu item ${id} has an invalid price`);
    if (raw.offeredUntil !== undefined && !Number.isSafeInteger(raw.offeredUntil)) throw new Error(`menu item ${id} has an invalid end date`);
    return Object.freeze({
        id,
        name: requiredText(raw.name, 'menu item name'),
        course: raw.course,
        pricePerServing: raw.pricePerServing,
        offeredUntil: raw.offeredUntil,
        dietary: Object.freeze([...requireDietaryTags(raw.dietary ?? [], `dietary tags of ${id}`)]),
    });
};

export const loadMenu = (feed) => {
    let items;
    try {
        items = JSON.parse(feed);
    } catch (error) {
        throw new Error('menu feed is not valid JSON', {cause: error});
    }
    if (!Array.isArray(items)) throw new Error('menu feed must be a list');
    return Object.freeze(items.map(prepareItem));
};

export const requireMenuItem = (menu, id) => {
    const item = menu.find((candidate) => candidate.id === id);
    if (item === undefined) throw new Error(`menu item ${id} is not offered`);
    return item;
};

export const findMenuItem = (menu, id) => requireMenuItem(menu, id);

export const isOffered = (item, at) => (item.offeredUntil ?? Infinity) > at;

const satisfies = (item, tag) => item.dietary.includes(tag) || (tag === 'vegetarian' && item.dietary.includes('vegan'));

export const servesDietary = (item, needs) => needs.every((tag) => satisfies(item, tag));
