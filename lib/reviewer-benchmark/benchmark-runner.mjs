import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isAbsolute,join,relative,resolve} from 'node:path';
import {createBackgroundAgentMachineClient} from '../arw-background-agent-host.mjs';
import {createCurrentPlatformAdapter} from '../arw-common/platform-adapter.mjs';
import {parseJsonText,serializeJson} from '../common/json.mjs';
import {createScopedFilesystem} from '../common/filesystem.mjs';
import {verifyReviewerCapabilityConformance} from '../release/reviewer-capability-conformance.mjs';
import {validateBenchmarkConfiguration,validatePreparedBenchmarkBatch} from './benchmark-contract.mjs';
import {aggregateConfiguration} from './statistics.mjs';
import {renderTablesHtml} from './statistics-presentation.mjs';
import {upsertStatisticsRoles,writeBenchmarkFile} from './statistics-storage.mjs';
import {combineAvailableIndependentScores,combineIndependentScores,finalizeIndependentScores} from './recheck-statistics.mjs';
import {resolveAdjudications} from './resolve-adjudications.mjs';
import {applyReviewedUpdates} from './apply-reviewed-updates.mjs';

/** @typedef {import('./benchmark-contract.mjs').BenchmarkConfiguration} BenchmarkConfiguration */
/** @typedef {import('./benchmark-contract.mjs').PreparedBenchmark} PreparedBenchmark */
/** @typedef {ReturnType<typeof import('../reviewer-runtime/reviewer-measurement.mjs').reviewerMeasurementResult>} Measurement */
/** @typedef {{status:string,reportPath?:string,reason?:string}} Completion */
/** @typedef {{instanceId:string,runId?:string,spawnPending?:boolean,reportPath:string,completion?:Completion,measurement?:Measurement|null,error?:string,cursor?:number}} CollectedInstance */
/** @typedef {{issueId:string,repositoryRoot:string,effortDirectory:string,outputDirectory:string,configuration:BenchmarkConfiguration,prepared:PreparedBenchmark}} RunInput */
/** @typedef {{binding:string,instances:CollectedInstance[]}} Collection */
/** @typedef {import('../background-agent/machine-client.mjs').MachineClient} MachineClient */
const jsonBytes = (/** @type {unknown} */ value) => {
    const result = serializeJson(value);
    if (result.status !== 'succeeded') throw new Error(result.diagnostics.map(item => item.message).join(' '));
    return result.bytes;
};
/** @param {string} path @returns {Promise<any>} */
const readJson = async path => {
    const result = parseJsonText(await readFile(path));
    if (result.status !== 'succeeded') throw new Error(result.diagnostics.map(item => item.message).join(' '));
    return result.value;
};

/** @param {{repositoryRoot:string,effortDirectory:string,outputDirectory:string,issueId?:string}} input @param {{temporary?:boolean}} [options] */
export const validateBenchmarkOutput = async (input,{temporary = false} = {}) => {
    for (const path of [input.repositoryRoot,input.effortDirectory,input.outputDirectory]) {
        if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Benchmark repository, effort, and output paths must be explicit absolute paths.');
    }
    const effort = relative(resolve(input.repositoryRoot),resolve(input.effortDirectory)).replaceAll('\\','/');
    const match = /^\.scratch\/(\d{4})-[^/]+$/u.exec(effort);
    const output = relative(resolve(temporary ? join(input.repositoryRoot,'.tmp') : input.effortDirectory),resolve(input.outputDirectory));
    if (!match || output === '..' || output.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(output)) {
        throw new Error(temporary ? 'Benchmark process state must remain in the repository temporary workspace.'
            : 'New benchmark output must belong to its explicitly selected effort.');
    }
    if (input.issueId !== undefined && !new RegExp(`^issue:${match[1]}:\\d{2}$`,'u').test(input.issueId)) throw new Error('Benchmark issue identity belongs to another effort.');
    const opened = await createScopedFilesystem({root:resolve(input.repositoryRoot)});
    if (opened.status !== 'succeeded') throw new Error(opened.diagnostics.map(item => item.message).join(' '));
    const inspected = await opened.scopedFilesystem.inspect({path:relative(resolve(input.repositoryRoot),resolve(input.outputDirectory))});
    if (inspected.status !== 'succeeded') throw new Error(inspected.diagnostics.map(item => item.message).join(' '));
};

/** @param {RunInput} input */
const boundCollection = async input => {
    await validateBenchmarkOutput(input,{temporary:true});
    validateBenchmarkConfiguration(input.configuration);
    if (typeof input.issueId !== 'string') throw new Error('Benchmark execution requires its actual issue identity.');
    const batch = await validatePreparedBenchmarkBatch(input.prepared);
    const preparedBytes = await readFile(input.prepared.preparedPath);
    const binding = createHash('sha256').update(preparedBytes).update(JSON.stringify({issueId:input.issueId,
        repositoryRoot:input.repositoryRoot,effortDirectory:input.effortDirectory,outputDirectory:input.outputDirectory,
        configuration:input.configuration,prepared:input.prepared})).digest('hex');
    const collectionPath = join(input.outputDirectory,'collection.json');
    /** @type {Collection} */
    let collection;
    try {collection = await readJson(collectionPath);}
    catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        collection = {binding,instances:input.prepared.handoffs.map(handoff => ({instanceId:handoff.instanceId,
            reportPath:/** @type {string} */ (handoff.input.reportPath)}))};
    }
    if (collection.binding !== binding || collection.instances.length !== input.prepared.handoffs.length
        || collection.instances.some((item,index) => item.instanceId !== input.prepared.handoffs[index].instanceId
            || item.reportPath !== input.prepared.handoffs[index].input.reportPath)) throw new Error('Collection checkpoint differs from the prepared inputs or selected settings.');
    return {batch,collection,collectionPath};
};

/** @param {RunInput} input @param {{client?:MachineClient,onProgress?:(value:unknown)=>void}} [options] */
export const collectBenchmark = async (input,{client:providedClient,onProgress = () => {}} = {}) => {
    const {collection,collectionPath} = await boundCollection(input);
    const client = providedClient ?? createBackgroundAgentMachineClient({programDirectory:input.repositoryRoot,hostRepositoryRoot:input.repositoryRoot});
    try {
        for (const [index,handoff] of input.prepared.handoffs.entries()) {
            const observed = collection.instances[index];
            if (observed.completion !== undefined) continue;
            if (observed.runId === undefined && (observed.spawnPending || observed.error !== undefined)) {
                throw new Error(observed.error ?? 'Prior spawn acceptance is uncertain. Resolve its original run identity before continuing.');
            }
            if (observed.runId === undefined) {
                observed.spawnPending = true;
                await writeBenchmarkFile(input.outputDirectory,'collection.json',jsonBytes(collection));
                const result = await client.request('spawn_agent',{...handoff.input,settings:input.configuration});
                if (typeof result.runId !== 'string') throw new Error('Background Agent did not return an accepted run identity.');
                observed.runId = result.runId;
                delete observed.spawnPending;
                await writeBenchmarkFile(input.outputDirectory,'collection.json',jsonBytes(collection));
            }
            let result = await client.request('list_agents',{runId:observed.runId});
            while (!result.completion) {
                if (['failed','exited','interrupted'].includes(result.taskState) || result.error) {
                    observed.error = result.error?.message ?? `Reviewer task ended without a completion: ${result.taskState}.`;
                    await writeBenchmarkFile(input.outputDirectory,'collection.json',jsonBytes(collection));
                    return {status:'incomplete',collectionPath,instanceId:observed.instanceId,reason:observed.error};
                }
                onProgress({instanceId:observed.instanceId,runId:observed.runId,state:result.state,notifications:result.notifications});
                result = await client.request('wait_agent',{runId:observed.runId,cursor:result.cursor ?? observed.cursor ?? 0,timeout_ms:30000});
                observed.cursor = result.cursor ?? observed.cursor;
            }
            const completion = /** @type {Completion} */ (result.completion);
            if (completion.reportPath !== observed.reportPath) throw new Error('Reviewer completion belongs to another report binding.');
            observed.completion = completion;
            observed.measurement = result.measurement ?? null;
            delete observed.error;
            await writeBenchmarkFile(input.outputDirectory,'collection.json',jsonBytes(collection));
            onProgress({instanceId:observed.instanceId,completion});
        }
        return {status:'collected',collectionPath};
    } finally {if (providedClient === undefined) await client.close();}
};

/** @param {RunInput & {modelFailures?:Record<string,{reason:string}>,adjudication?:unknown,requirementBindings?:unknown}} input */
export const scoreBenchmark = async input => {
    const {batch,collection,collectionPath} = await boundCollection(input);
    // Decision input changes do not change the collected run binding.
    if (collection.instances.some(item => item.completion === undefined)) return {status:'incomplete',collectionPath,reason:'Some Reviewer tasks have not completed.'};
    const instances = collection.instances.map(item => ({instanceId:item.instanceId,
        artifactPaths:input.modelFailures?.[item.instanceId] === undefined ? [item.reportPath] : null,
        ...(input.modelFailures?.[item.instanceId] === undefined ? {} : {modelFailure:input.modelFailures[item.instanceId]}),
        ...(item.measurement === null || item.measurement === undefined ? {} : {measurement:item.measurement})}));
    const verification = await verifyReviewerCapabilityConformance({agentIdentity:createCurrentPlatformAdapter().getCurrentAgentIdentity(),
        input:{artifacts:[{reviewerId:batch.reviewerId,instances}]},preparedPath:input.prepared.preparedPath,
        repositoryRoot:input.repositoryRoot,issueId:input.issueId,adjudication:input.adjudication,requirementBindings:input.requirementBindings});
    await writeBenchmarkFile(input.outputDirectory,'scoring.json',jsonBytes(verification));
    if (!['verified','failed'].includes(verification.status)) return verification;
    const observations = input.prepared.handoffs.map((handoff,index) => {
        const collected = collection.instances[index];
        const measurement = collected.measurement;
        const usage = measurement?.usage;
        const known = usage?.inputTokens != null && usage.cachedInputTokens != null && usage.outputTokens != null
            && usage.inputTokens >= usage.cachedInputTokens;
        return {reviewerId:handoff.reviewerId,scenarioId:handoff.scenarioId ?? 'default',repetition:batch.repetitionOf(index),sampleKind:'formal',
            completed:collected.completion?.status === 'ready',runtime:{actualModel:input.configuration.model,
                actualReasoningEffort:input.configuration.reasoningEffort,durationMs:measurement?.finishedAt===null?null:measurement?.wallClockMs??null,
                tokenUsage:known ? {input:/** @type {number} */ (usage?.inputTokens) - /** @type {number} */ (usage?.cachedInputTokens),
                    cachedInput:/** @type {number} */ (usage?.cachedInputTokens),output:/** @type {number} */ (usage?.outputTokens)} : null,
                ...(known ? {} : {tokenUsageError:'Root-thread native input, cached input, or output observation is unavailable.'}),
                conditions:{backend:input.configuration.modelProvider,serviceTier:input.configuration.serviceTier},
                ...(measurement?.workDuration === undefined ? {} : {workDuration:measurement.workDuration}),
                ...(measurement?.modelPhases === undefined ? {} : {modelPhases:measurement.modelPhases})},
            delivery:{mode:'reviewer-bound-report',errors:[],mainAgentCorrectedScoringCopy:false},
            ...(collected.completion?.status === 'ready' ? {} : {error:{code:'reviewer-incomplete',message:collected.completion?.reason ?? 'Reviewer task is incomplete.'}})};
    });
    const statistics = aggregateConfiguration({configuration:input.configuration,observations,
        verification:{[batch.reviewerId]:verification},allowPartial:true});
    await writeBenchmarkFile(input.outputDirectory,'role-statistics.json',jsonBytes([statistics]));
    return {status:'scored',collectionPath,scoringPath:join(input.outputDirectory,'scoring.json'),
        statisticsPath:join(input.outputDirectory,'role-statistics.json')};
};

/** @param {string[]} args @param {(value:string)=>unknown} [stdout] */
export const runReviewerBenchmarkCli = async (args,stdout = value => process.stdout.write(value)) => {
    if (args.length !== 2) throw new Error('Usage: node scripts/reviewer-benchmark.mjs <collect|score|compare|finalize|resolve|publish|render> <input.json>');
    const [operation,inputPath] = args;
    const input = await readJson(inputPath);
    await validateBenchmarkOutput(input,{temporary:!['publish','render'].includes(operation)});
    let result;
    if (operation === 'collect') result = await collectBenchmark(input,{onProgress:value => stdout(`${JSON.stringify({progress:value})}\n`)});
    else if (operation === 'score') result = await scoreBenchmark(input);
    else if (operation === 'compare') {
        const [first,second] = await Promise.all([input.firstPath,input.secondPath].map(readJson));
        result = input.commonOnly ? combineAvailableIndependentScores(first,second) : combineIndependentScores(first,second);
        await writeBenchmarkFile(input.outputDirectory,'comparison.json',jsonBytes(result));
    } else if (operation === 'finalize') {
        const [first,second,adjudicated] = await Promise.all([input.firstPath,input.secondPath,input.adjudicatedPath].map(readJson));
        result = finalizeIndependentScores(first,second,adjudicated);
        await writeBenchmarkFile(input.outputDirectory,'reviewed-statistics.json',jsonBytes(result));
    } else if (operation === 'resolve') {
        const [request,first,second,resolutions] = await Promise.all([input.requestPath,input.firstPath,input.secondPath,input.resolutionsPath].map(readJson));
        result = resolveAdjudications(request,[first,second],resolutions);
        await writeBenchmarkFile(input.outputDirectory,'adjudication.json',jsonBytes({decisions:result.decisions}));
    } else if (operation === 'publish') {
        if (input.updatesPath) {
            result = await applyReviewedUpdates({currentPath:join(input.outputDirectory,'statistics.json'),updatesPath:input.updatesPath,
                backupPath:join(input.outputDirectory,`statistics-backup-${randomUUID()}.json`)});
        } else {
            const entries = await readJson(input.statisticsPath);
            result = await upsertStatisticsRoles({outputDirectory:input.outputDirectory,roleStatistics:entries});
        }
    } else if (operation === 'render') {
        const configurations = await readJson(input.statisticsPath);
        await writeBenchmarkFile(input.outputDirectory,'tables.html',Buffer.from(renderTablesHtml(configurations)));
        result = {path:join(input.outputDirectory,'tables.html')};
    } else throw new Error(`Unknown benchmark operation: ${operation}.`);
    stdout(`${JSON.stringify(result)}\n`);
    return result;
};
