import {isAbsolute, join, resolve} from 'node:path';

/** @param {NodeJS.ProcessEnv} environment @param {string} platform */
export function codexHomeLocation(environment, platform) {
  if (!['linux', 'darwin', 'win32'].includes(platform)) {
    throw new Error(`Unsupported Codex home platform: ${platform}.`);
  }
  const configured = environment.CODEX_HOME;
  if (typeof configured === 'string' && configured.length > 0) {
    return {directory: resolve(configured), defaultParent: null};
  }
  const variable = platform === 'win32' ? 'USERPROFILE' : 'HOME';
  const home = environment[variable];
  if (typeof home !== 'string' || !isAbsolute(home)) {
    throw new Error(`Cannot resolve an absolute ${variable} directory.`);
  }
  return {directory: join(home, '.codex'), defaultParent: home};
}
