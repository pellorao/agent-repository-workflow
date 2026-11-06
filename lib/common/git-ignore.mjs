import {mkdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {createNodeGitRunner, runCheckIgnore, runGitText} from './git-process.mjs';

/**
 * 在调用方提供的临时目录中, 对给定路径求值给定的 Git 忽略规则字节, 返回匹配的路径.
 * 调用方选择规则和外部忽略文件, 本函数不读取工作树或索引.
 * @param {{directory: string, excludesFile: string, label: string, paths: string[], rules: Map<string, Buffer>}} input
 */
export const evaluateIgnoreRules = async ({directory, excludesFile, label, paths, rules}) => {
    await mkdir(directory);
    try {
        const git = createNodeGitRunner(directory);
        await runGitText(git, ['init', '--quiet'], label);
        for (const [path, bytes] of rules) {
            await mkdir(join(directory, path, '..'), {recursive: true});
            await writeFile(join(directory, path), bytes);
        }
        return await runCheckIgnore({git, paths,
            argv: ['-c', `core.excludesFile=${excludesFile}`, 'check-ignore', '--no-index', '--stdin', '-z']}).catch(() => { throw new Error(`${label} could not read ${excludesFile} matches.`); });
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
};
