import {dirname} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath} from 'node:url';

import {evaluateNodeRuntime} from './lib/arw-common/runtime-compatibility.mjs';
import {askYesNo} from './lib/installation/cli-prompt.mjs';

const runtime = evaluateNodeRuntime(process.versions.node);
if (runtime.status === 'unsupported') {
    process.stderr.write(`${runtime.error}\n`);
    process.exitCode = 1;
} else {
    const recommendationShown = Reflect.get(
        globalThis,
        Symbol.for('agent-repository-workflow.runtime-recommendation-shown'),
    ) === true;
    if (runtime.recommendation !== null && !recommendationShown) {
        process.stderr.write(`${runtime.recommendation}\n`);
    }
    const [{runInstaller}, {PRODUCT_NAME}] = await Promise.all([
        import('./lib/installation/installation.mjs'),
        import('./lib/arw-common/product-identity.mjs'),
    ]);
    const questions = {
        registerPath: `Register ${PRODUCT_NAME} in PATH? [y/N] `,
    };
    // 询问时才创建 readline: 管道输入在此之前留在缓冲中, 提前创建会在询问发出前读完并关闭.
    /** @type {{readline?: import('node:readline/promises').Interface}} */
    const session = {};

    try {
        process.exitCode = await runInstaller(process.argv.slice(2), {
            prompt: async (/** @type {'registerPath'} */ decision) => {
                session.readline ??= createInterface({input: process.stdin, output: process.stdout});
                return askYesNo({
                    question: questions[decision],
                    readline: session.readline,
                    writeInvalid: () => process.stderr.write('Please answer yes or no.\n'),
                });
            },
            sourceDirectory: dirname(fileURLToPath(import.meta.url)),
        });
    } finally {
        session.readline?.close();
    }
}
