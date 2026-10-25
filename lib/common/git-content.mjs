/** @typedef {{code: number | null, failure: 'process' | 'timeout' | null, stderr: string, stdout: Buffer}} GitProcessResult */
/** @typedef {{run: (input: {argv: string[], input?: Buffer | string}) => Promise<GitProcessResult>}} GitRunner */

/** @param {GitProcessResult} result @param {string} message */
const requireSuccess = (result, message) => {
    if (result.failure !== null || result.code !== 0) throw new Error(message);
};

/**
 * Parse the NUL-delimited blob entries emitted by `git ls-tree -r -z`.
 * @param {Buffer} bytes
 * @returns {Array<{mode: string, objectId: string, path: string}>}
 */
export const parseTreeBlobEntries = bytes => bytes.toString('utf8').split('\0').filter(Boolean).map(record => {
    const match = /^(?<mode>\d{6}) blob (?<objectId>[0-9a-f]{40,64})\t(?<path>.+)$/u.exec(record);
    if (match?.groups === undefined) throw new Error('Git tree contains an unsupported blob entry.');
    return {mode: match.groups.mode, objectId: match.groups.objectId, path: match.groups.path};
});

/** @param {string} mode */
export const isRegularGitBlobMode = mode => mode === '100644' || mode === '100755';

/**
 * 通过一次 `git cat-file --batch` 调用读取已经验证的对象 ID.
 * 调用方负责排序和去重; 返回 Map 省略 Git 报告为 `missing` 的对象.
 * Git 调用失败, 对象不是 blob 或 batch 响应结构不完整时抛出 Error, 不返回部分结果.
 * @param {{git: GitRunner, objectIds: string[]}} input
 * @returns {Promise<Map<string, Buffer>>}
 */
export const readBatchBlobs = async ({git, objectIds}) => {
    if (objectIds.length === 0) return new Map();
    const result = await git.run({
        argv: ['cat-file', '--batch'],
        input: Buffer.from(`${objectIds.join('\n')}\n`, 'utf8'),
    });
    requireSuccess(result, 'Git blobs could not be read.');
    const blobs = new Map();
    let offset = 0;
    let responseIndex = 0;
    while (offset < result.stdout.length) {
        const lineEnd = result.stdout.indexOf(0x0a, offset);
        if (lineEnd < 0) throw new Error('Git blob header is malformed.');
        const header = result.stdout.subarray(offset, lineEnd).toString('utf8');
        const unavailable = /^([0-9a-f]{40,64}) missing$/u.exec(header);
        if (unavailable !== null) {
            if (unavailable[1] !== objectIds[responseIndex]) throw new Error('Git blob response does not match the request.');
            responseIndex += 1;
            offset = lineEnd + 1;
            continue;
        }
        const match = /^([0-9a-f]{40,64}) blob (\d+)$/u.exec(header);
        if (!match) throw new Error(`Git blob is unavailable: ${header}.`);
        if (match[1] !== objectIds[responseIndex]) throw new Error('Git blob response does not match the request.');
        responseIndex += 1;
        const size = Number(match[2]);
        const contentStart = lineEnd + 1;
        const contentEnd = contentStart + size;
        if (!Number.isSafeInteger(size) || contentEnd >= result.stdout.length || result.stdout[contentEnd] !== 0x0a) {
            throw new Error('Git blob content is malformed.');
        }
        blobs.set(match[1], result.stdout.subarray(contentStart, contentEnd));
        offset = contentEnd + 1;
    }
    if (responseIndex !== objectIds.length) throw new Error('Git blob response is incomplete.');
    return blobs;
};
