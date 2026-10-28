import {spawn as spawnProcess} from 'node:child_process';

import {FILE_ARGUMENT} from './config.mjs';

const WINDOWS_EDITOR_COMMAND_ENV = 'ARW_EDITOR_COMMAND';
const WINDOWS_EDITOR_ARGS_ENV = 'ARW_EDITOR_ARGS';
const WINDOWS_EDITOR_INNER_ENV = 'ARW_EDITOR_INNER';
const WINDOWS_EDITOR_WAIT_ENV = 'ARW_EDITOR_WAIT';
const WINDOWS_EDITOR_INNER_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
    $command = [Environment]::GetEnvironmentVariable('${WINDOWS_EDITOR_COMMAND_ENV}')
    $arguments = @(ConvertFrom-Json ([Environment]::GetEnvironmentVariable('${WINDOWS_EDITOR_ARGS_ENV}')))
    & $command @arguments
    exit 0
} catch {
    exit 1
}
`.trim();
const WINDOWS_EDITOR_LAUNCHER_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
    $command = [Environment]::GetEnvironmentVariable('${WINDOWS_EDITOR_COMMAND_ENV}')
    $arguments = @(ConvertFrom-Json ([Environment]::GetEnvironmentVariable('${WINDOWS_EDITOR_ARGS_ENV}')))
    Get-Command -Name $command -CommandType Application -ErrorAction Stop | Select-Object -First 1 | Out-Null
    $wait = [Environment]::GetEnvironmentVariable('${WINDOWS_EDITOR_WAIT_ENV}')
    if ($wait -eq 'true') {
        & $command @arguments
        if ($null -eq $LASTEXITCODE) {
            exit 0
        }
        exit $LASTEXITCODE
    }
    $inner = [Environment]::GetEnvironmentVariable('${WINDOWS_EDITOR_INNER_ENV}')
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-EncodedCommand', $encoded) -WindowStyle Hidden
    exit 0
} catch {
    exit 1
}
`.trim();

/** @typedef {{args: string[], command: string}} ConfiguredEditor */
/** @typedef {{once: { (event: 'error', listener: () => void): unknown, (event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown, (event: 'spawn', listener: () => void): unknown }, unref?: () => void}} EditorChildProcess */
/** @typedef {(command: string, args: readonly string[], options: {env?: NodeJS.ProcessEnv, stdio: 'ignore' | 'inherit', windowsHide: boolean}) => EditorChildProcess} EditorSpawn */

/** @param {unknown} value @returns {value is ConfiguredEditor} */
const isConfiguredEditor = value => value !== null
    && typeof value === 'object'
    && 'command' in value
    && typeof value.command === 'string'
    && 'args' in value
    && Array.isArray(value.args)
    && value.args.every(argument => typeof argument === 'string');

/** @param {ConfiguredEditor} editor @param {string} filePath @param {string} platform @param {boolean} wait */
const buildEditorLaunch = (editor, filePath, platform, wait) => {
    const args = editor.args.map(argument => argument.replace(FILE_ARGUMENT, () => filePath));
    if (platform !== 'win32') return {args, command: editor.command, environment: null};
    return {
        args: ['-NoProfile', '-Command', WINDOWS_EDITOR_LAUNCHER_SCRIPT],
        command: 'powershell.exe',
        environment: {
            [WINDOWS_EDITOR_ARGS_ENV]: JSON.stringify(args),
            [WINDOWS_EDITOR_COMMAND_ENV]: editor.command,
            [WINDOWS_EDITOR_INNER_ENV]: WINDOWS_EDITOR_INNER_SCRIPT,
            [WINDOWS_EDITOR_WAIT_ENV]: String(wait),
        },
    };
};

/**
 * @param {object} options
 * @param {unknown} options.editor
 * @param {string} options.filePath
 * @param {string} [options.platform]
 * @param {EditorSpawn} [options.spawn]
 * @param {boolean} [options.wait]
 * @returns {Promise<void>}
 */
export const launchConfiguredEditor = async ({
    editor,
    filePath,
    platform = process.platform,
    spawn = spawnProcess,
    wait = false,
}) => {
    if (!isConfiguredEditor(editor)) {
        throw new TypeError('editor must contain command and args.');
    }
    const launch = buildEditorLaunch(editor, filePath, platform, wait);

    /** @type {Promise<void>} */
    const completion = new Promise((resolve, reject) => {
        let settled = false;
        let child;
        /** @param {() => void} callback */
        const finish = callback => {
            if (settled) return;
            settled = true;
            callback();
        };
        try {
            child = spawn(launch.command, launch.args, {
                env: launch.environment ? {...process.env, ...launch.environment} : undefined,
                stdio: wait ? 'inherit' : 'ignore',
                windowsHide: true,
            });
        } catch {
            reject(new Error('Editor command could not be started.'));
            return;
        }
        child.once('error', () => finish(() => reject(new Error('Editor command could not be started.'))));
        if (wait || platform === 'win32') {
            child.once('exit', (code, signal) => {
                if (code === 0 && signal == null) {
                    finish(() => resolve());
                    return;
                }
                const outcome = signal == null ? `code ${code}` : `signal ${signal}`;
                finish(() => reject(new Error(`Editor launcher exited with ${outcome}.`)));
            });
            return;
        }
        child.once('spawn', () => {
            child.unref?.();
            finish(() => resolve());
        });
    });
    await completion;
};
