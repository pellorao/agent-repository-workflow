import {dirname, isAbsolute, join, resolve, sep} from 'node:path';

import {parseArwVersion, PRODUCT_NAME} from './product-identity.mjs';
import {joinRelativePath, resolveRelativePathWithinScope} from '../common/filesystem.mjs';
import {parseJsonText} from '../common/json.mjs';

export const INSTALLATION_MANIFEST_FILE = 'manifest.json';
export const INSTALLATION_MANIFEST_VERSION = 2;
/** @param {string} left @param {string} right */
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const MANAGED_PATH_SCOPE = resolve(process.cwd(), '.arw-installation-managed-path-scope');

/** @typedef {'windows-user-path' | 'linux-profile' | 'macos-experimental'} InstallationPathKind */
/** @typedef {{createdValue: boolean, entry: string, kind: 'windows-user-path', valueKind: 'String' | 'ExpandString'} | {kind: 'linux-profile', profile: string}} PathOwnership */
/** @typedef {{arwVersion: string, managedFiles: readonly string[], manifestVersion: 2, pathOwnership: readonly PathOwnership[], product: string}} InstallationManifest */

/**
 * 为 Windows PATH ownership 判等生成 canonical entry.
 * 只移除成对外围双引号和末尾路径分隔符并折叠大小写, 不修剪空白或展开环境变量.
 */
/** @param {string} value */
export const normalizeWindowsPathEntry = value => {
    const unquoted = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
    return unquoted.replace(/[\\/]+$/g, '').toLowerCase();
};

/**
 * 为一个已经验证的 PATH ownership record 生成 operation-local 去重 key.
 * Windows entry 使用平台判等规则, profile ownership 保留其精确 absolute profile path.
 */
/** @param {PathOwnership} ownership */
export const installationOwnershipKey = ownership => ownership.kind === 'windows-user-path'
    ? `${ownership.kind}:${normalizeWindowsPathEntry(ownership.entry)}`
    : `${ownership.kind}:${ownership.profile}`;

/** @template {string} T @param {unknown} value @param {readonly T[]} keys @returns {value is Record<T, unknown>} */
const hasExactKeys = (value, keys) => value !== null
    && !Array.isArray(value)
    && typeof value === 'object'
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** @param {unknown} value @param {string} installationDirectory @param {InstallationPathKind | undefined} expectedKind @returns {value is PathOwnership} */
const isPathOwnership = (value, installationDirectory, expectedKind) => {
    if (!isRecord(value) || typeof value.kind !== 'string') return false;
    if (expectedKind !== undefined && value.kind !== expectedKind) return false;
    if (value.kind === 'windows-user-path') {
        return hasExactKeys(value, ['createdValue', 'entry', 'kind', 'valueKind'])
            && typeof value.entry === 'string'
            && isAbsolute(value.entry)
            && normalizeWindowsPathEntry(value.entry) === normalizeWindowsPathEntry(installationDirectory)
            && typeof value.createdValue === 'boolean'
            && typeof value.valueKind === 'string'
            && ['String', 'ExpandString'].includes(value.valueKind);
    }
    if (value.kind === 'linux-profile') {
        return hasExactKeys(value, ['kind', 'profile'])
            && typeof value.profile === 'string'
            && isAbsolute(value.profile)
            && value.profile === join(dirname(installationDirectory), '.profile');
    }
    return false;
};

/** @param {unknown} value @param {string} installationDirectory @param {InstallationPathKind | undefined} expectedPathKind @returns {value is InstallationManifest} */
const isInstallationManifest = (value, installationDirectory, expectedPathKind) => hasExactKeys(
    value,
    ['arwVersion', 'managedFiles', 'manifestVersion', 'pathOwnership', 'product'],
)
    && value.manifestVersion === INSTALLATION_MANIFEST_VERSION
    && supportedArwVersion(value.arwVersion)
    && value.product === PRODUCT_NAME
    && isManagedFileList(value.managedFiles)
    && Array.isArray(value.pathOwnership)
    && value.pathOwnership.length <= 1
    && value.pathOwnership.every(ownership => isPathOwnership(ownership, installationDirectory, expectedPathKind))
    && new Set(value.pathOwnership.map(installationOwnershipKey)).size === value.pathOwnership.length;

/** @param {unknown} value */
const isManagedFilePath = value => {
    if (typeof value !== 'string' || value.length === 0) return false;
    try {
        const logicalPath = joinRelativePath(value);
        const resolved = resolveRelativePathWithinScope({path: logicalPath, scope: MANAGED_PATH_SCOPE});
        return resolved.status === 'succeeded'
            && resolved.relativePath.length > 0
            && logicalPath === value
            && resolved.relativePath.split(sep).join('/') === value;
    } catch {
        return false;
    }
};

/**
 * 判断值是否是 closed Installation manifest 接受的 managed file list.
 * 路径必须是安全 slash-form relative paths, 不得拥有 config 或 manifest, 并按 case-insensitive target identity 保持唯一.
 */
/** @param {unknown} value @returns {value is string[]} */
export const isManagedFileList = value => Array.isArray(value)
    && value.every(isManagedFilePath)
    && !value.some(file => ['config.json', INSTALLATION_MANIFEST_FILE].includes(file.toLowerCase()))
    && value.every((file, index) => index === 0 || compareText(value[index - 1], file) < 0)
    && new Set(value.map(file => file.toLowerCase())).size === value.length;

/** @param {unknown} value */
const supportedArwVersion = value => {
    try {
        parseArwVersion(value);
        return true;
    } catch {
        return false;
    }
};

export class InstallationManifestValidationError extends Error {
    /** @param {'damaged' | 'unsupported'} kind @param {string} message */
    constructor(kind, message) {
        super(message);
        this.name = 'InstallationManifestValidationError';
        this.kind = kind;
    }
}

/**
 * 验证已经解析的 schema version 2 Installation manifest record.
 * 校验 exact fields, product, ARW version, managed paths, ownership shape 和可选平台 kind, 失败时抛出 stable unsupported classification.
 * 成功时返回冻结 record, 并复制和冻结 nested managed files 与 ownership records, 使 caller 不能改变已验证事实.
 */
/** @param {{expectedPathKind: InstallationPathKind | undefined, installationDirectory: string, value: unknown}} input */
export const validateInstallationManifestRecord = ({expectedPathKind, installationDirectory, value}) => {
    if (!isInstallationManifest(value, installationDirectory, expectedPathKind)) {
        throw new InstallationManifestValidationError(
            'unsupported',
            'Installation manifest has an unsupported product, version, or ownership record.',
        );
    }
    return Object.freeze({
        ...value,
        managedFiles: Object.freeze([...value.managedFiles]),
        pathOwnership: Object.freeze(value.pathOwnership.map(ownership => Object.freeze({...ownership}))),
    });
};

/**
 * 从完整 bytes 验证 closed Installation manifest, 不读取 filesystem 或其他 identity authority.
 * Fatal UTF-8 decode 或 JSON parse failure 使用 stable damaged classification, schema 或 ownership failure 保留 unsupported classification.
 */
/** @param {{bytes: Buffer, expectedPathKind: InstallationPathKind | undefined, installationDirectory: string}} input */
export const parseInstallationManifest = ({bytes, expectedPathKind, installationDirectory}) => {
    const parsed = parseJsonText(bytes);
    if (parsed.status !== 'succeeded') {
        const invalidUtf8 = parsed.diagnostics.some(diagnostic => diagnostic.code === 'json-invalid-utf8');
        throw new InstallationManifestValidationError(
            'damaged',
            invalidUtf8
                ? 'Installation manifest is not valid UTF-8.'
                : 'Installation manifest is not valid JSON.',
        );
    }
    return validateInstallationManifestRecord({expectedPathKind, installationDirectory, value: parsed.value});
};
