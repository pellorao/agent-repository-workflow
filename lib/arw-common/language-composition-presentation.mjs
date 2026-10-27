/** @typedef {{chinese: number | null, english: number | null, other: number | null, path: string}} LanguageComposition */

/** @param {number | null} value */
const displayPercentage = value => value === null ? '-' : `${value.toFixed(1)}%`;

/** @param {string[]} headings @param {string[][]} rows */
const formatTable = (headings, rows) => {
    const widths = headings.map((heading, index) => Math.max(
        heading.length,
        ...rows.map(row => row[index].length),
    ));
    const formatRow = (/** @type {string[]} */ row) => row
        .map((value, index) => index === row.length - 1 ? value : value.padEnd(widths[index]))
        .join('  ');
    return [formatRow(headings), formatRow(widths.map(width => '-'.repeat(width))), ...rows.map(formatRow)].join('\n');
};

/** @param {LanguageComposition[]} rows */
export const renderLanguageCompositionTable = rows => formatTable(
    ['Document', 'Chinese', 'English', 'Other'],
    rows.map(row => [
        row.path,
        displayPercentage(row.chinese),
        displayPercentage(row.english),
        displayPercentage(row.other),
    ]),
);
