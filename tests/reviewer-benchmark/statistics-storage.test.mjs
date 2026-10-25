import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {upsertStatisticsRole} from '../../lib/reviewer-benchmark/statistics-storage.mjs';
import {runReviewerBenchmarkCli} from '../../lib/reviewer-benchmark/benchmark-runner.mjs';

/** @param {string} model @param {string} reviewerId @param {{backend:string,serviceTier:string}|undefined} conditions @returns {import('../../lib/reviewer-benchmark/statistics.mjs').Statistics} */
const role = (model,reviewerId,conditions) => ({schemaVersion:4,configuration:{model,reasoningEffort:'explicit-effort'},
    roles:[{reviewerId,repetitions:[1,2,3].map(repetition => ({repetition,score:0.25,scoreSource:'formal',diagnosticReason:null,
        mainAgentCorrectedScoringCopy:false,completedInstances:1,expectedInstances:1,deliveryErrors:[]}))}],
    observations:[1,2,3].map(repetition => ({reviewerId,scenarioId:'default',repetition,completed:true,
        delivery:{mode:'reviewer-bound-report',errors:[],mainAgentCorrectedScoringCopy:false},
        runtime:{actualModel:model,actualReasoningEffort:'explicit-effort',durationMs:repetition,
            tokenUsage:{input:11,cachedInput:3,output:7},conditions:conditions ?? {}}}))});

test('role insertion preserves legacy values and rejects score and provider/tier conflicts without writes',async t => {
    const directory = await createTemporaryDirectory(t,'arw-benchmark-storage-');
    const legacy = [role('legacy-model','code-standards-reviewer',undefined)];
    const entry = role('new-explicit-model','code-standards-reviewer',{backend:'provider-a',serviceTier:'default'});
    await writeFile(join(directory,'statistics.json'),JSON.stringify(legacy));
    const first = await upsertStatisticsRole({outputDirectory:directory,roleStatistics:entry});
    assert.equal(first.inserted,true);
    const saved = JSON.parse(await readFile(first.path,'utf8'));
    assert.deepEqual(saved,[...legacy,entry]);
    const bytes = await readFile(first.path);
    assert.equal((await upsertStatisticsRole({outputDirectory:directory,roleStatistics:entry})).inserted,false);
    assert.deepEqual(await readFile(first.path),bytes);
    const changedScore = structuredClone(entry);changedScore.roles[0].repetitions[0].score = 0.75;
    await assert.rejects(upsertStatisticsRole({outputDirectory:directory,roleStatistics:changedScore}),/differ/u);
    for (const conditions of [{backend:'provider-b',serviceTier:'default'},{backend:'provider-a',serviceTier:'fast'}]) {
        const conflict = role('new-explicit-model','code-spec-reviewer',conditions);
        await assert.rejects(upsertStatisticsRole({outputDirectory:directory,roleStatistics:conflict}),/provider or service tier conditions differ/u);
        assert.deepEqual(await readFile(first.path),bytes);
    }
    const unknown = role('legacy-model','code-spec-reviewer',{backend:'provider-a',serviceTier:'default'});
    await assert.rejects(upsertStatisticsRole({outputDirectory:directory,roleStatistics:unknown}),/conditions differ/u);
    assert.deepEqual(await readFile(first.path),bytes);
});

test('distinct model and effort values with slashes remain separate in stored statistics',async t => {
    const directory = await createTemporaryDirectory(t,'arw-benchmark-separated-configurations-');
    const conditions = {backend:'provider-a',serviceTier:'default'};
    const entries = [role('vendor/a','code-standards-reviewer',conditions),role('vendor','code-spec-reviewer',conditions)];
    for (const [index,entry] of entries.entries()) {
        entry.configuration.reasoningEffort = index === 0 ? 'b' : 'a/b';
        for (const observation of entry.observations) {
            observation.runtime.actualReasoningEffort = entry.configuration.reasoningEffort;
        }
        await upsertStatisticsRole({outputDirectory:directory,roleStatistics:entry});
    }
    const saved = JSON.parse(await readFile(join(directory,'statistics.json'),'utf8'));
    assert.deepEqual(saved,entries);
});

test('CLI publication preserves the original statistics when a later role is invalid',async t => {
    const repositoryRoot = await createTemporaryDirectory(t,'arw-benchmark-publish-');
    const effortDirectory = join(repositoryRoot,'.scratch','0001-benchmark');
    const outputDirectory = join(effortDirectory,'results');
    await mkdir(outputDirectory,{recursive:true});
    const conditions = {backend:'provider-a',serviceTier:'default'};
    const path = join(outputDirectory,'statistics.json');
    const original = Buffer.from(`${JSON.stringify([role('existing-model','code-standards-reviewer',conditions)])}\n`);
    await writeFile(path,original);
    const entries = [role('new-model','code-standards-reviewer',conditions),role('new-model','code-spec-reviewer',conditions)];
    entries[1].roles[0].repetitions = [];
    const statisticsPath = join(repositoryRoot,'roles.json');
    const inputPath = join(repositoryRoot,'publish.json');
    await writeFile(statisticsPath,JSON.stringify(entries));
    await writeFile(inputPath,JSON.stringify({repositoryRoot,effortDirectory,outputDirectory,statisticsPath}));
    await assert.rejects(runReviewerBenchmarkCli(['publish',inputPath]),/three scored repetitions/u);
    assert.deepEqual(await readFile(path),original);
});
