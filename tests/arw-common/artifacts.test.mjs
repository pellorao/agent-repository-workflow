import assert from 'node:assert/strict';
import {mkdir, rm, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {createRepository as createGitRepository} from '../helpers/repository-fixture.mjs';
import {
    formatArtifactIdentityKey,
    formatCanonicalArtifactId,
    listArtifacts,
    parseCanonicalArtifactId,
    parseRegisteredArtifactPath,
    readArtifactInventory,
    resolveArtifactTarget,
} from '../../lib/arw-common/artifacts.mjs';
import {createScopedFilesystem} from '../../lib/common/filesystem.mjs';

const createRepository = async (/** @type {test.TestContext} */ t) => {
    const root = await createGitRepository(t, {prefix: 'arw-artifacts-'});
    const scratchDirectory = join(root, '.scratch');
    await mkdir(scratchDirectory);
    return {root, scratchDirectory};
};

/** @param {{root: string}} repository @param {string} relativePath @param {string} text */
const writeArtifact = async (repository, relativePath, text) => {
    const path = join(repository.root, relativePath);
    await mkdir(join(path, '..'), {recursive: true});
    await writeFile(path, text, 'utf8');
};

const createInventoryFilesystem = async (/** @type {{root: string}} */ repository) => {
    const created = await createScopedFilesystem({root: repository.root});
    if (created.status !== 'succeeded') assert.fail('Artifact test filesystem must open.');
    return created.scopedFilesystem;
};

test('canonical artifact IDs have one numeric parse and format contract', () => {
    const valid = [
        ['issue:0007:02', {effortNumber: '0007', issueNumber: '02', kind: 'issue', qualifier: null}],
        ['map:0007', {effortNumber: '0007', issueNumber: null, kind: 'map', qualifier: null}],
        ['spec:9999', {effortNumber: '9999', issueNumber: null, kind: 'spec', qualifier: null}],
        ['issue:billing:0013:07', {effortNumber: '0013', issueNumber: '07', kind: 'issue', qualifier: 'billing'}],
    ];
    for (const [text, expected] of valid) {
        const parsed = parseCanonicalArtifactId(text);
        assert.deepEqual(parsed, expected);
        assert.equal(formatCanonicalArtifactId(parsed), text);
    }

    const invalid = [
        'issue:0000:01',
        'issue:0001:00',
        'issue:0001:100',
        'issue:0001-demo:01',
        'issue:billing:0001-demo:01',
        'map:billing:0001',
        'spec:billing:0001',
        'feature:0001',
        'issue:0001',
    ];
    for (const text of invalid) {
        assert.throws(() => parseCanonicalArtifactId(text), /Canonical ID/);
    }
});

test('registered paths project numeric workflow identities without copying slugs', () => {
    assert.deepEqual(parseRegisteredArtifactPath('.scratch/0067-demo/issues/01-readable-name.md'), {
        canonicalId: 'issue:0067:01',
        effortDirectory: '0067-demo',
        effortNumber: '0067',
        issueFilename: '01-readable-name.md',
        issueNumber: '01',
        kind: 'issue',
        relativePath: '.scratch/0067-demo/issues/01-readable-name.md',
    });
    assert.equal(formatArtifactIdentityKey('issue:0067:01'), '0067_01');
    assert.equal(formatArtifactIdentityKey('map:0067'), '0067');
    assert.throws(
        () => parseRegisteredArtifactPath('.scratch/demo/issues/01-readable-name.md'),
        /registered ARW Artifact path/,
    );
});

test('artifact inventory drives list rendering, issue filters, and target lookup', async t => {
    const repository = await createRepository(t);
    await writeArtifact(repository, '.scratch/0001-demo/issues/01-done.md', '# Done\n\nStatus: completed\n\n## Blocked by\n\n- None\n');
    await writeArtifact(repository, '.scratch/0001-demo/issues/02-next.md', '# Next\n\nType: task\n\nBlocked by: None\n');
    await writeArtifact(repository, '.scratch/0001-demo/map.md', '# Demo map\n');
    await writeArtifact(repository, '.scratch/0001-demo/spec.md', '# Demo spec\n');

    const inventory = await readArtifactInventory(repository);
    const issues = listArtifacts(inventory, 'issue', {allStatuses: false, status: null, type: null});
    const allIssues = listArtifacts(inventory, 'issue', {allStatuses: true, status: null, type: null});
    const maps = listArtifacts(inventory, 'map');
    const specs = listArtifacts(inventory, 'spec');
    const target = resolveArtifactTarget(inventory, 'issue:0001:02');

    assert.match(issues.output, /issue:0001:02/);
    assert.doesNotMatch(issues.output, /issue:0001:01/);
    assert.match(allIssues.output, /issue:0001:01/);
    assert.equal(maps.output, ['Map       Title', '--------  --------', 'map:0001  Demo map'].join('\n'));
    assert.equal(specs.output, ['Spec       Title', '---------  ---------', 'spec:0001  Demo spec'].join('\n'));
    assert.deepEqual(target, {
        diagnostics: [],
        legacyDetected: false,
        notFoundMessage: 'Issue not found: issue:0001:02',
        target: {
            path: join(repository.root, '.scratch', '0001-demo', 'issues', '02-next.md'),
            relativePath: '.scratch/0001-demo/issues/02-next.md',
        },
    });
});

test('projection kinds share path safety, heading, diagnostics, and lookup rules', async t => {
    const repository = await createRepository(t);
    await writeArtifact(repository, '.scratch/Demo/map.md', '# Conflicting ID\n');
    await mkdir(join(repository.root, '.scratch', '0002-directory-map', 'map.md'), {recursive: true});
    await writeArtifact(repository, '.scratch/0003-fenced/map.md', '```md\n# Fake\n```\n# Real map\n');
    await writeArtifact(repository, '.scratch/0004-unreadable/spec.md', '# Hidden\n');
    const baseFilesystem = await createInventoryFilesystem(repository);
    const fileSystem = {
        ...baseFilesystem,
        readText: async (/** @type {{allowLossyDecoding: boolean, path: string}} */ input) => input.path.endsWith('unreadable/spec.md')
            ? {diagnostics: [{code: 'test-read-failed', message: 'simulated read failure'}], stage: 'read', status: /** @type {'failed'} */ ('failed')}
            : baseFilesystem.readText(input),
    };

    const inventory = await readArtifactInventory(repository, fileSystem);
    const maps = listArtifacts(inventory, 'map');
    const specs = listArtifacts(inventory, 'spec');
    const malformed = resolveArtifactTarget(inventory, 'map:0002');
    const missing = resolveArtifactTarget(inventory, 'spec:9999');

    assert.match(maps.output, /map:0003  Real map/);
    assert.deepEqual(maps.diagnostics, [
        {message: 'Registered artifact path must be a regular file.', path: '.scratch/0002-directory-map/map.md'},
        {message: 'Artifact directory name is not a valid canonical ID.', path: '.scratch/Demo/map.md'},
    ]);
    assert.deepEqual(specs.diagnostics, [
        {message: 'Artifact file could not be read.', path: '.scratch/0004-unreadable/spec.md'},
    ]);
    assert.equal(malformed.target, null);
    assert.deepEqual(malformed.diagnostics, [maps.diagnostics[0]]);
    assert.equal(missing.target, null);
    assert.deepEqual(missing.diagnostics, []);
    assert.equal(missing.notFoundMessage, 'Spec not found: spec:9999');
});

test('issue list filter matrix stays inside the artifact seam', async t => {
    const repository = await createRepository(t);
    await writeArtifact(repository, '.scratch/0005-work/issues/01-done.md', '# Done\n\nStatus: completed\n\n## Blocked by\n\n- None\n');
    await writeArtifact(repository, '.scratch/0005-work/issues/02-blocked.md', '# Blocked\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- 03\n');
    await writeArtifact(repository, '.scratch/0005-work/issues/03-open.md', '# Open\n\nType: task\n\nBlocked by: None\n');
    await writeArtifact(repository, '.scratch/0005-work/issues/04-claimed.md', '# Claimed\n\nType: research\nStatus: claimed\nBlocked by: None\n');
    await writeArtifact(repository, '.scratch/0005-work/issues/05-source.md', '# Source\n\nStatus: ready-for-agent\nModule implementation issue: `issue:billing:0013:07`\n\n## Blocked by\n\n- None\n');
    const inventory = await readArtifactInventory(repository);
    /** @type {Array<[{allStatuses: boolean, status: string[] | null, type: string[] | null}, string[]]>} */
    const cases = [
        [{allStatuses: false, status: null, type: null}, ['issue:0005:03']],
        [{allStatuses: false, status: ['completed'], type: null}, ['issue:0005:01']],
        [{allStatuses: true, status: null, type: ['implementation']}, ['issue:0005:01', 'issue:0005:02']],
        [{allStatuses: true, status: null, type: ['wayfinder']}, ['issue:0005:03', 'issue:0005:04']],
        [{allStatuses: false, status: ['claimed'], type: ['wayfinder']}, ['issue:0005:04']],
        [{allStatuses: true, status: null, type: ['application-source']}, ['issue:0005:05']],
    ];

    for (const [options, expectedIds] of cases) {
        const output = listArtifacts(inventory, 'issue', options).output;
        const actualIds = [...output.matchAll(/issue:\d{4}:\d{2}/g)].map(match => match[0]);
        assert.deepEqual(actualIds, expectedIds);
    }
});

test('symbolic artifact directories are invalid for every registered kind', async t => {
    const repository = await createRepository(t);
    const target = join(repository.root, 'outside');
    await mkdir(join(target, 'issues'), {recursive: true});
    await writeFile(join(target, 'issues', '01-ready.md'), '# Ready\n\nStatus: ready-for-agent\n', 'utf8');
    await writeFile(join(target, 'map.md'), '# Map\n', 'utf8');
    await writeFile(join(target, 'spec.md'), '# Spec\n', 'utf8');

    try {
        await symlink(target, join(repository.scratchDirectory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        if (error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && ['EPERM', 'EACCES'].includes(error.code)) {
            t.skip('The current environment does not allow directory symbolic links.');
            return;
        }
        throw error;
    }

    const inventory = await readArtifactInventory(repository);
    /** @type {Array<'issue' | 'map' | 'spec'>} */
    const kinds = ['issue', 'map', 'spec'];
    for (const kind of kinds) {
        assert.deepEqual(inventory.diagnostics[kind], [
            {message: 'Symbolic links are not allowed in registered paths.', path: '.scratch/linked'},
        ]);
        assert.equal(inventory.records[kind].length, 0);
    }
});

test('missing scratch directory is the normal empty artifact state', async t => {
    const repository = await createRepository(t);
    await rm(repository.scratchDirectory, {force: true, recursive: true});

    const inventory = await readArtifactInventory(repository);

    assert.equal(listArtifacts(inventory, 'issue').output, 'No matching issues.');
    assert.equal(listArtifacts(inventory, 'map').output, 'No matching maps.');
    assert.equal(listArtifacts(inventory, 'spec').output, 'No matching specs.');
    assert.deepEqual(inventory.paths, []);
});

test('unreadable registered blocker is classified as malformed instead of unknown', async t => {
    const repository = await createRepository(t);
    await writeArtifact(repository, '.scratch/0006-unreadable/issues/01-target.md', '# Target\n\nStatus: completed\n\n## Blocked by\n\n- None\n');
    await writeArtifact(repository, '.scratch/0006-unreadable/issues/02-dependent.md', '# Dependent\n\nStatus: ready-for-agent\n\n## Blocked by\n\n- 01\n');
    const baseFilesystem = await createInventoryFilesystem(repository);
    const fileSystem = {
        ...baseFilesystem,
        readText: async (/** @type {{allowLossyDecoding: boolean, path: string}} */ input) => input.path.endsWith('01-target.md')
            ? {diagnostics: [{code: 'test-read-failed', message: 'simulated read failure'}], stage: 'read', status: /** @type {'failed'} */ ('failed')}
            : baseFilesystem.readText(input),
    };

    const inventory = await readArtifactInventory(repository, fileSystem);

    assert.deepEqual(inventory.records.issue, []);
    assert.deepEqual(inventory.diagnostics.issue, [
        {message: 'Issue file could not be read.', path: '.scratch/0006-unreadable/issues/01-target.md'},
        {message: 'Blocked by references malformed issue 01.', path: '.scratch/0006-unreadable/issues/02-dependent.md'},
    ]);
});

test('unreadable issue directory does not abort map or spec projections', async t => {
    const repository = await createRepository(t);
    await writeArtifact(repository, '.scratch/0007-demo/issues/01-ready.md', '# Ready\n\nStatus: ready-for-agent\n');
    await writeArtifact(repository, '.scratch/0007-demo/map.md', '# Demo map\n');
    await writeArtifact(repository, '.scratch/0007-demo/spec.md', '# Demo spec\n');
    await writeArtifact(repository, '.scratch/0008-zeta/issues/01-ready.md', '# Later\n\nStatus: ready-for-agent\n');
    const baseFilesystem = await createInventoryFilesystem(repository);
    const fileSystem = {
        ...baseFilesystem,
        list: async (/** @type {{path: string}} */ input) => input.path.endsWith('/issues')
            ? {diagnostics: [{code: 'test-list-failed', message: 'simulated directory failure'}], stage: 'enumerate', status: /** @type {'failed'} */ ('failed')}
            : baseFilesystem.list(input),
    };

    const inventory = await readArtifactInventory(repository, fileSystem);

    assert.match(listArtifacts(inventory, 'map').output, /map:0007  Demo map/);
    assert.match(listArtifacts(inventory, 'spec').output, /spec:0007  Demo spec/);
    assert.throws(
        () => listArtifacts(inventory, 'issue'),
        /The issues directory could not be read: \.scratch\/0007-demo\/issues\./,
    );
    assert.deepEqual(inventory.diagnostics.map, []);
    assert.deepEqual(inventory.diagnostics.spec, []);
});

test('duplicate effort numbers are reported once as duplicates, not as invalid names', async t => {
    const repository = await createRepository(t);
    await writeArtifact(repository, '.scratch/0001-a/spec.md', '# A\n');
    await writeArtifact(repository, '.scratch/0001-b/issues/01-x.md', '# X\n\nStatus: completed\n');
    const inventory = await readArtifactInventory(repository, await createInventoryFilesystem(repository));
    const messages = ['spec', 'issue'].flatMap(kind => listArtifacts(inventory, /** @type {'spec' | 'issue'} */ (kind)).diagnostics.map(entry => entry.message));
    assert.ok(messages.includes('Duplicate effort number 0001.'));
    assert.ok(messages.every(message => message !== 'Effort directory is not numbered.' && !message.includes('not a valid canonical ID')));
});
