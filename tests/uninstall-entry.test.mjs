import assert from 'node:assert/strict';
import {syncBuiltinESMExports} from 'node:module';
import readline from 'node:readline/promises';
import test from 'node:test';

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
