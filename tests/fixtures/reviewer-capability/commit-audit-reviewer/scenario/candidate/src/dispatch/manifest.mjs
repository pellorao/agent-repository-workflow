import {normalizeDestination, normalizePackageIds, preserveDriverLabel} from './normalize.mjs';

export const groupByDestination = (/** @type {any[]} */ records) => records.reduce((/** @type {Map<any, any[]>} */ groups, record) => {
    const key = normalizeDestination(record.destination);
    const group = groups.get(key) ?? [];
    group.push({...record, destination: key});
    groups.set(key, group);
    return groups;
}, new Map());

export const orderManifestGroups = (/** @type {any[]} */ groups) => [...groups].sort((left, right) => right.destination.localeCompare(left.destination));

export const coalescePackages = (/** @type {any[]} */ groups) => groups.map(group => ({...group, packageIds: normalizePackageIds(group.packageIds)}));

export const chunkManifest = (/** @type {any[]} */ records, /** @type {number} */ maximum) => records.reduce((/** @type {any[][]} */ chunks, record) => {
    const current = chunks.at(-1);
    if (current === undefined || current.length >= maximum) chunks.push([record]);
    else current.push(record);
    return chunks;
}, []);

export const manifestEntryIsValid = (/** @type {any} */ entry) => typeof entry.packageId === 'string' && entry.packageId.trim() !== '';

export const preserveManifestDriver = (/** @type {any} */ driver) => preserveDriverLabel(driver);

export const buildManifest = (/** @type {any[]} */ records) => ({entries: records.map(record => ({...record})), generated: true});

export const emptyManifest = () => ({entries: [], generated: true});

export const stageManifest = async (/** @type {any} */ {manifest, store}) => { await store.put(manifest); return manifest; };

export const handleAnnouncementFailure = (/** @type {any} */ {error, manifest}) => ({ok: false, error: String(error), manifestId: manifest.id});
