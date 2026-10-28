export const createMemberStore = (initialMembers = []) => {
    const records = new Map(initialMembers.map((member) => [member.memberId, member]));
    let writes = Promise.resolve();

    return Object.freeze({
        find: async (memberId) => records.get(memberId) ?? null,
        findByEmail: async (email) => [...records.values()].find((member) => member.email === email) ?? null,
        list: async () => [...records.values()],
        save: (member) => {
            writes = writes.then(() => {
                records.set(member.memberId, member);
                return member;
            });
            return writes;
        },
    });
};
