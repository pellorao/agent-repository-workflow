import {createHash} from 'node:crypto';
import {cp, lstat, mkdir, readdir, readFile, readlink, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';

import {createTemporaryDirectory} from './cleanup.mjs';
import {installFakeCommand} from './process.mjs';

const succeeded = (/** @type {string | Buffer} */ stdout = '') => ({exitCode: 0, stderr: '', stdout});
const failed = (/** @type {string} */ stderr) => ({exitCode: 1, stderr, stdout: ''});
const digest = (/** @type {Buffer | string} */ bytes) => createHash('sha1').update(bytes).digest('hex');

/** @param {string} root @param {string} path */
const readEntry = async (root, path) => {
    const info = await lstat(join(root, path));
    const bytes = info.isSymbolicLink() ? Buffer.from(await readlink(join(root, path))) : Buffer.from(await readFile(join(root, path)));
    const mode = info.isSymbolicLink() ? '120000' : (info.mode & 0o111) === 0 ? '100644' : '100755';
    return {bytes, mode, oid: digest(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))};
};

/** Every file below `root`, relative; `.git` and `.tmp` (the Agent workspace) are never visible. */
const listFiles = async (/** @type {string} */ root, directory = '') => {
    /** @type {string[]} */
    const files = [];
    for (const entry of await readdir(join(root, directory), {withFileTypes: true})) {
        if (entry.name === '.git' || entry.name === '.tmp') continue;
        const path = directory === '' ? entry.name : `${directory}/${entry.name}`;
        if (entry.isDirectory()) files.push(...await listFiles(root, path));
        else files.push(path);
    }
    return files;
};

/**
 * Ignore files hold plain names (`name`) or directory names (`name/`); anything else is rejected so a test
 * never silently relies on a pattern the double does not model.
 */
const readIgnorePatterns = async (/** @type {string} */ root, /** @type {string[]} */ names) => {
    const patterns = [];
    for (const name of names) {
        const text = await readFile(join(root, name), 'utf8').catch(() => '');
        for (const line of text.split('\n').map(item => item.trim()).filter(item => item !== '' && !item.startsWith('#'))) {
            const directoryOnly = line.endsWith('/');
            const pattern = directoryOnly ? line.slice(0, -1) : line;
            if (/[*?!/[\\]/u.test(pattern)) throw new Error(`Mock Git does not model the ignore pattern: ${line}`);
            patterns.push({directoryOnly, pattern});
        }
    }
    return patterns;
};

/** Whether the path or one of its parent directories matches an ignore pattern. */
const ignored = (/** @type {Awaited<ReturnType<typeof readIgnorePatterns>>} */ patterns, /** @type {string} */ path, /** @type {boolean} */ isDirectory) => {
    const parts = path.split('/');
    return parts.some((part, index) => patterns.some(({directoryOnly, pattern}) => pattern === part
        && (!directoryOnly || index < parts.length - 1 || isDirectory)));
};

/** The paths a command's `-- <path>...` arguments select (a file or a directory prefix); everything when absent. */
const pathspecFilter = (/** @type {readonly string[]} */ argv) => {
    const marker = argv.indexOf('--');
    const specs = marker === -1 ? [] : argv.slice(marker + 1);
    return (/** @type {string} */ path) => specs.length === 0 || specs.some(spec => path === spec || path.startsWith(`${spec}/`));
};

/**
 * In-process Git double for tests whose purpose does not include proving Git process behavior. It keeps one
 * index and HEAD per repository root and answers the commands the production code asks, without a Git process.
 */
export const createMockGit = () => {
    /** @type {Map<string, {stagedEntries: Map<string, Buffer>, index: Map<string, {bytes: Buffer, mode: string, oid: string}>, head: Map<string, {bytes: Buffer, mode: string, oid: string}>, objects: Map<string, Buffer>, commits: Array<{oid: string, time: number, tree: Map<string, {bytes: Buffer, mode: string, oid: string}>}>}>} */
    const repositories = new Map();

    /** @param {string} cwd @param {readonly string[]} argv @param {Buffer | string | undefined} input @param {NodeJS.ProcessEnv} [environment] */
    const execute = async (cwd, argv, input, environment = {}) => {
        const args = [...argv];
        /** @type {Record<string, string>} */
        const config = {};
        while (args[0] === '-c') {
            const [key = '', ...value] = (args[1] ?? '').split('=');
            config[key] = value.join('=');
            args.splice(0, 2);
        }
        const [command, ...rest] = args;
        if (command === 'init') {
            repositories.set(cwd, {stagedEntries: new Map(), index: new Map(), head: new Map(), objects: new Map(), commits: []});
            return succeeded();
        }
        const repository = repositories.get(cwd);
        if (repository === undefined) return failed(`Mock Git Repository is not initialized: ${cwd}`);
        const {index, objects, stagedEntries} = repository;
        const stage = async (/** @type {string} */ path, trackDiff = true) => {
            const entry = await readEntry(cwd, path);
            index.set(path, entry);
            objects.set(entry.oid, entry.bytes);
            if (trackDiff) stagedEntries.set(path, entry.bytes);
        };
        const restageTracked = async (/** @type {Set<string>} */ present) => {
            for (const path of [...index.keys()]) {
                if (present.has(path)) await stage(path, false);
                else index.delete(path);
            }
        };

        if (command === 'rev-parse' && rest[0] === '--show-toplevel') return succeeded(`${cwd}\n`);
        if (command === 'config') return succeeded();
        if (command === 'add') {
            const present = await listFiles(cwd);
            const everything = rest.includes('-A') || rest.includes('.');
            if (everything) {
                const ignores = await readIgnorePatterns(cwd, ['.gitignore']);
                for (const path of present) if (!ignored(ignores, path, false)) await stage(path, false);
                await restageTracked(new Set(present));
                return succeeded();
            }
            for (const path of rest) {
                const files = present.filter(file => file === path || file.startsWith(`${path}/`));
                if (files.length === 0) index.delete(path);
                for (const file of files) await stage(file);
            }
            return succeeded();
        }
        if (command === 'commit') {
            if (rest.includes('-a')) await restageTracked(new Set(await listFiles(cwd)));
            repository.head = new Map(index);
            stagedEntries.clear();
            const date = environment['GIT_COMMITTER_DATE'];
            const time = date === undefined ? 1_800_000_000 + repository.commits.length : Math.floor(Date.parse(date) / 1000);
            const tree = JSON.stringify([...index].map(([path, {mode, oid}]) => [path, mode, oid]));
            repository.commits.push({oid: digest(`${tree}\0${repository.commits.length}\0${time}`), time, tree: new Map(index)});
            return succeeded();
        }
        if (command === 'write-tree') {
            return succeeded(`${digest(JSON.stringify([...index].sort(([left], [right]) => left.localeCompare(right)).map(([path, {mode, oid}]) => [path, mode, oid])))}\n`);
        }
        if (command === 'ls-files') {
            const separator = rest.includes('-z') ? '\0' : '\n';
            const selected = pathspecFilter(rest);
            const entries = [...index].filter(([path]) => selected(path)).sort(([left], [right]) => left.localeCompare(right));
            const others = rest.includes('--others')
                ? (await listFiles(cwd)).filter(path => !index.has(path) && selected(path)).sort()
                : [];
            const ignores = await readIgnorePatterns(cwd, ['.gitignore']);
            const listedOthers = others.filter(path => !rest.includes('--exclude-standard') || !ignored(ignores, path, false));
            const cached = rest.includes('--others') && !rest.includes('--cached') && !rest.includes('--stage') ? [] : entries;
            return succeeded([
                ...listedOthers.map(path => `${path}${separator}`),
                ...cached.map(([path, entry]) => (rest.includes('--stage') ? `${entry.mode} ${entry.oid} 0\t${path}${separator}` : `${path}${separator}`)),
            ].join(''));
        }
        if (command === 'ls-tree') {
            const selected = pathspecFilter(rest);
            const listed = [...repository.head].filter(([path]) => selected(path)).sort(([left], [right]) => left.localeCompare(right));
            if (!rest.includes('-r') && listed.some(([path]) => !rest.slice(rest.indexOf('--') + 1).includes(path))) throw new Error('Mock Git does not model a non-recursive ls-tree of a directory.');
            return succeeded(listed.map(([path, entry]) => `${entry.mode} blob ${entry.oid}\t${path}\0`).join(''));
        }
        if (command === 'diff' && rest[0] === '--quiet') {
            const selected = pathspecFilter(rest);
            for (const [path, entry] of index) {
                if (!selected(path)) continue;
                const current = await readEntry(cwd, path).catch(() => null);
                if (current?.oid !== entry.oid) return {...succeeded(), exitCode: 1};
            }
            return succeeded();
        }
        if (command === 'rev-parse' && (rest.at(-1) === 'HEAD' || rest.at(-1) === 'HEAD^{commit}')) {
            const last = repository.commits.at(-1);
            if (last !== undefined) return succeeded(`${last.oid}\n`);
            return rest.includes('--quiet') ? {...succeeded(), exitCode: 1} : {exitCode: 128, stderr: 'fatal: Needed a single revision\n', stdout: ''};
        }
        if (command === 'rev-parse' && rest[0] === '--is-shallow-repository') return succeeded('false\n');
        if (command === 'rev-list' && rest.includes('--reverse') && rest.includes('HEAD')) {
            const selected = pathspecFilter(rest);
            const under = (/** @type {Map<string, {oid: string, mode: string}>} */ tree) => JSON.stringify([...tree].filter(([path]) => selected(path)).sort().map(([path, {mode, oid}]) => [path, mode, oid]));
            return succeeded(repository.commits
                .filter((commit, position) => under(commit.tree) !== under(repository.commits[position - 1]?.tree ?? new Map()))
                .map(commit => `${commit.oid}\n`).join(''));
        }
        if (command === 'show' && rest[0] === '-s' && rest[1] === '--format=%ct') {
            const commit = repository.commits.find(item => item.oid === rest[2]);
            return commit === undefined ? {exitCode: 128, stderr: `fatal: bad object ${rest[2]}\n`, stdout: ''} : succeeded(`${commit.time}\n`);
        }
        if (command === 'cat-file' && rest[0] === '-e') {
            const path = (rest[1] ?? '').replace(/^HEAD:/u, '');
            return [...repository.head.keys()].some(item => item === path || item.startsWith(`${path}/`)) ? succeeded() : {exitCode: 128, stderr: `fatal: path '${path}' does not exist in 'HEAD'\n`, stdout: ''};
        }
        if (command === 'status') {
            const ignores = await readIgnorePatterns(cwd, ['.gitignore']);
            const present = new Set(await listFiles(cwd));
            const records = [];
            const untracked = [];
            for (const path of [...new Set([...present, ...index.keys(), ...repository.head.keys()])].sort()) {
                const staged = index.get(path);
                if (staged === undefined && present.has(path)) {
                    if (!ignored(ignores, path, false)) untracked.push(`?? ${path}`);
                    continue;
                }
                const committed = repository.head.get(path);
                const indexState = committed?.oid === staged?.oid ? ' ' : committed === undefined ? 'A' : staged === undefined ? 'D' : 'M';
                const treeState = staged === undefined ? ' ' : !present.has(path) ? 'D' : (await readEntry(cwd, path)).oid === staged.oid ? ' ' : 'M';
                if (indexState !== ' ' || treeState !== ' ') records.push(`${indexState}${treeState} ${path}`);
            }
            return succeeded([...records, ...untracked].map(record => `${record}\0`).join(''));
        }
        if (command === 'check-ignore') {
            const excludesFile = config['core.excludesFile'];
            const patterns = await readIgnorePatterns(cwd, ['.gitignore', ...(excludesFile === undefined ? [] : [excludesFile])]);
            const paths = (Buffer.isBuffer(input) ? input.toString('utf8') : input ?? '').split('\0').filter(Boolean);
            const matched = [];
            for (const path of paths) {
                const info = await lstat(join(cwd, path)).catch(() => null);
                if (ignored(patterns, path, info?.isDirectory() ?? false)) matched.push(path);
            }
            return matched.length === 0 ? {...succeeded(), exitCode: 1} : succeeded(matched.map(path => `${path}\0`).join(''));
        }
        if (command === 'cat-file' && rest[0] === '--batch') {
            const specifications = Buffer.isBuffer(input) ? input.toString('utf8') : input ?? '';
            return succeeded(Buffer.concat(specifications.trimEnd().split('\n').map(specification => {
                const bytes = objects.get(specification);
                return bytes === undefined ? Buffer.from(`${specification} missing\n`) : Buffer.concat([Buffer.from(`${specification} blob ${bytes.length}\n`), bytes, Buffer.from('\n')]);
            })));
        }
        if (command === 'diff' && rest[0] === '--cached' && rest.includes('--name-only')) {
            const paths = [...stagedEntries.keys()].sort();
            return succeeded(paths.length === 0 ? '' : `${paths.join('\n')}\n`);
        }
        if (command === 'diff' && rest[0] === '--cached') {
            const chunks = [];
            for (const path of [...stagedEntries.keys()].sort()) {
                const bytes = stagedEntries.get(path);
                if (bytes === undefined) throw new Error(`Mock Git staged entry is unavailable: ${path}`);
                chunks.push(Buffer.from(`${path}\0${bytes.length}\0`, 'utf8'), bytes);
            }
            return succeeded(Buffer.concat(chunks));
        }
        return failed(`Unexpected mock Git command: git ${argv.join(' ')}`);
    };

    return {
        execute,
        /** Same call shape as `runGit` in `git.mjs`: throws on failure, returns text. */
        async git(/** @type {string} */ root, /** @type {string[]} */ argv, /** @type {NodeJS.ProcessEnv} */ environment = {}) {
            const result = await execute(root, argv, undefined, environment);
            if (result.exitCode !== 0) throw new Error(`Mock Git failed: ${result.stderr}`);
            return {exitCode: 0, stderr: '', stdout: result.stdout.toString()};
        },
        /** The `GitRunner` shape that production code accepts as a `git` option. */
        runnerFor: (/** @type {string} */ root) => /** @type {import('../../lib/common/git-process.mjs').GitRunner} */ ({
            async run(/** @type {{argv: string[], cwd?: string, environment?: NodeJS.ProcessEnv, input?: Buffer | string}} */ {argv, cwd = root, environment, input}) {
                const result = await execute(cwd, argv, input, environment);
                return {code: result.exitCode, failure: null, stderr: result.stderr, stdout: Buffer.from(result.stdout)};
            },
        }),
    };
};

/**
 * Create a deterministic in-process Git command adapter for tests whose purpose
 * does not include proving Git process behavior.
 */
export const createMockGitRunCommand = () => {
    const mock = createMockGit();
    return async (
        /** @type {string} */ file,
        /** @type {readonly string[]} */ args,
        /** @type {{cwd: string, input?: Buffer | string}} */ {cwd, input},
    ) => (file === 'git' ? mock.execute(cwd, args, input) : failed(`Unexpected command: ${file}`));
};

/**
 * A Git handle for one root: the production runner, a `runGit`-style helper and `commitAll`. Fixtures decide
 * once whether the handle is mock or real (`createRealGitHandle` in `git.mjs`); tests only read the handle.
 * @param {string} root
 */
export const createMockGitHandle = async root => {
    const mock = createMockGit();
    await mock.git(root, ['init']);
    return {
        commitAll: async (/** @type {string} */ message, /** @type {{environment?: NodeJS.ProcessEnv}} */ {environment} = {}) => {
            await mock.git(root, ['add', '-A']);
            return mock.git(root, ['commit', '-m', message], environment);
        },
        git: (/** @type {string[]} */ argv, /** @type {{environment?: NodeJS.ProcessEnv}} */ {environment} = {}) => mock.git(root, argv, environment),
        runner: mock.runnerFor(root),
    };
};

/**
 * Put a fake `git` first on PATH that only answers Repository discovery (`rev-parse --show-toplevel`) with the
 * working directory, so entries that discover the Repository themselves need no real Git Repository.
 * Any other Git command fails loudly.
 * @param {import('node:test').TestContext} t @param {string} directory
 */
export const installGitDiscovery = (t, directory) => installFakeCommand(t, directory, 'git',
    'if [ "$1" = rev-parse ] && [ "$2" = --show-toplevel ]; then pwd -P; exit 0; fi\necho "fake git: unexpected $*" >&2\nexit 1\n');

/**
 * Create a filesystem fixture without initializing a real Git Repository.
 *
 * @param {import('./cleanup.mjs').CleanupContext} t
 * @param {{copies?: Array<{source: string, target: string}>, files?: Record<string, string | Buffer>, prefix: string}} options
 */
export const createMockGitRepository = async (t, {copies = [], files = {}, prefix}) => {
    const repositoryRoot = await createTemporaryDirectory(t, prefix);
    for (const {source, target} of copies) {
        const destination = join(repositoryRoot, ...target.split('/'));
        await mkdir(dirname(destination), {recursive: true});
        await cp(source, destination, {recursive: true});
    }
    for (const [path, contents] of Object.entries(files)) {
        const destination = join(repositoryRoot, ...path.split('/'));
        await mkdir(dirname(destination), {recursive: true});
        await writeFile(destination, contents);
    }
    return {repositoryRoot, runCommand: createMockGitRunCommand()};
};
