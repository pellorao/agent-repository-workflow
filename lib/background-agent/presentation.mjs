import {stripVTControlCharacters} from 'node:util';
import {formatTextTable} from '../common/text-table.mjs';

/** @typedef {{role:string,ownerId:string,ownerTitle:string|null,state:string,taskElapsedMs:number|null,taskElapsedEstimated?:boolean|null,taskElapsedBasis?:string|null}} BackgroundAgentOverview */

/** @param {number|null} milliseconds */
const elapsed = milliseconds => {
    if (milliseconds === null) return '-';
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

/** @param {string} value */
const cell = value => stripVTControlCharacters(value).replace(/[\\\p{Cc}\p{Bidi_Control}]/gu, character => {
    if (character === '\\') return '\\\\';
    if (character === '\r') return '\\r';
    if (character === '\n') return '\\n';
    if (character === '\t') return '\\t';
    if (character === '\0') return '\\0';
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
});

/** @param {string|null} title */
const titleCell = title => title === null || title.trim().length === 0
    ? '\u001b[90mN/A\u001b[0m' : cell(title);

/** The manager may run older code than this command, so the row shape is checked once at the boundary. @param {unknown[]} rows */
export const assertBackgroundAgentRows = rows => {
    /** @param {unknown} value @param {string} type @param {boolean} nullable */
    const is = (value,type,nullable) => typeof value === type || (nullable && value === null);
    if (rows.every(row => typeof row === 'object' && row !== null
        && ['role','ownerId','state'].every(key => is(/** @type {Record<string,unknown>} */ (row)[key],'string',false))
        && is(/** @type {Record<string,unknown>} */ (row).ownerTitle,'string',true) && is(/** @type {Record<string,unknown>} */ (row).taskElapsedMs,'number',true))) return;
    throw new Error('The manager process runs code incompatible with this command. Use the installed `arw lba`, and run `node install.mjs` once the background Agents are idle.');
};

/** @param {BackgroundAgentOverview[]} rows */
export const renderBackgroundAgents = rows => {
    return formatTextTable(
        ['Status', 'Role', 'Main session', 'Elapsed'],
        rows.map(row => [cell(row.state), cell(row.role), `${titleCell(row.ownerTitle)} (${cell(row.ownerId)})`, elapsed(row.taskElapsedMs)]),
    );
};
