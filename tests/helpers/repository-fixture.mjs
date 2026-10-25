import {createTemporaryDirectory} from './cleanup.mjs';
import {commitAll, runGit} from './git.mjs';

/**
 * @param {import('node:test').TestContext} t
 * @param {{initialBranch?: string, initialCommit?: boolean, prefix?: string}} [options]
 */
export const createRepository = async (t, options = {}) => {
    const repositoryRoot = await createTemporaryDirectory(t, options.prefix ?? 'arw-test-repository-');
    await runGit(repositoryRoot, [
        'init',
        '--quiet',
        ...(options.initialBranch === undefined ? [] : [`--initial-branch=${options.initialBranch}`]),
    ]);
    if (options.initialCommit === true) {
        await commitAll(repositoryRoot, 'initial fixture', {allowEmpty: true});
    }
    return repositoryRoot;
};
