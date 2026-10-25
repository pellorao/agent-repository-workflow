#!/usr/bin/env node
import {runReviewerBenchmarkCli} from '../lib/reviewer-benchmark/benchmark-runner.mjs';

try {await runReviewerBenchmarkCli(process.argv.slice(2));}
catch (error) {process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);process.exitCode = 1;}
