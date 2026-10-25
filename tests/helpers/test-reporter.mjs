import {inspect} from 'node:util';

/** @param {AsyncIterable<{type: string, data: Record<string, any>}>} events */
export default async function* report(events) {
    for await (const {type, data} of events) {
        if (type === 'test:stdout' || type === 'test:stderr') {
            yield data.message;
        } else if (type === 'test:fail') {
            yield `FAIL ${data.name}${data.file === undefined ? '' : ` (${data.file}:${data.line ?? 1}:${data.column ?? 1})`}\n`;
            yield `${inspect(data.details?.error, {depth: null, colors: false})}\n`;
        } else if (type === 'test:diagnostic') {
            yield `${data.message}\n`;
        }
    }
}
