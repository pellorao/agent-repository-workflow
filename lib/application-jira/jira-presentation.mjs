import {formatTextTable} from '../common/text-table.mjs';

/** @param {{entries: Array<{key: string, title: string}>, total: number}} value */
export const renderJiraList = value => {
    if (value.entries.length === 0) {
        return `Total matching issues: ${value.total}\nNo matching JIRA issues.`;
    }
    return [
        `Total matching issues: ${value.total}`,
        `Showing first ${value.entries.length} issues ordered by key.`,
        '',
        formatTextTable(['Key', 'Title'], value.entries.map(entry => [entry.key, entry.title])),
    ].join('\n');
};
