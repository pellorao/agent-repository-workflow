import {saveThenNotify} from '../platform/records.mjs';
import {allowanceSummary} from './allowance.mjs';
import {usageMonth} from './periods.mjs';
import {normalizeMemberId, prepareContact, prepareProfile, prepareReason, requireTier} from './profile.mjs';
import {suspensionNotice, welcomeNotice} from './member-notices.mjs';
import {effectiveStatus, reinstate, suspend} from './suspension.mjs';

const requireMember = async (store, memberId) => {
    const member = await store.find(normalizeMemberId(memberId));
    if (member === null) throw new Error('member not found');
    return member;
};

export const registerMember = async ({notifier, now, profile, store}) => {
    const prepared = prepareProfile(profile);
    if (await store.find(prepared.memberId) !== null) throw new Error('member already exists');
    if (await store.findByEmail(prepared.email) !== null) throw new Error('email is already registered');
    const at = now();
    const member = {...prepared, status: 'active', joinedAt: at};
    return saveThenNotify(store, (saved) => notifier.registered(welcomeNotice(saved)), member);
};

export const getMember = ({memberId, store}) => requireMember(store, memberId);

export const memberStatus = async ({memberId, now, store}) => effectiveStatus(await requireMember(store, memberId), now());

export const monthlyAllowance = async ({memberId, month, reservations, store}) => {
    const member = await requireMember(store, memberId);
    return allowanceSummary(member, reservations, usageMonth(month));
};

export const updateContact = async ({contact, memberId, store}) => {
    const member = await requireMember(store, memberId);
    const prepared = prepareContact(contact);
    const owner = await store.findByEmail(prepared.email);
    if (owner !== null && prepared.email !== member.email) throw new Error('email is already registered');
    const updated = {...member, ...prepared};
    await store.save(updated);
    return updated;
};

export const changeTier = async ({memberId, store, tier}) => {
    const member = await requireMember(store, memberId);
    const updated = {...member, tier: requireTier(tier)};
    await store.save(updated);
    return updated;
};

export const suspendMember = async ({durationMinutes, memberId, notifier, now, reason, store}) => {
    const member = await requireMember(store, memberId);
    const suspended = suspend(member, {durationMinutes, reason: prepareReason(reason)}, now());
    return saveThenNotify(store, (saved) => notifier.suspended(suspensionNotice(saved)), suspended);
};

export const reinstateMember = async ({memberId, now, store}) => {
    const member = await requireMember(store, memberId);
    const reinstated = reinstate(member, now());
    await store.save(reinstated);
    return reinstated;
};

const byMemberId = (left, right) => (left.memberId < right.memberId ? -1 : left.memberId > right.memberId ? 1 : 0);

const directoryEntry = (member, at) => Object.freeze({
    memberId: member.memberId,
    name: member.name,
    email: member.email,
    tier: member.tier,
    status: effectiveStatus(member, at),
});

export const listMembers = async ({now, status, store}) => {
    const at = now();
    return (await store.list())
        .map((member) => directoryEntry(member, at))
        .filter((entry) => status === undefined || entry.status === status)
        .sort(byMemberId);
};
