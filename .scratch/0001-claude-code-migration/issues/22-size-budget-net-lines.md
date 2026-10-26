# 体积预算按任务净增行数

Status: ready-for-agent

## What to build

用户决定 (2026-10-27): 体积预算约束任务本身的净增代码量, 不约束改动量. 口径:

- 净增 = 新增行数 - 删除行数, 只算为完成本任务所做的改动 (包括本任务替换或改写掉的旧代码). 净增为负没有问题.
- 与本任务无关的冗余代码删除照样鼓励, 但不抵扣本任务的净增, 否则阈值会被顺带的清理放宽. 这类删除在交付说明中单独列出, 能分开时单独提交.
- `AGENTS.md` 的 `Efficiency First` 第 7 条改为: 开工前估算净增行数, 实际净增超出一倍时停下.
- Code Standards 角色 (`docs/agents/roles/code-standards-reviewer.md`) 的输入和 "指出可删除的代码" 职责, `code-review` Skill 的 Standards 轴输入, `arw commit-audit prepare` 生成的 Code Standards handoff 文字, 长期规范中的对应句子.
- 同步 `.claude/skills` 投影和 `distribution/` 分发副本.

预估新增约 15 行 (多为同行替换).

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#commit-audit`

## Acceptance criteria

- [ ] 上述规则, 角色, Skill, handoff 文字和长期规范都改为按任务净增行数 (无关清理不抵扣), 不再出现以改动行数作预算的表述.
- [ ] 投影与分发检查, 全量测试通过.

## Blocked by

- None - can start immediately
