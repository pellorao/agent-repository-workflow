import assert from 'node:assert/strict';
import {chmod, readFile, writeFile} from 'node:fs/promises';
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
    await writeFile(bundle, 'bundle');
    const result = await runProcess(process.execPath, ['scripts/release-vm.mjs', 'check', config, 'M', bundle, '--previous', 'abc1234'], {env: process.env});
    assert.equal(result.status === 'exited' && result.stdout.trim(), 'M: PASS');
    const calls = (await readFile(log, 'utf8')).split('\n');
    assert.ok(calls.some(call => call.startsWith('scp ') && call.includes(' arw-candidate.bundle arw-fixture.tgz ')));
    for (const node of ['/n/node', '/m/node']) {
        assert.ok(calls.some(call => call.endsWith(`${node} arw-candidate/scripts/release-guest-check.mjs --fixture arw-fixture.tgz --previous abc1234`)), node);
    }
});

test('release-vm check rejects a missing or malformed --previous value with a usage error', async () => {
    const cases = [['--previous'], ['--previous', 'v0.5.0'], ['--previous', 'abc12']];
    const results = await Promise.all(cases.map(args => runProcess(process.execPath, ['scripts/release-vm.mjs', 'check', 'none.json', 'M', 'none.bundle', ...args], {env: process.env})));
    for (const [index, result] of results.entries()) {
        assert.ok(result.status === 'exited' && result.exitCode === 2 && result.stderr.includes('--previous expects a commit'), cases[index].join(' '));
    }
});

test('release-vm check requires fixturesDirectory in the config', async t => {
    const directory = await createTemporaryDirectory(t, 'arw-release-vm-');
    const config = join(directory, 'vm.json');
    await writeFile(config, JSON.stringify({machines: {M: {}}}));
    const result = await runProcess(process.execPath, ['scripts/release-vm.mjs', 'check', config, 'M', 'none.bundle'], {env: process.env});
    assert.ok(result.status === 'exited' && result.exitCode === 2 && result.stderr.includes('fixturesDirectory'));
});
