import {createHash} from 'node:crypto';

const preparedTransactions = new WeakMap();
const sha256 = (/** @type {import("crypto").BinaryLike} */ bytes) => createHash('sha256').update(bytes).digest('hex');

/** @typedef {{bytes: Buffer, hash: string, kind: 'file'} | {kind: 'missing'}} FileState */
/** @typedef {{bytes: Buffer, expected: FileState, kind: 'create' | 'replace', path: string} | {expected: FileState, kind: 'delete', path: string}} FileOperation */
/** @typedef {{before: FileState, bytes: Buffer, kind: 'create' | 'replace', path: string} | {before: FileState, bytes: undefined, kind: 'delete', path: string}} PreparedOperation */
/** @typedef {{diagnostics: Array<{code: string, message: string, path?: string}>, status: 'blocked'} | {diagnostics: Array<{code: string, message: string, path?: string}>, stage: string, status: 'failed'}} TransactionUnsuccessful */
/** @typedef {TransactionUnsuccessful | {bytes?: Buffer, diagnostics: Array<{code: string, message: string, path?: string}>, entry?: {kind: string}, status: 'succeeded'}} TransactionFilesystemResult */
/** @typedef {{diagnostics: Array<{code: string, message: string, path?: string}>, status: 'blocked'} | {absolutePath: string, diagnostics: Array<{code: string, message: string, path?: string}>, relativePath: string, status: 'succeeded'}} TransactionPathResult */
/** @typedef {{inspect: (input: {path: string}) => Promise<TransactionFilesystemResult>, read: (input: {path: string}) => Promise<TransactionFilesystemResult>, remove: (input: {path: string, recursive: boolean}) => Promise<TransactionFilesystemResult>, resolve: (input: {path: string}) => TransactionPathResult, write: (input: {bytes: Buffer, mode: 'create' | 'replace', path: string}) => Promise<TransactionFilesystemResult>}} TransactionFilesystem */
/** @typedef {{diagnostics: [], preparedTransaction: object, status: 'succeeded'}} PreparedPreflight */

/** @param {string} code @param {string} message @param {string} [path] */
const diagnostic = (/** @type {string} */ code, /** @type {string} */ message, path = undefined) => ({
    code,
    message,
    ...(path === undefined ? {} : {path}),
});

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** @param {unknown} operation @param {number} index @returns {asserts operation is FileOperation} */
function assertOperation(operation, index) {
    if (!isRecord(operation)) {
        throw new TypeError(`operations[${index}] must be an object.`);
    }
    if (!('kind' in operation)) throw new TypeError(`operations[${index}].kind is invalid.`);
    if (operation.kind !== 'create' && operation.kind !== 'delete' && operation.kind !== 'replace') {
        throw new TypeError(`operations[${index}].kind is invalid.`);
    }
    if (!('path' in operation) || typeof operation.path !== 'string' || operation.path.length === 0) {
        throw new TypeError(`operations[${index}].path must be a non-empty string.`);
    }
    if ((operation.kind === 'create' || operation.kind === 'replace')
        && (!('bytes' in operation) || !Buffer.isBuffer(operation.bytes))) {
        throw new TypeError(`operations[${index}].bytes must be a Buffer.`);
    }
    if (!('expected' in operation) || !isRecord(operation.expected)) {
        throw new TypeError(`operations[${index}].expected must be an object.`);
    }
    if (!('kind' in operation.expected)
        || operation.expected.kind !== 'file' && operation.expected.kind !== 'missing') {
        throw new TypeError(`operations[${index}].expected.kind is invalid.`);
    }
    if (operation.kind === 'create' && operation.expected.kind !== 'missing') {
        throw new TypeError(`operations[${index}] create requires expected missing.`);
    }
    if ((operation.kind === 'replace' || operation.kind === 'delete') && operation.expected.kind !== 'file') {
        throw new TypeError(`operations[${index}] ${operation.kind} requires expected file.`);
    }
    if (operation.expected.kind === 'file'
        && (!('hash' in operation.expected) || typeof operation.expected.hash !== 'string'
            || !/^[0-9a-f]{64}$/u.test(operation.expected.hash))) {
        throw new TypeError(`operations[${index}].expected.hash must be a SHA-256 digest.`);
    }
}

/** @param {TransactionFilesystem} filesystem @param {PreparedOperation | FileOperation} operation @returns {Promise<TransactionUnsuccessful | {diagnostics: [], state: FileState, status: 'succeeded'}>} */
const observe = async (filesystem, operation) => {
    const inspected = await filesystem.inspect({path: operation.path});
    if (inspected.status !== 'succeeded') return inspected;
    if (inspected.entry === undefined) throw new Error('Succeeded filesystem inspection did not return an entry.');
    if (inspected.entry.kind === 'missing') return {diagnostics: [], state: {kind: 'missing'}, status: 'succeeded'};
    if (inspected.entry.kind !== 'file') {
        return {
            diagnostics: [diagnostic('transaction-target-unsupported', 'The transaction target is not a regular file.', operation.path)],
            status: 'blocked',
        };
    }
    const read = await filesystem.read({path: operation.path});
    if (read.status !== 'succeeded') return read;
    if (read.bytes === undefined) throw new Error('Succeeded filesystem read did not return bytes.');
    return {
        diagnostics: [],
        state: {bytes: read.bytes, hash: sha256(read.bytes), kind: 'file'},
        status: 'succeeded',
    };
};

/** @param {FileState} expected @param {FileState} state */
const matchesExpected = (expected, state) => {
    if (expected.kind !== state.kind) return false;
    if (expected.kind === 'missing') return true;
    return state.kind === 'file' && expected.hash === state.hash;
};

/** @param {{filesystem: TransactionFilesystem, operations: unknown}} input @returns {Promise<PreparedPreflight | TransactionUnsuccessful>} */
export const preflightFileTransaction = async ({filesystem, operations}) => {
    if (filesystem === null
        || typeof filesystem?.inspect !== 'function'
        || typeof filesystem?.read !== 'function'
        || typeof filesystem?.resolve !== 'function') {
        throw new TypeError('filesystem must be a scoped filesystem.');
    }
    if (!Array.isArray(operations)) throw new TypeError('operations must be an array.');
    const validOperations = operations.map((/** @type {unknown} */ operation, index) => {
        assertOperation(operation, index);
        const resolved = filesystem.resolve({path: operation.path});
        if (resolved.status !== 'succeeded' || resolved.relativePath === undefined) return {operation, resolved};
        const path = resolved.relativePath === '' ? '.' : resolved.relativePath;
        return {operation: {...operation, path}, resolved};
    });
    const unresolved = validOperations.find(entry => entry.resolved.status !== 'succeeded');
    if (unresolved !== undefined && unresolved.resolved.status === 'blocked') return unresolved.resolved;
    const canonicalOperations = validOperations.map(entry => entry.operation);
    const duplicate = canonicalOperations.find((operation, index) => canonicalOperations.findIndex(candidate => candidate.path === operation.path) !== index);
    if (duplicate) {
        return {
            diagnostics: [diagnostic('transaction-path-duplicate', 'A transaction path may appear only once.', duplicate.path)],
            status: 'blocked',
        };
    }

    /** @type {PreparedOperation[]} */
    const preparedOperations = [];
    for (const operation of canonicalOperations) {
        const current = await observe(filesystem, operation);
        if (current.status === 'failed') return {...current, stage: current.stage ?? 'preflight-observation'};
        if (current.status === 'blocked') return current;
        if (!matchesExpected(operation.expected, current.state)) {
            return {
                diagnostics: [diagnostic('transaction-state-mismatch', 'The current file state does not match the planned state.', operation.path)],
                status: 'blocked',
            };
        }
        if (operation.kind === 'create' && current.state.kind !== 'missing') {
            return {
                diagnostics: [diagnostic('transaction-create-collision', 'A create operation requires a missing target.', operation.path)],
                status: 'blocked',
            };
        }
        if ((operation.kind === 'replace' || operation.kind === 'delete') && current.state.kind !== 'file') {
            return {
                diagnostics: [diagnostic('transaction-file-required', 'The operation requires an existing regular file.', operation.path)],
                status: 'blocked',
            };
        }
        preparedOperations.push(operation.kind === 'delete'
            ? {before: current.state, bytes: undefined, kind: operation.kind, path: operation.path}
            : {before: current.state, bytes: operation.bytes, kind: operation.kind, path: operation.path});
    }

    const preparedTransaction = Object.freeze({});
    preparedTransactions.set(preparedTransaction, {filesystem, preparedOperations});
    return /** @type {PreparedPreflight} */ ({
        diagnostics: [],
        preparedTransaction,
        status: 'succeeded',
    });
};

/** @param {TransactionFilesystem} filesystem @param {PreparedOperation} operation */
const restore = async (filesystem, operation) => {
    if (operation.before.kind === 'missing') {
        const removed = await filesystem.remove({path: operation.path, recursive: false});
        return {path: operation.path, status: removed.status === 'succeeded' ? 'restored' : 'failed'};
    }
    const inspected = await filesystem.inspect({path: operation.path});
    if (inspected.status !== 'succeeded') return {path: operation.path, status: 'failed'};
    if (inspected.entry === undefined) return {path: operation.path, status: 'failed'};
    const mode = inspected.entry.kind === 'missing' ? 'create' : 'replace';
    const written = await filesystem.write({bytes: operation.before.bytes, mode, path: operation.path});
    return {path: operation.path, status: written.status === 'succeeded' ? 'restored' : 'failed'};
};

/** @param {PreparedOperation} operation */
const operationSummary = operation => ({kind: operation.kind, path: operation.path});

/** @param {object} preparedTransaction */
export const applyFileTransaction = async preparedTransaction => {
    if (preparedTransaction === null || typeof preparedTransaction !== 'object') {
        throw new TypeError('apply requires a prepared transaction.');
    }
    const prepared = preparedTransactions.get(preparedTransaction);
    if (prepared === undefined) throw new TypeError('apply requires the original prepared transaction.');
    const {filesystem, preparedOperations} = prepared;

    for (const operation of preparedOperations) {
        const current = await observe(filesystem, operation);
        if (current.status === 'failed') return {...current, stage: current.stage ?? 'apply-revalidation'};
        if (current.status === 'blocked' || !matchesExpected(operation.before, current.state)) {
            return {
                diagnostics: [diagnostic('transaction-state-changed', 'The file state changed after preflight.', operation.path)],
                status: 'blocked',
            };
        }
    }

    const completed = [];
    for (const operation of preparedOperations) {
        const result = operation.kind === 'delete'
            ? await filesystem.remove({path: operation.path, recursive: false})
            : await filesystem.write({
                bytes: operation.bytes,
                mode: operation.kind === 'create' ? 'create' : 'replace',
                path: operation.path,
            });
        if (result.status !== 'succeeded') {
            const rollback = [];
            for (const completedOperation of [...completed].reverse()) {
                rollback.push(await restore(filesystem, completedOperation));
            }
            return {
                completedOperations: completed.map(operationSummary),
                diagnostics: result.diagnostics,
                rollback,
                stage: `apply:${operation.path}`,
                status: 'failed',
            };
        }
        completed.push(operation);
    }
    return {
        diagnostics: [],
        status: 'succeeded',
    };
};

/** @param {TransactionFilesystem} filesystem */
export const createFileTransaction = filesystem => ({
    apply: applyFileTransaction,
    /** @param {unknown} operations */
    preflight: operations => preflightFileTransaction({filesystem, operations}),
});
