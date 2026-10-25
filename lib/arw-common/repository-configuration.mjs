
import {assertSafePath} from '../common/canonical-contract.mjs';
import {createScopedFilesystem, resolveRelativePathWithinScope} from '../common/filesystem.mjs';
import {completeConfigurationBytes, isJsonObject, parseJsonText} from '../common/json.mjs';
import {normalizePathPattern} from '../common/path-pattern.mjs';
import {convertConfiguration} from '../common/configuration-conversion.mjs';
import {emptyRepositoryReviewers, validateReviewerConfiguration} from './reviewer-configuration.mjs';

/** @typedef {{code: string, message: string, path?: string}} Diagnostic */
/** @typedef {Extract<Awaited<ReturnType<typeof createScopedFilesystem>>, {status: 'succeeded'}>['scopedFilesystem']} ScopedFilesystem */
/** @typedef {{role: 'member'} | {role: 'leader', name: string, modules: Record<string, {name: string, path: string, repositoryRoot: string}>, submodule: {distributionBranch: string, remote: string}, jira: {acceptedStatus: string, baseUrl: string, candidateStatus: string, completedStatus: string, issueType: string, projectKey: string}}} ApplicationContext */
/** @typedef {{status: 'blocked', diagnostics: Diagnostic[]} | {status: 'succeeded', diagnostics: Diagnostic[], context: ApplicationContext, languageChecks: LanguageCheck[], reviewers: import('./reviewer-configuration.mjs').ReviewerConfiguration}} RepositoryConfigurationResult */
/** @typedef {{name: string, language: 'chinese' | 'english', minPercentage: number, include: string[], exclude: string[]}} LanguageCheck */
/** @typedef {RepositoryConfigurationResult | {status: 'failed', stage: string, diagnostics: Diagnostic[]}} RepositoryConfigurationLoadResult */

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const ROOT_FIELDS = new Set(['configVersion', 'application', 'languageChecks', 'reviewers']);
const APPLICATION_FIELDS = new Set(['jira', 'modules', 'name', 'submoduleDistributionBranch', 'submoduleRemote']);
const MODULE_FIELDS = new Set(['name', 'path']);
const JIRA_FIELDS = new Set(['acceptedStatus', 'baseUrl', 'candidateStatus', 'completedStatus', 'issueType', 'projectKey']);

/** @param {string} code @param {string} message @param {string} [path] @returns {Diagnostic} */
const diagnostic = (code, message, path = undefined) => ({code, message, ...(path === undefined ? {} : {path})});

/** @param {unknown} value */
const safeLanguagePattern = value => typeof value === 'string'
    && value.length > 0 && !CONTROL_PATTERN.test(value)
    && !value.includes('\\') && !value.startsWith('/') && !/^[A-Za-z]:/u.test(value)
    && (normalizePathPattern(value) === '.' || normalizePathPattern(value).split('/').every(part => part.length > 0 && part !== '.' && part !== '..' && (part === '**' || !part.includes('**'))));

/** @param {unknown} value @returns {Diagnostic[]} */
const validateLanguageChecks = value => {
    if (value === undefined) return [];
    if (!isJsonObject(value)) return [diagnostic('language-checks-invalid', 'languageChecks must be an object.', 'languageChecks')];
    const diagnostics = [];
    for (const [name, check] of Object.entries(value)) {
        const path = `languageChecks.${name}`;
        if (!isJsonObject(check)
            || Object.keys(check).some(key => !['language', 'minPercentage', 'include', 'exclude'].includes(key))
            || (check.language !== 'chinese' && check.language !== 'english')
            || typeof check.minPercentage !== 'number' || !Number.isFinite(check.minPercentage)
            || check.minPercentage < 0 || check.minPercentage > 100
            || !Array.isArray(check.include) || check.include.length === 0 || !check.include.every(safeLanguagePattern)
            || (check.exclude !== undefined && (!Array.isArray(check.exclude) || !check.exclude.every(safeLanguagePattern)))) {
            diagnostics.push(diagnostic('language-check-invalid', `Invalid language check: ${name}.`, path));
        }
    }
    return diagnostics;
};

/** @param {Record<string, unknown>} value @returns {LanguageCheck[]} */
const languageChecksFrom = value => Object.entries(/** @type {Record<string, Omit<LanguageCheck, 'name'>>} */ (value.languageChecks ?? {}))
    .map(([name, check]) => ({name, language: check.language, minPercentage: check.minPercentage, include: [...check.include], exclude: [...(check.exclude ?? [])]}));

/** @param {Record<string, unknown>} value @param {Set<string>} allowed @param {string} parentPath */
const unknownFieldDiagnostics = (value, allowed, parentPath) => Object.keys(value)
    .filter(key => !allowed.has(key))
    .sort()
    .map(key => {
        const path = parentPath.length === 0 ? key : `${parentPath}.${key}`;
        return diagnostic('application-configuration-field-unknown', `Unknown Application configuration field: ${path}.`, path);
    });

/** @param {unknown} value @param {string} path @returns {Diagnostic[]} */
const exactStringDiagnostics = (value, path) => typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || CONTROL_PATTERN.test(value)
    ? [diagnostic('application-configuration-string-invalid', `${path} must be a non-empty string without surrounding whitespace or control characters.`, path)]
    : [];

/** @param {unknown} value @param {string} path @returns {Diagnostic[]} */
const nameDiagnostics = (value, path) => typeof value !== 'string' || !NAME_PATTERN.test(value)
    ? [diagnostic('application-configuration-name-invalid', `${path} must match ^[a-z0-9][a-z0-9-]*$.`, path)]
    : [];

/** @param {unknown} value @param {string} path @returns {Diagnostic[]} */
const modulePathDiagnostics = (value, path) => {
    try {
        if (typeof value !== 'string' || CONTROL_PATTERN.test(value)) throw new Error('unsafe path characters');
        assertSafePath(value, path);
        return [];
    } catch {
        return [diagnostic('application-configuration-module-path-invalid', `${path} must be a safe slash-relative Repository path.`, path)];
    }
};

/** @param {unknown} value @returns {Diagnostic[]} */
const baseUrlDiagnostics = value => {
    if (typeof value !== 'string') {
        return [diagnostic('application-configuration-jira-url-invalid', 'application.jira.baseUrl must be an absolute HTTP or HTTPS URL.', 'application.jira.baseUrl')];
    }
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0) {
            throw new Error('unsafe URL');
        }
        return [];
    } catch {
        return [diagnostic('application-configuration-jira-url-invalid', 'application.jira.baseUrl must be an absolute HTTP or HTTPS URL without userinfo, query, or fragment.', 'application.jira.baseUrl')];
    }
};

/** @param {string[]} paths @returns {Diagnostic[]} */
const overlappingPathDiagnostics = paths => {
    const diagnostics = [];
    for (let leftIndex = 0; leftIndex < paths.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < paths.length; rightIndex += 1) {
            const left = paths[leftIndex];
            const right = paths[rightIndex];
            if (left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)) {
                diagnostics.push(diagnostic(
                    'application-configuration-module-path-overlap',
                    `Application Module paths must be unique and non-containing: ${left} and ${right}.`,
                    'application.modules',
                ));
            }
        }
    }
    return diagnostics;
};

/** @param {unknown} value @returns {Diagnostic[]} */
const validateRepositoryConfigurationV2 = value => {
    if (!isJsonObject(value)) {
        return [{code: 'application-configuration-object-required', message: 'Repository configuration must be an object.'}];
    }
    /** @type {Diagnostic[]} */
    const diagnostics = [...unknownFieldDiagnostics(value, ROOT_FIELDS, ''), ...validateLanguageChecks(value.languageChecks)];
    try { validateReviewerConfiguration(value.reviewers, 'reviewers'); }
    catch (error) { diagnostics.push(diagnostic('reviewer-configuration-invalid', error instanceof Error ? error.message : String(error), 'reviewers')); }
    if (value.configVersion !== 2) diagnostics.push(diagnostic('application-configuration-version-invalid', 'Repository configuration version must be 2.', 'configVersion'));
    if (value.application === undefined) return diagnostics;
    if (!isJsonObject(value.application)) {
        diagnostics.push(diagnostic('application-configuration-application-invalid', 'application must be an object when present.', 'application'));
        return diagnostics;
    }
    const application = value.application;
    diagnostics.push(...unknownFieldDiagnostics(application, APPLICATION_FIELDS, 'application'));
    diagnostics.push(...nameDiagnostics(application.name, 'application.name'));
    diagnostics.push(...exactStringDiagnostics(application.submoduleRemote, 'application.submoduleRemote'));
    diagnostics.push(...exactStringDiagnostics(application.submoduleDistributionBranch, 'application.submoduleDistributionBranch'));

    if (!Array.isArray(application.modules)) {
        diagnostics.push(diagnostic('application-configuration-modules-invalid', 'application.modules must be an array.', 'application.modules'));
    } else {
        /** @type {string[]} */
        const names = [];
        /** @type {string[]} */
        const paths = [];
        for (const [index, module] of application.modules.entries()) {
            const parentPath = `application.modules.${index}`;
            if (!isJsonObject(module)) {
                diagnostics.push(diagnostic('application-configuration-module-invalid', `${parentPath} must be an object.`, parentPath));
                continue;
            }
            diagnostics.push(...unknownFieldDiagnostics(module, MODULE_FIELDS, parentPath));
            const moduleNameDiagnostics = nameDiagnostics(module.name, `${parentPath}.name`);
            const pathDiagnostics = modulePathDiagnostics(module.path, `${parentPath}.path`);
            diagnostics.push(...moduleNameDiagnostics, ...pathDiagnostics);
            if (moduleNameDiagnostics.length === 0 && typeof module.name === 'string') names.push(module.name);
            if (pathDiagnostics.length === 0 && typeof module.path === 'string') paths.push(module.path);
        }
        const duplicateNames = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))].sort();
        for (const name of duplicateNames) {
            diagnostics.push(diagnostic('application-configuration-module-name-duplicate', `Application Module name is repeated: ${name}.`, 'application.modules'));
        }
        diagnostics.push(...overlappingPathDiagnostics(paths));
    }

    if (!isJsonObject(application.jira)) {
        diagnostics.push(diagnostic('application-configuration-jira-invalid', 'application.jira must be an object.', 'application.jira'));
    } else {
        diagnostics.push(...unknownFieldDiagnostics(application.jira, JIRA_FIELDS, 'application.jira'));
        diagnostics.push(...baseUrlDiagnostics(application.jira.baseUrl));
        for (const field of ['projectKey', 'issueType', 'candidateStatus', 'acceptedStatus', 'completedStatus']) {
            diagnostics.push(...exactStringDiagnostics(application.jira[field], `application.jira.${field}`));
        }
    }
    return diagnostics;
};

export const REPOSITORY_CONFIGURATION_RULES = Object.freeze({
    versions: Object.freeze([Object.freeze({
        conversions: Object.freeze([]),
        fields: Object.freeze([
            Object.freeze({defaultValue: 2, path: 'configVersion', required: true}),
            Object.freeze({path: 'languageChecks', required: false}),
            Object.freeze({path: 'reviewers', required: false}),
            Object.freeze({path: 'application', required: false}),
            Object.freeze({path: 'application.name', required: true}),
            Object.freeze({defaultValue: 'origin', path: 'application.submoduleRemote', required: true}),
            Object.freeze({defaultValue: 'dev', path: 'application.submoduleDistributionBranch', required: true}),
            Object.freeze({path: 'application.modules', required: true}),
            Object.freeze({path: 'application.jira', required: true}),
            Object.freeze({path: 'application.jira.baseUrl', required: true}),
            Object.freeze({path: 'application.jira.projectKey', required: true}),
            Object.freeze({defaultValue: '故事Story', path: 'application.jira.issueType', required: true}),
            Object.freeze({defaultValue: '需求待办', path: 'application.jira.candidateStatus', required: true}),
            Object.freeze({defaultValue: '需求开发中', path: 'application.jira.acceptedStatus', required: true}),
            Object.freeze({defaultValue: '上线成功', path: 'application.jira.completedStatus', required: true}),
        ]),
        validate: validateRepositoryConfigurationV2,
        version: 2,
    })]),
});


export const REPOSITORY_CONFIGURATION_PATH = 'arw.config.json';

/** @param {Buffer | null} sourceBytes @returns {{bytes: Buffer, changed: boolean}} */
export const completeRepositoryConfigurationBytes = sourceBytes => {
    const bytes = sourceBytes ?? Buffer.from('{"configVersion":2}\n');
    const parsed = parseJsonText(bytes);
    if (parsed.status !== 'succeeded') throw new Error('Repository configuration must be valid UTF-8 JSON.');
    const diagnostics = validateRepositoryConfigurationV2(parsed.value);
    if (diagnostics.length > 0) throw new Error(diagnostics.map(entry => entry.message).join(' '));
    return completeConfigurationBytes({sourceBytes: bytes, defaults: {reviewers: emptyRepositoryReviewers()}});
};

/**
 * @param {{repositoryRoot: string, sourceBytes: Buffer}} input
 */
export const prepareRepositoryConfiguration = input => {
    const conversion = convertConfiguration({rules: REPOSITORY_CONFIGURATION_RULES, sourceBytes: input.sourceBytes});
    if (conversion.status !== 'succeeded') return conversion;
    const parsed = parseJsonText(conversion.bytes);
    if (parsed.status !== 'succeeded') throw new Error('Validated Application configuration bytes could not be parsed.');
    const resolved = resolveRepositoryConfiguration({repositoryRoot: input.repositoryRoot, value: parsed.value});
    return resolved.status === 'succeeded'
        ? {...conversion, context: resolved.context, languageChecks: resolved.languageChecks, reviewers: resolved.reviewers}
        : resolved;
};

/**
 * @param {{repositoryRoot: string, value: unknown}} input
 * @returns {RepositoryConfigurationResult}
 */
export const resolveRepositoryConfiguration = input => {
    const diagnostics = validateRepositoryConfigurationV2(input.value);
    if (diagnostics.length > 0) return {diagnostics, status: 'blocked'};
    if (!isJsonObject(input.value)) throw new Error('Validated Repository configuration must be an object.');
    if (input.value.application === undefined) {
        return {context: {role: 'member'}, languageChecks: languageChecksFrom(input.value), reviewers: validateReviewerConfiguration(input.value.reviewers, 'reviewers'), diagnostics: [], status: 'succeeded'};
    }
    if (!isJsonObject(input.value.application) || !Array.isArray(input.value.application.modules) || !isJsonObject(input.value.application.jira)) {
        throw new Error('Validated Application configuration has an invalid structure.');
    }
    const application = /** @type {Record<string, unknown> & {jira: Record<string, unknown>, modules: unknown[]}} */ (input.value.application);
    const jira = application.jira;
    const modules = Object.fromEntries(application.modules.map((/** @type {unknown} */ module) => {
        if (!isJsonObject(module) || typeof module.name !== 'string' || typeof module.path !== 'string') {
            throw new Error('Validated Application Module has an invalid structure.');
        }
        const resolved = resolveRelativePathWithinScope({path: module.path, scope: input.repositoryRoot});
        if (resolved.status !== 'succeeded') throw new Error('Validated Application Module path escaped its Repository.');
        return [module.name, {name: module.name, path: module.path, repositoryRoot: resolved.absolutePath}];
    }));
    if (typeof application.name !== 'string'
        || typeof application.submoduleRemote !== 'string'
        || typeof application.submoduleDistributionBranch !== 'string'
        || typeof jira.baseUrl !== 'string'
        || typeof jira.projectKey !== 'string'
        || typeof jira.issueType !== 'string'
        || typeof jira.candidateStatus !== 'string'
        || typeof jira.acceptedStatus !== 'string'
        || typeof jira.completedStatus !== 'string') {
        throw new Error('Validated Application configuration has an invalid scalar field.');
    }
    const baseUrl = new URL(jira.baseUrl);
    if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname = `${baseUrl.pathname}/`;
    return {
        languageChecks: languageChecksFrom(input.value),
        reviewers: validateReviewerConfiguration(input.value.reviewers, 'reviewers'),
        context: {
            jira: {
                acceptedStatus: jira.acceptedStatus,
                baseUrl: baseUrl.href,
                candidateStatus: jira.candidateStatus,
                completedStatus: jira.completedStatus,
                issueType: jira.issueType,
                projectKey: jira.projectKey,
            },
            modules,
            name: application.name,
            role: 'leader',
            submodule: {
                distributionBranch: application.submoduleDistributionBranch,
                remote: application.submoduleRemote,
            },
        },
        diagnostics: [],
        status: 'succeeded',
    };
};

/**
 * @param {{repositoryRoot: string, filesystem?: ScopedFilesystem}} input
 * @returns {Promise<RepositoryConfigurationLoadResult>}
 */
export const loadRepositoryConfiguration = async input => {
    let filesystem = input.filesystem;
    if (filesystem === undefined) {
        const created = await createScopedFilesystem({root: input.repositoryRoot});
        if (created.status !== 'succeeded') {
            return {
                diagnostics: [diagnostic('application-configuration-filesystem-failed', 'The Repository filesystem could not be opened.', REPOSITORY_CONFIGURATION_PATH)],
                stage: 'configuration-read',
                status: 'failed',
            };
        }
        filesystem = created.scopedFilesystem;
    }
    const inspected = await filesystem.inspect({path: REPOSITORY_CONFIGURATION_PATH});
    if (inspected.status !== 'succeeded') {
        return {
            diagnostics: [diagnostic('application-configuration-read-failed', 'Repository Application configuration could not be inspected.', REPOSITORY_CONFIGURATION_PATH)],
            stage: 'configuration-read',
            status: 'failed',
        };
    }
    if (inspected.entry.kind === 'missing') {
        return resolveRepositoryConfiguration({repositoryRoot: input.repositoryRoot, value: {configVersion: 2}});
    }
    if (inspected.entry.kind !== 'file') {
        return {
            diagnostics: [diagnostic('application-configuration-path-invalid', 'arw.config.json must be a regular file.', REPOSITORY_CONFIGURATION_PATH)],
            status: 'blocked',
        };
    }
    const read = await filesystem.read({path: REPOSITORY_CONFIGURATION_PATH});
    if (read.status !== 'succeeded') {
        return read.status === 'failed'
            ? {diagnostics: read.diagnostics, stage: 'configuration-read', status: 'failed'}
            : read;
    }
    if (read.bytes === undefined) throw new Error('Application configuration read succeeded without bytes.');
    return prepareRepositoryConfiguration({repositoryRoot: input.repositoryRoot, sourceBytes: read.bytes});
};
