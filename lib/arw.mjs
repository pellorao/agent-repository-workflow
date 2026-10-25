import {spawn as spawnProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, isAbsolute, join, sep} from 'node:path';

import {launchAgentCli} from './arw-common/agent-cli-launch.mjs';
import {formatCanonicalArtifactId, listArtifacts, parseArtifactIdentifier, parseCanonicalArtifactId, readArtifactInventory, resolveArtifactTarget} from './arw-common/artifacts.mjs';
import {loadConfig} from './arw-common/config.mjs';
import {launchConfiguredEditor} from './arw-common/editor-process.mjs';
import {ARW_VERSION} from './arw-common/identity.mjs';
import {runCodeMapVerification} from './repository-workflow/code-map.mjs';
import {discoverRepository} from './arw-common/repository.mjs';
import {createCurrentPlatformAdapter} from './arw-common/platform-adapter.mjs';
import {runTextPolicy} from './arw-common/text-policy.mjs';
import {inspectDocumentLanguages} from './arw-common/document-language-inspection.mjs';
import {renderLanguageChecks, renderLanguageCompositionTable} from './arw-common/language-composition-presentation.mjs';
import {
    canonicalDocumentTermsInclude,
    checkDocumentTerms,
    serializeDocumentTermsDiagnostic,
} from './document-terms/document-terms.mjs';
import {
    generateSpecReadiness,
    prepareSpecReadiness,
    promoteSpecReadiness,
    verifySpecReadiness,
} from './spec-readiness/spec-readiness.mjs';
import {prepareCommitAudit, verifyCommitAudit} from './commit-audit/commit-audit.mjs';
import {runArtifactMigration} from './artifact-migration/artifact-migration.mjs';
import {runRepositoryWorkflow} from './repository-workflow/workflow.mjs';
import {createScopedFilesystem, resolveAbsolutePathWithinScope} from './common/filesystem.mjs';
import {isJsonObject, parseJson} from './common/json.mjs';
import {runApplicationJiraCommand} from './application-jira/application-jira-cli.mjs';
import {renderBackgroundAgents} from './background-agent/presentation.mjs';

const PROGRAM_DIRECTORY = dirname(dirname(fileURLToPath(import.meta.url)));
const ISSUE_TYPES = new Set(['implementation', 'application-source', 'wayfinder']);
/** @returns {value is ArtifactKind} */
const isArtifactKind = (/** @type {unknown} */ value) => value === 'issue' || value === 'map' || value === 'spec';
/** @typedef {(message: string) => void} Writer */
/** @typedef {{once: { (event: 'error', listener: () => void): unknown, (event: 'spawn', listener: () => void): unknown, (event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown }, unref?: () => void}} SpawnedProcess */
/** @typedef {(command: string, args: readonly string[], options: {cwd?: string, env?: NodeJS.ProcessEnv, shell?: false, stdio: 'ignore' | 'inherit', windowsHide: boolean}) => SpawnedProcess} ArwSpawn */
/** @typedef {Map<string, string[] | true>} OptionPairs */
/** @typedef {Map<string, (string | null)[] | true>} WorkflowOptionPairs */
/** @typedef {{allStatuses: boolean, status: string[] | null, type: string[] | null}} ListOptions */
/** @typedef {'issue' | 'map' | 'spec'} ArtifactKind */
/** @typedef {'init' | 'update' | 'verify' | 'remove'} WorkflowOperation */
/** @typedef {{kind: 'agent-start', name: string, agentArguments: string[]}} AgentStartCommand */
/** @typedef {{kind: 'list-artifacts', artifactKind: ArtifactKind, options?: ListOptions}} ListArtifactsCommand */
/** @typedef {{kind: 'print-artifact' | 'open-artifact', id: string}} TargetArtifactCommand */
/** @typedef {{kind: `workflow-${WorkflowOperation}`, operation: WorkflowOperation, nonInteractive: boolean, options: WorkflowOptionPairs}} WorkflowCommand */
/**
 * @typedef {
 *   | AgentStartCommand
 *   | {kind: 'background-agent'}
 *   | {kind: 'list-background-agents'}
 *   | ListArtifactsCommand
 *   | TargetArtifactCommand
 *   | WorkflowCommand
 *   | {kind: 'migrate-artifacts'}
 *   | {kind: 'code-map-verify'}
 *   | {kind: 'text-policy', intent: 'check' | 'fix'}
 *   | {verbose: boolean, languageThresholds: import('./arw-common/language-checks.mjs').LanguageThreshold[], include: string[], kind: 'terms-check', mode: 'immediate' | 'release'}
 *   | {kind: 'language-inspect', paths: string[]}
 *   | {kind: 'jira-list', limit: number | null}
 *   | {kind: 'jira-open', issueKey: string}
 *   | {kind: 'jira-print', issueKey: string}
 *   | {kind: 'submodule-switch-branch', targetBranch: string}
 *   | {kind: 'module-check-correction', issueId: string}
 *   | {kind: 'application-sync'}
 *   | {kind: 'application-associate', moduleIssueId: string, moduleName: string, applicationIssueId: string}
 *   | {kind: 'jira-sync', phase: 'accepted' | 'completed', specId: string}
 *   | {kind: 'spec-readiness-prepare', issueId: string, inputPath: string | null}
 *   | {kind: 'spec-readiness-generate', issueId: string, inputPath: string}
 *   | {kind: 'spec-readiness-promote', inputPath: string}
 *   | {kind: 'spec-readiness-verify', issueId: string}
 *   | {kind: 'commit-audit-prepare', inputPath: string}
 *   | {kind: 'commit-audit-verify'}
 * } ParsedCommand
 */
/** @typedef {Awaited<ReturnType<typeof discoverRepository>>} Repository */
/** @typedef {Awaited<ReturnType<typeof loadConfig>>} Config */
/** @typedef {Partial<Omit<Parameters<typeof runRepositoryWorkflow>[0], 'operation' | 'repositoryRoot'>>} WorkflowDependencies */
/** @typedef {Partial<Omit<Parameters<typeof runCodeMapVerification>[0], 'repositoryRoot'>>} CodeMapDependencies */
/** @typedef {Partial<Omit<Parameters<typeof runTextPolicy>[0], 'intent' | 'repositoryRoot'>>} TextPolicyDependencies */
/** @typedef {{check?: typeof checkDocumentTerms}} DocumentTermsDependencies */
/** @typedef {{inspect?: typeof inspectDocumentLanguages}} DocumentLanguageDependencies */
/** @typedef {Partial<Pick<Parameters<typeof prepareSpecReadiness>[0], 'atomicWriteFile' | 'platformAdapter'>>} SpecReadinessDependencies */
/** @typedef {NonNullable<Parameters<typeof runApplicationJiraCommand>[0]['dependencies']>} ApplicationJiraDependencies */
/** @typedef {{diagnostics: Array<{message: string, path: string}>, legacyDetected?: boolean}} ArtifactScan */
/** @typedef {{code: string, phase?: number, path?: string, locator?: string, platform?: string, message?: string}} WorkflowDiagnostic */
/** @typedef {{action: string, path: string}} WorkflowCliOperation */
/** @typedef {{canonical: string, operations: WorkflowCliOperation[]}} WorkflowCliPlan */
/** @typedef {{applied?: boolean, cancelled?: boolean, diagnostics: WorkflowDiagnostic[], handoff?: {checklist: string[], gaps: string[]}, migratedRuleDocuments?: string[], plan: WorkflowCliPlan | null, satisfied?: boolean, verified?: boolean}} WorkflowCliResult */
/** @typedef {Awaited<ReturnType<typeof runTextPolicy>>} TextPolicyResult */
/** @typedef {TextPolicyResult['diagnostics'][number]} TextPolicyDiagnostic */
/**
 * @typedef {object} RunArwOptions
 * @property {Writer} [stdout]
 * @property {Writer} [rawStdout]
 * @property {Writer} [stderr]
 * @property {string} [cwd]
 * @property {string} [programDirectory]
 * @property {ArwSpawn} [spawnProcess]
 * @property {string} [stdin]
 * @property {Parameters<typeof runArtifactMigration>[3]} [updateFileSystem]
 * @property {Parameters<typeof runArtifactMigration>[4]} [artifactInventoryFilesystem]
 * @property {Parameters<typeof runArtifactMigration>[5]} [artifactMigrationGit]
 * @property {WorkflowDependencies} [workflowDependencies]
 * @property {CodeMapDependencies} [codeMapDependencies]
 * @property {TextPolicyDependencies} [textPolicyDependencies]
 * @property {DocumentTermsDependencies} [documentTermsDependencies]
 * @property {DocumentLanguageDependencies} [documentLanguageDependencies]
 * @property {SpecReadinessDependencies} [specReadinessDependencies]
 * @property {ApplicationJiraDependencies} [applicationJiraDependencies]
 * @property {Partial<import('./arw-background-agent-host.mjs').BackgroundAgentHostOptions>} [backgroundAgentDependencies]
 * @property {() => Promise<import('./background-agent/presentation.mjs').BackgroundAgentOverview[]|null>} [backgroundAgentList]
 * @property {Parameters<typeof runRepositoryWorkflow>[0]['prompt']} [prompt]
 */
const escapeText = (/** @type {unknown} */ value) => String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('\0', '\\0');

export class UsageError extends Error {
    /**
     * @param {string | undefined} message
     */
    constructor(message) {
        super(message);
        this.name = 'UsageError';
        this.exitCode = 2;
    }
}

const usage = () => [
    'Usage:',
    '  arw list issues [--all-statuses | --status <status>[,<status>...]] [--type <type>[,<type>...]]',
    '  arw li [-a | -s <status>[,<status>...]] [-t <type>[,<type>...]]',
    '  arw list maps | arw lm',
    '  arw list specs | arw ls',
    '  arw list background-agents | arw lba',
    '  arw print <local-canonical-id>',
    '  arw open <local-canonical-id>',
    '  arw agent start <name> [agent-arguments...]',
    '  arw migrate artifacts',
    '  arw code-map verify',
    '  arw text check | arw text fix',
    '  arw terms check [--strict] [--include <repository-relative-directory>]... [--verbose] [--language-threshold <name>=<percentage>]...',
    '  arw language inspect <repository-relative-path>...',
    '  arw jira list [--limit <positive-integer>] | arw jl [--limit <positive-integer>]',
    '  arw jira open <issue-key> | arw jo <issue-key>',
    '  arw jira print <issue-key>',
    '  arw submodule switch-branch <branch> | arw ssb <branch>',
    '  arw module check-correction <local-module-issue-id>',
    '  arw application sync',
    '  arw application associate <local-application-issue-id> <qualified-module-issue-id>',
    '  arw jira accept <spec-id> | arw jira complete <spec-id>',
    '  arw spec-readiness prepare --issue issue:NNNN:NN [--input <temp-json-path>]',
    '  arw spec-readiness generate --issue issue:NNNN:NN --input <draft-path>',
    '  arw spec-readiness promote --input <generated-path>',
    '  arw spec-readiness verify --issue issue:NNNN:NN',
    '  arw commit-audit prepare --input <absolute-input-path>',
    '  arw commit-audit verify',
    '  arw workflow init [--non-interactive (--reuse-profile | --platform <platform>... --domain-layout <layout> --code-map-root [<root>]... --code-map-include [<glob>]... --code-map-exclude [<glob>]...) --transform-existing-agent-docs <true|false> --orphan-code-map-readmes <delete|demote>]',
    '  arw workflow update [--non-interactive] [--dry-run] [--transform-existing-agent-docs <true|false>]',
    '  arw workflow verify',
    '  arw workflow remove [--non-interactive --platform-agent-configs <retain|delete> --arwignore <retain|delete> --code-maps <retain|delete> --mixed-agent-documents <retain|delete>]',
    '  arw --version',
].join('\n');

const parseOptionPairs = (/** @type {string[]} */ args, /** @type {Set<string>} */ repeatedOptions = new Set()) => {
    /** @type {OptionPairs} */
    const options = new Map();
    for (let index = 0; index < args.length; index += 1) {
        const option = args[index];
        if (!option.startsWith('--')) {
            throw new UsageError(`${usage()}\nUnexpected argument: ${option}.`);
        }
        if (option === '--exception') {
            if (options.has(option)) {
                throw new UsageError(`${usage()}\nRepeated option: ${option}.`);
            }
            options.set(option, true);
            continue;
        }
        const value = args[index + 1];
        if (value === undefined || value.startsWith('--')) {
            throw new UsageError(`${usage()}\nMissing value for ${option}.`);
        }
        if (options.has(option) && !repeatedOptions.has(option)) {
            throw new UsageError(`${usage()}\nRepeated option: ${option}.`);
        }
        const existing = options.get(option);
        const values = Array.isArray(existing) ? existing : [];
        values.push(value);
        options.set(option, values);
        index += 1;
    }
    return options;
};

const requireExactOptions = (/** @type {OptionPairs} */ options, /** @type {string[]} */ expected) => {
    const actual = [...options.keys()].sort();
    const required = [...expected].sort();
    if (actual.length !== required.length || actual.some((option, index) => option !== required[index])) {
        throw new UsageError(`${usage()}\nMissing, unknown, or inapplicable spec-readiness option.`);
    }
};

const oneOption = (/** @type {OptionPairs} */ options, /** @type {string} */ name) => {
    const values = options.get(name);
    return Array.isArray(values) ? values[0] : undefined;
};

/** @returns {Extract<ParsedCommand, {kind: `spec-readiness-${string}`} >} */
const parseSpecReadinessCommand = (/** @type {string[]} */ args) => {
    const operation = args[0];
    if (!['prepare', 'generate', 'promote', 'verify'].includes(operation)) {
        throw new UsageError(`${usage()}\nUnknown spec-readiness operation.`);
    }
    const options = parseOptionPairs(args.slice(1));

    if (operation === 'verify') {
        requireExactOptions(options, ['--issue']);
        return {issueId: oneOption(options, '--issue') ?? '', kind: 'spec-readiness-verify'};
    }

    if (operation === 'promote') {
        requireExactOptions(options, ['--input']);
        return {inputPath: oneOption(options, '--input') ?? '', kind: 'spec-readiness-promote'};
    }

    if (operation === 'generate') {
        requireExactOptions(options, ['--input', '--issue']);
        return {inputPath: oneOption(options, '--input') ?? '', issueId: oneOption(options, '--issue') ?? '', kind: 'spec-readiness-generate'};
    }

    const optionNames = [...options.keys()].sort();
    const validNames = optionNames.length === 1 && optionNames[0] === '--issue'
        || optionNames.length === 2 && optionNames[0] === '--input' && optionNames[1] === '--issue';
    if (!validNames) throw new UsageError(`${usage()}\nMissing, unknown, or inapplicable spec-readiness option.`);
    return {
        inputPath: oneOption(options, '--input') ?? null,
        issueId: oneOption(options, '--issue') ?? '',
        kind: 'spec-readiness-prepare',
    };
};

/** @returns {Extract<ParsedCommand, {kind: `commit-audit-${string}`} >} */
const parseCommitAuditCommand = (/** @type {string[]} */ args) => {
    if (args[0] === 'verify') {
        if (args.length !== 1) throw new UsageError(`${usage()}\ncommit-audit verify does not accept scope or other options.`);
        return {kind: 'commit-audit-verify'};
    }
    if (args[0] !== 'prepare') throw new UsageError(`${usage()}\nUnknown commit-audit operation.`);
    const options = parseOptionPairs(args.slice(1));
    if (options.size !== 1 || !options.has('--input')) throw new UsageError(`${usage()}\ncommit-audit prepare requires exactly one --input option.`);
    const path = oneOption(options, '--input') ?? '';
    if (!isAbsolute(path)) throw new UsageError(`${usage()}\ncommit-audit prepare requires an absolute --input path.`);
    return {inputPath: path, kind: 'commit-audit-prepare'};
};

const parseCommaValues = (/** @type {unknown} */ value, /** @type {string} */ option) => {
    if (typeof value !== 'string' || value.length === 0 || /\s/.test(value)) {
        throw new UsageError(`${option} expects one or more comma-separated values without spaces.`);
    }

    const values = value.split(',');

    if (values.some(item => item.length === 0)) {
        throw new UsageError(`${option} expects one or more comma-separated values without empty items.`);
    }

    return values;
};

/** @returns {{kind: 'jira-list', limit: number | null}} */
const parseJiraListCommand = (/** @type {string[]} */ args) => {
    const optionArgs = args[0] === 'jl' ? args.slice(1) : args.slice(2);
    if (optionArgs.length === 0) return {kind: 'jira-list', limit: null};
    if (optionArgs.length !== 2 || optionArgs[0] !== '--limit' || !/^[1-9]\d*$/u.test(optionArgs[1])) {
        throw new UsageError(`${usage()}\nJIRA list --limit expects one positive safe integer.`);
    }
    const limit = Number(optionArgs[1]);
    if (!Number.isSafeInteger(limit)) throw new UsageError(`${usage()}\nJIRA list --limit expects one positive safe integer.`);
    return {kind: 'jira-list', limit};
};

/** @returns {{kind: 'jira-open', issueKey: string}} */
const parseJiraOpenCommand = (/** @type {string[]} */ args) => {
    const issueKey = args[0] === 'jo' ? args[1] : args[2];
    const expectedLength = args[0] === 'jo' ? 2 : 3;
    if (args.length !== expectedLength
        || typeof issueKey !== 'string'
        || issueKey.length === 0
        || issueKey.trim() !== issueKey
        || /[\u0000-\u001f\u007f-\u009f]/u.test(issueKey)) {
        throw new UsageError(`${usage()}\nJIRA open expects one non-empty issue key without surrounding whitespace or control characters.`);
    }
    return {issueKey, kind: 'jira-open'};
};

/** @returns {{kind: 'jira-print', issueKey: string}} */
const parseJiraPrintCommand = (/** @type {string[]} */ args) => {
    const issueKey = args[2];
    if (args.length !== 3
        || typeof issueKey !== 'string'
        || issueKey.length === 0
        || issueKey.trim() !== issueKey
        || /[\u0000-\u001f\u007f-\u009f]/u.test(issueKey)) {
        throw new UsageError(`${usage()}\nJIRA print expects one non-empty issue key without surrounding whitespace or control characters.`);
    }
    return {issueKey, kind: 'jira-print'};
};

/** @returns {{kind: 'submodule-switch-branch', targetBranch: string}} */
const parseSubmoduleSwitchCommand = (/** @type {string[]} */ args) => {
    const targetBranch = args[0] === 'ssb' ? args[1] : args[2];
    const expectedLength = args[0] === 'ssb' ? 2 : 3;
    if (args.length !== expectedLength
        || typeof targetBranch !== 'string'
        || targetBranch.length === 0
        || targetBranch.trim() !== targetBranch
        || /[\u0000-\u001f\u007f-\u009f]/u.test(targetBranch)) {
        throw new UsageError(`${usage()}\nSubmodule switch-branch expects one non-empty branch without surrounding whitespace or control characters.`);
    }
    return {kind: 'submodule-switch-branch', targetBranch};
};

const parseListOptions = (/** @type {string[]} */ args) => {
    /** @type {ListOptions} */
    const options = {allStatuses: false, status: null, type: null};

    for (let index = 0; index < args.length; index += 1) {
        const option = args[index];

        if (option === '--all-statuses' || option === '-a') {
            if (options.allStatuses) {
                throw new UsageError(`${usage()}\nUnknown or repeated option: ${option}.`);
            }

            options.allStatuses = true;
            continue;
        }

        const name = option === '--status' || option === '-s' ? 'status' : option === '--type' || option === '-t' ? 'type' : null;

        if (!name || options[name] !== null) {
            throw new UsageError(`${usage()}\nUnknown or repeated option: ${option}.`);
        }

        const value = args[index + 1];

        if (value === undefined || value.startsWith('-')) {
            throw new UsageError(`${usage()}\nMissing value for ${option}.`);
        }

        options[name] = parseCommaValues(value, option);
        index += 1;
    }

    if (options.type && options.type.some((/** @type {string} */ type) => !ISSUE_TYPES.has(type))) {
        throw new UsageError('--type only accepts implementation, application-source, and wayfinder.');
    }

    if (options.allStatuses && options.status) {
        throw new UsageError(`${usage()}\n--all-statuses/-a cannot be combined with --status/-s.`);
    }

    return options;
};

const WORKFLOW_OPTION_NAMES = new Set([
    '--code-map-exclude',
    '--code-map-include',
    '--code-map-root',
    '--domain-layout',
    '--dry-run',
    '--arwignore',
    '--code-maps',
    '--mixed-agent-documents',
    '--non-interactive',
    '--orphan-code-map-readmes',
    '--platform',
    '--platform-agent-configs',
    '--reuse-profile',
    '--transform-existing-agent-docs',
]);

const parseWorkflowOptions = (/** @type {string[]} */ args) => {
    /** @type {WorkflowOptionPairs} */
    const options = new Map();
    const optionalValueOptions = new Set(['--code-map-exclude', '--code-map-include', '--code-map-root']);
    for (let index = 0; index < args.length; index += 1) {
        const option = args[index];
        if (!WORKFLOW_OPTION_NAMES.has(option)) throw new UsageError(`${usage()}\nUnknown workflow option: ${option}.`);
        if (options.has(option) && !optionalValueOptions.has(option) && option !== '--platform') {
            throw new UsageError(`${usage()}\nRepeated workflow option: ${option}.`);
        }
        if (option === '--non-interactive' || option === '--dry-run' || option === '--reuse-profile') {
            options.set(option, true);
            continue;
        }
        const next = args[index + 1];
        if (optionalValueOptions.has(option) && (next === undefined || next.startsWith('--'))) {
            const existing = options.get(option);
            const values = Array.isArray(existing) ? existing : [];
            values.push(null);
            options.set(option, values);
            continue;
        }
        if (next === undefined || next.startsWith('--')) throw new UsageError(`${usage()}\nMissing value for ${option}.`);
        const existing = options.get(option);
        const values = Array.isArray(existing) ? existing : [];
        values.push(next);
        options.set(option, values);
        index += 1;
    }
    return options;
};

const workflowOptionValues = (/** @type {WorkflowOptionPairs} */ options, /** @type {string} */ name) => {
    const values = options.get(name);
    return Array.isArray(values) ? values : [];
};

/** @returns {WorkflowCommand} */
const parseWorkflowCommand = (/** @type {string[]} */ args) => {
    if (args.length < 2 || args[0] !== 'workflow' || !['init', 'update', 'verify', 'remove'].includes(args[1])) {
        throw new UsageError(`${usage()}\nUnknown workflow command.`);
    }
    /** @type {WorkflowOperation} */
    let operation;
    if (args[1] === 'init') operation = 'init';
    else if (args[1] === 'update') operation = 'update';
    else if (args[1] === 'verify') operation = 'verify';
    else operation = 'remove';
    const options = parseWorkflowOptions(args.slice(2));
    if (operation === 'verify' && options.size > 0) throw new UsageError(`${usage()}\nworkflow verify does not accept options.`);
    if (operation === 'remove' && [...options.keys()].some(option => !['--arwignore', '--code-maps', '--mixed-agent-documents', '--non-interactive', '--platform-agent-configs'].includes(option))) {
        throw new UsageError(`${usage()}\nworkflow remove received an inapplicable option.`);
    }
    if (operation === 'remove' && options.has('--dry-run')) throw new UsageError(`${usage()}\nworkflow remove does not accept --dry-run.`);
    if (operation === 'update' && [...options.keys()].some(option => !['--dry-run', '--non-interactive', '--transform-existing-agent-docs'].includes(option))) {
        throw new UsageError(`${usage()}\nworkflow update received an inapplicable option.`);
    }
    if (operation === 'init' && [...options.keys()].some(option => ![
        '--code-map-exclude',
        '--code-map-include',
        '--code-map-root',
        '--domain-layout',
        '--non-interactive',
        '--orphan-code-map-readmes',
        '--platform',
        '--reuse-profile',
        '--transform-existing-agent-docs',
    ].includes(option))) {
        throw new UsageError(`${usage()}\nworkflow init received an inapplicable option.`);
    }
    if (operation === 'init' && options.has('--dry-run')) throw new UsageError(`${usage()}\nworkflow init does not accept --dry-run.`);
    if (operation === 'init' && options.has('--orphan-code-map-readmes') && workflowOptionValues(options, '--orphan-code-map-readmes').length !== 1) {
        throw new UsageError(`${usage()}\n--orphan-code-map-readmes must occur once.`);
    }
    const nonInteractive = options.has('--non-interactive');
    if (!nonInteractive && [...options.keys()].some(option => option !== '--dry-run')) {
        throw new UsageError(`${usage()}\nChoice options require --non-interactive.`);
    }
    if (nonInteractive && operation === 'init') {
        const profileOptions = ['--platform', '--domain-layout', '--code-map-root', '--code-map-include', '--code-map-exclude'];
        const hasProfileInput = profileOptions.some(option => options.has(option));
        const reuseProfile = options.has('--reuse-profile');
        if (reuseProfile && hasProfileInput) throw new UsageError(`${usage()}\n--reuse-profile cannot be combined with Profile replacement options.`);
        if (!reuseProfile && !hasProfileInput) throw new UsageError(`${usage()}\nNon-interactive workflow init requires --reuse-profile or a complete Profile replacement.`);
        if (hasProfileInput && !options.has('--platform')) throw new UsageError(`${usage()}\n--platform is required for a complete Profile replacement.`);
        if (hasProfileInput && !options.has('--domain-layout')) throw new UsageError(`${usage()}\n--domain-layout is required for a complete Profile replacement.`);
        if (hasProfileInput && !options.has('--code-map-root')) throw new UsageError(`${usage()}\n--code-map-root is required for a complete Profile replacement.`);
        if (hasProfileInput && !options.has('--code-map-include')) throw new UsageError(`${usage()}\n--code-map-include is required for a complete Profile replacement.`);
        if (hasProfileInput && !options.has('--code-map-exclude')) throw new UsageError(`${usage()}\n--code-map-exclude is required for a complete Profile replacement.`);
    }
    return {
        kind: operation === 'init'
            ? 'workflow-init'
            : operation === 'update'
                ? 'workflow-update'
                : operation === 'verify'
                    ? 'workflow-verify'
                    : 'workflow-remove',
        nonInteractive,
        operation,
        options,
    };
};

const parseBooleanOption = (/** @type {WorkflowOptionPairs} */ options, /** @type {string} */ name) => {
    const values = workflowOptionValues(options, name);
    if (values.length !== 1 || typeof values[0] !== 'string' || !['true', 'false'].includes(values[0])) throw new UsageError(`${usage()}\n${name} expects true or false.`);
    return values[0] === 'true';
};

const parseProfileChoices = (/** @type {WorkflowOptionPairs} */ options) => {
    const parseList = (/** @type {string} */ name) => {
        const values = workflowOptionValues(options, name);
        if (values.some(value => value === null) && values.some(value => value !== null)) {
            throw new UsageError(`${usage()}\n${name} cannot mix an explicit empty occurrence with valued occurrences.`);
        }
        const flattened = values.flatMap(value => value === null ? [] : value);
        if (new Set(flattened).size !== flattened.length) throw new UsageError(`${usage()}\n${name} cannot repeat a value.`);
        return flattened;
    };
    const platforms = workflowOptionValues(options, '--platform').flatMap(value => value === null ? [] : value.split(','));
    if (new Set(platforms).size !== platforms.length) throw new UsageError(`${usage()}\n--platform cannot repeat a platform.`);
    if (platforms.length === 0 || platforms.some((/** @type {string} */ platform) => !['codex', 'claude-code'].includes(platform))) {
        throw new UsageError(`${usage()}\n--platform contains an unsupported platform.`);
    }
    const layouts = workflowOptionValues(options, '--domain-layout');
    if (layouts.length !== 1 || typeof layouts[0] !== 'string' || !['single-context', 'multi-context'].includes(layouts[0])) {
        throw new UsageError(`${usage()}\n--domain-layout expects single-context or multi-context.`);
    }
    const roots = parseList('--code-map-root');
    const includes = parseList('--code-map-include');
    const excludes = parseList('--code-map-exclude');
    if (roots.length === 0 && (includes.length > 0 || excludes.length > 0)) {
        throw new UsageError(`${usage()}\nCode Map include and exclude options require at least one root.`);
    }
    if (roots.length > 0 && includes.length === 0) throw new UsageError(`${usage()}\nCode Map roots require at least one include glob.`);
    const profile = {
        codeMaps: {
            excludes,
            includes,
            roots,
        },
        domainLayout: layouts[0],
        platforms,
    };
    return {platforms, profile};
};

const parseRemovalChoices = (/** @type {WorkflowOptionPairs} */ options) => Object.fromEntries([
    ['--platform-agent-configs', 'platform-agent-configs'],
    ['--arwignore', 'arwignore'],
    ['--code-maps', 'code-maps'],
    ['--mixed-agent-documents', 'mixed-agent-documents'],
].filter(([option]) => options.has(option)).map(([option, category]) => {
    const values = workflowOptionValues(options, option);
    if (values.length !== 1 || typeof values[0] !== 'string' || !['retain', 'delete'].includes(values[0])) throw new UsageError(`${usage()}\n${option} expects retain or delete.`);
    return [category, values[0]];
}));

const parseOrphanCodeMapChoice = (/** @type {WorkflowOptionPairs} */ options) => {
    const values = workflowOptionValues(options, '--orphan-code-map-readmes');
    if (values.length !== 1 || typeof values[0] !== 'string' || !['delete', 'demote'].includes(values[0])) {
        throw new UsageError(`${usage()}\n--orphan-code-map-readmes expects delete or demote.`);
    }
    return values[0];
};

/** @returns {ParsedCommand} */
export const parseCommand = (/** @type {string[]} */ args) => {
    if (args.length === 0) {
        throw new UsageError(`${usage()}\nA command is required.`);
    }

    if (args[0] === 'background-agent') {
        if (args.length !== 1) throw new UsageError('arw background-agent does not accept arguments or options.');
        return {kind: 'background-agent'};
    }
    if ((args[0] === 'list' && args[1] === 'background-agents') || args[0] === 'lba') {
        if (args.length !== (args[0] === 'list' ? 2 : 1)) throw new UsageError('Background Agent list does not accept arguments or options.');
        return {kind:'list-background-agents'};
    }

    if (args[0] === 'migrate' && args[1] === 'artifacts') {
        if (args.length !== 2) {
            throw new UsageError(`${usage()}\nMigrate artifacts does not accept arguments.`);
        }

        return {kind: 'migrate-artifacts'};
    }

    if (args[0] === 'spec-readiness') {
        return parseSpecReadinessCommand(args.slice(1));
    }

    if (args[0] === 'commit-audit') return parseCommitAuditCommand(args.slice(1));

    if (args[0] === 'code-map') {
        if (args.length !== 2 || args[1] !== 'verify') {
            throw new UsageError(`${usage()}\nCode Map expects exactly: arw code-map verify.`);
        }
        return {kind: 'code-map-verify'};
    }

    if (args[0] === 'text') {
        if (args.length !== 2 || !['check', 'fix'].includes(args[1])) {
            throw new UsageError(`${usage()}\nText expects exactly: arw text check or arw text fix.`);
        }
        return {intent: args[1], kind: 'text-policy'};
    }

    if (args[0] === 'terms') {
        if (args[1] !== 'check') {
            throw new UsageError(`${usage()}\nTerms expects exactly: arw terms check [--strict] [--include <repository-relative-directory>]... [--verbose] [--language-threshold <name>=<percentage>]...`);
        }
        let strict = false;
        let verbose = false;
        /** @type {import('./arw-common/language-checks.mjs').LanguageThreshold[]} */
        const languageThresholds = [];
        /** @type {string[]} */
        const include = [];
        for (let index = 2; index < args.length; index += 1) {
            const argument = args[index];
            if (argument === '--strict') {
                if (strict) throw new UsageError(`${usage()}\nTerms accepts --strict at most once.`);
                strict = true;
                continue;
            }
            if (argument === '--verbose') {
                if (verbose) throw new UsageError(`${usage()}\nTerms accepts --verbose at most once.`);
                verbose = true;
                continue;
            }
            if (argument === '--language-threshold') {
                const value = args[++index];
                const match = typeof value === 'string' && !value.startsWith('--') ? /^(.*)=((?:\d+(?:\.\d*)?|\.\d+))$/u.exec(value) : null;
                if (match === null || !Number.isFinite(Number(match[2])) || Number(match[2]) > 100
                    || languageThresholds.some(override => override.name === match[1])) throw new UsageError(`${usage()}\nInvalid language threshold override.`);
                languageThresholds.push({name: match[1], minPercentage: Number(match[2])});
                continue;
            }
            if (argument !== '--include' || index + 1 >= args.length) {
                throw new UsageError(`${usage()}\nTerms received an invalid argument.`);
            }
            const value = args[index + 1];
            index += 1;
            if (value.startsWith('--')) throw new UsageError(`${usage()}\nTerms received an invalid include directory.`);
            const canonical = canonicalDocumentTermsInclude(value);
            if (canonical === null) throw new UsageError(`${usage()}\nTerms received an invalid include directory.`);
            include.push(canonical);
        }
        return {include, verbose, languageThresholds, kind: 'terms-check', mode: strict ? 'release' : 'immediate'};
    }

    if (args[0] === 'language') {
        if (args[1] !== 'inspect' || args.length < 3 || args.slice(2).some(path => path.startsWith('--'))) {
            throw new UsageError(`${usage()}\nLanguage expects one or more Repository-relative files or directories.`);
        }
        return {kind: 'language-inspect', paths: args.slice(2)};
    }

    if (args[0] === 'workflow') return parseWorkflowCommand(args);

    if (args[0] === 'jl' || args[0] === 'jira' && args[1] === 'list') return parseJiraListCommand(args);
    if (args[0] === 'jo' || args[0] === 'jira' && args[1] === 'open') return parseJiraOpenCommand(args);
    if (args[0] === 'jira' && args[1] === 'print') return parseJiraPrintCommand(args);
    if (args[0] === 'jira' && ['accept', 'complete'].includes(args[1])) {
        if (args.length !== 3) throw new UsageError(`${usage()}\nJIRA accept and complete expect one spec ID.`);
        try {
            parseArtifactIdentifier('spec', args[2]);
            return {kind: 'jira-sync', phase: /** @type {'accepted' | 'completed'} */ (args[1] === 'accept' ? 'accepted' : 'completed'), specId: args[2]};
        } catch (error) {
            throw new UsageError(`${usage()}\n${error instanceof Error ? error.message : String(error)}`);
        }
    }

    if (args[0] === 'module' && args[1] === 'check-correction') {
        if (args.length !== 3) throw new UsageError(`${usage()}\nModule check-correction expects one local Module issue ID.`);
        try {
            const identity = parseCanonicalArtifactId(args[2]);
            if (identity.kind !== 'issue' || identity.qualifier !== null || identity.issueNumber === null) throw new Error();
            return {issueId: args[2], kind: 'module-check-correction'};
        } catch {
            throw new UsageError(`${usage()}\nModule check-correction expects one local Module issue ID.`);
        }
    }
    if (args[0] === 'ssb' || args[0] === 'submodule' && args[1] === 'switch-branch') return parseSubmoduleSwitchCommand(args);
    if (args[0] === 'application' && args[1] === 'sync') {
        if (args.length !== 2) throw new UsageError(`${usage()}\nApplication sync does not accept arguments.`);
        return {kind: 'application-sync'};
    }
    if (args[0] === 'application' && args[1] === 'associate') {
        if (args.length !== 4) throw new UsageError(`${usage()}\nApplication associate expects one local Application issue ID and one qualified Module issue ID.`);
        try {
            const applicationIssue = parseCanonicalArtifactId(args[2]);
            const moduleIssue = parseCanonicalArtifactId(args[3]);
            if (applicationIssue.kind !== 'issue' || applicationIssue.qualifier !== null) throw new Error('Application issue ID must be local.');
            if (moduleIssue.kind !== 'issue' || moduleIssue.qualifier === null) throw new Error('Module issue ID must be qualified.');
            return {
                kind: 'application-associate',
                moduleIssueId: formatCanonicalArtifactId({...moduleIssue, qualifier: null}),
                moduleName: moduleIssue.qualifier,
                applicationIssueId: args[2],
            };
        } catch (error) {
            throw new UsageError(`${usage()}\n${error instanceof Error ? error.message : String(error)}`);
        }
    }

    if (args[0] === 'agent') {
        if (args[1] !== 'start') throw new UsageError(`${usage()}\nUnknown agent operation.`);
        if (args.length === 2) throw new UsageError(`${usage()}\nAgent start expects a name.`);
        return {agentArguments: args.slice(3), kind: 'agent-start', name: args[2]};
    }

    if (args[0] === 'list' && args[1] === 'issues') {
        return {artifactKind: 'issue', kind: 'list-artifacts', options: parseListOptions(args.slice(2))};
    }

    if (args[0] === 'li') {
        return {artifactKind: 'issue', kind: 'list-artifacts', options: parseListOptions(args.slice(1))};
    }

    const listKind = args[0] === 'list' && (args[1] === 'maps' || args[1] === 'specs')
        ? args[1].slice(0, -1)
        : args.length === 1 && ['lm', 'ls'].includes(args[0])
            ? args[0] === 'lm' ? 'map' : 'spec'
            : null;

    if (listKind) {
        if ((args[0] === 'list' && args.length !== 2) || (args[0] !== 'list' && args.length !== 1)) {
            throw new UsageError(`${usage()}\nList ${listKind}s does not accept arguments.`);
        }

        return {artifactKind: listKind, kind: 'list-artifacts'};
    }

    if (args[0] === 'print' || args[0] === 'open') {
        if (args.length !== 2) throw new UsageError(`${usage()}\n${args[0] === 'print' ? 'Print' : 'Open'} expects exactly one local canonical ID.`);
        try {
            const id = parseCanonicalArtifactId(args[1]);
            if (id.qualifier !== null) throw new Error('Canonical ID must be local for open or print.');
            return {id: args[1], kind: args[0] === 'print' ? 'print-artifact' : 'open-artifact'};
        } catch (error) {
            throw new UsageError(`${usage()}\n${error instanceof Error ? error.message : String(error)}`);
        }
    }

    throw new UsageError(`${usage()}\nUnknown command or artifact.`);
};

const defaultWriter = (/** @type {(NodeJS.WriteStream & { fd: 1; }) | (NodeJS.WriteStream & { fd: 2; })} */ stream) => (/** @type {string} */ message) => stream.write(`${message}\n`);
const readStandardInput = () => new Promise((/** @type {(value: string) => void} */ resolve, reject) => {
    /** @type {string[]} */
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (/** @type {string} */ chunk) => chunks.push(chunk));
    process.stdin.once('end', () => resolve(chunks.join('')));
    process.stdin.once('error', reject);
});

const emitDiagnostics = (/** @type {ArtifactScan} */ scan, /** @type {Writer} */ stderr, /** @type {string | null} */ selectedPath = null) => {
    const diagnostics = selectedPath === null
        ? scan.diagnostics
        : scan.diagnostics.filter(diagnostic => diagnostic.path === selectedPath || selectedPath.startsWith(`${diagnostic.path}/`));

    for (const diagnostic of diagnostics) {
        stderr(`Malformed ${diagnostic.path}: ${diagnostic.message}`);
    }

    if (scan.legacyDetected && diagnostics.length > 0) {
        stderr('Hint: legacy issue or PRD format detected.');
        stderr('Run `arw migrate artifacts` to upgrade the entire repository before retrying.');
    }

    return diagnostics.length > 0;
};

export const launchEditor = async (/** @type {{ command: string; args: string[]; }} */ editor, /** @type {string} */ filePath, /** @type {ArwSpawn} */ spawn = spawnProcess, platform = process.platform) => (
    launchConfiguredEditor({editor, filePath, platform, spawn, wait: false})
);

const runListArtifacts = async (/** @type {ListArtifactsCommand} */ command, /** @type {Repository} */ repository, /** @type {Writer} */ stdout, /** @type {Writer} */ stderr, /** @type {Parameters<typeof readArtifactInventory>[1]} */ filesystem) => {
    const inventory = await readArtifactInventory(repository, filesystem);
    const result = listArtifacts(inventory, command.artifactKind, command.options);
    stdout(result.output);
    return emitDiagnostics(result, stderr) ? 1 : 0;
};

const runOpenArtifact = async (/** @type {{id: string}} */ command, /** @type {Repository} */ repository, /** @type {Config} */ config, /** @type {Writer} */ stdout, /** @type {Writer} */ stderr, /** @type {ArwSpawn} */ spawn, /** @type {Parameters<typeof readArtifactInventory>[1]} */ filesystem) => {
    const inventory = await readArtifactInventory(repository, filesystem);
    const result = resolveArtifactTarget(inventory, command.id);
    const hasTargetDiagnostics = emitDiagnostics(result, stderr);

    if (!result.target) {
        if (hasTargetDiagnostics) {
            return 1;
        }

        throw new Error(result.notFoundMessage);
    }

    if (hasTargetDiagnostics) {
        return 1;
    }

    stdout(`Opening ${result.target.relativePath}`);

    try {
        await launchEditor(config.editor, result.target.path, spawn);
    } catch {
        stderr(`Failed to start editor command "${config.editor.command}".`);
        return 1;
    }

    return 0;
};

const runPrintArtifact = async (/** @type {{id: string}} */ command, /** @type {Repository} */ repository, /** @type {Writer} */ stdout, /** @type {Writer} */ stderr, /** @type {Parameters<typeof readArtifactInventory>[1]} */ filesystem) => {
    const inventory = await readArtifactInventory(repository, filesystem);
    const result = resolveArtifactTarget(inventory, command.id);
    const hasTargetDiagnostics = emitDiagnostics(result, stderr);

    if (!result.target) {
        if (hasTargetDiagnostics) {
            return 1;
        }
        throw new Error(result.notFoundMessage);
    }
    if (hasTargetDiagnostics) {
        return 1;
    }

    const created = await createScopedFilesystem({root: repository.root});
    if (created.status !== 'succeeded') throw new Error('The Repository filesystem could not be opened.');
    const read = await created.scopedFilesystem.readText({allowLossyDecoding: false, path: result.target.relativePath});
    if (read.status !== 'succeeded') throw new Error(`Artifact file could not be read: ${result.target.relativePath}.`);
    stdout(read.text);
    return 0;
};

const repositoryInputPath = (/** @type {{resolve: (input: {path: string}) => {absolutePath?: string, relativePath?: string, status: string}}} */ filesystem, /** @type {string} */ repositoryRoot, /** @type {string} */ path) => {
    const resolved = isAbsolute(path)
        ? resolveAbsolutePathWithinScope({path, scope: repositoryRoot})
        : filesystem.resolve({path});
    if (resolved.status !== 'succeeded' || resolved.absolutePath === undefined || resolved.relativePath === undefined) {
        throw new Error('Input path escapes the Repository.');
    }
    return {absolutePath: resolved.absolutePath, relativePath: resolved.relativePath.split(sep).join('/')};
};

const renderWorkflowDiagnostic = (/** @type {WorkflowDiagnostic} */ diagnostic) => {
    const escape = (/** @type {unknown} */ value) => String(value).replaceAll('\\', '\\\\').replaceAll('\r', '\\r').replaceAll('\n', '\\n').replaceAll('\0', '\\0');
    const path = diagnostic.path === undefined ? '' : ` path=${escape(diagnostic.path)}`;
    const locator = diagnostic.locator === undefined ? '' : ` locator=${escape(diagnostic.locator)}`;
    const platform = diagnostic.platform === undefined ? '' : ` platform=${escape(diagnostic.platform)}`;
    const message = diagnostic.message === undefined ? '' : `: ${escape(diagnostic.message)}`;
    return `[phase ${diagnostic.phase}] ${diagnostic.code}${path}${locator}${platform}${message}`;
};

const renderWorkflowPlan = (/** @type {WorkflowCliPlan} */ plan) => plan.operations.length === 0
    ? ['No workflow updates needed.']
    : plan.operations.map(operation => `${escapeText(operation.action)} ${escapeText(operation.path)}`);

const renderPostInitHandoff = (/** @type {{checklist?: string[], gaps?: string[]} | null | undefined} */ handoff) => {
    const checklist = handoff?.checklist !== undefined && handoff.checklist.length > 0 ? handoff.checklist : ['workflow checklist unavailable'];
    const gaps = handoff?.gaps !== undefined && handoff.gaps.length > 0 ? handoff.gaps : ['none'];
    return [
        '----- BEGIN POST-INIT HANDOFF -----',
        'Post-init Handoff',
        '',
        'Readiness audit required:',
        ...checklist.map(item => `- ${item}`),
        '',
        'Engine-observed gaps:',
        ...gaps.map(item => `- ${item}`),
        '',
        'Issue rule:',
        'Create no issue when the complete audit has no gaps; otherwise create exactly one consolidated Repository workflow completion issue before ordinary implementation.',
        '',
        'Status rule:',
        'Use Status: needs-info while any Human filename choice is missing; use Status: ready-for-agent only after every choice and blocker is resolved.',
        '----- END POST-INIT HANDOFF -----',
    ].join('\n');
};

/** @returns {WorkflowDiagnostic} */
const readWorkflowDiagnostic = (/** @type {unknown} */ value) => {
    if (!isJsonObject(value) || typeof value.code !== 'string') throw new Error('Workflow returned an invalid diagnostic.');
    return {
        code: value.code,
        ...(typeof value.phase === 'number' ? {phase: value.phase} : {}),
        ...(typeof value.path === 'string' ? {path: value.path} : {}),
        ...(typeof value.locator === 'string' ? {locator: value.locator} : {}),
        ...(typeof value.platform === 'string' ? {platform: value.platform} : {}),
        ...(typeof value.message === 'string' ? {message: value.message} : {}),
    };
};

/** @returns {WorkflowCliPlan | null} */
const readWorkflowPlan = (/** @type {unknown} */ value) => {
    if (value === null || value === undefined) return null;
    if (!isJsonObject(value) || typeof value.canonical !== 'string' || !Array.isArray(value.operations)) {
        throw new Error('Workflow returned an invalid plan.');
    }
    const operations = value.operations.map(operation => {
        if (!isJsonObject(operation) || typeof operation.action !== 'string' || typeof operation.path !== 'string') {
            throw new Error('Workflow returned an invalid plan operation.');
        }
        return {action: operation.action, path: operation.path};
    });
    return {canonical: value.canonical, operations};
};

/** @returns {{checklist: string[], gaps: string[]} | undefined} */
const readWorkflowHandoff = (/** @type {unknown} */ value) => {
    if (value === undefined) return undefined;
    if (!isJsonObject(value) || !Array.isArray(value.checklist) || !value.checklist.every(item => typeof item === 'string')
        || !Array.isArray(value.gaps) || !value.gaps.every(item => typeof item === 'string')) {
        throw new Error('Workflow returned an invalid post-init handoff.');
    }
    return {checklist: value.checklist, gaps: value.gaps};
};

/** @returns {WorkflowCliResult} */
const readWorkflowResult = (/** @type {unknown} */ value) => {
    if (!isJsonObject(value) || !Array.isArray(value.diagnostics)) throw new Error('Workflow returned an invalid result.');
    const handoff = readWorkflowHandoff(value.handoff);
    return {
        diagnostics: value.diagnostics.map(readWorkflowDiagnostic),
        plan: readWorkflowPlan(value.plan),
        ...(typeof value.applied === 'boolean' ? {applied: value.applied} : {}),
        ...(typeof value.cancelled === 'boolean' ? {cancelled: value.cancelled} : {}),
        ...(typeof value.satisfied === 'boolean' ? {satisfied: value.satisfied} : {}),
        ...(typeof value.verified === 'boolean' ? {verified: value.verified} : {}),
        ...(handoff === undefined ? {} : {handoff}),
        ...(Array.isArray(value.migratedRuleDocuments) ? {migratedRuleDocuments: value.migratedRuleDocuments.map(String)} : {}),
    };
};

const runWorkflowCommand = async (/** @type {WorkflowCommand} */ command, /** @type {Repository} */ repository, /** @type {string} */ programDirectory, /** @type {Writer} */ stdout, /** @type {Writer} */ stderr, /** @type {RunArwOptions} */ options) => {
    const workflowOptions = command.options;
    /** @type {NonNullable<Parameters<typeof runRepositoryWorkflow>[0]['choices']>} */
    let choices;
    if (command.nonInteractive || workflowOptions.has('--dry-run')) {
        choices = {mode: 'non-interactive'};
        if (command.operation === 'init' && workflowOptions.has('--reuse-profile')) choices = {...choices, reuseProfile: true};
        if (command.operation === 'init' && ['--platform', '--domain-layout', '--code-map-root', '--code-map-include', '--code-map-exclude'].some(name => workflowOptions.has(name))) {
            choices = {...choices, ...parseProfileChoices(workflowOptions)};
        }
        if (command.operation === 'remove') choices = {...choices, removal: parseRemovalChoices(workflowOptions)};
    } else {
        choices = {mode: 'interactive'};
    }
    const transformExistingAgentDocs = workflowOptions.has('--transform-existing-agent-docs')
        ? parseBooleanOption(workflowOptions, '--transform-existing-agent-docs')
        : undefined;
    let updatePlanShown = false;
    const result = readWorkflowResult(await runRepositoryWorkflow({
        choices,
        distributionDirectory: join(programDirectory, 'distribution'),
        dryRun: workflowOptions.has('--dry-run'),
        operation: command.operation,
        orphanCodeMapReadmes: workflowOptions.has('--orphan-code-map-readmes')
            ? parseOrphanCodeMapChoice(workflowOptions)
            : undefined,
        prompt: options.prompt,
        repositoryRoot: repository.root,
        ...(transformExistingAgentDocs === undefined ? {} : {transformExistingAgentDocs}),
        ...(command.nonInteractive || workflowOptions.has('--dry-run') || command.operation === 'init' ? {} : {
            showPlan: (/** @type {unknown} */ value) => {
                const plan = readWorkflowPlan(value);
                if (plan === null) throw new Error('Workflow returned no plan.');
                if (command.operation === 'update') {
                    renderWorkflowPlan(plan).forEach(stdout);
                    updatePlanShown = true;
                } else {
                    stdout(plan.canonical.trimEnd());
                }
            },
        }),
        ...(command.operation === 'remove' ? {showRemovalPreview: (/** @type {unknown} */ preview) => stdout(JSON.stringify(preview, null, 2))} : {}),
        ...(options.workflowDependencies ?? {}),
    }));
    if (result.diagnostics?.length > 0) {
        if (command.operation === 'update'
            && result.plan !== null
            && result.plan.operations.length > 0
            && (workflowOptions.has('--dry-run') || (!command.nonInteractive && !updatePlanShown))) {
            renderWorkflowPlan(result.plan).forEach(stdout);
        }
        result.diagnostics.forEach(diagnostic => stderr(renderWorkflowDiagnostic(diagnostic)));
        const usageCodes = new Set(['inapplicable-choice', 'inapplicable-removal-choice', 'invalid-conditional-choice', 'invalid-final-confirmation', 'invalid-orphan-code-map-choice', 'invalid-removal-choice']);
        return result.diagnostics.some((/** @type {{ code: string; }} */ diagnostic) => usageCodes.has(diagnostic.code)) ? 2 : 1;
    }
    if (result.cancelled) {
        stdout('Cancelled.');
        return 0;
    }
    if (command.operation === 'verify') {
        stdout(result.satisfied ? 'Workflow verification passed.' : 'Workflow verification reported findings.');
        return result.satisfied ? 0 : 1;
    }
    if (workflowOptions.has('--dry-run')) {
        if (result.plan === null) throw new Error('Workflow dry-run returned no plan.');
        renderWorkflowPlan(result.plan).forEach(stdout);
        return result.verified === false ? 1 : 0;
    }
    if (!result.applied || result.verified === false) return 1;
    if (command.operation === 'update' && !command.nonInteractive && result.plan?.operations.length === 0) return 0;
    stdout(result.plan?.operations.length === 0 ? 'No changes.' : `Workflow ${command.operation} completed.`);
    if (result.migratedRuleDocuments !== undefined) {
        stdout('');
        stdout('Repository-owned content of these removed rule documents was moved into the repository-owned region of AGENTS.md; review it there:');
        result.migratedRuleDocuments.forEach(path => stdout(`- ${escapeText(path)}`));
    }
    if (command.operation === 'init') {
        stdout('');
        stdout('Copy the following block and send it to your Agent.');
        stdout('');
        stdout(renderPostInitHandoff(result.handoff));
    }
    return 0;
};

const runCodeMapCommand = async (/** @type {Repository} */ repository, /** @type {Writer} */ stdout, /** @type {Writer} */ stderr, /** @type {RunArwOptions} */ options) => {
    const result = await runCodeMapVerification({
        repositoryRoot: repository.root,
        ...(options.codeMapDependencies ?? {}),
    });
    result.diagnostics.forEach(entry => stderr(renderWorkflowDiagnostic(entry)));
    if (!result.satisfied) return 1;
    stdout(`Code Map verification passed. Required maps: ${result.requiredDirectories.length}.`);
    return 0;
};

const renderTextDiagnostic = (/** @type {TextPolicyDiagnostic} */ diagnostic, /** @type {TextPolicyResult} */ result) => {
    if (diagnostic.code === 'text-fix-partial' && 'cause' in diagnostic && 'remediation' in diagnostic) {
        return `[${diagnostic.code}] ${escapeText(diagnostic.path)}: ${diagnostic.cause}. Changed: ${result.changed.map(escapeText).join(', ') || 'none'}. Unchanged: ${result.unchanged.map(escapeText).join(', ') || 'none'}. ${diagnostic.remediation}`;
    }
    return `[${diagnostic.code}] ${escapeText(diagnostic.path)}: ${'issues' in diagnostic ? diagnostic.issues.join(', ') : 'operation failed'}.`;
};

const runTextCommand = async (/** @type {{intent: 'check' | 'fix'}} */ command, /** @type {Repository} */ repository, /** @type {Writer} */ stdout, /** @type {Writer} */ stderr, /** @type {RunArwOptions} */ options) => {
    const result = await runTextPolicy({
        intent: command.intent,
        repositoryRoot: repository.root,
        ...(options.textPolicyDependencies ?? {}),
    });
    if (!result.satisfied) {
        result.diagnostics.forEach(diagnostic => stderr(renderTextDiagnostic(diagnostic, result)));
        return 1;
    }
    const counts = `Checked ${result.checked} text file(s); skipped ${result.skippedBinary} binary file(s).`;
    if (command.intent === 'check') stdout(`Text check passed. ${counts}`);
    else if (result.changed.length === 0) stdout(`Text fix passed. No changes. ${counts}`);
    else stdout(`Text fix completed. Changed: ${result.changed.map(escapeText).join(', ')}. ${counts}`);
    return 0;
};

const documentTermsSummary = (/** @type {{documents: number, globalTerms: number, localTerms: number, uses: number}} */ summary) => (
    `Documents: ${summary.documents}; global terms: ${summary.globalTerms}; `
    + `local terms: ${summary.localTerms}; uses: ${summary.uses}.`
);

const runTermsCommand = async (/** @type {{include: string[], verbose: boolean, languageThresholds: import('./arw-common/language-checks.mjs').LanguageThreshold[], mode: 'immediate' | 'release'}} */ command, /** @type {Repository} */ repository, /** @type {Writer} */ stdout, /** @type {Writer} */ stderr, /** @type {RunArwOptions} */ options) => {
    const check = options.documentTermsDependencies?.check ?? checkDocumentTerms;
    const result = await check({
        repositoryRoot: repository.root,
        request: {
            ...(command.include.length === 0 ? {} : {include: [...command.include]}),
            ...(command.languageThresholds.length === 0 ? {} : {languageThresholds: command.languageThresholds}),
            mode: command.mode,
            source: {kind: 'working-tree'},
        },
    }).catch(error => {
        if (error instanceof TypeError && error.message.startsWith('Invalid language threshold override:')) throw new UsageError(`${usage()}\n${error.message}`);
        throw error;
    });
    for (const diagnostic of result.diagnostics) {
        stderr(serializeDocumentTermsDiagnostic(diagnostic).trimEnd());
    }
    const multipleContexts = result.contexts.length > 1;
    let wroteSummary = false;
    for (const context of result.contexts) {
        if (multipleContexts) {
            const prefix = context.status === 'passed'
                ? `Document terms check passed. Context: ${JSON.stringify(context.context)}; `
                : `Document terms check failed. Context: ${JSON.stringify(context.context)}; Diagnostics: ${context.summary.diagnostics}; `;
            stdout(`${prefix}${documentTermsSummary(context.summary)}`);
            wroteSummary = true;
        } else if (context.status === 'passed') {
            stdout(`Document terms check passed. ${documentTermsSummary(context.summary)}`);
            wroteSummary = true;
        }
        for (const diagnostic of context.diagnostics) {
            stderr(serializeDocumentTermsDiagnostic(diagnostic, multipleContexts ? context.context : null).trimEnd());
        }
    }
    if (wroteSummary) stdout('');
    stdout(renderLanguageChecks(result, {verbose: command.verbose}));
    return result.status === 'passed' ? 0 : 1;
};

const runLanguageInspectCommand = async (/** @type {{paths: string[]}} */ command, /** @type {Repository} */ repository, /** @type {Writer} */ stdout, /** @type {Writer} */ stderr, /** @type {RunArwOptions} */ options) => {
    const inspect = options.documentLanguageDependencies?.inspect ?? inspectDocumentLanguages;
    const result = await inspect({paths: command.paths, repositoryRoot: repository.root});
    for (const diagnostic of result.diagnostics) {
        stderr(`[${diagnostic.code}] ${escapeText(diagnostic.path)}: ${diagnostic.message}`);
    }
    if (result.status !== 'passed') return 1;
    stdout(renderLanguageCompositionTable(result.rows));
    return 0;
};

export const runArw = async (/** @type {string[]} */ args, /** @type {RunArwOptions} */ options = {}) => {
    const stdout = options.stdout ?? defaultWriter(process.stdout);
    const rawStdout = options.rawStdout ?? options.stdout ?? ((/** @type {string | Uint8Array<ArrayBufferLike>} */ message) => process.stdout.write(message));
    const stderr = options.stderr ?? defaultWriter(process.stderr);
    const cwd = options.cwd ?? process.cwd();
    const programDirectory = options.programDirectory ?? PROGRAM_DIRECTORY;

    try {
        if (args.length === 1 && args[0] === '--version') {
            stdout(ARW_VERSION);
            return 0;
        }

        const config = await loadConfig(programDirectory);
        const command = parseCommand(args);
        if (command.kind === 'list-background-agents') {
            const {listBackgroundAgents} = await import('./arw-background-agent-host.mjs');
            const rows = options.backgroundAgentList
                ? await options.backgroundAgentList()
                : await listBackgroundAgents({programDirectory, configuration: config});
            if (rows === null) {
                stdout('The manager process is not running; there are no managed background Agents.');
                return 0;
            }
            stdout(renderBackgroundAgents(rows));
            return 0;
        }
        const repository = await discoverRepository(cwd);

        if (command.kind === 'background-agent') {
            const {runBackgroundAgentMachine} = await import('./arw-background-agent-host.mjs');
            return await runBackgroundAgentMachine({
                ...options.backgroundAgentDependencies,
                hostRepositoryRoot: repository.root,
                programDirectory,
                configuration: config,
                platformAdapter: options.backgroundAgentDependencies?.platformAdapter ?? createCurrentPlatformAdapter(),
            });
        }

        if (command.kind === 'agent-start') {
            if (!Object.hasOwn(config.agents, command.name)) throw new Error(`Agent configuration not found: ${escapeText(command.name)}.`);
            const result = await launchAgentCli(
                config.agents[command.name],
                cwd,
                options.spawnProcess ?? spawnProcess,
                command.agentArguments,
            );
            if (result.kind === 'exited') return result.exitCode;
            stderr(result.reason === 'spawn-failed'
                ? 'Agent CLI command could not be started.'
                : 'Agent CLI exited without a numeric exit code.');
            return 1;
        }

        if (command.kind === 'list-artifacts') {
            return await runListArtifacts(command, repository, stdout, stderr, options.artifactInventoryFilesystem);
        }

        if (command.kind === 'jira-list' || command.kind === 'jira-open' || command.kind === 'jira-print' || command.kind === 'jira-sync' || command.kind === 'submodule-switch-branch' || command.kind === 'module-check-correction' || command.kind === 'application-sync' || command.kind === 'application-associate') {
            return await runApplicationJiraCommand({
                command,
                dependencies: options.applicationJiraDependencies,
                globalConfig: config,
                rawStdout,
                repositoryRoot: repository.root,
                stderr,
                stdout,
            });
        }

        if (command.kind === 'migrate-artifacts') {
            return await runArtifactMigration(repository, stdout, stderr, options.updateFileSystem, options.artifactInventoryFilesystem, options.artifactMigrationGit);
        }

        if (command.kind === 'spec-readiness-prepare') {
            const created = await createScopedFilesystem({root: repository.root});
            if (created.status !== 'succeeded') throw new Error('The Repository filesystem could not be opened.');
            const parsedInput = command.inputPath
                ? await parseJson({
                    filesystem: created.scopedFilesystem,
                    path: repositoryInputPath(created.scopedFilesystem, repository.root, command.inputPath).relativePath,
                })
                : await parseJson({text: options.stdin ?? await readStandardInput()});
            if (parsedInput.status !== 'succeeded'
                || !('value' in parsedInput)
                || parsedInput.value === null
                || typeof parsedInput.value !== 'object'
                || Array.isArray(parsedInput.value)) {
                const source = command.inputPath ? 'input file' : 'stdin';
                throw new Error(`Spec Readiness ${source} must be a JSON object.`);
            }
            const input = parsedInput.value;
            const dependencies = options.specReadinessDependencies ?? {};
            const result = await prepareSpecReadiness({
                input,
                issueId: command.issueId,
                repositoryRoot: repository.root,
                ...dependencies,
            });
            rawStdout(result.path);
            return 0;
        }

        if (command.kind === 'spec-readiness-generate') {
            const dependencies = options.specReadinessDependencies ?? {};
            const created = await createScopedFilesystem({root: repository.root});
            if (created.status !== 'succeeded') throw new Error('The Repository filesystem could not be opened.');
            const result = await generateSpecReadiness({
                inputPath: repositoryInputPath(created.scopedFilesystem, repository.root, command.inputPath).absolutePath,
                issueId: command.issueId,
                repositoryRoot: repository.root,
                ...dependencies,
            });
            rawStdout(result.path);
            return 0;
        }

        if (command.kind === 'spec-readiness-promote') {
            const created = await createScopedFilesystem({root: repository.root});
            if (created.status !== 'succeeded') throw new Error('The Repository filesystem could not be opened.');
            const result = await promoteSpecReadiness({
                inputPath: repositoryInputPath(created.scopedFilesystem, repository.root, command.inputPath).absolutePath,
                repositoryRoot: repository.root,
                ...(options.specReadinessDependencies ?? {}),
            });
            const written = resolveAbsolutePathWithinScope({path: result.path, scope: repository.root});
            if (written.status !== 'succeeded') throw new Error('Spec Readiness result path escapes the Repository.');
            stdout(`Wrote ${written.relativePath.split(sep).join('/')} with result: ${result.result}.`);
            return 0;
        }

        if (command.kind === 'spec-readiness-verify') {
            const result = await verifySpecReadiness({issueId: command.issueId, repositoryRoot: repository.root});
            if (!result.authorized) {
                result.findings.forEach(stderr);
                return 1;
            }
            stdout(`Spec Readiness satisfied for ${command.issueId}.`);
            return 0;
        }

        if (command.kind === 'commit-audit-prepare') {
            const result = await prepareCommitAudit({inputPath: command.inputPath, repositoryRoot: repository.root});
            rawStdout(result.requestPath);
            return 0;
        }

        if (command.kind === 'commit-audit-verify') {
            const result = await verifyCommitAudit({repositoryRoot: repository.root});
            rawStdout(JSON.stringify(result, null, 2));
            return result.errors.length === 0 ? 0 : 1;
        }

        if (command.kind?.startsWith('workflow-')) {
            return await runWorkflowCommand(command, repository, programDirectory, stdout, stderr, options);
        }

        if (command.kind === 'code-map-verify') {
            return await runCodeMapCommand(repository, stdout, stderr, options);
        }

        if (command.kind === 'text-policy') {
            return await runTextCommand(command, repository, stdout, stderr, options);
        }

        if (command.kind === 'terms-check') {
            return await runTermsCommand(command, repository, stdout, stderr, options);
        }

        if (command.kind === 'language-inspect') {
            return await runLanguageInspectCommand(command, repository, stdout, stderr, options);
        }

        if (command.kind === 'print-artifact') {
            return await runPrintArtifact(command, repository, rawStdout, stderr, options.artifactInventoryFilesystem);
        }

        if (command.kind === 'open-artifact') {
            return await runOpenArtifact(command, repository, config, stdout, stderr, options.spawnProcess ?? spawnProcess, options.artifactInventoryFilesystem);
        }

        throw new Error('Unsupported parsed command.');
    } catch (error) {
        stderr(error instanceof Error ? error.message : String(error));
        return error instanceof UsageError ? error.exitCode : 1;
    }
};
