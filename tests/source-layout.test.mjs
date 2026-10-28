import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {access, readFile} from 'node:fs/promises';
import {builtinModules} from 'node:module';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

import {moduleSpecifiers, resolveSourceImport} from './helpers/module-imports.mjs';

const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const nodeModules = new Set(builtinModules.flatMap(identity => [identity, `node:${identity}`]));

const readSourcePaths = async () => {
    const {stdout} = await execute('git', ['ls-files', '--', 'scripts', 'lib'], {cwd: repositoryRoot});
    return stdout.trim().split('\n').filter(Boolean).sort();
};

test('source checkout does not retain target Repository lifecycle state', async () => {
    await assert.rejects(access(new URL('../arw-lock.json', import.meta.url)), {code: 'ENOENT'});
});

test('source checkout keeps maintenance entries flat and implementations in responsibility directories', async () => {
    const paths = await readSourcePaths();
    const scriptPaths = paths.filter(path => path.startsWith('scripts/'));
    assert.ok(scriptPaths.length > 0);
    for (const path of scriptPaths) {
        assert.equal(path.split('/').length, 2, `${path} must be a direct scripts/ entry.`);
    }

    const implementationPaths = paths.filter(path => path.startsWith('lib/') && path.endsWith('.mjs'));
    for (const path of implementationPaths) {
        const segments = path.split('/');
        assert.notEqual(segments.at(-1), 'index.mjs', `${path} must not add an aggregate entry.`);
        if (segments.length > 2) continue;

        const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
        const responsibilities = new Set(moduleSpecifiers(source)
            .filter(specifier => specifier.startsWith('./'))
            .map(specifier => resolveSourceImport(path, specifier).split('/')[1])
            .filter(Boolean));
        assert.ok(responsibilities.size > 1, `${path} must connect multiple responsibility directories.`);
    }
});

test('shared implementation dependencies point from arw-common to common without business imports', async () => {
    const paths = (await readSourcePaths()).filter(path => path.startsWith('lib/') && path.endsWith('.mjs'));
    for (const path of paths) {
        const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
        for (const specifier of moduleSpecifiers(source)) {
            if (!specifier.startsWith('.')) {
                assert.ok(nodeModules.has(specifier), `${path} imports a non-Node runtime package: ${specifier}`);
                continue;
            }
            const target = resolveSourceImport(path, specifier);
            if (path.startsWith('lib/common/')) {
                assert.match(target, /^lib\/common\//u, `${path} imports outside lib/common/: ${specifier}`);
            } else if (path.startsWith('lib/arw-common/')) {
                assert.match(target, /^lib\/(?:arw-common|common)\//u, `${path} imports a business implementation: ${specifier}`);
            }
        }
    }
});

test('.claude/skills/ matches the claude-code projection of .agents/skills/', async () => {
    const {staleClaudeSkills} = await import('../scripts/project-claude-skills.mjs');
    assert.deepEqual(await staleClaudeSkills(), [], 'Run: node scripts/project-claude-skills.mjs');
});
