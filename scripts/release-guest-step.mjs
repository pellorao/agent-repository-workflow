#!/usr/bin/env node

import {execFile as execFileCallback} from 'node:child_process';
import {lstat, mkdir, readFile, readdir, rename, rmdir, unlink, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, join, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual, promisify} from 'node:util';

import {
    listReleaseValidationScenarios,
    RELEASE_ESM_LIFECYCLE_ENTRIES,
    resolveReleaseValidationScenario,
    resolveReleaseValidationStep,
} from '../lib/release/release-validation-registry.mjs';
import {resolveReleaseGuestTagAction} from '../lib/release/release-guest-validation.mjs';
import {completeGlobalConfigurationBytes, GLOBAL_CONFIGURATION_RULES} from '../lib/arw-common/config.mjs';
import {parsePackageIdentity} from '../lib/arw-common/identity.mjs';
import {parseRegisteredArtifactPath} from '../lib/arw-common/artifacts.mjs';
import {readIssueDocuments} from '../lib/arw-common/issue-documents.mjs';
import {convertConfiguration} from '../lib/common/configuration-conversion.mjs';
import {completeConfigurationBytes, serializeJson} from '../lib/common/json.mjs';
import {normalizeWorkflowProfile} from '../lib/repository-workflow/workflow-lock.mjs';
import {
    joinRelativePath,
    resolveAbsolutePathWithinScope,
    resolveRelativePathWithinScope,
} from '../lib/common/filesystem.mjs';
import {
    inspectReleaseUntrackedEntries,
    isSafeReleaseRelativePath,
    parseReleaseGitStatus,
} from '../lib/release/release-step-review-material.mjs';

const execFile = promisify(execFileCallback);

/** @typedef {{exitCode: number, stderr: string, stdout: string}} ProcessOutcome */
/** @typedef {{cwd?: string, env?: NodeJS.ProcessEnv, windowsVerbatimArguments?: boolean}} ProcessOptions */
/** @typedef {(file: string, args: string[], options?: ProcessOptions) => Promise<ProcessOutcome>} ProcessRunner */
/** @typedef {typeof finiteFileSystem} FiniteFileSystem */
/** @typedef {{captureId: string | null, choices: Record<string, unknown> | null, machineKey: string, observeOnly: boolean, prepareOnly: boolean, scenarioPrepared: boolean, scenarioId: string, stepId: string, workspaceDirectory: string}} GuestRequest */
/** @typedef {{commit: string, fixturesDirectory: string, homeDirectory: string, installationAuditDirectory: string, scenarioRoot: string, sourceDirectory: string, tag: string, targetDirectory: string, targetKind: string | null}} ScenarioState */
/** @typedef {{bytesBase64: string, path: string, type: string}} CapturedEntry */
/** @typedef {{bytesBase64: string | null, path: string, type: string}} SnapshotEntry */
/** @typedef {{action: 'write', bytes: string, path: string} | {action: 'delete', path: string}} ReleaseWorkflowOperation */
/** @typedef {{code: string, evidence: unknown, message: string, operationContract: string, status: 'failed'}} FiniteFailure */
/** @typedef {NonNullable<ReturnType<typeof resolveReleaseValidationStep>>['step']} ReleaseStep */
/** @typedef {(options: {beforeApply: (plan: unknown) => unknown, choices: unknown, distributionDirectory: string, operation: string, repositoryRoot: string, orphanCodeMapReadmes?: unknown, transformExistingAgentDocs?: unknown}) => Promise<unknown>} WorkflowRunner */

const renameDirectoryWithRetry = async (/** @type {import("fs").PathLike} */ source, /** @type {import("fs").PathLike} */ target) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            await rename(source, target);
            return;
        } catch (error) {
            if (!(error instanceof Error) || !('code' in error) || error.code !== 'EPERM' || attempt === 2) throw error;
            await new Promise(resolveDelay => setTimeout(resolveDelay, 25 * (attempt + 1)));
        }
    }
};

/** @returns {value is Record<string, unknown>} */
const finiteExactKeys = (/** @type {unknown} */ value, /** @type {string[]} */ keys) => value !== null
    && !Array.isArray(value)
    && typeof value === 'object'
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
/** @returns {value is Record<string, unknown>} */
const isRecord = (/** @type {unknown} */ value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finiteFileSystem = {lstat, readFile, readdir, rmdir, unlink, writeFile};
const FINITE_CONFIG_PATH = '.agent-repository-workflow/config.json';
const FINITE_UNKNOWN_PATH = '.agent-repository-workflow/release-validation-unknown.txt';
const FINITE_UNKNOWN_BYTES = Buffer.from('release validation unknown content\n');
const LINUX_PROFILE_PATH = '.profile';
const LINUX_PROFILE_MARKER_START = '# >>> agent-repository-workflow PATH >>>';
const LINUX_PROFILE_MARKER_END = '# <<< agent-repository-workflow PATH <<<';
const LINUX_PROFILE_MARKER_BLOCK = `${LINUX_PROFILE_MARKER_START}\n`
    + 'export PATH="$HOME/.agent-repository-workflow:$PATH"\n'
    + LINUX_PROFILE_MARKER_END;
const LINUX_HOME_INSTALLATION_ENTRY = '$HOME/.agent-repository-workflow';
const LINUX_PROFILE_BYTES = Buffer.from(`${LINUX_PROFILE_MARKER_BLOCK}\n`);

/** @returns {FiniteFailure} */
const finiteFailure = (/** @type {string} */ operationContract, /** @type {string} */ code, /** @type {unknown} */ evidence, /** @type {string} */ message) => ({
    code,
    evidence,
    message,
    operationContract,
    status: 'failed',
});

const finiteEntryType = (/** @type {import("fs").Stats} */ stats) => stats.isSymbolicLink()
    ? 'symbolic-link'
    : stats.isFile()
        ? 'ordinary-file'
        : stats.isDirectory()
            ? 'directory'
            : 'special';

const finiteTarget = (/** @type {string} */ auditedDirectory, /** @type {unknown} */ relativePath) => {
    if (typeof relativePath !== 'string' || !isSafeReleaseRelativePath(relativePath)) throw new Error('Release finite operation path is unsafe.');
    const root = resolve(auditedDirectory);
    const bounded = resolveRelativePathWithinScope({path: relativePath, scope: root});
    if (bounded.status !== 'succeeded') throw new Error('Release finite operation path escaped the audited directory.');
    return bounded.absolutePath;
};

const finiteEvidencePath = (/** @type {string} */ root, /** @type {string} */ path) => {
    const bounded = resolveAbsolutePathWithinScope({path, scope: root});
    if (bounded.status !== 'succeeded') throw new Error('Release finite operation evidence path escaped the audited directory.');
    return bounded.relativePath.length === 0 ? '.' : bounded.relativePath.split(sep).join('/');
};

const finiteMutationTarget = async (/** @type {{auditedDirectory: string, fileSystem: FiniteFileSystem, operationContract: string, relativePath: string}} */ {auditedDirectory, fileSystem, operationContract, relativePath}) => {
    const target = finiteTarget(auditedDirectory, relativePath);
    const root = resolve(auditedDirectory);
    const parents = [root];
    let current = root;
    for (const part of relativePath.split('/').slice(0, -1)) {
        current = resolve(current, part);
        parents.push(current);
    }
    for (const parent of parents) {
        let stats;
        try {
            stats = await fileSystem.lstat(parent);
        } catch {
            return {
                failure: finiteFailure(operationContract, 'unsafe-parent', {path: finiteEvidencePath(root, parent)}, 'A finite operation parent could not be verified.'),
                target,
            };
        }
        if (!stats.isDirectory() || stats.isSymbolicLink()) {
            return {
                failure: finiteFailure(operationContract, 'unsafe-parent', {
                    entryType: finiteEntryType(stats),
                    path: finiteEvidencePath(root, parent),
                }, 'A finite operation parent is not an ordinary directory.'),
                target,
            };
        }
    }
    return {failure: null, target};
};

const missingFile = (/** @type {unknown} */ error) => error instanceof Error && 'code' in error && error.code === 'ENOENT';

const executePreparePreservedConfiguration = async (/** @type {{auditedDirectory: string, fileSystem: FiniteFileSystem, operationContract: string, operationParameters: unknown}} */ {auditedDirectory, fileSystem, operationContract, operationParameters}) => {
    if (!finiteExactKeys(operationParameters, ['editorCommand'])
        || operationParameters.editorCommand !== 'release-validation-editor') {
        throw new Error('Release finite operation parameters are invalid.');
    }
    const bounded = await finiteMutationTarget({auditedDirectory, fileSystem, operationContract, relativePath: FINITE_CONFIG_PATH});
    if (bounded.failure !== null) return bounded.failure;
    const {target} = bounded;
    let stats;
    try {
        stats = await fileSystem.lstat(target);
    } catch (error) {
        if (missingFile(error)) return finiteFailure(operationContract, 'config-missing', {path: FINITE_CONFIG_PATH}, 'The preserved configuration file is missing.');
        return finiteFailure(operationContract, 'final-read-failed', {path: FINITE_CONFIG_PATH}, 'The preserved configuration file could not be read.');
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
        return finiteFailure(operationContract, 'config-not-ordinary', {
            entryType: finiteEntryType(stats),
            path: FINITE_CONFIG_PATH,
        }, 'The preserved configuration path is not an ordinary file.');
    }
    let beforeConfig;
    try {
        beforeConfig = JSON.parse(await fileSystem.readFile(target, 'utf8'));
    } catch {
        return finiteFailure(operationContract, 'config-invalid-json', {path: FINITE_CONFIG_PATH}, 'The preserved configuration is not valid JSON.');
    }
    if (!finiteExactKeys(beforeConfig.editor, Object.keys(beforeConfig.editor ?? {}))
        || beforeConfig.editor === null
        || Array.isArray(beforeConfig.editor)) {
        return finiteFailure(operationContract, 'editor-not-object', {path: FINITE_CONFIG_PATH}, 'The preserved configuration editor field is not an object.');
    }
    const afterConfig = JSON.parse(JSON.stringify(beforeConfig));
    afterConfig.editor.command = operationParameters.editorCommand;
    try {
        await fileSystem.writeFile(target, `${JSON.stringify(afterConfig, null, 2)}\n`, 'utf8');
    } catch {
        return finiteFailure(operationContract, 'write-failed', {path: FINITE_CONFIG_PATH}, 'The preserved configuration could not be written.');
    }
    try {
        const finalConfig = JSON.parse(await fileSystem.readFile(target, 'utf8'));
        if (JSON.stringify(finalConfig) !== JSON.stringify(afterConfig)) throw new Error('Final bytes differ.');
    } catch {
        return finiteFailure(operationContract, 'final-read-failed', {path: FINITE_CONFIG_PATH}, 'The written preserved configuration could not be verified.');
    }
    return {
        actual: {afterConfig, beforeConfig, path: FINITE_CONFIG_PATH},
        operationContract,
        status: 'completed',
    };
};

const executeAddUnknownContent = async (/** @type {{auditedDirectory: string, fileSystem: FiniteFileSystem, operationContract: string, operationParameters: unknown}} */ {auditedDirectory, fileSystem, operationContract, operationParameters}) => {
    if (!finiteExactKeys(operationParameters, [])) throw new Error('Release finite operation parameters are invalid.');
    const bounded = await finiteMutationTarget({auditedDirectory, fileSystem, operationContract, relativePath: FINITE_UNKNOWN_PATH});
    if (bounded.failure !== null) return bounded.failure;
    const {target} = bounded;
    try {
        const stats = await fileSystem.lstat(target);
        return finiteFailure(operationContract, 'target-exists', {
            entryType: finiteEntryType(stats),
            path: FINITE_UNKNOWN_PATH,
        }, 'The test residue target already exists.');
    } catch (error) {
        if (!missingFile(error)) {
            return finiteFailure(operationContract, 'exclusive-write-failed', {path: FINITE_UNKNOWN_PATH}, 'The test residue target could not be checked.');
        }
    }
    try {
        await fileSystem.writeFile(target, FINITE_UNKNOWN_BYTES, {flag: 'wx'});
    } catch {
        return finiteFailure(operationContract, 'exclusive-write-failed', {path: FINITE_UNKNOWN_PATH}, 'The test residue could not be created exclusively.');
    }
    let bytes;
    try {
        const stats = await fileSystem.lstat(target);
        if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Final entry is not ordinary.');
        bytes = await fileSystem.readFile(target);
    } catch {
        return finiteFailure(operationContract, 'final-read-failed', {path: FINITE_UNKNOWN_PATH}, 'The created test residue could not be verified.');
    }
    return {
        actual: {bytesBase64: bytes.toString('base64'), path: FINITE_UNKNOWN_PATH},
        operationContract,
        status: 'completed',
    };
};

/** @returns {sourceRecord is {operationContract: string, status: string, actual: {path: string, bytesBase64: string}}} */
const validUnknownSourceRecord = (/** @type {unknown} */ sourceRecord) => finiteExactKeys(sourceRecord, ['actual', 'operationContract', 'status'])
    && sourceRecord.operationContract === 'add-unknown-content'
    && sourceRecord.status === 'completed'
    && finiteExactKeys(sourceRecord.actual, ['bytesBase64', 'path'])
    && sourceRecord.actual.path === FINITE_UNKNOWN_PATH
    && sourceRecord.actual.bytesBase64 === FINITE_UNKNOWN_BYTES.toString('base64');

const executeRemoveTestResidue = async (/** @type {{auditedDirectory: string, fileSystem: FiniteFileSystem, operationContract: string, operationParameters: unknown, sourceRecord: unknown}} */ {auditedDirectory, fileSystem, operationContract, operationParameters, sourceRecord}) => {
    if (!finiteExactKeys(operationParameters, [])) throw new Error('Release finite operation parameters are invalid.');
    if (sourceRecord === null) {
        return finiteFailure(operationContract, 'source-record-missing', {path: FINITE_UNKNOWN_PATH}, 'The successful test residue source record is missing.');
    }
    if (!validUnknownSourceRecord(sourceRecord)) throw new Error('Release finite operation source record is invalid.');
    const bounded = await finiteMutationTarget({auditedDirectory, fileSystem, operationContract, relativePath: FINITE_UNKNOWN_PATH});
    if (bounded.failure !== null) return bounded.failure;
    const {target} = bounded;
    let stats;
    try {
        stats = await fileSystem.lstat(target);
    } catch (error) {
        if (missingFile(error)) return finiteFailure(operationContract, 'target-missing', {path: FINITE_UNKNOWN_PATH}, 'The registered test residue target is missing.');
        return finiteFailure(operationContract, 'final-read-failed', {path: FINITE_UNKNOWN_PATH}, 'The registered test residue target could not be read.');
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
        return finiteFailure(operationContract, 'target-not-ordinary', {
            entryType: finiteEntryType(stats),
            path: FINITE_UNKNOWN_PATH,
        }, 'The registered test residue target is not an ordinary file.');
    }
    let bytes;
    try {
        bytes = await fileSystem.readFile(target);
    } catch {
        return finiteFailure(operationContract, 'final-read-failed', {path: FINITE_UNKNOWN_PATH}, 'The registered test residue bytes could not be read.');
    }
    if (!bytes.equals(FINITE_UNKNOWN_BYTES)) {
        return finiteFailure(operationContract, 'content-changed', {path: FINITE_UNKNOWN_PATH}, 'The registered test residue bytes changed before removal.');
    }
    try {
        await fileSystem.unlink(target);
    } catch {
        return finiteFailure(operationContract, 'unlink-failed', {path: FINITE_UNKNOWN_PATH}, 'The registered test residue could not be removed.');
    }
    try {
        await fileSystem.lstat(target);
        return finiteFailure(operationContract, 'final-read-failed', {path: FINITE_UNKNOWN_PATH}, 'The removed test residue is still present.');
    } catch (error) {
        if (!missingFile(error)) {
            return finiteFailure(operationContract, 'final-read-failed', {path: FINITE_UNKNOWN_PATH}, 'The removed test residue state could not be verified.');
        }
    }
    const parentCheck = await finiteMutationTarget({
        auditedDirectory,
        fileSystem,
        operationContract,
        relativePath: FINITE_UNKNOWN_PATH,
    });
    if (parentCheck.failure !== null) return parentCheck.failure;
    const installationDirectory = dirname(target);
    let remaining;
    try {
        remaining = await fileSystem.readdir(installationDirectory);
    } catch {
        return finiteFailure(operationContract, 'parent-cleanup-failed', {
            path: '.agent-repository-workflow',
        }, 'The test residue parent directory could not be inspected.');
    }
    if (remaining.length === 0) {
        try {
            await fileSystem.rmdir(installationDirectory);
        } catch {
            return finiteFailure(operationContract, 'parent-cleanup-failed', {
                path: '.agent-repository-workflow',
            }, 'The empty test residue parent directory could not be removed.');
        }
    }
    return {
        actual: {
            existsAfter: false,
            path: FINITE_UNKNOWN_PATH,
            removedBytesBase64: bytes.toString('base64'),
        },
        operationContract,
        status: 'completed',
    };
};

/** @returns {Promise<{status: 'absent'} | {entryType: string, status: 'not-ordinary'} | {bytes: Buffer, status: 'present'}>} */
const optionalOrdinaryBytes = async (/** @type {string} */ path, /** @type {FiniteFileSystem} */ fileSystem) => {
    try {
        const stats = await fileSystem.lstat(path);
        if (!stats.isFile() || stats.isSymbolicLink()) return {entryType: finiteEntryType(stats), status: 'not-ordinary'};
        return {bytes: await fileSystem.readFile(path), status: 'present'};
    } catch (error) {
        if (missingFile(error)) return {status: 'absent'};
        throw error;
    }
};

const installationStateBooleans = async (/** @type {string} */ auditedDirectory, /** @type {FiniteFileSystem} */ fileSystem) => {
    const installationDirectory = finiteTarget(auditedDirectory, '.agent-repository-workflow');
    let entries;
    try {
        const stats = await fileSystem.lstat(installationDirectory);
        if (!stats.isDirectory() || stats.isSymbolicLink()) {
            throw new Error('The installation path is not an ordinary directory.');
        }
        entries = await fileSystem.readdir(installationDirectory);
    } catch (error) {
        if (!missingFile(error)) throw error;
        return {
            configurationExists: false,
            installationDirectoryExists: false,
            managedFilesExist: false,
            testResidueExists: false,
        };
    }
    const configurationExists = (await optionalOrdinaryBytes(join(installationDirectory, 'config.json'), fileSystem)).status === 'present';
    const testResidueExists = (await optionalOrdinaryBytes(join(installationDirectory, 'release-validation-unknown.txt'), fileSystem)).status !== 'absent';
    let managedFilesExist = false;
    for (const entry of entries) {
        if (['config.json', 'release-validation-unknown.txt'].includes(entry)) continue;
        if (entry === 'background-agent-state') {
            const stateDirectory = join(installationDirectory, entry);
            const stats = await fileSystem.lstat(stateDirectory);
            if (stats.isDirectory() && !stats.isSymbolicLink()
                && (await fileSystem.readdir(stateDirectory)).length === 0) continue;
        }
        managedFilesExist = true;
    }
    return {configurationExists, installationDirectoryExists: true, managedFilesExist, testResidueExists};
};

const observeProfile = async (/** @type {{auditedDirectory: string, fileSystem: FiniteFileSystem, operationContract: string, runProcess: ProcessRunner}} */ {auditedDirectory, fileSystem, operationContract, runProcess}) => {
    const profilePath = join(resolve(auditedDirectory), '.profile');
    let observed;
    try {
        observed = await optionalOrdinaryBytes(profilePath, fileSystem);
    } catch {
        return finiteFailure(operationContract, 'observation-failed', {observation: 'profile'}, 'The shell profile could not be observed.');
    }
    if (observed.status === 'not-ordinary') {
        return finiteFailure(operationContract, 'profile-not-ordinary', {
            entryType: observed.entryType,
            path: '.profile',
        }, 'The shell profile is not an ordinary file.');
    }
    if (observed.status === 'absent') return {bytesBase64: null, exists: false};
    const syntax = await runProcess('/bin/sh', ['-n', profilePath], {cwd: auditedDirectory});
    if (syntax.exitCode !== 0) {
        return finiteFailure(operationContract, 'shell-check-failed', {shell: 'login-shell'}, 'The shell profile syntax check failed.');
    }
    return {bytesBase64: observed.bytes.toString('base64'), exists: true};
};

const observeWindowsPath = async (/** @type {{auditedDirectory: string, fileSystem: FiniteFileSystem, operationContract: string}} */ {auditedDirectory, fileSystem, operationContract}) => {
    let observed;
    try {
        observed = await optionalOrdinaryBytes(join(resolve(auditedDirectory), 'windows-user-path.json'), fileSystem);
    } catch {
        return finiteFailure(operationContract, 'observation-failed', {observation: 'windows-path'}, 'The Windows Path observation could not be read.');
    }
    if (observed.status !== 'present') {
        return finiteFailure(operationContract, 'observation-failed', {observation: 'windows-path'}, 'The Windows Path observation could not be read.');
    }
    let value;
    try {
        value = JSON.parse(observed.bytes.toString('utf8'));
    } catch {
        return finiteFailure(operationContract, 'observation-failed', {observation: 'windows-path'}, 'The Windows Path observation could not be read.');
    }
    if (!finiteExactKeys(value, ['effectiveEntries', 'exists', 'kind', 'value'])
        || typeof value.exists !== 'boolean'
        || !Array.isArray(value.effectiveEntries)
        || value.effectiveEntries.some(entry => typeof entry !== 'string')
        || value.exists && (typeof value.kind !== 'string' || !['String', 'ExpandString'].includes(value.kind))
        || value.exists && typeof value.value !== 'string'
        || !value.exists && (value.kind !== null || value.value !== '')) {
        return finiteFailure(operationContract, 'unsupported-path-kind', {kind: value?.kind ?? null}, 'The Windows Path observation is invalid.');
    }
    return value;
};

const observeLauncher = async (/** @type {{auditedDirectory: string, machineKey: string, runProcess: ProcessRunner}} */ {auditedDirectory, machineKey, runProcess}) => {
    if (machineKey === 'Windows 11') {
        const outcome = await runProcess('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'if (Get-Command arw -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }',
        ], {env: installationEnvironment({homeDirectory: auditedDirectory})});
        if (![0, 1].includes(outcome.exitCode)) return null;
        return outcome.exitCode === 0;
    }
    const outcome = await runProcess('/bin/sh', ['-l', '-c', 'command -v arw >/dev/null 2>&1'], {
        cwd: auditedDirectory,
        env: installationEnvironment({homeDirectory: auditedDirectory}),
    });
    if (![0, 1, 127].includes(outcome.exitCode)) return null;
    return outcome.exitCode === 0;
};

const validateBaselineObservation = (/** @type {unknown} */ baseline, /** @type {string} */ machineKey) => finiteExactKeys(baseline, [
    'configurationExists',
    'installationDirectoryExists',
    'managedFilesExist',
    'profile',
    'testResidueExists',
    'windowsPath',
]) && [baseline.configurationExists, baseline.installationDirectoryExists, baseline.managedFilesExist, baseline.testResidueExists]
    .every(value => typeof value === 'boolean')
    && (machineKey === 'Windows 11'
        ? baseline.profile === null && baseline.windowsPath !== null
        : baseline.windowsPath === null && baseline.profile !== null);

const executeObserveInstallationFinalState = async (/** @type {{auditedDirectory: string, baseline: unknown, fileSystem: FiniteFileSystem, machineKey: string, operationContract: string, operationParameters: unknown, runProcess: ProcessRunner}} */ {
    auditedDirectory,
    baseline,
    fileSystem,
    machineKey,
    operationContract,
    operationParameters,
    runProcess,
}) => {
    if (!finiteExactKeys(operationParameters, [])
        || !['Windows 11', 'Ubuntu', 'Alpine'].includes(machineKey)
        || !validateBaselineObservation(baseline, machineKey)) {
        throw new Error('Release final-state operation input is invalid.');
    }
    let booleans;
    try {
        booleans = await installationStateBooleans(auditedDirectory, fileSystem);
    } catch {
        return finiteFailure(operationContract, 'observation-failed', {observation: 'installation'}, 'The installation final state could not be observed.');
    }
    const platformObservation = machineKey === 'Windows 11'
        ? await observeWindowsPath({auditedDirectory, fileSystem, operationContract})
        : await observeProfile({auditedDirectory, fileSystem, operationContract, runProcess});
    if ('status' in platformObservation && platformObservation.status === 'failed') return platformObservation;
    const launcherResolved = await observeLauncher({auditedDirectory, machineKey, runProcess});
    if (launcherResolved === null) {
        return finiteFailure(operationContract, 'shell-check-failed', {
            shell: machineKey === 'Windows 11' ? 'powershell' : 'login-shell',
        }, 'The launcher lookup shell failed.');
    }
    const final = {
        ...booleans,
        launcherResolved,
        profile: machineKey === 'Windows 11' ? null : platformObservation,
        windowsPath: machineKey === 'Windows 11' ? platformObservation : null,
    };
    return {
        actual: {baseline, final},
        operationContract,
        status: 'completed',
    };
};

const captureInstallationFinalBaseline = async (/** @type {{auditedDirectory: string, fileSystem: FiniteFileSystem, machineKey: string, runProcess: ProcessRunner}} */ {auditedDirectory, fileSystem, machineKey, runProcess}) => {
    const booleans = await installationStateBooleans(auditedDirectory, fileSystem);
    const operationContract = 'observe-installation-final-state';
    const platformObservation = machineKey === 'Windows 11'
        ? await observeWindowsPath({auditedDirectory, fileSystem, operationContract})
        : await observeProfile({auditedDirectory, fileSystem, operationContract, runProcess});
    if ('status' in platformObservation && platformObservation.status === 'failed') {
        throw new Error(typeof platformObservation.message === 'string' ? platformObservation.message : 'Platform observation failed.');
    }
    return {
        ...booleans,
        profile: machineKey === 'Windows 11' ? null : platformObservation,
        windowsPath: machineKey === 'Windows 11' ? platformObservation : null,
    };
};

/**
 * 执行一个 Registry 登记的 finite guest operation, 返回闭合 actual 或可绑定 failure, 不填写 judgment.
 */
export const executeReleaseFiniteOperation = async (/** @type {{auditedDirectory: string, baseline?: unknown, machineKey?: string | null, operationContract: string, operationParameters: unknown, sourceRecord: unknown}} */ {
    auditedDirectory,
    baseline = null,
    machineKey = null,
    operationContract,
    operationParameters,
    sourceRecord,
}, /** @type {{fileSystem?: FiniteFileSystem, runProcess?: ProcessRunner}} */ {fileSystem = finiteFileSystem, runProcess = run} = {}) => {
    if (typeof auditedDirectory !== 'string'
        || ![
            'prepare-preserved-configuration',
            'add-unknown-content',
            'remove-test-residue',
            'observe-installation-final-state',
        ].includes(operationContract)
        || sourceRecord === undefined) {
        throw new Error('Release finite operation input is invalid.');
    }
    const request = {auditedDirectory, fileSystem, operationContract, operationParameters, runProcess, sourceRecord};
    if (operationContract === 'prepare-preserved-configuration') return executePreparePreservedConfiguration(request);
    if (operationContract === 'add-unknown-content') return executeAddUnknownContent(request);
    if (operationContract === 'remove-test-residue') return executeRemoveTestResidue(request);
    if (typeof machineKey !== 'string') throw new Error('Release final-state operation machine is invalid.');
    return executeObserveInstallationFinalState({...request, baseline, machineKey});
};

/** @returns {GuestRequest} */
const parseArguments = (/** @type {string[]} */ args) => {
    const expected = ['--machine', '--scenario', '--step', '--workspace'];
    if (![8, 10, 12, 14, 16, 18].includes(args.length)) throw new Error('Release guest helper arguments are invalid.');
    /** @type {Record<string, string>} */
    const values = {};
    for (let index = 0; index < args.length; index += 2) {
        if (![...expected, '--capture-id', '--choices', '--observe-only', '--prepare-only', '--scenario-prepared'].includes(args[index])
            || Object.hasOwn(values, args[index])
            || args[index + 1]?.length === 0) {
            throw new Error('Release guest helper arguments are invalid.');
        }
        values[args[index]] = args[index + 1];
    }
    if (expected.some(name => !Object.hasOwn(values, name))) throw new Error('Release guest helper arguments are invalid.');
    const observeOnly = values['--observe-only'] === 'true';
    const prepareOnly = values['--prepare-only'] === 'true';
    const scenarioPrepared = values['--scenario-prepared'] === 'true';
    if (observeOnly !== Object.hasOwn(values, '--capture-id')
        || Object.hasOwn(values, '--observe-only') && !observeOnly
        || Object.hasOwn(values, '--prepare-only') && !prepareOnly
        || Object.hasOwn(values, '--scenario-prepared') && !scenarioPrepared
        || prepareOnly && (observeOnly || scenarioPrepared)
        || observeOnly && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(values['--capture-id'])) {
        throw new Error('Release guest helper observation arguments are invalid.');
    }
    let choices = null;
    if (Object.hasOwn(values, '--choices')) {
        try {
            choices = JSON.parse(values['--choices']);
        } catch {
            throw new Error('Release guest helper frozen choices are invalid.');
        }
        if (choices === null || typeof choices !== 'object' || Array.isArray(choices)) {
            throw new Error('Release guest helper frozen choices are invalid.');
        }
    }
    return {
        captureId: observeOnly ? values['--capture-id'] : null,
        choices,
        machineKey: values['--machine'],
        observeOnly,
        prepareOnly,
        scenarioPrepared,
        scenarioId: values['--scenario'],
        stepId: values['--step'],
        workspaceDirectory: resolve(values['--workspace']),
    };
};

/** @type {ProcessRunner} */
const run = async (file, args, options = {}) => {
    try {
        const result = await execFile(file, args, {
            cwd: options.cwd,
            encoding: 'utf8',
            env: options.env,
            maxBuffer: 64 * 1024 * 1024,
            windowsVerbatimArguments: options.windowsVerbatimArguments ?? false,
            windowsHide: true,
        });
        return {exitCode: 0, stderr: result.stderr, stdout: result.stdout};
    } catch (error) {
        if (error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'number' && Number.isSafeInteger(error.code)) {
            return {
                exitCode: error.code,
                stderr: 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '',
                stdout: 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : '',
            };
        }
        throw error;
    }
};

const runGit = async (/** @type {string} */ directory, /** @type {string[]} */ args) => run('git', ['-C', directory, ...args]);
const runWindowsBatchVersion = (/** @type {string} */ file, /** @type {ProcessOptions} */ options = {}) => run(
    process.env.ComSpec ?? 'cmd.exe',
    ['/d', '/s', '/c', 'call "%ARW_RELEASE_BATCH_FILE%" --version'],
    {
        ...options,
        env: {
            ...(options.env ?? process.env),
            ARW_RELEASE_BATCH_FILE: file,
        },
        windowsVerbatimArguments: true,
    },
);
const requireSuccess = (/** @type {ProcessOutcome} */ outcome, /** @type {string} */ label) => {
    if (outcome.exitCode !== 0) throw new Error(`${label} failed: ${outcome.stderr.trim() || `exit ${outcome.exitCode}`}`);
    return outcome.stdout;
};

/**
 * Resolve the independent target workflow profile and transferred Repository bundle for a registered scenario.
 * @returns {{bundleName: 'agentAssisted.bundle' | 'plain.bundle' | null, targetKind: 'agent-assisted' | 'plain' | null}}
 */
export const resolveReleaseScenarioTarget = (/** @type {string} */ scenarioId) => {
    const registered = resolveReleaseValidationScenario(scenarioId);
    const {targetKind} = registered;
    if (targetKind === null) return {bundleName: null, targetKind: null};
    const plainBundle = registered.prerequisites.includes('plain-target-bundle');
    const agentAssistedBundle = registered.prerequisites.includes('agent-assisted-target-bundle');
    if (plainBundle === agentAssistedBundle) throw new Error('Release scenario target bundle prerequisite is invalid.');
    return {
        bundleName: plainBundle ? 'plain.bundle' : 'agentAssisted.bundle',
        targetKind,
    };
};

/**
 * 保证 audited directory 是 Git Repository, 并用 `git add -A` 建立统一 index baseline.
 * Success 后不存在 unstaged 或 untracked bytes; staged changes 可以继续相对 `HEAD` 保留.
 */
export const initializeGitBaseline = async (/** @type {string} */ directory) => {
    await mkdir(directory, {recursive: true});
    const present = await runGit(directory, ['rev-parse', '--git-dir']);
    const initialized = present.exitCode !== 0;
    if (initialized) {
        requireSuccess(await runGit(directory, ['init', '--quiet']), 'Guest audit Repository initialization');
    } else {
        requireSuccess(await runGit(directory, ['diff', '--quiet']), 'Guest unstaged baseline verification');
        const untracked = requireSuccess(
            await runGit(directory, ['ls-files', '--others', '--exclude-standard']),
            'Guest untracked baseline verification',
        );
        if (untracked.length !== 0) throw new Error('Guest Git baseline retains untracked files.');
    }
    requireSuccess(await runGit(directory, ['add', '-A']), 'Guest initial Git baseline');
    return initialized;
};

const syncWindowsPathObservation = async (/** @type {{homeDirectory: string}} */ state) => {
    const script = `$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment'); `
        + `$exists = $null -ne $key -and $null -ne $key.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); `
        + `$value = if ($exists) { [string]$key.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null }; `
        + `$kind = if ($exists) { [string]$key.GetValueKind('Path') } else { $null }; `
        + `$storedValue = if ($exists) { $value } else { '' }; `
        + `$effective = [Environment]::ExpandEnvironmentVariables((@([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User')) | Where-Object { $_ }) -join ';') -split ';'; `
        + `[ordered]@{effectiveEntries=@($effective);exists=$exists;kind=$kind;value=$storedValue} | ConvertTo-Json -Compress`;
    const outcome = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    requireSuccess(outcome, 'Windows user Path observation');
    await writeFile(join(state.homeDirectory, 'windows-user-path.json'), `${outcome.stdout.trim()}\n`, 'utf8');
};

const diffBase = async (/** @type {string} */ directory) => {
    const head = await runGit(directory, ['rev-parse', '--verify', 'HEAD^{tree}']);
    if (head.exitCode === 0) return 'HEAD';
    const gitPath = requireSuccess(
        await runGit(directory, ['rev-parse', '--git-path', 'arw-release-empty-tree-input']),
        'Guest Git path resolution',
    ).trim();
    const emptyTreeInput = resolve(directory, gitPath);
    await writeFile(emptyTreeInput, '');
    return requireSuccess(
        await run('git', ['-C', directory, 'hash-object', '-t', 'tree', emptyTreeInput]),
        'Guest empty tree resolution',
    ).trim();
};

const resolveBundleCommit = async (/** @type {string} */ bundle) => {
    const output = requireSuccess(
        await run('git', ['bundle', 'list-heads', bundle, 'refs/heads/arw-validation']),
        'Guest bundle identity resolution',
    ).trim();
    const match = /^([0-9a-f]{40}|[0-9a-f]{64}) refs\/heads\/arw-validation$/u.exec(output);
    if (match === null) throw new Error('Guest bundle does not contain the expected validation ref.');
    return match[1];
};

/**
 * 从 bundle clone missing checkout, 或验证 reused checkout 的 `HEAD` 准确匹配 bundle validation ref.
 * `requireClean` 另外拒绝 candidate Source Checkout 的 tracked 或 untracked drift.
 */
export const cloneBundle = async (/** @type {string} */ bundle, /** @type {string} */ directory, /** @type {{requireClean?: boolean}} */ {requireClean = false} = {}) => {
    const expectedCommit = await resolveBundleCommit(bundle);
    const present = await runGit(directory, ['rev-parse', '--git-dir']);
    if (present.exitCode !== 0) {
        await mkdir(directory, {recursive: true});
        requireSuccess(await run('git', [
            'clone', '--quiet',
            '-c', 'core.longpaths=true', '-c', 'core.autocrlf=false',
            '--branch', 'arw-validation', bundle, directory,
        ]), 'Guest bundle clone');
    }
    const actualCommit = requireSuccess(
        await runGit(directory, ['rev-parse', '--verify', 'HEAD^{commit}']),
        'Guest checkout identity resolution',
    ).trim();
    if (actualCommit !== expectedCommit) throw new Error('Guest checkout does not identify the transferred bundle commit.');
    if (requireClean) {
        const status = requireSuccess(
            await runGit(directory, ['status', '--porcelain=v1', '--untracked-files=all']),
            'Guest source checkout status',
        );
        if (status.length !== 0) throw new Error('Guest source checkout is not clean.');
    }
    return actualCommit;
};

/** @returns {Promise<ScenarioState>} */
const prepareScenario = async (
    /** @type {GuestRequest} */ request,
    /** @type {{stepIndex: number, versionFixturesRequired: boolean}} */ {stepIndex, versionFixturesRequired},
) => {
    const scenarioRoot = request.workspaceDirectory;
    const sourceDirectory = join(scenarioRoot, 'source');
    const scenarioTarget = resolveReleaseScenarioTarget(request.scenarioId);
    const targetKind = scenarioTarget.targetKind;
    const targetDirectory = join(scenarioRoot, 'target');
    const homeDirectory = join(scenarioRoot, 'home');
    if (request.observeOnly) {
        const commit = requireSuccess(
            await runGit(sourceDirectory, ['rev-parse', '--verify', 'HEAD^{commit}']),
            'Guest observed candidate identity resolution',
        ).trim();
        const tag = parsePackageIdentity(await readFile(join(sourceDirectory, 'package.json')), 'package.json').version;
        return {
            commit,
            fixturesDirectory: join(scenarioRoot, 'version-fixtures'),
            homeDirectory,
            installationAuditDirectory: homeDirectory,
            scenarioRoot,
            sourceDirectory,
            tag,
            targetDirectory,
            targetKind,
        };
    }
    const commit = await cloneBundle(join(request.workspaceDirectory, 'candidate.bundle'), sourceDirectory, {requireClean: true});
    const tag = parsePackageIdentity(await readFile(join(sourceDirectory, 'package.json')), 'package.json').version;
    const tagResult = await runGit(sourceDirectory, ['tag', '--list', tag]);
    const tagPresent = tagResult.stdout.trim().length > 0;
    const existingTagCommit = tagPresent
        ? requireSuccess(
            await runGit(sourceDirectory, ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]),
            'Guest candidate tag resolution',
        ).trim()
        : null;
    const tagAction = resolveReleaseGuestTagAction({candidateCommit: commit, existingTagCommit, stepIndex});
    if (tagAction === 'create') {
        requireSuccess(await runGit(sourceDirectory, ['tag', tag, commit]), 'Guest candidate tag creation');
    }
    const fixturesDirectory = join(scenarioRoot, 'version-fixtures');
    if (versionFixturesRequired) {
        try {
            await lstat(fixturesDirectory);
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
            requireSuccess(await run(process.execPath, [
                join(sourceDirectory, 'scripts', 'prepare-release-version-fixtures.mjs'),
                '--source', sourceDirectory,
                '--output', fixturesDirectory,
            ], {cwd: scenarioRoot}), 'Guest release fixture preparation');
        }
    }
    await mkdir(homeDirectory, {recursive: true});
    if (targetKind !== null) {
        if (scenarioTarget.bundleName === null) throw new Error('Release scenario target bundle is unavailable.');
        await cloneBundle(join(request.workspaceDirectory, scenarioTarget.bundleName), targetDirectory);
    }
    const installationAuditDirectory = homeDirectory;
    const homeAlreadyInitialized = (await runGit(installationAuditDirectory, ['rev-parse', '--git-dir'])).exitCode === 0;
    if (request.machineKey === 'Windows 11' && !homeAlreadyInitialized) await syncWindowsPathObservation({homeDirectory});
    await initializeGitBaseline(installationAuditDirectory);
    if (targetKind !== null) await initializeGitBaseline(targetDirectory);
    if (stepIndex === 0) {
        const baselinePath = join(scenarioRoot, 'runner-state', 'final-state-baseline.json');
        await mkdir(dirname(baselinePath), {recursive: true});
        try {
            await lstat(baselinePath);
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
            const baseline = await captureInstallationFinalBaseline({
                auditedDirectory: installationAuditDirectory,
                fileSystem: finiteFileSystem,
                machineKey: request.machineKey,
                runProcess: run,
            });
            await writeFile(baselinePath, `${JSON.stringify(baseline)}\n`, {flag: 'wx'});
        }
    }
    return {commit, fixturesDirectory, homeDirectory, installationAuditDirectory, scenarioRoot, sourceDirectory, tag, targetDirectory, targetKind};
};

const preparedScenarioPath = (/** @type {string} */ workspaceDirectory) => join(workspaceDirectory, 'runner-state', 'scenario-preparation.json');

const savePreparedScenario = async (/** @type {GuestRequest} */ request, /** @type {ScenarioState} */ state) => {
    const path = preparedScenarioPath(request.workspaceDirectory);
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, `${JSON.stringify({
        commit: state.commit,
        fixturesDirectory: state.fixturesDirectory,
        homeDirectory: state.homeDirectory,
        installationAuditDirectory: state.installationAuditDirectory,
        machineKey: request.machineKey,
        scenarioId: request.scenarioId,
        scenarioRoot: state.scenarioRoot,
        schemaVersion: 2,
        sourceDirectory: state.sourceDirectory,
        tag: state.tag,
        targetDirectory: state.targetDirectory,
        targetKind: state.targetKind,
    })}\n`, {flag: 'wx'});
};

/** @returns {ScenarioState} */
export const validateReleasePreparedScenario = (/** @type {{prepared: unknown, request: GuestRequest}} */ {prepared, request}) => {
    const {targetKind} = resolveReleaseValidationScenario(request.scenarioId);
    const expected = {
        fixturesDirectory: join(request.workspaceDirectory, 'version-fixtures'),
        homeDirectory: join(request.workspaceDirectory, 'home'),
        installationAuditDirectory: join(request.workspaceDirectory, 'home'),
        scenarioRoot: request.workspaceDirectory,
        sourceDirectory: join(request.workspaceDirectory, 'source'),
        targetDirectory: join(request.workspaceDirectory, 'target'),
        targetKind,
    };
    if (!finiteExactKeys(prepared, [
        'commit',
        'fixturesDirectory',
        'homeDirectory',
        'installationAuditDirectory',
        'machineKey',
        'scenarioId',
        'scenarioRoot',
        'schemaVersion',
        'sourceDirectory',
        'tag',
        'targetDirectory',
        'targetKind',
    ])
        || prepared.schemaVersion !== 2
        || prepared.machineKey !== request.machineKey
        || prepared.scenarioId !== request.scenarioId
        || typeof prepared.commit !== 'string'
        || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(prepared.commit)
        || typeof prepared.tag !== 'string'
        || prepared.tag.length === 0
        || typeof prepared.fixturesDirectory !== 'string'
        || typeof prepared.homeDirectory !== 'string'
        || typeof prepared.installationAuditDirectory !== 'string'
        || typeof prepared.scenarioRoot !== 'string'
        || typeof prepared.sourceDirectory !== 'string'
        || typeof prepared.targetDirectory !== 'string'
        || (prepared.targetKind !== null && typeof prepared.targetKind !== 'string')
        || Object.entries(expected).some(([key, value]) => prepared[key] !== value)) {
        throw new Error('Release guest prepared scenario state is invalid.');
    }
    return {
        commit: prepared.commit,
        fixturesDirectory: prepared.fixturesDirectory,
        homeDirectory: prepared.homeDirectory,
        installationAuditDirectory: prepared.installationAuditDirectory,
        scenarioRoot: prepared.scenarioRoot,
        sourceDirectory: prepared.sourceDirectory,
        tag: prepared.tag,
        targetDirectory: prepared.targetDirectory,
        targetKind: prepared.targetKind,
    };
};

const readPreparedScenario = async (/** @type {GuestRequest} */ request) => {
    let prepared;
    try {
        prepared = JSON.parse(await readFile(preparedScenarioPath(request.workspaceDirectory), 'utf8'));
    } catch {
        throw new Error('Release guest prepared scenario state is unavailable.');
    }
    return validateReleasePreparedScenario({prepared, request});
};

const withRuntimeFirst = (/** @type {NodeJS.ProcessEnv} */ environment) => {
    const result = Object.fromEntries(Object.entries(environment)
        .filter(([key]) => key.toLowerCase() !== 'path'));
    result[process.platform === 'win32' ? 'Path' : 'PATH'] = [
        dirname(process.execPath),
        environment.Path ?? environment.PATH ?? '',
    ].filter(Boolean).join(process.platform === 'win32' ? ';' : ':');
    return result;
};

const installationEnvironment = (/** @type {{homeDirectory: string}} */ state) => {
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'CODEX_HOME'));
    return withRuntimeFirst(process.platform === 'win32'
        ? {...environment, USERPROFILE: state.homeDirectory}
        : {...environment, HOME: state.homeDirectory});
};

const installedEntry = (/** @type {{ homeDirectory: string; }} */ state) => join(state.homeDirectory, '.agent-repository-workflow', 'arw.mjs');
const installedUninstaller = (/** @type {{ homeDirectory: string; }} */ state) => join(state.homeDirectory, '.agent-repository-workflow', 'uninstall.mjs');

const resolvePriorRelease = async (/** @type {ScenarioState} */ state) => {
    const sourceDirectory = join(state.fixturesDirectory, 'prior');
    const tag = parsePackageIdentity(await readFile(join(sourceDirectory, 'package.json')), 'package.json').version;
    const commit = requireSuccess(await runGit(sourceDirectory, ['rev-parse', '--verify', 'HEAD^{commit}']), 'Guest prior Release checkout resolution').trim();
    const tagCommit = requireSuccess(await runGit(state.sourceDirectory, ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]), 'Guest prior Release tag resolution').trim();
    if (tagCommit !== commit) throw new Error('Guest prior Release checkout does not match its tag commit.');
    requireSuccess(await runGit(state.sourceDirectory, ['merge-base', '--is-ancestor', tagCommit, state.commit]), 'Guest prior Release reachability');
    return {commit, sourceDirectory, tag};
};

const installVersion = async (
    /** @type {ScenarioState} */ state,
    /** @type {'candidate' | 'prior-release'} */ identity,
    /** @type {boolean} */ explicit = true,
    /** @type {boolean} */ reinitializeConfiguration = false,
) => {
    const selected = identity === 'candidate'
        ? {commit: state.commit, sourceDirectory: state.sourceDirectory, tag: state.tag}
        : await resolvePriorRelease(state);
    return run(process.execPath, [
        join(selected.sourceDirectory, 'install.mjs'),
        '--release-tag', selected.tag,
        '--release-commit', selected.commit,
        '--selection-mode', explicit ? 'explicit' : 'latest',
        '--non-interactive',
        '--reinitialize-config', String(reinitializeConfiguration),
        '--register-path', 'true',
    ], {cwd: selected.sourceDirectory, env: installationEnvironment(state)});
};

const installCandidate = (/** @type {ScenarioState} */ state, /** @type {boolean} */ explicit = true) => installVersion(state, 'candidate', explicit);

const windowsUserEnvironment = async (/** @type {ScenarioState} */ state) => {
    const base = installationEnvironment(state);
    const script = `$machine = [Environment]::GetEnvironmentVariable('Path', 'Machine'); `
        + `$user = [Environment]::GetEnvironmentVariable('Path', 'User'); `
        + `[Environment]::ExpandEnvironmentVariables((@($machine, $user) | Where-Object { $_ }) -join ';')`;
    const outcome = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {env: base});
    requireSuccess(outcome, 'Windows effective user Path resolution');
    return withRuntimeFirst({...base, Path: outcome.stdout.trim()});
};

const resolveGitBash = async (/** @type {NodeJS.ProcessEnv} */ environment) => {
    const outcome = await run('where.exe', ['git.exe'], {env: environment});
    const gitPath = requireSuccess(outcome, 'Git for Windows location').split(/\r?\n/u).find(Boolean);
    if (gitPath === undefined) throw new Error('Git for Windows location was empty.');
    return join(dirname(dirname(gitPath)), 'bin', 'bash.exe');
};

export const buildWindowsPowerShellLauncherScript = (/** @type {string} */ homeDirectory) => {
    const expected = join(homeDirectory, '.agent-repository-workflow', 'arw.cmd').replaceAll("'", "''");
    return `$expected = '${expected}'; `
        + `$commands = @(Get-Command arw -All -CommandType Application | Where-Object { $_.Source -eq $expected }); `
        + `$commands | ForEach-Object { $_.Source }; `
        + `if ($commands.Count -ne 1) { exit 3 }; `
        + `& $commands[0].Source --version; exit $LASTEXITCODE`;
};

const runWindowsLauncher = async (/** @type {ScenarioState} */ state, /** @type {string} */ shell) => {
    const env = await windowsUserEnvironment(state);
    if (shell === 'powershell') {
        return run('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            buildWindowsPowerShellLauncherScript(state.homeDirectory),
        ], {env});
    }
    if (shell === 'cmd') {
        const resolved = await run('cmd.exe', ['/d', '/s', '/c', 'where.exe arw.cmd'], {env});
        const paths = resolved.stdout.split(/\r?\n/u).filter(Boolean);
        if (resolved.exitCode !== 0 || paths.length !== 1) {
            return {...resolved, exitCode: resolved.exitCode === 0 ? 3 : resolved.exitCode};
        }
        const launched = await run('cmd.exe', ['/d', '/s', '/c', 'arw --version'], {env});
        return {...launched, stdout: `${paths[0]}\n${launched.stdout}`};
    }
    if (shell === 'git-bash') {
        return run(await resolveGitBash(env), ['--login', '-c', 'matches=$(type -aP arw); test "$(printf "%s\n" "$matches" | sed "/^$/d" | wc -l)" -eq 1 && printf "%s\n" "$matches" && arw --version'], {env});
    }
    throw new Error(`Windows launcher shell is not registered: ${shell}.`);
};

const runLoginShellLauncher = (/** @type {ScenarioState} */ state, /** @type {string} */ executable = 'arw') => run('/bin/sh', [
    '-l', '-c', `command -v ${executable} && ${executable} --version`,
], {cwd: state.homeDirectory, env: installationEnvironment(state)});

const runWithSourceUnavailable = async (/** @type {ScenarioState} */ state) => {
    const unavailableDirectory = join(state.scenarioRoot, 'source-temporarily-unavailable');
    await renameDirectoryWithRetry(state.sourceDirectory, unavailableDirectory);
    try {
        const launcher = join(
            state.homeDirectory,
            '.agent-repository-workflow',
            process.platform === 'win32' ? 'arw.cmd' : 'arw',
        );
        if (process.platform === 'win32') {
            return await runWindowsBatchVersion(launcher, {
                cwd: state.homeDirectory,
                env: installationEnvironment(state),
            });
        }
        return await run(launcher, ['--version'], {cwd: state.homeDirectory, env: installationEnvironment(state)});
    } finally {
        await renameDirectoryWithRetry(unavailableDirectory, state.sourceDirectory);
    }
};

/**
 * 对 Node.js floor 实际运行的 5 个 lifecycle entries 分别执行 `node --check`.
 * 保留全部 5 个 child outcome, 并返回固定顺序的 JSON line, 不修改 Source Checkout.
 */
export const checkLifecycleEntries = async (/** @type {ScenarioState} */ state) => {
    /** @type {Array<ProcessOutcome & {path: string}>} */
    const outcomes = [];
    // Node.js `--check` 一次只接受一个 entry path, 因此每个受验 entry 必须使用独立 child process 并保留各自结果.
    for (const path of RELEASE_ESM_LIFECYCLE_ENTRIES) {
        const outcome = await run(process.execPath, ['--check', join(state.sourceDirectory, path)], {
            cwd: state.sourceDirectory,
            env: installationEnvironment(state),
        });
        outcomes.push({
            exitCode: outcome.exitCode,
            path,
            stderr: outcome.stderr,
            stdout: outcome.stdout,
        });
    }
    return {
        exitCode: outcomes.find(outcome => outcome.exitCode !== 0)?.exitCode ?? 0,
        stderr: '',
        stdout: `${JSON.stringify(outcomes)}\n`,
    };
};

const listIssueDocuments = async (/** @type {string} */ directory) => {
    /** @type {string[]} */
    const results = [];
    const visit = async (/** @type {string} */ current) => {
        for (const entry of await readdir(current, {withFileTypes: true})) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) await visit(path);
            else if (entry.isFile() && entry.name.endsWith('.md')) results.push(path);
        }
    };
    try {
        await visit(join(directory, '.scratch'));
    } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    return results;
};

/**
 * 严格验证 target Repository 恰有一个本步骤创建的 completed ordinary implementation issue.
 * Issue 必须 strict-read 通过, criteria 全部完成且包含 validation evidence; 函数不修改 issue.
 */
export const requireCompletedInitializationIssue = async (/** @type {ScenarioState} */ state) => {
    const status = requireSuccess(await runGit(state.targetDirectory, [
        'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.scratch',
    ]), 'Initialization issue status');
    const issueRecords = status.split('\0').filter(Boolean).map(record => ({code: record.slice(0, 2), path: record.slice(3)}));
    const issueRecordsCreated = issueRecords.filter((/** @type {{ path: string; code: string | string[]; }} */ record) => {
        try {
            return parseRegisteredArtifactPath(record.path).kind === 'issue'
                && (record.code === '??' || record.code.includes('A'));
        } catch {
            return false;
        }
    });
    const issuePaths = issueRecordsCreated.map(record => record.path);
    if (issuePaths.length !== 1) {
        throw new Error('The Main Agent must create and complete exactly one initialization implementation issue.');
    }
    const createdIssuePath = issuePaths[0];
    if (createdIssuePath === undefined) throw new Error('The initialization implementation issue path is unavailable.');
    const issuePath = join(state.targetDirectory, ...createdIssuePath.split('/'));
    const allIssues = await listIssueDocuments(state.targetDirectory);
    if (!allIssues.includes(issuePath)) {
        throw new Error('The initialization implementation issue has not been completed by the Main Agent.');
    }
    let createdIdentity;
    try {
        createdIdentity = parseRegisteredArtifactPath(createdIssuePath);
    } catch {
        throw new Error('The initialization implementation issue path is invalid.');
    }
    if (createdIdentity.kind !== 'issue') throw new Error('The initialization implementation issue path is invalid.');
    const effortRoot = join(state.targetDirectory, '.scratch', createdIdentity.effortDirectory, 'issues');
    /** @type {Array<{effort: string, number: string, sourceKey: string, text: string}>} */
    const documents = [];
    for (const path of allIssues.filter(candidate => dirname(candidate) === effortRoot)) {
        const boundedSource = resolveAbsolutePathWithinScope({path, scope: state.targetDirectory});
        if (boundedSource.status !== 'succeeded' || boundedSource.relativePath.length === 0) {
            throw new Error('Initialization issue path escaped the target Repository.');
        }
        const sourceKey = boundedSource.relativePath.split(sep).join('/');
        let sourceIdentity;
        try {
            sourceIdentity = parseRegisteredArtifactPath(sourceKey);
        } catch {
            continue;
        }
        if (sourceIdentity.kind !== 'issue' || sourceIdentity.issueFilename === null || sourceIdentity.issueNumber === null) continue;
        documents.push({
            effort: sourceIdentity.effortDirectory,
            number: sourceIdentity.issueNumber,
            sourceKey,
            text: await readFile(path, 'utf8'),
        });
    }
    const parsed = readIssueDocuments(documents);
    const record = parsed.records.find(candidate => candidate.sourceKey === createdIssuePath);
    if (parsed.diagnostics.length !== 0 || record?.kind !== 'implementation' || record.status !== 'completed') {
        throw new Error('The initialization implementation issue has not been completed by the Main Agent.');
    }
    const issueText = documents.find(document => document.sourceKey === createdIssuePath)?.text ?? '';
    const acceptance = /^## Acceptance criteria\s*$\n(?<body>[\s\S]*?)(?=^## |(?![\s\S]))/mu.exec(issueText)?.groups?.body ?? '';
    const validation = /^## Validation\s*$\n(?<body>[\s\S]*?)(?=^## |(?![\s\S]))/mu.exec(issueText)?.groups?.body ?? '';
    if (!/^- \[x\] .+/mu.test(acceptance) || /^- \[ \] /mu.test(acceptance)) {
        throw new Error('The initialization implementation issue has incomplete acceptance criteria.');
    }
    if (validation.trim().length === 0) {
        throw new Error('The initialization implementation issue requires non-empty evidence under the exact ## Validation heading.');
    }
};

const workflowProfileArguments = (/** @type {string} */ targetKind) => targetKind === 'plain'
    ? [
        'workflow', 'init', '--non-interactive',
        '--platform', 'codex', '--platform', 'claude-code',
        '--domain-layout', 'single-context',
        '--code-map-root', '--code-map-include', '--code-map-exclude',
    ]
    : [
        'workflow', 'init', '--non-interactive',
        '--platform', 'codex',
        '--domain-layout', 'single-context',
        '--code-map-root', 'src',
        '--code-map-include', 'src/**/*',
        '--code-map-exclude',
    ];

const releaseWorkflowProfile = (/** @type {string} */ targetKind) => {
    const platforms = targetKind === 'plain' ? ['codex', 'claude-code'] : ['codex'];
    return {
        codeMaps: targetKind === 'plain'
            ? {excludes: [], includes: [], roots: []}
            : {excludes: [], includes: ['src/**/*'], roots: ['src']},
        domainLayout: 'single-context',
        platforms,
    };
};

const releaseWorkflowRegistrationKey = (/** @type {string} */ targetKind, /** @type {string} */ stepId) => `${targetKind}\0${stepId}`;
const releaseWorkflowResolvedChoices = (/** @type {Readonly<Record<string, unknown>> | null} */ parameters) => Object.freeze(Object.fromEntries(
    Object.entries(parameters ?? {}).filter(([, value]) => value !== null),
));
const releaseWorkflowChoicesMatch = (/** @type {unknown} */ actual, /** @type {Readonly<Record<string, unknown>>} */ expected) => (
    finiteExactKeys(actual, Object.keys(expected))
    && Object.entries(expected).every(([key, value]) => isDeepStrictEqual(actual[key], value))
);
/** @type {Map<string, {choices: Readonly<Record<string, unknown>>, operation: string}>} */
const releaseWorkflowRegistrations = new Map();
for (const scenario of listReleaseValidationScenarios()) {
    const {targetKind} = scenario;
    if (targetKind === null) continue;
    for (const step of scenario.steps) {
        const registeredOperation = step.mechanicalContract === 'repository-workflow-transition'
            && isRecord(step.mechanicalParameters)
            && typeof step.mechanicalParameters.operation === 'string'
            ? step.mechanicalParameters.operation
            : null;
        if (registeredOperation === null) continue;
        const registration = {
            choices: releaseWorkflowResolvedChoices(step.choiceParameters),
            operation: registeredOperation === 'reinit' ? 'init' : registeredOperation,
        };
        const key = releaseWorkflowRegistrationKey(targetKind, step.stepId);
        const existing = releaseWorkflowRegistrations.get(key);
        if (existing !== undefined
            && (existing.operation !== registration.operation
                || !releaseWorkflowChoicesMatch(existing.choices, registration.choices))) {
            throw new Error('Release workflow plan capture registration is ambiguous.');
        }
        releaseWorkflowRegistrations.set(key, registration);
    }
}

const releaseWorkflowCompare = (/** @type {string} */ left, /** @type {string} */ right) => left < right ? -1 : left > right ? 1 : 0;

const releaseWorkflowExpectedEntry = (/** @type {string} */ path, /** @type {Buffer} */ bytes) => ({
    bytesBase64: bytes.toString('base64'),
    path,
    type: 'ordinary-file',
});

/** @returns {value is string} */
const canonicalBase64 = (/** @type {unknown} */ value) => typeof value === 'string'
    && Buffer.from(value, 'base64').toString('base64') === value;

const normalizeReleaseWorkflowPlan = (/** @type {{plan: unknown, releaseWorkflowSource?: boolean, selectedOperation?: string}} */ {
    plan,
    releaseWorkflowSource = false,
    selectedOperation,
}) => {
    if (!isRecord(plan)
        || !['init', 'update', 'remove'].includes(/** @type {string} */ (plan.operation))) {
        throw new Error('Release workflow plan is invalid.');
    }
    const planKeys = releaseWorkflowSource && plan.operation === 'remove'
        ? ['categories', 'choices', 'diagnostics', 'operation', 'operations', 'profile']
        : ['diagnostics', 'operation', 'operations', 'profile'];
    if (!finiteExactKeys(plan, planKeys)
        || !Array.isArray(plan.diagnostics)
        || plan.diagnostics.length !== 0
        || (selectedOperation !== undefined && plan.operation !== selectedOperation)
        || !Array.isArray(plan.operations)) {
        throw new Error('Release workflow plan is invalid.');
    }
    let profile;
    try {
        profile = normalizeWorkflowProfile(plan.profile);
    } catch {
        throw new Error('Release workflow plan profile is invalid.');
    }
    if (!isDeepStrictEqual(profile, plan.profile)) throw new Error('Release workflow plan profile is not canonical.');
    const operations = /** @type {ReleaseWorkflowOperation[]} */ (plan.operations.map((/** @type {unknown} */ operation) => {
        if (!isRecord(operation)
            || typeof operation.path !== 'string'
            || !isSafeReleaseRelativePath(operation.path)) {
            throw new Error('Release workflow plan operation is invalid.');
        }
        const action = releaseWorkflowSource && operation.action === 'write-lock'
            ? 'write'
            : releaseWorkflowSource && operation.action === 'delete-lock'
                ? 'delete'
                : operation.action;
        if (action === 'write') {
            if (!finiteExactKeys(operation, ['action', 'bytes', 'path']) || !canonicalBase64(operation.bytes)) {
                throw new Error('Release workflow write operation bytes are invalid.');
            }
            return {action, bytes: operation.bytes, path: operation.path};
        }
        if (action === 'delete') {
            if (!finiteExactKeys(operation, ['action', 'path'])) throw new Error('Release workflow delete operation is invalid.');
            return {action, path: operation.path};
        }
        throw new Error('Release workflow plan action is unsupported.');
    }));
    return {
        diagnostics: [],
        operation: plan.operation,
        operations,
        profile,
    };
};

export const buildReleaseWorkflowExpectedState = async (/** @type {unknown} */ input) => {
    if (!finiteExactKeys(input, ['before', 'plan', 'retainedPaths'])
        || !Array.isArray(input.before)
        || !finiteExactKeys(input.plan, ['diagnostics', 'operation', 'operations', 'profile'])
        || !Array.isArray(input.retainedPaths)) {
        throw new TypeError('Release workflow expected-state input is invalid.');
    }
    const {before, retainedPaths} = input;
    const plan = normalizeReleaseWorkflowPlan({plan: input.plan});
    if (before.some(entry => !finiteExactKeys(entry, ['bytesBase64', 'path', 'type'])
        || entry.type !== 'ordinary-file'
        || typeof entry.path !== 'string'
        || !isSafeReleaseRelativePath(entry.path)
        || !canonicalBase64(entry.bytesBase64))) {
        throw new TypeError('Release workflow snapshot is invalid.');
    }
    if (new Set(before.map(entry => entry.path)).size !== before.length) {
        throw new Error('Release workflow snapshot paths must be unique.');
    }
    if (retainedPaths.some(path => typeof path !== 'string' || !isSafeReleaseRelativePath(path))
        || new Set(retainedPaths).size !== retainedPaths.length
        || retainedPaths.some((path, index) => index > 0 && releaseWorkflowCompare(retainedPaths[index - 1], path) >= 0)) {
        throw new Error('Release workflow retained paths must be sorted and unique.');
    }
    const beforeByPath = new Map(before.map(entry => [entry.path, {...entry}]));
    /** @type {Map<string, SnapshotEntry>} */
    const expected = new Map(beforeByPath);
    /** @type {Set<string>} */
    const missing = new Set();
    for (const operation of plan.operations) {
        if (operation.action === 'write') {
            expected.set(
                operation.path,
                releaseWorkflowExpectedEntry(operation.path, Buffer.from(operation.bytes, 'base64')),
            );
            missing.delete(operation.path);
        } else if (operation.action === 'delete') {
            expected.delete(operation.path);
            missing.add(operation.path);
        }
    }
    for (const path of retainedPaths) {
        const current = beforeByPath.get(path);
        if (current === undefined) throw new Error(`Release workflow retained path is unavailable: ${path}.`);
        expected.set(path, current);
        missing.delete(path);
    }
    return {
        expectedEntries: [...expected.values()].sort((left, right) => releaseWorkflowCompare(left.path, right.path)),
        expectedMissingPaths: [...missing].sort(releaseWorkflowCompare),
    };
};

const releaseWorkflowDiagnosticSuffix = (/** @type {unknown} */ result) => {
    if (!isRecord(result) || !Array.isArray(result.diagnostics)) return '';
    const codes = [...new Set(result.diagnostics
        .map((/** @type {unknown} */ diagnostic) => isRecord(diagnostic) ? diagnostic.code : undefined)
        .filter((/** @type {unknown} */ code) => typeof code === 'string' && /^[a-z][a-z0-9-]{0,63}$/u.test(code)))]
        .sort()
        .slice(0, 8);
    return codes.length === 0 ? '' : ` Diagnostics: ${codes.join(', ')}.`;
};

/**
 * 通过已安装 Workflow Module 的 `beforeApply` 边界取得最终稳定计划, 随后在任何写入前停止预检.
 * Release helper 因而不依赖只适用于 update 的 public CLI `--dry-run` option.
 */
export const createReleaseWorkflowPlanCapture = (/** @type {unknown} */ dependencies) => {
    if (!finiteExactKeys(dependencies, ['workflowRunner']) || typeof dependencies.workflowRunner !== 'function') {
        throw new TypeError('Release workflow plan capture requires one Workflow Runner.');
    }
    const workflowRunner = /** @type {WorkflowRunner} */ (dependencies.workflowRunner);
    return async (/** @type {unknown} */ input) => {
        if (!finiteExactKeys(input, ['choices', 'state', 'stepId'])
            || !isRecord(input.choices)
            || !isRecord(input.state)
            || typeof input.state.homeDirectory !== 'string'
            || !isAbsolute(input.state.homeDirectory)
            || typeof input.state.targetDirectory !== 'string'
            || !isAbsolute(input.state.targetDirectory)
            || !['agent-assisted', 'plain'].includes(/** @type {string} */ (input.state.targetKind))
            || typeof input.stepId !== 'string'
            || input.stepId.length === 0) {
            throw new TypeError('Release workflow plan capture input is invalid.');
        }
        const {choices, state, stepId} = /** @type {{choices: Record<string, unknown>, state: {homeDirectory: string, targetDirectory: string, targetKind: string}, stepId: string}} */ (input);
        const registration = releaseWorkflowRegistrations.get(releaseWorkflowRegistrationKey(state.targetKind, stepId));
        if (registration === undefined) throw new Error('Release guest workflow plan is not registered.');
        if (!releaseWorkflowChoicesMatch(choices, registration.choices)) {
            throw new TypeError('Release workflow plan capture choices are invalid.');
        }
        const selected = choices;
        const {operation} = registration;
        let engineChoices;
        if (operation === 'init') {
            const profile = releaseWorkflowProfile(typeof selected.profile === 'string' ? selected.profile : state.targetKind);
            engineChoices = {mode: 'non-interactive', platforms: profile.platforms, profile};
        } else if (operation === 'remove') {
            const removal = Object.fromEntries([
                ['arwignore', 'arwignore'],
                ['codeMaps', 'code-maps'],
                ['mixedAgentDocuments', 'mixed-agent-documents'],
                ['platformAgentConfigs', 'platform-agent-configs'],
            ].filter(([key]) => Object.hasOwn(selected, key)).map(([key, category]) => [category, selected[key]]));
            engineChoices = {mode: 'non-interactive', removal};
        } else {
            engineChoices = {mode: 'non-interactive'};
        }
        const installationDirectory = join(state.homeDirectory, '.agent-repository-workflow');
        /** @type {{value: unknown}} */
        const capturedPlan = {value: null};
        /** @type {unknown} */
        let workflowResult = null;
        const stopBeforeApply = Symbol('release-workflow-plan-captured');
        try {
            workflowResult = await workflowRunner({
                beforeApply: (/** @type {unknown} */ plan) => {
                    capturedPlan.value = plan;
                    throw stopBeforeApply;
                },
                choices: engineChoices,
                distributionDirectory: join(installationDirectory, 'distribution'),
                operation,
                repositoryRoot: state.targetDirectory,
                ...(Object.hasOwn(selected, 'orphanCodeMapReadmes')
                    ? {orphanCodeMapReadmes: selected.orphanCodeMapReadmes}
                    : {}),
                ...(Object.hasOwn(selected, 'transformExistingAgentDocs')
                    ? {transformExistingAgentDocs: selected.transformExistingAgentDocs}
                    : {}),
            });
        } catch (error) {
            if (error !== stopBeforeApply) throw error;
        }
        if (!isRecord(capturedPlan.value) || typeof capturedPlan.value.canonical !== 'string') {
            throw new Error(`Release workflow plan could not be captured before apply.${releaseWorkflowDiagnosticSuffix(workflowResult)}`);
        }
        let plan;
        try {
            plan = JSON.parse(capturedPlan.value.canonical);
        } catch {
            throw new Error('Release workflow plan returned invalid JSON.');
        }
        return normalizeReleaseWorkflowPlan({
            plan,
            releaseWorkflowSource: true,
            selectedOperation: operation,
        });
    };
};

const runInstalledWorkflow = async (/** @type {Parameters<WorkflowRunner>[0]} */ options) => {
    const installationDirectory = dirname(options.distributionDirectory);
    const module = await import(pathToFileURL(join(installationDirectory, 'lib', 'repository-workflow', 'workflow.mjs')).href);
    if (typeof module.runRepositoryWorkflow !== 'function') throw new Error('Installed Workflow Runner is unavailable.');
    return module.runRepositoryWorkflow(options);
};

export const prepareReleaseWorkflowPlan = createReleaseWorkflowPlanCapture({workflowRunner: runInstalledWorkflow});

/**
 * 把 Scenario Plan 已经闭合的 Repository Workflow choices 投影为一个 guest child argument array.
 * `operation` 只接受 Registry 已登记的 init, reinit 或 remove contract value. `targetKind` 提供 profile fallback;
 * 非 null `choices` 只为实际存在的 choice key 生成对应 flag, 因而不会为不适用选择补入显式 `false` 或 delete value.
 * Init 和 reinit 返回完整 non-interactive profile arguments 与适用 transformation choices.
 * Workflow remove 只返回适用的 removal category choices. Unknown operation 会同步抛出 error, Interface 不执行 child process.
 */
export const buildReleaseRepositoryActionArguments = (/** @type {{choices: Record<string, unknown> | null, operation: string, targetKind: string | null}} */ {choices, operation, targetKind}) => {
    const selected = choices ?? {profile: targetKind};
    const selectedProfile = typeof selected.profile === 'string' ? selected.profile : targetKind ?? 'plain';
    const optionalString = (/** @type {string} */ key) => {
        const value = selected[key];
        if (typeof value !== 'string') throw new Error(`Release guest choice ${key} must be a string.`);
        return value;
    };
    if (operation === 'init' || operation === 'reinit') {
        return [
            ...workflowProfileArguments(selectedProfile),
            ...(Object.hasOwn(selected, 'transformExistingAgentDocs')
                ? ['--transform-existing-agent-docs', String(selected.transformExistingAgentDocs)]
                : []),
            ...(Object.hasOwn(selected, 'orphanCodeMapReadmes')
                ? ['--orphan-code-map-readmes', optionalString('orphanCodeMapReadmes')]
                : []),
        ];
    }
    if (operation === 'remove') {
        return [
            'workflow', 'remove', '--non-interactive',
            ...(Object.hasOwn(selected, 'platformAgentConfigs')
                ? ['--platform-agent-configs', optionalString('platformAgentConfigs')]
                : []),
            ...(Object.hasOwn(selected, 'arwignore') ? ['--arwignore', optionalString('arwignore')] : []),
            ...(Object.hasOwn(selected, 'codeMaps') ? ['--code-maps', optionalString('codeMaps')] : []),
            ...(Object.hasOwn(selected, 'mixedAgentDocuments')
                ? ['--mixed-agent-documents', optionalString('mixedAgentDocuments')]
                : []),
        ];
    }
    throw new Error(`Release guest Repository action arguments are not registered: ${operation}.`);
};

const runInstallationTransition = async (/** @type {{cwd: string, parameters: unknown, state: ScenarioState}} */ {cwd, parameters, state}) => {
    if (!isRecord(parameters)
        || typeof parameters.action !== 'string'
        || !(parameters.expectedVersion === null || ['candidate', 'prior-release'].includes(/** @type {string} */ (parameters.expectedVersion)))
        || !(parameters.explicitSelection === null || typeof parameters.explicitSelection === 'boolean')
        || !(parameters.removeConfiguration === null || typeof parameters.removeConfiguration === 'boolean')) {
        throw new Error('Release installation mechanical parameters are invalid.');
    }
    if (parameters.action === 'uninstall') {
        if (typeof parameters.removeConfiguration !== 'boolean') {
            throw new Error('Release uninstall configuration choice is invalid.');
        }
        return run(process.execPath, [
            installedUninstaller(state),
            '--non-interactive',
            '--remove-config', String(parameters.removeConfiguration),
        ], {cwd, env: installationEnvironment(state)});
    }
    if (!['install', 'repair', 'upgrade', 'reject-default-downgrade', 'downgrade'].includes(parameters.action)
        || !['candidate', 'prior-release'].includes(/** @type {string} */ (parameters.expectedVersion))
        || typeof parameters.explicitSelection !== 'boolean') {
        throw new Error('Release installation transition is not registered.');
    }
    const identity = /** @type {'candidate' | 'prior-release'} */ (parameters.expectedVersion);
    return installVersion(
        state,
        identity,
        parameters.explicitSelection,
        parameters.action === 'downgrade',
    );
};

const runRepositoryAction = async (/** @type {GuestRequest} */ request, /** @type {ScenarioState} */ state, /** @type {ReleaseStep} */ step) => {
    const env = installationEnvironment(state);
    if (step.mechanicalContract === 'installation-transition') {
        return runInstallationTransition({cwd: state.targetDirectory, parameters: step.mechanicalParameters, state});
    }
    if (step.mechanicalContract === 'repository-workflow-transition') {
        const parameters = step.mechanicalParameters;
        if (!isRecord(parameters) || typeof parameters.operation !== 'string') {
            throw new Error('Release workflow mechanical parameters are invalid.');
        }
        if (parameters.operation === 'update') {
            return run(process.execPath, [installedEntry(state), 'workflow', 'update', '--non-interactive'], {cwd: state.targetDirectory, env});
        }
        return run(process.execPath, [installedEntry(state), ...buildReleaseRepositoryActionArguments({
            choices: request.choices,
            operation: parameters.operation,
            targetKind: state.targetKind,
        })], {cwd: state.targetDirectory, env});
    }
    if (step.mechanicalContract === 'repository-verification') {
        const parameters = step.mechanicalParameters;
        if (!isRecord(parameters) || !['workflow', 'code-map'].includes(/** @type {string} */ (parameters.kind))) {
            throw new Error('Release Repository verification parameters are invalid.');
        }
        const kind = /** @type {string} */ (parameters.kind);
        return run(process.execPath, [installedEntry(state), kind, 'verify'], {cwd: state.targetDirectory, env});
    }
    throw new Error(`Release guest Repository action is not registered: ${request.stepId}.`);
};

const prepareCommandMechanicalObservation = async (/** @type {{before: SnapshotEntry[], request: GuestRequest, state: ScenarioState, step: ReleaseStep}} */ {before, request, state, step}) => {
    if (step.mechanicalContract !== 'repository-workflow-transition') return null;
    if (!isRecord(step.mechanicalParameters)
        || !Array.isArray(step.mechanicalParameters.retainedPaths)
        || step.mechanicalParameters.retainedPaths.some((/** @type {unknown} */ path) => typeof path !== 'string')) {
        throw new Error('Release workflow mechanical parameters are invalid.');
    }
    const retainedPaths = step.mechanicalParameters.retainedPaths.filter((/** @type {unknown} */ path) => typeof path === 'string');
    const plan = await prepareReleaseWorkflowPlan({choices: request.choices, state, stepId: request.stepId});
    const expectedState = await buildReleaseWorkflowExpectedState({
        before,
        plan,
        retainedPaths,
    });
    return {expectedState, plan};
};

const normalizeWindowsPathEntry = (/** @type {string} */ value) => {
    let normalized = value;
    if (normalized.length >= 2 && normalized.startsWith('"') && normalized.endsWith('"')) {
        normalized = normalized.slice(1, -1);
    }
    normalized = normalized.replaceAll('/', '\\').toLowerCase();
    while (normalized.endsWith('\\')) normalized = normalized.slice(0, -1);
    return normalized;
};

/** @returns {{entry: CapturedEntry, pathOwnership: unknown[]}} */
const expectedWindowsPathState = (/** @type {{beforeByPath: Map<string, SnapshotEntry>, installationDirectory: string}} */ {beforeByPath, installationDirectory}) => {
    const priorEntry = beforeByPath.get('windows-user-path.json');
    if (priorEntry?.type !== 'ordinary-file'
        || typeof priorEntry.bytesBase64 !== 'string'
        || typeof installationDirectory !== 'string'
        || !/^[A-Za-z]:[\\/]/.test(installationDirectory)) {
        throw new Error('Release installation expected Windows PATH state is invalid.');
    }
    let prior;
    try {
        prior = JSON.parse(Buffer.from(priorEntry.bytesBase64, 'base64').toString('utf8'));
    } catch {
        throw new Error('Release installation expected Windows PATH state is invalid.');
    }
    if (!finiteExactKeys(prior, ['effectiveEntries', 'exists', 'kind', 'value'])
        || typeof prior.exists !== 'boolean'
        || !Array.isArray(prior.effectiveEntries)
        || prior.effectiveEntries.some((/** @type {unknown} */ entry) => typeof entry !== 'string')
        || typeof prior.value !== 'string'
        || prior.exists && (typeof prior.kind !== 'string' || !['String', 'ExpandString'].includes(prior.kind))
        || !prior.exists && (prior.kind !== null || prior.value !== '')) {
        throw new Error('Release installation expected Windows PATH state is invalid.');
    }
    const target = normalizeWindowsPathEntry(installationDirectory);
    const alreadyPresent = prior.value.split(';').some(entry => normalizeWindowsPathEntry(entry) === target);
    /** @type {unknown[]} */
    let previousOwnership = [];
    const priorManifestEntry = beforeByPath.get('.agent-repository-workflow/manifest.json');
    if (priorManifestEntry !== undefined) {
        try {
            if (typeof priorManifestEntry.bytesBase64 !== 'string') throw new Error('invalid manifest bytes');
            previousOwnership = JSON.parse(Buffer.from(priorManifestEntry.bytesBase64, 'base64').toString('utf8')).pathOwnership;
        } catch {
            throw new Error('Release installation expected Windows PATH ownership is invalid.');
        }
        if (!Array.isArray(previousOwnership)) {
            throw new Error('Release installation expected Windows PATH ownership is invalid.');
        }
    }
    const expectedOwnership = alreadyPresent
        ? previousOwnership
        : [...previousOwnership, {
            createdValue: !prior.exists,
            entry: installationDirectory,
            kind: 'windows-user-path',
            valueKind: prior.exists ? prior.kind : 'ExpandString',
        }];
    if (alreadyPresent) return {
        entry: {bytesBase64: priorEntry.bytesBase64, path: priorEntry.path, type: priorEntry.type},
        pathOwnership: expectedOwnership,
    };
    const effectiveEntries = prior.effectiveEntries.filter((/** @type {unknown} */ entry) => typeof entry === 'string');
    if (prior.exists && prior.value.endsWith(';') && effectiveEntries.at(-1) === '') effectiveEntries.pop();
    effectiveEntries.push(installationDirectory);
    const expected = {
        effectiveEntries,
        exists: true,
        kind: prior.exists ? prior.kind : 'ExpandString',
        value: prior.value.length === 0
            ? installationDirectory
            : `${prior.value}${prior.value.endsWith(';') ? '' : ';'}${installationDirectory}`,
    };
    return {
        entry: {
            bytesBase64: Buffer.from(`${JSON.stringify(expected)}\n`).toString('base64'),
            path: 'windows-user-path.json',
            type: 'ordinary-file',
        },
        pathOwnership: expectedOwnership,
    };
};

const expectedLinuxProfileState = (/** @type {{beforeByPath: Map<string, SnapshotEntry>, installationDirectory: string}} */ {beforeByPath, installationDirectory}) => {
    const priorProfile = beforeByPath.get(LINUX_PROFILE_PATH);
    const priorBytes = priorProfile?.bytesBase64;
    if (priorProfile !== undefined && (priorProfile.type !== 'ordinary-file' || typeof priorBytes !== 'string')) {
        throw new Error('Release installation expected Linux profile is invalid.');
    }
    const priorContent = priorProfile === undefined ? '' : Buffer.from(/** @type {string} */ (priorBytes), 'base64').toString('utf8');
    const hasEquivalentEntry = priorContent.split(/\r?\n/).some(line => {
        const assignment = /^export\s+PATH\s*=\s*(?:"([^"]*)"|([^'"\s#]+))\s*$/.exec(line.trim());
        const value = assignment?.[1] ?? assignment?.[2];
        return typeof value === 'string'
            && value.split(':').includes(LINUX_HOME_INSTALLATION_ENTRY);
    });
    const alreadyConfigured = priorContent.includes(LINUX_PROFILE_MARKER_BLOCK) || hasEquivalentEntry;
    const markerStart = priorContent.indexOf(LINUX_PROFILE_MARKER_START);
    const markerEnd = priorContent.indexOf(LINUX_PROFILE_MARKER_END);
    const content = alreadyConfigured
        ? priorContent
        : markerStart !== -1 && markerEnd > markerStart
            ? `${priorContent.slice(0, markerStart)}${LINUX_PROFILE_MARKER_BLOCK}${priorContent.slice(markerEnd + LINUX_PROFILE_MARKER_END.length)}`
            : `${priorContent}${priorContent.length === 0 || priorContent.endsWith('\n') ? '' : '\n'}${LINUX_PROFILE_MARKER_BLOCK}\n`;
    const previousOwnership = priorInstallationPathOwnership(beforeByPath);
    const ownership = {kind: 'linux-profile', profile: join(dirname(installationDirectory), '.profile')};
    return {
        entry: {
            bytesBase64: Buffer.from(content).toString('base64'),
            path: LINUX_PROFILE_PATH,
            type: 'ordinary-file',
        },
        pathOwnership: alreadyConfigured || previousOwnership.some((/** @type {{kind?: unknown, profile?: unknown}} */ record) => record.kind === ownership.kind && record.profile === ownership.profile)
            ? previousOwnership
            : [...previousOwnership, ownership],
    };
};

const expectedInstallationPlatformState = (/** @type {{before: SnapshotEntry[], installationDirectory: string, machineKey: string, manifest: unknown}} */ {before, installationDirectory, machineKey, manifest}) => {
    const beforeByPath = new Map(before.map(entry => [entry.path, entry]));
    if (machineKey !== 'Windows 11') return expectedLinuxProfileState({beforeByPath, installationDirectory});
    const state = expectedWindowsPathState({beforeByPath, installationDirectory});
    if (!isRecord(manifest)
        || !Array.isArray(manifest.pathOwnership)
        || JSON.stringify(manifest.pathOwnership) !== JSON.stringify(state.pathOwnership)) {
        throw new Error('Release installation expected Windows PATH ownership is invalid.');
    }
    return state;
};

const priorInstallationPathOwnership = (/** @type {Map<string, SnapshotEntry>} */ beforeByPath) => {
    const priorManifest = beforeByPath.get('.agent-repository-workflow/manifest.json');
    if (priorManifest === undefined) return [];
    try {
        if (typeof priorManifest.bytesBase64 !== 'string') throw new Error('invalid ownership');
        const manifest = JSON.parse(Buffer.from(priorManifest.bytesBase64, 'base64').toString('utf8'));
        if (!Array.isArray(manifest.pathOwnership)) throw new Error('invalid ownership');
        return manifest.pathOwnership;
    } catch {
        throw new Error('Release installation expected PATH ownership is invalid.');
    }
};

/**
 * 从 Verified Release 和原始 Installation facts 构造安装后的完整 ordinary-file 预期状态.
 * Release-managed bytes 来自准确 version checkout 的 Installation Payload; config 在已存在时保留,
 * 否则使用同一 Release 的 seed; Linux isolated home 的 profile 在首次安装时取得规范 PATH marker.
 */
const buildExpectedInstallationState = (/** @type {{before: SnapshotEntry[], installationDirectory: string, machineKey: string, manifest: unknown, release: unknown}} */ {before, installationDirectory, machineKey, manifest, release}) => {
    if (!Array.isArray(before)
        || !isRecord(release)
        || !Array.isArray(release.managedFiles)
        || release.managedFiles.some((/** @type {unknown} */ path) => typeof path !== 'string')
        || !(release.sourceFiles instanceof Map)
        || !Buffer.isBuffer(release.configSeedBytes)) {
        throw new Error('Release installation expected state is invalid.');
    }
    /** @type {Map<string, Buffer>} */
    const sourceFiles = new Map();
    for (const [path, bytes] of release.sourceFiles) {
        if (typeof path !== 'string' || !Buffer.isBuffer(bytes)) throw new Error('Release installation expected managed bytes are unavailable.');
        sourceFiles.set(path, bytes);
    }
    const managedFiles = release.managedFiles.filter((/** @type {unknown} */ path) => typeof path === 'string');
    const beforeByPath = new Map(before.map(entry => [entry.path, entry]));
    /** @type {CapturedEntry[]} */
    const entries = managedFiles.map(path => {
        const bytes = sourceFiles.get(path);
        if (!Buffer.isBuffer(bytes)) throw new Error('Release installation expected managed bytes are unavailable.');
        return {
            bytesBase64: bytes.toString('base64'),
            path: joinRelativePath('.agent-repository-workflow', path),
            type: 'ordinary-file',
        };
    });
    const priorConfiguration = beforeByPath.get(FINITE_CONFIG_PATH);
    if (priorConfiguration !== undefined) {
        if (priorConfiguration.type !== 'ordinary-file' || typeof priorConfiguration.bytesBase64 !== 'string') {
            throw new Error('Release installation expected configuration is invalid.');
        }
        const conversion = convertConfiguration({
            rules: GLOBAL_CONFIGURATION_RULES,
            sourceBytes: Buffer.from(priorConfiguration.bytesBase64, 'base64'),
        });
        if (conversion.status !== 'succeeded') {
            throw new Error('Release installation expected configuration conversion failed.');
        }
        const completed = completeGlobalConfigurationBytes(conversion.bytes);
        entries.push({bytesBase64: completed.bytes.toString('base64'), path: priorConfiguration.path, type: priorConfiguration.type});
    } else {
        entries.push({
            bytesBase64: release.configSeedBytes.toString('base64'),
            path: FINITE_CONFIG_PATH,
            type: 'ordinary-file',
        });
    }
    const modelPath = '.codex/models.custom.json';
    const priorModels = beforeByPath.get(modelPath);
    let modelBytes;
    if (priorModels === undefined) {
        const initial = serializeJson({models: [], providers: {openai: {maxInstances: 4}}}, {format: 'compact'});
        if (initial.status !== 'succeeded') throw new Error('Release installation expected model catalog is unavailable.');
        modelBytes = initial.bytes;
    } else {
        if (priorModels.type !== 'ordinary-file' || typeof priorModels.bytesBase64 !== 'string') {
            throw new Error('Release installation expected model catalog is invalid.');
        }
        modelBytes = completeConfigurationBytes({
            sourceBytes: Buffer.from(priorModels.bytesBase64, 'base64'),
            defaults: {providers: {openai: {maxInstances: 4}}},
        }).bytes;
    }
    entries.push({bytesBase64: modelBytes.toString('base64'), path: modelPath, type: 'ordinary-file'});
    const platformState = machineKey === 'Windows 11' && (manifest === undefined || manifest === null)
        ? {entry: null, pathOwnership: []}
        : expectedInstallationPlatformState({before, installationDirectory, machineKey, manifest});
    if (platformState.entry !== null) entries.push(platformState.entry);
    return {
        expectedEntries: entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
        expectedPathOwnership: platformState.pathOwnership,
    };
};

export const buildExpectedInstallationEntries = (/** @type {{before: SnapshotEntry[], installationDirectory: string, machineKey: string, manifest: unknown, release: unknown}} */ input) => buildExpectedInstallationState(input).expectedEntries;

export const loadExpectedInstallationRelease = async (/** @type {{expectedSource: string, expectedVersion: string, platform: string}} */ {expectedSource, expectedVersion, platform}) => {
    const commit = requireSuccess(
        await runGit(expectedSource, ['rev-parse', '--verify', 'HEAD^{commit}']),
        'Guest expected Release identity resolution',
    ).trim();
    const releaseModulePath = pathToFileURL(join(expectedSource, 'lib', 'installation', 'release.mjs')).href;
    const payloadModulePath = pathToFileURL(join(expectedSource, 'lib', 'installation', 'installation-payload.mjs')).href;
    const [{loadRelease}, {loadInstallationPayload}] = await Promise.all([
        import(releaseModulePath),
        import(payloadModulePath),
    ]);
    const release = await loadRelease({
        evidence: {commit, explicitVersion: true, tag: expectedVersion},
        platform,
        sourceDirectory: expectedSource,
    });
    if (!isRecord(release) || release.status !== 'succeeded') return release;
    const payload = await loadInstallationPayload({platform, sourceDirectory: expectedSource});
    if (!isRecord(payload)
        || payload.status !== 'succeeded'
        || !Array.isArray(payload.payload)
        || !Buffer.isBuffer(payload.configSeedBytes)) {
        return payload;
    }
    return {
        ...release,
        configSeedBytes: Buffer.from(payload.configSeedBytes),
        managedFiles: payload.payload.map((/** @type {{path: string}} */ entry) => entry.path),
        sourceFiles: new Map(payload.payload.map((/** @type {{bytes: Buffer, path: string}} */ entry) => [
            entry.path,
            Buffer.from(entry.bytes),
        ])),
    };
};

export const captureSelectedReleaseInstallation = async (
    /** @type {{before: SnapshotEntry[], expectedSource: string, expectedVersion: string, machineKey: string, state: ScenarioState}} */ {before, expectedSource, expectedVersion, machineKey, state},
    /** @type {{runProcess?: ProcessRunner}} */ {runProcess = run} = {},
) => {
    const installationDirectory = join(state.homeDirectory, '.agent-repository-workflow');
    let manifest = null;
    try {
        manifest = JSON.parse(await readFile(join(installationDirectory, 'manifest.json'), 'utf8'));
    } catch {
    }
    if (!isRecord(manifest)
        || !Array.isArray(manifest.managedFiles)
        || manifest.managedFiles.some((/** @type {unknown} */ path) => typeof path !== 'string' || !isSafeReleaseRelativePath(path))) {
        throw new Error('Prior Release installed manifest is invalid.');
    }
    const expectedManagedEntries = await Promise.all(manifest.managedFiles.map(async (/** @type {string} */ path) => ({
        bytesBase64: (await readFile(join(expectedSource, ...path.split('/')))).toString('base64'),
        path: joinRelativePath('.agent-repository-workflow', path),
        type: 'ordinary-file',
    })));
    const releaseManifest = JSON.parse(await readFile(join(expectedSource, 'release-manifest.json'), 'utf8'));
    if (!isRecord(releaseManifest)
        || typeof releaseManifest.configSeed !== 'string'
        || !isSafeReleaseRelativePath(releaseManifest.configSeed)) {
        throw new Error('Prior Release config seed identity is invalid.');
    }
    const platformState = expectedInstallationPlatformState({before, installationDirectory, machineKey, manifest});
    return {
        expectedConfigurationEntry: {
            bytesBase64: (await readFile(join(expectedSource, ...releaseManifest.configSeed.split('/')))).toString('base64'),
            path: FINITE_CONFIG_PATH,
            type: 'ordinary-file',
        },
        expectedManagedEntries: expectedManagedEntries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
        expectedPathOwnership: platformState.pathOwnership,
        expectedPlatformEntry: platformState.entry,
        expectedVersion,
        manifest,
        validationAuthority: 'selected-release-installer',
        versionOutcome: await runProcess(process.execPath, [installedEntry(state), '--version'], {
            cwd: state.scenarioRoot,
            env: installationEnvironment(state),
        }),
    };
};

const captureCommandMechanicalObservation = async (/** @type {{after: SnapshotEntry[], before: SnapshotEntry[], preparation: {expectedState?: unknown, plan?: unknown} | null, request: GuestRequest, state: ScenarioState, step: ReleaseStep}} */ {after, before, preparation, request, state, step}) => {
    if (step.mechanicalContract === 'repository-workflow-transition') {
        const verificationOutcome = await run(process.execPath, [installedEntry(state), 'workflow', 'verify'], {
            cwd: state.targetDirectory,
            env: installationEnvironment(state),
        });
        if (preparation === null) throw new Error('Release workflow mechanical preparation is unavailable.');
        return {expectedState: preparation.expectedState, plan: preparation.plan, verificationOutcome};
    }
    if (typeof step.mechanicalContract === 'string'
        && ['launcher-observation', 'esm-syntax-observation', 'repository-verification'].includes(step.mechanicalContract)) {
        return step.mechanicalContract === 'repository-verification'
            ? runRepositoryAction(request, state, step)
            : runObservationAction(request, state, step);
    }
    if (step.mechanicalContract === 'installation-transition') {
        const parameters = step.mechanicalParameters;
        if (!isRecord(parameters)) throw new Error('Release installation mechanical parameters are invalid.');
        if (parameters.action === 'reject-default-downgrade') {
            return {stateUnchanged: JSON.stringify(before) === JSON.stringify(after)};
        }
        if (parameters.action === 'uninstall') {
            const baseline = JSON.parse(await readFile(join(state.scenarioRoot, 'runner-state', 'final-state-baseline.json'), 'utf8'));
            const observed = await executeReleaseFiniteOperation({
                auditedDirectory: state.homeDirectory,
                baseline,
                machineKey: request.machineKey,
                operationContract: 'observe-installation-final-state',
                operationParameters: {},
                sourceRecord: null,
            });
            if (observed.status !== 'completed') throw new Error('message' in observed && typeof observed.message === 'string' ? observed.message : 'Final state observation failed.');
            return observed.actual;
        }
        const priorRelease = parameters.expectedVersion === 'prior-release' ? await resolvePriorRelease(state) : null;
        const expectedSource = priorRelease?.sourceDirectory ?? state.sourceDirectory;
        const platformKey = request.machineKey === 'Windows 11' ? 'win32' : 'linux';
        const expectedVersion = priorRelease?.tag ?? state.tag;
        if (priorRelease !== null) {
            return captureSelectedReleaseInstallation({
                before,
                expectedSource,
                expectedVersion,
                machineKey: request.machineKey,
                state,
            });
        }
        const release = await loadExpectedInstallationRelease({expectedSource, expectedVersion, platform: platformKey});
        let manifest = null;
        try {
            manifest = JSON.parse(await readFile(join(state.homeDirectory, '.agent-repository-workflow', 'manifest.json'), 'utf8'));
        } catch {
        }
        const installationDirectory = join(state.homeDirectory, '.agent-repository-workflow');
        const expectedState = buildExpectedInstallationState({
            before,
            installationDirectory,
            machineKey: request.machineKey,
            manifest,
            release,
        });
        return {
            expectedEntries: expectedState.expectedEntries,
            expectedManagedFiles: isRecord(release) && Array.isArray(release.managedFiles) ? release.managedFiles : [],
            expectedPathOwnership: expectedState.expectedPathOwnership,
            expectedVersion,
            manifest,
        };
    }
    return null;
};

const runObservationAction = async (/** @type {GuestRequest} */ request, /** @type {ScenarioState} */ state, /** @type {ReleaseStep} */ step) => {
    const env = installationEnvironment(state);
    if (step.mechanicalContract === 'installation-transition') {
        return runInstallationTransition({cwd: state.scenarioRoot, parameters: step.mechanicalParameters, state});
    }
    if (step.mechanicalContract === 'esm-syntax-observation') return checkLifecycleEntries(state);
    if (step.mechanicalContract !== 'launcher-observation' || !isRecord(step.mechanicalParameters)) {
        throw new Error(`Release guest Installation action is not registered: ${request.stepId}.`);
    }
    const {shell, sourceAvailable} = step.mechanicalParameters;
    if (sourceAvailable === false && shell === 'direct') return runWithSourceUnavailable(state);
    if (sourceAvailable !== true || typeof shell !== 'string') {
        throw new Error('Release launcher observation parameters are invalid.');
    }
    if (shell === 'powershell' || shell === 'cmd' || shell === 'git-bash') return runWindowsLauncher(state, shell);
    if (shell === 'login-shell') return runLoginShellLauncher(state);
    if (shell === 'direct') {
        const launcher = process.platform === 'win32' ? 'arw.cmd' : 'arw';
        const executable = join(state.homeDirectory, '.agent-repository-workflow', launcher);
        return process.platform === 'win32'
            ? runWindowsBatchVersion(executable, {cwd: state.scenarioRoot, env})
            : run(executable, ['--version'], {cwd: state.scenarioRoot, env});
    }
    throw new Error('Release launcher observation parameters are invalid.');
};

const runMainAgentAction = async (/** @type {GuestRequest} */ request, /** @type {ScenarioState} */ state, /** @type {ReleaseStep} */ step) => {
    const finiteStep = step.operationContract;
    if (finiteStep !== null) {
        const recordRoot = join(state.scenarioRoot, 'runner-state', 'operations');
        await mkdir(recordRoot, {recursive: true});
        let sourceRecord = null;
        if (finiteStep === 'remove-test-residue') {
            try {
                sourceRecord = JSON.parse(await readFile(join(recordRoot, 'add-unknown-content.json'), 'utf8'));
            } catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
            }
        }
        const baseline = finiteStep === 'observe-installation-final-state'
            ? JSON.parse(await readFile(join(state.scenarioRoot, 'runner-state', 'final-state-baseline.json'), 'utf8'))
            : null;
        const result = await executeReleaseFiniteOperation({
            auditedDirectory: state.homeDirectory,
            baseline,
            machineKey: request.machineKey,
            operationContract: finiteStep,
            operationParameters: step.operationParameters,
            sourceRecord,
        });
        await writeFile(join(recordRoot, `${finiteStep}.json`), `${JSON.stringify(result)}\n`, {flag: 'wx'});
        return;
    }
    if (step.command === false && step.judgment === 'semantic') {
        await requireCompletedInitializationIssue(state);
        return;
    }
    throw new Error(`Release guest Main Agent action is not registered: ${request.stepId}.`);
};

const capture = async (/** @type {{auditedDirectory: string, commandOutcome?: unknown, request: GuestRequest}} */ {auditedDirectory, commandOutcome, request}) => {
    const base = await diffBase(auditedDirectory);
    const status = await runGit(auditedDirectory, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const headToIndex = await runGit(auditedDirectory, ['diff', '--cached', '--no-ext-diff', '--binary', '--full-index', base, '--']);
    const indexToWorkingTree = await runGit(auditedDirectory, ['diff', '--no-ext-diff', '--binary', '--full-index', '--']);
    const statusBytes = Buffer.from(requireSuccess(status, 'Guest Git status capture'));
    const {changes, untrackedPaths} = parseReleaseGitStatus(statusBytes);
    const content = await inspectReleaseUntrackedEntries(auditedDirectory, untrackedPaths);
    return {
        auditedDirectory,
        changes,
        machineKey: request.machineKey,
        reviewMaterial: {
            headToIndexDiff: Buffer.from(requireSuccess(headToIndex, 'Guest HEAD-to-index diff capture')).toString('base64'),
            indexToWorkingTreeDiff: Buffer.from(requireSuccess(indexToWorkingTree, 'Guest index-to-working-tree diff capture')).toString('base64'),
            nonRegularEntries: content.nonRegularEntries,
            status: statusBytes.toString('base64'),
            untrackedFiles: content.ordinaryFiles,
            ...(commandOutcome === undefined ? {} : {commandOutcome}),
        },
        scenarioId: request.scenarioId,
        status: 'captured',
        stepId: request.stepId,
    };
};

export const captureReleaseMechanicalSnapshot = async (/** @type {string} */ auditedDirectory) => {
    /** @type {SnapshotEntry[]} */
    const entries = [];
    const root = resolve(auditedDirectory);
    const listed = requireSuccess(
        await runGit(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']),
        'Release mechanical snapshot path enumeration',
    );
    for (const relativePath of listed.split('\0')) {
        if (relativePath.length === 0) continue;
        if (!isSafeReleaseRelativePath(relativePath)) throw new Error('Release mechanical snapshot contains an unsafe path.');
        const path = join(root, ...relativePath.split('/'));
        let stats;
        try {
            stats = await lstat(path);
        } catch (error) {
            if (missingFile(error)) continue;
            throw error;
        }
        const type = finiteEntryType(stats);
        entries.push({
            bytesBase64: type === 'ordinary-file' ? (await readFile(path)).toString('base64') : null,
            path: relativePath,
            type,
        });
    }
    return entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
};

const currentFiniteObservation = async (/** @type {{operationContract: string | null, operationResult: unknown, state: ScenarioState}} */ {operationContract, operationResult, state}) => {
    if (!isRecord(operationResult) || operationResult.status !== 'completed' || !isRecord(operationResult.actual)) return null;
    if (operationContract === 'prepare-preserved-configuration') return {
        config: operationResult.actual.afterConfig,
        path: operationResult.actual.path,
    };
    if (operationContract === 'add-unknown-content') return {
        bytesBase64: operationResult.actual.bytesBase64,
        entryType: 'ordinary-file',
        path: operationResult.actual.path,
    };
    if (operationContract === 'remove-test-residue') return {
        exists: operationResult.actual.existsAfter,
        path: operationResult.actual.path,
    };
    if (operationContract === 'observe-installation-final-state') return operationResult.actual;
    return null;
};

const observeFiniteStateWithoutOperation = async (/** @type {{machineKey: string, operationContract: string | null, state: ScenarioState}} */ {machineKey, operationContract, state}) => {
    if (operationContract === 'prepare-preserved-configuration') {
        const config = JSON.parse(await readFile(join(state.homeDirectory, ...FINITE_CONFIG_PATH.split('/')), 'utf8'));
        return {config, path: FINITE_CONFIG_PATH};
    }
    if (operationContract === 'add-unknown-content') {
        const path = join(state.homeDirectory, ...FINITE_UNKNOWN_PATH.split('/'));
        const stats = await lstat(path);
        return {
            bytesBase64: (await readFile(path)).toString('base64'),
            entryType: finiteEntryType(stats),
            path: FINITE_UNKNOWN_PATH,
        };
    }
    if (operationContract === 'remove-test-residue') {
        try {
            await lstat(join(state.homeDirectory, ...FINITE_UNKNOWN_PATH.split('/')));
            return {exists: true, path: FINITE_UNKNOWN_PATH};
        } catch (error) {
            if (!missingFile(error)) throw error;
            return {exists: false, path: FINITE_UNKNOWN_PATH};
        }
    }
    if (operationContract === 'observe-installation-final-state') {
        const baseline = JSON.parse(await readFile(join(state.scenarioRoot, 'runner-state', 'final-state-baseline.json'), 'utf8'));
        const result = await executeReleaseFiniteOperation({
            auditedDirectory: state.homeDirectory,
            baseline,
            machineKey,
            operationContract,
            operationParameters: {},
            sourceRecord: null,
        });
        return result.status === 'completed' ? result.actual : null;
    }
    return null;
};

const main = async () => {
    const request = parseArguments(process.argv.slice(2));
    const resolved = resolveReleaseValidationStep({
        machineKey: request.machineKey,
        scenarioId: request.scenarioId,
        stepId: request.stepId,
    });
    const registeredChoices = Object.fromEntries(Object.entries(resolved.step.choiceParameters ?? {}).filter(([, value]) => value !== null));
    if (request.choices !== null && JSON.stringify(request.choices) !== JSON.stringify(registeredChoices)) {
        throw new Error('Release guest helper frozen choices do not match the registered contract.');
    }
    request.choices = request.choices ?? registeredChoices;
    const state = request.scenarioPrepared
        ? await readPreparedScenario(request)
        : await prepareScenario(request, {
            stepIndex: resolved.step.index,
            versionFixturesRequired: resolved.scenario.prerequisites.includes('prior-release-fixture'),
        });
    if (request.prepareOnly) {
        await savePreparedScenario(request, state);
        process.stdout.write(`${JSON.stringify({
            auditedDirectory: resolved.step.auditedLocation === 'repository'
                ? state.targetDirectory
                : resolved.step.auditedLocation === 'source-checkout'
                    ? state.sourceDirectory
                    : state.installationAuditDirectory,
            homeDirectory: state.homeDirectory,
            scenarioId: request.scenarioId,
            sourceDirectory: state.sourceDirectory,
            status: 'prepared',
            targetDirectory: state.targetKind === null ? null : state.targetDirectory,
            workspaceDirectory: state.scenarioRoot,
        })}\n`);
        return;
    }
    const mainAgentStep = !resolved.step.command;
    const auditedDirectory = resolved.step.auditedLocation === 'repository'
        ? state.targetDirectory
        : resolved.step.auditedLocation === 'source-checkout'
            ? state.sourceDirectory
            : state.installationAuditDirectory;
    const before = await captureReleaseMechanicalSnapshot(auditedDirectory);
    const commandObservationPreparation = resolved.step.command
        ? await prepareCommandMechanicalObservation({before, request, state, step: resolved.step})
        : null;
    let commandOutcome;
    if (request.observeOnly) {
    } else if (mainAgentStep) {
        await runMainAgentAction(request, state, resolved.step);
    } else {
        commandOutcome = resolved.scenario.targetKind !== null
            ? await runRepositoryAction(request, state, resolved.step)
            : await runObservationAction(request, state, resolved.step);
    }
    if (request.machineKey === 'Windows 11' && auditedDirectory === state.installationAuditDirectory) {
        await syncWindowsPathObservation(state);
    }
    const captured = await capture({auditedDirectory, commandOutcome, request});
    const after = await captureReleaseMechanicalSnapshot(auditedDirectory);
    let operationActual = request.observeOnly ? null : commandOutcome;
    if (!request.observeOnly && !resolved.step.command && resolved.step.operationContract !== null) {
        const operationPath = join(state.scenarioRoot, 'runner-state', 'operations', `${resolved.step.operationContract}.json`);
        operationActual = JSON.parse(await readFile(operationPath, 'utf8'));
    }
    if (resolved.step.judgment === 'mechanical') {
        const mechanicalInputPath = join(
            state.scenarioRoot,
            'runner-state',
            'steps',
            request.stepId,
            request.observeOnly ? `${request.captureId}.json` : 'mechanical-input.json',
        );
        await mkdir(dirname(mechanicalInputPath), {recursive: true});
        await writeFile(mechanicalInputPath, `${JSON.stringify({
            capturedFacts: {after, before},
            currentObservation: resolved.step.command
                ? await captureCommandMechanicalObservation({
                    after,
                    before,
                    preparation: commandObservationPreparation,
                    request,
                    state,
                    step: resolved.step,
                })
                : request.observeOnly
                    ? await observeFiniteStateWithoutOperation({
                        machineKey: request.machineKey,
                        operationContract: resolved.step.operationContract,
                        state,
                    })
                    : await currentFiniteObservation({
                        operationContract: resolved.step.operationContract,
                        operationResult: operationActual,
                        state,
                    }),
            operationActual,
        })}\n`, {flag: 'wx'});
    }
    process.stdout.write(`${JSON.stringify(captured)}\n`);
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
