import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const HELP = `Usage:
  todo add <title>
  todo done <id>
  todo help`;

const load = async (directory, name) => JSON.parse(await readFile(join(directory, name), 'utf8').catch(() => '[]'));
const save = (directory, name, items) => writeFile(join(directory, name), `${JSON.stringify(items, null, 2)}\n`);

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
    stdout(HELP);
    return command === 'help' ? 0 : 1;
};
