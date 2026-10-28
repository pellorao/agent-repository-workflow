// 此文件由 scripts/generate-install-arw.mjs 确定性生成. 请修改 lib/installation/bootstrap.mjs, lib/arw-common/runtime-compatibility.mjs 或 release-validation.json.

import {execFile as execFileCallback, spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';

const loadReleaseValidationConfiguration = async () => ({
    status: 'succeeded',
    value: {repositories: {sourceCheckout: {url: "https://github.com/pellorao/agent-repository-workflow.git"}}},
});

/**
 * @typedef {{status: "unsupported", error: string}} UnsupportedNodeRuntime
 * @typedef {{status: "supported", recommendation: string | null}} SupportedNodeRuntime
 */

/**
 * @param {string} version
 * @returns {UnsupportedNodeRuntime | SupportedNodeRuntime}
 */
const evaluateNodeRuntime = version => {
    const match = /^(0|[1-9][0-9]*)\./.exec(version);
    if (match === null) {
        return {
            error: `ARW cannot determine the active Node.js major version: ${version}.`,
            status: 'unsupported',
        };
    }
    const major = BigInt(match[1]);
    if (major < 24n) {
        return {
            error: `ARW requires Node.js 24 or newer. Current runtime: ${version}.`,
            status: 'unsupported',
        };
    }
    return {
        recommendation: null,
        status: 'supported',
    };
};

const execFile = promisify(execFileCallback);
const STABLE_TAG_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const REMOTE_PATTERN = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/;
const ASSET_NAME = 'arw.tar.gz';
const INSTALLER_RUNTIME_HANDOFF = 'data:text/javascript,globalThis%5BSymbol.for(%22agent-repository-workflow.runtime-recommendation-shown%22)%5D%3Dtrue';

/** @typedef {{arguments: string[], directory: string, tag: string}} InstallerLaunchInput */
/** @typedef {{status: string, value?: {repositories?: {sourceCheckout?: {url?: string}}}}} ReleaseConfiguration */
/** @typedef {{createTemporaryDirectory: () => Promise<string>, download: (url: string) => Promise<Buffer>, extractArchive: (bytes: Buffer, directory: string) => Promise<unknown>, launchInstaller: (input: InstallerLaunchInput) => Promise<number>, loadReleaseConfiguration: () => Promise<ReleaseConfiguration>, removeTemporaryDirectory: (directory: string) => Promise<unknown>, runtimeVersion: string, stderr: (message: string) => void}} BootstrapOptions */

class BootstrapUsageError extends Error {
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

    for (let index = 0; index < args.length; index += 1) {
        if (args[index] !== '--version') {
            installerArguments.push(args[index]);
            continue;
        }
        if (requestedTag !== undefined || index + 1 >= args.length) {
            throw new BootstrapUsageError('--version requires one unrepeated stable release tag.');
        }
        requestedTag = args[index + 1];
        if (!STABLE_TAG_PATTERN.test(requestedTag)) {
            throw new BootstrapUsageError('--version requires a stable MAJOR.MINOR.PATCH tag.');
        }
        index += 1;
    }

    return {installerArguments, requestedTag};
};

/** @param {string} url @returns {Promise<Buffer>} */
const download = async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: ${url} returned HTTP ${response.status}.`);
    return Buffer.from(await response.arrayBuffer());
};

/** @param {Buffer} bytes @param {string} directory */
const extractArchive = async (bytes, directory) => {
    const archive = join(directory, ASSET_NAME);
    await writeFile(archive, bytes);
    try {
        await execFile('tar', ['-xzf', archive, '-C', directory], {windowsHide: true});
    } catch (error) {
        const {message, stderr} = /** @type {{message: string, stderr?: string}} */ (error);
        throw new Error(`Archive extraction failed: ${(String(stderr ?? '').trim() || message).split(/\r?\n/u)[0]}`);
    }
};

/** @param {InstallerLaunchInput} input @returns {Promise<number>} */
const launchInstaller = ({arguments: installerArguments, directory, tag}) => new Promise((resolve, reject) => {
    const child = spawn('node', [
        '--import',
        INSTALLER_RUNTIME_HANDOFF,
        join(directory, 'install.mjs'),
        '--release-tag',
        tag,
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
    download,
    extractArchive,
    launchInstaller,
    loadReleaseConfiguration: loadReleaseValidationConfiguration,
    removeTemporaryDirectory: directory => rm(directory, {force: true, recursive: true}),
    runtimeVersion: process.versions.node,
    stderr: message => process.stderr.write(`${message}\n`),
};

/**
 * 从固定远端的 GitHub release 下载安装压缩包, 解压到临时目录, 并调用其中的 Installer.
 */
/** @param {string[]} args @param {Partial<BootstrapOptions>} [options] @returns {Promise<number>} */
const runBootstrap = async (args, options = {}) => {
    const dependencies = {...defaultOptions, ...options};
    const runtime = evaluateNodeRuntime(dependencies.runtimeVersion);
    if (runtime.status === 'unsupported') {
        throw new Error(runtime.error);
    }
    if (runtime.recommendation !== null) {
        dependencies.stderr(runtime.recommendation);
    }
    const {installerArguments, requestedTag} = parseBootstrapArguments(args);
    const configuration = await dependencies.loadReleaseConfiguration();
    const canonicalRemote = configuration?.status === 'succeeded'
        ? configuration.value?.repositories?.sourceCheckout?.url
        : null;
    const repository = typeof canonicalRemote === 'string' ? REMOTE_PATTERN.exec(canonicalRemote)?.[1] : undefined;
    if (repository === undefined) {
        throw new Error('Release validation configuration does not provide a canonical GitHub HTTPS remote.');
    }
    const directory = await dependencies.createTemporaryDirectory();

    try {
        let tag = requestedTag ?? '';
        if (tag === '') {
            tag = JSON.parse((await dependencies.download(`https://api.github.com/repos/${repository}/releases/latest`)).toString('utf8')).tag_name;
            if (!STABLE_TAG_PATTERN.test(tag)) throw new Error(`The latest ARW release tag is not stable MAJOR.MINOR.PATCH: ${tag}.`);
        }
        await dependencies.extractArchive(
            await dependencies.download(`https://github.com/${repository}/releases/download/${tag}/${ASSET_NAME}`),
            directory,
        );
        return await dependencies.launchInstaller({arguments: installerArguments, directory, tag});
    } finally {
        await dependencies.removeTemporaryDirectory(directory);
    }
};

try {
    process.exitCode = await runBootstrap(process.argv.slice(2));
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof BootstrapUsageError ? error.exitCode : 1;
}
