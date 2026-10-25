const WINDOWS_RECOMMENDED_STEPS = [
    '001-install-prior-release',
    '002-prepare-preserved-configuration',
    '003-repair-prior-release',
    '004-upgrade-candidate',
    '005-reject-default-downgrade',
    '006-explicit-downgrade',
    '007-restore-candidate',
    '008-verify-launcher-powershell',
    '009-verify-launcher-cmd',
    '010-verify-launcher-git-bash',
    '011-verify-launcher-after-reboot-powershell',
    '012-verify-launcher-after-reboot-cmd',
    '013-verify-launcher-after-reboot-git-bash',
    '014-verify-installed-command',
    '015-verify-source-unavailable',
    '016-add-unknown-content',
    '017-uninstall-preserve-configuration',
    '018-reinstall-candidate',
    '019-uninstall-remove-configuration',
    '020-remove-test-residue',
    '021-verify-final-state',
];

const LINUX_RECOMMENDED_STEPS = [
    '001-install-prior-release',
    '002-prepare-preserved-configuration',
    '003-repair-prior-release',
    '004-upgrade-candidate',
    '005-reject-default-downgrade',
    '006-explicit-downgrade',
    '007-restore-candidate',
    '008-verify-launcher-login-shell',
    '009-verify-installed-command',
    '010-verify-source-unavailable',
    '011-add-unknown-content',
    '012-uninstall-preserve-configuration',
    '013-reinstall-candidate',
    '014-uninstall-remove-configuration',
    '015-remove-test-residue',
    '016-verify-final-state',
];

const PLAIN_STEPS = [
    '001-install',
    '002-init',
    '003-workflow-update',
    '004-workflow-verify',
    '005-workflow-remove',
    '006-reinit',
    '007-final-workflow-verify',
    '008-uninstall',
];

const AGENT_ASSISTED_STEPS = [
    '001-install-prior-release',
    '002-verify-prior-workflow',
    '003-upgrade-candidate',
    '004-workflow-update',
    '005-workflow-verify',
    '006-code-map-verify',
    '007-workflow-remove',
    '008-reinit',
    '009-final-workflow-verify',
    '010-final-code-map-verify',
    '011-uninstall',
];

const FRESH_AGENT_ASSISTED_STEPS = [
    '001-install',
    '002-init',
    '003-complete-initialization-issue',
    '004-workflow-update',
    '005-workflow-verify',
    '006-code-map-verify',
    '007-workflow-remove',
    '008-reinit',
    '009-final-workflow-verify',
    '010-final-code-map-verify',
    '011-uninstall',
];

export const RELEASE_ESM_LIFECYCLE_ENTRIES = Object.freeze([
    'install.mjs',
    'arw.mjs',
    'uninstall.mjs',
    'scripts/prepare-release-version-fixtures.mjs',
    'scripts/release-guest-step.mjs',
]);

const FRESH_AGENT_ASSISTED_CODE_MAP_PATHS = Object.freeze([
    'src/client/README.md',
    'src/client/confirm/README.md',
    'src/client/event/README.md',
    'src/client/flow/README.md',
    'src/client/logging/README.md',
    'src/client/message-collection/README.md',
    'src/client/message/README.md',
    'src/client/oasis-context/README.md',
    'src/client/pages/README.md',
    'src/client/query/README.md',
    'src/client/router/README.md',
    'src/client/script/README.md',
    'src/client/test/README.md',
    'src/client/test/common/README.md',
    'src/client/test/setup/README.md',
    'src/client/theme/README.md',
    'src/server/README.md',
    'src/server/locale/README.md',
    'src/server/logging/README.md',
    'src/server/logging/performance-logger/README.md',
    'src/server/query/README.md',
    'src/server/test/README.md',
    'src/server/test/common/README.md',
    'src/server/theme/README.md',
    'src/server/theme/component/README.md',
    'src/server/theme/library/README.md',
    'src/server/theme/page/README.md',
    'src/server/theme/theme/README.md',
    'src/server/theme/variable/README.md',
    'src/server/ui-component/README.md',
    'src/server/utils/README.md',
    'src/server/validation/README.md',
]);

const FRESH_AGENT_ASSISTED_EXPECTED_WORKFLOW_FINDINGS = Object.freeze(
    [...FRESH_AGENT_ASSISTED_CODE_MAP_PATHS]
        .sort((left, right) => left.localeCompare(right, 'en'))
        .map(path => Object.freeze({code: 'ordinary-readme-at-code-map-path', path})),
);
export const RELEASE_POST_INIT_SCENARIO_ID = 'scenarios/ubuntu/fresh-agent-assisted';

/** @typedef {{code: string, path: string}} ExpectedCodeMapFinding */
/** @typedef {{scenarioId: string, stepId: string}} ReleaseStepDependency */
/**
 * @typedef {object} ReleaseValidationStep
 * @property {string} auditedLocation
 * @property {string | null} choiceContract
 * @property {Readonly<Record<string, unknown>> | null} choiceParameters
 * @property {boolean} command
 * @property {readonly ReleaseStepDependency[]} dependencies
 * @property {number} index
 * @property {'mechanical' | 'semantic'} judgment
 * @property {string | null} mechanicalContract
 * @property {Readonly<Record<string, unknown>> | null} mechanicalParameters
 * @property {string | null} operationContract
 * @property {Readonly<Record<string, unknown>> | null} operationParameters
 * @property {string} stepId
 */
/** @typedef {{archiveKind: string, machineKey: string | null, phase: 'post-init' | 'post-tag' | 'pre-tag', prerequisites: readonly string[], steps: readonly ReleaseValidationStep[], targetKind: 'agent-assisted' | 'plain' | null}} ReleaseValidationScenario */

/** @type {readonly ExpectedCodeMapFinding[]} */
const NO_EXPECTED_CODE_MAP_FINDINGS = Object.freeze([]);
/** @type {readonly string[]} */
const NO_RETAINED_PATHS = Object.freeze([]);

const NON_COMMAND_STEP_MARKERS = [
    'prepare-preserved-configuration',
    'add-unknown-content',
    'remove-test-residue',
    'verify-final-state',
    'complete-initialization-issue',
];

/** @param {{archiveKind: string, stepId: string}} input */
const auditedLocation = ({archiveKind, stepId}) => {
    if (archiveKind.startsWith('observations/')) return 'installation';
    if (archiveKind === 'post-tag') return 'source-checkout';
    return installationParameters({archiveKind, name: stepName(stepId)}) !== null
        ? 'installation'
        : 'repository';
};

const emptyParameters = () => Object.freeze({});
/** @template {Record<string, unknown>} T @param {T | null} value @returns {Readonly<T> | null} */
const frozenParameters = value => value === null ? null : Object.freeze({...value});

const stepName = (/** @type {string} */ stepId) => stepId.replace(/^[0-9]+-/, '');

/** @param {{name: string, targetKind: 'agent-assisted' | 'plain' | null}} input */
const choiceFor = ({name, targetKind: profile}) => {
    if (profile === null) return {choiceContract: null, choiceParameters: null};
    if (name === 'init') return {
        choiceContract: 'workflow-init-choices',
        choiceParameters: frozenParameters({
            orphanCodeMapReadmes: null,
            profile,
            transformExistingAgentDocs: profile === 'agent-assisted' ? true : null,
        }),
    };
    if (name === 'workflow-update') return {
        choiceContract: 'workflow-update-choices',
        choiceParameters: frozenParameters({transformExistingAgentDocs: null}),
    };
    if (name === 'workflow-remove') return {
        choiceContract: 'workflow-remove-choices',
        choiceParameters: frozenParameters({
            arwignore: 'delete',
            codeMaps: profile === 'agent-assisted' ? 'retain' : null,
            mixedAgentDocuments: profile === 'agent-assisted' ? 'delete' : null,
            platformAgentConfigs: null,
        }),
    };
    if (name === 'reinit') return {
        choiceContract: 'workflow-reinit-choices',
        choiceParameters: frozenParameters({
            orphanCodeMapReadmes: null,
            profile,
            transformExistingAgentDocs: null,
        }),
    };
    return {choiceContract: null, choiceParameters: null};
};

/** @param {{archiveKind: string, name: string}} input */
const installationParameters = ({archiveKind, name}) => {
    /** @type {Record<string, readonly [string | null, string | null, boolean | null, boolean | null, boolean | null]>} */
    const directByName = {
        'install-prior-release': ['install', 'prior-release', true, false, null],
        'repair-prior-release': ['repair', 'prior-release', true, true, null],
        'upgrade-candidate': ['upgrade', 'candidate', true, true, null],
        'reject-default-downgrade': ['reject-default-downgrade', 'prior-release', false, true, null],
        'explicit-downgrade': ['downgrade', 'prior-release', true, false, null],
        'restore-candidate': ['upgrade', 'candidate', true, true, null],
        'reinstall-candidate': ['install', 'candidate', true, true, null],
        'install-candidate': ['install', 'candidate', true, false, null],
        'uninstall-preserve-configuration': ['uninstall', null, null, true, false],
        'uninstall-remove-configuration': ['uninstall', null, null, false, true],
    };
    const direct = directByName[name];
    const values = direct
        ?? (name === 'install' && archiveKind.startsWith('scenarios/') ? ['install', 'candidate', true, false, null] : null)
        ?? (name === 'uninstall' && archiveKind.startsWith('scenarios/') ? ['uninstall', null, null, false, true] : null)
        ?? (name === 'uninstall' && archiveKind === 'observations/ubuntu/floor' ? ['uninstall', null, null, true, false] : null);
    if (values === null) return null;
    const [action, expectedVersion, explicitSelection, preserveConfiguration, removeConfiguration] = values;
    return frozenParameters({action, expectedVersion, explicitSelection, preserveConfiguration, removeConfiguration});
};

const launcherParameters = (/** @type {string} */ name) => {
    if (name === 'verify-installed-command') {
        return frozenParameters({shell: 'direct', sourceAvailable: true, version: 'candidate'});
    }
    if (name === 'verify-source-unavailable') {
        return frozenParameters({shell: 'direct', sourceAvailable: false, version: 'candidate'});
    }
    if (name === 'verify-launcher') {
        return frozenParameters({shell: 'login-shell', sourceAvailable: true, version: 'candidate'});
    }
    if (!name.startsWith('verify-launcher-')) return null;
    const shell = name.endsWith('-powershell')
        ? 'powershell'
        : name.endsWith('-cmd')
            ? 'cmd'
            : name.endsWith('-git-bash')
                ? 'git-bash'
                : name.endsWith('-login-shell')
                    ? 'login-shell'
                    : null;
    return shell === null ? null : frozenParameters({shell, sourceAvailable: true, version: 'candidate'});
};

/** @param {{archiveKind: string, name: string, targetKind: 'agent-assisted' | 'plain' | null}} input */
const contractsFor = ({archiveKind, name, targetKind: profile}) => {
    if (name === 'prepare-preserved-configuration') return {
        mechanicalContract: 'preserved-configuration-prepared',
        mechanicalParameters: emptyParameters(),
        operationContract: 'prepare-preserved-configuration',
        operationParameters: frozenParameters({editorCommand: 'release-validation-editor'}),
    };
    if (name === 'add-unknown-content') return {
        mechanicalContract: 'unknown-content-added',
        mechanicalParameters: emptyParameters(),
        operationContract: 'add-unknown-content',
        operationParameters: emptyParameters(),
    };
    if (name === 'remove-test-residue') return {
        mechanicalContract: 'test-residue-removed',
        mechanicalParameters: emptyParameters(),
        operationContract: 'remove-test-residue',
        operationParameters: emptyParameters(),
    };
    if (name === 'verify-final-state') return {
        mechanicalContract: 'installation-final-state',
        mechanicalParameters: frozenParameters({configuration: archiveKind === 'observations/ubuntu/floor' ? 'preserved' : 'absent'}),
        operationContract: 'observe-installation-final-state',
        operationParameters: emptyParameters(),
    };
    if (name === 'complete-initialization-issue' || archiveKind === 'post-tag') return {
        mechanicalContract: null,
        mechanicalParameters: null,
        operationContract: null,
        operationParameters: null,
    };
    const installation = installationParameters({archiveKind, name});
    if (installation !== null) return {
        mechanicalContract: 'installation-transition',
        mechanicalParameters: installation,
        operationContract: null,
        operationParameters: null,
    };
    const launcher = launcherParameters(name);
    if (launcher !== null) return {
        mechanicalContract: 'launcher-observation',
        mechanicalParameters: launcher,
        operationContract: null,
        operationParameters: null,
    };
    if (name === 'check-esm-syntax') return {
        mechanicalContract: 'esm-syntax-observation',
        mechanicalParameters: frozenParameters({entries: RELEASE_ESM_LIFECYCLE_ENTRIES, runtime: 'minimum'}),
        operationContract: null,
        operationParameters: null,
    };
    const operation = name === 'init'
        ? 'init'
        : name === 'workflow-update'
            ? 'update'
            : name === 'workflow-remove'
                ? 'remove'
                : name === 'reinit'
                    ? 'reinit'
                    : null;
    if (operation !== null && profile !== null) return {
        mechanicalContract: 'repository-workflow-transition',
        mechanicalParameters: frozenParameters({
            expectedVerificationFindings: archiveKind === RELEASE_POST_INIT_SCENARIO_ID && operation === 'init'
                ? FRESH_AGENT_ASSISTED_EXPECTED_WORKFLOW_FINDINGS
                : NO_EXPECTED_CODE_MAP_FINDINGS,
            operation,
            profile,
            retainedPaths: operation === 'remove' && archiveKind === RELEASE_POST_INIT_SCENARIO_ID
                ? FRESH_AGENT_ASSISTED_CODE_MAP_PATHS
                : NO_RETAINED_PATHS,
        }),
        operationContract: null,
        operationParameters: null,
    };
    const kind = name === 'verify-prior-workflow' || name === 'workflow-verify' || name === 'final-workflow-verify'
        ? 'workflow'
        : name === 'code-map-verify' || name === 'final-code-map-verify'
            ? 'code-map'
            : null;
    if (kind !== null) return {
        mechanicalContract: 'repository-verification',
        mechanicalParameters: frozenParameters({
            expectedFindings: NO_EXPECTED_CODE_MAP_FINDINGS,
            kind,
        }),
        operationContract: null,
        operationParameters: null,
    };
    throw new Error(`Release validation step has no registered contract: ${archiveKind}/${name}.`);
};

/**
 * @param {string} archiveKind
 * @param {string | null} machineKey
 * @param {'post-init' | 'post-tag' | 'pre-tag'} phase
 * @param {'agent-assisted' | 'plain' | null} targetKind
 * @param {string[]} prerequisites
 * @param {string[]} stepIds
 * @returns {ReleaseValidationScenario}
 */
const scenario = (archiveKind, machineKey, phase, targetKind, prerequisites, stepIds) => Object.freeze({
    archiveKind,
    machineKey,
    phase,
    prerequisites: Object.freeze([...prerequisites]),
    steps: Object.freeze(stepIds.map((stepId, index) => {
        const name = stepName(stepId);
        const choice = choiceFor({name, targetKind});
        const contracts = contractsFor({archiveKind, name, targetKind});
        return Object.freeze({
            auditedLocation: auditedLocation({archiveKind, stepId}),
            choiceContract: choice.choiceContract,
            choiceParameters: choice.choiceParameters,
            command: !NON_COMMAND_STEP_MARKERS.some(marker => name === marker),
            dependencies: Object.freeze([Object.freeze({
                scenarioId: archiveKind,
                stepId: index === 0 ? 'scenario-ready' : stepIds[index - 1],
            })]),
            index,
            judgment: name === 'complete-initialization-issue' || archiveKind === 'post-tag' ? 'semantic' : 'mechanical',
            mechanicalContract: contracts.mechanicalContract,
            mechanicalParameters: contracts.mechanicalParameters,
            operationContract: contracts.operationContract,
            operationParameters: contracts.operationParameters,
            stepId,
        });
    })),
    targetKind,
});

const scenarios = [
    scenario('observations/windows/recommended', 'Windows 11', 'pre-tag', null, [
        'candidate-bundle', 'prior-release-fixture', 'recommended-node', 'shared-snapshot', 'isolated-installation-home',
    ], WINDOWS_RECOMMENDED_STEPS),
    scenario('observations/ubuntu/recommended', 'Ubuntu', 'pre-tag', null, [
        'candidate-bundle', 'prior-release-fixture', 'recommended-node', 'shared-snapshot', 'isolated-installation-home',
    ], LINUX_RECOMMENDED_STEPS),
    scenario('observations/alpine/recommended', 'Alpine', 'pre-tag', null, [
        'candidate-bundle', 'prior-release-fixture', 'recommended-node', 'shared-snapshot', 'isolated-installation-home',
    ], LINUX_RECOMMENDED_STEPS),
    scenario('observations/ubuntu/floor', 'Ubuntu', 'pre-tag', null, [
        'candidate-bundle', 'minimum-node', 'shared-snapshot', 'isolated-installation-home',
    ], [
        '001-check-esm-syntax',
        '002-install-candidate',
        '003-verify-launcher',
        '004-uninstall',
        '005-verify-final-state',
    ]),
    scenario('scenarios/windows/plain', 'Windows 11', 'pre-tag', 'plain', [
        'candidate-bundle', 'plain-target-bundle', 'recommended-node', 'shared-snapshot', 'isolated-installation-home', 'isolated-target-repository',
    ], PLAIN_STEPS),
    scenario('scenarios/ubuntu/plain', 'Ubuntu', 'pre-tag', 'plain', [
        'candidate-bundle', 'plain-target-bundle', 'recommended-node', 'shared-snapshot', 'isolated-installation-home', 'isolated-target-repository',
    ], PLAIN_STEPS),
    scenario('scenarios/alpine/plain', 'Alpine', 'pre-tag', 'plain', [
        'candidate-bundle', 'plain-target-bundle', 'recommended-node', 'shared-snapshot', 'isolated-installation-home', 'isolated-target-repository',
    ], PLAIN_STEPS),
    scenario('scenarios/windows/agent-assisted', 'Windows 11', 'pre-tag', 'agent-assisted', [
        'agent-assisted-target-bundle', 'candidate-bundle', 'prior-release-fixture', 'recommended-node', 'shared-snapshot', 'isolated-installation-home', 'isolated-target-repository',
    ], AGENT_ASSISTED_STEPS),
    scenario('scenarios/ubuntu/agent-assisted', 'Ubuntu', 'pre-tag', 'agent-assisted', [
        'agent-assisted-target-bundle', 'candidate-bundle', 'prior-release-fixture', 'recommended-node', 'shared-snapshot', 'isolated-installation-home', 'isolated-target-repository',
    ], AGENT_ASSISTED_STEPS),
    scenario('scenarios/alpine/agent-assisted', 'Alpine', 'pre-tag', 'agent-assisted', [
        'agent-assisted-target-bundle', 'candidate-bundle', 'prior-release-fixture', 'recommended-node', 'shared-snapshot', 'isolated-installation-home', 'isolated-target-repository',
    ], AGENT_ASSISTED_STEPS),
    scenario(RELEASE_POST_INIT_SCENARIO_ID, 'Ubuntu', 'post-init', 'agent-assisted', [
        'candidate-bundle', 'plain-target-bundle', 'recommended-node', 'shared-snapshot', 'isolated-installation-home', 'isolated-target-repository',
    ], FRESH_AGENT_ASSISTED_STEPS),
    scenario('post-tag', null, 'post-tag', null, ['candidate-tag-present', 'source-checkout'], ['001-verify-post-tag-bootstrap']),
];

/** @type {Map<string, ReleaseValidationScenario>} */
const scenarioById = new Map(scenarios.map(entry => [entry.archiveKind, entry]));

export const RELEASE_MACHINE_KEYS = Object.freeze(['Windows 11', 'Ubuntu', 'Alpine']);

const blockedRegistry = (/** @type {string} */ code, /** @type {string} */ message) => Object.freeze({
    diagnostics: Object.freeze([Object.freeze({code, message})]),
    status: 'blocked',
});

/**
 * 将显式 initialization issue scenario 选择绑定到完整 Registry.
 * 未登记的 identity 或没有初始化 issue semantic step 的 scenario 关闭式返回稳定诊断.
 */
export const resolveReleaseValidationRegistry = (/** @type {unknown} */ initializationIssueScenario) => {
    if (typeof initializationIssueScenario !== 'string'
        || initializationIssueScenario.length === 0
        || !scenarioById.has(initializationIssueScenario)) {
        return blockedRegistry(
            'initialization-issue-scenario-unregistered',
            'The configured initialization issue scenario is not registered.',
        );
    }
    const selected = scenarioById.get(initializationIssueScenario);
    if (selected === undefined) throw new Error('Registered release validation scenario is unavailable.');
    const initializationSteps = selected.steps.filter((/** @type {{ judgment: string; stepId: string; }} */ step) => step.judgment === 'semantic'
        && step.stepId.endsWith('-complete-initialization-issue'));
    if (selected.phase !== 'post-init' || selected.machineKey === null || initializationSteps.length !== 1) {
        return blockedRegistry(
            'initialization-issue-scenario-inapplicable',
            'The configured scenario cannot perform the initialization issue operation.',
        );
    }
    return Object.freeze({
        diagnostics: Object.freeze([]),
        initializationIssue: Object.freeze({
            scenarioId: selected.archiveKind,
            stepId: initializationSteps[0].stepId,
        }),
        machineKeys: RELEASE_MACHINE_KEYS,
        scenarios: Object.freeze([...scenarios]),
        status: 'succeeded',
    });
};

/** 返回全部闭合 release validation scenarios 的浅复制, 保留规范顺序和冻结 records. */
export const listReleaseValidationScenarios = () => [...scenarios];

/** 返回 `pre-tag` 要求的全部 archive kinds, 保留 registry 的规范顺序. */
export const listPreTagArchiveKinds = () => scenarios
    .filter(entry => entry.phase === 'pre-tag')
    .map(entry => entry.archiveKind);

/**
 * Resolve the one Node.js runtime role declared by a VM scenario's prerequisites.
 * Missing or ambiguous runtime prerequisites close the consumer boundary instead of
 * letting scenario identity become a second source of runtime policy.
 *
 * @param {unknown} value
 * @returns {'minimum' | 'recommended'}
 */
export const resolveReleaseValidationRuntimeRole = value => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
        || !('prerequisites' in value) || !Array.isArray(value.prerequisites)) {
        throw new Error('Release validation scenario prerequisites are invalid.');
    }
    const minimum = value.prerequisites.includes('minimum-node');
    const recommended = value.prerequisites.includes('recommended-node');
    if (minimum === recommended) {
        throw new Error('Release validation scenario must declare exactly one Node.js runtime prerequisite.');
    }
    return minimum ? 'minimum' : 'recommended';
};

/** 根据 exact archive kind 解析一个冻结 scenario; unknown identity 关闭式失败. */
/** @param {unknown} scenarioId @returns {ReleaseValidationScenario} */
export const resolveReleaseValidationScenario = scenarioId => {
    if (typeof scenarioId !== 'string' || !scenarioById.has(scenarioId)) {
        throw new Error('Release validation scenario is not registered.');
    }
    const selected = scenarioById.get(scenarioId);
    if (selected === undefined) throw new Error('Registered release validation scenario is unavailable.');
    return selected;
};

/** 解析属于 exact machine 和 scenario 的一个 step; machine mismatch 或 unknown step 关闭式失败. */
/** @param {{machineKey: string, scenarioId: string, stepId: string}} input */
export const resolveReleaseValidationStep = ({machineKey, scenarioId, stepId}) => {
    const selectedScenario = resolveReleaseValidationScenario(scenarioId);
    if (selectedScenario.machineKey !== machineKey) {
        throw new Error('Release validation scenario does not belong to the selected machine.');
    }
    const step = selectedScenario.steps.find(entry => entry.stepId === stepId);
    if (step === undefined) throw new Error('Release validation step is not registered.');
    return {scenario: selectedScenario, step};
};
