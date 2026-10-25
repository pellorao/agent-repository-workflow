/** @typedef {{code: string, message: string}} Diagnostic */
/** @typedef {{diagnostics: Diagnostic[], status: 'blocked'} | {diagnostics: Diagnostic[], stage: string, status: 'failed'} | {diagnostics: [], metadata?: {status: number}, status: 'succeeded', value: unknown}} RequestResult */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = (/** @type {string} */ message) => ({diagnostics: [{code: 'jira-response-invalid', message}], stage: /** @type {'response'} */ ('response'), status: /** @type {'failed'} */ ('failed')});

/** @param {{baseUrl: string, request: (input: {baseUrl: string, body?: unknown, method: 'GET' | 'POST', query?: Record<string, string>, relativeEndpoint: string}) => Promise<RequestResult>}} dependencies */
export const createJiraConvergenceAdapter = dependencies => {
    if (!isRecord(dependencies) || typeof dependencies.baseUrl !== 'string' || typeof dependencies.request !== 'function') {
        throw new TypeError('JIRA Convergence Adapter dependencies are invalid.');
    }
    const endpoint = (/** @type {string} */ issueKey, /** @type {string} */ suffix = '') => `rest/api/2/issue/${encodeURIComponent(issueKey)}${suffix}`;
    return Object.freeze({
        async readIssue(/** @type {{issueKey: string}} */ input) {
            const response = await dependencies.request({baseUrl: dependencies.baseUrl, method: 'GET', query: {fields: 'project,issuetype,status'}, relativeEndpoint: endpoint(input.issueKey)});
            if (response.status !== 'succeeded') return response;
            if (!isRecord(response.value) || !isRecord(response.value.fields)) return invalid('JIRA returned invalid issue policy fields.');
            const {fields} = response.value;
            if (!isRecord(fields.project) || typeof fields.project.key !== 'string'
                || !isRecord(fields.issuetype) || typeof fields.issuetype.name !== 'string'
                || !isRecord(fields.status) || typeof fields.status.name !== 'string') return invalid('JIRA returned invalid issue policy fields.');
            return {diagnostics: [], issue: {issueType: fields.issuetype.name, projectKey: fields.project.key, status: fields.status.name}, status: /** @type {'succeeded'} */ ('succeeded')};
        },
        async findComment(/** @type {{body: string, issueKey: string}} */ input) {
            let startAt = 0;
            let total;
            while (true) {
                const response = await dependencies.request({
                    baseUrl: dependencies.baseUrl,
                    method: 'GET',
                    query: {maxResults: '10', orderBy: '-created', startAt: String(startAt)},
                    relativeEndpoint: endpoint(input.issueKey, '/comment'),
                });
                if (response.status !== 'succeeded') return response;
                if (!isRecord(response.value)
                    || !Array.isArray(response.value.comments)
                    || typeof response.value.total !== 'number'
                    || !Number.isSafeInteger(response.value.total)
                    || response.value.total < 0
                    || typeof response.value.startAt !== 'number'
                    || !Number.isSafeInteger(response.value.startAt)
                    || response.value.startAt !== startAt
                    || total !== undefined && response.value.total !== total
                    || response.value.comments.length > 10
                    || !response.value.comments.every(comment => isRecord(comment) && typeof comment.body === 'string')
                    || startAt > response.value.total
                    || startAt + response.value.comments.length > response.value.total
                    || (startAt < response.value.total && response.value.comments.length === 0)) return invalid('JIRA returned an invalid comment page.');
                total = response.value.total;
                if (response.value.comments.some(comment => comment.body === input.body)) {
                    return {diagnostics: [], found: true, status: /** @type {'succeeded'} */ ('succeeded')};
                }
                if (response.value.comments.length === 0 || startAt + response.value.comments.length >= response.value.total) {
                    return {diagnostics: [], found: false, status: /** @type {'succeeded'} */ ('succeeded')};
                }
                startAt += response.value.comments.length;
            }
        },
        async readTransitions(/** @type {{issueKey: string}} */ input) {
            const response = await dependencies.request({baseUrl: dependencies.baseUrl, method: 'GET', relativeEndpoint: endpoint(input.issueKey, '/transitions')});
            if (response.status !== 'succeeded') return response;
            if (!isRecord(response.value) || !Array.isArray(response.value.transitions)) return invalid('JIRA returned invalid transitions.');
            const transitions = response.value.transitions.map(transition => isRecord(transition) && typeof transition.id === 'string' && isRecord(transition.to) && typeof transition.to.name === 'string'
                ? {id: transition.id, status: transition.to.name}
                : null);
            if (transitions.some(transition => transition === null)) return invalid('JIRA returned invalid transitions.');
            return {diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded'), transitions: /** @type {Array<{id: string, status: string}>} */ (transitions)};
        },
        async createComment(/** @type {{body: string, issueKey: string}} */ input) {
            const response = await dependencies.request({baseUrl: dependencies.baseUrl, body: {body: input.body}, method: 'POST', relativeEndpoint: endpoint(input.issueKey, '/comment')});
            return response.status === 'succeeded' ? {diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded')} : response;
        },
        async transition(/** @type {{issueKey: string, transitionId: string}} */ input) {
            const response = await dependencies.request({baseUrl: dependencies.baseUrl, body: {transition: {id: input.transitionId}}, method: 'POST', relativeEndpoint: endpoint(input.issueKey, '/transitions')});
            return response.status === 'succeeded' ? {diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded')} : response;
        },
    });
};
