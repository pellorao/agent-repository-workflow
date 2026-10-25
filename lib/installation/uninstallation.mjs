import {dirname, sep} from 'node:path';

import {PRODUCT_NAME} from '../arw-common/product-identity.mjs';
import {acquireBackgroundAgentMaintenance, backgroundAgentRuntimeDirectory, createBackgroundAgentClient} from '../background-agent/client.mjs';
import {backgroundAgentMessageDatabasePaths} from '../background-agent/message-store.mjs';
import {
    createScopedFilesystem,
    joinRelativePath,
    resolveAbsolutePathWithinScope,
} from '../common/filesystem.mjs';

import {
    assertSafeManagedPaths,
    applyPathOwnershipPlan,
    InstallationInvariantError,
    loadInstallationOwnership,
    planPathRemoval,
    removeEmptyManagedDirectories,
    removeInstallationManifest,
    resolveInstallation,
} from './installation-contract.mjs';

export const UNINSTALL_USAGE = 'Usage: node uninstall.mjs [--non-interactive] [--remove-config true|false] [--stop-background-agents true|false]\n'
    + 'In non-interactive mode, running the command itself confirms removal of the installation; there is no --remove-installation option.';

/** @typedef {{removeConfig: boolean, removeInstallation: boolean, stopBackgroundAgents: boolean}} UninstallRequest */
/** @typedef {{nonInteractive: boolean, removeConfig: boolean | null, stopBackgroundAgents: boolean | null}} UninstallCliDecisions */
/** @typedef {import('../background-agent/presentation.mjs').BackgroundAgentOverview} BackgroundAgentOverview */
/** @typedef {{code: string, message: string, severity: string}} UninstallDiagnostic */
/** @typedef {{arwVersion: string | null, configurationResult: 'absent' | 'preserved' | 'removed', installationDirectory: string, managedFiles: string[], pathOwnership: unknown[], residualPaths: string[] | null}} UninstallSummary */
/** @typedef {{acquireMaintenance?: typeof acquireBackgroundAgentMaintenance, createFilesystem?: typeof createScopedFilesystem, environment?: Record<string, unknown>, linuxProfile?: NonNullable<Parameters<typeof planPathRemoval>[0]['linuxProfile']>, listBackgroundAgents?: (runtimeDirectory: string) => Promise<unknown>, platform?: string, prompt?: (decision: 'removeInstallation' | 'removeConfig' | 'stopBackgroundAgents', activeAgents?: BackgroundAgentOverview[]) => Promise<boolean>, stderr?: (message: string) => void, stdout?: (message: string) => void, windowsPath?: NonNullable<Parameters<typeof planPathRemoval>[0]['windowsPath']>}} UninstallerOptions */

export class UninstallerUsageError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'UninstallerUsageError';
        this.exitCode = 2;
    }
}

/** @param {string[]} args @returns {UninstallCliDecisions} */
export const parseUninstallArguments = args => {
    let nonInteractive = false;
    /** @type {boolean | null} */
    let removeConfig = null;
    /** @type {boolean | null} */
    let stopBackgroundAgents = null;

    for (let index = 0; index < args.length; index += 1) {
        const option = args[index];
        if (option === '--non-interactive') {
            if (nonInteractive) {
                throw new UninstallerUsageError('--non-interactive must not be repeated.');
            }
            nonInteractive = true;
            continue;
        }
        if (option === '--stop-background-agents' && stopBackgroundAgents === null) {
            const value = args[index + 1];
            if (!['true', 'false'].includes(value)) {
                throw new UninstallerUsageError('--stop-background-agents expects true or false.');
            }
            stopBackgroundAgents = value === 'true';
            index += 1;
            continue;
        }
        if (option !== '--remove-config' || removeConfig !== null) {
            throw new UninstallerUsageError(`Unknown or repeated option: ${option}.`);
        }

        const value = args[index + 1];
        if (!['true', 'false'].includes(value)) {
            throw new UninstallerUsageError('--remove-config expects true or false.');
        }
        removeConfig = value === 'true';
        index += 1;
    }

    return {nonInteractive, removeConfig, stopBackgroundAgents};
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

/** @param {Awaited<ReturnType<typeof prepareInstallationFilesystem>>} preparedFilesystem @param {string} path */
const removeOptionalPath = async (preparedFilesystem, path) => {
    const result = await preparedFilesystem.filesystem.remove({path});
    if (result.status !== 'succeeded') {
        throw new Error(result.diagnostics.map(diagnostic => diagnostic.message).join(' '));
    }
    return result.removed;
};

/** @param {Awaited<ReturnType<typeof prepareInstallationFilesystem>>} preparedFilesystem @param {string} path */
const pathExists = async (preparedFilesystem, path) => {
    const result = await preparedFilesystem.filesystem.inspect({path});
    if (result.status !== 'succeeded') {
        throw new Error(result.diagnostics.map(diagnostic => diagnostic.message).join(' '));
    }
    return result.entry.kind !== 'missing';
};

/** @param {Awaited<ReturnType<typeof prepareInstallationFilesystem>>} preparedFilesystem @returns {Promise<string[]>} */
const listResidualPaths = async preparedFilesystem => {
    const result = await preparedFilesystem.filesystem.list({
        path: preparedFilesystem.installationPath,
        recursive: true,
    });
    if (result.status !== 'succeeded') {
        throw new Error(result.diagnostics.map(diagnostic => diagnostic.message).join(' '));
    }
    return result.entries
        .map(entry => entry.path.slice(preparedFilesystem.installationPath.length + 1))
        .filter(path => path !== 'manifest.json');
};

/**
 * 执行 `manifest` 驱动的安全卸载. 调用方提供已解析选择, 结果直接说明完成状态和已经释放的规范归属.
 * 所有删除目标先由 `manifest` 和固定 Installation 位置证明归属, 缺失目标视为幂等成功, 未知内容始终保留.
 */
/** @param {UninstallRequest} request @param {UninstallerOptions} options */
const uninstallValidated = async (request, options) => {
    /** @type {UninstallDiagnostic[]} */
    const diagnostics = [];
    /** @type {string[]} */
    const notices = [];
    let stage = 'preflight';
    /** @type {UninstallSummary | null} */
    let summary = null;
    let mutationStarted = false;
    let mutationUnknown = false;

    if (!request.removeInstallation) {
        notices.push('Uninstallation cancelled.');
        return {diagnostics, notices, operation: 'uninstall', stage: 'preflight', status: 'unchanged', summary: null};
    }

    try {
        const platform = options.platform ?? process.platform;
        const environment = options.environment ?? process.env;
        const installation = await loadInstallationOwnership(environment, platform);
        const installationDirectory = installation.directory;
        const loadedManifest = installation.manifest;
        if (installation.exists && loadedManifest === null) {
            throw new Error('Existing Installation ownership has no manifest.');
        }
        const preparedFilesystem = await prepareInstallationFilesystem(
            installationDirectory,
            options.createFilesystem,
        );
        const configurationPath = joinRelativePath(preparedFilesystem.installationPath, 'config.json');
        const messageDatabasePaths = Object.values(backgroundAgentMessageDatabasePaths(
            backgroundAgentRuntimeDirectory(installationDirectory),
        )).map(path => {
            const resolved = resolveAbsolutePathWithinScope({path, scope: installationDirectory});
            if (resolved.status !== 'succeeded' || resolved.relativePath.length === 0) {
                throw new Error('Message database path is outside the Installation directory.');
            }
            return joinRelativePath(preparedFilesystem.installationPath, resolved.relativePath.split(sep).join('/'));
        });
        const configurationExisted = installation.exists && await pathExists(preparedFilesystem, configurationPath);
        /** @type {UninstallSummary} */
        const initialSummary = {
            arwVersion: loadedManifest?.arwVersion ?? null,
            configurationResult: configurationExisted ? 'preserved' : 'absent',
            installationDirectory,
            managedFiles: loadedManifest === null ? [] : [...loadedManifest.managedFiles],
            pathOwnership: loadedManifest === null ? [] : [...loadedManifest.pathOwnership],
            residualPaths: null,
        };
        summary = initialSummary;
        if (!installation.exists) {
            notices.push(`${PRODUCT_NAME} is already uninstalled from ${installationDirectory}.`);
            return {diagnostics, notices, operation: 'uninstall', stage: 'complete', status: 'unchanged', summary};
        }
        const manifest = loadedManifest;
        if (manifest === null) throw new Error('Existing Installation ownership has no manifest.');
        const ownedInstallation = {...installation, manifest};
        await assertSafeManagedPaths(ownedInstallation);
        const pathPlanResult = await planPathRemoval({
            installation: ownedInstallation,
            linuxProfile: options.linuxProfile,
            windowsPath: options.windowsPath,
        });
        if (pathPlanResult.status !== 'succeeded') {
            throw new Error(pathPlanResult.diagnostics.map(diagnostic => diagnostic.message).join(' '));
        }

        const acquired = await (options.acquireMaintenance ?? acquireBackgroundAgentMaintenance)({
            runtimeDirectory: backgroundAgentRuntimeDirectory(installationDirectory),
            stopBackgroundAgents: request.stopBackgroundAgents,
            allowIdleEviction: false,
        });
        for (const runId of acquired.stoppedAgents) {
            notices.push(`Background Agent App Server exited: ${runId}.`);
        }
        if (acquired.status !== 'acquired') {
            throw new Error(`Background Agent maintenance ${acquired.status}: ${acquired.reason}`);
        }

        await assertSafeManagedPaths(ownedInstallation);
        if (request.removeConfig) {
            for (const path of [configurationPath, ...messageDatabasePaths]) {
                const entry = await preparedFilesystem.filesystem.inspect({path, rejectHardLinks: true});
                if (entry.status !== 'succeeded' || (entry.entry.kind !== 'missing' && entry.entry.kind !== 'file')) {
                    throw new Error(`Cannot safely remove the Installation configuration or message database: ${path}.`);
                }
            }
        }

        stage = 'remove-path';
        const pathResult = await applyPathOwnershipPlan(pathPlanResult.preparedPathOwnership);
        if (pathResult.status !== 'succeeded') {
            if ('pathOwnership' in pathResult && Array.isArray(pathResult.pathOwnership)) {
                summary.pathOwnership = [...pathResult.pathOwnership];
            }
            mutationStarted = 'effect' in pathResult && pathResult.effect === 'changed';
            mutationUnknown = 'effect' in pathResult && pathResult.effect === 'unknown';
            throw new Error(pathResult.diagnostics.map(diagnostic => diagnostic.message).join(' '));
        }
        diagnostics.push(...pathResult.diagnostics);
        mutationStarted = pathResult.changed;
        summary.pathOwnership = [...pathResult.pathOwnership];
        stage = 'remove-files';
        for (const file of manifest.managedFiles) {
            mutationStarted = await removeOptionalPath(
                preparedFilesystem,
                joinRelativePath(preparedFilesystem.installationPath, file),
            ) || mutationStarted;
        }
        await removeEmptyManagedDirectories(preparedFilesystem, manifest.managedFiles);
        if (request.removeConfig) {
            mutationStarted = await removeOptionalPath(preparedFilesystem, configurationPath) || mutationStarted;
            for (const path of messageDatabasePaths) {
                mutationStarted = await removeOptionalPath(preparedFilesystem, path) || mutationStarted;
            }
            summary.configurationResult = configurationExisted ? 'removed' : 'absent';
        }
        stage = 'manifest';
        summary.residualPaths = await listResidualPaths(preparedFilesystem);
        await removeInstallationManifest(preparedFilesystem);
        mutationStarted = true;

        if (summary.residualPaths.length === 0) {
            const directoryResult = await preparedFilesystem.filesystem.remove({
                path: preparedFilesystem.installationPath,
            });
            if (directoryResult.status !== 'succeeded') {
                notices.push(`Manual cleanup may be required: remove the empty installation directory ${installationDirectory}.`);
            }
        }
        return {diagnostics, notices, operation: 'uninstall', stage: 'complete', status: 'removed', summary};
    } catch (error) {
        if (error instanceof InstallationInvariantError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        const status = mutationUnknown ? 'unknown' : mutationStarted ? 'partial' : 'unchanged';
        diagnostics.push({
            code: status === 'partial'
                ? 'uninstallation-partial'
                : status === 'unknown' ? 'uninstallation-state-unknown' : 'uninstallation-not-applied',
            message,
            severity: 'error',
        });
        return {
            diagnostics,
            notices,
            operation: 'uninstall',
            stage,
            status,
            summary,
        };
    }
};

/**
 * 执行只由三个 boolean 决定的卸载生命周期. CLI 负责把交互确认映射为三个选择.
 * @param {unknown} request
 * @param {UninstallerOptions} [options]
 */
export const uninstallRelease = (request, options = {}) => {
    if (request === null
        || typeof request !== 'object'
        || Array.isArray(request)
        || Object.keys(request).sort().join(',') !== 'removeConfig,removeInstallation,stopBackgroundAgents'
        || !('removeConfig' in request)
        || !('removeInstallation' in request)
        || !('stopBackgroundAgents' in request)
        || typeof request.removeConfig !== 'boolean'
        || typeof request.removeInstallation !== 'boolean'
        || typeof request.stopBackgroundAgents !== 'boolean') {
        throw new TypeError('Uninstallation request must contain removeInstallation, removeConfig, and stopBackgroundAgents booleans.');
    }
    return uninstallValidated({
        removeConfig: request.removeConfig,
        removeInstallation: request.removeInstallation,
        stopBackgroundAgents: request.stopBackgroundAgents,
    }, options);
};

/**
 * 把 Uninstaller CLI 参数和输出映射到模块接口. 用法错误使用退出码 2, 其他预期失败使用 1, 成功使用 0.
 */
/** @param {string[]} args @param {UninstallerOptions} [options] @returns {Promise<number>} */
export const runUninstaller = async (args, options = {}) => {
    const stderr = options.stderr ?? (message => process.stderr.write(`${message}\n`));
    const stdout = options.stdout ?? (message => process.stdout.write(`${message}\n`));
    const prompt = options.prompt;
    let decisions;

    try {
        decisions = parseUninstallArguments(args);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderr(error instanceof UninstallerUsageError ? `${message}\n${UNINSTALL_USAGE}` : message);
        return error instanceof UninstallerUsageError ? error.exitCode : 1;
    }

    let removeInstallation = true;
    if (!decisions.nonInteractive) {
        if (typeof prompt !== 'function') {
            stderr('Interactive uninstallation requires an available input stream.');
            return 1;
        }
        try {
            removeInstallation = await prompt('removeInstallation');
        } catch (error) {
            stderr(error instanceof Error ? error.message : String(error));
            return 1;
        }
    }

    let removeConfig = decisions.removeConfig ?? false;
    if (removeInstallation && !decisions.nonInteractive && decisions.removeConfig === null) {
        try {
            if (typeof prompt !== 'function') throw new Error('Interactive uninstallation requires an available input stream.');
            removeConfig = await prompt('removeConfig');
        } catch (error) {
            stderr(error instanceof Error ? error.message : String(error));
            return 1;
        }
    }

    let stopBackgroundAgents = decisions.stopBackgroundAgents ?? false;
    if (removeInstallation && !decisions.nonInteractive && decisions.stopBackgroundAgents === null) {
        try {
            const installationDirectory = resolveInstallation(
                options.environment ?? process.env,
                options.platform ?? process.platform,
            ).directory;
            const runtimeDirectory = backgroundAgentRuntimeDirectory(installationDirectory);
            const observed = await (options.listBackgroundAgents
                ?? (directory => createBackgroundAgentClient({runtimeDirectory: directory}).list()))(runtimeDirectory);
            if (observed !== null && !Array.isArray(observed)) throw new Error('Background Agent overview is invalid.');
            if (observed !== null && observed.length > 0) {
                if (typeof prompt !== 'function') throw new Error('Interactive uninstallation requires an available input stream.');
                stopBackgroundAgents = await prompt('stopBackgroundAgents', /** @type {BackgroundAgentOverview[]} */ (observed));
            }
        } catch (error) {
            stderr(error instanceof Error ? error.message : String(error));
            return 1;
        }
    }

    const result = await uninstallRelease({removeConfig, removeInstallation, stopBackgroundAgents}, options);
    for (const diagnostic of result.diagnostics) stderr(diagnostic.message);
    for (const notice of result.notices) stdout(notice);
    if (result.diagnostics.some(diagnostic => diagnostic.severity === 'error')) return 1;
    if (!['removed', 'unchanged'].includes(result.status)) return 1;
    if (result.status === 'unchanged') return 0;
    if (result.summary === null) return 1;
    if (result.status === 'removed') stdout(`Uninstalled ${PRODUCT_NAME} from ${result.summary.installationDirectory}.`);
    return 0;
};
