# 体积预算只计新增行数

Status: ready-for-agent

## What to build

用户决定 (2026-10-27): 体积预算只约束新增代码量, 不约束改动量. 删除无用代码无论多少都是好事, 不计入预算. 把 "改动行数" 的预算口径改为 "新增行数":

- `AGENTS.md` 的 `Efficiency First` 第 7 条: 开工前估算新增行数, 实际新增超出一倍时停下.
- Code Standards 角色 (`docs/agents/roles/code-standards-reviewer.md`) 的输入和 "指出可删除的代码" 职责, `code-review` Skill 的 Standards 轴输入, `arw commit-audit prepare` 生成的 Code Standards handoff 文字, 长期规范中的对应句子.
- 同步 `.claude/skills` 投影和 `distribution/` 分发副本.

预估新增约 15 行 (多为同行替换).

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#commit-audit`

## Acceptance criteria

- [ ] 上述规则, 角色, Skill, handoff 文字和长期规范都改为只计新增行数, 不再出现以改动行数作预算的表述.
- [ ] 投影与分发检查, 全量测试通过.

## Blocked by

- None - can start immediately
