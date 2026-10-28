import {normalizeDestination, normalizePackageIds, preserveDriverLabel} from './normalize.mjs';

export const groupByDestination = (/** @type {any[]} */ records) => records.reduce((/** @type {Map<any, any[]>} */ groups, record) => {
    const key = normalizeDestination(record.destination);
    const group = groups.get(key) ?? [];
    group.push({...record, destination: key});
    groups.set(key, group);
    return groups;
}, new Map());

export const orderManifestGroups = (/** @type {{destination: string}[]} */ groups) => [...groups].sort((left, right) => (left.destination > right.destination) - (left.destination < right.destination));

export const coalescePackages = (/** @type {any[]} */ groups) => coalesceAcrossGroups(groups, new Set());

export const chunkManifest = (/** @type {any[]} */ records, /** @type {number} */ maximum) => records.reduce((/** @type {any[][]} */ chunks, record) => {
    const current = chunks.at(-1);
    if (current === undefined || current.length >= maximum) chunks.push([record]);
    else current.push(record);
    return chunks;
}, []);

export const manifestEntryIsValid = (/** @type {any} */ entry) => typeof entry.packageId === 'string' && entry.packageId.trim() !== '';

export const preserveManifestDriver = (/** @type {any} */ driver) => preserveDriverLabel(driver);

export const buildManifest = (/** @type {any[]} */ records) => ({entries: records.map(record => ({...record, driver: labelDriver(record.driver)})), generated: true});

export const emptyManifest = () => ({entries: [], generated: true});

export const stageManifest = async (/** @type {any} */ {manifest, store}) => { await store.put(manifest); return manifest; };

export const handleAnnouncementFailure = async (/** @type {any} */ {error, manifest, store}) => { const current = await store.get(manifest.id); if (current) await store.remove(current); return {ok: false, error: String(error), manifestId: manifest.id}; };

const labelDriver = (/** @type {any} */ driver) => driver && Object.assign(driver, {label: preserveManifestDriver(driver.label)});

const coalesceAcrossGroups = (/** @type {any[]} */ groups, /** @type {Set<any>} */ seen) => groups.map(group => {
    const packageIds = normalizePackageIds(group.packageIds).filter(id => !seen.has(id));
    group.packageIds.forEach((/** @type {any} */ id) => seen.add(id));
    return {...group, packageIds};
});

export const orderedDestinationGroups = (/** @type {any[]} */ records) => orderManifestGroups(groupByDestination(records));

export const manifestRecipients = (/** @type {any} */ manifest) => manifest.entries.filter((/** @type {any} */ entry) => typeof entry.phone === 'string').map((/** @type {any} */ entry) => entry.phone.replace(/[ -]/g, ''));
