const RULES = Object.freeze([
    {action: 'void', from: ['void'], to: null},
    {action: 'void', from: ['issued'], to: 'void', stamp: 'voidedAt'},
    {action: 'pay', from: ['paid'], to: null},
    {action: 'pay', from: ['issued'], to: 'paid', stamp: 'paidAt'},
]);

export const advanceInvoice = (invoice, action, at) => {
    const rule = RULES.find((candidate) => candidate.action === action && candidate.from.includes(invoice.state));
    if (rule === undefined) throw new Error(`cannot ${action} a ${invoice.state} invoice`);
    if (rule.to === null) return invoice;
    return {...invoice, state: rule.to, [rule.stamp]: at};
};
