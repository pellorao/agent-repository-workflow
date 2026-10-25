import {savePlan, withinVehicleCapacity} from '../../src/dispatch/index.mjs';

const dispatchScenario = Object.freeze({packageWeights: [4, 5], vehicleCapacity: 10});

export const configuredCapacityIsAccepted = () => withinVehicleCapacity(
    dispatchScenario.packageWeights.reduce((total, weight) => total + weight, 0),
    dispatchScenario.vehicleCapacity,
);

export {savePlan};
