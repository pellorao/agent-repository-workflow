import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

import {run} from '../src/cli.mjs';

const setup = async todos => {
    const directory = await mkdtemp(join(tmpdir(), 'todo-'));
    await writeFile(join(directory, 'todos.json'), JSON.stringify(todos));
    const output = [];
    const cli = args => run({args, directory, stdout: line => output.push(line), stderr: line => output.push(line), now: () => new Date('2026-03-01T00:00:00Z')});
    return {cli, directory, output};
};

test('archives completed items before the date and keeps open ones', async () => {
    const {cli, directory, output} = await setup([
        {id: 1, title: 'old', completedAt: '2026-01-05T10:00:00Z'},
        {id: 2, title: 'open'},
    ]);
    assert.equal(await cli(['archive', '--before', '2026-02-01']), 0);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'archive.json'), 'utf8')).map(item => item.id), [1]);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'todos.json'), 'utf8')).map(item => item.id), [2]);
    assert.deepEqual(output, ['Archived 1 items.']);
});

test('an invalid date changes no file', async () => {
    const {cli, directory, output} = await setup([{id: 1, title: 'old', completedAt: '2026-01-05T10:00:00Z'}]);
    const before = await readFile(join(directory, 'todos.json'), 'utf8');
    assert.notEqual(await cli(['archive', '--before', 'soon']), 0);
    assert.equal(await readFile(join(directory, 'todos.json'), 'utf8'), before);
    await assert.rejects(readFile(join(directory, 'archive.json')));
    assert.deepEqual(output, ['Invalid date: soon']);
});
