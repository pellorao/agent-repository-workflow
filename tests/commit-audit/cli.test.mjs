import assert from 'node:assert/strict';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {before, test} from 'node:test';

import {parseCommand, UsageError} from '../../lib/arw.mjs';
import {generateCommitAudit, isCommitAuditReviewOutputInvalid, parseCommitAuditRecord, prepareCommitAudit, validateCommitAuditReview} from '../../lib/commit-audit/commit-audit.mjs';
import {readStagedCandidate} from '../../lib/arw-common/repository-state-inspector.mjs';
import {createNodeGitRunner} from '../../lib/common/git-process.mjs';
import {createRepository, run, writeArtifact, writeIssue, writeJsonRecord} from '../helpers/arw-cli.mjs';
import {createScriptedGitRunner, createScriptedScopedFilesystemFactory} from '../helpers/commit-audit-adapters.mjs';
import {commitAll, runGit} from '../helpers/git.mjs';

const issueText = (/** @type {string} */ status) => `# Implement workflow\n\nStatus: ${status}\n\n## What to build\n\nImplement.\n\n## Spec Requirement\n\nGoverning requirements:\n\n- \`.scratch/0001-workflow/spec.md#spec\`\n\n## Acceptance criteria\n\n- [ ] Complete.\n\n## Blocked by\n\n- None\n`;
const specification = '# Spec\n\nFirst requirement.\nSecond requirement.\nThird requirement.\nFourth requirement.\nFifth requirement.\nSixth requirement.\nSeventh requirement.\nEighth requirement.\nNinth requirement.\nTenth requirement.\nEleventh requirement.\nTwelfth requirement.\nThirteenth requirement.\n';
const implementation = Array.from({length: 8}, (_, index) => `export const value${index + 1} = ${index + 1};`).join('\n') + '\n';
const recordSections = '\n## Validation\n\n- Validation evidence.\n\n### Current evidence\n\nCommand output recorded.\n\n## Comments\n\n- Review event recorded.\n\n### Review history\n\nReview conclusion recorded.\n';

/** @typedef {{argv: string[], input?: Buffer | string, result: {code: number | null, failure: 'process' | 'timeout' | null, stderr: string, stdout: Buffer}}} GitScript */
/** @type {{exceptionScripts: GitScript[], inputPath: string, repository: Awaited<ReturnType<typeof createRepository>>, request: any, requestDirectory: string, requestPath: string, scripts: GitScript[], seed: Map<string, Buffer>, singleScripts: GitScript[]}} */
let shared;

before(async t => {
    const repository = await createRepository(/** @type {import('node:test').TestContext} */ (t));
    await writeArtifact(repository.root, '0001-workflow', 'spec.md', specification);
    await writeIssue(repository.root, '0001-workflow', '01-first.md', issueText('ready-for-agent'));
    await writeIssue(repository.root, '0001-workflow', '02-second.md', issueText('ready-for-agent'));
    await commitAll(repository.root, 'initial candidate');
    await writeIssue(repository.root, '0001-workflow', '01-first.md', issueText('completed'));
    await writeIssue(repository.root, '0001-workflow', '02-second.md', issueText('completed'));
    await writeFile(join(repository.root, 'implementation.mjs'), implementation, 'utf8');
    await runGit(repository.root, ['add', '.scratch/0001-workflow/issues', 'implementation.mjs']);
    const requestDirectory = join(repository.root, '.tmp', 'codex', 'shared-request');
    const inputPath = join(requestDirectory, 'input.json');
    const requestPath = join(requestDirectory, 'request.json');
    await mkdir(requestDirectory, {recursive: true});
    await writeFile(inputPath, JSON.stringify({authorizingIssueIds: ['issue:0001:01', 'issue:0001:02']}), 'utf8');
    /** @type {GitScript[]} */
    const scripts = [];
    const nodeGit = createNodeGitRunner(repository.root);
    const recordingGit = (/** @type {GitScript[]} */ target) => ({async run(/** @type {{argv: string[], input?: Buffer | string}} */ input) {
        const result = await nodeGit.run(input);
        target.push({argv: [...input.argv], ...(input.input === undefined ? {} : {input: Buffer.from(input.input)}), result: {...result, stdout: Buffer.from(result.stdout)}});
        return result;
    }});
    await prepareCommitAudit({git: recordingGit(scripts), inputPath, repositoryRoot: repository.root});
    const request = JSON.parse(await readFile(requestPath, 'utf8'));

    /** @type {GitScript[]} */
    const singleScripts = [];
    await writeIssue(repository.root, '0001-workflow', '02-second.md', issueText('ready-for-agent'));
    await runGit(repository.root, ['add', '.scratch/0001-workflow/issues/02-second.md']);
    await readStagedCandidate({git: recordingGit(singleScripts)});

    /** @type {GitScript[]} */
    const exceptionScripts = [];
    const noGoverningRequirement = (/** @type {string} */ status) => issueText(status).replace('Governing requirements:\n\n- `.scratch/0001-workflow/spec.md#spec`', 'Not required');
    await writeIssue(repository.root, '0001-workflow', '01-first.md', noGoverningRequirement('completed'));
    await writeIssue(repository.root, '0001-workflow', '02-second.md', noGoverningRequirement('completed'));
    await runGit(repository.root, ['add', '.scratch/0001-workflow/issues']);
    await readStagedCandidate({git: recordingGit(exceptionScripts)});

    await writeIssue(repository.root, '0001-workflow', '01-first.md', issueText('completed'));
    await writeIssue(repository.root, '0001-workflow', '02-second.md', issueText('completed'));
    await runGit(repository.root, ['add', '.scratch/0001-workflow/issues']);
    shared = {
        exceptionScripts,
        inputPath,
        repository,
        request,
        requestDirectory,
        requestPath,
        scripts,
        seed: new Map([
            ['input.json', await readFile(inputPath)],
            ['request.json', await readFile(requestPath)],
            ['reports/review.jsonl', Buffer.alloc(0)],
        ]),
        singleScripts,
    };
});

const rows = () => {
    const gate1 = shared.request.gate1.flatMap((/** @type {{requirements: Array<{filePath: string, line: number}>}} */ scope) => scope.requirements.map(source => ({
        evidence: [{filePath: 'implementation.mjs', lines: [1]}],
        requirement: `Gate 1 requirement at ${source.filePath}:${source.line}.`,
        result: 'satisfied',
        source,
    })));
    const gate2Document = shared.request.gate2[0].documents[0];
    const gate2 = [{
        evidence: [{filePath: 'implementation.mjs', lines: [[1, 2], 2, [3, 4], 6]}, {command: 'node --test', exitCode: -1}],
        requirement: 'First governing requirement.',
        result: 'satisfied',
        source: {filePath: gate2Document, line: 3},
    }, ...[4, 5, 6, 7].map(line => ({
        evidence: [{filePath: 'implementation.mjs', lines: [line]}],
        requirement: `Governing requirement at line ${line}.`,
        result: 'satisfied',
        source: {filePath: gate2Document, line},
    }))];
    return [...gate1, ...gate2, {
        evidence: [{filePath: 'implementation.mjs', lines: [1]}],
        requirement: 'A second independent requirement from the same source.',
        result: 'satisfied',
        source: gate1[0].source,
    }];
};

const jsonl = (/** @type {unknown[]} */ values) => Buffer.from(`${values.map(value => JSON.stringify(value)).join('\n')}\n`, 'utf8');

const harness = (/** @type {{failures?: Array<{operation: string, path?: string, result: object}>, request?: Buffer, review?: Buffer}} */ {failures = [], request, review = jsonl(rows())} = {}) => {
    const seed = new Map([...shared.seed].map(([path, bytes]) => [path, Buffer.from(bytes)]));
    if (request) seed.set('request.json', Buffer.from(request));
    seed.set('reports/review.jsonl', Buffer.from(review));
    const scopedFilesystemFactory = createScriptedScopedFilesystemFactory({
        failures,
        roots: new Map([[shared.requestDirectory, seed]]),
    });
    return {
        git: createScriptedGitRunner(shared.scripts),
        scopedFilesystemFactory,
        snapshot: () => scopedFilesystemFactory.snapshot(shared.requestDirectory),
    };
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

test('prepare derives isolated single and same-effort requests and rejects invalid authorization, exceptions, and collisions', async () => {
    let caseNumber = 0;
    const execute = async (/** @type {{existing?: Map<string, Buffer>, failures?: Array<{operation: string, path?: string, result: object}>, input: unknown, scripts?: GitScript[]}} */ {existing = new Map(), failures = [], input, scripts = shared.scripts}) => {
        caseNumber += 1;
        const directory = join(shared.repository.root, '.tmp', 'codex', 'prepare-cases', String(caseNumber));
        const seed = new Map([['input.json', Buffer.from(JSON.stringify(input))], ...existing]);
        const scopedFilesystemFactory = createScriptedScopedFilesystemFactory({failures, roots: new Map([[directory, seed]])});
        const inspectReports = async () => {
            const opened = await scopedFilesystemFactory.open({root: directory});
            assert.equal(opened.status, 'succeeded');
            if (opened.status !== 'succeeded') throw new Error('Expected prepared filesystem.');
            const inspected = await opened.scopedFilesystem.inspect({path: 'reports'});
            assert.equal(inspected.status, 'succeeded');
            return inspected.status === 'succeeded' ? inspected.entry.kind : undefined;
        };
        try {
            const result = await prepareCommitAudit({
                git: createScriptedGitRunner(scripts),
                inputPath: join(directory, 'input.json'),
                repositoryRoot: shared.repository.root,
                scopedFilesystemFactory,
            });
            return {inspectReports, result, snapshot: scopedFilesystemFactory.snapshot(directory)};
        } catch (error) {
            return {error, inspectReports, snapshot: scopedFilesystemFactory.snapshot(directory)};
        }
    };
    const succeeds = async (/** @type {unknown} */ input, /** @type {GitScript[]} */ scripts = shared.scripts) => {
        const outcome = await execute({input, scripts});
        assert.equal('error' in outcome, false, 'prepare unexpectedly failed');
        assert.equal(outcome.snapshot.has('request.json'), true);
        assert.deepEqual(outcome.snapshot.get('reports/review.jsonl'), Buffer.alloc(0));
        assert.equal(outcome.result?.requestPath.endsWith('/request.json'), true);
        return JSON.parse(outcome.snapshot.get('request.json')?.toString('utf8') ?? 'null');
    };
    const fails = async (/** @type {unknown} */ input, /** @type {RegExp} */ pattern, /** @type {GitScript[]} */ scripts = shared.scripts) => {
        const outcome = await execute({input, scripts});
        assert.ok(outcome.error instanceof Error);
        assert.match(outcome.error.message, pattern);
        assert.equal(outcome.snapshot.has('request.json'), false);
        assert.equal(outcome.snapshot.has('reports/review.jsonl'), false);
    };

    const multi = await succeeds({authorizingIssueIds: ['issue:0001:01', 'issue:0001:02']});
    assert.deepEqual(multi.authorizingIssueIds, ['issue:0001:01', 'issue:0001:02']);
    assert.equal(multi.gate1.length, 2);
    assert.equal(multi.gate2.length, 1);

    const single = await succeeds({authorizingIssueIds: ['issue:0001:01']}, shared.singleScripts);
    assert.deepEqual(single.authorizingIssueIds, ['issue:0001:01']);
    assert.equal(single.gate1.length, 1);
    assert.deepEqual(single.gate2, []);
    const authorizedNonterminal = await succeeds({authorizingIssueIds: ['issue:0001:01', 'issue:0001:02']}, shared.singleScripts);
    assert.deepEqual(authorizedNonterminal.authorizingIssueIds, ['issue:0001:01', 'issue:0001:02']);
    assert.deepEqual(authorizedNonterminal.gate1.map((/** @type {{issueId: string}} */ scope) => scope.issueId), ['issue:0001:01']);
    assert.deepEqual(authorizedNonterminal.gate2, []);

    await fails({authorizingIssueIds: ['issue:0001:01', 'issue:0002:01']}, /all belong to one effort/);
    await fails({authorizingIssueIds: ['issue:0001:01']}, /terminal issue transition is not authorized/);

    const collision = await execute({
        existing: new Map([['reports/preserve.jsonl', Buffer.from('preserve')]]),
        input: {authorizingIssueIds: ['issue:0001:01', 'issue:0001:02']},
    });
    assert.ok(collision.error instanceof Error);
    assert.match(collision.error.message, /managed file conflict: reports/);
    assert.deepEqual(collision.snapshot, new Map([
        ['input.json', Buffer.from(JSON.stringify({authorizingIssueIds: ['issue:0001:01', 'issue:0001:02']}))],
        ['reports/preserve.jsonl', Buffer.from('preserve')],
    ]));

    await fails({authorizingIssueIds: ['issue:0001:01', 'issue:0001:02']}, /requires gate2Exception/, shared.exceptionScripts);
    const exception = {confirmedAt: '2026-09-10T00:00:00Z', reason: 'No governing requirements apply.'};
    const excepted = await succeeds({authorizingIssueIds: ['issue:0001:01', 'issue:0001:02'], gate2Exception: exception}, shared.exceptionScripts);
    assert.deepEqual(excepted.gate2, [{documents: [], effort: '0001', exception, minimumSourceLines: []}]);

    const malformedExceptions = [
        {confirmedAt: '2026-09-10T00:00:00Z'},
        {...exception, extra: true},
        {...exception, reason: ' '},
        {...exception, confirmedAt: '2026-09-10'},
        [exception, exception],
    ];
    for (const gate2Exception of malformedExceptions) {
        await fails({authorizingIssueIds: ['issue:0001:01', 'issue:0001:02'], gate2Exception}, /gate2Exception/);
    }
    await fails({authorizingIssueIds: ['issue:0001:01', 'issue:0001:02'], gate2Exception: exception}, /conflicts with governing requirements/);
    await fails({authorizingIssueIds: ['issue:0001:01'], gate2Exception: exception}, /not applicable before the effort reaches Gate 2/, shared.singleScripts);

    const rollbackFailure = await execute({
        failures: [
            {operation: 'write', path: 'reports/review.jsonl', result: {diagnostics: [{code: 'draft-refused', message: 'Injected refusal.', path: 'reports/review.jsonl'}], status: 'blocked'}},
            {operation: 'remove', path: 'request.json', result: {diagnostics: [{code: 'rollback-refused', message: 'Injected refusal.', path: 'request.json'}], status: 'blocked'}},
        ],
        input: {authorizingIssueIds: ['issue:0001:01', 'issue:0001:02']},
    });
    assert.ok(rollbackFailure.error instanceof Error);
    assert.match(rollbackFailure.error.message, /review\.jsonl could not be created.*request\.json could not be restored/u);
    assert.equal(rollbackFailure.snapshot.has('request.json'), true);
    assert.equal(rollbackFailure.snapshot.has('reports/review.jsonl'), false);
    assert.equal(await rollbackFailure.inspectReports(), 'missing');

    const malformedDraftWrite = await execute({
        failures: [{operation: 'write', path: 'reports/review.jsonl', result: {diagnostics: [], status: 'succeeded'}}],
        input: {authorizingIssueIds: ['issue:0001:01', 'issue:0001:02']},
    });
    assert.ok(malformedDraftWrite.error instanceof Error);
    assert.match(malformedDraftWrite.error.message, /review\.jsonl creation returned an invalid result/u);
    assert.equal(malformedDraftWrite.snapshot.has('request.json'), false);
    assert.equal(malformedDraftWrite.snapshot.has('reports/review.jsonl'), false);
    assert.equal(await malformedDraftWrite.inspectReports(), 'missing');

    const extraListField = await execute({
        failures: [{operation: 'list', path: '.', result: {diagnostics: [], entries: [{extra: true, kind: 'file', path: 'input.json'}], status: 'succeeded'}}],
        input: {authorizingIssueIds: ['issue:0001:01', 'issue:0001:02']},
    });
    assert.ok(extraListField.error instanceof Error);
    assert.match(extraListField.error.message, /inspection returned an invalid result/u);

    const invalidListings = [
        [{kind: 'file', path: '..'}],
        [{kind: 'file', path: '../request.json'}],
        [{kind: 'file', path: 'nested/request.json'}],
        [{kind: 'file', path: './request.json'}],
        [{kind: 'file', path: 'input.json'}, {kind: 'file', path: 'input.json'}],
        [{kind: 'file', path: 'z.txt'}, {kind: 'file', path: 'input.json'}],
    ];
    for (const entries of invalidListings) {
        const outcome = await execute({
            failures: [{operation: 'list', path: '.', result: {diagnostics: [], entries, status: 'succeeded'}}],
            input: {authorizingIssueIds: ['issue:0001:01', 'issue:0001:02']},
        });
        assert.ok(outcome.error instanceof Error);
        assert.match(outcome.error.message, /inspection returned an invalid result/u);
        assert.equal(outcome.snapshot.has('request.json'), false);
        assert.equal(outcome.snapshot.has('reports/review.jsonl'), false);
    }
});

test('prepare rejects mechanically identifiable changed artifacts from another effort', async t => {
    const cases = [
        {kind: 'issue', path: '.scratch/0002-other/issues/01-pending.md'},
        {kind: 'spec', path: '.scratch/0002-other/spec.md'},
        {kind: 'unregistered', path: '.scratch/0002-other/notes.txt'},
    ];
    for (const scenario of cases) {
        const repository = await createRepository(t);
        await writeArtifact(repository.root, '0001-workflow', 'spec.md', specification);
        await writeIssue(repository.root, '0001-workflow', '01-current.md', issueText('ready-for-agent'));
        await commitAll(repository.root, 'initial candidate');
        await writeIssue(repository.root, '0001-workflow', '01-current.md', issueText('completed'));
        if (scenario.kind === 'issue') await writeIssue(repository.root, '0002-other', '01-pending.md', issueText('ready-for-agent'));
        else if (scenario.kind === 'spec') await writeArtifact(repository.root, '0002-other', 'spec.md', '# Other effort\n');
        else {
            await mkdir(join(repository.root, '.scratch', '0002-other'), {recursive: true});
            await writeFile(join(repository.root, scenario.path), 'Unregistered effort file.\n', 'utf8');
        }
        await runGit(repository.root, ['add', '.scratch']);
        const directory = join(repository.root, '.tmp', 'codex', `cross-effort-${scenario.kind}`);
        const inputPath = join(directory, 'input.json');
        await mkdir(directory, {recursive: true});
        await writeFile(inputPath, JSON.stringify({authorizingIssueIds: ['issue:0001:01']}), 'utf8');
        await assert.rejects(
            prepareCommitAudit({inputPath, repositoryRoot: repository.root}),
            new RegExp(`another effort: ${scenario.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
        );
        await assert.rejects(readFile(join(directory, 'request.json')), {code: 'ENOENT'});
        await assert.rejects(readFile(join(directory, 'reports', 'review.jsonl')), {code: 'ENOENT'});
    }
});

test('prepare accepts a changed effort artifact from the authorized effort', async t => {
    const repository = await createRepository(t);
    await writeArtifact(repository.root, '0001-workflow', 'spec.md', specification);
    await writeIssue(repository.root, '0001-workflow', '01-current.md', issueText('ready-for-agent'));
    await commitAll(repository.root, 'initial same-effort candidate');
    await writeArtifact(repository.root, '0001-workflow', 'spec.md', `${specification}Fourteenth requirement.\n`);
    await writeFile(join(repository.root, '.scratch', '0001-workflow', 'notes.txt'), 'Unregistered same-effort file.\n', 'utf8');
    await writeIssue(repository.root, '0001-workflow', '01-current.md', issueText('completed'));
    await runGit(repository.root, ['add', '.scratch']);
    const directory = join(repository.root, '.tmp', 'codex', 'same-effort');
    const inputPath = join(directory, 'input.json');
    await mkdir(directory, {recursive: true});
    await writeFile(inputPath, JSON.stringify({authorizingIssueIds: ['issue:0001:01']}), 'utf8');
    const prepared = await prepareCommitAudit({inputPath, repositoryRoot: repository.root});
    assert.equal(prepared.requestPath, join(directory, 'request.json'));
});



test('Node Adapters prepare, generate, and verify records without adding issue requirements', async () => {
    assert.equal(shared.request.draftPath, join(shared.requestDirectory, 'reports', 'review.jsonl'));
    assert.deepEqual(shared.request.authorizingIssueIds, ['issue:0001:01', 'issue:0001:02']);
    assert.deepEqual(shared.request.gate2[0].minimumSourceLines, [{count: 5, filePath: '.scratch/0001-workflow/spec.md'}]);
    await writeFile(shared.request.draftPath, jsonl(rows()));
    const generated = await generateCommitAudit({repositoryRoot: shared.repository.root, requestPath: shared.requestPath});
    assert.deepEqual(generated, {files: [
        {sourcePath: '.tmp/codex/shared-request/01.audit.json', targetPath: '.scratch/0001-workflow/issues/01.audit.json'},
        {sourcePath: '.tmp/codex/shared-request/02.audit.json', targetPath: '.scratch/0001-workflow/issues/02.audit.json'},
        {sourcePath: '.tmp/codex/shared-request/spec-audit.json', targetPath: '.scratch/0001-workflow/spec-audit.json'},
    ]});
    const gate2 = JSON.parse(await readFile(join(shared.requestDirectory, 'spec-audit.json'), 'utf8'));
    assert.deepEqual(gate2.requirements[0].evidence, [
        {command: 'node --test', exitCode: -1},
        {filePath: 'implementation.mjs', lines: [[1, 4], 6]},
    ]);
    const scripted = harness();
    const scriptedGenerated = await generateCommitAudit({repositoryRoot: shared.repository.root, requestPath: shared.requestPath, ...scripted});
    assert.deepEqual(scriptedGenerated, generated);
    if ('files' in generated) {
        for (const file of generated.files) {
            const name = file.sourcePath.split('/').at(-1);
            assert.ok(name);
            assert.deepEqual(scripted.snapshot().get(name), await readFile(join(shared.requestDirectory, name)));
        }
    }

    const issuePath = '.scratch/0001-workflow/issues/01-first.md';
    const recordedIssue = issueText('completed') + recordSections;
    assert.equal((await runGit(shared.repository.root, ['show', `:${issuePath}`])).stdout, issueText('completed'));
    const fixedIndex = (await runGit(shared.repository.root, ['ls-files', '--stage', '-z'])).stdout;
    const directory = join(shared.repository.root, '.tmp', 'codex', 'record-request');
    const inputPath = join(directory, 'input.json');
    await mkdir(directory, {recursive: true});
    await writeFile(inputPath, JSON.stringify({authorizingIssueIds: shared.request.authorizingIssueIds}), 'utf8');
    const prepared = await prepareCommitAudit({inputPath, repositoryRoot: shared.repository.root});
    const fixedRequest = await readFile(prepared.requestPath);
    const request = JSON.parse(fixedRequest.toString('utf8'));
    assert.deepEqual(request.gate1, shared.request.gate1);
    assert.deepEqual(request.gate2, shared.request.gate2);
    assert.deepEqual(request.gate1[0].requirements, [7, 17].map(line => ({filePath: issuePath, line})));
    await writeFile(join(shared.repository.root, issuePath), recordedIssue, 'utf8');
    assert.equal((await runGit(shared.repository.root, ['ls-files', '--stage', '-z'])).stdout, fixedIndex);
    assert.deepEqual(await readFile(prepared.requestPath), fixedRequest);
    assert.deepEqual(await readFile(request.draftPath), Buffer.alloc(0));
    await writeFile(request.draftPath, jsonl(rows()));
    await runGit(shared.repository.root, ['add', issuePath]);
    await writeFile(join(shared.repository.root, 'implementation.mjs'), 'Unstaged replacement.\n', 'utf8');
    await writeFile(join(shared.repository.root, issuePath), recordedIssue.replace('Implement.', 'Unstaged requirement.\nAnother unstaged requirement.'), 'utf8');
    const current = await generateCommitAudit({repositoryRoot: shared.repository.root, requestPath: prepared.requestPath});
    assert.ok('files' in current);
    if (!('files' in current)) return;
    for (const file of current.files) {
        const bytes = await readFile(join(shared.repository.root, file.sourcePath));
        assert.deepEqual(bytes, await readFile(join(shared.requestDirectory, file.sourcePath.split('/').at(-1) ?? '')));
        await writeFile(join(shared.repository.root, file.targetPath), bytes);
    }
    await runGit(shared.repository.root, ['add', ...current.files.map(file => file.targetPath)]);
    const verified = await run(['commit-audit', 'verify'], shared.repository);
    assert.equal(verified.result, 0, verified.events.map(event => event.message).join('\n'));
    assert.equal((await runGit(shared.repository.root, ['show', `:${issuePath}`])).stdout, recordedIssue);
    assert.equal(await readFile(join(shared.repository.root, 'implementation.mjs'), 'utf8'), 'Unstaged replacement.\n');
    assert.match(await readFile(join(shared.repository.root, issuePath), 'utf8'), /Another unstaged requirement/);
});

test('CLI prepare and generate expose exact stdout and structured failure stderr', async () => {
    const directory = join(shared.repository.root, '.tmp', 'codex', 'cli-boundary');
    const inputPath = join(directory, 'input.json');
    const requestPath = join(directory, 'request.json');
    const scopedFilesystemFactory = createScriptedScopedFilesystemFactory({
        roots: new Map([[directory, new Map([['input.json', Buffer.from(JSON.stringify({authorizingIssueIds: ['issue:0001:01', 'issue:0001:02']}))]])]]),
    });
    const prepared = await run(['commit-audit', 'prepare', '--input', inputPath], shared.repository, {
        commitAuditDependencies: {git: createScriptedGitRunner(shared.scripts), scopedFilesystemFactory},
    });
    assert.deepEqual(prepared, {events: [{channel: 'stdout', message: requestPath}], result: 0});

    const opened = await scopedFilesystemFactory.open({root: directory});
    assert.equal(opened.status, 'succeeded');
    if (opened.status !== 'succeeded') return;
    assert.equal((await opened.scopedFilesystem.write({bytes: jsonl(rows()), mode: 'replace', path: 'reports/review.jsonl'})).status, 'succeeded');
    const generated = await run(['commit-audit', 'generate', '--request', requestPath], shared.repository, {
        commitAuditDependencies: {git: createScriptedGitRunner(shared.scripts), scopedFilesystemFactory},
    });
    assert.equal(generated.result, 0);
    assert.equal(generated.events.length, 1);
    assert.equal(generated.events[0].channel, 'stdout');
    assert.equal(JSON.parse(generated.events[0].message).files.length, 3);

    assert.equal((await opened.scopedFilesystem.write({bytes: Buffer.from('{bad}\n'), mode: 'replace', path: 'reports/review.jsonl'})).status, 'succeeded');
    const invalid = await run(['commit-audit', 'generate', '--request', requestPath], shared.repository, {
        commitAuditDependencies: {git: createScriptedGitRunner(shared.scripts), scopedFilesystemFactory},
    });
    assert.equal(invalid.result, 1);
    assert.equal(invalid.events.length, 1);
    assert.equal(invalid.events[0].channel, 'stderr');
    assert.deepEqual(JSON.parse(invalid.events[0].message), {
        diagnostics: [{code: 'review-json-invalid', line: 1, message: 'Each nonblank review line must contain one JSON object.'}],
        kind: 'review-output-invalid',
        phase: 'review-syntax',
        status: 'failed',
    });
});

test('strict validation uses one phased implementation for syntax, coverage, and evidence cases', async () => {
    const valid = await validateCommitAuditReview({
        repositoryRoot: shared.repository.root,
        requestPath: shared.requestPath,
        ...harness(),
    });
    assert.equal(valid.status, 'succeeded');
    if (valid.status !== 'succeeded') return;
    assert.equal(valid.rows.filter(row => row.source.filePath === shared.request.gate1[0].requirements[0].filePath && row.source.line === shared.request.gate1[0].requirements[0].line).length, 2);
    assert.equal(valid.records.length, 3);

    const requestFailure = await validateCommitAuditReview({
        repositoryRoot: shared.repository.root,
        requestPath: shared.requestPath,
        ...harness({request: Buffer.from(JSON.stringify({...shared.request, unexpected: true}))}),
    });
    assert.equal(requestFailure.status, 'failed');
    if (requestFailure.status === 'failed') assert.equal(requestFailure.phase, 'request');

    const candidateHarness = harness();
    const candidateScripts = shared.scripts.map(script => script.argv.includes('--stage')
        ? {...script, result: {code: 1, failure: null, stderr: 'injected failure', stdout: Buffer.alloc(0)}}
        : script);
    candidateHarness.git = createScriptedGitRunner(candidateScripts);
    const candidateFailure = await validateCommitAuditReview({repositoryRoot: shared.repository.root, requestPath: shared.requestPath, ...candidateHarness});
    assert.equal(candidateFailure.status, 'failed');
    if (candidateFailure.status === 'failed') assert.equal(candidateFailure.phase, 'candidate-preconditions');

    const invalidEvidenceRows = rows();
    invalidEvidenceRows[0] = {...invalidEvidenceRows[0], evidence: []};
    invalidEvidenceRows[1] = {...invalidEvidenceRows[1], evidence: [], finding: 'Uncertain.', result: 'uncertain'};
    const syntaxCases = [
        {expectedCodes: ['review-json-invalid', 'review-row-invalid'], review: Buffer.from('{bad}\n[]\n')},
        {expectedCodes: ['review-row-invalid', 'review-row-invalid'], review: jsonl(invalidEvidenceRows)},
        {expectedCodes: ['review-row-invalid'], review: jsonl(rows().map((row, index) => index === 0 ? {...row, evidence: [{command: 'test', exitCode: 0.5}]} : row))},
        {expectedCodes: ['review-row-invalid'], review: jsonl(rows().map((row, index) => index === 0 ? {...row, source: {...row.source, line: Number.MAX_SAFE_INTEGER + 1}} : row))},
        {expectedCodes: ['review-row-invalid'], review: jsonl(rows().map((row, index) => index === 0 ? {...row, evidence: [{filePath: 'implementation.mjs', lines: [Number.MAX_SAFE_INTEGER + 1]}]} : row))},
        {expectedCodes: ['review-row-invalid'], review: jsonl(rows().map((row, index) => index === 0 ? {...row, evidence: [{command: 'test', exitCode: Number.MAX_SAFE_INTEGER + 1}]} : row))},
    ];
    for (const scenario of syntaxCases) {
        const result = await validateCommitAuditReview({repositoryRoot: shared.repository.root, requestPath: shared.requestPath, ...harness({review: scenario.review})});
        assert.equal(result.status, 'failed');
        if (result.status !== 'failed') continue;
        assert.equal(result.phase, 'review-syntax');
        assert.deepEqual(result.diagnostics.map(item => item.code), scenario.expectedCodes);
        assert.equal(isCommitAuditReviewOutputInvalid(result), true);
    }

    const incomplete = rows().slice(0, -2);
    incomplete.push({...incomplete[0], evidence: [{filePath: 'missing.mjs', lines: [999]}]});
    const coverage = await validateCommitAuditReview({repositoryRoot: shared.repository.root, requestPath: shared.requestPath, ...harness({review: jsonl(incomplete)})});
    assert.equal(coverage.status, 'failed');
    if (coverage.status === 'failed') {
        assert.equal(coverage.phase, 'requirement-coverage');
        assert.ok(coverage.diagnostics.filter(item => item.code === 'requirement-missing').length >= 1);
        assert.ok(coverage.diagnostics.some(item => item.code === 'requirement-conflicting'));
        assert.equal(isCommitAuditReviewOutputInvalid(coverage), true);
    }

    const invalidSourceRows = rows();
    const gate2Document = shared.request.gate2[0].documents[0];
    const gate2Indexes = invalidSourceRows.flatMap((row, index) => row.source.filePath === gate2Document ? [index] : []);
    invalidSourceRows[gate2Indexes[0]] = {...invalidSourceRows[gate2Indexes[0]], source: {filePath: gate2Document, line: 1}};
    invalidSourceRows[gate2Indexes[1]] = {...invalidSourceRows[gate2Indexes[1]], source: {filePath: gate2Document, line: 999}};
    const invalidSources = await generateCommitAudit({repositoryRoot: shared.repository.root, requestPath: shared.requestPath, ...harness({review: jsonl(invalidSourceRows)})});
    assert.ok('status' in invalidSources);
    if ('status' in invalidSources) {
        assert.equal(invalidSources.phase, 'requirement-coverage');
        assert.equal('files' in invalidSources, false);
        assert.equal(invalidSources.diagnostics.filter(item => item.code === 'requirement-source-invalid').length, 2);
        assert.ok(invalidSources.diagnostics.some(item => item.code === 'requirement-missing'));
    }

    const badEvidence = rows().map((row, index) => index === 0 ? {...row, evidence: [{filePath: 'missing.mjs', lines: [[1, 3]]}]} : row);
    const evidence = await validateCommitAuditReview({repositoryRoot: shared.repository.root, requestPath: shared.requestPath, ...harness({review: jsonl(badEvidence)})});
    assert.equal(evidence.status, 'failed');
    if (evidence.status === 'failed') {
        assert.equal(evidence.phase, 'evidence');
        assert.equal(isCommitAuditReviewOutputInvalid(evidence), true);
    }
});



test('Scripted Adapters preserve Git and filesystem contracts and output transaction outcomes', async () => {
    const blocked = (/** @type {string} */ code, /** @type {string} */ path, /** @type {string} */ message = 'Injected refusal.') => ({diagnostics: [{code, message, path}], status: 'blocked'});
    const scriptedGit = createScriptedGitRunner(shared.scripts);
    const firstScript = shared.scripts[0];
    const scriptedResult = await scriptedGit.run({argv: firstScript.argv, ...(firstScript.input === undefined ? {} : {input: firstScript.input})});
    assert.deepEqual(scriptedResult, firstScript.result);
    scriptedResult.stdout.fill(0);
    assert.deepEqual(firstScript.result.stdout, shared.scripts[0].result.stdout);

    const hardLinked = createScriptedScopedFilesystemFactory({
        hardLinks: new Map([[shared.requestDirectory, new Set(['request.json'])]]),
        roots: new Map([[shared.requestDirectory, new Map([['request.json', Buffer.from('{}')]])]]),
    });
    await assert.rejects(hardLinked.open({root: 'relative'}), TypeError);
    const hardLinkedRoot = await hardLinked.open({root: shared.requestDirectory});
    assert.equal(hardLinkedRoot.status, 'succeeded');
    if (hardLinkedRoot.status !== 'succeeded') return;
    assert.equal((await hardLinkedRoot.scopedFilesystem.inspect({path: '../escape'})).status, 'blocked');
    assert.equal((await hardLinkedRoot.scopedFilesystem.inspect({path: 'request.json'})).status, 'succeeded');
    const hardInspect = await hardLinkedRoot.scopedFilesystem.inspect({path: 'request.json', rejectHardLinks: true});
    const hardRead = await hardLinkedRoot.scopedFilesystem.read({path: 'request.json', rejectHardLinks: true});
    assert.deepEqual(hardInspect, blocked('filesystem-hard-link-unsupported', 'request.json', 'Hard linked files are not supported.'));
    assert.deepEqual(hardRead, blocked('filesystem-hard-link-unsupported', 'request.json', 'Hard linked files are not supported.'));

    const refusedOpen = createScriptedScopedFilesystemFactory({
        failures: [{operation: 'open', path: shared.requestDirectory, result: blocked('open-refused', shared.requestDirectory)}],
    });
    assert.deepEqual(await refusedOpen.open({root: shared.requestDirectory}), blocked('open-refused', shared.requestDirectory));
    const refusedRead = createScriptedScopedFilesystemFactory({
        failures: [{operation: 'read', path: 'request.json', result: blocked('read-refused', 'request.json')}],
        roots: new Map([[shared.requestDirectory, new Map([['request.json', Buffer.from('{}')]])]]),
    });
    const refusedReadRoot = await refusedRead.open({root: shared.requestDirectory});
    assert.equal(refusedReadRoot.status, 'succeeded');
    if (refusedReadRoot.status !== 'succeeded') return;
    assert.deepEqual(await refusedReadRoot.scopedFilesystem.read({path: 'request.json'}), blocked('read-refused', 'request.json'));

    const successful = harness();
    const generated = await generateCommitAudit({repositoryRoot: shared.repository.root, requestPath: shared.requestPath, ...successful});
    assert.ok('files' in generated);
    if (!('files' in generated)) return;
    assert.deepEqual(generated.files.map(file => file.targetPath), [
        '.scratch/0001-workflow/issues/01.audit.json',
        '.scratch/0001-workflow/issues/02.audit.json',
        '.scratch/0001-workflow/spec-audit.json',
    ]);
    const first = successful.snapshot();
    const repeated = await generateCommitAudit({
        git: createScriptedGitRunner(shared.scripts),
        repositoryRoot: shared.repository.root,
        requestPath: shared.requestPath,
        scopedFilesystemFactory: successful.scopedFilesystemFactory,
    });
    assert.deepEqual(repeated, generated);
    assert.equal(new Set(generated.files.map(file => file.sourcePath)).size, 3);
    assert.equal(new Set(generated.files.map(file => file.targetPath)).size, 3);
    assert.equal(first.has('01.audit.json'), true);

    const revisedRows = rows();
    revisedRows[0] = {...revisedRows[0], finding: 'A concrete gap.', result: 'gap'};
    const opened = await successful.scopedFilesystemFactory.open({root: shared.requestDirectory});
    assert.equal(opened.status, 'succeeded');
    if (opened.status !== 'succeeded') return;
    assert.equal((await opened.scopedFilesystem.write({bytes: jsonl(revisedRows), mode: 'replace', path: 'reports/review.jsonl'})).status, 'succeeded');
    const revisedResult = await generateCommitAudit({
        git: createScriptedGitRunner(shared.scripts),
        repositoryRoot: shared.repository.root,
        requestPath: shared.requestPath,
        scopedFilesystemFactory: successful.scopedFilesystemFactory,
    });
    assert.ok('files' in revisedResult);
    if ('files' in revisedResult) assert.deepEqual(revisedResult.files, generated.files);
    const revisedGate1 = successful.snapshot().get('01.audit.json');
    assert.ok(revisedGate1);
    assert.equal(JSON.parse(revisedGate1.toString('utf8')).result, 'gap');

    const transactionCases = [
        {expectedKind: 'output-write-failed', failures: [{operation: 'inspect', path: '01.audit.json', result: blocked('preflight-blocked', '01.audit.json')}], remaining: []},
        {expectedDiagnosticPath: '01.audit.json', expectedKind: 'generation-failed', failures: [{operation: 'inspect', path: '01.audit.json', result: {diagnostics: [], entry: {extra: true, kind: 'missing', path: '01.audit.json'}, status: 'succeeded'}}], remaining: []},
        {expectedKind: 'output-write-failed', failures: [{operation: 'write', path: 'spec-audit.json', result: blocked('application-blocked', 'spec-audit.json')}], remaining: []},
        {expectedDiagnosticPath: 'spec-audit.json', expectedKind: 'generation-failed', failures: [{operation: 'write', path: 'spec-audit.json', result: {diagnostics: [], status: 'succeeded'}}], remaining: []},
        {expectedDiagnosticPath: 'spec-audit.json', expectedKind: 'generation-failed', failures: [{operation: 'write', path: 'spec-audit.json', result: {diagnostics: [], extra: true, path: 'spec-audit.json', status: 'succeeded'}}], remaining: []},
        {expectedDiagnosticPath: '02.audit.json', expectedKind: 'generation-failed', failures: [
            {operation: 'write', path: 'spec-audit.json', result: blocked('application-blocked', 'spec-audit.json')},
            {operation: 'remove', path: '02.audit.json', result: {diagnostics: [], path: '02.audit.json', status: 'succeeded'}},
        ], remaining: ['02.audit.json']},
        {expectedDiagnosticPath: '02.audit.json', expectedKind: 'generation-failed', failures: [
            {operation: 'write', path: 'spec-audit.json', result: blocked('application-blocked', 'spec-audit.json')},
            {operation: 'remove', path: '02.audit.json', result: {diagnostics: [], extra: true, path: '02.audit.json', removed: true, status: 'succeeded'}},
        ], remaining: ['02.audit.json']},
        {expectedDiagnosticPath: '02.audit.json', expectedKind: 'generation-failed', failures: [
            {operation: 'write', path: 'spec-audit.json', result: blocked('application-blocked', 'spec-audit.json')},
            {operation: 'remove', path: '02.audit.json', result: blocked('rollback-blocked', '02.audit.json')},
        ], remaining: ['02.audit.json']},
    ];
    for (const scenario of transactionCases) {
        const isolated = harness({failures: scenario.failures});
        const result = await generateCommitAudit({repositoryRoot: shared.repository.root, requestPath: shared.requestPath, ...isolated});
        assert.ok('kind' in result);
        if ('kind' in result) {
            assert.equal(result.kind, scenario.expectedKind);
            assert.equal('files' in result, false);
            if (scenario.expectedKind === 'generation-failed') assert.ok(result.diagnostics.some(item => item.path === scenario.expectedDiagnosticPath));
        }
        const outputNames = () => [...isolated.snapshot().keys()].filter(path => path.endsWith('.audit.json') || path === 'spec-audit.json').sort();
        assert.deepEqual(outputNames(), scenario.remaining);
        if (scenario.expectedKind === 'generation-failed') {
            const retry = await generateCommitAudit({
                git: createScriptedGitRunner(shared.scripts),
                repositoryRoot: shared.repository.root,
                requestPath: shared.requestPath,
                scopedFilesystemFactory: isolated.scopedFilesystemFactory,
            });
            assert.ok('files' in retry);
            if ('files' in retry) assert.deepEqual(retry.files, generated.files);
            assert.deepEqual(outputNames(), ['01.audit.json', '02.audit.json', 'spec-audit.json']);
        }
    }
});

test('current verify rejects old locators while ignoring unrelated historical records', async t => {
    const repository = await createRepository(t);
    const initial = issueText('ready-for-agent');
    await writeArtifact(repository.root, '0001-workflow', 'spec.md', specification);
    await writeIssue(repository.root, '0001-workflow', '01-current.md', initial);
    await writeIssue(repository.root, '0002-history', '01-history.md', issueText('completed'));
    await writeFile(join(repository.root, '.scratch', '0002-history', 'issues', '01.audit.json'), '{not json}\n', 'utf8');
    await writeFile(join(repository.root, 'implementation.mjs'), implementation, 'utf8');
    await commitAll(repository.root, 'initial records');
    await writeIssue(repository.root, '0001-workflow', '01-current.md', issueText('completed') + recordSections);
    const currentPath = '.scratch/0001-workflow/issues/01-current.md';
    const requirementLines = shared.request.gate1[0].requirements.map((/** @type {{line: number}} */ source) => source.line);
    await writeJsonRecord(repository.root, '.scratch/0001-workflow/issues/01.audit.json', {
        requirements: requirementLines.map((/** @type {number} */ line) => ({
            evidence: [{filePath: 'implementation.mjs', lines: [1]}],
            requirement: `Requirement ${line}.`, result: 'satisfied', source: {filePath: currentPath, line},
        })), result: 'satisfied',
    });
    await writeJsonRecord(repository.root, '.scratch/0001-workflow/spec-audit.json', {
        documents: ['.scratch/0001-workflow/spec.md'],
        requirements: [3, 4, 5, 6, 7].map(line => ({
            evidence: [{filePath: 'implementation.mjs', lines: [line - 2]}],
            requirement: `Requirement ${line}.`, result: 'satisfied', source: {filePath: '.scratch/0001-workflow/spec.md', line},
        })),
        result: 'satisfied',
    });
    await runGit(repository.root, ['add', '.']);
    const accepted = await run(['commit-audit', 'verify'], repository);
    assert.equal(accepted.result, 0, accepted.events.map(event => event.message).join('\n'));
    const gate1Path = '.scratch/0001-workflow/issues/01.audit.json';
    const gate2Path = '.scratch/0001-workflow/spec-audit.json';
    const validGate1 = JSON.parse(await readFile(join(repository.root, gate1Path), 'utf8'));
    const validGate2 = JSON.parse(await readFile(join(repository.root, gate2Path), 'utf8'));
    const old = structuredClone(validGate1);
    old.requirements[0].evidence = [{filePath: 'implementation.mjs', line: 1}];
    await writeJsonRecord(repository.root, gate1Path, old);
    await runGit(repository.root, ['add', gate1Path]);
    const rejected = await run(['commit-audit', 'verify'], repository);
    assert.equal(rejected.result, 1);
    assert.match(rejected.events[0].message, /unknown or missing fields/);

    await writeJsonRecord(repository.root, gate1Path, validGate1);
    const headingSource = structuredClone(validGate2);
    headingSource.requirements[0].source.line = 1;
    await writeJsonRecord(repository.root, gate2Path, headingSource);
    await runGit(repository.root, ['add', gate1Path, gate2Path]);
    const invalidGate2Source = await run(['commit-audit', 'verify'], repository);
    assert.equal(invalidGate2Source.result, 1);
    assert.match(invalidGate2Source.events[0].message, /Gate 2 source line is not a governing document body line/);

    const evidenceCases = [
        {path: gate1Path, record: validGate1, result: 'gap'},
        {path: gate2Path, record: validGate2, result: 'uncertain'},
    ];
    for (const scenario of evidenceCases) {
        await writeJsonRecord(repository.root, gate1Path, validGate1);
        await writeJsonRecord(repository.root, gate2Path, validGate2);
        const invalid = structuredClone(scenario.record);
        invalid.requirements[0] = {...invalid.requirements[0], evidence: [], finding: 'Finding.', result: scenario.result};
        invalid.result = scenario.result;
        await writeJsonRecord(repository.root, scenario.path, invalid);
        await runGit(repository.root, ['add', gate1Path, gate2Path]);
        const evidenceRejected = await run(['commit-audit', 'verify'], repository);
        assert.equal(evidenceRejected.result, 1);
        assert.match(evidenceRejected.events[0].message, /evidence must be non-empty/);
    }

    await writeJsonRecord(repository.root, gate1Path, validGate1);
    await writeJsonRecord(repository.root, gate2Path, validGate2);
    for (const changedIssue of [
        issueText('completed').replace('Implement.', 'Implement.\nAdditional implementation requirement.'),
        issueText('completed').replace('- [ ] Complete.', '- [ ] Complete.\n- [ ] Additional acceptance requirement.'),
    ]) {
        await writeFile(join(repository.root, currentPath), changedIssue + recordSections, 'utf8');
        await runGit(repository.root, ['add', currentPath, gate1Path, gate2Path]);
        const missingRequirement = await run(['commit-audit', 'verify'], repository);
        assert.equal(missingRequirement.result, 1);
        assert.match(missingRequirement.events[0].message, /Gate 1 record does not cover issue requirement line/);
    }
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
