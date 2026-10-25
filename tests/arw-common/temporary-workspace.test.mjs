import assert from 'node:assert/strict';
import {access, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {runGit} from '../helpers/git.mjs';
import {createRepository} from '../helpers/repository-fixture.mjs';
import {createTemporaryWorkspace} from '../../lib/arw-common/temporary-workspace.mjs';


test('temporary workspace creates the issue-scoped directory from a verified Agent identity', async t => {
    const outerRepositoryRoot = await createRepository(t, {prefix: 'arw-temporary-workspace-'});
    const repositoryRoot = join(outerRepositoryRoot, 'nested');
    await mkdir(repositoryRoot);
    await runGit(repositoryRoot, ['init', '--quiet']);

    const directory = await createTemporaryWorkspace({
        agentIdentity: {platform: 'codex', sessionId: 'codex-subagent-01'},
        issueId: 'issue:0067:01',
        purpose: 'spec-readiness',
        repositoryRoot,
    });

    assert.equal(directory, join(
        repositoryRoot,
        '.tmp',
        'codex',
        'codex-subagent-01',
        '0067_01',
        'spec-readiness',
    ));
    await access(directory);
    await assert.rejects(
        access(join(repositoryRoot, '.tmp', 'codex', 'codex-subagent-01', '0067_01-create-a-directory-with-a-long-readable-slug')),
        /ENOENT/,
    );
    await assert.rejects(access(join(outerRepositoryRoot, '.tmp')), /ENOENT/);
});

test('temporary workspace fails before creating a directory when a critical identity is missing', async t => {
    const repositoryRoot = await createRepository(t, {prefix: 'arw-temporary-workspace-'});

    await assert.rejects(
        createTemporaryWorkspace({
            agentIdentity: {platform: 'codex', sessionId: ''},
            issueId: 'issue:0067:01',
            purpose: 'spec-readiness',
            repositoryRoot,
        }),
        /Platform Adapter session identity must be a non-empty safe path segment\./,
    );
    await assert.rejects(access(join(repositoryRoot, '.tmp')), /ENOENT/);
});

test('temporary workspace rejects an unsupported CLI platform before creating a directory', async t => {
    const repositoryRoot = await createRepository(t, {prefix: 'arw-temporary-workspace-'});

    await assert.rejects(
        createTemporaryWorkspace({
            agentIdentity: {platform: 'other-agent', sessionId: 'session-03'},
            issueId: 'issue:0067:01',
            purpose: 'spec-readiness',
            repositoryRoot,
        }),
        /Platform Adapter platform must be one of: claude-code, codex\./,
    );
    await assert.rejects(access(join(repositoryRoot, '.tmp')), /ENOENT/);
});
