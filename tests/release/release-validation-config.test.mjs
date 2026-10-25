import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {
    loadReleaseValidationConfiguration,
    renderVmwareCompatibilityStdout,
    validateReleaseValidationConfiguration,
} from '../../lib/release/release-validation-config.mjs';
import {
    listPreTagArchiveKinds,
    resolveReleaseValidationRegistry,
} from '../../lib/release/release-validation-registry.mjs';

const configuration = () => ({
    initializationIssueScenario: 'scenarios/ubuntu/fresh-agent-assisted',
    prepareBundles: {hostCommandTimeoutMs: 123_456},
    repositories: {sourceCheckout: {url: 'https://example.invalid/team/arw.git'}},
    vmware: {
        hardPowerOffCompatibility: {
            exitCode: 7,
            stderr: '',
            stdoutTemplate: 'not powered on: {machineLocation}\n',
            vmrunVersion: 'vmrun test version',
        },
        softPowerOffTimeoutMs: {
            Alpine: 1_000,
            Ubuntu: 2_000,
            'Windows 11': 3_000,
        },
    },
});



test('release validation configuration rejects extra fields and each invalid owned value class', () => {
    const cases = [
        {...configuration(), version: 1},
        {...configuration(), repositories: {
            ...configuration().repositories,
            plain: {commit: 'a'.repeat(40), url: 'https://example.invalid/plain.git'},
        }},
        {...configuration(), repositories: {...configuration().repositories, sourceCheckout: {url: 'ssh://git@example.invalid/arw.git'}}},
        {...configuration(), prepareBundles: {hostCommandTimeoutMs: 0}},
        {...configuration(), vmware: {...configuration().vmware, softPowerOffTimeoutMs: {Ubuntu: 1}}},
    ];

    for (const value of cases) assert.equal(validateReleaseValidationConfiguration(value).status, 'blocked');
});
