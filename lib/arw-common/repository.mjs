import {createScopedFilesystem} from '../common/filesystem.mjs';
import {resolveRepository} from '../common/repository.mjs';

/** @param {string} [cwd] */
export const discoverRepository = async (cwd = process.cwd()) => {
    const result = await resolveRepository({startDirectory: cwd});
    if (result.status === 'blocked') {
        throw new Error('Unable to discover the nearest Git working-tree root.');
    }
    if (result.status === 'failed') {
        throw new Error('Unable to resolve the nearest Git working-tree root.');
    }

    const {root} = result.repository;
    const created = await createScopedFilesystem({root});
    if (created.status !== 'succeeded') {
        throw new Error('The selected Git repository .scratch directory could not be read.');
    }
    const resolved = created.scopedFilesystem.resolve({path: '.scratch'});
    if (resolved.status !== 'succeeded') throw new Error('The selected Git repository .scratch path is not usable.');
    const scratchDirectory = resolved.absolutePath;
    const scratch = await created.scopedFilesystem.inspect({path: '.scratch'});
    if (scratch.status === 'failed') throw new Error('The selected Git repository .scratch directory could not be read.');
    if (scratch.status === 'blocked') throw new Error('The selected Git repository .scratch path is not a usable directory.');
    if (scratch.entry.kind === 'missing') return {root, scratchDirectory};

    if (scratch.entry.kind !== 'directory') {
        throw new Error('The selected Git repository .scratch path is not a usable directory.');
    }

    return {root, scratchDirectory};
};
