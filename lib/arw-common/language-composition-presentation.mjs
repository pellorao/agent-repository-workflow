import {formatTextTable} from '../common/text-table.mjs';

/** @typedef {{chinese: number | null, english: number | null, other: number | null, path: string}} LanguageComposition */

/** @param {number | null} value */
const displayPercentage = value => value === null ? '-' : `${value.toFixed(1)}%`;

/** @param {LanguageComposition[]} rows */
export const renderLanguageCompositionTable = rows => formatTextTable(
    ['Document', 'Chinese', 'English', 'Other'],
    rows.map(row => [
        row.path,
        displayPercentage(row.chinese),
        displayPercentage(row.english),
        displayPercentage(row.other),
    ]),
);
