import {realpath} from 'node:fs/promises';
import {isAbsolute, sep} from 'node:path';

import {resolveRelativePathWithinScope} from './filesystem.mjs';
import {createNodeGitRunner} from './git-process.mjs';

/** @typedef {{code: number | null, failure: 'process' | 'timeout' | null, stderr: string, stdout: Buffer}} GitProcessResult */
/** @typedef {{run: (input: {argv: string[], cwd?: string, environment?: NodeJS.ProcessEnv, input?: Buffer | string, timeoutMs?: number}) => Promise<GitProcessResult>}} GitRunner */
/** @typedef {{canonicalize: (path: string) => Promise<unknown>, discover: (startDirectory: string) => Promise<unknown>}} RepositoryObserver */
/** @typedef {{code: string, message: string, path?: string}} RepositoryDiagnostic */
/** @typedef {{diagnostics: RepositoryDiagnostic[], status: 'blocked'} | {absolutePath: string, diagnostics: RepositoryDiagnostic[], path: string, repositoryRoot: string, status: 'succeeded'}} RepositoryPathResult */
/** @typedef {{identity: string, resolvePath: (path: string) => RepositoryPathResult, root: string}} Repository */
/** @typedef {{diagnostics: RepositoryDiagnostic[], status: 'blocked'} | {diagnostics: RepositoryDiagnostic[], stage: string, status: 'failed'} | {diagnostics: RepositoryDiagnostic[], repository: Repository, status: 'succeeded'}} RepositoryResolutionResult */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** @param {string} root @returns {(path: string) => RepositoryPathResult} */
const createRepositoryPathResolver = root => path => {
    const resolved = resolveRelativePathWithinScope({path, scope: root});
    if (resolved.status !== 'succeeded') {
        return {
            diagnostics: [{code: 'repository-path-escape', message: 'The path escapes the Repository root.', path}],
            status: 'blocked',
        };
    }
    const repositoryPath = resolved.relativePath === '' ? '.' : resolved.relativePath.split(sep).join('/');
    return {absolutePath: resolved.absolutePath, diagnostics: [], path: repositoryPath, repositoryRoot: root, status: 'succeeded'};
};

/** @param {GitProcessResult} result */
const noWorkingTree = result => result.failure === null
    && result.code === 128
    && (/^fatal: not a git repository(?: \(or any (?:of the parent directories|parent up to mount point [^)\r\n]+)\))?(?::|\r?\n|$)/u.test(result.stderr)
        || /^fatal: this operation must be run in a work tree\.?\s*$/u.test(result.stderr));

/** @param {GitProcessResult} result */
const gitObservationError = result => {
    const detail = result.stderr.trim();
    if (detail !== '') return new Error(detail);
    if (result.failure === 'timeout') return new Error('Git repository discovery timed out.');
    if (result.failure === 'process') return new Error('Git repository discovery process failed.');
    return new Error(`Git repository discovery exited with code ${result.code}.`);
};

/** @param {{git?: GitRunner | null}} [options] @returns {RepositoryObserver} */
export const createNodeRepositoryObserver = ({git = null} = {}) => ({
    /** @param {string} startDirectory */
    async discover(startDirectory) {
        const result = await (git ?? createNodeGitRunner(startDirectory)).run({
            argv: ['rev-parse', '--show-toplevel'],
            environment: {...process.env, LANG: 'C', LANGUAGE: 'C', LC_ALL: 'C'},
        });
        if (result.failure === null && result.code === 0) {
            return {kind: 'observed', root: result.stdout.toString('utf8').trim()};
        }
        if (noWorkingTree(result)) return {kind: 'not-found'};
        return {error: gitObservationError(result), kind: 'failed'};
    },
    /** @param {string} path */
    canonicalize: path => realpath(path),
});

/** @param {{observer?: RepositoryObserver, startDirectory?: string}} [options] @returns {Promise<RepositoryResolutionResult>} */
export const resolveRepository = async ({observer = createNodeRepositoryObserver(), startDirectory = process.cwd()} = {}) => {
    if (typeof startDirectory !== 'string' || startDirectory.length === 0) {
        throw new TypeError('startDirectory must be a non-empty string.');
    }
    if (observer === null || typeof observer?.discover !== 'function' || typeof observer?.canonicalize !== 'function') {
        throw new TypeError('observer must provide discover and canonicalize.');
    }
    let observed;
    try {
        observed = await observer.discover(startDirectory);
    } catch (error) {
        return {
            diagnostics: [{code: 'repository-observation-failed', message: error instanceof Error ? error.message : String(error)}],
            stage: 'repository-discovery',
            status: 'failed',
        };
    }
    if (isRecord(observed) && (observed.kind === 'not-found'
        || observed.kind === 'observed' && observed.root === '')) {
        return {
            diagnostics: [{code: 'repository-not-found', message: 'The nearest Git working-tree root could not be found.'}],
            status: 'blocked',
        };
    }
    if (isRecord(observed) && observed.kind === 'failed') {
        return {
            diagnostics: [{
                code: 'repository-observation-failed',
                message: observed.error instanceof Error ? observed.error.message : String(observed.error),
            }],
            stage: 'repository-discovery',
            status: 'failed',
        };
    }
    if (!isRecord(observed) || observed.kind !== 'observed' || typeof observed.root !== 'string') {
        throw new Error('Repository observer returned an invalid result.');
    }
    let root;
    try {
        root = await observer.canonicalize(observed.root);
    } catch (error) {
        return {
            diagnostics: [{code: 'repository-resolution-failed', message: error instanceof Error ? error.message : String(error)}],
            stage: 'repository-resolution',
            status: 'failed',
        };
    }
    if (typeof root !== 'string' || !isAbsolute(root)) throw new Error('Repository observer returned an invalid canonical root.');
    return {
        diagnostics: [],
        repository: {
            identity: root,
            resolvePath: createRepositoryPathResolver(root),
            root,
        },
        status: 'succeeded',
    };
};
