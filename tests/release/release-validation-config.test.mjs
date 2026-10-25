import assert from 'node:assert/strict';
import test from 'node:test';

import {
    loadReleaseValidationConfiguration,
    validateReleaseValidationConfiguration,
} from '../../lib/release/release-validation-config.mjs';

test('tracked release-validation.json loads the canonical HTTPS remote', async () => {
    const loaded = await loadReleaseValidationConfiguration();
    assert.equal(loaded.status, 'succeeded');
    assert.match(/** @type {any} */ (loaded).value.repositories.sourceCheckout.url, /^https:\/\/.+\.git$/u);
});

test('release validation configuration rejects extra fields and non-HTTPS remotes', () => {
    const source = (/** @type {string} */ url) => ({repositories: {sourceCheckout: {url}}});
    for (const value of [
        {...source('https://example.invalid/team/arw.git'), version: 1},
        source('ssh://git@example.invalid/arw.git'),
        source('https://user@example.invalid/arw.git'),
        source('https://example.invalid/arw'),
    ]) assert.equal(validateReleaseValidationConfiguration(value).status, 'blocked');
});
