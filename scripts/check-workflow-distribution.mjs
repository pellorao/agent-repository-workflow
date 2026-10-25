#!/usr/bin/env node

import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {
    createClaudeCodePlatformAdapter,
    createCodexPlatformAdapter,
} from '../lib/arw-common/platform-adapter.mjs';
import {composePlatformResults} from '../lib/repository-workflow/workflow.mjs';
import {buildWorkflowDistribution} from '../lib/workflow-distribution/workflow-distribution.mjs';

const SOURCE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/** @typedef {'claude-code' | 'codex'} CliPlatform */
/** @typedef {{code: string, message: string, path?: string, platform?: string}} WorkflowDiagnostic */
/** @typedef {{payload: unknown, platform: string, profile: unknown, projectionConfig: unknown, seedTargets: unknown}} WorkflowEvaluationInput */
/** @typedef {{evaluate: (input: WorkflowEvaluationInput) => {diagnostics?: WorkflowDiagnostic[], status: string}}} WorkflowPlatformAdapter */
/** @typedef {{adapters?: Record<CliPlatform, WorkflowPlatformAdapter>, distributionDirectory?: string}} CheckWorkflowDistributionOptions */

/** @param {string} left @param {string} right */
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/** @param {WorkflowDiagnostic} entry @param {string} [platform] */
const normalizeDiagnostic = (entry, platform) => ({
    code: entry.code,
    message: entry.message,
    path: entry.path ?? 'distribution',
    ...(platform === undefined ? {} : {platform}),
});

/** @param {CheckWorkflowDistributionOptions} [options] */
export const checkWorkflowDistributionProduction = async ({
    adapters = {
        'claude-code': createClaudeCodePlatformAdapter(),
        codex: createCodexPlatformAdapter(),
    },
    distributionDirectory = join(SOURCE_ROOT, 'distribution'),
} = {}) => {
    const distribution = await buildWorkflowDistribution({distributionDirectory});
    if (distribution.status !== 'succeeded') {
        return {
            diagnostics: distribution.diagnostics.map(
                /** @param {WorkflowDiagnostic} entry */
                entry => normalizeDiagnostic(entry),
            ),
            status: 'failed',
        };
    }

    /** @type {CliPlatform[]} */
    const platforms = ['claude-code', 'codex'];
    const profile = {
        codeMaps: {excludes: [], includes: [], roots: []},
        domainLayout: 'single-context',
        platforms,
    };
    /** @type {Array<{diagnostics: WorkflowDiagnostic[], platform: CliPlatform, status: string}>} */
    const results = [];
    for (const platform of platforms) {
        const result = adapters[platform].evaluate({
            payload: distribution.payload,
            platform,
            profile,
            projectionConfig: distribution.projectionConfig,
            seedTargets: {},
        });
        results.push({
            ...result,
            diagnostics: (result.diagnostics ?? []).map(entry => ({...entry, platform: entry.platform ?? platform})),
            platform,
        });
    }
    const composition = composePlatformResults(results);
    const diagnostics = composition.diagnostics.map(
        /** @param {WorkflowDiagnostic} entry */
        entry => normalizeDiagnostic(entry, entry.platform),
    );
    diagnostics.sort((left, right) => compareText(left.platform ?? '', right.platform ?? '')
        || compareText(left.path, right.path)
        || compareText(left.code, right.code)
        || compareText(left.message, right.message));
    return diagnostics.length === 0 ? {diagnostics: [], status: 'passed'} : {diagnostics, status: 'failed'};
};

const isMain = process.argv[1] !== undefined
    && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
    if (process.argv.length !== 2) {
        process.stderr.write('Usage: node scripts/check-workflow-distribution.mjs\n');
        process.exitCode = 2;
    } else {
        try {
            const result = await checkWorkflowDistributionProduction();
            if (result.status === 'passed') {
                process.stdout.write('Workflow Distribution production check passed.\n');
            } else {
                for (const diagnostic of result.diagnostics) {
                    process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
                }
                process.exitCode = 1;
            }
        } catch (error) {
            process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = 1;
        }
    }
}
