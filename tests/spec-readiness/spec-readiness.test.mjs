import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import test from 'node:test';

import {createRepository as createGitRepository} from '../helpers/repository-fixture.mjs';
import {
    generateSpecReadiness,
    prepareSpecReadiness,
    promoteSpecReadiness,
    verifySpecReadiness,
} from '../../lib/spec-readiness/spec-readiness.mjs';

const adapter = {getCurrentAgentIdentity: () => ({platform: 'codex', sessionId: 'readiness-test'})};
const digest = (/** @type {import("crypto").BinaryLike} */ value) => createHash('sha256').update(value).digest('hex');
const readinessPath = (/** @type {string} */ repositoryRoot, issueNumber = '01') => join(
    repositoryRoot,
    '.scratch',
    '0001-workflow',
    'issues',
    `${issueNumber}.spec-readiness.json`,
);
const fullSpec = '# Test spec\n\n## Module Design\n\n### Modules\n\nOwn behavior.\n\n### Interfaces\n\nInput and output.\n\n### Seams and Adapters\n\nVariation.\n\n### Dependencies and Data Flow\n\nFlow.\n\n### Module Design Rationale\n\nTradeoff.\n\n### ADR Evaluation\n\nNone.\n';
const normalInputs = [{filePath: '.scratch/0001-workflow/spec.md', role: 'governing-spec'}];
const selectedRequirements = 'Governing requirements:\n\n- `.scratch/0001-workflow/spec.md#module-design`';
const readinessSubject = (/** @type {string} */ requirements) => `## What to build

Implement.

## Spec Requirement

${requirements}

## Acceptance criteria

- [ ] Complete.

`;
const issue = (/** @type {string} */ requirements) => `# Implement workflow

Status: ready-for-agent

${readinessSubject(requirements)}## Validation

- Not run.

## Blocked by

- None

## Comments

- No comments.
`;

const createRepository = async (/** @type {test.TestContext} */ t) => {
    const root = await createGitRepository(t, {prefix: 'arw-readiness-json-'});
    await mkdir(join(root, '.scratch', '0001-workflow', 'issues'), {recursive: true});
    await mkdir(join(root, 'docs', 'agents', 'roles'), {recursive: true});
    await writeFile(join(root, '.scratch', '0001-workflow', 'spec.md'), fullSpec, 'utf8');
    await writeFile(join(root, 'docs', 'agents', 'roles', 'spec-readiness-reviewer.md'), '# Reviewer\n', 'utf8');
    await writeFile(join(root, 'docs', 'agents', 'reviewer.md'), '# Reviewer rules\n', 'utf8');
    await writeFile(join(root, '.scratch', '0001-workflow', 'issues', '01-implement.md'), issue(selectedRequirements), 'utf8');
    return root;
};

/** @param {string} repositoryRoot @param {{inputs: {filePath: string, role: string}[]}} [input] */
const prepare = (repositoryRoot, input = {inputs: normalInputs}) => prepareSpecReadiness({input, issueId: 'issue:0001:01', platformAdapter: adapter, repositoryRoot});

/** The Reviewer txt report: `No problems.` or one natural-language problem per item. */
const report = (/** @type {string[]} */ problems) => problems.length === 0 ? 'No problems.\n' : `${problems.map(problem => `- ${problem}`).join('\n')}\n`;

/** @param {string} repositoryRoot @param {string} draftPath @param {string[]} [problems] */
const generate = async (repositoryRoot, draftPath, problems = []) => {
    await writeFile(draftPath, report(problems), 'utf8');
    return generateSpecReadiness({
        inputPath: draftPath,
        issueId: 'issue:0001:01',
        platformAdapter: adapter,
        repositoryRoot,
    });
};

const generateException = async (/** @type {string} */ repositoryRoot, /** @type {{ exception: { confirmedAt: string; reason: string; }; inferred?: undefined; } | { exception: { confirmedAt: string; reason: string; }; inferred: boolean; }} */ draft) => {
    const inputPath = join(
        repositoryRoot,
        '.tmp',
        'codex',
        'readiness-test',
        '0001_01',
        'spec-readiness',
        'exception-drafts',
        `draft-${randomUUID()}.json`,
    );
    await mkdir(dirname(inputPath), {recursive: true});
    await writeFile(inputPath, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
    return generateSpecReadiness({
        inputPath,
        issueId: 'issue:0001:01',
        platformAdapter: adapter,
        repositoryRoot,
    });
};

const complete = async (/** @type {string} */ repositoryRoot) => {
    const prepared = await prepare(repositoryRoot);
    const generated = await generate(repositoryRoot, prepared.draftPath);
    const promoted = await promoteSpecReadiness({inputPath: generated.path, platformAdapter: adapter, repositoryRoot});
    return {generated, prepared, promoted};
};

test('complete lifecycle preserves Reviewer checkbox content while checkbox state does not change subject identity', async t => {
    const repositoryRoot = await createRepository(t);
    const issuePath = join(repositoryRoot, '.scratch', '0001-workflow', 'issues', '01-implement.md');
    const checked = issue(selectedRequirements).replace('- [ ] Complete.', '- [X] Complete.');
    await writeFile(issuePath, checked, 'utf8');
    const prepared = await prepare(repositoryRoot);
    const request = JSON.parse(await readFile(prepared.path, 'utf8'));

    assert.equal(request.subject.content, readinessSubject(selectedRequirements).replace('- [ ] Complete.', '- [X] Complete.'));
    assert.equal(request.subject.sha256, digest(readinessSubject(selectedRequirements)));
    assert.notEqual(request.subject.sha256, digest(request.subject.content));

    const generated = await generate(repositoryRoot, prepared.draftPath);
    await writeFile(issuePath, checked.replace('- [X] Complete.', '- [ ] Complete.'), 'utf8');
    await promoteSpecReadiness({inputPath: generated.path, platformAdapter: adapter, repositoryRoot});
    await writeFile(issuePath, checked.replace('- [X] Complete.', '- [x] Complete.'), 'utf8');
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {
        authorized: true,
        findings: [],
    });

    await writeFile(issuePath, checked.replace('Complete.', 'Changed criterion.'), 'utf8');
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {
        authorized: false,
        findings: ['Stale Spec Readiness subject: .scratch/0001-workflow/issues/01-implement.md.'],
    });
});

test('each implementation issue owns an independent Spec Readiness sidecar', async t => {
    const repositoryRoot = await createRepository(t);
    const first = await complete(repositoryRoot);
    await writeFile(
        join(repositoryRoot, '.scratch', '0001-workflow', 'issues', '02-another.md'),
        issue('Governing requirements:\n\n- `.scratch/0001-workflow/spec.md#module-design`'),
        'utf8',
    );
    const {roundDirectory} = await prepareSpecReadiness({input: {inputs: normalInputs}, issueId: 'issue:0001:02', platformAdapter: adapter, repositoryRoot});
    const draftPath = join(roundDirectory, 'report', 'draft.txt');
    await writeFile(draftPath, report([]), 'utf8');
    const generated = await generateSpecReadiness({
        inputPath: draftPath,
        issueId: 'issue:0001:02',
        platformAdapter: adapter,
        repositoryRoot,
    });
    const second = await promoteSpecReadiness({inputPath: generated.path, platformAdapter: adapter, repositoryRoot});

    assert.equal(first.promoted.path, readinessPath(repositoryRoot));
    assert.equal(second.path, readinessPath(repositoryRoot, '02'));
    assert.notEqual(first.promoted.path, second.path);
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {authorized: true, findings: []});
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:02', repositoryRoot}), {authorized: true, findings: []});
});

test('verify ignores an effort-root historical readiness file', async t => {
    const repositoryRoot = await createRepository(t);
    await writeFile(
        join(repositoryRoot, '.scratch', '0001-workflow', 'spec-readiness.json'),
        `${JSON.stringify({schemaVersion: 5, result: 'satisfied'}, null, 2)}\n`,
        'utf8',
    );

    const result = await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot});
    assert.equal(result.authorized, false);
    assert.equal(result.findings.length, 1);
    assert.match(result.findings[0], /01\.spec-readiness\.json/);
});

test('prepare creates a new immutable complete Reviewer Request path', async t => {
    const repositoryRoot = await createRepository(t);
    const first = await prepare(repositoryRoot);
    const firstBytes = await readFile(first.path, 'utf8');
    const second = await prepare(repositoryRoot);
    const request = JSON.parse(firstBytes);

    assert.notEqual(first.path, second.path);
    assert.match(first.path, /[\\/]requests[\\/]request-[0-9a-f-]+\.json$/);
    assert.equal(Object.hasOwn(request, 'schemaVersion'), false);
    assert.equal(request.issueId, 'issue:0001:01');
    assert.equal(request.draftPath, first.draftPath);
    assert.match(request.requestId, /^[0-9a-f-]{36}$/);
    assert.match(request.requestDigest, /^[0-9a-f]{64}$/);
    assert.deepEqual(request.inputs.map((/** @type {{filePath: string, role: string}} */ {filePath, role}) => ({filePath, role})), [
        {filePath: '.scratch/0001-workflow/spec.md', role: 'governing-spec'},
    ]);
    assert.deepEqual(request.reviewerRole, {
        filePath: 'docs/agents/roles/spec-readiness-reviewer.md',
        id: 'spec-readiness-reviewer',
        sha256: digest('# Reviewer\n'),
    });
    assert.deepEqual(request.subject, {
        content: readinessSubject(selectedRequirements),
        filePath: '.scratch/0001-workflow/issues/01-implement.md',
        sha256: digest(readinessSubject(selectedRequirements)),
    });
    assert.equal(request.inputs[0].content, fullSpec);
    assert.ok(request.inputs.every((/** @type {{ sha256: string; }} */ entry) => /^[0-9a-f]{64}$/.test(entry.sha256)));
    assert.equal(await readFile(first.path, 'utf8'), firstBytes);
    assert.equal(Object.hasOwn(request, 'changes'), false);
});

test('prepare activation failure removes the new request and preserves the prior active request', async t => {
    const repositoryRoot = await createRepository(t);
    const initial = await prepare(repositoryRoot);
    const workspaceDirectory = dirname(dirname(initial.path));
    const activePath = join(workspaceDirectory, 'active-request.json');
    const requestsDirectory = dirname(initial.path);
    const activeBefore = await readFile(activePath, 'utf8');
    const requestsBefore = await readdir(requestsDirectory);

    await assert.rejects(prepareSpecReadiness({
        atomicWriteFile: async (path, text) => {
            if (path === activePath) throw new Error('Injected request activation failure.');
            await writeFile(path, text, {encoding: 'utf8', flag: 'wx'});
        },
        input: {inputs: normalInputs},
        issueId: 'issue:0001:01',
        platformAdapter: adapter,
        repositoryRoot,
    }), /Injected request activation failure/);

    assert.equal(await readFile(activePath, 'utf8'), activeBefore);
    assert.deepEqual(await readdir(requestsDirectory), requestsBefore);
});

test('prepare rejects a Main-chosen draft path', async t => {
    const repositoryRoot = await createRepository(t);
    await assert.rejects(prepareSpecReadiness({input: {draftPath: join(repositoryRoot, '.tmp', 'draft.txt'), inputs: normalInputs}, issueId: 'issue:0001:01',
        platformAdapter: adapter, repositoryRoot}), /unknown or missing fields/u);
});

test('generate rejects an empty bound report when a different file contains No problems and writes no artifact', async t => {
    const repositoryRoot = await createRepository(t);
    const prepared = await prepare(repositoryRoot);
    const wrongDraftPath = join(dirname(prepared.draftPath), 'wrong-draft.txt');
    const artifactsDirectory = join(dirname(dirname(prepared.draftPath)), 'artifacts');
    await writeFile(wrongDraftPath, report([]), 'utf8');

    for (const text of ['', ' \n\t\n']) {
        await writeFile(prepared.draftPath, text, 'utf8');
        await assert.rejects(
            generateSpecReadiness({
                inputPath: prepared.draftPath,
                issueId: 'issue:0001:01',
                platformAdapter: adapter,
                repositoryRoot,
            }),
            /report is empty.*relaunch/i,
        );
    }
    await assert.rejects(readdir(artifactsDirectory), {code: 'ENOENT'});
});

test('generate writes a request-bound canonical artifact only to the Reviewer workspace', async t => {
    const repositoryRoot = await createRepository(t);
    const prepared = await prepare(repositoryRoot);
    const generated = await generate(repositoryRoot, prepared.draftPath);
    const artifact = JSON.parse(await readFile(generated.path, 'utf8'));

    assert.match(generated.path, /[\\/]artifacts[\\/]artifact-[0-9a-f-]+\.json$/);
    assert.equal(artifact.schemaVersion, 7);
    assert.equal(artifact.issueId, 'issue:0001:01');
    assert.match(artifact.request.id, /^[0-9a-f-]{36}$/);
    assert.match(artifact.request.digest, /^[0-9a-f]{64}$/);
    assert.deepEqual(artifact.subject, {
        filePath: '.scratch/0001-workflow/issues/01-implement.md',
        sha256: digest(readinessSubject(selectedRequirements)),
    });
    assert.deepEqual(artifact.reviewerRole, {
        filePath: 'docs/agents/roles/spec-readiness-reviewer.md',
        id: 'spec-readiness-reviewer',
        sha256: digest('# Reviewer\n'),
    });
    assert.ok(artifact.inputs.every((/** @type {object} */ entry) => !Object.hasOwn(entry, 'content')));
    await assert.rejects(readFile(readinessPath(repositoryRoot), 'utf8'), {code: 'ENOENT'});
});

test('promotion and verification bind the Reviewer Role separately from governing Inputs', async t => {
    const promotionRoot = await createRepository(t);
    const prepared = await prepare(promotionRoot);
    const generated = await generate(promotionRoot, prepared.draftPath);
    await writeFile(join(promotionRoot, 'docs', 'agents', 'roles', 'spec-readiness-reviewer.md'), '# Changed Reviewer\n', 'utf8');
    await assert.rejects(
        promoteSpecReadiness({inputPath: generated.path, platformAdapter: adapter, repositoryRoot: promotionRoot}),
        /Stale Spec Readiness Reviewer Role/i,
    );

    const verificationRoot = await createRepository(t);
    await complete(verificationRoot);
    await writeFile(join(verificationRoot, 'docs', 'agents', 'roles', 'spec-readiness-reviewer.md'), '# Changed Reviewer\n', 'utf8');
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot: verificationRoot}), {
        authorized: false,
        findings: ['Stale Spec Readiness Reviewer Role: docs/agents/roles/spec-readiness-reviewer.md.'],
    });
});

test('generate rejects malformed subject content and a subject digest mismatch', async t => {
    for (const variant of ['malformed-content', 'request-digest']) {
        const repositoryRoot = await createRepository(t);
        const prepared = await prepare(repositoryRoot);
        const request = JSON.parse(await readFile(prepared.path, 'utf8'));
        if (variant === 'malformed-content') {
            request.subject.content = '## Wrong Requirement\n\nNot required\n\n';
            request.subject.sha256 = digest(request.subject.content);
            request.requestDigest = digest(JSON.stringify({
                requestId: request.requestId,
                issueId: request.issueId,
                draftPath: request.draftPath,
                reviewerRole: request.reviewerRole,
                inputs: request.inputs,
                subject: request.subject,
            }));
            const activePath = join(dirname(dirname(prepared.path)), 'active-request.json');
            const active = JSON.parse(await readFile(activePath, 'utf8'));
            active.requestDigest = request.requestDigest;
            await writeFile(activePath, `${JSON.stringify(active, null, 2)}\n`, 'utf8');
        } else {
            request.subject.content = request.subject.content.replace('#module-design', '#interfaces');
            request.subject.sha256 = digest(request.subject.content);
        }
        await writeFile(prepared.path, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
        await assert.rejects(
            generate(repositoryRoot, prepared.draftPath),
            variant === 'malformed-content' ? /subject content is invalid/i : /Request digest is invalid/i,
        );
    }
});

test('promote writes exact artifact bytes and verify authorizes only satisfied', async t => {
    const repositoryRoot = await createRepository(t);
    const {generated, prepared, promoted} = await complete(repositoryRoot);
    const artifactBytes = await readFile(generated.path, 'utf8');
    const baselinePath = join(repositoryRoot, '.tmp', 'codex', 'readiness-test', '0001_01', 'spec-readiness', 'baseline.json');
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    const record = JSON.parse(artifactBytes);

    assert.equal(await readFile(promoted.path, 'utf8'), artifactBytes);
    assert.equal(record.schemaVersion, 7);
    assert.deepEqual(record.subject, {
        filePath: '.scratch/0001-workflow/issues/01-implement.md',
        sha256: digest(readinessSubject(selectedRequirements)),
    });
    assert.equal(baseline.requestId, JSON.parse(await readFile(prepared.path, 'utf8')).requestId);
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {authorized: true, findings: []});
});

test('a report that lists problems persists as gap but does not authorize implementation', async t => {
    const repositoryRoot = await createRepository(t);
    const prepared = await prepare(repositoryRoot);
    const generated = await generate(repositoryRoot, prepared.draftPath, ['The upload Interface does not define the write-failure result.']);
    assert.equal(generated.result, 'gap');
    await promoteSpecReadiness({inputPath: generated.path, platformAdapter: adapter, repositoryRoot});
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {
        authorized: false,
        findings: ['Spec Readiness result does not authorize implementation: gap.'],
    });
});

test('generation rejects an obsolete request even when Input bytes are unchanged', async t => {
    const repositoryRoot = await createRepository(t);
    const first = await prepare(repositoryRoot);
    await prepare(repositoryRoot);

    await assert.rejects(
        generate(repositoryRoot, first.draftPath),
        /does not match the active Reviewer Request draftPath/i,
    );
    await assert.rejects(readFile(readinessPath(repositoryRoot), 'utf8'), {code: 'ENOENT'});
});

test('promotion rejects Input drift without replacing the prior record', async t => {
    const repositoryRoot = await createRepository(t);
    const initial = await complete(repositoryRoot);
    const before = await readFile(initial.promoted.path, 'utf8');
    const prepared = await prepare(repositoryRoot);
    const generated = await generate(repositoryRoot, prepared.draftPath);
    await writeFile(join(repositoryRoot, '.scratch', '0001-workflow', 'spec.md'), `${fullSpec}\nChanged after review.\n`, 'utf8');

    await assert.rejects(
        promoteSpecReadiness({inputPath: generated.path, platformAdapter: adapter, repositoryRoot}),
        /Stale Spec Readiness Input/i,
    );
    assert.equal(await readFile(initial.promoted.path, 'utf8'), before);
});

test('promotion rejects subject drift without replacing the prior record', async t => {
    const repositoryRoot = await createRepository(t);
    const initial = await complete(repositoryRoot);
    const before = await readFile(initial.promoted.path, 'utf8');
    const prepared = await prepare(repositoryRoot);
    const generated = await generate(repositoryRoot, prepared.draftPath);
    const issuePath = join(repositoryRoot, '.scratch', '0001-workflow', 'issues', '01-implement.md');
    const issueBytes = await readFile(issuePath, 'utf8');
    await writeFile(issuePath, issueBytes.replace('.scratch/0001-workflow/spec.md#module-design', '.scratch/0001-workflow/spec.md#interfaces'), 'utf8');

    await assert.rejects(
        promoteSpecReadiness({inputPath: generated.path, platformAdapter: adapter, repositoryRoot}),
        /Stale Spec Readiness subject/i,
    );
    assert.equal(await readFile(initial.promoted.path, 'utf8'), before);
});

test('verify binds What to build, Spec Requirement, and Acceptance criteria but ignores other issue bytes', async t => {
    const repositoryRoot = await createRepository(t);
    await complete(repositoryRoot);
    const issuePath = join(repositoryRoot, '.scratch', '0001-workflow', 'issues', '01-implement.md');
    const initial = await readFile(issuePath, 'utf8');

    await writeFile(issuePath, initial.replace('Status: ready-for-agent', 'Status: completed'), 'utf8');
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {authorized: true, findings: []});

    await writeFile(issuePath, initial.replace('- Not run.', '- Passed.'), 'utf8');
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {authorized: true, findings: []});

    await writeFile(issuePath, initial.replace('- None', '- issue:0001:02'), 'utf8');
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {authorized: true, findings: []});

    await writeFile(issuePath, initial.replace('- No comments.', '- Later comment.'), 'utf8');
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {authorized: true, findings: []});

    await writeFile(issuePath, initial.replace('Implement.', 'Implement a changed outcome.'), 'utf8');
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {
        authorized: false,
        findings: ['Stale Spec Readiness subject: .scratch/0001-workflow/issues/01-implement.md.'],
    });

    await writeFile(issuePath, initial.replace('- [ ] Complete.', '- [x] Complete.'), 'utf8');
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {authorized: true, findings: []});

    await writeFile(issuePath, initial.replace('Complete.', 'Changed criterion.'), 'utf8');
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {
        authorized: false,
        findings: ['Stale Spec Readiness subject: .scratch/0001-workflow/issues/01-implement.md.'],
    });

    await writeFile(issuePath, initial.replace('.scratch/0001-workflow/spec.md#module-design', '.scratch/0001-workflow/spec.md#interfaces'), 'utf8');
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {
        authorized: false,
        findings: ['Stale Spec Readiness subject: .scratch/0001-workflow/issues/01-implement.md.'],
    });

    await writeFile(issuePath, initial.replace('\n\n## Acceptance criteria', '\n\n\n## Acceptance criteria'), 'utf8');
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {
        authorized: false,
        findings: ['Stale Spec Readiness subject: .scratch/0001-workflow/issues/01-implement.md.'],
    });
});

test('subject identity is stable across line-ending representation', async t => {
    const repositoryRoot = await createRepository(t);
    const prepared = await prepare(repositoryRoot);
    const generated = await generate(repositoryRoot, prepared.draftPath);
    const issuePath = join(repositoryRoot, '.scratch', '0001-workflow', 'issues', '01-implement.md');
    const initial = await readFile(issuePath, 'utf8');
    await writeFile(issuePath, initial.replaceAll('\n', '\r\n'), 'utf8');

    await promoteSpecReadiness({inputPath: generated.path, platformAdapter: adapter, repositoryRoot});
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {
        authorized: true,
        findings: [],
    });
});

test('subject freshness includes content after fenced level-two headings', async t => {
    const repositoryRoot = await createRepository(t);
    const issuePath = join(repositoryRoot, '.scratch', '0001-workflow', 'issues', '01-implement.md');
    const initial = await readFile(issuePath, 'utf8');
    const withExample = initial.replace(
        '- [ ] Complete.',
        '- [ ] Complete.\n\n```md\n## Validation\n\n- Example only.\n```\n\n- [ ] Preserve content after the example.',
    );
    await writeFile(issuePath, withExample, 'utf8');
    await complete(repositoryRoot);
    await writeFile(issuePath, withExample.replace('Preserve content after the example.', 'Changed content after the example.'), 'utf8');

    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {
        authorized: false,
        findings: ['Stale Spec Readiness subject: .scratch/0001-workflow/issues/01-implement.md.'],
    });
});

test('promotion rejects identity, schema, and generated-path mutations', async t => {
    for (const variant of ['identity', 'schema', 'path']) {
        const repositoryRoot = await createRepository(t);
        const prepared = await prepare(repositoryRoot);
        const generated = await generate(repositoryRoot, prepared.draftPath);
        if (variant === 'path') {
            await assert.rejects(
                promoteSpecReadiness({inputPath: prepared.path, platformAdapter: adapter, repositoryRoot}),
                /generated artifact path/i,
            );
            continue;
        }
        const artifact = JSON.parse(await readFile(generated.path, 'utf8'));
        if (variant === 'identity') artifact.request.id = '00000000-0000-4000-8000-000000000000';
        if (variant === 'schema') artifact.schemaVersion = 5;
        await writeFile(generated.path, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
        await assert.rejects(
            promoteSpecReadiness({inputPath: generated.path, platformAdapter: adapter, repositoryRoot}),
            variant === 'identity' ? /request identity/i : /Malformed normal/i,
        );
    }
});

test('promotion failure leaves the prior tracked record unchanged', async t => {
    const repositoryRoot = await createRepository(t);
    const initial = await complete(repositoryRoot);
    const before = await readFile(initial.promoted.path, 'utf8');
    const baselinePath = join(repositoryRoot, '.tmp', 'codex', 'readiness-test', '0001_01', 'spec-readiness', 'baseline.json');
    const baselineBefore = await readFile(baselinePath, 'utf8');
    const prepared = await prepare(repositoryRoot);
    const generated = await generate(repositoryRoot, prepared.draftPath);

    await assert.rejects(promoteSpecReadiness({
        atomicWriteFile: async (path, text) => {
            if (path === initial.promoted.path) throw new Error('Injected promotion failure.');
            await writeFile(path, text, 'utf8');
        },
        inputPath: generated.path,
        platformAdapter: adapter,
        repositoryRoot,
    }), /Injected promotion failure/);
    assert.equal(await readFile(initial.promoted.path, 'utf8'), before);
    assert.equal(await readFile(baselinePath, 'utf8'), baselineBefore);
});

test('exception uses the same generate promote verify boundary', async t => {
    const repositoryRoot = await createRepository(t);
    await writeFile(join(repositoryRoot, '.scratch', '0001-workflow', 'issues', '01-implement.md'), issue('Not required'), 'utf8');
    const draft = {exception: {confirmedAt: '2026-08-04T12:34:56Z', reason: 'No governing design is required.'}};
    const generated = await generateException(repositoryRoot, draft);
    await assert.rejects(readFile(readinessPath(repositoryRoot), 'utf8'), {code: 'ENOENT'});
    const promoted = await promoteSpecReadiness({inputPath: generated.path, platformAdapter: adapter, repositoryRoot});
    const record = JSON.parse(await readFile(promoted.path, 'utf8'));

    assert.deepEqual(record, {
        schemaVersion: 7,
        issueId: 'issue:0001:01',
        exception: draft.exception,
        subject: {
            filePath: '.scratch/0001-workflow/issues/01-implement.md',
            sha256: digest(readinessSubject('Not required')),
        },
        result: 'not-applicable',
    });
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {authorized: true, findings: []});
});

test('exception applicability counts only canonical issue file names', async t => {
    const repositoryRoot = await createRepository(t);
    const issues = join(repositoryRoot, '.scratch', '0001-workflow', 'issues');
    await writeFile(join(issues, '01-implement.md'), issue('Not required'), 'utf8');
    const draft = {exception: {confirmedAt: '2026-08-04T12:34:56Z', reason: 'No governing design is required.'}};
    await writeFile(join(issues, '00-x.md'), '# Not an issue\n', 'utf8');
    await generateException(repositoryRoot, draft);
    await writeFile(join(issues, '02-a-.md'), issue('Not required'), 'utf8');
    await assert.rejects(generateException(repositoryRoot, draft), /exactly one implementation issue/);
});

test('exception promotion and verification bind the current issue subject', async t => {
    const repositoryRoot = await createRepository(t);
    const issuePath = join(repositoryRoot, '.scratch', '0001-workflow', 'issues', '01-implement.md');
    const initial = issue('Not required');
    await writeFile(issuePath, initial, 'utf8');
    const draft = {exception: {confirmedAt: '2026-08-04T12:34:56Z', reason: 'No governing design is required.'}};
    const generated = await generateException(repositoryRoot, draft);
    await writeFile(issuePath, initial.replace('Implement.', 'Implement a changed outcome.'), 'utf8');

    await assert.rejects(
        promoteSpecReadiness({inputPath: generated.path, platformAdapter: adapter, repositoryRoot}),
        /Stale Spec Readiness subject/i,
    );

    await writeFile(issuePath, initial.replace('- [ ] Complete.', '- [X] Complete.'), 'utf8');
    await promoteSpecReadiness({inputPath: generated.path, platformAdapter: adapter, repositoryRoot});
    await writeFile(issuePath, initial.replace('- [ ] Complete.', '- [x] Complete.'), 'utf8');
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {authorized: true, findings: []});

    await writeFile(issuePath, initial.replace('Complete.', 'Changed criterion.'), 'utf8');
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {
        authorized: false,
        findings: ['Stale Spec Readiness subject: .scratch/0001-workflow/issues/01-implement.md.'],
    });
});

test('exception is invalidated when the effort gains a second implementation issue', async t => {
    const draft = {exception: {confirmedAt: '2026-08-04T12:34:56Z', reason: 'No governing design is required.'}};

    const generationRoot = await createRepository(t);
    await writeFile(join(generationRoot, '.scratch', '0001-workflow', 'issues', '01-implement.md'), issue('Not required'), 'utf8');
    await writeFile(join(generationRoot, '.scratch', '0001-workflow', 'issues', '02-another.md'), issue('Not required'), 'utf8');
    await assert.rejects(
        generateException(generationRoot, draft),
        /exactly one implementation issue/i,
    );

    const promotionRoot = await createRepository(t);
    await writeFile(join(promotionRoot, '.scratch', '0001-workflow', 'issues', '01-implement.md'), issue('Not required'), 'utf8');
    const generated = await generateException(promotionRoot, draft);
    await writeFile(join(promotionRoot, '.scratch', '0001-workflow', 'issues', '02-another.md'), issue('Not required'), 'utf8');
    await assert.rejects(
        promoteSpecReadiness({inputPath: generated.path, platformAdapter: adapter, repositoryRoot: promotionRoot}),
        /exactly one implementation issue/i,
    );

    const verificationRoot = await createRepository(t);
    await writeFile(join(verificationRoot, '.scratch', '0001-workflow', 'issues', '01-implement.md'), issue('Not required'), 'utf8');
    const verificationArtifact = await generateException(verificationRoot, draft);
    await promoteSpecReadiness({inputPath: verificationArtifact.path, platformAdapter: adapter, repositoryRoot: verificationRoot});
    await writeFile(join(verificationRoot, '.scratch', '0001-workflow', 'issues', '02-another.md'), issue('Not required'), 'utf8');
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot: verificationRoot}), {
        authorized: false,
        findings: ['Spec Readiness exception requires exactly one implementation issue in the effort.'],
    });
});

test('exception generation requires exact Human confirmation data', async t => {
    const repositoryRoot = await createRepository(t);
    await writeFile(join(repositoryRoot, '.scratch', '0001-workflow', 'issues', '01-implement.md'), issue('Not required'), 'utf8');
    for (const input of [
        {exception: {confirmedAt: '2026-02-31T12:34:56Z', reason: 'No governing design is required.'}},
        {exception: {confirmedAt: '2026-08-04T12:34:56Z', reason: ''}},
        {exception: {confirmedAt: '2026-08-04T12:34:56Z', reason: 'Confirmed.'}, inferred: true},
    ]) {
        await assert.rejects(
            generateException(repositoryRoot, input),
            /malformed|unknown or missing/i,
        );
    }
});

test('verify recognizes every earlier schema as stale at the issue sidecar', async t => {
    const repositoryRoot = await createRepository(t);
    for (const schemaVersion of [1, 2, 3, 4, 5, 6]) {
        await writeFile(readinessPath(repositoryRoot), `${JSON.stringify({schemaVersion, inputs: [], checks: [], result: 'satisfied'}, null, 2)}\n`, 'utf8');
        assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {
            authorized: false,
            findings: [`Stale Spec Readiness schemaVersion: ${schemaVersion}.`],
        });
    }
});

test('verify rejects another issue within the reviewed Input subset', async t => {
    const repositoryRoot = await createRepository(t);
    const {promoted} = await complete(repositoryRoot);
    await writeFile(join(repositoryRoot, '.scratch', '0001-workflow', 'issues', '02-another.md'), issue('Governing requirements:\n\n- `.scratch/0001-workflow/spec.md#interfaces`'), 'utf8');
    await writeFile(readinessPath(repositoryRoot, '02'), await readFile(promoted.path, 'utf8'), 'utf8');
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:02', repositoryRoot}), {
        authorized: false,
        findings: ['Spec Readiness record does not match the issue.'],
    });
});

test('verify enforces requirement Markdown and path-only heading rules', async t => {
    const repositoryRoot = await createRepository(t);
    await complete(repositoryRoot);
    const issuePath = join(repositoryRoot, '.scratch', '0001-workflow', 'issues', '01-implement.md');

    await writeFile(issuePath, issue('Governing requirements:\n\n- `.scratch/0001-workflow/spec.md`'), 'utf8');
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {
        authorized: false,
        findings: [
            'Issue path-only governing requirement has ineligible heading structure: .scratch/0001-workflow/spec.md.',
            'Stale Spec Readiness subject: .scratch/0001-workflow/issues/01-implement.md.',
        ],
    });

    await mkdir(join(repositoryRoot, 'docs'), {recursive: true});
    await writeFile(join(repositoryRoot, 'docs', 'rules.txt'), '# Rules\n', 'utf8');
    await writeFile(issuePath, issue('Governing requirements:\n\n- `docs/rules.txt#rules`'), 'utf8');
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {
        authorized: false,
        findings: [
            'Issue governing requirement is not a reviewed governing Input: docs/rules.txt#rules.',
            'Issue governing requirement must reference a Markdown file: docs/rules.txt.',
            'Stale Spec Readiness subject: .scratch/0001-workflow/issues/01-implement.md.',
        ],
    });
});

test('verify rejects a governing requirement anchor that does not exist', async t => {
    const repositoryRoot = await createRepository(t);
    await writeFile(
        join(repositoryRoot, '.scratch', '0001-workflow', 'issues', '01-implement.md'),
        issue('Governing requirements:\n\n- `.scratch/0001-workflow/spec.md#missing-section`'),
        'utf8',
    );
    await complete(repositoryRoot);

    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {
        authorized: false,
        findings: ['Issue governing requirement anchor does not exist: .scratch/0001-workflow/spec.md#missing-section.'],
    });
});

test('verify rejects non-canonical Input ordering in a tracked record', async t => {
    const repositoryRoot = await createRepository(t);
    await mkdir(join(repositoryRoot, 'docs', 'adr'), {recursive: true});
    await writeFile(join(repositoryRoot, 'docs', 'adr', 'example.md'), '# Decision\n', 'utf8');
    const prepared = await prepare(repositoryRoot, {inputs: [
        {filePath: '.scratch/0001-workflow/spec.md', role: 'governing-spec'},
        {filePath: 'docs/adr/example.md', role: 'adr'},
    ]});
    const generated = await generate(repositoryRoot, prepared.draftPath);
    const promoted = await promoteSpecReadiness({inputPath: generated.path, platformAdapter: adapter, repositoryRoot});
    const record = JSON.parse(await readFile(promoted.path, 'utf8'));
    record.inputs.reverse();
    await writeFile(promoted.path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

    const result = await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot});
    assert.equal(result.authorized, false);
    assert.match(result.findings.join('\n'), /Inputs are not sorted/i);
});

test('verify aggregates stale Inputs with other independently determinable findings', async t => {
    const repositoryRoot = await createRepository(t);
    await complete(repositoryRoot);
    await writeFile(join(repositoryRoot, '.scratch', '0001-workflow', 'spec.md'), `${fullSpec}\nChanged after review.\n`, 'utf8');
    await mkdir(join(repositoryRoot, 'docs'), {recursive: true});
    await writeFile(join(repositoryRoot, 'docs', 'rules.txt'), '# Rules\n', 'utf8');
    await writeFile(
        join(repositoryRoot, '.scratch', '0001-workflow', 'issues', '01-implement.md'),
        issue('Governing requirements:\n\n- `docs/rules.txt#rules`'),
        'utf8',
    );

    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {
        authorized: false,
        findings: [
            'Issue governing requirement is not a reviewed governing Input: docs/rules.txt#rules.',
            'Issue governing requirement must reference a Markdown file: docs/rules.txt.',
            'Stale Spec Readiness Input: .scratch/0001-workflow/spec.md.',
            'Stale Spec Readiness subject: .scratch/0001-workflow/issues/01-implement.md.',
        ],
    });
});

test('implementing the issue does not stale its architecture evidence', async t => {
    const repositoryRoot = await createRepository(t);
    await mkdir(join(repositoryRoot, 'src'), {recursive: true});
    await writeFile(join(repositoryRoot, 'src', 'app.mjs'), 'export const before = 1;\n', 'utf8');
    const prepared = await prepare(repositoryRoot, {inputs: [...normalInputs, {filePath: 'src/app.mjs', role: 'architecture-evidence'}]});
    await writeFile(join(repositoryRoot, 'src', 'app.mjs'), 'export const during = 2;\n', 'utf8');
    const generated = await generate(repositoryRoot, prepared.draftPath);
    await promoteSpecReadiness({inputPath: generated.path, platformAdapter: adapter, repositoryRoot});
    await writeFile(join(repositoryRoot, 'src', 'app.mjs'), 'export const after = 3;\n', 'utf8');
    assert.deepEqual(await verifySpecReadiness({issueId: 'issue:0001:01', repositoryRoot}), {authorized: true, findings: []});
});

test('prepare rejects conflicting roles, issue Inputs and unknown roles', async t => {
    const repositoryRoot = await createRepository(t);
    await assert.rejects(prepare(repositoryRoot, {inputs: [
        {filePath: '.scratch/0001-workflow/spec.md', role: 'governing-spec'},
        {filePath: '.scratch/0001-workflow/spec.md', role: 'adr'},
    ]}), /conflicting roles/i);
    await assert.rejects(prepare(repositoryRoot, {inputs: [
        {filePath: '.scratch/0001-workflow/spec.md', role: 'governing-spec'},
        {filePath: '.scratch/0001-workflow/issues/01-implement.md', role: 'domain-context'},
    ]}), /cannot be a local tracker issue/i);
    await assert.rejects(prepare(repositoryRoot, {inputs: [
        {filePath: '.scratch/0001-workflow/spec.md', role: 'governing-spec'},
        {filePath: 'docs/agents/example.md', role: 'repository-rule'},
    ]}), /Unknown readiness input role: repository-rule/i);
});

test('prepare rejects Agent instructions and platform Agent configurations under allowed Input roles', async t => {
    const repositoryRoot = await createRepository(t);
    const paths = [
        'AGENTS.md',
        'nested/AGENTS.md',
        'CLAUDE.md',
        'nested/CLAUDE.md',
        'docs/agents/domain.md',
        '.agents/skills/example/SKILL.md',
        '.claude/skills/example/SKILL.md',
        '.codex/agents/spec-readiness-reviewer.toml',
        '.claude/agents/spec-readiness-reviewer.md',
    ];

    for (const filePath of paths) {
        await assert.rejects(prepare(repositoryRoot, {inputs: [
            ...normalInputs,
            {filePath, role: 'domain-context'},
        ]}), /cannot be an Agent instruction or platform Agent configuration/i);
    }
});
