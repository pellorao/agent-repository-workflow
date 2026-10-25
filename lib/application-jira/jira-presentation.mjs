/** @param {string[]} headings @param {string[][]} rows */
const formatTable = (headings, rows) => {
    const widths = headings.map((heading, index) => Math.max(heading.length, ...rows.map(row => row[index].length)));
    const formatRow = (/** @type {string[]} */ row) => row
        .map((value, index) => index === row.length - 1 ? value : value.padEnd(widths[index]))
        .join('  ');
    return [
        formatRow(headings),
        widths.map(width => '-'.repeat(width)).join('  '),
        ...rows.map(formatRow),
    ].join('\n');
};

/** @param {{entries: Array<{key: string, title: string}>, total: number}} value */
export const renderJiraList = value => {
    if (value.entries.length === 0) {
        return `Total matching issues: ${value.total}\nNo matching JIRA issues.`;
    }
    return [
        `Total matching issues: ${value.total}`,
        `Showing first ${value.entries.length} issues ordered by key.`,
        '',
        formatTable(['Key', 'Title'], value.entries.map(entry => [entry.key, entry.title])),
    ].join('\n');
};
