import assert from 'node:assert/strict';
import test from 'node:test';

import {synchronizeApplicationIssues} from '../../lib/application-jira/application-sync.mjs';

test('Application Sync mirrors every associated Module status without copying evidence', () => {
    const result = synchronizeApplicationIssues({
        moduleIssues: {
            billing: [{
                path: '.scratch/0007-billing-work/issues/07-add-idempotency.md',
                record: {
                    association: {coordinate: 'issue:payments:0001:02', kind: 'application-source'},
                    id: 'issue:0007:07',
                    kind: 'implementation',
                    status: 'completed',
                },
                text: '# Add idempotency\n\nStatus: completed\nApplication source issue: `issue:payments:0001:02`\n\n## Validation\n\n- Module evidence only.\n\n## Comments\n\n### Downstream changes\n\n- Corrected the retry timeout.\n',
            }],
        },
        applicationIssues: [{
            path: '.scratch/0001-payment-retry/issues/02-update-api.md',
            record: {
                association: {coordinate: 'issue:billing:0007:07', kind: 'module-implementation'},
                id: 'issue:0001:02',
                kind: 'application-source',
                status: 'ready-for-agent',
            },
            text: '# Update API\r\n\r\nStatus: ready-for-agent\r\nModule implementation issue: `issue:billing:0007:07`\r\n\r\n## Validation\r\n\r\n- Application text stays.\r\n\r\n## Comments\r\n\r\n- Application comment stays.\r\n\r\n### Downstream changes\r\n\r\n- Old downstream item.\r\n',
        }],
        applicationName: 'payments',
    });

    assert.deepEqual(result, {
        diagnostics: [],
        replacements: [{
            bytes: Buffer.from('# Update API\r\n\r\nStatus: completed\r\nModule implementation issue: `issue:billing:0007:07`\r\n\r\n## Validation\r\n\r\n- Application text stays.\r\n\r\n## Comments\r\n\r\n- Application comment stays.\r\n\r\n### Downstream changes\n\n- Corrected the retry timeout.\n'),
            path: '.scratch/0001-payment-retry/issues/02-update-api.md',
        }],
        status: 'succeeded',
    });
});

test('Application Sync blocks the complete replacement set on a reverse association mismatch', () => {
    const result = synchronizeApplicationIssues({
        moduleIssues: {
            billing: [{
                path: 'module.md',
                record: {
                    association: {coordinate: 'issue:payments:0002:01', kind: 'application-source'},
                    id: 'issue:0007:07',
                    kind: 'implementation',
                    status: 'completed',
                },
                text: 'Status: completed\n',
            }],
        },
        applicationIssues: [{
            path: 'application.md',
            record: {
                association: {coordinate: 'issue:billing:0007:07', kind: 'module-implementation'},
                id: 'issue:0001:02',
                kind: 'application-source',
                status: 'ready-for-agent',
            },
            text: 'Status: ready-for-agent\n',
        }],
        applicationName: 'payments',
    });

    assert.equal(result.status, 'blocked');
    assert.equal('replacements' in result, false);
    assert.equal(result.diagnostics[0].code, 'application-association-mismatch');

    const blockedModule = synchronizeApplicationIssues({
        applicationIssues: [{
            path: 'application.md',
            record: {
                association: {coordinate: 'issue:billing:0007:07', kind: 'module-implementation'},
                id: 'issue:0001:02',
                kind: 'application-source',
                status: 'ready-for-agent',
            },
            text: 'Status: ready-for-agent\n',
        }],
        applicationName: 'payments',
        moduleIssues: {
            billing: [{
                path: 'module.md',
                record: {
                    association: {coordinate: 'issue:payments:0001:02', kind: 'application-source'},
                    blockerRecords: [{status: 'ready-for-agent'}],
                    id: 'issue:0007:07',
                    kind: 'implementation',
                    status: 'completed',
                },
                text: 'Status: completed\n',
            }],
        },
    });
    assert.deepEqual(blockedModule, {
        diagnostics: [{code: 'application-module-blocked', message: 'Module issue billing:issue:0007:07 has a nonterminal blocker.', path: 'module.md'}],
        status: 'blocked',
    });
});

test('Application Sync replaces the complete current list and writes None for an empty Module source', () => {
    const result = synchronizeApplicationIssues({
        applicationIssues: [{
            path: 'application-a.md',
            record: {
                association: {coordinate: 'issue:billing:0007:07', kind: 'module-implementation'},
                id: 'issue:0001:01',
                kind: 'application-source',
                status: 'completed',
            },
            text: '# A\n\nStatus: completed\nModule implementation issue: `issue:billing:0007:07`\n\n## Comments\n\n- Local.\n\n### Downstream changes\n\n- Old.\n',
        }, {
            path: 'application-b.md',
            record: {
                association: {coordinate: 'issue:billing:0007:08', kind: 'module-implementation'},
                id: 'issue:0001:02',
                kind: 'application-source',
                status: 'completed',
            },
            text: '# B\n\nStatus: completed\nModule implementation issue: `issue:billing:0007:08`\n',
        }],
        applicationName: 'payments',
        moduleIssues: {
            billing: [{
                path: 'module-a.md',
                record: {
                    association: {coordinate: 'issue:payments:0001:01', kind: 'application-source'},
                    id: 'issue:0007:07',
                    kind: 'implementation',
                    status: 'completed',
                },
                text: '# A\n\nStatus: completed\nApplication source issue: `issue:payments:0001:01`\n',
            }, {
                path: 'module-b.md',
                record: {
                    association: {coordinate: 'issue:payments:0001:02', kind: 'application-source'},
                    id: 'issue:0007:08',
                    kind: 'implementation',
                    status: 'completed',
                },
                text: '# B\n\nStatus: completed\nApplication source issue: `issue:payments:0001:02`\n\n## Comments\n\n### Downstream changes\n\n- Current.\n  Continued.\n',
            }],
        },
    });

    assert.deepEqual(result, {
        diagnostics: [],
        replacements: [{
            bytes: Buffer.from('# A\n\nStatus: completed\nModule implementation issue: `issue:billing:0007:07`\n\n## Comments\n\n- Local.\n\n### Downstream changes\n\n- None.\n'),
            path: 'application-a.md',
        }, {
            bytes: Buffer.from('# B\n\nStatus: completed\nModule implementation issue: `issue:billing:0007:08`\n\n## Comments\n\n### Downstream changes\n\n- Current.\n  Continued.\n'),
            path: 'application-b.md',
        }],
        status: 'succeeded',
    });
});

test('Application Sync aggregates unsafe Downstream changes and returns zero replacements', () => {
    const result = synchronizeApplicationIssues({
        applicationIssues: [{
            path: 'application.md',
            record: {
                association: {coordinate: 'issue:billing:0007:07', kind: 'module-implementation'},
                id: 'issue:0001:01',
                kind: 'application-source',
                status: 'ready-for-agent',
            },
            text: '# A\n\nStatus: ready-for-agent\nModule implementation issue: `issue:billing:0007:07`\n\n## Comments\n\n### Downstream changes\n\n- Old.\nordinary text\n',
        }],
        applicationName: 'payments',
        moduleIssues: {
            billing: [{
                path: 'module.md',
                record: {
                    association: {coordinate: 'issue:payments:0001:01', kind: 'application-source'},
                    id: 'issue:0007:07',
                    kind: 'implementation',
                    status: 'completed',
                },
                text: '# A\n\nStatus: completed\nApplication source issue: `issue:payments:0001:01`\n\n## Comments\n\n### Downstream changes\n\n- New.\nordinary text\n',
            }],
        },
    });

    assert.equal(result.status, 'blocked');
    assert.equal('replacements' in result, false);
    assert.deepEqual(result.diagnostics.map(diagnostic => [diagnostic.path, diagnostic.code]), [
        ['application.md', 'downstream-changes-content-invalid'],
        ['module.md', 'downstream-changes-content-invalid'],
    ]);
});
