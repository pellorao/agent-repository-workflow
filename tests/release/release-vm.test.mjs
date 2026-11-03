import assert from 'node:assert/strict';
import {chmod, copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {createTemporaryDirectory} from '../helpers/cleanup.mjs';
import {installFakeCommand, runProcess} from '../helpers/process.mjs';

test('release-vm check transfers the fixture and forwards --fixture and --previous to the guest check on every Node.js executable', async t => {
    const directory = await createTemporaryDirectory(t, 'arw-release-vm-');
    const log = join(directory, 'ssh.log');
    const vmrun = join(directory, 'vmrun');
    await writeFile(vmrun, '#!/bin/sh\necho 10.0.0.1\n');
    await chmod(vmrun, 0o755);
    await installFakeCommand(t, directory, 'ssh', `echo "$*" >> '${log}'\n`);
    await installFakeCommand(t, directory, 'scp', `echo "scp $*" >> '${log}'\n`);
    await writeFile(join(directory, 'agent-assisted.tgz'), 'fixture');
    const config = join(directory, 'vm.json');
    await writeFile(config, JSON.stringify({fixturesDirectory: directory, machines: {M: {
        vmrun, location: 'x.vmx', snapshot: 's',
        ssh: {user: 'u', port: 22, identityFile: 'key', hostKey: 'ssh-ed25519 AAAA'},
        nodeExecutables: {recommended: '/n/node', minimum: '/m/node'},
    }}}));
    const bundle = join(directory, 'candidate.bundle');
    const archive = join(directory, 'arw.tar.gz');
    await writeFile(bundle, 'bundle');
    await writeFile(archive, 'archive');
    const result = await runProcess(process.execPath, ['scripts/release-vm.mjs', 'check', 'M', bundle, '--archive', archive, '--config', config, '--previous', 'abc1234'], {env: process.env});
    assert.equal(result.status === 'exited' && result.stdout.trim(), 'M: PASS');
    const calls = (await readFile(log, 'utf8')).split('\n');
    assert.ok(calls.some(call => call.startsWith('scp ') && call.includes(' arw-candidate.bundle arw-fixture.tgz arw-archive.tar.gz ')));
    for (const node of ['/n/node', '/m/node']) {
        assert.ok(calls.some(call => call.endsWith(`${node} arw-candidate/scripts/release-guest-check.mjs --fixture arw-fixture.tgz --archive arw-archive.tar.gz --previous abc1234`)), node);
    }
});

test('release-vm check rejects a missing or malformed --previous value with a usage error', async () => {
    const cases = [['--previous'], ['--previous', 'v0.5.0'], ['--previous', 'abc12']];
    const results = await Promise.all(cases.map(args => runProcess(process.execPath, ['scripts/release-vm.mjs', 'check', 'M', 'none.bundle', '--archive', 'none.tar.gz', '--config', 'none.json', ...args], {env: process.env})));
    for (const [index, result] of results.entries()) {
        assert.ok(result.status === 'exited' && result.exitCode === 2 && result.stderr.includes('--previous expects a commit'), cases[index].join(' '));
    }
});

test('release-vm check requires --archive with a value', async () => {
    const results = await Promise.all([[], ['--archive'], ['--archive', '--config', 'x.json']].map((/** @type {string[]} */ args) => runProcess(process.execPath, ['scripts/release-vm.mjs', 'check', 'M', 'none.bundle', ...args], {env: process.env})));
    for (const result of results) assert.ok(result.status === 'exited' && result.exitCode === 2 && result.stderr.includes('--archive <arw.tar.gz> is required'));
});

test('release-vm check requires fixturesDirectory in the config', async t => {
    const directory = await createTemporaryDirectory(t, 'arw-release-vm-');
    const config = join(directory, 'vm.json');
    await writeFile(config, JSON.stringify({machines: {M: {}}}));
    const result = await runProcess(process.execPath, ['scripts/release-vm.mjs', 'check', 'M', 'none.bundle', '--archive', 'none.tar.gz', '--config', config], {env: process.env});
    assert.ok(result.status === 'exited' && result.exitCode === 2 && result.stderr.includes('fixturesDirectory'));
});

const SECRET = 'S3CRET-password';
const SSH = {user: 'shared-user', port: 22, identityFile: 'shared-key', hostKey: 'ssh-ed25519 AAAA'};

/** 假 vmrun/ssh/scp, 临时仓库根 (含复制的脚本) 和 fixture. @param {import('node:test').TestContext} t */
const setup = async t => {
    const directory = await createTemporaryDirectory(t, 'arw-release-vm-');
    const log = join(directory, 'ssh.log');
    const vmrun = join(directory, 'vmrun');
    await writeFile(vmrun, '#!/bin/sh\necho 10.0.0.1\n');
    await chmod(vmrun, 0o755);
    await installFakeCommand(t, directory, 'ssh', `echo "$*" >> '${log}'\n`);
    await installFakeCommand(t, directory, 'scp', `echo "scp $*" >> '${log}'\n`);
    await writeFile(join(directory, 'agent-assisted.tgz'), 'fixture');
    await writeFile(join(directory, 'candidate.bundle'), 'bundle');
    await writeFile(join(directory, 'arw.tar.gz'), 'archive');
    // 每个仓库根各含一份脚本副本 (脚本按自身位置找 .arw.local.json), 让用例可以并行.
    /** @param {string} name @param {string} [local] */
    const root = async (name, local) => {
        await mkdir(join(directory, name, 'scripts'), {recursive: true});
        await copyFile('scripts/release-vm.mjs', join(directory, name, 'scripts', 'release-vm.mjs'));
        if (local !== undefined) await writeFile(join(directory, name, '.arw.local.json'), local);
        return (/** @type {string[]} */ args, cwd = directory) => runProcess(process.execPath, [join(directory, name, 'scripts', 'release-vm.mjs'), ...args], {cwd, env: process.env});
    };
    const write = (/** @type {string} */ name, /** @type {unknown} */ value) => writeFile(join(directory, name), JSON.stringify(value));
    const run = await root('repo');
    const calls = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n');
    const machine = {vmrun, location: 'x.vmx', snapshot: 's', ssh: SSH, nodeExecutables: {recommended: '/shared/node', minimum: '/shared/min'}};
    return {directory, root, write, run, calls, machine, bundle: join(directory, 'candidate.bundle'), archive: join(directory, 'arw.tar.gz')};
};

test('release-vm merges the shared machines file under the ARW config per machine key, shallowly', async t => {
    const {directory, write, run, calls, machine, bundle, archive} = await setup(t);
    await write('shared.json', {fixturesDirectory: '/ignored', sharedMachinesConfig: 'missing.json', machines: {Both: machine, SharedOnly: machine}});
    // fixturesDirectory 与 sharedMachinesConfig 相对 ARW 配置所在目录; ssh 对象整体替换.
    await write('arw.json', {fixturesDirectory: '.', sharedMachinesConfig: 'shared.json', machines: {
        Both: {nodeExecutables: {recommended: '/arw/node', minimum: '/arw/min'}, ssh: {port: 2222}},
        ArwOnly: {...machine, nodeExecutables: {recommended: '/arw-only/node'}},
    }});
    // 工作目录不同于配置文件目录, 相对 fixturesDirectory 只能按配置文件目录解析.
    const elsewhere = join(directory, 'repo');
    await write('nofixtures.json', {sharedMachinesConfig: 'shared.json', machines: {}});
    const [missing, ...results] = await Promise.all([
        run(['check', 'Both', bundle, '--archive', archive, '--config', join(directory, 'nofixtures.json')], elsewhere),
        ...['Both', 'SharedOnly', 'ArwOnly'].map(key => run(['check', key, bundle, '--archive', archive, '--config', join(directory, 'arw.json')], elsewhere)),
    ]);
    for (const result of results) assert.equal(result.status === 'exited' && result.stdout.trim().endsWith('PASS'), true);
    const lines = await calls();
    const ran = (/** @type {string} */ node) => lines.some(line => line.endsWith(`${node} arw-candidate/scripts/release-guest-check.mjs --fixture arw-fixture.tgz --archive arw-archive.tar.gz`));
    for (const node of ['/arw/node', '/arw/min', '/shared/node', '/shared/min', '/arw-only/node']) assert.ok(ran(node), node);
    // ssh 对象整体替换: ARW 只给 port, 共用的 user 与 identityFile 不保留.
    assert.ok(lines.some(line => line.includes('-p 2222 ') && line.includes('undefined@')));
    assert.ok(lines.some(line => line.includes('-p 22 ') && line.includes('shared-user@') && line.includes('-i shared-key')));
    assert.ok(!lines.some(line => line.includes('-p 2222 ') && (line.includes('shared-user') || line.includes('shared-key'))));
    // 共用文件的顶层键被忽略: ARW 配置缺 fixturesDirectory 时仍报缺失.
    assert.ok(missing.status === 'exited' && missing.exitCode === 2 && missing.stderr.includes('fixturesDirectory'));
});

test('release-vm accepts an absolute sharedMachinesConfig and rejects unreadable configs with exit 2 without echoing contents', async t => {
    const {directory, write, run, machine, bundle, archive} = await setup(t);
    const file = (/** @type {string} */ name) => join(directory, name);
    await write('shared.json', {machines: {M: machine}});
    await write('absolute.json', {fixturesDirectory: directory, sharedMachinesConfig: file('shared.json'), machines: {}});
    await writeFile(file('badshared.json'), `{"password": "${SECRET}" oops`);
    await writeFile(file('notjson.json'), 'not json');
    await mkdir(file('adir'));
    await writeFile(file('null.json'), 'null');
    await writeFile(file('array.json'), '[]');
    await writeFile(file('badutf8.json'), Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]));
    await write('sharednull.json', {fixturesDirectory: directory, sharedMachinesConfig: 'null.json'});
    await write('sharedarray.json', {fixturesDirectory: directory, sharedMachinesConfig: 'array.json'});
    await write('number.json', {fixturesDirectory: directory, sharedMachinesConfig: 5});
    for (const shared of ['missing.json', 'badshared.json', 'adir']) await write(`via-${shared}.json`, {fixturesDirectory: directory, sharedMachinesConfig: shared});
    const cases = [
        ['M', 'absolute.json', 'PASS'],
        ['M', 'via-missing.json.json', 'Shared machines config is not readable JSON'],
        ['M', 'via-badshared.json.json', 'Shared machines config is not readable JSON'],
        ['M', 'via-adir.json', 'Shared machines config is not readable JSON'],
        ['M', 'sharednull.json', 'Shared machines config is not readable JSON'],
        ['M', 'sharedarray.json', 'Shared machines config is not readable JSON'],
        ['M', 'null.json', 'Config file is not readable JSON'],
        ['M', 'array.json', 'Config file is not readable JSON'],
        ['M', 'badutf8.json', 'Config file is not readable JSON'],
        ['M', 'number.json', 'sharedMachinesConfig must be a path string'],
        ['M', 'absent.json', 'Config file is not readable JSON'],
        ['M', 'notjson.json', 'Config file is not readable JSON'],
        ['M', 'adir', 'Config file is not readable JSON'],
        ['Nope', 'shared.json', 'Machine not found in config: Nope'],
    ];
    const results = await Promise.all(cases.map(([key, config]) => run(['check', key, bundle, '--archive', archive, '--config', file(config)])));
    for (const [index, result] of results.entries()) {
        const [, config, expected] = cases[index];
        assert.ok(result.status === 'exited', config);
        if (expected === 'PASS') assert.ok(result.stdout.trim().endsWith('PASS'), config);
        else assert.ok(result.exitCode === 2 && result.stderr.includes(expected) && !result.stderr.includes(SECRET), config);
    }
});

test('release-vm reads the release object of .arw.local.json at the script repository root and lets --config override it', async t => {
    const {directory, root, write, machine, bundle, archive} = await setup(t);
    const outside = await createTemporaryDirectory(t, 'arw-release-vm-cwd-');
    await write('shared.json', {machines: {M: machine}});
    await write('override.json', {fixturesDirectory: directory, machines: {}});
    // 相对路径相对 .arw.local.json 所在目录 (仓库根), 工作目录在别处也成立.
    const good = await root('good', JSON.stringify({release: {fixturesDirectory: '..', sharedMachinesConfig: '../shared.json'}}));
    const noRelease = 'No release config: pass --config <path> or add a "release" object to .arw.local.json.';
    const cases = [
        [await root('absent'), noRelease],
        [await root('empty', '{}'), noRelease],
        [await root('scalar', '{"release": 5}'), noRelease],
        [await root('nullrelease', '{"release": null}'), noRelease],
        [await root('arrayrelease', '{"release": []}'), noRelease],
        [await root('nullfile', 'null'), 'Config file is not readable JSON'],
        [await root('arrayfile', '[]'), 'Config file is not readable JSON'],
        [await root('bad', `{"release": "${SECRET}" x`), 'Config file is not readable JSON'],
    ];
    await mkdir(join(directory, 'dir', '.arw.local.json'), {recursive: true});
    cases.push([await root('dir'), 'Config file is not readable JSON']);
    const [pass, override, ...failures] = await Promise.all([
        good(['check', 'M', bundle, '--archive', archive], outside),
        good(['check', 'M', bundle, '--archive', archive, '--config', join(directory, 'override.json')], outside),
        ...cases.map(([run]) => /** @type {Function} */ (run)(['check', 'M', bundle, '--archive', archive], outside)),
    ]);
    assert.ok(pass.status === 'exited' && pass.stdout.trim() === 'M: PASS');
    assert.ok(override.status === 'exited' && override.exitCode === 2 && override.stderr.includes('Machine not found'));
    for (const [index, result] of failures.entries()) {
        assert.ok(result.status === 'exited' && result.exitCode === 2 && result.stderr.includes(String(cases[index][1])) && !result.stderr.includes(SECRET), String(cases[index][1]));
    }
});

test('the repository ignores .arw.local.json', async () => {
    assert.ok((await readFile('.gitignore', 'utf8')).split('\n').includes('/.arw.local.json'));
});
