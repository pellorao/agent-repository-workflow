import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {dirname, join, relative} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {createClaudeCodePlatformAdapter, createCodexPlatformAdapter} from '../../lib/arw-common/platform-adapter.mjs';

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const skillRoot = join(repositoryRoot, '.agents', 'skills', 'application-workflow');

/** @typedef {{bytes: Buffer, path: string}} ProjectedTarget */

const readSkillPayload = async () => {
    const entries = await readdir(skillRoot, {recursive: true, withFileTypes: true});
    const payload = [];
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const fullPath = join(entry.parentPath, entry.name);
        payload.push({
            bytes: await readFile(fullPath),
            path: `skills/application-workflow/${relative(skillRoot, fullPath).replaceAll('\\', '/')}`,
        });
    }
    return payload.sort((left, right) => left.path.localeCompare(right.path));
};

/** @param {{diagnostics?: unknown[], managedTargets?: ProjectedTarget[], status: string}} result @returns {ProjectedTarget[]} */
const requireProjection = result => {
    assert.equal(result.status, 'succeeded', JSON.stringify(result.diagnostics));
    if (!Array.isArray(result.managedTargets)) assert.fail('Expected successful managed targets.');
    return result.managedTargets;
};

test('Application workflow Skill projects explicit-only metadata through one configured Platform Adapter', async () => {
    const payload = await readSkillPayload();
    payload.push({bytes: await readFile(join(repositoryRoot, 'distribution/projections/codex/config.toml')), path: 'projections/codex/config.toml'});
    const issueTrackerBytes = await readFile(join(repositoryRoot, 'docs', 'agents', 'environment.md'));
    payload.push({bytes: await readFile(join(repositoryRoot, 'AGENTS.md')), path: 'baseline/AGENTS.md'});
    payload.push({bytes: issueTrackerBytes, path: 'baseline/docs/agents/environment.md'});
    const projectionConfig = JSON.parse(await readFile(join(repositoryRoot, 'distribution', 'projections', 'config.json'), 'utf8'));
    const profile = {
        codeMaps: {excludes: [], includes: [], roots: []},
        domainLayout: 'single-context',
        platforms: ['claude-code', 'codex'],
    };
    const codex = requireProjection(createCodexPlatformAdapter().evaluate({payload, platform: 'codex', profile, projectionConfig, seedTargets: {}}));
    const claude = requireProjection(createClaudeCodePlatformAdapter().evaluate({payload, platform: 'claude-code', profile, projectionConfig, seedTargets: {}}));

    const codexYaml = codex.find(entry => entry.path === '.agents/skills/application-workflow/agents/openai.yaml');
    assert.ok(codexYaml);
    assert.match(codexYaml.bytes.toString('utf8'), /^policy:\n  allow_implicit_invocation: false$/mu);
    assert.equal(claude.some(entry => entry.path.endsWith('/agents/openai.yaml')), false);

    const codexMarkdown = new Map(codex
        .filter(entry => entry.path.startsWith('.agents/skills/application-workflow/') && entry.path.endsWith('.md'))
        .map(entry => [entry.path.replace('.agents/skills/application-workflow/', ''), entry.bytes.toString('utf8')]));
    const claudeMarkdown = new Map(claude
        .filter(entry => entry.path.startsWith('.claude/skills/application-workflow/') && entry.path.endsWith('.md'))
        .map(entry => [entry.path.replace('.claude/skills/application-workflow/', ''), entry.bytes.toString('utf8')]));
    assert.deepEqual(claudeMarkdown, codexMarkdown);
    assert.match(claudeMarkdown.get('SKILL.md') ?? '', /^disable-model-invocation: true$/mu);
    assert.deepEqual([...claudeMarkdown.keys()].sort(), [
        'SKILL.md',
        'references/association-and-distribution.md',
        'references/configuration.md',
        'references/jira-acceptance.md',
        'references/jira-completion.md',
        'references/module-correction.md',
        'references/recovery.md',
        'references/synchronization.md',
    ]);
    for (const targets of [codex, claude]) {
        const issueTracker = targets.find(entry => entry.path === 'docs/agents/environment.md');
        assert.ok(issueTracker);
        assert.deepEqual(issueTracker.bytes, issueTrackerBytes);
    }
});
