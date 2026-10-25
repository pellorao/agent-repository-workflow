import {execFile as execFileCallback, spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';

import {evaluateNodeRuntime} from '../arw-common/runtime-compatibility.mjs';
import {loadReleaseValidationConfiguration} from '../release/release-validation-config.mjs';

const execFile = promisify(execFileCallback);
const STABLE_TAG_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const INSTALLER_RUNTIME_HANDOFF = 'data:text/javascript,globalThis%5BSymbol.for(%22agent-repository-workflow.runtime-recommendation-shown%22)%5D%3Dtrue';

/** @typedef {{tag: string, version: bigint[]}} StableRelease */
/** @typedef {{arguments: string[], checkoutDirectory: string, commit: string, explicitVersion: boolean, tag: string}} InstallerLaunchInput */
/** @typedef {{checkoutCommit: (directory: string, commit: string) => Promise<unknown>, fetchRelease: (directory: string, remote: string, tag: string) => Promise<unknown>, initialize: (directory: string) => Promise<unknown>, listRemoteTags: (directory: string, remote: string) => Promise<string[]>, readHead: (directory: string) => Promise<string>, resolveTagCommit: (directory: string, tag: string) => Promise<string>}} BootstrapGit */
/** @typedef {{status: string, value?: {repositories?: {sourceCheckout?: {url?: string}}}}} ReleaseConfiguration */
/** @typedef {{createTemporaryDirectory: () => Promise<string>, git: BootstrapGit, launchInstaller: (input: InstallerLaunchInput) => Promise<number>, loadReleaseConfiguration: () => Promise<ReleaseConfiguration>, removeTemporaryDirectory: (directory: string) => Promise<unknown>, runtimeVersion: string, stderr: (message: string) => void, stdout: (line: string) => void}} BootstrapOptions */

/** @param {string} ref @returns {StableRelease | null} */
const parseStableTag = ref => {
    const tag = ref.startsWith('refs/tags/') ? ref.slice('refs/tags/'.length) : ref;
    const match = STABLE_TAG_PATTERN.exec(tag);
    return match === null
        ? null
        : {tag, version: match.slice(1).map(value => BigInt(value))};
};

/** @param {StableRelease} left @param {StableRelease} right */
const compareVersions = (left, right) => {
    for (let index = 0; index < left.version.length; index += 1) {
        if (left.version[index] < right.version[index]) return -1;
        if (left.version[index] > right.version[index]) return 1;
    }
    return 0;
};

/**
 * 从远程 ref 清单选择最高稳定 SemVer 标签. 预发布版, 分支和非规范标签不参与选择.
 */
/** @param {string[]} refs @param {string} [requestedTag] */
export const selectStableRelease = (refs, requestedTag) => {
    const releases = refs.map(parseStableTag).filter(release => release !== null);
    if (requestedTag !== undefined) {
        if (parseStableTag(requestedTag)?.tag !== requestedTag) {
            throw new Error('Explicit ARW version must be a stable MAJOR.MINOR.PATCH tag.');
        }
        if (!releases.some(release => release.tag === requestedTag)) {
            throw new Error(`The requested ARW release tag does not exist: ${requestedTag}.`);
        }
        return requestedTag;
    }
    if (releases.length === 0) {
        throw new Error('The canonical remote has no stable ARW release tags.');
    }
    releases.sort(compareVersions);
    const latest = releases.at(-1);
    if (latest === undefined) throw new Error('The canonical remote has no stable ARW release tags.');
    return latest.tag;
};

export class BootstrapUsageError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.exitCode = 2;
        this.name = 'BootstrapUsageError';
    }
}

/** @param {string[]} args */
const parseBootstrapArguments = args => {
    const installerArguments = [];
    let requestedTag;
    let verbose = false;

    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === '--verbose') {
            if (verbose) throw new BootstrapUsageError('Bootstrap requires an unrepeated --verbose flag.');
            verbose = true;
            continue;
        }
        if (args[index] !== '--version') {
            installerArguments.push(args[index]);
            continue;
        }
        if (requestedTag !== undefined || index + 1 >= args.length) {
            throw new BootstrapUsageError('--version requires one unrepeated stable release tag.');
        }
        requestedTag = args[index + 1];
        if (parseStableTag(requestedTag)?.tag !== requestedTag) {
            throw new BootstrapUsageError('--version requires a stable MAJOR.MINOR.PATCH tag.');
        }
        index += 1;
    }

    return {installerArguments, requestedTag, verbose};
};

/** @param {string[]} args @returns {Promise<string>} */
const runGit = async args => {
    const {stdout} = await execFile('git', args, {encoding: 'utf8', windowsHide: true});
    return stdout.trim();
};

/** @type {BootstrapGit} */
const defaultGit = {
    checkoutCommit: async (directory, commit) => runGit(['-C', directory, 'checkout', '--quiet', '--detach', commit]),
    fetchRelease: async (directory, remote, tag) => runGit([
        '-C',
        directory,
        'fetch',
        '--quiet',
        '--no-tags',
        remote,
        `refs/tags/${tag}:refs/tags/${tag}`,
    ]),
    initialize: async directory => {
        await runGit(['init', '--quiet', directory]);
        return runGit(['-C', directory, 'config', '--local', 'core.autocrlf', 'false']);
    },
    listRemoteTags: async (directory, remote) => {
        const output = await runGit(['-C', directory, 'ls-remote', '--tags', '--refs', remote]);
        return output.length === 0 ? [] : output.split(/\r?\n/).map(line => {
            const ref = line.split(/\s+/).at(-1);
            if (ref === undefined) throw new Error('Git returned an invalid remote tag line.');
            return ref;
        });
    },
    readHead: async directory => runGit(['-C', directory, 'rev-parse', '--verify', 'HEAD']),
    resolveTagCommit: async (directory, tag) => {
        const commit = await runGit(['-C', directory, 'rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
        if (!COMMIT_PATTERN.test(commit)) {
            throw new Error(`Git returned an invalid release commit for ${tag}.`);
        }
        return commit;
    },
};

/** @param {InstallerLaunchInput} input @returns {Promise<number>} */
const launchInstaller = ({arguments: installerArguments, checkoutDirectory, commit, explicitVersion, tag}) => new Promise((resolve, reject) => {
    const child = spawn('node', [
        '--import',
        INSTALLER_RUNTIME_HANDOFF,
        join(checkoutDirectory, 'install.mjs'),
        '--release-tag',
        tag,
        '--release-commit',
        commit,
        '--selection-mode',
        explicitVersion ? 'explicit' : 'latest',
        ...installerArguments,
    ], {
        stdio: 'inherit',
        windowsHide: true,
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
        if (signal !== null) {
            reject(new Error(`Versioned Installer was terminated by signal ${signal}.`));
            return;
        }
        resolve(code ?? 1);
    });
});

/** @type {BootstrapOptions} */
const defaultOptions = {
    createTemporaryDirectory: () => mkdtemp(join(tmpdir(), 'agent-repository-workflow-')),
    git: defaultGit,
    launchInstaller,
    loadReleaseConfiguration: loadReleaseValidationConfiguration,
    removeTemporaryDirectory: directory => rm(directory, {force: true, recursive: true}),
    runtimeVersion: process.versions.node,
    stderr: message => process.stderr.write(`${message}\n`),
    stdout: line => process.stdout.write(line),
};

/** @param {(line: string) => void} stdout @param {Record<string, string>} event */
const writeEvent = (stdout, event) => stdout(`${JSON.stringify(event)}\n`);

/**
 * 从固定远程取得精确 Release checkout, 验证本次解析的 commit, 并调用该版本的 Installer.
 */
/** @param {string[]} args @param {Partial<BootstrapOptions>} [options] @returns {Promise<number>} */
export const runBootstrap = async (args, options = {}) => {
    const dependencies = {...defaultOptions, ...options, git: options.git ?? defaultOptions.git};
    const runtime = evaluateNodeRuntime(dependencies.runtimeVersion);
    if (runtime.status === 'unsupported') {
        throw new Error(runtime.error);
    }
    if (runtime.recommendation !== null) {
        dependencies.stderr(runtime.recommendation);
    }
    const {installerArguments, requestedTag, verbose} = parseBootstrapArguments(args);
    const configuration = await dependencies.loadReleaseConfiguration();
    const canonicalRemote = configuration?.status === 'succeeded'
        ? configuration.value?.repositories?.sourceCheckout?.url
        : null;
    if (typeof canonicalRemote !== 'string' || canonicalRemote.length === 0) {
        throw new Error('Release validation configuration does not provide the canonical remote.');
    }
    const checkoutDirectory = await dependencies.createTemporaryDirectory();

    try {
        await dependencies.git.initialize(checkoutDirectory);
        const refs = await dependencies.git.listRemoteTags(checkoutDirectory, canonicalRemote);
        const tag = selectStableRelease(refs, requestedTag);
        if (verbose) writeEvent(dependencies.stdout, {event: 'release-selected', tag});
        await dependencies.git.fetchRelease(checkoutDirectory, canonicalRemote, tag);
        const commit = await dependencies.git.resolveTagCommit(checkoutDirectory, tag);
        if (verbose) writeEvent(dependencies.stdout, {commit, event: 'tag-resolved', tag});
        await dependencies.git.checkoutCommit(checkoutDirectory, commit);
        const head = await dependencies.git.readHead(checkoutDirectory);
        if (head !== commit) {
            throw new Error(`Temporary checkout HEAD does not match resolved release commit: ${tag}.`);
        }
        if (verbose) writeEvent(dependencies.stdout, {commit, event: 'checkout-verified'});
        return await dependencies.launchInstaller({
            arguments: installerArguments,
            checkoutDirectory,
            commit,
            explicitVersion: requestedTag !== undefined,
            tag,
        });
    } finally {
        await dependencies.removeTemporaryDirectory(checkoutDirectory);
    }
};
