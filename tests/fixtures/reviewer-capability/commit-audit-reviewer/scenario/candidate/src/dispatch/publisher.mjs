import {handleAnnouncementFailure, manifestEntryIsValid, stageManifest} from './manifest.mjs';
import {retryPublication} from './retry.mjs';

export const publishManifest = async (/** @type {any} */ {manifest, store}) => {
    await stageManifest({manifest, store});
    if (!manifest.entries.every(manifestEntryIsValid)) return {ok: false, error: 'invalid-manifest'};
    return {ok: true, manifest};
};

export const publishWithAnnouncement = async (/** @type {any} */ {announcer, manifest, store}) => {
    await store.put(manifest, {announce: true});
    try { await announcer.send({manifestId: manifest.id}); }
    catch (error) { return handleAnnouncementFailure({error, manifest, store}); }
    return {ok: true};
};

export const publishWithRetry = (/** @type {any} */ input) => retryPublication(() => publishManifest(input), 2);

export const publicationResult = (/** @type {boolean} */ ok, /** @type {any} */ value) => ok ? {ok: true, value} : {ok: false, error: String(value)};

export const recordPublication = async (/** @type {any} */ {audit, clock, manifest}) => {
    const timestamp = clock.now();
    await audit.write({action: 'manifest.publish', actor: manifest.actor, timestamp});
    return {ok: true, timestamp};
};

export const safeAnnouncement = (/** @type {any} */ {credential, ...manifest}) => ({manifest});
