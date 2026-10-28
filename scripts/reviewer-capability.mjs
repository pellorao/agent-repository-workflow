#!/usr/bin/env node
// Reviewer capability suite entry: node scripts/reviewer-capability.mjs <setup|score|pool> ...
//   setup <scenario-directory> <new-target-directory>
//   score <scenario-directory> <report> [--instance ID] [--decisions FILE ...]
//   pool build <scenario-directory> <root> <name> <candidates-file ...>
//   pool prompt|split|override <root> <name> [<decisions-file> | <id> <decision> <reason>]
// JSON goes to stdout, diagnostics to stderr; exit 0 succeeded, 1 blocked or failed, 2 usage error.

import {setupScenario} from '../lib/reviewer-capability-setup.mjs';
import {pool, score} from '../lib/reviewer-capability/operations.mjs';

const usage = (/** @type {string} */ message) => {
    process.stderr.write(`${message}\n`);
    process.exit(2);
};

const [command, ...rest] = process.argv.slice(2);
/** @type {string[]} */
const positional = [];
/** @type {string[]} */
const decisions = [];
let instance;
for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--instance') instance = rest[++index];
    else if (rest[index] === '--decisions') decisions.push(rest[++index]);
    else positional.push(rest[index]);
}
if ([...positional, ...decisions].some(value => value === undefined || value.startsWith('--'))) usage('Unknown or incomplete option.');

let result;
if (command === 'setup' && positional.length === 2) result = await setupScenario({scenario: positional[0], target: positional[1]});
else if (command === 'score' && positional.length === 2) result = await score({decisions, instance, report: positional[1], scenario: positional[0]});
else if (command === 'pool' && positional[0] === 'build' && positional.length >= 5) {
    result = await pool({action: 'build', candidates: positional.slice(4), name: positional[3], root: positional[2], scenario: positional[1]});
} else if (command === 'pool' && positional[0] === 'prompt' && positional.length === 3) result = await pool({action: 'prompt', name: positional[2], root: positional[1]});
else if (command === 'pool' && positional[0] === 'split' && positional.length === 4) result = await pool({action: 'split', decisions: positional[3], name: positional[2], root: positional[1]});
else if (command === 'pool' && positional[0] === 'override' && positional.length === 6) {
    result = await pool({action: 'override', decision: positional[4], id: positional[3], name: positional[2], reason: positional[5], root: positional[1]});
} else usage('Usage: reviewer-capability.mjs setup|score|pool ... (see the header of this file)');

const {diagnostics = [], ...payload} = /** @type {{diagnostics?: string[], status: string}} */ (result);
for (const diagnostic of diagnostics) process.stderr.write(`${diagnostic}\n`);
process.stdout.write(`${JSON.stringify(payload)}\n`);
process.exit(payload.status === 'succeeded' ? 0 : 1);
