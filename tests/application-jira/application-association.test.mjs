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

test('Application Association edits only the Status line outside fenced code and keeps CRLF', () => {
    const record = {association: undefined, blockerRecords: [], id: 'issue:0007:07', kind: 'implementation', number: '07', status: 'ready-for-agent', title: 'Add idempotency'};
    const applicationRecord = {...record, id: 'issue:0001:02', number: '02'};
    const text = '# Add idempotency\r\n\r\nStatus: ready-for-agent\r\n\r\n```text\r\nStatus: ready-for-agent\r\n```\r\n\r\n## Blocked by\r\n\r\n- None\r\n';
    const result = associateApplicationIssue({
        moduleIssueId: record.id,
        moduleIssues: {billing: [{path: 'module.md', record, text}]},
        moduleName: 'billing',
        applicationIssueId: applicationRecord.id,
        applicationIssues: [{path: 'application.md', record: applicationRecord, text: '# Update API\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- None\n'}],
        applicationName: 'payments',
    });
    assert.equal(result.status, 'succeeded');
    assert.equal(
        result.replacements[0].bytes.toString(),
        '# Add idempotency\r\n\r\nStatus: ready-for-agent\r\nApplication source issue: `issue:payments:0001:02`\r\n\r\n```text\r\nStatus: ready-for-agent\r\n```\r\n\r\n## Blocked by\r\n\r\n- None - can start immediately\r\n',
    );
});

test('Application Association checks the Module effort only within the same Application effort', () => {
    const record = (/** @type {string} */ id) => ({blockerRecords: [], id, kind: 'implementation', status: 'ready-for-agent', title: 'T'});
    const associate = (/** @type {string} */ otherApplicationIssueId) => associateApplicationIssue({
        moduleIssueId: 'issue:0007:07',
        moduleIssues: {billing: [{path: 'module.md', record: record('issue:0007:07'), text: 'Status: ready-for-agent\n\n## Blocked by\n\n- None\n'}]},
        moduleName: 'billing',
        applicationIssueId: 'issue:0001:02',
        applicationIssues: [
            {path: 'application.md', record: record('issue:0001:02'), text: 'Status: ready-for-agent\n\n## Blocked by\n\n- None\n'},
            {path: 'other.md', record: {...record(otherApplicationIssueId), association: {coordinate: 'issue:billing:0009:01', kind: 'module-implementation'}}, text: ''},
        ],
        applicationName: 'payments',
    });
    assert.equal(associate('issue:0002:01').status, 'succeeded');
    assert.equal(associate('issue:0001:01').diagnostics[0]?.code, 'association-module-effort-mismatch');
});

test('Application Association rewrites External dependency lines only inside Blocked by', () => {
    const dependency = '- External dependency: `issue:payments:0001:01` - Wait.';
    const result = associateApplicationIssue({
        moduleIssueId: 'issue:0007:07',
        moduleIssues: {billing: [
            {path: 'target.md', record: {blockerRecords: [], id: 'issue:0007:07', kind: 'implementation', status: 'ready-for-agent'}, text: 'Status: ready-for-agent\n\n## Blocked by\n\n- None\n'},
            {path: 'earlier.md', record: {association: {coordinate: 'issue:payments:0001:03', kind: 'application-source'}, id: 'issue:0007:08', kind: 'implementation', status: 'ready-for-agent'}, text: `# E\n\n## What to build\n\n${dependency}\n\n## Blocked by\n\n${dependency}\n`},
        ]},
        moduleName: 'billing',
        applicationIssueId: 'issue:0001:01',
        applicationIssues: [{path: 'application.md', record: {blockerRecords: [], id: 'issue:0001:01', kind: 'implementation', status: 'ready-for-agent'}, text: 'Status: ready-for-agent\n\n## Blocked by\n\n- None\n'}],
        applicationName: 'payments',
    });
    assert.equal(result.status, 'succeeded');
    assert.equal(result.replacements[0].bytes.toString(), `# E\n\n## What to build\n\n${dependency}\n\n## Blocked by\n\n- 07 - Wait.\n`);
});

test('Application Association accepts non-canonical Status and Blocked by whitespace and keeps a bold Status line', () => {
    const record = {association: undefined, blockerRecords: [], id: 'issue:0007:07', kind: 'implementation', number: '07', status: 'ready-for-agent', title: 'Add idempotency'};
    const applicationRecord = {...record, id: 'issue:0001:02', number: '02'};
    const associate = (/** @type {string} */ moduleText) => associateApplicationIssue({
        moduleIssueId: record.id,
        moduleIssues: {billing: [{path: 'module.md', record, text: moduleText}]},
        moduleName: 'billing',
        applicationIssueId: applicationRecord.id,
        applicationIssues: [{path: 'application.md', record: applicationRecord, text: '# Update API\n\nStatus:ready-for-agent \n\n## Blocked by\n\n- None\n'}],
        applicationName: 'payments',
    });

    const spaced = associate('# Add idempotency\n\nStatus:  ready-for-agent \n\n## Blocked by  \n\n- None\n');
    assert.deepEqual(spaced.diagnostics, []);
    assert.equal(spaced.status, 'succeeded');
    assert.equal(
        spaced.replacements[0].bytes.toString(),
        '# Add idempotency\n\nStatus: ready-for-agent\nApplication source issue: `issue:payments:0001:02`\n\n## Blocked by  \n\n- None - can start immediately\n',
    );
    assert.equal(spaced.replacements[1].bytes.toString(), '# Update API\n\nStatus: ready-for-agent\nModule implementation issue: `issue:billing:0007:07`\n\n## Blocked by\n\n- None\n');

    const mixed = associate('# Add idempotency\n\nStatus: ready-for-agent\n**Status:** ready-for-agent\n\n## Blocked by\n\n- None\n');
    assert.equal(mixed.status, 'succeeded');
    assert.equal(mixed.replacements[0].bytes.toString().includes('**Status:** ready-for-agent\n\n## Blocked by'), true);
});

test('Application Association blocks text containing a lone CR instead of misplacing the Status rewrite', () => {
    const record = {association: undefined, blockerRecords: [], id: 'issue:0007:07', kind: 'implementation', number: '07', status: 'ready-for-agent', title: 'Add idempotency'};
    const applicationRecord = {...record, id: 'issue:0001:02', number: '02'};
    const result = associateApplicationIssue({
        moduleIssueId: record.id,
        moduleIssues: {billing: [{path: 'module.md', record, text: '# T\rStatus: ready-for-agent\n## Blocked by\n\n- None\n'}]},
        moduleName: 'billing',
        applicationIssueId: applicationRecord.id,
        applicationIssues: [{path: 'application.md', record: applicationRecord, text: '# Update API\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- None\n'}],
        applicationName: 'payments',
    });
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), ['association-document-invalid']);
});
