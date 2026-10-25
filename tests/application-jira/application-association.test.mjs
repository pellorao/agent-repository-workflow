import assert from 'node:assert/strict';
import test from 'node:test';

import {associateApplicationIssue} from '../../lib/application-jira/application-association.mjs';

test('Application Association creates distinct bidirectional fields and projects external blockers', () => {
    const blocker = {association: undefined, id: 'issue:0001:01', kind: 'implementation', number: '01', status: 'ready-for-agent', title: 'Finish design'};
    const applicationRecord = {
        association: undefined,
        blockerRecords: [blocker],
        id: 'issue:0001:02',
        kind: 'implementation',
        number: '02',
        status: 'ready-for-agent',
        title: 'Update API',
    };
    const moduleRecord = {
        association: undefined,
        blockerRecords: [],
        id: 'issue:0007:07',
        kind: 'implementation',
        number: '07',
        status: 'ready-for-agent',
        title: 'Add idempotency',
    };

    assert.deepEqual(associateApplicationIssue({
        moduleIssueId: moduleRecord.id,
        moduleIssues: {billing: [{path: '.scratch/0007-billing-retry/issues/07-add-idempotency.md', record: moduleRecord, text: '# Add idempotency\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- None\n'}]},
        moduleName: 'billing',
        applicationIssueId: applicationRecord.id,
        applicationIssues: [{path: '.scratch/0001-payment-retry/issues/02-update-api.md', record: applicationRecord, text: '# Update API\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- 01 - Finish design\n'}],
        applicationName: 'payments',
    }), {
        diagnostics: [],
        replacements: [
            {
                bytes: Buffer.from('# Add idempotency\n\nStatus: ready-for-agent\nApplication source issue: `issue:payments:0001:02`\n\n## Blocked by\n\n- External dependency: `issue:payments:0001:01` - Finish design\n'),
                path: '.scratch/0007-billing-retry/issues/07-add-idempotency.md',
                repository: 'billing',
            },
            {
                bytes: Buffer.from('# Update API\n\nStatus: ready-for-agent\nModule implementation issue: `issue:billing:0007:07`\n\n## Blocked by\n\n- 01 - Finish design\n'),
                path: '.scratch/0001-payment-retry/issues/02-update-api.md',
                repository: 'application',
            },
        ],
        status: 'succeeded',
    });
});

test('Application Association blocks terminal or mismatched statuses without replacements', () => {
    const result = associateApplicationIssue({
        moduleIssueId: 'issue:0002:01',
        moduleIssues: {module: [{path: 'module.md', record: {blockerRecords: [], id: 'issue:0002:01', kind: 'implementation', number: '01', status: 'completed', title: 'Build'}, text: 'Status: completed\n'}]},
        moduleName: 'module',
        applicationIssueId: 'issue:0001:01',
        applicationIssues: [{path: 'application.md', record: {blockerRecords: [], id: 'issue:0001:01', kind: 'implementation', number: '01', status: 'ready-for-agent', title: 'Build'}, text: 'Status: ready-for-agent\n'}],
        applicationName: 'application',
    });
    assert.equal(result.status, 'blocked');
    assert.equal('replacements' in result, false);
});

test('Application Association normalizes still-uncommitted same-Module dependencies and preserves frozen issues', () => {
    const applicationRecord = {blockerRecords: [], id: 'issue:0001:02', kind: 'implementation', number: '02', status: 'ready-for-agent', title: 'Update API'};
    const moduleRecord = {blockerRecords: [], id: 'issue:0007:07', kind: 'implementation', number: '07', status: 'ready-for-agent', title: 'Add idempotency'};
    const earlierText = '# Earlier\n\nStatus: ready-for-agent\nApplication source issue: `issue:payments:0001:03`\n\n## Blocked by\n\n- External dependency: `issue:payments:0001:02` - Wait for the API.\n';
    const result = associateApplicationIssue({
        frozenModulePaths: {billing: ['frozen.md']},
        moduleIssueId: moduleRecord.id,
        moduleIssues: {billing: [
            {path: 'target.md', record: moduleRecord, text: '# Target\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- None\n'},
            {path: 'earlier.md', record: {association: {coordinate: 'issue:payments:0001:03', kind: 'application-source'}, id: 'issue:0007:08', kind: 'implementation', status: 'ready-for-agent'}, text: earlierText},
            {path: 'frozen.md', record: {association: {coordinate: 'issue:payments:0001:04', kind: 'application-source'}, id: 'issue:0007:09', kind: 'implementation', status: 'ready-for-agent'}, text: earlierText},
        ]},
        moduleName: 'billing',
        applicationIssueId: applicationRecord.id,
        applicationIssues: [{path: 'application.md', record: applicationRecord, text: '# Application\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- None\n'}],
        applicationName: 'payments',
    });
    assert.equal(result.status, 'succeeded');
    if (result.status !== 'succeeded') assert.fail('Association must succeed.');
    assert.deepEqual(result.replacements.map(replacement => replacement.path), ['earlier.md', 'target.md', 'application.md']);
    assert.match(result.replacements[0].bytes.toString('utf8'), /^- 07 - Wait for the API\.$/mu);
});

test('Application Association inspects every configured Module and normalizes only matching Repository efforts', () => {
    const applicationRecord = {blockerRecords: [], id: 'issue:0001:02', kind: 'implementation', number: '02', status: 'ready-for-agent', title: 'Source'};
    const billingRecord = {blockerRecords: [], id: 'issue:0007:07', kind: 'implementation', number: '07', status: 'ready-for-agent', title: 'Build'};
    const dependency = '- External dependency: `issue:payments:0001:01` - Wait for the ledger base.\n';
    const result = associateApplicationIssue({
        moduleIssueId: billingRecord.id,
        moduleIssues: {
            billing: [{path: 'billing-target.md', record: billingRecord, text: '# Build\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- None\n'}],
            ledger: [
                {path: 'ledger-same.md', record: {association: {coordinate: 'issue:payments:0001:03', kind: 'application-source'}, id: 'issue:0005:08', kind: 'implementation', status: 'ready-for-agent'}, text: `# Ledger\n\nStatus: ready-for-agent\nApplication source issue: \`issue:payments:0001:03\`\n\n## Blocked by\n\n${dependency}`},
                {path: 'ledger-other.md', record: {association: {coordinate: 'issue:payments:0001:04', kind: 'application-source'}, id: 'issue:0009:09', kind: 'implementation', status: 'ready-for-agent'}, text: `# Other\n\nStatus: ready-for-agent\nApplication source issue: \`issue:payments:0001:04\`\n\n## Blocked by\n\n${dependency}`},
            ],
        },
        moduleName: 'billing',
        applicationIssueId: applicationRecord.id,
        applicationIssues: [
            {path: 'application.md', record: applicationRecord, text: '# Source\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- None\n'},
            {path: 'ledger-application.md', record: {association: {coordinate: 'issue:ledger:0005:05', kind: 'module-implementation'}, id: 'issue:0001:01', kind: 'implementation', status: 'ready-for-agent'}, text: ''},
        ],
        applicationName: 'payments',
    });
    assert.equal(result.status, 'succeeded');
    if (result.status !== 'succeeded') assert.fail('Association must succeed.');
    assert.deepEqual(result.replacements.map(replacement => `${replacement.repository}:${replacement.path}`), [
        'ledger:ledger-same.md',
        'billing:billing-target.md',
        'application:application.md',
    ]);
    assert.match(result.replacements[0].bytes.toString('utf8'), /^- 05 - Wait for the ledger base\.$/mu);
});
