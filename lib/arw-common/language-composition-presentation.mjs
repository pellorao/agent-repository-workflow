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

/** @param {{languageComposition: LanguageComposition[], languageChecks: import('./language-checks.mjs').LanguageChecksResult}} result @param {{verbose?: boolean}} options */
export const renderLanguageChecks = (result, {verbose = false} = {}) => {
    const rows = new Map(result.languageComposition.map(row => [row.path, row]));
    const blocks = [];
    if (result.languageChecks.status === 'unconfigured') blocks.push('Language checks: unconfigured.');
    for (const check of result.languageChecks.checks) {
        const lines = [];
        lines.push(`Language check ${JSON.stringify(check.name)}: ${check.language}; minimum ${check.effectiveMinPercentage}%; passed ${check.summary.passed}; failed ${check.summary.failed}; indeterminate ${check.summary.indeterminate}.`);
        if (check.documents.length === 0) lines.push('No documents selected.');
        const selected = check.documents.filter(document => verbose || document.status !== 'passed');
        if (selected.length > 0) lines.push(formatTable(
            ['Document', 'Chinese', 'English', 'Other', 'Result'],
            selected.map(document => {
                const row = rows.get(document.path);
                if (row === undefined) throw new Error('Language check document has no composition.');
                return [row.path, displayPercentage(row.chinese), displayPercentage(row.english), displayPercentage(row.other), document.status];
            }),
        ));
        blocks.push(lines.join('\n'));
    }
    if (result.languageChecks.uncovered.length > 0) {
        const lines = [`Uncovered documents: ${result.languageChecks.uncovered.length}.`];
        if (verbose) lines.push(renderLanguageCompositionTable(result.languageChecks.uncovered.map(path => {
            const row = rows.get(path);
            if (row === undefined) throw new Error('Uncovered document has no composition.');
            return row;
        })));
        else lines.push(...result.languageChecks.uncovered);
        blocks.push(lines.join('\n'));
    }
    return blocks.join('\n\n');
};
