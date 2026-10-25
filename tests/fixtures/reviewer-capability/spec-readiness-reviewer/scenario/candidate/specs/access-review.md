# Protected Access Review 设计

## Scope

本文档新增 protected access review, 它读取 immutable request 并返回 authorization decision, 不修改 tracked state 或 retention policy.

## Requirements

### Authentication Boundary

Existing caller boundary 根据 security authority Input 验证 caller identity. Access review 只信任该 boundary 传入的 verified principal 和 requested operation, 不接受 caller 自报 identity 或 credential.

### Authorization Behavior

Authorization policy 由 Input author 提供, Reviewer 不选择 policy. Policy 精确为 `{policyId, allowedOperations}`, `policyId` 是 non-empty string, `allowedOperations` 是非空数组, 每个元素均为 non-empty string. Facts 精确为 `{resourceId, operation}`, 两项均为 non-empty string, 从 immutable request 的同名字段直接取得. Operation 在 allowedOperations 中时返回 `{allowed: true, policyId}`, 否则返回 `{allowed: false, reasonCode: "operation-not-allowed"}`. 两种结果均为 caller-visible, 不产生 persistence side effect.

## Design Rationale

选择在读取 protected artifact 前执行 access review, 并接受额外一次 policy evaluation 的 latency.

## Module Design

### Modules

#### Access Review Module

`Access Review Module` 独占 policy evaluation 和 authorization decision, 不拥有 caller authentication, policy authoring, artifact reading 或 persistence.

#### Artifact Reader Module

`Artifact Reader Module` 只在授权成功后读取 immutable bytes. Immutable request.resourceId 直接作为既有 `readArtifact(source)` 的 source, Reader 负责根据该 source 定位同一资源, 不解释 authorization policy 或改变 decision.

### Interfaces

#### Authentication Input

`reviewAccess(request)` 接受 required immutable request, 其 resourceId 和 operation 为 non-empty string. Policy 来自 Input author 的部署配置, 不从 request 接受替代 policy.

#### Authorization Failure

Successful decision 精确为 `{allowed: true, policyId}`, 并允许以 immutable request.resourceId 调用既有 `readArtifact(source)`. Denied decision 精确为 `{allowed: false, reasonCode: "operation-not-allowed"}`, 并停止后续 artifact read.

#### Other Results

Policy 的错类型, 缺字段或额外字段返回 `{allowed: false, failureCode: "invalid-policy"}`; facts 的同类错误返回 `{allowed: false, failureCode: "invalid-request"}`. 两者均不读 artifact, 不写入; 同时错误时先判断 policy. Artifact Reader failure 原样返回 `{failureCode: "artifact-read-failed", operation: "read", path}`, 不返回 partial bytes, 不写入.

### Seams and Adapters

#### Policy Evaluation Seam

Policy Evaluation Seam 的 operation 是 `evaluate(policy, facts)`. 两个 Adapter 的 allowed, denied, invalid-policy 和 invalid-request 结果使用上述 Interfaces 的精确合同, 校验顺序和无写入约束也相同. Live Policy Adapter 根据 Input author 的 production policy 计算 decision; deterministic Policy Adapter 根据调用方提供的 policy 和 facts 配置产生上述 decision. Runtime environment 选择当前 deployment 的 Adapter pairing. 两个 Adapter 可以使用不同配置, 不承诺不同配置产生相同结果.

### Dependencies and Data Flow

Caller 提供 immutable request. Existing caller boundary 提供 verified identity, Input author 提供 policy. Access Review 从 request 取得 resourceId 和 operation 形成 facts, 调用 Policy Evaluation Seam. Allowed decision 后, Access Review 直接把同一 immutable request.resourceId 作为既有 `readArtifact(source)` 的 source, Artifact Reader 负责定位同一资源并读取 immutable bytes; 其余 decision 停止读取. Reader failure 原样返回 caller. 所有结果都没有 persistence write 或 cycle.

| Source | Authority |
| --- | --- |
| Input author | Authorization policy |
| Existing caller boundary | Verified identity |
| Immutable request | Resource and operation facts |

### Module Design Rationale

#### Boundary Alternative

选择独立 Access Review Module 集中 authorization policy evaluation.

#### Accepted Cost

独立边界增加一次调用和传递 immutable facts 的成本.

#### Identity and Facts Authorities

选择既有 caller boundary 的 verified identity 而不是 caller 自报身份, 优先保持已经验证的信任来源; 拒绝自报身份, 因为它绕过验证, 接受的限制是调用方必须先完成认证. 选择 immutable request 的 resourceId 和 operation 而不是读取时再获取可变请求, 优先保持同次操作事实一致; 拒绝后者, 因为读取对象可能漂移, 接受的限制是更新请求需要新操作.

#### Reader Dependency

选择先由 Access Review 决定再调用 Artifact Reader, 而不是让 Reader 先读取后过滤, 优先避免未授权读取. 拒绝先读取, 因为过滤不能撤销已经发生的访问, 接受的成本是读取前增加一次 decision 调用. 授权成功后选择直接把 immutable request.resourceId 作为既有 Reader source, 而不是由 Access Review 构造物理路径, 优先保持授权事实与读取对象一致; 拒绝在 Access Review 中定位存储, 因为这会混合 authorization 与 artifact location 责任, 接受的成本是 Reader 必须根据该 source 定位同一资源.

### ADR Evaluation

#### Security Boundary

既有 caller boundary 继续拥有认证, Access Review 是 security authority Input 已要求的 review boundary, 只接收其 verified identity 和 requested operation, 并在 protected artifact read 前执行 Input author 已选择的 operation policy. 这个 pre-read authorization boundary 落实现有 boundary 对当前只读调用的要求, 不新增或移动 identity authority, policy authority, credential 来源或持久状态, 因而没有新的 durable security decision, 不需要新 ADR.

#### Other Decisions

本次明确 allowed/denied 和输入错误的 caller-visible JSON contract. 这些结果仅用于当前只读操作, 不持久化 decision, 不改变 artifact authority, 是可逆的单次结果扩展; 不产生新的 durable compatibility 或 persistence 决定, 因而不需要新 ADR. Public lifecycle testing 继续遵守 ADR 0004.

## Testing Decisions

通过 `reviewAccess` public lifecycle 测试 allowed, denied, invalid-policy, invalid-request, Policy Adapter failure 和 Artifact Reader failure. 验证 verified-principal 必须来自现有 caller boundary, 不接受自报身份; allowed 时 Reader 接收 immutable request.resourceId 作为 source 并定位同一资源, denied 和输入错误时不读取 artifact. 验证各结果无 persistence side effect, Reader failure 完整原样传播. 两个 Adapter 使用相同 policy/facts 时比较 caller-visible decision, 使用不同配置时分别遵守同一结果合同.
