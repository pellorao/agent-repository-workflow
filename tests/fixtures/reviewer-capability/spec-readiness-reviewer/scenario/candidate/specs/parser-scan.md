# Internal Parser 优化

## Scope

本文档修改 non-test runtime parser algorithm, 但不改变任何 caller-visible behavior.

## Requirements

Public `parseArtifact(bytes, path)` 必须保持 `architecture/05-validation-report.md#current-parser-contract` 定义的 input, canonical result, error, ordering, side effects 和 size limit. Size check 后, Parser 使用一个 forward cursor 消费 input bytes, 并在该 pass 中完成 token recognition 和 field collection; operation 不 restart 或 rescan input bytes. Existing Module 继续独占 parsing responsibility.

## Design Rationale

选择单次 scan, 而不是重复扫描每个 field, 因为它减少内部 allocation. 拒绝重复扫描, 因为相同 contract 下没有额外价值. 接受的代价是内部 state machine 更复杂.

## Module Design

Not required: The parser optimization preserves the current architecture.

## ADR Evaluation

Caller-visible result, failure, security, persistence 和 authority 都不改变. 该可逆内部 algorithm 不产生新的 durable decision, 因而不需要 ADR.

## Testing Decisions

通过现有 `parseArtifact(bytes, path)` public lifecycle 对 valid artifact, invalid UTF-8, invalid JSON, invalid schema, size-limit boundary 和 oversized input 运行 corpus, 比较完整 canonical result 或 diagnostic 以及 no-side-effect behavior. 不把 private cursor state 加入 caller result.
