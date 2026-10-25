import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createTemporaryDirectory} from './helpers/cleanup.mjs';
import {runProcess} from './helpers/process.mjs';

test('concise reporter retains native failures, cancellation, logs and complete final statistics', async t => {
    const root = await createTemporaryDirectory(t, 'arw-test-reporter-');
    const fixture = join(root, 'cases.mjs');
    await writeFile(fixture, `import test from 'node:test';
import assert from 'node:assert/strict';
test('successful-item-hidden', () => { console.log('visible stdout'); console.error('visible stderr'); process.emitWarning('visible warning'); });
test('assertion-failure', () => assert.equal('actual-value', 'expected-value'));
test('nested-parent', async t => { await t.test('nested-child-failure', () => assert.fail('nested failure detail')); });
function runtimeFailureFrame() { throw new Error('runtime exception detail'); }
test('runtime-exception', () => runtimeFailureFrame());
test('cancelled-item', {signal: AbortSignal.abort()}, () => {});
test.skip('skipped-item', () => {});
test.todo('todo-item');
`);
    const [result, native] = await Promise.all([
        runProcess(process.execPath, ['--test', `--test-reporter=${fileURLToPath(new URL('./helpers/test-reporter.mjs', import.meta.url))}`, fixture]),
        runProcess(process.execPath, ['--test', '--test-reporter=tap', fixture]),
    ]);
    assert.equal(result.status, 'exited');
    if (result.status !== 'exited') assert.fail();
    assert.equal(result.exitCode, 1);
    assert.doesNotMatch(result.stdout, /successful-item-hidden/u);
    for (const expected of ['visible stdout', 'visible stderr', 'visible warning', 'assertion-failure', 'actual-value', 'expected-value', 'nested-parent', 'nested-child-failure', 'nested failure detail', 'runtime-exception', 'runtime exception detail', 'cancelled-item', 'cases.mjs']) assert.ok(result.stdout.includes(expected), expected);
    assert.match(result.stdout, /at runtimeFailureFrame \([^\n]*cases\.mjs:\d+:\d+\)/u);
    assert.equal(native.status, 'exited');
    if (native.status !== 'exited') assert.fail();
    assert.equal(result.exitCode, native.exitCode);
    for (const name of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
        const count = new RegExp(`^# ${name} (\\d+)$`, 'm').exec(native.stdout)?.[1];
        assert.ok(count, name);
        assert.match(result.stdout, new RegExp(`^${name} ${count}$`, 'm'));
    }
    assert.match(result.stdout, /^duration_ms /mu);
});
