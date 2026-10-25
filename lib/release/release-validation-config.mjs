import {fileURLToPath} from 'node:url';

import {createScopedFilesystem} from '../common/filesystem.mjs';
import {exactKeys, parseJson} from '../common/json.mjs';
import {
    RELEASE_MACHINE_KEYS,
    resolveReleaseValidationRegistry,
} from './release-validation-registry.mjs';

const TOP_LEVEL_KEYS = ['initializationIssueScenario', 'prepareBundles', 'repositories', 'vmware'];
const REPOSITORY_KEYS = ['sourceCheckout'];
const SOURCE_CHECKOUT_KEYS = ['url'];
const PREPARE_BUNDLES_KEYS = ['hostCommandTimeoutMs'];
const VMWARE_KEYS = ['hardPowerOffCompatibility', 'softPowerOffTimeoutMs'];
const HARD_POWER_OFF_KEYS = ['exitCode', 'stderr', 'stdoutTemplate', 'vmrunVersion'];
const MACHINE_LOCATION_TOKEN = '{machineLocation}';

export const RELEASE_VALIDATION_REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** @typedef {{code: string, message: string}} ReleaseValidationDiagnostic */
/** @typedef {{url: string}} ReleaseValidationSourceCheckout */
/** @typedef {{hostCommandTimeoutMs: number}} ReleaseValidationPrepareBundles */
/** @typedef {{exitCode: number, stderr: string, stdoutTemplate: string, vmrunVersion: string}} ReleaseValidationHardPowerOffCompatibility */
/** @typedef {{hardPowerOffCompatibility: ReleaseValidationHardPowerOffCompatibility, softPowerOffTimeoutMs: Record<string, number>}} ReleaseValidationVmware */
/**
 * @typedef {object} ReleaseValidationConfiguration
 * @property {string} initializationIssueScenario
 * @property {ReleaseValidationPrepareBundles} prepareBundles
 * @property {{sourceCheckout: ReleaseValidationSourceCheckout}} repositories
 * @property {ReleaseValidationVmware} vmware
 */

/** @param {string} code @param {string} message @returns {{diagnostics: ReleaseValidationDiagnostic[], status: 'blocked'}} */
const blocked = (code, message) => ({diagnostics: [{code, message}], status: 'blocked'});

/** @param {unknown} value @returns {value is number} */
const validPositiveInteger = value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** @param {unknown} value @returns {value is string} */
const validHttpsUrl = value => {
    if (typeof value !== 'string' || value.length === 0) return false;
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        return false;
    }
    if (parsed === undefined) return false;
    return parsed.protocol === 'https:'
        && parsed.username.length === 0
        && parsed.password.length === 0
        && parsed.hostname.length > 0
        && parsed.pathname.startsWith('/')
        && parsed.pathname.endsWith('.git')
        && parsed.search === ''
        && parsed.hash === '';
};

/** @param {unknown} value @returns {value is ReleaseValidationHardPowerOffCompatibility} */
const validHardPowerOffCompatibility = value => {
    if (!exactKeys(value, HARD_POWER_OFF_KEYS)
        || typeof value.exitCode !== 'number'
        || !Number.isSafeInteger(value.exitCode)
        || value.exitCode < 0
        || typeof value.stderr !== 'string'
        || typeof value.stdoutTemplate !== 'string'
        || typeof value.vmrunVersion !== 'string'
        || value.vmrunVersion.length === 0) return false;
    const first = value.stdoutTemplate.indexOf(MACHINE_LOCATION_TOKEN);
    return first !== -1
        && value.stdoutTemplate.indexOf(MACHINE_LOCATION_TOKEN, first + MACHINE_LOCATION_TOKEN.length) === -1;
};

/** @param {unknown} value @returns {value is ReleaseValidationPrepareBundles} */
const validPrepareBundles = value => exactKeys(value, PREPARE_BUNDLES_KEYS)
    && validPositiveInteger(value.hostCommandTimeoutMs);

/** @param {unknown} value @returns {value is ReleaseValidationConfiguration['repositories']} */
const validRepositories = value => exactKeys(value, REPOSITORY_KEYS)
    && exactKeys(value.sourceCheckout, SOURCE_CHECKOUT_KEYS)
    && validHttpsUrl(value.sourceCheckout.url);

/** @param {unknown} value @returns {value is Record<string, number>} */
const validSoftPowerOffTimeoutMs = value => exactKeys(value, RELEASE_MACHINE_KEYS)
    && RELEASE_MACHINE_KEYS.every(key => validPositiveInteger(value[key]));

/** @param {unknown} value @returns {value is ReleaseValidationVmware} */
const validVmware = value => exactKeys(value, VMWARE_KEYS)
    && validHardPowerOffCompatibility(value.hardPowerOffCompatibility)
    && validSoftPowerOffTimeoutMs(value.softPowerOffTimeoutMs);

/** @param {ReleaseValidationConfiguration} value */
const freezeConfiguration = value => Object.freeze({
    initializationIssueScenario: value.initializationIssueScenario,
    prepareBundles: Object.freeze({...value.prepareBundles}),
    repositories: Object.freeze({
        sourceCheckout: Object.freeze({...value.repositories.sourceCheckout}),
    }),
    vmware: Object.freeze({
        hardPowerOffCompatibility: Object.freeze({...value.vmware.hardPowerOffCompatibility}),
        softPowerOffTimeoutMs: Object.freeze({...value.vmware.softPowerOffTimeoutMs}),
    }),
});

/** 验证根 release-validation.json 的准确无版本 schema, 并返回冻结配置. */
/** @param {unknown} value */
export const validateReleaseValidationConfiguration = value => {
    if (!exactKeys(value, TOP_LEVEL_KEYS)) {
        return blocked('release-validation-config-shape-invalid', 'Release validation configuration fields are invalid.');
    }
    if (!validRepositories(value.repositories)) {
        return blocked('release-validation-repositories-invalid', 'Release validation Repository sources are invalid.');
    }
    if (!validPrepareBundles(value.prepareBundles)) {
        return blocked('release-validation-prepare-bundles-invalid', 'Release validation bundle preparation settings are invalid.');
    }
    if (!validVmware(value.vmware)) {
        return blocked('release-validation-vmware-invalid', 'Release validation VMware settings are invalid.');
    }
    const registry = resolveReleaseValidationRegistry(value.initializationIssueScenario);
    if (registry.status !== 'succeeded') return registry;
    if (typeof value.initializationIssueScenario !== 'string') {
        throw new Error('A succeeded release validation Registry requires a string scenario identity.');
    }
    return {diagnostics: [], status: 'succeeded', value: freezeConfiguration({
        initializationIssueScenario: value.initializationIssueScenario,
        prepareBundles: value.prepareBundles,
        repositories: value.repositories,
        vmware: value.vmware,
    })};
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

/** @param {{configuration: ReleaseValidationConfiguration, machineLocation: string}} options */
export const renderVmwareCompatibilityStdout = ({configuration, machineLocation}) => configuration.vmware
    .hardPowerOffCompatibility.stdoutTemplate.replace(MACHINE_LOCATION_TOKEN, machineLocation);
