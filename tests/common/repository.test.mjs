import assert from 'node:assert/strict';
import {join, resolve} from 'node:path';
import test from 'node:test';

import {resolveRepository} from '../../lib/common/repository.mjs';

test('Repository Module returns one canonical identity and a bound safe path resolver', async () => {
    const root = resolve('repository-root');
    const result = await resolveRepository({
        observer: {
            canonicalize: async path => path,
            discover: async () => ({kind: 'observed', root}),
        },
        startDirectory: join(root, 'nested'),
    });

    assert.equal(result.status, 'succeeded');
    assert.equal(result.repository.identity, root);
    assert.equal(result.repository.resolvePath('docs/spec.md').status, 'succeeded');
    assert.deepEqual(result.repository.resolvePath('../outside'), {
        diagnostics: [{
            code: 'repository-path-escape',
            message: 'The path escapes the Repository root.',
            path: '../outside',
        }],
        status: 'blocked',
    });
    const normalized = result.repository.resolvePath('draft/../docs/spec.md');
    assert.equal(normalized.status, 'succeeded');
    if (normalized.status !== 'succeeded') assert.fail('Repository path normalization must succeed.');
    assert.equal(normalized.path, 'docs/spec.md');
});
