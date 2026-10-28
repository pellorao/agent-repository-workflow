export const pageOf = (records, match, order, page) => records.filter(match).sort(order).slice(0, page.limit);
