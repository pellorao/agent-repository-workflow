import assert from 'node:assert/strict';
import * as nodeFileSystem from 'node:fs/promises';
import {access, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {createRepository, run, writeArtifact, writeIssue} from '../helpers/arw-cli.mjs';
import {commitAll, runGit} from '../helpers/git.mjs';
import {createScopedFilesystem} from '../../lib/common/filesystem.mjs';

test('update migrates the complete scratch tree and is idempotent', async t => {
    const repository = await createRepository(t);
    await writeIssue(
        repository.root,
        'upgrade-effort',
        '01-legacy.md',
        [
            'Legacy preamble',
            '# Legacy issue',
            '',
            '**Status:** completed',
            '',
            '## What to build',
            '',
            'Keep this body.',
            '',
            '## Acceptance criteria',
            '',
            '- [ ] Keep this checklist.',
            '',
            'Blocked by: `.scratch/upgrade-effort/issues/02-dependency.md`',
            '',
        ].join('\n'),
    );
    await writeIssue(
        repository.root,
        'upgrade-effort',
        '02-dependency.md',
        ['Type: task', 'Blocked by: None', '# Dependency', '', '## Question', '', 'Keep this question.', ''].join('\n'),
    );
    await writeArtifact(repository.root, 'upgrade-effort', 'PRD.md', '# Legacy spec\n\nKeep this spec.\n');
    await writeArtifact(repository.root, 'upgrade-effort', 'map.md', '## Missing map H1\n');
    await writeArtifact(repository.root, 'upgrade-effort', 'notes.md', '# Irrelevant notes\n');
    await commitAll(repository.root, 'add upgrade effort');

    const first = await run(['migrate', 'artifacts'], repository);
    const second = await run(['migrate', 'artifacts'], repository);
    const issue = await readFile(join(repository.root, '.scratch', '0001-upgrade-effort', 'issues', '01-legacy.md'), 'utf8');
    const ticket = await readFile(join(repository.root, '.scratch', '0001-upgrade-effort', 'issues', '02-dependency.md'), 'utf8');
    const spec = await readFile(join(repository.root, '.scratch', '0001-upgrade-effort', 'spec.md'), 'utf8');

    assert.equal(first.result, 0);
    assert.deepEqual(first.events, [
        {channel: 'stdout', message: 'Updated .scratch/upgrade-effort/issues/01-legacy.md'},
        {channel: 'stdout', message: 'Updated .scratch/upgrade-effort/issues/02-dependency.md'},
        {channel: 'stdout', message: 'Renamed .scratch/upgrade-effort/PRD.md -> .scratch/upgrade-effort/spec.md'},
        {channel: 'stdout', message: 'Renamed .scratch/upgrade-effort -> .scratch/0001-upgrade-effort'},
        {channel: 'stdout', message: 'Updated 4 paths.'},
    ]);
    assert.equal(
        issue,
        [
            '# Legacy issue',
            '',
            'Status: completed',
            '',
            'Legacy preamble',
            '',
            '## What to build',
            '',
            'Keep this body.',
            '',
            '## Acceptance criteria',
            '',
            '- [ ] Keep this checklist.',
            '',
            '## Blocked by',
            '',
            '- 02 - Dependency',
            '',
        ].join('\n'),
    );
    assert.equal(ticket, '# Dependency\n\nType: task\nBlocked by: None\n\n## Question\n\nKeep this question.\n');
    assert.equal(spec, '# Legacy spec\n\nKeep this spec.\n');
    await assert.rejects(access(join(repository.root, '.scratch', '0001-upgrade-effort', 'PRD.md')));
    assert.deepEqual(second, {events: [{channel: 'stdout', message: 'No updates needed.'}], result: 0});
});

test('artifact migration preserves a numeric-leading legacy effort slug', async t => {
    const repository = await createRepository(t);
    await writeArtifact(repository.root, '123-foo', 'notes.md', '# Legacy numeric-leading slug\n');
    await commitAll(repository.root, 'add numeric-leading legacy effort');

    const result = await run(['migrate', 'artifacts'], repository);

    assert.equal(result.result, 0);
    assert.match(result.events.map(event => event.message).join('\n'), /Renamed \.scratch\/123-foo -> \.scratch\/0001-123-foo/);
    await access(join(repository.root, '.scratch', '0001-123-foo', 'notes.md'));
});

test('artifact migration reports active spec readiness gaps without writing', async t => {
    const repository = await createRepository(t);
    const issue = '# Active legacy issue\n\n**Status:** ready-for-agent\n\n```text\nType: task\n```\n\n## What to build\n\nImplement behavior.\n\n## Acceptance criteria\n\n- [ ] Complete.\n\nBlocked by: None\n';
    const prd = '# Active legacy spec\n\n## Implementation Decisions\n\nDecision.\n\n## Testing Decisions\n\nTest.\n';
    await writeIssue(repository.root, 'active-legacy', '01-implement.md', issue);
    await writeArtifact(repository.root, 'active-legacy', 'PRD.md', prd);
    await commitAll(repository.root, 'add active legacy effort');

    const result = await run(['migrate', 'artifacts'], repository);

    assert.equal(result.result, 1);
    assert.match(result.events.map(event => event.message).join('\n'), /Spec Requirement/);
    assert.doesNotMatch(result.events.map(event => event.message).join('\n'), /\.\/\.scratch/);
    assert.match(result.events.map(event => event.message).join('\n'), /Module Design/);
    assert.match(result.events.map(event => event.message).join('\n'), /issues[\\/]01\.spec-readiness\.json/);
    assert.equal(await readFile(join(repository.root, '.scratch', 'active-legacy', 'issues', '01-implement.md'), 'utf8'), issue);
    assert.equal(await readFile(join(repository.root, '.scratch', 'active-legacy', 'PRD.md'), 'utf8'), prd);
    await assert.rejects(access(join(repository.root, '.scratch', 'active-legacy', 'spec.md')));
});

test('artifact migration accepts a numeric readiness sidecar for an active numbered issue', async t => {
    const repository = await createRepository(t);
    await writeIssue(
        repository.root,
        '0001-ready-effort',
        '01-implement.md',
        '# Active issue\n\nStatus: ready-for-agent\n\n## What to build\n\nImplement behavior.\n\n## Spec Requirement\n\nNot required\n\n## Acceptance criteria\n\n- [ ] Complete.\n\n## Blocked by\n\n- None - can start immediately\n',
    );
    await writeFile(
        join(repository.root, '.scratch', '0001-ready-effort', 'issues', '01.spec-readiness.json'),
        '{"historical":false}\n',
        'utf8',
    );
    await runGit(repository.root, ['add', '-A']);

    const result = await run(['migrate', 'artifacts'], repository);

    assert.deepEqual(result, {events: [{channel: 'stdout', message: 'No updates needed.'}], result: 0});
});

test('update isolates blocker title migration by effort', async t => {
    const repository = await createRepository(t);
    await writeIssue(
        repository.root,
        'alpha',
        '01-dependency.md',
        '# Alpha dependency\n\nStatus: completed\n\n## Blocked by\n\n- None - can start immediately\n',
    );
    await writeIssue(
        repository.root,
        'alpha',
        '02-dependent.md',
        '# Alpha dependent\n\n**Status:** completed\n\nBlocked by: 01\n',
    );
    await writeIssue(
        repository.root,
        'beta',
        '01-dependency.md',
        '# Beta dependency\n\nStatus: completed\n\n## Blocked by\n\n- None - can start immediately\n',
    );
    await commitAll(repository.root, 'add alpha and beta efforts');

    const {events, result} = await run(['migrate', 'artifacts'], repository);
    const dependent = await readFile(join(repository.root, '.scratch', '0001-alpha', 'issues', '02-dependent.md'), 'utf8');

    assert.equal(result, 0);
    assert.deepEqual(events, [
        {channel: 'stdout', message: 'Updated .scratch/alpha/issues/02-dependent.md'},
        {channel: 'stdout', message: 'Renamed .scratch/alpha -> .scratch/0001-alpha'},
        {channel: 'stdout', message: 'Renamed .scratch/beta -> .scratch/0002-beta'},
        {channel: 'stdout', message: 'Updated 3 paths.'},
    ]);
    assert.match(dependent, /- 01 - Alpha dependency/);
    assert.doesNotMatch(dependent, /Beta dependency/);
});

test('update preflight aggregates deterministic errors without writing', async t => {
    const repository = await createRepository(t);
    await writeIssue(repository.root, 'broken', '01-missing-status.md', '# Missing status\n');
    await writeIssue(repository.root, 'broken', 'bad-name.md', '# Bad name\n\nStatus: completed\n');
    await writeIssue(repository.root, 'broken', '00-zero.md', '# Zero\n\nStatus: completed\n');
    await writeIssue(repository.root, 'broken', '100-too-large.md', '# Too large\n\nStatus: completed\n');
    await writeArtifact(repository.root, '0000-zero-effort', 'notes.md', '# Zero effort\n');
    await writeArtifact(repository.root, '10000-too-large-effort', 'notes.md', '# Too large effort\n');
    await writeIssue(
        repository.root,
        'broken',
        '02-mixed-blockers.md',
        '# Mixed\n\n**Status:** ready-for-agent\n\nBlocked by: None, 01\n',
    );
    await writeArtifact(repository.root, 'broken', 'PRD.md', '# Legacy spec\n');
    await writeArtifact(repository.root, 'broken', 'spec.md', '# Existing spec\n');
    await commitAll(repository.root, 'add broken effort');
    const before = await Promise.all([
        readFile(join(repository.root, '.scratch', 'broken', 'issues', '01-missing-status.md'), 'utf8'),
        readFile(join(repository.root, '.scratch', 'broken', 'issues', '02-mixed-blockers.md'), 'utf8'),
        readFile(join(repository.root, '.scratch', 'broken', 'PRD.md'), 'utf8'),
        readFile(join(repository.root, '.scratch', 'broken', 'spec.md'), 'utf8'),
    ]);

    const {events, result} = await run(['migrate', 'artifacts'], repository);
    const after = await Promise.all([
        readFile(join(repository.root, '.scratch', 'broken', 'issues', '01-missing-status.md'), 'utf8'),
        readFile(join(repository.root, '.scratch', 'broken', 'issues', '02-mixed-blockers.md'), 'utf8'),
        readFile(join(repository.root, '.scratch', 'broken', 'PRD.md'), 'utf8'),
        readFile(join(repository.root, '.scratch', 'broken', 'spec.md'), 'utf8'),
    ]);
    const diagnostics = events.map(event => event.message).join('\n');

    assert.equal(result, 1);
    assert.deepEqual(after, before);
    assert.match(diagnostics, /01-missing-status\.md: Implementation issue must have one non-empty Status/);
    assert.match(diagnostics, /02-mixed-blockers\.md: Blocked by cannot mix None with concrete blockers/);
    assert.match(diagnostics, /00-zero\.md: Issue path or filename cannot be converted deterministically/);
    assert.match(diagnostics, /100-too-large\.md: Issue path or filename cannot be converted deterministically/);
    assert.match(diagnostics, /0000-zero-effort: Effort directory has an invalid effort number/);
    assert.match(diagnostics, /10000-too-large-effort: Effort directory has an invalid effort number/);
    assert.doesNotMatch(diagnostics, /bad-name\.md/);
    assert.match(diagnostics, /PRD\.md: Legacy PRD conflicts with an existing spec\.md/);
    assert.equal(events.at(-1)?.message, 'Convert the listed files manually, then run `arw migrate artifacts` again.');
});

test('update inventory preflight aggregates path and input failures before every write', async t => {
    const repository = await createRepository(t);
    await writeIssue(repository.root, 'Bad', '01-invalid-effort.md', '# Invalid effort\n\n**Status:** completed\n');
    await writeArtifact(repository.root, 'Bad', 'PRD.md', '# Invalid effort spec\n');
    await writeArtifact(repository.root, 'missing-heading', 'PRD.md', '## Not an H1\n');
    await writeIssue(repository.root, 'unreadable', '01-hidden.md', '# Hidden\n\n**Status:** completed\n');
    await writeArtifact(repository.root, 'unlistable', 'notes.md', '# Hidden directory\n');
    await writeIssue(repository.root, 'valid', '01-convertible.md', '# Convertible\n\n**Status:** completed\n');
    await commitAll(repository.root, 'add migration fixtures');
    let renameCount = 0;
    let writeCount = 0;
    const guardedFileSystem = {
        ...nodeFileSystem,
        readFile: async (/** @type {string} */ path, /** @type {'utf8'} */ encoding) => path.endsWith('01-hidden.md')
            ? Promise.reject(new Error('simulated read failure'))
            : nodeFileSystem.readFile(path, encoding),
        rename: async (/** @type {string} */ source, /** @type {string} */ target) => {
            renameCount += 1;
            return nodeFileSystem.rename(source, target);
        },
        writeFile: async (/** @type {string} */ path, /** @type {string} */ contents, /** @type {'utf8'} */ encoding) => {
            writeCount += 1;
            return nodeFileSystem.writeFile(path, contents, encoding);
        },
    };
    const created = await createScopedFilesystem({root: repository.root});
    if (created.status !== 'succeeded') assert.fail('Artifact inventory test filesystem must open.');
    const inventoryFilesystem = {
        ...created.scopedFilesystem,
        list: async (/** @type {{path: string}} */ input) => input.path === '.scratch/unlistable'
            ? {diagnostics: [{code: 'test-list-failed', message: 'simulated list failure'}], stage: 'list', status: /** @type {'failed'} */ ('failed')}
            : created.scopedFilesystem.list(input),
        readText: async (/** @type {{allowLossyDecoding: boolean, path: string}} */ input) => input.path.endsWith('01-hidden.md')
            ? {diagnostics: [{code: 'test-read-failed', message: 'simulated read failure'}], stage: 'read', status: /** @type {'failed'} */ ('failed')}
            : created.scopedFilesystem.readText(input),
    };

    const {events, result} = await run(['migrate', 'artifacts'], repository, {artifactInventoryFilesystem: inventoryFilesystem, updateFileSystem: guardedFileSystem});
    const diagnostics = events.map(event => event.message).join('\n');

    assert.equal(result, 1);
    assert.equal(writeCount, 0);
    assert.equal(renameCount, 0);
    assert.match(diagnostics, /\.scratch\/Bad\/issues\/01-invalid-effort\.md: Issue path or filename cannot be converted deterministically/);
    assert.match(diagnostics, /\.scratch\/Bad\/PRD\.md: Legacy PRD effort path cannot be converted deterministically/);
    assert.match(diagnostics, /\.scratch\/missing-heading\/PRD\.md: Legacy PRD has no readable first level-one heading/);
    assert.match(diagnostics, /\.scratch\/unreadable\/issues\/01-hidden\.md: File could not be read/);
    assert.match(diagnostics, /\.scratch\/unlistable: Effort directory could not be read/);
    assert.match(
        await readFile(join(repository.root, '.scratch', 'valid', 'issues', '01-convertible.md'), 'utf8'),
        /\*\*Status:\*\* completed/,
    );
});

test('update preflight rejects linked issue directories and mixed canonical boundaries', async t => {
    const repository = await createRepository(t);
    await writeIssue(repository.root, 'linked', '01-outside.md', '# Outside\n\n**Status:** completed\n');
    await writeIssue(repository.root, 'boundaries', '01-tab-heading.md', '#\tTab heading\n\n**Status:** completed\n');
    await writeIssue(
        repository.root,
        'boundaries',
        '02-mixed-format.md',
        '# Mixed format\n\n**Status:** completed\n\nBlocked by: 01\n\n## Blocked by\n\n- 01\n',
    );
    await commitAll(repository.root, 'add path boundary fixtures');
    const created = await createScopedFilesystem({root: repository.root});
    if (created.status !== 'succeeded') assert.fail('Artifact inventory test filesystem must open.');
    const inventoryFilesystem = {
        ...created.scopedFilesystem,
        list: async (/** @type {{path: string}} */ input) => {
            const listed = await created.scopedFilesystem.list(input);
            if (listed.status !== 'succeeded' || input.path !== '.scratch/linked') return listed;
            return {
                ...listed,
                entries: listed.entries.map(entry => entry.path === '.scratch/linked/issues' ? {...entry, kind: 'link'} : entry),
            };
        },
    };

    const {events, result} = await run(['migrate', 'artifacts'], repository, {artifactInventoryFilesystem: inventoryFilesystem});
    const diagnostics = events.map(event => event.message).join('\n');

    assert.equal(result, 1);
    assert.match(diagnostics, /\.scratch\/linked\/issues: Issue directory must not be a symbolic link/);
    assert.match(diagnostics, /01-tab-heading\.md: The issue has no readable first level-one heading/);
    assert.match(diagnostics, /02-mixed-format\.md: Blocked by cannot mix inline and section formats/);
    assert.match(
        await readFile(join(repository.root, '.scratch', 'linked', 'issues', '01-outside.md'), 'utf8'),
        /\*\*Status:\*\* completed/,
    );
});

test('update reports partial I/O failure and can continue on retry', async t => {
    const repository = await createRepository(t);
    await writeIssue(repository.root, 'partial', '01-first.md', '# First\n\n**Status:** completed\n');
    await writeIssue(repository.root, 'partial', '02-second.md', '# Second\n\n**Status:** completed\n');
    await writeArtifact(repository.root, 'partial', 'PRD.md', '# Legacy spec\n');
    await commitAll(repository.root, 'add partial effort');
    let replacementCount = 0;
    const failingFileSystem = {
        ...nodeFileSystem,
        rename: async (/** @type {string} */ source, /** @type {string} */ target) => {
            if (source.endsWith('.tmp')) {
                replacementCount += 1;
                if (replacementCount === 2) {
                    const error = Object.assign(new Error('injected replacement failure'), {code: 'EIO'});
                    throw error;
                }
            }

            return nodeFileSystem.rename(source, target);
        },
    };

    const failed = await run(['migrate', 'artifacts'], repository, {updateFileSystem: failingFileSystem});
    const first = await readFile(join(repository.root, '.scratch', 'partial', 'issues', '01-first.md'), 'utf8');
    const second = await readFile(join(repository.root, '.scratch', 'partial', 'issues', '02-second.md'), 'utf8');
    const retried = await run(['migrate', 'artifacts'], repository);

    assert.equal(failed.result, 1);
    assert.match(first, /Status: completed/);
    assert.match(second, /\*\*Status:\*\* completed/);
    assert.deepEqual(failed.events.slice(-3), [
        {channel: 'stderr', message: 'Update failed at .scratch/partial/issues/02-second.md: injected replacement failure'},
        {channel: 'stderr', message: 'Completed: .scratch/partial/issues/01-first.md'},
        {
            channel: 'stderr',
            message: 'Not completed: .scratch/partial/issues/02-second.md, .scratch/partial/PRD.md, .scratch/partial',
        },
    ]);
    assert.equal(retried.result, 0);
    assert.deepEqual(retried.events, [
        {channel: 'stdout', message: 'Updated .scratch/partial/issues/02-second.md'},
        {channel: 'stdout', message: 'Renamed .scratch/partial/PRD.md -> .scratch/partial/spec.md'},
        {channel: 'stdout', message: 'Renamed .scratch/partial -> .scratch/0001-partial'},
        {channel: 'stdout', message: 'Updated 3 paths.'},
    ]);
});

test('artifact migration orders effort numbers by reachable commit history and UTF-8 slug bytes', async t => {
    const repository = await createRepository(t);
    const date = (/** @type {string} */ value) => ({GIT_AUTHOR_DATE: value, GIT_COMMITTER_DATE: value});
    await writeArtifact(repository.root, 'late', 'notes.md', '# Late\n');
    await commitAll(repository.root, 'add late effort', {environment: date('2026-08-07T00:03:00Z')});
    await writeArtifact(repository.root, 'beta', 'notes.md', '# Beta\n');
    await commitAll(repository.root, 'add beta effort', {environment: date('2026-08-07T00:01:00Z')});
    await writeArtifact(repository.root, 'gamma', 'notes.md', '# Gamma\n');
    await writeArtifact(repository.root, 'alpha', 'notes.md', '# Alpha\n');
    await writeArtifact(repository.root, 'delta', 'notes.md', '# Delta\n');
    await commitAll(repository.root, 'add same-commit efforts', {environment: date('2026-08-07T00:01:00Z')});

    const migrated = await run(['migrate', 'artifacts'], repository);

    assert.equal(migrated.result, 0, migrated.events.map(event => event.message).join('\n'));
    for (const directory of ['0001-beta', '0002-alpha', '0003-delta', '0004-gamma', '0005-late']) {
        await access(join(repository.root, '.scratch', directory));
    }
});

test('artifact migration preserves mixed numbered state and blocks duplicate or uncommitted inputs before writing', async t => {
    const mixed = await createRepository(t);
    await writeArtifact(mixed.root, '0004-kept', 'notes.md', '# Kept\n');
    await writeArtifact(mixed.root, 'alpha', 'notes.md', '# Alpha\n');
    await commitAll(mixed.root, 'add mixed efforts');
    const migrated = await run(['migrate', 'artifacts'], mixed);
    assert.equal(migrated.result, 0);
    await access(join(mixed.root, '.scratch', '0001-alpha'));
    await access(join(mixed.root, '.scratch', '0004-kept'));

    const duplicate = await createRepository(t);
    await writeArtifact(duplicate.root, '0001-alpha', 'notes.md', '# Alpha\n');
    await writeArtifact(duplicate.root, '0001-beta', 'notes.md', '# Beta\n');
    await writeArtifact(duplicate.root, 'gamma', 'notes.md', '# Gamma\n');
    await commitAll(duplicate.root, 'add duplicate efforts');
    const rejectedDuplicate = await run(['migrate', 'artifacts'], duplicate);
    assert.equal(rejectedDuplicate.result, 1);
    assert.match(rejectedDuplicate.events.map(event => event.message).join('\n'), /Duplicate effort number 0001/);
    await access(join(duplicate.root, '.scratch', 'gamma'));

    const uncommitted = await createRepository(t);
    await writeArtifact(uncommitted.root, 'alpha', 'notes.md', '# Alpha\n');
    await commitAll(uncommitted.root, 'add committed effort');
    await writeArtifact(uncommitted.root, 'beta', 'notes.md', '# Beta\n');
    const rejectedUncommitted = await run(['migrate', 'artifacts'], uncommitted);
    assert.equal(rejectedUncommitted.result, 1);
    assert.match(rejectedUncommitted.events.map(event => event.message).join('\n'), /Effort is not committed in current HEAD/);
    await access(join(uncommitted.root, '.scratch', 'alpha'));
});

test('artifact migration rewrites only structured issue references while preserving status and historical JSON bytes', async t => {
    const repository = await createRepository(t);
    const issue = '# Work\n\nStatus: completed\n\n## What to build\n\nKeep `.scratch/work/spec.md` in ordinary prose.\n\n## Spec Requirement\n\nGoverning requirements:\n\n- `.scratch/work/spec.md#requirement`\n\n## Acceptance criteria\n\n- [x] Complete.\n\n## Blocked by\n\n- External dependency: `issue:ledger:0009:03` - Wait for the ledger contract.\n';
    const readiness = '{"historical":"readiness","issueId":"work:01-work"}\n';
    const audit = '{"historical":"audit"}\n';
    await writeArtifact(repository.root, 'work', 'spec.md', '# Work spec\n\n## Requirement\n\nKeep.\n');
    await writeIssue(repository.root, 'work', '01-work.md', issue);
    await writeFile(join(repository.root, '.scratch', 'work', 'issues', '01-work.spec-readiness.json'), readiness, 'utf8');
    await writeFile(join(repository.root, '.scratch', 'work', 'issues', '01-work.audit.json'), audit, 'utf8');
    await commitAll(repository.root, 'add work effort');

    const migrated = await run(['migrate', 'artifacts'], repository);
    const directory = join(repository.root, '.scratch', '0001-work');
    const migratedIssue = await readFile(join(directory, 'issues', '01-work.md'), 'utf8');

    assert.equal(migrated.result, 0, migrated.events.map(event => event.message).join('\n'));
    assert.match(migratedIssue, /^Status: completed$/m);
    assert.match(migratedIssue, /Keep `\.scratch\/work\/spec\.md` in ordinary prose\./);
    assert.match(migratedIssue, /- `\.scratch\/0001-work\/spec\.md#requirement`/);
    assert.match(migratedIssue, /- External dependency: `issue:ledger:0009:03` - Wait for the ledger contract\./);
    assert.equal(await readFile(join(directory, 'issues', '01-work.spec-readiness.json'), 'utf8'), readiness);
    assert.equal(await readFile(join(directory, 'issues', '01-work.audit.json'), 'utf8'), audit);
});

test('artifact migration rejects shallow history before every write', async t => {
    const repository = await createRepository(t);
    await writeArtifact(repository.root, 'work', 'notes.md', '# Work\n');
    await commitAll(repository.root, 'add work effort');
    const result = await run(['migrate', 'artifacts'], repository, {
        artifactMigrationGit: {
            run: async () => ({code: 0, failure: null, stderr: '', stdout: Buffer.from('true\n')}),
        },
    });
    assert.equal(result.result, 1);
    assert.match(result.events.map(event => event.message).join('\n'), /Shallow Repository history cannot assign persistent effort numbers/);
    await access(join(repository.root, '.scratch', 'work'));
});
