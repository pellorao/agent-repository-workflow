import assert from 'node:assert/strict';
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {runGit} from '../helpers/git.mjs';
import {loadInstallationPayload} from '../../lib/installation/installation-payload.mjs';
import {prepareReleaseVersionFixtures} from '../../scripts/prepare-release-version-fixtures.mjs';

const SOURCE_DIRECTORY = resolve(new URL('../../', import.meta.url).pathname.slice(process.platform === 'win32' ? 1 : 0));

const createMinimalCandidate = async (/** @type {string} */ directory) => {
    const copiedFiles = [
        'arw',
        'arw.cmd',
        'config.install.json',
        'install.mjs',
        'lib/installation/installation-payload.mjs',
        'scripts/prepare-release-version-fixtures.mjs',
        'arw.mjs',
        'distribution/config.json',
        'distribution/projections/config.json',
        'distribution/projections/codex/config.toml',
        'distribution/baseline/.arwignore',
        'distribution/baseline/docs/agents/roles/requirements-reviewer.md',
        'distribution/skills/grilling/SKILL.md',
    ];
    await Promise.all(copiedFiles.map(async path => {
        const target = join(directory, ...path.split('/'));
        await mkdir(dirname(target), {recursive: true});
        await copyFile(join(SOURCE_DIRECTORY, ...path.split('/')), target);
    }));
    const version = JSON.parse(await readFile(join(SOURCE_DIRECTORY, 'package.json'), 'utf8')).version;
    const manifest = {
        configSeed: 'config.install.json',
        distributionRoot: 'distribution',
        launchers: {darwin: ['arw'], linux: ['arw'], win32: ['arw.cmd']},
        runtimeFiles: ['arw.mjs'],
    };
    await Promise.all([
        writeFile(join(directory, 'package.json'), `${JSON.stringify({
            name: 'agent-repository-workflow',
            version,
        }, null, 2)}\n`, 'utf8'),
        writeFile(join(directory, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    ]);
    await runGit(directory, ['init', '--quiet']);
    await runGit(directory, ['add', '-A']);
};

test('release version fixture generator checks out the nearest reachable stable release without rewriting bytes', async t => {
    const root = await createTemporaryDirectory(t, 'arw-release-fixtures-');
    const sourceDirectory = join(root, 'candidate');
    const outputDirectory = join(root, 'fixtures');
    await mkdir(sourceDirectory);
    await createMinimalCandidate(sourceDirectory);
    await writeFile(join(sourceDirectory, 'package.json'), `${JSON.stringify({name: 'agent-repository-workflow', version: '0.1.0'}, null, 2)}\n`);
    await runGit(sourceDirectory, ['add', '-A']);
    await runGit(sourceDirectory, ['-c', 'user.name=ARW Test', '-c', 'user.email=arw@example.invalid', 'commit', '--quiet', '-m', 'release 0.1.0']);
    await runGit(sourceDirectory, ['tag', '0.1.0']);
    await writeFile(join(sourceDirectory, 'package.json'), `${JSON.stringify({name: 'agent-repository-workflow', version: '0.2.1'}, null, 2)}\n`);
    await runGit(sourceDirectory, ['add', '-A']);
    await runGit(sourceDirectory, ['-c', 'user.name=ARW Test', '-c', 'user.email=arw@example.invalid', 'commit', '--quiet', '-m', 'release 0.2.1']);
    await runGit(sourceDirectory, ['-c', 'user.name=ARW Test', '-c', 'user.email=arw@example.invalid', 'tag', '--annotate', '--message', 'release 0.2.1', '0.2.1']);
    const priorCommit = (await runGit(sourceDirectory, ['rev-parse', '0.2.1^{commit}'])).stdout.trim();
    await writeFile(join(sourceDirectory, 'package.json'), `${JSON.stringify({name: 'agent-repository-workflow', version: '0.3.0'}, null, 2)}\n`);
    await runGit(sourceDirectory, ['add', '-A']);
    await runGit(sourceDirectory, ['-c', 'user.name=ARW Test', '-c', 'user.email=arw@example.invalid', 'commit', '--quiet', '-m', 'candidate']);
    const unchangedSources = new Map(await Promise.all([
        'install.mjs',
        'lib/installation/installation-payload.mjs',
        'release-manifest.json',
    ].map(async path => {
        /** @type {[string, Buffer]} */
        const entry = [path, await readFile(join(sourceDirectory, ...path.split('/')))];
        return entry;
    })));
    /** @type {string[][]} */
    const gitCalls = [];
    const result = await prepareReleaseVersionFixtures({outputDirectory, sourceDirectory}, {
        runGit: async (directory, args) => {
            gitCalls.push(args);
            return runGit(directory, args);
        },
    });
    assert.deepEqual(result.priorRelease, {commit: priorCommit, tag: '0.2.1'});
    const directory = join(outputDirectory, 'prior');
    assert.equal((await runGit(directory, ['rev-parse', 'HEAD'])).stdout.trim(), priorCommit);
    assert.equal(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).version, '0.2.1');
    const cloneArguments = gitCalls.find(args => args.includes('clone'));
    assert.deepEqual(cloneArguments?.slice(0, -1), [
        '-c',
        'core.longpaths=true',
        '-c',
        'core.autocrlf=false',
        'clone',
        '--quiet',
        '--no-local',
        '--branch',
        '0.2.1',
        sourceDirectory,
    ]);
    assert.equal(cloneArguments?.at(-1)?.endsWith('/prior'), true);
    for (const [path, bytes] of unchangedSources) {
        assert.deepEqual(await readFile(join(directory, ...path.split('/'))), bytes);
    }
    const lowerPayload = await loadInstallationPayload({
        platform: process.platform,
        sourceDirectory: directory,
    });
    assert.equal(lowerPayload.status, 'succeeded', JSON.stringify(lowerPayload.diagnostics));
});
