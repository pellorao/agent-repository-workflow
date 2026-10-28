#!/usr/bin/env node
// Reviewer capability suite entry: node scripts/reviewer-capability.mjs <setup|repair|score|combine|baseline|summary|pool> ...
//   setup <scenario-directory> <new-target-directory>
//   repair <scenario-directory> <report> <new-output> [--spill FILE ...]
//   score <scenario-directory> <report> (--repair CHANGES.json | --no-repair) [--agent LIST_AGENTS.json] [--instance ID] [--decisions FILE ...]
//         [--provisional lower|upper | --enumerate]
//   combine <score-1.json> <score-2.json>
//   baseline <unit>
//   summary [--markdown] --cell LABEL FILE... [--cell LABEL FILE...]
//   pool build <scenario-directory> <root> <name> <candidates-file ...> [--decisions FILE ...] [--limit N]
//   pool view <root> <name> <scenario-directory ...>
//   pool prompt <root> <name>
//   pool split <root> <name> <decisions-file> [--hard ID ...]
//   pool override <root> <name> <id> <decision> <reason> [--by WHO]
//   pool anchor-add <scenario-directory> <candidate-file> <matched|not-matched> --family F --model M --confirmed-by WHO [--id ID]
// JSON goes to stdout, diagnostics to stderr; exit 0 succeeded, 1 blocked or failed, 2 usage error.

import {setupScenario} from '../lib/reviewer-capability-setup.mjs';
import {poolView} from '../lib/reviewer-capability-view.mjs';
import {baseline, combine, pool, repair, score, summary} from '../lib/reviewer-capability/operations.mjs';

const usage = (/** @type {string} */ message) => {
    process.stderr.write(`${message}\n`);
    process.exit(2);
};

const [command, ...rest] = process.argv.slice(2);
const VALUE_OPTIONS = ['agent', 'by', 'confirmed-by', 'family', 'id', 'instance', 'limit', 'model', 'provisional', 'repair'];
const LIST_OPTIONS = ['decisions', 'hard', 'spill'];
const FLAGS = ['enumerate', 'markdown', 'no-repair'];
/** @type {string[]} */
const positional = [];
/** @type {Record<string, string>} */
const values = {};
/** @type {Record<string, string[]>} */
const lists = {decisions: [], hard: [], spill: []};
/** @type {Record<string, boolean>} */
const flags = {};
/** @type {Array<{files: string[], label: string}>} */
const cells = [];
for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index].startsWith('--') ? rest[index].slice(2) : undefined;
    if (option === undefined) positional.push(rest[index]);
    else if (option === 'cell') {
        const label = rest[++index];
        const files = [];
        while (index + 1 < rest.length && !rest[index + 1].startsWith('--')) files.push(rest[++index]);
        if (label === undefined || label.startsWith('--')) usage('--cell needs a label and files.');
        cells.push({files, label});
    } else if (FLAGS.includes(option)) flags[option] = true;
    else if (VALUE_OPTIONS.includes(option) || LIST_OPTIONS.includes(option)) {
        const value = rest[++index];
        if (value === undefined || value.startsWith('--')) usage(`--${option} needs a value.`);
        if (LIST_OPTIONS.includes(option)) lists[option].push(value);
        else values[option] = value;
    } else usage(`Unknown option --${option}.`);
}

const [action, ...args] = command === 'pool' ? positional : ['', ...positional];
let result;
if (command === 'setup' && args.length === 2) result = await setupScenario({scenario: args[0], target: args[1]});
else if (command === 'repair' && args.length === 3) result = await repair({out: args[2], report: args[1], scenario: args[0], spills: lists.spill});
else if (command === 'score' && args.length === 2) {
    result = await score({agent: values.agent, decisions: lists.decisions, enumerate: flags.enumerate, instance: values.instance, noRepair: flags['no-repair'],
        provisional: values.provisional, repair: values.repair, report: args[1], scenario: args[0]});
} else if (command === 'combine' && args.length === 2) result = await combine({scores: [args[0], args[1]]});
else if (command === 'baseline' && args.length === 1) result = await baseline({unit: args[0]});
else if (command === 'summary' && args.length === 0) result = await summary({cells, markdown: flags.markdown});
else if (command === 'pool' && action === 'build' && args.length >= 4) {
    result = await pool({action, candidates: args.slice(3), decisions: lists.decisions, limit: values.limit === undefined ? undefined : Number(values.limit), name: args[2], root: args[1], scenario: args[0]});
} else if (command === 'pool' && action === 'view' && args.length >= 3) result = await poolView({name: args[1], root: args[0], scenarios: args.slice(2)});
else if (command === 'pool' && action === 'prompt' && args.length === 2) result = await pool({action, name: args[1], root: args[0]});
else if (command === 'pool' && action === 'split' && args.length === 3) result = await pool({action, decisions: args[2], hard: lists.hard, name: args[1], root: args[0]});
else if (command === 'pool' && action === 'override' && args.length === 5) {
    result = await pool({action, by: values.by, decision: args[3], id: args[2], name: args[1], reason: args[4], root: args[0]});
} else if (command === 'pool' && action === 'anchor-add' && args.length === 3 && values.family && values.model && values['confirmed-by']) {
    result = await pool({action, candidate: args[1], confirmedBy: values['confirmed-by'], expected: args[2], family: values.family, id: values.id, model: values.model, scenario: args[0]});
} else usage('Usage: reviewer-capability.mjs setup|repair|score|combine|baseline|summary|pool ... (see the header of this file)');

const {diagnostics = [], ...payload} = /** @type {{diagnostics?: string[], status: string}} */ (result);
for (const diagnostic of diagnostics) process.stderr.write(`${diagnostic}\n`);
process.stdout.write(`${JSON.stringify(payload)}\n`);
process.exit(payload.status === 'succeeded' ? 0 : 1);
