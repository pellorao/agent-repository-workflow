# 文档交付与运行时迁移

## Scope

本文档更新 reader guide 对 promotion lifecycle 的说明. Reader guide 本身不拥有 runtime behavior, Module responsibility 或 persistent state.

## Requirements

### Runtime Migration

同一次交付新增 tracked state persistence. Operation 先写 temporary baseline, 验证完成后最后 commit tracked state. Expected failure 保留 prior tracked state, rollback failure 返回 structured recovery result.

### Authentication Boundary

Protected promotion 只接受已由 existing caller boundary 完成认证及授权的内部请求. 可信身份来自 security authority Input, operation 使用已批准的 access policy, 不接受 caller 自报身份或 credentials.

### Rollout Ownership

外部 Main Agent 负责在发布前协调并确认 runtime migration rollout 完成. 该协调不是 non-test runtime Module, 不改变 persistence responsibility.

### Complete Operation Contract

`promote(inputPath)` 的 successful result 精确为 `{status: "succeeded", artifactId, trackedStateId}`. artifactId 与 trackedStateId 采用 Promotion Runtime 的 non-empty identity 定义. Expected filesystem failure 精确为 `{recovered: false, failureCode, priorTrackedState, baselineStatus}`. 除此处字段集合外, 失败值语义采用 Promotion Runtime. Rollback success 和 rollback failure 精确采用 Promotion Recovery 的公开结果. Caller 只观察 public results, 不暴露 private helper 或 intermediate bytes.

## Design Rationale

选择在同一次交付中更新读者指南和 runtime migration, 而不是先单独发布文档, 因为共享发布窗口可以减少迁移协调. 拒绝先发布文档, 因为读者说明会暂时领先于实际行为. 接受的代价是发布范围扩大, 并需要同时协调文档与 rollout.

## ADR Evaluation

### Persistence Decision

Tracked persistence 延续 baseline-first order, 因而由现有 persistence decision 覆盖.

### Security Decision

Protected operation 复用现有 authorization policy, 因而不形成新的 security decision.

### Other Decisions

Caller-visible success, expected failure 和 recovery representations 都复用当前 architecture contracts, rollout 不改变 authority source.

## Testing Decisions

通过 public promotion lifecycle 测试 successful persistence, expected filesystem failure, rollback failure, denied authorization 和 no-partial-commit behavior. 文档链接另做静态路径检查.
