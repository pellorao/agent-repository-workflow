#!/usr/bin/env node

import {runReviewerCapabilityConformanceCli} from '../lib/release/reviewer-capability-conformance.mjs';
import {discoverRepository} from '../lib/arw-common/repository.mjs';

let repositoryRoot = process.cwd();
try {
    repositoryRoot = (await discoverRepository()).root;
} catch (error) {
    process.stderr.write(`reviewer-capability-conformance-failed: ${JSON.stringify(error instanceof Error ? error.message : String(error)).slice(1, -1)}\n`);
    process.exitCode = 1;
}

if (process.exitCode === undefined) {
    process.exitCode = await runReviewerCapabilityConformanceCli(process.argv.slice(2), {repositoryRoot});
}
