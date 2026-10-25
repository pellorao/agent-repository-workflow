import {cloneJsonValue, isJsonObject, jsonSemanticallyEqual, parseJsonText, readJsonPath, serializeJson, writeJsonPath} from './json.mjs';

/** @typedef {null | boolean | number | string | object} JsonValue */
/** @typedef {{defaultValue?: JsonValue, path: string, required: boolean}} ConfigurationField */
/** @typedef {{convert: (value: JsonValue) => JsonValue, sourcePath: string, targetPath: string}} ConfigurationConversion */
/** @typedef {{conversions: ConfigurationConversion[], fields: ConfigurationField[], validate: (value: JsonValue) => ConfigurationDiagnostic[], version: number}} ConfigurationVersion */
/** @typedef {{versions: ConfigurationVersion[]}} ConfigurationRules */
/** @typedef {{code: string, message: string, path?: string, stage?: string, version?: number}} ConfigurationDiagnostic */

const PATH_SEGMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/u;

/** @param {string} path */
const pathSegments = path => path.split('.');

/** @param {string} left @param {string} right */
const pathsOverlap = (left, right) => left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);

/** @param {ConfigurationField[]} fields @param {number} index */
const fieldIsParent = (fields, index) => fields.slice(index + 1).some(field => field.path.startsWith(`${fields[index].path}.`));

/** @param {ConfigurationField[]} fields */
const parentPaths = fields => new Set(fields.filter((field, index) => fieldIsParent(fields, index)).map(field => field.path));

/** @param {ConfigurationField[]} fields @param {string} path */
const ancestorFields = (fields, path) => fields.filter(field => path.startsWith(`${field.path}.`));

/** @param {unknown} diagnostics @returns {diagnostics is ConfigurationDiagnostic[]} */
const validDiagnostics = diagnostics => Array.isArray(diagnostics) && diagnostics.every(diagnostic => (
    isJsonObject(diagnostic)
    && Object.keys(diagnostic).every(key => ['code', 'message', 'path'].includes(key))
    && typeof diagnostic.code === 'string'
    && diagnostic.code.length > 0
    && typeof diagnostic.message === 'string'
    && diagnostic.message.length > 0
    && (diagnostic.path === undefined || (
        typeof diagnostic.path === 'string'
        && diagnostic.path.length > 0
        && pathSegments(diagnostic.path).every(segment => PATH_SEGMENT_PATTERN.test(segment))
    ))
));

/** @param {unknown} rules @returns {asserts rules is ConfigurationRules} */
function requireRulesShape(rules) {
    if (!isJsonObject(rules) || !Array.isArray(rules.versions) || rules.versions.length === 0) {
        throw new TypeError('Configuration conversion rules must contain a non-empty versions array.');
    }
    if (rules.versions.some(version => !isJsonObject(version)
        || !Array.isArray(version.fields)
        || !Array.isArray(version.conversions)
        || typeof version.validate !== 'function'
        || typeof version.version !== 'number'
        || !Number.isSafeInteger(version.version)
        || version.version <= 0)) {
        throw new TypeError('Each configuration version must provide version, fields, conversions, and validate.');
    }
}

/** @param {string} path @param {string} label */
const assertRulePath = (path, label) => {
    if (typeof path !== 'string'
        || path.length === 0
        || pathSegments(path).some(segment => !PATH_SEGMENT_PATTERN.test(segment))) {
        throw new Error(`${label} must be a dot-separated configuration path.`);
    }
};

/** @param {ConfigurationVersion} version */
const assertFields = version => {
    const paths = new Set();
    for (const [index, field] of version.fields.entries()) {
        if (!isJsonObject(field) || typeof field.required !== 'boolean') {
            throw new Error(`Version ${version.version} fields must contain path and required.`);
        }
        assertRulePath(field.path, `Version ${version.version} field path`);
        if (paths.has(field.path)) throw new Error(`Version ${version.version} field paths must be unique.`);
        paths.add(field.path);
        const ancestors = pathSegments(field.path).slice(0, -1).map((_, ancestorIndex, segments) => segments.slice(0, ancestorIndex + 1).join('.'));
        if (ancestors.some(path => !paths.has(path))) {
            throw new Error(`Version ${version.version} fields must use depth-first parent-first order.`);
        }
        if (ancestors.some(ancestor => {
            const ancestorIndex = version.fields.findIndex(candidate => candidate.path === ancestor);
            return version.fields.slice(ancestorIndex + 1, index)
                .some(candidate => !candidate.path.startsWith(`${ancestor}.`));
        })) {
            throw new Error(`Version ${version.version} fields must use contiguous depth-first preorder.`);
        }
        if (fieldIsParent(version.fields, index) && Object.hasOwn(field, 'defaultValue')) {
            throw new Error(`Parent field ${field.path} must not declare defaultValue.`);
        }
        if (Object.hasOwn(field, 'defaultValue')) cloneJsonValue(field.defaultValue);
    }
};

/** @param {ConfigurationVersion} source @param {ConfigurationVersion} target */
const assertConversions = (source, target) => {
    const sourceFields = new Map(source.fields.map(field => [field.path, field]));
    const targetFields = new Map(target.fields.map(field => [field.path, field]));
    /** @type {string[]} */
    const targets = [];
    for (const conversion of target.conversions) {
        if (!isJsonObject(conversion) || typeof conversion.convert !== 'function') {
            throw new Error(`Version ${target.version} conversions must provide sourcePath, targetPath, and convert.`);
        }
        assertRulePath(conversion.sourcePath, `Version ${target.version} conversion sourcePath`);
        assertRulePath(conversion.targetPath, `Version ${target.version} conversion targetPath`);
        const sourceField = sourceFields.get(conversion.sourcePath);
        const targetField = targetFields.get(conversion.targetPath);
        if (sourceField === undefined || targetField === undefined) {
            throw new Error(`Version ${target.version} conversion paths must be declared fields.`);
        }
        if (targets.some(path => pathsOverlap(path, conversion.targetPath))) {
            throw new Error(`Version ${target.version} conversion targets must be unique and non-overlapping.`);
        }
        targets.push(conversion.targetPath);
        const sourceHasDefault = Object.hasOwn(sourceField, 'defaultValue');
        const targetHasDefault = Object.hasOwn(targetField, 'defaultValue');
        if (sourceHasDefault !== targetHasDefault) {
            throw new Error(`Conversion ${conversion.sourcePath} to ${conversion.targetPath} must preserve defaultValue presence.`);
        }
        if (sourceHasDefault) {
            const converted = conversion.convert(cloneJsonValue(sourceField.defaultValue));
            if (!jsonSemanticallyEqual(converted, targetField.defaultValue)) {
                throw new Error(`Conversion ${conversion.sourcePath} to ${conversion.targetPath} must preserve defaultValue semantics.`);
            }
        }
    }
};

/** @param {unknown} rules */
export const assertConfigurationConversionRules = rules => {
    requireRulesShape(rules);
    for (const [index, version] of rules.versions.entries()) {
        if (index > 0 && version.version <= rules.versions[index - 1].version) {
            throw new Error('Configuration versions must be unique and strictly increasing.');
        }
        assertFields(version);
        if (index === 0) {
            if (version.conversions.length !== 0) throw new Error('The first configuration version must not contain conversions.');
        } else {
            assertConversions(rules.versions[index - 1], version);
        }
    }
};

/** @param {ConfigurationDiagnostic[]} diagnostics */
const blocked = diagnostics => ({diagnostics, status: /** @type {'blocked'} */ ('blocked')});

/** @param {JsonValue} value @param {string} path */
const readPath = (value, path) => readJsonPath(value, pathSegments(path));

/** @param {JsonValue} value @param {string} path @param {JsonValue} nextValue */
const writePath = (value, path, nextValue) => {
    const result = writeJsonPath(value, pathSegments(path), nextValue);
    if (result.status !== 'succeeded') throw new Error(`Configuration rules could not construct declared path ${path}.`);
    return result.value;
};

/** @param {JsonValue} value @param {ConfigurationVersion} version */
const activeField = (value, version, /** @type {ConfigurationField} */ field) => {
    for (const ancestor of ancestorFields(version.fields, field.path)) {
        if (ancestor.required) continue;
        const read = readPath(value, ancestor.path);
        if (read.status === 'succeeded' && !read.present) return false;
    }
    return true;
};

/** @param {JsonValue} value @param {ConfigurationVersion} version */
const effectiveSource = (value, version) => {
    /** @type {ConfigurationDiagnostic[]} */
    const diagnostics = [];
    let effective = cloneJsonValue(value);
    for (const field of version.fields) {
        if (!activeField(value, version, field)) continue;
        const read = readPath(value, field.path);
        if (read.status === 'blocked') {
            return {diagnostics: null, effective: value, structuralBlocker: true};
        }
        if (!read.present) {
            if (field.required) {
                diagnostics.push({
                    code: 'configuration-required-path-missing',
                    message: `Required configuration path is missing: ${field.path}.`,
                    path: field.path,
                    version: version.version,
                });
            } else if (Object.hasOwn(field, 'defaultValue')) {
                if (field.defaultValue === undefined) throw new Error(`Field ${field.path} has an invalid explicit undefined defaultValue.`);
                effective = writePath(effective, field.path, field.defaultValue);
            }
        }
    }
    return {diagnostics, effective, structuralBlocker: false};
};

/** @param {ConfigurationVersion} version @param {JsonValue} value @param {string} stage */
const validateVersion = (version, value, stage) => {
    let diagnostics;
    try {
        diagnostics = version.validate(cloneJsonValue(value));
    } catch (error) {
        if (!(error instanceof Error)) throw error;
        return [{
            code: 'configuration-validator-error',
            message: error.message,
            stage,
            version: version.version,
        }];
    }
    if (!validDiagnostics(diagnostics)) throw new Error(`Configuration validator ${version.version} returned invalid diagnostics.`);
    return diagnostics.map(diagnostic => ({...diagnostic, stage, version: version.version}));
};

/** @param {JsonValue} value @param {ConfigurationVersion} version */
const unknownPaths = (value, version) => {
    if (!isJsonObject(value)) return [];
    const parents = parentPaths(version.fields);
    const directChildren = new Map();
    for (const field of version.fields) {
        const segments = pathSegments(field.path);
        const parent = segments.slice(0, -1).join('.');
        const children = directChildren.get(parent) ?? new Set();
        children.add(segments[segments.length - 1]);
        directChildren.set(parent, children);
    }
    /** @type {string[]} */
    const unknown = [];
    const visit = (/** @type {Record<string, unknown>} */ object, /** @type {string} */ parent) => {
        const known = directChildren.get(parent) ?? new Set();
        for (const [key, nested] of Object.entries(object)) {
            const path = parent === '' ? key : `${parent}.${key}`;
            if (!known.has(key)) {
                unknown.push(path);
            } else if (parents.has(path) && isJsonObject(nested)) {
                visit(nested, path);
            }
        }
    };
    visit(value, '');
    return unknown;
};

/** @param {ConfigurationVersion} source @param {ConfigurationVersion} target @param {JsonValue} value @param {string[]} sourceUnknown */
const convertStep = (source, target, value, sourceUnknown) => {
    const targetKnown = target.fields.map(field => field.path);
    const conflict = sourceUnknown.find(path => targetKnown.some(known => known === path || known.startsWith(`${path}.`)));
    if (conflict !== undefined) {
        return blocked([{
            code: 'configuration-unknown-path-conflict',
            message: `Unknown configuration path conflicts with the target schema: ${conflict}.`,
            path: conflict,
            version: target.version,
        }]);
    }
    const conversionsByTarget = new Map(target.conversions.map(conversion => [conversion.targetPath, conversion]));
    const conversionSources = new Set(target.conversions.map(conversion => conversion.sourcePath));
    const sourceFields = new Map(source.fields.map(field => [field.path, field]));
    const targetParents = parentPaths(target.fields);
    /** @type {JsonValue} */
    let result = {};
    /** @type {Map<string, JsonValue>} */
    const convertedValues = new Map();
    for (const conversion of target.conversions) {
        const read = readPath(value, conversion.sourcePath);
        if (read.status !== 'succeeded') throw new Error('Validated conversion source became unavailable.');
        if (!read.present) continue;
        let converted;
        try {
            converted = conversion.convert(cloneJsonValue(read.value));
            converted = cloneJsonValue(converted);
        } catch (error) {
            if (!(error instanceof Error)) throw error;
            return blocked([{
                code: 'configuration-converter-error',
                message: error.message,
                path: conversion.targetPath,
                stage: 'conversion',
                version: target.version,
            }]);
        }
        convertedValues.set(conversion.targetPath, converted);
    }

    for (const field of target.fields) {
        if (convertedValues.has(field.path)) {
            const converted = convertedValues.get(field.path);
            if (converted === undefined) throw new Error(`Converted value is unavailable: ${field.path}.`);
            result = writePath(result, field.path, converted);
            continue;
        }
        if (conversionsByTarget.has(field.path)) continue;
        if (targetParents.has(field.path)) {
            const sourceRead = readPath(value, field.path);
            const shouldCreate = field.required || sourceRead.status === 'succeeded' && sourceRead.present;
            if (shouldCreate) result = writePath(result, field.path, {});
            continue;
        }
        if (!activeField(result, target, field)) continue;
        if (sourceFields.has(field.path) && !conversionSources.has(field.path)) {
            const read = readPath(value, field.path);
            if (read.status === 'succeeded' && read.present) {
                if (read.value === undefined) throw new Error(`Preserved value is unavailable: ${field.path}.`);
                result = writePath(result, field.path, read.value);
                continue;
            }
        }
        if (Object.hasOwn(field, 'defaultValue')) {
            if (field.defaultValue === undefined) throw new Error(`Field ${field.path} has an invalid explicit undefined defaultValue.`);
            result = writePath(result, field.path, field.defaultValue);
        }
    }
    for (const path of sourceUnknown) {
        const read = readPath(value, path);
        if (read.status !== 'succeeded' || !read.present) throw new Error('Unknown configuration path became unavailable.');
        if (read.value === undefined) throw new Error(`Unknown configuration value is unavailable: ${path}.`);
        result = writePath(result, path, read.value);
    }

    const targetState = effectiveSource(result, target);
    if (targetState.structuralBlocker) {
        const diagnostics = validateVersion(target, result, 'target-validation');
        if (diagnostics.length === 0) throw new Error('Configuration validator accepted a structural target contradiction.');
        return blocked(diagnostics);
    }
    if (targetState.diagnostics !== null && targetState.diagnostics.length > 0) return blocked(targetState.diagnostics);
    const targetDiagnostics = validateVersion(target, targetState.effective, 'target-validation');
    if (targetDiagnostics.length > 0) return blocked(targetDiagnostics);

    const sourceParents = parentPaths(source.fields);
    const removed = source.fields.filter(field => {
        const read = readPath(value, field.path);
        return !sourceParents.has(field.path)
            && !target.fields.some(targetField => targetField.path === field.path)
            && !conversionSources.has(field.path)
            && read.status === 'succeeded'
            && read.present;
    }).map(field => ({kind: /** @type {'removed'} */ ('removed'), path: field.path}));
    const targetEntries = [];
    for (const field of target.fields.filter(field => !targetParents.has(field.path))) {
        const conversion = conversionsByTarget.get(field.path);
        if (conversion !== undefined && convertedValues.has(field.path)) {
            const sourceRead = readPath(value, conversion.sourcePath);
            const targetRead = readPath(result, conversion.targetPath);
            if (conversion.sourcePath !== conversion.targetPath
                || sourceRead.status === 'succeeded'
                    && targetRead.status === 'succeeded'
                    && sourceRead.present
                    && targetRead.present
                    && sourceRead.value !== undefined
                    && targetRead.value !== undefined
                    && !jsonSemanticallyEqual(sourceRead.value, targetRead.value)) {
                targetEntries.push({kind: /** @type {'converted'} */ ('converted'), sourcePath: conversion.sourcePath, targetPath: conversion.targetPath});
            }
            continue;
        }
        const targetRead = readPath(result, field.path);
        if (!sourceFields.has(field.path) && targetRead.status === 'succeeded' && targetRead.present) {
            targetEntries.push({kind: /** @type {'added'} */ ('added'), path: field.path});
        }
    }
    return {entries: [...removed, ...targetEntries], result, status: /** @type {'succeeded'} */ ('succeeded')};
};

/** @param {unknown} input */
export const convertConfiguration = input => {
    if (!isJsonObject(input)
        || Object.keys(input).sort().join(',') !== 'rules,sourceBytes'
        || !Buffer.isBuffer(input.sourceBytes)) {
        throw new TypeError('Configuration conversion input must contain rules and sourceBytes.');
    }
    requireRulesShape(input.rules);
    const rules = input.rules;
    const sourceBytes = input.sourceBytes;
    const parsed = parseJsonText(sourceBytes);
    if (parsed.status !== 'succeeded') return blocked(parsed.diagnostics);
    const sourceValue = parsed.value;
    if (!isJsonObject(sourceValue)) {
        return blocked([{code: 'configuration-root-invalid', message: 'Configuration root must be an object.'}]);
    }
    const sourceVersion = sourceValue.configVersion;
    if (typeof sourceVersion !== 'number' || !Number.isSafeInteger(sourceVersion) || sourceVersion <= 0) {
        return blocked([{code: 'configuration-version-invalid', message: 'configVersion must be a positive integer.', path: 'configVersion'}]);
    }
    const sourceIndex = rules.versions.findIndex(version => version.version === sourceVersion);
    if (sourceIndex === -1) {
        return blocked([{
            code: 'configuration-version-unsupported',
            message: `Unsupported configuration version: ${sourceVersion}.`,
            path: 'configVersion',
        }]);
    }
    const sourceRule = rules.versions[sourceIndex];
    const sourceState = effectiveSource(sourceValue, sourceRule);
    if (sourceState.structuralBlocker) {
        const diagnostics = validateVersion(sourceRule, sourceValue, 'source-validation');
        if (diagnostics.length === 0) throw new Error('Configuration validator accepted a structural source contradiction.');
        return blocked(diagnostics);
    }
    if (sourceState.diagnostics !== null && sourceState.diagnostics.length > 0) return blocked(sourceState.diagnostics);
    const sourceDiagnostics = validateVersion(sourceRule, sourceState.effective, 'source-validation');
    if (sourceDiagnostics.length > 0) return blocked(sourceDiagnostics);
    const targetVersion = rules.versions[rules.versions.length - 1].version;
    if (sourceIndex === rules.versions.length - 1) {
        return {
            status: /** @type {'succeeded'} */ ('succeeded'),
            diagnostics: [],
            changed: false,
            sourceVersion,
            targetVersion,
            bytes: Buffer.from(sourceBytes),
            changes: [],
            unknownPaths: unknownPaths(sourceValue, sourceRule),
        };
    }

    /** @type {JsonValue} */
    let current = sourceState.effective;
    const changes = [];
    for (let index = sourceIndex + 1; index < rules.versions.length; index += 1) {
        const prior = rules.versions[index - 1];
        const target = rules.versions[index];
        const step = convertStep(prior, target, current, unknownPaths(current, prior));
        if (step.status === 'blocked') return step;
        current = step.result;
        changes.push({sourceVersion: prior.version, targetVersion: target.version, entries: step.entries});
    }
    const serialized = serializeJson(current);
    if (serialized.status !== 'succeeded') throw new Error('Converted configuration could not be serialized.');
    return {
        status: /** @type {'succeeded'} */ ('succeeded'),
        diagnostics: [],
        changed: true,
        sourceVersion,
        targetVersion,
        bytes: serialized.bytes,
        changes,
        unknownPaths: unknownPaths(current, rules.versions[rules.versions.length - 1]),
    };
};
