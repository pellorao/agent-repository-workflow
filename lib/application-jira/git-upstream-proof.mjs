import {createNodeGitRunner} from '../common/git-process.mjs';
import {parseJsonText} from '../common/json.mjs';
import {resolveRepositoryConfiguration} from '../arw-common/repository-configuration.mjs';
import {TextDecoder} from 'node:util';

import {isRegularGitBlobMode, parseTreeBlobEntries, readBatchBlobs} from '../common/git-content.mjs';
import {parseRegisteredArtifactPath} from '../arw-common/artifacts.mjs';

/** @param {{git?: ReturnType<typeof createNodeGitRunner>, repositoryRoot: string}} input */
export const loadCommittedApplicationConfiguration = async input => {
    const git = input.git ?? createNodeGitRunner(input.repositoryRoot);
    const read = await git.run({argv: ['show', 'HEAD:arw.config.json'], cwd: input.repositoryRoot});
    if (read.code !== 0 || read.failure !== null) {
        return {diagnostics: [{code: 'committed-application-configuration-missing', message: 'Committed Application configuration could not be read from HEAD.'}], status: /** @type {'blocked'} */ ('blocked')};
    }
    const parsed = parseJsonText(read.stdout);
    if (parsed.status !== 'succeeded') {
        return {diagnostics: parsed.diagnostics.map(diagnostic => ({...diagnostic, code: `committed-application-configuration-${diagnostic.code}`})), status: /** @type {'blocked'} */ ('blocked')};
    }
    const resolved = resolveRepositoryConfiguration({repositoryRoot: input.repositoryRoot, value: parsed.value});
    if (resolved.status !== 'succeeded') return resolved;
    if (resolved.context.role !== 'leader') {
        return {diagnostics: [{code: 'committed-application-configuration-required', message: 'Committed Application configuration is required for JIRA synchronization.'}], status: /** @type {'blocked'} */ ('blocked')};
    }
    return resolved;
};

/** @param {{effortPath: string, git?: ReturnType<typeof createNodeGitRunner>, repositoryRoot: string}} input */
export const proveUpstreamEffort = async input => {
    const git = input.git ?? createNodeGitRunner(input.repositoryRoot);
    const upstream = await git.run({argv: ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], cwd: input.repositoryRoot});
    if (upstream.code !== 0 || upstream.failure !== null) {
        return {diagnostics: [{code: 'upstream-missing', message: 'Current Application branch has no readable upstream.'}], status: /** @type {'blocked'} */ ('blocked')};
    }
    const fetched = await git.run({argv: ['fetch'], cwd: input.repositoryRoot});
    if (fetched.code !== 0 || fetched.failure !== null) {
        return {diagnostics: [{code: 'upstream-fetch-failed', message: 'Current Application branch upstream could not be fetched.'}], stage: 'fetch', status: /** @type {'failed'} */ ('failed')};
    }
    const upstreamName = upstream.stdout.toString('utf8').trim();
    const localTree = await git.run({argv: ['rev-parse', `HEAD:${input.effortPath}`], cwd: input.repositoryRoot});
    const remoteTree = await git.run({argv: ['rev-parse', `${upstreamName}:${input.effortPath}`], cwd: input.repositoryRoot});
    if (localTree.code !== 0 || remoteTree.code !== 0 || localTree.failure !== null || remoteTree.failure !== null) {
        return {diagnostics: [{code: 'upstream-tree-read-failed', message: 'Committed Application effort tree could not be read locally and upstream.'}], stage: 'tree-read', status: /** @type {'failed'} */ ('failed')};
    }
    const local = localTree.stdout.toString('utf8').trim();
    const remote = remoteTree.stdout.toString('utf8').trim();
    if (local !== remote) {
        return {diagnostics: [{code: 'upstream-tree-mismatch', message: 'Committed Application effort tree does not match the live upstream tree.'}], status: /** @type {'blocked'} */ ('blocked')};
    }
    return {diagnostics: [], proof: {localTree: local, upstream: upstreamName, upstreamTree: remote}, status: /** @type {'succeeded'} */ ('succeeded')};
};

/** @param {{effortNumber: string, git?: ReturnType<typeof createNodeGitRunner>, repositoryRoot: string}} input */
export const loadCommittedApplicationEffort = async input => {
    const git = input.git ?? createNodeGitRunner(input.repositoryRoot);
    const listed = await git.run({argv: ['ls-tree', '-r', '-z', 'HEAD', '--', '.scratch'], cwd: input.repositoryRoot});
    if (listed.code !== 0 || listed.failure !== null) {
        return {diagnostics: [{code: 'committed-effort-read-failed', message: 'Committed Application effort could not be listed.'}], stage: 'tree-read', status: /** @type {'failed'} */ ('failed')};
    }
    /** @type {ReturnType<typeof parseTreeBlobEntries>[number] | undefined} */
    let specEntry;
    /** @type {ReturnType<typeof parseTreeBlobEntries>} */
    let issueEntries = [];
    /** @type {string | undefined} */
    let effortPath;
    try {
        const entries = parseTreeBlobEntries(listed.stdout);
        const registeredEntries = entries.flatMap(entry => {
            try {
                return [{entry, identity: parseRegisteredArtifactPath(entry.path)}];
            } catch {
                return [];
            }
        });
        const effortDirectories = new Set(registeredEntries
            .filter(({identity}) => identity.effortNumber === input.effortNumber)
            .map(({identity}) => identity.effortDirectory));
        if (effortDirectories.size !== 1) {
            return {diagnostics: [{code: 'committed-spec-missing', message: `Committed Application spec not found: spec:${input.effortNumber}.`}], status: /** @type {'blocked'} */ ('blocked')};
        }
        const effortDirectory = [...effortDirectories][0];
        if (effortDirectory === undefined) throw new Error('Committed Application effort directory is unavailable.');
        effortPath = `.scratch/${effortDirectory}`;
        const specEntries = registeredEntries
            .filter(({identity}) => identity.effortDirectory === effortDirectory && identity.kind === 'spec')
            .map(({entry}) => entry);
        issueEntries = registeredEntries
            .filter(({identity}) => identity.effortDirectory === effortDirectory && identity.kind === 'issue')
            .map(({entry}) => entry);
        if (specEntries.length !== 1) {
            return {diagnostics: [{code: 'committed-spec-missing', message: `Committed Application spec not found: spec:${input.effortNumber}.`}], status: /** @type {'blocked'} */ ('blocked')};
        }
        specEntry = specEntries[0];
        if (!isRegularGitBlobMode(specEntry.mode) || issueEntries.some(entry => !isRegularGitBlobMode(entry.mode))) {
            return {diagnostics: [{code: 'committed-effort-path-invalid', message: 'Committed Application spec and issues must be regular files.'}], status: /** @type {'blocked'} */ ('blocked')};
        }
    } catch {
        return {diagnostics: [{code: 'committed-effort-read-failed', message: 'Committed Application effort could not be read.'}], stage: 'tree-read', status: /** @type {'failed'} */ ('failed')};
    }
    if (specEntry === undefined || effortPath === undefined) {
        return {diagnostics: [{code: 'committed-effort-read-failed', message: 'Committed Application effort could not be read.'}], stage: 'tree-read', status: /** @type {'failed'} */ ('failed')};
    }
    let blobs;
    try {
        blobs = await readBatchBlobs({git, objectIds: [...new Set([specEntry.objectId, ...issueEntries.map(entry => entry.objectId)])].sort()});
    } catch {
        return {diagnostics: [{code: 'committed-effort-read-failed', message: 'Committed Application effort could not be read.'}], stage: 'tree-read', status: /** @type {'failed'} */ ('failed')};
    }
    try {
        const decoder = new TextDecoder('utf-8', {fatal: true});
        const specBytes = blobs.get(specEntry.objectId);
        if (specBytes === undefined) throw new Error('Committed Application spec blob is unavailable.');
        const documents = issueEntries.map(entry => {
            const bytes = blobs.get(entry.objectId);
            const identity = parseRegisteredArtifactPath(entry.path);
            if (bytes === undefined || identity.kind !== 'issue' || identity.issueNumber === null) throw new Error('Committed Application issue blob is unavailable.');
            return {effort: identity.effortDirectory, number: identity.issueNumber, sourceKey: entry.path, text: decoder.decode(bytes)};
        });
        return {diagnostics: [], documents, effortPath, specText: decoder.decode(specBytes), status: /** @type {'succeeded'} */ ('succeeded')};
    } catch {
        return {diagnostics: [{code: 'committed-effort-input-invalid', message: 'Committed Application spec and issues must contain valid UTF-8 text.'}], status: /** @type {'blocked'} */ ('blocked')};
    }
};
