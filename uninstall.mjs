import {createInterface} from 'node:readline/promises';

import {runUninstaller} from './lib/installation/uninstallation.mjs';
import {PRODUCT_NAME} from './lib/arw-common/product-identity.mjs';
import {askYesNo} from './lib/installation/cli-prompt.mjs';
import {renderBackgroundAgents} from './lib/background-agent/presentation.mjs';

const questions = {
    stopBackgroundAgents: 'Stop these background Agents before uninstalling? [y/N] ',
    removeConfig: 'Remove the installation configuration and ARW message database? [y/N] ',
    removeInstallation: `Remove the ${PRODUCT_NAME} installation? [y/N] `,
};
/** @type {ReturnType<typeof createInterface> | undefined} */
let readline;

try {
    process.exitCode = await runUninstaller(process.argv.slice(2), {
        prompt: async (decision, activeAgents) => {
            if (decision === 'stopBackgroundAgents') {
                process.stdout.write(`${renderBackgroundAgents(/** @type {import('./lib/background-agent/presentation.mjs').BackgroundAgentOverview[]} */ (activeAgents ?? []), true)}\n`);
            }
            readline ??= createInterface({input: process.stdin, output: process.stdout});
            return askYesNo({
                question: questions[decision],
                readline,
                writeInvalid: () => process.stderr.write('Please answer yes or no.\n'),
            });
        },
    });
} finally {
    readline?.close();
}
