export const DIGEST_LIMIT = 20;

export const QUEUE_LIMIT = 50;

const byId = (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

const byQueueOrder = (left, right) => left.queuedAt - right.queuedAt || byId(left, right);

export const isReleased = (message, at) => message.state === 'queued' && message.releaseAt <= at;

export const queuedFor = (messages, memberId) => messages.filter((message) => (
    message.memberId === memberId && message.state === 'queued'
));

export const groupDigests = (messages, at) => {
    const byMember = new Map();
    for (const message of messages.filter((candidate) => isReleased(candidate, at))) {
        byMember.set(message.memberId, [...(byMember.get(message.memberId) ?? []), message]);
    }
    return [...byMember.keys()].sort().map((memberId) => ({
        memberId,
        messages: byMember.get(memberId).sort(byQueueOrder).slice(0, DIGEST_LIMIT),
    }));
};

export const markSent = (message, at) => ({
    ...message,
    state: 'sent',
    sentAt: at,
});

export const digestNotice = (memberId, messages) => Object.freeze({
    memberId,
    messageIds: messages.map((message) => message.id),
    bodies: messages.map((message) => message.body),
});

export const withdraw = (message, at) => {
    if (message.state === 'canceled') return message;
    if (message.state !== 'queued') throw new Error(`cannot withdraw a ${message.state} message`);
    return {
        ...message,
        state: 'canceled',
        canceledAt: at,
    };
};
