/** @param {string} segment */
const globSegmentSource = segment => {
    let source = '';
    for (const character of segment) {
        if (character === '*') source += '[^/]*';
        else if (character === '?') source += '[^/]';
        else source += character.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
    }
    return source;
};

export const globToRegExp = (/** @type {string} */ pattern) => {
    const segments = pattern.split('/');
    let source = '^';
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        if (segment === '**') source += index === segments.length - 1 ? '.*' : '(?:[^/]+/)*';
        else {
            source += globSegmentSource(segment);
            if (index < segments.length - 1) source += '/';
        }
    }
    return new RegExp(`${source}$`);
};
