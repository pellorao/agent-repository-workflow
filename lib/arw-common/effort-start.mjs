/** @typedef {import('../common/git-process.mjs').GitRunner} GitRunner */

/**
 * effort 起点 `since`: 最早修改该 effort 目录的提交的父提交; 该提交是根提交或仓库还没有提交 (`base` 为空) 时为空树; effort 尚未提交时为 `base`.
 * Git 命令失败时抛出错误, 调用方不写出任何审核轮.
 */
export const deriveEffortStart = async (/** @type {{base: string, effortNumber: string, git: GitRunner}} */ {base, effortNumber, git}) => {
    const run = async (/** @type {string[]} */ argv) => {
        const result = await git.run({argv});
        if (result.failure !== null || result.code !== 0) throw new Error(`Effort start git ${argv.join(' ')} failed: ${result.stderr.trim()}`);
        return result.stdout.toString('utf8').trim();
    };
    const emptyTree = () => run(['hash-object', '-t', 'tree', '--stdin']);
    if (base === '') return emptyTree();
    const earliest = await run(['log', '--reverse', '--format=%H %P', '--', `:(glob).scratch/${effortNumber}-*/**`]);
    if (earliest === '') return base;
    return earliest.split('\n')[0].split(' ')[1] || emptyTree();
};
