import {formatTextTable} from '../common/text-table.mjs';

/** @typedef {import('../common/document-language.mjs').LanguageComposition} LanguageComposition */

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
