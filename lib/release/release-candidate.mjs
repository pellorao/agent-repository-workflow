import {ARW_VERSION} from '../arw-common/identity.mjs';
import {createNodeGitRunner} from '../common/git-process.mjs';
import {
    loadReleaseValidationConfiguration,
    validateReleaseValidationConfiguration,
} from './release-validation-config.mjs';
import {compareText} from '../common/json.mjs';

const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
/** @typedef {{exitCode: number, stderr: string, stdout: string}} CandidateCommandResult */
/** @typedef {(file: string, args: string[], options: {cwd: string, input?: Buffer | string}) => Promise<CandidateCommandResult>} CandidateCommandRunner */

/** @returns {Error & {candidateCode: string}} */
const candidateError = (/** @type {string} */ code, /** @type {string | undefined} */ message) => Object.assign(new Error(message), {candidateCode: code});

/** @type {CandidateCommandRunner} */
const defaultRunCommand = async (file, args, {cwd, input = undefined}) => {
    if (file !== 'git') return {exitCode: 1, stderr: `Unsupported candidate command: ${file}`, stdout: ''};
    const result = await createNodeGitRunner(cwd).run({argv: args, input});
    return {
        exitCode: result.code ?? 1,
        stderr: result.stderr || result.failure || '',
        stdout: result.stdout.toString('utf8'),
    };
};

const compareVersion = (/** @type {string} */ left, /** @type {string} */ right) => {
    const leftParts = left.split('.').map(Number);
    const rightParts = right.split('.').map(Number);
    for (let index = 0; index < 3; index += 1) {
        if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
    }
    return 0;
};

/**
 * @param {object} input
 * @param {string[]} input.args
 * @param {Buffer | string} [input.input]
 * @param {string} input.label
 * @param {string} input.repositoryRoot
 * @param {CandidateCommandRunner} input.runCommand
 */
const runGit = async ({args, input = undefined, label, repositoryRoot, runCommand}) => {
    const result = await runCommand('git', args, {
        cwd: repositoryRoot,
        ...(input === undefined ? {} : {input}),
    });
    if (result.exitCode !== 0) {
        throw candidateError('git-failure', `${label} failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
    }
    return result.stdout;
};

/** @param {string} value @param {string} label @param {string} [code] */
const assertObjectId = (/** @type {string} */ value, /** @type {string} */ label, code = 'git-failure') => {
    if (!OBJECT_ID_PATTERN.test(value)) throw candidateError(code, `${label} is not a full Git object ID.`);
};

/** @param {{canonicalRemote: string, remote: string, repositoryRoot: string, runCommand: CandidateCommandRunner}} input */
const assertCanonicalRemote = async ({canonicalRemote, remote, repositoryRoot, runCommand}) => {
    const remotes = (await runGit({
        args: ['remote'],
        label: 'Release candidate remote inventory',
        repositoryRoot,
        runCommand,
    })).split(/\r?\n/).filter(Boolean);
    if (!remotes.includes(remote)) {
        throw candidateError('remote-url-mismatch', 'Release candidate origin does not match the canonical remote.');
    }
    const urls = (await runGit({
        args: ['remote', 'get-url', '--all', remote],
        label: 'Release candidate remote URL check',
        repositoryRoot,
        runCommand,
    })).split(/\r?\n/).filter(Boolean);
    if (urls.length !== 1 || urls[0] !== canonicalRemote) {
        throw candidateError('remote-url-mismatch', 'Release candidate origin does not match the canonical remote.');
    }
};

const isSafeRepositoryPath = (/** @type {string} */ value) => typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && value.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..');

/** @param {{repositoryRoot: string, runCommand: CandidateCommandRunner}} input */
const loadCandidateIdentity = async ({repositoryRoot, runCommand}) => {
    const [commitOutput, treeOutput, statusOutput] = await Promise.all([
        runGit({args: ['rev-parse', '--verify', 'HEAD'], label: 'Candidate commit', repositoryRoot, runCommand}),
        runGit({args: ['rev-parse', '--verify', 'HEAD^{tree}'], label: 'Candidate tree', repositoryRoot, runCommand}),
        runGit({
            args: ['status', '--porcelain=v1', '--untracked-files=all'],
            label: 'Candidate Repository state',
            repositoryRoot,
            runCommand,
        }),
    ]);
    const commit = commitOutput.trim();
    const tree = treeOutput.trim();
    assertObjectId(commit, 'Candidate commit');
    assertObjectId(tree, 'Candidate tree');
    if (statusOutput.length > 0) {
        throw candidateError('dirty-candidate', 'Release candidate has staged, unstaged, or untracked changes.');
    }
    return {commit, tree};
};

/** @param {{allowedCurrentTag: string | null, candidateCommit: string, candidateTree: string, repositoryRoot: string, runCommand: CandidateCommandRunner}} input */
const loadStableBaseline = async ({allowedCurrentTag, candidateCommit, candidateTree, repositoryRoot, runCommand}) => {
    const reachableTags = (await runGit({
        args: ['tag', '--merged', candidateCommit, '--list'],
        label: 'Reachable tag inventory',
        repositoryRoot,
        runCommand,
    })).split(/\r?\n/).filter((/** @type {string} */ tag) => STABLE_VERSION_PATTERN.test(tag));
    if (reachableTags.some(tag => tag !== allowedCurrentTag && compareVersion(tag, ARW_VERSION) >= 0)) {
        throw candidateError('version-not-advanced', 'Candidate version is not greater than every reachable stable tag.');
    }
    const baselineTag = reachableTags.filter(tag => compareVersion(tag, ARW_VERSION) < 0).sort(compareVersion).at(-1);
    const commit = baselineTag === undefined
        ? null
        : (await runGit({
            args: ['rev-parse', '--verify', `refs/tags/${baselineTag}^{commit}`],
            label: 'Baseline commit',
            repositoryRoot,
            runCommand,
        })).trim();
    const tree = baselineTag === undefined
        ? (await runGit({
            args: ['hash-object', '-t', 'tree', '--stdin'],
            input: '',
            label: 'Empty tree',
            repositoryRoot,
            runCommand,
        })).trim()
        : (await runGit({
            args: ['rev-parse', '--verify', `${commit}^{tree}`],
            label: 'Baseline tree',
            repositoryRoot,
            runCommand,
        })).trim();
    if (commit !== null) assertObjectId(commit, 'Baseline commit', 'baseline-failure');
    assertObjectId(tree, 'Baseline tree', 'baseline-failure');
    const changedPaths = (await runGit({
        args: ['diff', '--name-only', '-z', tree, candidateTree, '--'],
        label: 'Candidate changed paths',
        repositoryRoot,
        runCommand,
    })).split('\0').filter(Boolean).sort(compareText);
    if (changedPaths.some(path => !isSafeRepositoryPath(path))) {
        throw candidateError('baseline-failure', 'Candidate changed paths contain an unsafe Repository path.');
    }
    return {
        baseline: baselineTag === undefined
            ? {commit: null, kind: 'empty-tree', tag: null, tree}
            : {commit, kind: 'stable-tag', tag: baselineTag, tree},
        changedPaths: [...new Set(changedPaths)],
    };
};

/** @param {{remote: string, repositoryRoot: string, runCommand: CandidateCommandRunner}} input */
const loadRemoteTagCommit = async ({remote, repositoryRoot, runCommand}) => {
    const directRef = `refs/tags/${ARW_VERSION}`;
    const peeledRef = `${directRef}^{}`;
    const output = await runGit({
        args: ['ls-remote', '--tags', remote, directRef, peeledRef],
        label: 'Remote version tag check',
        repositoryRoot,
        runCommand,
    });
    const entries = output.split(/\r?\n/).filter(Boolean).map((/** @type {string} */ line) => line.split('\t'));
    if (entries.some(entry => entry.length !== 2
        || !OBJECT_ID_PATTERN.test(entry[0])
        || ![directRef, peeledRef].includes(entry[1]))) {
        throw candidateError('git-failure', 'Remote version tag check returned malformed output.');
    }
    const direct = entries.find(([, ref]) => ref === directRef)?.[0] ?? null;
    const peeled = entries.find(([, ref]) => ref === peeledRef)?.[0] ?? null;
    if ((direct === null) !== (peeled === null) && direct === null) {
        throw candidateError('git-failure', 'Remote version tag check returned an orphan peeled tag.');
    }
    return peeled ?? direct;
};

/**
 * 解析干净 Source Checkout 的 committed HEAD, baseline 和完整 changed paths.
 * @param {object} input
 * @param {unknown} input.phase
 * @param {unknown} [input.releaseConfiguration]
 * @param {unknown} input.remote
 * @param {string} input.repositoryRoot
 * @param {CandidateCommandRunner} [input.runCommand]
 * @param {typeof loadReleaseValidationConfiguration} [input.loadReleaseConfiguration]
 */
export const resolveReleaseCandidate = async ({
    phase,
    releaseConfiguration,
    remote,
    repositoryRoot,
    runCommand = defaultRunCommand,
    loadReleaseConfiguration = loadReleaseValidationConfiguration,
}) => {
    try {
        if (phase !== 'pre-tag' && phase !== 'post-tag') {
            throw candidateError('malformed-input', 'Release candidate phase is invalid.');
        }
        if (remote !== 'origin') {
            throw candidateError('malformed-input', 'Release candidate remote must be origin.');
        }
        const configurationResult = releaseConfiguration === undefined
            ? await loadReleaseConfiguration()
            : validateReleaseValidationConfiguration(releaseConfiguration);
        if (configurationResult.status !== 'succeeded' || !('value' in configurationResult)) {
            throw candidateError('release-configuration-invalid', 'Release validation configuration is invalid.');
        }
        await assertCanonicalRemote({
            canonicalRemote: configurationResult.value.repositories.sourceCheckout.url,
            remote,
            repositoryRoot,
            runCommand,
        });
        const {commit, tree} = await loadCandidateIdentity({repositoryRoot, runCommand});
        const [currentTag, remoteTagCommit] = await Promise.all([
            runGit({
                args: ['tag', '--list', ARW_VERSION],
                label: 'Current version tag check',
                repositoryRoot,
                runCommand,
            }).then(value => value.trim()),
            loadRemoteTagCommit({remote, repositoryRoot, runCommand}),
        ]);
        if (phase === 'pre-tag' && (currentTag.length > 0 || remoteTagCommit !== null)) {
            throw candidateError('unexpected-tag', 'Current version tag already exists locally or remotely.');
        }
        if (phase === 'post-tag' && currentTag !== ARW_VERSION) {
            throw candidateError('missing-tag', 'Current version tag does not exist.');
        }
        if (phase === 'post-tag') {
            const tagCommit = (await runGit({
                args: ['rev-parse', '--verify', `refs/tags/${ARW_VERSION}^{commit}`],
                label: 'Current version tag commit',
                repositoryRoot,
                runCommand,
            })).trim();
            if (tagCommit !== commit) {
                throw candidateError('tag-mismatch', 'Current version tag does not point to the candidate commit.');
            }
            if (remoteTagCommit !== commit) {
                throw candidateError(remoteTagCommit === null ? 'missing-tag' : 'tag-mismatch',
                    remoteTagCommit === null
                        ? 'Remote version tag does not exist.'
                        : 'Remote version tag does not point to the candidate commit.');
            }
        }
        const {baseline, changedPaths} = await loadStableBaseline({
            allowedCurrentTag: phase === 'post-tag' ? ARW_VERSION : null,
            candidateCommit: commit,
            candidateTree: tree,
            repositoryRoot,
            runCommand,
        });
        const candidate = {baseline, changedPaths, commit, tree, version: ARW_VERSION};
        return {
            candidate,
            status: 'resolved',
        };
    } catch (error) {
        const code = error instanceof Error
            && 'candidateCode' in error
            && typeof error.candidateCode === 'string'
            ? error.candidateCode
            : 'candidate-resolution-failed';
        return {
            diagnostics: [{
                code,
                message: error instanceof Error ? error.message : String(error),
                stage: 'candidate',
            }],
            status: 'failed',
        };
    }
};
