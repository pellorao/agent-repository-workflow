import assert from 'node:assert/strict';
import test from 'node:test';

import {createSubmoduleCoordinator} from '../../lib/application-jira/submodule-coordination.mjs';

test('Submodule switch completes all preflight before changing configured Modules', async () => {
    /** @type {string[]} */
    const events = [];
    const states = new Map([
        ['billing', {branch: 'main', clean: true, head: 'aaa', localBranchExists: false, remoteBranchExists: true}],
        ['ledger', {branch: 'dev', clean: true, head: 'bbb', localBranchExists: true, remoteBranchExists: true}],
    ]);
    const coordinator = createSubmoduleCoordinator({
        git: {
            inspectSwitch: async input => {
                events.push(`inspect:${input.module}`);
                const state = states.get(input.module);
                if (state === undefined) throw new Error('Unknown test Module.');
                return {diagnostics: [], state, status: 'succeeded'};
            },
            restore: async () => assert.fail('Successful switch must not recover.'),
            switchBranch: async input => {
                events.push(`switch:${input.module}:${input.mode}`);
                const previous = states.get(input.module);
                if (previous === undefined) throw new Error('Unknown test Module.');
                const state = {...previous, branch: 'dev', head: input.module === 'billing' ? 'ccc' : previous.head};
                states.set(input.module, state);
                return {diagnostics: [], state: {branch: state.branch, head: state.head}, status: 'succeeded'};
            },
        },
    });

    assert.deepEqual(await coordinator.switchBranch({
        modules: [
            {name: 'billing', repositoryRoot: '/repo/billing'},
            {name: 'ledger', repositoryRoot: '/repo/ledger'},
        ],
        remote: 'origin',
        targetBranch: 'dev',
    }), {
        diagnostics: [],
        finalStates: [
            {branch: 'dev', changed: true, head: 'ccc', module: 'billing'},
            {branch: 'dev', changed: false, head: 'bbb', module: 'ledger'},
        ],
        status: 'succeeded',
    });
    assert.deepEqual(events, [
        'inspect:billing',
        'inspect:ledger',
        'switch:billing:remote-tracking',
    ]);
});

test('Submodule switch failure restores changed Modules in reverse order and reports recovery', async () => {
    /** @type {string[]} */
    const events = [];
    const coordinator = createSubmoduleCoordinator({
        git: {
            inspectSwitch: async input => ({
                diagnostics: [],
                state: {branch: 'main', clean: true, head: input.module === 'billing' ? 'aaa' : 'bbb', localBranchExists: true, remoteBranchExists: true},
                status: 'succeeded',
            }),
            restore: async input => {
                events.push(`restore:${input.module}:${input.branch}:${input.head}`);
                return input.module === 'billing'
                    ? {diagnostics: [], state: {branch: input.branch, head: input.head}, status: 'succeeded'}
                    : {diagnostics: [{code: 'restore-failed', message: 'Restore failed.'}], state: {branch: 'dev', head: 'ddd'}, status: 'failed'};
            },
            switchBranch: async input => {
                events.push(`switch:${input.module}`);
                return input.module === 'ledger'
                    ? {diagnostics: [{code: 'switch-failed', message: 'Switch failed.'}], state: {branch: 'feature', head: 'eee'}, status: 'failed'}
                    : {diagnostics: [], state: {branch: 'dev', head: 'ccc'}, status: 'succeeded'};
            },
        },
    });

    assert.deepEqual(await coordinator.switchBranch({
        modules: [
            {name: 'billing', repositoryRoot: '/repo/billing'},
            {name: 'ledger', repositoryRoot: '/repo/ledger'},
        ],
        remote: 'origin',
        targetBranch: 'dev',
    }), {
        diagnostics: [{code: 'switch-failed', message: 'Switch failed.'}],
        finalStates: [
            {branch: 'main', changed: false, head: 'aaa', module: 'billing'},
            {branch: 'feature', changed: true, head: 'eee', module: 'ledger'},
        ],
        recovery: [{module: 'billing', status: 'restored'}],
        stage: 'switch',
        status: 'failed',
    });
    assert.deepEqual(events, ['switch:billing', 'switch:ledger', 'restore:billing:main:aaa']);
});

test('Remote convergence reports every configured Module state at each failure boundary', async () => {
    for (const failure of ['preflight', 'fetch', 'compare', 'fast-forward', 'final-verification']) {
        const coordinator = createSubmoduleCoordinator({
            git: {
                compareRemote: async input => failure === 'compare' && input.module === 'billing'
                    ? {diagnostics: [{code: 'compare-failed', message: 'Compare failed.'}], stage: 'final-verification', status: 'failed'}
                    : {diagnostics: [], relation: input.module === 'billing' ? 'behind' : 'equal', state: {branch: 'dev', head: input.module === 'billing' ? 'aaa' : 'ddd', remoteHead: 'ddd'}, status: 'succeeded'},
                fastForward: async () => failure === 'fast-forward'
                    ? {diagnostics: [{code: 'fast-forward-failed', message: 'Fast-forward failed.'}], state: {branch: 'dev', head: 'bbb'}, status: 'failed'}
                    : {diagnostics: [], state: {branch: 'dev', head: failure === 'final-verification' ? 'bbb' : 'ddd'}, status: 'succeeded'},
                fetch: async input => failure === 'fetch' && input.module === 'billing'
                    ? {diagnostics: [{code: 'fetch-failed', message: 'Fetch failed.'}], stage: 'fetch', status: 'failed'}
                    : {diagnostics: [], status: 'succeeded'},
                inspectConvergence: async input => failure === 'preflight' && input.module === 'billing'
                    ? {diagnostics: [{code: 'preflight-failed', message: 'Preflight failed.'}], state: {branch: 'dev', clean: false, head: 'aaa'}, stage: 'preflight', status: 'failed'}
                    : {diagnostics: [], state: {branch: 'dev', clean: true, head: input.module === 'billing' ? 'aaa' : 'ddd'}, status: 'succeeded'},
                inspectSwitch: async () => assert.fail('Switch interface is not used.'),
                restore: async () => assert.fail('Restore interface is not used.'),
                switchBranch: async () => assert.fail('Switch interface is not used.'),
            },
        });
        const result = await coordinator.convergeRemote({
            branch: 'dev',
            modules: [{name: 'billing', repositoryRoot: '/repo/billing'}, {name: 'ledger', repositoryRoot: '/repo/ledger'}],
            remote: 'origin',
        });
        assert.equal(result.status, 'failed', failure);
        assert.deepEqual(result.finalStates.map(state => state.module), ['billing', 'ledger'], failure);
    }
});

test('Remote convergence fetches every Module before fast-forwarding behind Modules', async () => {
    /** @type {string[]} */
    const events = [];
    const coordinator = createSubmoduleCoordinator({
        git: {
            compareRemote: async input => {
                events.push(`compare:${input.module}`);
                return {
                    diagnostics: [],
                    relation: input.module === 'billing' ? 'behind' : 'equal',
                    state: {branch: 'dev', head: input.module === 'billing' ? 'aaa' : 'ddd', remoteHead: 'ddd'},
                    status: 'succeeded',
                };
            },
            fastForward: async input => {
                events.push(`fast-forward:${input.module}`);
                return {diagnostics: [], state: {branch: 'dev', head: 'ddd'}, status: 'succeeded'};
            },
            fetch: async input => {
                events.push(`fetch:${input.module}`);
                return {diagnostics: [], status: 'succeeded'};
            },
            inspectConvergence: async input => {
                events.push(`inspect-convergence:${input.module}`);
                return {diagnostics: [], state: {branch: 'dev', clean: true, head: input.module === 'billing' ? 'aaa' : 'ddd'}, status: 'succeeded'};
            },
            inspectSwitch: async () => assert.fail('Switch interface is not used.'),
            restore: async () => assert.fail('Restore interface is not used.'),
            switchBranch: async () => assert.fail('Switch interface is not used.'),
        },
    });

    assert.deepEqual(await coordinator.convergeRemote({
        branch: 'dev',
        modules: [
            {name: 'billing', repositoryRoot: '/repo/billing'},
            {name: 'ledger', repositoryRoot: '/repo/ledger'},
        ],
        remote: 'origin',
    }), {
        diagnostics: [],
        effects: [
            {action: 'fast-forwarded', module: 'billing'},
            {action: 'unchanged', module: 'ledger'},
        ],
        finalStates: [
            {branch: 'dev', head: 'ddd', module: 'billing', remoteHead: 'ddd'},
            {branch: 'dev', head: 'ddd', module: 'ledger', remoteHead: 'ddd'},
        ],
        snapshots: [
            {head: 'ddd', module: 'billing', repositoryRoot: '/repo/billing'},
            {head: 'ddd', module: 'ledger', repositoryRoot: '/repo/ledger'},
        ],
        status: 'succeeded',
    });
    assert.deepEqual(events, [
        'inspect-convergence:billing',
        'inspect-convergence:ledger',
        'fetch:billing',
        'fetch:ledger',
        'compare:billing',
        'compare:ledger',
        'fast-forward:billing',
    ]);
});
