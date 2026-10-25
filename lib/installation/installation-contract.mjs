import {execFile as execFileCallback} from 'node:child_process';
import {basename, dirname, isAbsolute, join} from 'node:path';
import {promisify} from 'node:util';

import {INSTALLATION_DIRECTORY_NAME, PRODUCT_NAME} from '../arw-common/product-identity.mjs';
import {createScopedFilesystem, joinRelativePath} from '../common/filesystem.mjs';
import {jsonSemanticallyEqual, parseJsonText, serializeJson} from '../common/json.mjs';
import {
    INSTALLATION_MANIFEST_FILE as MANIFEST_FILE_NAME,
    INSTALLATION_MANIFEST_VERSION as MANIFEST_VERSION,
    installationOwnershipKey as ownershipKey,
    InstallationManifestValidationError,
    isManagedFileList,
    normalizeWindowsPathEntry,
    parseInstallationManifest,
    validateInstallationManifestRecord,
} from '../arw-common/installation-manifest.mjs';

export {parseInstallationManifest} from '../arw-common/installation-manifest.mjs';

/** @typedef {'windows-user-path' | 'linux-profile' | 'macos-experimental'} InstallationPathKind */
/** @typedef {{createdValue: boolean, entry: string, kind: 'windows-user-path', valueKind: 'String' | 'ExpandString'} | {kind: 'linux-profile', profile: string}} PathOwnership */
/** @typedef {{arwVersion: string, managedFiles: readonly string[], manifestVersion: 2, pathOwnership: readonly PathOwnership[], product: string}} InstallationManifest */
/** @typedef {{directory: string, exists: boolean, managed: boolean, manifest: InstallationManifest | null, pathKind: InstallationPathKind}} Installation */
/** @typedef {Record<string, unknown>} Environment */
/** @typedef {{exists: false, kind: null, value: ''} | {exists: true, kind: 'String' | 'ExpandString', value: string}} WindowsPathObservation */
/** @typedef {{read: () => Promise<WindowsPathObservation>, write: (input: {kind: 'String' | 'ExpandString', value: string}) => Promise<void>, remove?: () => Promise<void>, notify: () => Promise<boolean>}} WindowsPathAdapter */
/** @typedef {{read: () => Promise<string | null>, write: (input: {content: string, exists: boolean}) => Promise<void>}} LinuxProfileAdapter */
/** @typedef {() => Promise<void>} OwnershipOperation */
/** @typedef {{apply: OwnershipOperation | null, failurePathOwnership: readonly PathOwnership[], notice: string | null, notify: (() => Promise<boolean>) | null, pathOwnership: readonly PathOwnership[], revalidate: () => Promise<boolean>}} OwnershipPlanData */
/** @typedef {{kind: 'missing' | 'malformed'} | {after: number, kind: 'canonical' | 'noncanonical', start: number}} ProfileMarker */

const PROFILE_MARKER_START = `# >>> ${PRODUCT_NAME} PATH >>>`;
const PROFILE_MARKER_END = `# <<< ${PRODUCT_NAME} PATH <<<`;
const PROFILE_MARKER_BLOCK = `${PROFILE_MARKER_START}\nexport PATH="$HOME/${INSTALLATION_DIRECTORY_NAME}:$PATH"\n${PROFILE_MARKER_END}`;
const HOME_INSTALLATION_ENTRY = `$HOME/${INSTALLATION_DIRECTORY_NAME}`;

const WINDOWS_PATH_ENVIRONMENT = 'ARW_USER_PATH';
const WINDOWS_PATH_KIND_ENVIRONMENT = 'ARW_USER_PATH_KIND';
const execFile = promisify(execFileCallback);
/** @param {string} platform @returns {InstallationPathKind | null} */
const pathKindForPlatform = platform => platform === 'win32'
    ? 'windows-user-path'
    : platform === 'linux'
        ? 'linux-profile'
        : platform === 'darwin'
            ? 'macos-experimental'
            : null;

/** @param {string} code @param {string} message */
const inspectionDiagnostic = (code, message) => ({code, message});

/**
 * 标记 Installation 实现检测到的内部不变量破坏.
 * Installer 和 Uninstaller 必须让此错误越过结构化操作失败边界, 使调用方可以区分实现缺陷与预期输入或 I/O 失败.
 */
export class InstallationInvariantError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'InstallationInvariantError';
    }
}

class PathObservationError extends Error {}
class PathOwnershipBlockedError extends Error {}

/** @param {unknown} value @param {boolean} requireManifest @returns {Installation} */
const validateInstallationState = (value, requireManifest) => {
    if (value === null
        || typeof value !== 'object'
        || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== 'directory,exists,managed,manifest,pathKind'
        || !('directory' in value)
        || typeof value.directory !== 'string'
        || !isAbsolute(value.directory)
        || !('exists' in value)
        || typeof value.exists !== 'boolean'
        || !('managed' in value)
        || typeof value.managed !== 'boolean'
        || !('manifest' in value)
        || !('pathKind' in value)
        || (value.pathKind !== 'windows-user-path'
            && value.pathKind !== 'linux-profile'
            && value.pathKind !== 'macos-experimental')
        || (requireManifest && value.manifest === null)
        || value.managed !== (value.manifest !== null)
        || (!value.exists && (value.managed || value.manifest !== null))) {
        throw new TypeError('PATH planning requires a complete Installation state.');
    }
    const installation = /** @type {{directory: string, exists: boolean, managed: boolean, manifest: unknown, pathKind: InstallationPathKind}} */ (value);
    if (installation.manifest === null) return /** @type {Installation} */ (installation);
    try {
        return {
            ...installation,
            manifest: validateInstallationManifestRecord({
                expectedPathKind: installation.pathKind,
                installationDirectory: installation.directory,
                value: installation.manifest,
            }),
        };
    } catch {
        throw new TypeError('PATH planning requires a complete Installation state.');
    }
};

/** @param {Environment} environment @param {string} platform @param {string} operation @returns {Pick<Installation, 'directory' | 'pathKind'>} */
const resolveInstallationFor = (environment, platform, operation) => {
    const pathKind = pathKindForPlatform(platform);

    if (pathKind === null) {
        throw new Error(`Unsupported ${operation} platform: ${platform}.`);
    }

    const variable = pathKind === 'windows-user-path' ? 'USERPROFILE' : 'HOME';
    const home = environment[variable];
    if (typeof home !== 'string' || !isAbsolute(home)) {
        throw new Error(`Cannot resolve an absolute ${variable} directory.`);
    }

    return {directory: join(home, INSTALLATION_DIRECTORY_NAME), pathKind};
};

/**
 * 在任何 source 或 target I/O 前解析 Installer 使用的固定 Installation location 和 platform kind。
 */
/** @param {Environment} environment @param {string} platform */
export const resolveInstallation = (environment, platform) => resolveInstallationFor(environment, platform, 'installation');

/** @param {unknown} input */
export const inspectInstallation = async input => {
    if (input === null
        || typeof input !== 'object'
        || Array.isArray(input)
        || Object.keys(input).sort().join(',') !== 'installationDirectory,platform'
        || !('installationDirectory' in input)
        || !('platform' in input)
        || typeof input.installationDirectory !== 'string'
        || !isAbsolute(input.installationDirectory)
        || typeof input.platform !== 'string') {
        throw new TypeError('Installation inspection requires an absolute installationDirectory and platform.');
    }
    const pathKind = pathKindForPlatform(input.platform);
    if (pathKind === null) {
        return {
            diagnostics: [inspectionDiagnostic('installation-platform-unsupported', `Unsupported installation platform: ${input.platform}.`)],
            status: /** @type {'blocked'} */ ('blocked'),
        };
    }
    const installationDirectory = input.installationDirectory;
    const opened = await createScopedFilesystem({root: dirname(installationDirectory)});
    if (opened.status === 'failed') {
        return {
            diagnostics: opened.diagnostics,
            stage: 'installation-directory-observation',
            status: /** @type {'failed'} */ ('failed'),
        };
    }
    if (opened.status === 'blocked') {
        return {
            diagnostics: [inspectionDiagnostic('installation-directory-invalid', `Installation target is not a real directory: ${installationDirectory}.`)],
            status: /** @type {'blocked'} */ ('blocked'),
        };
    }
    const filesystem = opened.scopedFilesystem;
    const installationPath = basename(installationDirectory);
    const installationEntry = await filesystem.inspect({path: installationPath});
    if (installationEntry.status === 'failed') {
        return {
            diagnostics: installationEntry.diagnostics,
            stage: 'installation-directory-observation',
            status: /** @type {'failed'} */ ('failed'),
        };
    }
    if (installationEntry.status === 'blocked' || installationEntry.entry.kind === 'link') {
        return {
            diagnostics: [inspectionDiagnostic('installation-directory-invalid', `Installation target is not a real directory: ${installationDirectory}.`)],
            status: /** @type {'blocked'} */ ('blocked'),
        };
    }
    if (installationEntry.entry.kind === 'missing') {
        return {diagnostics: [], installation: null, status: /** @type {'succeeded'} */ ('succeeded')};
    }
    if (installationEntry.entry.kind !== 'directory') {
        return {
            diagnostics: [inspectionDiagnostic('installation-directory-invalid', `Installation target is not a real directory: ${installationDirectory}.`)],
            status: /** @type {'blocked'} */ ('blocked'),
        };
    }

    const manifestPath = joinRelativePath(installationPath, MANIFEST_FILE_NAME);
    const manifestEntry = await filesystem.inspect({path: manifestPath, rejectHardLinks: true});
    if (manifestEntry.status === 'failed') {
        return {
            diagnostics: [inspectionDiagnostic('installation-manifest-observation-failed', `Installation manifest could not be inspected: ${MANIFEST_FILE_NAME}.`)],
            stage: 'installation-manifest-observation',
            status: /** @type {'failed'} */ ('failed'),
        };
    }
    if (manifestEntry.status === 'blocked') {
        return {
            diagnostics: [inspectionDiagnostic('installation-manifest-invalid', `Installation manifest is not a real regular file: ${MANIFEST_FILE_NAME}.`)],
            status: /** @type {'blocked'} */ ('blocked'),
        };
    }
    if (manifestEntry.entry.kind === 'missing') {
        return {
            diagnostics: [],
            installation: {installationDirectory, manifest: null, pathKind},
            status: /** @type {'succeeded'} */ ('succeeded'),
        };
    }
    if (manifestEntry.entry.kind !== 'file') {
        return {
            diagnostics: [inspectionDiagnostic('installation-manifest-invalid', `Installation manifest is not a real regular file: ${MANIFEST_FILE_NAME}.`)],
            status: /** @type {'blocked'} */ ('blocked'),
        };
    }
    const manifestRead = await filesystem.read({path: manifestPath, rejectHardLinks: true});
    if (manifestRead.status === 'failed') {
        return {
            diagnostics: [inspectionDiagnostic('installation-manifest-read-failed', `Installation manifest could not be read: ${MANIFEST_FILE_NAME}.`)],
            stage: 'installation-manifest-read',
            status: /** @type {'failed'} */ ('failed'),
        };
    }
    if (manifestRead.status === 'blocked') {
        return {
            diagnostics: [inspectionDiagnostic('installation-manifest-invalid', `Installation manifest is not a real regular file: ${MANIFEST_FILE_NAME}.`)],
            status: /** @type {'blocked'} */ ('blocked'),
        };
    }

    let manifest;
    try {
        manifest = parseInstallationManifest({
            bytes: manifestRead.bytes,
            expectedPathKind: pathKind,
            installationDirectory,
        });
    } catch (error) {
        const damaged = error instanceof InstallationManifestValidationError && error.kind === 'damaged';
        return {
            diagnostics: [inspectionDiagnostic(
                damaged ? 'installation-manifest-damaged' : 'installation-manifest-unsupported',
                damaged
                    ? 'Installation manifest is damaged; ownership cannot be proven.'
                    : 'Installation manifest has an unsupported product, version, or ownership record.',
            )],
            status: /** @type {'blocked'} */ ('blocked'),
        };
    }
    return {
        diagnostics: [],
        installation: {installationDirectory, manifest, pathKind},
        status: /** @type {'succeeded'} */ ('succeeded'),
    };
};

/**
 * 读取并证明 Uninstaller 所需的完整 ownership manifest。缺失 Installation 保留为幂等结果; 其他无法证明 ownership 的分类在任何删除前失败。
 */
/** @param {Environment} environment @param {string} platform */
export const loadInstallationOwnership = async (environment, platform) => {
    const location = resolveInstallationFor(environment, platform, 'uninstallation');
    const result = await inspectInstallation({installationDirectory: location.directory, platform});
    if (result.status !== 'succeeded') {
        throw new Error(result.diagnostics.map(entry => entry.message).join(' '));
    }
    if (result.installation === null) {
        return {directory: location.directory, exists: false, managed: false, manifest: null, pathKind: location.pathKind};
    }
    return {
        directory: result.installation.installationDirectory,
        exists: true,
        managed: result.installation.manifest !== null,
        manifest: result.installation.manifest,
        pathKind: result.installation.pathKind,
    };
};

/** @param {{diagnostics: Array<{message: string}>}} result */
const filesystemResultMessage = result => result.diagnostics.map(entry => entry.message).join(' ');

/** @param {string} profile @returns {Promise<LinuxProfileAdapter>} */
const createDefaultLinuxProfileAdapter = async profile => {
    const opened = await createScopedFilesystem({root: dirname(profile)});
    if (opened.status === 'blocked') {
        throw new PathOwnershipBlockedError(filesystemResultMessage(opened));
    }
    if (opened.status === 'failed') {
        throw new Error(filesystemResultMessage(opened));
    }
    const filesystem = opened.scopedFilesystem;
    const path = basename(profile);
    return {
        read: async () => {
            const inspected = await filesystem.inspect({path, rejectHardLinks: true});
            if (inspected.status === 'blocked') {
                throw new PathOwnershipBlockedError(`Cannot safely modify linked or non-file ownership target: ${profile}.`);
            }
            if (inspected.status === 'failed') {
                throw new Error(filesystemResultMessage(inspected));
            }
            if (inspected.entry.kind === 'missing') return null;
            if (inspected.entry.kind !== 'file') {
                throw new PathOwnershipBlockedError(`Cannot safely modify linked or non-file ownership target: ${profile}.`);
            }
            const read = await filesystem.readText({
                allowLossyDecoding: false,
                path,
                rejectHardLinks: true,
            });
            if (read.status === 'blocked') {
                throw new PathOwnershipBlockedError(filesystemResultMessage(read));
            }
            if (read.status === 'failed') {
                throw new Error(filesystemResultMessage(read));
            }
            return read.text;
        },
        write: async ({content, exists}) => {
            const written = await filesystem.write({
                bytes: Buffer.from(content, 'utf8'),
                mode: exists ? 'replace' : 'create-atomic',
                path,
            });
            if (written.status !== 'succeeded') {
                throw new Error(filesystemResultMessage(written));
            }
        },
    };
};

/**
 * Installer 完成程序, 配置和 PATH 步骤后, 通过受限 Filesystem 原子提交 canonical ownership manifest.
 * 首次安装只在目标仍缺失时提交, 已有受管 Installation 只替换既有普通文件.
 * @param {Pick<Installation, 'directory' | 'manifest'>} installation
 * @param {readonly string[]} managedFiles
 * @param {readonly PathOwnership[]} pathOwnership
 * @param {{arwVersion: string}} release
 * @param {{filesystem: {write: (input: {bytes: Buffer, mode: 'create-atomic' | 'replace', path: string}) => Promise<{diagnostics: Array<{message: string}>, status: string}>}, installationPath: string}} preparedFilesystem
 */
export const writeInstallationManifest = async (installation, managedFiles, pathOwnership, release, preparedFilesystem) => {
    const manifest = {
        arwVersion: release.arwVersion,
        manifestVersion: MANIFEST_VERSION,
        managedFiles: [...managedFiles].sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
        pathOwnership: [...pathOwnership],
        product: PRODUCT_NAME,
    };
    try {
        validateInstallationManifestRecord({expectedPathKind: undefined, installationDirectory: installation.directory, value: manifest});
    } catch {
        throw new InstallationInvariantError('Cannot write an invalid Installation ownership manifest.');
    }
    const serialized = serializeJson(manifest);
    if (serialized.status !== 'succeeded') {
        throw new InstallationInvariantError('Cannot serialize a valid Installation ownership manifest.');
    }
    const result = await preparedFilesystem.filesystem.write({
        bytes: serialized.bytes,
        mode: installation.manifest === null ? 'create-atomic' : 'replace',
        path: joinRelativePath(preparedFilesystem.installationPath, MANIFEST_FILE_NAME),
    });
    if (result.status !== 'succeeded') {
        throw new Error(result.diagnostics.map(diagnostic => diagnostic.message).join(' '));
    }
};

/**
 * 删除已经完成 ownership 释放的 manifest. 文件已不存在视为幂等成功, 其他 I/O failure 保持 transaction failure.
 * @param {{filesystem: {remove: (input: {path: string}) => Promise<{diagnostics: Array<{message: string}>, status: string}>}, installationPath: string}} preparedFilesystem
 */
export const removeInstallationManifest = async preparedFilesystem => {
    const result = await preparedFilesystem.filesystem.remove({
        path: joinRelativePath(preparedFilesystem.installationPath, MANIFEST_FILE_NAME),
    });
    if (result.status !== 'succeeded') {
        throw new Error(result.diagnostics.map(diagnostic => diagnostic.message).join(' '));
    }
};

/**
 * 只删除 verified manifest managed paths 形成的空父目录. 非空目录保留其非 managed 内容.
 * @param {{filesystem: {remove: (input: {path: string}) => Promise<{diagnostics: Array<{code: string, message: string}>, removed?: boolean, status: string}>}, installationPath: string}} preparedFilesystem
 * @param {readonly string[]} managedFiles
 */
export const removeEmptyManagedDirectories = async (preparedFilesystem, managedFiles) => {
    const directories = new Set();
    for (const file of managedFiles) {
        const segments = file.split('/');
        for (let length = segments.length - 1; length > 0; length -= 1) {
            directories.add(joinRelativePath(...segments.slice(0, length)));
        }
    }

    let removedAny = false;
    const deepestFirst = [...directories].sort((left, right) => right.split('/').length - left.split('/').length);
    for (const directory of deepestFirst) {
        const result = await preparedFilesystem.filesystem.remove({
            path: joinRelativePath(preparedFilesystem.installationPath, directory),
        });
        if (result.status === 'blocked'
            && result.diagnostics.every(diagnostic => diagnostic.code === 'filesystem-directory-not-empty')) {
            continue;
        }
        if (result.status !== 'succeeded') {
            throw new Error(result.diagnostics.map(diagnostic => diagnostic.message).join(' '));
        }
        removedAny = result.removed === true || removedAny;
    }
    return removedAny;
};

/**
 * 证明 managed relative paths 的所有既有父级都仍是 Installation 内的真实目录。缺失目录可由 installer 创建, junction、symlink 和非目录目标一律拒绝。
 */
/** @param {string} installationDirectory @param {readonly string[]} managedFiles */
const assertSafeManagedDirectories = async (installationDirectory, managedFiles) => {
    const directories = new Set();
    for (const file of managedFiles) {
        const segments = file.split('/');
        for (let length = 1; length < segments.length; length += 1) {
            directories.add(joinRelativePath(...segments.slice(0, length)));
        }
    }

    const opened = await createScopedFilesystem({root: dirname(installationDirectory)});
    if (opened.status !== 'succeeded') throw new Error(filesystemResultMessage(opened));
    const installationPath = basename(installationDirectory);
    for (const directory of directories) {
        const inspected = await opened.scopedFilesystem.inspect({
            path: joinRelativePath(installationPath, directory),
        });
        if (inspected.status === 'failed') throw new Error(filesystemResultMessage(inspected));
        if (inspected.status === 'blocked'
            || (inspected.entry.kind !== 'missing' && inspected.entry.kind !== 'directory')) {
            throw new Error(`Cannot use linked or non-directory runtime directory: ${directory}.`);
        }
    }
};

/**
 * 证明 manifest 与 transaction 新增的 managed paths 始终留在 Installation 内。Installer 还可声明将覆盖的文件目标,
 * 从而在写入前统一拒绝 symlink、hard link 和非文件目标; Uninstaller 只证明 manifest 中的既有父目录。
 */
/**
 * @param {Installation} installation
 * @param {{managedFiles?: readonly string[], overwriteFiles?: readonly string[]}} [options]
 */
export const assertSafeManagedPaths = async (installation, {managedFiles = [], overwriteFiles = []} = {}) => {
    if (!isManagedFileList(managedFiles) || !isManagedFileList(overwriteFiles)) {
        throw new Error('Transaction managed file paths are invalid.');
    }
    const allManagedFiles = [...(installation.manifest?.managedFiles ?? []), ...managedFiles];
    await assertSafeManagedDirectories(installation.directory, allManagedFiles);

    const opened = await createScopedFilesystem({root: dirname(installation.directory)});
    if (opened.status !== 'succeeded') throw new Error(filesystemResultMessage(opened));
    const installationPath = basename(installation.directory);
    const protectedFiles = new Set([...(installation.manifest?.managedFiles ?? []), ...overwriteFiles]);
    for (const file of protectedFiles) {
        const inspected = await opened.scopedFilesystem.inspect({
            path: joinRelativePath(installationPath, file),
            rejectHardLinks: true,
        });
        if (inspected.status === 'failed') throw new Error(filesystemResultMessage(inspected));
        if (inspected.status === 'blocked'
            || (inspected.entry.kind !== 'missing' && inspected.entry.kind !== 'file')) {
            throw new Error(`Cannot safely modify linked or non-file runtime target: ${file}.`);
        }
    }
};

/**
 * 读写 Windows current-user PATH。写入值经临时环境变量传给 PowerShell, 避免把任意 PATH 内容拼入命令字符串; 调用方负责先保留未知 entry。
 */
/** @type {WindowsPathAdapter} */
const defaultWindowsPath = {
    read: async () => {
        const {stdout} = await execFile('powershell.exe', [
            '-NoProfile',
            '-Command',
            "$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment'); if ($null -eq $key -or $null -eq $key.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)) { [Console]::Out.Write('{\"exists\":false,\"kind\":null,\"value\":\"\"}') } else { $value = $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); $kind = $key.GetValueKind('Path').ToString(); [Console]::Out.Write((@{exists=$true;kind=$kind;value=$value} | ConvertTo-Json -Compress)) }",
        ], {encoding: 'utf8', windowsHide: true});
        const parsed = parseJsonText(stdout);
        if (parsed.status !== 'succeeded') {
            throw new Error(parsed.diagnostics.map(diagnostic => diagnostic.message).join(' '));
        }
        return parsed.value;
    },
    write: async ({kind, value}) => {
        await execFile('powershell.exe', [
            '-NoProfile',
            '-Command',
            `$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); $kind = [Microsoft.Win32.RegistryValueKind]([Environment]::GetEnvironmentVariable('${WINDOWS_PATH_KIND_ENVIRONMENT}')); $key.SetValue('Path', [Environment]::GetEnvironmentVariable('${WINDOWS_PATH_ENVIRONMENT}'), $kind)`,
        ], {env: {...process.env, [WINDOWS_PATH_ENVIRONMENT]: value, [WINDOWS_PATH_KIND_ENVIRONMENT]: kind}, windowsHide: true});
    },
    remove: async () => {
        await execFile('powershell.exe', [
            '-NoProfile',
            '-Command',
            "$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true); if ($null -ne $key) { $key.DeleteValue('Path', $false) }",
        ], {windowsHide: true});
    },
    notify: async () => {
        await execFile('powershell.exe', [
            '-NoProfile',
            '-Command',
            [
                "Add-Type -TypeDefinition @'",
                'using System;',
                'using System.Runtime.InteropServices;',
                'public static class ArwEnvironmentBroadcast {',
                '    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode, SetLastError = true)]',
                '    public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint message, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);',
                '}',
                "'@",
                '$hwndBroadcast = [IntPtr]0xffff',
                '$wmSettingChange = 0x001a',
                '$smtoAbortIfHung = 0x0002',
                '$timeoutMilliseconds = 1000',
                '$result = [UIntPtr]::Zero',
                "$sent = [ArwEnvironmentBroadcast]::SendMessageTimeout($hwndBroadcast, $wmSettingChange, [UIntPtr]::Zero, 'Environment', $smtoAbortIfHung, $timeoutMilliseconds, [ref]$result)",
                'if ($sent -eq [IntPtr]::Zero) { exit 1 }',
            ].join('\n'),
        ], {windowsHide: true});
        return true;
    },
};

/** @param {unknown} observation @returns {WindowsPathObservation} */
const validateWindowsPathObservation = observation => {
    if (observation === null || typeof observation !== 'object') {
        throw new Error('Windows user Path Registry value is unavailable or has an unsupported kind.');
    }
    if ('exists' in observation && 'kind' in observation && 'value' in observation) {
        if (observation.exists === false && observation.kind === null && observation.value === '') {
            return {exists: false, kind: null, value: ''};
        }
        if (observation.exists === true
            && (observation.kind === 'String' || observation.kind === 'ExpandString')
            && typeof observation.value === 'string') {
            return {exists: true, kind: observation.kind, value: observation.value};
        }
    }
    throw new Error('Windows user Path Registry value is unavailable or has an unsupported kind.');
};

/** @type {WeakMap<object, OwnershipPlanData>} */
const ownershipPlans = new WeakMap();

/** @param {readonly PathOwnership[]} ownership @param {PathOwnership} record */
const addOwnership = (ownership, record) => ownership.some(candidate => ownershipKey(candidate) === ownershipKey(record))
    ? [...ownership]
    : [...ownership, record];

/** @param {string} content */
const hasEquivalentProfileEntry = content => content.split(/\r?\n/).some(line => {
    const trimmed = line.trim();
    const assignment = /^export\s+PATH\s*=\s*(?:"([^"]*)"|([^'"\s#]+))\s*$/.exec(trimmed);
    if (!assignment) {
        return false;
    }

    const value = assignment[1] ?? assignment[2];
    return value.split(':').includes(HOME_INSTALLATION_ENTRY);
});

/** @param {string} content @param {string} marker */
const markerOccurrences = (content, marker) => {
    const offsets = [];
    for (let offset = content.indexOf(marker); offset !== -1; offset = content.indexOf(marker, offset + marker.length)) {
        offsets.push(offset);
    }
    return offsets;
};

/** @param {string} content @param {number} offset @param {string} marker */
const occupiesFullLine = (content, offset, marker) => {
    const after = offset + marker.length;
    const startsLine = offset === 0 || content[offset - 1] === '\n';
    const endsLine = after === content.length
        || content[after] === '\n'
        || (content[after] === '\r' && content[after + 1] === '\n');
    return startsLine && endsLine;
};

/** @param {string} content @returns {ProfileMarker} */
const inspectProfileMarker = content => {
    const starts = markerOccurrences(content, PROFILE_MARKER_START);
    const ends = markerOccurrences(content, PROFILE_MARKER_END);
    if (starts.length === 0 && ends.length === 0) {
        return {kind: 'missing'};
    }
    if (starts.length !== 1 || ends.length !== 1) {
        return {kind: 'malformed'};
    }

    const [start] = starts;
    const [end] = ends;
    if (end <= start
        || !occupiesFullLine(content, start, PROFILE_MARKER_START)
        || !occupiesFullLine(content, end, PROFILE_MARKER_END)) {
        return {kind: 'malformed'};
    }

    const after = end + PROFILE_MARKER_END.length;
    return {
        after,
        kind: content.slice(start, after) === PROFILE_MARKER_BLOCK ? 'canonical' : 'noncanonical',
        start,
    };
};

/** @param {OwnershipOperation | null} apply @param {readonly PathOwnership[]} pathOwnership @param {string | null} [notice] @param {(() => Promise<boolean>) | null} [notify] @param {() => Promise<boolean>} [revalidate] @param {readonly PathOwnership[]} [failurePathOwnership] */
const createOwnershipPlan = (apply, pathOwnership, notice = null, notify = null, revalidate = async () => true, failurePathOwnership = []) => {
    const plan = Object.freeze({});
    ownershipPlans.set(plan, {
        apply,
        failurePathOwnership: [...failurePathOwnership],
        notice,
        notify,
        pathOwnership: [...pathOwnership],
        revalidate,
    });
    return plan;
};

/** @template T @param {() => Promise<T>} operation */
const observePathState = async operation => {
    try {
        return await operation();
    } catch (error) {
        if (error instanceof PathOwnershipBlockedError) throw error;
        throw new PathObservationError(error instanceof Error ? error.message : String(error));
    }
};

/**
 * 预检 Installer 的 PATH/profile ownership 取得或修复。返回值是 opaque plan,
 * raw content、marker offsets 和 adapter details 只保留在 module implementation 中。
 */
/** @param {{installation: Installation, linuxProfile?: LinuxProfileAdapter, registerPath: boolean, windowsPath?: WindowsPathAdapter}} input */
const preparePathRegistration = async ({installation, linuxProfile, registerPath, windowsPath}) => {
    const previous = installation.manifest?.pathOwnership ?? [];
    if (registerPath !== true) {
        return createOwnershipPlan(null, previous);
    }
    if (installation.pathKind === 'macos-experimental') {
        throw new Error('Automatic PATH registration is not supported for experimental macOS installation.');
    }

    if (installation.pathKind === 'windows-user-path') {
        const adapter = windowsPath ?? defaultWindowsPath;
        const observed = validateWindowsPathObservation(await observePathState(() => adapter.read()));
        const revalidate = async () => {
            const current = validateWindowsPathObservation(await observePathState(() => adapter.read()));
            return jsonSemanticallyEqual(current, observed);
        };
        const content = observed.value;
        const target = normalizeWindowsPathEntry(installation.directory);
        if (content.split(';').some(entry => normalizeWindowsPathEntry(entry) === target)) {
            return createOwnershipPlan(null, previous, null, null, revalidate, previous);
        }

        const updated = content.length === 0
            ? installation.directory
            : `${content}${content.endsWith(';') ? '' : ';'}${installation.directory}`;
        const valueKind = observed.exists ? observed.kind : 'ExpandString';
        const pathOwnership = addOwnership(previous, {
            createdValue: !observed.exists,
            entry: installation.directory,
            kind: installation.pathKind,
            valueKind,
        });
        return createOwnershipPlan(
            () => adapter.write({kind: valueKind, value: updated}),
            pathOwnership,
            `Registered ${PRODUCT_NAME} in the current user PATH.`,
            adapter.notify,
            revalidate,
            previous,
        );
    }

    const profile = join(dirname(installation.directory), '.profile');
    const adapter = linuxProfile ?? await observePathState(() => createDefaultLinuxProfileAdapter(profile));
    const observedContent = await observePathState(() => adapter.read());
    if (observedContent !== null && typeof observedContent !== 'string') {
        throw new PathObservationError('Linux profile Adapter returned an invalid observation.');
    }
    const content = observedContent ?? '';
    const revalidate = async () => await observePathState(() => adapter.read()) === observedContent;
    const marker = inspectProfileMarker(content);
    if (marker.kind === 'malformed') {
        throw new Error(`Cannot safely update malformed ${PRODUCT_NAME} marker in ${profile}.`);
    }

    /** @type {PathOwnership} */
    const record = {kind: 'linux-profile', profile};
    const alreadyOwned = previous.some(candidate => ownershipKey(candidate) === ownershipKey(record));
    if (marker.kind === 'canonical') {
        return createOwnershipPlan(null, previous, null, null, revalidate, previous);
    }
    if (marker.kind === 'noncanonical') {
        if (!alreadyOwned) {
            throw new Error(`The existing ${PRODUCT_NAME} marker in ${profile} cannot be rewritten without prior manifest ownership.`);
        }
        const updated = `${content.slice(0, marker.start)}${PROFILE_MARKER_BLOCK}${content.slice(marker.after)}`;
        return createOwnershipPlan(
            () => adapter.write({content: updated, exists: observedContent !== null}),
            addOwnership(previous, record),
            null,
            null,
            revalidate,
            previous,
        );
    }
    if (hasEquivalentProfileEntry(content)) {
        return createOwnershipPlan(null, previous, null, null, revalidate, previous);
    }

    const separator = content.length === 0 || content.endsWith('\n') ? '' : '\n';
    const updated = `${content}${separator}${PROFILE_MARKER_BLOCK}\n`;
    return createOwnershipPlan(
        () => adapter.write({content: updated, exists: observedContent !== null}),
        addOwnership(previous, record),
        null,
        null,
        revalidate,
        previous,
    );
};

/** @param {{installation: Installation, linuxProfile?: LinuxProfileAdapter, registerPath: boolean, windowsPath?: WindowsPathAdapter}} input */
export const planPathRegistration = async input => {
    if (input === null || typeof input !== 'object' || Array.isArray(input) || typeof input.registerPath !== 'boolean') {
        throw new TypeError('PATH registration planning requires installation and registerPath.');
    }
    const installation = validateInstallationState(input.installation, false);
    try {
        const preparedPathOwnership = await preparePathRegistration({...input, installation});
        return {diagnostics: [], preparedPathOwnership, status: /** @type {'succeeded'} */ ('succeeded')};
    } catch (error) {
        if (error instanceof InstallationInvariantError) throw error;
        if (error instanceof PathObservationError) {
            return {
                diagnostics: [inspectionDiagnostic('path-observation-failed', error.message)],
                stage: 'path-observation',
                status: /** @type {'failed'} */ ('failed'),
            };
        }
        return {
            diagnostics: [inspectionDiagnostic('path-registration-blocked', error instanceof Error ? error.message : String(error))],
            status: /** @type {'blocked'} */ ('blocked'),
        };
    }
};

/**
 * 预检 Uninstaller 将释放的全部 PATH/profile ownership。任何无法证明的 profile marker
 * 在返回 plan 前失败, 使 transaction caller 尚未执行任何删除。
 */
/** @param {{installation: Installation & {manifest: InstallationManifest}, linuxProfile?: LinuxProfileAdapter, windowsPath?: WindowsPathAdapter}} input */
const preparePathRemoval = async ({installation, linuxProfile, windowsPath}) => {
    /** @type {OwnershipOperation[]} */
    const operations = [];
    /** @type {Array<() => Promise<boolean>>} */
    const revalidations = [];
    let notify = null;
    for (const ownership of installation.manifest.pathOwnership) {
        if (ownership.kind === 'windows-user-path') {
            const adapter = windowsPath ?? defaultWindowsPath;
            const observed = validateWindowsPathObservation(await observePathState(() => adapter.read()));
            revalidations.push(async () => {
                const current = validateWindowsPathObservation(await observePathState(() => adapter.read()));
                return jsonSemanticallyEqual(current, observed);
            });
            if (!observed.exists) continue;
            const content = observed.value;
            const entries = content.split(';');
            let index = entries.findIndex(entry => entry === ownership.entry);
            if (index === -1) {
                const target = normalizeWindowsPathEntry(ownership.entry);
                index = entries.findIndex(entry => normalizeWindowsPathEntry(entry) === target);
            }
            if (index !== -1) {
                entries.splice(index, 1);
                const updated = entries.join(';');
                if (ownership.createdValue && updated === '') {
                    const remove = adapter.remove;
                    if (typeof remove !== 'function') {
                        throw new InstallationInvariantError('Windows PATH adapter cannot remove a Registry value.');
                    }
                    operations.push(() => remove());
                } else {
                    operations.push(() => adapter.write({kind: ownership.valueKind, value: updated}));
                }
                notify = adapter.notify;
            }
            continue;
        }

        const adapter = linuxProfile ?? await observePathState(() => createDefaultLinuxProfileAdapter(ownership.profile));
        const content = await observePathState(() => adapter.read());
        if (content !== null && typeof content !== 'string') {
            throw new PathObservationError('Linux profile Adapter returned an invalid observation.');
        }
        revalidations.push(async () => await observePathState(() => adapter.read()) === content);
        if (content === null) {
            continue;
        }
        const marker = inspectProfileMarker(content);
        if (marker.kind === 'missing') {
            continue;
        }
        if (marker.kind !== 'canonical') {
            throw new Error(`The owned marker in ${ownership.profile} changed; cannot prove ownership for removal.`);
        }

        const trailingNewlineLength = content.slice(marker.after).startsWith('\r\n')
            ? 2
            : content[marker.after] === '\n' ? 1 : 0;
        const updated = `${content.slice(0, marker.start)}${content.slice(marker.after + trailingNewlineLength)}`;
        operations.push(() => adapter.write({content: updated, exists: true}));
    }

    const apply = operations.length === 0 ? null : async () => {
        for (const operation of operations) {
            await operation();
        }
    };
    return createOwnershipPlan(
        apply,
        [],
        null,
        notify,
        async () => (await Promise.all(revalidations.map(revalidate => revalidate()))).every(Boolean),
        installation.manifest.pathOwnership,
    );
};

/** @param {{installation: Installation & {manifest: InstallationManifest}, linuxProfile?: LinuxProfileAdapter, windowsPath?: WindowsPathAdapter}} input */
export const planPathRemoval = async input => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('PATH removal planning requires an installation with a manifest.');
    }
    const installation = validateInstallationState(input.installation, true);
    try {
        if (installation.manifest === null) throw new InstallationInvariantError('Validated PATH removal state lost its manifest.');
        const preparedPathOwnership = await preparePathRemoval({
            ...input,
            installation: /** @type {Installation & {manifest: InstallationManifest}} */ (installation),
        });
        return {diagnostics: [], preparedPathOwnership, status: /** @type {'succeeded'} */ ('succeeded')};
    } catch (error) {
        if (error instanceof InstallationInvariantError) throw error;
        if (error instanceof PathObservationError) {
            return {
                diagnostics: [inspectionDiagnostic('path-observation-failed', error.message)],
                stage: 'path-observation',
                status: /** @type {'failed'} */ ('failed'),
            };
        }
        return {
            diagnostics: [inspectionDiagnostic('path-removal-blocked', error instanceof Error ? error.message : String(error))],
            status: /** @type {'blocked'} */ ('blocked'),
        };
    }
};

/**
 * 在 transaction caller 选定的时机执行 ownership plan。只返回 manifest 需要的 ownership
 * 与用户可见结果, 不暴露预检时的低层操作数据。
 */
/** @param {object} plan */
export const applyPathOwnershipPlan = async plan => {
    const operation = ownershipPlans.get(plan);
    if (operation === undefined) {
        throw new InstallationInvariantError('Invalid Installation ownership plan.');
    }
    let stillCurrent;
    try {
        stillCurrent = await operation.revalidate();
    } catch (error) {
        return {
            diagnostics: [inspectionDiagnostic('path-observation-failed', error instanceof Error ? error.message : String(error))],
            effect: 'none',
            pathOwnership: [...operation.failurePathOwnership],
            stage: 'path-revalidation',
            status: /** @type {'failed'} */ ('failed'),
        };
    }
    if (!stillCurrent) {
        return {
            diagnostics: [inspectionDiagnostic('path-state-changed', 'PATH or profile state changed after planning.')],
            status: /** @type {'blocked'} */ ('blocked'),
        };
    }
    if (operation.apply) {
        try {
            await operation.apply();
        } catch (error) {
            const effect = error instanceof Error && 'effect' in error && ['none', 'changed'].includes(String(error.effect))
                ? error.effect
                : 'unknown';
            return {
                diagnostics: [inspectionDiagnostic('path-write-failed', error instanceof Error ? error.message : String(error))],
                effect,
                pathOwnership: effect === 'changed'
                    ? [...operation.pathOwnership]
                    : effect === 'none' ? [...operation.failurePathOwnership] : [],
                stage: 'path-write',
                status: /** @type {'failed'} */ ('failed'),
            };
        }
    }
    /** @type {{code: string, message: string, severity: 'warning'}[]} */
    const diagnostics = [];
    let notice = operation.notice;
    if (operation.notify !== null) {
        try {
            if (typeof operation.notify !== 'function' || await operation.notify() !== true) {
                throw new Error('Windows environment refresh was not acknowledged.');
            }
            if (notice !== null) {
                notice = `${notice} Requested Windows environment refresh; the current shell still uses its previous environment.`;
            }
        } catch {
            diagnostics.push({
                code: 'windows-environment-refresh-failed',
                message: 'The persistent PATH was updated, but Windows environment refresh failed. Sign out and sign in again, or refresh the current shell environment manually.',
                severity: 'warning',
            });
        }
    }
    return {
        changed: operation.apply !== null,
        diagnostics,
        notice,
        pathOwnership: [...operation.pathOwnership],
        status: /** @type {'succeeded'} */ ('succeeded'),
    };
};
