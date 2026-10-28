import assert from 'node:assert/strict';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {test} from 'node:test';

import {parseCommand, UsageError} from '../../lib/arw.mjs';
import {prepareCommitAudit} from '../../lib/commit-audit/commit-audit.mjs';
import {reviewerRecoveryPath} from '../../lib/reviewer-runtime/reviewer-session-record.mjs';
import {createRepository, run, writeArtifact, writeIssue} from '../helpers/arw-cli.mjs';
import {commitAll, runGit} from '../helpers/git.mjs';

const issueText = (/** @type {string} */ status, /** @type {string} */ requirement = 'Governing requirements:\n\n- `.scratch/0001-workflow/spec.md#spec`') => `# Implement workflow\n\nStatus: ${status}\n\n## What to build\n\nImplement.\n\n## Spec Requirement\n\n${requirement}\n\n## Acceptance criteria\n\n- [ ] Complete.\n\n## Blocked by\n\n- None\n`;
const specification = '# Spec\n\nFirst requirement.\n\n```text\nFenced example.\n```\n\nSecond requirement.\n';
const implementation = Array.from({length: 8}, (_, index) => `export const value${index + 1} = ${index + 1};`).join('\n') + '\n';

/** A repository whose staged candidate completes `statuses.length` issues of effort 0001. */
const stagedRepository = async (/** @type {import('node:test').TestContext} */ t, /** @type {{requirement?: string, statuses: string[]}} */ {requirement, statuses}) => {
    const repository = await createRepository(t);
    await writeArtifact(repository.root, '0001-workflow', 'spec.md', specification);
    for (const path of ['docs/agents/reviewer.md', 'docs/agents/roles/requirements-reviewer.md', 'docs/agents/roles/code-standards-reviewer.md']) {
        await mkdir(join(repository.root, path, '..'), {recursive: true});
        await writeFile(join(repository.root, path), `# ${path}\n`, 'utf8');
    }
    await writeFile(join(repository.root, '.arwignore'), 'generated.txt\n', 'utf8');
    for (const [index] of statuses.entries()) await writeIssue(repository.root, '0001-workflow', `0${index + 1}-issue.md`, issueText('ready-for-agent', requirement));
    await commitAll(repository.root, 'initial candidate');
    for (const [index, status] of statuses.entries()) await writeIssue(repository.root, '0001-workflow', `0${index + 1}-issue.md`, issueText(status, requirement));
    await writeFile(join(repository.root, 'implementation.mjs'), implementation, 'utf8');
    await writeFile(join(repository.root, 'generated.txt'), 'generated\n', 'utf8');
    await runGit(repository.root, ['add', '.']);
    return repository;
};

const identity = {platform: /** @type {const} */ ('codex'), sessionId: 'audit-session'};
let roundNumber = 0;
const prepare = async (/** @type {string} */ root, /** @type {unknown} */ input) => {
    roundNumber += 1;
    const directory = join(root, '.tmp', 'audit', String(roundNumber));
    await mkdir(directory, {recursive: true});
    const inputPath = join(directory, 'input.json');
    await writeFile(inputPath, JSON.stringify(input), 'utf8');
    const round = (await prepareCommitAudit({inputPath, platformAdapter: {getCurrentAgentIdentity: () => identity}, repositoryRoot: root})).roundDirectory;
    const request = JSON.parse(await readFile(join(round, 'request.json'), 'utf8'));
    return {request, round};
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

test('prepare writes a fixed-version round for both Reviewers and follows up their threads in the next round', async t => {
    const repository = await stagedRepository(t, {statuses: ['in-progress']});
    const first = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    assert.deepEqual(first.request.gate1, []);
    assert.equal(first.request.gate2, null);
    assert.equal(first.request.reviewPath, join(first.round, 'requirements-reviewer', 'review.txt'));
    assert.match(first.round, /\/_commit-audit\/1$/u);
    assert.equal(first.request.base, (await runGit(repository.root, ['rev-parse', 'HEAD'])).stdout.trim());
    assert.equal(first.request.tree, (await runGit(repository.root, ['write-tree'])).stdout.trim());
    assert.equal(await readFile(join(first.round, 'rules', 'docs/agents/reviewer.md'), 'utf8'), '# docs/agents/reviewer.md\n');
    const line = async (/** @type {string} */ round, /** @type {string} */ role) => JSON.parse(await readFile(join(round, `${role}.jsonl`), 'utf8'));
    const standards = await line(first.round, 'code-standards-reviewer');
    assert.equal(standards.operation, 'spawn_agent');
    assert.equal(await readFile(standards.input.reportPath, 'utf8'), '');
    assert.match(standards.input.handoff, /- implementation\.mjs\n/u);
    assert.doesNotMatch(standards.input.handoff, /generated\.txt/u);
    assert.match(standards.input.handoff, new RegExp(`git diff ${first.request.base} ${first.request.tree}`, 'u'));

    const requirements = await line(first.round, 'requirements-reviewer');
    await writeFile(reviewerRecoveryPath({stateDirectory: requirements.input.stateDirectory, role: 'requirements-reviewer', identity: requirements.input.identity}),
        JSON.stringify({runId: 'run-1', threadId: 'thread-1', failure: null, reportPath: first.request.reviewPath}));
    await writeFile(join(repository.root, 'implementation.mjs'), `${implementation}export const fixed = true;\n`, 'utf8');
    await runGit(repository.root, ['add', 'implementation.mjs']);
    const second = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    assert.match(second.round, /\/_commit-audit\/2$/u);
    const followup = await line(second.round, 'requirements-reviewer');
    assert.equal(followup.operation, 'followup_task');
    assert.equal(followup.input.runId, 'run-1');
    assert.match(followup.input.handoff, new RegExp(`git diff ${first.request.tree} ${second.request.tree}`, 'u'));
    assert.equal((await line(second.round, 'code-standards-reviewer')).operation, 'spawn_agent');
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
    const skipped = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01', 'issue:0001:02'], gate2Exception: exception});
    assert.deepEqual(skipped.request.gate2, {documents: [], exception});
    await writeArtifact(repository.root, '0001-workflow', 'spec.md', `${specification}\nChanged.\n`);
    await runGit(repository.root, ['add', '.']);
    await assert.rejects(prepare(repository.root, {authorizingIssueIds: ['issue:0001:01', 'issue:0001:02'], gate2Exception: exception}), /changed governing document/);
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

test('verify --non-implementation accepts planning records and rejects other or malformed staged content', async t => {
    const repository = await createRepository(t);
    await writeIssue(repository.root, '0001-plan', '01-task.md', issueText('ready-for-agent', 'Not required'));
    await writeArtifact(repository.root, '0001-plan', 'spec.md', '# Spec\n');
    await commitAll(repository.root, 'planning records');
    const verify = async () => (await run(['commit-audit', 'verify', '--non-implementation'], repository));

    await writeArtifact(repository.root, '0001-plan', 'spec.md', '# Spec\n\nMore.\n');
    await mkdir(join(repository.root, '.scratch', '0001-plan', 'research'), {recursive: true});
    await writeFile(join(repository.root, '.scratch', '0001-plan', 'research', 'notes.txt'), 'notes\n', 'utf8');
    await runGit(repository.root, ['add', '.']);
    assert.equal((await verify()).result, 0);

    await writeArtifact(repository.root, '0001-plan', 'spec.md', '# Spec\r\n');
    const unstaged = await verify();
    assert.equal(unstaged.result, 1);
    assert.match(unstaged.events[0].message, /unstaged replacement/u);
    await writeFile(join(repository.root, 'code.mjs'), 'export {};\n', 'utf8');
    await writeIssue(repository.root, '0001-plan', '01-task.md', issueText('completed', 'Not required'));
    await runGit(repository.root, ['add', '.']);
    const failures = (await verify()).events[0].message;
    for (const pattern of [/code\.mjs[^]*not eligible/u, /LF line endings/u, /terminal status/u]) assert.match(failures, pattern);
    assert.equal((await run(['commit-audit', 'verify', '--strict'], repository)).result, 2);
});

test('verify --non-implementation accepts a candidate of only Agent rule and documentation Markdown', async t => {
    const repository = await createRepository(t);
    const paths = ['AGENTS.md', 'docs/agents/rule.md', '.agents/skills/a/SKILL.md', '.claude/skills/a/SKILL.md', 'distribution/skills/a/SKILL.md'];
    for (const path of paths) {
        await mkdir(dirname(join(repository.root, path)), {recursive: true});
        await writeFile(join(repository.root, path), '# Rule\n', 'utf8');
    }
    await runGit(repository.root, ['add', '.']);
    assert.equal((await run(['commit-audit', 'verify', '--non-implementation'], repository)).result, 0);

    await writeFile(join(repository.root, '.agents/skills/a/agents.yaml'), 'a: 1\n', 'utf8');
    await runGit(repository.root, ['add', '.']);
    assert.equal((await run(['commit-audit', 'verify', '--non-implementation'], repository)).result, 1);
});
