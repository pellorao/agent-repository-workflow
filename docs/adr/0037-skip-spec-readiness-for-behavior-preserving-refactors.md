# 行为保持重构的实施 issue 不运行 Spec Readiness

本决定部分取代 `./0006-enforce-spec-readiness-with-independent-review.md` 中 "对每个实施 issue" 运行 Spec Readiness 的适用范围. ADR 0006 的其余决定和 `./0023-separate-commit-audit-review-from-implementation.md` 的 Commit Audit 不变.

## Context

只删除死代码, 不可达分支或合并完全相同的重复实现的 issue 没有新的设计决定可供独立设计审查, 设计审核的往返成本接近改动本身. 但它修改了代码, 不能走轻量提交流程, 否则跳过 Gate 1.

## Decision

- 交付只是行为保持重构的实施 issue 不运行 Spec Readiness, 因而没有就绪记录, 实施提交不运行 `verify --subject-only`. 条件, 声明段落 `行为保持重构例外:` 和终态规则由长期规范 (`../specs/agent-repository-workflow/spec.md`) 拥有.
- Commit Audit 照常运行, 是这类 issue 唯一的独立审核. 其 `completed` 转换只经实施提交 (Gate 1).

## Rejected alternatives

- 走规则与文档的轻量提交流程: 跳过 Gate 1, 无人核对行为未变.
- 仍运行 Spec Readiness: 审核成本接近改动本身, 收益为零.

## Consequences

条件是否满足在实施前只由 Main Agent 判断, 误判由 Commit Audit 兜住. 活动中的此类 issue 没有就绪记录, 在 `completed` 前会阻止 `arw migrate artifacts`.
