import {createNodeGitRunner} from '../common/git-process.mjs';

/** @typedef {{branch: string, module: string, remote: string, repositoryRoot: string}} RemoteInput */

/** @template {object} T @param {string} code @param {string} message @param {T} extra */
const failed = (code, message, extra) => ({diagnostics: [{code, message}], status: /** @type {'failed'} */ ('failed'), ...extra});

/** @param {ReturnType<typeof createNodeGitRunner>} git @param {string} repositoryRoot */
const observeBranchAndHead = async (git, repositoryRoot) => {
    const branch = await git.run({argv: ['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd: repositoryRoot});
    const head = await git.run({argv: ['rev-parse', '--verify', 'HEAD'], cwd: repositoryRoot});
    return {
        branch: branch.code === 0 ? branch.stdout.toString('utf8').trim() : '',
        head: head.code === 0 ? head.stdout.toString('utf8').trim() : '',
    };
};

/** @param {ReturnType<typeof createNodeGitRunner>} git @param {string} repositoryRoot @param {string} reference */
const referenceExists = async (git, repositoryRoot, reference) => {
    const result = await git.run({argv: ['show-ref', '--quiet', '--verify', reference], cwd: repositoryRoot});
    if (result.code !== 0 && result.code !== 1) throw new Error('Git reference inspection failed.');
    return result.code === 0;
};

/** @param {{git?: ReturnType<typeof createNodeGitRunner>}} [dependencies] */
export const createSubmoduleGitAdapter = (dependencies = {}) => {
    const defaultGit = dependencies.git;
    const runner = (/** @type {string} */ repositoryRoot) => defaultGit ?? createNodeGitRunner(repositoryRoot);
    return Object.freeze({
        async inspectConvergence(/** @type {{branch: string, module: string, repositoryRoot: string}} */ input) {
            const git = runner(input.repositoryRoot);
            const status = await git.run({argv: ['status', '--porcelain=v1', '--untracked-files=all'], cwd: input.repositoryRoot});
            const observed = await observeBranchAndHead(git, input.repositoryRoot);
            return status.code === 0 && observed.head.length > 0
                ? {diagnostics: [], state: {...observed, clean: status.stdout.length === 0}, status: /** @type {'succeeded'} */ ('succeeded')}
                : failed('submodule-preflight-failed', `Git preflight failed for configured Module ${input.module}.`, {state: {...observed, clean: false}, stage: 'preflight'});
        },
        async fetch(/** @type {RemoteInput} */ input) {
            const git = runner(input.repositoryRoot);
            const result = await git.run({argv: ['fetch', '--no-tags', input.remote, input.branch], cwd: input.repositoryRoot});
            return result.code === 0
                ? {diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded')}
                : failed('submodule-fetch-failed', `Fetch failed for configured Module ${input.module}.`, {stage: 'fetch'});
        },
        async compareRemote(/** @type {RemoteInput} */ input) {
            const git = runner(input.repositoryRoot);
            const observed = await observeBranchAndHead(git, input.repositoryRoot);
            const remoteReference = `refs/remotes/${input.remote}/${input.branch}`;
            const remote = await git.run({argv: ['rev-parse', '--verify', remoteReference], cwd: input.repositoryRoot});
            if (remote.code !== 0 || observed.head.length === 0) {
                return failed('submodule-remote-observation-failed', `Remote branch could not be observed for configured Module ${input.module}.`, {stage: 'final-verification'});
            }
            const remoteHead = remote.stdout.toString('utf8').trim();
            let relation = /** @type {'ahead' | 'behind' | 'diverged' | 'equal'} */ ('equal');
            if (observed.head !== remoteHead) {
                const localAncestor = await git.run({argv: ['merge-base', '--is-ancestor', observed.head, remoteHead], cwd: input.repositoryRoot});
                const remoteAncestor = await git.run({argv: ['merge-base', '--is-ancestor', remoteHead, observed.head], cwd: input.repositoryRoot});
                if ([localAncestor, remoteAncestor].some(result => result.code !== 0 && result.code !== 1)) {
                    return failed('submodule-relation-failed', `Commit relation could not be determined for configured Module ${input.module}.`, {stage: 'final-verification'});
                }
                relation = localAncestor.code === 0 ? 'behind' : remoteAncestor.code === 0 ? 'ahead' : 'diverged';
            }
            return {diagnostics: [], relation, state: {...observed, remoteHead}, status: /** @type {'succeeded'} */ ('succeeded')};
        },
        async fastForward(/** @type {RemoteInput} */ input) {
            const git = runner(input.repositoryRoot);
            const result = await git.run({argv: ['merge', '--ff-only', `${input.remote}/${input.branch}`], cwd: input.repositoryRoot});
            const state = await observeBranchAndHead(git, input.repositoryRoot);
            return result.code === 0
                ? {diagnostics: [], state, status: /** @type {'succeeded'} */ ('succeeded')}
                : failed('submodule-fast-forward-failed', `Fast-forward failed for configured Module ${input.module}.`, {state});
        },
        async inspectSwitch(/** @type {{module: string, remote: string, repositoryRoot: string, targetBranch: string}} */ input) {
            const git = runner(input.repositoryRoot);
            try {
                const status = await git.run({argv: ['status', '--porcelain=v1', '--untracked-files=all'], cwd: input.repositoryRoot});
                if (status.code !== 0) throw new Error('Git status failed.');
                const observed = await observeBranchAndHead(git, input.repositoryRoot);
                if (observed.head.length === 0) throw new Error('Git HEAD could not be read.');
                return {
                    diagnostics: [],
                    state: {
                        ...observed,
                        clean: status.stdout.length === 0,
                        localBranchExists: await referenceExists(git, input.repositoryRoot, `refs/heads/${input.targetBranch}`),
                        remoteBranchExists: await referenceExists(git, input.repositoryRoot, `refs/remotes/${input.remote}/${input.targetBranch}`),
                    },
                    status: /** @type {'succeeded'} */ ('succeeded'),
                };
            } catch {
                return failed('submodule-preflight-failed', `Git preflight failed for configured Module ${input.module}.`, {stage: 'preflight'});
            }
        },
        async switchBranch(/** @type {{mode: 'local' | 'remote-tracking', module: string, remote: string, repositoryRoot: string, targetBranch: string}} */ input) {
            const git = runner(input.repositoryRoot);
            const argv = input.mode === 'local'
                ? ['switch', input.targetBranch]
                : ['switch', '--track', '-c', input.targetBranch, `${input.remote}/${input.targetBranch}`];
            const result = await git.run({argv, cwd: input.repositoryRoot});
            const state = await observeBranchAndHead(git, input.repositoryRoot);
            return result.code === 0
                ? {diagnostics: [], state, status: /** @type {'succeeded'} */ ('succeeded')}
                : failed('submodule-switch-failed', `Branch switch failed for configured Module ${input.module}.`, {state});
        },
        async restore(/** @type {{branch: string, head: string, module: string, repositoryRoot: string}} */ input) {
            const git = runner(input.repositoryRoot);
            const switched = await git.run({
                argv: input.branch.length === 0 ? ['switch', '--detach', input.head] : ['switch', input.branch],
                cwd: input.repositoryRoot,
            });
            const result = switched.code === 0
                ? await git.run({argv: ['reset', '--hard', input.head], cwd: input.repositoryRoot})
                : switched;
            const state = await observeBranchAndHead(git, input.repositoryRoot);
            return result.code === 0
                ? {diagnostics: [], state, status: /** @type {'succeeded'} */ ('succeeded')}
                : failed('submodule-recovery-failed', `Branch recovery failed for configured Module ${input.module}.`, {state});
        },
    });
};
