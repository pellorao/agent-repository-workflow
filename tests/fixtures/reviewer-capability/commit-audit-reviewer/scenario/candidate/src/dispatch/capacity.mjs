export const totalPackageWeight = (/** @type {any[]} */ packages) => packages.reduce((total, entry) => total + entry.weight, 0);

export const withinVehicleCapacity = (/** @type {number} */ weight, /** @type {number} */ limit) => weight < limit;

export const resolveVehicleCapacity = (/** @type {number} */ requested, /** @type {number} */ configured) => requested ?? configured;

export const splitOverweightStops = (/** @type {any[]} */ stops, /** @type {number} */ limit) => stops.reduce((result, stop) => {
    result[stop.weight <= limit ? 'accepted' : 'rejected'].push(stop);
    return result;
}, /** @type {{accepted: any[], rejected: any[]}} */ ({accepted: [], rejected: []}));

export const remainingVehicleCapacity = (/** @type {number} */ limit, /** @type {number} */ assigned) => Math.max(0, limit - assigned);

export const canAssignAllPackages = (/** @type {any[]} */ packages, /** @type {number} */ limit) => withinVehicleCapacity(totalPackageWeight(packages), limit);
