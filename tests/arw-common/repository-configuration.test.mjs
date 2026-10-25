import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import test from 'node:test';

import {assertConfigurationConversionRules} from '../../lib/common/configuration-conversion.mjs';
import {
    REPOSITORY_CONFIGURATION_RULES,
    completeRepositoryConfigurationBytes,
    resolveRepositoryConfiguration,
} from '../../lib/arw-common/repository-configuration.mjs';

test('Application Configuration resolves a Repository without application as Application Member', () => {
    assert.doesNotThrow(() => assertConfigurationConversionRules(REPOSITORY_CONFIGURATION_RULES));
    assert.deepEqual(resolveRepositoryConfiguration({
        repositoryRoot: resolve('member-repository'),
        value: {configVersion: 2},
    }), {
        context: {role: 'member'},
        languageChecks: [],
        reviewers: {},
        diagnostics: [],
        status: 'succeeded',
    });
});

test('Application Configuration resolves a complete Application Leader context', () => {
    const repositoryRoot = resolve('leader-repository');
    assert.deepEqual(resolveRepositoryConfiguration({
        repositoryRoot,
        value: {
            configVersion: 2,
            application: {
                name: 'payments',
                submoduleRemote: 'origin',
                submoduleDistributionBranch: 'dev',
                modules: [{name: 'billing', path: 'modules/billing'}],
                jira: {
                    baseUrl: 'https://jira.example.test/team',
                    projectKey: 'PAY',
                    issueType: 'Story',
                    candidateStatus: 'Backlog',
                    acceptedStatus: 'In Progress',
                    completedStatus: 'Done',
                },
            },
        },
    }), {
        context: {
            jira: {
                acceptedStatus: 'In Progress',
                baseUrl: 'https://jira.example.test/team/',
                candidateStatus: 'Backlog',
                completedStatus: 'Done',
                issueType: 'Story',
                projectKey: 'PAY',
            },
            modules: {
                billing: {
                    name: 'billing',
                    path: 'modules/billing',
                    repositoryRoot: resolve(repositoryRoot, 'modules/billing'),
                },
            },
            name: 'payments',
            role: 'leader',
            submodule: {distributionBranch: 'dev', remote: 'origin'},
        },
        languageChecks: [],
        reviewers: {},
        diagnostics: [],
        status: 'succeeded',
    });
});

test('Repository Reviewer completion creates empty role overrides and preserves user JSON text', () => {
    const created = completeRepositoryConfigurationBytes(null);
    assert.equal(created.changed, true);
    assert.deepEqual(JSON.parse(created.bytes.toString('utf8')).reviewers, {
        'code-standards-reviewer': {}, 'requirements-reviewer': {}, 'spec-readiness-reviewer': {},
    });
    const source = Buffer.from('{"configVersion":2,"languageChecks":{"doc":{"language":"chinese","minPercentage":1e2,"include":["docs/**"]}},"reviewers":{"requirements-reviewer":{"serviceTier":"fast"}}}\n');
    const completed = completeRepositoryConfigurationBytes(source);
    assert.equal(completed.changed, true);
    assert.ok(completed.bytes.toString('utf8').includes('"minPercentage":1e2'));
    assert.deepEqual(JSON.parse(completed.bytes.toString('utf8')).reviewers['requirements-reviewer'], {serviceTier: 'fast'});
    assert.deepEqual(completeRepositoryConfigurationBytes(completed.bytes), {bytes: completed.bytes, changed: false});
    assert.throws(() => completeRepositoryConfigurationBytes(Buffer.from('{"configVersion":2,"reviewers":{"requirements-reviewer":{"serviceTier":null}}}')), /serviceTier/u);
});

test('Application Configuration blocks invalid v2 fields without returning a context', () => {
    const repositoryRoot = resolve('invalid-repository');
    const valid = {
        configVersion: 2,
        application: {
            name: 'payments',
            submoduleRemote: 'origin',
            submoduleDistributionBranch: 'dev',
            modules: [{name: 'billing', path: 'modules/billing'}],
            jira: {
                baseUrl: 'https://jira.example.test/',
                projectKey: 'PAY',
                issueType: 'Story',
                candidateStatus: 'Backlog',
                acceptedStatus: 'In Progress',
                completedStatus: 'Done',
            },
        },
    };
    /** @type {Array<[(value: any) => void, string]>} */
    const cases = [
        [value => { value.configVersion = 1; }, 'application-configuration-version-invalid'],
        [value => { value.extra = true; }, 'application-configuration-field-unknown'],
        [value => { value.application.name = 'Payments'; }, 'application-configuration-name-invalid'],
        [value => { value.application.submoduleRemote = 'origin '; }, 'application-configuration-string-invalid'],
        [value => { value.application.modules[0].path = 'modules/line\nbreak'; }, 'application-configuration-module-path-invalid'],
        [value => { value.application.modules.push({name: 'billing', path: 'modules/other'}); }, 'application-configuration-module-name-duplicate'],
        [value => { value.application.modules.push({name: 'nested', path: 'modules/billing/nested'}); }, 'application-configuration-module-path-overlap'],
        [value => { value.application.jira.baseUrl = 'https://jira.example.test/?query=1'; }, 'application-configuration-jira-url-invalid'],
        [value => { value.application.jira.completedStatus = 'Done\u0007'; }, 'application-configuration-string-invalid'],
    ];

    for (const [mutate, expectedCode] of cases) {
        const value = structuredClone(valid);
        mutate(value);
        const result = resolveRepositoryConfiguration({repositoryRoot, value});
        assert.equal(result.status, 'blocked');
        assert.equal(Object.hasOwn(result, 'context'), false);
        assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === expectedCode), JSON.stringify(result));
    }
});

test('Repository configuration validates named language rules and preserves native dictionary order', () => {
    const repositoryRoot = resolve('language-repository');
    const rule = {language: 'chinese', minPercentage: 80, include: ['docs/**/*.md']};
    const languageChecks = {z: rule, '2': {...rule, minPercentage: 0}, a: {...rule, language: 'english', minPercentage: 100, exclude: ['docs/generated/']}};
    const result = resolveRepositoryConfiguration({repositoryRoot, value: {configVersion: 2, languageChecks}});
    assert.equal(result.status, 'succeeded');
    if (result.status !== 'succeeded') assert.fail();
    assert.deepEqual(result.languageChecks.map(check => check.name), Object.keys(languageChecks));
    assert.deepEqual(result.languageChecks[1].exclude, []);
    assert.deepEqual(languageChecks.z, rule);
    for (const invalid of [[], {bad: {...rule, name: 'bad'}}, {bad: {...rule, language: 'french'}},
        {bad: {...rule, minPercentage: -1}}, {bad: {...rule, minPercentage: 101}},
        {bad: {...rule, minPercentage: NaN}}, {bad: {...rule, include: []}},
        {bad: {...rule, include: ['../escape']}}, {bad: {...rule, exclude: ['/absolute']}},
        {bad: {...rule, include: ['docs\\file.md']}}, {bad: {...rule, include: ['docs/a**b.md']}},
        {bad: {...rule, include: ['./../escape']}}, {bad: {...rule, include: ['.//']}},
        {bad: {...rule, include: ['./docs//file.md']}}]) {
        const blocked = resolveRepositoryConfiguration({repositoryRoot, value: {configVersion: 2, languageChecks: invalid}});
        assert.equal(blocked.status, 'blocked', JSON.stringify(invalid));
        assert.equal('context' in blocked, false);
    }
});
