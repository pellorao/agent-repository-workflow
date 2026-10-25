import {isJsonObject} from '../common/json.mjs';

export const REVIEWER_ROLES = Object.freeze([
    'code-standards-reviewer',
    'requirements-reviewer',
    'spec-readiness-reviewer',
]);

// Roles merged into `requirements-reviewer`; installed configurations still list them, so they are ignored.
const RETIRED_REVIEWER_ROLES = Object.freeze(['code-spec-reviewer', 'commit-audit-reviewer']);

export const DEFAULT_REVIEWER_SETTINGS = Object.freeze({
    model: 'gpt-6-luna',
    modelProvider: 'openai',
    reasoningEffort: 'xhigh',
    serviceTier: 'default',
});

export const CLAUDE_REVIEWER_SETTINGS = Object.freeze({
    model: 'haiku',
    modelProvider: 'anthropic',
    reasoningEffort: 'high',
    serviceTier: 'default',
});

const SETTING_FIELDS = Object.freeze(['model', 'modelProvider', 'reasoningEffort', 'serviceTier', 'env']);

/** @typedef {{model: string, modelProvider: string, reasoningEffort: string, serviceTier: 'default' | 'fast'}} ReviewerSettings */
/** @typedef {Partial<ReviewerSettings> & {env?: Record<string, string>}} ReviewerOverrides */
/** @typedef {Record<string, ReviewerOverrides>} ReviewerConfiguration */

/**
 * `env` holds variables for the Claude backend's `claude -p`, such as third-party model credentials,
 * so only the user-level configuration may carry it.
 * @param {unknown} value @param {string} label @param {{allowEnvironment?: boolean}} [options] @returns {ReviewerOverrides}
 */
export const validateReviewerFields = (value, label, {allowEnvironment = false} = {}) => {
    if (!isJsonObject(value)) throw new Error(`${label} must be an object.`);
    /** @type {ReviewerOverrides} */
    const result = {};
    for (const [key, field] of Object.entries(value)) {
        if (!SETTING_FIELDS.includes(key)) throw new Error(`${label}.${key} is not a supported Reviewer setting.`);
        if (key === 'env') {
            if (!allowEnvironment) throw new Error(`${label}.env is allowed only in the user-level ARW config.json, because it may hold credentials.`);
            if (!isJsonObject(field) || !Object.values(field).every(entry => typeof entry === 'string')) throw new Error(`${label}.env must map names to strings.`);
        } else if (key === 'serviceTier') {
            if (field !== 'default' && field !== 'fast') throw new Error(`${label}.serviceTier must be default or fast.`);
        } else if (typeof field !== 'string' || field.trim().length === 0) {
            throw new Error(`${label}.${key} must be a non-empty string.`);
        }
        Object.defineProperty(result, key, {value: field, enumerable: true, configurable: true, writable: true});
    }
    return result;
};

/** @param {unknown} value @param {string} label @param {{allowEnvironment?: boolean}} [options] @returns {ReviewerConfiguration} */
export const validateReviewerConfiguration = (value, label, options) => {
    if (value === undefined) return {};
    if (!isJsonObject(value)) throw new Error(`${label} must be an object.`);
    /** @type {ReviewerConfiguration} */
    const result = {};
    for (const [role, fields] of Object.entries(value)) {
        if (RETIRED_REVIEWER_ROLES.includes(role)) continue;
        if (!REVIEWER_ROLES.includes(role)) throw new Error(`${label}.${role} is not a supported Reviewer role.`);
        Object.defineProperty(result, role, {
            value: validateReviewerFields(fields, `${label}.${role}`, options),
            enumerable: true, configurable: true, writable: true,
        });
    }
    return result;
};

/** @returns {Record<string, ReviewerSettings>} */
export const defaultGlobalReviewers = () => Object.fromEntries(REVIEWER_ROLES.map(role => [role, {...DEFAULT_REVIEWER_SETTINGS}]));

/** @returns {ReviewerConfiguration} */
export const emptyRepositoryReviewers = () => Object.fromEntries(REVIEWER_ROLES.map(role => [role, {}]));

/**
 * Resolve only Reviewer model settings. The caller permits overrides only for an
 * isolated capability run; an ordinary review omits that argument.
 * A Claude Code Main uses the Claude defaults unless its configuration selects the `anthropic` provider.
 * @param {{role: string, globalConfig: {reviewers?: unknown}, repositoryConfig: {reviewers?: unknown}, overrides?: unknown, platform?: string}} input
 * @returns {ReviewerSettings}
 */
export const resolveReviewerSettings = ({role, globalConfig, repositoryConfig, overrides, platform = 'codex'}) => {
    if (!REVIEWER_ROLES.includes(role)) throw new Error(`Unsupported Reviewer role: ${role}.`);
    const global = validateReviewerConfiguration(globalConfig.reviewers, 'reviewers', {allowEnvironment: true});
    const repository = validateReviewerConfiguration(repositoryConfig.reviewers, 'reviewers');
    const selected = overrides === undefined ? {} : validateReviewerFields(overrides, 'overrides');
    // `env` stays out of the resolved settings, which are persisted; the Claude backend reads it when it starts a turn.
    const {env: _environment, ...configured} = {...DEFAULT_REVIEWER_SETTINGS, ...global[role], ...repository[role]};
    return /** @type {ReviewerSettings} */ ({
        ...(platform === 'claude-code' && configured.modelProvider !== CLAUDE_REVIEWER_SETTINGS.modelProvider ? CLAUDE_REVIEWER_SETTINGS : configured),
        ...selected,
    });
};
