const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;

const ESCAPES = Object.freeze({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
});

export const escapeText = (text) => text.replace(/[&<>"']/g, (character) => ESCAPES[character]);

export const renderTemplate = (template, values) => template.replace(PLACEHOLDER, (match, name) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (value === undefined || value === null) throw new Error(`template value ${name} is missing`);
    return escapeText(String(value));
});
