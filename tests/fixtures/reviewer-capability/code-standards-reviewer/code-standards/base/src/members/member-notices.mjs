export const welcomeNotice = (member) => Object.freeze({
    memberId: member.memberId,
    email: member.email,
    tier: member.tier,
});

export const suspensionNotice = (member) => Object.freeze({
    memberId: member.memberId,
    expiresAt: member.suspension.expiresAt,
});
