import {analyzeDocumentLanguage} from '../common/document-language.mjs';
import {canonicalRepositoryRelativePath} from '../common/canonical-contract.mjs';
import {createScopedFilesystem} from '../common/filesystem.mjs';
import {parseMarkdownVisibleText} from '../common/markdown-visible-text.mjs';
import {inspectTextBytes} from '../common/text-policy.mjs';
import {compareText} from '../common/json.mjs';

/** @typedef {{code: string, message: string, path: string}} InspectionDiagnostic */
/** @typedef {{chinese: number | null, english: number | null, other: number | null, path: string}} LanguageComposition */

/** @param {string} path */
const excludedGitPath = path => path.split('/').includes('.git');

/** @param {unknown} result @param {string} path @returns {InspectionDiagnostic} */
const filesystemDiagnostic = (result, path) => {
    if (result !== null && typeof result === 'object' && 'diagnostics' in result && Array.isArray(result.diagnostics)) {
        const first = result.diagnostics[0];
        if (first !== null && typeof first === 'object') return {
            code: 'language-inspection-path-invalid',
            message: 'message' in first ? String(first.message) : 'The path could not be inspected.',
            path,
        };
    }
    return {code: 'language-inspection-path-invalid', message: 'The path could not be inspected.', path};
};

/**
 * 展开显式 Repository 相对 Markdown 文件或目录, 并分析每个文档的正文语言组成.
 * 任一显式路径或所选文件无效时返回失败且不返回部分表格.
 *
 * @param {{paths: string[], repositoryRoot: string}} input
 */
export const inspectDocumentLanguages = async input => {
    if (input === null
        || typeof input !== 'object'
        || Array.isArray(input)
        || !Array.isArray(input.paths)
        || input.paths.length === 0
        || input.paths.some(path => typeof path !== 'string')
        || typeof input.repositoryRoot !== 'string') {
        throw new TypeError('Document language inspection input is invalid.');
    }
    const created = await createScopedFilesystem({root: input.repositoryRoot});
    if (created.status !== 'succeeded') return {
        diagnostics: [filesystemDiagnostic(created, '.')],
        rows: [],
        status: 'failed',
    };
    const filesystem = created.scopedFilesystem;

    /** @type {InspectionDiagnostic[]} */
    const diagnostics = [];
    /** @type {Set<string>} */
    const selected = new Set();
    /** @type {Set<string>} */
    const directories = new Set();
    for (const operand of input.paths) {
        const path = canonicalRepositoryRelativePath(operand);
        if (path === null) {
            diagnostics.push({
                code: 'language-inspection-path-invalid',
                message: 'The path must be a Repository-relative file or directory.',
                path: operand,
            });
            continue;
        }
        const inspected = await filesystem.inspect({path});
        if (inspected.status !== 'succeeded') {
            diagnostics.push(filesystemDiagnostic(inspected, path));
            continue;
        }
        if (inspected.entry.kind === 'link') {
            diagnostics.push({code: 'language-inspection-path-invalid', message: 'Symbolic links are not supported.', path});
        } else if (inspected.entry.kind === 'file') {
            if (!path.endsWith('.md')) diagnostics.push({
                code: 'language-inspection-path-invalid',
                message: 'An explicit file must have the .md extension.',
                path,
            });
            else if (!excludedGitPath(path)) selected.add(path);
        } else if (inspected.entry.kind === 'directory') {
            if (!excludedGitPath(path)) directories.add(path);
        } else {
            diagnostics.push({
                code: 'language-inspection-path-invalid',
                message: 'The path must be a regular Markdown file or directory.',
                path,
            });
        }
    }

    const pending = [...directories].sort(compareText);
    while (diagnostics.length === 0 && pending.length > 0) {
        const directory = /** @type {string} */ (pending.shift());
        const listed = await filesystem.list({path: directory, recursive: false});
        if (listed.status !== 'succeeded') {
            diagnostics.push(filesystemDiagnostic(listed, directory));
            break;
        }
        for (const entry of listed.entries) {
            if (excludedGitPath(entry.path) || entry.kind === 'link') continue;
            if (entry.kind === 'directory' && !directories.has(entry.path)) {
                directories.add(entry.path);
                pending.push(entry.path);
            } else if (entry.kind === 'file' && entry.path.endsWith('.md')) selected.add(entry.path);
        }
        pending.sort(compareText);
    }

    if (diagnostics.length > 0) return {diagnostics, rows: [], status: 'failed'};
    const paths = [...selected].sort(compareText);
    if (paths.length === 0) return {
        diagnostics: [{
            code: 'language-inspection-empty-selection',
            message: 'The supplied directories contain no regular Markdown files.',
            path: '.',
        }],
        rows: [],
        status: 'failed',
    };

    /** @type {LanguageComposition[]} */
    const rows = [];
    for (const path of paths) {
        const read = await filesystem.read({path});
        if (read.status !== 'succeeded') {
            diagnostics.push(filesystemDiagnostic(read, path));
            continue;
        }
        const inspection = inspectTextBytes(read.bytes);
        if (inspection.kind !== 'text') {
            diagnostics.push({
                code: 'language-inspection-source-invalid',
                message: 'The file must contain valid UTF-8 Markdown text.',
                path,
            });
            continue;
        }
        try {
            const parsed = parseMarkdownVisibleText({bytes: inspection.fixedBytes ?? read.bytes, path});
            rows.push(analyzeDocumentLanguage({
                flows: parsed.flows
                    .filter(flow => flow.kind === 'body')
                    .map(flow => ({kind: /** @type {'body'} */ (flow.kind), text: flow.text})),
                path,
            }));
        } catch {
            diagnostics.push({
                code: 'language-inspection-source-invalid',
                message: 'The file must contain valid UTF-8 Markdown text.',
                path,
            });
        }
    }
    return diagnostics.length > 0
        ? {diagnostics, rows: [], status: 'failed'}
        : {diagnostics: [], rows, status: 'passed'};
};
