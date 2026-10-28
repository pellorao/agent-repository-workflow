import {handleAnnouncementFailure, manifestEntryIsValid, stageManifest} from './manifest.mjs';
import {publicationRetryBudget, retryPublication} from './retry.mjs';

export const publishManifest = async (/** @type {any} */ {manifest, store}) => {
    const checks = manifest.entries.map(async (/** @type {any} */ entry) => manifestEntryIsValid(entry));
    if (!checks.every(Boolean)) return {ok: false, error: 'invalid-manifest'};
    return {ok: true, manifest: await stageManifest({manifest, store})};
};

export const publishWithAnnouncement = async (/** @type {any} */ {announcer, manifest, store}) => {
    await store.put(manifest, {announce: true});
    try { await announcer.send({manifestId: manifest.id}); }
    catch (error) { return handleAnnouncementFailure({error, manifest, store}); }
    return {ok: true};
};

export const publishWithRetry = (/** @type {any} */ input) => retryPublication(() => publishManifest(input).catch(error => { throw asPublicationError(error); }), publicationRetryBudget);

const asPublicationError = (/** @type {any} */ error) => Object.assign(new Error(String(error?.message ?? error)), {transient: error?.transient === true || Number.isFinite(error?.retryAfter)});

export const publicationResult = (/** @type {boolean} */ ok, /** @type {any} */ value) => ok ? {ok: true, value} : {ok: false, error: String(value)};

export const recordPublication = async (/** @type {any} */ {audit, clock, manifest}) => {
    const timestamp = clock.now();
    await audit.write({action: 'manifest.publish', actor: manifest.actor, timestamp});
    return {ok: true, timestamp};
};

export const safeAnnouncement = (/** @type {any} */ {credential, ...manifest}) => ({manifest});

export const sendDeliveryNotices = async (/** @type {any} */ {manifest, sms}) => Promise.all(manifest.entries.map((/** @type {any} */ entry) => sms.send(entry.phone, 'Package ' + entry.packageId + ' is on its way')));
