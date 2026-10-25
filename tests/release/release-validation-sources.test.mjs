import assert from 'node:assert/strict';
import {chmod, lstat, mkdir, readFile, readdir, readlink, rm, symlink, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {runGit} from '../helpers/git.mjs';
import {createValidationSourcesFixture, snapshotGitObservation} from '../helpers/release-fixture.mjs';
import {loadReleaseValidationSources, prepareValidationSnapshotBundle} from '../../lib/release/release-validation-sources.mjs';
import {createReleaseHostProcessAdapter, prepareReleaseValidationBundles} from '../../lib/release/release-vm-validation.mjs';
import {runReleaseVmValidationCli} from '../../scripts/release-vm-validation.mjs';

/** @param {string} candidateCommit @returns {import('../../lib/release/release-vm-validation.mjs').HostProcessAdapter} */
const preparationAdapter = candidateCommit => ({
    run: async request => {
        const snapshot = snapshotGitObservation(request);
        if (snapshot !== null) return snapshot;
        if (request.arguments[0] === 'rev-parse') return {exitCode: 0, stderr: '', stdout: request.arguments.at(-1)?.startsWith('refs/tags/') ? `${'d'.repeat(40)}\n` : `${candidateCommit}\n`};
        if (request.arguments[0] === 'tag') return {exitCode: 0, stderr: '', stdout: '0.2.1\n'};
        if (request.arguments[0] === 'show') return {exitCode: 0, stderr: '', stdout: JSON.stringify({version: request.arguments[1].startsWith('refs/tags/') ? '0.2.1' : '0.3.0'})};
        return {exitCode: 0, stderr: '', stdout: ''};
    },
});

test('external sources reject malformed, in-repository and missing inputs without exposing paths', async t => {
    const {configurationPath, root, sources} = await createValidationSourcesFixture(t);
    assert.deepEqual(await loadReleaseValidationSources(configurationPath), sources);
    for (const value of [
        {},
        {...sources, version: 1},
        {...sources, plain: {directory: 'relative'}},
        {...sources, plain: {directory: process.cwd()}},
        {...sources, plain: {directory: join(root, 'missing')}},
        {...sources, plain: {...sources.plain, commit: 'a'.repeat(40)}},
    ]) {
        await writeFile(configurationPath, JSON.stringify(value));
        await assert.rejects(loadReleaseValidationSources(configurationPath), error => error instanceof Error
            && /external JSON/u.test(error.message) && !error.message.includes(root));
    }
});

test('snapshot bundle preserves hidden and ignored file bytes and executable modes without original Git metadata', async t => {
    const {sources} = await createValidationSourcesFixture(t);
    const directory = sources.plain.directory;
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-snapshot-bundle-');
    const bytes = Buffer.from([0, 1, 2, 3, 10, 13, 127]);
    await mkdir(join(directory, '.git'));
    await writeFile(join(directory, '.git', 'config'), 'old metadata\n');
    await writeFile(join(directory, '.gitignore'), '*.bin\n.hidden\n');
    await writeFile(join(directory, '.gitattributes'), '*.txt text eol=lf\n');
    await writeFile(join(directory, '.hidden'), 'hidden\n');
    await writeFile(join(directory, 'global-ignored.dat'), 'globally ignored source\n');
    await writeFile(join(directory, 'ignored file.bin'), bytes);
    await writeFile(join(directory, 'source.txt'), 'original\r\n');
    await writeFile(join(directory, 'run.sh'), '#!/bin/sh\nexit 0\n');
    await chmod(join(directory, 'run.sh'), 0o755);
    const longRelativePath = [...Array(4).fill('long-segment-'.repeat(6)), 'preserved.txt'].join('/');
    assert.ok(longRelativePath.length > 260);
    await mkdir(dirname(join(directory, longRelativePath)), {recursive: true});
    await writeFile(join(directory, longRelativePath), 'long path source\n');

    const globalExcludes = join(workspaceDirectory, 'global-excludes');
    await writeFile(globalExcludes, 'global-ignored.dat\n');
    const processAdapter = createReleaseHostProcessAdapter();
    const prepared = await prepareValidationSnapshotBundle({directory, key: 'plain', timeoutMs: 10_000, workspaceDirectory}, {
        run: request => processAdapter.run({
            ...request,
            arguments: ['-c', `core.excludesFile=${globalExcludes}`, '-c', 'core.autocrlf=true', ...request.arguments],
        }),
    });
    const checkout = join(workspaceDirectory, 'checkout');
    await runGit(workspaceDirectory, ['clone', '--quiet', '--no-checkout', '--branch', 'arw-validation', prepared.path, checkout]);
    const listed = (await runGit(checkout, ['ls-tree', '-r', '--name-only', 'HEAD'])).stdout.trim().split('\n');
    assert.deepEqual(listed, ['.gitattributes', '.gitignore', '.hidden', 'global-ignored.dat', 'ignored file.bin', longRelativePath, 'run.sh', 'source.txt']);
    assert.equal((await runGit(checkout, ['rev-parse', 'HEAD'])).stdout.trim(), prepared.commit);
    assert.equal((await runGit(checkout, ['show', 'HEAD:source.txt'])).stdout, 'original\r\n');
    assert.equal((await runGit(checkout, ['show', `HEAD:${longRelativePath}`])).stdout, 'long path source\n');
    await runGit(checkout, ['-c', 'core.autocrlf=false', 'checkout', 'HEAD', '--', 'ignored file.bin', '.hidden', 'global-ignored.dat']);
    assert.deepEqual(await readFile(join(checkout, 'ignored file.bin')), bytes);
    assert.equal(await readFile(join(checkout, '.hidden'), 'utf8'), 'hidden\n');
    assert.equal(await readFile(join(checkout, 'global-ignored.dat'), 'utf8'), 'globally ignored source\n');
    if (process.platform !== 'win32') assert.match((await runGit(checkout, ['ls-tree', 'HEAD', 'run.sh'])).stdout, /^100755 /u);
    assert.equal(await readFile(join(directory, '.git', 'config'), 'utf8'), 'old metadata\n');
    assert.equal(await readFile(join(directory, 'source.txt'), 'utf8'), 'original\r\n');
});

test('POSIX snapshots reject Git metadata aliases, Windows-invalid names and case collisions without filtering or renaming', async t => {
    if (process.platform === 'win32') {
        t.skip('These invalid source trees require a case-sensitive POSIX filesystem.');
        return;
    }
    const {configurationPath: sourcesConfigurationPath, sources} = await createValidationSourcesFixture(t);
    const root = await createTemporaryDirectory(t, 'arw-portable-snapshot-');
    const candidateCommit = 'c'.repeat(40);
    /** @type {Array<Record<string, string>>} */
    const cases = [
        {'.GIT/retained.txt': 'case-sensitive source\n'},
        {'bad:name': 'POSIX source\n'},
        {'Case.txt': 'upper\n', 'case.txt': 'lower\n'},
    ];
    for (const [index, files] of cases.entries()) {
        for (const [path, bytes] of Object.entries(files)) {
            await mkdir(dirname(join(sources.plain.directory, path)), {recursive: true});
            await writeFile(join(sources.plain.directory, path), bytes);
        }
        const namesBefore = (await readdir(sources.plain.directory)).sort();
        const workspaceDirectory = join(root, `rejected-${index}`);
        let targetGitOperations = 0;
        const adapter = preparationAdapter(candidateCommit);
        await assert.rejects(prepareReleaseValidationBundles({candidateCommit, sourcesConfigurationPath, workspaceDirectory}, {
            run: request => {
                if (request.cwd === join(workspaceDirectory, '.bundle-input', 'plain', 'repository.git')) targetGitOperations += 1;
                return adapter.run(request);
            },
        }, () => {}), /complete ordinary-file snapshot/u);
        assert.equal(targetGitOperations, 0);
        assert.deepEqual((await readdir(sources.plain.directory)).sort(), namesBefore);
        for (const [path, bytes] of Object.entries(files)) assert.equal(await readFile(join(sources.plain.directory, path), 'utf8'), bytes);
        for (const {directory} of Object.values(sources)) assert.equal(await readFile(join(directory, 'source.txt'), 'utf8'), 'source snapshot\n');
        await assert.rejects(readFile(join(workspaceDirectory, 'bundles.json')), {code: 'ENOENT'});
        for (const name of new Set(Object.keys(files).map(path => path.split('/')[0]))) await rm(join(sources.plain.directory, name), {recursive: true});
    }
});

test('snapshot preparation rejects NTFS Git metadata aliases before fetching the candidate', async t => {
    const {configurationPath: sourcesConfigurationPath, sources} = await createValidationSourcesFixture(t);
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-ntfs-snapshot-');
    await writeFile(join(sources.plain.directory, 'git~1'), 'ordinary source bytes\n');
    const adapter = createReleaseHostProcessAdapter();
    let fetches = 0;
    await assert.rejects(prepareReleaseValidationBundles({candidateCommit: 'c'.repeat(40), sourcesConfigurationPath, workspaceDirectory}, {
        run: request => {
            if (request.arguments.includes('fetch')) {
                fetches += 1;
                return Promise.resolve({exitCode: 1, stderr: 'Unexpected candidate fetch.', stdout: ''});
            }
            return adapter.run(request);
        },
    }, () => {}), /snapshot tree does not preserve the complete source/u);
    assert.equal(fetches, 0);
    assert.equal(await readFile(join(sources.plain.directory, 'git~1'), 'utf8'), 'ordinary source bytes\n');
    await assert.rejects(readFile(join(workspaceDirectory, 'bundles.json')), {code: 'ENOENT'});
});

test('preparation reloads current directories into new workspaces and refuses to replace active inputs', async t => {
    const {configurationPath: sourcesConfigurationPath, sources} = await createValidationSourcesFixture(t);
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-prepare-snapshot-');
    const nextWorkspace = await createTemporaryDirectory(t, 'arw-prepare-snapshot-next-');
    const candidateCommit = 'c'.repeat(40);
    const adapter = preparationAdapter(candidateCommit);
    const request = {candidateCommit, sourcesConfigurationPath, workspaceDirectory};
    const first = await prepareReleaseValidationBundles(request, adapter, () => {});
    const recordBytes = await readFile(join(workspaceDirectory, 'bundles.json'));
    assert.deepEqual(JSON.parse(recordBytes.toString()).targetCommits, first.targetCommits);
    const configurationBytes = await readFile(sourcesConfigurationPath, 'utf8');
    for (const resultText of [recordBytes.toString(), JSON.stringify(first)]) {
        for (const privateValue of [sources.plain.directory, sources.agentAssisted.directory, sourcesConfigurationPath, configurationBytes]) {
            assert.equal(resultText.includes(privateValue), false);
            assert.equal(resultText.includes(JSON.stringify(privateValue).slice(1, -1)), false);
        }
    }
    await writeFile(join(sources.plain.directory, 'source.txt'), 'replacement\n');
    await prepareReleaseValidationBundles({...request, workspaceDirectory: nextWorkspace}, adapter, () => {});
    assert.equal(await readFile(join(nextWorkspace, '.bundle-input', 'plain', 'files', 'source.txt'), 'utf8'), 'replacement\n');
    assert.equal(await readFile(join(workspaceDirectory, '.bundle-input', 'plain', 'files', 'source.txt'), 'utf8'), 'source snapshot\n');
    await assert.rejects(prepareReleaseValidationBundles(request, adapter, () => {}), {code: 'EEXIST'});
    assert.deepEqual(await readFile(join(workspaceDirectory, 'bundles.json')), recordBytes);
    await writeFile(sourcesConfigurationPath, '{}');
    const invalidWorkspace = await createTemporaryDirectory(t, 'arw-prepare-snapshot-invalid-');
    await assert.rejects(prepareReleaseValidationBundles({...request, workspaceDirectory: invalidWorkspace}, adapter, () => {}), /external JSON/u);
    assert.deepEqual(await readdir(invalidWorkspace), []);
});

test('unsupported snapshot entries fail without changing either source or returning a prepared record', async t => {
    const {configurationPath: sourcesConfigurationPath, sources} = await createValidationSourcesFixture(t);
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-unsupported-snapshot-');
    const link = join(sources.plain.directory, 'unsupported-link');
    try {
        await symlink(sources.agentAssisted.directory, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EPERM') {
            t.skip('The current environment does not allow directory links.');
            return;
        }
        throw error;
    }
    const target = await readlink(link);
    const candidateCommit = 'c'.repeat(40);
    await assert.rejects(prepareReleaseValidationBundles({candidateCommit, sourcesConfigurationPath, workspaceDirectory}, preparationAdapter(candidateCommit), () => {}), /complete ordinary-file snapshot/u);
    assert.equal((await lstat(link)).isSymbolicLink(), true);
    assert.equal(await readlink(link), target);
    for (const {directory} of Object.values(sources)) assert.equal(await readFile(join(directory, 'source.txt'), 'utf8'), 'source snapshot\n');
    assert.deepEqual((await readdir(sources.plain.directory)).sort(), ['source.txt', 'unsupported-link']);
    assert.deepEqual(await readdir(sources.agentAssisted.directory), ['source.txt']);
    await assert.rejects(readFile(join(workspaceDirectory, 'bundles.json')), {code: 'ENOENT'});
});

test('late target bundle failure leaves sources unchanged and no runnable preparation record', async t => {
    const {configurationPath: sourcesConfigurationPath, sources} = await createValidationSourcesFixture(t);
    const workspaceDirectory = await createTemporaryDirectory(t, 'arw-failed-snapshot-bundle-');
    const candidateCommit = 'c'.repeat(40);
    const adapter = preparationAdapter(candidateCommit);
    let bundleAttempted = false;
    await assert.rejects(prepareReleaseValidationBundles({candidateCommit, sourcesConfigurationPath, workspaceDirectory}, {
        run: request => {
            if (request.cwd === join(workspaceDirectory, '.bundle-input', 'plain', 'repository.git') && request.arguments.includes('bundle')) {
                bundleAttempted = true;
                return Promise.resolve({exitCode: 1, stderr: 'Injected bundle failure.', stdout: ''});
            }
            return adapter.run(request);
        },
    }, () => {}), /snapshot Git operation failed/u);
    assert.equal(bundleAttempted, true);
    for (const {directory} of Object.values(sources)) {
        assert.deepEqual(await readdir(directory), ['source.txt']);
        assert.equal(await readFile(join(directory, 'source.txt'), 'utf8'), 'source snapshot\n');
    }
    await assert.rejects(readFile(join(workspaceDirectory, 'bundles.json')), {code: 'ENOENT'});
});

test('prepare-bundles CLI requires and passes the external sources path independently of VM configuration', async () => {
    const workspace = join(process.cwd(), '.tmp', 'sources-cli');
    const sourcePath = join(workspace, 'external-sources.json');
    /** @type {unknown[]} */
    const requests = [];
    const options = {
        prepareBundles: async (/** @type {Parameters<typeof prepareReleaseValidationBundles>[0]} */ request) => {
            requests.push(request);
            return {bundles: {agentAssisted: 'assisted', candidate: 'candidate', plain: 'plain'}, candidateCommit: request.candidateCommit, priorRelease: {commit: 'd'.repeat(40), tag: '0.2.1'}, status: 'prepared', targetCommits: {agentAssisted: '1'.repeat(40), plain: '2'.repeat(40)}};
        },
        validateWorkspacePath: () => {},
        errorOutput: {write: () => {}},
        output: {write: () => {}},
    };
    const args = ['prepare-bundles', '--candidate', 'c'.repeat(40), '--workspace', workspace];
    assert.equal(await runReleaseVmValidationCli(args, options), 2);
    assert.equal(await runReleaseVmValidationCli([...args, '--sources', sourcePath], options), 0);
    assert.deepEqual(requests, [{candidateCommit: 'c'.repeat(40), sourcesConfigurationPath: sourcePath, workspaceDirectory: workspace}]);
});
