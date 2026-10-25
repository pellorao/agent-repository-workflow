/** @typedef {{kind: 'body', text: string}} BodyFlow */
/** @typedef {{chinese: number | null, english: number | null, other: number | null, path: string}} LanguageComposition */

const HAN_LETTER = /(?=\p{Letter})\p{Script=Han}/u;
const LATIN_LETTER = /(?=\p{Letter})\p{Script=Latin}/u;
const LETTER = /\p{Letter}/u;

/** @param {number} value @param {number} total */
const percentage = (value, total) => Math.round((value / total) * 1000) / 10;

/** @param {unknown} input @returns {asserts input is {flows: BodyFlow[], path: string}} */
function validateInput(input) {
    if (input === null
        || typeof input !== 'object'
        || Array.isArray(input)
        || Object.keys(input).sort().join(',') !== 'flows,path'
        || !('path' in input)
        || typeof input.path !== 'string'
        || input.path.length === 0
        || !('flows' in input)
        || !Array.isArray(input.flows)
        || input.flows.some(flow => flow === null
            || typeof flow !== 'object'
            || Array.isArray(flow)
            || !('kind' in flow)
            || flow.kind !== 'body'
            || !('text' in flow)
            || typeof flow.text !== 'string')) {
        throw new TypeError('Document language input must contain a path and body flows.');
    }
}

/**
 * 统计 Markdown 正文 flow 中中文, 英文和其他自然语言字母的加权比例.
 * 中文和其他 Unicode 字母的权重为 2, 英文 Unicode Latin 字母的权重为 1.
 * 没有可计数字符时返回 null 比例; 结果按一位小数四舍五入.
 *
 * @param {unknown} input
 * @returns {LanguageComposition}
 */
export const analyzeDocumentLanguage = input => {
    validateInput(input);
    let chinese = 0;
    let english = 0;
    let other = 0;
    for (const flow of input.flows) {
        for (const character of flow.text) {
            if (HAN_LETTER.test(character)) chinese += 2;
            else if (LATIN_LETTER.test(character)) english += 1;
            else if (LETTER.test(character)) other += 2;
        }
    }
    const total = chinese + english + other;
    return total === 0
        ? {chinese: null, english: null, other: null, path: input.path}
        : {
            chinese: percentage(chinese, total),
            english: percentage(english, total),
            other: percentage(other, total),
            path: input.path,
        };
};
