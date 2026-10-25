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

/** @param {BackgroundAgentOverview[]} rows */
export const renderBackgroundAgents = rows => {
    return formatTextTable(
        ['Status', 'Role', 'Main session', 'Elapsed'],
        rows.map(row => [cell(row.state), cell(row.role), `${titleCell(row.ownerTitle)} (${cell(row.ownerId)})`,
            elapsed(row.taskElapsedMs)]),
    );
};
