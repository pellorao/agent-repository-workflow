export const publicationEvents = Object.freeze(['publication.started', 'publication.succeeded', 'publication.failed']);

export const successTelemetry = (/** @type {any} */ manifestId, /** @type {any} */ timestamp) => ({event: 'publication.succeeded', manifestId, timestamp});

export const failureTelemetry = (/** @type {any} */ manifestId, /** @type {any} */ error, /** @type {any} */ timestamp) => ({event: 'publication.failed', error: String(error), manifestId, timestamp});

export const redactManifestEvent = (/** @type {any} */ event) => ({...event, auth: redactNestedDriverToken({driver: event.auth}).driver});

export const redactNestedDriverToken = (/** @type {any} */ event) => ({...event, driver: {...event.driver, token: undefined}});

export const auditFieldsPresent = (/** @type {any} */ entry) => ['action', 'actor', 'timestamp'].every(field => Object.hasOwn(entry, field));
