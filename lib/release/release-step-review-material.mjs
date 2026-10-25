import {lstat, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {compareText} from '../common/json.mjs';

const CHANGE_TYPES = new Set(['added', 'deleted', 'modified', 'type-changed']);
/** @typedef {'added' | 'deleted' | 'modified' | 'type-changed'} ReleaseChangeType */
/** @typedef {{changeType: ReleaseChangeType, path: string}} ReleaseChange */

/** @param {unknown} value */
export const isSafeReleaseRelativePath = value => typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && value.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..');

/**
 * 把 `git status --porcelain=v1 -z` bytes 转换为排序后的完整 change 与 untracked path 集合.
 * Rename 和 copy 会展开成 deleted source 与 added destination, unsafe relative path 会关闭式失败.
 */
/** @param {Buffer} bytes */
export const parseReleaseGitStatus = bytes => {
    const records = bytes.toString('utf8').split('\0').filter(Boolean);
    /** @type {ReleaseChange[]} */
    const changes = [];
    const untrackedPaths = [];
    const seenPaths = new Set();
    for (let index = 0; index < records.length; index += 1) {
        if (records[index].length < 4 || records[index][2] !== ' ') {
            throw new Error('Guest Git status record is malformed.');
        }
        const code = records[index].slice(0, 2);
        const path = records[index].slice(3);
        if (code !== '??' && (!/^[ MTADRC][ MTADRC]$/u.test(code) || code === '  ')) {
            throw new Error('Guest Git status code is invalid.');
        }
        if (!isSafeReleaseRelativePath(path)) throw new Error('Guest Git status contains an unsafe path.');
        if (seenPaths.has(path)) {
            const prior = changes.find(change => change.path === path);
            if (code === '??' && prior?.changeType === 'deleted') {
                prior.changeType = 'modified';
                untrackedPaths.push(path);
                continue;
            }
            throw new Error('Guest Git status repeats a path.');
        }
        seenPaths.add(path);
        if (code.includes('R') || code.includes('C')) {
            const source = records[index + 1];
            if (!isSafeReleaseRelativePath(source)) throw new Error('Guest Git status contains an unsafe rename source.');
            if (seenPaths.has(source)) throw new Error('Guest Git status repeats a path.');
            seenPaths.add(source);
            changes.push({changeType: 'added', path}, {changeType: 'deleted', path: source});
            index += 1;
            continue;
        }
        const changeType = code === '??' || code.includes('A')
            ? 'added'
            : code.includes('D')
                ? 'deleted'
                : code.includes('T')
                    ? 'type-changed'
                    : 'modified';
        if (!CHANGE_TYPES.has(changeType)) throw new Error('Guest Git status change type is invalid.');
        changes.push({changeType, path});
        if (code === '??') untrackedPaths.push(path);
    }
    changes.sort((left, right) => compareText(left.path, right.path));
    untrackedPaths.sort(compareText);
    return {changes, untrackedPaths};
};

/**
 * 读取 status 已声明的全部 untracked entry, 保留 ordinary file bytes 或 non-regular entry type.
 * Caller 必须先通过 `parseReleaseGitStatus` 验证 paths; 任一读取失败会阻止返回 partial review material.
 */
export const inspectReleaseUntrackedEntries = async (
    /** @type {string} */ directory,
    /** @type {readonly string[]} */ paths,
    fileSystem = {lstat, readFile},
) => {
    const ordinaryFiles = [];
    const nonRegularEntries = [];
    for (const path of paths) {
        const absolutePath = join(directory, ...path.split('/'));
        const stats = await fileSystem.lstat(absolutePath);
        if (stats.isFile() && !stats.isSymbolicLink()) {
            ordinaryFiles.push({bytes: (await fileSystem.readFile(absolutePath)).toString('base64'), path});
        } else {
            nonRegularEntries.push({
                path,
                type: stats.isSymbolicLink() ? 'symbolic-link' : stats.isDirectory() ? 'directory' : 'special',
            });
        }
    }
    return {nonRegularEntries, ordinaryFiles};
};
