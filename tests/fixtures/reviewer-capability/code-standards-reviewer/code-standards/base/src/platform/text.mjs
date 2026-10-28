export const requiredText = (value, label) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) throw new Error(`${label} is required`);
    return text;
};

export const optionalKey = (key) => (typeof key === 'string' && key.trim() !== '' ? key.trim().toLowerCase() : null);

export const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
