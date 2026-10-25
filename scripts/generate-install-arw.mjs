import {generateBootstrapArtifact} from '../lib/installation/bootstrap-artifact.mjs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const sourceDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    process.stderr.write('Usage: node scripts/generate-install-arw.mjs [--check]\n');
    process.exitCode = 2;
} else {
    const result = await generateBootstrapArtifact({
        mode: args[0] === '--check' ? 'check' : 'write',
        sourceDirectory,
    });
    if (result.status !== 'succeeded') {
        for (const diagnostic of result.diagnostics) process.stderr.write(`${diagnostic.message}\n`);
        process.exitCode = 1;
    }
}
