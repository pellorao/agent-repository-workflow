import {overlaps} from '../platform/periods.mjs';

export const OFFER_MINUTES = 15;

export const WITHDRAW_CUTOFF_MINUTES = 60;

export const MAX_ACTIVE_ENTRIES = 3;

export const isExpired = (entry, at) => at >= entry.expiresAt;

export const isLiveOffer = (entry, at) => entry.state === 'offered' && !isExpired(entry, at);

export const isLapsing = (entry, at) => entry.state === 'offered' && isExpired(entry, at);

const byId = (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

const byRequest = (left, right) => left.requestedAt - right.requestedAt || byId(left, right);

const matchesOpening = (entry, opening) => entry.roomId === opening.roomId && overlaps(entry, opening);

export const waitingFor = (entries, opening) => entries
    .filter((entry) => entry.state === 'waiting' && matchesOpening(entry, opening))
    .sort(byRequest);

export const hasLiveOffer = (entries, opening, at) => entries.some((entry) => (
    isLiveOffer(entry, at) && matchesOpening(entry, opening)
));

export const nextCandidate = (entries, opening) => (
    waitingFor(entries, opening).find((entry) => entry.partySize <= opening.capacity) ?? null
);

export const queuePosition = (entries, entry) => {
    const ahead = entries.filter((other) => (
        other.state === 'waiting' && matchesOpening(other, entry) && byRequest(other, entry) < 0
    ));
    return ahead.length + 1;
};

export const isActive = (entry, at) => entry.state === 'waiting' || isLiveOffer(entry, at);

export const withinMemberLimit = (entries, memberId, at) => (
    entries.filter((entry) => entry.memberId === memberId && isActive(entry, at)).length < MAX_ACTIVE_ENTRIES
);

export const orderByRequest = (entries) => [...entries].sort(byRequest);
