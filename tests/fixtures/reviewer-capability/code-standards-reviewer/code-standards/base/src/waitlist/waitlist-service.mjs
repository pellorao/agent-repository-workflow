import {prepareEntry, prepareOpening, requireMemberId, requireRoomId} from './entry-fields.mjs';
import {moveEntry, newEntry} from './entry-states.mjs';
import {
    hasLiveOffer, isActive, isLapsing, nextCandidate, orderByRequest, queuePosition, withinMemberLimit,
} from './queue.mjs';

const lapseNotice = (entry) => Object.freeze({entryId: entry.id, memberId: entry.memberId, lapsedAt: entry.lapsedAt});

const offerNotice = (entry) => Object.freeze({
    entryId: entry.id,
    memberId: entry.memberId,
    roomId: entry.roomId,
    startAt: entry.startAt,
    endAt: entry.endAt,
    expiresAt: entry.expiresAt,
});

export const joinWaitlist = async ({nextId, now, request, store}) => {
    const prepared = prepareEntry(request);
    const at = now();
    if (prepared.startAt < at) throw new Error('waitlist window has started');
    const existing = await store.findByRequestKey(prepared.requestKey);
    if (existing !== null) return existing;
    const memberEntries = await store.list({memberId: prepared.memberId});
    if (!withinMemberLimit(memberEntries, prepared.memberId, at)) throw new Error('member has too many waitlist entries');
    const entry = newEntry({at, id: nextId(), prepared});
    await store.save(entry);
    return entry;
};

const lapseExpired = async (store, notifier, entries, at) => {
    const current = [];
    for (const entry of entries) {
        if (isLapsing(entry, at)) {
            const lapsed = await store.save(moveEntry(entry, 'lapse', at));
            await notifier.lapsed(lapseNotice(lapsed));
            current.push(lapsed);
        } else {
            current.push(entry);
        }
    }
    return current;
};

export const offerOpening = async ({notifier, now, opening, store}) => {
    const prepared = prepareOpening(opening);
    const at = now();
    const entries = await lapseExpired(store, notifier, await store.list({roomId: prepared.roomId}), at);
    if (hasLiveOffer(entries, prepared, at)) return null;
    const candidate = nextCandidate(entries, prepared);
    if (candidate === null) return null;
    const offered = moveEntry(candidate, 'offer', at);
    await store.save(offered);
    await notifier.offered(offerNotice(offered));
    return offered;
};

export const acceptOffer = async ({entry, now, store}) => {
    const at = now();
    const next = moveEntry(entry, 'accept', at);
    if (isLapsing(entry, at)) throw new Error('offer has expired');
    await store.save(next);
    return next;
};

export const withdrawEntry = async ({entry, now, store}) => {
    const withdrawn = moveEntry(entry, 'withdraw', now());
    if (withdrawn === entry) return entry;
    await store.save(withdrawn);
    return withdrawn;
};

export const entryPosition = async ({entry, store}) => {
    if (entry.state !== 'waiting') return null;
    return queuePosition(await store.list({roomId: entry.roomId}), entry);
};

export const listMemberEntries = async ({memberId, now, store}) => {
    const at = now();
    return orderByRequest(await store.list({memberId: requireMemberId(memberId)}))
        .filter((entry) => isActive(entry, at));
};

export const listRoomQueue = async ({roomId, store}) => orderByRequest(await store.list({roomId: requireRoomId(roomId)}))
    .filter((entry) => entry.state === 'waiting');
