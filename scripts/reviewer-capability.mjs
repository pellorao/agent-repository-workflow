#!/usr/bin/env node
// 把一个 Reviewer 能力场景搭成独立 Git 仓库, 按角色准备审核输入, 输出可直接交给 `arw background-agent` 的 spawn_agent input.
// 用法: node scripts/reviewer-capability.mjs <scenario-directory> <new-target-directory>

import {execFileSync} from 'node:child_process';
import {cp, mkdir, readFile, readdir, rename, writeFile} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {resolveTemporaryWorkspace} from '../lib/arw-common/temporary-workspace.mjs';
import {prepareCommitAudit} from '../lib/commit-audit/commit-audit.mjs';
import {prepareSpecReadiness} from '../lib/spec-readiness/spec-readiness.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// Reviewer 规则引用的指令文件, 复制进场景仓库, 让 Reviewer 只读场景仓库也能读到.
const INSTRUCTIONS = ['docs/agents/reviewer.md', 'docs/agents/agent-writes.md', 'docs/agents/writing.md', 'docs/agents/roles',
    '.agents/skills/issue-tracking/SKILL.md', '.agents/skills/domain-modeling/SKILL.md'];
const IDENTITY = {platform: 'codex', sessionId: 'reviewer-capability'};
const SPEC_READINESS_INPUT_ROLES = {'specs/': 'governing-spec', 'docs/adr/': 'adr', 'rules/': 'architecture-evidence',
    'context/': 'domain-context', 'architecture/': 'architecture-evidence'};

const [scenarioArgument, targetArgument] = process.argv.slice(2);
if (!scenarioArgument || !targetArgument) throw new Error('Usage: node scripts/reviewer-capability.mjs <scenario-directory> <new-target-directory>');
const scenario = resolve(scenarioArgument);
const target = resolve(targetArgument);
const role = basename(dirname(scenario));

const git = (/** @type {string[]} */ ...args) => execFileSync('git', args, {cwd: target, encoding: 'utf8'});
const overlay = async (/** @type {string} */ part) => {
    for (const source of [join(dirname(scenario), 'common', part), join(scenario, part)]) {
        await cp(source, target, {recursive: true}).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
};
const listFiles = async (/** @type {string} */ directory) => (await readdir(directory, {recursive: true, withFileTypes: true}))
    .filter(entry => entry.isFile() && !entry.parentPath.includes(`${join(directory, '.git')}`))
    .map(entry => join(entry.parentPath, entry.name).slice(directory.length + 1).split('\\').join('/'));

await mkdir(dirname(target), {recursive: true});
await mkdir(target);
await overlay('base');
for (const path of INSTRUCTIONS) await cp(join(ROOT, path), join(target, path), {recursive: true});
git('init', '-q');
git('add', '-A');
git('-c', 'user.name=Reviewer Capability', '-c', 'user.email=capability@example.test', 'commit', '-qm', 'scenario base');
await overlay('candidate');
git('add', '-A');

const files = await listFiles(target);
const issueIds = files.flatMap(path => {
    const match = /^\.scratch\/(\d{4})-[^/]+\/issues\/(\d{2})-[^/]+\.md$/.exec(path);
    return match ? [`issue:${match[1]}:${match[2]}`] : [];
}).sort();
const review = join(target, '.tmp', 'review');
let reportPath = join(review, 'reports', 'findings.md');
let task = `Review the staged comparison: \`git diff --cached HEAD\`; read staged bytes with \`git show :<path>\`. Write the complete review to \`${reportPath}\`.`;
if (role === 'requirements-reviewer') {
    await mkdir(review, {recursive: true});
    await writeFile(join(review, 'input.json'), JSON.stringify({authorizingIssueIds: issueIds}));
    const {requestPath} = await prepareCommitAudit({inputPath: join(review, 'input.json'), repositoryRoot: target});
    reportPath = join(review, 'reports', 'review.md');
    // 运行时要求新审核的绑定报告为空, 而 prepare 预写了清单 (ticket 10 记录的缺陷); 先把清单移到报告目录外.
    const template = join(review, 'checklist.md');
    await rename(reportPath, template);
    await writeFile(reportPath, '');
    task = `Commit review. The Request is \`${requestPath}\`. The bound checklist \`${reportPath}\` starts empty: copy \`${template}\` into it unchanged, then fill every item.`;
} else if (role === 'spec-readiness-reviewer') {
    const workspace = resolveTemporaryWorkspace({agentIdentity: IDENTITY, issueId: issueIds[0], purpose: 'spec-readiness', repositoryRoot: target});
    reportPath = join(workspace, 'reviewer-drafts', 'reports', 'draft.jsonl');
    const inputs = files.flatMap(filePath => {
        const prefix = Object.keys(SPEC_READINESS_INPUT_ROLES).find(entry => filePath.startsWith(entry));
        return prefix ? [{filePath, role: SPEC_READINESS_INPUT_ROLES[/** @type {keyof typeof SPEC_READINESS_INPUT_ROLES} */ (prefix)]}] : [];
    }).sort((left, right) => left.filePath.localeCompare(right.filePath));
    const prepared = await prepareSpecReadiness({input: {draftPath: reportPath, inputs}, issueId: issueIds[0],
        platformAdapter: {getCurrentAgentIdentity: () => IDENTITY}, repositoryRoot: target});
    task = `The Reviewer Request is \`${prepared.path}\`; its draftPath is \`${reportPath}\`.`;
} else {
    await mkdir(dirname(reportPath), {recursive: true});
    await writeFile(reportPath, '');
}

// 恢复记录须在调用方仓库的会话临时目录内, 场景目录按 Skill 放在那里, 所以用它的父目录.
const stateDirectory = join(dirname(target), 'state');
await mkdir(stateDirectory, {recursive: true});
const extra = await readFile(join(scenario, 'handoff.md'), 'utf8').catch(() => '');
const instructions = await Promise.all([`docs/agents/roles/${role}.md`, 'docs/agents/reviewer.md'].map(path => readFile(join(ROOT, path), 'utf8')));
process.stdout.write(`${JSON.stringify({
    role,
    identity: {kind: 'isolated', instanceId: basename(target)},
    instructions: instructions.join('\n'),
    handoff: [
        `The Repository under review is \`${target}\`; work only inside it and use it as the working directory.`,
        'Only the Agent instruction files present in this Repository apply; references to absent files do not apply.',
        task,
        extra.trim(),
    ].filter(Boolean).join('\n\n'),
    cwd: target,
    writePaths: [dirname(reportPath)],
    reportPath,
    stateDirectory,
})}\n`);
