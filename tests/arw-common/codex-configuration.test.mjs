import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareCodexConfiguration} from '../../lib/arw-common/codex-configuration.mjs';

const defaultBytes = Buffer.from('# Default\ninclude_collaboration_mode_instructions = false\n');
const prepare = (/** @type {string | null} */ text) => prepareCodexConfiguration({defaultBytes, sourceBytes: text === null ? null : Buffer.from(text)});

test('Codex configuration creates or prepends only a missing root setting', () => {
    for (const source of [null, '', 'model = "example"\r\n[features]\r\nfast = true\r\n',
        '[features]\ninclude_collaboration_mode_instructions = true\n',
        'prompt = """\ninclude_collaboration_mode_instructions = true\n"""\n',
        "prompt = '''include_collaboration_mode_instructions = true'''\n",
        'values = [{name = "one"}, {name = "two"}]\n[[agents]]\nname = "a"\n[[agents]]\nname = "b"\n']) {
        const result = prepare(source);
        assert.equal(result.status, 'succeeded', JSON.stringify(result));
        if (result.status !== 'succeeded') assert.fail();
        assert.equal(result.present, false);
        assert.deepEqual(result.bytes, Buffer.concat([defaultBytes, Buffer.from(source ?? '')]));
        const again = prepare(result.bytes.toString());
        assert.equal(again.status, 'succeeded');
        if (again.status !== 'succeeded') assert.fail();
        assert.equal(again.changed, false);
        assert.deepEqual(again.bytes, result.bytes);
    }
});

test('Codex configuration preserves both explicit booleans byte for byte', () => {
    for (const boolean of ['true', 'false']) {
        const source = `# User choice\r\n"include_collaboration_mode_instructions" = ${boolean} # retained\r\n[features]\r\nfast = true\r\n`;
        const result = prepare(source);
        assert.equal(result.status, 'succeeded');
        if (result.status !== 'succeeded') assert.fail();
        assert.equal(result.changed, false);
        assert.deepEqual(result.bytes, Buffer.from(source));
    }
});

test('Codex configuration blocks invalid or ambiguous content without writable bytes', () => {
    for (const source of ['include_collaboration_mode_instructions = "false"\n',
        'include_collaboration_mode_instructions = false\ninclude_collaboration_mode_instructions = true\n',
        'x = 1\nx = 2\n', 'x = "unterminated', 'x = "bad\\q"', 'x = 01', 'x = {y = true,}',
        '[x]\n[x]\n', 'x = []\n[[x]]\n', 'x = {a = 1}\n[x]\n', 'a.b = 1\n[a]\n',
        '[include_collaboration_mode_instructions]\nx = 1\n', 'x = true\r', 'x = [1 2]\n', 'x = 2026-02-30', 'x = 2026-01-01T24:00:00Z', 'x = true\u00a0', '[[x]]\n[x]\n',
        '\ufeff\ufeffx = true\n', '\n\ufeffx = true\n']) {
        const result = prepare(source);
        assert.equal(result.status, 'blocked', source);
        assert.equal('bytes' in result, false);
    }
});

test('Codex configuration preserves a leading UTF-8 BOM and inserts defaults after it', () => {
    for (const boolean of ['true', 'false']) {
        const source = Buffer.from(`\ufeffinclude_collaboration_mode_instructions = ${boolean}\r\n`);
        const result = prepareCodexConfiguration({sourceBytes: source, defaultBytes});
        assert.equal(result.status, 'succeeded');
        if (result.status !== 'succeeded') assert.fail();
        assert.equal(result.changed, false);
        assert.deepEqual(result.bytes, source);
    }
    for (const source of ['\ufeff', '\ufeff# User comment\r\n[features]\r\nfast = true\r\n']) {
        for (const defaults of [defaultBytes, Buffer.concat([Buffer.from('\ufeff'), defaultBytes])]) {
            const result = prepareCodexConfiguration({sourceBytes: Buffer.from(source), defaultBytes: defaults});
            assert.equal(result.status, 'succeeded');
            if (result.status !== 'succeeded') assert.fail();
            assert.deepEqual(result.bytes, Buffer.concat([Buffer.from('\ufeff'), defaultBytes, Buffer.from(source.slice(1))]));
            const again = prepareCodexConfiguration({sourceBytes: result.bytes, defaultBytes: defaults});
            assert.equal(again.status, 'succeeded');
            if (again.status !== 'succeeded') assert.fail();
            assert.equal(again.changed, false);
            assert.deepEqual(again.bytes, result.bytes);
        }
    }
});
