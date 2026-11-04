import {questionBuffered} from '../common/cli-prompt.mjs';

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
