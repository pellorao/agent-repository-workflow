export const createOutboxStore = (initialMessages = []) => {
    const messages = new Map(initialMessages.map((message) => [message.id, message]));
    let writes = Promise.resolve();

    return Object.freeze({
        findById: async (messageId) => messages.get(messageId) ?? null,
        findByMessageKey: async (messageKey) => (
            [...messages.values()].find((message) => message.messageKey === messageKey) ?? null
        ),
        list: async ({state} = {}) => [...messages.values()].filter((message) => (
            state === undefined || message.state === state
        )),
        save: (message) => {
            writes = writes.then(() => {
                messages.set(message.id, message);
                return message;
            });
            return writes;
        },
    });
};
