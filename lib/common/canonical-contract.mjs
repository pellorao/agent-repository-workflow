import {resolve, sep} from 'node:path';

import {joinRelativePath, resolveRelativePathWithinScope} from './filesystem.mjs';
import {serializeJson} from './json.mjs';

const REPOSITORY_PATH_SCOPE = resolve(process.cwd(), '.arw-canonical-repository-path-scope');

/** @param {unknown} value @returns {unknown} */
const canonicalize = value => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
            .map(([key, entry]) => [key, canonicalize(entry)]));
    }
    return value;
};

/**
 * 将 JSON-compatible value 转换为 key-sorted, 2-space indentation 且带 final newline 的 canonical JSON bytes.
 * Array order 由调用方 contract 负责, 本函数只规范化 object keys 与 serialization form.
 * @param {unknown} value
 */
export const serializeCanonicalJson = value => {
    const serialized = serializeJson(canonicalize(value), {sortKeys: true});
    if (serialized.status !== 'succeeded') throw new TypeError('Canonical JSON value is not serializable.');
    return serialized.bytes.toString('utf8');
};

/** @param {unknown} value @param {readonly string[]} expected @param {string} label @returns {asserts value is Record<string, unknown>} */
export function assertExactKeys(value, expected, label) {
    if (value === null || Array.isArray(value) || typeof value !== 'object') {
        throw new Error(`${label} must be an object.`);
    }
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
        throw new Error(`${label} must contain exactly: ${wanted.join(', ')}.`);
    }
}

/** @param {unknown} value @param {string} label @returns {asserts value is string} */
export function assertString(value, label) {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string.`);
}

/** @param {unknown} value @param {string} label @returns {asserts value is number} */
export function assertVersion(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${label} must be a positive integer.`);
    }
}

/**
 * 把允许可选 `./` 前缀或结尾 slash 的 Repository-relative path 转换为规范形式.
 * @param {string} value
 * @returns {string | null}
 */
export const canonicalRepositoryRelativePath = value => {
    if (value === '.' || value === './') return '.';
    if (value.length === 0
        || value.includes('\\')
        || value.includes('\0')
        || value.startsWith('/')
        || /^[A-Za-z]:/u.test(value)) return null;
    let canonical = value.startsWith('./') ? value.slice(2) : value;
    if (canonical.endsWith('/')) canonical = canonical.slice(0, -1);
    const components = canonical.split('/');
    return components.length > 0
        && components.every(component => component.length > 0 && component !== '.' && component !== '..')
        ? canonical
        : null;
};

/**
 * 验证 slash-form Repository-relative path, 并拒绝 absolute path, traversal 与 non-normalized form.
 * @param {unknown} value
 * @param {string} label
 * @returns {asserts value is string}
 */
export function assertSafePath(value, label) {
    assertString(value, label);
    let logicalPath;
    let resolved;
    try {
        logicalPath = joinRelativePath(value);
        resolved = resolveRelativePathWithinScope({path: logicalPath, scope: REPOSITORY_PATH_SCOPE});
    } catch {
        throw new Error(`${label} must be a normalized Repository-relative path.`);
    }
    const normalized = resolved.status === 'succeeded'
        ? resolved.relativePath.split(sep).join('/')
        : '';
    if (logicalPath !== value || normalized.length === 0 || normalized !== value) {
        throw new Error(`${label} must be a normalized Repository-relative path.`);
    }
}
