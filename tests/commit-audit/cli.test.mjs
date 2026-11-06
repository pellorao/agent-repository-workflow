import assert from 'node:assert/strict';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {test} from 'node:test';

import {parseCommand, UsageError} from '../../lib/arw.mjs';
import {prepareCommitAudit, verifyCommitAudit} from '../../lib/commit-audit/commit-audit.mjs';
import {reviewerRecoveryPath} from '../../lib/reviewer-runtime/reviewer-session-record.mjs';
import {createRepository, run, writeArtifact, writeIssue} from '../helpers/arw-cli.mjs';
import {commitAll, runGit} from '../helpers/git.mjs';

const issueText = (/** @type {string} */ status) => `# Implement workflow\n\nStatus: ${status}\n\n## What to build\n\nImplement.\n\n## Acceptance criteria\n\n- [ ] Complete.\n\n## Blocked by\n\n- None\n`;
const specification = '# Spec\n\nFirst requirement.\n\n```text\nFenced example.\n```\n\nSecond requirement.\n';
const implementation = Array.from({length: 8}, (_, index) => `export const value${index + 1} = ${index + 1};`).join('\n') + '\n';

/** A repository whose staged candidate completes `statuses.length` issues of effort 0001. */
const stagedRepository = async (/** @type {import('node:test').TestContext} */ t, /** @type {{spec?: boolean, statuses: string[]}} */ {spec = true, statuses}) => {
    const repository = await createRepository(t);
    if (spec) await writeArtifact(repository.root, '0001-workflow', 'spec.md', specification);
    for (const path of ['docs/agents/reviewer.md', 'docs/agents/roles/requirements-reviewer.md', 'docs/agents/roles/code-standards-reviewer.md']) {
        await mkdir(join(repository.root, path, '..'), {recursive: true});
        await writeFile(join(repository.root, path), `# ${path}\n`, 'utf8');
    }
    await writeFile(join(repository.root, '.arwignore'), 'generated.txt\n', 'utf8');
    for (const [index] of statuses.entries()) await writeIssue(repository.root, '0001-workflow', `0${index + 1}-issue.md`, issueText('ready-for-agent'));
    await commitAll(repository.root, 'initial candidate');
    for (const [index, status] of statuses.entries()) await writeIssue(repository.root, '0001-workflow', `0${index + 1}-issue.md`, issueText(status));
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
const writeInput = async (/** @type {string} */ root, /** @type {unknown} */ input) => {
    roundNumber += 1;
    const directory = join(root, '.tmp', 'audit', String(roundNumber));
    await mkdir(directory, {recursive: true});
    const inputPath = join(directory, 'input.json');
    await writeFile(inputPath, JSON.stringify(input), 'utf8');
    return inputPath;
};
const prepare = async (/** @type {string} */ root, /** @type {unknown} */ input, platformAdapter = adapter) => {
    const inputPath = await writeInput(root, input);
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

test('prepare names the expected input.json location when the path is wrong', async t => {
    const repository = await stagedRepository(t, {statuses: ['ready-for-agent']});
    await assert.rejects(
        prepareCommitAudit({inputPath: join(repository.root, 'input.json'), platformAdapter: adapter, repositoryRoot: repository.root}),
        {message: new RegExp(`${repository.root}/\\.tmp/<directory>/input\\.json`, 'u')},
    );
});

test('prepare writes a fixed-version round for both Reviewers and follows up their threads in the next round', async t => {
    const repository = await stagedRepository(t, {statuses: ['ready-for-agent']});
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

test('prepare points both Reviewers at the Comments ledger of every authorizing issue', async t => {
    const repository = await stagedRepository(t, {statuses: ['ready-for-agent', 'ready-for-agent']});
    const {round} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01', 'issue:0001:02']});
    for (const role of ['requirements-reviewer', 'code-standards-reviewer']) {
        const {input} = JSON.parse(await readFile(join(round, `${role}.jsonl`), 'utf8'));
        assert.match(input.handoff, /处置台账: .*01-issue\.md, .*02-issue\.md 的 `## Comments` 章节/u);
    }
});

test('prepare adds Gate 1 for terminal transitions and Gate 2 documents changed since the effort start', async t => {
    const repository = await stagedRepository(t, {statuses: ['completed', 'completed']});
    const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    const {request} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01', 'issue:0001:02']});
    assert.deepEqual(request.gate1, ['issue:0001:01', 'issue:0001:02']);
    assert.deepEqual(request.gate2, {documents: ['.scratch/0001-workflow/spec.md'], since: emptyTree});

    await assert.rejects(prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']}), /terminal issue transition is not authorized/);
    await assert.rejects(prepare(repository.root, {authorizingIssueIds: ['issue:0001:01', 'issue:0002:01']}), /all belong to one effort/);
    await assert.rejects(prepare(repository.root, {authorizingIssueIds: ['issue:0001:02', 'issue:0001:01']}), /unique and sorted/);
    await assert.rejects(prepare(repository.root, {authorizingIssueIds: ['issue:0001:01', 'issue:0001:02'], gate2Exception: {}}), /only authorizingIssueIds/);
});

test('Gate 1 also covers an issue moving from wontfix to completed', async t => {
    const repository = await stagedRepository(t, {statuses: ['wontfix']});
    await commitAll(repository.root, 'wontfix');
    await writeIssue(repository.root, '0001-workflow', '01-issue.md', issueText('completed'));
    await runGit(repository.root, ['add', '.']);
    const {request} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    assert.deepEqual(request.gate1, ['issue:0001:01']);
});

test('Gate 2 documents are only the changed governing documents of this effort, so an unchanged effort needs no exception', async t => {
    const repository = await stagedRepository(t, {spec: false, statuses: ['completed']});
    await writeArtifact(repository.root, '0002-other', 'spec.md', specification);
    await mkdir(join(repository.root, 'docs', 'specs', 'area'), {recursive: true});
    await writeFile(join(repository.root, 'docs', 'specs', 'area', 'spec.md'), '# Area\n', 'utf8');
    await runGit(repository.root, ['add', '.']);
    const other = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']}).catch(error => error);
    assert.match(String(other), /another effort/u);
    await runGit(repository.root, ['rm', '-qf', '--cached', '.scratch/0002-other/spec.md']);
    const {request} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    assert.deepEqual(request.gate2.documents, ['docs/specs/area/spec.md']);
    await runGit(repository.root, ['rm', '-qf', '--cached', 'docs/specs/area/spec.md']);
    assert.deepEqual((await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']})).request.gate2.documents, []);
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
    await writeIssue(repository.root, '0001-plan', '01-task.md', issueText('ready-for-agent'));
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
    await writeIssue(repository.root, '0001-plan', '01-task.md', issueText('completed'));
    await writeFile(join(repository.root, '.scratch', '0001-plan', 'issues', '01.spec-readiness.json'), '{}\n', 'utf8');
    await runGit(repository.root, ['add', '.']);
    const failures = (await verify()).events[0].message;
    for (const pattern of [/code\.mjs[^]*not eligible/u, /LF line endings/u, /readiness record/u]) assert.match(failures, pattern);
    assert.equal((await run(['commit-audit', 'verify', '--strict'], repository)).result, 2);
});

test('verify --non-implementation lets an issue without a readiness record complete, any issue become wontfix, and rejects wontfix to completed with a readiness record', async t => {
    const repository = await createRepository(t);
    await writeIssue(repository.root, '0001-plan', '01-task.md', issueText('ready-for-agent'));
    await writeIssue(repository.root, '0001-plan', '02-task.md', issueText('ready-for-agent'));
    await writeFile(join(repository.root, '.scratch', '0001-plan', 'issues', '02.spec-readiness.json'), '{}\n', 'utf8');
    await commitAll(repository.root, 'planning records');
    await writeIssue(repository.root, '0001-plan', '01-task.md', issueText('completed'));
    await writeIssue(repository.root, '0001-plan', '02-task.md', issueText('wontfix'));
    await runGit(repository.root, ['add', '.']);
    assert.equal((await run(['commit-audit', 'verify', '--non-implementation'], repository)).result, 0);
    await commitAll(repository.root, 'terminal records');
    await writeIssue(repository.root, '0001-plan', '02-task.md', issueText('completed'));
    await runGit(repository.root, ['add', '.']);
    const rejected = await run(['commit-audit', 'verify', '--non-implementation'], repository);
    assert.equal(rejected.result, 1);
    assert.match(rejected.events[0].message, /readiness record/u);
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
    const repository = await stagedRepository(t, {statuses: ['ready-for-agent']});
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
    const repository = await stagedRepository(t, {statuses: ['ready-for-agent']});
    const {round} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    await writeReports(round);
    const original = issueText('ready-for-agent');
    await stageIssue(repository.root, `${original}\n## Validation\n\nChecked.\n\n## Comments\n\nNote.\n`);
    assert.equal(await verifyRound(repository.root), '');
    for (const changed of [original.replace('ready-for-agent', 'completed'), original.replace('- [ ] Complete.', '- [x] Complete.')]) {
        await stageIssue(repository.root, changed);
        assert.match(await verifyRound(repository.root), /01-issue\.md: Authorizing issue Status or review subject changed/u);
    }
});

test('verify takes each Reviewer report from the latest non-empty round and resolves the session round for both platforms', async t => {
    const repository = await stagedRepository(t, {statuses: ['ready-for-agent']});
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

test('prepare numbers a new round after the highest existing one, so verify checks the round it just created', async t => {
    const repository = await stagedRepository(t, {statuses: ['ready-for-agent']});
    const {round: first} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    await mkdir(join(dirname(first), '7'));
    const {round: second} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    assert.match(second, /\/_commit-audit\/8$/u);
    await writeReports(second);
    assert.equal(await verifyRound(repository.root), '');
});

test('prepare summarizes staged net growth by category, skips .scratch records and numbers the next ADR', async t => {
    const repository = await stagedRepository(t, {statuses: ['ready-for-agent']});
    // One more change of every kind the summary distinguishes.
    const files = {'docs/adr/0001-a.md': '# A\n', 'docs/adr/0004-b.md': '# B\n', 'docs/agents/reviewer.md': '#\n', 'docs/note.md': 'hello', 'tests/x.test.mjs': 'a\nb\nc\n'};
    for (const [path, text] of Object.entries(files)) {
        await mkdir(join(repository.root, path, '..'), {recursive: true});
        await writeFile(join(repository.root, path), text, 'utf8');
    }
    await runGit(repository.root, ['add', '.']);
    const {summary} = await prepareCommitAudit({inputPath: await writeInput(repository.root, {authorizingIssueIds: ['issue:0001:01']}), platformAdapter: adapter, repositoryRoot: repository.root});
    assert.equal(summary, [
        'code: +9 lines (files: 2)', '  generated.txt +1', '  implementation.mjs +8',
        'documents: -11 characters (files: 4)', '  docs/adr/0001-a.md +4', '  docs/adr/0004-b.md +4', '  docs/agents/reviewer.md -24', '  docs/note.md +5',
        'tests: +3 lines (files: 1)', '  tests/x.test.mjs +3',
        'next ADR number: 0005',
    ].join('\n'));
});

test('prepare warns about a recorded net growth that differs from the measurement and about checked acceptance commands missing from Validation', async t => {
    const repository = await stagedRepository(t, {statuses: ['ready-for-agent']});
    await mkdir(join(repository.root, 'tests'));
    await writeFile(join(repository.root, 'tests/x.test.mjs'), 'a\nb\nc\n', 'utf8');
    await runGit(repository.root, ['add', 'tests']);
    await stageIssue(repository.root, issueText('ready-for-agent').replace('- [ ] Complete.', [
        '- [x] Run `pnpm test` and `node ok.mjs`.', '* [x] Run `node missing.mjs`.', '  + [X] Run `git diff --check`.', '- [ ] Run `arw unchecked`.', '-[x] Run `arw no-space`.',
        '```', '- [x] Run `arw fenced`.', '```',
    ].join('\n')) + [
        '\n## Validation\n', '- code: +8 lines (files: 2)', '- tests: +3 lines (files: 1)', '- documents: 245 passed', '- documents: 5 lines', '- tests: 9 characters', '- 17 lines of code changed', '- `pnpm test` and `node ok.mjs` passed',
    ].join('\n') + '\n');
    const {summary} = await prepareCommitAudit({inputPath: await writeInput(repository.root, {authorizingIssueIds: ['issue:0001:01']}), platformAdapter: adapter, repositoryRoot: repository.root});
    const lines = summary.split('\n');
    const path = '.scratch/0001-workflow/issues/01-issue.md';
    assert.equal(lines.at(-4), 'next ADR number: 0001');
    assert.deepEqual(lines.slice(-3), [
        `warning: ${path}: Validation records code: 8 but this candidate measures 9.`,
        `warning: ${path}: checked acceptance item "* [x] Run \`node missing.mjs\`." names \`node missing.mjs\`, which Validation does not mention.`,
        `warning: ${path}: checked acceptance item "+ [X] Run \`git diff --check\`." names \`git diff --check\`, which Validation does not mention.`,
    ]);
});

test('prepare treats a missing Validation or Acceptance criteria section as empty text', async t => {
    const repository = await stagedRepository(t, {statuses: ['ready-for-agent']});
    await stageIssue(repository.root, issueText('ready-for-agent').replace('- [ ] Complete.\n\n## Blocked by', '## Blocked by').replace('## Acceptance criteria\n\n', '- [x] Run `node a.mjs`.\n\n') + '\n## Comments\n\n- code: +1 lines\n');
    const {summary} = await prepareCommitAudit({inputPath: await writeInput(repository.root, {authorizingIssueIds: ['issue:0001:01']}), platformAdapter: adapter, repositoryRoot: repository.root});
    assert.equal(summary.split('\n').at(-1), 'next ADR number: 0001');
});

test('the prepare command keeps standard output to the round directory and writes the summary to standard error', async t => {
    const repository = await stagedRepository(t, {statuses: ['ready-for-agent']});
    const environment = {CLAUDECODE: process.env.CLAUDECODE, CODEX_THREAD_ID: process.env.CODEX_THREAD_ID};
    t.after(() => Object.assign(process.env, environment));
    delete process.env.CLAUDECODE;
    process.env.CODEX_THREAD_ID = 'summary-session';
    const {events} = await run(['commit-audit', 'prepare', '--input', await writeInput(repository.root, {authorizingIssueIds: ['issue:0001:01']})], repository);
    assert.deepEqual(events.map(event => event.channel), ['stdout', 'stderr']);
    assert.match(events[0].message, /\/_commit-audit\/1$/u);
    assert.match(events[1].message, /^code: \+9 lines \(files: 2\)\n/u);
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
    await writeIssue(repository.root, '0001-a', '01-x.md', issueText('ready-for-agent'));
    await writeIssue(repository.root, '0001-b', '01-x.md', issueText('ready-for-agent'));
    await writeFile(join(repository.root, 'crlf.md'), 'a\r\n', 'utf8');
    await runGit(repository.root, ['add', '.']);
    const failures = await verify();
    assert.match(failures, /duplicate canonical issue ID/u);
    assert.match(failures, /LF line endings/u);
});


test('prepare uses canonical issue metadata for whitespace, fences and bold Type', async t => {
    const repository = await stagedRepository(t, {statuses: ['completed']});
    for (const text of [
        issueText('completed').replace('Status: completed', 'Status:  completed '),
        issueText('completed') + '\n## Comments\n\n```text\nStatus: open\n```\n',
    ]) {
        await stageIssue(repository.root, text);
        const {request} = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
        assert.deepEqual(request.gate1, ['issue:0001:01']);
        assert.notEqual(request.gate2, null);
    }
    await stageIssue(repository.root, issueText('open').replace('Status: open', '**Type:** research\n\nStatus: open'));
    await assert.rejects(prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']}), /Unknown implementation Status: open/u);
});

test('verify keeps HEAD, changed-path and report errors when an authorizing issue is renamed after prepare', async t => {
    const repository = await stagedRepository(t, {statuses: ['ready-for-agent']});
    await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    await commitAll(repository.root, 'advance HEAD');
    await rename(join(repository.root, '.scratch/0001-workflow/issues/01-issue.md'), join(repository.root, '.scratch/0001-workflow/issues/01-renamed.md'));
    await writeFile(join(repository.root, 'implementation.mjs'), implementation + 'export const later = true;\n');
    await runGit(repository.root, ['add', '-A']);
    const errors = await verifyRound(repository.root);
    assert.match(errors, /HEAD changed after the reviewed version/u);
    assert.match(errors, /01-issue\.md: Staged path changed/u);
    assert.match(errors, /01-renamed\.md: Commit Audit git show [^\n]*failed/u);
    assert.match(errors, /implementation\.mjs: Staged path changed/u);
    assert.match(errors, /requirements-reviewer report is empty/u);
    assert.match(errors, /code-standards-reviewer report is empty/u);
});

test('verify accumulates canonical issue parse errors without dropping independent failures', async t => {
    const repository = await stagedRepository(t, {statuses: ['ready-for-agent']});
    await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    await commitAll(repository.root, 'advance HEAD');
    await stageIssue(repository.root, issueText('open'));
    const errors = await verifyRound(repository.root);
    assert.match(errors, /HEAD changed after the reviewed version/u);
    assert.match(errors, /01-issue\.md: Unknown implementation Status: open/u);
    assert.match(errors, /01-issue\.md: Staged path changed/u);
    assert.match(errors, /code-standards-reviewer report is empty/u);
});

test('prepare filters paths using staged root and nested ignore files on both platforms', async t => {
    const repository = await stagedRepository(t, {statuses: ['ready-for-agent']});
    await mkdir(join(repository.root, 'nested'));
    await writeFile(join(repository.root, '.gitignore'), 'root-ignored.txt\n');
    await writeFile(join(repository.root, 'nested/.gitignore'), 'ignored.txt\n');
    for (const path of ['root-ignored.txt', 'nested/ignored.txt', 'nested/included.txt']) await writeFile(join(repository.root, path), 'data\n');
    await runGit(repository.root, ['add', '-f', '.gitignore', 'nested', 'root-ignored.txt']);
    const paths = async (/** @type {string} */ round) => {
        const request = JSON.parse(await readFile(join(round, 'code-standards-reviewer.jsonl'), 'utf8'));
        return request.input.handoff.split('纳入路径:\n')[1].split('\n预估')[0];
    };
    const first = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    const originalPaths = await paths(first.round);
    assert.match(originalPaths, /- implementation\.mjs\n/u);
    assert.match(originalPaths, /- nested\/included\.txt/u);
    assert.doesNotMatch(originalPaths, /generated\.txt|root-ignored\.txt|nested\/ignored\.txt/u);
    await writeFile(join(repository.root, '.arwignore'), 'implementation.mjs\n');
    await writeFile(join(repository.root, '.gitignore'), 'generated.txt\n');
    await writeFile(join(repository.root, 'nested/.gitignore'), 'included.txt\n');
    const claude = {getCurrentAgentIdentity: () => ({platform: /** @type {const} */ ('claude-code'), sessionId: 'ignore-session'})};
    const second = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']}, claude);
    assert.equal(second.request.tree, first.request.tree);
    assert.equal(await paths(second.round), originalPaths);
    await runGit(repository.root, ['add', '.arwignore', '.gitignore', 'nested/.gitignore']);
    const third = await prepare(repository.root, {authorizingIssueIds: ['issue:0001:01']});
    const stagedPaths = await paths(third.round);
    assert.match(stagedPaths, /root-ignored\.txt/u);
    assert.match(stagedPaths, /nested\/ignored\.txt/u);
    assert.doesNotMatch(stagedPaths, /implementation\.mjs|generated\.txt|nested\/included\.txt/u);
});
