import {isJsonObject, parseJsonText} from '../common/json.mjs';

export const CLI_NAME = 'arw';
export const PRODUCT_NAME = 'agent-repository-workflow';
export const INSTALLATION_DIRECTORY_NAME = '.agent-repository-workflow';

const ARW_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(pre))?$/;

/**
 * 解析 ARW stable 或固定 `-pre` version, 供 package, Installation manifest 和版本排序共用.
 * @param {unknown} value
 * @returns {{core: readonly bigint[], prerelease: 'pre' | null, value: string}}
 */
export const parseArwVersion = value => {
    if (typeof value !== 'string') {
        throw new Error('ARW version must be stable MAJOR.MINOR.PATCH or fixed -pre.');
    }
    const match = ARW_VERSION_PATTERN.exec(value);
    if (match === null) {
        throw new Error('ARW version must be stable MAJOR.MINOR.PATCH or fixed -pre.');
    }
    const prerelease = match[4] === 'pre' ? 'pre' : null;
    return Object.freeze({
        core: Object.freeze(match.slice(1, 4).map(part => BigInt(part))),
        prerelease,
        value,
    });
};

/**
 * 解析 package bytes 并验证 ARW 产品名称和规范稳定版本.
 * @param {Uint8Array} bytes
 * @param {string} [source]
 * @returns {{name: typeof PRODUCT_NAME, version: string}}
 */
export const parsePackageIdentity = (bytes, source = 'package.json') => {
    let parsed;
    try {
        parsed = parseJsonText(Buffer.from(bytes));
    } catch {
        throw new Error(`${source} is not valid UTF-8.`);
    }
    if (parsed.status !== 'succeeded') {
        if (parsed.diagnostics.some(diagnostic => diagnostic.code === 'json-invalid-utf8')) {
            throw new Error(`${source} is not valid UTF-8.`);
        }
        throw new Error(`${source} is not valid JSON.`);
    }
    const {value} = parsed;

    if (!isJsonObject(value)) {
        throw new Error(`${source} must contain a JSON object.`);
    }
    if (value.name !== PRODUCT_NAME) {
        throw new Error(`${source} name must be ${PRODUCT_NAME}.`);
    }
    let version;
    try {
        version = parseArwVersion(value.version);
    } catch {
        throw new Error(`${source} version must be stable MAJOR.MINOR.PATCH.`);
    }
    if (version.prerelease !== null) {
        throw new Error(`${source} version must be stable MAJOR.MINOR.PATCH.`);
    }

    return Object.freeze({name: value.name, version: version.value});
};
