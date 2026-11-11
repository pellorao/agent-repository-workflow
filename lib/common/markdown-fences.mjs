export const fenceOpening = (/** @type {string} */ value) => {
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(value);
    if (opening?.[1][0] === '`' && opening[2].includes('`')) return null;
    return opening;
};

export const fenceClosing = (/** @type {string} */ value, /** @type {{character: string, length: number}} */ fence) => (
    new RegExp(`^ {0,3}${fence.character}{${fence.length},}[ \\t]*$`, 'u').test(value)
);

/** @typedef {{character: string, length: number}} MarkdownFence */
/** @param {string} line @param {MarkdownFence|null} fence @returns {MarkdownFence|null} */
export const nextFence = (line, fence) => {
    if (fence) return fenceClosing(line, fence) ? null : fence;
    const opening = fenceOpening(line);
    return opening ? {character: opening[1][0], length: opening[1].length} : null;
};
