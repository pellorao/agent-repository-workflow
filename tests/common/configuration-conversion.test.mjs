import assert from 'node:assert/strict';
import test from 'node:test';

import {
    convertConfiguration,
} from '../../lib/common/configuration-conversion.mjs';

const validObject = (/** @type {unknown} */ value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    ? []
    : [{code: 'configuration-object-required', message: 'Configuration must be an object.'}];

const rules = {
    versions: [
        {
            conversions: [],
            fields: [
                {defaultValue: 1, path: 'configVersion', required: true},
                {path: 'name', required: true},
                {path: 'options', required: false},
                {defaultValue: true, path: 'options.enabled', required: false},
                {path: 'dynamic', required: false},
            ],
            validate: validObject,
            version: 1,
        },
        {
            conversions: [
                {convert: (/** @type {unknown} */ value) => value === 1 ? 3 : value, sourcePath: 'configVersion', targetPath: 'configVersion'},
            ],
            fields: [
                {defaultValue: 3, path: 'configVersion', required: true},
                {path: 'name', required: true},
                {path: 'options', required: false},
                {defaultValue: true, path: 'options.enabled', required: false},
                {path: 'added', required: true},
                {defaultValue: 50, path: 'added.limit', required: true},
                {path: 'dynamic', required: false},
            ],
            validate: validObject,
            version: 3,
        },
    ],
};

const copyRules = () => ({
    versions: rules.versions.map(version => ({
        ...version,
        conversions: version.conversions.map(conversion => ({...conversion})),
        fields: version.fields.map(field => ({...field})),
    })),
});

test('Configuration Conversion upgrades through ordered fields and preserves unknown subtrees', () => {
    const result = convertConfiguration({
        rules,
        sourceBytes: Buffer.from('{"configVersion":1,"name":"A","options":{"extra":"keep"},"dynamic":{"inside":1},"unknown":{"x":1}}\n'),
    });

    assert.deepEqual(result, {
        status: 'succeeded',
        diagnostics: [],
        changed: true,
        sourceVersion: 1,
        targetVersion: 3,
        bytes: Buffer.from([
            '{',
            '  "configVersion": 3,',
            '  "name": "A",',
            '  "options": {',
            '    "enabled": true,',
            '    "extra": "keep"',
            '  },',
            '  "added": {',
            '    "limit": 50',
            '  },',
            '  "dynamic": {',
            '    "inside": 1',
            '  },',
            '  "unknown": {',
            '    "x": 1',
            '  }',
            '}',
            '',
        ].join('\n')),
        changes: [{
            sourceVersion: 1,
            targetVersion: 3,
            entries: [
                {kind: 'converted', sourcePath: 'configVersion', targetPath: 'configVersion'},
                {kind: 'added', path: 'added.limit'},
            ],
        }],
        unknownPaths: ['options.extra', 'unknown'],
    });
});

test('Configuration Conversion preserves exact current bytes and reports current unknown roots', () => {
    const sourceBytes = Buffer.from('{\r\n  "configVersion": 3,\r\n  "name": "A",\r\n  "added": {"limit": 7},\r\n  "unknown": true\r\n}\r\n');
    const result = convertConfiguration({rules, sourceBytes});

    assert.deepEqual(result, {
        status: 'succeeded',
        diagnostics: [],
        changed: false,
        sourceVersion: 3,
        targetVersion: 3,
        bytes: sourceBytes,
        changes: [],
        unknownPaths: ['unknown'],
    });
});

test('Configuration Conversion blocks unsupported versions, invalid JSON, and validators', () => {
    for (const [sourceBytes, code] of [
        [Buffer.from('{'), 'json-invalid'],
        [Buffer.from('{"configVersion":2}'), 'configuration-version-unsupported'],
        [Buffer.from('{"configVersion":1}'), 'configuration-required-path-missing'],
    ]) {
        const result = convertConfiguration({rules, sourceBytes});
        assert.equal(result.status, 'blocked');
        assert.deepEqual(Object.keys(result).sort(), ['diagnostics', 'status']);
        assert.equal(result.diagnostics[0].code, code);
    }
});

test('Configuration Conversion blocks target conflicts and converter failures without a candidate', () => {
    const conflict = convertConfiguration({
        rules,
        sourceBytes: Buffer.from('{"configVersion":1,"name":"A","added":"extension"}\n'),
    });
    assert.equal(conflict.status, 'blocked');
    assert.deepEqual(Object.keys(conflict).sort(), ['diagnostics', 'status']);
    assert.equal(conflict.diagnostics[0].code, 'configuration-unknown-path-conflict');

    const converterFailureRules = copyRules();
    Reflect.set(converterFailureRules.versions[1].conversions[0], 'convert', () => {
        throw new Error('conversion failed');
    });
    const failed = convertConfiguration({
        rules: converterFailureRules,
        sourceBytes: Buffer.from('{"configVersion":1,"name":"A"}\n'),
    });
    assert.equal(failed.status, 'blocked');
    assert.deepEqual(Object.keys(failed).sort(), ['diagnostics', 'status']);
    assert.equal(failed.diagnostics[0].code, 'configuration-converter-error');
});
