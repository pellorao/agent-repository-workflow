import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const HELP = `Usage:
  todo add <title>
  todo done <id>
  todo help`;

const load = async (directory, name) => JSON.parse(await readFile(join(directory, name), 'utf8').catch(() => '[]'));
const save = (directory, name, items) => writeFile(join(directory, name), `${JSON.stringify(items, null, 2)}\n`);

const archive = async ({rest, directory, todos, stdout, stderr}) => {
    const before = rest[rest.indexOf('--before') + 1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(before ?? '') || Number.isNaN(Date.parse(before))) {
        stderr(`Invalid date: ${before}`);
        return 1;
    }
    const archived = todos.filter(item => item.completedAt && item.completedAt.slice(0, 10) <= before);
    const kept = todos.filter(item => !archived.includes(item));
    await save(directory, 'archive.json', archived);
    await save(directory, 'todos.json', kept);
    stdout(`Archived ${archived.length} items.`);
    return 0;
};

export const run = async ({args, directory, stdout, stderr, now}) => {
    const [command, ...rest] = args;
    const todos = await load(directory, 'todos.json');
    if (command === 'add') {
        todos.push({id: todos.length + 1, title: rest.join(' ')});
        await save(directory, 'todos.json', todos);
        return 0;
    }
    if (command === 'done') {
        const item = todos.find(entry => entry.id === Number(rest[0]));
        if (!item) {
            stderr(`Unknown todo: ${rest[0]}`);
            return 1;
        }
        item.completedAt = now().toISOString();
        await save(directory, 'todos.json', todos);
        return 0;
    }
    if (command === 'archive') return archive({rest, directory, todos, stdout, stderr});
    stdout(HELP);
    return command === 'help' ? 0 : 1;
};
