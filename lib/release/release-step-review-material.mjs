/** @param {unknown} value */
export const isSafeReleaseRelativePath = value => typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && value.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
