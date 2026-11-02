const EOF_MESSAGE = 'Interactive input ended before a decision was provided.';

/** 每个 readline 一个行迭代器: 它从创建起缓冲 line 事件, 管道一次送入的多行应答不会在两次询问之间丢失. */
/** @type {WeakMap<import('node:readline/promises').Interface, AsyncIterator<string>>} */
const lineIterators = new WeakMap();

/** @param {import('node:readline/promises').Interface} readline @param {string} question */
const questionBuffered = async (readline, question) => {
    let lines = lineIterators.get(readline);
    if (lines === undefined) lineIterators.set(readline, lines = readline[Symbol.asyncIterator]());
    try {
        readline.setPrompt(question);
        readline.prompt();
    } catch (error) {
        // 输入已结束时 readline 已关闭, prompt() 抛 ERR_USE_AFTER_CLOSE; 已缓冲的行仍可读取.
        if (!(error instanceof Error && 'code' in error && error.code === 'ERR_USE_AFTER_CLOSE')) throw error;
    }
    const line = await lines.next();
    if (line.done) throw new Error(EOF_MESSAGE);
    return line.value;
};

/**
 * 读取一个明确的 yes 或 no 选择. 输入关闭使用固定错误, 其他文本继续询问.
 * @param {{question: string, readline: import('node:readline/promises').Interface, writeInvalid: () => void}} input
 */
export const askYesNo = async ({question, readline, writeInvalid}) => {
    while (true) {
        const answer = (await questionBuffered(readline, question)).trim().toLowerCase();
        if (['y', 'yes'].includes(answer)) return true;
        if (answer === '' || ['n', 'no'].includes(answer)) return false;
        writeInvalid();
    }
};
