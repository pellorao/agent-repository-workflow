import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';

import {assertExactKeys, assertString} from '../common/canonical-contract.mjs';
import {createScopedFilesystem} from '../common/filesystem.mjs';
import {loadInstallationPayload} from './installation-payload.mjs';
import {parseArwVersion, parsePackageIdentity} from '../arw-common/product-identity.mjs';

const execFile = promisify(execFileCallback);
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** @typedef {{commit: string, explicitVersion: boolean, tag: string}} ReleaseEvidence */
/** @typedef {{status: 'succeeded', commit: string} | {status: 'failed', message: string}} ReleaseGitCommitResult */
/** @typedef {{status: 'succeeded'} | {status: 'blocked' | 'failed', message: string}} ReleaseGitMatchResult */
/** @typedef {{assertFilesMatch: (directory: string, commit: string, paths: string[]) => Promise<ReleaseGitMatchResult>, readHead: (directory: string) => Promise<ReleaseGitCommitResult>, resolveTagCommit: (directory: string, tag: string) => Promise<ReleaseGitCommitResult>}} ReleaseGit */
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

/** @param {string} left @param {string} right */
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
/** @returns {value is Record<string, unknown>} */
const isRecord = (/** @type {unknown} */ value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (/** @type {unknown} */ value, /** @type {string[]} */ keys) => isRecord(value)
    && Object.keys(value).sort(compareText).join('\0') === [...keys].sort(compareText).join('\0');

/** @param {string} directory @param {string[]} args @param {{encoding?: BufferEncoding | 'buffer'}} [options] */
const runGit = async (directory, args, options = {}) => execFile('git', ['-C', directory, ...args], {
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
});

/** @type {ReleaseGit} */
const defaultGit = {
    /** @param {string} directory @param {string} commit @param {string[]} paths */
    assertFilesMatch: async (directory, commit, paths) => {
        try {
            const pathArguments = ['--', ...paths];
            const {stdout} = await runGit(directory, ['ls-tree', '-rz', '--full-tree', commit, ...pathArguments], {encoding: 'buffer'});
            const entries = stdout.toString('utf8').split('\0').filter(Boolean).map(entry => {
                const match = /^(100644|100755) blob [0-9a-f]+\t(.+)$/.exec(entry);
                if (match === null) throw new ReleaseBlockedError('Release inventory contains an unsupported Git tree entry.');
                return match[2];
            }).sort(compareText);
            if (entries.length !== paths.length || entries.some((path, index) => path !== paths[index])) {
                throw new ReleaseBlockedError('Release inventory does not match the selected commit.');
            }
            try {
                await runGit(directory, ['diff', '--quiet', '--no-ext-diff', commit, ...pathArguments]);
            } catch (error) {
                if (error instanceof Error && 'code' in error && error.code === 1) {
                    throw new ReleaseBlockedError('Release checkout bytes do not match the selected Git tree.');
                }
                throw error;
            }
            return {status: 'succeeded'};
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return error instanceof ReleaseBlockedError
                ? {message, status: 'blocked'}
                : {message, status: 'failed'};
        }
    },
    /** @param {string} directory */
    readHead: async directory => {
        try {
            const commit = (await runGit(directory, ['rev-parse', '--verify', 'HEAD'])).stdout.toString().trim();
            return COMMIT_PATTERN.test(commit)
                ? {commit, status: 'succeeded'}
                : {message: 'Release HEAD is not a full commit ID.', status: 'failed'};
        } catch (error) {
            return {message: error instanceof Error ? error.message : String(error), status: 'failed'};
        }
    },
    /** @param {string} directory @param {string} tag */
    resolveTagCommit: async (directory, tag) => {
        try {
            const commit = (await runGit(directory, ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`])).stdout.toString().trim();
            return COMMIT_PATTERN.test(commit)
                ? {commit, status: 'succeeded'}
                : {message: 'Release tag does not resolve to a full commit ID.', status: 'failed'};
        } catch (error) {
            return {message: error instanceof Error ? error.message : String(error), status: 'failed'};
        }
    },
};

/**
 * 验证正式 Release caller 提供的封闭 evidence shape.
 * 只接受 stable tag, 完整 40 或 64 位 hexadecimal commit ID 和 boolean selection fact, 且不执行 filesystem 或 Git observation.
 * @param {unknown} evidence
 * @returns {asserts evidence is ReleaseEvidence}
 */
export function validateReleaseEvidence(evidence) {
    assertExactKeys(evidence, ['commit', 'explicitVersion', 'tag'], 'Release evidence');
    assertString(evidence.tag, 'Release tag');
    assertString(evidence.commit, 'Release commit');
    let tag;
    try {
        tag = parseArwVersion(evidence.tag);
    } catch {
        throw new Error('Release tag must be stable MAJOR.MINOR.PATCH.');
    }
    if (tag.prerelease !== null) throw new Error('Release tag must be stable MAJOR.MINOR.PATCH.');
    if (!COMMIT_PATTERN.test(evidence.commit)) throw new Error('Release commit must be a full hexadecimal object ID.');
    if (typeof evidence.explicitVersion !== 'boolean') throw new Error('Release explicitVersion must be boolean.');
}

/** @param {{createFilesystem: typeof createScopedFilesystem, git: ReleaseGit, loadInstallationPayload: typeof loadInstallationPayload}} dependencies @returns {(input: unknown) => Promise<ReleaseSourceResult>} */
const loadReleaseWith = ({createFilesystem, git, loadInstallationPayload: loadPayload}) => async (/** @type {unknown} */ input) => {
    try {
        assertExactKeys(input, ['evidence', 'platform', 'sourceDirectory'], 'Release input');
    } catch (error) {
        throw new TypeError(error instanceof Error ? error.message : String(error));
    }
    const {evidence, platform, sourceDirectory} = input;
    if (typeof platform !== 'string' || typeof sourceDirectory !== 'string') {
        throw new TypeError('Release platform and sourceDirectory must be strings.');
    }
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

    let headResult;
    let tagResult;
    try {
        [headResult, tagResult] = await Promise.all([
            git.readHead(sourceDirectory),
            git.resolveTagCommit(sourceDirectory, evidence.tag),
        ]);
    } catch (error) {
        return failed('git-observation', error);
    }
    for (const result of [headResult, tagResult]) {
        if (!exactKeys(result, result?.status === 'succeeded' ? ['commit', 'status'] : ['message', 'status'])
            || result.status === 'succeeded' && (typeof result.commit !== 'string' || !COMMIT_PATTERN.test(result.commit))
            || result.status === 'failed' && (typeof result.message !== 'string' || result.message.length === 0)
            || !['succeeded', 'failed'].includes(/** @type {string} */ (result.status))) {
            return failed('git-observation', new Error('Release Git Adapter returned an invalid result.'));
        }
        if (result.status === 'failed') return failed('git-observation', new Error(result.message));
    }
    if (headResult.status !== 'succeeded' || tagResult.status !== 'succeeded') {
        return failed('git-observation', new Error('Release Git Adapter returned an invalid result.'));
    }
    if (headResult.commit !== evidence.commit || tagResult.commit !== evidence.commit) {
        return blocked('release-git-identity-mismatch', 'Selected tag, resolved commit, and checkout HEAD are inconsistent.');
    }

    const verifiedPaths = [...new Set([
        'package.json',
        ...payload.verificationPaths,
    ])].sort(compareText);
    let matchResult;
    try {
        matchResult = await git.assertFilesMatch(sourceDirectory, evidence.commit, verifiedPaths);
    } catch (error) {
        return failed('git-observation', error);
    }
    if (!exactKeys(matchResult, matchResult?.status === 'succeeded' ? ['status'] : ['message', 'status'])
        || !['succeeded', 'blocked', 'failed'].includes(/** @type {string} */ (matchResult.status))
        || matchResult.status !== 'succeeded' && (typeof matchResult.message !== 'string' || matchResult.message.length === 0)) {
        return failed('git-observation', new Error('Release Git Adapter returned an invalid result.'));
    }
    if (matchResult.status === 'blocked') return blocked('release-checkout-mismatch', matchResult.message);
    if (matchResult.status === 'failed') return failed('git-observation', new Error(matchResult.message));

    return {
        arwVersion: packageIdentity.version,
        diagnostics: [],
        sourceDirectory,
        status: 'succeeded',
    };
};

/**
 * 使用完整 3-operation Release Git Adapter 创建 source loader.
 * 返回的 operation 在产生 result 前验证 payload, package identity, tag, checkout HEAD 和所选 commit tree bytes.
 * @param {unknown} dependencies
 */
export const createReleaseLoader = dependencies => {
    if (!isRecord(dependencies)
        || !exactKeys(dependencies, ['createFilesystem', 'git', 'loadInstallationPayload'])
        || typeof dependencies.createFilesystem !== 'function'
        || typeof dependencies.loadInstallationPayload !== 'function'
        || !isRecord(dependencies.git)
        || !exactKeys(dependencies.git, ['assertFilesMatch', 'readHead', 'resolveTagCommit'])
        || Object.values(dependencies.git).some(operation => typeof operation !== 'function')) {
        throw new TypeError('Release loader dependencies are invalid.');
    }
    return loadReleaseWith(/** @type {{createFilesystem: typeof createScopedFilesystem, git: ReleaseGit, loadInstallationPayload: typeof loadInstallationPayload}} */ (dependencies));
};

/**
 * 使用 production Git process Adapter 加载并验证正式 versioned Release source.
 */
export const loadRelease = createReleaseLoader({
    createFilesystem: createScopedFilesystem,
    git: defaultGit,
    loadInstallationPayload,
});
