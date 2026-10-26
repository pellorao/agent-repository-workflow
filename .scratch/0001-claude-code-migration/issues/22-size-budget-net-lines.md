# 体积预算按任务净增行数

Status: completed

## What to build

用户决定 (2026-10-27): 体积预算约束任务本身的净增代码量, 不约束改动量. 口径:

- 净增 = 新增行数 - 删除行数, 只算为完成本任务所做的改动 (包括本任务替换或改写掉的旧代码). 净增为负没有问题.
- 与本任务无关的冗余代码删除照样鼓励, 但不抵扣本任务的净增, 否则阈值会被顺带的清理放宽. 这类删除在交付说明中单独列出, 能分开时单独提交.
- `AGENTS.md` 的 `Efficiency First` 第 7 条改为: 开工前估算净增行数, 实际净增超出一倍时停下.
- 列出并修改以下位置, 改成净增口径: Code Standards 角色 (`docs/agents/roles/code-standards-reviewer.md`) 的输入和 "指出可删除的代码" 职责, `code-review` Skill 的 Standards 轴输入, `arw commit-audit prepare` 生成的 Code Standards handoff 文字, 长期规范中的对应句子.
- 同步 `.claude/skills` 投影和 `distribution/` 分发副本.

预估新增约 15 行 (多为同行替换).

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#user-stories`
- `.scratch/0001-claude-code-migration/spec.md#rule-structure-and-context-budget`
- `.scratch/0001-claude-code-migration/spec.md#review-workflow`

## Acceptance criteria

- [x] 上述规则, 角色, Skill 和 handoff 文字都改为按任务净增行数, 不再出现以改动行数作预算的表述.
- [x] `docs/specs/agent-repository-workflow/spec.md` 的 "Commit Audit" 一节中 Code Standards handoff 指向预估行数的句子 (约第 521 行) 改为预估净增行数; 长期规范不增加其他内容.
- [x] `AGENTS.md` 第 7 条和 Code Standards 角色文件写明无关删除不抵扣净增, 并要求在交付说明 (Agent 最终报告和提交说明) 中单独列出, 能分开时单独提交; 用 grep 确认不再有以改动行数作预算的表述.
- [x] 投影与分发检查, 全量测试通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test`: 701 项, 700 通过, 1 跳过, 0 失败. `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node arw.mjs text check` 均通过; `node scripts/project-claude-skills.mjs` 已同步 `.claude/skills`.
- 以上验证在受审树 8afcd68 对应的最终内容上运行并通过 (Reviewer 不运行命令, 该项由 Main Agent 确认).
- 净增: 交付文件 (规则, Skill, handoff, 长期规范, effort spec) 共 10 个, 17 增 17 删, 净 0 行, 预估约 15 行, 未超. issue 记录 (本文件) 和 `22.spec-readiness.json` 是流程记录, 不是为交付内容所做的改动, 不计入净增. 无无关冗余清理.

## Comments

- 过程偏差: 先改了实现文件, 后跑 Spec Readiness, 违反 `implement` Entry 顺序; 与 ticket 19 同类, 改动在提交前未被提交. Spec Readiness 共 4 轮 (haiku high): 前几轮指出 Spec Requirement 引用了作为输出的长期规范, 以及规则定义只在 issue 中; 已改引用 effort spec 的三节, 在 effort spec 写明预算口径和理由 (与独立 subagent 共同决定), 验收条件补全.
