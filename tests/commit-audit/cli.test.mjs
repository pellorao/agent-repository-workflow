import assert from 'node:assert/strict';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {test} from 'node:test';

import {parseCommand, UsageError} from '../../lib/arw.mjs';
import {prepareCommitAudit, verifyCommitAudit} from '../../lib/commit-audit/commit-audit.mjs';
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
const adapter = {getCurrentAgentIdentity: () => /** @type {{platform: 'claude-code' | 'codex', sessionId: string}} */ (identity)};
const verifyRound = async (/** @type {string} */ root) => (await verifyCommitAudit({platformAdapter: adapter, repositoryRoot: root})).errors.map(error => `${error.filePath}: ${error.message}`).join('\n');
const writeReports = (/** @type {string} */ round, /** @type {string[]} */ roles = ['requirements-reviewer', 'code-standards-reviewer'], text = 'No problems.\n') => Promise.all(roles.map(role => writeFile(join(round, role, 'review.txt'), text, 'utf8')));
const stageIssue = async (/** @type {string} */ root, /** @type {string} */ text) => {
    await writeIssue(root, '0001-workflow', '01-issue.md', text);
    await runGit(root, ['add', '.scratch']);
};
let roundNumber = 0;
const prepare = async (/** @type {string} */ root, /** @type {unknown} */ input, platformAdapter = adapter) => {
    roundNumber += 1;
    const directory = join(root, '.tmp', 'audit', String(roundNumber));
    await mkdir(directory, {recursive: true});
    const inputPath = join(directory, 'input.json');
    await writeFile(inputPath, JSON.stringify(input), 'utf8');
    const round = (await prepareCommitAudit({inputPath, platformAdapter, repositoryRoot: root})).roundDirectory;
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
    const fakeRound = async () => {
        const round = join(repository.root, '.tmp', 'codex', 'audit-session', '_commit-audit', '1');
        for (const role of ['requirements-reviewer', 'code-standards-reviewer']) await mkdir(join(round, role), {recursive: true});
        await writeReports(round);
        await writeFile(join(round, 'request.json'), JSON.stringify({authorizingIssueIds: [], base: (await runGit(repository.root, ['rev-parse', 'HEAD'])).stdout.trim(), tree: (await runGit(repository.root, ['write-tree'])).stdout.trim()}));
    };
    await fakeRound();
    assert.equal(await verifyRound(repository.root), '');

    await runGit(repository.root, ['rm', '--quiet', '-f', '.scratch/0001-after/spec.md']);
    await fakeRound();
    assert.match(await verifyRound(repository.root), /Committed ARW Artifact identity must be retained: spec:0001/);
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
    const paths = ['AGENTS.md', 'docs/agents/rule.md', '.agents/skills/a/SKILL.md', '.claude/skills/a/SKILL.md', 'distribution/skills/a/SKILL.md',
        'README.md', 'README.zh-CN.md', 'CONTEXT.md', 'CLAUDE.md'];
    for (const path of paths) {
        await mkdir(dirname(join(repository.root, path)), {recursive: true});
        await writeFile(join(repository.root, path), '# Rule\n', 'utf8');
    }
    await runGit(repository.root, ['add', '.']);
    assert.equal((await run(['commit-audit', 'verify', '--non-implementation'], repository)).result, 0);

    await writeFile(join(repository.root, '.agents/skills/a/agents.yaml'), 'a: 1\n', 'utf8');
    await runGit(repository.root, ['add', '.']);
    assert.equal((await run(['commit-audit', 'verify', '--non-implementation'], repository)).result, 1);

    await runGit(repository.root, ['rm', '-q', '-f', '.agents/skills/a/agents.yaml']);
    await mkdir(join(repository.root, 'tests/fixtures'), {recursive: true});
    await writeFile(join(repository.root, 'tests/fixtures/README.md'), '# Fixture\n', 'utf8');
    await runGit(repository.root, ['add', '.']);
    assert.match((await run(['commit-audit', 'verify', '--non-implementation'], repository)).events[0].message, /tests\/fixtures\/README\.md/u);
});

test('verify requires a review round whose HEAD and tree match the staged candidate', async t => {
    const repository = await stagedRepository(t, {statuses: ['in-progress']});
    assert.match(await verifyRound(repository.root), /No Commit Audit round exists for this session\. Run `arw commit-audit prepare` again/u);
    await mkdir(join(repository.root, '.tmp', 'codex', 'audit-session', '_commit-audit', '1'), {recursive: true});
    assert.match(await verifyRound(repository.root), /no readable request\.json\. Run `arw commit-audit prepare` again/u);
    const {round} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    const empty = await verifyRound(repository.root);
    assert.match(empty, /requirements-reviewer report is empty\. Relaunch it/u);
    assert.match(empty, /code-standards-reviewer report is empty/u);
    await writeReports(round);
    assert.equal(await verifyRound(repository.root), '');

    await writeFile(join(repository.root, 'implementation.mjs'), `${implementation}export const later = true;\n`, 'utf8');
    await runGit(repository.root, ['add', 'implementation.mjs']);
    assert.match(await verifyRound(repository.root), /implementation\.mjs: Staged path changed after the reviewed version\. Run `arw commit-audit prepare`/u);
    await runGit(repository.root, ['reset', '-q', '--', 'implementation.mjs']);
    await commitAll(repository.root, 'advance HEAD');
    assert.match(await verifyRound(repository.root), /HEAD changed after the reviewed version/u);
});

test('verify accepts only issue record changes and rejects Status or review subject changes of an authorizing issue', async t => {
    const repository = await stagedRepository(t, {statuses: ['in-progress']});
    const {round} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    await writeReports(round);
    const original = issueText('in-progress');
    await stageIssue(repository.root, `${original}\n## Validation\n\nChecked.\n\n## Comments\n\nNote.\n`);
    assert.equal(await verifyRound(repository.root), '');
    for (const changed of [original.replace('in-progress', 'completed'), original.replace('- [ ] Complete.', '- [x] Complete.')]) {
        await stageIssue(repository.root, changed);
        assert.match(await verifyRound(repository.root), /01-issue\.md: Authorizing issue Status or review subject changed/u);
    }
});

test('verify takes each Reviewer report from the latest non-empty round and resolves the session round for both platforms', async t => {
    const repository = await stagedRepository(t, {statuses: ['in-progress']});
    const {round: first} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    await writeReports(first, ['requirements-reviewer', 'code-standards-reviewer'], ' \n');
    await writeReports(first, ['requirements-reviewer']);
    await writeFile(join(repository.root, 'implementation.mjs'), `${implementation}export const fixed = true;\n`, 'utf8');
    await runGit(repository.root, ['add', 'implementation.mjs']);
    const {round: second} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    assert.match(await verifyRound(repository.root), /code-standards-reviewer report is empty/u);
    assert.doesNotMatch(await verifyRound(repository.root), /requirements-reviewer report/u);
    await writeReports(second, ['code-standards-reviewer']);
    assert.equal(await verifyRound(repository.root), '');

    const claude = {getCurrentAgentIdentity: () => ({platform: /** @type {const} */ ('claude-code'), sessionId: 'claude-session'})};
    const {round: roundDirectory} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']}, claude);
    assert.match(roundDirectory, /\/\.tmp\/claude-code\/claude-session\/_commit-audit\/1$/u);
    await writeReports(roundDirectory);
    assert.deepEqual((await verifyCommitAudit({platformAdapter: claude, repositoryRoot: repository.root})).errors, []);
});

test('verify --non-implementation rejects non-canonical effort directories and NUL Markdown, and keeps checking after an Artifact error', async t => {
    const repository = await createRepository(t);
    const verify = async () => (await run(['commit-audit', 'verify', '--non-implementation'], repository)).events[0].message;
    await writeArtifact(repository.root, 'audit-notes', 'spec.md', '# Spec\n');
    await mkdir(join(repository.root, 'docs'), {recursive: true});
    await writeFile(join(repository.root, 'docs', 'notes.md'), 'a\0b\n', 'utf8');
    await runGit(repository.root, ['add', '.']);
    const rejected = await verify();
    assert.match(rejected, /audit-notes\/spec\.md[^]*canonical NNNN-<slug>/u);
    assert.match(rejected, /docs\/notes\.md[^]*NUL bytes/u);

    await runGit(repository.root, ['reset', '-q']);
    await rm(join(repository.root, '.scratch', 'audit-notes'), {recursive: true});
    await rm(join(repository.root, 'docs'), {recursive: true});
    await writeIssue(repository.root, '0001-a', '01-x.md', issueText('ready-for-agent', 'Not required'));
    await writeIssue(repository.root, '0001-b', '01-x.md', issueText('ready-for-agent', 'Not required'));
    await writeFile(join(repository.root, 'crlf.md'), 'a\r\n', 'utf8');
    await runGit(repository.root, ['add', '.']);
    const failures = await verify();
    assert.match(failures, /duplicate canonical issue ID/u);
    assert.match(failures, /LF line endings/u);
});

test('prepare ignores governing documents under a non-canonical effort directory', async t => {
    const repository = await stagedRepository(t, {requirement: 'Governing requirements:\n\n- `.scratch/audit/spec.md#spec`', statuses: ['completed']});
    await writeArtifact(repository.root, '../audit', 'spec.md', specification);
    await runGit(repository.root, ['add', '.']);
    await assert.rejects(prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']}), /requires gate2Exception/u);
});
