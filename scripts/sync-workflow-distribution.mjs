#!/usr/bin/env node

import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

import {syncWorkflowDistribution} from '../lib/workflow-distribution/workflow-distribution-sync.mjs';

const SOURCE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI_USAGE = 'Usage:\n  node scripts/sync-workflow-distribution.mjs\n';

/** @param {{code: string, column?: number, identity?: string, line?: number, message: string, path?: string}} diagnostic */
const renderDiagnostic = ({code, column, identity, line, message, path}) => {
    const location = path === undefined ? '' : ` path=${path}${line === undefined ? '' : `:${line}:${column}`}`;
    return `${code}${location}${identity === undefined ? '' : ` identity=${identity}`}: ${message}`;
};

export const runWorkflowDistributionSyncCli = async (/** @type {string[]} */ args, /** @type {{repositoryRoot?: string, stderr?: (value: string) => unknown, stdout?: (value: string) => unknown, sync?: typeof syncWorkflowDistribution}} */ {
    repositoryRoot = SOURCE_ROOT,
    stderr = value => process.stderr.write(value),
    stdout = value => process.stdout.write(value),
    sync = syncWorkflowDistribution,
} = {}) => {
    if (args.length > 0) {
        stderr(CLI_USAGE);
        return 2;
    }
    const result = await sync({repositoryRoot});
    for (const diagnostic of result.diagnostics) stderr(`${renderDiagnostic(diagnostic)}\n`);
    if (result.status !== 'succeeded') return 1;
    for (const {column, context, identity, line, path} of result.notices) {
        stderr(`notice skill-reference-unknown path=${path}:${line}:${column} identity=${identity}: ${context}\n`);
    }
    stdout('Workflow Distribution synchronization completed.\n');
    return 0;
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = await runWorkflowDistributionSyncCli(process.argv.slice(2));
}
