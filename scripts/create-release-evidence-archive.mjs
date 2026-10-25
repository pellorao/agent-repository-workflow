import {createReleaseEvidenceArchive} from '../lib/release/release-evidence-archive.mjs';

const args = process.argv.slice(2);
if (args.length !== 6
    || args[0] !== '--source'
    || args[1].length === 0
    || args[2] !== '--output'
    || args[3].length === 0
    || args[4] !== '--archive-kind'
    || args[5].length === 0) {
    process.stderr.write('Usage: node scripts/create-release-evidence-archive.mjs --source <directory> --output <archive.tar> --archive-kind <kind>\n');
    process.exitCode = 2;
} else {
    try {
        const result = await createReleaseEvidenceArchive({
            archiveKind: args[5],
            outputPath: args[3],
            sourceDirectory: args[1],
        });
        process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
