import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {createSubmoduleCoordinator} from '../../lib/application-jira/submodule-coordination.mjs';
import {createSubmoduleGitAdapter} from '../../lib/application-jira/submodule-git-adapter.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {commitAll, runGit} from '../helpers/git.mjs';

test('production Submodule Coordination fast-forwards a real configured submodule from a bare remote', async t => {
    const root = await createTemporaryDirectory(t, 'application-jira-real-submodule-');
    const remote = join(root, 'billing.git');
    const seed = join(root, 'seed');
    const application = join(root, 'application');
    await runGit(root, ['init', '--bare', '--quiet', remote]);
    await runGit(root, ['init', '--quiet', '--initial-branch=dev', seed]);
    await writeFile(join(seed, 'module.txt'), 'first\n', 'utf8');
    await commitAll(seed, 'first module state');
    await runGit(seed, ['remote', 'add', 'origin', remote]);
    await runGit(seed, ['push', '--quiet', '--set-upstream', 'origin', 'dev']);
    await runGit(root, ['init', '--quiet', '--initial-branch=main', application]);
    await commitAll(application, 'initial application', {allowEmpty: true});
    await runGit(application, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', '-b', 'dev', remote, 'modules/billing']);
    await commitAll(application, 'add billing submodule');
    await writeFile(join(seed, 'module.txt'), 'second\n', 'utf8');
    await commitAll(seed, 'published module state');
    await runGit(seed, ['push', '--quiet', 'origin', 'dev']);

    const moduleRoot = join(application, 'modules', 'billing');
    const result = await createSubmoduleCoordinator({git: createSubmoduleGitAdapter()}).convergeRemote({
        branch: 'dev',
        modules: [{name: 'billing', repositoryRoot: moduleRoot}],
        remote: 'origin',
    });

    assert.equal(result.status, 'succeeded');
    if (result.status !== 'succeeded') assert.fail('Real submodule convergence must succeed.');
    assert.deepEqual(result.effects, [{action: 'fast-forwarded', module: 'billing'}]);
    assert.equal(await readFile(join(moduleRoot, 'module.txt'), 'utf8'), 'second\n');
    const status = await runGit(application, ['status', '--porcelain=v1']);
    assert.match(status.stdout, /^ M modules\/billing$/mu);
});
