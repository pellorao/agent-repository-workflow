# Stable Validation Report Boundary

## Stable Boundary

Engine 不启动或监控 Reviewer. Generated artifact 在 promotion 前保持 temporary. Input authors 拥有 business policy. Public tests 只观察 documented lifecycle.

## Canonical Readiness Artifact

Canonical readiness artifact 是 `{requestId, checks}` JSON object. `requestId` 是 non-empty string. `checks` 是 non-empty array, 每个 `check` ID 在一个 artifact 中只能出现一次. Satisfied entry 精确为 `{check, result: "satisfied"}`. Non-satisfied entry 精确为 `{check, result, finding}`, 其中 `result` 只能是 `gap` 或 `uncertain`, `check` 和 `finding` 都是 non-empty string.

Canonical check order 是:

1. `SPEC-READINESS-INPUTS`
2. `SPEC-READINESS-REQUIREMENTS`
3. `SPEC-READINESS-RATIONALE`
4. `SPEC-READINESS-ADR-EVALUATION`
5. `MODULE-DESIGN-APPLICABILITY`
6. `MODULE-DESIGN-EXEMPTION`
7. `MODULE-DESIGN-MODULES`
8. `MODULE-DESIGN-INTERFACES`
9. `MODULE-DESIGN-SEAMS-ADAPTERS`
10. `MODULE-DESIGN-DEPENDENCIES-DATA-FLOW`
11. `MODULE-DESIGN-RATIONALE`

一个 artifact 可以只包含适用 checks, 但它们必须形成上述 order 的非空有序子序列. Report 的 `checks` 是 input entries 的 immutable ordered copy. 如果任一 entry 是 `gap`, `overallResult` 是 `gap`; 否则如果任一 entry 是 `uncertain`, `overallResult` 是 `uncertain`; 否则 `overallResult` 是 `satisfied`. `diagnostics` 按 check order 把每个 non-satisfied entry 映射为 `{check, result, message: finding}`.

## Invalid Artifact Contract

Malformed artifact 返回 `{failureCode: "invalid-artifact", path, details: {field, reason}}`. `path` 是 caller 提供的 artifact source path. `field` 和 `reason` 是 non-empty string. Validation 按 UTF-8 encoding, JSON syntax, root object type, root extra fields, `requestId`, `checks`, 然后各 array entry 依次检查. 每个 entry 先检查是否为 object (否则 `expected-object`), 再检查 `check`, `result`, 然后按该 result 允许的字段集合检查 extra fields, 最后检查 `finding`, uniqueness 和 canonical order. Array entry 按 index order 检查. 同一对象的多个 extra fields 按键名升序返回第一个, reason 为 `unexpected-field`; extra root field 的 field 使用该字段的 JSON path. Encoding, syntax 或 root object failure 使用 `field: "$"`; 其他 field 使用以 `$` 开始的 JSON path. `reason` 分别使用 `invalid-utf8`, `invalid-json`, `expected-object`, `expected-non-empty-string`, `expected-non-empty-array`, `unexpected-field`, `duplicate-check`, `out-of-order-check`, `invalid-result` 或 `input-too-large`. 非空 result 不属于允许集合时使用 `invalid-result`. 未知 check ID 使用 `out-of-order-check`. `input-too-large` 只适用于 Current Parser Contract 已声明的大小限制, 不对 renderReport 增加大小阈值. Diagnostic 只报告上述顺序中的第一个 invalid field.

## Current Promotion Result

现有 `promote(inputPath)` 接受 non-empty string artifact path. 在 Result Summary change 之前, successful result 精确为 `{status: "succeeded", artifactId, trackedStateId}`. `artifactId` 是 validated artifact identity 对应的 non-empty string, `trackedStateId` 是 successful tracked commit identity 对应的 non-empty string. Result 不包含 temporary baseline identity.

## Current Invalid Input Diagnostic

在 Diagnostic Wording change 之前, 现有 public input validation 对 missing, non-string 或 empty `inputPath` 返回 `{failureCode: "invalid-input", path: "inputPath", details: {message: "A valid input path is required."}}`. 这三个 invalid cases 的 field 集合, code, path, details shape, ordering 和 side effects 相同.

## Current Cache Contract

`lookup(key)` 接受 non-empty string canonical key. Current entry 返回 `{found: true, value}`, 其中 `value` 是 stored immutable JSON value 的 detached copy. Missing 或 invalidated key 返回 `{found: false}`. Missing, non-string 或 empty key 返回 `{failureCode: "invalid-cache-key"}`. Lookup 不创建, 修改, 删除或重新排序 cache entries. `invalidate(key)` 对有效 key 成功返回 `undefined`, 无论调用前是否存在同 key entry; 完成后, 下一次同 key lookup 返回 `{found: false}`. Cache entries 是 lookup result 的唯一 authority, operation 按 invocation order 生效.

## Current Parser Contract

`parseArtifact(bytes, path)` 接受最多 1048576 bytes 的 immutable UTF-8 input 和 non-empty string source path. Successful parse 返回符合 `Canonical Readiness Artifact` 的 detached JSON object, 并保持 canonical check order. Invalid UTF-8, JSON 或 artifact schema 返回 `Invalid Artifact Contract` 定义的 diagnostic. 超过 size limit 时返回同一 diagnostic, 使用 `field: "$"` 和 `reason: "input-too-large"`. Operation 不修改 input bytes, 不写文件, 不改变 baseline 或 tracked state.

## Current Reader Index Excerpt

`docs/readers/index.md` 当前恰好包含一个 `[Validation report](../guides/readiness-output.md)` link. Current target 是 `docs/guides/readiness-output.md`, H1 identity 是 `Readiness Output Guide`. Stable replacement target 已存在于 `docs/reference/validation-report.md`, H1 identity 是 `Validation Report Reference`.

## Artifact Reader Interface

Artifact Reader Interface 是 `readArtifact(source) -> immutable bytes | structured diagnostic`. Adapter 只能改变 bytes 来源, 不能拥有 parsing, validation, result 或 diagnostic policy.

## Production Adapter

Production Artifact Reader Adapter 从 caller source 读取 bytes. 成功时返回 byte-for-byte immutable copy. Expected read 或 filesystem failure 时返回 `{failureCode: "artifact-read-failed", operation: "read", path}`.

## Deterministic Adapter

Deterministic Artifact Reader Adapter 从 test configuration 返回 byte-for-byte immutable copy 或同一 `artifact-read-failed` diagnostic.

## Adapter Equivalence

当两个 Adapters 接收内容相同的 bytes 时, `renderReport` 观察到的 immutable input 完全相同, 因而产生相同 report 或 diagnostic. Tests 通过 `renderReport` public lifecycle 比较 complete caller-visible result, 不观察 Adapter implementation steps.

## Promotion Artifact Storage Interface

`readArtifact(path)` 接受 required non-empty string path. 两个 Adapter 成功时返回完整 byte-for-byte immutable bytes, 不验证 artifact 或选择 persistence policy. Expected read failure 精确返回 `{failureCode: "artifact-read-failed", operation: "read", path}`. Promotion 使用自己的 priorTrackedState 与实际 baseline 状态转换成其 expected filesystem failure, 不写入. 当 bytes 或失败及其他输入相同时, 两个 Adapter 通过公开 promote 操作产生相同结果.
