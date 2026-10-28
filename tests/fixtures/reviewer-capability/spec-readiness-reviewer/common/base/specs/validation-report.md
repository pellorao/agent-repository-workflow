# Validation Report Module

## Scope

本文档新增只读 Validation Report Module. Caller 通过 `renderReport(source)` 提供 canonical readiness artifact source; Artifact Reader 返回 immutable canonical bytes 后, Module 生成 structured report. Module 不参与 promotion persistence 或 Reviewer orchestration.

## Requirements

### Report Contract

`renderReport(source)` 的 source 是 required non-empty string artifact path, invalid-artifact 和 artifact-read-failed diagnostic 的 path 精确等于 source 的值. Source 缺失, 非字符串或为空时返回 `{failureCode: "invalid-input", path: "source", details: {message: "A source is required."}}`, 不调用 Reader 或写入. Artifact Reader 成功返回的 immutable bytes 是唯一 validation input. Input schema, allowed check results, canonical check order, `overallResult` precedence 和 `diagnostics` mapping 由 `architecture/05-validation-report.md#canonical-readiness-artifact` 定义. Successful report 精确包含 `{requestId, overallResult, checks, diagnostics}`, 所有 caller-visible fields 都使用 canonical JSON.

### No Side Effects

Module 不修改 artifact source, returned bytes, request, temporary baseline 或 tracked state. Malformed artifact 返回 `architecture/05-validation-report.md#invalid-artifact-contract` 定义的 structured diagnostic, 不抛出 arbitrary exception, 不写文件或改变 authority.

### Artifact Read Failure

Artifact Reader 的 expected read 或 filesystem failure 返回 `{failureCode: "artifact-read-failed", operation: "read", path}`. Diagnostic 不包含 partial report, 不抛出 arbitrary exception, 不写文件或改变 authority.

## Design Rationale

备选 behavior 是让每个 caller 自行解析 artifact. 选择集中生成 structured report 可以保持 result 和 error semantics 一致. 拒绝 caller parsing, 因为多个 consumer 会重复派生规则. 接受的代价是增加一个只读转换 boundary 和一次内存 allocation.

## Module Design

### Modules

#### Validation Report Module

`Validation Report Module` 独占 `renderReport` 对 Artifact Reader 返回 bytes 的 report validation, derived result checking 和 rendering. `renderReport` 与 Parser Module 的 `parseArtifact` 是两个独立 operation, 各自引用 architecture 的 Invalid Artifact Contract 校验, 且 `renderReport` 不适用 Parser 的大小限制, 因而不调用 `parseArtifact`. 它不拥有 request validation, artifact generation, promotion, persistence 或 `parseArtifact`.

#### Readiness Module

`Readiness Module` 继续独占 artifact generation 和 promotion ordering. 它不拥有 report rendering 或 reader presentation.

### Interfaces

#### Successful Report

`renderReport(source)` 通过 Artifact Reader 获得 immutable canonical bytes 后, 成功时返回 `{requestId, overallResult, checks, diagnostics}`. Result 精确遵守 `architecture/05-validation-report.md#canonical-readiness-artifact` 的 ordered copy, precedence 和 mapping contract. 返回对象不共享 caller 可修改的输入引用.

#### Malformed Artifact

Malformed artifact 返回 `architecture/05-validation-report.md#invalid-artifact-contract` 定义的 `{failureCode: "invalid-artifact", path, details: {field, reason}}`. Module 使用该合同的 validation order 和 field locator, 只报告第一个 invalid field. Diagnostic 不包含 partial report, 不抛出 arbitrary exception.

#### Artifact Read Failure

Artifact Reader Interface 的 expected read 或 filesystem failure 返回 `{failureCode: "artifact-read-failed", operation: "read", path}`. `Validation Report Module` 把该 diagnostic 原样返回 caller, 不生成 partial report, 不抛出 arbitrary exception.

#### Side Effects

Interface 不写文件, 不更新 baseline, 不改变 tracked state, 不启动 Reviewer, 也不读取 live Repository state.

### Seams and Adapters

#### Artifact Reader Interface

Artifact Reader Seam 的 Interface 是 `readArtifact(source) -> immutable bytes | structured diagnostic`. Adapter 只能改变 bytes 来源, 不能改变 parsing, validation 或 result policy.

#### Production Adapter

Production Artifact Reader Adapter 通过同一 Interface 读取 caller 提供的 artifact source. 成功时返回 byte-for-byte immutable copy; expected read 或 filesystem failure 时返回稳定的 `artifact-read-failed` diagnostic.

#### Deterministic Adapter

Deterministic Artifact Reader Adapter 通过同一 Interface 返回配置的相同 bytes 或 `artifact-read-failed` diagnostic. Architecture evidence 证明当各自 source 产生相同 bytes 时, 两个 Adapters 通过 `renderReport(source)` 产生相同 observable result 和 diagnostic.

#### External Main Agent Operation

`renderReport` 返回后, Main Agent 可以把 report 展示给 Human, 并由 Human 决定是否开始另一个 workflow. 这个 presentation 和 Human decision 明确不由 non-test runtime code 实现, 不是 Module 或 Seam, 也不需要 runtime Interface 或 Adapter.

### Dependencies and Data Flow

#### Report Flow

Caller 调用 `renderReport(source)`; 缺少 source 时 Module 返回 invalid-input 且不调用 Reader. 否则 `Validation Report Module` 通过 Artifact Reader Interface 读取: Adapter 返回 immutable bytes 时, Module 验证并派生 report 后返回 caller, malformed artifact 时返回 invalid-artifact diagnostic 且不生成 partial report; Adapter 返回 `artifact-read-failed` 时, Module 不进入 validation, 把完整 diagnostic 原样返回 caller. 所有路径都没有 cycle 或 persistence operation.

#### Input Authority

| Source | Authority |
| --- | --- |
| Artifact Reader-returned immutable canonical bytes | Sole validation input |
| Canonical check order | Report ordering |

Artifact Reader 返回的 immutable canonical bytes 是本 flow 的唯一 artifact authority. Caller source, Adapter identity 和 temporary representation 都不是 authority.

### Module Design Rationale

备选 boundary 是让 `Readiness Module` 同时拥有 report rendering. 选择独立只读 Module 可以保持 promotion responsibility 较小, 并让 reader behavior 通过一个稳定 Interface 测试. 拒绝合并 boundary, 因为它会把 persistence 与 presentation 责任混合. 接受的成本是多一个 Module Interface 和一次 immutable bytes transfer. `renderReport` 不复用 `parseArtifact`, 优先保持无大小阈值的 report 合同; 拒绝复用, 因为 Parser 的大小限制会改变该合同, 接受的成本是两个 operation 分别实现同一 Invalid Artifact Contract 校验并由各自 public lifecycle 测试保持一致.

`Validation Report Module` 依赖 `Artifact Reader Interface`; 这个 dependency direction 让 Module 保留 report validation 和 result policy, Adapter 只提供 bytes. 备选方向让 Adapter 调用或复制 Module policy, 但那会把 validation 分散到每个 bytes 来源, 因而被拒绝. 接受的成本是每次 report 都经过一次 reader Interface 调用.

选择 Artifact Reader 返回的 immutable canonical bytes 作为 sole artifact authority, 而不是让 caller source, Adapter identity 或 temporary representation 成为 authority, 可以使相同 bytes 产生相同结果. 拒绝 source-owned 或 Adapter-owned authority, 因为它会让结果随来源改变. 接受的限制是 caller 提供的 source 必须让 Adapter 返回完整 canonical artifact bytes.

选择 Canonical check order 作为 report ordering authority, 而不是接受 caller-defined order, 可以保持 consumer 看到的顺序稳定. 拒绝 caller-defined order, 因为它会使相同 artifact 产生不同 report ordering. 接受的限制是 caller 不能自定义 checks 的展示顺序.

### ADR Evaluation

Caller-visible report fields 延续 canonical artifact contract, 不改变 result authority. Malformed artifact 和 Artifact Reader expected failure diagnostics 遵守 `architecture/05-validation-report.md#invalid-artifact-contract` 和 `#production-adapter` 的现有 structured diagnostic contract, 不改变 failure authority 或 recovery behavior, 因而不需要新 ADR. Source invalid-input 只为 `renderReport` 的 source 给出 path 和 message, 不持久化, 不改变 failure authority, 因而同样不需要新 ADR. Artifact Reader Adapters 只替换 bytes 来源, 遵守 ADR 0003 的 Reviewer 与 Engine separation. Public lifecycle testing 通过 `renderReport` 完成, 遵守 ADR 0004. 本设计不新增 durable state 或 security boundary.

## Testing Decisions

通过 `renderReport(source)` 分别测试 all-satisfied, uncertain-only 和含 gap 的 `overallResult` precedence, applicable-check ordered subsequence 和 diagnostics mapping. 失败测试覆盖 UTF-8 编码失败, JSON 语法失败, root object 或字段校验失败, duplicate 或 out-of-order check 和 invalid result. 同时制造多个错误, 验证只返回合同顺序中的第一个错误及其 field 和 reason, 防止后续错误掩盖先发生的校验失败. 对使用同一规则的字段和值选择代表性输入, 不逐一枚举所有组合. 同一 public lifecycle 还验证 required source 的无读取失败, source, Reader 返回 bytes 和 request inputs 在成功与失败后保持不变, 返回 report 不共享 caller-mutable 引用, 以及 no-write behavior, 两个 Artifact Reader Adapters 在各自 source 返回相同 bytes 时的 observable equivalence, `artifact-read-failed` 的全部 fields, no-partial-report 约束和原样传播.
