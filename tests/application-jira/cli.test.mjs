import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {parseCommand} from '../../lib/arw.mjs';
import {evaluateModuleCorrectionCheckCommand} from '../../lib/application-jira/application-jira-cli.mjs';
import {createScopedFilesystem} from '../../lib/common/filesystem.mjs';
import {createRepository, run, writeConfig, writeIssue, writeJsonRecord} from '../helpers/arw-cli.mjs';
import {runGit} from '../helpers/git.mjs';

/** @typedef {{baseUrl: string, body?: unknown, method: 'GET' | 'POST', query?: Record<string, string>, relativeEndpoint: string}} JiraRequestInput */

const applicationConfiguration = {
    configVersion: 2,
    application: {
        jira: {
            acceptedStatus: 'In Progress',
            baseUrl: 'https://jira.example.test/team',
            candidateStatus: 'Backlog',
            completedStatus: 'Done',
            issueType: 'Story',
            projectKey: 'PAY',
        },
        modules: [],
        name: 'payments',
        submoduleDistributionBranch: 'dev',
        submoduleRemote: 'origin',
    },
};

const globalConfiguration = {
    agents: {},
    configVersion: 3,
    editor: {args: ['{file}'], command: 'code'},
    jira: {listLimit: 3},
    reviewEditor: {args: ['--wait', '{file}'], command: 'code'},
};

/** @typedef {{acceptance?: string, association?: string, blocked?: string, downstream?: string, specRequirement?: string, validation?: string, what?: string}} CorrectionIssueOptions */

/** @param {CorrectionIssueOptions} options */
const correctionIssueText = ({
    acceptance = '- [ ] Pass.',
    association = 'issue:payments:0001:01',
    blocked = '- None',
    downstream = '- Existing.',
    specRequirement = 'Not required',
    validation = '- Not run.',
    what = 'Build it.',
} = {}) => [
    '# Build',
    '',
    'Status: ready-for-agent',
    `Application source issue: \`${association}\``,
    '',
    '## What to build',
    '',
    what,
    '',
    '## Spec Requirement',
    '',
    specRequirement,
    '',
    '## Acceptance criteria',
    '',
    acceptance,
    '',
    '## Validation',
    '',
    validation,
    '',
    '## Blocked by',
    '',
    blocked,
    '',
    '## Comments',
    '',
    '### Downstream changes',
    '',
    downstream,
    '',
].join('\n');

/** @param {test.TestContext} t @param {{specText?: string}} [options] */
const preparePublishedCorrection = async (t, {specText} = {}) => {
    const repository = await createRepository(t);
    const issuePath = join(repository.root, '.scratch', '0007-work', 'issues', '01-build.md');
    const specPath = join(repository.root, '.scratch', '0007-work', 'spec.md');
    await writeIssue(repository.root, '0007-work', '01-build.md', correctionIssueText());
    if (specText !== undefined) await writeFile(specPath, specText, 'utf8');
    await runGit(repository.root, ['add', '.scratch']);
    await runGit(repository.root, ['-c', 'user.name=ARW Tests', '-c', 'user.email=tests@example.invalid', 'commit', '--quiet', '-m', 'base']);
    return {issuePath, repository, specPath};
};

test('Module correction check parses only one local implementation issue ID', () => {
    assert.deepEqual(parseCommand(['module', 'check-correction', 'issue:0007:01']), {
        issueId: 'issue:0007:01',
        kind: 'module-check-correction',
    });
    assert.throws(() => parseCommand(['module', 'check-correction', 'issue:billing:0007:01']), /local Module issue ID/u);
    assert.throws(() => parseCommand(['module', 'check-correction']), /local Module issue ID/u);
});

test('Module correction check reads HEAD and current files without Application configuration or writes', async t => {
    const repository = await createRepository(t);
    const issuePath = join(repository.root, '.scratch', '0007-work', 'issues', '01-build.md');
    /** @param {{downstream: string, validation: string, what: string}} input */
    const render = ({downstream, validation, what}) => [
        '# Build',
        '',
        'Status: ready-for-agent',
        'Application source issue: `issue:payments:0001:01`',
        '',
        '## What to build',
        '',
        what,
        '',
        '## Spec Requirement',
        '',
        'Not required',
        '',
        '## Acceptance criteria',
        '',
        '- [ ] Pass.',
        '',
        '## Validation',
        '',
        validation,
        '',
        '## Blocked by',
        '',
        '- None',
        '',
        '## Comments',
        '',
        '### Downstream changes',
        '',
        downstream,
        '',
    ].join('\n');
    await writeIssue(repository.root, '0007-work', '01-build.md', render({downstream: '- Existing.', validation: '- Not run.', what: 'Build it.'}));
    await runGit(repository.root, ['add', '.scratch/0007-work/issues/01-build.md']);
    await runGit(repository.root, ['-c', 'user.name=ARW Tests', '-c', 'user.email=tests@example.invalid', 'commit', '--quiet', '-m', 'base']);
    await writeFile(issuePath, render({downstream: '- Corrected the target.', validation: '- Staged evidence.', what: 'Build the corrected behavior.'}), 'utf8');
    await runGit(repository.root, ['add', '.scratch/0007-work/issues/01-build.md']);
    await writeFile(issuePath, render({downstream: '- Corrected the target.', validation: '- Unstaged evidence.', what: 'Build the corrected behavior.'}), 'utf8');
    const before = await readFile(issuePath);

    assert.deepEqual(await run(['module', 'check-correction', 'issue:0007:01'], repository), {
        events: [{channel: 'stdout', message: 'Module correction check passed: issue:0007:01.'}],
        result: 0,
    });
    assert.deepEqual(await readFile(issuePath), before);
});

for (const [name, changes] of /** @type {Array<[string, CorrectionIssueOptions]>} */ ([
    ['Spec Requirement', {specRequirement: 'Corrected requirement.'}],
    ['Acceptance criteria', {acceptance: '- [ ] Corrected acceptance.'}],
    ['Blocked by', {blocked: '- External dependency: `issue:ledger:0001:01` - Wait for the corrected contract.'}],
])) {
    test(`Module correction check accepts a ${name} soft-lock change through the public command`, async t => {
        const {issuePath, repository} = await preparePublishedCorrection(t);
        await writeFile(issuePath, correctionIssueText({...changes, downstream: `- Corrected ${name}.`}), 'utf8');
        assert.deepEqual(await run(['module', 'check-correction', 'issue:0007:01'], repository), {
            events: [{channel: 'stdout', message: 'Module correction check passed: issue:0007:01.'}],
            result: 0,
        });
    });
}

test('Module correction check accepts a tracked same-effort spec soft-lock change', async t => {
    const {issuePath, repository, specPath} = await preparePublishedCorrection(t, {specText: '# Original spec\n'});
    await writeFile(specPath, '# Corrected spec\n', 'utf8');
    await writeFile(issuePath, correctionIssueText({downstream: '- Corrected the tracked effort spec.'}), 'utf8');
    assert.equal((await run(['module', 'check-correction', 'issue:0007:01'], repository)).result, 0);
});

for (const [name, changes, message] of /** @type {Array<[string, CorrectionIssueOptions, string]>} */ ([
    ['association change', {association: 'issue:payments:0001:02', downstream: '- Changed the association.', what: 'Corrected.'}, 'Application source issue association must not change.'],
])) {
    test(`Module correction check blocks a ${name} through the public command`, async t => {
        const {issuePath, repository} = await preparePublishedCorrection(t);
        await writeFile(issuePath, correctionIssueText(changes), 'utf8');
        const result = await run(['module', 'check-correction', 'issue:0007:01'], repository);
        assert.equal(result.result, 1);
        assert.ok(result.events.some(event => event.channel === 'stderr' && event.message === message));
    });
}

test('Module correction check reports Git and filesystem read failures without writing', async t => {
    const {issuePath, repository, specPath} = await preparePublishedCorrection(t, {specText: '# Original spec\n'});
    await writeFile(issuePath, correctionIssueText({downstream: '- Corrected the target.', what: 'Corrected.'}), 'utf8');
    await writeFile(specPath, '# Corrected spec\n', 'utf8');
    const issueBefore = await readFile(issuePath);
    const specBefore = await readFile(specPath);

    const gitFailure = await run(['module', 'check-correction', 'issue:0007:01'], repository, {
        applicationJiraDependencies: {
            git: {run: async () => ({code: 2, failure: null, stderr: '', stdout: Buffer.alloc(0)})},
        },
    });
    assert.equal(gitFailure.result, 1);
    assert.ok(gitFailure.events.some(event => event.channel === 'stderr' && event.message.includes('HEAD')));
    assert.deepEqual(await evaluateModuleCorrectionCheckCommand({
        command: {issueId: 'issue:0007:01', kind: 'module-check-correction'},
        dependencies: {git: {run: async () => ({code: 2, failure: null, stderr: '', stdout: Buffer.alloc(0)})}},
        repositoryRoot: repository.root,
    }), {
        diagnostics: [{code: 'module-correction-git-read-failed', message: 'Git could not read the published Module issue from HEAD.'}],
        stage: 'git-read',
        status: 'failed',
    });

    const filesystemFailure = await run(['module', 'check-correction', 'issue:0007:01'], repository, {
        applicationJiraDependencies: {
            openFilesystem: async () => ({diagnostics: [{code: 'fixture-filesystem-failed', message: 'Injected.'}], stage: 'open', status: /** @type {'failed'} */ ('failed')}),
        },
    });
    assert.equal(filesystemFailure.result, 1);
    assert.ok(filesystemFailure.events.some(event => event.channel === 'stderr' && event.message.includes('Filesystem')));
    const filesystemResult = await evaluateModuleCorrectionCheckCommand({
        command: {issueId: 'issue:0007:01', kind: 'module-check-correction'},
        dependencies: {
            openFilesystem: async () => ({diagnostics: [{code: 'fixture-filesystem-failed', message: 'Injected.'}], stage: 'open', status: /** @type {'failed'} */ ('failed')}),
        },
        repositoryRoot: repository.root,
    });
    assert.equal(filesystemResult.status, 'failed');
    if (filesystemResult.status !== 'failed') assert.fail('Expected a filesystem failure.');
    assert.equal(filesystemResult.stage, 'filesystem-read');
    assert.deepEqual(filesystemResult.diagnostics, [{
        code: 'module-correction-filesystem-read-failed',
        message: 'Filesystem could not read the current Module issue.',
    }]);
    assert.deepEqual(await readFile(issuePath), issueBefore);
    assert.deepEqual(await readFile(specPath), specBefore);
});

test('JIRA list commands block Application Members before external requests', async t => {
    assert.deepEqual(parseCommand(['jira', 'list']), {kind: 'jira-list', limit: null});
    assert.deepEqual(parseCommand(['jl']), {kind: 'jira-list', limit: null});

    const repository = await createRepository(t);
    for (const args of [['jira', 'list'], ['jl']]) {
        assert.deepEqual(await run(args, repository), {
            events: [{
                channel: 'stderr',
                message: 'Application configuration is required for JIRA list.',
            }],
            result: 1,
        });
    }
});

test('JIRA list uses Application and global configuration and renders one complete page', async t => {
    const repository = await createRepository(t);
    await writeConfig(repository.programDirectory, globalConfiguration);
    await writeJsonRecord(repository.root, 'arw.config.json', applicationConfiguration);
    /** @type {JiraRequestInput[]} */
    const requests = [];

    assert.deepEqual(await run(['jira', 'list'], repository, {
        applicationJiraDependencies: {
            request: async (/** @type {JiraRequestInput} */ input) => {
                requests.push(input);
                return {
                    diagnostics: [],
                    status: 'succeeded',
                    value: {
                        issues: [
                            {fields: {summary: 'First story'}, key: 'PAY-1'},
                            {fields: {summary: 'Second story'}, key: 'PAY-22'},
                        ],
                        total: 12,
                    },
                };
            },
        },
    }), {
        events: [{
            channel: 'stdout',
            message: [
                'Total matching issues: 12',
                'Showing first 2 issues ordered by key.',
                '',
                'Key     Title',
                '------  ------------',
                'PAY-1   First story',
                'PAY-22  Second story',
            ].join('\n'),
        }],
        result: 0,
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.query?.maxResults, '3');
});

test('JIRA open encodes an opaque key and uses only the Browser Adapter', async t => {
    assert.deepEqual(parseCommand(['jira', 'open', 'PAY/1?#']), {issueKey: 'PAY/1?#', kind: 'jira-open'});
    assert.deepEqual(parseCommand(['jo', 'PAY/1?#']), {issueKey: 'PAY/1?#', kind: 'jira-open'});
    const repository = await createRepository(t);
    await writeConfig(repository.programDirectory, globalConfiguration);
    await writeJsonRecord(repository.root, 'arw.config.json', applicationConfiguration);
    /** @type {string[]} */
    const urls = [];
    const dependencies = {
        openBrowser: async (/** @type {string} */ url) => {
            urls.push(url);
            return {diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded')};
        },
        /** @returns {never} */
        get token() {
            throw new Error('JIRA open must not read a token.');
        },
    };

    assert.deepEqual(await run(['jo', 'PAY/1?#'], repository, {applicationJiraDependencies: dependencies}), {
        events: [],
        result: 0,
    });
    assert.deepEqual(urls, ['https://jira.example.test/team/browse/PAY%2F1%3F%23']);
});

test('JIRA print routes an encoded opaque key and emits one complete pretty JSON value', async t => {
    assert.deepEqual(parseCommand(['jira', 'print', 'PAY/1']), {issueKey: 'PAY/1', kind: 'jira-print'});
    const repository = await createRepository(t);
    await writeConfig(repository.programDirectory, globalConfiguration);
    await writeJsonRecord(repository.root, 'arw.config.json', applicationConfiguration);
    /** @type {JiraRequestInput[]} */
    const requests = [];
    const value = {
        key: 'PAY/1',
        url: 'https://jira.example.test/team/browse/PAY%2F1',
        project: null,
        issueType: null,
        status: null,
        summary: null,
        description: null,
        priority: null,
        reporter: null,
        assignee: null,
        labels: [],
        components: [],
        fixVersions: [],
        created: null,
        updated: null,
        comments: [],
        attachments: [],
        links: [],
        customFields: [],
        otherFields: [],
    };

    assert.deepEqual(await run(['jira', 'print', 'PAY/1'], repository, {
        applicationJiraDependencies: {
            request: async (/** @type {JiraRequestInput} */ input) => {
                requests.push(input);
                return {
                    diagnostics: [],
                    status: 'succeeded',
                    value: {fields: {}, key: 'PAY/1', names: {}, schema: {}},
                };
            },
        },
    }), {
        events: [{channel: 'stdout', message: `${JSON.stringify(value, null, 2)}\n`}],
        result: 0,
    });
    assert.equal(requests[0].relativeEndpoint, 'rest/api/2/issue/PAY%2F1');
});

test('Submodule switch-branch and ssb route every configured Module through the coordination boundary', async t => {
    assert.deepEqual(parseCommand(['submodule', 'switch-branch', 'release']), {kind: 'submodule-switch-branch', targetBranch: 'release'});
    assert.deepEqual(parseCommand(['ssb', 'release']), {kind: 'submodule-switch-branch', targetBranch: 'release'});
    const repository = await createRepository(t);
    await writeConfig(repository.programDirectory, globalConfiguration);
    const configuration = {
        ...applicationConfiguration,
        application: {...applicationConfiguration.application, modules: [{name: 'billing', path: 'modules/billing'}]},
    };
    await writeJsonRecord(repository.root, 'arw.config.json', configuration);
    /** @type {string[]} */
    const events = [];

    assert.deepEqual(await run(['ssb', 'release'], repository, {
        applicationJiraDependencies: {
            submoduleGit: {
                inspectSwitch: async input => {
                    events.push(`inspect:${input.module}:${input.targetBranch}`);
                    return {diagnostics: [], state: {branch: 'dev', clean: true, head: 'aaa', localBranchExists: true, remoteBranchExists: false}, status: 'succeeded'};
                },
                restore: async () => assert.fail('No recovery expected.'),
                switchBranch: async input => {
                    events.push(`switch:${input.module}:${input.targetBranch}`);
                    return {diagnostics: [], state: {branch: 'release', head: 'bbb'}, status: 'succeeded'};
                },
            },
        },
    }), {
        events: [{channel: 'stdout', message: 'billing: release @ bbb (changed)'}],
        result: 0,
    });
    assert.deepEqual(events, ['inspect:billing:release', 'switch:billing:release']);
});

test('Submodule switch-branch succeeds explicitly when Application configuration has no Modules', async t => {
    const repository = await createRepository(t);
    await writeConfig(repository.programDirectory, globalConfiguration);
    await writeJsonRecord(repository.root, 'arw.config.json', applicationConfiguration);
    assert.deepEqual(await run(['ssb', 'dev'], repository), {
        events: [{channel: 'stdout', message: 'No configured Application Modules.'}],
        result: 0,
    });
});

test('Application sync converges configured Modules and leaves status replacements unstaged', async t => {
    assert.deepEqual(parseCommand(['application', 'sync']), {kind: 'application-sync'});
    const repository = await createRepository(t);
    await writeConfig(repository.programDirectory, globalConfiguration);
    const configuration = {
        ...applicationConfiguration,
        application: {...applicationConfiguration.application, modules: [{name: 'billing', path: 'modules/billing'}]},
    };
    await writeJsonRecord(repository.root, 'arw.config.json', configuration);
    await mkdir(join(repository.root, '.scratch', '0001-application-work', 'issues'), {recursive: true});
    await mkdir(join(repository.root, 'modules', 'billing', '.scratch', '0007-billing-work', 'issues'), {recursive: true});
    await writeFile(join(repository.root, '.scratch', '0001-application-work', 'issues', '02-source.md'), '# Source\n\nStatus: ready-for-agent\nModule implementation issue: `issue:billing:0007:07`\n\n## Blocked by\n\n- None\n\n## Comments\n\n- Keep this Application comment.\n\n### Downstream changes\n\n- Remove this old item.\n', 'utf8');
    await writeFile(join(repository.root, 'modules', 'billing', '.scratch', '0007-billing-work', 'issues', '07-build.md'), '# Build\n\nStatus: completed\nApplication source issue: `issue:payments:0001:02`\n\n## Blocked by\n\n- None\n\n## Comments\n\n### Downstream changes\n\n- Use the corrected retry limit.\n', 'utf8');
    await runGit(repository.root, ['add', '.scratch/0001-application-work/issues/02-source.md']);
    const unused = async () => assert.fail('Switch operation is not used.');

    assert.deepEqual(await run(['application', 'sync'], repository, {
        applicationJiraDependencies: {
            submoduleGit: {
                compareRemote: async () => ({diagnostics: [], relation: 'equal', state: {branch: 'dev', head: 'aaa', remoteHead: 'aaa'}, status: 'succeeded'}),
                fastForward: async () => assert.fail('No fast-forward expected.'),
                fetch: async () => ({diagnostics: [], status: 'succeeded'}),
                inspectConvergence: async () => ({diagnostics: [], state: {branch: 'dev', clean: true, head: 'aaa'}, status: 'succeeded'}),
                inspectSwitch: unused,
                restore: unused,
                switchBranch: unused,
            },
        },
    }), {
        events: [{channel: 'stdout', message: 'Application sync completed. Updated 1 Application Source Issue(s).'}],
        result: 0,
    });
    assert.equal(await readFile(join(repository.root, '.scratch', '0001-application-work', 'issues', '02-source.md'), 'utf8'), '# Source\n\nStatus: completed\nModule implementation issue: `issue:billing:0007:07`\n\n## Blocked by\n\n- None\n\n## Comments\n\n- Keep this Application comment.\n\n### Downstream changes\n\n- Use the corrected retry limit.\n');
});

test('Application sync reports completed operations and rollback for a multi-Module transaction failure', async t => {
    const repository = await createRepository(t);
    await writeConfig(repository.programDirectory, globalConfiguration);
    await writeJsonRecord(repository.root, 'arw.config.json', {
        ...applicationConfiguration,
        application: {
            ...applicationConfiguration.application,
            modules: [
                {name: 'billing', path: 'modules/billing'},
                {name: 'ledger', path: 'modules/ledger'},
            ],
        },
    });
    const applicationIssues = join(repository.root, '.scratch', '0001-application-work', 'issues');
    const billingIssues = join(repository.root, 'modules', 'billing', '.scratch', '0007-billing-work', 'issues');
    const ledgerIssues = join(repository.root, 'modules', 'ledger', '.scratch', '0008-ledger-work', 'issues');
    await mkdir(applicationIssues, {recursive: true});
    await mkdir(billingIssues, {recursive: true});
    await mkdir(ledgerIssues, {recursive: true});
    const firstPath = join(applicationIssues, '01-billing.md');
    const secondPath = join(applicationIssues, '02-ledger.md');
    const firstBefore = '# Billing\n\nStatus: ready-for-agent\nModule implementation issue: `issue:billing:0007:01`\n\n## Blocked by\n\n- None\n';
    const secondBefore = '# Ledger\n\nStatus: ready-for-agent\nModule implementation issue: `issue:ledger:0008:01`\n\n## Blocked by\n\n- None\n';
    await writeFile(firstPath, firstBefore, 'utf8');
    await writeFile(secondPath, secondBefore, 'utf8');
    await writeFile(join(billingIssues, '01-build.md'), '# Billing\n\nStatus: completed\nApplication source issue: `issue:payments:0001:01`\n\n## Blocked by\n\n- None\n\n## Comments\n\n### Downstream changes\n\n- Billing correction.\n', 'utf8');
    await writeFile(join(ledgerIssues, '01-build.md'), '# Ledger\n\nStatus: completed\nApplication source issue: `issue:payments:0001:02`\n\n## Blocked by\n\n- None\n\n## Comments\n\n### Downstream changes\n\n- Ledger correction.\n', 'utf8');
    await runGit(repository.root, ['add', '.scratch/0001-application-work/issues']);
    const indexBefore = (await runGit(repository.root, ['ls-files', '--stage', '--', '.scratch'])).stdout;
    const unused = async () => assert.fail('Switch operation is not used.');
    const submoduleGit = {
        compareRemote: async (/** @type {{module: string}} */ input) => ({diagnostics: [], relation: /** @type {'equal'} */ ('equal'), state: {branch: 'dev', head: input.module, remoteHead: input.module}, status: /** @type {'succeeded'} */ ('succeeded')}),
        fastForward: async () => assert.fail('No fast-forward expected.'),
        fetch: async () => ({diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded')}),
        inspectConvergence: async (/** @type {{module: string}} */ input) => ({diagnostics: [], state: {branch: 'dev', clean: true, head: input.module}, status: /** @type {'succeeded'} */ ('succeeded')}),
        inspectSwitch: unused,
        restore: unused,
        switchBranch: unused,
    };
    let writes = 0;
    const result = await run(['application', 'sync'], repository, {
        applicationJiraDependencies: {
            openFilesystem: async input => {
                const opened = await createScopedFilesystem(input);
                if (opened.status !== 'succeeded') return opened;
                const filesystem = opened.scopedFilesystem;
                return {
                    ...opened,
                    scopedFilesystem: {
                        ...filesystem,
                        write: async writeInput => {
                            writes += 1;
                            if (writes === 2) return {diagnostics: [{code: 'fixture-write-failed', message: 'Injected Application sync write failure.'}], stage: 'write', status: /** @type {'failed'} */ ('failed')};
                            return filesystem.write(writeInput);
                        },
                    },
                };
            },
            submoduleGit,
        },
    });

    assert.equal(result.result, 1);
    assert.ok(result.events.some(event => event.channel === 'stderr'
        && event.message === 'Application sync failed at stage: apply:.scratch/0001-application-work/issues/02-ledger.md.'));
    assert.ok(result.events.some(event => event.channel === 'stderr' && event.message.includes('Application sync completed operation:') && event.message.includes('01-billing.md')));
    assert.ok(result.events.some(event => event.channel === 'stderr' && event.message.includes('Application sync rollback:') && event.message.includes('status=restored')));
    assert.equal(await readFile(firstPath, 'utf8'), firstBefore);
    assert.equal(await readFile(secondPath, 'utf8'), secondBefore);
    assert.equal((await runGit(repository.root, ['ls-files', '--stage', '--', '.scratch'])).stdout, indexBefore);

    let inspections = 0;
    const blocked = await run(['application', 'sync'], repository, {
        applicationJiraDependencies: {
            openFilesystem: async input => {
                const opened = await createScopedFilesystem(input);
                if (opened.status !== 'succeeded') return opened;
                const filesystem = opened.scopedFilesystem;
                return {
                    ...opened,
                    scopedFilesystem: {
                        ...filesystem,
                        inspect: async inspectInput => {
                            inspections += 1;
                            return inspections === 3
                                ? {diagnostics: [], entry: {kind: 'directory', path: inspectInput.path}, status: /** @type {'succeeded'} */ ('succeeded')}
                                : filesystem.inspect(inspectInput);
                        },
                    },
                };
            },
            submoduleGit,
        },
    });
    assert.equal(blocked.result, 1);
    assert.ok(blocked.events.some(event => event.channel === 'stderr' && event.message === 'The file state changed after preflight.'));
    assert.equal(blocked.events.some(event => event.message.includes('Application sync failed at stage:')), false);
});

test('Application sync blocks deleted or de-associated index records before Module convergence', async t => {
    const repository = await createRepository(t);
    await writeConfig(repository.programDirectory, globalConfiguration);
    const configuration = {
        ...applicationConfiguration,
        application: {...applicationConfiguration.application, modules: [{name: 'billing', path: 'modules/billing'}]},
    };
    await writeJsonRecord(repository.root, 'arw.config.json', configuration);
    const issueDirectory = join(repository.root, '.scratch', '0001-application-work', 'issues');
    const issuePath = join(issueDirectory, '02-source.md');
    await mkdir(issueDirectory, {recursive: true});
    await writeFile(issuePath, '# Source\n\nStatus: ready-for-agent\nModule implementation issue: `issue:billing:0007:07`\n\n## Blocked by\n\n- None\n', 'utf8');
    await runGit(repository.root, ['add', '.scratch/0001-application-work/issues/02-source.md']);
    await runGit(repository.root, ['commit', '--quiet', '-m', 'application source fixture']);
    let convergenceCalls = 0;
    const unused = async () => assert.fail('No Module convergence operation is expected.');
    const dependencies = {
        applicationJiraDependencies: {
            submoduleGit: {
                compareRemote: unused,
                fastForward: unused,
                fetch: unused,
                inspectConvergence: async () => {
                    convergenceCalls += 1;
                    return {diagnostics: [], state: {branch: 'dev', clean: true, head: 'aaa'}, status: /** @type {'succeeded'} */ ('succeeded')};
                },
                inspectSwitch: unused,
                restore: unused,
                switchBranch: unused,
            },
        },
    };

    for (const mutation of ['deleted', 'de-associated']) {
        if (mutation === 'deleted') {
            await runGit(repository.root, ['rm', '--quiet', '.scratch/0001-application-work/issues/02-source.md']);
        } else {
            await writeFile(issuePath, '# Source\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- None\n', 'utf8');
            await runGit(repository.root, ['add', '.scratch/0001-application-work/issues/02-source.md']);
        }
        const result = await run(['application', 'sync'], repository, dependencies);
        assert.equal(result.result, 1, mutation);
        assert.ok(result.events.some(event => event.channel === 'stderr' && event.message.includes('Git index')), mutation);
        assert.equal(convergenceCalls, 0, mutation);
        await runGit(repository.root, ['restore', '--source=HEAD', '--staged', '--worktree', '.scratch/0001-application-work/issues/02-source.md']);
    }
});

test('Workflow init, update, and verify validate Repository Application configuration before their ordinary plans', async t => {
    const repository = await createRepository(t);
    await writeJsonRecord(repository.root, 'arw.config.json', {
        ...applicationConfiguration,
        application: {...applicationConfiguration.application, name: 'Invalid Name'},
    });

    for (const args of [['workflow', 'init'], ['workflow', 'update'], ['workflow', 'verify']]) {
        const result = await run(args, repository);
        assert.equal(result.result, 1, args.join(' '));
        assert.ok(result.events.some(event => event.channel === 'stderr' && event.message.includes('application.name must match')), args.join(' '));
    }
});

test('Application associate writes bidirectional fields through two Repository transactions', async t => {
    assert.deepEqual(parseCommand(['application', 'associate', 'issue:0001:02', 'issue:billing:0007:07']), {
        kind: 'application-associate',
        moduleIssueId: 'issue:0007:07',
        moduleName: 'billing',
        applicationIssueId: 'issue:0001:02',
    });
    const repository = await createRepository(t);
    await writeConfig(repository.programDirectory, globalConfiguration);
    const configuration = {...applicationConfiguration, application: {...applicationConfiguration.application, modules: [{name: 'billing', path: 'modules/billing'}]}};
    await writeJsonRecord(repository.root, 'arw.config.json', configuration);
    await mkdir(join(repository.root, '.scratch', '0001-application-work', 'issues'), {recursive: true});
    await mkdir(join(repository.root, 'modules', 'billing', '.scratch', '0007-billing-work', 'issues'), {recursive: true});
    await runGit(join(repository.root, 'modules', 'billing'), ['init', '--quiet', '--initial-branch=dev']);
    const applicationPath = join(repository.root, '.scratch', '0001-application-work', 'issues', '02-source.md');
    const modulePath = join(repository.root, 'modules', 'billing', '.scratch', '0007-billing-work', 'issues', '07-build.md');
    await writeFile(applicationPath, '# Source\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- None\n', 'utf8');
    await writeFile(modulePath, '# Build\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- None\n', 'utf8');
    await runGit(repository.root, ['add', '.scratch/0001-application-work/issues/02-source.md']);
    await runGit(join(repository.root, 'modules', 'billing'), ['add', '.scratch/0007-billing-work/issues/07-build.md']);
    const unused = async () => assert.fail('Unused Git operation.');

    const result = await run(['application', 'associate', 'issue:0001:02', 'issue:billing:0007:07'], repository, {
        applicationJiraDependencies: {
            submoduleGit: {
                inspectConvergence: async () => ({diagnostics: [], state: {branch: 'dev', clean: true, head: 'aaa'}, status: 'succeeded'}),
                inspectSwitch: unused,
                restore: unused,
                switchBranch: unused,
            },
        },
    });
    assert.equal(result.result, 0);
    assert.match(await readFile(applicationPath, 'utf8'), /^Module implementation issue: `issue:billing:0007:07`$/mu);
    assert.match(await readFile(modulePath, 'utf8'), /^Application source issue: `issue:payments:0001:02`$/mu);
});

/** @param {import('node:test').TestContext} t */
const prepareMultiModuleAssociation = async t => {
    const repository = await createRepository(t);
    await writeConfig(repository.programDirectory, globalConfiguration);
    const configuration = {
        ...applicationConfiguration,
        application: {
            ...applicationConfiguration.application,
            modules: [
                {name: 'billing', path: 'modules/billing'},
                {name: 'ledger', path: 'modules/ledger'},
            ],
        },
    };
    await writeJsonRecord(repository.root, 'arw.config.json', configuration);
    for (const name of ['billing', 'ledger']) {
        const moduleRoot = join(repository.root, 'modules', name);
        await mkdir(join(moduleRoot, '.scratch'), {recursive: true});
        await runGit(moduleRoot, ['init', '--quiet', '--initial-branch=dev']);
        await writeFile(join(moduleRoot, '.scratch', '.keep'), '', 'utf8');
        await runGit(moduleRoot, ['add', '.scratch/.keep']);
        await runGit(moduleRoot, ['commit', '--quiet', '-m', 'fixture']);
    }
    const applicationEffort = join(repository.root, '.scratch', '0001-application-work', 'issues');
    const billingEffort = join(repository.root, 'modules', 'billing', '.scratch', '0007-billing-work', 'issues');
    const ledgerEffort = join(repository.root, 'modules', 'ledger', '.scratch', '0005-ledger-work', 'issues');
    await mkdir(applicationEffort, {recursive: true});
    await mkdir(billingEffort, {recursive: true});
    await mkdir(ledgerEffort, {recursive: true});
    const applicationTarget = join(applicationEffort, '02-source.md');
    const applicationLedger = join(applicationEffort, '01-ledger.md');
    const billingTarget = join(billingEffort, '07-build.md');
    const ledgerLater = join(ledgerEffort, '08-later.md');
    await writeFile(applicationTarget, '# Source\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- None\n', 'utf8');
    await writeFile(applicationLedger, '# Ledger\n\nStatus: ready-for-agent\nModule implementation issue: `issue:ledger:0005:05`\n\n## Blocked by\n\n- None\n', 'utf8');
    await writeFile(billingTarget, '# Build\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- None\n', 'utf8');
    await writeFile(ledgerLater, '# Later\n\nStatus: ready-for-agent\nApplication source issue: `issue:payments:0001:03`\n\n## Blocked by\n\n- External dependency: `issue:payments:0001:01` - Wait for base.\n', 'utf8');
    await runGit(repository.root, ['add', '.scratch/0001-application-work/issues/01-ledger.md', '.scratch/0001-application-work/issues/02-source.md']);
    await runGit(join(repository.root, 'modules', 'billing'), ['add', '.scratch/0007-billing-work/issues/07-build.md']);
    await runGit(join(repository.root, 'modules', 'ledger'), ['add', '.scratch/0005-ledger-work/issues/08-later.md']);
    const unused = async () => assert.fail('Unused Git operation.');
    const dependencies = {
        applicationJiraDependencies: {
            submoduleGit: {
                inspectConvergence: async () => ({diagnostics: [], state: {branch: 'dev', clean: true, head: 'aaa'}, status: /** @type {'succeeded'} */ ('succeeded')}),
                inspectSwitch: unused,
                restore: unused,
                switchBranch: unused,
            },
        },
    };

    return {billingTarget, dependencies, ledgerLater, applicationTarget, repository};
};

test('Application associate analyzes every configured Module and protects each affected effort baseline', async t => {
    const {dependencies, ledgerLater, applicationTarget, repository} = await prepareMultiModuleAssociation(t);
    await writeFile(ledgerLater, `${await readFile(ledgerLater, 'utf8')}\n`, 'utf8');

    const blocked = await run(['application', 'associate', 'issue:0001:02', 'issue:billing:0007:07'], repository, dependencies);
    assert.equal(blocked.result, 1);
    assert.ok(blocked.events.some(event => event.channel === 'stderr' && event.message.includes('.scratch/0005-ledger-work')));
    assert.doesNotMatch(await readFile(applicationTarget, 'utf8'), /Module implementation issue/u);

    await runGit(join(repository.root, 'modules', 'ledger'), ['restore', '.scratch/0005-ledger-work/issues/08-later.md']);
    const completed = await run(['application', 'associate', 'issue:0001:02', 'issue:billing:0007:07'], repository, dependencies);
    assert.equal(completed.result, 0, JSON.stringify(completed.events));
    assert.match(await readFile(ledgerLater, 'utf8'), /^- 05 - Wait for base\.$/mu);
});

test('Application associate reports recovery for the failed and previously written Repositories', async t => {
    const {billingTarget, dependencies, ledgerLater, applicationTarget, repository} = await prepareMultiModuleAssociation(t);
    let failedLedgerWrite = false;
    const failed = await run(['application', 'associate', 'issue:0001:02', 'issue:billing:0007:07'], repository, {
        applicationJiraDependencies: {
            ...dependencies.applicationJiraDependencies,
            openFilesystem: async input => {
                const opened = await createScopedFilesystem(input);
                if (opened.status !== 'succeeded' || input.root !== join(repository.root, 'modules', 'ledger')) return opened;
                const filesystem = opened.scopedFilesystem;
                return {
                    ...opened,
                    scopedFilesystem: {
                        ...filesystem,
                        write: async writeInput => {
                            const result = await filesystem.write(writeInput);
                            if (!failedLedgerWrite) {
                                failedLedgerWrite = true;
                                return {
                                    diagnostics: [{code: 'fixture-write-failed', message: 'Injected uncertain association write failure.'}],
                                    stage: 'write',
                                    status: /** @type {'failed'} */ ('failed'),
                                };
                            }
                            return result;
                        },
                    },
                };
            },
        },
    });
    assert.equal(failed.result, 1);
    assert.ok(failed.events.some(event => event.channel === 'stderr' && event.message.includes('repository=ledger') && event.message.includes('status=restored')));
    assert.ok(failed.events.some(event => event.channel === 'stderr' && event.message.includes('repository=billing') && event.message.includes('status=restored')));
    assert.doesNotMatch(await readFile(applicationTarget, 'utf8'), /Module implementation issue/u);
    assert.doesNotMatch(await readFile(billingTarget, 'utf8'), /Application source issue/u);
    assert.match(await readFile(ledgerLater, 'utf8'), /^- External dependency:/mu);
});

test('JIRA accept uses committed Application configuration and effort bytes while ignoring working-tree replacements', async t => {
    assert.deepEqual(parseCommand(['jira', 'accept', 'spec:0001']), {kind: 'jira-sync', phase: 'accepted', specId: 'spec:0001'});
    const repository = await createRepository(t);
    await writeConfig(repository.programDirectory, globalConfiguration);
    await writeJsonRecord(repository.root, 'arw.config.json', {configVersion: 2, application: {name: 'invalid working tree'}});
    const specText = '# Payment retry\n\nJIRA issue: [`PAY-17`](https://jira.example.test/team/browse/PAY-17)\n';
    const specObjectId = '0'.repeat(40);
    const exactComment = 'ARW synchronization\nPhase: accepted\nApplication: payments\nSpec: spec:0001\n\n此 JIRA issue 已被上述 application repository 接收.';
    let issueReads = 0;
    let commentReads = 0;
    /** @type {string[][]} */
    const gitCalls = [];
    const git = {
        run: async (/** @type {{argv: string[]}} */ input) => {
            gitCalls.push(input.argv);
            const joined = input.argv.join(' ');
            const stdout = joined === 'show HEAD:arw.config.json'
                ? `${JSON.stringify(applicationConfiguration)}\n`
                : joined.startsWith('ls-tree ')
                    ? `100644 blob ${specObjectId}\t.scratch/0001-payment-retry/spec.md\0`
                    : joined === 'cat-file --batch'
                        ? `${specObjectId} blob ${Buffer.byteLength(specText)}\n${specText}\n`
                        : joined.includes('@{upstream}')
                            ? 'origin/dev\n'
                            : joined.startsWith('rev-parse ')
                                ? 'effort-tree\n'
                                : '';
            return {code: 0, failure: null, stderr: '', stdout: Buffer.from(stdout, 'utf8')};
        },
    };
    const request = async (/** @type {JiraRequestInput} */ input) => {
        if (input.relativeEndpoint.endsWith('/comment') && input.method === 'GET') {
            commentReads += 1;
            return {diagnostics: /** @type {[]} */ ([]), status: /** @type {'succeeded'} */ ('succeeded'), value: {
                comments: commentReads === 1 ? [] : [{body: exactComment}],
                startAt: 0,
                total: commentReads === 1 ? 0 : 1,
            }};
        }
        if (input.relativeEndpoint.endsWith('/transitions') && input.method === 'GET') {
            return {diagnostics: /** @type {[]} */ ([]), status: /** @type {'succeeded'} */ ('succeeded'), value: {transitions: [{id: '31', to: {name: 'In Progress'}}]}};
        }
        if (input.relativeEndpoint === 'rest/api/2/issue/PAY-17' && input.method === 'GET') {
            issueReads += 1;
            return {diagnostics: /** @type {[]} */ ([]), status: /** @type {'succeeded'} */ ('succeeded'), value: {fields: {
                issuetype: {name: 'Story'},
                project: {key: 'PAY'},
                status: {name: issueReads === 1 ? 'Backlog' : 'In Progress'},
            }}};
        }
        return {diagnostics: /** @type {[]} */ ([]), status: /** @type {'succeeded'} */ ('succeeded'), value: null};
    };

    assert.deepEqual(await run(['jira', 'accept', 'spec:0001'], repository, {
        applicationJiraDependencies: {git, request},
    }), {
        events: [{channel: 'stdout', message: 'JIRA synchronization: issue=PAY-17 phase=accepted comment=created status=transitioned'}],
        result: 0,
    });
    assert.deepEqual(gitCalls[0], ['show', 'HEAD:arw.config.json']);
    assert.equal(issueReads, 2);
    assert.equal(commentReads, 2);
});

test('JIRA complete reads the complete committed effort and converges an existing final JIRA pair', async t => {
    assert.deepEqual(parseCommand(['jira', 'complete', 'spec:0001']), {kind: 'jira-sync', phase: 'completed', specId: 'spec:0001'});
    const repository = await createRepository(t);
    await writeConfig(repository.programDirectory, globalConfiguration);
    const specText = '# Payment retry\n\nJIRA issue: [`PAY-17`](https://jira.example.test/team/browse/PAY-17)\n\nApplication validation issue: 05\n';
    const issueText = '# Validate\n\nStatus: completed\n\n## Blocked by\n\n- None\n';
    const specObjectId = '0'.repeat(40);
    const issueObjectId = '1'.repeat(40);
    const exactComment = 'ARW synchronization\nPhase: completed\nApplication: payments\nSpec: spec:0001\n\n该本地 effort 已完成产品级验证.';
    const git = {run: async (/** @type {{argv: string[]}} */ input) => {
        const joined = input.argv.join(' ');
        const stdout = joined === 'show HEAD:arw.config.json'
            ? `${JSON.stringify(applicationConfiguration)}\n`
            : joined.startsWith('ls-tree ')
                ? `100644 blob ${specObjectId}\t.scratch/0001-payment-retry/spec.md\u0000100644 blob ${issueObjectId}\t.scratch/0001-payment-retry/issues/05-validate.md\0`
                    : joined === 'cat-file --batch'
                        ? `${specObjectId} blob ${Buffer.byteLength(specText)}\n${specText}\n${issueObjectId} blob ${Buffer.byteLength(issueText)}\n${issueText}\n`
                        : joined.includes('@{upstream}')
                            ? 'origin/dev\n'
                            : joined.startsWith('rev-parse ')
                                ? 'effort-tree\n'
                                : '';
        return {code: 0, failure: null, stderr: '', stdout: Buffer.from(stdout, 'utf8')};
    }};
    const request = async (/** @type {JiraRequestInput} */ input) => input.relativeEndpoint.endsWith('/comment')
        ? {diagnostics: /** @type {[]} */ ([]), status: /** @type {'succeeded'} */ ('succeeded'), value: {comments: [{body: exactComment}], startAt: 0, total: 1}}
        : {diagnostics: /** @type {[]} */ ([]), status: /** @type {'succeeded'} */ ('succeeded'), value: {fields: {
            issuetype: {name: 'Story'}, project: {key: 'PAY'}, status: {name: 'Done'},
        }}};

    assert.deepEqual(await run(['jira', 'complete', 'spec:0001'], repository, {applicationJiraDependencies: {git, request}}), {
        events: [{channel: 'stdout', message: 'JIRA synchronization: issue=PAY-17 phase=completed comment=existing status=existing'}],
        result: 0,
    });
});
