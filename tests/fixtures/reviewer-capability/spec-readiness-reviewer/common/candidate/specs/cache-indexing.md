# Internal Cache 优化

## Scope

本文档修改 non-test runtime cache lookup algorithm, 但保持公开 behavior 和所有 Module boundary.

## Requirements

Public `lookup(key)` 与 `invalidate(key)` 必须保持 `architecture/05-validation-report.md#current-cache-contract` 定义的 input, result, error, ordering, side effects, authority 和 invalidation behavior. Cache Module 新增并维护从 canonical key 到 current entry 的 index. `lookup(key)` 必须直接查询该 index, 不遍历 entry collection. Existing Module 继续独占 cache responsibility.

## Design Rationale

选择 indexed lookup, 而不是 linear lookup, 因为它降低 repeated lookup cost. 拒绝 linear lookup, 因为相同 contract 下扩展性较差. 接受的代价是内部 memory usage 增加.

## Module Design

Not required: 本次只把同一 Cache Module 内的 linear lookup 改为 index lookup. 既有 lookup/invalidate 的输入, 结果, 错误, invocation order, 数据 authority 和副作用不变; 不增加 Module, Seam 或依赖, entry 与 index 的维护继续由同一 Module 负责.

## ADR Evaluation

Caller-visible result, failure, security, persistence 和 authority 都不改变. 该可逆内部 algorithm 不产生新的 durable decision, 因而不需要 ADR.

## Testing Decisions

通过现有 public cache lifecycle 覆盖 hit, miss, invalidate 后 miss, invalid key, detached value 和 no-mutation behavior, 并比较相同 invocation sequence 的完整 result. 不把 private index structure 加入 caller result.
