import {pathToFileURL} from 'node:url';

import {runArw} from './lib/arw.mjs';

export {launchAgentCli} from './lib/arw-common/agent-cli-launch.mjs';
export {launchEditor, runArw} from './lib/arw.mjs';

const isDirectInvocation = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
    process.exitCode = await runArw(process.argv.slice(2));
}
