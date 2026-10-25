import assert from 'node:assert/strict';
import {
    lstat,
    mkdir,
    open,
    readFile,
    rm,
    writeFile,
} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import test from 'node:test';

import {runSuccessfulProcess} from '../helpers/process.mjs';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {
    createReleaseEvidenceArchive,
    verifyReleaseEvidenceArchive,
} from '../../lib/release/release-evidence-archive.mjs';

/** @type {Map<string, string[]>} */
const archiveKinds = new Map([
    ['observations/windows/recommended', [
        '001-install-prior-release',
        '002-prepare-preserved-configuration',
        '003-repair-prior-release',
        '004-upgrade-candidate',
        '005-reject-default-downgrade',
        '006-explicit-downgrade',
        '007-restore-candidate',
        '008-verify-launcher-powershell',
        '009-verify-launcher-cmd',
        '010-verify-launcher-git-bash',
        '011-verify-launcher-after-reboot-powershell',
        '012-verify-launcher-after-reboot-cmd',
        '013-verify-launcher-after-reboot-git-bash',
        '014-verify-installed-command',
        '015-verify-source-unavailable',
        '016-add-unknown-content',
        '017-uninstall-preserve-configuration',
        '018-reinstall-candidate',
        '019-uninstall-remove-configuration',
        '020-remove-test-residue',
        '021-verify-final-state',
    ]],
    ['observations/ubuntu/recommended', [
        '001-install-prior-release',
        '002-prepare-preserved-configuration',
        '003-repair-prior-release',
        '004-upgrade-candidate',
        '005-reject-default-downgrade',
        '006-explicit-downgrade',
        '007-restore-candidate',
        '008-verify-launcher-login-shell',
        '009-verify-installed-command',
        '010-verify-source-unavailable',
        '011-add-unknown-content',
        '012-uninstall-preserve-configuration',
        '013-reinstall-candidate',
        '014-uninstall-remove-configuration',
        '015-remove-test-residue',
        '016-verify-final-state',
    ]],
    ['observations/alpine/recommended', [
        '001-install-prior-release',
        '002-prepare-preserved-configuration',
        '003-repair-prior-release',
        '004-upgrade-candidate',
        '005-reject-default-downgrade',
        '006-explicit-downgrade',
        '007-restore-candidate',
        '008-verify-launcher-login-shell',
        '009-verify-installed-command',
        '010-verify-source-unavailable',
        '011-add-unknown-content',
        '012-uninstall-preserve-configuration',
        '013-reinstall-candidate',
        '014-uninstall-remove-configuration',
        '015-remove-test-residue',
        '016-verify-final-state',
    ]],
    ['observations/ubuntu/floor', [
        '001-check-esm-syntax',
        '002-install-candidate',
        '003-verify-launcher',
        '004-uninstall',
        '005-verify-final-state',
    ]],
    ['scenarios/windows/plain', [
        '001-install',
        '002-init',
        '003-workflow-update',
        '004-workflow-verify',
        '005-workflow-remove',
        '006-reinit',
        '007-final-workflow-verify',
        '008-uninstall',
    ]],
    ['scenarios/ubuntu/plain', [
        '001-install',
        '002-init',
        '003-workflow-update',
        '004-workflow-verify',
        '005-workflow-remove',
        '006-reinit',
        '007-final-workflow-verify',
        '008-uninstall',
    ]],
    ['scenarios/alpine/plain', [
        '001-install',
        '002-init',
        '003-workflow-update',
        '004-workflow-verify',
        '005-workflow-remove',
        '006-reinit',
        '007-final-workflow-verify',
        '008-uninstall',
    ]],
    ['scenarios/windows/agent-assisted', [
        '001-install-prior-release',
        '002-verify-prior-workflow',
        '003-upgrade-candidate',
        '004-workflow-update',
        '005-workflow-verify',
        '006-code-map-verify',
        '007-workflow-remove',
        '008-reinit',
        '009-final-workflow-verify',
        '010-final-code-map-verify',
        '011-uninstall',
    ]],
    ['scenarios/ubuntu/agent-assisted', [
        '001-install-prior-release',
        '002-verify-prior-workflow',
        '003-upgrade-candidate',
        '004-workflow-update',
        '005-workflow-verify',
        '006-code-map-verify',
        '007-workflow-remove',
        '008-reinit',
        '009-final-workflow-verify',
        '010-final-code-map-verify',
        '011-uninstall',
    ]],
    ['scenarios/alpine/agent-assisted', [
        '001-install-prior-release',
        '002-verify-prior-workflow',
        '003-upgrade-candidate',
        '004-workflow-update',
        '005-workflow-verify',
        '006-code-map-verify',
        '007-workflow-remove',
        '008-reinit',
        '009-final-workflow-verify',
        '010-final-code-map-verify',
        '011-uninstall',
    ]],
    ['scenarios/ubuntu/fresh-agent-assisted', [
        '001-install',
        '002-init',
        '003-complete-initialization-issue',
        '004-workflow-update',
        '005-workflow-verify',
        '006-code-map-verify',
        '007-workflow-remove',
        '008-reinit',
        '009-final-workflow-verify',
        '010-final-code-map-verify',
        '011-uninstall',
    ]],
    ['post-tag', ['001-verify-post-tag-bootstrap']],
]);

const mainAgentStep = (/** @type {string | string[]} */ step) => (
    step.includes('prepare-preserved-configuration')
    || step.includes('add-unknown-content')
    || step.includes('remove-test-residue')
    || step.includes('verify-final-state')
    || step.includes('complete-initialization-issue')
);

/** @param {string} archiveKind */
const requiredSteps = archiveKind => {
    const steps = archiveKinds.get(archiveKind);
    if (steps === undefined) throw new Error(`Missing test archive kind: ${archiveKind}.`);
    return steps;
};

const createFixture = async (/** @type {test.TestContext} */ t, archiveKind = 'post-tag') => {
    const root = await createTemporaryDirectory(t, 'arw-release-evidence-archive-');
    const sourceDirectory = join(root, 'source');
    const steps = requiredSteps(archiveKind);
    await mkdir(sourceDirectory, {recursive: true});
    await writeFile(join(sourceDirectory, 'summary.json'), `${JSON.stringify({
        matchesExpected: true,
        steps,
        summary: 'Every recorded step matches the release expectation.',
    })}\n`, 'utf8');
    for (const [index, step] of steps.entries()) {
        const stepDirectory = join(sourceDirectory, 'steps', step);
        await mkdir(stepDirectory, {recursive: true});
        const files = index === 0 ? [{
            changeType: 'added',
            matchesExpected: true,
            path: 'installed/example.txt',
            summary: 'The expected file was added.',
        }] : [];
        const validation = {
            ...(!mainAgentStep(step) ? {exitCode: step.includes('reject-default-downgrade') ? 1 : 0} : {}),
            files,
            matchesExpected: true,
            summary: 'The step produced the expected result.',
        };
        await writeFile(join(stepDirectory, 'validation.json'), `${JSON.stringify(validation)}\n`, 'utf8');
        if (!mainAgentStep(step)) {
            await writeFile(join(stepDirectory, 'stdout.txt'), '', 'utf8');
            await writeFile(join(stepDirectory, 'stderr.txt'), '', 'utf8');
        }
    }
    return {root, sourceDirectory, steps};
};

const assertRegisteredKinds = async (/** @type {test.TestContext} */ t, /** @type {string[]} */ kinds) => {
    for (const archiveKind of kinds) {
        const steps = requiredSteps(archiveKind);
        await t.test(archiveKind, async t => {
            const {root, sourceDirectory} = await createFixture(t, archiveKind);
            const firstPath = resolve(root, 'first.tar');
            const secondPath = resolve(root, 'second.tar');
            const entryCount = 1 + steps.reduce((count, step) => count + (mainAgentStep(step) ? 1 : 3), 0);

            const first = await createReleaseEvidenceArchive({archiveKind, outputPath: firstPath, sourceDirectory});
            const second = await createReleaseEvidenceArchive({archiveKind, outputPath: secondPath, sourceDirectory});
            const verified = await verifyReleaseEvidenceArchive({archiveKind, archivePath: firstPath});

            assert.deepEqual(first, {archiveKind, entryCount, outputPath: firstPath, status: 'created'});
            assert.deepEqual(verified, {archiveKind, archivePath: firstPath, entryCount, status: 'verified'});
            assert.deepEqual(await readFile(firstPath), await readFile(secondPath));
            assert.equal((await readFile(firstPath)).includes(Buffer.from('manifest.json')), false);
        });
    }
};

test('release evidence archive creation is deterministic and verifies archive-kind inventory without an internal manifest', async t => {
    await assertRegisteredKinds(t, ['post-tag']);
});

test('release evidence archive verification compares every byte with the bound source directory', async t => {
    const archiveKind = 'observations/ubuntu/floor';
    const {root, sourceDirectory, steps} = await createFixture(t, archiveKind);
    const archivePath = resolve(root, 'source-bound.tar');
    await createReleaseEvidenceArchive({archiveKind, outputPath: archivePath, sourceDirectory});
    assert.equal((await verifyReleaseEvidenceArchive({archiveKind, archivePath, sourceDirectory})).status, 'verified');
    await writeFile(join(sourceDirectory, 'steps', steps[0], 'stdout.txt'), 'changed after archive creation\n');
    await assert.rejects(
        verifyReleaseEvidenceArchive({archiveKind, archivePath, sourceDirectory}),
        /archive bytes differ from the source directory/,
    );
});

test('release evidence archive verifies Windows, Ubuntu, Alpine, and Node.js floor platform inventories', async t => {
    await assertRegisteredKinds(t, [
        'observations/windows/recommended',
        'observations/ubuntu/recommended',
        'observations/alpine/recommended',
        'observations/ubuntu/floor',
    ]);
});

test('release evidence archive verifies plain and agent-assisted Repository inventories on all three platforms', async t => {
    await assertRegisteredKinds(t, [
        'scenarios/windows/plain',
        'scenarios/windows/agent-assisted',
        'scenarios/ubuntu/plain',
        'scenarios/ubuntu/agent-assisted',
        'scenarios/alpine/plain',
        'scenarios/alpine/agent-assisted',
        'scenarios/ubuntu/fresh-agent-assisted',
    ]);
});

test('release evidence archive rejects invalid kind, source inventory, and validation schema before output', async t => {
    const {root, sourceDirectory, steps} = await createFixture(t);
    const outputPath = resolve(root, 'invalid.tar');
    await assert.rejects(
        createReleaseEvidenceArchive({archiveKind: 'unknown', outputPath, sourceDirectory}),
        /archive kind is not registered/i,
    );
    await assert.rejects(lstat(outputPath), {code: 'ENOENT'});

    const firstValidationPath = join(sourceDirectory, 'steps', steps[0], 'validation.json');
    const validation = JSON.parse(await readFile(firstValidationPath, 'utf8'));
    validation.files[0].changeType = 'renamed';
    await writeFile(firstValidationPath, JSON.stringify(validation), 'utf8');
    await assert.rejects(
        createReleaseEvidenceArchive({archiveKind: 'post-tag', outputPath, sourceDirectory}),
        /changeType.*steps\/001-verify-post-tag-bootstrap\/validation.json/i,
    );
    await assert.rejects(lstat(outputPath), {code: 'ENOENT'});
});

test('release evidence archive rejects step order and judgment propagation mismatches', async t => {
    const orderFixture = await createFixture(t, 'scenarios/windows/plain');
    const summaryPath = join(orderFixture.sourceDirectory, 'summary.json');
    const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
    summary.steps = [...summary.steps].reverse();
    await writeFile(summaryPath, JSON.stringify(summary), 'utf8');
    await assert.rejects(
        createReleaseEvidenceArchive({
            archiveKind: 'scenarios/windows/plain',
            outputPath: resolve(orderFixture.root, 'order.tar'),
            sourceDirectory: orderFixture.sourceDirectory,
        }),
        /summary steps do not match/i,
    );

    const propagationFixture = await createFixture(t);
    const validationPath = join(propagationFixture.sourceDirectory, 'steps', propagationFixture.steps[0], 'validation.json');
    const validation = JSON.parse(await readFile(validationPath, 'utf8'));
    validation.files[0].matchesExpected = false;
    await writeFile(validationPath, JSON.stringify(validation), 'utf8');
    await assert.rejects(
        createReleaseEvidenceArchive({
            archiveKind: 'post-tag',
            outputPath: resolve(propagationFixture.root, 'propagation.tar'),
            sourceDirectory: propagationFixture.sourceDirectory,
        }),
        /step judgment does not include every file judgment/i,
    );
});

test('release evidence archive accepts a failed command judgment without an unexpected file change', async t => {
    const {root, sourceDirectory, steps} = await createFixture(t);
    const summaryPath = join(sourceDirectory, 'summary.json');
    const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
    summary.matchesExpected = false;
    await writeFile(summaryPath, JSON.stringify(summary), 'utf8');

    const validationPath = join(sourceDirectory, 'steps', steps[0], 'validation.json');
    const validation = JSON.parse(await readFile(validationPath, 'utf8'));
    validation.exitCode = 1;
    validation.matchesExpected = false;
    validation.summary = 'The command failed before producing the expected result.';
    await writeFile(validationPath, JSON.stringify(validation), 'utf8');

    const archivePath = resolve(root, 'failed-command.tar');
    await createReleaseEvidenceArchive({archiveKind: 'post-tag', outputPath: archivePath, sourceDirectory});
    assert.equal((await verifyReleaseEvidenceArchive({archiveKind: 'post-tag', archivePath})).status, 'verified');
});

test('release evidence archive permits each unavailable command stream to remain absent', async t => {
    const fixture = await createFixture(t, 'post-tag');
    await rm(join(fixture.sourceDirectory, 'steps', '001-verify-post-tag-bootstrap', 'stdout.txt'));
    const outputPath = join(fixture.root, 'without-stdout.tar');
    const created = await createReleaseEvidenceArchive({
        archiveKind: 'post-tag',
        outputPath,
        sourceDirectory: fixture.sourceDirectory,
    });
    assert.equal(created.entryCount, 3);
    assert.equal((await verifyReleaseEvidenceArchive({archiveKind: 'post-tag', archivePath: outputPath})).status, 'verified');
});

test('release evidence archive rejects noncanonical headers and extra archive entries', async t => {
    const {root, sourceDirectory} = await createFixture(t);
    const archivePath = resolve(root, 'valid.tar');
    await createReleaseEvidenceArchive({archiveKind: 'post-tag', outputPath: archivePath, sourceDirectory});
    const valid = await readFile(archivePath);

    const headerDrift = Buffer.from(valid);
    headerDrift[136] = '1'.charCodeAt(0);
    const headerPath = resolve(root, 'header-drift.tar');
    await writeFile(headerPath, headerDrift);
    await assert.rejects(
        verifyReleaseEvidenceArchive({archiveKind: 'post-tag', archivePath: headerPath}),
        /header is not canonical.*summary.json/i,
    );

    const extraHeader = Buffer.from(valid.subarray(0, 512));
    extraHeader.fill(0, 0, 100);
    Buffer.from('extra.json').copy(extraHeader, 0);
    extraHeader.fill(0, 124, 136);
    Buffer.from('00000000000\0', 'ascii').copy(extraHeader, 124);
    extraHeader.fill(0x20, 148, 156);
    const checksum = [...extraHeader].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0');
    Buffer.from(`${checksum}\0 `, 'ascii').copy(extraHeader, 148);
    const extraPath = resolve(root, 'extra.tar');
    await writeFile(extraPath, Buffer.concat([valid.subarray(0, -1024), extraHeader, Buffer.alloc(1024)]));
    await assert.rejects(
        verifyReleaseEvidenceArchive({archiveKind: 'post-tag', archivePath: extraPath}),
        /inventory.*extra.json/i,
    );
});

test('release evidence archive never overwrites an existing output', async t => {
    const {root, sourceDirectory} = await createFixture(t);
    const outputPath = resolve(root, 'existing.tar');
    await writeFile(outputPath, 'preserve me', 'utf8');

    await assert.rejects(
        createReleaseEvidenceArchive({archiveKind: 'post-tag', outputPath, sourceDirectory}),
        error => error !== null && typeof error === 'object' && 'code' in error && error.code === 'EEXIST',
    );
    assert.equal(await readFile(outputPath, 'utf8'), 'preserve me');
});

test('release evidence archive removes an incomplete output after write failure and permits retry', async t => {
    const {root, sourceDirectory} = await createFixture(t);
    const outputPath = resolve(root, 'retry.tar');
    const writeFailure = new Error('injected archive write failure');
    const fileSystem = {
        mkdir,
        open: async (/** @type {string} */ path, /** @type {string} */ flags) => {
            const handle = await open(path, flags);
            return {
                close: () => handle.close(),
                writeFile: async (/** @type {Buffer} */ bytes) => {
                    await handle.writeFile(bytes.subarray(0, 1));
                    throw writeFailure;
                },
            };
        },
        rm,
    };

    await assert.rejects(
        createReleaseEvidenceArchive({archiveKind: 'post-tag', outputPath, sourceDirectory}, fileSystem),
        error => error === writeFailure,
    );
    await assert.rejects(lstat(outputPath), {code: 'ENOENT'});
    assert.equal((await createReleaseEvidenceArchive({archiveKind: 'post-tag', outputPath, sourceDirectory})).status, 'created');
});

test('release evidence archive retains the write error when incomplete-output cleanup also fails', async t => {
    const {root, sourceDirectory} = await createFixture(t);
    const outputPath = resolve(root, 'cleanup-failure.tar');
    const writeFailure = new Error('injected archive write failure');
    const cleanupFailure = new Error('injected cleanup failure');
    const fileSystem = {
        mkdir,
        open: async (/** @type {string} */ path, /** @type {string} */ flags) => {
            const handle = await open(path, flags);
            return {
                close: () => handle.close(),
                writeFile: async (/** @type {Buffer} */ bytes) => {
                    await handle.writeFile(bytes.subarray(0, 1));
                    throw writeFailure;
                },
            };
        },
        rm: async () => { throw cleanupFailure; },
    };

    await assert.rejects(
        createReleaseEvidenceArchive({archiveKind: 'post-tag', outputPath, sourceDirectory}, fileSystem),
        error => {
            assert.equal(error, writeFailure);
            assert.equal(error !== null && typeof error === 'object' && 'cleanupError' in error
                ? error.cleanupError : undefined, cleanupFailure);
            return true;
        },
    );
});

test('release evidence archive script requires and reports the registered archive kind', async t => {
    const {root, sourceDirectory} = await createFixture(t);
    const outputPath = resolve(root, 'script.tar');
    const result = await runSuccessfulProcess(process.execPath, [
        resolve('scripts/create-release-evidence-archive.mjs'),
        '--source',
        sourceDirectory,
        '--output',
        outputPath,
        '--archive-kind',
        'post-tag',
    ]);
    const summary = JSON.parse(result.stdout);

    assert.equal(result.stderr, '');
    assert.deepEqual(summary, {
        archiveKind: 'post-tag',
        entryCount: 4,
        outputPath,
        status: 'created',
    });
    assert.equal((await verifyReleaseEvidenceArchive({archiveKind: 'post-tag', archivePath: outputPath})).status, 'verified');
});
