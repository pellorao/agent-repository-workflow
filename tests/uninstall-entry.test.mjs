import assert from 'node:assert/strict';
import {syncBuiltinESMExports} from 'node:module';
import readline from 'node:readline/promises';
import test from 'node:test';

import {createTemporaryDirectory} from './helpers/cleanup.mjs';

test('uninstaller rejects invalid arguments without opening an interactive interface', async t => {
    const argv = process.argv;
    const exitCode = process.exitCode;
    const prompt = t.mock.method(readline, 'createInterface', () => assert.fail('No prompt is needed.'));
    const stderr = t.mock.method(process.stderr, 'write', () => true);
    syncBuiltinESMExports();
    try {
        process.argv = [process.execPath, 'uninstall.mjs', '--unknown'];
        await import(new URL('../uninstall.mjs?invalid-arguments', import.meta.url).href);
        assert.equal(process.exitCode, 2);
        assert.equal(prompt.mock.callCount(), 0);
    } finally {
        process.argv = argv;
        process.exitCode = exitCode;
        prompt.mock.restore();
        stderr.mock.restore();
        syncBuiltinESMExports();
    }
});

test('uninstaller reuses one interactive interface and closes it on cancellation or input failure', async t => {
    const argv = process.argv;
    const exitCode = process.exitCode;
    const previousHome = process.env.HOME;
    const home = await createTemporaryDirectory(t, 'arw-uninstall-entry-');
    const stdout = t.mock.method(process.stdout, 'write', () => true);
    const stderr = t.mock.method(process.stderr, 'write', () => true);
    try {
        process.env.HOME = home;
        process.argv = [process.execPath, 'uninstall.mjs'];
        for (const [name, answers, expectedCode, questions] of /** @type {Array<[string, string[], number, number]>} */ ([
            ['cancel', ['invalid', 'no'], 0, 2],
            ['eof', ['yes'], 1, 2],
        ])) {
            const close = t.mock.fn();
            const prompt = t.mock.fn();
            const reader = /** @type {readline.Interface} */ (/** @type {unknown} */ ({
                [Symbol.asyncIterator]: () => answers.values(),
                close,
                prompt,
                setPrompt: () => {},
            }));
            const factory = t.mock.method(readline, 'createInterface', (/** @type {readline.ReadLineOptions} */ options) => {
                assert.equal(options.input, process.stdin);
                return reader;
            });
            syncBuiltinESMExports();
            try {
                await import(new URL(`../uninstall.mjs?interactive-${name}`, import.meta.url).href);
                assert.equal(process.exitCode, expectedCode);
                assert.equal(factory.mock.callCount(), 1);
                assert.equal(prompt.mock.callCount(), questions);
                assert.equal(close.mock.callCount(), 1);
            } finally {
                factory.mock.restore();
                syncBuiltinESMExports();
            }
        }
    } finally {
        process.argv = argv;
        process.exitCode = exitCode;
        if (previousHome === undefined) delete process.env.HOME;
        else process.env.HOME = previousHome;
        stdout.mock.restore();
        stderr.mock.restore();
    }
});
