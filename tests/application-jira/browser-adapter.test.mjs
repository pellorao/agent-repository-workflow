import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import test from 'node:test';

import {createDefaultBrowserAdapter} from '../../lib/application-jira/browser-adapter.mjs';

test('Browser Adapter excludes the JIRA token from the launched process environment', async () => {
    const environment = {
        DISPLAY: ':0',
        jira_access_token: 'case-insensitive-secret',
        JIRA_ACCESS_TOKEN: 'secret',
        PATH: '/usr/bin',
    };
    /** @type {import('node:child_process').SpawnOptions | undefined} */
    let observedOptions;
    const spawnProcess = (/** @type {string} */ command, /** @type {readonly string[]} */ args, /** @type {import('node:child_process').SpawnOptions} */ options) => {
        assert.equal(command, 'xdg-open');
        assert.deepEqual(args, ['https://jira.example.test/browse/PAY-1']);
        observedOptions = options;
        const child = Object.assign(new EventEmitter(), {unref() {}});
        queueMicrotask(() => child.emit('spawn'));
        return /** @type {ReturnType<typeof spawn>} */ (/** @type {unknown} */ (child));
    };
    const adapter = createDefaultBrowserAdapter({
        environment,
        platform: 'linux',
        spawnProcess: /** @type {typeof spawn} */ (/** @type {unknown} */ (spawnProcess)),
    });

    assert.deepEqual(await adapter.open('https://jira.example.test/browse/PAY-1'), {
        diagnostics: [],
        status: 'succeeded',
    });
    assert.deepEqual(observedOptions?.env, {DISPLAY: ':0', PATH: '/usr/bin'});
    assert.equal(environment.JIRA_ACCESS_TOKEN, 'secret');
});
