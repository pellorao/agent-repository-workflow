import {isAbsolute} from 'node:path';

import {createScopedFilesystem} from '../common/filesystem.mjs';
import {completeConfigurationBytes, parseJson, parseJsonText} from '../common/json.mjs';
import {defaultGlobalReviewers, validateReviewerConfiguration} from './reviewer-configuration.mjs';

export const CONFIG_FILE_NAME = 'config.json';
export const FILE_ARGUMENT = '{file}';
export const BACKGROUND_AGENT_DEFAULTS = Object.freeze({
    maxInstances: 16,
    messageTimeoutMs: 5_000,
    persistenceIntervalMs: 1_000,
    earlyExitNotificationThreshold: 10,
});

/** @typedef {{args: string[], command: string}} ConfiguredCommand */
/** @typedef {{agents: Record<string, ConfiguredCommand>, configVersion: 1 | 3, editor: ConfiguredCommand, jira?: {listLimit: number}, reviewEditor?: ConfiguredCommand, reviewers?: Record<string, import('./reviewer-configuration.mjs').ReviewerSettings>, backgroundAgent?: {maxInstances: number, messageTimeoutMs: number, persistenceIntervalMs: number, earlyExitNotificationThreshold: number}}} ValidatedConfig */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** @param {unknown} value @returns {value is string[]} */
const isStringArray = value => Array.isArray(value) && value.every(entry => typeof entry === 'string');

/** @param {unknown} value @returns {value is 1 | 3} */
const isSupportedConfigVersion = value => value === 1 || value === 3;

/** @param {string} message @returns {never} */
function invalidConfig(message) {
    throw new Error(`Invalid configuration: ${message}`);
}

/** @param {unknown} command @param {string} label @returns {asserts command is string} */
function validateCommand(command, label) {
    if (typeof command !== 'string' || command.length === 0) {
        invalidConfig(`${label} must be a non-empty PATH command or absolute path.`);
    }

    const looksLikePath = command.includes('/') || command.includes('\\') || command.includes(':');

    if (looksLikePath && !isAbsolute(command)) {
        invalidConfig(`${label} must not be a relative path.`);
    }
}

/** @param {unknown} value @param {string} label @returns {ConfiguredCommand} */
const validateEditor = (value, label) => {
    if (!isObject(value)) invalidConfig(`${label} must be an object.`);
    validateCommand(value.command, `${label}.command`);
    if (!isStringArray(value.args)) {
        invalidConfig(`${label}.args must be an array of strings.`);
    }
    const fileArgumentCount = value.args.reduce(
        (count, argument) => count + (argument.match(/\{file\}/g) ?? []).length,
        0,
    );
    if (fileArgumentCount !== 1) {
        invalidConfig(`${label}.args must contain exactly one ${FILE_ARGUMENT} placeholder.`);
    }
    return {args: [...value.args], command: value.command};
};

/** @param {unknown} value @returns {ValidatedConfig} */
export const validateConfig = value => {
    if (!isObject(value) || !isSupportedConfigVersion(value.configVersion)) {
        invalidConfig('configVersion must be 1 or 3.');
    }

    const editor = validateEditor(value.editor, 'editor');
    const reviewEditor = value.configVersion === 3
        ? validateEditor(value.reviewEditor, 'reviewEditor')
        : undefined;
    let jira;
    let reviewers;
    let backgroundAgent;
    if (value.configVersion === 3) {
        if (!isObject(value.jira)) invalidConfig('jira must be an object.');
        const listLimit = value.jira.listLimit;
        if (typeof listLimit !== 'number' || !Number.isSafeInteger(listLimit) || listLimit <= 0) {
            invalidConfig('jira.listLimit must be a positive safe integer.');
        }
        jira = {listLimit};
        try {
            const configured = validateReviewerConfiguration(value.reviewers, 'reviewers');
            reviewers = Object.fromEntries(Object.entries(defaultGlobalReviewers()).map(([role, defaults]) => [role, {...defaults, ...configured[role]}]));
        } catch (error) {
            invalidConfig(error instanceof Error ? error.message : String(error));
        }
        if (value.backgroundAgent !== undefined && !isObject(value.backgroundAgent)) invalidConfig('backgroundAgent must be an object.');
        const configuredBackground = isObject(value.backgroundAgent) ? value.backgroundAgent : {};
        if (Object.keys(configuredBackground).some(key => !Object.hasOwn(BACKGROUND_AGENT_DEFAULTS, key))) {
            invalidConfig('backgroundAgent contains an unsupported field.');
        }
        backgroundAgent = /** @type {NonNullable<ValidatedConfig['backgroundAgent']>} */ ({...BACKGROUND_AGENT_DEFAULTS});
        for (const key of /** @type {Array<keyof typeof BACKGROUND_AGENT_DEFAULTS>} */ (Object.keys(BACKGROUND_AGENT_DEFAULTS))) {
            const field = configuredBackground[key];
            if (field === undefined) continue;
            if (typeof field !== 'number' || !Number.isSafeInteger(field) || field <= 0) {
                invalidConfig(`backgroundAgent.${key} must be a positive safe integer.`);
            }
            backgroundAgent[key] = /** @type {number} */ (field);
        }
    }

    const sourceAgents = Object.hasOwn(value, 'agents') ? value.agents : {};
    if (!isObject(sourceAgents)) invalidConfig('agents must be an object.');
    const agents = Object.fromEntries(Object.entries(sourceAgents).map(([name, agent]) => {
        const label = `agents[${JSON.stringify(name)}]`;
        if (!isObject(agent)) invalidConfig(`${label} must be an object.`);
        const keys = Object.keys(agent).sort();
        if (keys.length !== 2 || keys[0] !== 'args' || keys[1] !== 'command') {
            invalidConfig(`${label} must contain only command and args.`);
        }
        validateCommand(agent.command, `${label}.command`);
        if (!isStringArray(agent.args)) {
            invalidConfig(`${label}.args must be an array of strings.`);
        }
        return [name, {args: [...agent.args], command: agent.command}];
    }));

    return {
        agents,
        configVersion: value.configVersion,
        editor,
        ...(reviewEditor === undefined ? {} : {reviewEditor}),
        ...(jira === undefined ? {} : {jira}),
        ...(reviewers === undefined ? {} : {reviewers}),
        ...(backgroundAgent === undefined ? {} : {backgroundAgent}),
    };
};

/** @param {unknown} value @param {1 | 3} version */
const validateRuleVersion = (value, version) => {
    try {
        const validated = validateConfig(value);
        if (validated.configVersion !== version) invalidConfig(`configVersion must be ${version}.`);
        return [];
    } catch (error) {
        return [{
            code: 'global-configuration-invalid',
            message: error instanceof Error ? error.message : String(error),
        }];
    }
};

export const GLOBAL_CONFIGURATION_RULES = {
    versions: [
        {
            conversions: [],
            fields: [
                {defaultValue: 1, path: 'configVersion', required: true},
                {defaultValue: {}, path: 'agents', required: false},
                {path: 'editor', required: true},
                {defaultValue: 'code', path: 'editor.command', required: true},
                {defaultValue: [FILE_ARGUMENT], path: 'editor.args', required: true},
            ],
            validate: (/** @type {unknown} */ value) => validateRuleVersion(value, 1),
            version: 1,
        },
        {
            conversions: [{
                convert: (/** @type {unknown} */ value) => {
                    if (value !== 1) throw new Error('configVersion conversion requires source value 1.');
                    return 3;
                },
                sourcePath: 'configVersion',
                targetPath: 'configVersion',
            }],
            fields: [
                {defaultValue: 3, path: 'configVersion', required: true},
                {defaultValue: {}, path: 'agents', required: false},
                {path: 'editor', required: true},
                {defaultValue: 'code', path: 'editor.command', required: true},
                {defaultValue: [FILE_ARGUMENT], path: 'editor.args', required: true},
                {path: 'reviewEditor', required: true},
                {defaultValue: 'code', path: 'reviewEditor.command', required: true},
                {defaultValue: ['--new-window', '--wait', FILE_ARGUMENT], path: 'reviewEditor.args', required: true},
                {path: 'jira', required: true},
                {defaultValue: 50, path: 'jira.listLimit', required: true},
                {defaultValue: defaultGlobalReviewers(), path: 'reviewers', required: false},
                {path: 'backgroundAgent', required: false},
                ...Object.entries(BACKGROUND_AGENT_DEFAULTS).map(([key, defaultValue]) => ({
                    defaultValue, path: `backgroundAgent.${key}`, required: false,
                })),
            ],
            validate: (/** @type {unknown} */ value) => validateRuleVersion(value, 3),
            version: 3,
        },
    ],
};

/**
 * Installation calls this after version conversion, before planning its one
 * configuration transaction. Current-version conversion itself keeps bytes.
 * @param {Buffer} sourceBytes
 * @returns {{bytes: Buffer, changed: boolean}}
 */
export const completeGlobalConfigurationBytes = sourceBytes => {
    const parsed = parseJsonText(sourceBytes);
    if (parsed.status !== 'succeeded') throw new Error('Invalid configuration: config.json is not valid UTF-8 JSON.');
    validateConfig(parsed.value);
    return completeConfigurationBytes({
        sourceBytes,
        defaults: {reviewers: defaultGlobalReviewers(), backgroundAgent: BACKGROUND_AGENT_DEFAULTS},
    });
};

/** @param {string} programDirectory @returns {Promise<ValidatedConfig>} */
export const loadConfig = async programDirectory => {
    const opened = await createScopedFilesystem({root: programDirectory});
    if (opened.status !== 'succeeded') {
        throw new Error(`Configuration file could not be read: ${CONFIG_FILE_NAME}.`);
    }
    const parsed = await parseJson({filesystem: opened.scopedFilesystem, path: CONFIG_FILE_NAME});
    if (parsed.status !== 'succeeded') {
        const missing = parsed.diagnostics.some(diagnostic => diagnostic.code === 'filesystem-file-required');
        if (missing) {
            throw new Error(`Configuration file not found: ${CONFIG_FILE_NAME}.`);
        }
        const invalidUtf8 = parsed.diagnostics.some(diagnostic => diagnostic.code === 'json-invalid-utf8');
        const invalidJson = parsed.diagnostics.some(diagnostic => diagnostic.code === 'json-invalid');
        if (invalidUtf8 || invalidJson) {
            throw new Error(`Invalid configuration: config.json is not valid ${invalidUtf8 ? 'UTF-8' : 'JSON'}.`);
        }
        throw new Error(`Configuration file could not be read: ${CONFIG_FILE_NAME}.`);
    }
    if (!('value' in parsed)) throw new Error('JSON parser succeeded without a configuration value.');

    return validateConfig(parsed.value);
};
