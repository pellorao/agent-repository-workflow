import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

import {createScopedFilesystem} from '../common/filesystem.mjs';
import {parseInstallationManifest} from './installation-manifest.mjs';
import {
    CLI_NAME,
    compareStableArwVersions,
    INSTALLATION_DIRECTORY_NAME,
    parseArwVersion,
    parsePackageIdentity,
    PRODUCT_NAME,
} from './product-identity.mjs';

export {
    CLI_NAME,
    compareStableArwVersions,
    INSTALLATION_DIRECTORY_NAME,
    parseArwVersion,
    parsePackageIdentity,
    PRODUCT_NAME,
} from './product-identity.mjs';

const PACKAGE_PATH = 'package.json';
const MANIFEST_PATH = 'manifest.json';

/** @param {string} code @param {string} message */
const blocked = (code, message) => ({diagnostics: [{code, message}], status: /** @type {'blocked'} */ ('blocked')});

/** @param {string} stage @param {{diagnostics: Array<{code: string, message: string}>}} result */
const failed = (stage, result) => ({diagnostics: result.diagnostics, stage, status: /** @type {'failed'} */ ('failed')});

/**
 * 从一个明确的 Source Checkout 或 Installation root 解析唯一产品身份.
 * @param {{directory: string}} input
 */
export const loadIdentity = async input => {
    if (input === null
        || typeof input !== 'object'
        || Array.isArray(input)
        || Object.keys(input).join(',') !== 'directory'
        || !('directory' in input)
        || typeof input.directory !== 'string'
        || !isAbsolute(input.directory)) {
        throw new TypeError('Identity requires one absolute directory.');
    }
    const opened = await createScopedFilesystem({root: input.directory});
    if (opened.status === 'failed') return failed('identity-root-observation', opened);
    if (opened.status === 'blocked') {
        return blocked('identity-root-invalid', opened.diagnostics.map(entry => entry.message).join(' '));
    }
    const filesystem = opened.scopedFilesystem;
    const [packageEntry, manifestEntry] = await Promise.all([
        filesystem.inspect({path: PACKAGE_PATH, rejectHardLinks: true}),
        filesystem.inspect({path: MANIFEST_PATH, rejectHardLinks: true}),
    ]);
    for (const {path, result} of [
        {path: PACKAGE_PATH, result: packageEntry},
        {path: MANIFEST_PATH, result: manifestEntry},
    ]) {
        if (result.status === 'failed') return failed('identity-authority-observation', result);
        if (result.status === 'blocked') {
            return blocked('identity-authority-invalid', `Runtime identity authority is unsafe: ${path}.`);
        }
        if (result.entry.kind !== 'missing' && result.entry.kind !== 'file') {
            return blocked('identity-authority-invalid', `Runtime identity authority must be a real regular file: ${path}.`);
        }
    }
    if (packageEntry.status !== 'succeeded' || manifestEntry.status !== 'succeeded') {
        throw new Error('Identity observation did not retain successful results.');
    }
    const packageExists = packageEntry.entry.kind === 'file';
    const manifestExists = manifestEntry.entry.kind === 'file';
    if (packageExists === manifestExists) {
        return blocked(
            packageExists ? 'identity-layout-inconsistent' : 'identity-authority-missing',
            packageExists
                ? 'Runtime identity layout is inconsistent: package.json and manifest.json both exist.'
                : 'Runtime identity authority is missing: package.json and manifest.json are both absent.',
        );
    }
    const authorityPath = packageExists ? PACKAGE_PATH : MANIFEST_PATH;
    const read = await filesystem.read({path: authorityPath, rejectHardLinks: true});
    if (read.status === 'failed') return failed('identity-authority-read', read);
    if (read.status === 'blocked') {
        return blocked('identity-authority-invalid', read.diagnostics.map(entry => entry.message).join(' '));
    }
    try {
        const identity = packageExists
            ? parsePackageIdentity(read.bytes, PACKAGE_PATH)
            : parseInstallationManifest({
                bytes: read.bytes,
                expectedPathKind: undefined,
                installationDirectory: input.directory,
            });
        return {
            arwVersion: 'arwVersion' in identity ? identity.arwVersion : identity.version,
            diagnostics: [],
            product: PRODUCT_NAME,
            status: /** @type {'succeeded'} */ ('succeeded'),
        };
    } catch (error) {
        return blocked('identity-invalid', error instanceof Error ? error.message : String(error));
    }
};

const currentIdentity = await loadIdentity({directory: fileURLToPath(new URL('../../', import.meta.url))});
if (currentIdentity.status !== 'succeeded') {
    throw new Error(currentIdentity.diagnostics.map(entry => entry.message).join(' '));
}

export const ARW_VERSION = currentIdentity.arwVersion;
