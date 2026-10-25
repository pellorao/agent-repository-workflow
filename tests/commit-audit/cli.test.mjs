import assert from 'node:assert/strict';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';

import {parseCommand, UsageError} from '../../lib/arw.mjs';
import {generateCommitAudit, prepareCommitAudit} from '../../lib/commit-audit/commit-audit.mjs';
import {createRepository, run, writeArtifact, writeIssue} from '../helpers/arw-cli.mjs';
import {commitAll, runGit} from '../helpers/git.mjs';

const issueText = (/** @type {string} */ status, /** @type {string} */ requirement = 'Governing requirements:\n\n- `.scratch/0001-workflow/spec.md#spec`') => `# Implement workflow\n\nStatus: ${status}\n\n## What to build\n\nImplement.\n\n## Spec Requirement\n\n${requirement}\n\n## Acceptance criteria\n\n- [ ] Complete.\n\n## Blocked by\n\n- None\n`;
const specification = '# Spec\n\nFirst requirement.\n\n```text\nFenced example.\n```\n\nSecond requirement.\n';
const implementation = Array.from({length: 8}, (_, index) => `export const value${index + 1} = ${index + 1};`).join('\n') + '\n';

/** A repository whose staged candidate completes `statuses.length` issues of effort 0001. */
const stagedRepository = async (/** @type {import('node:test').TestContext} */ t, /** @type {{requirement?: string, statuses: string[]}} */ {requirement, statuses}) => {
    const repository = await createRepository(t);
    await writeArtifact(repository.root, '0001-workflow', 'spec.md', specification);
    for (const [index] of statuses.entries()) await writeIssue(repository.root, '0001-workflow', `0${index + 1}-issue.md`, issueText('ready-for-agent', requirement));
    await commitAll(repository.root, 'initial candidate');
    for (const [index, status] of statuses.entries()) await writeIssue(repository.root, '0001-workflow', `0${index + 1}-issue.md`, issueText(status, requirement));
    await writeFile(join(repository.root, 'implementation.mjs'), implementation, 'utf8');
    await runGit(repository.root, ['add', '.']);
    return repository;
};

let roundNumber = 0;
const prepare = async (/** @type {string} */ root, /** @type {unknown} */ input) => {
    roundNumber += 1;
    const directory = join(root, '.tmp', 'audit', String(roundNumber));
    await mkdir(directory, {recursive: true});
    const inputPath = join(directory, 'input.json');
    await writeFile(inputPath, JSON.stringify(input), 'utf8');
    const {requestPath} = await prepareCommitAudit({inputPath, repositoryRoot: root});
    const request = JSON.parse(await readFile(requestPath, 'utf8'));
    return {inputPath, request, requestPath};
};

/** Fill every checklist item; `overrides` maps item IDs to replacement field lines. */
const fill = async (/** @type {{reviewPath: string}} */ request, /** @type {Record<string, string>} */ overrides = {}) => {
    const text = await readFile(request.reviewPath, 'utf8');
    const filled = text.replace(/^## (R\d+) .*\n\n> .*\n\nverdict:\nevidence:\nnote:\n/gmu, (block, id) => block.replace(
        'verdict:\nevidence:\nnote:\n',
        overrides[id] ?? 'verdict: satisfied\nevidence: `implementation.mjs:1-2`\nnote:\n',
    ));
    await writeFile(request.reviewPath, filled, 'utf8');
};

const promote = async (/** @type {string} */ root, /** @type {Array<{sourcePath: string, targetPath: string}>} */ files) => {
    for (const file of files) await writeFile(join(root, file.targetPath), await readFile(join(root, file.sourcePath)));
    await runGit(root, ['add', ...files.map(file => file.targetPath)]);
};

test('Commit Audit CLI keeps explicit absolute Request handles', () => {
    assert.deepEqual(parseCommand(['commit-audit', 'prepare', '--input', '/tmp/reviewer/input.json']), {
        inputPath: '/tmp/reviewer/input.json', kind: 'commit-audit-prepare',
    });
    assert.deepEqual(parseCommand(['commit-audit', 'generate', '--request', '/tmp/reviewer/request.json']), {
        requestPath: '/tmp/reviewer/request.json', kind: 'commit-audit-generate',
    });
    for (const args of [
        ['commit-audit', 'prepare'],
        ['commit-audit', 'prepare', '--input', 'input.json'],
        ['commit-audit', 'generate'],
        ['commit-audit', 'generate', '--request', 'request.json'],
        ['commit-audit', 'generate', '--input', '/tmp/reviewer/batch.json'],
    ]) assert.throws(() => parseCommand(args), UsageError);
});

test('prepare lists every requirement line of an intermediate commit without Gate 1 or Gate 2', async t => {
    const repository = await stagedRepository(t, {statuses: ['in-progress']});
    const {request, inputPath} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    assert.deepEqual(request.gate1, []);
    assert.equal(request.gate2, null);
    assert.deepEqual(request.items, [
        {filePath: '.scratch/0001-workflow/issues/01-issue.md', line: 7},
        {filePath: '.scratch/0001-workflow/issues/01-issue.md', line: 17},
    ]);
    const checklist = await readFile(request.reviewPath, 'utf8');
    assert.match(checklist, /## R1 `\.scratch\/0001-workflow\/issues\/01-issue\.md:7`\n\n> Implement\.\n\nverdict:\n/u);
    assert.match(checklist, /## R2 `[^`]+:17`\n\n> - \[ \] Complete\.\n/u);
    await assert.rejects(prepareCommitAudit({inputPath, repositoryRoot: repository.root}), {code: 'EEXIST'});
});

test('prepare adds Gate 1 for terminal transitions and Gate 2 body lines when the effort is terminal', async t => {
    const repository = await stagedRepository(t, {statuses: ['completed', 'completed']});
    const {request} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01', 'issue:0001:02']});
    assert.deepEqual(request.gate1, ['issue:0001:01', 'issue:0001:02']);
    assert.deepEqual(request.gate2, {documents: ['.scratch/0001-workflow/spec.md']});
    assert.deepEqual(request.items.slice(4), [3, 9].map(line => ({filePath: '.scratch/0001-workflow/spec.md', line})));

    await assert.rejects(prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']}), /terminal issue transition is not authorized/);
    await assert.rejects(prepare(repository.root, {authorizingIssueIds: ['issue:0001:01', 'issue:0002:01']}), /all belong to one effort/);
    await assert.rejects(prepare(repository.root, {authorizingIssueIds: ['issue:0001:02', 'issue:0001:01']}), /unique and sorted/);
    const exception = {confirmedAt: '2026-09-10T00:00:00Z', reason: 'No governing requirements apply.'};
    await assert.rejects(prepare(repository.root, {authorizingIssueIds: ['issue:0001:01', 'issue:0001:02'], gate2Exception: exception}), /conflicts with governing requirements/);
});

test('Gate 2 without governing requirements requires a confirmed exception', async t => {
    const repository = await stagedRepository(t, {requirement: 'Not required', statuses: ['completed']});
    await assert.rejects(prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']}), /requires gate2Exception/);
    for (const gate2Exception of [{confirmedAt: '2026-09-10'}, {confirmedAt: '2026-09-10', reason: 'x'}, {confirmedAt: '2026-09-10T00:00:00Z', reason: ' '}]) {
        await assert.rejects(prepare(repository.root, {authorizingIssueIds: ['issue:0001:01'], gate2Exception}), /gate2Exception/);
    }
    const exception = {confirmedAt: '2026-09-10T00:00:00Z', reason: 'No governing requirements apply.'};
    const {request, requestPath} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01'], gate2Exception: exception});
    await fill(request);
    const generated = await generateCommitAudit({repositoryRoot: repository.root, requestPath});
    assert.ok('files' in generated);
    const specAudit = generated.files.find(file => file.targetPath.endsWith('spec-audit.json'));
    assert.deepEqual(JSON.parse(await readFile(join(repository.root, specAudit?.sourcePath ?? ''), 'utf8')),
        {documents: [], exception, requirements: [], result: 'not-applicable'});
    await promote(repository.root, generated.files);
    assert.equal((await run(['commit-audit', 'verify'], repository)).result, 0);
});

test('generate reports every missing verdict, invalid locator and missing note as an incomplete review', async t => {
    const repository = await stagedRepository(t, {statuses: ['completed']});
    const {request, requestPath} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    const before = await generateCommitAudit({repositoryRoot: repository.root, requestPath});
    assert.equal('kind' in before && before.kind, 'review-incomplete');
    assert.equal('diagnostics' in before && before.diagnostics.length, request.items.length);

    await fill(request, {
        R1: 'verdict: done\nevidence: implementation.mjs:1\nnote:\n',
        R2: 'verdict: n/a\nevidence:\nnote: Not needed.\n',
        R3: 'verdict: gap\nevidence: missing.mjs:1\nnote:\n',
        R4: 'verdict: satisfied\nevidence: implementation.mjs:99\nnote:\n',
    });
    const incomplete = await generateCommitAudit({repositoryRoot: repository.root, requestPath});
    assert.deepEqual('diagnostics' in incomplete && incomplete.diagnostics, [
        'R1: verdict must be satisfied, gap, uncertain or n/a.',
        'R2: an acceptance criterion cannot be n/a.',
        'R3: locator file is not a regular file in the reviewed version: missing.mjs.',
        'R3: gap requires a note.',
        'R4: locator line does not exist: implementation.mjs:99.',
    ]);
});

test('generate writes records, reports open items, and verify accepts only promoted satisfied records', async t => {
    const repository = await stagedRepository(t, {statuses: ['completed']});
    const {request, requestPath} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    assert.equal((await run(['commit-audit', 'verify'], repository)).result, 1);

    await fill(request, {R3: 'verdict: gap\nevidence: implementation.mjs:3\nnote: The second\nrequirement is missing.\n'});
    const gap = await run(['commit-audit', 'generate', '--request', requestPath], repository);
    assert.equal(gap.result, 0);
    const result = JSON.parse(gap.events[0].message);
    assert.deepEqual(result.open, [{blocking: true, evidence: 'implementation.mjs:3', note: 'The second\nrequirement is missing.', result: 'gap', source: '.scratch/0001-workflow/spec.md:3'}]);
    assert.deepEqual(result.files.map((/** @type {{targetPath: string}} */ file) => file.targetPath), ['.scratch/0001-workflow/issues/01.audit.json', '.scratch/0001-workflow/spec-audit.json']);
    await promote(repository.root, result.files);
    const rejected = await run(['commit-audit', 'verify'], repository);
    assert.equal(rejected.result, 1);
    assert.match(rejected.events[0].message, /Gate 2 record must contain requirements and a satisfied result/u);

    const second = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    await fill(second.request, {R4: 'verdict: n/a\nevidence:\nnote: Example text only.\n'});
    const satisfied = await generateCommitAudit({repositoryRoot: repository.root, requestPath: second.requestPath});
    assert.ok('files' in satisfied);
    assert.deepEqual(satisfied.open, []);
    await promote(repository.root, satisfied.files);
    const accepted = await run(['commit-audit', 'verify'], repository);
    assert.equal(accepted.result, 0, accepted.events.map(event => event.message).join('\n'));

    const issuePath = '.scratch/0001-workflow/issues/01-issue.md';
    await writeFile(join(repository.root, issuePath), issueText('completed').replace('Implement.', 'Implement.\nAdditional requirement.'), 'utf8');
    await runGit(repository.root, ['add', issuePath]);
    const stale = await generateCommitAudit({repositoryRoot: repository.root, requestPath: second.requestPath});
    assert.equal('kind' in stale && stale.kind, 'candidate-invalid');
    const missing = await run(['commit-audit', 'verify'], repository);
    assert.equal(missing.result, 1);
    assert.match(missing.events[0].message, /Gate 1 record does not cover requirement line: \.scratch\/0001-workflow\/issues\/01-issue\.md:8/u);
});

test('prepare rejects changed paths under another effort', async t => {
    const repository = await stagedRepository(t, {statuses: ['completed']});
    await writeArtifact(repository.root, '0002-other', 'spec.md', '# Other effort\n');
    await runGit(repository.root, ['add', '.scratch']);
    await assert.rejects(prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']}), /another effort: \.scratch\/0002-other\/spec\.md/u);
});

test('verify ignores Wayfinder tickets, preserves registered identities, and allows descriptive slug renames', async t => {
    const repository = await createRepository(t);
    const readyIssue = '# Work\n\nStatus: ready-for-agent\n\n## What to build\n\nWork.\n\n## Spec Requirement\n\nNot required\n\n## Acceptance criteria\n\n- [ ] Complete.\n\n## Blocked by\n\n- None\n';
    await writeIssue(repository.root, '0001-before', '01-before.md', readyIssue);
    await writeArtifact(repository.root, '0001-before', 'spec.md', '# Spec\n');
    await writeArtifact(repository.root, '0001-before', 'map.md', '# Map\n');
    await writeIssue(repository.root, '0002-research', '01-investigate.md', '# Investigate\n\nType: research\n\n## Question\n\nWhat should happen?\n');
    await commitAll(repository.root, 'registered artifacts and Wayfinder');

    await rename(join(repository.root, '.scratch', '0001-before'), join(repository.root, '.scratch', '0001-after'));
    await rename(
        join(repository.root, '.scratch', '0001-after', 'issues', '01-before.md'),
        join(repository.root, '.scratch', '0001-after', 'issues', '01-after.md'),
    );
    await runGit(repository.root, ['add', '-A']);
    assert.equal((await run(['commit-audit', 'verify'], repository)).result, 0);

    await runGit(repository.root, ['rm', '--quiet', '-f', '.scratch/0001-after/spec.md']);
    const missingIdentity = await run(['commit-audit', 'verify'], repository);
    assert.equal(missingIdentity.result, 1);
    assert.match(missingIdentity.events[0].message, /Committed ARW Artifact identity must be retained: spec:0001/);
});
