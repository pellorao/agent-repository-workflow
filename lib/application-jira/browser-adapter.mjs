import {spawn} from 'node:child_process';

/** @param {NodeJS.ProcessEnv} environment */
const withoutJiraToken = environment => Object.fromEntries(
    Object.entries(environment).filter(([name]) => name.toUpperCase() !== 'JIRA_ACCESS_TOKEN'),
);

/** @param {{environment?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, spawnProcess?: typeof spawn}} [dependencies] */
export const createDefaultBrowserAdapter = (dependencies = {}) => ({
    /** @param {string} url */
    open: async url => {
        if (typeof url !== 'string' || !/^https?:\/\//u.test(url)) throw new TypeError('Browser URL must be an absolute HTTP or HTTPS URL.');
        const platform = dependencies.platform ?? process.platform;
        const command = platform === 'win32' ? 'rundll32.exe' : platform === 'darwin' ? 'open' : 'xdg-open';
        const args = platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
        const spawnProcess = dependencies.spawnProcess ?? spawn;
        return await new Promise(resolvePromise => {
            let settled = false;
            const finish = (/** @type {unknown} */ result) => {
                if (settled) return;
                settled = true;
                resolvePromise(result);
            };
            const child = spawnProcess(command, args, {
                env: withoutJiraToken(dependencies.environment ?? process.env),
                shell: false,
                stdio: 'ignore',
                windowsHide: true,
            });
            child.once('error', () => finish({
                diagnostics: [{code: 'browser-start-failed', message: 'The default browser could not be started.'}],
                stage: 'browser',
                status: 'failed',
            }));
            child.once('spawn', () => {
                child.unref();
                finish({diagnostics: [], status: 'succeeded'});
            });
        });
    },
});
