/** @param {readonly {message: string}[]} diagnostics */
export const diagnosticMessages = diagnostics => diagnostics.map(entry => entry.message).join(' ');
