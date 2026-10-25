import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {
    assertConfigurationConversionRules,
    convertConfiguration,
} from '../../lib/common/configuration-conversion.mjs';
import {BACKGROUND_AGENT_DEFAULTS, completeGlobalConfigurationBytes, GLOBAL_CONFIGURATION_RULES, loadConfig, validateConfig} from '../../lib/arw-common/config.mjs';
import {defaultGlobalReviewers, resolveReviewerSettings} from '../../lib/arw-common/reviewer-configuration.mjs';

test('global configuration loads through the scoped JSON file Interface', async t => {
    const directory = await createTemporaryDirectory(t, 'arw-config-');
    const value = {
        agents: {},
        configVersion: 3,
        editor: {args: ['{file}'], command: 'code'},
        jira: {listLimit: 50},
        reviewEditor: {args: ['--wait', '{file}'], command: 'code'},
    };
    await writeFile(join(directory, 'config.json'), `${JSON.stringify(value)}\n`, 'utf8');

    assert.deepEqual(await loadConfig(directory), {...value, reviewers: defaultGlobalReviewers(), backgroundAgent: BACKGROUND_AGENT_DEFAULTS});
    await assert.rejects(loadConfig(join(directory, 'missing')), /could not be read/u);
});

test('global configuration rejects invalid UTF-8 before JSON validation', async t => {
    const directory = await createTemporaryDirectory(t, 'arw-invalid-config-');
    const prefix = Buffer.from('{"agents":{},"configVersion":3,"editor":{"args":["{file}"],"command":"', 'utf8');
    const suffix = Buffer.from('"},"jira":{"listLimit":50},"reviewEditor":{"args":["--wait","{file}"],"command":"code"}}\n', 'utf8');
    await writeFile(join(directory, 'config.json'), Buffer.concat([prefix, Buffer.from([0xc3, 0x28]), suffix]));

    await assert.rejects(
        loadConfig(directory),
        /config\.json is not valid UTF-8/u,
    );
});

test('Reviewer settings resolve by role and field with explicit Standard and isolated overrides', () => {
    const globalConfig = {reviewers: {
        'code-spec-reviewer': {model: 'global-model', modelProvider: 'provider', reasoningEffort: 'high', serviceTier: 'fast'},
    }};
    const repositoryConfig = {reviewers: {'code-spec-reviewer': {model: 'repository-model'}}};
    assert.deepEqual(resolveReviewerSettings({role: 'code-spec-reviewer', globalConfig, repositoryConfig}), {
        model: 'repository-model', modelProvider: 'provider', reasoningEffort: 'high', serviceTier: 'fast',
    });
    assert.deepEqual(resolveReviewerSettings({role: 'code-spec-reviewer', globalConfig, repositoryConfig, overrides: {serviceTier: 'default'}}), {
        model: 'repository-model', modelProvider: 'provider', reasoningEffort: 'high', serviceTier: 'default',
    });
    assert.deepEqual(resolveReviewerSettings({role: 'commit-audit-reviewer', globalConfig, repositoryConfig}), {
        model: 'gpt-6-luna', modelProvider: 'openai', reasoningEffort: 'xhigh', serviceTier: 'default',
    });
    assert.deepEqual(resolveReviewerSettings({role: 'commit-audit-reviewer', globalConfig, repositoryConfig, platform: 'claude-code'}), {
        model: 'haiku', modelProvider: 'anthropic', reasoningEffort: 'high', serviceTier: 'default',
    });
    const claude = {reviewers: {'commit-audit-reviewer': {model: 'sonnet', modelProvider: 'anthropic'}}};
    assert.deepEqual(resolveReviewerSettings({role: 'commit-audit-reviewer', globalConfig: claude, repositoryConfig, platform: 'claude-code'}), {
        model: 'sonnet', modelProvider: 'anthropic', reasoningEffort: 'xhigh', serviceTier: 'default',
    });
});

test('Global default completion preserves existing JSON text and rejects malformed known fields', () => {
    const original = Buffer.from('{\n  "configVersion": 3,\n  "agents": {},\n  "editor": {"command":"code","args":["{file}"]},\n  "reviewEditor": {"command":"code","args":["{file}"]},\n  "jira": {"listLimit":50},\n  "extension": {"literal": 1e3},\n  "reviewers": {"code-spec-reviewer": {"model": "custom"}}\n}\n');
    const completed = completeGlobalConfigurationBytes(original);
    assert.equal(completed.changed, true);
    const text = completed.bytes.toString('utf8');
    assert.ok(text.includes('"extension": {"literal": 1e3}'));
    assert.ok(text.includes('"code-spec-reviewer": {"model": "custom",'));
    assert.deepEqual(validateConfig(JSON.parse(text)).reviewers?.['code-spec-reviewer'], {
        model: 'custom', modelProvider: 'openai', reasoningEffort: 'xhigh', serviceTier: 'default',
    });
    assert.deepEqual(validateConfig(JSON.parse(text)).backgroundAgent, BACKGROUND_AGENT_DEFAULTS);
    assert.deepEqual(completeGlobalConfigurationBytes(completed.bytes), {bytes: completed.bytes, changed: false});
    const customCapacity = Buffer.from(original.toString('utf8').replace('"extension"', '"backgroundAgent": {"maxInstances": 2},\n  "extension"'));
    assert.deepEqual(validateConfig(JSON.parse(completeGlobalConfigurationBytes(customCapacity).bytes.toString('utf8'))).backgroundAgent, {...BACKGROUND_AGENT_DEFAULTS, maxInstances: 2});
    const invalid = Buffer.from(original.toString('utf8').replace('"model": "custom"', '"model": 7'));
    assert.throws(() => completeGlobalConfigurationBytes(invalid), /reviewers\.code-spec-reviewer\.model/u);
    const retiredField = Buffer.from(original.toString('utf8').replace('"extension"', '"backgroundAgent": {"maxAppServers": 4},\n  "extension"'));
    assert.throws(() => completeGlobalConfigurationBytes(retiredField), /backgroundAgent contains an unsupported field/u);
});

test('Background Agent timing defaults complete missing fields and preserve configured values', () => {
    const value = {
        configVersion: 3,
        editor: {command: 'code', args: ['{file}']},
        reviewEditor: {command: 'code', args: ['{file}']},
        jira: {listLimit: 50},
        backgroundAgent: {messageTimeoutMs: 12_000, persistenceIntervalMs: 250},
    };
    const completed = completeGlobalConfigurationBytes(Buffer.from(`${JSON.stringify(value)}\n`));
    assert.deepEqual(JSON.parse(completed.bytes.toString('utf8')).backgroundAgent, {
        ...BACKGROUND_AGENT_DEFAULTS, ...value.backgroundAgent,
    });
    assert.deepEqual(validateConfig(value).backgroundAgent, {
        ...BACKGROUND_AGENT_DEFAULTS, ...value.backgroundAgent,
    });
    for (const key of Object.keys(BACKGROUND_AGENT_DEFAULTS)) {
        for (const invalid of [0, -1, 1.5, '5000', null, Number.MAX_SAFE_INTEGER + 1]) {
            assert.throws(() => validateConfig({...value, backgroundAgent: {[key]: invalid}}),
                new RegExp(`backgroundAgent\\.${key} must be a positive safe integer`, 'u'));
        }
    }
});

test('global configuration rules support only published v1 and current v3', () => {
    assert.doesNotThrow(() => assertConfigurationConversionRules(GLOBAL_CONFIGURATION_RULES));
    assert.throws(() => validateConfig({
        configVersion: 2,
        editor: {args: ['{file}'], command: 'code'},
    }), /Invalid configuration: configVersion must be 1 or 3\./u);
    assert.throws(() => validateConfig({
        configVersion: 3,
        editor: {args: ['{file}'], command: 'code'},
        reviewEditor: {args: ['--wait', '{file}'], command: 'code'},
    }), /Invalid configuration: jira must be an object\./u);
});

test('global configuration rules upgrade v1 directly to the complete ordered v3 value', () => {
    const result = convertConfiguration({
        rules: GLOBAL_CONFIGURATION_RULES,
        sourceBytes: Buffer.from('{"configVersion":1,"agents":{"impl":{"command":"codex","args":[]}},"editor":{"command":"nano","args":["--","{file}"]},"extension":{"enabled":true}}\n'),
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
            '  "agents": {',
            '    "impl": {',
            '      "command": "codex",',
            '      "args": []',
            '    }',
            '  },',
            '  "editor": {',
            '    "command": "nano",',
            '    "args": [',
            '      "--",',
            '      "{file}"',
            '    ]',
            '  },',
            '  "reviewEditor": {',
            '    "command": "code",',
            '    "args": [',
            '      "--new-window",',
            '      "--wait",',
            '      "{file}"',
            '    ]',
            '  },',
            '  "jira": {',
            '    "listLimit": 50',
            '  },',
            `  "reviewers": ${JSON.stringify(defaultGlobalReviewers(), null, 2).replaceAll('\n', '\n  ')},`,
            '  "extension": {',
            '    "enabled": true',
            '  }',
            '}',
            '',
        ].join('\n')),
        changes: [{
            sourceVersion: 1,
            targetVersion: 3,
            entries: [
                {kind: 'converted', sourcePath: 'configVersion', targetPath: 'configVersion'},
                {kind: 'added', path: 'reviewEditor.command'},
                {kind: 'added', path: 'reviewEditor.args'},
                {kind: 'added', path: 'jira.listLimit'},
                {kind: 'added', path: 'reviewers'},
            ],
        }],
        unknownPaths: ['extension'],
    });
});
