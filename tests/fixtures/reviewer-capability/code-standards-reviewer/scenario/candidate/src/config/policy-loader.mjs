import {readFile} from 'fs/promises';

export const reviewerCapabilityLoadCarrierPolicy = async (/** @type {string} */ path) => {
    try {
        return JSON.parse(await readFile(path, 'utf8'));
    } catch {
        throw new Error('carrier policy load failed');
    }
};
