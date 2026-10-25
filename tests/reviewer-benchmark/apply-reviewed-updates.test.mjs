import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

import {applyReviewedUpdates} from '../../lib/reviewer-benchmark/apply-reviewed-updates.mjs';

const configuration = {model: 'gpt-6-luna', reasoningEffort: 'low'};
const entry = (/** @type {string} */ reviewerId, /** @type {number} */ score) => ({schemaVersion: 4, configuration,
    observations: [1, 2, 3].flatMap(repetition => (reviewerId === 'spec-readiness-reviewer' ? ['artifact-promotion', 'runtime-migration'] : [undefined]).map(scenarioId => ({reviewerId, repetition, ...(scenarioId ? {scenarioId} : {})}))),
    roles: [{reviewerId, repetitions: [1, 2, 3].map(repetition => ({repetition,
        score, scoreSource: 'formal', diagnosticReason: null,
        mainAgentCorrectedScoringCopy: false, completedInstances: 1,
        expectedInstances: 1, deliveryErrors: []}))}]});

test('backed-up update replaces an existing role and inserts a new role without losing observations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'reviewed-statistics-test-'));
    try {
        const currentPath = join(directory, 'statistics.json');
        const updatesPath = join(directory, 'updates.json');
        const backupPath = join(directory, 'backup.json');
        const current = [entry('code-standards-reviewer', 0.2)];
        await writeFile(currentPath, `${JSON.stringify(current, null, 2)}\n`);
        await writeFile(updatesPath, `${JSON.stringify([
            entry('code-standards-reviewer', 0.4), entry('spec-readiness-reviewer', 0.7),
        ])}\n`);
        const result = await applyReviewedUpdates({currentPath, updatesPath, backupPath});
        assert.equal(result.replaced.length, 1);
        assert.equal(result.inserted.length, 1);
        assert.deepEqual(JSON.parse(await readFile(backupPath, 'utf8')), current);
        const updated = /** @type {import('../../lib/reviewer-benchmark/recheck-statistics.mjs').ReviewedStatistics[]} */ (JSON.parse(await readFile(currentPath, 'utf8')));
        assert.deepEqual(updated[0].roles.map(role => role.repetitions.map(item => item.score)),
            [[0.4, 0.4, 0.4], [0.7, 0.7, 0.7]]);
        assert.deepEqual(updated[0].observations, [
            ...current[0].observations, ...entry('spec-readiness-reviewer', 0.7).observations,
        ]);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});
