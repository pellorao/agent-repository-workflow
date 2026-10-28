export const withOptional = (record, name, value) => {
    const next = {...record, [name]: value};
    if (value === null) delete next[name];
    return next;
};
