import {FORMATTERS, formatValue} from './value-format.mjs';

export const LINE_END = '\r\n';

const NEEDS_QUOTES = /[",\r\n]/;

export const quoteField = (text) => (NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text);

export const formatLine = (fields) => `${fields.map(quoteField).join(',')}${LINE_END}`;

export const prepareColumns = (columns) => {
    const names = new Set();
    return columns.map((column, index) => {
        const name = typeof column.name === 'string' ? column.name.trim() : '';
        if (!name) throw new Error(`column ${index + 1} needs a name`);
        if (names.has(name)) throw new Error(`column ${name} is listed twice`);
        if (!Object.hasOwn(FORMATTERS, column.kind)) throw new Error(`column ${name} has an unknown kind`);
        names.add(name);
        return Object.freeze({name, kind: column.kind});
    });
};

export const buildCsv = (rawColumns, rows) => {
    const columns = prepareColumns(rawColumns);
    const header = formatLine(columns.map((column) => column.name));
    const body = rows.map((row) => formatLine(columns.map((column) => formatValue(column.kind, row[column.name]))));
    return [header, ...body].join('');
};
