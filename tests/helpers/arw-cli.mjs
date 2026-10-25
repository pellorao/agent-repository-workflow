import {EventEmitter} from 'node:events';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';

import {runArw} from '../../arw.mjs';
import {createTemporaryDirectory} from './cleanup.mjs';
import {createRepository as createGitRepository} from './repository-fixture.mjs';

/** @typedef {{programDirectory: string, root: string}} TestRepository */
/** @typedef {{channel: 'stderr' | 'stdout', message: string}} OutputEvent */
/** @typedef {NonNullable<NonNullable<Parameters<typeof runArw>[1]>['spawnProcess']>} ArwSpawn */

export const writeConfig = async (/** @type {string} */ programDirectory, /** @type {unknown} */ config = {configVersion: 1, editor: {command: 'code', args: ['{file}']}}) => {
    await writeFile(join(programDirectory, 'config.json'), JSON.stringify(config), 'utf8');
};

/** @returns {ReturnType<ArwSpawn> & EventEmitter} */
export const createMockChild = (/** @type {boolean} */ withUnref = false) => {
    const child = new EventEmitter();
    return withUnref ? Object.assign(child, {unref() {}}) : child;
};

export const createRepository = async (/** @type {import('node:test').TestContext} */ t) => {
    const root = await createGitRepository(t, {prefix: 'arw-repository-'});
    const programDirectory = await createTemporaryDirectory(t, 'arw-program-');
    await mkdir(join(root, '.scratch'), {recursive: true});
    await writeConfig(programDirectory);

    return {root, programDirectory};
};

export const writeIssue = async (/** @type {string} */ root, /** @type {string} */ effort, /** @type {string} */ filename, /** @type {string | NodeJS.ArrayBufferView<ArrayBufferLike> | Iterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>> | AsyncIterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>>} */ body) => {
    const directory = join(root, '.scratch', effort, 'issues');
    await mkdir(directory, {recursive: true});
    await writeFile(join(directory, filename), body, 'utf8');
};

export const writeArtifact = async (/** @type {string} */ root, /** @type {string} */ artifactId, /** @type {string} */ filename, /** @type {string | NodeJS.ArrayBufferView<ArrayBufferLike> | Iterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>> | AsyncIterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>>} */ body) => {
    const directory = join(root, '.scratch', artifactId);
    await mkdir(directory, {recursive: true});
    await writeFile(join(directory, filename), body, 'utf8');
};

export const run = async (/** @type {string[]} */ args, /** @type {TestRepository} */ repository, /** @type {Partial<Parameters<typeof runArw>[1]>} */ options = {}) => {
    /** @type {OutputEvent[]} */
    const events = [];
    const result = await runArw(args, {
        cwd: repository.root,
        programDirectory: repository.programDirectory,
        stdout: message => events.push({channel: 'stdout', message}),
        stderr: message => events.push({channel: 'stderr', message}),
        ...options,
    });

    return {events, result};
};

export const writeJsonRecord = async (/** @type {string} */ repositoryRoot, /** @type {string} */ filePath, /** @type {unknown} */ value) => {
    const path = join(repositoryRoot, ...filePath.split('/'));
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};
