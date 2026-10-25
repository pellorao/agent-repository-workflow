const TERMINAL = new Set(['completed', 'wontfix']);

/** @param {string} specText */
const readJiraKey = specText => {
    const lines = specText.replace(/\r\n?/gu, '\n').split('\n');
    const heading = lines.findIndex(line => /^# \S/u.test(line));
    if (heading < 0) return null;
    const metadata = lines.slice(heading + 1).find(line => line.length > 0);
    const match = /^JIRA issue: \[`(?<key>[^`\r\n]+)`\]\((?<url>https?:\/\/[^\s)]+)\)$/u.exec(metadata ?? '');
    return match?.groups === undefined ? null : {key: match.groups.key, url: match.groups.url};
};

/**
 * @param {{issues: Array<{association?: unknown, blockers: Array<{number: string}>, id: string, kind: string, number: string, status: string}>, jiraBaseUrl: string, phase: 'accepted' | 'completed', applicationName: string, specId: string, specText: string}} input
 */
export const evaluateApplicationCompletion = input => {
    const jira = readJiraKey(input.specText);
    let expectedJiraUrl = null;
    try {
        expectedJiraUrl = jira === null ? null : new URL(`browse/${encodeURIComponent(jira.key)}`, input.jiraBaseUrl).href;
    } catch {
        expectedJiraUrl = null;
    }
    if (jira === null
        || jira.key.length === 0
        || jira.key.trim() !== jira.key
        || /[\u0000-\u001f\u007f-\u009f]/u.test(jira.key)
        || jira.url !== expectedJiraUrl) {
        return {diagnostics: [{code: 'application-spec-jira-metadata-invalid', message: 'Committed Application spec has invalid JIRA issue metadata.'}], status: /** @type {'blocked'} */ ('blocked')};
    }
    if (input.phase === 'accepted') {
        return {diagnostics: [], eligible: true, jiraKey: jira.key, applicationName: input.applicationName, specId: input.specId, status: /** @type {'succeeded'} */ ('succeeded')};
    }
    const declarations = [...input.specText.matchAll(/^Application validation issue: (?<number>\d{2})$/gmu)];
    if (declarations.length !== 1 || declarations[0].groups?.number === undefined) {
        return {diagnostics: [{code: 'application-validation-declaration-invalid', message: 'Committed Application spec must declare exactly one Application validation issue.'}], status: /** @type {'blocked'} */ ('blocked')};
    }
    const validationNumber = declarations[0].groups.number;
    const validationIssues = input.issues.filter(issue => issue.number === validationNumber);
    if (validationIssues.length !== 1) {
        return {diagnostics: [{code: 'application-validation-issue-invalid', message: 'Application validation issue does not resolve exactly once.'}], status: /** @type {'blocked'} */ ('blocked')};
    }
    const validation = validationIssues[0];
    const otherIssues = input.issues.filter(issue => issue !== validation);
    const expectedBlockers = otherIssues.map(issue => issue.number).sort();
    const actualBlockers = validation.blockers.map(blocker => blocker.number).sort();
    const eligible = input.issues.length > 0
        && validation.kind === 'implementation'
        && validation.association === undefined
        && validation.status === 'completed'
        && otherIssues.every(issue => TERMINAL.has(issue.status))
        && expectedBlockers.length === actualBlockers.length
        && expectedBlockers.every((number, index) => number === actualBlockers[index]);
    return {diagnostics: [], eligible, jiraKey: jira.key, applicationName: input.applicationName, specId: input.specId, status: /** @type {'succeeded'} */ ('succeeded')};
};
