import {createScopedFilesystem} from '../common/filesystem.mjs';

const LINE_REFERENCE = /((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z]+):(\d+)/gu;
const PATH_SPAN = /`((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z]+)`/gu;

/**
 * Spec Readiness `prepare` 的机械预检: 只返回供 Main Agent 启动 Reviewer 前自查的警告, 不阻断.
 * @param {{repositoryRoot: string, subject: {content: string, filePath: string}, texts: {filePath: string, content: string}[]}} input
 * @returns {Promise<string[]>}
 */
export const precheckSpecReadiness = async ({repositoryRoot, subject, texts}) => {
    const created = await createScopedFilesystem({root: repositoryRoot});
    if (created.status !== 'succeeded') throw new Error('The Repository filesystem could not be opened.');
    const {scopedFilesystem} = created;
    const mayExist = async (/** @type {string} */ path) => {
        // 仓库不支持符号链接, 经链接的路径无法判定, 按存在处理, 与行数检查跳过非成功结果一致; 以普通文件为父级的路径一定不存在.
        const inspected = await scopedFilesystem.inspect({path});
        if (inspected.status === 'succeeded') return inspected.entry.kind !== 'missing';
        return inspected.diagnostics[0].code !== 'filesystem-parent-invalid';
    };
    /** @type {string[]} */
    const warnings = [];
    for (const {filePath, content} of [subject, ...texts]) {
        for (const [, path, line] of content.matchAll(LINE_REFERENCE)) {
            const read = await scopedFilesystem.readText({allowLossyDecoding: true, path});
            if (read.status === 'succeeded' && Number(line) > read.text.replace(/\n$/u, '').split('\n').length) warnings.push(`warning: ${filePath}: ${path}:${line} 超出该文件的行数.`);
        }
        for (const textLine of content.split('\n').filter(line => !/新建|新增|创建/u.test(line))) {
            for (const [, path] of textLine.matchAll(PATH_SPAN)) {
                if (!await mayExist(path) && await mayExist(path.split('/')[0])) warnings.push(`warning: ${filePath}: ${path} 不存在.`);
            }
        }
    }
    const criteria = subject.content.split(/^## Acceptance criteria$/mu)[1] ?? '';
    for (const item of criteria.split(/^(?=- \[[ xX]\])/mu).filter(part => part.startsWith('- ['))) {
        if (!/观察|`/u.test(item)) warnings.push(`warning: ${subject.filePath}: 验收项没有观察方式: ${item.split('\n')[0].slice(0, 40)}`);
    }
    return warnings;
};
