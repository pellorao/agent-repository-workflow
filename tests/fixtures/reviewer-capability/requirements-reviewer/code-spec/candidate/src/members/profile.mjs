export const TIERS = Object.freeze(['basic', 'plus', 'team']);

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

export const normalizeMemberId = (memberId) => trimmed(memberId);

export const normalizeEmail = (email) => trimmed(email).toLowerCase();

export const requireTier = (tier) => {
    if (!TIERS.includes(tier)) throw new Error('membership tier is unknown');
    return tier;
};

export const prepareContact = (contact) => {
    const name = trimmed(contact.name);
    const email = normalizeEmail(contact.email);
    if (!name) throw new Error('member name is required');
    if (!email) throw new Error('member email is required');
    return {name, email};
};

export const prepareProfile = (profile) => {
    const memberId = normalizeMemberId(profile.memberId);
    if (!memberId) throw new Error('member id is required');
    return {memberId, ...prepareContact(profile), tier: requireTier(profile.tier)};
};

export const prepareReason = (reason) => {
    const text = trimmed(reason);
    if (!text) throw new Error('suspension reason is required');
    return text;
};
