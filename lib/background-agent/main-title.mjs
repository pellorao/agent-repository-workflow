/** The text of a user message from its text parts. @param {Array<{text:string}>} parts */
export const joinText = parts => parts.map(part => part.text).join('\n');

/** A listing title taken from a Main's first prompt; both backends use the same length. @param {string} text */
export const promptTitle = text => [...text].slice(0, 40).join('');
