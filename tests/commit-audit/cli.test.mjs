import assert from 'node:assert/strict';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';

import {parseCommand, UsageError} from '../../lib/arw.mjs';
import {prepareCommitAudit} from '../../lib/commit-audit/commit-audit.mjs';
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

test('Commit Audit CLI keeps explicit absolute Request handles', () => {
    assert.deepEqual(parseCommand(['commit-audit', 'prepare', '--input', '/tmp/reviewer/input.json']), {
        inputPath: '/tmp/reviewer/input.json', kind: 'commit-audit-prepare',
    });
    for (const args of [
        ['commit-audit', 'prepare'],
        ['commit-audit', 'prepare', '--input', 'input.json'],
        ['commit-audit', 'generate', '--request', '/tmp/reviewer/request.json'],
    ]) assert.throws(() => parseCommand(args), UsageError);
});

test('prepare binds an empty txt report for an intermediate commit without Gate 1 or Gate 2', async t => {
    const repository = await stagedRepository(t, {statuses: ['in-progress']});
    const {request, inputPath} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    assert.deepEqual(request.gate1, []);
    assert.equal(request.gate2, null);
    assert.match(request.reviewPath, /reports\/review\.txt$/u);
    assert.equal(await readFile(request.reviewPath, 'utf8'), '');
    await assert.rejects(prepareCommitAudit({inputPath, repositoryRoot: repository.root}), {code: 'EEXIST'});
});

test('prepare adds Gate 1 for terminal transitions and Gate 2 documents when the effort is terminal', async t => {
    const repository = await stagedRepository(t, {statuses: ['completed', 'completed']});
    const {request} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01', 'issue:0001:02']});
    assert.deepEqual(request.gate1, ['issue:0001:01', 'issue:0001:02']);
    assert.deepEqual(request.gate2, {documents: ['.scratch/0001-workflow/spec.md']});

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
    const {request} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01'], gate2Exception: exception});
    assert.deepEqual(request.gate2, {documents: [], exception});
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
