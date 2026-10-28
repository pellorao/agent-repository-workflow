import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('both Skills manuals mention every distributed Skill', async () => {
    const skills = (await readdir(new URL('distribution/skills/', root), {withFileTypes: true})).filter(entry => entry.isDirectory()).map(entry => entry.name);
    for (const manual of ['skills.md', 'skills.zh-CN.md']) {
        const text = await readFile(new URL(`docs/manuals/${manual}`, root), 'utf8');
        assert.deepEqual(skills.filter(name => !text.includes(`\`${name}\``)), [], `${manual} is missing Skills.`);
    }
});
