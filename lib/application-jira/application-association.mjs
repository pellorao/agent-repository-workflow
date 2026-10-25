import {formatCanonicalArtifactId, parseCanonicalArtifactId} from '../arw-common/artifact-identity.mjs';

const NONTERMINAL_STATUSES = new Set(['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human']);

/** @typedef {{association?: {coordinate: string, kind: string}, blockerRecords?: AssociationRecord[], id: string, kind: string, number?: string, status: string, title?: string}} AssociationRecord */
/** @typedef {{path: string, record: AssociationRecord, text: string}} AssociationSnapshot */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** @param {string} coordinate */
export const parseApplicationAssociationCoordinate = coordinate => {
    try {
        const parsed = parseCanonicalArtifactId(coordinate);
        if (parsed.kind !== 'issue' || parsed.qualifier === null || parsed.issueNumber === null) return null;
        return {
            issueId: formatCanonicalArtifactId({...parsed, qualifier: null}),
            repository: parsed.qualifier,
        };
    } catch {
        return null;
    }
};

/** @param {string} issueId */
const issueIdentity = issueId => {
    try {
        const parsed = parseCanonicalArtifactId(issueId);
        return parsed.kind === 'issue' && parsed.qualifier === null && parsed.issueNumber !== null
            ? {effort: parsed.effortNumber, number: parsed.issueNumber}
            : null;
    } catch {
        return null;
    }
};

const qualifyIssueId = (/** @type {string} */ repository, /** @type {string} */ issueId) => {
    const parsed = parseCanonicalArtifactId(issueId);
    if (parsed.kind !== 'issue' || parsed.qualifier !== null || parsed.issueNumber === null) throw new Error('Issue ID must be local.');
    return formatCanonicalArtifactId({...parsed, qualifier: repository});
};

/** @param {string} text @param {string} status @param {string} association */
const insertAssociation = (text, status, association) => {
    const pattern = new RegExp(`^Status: ${status.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\r?\\n)`, 'mu');
    const matches = [...text.matchAll(new RegExp(pattern.source, 'gmu'))];
    if (matches.length !== 1) return null;
    return text.replace(pattern, `Status: ${status}$1${association}$1`);
};

/** @param {string} text @param {string[]} bullets */
const replaceBlockerSection = (text, bullets) => {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const ended = text.endsWith(eol);
    const lines = text.split(eol);
    if (ended) lines.pop();
    const headings = lines.flatMap((line, index) => line === '## Blocked by' ? [index] : []);
    if (headings.length !== 1) return null;
    const start = headings[0];
    const end = lines.findIndex((line, index) => index > start && /^## /u.test(line));
    const suffix = end < 0 ? [] : ['', ...lines.slice(end)];
    const output = [...lines.slice(0, start + 1), '', ...bullets, ...suffix].join(eol);
    return ended ? `${output}${eol}` : output;
};

/**
 * @param {{frozenModulePaths?: Record<string, string[]>, moduleIssueId: string, moduleIssues: Record<string, AssociationSnapshot[]>, moduleName: string, applicationIssueId: string, applicationIssues: AssociationSnapshot[], applicationName: string}} input
 */
export const associateApplicationIssue = input => {
    if (!isRecord(input)
        || typeof input.moduleIssueId !== 'string'
        || !isRecord(input.moduleIssues)
        || !Object.values(input.moduleIssues).every(snapshots => Array.isArray(snapshots))
        || input.frozenModulePaths !== undefined && (!isRecord(input.frozenModulePaths)
            || !Object.values(input.frozenModulePaths).every(paths => Array.isArray(paths) && paths.every(path => typeof path === 'string')))
        || typeof input.moduleName !== 'string'
        || typeof input.applicationIssueId !== 'string'
        || !Array.isArray(input.applicationIssues)
        || typeof input.applicationName !== 'string') {
        throw new TypeError('Application Association input is invalid.');
    }
    const applicationCandidates = input.applicationIssues.filter(snapshot => snapshot.record.id === input.applicationIssueId);
    const targetModuleIssues = input.moduleIssues[input.moduleName] ?? [];
    const moduleCandidates = targetModuleIssues.filter(snapshot => snapshot.record.id === input.moduleIssueId);
    if (applicationCandidates.length !== 1 || moduleCandidates.length !== 1) {
        return {diagnostics: [{code: 'association-target-missing', message: 'Association targets must each resolve to exactly one issue.'}], status: /** @type {'blocked'} */ ('blocked')};
    }
    const applicationIssue = applicationCandidates[0];
    const moduleIssue = moduleCandidates[0];
    const moduleIdentity = issueIdentity(moduleIssue.record.id);
    if (moduleIdentity === null
        || applicationIssue.record.kind !== 'implementation'
        || moduleIssue.record.kind !== 'implementation'
        || applicationIssue.record.association !== undefined
        || moduleIssue.record.association !== undefined
        || applicationIssue.record.status !== moduleIssue.record.status
        || !NONTERMINAL_STATUSES.has(applicationIssue.record.status)) {
        return {diagnostics: [{code: 'association-precondition-failed', message: 'Association requires two unassociated implementation issues with one matching non-terminal status.'}], status: /** @type {'blocked'} */ ('blocked')};
    }
    for (const existing of input.applicationIssues) {
        if (existing.record.association?.kind !== 'module-implementation') continue;
        const coordinate = parseApplicationAssociationCoordinate(existing.record.association.coordinate);
        if (coordinate?.repository !== input.moduleName) continue;
        const identity = issueIdentity(coordinate.issueId);
        if (identity !== null && identity.effort !== moduleIdentity.effort) {
            return {diagnostics: [{code: 'association-module-effort-mismatch', message: `Application effort already uses Module effort ${identity.effort} for ${input.moduleName}.`}], status: /** @type {'blocked'} */ ('blocked')};
        }
    }
    const bullets = (applicationIssue.record.blockerRecords ?? []).map(blocker => {
        const description = typeof blocker.title === 'string' && blocker.title.length > 0 ? blocker.title : blocker.id;
        if (blocker.association?.kind === 'module-implementation') {
            const coordinate = parseApplicationAssociationCoordinate(blocker.association.coordinate);
            const identity = coordinate === null ? null : issueIdentity(coordinate.issueId);
            if (coordinate?.repository === input.moduleName && identity?.effort === moduleIdentity.effort) {
                return `- ${identity.number} - ${description}`;
            }
            if (coordinate !== null) return `- External dependency: \`${blocker.association.coordinate}\` - ${description}`;
        }
        return `- External dependency: \`${qualifyIssueId(input.applicationName, blocker.id)}\` - ${description}`;
    });
    const applicationText = insertAssociation(
        applicationIssue.text,
        applicationIssue.record.status,
        `Module implementation issue: \`${qualifyIssueId(input.moduleName, moduleIssue.record.id)}\``,
    );
    const moduleAssociated = insertAssociation(
        moduleIssue.text,
        moduleIssue.record.status,
        `Application source issue: \`${qualifyIssueId(input.applicationName, applicationIssue.record.id)}\``,
    );
    const moduleText = moduleAssociated === null ? null : replaceBlockerSection(moduleAssociated, bullets.length === 0 ? ['- None - can start immediately'] : bullets);
    if (applicationText === null || moduleText === null) {
        return {diagnostics: [{code: 'association-document-invalid', message: 'Association target text does not contain canonical Status and Blocked by structure.'}], status: /** @type {'blocked'} */ ('blocked')};
    }
    const applicationAssociations = new Map(input.applicationIssues.flatMap(snapshot => {
        if (snapshot.record.id === applicationIssue.record.id) {
            return [[snapshot.record.id, {issueId: moduleIssue.record.id, repository: input.moduleName}]];
        }
        if (snapshot.record.association?.kind !== 'module-implementation') return [];
        const coordinate = parseApplicationAssociationCoordinate(snapshot.record.association.coordinate);
        return coordinate === null ? [] : [[snapshot.record.id, coordinate]];
    }));
    const normalized = [];
    const dependencyPattern = new RegExp(
        '^- External dependency: `(?<coordinate>[^`]+)` - (?<description>\\S(?:.*\\S)?)$',
        'gmu',
    );
    for (const [repository, snapshots] of Object.entries(input.moduleIssues)) {
        const frozenModulePaths = new Set(input.frozenModulePaths?.[repository] ?? []);
        for (const snapshot of snapshots) {
            if (repository === input.moduleName && snapshot.path === moduleIssue.path
                || frozenModulePaths.has(snapshot.path)
                || snapshot.record.association?.kind !== 'application-source') continue;
            const snapshotIdentity = issueIdentity(snapshot.record.id);
            if (snapshotIdentity === null) continue;
            let changed = false;
            const text = snapshot.text.replace(dependencyPattern, (match, ...args) => {
                const groups = /** @type {{coordinate?: string, description?: string} | undefined} */ (args.at(-1));
                if (groups?.coordinate === undefined || groups.description === undefined) return match;
                const applicationCoordinate = parseApplicationAssociationCoordinate(groups.coordinate);
                if (applicationCoordinate?.repository !== input.applicationName) return match;
                const association = applicationAssociations.get(applicationCoordinate.issueId);
                const identity = association === undefined ? null : issueIdentity(association.issueId);
                if (association?.repository !== repository || identity?.effort !== snapshotIdentity.effort) return match;
                changed = true;
                return `- ${identity.number} - ${groups.description}`;
            });
            if (changed) normalized.push({bytes: Buffer.from(text, 'utf8'), path: snapshot.path, repository});
        }
    }
    normalized.sort((left, right) => left.repository < right.repository ? -1 : left.repository > right.repository ? 1 : left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    return {
        diagnostics: [],
        replacements: [
            ...normalized,
            {bytes: Buffer.from(moduleText, 'utf8'), path: moduleIssue.path, repository: input.moduleName},
            {bytes: Buffer.from(applicationText, 'utf8'), path: applicationIssue.path, repository: 'application'},
        ],
        status: /** @type {'succeeded'} */ ('succeeded'),
    };
};
