// Builds a Reviewer capability scenario as an independent Git repository and returns the `spawn_agent` input for it.
// It connects the Commit Audit and Spec Readiness business scopes, so it sits at the top level of `lib/`.

import {execFile} from 'node:child_process';
import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

import {prepareCommitAudit} from './commit-audit/commit-audit.mjs';
import {exists, overlayFiles} from './reviewer-capability/scenario.mjs';
import {prepareSpecReadiness} from './spec-readiness/spec-readiness.mjs';

const run = promisify(execFile);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// Files the reviewer rules refer to, copied into the scenario repository so a reviewer limited to it can read them.
const INSTRUCTIONS = ['docs/agents/reviewer.md', 'docs/agents/agent-writes.md', 'docs/agents/writing.md', 'docs/agents/roles',
    '.agents/skills/issue-tracking/SKILL.md', '.agents/skills/domain-modeling/SKILL.md'];
const IDENTITY = {platform: 'codex', sessionId: 'reviewer-capability'};
const SPEC_READINESS_INPUT_ROLES = {'specs/': 'governing-spec', 'docs/adr/': 'adr', 'rules/': 'architecture-evidence', 'context/': 'domain-context',
    'architecture/': 'architecture-evidence'};


/**
 * @param {{scenario: string, target: string}} input
 */
export const setupScenario = async input => {
    const scenario = resolve(input.scenario);
    const target = resolve(input.target);
    const role = basename(dirname(scenario));
    if (!await exists(join(scenario, 'expected.json'))) return {diagnostics: [`Scenario fixture is missing: ${scenario}.`], status: 'blocked'};
    if (await exists(target)) return {diagnostics: [`Target already exists: ${target}.`], status: 'blocked'};
    try {
        const git = (/** @type {string[]} */ ...args) => run('git', args, {cwd: target});
        const stage = async (/** @type {string} */ part) => {
            for (const [path, source] of await overlayFiles(scenario, part)) {
                await mkdir(dirname(join(target, path)), {recursive: true});
                await cp(source, join(target, path));
            }
        };
        await mkdir(target, {recursive: true});
        await stage('base');
        for (const path of INSTRUCTIONS) await cp(join(ROOT, path), join(target, path), {recursive: true});
        await git('init', '-q');
        await git('add', '-A');
        await git('-c', 'user.name=Reviewer Capability', '-c', 'user.email=capability@example.test', 'commit', '-qm', 'scenario base');
        await stage('candidate');
        await git('add', '-A');
        const files = (await git('ls-files')).stdout.split('\n').filter(Boolean);
        const issueIds = files.flatMap(path => {
            const match = /^\.scratch\/(\d{4})-[^/]+\/issues\/(\d{2})-[^/]+\.md$/u.exec(path);
            return match ? [`issue:${match[1]}:${match[2]}`] : [];
        }).sort();
        const review = join(target, '.tmp', 'review');
        let reportPath = join(review, 'reports', 'report.txt');
        let task = `Review the staged comparison: \`git diff --cached HEAD\`; read staged bytes with \`git show :<path>\`. Write the complete review to \`${reportPath}\`.`;
        // requirements-reviewer also reviews a Code Spec comparison, which has no Commit Audit Request.
        if (role === 'requirements-reviewer' && basename(scenario) === 'commit-audit') {
            await mkdir(review, {recursive: true});
            await writeFile(join(review, 'input.json'), JSON.stringify({authorizingIssueIds: issueIds}));
            const round = await prepareCommitAudit({inputPath: join(review, 'input.json'), platformAdapter: {getCurrentAgentIdentity: () => IDENTITY}, repositoryRoot: target});
            const requestPath = join(round.roundDirectory, 'request.json');
            reportPath = JSON.parse(await readFile(requestPath, 'utf8')).reviewPath;
            task = `Commit review. The Request is \`${requestPath}\`; write the review to its \`reviewPath\`.`;
        } else if (role === 'spec-readiness-reviewer') {
            const inputs = files.flatMap(filePath => {
                const prefix = Object.keys(SPEC_READINESS_INPUT_ROLES).find(entry => filePath.startsWith(entry));
                return prefix === undefined ? [] : [{filePath, role: SPEC_READINESS_INPUT_ROLES[/** @type {keyof typeof SPEC_READINESS_INPUT_ROLES} */ (prefix)]}];
            }).sort((left, right) => left.filePath.localeCompare(right.filePath));
            const prepared = await prepareSpecReadiness({input: {inputs}, issueId: issueIds[0], platformAdapter: {getCurrentAgentIdentity: () => IDENTITY}, repositoryRoot: target});
            reportPath = prepared.draftPath;
            task = `The Reviewer Request is in \`${prepared.path}\`; write the draft to \`${reportPath}\`.`;
        } else {
            await mkdir(dirname(reportPath), {recursive: true});
            await writeFile(reportPath, '');
        }
        // Recovery records must lie inside the caller's session temporary directory, so they go beside the instance.
        const stateDirectory = join(dirname(target), 'state');
        await mkdir(stateDirectory, {recursive: true});
        const extra = await readFile(join(scenario, 'handoff.md'), 'utf8').catch(() => '');
        const instructions = await Promise.all([`docs/agents/roles/${role}.md`, 'docs/agents/reviewer.md'].map(path => readFile(join(ROOT, path), 'utf8')));
        return {diagnostics: [], input: {
            role,
            identity: {kind: 'isolated', instanceId: basename(target)},
            instructions: instructions.join('\n'),
            handoff: [`The Repository under review is \`${target}\`; work only inside it and use it as the working directory.`,
                'Only the Agent instruction files present in this Repository apply; references to absent files do not apply.', task, extra.trim()].filter(Boolean).join('\n\n'),
            cwd: target,
            writePaths: [dirname(reportPath)],
            reportPath,
            stateDirectory,
        }, status: 'succeeded'};
    } catch (error) {
        return {diagnostics: [error instanceof Error ? error.message : String(error)], stage: 'scenario-build', status: 'failed'};
    }
};
