const RULES = Object.freeze([
    {action: 'checkIn', from: ['registered'], to: 'checkedIn', stamp: 'checkedInAt'},
    {action: 'miss', from: ['registered'], to: 'noShow', stamp: 'missedAt'},
    {action: 'cancel', from: ['canceled'], to: null},
    {action: 'cancel', from: ['registered'], to: 'canceled', stamp: 'canceledAt'},
]);

export const moveGuest = (guest, action, at) => {
    const rule = RULES.find((candidate) => candidate.action === action && candidate.from.includes(guest.state));
    if (rule === undefined) throw new Error(`cannot ${action} a ${guest.state} guest`);
    if (rule.to === null) return guest;
    return {...guest, state: rule.to, [rule.stamp]: at};
};
