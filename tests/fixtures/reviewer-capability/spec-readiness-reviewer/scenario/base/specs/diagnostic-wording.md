# Existing Diagnostic Wording Clarification

## Scope

本文档修改 non-test runtime diagnostic message assembly. 唯一 caller-visible 变化是 `details.message` 的具体说明文字值; 其他 fields, structure, result semantics, diagnostic code, ordering, side effects, Module responsibility 和 Interface shape 全部不变.

## Requirements

对于 `architecture/05-validation-report.md#current-invalid-input-diagnostic` 定义的 missing, non-string 或 empty `inputPath`, failure 继续返回 `{failureCode: "invalid-input", path: "inputPath", details: {message}}`, 但 `message` 精确改为 `inputPath must be a non-empty string.`. 其他 invalid-input message, field 集合, code, path, details structure, ordering, side effects 和 error representation 全部保持不变.

## Module Design

Not required: The runtime implementation changes only the specific explanatory text value in `details.message`. Other fields, payload structure, result semantics, diagnostic code, ordering, side effects, Diagnostic Module responsibility, public Interface shape, concrete Adapters, dependency direction, authoritative inputs, and data flow remain unchanged. This wording-only value change does not create or move a Module boundary.

## ADR Evaluation

Result, failure representation, security boundary, persistence, authority 和 recovery behavior 都不改变. 该局部且可逆的 wording implementation 不产生 durable decision, 因而不需要新 ADR.

## Testing Decisions

通过 existing public diagnostic lifecycle 分别验证 missing, non-string 和 empty `inputPath` 返回相同 `failureCode`, path, details structure, exact new message 和 no-side-effect behavior. 其他 invalid-input cases 保持 current message. 不观察 private message helper.
