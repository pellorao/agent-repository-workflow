import {existsSync, realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

import {runArw} from './lib/arw.mjs';

export {launchAgentCli} from './lib/arw-common/agent-cli-launch.mjs';
export {launchEditor, runArw} from './lib/arw.mjs';

const isDirectInvocation = process.argv[1] && existsSync(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);

if (isDirectInvocation) {
    process.exitCode = await runArw(process.argv.slice(2));
}
