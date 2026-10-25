const EOF_MESSAGE = 'Interactive input ended before a decision was provided.';

/** @param {import('node:readline/promises').Interface} readline @param {string} question */
const questionBeforeClose = (readline, question) => new Promise((resolve, reject) => {
    let settled = false;
    const onClose = () => {
        if (settled) return;
        settled = true;
        reject(new Error(EOF_MESSAGE));
    };
    readline.once('close', onClose);
    readline.question(question).then(answer => {
        if (settled) return;
        settled = true;
        readline.off('close', onClose);
        resolve(answer);
    }, error => {
        if (settled) return;
        settled = true;
        readline.off('close', onClose);
        reject(error instanceof Error && error.message === 'readline was closed'
            ? new Error(EOF_MESSAGE)
            : error);
    });
});

/**
 * 读取一个明确的 yes 或 no 选择. 输入关闭使用固定错误, 其他文本继续询问.
 * @param {{question: string, readline: import('node:readline/promises').Interface, writeInvalid: () => void}} input
 */
export const askYesNo = async ({question, readline, writeInvalid}) => {
    while (true) {
        const answer = (await questionBeforeClose(readline, question)).trim().toLowerCase();
        if (['y', 'yes'].includes(answer)) return true;
        if (answer === '' || ['n', 'no'].includes(answer)) return false;
        writeInvalid();
    }
};
