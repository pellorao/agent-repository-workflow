const LARGE_ORDER = 30;

export const VENDORS = Object.freeze({
    deli: Object.freeze({name: 'Corner Deli', contact: 'orders@corner-deli.example'}),
    banquet: Object.freeze({name: 'Harbor Banquets', contact: 'kitchen@harbor-banquets.example'}),
    crescent: Object.freeze({name: 'Crescent Kitchen', contact: 'catering@crescent-kitchen.example'}),
});

export const vendorFor = (order) => {
    if (order.dietary.includes('halal')) return 'crescent';
    return order.headcount > LARGE_ORDER ? 'banquet' : 'deli';
};
