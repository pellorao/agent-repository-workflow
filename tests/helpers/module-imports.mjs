import {dirname, posix} from 'node:path';

export const moduleSpecifiers = (/** @type {string} */ source) => [
    ...source.matchAll(/\b(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/gu),
    ...source.matchAll(/\bimport\s+['"]([^'"]+)['"]/gu),
].map(match => match[1]);

export const resolveSourceImport = (/** @type {string} */ sourcePath, /** @type {string} */ specifier) => (
    posix.normalize(posix.join(dirname(sourcePath), specifier))
);
