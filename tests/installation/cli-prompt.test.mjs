import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {createInterface} from 'node:readline/promises';
import test from 'node:test';

import {askYesNo} from '../../lib/installation/cli-prompt.mjs';

/** 真实 readline 读内存流: 应答一次性写入缓冲后输入结束, 与管道输入一致. */
const createReadline = (/** @type {string[]} */ answers) => {
    const input = new PassThrough();
    const output = new PassThrough();
    input.end(answers.map(answer => `${answer}\n`).join(''));
    return createInterface({input, output});
};

const ask = (/** @type {string[]} */ answers, writeInvalid = () => {}) => askYesNo({
    question: 'Register PATH? ',
    readline: createReadline(answers),
    writeInvalid,
});

test('askYesNo maps the complete answer table', async () => {
    for (const [answer, expected] of /** @type {Array<[string, boolean]>} */ ([['y', true], [' YES ', true], ['', false], ['n', false], ['No', false]])) {
        assert.equal(await ask([answer]), expected, answer);
    }
});

test('askYesNo re-asks after an invalid answer and maps input end to the stable error', async () => {
    let invalid = 0;
    assert.equal(await ask(['maybe', 'y'], () => { invalid += 1; }), true);
    assert.equal(invalid, 1);
    await assert.rejects(ask(['maybe'], () => { invalid += 1; }), /^Error: Interactive input ended before a decision was provided\.$/u);
    assert.equal(invalid, 2);
});

test('askYesNo maps a readline close during the question to the stable error', async () => {
    const readline = createInterface({input: new PassThrough(), output: new PassThrough()});
    const pending = askYesNo({question: 'Register PATH? ', readline, writeInvalid: () => {}});
    readline.close();
    await assert.rejects(pending, /Interactive input ended/u);
});

test('askYesNo keeps answers that arrive together for later questions on the same readline', async () => {
    const readline = createReadline(['y', 'n', 'yes']);
    const results = [];
    for (let index = 0; index < 3; index += 1) results.push(await askYesNo({question: 'Q? ', readline, writeInvalid: () => {}}));
    assert.deepEqual(results, [true, false, true]);
    await assert.rejects(askYesNo({question: 'Q? ', readline, writeInvalid: () => {}}), /Interactive input ended/u);
});
