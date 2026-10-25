#!/usr/bin/env node

import {runPostTagBootstrapVerificationCli} from '../lib/release/post-tag-bootstrap-verification.mjs';

process.exitCode = await runPostTagBootstrapVerificationCli(process.argv.slice(2));
