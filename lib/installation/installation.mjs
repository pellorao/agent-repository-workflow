import {dirname, isAbsolute, join, sep} from 'node:path';

import {convertConfiguration} from '../common/configuration-conversion.mjs';
import {createFileTransaction} from '../common/file-transaction.mjs';
import {
    createScopedFilesystem,
    joinRelativePath,
    resolveAbsolutePathWithinScope,
} from '../common/filesystem.mjs';
import {compareText, exactKeys, isJsonObject, jsonSemanticallyEqual, parseJsonText, sha256} from '../common/json.mjs';
import {BACKGROUND_AGENT_DEFAULTS, completeGlobalConfigurationBytes, GLOBAL_CONFIGURATION_RULES, validateConfig} from '../arw-common/config.mjs';
import {acquireBackgroundAgentMaintenance, backgroundAgentRuntimeDirectory} from '../background-agent/client.mjs';
import {prepareCustomModelCatalog} from '../background-agent/model-catalog.mjs';
import {normalizeWindowsPathEntry} from '../arw-common/installation-manifest.mjs';
import {loadInstallationPayload} from './installation-payload.mjs';
import {parseArwVersion, parsePackageIdentity, PRODUCT_NAME} from '../arw-common/product-identity.mjs';
import {loadRelease, validateReleaseEvidence} from './release.mjs';
import {
    assertSafeManagedPaths,
    applyPathOwnershipPlan,
    inspectInstallation,
    InstallationInvariantError,
    planPathRegistration,
    removeEmptyManagedDirectories,
    resolveInstallation,
    writeInstallationManifest,
} from './installation-contract.mjs';

const BOOLEAN_OPTIONS = ['--reinitialize-config', '--register-path'];
const RELEASE_OPTIONS = ['--release-tag', '--release-commit', '--selection-mode'];

/** @typedef {{commit: string, explicitVersion: boolean, tag: string}} ReleaseEvidence */
/** @typedef {{evidence: ReleaseEvidence, kind: 'release'} | {kind: 'local'}} InstallationSourceRequest */
/** @typedef {{nonInteractive: boolean, registerPath: boolean | undefined, reinitializeConfig: boolean, sourceRequest: InstallationSourceRequest}} InstallDecisions */
/** @typedef {{code: string, message: string, severity: 'error'}} SourceDiagnostic */
/** @typedef {{arwVersion: string, diagnostics: readonly unknown[], sourceDirectory: string, status: 'succeeded'}} ReleaseSource */
/** @typedef {ReleaseSource | {diagnostics: SourceDiagnostic[], status: 'blocked'} | {diagnostics: SourceDiagnostic[], stage: string, status: 'failed'}} SourceResult */
/** @typedef {{evidence: ReleaseEvidence, platform: string, sourceDirectory: string}} ReleaseLoadInput */
/** @typedef {{code: string, message: string, severity: string}} InstallDiagnostic */
/** @typedef {{arwVersion: string, configurationResult: 'initialized' | 'preserved' | 'reinitialized' | null, installationDirectory: string, managedFiles: string[], pathOwnership: unknown[]}} InstallSummary */
/** @typedef {{acquireMaintenance?: typeof acquireBackgroundAgentMaintenance, createFilesystem?: typeof createScopedFilesystem, environment?: NodeJS.ProcessEnv, linuxProfile?: NonNullable<Parameters<typeof planPathRegistration>[0]['linuxProfile']>, loadInstallationPayload?: typeof loadInstallationPayload, loadReleaseSource?: (input: ReleaseLoadInput) => Promise<SourceResult>, platform?: string, prompt?: (decision: 'registerPath') => Promise<boolean>, release?: ReleaseSource, sourceDirectory?: string, stderr?: (message: string) => void, stdout?: (message: string) => void, windowsPath?: NonNullable<Parameters<typeof planPathRegistration>[0]['windowsPath']>, writeManifest?: typeof writeInstallationManifest}} InstallerOptions */
/** @typedef {InstallerOptions & {sourceDirectory: string}} ValidatedInstallerOptions */

export class InstallerUsageError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'InstallerUsageError';
        this.exitCode = 2;
    }
}

/** @param {unknown} decisions @returns {asserts decisions is InstallDecisions} */
function requireInstallDecisions(decisions) {
    if (!isJsonObject(decisions)
        || !exactKeys(decisions, ['nonInteractive', 'registerPath', 'reinitializeConfig', 'sourceRequest'])
        || typeof decisions.nonInteractive !== 'boolean'
        || typeof decisions.reinitializeConfig !== 'boolean'
        || (decisions.registerPath !== undefined && typeof decisions.registerPath !== 'boolean')
        || (decisions.nonInteractive ? typeof decisions.registerPath !== 'boolean' : decisions.registerPath !== undefined)
        || !isJsonObject(decisions.sourceRequest)
        || (decisions.sourceRequest.kind !== 'local' && decisions.sourceRequest.kind !== 'release')) {
        throw new TypeError('Installation decisions must be a complete parsed request.');
    }
    if (decisions.sourceRequest.kind === 'local') {
        if (!exactKeys(decisions.sourceRequest, ['kind'])) {
            throw new TypeError('Local Installation source request must contain only kind.');
        }
        return;
    }
    if (!exactKeys(decisions.sourceRequest, ['evidence', 'kind'])) {
        throw new TypeError('Release Installation source request must contain evidence and kind.');
    }
    try {
        validateReleaseEvidence(decisions.sourceRequest.evidence);
    } catch (error) {
        throw new TypeError(error instanceof Error ? error.message : String(error));
    }
}

const INSTALLER_OPTION_KEYS = [
    'acquireMaintenance',
    'createFilesystem',
    'environment',
    'linuxProfile',
    'loadInstallationPayload',
    'loadReleaseSource',
    'platform',
    'prompt',
    'release',
    'sourceDirectory',
    'stderr',
    'stdout',
    'windowsPath',
    'writeManifest',
];

/** @param {unknown} options @param {InstallDecisions} decisions @returns {asserts options is ValidatedInstallerOptions} */
function requireInstallerOptions(options, decisions) {
    if (!isJsonObject(options) || Object.keys(options).some(key => !INSTALLER_OPTION_KEYS.includes(key))) {
        throw new TypeError('Installation options must be an object with only supported Adapter fields.');
    }
    if (typeof options.sourceDirectory !== 'string'
        || options.sourceDirectory.length === 0
        || !isAbsolute(options.sourceDirectory)) {
        throw new TypeError('Installation requires an absolute Source Checkout directory.');
    }
    if (options.platform !== undefined && (typeof options.platform !== 'string' || options.platform.length === 0)) {
        throw new TypeError('Installation platform must be a non-empty string.');
    }
    if (options.environment !== undefined
        && (!isJsonObject(options.environment)
            || Object.values(options.environment).some(value => value !== undefined && typeof value !== 'string'))) {
        throw new TypeError('Installation environment must contain only string or undefined values.');
    }
    for (const key of ['acquireMaintenance', 'createFilesystem', 'loadInstallationPayload', 'loadReleaseSource', 'stderr', 'stdout', 'writeManifest']) {
        if (options[key] !== undefined && typeof options[key] !== 'function') {
            throw new TypeError(`Installation option ${key} must be a function.`);
        }
    }
    if (options.prompt !== undefined && typeof options.prompt !== 'function') {
        throw new TypeError('Installation prompt must be a function.');
    }
    if (!decisions.nonInteractive && typeof options.prompt !== 'function') {
        throw new TypeError('Interactive Installation requires a prompt function.');
    }
    if (options.release !== undefined) {
        const release = options.release;
        if (!isJsonObject(release)
            || !exactKeys(release, ['arwVersion', 'diagnostics', 'sourceDirectory', 'status'])
            || release.status !== 'succeeded'
            || !Array.isArray(release.diagnostics)
            || typeof release.arwVersion !== 'string'
            || typeof release.sourceDirectory !== 'string'
            || !isAbsolute(release.sourceDirectory)) {
            throw new TypeError('Injected Installation release must be a complete succeeded source result.');
        }
    }
    /** @type {readonly [string, readonly string[], readonly string[]][]} */
    const adapterRequirements = [
        ['linuxProfile', ['read', 'write'], []],
        ['windowsPath', ['notify', 'read', 'write'], ['remove']],
    ];
    for (const [key, required, optional] of adapterRequirements) {
        const adapter = options[key];
        if (adapter === undefined) continue;
        if (!isJsonObject(adapter)
            || Object.keys(adapter).some(name => ![...required, ...optional].includes(name))
            || required.some(name => typeof adapter[name] !== 'function')
            || optional.some(name => adapter[name] !== undefined && typeof adapter[name] !== 'function')) {
            throw new TypeError(`Installation option ${key} must be a complete Adapter.`);
        }
    }
}
/** @param {string} left @param {string} right */
const compareVersions = (left, right) => {
    const leftVersion = parseArwVersion(left);
    const rightVersion = parseArwVersion(right);
    for (let index = 0; index < 3; index += 1) {
        if (leftVersion.core[index] < rightVersion.core[index]) return -1;
        if (leftVersion.core[index] > rightVersion.core[index]) return 1;
    }
    if (leftVersion.prerelease === rightVersion.prerelease) return 0;
    return leftVersion.prerelease === 'pre' ? -1 : 1;
};

/** @param {string} option @param {string | undefined} value */
const parseBoolean = (option, value) => {
    if (value !== 'true' && value !== 'false') {
        throw new InstallerUsageError(`${option} expects true or false.`);
    }

    return value === 'true';
};

/**
 * 解析 Installer 参数并拒绝未知, 重复或不完整的 Release 证据.
 * 交互模式不接受决定选项; non-interactive 模式必须显式选择 PATH 注册, 未指定配置重建时默认 `false`.
 */
/** @param {string[]} args @returns {InstallDecisions} */
export const parseInstallArguments = args => {
    const decisions = new Map();
    const release = new Map();
    let nonInteractive = false;
    /** @type {InstallationSourceRequest} */
    let sourceRequest;

    for (let index = 0; index < args.length; index += 1) {
        const option = args[index];

        if (option === '--non-interactive') {
            if (nonInteractive) {
                throw new InstallerUsageError('--non-interactive must not be repeated.');
            }
            nonInteractive = true;
            continue;
        }

        if (RELEASE_OPTIONS.includes(option)) {
            if (release.has(option) || index + 1 >= args.length) {
                throw new InstallerUsageError(`Missing or repeated value for ${option}.`);
            }
            release.set(option, args[index + 1]);
            index += 1;
            continue;
        }

        if (!BOOLEAN_OPTIONS.includes(option) || decisions.has(option)) {
            throw new InstallerUsageError(`Unknown or repeated option: ${option}.`);
        }

        decisions.set(option, parseBoolean(option, args[index + 1]));
        index += 1;
    }

    if (!nonInteractive && decisions.size > 0) {
        throw new InstallerUsageError('Decision options require --non-interactive.');
    }

    if (nonInteractive && !decisions.has('--register-path')) {
        throw new InstallerUsageError('Non-interactive installation requires --register-path.');
    }
    if (release.size === 0) {
        sourceRequest = {kind: 'local'};
    } else {
        const missingRelease = RELEASE_OPTIONS.filter(option => !release.has(option));
        if (missingRelease.length > 0) {
            throw new InstallerUsageError(`Versioned installation requires ${missingRelease.join(', ')}.`);
        }
        if (!['latest', 'explicit'].includes(release.get('--selection-mode'))) {
            throw new InstallerUsageError('--selection-mode expects latest or explicit.');
        }
        const commit = release.get('--release-commit');
        const tag = release.get('--release-tag');
        const selectionMode = release.get('--selection-mode');
        if (commit === undefined || tag === undefined || selectionMode === undefined) {
            throw new InstallerUsageError('Versioned installation requires complete Release evidence.');
        }
        const evidence = {commit, explicitVersion: selectionMode === 'explicit', tag};
        try {
            validateReleaseEvidence(evidence);
        } catch (error) {
            throw new InstallerUsageError(error instanceof Error ? error.message : String(error));
        }
        sourceRequest = {
            evidence,
            kind: 'release',
        };
    }

    return {
        nonInteractive,
        registerPath: decisions.get('--register-path'),
        reinitializeConfig: decisions.get('--reinitialize-config') ?? false,
        sourceRequest,
    };
};

/** @param {string | Buffer} bytes @param {string} filename */
const parseConfiguration = (bytes, filename) => {
    const parsed = parseJsonText(bytes);
    if (parsed.status !== 'succeeded') {
        throw new Error(`Invalid configuration: ${filename}: ${parsed.diagnostics.map(entry => entry.message).join(' ')}`);
    }
    return validateConfig(parsed.value);
};

/** @param {{sourceDirectory: string}} input @returns {Promise<SourceResult>} */
export const loadLocalSource = async input => {
    if (!exactKeys(input, ['sourceDirectory'])
        || typeof input.sourceDirectory !== 'string'
        || input.sourceDirectory.length === 0
        || !isAbsolute(input.sourceDirectory)) {
        throw new TypeError('Local source input requires one absolute sourceDirectory.');
    }
    const {sourceDirectory} = input;
    let packageBytes;
    try {
        const openedSource = await createScopedFilesystem({root: sourceDirectory});
        if (openedSource.status !== 'succeeded') {
            const message = openedSource.diagnostics.map(entry => entry.message).join(' ');
            if (openedSource.status === 'blocked') {
                return {
                    diagnostics: [{code: 'local-source-identity-invalid', message, severity: 'error'}],
                    status: 'blocked',
                };
            }
            throw new Error(message);
        }
        const observedPackage = await openedSource.scopedFilesystem.inspect({path: 'package.json'});
        if (observedPackage.status !== 'succeeded') {
            const message = observedPackage.diagnostics.map(entry => entry.message).join(' ');
            if (observedPackage.status === 'blocked') {
                return {
                    diagnostics: [{code: 'local-source-identity-invalid', message, severity: 'error'}],
                    status: 'blocked',
                };
            }
            throw new Error(message);
        }
        if (observedPackage.entry.kind === 'missing') {
            throw new Error('Local source package.json does not exist.');
        }
        if (observedPackage.entry.kind !== 'file') {
            return {
                diagnostics: [{
                    code: 'local-source-identity-invalid',
                    message: 'Local source package.json is not an allowed regular file.',
                    severity: 'error',
                }],
                status: 'blocked',
            };
        }
        const readPackage = await openedSource.scopedFilesystem.read({path: 'package.json'});
        if (readPackage.status !== 'succeeded') {
            const message = readPackage.diagnostics.map(entry => entry.message).join(' ');
            if (readPackage.status === 'blocked') {
                return {
                    diagnostics: [{code: 'local-source-identity-invalid', message, severity: 'error'}],
                    status: 'blocked',
                };
            }
            throw new Error(message);
        }
        packageBytes = readPackage.bytes;
    } catch (error) {
        return {
            diagnostics: [{
                code: 'local-source-observation-failed',
                message: error instanceof Error ? error.message : String(error),
                severity: 'error',
            }],
            stage: 'package-read',
            status: 'failed',
        };
    }
    let packageIdentity;
    try {
        packageIdentity = parsePackageIdentity(packageBytes, 'package.json');
    } catch (error) {
        return {
            diagnostics: [{
                code: 'local-source-identity-invalid',
                message: error instanceof Error ? error.message : String(error),
                severity: 'error',
            }],
            status: 'blocked',
        };
    }
    return {
        arwVersion: `${packageIdentity.version}-pre`,
        diagnostics: [],
        sourceDirectory,
        status: 'succeeded',
    };
};

/** @param {Awaited<ReturnType<typeof prepareInstallationFilesystem>>} preparedFilesystem */
const inspectConfiguration = async preparedFilesystem => {
    const path = joinRelativePath(preparedFilesystem.installationPath, 'config.json');
    const observed = await preparedFilesystem.filesystem.inspect({path, rejectHardLinks: true});
    if (observed.status !== 'succeeded') {
        throw new Error(`Cannot safely read the configuration target: ${observed.diagnostics.map(entry => entry.message).join(' ')}`);
    }
    if (observed.entry.kind === 'missing') return {bytes: null, exists: false};
    if (observed.entry.kind !== 'file') throw new Error('Cannot safely read a linked or non-file configuration target.');
    const read = await preparedFilesystem.filesystem.read({path, rejectHardLinks: true});
    if (read.status !== 'succeeded') {
        throw new Error(`Cannot safely read the configuration target: ${read.diagnostics.map(entry => entry.message).join(' ')}`);
    }
    return {bytes: read.bytes, exists: true};
};

/** @param {unknown} value @param {string} path @param {Map<string, unknown>} leaves */
const collectConfigurationLeaves = (value, path, leaves) => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const entries = Object.entries(value);
        if (entries.length > 0) {
            for (const [key, nested] of entries) {
                collectConfigurationLeaves(nested, path === '' ? key : `${path}.${key}`, leaves);
            }
            return;
        }
    }
    if (path !== '') leaves.set(path, value);
};

/** @param {Buffer} sourceBytes @param {Buffer} targetBytes */
const configurationChangeNotices = (sourceBytes, targetBytes) => {
    const parsedSource = parseJsonText(sourceBytes);
    const parsedTarget = parseJsonText(targetBytes);
    if (parsedSource.status !== 'succeeded' || parsedTarget.status !== 'succeeded') {
        throw new InstallationInvariantError('Configuration conversion produced bytes that the JSON Module cannot parse.');
    }
    const source = parsedSource.value;
    const target = parsedTarget.value;
    const sourceLeaves = new Map();
    const targetLeaves = new Map();
    collectConfigurationLeaves(source, '', sourceLeaves);
    collectConfigurationLeaves(target, '', targetLeaves);
    const added = [...targetLeaves.keys()]
        .filter(path => !sourceLeaves.has(path))
        .sort(compareText);
    const removed = [...sourceLeaves.keys()]
        .filter(path => !targetLeaves.has(path))
        .sort(compareText);
    const updated = [...sourceLeaves.keys()]
        .filter(path => targetLeaves.has(path) && !jsonSemanticallyEqual(sourceLeaves.get(path), targetLeaves.get(path)))
        .sort(compareText);
    return [
        ...added.map(path => `Configuration added path: ${path}.`),
        ...removed.map(path => `Configuration removed path: ${path}.`),
        ...updated.map(path => `Configuration updated path: ${path}.`),
    ];
};

/** @param {Awaited<ReturnType<typeof prepareInstallationFilesystem>>} preparedFilesystem @param {string[]} plannedFiles */
const findResidualCollisions = async (preparedFilesystem, plannedFiles) => {
    const collisions = [];
    for (const file of plannedFiles) {
        const observed = await preparedFilesystem.filesystem.inspect({
            path: joinRelativePath(preparedFilesystem.installationPath, file),
        });
        if (observed.status !== 'succeeded') throw new Error(observed.diagnostics.map(entry => entry.message).join(' '));
        if (observed.entry.kind !== 'missing') collisions.push(file);
    }
    return collisions;
};

/** @param {Awaited<ReturnType<typeof prepareInstallationFilesystem>>} preparedFilesystem */
const assertSafeConfigurationTarget = async preparedFilesystem => {
    const observed = await preparedFilesystem.filesystem.inspect({
        path: joinRelativePath(preparedFilesystem.installationPath, 'config.json'),
        rejectHardLinks: true,
    });
    if (observed.status !== 'succeeded') {
        throw new Error(`Cannot safely use the configuration target: ${observed.diagnostics.map(entry => entry.message).join(' ')}`);
    }
    if (!['file', 'missing'].includes(observed.entry.kind)) {
        throw new Error('Cannot safely replace a linked or non-file configuration target.');
    }
};

/** @param {string} installationDirectory @param {typeof createScopedFilesystem} createFilesystem */
const prepareInstallationFilesystem = async (installationDirectory, createFilesystem = createScopedFilesystem) => {
    const root = dirname(dirname(installationDirectory));
    const resolvedInstallation = resolveAbsolutePathWithinScope({path: installationDirectory, scope: root});
    if (resolvedInstallation.status !== 'succeeded' || resolvedInstallation.relativePath.length === 0) {
        throw new Error('Installation directory must remain inside its filesystem scope.');
    }
    const scoped = await createFilesystem({root});
    if (scoped.status !== 'succeeded') {
        throw new Error(scoped.diagnostics.map(entry => entry.message).join(' '));
    }
    return {
        filesystem: scoped.scopedFilesystem,
        installationPath: resolvedInstallation.relativePath.split(sep).join('/'),
    };
};

/** @param {Awaited<ReturnType<typeof prepareInstallationFilesystem>>} preparedFilesystem @param {{bytes: Buffer | null, exists: boolean}} configuration @param {Buffer} bytes */
const prepareConfigurationWrite = async (preparedFilesystem, configuration, bytes) => {
    const transaction = createFileTransaction(preparedFilesystem.filesystem);
    const path = joinRelativePath(preparedFilesystem.installationPath, 'config.json');
    const expected = configuration.exists
        ? {hash: sha256(configuration.bytes ?? Buffer.alloc(0)), kind: /** @type {'file'} */ ('file')}
        : {kind: /** @type {'missing'} */ ('missing')};
    const preflight = await transaction.preflight([{
        bytes,
        expected,
        kind: configuration.exists ? 'replace' : 'create',
        path,
    }]);
    if (preflight.status !== 'succeeded') {
        throw new Error(preflight.diagnostics.map(entry => entry.message).join(' '));
    }
    return {preparedTransaction: preflight.preparedTransaction, transaction};
};

/** @param {readonly unknown[]} ownership @param {string} platform @param {string} installationDirectory */
const ownsPlatformRegistration = (ownership, platform, installationDirectory) => ownership.some(record => {
    if (record === null || typeof record !== 'object') return false;
    if (platform === 'win32') {
        return 'kind' in record && record.kind === 'windows-user-path'
            && 'entry' in record && typeof record.entry === 'string'
            && normalizeWindowsPathEntry(record.entry) === normalizeWindowsPathEntry(installationDirectory);
    }
    if (platform === 'linux') {
        return 'kind' in record && record.kind === 'linux-profile'
            && 'profile' in record && record.profile === join(dirname(installationDirectory), '.profile');
    }
    return false;
});

/** @param {string} platform @param {string} installationDirectory */
const platformCleanupNotice = (platform, installationDirectory) => {
    if (platform === 'win32') {
        return `Manual cleanup required before retry: remove unowned windows-user-path registration ${installationDirectory}.`;
    }
    if (platform === 'linux') {
        return `Manual cleanup required before retry: remove the ARW marker from unowned linux-profile registration ${join(dirname(installationDirectory), '.profile')}.`;
    }
    return null;
};

/**
 * 执行完整 Installation 事务. 调用方提供已解析选择和互斥的 local 或 Release source request,
 * local request 从当前 Source Checkout 派生 source result, Release request 使用精确 evidence 取得正式 source result.
 * 返回值直接说明完成状态和规范归属, 不要求调用方重新读取 `manifest` 或 filesystem. `options` 只提供 production 与 deterministic test Adapters.
 */
/** @param {InstallDecisions} decisions @param {InstallerOptions} [options] */
export const installRelease = async (decisions, options = {}) => {
    requireInstallDecisions(decisions);
    requireInstallerOptions(options, decisions);
    /** @type {InstallDiagnostic[]} */
    const diagnostics = [];
    /** @type {string[]} */
    const notices = [];
    let stage = 'preflight';
    /** @type {InstallSummary | null} */
    let summary = null;
    let writeBoundary = null;
    /** @type {Set<string>} */
    const unprovenRuntimePaths = new Set();
    let unprovenPlatformNotice = null;
    let unknownPlatformEffect = false;

    try {
        const platform = options.platform ?? process.platform;
        const sourceDirectory = options.sourceDirectory;
        const environment = options.environment ?? process.env;
        const installation = resolveInstallation(environment, platform);
        const source = options.release ?? await (decisions.sourceRequest?.kind === 'local'
            ? loadLocalSource({sourceDirectory})
            : (options.loadReleaseSource ?? loadRelease)({
                evidence: decisions.sourceRequest?.evidence,
                platform,
                sourceDirectory,
            }));
        if (source.status !== 'succeeded') {
            diagnostics.push(...source.diagnostics);
            return {
                diagnostics,
                notices,
                operation: 'install',
                stage,
                status: 'unchanged',
                summary,
            };
        }
        /** @type {ReleaseSource} */
        const verifiedSource = source;
        const payloadResult = await (options.loadInstallationPayload ?? loadInstallationPayload)({
            platform,
            sourceDirectory: verifiedSource.sourceDirectory,
        });
        if (payloadResult.status !== 'succeeded') {
            throw new Error(payloadResult.diagnostics.map(diagnostic => diagnostic.message).join(' '));
        }
        const runtimeFiles = payloadResult.payload.map(entry => entry.path);
        const configSeedBytes = payloadResult.configSeedBytes;
        const explicitVersion = decisions.sourceRequest?.kind === 'release'
            && decisions.sourceRequest.evidence.explicitVersion;
        /** @type {InstallSummary} */
        const initialSummary = {
            arwVersion: verifiedSource.arwVersion,
            configurationResult: null,
            installationDirectory: installation.directory,
            managedFiles: [...runtimeFiles],
            pathOwnership: [],
        };
        summary = initialSummary;

        const inspection = await inspectInstallation({
            installationDirectory: installation.directory,
            platform,
        });
        if (inspection.status !== 'succeeded') {
            throw new Error(inspection.diagnostics.map(diagnostic => diagnostic.message).join(' '));
        }
        const existing = inspection.installation === null
            ? {...installation, exists: false, managed: false, manifest: null}
            : {
                directory: inspection.installation.installationDirectory,
                exists: true,
                managed: inspection.installation.manifest !== null,
                manifest: inspection.installation.manifest,
                pathKind: inspection.installation.pathKind,
            };
        const existingManifest = existing.manifest;
        if (existing.managed && existingManifest === null) {
            throw new InstallationInvariantError('Managed Installation has no ownership manifest.');
        }
        const installationDirectory = existing.directory;
        const preparedFilesystem = await prepareInstallationFilesystem(
            installationDirectory,
            options.createFilesystem,
        );
        const previouslyOwnedRuntime = new Set(existingManifest?.managedFiles ?? []);
        const platformRegistrationAlreadyOwned = ownsPlatformRegistration(
            existingManifest?.pathOwnership ?? [],
            platform,
            installationDirectory,
        );
        const configuration = await inspectConfiguration(preparedFilesystem);
        const copySeed = !configuration.exists || decisions.reinitializeConfig === true;
        /** @type {string[]} */
        const configurationChanges = [];
        let configurationBytes = null;
        if (copySeed) {
            const seedConfiguration = parseConfiguration(configSeedBytes, 'config.install.json');
            if (seedConfiguration.configVersion !== 3) {
                throw new Error('Invalid configuration: config.install.json must use current configVersion 3.');
            }
            configurationBytes = configSeedBytes;
        } else {
            if (configuration.bytes === null) throw new InstallationInvariantError('Existing configuration bytes are missing.');
            const conversion = convertConfiguration({
                rules: GLOBAL_CONFIGURATION_RULES,
                sourceBytes: configuration.bytes,
            });
            if (conversion.status !== 'succeeded') {
                throw new Error(conversion.diagnostics.map(diagnostic => diagnostic.message).join(' '));
            }
            const completed = completeGlobalConfigurationBytes(conversion.bytes);
            if (conversion.changed || completed.changed) {
                configurationBytes = completed.bytes;
                configurationChanges.push(...configurationChangeNotices(configuration.bytes, completed.bytes));
            }
            notices.push(...conversion.unknownPaths.map(path => `Preserved unknown configuration path: ${path}.`));
        }
        if (existing.managed
            && existingManifest !== null
            && compareVersions(verifiedSource.arwVersion, existingManifest.arwVersion) < 0
            && !explicitVersion) {
            throw new Error(
                `Default latest installation refuses downgrade from ${existingManifest.arwVersion} to ${verifiedSource.arwVersion}.`,
            );
        }
        if (existing.exists && !existing.managed) {
            const collisions = await findResidualCollisions(preparedFilesystem, [...runtimeFiles, 'manifest.json']);
            if (collisions.length > 0) {
                throw new Error(`Residual planned-target collisions require manual cleanup: ${collisions.join(', ')}.`);
            }
        }
        if (existing.managed && existingManifest !== null) {
            const previouslyOwned = new Set(existingManifest.managedFiles);
            const collisions = await findResidualCollisions(
                preparedFilesystem,
                runtimeFiles.filter(file => !previouslyOwned.has(file)),
            );
            if (collisions.length > 0) {
                throw new Error(`Unowned planned-target collisions require manual cleanup: ${collisions.join(', ')}.`);
            }
        }

        if (!decisions.nonInteractive) {
            if (typeof options.prompt !== 'function') {
                throw new Error('Interactive installation requires an available input stream.');
            }

            decisions.registerPath = await options.prompt('registerPath');
        }

        let configurationWrite = null;
        if (configurationBytes !== null) {
            await assertSafeConfigurationTarget(preparedFilesystem);
            configurationWrite = await prepareConfigurationWrite(
                preparedFilesystem,
                configuration,
                configurationBytes,
            );
        }
        const registerPath = decisions.registerPath;
        if (typeof registerPath !== 'boolean') throw new InstallationInvariantError('PATH registration decision is missing.');
        const pathPlanResult = await planPathRegistration({
            installation: existing,
            linuxProfile: options.linuxProfile,
            registerPath,
            windowsPath: options.windowsPath,
        });
        if (pathPlanResult.status !== 'succeeded') {
            throw new Error(pathPlanResult.diagnostics.map(diagnostic => diagnostic.message).join(' '));
        }
        await assertSafeManagedPaths(existing, {
            managedFiles: [...runtimeFiles],
            overwriteFiles: [...runtimeFiles],
        });
        const effectiveConfigurationBytes = configurationBytes ?? configuration.bytes;
        if (effectiveConfigurationBytes === null) throw new InstallationInvariantError('Prepared configuration bytes are missing.');
        const effectiveConfiguration = parseConfiguration(effectiveConfigurationBytes, 'config.json');
        const customModelCatalog = await prepareCustomModelCatalog({
            environment,
            maxInstances: effectiveConfiguration.backgroundAgent?.maxInstances ?? BACKGROUND_AGENT_DEFAULTS.maxInstances,
            platform,
        });

        const acquired = await (options.acquireMaintenance ?? acquireBackgroundAgentMaintenance)({
            runtimeDirectory: backgroundAgentRuntimeDirectory(installationDirectory),
        });
        if (acquired.status !== 'acquired') {
            throw new Error(`Background Agent maintenance ${acquired.status}: ${acquired.reason}`);
        }

        const createdInstallation = await preparedFilesystem.filesystem.createDirectory({
            path: preparedFilesystem.installationPath,
            recursive: true,
        });
        if (createdInstallation.status !== 'succeeded') {
            throw new Error(createdInstallation.diagnostics.map(entry => entry.message).join(' '));
        }
        if (!existing.exists) {
            writeBoundary = 'the installation directory was created';
        }

        if (existing.managed && existingManifest !== null) {
            stage = 'remove';
            for (const file of existingManifest.managedFiles) {
                const removed = await preparedFilesystem.filesystem.remove({
                    path: joinRelativePath(preparedFilesystem.installationPath, file),
                });
                if (removed.status !== 'succeeded') {
                    throw new Error(removed.diagnostics.map(entry => entry.message).join(' '));
                }
                if (removed.removed) writeBoundary = 'the current managed installation was removed';
            }
            if (await removeEmptyManagedDirectories(preparedFilesystem, existingManifest.managedFiles)) {
                writeBoundary = 'the current managed installation was removed';
            }
        }

        stage = 'install';
        for (const entry of payloadResult.payload) {
            const file = entry.path;
            const written = await preparedFilesystem.filesystem.write({
                bytes: entry.bytes,
                mode: 'create',
                path: joinRelativePath(preparedFilesystem.installationPath, file),
            });
            if (written.status !== 'succeeded') {
                if (written.status === 'failed' && !previouslyOwnedRuntime.has(file)) unprovenRuntimePaths.add(file);
                throw new Error(written.diagnostics.map(diagnostic => diagnostic.message).join(' '));
            }
            if (!previouslyOwnedRuntime.has(file)) unprovenRuntimePaths.add(file);
            writeBoundary = 'program files were written';
        }
        if (platform !== 'win32') {
            const modeUpdated = await preparedFilesystem.filesystem.setMode({
                mode: 0o755,
                path: joinRelativePath(preparedFilesystem.installationPath, 'arw'),
            });
            if (modeUpdated.status !== 'succeeded') {
                throw new Error(modeUpdated.diagnostics.map(entry => entry.message).join(' '));
            }
        }
        writeBoundary = 'program files were written';

        if (configurationWrite !== null) {
            const appliedConfiguration = await configurationWrite.transaction.apply(
                configurationWrite.preparedTransaction,
            );
            if (appliedConfiguration.status !== 'succeeded') {
                throw new Error(appliedConfiguration.diagnostics
                    .map((/** @type {{message: string}} */ entry) => entry.message)
                    .join(' '));
            }
            notices.unshift(...configurationChanges);
            writeBoundary = 'program files and configuration were written';
            summary.configurationResult = copySeed
                ? configuration.exists ? 'reinitialized' : 'initialized'
                : 'preserved';
        } else {
            writeBoundary = 'program files were written and the existing configuration was preserved';
            summary.configurationResult = 'preserved';
        }
        await customModelCatalog.apply();
        diagnostics.push(...customModelCatalog.warnings.map(message => ({
            code: 'model-provider-capacity-exceeds-global',
            message,
            severity: 'warning',
        })));
        stage = 'path';
        const pathResult = await applyPathOwnershipPlan(pathPlanResult.preparedPathOwnership);
        if (pathResult.status !== 'succeeded') {
            if ('pathOwnership' in pathResult && Array.isArray(pathResult.pathOwnership)) {
                summary.pathOwnership = [...pathResult.pathOwnership];
            }
            if ('effect' in pathResult && pathResult.effect !== 'none' && !platformRegistrationAlreadyOwned) {
                unprovenPlatformNotice = platformCleanupNotice(platform, installationDirectory);
            }
            unknownPlatformEffect = 'effect' in pathResult && pathResult.effect === 'unknown';
            throw new Error(pathResult.diagnostics.map(diagnostic => diagnostic.message).join(' '));
        }
        diagnostics.push(...pathResult.diagnostics);
        if (pathResult.notice) {
            notices.push(pathResult.notice);
        }
        if (pathResult.changed) {
            writeBoundary = 'program files, configuration, and PATH registration were written';
            if (!platformRegistrationAlreadyOwned) {
                unprovenPlatformNotice = platformCleanupNotice(platform, installationDirectory);
            }
        }
        summary.pathOwnership = [...pathResult.pathOwnership];
        stage = 'manifest';
        await (options.writeManifest ?? writeInstallationManifest)(
            existing,
            runtimeFiles,
            pathResult.pathOwnership,
            verifiedSource,
            preparedFilesystem,
        );
        return {diagnostics, notices, operation: 'install', stage: 'complete', status: 'installed', summary};
    } catch (error) {
        if (error instanceof InstallationInvariantError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        /** @type {InstallDiagnostic} */
        const failureDiagnostic = {
            code: writeBoundary === null ? 'installation-not-applied' : 'installation-partial',
            message: writeBoundary === null
                ? message
                : `Installation failed after ${writeBoundary}; manifest was not written: ${message}`,
            severity: 'error',
        };
        diagnostics.push(failureDiagnostic);
        notices.push(...[...unprovenRuntimePaths]
            .sort(compareText)
            .map(path => `Manual cleanup required before retry: remove unowned installation path ${path}.`));
        if (unprovenPlatformNotice !== null) notices.push(unprovenPlatformNotice);
        return {
            diagnostics,
            notices,
            operation: 'install',
            stage,
            status: unknownPlatformEffect ? 'unknown' : writeBoundary === null ? 'unchanged' : 'partial',
            summary,
        };
    }
};

/**
 * 把 Installer CLI 参数和输出映射到模块接口. 用法错误使用退出码 2, 其他预期失败使用 1, 成功使用 0.
 */
/** @param {string[]} args @param {InstallerOptions} [options] @returns {Promise<number>} */
export const runInstaller = async (args, options = {}) => {
    const stderr = options.stderr ?? (message => process.stderr.write(`${message}\n`));
    const stdout = options.stdout ?? (message => process.stdout.write(`${message}\n`));
    let decisions;

    try {
        decisions = parseInstallArguments(args);
    } catch (error) {
        stderr(error instanceof Error ? error.message : String(error));
        return error instanceof InstallerUsageError ? error.exitCode : 1;
    }

    const result = await installRelease(decisions, options);
    for (const diagnostic of result.diagnostics) {
        stderr(diagnostic.message);
    }
    for (const notice of result.notices) stdout(notice);
    if (result.diagnostics.some(diagnostic => diagnostic.severity === 'error')
        || result.status === 'partial'
        || result.status === 'unknown') {
        return 1;
    }
    if (result.status === 'unchanged') return 0;
    if (result.status !== 'installed') return 1;
    if (result.summary === null) return 1;
    stdout(`Installed ${PRODUCT_NAME} to ${result.summary.installationDirectory}.`);
    return 0;
};
