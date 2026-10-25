import {readBatchBlobs} from '../common/git-content.mjs';
import {joinRelativePath} from '../common/filesystem.mjs';

const WORKFLOW_LOCK_PATH = 'arw-lock.json';
/** @typedef {{code: number | null, failure: 'process' | 'timeout' | null, stderr: string, stdout: Buffer}} GitProcessResult */
/** @typedef {{run: (input: {argv: string[], input?: Buffer | string}) => Promise<GitProcessResult>}} GitRunner */
/** @typedef {{kind: string}} PathObservation */
/** @typedef {{inspectPath: (input: {phase: number, path: string}) => Promise<PathObservation>, readBytes: (input: {phase: number, path: string}) => Promise<Buffer>}} RepositoryFilesystem */
/** @typedef {{bytes: Buffer | null, observed: PathObservation}} RepositoryFile */
/** @typedef {{mode: string, objectId: string, path: string}} CandidateTreeEntry */

/** @param {string} left @param {string} right */
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
/** @param {string[]} values */
const uniqueSorted = values => [...new Set(values)].sort(compareText);
/** @param {Buffer} bytes */
const nulPaths = bytes => bytes.toString('utf8').split('\0').filter(Boolean);
const isGitMetadataPath = (/** @type {string} */ path) => path.split('/')[0]?.toLowerCase() === '.git';

/** @param {string} message @param {GitProcessResult} result @returns {NodeJS.ErrnoException} */
const failedGitRead = (message, result) => {
    /** @type {NodeJS.ErrnoException} */
    const error = new Error(message);
    error.code = result.failure === 'timeout' ? 'ETIMEDOUT' : 'EIO';
    return error;
};

/** @param {GitProcessResult} result @param {string} message @returns {GitProcessResult} */
const requireGitSuccess = (result, message) => {
    if (result.failure !== null || result.code !== 0) throw failedGitRead(message, result);
    return result;
};

/** @param {{argv: string[], git: GitRunner, paths: string[]}} input */
const runCheckIgnore = async ({argv, git, paths}) => {
    if (paths.length === 0) return [];
    const result = await git.run({
        argv,
        input: Buffer.from(`${paths.join('\0')}\0`, 'utf8'),
    });
    if (result.failure !== null || typeof result.code !== 'number' || ![0, 1].includes(result.code)) {
        throw failedGitRead('Git ignore facts could not be read.', result);
    }
    return result.code === 0 ? uniqueSorted(nulPaths(result.stdout)) : [];
};

const withinRoot = (/** @type {string} */ path, /** @type {string} */ root) => root === '.' || path === root || path.startsWith(`${root}/`);

/** @param {{gitVisiblePaths: string[], paths: string[], roots: string[]}} input */
const policyCandidates = ({gitVisiblePaths, paths, roots}) => uniqueSorted([
    ...paths,
    ...roots.flatMap((/** @type {string} */ root) => [root, root === '.' ? 'arw-code-map-probe' : joinRelativePath(root, 'arw-code-map-probe')]),
    ...gitVisiblePaths.filter(path => roots.some(root => withinRoot(path, root))),
]);

/** @param {{filesystem: RepositoryFilesystem, path: string}} input @returns {Promise<RepositoryFile>} */
const readPath = async ({filesystem, path}) => {
    const observed = await filesystem.inspectPath({phase: 1, path});
    return {
        bytes: observed.kind === 'file' ? await filesystem.readBytes({phase: 1, path}) : null,
        observed,
    };
};

/**
 * 解析 `git status --porcelain=v1 -z` 的精确字节, 返回带双列状态码与 Repository 相对路径的事实项.
 * 重命名与复制记录后的第二个 NUL 分隔路径使用同一状态码单独返回, 使调用方无需保留 Git 输出解析语义.
 */
export const parsePorcelainStatus = (/** @type {Buffer<ArrayBufferLike>} */ bytes) => {
    const records = bytes.toString('utf8').split('\0').filter(Boolean);
    const entries = [];
    for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        const code = record.slice(0, 2);
        entries.push({code, path: record.slice(3)});
        if (code.includes('R') || code.includes('C')) {
            const renamedPath = records[index + 1];
            if (renamedPath !== undefined) {
                entries.push({code, path: renamedPath});
                index += 1;
            }
        }
    }
    return entries;
};

/** @param {{git: GitRunner, paths: string[], policyAvailable: boolean, roots: string[]}} input */
const readGitFacts = async ({git, paths, policyAvailable, roots}) => {
    const [status, tracked] = await Promise.all([
        git.run({argv: ['status', '--porcelain=v1', '-z', '--untracked-files=all']}),
        git.run({argv: ['ls-files', '--cached', '--full-name', '-z']}),
    ]);
    requireGitSuccess(status, 'Git status could not be read.');
    requireGitSuccess(tracked, 'Git tracked inventory could not be read.');
    const entries = parsePorcelainStatus(status.stdout).sort((left, right) => (
        compareText(left.path, right.path) || compareText(left.code, right.code)
    ));
    const trackedPaths = uniqueSorted(nulPaths(tracked.stdout));
    const untracked = uniqueSorted(entries.filter(entry => entry.code === '??').map(entry => entry.path));
    const gitVisiblePaths = uniqueSorted([...trackedPaths, ...untracked]);
    const exclusionCandidates = policyCandidates({gitVisiblePaths, paths, roots});
    const [ignoredPaths, agentScopeExcludedPaths] = await Promise.all([
        runCheckIgnore({
            argv: ['check-ignore', '--no-index', '--stdin', '-z'],
            git,
            paths,
        }),
        policyAvailable
            ? runCheckIgnore({
                argv: ['-c', 'core.excludesFile=.arwignore', 'check-ignore', '--no-index', '--stdin', '-z'],
                git,
                paths: exclusionCandidates,
            })
            : [],
    ]);
    return {
        agentScopeExcludedPaths,
        conflicts: uniqueSorted(entries
            .filter(entry => ['AA', 'DD', 'AU', 'UA', 'DU', 'UD', 'UU'].includes(entry.code))
            .map(entry => entry.path)),
        entries,
        excludedPaths: uniqueSorted([
            ...ignoredPaths,
            ...agentScopeExcludedPaths,
            ...exclusionCandidates.filter(isGitMetadataPath),
        ]),
        gitVisiblePaths,
        ignoredPaths,
        trackedPaths,
        unstaged: uniqueSorted(entries.filter(entry => entry.code !== '??' && entry.code[1] !== ' ').map(entry => entry.path)),
        untracked,
    };
};

/**
 * 生产 Adapter 按完整观察请求批量收集 lock, `.arwignore` 和 Git 原始事实.
 * 它不解释 Profile, glob, README 身份, 覆盖范围, 所有权或计划语义.
 * @param {{filesystem: RepositoryFilesystem, git: GitRunner, repositoryRoot: string}} input
 */
export const createNodeRepositoryStateInspector = ({filesystem, git, repositoryRoot}) => ({
    /** @param {{repositoryLocation?: string, request?: {paths?: string[], roots?: string[]}}} input */
    async inspect({repositoryLocation = repositoryRoot, request = {paths: [], roots: []}}) {
        const paths = uniqueSorted(request.paths ?? []);
        const roots = uniqueSorted(request.roots ?? []);
        const factPaths = uniqueSorted([...paths, ...roots, WORKFLOW_LOCK_PATH, '.arwignore']);
        const facts = await Promise.all(factPaths.map(async path => {
            /** @type {[string, RepositoryFile]} */
            const entry = [path, await readPath({filesystem, path})];
            return entry;
        }));
        const files = Object.fromEntries(facts);
        const lock = files[WORKFLOW_LOCK_PATH];
        const policy = files['.arwignore'].observed;
        const gitFacts = await readGitFacts({
            git,
            paths: uniqueSorted([...paths, ...roots]),
            policyAvailable: policy.kind === 'file',
            roots,
        });
        return {
            files,
            git: gitFacts,
            lock,
            policy,
            repositoryRoot: repositoryLocation,
            request: {paths, roots},
        };
    },
});

/** @template T @param {T[]} states */
export const createDeterministicRepositoryStateInspector = states => {
    let index = 0;
    return {
        async inspect() {
            if (index >= states.length) throw new Error('No deterministic repositoryState remains.');
            const state = states[index];
            index += 1;
            return state;
        },
    };
};

/** @param {Buffer} bytes */
const parseIndexTreeEntries = bytes => nulPaths(bytes).map((/** @type {string} */ record) => {
    const match = /^(\d{6}) ([0-9a-f]{40,64}) (\d)\t(.+)$/.exec(record);
    if (!match) throw new Error('Git staged index contains a malformed entry.');
    return {mode: match[1], objectId: match[2], path: match[4], stage: Number(match[3])};
});

/** @param {Buffer} bytes */
const parseHeadTreeEntries = bytes => nulPaths(bytes).map((/** @type {string} */ record) => {
    const match = /^(\d{6}) (blob|commit) ([0-9a-f]{40,64})\t(.+)$/.exec(record);
    if (!match) throw new Error('Git HEAD tree contains a malformed entry.');
    return {mode: match[1], objectId: match[3], path: match[4], type: match[2]};
});

/** @param {{blobs: Map<string, Buffer>, entries: CandidateTreeEntry[]}} input */
const candidateFiles = ({blobs, entries}) => {
    return new Map(entries.map(entry => [entry.path, {
        bytes: entry.mode === '160000' ? null : blobs.get(entry.objectId) ?? null,
        mode: entry.mode,
        objectId: entry.objectId,
    }]));
};

/**
 * 读取完整 Git index 与 HEAD tree 的原始字节事实, 供只读提交候选审核使用.
 * 它不解释 issue, audit JSON, locator 或任何工作流门禁语义.
 * @param {{git: GitRunner}} input
 */
export const readStagedCandidate = async ({git}) => {
    const [indexResult, headResult] = await Promise.all([
        git.run({argv: ['ls-files', '--stage', '-z']}),
        git.run({argv: ['rev-parse', '--verify', 'HEAD^{commit}']}),
    ]);
    requireGitSuccess(indexResult, 'Git staged index could not be read.');
    if (headResult.failure !== null) throw failedGitRead('Git HEAD could not be read.', headResult);
    const indexEntries = parseIndexTreeEntries(indexResult.stdout);
    if (indexEntries.some((/** @type {{ stage: number; }} */ entry) => entry.stage !== 0)) throw new Error('Git staged index contains unmerged entries.');
    const headEntries = [];
    if (headResult.code === 0) {
        const treeResult = await git.run({argv: ['ls-tree', '-r', '-z', 'HEAD']});
        requireGitSuccess(treeResult, 'Git HEAD tree could not be read.');
        headEntries.push(...parseHeadTreeEntries(treeResult.stdout));
    }
    const blobs = await readBatchBlobs({
        git,
        objectIds: uniqueSorted([...indexEntries, ...headEntries]
            .filter(entry => entry.mode !== '160000')
            .map(entry => entry.objectId)),
    });
    const files = candidateFiles({blobs, entries: indexEntries});
    const headFiles = candidateFiles({blobs, entries: headEntries});
    const changedPaths = uniqueSorted([...new Set([...files.keys(), ...headFiles.keys()])]
        .filter(path => files.get(path)?.objectId !== headFiles.get(path)?.objectId || files.get(path)?.mode !== headFiles.get(path)?.mode));
    return {changedPaths, files, headFiles};
};
