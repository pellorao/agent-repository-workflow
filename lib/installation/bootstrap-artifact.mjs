import {isAbsolute} from 'node:path';

import {createScopedFilesystem} from '../common/filesystem.mjs';
import {loadReleaseValidationConfiguration} from '../release/release-validation-config.mjs';

const BOOTSTRAP_IMPORT = "import {evaluateNodeRuntime} from '../arw-common/runtime-compatibility.mjs';\n";
const RELEASE_CONFIG_IMPORT = "import {loadReleaseValidationConfiguration} from '../release/release-validation-config.mjs';\n";
const BOOTSTRAP_INSERTION = 'const execFile = promisify(execFileCallback);';
const GENERATED_HEADER = '// 此文件由 scripts/generate-install-arw.mjs 确定性生成. 请修改 lib/installation/bootstrap.mjs, lib/arw-common/runtime-compatibility.mjs 或 release-validation.json.\n\n';
const GENERATED_SUFFIX = `
try {
    process.exitCode = await runBootstrap(process.argv.slice(2));
} catch (error) {
    process.stderr.write(\`${'${error instanceof Error ? error.message : String(error)}'}\\n\`);
    process.exitCode = error instanceof BootstrapUsageError ? error.exitCode : 1;
}
`;

/** @param {string} source @param {string} search @param {string} replacement @param {string} description */
const replaceOnce = (source, search, replacement, description) => {
    const first = source.indexOf(search);
    if (first === -1 || source.indexOf(search, first + search.length) !== -1) {
        throw new Error(`Cannot deterministically generate Bootstrap artifact: expected one ${description}.`);
    }
    return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
};

/**
 * 根据规范的 Bootstrap 源码与运行时兼容性源码确定性组成单文件安装入口.
 * 调用方必须提供两个完整源码字符串和已验证的当前 Release 配置. 返回值是可直接写入 `scripts/install-arw.mjs` 的 UTF-8 文本.
 * 如果规范导入点, 插入点或导出结构不唯一, 或生成结果仍含有模块导出, 此函数抛出异常.
 * @param {object} input
 * @param {string} input.bootstrapSource
 * @param {{repositories: {sourceCheckout: {url: unknown}}}} input.releaseValidationConfiguration
 * @param {string} input.runtimeCompatibilitySource
 */
const renderBootstrapArtifact = ({
    bootstrapSource,
    releaseValidationConfiguration,
    runtimeCompatibilitySource,
}) => {
    const canonicalRemote = releaseValidationConfiguration?.repositories?.sourceCheckout?.url;
    if (typeof canonicalRemote !== 'string' || canonicalRemote.length === 0) {
        throw new Error('Cannot deterministically generate Bootstrap artifact: canonical SSH remote is unavailable.');
    }
    let bootstrap = replaceOnce(bootstrapSource, BOOTSTRAP_IMPORT, '', 'runtime import');
    bootstrap = replaceOnce(
        bootstrap,
        RELEASE_CONFIG_IMPORT,
        `const loadReleaseValidationConfiguration = async () => ({\n    status: 'succeeded',\n    value: {repositories: {sourceCheckout: {url: ${JSON.stringify(canonicalRemote)}}}},\n});\n`,
        'release configuration import',
    );
    const runtime = replaceOnce(
        runtimeCompatibilitySource.trim(),
        'export const evaluateNodeRuntime',
        'const evaluateNodeRuntime',
        'runtime export',
    );
    bootstrap = replaceOnce(bootstrap, BOOTSTRAP_INSERTION, `${runtime}\n\n${BOOTSTRAP_INSERTION}`, 'insertion point');
    bootstrap = bootstrap.replaceAll('export const ', 'const ').replace('export class ', 'class ');
    if (/\bexport\s/.test(bootstrap)) {
        throw new Error('Cannot deterministically generate Bootstrap artifact: unsupported export remains.');
    }
    return `${GENERATED_HEADER}${bootstrap.trim()}\n${GENERATED_SUFFIX}`;
};

const BOOTSTRAP_PATH = 'lib/installation/bootstrap.mjs';
const RUNTIME_PATH = 'lib/arw-common/runtime-compatibility.mjs';
const ARTIFACT_PATH = 'scripts/install-arw.mjs';

/** @param {string} code @param {string} message */
const blocked = (code, message) => ({diagnostics: [{code, message}], status: /** @type {'blocked'} */ ('blocked')});

/** @param {string} stage @param {{diagnostics: Array<{code: string, message: string}>}} result */
const failed = (stage, result) => ({diagnostics: result.diagnostics, stage, status: /** @type {'failed'} */ ('failed')});

/** @param {Awaited<ReturnType<typeof createScopedFilesystem>>} opened */
const mapOpenFailure = opened => opened.status === 'failed'
    ? failed('bootstrap-artifact-root', opened)
    : blocked('bootstrap-artifact-root-invalid', opened.diagnostics.map(entry => entry.message).join(' '));

/** @param {import('../common/filesystem.mjs').ScopedFilesystem} filesystem @param {string} path @param {string} stage */
const readSource = async (filesystem, path, stage) => {
    const result = await filesystem.readText({allowLossyDecoding: false, path});
    if (result.status === 'failed') return failed(stage, result);
    if (result.status === 'blocked') {
        return blocked('bootstrap-artifact-source-invalid', result.diagnostics.map(entry => entry.message).join(' '));
    }
    return result;
};

/**
 * 从指定 Source Checkout 的规范源码生成或核对 `scripts/install-arw.mjs`.
 * @param {{mode: 'check' | 'write', sourceDirectory: string}} input
 */
export const generateBootstrapArtifact = async input => {
    if (input === null
        || typeof input !== 'object'
        || Array.isArray(input)
        || Object.keys(input).sort().join(',') !== 'mode,sourceDirectory'
        || !('mode' in input)
        || !('sourceDirectory' in input)
        || (input.mode !== 'check' && input.mode !== 'write')
        || typeof input.sourceDirectory !== 'string'
        || !isAbsolute(input.sourceDirectory)) {
        return blocked('bootstrap-artifact-input-invalid', 'Bootstrap Artifact requires sourceDirectory and write or check mode.');
    }
    const opened = await createScopedFilesystem({root: input.sourceDirectory});
    if (opened.status !== 'succeeded') return mapOpenFailure(opened);
    const filesystem = opened.scopedFilesystem;
    const [bootstrapResult, runtimeResult, configurationResult] = await Promise.all([
        readSource(filesystem, BOOTSTRAP_PATH, 'bootstrap-source-read'),
        readSource(filesystem, RUNTIME_PATH, 'runtime-compatibility-source-read'),
        loadReleaseValidationConfiguration({repositoryRoot: input.sourceDirectory}),
    ]);
    if (bootstrapResult.status !== 'succeeded') return bootstrapResult;
    if (runtimeResult.status !== 'succeeded') return runtimeResult;
    if (configurationResult.status === 'failed') {
        return {
            diagnostics: 'diagnostics' in configurationResult
                ? configurationResult.diagnostics
                : [{code: 'bootstrap-artifact-configuration-failed', message: 'release-validation.json could not be loaded.'}],
            stage: 'stage' in configurationResult && typeof configurationResult.stage === 'string'
                ? configurationResult.stage
                : 'release-configuration-read',
            status: /** @type {'failed'} */ ('failed'),
        };
    }
    if (configurationResult.status !== 'succeeded' || !('value' in configurationResult)) {
        return blocked('bootstrap-artifact-configuration-invalid', 'release-validation.json is invalid; Bootstrap artifact cannot be generated.');
    }
    let generated;
    try {
        generated = renderBootstrapArtifact({
            bootstrapSource: bootstrapResult.text,
            releaseValidationConfiguration: configurationResult.value,
            runtimeCompatibilitySource: runtimeResult.text,
        });
    } catch (error) {
        return blocked('bootstrap-artifact-source-invalid', error instanceof Error ? error.message : String(error));
    }

    const artifact = await filesystem.inspect({path: ARTIFACT_PATH});
    if (artifact.status === 'failed') return failed('bootstrap-artifact-observation', artifact);
    if (artifact.status === 'blocked') {
        return blocked('bootstrap-artifact-target-invalid', artifact.diagnostics.map(entry => entry.message).join(' '));
    }
    let current = null;
    if (artifact.entry.kind !== 'missing') {
        if (artifact.entry.kind !== 'file') {
            return blocked('bootstrap-artifact-target-invalid', 'scripts/install-arw.mjs must be a regular file.');
        }
        const currentResult = await filesystem.readText({allowLossyDecoding: false, path: ARTIFACT_PATH});
        if (currentResult.status === 'failed') return failed('bootstrap-artifact-read', currentResult);
        if (currentResult.status === 'blocked') {
            return blocked('bootstrap-artifact-target-invalid', currentResult.diagnostics.map(entry => entry.message).join(' '));
        }
        current = currentResult.text;
    }

    if (input.mode === 'check') {
        if (current !== generated) {
            return blocked('bootstrap-artifact-mismatch', 'scripts/install-arw.mjs does not match its canonical Bootstrap sources.');
        }
        return {changed: false, diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded')};
    }
    if (current === generated) {
        return {changed: false, diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded')};
    }
    const written = await filesystem.write({
        bytes: Buffer.from(generated, 'utf8'),
        mode: current === null ? 'create-atomic' : 'replace',
        path: ARTIFACT_PATH,
    });
    if (written.status === 'failed') return failed('bootstrap-artifact-write', written);
    if (written.status === 'blocked') {
        return blocked('bootstrap-artifact-target-invalid', written.diagnostics.map(entry => entry.message).join(' '));
    }
    return {changed: true, diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded')};
};
