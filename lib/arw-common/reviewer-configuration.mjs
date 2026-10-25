import {isJsonObject} from '../common/json.mjs';

export const REVIEWER_ROLES = Object.freeze([
    'code-spec-reviewer',
    'code-standards-reviewer',
    'commit-audit-reviewer',
    'spec-readiness-reviewer',
]);

export const DEFAULT_REVIEWER_SETTINGS = Object.freeze({
    model: 'gpt-6-luna',
    modelProvider: 'openai',
    reasoningEffort: 'xhigh',
    serviceTier: 'default',
});

const SETTING_FIELDS = Object.freeze(['model', 'modelProvider', 'reasoningEffort', 'serviceTier']);

/** @typedef {{model: string, modelProvider: string, reasoningEffort: string, serviceTier: 'default' | 'fast'}} ReviewerSettings */
/** @typedef {Partial<ReviewerSettings>} ReviewerOverrides */
/** @typedef {Record<string, ReviewerOverrides>} ReviewerConfiguration */

/** @param {unknown} value @param {string} label @returns {ReviewerOverrides} */
export const validateReviewerFields = (value, label) => {
    if (!isJsonObject(value)) throw new Error(`${label} must be an object.`);
    /** @type {ReviewerOverrides} */
    const result = {};
    for (const [key, field] of Object.entries(value)) {
        if (!SETTING_FIELDS.includes(key)) throw new Error(`${label}.${key} is not a supported Reviewer setting.`);
        if (key === 'serviceTier') {
            if (field !== 'default' && field !== 'fast') throw new Error(`${label}.serviceTier must be default or fast.`);
        } else if (typeof field !== 'string' || field.trim().length === 0) {
            throw new Error(`${label}.${key} must be a non-empty string.`);
        }
        Object.defineProperty(result, key, {value: field, enumerable: true, configurable: true, writable: true});
    }
    return result;
};

/** @param {unknown} value @param {string} label @returns {ReviewerConfiguration} */
export const validateReviewerConfiguration = (value, label) => {
    if (value === undefined) return {};
    if (!isJsonObject(value)) throw new Error(`${label} must be an object.`);
    /** @type {ReviewerConfiguration} */
    const result = {};
    for (const [role, fields] of Object.entries(value)) {
        if (!REVIEWER_ROLES.includes(role)) throw new Error(`${label}.${role} is not a supported Reviewer role.`);
        Object.defineProperty(result, role, {
            value: validateReviewerFields(fields, `${label}.${role}`),
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
 * isolated capability or benchmark run; an ordinary review omits that argument.
 * @param {{role: string, globalConfig: {reviewers?: unknown}, repositoryConfig: {reviewers?: unknown}, overrides?: unknown}} input
 * @returns {ReviewerSettings}
 */
export const resolveReviewerSettings = ({role, globalConfig, repositoryConfig, overrides}) => {
    if (!REVIEWER_ROLES.includes(role)) throw new Error(`Unsupported Reviewer role: ${role}.`);
    const global = validateReviewerConfiguration(globalConfig.reviewers, 'reviewers');
    const repository = validateReviewerConfiguration(repositoryConfig.reviewers, 'reviewers');
    const selected = overrides === undefined ? {} : validateReviewerFields(overrides, 'overrides');
    return /** @type {ReviewerSettings} */ ({
        ...DEFAULT_REVIEWER_SETTINGS,
        ...global[role],
        ...repository[role],
        ...selected,
    });
};
