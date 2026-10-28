import assert from 'node:assert/strict';
import test from 'node:test';

import {
    hasLegacyIssueShape,
    isIssueBlocked,
    isIssueExecutable,
    migrateIssueDocuments,
    readDownstreamChanges,
    readIssueRequirement,
    readIssueDocuments as readIssueDocumentsImplementation,
    replaceDownstreamChanges,
} from '../../lib/arw-common/issue-documents.mjs';

/** @param {Parameters<typeof readIssueDocumentsImplementation>[0]} documents */
const readIssueDocuments = documents => readIssueDocumentsImplementation(documents.map(document => ({
    ...document,
    effort: /^(?!0000)\d{4}-/.test(document.effort) ? document.effort : `0001-${document.effort}`,
})));

test('Downstream Changes Document reads and replaces the final Comments subsection', () => {
    const text = '# Work\n\nStatus: completed\n\n## Comments\n\n- Ordinary comment.\n\n### Downstream changes\n\n- Corrected the timeout.\n  - Preserved retry behavior.\n';

    assert.deepEqual(readDownstreamChanges({path: 'issue.md', text}), {
        diagnostics: [],
        status: 'succeeded',
        value: {
            content: '- Corrected the timeout.\n  - Preserved retry behavior.',
            hasItems: true,
            present: true,
        },
    });
    assert.deepEqual(replaceDownstreamChanges({content: '- Replaced the correction.', path: 'issue.md', text}), {
        diagnostics: [],
        status: 'succeeded',
        text: '# Work\n\nStatus: completed\n\n## Comments\n\n- Ordinary comment.\n\n### Downstream changes\n\n- Replaced the correction.\n',
    });

    const preservedPrefix = '# Work\r\n\r\nStatus: completed\r\n\r\n## Comments\r\n\r\n- Ordinary comment.\r\n\r\n';
    assert.deepEqual(replaceDownstreamChanges({
        content: '- Replaced the correction.',
        path: 'issue.md',
        text: `${preservedPrefix}### Downstream changes\r\n\r\n- Old.\r\n`,
    }), {
        diagnostics: [],
        status: 'succeeded',
        text: `${preservedPrefix}### Downstream changes\n\n- Replaced the correction.\n`,
    });
});

test('Downstream Changes Document closes unsafe boundaries and normalizes empty sources', () => {
    assert.deepEqual(readDownstreamChanges({path: 'missing.md', text: '# Work\n\nStatus: completed\n'}), {
        diagnostics: [],
        status: 'succeeded',
        value: {content: '', hasItems: false, present: false},
    });
    const empty = readDownstreamChanges({
        path: 'none.md',
        text: '# Work\r\n\r\n## Comments\r\n\r\n### Downstream changes\r\n\r\n- None.\r\n',
    });
    assert.equal(empty.status, 'succeeded');
    if (empty.status !== 'succeeded') assert.fail('Expected Downstream changes to parse.');
    assert.deepEqual(empty.value, {content: '- None.', hasItems: false, present: true});
    const spacedEmpty = readDownstreamChanges({
        path: 'spaced-none.md',
        text: '# Work\n\n## Comments\n\n### Downstream changes\n\n-   None.   \n',
    });
    assert.equal(spacedEmpty.status, 'succeeded');
    if (spacedEmpty.status !== 'succeeded') assert.fail('Expected a whitespace-normalized sentinel to parse.');
    assert.deepEqual(spacedEmpty.value, {content: '- None.', hasItems: false, present: true});

    const invalid = [
        ['downstream-comments-duplicate', '# Work\n\n## Comments\n\n## Comments\n'],
        ['downstream-changes-duplicate', '# Work\n\n## Comments\n\n### Downstream changes\n\n- One.\n\n### Downstream changes\n\n- Two.\n'],
        ['downstream-changes-position-invalid', '# Work\n\n### Downstream changes\n\n- One.\n\n## Comments\n'],
        ['downstream-changes-position-invalid', '# Work\n\n## Comments\n\n# Detached\n\n### Downstream changes\n\n- One.\n'],
        ['downstream-changes-position-invalid', '# Work\n\n## Comments\n\n#### Detached\n\n### Downstream changes\n\n- One.\n'],
        ['downstream-changes-position-invalid', '# Work\n\n## Comments\n\n### Downstream changes\n\n- One.\n\n### Later\n'],
        ['downstream-changes-position-invalid', '# Work\n\n## Comments\n\n### Downstream changes\n\n- One.\n\n## Later\n'],
        ['downstream-changes-position-invalid', '# Work\n\n## Comments\n\n```text\n### Downstream changes\n\n- Literal.\n'],
        ['downstream-changes-content-invalid', '# Work\n\n## Comments\n\n### Downstream changes\n\n- None.\n- One.\n'],
        ['downstream-changes-content-invalid', '# Work\n\n## Comments\n\n### Downstream changes\n\n- None.   \n- One.\n'],
        ['downstream-changes-content-invalid', '# Work\n\n## Comments\n\n### Downstream changes\n\n-   None.\n- One.\n'],
        ['downstream-changes-content-invalid', '# Work\n\n## Comments\n\n### Downstream changes\n\n- One.\nunindented continuation\n'],
        ['downstream-changes-content-invalid', '# Work\n\n## Comments\n\n### Downstream changes\n\n* Other marker.\n'],
    ];
    for (const [code, text] of invalid) {
        const result = readDownstreamChanges({path: 'invalid.md', text});
        assert.equal(result.status, 'blocked');
        assert.equal(result.diagnostics[0].code, code);
    }

    const appended = replaceDownstreamChanges({
        content: '- None.',
        path: 'append.md',
        text: '# Work\n\nStatus: completed\n',
    });
    assert.equal(appended.status, 'succeeded');
    if (appended.status !== 'succeeded') assert.fail('Expected replacement to succeed.');
    assert.equal(appended.text, '# Work\n\nStatus: completed\n\n## Comments\n\n### Downstream changes\n\n- None.\n');
});

test('Application Source Issue association is a distinct non-executable issue type', () => {
    const result = readIssueDocuments([{
        effort: 'payments',
        number: '02',
        sourceKey: 'application-source',
        text: [
            '# Update API',
            '',
            'Status: ready-for-agent',
            'Module implementation issue: `issue:billing:0013:07`',
            '',
            '## Blocked by',
            '',
            '- External dependency: `issue:ledger:0009:03` - Wait for the ledger contract.',
            '',
        ].join('\n'),
    }]);

    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.records[0].kind, 'application-source');
    assert.equal(isIssueExecutable(result.records[0]), false);
    assert.deepEqual(result.records[0].association, {
        kind: 'module-implementation',
        coordinate: 'issue:billing:0013:07',
    });
    assert.deepEqual(result.records[0].blockers, []);
});

test('Application association fields fail closed when misplaced or combined', () => {
    for (const text of [
        '# Bad\n\nStatus: ready-for-agent\n\nModule implementation issue: `billing:work:01-build`\n\n## Blocked by\n\n- None\n',
        '# Bad\n\nStatus: ready-for-agent\nModule implementation issue: `billing:work:01-build`\nApplication source issue: `payments:work:01-build`\n\n## Blocked by\n\n- None\n',
    ]) {
        const result = readIssueDocuments([{effort: 'work', number: '01', sourceKey: 'bad', text}]);
        assert.equal(result.records.length, 0);
        assert.equal(result.diagnostics.length, 1);
    }
});

test('requirement read returns normalized Repository-root-relative references', () => {
    const text = '# Implement\n\nStatus: ready-for-agent\n\n## What to build\n\nImplement.\n\n## Spec Requirement\n\nGoverning requirements:\n\n- `.scratch/0001-workflow/spec.md#module-design`\n- `docs/agents/validation.md`\n\n## Acceptance criteria\n\n- [ ] Complete.\n\n## Validation\n\n- Not run.\n\n## Blocked by\n\n- None\n\n## Comments\n\n- No comments.\n';

    assert.deepEqual(readIssueRequirement({
        issuePath: '.scratch/0001-workflow/issues/01-implement.md',
        text,
    }), {
        kind: 'normal',
        requirements: [
            {anchor: 'module-design', filePath: '.scratch/0001-workflow/spec.md'},
            {anchor: null, filePath: 'docs/agents/validation.md'},
        ],
        subjectContent: '## What to build\n\nImplement.\n\n## Spec Requirement\n\nGoverning requirements:\n\n- `.scratch/0001-workflow/spec.md#module-design`\n- `docs/agents/validation.md`\n\n## Acceptance criteria\n\n- [ ] Complete.\n\n',
        subjectIdentityContent: '## What to build\n\nImplement.\n\n## Spec Requirement\n\nGoverning requirements:\n\n- `.scratch/0001-workflow/spec.md#module-design`\n- `docs/agents/validation.md`\n\n## Acceptance criteria\n\n- [ ] Complete.\n\n',
    });
});

test('requirement read normalizes only acceptance task-list completion markers for identity', () => {
    const text = [
        '# Implement',
        '',
        'Status: ready-for-agent',
        '',
        '## What to build',
        '',
        'Keep [x] in ordinary requirement text.',
        '',
        '## Spec Requirement',
        '',
        'Not required',
        '',
        '## Acceptance criteria',
        '',
        '- [ ] Unchecked.',
        ' + [x] Checked with one-space indentation.',
        '   * [X] Checked with three-space indentation.',
        '',
        'Ordinary [x] text.',
        '- Keep [X] after the item start.',
        '- [x]No separating whitespace.',
        '    - [x] Four-space code indentation.',
        '1. [x] Ordered list.',
        '`- [x] Inline code.`',
        '',
        '```md',
        '- [x] Fenced example.',
        '```',
        '',
        '## Validation',
        '',
        '- Not run.',
        '',
    ].join('\r\n');
    const result = readIssueRequirement({
        issuePath: '.scratch/0001-workflow/issues/01-implement.md',
        text,
    });

    assert.equal(result.subjectContent, [
        '## What to build',
        '',
        'Keep [x] in ordinary requirement text.',
        '',
        '## Spec Requirement',
        '',
        'Not required',
        '',
        '## Acceptance criteria',
        '',
        '- [ ] Unchecked.',
        ' + [x] Checked with one-space indentation.',
        '   * [X] Checked with three-space indentation.',
        '',
        'Ordinary [x] text.',
        '- Keep [X] after the item start.',
        '- [x]No separating whitespace.',
        '    - [x] Four-space code indentation.',
        '1. [x] Ordered list.',
        '`- [x] Inline code.`',
        '',
        '```md',
        '- [x] Fenced example.',
        '```',
        '',
        '',
    ].join('\n'));
    assert.equal(result.subjectIdentityContent, [
        '## What to build',
        '',
        'Keep [x] in ordinary requirement text.',
        '',
        '## Spec Requirement',
        '',
        'Not required',
        '',
        '## Acceptance criteria',
        '',
        '- [ ] Unchecked.',
        ' + [ ] Checked with one-space indentation.',
        '   * [ ] Checked with three-space indentation.',
        '',
        'Ordinary [x] text.',
        '- Keep [X] after the item start.',
        '- [x]No separating whitespace.',
        '    - [x] Four-space code indentation.',
        '1. [x] Ordered list.',
        '`- [x] Inline code.`',
        '',
        '```md',
        '- [x] Fenced example.',
        '```',
        '',
        '',
    ].join('\n'));
});

test('requirement read keeps fenced level-two headings inside the subject content', () => {
    const subjectContent = [
        '## What to build',
        '',
        'Implement.',
        '',
        '## Spec Requirement',
        '',
        'Not required',
        '',
        '## Acceptance criteria',
        '',
        '- [ ] Complete.',
        '',
        '```md',
        '## Validation',
        '',
        '- Example only.',
        '```',
        '',
        '- [ ] Preserve content after the example.',
        '',
        '',
    ].join('\n');
    const text = `# Implement\n\nStatus: ready-for-agent\n\n${subjectContent}## Validation\n\n- Not run.\n`;

    assert.equal(readIssueRequirement({
        issuePath: '.scratch/0001-workflow/issues/01-implement.md',
        text,
    }).subjectContent, subjectContent);
});

test('requirement read rejects issue-directory-relative and unsafe paths', () => {
    for (const filePath of [
        '../spec.md',
        './docs/spec.md',
        '/docs/spec.md',
        'C:/docs/spec.md',
        'docs\\spec.md',
        'docs//spec.md',
        'docs/../spec.md',
        'docs/\0spec.md',
    ]) {
        const text = `# Implement\n\nStatus: ready-for-agent\n\n## What to build\n\nImplement.\n\n## Spec Requirement\n\nGoverning requirements:\n\n- \`${filePath}#module-design\`\n\n## Acceptance criteria\n\n- [ ] Complete.\n`;

        assert.throws(
            () => readIssueRequirement({issuePath: '.scratch/0001-workflow/issues/01-implement.md', text}),
            /must be a normalized Repository-relative path/,
        );
    }

    const invalidAnchor = '# Implement\n\nStatus: ready-for-agent\n\n## What to build\n\nImplement.\n\n## Spec Requirement\n\nGoverning requirements:\n\n- `docs/spec.md#Invalid_Anchor`\n\n## Acceptance criteria\n\n- [ ] Complete.\n';
    assert.throws(
        () => readIssueRequirement({issuePath: '.scratch/0001-workflow/issues/01-implement.md', text: invalidAnchor}),
        /malformed governing requirement reference/,
    );
});

test('migration renders canonical documents that round-trip through strict read', () => {
    const documents = [
        {
            effort: 'migration',
            number: '01',
            sourceKey: 'target',
            text: '# Target\n\nStatus: completed\n\n## Blocked by\n\n- None — can start immediately\n',
        },
        {
            effort: 'migration',
            number: '02',
            sourceKey: 'implementation',
            text: [
                '---',
                'owner: test',
                '---',
                'Move after heading.',
                '# Implementation',
                '',
                '**Status:** ready-for-agent',
                '',
                '## What to build',
                '',
                'Keep body.',
                '',
                '```md',
                'Status: completed',
                '## Blocked by',
                '```',
                '',
                '## Acceptance criteria',
                '',
                '- [ ] Keep checklist.',
                '',
                '## Blocked by',
                '',
                'issues/01-target.md',
                '',
                '## Validation',
                '',
                '- [ ] Keep validation.',
                '',
            ].join('\n'),
        },
        {
            effort: 'migration',
            number: '03',
            sourceKey: 'wayfinder',
            text: '# Decision\n\n**Type:** task\n\n## Blocked by\n\n- 02 — Ignore title\n- 01\n\n## Question\n\nKeep question.\n',
        },
    ];
    const result = migrateIssueDocuments(documents);
    const texts = Object.fromEntries(result.outputs.map(output => [output.sourceKey, output.text]));

    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.outputs.map(output => [output.sourceKey, output.changed]), [
        ['target', true],
        ['implementation', true],
        ['wayfinder', true],
    ]);
    assert.equal(texts.target, '# Target\n\nStatus: completed\n\n## Blocked by\n\n- None - can start immediately\n');
    assert.equal(texts.implementation, [
        '---',
        'owner: test',
        '---',
        '# Implementation',
        '',
        'Status: ready-for-agent',
        '',
        'Move after heading.',
        '',
        '## What to build',
        '',
        'Keep body.',
        '',
        '```md',
        'Status: completed',
        '## Blocked by',
        '```',
        '',
        '## Acceptance criteria',
        '',
        '- [ ] Keep checklist.',
        '',
        '## Blocked by',
        '',
        '- 01 - Target',
        '',
        '## Validation',
        '',
        '- [ ] Keep validation.',
        '',
    ].join('\n'));
    assert.equal(texts.wayfinder, '# Decision\n\nType: task\nBlocked by: 02, 01\n\n## Question\n\nKeep question.\n');

    const strict = readIssueDocuments(documents.map(document => ({
        ...document,
        text: texts[document.sourceKey],
    })));
    assert.deepEqual(strict.diagnostics, []);
    assert.deepEqual(strict.records.map(record => ({
        blockers: record.blockers.map(blocker => blocker.number),
        kind: record.kind,
        sourceKey: record.sourceKey,
    })), [
        {blockers: [], kind: 'implementation', sourceKey: 'target'},
        {blockers: ['01'], kind: 'implementation', sourceKey: 'implementation'},
        {blockers: ['02', '01'], kind: 'wayfinder', sourceKey: 'wayfinder'},
    ]);

    const repeated = migrateIssueDocuments(documents.map(document => ({
        ...document,
        text: texts[document.sourceKey],
    })));
    assert.deepEqual(repeated.diagnostics, []);
    assert.deepEqual(repeated.outputs.map(output => output.changed), [false, false, false]);
});

test('migration preserves structurally valid unknown status for strict runtime diagnostics', () => {
    const document = {
        effort: 'future',
        number: '01',
        sourceKey: 'unknown-status',
        text: '# Future\r\n\r\n**Status:** future-state\r\n\r\nBlocked by: 99 — Missing\r\n',
    };
    const migration = migrateIssueDocuments([document]);

    assert.deepEqual(migration.diagnostics, []);
    assert.deepEqual(migration.outputs, [{
        changed: true,
        sourceKey: 'unknown-status',
        text: '# Future\n\nStatus: future-state\n\n## Blocked by\n\n- 99 - Missing\n',
    }]);
    assert.deepEqual(readIssueDocuments([{...document, text: migration.outputs[0].text}]).diagnostics, [{
        message: 'Unknown implementation Status: future-state.',
        sourceKey: 'unknown-status',
    }]);
});

test('migration reports the deterministic legacy error matrix', () => {
    const cases = [
        ['z-wayfinder-non-bullet', '# Ticket\n\nType: task\n\n## Blocked by\n\n01\n', 'Blocked by section contains a non-bullet value.'],
        ['m-mixed', '# Mixed\n\nStatus: ready-for-agent\nBlocked by: None\n\n## Blocked by\n\n- None\n', 'Blocked by cannot mix inline and section formats.'],
        ['c-cross-effort', '# Cross\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- other/issues/01-target.md\n', 'Blocked by explicitly references another effort: other.'],
        ['b-empty-status', '# Empty\n\n**Status:**\n', 'Implementation issue must have one non-empty Status.'],
        ['a-unparseable', '# Broken\n\nStatus: ready-for-agent\n\n## Blocked by\n\nNone needs manual review\n', 'Blocked by cannot be parsed: None needs manual review.'],
    ];
    const result = migrateIssueDocuments(cases.map(([sourceKey, text]) => ({
        effort: 'matrix',
        number: '01',
        sourceKey,
        text,
    })));

    assert.deepEqual(result.outputs, []);
    assert.deepEqual(result.diagnostics, cases
        .map(([sourceKey, , message]) => ({message, sourceKey}))
        .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey)));
});

test('migration canonicalizes the accepted legacy blocker reference matrix', () => {
    const issue = (/** @type {string} */ sourceKey, /** @type {string} */ number, /** @type {string} */ blocker) => ({
        effort: 'references',
        number,
        sourceKey,
        text: `# ${sourceKey}\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- ${blocker}\n`,
    });
    const result = migrateIssueDocuments([
        issue('target', '01', 'None'),
        issue('markdown-link', '02', '[Link title](.scratch/references/issues/01-target.md)'),
        issue('backticked-path', '03', '`.scratch/references/issues/01-target.md`'),
        issue('path-title', '04', '.scratch/references/issues/01-target.md — Path title'),
    ]);
    const texts = Object.fromEntries(result.outputs.map(output => [output.sourceKey, output.text]));

    assert.deepEqual(result.diagnostics, []);
    assert.match(texts['markdown-link'], /- 01 - Link title\n$/);
    assert.match(texts['backticked-path'], /- 01 - target\n$/);
    assert.match(texts['path-title'], /- 01 - Path title\n$/);
    assert.equal(Object.values(texts).some(text => /\]\(|\.scratch\/references\/issues/.test(text)), false);
});

test('strict read excludes records invalidated by blocker graph semantics', () => {
    const issue = (/** @type {string} */ sourceKey, /** @type {string} */ number, /** @type {string} */ title, /** @type {string} */ blockers) => ({
        effort: 'graph',
        number,
        sourceKey,
        text: `# ${title}\n\nStatus: ready-for-agent\n\n## Blocked by\n\n${blockers}\n`,
    });
    const result = readIssueDocuments([
        issue('a-duplicate', '01', 'first', '- None'),
        issue('b-duplicate', '01', 'second', '- None'),
        issue('c-dependent', '03', 'dependent', '- 01'),
        issue('d-unknown', '04', 'unknown', '- 99'),
        issue('e-cycle-a', '05', 'cycle-a', '- 06'),
        issue('f-cycle-b', '06', 'cycle-b', '- 05'),
        issue('g-valid', '07', 'valid', '- None'),
    ]);

    assert.deepEqual(result.records.map(record => record.sourceKey), ['g-valid']);
    assert.deepEqual(result.diagnostics, [
        {message: 'Duplicate issue number 01 in effort 0001.', sourceKey: 'a-duplicate'},
        {message: 'Duplicate issue number 01 in effort 0001.', sourceKey: 'b-duplicate'},
        {message: 'Blocked by references malformed issue issue:0001:01.', sourceKey: 'c-dependent'},
        {
            message: 'Blocked by references unknown issue 99.',
            sourceKey: 'd-unknown',
            unresolvedReference: {effortNumber: '0001', number: '99'},
        },
        {message: 'Blocking cycle detected: issue:0001:05, issue:0001:06.', sourceKey: 'e-cycle-a'},
        {message: 'Blocking cycle detected: issue:0001:05, issue:0001:06.', sourceKey: 'f-cycle-b'},
    ]);
});

test('issue state predicates use shared executable and terminal rules', () => {
    const result = readIssueDocuments([
        {
            effort: 'state',
            number: '01',
            sourceKey: 'done',
            text: '# Done\n\nStatus: completed\n\n## Blocked by\n\n- None\n',
        },
        {
            effort: 'state',
            number: '02',
            sourceKey: 'ready',
            text: '# Ready\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- 01\n',
        },
        {
            effort: 'state',
            number: '03',
            sourceKey: 'blocked',
            text: '# Blocked\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- 02\n',
        },
        {
            effort: 'state',
            number: '04',
            sourceKey: 'open',
            text: '# Open\n\nType: research\nBlocked by: None\n',
        },
    ]);
    const records = Object.fromEntries(result.records.map(record => [record.sourceKey, record]));

    assert.equal(isIssueExecutable(records.done), false);
    assert.equal(isIssueExecutable(records.ready), true);
    assert.equal(isIssueExecutable(records.open), true);
    assert.equal(isIssueBlocked(records.ready), false);
    assert.equal(isIssueBlocked(records.blocked), true);
});

test('strict read handles frontmatter fences and canonical blocker grammars', () => {
    const result = readIssueDocuments([
        {
            effort: 'matrix',
            number: '01',
            sourceKey: 'target',
            text: '---\nowner: test\n---\n# Target\n\n```text\nType: task\nStatus: claimed\n## Blocked by\n```\n\nStatus: completed\n\n## Blocked by\n\n- None\n',
        },
        {
            effort: 'matrix',
            number: '02',
            sourceKey: 'implementation',
            text: '# Implementation\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- issue:0001:01\n',
        },
        {
            effort: 'matrix',
            number: '03',
            sourceKey: 'wayfinder',
            text: '# Wayfinder\n\nType: task\nBlocked by: 02, 01\n\n## Question\n\nChoose.\n',
        },
    ]);

    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.records.map(record => ({
        blockers: record.blockers.map(blocker => blocker.number),
        kind: record.kind,
        sourceKey: record.sourceKey,
        title: record.title,
    })), [
        {blockers: [], kind: 'implementation', sourceKey: 'target', title: 'Target'},
        {blockers: ['01'], kind: 'implementation', sourceKey: 'implementation', title: 'Implementation'},
        {blockers: ['02', '01'], kind: 'wayfinder', sourceKey: 'wayfinder', title: 'Wayfinder'},
    ]);
});

test('strict read reports the deterministic malformed document matrix', () => {
    const cases = [
        ['frontmatter', '---\nowner: test\n# Missing close\n', 'YAML frontmatter is not closed.'],
        ['preamble', 'Visible\n# Title\n\nStatus: completed\n\n## Blocked by\n\n- None\n', 'Rendered content appears before the first level-one heading.'],
        ['heading', 'Status: completed\n', 'The issue has no first level-one heading.'],
        ['empty-status', '# Title\n\nStatus:\n\n## Blocked by\n\n- None\n', 'Implementation issue must have one non-empty Status.'],
        ['unknown-status', '# Title\n\nStatus: future\n\n## Blocked by\n\n- None\n', 'Unknown implementation Status: future.'],
        ['unknown-type', '# Title\n\nType: review\nBlocked by: None\n', 'Unknown Wayfinder Type: review.'],
        ['wayfinder-status', '# Title\n\nType: task\nStatus: completed\nBlocked by: None\n', 'Invalid Wayfinder Status: completed.'],
        ['inline-implementation', '# Title\n\nStatus: completed\nBlocked by: None\n', 'Implementation issue must use a Blocked by section.'],
        ['empty-section', '# Title\n\nStatus: completed\n\n## Blocked by\n', 'Blocked by section must contain a bullet item.'],
        ['duplicate-blocker', '# Title\n\nStatus: completed\n\n## Blocked by\n\n- 01\n- 01\n', 'Blocked by repeats issue 01.'],
        ['mixed-none', '# Title\n\nStatus: completed\n\n## Blocked by\n\n- None\n- 01\n', 'Blocked by cannot mix None with concrete blockers.'],
        ['mixed-legacy-none', '# Title\n\nStatus: completed\n\n## Blocked by\n\n- None\n- .scratch/0001-matrix/issues/02-target.md\n', 'Blocked by cannot be parsed: .scratch/0001-matrix/issues/02-target.md.'],
        ['cross-effort', '# Title\n\nStatus: completed\n\n## Blocked by\n\n- issue:0002:01\n', 'Blocked by explicitly references another effort: 0002.'],
    ];

    for (const [sourceKey, text, message] of cases) {
        const result = readIssueDocuments([{effort: 'matrix', number: '01', sourceKey, text}]);

        assert.deepEqual(result.records, [], sourceKey);
        assert.deepEqual(result.diagnostics, [{message, sourceKey}], sourceKey);
    }
});

test('legacy issue shape ignores Type and bold field lines inside fenced code', () => {
    const legacy = '# Legacy\n\nBlocked by: None\n\n## What to build\n\nBody.\n';
    const fenced = '# Legacy\n\nBlocked by: None\n\n```text\nType: task\n**Status:** open\n```\n\n## What to build\n\nBody.\n';
    assert.equal(hasLegacyIssueShape(legacy), true);
    assert.equal(hasLegacyIssueShape(fenced), true);
    assert.equal(hasLegacyIssueShape('# Modern\n\nStatus: completed\n\n```text\nType: task\n**Status:** open\n```\n'), false);
});
