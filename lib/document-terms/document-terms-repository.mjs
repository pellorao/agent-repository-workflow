import {constants} from 'node:fs';
import {access, lstat, readFile} from 'node:fs/promises';
import {join} from 'node:path';

import {collectGitVisiblePaths} from '../arw-common/text-policy.mjs';
import {readBatchBlobs} from '../common/git-content.mjs';
import {compareText} from '../common/json.mjs';

/** @typedef {Parameters<typeof readBatchBlobs>[0]['git']} GitRunner */
/** @typedef {{lstat: (path: string) => Promise<{isDirectory: () => boolean, isFile: () => boolean, isSymbolicLink: () => boolean, mode: number}>, readFile: (path: string) => Promise<Buffer>}} DocumentFilesystem */
/** @typedef {DocumentFilesystem & {access: (path: string, mode: number) => Promise<void>}} DirectoryFilesystem */
/** @typedef {{bytes: Buffer, kind: 'file', mode: string, path: string} | {kind: 'missing' | 'symbolic-link' | 'unreadable' | 'unsupported', path: string}} DocumentEntry */
/** @typedef {{kind: 'directory' | 'missing' | 'symbolic-link' | 'unreadable' | 'unsupported', path: string}} DirectoryEntry */
/** @typedef {{mode: string, objectId: string, path: string, type: string}} TreeEntry */
/** @typedef {{listPaths: () => Promise<string[]>, readEntries: (paths: unknown) => Promise<DocumentEntry[]>}} DocumentRepository */

const uniqueSorted = (/** @type {string[]} */ values) => [...new Set(values)].sort(compareText);
/** @type {DirectoryFilesystem} */
const nodeFilesystem = {access, lstat, readFile};
const requiredReadPaths = new Set([
    '.arwignore',
    'arw.config.json',
]);

const validPath = (/** @type {string} */ path) => typeof path === 'string'
    && path.length > 0
    && !path.includes('\\')
    && !path.includes('\0')
    && !path.startsWith('/')
    && !/^[A-Za-z]:/u.test(path)
    && path.split('/').every(component => component.length > 0 && component !== '.' && component !== '..');

const validDirectoryPath = (/** @type {string} */ path) => path === '.' || validPath(path);

/** @type {(paths: unknown) => asserts paths is string[]} */
const validatePaths = paths => {
    if (!Array.isArray(paths) || paths.some(path => !validPath(path)) || new Set(paths).size !== paths.length) {
        throw new Error('Document source paths are invalid.');
    }
    if (paths.some((path, index) => index > 0 && compareText(paths[index - 1], path) >= 0)) {
        throw new Error('Document source paths must be sorted and unique.');
    }
};

/** @type {(paths: unknown) => asserts paths is string[]} */
const validateDirectoryPaths = paths => {
    if (!Array.isArray(paths) || paths.some(path => !validDirectoryPath(path)) || new Set(paths).size !== paths.length) {
        throw new Error('Document directory paths are invalid.');
    }
    if (paths.some((path, index) => index > 0 && compareText(paths[index - 1], path) >= 0)) {
        throw new Error('Document directory paths must be sorted and unique.');
    }
};

/** @param {unknown} paths @returns {string[]} */
const sortInventoryPaths = paths => {
    if (!Array.isArray(paths) || paths.some(path => !validPath(path)) || new Set(paths).size !== paths.length) {
        throw new Error('Document source paths are invalid.');
    }
    return [...paths].sort(compareText);
};

/** @param {string[]} paths @param {Set<string> | null} inventory */
const validateInventoryMembership = (paths, inventory) => {
    if (inventory === null || paths.some((/** @type {string} */ path) => !inventory.has(path) && !requiredReadPaths.has(path))) {
        throw new Error('Document source path does not belong to the current inventory.');
    }
};

/** @param {Pick<DocumentFilesystem, 'lstat'>} filesystem */
const createPathKindObserver = filesystem => {
    /** @type {Map<string, Promise<'directory' | 'missing' | 'symbolic-link' | 'unreadable' | 'unsupported'>>} */
    const observations = new Map();
    return (/** @type {string} */ absolutePath) => {
        const existing = observations.get(absolutePath);
        if (existing !== undefined) return existing;
        const observation = (async () => {
            let stats;
            try {
                stats = await filesystem.lstat(absolutePath);
            } catch (error) {
                return error instanceof Error && 'code' in error && error.code === 'ENOENT'
                    ? 'missing'
                    : 'unreadable';
            }
            if (stats.isSymbolicLink()) return 'symbolic-link';
            return stats.isDirectory() ? 'directory' : 'unsupported';
        })();
        observations.set(absolutePath, observation);
        return observation;
    };
};

/**
 * @param {{filesystem?: DirectoryFilesystem, paths: unknown, repositoryRoot: string, source: {kind: 'candidate-tree' | 'working-tree'}, visiblePaths: string[]}} input
 * @returns {Promise<DirectoryEntry[]>}
 */
export const inspectDocumentDirectories = async ({filesystem = nodeFilesystem, paths, repositoryRoot, source, visiblePaths}) => {
    validateDirectoryPaths(paths);
    if (source.kind === 'candidate-tree') return paths.map(path => ({
        kind: /** @type {'directory' | 'missing' | 'unsupported'} */ (
            path === '.' || visiblePaths.some(candidate => candidate.startsWith(`${path}/`))
                ? 'directory'
                : visiblePaths.includes(path) ? 'unsupported' : 'missing'
        ),
        path,
    }));

    const observe = createPathKindObserver(filesystem);
    return Promise.all(paths.map(/** @returns {Promise<DirectoryEntry>} */ async path => {
        let current = repositoryRoot;
        for (const component of path === '.' ? [] : path.split('/')) {
            current = join(current, component);
            const kind = await observe(current);
            if (kind !== 'directory') return {kind, path};
        }
        const rootKind = path === '.' ? await observe(current) : 'directory';
        if (rootKind !== 'directory') return {kind: rootKind, path};
        try {
            await filesystem.access(current, constants.R_OK | constants.X_OK);
        } catch {
            return {kind: 'unreadable', path};
        }
        return {kind: 'directory', path};
    }));
};

/**
 * 创建只读取当前工作树的文档仓库 Adapter.
 * 调用方必须先调用 `listPaths()`, 再把排序且唯一的清单路径传给 `readEntries(paths)`.
 * 返回条目保留请求顺序, 并把缺失, 符号链接父目录, 非文件和读取失败分类为封闭结果.
 */
/** @param {{filesystem?: DocumentFilesystem, git: GitRunner, repositoryRoot: string}} input @returns {DocumentRepository} */
export const createWorkingTreeDocumentRepository = ({filesystem = nodeFilesystem, git, repositoryRoot}) => {
    /** @type {Set<string> | null} */
    let inventory = null;
    return {
        async listPaths() {
            const paths = sortInventoryPaths(await collectGitVisiblePaths(git));
            validatePaths(paths);
            inventory = new Set(paths);
            return paths;
        },
        async readEntries(/** @type {unknown} */ paths) {
            validatePaths(paths);
            const currentInventory = inventory;
            validateInventoryMembership(paths, currentInventory);
            if (currentInventory === null) throw new Error('Document inventory must be read first.');
            const observeParent = createPathKindObserver(filesystem);
            /** @param {string} path @returns {Promise<DocumentEntry | null>} */
            const inspectParents = async path => {
                let current = repositoryRoot;
                for (const component of path.split('/').slice(0, -1)) {
                    current = join(current, component);
                    const kind = await observeParent(current);
                    if (kind !== 'directory') return {kind, path};
                }
                return null;
            };
            return Promise.all(paths.map(/** @returns {Promise<DocumentEntry>} */ async (/** @type {string} */ path) => {
                if (!currentInventory.has(path)) return {
                    kind: isImplicitDirectory(currentInventory, path) ? 'unsupported' : 'missing',
                    path,
                };
                const parentFailure = await inspectParents(path);
                if (parentFailure !== null) return parentFailure;
                const absolutePath = join(repositoryRoot, ...path.split('/'));
                let stats;
                try {
                    stats = await filesystem.lstat(absolutePath);
                } catch (error) {
                    return error instanceof Error && 'code' in error && error.code === 'ENOENT'
                        ? {kind: 'missing', path}
                        : {kind: 'unreadable', path};
                }
                if (stats.isSymbolicLink()) return {kind: 'symbolic-link', path};
                if (!stats.isFile()) return {kind: 'unsupported', path};
                try {
                    return {
                        bytes: await filesystem.readFile(absolutePath),
                        kind: 'file',
                        mode: stats.mode & 0o111 ? '100755' : '100644',
                        path,
                    };
                } catch {
                    return {kind: 'unreadable', path};
                }
            }));
        },
    };
};

/** @param {Buffer} bytes @returns {Map<string, TreeEntry>} */
const parseTree = bytes => {
    if (bytes.length === 0) return new Map();
    if (bytes[bytes.length - 1] !== 0) throw new Error('Git tree contains an invalid entry.');
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    const records = text.slice(0, -1).split('\0');
    if (records.some(record => record.length === 0)) throw new Error('Git tree contains an invalid entry.');
    /** @type {Map<string, TreeEntry>} */
    const entries = new Map();
    for (const record of records) {
        const match = /^(\d{6}) (blob|commit) ([0-9a-f]{40,64})\t([\s\S]+)$/u.exec(record);
        if (match === null || !validPath(match[4]) || entries.has(match[4])) throw new Error('Git tree contains an invalid entry.');
        entries.set(match[4], {mode: match[1], objectId: match[3], path: match[4], type: match[2]});
    }
    return entries;
};

/** @param {{keys: () => IterableIterator<string>}} entries @param {string} path */
const isImplicitDirectory = (entries, path) => [...entries.keys()].some(candidate => candidate.startsWith(`${path}/`));

/**
 * 创建只读取一个已经绑定的不可变 Git tree 的文档仓库 Adapter.
 * `listPaths()` 必须先完成单次 tree 清单读取; 后续 `readEntries(paths)` 只接受排序且唯一的清单路径.
 * Blob batch 失败会抛出 Error; 缺失 blob, 符号链接, gitlink 和不支持的条目保持逐路径隔离.
 */
/** @param {{candidateTree: string, git: GitRunner}} input @returns {DocumentRepository} */
export const createTreeDocumentRepository = ({candidateTree, git}) => {
    /** @type {Map<string, TreeEntry> | null} */
    let entries = null;
    return {
        async listPaths() {
            if (entries === null) {
                const result = await git.run({argv: ['ls-tree', '-r', '-z', candidateTree]});
                if (result.failure !== null || result.code !== 0) throw new Error('Git tree could not be read.');
                entries = parseTree(result.stdout);
            }
            return [...entries.keys()].sort(compareText);
        },
        async readEntries(/** @type {unknown} */ paths) {
            validatePaths(paths);
            const currentEntries = entries;
            if (currentEntries === null) throw new Error('Document tree inventory must be read first.');
            validateInventoryMembership(paths, new Set(currentEntries.keys()));
            const selected = paths.map(path => currentEntries.get(path));
            /** @type {string[]} */
            const objectIds = [];
            for (const entry of selected) {
                if (entry !== undefined && ['100644', '100755'].includes(entry.mode) && entry.type === 'blob') {
                    objectIds.push(entry.objectId);
                }
            }
            const blobs = await readBatchBlobs({
                git,
                objectIds: uniqueSorted(objectIds),
            });
            return paths.map((path, index) => {
                const entry = selected[index];
                if (entry === undefined) return {
                    kind: isImplicitDirectory(currentEntries, path) ? 'unsupported' : 'missing',
                    path,
                };
                if (entry.mode === '120000') return {kind: 'symbolic-link', path};
                if (!['100644', '100755'].includes(entry.mode) || entry.type !== 'blob') return {kind: 'unsupported', path};
                const bytes = blobs.get(entry.objectId);
                return bytes === undefined
                    ? {kind: 'unreadable', path}
                    : {bytes, kind: 'file', mode: entry.mode, path};
            });
        },
    };
};
