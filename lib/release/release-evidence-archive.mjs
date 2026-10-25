import {
    lstat,
    mkdir,
    open,
    readFile,
    readdir,
    rm,
} from 'node:fs/promises';
import {dirname, isAbsolute, join, resolve, sep} from 'node:path';

import {joinRelativePath, resolveAbsolutePathWithinScope} from '../common/filesystem.mjs';

import {
    listReleaseValidationScenarios,
    resolveReleaseValidationScenario,
} from './release-validation-registry.mjs';
import {exactKeys} from '../common/json.mjs';

const BLOCK_SIZE = 512;
const END_SIZE = BLOCK_SIZE * 2;
const CHANGE_TYPES = new Set(['added', 'deleted', 'modified', 'type-changed']);
/** @typedef {{changeType: string, matchesExpected: boolean, path: string, summary: string}} FileJudgment */
/** @typedef {{files: FileJudgment[], matchesExpected: boolean, summary: string, exitCode?: number}} StepValidation */
/** @typedef {{matchesExpected: boolean, steps: string[], summary: string}} EvidenceSummary */
/** @typedef {{close: () => Promise<void>, writeFile: (bytes: Buffer) => Promise<void>}} ArchiveHandle */
/** @typedef {{mkdir: (path: string, options: {recursive: true}) => Promise<unknown>, open: (path: string, flags: string) => Promise<ArchiveHandle>, rm: (path: string, options: {force: true}) => Promise<unknown>}} ArchiveFileSystem */
/** @typedef {Map<string, Buffer>} EvidenceFiles */
/** @type {ArchiveFileSystem} */
const nodeFileSystem = {mkdir, open, rm};
/** @type {Map<string, string[]>} */
const archiveKinds = new Map(listReleaseValidationScenarios().map(entry => [
    entry.archiveKind,
    entry.steps.map(step => step.stepId),
]));

/** @param {string} archiveKind @param {string} step */
const isMainAgentStep = (archiveKind, step) => {
    const selected = resolveReleaseValidationScenario(archiveKind).steps.find(entry => entry.stepId === step);
    if (selected === undefined) throw new Error(`Release validation step is not registered: ${step}.`);
    return !selected.command;
};
/** @param {unknown} value @param {string} label @returns {asserts value is string} */
function assertSafePath(value, label) {
    if (typeof value !== 'string'
        || value.length === 0
        || value.startsWith('/')
        || value.includes('\\')
        || value.split('/').some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
        throw new Error(`${label} must be a safe relative path.`);
    }
}
/** @param {unknown} archiveKind @returns {string[]} */
const registeredSteps = archiveKind => {
    if (typeof archiveKind !== 'string' || !archiveKinds.has(archiveKind)) {
        throw new Error('Release evidence archive kind is not registered.');
    }
    const steps = archiveKinds.get(archiveKind);
    if (steps === undefined) throw new Error('Release evidence archive steps are unavailable.');
    return steps;
};

/** @param {string[]} steps */
const requiredInventory = steps => [
    'summary.json',
    ...steps.map(step => joinRelativePath('steps', step, 'validation.json')),
];

/** @param {{archiveKind: string, availablePaths: Set<string>, steps: string[]}} input */
const canonicalInventory = ({archiveKind, availablePaths, steps}) => [
    'summary.json',
    ...steps.flatMap(step => [
        joinRelativePath('steps', step, 'validation.json'),
        ...(['stdout.txt', 'stderr.txt']
            .map(name => joinRelativePath('steps', step, name))
            .filter(path => !isMainAgentStep(archiveKind, step) && availablePaths.has(path))),
    ]),
];

const collectSourceFiles = async (/** @type {string} */ sourceDirectory) => {
    const root = resolve(sourceDirectory);
    const rootStats = await lstat(root);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
        throw new Error('Release evidence archive source must be an ordinary directory.');
    }
    /** @type {EvidenceFiles} */
    const files = new Map();
    const visit = async (/** @type {string} */ directory) => {
        const entries = await readdir(directory, {withFileTypes: true});
        for (const entry of entries) {
            const absolutePath = join(directory, entry.name);
            const bounded = resolveAbsolutePathWithinScope({path: absolutePath, scope: root});
            if (bounded.status !== 'succeeded' || bounded.relativePath.length === 0) {
                throw new Error('Release evidence archive source path escaped its root.');
            }
            const path = bounded.relativePath.split(sep).join('/');
            assertSafePath(path, 'Release evidence archive source path');
            if (entry.isDirectory()) {
                await visit(absolutePath);
                continue;
            }
            const stats = await lstat(absolutePath);
            if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink > 1) {
                throw new Error(`Release evidence archive source must contain only independent regular files: ${path}.`);
            }
            files.set(path, await readFile(absolutePath));
        }
    };
    await visit(root);
    return files;
};

/** @param {string[]} actualPaths @param {string[]} expectedPaths @param {string} identity */
const compareInventory = (actualPaths, expectedPaths, identity) => {
    if (actualPaths.length === expectedPaths.length
        && actualPaths.every((path, index) => path === expectedPaths[index])) return;
    const expected = new Set(expectedPaths);
    const actual = new Set(actualPaths);
    const extra = actualPaths.find(path => !expected.has(path));
    if (extra !== undefined) throw new Error(`Release evidence archive inventory has an extra entry for ${identity}: ${extra}.`);
    const missing = expectedPaths.find(path => !actual.has(path));
    if (missing !== undefined) throw new Error(`Release evidence archive inventory is missing an entry for ${identity}: ${missing}.`);
    const index = expectedPaths.findIndex((path, position) => path !== actualPaths[position]);
    throw new Error(`Release evidence archive inventory order is invalid for ${identity}: expected ${expectedPaths[index]}.`);
};

/** @param {Buffer | undefined} bytes @param {string} path @returns {unknown} */
const decodeJson = (bytes, path) => {
    if (bytes === undefined) throw new Error(`Release evidence file is missing: ${path}.`);
    let text;
    try {
        text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    } catch {
        throw new Error(`Release evidence JSON is not valid UTF-8: ${path}.`);
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`Release evidence JSON is invalid: ${path}.`);
    }
};

/** @param {unknown} files @param {string} path @returns {asserts files is FileJudgment[]} */
function validateFileJudgments(files, path) {
    if (!Array.isArray(files)) throw new Error(`Release evidence files must be an array: ${path}.`);
    let previous;
    for (const [index, file] of files.entries()) {
        if (!exactKeys(file, ['changeType', 'matchesExpected', 'path', 'summary'])) {
            throw new Error(`Release evidence file judgment fields are invalid: ${path}#files[${index}].`);
        }
        if (typeof file.changeType !== 'string' || !CHANGE_TYPES.has(file.changeType)) {
            throw new Error(`Release evidence changeType is invalid: ${path}#files[${index}].`);
        }
        assertSafePath(file.path, `Release evidence file judgment path at ${path}#files[${index}]`);
        if (previous !== undefined && previous >= file.path) {
            throw new Error(`Release evidence file judgments must be sorted and unique: ${path}.`);
        }
        if (typeof file.matchesExpected !== 'boolean' || typeof file.summary !== 'string' || file.summary.length === 0) {
            throw new Error(`Release evidence file judgment values are invalid: ${path}#files[${index}].`);
        }
        previous = file.path;
    }
}

/** @param {Buffer | undefined} bytes @param {string} path @param {boolean} mainAgent @returns {StepValidation} */
const validateStep = (bytes, path, mainAgent) => {
    const validation = decodeJson(bytes, path);
    const keys = mainAgent
        ? ['files', 'matchesExpected', 'summary']
        : ['exitCode', 'files', 'matchesExpected', 'summary'];
    if (!exactKeys(validation, keys)) throw new Error(`Release evidence step fields are invalid: ${path}.`);
    if (!mainAgent && (typeof validation.exitCode !== 'number'
        || !Number.isSafeInteger(validation.exitCode) || validation.exitCode < 0)) {
        throw new Error(`Release evidence command exitCode is invalid: ${path}.`);
    }
    if (typeof validation.matchesExpected !== 'boolean'
        || typeof validation.summary !== 'string'
        || validation.summary.length === 0) {
        throw new Error(`Release evidence step judgment is invalid: ${path}.`);
    }
    validateFileJudgments(validation.files, path);
    if (validation.matchesExpected && validation.files.some(file => !file.matchesExpected)) {
        throw new Error(`Release evidence step judgment does not include every file judgment: ${path}.`);
    }
    return {
        ...(!mainAgent && typeof validation.exitCode === 'number' ? {exitCode: validation.exitCode} : {}),
        files: validation.files,
        matchesExpected: validation.matchesExpected,
        summary: validation.summary,
    };
};

/** @param {{archiveKind: string, files: EvidenceFiles, orderedPaths: string[], steps: string[]}} input */
const validateEvidenceFiles = ({archiveKind, files, orderedPaths, steps}) => {
    const availablePaths = new Set(orderedPaths);
    const requiredPaths = requiredInventory(steps);
    const expectedPaths = canonicalInventory({archiveKind, availablePaths, steps});
    for (const path of requiredPaths) {
        if (!availablePaths.has(path)) {
            throw new Error(`Release evidence archive inventory is missing an entry for ${archiveKind}: ${path}.`);
        }
    }
    for (const path of orderedPaths) {
        if (!expectedPaths.includes(path)) {
            throw new Error(`Release evidence archive inventory has an extra entry for ${archiveKind}: ${path}.`);
        }
    }
    compareInventory(orderedPaths, expectedPaths, archiveKind);
    const summary = decodeJson(files.get('summary.json'), 'summary.json');
    if (!exactKeys(summary, ['matchesExpected', 'steps', 'summary'])
        || typeof summary.matchesExpected !== 'boolean'
        || typeof summary.summary !== 'string'
        || summary.summary.length === 0) {
        throw new Error('Release evidence summary fields are invalid: summary.json.');
    }
    if (!Array.isArray(summary.steps)
        || summary.steps.length !== steps.length
        || summary.steps.some((step, index) => step !== steps[index])) {
        throw new Error(`Release evidence summary steps do not match archive kind ${archiveKind}: summary.json.`);
    }
    const validations = steps.map(step => validateStep(
        files.get(joinRelativePath('steps', step, 'validation.json')),
        joinRelativePath('steps', step, 'validation.json'),
        isMainAgentStep(archiveKind, step),
    ));
    if (summary.matchesExpected !== validations.every(validation => validation.matchesExpected)) {
        throw new Error('Release evidence root judgment does not include every step judgment: summary.json.');
    }
    return expectedPaths;
};

/** @param {string} path */
const splitUstarPath = path => {
    const bytes = Buffer.from(path, 'utf8');
    if (bytes.length <= 100) return {name: path, prefix: ''};
    const separators = [...path.matchAll(/\//g)].map(match => match.index).reverse();
    for (const index of separators) {
        const prefix = path.slice(0, index);
        const name = path.slice(index + 1);
        if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return {name, prefix};
    }
    throw new Error(`Archive path does not fit POSIX ustar: ${path}.`);
};
/** @param {Buffer} header @param {number} offset @param {number} length @param {string} value @param {string} label */
const writeText = (header, offset, length, value, label) => {
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.length > length) throw new Error(`${label} exceeds its canonical tar field.`);
    bytes.copy(header, offset);
};
const octal = (/** @type {unknown} */ value, /** @type {number} */ length, /** @type {string} */ label) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid.`);
    const digits = value.toString(8);
    if (digits.length > length - 1) throw new Error(`${label} exceeds its canonical tar field.`);
    return `${digits.padStart(length - 1, '0')}\0`;
};
/** @param {string} path @param {number} size */
const createHeader = (path, size) => {
    assertSafePath(path, 'Release evidence archive entry path');
    const {name, prefix} = splitUstarPath(path);
    const header = Buffer.alloc(BLOCK_SIZE);
    writeText(header, 0, 100, name, 'Archive name');
    writeText(header, 100, 8, '0000644\0', 'Archive mode');
    writeText(header, 108, 8, '0000000\0', 'Archive uid');
    writeText(header, 116, 8, '0000000\0', 'Archive gid');
    writeText(header, 124, 12, octal(size, 12, 'Archive size'), 'Archive size');
    writeText(header, 136, 12, '00000000000\0', 'Archive mtime');
    header.fill(0x20, 148, 156);
    header[156] = '0'.charCodeAt(0);
    writeText(header, 257, 6, 'ustar\0', 'Archive magic');
    writeText(header, 263, 2, '00', 'Archive version');
    writeText(header, 329, 8, '0000000\0', 'Archive device major');
    writeText(header, 337, 8, '0000000\0', 'Archive device minor');
    writeText(header, 345, 155, prefix, 'Archive prefix');
    const checksum = [...header].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0');
    writeText(header, 148, 8, `${checksum}\0 `, 'Archive checksum');
    return header;
};
/** @param {{bytes: Buffer, path: string}} input */
const fileBlocks = ({bytes, path}) => {
    const padding = (BLOCK_SIZE - (bytes.length % BLOCK_SIZE)) % BLOCK_SIZE;
    return [createHeader(path, bytes.length), bytes, Buffer.alloc(padding)];
};
/** @param {EvidenceFiles} files @param {string[]} inventory */
const createArchiveBytes = (files, inventory) => Buffer.concat([
    ...inventory.flatMap(path => {
        const bytes = files.get(path);
        if (bytes === undefined) throw new Error(`Release evidence file is missing: ${path}.`);
        return fileBlocks({bytes, path});
    }),
    Buffer.alloc(END_SIZE),
]);

/** @param {Buffer} header @param {number} offset @param {number} length */
const readField = (header, offset, length) => {
    const field = header.subarray(offset, offset + length);
    const zero = field.indexOf(0);
    return field.subarray(0, zero === -1 ? field.length : zero).toString('utf8');
};
/** @param {Buffer} header @param {string} path */
const parseSize = (header, path) => {
    const text = readField(header, 124, 12);
    if (!/^[0-7]{11}$/.test(text)) throw new Error(`Release evidence archive size field is not canonical: ${path}.`);
    const value = Number.parseInt(text, 8);
    if (!Number.isSafeInteger(value)) throw new Error(`Release evidence archive entry is too large: ${path}.`);
    return value;
};
const parseArchive = (/** @type {NonSharedBuffer} */ archive) => {
    if (archive.length < END_SIZE || archive.length % BLOCK_SIZE !== 0) {
        throw new Error('Release evidence archive length is invalid.');
    }
    /** @type {EvidenceFiles} */
    const files = new Map();
    /** @type {string[]} */
    const orderedPaths = [];
    let offset = 0;
    while (offset < archive.length - END_SIZE) {
        const header = archive.subarray(offset, offset + BLOCK_SIZE);
        if (header.every((/** @type {number} */ byte) => byte === 0)) throw new Error('Release evidence archive has an early end marker.');
        const name = readField(header, 0, 100);
        const prefix = readField(header, 345, 155);
        const path = prefix.length === 0 ? name : joinRelativePath(prefix, name);
        assertSafePath(path, 'Release evidence archive entry path');
        const size = parseSize(header, path);
        if (!header.equals(createHeader(path, size))) {
            throw new Error(`Release evidence archive header is not canonical: ${path}.`);
        }
        const dataStart = offset + BLOCK_SIZE;
        const dataEnd = dataStart + size;
        const nextOffset = dataStart + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
        if (nextOffset > archive.length - END_SIZE) throw new Error(`Release evidence archive entry is truncated: ${path}.`);
        if (!archive.subarray(dataEnd, nextOffset).every((/** @type {number} */ byte) => byte === 0)) {
            throw new Error(`Release evidence archive padding is not canonical: ${path}.`);
        }
        orderedPaths.push(path);
        files.set(path, archive.subarray(dataStart, dataEnd));
        offset = nextOffset;
    }
    if (offset !== archive.length - END_SIZE || !archive.subarray(offset).every((/** @type {number} */ byte) => byte === 0)) {
        throw new Error('Release evidence archive end marker is not canonical.');
    }
    return {files, orderedPaths};
};

/**
 * 从一个 scenario 的完整 `sourceDirectory` 建立 canonical release evidence archive.
 * Input 要求已登记的 `archiveKind`, absolute `outputPath` 和可安全递归读取的 ordinary source tree.
 * Interface 先验证完整 inventory 和每个 evidence file, 再 exclusive create archive; 已存在目标不会被覆盖.
 * Success 返回 archive kind, canonical output path, entry count 和 `created` status.
 * Invalid inventory, linked 或 unreadable source entry, 写入或 close failure 会 reject;
 * 已创建但未完成的 output 会尽力删除, cleanup failure 保留在原 error 上.
 */
export const createReleaseEvidenceArchive = async (
    /** @type {{archiveKind: unknown, outputPath: unknown, sourceDirectory: unknown}} */
    {archiveKind, outputPath, sourceDirectory},
    /** @type {ArchiveFileSystem} */
    fileSystem = nodeFileSystem,
) => {
    if (typeof archiveKind !== 'string') throw new Error('Release evidence archive kind is not registered.');
    const steps = registeredSteps(archiveKind);
    if (typeof outputPath !== 'string' || !isAbsolute(outputPath)) {
        throw new Error('Release evidence archive output path must be absolute.');
    }
    if (typeof sourceDirectory !== 'string' || sourceDirectory.length === 0) {
        throw new Error('Release evidence archive source directory is invalid.');
    }
    const resolvedOutputPath = resolve(outputPath);
    const files = await collectSourceFiles(sourceDirectory);
    const sourceInventory = canonicalInventory({archiveKind, availablePaths: new Set(files.keys()), steps});
    const inventory = validateEvidenceFiles({
        archiveKind,
        files,
        orderedPaths: [
            ...sourceInventory.filter(path => files.has(path)),
            ...[...files.keys()].filter(path => !sourceInventory.includes(path)).sort(),
        ],
        steps,
    });
    const archive = createArchiveBytes(files, inventory);
    await fileSystem.mkdir(dirname(resolvedOutputPath), {recursive: true});
    /** @type {ArchiveHandle | undefined} */
    let handle;
    let created = false;
    try {
        handle = await fileSystem.open(resolvedOutputPath, 'wx');
        created = true;
        await handle.writeFile(archive);
        await handle.close();
        handle = undefined;
    } catch (error) {
        if (handle !== undefined) {
            try {
                await handle.close();
            } catch (closeError) {
                if (error instanceof Error && !('closeError' in error)) {
                    Object.defineProperty(error, 'closeError', {value: closeError});
                }
            }
        }
        if (created) {
            try {
                await fileSystem.rm(resolvedOutputPath, {force: true});
            } catch (cleanupError) {
                if (error instanceof Error) Object.defineProperty(error, 'cleanupError', {value: cleanupError});
            }
        }
        throw error;
    }
    return {
        archiveKind,
        entryCount: inventory.length,
        outputPath: resolvedOutputPath,
        status: 'created',
    };
};

/**
 * 验证 ordinary archive file 的 canonical structure, registered inventory 和完整 evidence contract.
 * `sourceDirectory: null` 只验证 archive 自身. 提供 source directory 时, 另外重建 canonical source inventory,
 * 要求 archive path order 与 source inventory 相同, 并逐 path 比较完整 bytes.
 * Success 返回 resolved archive path, archive kind, entry count 和 `verified` status.
 * Invalid kind, unsafe archive entry, malformed inventory, non-ordinary archive, source drift 或 I/O failure 会 reject,
 * 且 Interface 不修改 archive 或 source directory.
 */
/** @param {{archiveKind: unknown, archivePath: unknown, sourceDirectory?: string | null}} input */
export const verifyReleaseEvidenceArchive = async ({archiveKind, archivePath, sourceDirectory = null}) => {
    if (typeof archiveKind !== 'string') throw new Error('Release evidence archive kind is not registered.');
    const steps = registeredSteps(archiveKind);
    if (typeof archivePath !== 'string' || archivePath.length === 0) {
        throw new Error('Release evidence archive path is invalid.');
    }
    const resolvedArchivePath = resolve(archivePath);
    const stats = await lstat(resolvedArchivePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new Error('Release evidence archive path must identify an ordinary file.');
    }
    const {files, orderedPaths} = parseArchive(await readFile(resolvedArchivePath));
    const inventory = validateEvidenceFiles({archiveKind, files, orderedPaths, steps});
    if (sourceDirectory !== null) {
        const sourceFiles = await collectSourceFiles(sourceDirectory);
        const canonicalSourceInventory = canonicalInventory({archiveKind, availablePaths: new Set(sourceFiles.keys()), steps});
        const sourceInventory = validateEvidenceFiles({
            archiveKind,
            files: sourceFiles,
            orderedPaths: [
                ...canonicalSourceInventory.filter(path => sourceFiles.has(path)),
                ...[...sourceFiles.keys()].filter(path => !canonicalSourceInventory.includes(path)).sort(),
            ],
            steps,
        });
        compareInventory(orderedPaths, sourceInventory, archiveKind);
        for (const path of orderedPaths) {
            const archiveBytes = files.get(path);
            const sourceBytes = sourceFiles.get(path);
            if (archiveBytes === undefined || sourceBytes === undefined || !archiveBytes.equals(sourceBytes)) {
                throw new Error(`Release evidence archive bytes differ from the source directory: ${path}.`);
            }
        }
    }
    return {
        archiveKind,
        archivePath: resolvedArchivePath,
        entryCount: inventory.length,
        status: 'verified',
    };
};
