import {runProcess} from './process.mjs';

/**
 * @param {string} repositoryRoot
 * @param {string[]} args
 * @param {{environment?: NodeJS.ProcessEnv, input?: string | Uint8Array}} [options]
 */
export const runGit = async (repositoryRoot, args, options = {}) => {
    const result = await runProcess('git', args, {
        cwd: repositoryRoot,
        env: {
            ...process.env,
            GIT_AUTHOR_EMAIL: 'tests@example.invalid',
            GIT_AUTHOR_NAME: 'ARW Tests',
            GIT_COMMITTER_EMAIL: 'tests@example.invalid',
            GIT_COMMITTER_NAME: 'ARW Tests',
            ...options.environment,
        },
        input: options.input,
    });
    if (result.status === 'spawn-failed') {
        throw new Error(`Cannot start Git test setup: ${result.error.message}`);
    }
    if (result.status === 'signaled') {
        throw new Error(`Git test setup was terminated by signal ${result.signal}: ${result.stderr || result.stdout}`);
    }
    if (result.exitCode !== 0) {
        throw new Error(`Git test setup failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`);
    }
    return result;
};

/**
 * @param {string} repositoryRoot
 * @param {string} message
 * @param {{allowEmpty?: boolean, environment?: NodeJS.ProcessEnv}} [options]
 */
export const commitAll = async (repositoryRoot, message, options = {}) => {
    await runGit(repositoryRoot, ['add', '-A']);
    return runGit(repositoryRoot, [
        '-c',
        'user.name=ARW Tests',
        '-c',
        'user.email=tests@example.invalid',
        'commit',
        '--quiet',
        ...(options.allowEmpty === true ? ['--allow-empty'] : []),
        '-m',
        message,
    ], {environment: options.environment});
};
