# Promotion Runtime 设计

## Scope

本文档治理内部 promotion runtime, canonical result 和 tracked state 的对应变化. 该 operation 只接受已经完成 access control 的内部 request, 不新增 security boundary.

## Requirements

### Promotion Behavior

Promotion 接受 request-bound artifact path, 在任何 persistence write 前验证 immutable artifact, 最后返回 architecture contract 定义的 canonical JSON result. Readiness 在调用 Promotion Persistence Interface 前确认 artifact.requestId 等于 immutable request.requestId, 且 inputPath 等于当前 request 已绑定的 artifact path. Promotion 信任此前置条件, 不增加 public 参数或失败分支. Expected filesystem failure 和 rollback failure 返回 Interfaces 的 structured diagnostic. Input authors 继续拥有 business policy.

### Retention Policy Ownership

Readiness 按 `docs/adr/0005-external-policy.md#decision` 这个 authoritative source 应用 artifact retention policy, 并使用其中适用于本次 promotion 的 30 天 duration: 成功 promotion 的 tracked artifact 自成功 tracked commit 起保留 30 天, 期满后的移除不属于本 operation. Readiness 不创建或改变 policy, 下游 persistence 只消费它应用后的选择.

## Design Rationale

选择让一次 caller operation 完成 validation 和 promotion, 而不是让 caller 分别协调两个公开步骤, 因为一个 operation 可以保持失败结果一致. 拒绝分离步骤, 因为它会让 caller 暴露中间状态. 接受的成本是这个公开操作等待完整 persistence 和必要 recovery 后才返回.

## Module Design

### Modules

#### Validation Ownership

`Readiness Module` 验证 request, 生成 artifact, 并在 promotion 前验证 artifact. `Promotion Module` 在 persistence preconditions 之前再次验证 request 和 artifact, 但不生成 artifact.

#### Persistence Ownership

`Readiness Module` 独占 promotion ordering, 并由 persist 成功结果和 validated artifact 组装 Successful Result. `Promotion Module` 通过内部 Promotion Persistence Interface 独占 persistence precondition checks, temporary baseline write 和 tracked commit attempt. `Recovery Module` 独占 commit failure 后的 rollback orchestration 和该分支的全部 recovery result policy. `Promotion Module` 不执行 rollback, 也不选择 operation order, recovery policy, retention policy 或 reader presentation.

### Interfaces

#### Successful Result

`promote(inputPath)` 接受 request-bound canonical artifact path. 成功返回 `{status: "succeeded", artifactId, trackedStateId, summary}`. `artifactId` 是等于 validated artifact identity 的 non-empty string, `trackedStateId` 是等于成功 commit 后 tracked state identity 的 non-empty string, `summary` 必须等于 `${artifactId} promoted to ${trackedStateId}`, 且成功结果不包含 temporary baseline identity.

#### Failure Results

Missing, non-string 或 empty inputPath 返回 architecture 的 Current Invalid Input Diagnostic, 其 message 采用 `specs/diagnostic-wording.md#requirements` 的新值, 不读 artifact 或写入. Expected filesystem failure 返回 `{recovered: false, failureCode, operation, priorTrackedState, baselineStatus}`. failureCode 和 operation 标识实际失败: Artifact Storage 读取失败为 `artifact-read-failed` 和 `read`, precondition failure 为 `persistence-precondition-failed` 和 `precondition`, baseline write failure 为 `baseline-write-failed` 和 `baseline-write`; priorTrackedState 保持失败前的 tracked identity, baselineStatus 为 `removed` 或 `retained`, 分别表示 baseline 不存在或存在. Commit failure 后 rollback 成功返回 `{recovered: true, failureCode, priorTrackedState, baselineStatus: "removed"}`. Rollback failure 返回 `{recovered: false, failureCode, priorTrackedState, baselineStatus}`. Recovery 结果按其 Interface 原样传播, 不抛出 arbitrary exception.

#### Promotion Persistence Interface

内部 `persist(artifact, priorTrackedState, retentionDays)` 接受 canonical artifact object, 已有 tracked state 的 non-empty string identity 和以天为单位的 retentionDays. Readiness 根据 ADR 0005 构造有效的内部 retentionDays, 本次 promotion 的值固定为整数 `30`; persistence 信任该内部前提并消费此值, 不重新选择 policy. retentionDays 不进入 canonical artifact, 不增加公开参数或失败分支. 它先检查 persistence preconditions, 再写 temporary baseline, 最后尝试 tracked commit. 成功返回 `{status: "succeeded", trackedStateId}`, identity 对应新 commit. Commit 失败时 persist 不执行 rollback, 由 Promotion 用该失败尝试的 non-empty string `failedCommitId` 和原始 `failureCode` 按 Promotion Flow 交给 Recovery, 并把 Recovery 的公开结果原样作为 persist 结果返回 Readiness. 其他 expected filesystem failure 使用 Failure Results 中 expected filesystem failure 的完整字段; precondition failure 不写入, baseline write failure 保持 prior tracked state 并按实际 baseline 存在状态填 baselineStatus. 不改变其他状态.

### Seams and Adapters

#### Artifact Storage Seam

Artifact Storage Seam 的 Interface 是 `readArtifact(path) -> immutable bytes | structured diagnostic`. Path 是 required non-empty string. Filesystem Adapter 读取文件, deterministic Adapter 返回配置的 bytes 或同一失败结果. 成功是 byte-for-byte immutable copy, 失败精确为 `{failureCode: "artifact-read-failed", operation: "read", path}`. Promotion 把失败转换为 Failure Results 的 expected filesystem failure, 使用现有 priorTrackedState 和实际 baseline 状态, 不写入. 成功 bytes 由 Readiness 验证, invalid artifact 原样返回 architecture 的 diagnostic 且不写入. 两个 Adapter 使用相同 bytes 或失败和相同其他输入时产生相同 caller-visible result.

### Dependencies and Data Flow

#### Promotion Flow

Caller 提供 artifact path. Readiness 验证 immutable artifact, 检查 request binding 并决定 operation order. 它通过 Promotion Persistence Interface 让 Promotion Module 检查 preconditions, 写 temporary baseline 并尝试 tracked commit. Commit 失败时, Promotion 把 `{artifact, priorTrackedState, failedCommitId, commitFailureCode}` 交给 Recovery, 其中 commitFailureCode 是该失败尝试的原始 failureCode. Recovery 完成后把公开结果原样经 Promotion 返回 caller. Input author 按 ADR 0005 提供的 retention policy 由 Readiness 应用, Readiness 将应用后的 retentionDays 作为 `persist` 的第三参数, 与 validated artifact 和 priorTrackedState 一起传给 persistence, 不在下游重新选择 policy.

#### Authority Selection

Commit 前既有 tracked state 是 authoritative result. Temporary baseline 只作 recovery evidence, 不成为 authoritative result. Commit 成功后新 tracked state 是唯一 authoritative result.

| Source | Authority |
| --- | --- |
| Artifact Storage-returned immutable bytes | Artifact validation input |
| Current immutable request | Artifact request binding |
| ADR 0005 (Input author policy), applied by Readiness | Retention policy and applied selection |
| Temporary baseline | Recovery evidence only |
| Tracked state | Current authoritative result |

### Module Design Rationale

备选 Module boundary 是让 caller 直接协调 validation 和 persistence. 选择 Readiness 编排, Promotion 执行 persistence, Recovery 执行 rollback 可以隐藏生命周期, 接受额外调用成本; 拒绝 caller 编排, 因为它会分散失败 policy. 选择 ordering 与 persistence execution 分离而不是让 Promotion 同时选择顺序, 优先由 Readiness 统一操作顺序; 拒绝合并职责, 因为它会使 artifact preparation 和 promotion 有不同顺序来源, 接受的成本是明确的内部 Interface.

选择 Storage-returned immutable bytes 而不是 caller 的可变表示作为验证 authority, 优先保持同一字节对应同一判断; 拒绝可变表示, 因为验证后可能改变, 接受的限制是必须读取完整 bytes. 选择已绑定 request 作为关联 authority 而不是仅信任 artifact 自报 requestId, 优先保持准备与消费一致; 拒绝自报关联, 因为会接受别的请求的产物, 接受的成本是调用前的一次比对. Retention 由 Readiness 应用 Input author 选择的 ADR 0005, 不让 persistence 自选, 优先保持已有 policy authority; 拒绝下游重选, 因为会改变输入选择, 接受的是必须通过内部 retentionDays 参数传递应用结果, 保持 canonical artifact 不变.

选择成功 tracked commit 而不是更早的写入时点作为 authority 转换点, 优先保留持久成功的唯一边界; 拒绝提前转换, 因为后续 commit 可能失败, 接受的限制是操作结束前不能发布新结果. 选择既有 tracked state 作为失败前 authority 而不是新候选, 优先保持已提交身份; 拒绝候选 authority, 因为它尚未提交, 接受的限制是失败时仍使用旧结果. 选择 temporary baseline 只作 recovery evidence 而不是 commit 失败时立即删除, 优先给 Recovery 保留失败现场; 拒绝立即删除, 因为会失去恢复线索, 接受的成本是失败时保留临时数据.

选择 Readiness 调用 Promotion 而不是 Promotion 控制 preparation, 优先保持请求与产物准备的单一负责人; 拒绝反向依赖, 因为它会让 persistence 控制输入生成, 接受的成本是传递 validated artifact. 选择 Promotion 在 commit failure 后调用 Recovery 而不是 Recovery 启动 promotion, 优先让实际失败拥有者发起恢复; 拒绝反向调用, 因为会混合恢复与普通操作, 接受的成本是失败结果的一次转交.

### ADR Evaluation

#### Promotion Boundary

本设计沿用 ADR 0001 的 Readiness ordering, Promotion persistence execution 和 Recovery rollback 分工, baseline-first 与 tracked commit 最后完成均不改变. 不新增持久化边界或 authority 转换时点, 因而该边界不需要新 ADR. Recovery 新公开结果和失败生命周期由其设计单独评估.

#### Retention Policy

`docs/adr/0005-external-policy.md#decision` 继续拥有 artifact retention policy. Readiness 只应用该 authoritative source 的当前选择, 不创建或改变 policy, 因而没有新的 durable authority decision, 不需要新 ADR.

#### Other Decisions

Successful result representation 按 Result Summary 的 additive extension 新增 summary, 并沿用其 ADR Evaluation. Expected filesystem failure 的 `{recovered: false, failureCode, operation, priorTrackedState, baselineStatus}` 是 `architecture/03-errors.md#errors` 已要求的 structured recovery diagnostic 的单次结果字段化, 不持久化, 不改变 authority, persistence 或 security boundary, 因而不需要新 ADR. 其他 canonical result field meanings 保持不变. Public lifecycle testing 继续遵守 ADR 0004.

## Testing Decisions

通过 `promote(inputPath)` public lifecycle 测试 successful result, invalid input, expected filesystem failure, tracked commit failure, rollback failure 和 no-partial-authority. Invalid artifact 时验证返回完整 diagnostic 且在任何 write 前停止; 不能用 no-partial-authority 替代 no-write. 两个 Storage Adapters 分别提供相同 bytes 和相同失败, 比较完整 caller-visible result 与失败传播. 验证 canonical artifact 和公开结果不增加 retention 字段. Request binding 和 retentionDays 是 Readiness 的内部前置条件, 不作为公开合同单独测试, 按 Acceptance criteria 通过源码审查核对.
