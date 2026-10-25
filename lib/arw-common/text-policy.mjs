import {createScopedFilesystem} from '../common/filesystem.mjs';
import {createNodeGitRunner} from '../common/git-process.mjs';
import {inspectTextBytes} from '../common/text-policy.mjs';

/** @typedef {{bytes: Buffer, path: string}} TextFile */
/** @typedef {{kind: string, path: string}} TextPathObservation */
/** @typedef {{inspectPath?: (input: {path: string}) => Promise<TextPathObservation>, readBytes?: (input: {path: string}) => Promise<Buffer>, replaceFileAtomically?: (input: {bytes: Buffer, path: string}) => Promise<void>}} TextPolicyFilesystem */
/** @typedef {{code: number | null, failure: 'process' | 'timeout' | null, stderr: string | Buffer, stdout: Buffer}} GitProcessResult */
/** @typedef {{run: (input: {argv: string[], input?: Buffer | string}) => Promise<GitProcessResult>}} GitRunner */
/** @typedef {{excluded: boolean, expression: RegExp}} IgnoreRule */

/** @param {{path: string}} left @param {{path: string}} right */
const comparePath = (left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
const classifyFileSystemError = (/** @type {unknown} */ error) => {
    const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') return 'not-found';
    if (code === 'EACCES' || code === 'EPERM') return 'access-denied';
    if (code === 'EINVAL' || code === 'ELOOP') return 'unsupported-entry';
    return 'io';
};

/** @param {string} repositoryRoot @returns {TextPolicyFilesystem} */
export const createNodeTextPolicyFilesystem = repositoryRoot => {
    const created = createScopedFilesystem({root: repositoryRoot});
    const scoped = async () => {
        const result = await created;
        if (result.status !== 'succeeded') {
            const error = new Error(result.diagnostics.map(diagnostic => diagnostic.message).join(' '));
            Object.assign(error, {code: result.status === 'blocked' ? 'EINVAL' : 'EIO'});
            throw error;
        }
        return result.scopedFilesystem;
    };
    return {
        /** @param {{path: string}} input */
        async inspectPath({path}) {
            const result = await (await scoped()).inspect({path});
            if (result.status !== 'succeeded') throw Object.assign(
                new Error(result.diagnostics.map(diagnostic => diagnostic.message).join(' ')),
                {code: result.status === 'blocked' ? 'EINVAL' : 'EIO'},
            );
            return {kind: result.entry.kind === 'link' ? 'symbolic-link' : result.entry.kind, path};
        },
        /** @param {{path: string}} input */
        async readBytes({path}) {
            const result = await (await scoped()).read({path});
            if (result.status !== 'succeeded') throw Object.assign(
                new Error(result.diagnostics.map(diagnostic => diagnostic.message).join(' ')),
                {code: result.status === 'blocked' ? 'EINVAL' : 'EIO'},
            );
            return result.bytes;
        },
        /** @param {{bytes: Buffer, path: string}} input */
        async replaceFileAtomically({bytes, path}) {
            const result = await (await scoped()).write({bytes, mode: 'replace', path});
            if (result.status !== 'succeeded') throw Object.assign(
                new Error(result.diagnostics.map(diagnostic => diagnostic.message).join(' ')),
                {code: result.status === 'blocked' ? 'EINVAL' : 'EIO'},
            );
        },
    };
};

/** @param {GitProcessResult} result */
const gitPaths = result => {
    if (result.stdout.length === 0) return [];
    if (result.stdout[result.stdout.length - 1] !== 0) throw new Error('Git path inventory is malformed.');
    let text;
    try {
        text = new TextDecoder('utf-8', {fatal: true}).decode(result.stdout);
    } catch {
        throw new Error('Git path inventory is not encoded as UTF-8.');
    }
    const paths = text.slice(0, -1).split('\0');
    if (paths.some(path => path.length === 0)) throw new Error('Git path inventory is malformed.');
    return paths;
};

/** @param {GitRunner} git @param {string[]} argv @param {Buffer | string} [input] */
const runGit = async (git, argv, input = undefined) => {
    const result = await git.run({argv, input});
    const allowedCodes = argv[0] === 'check-ignore' ? [0, 1] : [0];
    if (result.failure !== null || typeof result.code !== 'number' || !allowedCodes.includes(result.code)) {
        throw new Error(`Git command failed: git ${argv.join(' ')}.`);
    }
    return result;
};

/** @param {string} value */
const trimUnescapedTrailingSpaces = value => {
    let end = value.length;
    while (end > 0 && value[end - 1] === ' ') {
        let slashes = 0;
        for (let index = end - 2; index >= 0 && value[index] === '\\'; index -= 1) slashes += 1;
        if (slashes % 2 === 1) break;
        end -= 1;
    }
    return value.slice(0, end);
};

const escapeRegularExpression = (/** @type {string} */ character) => /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;

/** @param {string} pattern */
const translateGitIgnoreGlob = pattern => {
    let translated = '';
    for (let index = 0; index < pattern.length; index += 1) {
        const character = pattern[index];
        if (character === '\\' && index + 1 < pattern.length) {
            translated += escapeRegularExpression(pattern[index += 1]);
            continue;
        }
        if (character === '*') {
            if (pattern[index + 1] === '*') {
                while (pattern[index + 1] === '*') index += 1;
                if (pattern[index + 1] === '/') {
                    index += 1;
                    translated += '(?:.*/)?';
                } else {
                    translated += '.*';
                }
            } else {
                translated += '[^/]*';
            }
            continue;
        }
        if (character === '?') {
            translated += '[^/]';
            continue;
        }
        if (character === '[') {
            const close = pattern.indexOf(']', index + 1);
            if (close !== -1) {
                let range = pattern.slice(index + 1, close);
                if (range.startsWith('!')) range = `^${range.slice(1)}`;
                translated += `[${range.replaceAll('\\', '\\\\')}]`;
                index = close;
                continue;
            }
        }
        translated += escapeRegularExpression(character);
    }
    return translated;
};

/** @param {string} source @returns {IgnoreRule | null} */
const compileIgnoreRule = source => {
    let pattern = trimUnescapedTrailingSpaces(source);
    if (pattern.length === 0 || pattern.startsWith('#')) return null;
    let excluded = true;
    if (pattern.startsWith('!')) {
        excluded = false;
        pattern = pattern.slice(1);
    }
    if (pattern.length === 0) return null;
    const anchored = pattern.startsWith('/');
    if (anchored) pattern = pattern.slice(1);
    const directoryOnly = pattern.endsWith('/');
    if (directoryOnly) pattern = pattern.slice(0, -1);
    const containsSlash = pattern.includes('/');
    const prefix = anchored || containsSlash ? '^' : '(?:^|.*/)';
    const suffix = directoryOnly ? '/.*$' : '(?:/.*)?$';
    return {excluded, expression: new RegExp(`${prefix}${translateGitIgnoreGlob(pattern)}${suffix}`, 'u')};
};

export const filterAgentManagedPaths = (/** @type {string[]} */ paths, /** @type {string} */ policyText) => {
    const rules = policyText.split(/\r?\n/u).map(compileIgnoreRule).filter(rule => rule !== null);
    return [...paths].sort().filter(path => {
        let excluded = false;
        for (const rule of rules) {
            if (rule.expression.test(path)) excluded = rule.excluded;
        }
        return !excluded;
    });
};

/** @param {GitRunner} git */
export const collectGitVisiblePaths = async git => {
    const visible = gitPaths(await runGit(
        git,
        ['ls-files', '--cached', '--others', '--exclude-standard', '--full-name', '-z'],
    ));
    if (visible.length === 0) return [];
    const ignored = new Set(gitPaths(await runGit(
        git,
        ['check-ignore', '--no-index', '--stdin', '-z'],
        Buffer.from(`${visible.join('\0')}\0`, 'utf8'),
    )));
    return visible.filter(path => !ignored.has(path));
};

/** @param {{files: TextFile[], filesystem: TextPolicyFilesystem, intent: string}} input */
export const executeTextPolicy = async ({files, filesystem, intent}) => {
    if (!['check', 'fix'].includes(intent)) throw new TypeError('Text policy intent must be check or fix.');
    const inspections = [...files]
        .sort(comparePath)
        .map(file => ({...file, inspection: inspectTextBytes(file.bytes)}));
    const textFiles = inspections.filter(file => file.inspection.kind === 'text');
    const invalid = textFiles.filter(file => file.inspection.issues.includes('invalid-utf8'));
    const targets = textFiles.filter(file => file.inspection.fixedBytes !== null);

    if (intent === 'check') {
        const findings = textFiles.filter(file => file.inspection.issues.length > 0);
        return {
            changed: [],
            checked: textFiles.length,
            diagnostics: findings.map(file => ({
                code: file.inspection.issues.includes('invalid-utf8') ? 'invalid-utf8' : 'text-policy-violation',
                issues: file.inspection.issues,
                path: file.path,
            })),
            satisfied: findings.length === 0,
            skippedBinary: inspections.length - textFiles.length,
            unchanged: findings.map(file => file.path),
        };
    }

    if (invalid.length > 0) {
        return {
            changed: [],
            checked: textFiles.length,
            diagnostics: invalid.map(file => ({code: 'invalid-utf8', issues: file.inspection.issues, path: file.path})),
            satisfied: false,
            skippedBinary: inspections.length - textFiles.length,
            unchanged: targets.map(file => file.path),
        };
    }

    if (filesystem.replaceFileAtomically === undefined) {
        throw new Error('Text Policy filesystem cannot replace files.');
    }
    const changed = [];
    for (let index = 0; index < targets.length; index += 1) {
        const file = targets[index];
        if (file === undefined || file.inspection.fixedBytes === null) {
            throw new Error('Text Policy target is missing fixed bytes.');
        }
        try {
            await filesystem.replaceFileAtomically({bytes: file.inspection.fixedBytes, path: file.path});
            changed.push(file.path);
        } catch (error) {
            return {
                changed,
                checked: textFiles.length,
                diagnostics: [{
                    cause: classifyFileSystemError(error),
                    code: 'text-fix-partial',
                    operation: 'replace-file-atomically',
                    path: file.path,
                    remediation: 'Inspect or restore changed paths from the Git index, then rerun arw text fix.',
                }],
                satisfied: false,
                skippedBinary: inspections.length - textFiles.length,
                unchanged: targets.slice(index).map(target => target.path),
            };
        }
    }
    return {
        changed,
        checked: textFiles.length,
        diagnostics: [],
        satisfied: true,
        skippedBinary: inspections.length - textFiles.length,
        unchanged: [],
    };
};

/** @param {{repositoryRoot: string, filesystem?: TextPolicyFilesystem, git?: GitRunner, intent: string}} input */
export const runTextPolicy = async ({
    repositoryRoot,
    filesystem = createNodeTextPolicyFilesystem(repositoryRoot),
    git = createNodeGitRunner(repositoryRoot),
    intent,
}) => {
    if (filesystem.inspectPath === undefined || filesystem.readBytes === undefined) {
        throw new Error('Text Policy filesystem cannot inspect and read files.');
    }
    const visiblePaths = await collectGitVisiblePaths(git);
    const policyObservation = await filesystem.inspectPath({path: '.arwignore'});
    let policyText = '';
    if (policyObservation.kind === 'file') {
        try {
            const policyBytes = await filesystem.readBytes({path: '.arwignore'});
            policyText = new TextDecoder('utf-8', {fatal: true}).decode(policyBytes);
            if (policyBytes.includes(0)) throw new Error('NUL');
        } catch {
            return {
                changed: [],
                checked: 0,
                diagnostics: [{code: 'invalid-agent-scope-policy', path: '.arwignore'}],
                satisfied: false,
                skippedBinary: 0,
                unchanged: [],
            };
        }
    } else if (policyObservation.kind !== 'missing') {
        return {
            changed: [],
            checked: 0,
            diagnostics: [{code: 'invalid-agent-scope-policy', path: '.arwignore'}],
            satisfied: false,
            skippedBinary: 0,
            unchanged: [],
        };
    }
    const paths = filterAgentManagedPaths(visiblePaths, policyText);
    const files = [];
    for (const path of paths) {
        const observation = await filesystem.inspectPath({path});
        if (observation.kind === 'missing') continue;
        if (observation.kind !== 'file') {
            return {
                changed: [],
                checked: 0,
                diagnostics: [{code: 'unsupported-text-entry', path}],
                satisfied: false,
                skippedBinary: 0,
                unchanged: [],
            };
        }
        files.push({bytes: await filesystem.readBytes({path}), path});
    }
    return executeTextPolicy({files, filesystem, intent});
};
