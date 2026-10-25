import {fileURLToPath} from 'node:url';

import {createScopedFilesystem} from '../common/filesystem.mjs';
import {checkShape, parseJson} from '../common/json.mjs';

const RELEASE_VALIDATION_REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** @typedef {{repositories: {sourceCheckout: {url: string}}}} ReleaseValidationConfiguration */

/** @param {unknown} value @returns {value is string} */
const validHttpsUrl = value => {
    if (typeof value !== 'string' || !URL.canParse(value)) return false;
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
        && parsed.username.length === 0
        && parsed.password.length === 0
        && parsed.hostname.length > 0
        && parsed.pathname.endsWith('.git')
        && parsed.search === ''
        && parsed.hash === '';
};

/** 验证根 release-validation.json: 只有规范 HTTPS 远端 `repositories.sourceCheckout.url`. */
/** @param {unknown} value */
export const validateReleaseValidationConfiguration = value => {
    const problem = checkShape(value, {repositories: {sourceCheckout: {url: validHttpsUrl}}}, 'release-validation.json');
    if (problem !== null) {
        return {diagnostics: [{code: 'release-validation-config-invalid', message: problem}], status: /** @type {const} */ ('blocked')};
    }
    return {
        diagnostics: [],
        status: /** @type {const} */ ('succeeded'),
        value: /** @type {ReleaseValidationConfiguration} */ (value),
    };
};

/** 从指定 Repository 根目录读取并验证 tracked release-validation.json. */
export const loadReleaseValidationConfiguration = async ({
    repositoryRoot = RELEASE_VALIDATION_REPOSITORY_ROOT,
} = {}) => {
    const scoped = await createScopedFilesystem({root: repositoryRoot});
    if (scoped.status !== 'succeeded') return scoped;
    const parsed = await parseJson({filesystem: scoped.scopedFilesystem, path: 'release-validation.json'});
    if (parsed.status !== 'succeeded') return parsed;
    if (!('value' in parsed)) throw new Error('Succeeded JSON parsing did not return a value.');
    return validateReleaseValidationConfiguration(parsed.value);
};
