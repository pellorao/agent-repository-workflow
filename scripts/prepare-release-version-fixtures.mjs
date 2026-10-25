#!/usr/bin/env node

import {execFile as execFileCallback} from 'node:child_process';
import {mkdtemp, readFile, rename, rm} from 'node:fs/promises';
import {dirname, isAbsolute, join} from 'node:path';
import {promisify} from 'node:util';

import {compareStableArwVersions, parsePackageIdentity} from '../lib/arw-common/identity.mjs';

const execFile = promisify(execFileCallback);

/** @param {string[]} args */
const parseArguments = args => {
    if (args.length !== 4 || args[0] !== '--source' || args[2] !== '--output') {
        throw new Error('Usage: node scripts/prepare-release-version-fixtures.mjs --source <absolute-candidate-checkout> --output <absolute-directory>');
    }
    if (!isAbsolute(args[1]) || !isAbsolute(args[3])) {
        throw new Error('Release fixture paths must be absolute.');
    }
    return {outputDirectory: args[3], sourceDirectory: args[1]};
};

/** @param {string} directory @param {string[]} args */
const defaultRunGit = async (directory, args) => execFile('git', ['-C', directory, ...args], {
    env: {
        ...process.env,
        GIT_AUTHOR_EMAIL: 'arw-release-validation@example.invalid',
        GIT_AUTHOR_NAME: 'ARW Release Validation',
        GIT_COMMITTER_EMAIL: 'arw-release-validation@example.invalid',
        GIT_COMMITTER_NAME: 'ARW Release Validation',
    },
    windowsHide: true,
});

/**
 * 从 candidate history 选择低于 candidate 的最近 stable Release tag, 并建立真实旧版 checkout.
 * @param {{outputDirectory: string, sourceDirectory: string}} input
 * @param {{runGit?: typeof defaultRunGit}} [dependencies]
 */
export const prepareReleaseVersionFixtures = async ({outputDirectory, sourceDirectory}, {runGit = defaultRunGit} = {}) => {
    const parent = dirname(outputDirectory);
    const temporaryDirectory = await mkdtemp(join(parent, 'arw-release-fixtures-'));
    try {
        const packageIdentity = parsePackageIdentity(await readFile(join(sourceDirectory, 'package.json')), 'package.json');
        const tags = (await runGit(sourceDirectory, ['tag', '--merged', 'HEAD', '--list'])).stdout.split('\n').filter(Boolean);
        const tag = tags.filter(value => {
            try {
                return compareStableArwVersions(value, packageIdentity.version) < 0;
            } catch {
                return false;
            }
        }).sort(compareStableArwVersions).at(-1);
        if (tag === undefined) throw new Error('Release candidate history has no prior stable Release tag.');
        const commit = (await runGit(sourceDirectory, ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`])).stdout.trim();
        await runGit(sourceDirectory, ['merge-base', '--is-ancestor', commit, 'HEAD']);
        const directory = join(temporaryDirectory, 'prior');
        await runGit(parent, [
            '-c',
            'core.longpaths=true',
            '-c',
            'core.autocrlf=false',
            'clone',
            '--quiet',
            '--no-local',
            '--branch',
            tag,
            sourceDirectory,
            directory,
        ]);
        const checkoutCommit = (await runGit(directory, ['rev-parse', '--verify', 'HEAD^{commit}'])).stdout.trim();
        const checkoutVersion = parsePackageIdentity(await readFile(join(directory, 'package.json')), 'package.json').version;
        if (checkoutCommit !== commit || checkoutVersion !== tag) {
            throw new Error('Prior Release tag, commit, and package version do not match.');
        }
        await rename(temporaryDirectory, outputDirectory);
        return {outputDirectory, priorRelease: {commit, tag}, status: 'prepared'};
    } catch (error) {
        await rm(temporaryDirectory, {force: true, recursive: true});
        throw error;
    }
};

if (process.argv[1]?.endsWith('prepare-release-version-fixtures.mjs')) {
    try {
        process.stdout.write(`${JSON.stringify(await prepareReleaseVersionFixtures(parseArguments(process.argv.slice(2))))}\n`);
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = error instanceof Error && error.message.startsWith('Usage:') ? 2 : 1;
    }
}
