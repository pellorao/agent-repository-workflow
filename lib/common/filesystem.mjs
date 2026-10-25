import {randomBytes} from 'node:crypto';
import {
    chmod,
    link,
    lstat,
    mkdir,
    readFile,
    readdir,
    realpath,
    rename,
    rmdir,
    rm,
    unlink,
    writeFile,
} from 'node:fs/promises';
import {dirname, isAbsolute, join, posix, relative, resolve, sep} from 'node:path';
import {TextDecoder} from 'node:util';
import {compareText} from './json.mjs';

/** @typedef {'directory' | 'file' | 'link' | 'other'} FilesystemEntryKind */
/** @typedef {{code: string, message: string, path?: string}} FilesystemDiagnostic */
/** @typedef {{diagnostics: FilesystemDiagnostic[], status: 'blocked'}} FilesystemBlocked */
/** @typedef {{diagnostics: FilesystemDiagnostic[], stage: string, status: 'failed'}} FilesystemFailed */
/** @template {object} T @typedef {T & {diagnostics: FilesystemDiagnostic[], status: 'succeeded'}} FilesystemSucceeded */
/** @typedef {FilesystemBlocked | FilesystemFailed} FilesystemUnsuccessful */
/** @typedef {{absolutePath: string, relativePath: string}} ResolvedPathWithinScope */
/** @typedef {{absolutePath: string, exists: false, path: string} | {absolutePath: string, exists: true, information: import('node:fs').Stats, kind: FilesystemEntryKind, path: string}} ExistingChainObservation */
/** @typedef {{entry: {kind: FilesystemEntryKind | 'missing', path: string, size?: number}}} InspectSuccess */
/** @typedef {{bytes: Buffer, path: string}} ReadSuccess */
/** @typedef {{path: string, text: string}} ReadTextSuccess */
/** @typedef {{entries: Array<{kind: FilesystemEntryKind, path: string}>}} ListSuccess */
/**
 * @typedef {object} ScopedFilesystem
 * @property {string} root
 * @property {(input: {path: string}) => FilesystemBlocked | FilesystemSucceeded<ResolvedPathWithinScope>} resolve
 * @property {(input: {path: string, rejectHardLinks?: boolean}) => Promise<FilesystemUnsuccessful | FilesystemSucceeded<InspectSuccess>>} inspect
 * @property {(input: {path: string, rejectHardLinks?: boolean}) => Promise<FilesystemUnsuccessful | FilesystemSucceeded<ReadSuccess>>} read
 * @property {(input: {allowLossyDecoding: boolean, path: string, rejectHardLinks?: boolean}) => Promise<FilesystemUnsuccessful | FilesystemSucceeded<ReadTextSuccess>>} readText
 * @property {(input?: {path?: string, recursive?: boolean}) => Promise<FilesystemUnsuccessful | FilesystemSucceeded<ListSuccess>>} list
 * @property {(input: {path: string, recursive?: boolean}) => Promise<FilesystemUnsuccessful | FilesystemSucceeded<{created: boolean, path: string}>>} createDirectory
 * @property {(input: {bytes: Buffer, mode: 'create' | 'create-atomic' | 'replace', path: string, fileMode?: number, beforeReplace?: () => void | Promise<void>}) => Promise<FilesystemUnsuccessful | FilesystemSucceeded<{path: string}>>} write
 * @property {(input: {path: string, recursive?: boolean}) => Promise<FilesystemUnsuccessful | FilesystemSucceeded<{path: string, removed: boolean}>>} remove
 * @property {(input: {mode: number, path: string}) => Promise<FilesystemUnsuccessful | FilesystemSucceeded<{path: string}>>} setMode
 */

/** @param {string} code @param {string} message @param {string} [path] @returns {FilesystemDiagnostic} */
const diagnostic = (code, message, path = undefined) => ({
    code,
    message,
    ...(path === undefined ? {} : {path}),
});

/** @param {string} stage @param {unknown} error @param {string} [path] @returns {FilesystemFailed} */
const failed = (stage, error, path = undefined) => ({
    diagnostics: [diagnostic(
        'filesystem-io-failed',
        error instanceof Error ? error.message : String(error),
        path,
    )],
    stage,
    status: 'failed',
});

/** @param {string} code @param {string} message @param {string} [path] @returns {FilesystemBlocked} */
const blocked = (code, message, path = undefined) => ({
    diagnostics: [diagnostic(code, message, path)],
    status: 'blocked',
});

/** @template {object} T @param {T} value @returns {FilesystemSucceeded<T>} */
const succeeded = value => ({...value, diagnostics: [], status: 'succeeded'});

const isMissing = (/** @type {unknown} */ error) => error instanceof Error && 'code' in error && error.code === 'ENOENT';

/** @param {unknown} value @returns {string | null} */
const normalizeRelativePath = value => {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError('Filesystem path must be a non-empty string.');
    }
    if (
        value.includes('\\')
        || value.includes('\0')
        || /^[A-Za-z]:\//u.test(value)
        || posix.isAbsolute(value)
    ) {
        return null;
    }
    const normalized = posix.normalize(value).replace(/\/+$/u, '');
    return normalized.length === 0 ? '.' : normalized;
};

/**
 * Join normalized root-relative logical paths without applying host path rules.
 * @param {...string} paths
 */
export const joinRelativePath = (...paths) => {
    if (paths.length === 0) throw new TypeError('At least one Filesystem path is required.');
    const normalized = paths.map(path => {
        const value = normalizeRelativePath(path);
        if (value === null) throw new TypeError('Filesystem paths must be logical relative paths.');
        return value;
    });
    const result = normalizeRelativePath(posix.join(...normalized));
    if (result === null || result === '.') {
        throw new TypeError('Joined Filesystem path must be a non-root logical relative path.');
    }
    return result;
};

/**
 * @param {{path: string, scope: string}} input
 * @param {'absolute' | 'relative'} pathKind
 * @returns {FilesystemBlocked | FilesystemSucceeded<ResolvedPathWithinScope>}
 */
const resolvePathWithinScope = (input, pathKind) => {
    if (input === null || typeof input !== 'object') {
        throw new TypeError('Filesystem path scope input must be an object.');
    }
    const {path, scope} = input;
    if (typeof scope !== 'string' || scope.length === 0 || scope.includes('\0') || !isAbsolute(scope)) {
        throw new TypeError('scope must be a non-empty absolute path.');
    }
    if (typeof path !== 'string' || path.length === 0 || path.includes('\0')) {
        throw new TypeError('path must be a non-empty string.');
    }
    if (pathKind === 'relative' ? isAbsolute(path) : !isAbsolute(path)) {
        throw new TypeError(`path must be ${pathKind}.`);
    }

    const canonicalScope = resolve(scope);
    const absolutePath = pathKind === 'relative' ? resolve(canonicalScope, path) : resolve(path);
    const relativePath = relative(canonicalScope, absolutePath);
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
        return blocked('filesystem-path-escape', 'The path resolves outside the scoped root.', path);
    }
    return succeeded({absolutePath, relativePath});
};

/**
 * @param {{path: string, scope: string}} input
 * @returns {FilesystemBlocked | FilesystemSucceeded<ResolvedPathWithinScope>}
 */
export const resolveRelativePathWithinScope = input => resolvePathWithinScope(input, 'relative');

/**
 * @param {{path: string, scope: string}} input
 * @returns {FilesystemBlocked | FilesystemSucceeded<ResolvedPathWithinScope>}
 */
export const resolveAbsolutePathWithinScope = input => resolvePathWithinScope(input, 'absolute');

/** @param {string} relativePath */
const logicalPath = relativePath => relativePath === '' ? '.' : relativePath.split(sep).join('/');

/** @param {import('node:fs').Stats} information @returns {FilesystemEntryKind} */
const entryKind = information => {
    if (information.isSymbolicLink()) return 'link';
    if (information.isFile()) return 'file';
    if (information.isDirectory()) return 'directory';
    return 'other';
};

/** @param {{canonicalRoot: string, path: string}} input @returns {Promise<FilesystemUnsuccessful | FilesystemSucceeded<ExistingChainObservation>>} */
const inspectExistingChain = async ({canonicalRoot, path}) => {
    const resolved = resolveRelativePathWithinScope({path, scope: canonicalRoot});
    if (resolved.status !== 'succeeded') return resolved;
    const normalized = logicalPath(resolved.relativePath);
    const segments = resolved.relativePath === '' ? [] : resolved.relativePath.split(sep);
    let current = canonicalRoot;
    let information;
    for (let index = 0; index < segments.length; index += 1) {
        current = join(current, segments[index]);
        try {
            information = await lstat(current);
        } catch (error) {
            if (isMissing(error)) {
                return succeeded({
                    absolutePath: resolved.absolutePath,
                    exists: false,
                    path: normalized,
                });
            }
            return failed('path-observation', error, normalized);
        }

        const kind = entryKind(information);
        if (kind === 'link') {
            return blocked('filesystem-link-unsupported', 'Symbolic links and directory junctions are not supported.', normalized);
        }
        if (index < segments.length - 1 && kind !== 'directory') {
            return blocked('filesystem-parent-invalid', 'A parent path is not a directory.', normalized);
        }
        if (kind === 'other') {
            return blocked('filesystem-entry-unsupported', 'The path is not a regular file or directory.', normalized);
        }
    }

    const absolutePath = resolved.absolutePath;
    let canonicalTarget;
    try {
        canonicalTarget = await realpath(absolutePath);
        information ??= await lstat(absolutePath);
    } catch (error) {
        return failed('path-resolution', error, normalized);
    }
    const canonical = resolveAbsolutePathWithinScope({path: canonicalTarget, scope: canonicalRoot});
    if (canonical.status !== 'succeeded') return canonical;
    return succeeded({
        absolutePath,
        exists: true,
        information,
        kind: entryKind(information),
        path: normalized,
    });
};

/** @param {{canonicalRoot: string, path: string}} input */
const ensureParentDirectories = async ({canonicalRoot, path}) => {
    const parent = posix.dirname(path);
    if (parent === '.') return succeeded({created: []});
    const segments = parent.split('/');
    const created = [];
    let current = canonicalRoot;
    for (const segment of segments) {
        current = join(current, segment);
        try {
            const information = await lstat(current);
            if (information.isSymbolicLink() || !information.isDirectory()) {
                return blocked('filesystem-parent-invalid', 'A parent path is not a real directory.', path);
            }
        } catch (error) {
            if (!isMissing(error)) return failed('parent-observation', error, path);
            try {
                await mkdir(current);
                created.push(current);
            } catch (mkdirError) {
                return failed('parent-create', mkdirError, path);
            }
        }
    }
    return succeeded({created});
};

const temporaryPath = (/** @type {string} */ absolutePath) => join(
    dirname(absolutePath),
    `.${posix.basename(absolutePath.replaceAll('\\', '/'))}.arw-tmp-${process.pid}-${randomBytes(8).toString('hex')}`,
);

/** @param {ExistingChainObservation & {exists: true}} observation @param {boolean} rejectHardLinks */
const rejectHardLinkedFile = (observation, rejectHardLinks) => rejectHardLinks
    && observation.kind === 'file'
    && observation.information.nlink > 1;

/** @param {{canonicalRoot: string, path: string, rejectHardLinks: boolean}} input */
const readScopedBytes = async ({canonicalRoot, path, rejectHardLinks}) => {
    const observation = await inspectExistingChain({canonicalRoot, path});
    if (observation.status !== 'succeeded') return observation;
    if (!observation.exists || observation.kind !== 'file') {
        return blocked('filesystem-file-required', 'The path must be an existing regular file.', observation.path);
    }
    if (rejectHardLinkedFile(observation, rejectHardLinks)) {
        return blocked('filesystem-hard-link-unsupported', 'Hard linked files are not supported.', observation.path);
    }
    try {
        return succeeded({bytes: await readFile(observation.absolutePath), path: observation.path});
    } catch (error) {
        return failed('read', error, observation.path);
    }
};

/** @param {string} canonicalRoot @returns {ScopedFilesystem} */
const createScopedOperations = canonicalRoot => ({
    root: canonicalRoot,

    /** @param {{path: string}} input */
    resolve({path}) {
        return resolveRelativePathWithinScope({path, scope: canonicalRoot});
    },

    /** @param {{path: string, rejectHardLinks?: boolean}} input */
    async inspect({path, rejectHardLinks = false}) {
        if (typeof rejectHardLinks !== 'boolean') throw new TypeError('rejectHardLinks must be a boolean.');
        const observation = await inspectExistingChain({canonicalRoot, path});
        if (observation.status !== 'succeeded') return observation;
        if (!observation.exists) return succeeded({entry: {kind: 'missing', path: observation.path}});
        if (rejectHardLinkedFile(observation, rejectHardLinks)) {
            return blocked('filesystem-hard-link-unsupported', 'Hard linked files are not supported.', observation.path);
        }
        return succeeded({entry: {
            kind: observation.kind,
            path: observation.path,
            size: observation.information.size,
        }});
    },

    /** @param {{path: string, rejectHardLinks?: boolean}} input */
    async read({path, rejectHardLinks = false}) {
        if (typeof rejectHardLinks !== 'boolean') throw new TypeError('rejectHardLinks must be a boolean.');
        return readScopedBytes({canonicalRoot, path, rejectHardLinks});
    },

    /** @param {{allowLossyDecoding: boolean, path: string, rejectHardLinks?: boolean}} input */
    async readText({allowLossyDecoding, path, rejectHardLinks = false}) {
        if (typeof allowLossyDecoding !== 'boolean') throw new TypeError('allowLossyDecoding must be a boolean.');
        if (typeof rejectHardLinks !== 'boolean') throw new TypeError('rejectHardLinks must be a boolean.');
        const read = await readScopedBytes({canonicalRoot, path, rejectHardLinks});
        if (read.status !== 'succeeded') return read;
        try {
            const text = new TextDecoder('utf-8', {
                fatal: !allowLossyDecoding,
                ignoreBOM: true,
            }).decode(read.bytes);
            return succeeded({path: read.path, text});
        } catch (error) {
            return blocked(
                'filesystem-text-decoding-failed',
                error instanceof Error ? error.message : String(error),
                read.path,
            );
        }
    },

    /** @param {{path?: string, recursive?: boolean}} [input] */
    async list({path = '.', recursive = false} = {}) {
        if (typeof recursive !== 'boolean') throw new TypeError('recursive must be a boolean.');
        const observation = await inspectExistingChain({canonicalRoot, path});
        if (observation.status !== 'succeeded') return observation;
        if (!observation.exists || observation.kind !== 'directory') {
            return blocked('filesystem-directory-required', 'The path must be an existing real directory.', observation.path);
        }

        /** @type {Array<{kind: FilesystemEntryKind, path: string}>} */
        const entries = [];
        /** @param {string} directoryPath @param {string} directoryAbsolute @returns {Promise<FilesystemUnsuccessful | FilesystemSucceeded<object>>} */
        const visit = async (directoryPath, directoryAbsolute) => {
            let names;
            try {
                names = await readdir(directoryAbsolute);
            } catch (error) {
                return failed('enumerate', error, directoryPath);
            }
            names.sort(compareText);
            for (const name of names) {
                const childPath = directoryPath === '.' ? name : joinRelativePath(directoryPath, name);
                const childAbsolute = join(directoryAbsolute, name);
                let childInformation;
                try {
                    childInformation = await lstat(childAbsolute);
                } catch (error) {
                    if (isMissing(error)) {
                        return blocked('filesystem-enumeration-incomplete', 'A directory entry disappeared during enumeration.', childPath);
                    }
                    return failed('path-observation', error, childPath);
                }
                if (entryKind(childInformation) === 'link') {
                    entries.push({kind: 'link', path: childPath});
                    continue;
                }
                const child = await inspectExistingChain({canonicalRoot, path: childPath});
                if (child.status !== 'succeeded') return child;
                if (!child.exists) return blocked('filesystem-enumeration-incomplete', 'A directory entry disappeared during enumeration.', childPath);
                entries.push({kind: child.kind, path: childPath});
                if (recursive && child.kind === 'directory') {
                    const nested = await visit(childPath, child.absolutePath);
                    if (nested.status !== 'succeeded') return nested;
                }
            }
            return succeeded({});
        };

        const result = await visit(observation.path, observation.absolutePath);
        if (result.status !== 'succeeded') return result;
        return succeeded({entries});
    },

    /** @param {{path: string, recursive?: boolean}} input */
    async createDirectory({path, recursive = false}) {
        if (typeof recursive !== 'boolean') throw new TypeError('recursive must be a boolean.');
        const resolved = resolveRelativePathWithinScope({path, scope: canonicalRoot});
        if (resolved.status !== 'succeeded') return resolved;
        const normalized = logicalPath(resolved.relativePath);
        if (normalized === '.') {
            return blocked('filesystem-path-unsafe', 'The directory path is not a creatable root-relative path.', path);
        }
        const observation = await inspectExistingChain({canonicalRoot, path: normalized});
        if (observation.status !== 'succeeded') return observation;
        if (observation.exists) {
            return observation.kind === 'directory'
                ? succeeded({created: false, path: normalized})
                : blocked('filesystem-directory-collision', 'The directory path is already occupied.', normalized);
        }
        try {
            await mkdir(observation.absolutePath, {recursive});
            return succeeded({created: true, path: normalized});
        } catch (error) {
            return failed('directory-create', error, normalized);
        }
    },

    /** @param {{bytes: Buffer, mode: 'create' | 'create-atomic' | 'replace', path: string, fileMode?: number, beforeReplace?: () => void | Promise<void>}} input */
    async write({bytes, mode, path, fileMode, beforeReplace}) {
        if (!Buffer.isBuffer(bytes)) throw new TypeError('bytes must be a Buffer.');
        if (!['create', 'create-atomic', 'replace'].includes(mode)) throw new TypeError('mode must be create, create-atomic, or replace.');
        if (fileMode !== undefined && (!Number.isInteger(fileMode) || fileMode < 0 || fileMode > 0o7777)) {
            throw new TypeError('fileMode must be a non-negative integer no greater than 07777.');
        }
        if (beforeReplace !== undefined && typeof beforeReplace !== 'function') {
            throw new TypeError('beforeReplace must be a function.');
        }
        if (mode !== 'replace' && (fileMode !== undefined || beforeReplace !== undefined)) {
            throw new TypeError('fileMode and beforeReplace require replace mode.');
        }
        const resolved = resolveRelativePathWithinScope({path, scope: canonicalRoot});
        if (resolved.status !== 'succeeded') return resolved;
        const normalized = logicalPath(resolved.relativePath);
        if (normalized === '.') {
            return blocked('filesystem-path-unsafe', 'The file path is not a writable root-relative path.', path);
        }
        const before = await inspectExistingChain({canonicalRoot, path: normalized});
        if (before.status !== 'succeeded') return before;
        if (['create', 'create-atomic'].includes(mode) && before.exists) {
            return blocked('filesystem-create-collision', 'The file already exists.', normalized);
        }
        if (mode === 'replace' && (!before.exists || before.kind !== 'file')) {
            return blocked('filesystem-replace-target-invalid', 'The replacement target must be an existing regular file.', normalized);
        }
        const parents = await ensureParentDirectories({canonicalRoot, path: normalized});
        if (parents.status !== 'succeeded') return parents;
        if (mode === 'create') {
            try {
                await writeFile(before.absolutePath, bytes, {flag: 'wx'});
                return succeeded({path: normalized});
            } catch (error) {
                return failed('file-create', error, normalized);
            }
        }

        if (mode === 'create-atomic') {
            const temporary = temporaryPath(before.absolutePath);
            let temporaryWritten = false;
            try {
                await writeFile(temporary, bytes, {flag: 'wx'});
                temporaryWritten = true;
                await link(temporary, before.absolutePath);
                await unlink(temporary);
                return succeeded({path: normalized});
            } catch (error) {
                if (temporaryWritten) {
                    try {
                        await unlink(temporary);
                    } catch {
                    }
                }
                return failed('file-create-atomic', error, normalized);
            }
        }

        const temporary = temporaryPath(before.absolutePath);
        try {
            await writeFile(temporary, bytes, {flag: 'wx', ...(fileMode === undefined ? {} : {mode: fileMode})});
            if (fileMode !== undefined) await chmod(temporary, fileMode);
            if (beforeReplace !== undefined) await beforeReplace();
            await rename(temporary, before.absolutePath);
            return succeeded({path: normalized});
        } catch (error) {
            try {
                await unlink(temporary);
            } catch {
                // Best-effort cleanup does not replace the original failure.
            }
            return failed('file-replace', error, normalized);
        }
    },

    /** @param {{path: string, recursive?: boolean}} input */
    async remove({path, recursive = false}) {
        if (typeof recursive !== 'boolean') throw new TypeError('recursive must be a boolean.');
        const resolved = resolveRelativePathWithinScope({path, scope: canonicalRoot});
        if (resolved.status !== 'succeeded') return resolved;
        const normalized = logicalPath(resolved.relativePath);
        if (normalized === '.') {
            return blocked('filesystem-path-unsafe', 'The path is not a removable root-relative path.', path);
        }
        const observation = await inspectExistingChain({canonicalRoot, path: normalized});
        if (observation.status !== 'succeeded') return observation;
        if (!observation.exists) return succeeded({removed: false, path: observation.path});
        try {
            if (observation.kind === 'directory' && !recursive) {
                await rmdir(observation.absolutePath);
            } else {
                await rm(observation.absolutePath, {force: false, recursive});
            }
            return succeeded({removed: true, path: observation.path});
        } catch (error) {
            const code = error instanceof Error && 'code' in error ? error.code : undefined;
            if (observation.kind === 'directory' && !recursive && ['ENOTEMPTY', 'EEXIST'].includes(String(code))) {
                return blocked('filesystem-directory-not-empty', 'The directory is not empty.', observation.path);
            }
            return failed('remove', error, observation.path);
        }
    },

    /** @param {{mode: number, path: string}} input */
    async setMode({mode, path}) {
        if (!Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777) {
            throw new TypeError('mode must be a non-negative integer no greater than 07777.');
        }
        const observation = await inspectExistingChain({canonicalRoot, path});
        if (observation.status !== 'succeeded') return observation;
        if (!observation.exists || observation.kind !== 'file') {
            return blocked('filesystem-file-required', 'The path must be an existing regular file.', observation.path);
        }
        try {
            await chmod(observation.absolutePath, mode);
            return succeeded({path: observation.path});
        } catch (error) {
            return failed('mode-update', error, observation.path);
        }
    },
});

/** @param {{createRoot?: boolean, root: string}} input @returns {Promise<FilesystemUnsuccessful | FilesystemSucceeded<{scopedFilesystem: ScopedFilesystem}>>} */
export const createScopedFilesystem = async ({createRoot = false, root}) => {
    if (typeof root !== 'string' || !isAbsolute(root)) {
        throw new TypeError('root must be an absolute path.');
    }
    if (typeof createRoot !== 'boolean') throw new TypeError('createRoot must be a boolean.');
    const requestedRoot = resolve(root);
    let information;
    try {
        information = await lstat(requestedRoot);
    } catch (error) {
        if (!isMissing(error)) return failed('root-observation', error);
        if (!createRoot) {
            return blocked('filesystem-root-missing', 'The scoped filesystem root does not exist.');
        }
        try {
            await mkdir(requestedRoot, {recursive: true});
            information = await lstat(requestedRoot);
        } catch (createError) {
            return failed('root-create', createError);
        }
    }
    if (information.isSymbolicLink() || !information.isDirectory()) {
        return blocked('filesystem-root-invalid', 'The scoped filesystem root must be a real directory.');
    }
    let canonicalRoot;
    try {
        canonicalRoot = await realpath(requestedRoot);
    } catch (error) {
        return failed('root-resolution', error);
    }
    return succeeded({scopedFilesystem: createScopedOperations(canonicalRoot)});
};
