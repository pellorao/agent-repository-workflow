import assert from 'node:assert/strict';
import test from 'node:test';

import {checkModuleCorrection} from '../../lib/application-jira/module-correction-check.mjs';

const issueText = ({acceptance = '- [ ] Pass.', association = 'issue:payments:0001:01', downstream = '- Existing.', what = 'Build it.'} = {}) => [
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
    'Not required',
    '',
    '## Acceptance criteria',
    '',
    acceptance,
    '',
    '## Validation',
    '',
    '- Not run.',
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

const record = (association = 'issue:payments:0001:01') => ({
    association: {coordinate: association, kind: 'application-source'},
    id: 'issue:0007:01',
    kind: 'implementation',
    status: 'ready-for-agent',
});

test('Module Correction Check enforces hard locks, effective soft locks, and current downstream state', () => {
    const headIssue = {path: 'issue.md', record: record(), text: issueText()};
    const checkboxOnly = checkModuleCorrection({
        headIssue,
        workingIssue: {
            path: 'issue.md',
            record: record(),
            text: issueText({acceptance: '- [x] Pass.', downstream: '- Recorded checkbox completion.'}),
        },
    });
    assert.deepEqual(checkboxOnly.diagnostics.map(diagnostic => diagnostic.code), ['module-correction-soft-lock-unchanged']);

    const hardLock = checkModuleCorrection({
        headIssue,
        workingIssue: {
            path: 'issue.md',
            record: record('issue:payments:0001:02'),
            text: issueText({association: 'issue:payments:0001:02', downstream: '- Changed association.', what: 'Corrected.'}),
        },
    });
    assert.deepEqual(hardLock.diagnostics.map(diagnostic => diagnostic.code), ['module-correction-association-changed']);

    const reformattedHardLock = checkModuleCorrection({
        headIssue,
        workingIssue: {
            path: 'issue.md',
            record: record(),
            text: issueText({downstream: '- Reformatted association.', what: 'Corrected.'})
                .replace('Application source issue:', 'Application source issue: '),
        },
    });
    assert.deepEqual(reformattedHardLock.diagnostics.map(diagnostic => diagnostic.code), ['module-correction-association-changed']);

    const fencedAssociationExample = checkModuleCorrection({
        headIssue: {
            ...headIssue,
            text: headIssue.text.replace('- Not run.', '- Not run.\n\n```text\nApplication source issue: `issue:example:0001:01`\n```'),
        },
        workingIssue: {
            path: 'issue.md',
            record: record(),
            text: issueText({downstream: '- Corrected while updating an example.', what: 'Corrected.'})
                .replace('- Not run.', '- Not run.\n\n```text\nApplication source issue: `issue:example:0001:02`\n```'),
        },
    });
    assert.deepEqual(fencedAssociationExample, {diagnostics: [], status: 'succeeded'});

    const missingRecord = checkModuleCorrection({
        headIssue,
        workingIssue: {
            path: 'issue.md',
            record: record(),
            text: issueText({downstream: '- None.', what: 'Corrected.'}),
        },
    });
    assert.deepEqual(missingRecord.diagnostics.map(diagnostic => diagnostic.code), ['module-correction-downstream-empty']);

    const unchangedRecord = checkModuleCorrection({
        headIssue,
        workingIssue: {
            path: 'issue.md',
            record: record(),
            text: issueText({what: 'Corrected.'}),
        },
    });
    assert.deepEqual(unchangedRecord.diagnostics.map(diagnostic => diagnostic.code), ['module-correction-downstream-unchanged']);

    assert.deepEqual(checkModuleCorrection({
        headIssue,
        spec: {headText: '# Old\n', path: '.scratch/0007-work/spec.md', workingText: '# New\n'},
        workingIssue: {
            path: 'issue.md',
            record: record(),
            text: issueText({downstream: '- Corrected the effort spec.'}),
        },
    }), {diagnostics: [], status: 'succeeded'});
});
