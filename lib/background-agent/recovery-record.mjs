import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat, open, rename, rm} from 'node:fs/promises';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {isJsonObject, parseJsonText} from '../common/json.mjs';

/** @typedef {import('./codex-app-server.mjs').NativeSettings} NativeSettings */
/** @typedef {{runId:string,ownerId:string,controllerId:string,role:string,settings:NativeSettings,cwd:string,readPaths:string[],writePaths:string[],instructions:string,threadId:string,sessionPath:string|null,recoveryPath:string}} BackgroundAgentRecoveryRecord */

/** @param {{stateDirectory:unknown,runId:string}} input */
export const backgroundAgentRecoveryPath = ({stateDirectory, runId}) => {
  if (typeof stateDirectory !== 'string' || !isAbsolute(stateDirectory) || !stateDirectory.trim()) {
    throw new Error('Background Agent stateDirectory must be an absolute caller-prepared directory.');
  }
  return join(resolve(stateDirectory), `background-agent-${runId}.json`);
};

/** @param {unknown} stateDirectory */
export const requireBackgroundAgentStateDirectory = async stateDirectory => {
  const path = dirname(backgroundAgentRecoveryPath({stateDirectory,runId:'check'}));
  const observed = await lstat(path);
  if (!observed.isDirectory()) throw new Error('Background Agent stateDirectory must be a caller-prepared directory.');
  return path;
};

/** @param {unknown} value @returns {BackgroundAgentRecoveryRecord} */
const requireRecord = value => {
  const settings = isJsonObject(value) && isJsonObject(value.settings) ? value.settings : null;
  if (!isJsonObject(value) || !settings
    || !['runId','ownerId','controllerId','role','cwd','instructions','threadId','recoveryPath'].every(key => typeof value[key] === 'string' && value[key].length > 0)
    || !(value.sessionPath === null || typeof value.sessionPath === 'string')
    || !Array.isArray(value.readPaths) || !value.readPaths.every(item => typeof item === 'string')
    || !Array.isArray(value.writePaths) || !value.writePaths.every(item => typeof item === 'string')
    || !['model','modelProvider','reasoningEffort'].every(key => typeof settings[key] === 'string')
    || !(settings.serviceTier === null || typeof settings.serviceTier === 'string')
    || !isJsonObject(settings.config)) {
    throw new Error('Background Agent recovery record is missing required binding facts.');
  }
  return /** @type {BackgroundAgentRecoveryRecord} */ (/** @type {unknown} */ (value));
};

/** @param {BackgroundAgentRecoveryRecord} record */
export const saveBackgroundAgentRecoveryRecord = async record => {
  requireRecord(record);
  const directory = dirname(record.recoveryPath);
  const observedDirectory = await lstat(directory);
  if (!observedDirectory.isDirectory()) throw new Error('Background Agent recovery directory is unavailable.');
  const temporaryPath = join(directory, `background-agent-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporaryPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    await rename(temporaryPath, record.recoveryPath);
  }
  catch (error) { await rm(temporaryPath, {force: true}); throw error; }
};

/** @param {string} recoveryPath @returns {Promise<BackgroundAgentRecoveryRecord>} */
export const readBackgroundAgentRecoveryRecord = async recoveryPath => {
  const observed = await lstat(recoveryPath);
  if (!observed.isFile() || observed.nlink !== 1) throw new Error('Background Agent recovery record is not a regular independent file.');
  const handle = await open(recoveryPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const actual = await handle.stat();
    if (!actual.isFile() || actual.nlink !== 1 || actual.dev !== observed.dev || actual.ino !== observed.ino) {
      throw new Error('Background Agent recovery record changed while reading.');
    }
    const parsed = parseJsonText(await handle.readFile());
    if (parsed.status !== 'succeeded') throw new Error('Background Agent recovery record is not valid JSON.');
    const record = requireRecord(parsed.value);
    if (record.recoveryPath !== recoveryPath || backgroundAgentRecoveryPath({stateDirectory:dirname(recoveryPath),runId:record.runId}) !== recoveryPath) {
      throw new Error('Background Agent recovery record path does not match its run.');
    }
    return record;
  } finally { await handle.close(); }
};
