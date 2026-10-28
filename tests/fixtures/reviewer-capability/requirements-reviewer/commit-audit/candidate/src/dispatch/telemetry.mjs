export const publicationEvents = Object.freeze(['publication.started', 'publication.succeeded', 'publication.failed']);

export const successTelemetry = (/** @type {any} */ manifestId, /** @type {any} */ timestamp) => ({event: 'publication.succeeded', manifestId, timestamp});

export const failureTelemetry = (/** @type {any} */ manifestId, /** @type {any} */ error, /** @type {any} */ timestamp) => ({event: 'publication.failed', error: String(error), manifestId, timestamp});

export const redactManifestEvent = (/** @type {any} */ event) => ({...event, auth: stripCredentials(event.auth)});

export const redactNestedDriverToken = (/** @type {any} */ event) => ({...event, driver: {...event.driver, token: undefined}});

export const auditFieldsPresent = (/** @type {any} */ entry) => ['action', 'actor', 'timestamp'].every(field => Object.hasOwn(entry, field));

const credentialFields = new Set(['token', 'secret', 'password']);
const stripCredentials = (/** @type {any} */ value) => value?.constructor === Object ? Object.fromEntries(Object.entries(value).filter(([key]) => !credentialFields.has(key)).map(([key, item]) => [key, stripCredentials(item)])) : value;
