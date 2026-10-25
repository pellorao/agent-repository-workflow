#!/usr/bin/env node

import {createInterface} from 'node:readline/promises';

import {
    createSourceCheckoutUpstreamSyncModule,
    runUpstreamSyncCli,
} from '../lib/upstream-sync/upstream-sync.mjs';

const module = await createSourceCheckoutUpstreamSyncModule();

/** @type {NonNullable<Parameters<typeof runUpstreamSyncCli>[1]['promptApproval']>} */
const promptApproval = async current => {
    const terminal = createInterface({input: process.stdin, output: process.stdout});
    try {
        const answer = await terminal.question(
            `Approve Review Revision ${current.reviewRevisionId}? Type approve to confirm: `,
        );
        return answer.trim() === 'approve'
            ? `Local CLI confirmation for Review Revision ${current.reviewRevisionId}.`
            : null;
    } finally {
        terminal.close();
    }
};

/** @type {NonNullable<Parameters<typeof runUpstreamSyncCli>[1]['promptRecovery']>} */
const promptRecovery = async (current, direction) => {
    if (current.recoveryPlan === undefined) throw new Error('Recovery approval was requested without a recovery plan.');
    const terminal = createInterface({input: process.stdin, output: process.stdout});
    try {
        const answer = await terminal.question(
            `Authorize ${direction} recovery plan ${current.recoveryPlan.recoveryPlanDigest}? Type recover to confirm: `,
        );
        return answer.trim() === 'recover'
            ? `Local CLI confirmation for ${direction} recovery plan ${current.recoveryPlan.recoveryPlanDigest}.`
            : null;
    } finally {
        terminal.close();
    }
};

process.exitCode = await runUpstreamSyncCli(process.argv.slice(2), {
    module,
    promptApproval,
    promptRecovery,
});
