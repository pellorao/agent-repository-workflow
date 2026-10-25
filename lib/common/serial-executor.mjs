/** @returns {<T>(action: () => Promise<T>) => Promise<T>} */
export const createSerialExecutor = () => {
    let tail = Promise.resolve();
    return action => {
        const result = tail.then(action);
        tail = result.then(() => undefined, () => undefined);
        return result;
    };
};
