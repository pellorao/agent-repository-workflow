# 规则与文档候选允许无就绪记录的实施 issue 进入终态

本决定部分取代 `./0006-enforce-spec-readiness-with-independent-review.md` 中 "对每个实施 issue" 运行 Spec Readiness 的适用范围, 以及 `./0023-separate-commit-audit-review-from-implementation.md` 中纯规划路线不接受进入终态的实施 issue, 且不运行 `arw commit-audit verify` 的表述. 两份 ADR 的其余决定不变.

## Context

交付只含 Agent 规则, 文档和 `.scratch` 记录的实施 issue 不运行 Spec Readiness, 提交走轻量流程. 但 issue 自身进入 `completed` 被轻量流程拒绝, 只能另走实施提交流程, 为一个没有代码交付的 issue 付出两个 Reviewer 的往返, Gate 1 核对的实施符合性也没有对象.

## Decision

- 非实施提交 (`arw commit-audit verify --non-implementation`) 允许候选使实施 issue 新进入 `wontfix`; 只有候选树中不存在该 issue 的就绪记录时才允许新进入 `completed`. 有就绪记录的 issue 进入 `completed` 仍被拒绝, 走实施提交流程.
- 交付只含非实施分类内容的实施 issue 不运行 Spec Readiness, 因而没有就绪记录.
- 规则与文档候选由 `verify --non-implementation` 做机械检查, 不再是不运行 `verify`.

## Rejected alternatives

- 保留 Gate 1: 成本如上, 收益为零.
- 机械检查 `## Validation` 内容: 无法证明交付范围, 只增加规则.
- 在 issue 中加显式 doc-only 字段: 新增一个需维护和校验的字段, 字段与实际交付是否一致仍只能由 Main Agent 判断.

## Consequences

`verify` 只能证明候选中没有就绪记录, 不能证明该 issue 历史上没有实施字节, 也发现不了 issue 分类错误. 兜底是非实施分类本身的路径限制 (不能携带代码), 此前任何代码改动都经过 `implement` Entry 的就绪检查 (行为保持重构例外见 `./0037-skip-spec-readiness-for-behavior-preserving-refactors.md`, 它没有就绪记录, 其终态只经实施提交) 和实施提交的 Commit Audit, 以及用户对整体 diff 的复核.
