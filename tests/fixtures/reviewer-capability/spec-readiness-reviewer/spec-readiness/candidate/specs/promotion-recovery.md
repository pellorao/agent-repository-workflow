# Promotion Recovery 设计

## Scope

本文档治理 tracked commit failure 和 rollback recovery 的公开行为. Authentication, authorization 和 ordinary promotion success contract 保持现有定义不变.

## Requirements

### Rollback Ownership

Tracked commit 失败后必须先完成 rollback attempt. Caller 只接收最终 recovery result.

### Recovery Result

Rollback failure 必须向 caller 返回 `{recovered: false, failureCode, priorTrackedState, baselineStatus}`. `baselineStatus` 准确表示 temporary baseline 是否仍然存在.

### Complete Operation Contract

`recoverPromotion(input)` 输入精确为 `{artifact, priorTrackedState, failedCommitId, commitFailureCode}`. Artifact 满足 canonical readiness artifact schema; priorTrackedState, failedCommitId 和 commitFailureCode 是 non-empty string, 分别表示失败前已存在的 tracked state, 本次失败 commit 和该 commit 的原始 failure code. 本恢复操作只处理已有 prior tracked state 的恢复. Invalid input 按 Interfaces 的 Invalid Input Diagnostic 返回, 不 restore 或写入. Authentication 与 authorization 已由 caller boundary 完成. Commit failure 后恢复成功返回 `{recovered: true, failureCode, priorTrackedState, baselineStatus: "removed"}`, failureCode 等于 commitFailureCode. 除规定的 restore 和 baseline removal 外不修改其他状态.

## Design Rationale

选择在 commit failure 后自动尝试 rollback, 而不是立即把 partial state 交给 caller, 因为自动恢复可以保持 tracked state 稳定. 立即返回的方案被拒绝, 因为每个 caller 都会重复恢复 policy. 接受的代价是 recovery path 更长, 并需要清晰地区分 commit failure 与 rollback failure.

## Module Design

### Modules

#### Recovery Ownership

`Recovery Module` 拥有 tracked commit failure 后的 rollback operation 和 ordinary recovery result. `Promotion Module` 拥有 commit attempt, 不执行 rollback; 交出失败尝试前, 它按 Interfaces 的 Invalid Input Diagnostic 顺序检查 `{artifact, priorTrackedState, failedCommitId, commitFailureCode}`, 有误时直接返回该 diagnostic, 不调用 Recovery.

#### Rollback Failure Ownership

`Recovery Module` 也拥有 rollback failure result: 它保留 original commit failure 和 remaining baseline information, 再形成 caller-visible recovery diagnostic.

### Interfaces

#### Invalid Input Diagnostic

先检查 input 是否为对象, 再检查额外字段 (多个时取键名升序第一个), 再按 artifact, priorTrackedState, failedCommitId, commitFailureCode 顺序检查, 返回首个错误. Invalid input 返回 `{failureCode: "invalid-input", path, details: {message: "Invalid recovery input."}}`, 非对象时 path 是 `$`, 否则 path 是该额外字段名或首个无效顶层字段名, 不 restore, 不写入.



#### Recovery Result Interface

Rollback failure 返回 `{recovered: false, failureCode, priorTrackedState, baselineStatus}`. `baselineStatus` 只能是 `removed` 或 `retained`.

#### Successful Result

Successful rollback 返回 `{recovered: true, failureCode, priorTrackedState, baselineStatus: "removed"}`. `failureCode` 保留原始 commit failure code, Interface 不修改已恢复的 tracked state.

### Seams and Adapters

#### Recovery Storage Seam

Recovery Storage Seam 的 operation 是 `restore(priorTrackedState) -> recoveryState`. 成功时 Seam 返回的 `recoveryState` 精确为 `{status: "restored"}`, 表示已恢复到输入指定的 priorTrackedState 并移除 baseline. Recovery Module 由这些事实形成 Successful Result 的公开结果, 使用输入的 priorTrackedState 和原始 commit failure code. Filesystem Adapter 执行实际 restore, deterministic Adapter 使用调用方配置表达同一成功语义.

Restore 失败时 Seam 返回的 `recoveryState` 精确为 `{status: "failed", restoreFailureCode: "restore-failed", baselineStatus}`, baselineStatus 是 restore 失败后 baseline 的实际存在状态. Recovery 同时保留原始 commit failure 与 restore failure, 保持 priorTrackedState, 使用该 baselineStatus, 并形成 Recovery Result Interface 的公开 rollback failure shape. 两个 Adapter 的配置可以产生不同结果; 共同合同不要求不同配置下结果值相同.

### Dependencies and Data Flow

#### Commit Failure Input

Promotion Module 把 `{artifact, priorTrackedState, failedCommitId, commitFailureCode}` 交给 Recovery Module. Artifact 是此前 validated canonical artifact; priorTrackedState 是失败尝试前的 identity, failedCommitId 是该尝试的 identity, commitFailureCode 是该尝试的原始 failure code. Recovery 按 Interfaces 的顺序验证该同一对象. 后两项随失败尝试记录取得, 不由 promote 的 caller 自报替代.

#### Rollback Command

`Recovery Module` 通过 Recovery Storage Seam 调用 `restore(priorTrackedState)`.

#### Recovery Propagation

Rollback attempt 完成后, `Recovery Module` 把完整 recovery result 返回 `Promotion Module`, 再由 `Promotion Module` 原样返回 caller.

#### Remaining Baseline State

Rollback failure 后, existing tracked state 仍是 authoritative result. Temporary baseline 只保留为 recovery evidence, 并通过 Recovery Storage 返回的 baselineStatus 如实报告 caller. Artifact 由 Readiness 提供且只作已验证输入; failedCommitId 和原始 failure code 来自 Promotion 的失败尝试; priorTrackedState 来自尝试前的 tracked state. Recovery Storage 只负责执行 restore, 不选择这些来源.

### Module Design Rationale

备选边界是让 Promotion Module 同时拥有 commit 和 recovery. 选择独立 Recovery Module 可以隔离复杂失败状态, 接受的成本是额外 Interface 和显式 failure propagation. 拒绝单一 Module, 因为它会混合 ordinary promotion 与 recovery policy.

选择失败前 tracked state 而不是 temporary baseline 作为权威, 优先保留已提交结果; 拒绝临时状态, 因为恢复尚未成功, 接受的限制是失败后不能把新候选当成结果. 选择保留 baseline 作为 recovery evidence 而不是失败时立即删除, 优先保留故障证据; 拒绝立即删除, 因为会失去恢复线索, 接受的成本是失败时保留临时数据.

选择由 Recovery Module 调用 Recovery Storage 而不是让 Adapter 编排 Module, 优先集中恢复 policy; 拒绝反向调用, 因为它会让 Adapter 拥有结果 policy, 接受的成本是一次明确结果转换. 选择经 Promotion 返回 caller 而不是 Recovery 直接返回 caller, 优先保持一个公开 promotion 响应; 拒绝直接返回, 因为会分裂 caller 的结果入口, 接受的成本是一次原样转交. 原始 commit failure code 和 failedCommitId 的来源备选是 Promotion 失败尝试记录或 promote caller 自报. 选择前者作为权威, 优先使 recovery 与实际失败尝试保持一致; 拒绝 promote caller 自报, 因为它可能把 recovery 绑定到另一尝试或错误原因, 接受的成本是 Promotion 必须保存并传递该记录. Artifact 选择 Readiness 已验证的同一对象而不是重新读取存储, 优先保证恢复对象与失败尝试一致; 拒绝重新读取, 因为存储内容可能已变化, 接受的成本是 Promotion 必须保留该对象.

### ADR Evaluation

#### Existing Diagnostic Boundary

`invalid-input` 沿用 `architecture/05-validation-report.md#current-invalid-input-diagnostic` 的 failureCode, path 和 details 结构, 只为本 operation 的输入给出 path 和 message, 不持久化, 不改变 failure authority, 因而不需要新 ADR. 本次 rollback recovery 的新结果合同单独在下节评估, 不以已有 diagnostic 形状替代该评估.

#### Rollback Recovery Contract

Rollback recovery result 被视为 ADR 0001 已有 rollback responsibility 的表现形式.

#### Other Decisions

Tracked commit order 和 authority source 保持 ADR 0001 不变. Module separation 只执行已经选择的 recovery responsibility, 不改变 security boundary.

## Testing Decisions

通过 `recoverPromotion(input)` public lifecycle 测试 successful rollback 和 invalid-input 首错. 验证成功恢复 priorTrackedState, baseline removed, 原始 commit failure code 保留. 验证 invalid input 不 restore 或写入; no-write 只约束无效输入及无关状态, 不禁止规定的 restore 和 baseline removal.
