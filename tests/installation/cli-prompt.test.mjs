import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';

import {askYesNo} from '../../lib/installation/cli-prompt.mjs';

/** 内存 readline: 按序给出答案, 队列耗尽后像关闭的 readline 一样拒绝. */
const createReadline = (/** @type {string[]} */ answers) => Object.assign(new EventEmitter(), {
    question: async () => {
        const answer = answers.shift();
        if (answer === undefined) throw new Error('readline was closed');
        return answer;
    },
});

const ask = (/** @type {string[]} */ answers, writeInvalid = () => {}) => askYesNo({
    question: 'Register PATH? ',
    // @ts-expect-error in-memory readline double
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
    const readline = Object.assign(new EventEmitter(), {question: () => new Promise(() => {})});
    // @ts-expect-error in-memory readline double
    const pending = askYesNo({question: 'Register PATH? ', readline, writeInvalid: () => {}});
    readline.emit('close');
    await assert.rejects(pending, /Interactive input ended/u);
});
