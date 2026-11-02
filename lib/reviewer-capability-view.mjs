// Blind-pool views: stages the reviewed state of a scenario into a pool's `adj/` directory. It connects `setup` (the scenario
// repository, for `change.diff` and the Spec Readiness Request) with the pool key, so it sits at the top level of `lib/`.

import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {promisify} from 'node:util';

import {compareText, sha256} from './common/json.mjs';
import {PoolError, readKey} from './reviewer-capability/pool.mjs';
import {exists, scenarioFiles} from './reviewer-capability/scenario.mjs';
import {setupScenario} from './reviewer-capability-setup.mjs';

const run = promisify(execFile);
const REQUEST = /(?:^|\/)spec-readiness\/requests\/request-[^/]+\.json$/u;

/**
 * @param {{name: string, root: string, scenario: string}} input
 * @returns {Promise<any>} {status, diagnostics, views, files}
 */
export const poolView = async ({name, root, scenario}) => {
    const blocked = (/** @type {string} */ message) => ({diagnostics: [message], status: 'blocked'});
    /** @type {string} */
    let stage = 'pool-write';
    /** @type {string | undefined} */
    let scratch;
    try {
        const {key} = await readKey(root, name);
        const directory = resolve(scenario);
        if (basename(dirname(directory)) !== key.role) return blocked(`The scenario must belong to the role ${key.role}.`);
        const adj = join(root, name, 'adj');
        for (const view of key.views) if (await exists(join(adj, view))) return blocked(`${join(adj, view)} already exists.`);
        /** @type {Map<string, Buffer | string>} */
        const files = new Map();
        /** @type {Record<string, string>} */
        const expectedSha256 = {};
        scratch = await mkdtemp(join(tmpdir(), 'pool-view-'));
        for (const [path, source] of await scenarioFiles(directory)) files.set(`view/${path}`, await readFile(source));
        expectedSha256[basename(directory)] = sha256(await readFile(join(directory, 'expected.json')));
        const needDiff = key.views.includes('change.diff');
        const specReadiness = key.role === 'spec-readiness-reviewer';
        if (needDiff || specReadiness) {
            stage = 'scenario-build';
            const target = join(scratch, 'repo');
            const setup = await setupScenario({scenario: directory, target});
            if (setup.status !== 'succeeded') return setup;
            if (needDiff) files.set('change.diff', (await run('git', ['diff', '--cached', '--no-ext-diff', 'HEAD'], {cwd: target, maxBuffer: 1 << 28})).stdout);
            if (specReadiness) {
                const requests = (await readdir(join(target, '.tmp'), {recursive: true})).map(path => path.split('\\').join('/')).filter(path => REQUEST.test(path));
                if (requests.length !== 1) return blocked(`${directory}: expected exactly one Reviewer Request, found ${requests.length}.`);
                const request = JSON.parse(await readFile(join(target, '.tmp', requests[0]), 'utf8'));
                if (typeof request.draftPath !== 'string') return blocked(`${directory}: the Reviewer Request has no draftPath.`);
                files.set('view/REVIEWER-REQUEST.json', `${JSON.stringify({...request, draftPath: '<redacted>'}, null, 1)}\n`);
            }
        }
        stage = 'pool-write';
        const hashes = Object.fromEntries([...files].sort(([left], [right]) => compareText(left, right)).map(([path, content]) => [path, sha256(content)]));
        for (const [path, content] of files) {
            await mkdir(dirname(join(adj, path)), {recursive: true});
            await writeFile(join(adj, path), content);
        }
        await writeFile(join(root, name, 'view-binding.json'), `${JSON.stringify({role: key.role, views: key.views, files: hashes, expectedSha256}, null, 1)}\n`);
        return {diagnostics: [], files: files.size, status: 'succeeded', views: [...key.views]};
    } catch (error) {
        if (error instanceof PoolError) return blocked(error.message);
        return {diagnostics: [error instanceof Error ? error.message : String(error)], stage, status: 'failed'};
    } finally {
        if (scratch) await rm(scratch, {force: true, recursive: true});
    }
};
