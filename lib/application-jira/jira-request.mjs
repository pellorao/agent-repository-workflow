import {request as requestHttp} from 'node:http';
import {request as requestHttps} from 'node:https';
import {isJsonObject} from '../common/json.mjs';

const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** @typedef {{code: string, message: string}} Diagnostic */
/** @typedef {{baseUrl: string, body?: unknown, method: 'GET' | 'POST', query?: Record<string, string>, relativeEndpoint: string}} JiraRequestInput */
/** @typedef {{diagnostics: Diagnostic[], stage: 'request' | 'response', status: 'failed'} | {diagnostics: [], metadata: {status: number}, status: 'succeeded', value: unknown}} JiraRequestResult */

/** @param {string} method @param {string} endpoint @param {number | null} status @param {string} reason @returns {JiraRequestResult} */
const requestFailure = (method, endpoint, status, reason) => ({
    diagnostics: [{
        code: 'jira-request-failed',
        message: `JIRA ${method} ${endpoint}${status === null ? '' : ` returned HTTP ${status}`}: ${reason}`,
    }],
    stage: 'request',
    status: 'failed',
});

/** @param {string} endpoint @param {string} reason @returns {JiraRequestResult} */
const responseFailure = (endpoint, reason) => ({
    diagnostics: [{code: 'jira-response-failed', message: `JIRA response for ${endpoint} ${reason}.`}],
    stage: 'response',
    status: 'failed',
});

/** @param {unknown} value */
const jiraErrorText = (/** @type {unknown} */ value, /** @type {string} */ token) => {
    if (!isJsonObject(value)) return 'request failed';
    const messages = Array.isArray(value.errorMessages)
        ? value.errorMessages.filter(entry => typeof entry === 'string' && entry.length > 0)
        : [];
    const fieldMessages = isJsonObject(value.errors)
        ? Object.entries(value.errors)
            .filter(([, message]) => typeof message === 'string' && message.length > 0)
            .sort(([left], [right]) => left.localeCompare(right, 'en'))
            .map(([field, message]) => `${field}: ${message}`)
        : [];
    return ([...messages, ...fieldMessages].join('; ') || 'request failed').replaceAll(token, '[redacted]');
};

/** @param {unknown} input @returns {{baseUrl: URL, body: unknown, method: 'GET' | 'POST', query: Record<string, string> | undefined, relativeEndpoint: string}} */
const validateRequestInput = input => {
    if (!isJsonObject(input)
        || typeof input.baseUrl !== 'string'
        || !['GET', 'POST'].includes(/** @type {string} */ (input.method))
        || typeof input.relativeEndpoint !== 'string'
        || input.relativeEndpoint.length === 0
        || input.relativeEndpoint.startsWith('/')
        || input.relativeEndpoint.includes('\\')
        || input.relativeEndpoint.includes('?')
        || input.relativeEndpoint.includes('#')
        || input.relativeEndpoint.split('/').some(segment => segment === '.' || segment === '..')
        || input.query !== undefined && (!isJsonObject(input.query) || Object.values(input.query).some(value => typeof value !== 'string'))) {
        throw new TypeError('JIRA Request input is invalid.');
    }
    const baseUrl = new URL(input.baseUrl);
    if (!['http:', 'https:'].includes(baseUrl.protocol)
        || baseUrl.username.length > 0
        || baseUrl.password.length > 0
        || baseUrl.search.length > 0
        || baseUrl.hash.length > 0
        || !baseUrl.pathname.endsWith('/')) {
        throw new TypeError('JIRA Request baseUrl must be a normalized HTTP or HTTPS URL.');
    }
    return {
        baseUrl,
        body: input.body,
        method: /** @type {'GET' | 'POST'} */ (input.method),
        query: /** @type {Record<string, string> | undefined} */ (input.query),
        relativeEndpoint: input.relativeEndpoint,
    };
};

/**
 * @param {{token: string}} dependencies
 * @returns {(input: JiraRequestInput) => Promise<JiraRequestResult>}
 */
export const createJiraHttpRequest = dependencies => {
    if (!isJsonObject(dependencies)
        || typeof dependencies.token !== 'string'
        || dependencies.token.length === 0
        || dependencies.token.trim() !== dependencies.token
        || /[\u0000-\u001f\u007f-\u009f]/u.test(dependencies.token)) {
        throw new TypeError('JIRA HTTP request requires a non-empty token without control characters.');
    }
    const token = dependencies.token;
    return async (/** @type {JiraRequestInput} */ input) => {
        const requestInput = validateRequestInput(input);
        const url = new URL(requestInput.relativeEndpoint, requestInput.baseUrl);
        for (const [name, value] of Object.entries(requestInput.query ?? {})) url.searchParams.append(name, value);
        const body = requestInput.body === undefined ? null : Buffer.from(JSON.stringify(requestInput.body), 'utf8');
        const transport = url.protocol === 'https:' ? requestHttps : requestHttp;

        return await new Promise((/** @type {(value: JiraRequestResult) => void} */ resolvePromise) => {
            let settled = false;
            const finish = (/** @type {JiraRequestResult} */ result) => {
                if (settled) return;
                settled = true;
                resolvePromise(result);
            };
            const request = transport(url, {
                headers: {
                    accept: 'application/json',
                    authorization: `Bearer ${token}`,
                    ...(body === null ? {} : {
                        'content-length': String(body.length),
                        'content-type': 'application/json',
                    }),
                },
                method: requestInput.method,
            }, response => {
                /** @type {Buffer[]} */
                const chunks = [];
                let byteCount = 0;
                response.on('data', chunk => {
                    byteCount += chunk.length;
                    if (byteCount > MAX_RESPONSE_BYTES) {
                        request.destroy();
                        finish(responseFailure(requestInput.relativeEndpoint, 'exceeded the safe size limit'));
                        return;
                    }
                    chunks.push(chunk);
                });
                response.once('error', () => finish(responseFailure(requestInput.relativeEndpoint, 'could not be read')));
                response.once('end', () => {
                    const status = response.statusCode ?? 0;
                    const text = Buffer.concat(chunks).toString('utf8');
                    let value;
                    try {
                        value = text.length === 0 ? null : JSON.parse(text);
                    } catch {
                        if (status >= 200 && status < 300) {
                            finish(responseFailure(requestInput.relativeEndpoint, 'was not valid JSON'));
                            return;
                        }
                    }
                    if (status >= 300 && status < 400) {
                        finish(requestFailure(requestInput.method, requestInput.relativeEndpoint, status, 'redirects are not allowed'));
                        return;
                    }
                    if (status < 200 || status >= 300) {
                        finish(requestFailure(requestInput.method, requestInput.relativeEndpoint, status, jiraErrorText(value, token)));
                        return;
                    }
                    finish({diagnostics: [], metadata: {status}, status: 'succeeded', value});
                });
            });
            request.setTimeout(TIMEOUT_MS, () => {
                request.destroy();
                finish(requestFailure(requestInput.method, requestInput.relativeEndpoint, null, 'request timed out'));
            });
            request.once('error', () => finish(requestFailure(requestInput.method, requestInput.relativeEndpoint, null, 'transport failed')));
            request.end(body ?? undefined);
        });
    };
};
