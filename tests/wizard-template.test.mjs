import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from './helpers/cleanup.mjs';
import {runExitedProcess} from './helpers/process.mjs';

const library = (await readFile(new URL('../distribution/skills/wizard/template.sh', import.meta.url), 'utf8'))
    .replace(/^run_wizard "\$@"; exit\s*$/mu, '');
const runWizard = (/** @type {string} */ cwd, /** @type {string} */ script) =>
    runExitedProcess('bash', ['-s'], {cwd, input: `${library}\n${script}\n`, env: {...process.env, ENV_FILE: '.env'}});

test('write_env reports read errors without truncating the file or recording success', async t => {
    const root = await createTemporaryDirectory(t, 'wizard-read-');
    await writeFile(join(root, '.env'), 'KEEP=original\n');
    const result = await runWizard(root, `
grep() { printf 'read failed\\n' >&2; return 2; }
write_env NEW value
finish`);
    assert.equal(result.exitCode, 2);
    assert.match(result.stdout, /couldn't read .env/u);
    assert.match(result.stderr, /read failed/u);
    assert.doesNotMatch(result.stdout, /wrote|Setup complete/u);
    assert.equal(await readFile(join(root, '.env'), 'utf8'), 'KEEP=original\n');
});

test('write_env reports failed writes and stops before the success summary', async t => {
    const root = await createTemporaryDirectory(t, 'wizard-write-');
    await writeFile(join(root, '.env'), 'KEEP=original\n');
    const result = await runWizard(root, `
cat() { printf 'write failed\\n' >&2; return 1; }
write_env NEW value
finish`);
    assert.equal(result.exitCode, 1);
    assert.match(result.stdout, /couldn't write .env/u);
    assert.match(result.stderr, /write failed/u);
    assert.doesNotMatch(result.stdout, /wrote|Setup complete/u);
});

test('write_env accepts grep no-match results and preserves unrelated lines', async t => {
    const root = await createTemporaryDirectory(t, 'wizard-upsert-');
    await writeFile(join(root, '.env'), 'KEY=old\n');
    const result = await runWizard(root, `
write_env KEY replacement
write_env NEW value
finish`);
    assert.equal(result.exitCode, 0);
    assert.equal(await readFile(join(root, '.env'), 'utf8'), "KEY='replacement'\nNEW='value'\n");
    assert.match(result.stdout, /wrote 2 value\(s\).*KEY NEW/u);
});

test('set_var summarizes successful variables and keeps failed ones in the to-do list', async t => {
    const root = await createTemporaryDirectory(t, 'wizard-vars-');
    const result = await runWizard(root, `
gh() { [[ "$1" == auth || "$3" == SAVED ]]; }
set_var SAVED value
set_var FAILED value
finish`);
    assert.equal(result.exitCode, 0);
    const summary = result.stdout.split('Setup complete')[1];
    assert.match(summary, /set 1 GitHub variable\(s\): SAVED/u);
    const todo = summary.split('still to do by hand:')[1];
    assert.match(todo, /GitHub variable FAILED/u);
    assert.doesNotMatch(todo, /SAVED/u);
});
