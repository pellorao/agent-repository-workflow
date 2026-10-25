import {isJsonObject} from '../common/json.mjs';
/** @typedef {{code: string, message: string}} Diagnostic */
/** @typedef {{branch: string, clean: boolean, head: string, localBranchExists: boolean, remoteBranchExists: boolean}} SwitchInspectionState */
/** @typedef {{diagnostics: Diagnostic[], state: SwitchInspectionState, status: 'succeeded'} | {diagnostics: Diagnostic[], stage?: string, state?: {branch: string, head: string}, status: 'failed'}} SwitchInspectionResult */
/** @typedef {{diagnostics: Diagnostic[], state: {branch: string, head: string}, status: 'succeeded' | 'failed'}} SwitchEffectResult */
/** @typedef {'ahead' | 'behind' | 'diverged' | 'equal'} RemoteRelation */
/** @typedef {{diagnostics: Diagnostic[], state: {branch: string, clean: boolean, head: string}, status: 'succeeded'} | {diagnostics: Diagnostic[], stage?: string, state?: {branch: string, clean: boolean, head: string}, status: 'failed'}} ConvergenceInspectionResult */
/** @typedef {{diagnostics: Diagnostic[], relation: RemoteRelation, state: {branch: string, head: string, remoteHead: string}, status: 'succeeded'} | {diagnostics: Diagnostic[], stage?: string, status: 'failed'}} CompareRemoteResult */
/** @typedef {{diagnostics: Diagnostic[], status: 'succeeded'} | {diagnostics: Diagnostic[], stage?: string, status: 'failed'}} GitEffectResult */
/** @typedef {{compareRemote?: (input: {branch: string, module: string, remote: string, repositoryRoot: string}) => Promise<CompareRemoteResult>, fastForward?: (input: {branch: string, module: string, remote: string, repositoryRoot: string}) => Promise<SwitchEffectResult>, fetch?: (input: {branch: string, module: string, remote: string, repositoryRoot: string}) => Promise<GitEffectResult>, inspectConvergence?: (input: {branch: string, module: string, repositoryRoot: string}) => Promise<ConvergenceInspectionResult>, inspectSwitch: (input: {module: string, remote: string, repositoryRoot: string, targetBranch: string}) => Promise<SwitchInspectionResult>, restore: (input: {branch: string, head: string, module: string, repositoryRoot: string}) => Promise<SwitchEffectResult>, switchBranch: (input: {mode: 'local' | 'remote-tracking', module: string, remote: string, repositoryRoot: string, targetBranch: string}) => Promise<SwitchEffectResult>}} SwitchGitAdapter */

/** @param {{git: SwitchGitAdapter}} dependencies */
export const createSubmoduleCoordinator = dependencies => {
    if (!isJsonObject(dependencies)
        || !isJsonObject(dependencies.git)
        || typeof dependencies.git.inspectSwitch !== 'function'
        || typeof dependencies.git.switchBranch !== 'function'
        || typeof dependencies.git.restore !== 'function') {
        throw new TypeError('Submodule Coordinator requires a complete Git Adapter.');
    }
    const git = dependencies.git;
    return Object.freeze({
        /** @param {{branch: string, modules: Array<{name: string, repositoryRoot: string}>, remote: string}} input */
        convergeRemote: async input => {
            if (!isJsonObject(input)
                || typeof input.branch !== 'string'
                || typeof input.remote !== 'string'
                || !Array.isArray(input.modules)
                || !input.modules.every(module => isJsonObject(module) && typeof module.name === 'string' && typeof module.repositoryRoot === 'string')) {
                throw new TypeError('Remote Convergence input is invalid.');
            }
            if (typeof git.inspectConvergence !== 'function'
                || typeof git.fetch !== 'function'
                || typeof git.compareRemote !== 'function'
                || typeof git.fastForward !== 'function') {
                throw new TypeError('Remote Convergence requires a complete Git Adapter.');
            }
            /** @type {Array<{module: {name: string, repositoryRoot: string}, state: {branch: string, clean: boolean, head: string}}>} */
            const preflight = [];
            /** @type {Diagnostic[]} */
            const preflightDiagnostics = [];
            let preflightFailureStage = 'preflight';
            for (const module of input.modules) {
                const inspected = await git.inspectConvergence({branch: input.branch, module: module.name, repositoryRoot: module.repositoryRoot});
                if (inspected.status !== 'succeeded') {
                    preflightDiagnostics.push(...inspected.diagnostics);
                    preflightFailureStage = inspected.stage ?? preflightFailureStage;
                }
                preflight.push({module, state: inspected.state ?? {branch: '', clean: false, head: ''}});
            }
            if (preflightDiagnostics.length > 0) {
                return {
                    diagnostics: preflightDiagnostics,
                    effects: [],
                    finalStates: preflight.map(entry => ({branch: entry.state.branch, head: entry.state.head, module: entry.module.name, remoteHead: ''})),
                    stage: preflightFailureStage,
                    status: 'failed',
                };
            }
            const blockers = preflight.flatMap(entry => [
                ...(!entry.state.clean ? [{code: 'submodule-dirty', message: `Configured Module ${entry.module.name} is not clean.`}] : []),
                ...(entry.state.branch !== input.branch ? [{code: 'submodule-branch-mismatch', message: `Configured Module ${entry.module.name} must be on branch ${input.branch}.`}] : []),
            ]);
            if (blockers.length > 0) {
                return {
                    diagnostics: blockers,
                    effects: [],
                    finalStates: preflight.map(entry => ({branch: entry.state.branch, head: entry.state.head, module: entry.module.name, remoteHead: ''})),
                    status: 'blocked',
                };
            }
            for (const entry of preflight) {
                const fetched = await git.fetch({branch: input.branch, module: entry.module.name, remote: input.remote, repositoryRoot: entry.module.repositoryRoot});
                if (fetched.status !== 'succeeded') {
                    return {
                        diagnostics: fetched.diagnostics,
                        effects: [],
                        finalStates: preflight.map(item => ({branch: item.state.branch, head: item.state.head, module: item.module.name, remoteHead: ''})),
                        stage: fetched.stage ?? 'fetch',
                        status: 'failed',
                    };
                }
            }
            /** @type {Array<{module: {name: string, repositoryRoot: string}, relation: RemoteRelation, state: {branch: string, head: string, remoteHead: string}}>} */
            const compared = [];
            for (const entry of preflight) {
                const comparison = await git.compareRemote({branch: input.branch, module: entry.module.name, remote: input.remote, repositoryRoot: entry.module.repositoryRoot});
                if (comparison.status !== 'succeeded') {
                    const comparedByModule = new Map(compared.map(item => [item.module.name, item.state]));
                    return {
                        diagnostics: comparison.diagnostics,
                        effects: [],
                        finalStates: preflight.map(item => {
                            const state = comparedByModule.get(item.module.name);
                            return state === undefined
                                ? {branch: item.state.branch, head: item.state.head, module: item.module.name, remoteHead: ''}
                                : {...state, module: item.module.name};
                        }),
                        stage: comparison.stage ?? 'final-verification',
                        status: 'failed',
                    };
                }
                compared.push({module: entry.module, relation: comparison.relation, state: comparison.state});
            }
            const relationBlockers = compared.flatMap(entry => ['ahead', 'diverged'].includes(entry.relation)
                ? [{code: `submodule-${entry.relation}`, message: `Configured Module ${entry.module.name} is ${entry.relation} of ${input.remote}/${input.branch}.`}]
                : []);
            if (relationBlockers.length > 0) {
                return {
                    diagnostics: relationBlockers,
                    effects: [],
                    finalStates: compared.map(entry => ({...entry.state, module: entry.module.name})),
                    status: 'blocked',
                };
            }
            /** @type {Array<{action: 'fast-forwarded' | 'unchanged', module: string}>} */
            const effects = [];
            const finalByModule = new Map(compared.map(entry => [entry.module.name, {...entry.state, module: entry.module.name}]));
            const readFinalStates = () => compared.map(entry => {
                const state = finalByModule.get(entry.module.name);
                if (state === undefined) throw new Error('Configured Module final convergence state is missing.');
                return state;
            });
            for (const entry of compared) {
                if (entry.relation === 'equal') {
                    effects.push({action: 'unchanged', module: entry.module.name});
                    continue;
                }
                const fastForwarded = await git.fastForward({branch: input.branch, module: entry.module.name, remote: input.remote, repositoryRoot: entry.module.repositoryRoot});
                finalByModule.set(entry.module.name, {
                    branch: fastForwarded.state.branch,
                    head: fastForwarded.state.head,
                    module: entry.module.name,
                    remoteHead: entry.state.remoteHead,
                });
                if (fastForwarded.status !== 'succeeded') {
                    return {
                        diagnostics: fastForwarded.diagnostics,
                        effects,
                        finalStates: readFinalStates(),
                        stage: 'fast-forward',
                        status: 'failed',
                    };
                }
                if (fastForwarded.state.branch !== input.branch || fastForwarded.state.head !== entry.state.remoteHead) {
                    return {
                        diagnostics: [{code: 'submodule-final-verification-failed', message: `Configured Module ${entry.module.name} did not reach ${input.remote}/${input.branch}.`}],
                        effects,
                        finalStates: readFinalStates(),
                        stage: 'final-verification',
                        status: 'failed',
                    };
                }
                effects.push({action: 'fast-forwarded', module: entry.module.name});
            }
            return {
                diagnostics: [],
                effects,
                finalStates: readFinalStates(),
                snapshots: compared.map(entry => ({head: entry.state.remoteHead, module: entry.module.name, repositoryRoot: entry.module.repositoryRoot})),
                status: 'succeeded',
            };
        },
        /** @param {{modules: Array<{name: string, repositoryRoot: string}>, remote: string, targetBranch: string}} input */
        switchBranch: async input => {
            if (!isJsonObject(input)
                || !Array.isArray(input.modules)
                || !input.modules.every(module => isJsonObject(module) && typeof module.name === 'string' && typeof module.repositoryRoot === 'string')
                || typeof input.remote !== 'string'
                || typeof input.targetBranch !== 'string') {
                throw new TypeError('Submodule Switch input is invalid.');
            }
            /** @type {Array<{module: {name: string, repositoryRoot: string}, state: SwitchInspectionState}>} */
            const inspected = [];
            /** @type {Diagnostic[]} */
            const inspectionDiagnostics = [];
            let inspectionFailureStage = 'preflight';
            for (const module of input.modules) {
                const result = await git.inspectSwitch({
                    module: module.name,
                    remote: input.remote,
                    repositoryRoot: module.repositoryRoot,
                    targetBranch: input.targetBranch,
                });
                if (result.status !== 'succeeded') {
                    inspectionDiagnostics.push(...result.diagnostics);
                    inspectionFailureStage = result.stage ?? inspectionFailureStage;
                }
                inspected.push({
                    module,
                    state: result.status === 'succeeded'
                        ? result.state
                        : {branch: result.state?.branch ?? '', clean: false, head: result.state?.head ?? '', localBranchExists: false, remoteBranchExists: false},
                });
            }
            if (inspectionDiagnostics.length > 0) {
                return {
                    diagnostics: inspectionDiagnostics,
                    finalStates: inspected.map(entry => ({branch: entry.state.branch, changed: false, head: entry.state.head, module: entry.module.name})),
                    stage: inspectionFailureStage,
                    status: 'failed',
                };
            }
            /** @type {Diagnostic[]} */
            const blockers = [];
            for (const entry of inspected) {
                if (!entry.state.clean) blockers.push({code: 'submodule-dirty', message: `Configured Module ${entry.module.name} is not clean.`});
                if (!entry.state.localBranchExists && !entry.state.remoteBranchExists) {
                    blockers.push({code: 'submodule-branch-missing', message: `Target branch ${input.targetBranch} does not exist locally or at ${input.remote} for Module ${entry.module.name}.`});
                }
            }
            if (blockers.length > 0) {
                return {
                    diagnostics: blockers,
                    finalStates: inspected.map(entry => ({branch: entry.state.branch, changed: false, head: entry.state.head, module: entry.module.name})),
                    status: 'blocked',
                };
            }
            const finalByModule = new Map(inspected.map(entry => [entry.module.name, {
                branch: entry.state.branch,
                changed: false,
                head: entry.state.head,
                module: entry.module.name,
            }]));
            const readFinalState = (/** @type {string} */ module) => {
                const state = finalByModule.get(module);
                if (state === undefined) throw new Error('Configured Module final state is missing.');
                return state;
            };
            /** @type {Array<{module: {name: string, repositoryRoot: string}, state: SwitchInspectionState}>} */
            const changed = [];
            for (const entry of inspected) {
                if (entry.state.branch === input.targetBranch) continue;
                const switched = await git.switchBranch({
                    mode: entry.state.localBranchExists ? 'local' : 'remote-tracking',
                    module: entry.module.name,
                    remote: input.remote,
                    repositoryRoot: entry.module.repositoryRoot,
                    targetBranch: input.targetBranch,
                });
                if (switched.status === 'succeeded') {
                    changed.push(entry);
                    finalByModule.set(entry.module.name, {
                        branch: switched.state.branch,
                        changed: true,
                        head: switched.state.head,
                        module: entry.module.name,
                    });
                    continue;
                }
                finalByModule.set(entry.module.name, {
                    branch: switched.state.branch,
                    changed: switched.state.branch !== entry.state.branch || switched.state.head !== entry.state.head,
                    head: switched.state.head,
                    module: entry.module.name,
                });
                /** @type {Array<{module: string, status: 'failed' | 'restored'}>} */
                const recovery = [];
                /** @type {Diagnostic[]} */
                const diagnostics = [...switched.diagnostics];
                let recoveryFailed = false;
                for (const prior of [...changed].reverse()) {
                    const restored = await git.restore({
                        branch: prior.state.branch,
                        head: prior.state.head,
                        module: prior.module.name,
                        repositoryRoot: prior.module.repositoryRoot,
                    });
                    const status = restored.status === 'succeeded' ? 'restored' : 'failed';
                    recovery.push({module: prior.module.name, status});
                    diagnostics.push(...restored.diagnostics);
                    recoveryFailed ||= status === 'failed';
                    finalByModule.set(prior.module.name, {
                        branch: restored.state.branch,
                        changed: restored.state.branch !== prior.state.branch || restored.state.head !== prior.state.head,
                        head: restored.state.head,
                        module: prior.module.name,
                    });
                }
                return {
                    diagnostics,
                    finalStates: inspected.map(item => readFinalState(item.module.name)),
                    recovery,
                    stage: recoveryFailed ? 'recovery' : 'switch',
                    status: 'failed',
                };
            }
            return {
                diagnostics: [],
                finalStates: inspected.map(entry => readFinalState(entry.module.name)),
                status: 'succeeded',
            };
        },
    });
};
