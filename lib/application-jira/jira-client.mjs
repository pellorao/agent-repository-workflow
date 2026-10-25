import {compareText, isJsonObject} from '../common/json.mjs';
/** @typedef {{code: string, message: string}} Diagnostic */
/** @typedef {{diagnostics: Diagnostic[], status: 'blocked'} | {diagnostics: Diagnostic[], stage: string, status: 'failed'}} JiraUnsuccessful */
/** @typedef {{diagnostics: [], metadata?: {status: number}, status: 'succeeded', value: unknown}} JiraRequestSucceeded */
/** @typedef {JiraRequestSucceeded | JiraUnsuccessful} JiraRequestResult */
/** @typedef {{diagnostics: [], entries: Array<{key: string, title: string}>, status: 'succeeded', total: number} | JiraUnsuccessful} JiraListResult */
/** @typedef {{diagnostics: [], status: 'succeeded', value: Record<string, unknown>} | JiraUnsuccessful} JiraPrintResult */

/** @param {string} value */
const quoteJqlString = value => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

/** @param {string} value */
const normalizeTitle = value => value.replace(/[\s\u0000-\u001f\u007f-\u009f]+/gu, ' ').trim();

const CORE_FIELD_IDS = new Set([
    'assignee',
    'attachment',
    'comment',
    'components',
    'created',
    'description',
    'fixVersions',
    'issuelinks',
    'issuetype',
    'labels',
    'priority',
    'project',
    'reporter',
    'status',
    'summary',
    'updated',
]);

/** @param {unknown} value */
const isEmptyFieldValue = value => value === null
    || value === ''
    || Array.isArray(value) && value.length === 0
    || isJsonObject(value) && Object.keys(value).length === 0;

/** @param {unknown} value */
const normalizeUser = value => isJsonObject(value) ? {
    key: typeof value.key === 'string' ? value.key : null,
    name: typeof value.name === 'string' ? value.name : null,
    displayName: typeof value.displayName === 'string' ? value.displayName : null,
} : null;

/** @param {unknown} value */
const namedValue = value => isJsonObject(value) && typeof value.name === 'string' ? value.name : null;

/** @param {unknown} value */
const namedArray = value => Array.isArray(value)
    ? value.flatMap(entry => isJsonObject(entry) && typeof entry.name === 'string' ? [entry.name] : []).sort(compareText)
    : [];

/** @param {unknown} value */
const stringArray = value => Array.isArray(value) ? value.filter(entry => typeof entry === 'string').sort(compareText) : [];

/** @param {string} left @param {string} right */
const compareJiraId = (left, right) => /^\d+$/u.test(left) && /^\d+$/u.test(right)
    ? BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0
    : compareText(left, right);

/** @param {unknown} value */
const normalizeComment = value => {
    if (!isJsonObject(value) || typeof value.body !== 'string' || typeof value.created !== 'string' || typeof value.id !== 'string') return null;
    return {
        author: normalizeUser(value.author),
        body: value.body,
        created: value.created,
        id: value.id,
    };
};

/** @param {unknown} value */
const normalizeAttachment = value => {
    if (!isJsonObject(value) || typeof value.id !== 'string') return null;
    return {
        id: value.id,
        filename: typeof value.filename === 'string' ? value.filename : null,
        mimeType: typeof value.mimeType === 'string' ? value.mimeType : null,
        size: typeof value.size === 'number' ? value.size : null,
        created: typeof value.created === 'string' ? value.created : null,
        author: normalizeUser(value.author),
        contentUrl: typeof value.content === 'string' ? value.content : null,
        thumbnailUrl: typeof value.thumbnail === 'string' ? value.thumbnail : null,
    };
};

/** @param {unknown} value */
const normalizeLink = value => {
    if (!isJsonObject(value) || typeof value.id !== 'string' || !isJsonObject(value.type)) return null;
    const direction = isJsonObject(value.outwardIssue) ? 'outward' : isJsonObject(value.inwardIssue) ? 'inward' : null;
    if (direction === null) return null;
    const linkedIssue = direction === 'outward' ? value.outwardIssue : value.inwardIssue;
    if (!isJsonObject(linkedIssue)) return null;
    const relationship = direction === 'outward' ? value.type.outward : value.type.inward;
    return {
        id: value.id,
        type: typeof value.type.name === 'string' ? value.type.name : null,
        direction,
        relationship: typeof relationship === 'string' ? relationship : null,
        issue: {
            key: typeof linkedIssue.key === 'string' ? linkedIssue.key : null,
            url: typeof linkedIssue.self === 'string' ? linkedIssue.self : null,
            summary: isJsonObject(linkedIssue.fields) && typeof linkedIssue.fields.summary === 'string' ? linkedIssue.fields.summary : null,
            status: isJsonObject(linkedIssue.fields) ? namedValue(linkedIssue.fields.status) : null,
        },
    };
};

/** @returns {JiraUnsuccessful} */
const invalidResponse = () => ({
    diagnostics: [{code: 'jira-response-invalid', message: 'JIRA returned an invalid issue response.'}],
    stage: 'response',
    status: 'failed',
});

/**
 * @param {{request: (input: {baseUrl: string, body?: unknown, method: 'GET' | 'POST', query?: Record<string, string>, relativeEndpoint: string}) => Promise<JiraRequestResult>}} dependencies
 */
export const createJiraClient = dependencies => {
    const request = dependencies.request;
    return Object.freeze({
        /**
         * @param {{jira: {baseUrl: string, candidateStatus: string, issueType: string, projectKey: string}, limit: number}} input
         * @returns {Promise<JiraListResult>}
         */
        listCandidates: async input => {
            const response = await request({
                baseUrl: input.jira.baseUrl,
                method: 'GET',
                query: {
                    fields: 'key,summary',
                    jql: `project = ${quoteJqlString(input.jira.projectKey)} AND issuetype = ${quoteJqlString(input.jira.issueType)} AND status = ${quoteJqlString(input.jira.candidateStatus)} ORDER BY key ASC`,
                    maxResults: String(input.limit),
                    startAt: '0',
                },
                relativeEndpoint: 'rest/api/2/search',
            });
            if (response.status !== 'succeeded') return response;
            if (!isJsonObject(response.value)
                || typeof response.value.total !== 'number'
                || !Number.isSafeInteger(response.value.total)
                || response.value.total < 0
                || !Array.isArray(response.value.issues)) {
                return {
                    diagnostics: [{code: 'jira-response-invalid', message: 'JIRA returned an invalid candidate issue response.'}],
                    stage: 'response',
                    status: 'failed',
                };
            }
            const entries = [];
            for (const issue of response.value.issues) {
                if (!isJsonObject(issue)
                    || typeof issue.key !== 'string'
                    || issue.key.length === 0
                    || !isJsonObject(issue.fields)
                    || typeof issue.fields.summary !== 'string') {
                    return {
                        diagnostics: [{code: 'jira-response-invalid', message: 'JIRA returned an invalid candidate issue response.'}],
                        stage: 'response',
                        status: 'failed',
                    };
                }
                entries.push({key: issue.key, title: normalizeTitle(issue.fields.summary)});
            }
            return {
                diagnostics: [],
                entries,
                status: 'succeeded',
                total: response.value.total,
            };
        },
        /**
         * @param {{baseUrl: string, issueKey: string}} input
         * @returns {Promise<JiraPrintResult>}
         */
        printIssue: async input => {
            const encodedKey = encodeURIComponent(input.issueKey);
            const endpoint = `rest/api/2/issue/${encodedKey}`;
            const issueResponse = await request({
                baseUrl: input.baseUrl,
                method: 'GET',
                query: {expand: 'names,schema', fields: '*all'},
                relativeEndpoint: endpoint,
            });
            if (issueResponse.status !== 'succeeded') return issueResponse;
            if (!isJsonObject(issueResponse.value)
                || !isJsonObject(issueResponse.value.fields)
                || !isJsonObject(issueResponse.value.names)
                || !isJsonObject(issueResponse.value.schema)
                || typeof issueResponse.value.key !== 'string') return invalidResponse();
            const issue = issueResponse.value;
            const fields = /** @type {Record<string, unknown>} */ (issue.fields);
            if (fields.comment !== undefined && !isJsonObject(fields.comment)
                || fields.attachment !== undefined && !Array.isArray(fields.attachment)
                || fields.issuelinks !== undefined && !Array.isArray(fields.issuelinks)) return invalidResponse();
            const initialCommentPage = fields.comment === undefined ? {comments: [], startAt: 0, total: 0} : fields.comment;
            if (!Array.isArray(initialCommentPage.comments)
                || typeof initialCommentPage.startAt !== 'number'
                || !Number.isSafeInteger(initialCommentPage.startAt)
                || initialCommentPage.startAt !== 0
                || typeof initialCommentPage.total !== 'number'
                || !Number.isSafeInteger(initialCommentPage.total)
                || initialCommentPage.total < 0
                || initialCommentPage.comments.length > initialCommentPage.total) return invalidResponse();
            const nullableComments = initialCommentPage.comments.map(normalizeComment);
            if (nullableComments.some(comment => comment === null)) return invalidResponse();
            const comments = /** @type {Array<NonNullable<ReturnType<typeof normalizeComment>>>} */ (nullableComments);
            let obtained = initialCommentPage.startAt + comments.length;
            while (obtained < initialCommentPage.total) {
                const pageResponse = await request({
                    baseUrl: input.baseUrl,
                    method: 'GET',
                    query: {maxResults: '100', startAt: String(obtained)},
                    relativeEndpoint: `${endpoint}/comment`,
                });
                if (pageResponse.status !== 'succeeded') return pageResponse;
                if (!isJsonObject(pageResponse.value)
                    || !Array.isArray(pageResponse.value.comments)
                    || pageResponse.value.comments.length === 0
                    || typeof pageResponse.value.startAt !== 'number'
                    || !Number.isSafeInteger(pageResponse.value.startAt)
                    || pageResponse.value.startAt !== obtained
                    || typeof pageResponse.value.total !== 'number'
                    || !Number.isSafeInteger(pageResponse.value.total)
                    || pageResponse.value.total !== initialCommentPage.total
                    || pageResponse.value.startAt + pageResponse.value.comments.length > pageResponse.value.total) return invalidResponse();
                const nullablePageComments = pageResponse.value.comments.map(normalizeComment);
                if (nullablePageComments.some(comment => comment === null)) return invalidResponse();
                const pageComments = /** @type {Array<NonNullable<ReturnType<typeof normalizeComment>>>} */ (nullablePageComments);
                comments.push(...pageComments);
                obtained += pageComments.length;
                if (obtained > initialCommentPage.total) return invalidResponse();
            }
            const nullableAttachments = (fields.attachment ?? []).map(normalizeAttachment);
            const nullableLinks = (fields.issuelinks ?? []).map(normalizeLink);
            if (nullableAttachments.some(attachment => attachment === null) || nullableLinks.some(link => link === null)) return invalidResponse();
            const attachments = /** @type {Array<NonNullable<ReturnType<typeof normalizeAttachment>>>} */ (nullableAttachments);
            const links = /** @type {Array<NonNullable<ReturnType<typeof normalizeLink>>>} */ (nullableLinks);
            const names = /** @type {Record<string, unknown>} */ (issue.names);
            const schema = /** @type {Record<string, unknown>} */ (issue.schema);
            const additionalFields = Object.entries(fields)
                .filter(([id, value]) => !CORE_FIELD_IDS.has(id) && !isEmptyFieldValue(value))
                .map(([id, value]) => {
                    const fieldSchema = isJsonObject(schema[id]) ? schema[id] : null;
                    const normalizedValue = fieldSchema?.type === 'user'
                        ? Array.isArray(value) ? value.map(normalizeUser) : normalizeUser(value)
                        : value;
                    return {id, name: typeof names[id] === 'string' ? names[id] : id, value: normalizedValue};
                });
            const customFields = additionalFields.filter(entry => entry.id.startsWith('customfield_')).sort((left, right) => compareText(left.id, right.id));
            const otherFields = additionalFields.filter(entry => !entry.id.startsWith('customfield_')).sort((left, right) => compareText(left.id, right.id));
            const normalizedComments = comments
                .sort((left, right) => compareText(left.created ?? '', right.created ?? '') || compareJiraId(left.id, right.id))
                .map(({author, body, created}) => ({author, body, created}));
            links.sort((left, right) => compareText(left.issue.key ?? '', right.issue.key ?? '') || compareJiraId(left.id, right.id));
            return {
                diagnostics: [],
                status: 'succeeded',
                value: {
                    key: issue.key,
                    url: new URL(`browse/${encodedKey}`, input.baseUrl).href,
                    project: isJsonObject(fields.project) ? {
                        key: typeof fields.project.key === 'string' ? fields.project.key : null,
                        name: typeof fields.project.name === 'string' ? fields.project.name : null,
                    } : null,
                    issueType: namedValue(fields.issuetype),
                    status: namedValue(fields.status),
                    summary: typeof fields.summary === 'string' ? fields.summary : null,
                    description: typeof fields.description === 'string' ? fields.description : null,
                    priority: namedValue(fields.priority),
                    reporter: normalizeUser(fields.reporter),
                    assignee: normalizeUser(fields.assignee),
                    labels: stringArray(fields.labels),
                    components: namedArray(fields.components),
                    fixVersions: namedArray(fields.fixVersions),
                    created: typeof fields.created === 'string' ? fields.created : null,
                    updated: typeof fields.updated === 'string' ? fields.updated : null,
                    comments: normalizedComments,
                    attachments,
                    links,
                    customFields,
                    otherFields,
                },
            };
        },
    });
};
