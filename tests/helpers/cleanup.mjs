import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/**
 * @typedef {object} CleanupContext
 * @property {(callback: () => void | Promise<void>) => void} after
 */

/**
 * @param {CleanupContext} t
 * @param {() => void | Promise<void>} cleanup
 */
export const registerCleanup = (t, cleanup) => {
    t.after(cleanup);
};

/**
 * @param {CleanupContext} t
 * @param {string} prefix
 */
export const createTemporaryDirectory = async (t, prefix) => {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    registerCleanup(t, () => rm(directory, {force: true, recursive: true}));
    return directory;
};
