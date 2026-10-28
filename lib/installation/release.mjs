import {assertExactKeys, assertString} from '../common/canonical-contract.mjs';
import {createScopedFilesystem} from '../common/filesystem.mjs';
import {loadInstallationPayload} from './installation-payload.mjs';
import {parseArwVersion, parsePackageIdentity} from '../arw-common/product-identity.mjs';

/** @typedef {{tag: string}} ReleaseEvidence */
/** @typedef {{code: string, message: string, severity: 'error'}} SourceDiagnostic */
/** @typedef {{arwVersion: string, diagnostics: [], sourceDirectory: string, status: 'succeeded'} | {diagnostics: SourceDiagnostic[], status: 'blocked'} | {diagnostics: SourceDiagnostic[], stage: string, status: 'failed'}} ReleaseSourceResult */

class ReleaseBlockedError extends Error {}

/** @param {string} code @param {string} message @returns {SourceDiagnostic} */
const diagnostic = (code, message) => ({code, message, severity: 'error'});

/** @param {string} code @param {string} message */
const blocked = (code, message) => ({
    diagnostics: [diagnostic(code, message)],
    status: /** @type {'blocked'} */ ('blocked'),
});

/** @param {string} stage @param {unknown} error */
const failed = (stage, error) => ({
    diagnostics: [diagnostic(
        'release-source-observation-failed',
        error instanceof Error ? error.message : String(error),
    )],
    stage,
    status: /** @type {'failed'} */ ('failed'),
});

/** @param {readonly {code?: string, message: string}[]} diagnostics */
const sourceDiagnostics = diagnostics => diagnostics.map(entry => diagnostic(
    entry.code ?? 'release-source-invalid',
    entry.message,
));

/**
 * 验证正式 Release caller 提供的封闭 evidence shape.
 * 只接受 stable tag, 且不执行 filesystem observation.
 * @param {unknown} evidence
 * @returns {asserts evidence is ReleaseEvidence}
 */
export function validateReleaseEvidence(evidence) {
    assertExactKeys(evidence, ['tag'], 'Release evidence');
    assertString(evidence.tag, 'Release tag');
    let tag;
    try {
        tag = parseArwVersion(evidence.tag);
    } catch {
        throw new Error('Release tag must be stable MAJOR.MINOR.PATCH.');
    }
    if (tag.prerelease !== null) throw new Error('Release tag must be stable MAJOR.MINOR.PATCH.');
}

/** @param {{createFilesystem: typeof createScopedFilesystem, loadInstallationPayload: typeof loadInstallationPayload}} dependencies @returns {(input: {evidence: unknown, platform: string, sourceDirectory: string}) => Promise<ReleaseSourceResult>} */
const loadReleaseWith = ({createFilesystem, loadInstallationPayload: loadPayload}) => async ({evidence, platform, sourceDirectory}) => {
    try {
        validateReleaseEvidence(evidence);
    } catch (error) {
        return blocked('release-evidence-invalid', error instanceof Error ? error.message : String(error));
    }

    const payload = await loadPayload({platform, sourceDirectory});
    if (payload.status !== 'succeeded') {
        return payload.status === 'failed'
            ? {
                diagnostics: sourceDiagnostics(payload.diagnostics),
                stage: 'stage' in payload ? payload.stage : 'installation-payload',
                status: /** @type {'failed'} */ ('failed'),
            }
            : {
                diagnostics: sourceDiagnostics(payload.diagnostics),
                status: /** @type {'blocked'} */ ('blocked'),
            };
    }
    let packageBytes;
    try {
        const openedSource = await createFilesystem({root: sourceDirectory});
        if (openedSource.status === 'blocked') {
            throw new ReleaseBlockedError('Release source package.json is not an allowed regular file.');
        }
        if (openedSource.status === 'failed') {
            throw new Error(openedSource.diagnostics.map(entry => entry.message).join(' '));
        }
        const packageObservation = await openedSource.scopedFilesystem.inspect({path: 'package.json'});
        if (packageObservation.status === 'blocked') {
            throw new ReleaseBlockedError('Release source package.json is not an allowed regular file.');
        }
        if (packageObservation.status === 'failed') {
            throw new Error(packageObservation.diagnostics.map(entry => entry.message).join(' '));
        }
        if (packageObservation.entry.kind === 'missing') {
            throw new Error('ENOENT: Release source package.json does not exist.');
        }
        if (packageObservation.entry.kind !== 'file') {
            throw new ReleaseBlockedError('Release source package.json is not an allowed regular file.');
        }
        const packageRead = await openedSource.scopedFilesystem.read({path: 'package.json'});
        if (packageRead.status === 'blocked') {
            throw new ReleaseBlockedError('Release source package.json is not an allowed regular file.');
        }
        if (packageRead.status === 'failed') {
            throw new Error(packageRead.diagnostics.map(entry => entry.message).join(' '));
        }
        packageBytes = packageRead.bytes;
    } catch (error) {
        if (error instanceof ReleaseBlockedError) return blocked('release-checkout-mismatch', error.message);
        return failed('package-read', error);
    }
    let packageIdentity;
    try {
        packageIdentity = parsePackageIdentity(packageBytes, 'package.json');
    } catch (error) {
        return blocked('release-identity-invalid', error instanceof Error ? error.message : String(error));
    }
    if (evidence.tag !== packageIdentity.version) {
        return blocked('release-identity-mismatch', 'Selected Release tag does not match package.json version.');
    }

    return {
        arwVersion: packageIdentity.version,
        diagnostics: [],
        sourceDirectory,
        status: 'succeeded',
    };
};

/**
 * 创建 source loader. 返回的 operation 在产生 result 前验证 payload, package identity 和 tag.
 * @param {unknown} dependencies
 */
export const createReleaseLoader = dependencies => {
    return loadReleaseWith(/** @type {{createFilesystem: typeof createScopedFilesystem, loadInstallationPayload: typeof loadInstallationPayload}} */ (dependencies));
};

/**
 * 加载并验证正式 versioned Release source.
 */
export const loadRelease = createReleaseLoader({
    createFilesystem: createScopedFilesystem,
    loadInstallationPayload,
});
