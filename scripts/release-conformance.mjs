#!/usr/bin/env node

import {
    runReleaseConformanceCli,
} from '../lib/release/release-conformance.mjs';
import {discoverRepository} from '../lib/arw-common/repository.mjs';

const args = process.argv.slice(2);
process.exitCode = await runReleaseConformanceCli(args, {
    getRepositoryRoot: async () => (await discoverRepository()).root,
});
