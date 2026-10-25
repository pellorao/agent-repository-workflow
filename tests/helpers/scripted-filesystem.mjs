import {isAbsolute, posix, resolve} from 'node:path';
import {TextDecoder} from 'node:util';

import {resolveAbsolutePathWithinScope, resolveRelativePathWithinScope} from '../../lib/common/filesystem.mjs';

/** @typedef {{directories: Set<string>, files: Map<string, Buffer>, hardLinks: Set<string>}} FilesystemStore */
/** @typedef {{calls: Array<{operation: string, path?: string}>, open: typeof import('../../lib/common/filesystem.mjs').createScopedFilesystem, snapshot: (root: string) => Map<string, Buffer>}} ScriptedScopedFilesystemFactory */
/** @template {object} T @param {T} value @returns {T & {diagnostics: never[], status: 'succeeded'}} */
const succeeded = value => ({...value, diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded')});
/** @param {string} code @param {string} message @param {string} [path] */
const blocked = (code, message, path) => ({diagnostics: [{code, message, ...(path === undefined ? {} : {path})}], status: /** @type {'blocked'} */ ('blocked')});

const logicalPath = (/** @type {string} */ path) => path === '' ? '.' : path.split('\\').join('/');

const validateLogicalPath = (/** @type {string} */ path, /** @type {string} */ root) => {
    if (typeof path !== 'string' || path.length === 0 || path.includes('\0') || path.includes('\\')) throw new TypeError('path must be a non-empty logical relative path.');
    const resolved = resolveRelativePathWithinScope({path, scope: root});
    return resolved.status === 'succeeded'
        ? succeeded({absolutePath: resolved.absolutePath, relativePath: logicalPath(resolved.relativePath)})
        : resolved;
};

const parentPaths = (/** @type {string} */ path) => {
    const parents = [];
    let current = posix.dirname(path);
    while (current !== '.') {
        parents.push(current);
        current = posix.dirname(current);
    }
    return parents;
};

/** @returns {ScriptedScopedFilesystemFactory} */
export const createScriptedScopedFilesystemFactory = (/** @type {{failures?: Array<{operation: string, path?: string, result: object}>, hardLinks?: Map<string, Set<string>>, roots?: Map<string, Map<string, Buffer>>}} */ {failures = [], hardLinks = new Map(), roots = new Map()} = {}) => {
    /** @type {Map<string, FilesystemStore>} */
    const stores = new Map([...roots].map(([root, files]) => [resolve(root), {
        directories: new Set(['.', ...[...files.keys()].flatMap(parentPaths)]),
        files: new Map([...files].map(([path, bytes]) => [path, Buffer.from(bytes)])),
        hardLinks: new Set(hardLinks.get(resolve(root)) ?? []),
    }]));
    const remainingFailures = failures.map(failure => ({...failure}));
    /** @type {Array<{operation: string, path?: string}>} */
    const calls = [];
    const injected = (/** @type {string} */ operation, /** @type {string | undefined} */ path) => {
        calls.push({operation, ...(path === undefined ? {} : {path})});
        const index = remainingFailures.findIndex(failure => failure.operation === operation && (failure.path === undefined || failure.path === path));
        if (index < 0) return null;
        return remainingFailures.splice(index, 1)[0].result;
    };
    return /** @type {ScriptedScopedFilesystemFactory} */ ({
        calls,
        async open(/** @type {{createRoot?: boolean, root: string}} */ {createRoot = false, root}) {
            if (typeof root !== 'string' || !isAbsolute(root)) throw new TypeError('root must be an absolute path.');
            if (typeof createRoot !== 'boolean') throw new TypeError('createRoot must be a boolean.');
            const canonicalRoot = resolve(root);
            const openFailure = injected('open', canonicalRoot);
            if (openFailure) return openFailure;
            if (!stores.has(canonicalRoot)) {
                if (!createRoot) return blocked('filesystem-root-missing', 'The scoped filesystem root does not exist.');
                stores.set(canonicalRoot, {directories: new Set(['.']), files: new Map(), hardLinks: new Set()});
            }
            const store = stores.get(canonicalRoot);
            if (!store) throw new Error('ScriptedScopedFilesystemFactory lost its root store.');
            const scopedFilesystem = {
                root: canonicalRoot,
                resolve(/** @type {{path: string}} */ {path}) {
                    const failure = injected('resolve', path);
                    if (failure) return failure;
                    const checked = validateLogicalPath(path, canonicalRoot);
                    return checked.status === 'succeeded' && checked.relativePath === '.'
                        ? {...checked, relativePath: ''}
                        : checked;
                },
                async inspect(/** @type {{path: string, rejectHardLinks?: boolean}} */ {path, rejectHardLinks = false}) {
                    if (typeof rejectHardLinks !== 'boolean') throw new TypeError('rejectHardLinks must be a boolean.');
                    const checked = validateLogicalPath(path, canonicalRoot);
                    if (checked.status !== 'succeeded') return checked;
                    const normalized = checked.relativePath;
                    const failure = injected('inspect', normalized);
                    if (failure) return failure;
                    const file = store.files.get(normalized);
                    if (file && rejectHardLinks && store.hardLinks.has(normalized)) {
                        return blocked('filesystem-hard-link-unsupported', 'Hard linked files are not supported.', normalized);
                    }
                    if (file) return succeeded({entry: {kind: 'file', path: normalized, size: file.length}});
                    if (store.directories.has(normalized)) return succeeded({entry: {kind: 'directory', path: normalized}});
                    return succeeded({entry: {kind: 'missing', path: normalized}});
                },
                async read(/** @type {{path: string, rejectHardLinks?: boolean}} */ {path, rejectHardLinks = false}) {
                    if (typeof rejectHardLinks !== 'boolean') throw new TypeError('rejectHardLinks must be a boolean.');
                    const checked = validateLogicalPath(path, canonicalRoot);
                    if (checked.status !== 'succeeded') return checked;
                    const normalized = checked.relativePath;
                    const failure = injected('read', normalized);
                    if (failure) return failure;
                    const bytes = store.files.get(normalized);
                    if (bytes !== undefined && rejectHardLinks && store.hardLinks.has(normalized)) {
                        return blocked('filesystem-hard-link-unsupported', 'Hard linked files are not supported.', normalized);
                    }
                    return bytes === undefined
                        ? blocked('filesystem-file-required', 'The path must be an existing regular file.', normalized)
                        : succeeded({bytes: Buffer.from(bytes), path: normalized});
                },
                async readText(/** @type {{allowLossyDecoding: boolean, path: string, rejectHardLinks?: boolean}} */ {allowLossyDecoding, path, rejectHardLinks = false}) {
                    if (typeof allowLossyDecoding !== 'boolean') throw new TypeError('allowLossyDecoding must be a boolean.');
                    if (typeof rejectHardLinks !== 'boolean') throw new TypeError('rejectHardLinks must be a boolean.');
                    const checked = validateLogicalPath(path, canonicalRoot);
                    if (checked.status !== 'succeeded') return checked;
                    const normalized = checked.relativePath;
                    const failure = injected('readText', normalized);
                    if (failure) return failure;
                    const bytes = store.files.get(normalized);
                    if (bytes === undefined) return blocked('filesystem-file-required', 'The path must be an existing regular file.', normalized);
                    if (rejectHardLinks && store.hardLinks.has(normalized)) return blocked('filesystem-hard-link-unsupported', 'Hard linked files are not supported.', normalized);
                    try {
                        return succeeded({path: normalized, text: new TextDecoder('utf-8', {fatal: !allowLossyDecoding, ignoreBOM: true}).decode(bytes)});
                    } catch (error) {
                        return blocked('filesystem-text-decoding-failed', error instanceof Error ? error.message : String(error), normalized);
                    }
                },
                async list(/** @type {{path?: string, recursive?: boolean}} */ {path = '.', recursive = false} = {}) {
                    if (typeof recursive !== 'boolean') throw new TypeError('recursive must be a boolean.');
                    const checked = validateLogicalPath(path, canonicalRoot);
                    if (checked.status !== 'succeeded') return checked;
                    const normalized = checked.relativePath;
                    const failure = injected('list', normalized);
                    if (failure) return failure;
                    if (!store.directories.has(normalized)) return blocked('filesystem-directory-required', 'The path must be an existing real directory.', normalized);
                    /** @type {Array<{kind: 'directory' | 'file', path: string}>} */
                    const entries = [];
                    const visit = (/** @type {string} */ directory) => {
                        const children = [
                            ...[...store.directories]
                                .filter(path => path !== '.' && posix.dirname(path) === directory)
                                .map(path => ({kind: /** @type {'directory'} */ ('directory'), path})),
                            ...[...store.files]
                                .filter(([path]) => posix.dirname(path) === directory)
                                .map(([path]) => ({kind: /** @type {'file'} */ ('file'), path})),
                        ].sort((left, right) => {
                            const leftName = posix.basename(left.path);
                            const rightName = posix.basename(right.path);
                            return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
                        });
                        for (const child of children) {
                            entries.push(child);
                            if (recursive && child.kind === 'directory') visit(child.path);
                        }
                    };
                    visit(normalized);
                    return succeeded({entries});
                },
                async createDirectory(/** @type {{path: string, recursive?: boolean}} */ {path, recursive = false}) {
                    if (typeof recursive !== 'boolean') throw new TypeError('recursive must be a boolean.');
                    const checked = validateLogicalPath(path, canonicalRoot);
                    if (checked.status !== 'succeeded') return checked;
                    const normalized = checked.relativePath;
                    const failure = injected('createDirectory', normalized);
                    if (failure) return failure;
                    if (normalized === '.') return blocked('filesystem-path-unsafe', 'The directory path is not a creatable root-relative path.', normalized);
                    if (store.files.has(normalized)) return blocked('filesystem-directory-collision', 'The directory path is already occupied.', normalized);
                    if (store.directories.has(normalized)) return succeeded({created: false, path: normalized});
                    const parents = parentPaths(normalized);
                    if (!recursive && parents.some(parent => !store.directories.has(parent))) return blocked('filesystem-parent-invalid', 'A parent path is not a directory.', normalized);
                    parents.forEach(parent => store.directories.add(parent));
                    store.directories.add(normalized);
                    return succeeded({created: true, path: normalized});
                },
                async write(/** @type {{bytes: Buffer, mode: 'create' | 'create-atomic' | 'replace', path: string}} */ {bytes, mode, path}) {
                    if (!Buffer.isBuffer(bytes)) throw new TypeError('bytes must be a Buffer.');
                    if (!['create', 'create-atomic', 'replace'].includes(mode)) throw new TypeError('mode must be create, create-atomic, or replace.');
                    const checked = validateLogicalPath(path, canonicalRoot);
                    if (checked.status !== 'succeeded') return checked;
                    const normalized = checked.relativePath;
                    const failure = injected('write', normalized);
                    if (failure) return failure;
                    if (['create', 'create-atomic'].includes(mode) && (store.files.has(normalized) || store.directories.has(normalized))) return blocked('filesystem-create-collision', 'The file already exists.', normalized);
                    if (mode === 'replace' && !store.files.has(normalized)) return blocked('filesystem-replace-target-invalid', 'The replacement target must be an existing regular file.', normalized);
                    parentPaths(normalized).forEach(parent => store.directories.add(parent));
                    store.files.set(normalized, Buffer.from(bytes));
                    store.hardLinks.delete(normalized);
                    return succeeded({path: normalized});
                },
                async remove(/** @type {{path: string, recursive?: boolean}} */ {path, recursive = false}) {
                    if (typeof recursive !== 'boolean') throw new TypeError('recursive must be a boolean.');
                    const checked = validateLogicalPath(path, canonicalRoot);
                    if (checked.status !== 'succeeded') return checked;
                    const normalized = checked.relativePath;
                    const failure = injected('remove', normalized);
                    if (failure) return failure;
                    if (normalized === '.') return blocked('filesystem-path-unsafe', 'The path is not a removable root-relative path.', normalized);
                    if (store.files.delete(normalized)) {
                        store.hardLinks.delete(normalized);
                        return succeeded({path: normalized, removed: true});
                    }
                    if (!store.directories.has(normalized)) return succeeded({path: normalized, removed: false});
                    const children = [...store.files.keys(), ...store.directories].filter(item => item.startsWith(`${normalized}/`));
                    if (children.length > 0 && !recursive) return blocked('filesystem-directory-not-empty', 'The directory is not empty.', normalized);
                    for (const child of children) {
                        store.files.delete(child);
                        store.hardLinks.delete(child);
                        store.directories.delete(child);
                    }
                    store.directories.delete(normalized);
                    return succeeded({path: normalized, removed: true});
                },
                async setMode(/** @type {{mode: number, path: string}} */ {mode, path}) {
                    if (!Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777) throw new TypeError('mode must be a non-negative integer no greater than 07777.');
                    const checked = validateLogicalPath(path, canonicalRoot);
                    if (checked.status !== 'succeeded') return checked;
                    const normalized = checked.relativePath;
                    const failure = injected('setMode', normalized);
                    if (failure) return failure;
                    if (!store.files.has(normalized)) return blocked('filesystem-file-required', 'The path must be an existing regular file.', normalized);
                    return succeeded({path: normalized});
                },
            };
            return succeeded({scopedFilesystem});
        },
        snapshot(/** @type {string} */ root) {
            const store = stores.get(resolve(root));
            if (!store) throw new Error('ScriptedScopedFilesystemFactory has no snapshot root.');
            return new Map([...store.files].map(([path, bytes]) => [path, Buffer.from(bytes)]));
        },
    });
};
