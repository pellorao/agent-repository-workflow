/**
 * @typedef {{status: "unsupported", error: string}} UnsupportedNodeRuntime
 * @typedef {{status: "supported", recommendation: string | null}} SupportedNodeRuntime
 */

/**
 * @param {string} version
 * @returns {UnsupportedNodeRuntime | SupportedNodeRuntime}
 */
export const evaluateNodeRuntime = version => {
    if (typeof version !== 'string') {
        throw new TypeError('Node.js runtime version must be a string.');
    }
    const match = /^(0|[1-9][0-9]*)\./.exec(version);
    if (match === null) {
        return {
            error: `ARW cannot determine the active Node.js major version: ${version}.`,
            status: 'unsupported',
        };
    }
    const major = BigInt(match[1]);
    if (major < 24n) {
        return {
            error: `ARW requires Node.js 24 or newer. Current runtime: ${version}.`,
            status: 'unsupported',
        };
    }
    return {
        recommendation: null,
        status: 'supported',
    };
};
