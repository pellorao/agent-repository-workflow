import {resolve, sep} from 'node:path';

import {resolveRelativePathWithinScope} from '../../lib/common/filesystem.mjs';

/** @typedef {'createDirectory' | 'inspect' | 'list' | 'read' | 'remove' | 'write'} MockFilesystemOperation */
/** @typedef {{bytes: Buffer, kind: 'file'} | {kind: 'directory'}} MockEntry */
/** @typedef {{message?: string, operation: MockFilesystemOperation, path: string, stage?: string}} MockFailure */

/** @template {object} T @param {T} value @returns {T & {diagnostics: [], status: 'succeeded'}} */
const succeeded = value => ({...value, diagnostics: [], status: 'succeeded'});
const blocked = (/** @type {string} */ code, /** @type {string} */ message, /** @type {string} */ path) => ({
    diagnostics: [{code, message, path}],
    status: /** @type {'blocked'} */ ('blocked'),
});
const failed = (/** @type {string} */ stage, /** @type {string} */ message, /** @type {string} */ path) => ({
    diagnostics: [{code: 'filesystem-io-failed', message, path}],
    stage,
    status: /** @type {'failed'} */ ('failed'),
});
const compareText = (/** @type {string} */ left, /** @type {string} */ right) => left < right ? -1 : left > right ? 1 : 0;

/**
 * 创建只表示普通文件, 普通目录和 missing 的确定性 test filesystem.
 * 该 Adapter 只实现 Development Specification 声明的有限 operation 子集.
 *
 * @param {{entries?: Array<{bytes?: Buffer, kind: 'directory' | 'file', path: string}>, failures?: MockFailure[], root?: string}} [options]
 */
export const createMockFilesystem = ({entries = [], failures = [], root = resolve('arw-mock-filesystem')} = {}) => {
    if (!Array.isArray(entries) || !Array.isArray(failures) || typeof root !== 'string') {
        throw new TypeError('Mock filesystem options are invalid.');
    }
    /** @type {Map<string, MockEntry>} */
    const state = new Map();
    /** @type {MockFailure[]} */
    const pendingFailures = failures.map(failure => ({...failure}));

    /** @param {unknown} value */
    const normalize = value => {
        const resolvedPath = resolveRelativePathWithinScope({path: /** @type {string} */ (value), scope: root});
        if (resolvedPath.status !== 'succeeded') return resolvedPath;
        return {path: resolvedPath.relativePath === '' ? '.' : resolvedPath.relativePath.split(sep).join('/')};
    };
    /** @param {string} path */
    const parentPaths = path => {
        const parts = path.split('/');
        return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
    };
    /** @param {string} path */
    const addMissingParents = path => {
        for (const parent of parentPaths(path)) {
            const entry = state.get(parent);
            if (entry?.kind === 'file') throw new TypeError(`Mock filesystem parent is a file: ${parent}.`);
            state.set(parent, {kind: 'directory'});
        }
    };
    /** @param {MockFilesystemOperation} operation @param {string} path */
    const injectedFailure = (operation, path) => {
        const index = pendingFailures.findIndex(failure => failure.operation === operation && failure.path === path);
        if (index < 0) return null;
        const [failure] = pendingFailures.splice(index, 1);
        if (failure === undefined) return null;
        return failed(
            failure.stage ?? operation,
            failure.message ?? `Simulated filesystem ${operation} failure.`,
            path,
        );
    };
    /** @param {string} path */
    const parentBlocker = path => {
        for (const parent of parentPaths(path)) {
            if (state.get(parent)?.kind === 'file') {
                return blocked('filesystem-parent-invalid', 'A parent path is not a directory.', path);
            }
        }
        return null;
    };

    for (const entry of entries) {
        if (entry === null || typeof entry !== 'object' || !['directory', 'file'].includes(entry.kind)) {
            throw new TypeError('Mock filesystem entry is invalid.');
        }
        const normalized = normalize(entry.path);
        if (!('path' in normalized) || normalized.path === '.') throw new TypeError('Mock filesystem entry path is invalid.');
        addMissingParents(normalized.path);
        if (entry.kind === 'file') {
            if (!Buffer.isBuffer(entry.bytes)) throw new TypeError('Mock filesystem file bytes must be a Buffer.');
            state.set(normalized.path, {bytes: Buffer.from(entry.bytes), kind: 'file'});
        } else {
            state.set(normalized.path, {kind: 'directory'});
        }
    }
    for (const failure of pendingFailures) {
        if (failure === null || typeof failure !== 'object'
            || !['createDirectory', 'inspect', 'list', 'read', 'remove', 'write'].includes(failure.operation)
            || typeof failure.path !== 'string'
            || failure.message !== undefined && typeof failure.message !== 'string'
            || failure.stage !== undefined && typeof failure.stage !== 'string') {
            throw new TypeError('Mock filesystem failure is invalid.');
        }
        const normalized = normalize(failure.path);
        if (!('path' in normalized)) throw new TypeError('Mock filesystem failure path is invalid.');
        failure.path = normalized.path;
    }

    return {
        root,

        async inspect(/** @type {{path: string, rejectHardLinks?: boolean}} */ {path, rejectHardLinks = false}) {
            if (typeof rejectHardLinks !== 'boolean') throw new TypeError('rejectHardLinks must be a boolean.');
            const normalized = normalize(path);
            if (!('path' in normalized)) return normalized;
            const injected = injectedFailure('inspect', normalized.path);
            if (injected !== null) return injected;
            const parents = parentBlocker(normalized.path);
            if (parents !== null) return parents;
            const entry = normalized.path === '.' ? {kind: /** @type {'directory'} */ ('directory')} : state.get(normalized.path);
            if (entry === undefined) return succeeded({entry: {kind: 'missing', path: normalized.path}});
            return succeeded({entry: {
                kind: entry.kind,
                path: normalized.path,
                size: entry.kind === 'file' ? entry.bytes.length : 0,
            }});
        },

        async read(/** @type {{path: string, rejectHardLinks?: boolean}} */ {path, rejectHardLinks = false}) {
            if (typeof rejectHardLinks !== 'boolean') throw new TypeError('rejectHardLinks must be a boolean.');
            const normalized = normalize(path);
            if (!('path' in normalized)) return normalized;
            const injected = injectedFailure('read', normalized.path);
            if (injected !== null) return injected;
            const parents = parentBlocker(normalized.path);
            if (parents !== null) return parents;
            const entry = state.get(normalized.path);
            if (entry?.kind !== 'file') {
                return blocked('filesystem-file-required', 'The path must be an existing regular file.', normalized.path);
            }
            return succeeded({bytes: Buffer.from(entry.bytes), path: normalized.path});
        },

        async list(/** @type {{path?: string, recursive?: boolean}} */ {path = '.', recursive = false} = {}) {
            if (typeof recursive !== 'boolean') throw new TypeError('recursive must be a boolean.');
            const normalized = normalize(path);
            if (!('path' in normalized)) return normalized;
            const injected = injectedFailure('list', normalized.path);
            if (injected !== null) return injected;
            const parents = parentBlocker(normalized.path);
            if (parents !== null) return parents;
            if (normalized.path !== '.' && state.get(normalized.path)?.kind !== 'directory') {
                return blocked('filesystem-directory-required', 'The path must be an existing real directory.', normalized.path);
            }
            const prefix = normalized.path === '.' ? '' : `${normalized.path}/`;
            const listed = [...state.entries()].filter(([entryPath]) => {
                if (!entryPath.startsWith(prefix) || entryPath === normalized.path) return false;
                return recursive || !entryPath.slice(prefix.length).includes('/');
            }).map(([entryPath, entry]) => ({kind: entry.kind, path: entryPath})).sort((left, right) => compareText(left.path, right.path));
            return succeeded({entries: listed});
        },

        async createDirectory(/** @type {{path: string, recursive?: boolean}} */ {path, recursive = false}) {
            if (typeof recursive !== 'boolean') throw new TypeError('recursive must be a boolean.');
            const normalized = normalize(path);
            if (!('path' in normalized)) return normalized;
            if (normalized.path === '.') return blocked('filesystem-path-unsafe', 'The directory path is not a creatable root-relative path.', path);
            const injected = injectedFailure('createDirectory', normalized.path);
            if (injected !== null) return injected;
            const existing = state.get(normalized.path);
            if (existing !== undefined) {
                return existing.kind === 'directory'
                    ? succeeded({created: false, path: normalized.path})
                    : blocked('filesystem-directory-collision', 'The directory path is already occupied.', normalized.path);
            }
            const parents = parentBlocker(normalized.path);
            if (parents !== null) return parents;
            const missingParents = parentPaths(normalized.path).filter(parent => !state.has(parent));
            if (!recursive && missingParents.length > 0) {
                return failed('directory-create', 'ENOENT: parent directory does not exist.', normalized.path);
            }
            addMissingParents(normalized.path);
            state.set(normalized.path, {kind: 'directory'});
            return succeeded({created: true, path: normalized.path});
        },

        async write(/** @type {{bytes: Buffer, mode: 'create' | 'replace', path: string}} */ {bytes, mode, path}) {
            if (!Buffer.isBuffer(bytes)) throw new TypeError('bytes must be a Buffer.');
            if (!['create', 'replace'].includes(mode)) throw new TypeError('mode must be create or replace.');
            const normalized = normalize(path);
            if (!('path' in normalized)) return normalized;
            if (normalized.path === '.') return blocked('filesystem-path-unsafe', 'The file path is not a writable root-relative path.', path);
            const injected = injectedFailure('write', normalized.path);
            if (injected !== null) return injected;
            const existing = state.get(normalized.path);
            if (mode === 'create' && existing !== undefined) {
                return blocked('filesystem-create-collision', 'The file already exists.', normalized.path);
            }
            if (mode === 'replace' && existing?.kind !== 'file') {
                return blocked('filesystem-replace-target-invalid', 'The replacement target must be an existing regular file.', normalized.path);
            }
            const parents = parentBlocker(normalized.path);
            if (parents !== null) return parents;
            addMissingParents(normalized.path);
            state.set(normalized.path, {bytes: Buffer.from(bytes), kind: 'file'});
            return succeeded({path: normalized.path});
        },

        async remove(/** @type {{path: string, recursive?: boolean}} */ {path, recursive = false}) {
            if (typeof recursive !== 'boolean') throw new TypeError('recursive must be a boolean.');
            const normalized = normalize(path);
            if (!('path' in normalized)) return normalized;
            if (normalized.path === '.') return blocked('filesystem-path-unsafe', 'The path is not a removable root-relative path.', path);
            const injected = injectedFailure('remove', normalized.path);
            if (injected !== null) return injected;
            const existing = state.get(normalized.path);
            if (existing === undefined) return succeeded({path: normalized.path, removed: false});
            if (existing.kind === 'directory') {
                const prefix = `${normalized.path}/`;
                const children = [...state.keys()].filter(entryPath => entryPath.startsWith(prefix));
                if (!recursive && children.length > 0) {
                    return blocked('filesystem-directory-not-empty', 'The directory is not empty.', normalized.path);
                }
                for (const child of children) state.delete(child);
            }
            state.delete(normalized.path);
            return succeeded({path: normalized.path, removed: true});
        },
    };
};
