# 合并审核流程

Status: ready-for-agent

## What to build

Code Spec 与 Commit Audit Gate 1 合并为要求符合审核, Code Standards 增加指出可删除代码的职责并重申最高原则, 两者并行. 复审只看改动部分及其影响范围. Spec Readiness 只在 spec 定稿时审核, `verify` 只在提交前运行. Gate 2 时机不变, spec 末尾记录 Haiku Gate 2 漏报. 规则和引擎代码一起修改.

预估改动: 约 ±400 行.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#review-workflow`

## Acceptance criteria

- [ ] 一次提交最多两个并行 Reviewer.
- [ ] 复审只交付改动部分, 未受影响的结论保留.
- [ ] 相关测试通过, 被删流程的代码和测试已删除.

## Blocked by

- 04 Claude 后端跑通 Reviewer
- 07 流程文档改为自动触发的 Skill
