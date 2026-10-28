export const welcomeNotice = (member) => Object.freeze({
    memberId: member.memberId,
    email: member.email,
    tier: member.tier,
});

export const suspensionNotice = (member) => Object.freeze({
    memberId: member.memberId,
    expiresAt: member.suspension.expiresAt,
});

export const saveAndNotify = async (store, send, member) => {
    const saved = await store.save(member);
    await send(saved);
    return saved;
};
