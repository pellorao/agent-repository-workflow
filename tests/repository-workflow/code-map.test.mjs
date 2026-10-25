import assert from 'node:assert/strict';
import {mkdir, readFile, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {runGit} from '../helpers/git.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {createRepository as createGitRepository} from '../helpers/repository-fixture.mjs';
import {inspectCodeMapCoverage, runCodeMapVerification, verifyCodeMaps} from '../../lib/repository-workflow/code-map.mjs';
import {createWorkflowLock, serializeWorkflowLock} from '../../lib/repository-workflow/workflow-lock.mjs';


/** @type {Record<string, string[]>} */
const headings = {
    directory: ['Overview', 'Directory Or File List', 'Directory Or File Relationships', 'Usage', 'Modification Boundaries', 'Related Documents'],
    module: ['Overview', 'Directory Or File List', 'Directory Or File Relationships', 'Public Interface', 'Reading Entry Points', 'Modification Boundaries', 'Related Documents'],
};

/** @typedef {{excludes: string[], includes: string[], roots: string[]}} TestCodeMapProfile */

/** @param {{kind?: string, sectionHeadings?: string[], version?: number}} [options] */
const codeMap = ({kind = 'directory', version = 1, sectionHeadings = headings[kind] ?? []} = {}) => [
    '---',
    `code-map-version: ${version}`,
    `code-map-kind: ${kind}`,
    'title: Repository prose',
    '---',
    '# Map',
    '',
    ...sectionHeadings.flatMap((/** @type {string} */ heading) => [`## ${heading}`, '', 'Content.', '']),
].join('\n');

/** @param {TestCodeMapProfile} profile */
const codeMapLock = profile => serializeWorkflowLock(createWorkflowLock({
    managedTargets: [],
    profile: {
        codeMaps: profile,
        domainLayout: 'single-context',
        platforms: ['codex'],
    },
    repositoryOwnedSeeds: [],
}));

test('Code Map 覆盖使用 Repository 相对通配符与完整祖先闭包', () => {
    const result = verifyCodeMaps({
        agentScopeExcludedPaths: ['src/generated/value.js'],
        gitVisibleEntries: [
            {kind: 'file', path: 'src/README.md'},
            {kind: 'file', path: 'src/module/deep/value.js'},
            {kind: 'file', path: 'src/module/value.test.js'},
            {kind: 'file', path: 'src/generated/value.js'},
            {kind: 'directory', path: 'src/module/fake.js'},
            {kind: 'missing', path: 'src/deleted.js'},
            {kind: 'symbolic-link', path: 'src/linked.js'},
            {kind: 'file', path: 'packages/src/other.js'},
        ],
        profile: {
            excludes: ['src/**/*.test.js'],
            includes: ['src/**/*'],
            roots: ['packages', 'src'],
        },
        readmes: [],
        rootObservations: [
            {kind: 'directory', path: 'packages'},
            {kind: 'directory', path: 'src'},
        ],
    });

    assert.deepEqual(result.candidateFiles, ['src/module/deep/value.js']);
    assert.deepEqual(result.requiredDirectories, ['src', 'src/module', 'src/module/deep']);
    assert.deepEqual(result.missingReadmes, [
        'src/README.md',
        'src/module/README.md',
        'src/module/deep/README.md',
    ]);
    assert.ok(result.diagnostics.some(entry => entry.code === 'code-map-candidate-symbolic-link' && entry.path === 'src/linked.js'));
    assert.equal(result.satisfied, false);
});

test('Code Map still rejects invalid UTF-8 in a complete frontmatter README', () => {
    const invalid = Buffer.concat([Buffer.from('---\ncode-map-version: 1\n'), Buffer.from([0xff])]);
    const result = verifyCodeMaps({
        agentScopeExcludedPaths: [],
        gitVisibleEntries: [{kind: 'file', path: 'src/value.js'}],
        profile: {excludes: [], includes: ['src/**/*.js'], roots: ['src']},
        readmes: [{bytes: invalid, frontmatterBytes: invalid, kind: 'file', path: 'src/README.md'}],
        rootObservations: [{kind: 'directory', path: 'src'}],
    });

    assert.ok(result.diagnostics.some(entry => entry.code === 'invalid-code-map-text'));
});

test('Code Map 窄扫描不读取孤立正文并拒绝遍历符号链接', async () => {
    /** @type {string[]} */
    const fullReads = [];
    const frontmatter = Buffer.from('---\ncode-map-version: 1\ncode-map-kind: directory\n---\n', 'utf8');
    const filesystem = {
        inspectPath: async (/** @type {{path: string}} */ {path}) => ({kind: path === 'src/index.js' ? 'file' : 'directory', path}),
        listDirectory: async (/** @type {{path: string}} */ {path}) => path === 'src'
            ? [
                {kind: 'symbolic-link', name: 'linked'},
                {kind: 'directory', name: 'orphan'},
                {kind: 'file', name: 'README.md'},
            ]
            : [{kind: 'file', name: 'README.md'}],
        readBytes: async (/** @type {{path: string}} */ {path}) => {
            fullReads.push(path);
            if (path === 'src/orphan/README.md') throw new Error('孤立正文不得读取.');
            return Buffer.from(codeMap(), 'utf8');
        },
        readFrontmatterBytes: async () => frontmatter,
    };
    const git = {
        run: async (/** @type {{argv: string[], input?: Buffer}} */ {argv, input}) => {
            if (argv.includes('ls-files')) {
                return {code: 0, failure: null, stderr: '', stdout: Buffer.from('src/index.js\0', 'utf8')};
            }
            if (argv[0] === '-c' && input?.toString('utf8').includes('arw-code-map-probe')) {
                return {code: 0, failure: null, stderr: '', stdout: Buffer.from('src/arw-code-map-probe\0', 'utf8')};
            }
            return {code: 1, failure: null, stderr: '', stdout: Buffer.alloc(0)};
        },
    };
    const observations = await inspectCodeMapCoverage({
        filesystem,
        git,
        policyAvailable: true,
        profile: {excludes: [], includes: ['src/**/*.js'], roots: ['src']},
    });
    const result = verifyCodeMaps(observations);

    assert.deepEqual(fullReads, ['src/README.md']);
    assert.deepEqual(result.orphanReadmes, ['src/orphan/README.md']);
    assert.equal(result.diagnostics.some(entry => entry.code === 'excluded-code-map-root'), false);
    assert.ok(result.diagnostics.some(entry => entry.code === 'code-map-traversal-symbolic-link' && entry.path === 'src/linked'));
    assert.equal(result.satisfied, false);
});

test('Code Map 验证读取规范 Repository 状态且不写入', async t => {
    const root = await createGitRepository(t, {prefix: 'arw-code-map-'});
    await mkdir(join(root, 'src', 'module'), {recursive: true});
    await writeFile(join(root, '.arwignore'), 'src/generated/**\n!src/generated/keep.js\n', 'utf8');
    await writeFile(join(root, 'arw-lock.json'), codeMapLock({
        excludes: ['src/**/*.test.js'],
        includes: ['src/**/*.js'],
        roots: ['src'],
    }), 'utf8');
    await writeFile(join(root, 'src', 'index.js'), 'export const root = true;\n', 'utf8');
    await writeFile(join(root, 'src', 'module', 'index.js'), 'export const nested = true;\n', 'utf8');
    await mkdir(join(root, 'src', 'generated'), {recursive: true});
    await writeFile(join(root, 'src', 'generated', 'drop.js'), 'export const drop = true;\n', 'utf8');
    await writeFile(join(root, 'src', 'generated', 'keep.js'), 'export const keep = true;\n', 'utf8');
    await writeFile(join(root, 'src', 'README.md'), codeMap(), 'utf8');
    await writeFile(join(root, 'src', 'generated', 'README.md'), codeMap(), 'utf8');
    await writeFile(join(root, 'src', 'module', 'README.md'), codeMap({kind: 'module'}), 'utf8');
    await runGit(root, ['add', '.']);
    const before = await readFile(join(root, 'src', 'module', 'README.md'));

    const result = await runCodeMapVerification({repositoryRoot: root});

    assert.equal(result.satisfied, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.candidateFiles, ['src/generated/keep.js', 'src/index.js', 'src/module/index.js']);
    assert.deepEqual(result.requiredDirectories, ['src', 'src/generated', 'src/module']);
    assert.deepEqual(await readFile(join(root, 'src', 'module', 'README.md')), before);
});

test('Code Map 验证在当前主机拒绝已配置的符号链接根目录', async t => {
    const root = await createGitRepository(t, {prefix: 'arw-code-map-link-'});
    await mkdir(join(root, 'real'), {recursive: true});
    await writeFile(join(root, '.arwignore'), '', 'utf8');
    await writeFile(join(root, 'arw-lock.json'), codeMapLock({
        excludes: [],
        includes: ['linked/**/*.js'],
        roots: ['linked'],
    }), 'utf8');
    await symlink(join(root, 'real'), join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');

    const result = await runCodeMapVerification({repositoryRoot: root});

    assert.equal(result.satisfied, false);
    assert.ok(result.diagnostics.some(entry => entry.code === 'invalid-code-map-root' && entry.path === 'linked'));
    await assert.rejects(readFile(join(root, 'linked', 'README.md')));
});
