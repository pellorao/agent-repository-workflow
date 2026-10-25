import {globToRegExp} from '../common/path-pattern.mjs';
import {posix} from 'node:path';

import {createScopedFilesystem, joinRelativePath} from '../common/filesystem.mjs';
import {createNodeGitRunner} from '../common/git-process.mjs';
import {jsonSemanticallyEqual} from '../common/json.mjs';
import {parseWorkflowLock} from './workflow-lock.mjs';

const WORKFLOW_LOCK_PATH = 'arw-lock.json';
/** @typedef {{blocking: boolean, code: string, message: string, path?: string, phase: number}} CodeMapDiagnostic */
/** @typedef {{excludes: string[], includes: string[], roots: string[]}} CodeMapProfile */
/** @typedef {{agentScopeExcluded?: boolean, kind: string, path: string, symbolicLinkAncestor?: boolean}} PathObservation */
/** @typedef {{bytes?: Buffer | string, frontmatterBytes?: Buffer, kind: string, path: string}} ReadmeObservation */
/** @typedef {ReadmeObservation & {duplicates?: Set<string>, identity: string, kindValue?: string, text?: string, versionValue?: string}} ParsedReadme */
/** @typedef {{inspectPath: (input: {path: string, phase?: number}) => Promise<PathObservation>, listDirectory: (input: {path: string, phase?: number}) => Promise<{kind: string, name: string}[]>, readBytes: (input: {path: string, phase?: number}) => Promise<Buffer>, readFrontmatterBytes: (input: {path: string, phase?: number}) => Promise<Buffer>}} CodeMapFilesystem */
/** @typedef {{run: (input: {argv: string[], input?: Buffer}) => Promise<{code: number | null, failure: string | null, stdout: Buffer}>}} CodeMapGit */
/** @typedef {{git: {agentScopeExcludedPaths: string[], gitVisiblePaths: string[]}}} CodeMapRepositoryState */
/** @typedef {{agentScopeExcludedPaths: string[], gitVisibleEntries: PathObservation[], identityScanRoots?: string[], profile: CodeMapProfile, readmes: ReadmeObservation[], rootObservations: PathObservation[], traversalSymbolicLinks?: string[]}} CodeMapVerificationInput */

/** @param {string} left @param {string} right */
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/** @param {CodeMapDiagnostic} left @param {CodeMapDiagnostic} right */
const compareDiagnostic = (left, right) => (
    (left.phase ?? 0) - (right.phase ?? 0)
    || compareText(left.path ?? '', right.path ?? '')
    || compareText(left.code, right.code)
);

/** @param {string} code @param {string} message @param {{blocking?: boolean, path?: string, phase?: number}} [fields] @returns {CodeMapDiagnostic} */
const diagnostic = (code, message, fields = {}) => ({
    blocking: fields.blocking ?? true,
    code,
    message,
    phase: fields.phase ?? 1,
    ...(fields.path === undefined ? {} : {path: fields.path}),
});

/** @param {string[]} values */
const uniqueSorted = values => [...new Set(values)].sort(compareText);
const codeMapHeadings = Object.freeze({
    directory: ['Overview', 'Directory Or File List', 'Directory Or File Relationships', 'Usage', 'Modification Boundaries', 'Related Documents'],
    module: ['Overview', 'Directory Or File List', 'Directory Or File Relationships', 'Public Interface', 'Reading Entry Points', 'Modification Boundaries', 'Related Documents'],
});

/** @param {string} path @param {string[]} patterns */
const matchesAny = (path, patterns) => patterns.some(pattern => globToRegExp(pattern).test(path));
const withinRoot = (/** @type {string} */ path, /** @type {string} */ root) => root === '.' || path === root || path.startsWith(`${root}/`);
const readmePath = (/** @type {string} */ directory) => directory === '.' ? 'README.md' : joinRelativePath(directory, 'README.md');

/** @param {string} file @param {string[]} roots */
const requiredAncestors = (file, roots) => {
    const root = roots.find(candidate => withinRoot(file, candidate));
    if (root === undefined) return [];
    const required = [];
    let directory = posix.dirname(file);
    while (directory !== '.' && withinRoot(directory, root)) {
        required.push(directory);
        if (directory === root) break;
        directory = posix.dirname(directory);
    }
    if (root === '.') required.push('.');
    return required;
};

/** @param {Buffer} bytes */
const frontmatterBytes = bytes => {
    if (!bytes.subarray(0, 4).equals(Buffer.from('---\n', 'utf8'))) return bytes.subarray(0, 4);
    const delimiter = Buffer.from('\n---\n', 'utf8');
    const end = bytes.indexOf(delimiter, 4);
    return end < 0 ? bytes : bytes.subarray(0, end + delimiter.length);
};

/** @param {string} repositoryRoot @returns {Promise<CodeMapFilesystem>} */
const createCodeMapFilesystem = async repositoryRoot => {
    const created = await createScopedFilesystem({root: repositoryRoot});
    if (created.status !== 'succeeded') throw new Error('Code Map Repository filesystem is unavailable.');
    const scopedFilesystem = created.scopedFilesystem;
    const inspectPath = async (/** @type {{path: string}} */ {path}) => {
        const inspected = await scopedFilesystem.inspect({path});
        if (inspected.status === 'blocked' && inspected.diagnostics.some(entry => entry.code === 'filesystem-link-unsupported')) {
            return {kind: 'symbolic-link', path};
        }
        if (inspected.status !== 'succeeded' || inspected.entry === undefined) {
            throw new Error(`Code Map path is unavailable: ${path}.`);
        }
        return {kind: inspected.entry.kind, path: inspected.entry.path};
    };
    const readBytes = async (/** @type {{path: string}} */ {path}) => {
        const read = await scopedFilesystem.read({path});
        if (read.status !== 'succeeded') throw new Error(`Code Map file is unavailable: ${path}.`);
        return read.bytes;
    };
    return {
    inspectPath,
    async listDirectory(/** @type {{path: string}} */ {path}) {
        const observed = await inspectPath({path});
        if (observed.kind !== 'directory') throw new Error(`Code Map directory is unavailable: ${path}.`);
        const listed = await scopedFilesystem.list({path});
        if (listed.status !== 'succeeded') throw new Error(`Code Map directory is unavailable: ${path}.`);
        return listed.entries.map(entry => ({
                kind: entry.kind === 'link' ? 'symbolic-link' : entry.kind,
                name: posix.basename(entry.path),
            }))
            .sort((left, right) => compareText(left.name, right.name));
    },
    readBytes,
    async readFrontmatterBytes(/** @type {{path: string}} */ {path}) {
        return frontmatterBytes(await readBytes({path}));
    },
    };
};

/** @param {ReadmeObservation} readme @returns {ParsedReadme} */
const parseReadme = readme => {
    const identityBytes = readme.frontmatterBytes ?? readme.bytes ?? '';
    const identityBuffer = Buffer.isBuffer(identityBytes) ? identityBytes : Buffer.from(identityBytes, 'utf8');
    if (!identityBuffer.subarray(0, 4).equals(Buffer.from('---\n', 'utf8'))) {
        return {...readme, identity: 'ordinary'};
    }
    let identityText;
    try {
        identityText = new TextDecoder('utf-8', {fatal: true}).decode(
            identityBuffer,
        );
    } catch {
        return {...readme, identity: 'invalid-text'};
    }
    let text = identityText;
    if (readme.bytes !== undefined && readme.frontmatterBytes !== undefined) {
        try {
            text = new TextDecoder('utf-8', {fatal: true}).decode(
                Buffer.isBuffer(readme.bytes) ? readme.bytes : Buffer.from(readme.bytes, 'utf8'),
            );
        } catch {
            return {...readme, identity: 'invalid-text'};
        }
    }
    if (!identityText.startsWith('---\n')) return {...readme, identity: 'ordinary', text};
    const end = identityText.indexOf('\n---\n', 4);
    if (end < 0) return {...readme, identity: 'ordinary', text};
    const fields = new Map();
    const duplicates = new Set();
    for (const line of identityText.slice(4, end).split('\n')) {
        const match = /^([^:]+):[ \t]*(.*)$/.exec(line);
        if (!match) continue;
        if (fields.has(match[1])) duplicates.add(match[1]);
        fields.set(match[1], match[2]);
    }
    const hasVersion = fields.has('code-map-version');
    const hasKind = fields.has('code-map-kind');
    return {
        ...readme,
        duplicates,
        identity: hasVersion || hasKind ? 'code-map' : 'ordinary',
        kindValue: fields.get('code-map-kind'),
        text,
        versionValue: fields.get('code-map-version'),
    };
};

/** @param {ParsedReadme} readme */
const validateRequiredReadme = readme => {
    /** @type {CodeMapDiagnostic[]} */
    const diagnostics = [];
    if (readme.kind !== 'file') {
        diagnostics.push(diagnostic(
            'unsafe-code-map-readme',
            'Required Code Map README must be a regular file.',
            {path: readme.path, phase: 2},
        ));
        return diagnostics;
    }
    if (readme.identity === 'invalid-text') {
        diagnostics.push(diagnostic(
            'invalid-code-map-text',
            'Required Code Map README is not valid UTF-8.',
            {path: readme.path, phase: 2},
        ));
        return diagnostics;
    }
    if (readme.identity === 'ordinary') {
        diagnostics.push(diagnostic(
            'ordinary-readme-at-code-map-path',
            'Required Code Map path contains an ordinary README; Human choice is required.',
            {path: readme.path, phase: 3},
        ));
        return diagnostics;
    }
    if (
        readme.versionValue === undefined
        || readme.kindValue === undefined
        || readme.duplicates === undefined
        || readme.duplicates.has('code-map-version')
        || readme.duplicates.has('code-map-kind')
    ) {
        diagnostics.push(diagnostic(
            'invalid-code-map-identity',
            'Code Map frontmatter must contain one version and one kind field.',
            {path: readme.path, phase: 3},
        ));
        return diagnostics;
    }
    if (readme.versionValue !== '1') {
        diagnostics.push(diagnostic(
            'unsupported-code-map-version',
            'Code Map version is unsupported; audit all configured Code Maps for migration.',
            {path: readme.path, phase: 3},
        ));
        return diagnostics;
    }
    if (readme.kindValue !== 'directory' && readme.kindValue !== 'module') {
        diagnostics.push(diagnostic(
            'invalid-code-map-kind',
            'Code Map kind must be module or directory.',
            {path: readme.path, phase: 3},
        ));
        return diagnostics;
    }
    if (readme.text === undefined) throw new Error('Code Map README text is unavailable.');
    const observedHeadings = [...readme.text.matchAll(/^## (.+)$/gm)].map(match => match[1]);
    if (!jsonSemanticallyEqual(observedHeadings, codeMapHeadings[readme.kindValue])) {
        diagnostics.push(diagnostic(
            'invalid-code-map-headings',
            'Code Map headings do not match the versioned kind structure and order.',
            {path: readme.path, phase: 3},
        ));
    }
    return diagnostics;
};

/**
 * 使用调用方提供的 Profile, Git 清单, Agent 范围结果和 README 观察结果验证 Code Map 约定.
 * Interface 只计算确定性结果, 不读取 Repository, 不写文件, 也不生成 README 叙述.
 */
/** @param {CodeMapVerificationInput} input */
export const verifyCodeMaps = ({
    agentScopeExcludedPaths,
    gitVisibleEntries,
    identityScanRoots,
    profile,
    readmes,
    rootObservations,
    traversalSymbolicLinks = [],
}) => {
    /** @type {CodeMapDiagnostic[]} */
    const diagnostics = [];
    if (profile.roots.length === 0 && (profile.includes.length > 0 || profile.excludes.length > 0)) {
        diagnostics.push(diagnostic(
            'inapplicable-code-map-option',
            'Code Map includes and excludes require at least one root.',
        ));
    }
    if (profile.roots.length > 0 && profile.includes.length === 0) {
        diagnostics.push(diagnostic(
            'missing-code-map-include',
            'Code Map roots require at least one include glob.',
        ));
    }
    diagnostics.push(...rootObservations
        .filter((/** @type {{ kind: string; }} */ observation) => observation.kind === 'missing')
        .map(observation => diagnostic(
            'dormant-code-map-root',
            'Configured Code Map root is dormant because it does not exist.',
            {blocking: false, path: observation.path},
        ))
        .sort(compareDiagnostic));
    for (const observation of rootObservations) {
        if (!['directory', 'missing'].includes(observation.kind)) {
            diagnostics.push(diagnostic(
                'invalid-code-map-root',
                'Configured Code Map root must be a real directory.',
                {path: observation.path},
            ));
        }
        if (observation.agentScopeExcluded) {
            diagnostics.push(diagnostic(
                'excluded-code-map-root',
                'Configured Code Map root is fully excluded by .arwignore.',
                {path: observation.path},
            ));
        }
        if (profile.roots.some(other => other !== observation.path && withinRoot(observation.path, other))) {
            diagnostics.push(diagnostic(
                'nested-code-map-root',
                'Configured Code Map root is already covered by an outer recursive root.',
                {path: observation.path},
            ));
        }
    }
    for (const path of traversalSymbolicLinks) {
        diagnostics.push(diagnostic(
            'code-map-traversal-symbolic-link',
            'Code Map traversal must not enter a symbolic link.',
            {path, phase: 2},
        ));
    }

    const liveRoots = rootObservations
        .filter((/** @type {{ kind: string; }} */ observation) => observation.kind === 'directory')
        .map(observation => observation.path)
        .filter(root => !profile.roots.some(other => other !== root && withinRoot(root, other)));
    const excluded = new Set(agentScopeExcludedPaths);
    const candidateFiles = [];
    for (const entry of gitVisibleEntries) {
        if (!liveRoots.some(root => withinRoot(entry.path, root))) continue;
        if (posix.basename(entry.path) === 'README.md') continue;
        if (excluded.has(entry.path)) continue;
        if (!matchesAny(entry.path, profile.includes) || matchesAny(entry.path, profile.excludes)) continue;
        if (entry.kind === 'symbolic-link' || entry.symbolicLinkAncestor) {
            diagnostics.push(diagnostic(
                'code-map-candidate-symbolic-link',
                'Code Map candidate must not be a symbolic link or enter one.',
                {path: entry.path},
            ));
            continue;
        }
        if (entry.kind === 'file') candidateFiles.push(entry.path);
    }

    const requiredDirectories = uniqueSorted(candidateFiles.flatMap(file => requiredAncestors(file, liveRoots)));
    const requiredPaths = requiredDirectories.map(readmePath);
    const parsedReadmes = readmes.map(parseReadme);
    const readmeByPath = new Map(parsedReadmes.map(readme => [readme.path, readme]));
    const missingReadmes = [];
    for (const path of requiredPaths) {
        const readme = readmeByPath.get(path);
        if (readme === undefined) {
            missingReadmes.push(path);
            diagnostics.push(diagnostic(
                'missing-code-map-readme',
                'Required Code Map README is missing; audit complete configured coverage.',
                {path, phase: 3},
            ));
            continue;
        }
        if (readme.identity === 'ordinary') missingReadmes.push(path);
        diagnostics.push(...validateRequiredReadme(readme));
    }
    const requiredPathSet = new Set(requiredPaths);
    const identityRoots = identityScanRoots ?? liveRoots;
    const orphanReadmes = uniqueSorted(parsedReadmes
        .filter((/** @type {{ identity: string; path: string; }} */ readme) => (
            readme.identity === 'code-map'
            && identityRoots.some(root => withinRoot(readme.path, root))
            && !requiredPathSet.has(readme.path)
        ))
        .map(readme => readme.path));
    for (const path of orphanReadmes) {
        diagnostics.push(diagnostic(
            'orphan-code-map-readme',
            'Code Map README is outside required coverage; use explicit workflow init handling.',
            {path, phase: 3},
        ));
    }

    return {
        applicable: profile.roots.length > 0,
        candidateFiles: uniqueSorted(candidateFiles),
        diagnostics: diagnostics.sort(compareDiagnostic),
        missingReadmes,
        orphanReadmes,
        requiredDirectories,
        satisfied: !diagnostics.some(entry => entry.blocking),
    };
};

/** @param {string} code @param {string} message @param {string} [path] */
const failedVerification = (code, message, path = undefined) => ({
    applicable: false,
    candidateFiles: [],
    diagnostics: [diagnostic(code, message, {path})],
    missingReadmes: [],
    orphanReadmes: [],
    requiredDirectories: [],
    satisfied: false,
});

const gitPaths = (/** @type {{stdout: Buffer}} */ result) => result.stdout.toString('utf8').split('\0').filter(Boolean);

/** @param {CodeMapGit} git @param {string[]} argv @param {Buffer} [input] */
const runGit = async (git, argv, input = undefined) => {
    const result = await git.run({argv, input});
    if (result.failure !== null || result.code === null || ![0, 1].includes(result.code)) {
        throw new Error(`Git command failed: git ${argv.join(' ')}.`);
    }
    return result;
};

/** @param {{git: CodeMapGit, paths: string[], policy: boolean}} input */
const ignoredPaths = async ({git, paths, policy}) => {
    if (paths.length === 0) return new Set();
    const argv = [
        ...(policy ? ['-c', 'core.excludesFile=.arwignore'] : []),
        'check-ignore',
        '--no-index',
        '--stdin',
        '-z',
    ];
    const result = await runGit(git, argv, Buffer.from(`${paths.join('\0')}\0`, 'utf8'));
    return result.code === 0 ? new Set(gitPaths(result)) : new Set();
};

/** @param {{git: CodeMapGit, root: string, policy: boolean}} input */
const rootIgnoreState = async ({git, root, policy}) => {
    const probe = root === '.' ? 'arw-code-map-probe' : joinRelativePath(root, 'arw-code-map-probe');
    const ignored = await ignoredPaths({git, paths: [root, probe], policy});
    return ignored.size > 0;
};

/** @param {{filesystem: CodeMapFilesystem, requiredPaths: Set<string>, roots: string[]}} input */
const scanReadmes = async ({filesystem, requiredPaths, roots}) => {
    /** @type {ReadmeObservation[]} */
    const readmes = [];
    /** @type {string[]} */
    const traversalSymbolicLinks = [];
    const visit = async (/** @type {string} */ directory) => {
        const entries = await filesystem.listDirectory({phase: 2, path: directory});
        for (const entry of entries) {
            const path = directory === '.' ? entry.name : joinRelativePath(directory, entry.name);
            if (entry.kind === 'symbolic-link' && entry.name !== 'README.md') {
                traversalSymbolicLinks.push(path);
                continue;
            }
            if (entry.kind === 'directory' && entry.name !== '.git') {
                await visit(path);
                continue;
            }
            if (entry.name !== 'README.md') continue;
            readmes.push({
                ...(entry.kind === 'file'
                    ? {
                        ...(requiredPaths.has(path) ? {bytes: await filesystem.readBytes({phase: 2, path})} : {}),
                        frontmatterBytes: await filesystem.readFrontmatterBytes({phase: 2, path}),
                    }
                    : {}),
                kind: entry.kind,
                path,
            });
        }
    };
    for (const root of roots) await visit(root);
    return {
        readmes: [...new Map(readmes.map(readme => [readme.path, readme])).values()]
            .sort((left, right) => compareText(left.path, right.path)),
        traversalSymbolicLinks: uniqueSorted(traversalSymbolicLinks),
    };
};

/**
 * 收集 Code Map Module Interface 所需的 Git 可见项, `.arwignore`, 根目录与 README 观察结果.
 * `scanRoots` 可以包含旧 Profile 的 `roots`, 以便 init 在 Profile 收窄后继续仅依据 frontmatter 扫描孤立文档.
 */
/** @param {{filesystem: CodeMapFilesystem, git?: CodeMapGit, policyAvailable: boolean, profile: CodeMapProfile, repositoryState?: CodeMapRepositoryState, scanRoots?: string[]}} input */
export const inspectCodeMapCoverage = async ({
    filesystem,
    git,
    policyAvailable,
    profile,
    repositoryState,
    scanRoots = profile.roots,
}) => {
    if (repositoryState === undefined && git === undefined) {
        throw new Error('Code Map inspection requires Git when Repository state is not supplied.');
    }
    const requiredGit = () => {
        if (git === undefined) throw new Error('Code Map inspection requires Git for live Repository queries.');
        return git;
    };
    const paths = repositoryState === undefined
        ? gitPaths(await runGit(requiredGit(), ['ls-files', '--cached', '--others', '--exclude-standard', '--full-name', '-z']))
        : repositoryState.git.gitVisiblePaths;
    const excluded = repositoryState === undefined
        ? policyAvailable
            ? await ignoredPaths({git: requiredGit(), paths, policy: true})
            : new Set()
        : new Set(repositoryState.git.agentScopeExcludedPaths);
    /** @type {PathObservation[]} */
    const gitVisibleEntries = [];
    for (const path of paths) gitVisibleEntries.push(await filesystem.inspectPath({phase: 2, path}));

    /** @type {PathObservation[]} */
    const rootObservations = [];
    for (const root of profile.roots) {
        const observation = await filesystem.inspectPath({phase: 1, path: root});
        const hasIncludedObservedPath = paths.some(path => withinRoot(path, root) && !excluded.has(path));
        const probe = root === '.' ? 'arw-code-map-probe' : joinRelativePath(root, 'arw-code-map-probe');
        rootObservations.push({
            ...observation,
            agentScopeExcluded: observation.kind === 'directory' && policyAvailable
                ? !hasIncludedObservedPath && (
                    repositoryState === undefined
                        ? await rootIgnoreState({git: requiredGit(), root, policy: true})
                        : excluded.has(root) || excluded.has(probe)
                )
                : false,
        });
    }
    const normalizedScanRoots = uniqueSorted(scanRoots)
        .filter(root => !scanRoots.some(other => other !== root && withinRoot(root, other)));
    /** @type {string[]} */
    const identityRoots = [];
    for (const root of normalizedScanRoots) {
        const observation = await filesystem.inspectPath({phase: 2, path: root});
        if (observation.kind === 'directory') identityRoots.push(root);
    }
    const preliminary = verifyCodeMaps({
        agentScopeExcludedPaths: [...excluded],
        gitVisibleEntries,
        identityScanRoots: [],
        profile,
        readmes: [],
        rootObservations,
    });
    const scanned = await scanReadmes({
        filesystem,
        requiredPaths: new Set(preliminary.requiredDirectories.map(readmePath)),
        roots: identityRoots,
    });
    return {
        agentScopeExcludedPaths: [...excluded],
        gitVisibleEntries,
        identityScanRoots: identityRoots,
        profile,
        readmes: scanned.readmes,
        rootObservations,
        traversalSymbolicLinks: scanned.traversalSymbolicLinks,
    };
};

/**
 * 从规范 Workflow lock, Git 和当前文件系统读取 Code Map Module Interface 所需的完整观察结果.
 * 该适配器只读, 不生成, 迁移, 删除由 Repository 拥有的 README, 也不执行 `demote`.
 */
/** @param {{repositoryRoot: string, filesystem?: CodeMapFilesystem, git?: CodeMapGit}} input */
export const runCodeMapVerification = async ({
    repositoryRoot,
    filesystem = undefined,
    git = createNodeGitRunner(repositoryRoot),
}) => {
    try {
        filesystem ??= await createCodeMapFilesystem(repositoryRoot);
        const lockObservation = await filesystem.inspectPath({phase: 1, path: WORKFLOW_LOCK_PATH});
        if (lockObservation.kind === 'missing') {
            return failedVerification(
                'workflow-uninitialized',
                'Repository Workflow is not initialized; run arw workflow init.',
                WORKFLOW_LOCK_PATH,
            );
        }
        if (lockObservation.kind !== 'file') {
            return failedVerification('invalid-lock-path', 'arw-lock.json is not a regular file.', WORKFLOW_LOCK_PATH);
        }
        let lock;
        try {
            lock = parseWorkflowLock((await filesystem.readBytes({phase: 1, path: WORKFLOW_LOCK_PATH})).toString('utf8'));
        } catch (error) {
            return failedVerification(
                'invalid-workflow-lock',
                error instanceof Error ? error.message : String(error),
                WORKFLOW_LOCK_PATH,
            );
        }
        const profile = lock.profile.codeMaps;
        if (profile.roots.length === 0) {
            return verifyCodeMaps({
                agentScopeExcludedPaths: [],
                gitVisibleEntries: [],
                profile,
                readmes: [],
                rootObservations: [],
            });
        }

        const policyObservation = await filesystem.inspectPath({phase: 1, path: '.arwignore'});
        if (policyObservation.kind !== 'file') {
            return failedVerification('invalid-agent-scope-policy', '.arwignore must be a readable regular file.', '.arwignore');
        }
        const policyBytes = await filesystem.readBytes({phase: 1, path: '.arwignore'});
        try {
            new TextDecoder('utf-8', {fatal: true}).decode(policyBytes);
            if (policyBytes.includes(0)) throw new Error('NUL');
        } catch {
            return failedVerification('invalid-agent-scope-policy', '.arwignore must be valid UTF-8 text without NUL.', '.arwignore');
        }

        return verifyCodeMaps(await inspectCodeMapCoverage({
            filesystem,
            git,
            policyAvailable: true,
            profile,
        }));
    } catch (error) {
        return failedVerification(
            'code-map-inspection-failed',
            error instanceof Error ? error.message : String(error),
            '.',
        );
    }
};
